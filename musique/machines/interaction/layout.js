// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/interaction/layout.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Disposition spatiale : aimantation, couplage de voisins, groupes.
 *
 * Tout est pur et sans DOM. C'est la partie de l'interface la plus difficile à
 * vérifier à la souris — un couplage qui laisse un trou d'un pixel, un
 * rangement qui perd les proportions — donc c'est celle qu'on teste.
 */

                      
           
           
           
           
 

import { horizontalOf, verticalOf,           } from "./gesture.js"

                    

/**
 * Distance d'aimantation, en px monde.
 *
 * Volontairement courte : on veut pouvoir coller deux blocs sans viser, mais
 * aussi les superposer librement. Une aimantation trop large rendrait le
 * chevauchement impossible à obtenir, alors que c'est un geste légitime.
 */
export const SNAP_DISTANCE = 7

                             
          
                                                                                 
                                                
 

/**
 * Aimante une boîte déplacée sur les arêtes de ses voisines.
 *
 * Deux familles d'accrochage, également utiles :
 *   - **jointure** : mon bord droit sur leur bord gauche, et réciproquement —
 *     c'est ce qui permet de constituer une mosaïque ;
 *   - **alignement** : mon bord gauche sur leur bord gauche — c'est ce qui
 *     permet d'empiler proprement des blocs de tailles différentes.
 */
export function snapBox(box     , others                , distance = SNAP_DISTANCE)             {
  const guides                       = []
  let best = { delta: 0, at: 0, distance: Infinity }

  const consider = (mine        , theirs        ) => {
    const gap = Math.abs(theirs - mine)
    if (gap <= distance && gap < best.distance) {
      best = { delta: theirs - mine, at: theirs, distance: gap }
    }
  }

  // Axe horizontal.
  for (const other of others) {
    consider(box.x, other.x + other.w) // jointure à droite du voisin
    consider(box.x + box.w, other.x) // jointure à gauche du voisin
    consider(box.x, other.x) // alignement des bords gauches
    consider(box.x + box.w, other.x + other.w) // alignement des bords droits
  }
  const x = best.distance < Infinity ? box.x + best.delta : box.x
  if (best.distance < Infinity) guides.push({ axis: "x", at: best.at })

  // Axe vertical, indépendant : on peut s'aimanter sur un seul des deux.
  best = { delta: 0, at: 0, distance: Infinity }
  for (const other of others) {
    consider(box.y, other.y + other.h)
    consider(box.y + box.h, other.y)
    consider(box.y, other.y)
    consider(box.y + box.h, other.y + other.h)
  }
  const y = best.distance < Infinity ? box.y + best.delta : box.y
  if (best.distance < Infinity) guides.push({ axis: "y", at: best.at })

  return { box: { ...box, x, y }, guides }
}

/**
 * Aimante une seule coordonnée sur un jeu d'arêtes.
 *
 * C'est l'aimantation du **redimensionnement** : on ne déplace pas une boîte,
 * on tire une arête, et cette arête doit pouvoir se poser exactement sur celle
 * d'un voisin. Sans cela, aligner deux blocs par la taille relevait de
 * l'adresse à la souris, alors que les aligner par le déplacement était assisté
 * — une incohérence que rien ne justifiait.
 */
export function snapValue(
  value        ,
  candidates                   ,
  distance = SNAP_DISTANCE,
)                                          {
  let best = { value, guide: null                 , distance: Infinity }
  for (const candidate of candidates) {
    const gap = Math.abs(candidate - value)
    if (gap <= distance && gap < best.distance) {
      best = { value: candidate, guide: candidate, distance: gap }
    }
  }
  return { value: best.value, guide: best.guide }
}

/** Toutes les arêtes d'un axe, pour servir de cibles d'aimantation. */
export function edgesOn(boxes                , axis           )           {
  const start = axis === "x" ? (b     ) => b.x : (b     ) => b.y
  const size = axis === "x" ? (b     ) => b.w : (b     ) => b.h
  return boxes.flatMap((box) => [start(box), start(box) + size(box)])
}

