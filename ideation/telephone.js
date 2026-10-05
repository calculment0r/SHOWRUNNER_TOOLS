// IDÉATION — au téléphone : voir une planche, la parcourir au doigt, y déposer une photo, y écrire une note.
//
// Un module de la planche (plugins.js, install(app)), chargé sur un téléphone seulement (data-appareil="mobile",
// commun/theme-tot.js). Pas toute l'édition (REPRISE § 2.E, Cal) : la planche se fait sur ordinateur ou tablette ;
// au téléphone, on la lit et on y ajoute simplement. Ce que ce module change, et rien d'autre :
//   - un doigt déplace la vue partout, deux doigts zooment (canvas.js : l'outil Main, le pincement) ; rien ne
//     se choisit ni ne bouge par erreur ; les commandes d'un objet (un son, une vidéo) répondent toujours ;
//   - toucher une image, une vidéo, un document : en grand (app.lightbox, la liseuse) ; un texte vu de loin :
//     la vue s'en approche jusqu'à le lire ;
//   - une barre au pied : Tout voir, Plan (les cadres puis les objets : toucher y mène), Photo (l'appareil
//     photo ou la galerie, que le téléphone propose : un <input type=file> sans `capture`, MDN
//     « HTML attribute: capture »), Note (écrite dans un vrai champ, en 16 px, posée à la place libre la plus
//     proche du centre de la vue).
// Les dispositions (la planche pleine largeur, ni inspecteur ni barre d'outils latérale) : ideation.css,
// « le téléphone ». Chaque ajout est un seul app.mutate (un pas d'annulation, ↶ de la barre du haut).

import { el, toast } from '../commun/shell.js';
import { bbox } from './canvas.js';

const ICON = {
  tout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
  plan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  photo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l4 4v12H5zM16 4v4h4M8 12h8M8 16h5"/></svg>',
};
const EN_GRAND = new Set(['image', 'video', 'document']);
const TEXTES = new Set(['note', 'sticky', 'title', 'text']);

