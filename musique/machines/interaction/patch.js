// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/interaction/patch.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Le câblage : qui envoie son signal à qui.
 *
 * Cette logique est pure — aucun nœud Web Audio, aucun DOM. Elle décrit un
 * graphe orienté et répond à trois questions : peut-on relier ces deux blocs,
 * quelle est la chaîne qui part d'une source, et que devient le câblage quand
 * un bloc disparaît. Le son vient après, dans `rack.ts`, en appliquant
 * bêtement ce que ces fonctions ont décidé.
 *
 * Une seule interdiction, et elle n'est pas un avis de conception : **une
 * boucle est physiquement impossible**. Web Audio ne referme un cycle qu'à
 * travers une ligne de retard ; sans elle, la boucle produit du silence. Refuser
 * le câble est donc plus honnête que de le tracer et de laisser le son
 * disparaître sans explication.
 *
 * Tout le reste est permis, y compris ce qui surprend : un bloc peut nourrir
 * plusieurs destinations, et en recevoir plusieurs. C'est la règle 2 — on ne
 * décide pas à la place de l'utilisateur.
 */

/**
 * Un câble : la sortie de `from` entre dans `to`.
 *
 * Un câble peut être **en saut** : il existe et transporte le signal, mais il
 * ne se dessine pas. Un schéma nodal dense devient illisible bien avant de
 * devenir compliqué — passer un câble en saut, c'est ranger le trait sans
 * défaire la liaison. Deux carrés de sa couleur restent à ses deux bouts : ils
 * disent qu'il existe, et le rendent au survol.
 */
                       
              
            
                                                                      
               
                                                           
                 
 

/**
 * Les couleurs des sauts.
 *
 * Toutes de la même famille que l'ambre et le vermillon du thème : saturation
 * moyenne, luminosité moyenne, pour qu'aucune ne crie et qu'aucune ne se perde
 * — ni sur le fond clair, ni sur le sombre. Ce sont des repères, pas des
 * décorations : leur seul travail est de distinguer un saut d'un autre.
 */
// SHOWRUNNER : les huit repères sont des NOMS de jetons (commun/tokens.css,
// règle 1 du thème : aucune couleur en dur) — ils s'emploient en var(--nom).
export const JUMP_COLORS                    = [
  "amb",
  "coral-2",
  "grn2",
  "cy",
  "coral-3",
  "coral-1",
  "verd-2",
  "ink2",
]

/**
 * Couleur d'un nouveau saut : la moins utilisée, et à égalité la suivante dans
 * l'ordre. « Au hasard » donnerait deux fois la même couleur à des sauts
 * voisins une fois sur huit, ce qui est exactement le cas où ils doivent se
 * distinguer.
 */
export function nextJumpColor(links                 )         {
  const used = new Map                ()
  for (const color of JUMP_COLORS) used.set(color, 0)
  for (const link of links) {
    if (link.jump) used.set(link.jump, (used.get(link.jump) ?? 0) + 1)
  }
  let best = JUMP_COLORS[0] 
  for (const color of JUMP_COLORS) {
    if ((used.get(color) ?? 0) < (used.get(best) ?? 0)) best = color
  }
  return best
}

/** Passe un câble en saut, ou le rend au dessin. */
export function toggleJump(links                 , on      )         {
  return links.map((link) => {
    if (link.from !== on.from || link.to !== on.to) return link
    if (link.jump) {
      const { jump: _jump, shown: _shown, ...plain } = link
      return plain
    }
    return { ...link, jump: nextJumpColor(links) }
  })
}

/** Montre ou cache un saut, sans le défaire. */
export function toggleShown(links                 , on      )         {
  return links.map((link) =>
    link.from === on.from && link.to === on.to && link.jump
      ? { ...link, shown: !link.shown }
      : link,
  )
}

export function sameLink(a      , b      )          {
  return a.from === b.from && a.to === b.to
}

export function hasLink(links                 , from        , to        )          {
  return links.some((link) => link.from === from && link.to === to)
}

/**
 * Vrai si brancher `from → to` refermerait une boucle.
 *
 * On remonte le courant depuis `from` : si on retombe sur `to`, c'est que `to`
 * alimente déjà `from`, directement ou non. Se relier à soi-même compte.
 */
export function wouldLoop(links                 , from        , to        )          {
  if (from === to) return true
  const seen = new Set        ()
  const stack = [from]
  while (stack.length > 0) {
    const node = stack.pop() 
    if (node === to) return true
    if (seen.has(node)) continue
    seen.add(node)
    for (const link of links) {
      if (link.to === node) stack.push(link.from)
    }
  }
  return false
}

/** Raison pour laquelle un câble est refusé, ou `null` s'il passe. */
                                                              

export function refuse(links                 , from        , to        )          {
  if (from === to) return "soi-meme"
  if (hasLink(links, from, to)) return "doublon"
  if (wouldLoop(links, from, to)) return "boucle"
  return null
}

/** Ajoute un câble s'il est recevable ; rend la liste inchangée sinon. */
export function connect(links                 , from        , to        )         {
  if (refuse(links, from, to) !== null) return [...links]
  return [...links, { from, to }]
}

