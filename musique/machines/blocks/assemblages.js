// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/blocks/assemblages.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * LES ASSEMBLAGES — le conteneur est l'unité, pas l'élément.
 *
 * L'étude est dans `docs/organisation-machines.md` § 3 ; ce module en est la
 * partie exécutable. Un assemblage est un conteneur qui possède ses éléments
 * et porte quatre lois : forme, élastique, dégradation, héritage.
 *
 * **La loi qui gouverne tout le reste :**
 *
 * > Un conteneur ÉLASTIQUE garde la taille de son unité et fait varier son
 * > COMPTE. Un conteneur RIGIDE garde son compte et fait varier sa taille.
 *
 * Étirer un clavier ne produit pas des touches de dix centimètres : ça produit
 * plus d'octaves. Étirer une rangée de pas ne produit pas des pas obèses : ça
 * produit plus de pas. C'est le contraire de ce que fait un responsif naïf, et
 * c'est exactement le défaut qui avait été signalé sur la TR-8S.
 *
 * Corollaire : un conteneur élastique se résout à l'ÉCHELLE DE SA MACHINE, pas
 * au zoom de la caméra. Il lit la largeur du bloc en millimètres réels et en
 * déduit combien d'unités entières y tiennent. Dézoomer la caméra ne retire
 * donc jamais une octave — ce serait absurde, on n'a rien redimensionné. Le
 * zoom sémantique n'intervient qu'après, sur ce que le conteneur a résolu.
 *
 * ── Ce qui est DÉCLARÉ ici et pas déduit
 *
 * Les données du planogramme sont plates : `machines-data.ts` ne connaît que
 * des contrôles avec des cotes. On pourrait deviner les conteneurs par la
 * géométrie ; on ne le fait pas. Deviner sur 531 contrôles produit des
 * conteneurs faux qu'on ne voit qu'à l'usage. La déclaration est courte,
 * relisible, et fausse bruyamment — les tests la confrontent aux données.
 *
 * En revanche la GÉOMÉTRIE n'est jamais déclarée : le pas d'une rangée, la
 * largeur d'une touche, l'écart de deux tranches se MESURENT sur le
 * planogramme. Recaler une machine dans le fichier de référence reste donc le
 * seul geste à faire, comme partout ailleurs dans le projet.
 */

import { controlBox,                                          } from "./machines.js"
import { boiteUtile, JEU_MM, MARGE_MM } from "./planche.js"

                                                            

/**
 * RANGÉE DE PAS — linéaire, ordonnée, élastique en compte.
 *
 * Plusieurs rangs peuvent la composer (gate · tie · pitch du SEQ-01) : ils
 * partagent l'index de pas et s'alignent en colonnes. Le compte change par
 * pages entières ; on ne disperse jamais des pas isolés.
 */
                             
                
                 
                                                                          
                          
                                         
              
                                         
                            
 

/**
 * CLAVIER — un continuum, élastique en octaves.
 *
 * Il dégrade et grandit par octaves entières, jamais par touches isolées, et
 * l'octave de départ se conserve : `keyNote` déduit la note de l'index, donc
 * ajouter des touches à droite ajoute des notes aiguës, ce qu'on attend.
 */
                              
                 
                 
                                                             
                  
                
                                
              
                                          
                            
 

/**
 * GRILLE DE TRANCHES — kit de boîte à rythme, table de mixage.
 *
 * Les paramètres sont **à l'aplomb** : le `decay` de `bd` est au-dessus du
 * `decay` de `sd`. C'est ce qui fait qu'on lit onze pistes d'un coup d'œil, et
 * ce qui interdit de dégrader en mélangeant des éléments de tranches
 * différentes.
 *
 * Élastique **vers le bas seulement** : on montre moins de tranches quand la
 * place manque, on n'invente jamais une douzième voix.
 */
                             
                
                 
                                                                      
                 
                                                                           
                         
                                                    
                           
 

                                                                  

/**
 * Les assemblages déclarés du catalogue.
 *
 * Tout ce qui n'y figure pas est une **grappe** : le cas générique, celui où
 * « moins de contrôles, plus gros, par importance » est la bonne réponse. La
 * grappe n'a pas besoin d'être déclarée — elle est ce qui reste.
 */
