// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/blocks/planche.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * LA RÈGLE DU RESPONSIF D'UNE MACHINE — le module exécutable.
 *
 * La stratégie est écrite dans `docs/regle-du-responsif-machine.md` ; ce
 * module en est la partie pure. La grandeur qui décide de TOUT ce qu'on
 * montre est la TAILLE APPARENTE — la place du bloc multipliée par le zoom,
 * en pixels écran. C'est la doctrine fondatrice d'ODIO (« ce que montre une
 * tuile n'est pas décidé par un palier de zoom, mais par sa taille
 * apparente ») appliquée à l'intérieur d'une machine :
 *
 *   - un bloc minuscule regardé de près a une grande taille apparente : il
 *     montre TOUT, mis à l'échelle ;
 *   - un grand bloc regardé de loin a une petite taille apparente : il
 *     RETIRE, dans l'ordre de priorité, et ce qui reste grandit dans la
 *     place libérée.
 *
 * UNE SEULE chose reste résolue en monde, jamais par le zoom : le COMPTE des
 * conteneurs répétitifs — octaves, pas, tranches. C'est une donnée (le motif
 * a trente-deux pas), pas un affichage : dézoomer ne retire pas une octave,
 * on n'a rien redimensionné. Le zoom sémantique n'agit qu'après, sur ce que
 * le conteneur a résolu — et un conteneur cède ses TEXTES au dézoom, jamais
 * ses unités : une rangée de pas vue de loin reste une bande de pas.
 *
 * Les deux cotes de composition (`MARGE_MM`, `BANDEAU_MM`) sont lues dans
 * `UI/3_machine/ODIO-O1 Hardware.dc.html` (`M = 7`, `HDR = 14`), qui reste la
 * source de vérité. Rien ici n'est une opinion sur le planogramme.
 */

import { controlBox,                                                                                     } from "./machines.js"

/** Marge intérieure d'une section, en mm — `M` du fichier de référence. */
export const MARGE_MM = 7

/**
 * Bandeau de nom réservé en haut d'une section, en mm — `HDR` du fichier de
 * référence. C'est LUI que l'en-tête de la tuile ODIO remplace.
 */
export const BANDEAU_MM = 14

/**
 * Jeu de comparaison des comptes, en millimètres réels.
 *
 * La taille monde d'un bloc est arrondie au pixel : un quart de millimètre
 * sous la cote faisait tomber une rangée de seize pas à douze dès sa
 * naissance. Quatre millimètres restent très en deçà du plus petit seuil
 * franchissable — le pas d'une rangée fait 24 mm, une octave 161.
 */
export const JEU_MM = 4

/** Écart minimal entre deux cellules d'une grille de retrait, px écran. */
export const ECART_PX = 5

/**
 * Réserve du nom sous un contrôle en grille, px écran (corps 11 + écart 2).
 *
 * Elle n'est réservée que si les noms s'affichent : au dézoom, les noms
 * tombent AVANT les contrôles — de loin on reconnaît une molette, on ne lit
 * plus sa sérigraphie, et la place du nom revient au contrôle.
 */
export const BANDE_NOM_PX = 13

/**
 * LE PLANCHER DE PRÉSENCE, PAR TYPE — en pixels écran, sur le grand côté.
 *
 * C'est le « rapport au seuil » demandé : chaque genre d'élément a la taille
 * apparente en deçà de laquelle il ne dit plus rien — un knob se reconnaît
 * encore à sept pixels, une diode à trois, un pad orbital a besoin de douze.
 * Comme le plancher est absolu et que les cotes réelles diffèrent, un petit
 * élément atteint le sien avant un gros À priorité égale — le rapport à la
 * taille initiale est dans la géométrie, pas dans un réglage.
 *
 * Ce n'est PAS une taille de visée : viser se fait en zoomant — c'est tout le
 * paradigme du canvas. C'est une taille de présence : en deçà, l'élément
 * n'est plus qu'un bruit, et sa place sert mieux aux survivants.
 *
 * Calibré sous la pose : à l'échelle de pose (0,8 px/mm, rendue ~0,75), le
 * plus petit knob du catalogue fait huit pixels — toute planche posée passe
 * son plancher, et la dégradation commence dès qu'on s'éloigne.
 */
