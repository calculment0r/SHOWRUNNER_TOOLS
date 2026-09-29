// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/tile/legible.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Plancher de lisibilité : jusqu'où le dézoom a encore un sens.
 *
 * Le zoom sémantique retire l'accessoire à mesure que la tuile rétrécit — c'est
 * son intérêt. Mais il existe un point au-delà duquel il n'y a plus rien à
 * retirer sans rendre la tuile muette : une valeur sans son nom ne s'interprète
 * pas, et un nom de paramètre sans le nom du bloc ne dit pas de quoi on parle.
 *
 * On définit donc un **niveau de dézoom maximal**, calculé et non décrété : la
 * plus petite échelle à laquelle chaque tuile montre encore les trois choses qui
 * la rendent utilisable — le nom du bloc, le nom du paramètre exposé, sa valeur.
 * En deçà, on ne zoome plus.
 *
 * Tout est pur : c'est de l'arithmétique sur des mesures de texte.
 */

import { getTuning } from "../design/tuning.js"
import { MIN_HEADER } from "./shape.js"
import { DISP, TILE_NAME_FONT, TILE_NAME_SPACING, engrave, measureText } from "./measure.js"

/** Corps minimal d'un texte lisible : celui du titre des blocs (défaut). */
export const MIN_LEGIBLE = 9
/**
 * Interlettrage retenu pour le plancher : aucun.
 *
 * C'est celui auquel `Promoted` se rabat quand la place manque, donc celui qui
 * décide vraiment si le mot tient. Mesurer avec l'interlettrage large ferait
 * remonter le plancher pour rien.
 */
const TIGHT = "0px"
/** Interligne entre le nom et la valeur — cf. `.promoted`. */
const LEAD = 2
/** Marge du contenu sur une petite tuile — cf. `edgeOf` dans Promoted. */
const EDGE = 2
/** Rembourrage horizontal d'un en-tête resserré — cf. Tile. */
const HEAD_PAD = 4
/**
 * Place du témoin d'activité, gouttière comprise — cf. `ledSize` dans Tile.
 *
 * Il ne se retire jamais, quel que soit le zoom : c'est la seule chose qui dit
 * si un bloc joue. Sa place entre donc dans le plancher de lisibilité, sans quoi
 * on autoriserait un dézoom où le témoin chasse le nom du bloc.
 */
const LED_SPACE = 7 + 4
/** Marge de sûreté sur les mesures — cf. Tile. */
const FIT_MARGIN = 3
/** Surface minimale d'un graphisme encore saisissable, faute de paramètre exposé. */
const MIN_GRAPHIC = { w: 24, h: 16 }

                          
           
           
 

/**
 * Taille apparente minimale d'une tuile pour qu'elle reste utilisable.
 *
 * @param short  nom court du bloc — celui qui subsiste dans l'en-tête
 * @param label  nom du paramètre exposé, ou `null` si c'est le graphisme qui reste
 * @param value  valeur formatée, telle qu'elle s'affichera
 */
export function minLegibleSize(short        , label               , value        )          {
  const legible = getTuning().legibleMin
  // SHOWRUNNER : la fonte des valeurs en grand (corps.js) est celle d'affichage du portail
  const fallbackFont = `${legible}px ${DISP}`
  const head =
    measureText(short, TILE_NAME_FONT, TILE_NAME_SPACING) + HEAD_PAD * 2 + LED_SPACE + FIT_MARGIN

  const body =
    label === null
      ? MIN_GRAPHIC
      : {
          w:
            Math.max(
              measureText(engrave(label), fallbackFont, TIGHT),
              measureText(engrave(value), fallbackFont, TIGHT),
            ) +
            EDGE * 2,
          // Deux lignes de texte au corps minimal, plus leur interligne.
          h: legible * 2 + LEAD + EDGE * 2,
        }

  // Les deux filets de la tuile sont dans sa boîte : ils lui coûtent 1px par
  // côté, qu'il faut réclamer en plus du contenu.
  return { w: Math.ceil(Math.max(head, body.w)) + 2, h: Math.ceil(MIN_HEADER + body.h) + 2 }
}

/**
 * Échelle en dessous de laquelle une tuile cesse d'être lisible.
 *
 * C'est un rapport : la taille minimale exigée par le contenu, divisée par la
 * taille de la tuile en coordonnées monde.
 */
export function minScaleFor(
  world                          ,
  need         ,
)         {
  if (world.w <= 0 || world.h <= 0) return 0
  return Math.max(need.w / world.w, need.h / world.h)
}
