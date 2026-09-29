// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/interaction/aligner.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Les règles d'alignement du mode composition.
 *
 * Poser des contrôles à la main sans règles, c'est viser au pixel : les bords
 * ne tombent jamais juste et un panneau composé se voit tout de suite. Le
 * canvas a déjà son aimantation (`interaction/layout.ts`, `snapBox`) ; celle-ci
 * en diffère sur trois points, et c'est pourquoi elle vit à part :
 *
 *   1. **Les CENTRES comptent autant que les bords.** Un knob se lit par son
 *      centre — aligner deux knobs de diamètres différents par leur bord
 *      gauche ne veut rien dire, les aligner par leur centre est tout. Le
 *      canvas, lui, assemble des rectangles pleins : il n'a que des bords.
 *   2. **Le cadre est une cible.** Dans un bloc, les bords et le milieu du
 *      panneau sont les repères les plus utiles — centrer un contrôle dans sa
 *      section est le geste le plus fréquent.
 *   3. **Toute prise contre toute prise.** Chaque boîte offre trois prises par
 *      axe — début, milieu, fin — et n'importe laquelle accroche n'importe
 *      quelle autre. La plus proche gagne. C'est ce qui donne gratuitement
 *      l'ADJACENCE : poser mon bord gauche sur ton bord droit, c'est-à-dire
 *      construire une rangée, geste central quand on compose un séquenceur.
 *
 * Pur et sans DOM, comme tout `interaction/` : on le vérifie sans navigateur.
 */

                                       

/** Distance d'accrochage, en px écran. */
export const ALIGN_DISTANCE = 6

/** Une règle affichée pendant le geste — la preuve visuelle de l'accrochage. */
                        
                 
                                                         
            
 

                              
          
                 
 

/** Les trois prises d'une boîte sur un axe : début, milieu, fin. */
function prises(box     , axis           )           {
  const start = axis === "x" ? box.x : box.y
  const size = axis === "x" ? box.w : box.h
  return [start, start + size / 2, start + size]
}

/**
 * Toutes les cibles d'accrochage d'un axe.
 *
 * Le cadre passe en premier : à égalité de distance, se caler sur la section
 * l'emporte sur se caler sur un voisin. C'est le repère le plus stable, et
 * celui qu'on cherche quand on hésite.
 */
export function ciblesDAlignement(
  others                ,
  /** La zone utile : ses bords et son milieu. `x`/`y` valent 0 par défaut. */
  cadre                                                         ,
  axis           ,
)           {
  const out           = []
  if (cadre) {
    const debut = (axis === "x" ? cadre.x : cadre.y) ?? 0
    const taille = axis === "x" ? cadre.w : cadre.h
    out.push(debut, debut + taille / 2, debut + taille)
  }
  for (const other of others) out.push(...prises(other, axis))
  return out
}

/**
 * Aligne une boîte déplacée sur ses voisines et sur le cadre.
 *
 * Les deux axes sont indépendants : on peut s'accrocher horizontalement sans
 * s'accrocher verticalement, ce qui est le cas le plus courant quand on range
 * une colonne de knobs.
 */
export function alignerBoite(
  box     ,
  others                ,
  cadre                                 ,
  distance = ALIGN_DISTANCE,
)              {
  const regles          = []
  let x = box.x
  let y = box.y

  for (const axis of ["x", "y"]         ) {
    const cibles = ciblesDAlignement(others, cadre, axis)
    let best                                                      = null
    for (const mienne of prises(box, axis)) {
      for (const cible of cibles) {
        const ecart = Math.abs(cible - mienne)
        if (ecart > distance) continue
        if (best && ecart >= best.ecart) continue
        best = { delta: cible - mienne, at: cible, ecart }
      }
    }
    if (!best) continue
    if (axis === "x") x += best.delta
    else y += best.delta
    regles.push({ axis, at: best.at })
  }

  return { box: { ...box, x, y }, regles }
}

/**
 * Aligne une arête tirée — le redimensionnement.
 *
 * Rendu séparé du déplacement parce qu'une arête n'a qu'une prise : on ne
 * cherche pas laquelle des trois accrocher, on accroche celle qu'on tient.
 */