export const PLANCHER_TYPE                                                 = {
  knob: 6,
  switch: 6,
  fader: 6,
  button: 6,
  pad: 6,
  wheel: 6,
  key: 6,
  led: 3,
  ribbon: 8,
  vu: 8,
  orbit: 11,
  matrix: 11,
  curve: 11,
  display: 7,
}

/**
 * Le magasin VIVANT des planchers — le panneau « seuils » l'ajuste en direct.
 *
 * Les valeurs par défaut SONT le contrat : les tests s'appuient dessus et le
 * magasin démarre toujours dessus, sans persistance. Le réglage sert à
 * CALIBRER — on dézoome, on regarde à quelle taille d'écran un élément cesse
 * de dire quelque chose, on ajuste, puis « copier » sort les valeurs pour
 * qu'elles deviennent les défauts du code. C'est l'outil d'accord entre ce
 * que l'œil voit et ce que la règle décrète — un chiffre par TYPE, jamais un
 * réglage par machine.
 */
let planchers                                       = { ...PLANCHER_TYPE }

/**
 * LE SEUIL DE DÉZOOM MAX DE LA SÉMANTIQUE — un zoom caméra.
 *
 * En deçà, on ne cherche plus à faire de sémantique : la composition gèle
 * dans l'état qu'elle avait au seuil, et tout rétrécit ensemble avec la
 * caméra. Ce n'est PAS le plancher de lisibilité du canvas — celui-ci se
 * calcule sur les tuiles présentes et peut valoir un, ce qui gèlerait la
 * sémantique dès le premier cran. C'est un seuil propre, et il se règle dans
 * le panneau des seuils, en regardant.
 *
 * SA VALEUR PAR DÉFAUT NE TRONQUE PLUS RIEN — corrigé sur mesure.
 *
 * Elle valait 0,45, calibrée quand les sections portaient les cotes brutes du
 * constructeur : leur cascade de dégradation courait alors de ×1,79 à ×0,48,
 * et le gel se posait juste EN DESSOUS d'elle, ce qui était juste. Deux
 * changements l'ont rendue fausse. La composition de naissance a rempli les
 * blocs : un élément du minilogue est passé de onze à dix-sept millimètres et
 * plus, donc il tient son plancher d'écran bien plus longtemps, et toute la
 * cascade est descendue sous ×0,45 — mesuré : première marche à ×0,44, la
 * dernière à ×0,06. La scène à trois machines, elle, a fait tomber le cadrage
 * d'ouverture à ×0,64, donc la butée de dézoom à ×0,21 : entre ×0,45 et
 * ×0,21, tout le recul possible se faisait dans le gel. Résultat mesuré au
 * navigateur : QUARANTE crans de molette sans qu'aucun bloc ne cède un seul
 * élément — plus aucun zoom sémantique.
 *
 * Le défaut vaut donc `MIN_K`, la butée absolue de la caméra : la sémantique
 * court aussi loin que la caméra recule, et c'est la caméra qui l'arrête, pas
 * un gel posé au milieu du chemin. La cascade s'épuise d'elle-même — une fois
 * un seul élément retenu, la grille n'a plus rien à retirer. Le réglage reste
 * là pour geler PLUS TÔT, à la main, si l'œil le demande.
 *
 * À REMESURER dès qu'une composition de naissance change les cotes d'une
 * machine : c'est elle qui décide où vit la cascade.
 */
export const SEUIL_SEMANTIQUE_DEFAUT = 0.05
let seuilSemantique = SEUIL_SEMANTIQUE_DEFAUT