/**
 * Les comptes admissibles d'une rangée de pas : des PAGES DE QUATRE.
 *
 * Le grain demandé : le compte ne bouge que par valeurs de quatre pas — 16,
 * 20, 24, 32… Quatre pas font un temps ; c'est le plus petit incrément qui
 * ait un sens musical, et il remplit la largeur au plus près.
 */
const PAGES_DE_QUATRE = Array.from({ length: 16 }, (_, i) => 4 * (i + 1))

export const ASSEMBLAGES                            = [
  // SEQ-01 — les pas portent trois rangs alignés : porte, liaison, hauteur.
  {
    kind: "rangee",
    section: "sq_q3",
    rangs: ["sq_g", "sq_t", "sq_p"],
    base: 16,
    comptes: PAGES_DE_QUATRE,
  },
  // SEQ-01 — la ligne de modulation suit le même compte que les pas.
  {
    kind: "rangee",
    section: "sq_q4",
    rangs: ["sq_l"],
    base: 16,
    comptes: PAGES_DE_QUATRE,
  },
  // TR-8S — le bandeau de pas. C'est la demande F12 : 16 → 32 en l'étirant.
  {
    kind: "rangee",
    section: "tr_t5",
    rangs: ["tr_ts"],
    base: 16,
    comptes: PAGES_DE_QUATRE,
  },
  // MINILOGUE XD — les seize pas, en bande au pied de la machine.
  {
    kind: "rangee",
    section: "ml_seq",
    rangs: ["ml_st"],
    base: 16,
    comptes: PAGES_DE_QUATRE,
  },
  // KBD-01 — deux octaves au planogramme, une à cinq à l'usage.
  {
    kind: "clavier",
    section: "kb_k3",
    blanches: "kb_w",
    noires: "kb_b",
    base: 2,
    octaves: [1, 2, 3, 4, 5],
  },
  // TR-8S — le kit : onze voix, quatre paramètres, dégradation par tranches.
  {
    kind: "grille",
    section: "tr_t2",
    prefixe: "tr_",
    voix: ["bd", "sd", "lt", "mt", "ht", "rs", "hc", "ch", "oh", "cc", "rc"],
    params: ["tun", "dec", "ctl", "lv"],
  },
]

const PAR_SECTION = new Map(ASSEMBLAGES.map((a) => [a.section, a]))

/** L'assemblage déclaré d'une section, ou `null` — c'est alors une grappe. */
export function assemblageDe(sectionId        )                        {
  return PAR_SECTION.get(sectionId) ?? null
}

/** Les touches noires d'une octave, par le rang de blanche qu'elles suivent. */
const NOIRE_APRES = [0, 1, 3, 4, 5]         

/** Membres d'un rang, triés par index, avec leur index. */
function membresDuRang(
  section                ,
  racine        ,
)                                               {
  const motif = new RegExp(`^${racine}(\\d+)$`)
  const out                                               = []
  for (const control of section.controls) {
    if (!("id" in control)) continue
    const m = motif.exec(control.id)
    if (m) out.push({ index: Number(m[1]), control })
  }
  return out.sort((a, b) => a.index - b.index)
}

/**
 * Le pas d'un rang, mesuré sur le planogramme.
 *
 * Mesuré sur les `x` BRUTS et non sur `controlBox` : d'un membre au suivant la
 * convention est la même (un knob déclare son centre, les autres leur coin),
 * donc l'écart brut est le pas, quelle que soit la convention.
 */
function pasDe(membres                               )         {
  if (membres.length < 2) return 0
  return (membres[1] .control.x - membres[0] .control.x) || 0
}

/** Le plus grand compte admissible qui tienne dans la largeur disponible. */
function compteQuiTient(
  comptes                   ,
  base        ,
  largeurBase        ,
  pas        ,
  mmDispo        ,
)         {
  let retenu = comptes[0] ?? base
  for (const compte of comptes) {
    if (largeurBase + pas * (compte - base) <= mmDispo + JEU_MM) retenu = compte
  }
  return retenu
}

/**
 * Résout les assemblages élastiques d'une section pour la largeur disponible.
 *
 * `mmDispo` est la largeur du BLOC en millimètres réels — `bloc.w / échelle`,
 * jamais une largeur écran. Rendre une section inchangée quand elle n'a rien
 * d'élastique est la norme : la très grande majorité des sections sont des
 * grappes, et elles ressortent telles quelles, sans copie.
 *
 * `exposé` sert la dégradation par tranches : la voix qui porte le contrôle
 * exposé survit même si elle n'est pas la première. L'ORDRE, lui, ne change
 * jamais — on garde moins de tranches, on ne les rebat pas.
 */
