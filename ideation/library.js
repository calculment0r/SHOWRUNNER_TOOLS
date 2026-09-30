// IDÉATION — le panneau de gauche : la bibliothèque du portail (images,
// vidéos, sons, éléments) et les personnages de Character Factory. Une
// vignette se glisse sur la planche (ou dans une carte Générer : une
// référence) — le glisser-déposer du socle (`dragItem`, type ITEM_MIME), le
// même que dans les autres pages ; un clic la pose au centre de la vue. Un
// personnage de Character Factory devient un élément (import) au moment où
// on le pose.
//
// Le panneau (demande de Cal, 29/09) : ouvert au départ, à sa taille — qu'on
// voie qu'il existe ; × le ferme (le bouton de la barre, la poignée, le menu du
// fond le rouvrent) ; sa poignée l'élargit, le geste de commun/split.js :
// glisser, double-clic = la taille par défaut, flèches 16 px (maj : 64 px).
// L'état se garde avec les préférences d'Idéation (app.LS : « nolib », « lib-w »).

import { api, toast, el, href, fmtDur, kindFr, etypeFr, dragItem } from '../commun/shell.js';
import { waveMark } from './objets/son.js';   // médias : la forme d'onde d'un son en vignette (30/09)

// la largeur du panneau, en px : par défaut, au plus étroit, au plus large ;
// la planche en garde toujours CV_MIN
// (ideation.css, .lgrid : deux colonnes de vignettes dès min, une de plus tous les ~96 px)
export const LIB_W = { def: 250, min: 210, max: 640 };
const CV_MIN = 360;

// la copie d'affichage à la taille d'une vignette (commun/proxies.js), chargée sans être exigée
let pickView = null;
const viewsReady = import('../commun/proxies.js').then((m) => { pickView = m.pickView; }).catch(() => {});

export const CF_MIME = 'application/x-sr-cf';
const TABS = [['image,video,audio,element', 'Tout'], ['image', 'Images'], ['video', 'Vidéos'], ['audio', 'Sons'], ['element', 'Éléments'], ['cf', 'Personnages']];