/**
 * LES DEUX DISTANCES DE SÉCURITÉ DE LA COMPOSITION, en mm de section.
 *
 * En mm et pas en pixels d'écran : ce sont des règles de PLANOGRAMME, elles
 * doivent valoir à tout zoom et à toute taille de bloc, comme la marge du
 * fichier de référence dont la première reprend la valeur (`M = 7`).
 *
 *   - `margeBord` — ce qu'un élément garde entre lui et le bord du corps du
 *     bloc. C'est le rectangle en pointillé du mode élément : la main s'y
 *     arrête, et le rangement le remplit. Distinct de `MARGE_MM`, qui est la
 *     marge du PLANOGRAMME (la relation entre la section et son corps) et
 *     reste la cote du fichier de référence.
 *   - `ecartElements` — ce que deux éléments gardent entre eux. Il ne
 *     contraint pas la main, qui pose où elle veut ; il commande le
 *     RANGEMENT, qui répartit dans le bloc sans jamais descendre en dessous.
 */
export const MARGE_BORD_DEFAUT = 4
export const ECART_ELEMENTS_DEFAUT = 4
let margeBord = MARGE_BORD_DEFAUT
let ecartElements = ECART_ELEMENTS_DEFAUT

/**
 * LA PRÉSENCE RELATIVE — le vrai moteur de la cascade. Corrigé sur rage.
 *
 * Les planchers par type sont des tailles de RECONNAISSANCE, absolues : en
 * deçà de six pixels un knob n'est plus un knob. Ils gardent ce rôle. Mais
 * ils ne peuvent PAS être ce qui déclenche le retrait : quand la composition
 * de naissance a rempli les blocs, les éléments ont grossi (onze → dix-sept
 * millimètres et plus), et il fallait dézoomer jusqu'à les rendre presque
 * invisibles pour qu'ils atteignent six pixels. Mesuré : le zoom sémantique
 * ne faisait plus RIEN sur le minilogue dans toute la plage atteignable —
 * alors qu'il marchait au premier essai, quand les cotes brutes étaient
 * petites et que six pixels représentaient une fraction honnête de leur
 * taille. Le plancher absolu ne survit pas à un changement d'échelle des
 * données : c'est un défaut de principe, pas de calibrage.
 *
 * La règle juste est RELATIVE, et c'est celle de tout le poste de travail :
 * l'auteur DESSINE des tailles (le nom dit la fonction, la fonction dit
 * l'importance, l'importance dit la taille — en millimètres de planogramme).
 * Un élément ne dit ce qu'il doit dire qu'à peu près à cette taille-là. On ne
 * le rend donc JAMAIS sous une fraction de sa taille de pose : en deçà, sa
 * place sert mieux aux plus importants, et le retrait commence. Comme la
 * borne est proportionnelle à la cote (`e × cote ≥ fraction × POSE × cote`),
 * la cote se simplifie : c'est une borne d'ÉCHELLE apparente, la même pour
 * toute la section — et recomposer un planogramme ne déplace plus jamais la
 * cascade, puisqu'elle suit les tailles dessinées.
 *
 * Ce que ça donne à l'auteur : grossir un élément en édition le rend plus
 * lisible à tout zoom ; le mettre en tête du tracé le fait survivre plus
 * longtemps ; agrandir un BLOC garde sa planche plus loin dans le dézoom.
 * Les trois leviers de réglage commandent la cascade, au lieu qu'un chiffre
 * d'écran caché la commande à leur place.
 */
