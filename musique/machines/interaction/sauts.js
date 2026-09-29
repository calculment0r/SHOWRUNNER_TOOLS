// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/interaction/sauts.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * LES SAUTS — les liaisons qu'on ne dessine pas.
 *
 * Pur : quand deux blocs se touchent, le fil n'a pas la place d'exister ; et
 * la couleur d'un saut masqué d'office se tire de son nom, pour être stable.
 */

                                      
import { JUMP_COLORS } from "./patch.js"

/** Jeu toléré entre deux blocs pour les dire collés, en px monde. */
export const TOUCHING = 3

/**
 * Deux blocs se touchent-ils ?
 *
 * Bord contre bord, sur n'importe lequel des quatre côtés, avec un recouvrement
 * réel sur l'autre axe — deux blocs qui ne se frôlent que par un coin ne se
 * touchent pas, ils se croisent.
 *
 * Quand c'est le cas, le fil qui les relie n'a littéralement pas la place
 * d'exister : le dessiner produit un trait caché derrière les tuiles, c'est-à-dire
 * une liaison invisible qu'on croit voir. On la masque comme un saut, et elle
 * revient d'elle-même dès qu'on les écarte — au glissé, en dégroupant, ou par un
 * rangement.
 */
export function touching(a     , b     )          {
  const colleX =
    Math.abs(a.x + a.w - b.x) <= TOUCHING || Math.abs(b.x + b.w - a.x) <= TOUCHING
  const colleY =
    Math.abs(a.y + a.h - b.y) <= TOUCHING || Math.abs(b.y + b.h - a.y) <= TOUCHING
  const croiseX = a.x < b.x + b.w - TOUCHING && b.x < a.x + a.w - TOUCHING
  const croiseY = a.y < b.y + b.h - TOUCHING && b.y < a.y + a.h - TOUCHING
  return (colleX && croiseY) || (colleY && croiseX)
}

/**
 * Couleur d'une liaison masquée d'office : tirée du nom de la liaison, donc
 * toujours la même pour la même paire. Une couleur qui changerait à chaque
 * rendu ne serait plus un repère.
 */
export function autoJumpColor(key        )         {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return JUMP_COLORS[hash % JUMP_COLORS.length] 
}