export function install(app) {
  const S = app.S;
  const cv = app.canvas.el;
  document.body.classList.add('ide-tel');
  // un doigt : la vue (l'outil Main) ; l'app y revient après chaque pose
  const main = () => { if (S.tool !== 'hand') app.setTool('hand'); };
  main();

  // toucher (sans glisser) une image, une vidéo, un document : en grand
  let tap = null;
  cv.addEventListener('pointerdown', (e) => {
    tap = e.isPrimary && e.button === 0 ? { x: e.clientX, y: e.clientY, t: performance.now(), id: e.target.closest?.('[data-id]')?.dataset.id || null } : null;
  }, true);
  cv.addEventListener('pointerup', (e) => {
    const t = tap; tap = null;
    if (!t || !t.id || !e.isPrimary || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8 || performance.now() - t.t > 450) return;
    if (e.target.closest?.('button, a, input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
    const n = app.node(t.id);
    if (n && n.type === 'media' && EN_GRAND.has(n.kind)) app.lightbox(n);
    // un texte vu de loin (des traits gris : le zoom sémantique) : la vue s'en approche, il se lit
    else if (n && TEXTES.has(n.type) && app.canvas.level() === 'far') app.canvas.flyTo(n.id, { zmax: 1 });
  });
  cv.addEventListener('pointercancel', () => { tap = null; });

  // la barre du pied
  const fileIn = el('input', { type: 'file', accept: 'image/*,video/*', multiple: true, hidden: true,
    onchange: async () => {
      const files = [...fileIn.files];
      fileIn.value = '';
      if (!files.length) return;
      await app.uploadAndPlace(files);
      main();
      requestAnimationFrame(() => voirNeufs(app, S));
    } });
  const b = (cls, label, html, onclick) => el('button', { class: `tb ghost ide-tel-b ${cls}`, type: 'button', onclick },
    el('span', { class: 'ide-tel-i', html }), el('span', { class: 'ide-tel-t' }, label));
  const barre = el('nav', { class: 'ide-tel-barre', 'aria-label': 'la planche au téléphone' },
    b('tout', 'Tout voir', ICON.tout, () => app.canvas.fit()),
    b('plan', 'Plan', ICON.plan, () => plan(app, S)),
    b('photo', 'Photo', ICON.photo, () => (S.board ? fileIn.click() : toast('ouvrez d’abord une planche'))),
    b('note', 'Note', ICON.note, () => note(app, S, main)),
    fileIn);
  cv.append(barre);
  // les poses de l'app (après un dépôt, un collage) rendent l'outil Choisir : on revient à la Main
  app.on('commit', () => setTimeout(main, 0));
  // une planche qui s'ouvre : toute la planche dans l'écran (sa vue d'ordinateur n'y tiendrait pas)
  app.on('board', () => { main(); requestAnimationFrame(() => app.canvas.fit()); });
  if (S.board) requestAnimationFrame(() => app.canvas.fit());
}

// les objets posés à l'instant (le dernier dépôt) : la vue va les montrer
function voirNeufs(app, S) {
  const neufs = (S.board?.nodes || []).filter((n) => S.sel?.has(n.id));
  if (neufs.length) app.canvas.fit(bbox(neufs.map((n) => app.canvas.dispBox(n))));
}

// Plan : les cadres (les diapositives) puis les objets, dans l'ordre de la planche ; toucher y mène
function plan(app, S) {
  const B = S.board;
  if (!B) { toast('ouvrez d’abord une planche'); return; }
  const frames = B.nodes.filter((n) => n.type === 'frame');
  const rest = B.nodes.filter((n) => n.type !== 'frame' && n.type !== 'group' && !app.canvas.hiddenIn(n.id));
  let close = null;
  const aller = (n) => () => { close?.(); app.canvas.fit(bbox([app.canvas.dispBox(n)])); };
  const ligne = (n) => el('button', { class: 'ide-tel-l', type: 'button', onclick: aller(n) },
    el('i', { class: 'dot t-' + (n.type === 'media' ? n.kind : n.type), style: n.type === 'sticky' ? { background: `var(--${n.color})` } : null }),
    el('span', { class: 'n' }, app.label(n) || app.kindLabel(n)), el('small', { class: 'lbl' }, app.kindLabel(n)));
  const body = el('div', { class: 'ide-tel-plan' },
    frames.length ? el('p', { class: 'lbl' }, `${frames.length} cadre${frames.length > 1 ? 's' : ''}`) : null,
    ...frames.map(ligne),
    rest.length ? el('p', { class: 'lbl' }, `${rest.length} objet${rest.length > 1 ? 's' : ''}`) : null,
    ...rest.slice(0, 200).map(ligne),
    B.nodes.length ? null : el('p', { class: 'hint' }, 'la planche est vide : « Photo » ou « Note » au pied de l’écran.'));
  close = app.modal(`Plan · ${B.name || 'planche'}`, body, null, { cls: 'ide-tel-sheet' });
}

// Note : un vrai champ (le clavier du téléphone, 16 px), puis la note au centre de la vue, d'un seul geste
function note(app, S, main) {
  if (!S.board) { toast('ouvrez d’abord une planche'); return; }
  const ta = el('textarea', { class: 'fld ide-tel-ta', rows: 5, maxlength: 5000, placeholder: 'ta note', 'aria-label': 'le texte de la note' });
  let close = null;
  const poser = () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    const [cx, cy] = app.canvas.center();
    const n = { ...app.def('note'), id: app.uid('n'), type: 'note', w: 260, text };
    // la place libre la plus proche du centre de la vue (app.freeSpot : rien n'est recouvert)
    const [x, y] = app.freeSpot(Math.round(cx - n.w / 2), Math.round(cy - n.h / 2), n.w, n.h, { around: true });
    Object.assign(n, { x, y });
    app.mutate((B) => { B.nodes.push(n); });
    close?.();
    main();
    requestAnimationFrame(() => app.canvas.flyTo(n.id, { zmax: 1 }));
  };
  close = app.modal('Une note', el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'posée près du centre de la vue'), ta),
    (cl) => [el('button', { class: 'tb ghost', type: 'button', onclick: cl }, 'Annuler'), el('span', { class: 'sp' }),
      el('button', { class: 'tb go', type: 'button', onclick: poser }, 'Poser la note')], { cls: 'ide-tel-sheet' });
  setTimeout(() => ta.focus(), 30);
}