export function resoudreSection(
  section                ,
  mmDispo        ,
  exposed                ,
)                 {
  const decl = assemblageDe(section.id)
  if (!decl) return section
  if (decl.kind === "rangee") return resoudreRangee(section, decl, mmDispo)
  if (decl.kind === "clavier") return resoudreClavier(section, decl, mmDispo)
  return resoudreGrille(section, decl, mmDispo, exposed ?? null)
}

/** La section résolue à son compte MAXIMAL — sert à déclarer les paramètres. */
export function sectionMaximale(section                )                 {
  return resoudreSection(section, Number.POSITIVE_INFINITY)
}

function resoudreRangee(
  section                ,
  decl            ,
  mmDispo        ,
)                 {
  const membresParRang = new Map(decl.rangs.map((r) => [r, membresDuRang(section, r)]))
  const premier = membresParRang.get(decl.rangs[0] ?? "") ?? []
  const pas = pasDe(premier)
  if (pas <= 0) return section

  // Le compte se juge sur la BOÎTE UTILE de la section — son rectangle moins la
  // marge et le bandeau que le planogramme y réserve. C'est la même boîte que
  // celle sur laquelle le rendu prend son échelle (`planche.ts`), et c'est ce
  // qui fait que le compte et l'échelle parlent enfin de la même chose.
  //
  // On comptait auparavant sur l'englobant des contrôles. Une bande est centrée
  // dans sa section : cet englobant ignorait le vide de chaque côté, si bien
  // que le compte se décidait sur une largeur que le rendu n'utilisait pas.
  const utile = boiteUtile(section)
  const compte = compteQuiTient(decl.comptes, decl.base, utile.w, pas, mmDispo)

  // LE CONTENEUR IMPOSE SON PAS À TOUS SES RANGS, et il le fait TOUJOURS —
  // même quand le compte ne bouge pas.
  //
  // Le planogramme du SEQ-01 avait étalé le rang `pitch` sur 25,667 mm quand
  // `gate` et `tie` sont à 25 : sur seize pas ça passe inaperçu, sur trente-deux
  // la dérive atteint 21 mm et les colonnes ne sont plus à l'aplomb. Un pas,
  // c'est une COLONNE — porte, liaison et hauteur du même index se lisent
  // ensemble. Aligner est donc la loi de la rangée, pas une correction de
  // données : c'est ce que veut dire « l'assemblage s'impose à ses éléments ».
  const aRegenerer = new Set                ()
  for (const membres of membresParRang.values()) for (const m of membres) aRegenerer.add(m.control)

  // LES AUTRES RANGÉES SE RECENTRENT. Le planogramme centre chaque rangée
  // dans sa section (`x = (bw - rowW) / 2` du fichier de référence) : quand le
  // compte change la largeur de la section, les contrôles qui ne sont pas des
  // pas — play, rec — doivent suivre le centre, sinon ils restent calés sur
  // une largeur qui n'existe plus et sortent du bloc au premier rétrécissement.
  const nominal = section.w + pas * (compte - decl.base)
  const decale = (nominal - section.w) / 2
  const controls                   = section.controls
    .filter((c) => !aRegenerer.has(c))
    .map((c) => (decale === 0 ? c : ({ ...c, x: c.x + decale }                  )))
  const regeneres = new Set                ()
  for (const racine of decl.rangs) {
    const membres = membresParRang.get(racine) ?? []
    const modele = membres[0]?.control
    if (!modele) continue
    for (let i = 0; i < compte; i += 1) {
      const existant = membres.find((m) => m.index === i)?.control
      const x = modele.x + pas * i
      // Un membre du planogramme garde son identité (libellé, chiffre gravé) :
      // seule son abscisse est reprise par le conteneur.
      const membre = existant ? ({ ...existant, x }                  ) : clonerIndexe(modele, `${racine}${i}`, x, i)
      regeneres.add(membre)
      controls.push(membre)
    }
  }

  // La largeur résolue se MESURE — comme pour la grille. Le composeur du
  // planogramme peut avoir PLIÉ une rangée sur deux lignes (la ligne de
  // modulation du SEQ-01) : la régénérer à son pas la déplie en une seule, et
  // la soustraction nominale la laissait déborder de la boîte déclarée. Tant
  // que le pliage n'est pas une loi du conteneur, la section s'élargit à ce
  // que son contenu occupe vraiment — rien ne sort jamais d'un bloc.
  const bordDroit = Math.max(...[...regeneres].map((c) => controlBox(c).x + controlBox(c).w))
  const wFinal = Math.max(nominal, bordDroit + MARGE_MM)

  // Et les contrôles hors rangée se CALENT dans la boîte résolue : le
  // recentrage est une intention (suivre le centre), pas un droit de sortir.
  // Une étiquette ancrée au bord gauche y reste ; un transport centré suit.
  const cales = controls.map((c) => {
    if (regeneres.has(c)) return c
    const b = controlBox(c)
    const cible = Math.min(Math.max(b.x, MARGE_MM), Math.max(MARGE_MM, wFinal - MARGE_MM - b.w))
    return cible === b.x ? c : ({ ...c, x: c.x + (cible - b.x) }                  )
  })
  return { ...section, w: wFinal, controls: cales }
}

