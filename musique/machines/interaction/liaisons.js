// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/interaction/liaisons.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * CE QU'ON A LE DROIT DE BRANCHER, ET DANS QUOI.
 *
 * Le câblage ne connaissait qu'une question — « ce bloc a-t-il une entrée ? » —
 * et deux réseaux, le son et les notes. Ça suffisait tant qu'il n'y avait que
 * des instruments et des effets ; ça ne suffit plus. Une réverbe n'entre pas
 * dans un pad. Un tempo entre dans un séquenceur mais pas dans une sortie. Un
 * clavier entre dans un synthé et nulle part ailleurs.
 *
 * Chaque bloc déclare donc **ce qu'il émet** et **ce qu'il accepte**, en genres
 * de signal. Une liaison est possible si l'un émet ce que l'autre accepte, et
 * c'est tout — la règle tient en une ligne parce que la connaissance est dans
 * les prises, pas dans une liste de cas particuliers.
 *
 * Pur et sans DOM, comme tout `interaction/` : on le vérifie sans navigateur.
 */

import { refuse,                         } from "./patch.js"

/**
 * Les trois réseaux qui coexistent sur le canvas.
 *
 * Ils ne se branchent pas les uns dans les autres, et c'est ce qui les rend
 * lisibles : le son est un fil plein, les notes un fil pointillé, le tempo une
 * borne carrée. Trois langages, trois dessins.
 */
                                                

/** Ce qu'une prise émet, et ce qu'elle accepte. */
                         
                         
                            
 

/** Le strict nécessaire pour juger d'un bloc — pas besoin du graphe audio. */
                                 
                                                      
              
                                      
                                                 
                      
                                                 
                      
                                                                             
                     
 

const RIEN                    = []

/**
 * Les prises d'un bloc.
 *
 * Le TEMPO est accepté largement, et volontairement : tout ce qui a une notion
 * de temps peut recevoir une horloge à soi — un séquenceur, une boîte à
 * rythme, un écho, un LFO. Ce qui n'en a pas ne l'accepte pas : une sortie
 * générale n'a rien à faire d'un tempo, et le lui proposer serait un mensonge.
 */
export function prisesDe(bloc                )         {
  switch (bloc.kind) {
    case "output":
      // La sortie générale ne rend rien : c'est le bout de la chaîne.
      return { emet: RIEN, accepte: ["audio"] }

    case "instrument":
      // Un instrument se JOUE (des notes) et se cale (un tempo) ; il rend du
      // son. Il n'accepte pas de son : y brancher une réverbe n'a aucun sens,
      // c'est la réverbe qui vient après.
      return { emet: ["audio"], accepte: ["notes", "tempo"] }

    case "effect":
      // Un effet prend du son et rend du son. Il accepte aussi un tempo — un
      // écho ou un trémolo se calent dessus, et c'est le geste qu'on attend.
      return { emet: ["audio"], accepte: ["audio", "tempo"] }

    default: {
      // Les blocs de contrôle : clavier, séquenceur, tempo, sections de
      // machine sans graphe audio. Ce sont leurs bornes déclarées qui parlent.
      const emet           = []
      const accepte           = []
      if (bloc.notes.out) emet.push("notes")
      if (bloc.notes.in) accepte.push("notes")
      if (bloc.sortieAudio) emet.push("audio")
      if (bloc.entreeAudio) accepte.push("audio")
      if (bloc.sousTempo) emet.push("tempo")
      // Ce qui ÉMET des notes suit une horloge : un séquenceur, un arpégiateur,
      // un clavier qui tient un motif. On peut donc lui donner son tempo.
      if (bloc.notes.out && !bloc.sousTempo) accepte.push("tempo")
      return { emet, accepte }
    }
  }
}

/**
 * Le signal qu'une liaison porterait, ou `null` si elle n'a pas lieu d'être.
 *
 * L'ordre des genres est celui de leur évidence : entre deux blocs qui
 * pourraient échanger du son ET un tempo, c'est le son qu'on veut — c'est la
 * chaîne principale, le tempo est une dérogation.
 */
export function signalDe(source        , cible        )                {
  for (const genre of ["audio", "notes", "tempo"]         ) {
    if (source.emet.includes(genre) && cible.accepte.includes(genre)) return genre
  }
  return null
}

/** Pourquoi une liaison est refusée, ou `null` si elle passe. */
                                             

/**
 * Le verdict complet d'une liaison : les règles du graphe ET celles du signal.
 *
 * Les premières disent qu'on ne boucle pas et qu'on ne double pas un câble ;
 * la seconde, qu'un genre de signal doit passer. Les deux au même endroit, pour
 * que l'interface n'ait qu'une question à poser — et que le cadre vert ou rouge
 * qu'elle dessine dise exactement ce que le relâchement fera.
 */
export function refusDeLiaison(
  links                 ,
  from        ,
  to        ,
  source               ,
  cible               ,
)               {
  const graphe = refuse(links, from, to)
  if (graphe !== null) return graphe
  if (!source || !cible) return "signal"
  return signalDe(source, cible) === null ? "signal" : null
}

/** Formule courte du refus, pour l'infobulle du geste. */
export function direRefus(refus              )         {
  switch (refus) {
    case "boucle":
      return "boucle : ce bloc alimente déjà celui d'où part le câble"
    case "doublon":
      return "déjà relié"
    case "soi-meme":
      return "un bloc ne se branche pas sur lui-même"
    case "signal":
      return "rien à faire passer entre ces deux-là"
    default:
      return ""
  }
}