/**
 * 0,60 par défaut — et la borne du réglage est LA COTE, pas l'ouverture.
 *
 * Un premier calibrage (0,45) protégeait le cadrage d'ouverture de la scène
 * à trois machines : aucune section n'y était dégradée. L'auteur a tranché
 * l'inverse (« il faut que ça se simplifie beaucoup plus rapidement ») — et
 * la doctrine lui donne raison : le cadrage d'ouverture est DÉJÀ un recul,
 * un bloc regardé de loin retire. La vue d'ensemble montre l'essentiel de
 * chaque bloc ; se pencher sur une machine (zoom vers ×1) rend ses planches
 * entières.
 *
 * La borne intouchable est celle de F45 : À SA COTE (zoom ×1), une section
 * montre TOUJOURS sa planche entière — l'échelle est un choix du musicien,
 * elle ne peut pas lui retirer ce qu'il vient de poser. À la cote, la chrome
 * de tuile laisse les sections rendre ~×0,97 de leur échelle dessinée : le
 * réglage est donc borné à 0,9, et un test tient la planche entière à la
 * cote au réglage MAXIMAL. Le curseur vit dans la barre du haut — l'outil
 * d'accord général de la sémantique, en regardant.
 */
export const PRESENCE_RELATIVE_DEFAUT = 0.6
let presenceRelative = PRESENCE_RELATIVE_DEFAUT

/**
 * L'échelle de POSE du planogramme, px monde par mm — la même valeur que
 * `MM_TO_WORLD` (machines.ts), redéclarée ici parce que les deux modules
 * s'importent en cercle : une constante lue à l'évaluation du module serait
 * `undefined`, et toute la grille calculait en NaN. Un test épingle
 * l'égalité des deux.
 */
export const ECHELLE_POSE = 0.8

/**
 * La bande de nom d'une cellule de grille, en PIXELS D'ÉCRAN — et pourquoi.
 *
 * La grille de retrait ne portait AUCUN nom : une première bande d'écran,
 * fixe dans des cellules qui rétrécissaient sans borne, faisait mourir les
 * rangées d'un coup ou regrossir les contrôles en tombant — la loi disait
 * donc « pas de noms en grille ». Depuis la présence relative, la grille vit
 * dans la plage de zoom UTILE, là où l'auteur lit — et le nom est « le seul
 * truc dont il a besoin » : la bande revient.
 *
 * Une bande en millimètres a été essayée d'abord — élégante, elle grandissait
 * avec la grille. Mais le NOM, lui, est en pixels d'écran (la sérigraphie ne
 * rétrécit pas avec les knobs) : aux échelles de la grille, la bande en mm ne
 * pouvait jamais loger le corps de texte qu'elle annonçait, et pas UNE
 * étiquette ne s'affichait — mesuré à l'écran. La bande est donc en pixels,
 * la hauteur du plus grand cran de sérigraphie avec son interligne et son
 * écart. L'ancienne pathologie ne revient pas : le plancher relatif retire
 * les éléments bien avant que leurs cellules ne s'écrasent sous la bande, et
 * quand la géométrie ne peut plus payer la bande, elle tombe pour TOUTE la
 * répartition (`bande: false`) — jamais rangée par rangée.
 */
export const BANDE_GRILLE_PX = 18

const ecouteurs = new Set            ()

export function getPlanchers()                                                 {
  return planchers
}

export function setPlancher(kind             , px        )       {
  planchers = { ...planchers, [kind]: px }
  for (const ecouteur of ecouteurs) ecouteur()
}

export function resetPlanchers()       {
  planchers = { ...PLANCHER_TYPE }
  seuilSemantique = SEUIL_SEMANTIQUE_DEFAUT
  presenceRelative = PRESENCE_RELATIVE_DEFAUT
  margeBord = MARGE_BORD_DEFAUT
  ecartElements = ECART_ELEMENTS_DEFAUT
  for (const ecouteur of ecouteurs) ecouteur()
}

export function getPresenceRelative()         {
  return presenceRelative
}

export function setPresenceRelative(fraction        )       {
  // 0,9 au plus : au-delà, la planche céderait À LA COTE même (la chrome ne
  // laisse rendre que ~×0,97 de l'échelle dessinée), et F45 interdit cela.
  presenceRelative = Math.min(0.9, Math.max(0.2, fraction))
  for (const ecouteur of ecouteurs) ecouteur()
}