/** Tolérance d'accrochage entre deux arêtes, pour le couplage. */
export const TOUCH_TOLERANCE = 1.5
/** Recouvrement perpendiculaire minimal pour considérer deux blocs voisins. */
export const MIN_OVERLAP = 8

function overlaps(aStart        , aSize        , bStart        , bSize        )          {
  return Math.min(aStart + aSize, bStart + bSize) - Math.max(aStart, bStart) >= MIN_OVERLAP
}

/** Voisins accrochés à une arête donnée. */
export function neighborsOn                                (
  box     ,
  others              ,
  edge      ,
)      {
  return others.filter((other) => {
    switch (edge) {
      case "e":
        return (
          Math.abs(other.x - (box.x + box.w)) <= TOUCH_TOLERANCE &&
          overlaps(box.y, box.h, other.y, other.h)
        )
      case "w":
        return (
          Math.abs(other.x + other.w - box.x) <= TOUCH_TOLERANCE &&
          overlaps(box.y, box.h, other.y, other.h)
        )
      case "s":
        return (
          Math.abs(other.y - (box.y + box.h)) <= TOUCH_TOLERANCE &&
          overlaps(box.x, box.w, other.x, other.w)
        )
      case "n":
        return (
          Math.abs(other.y + other.h - box.y) <= TOUCH_TOLERANCE &&
          overlaps(box.x, box.w, other.x, other.w)
        )
      default:
        return false
    }
  })
}

/**
 * Redimensionne un bloc en entraînant ses voisins accrochés.
 *
 * C'est le comportement de séparateur : tirer un filet partagé déplace le
 * filet, pas seulement un côté. Sans cela, redimensionner un bloc d'une
 * mosaïque y ouvre un trou ou provoque un recouvrement.
 *
 * Le déplacement est borné par le voisin le plus contraint : si l'un d'eux
 * atteint sa taille minimale, l'arête bute pour tout le monde.
 */
export function resizeCoupled                                (
  boxes              ,
  id        ,
  edge      ,
  delta                          ,
  min                          ,
  coupled = true,
)                   {
  const target = boxes.find((box) => box.id === id)
  const result = new Map             ()
  if (!target) return result

  // On traite chaque axe séparément : un coin en active simplement deux d'un
  // coup, ce qui vaut pour les quatre coins sans cas particulier.
  const horizontal = horizontalOf(edge)
  const vertical = verticalOf(edge)
  if (horizontal) applyAxis(boxes, target, horizontal, delta.x, min, coupled, result, "x")
  if (vertical) applyAxis(boxes, target, vertical, delta.y, min, coupled, result, "y")
  return result
}