export function createLibrary(app) {
  const { S } = app;
  const box = document.getElementById('lib');
  let tab = app.LS('lib-tab') || TABS[0][0];
  if (!TABS.some(([k]) => k === tab)) tab = TABS[0][0];
  let q = '';
  let seq = 0;
  const count = el('span', { class: 'lbl' });
  const grid = el('div', { class: 'lgrid' });
  const fileIn = el('input', { type: 'file', multiple: true, accept: 'image/*,video/*,audio/*', hidden: true });
  fileIn.addEventListener('change', () => { app.uploadAndPlace([...fileIn.files]); fileIn.value = ''; });
  const tabs = el('div', { class: 'ltabs' }, ...TABS.map(([k, v]) => el('button', { class: 'tb sm' + (k === tab ? ' on' : ''), type: 'button', 'data-k': k,
    onclick: () => { tab = k; app.LS('lib-tab', k); for (const x of tabs.children) x.classList.toggle('on', x.dataset.k === k); load(); } }, v)));
  let qT = 0;
  const search = el('input', { class: 'fld', placeholder: 'chercher', 'aria-label': 'chercher dans la bibliothèque',
    oninput: (e) => { q = e.target.value; clearTimeout(qT); qT = setTimeout(load, 220); } });
  box.replaceChildren(
    el('div', { class: 'lib-h' }, el('span', { class: 't' }, 'Bibliothèque'), count, el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'des fichiers du disque : ils entrent dans la bibliothèque (Upload) et se posent sur la planche', onclick: () => fileIn.click() }, 'Déposer'), fileIn,
      el('button', { class: 'tb ghost sm lib-x', type: 'button', title: 'fermer la bibliothèque', 'aria-label': 'fermer la bibliothèque', onclick: () => setOpen(false) }, '×')),
    tabs, search, grid,
    el('p', { class: 'lib-f lbl' }, 'glisser sur la planche ou dans une carte · clic : au centre'));

  // ── le panneau : ouvert ou fermé, sa largeur ────────────────
  const body = document.body;
  const main = box.parentElement;   // .ide-main : la grille bibliothèque | planche | inspecteur
  const btn = document.getElementById('b-lib');
  const grip = el('div', { class: 'lib-grip', role: 'separator', tabindex: 0, 'aria-orientation': 'vertical', 'aria-controls': 'lib',
    'aria-valuemin': LIB_W.min, 'aria-valuemax': LIB_W.max });
  box.after(grip);
  const guest = () => body.classList.contains('ide-guest');
  const isOpen = () => !body.classList.contains('nolib');
  // la place que la planche peut céder (elle garde CV_MIN)
  const room = () => {
    const gap = parseFloat(getComputedStyle(main).columnGap) || 0;
    const insp = document.getElementById('insp')?.getBoundingClientRect().width || 0;
    return main.getBoundingClientRect().width - (isOpen() ? 0 : gap) - insp - 2 * gap - CV_MIN;
  };
  const clampW = (w) => Math.round(Math.max(LIB_W.min, Math.min(LIB_W.max, room(), Number(w) || LIB_W.def)));
  let want = Number(app.LS('lib-w')) || LIB_W.def;   // la largeur choisie ; affichée dans les bornes du moment
  function paintWidth() {
    const w = clampW(want);
    main.style.setProperty('--lib-w', w + 'px');
    grip.setAttribute('aria-valuenow', isOpen() ? w : 0);
    return w;
  }
  function setWidth(w, keep = true) {
    want = Math.max(LIB_W.min, Math.min(LIB_W.max, Math.round(w)));
    want = paintWidth();
    if (keep) app.LS('lib-w', want === LIB_W.def ? null : want);
  }
  function setOpen(on) {
    body.classList.toggle('nolib', !on);
    app.LS('nolib', !on);
    btn?.classList.toggle('on', on);
    grip.title = on ? 'glisser : la largeur · double-clic : par défaut' : 'la bibliothèque · clic : l’ouvrir';
    paintWidth();
    setTimeout(() => app.canvas?.paintMini(), 250);
  }
  // l'ouvrir, la recherche prête (le menu du fond : « Depuis la bibliothèque »)
  function open() {
    if (guest()) return;
    setOpen(true);
    requestAnimationFrame(() => search.focus({ preventScroll: true }));
  }
  btn?.addEventListener('click', () => setOpen(!isOpen()));

  // la poignée : glisser (fermé, elle l'ouvre en glissant), un clic l'ouvre ; le bouton du milieu
  // reste à la planche (règle de Cal : il déplace)
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const was = isOpen();
    const x0 = e.clientX;
    const w0 = was ? clampW(want) : 0;
    let moved = false;
    try { grip.setPointerCapture(e.pointerId); } catch { /* */ }
    grip.classList.add('on');
    main.classList.add('resizing');
    body.classList.add('lib-resizing');
    const mv = (ev) => {
      const d = ev.clientX - x0;
      if (!moved && Math.abs(d) < 3) return;
      if (!moved) { moved = true; if (!was) setOpen(true); }
      setWidth(w0 + d, false);
    };
    const up = () => {
      grip.removeEventListener('pointermove', mv);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      grip.classList.remove('on');
      main.classList.remove('resizing');
      body.classList.remove('lib-resizing');
      if (moved) setWidth(want);
      else if (!was) open();
    };
    grip.addEventListener('pointermove', mv);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', (e) => { e.preventDefault(); setWidth(LIB_W.def); if (!isOpen()) setOpen(true); });
  grip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (isOpen()) setOpen(false); else open(); return; }
    const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!d) return;
    e.preventDefault();
    if (!isOpen()) { if (d > 0) setOpen(true); return; }
    setWidth(clampW(want) + d * (e.shiftKey ? 64 : 16));
  });
  // la fenêtre change : la largeur choisie reste, affichée dans les bornes du moment
  new ResizeObserver(() => paintWidth()).observe(main);
  setOpen(!app.LS('nolib'));

  async function load() {
    const my = ++seq;
    grid.replaceChildren(el('p', { class: 'lbl' }, 'chargement'));
    if (tab === 'cf') return loadCf(my);
    try {
      const [r] = await Promise.all([api(`library?kind=${tab}&q=${encodeURIComponent(q)}&limit=240`), viewsReady]);
      if (my !== seq) return;
      count.textContent = String(r.total);
      grid.replaceChildren(...(r.items.length ? r.items.map(card) : [el('p', { class: 'hint' }, q ? 'rien ne répond' : 'rien ici — déposez un fichier, ou créez-le dans un outil')]));
    } catch (e) { grid.replaceChildren(el('p', { class: 'warn' }, e.message)); }
  }
  async function loadCf(my) {
    try {
      const { characters } = await api('cf/characters');
      if (my !== seq) return;
      const list = characters.filter((c) => c.locked && (!q || c.name.toLowerCase().includes(q.toLowerCase())));
      count.textContent = String(list.length);
      grid.replaceChildren(...(list.length ? list.map(cfCard) : [el('p', { class: 'hint' }, 'aucun personnage au visage verrouillé')]));
    } catch (e) { grid.replaceChildren(el('p', { class: 'warn' }, `Character Factory : ${e.message}`)); }
  }

  // une vignette : un div (un bouton ne se glisse pas partout), qui se pose d'un clic ou d'Entrée.
  // L'image est une <img loading="lazy"> : le panneau ne charge que ce qu'on voit défiler
  // (240 fonds d'écran partaient à l'ouverture, sur les six connexions de la planche :
  // étude de fluidité, § 2.3) ; la copie 256 quand le serveur l'a faite.
  function tile(title, thumb, badge, badgeCls, name, sub, place) {
    const c = el('div', { class: 'lt', role: 'button', tabindex: 0, title },
      el('span', { class: 'im' }, thumb ? el('img', { src: href(thumb), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }) : null,
        el('span', { class: 'kind ' + badgeCls }, badge)),
      el('span', { class: 't' }, name), el('span', { class: 's lbl' }, sub));
    c.addEventListener('click', place);
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); place(); } });
    return c;
  }
  // le clic droit sur une vignette : la poser, l'ouvrir ailleurs (jamais le menu du navigateur)
  function tileMenu(c, head, place, extra = () => []) {
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      app.menu(e.clientX, e.clientY, [{ head }, { label: 'Poser au centre de la vue', sub: 'clic', onclick: place }, ...extra()]);
    });
  }
  function card(it) {
    const sub = it.kind === 'element' ? `${etypeFr(it.element?.type)} · ${it.element?.refs?.length || 0} réf.` : it.duration ? fmtDur(it.duration) : it.width ? `${it.width}×${it.height}` : '';
    // la copie d'affichage à la taille de la vignette (commun/proxies.js), sinon la vignette du socle
    const pic = pickView && (it.kind === 'image' || it.kind === 'video') ? pickView(it, 120).url || it.thumb_url : it.thumb_url;
    const c = tile(`${it.title || it.id}${it.prompt ? '\n' + it.prompt.slice(0, 200) : ''}`, pic,
      it.kind === 'element' ? etypeFr(it.element?.type) : kindFr(it.kind), it.kind, it.title || it.id, sub,
      () => { if (!S.board) { toast('ouvrez ou créez d’abord une planche'); return; } app.placeItem(it, ...app.canvas.center(), { free: true }); });
    if (it.kind === 'audio') c.querySelector('.im').prepend(waveMark(it));   // médias : le visuel du son (objets/son.js)
    tileMenu(c, it.title || it.id, () => c.click(), () => {
      const sel1 = S.sel.size === 1 ? app.node([...S.sel][0]) : null;
      return [sel1?.type === 'gen' && ['image', 'element'].includes(it.kind) ? { label: 'En référence de la carte choisie', dot: 'or', onclick: () => app.addRefs(sel1.id, [it]) } : null,
        '-', { label: 'Dans Asset', icon: '↗', onclick: () => window.open(href(`asset/#${it.id}`), '_blank', 'noopener') }];
    });
    return dragItem(c, it);
  }
  function cfCard(ch) {
    const thumb = ch.thumb ? 'api/' + ch.thumb.replace(/^api\//, '') : null;
    const c = tile(`${ch.name} — posé, il devient un élément de la bibliothèque`, thumb, 'personnage', 'element', ch.name,
      ch.imported.length ? 'déjà un élément' : `${ch.costumes} tenue${ch.costumes > 1 ? 's' : ''}`,
      () => app.placeCf({ slug: ch.slug, imported: ch.imported[0] || '', center: true }, ...app.canvas.center()));
    tileMenu(c, ch.name, () => c.click(), () => (ch.imported[0] ? ['-', { label: 'Dans Asset', icon: '↗', onclick: () => window.open(href(`asset/#${ch.imported[0]}`), '_blank', 'noopener') }] : []));
    // pas encore un objet de la bibliothèque : son propre type, que la planche importe au dépôt
    c.draggable = true;
    c.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData(CF_MIME, JSON.stringify({ slug: ch.slug, imported: ch.imported[0] || '' }));
    });
    return c;
  }

  load();
  // un rendu fini, un dépôt : la liste se relit
  document.addEventListener('sr:job', () => load());
  // fermé, et pas pour l'invité (le portail lui ferme la bibliothèque) : le menu du fond le propose
  const closed = () => !guest() && !isOpen();
  return { reload: load, open, close: () => setOpen(false), isOpen, closed, setWidth };
}

// un personnage de Character Factory → l'élément (le plus récent s'il est déjà importé)
export async function cfElement(api2, { slug, imported }) {
  if (imported) {
    try { return await api2('library/' + imported); } catch { /* retiré : on réimporte */ }
  }
  toast('import depuis Character Factory…', 20000);
  const it = await api2('cf/import', { method: 'POST', body: { slug } });
  toast(`${it.title} est maintenant un élément de la bibliothèque`);
  return it;
}
