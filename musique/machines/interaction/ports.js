// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/interaction/ports.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Où se posent les bornes d'un bloc, et jusqu'où on peut les déplacer.
 *
 * Un schéma nodal impose d'ordinaire ses bornes : entrée à gauche, sortie à
 * droite, point final. C'est commode tant que le graphe est simple, et c'est
 * exactement ce qui le rend illisible dès qu'il ne l'est plus — les fils
 * doivent alors contourner les blocs au lieu de prendre le chemin court.
 *
 * Ici, on peut faire glisser une borne **le long du pourtour**. Avec une
 * contrainte qui n'est pas une prudence mais une garantie de lecture :
 *
 *   l'ENTRÉE reste dans la moitié GAUCHE · la SORTIE dans la moitié DROITE
 *
 * Sans elle, un bloc pourrait recevoir par la droite et émettre par la gauche,
 * et le sens du signal — qui se lit aujourd'hui sans une seule flèche — ne se
 * lirait plus du tout.
 *
 * Chaque moitié de pourtour fait exactement la même longueur, `w + h`. On
 * repère donc une borne par un seul nombre `u` entre 0 et 1, parcourant l'arc
 * autorisé. `u = 0,5` tombe au milieu de l'arc, c'est-à-dire au milieu du côté
 * droit pour la sortie et du côté gauche pour l'entrée : la place d'origine.
 */

                                   

/** Position d'une borne le long de son arc, au milieu par défaut. */
export const PORT_HOME = 0.5

                      
           
           
           
           
 

/**
 * Point d'une borne, en coordonnées du même repère que la boîte.
 *
 * L'arc de la SORTIE part du milieu du bord haut, descend le côté droit et
 * finit au milieu du bord bas. Celui de l'ENTRÉE reprend là où l'autre
 * s'arrête : milieu du bord bas, côté gauche, milieu du bord haut. Les deux
 * mis bout à bout font le tour complet, sans recouvrement ni trou.
 */
export function portAt(box     , side          , u        )                           {
  const t = Math.min(1, Math.max(0, u))
  const span = box.w + box.h
  const along = t * span
  const half = box.w / 2

  if (side === "out") {
    // Milieu du haut → coin haut-droit.
    if (along <= half) return { x: box.x + half + along, y: box.y }
    // Côté droit, de haut en bas.
    if (along <= half + box.h) return { x: box.x + box.w, y: box.y + (along - half) }
    // Coin bas-droit → milieu du bas.
    return { x: box.x + box.w - (along - half - box.h), y: box.y + box.h }
  }

  // Milieu du bas → coin bas-gauche.
  if (along <= half) return { x: box.x + half - along, y: box.y + box.h }
  // Côté gauche, de bas en haut.
  if (along <= half + box.h) return { x: box.x, y: box.y + box.h - (along - half) }
  // Coin haut-gauche → milieu du haut.
  return { x: box.x + (along - half - box.h), y: box.y }
}

/**
 * Position d'arc la plus proche d'un point donné.
 *
 * On échantillonne l'arc au lieu de résoudre segment par segment : le pourtour
 * a des coins, la projection analytique demanderait quatre cas et deux
 * comparaisons de distance, et le résultat serait le même. Deux cent quarante
 * points suffisent pour que la borne colle au pointeur à moins d'un pixel sur
 * un bloc de la taille d'un écran.
 */
export function nearestPort(box     , side          , point                          )         {
  const steps = 240
  let best = PORT_HOME
  let closest = Infinity
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    const candidate = portAt(box, side, u)
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y)
    if (distance < closest) {
      closest = distance
      best = u
    }
  }
  return best
}

/**
 * De quel côté du bloc une borne se trouve.
 *
 * Sert au curseur et à l'empilement des sauts : une borne posée sur un bord
 * horizontal ne se prolonge pas dans la même direction qu'une borne posée sur
 * un bord vertical.
 */
export function portEdge(box     , side          , u        )                          {
  const point = portAt(box, side, u)
  if (Math.abs(point.y - box.y) < 0.5) return "haut"
  if (Math.abs(point.y - (box.y + box.h)) < 0.5) return "bas"
  return "cote"
}

/**
 * Rayon d'attraction d'une borne, en px écran.
 *
 * Généreux, et volontairement : viser un carré de neuf pixels au bout d'un
 * glissé est une épreuve d'adresse, pas un geste musical. On lance le câble
 * dans la direction du bloc, il s'accroche. La borne, elle, ne grossit pas —
 * c'est la zone d'attraction qui est large, et elle ne coûte rien à la lecture.
 */
export const CABLE_SNAP = 74