function applyAxis                                (
  boxes              ,
  target   ,
  edge      ,
  raw        ,
  min                          ,
  coupled         ,
  result                  ,
  axis           ,
)       {
  const sizeKey = axis === "x" ? "w" : "h"
  const posKey = axis
  const minSize = axis === "x" ? min.w : min.h
  const growing = edge === "e" || edge === "s"

  const others = boxes.filter((box) => box.id !== target.id)
  const neighbors = coupled ? neighborsOn(target, others, edge) : []

  // Bornes : la cible ne descend pas sous son minimum, et aucun voisin
  // entraîné non plus. Une borne ARRÊTE un mouvement, elle n'en provoque
  // jamais : un bloc déjà sous le minimum (les sections de machine y sont de
  // droit) ne peut plus rétrécir, mais rien ne le fait sauter à la borne.
  let delta = raw
  const targetLimit = growing
    ? Math.min(0, minSize - target[sizeKey])
    : Math.max(0, target[sizeKey] - minSize)
  if (growing) delta = Math.max(delta, targetLimit)
  else delta = Math.min(delta, targetLimit)

  for (const neighbor of neighbors) {
    // Le voisin perd ce que la cible gagne, et réciproquement.
    const room = Math.max(0, neighbor[sizeKey] - minSize)
    if (growing) delta = Math.min(delta, room)
    else delta = Math.max(delta, -room)
  }

  const current = (id        , base     ) => result.get(id) ?? { ...base }

  const next = current(target.id, target)
  if (edge === "e" || edge === "s") {
    next[sizeKey] = target[sizeKey] + delta
  } else {
    next[sizeKey] = target[sizeKey] - delta
    next[posKey] = target[posKey] + delta
  }
  result.set(target.id, next)

  for (const neighbor of neighbors) {
    const moved = current(neighbor.id, neighbor)
    if (edge === "e") {
      moved[posKey] = neighbor[posKey] + delta
      moved[sizeKey] = neighbor[sizeKey] - delta
    } else if (edge === "w") {
      moved[sizeKey] = neighbor[sizeKey] + delta
    } else if (edge === "s") {
      moved[posKey] = neighbor[posKey] + delta
      moved[sizeKey] = neighbor[sizeKey] - delta
    } else {
      moved[sizeKey] = neighbor[sizeKey] + delta
    }
    result.set(neighbor.id, moved)
  }
}

                          
                 
                                             
            
                                                                                        
                  
                                                                                       
                 
 

/**
 * Le séparateur auquel appartient une arête, ou `null` si ce n'en est pas un.
 *
 * Dans un groupe, il n'y a plus de bloc qu'on redimensionne : il n'y a que des
 * **panneaux séparés par des lignes**. Un groupe est une partition de son
 * rectangle, et cette propriété doit tenir après chaque geste — sinon on obtient
 * un trou au milieu, ce qui n'a aucun sens pour un assemblage.
 *
 * Une ligne n'est un séparateur que si elle **traverse** le groupe de part en
 * part : dès qu'un bloc l'enjambe, la déplacer déchirerait ce bloc ou ouvrirait
 * un jour. C'est exactement la condition qu'on vérifie ici, et c'est ce qui rend
 * le trou impossible plutôt que simplement découragé.
 *
 * Les dispositions que produisent `arrangeGroup` (grille) et `packGroup`
 * (coupes guillotine) satisfont toutes deux cette condition sur chacune de leurs
 * arêtes intérieures.
 */
export function dividerAt(
  boxes                                   ,
  axis           ,
  at        ,
  tolerance = TOUCH_TOLERANCE,
)                 {
  const start = axis === "x" ? (b     ) => b.x : (b     ) => b.y
  const size = axis === "x" ? (b     ) => b.w : (b     ) => b.h

  const before           = []
  const after           = []
  for (const box of boxes) {
    const from = start(box)
    const to = from + size(box)
    if (Math.abs(to - at) <= tolerance) before.push(box.id)
    else if (Math.abs(from - at) <= tolerance) after.push(box.id)
    // Un bloc à cheval : la ligne n'est pas un séparateur, c'est un bord interne
    // partiel. La déplacer casserait la partition.
    else if (from < at - tolerance && to > at + tolerance) return null
  }

  if (before.length === 0 || after.length === 0) return null
  return { axis, at, before, after }
}

/**
 * Déplace un séparateur : ce que les panneaux d'un côté cèdent, ceux d'en face
 * le prennent. Aucun jour, aucun recouvrement, jamais.
 *
 * Le déplacement est borné par le panneau le plus contraint des deux côtés : dès
 * que l'un atteint sa taille minimale, la ligne bute pour tout le monde.
 */