export function alignerArete(
  valeur        ,
  cibles                   ,
  distance = ALIGN_DISTANCE,
)                                           {
  let best                                                          = null
  for (const cible of cibles) {
    const ecart = Math.abs(cible - valeur)
    if (ecart > distance) continue
    if (best && ecart >= best.ecart) continue
    best = { valeur: cible, regle: cible, ecart }
  }
  return best ? { valeur: best.valeur, regle: best.regle } : { valeur, regle: null }
}

/** Le rectangle qui englobe un lot de boîtes, ou `null` si le lot est vide. */
export function englobe(boxes                )             {
  if (boxes.length === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const box of boxes) {
    x0 = Math.min(x0, box.x)
    y0 = Math.min(y0, box.y)
    x1 = Math.max(x1, box.x + box.w)
    y1 = Math.max(y1, box.y + box.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Deux boîtes se touchent-elles ? Effleurer suffit — comme la marquee du canvas. */
export function seTouchent(a     , b     )          {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * Met un lot de boîtes à l'échelle d'un rectangle vers un autre.
 *
 * C'est le redimensionnement d'une sélection : chaque membre garde sa place
 * RELATIVE dans le lot. Sans ça, tirer une poignée sur trois knobs les
 * empilerait au lieu de les agrandir ensemble.
 */
export function mettreALEchelle(boxes                , depuis     , vers     )        {
  const kx = depuis.w === 0 ? 1 : vers.w / depuis.w
  const ky = depuis.h === 0 ? 1 : vers.h / depuis.h
  return boxes.map((box) => ({
    x: vers.x + (box.x - depuis.x) * kx,
    y: vers.y + (box.y - depuis.y) * ky,
    w: box.w * kx,
    h: box.h * ky,
  }))
}

/**
 * RANGER un lot de contrôles — « T », et le bloc se remplit au maximum.
 *
 * Ce n'est pas un tassement mais une RÉPARTITION : les éléments trop serrés
 * s'écartent pour occuper toute l'étendue qu'on leur donne, et des éléments
 * trop dispersés se ramènent dedans. Deux distances commandent, et elles ne
 * se négocient pas : la marge au bord (elle est déjà dans l'étendue reçue) et
 * l'écart minimal entre deux voisins.
 *
 * Trois lectures, dans cet ordre :
 *
 *   1. **L'axe se déduit du lot** : plus large que haut, ce sont des rangées ;
 *      plus haut que large, des colonnes. On ne le demande pas.
 *   2. **Les bandes se détectent** : deux contrôles sont du même rang si leurs
 *      centres transverses sont proches à moins d'une demi-épaisseur. C'est la
 *      lecture qu'en fait l'œil, et elle survit à un rang de travers — c'est
 *      même tout l'intérêt de ranger. Sans elle, huit knobs disposés en deux
 *      rangs de quatre se couchaient sur une seule ligne, où ils se
 *      recouvraient.
 *   3. **Tout se répartit** : les bandes sur l'axe transverse, les éléments de
 *      chaque bande le long de l'axe principal, à écarts égaux — jamais moins
 *      que l'écart minimal. Quand le lot ne tient pas dans l'étendue même à
 *      l'écart minimal, celui-ci l'emporte et le lot part du bord : mieux vaut
 *      déborder d'un bloc trop petit que se recouvrir.
 *
 * L'ordre n'est JAMAIS rebattu, et ranger deux fois de suite ne change rien
 * la seconde fois.
 */
export function rangerControles(
  boxes                ,
  etendue      ,
  ecartMin = 0,
)        {
  if (boxes.length < 2) return boxes.map((box) => ({ ...box }))

  const cadre = englobe(boxes)
  if (!cadre) return boxes.map((box) => ({ ...box }))
  const zone = etendue ?? cadre
  const horizontal = zone.w >= zone.h

  // Le long de l'axe principal on répartit ; en travers on regroupe.
  const debut = (b     ) => (horizontal ? b.x : b.y)
  const taille = (b     ) => (horizontal ? b.w : b.h)
  const travers = (b     ) => (horizontal ? b.y + b.h / 2 : b.x + b.w / 2)
  const epaisseur = (b     ) => (horizontal ? b.h : b.w)

  const rangs = boxes
    .map((box, index) => ({ index, box }))
    .sort((a, b) => travers(a.box) - travers(b.box) || debut(a.box) - debut(b.box))

  // ── LES BANDES : un contrôle rejoint la bande courante tant que son centre
  //    transverse en reste à moins d'une demi-épaisseur.
  const bandes                                  = []
  for (const rang of rangs) {
    const bande = bandes[bandes.length - 1]
    const dernier = bande?.[bande.length - 1]
    const seuil = dernier ? Math.max(epaisseur(dernier.box), epaisseur(rang.box)) / 2 : 0
    if (bande && dernier && Math.abs(travers(rang.box) - travers(dernier.box)) <= seuil) {
      bande.push(rang)
    } else {
      bandes.push([rang])
    }
  }
  for (const bande of bandes) bande.sort((a, b) => debut(a.box) - debut(b.box))

  // ── LE REPLI : une bande qui ne tient pas dans l'étendue, même à l'écart
  //    minimal, ne déborde pas et ne se recouvre pas — elle SE PLIE, et son
  //    excédent devient la bande suivante. C'est le geste attendu quand on
  //    rétrécit fort un bloc : la rangée devient deux rangées, comme un texte
  //    passe à la ligne. L'ordre de lecture est conservé à l'identique.
  if (etendue) {
    const place = horizontal ? etendue.w : etendue.h
    for (let i = 0; i < bandes.length; i += 1) {
      const bande = bandes[i] 
      let longueur = 0
      let coupe = bande.length
      for (let j = 0; j < bande.length; j += 1) {
        const l = taille(bande[j] .box)
        const total = longueur + (j > 0 ? ecartMin : 0) + l
        if (j > 0 && total > place + 1e-9) {
          coupe = j
          break
        }
        longueur = total
      }
      if (coupe < bande.length) {
        bandes.splice(i + 1, 0, bande.slice(coupe))
        bandes[i] = bande.slice(0, coupe)
      }
    }

    // ── ET SI LES BANDES ELLES-MÊMES NE TIENNENT PLUS EN TRAVERS, la
    //    structure composée n'est plus tenable : on la REFOND en grille.
    //
    //    Le repli ci-dessus ne réglait que l'axe principal. Huit knobs
    //    composés en deux rangs de quatre, dans un bloc devenu étroit et
    //    haut, deviennent quatre COLONNES de deux — et quatre colonnes ne
    //    tiennent pas dans la largeur. Ils débordaient alors, et la
    //    compression d'affichage les ramenait au contact. La refonte range
    //    tout en lecture, autant par ligne que la place en autorise : c'est
    //    le sens même de « remplir au maximum ».
    const placeTraversante = horizontal ? etendue.h : etendue.w
    const epaisseursDeBande = bandes.map((bande) =>
      Math.max(...bande.map((r) => epaisseur(r.box))),
    )
    const besoin =
      epaisseursDeBande.reduce((total, e) => total + e, 0) +
      ecartMin * Math.max(0, bandes.length - 1)
    if (besoin > placeTraversante + 1e-9) {
      const lecture = bandes.flat()
      const plusGrand = Math.max(...lecture.map((r) => taille(r.box)))
      const tiennent = Math.max(
        1,
        Math.floor((place + ecartMin) / Math.max(1e-6, plusGrand + ecartMin)),
      )
      // ÉQUILIBRER : avec huit éléments et six qui tiennent par ligne, deux
      // lignes suffisent — on fait donc deux lignes de QUATRE, pas six puis
      // deux. Une grille déséquilibrée se lit comme un accident.
      const lignesVoulues = Math.max(1, Math.ceil(lecture.length / tiennent))
      const parLigne = Math.max(1, Math.ceil(lecture.length / lignesVoulues))
      bandes.length = 0
      for (let i = 0; i < lecture.length; i += parLigne) {
        bandes.push(lecture.slice(i, i + parLigne))
      }
    }
  }

  /** Répartit des longueurs sur une étendue : écarts égaux, jamais sous le minimum. */
  const repartir = (longueurs                   , depart        , place        )           => {
    const somme = longueurs.reduce((total, l) => total + l, 0)
    const intervalles = longueurs.length - 1
    // SEUL, on se CENTRE. Il n'y a pas d'écart à répartir, et se coller au
    // bord n'est pas « remplir » : une rangée unique dans un bloc devenu haut
    // restait plaquée en haut, tout le vide en dessous.
    if (intervalles <= 0) return [depart + Math.max(0, place - somme) / 2]
    const ecart = Math.max(ecartMin, (place - somme) / intervalles)
    const debuts           = []
    let curseur = depart
    for (const longueur of longueurs) {
      debuts.push(curseur)
      curseur += longueur + ecart
    }
    return debuts
  }

  const departPrincipal = horizontal ? zone.x : zone.y
  const placePrincipale = horizontal ? zone.w : zone.h
  const departTravers = horizontal ? zone.y : zone.x
  const placeTravers = horizontal ? zone.h : zone.w

  // Les bandes d'abord, sur l'axe transverse : leur épaisseur est celle de
  // leur plus gros élément.
  const epaisseurs = bandes.map((bande) => Math.max(...bande.map((r) => epaisseur(r.box))))
  const lignes = repartir(epaisseurs, departTravers, placeTravers)

  const sortie = boxes.map((box) => ({ ...box }))
  bandes.forEach((bande, rangee) => {
    const centre = lignes[rangee]  + epaisseurs[rangee]  / 2
    const debuts = repartir(
      bande.map((r) => taille(r.box)),
      departPrincipal,
      placePrincipale,
    )
    bande.forEach((rang, place) => {
      const box = sortie[rang.index] 
      if (horizontal) {
        box.x = debuts[place] 
        box.y = centre - box.h / 2
      } else {
        box.y = debuts[place] 
        box.x = centre - box.w / 2
      }
    })
  })
  return sortie
}

/**
 * LA COLLISION du mode élément — deux boîtes se heurtent quand l'écart
 * minimal n'est plus tenu entre elles.
 *
 * L'écart s'évalue en distance de bord à bord : à exactement `ecart`, on ne
 * se heurte pas — c'est la distance légale, celle que « T » installe. La
 * butée sert PENDANT le geste : un élément déplacé ou agrandi bute sur ses
 * voisins au lieu de les recouvrir, et le glissement par axe (essayer x seul,
 * y seul) permet de longer un obstacle au lieu de rester collé dessus.
 */
export function seHeurtent(a     , b     , ecart = 0)          {
  return (
    a.x < b.x + b.w + ecart &&
    a.x + a.w + ecart > b.x &&
    a.y < b.y + b.h + ecart &&
    a.y + a.h + ecart > b.y
  )
}

/** Un lot heurte-t-il l'une des boîtes fixes ? */
export function lotHeurte(
  lot                ,
  fixes                ,
  ecart = 0,
)          {
  return lot.some((a) => fixes.some((b) => seHeurtent(a, b, ecart)))
}

/**
 * OPTIMISER un lot — le « T » du mode d'édition : taille ET position.
 *
 * La demande, mot pour mot : les éléments « doivent changer leur taille et
 * position pour maximiser la visibilité en respectant les limites de sécurité
 * entre eux et des edges, et s'organiser pour remplir au maximum la surface
 * en fonction de leur ordre d'importance ».
 *
 * La règle : une seule échelle pour tout le lot. Les RAPPORTS de taille entre
 * éléments sont un langage (un gros cutoff dit « je compte plus » qu'un petit
 * switch) — les redimensionner chacun pour soi l'effacerait. On cherche donc
 * la plus grande échelle commune telle que le lot, posé en rangées dans
 * l'ORDRE D'IMPORTANCE (le premier en haut à gauche), tienne dans l'étendue
 * avec l'écart minimal partout. Puis on répartit : les rangées sur la
 * hauteur, les éléments de chaque rangée sur la largeur — les écarts
 * grandissent au-delà du minimum, jamais en deçà, et un solitaire se centre.
 *
 * L'ordre d'ENTRÉE est l'ordre d'importance ; la sortie est dans le même
 * ordre. Rien ne déborde de l'étendue, rien ne se recouvre — par
 * construction.
 */
export function optimiserControles(
  boxes                ,
  etendue     ,
  ecartMin = 0,
)        {
  if (boxes.length === 0) return []

  /** Pose en rangées à l'échelle k — `null` si ça ne tient pas. */
  const poser = (k        )                                                     => {
    const rangees             = []
    const hauteurs           = []
    let courante           = []
    let largeur = 0
    let hauteur = 0
    let total = -ecartMin
    for (let i = 0; i < boxes.length; i += 1) {
      const w = boxes[i] .w * k
      const h = boxes[i] .h * k
      if (w > etendue.w + 1e-9) return null
      const etiree = courante.length > 0 ? largeur + ecartMin + w : w
      if (courante.length > 0 && etiree > etendue.w + 1e-9) {
        rangees.push(courante)
        hauteurs.push(hauteur)
        total += ecartMin + hauteur
        courante = []
        largeur = 0
        hauteur = 0
      }
      largeur = courante.length > 0 ? largeur + ecartMin + w : w
      hauteur = Math.max(hauteur, h)
      courante.push(i)
    }
    rangees.push(courante)
    hauteurs.push(hauteur)
    total += ecartMin + hauteur
    return total <= etendue.h + 1e-9 ? { rangees, hauteurs } : null
  }

  // La plus grande échelle qui tient, par dichotomie. Bornes larges : au
  // pire, tout minuscule tient toujours (sauf étendue dégénérée).
  let basse = 0.01
  let haute = 60
  if (!poser(basse)) {
    return boxes.map((b) => ({ ...b }))
  }
  for (let i = 0; i < 48; i += 1) {
    const milieu = (basse + haute) / 2
    if (poser(milieu)) basse = milieu
    else haute = milieu
  }
  const k = basse
  const pose = poser(k) 

  // ── LA RÉPARTITION : les rangées sur la hauteur, chaque rangée sur la
  //    largeur. Un solitaire (rangée unique, élément unique) se centre.
  const sortie = boxes.map((b) => ({ ...b }))
  const nbRangees = pose.rangees.length
  const hauteurTotale = pose.hauteurs.reduce((t, h) => t + h, 0)
  const ecartRangees =
    nbRangees > 1
      ? Math.max(ecartMin, (etendue.h - hauteurTotale) / (nbRangees - 1))
      : 0
  let y = nbRangees > 1 ? etendue.y : etendue.y + (etendue.h - hauteurTotale) / 2
  pose.rangees.forEach((rangee, r) => {
    const largeurs = rangee.map((i) => boxes[i] .w * k)
    const somme = largeurs.reduce((t, w) => t + w, 0)
    const ecartColonnes =
      rangee.length > 1
        ? Math.max(ecartMin, (etendue.w - somme) / (rangee.length - 1))
        : 0
    let x = rangee.length > 1 ? etendue.x : etendue.x + (etendue.w - somme) / 2
    for (let c = 0; c < rangee.length; c += 1) {
      const i = rangee[c] 
      const boite = sortie[i] 
      boite.w = boxes[i] .w * k
      boite.h = boxes[i] .h * k
      boite.x = x
      // Dans sa rangée, un élément se pose au CENTRE de la bande — deux
      // hauteurs différentes s'alignent par leur milieu, comme partout.
      boite.y = y + (pose.hauteurs[r]  - boite.h) / 2
      x += boite.w + ecartColonnes
    }
    y += pose.hauteurs[r]  + ecartRangees
  })
  return sortie
}

/**
 * L'ENCOMBREMENT MINIMAL d'une composition — la taille en deçà de laquelle
 * les distances de sécurité ne tiennent plus.
 *
 * Lu sur la structure en bandes de la composition COURANTE, tailles fixes :
 * la largeur minimale est celle de la bande la plus chargée, tous écarts au
 * minimum ; la hauteur minimale empile les bandes de la même façon. C'est la
 * butée du redimensionnement d'un bloc en édition : on ne peut pas rétrécir
 * un bloc en deçà de ce que ses éléments et leurs distances exigent.
 */
export function encombrementMinimal(
  boxes                ,
  ecartMin = 0,
)                           {
  if (boxes.length === 0) return { w: 0, h: 0 }
  const travers = (b     ) => b.y + b.h / 2
  const rangs = [...boxes].sort((a, b) => travers(a) - travers(b) || a.x - b.x)
  const bandes          = []
  for (const box of rangs) {
    const bande = bandes[bandes.length - 1]
    const dernier = bande?.[bande.length - 1]
    const seuil = dernier ? Math.max(dernier.h, box.h) / 2 : 0
    if (bande && dernier && Math.abs(travers(box) - travers(dernier)) <= seuil) bande.push(box)
    else bandes.push([box])
  }
  const w = Math.max(
    ...bandes.map((bande) => bande.reduce((t, b) => t + b.w, 0) + ecartMin * (bande.length - 1)),
  )
  const h =
    bandes.reduce((t, bande) => t + Math.max(...bande.map((b) => b.h)), 0) +
    ecartMin * (bandes.length - 1)
  return { w, h }
}
