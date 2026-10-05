// IDÉATION · DIAPOSITIVES — le style « Aucun » d'un titre ou d'une note (Cal, 05/10/2026) :
// « quand on sélectionne "aucun" pour ne pas être dans le style de la présentation, on veut
// comme dans Miro une petite barre d'outils au-dessus du texte pour choisir sa typo, la
// couleur du texte, la couleur du fond, la justification… ; par défaut, un nouveau texte
// est en style aucun ».
//
// Un titre ou une note SANS style porte ses propres réglages, pour toute la boîte :
//   font   une police de la bibliothèque (diapo/polices.js, celles des styles)
//   fs     la taille en px du monde (sinon : 13 pour une note, la taille du titre)
//   color  un jeton de texte (TEXT_COLORS du serveur) ; bg un jeton de fond, ou 'none'
//          (une note sans sa carte) ; align (déjà là, diapo/index.js)
// Avec un style nommé, ces réglages dorment (le style décide) et reviennent à « Aucun ».
// La barre : selection.js (mode « libre »), comme celle de l'objet texte (objets/texte.js).

import { el } from '../../commun/shell.js';
import { fontOf, cssFamily, ensureFont, fontMenu, deckMeta } from './polices.js';
import { COLORS, BG, SIZES } from '../objets/texte.js';

const ALIGN = [['left', 'À gauche'], ['center', 'Au centre'], ['right', 'À droite']];
const ICONS = {
  left: 'M4 6h16M4 10h10M4 14h16M4 18h10', center: 'M4 6h16M7 10h10M4 14h16M7 18h10', right: 'M4 6h16M10 10h10M4 14h16M10 18h10',
};
const TITLE_PX = { s: 22, m: 34, l: 52 };
const NS = 'http://www.w3.org/2000/svg';
function tic(d) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'tic');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  s.append(p);
  return s;
}
const isText = (n) => n && (n.type === 'title' || n.type === 'note');
// le fond d'une note sans style : sa carte (défaut), aucun, ou un jeton
const NOTE_BG = [['', 'carte (défaut)'], ['none', 'aucun (transparent)'], ...BG.filter(([k]) => k)];
const TITLE_BG = [['', 'aucun (transparent)'], ...BG.filter(([k]) => k)];