export function disconnect(links                 , from        , to        )         {
  return links.filter((link) => !(link.from === from && link.to === to))
}

/** Retire tout ce qui touche à ces blocs — ce qu'il faut faire en les supprimant. */
export function detachAll(links                 , ids                   )         {
  const gone = new Set(ids)
  return links.filter((link) => !gone.has(link.from) && !gone.has(link.to))
}

/**
 * Supprime des blocs en **recousant** le câblage.
 *
 * Retirer un maillon au milieu d'une chaîne ne doit pas la couper en deux : ce
 * qui entrait dans le bloc est rebranché sur ce qui en sortait. C'est le geste
 * attendu quand on enlève un effet d'une chaîne — on ne veut pas rebrancher à
 * la main derrière lui.
 */
export function removeNodes(links                 , ids                   )         {
  let result = [...links]
  for (const id of ids) {
    const upstream = result.filter((link) => link.to === id).map((link) => link.from)
    const downstream = result.filter((link) => link.from === id).map((link) => link.to)
    result = result.filter((link) => link.from !== id && link.to !== id)
    for (const from of upstream) {
      for (const to of downstream) {
        if (refuse(result, from, to) === null) result.push({ from, to })
      }
    }
  }
  return result
}

/** Ce qui entre dans un bloc. */
export function sourcesOf(links                 , id        )           {
  return links.filter((link) => link.to === id).map((link) => link.from)
}

/** Ce que nourrit un bloc. */
export function targetsOf(links                 , id        )           {
  return links.filter((link) => link.from === id).map((link) => link.to)
}

/** Vrai si le bloc n'est relié à rien : ni entrée, ni sortie. */
export function isOrphan(links                 , id        )          {
  return !links.some((link) => link.from === id || link.to === id)
}

/**
 * Suit la chaîne au départ d'un bloc, tant qu'elle ne se divise pas.
 *
 * Sert à nommer ce qu'on voit : « BASSE → FILTRE → SATURA → SORTIE ». Dès
 * qu'une sortie part vers deux endroits, la chaîne s'arrête — au-delà, ce n'est
 * plus une chaîne mais un arbre, et le mot serait faux.
 */
export function chainFrom(links                 , id        )           {
  const chain = [id]
  const seen = new Set([id])
  let current = id
  for (;;) {
    const next = targetsOf(links, current)
    if (next.length !== 1) return chain
    const step = next[0] 
    if (seen.has(step)) return chain
    seen.add(step)
    chain.push(step)
    current = step
  }
}

/**
 * Vrai si le signal de `from` finit par atteindre `to`.
 * C'est la question « ce bloc s'entend-il ? » quand `to` est la sortie.
 */
export function reaches(links                 , from        , to        )          {
  if (from === to) return true
  const seen = new Set        ()
  const stack = [from]
  while (stack.length > 0) {
    const node = stack.pop() 
    if (node === to) return true
    if (seen.has(node)) continue
    seen.add(node)
    for (const link of links) {
      if (link.from === node) stack.push(link.to)
    }
  }
  return false
}

/**
 * Insère un bloc **dans** un câble : `A → B` devient `A → X → B`.
 *
 * C'est le symétrique exact du recousage de `removeNodes` : celui-ci referme
 * la chaîne quand un maillon part, celui-là l'ouvre pour en glisser un. Les
 * deux ensemble font qu'une chaîne se remanie sans jamais se démonter.
 *
 * Si le câble n'existe pas, ou si l'insertion boucle, rien ne change.
 */
export function insertInto(links                 , on      , node        )         {
  if (!hasLink(links, on.from, on.to)) return [...links]
  if (node === on.from || node === on.to) return [...links]
  const without = disconnect(links, on.from, on.to)
  if (refuse(without, on.from, node) !== null) return [...links]
  const half = connect(without, on.from, node)
  if (refuse(half, node, on.to) !== null) return [...links]
  return connect(half, node, on.to)
}

/**
 * Le câblage d'un lot dupliqué.
 *
 * Deux règles, et une seule est une décision :
 *
 *   1. **les câbles internes suivent** — sans eux la copie n'est pas une copie,
 *      c'est un tas de blocs ;
 *   2. **ce que le lot alimentait, les copies l'alimentent aussi** — dupliquer
 *      une chaîne d'effets pour la brancher ailleurs à la main n'aurait aucun
 *      sens, on la duplique justement pour qu'elle joue.
 *
 * Ce qui ENTRAIT dans le lot n'est pas dupliqué : brancher la même source sur
 * les deux chaînes est un choix musical, pas une évidence, et il se fait d'un
 * geste. On ne le prend pas à la place de l'utilisateur.
 *
 * @param clone ancien identifiant → nouvel identifiant
 */
export function duplicateLinks(
  links                 ,
  clone                             ,
)         {
  let result = [...links]
  for (const link of links) {
    const from = clone.get(link.from)
    if (from === undefined) continue
    // Interne au lot : la copie reproduit le câble entre les deux copies.
    // Sortant : la copie vise la même destination que l'original.
    const to = clone.get(link.to) ?? link.to
    if (refuse(result, from, to) === null) result.push({ from, to })
  }
  return result
}
