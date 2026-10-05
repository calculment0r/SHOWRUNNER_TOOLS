// SHOWRUNNER TOOLS — le téléphone : ce que la barre commune y ajoute.
//
// Chargé par mountHeader (commun/shell.js) sur un téléphone seulement (data-appareil="mobile",
// posé par commun/theme-tot.js avant le premier dessin ; la tablette n'est pas un téléphone).
//
// Les outils qui se font sur un grand écran — ODIO, le Montage, Image, Vidéo (REPRISE § 2.E, Cal) — y
// montrent un écran propre : ce qui se fait sur ordinateur ou tablette, et ce qui reste utile au
// téléphone : écouter ou regarder ce que l'outil a rendu, voir où en sont ses calculs, la file. Rien n'y
// est caché pour de bon : « Ouvrir quand même » rend la page de l'outil, pour cet onglet
// (sessionStorage `sr-tel-ouvert-<outil>`, lu aussi par shell.js pour ne rien couvrir au retour).
//
// shell.js cache la page de l'outil dès la barre posée (html.sr-tel-lourd, shell.css) : rien ne
// s'affiche d'elle le temps que ce module et sa feuille arrivent. Les couleurs : les jetons
// (commun/telephone.css) ; aucun orange : l'écran n'a pas d'action de création.

import { el, api, href, jobs, jobRow, jobItemsFor, thumb, ouvrirFile, avecEspace, TOOLS, fmtDur } from './shell.js';

// ce qui se fait ailleurs, et ce qui reste ici : la liste de l'outil (sa requête de bibliothèque)
const LOURDS = {
  music: {
    titre: 'ODIO se fait sur ordinateur ou tablette', de: 'd’ODIO',
    pourquoi: 'L’arrangement, le nodal et la console demandent un grand écran, un clavier et une souris.',
    liste: 'Ses sons', vide: 'ODIO n’a encore rien rendu dans ce Workspace.',
    requete: 'library?kind=audio&tool=music&limit=24',
  },
  montage: {
    titre: 'Le Montage se fait sur ordinateur ou tablette', de: 'du Montage',
    pourquoi: 'La timeline, les moniteurs et la découpe à l’image près demandent un grand écran et une souris.',
    liste: 'Ses exports', vide: 'Aucun export du Montage dans ce Workspace.',
    requete: 'library?kind=video&tool=montage&limit=24',
  },
  image: {
    titre: 'Image se fait sur ordinateur ou tablette', de: 'd’Image',
    pourquoi: 'Le prompt, les références et les réglages de la caméra se font mieux sur un grand écran.',
    liste: 'Ses images', vide: 'Image n’a encore rien fait dans ce Workspace.',
    requete: 'library?kind=image&tool=image&limit=24',
  },
  movie: {
    titre: 'Vidéo se fait sur ordinateur ou tablette', de: 'de Vidéo',
    pourquoi: 'Les plans, les références et le banc A/B se font mieux sur un grand écran.',
    liste: 'Ses vidéos', vide: 'Vidéo n’a encore rien fait dans ce Workspace.',
    requete: 'library?kind=video&tool=movie&limit=24',
  },
};
const CLE = (t) => `sr-tel-ouvert-${t}`;

function feuille() {
  if (document.querySelector('link[data-sr-tel]')) return Promise.resolve();
  return new Promise((ok) => {
    const l = el('link', { rel: 'stylesheet', href: href('commun/telephone.css'), 'data-sr-tel': '' });
    l.onload = ok; l.onerror = ok;
    document.head.append(l);
  });
}

/** Appelé par mountHeader. `lourd` : shell.js a déjà caché la page (un outil de sa liste GRAND_ECRAN, pas
 *  rouvert dans cet onglet) ; un outil que cette liste-ci ne connaît pas est rendu tel quel. */
export async function monter(toolId, { lourd = false } = {}) {
  if (!lourd) return;
  if (!LOURDS[toolId]) { document.documentElement.classList.remove('sr-tel-lourd'); return; }
  try { await ecranLourd(toolId); } catch (e) { document.documentElement.classList.remove('sr-tel-lourd'); throw e; }
}

