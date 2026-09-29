// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/tile/shape.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Règles de forme et remplissage par emplacements.
 *
 * C'est le mécanisme qui remplace les quatre paliers en dur du prototype :
 * un bloc déclare, pour chacune des trois classes de forme, une liste
 * ordonnée d'emplacements ; le rendu parcourt la liste et s'arrête dès que le
 * suivant ne rentre plus. Les paliers deviennent une conséquence, pas une
 * table de seuils.
 *
 * Tout est pur et sans DOM : c'est la partie de l'interface qu'on peut
 * vérifier sans navigateur, et elle porte la règle de recette n° 4 du
 * handoff — une tuile étirée en largeur puis en hauteur, à surface égale, ne
 * doit pas montrer le même contenu.
 */

import { getTuning } from "../design/tuning.js"

/** Classe de forme, déduite du rapport largeur / hauteur apparent. */
                                                     

                       
            
                                                                                      
                               
                                                                     
                
     
                                                                          
                                                                         
                                                                           
                                                                          
     
              
     
                                                          
    
                                                                               
                                                                              
                                                                          
                                                                             
                                                                            
     
                   
     
                                                                        
    
                                                                         
                                                                             
                                                                         
                                                                           
                                                       
    
                                                                           
                                                                          
                                                                   
     
                 
 

                                               

                               
            
                                         
                
 

/**
 * Seuils de forme. La spec proposait 2,2 et 0,55 comme « points de départ
 * mesurés » ; l'essai a montré que 0,55 est trop strict — une tuile deux fois
 * plus haute que large (ratio 0,57) se lit à l'évidence comme une colonne, mais
 * restait en pavé et laissait un grand vide sous ses lignes.
 */
export const BAND_RATIO = 2.2
export const COLUMN_RATIO = 0.7

export function shapeOf(width        , height        )             {
  if (height <= 0) return "bande"
  const ratio = width / height
  // Les seuils viennent du magasin de réglages : les constantes exportées n'en
  // sont que les valeurs par défaut, et le panneau « seuils » les fait varier.
  const t = getTuning()
  if (ratio > t.bandRatio) return "bande"
  if (ratio < t.columnRatio) return "colonne"
  return "pave"
}

/**
 * Attribue une hauteur à chaque emplacement qui rentre.
 *
 * 1. on écarte ceux qui sont trop à l'étroit en largeur ;
 * 2. on cumule les hauteurs minimales dans l'ordre, en s'arrêtant net dès que
 *    le suivant déborde — jamais de compression sous le minimum déclaré,
 *    mieux vaut retirer un emplacement que le rendre illisible ;
 * 3. la place restante va aux emplacements `grow`, à parts égales.
 */
export function resolveSlots(
  slots                 ,
  available                          ,
  gap = 0,
)                 {
  const accepted         = []
  const minimum = new Map                ()
  let used = 0

  const minHeightOf = (slot      ) =>
    Math.max(
      slot.min.h,
      slot.minRatio ? available.h * slot.minRatio : 0,
      // La proportion propre se plafonne à la hauteur offerte — et elle SEULE.
      // Sans ce plafond, une tuile basse rejetterait un planogramme qui y tient
      // parfaitement. Avec un plafond posé sur tout le calcul, au contraire, un
      // minimum déclaré ne pourrait plus jamais faire céder son emplacement :
      // c'est la règle « rien ne s'affiche si le premier n'entre pas » qui
      // tombait, et un test l'a rattrapée.
      slot.aspect ? Math.min(available.h, available.w * slot.aspect) : 0,
    )

  for (const slot of slots) {
    if (slot.min.w > available.w) continue
    // L'espacement entre deux emplacements se réserve ici. L'oublier ferait
    // déborder le dernier hors de la tuile — et un texte coupé est le défaut
    // que la recette n° 2 interdit formellement.
    const height = minHeightOf(slot)
    const needed = used + (accepted.length > 0 ? gap : 0) + height
    if (needed > available.h) break
    accepted.push(slot)
    minimum.set(slot.id, height)
    used = needed
  }

  // Répartition de la place restante, en plusieurs passes : un emplacement qui
  // atteint son plafond rend le surplus aux autres.
  const heights = new Map(accepted.map((slot) => [slot.id, minimum.get(slot.id) ?? slot.min.h]))
  let spare = Math.max(0, available.h - used)
  let growing = accepted.filter((slot) => slot.grow)

  while (spare > 0.01 && growing.length > 0) {
    const share = spare / growing.length
    let consumed = 0
    const next         = []
    for (const slot of growing) {
      const current = heights.get(slot.id) ?? minimum.get(slot.id) ?? slot.min.h
      const ceiling = slot.max ?? Number.POSITIVE_INFINITY
      const grown = Math.min(ceiling, current + share)
      consumed += grown - current
      heights.set(slot.id, grown)
      if (grown < ceiling) next.push(slot)
    }
    spare -= consumed
    if (consumed <= 0.01) break
    growing = next
  }

  return accepted.map((slot) => ({
    id: slot.id,
    height: heights.get(slot.id) ?? minimum.get(slot.id) ?? slot.min.h,
  }))
}