/**
 * Clone un membre de rangée à un nouvel index.
 *
 * Le libellé ne se répète pas : le planogramme ne nomme que le premier membre
 * d'un rang (« pitch » sous le premier fader), et seize fois « pitch » serait
 * du bruit. Le chiffre de pas, lui, se renumérote — c'est son rôle.
 */
function clonerIndexe(modele                , id        , x        , index        )                 {
  const clone = { ...modele, id, x }                                   
  if ("label" in clone && index > 0) delete (clone                      ).label
  if ("digit" in clone && clone.digit) (clone                      ).digit = String(index + 1)
  return clone
}

function resoudreClavier(
  section                ,
  decl             ,
  mmDispo        ,
)                 {
  const blanches = membresDuRang(section, decl.blanches)
  const noires = membresDuRang(section, decl.noires)
  const pas = pasDe(blanches)
  if (pas <= 0 || blanches.length === 0) return section

  // Une octave vaut sept blanches ; le clavier porte en plus la tonique de
  // fermeture, comme tout clavier de matériel.
  const octaves = compteQuiTient(decl.octaves, decl.base, boiteUtile(section).w, pas * 7, mmDispo)

  const modeleBlanche = blanches[0] .control
  const modeleNoire = noires[0]?.control
  const fixes = new Set                ([...blanches, ...noires].map((m) => m.control))

  // Même recentrage que la rangée : les molettes d'un clavier suivent le
  // centre quand les octaves changent la largeur.
  const decaleClavier = (pas * 7 * (octaves - decl.base)) / 2
  const controls                   = section.controls
    .filter((c) => !fixes.has(c))
    .map((c) => (decaleClavier === 0 ? c : ({ ...c, x: c.x + decaleClavier }                  )))
  const nbBlanches = octaves * 7 + 1
  for (let i = 0; i < nbBlanches; i += 1) {
    const existant = blanches.find((m) => m.index === i)
    controls.push(
      existant && i < decl.base * 7 + 1
        ? existant.control
        : clonerIndexe(modeleBlanche, `${decl.blanches}${i}`, modeleBlanche.x + pas * i, i),
    )
  }
  if (modeleNoire) {
    // Une noire se pose à cheval sur la frontière entre deux blanches : elle
    // est CENTRÉE sur la limite, d'où le demi-largeur retranché. La mesurer
    // sur le planogramme plutôt que la poser en dur garde le recalage trivial.
    const decalage = modeleNoire.x - (modeleBlanche.x + pas)
    for (let j = 0; j < octaves * 5; j += 1) {
      const rangBlanche = (NOIRE_APRES[j % 5] ?? 0) + 7 * Math.floor(j / 5)
      const existant = noires.find((m) => m.index === j)
      controls.push(
        existant && j < decl.base * 5
          ? existant.control
          : clonerIndexe(
              modeleNoire,
              `${decl.noires}${j}`,
              modeleBlanche.x + pas * (rangBlanche + 1) + decalage,
              j,
            ),
      )
    }
  }

  // Le conteneur NORMALISE ses marges — il s'impose à ses éléments. Le
  // planogramme du clavier laisse ses touches déborder d'un côté et mordre la
  // marge de l'autre (défaut de donnée, consigné dans les tests) : le clavier
  // résolu remet le contenu à sept millimètres du bord, des deux côtés, et sa
  // largeur se MESURE. Rien ne sort jamais d'un bloc.
  const gauche = Math.min(...controls.map((c) => controlBox(c).x))
  const decalage2 = MARGE_MM - gauche
  const normalises =
    decalage2 === 0
      ? controls
      : controls.map((c) => ({ ...c, x: c.x + decalage2 })                  )
  const droit = Math.max(...normalises.map((c) => controlBox(c).x + controlBox(c).w))
  return { ...section, w: droit + MARGE_MM, controls: normalises }
}

