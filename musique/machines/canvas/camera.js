// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/canvas/camera.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Caméra du canvas — mathématiques pures.
 *
 * La projection se fait en JS, jamais par `transform: scale()`. C'est la
 * contrainte technique du handoff, et elle est structurante : le texte doit
 * garder sa taille à l'écran et les filets rester à 1px physique quel que
 * soit le zoom. Un `scale()` grossirait tout, y compris ce qui ne doit pas
 * grossir.
 */

                         
           
           
           
 

/**
 * Butée absolue de la caméra.
 *
 * Basse, et volontairement : le plancher de LISIBILITÉ (voir `clampK`) dit à
 * quel moment le zoom sémantique a fini de dégrader, mais il n'a plus à
 * empêcher de reculer. On veut pouvoir prendre du champ sur une grande scène
 * sans que ça change quoi que ce soit aux blocs — sous le plancher, ils ne
 * dégradent plus, ils rapetissent, ce qui est exactement ce qu'on demande à un
 * dézoom. `MIN_K` n'est plus qu'un garde-fou contre le zéro.
 */
export const MIN_K = 0.05

/**
 * De combien on peut reculer SOUS le plancher de lisibilité.
 *
 * Le plancher est le point où le zoom sémantique a fini son travail : au-delà,
 * les blocs ne dégradent plus, ils rapetissent en bloc. On veut pouvoir prendre
 * du champ — mais pas jusqu'à l'invisible. Trois fois, c'est assez pour voir
 * une grande scène d'un coup d'œil, et pas assez pour perdre ce qu'on regarde.
 * `MIN_K` reste la butée absolue, contre le zéro.
 */
export const RECUL_SOUS_PLANCHER = 3

/** La butée de dézoom effective, plancher de lisibilité donné. */
export function plancherCamera(floor        )         {
  return Math.max(MIN_K, floor / RECUL_SOUS_PLANCHER)
}
export const MAX_K = 2.8

/**
 * @param floor échelle plancher calculée sur le contenu (cf. `tile/legible`).
 *   C'est le seuil SÉMANTIQUE : en deçà, les tuiles ne montrent plus ni nom de
 *   bloc, ni nom de paramètre, ni valeur, et le zoom sémantique a fini son
 *   travail. Passer `MIN_K` laisse la caméra reculer au-delà — les blocs ne
 *   dégradent alors plus, ils rapetissent, et on voit enfin l'ensemble.
 */
export function clampK(k        , floor = MIN_K)         {
  return Math.min(MAX_K, Math.max(Math.max(MIN_K, floor), k))
}

/** Monde → écran. */
export function project(world        , cam        , k        )         {
  return (world - cam) * k
}

/** Écran → monde. */
export function unproject(screen        , cam        , k        )         {
  return screen / k + cam
}

/**
 * Zoom molette ancré sous le curseur : le point visé ne bouge pas.
 *
 * @param mx,my position du curseur en px écran, relative au canvas
 */
export function zoomAt(
  cam        ,
  deltaY        ,
  mx        ,
  my        ,
  floor = MIN_K,
)         {
  const k = clampK(cam.k * Math.pow(0.9988, deltaY), floor)
  // On résout pour que (mx,my) désigne le même point du monde avant et après.
  return {
    k,
    x: cam.x + mx / cam.k - mx / k,
    y: cam.y + my / cam.k - my / k,
  }
}

/**
 * Aligne une boîte projetée sur la grille de pixels **physiques**.
 *
 * Sans cela, une tuile atterrit à `x = 244,77` : son filet de 1px se répartit
 * alors sur deux pixels à 23% et 77%, et un trait franc devient deux gris. Le
 * texte souffre du même mal — Chromium positionne les glyphes au sous-pixel, si
 * bien qu'une même étiquette se rasterise différemment, et moins bien, selon
 * l'endroit où elle tombe. C'est la cause principale d'un rendu « mou », et
 * aucun moteur de rendu, si bon soit-il, ne la corrige : il faut lui donner des
 * coordonnées entières.
 *
 * On aligne les ARÊTES, pas la position et la taille séparément : deux tuiles
 * accolées gardent ainsi exactement la même frontière, sans jour ni recouvrement.
 */
export function snapToPixels(
  box                                                ,
  dpr = 1,
)                                                 {
  const grid = dpr > 0 ? dpr : 1
  const left = Math.round(box.x * grid) / grid
  const top = Math.round(box.y * grid) / grid
  const right = Math.round((box.x + box.w) * grid) / grid
  const bottom = Math.round((box.y + box.h) * grid) / grid
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/**
 * Décalage à appliquer pour qu'un trait de 1px CSS tombe pile sur des pixels
 * physiques, au lieu d'être à cheval sur deux.
 *
 * Un trait de largeur 1 CSS occupe `dpr` pixels physiques, centré sur la
 * coordonnée demandée. Il faut donc que ce centre tombe au milieu d'un pixel
 * quand `dpr` est impair, et sur une frontière quand il est pair. Pour un `dpr`
 * fractionnaire (125%, 150%) aucun décalage ne rattrape quoi que ce soit : on
 * n'en applique pas.
 */
export function hairlineOffset(dpr = 1)         {
  return Number.isInteger(dpr) && dpr % 2 === 1 ? 0.5 / dpr : 0
}

/** Cadre une boîte monde dans le viewport, avec une marge. */
export function frame(
  box                                                ,
  viewport                          ,
  margin = 40,
)         {
  const k = clampK(
    Math.min((viewport.w - margin * 2) / box.w, (viewport.h - margin * 2) / box.h),
  )
  return {
    k,
    x: box.x + box.w / 2 - viewport.w / 2 / k,
    y: box.y + box.h / 2 - viewport.h / 2 / k,
  }
}