export function moveDivider(
  boxes                                   ,
  divider         ,
  delta        ,
  min                          ,
)                   {
  const sizeKey = divider.axis === "x" ? "w" : "h"
  const posKey = divider.axis
  const minSize = divider.axis === "x" ? min.w : min.h
  const byId = new Map(boxes.map((box) => [box.id, box]))

  // Même principe que le couplage : la borne arrête, elle ne provoque pas.
  // Un panneau déjà sous le minimum fige le séparateur de son côté au lieu
  // de le faire sauter pour se remettre à la borne.
  let bounded = delta
  for (const id of divider.before) {
    const box = byId.get(id)
    if (box) bounded = Math.max(bounded, Math.min(0, minSize - box[sizeKey]))
  }
  for (const id of divider.after) {
    const box = byId.get(id)
    if (box) bounded = Math.min(bounded, Math.max(0, box[sizeKey] - minSize))
  }

  const result = new Map             ()
  for (const id of divider.before) {
    const box = byId.get(id)
    if (box) result.set(id, { ...box, [sizeKey]: box[sizeKey] + bounded })
  }
  for (const id of divider.after) {
    const box = byId.get(id)
    if (box) {
      result.set(id, {
        ...box,
        [posKey]: box[posKey] + bounded,
        [sizeKey]: box[sizeKey] - bounded,
      })
    }
  }
  return result
}

/** Rectangle englobant d'un ensemble de boîtes. */
export function boundsOf(boxes                )      {
  if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  const left = Math.min(...boxes.map((b) => b.x))
  const top = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.w))
  const bottom = Math.max(...boxes.map((b) => b.y + b.h))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/** Regroupe des coordonnées proches en une seule ligne de grille. */
function clusterLines(values                   , tolerance        )           {
  const sorted = [...values].sort((a, b) => a - b)
  const lines           = []
  for (const value of sorted) {
    const last = lines[lines.length - 1]
    if (last === undefined || value - last > tolerance) lines.push(value)
    else lines[lines.length - 1] = (last + value) / 2
  }
  return lines
}

function nearest(lines                   , value        )         {
  let best = value
  let distance = Infinity
  for (const line of lines) {
    const gap = Math.abs(line - value)
    if (gap < distance) {
      distance = gap
      best = line
    }
  }
  return best
}

/**
 * Range une sélection en rectangle parfait.
 *
 * On ne réinvente pas la disposition : on **redresse** celle que l'utilisateur
 * a construite. Les arêtes voisines sont fusionnées en lignes de grille, chaque
 * bloc s'y accroche, puis la grille est étirée pour remplir exactement le
 * rectangle englobant. Les proportions relatives et les positions relatives
 * sont donc conservées — c'est ce qui rend le geste prévisible.
 */
export function arrangeGroup                                (
  boxes              ,
  tolerance = 24,
)                   {
  const result = new Map             ()
  if (boxes.length === 0) return result

  const bounds = boundsOf(boxes)
  const xLines = clusterLines(boxes.flatMap((b) => [b.x, b.x + b.w]), tolerance)
  const yLines = clusterLines(boxes.flatMap((b) => [b.y, b.y + b.h]), tolerance)

  // Chaque bloc s'accroche aux lignes les plus proches.
  const snapped = boxes.map((box) => {
    const left = nearest(xLines, box.x)
    const right = nearest(xLines, box.x + box.w)
    const top = nearest(yLines, box.y)
    const bottom = nearest(yLines, box.y + box.h)
    return {
      id: box.id,
      x: left,
      y: top,
      // Une ligne dégénérée (bloc écrasé sur une seule ligne) garderait une
      // taille nulle : on retombe alors sur la taille d'origine.
      w: right > left ? right - left : box.w,
      h: bottom > top ? bottom - top : box.h,
    }
  })

  // Puis on étire l'ensemble pour remplir exactement le rectangle de départ :
  // le rangement ne doit ni déplacer ni rétrécir le groupe dans son ensemble.
  const after = boundsOf(snapped)
  const scaleX = after.w > 0 ? bounds.w / after.w : 1
  const scaleY = after.h > 0 ? bounds.h / after.h : 1

  for (const box of snapped) {
    result.set(box.id, {
      x: bounds.x + (box.x - after.x) * scaleX,
      y: bounds.y + (box.y - after.y) * scaleY,
      w: box.w * scaleX,
      h: box.h * scaleY,
    })
  }
  return result
}