export function installLibre(app) {
  const { S } = app;
  const sizeOf = (n) => n.fs || (n.type === 'title' ? TITLE_PX[n.size || 'm'] || 34 : 13);

  // ── l'habit : des variables sur l'objet, lues par diapo.css (.nd[data-lf]…) ──
  app.canvas.decorate((n, e) => {
    if (!isText(n)) return;
    const free = !n.style;
    const f = free && n.font ? fontOf(app, n.font) : null;
    if (f?.src === 'google') ensureFont(app, f.id, () => app.render());
    const put = (attr, v, prop) => { if (v) { e.dataset[attr] = '1'; e.style.setProperty(prop, v); } else { delete e.dataset[attr]; e.style.removeProperty(prop); } };
    put('lf', f ? cssFamily(f) : '', '--lf');
    put('lfs', free && n.fs ? `${n.fs}px` : '', '--lfs');
    put('lc', free && n.color ? `var(--${n.color})` : '', '--lc');
    put('lbg', free && n.bg && n.bg !== 'none' ? `var(--${n.bg})` : '', '--lbg');
    if (free && n.bg === 'none') e.dataset.lnone = '1'; else delete e.dataset.lnone;
  });

  const set = (n, patch) => app.mutate(() => { for (const [k, v] of Object.entries(patch)) { if (v === '' || v === null) delete n[k]; else n[k] = v; } });
  const step = (n, dir) => {
    const size = sizeOf(n);
    const i = SIZES.findIndex((v) => v >= size);
    const j = dir > 0 ? (SIZES[i] === size ? i + 1 : i) : (i <= 0 ? 0 : i - 1);
    return SIZES[Math.max(0, Math.min(SIZES.length - 1, j < 0 ? SIZES.length - 1 : j))];
  };

  // ── la barre au-dessus du titre, de la note (selection.js, mode « libre ») ──
  function barItems(n, K) {
    const { btn, sub, sep } = K;
    const D = deckMeta(app);
    const out = [];
    // le style d'abord : « Aucun » ouvre les réglages ; un style nommé les remplace
    const st = n.style && D?.styles?.[n.style];
    out.push(sub(el('span', { class: 'tfont' }, st ? st.name : 'Aucun'), () => [{ head: 'style de texte' },
      { label: 'Aucun', sub: 'réglé ici', checked: !n.style, onclick: () => app.diapo?.setStyle([n], '') },
      ...Object.entries(D?.styles || {}).map(([sid, s]) => ({ label: s.name, sub: `${s.size} px`, checked: n.style === sid, onclick: () => app.diapo?.setStyle([n], sid) })),
      '-', { label: 'Styles de la présentation…', onclick: () => app.diapo?.stylesModal() }],
    { title: 'le style de la présentation (Aucun : police, taille, couleurs réglées ici)' }));
    if (!n.style) {
      const f = n.font ? fontOf(app, n.font) : null;
      const size = sizeOf(n);
      const bgs = n.type === 'note' ? NOTE_BG : TITLE_BG;
      const dot = (tok) => el('i', { class: 'tdot', style: { background: `var(--${tok})` } });
      out.push(sep(),
        sub(el('span', { class: 'tfont', style: f ? { fontFamily: cssFamily(f) } : {} }, f ? f.name.split(' ')[0] : 'Police'),
          () => fontMenu(app, n.font || '', (k) => set(n, { font: k })), { title: 'la police — chaque nom est écrit dans sa police' }),
        el('span', { class: 'tsize' },
          btn('−', () => set(n, { fs: step(n, -1) }), { title: 'plus petit', why: size <= SIZES[0] ? 'déjà la plus petite taille' : '' }),
          sub(el('b', { class: 'sv' }, String(Math.round(size))), () => [{ head: 'taille' }, ...SIZES.map((v) => ({ label: `${v}`, checked: v === size, onclick: () => set(n, { fs: v }) }))], { title: 'la taille du texte' }),
          btn('+', () => set(n, { fs: step(n, 1) }), { title: 'plus grand', why: size >= SIZES[SIZES.length - 1] ? 'déjà la plus grande taille' : '' })),
        sep(),
        sub(el('span', { class: 'tsw', 'aria-label': 'couleur' }, el('b', { class: 'tA', style: { '--k': `var(--${n.color || 'ink'})` } }, 'A')),
          () => [{ head: 'couleur du texte' }, ...COLORS.map(([k, name]) => ({ label: name, dot: k, checked: (n.color || 'ink') === k, onclick: () => set(n, { color: k === 'ink' ? '' : k }) }))],
          { title: 'la couleur du texte' }),
        sub(el('span', { class: 'tsw' }, n.bg && n.bg !== 'none' ? dot(n.bg) : el('i', { class: 'tdot none' }), 'Fond'),
          () => [{ head: 'le fond' }, ...bgs.map(([k, name]) => ({ label: name, dot: k && k !== 'none' ? k : null, checked: (n.bg || '') === k, onclick: () => set(n, { bg: k }) }))],
          { title: n.type === 'note' ? 'le fond de la note (sa carte par défaut)' : 'un fond facultatif (transparent par défaut)' }));
    }
    const al = n.align || 'left';
    out.push(sep(), el('span', { class: 'sseg' }, ...ALIGN.map(([k, v]) => btn(tic(ICONS[k]), () => app.diapo?.setAlign([n], k), { on: al === k, title: v, cls: 'tb-ic' }))));
    return out;
  }
  const barKey = (n) => JSON.stringify([n.style, n.font, n.fs, n.color, n.bg, n.align, n.size]);

  app.libre = { barItems, barKey, isText };
}
