// IDÉATION — les deux barres, comme Miro (Cal, 30/09 ; help.miro.com, « Toolbars » :
// le menu de la planche en haut à gauche, la collaboration et Présenter en haut à droite,
// la barre de création verticale à gauche de la planche, annuler / rétablir dessous, la
// navigation — zoom, mini-carte — en bas à droite) :
//   - en haut (.ide-bar) : la planche (Planches, Nouvelle, son nom, l'enregistrement,
//     annuler et rétablir), puis l'export, les raccourcis, l'atelier (Présenter,
//     Diapositives, vote, projecteur, minuteur, machine temporelle, palette ⌘K :
//     atelier/socle.js y pose son groupe), la collaboration (collab.js) ;
//   - à gauche, sur la planche (.ide-bar.ide-side, barres.css) : les outils qui posent
//     (choisir, main, flèche ; note, post-it, titre, cadre, formes, cartes, mind map,
//     crayon — objets/ — composeur, générer image et vidéo), les médias (son, web :
//     objets/medias.js), la bibliothèque. Un module qui y ajoute un outil le pose dans le
//     groupe « poser » (`.ide-side .tgrp[aria-label="poser"]`), avec `data-tool` : la
//     délégation des clics (ideation.js) et le clavier le prennent comme les autres ; une
//     action (pas un outil), dans le groupe « médias ». Annuler et rétablir sont en haut :
//     sur un écran de 13 pouces (1280 × 800), la barre de gauche n'aurait pas tout montré.
//
// La barre du haut tient sur une ligne. De 1280 px à 1920 px tout y est (ideation.css
// la resserre d'abord : des icônes au lieu des mots, des boutons plus étroits) ; plus
// étroite, ou si la collaboration y ajoute des pastilles, ce qui ne tient plus passe
// dans le menu ⋯ (commun/menu.js, kebab), le moins utile d'abord. La barre de gauche,
// plus haute que la planche (un écran très bas), défile (barres.css).
//
// Juste par construction : pas de seuils à tenir à jour. La barre ne passe jamais à
// la ligne (flex-wrap: nowrap) ; le nom de la planche rétrécit le premier, puis, tant
// que le dernier bouton dépasse, on replie le suivant de la liste FOLD. On recommence
// quand la barre change de largeur ou de contenu. Un bouton replié reste dans la page
// (caché) : son entrée du menu le presse, et ce qui s'ouvre sous lui s'ouvre sous ⋯.

import { kebab } from '../commun/menu.js';

// du premier replié au dernier ; dans un groupe, le dernier bouton part d'abord
const FOLD = [
  ['#b-help', 90], ['#b-export', 88], ['.co-bar .co-ic', 86], ['#b-new', 84], ['.co-bar .co-inv', 82],
  ['.at-grp > button', 80], ['.tgrp[aria-label="annuler"] > button', 70],
];
// une action grisée dit pourquoi (règle 7 du thème)
const WHY = { 'b-undo': 'rien à annuler', 'b-redo': 'rien à rétablir', 'b-export': 'la planche est vide : posez quelque chose d’abord' };

const shown = (e) => !e.hidden && e.getClientRects().length > 0;

