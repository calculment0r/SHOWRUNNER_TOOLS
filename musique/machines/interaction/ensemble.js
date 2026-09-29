// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/interaction/ensemble.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * ÉTIRER UN ENSEMBLE — groupe ou sélection — par une arête de son pourtour.
 *
 * Pur : la géométrie d'un geste sur plusieurs blocs à la fois, avec sa borne.
 */

import { MIN_SECTION } from "../blocks/machines.js"
import { MIN_TILE } from "../tile/shape.js"
import { horizontalOf, verticalOf,           } from "./gesture.js"
import { scaleGroup,          } from "./layout.js"

/**
 * La tuile minimale d'un ensemble : celle des SECTIONS quand l'ensemble est
 * une machine, celle du canvas sinon. Le planogramme cote plusieurs sections
 * sous la tuile libre minimale — leur appliquer le minimum du canvas faisait
 * SAUTER la machine à la borne au premier mouvement d'une poignée.
 */
export function minDe(family                                        )                           {
  return family.length > 0 && family.every((b) => b.machine) ? MIN_SECTION : MIN_TILE
}

/**
 * Étire un ensemble par une arête de son pourtour — pur, borné.
 *
 * La borne n'est pas la taille minimale du RECTANGLE mais celle de son plus
 * petit membre : en deçà, `scaleGroup` plancherait chaque bloc à sa taille
 * minimale pendant que le rectangle continuerait de rétrécir — les blocs se
 * recouvraient et l'assemblage partait en vrac aux valeurs extrêmes.
 *
 * Et la borne ARRÊTE, elle ne provoque pas : un ensemble déjà plus petit
 * qu'elle ne peut plus rétrécir, mais rien ne le fait sauter à la borne —
 * c'était le bond d'échelle au premier effleurement d'une poignée.
 */
export function scaleEnsemble(
  family                                                            ,
  from     ,
  edge      ,
  delta                          ,
)                   {
  const min = minDe(family)
  const minW = Math.min(
    from.w,
    Math.max(min.w, from.w * Math.max(...family.map((b) => min.w / Math.max(b.w, 1)))),
  )
  const minH = Math.min(
    from.h,
    Math.max(min.h, from.h * Math.max(...family.map((b) => min.h / Math.max(b.h, 1)))),
  )
  const grown = { ...from }
  const horizontal = horizontalOf(edge)
  const vertical = verticalOf(edge)
  if (horizontal === "e") grown.w = Math.max(minW, from.w + delta.x)
  if (horizontal === "w") {
    grown.w = Math.max(minW, from.w - delta.x)
    grown.x = from.x + (from.w - grown.w)
  }
  if (vertical === "s") grown.h = Math.max(minH, from.h + delta.y)
  if (vertical === "n") {
    grown.h = Math.max(minH, from.h - delta.y)
    grown.y = from.y + (from.h - grown.h)
  }
  return scaleGroup(family, from, grown, min)
}