/**
 * Remet un ensemble à l'échelle d'un nouveau rectangle.
 *
 * Proportionnel : chaque bloc garde sa part relative du groupe. C'est ce qui
 * fait qu'un groupe redimensionné par ses arêtes reste « le même », en plus
 * grand — et que chaque bloc traverse ses propres seuils de forme au passage.
 */
export function scaleGroup                                (
  boxes              ,
  from     ,
  to     ,
  min                          ,
)                   {
  const result = new Map             ()
  const scaleX = from.w > 0 ? to.w / from.w : 1
  const scaleY = from.h > 0 ? to.h / from.h : 1

  for (const box of boxes) {
    result.set(box.id, {
      x: to.x + (box.x - from.x) * scaleX,
      y: to.y + (box.y - from.y) * scaleY,
      w: Math.max(min.w, box.w * scaleX),
      h: Math.max(min.h, box.h * scaleY),
    })
  }
  return result
}

/**
 * Écarte les blocs qui se recouvrent, au plus court, sans changer leur ordre.
 *
 * L'utilisateur a le droit d'empiler des blocs sur le canvas — c'est même un
 * geste voulu. Mais un rangement ne sait rien faire d'une pile : deux blocs
 * superposés donneraient deux cases confondues, donc un groupe incohérent. On
 * commence par les décoller, chaque paire se séparant le long de l'axe où le
 * chevauchement est le plus court, celui des deux dont le centre est le plus
 * loin cédant le passage. L'ordre relatif des centres est ainsi préservé.
 */
export function separateBoxes                                (
  boxes              ,
)                   {
  const list = boxes.map((box) => ({ id: box.id, x: box.x, y: box.y, w: box.w, h: box.h }))
  for (let pass = 0; pass < 64; pass++) {
    let moved = false
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i] 
        const b = list[j] 
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (ox <= 0.01 || oy <= 0.01) continue
        moved = true
        if (ox <= oy) {
          if (a.x + a.w / 2 <= b.x + b.w / 2) b.x += ox
          else a.x += ox
        } else {
          if (a.y + a.h / 2 <= b.y + b.h / 2) b.y += oy
          else a.y += oy
        }
      }
    }
    if (!moved) break
  }
  return new Map(list.map((box) => [box.id, { x: box.x, y: box.y, w: box.w, h: box.h }]))
}

/**
 * Tous les séparateurs d'un groupe : les lignes intérieures qui le traversent.
 *
 * C'est ce que l'interface matérialise en poignées — une barre par ligne, un
 * carré à chaque croisement. Les bords extérieurs n'en font pas partie : eux
 * étirent l'assemblage entier.
 */
export function listDividers                                (boxes              )            {
  if (boxes.length < 2) return []
  const bounds = boundsOf(boxes)
  const out            = []
  for (const axis of ["x", "y"]         ) {
    const start = axis === "x" ? bounds.x : bounds.y
    const end = axis === "x" ? bounds.x + bounds.w : bounds.y + bounds.h
    const raw = edgesOn(boxes, axis)
      .filter((value) => value > start + TOUCH_TOLERANCE && value < end - TOUCH_TOLERANCE)
      .sort((a, b) => a - b)
    const lines           = []
    for (const value of raw) {
      const last = lines[lines.length - 1]
      if (last === undefined || value - last > TOUCH_TOLERANCE) lines.push(value)
    }
    for (const at of lines) {
      const divider = dividerAt(boxes, axis, at)
      if (divider) out.push(divider)
    }
  }
  return out
}