/** L'échelle apparente (px écran par mm) sous laquelle un élément ne dit plus sa taille dessinée. */
export function echellePresence()         {
  return presenceRelative * ECHELLE_POSE
}

export function getMargeBord()         {
  return margeBord
}

export function setMargeBord(mm        )       {
  margeBord = Math.max(0, mm)
  for (const ecouteur of ecouteurs) ecouteur()
}

export function getEcartElements()         {
  return ecartElements
}

export function setEcartElements(mm        )       {
  ecartElements = Math.max(0, mm)
  for (const ecouteur of ecouteurs) ecouteur()
}

export function getSeuilSemantique()         {
  return seuilSemantique
}

export function setSeuilSemantique(zoom        )       {
  seuilSemantique = Math.max(0.05, zoom)
  for (const ecouteur of ecouteurs) ecouteur()
}

/** Prévient à chaque réglage — l'interface se recalcule alors entière. */
export function onPlanchers(ecouteur            )             {
  ecouteurs.add(ecouteur)
  return () => ecouteurs.delete(ecouteur)
}

/** Le plancher de présence d'un contrôle — zéro : jamais retiré pour sa taille. */
export function plancherDe(control                )         {
  if (control.kind === "text") return 0
  // Une diode simple témoin ne commande jamais la bascule d'une section.
  if (control.kind === "led" && control.indicator) return 0
  return planchers[control.kind] ?? 7
}

/** Le grand côté d'un contrôle, en mm — c'est lui qu'on compare au plancher. */
function grandCote(control                )         {
  const box = controlBox(control)
  return Math.max(box.w, box.h)
}

/**
 * LA BOÎTE UTILE D'UNE SECTION — celle que le planogramme DÉCLARE.
 *
 * Le rectangle de la section moins sa marge et son bandeau de nom : exactement
 * la zone où le fichier de référence empile ses rangées. Le vide qu'elle
 * contient est une intention de composition — jamais un défaut de cadrage à
 * rattraper. Déduire la boîte des contrôles à la place de celle-ci a produit
 * le pire défaut du responsif : une seule machine rendue à quatre échelles.
 */
export function boiteUtile(section                )                                                 {
  const M = MARGE_MM
  return {
    x: M,
    // Un bandeau posé en bas (tranches TR-8S) libère le haut : la hauteur
    // perdue est la même, sa place change.
    y: section.tagBottom ? M : M + BANDEAU_MM,
    w: Math.max(1, section.w - 2 * M),
    h: Math.max(1, section.h - 2 * M - BANDEAU_MM),
  }
}

                             
                                                          
                 
                                                             
                                                       
                                                                                                           
                                   
 

/**
 * Ajuste la boîte déclarée au corps apparent du bloc — LE remplissage.
 *
 * Uniforme (un knob reste rond), centré, sans plafond : agrandir le bloc ou
 * s'en approcher grandit le contenu, à l'identique.
 */
export function resoudrePlanche(section                , corpsW        , corpsH        )             {
  const utile = boiteUtile(section)
  const echelle = Math.max(0, Math.min(corpsW / utile.w, corpsH / utile.h))
  return {
    echelle,
    utile,
    origine: {
      x: Math.max(0, (corpsW - utile.w * echelle) / 2),
      y: Math.max(0, (corpsH - utile.h * echelle) / 2),
    },
  }
}