/**
 * Rembourrage proportionnel à la tuile.
 *
 * Une marge fixe de 9px est juste à taille normale et absurde une fois
 * dézoomé : elle mange alors la moitié de la surface utile, et la zone
 * manipulable — celle qui compte — devient minuscule. Elle doit rétrécir avec
 * la tuile.
 */
export function tilePadding(width        , height        )         {
  // Moitié moins qu'avant : la marge d'origine mangeait une place que le
  // contenu réclame, surtout au dézoom où chaque pixel compte. Le filet de la
  // tuile suffit à séparer le corps de son voisin, un blanc généreux n'y ajoute
  // rien.
  const t = getTuning()
  return Math.round(Math.min(t.padMax, Math.max(1, Math.min(width, height) * t.padShare)))
}

/** Boîte en coordonnées monde, en pixels flottants. */
                      
           
           
           
           
 

/** Tolérance d'accrochage entre deux arêtes, en px monde (spec §1). */
export const SNAP_TOLERANCE = 1
/** Recouvrement perpendiculaire minimal pour considérer deux tuiles voisines. */
export const MIN_OVERLAP = 8

/** Vraie si les deux segments se recouvrent d'au moins `minOverlap`. */
function overlaps(aStart        , aSize        , bStart        , bSize        , minOverlap        )          {
  return Math.min(aStart + aSize, bStart + bSize) - Math.max(aStart, bStart) >= minOverlap
}

/**
 * Filets partagés : une tuile ne dessine son filet droit que si aucune voisine
 * n'est collée à cette arête. Deux tuiles adjacentes partagent ainsi un seul
 * trait de 1px, au lieu d'en empiler deux.
 *
 * Le critère d'accrochage est celui de la spec §1 — arête opposée à moins de
 * 1px monde, et recouvrement perpendiculaire d'au moins 8px monde. Il vaut
 * pour des coordonnées flottantes, donc après un redimensionnement libre.
 */
export function sharedBorders(box     , others                )                                      {
  const hasRight = others.some(
    (o) =>
      Math.abs(o.x - (box.x + box.w)) <= SNAP_TOLERANCE &&
      overlaps(box.y, box.h, o.y, o.h, MIN_OVERLAP),
  )
  const hasBottom = others.some(
    (o) =>
      Math.abs(o.y - (box.y + box.h)) <= SNAP_TOLERANCE &&
      overlaps(box.x, box.w, o.x, o.w, MIN_OVERLAP),
  )
  return { right: !hasRight, bottom: !hasBottom }
}

/** Taille minimale d'une tuile en px monde (spec §1). */
export const MIN_TILE = { w: 64, h: 40 }

/** Hauteur nominale de l'en-tête, telle que fixée par le handoff. */
export const HEADER_HEIGHT = 23
/**
 * Plancher de l'en-tête : de quoi loger le nom à sa taille nominale, et pas
 * moins — c'est aussi la seule surface par laquelle on saisit une tuile.
 */
export const MIN_HEADER = 13

/**
 * Hauteur de l'en-tête.
 *
 * Le zoom sémantique vaut pour la coque autant que pour le contenu. À 23px fixes
 * une tuile de 44px consacrait plus de la moitié de sa surface à sa barre de
 * titre — exactement le blanc qu'on reproche au reste de l'interface. L'en-tête
 * se resserre donc quand la tuile devient petite, sans jamais descendre sous le
 * corps de son propre texte, et retrouve ses 23px du handoff dès 82px de haut,
 * c'est-à-dire bien avant l'échelle nominale.
 */
export function headerHeight(height        )         {
  const t = getTuning()
  return Math.max(MIN_HEADER, Math.min(t.headerMax, Math.round(height * t.headerShare)))
}

/**
 * Boîte réellement offerte au contenu d'une tuile.
 *
 * Les filets sont **à l'intérieur** de la tuile (`box-sizing: border-box`), et
 * leur nombre dépend du voisinage : deux tuiles accolées ne dessinent qu'un seul
 * filet entre elles. Une tuile de 52,8px n'offre donc que 50,8px à son corps.
 *
 * Ce calcul est partagé avec la coque parce que les deux DOIVENT tomber juste :
 * le corps décidait ses corps de police sur la largeur brute, croyait avoir 2px
 * de plus qu'en réalité, et débordait d'autant sur les mots les plus longs.
 */
export function tileBody(
  rect                          ,
  borders                                     ,
)                                         {
  const w = Math.max(0, rect.w - 1 - (borders.right ? 1 : 0))
  const outer = Math.max(0, rect.h - 1 - (borders.bottom ? 1 : 0))
  const head = Math.min(outer, headerHeight(outer))
  return { w, h: outer - head, head }
}
