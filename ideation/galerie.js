// IDÉATION · LA GALERIE DES MODÈLES — ce qu'on peut poser d'un clic sur une planche.
//
// Cal, 05/10 : « je ne trouve pas les trucs en motion design qu'on avait… ils sont hyper cachés ; il faut qu'on puisse les
// avoir à l'ouverture d'une board, comme template ». Les dix modèles de présentation (presentation/modeles/, cinq en
// motion, cinq statiques) n'étaient que dans le mode Présentation, derrière le panneau Diapositives ; les cinq modèles
// d'atelier (objets/modeles.js), dans le dock du bas. La galerie les montre tous, au même endroit :
//   - sur une planche vide (canvas.js, paintEmpty) : « Commencer avec un modèle » ;
//   - dans le menu Modèles du dock (objets/index.js), sous les ateliers.
// Un modèle de présentation ouvre le mode Présentation avec son exemple posé (ses diapositives et son motion, mode.js,
// enter(app, { exemple })) ; un atelier se pose au centre de la vue (insertTemplate). Un seul pas d'annulation chacun.
// Les couleurs des pastilles sont celles du modèle (des données, comme un nuancier), pas des teintes du thème.

import { el, toast } from '../commun/shell.js';
import { TEMPLATES, insertTemplate } from './objets/modeles.js';

let modeles = null;
async function lesModeles() {
  if (!modeles) {
    const { loadModeles } = await import('./presentation/modeles.js');
    modeles = await loadModeles();
  }
  return modeles;
}

export function ouvrirPresentation(app, id) {
  import('./presentation/mode.js').then((m) => m.enter(app, { exemple: id }))
    .catch((e) => toast(`le mode Présentation ne se charge pas : ${e.message}`));
}

// une carte de modèle de présentation : son nom, sa ligne, sa palette
function cartePres(app, m, onPick) {
  const p = m.palette || {};
  return el('button', { class: 'gal-card' + (m.kind === 'motion' ? ' motion' : ''), type: 'button', role: 'menuitem',
    title: `${m.name} — ${m.direction || ''} : son exemple (${m.example?.slides?.length || 0} diapositives) s'ajoute à la planche, dans le mode Présentation`,
    onclick: () => { onPick?.(); ouvrirPresentation(app, m.id); } },
  el('span', { class: 'gal-sw', 'aria-hidden': 'true' }, ...[p.bg, p.surface, p.ink, p.accent, p.accent2].filter(Boolean)
    .map((c) => el('i', { style: { background: c } }))),
  el('b', {}, m.name), m.kind === 'motion' ? el('span', { class: 'gal-tag' }, 'motion') : null,
  el('span', { class: 'gal-line' }, m.line || m.direction || ''));
}

// la galerie : `ateliers` (les modèles d'atelier, posés au centre de la vue), `onPick` (fermer un menu)
export function galerie(app, { ateliers = true, onPick = null, compacte = false } = {}) {
  const motion = el('div', { class: 'gal-cards' }, el('span', { class: 'lbl' }, 'lecture des modèles…'));
  const statiques = el('div', { class: 'gal-cards' });
  lesModeles().then((all) => {
    motion.replaceChildren(...all.filter((m) => m.kind === 'motion').map((m) => cartePres(app, m, onPick)));
    statiques.replaceChildren(...all.filter((m) => m.kind !== 'motion').map((m) => cartePres(app, m, onPick)));
  }).catch((e) => motion.replaceChildren(el('span', { class: 'why' }, `les modèles ne se lisent pas : ${e.message}`)));
  return el('div', { class: 'gal' + (compacte ? ' compacte' : '') },
    el('div', { class: 'gal-sec' }, el('span', { class: 'lbl' }, 'présentations · motion design'), motion),
    el('div', { class: 'gal-sec' }, el('span', { class: 'lbl' }, 'présentations · statiques'), statiques),
    ateliers ? el('div', { class: 'gal-sec' }, el('span', { class: 'lbl' }, 'ateliers de film'),
      el('div', { class: 'gal-cards' }, ...TEMPLATES.map((t) => el('button', { class: 'gal-card', type: 'button', role: 'menuitem', title: t.desc,
        onclick: () => { onPick?.(); insertTemplate(app, t.id, ...app.canvas.center()); } }, el('b', {}, t.name), el('span', { class: 'gal-line' }, t.desc))))) : null);
}

// ── le bouton « Modèles » de la barre du haut (un greffon : plugins.js) ──
// Cal, 05/10 : « mais ils sont où les modèles ? je ne trouve pas » — la galerie d'une planche vide ne se voit plus dès
// qu'on a posé un objet ; le bouton, lui, est toujours là, à côté de Présenter, avec son mot.
export async function install(app) {
  const [{ atelier }, { TOOL_ICON }] = await Promise.all([import('./atelier/socle.js'), import('./objets/modeles.js')]);
  const A = atelier(app);
  const open = () => {
    if (!app.S.board) { toast('ouvrez d’abord une planche'); return; }
    let close = () => {};
    close = app.modal('Modèles', galerie(app, { onPick: () => close() }), null, { cls: 'gal-modal' });
  };
  const btn = A.button({ order: 9, d: TOOL_ICON, name: 'Modèles', title: 'les modèles : présentations en motion design, statiques, ateliers de film', onclick: open });
  btn.className = 'tb ghost sm cmp at-present at-tpl';
  btn.replaceChildren(el('span', { class: 'bi' }, ...btn.childNodes), el('span', { class: 'bt' }, 'Modèles'));
  A.command({ order: 9, label: 'Modèles', sub: 'motion design, statiques, ateliers', run: open });
}