/**
 * La planche entière est-elle encore PRÉSENTE à cette échelle apparente ?
 *
 * Deux conditions, et c'est LE seuil planche → retrait :
 *
 *   - la PRÉSENCE RELATIVE — l'échelle apparente rend encore les éléments à
 *     une fraction honnête de leur taille dessinée. C'est elle qui déclenche
 *     dans la plage de zoom utile : dès qu'on recule sous ~55 % de la pose,
 *     la planche cède et le retrait commence, quelles que soient les cotes ;
 *   - la RECONNAISSANCE — chaque contrôle adressable tient le plancher
 *     absolu de son type. Elle ne mord que sur les planches aux éléments
 *     minuscules (cotes brutes du constructeur), où six pixels arrivent
 *     avant la fraction.
 *
 * À zoom serré, l'échelle apparente est grande et la planche tient dans un
 * bloc minuscule ; de loin, elle cède — d'abord ses noms, puis ses éléments,
 * par priorité.
 */
export function planchePresente(section                , echelle        )          {
  if (echelle < echellePresence()) return false
  for (const control of section.controls) {
    const plancher = plancherDe(control)
    if (plancher <= 0) continue
    if (grandCote(control) * echelle < plancher) return false
  }
  return true
}

/**
 * La place d'un conteneur répétitif, en millimètres — résolue en MONDE.
 *
 * Une rangée et un clavier lisent leur échelle sur leur AXE DE TAILLE — la
 * hauteur du BLOC — parce que la hauteur de leur contenu ne dépend pas du
 * compte : l'échelle est connue AVANT de choisir le compte, il n'y a pas de
 * boucle. Le zoom n'entre jamais ici : le compte est une donnée du motif,
 * pas un affichage.
 *
 * L'échelle se lit sur le bloc et non sur le corps : l'en-tête de la tuile
 * se resserre sur un bloc bas, et cette variance suffisait à faire renaître
 * une machine posée avec des pas en moins.
 */
export function placeElastique(
  section                ,
  corpsW        ,
  corpsH        ,
  blocH         ,
)         {
  const utile = boiteUtile(section)
  const echelle = blocH !== undefined ? blocH / section.h : corpsH / utile.h
  return echelle > 0 ? corpsW / echelle : 0
}

/** Où se pose une boîte de contrôle dans le corps, px écran. */
export function placeDuControle(
  plan                                                   ,
  box                                                ,
)                                                 {
  return {
    x: plan.origine.x + (box.x - plan.utile.x) * plan.echelle,
    y: plan.origine.y + (box.y - plan.utile.y) * plan.echelle,
    w: box.w * plan.echelle,
    h: box.h * plan.echelle,
  }
}

/**
 * Le chemin INVERSE — d'une boîte d'écran vers la cote de la section.
 *
 * `placeDuControle` va des cotes vers l'écran ; le mode élément fait le
 * retour, et il doit le faire avec la MÊME résolution, sans quoi un contrôle
 * déposé ne se retrouve pas là où la main l'a lâché. Les deux fonctions vivent
 * donc côte à côte : elles ne peuvent pas diverger sans qu'on le voie.
 *
 * La cote rendue est un coin haut-gauche, comme celle que `controlBox`
 * produit — la convention du knob (qui déclare son centre) se remet au-dessus,
 * là où le contrôle est connu.
 */
export function coteDuControle(
  plan                                                   ,
  box                                                ,
)                                                 {
  if (plan.echelle <= 0) return { x: plan.utile.x, y: plan.utile.y, w: 0, h: 0 }
  return {
    x: plan.utile.x + (box.x - plan.origine.x) / plan.echelle,
    y: plan.utile.y + (box.y - plan.origine.y) / plan.echelle,
    w: box.w / plan.echelle,
    h: box.h / plan.echelle,
  }
}

/** Un contrôle placé — la sortie unique de toute composition. */
                                
                         
                                                         
                                                     
                                                                                 
                 
 