/**
 * Range un groupe **sans jamais toucher à son organisation spatiale**.
 *
 * C'est la règle forte d'ODIO (voir `docs/systeme-de-conception.md`) : la
 * position relative des blocs appartient à l'utilisateur. S'il a mis la réverbe
 * en haut à gauche et le compresseur en bas à droite, c'est sa cartographie
 * mentale — celle-là même que le zoom sémantique sert à consolider — et aucune
 * commande n'a le droit de la rebattre.
 *
 * Le rangement se contente donc de trois choses :
 *   1. **redresser** — les arêtes presque alignées se fondent en une seule
 *      ligne de grille, et chaque bloc s'y accroche ;
 *   2. **resserrer** — les colonnes et rangées que personne n'occupe tombent à
 *      zéro, ce qui referme les jours SANS gonfler quoi que ce soit. Le groupe
 *      rétrécit vers la somme de ses blocs au lieu de s'étaler sur leur
 *      rectangle englobant ;
 *   3. **combler** — une cellule laissée vide est absorbée par un voisin, pour
 *      que le groupe soit un rectangle plein.
 *
 * Aucune de ces trois étapes ne réordonne : un bloc reste dans la même case de
 * la grille, donc au même endroit de la carte.
 */
export function tidyGroup                                (
  boxes              ,
  tolerance = 24,
)                   {
  if (boxes.length === 0) return new Map()
  if (boxes.length === 1) {
    const only = boxes[0] 
    return new Map([[only.id, { x: only.x, y: only.y, w: only.w, h: only.h }]])
  }

  // Des blocs empilés donneraient des cases confondues : on les décolle d'abord.
  const separated = separateBoxes(boxes)
  const clean = boxes.map((box) => ({ id: box.id, ...separated.get(box.id)  }))

  // La fusion des arêtes proches peut, sur une disposition tordue, produire des
  // cases qui se recouvrent. On l'attrape et on resserre la tolérance jusqu'à
  // ce que le résultat soit une vraie partition — à tolérance nulle, les arêtes
  // sont exactes et des blocs disjoints donnent des cases disjointes.
  for (let tol = tolerance; tol >= 0.5; tol /= 2) {
    const attempt = tidyPass(clean, tol)
    if (isPartition([...attempt.values()])) return attempt
  }
  return tidyPass(clean, 0.01)
}

/** Vrai si aucune boîte n'en recouvre une autre (au demi-pixel près). */
function isPartition(boxes                )          {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i] 
      const shrunk = { x: a.x + 0.5, y: a.y + 0.5, w: a.w - 1, h: a.h - 1 }
      if (shrunk.w > 0 && shrunk.h > 0 && intersects(shrunk, boxes[j] )) return false
    }
  }
  return true
}

