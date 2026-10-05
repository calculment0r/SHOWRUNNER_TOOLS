// La pochette d'une playlist (server/tools/playlist.py ; étude
// docs/etudes/musique_spaces_playlists.md § 3.2) : l'image de la bibliothèque
// qu'on a choisie — la vignette de l'objet et ses copies d'affichage, que le
// serveur fait d'après elle —, sinon la MOSAÏQUE faite d'office : ses quatre
// premiers morceaux (différents), chacun par son visuel — sa vignette s'il en
// a une, sinon son onde (le masque de server/tools/apercu_son.py, peint par un
// jeton, comme les vignettes de son). La mosaïque n'est pas un fichier : elle
// se peint ici, dans les deux thèmes, sans couleur cuite.
//
//   pochette(it, { items, px })   → un nœud carré (la page lui donne sa taille)
//   it : la playlist (objet public) ; items : {id: son public} si la page les a
//   (sans eux, l'onde de chaque morceau suffit : son adresse vient de son id)
//
// Aucune couleur ici : commun/pochette.css habille avec les jetons.
import { el, href } from './shell.js';
import { bind as bindView } from './proxies.js';

if (typeof document !== 'undefined' && !document.querySelector('link[data-sr-pochette]')) {
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./pochette.css', import.meta.url).href, 'data-sr-pochette': '' }));
}

// les quatre premiers morceaux différents : ceux de la mosaïque
export function mosaiqueIds(it) {
  return [...new Set(((it?.playlist?.tracks) || []).map((t) => t.item))].slice(0, 4);
}

function tuile(id, items, px) {
  const a = items?.[id];
  if (a && (a.thumb_url || a.views?.length)) {
    return el('span', { class: 'sr-poch-t' }, bindView(el('img', { alt: '', loading: 'lazy', decoding: 'async' }), a, { fit: 'cover', box: [px, px] }));
  }
  return el('span', { class: 'sr-poch-t onde' + (a === null ? ' absent' : '') },
    el('i', { style: { '--wave': `url("${href(`api/son/apercu/${id}?v=1`)}")` }, 'aria-hidden': 'true' }));
}

export function pochette(it, { items = null, px = 96 } = {}) {
  if (it?.thumb_url || it?.views?.length) {
    return el('span', { class: 'sr-poch img', title: 'la pochette' },
      bindView(el('img', { alt: '', decoding: 'async' }), it, { fit: 'cover', box: [px, px] }));
  }
  const ids = mosaiqueIds(it);
  // un morceau absent (à la corbeille) : sa case reste, vide (items[id] === null)
  const known = items ? Object.fromEntries(ids.map((id) => [id, id in items ? items[id] : null])) : {};
  const n = ids.length;
  return el('span', { class: `sr-poch mosaique n${n}`, title: n ? 'la mosaïque de ses premiers morceaux (faite d’office)' : 'pas encore de morceau' },
    n ? ids.map((id) => tuile(id, items ? known : null, n > 1 ? px / 2 : px)) : el('span', { class: 'sr-poch-vide', 'aria-hidden': 'true' }));
}