async function ecranLourd(toolId) {
  await feuille();
  const t = TOOLS.find((x) => x.id === toolId);
  const L = LOURDS[toolId];
  const nom = t ? t.name.replace(/­/g, '') : toolId;
  const calculs = el('div', { class: 'sr-tel-jobs', 'aria-live': 'polite' }, el('p', { class: 'sr-tel-vide' }, 'lecture de la file…'));
  const liste = el('div', { class: 'sr-tel-liste' }, el('p', { class: 'sr-tel-vide' }, 'lecture…'));
  const fileBtn = el('button', { class: 'tb ghost', type: 'button', onclick: () => ouvrirFile() }, 'La file des calculs');
  const ouvrir = el('button', { class: 'tb ghost', type: 'button', title: `la page de ${nom} telle qu’elle est sur un ordinateur, pour cet onglet`,
    onclick: () => {
      try { sessionStorage.setItem(CLE(toolId), '1'); } catch { /* stockage fermé : jusqu'au rechargement */ }
      stopJobs();
      ecran.remove();
      document.documentElement.classList.remove('sr-tel-lourd');
      // la page était cachée : elle mesure sa place maintenant
      requestAnimationFrame(() => dispatchEvent(new Event('resize')));
    } }, 'Ouvrir quand même');
  const ecran = el('main', { class: 'sr-tel', 'aria-labelledby': 'sr-tel-t' },
    el('div', { class: 'sr-tel-in' },
      el('p', { class: 'sr-tel-k' }, `${t?.k || ''} · ${nom} · au téléphone`),
      el('h1', { class: 'sr-tel-t', id: 'sr-tel-t' }, L.titre),
      el('p', { class: 'sr-tel-p' }, L.pourquoi, toolId === 'music' ? ' Ici, on suit ses calculs et on écoute ce qu’il a rendu.' : ' Ici, on suit ses calculs et on regarde ce qu’il a rendu.'),
      el('div', { class: 'sr-tel-acts' }, fileBtn, ouvrir),
      el('section', { class: 'sr-tel-sect', 'aria-labelledby': 'sr-tel-h1' },
        el('h2', { class: 'sr-tel-h', id: 'sr-tel-h1' }, `Les calculs ${L.de}`), calculs),
      el('section', { class: 'sr-tel-sect', 'aria-labelledby': 'sr-tel-h2' },
        el('h2', { class: 'sr-tel-h', id: 'sr-tel-h2' }, L.liste,
          el('a', { class: 'sr-tel-more', href: avecEspace(href('asset/')) }, 'Asset')), liste)));
  document.body.append(ecran);

  // les calculs de l'outil : le relevé de la file de l'en-tête (jobs.watch, un seul par navigateur)
  let sig = '';
  const stopJobs = jobs.watch(async (list) => {
    const mine = list.filter((j) => j.tool === toolId).slice(0, 8);
    const s = JSON.stringify(mine.map((j) => [j.id, j.state, Math.round((j.progress || 0) * 100), j.position]));
    if (s === sig) return;
    sig = s;
    await jobItemsFor(mine).catch(() => {});
    calculs.replaceChildren(...(mine.length ? mine.map(jobRow)
      : [el('p', { class: 'sr-tel-vide' }, `aucun calcul ${L.de} en file ni en cours`)]));
  });

  // ce qu'il a rendu : la fiche d'Asset le montre (son lecteur, au doigt) ; un son s'écoute ici même
  try {
    const { items = [] } = await api(L.requete);
    if (!items.length) { liste.replaceChildren(el('p', { class: 'sr-tel-vide' }, L.vide)); return; }
    if (items[0].kind === 'audio') {
      const { petitLecteur } = await import('./lecteur.js');
      liste.replaceChildren(el('ul', { class: 'sr-tel-sons' }, ...items.map((it) => el('li', { class: 'sr-tel-son' },
        el('a', { class: 'sr-tel-st', href: avecEspace(href(`asset/#${it.id}`)) }, el('b', {}, it.title || it.id),
          el('small', {}, [it.duration ? fmtDur(it.duration) : '', it.origin?.model || ''].filter(Boolean).join(' · '))),
        petitLecteur(it.url, { duree: it.duration || 0, titre: it.title || '' })))));
    } else {
      liste.replaceChildren(el('div', { class: 'grid sm sr-tel-grille' },
        ...items.map((it) => thumb(it, { onclick: () => { location.href = avecEspace(href(`asset/#${it.id}`)); } }))));
    }
  } catch (e) {
    if (e.status !== 401) liste.replaceChildren(el('p', { class: 'warn' }, e.message));
  }
}