function resoudreGrille(
  section                ,
  decl            ,
  mmDispo        ,
  exposed               ,
)                 {
  const idsDe = (voix        ) => decl.params.map((p) => `${decl.prefixe}${voix}_${p}`)
  const parVoix = new Map(
    decl.voix.map((voix) => {
      const ids = new Set(idsDe(voix))
      return [voix, section.controls.filter((c) => "id" in c && ids.has(c.id))]
    }),
  )

  // Le pas de tranche se mesure sur le premier paramètre des deux premières
  // voix : c'est l'écart qui aligne les colonnes.
  const premier = decl.params[0] ?? ""
  const xDe = (voix        ) => {
    const c = section.controls.find((k) => "id" in k && k.id === `${decl.prefixe}${voix}_${premier}`)
    return c ? c.x : null
  }
  const x0 = xDe(decl.voix[0] ?? "")
  const x1 = xDe(decl.voix[1] ?? "")
  if (x0 === null || x1 === null) return section
  const pas = x1 - x0
  if (pas <= 0) return section

  const largeurContenu = boiteUtile(section).w
  const combien = Math.max(
    1,
    Math.min(
      decl.voix.length,
      Math.floor((mmDispo + JEU_MM - (largeurContenu - pas * decl.voix.length)) / pas),
    ),
  )
  if (combien >= decl.voix.length) return section

  // La voix EXPOSÉE survit — mais l'ordre de lecture, lui, ne bouge pas : on
  // retient les voix, puis on les remet dans l'ordre du planogramme.
  const voixExposee = decl.voix.find((v) => exposed?.startsWith(`${decl.prefixe}${v}_`)) ?? null
  const classees = [...decl.voix].sort((a, b) => {
    const rang = (v        ) => (v === voixExposee ? -1 : decl.voix.indexOf(v))
    return rang(a) - rang(b)
  })
  const gardees = new Set(classees.slice(0, combien))
  const ordre = decl.voix.filter((v) => gardees.has(v))

  const retirees = new Set                ()
  for (const [voix, membres] of parVoix) {
    if (gardees.has(voix)) continue
    for (const membre of membres) retirees.add(membre)
  }

  const controls                   = []
  for (const control of section.controls) {
    if (retirees.has(control)) continue
    // Le nom d'une voix est une étiquette gravée : elle part avec sa tranche.
    if (control.kind === "text" && decl.voix.includes(control.text) && !gardees.has(control.text)) {
      continue
    }
    controls.push(control)
  }

  // LA GRILLE IMPOSE SON PAS À TOUS SES RANGS — la même loi que la rangée.
  //
  // Le planogramme calcule un écart PAR RANG (`gxOf` du fichier de référence) :
  // les colonnes de `decay` dérivent de celles de `tune` de quelques dixièmes
  // par tranche. Sur onze voix ça passe inaperçu ; dès qu'on en retire, les
  // rangs resserrés chacun à leur pas ne sont plus à l'aplomb et le dernier
  // sort de la section. Un paramètre appartient à sa COLONNE : chaque membre
  // d'une voix gardée se pose donc à l'abscisse de la voix de tête, plus un
  // nombre entier de pas — l'aplomb est la loi, pas une moyenne.
  const place = new Map(ordre.map((voix, rang) => [voix, rang]))
  const premiere = decl.voix[0] ?? ""
  const baseDe = new Map                ()
  for (const param of decl.params) {
    const c = section.controls.find((k) => "id" in k && k.id === `${decl.prefixe}${premiere}_${param}`)
    if (c) baseDe.set(param, c.x)
  }
  const texteBase = section.controls.find((c) => c.kind === "text" && c.text === premiere)
  const serrees = controls.map((control) => {
    if (control.kind === "text") {
      if (!ordre.includes(control.text) || !texteBase) return control
      const arrivee = place.get(control.text) ?? 0
      return { ...control, x: texteBase.x + pas * arrivee }
    }
    if (!("id" in control)) return control
    const voix = ordre.find((v) => control.id.startsWith(`${decl.prefixe}${v}_`))
    if (voix === undefined) return control
    const param = decl.params.find((q) => control.id === `${decl.prefixe}${voix}_${q}`)
    const base = param !== undefined ? baseDe.get(param) : undefined
    if (base === undefined) return control
    return { ...control, x: base + pas * (place.get(voix) ?? 0) }
  })

  // La largeur résolue se MESURE sur le contenu re-posé, elle ne se déduit
  // pas d'une soustraction : les rangs du planogramme n'avaient pas tous le
  // même pas, et « moins huit colonnes » laissait le dernier paramètre à
  // quelques millimètres au-delà de la boîte déclarée. La marge de droite
  // redevient celle du planogramme : sept millimètres, ni plus ni moins.
  const bordDroit = Math.max(...serrees.map((c) => controlBox(c).x + controlBox(c).w))
  return { ...section, w: bordDroit + MARGE_MM, controls: serrees }
}