/**
 * LA GRILLE DE RETRAIT — moins d'éléments, et les survivants grandissent.
 *
 * Quand la planche n'est plus présente (un élément sous son plancher de
 * type), on ne rétrécit pas le planogramme : on retire par la FIN de l'ordre
 * de priorité — le tracé au clic milieu, puis l'exposé, puis la cote du
 * constructeur — et ce qui reste se recompose en grille, à la plus grande
 * échelle qui tienne les planchers. C'est ce qui fait qu'au dernier dézoom,
 * l'élément que le musicien a mis en tête s'affiche EN GRAND, même s'il est
 * minuscule sur l'appareil : la priorité commande, la géométrie suit.
 *
 * Trois lois de cohérence, gagnées contre des défauts constatés :
 *
 *   - **la grille REMPLIT** — les survivants prennent la plus grande échelle
 *     que le corps autorise, sans autre borne que lui. Une borne de douceur
 *     (planche × √(total/n)) a été essayée : elle laissait les blocs à
 *     moitié vides à tous les dézooms intermédiaires — le contraire du
 *     remplissage maximal demandé. Le saut de taille à chaque marche est le
 *     comportement voulu : un élément part, la place libérée se prend.
 *   - **la première marche retire** — recomposer la planche entière en grille
 *     faisait grossir les mêmes contrôles d'un coup, sans qu'aucun ne parte.
 *     La croissance des survivants n'est légitime que payée par un retrait.
 *   - **la grille porte les noms en MILLIMÈTRES** — l'ancienne loi (« la
 *     grille ne porte pas de noms ») venait d'une bande en pixels d'écran,
 *     fixe dans des cellules qui rétrécissaient : rangées mortes d'un coup,
 *     contrôles qui regrossissaient quand elle tombait. Depuis la présence
 *     relative, la grille vit dans la plage de zoom UTILE, là où l'auteur
 *     lit — et le nom est le seul renseignement dont il a besoin. La bande
 *     (`NOM_GRILLE_MM`) est donc une cote, comme la sérigraphie : elle
 *     grandit et rétrécit avec la grille, la mise en page ne saute jamais,
 *     et les noms tombent un à un au seuil d'écran, comme sur la planche.
 *
 * Chaque répartition retenue tient LES DEUX seuils de présence : la fraction
 * de la taille dessinée (`echellePresence`), qui cadence les marches dans la
 * plage utile, et le plancher absolu du type, qui garde la reconnaissance.
 * Le dernier contrôle échappe aux deux : en deçà d'un seul élément, c'est la
 * taille du bloc qui commande, et elle appartient au musicien.
 */
