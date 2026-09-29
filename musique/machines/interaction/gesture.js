// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/interaction/gesture.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Mathématiques des gestes : redimensionnement et réglage à la traînée.
 *
 * Pures et testables. La géométrie d'un redimensionnement par une arête gauche
 * ou haute n'est pas symétrique de celle par une arête droite ou basse — il
 * faut déplacer l'origine *et* changer la taille, et s'arrêter proprement à la
 * taille minimale. C'est exactement le genre de calcul qu'on ne veut pas
 * vérifier à la souris.
 */

                      
           
           
           
           
 

/**
 * Arêtes saisissables : les quatre côtés et les **quatre** coins.
 *
 * Les quatre coins, et pas seulement le bas-droit : réorganiser doit se faire
 * dans le sens où l'on regarde. Un bloc qu'on veut agrandir vers la gauche se
 * prend par son coin gauche, sinon il faut le redimensionner puis le déplacer —
 * deux gestes là où il en faut un.
 */
                                                                    

export const ALL_EDGES                  = ["n", "s", "e", "w", "ne", "nw", "se", "sw"]

export const EDGE_CURSOR                       = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
  sw: "nesw-resize",
}

/** Composante horizontale d'une arête, `null` si elle n'en a pas. */
export function horizontalOf(edge      )                   {
  if (edge === "e" || edge === "ne" || edge === "se") return "e"
  if (edge === "w" || edge === "nw" || edge === "sw") return "w"
  return null
}

/** Composante verticale d'une arête, `null` si elle n'en a pas. */
export function verticalOf(edge      )                   {
  if (edge === "n" || edge === "ne" || edge === "nw") return "n"
  if (edge === "s" || edge === "se" || edge === "sw") return "s"
  return null
}

/**
 * Applique un déplacement de souris à une arête.
 *
 * @param start boîte au début du geste, en coordonnées monde
 * @param dx,dy déplacement depuis le début du geste, en coordonnées monde
 */
export function resizeBox(start     , edge      , dx        , dy        , min                          )      {
  let { x, y, w, h } = start
  const horizontal = horizontalOf(edge)
  const vertical = verticalOf(edge)

  if (horizontal === "e") {
    w = Math.max(min.w, start.w + dx)
  }
  if (horizontal === "w") {
    // L'arête gauche déplace l'origine : la droite doit rester immobile.
    w = Math.max(min.w, start.w - dx)
    x = start.x + (start.w - w)
  }
  if (vertical === "s") {
    h = Math.max(min.h, start.h + dy)
  }
  if (vertical === "n") {
    h = Math.max(min.h, start.h - dy)
    y = start.y + (start.h - h)
  }

  return { x, y, w, h }
}

/** Course verticale, en pixels écran, pour parcourir toute la plage d'un paramètre. */
export const DRAG_RANGE = 200
/** Facteur du mode fin, touche majuscule enfoncée. */
export const FINE_FACTOR = 0.25

/**
 * Nouvelle position normalisée après une traînée verticale.
 * Vers le haut fait monter la valeur — le sens attendu partout en audio.
 */
export function normFromDrag(startNorm        , dy        , fine = false)         {
  const delta = (-dy / DRAG_RANGE) * (fine ? FINE_FACTOR : 1)
  return Math.min(1, Math.max(0, startNorm + delta))
}

/** Seuil de déclenchement d'un glissement, en px. En deçà, c'est un clic. */
export const DRAG_THRESHOLD = 4

export function isDrag(dx        , dy        )          {
  return Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD
}