// ───────────────────────────────────────────────── l'héritage

/**
 * LE RANG D'UN CONTRÔLE — ses sœurs, et sa place parmi elles.
 *
 * C'est le support de l'héritage de forme : composer un membre compose son
 * rang entier, en reportant le pas du conteneur. Personne ne redimensionne
 * seize pas un par un, ni onze `decay` l'un après l'autre.
 *
 * Rend `null` pour une grappe : là, chaque contrôle est seul de son espèce, et
 * le composer un par un est justement ce qu'on veut.
 */
export function rangDe(
  section                ,
  controlId        ,
)                                                   {
  const decl = assemblageDe(section.id)
  if (!decl) return null

  if (decl.kind === "rangee") {
    for (const racine of decl.rangs) {
      const motif = new RegExp(`^${racine}(\\d+)$`)
      if (!motif.test(controlId)) continue
      const ids = section.controls
        .filter((c)                                       => "id" in c && motif.test(c.id))
        .sort((a, b) => Number(motif.exec(a.id) [1]) - Number(motif.exec(b.id) [1]))
        .map((c) => c.id)
      return { ids, index: ids.indexOf(controlId) }
    }
    return null
  }

  if (decl.kind === "clavier") {
    // Les blanches héritent entre elles, les noires entre elles : leurs
    // gabarits diffèrent (hauteur, largeur), les confondre casserait le relief.
    for (const racine of [decl.blanches, decl.noires]) {
      const motif = new RegExp(`^${racine}(\\d+)$`)
      if (!motif.test(controlId)) continue
      const ids = section.controls
        .filter((c)                                       => "id" in c && motif.test(c.id))
        .sort((a, b) => Number(motif.exec(a.id) [1]) - Number(motif.exec(b.id) [1]))
        .map((c) => c.id)
      return { ids, index: ids.indexOf(controlId) }
    }
    return null
  }

  // Grille : le rang d'un `decay`, ce sont les `decay` de toutes les voix
  // gardées — c'est la ligne, pas la colonne. Régler la forme d'une ligne la
  // règle sur les onze pistes, ce qui est la demande exacte.
  for (const param of decl.params) {
    if (!controlId.endsWith(`_${param}`)) continue
    const voix = decl.voix.filter((v) => `${decl.prefixe}${v}_${param}` !== undefined)
    const ids = voix
      .map((v) => `${decl.prefixe}${v}_${param}`)
      .filter((id) => section.controls.some((c) => "id" in c && c.id === id))
    if (ids.length === 0) continue
    return { ids, index: ids.indexOf(controlId) }
  }
  return null
}

/**
 * L'axe le long duquel un rang se déploie — la largeur partout aujourd'hui.
 *
 * Explicite plutôt que supposé : le jour où une tranche de mixage se composera
 * verticalement, c'est ici que ça se dira, et nulle part ailleurs.
 */
export function axeDuRang(section                )            {
  void section
  return "x"
}

/** Écart relatif entre deux membres d'un rang, en fraction de leur largeur. */
export function ecartRelatifDuRang(section                , ids                   )         {
  if (ids.length < 2) return 1
  const boite = (id        ) => {
    const control = section.controls.find((c) => "id" in c && c.id === id)
    return control ? controlBox(control) : null
  }
  const a = boite(ids[0] )
  const b = boite(ids[1] )
  if (!a || !b || a.w <= 0) return 1
  return (b.x - a.x) / a.w
}