export function installBar() {
  const bar = document.querySelector('.ide-bar:not(.ide-side)');
  if (!bar) return null;
  installSide();
  const more = kebab(() => items(), { title: 'la suite de la barre', cls: 'ic ide-more' });
  more.hidden = true;
  bar.append(more);

  function units() {
    const out = [];
    for (const [sel, rank] of FOLD) {
      const list = [...bar.querySelectorAll(sel)];
      list.forEach((b, i) => out.push([b, rank + (i + 1) / 100]));
    }
    return out;
  }
  function over() {
    const r = bar.getBoundingClientRect();
    const last = [...bar.children].filter(shown).pop();
    return bar.scrollWidth > bar.clientWidth + 1 || (!!last && last.getBoundingClientRect().right > r.right + 1);
  }
  const OPTS = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] };
  let raf = 0;
  function fit() {
    raf = 0;
    mo.disconnect();
    try {
      const U = units();
      for (const [b] of U) b.classList.remove('fold-out');
      for (const g of bar.querySelectorAll('.fold-empty')) g.classList.remove('fold-empty');
      if (bar.lastElementChild !== more) bar.append(more);   // la collaboration pose sa part après
      more.hidden = true;
      if (!over()) return;
      more.hidden = false;
      const order = U.filter(([b]) => shown(b)).sort((a, z) => z[1] - a[1]);
      for (const [b] of order) {
        b.classList.add('fold-out');
        const g = b.parentElement;
        if (g !== bar && ![...g.children].some(shown)) g.classList.add('fold-empty');
        if (!over()) break;
      }
    } finally {
      mo.observe(bar, OPTS);
    }
  }
  const soon = () => { if (!raf) raf = requestAnimationFrame(fit); };
  // l'état d'enregistrement change à chaque geste : le nom de la planche absorbe sa largeur
  const mo = new MutationObserver((recs) => { if (recs.some((r) => !r.target.closest?.('#save-st') && !r.target.parentElement?.closest('#save-st'))) soon(); });
  mo.observe(bar, OPTS);
  new ResizeObserver(soon).observe(bar);
  // ce que la page cache selon la personne (invité, spectateur) change la barre
  new MutationObserver(soon).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  const label = (b) => {
    const a = b.getAttribute('aria-label');
    const txt = (b.querySelector('.bt')?.textContent || b.textContent || '').trim();
    const t = (b.title || '').split(' · ');
    return a || (txt.length > 1 ? txt : '') || t[0] || txt;
  };
  const key = (b) => { const t = (b.title || '').split(' · '); return t.length > 1 && t[t.length - 1].length <= 16 ? t[t.length - 1] : undefined; };
  // presser un bouton replié : il se pose (invisible) sous ⋯ le temps du clic, ce qu'il
  // ouvre à sa place (une grille, un menu) s'ouvre donc là
  function press(b) {
    const r = more.getBoundingClientRect();
    b.classList.add('fold-anchor');
    Object.assign(b.style, { left: `${Math.round(r.left)}px`, top: `${Math.round(r.top)}px` });
    try { b.click(); } finally {
      requestAnimationFrame(() => { b.classList.remove('fold-anchor'); b.style.left = ''; b.style.top = ''; });
    }
  }
  function items() {
    const out = [];
    let group = null;
    for (const b of bar.querySelectorAll('.fold-out')) {
      if (b.hidden) continue;
      if (group && b.parentElement !== group && out.length) out.push('-');
      group = b.parentElement;
      const toggle = b.dataset.tool || b.id === 'b-lib' || b.classList.contains('on');
      out.push({ label: label(b), key: key(b), checked: toggle ? b.classList.contains('on') : undefined,
        disabled: b.disabled, why: WHY[b.id] || 'indisponible pour le moment', onclick: () => press(b) });
    }
    return out;
  }
  soon();
  return { fit, more };
}

// la barre des outils, sur la planche : ses gestes restent à elle (le bouton du milieu passe
// à la planche : il déplace la vue partout) ; la grille d'un outil (formes, cartes : objets/)
// s'ouvre à sa droite, pas dessous
function installSide() {
  const side = document.querySelector('.ide-side');
  if (!side) return;
  // (le clic droit remonte au menu de la page : canvas.js le laisse passer)
  side.addEventListener('pointerdown', (e) => { if (e.button !== 1) e.stopPropagation(); });
  side.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); });
  side.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  new MutationObserver((recs) => {
    for (const r of recs) for (const n of r.addedNodes) {
      if (!n.classList?.contains('ob-sub')) continue;
      const b = side.querySelector(`[data-tool="${n.dataset.kind}"]`);
      if (!b) continue;
      const rb = b.getBoundingClientRect();
      n.style.left = `${Math.round(rb.right + 8)}px`;
      n.style.top = `${Math.round(Math.max(8, Math.min(rb.top, innerHeight - n.offsetHeight - 8)))}px`;
    }
  }).observe(document.body, { childList: true });
}