export function composerGrille(
  classes                               ,
  corpsW        ,
  corpsH        ,
  /**
   * Facteur d'APPARENCE : combien un pixel local vaut de pixels écran.
   *
   * Sous le plancher de lisibilité du canvas, la tuile garde sa taille de
   * mise en page et le `retrait` d'affichage rétrécit tout — les planchers de
   * présence se jugent sur `echelle × apparence`, la taille que l'œil a
   * vraiment. Le gel du dézoom max est déjà dans ce facteur : l'appelant le
   * borne au seuil sémantique, donc en deçà il ne varie plus.
   */
  apparence = 1,
)                                                                  {
  if (classes.length === 0) return { retenus: [], echelle: 0, colonnes: 1 }

  for (let n = Math.max(1, classes.length - 1); n >= 1; n -= 1) {
    const garde = classes.slice(0, n)
    const cellW = Math.max(...garde.map((c) => controlBox(c).w))
    const cellH = Math.max(...garde.map((c) => controlBox(c).h))

    // AVEC la bande de nom d'abord, SANS ensuite — et seulement après, n − 1.
    //
    // L'ordre est une préférence de contenu : garder un élément DE PLUS vaut
    // mieux que garder des noms, mais garder les noms vaut mieux que du vide.
    // Sans le repli sans bande, les petits blocs sautaient de la planche
    // entière à UN SEUL élément en un cran de molette : la bande doublait la
    // hauteur des cellules, et plus aucune répartition intermédiaire ne
    // passait les seuils — la falaise, vue à l'écran. La planche fait déjà
    // exactement cela : ses noms tombent AVANT ses éléments, et la place du
    // nom revient au contrôle.
    for (const bande of [true, false]) {
      let meilleur                                                                = null
      for (let colonnes = 1; colonnes <= n; colonnes += 1) {
        const rangees = Math.ceil(n / colonnes)
        const kW = (corpsW / colonnes - ECART_PX) / cellW
        const kH = (corpsH / rangees - ECART_PX - (bande ? BANDE_GRILLE_PX : 0)) / cellH
        const echelle = Math.min(kW, kH)
        if (echelle <= 0) continue
        // Cette répartition rend-elle encore les tailles dessinées ? — la
        // présence relative, À L'ÉCRAN, apparence comprise. C'est elle qui
        // cadence les marches dans la plage de zoom utile.
        if (echelle * apparence < echellePresence()) continue
        // Et chaque retenu tient le plancher absolu de son type — la
        // reconnaissance. Sinon cette répartition ne vaut rien : on gardera moins.
        if (!garde.every((c) => grandCote(c) * echelle * apparence >= plancherDe(c))) continue
        if (!meilleur || echelle > meilleur.echelle) meilleur = { colonnes, rangees, echelle }
      }
      if (meilleur) return poserGrille(garde, meilleur, cellW, cellH, corpsW, corpsH, bande)
    }
  }

  // Le dernier — l'exposé, à défaut le plus prioritaire — sans plancher.
  // Sa bande de nom d'abord ; dans un corps trop petit pour elle, l'élément
  // seul, sans nom — un contrôle minuscule vaut mieux que rien du tout.
  const seul = classes[0] 
  const boite = controlBox(seul)
  const nomme = Math.min(
    (corpsW - ECART_PX) / boite.w,
    (corpsH - ECART_PX - BANDE_GRILLE_PX) / boite.h,
  )
  if (nomme > 0) {
    return poserGrille([seul], { colonnes: 1, rangees: 1, echelle: nomme }, boite.w, boite.h, corpsW, corpsH, true)
  }
  const echelle = Math.max(
    0,
    Math.min((corpsW - ECART_PX) / boite.w, (corpsH - ECART_PX) / boite.h),
  )
  return poserGrille([seul], { colonnes: 1, rangees: 1, echelle }, boite.w, boite.h, corpsW, corpsH, false)
}

function poserGrille(
  garde                               ,
  choix                                                        ,
  cellW        ,
  cellH        ,
  corpsW        ,
  corpsH        ,
  bande         ,
)                                                                  {
  const echelle = choix.echelle
  const pasW = cellW * echelle + ECART_PX
  // La cellule loge le contrôle ET sa bande de nom, en pixels d'écran — voir
  // la loi des noms. Quand la bande est tombée, sa place est déjà revenue
  // aux contrôles.
  const pasH = cellH * echelle + (bande ? BANDE_GRILLE_PX : 0) + ECART_PX
  const largeur = choix.colonnes * pasW - ECART_PX
  const hauteur = choix.rangees * pasH - ECART_PX
  const ox = Math.max(0, (corpsW - largeur) / 2)
  const oy = Math.max(0, (corpsH - hauteur) / 2)

  const retenus = garde.map((control, index) => {
    const boite = controlBox(control)
    const colonne = index % choix.colonnes
    const rangee = Math.floor(index / choix.colonnes)
    return {
      control,
      box: {
        x: ox + colonne * pasW + ((cellW - boite.w) / 2) * echelle,
        y: oy + rangee * pasH + ((cellH - boite.h) / 2) * echelle,
        w: boite.w * echelle,
        h: boite.h * echelle,
      },
      // Le nom dispose du pas de colonne — un élément SEUL dispose du corps
      // entier : c'est le dernier échelon, son nom est ce qu'on vient lire.
      // Bande tombée : plus de nom du tout, sa place est dans l'échelle.
      cellule: bande ? (garde.length === 1 ? Math.max(pasW, corpsW) : pasW) : 0,
    }
  })
  return { retenus, echelle, colonnes: choix.colonnes }
}