function tidyPass                                (
  boxes              ,
  tolerance        ,
)                   {
  const result = new Map             ()

  const bounds = boundsOf(boxes)
  const xLines = clusterLines(boxes.flatMap((b) => [b.x, b.x + b.w]), tolerance)
  const yLines = clusterLines(boxes.flatMap((b) => [b.y, b.y + b.h]), tolerance)

  const indexOf = (lines                   , value        ) => {
    let best = 0
    let distance = Infinity
    lines.forEach((line, index) => {
      const gap = Math.abs(line - value)
      if (gap < distance) {
        distance = gap
        best = index
      }
    })
    return best
  }

  // Chaque bloc devient une plage de cellules. C'est cette plage — et elle
  // seule — qui définit sa place ; on ne la réordonnera jamais.
  const cells = boxes.map((box) => {
    const i0 = indexOf(xLines, box.x)
    const j0 = indexOf(yLines, box.y)
    return {
      id: box.id,
      i0,
      i1: Math.max(i0 + 1, indexOf(xLines, box.x + box.w)),
      j0,
      j1: Math.max(j0 + 1, indexOf(yLines, box.y + box.h)),
    }
  })

  const columns = Math.max(1, xLines.length - 1)
  const rows = Math.max(1, yLines.length - 1)
  const covered = (i        , j        ) =>
    cells.some((c) => c.i0 <= i && i < c.i1 && c.j0 <= j && j < c.j1)

  // Étape 2 — les pistes que personne n'occupe tombent à zéro.
  const liveColumn = Array.from({ length: columns }, (_, i) =>
    cells.some((c) => c.i0 <= i && i < c.i1),
  )
  const liveRow = Array.from({ length: rows }, (_, j) => cells.some((c) => c.j0 <= j && j < c.j1))

  // Étape 3 — chaque cellule vivante mais vide est absorbée par un voisin. On
  // essaie la gauche, puis le haut, puis la droite, puis le bas : le premier
  // qui peut s'étendre sur TOUTE sa hauteur (ou sa largeur) l'emporte.
  for (let pass = 0; pass < columns * rows; pass++) {
    let filled = false
    for (let i = 0; i < columns && !filled; i++) {
      for (let j = 0; j < rows && !filled; j++) {
        if (!liveColumn[i] || !liveRow[j] || covered(i, j)) continue
        // Un bloc peut s'étendre sur une plage libre — ses PROPRES cellules ne
        // comptant évidemment pas comme occupées. L'oublier bloquait toute
        // extension d'un bloc large, et laissait le trou qu'on cherche à combler.
        const free = (c                        , di        , dj        ) => {
          for (let x = c.i0 + di; x < c.i1 + di; x++) {
            for (let y = c.j0 + dj; y < c.j1 + dj; y++) {
              if (x < 0 || x >= columns || y < 0 || y >= rows) return false
              const own = c.i0 <= x && x < c.i1 && c.j0 <= y && y < c.j1
              if (!own && covered(x, y)) return false
            }
          }
          return true
        }
        const left = cells.find((c) => c.i1 === i && c.j0 <= j && j < c.j1 && free(c, 1, 0))
        if (left) {
          left.i1 += 1
          filled = true
          break
        }
        const above = cells.find((c) => c.j1 === j && c.i0 <= i && i < c.i1 && free(c, 0, 1))
        if (above) {
          above.j1 += 1
          filled = true
          break
        }
        const right = cells.find((c) => c.i0 === i + 1 && c.j0 <= j && j < c.j1 && free(c, -1, 0))
        if (right) {
          right.i0 -= 1
          filled = true
          break
        }
        const below = cells.find((c) => c.j0 === j + 1 && c.i0 <= i && i < c.i1 && free(c, 0, -1))
        if (below) {
          below.j0 -= 1
          filled = true
          break
        }
      }
    }
    if (!filled) break
  }

  // Largeurs des pistes : celles d'origine, ou zéro si personne ne les occupe.
  // On ne redistribue rien — c'est ce qui garde les blocs à leur taille.
  const widths = Array.from({ length: columns }, (_, i) =>
    cells.some((c) => c.i0 <= i && i < c.i1) ? Math.max(0, xLines[i + 1]  - xLines[i] ) : 0,
  )
  const heights = Array.from({ length: rows }, (_, j) =>
    cells.some((c) => c.j0 <= j && j < c.j1) ? Math.max(0, yLines[j + 1]  - yLines[j] ) : 0,
  )

  const xAt = [bounds.x]
  for (const width of widths) xAt.push(xAt[xAt.length - 1]  + width)
  const yAt = [bounds.y]
  for (const height of heights) yAt.push(yAt[yAt.length - 1]  + height)

  for (const cell of cells) {
    result.set(cell.id, {
      x: xAt[cell.i0] ,
      y: yAt[cell.j0] ,
      w: xAt[cell.i1]  - xAt[cell.i0] ,
      h: yAt[cell.j1]  - yAt[cell.j0] ,
    })
  }
  return result
}

/** Vrai si deux boîtes se recouvrent, ne serait-ce que d'un pixel. */
export function intersects(a     , b     )          {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** Normalise un rectangle tracé dans n'importe quel sens. */
export function rectFrom(ax        , ay        , bx        , by        )      {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax),
    h: Math.abs(by - ay),
  }
}
