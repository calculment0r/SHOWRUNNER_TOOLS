// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/plano/gabarit.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * LE GABARIT — une machine écrite comme on la décrirait, et ce qu'on en tire.
 *
 * On ne dessine pas des coordonnées. On dit : cette section a trois rangées,
 * la première porte deux sélecteurs, la seconde trois molettes de quinze
 * millimètres, et voilà. La géométrie EN DÉCOULE, par `composer()` — la
 * cellule d'un contrôle est le plus large de sa cote et de son nom, une
 * rangée aligne ses cellules, une section empile ses rangées sous son
 * bandeau, et la machine range ses sections en colonnes.
 *
 * C'est la méthode qui avait marché dans la référence de conception, et
 * c'est ce qu'il fallait pour cesser de galérer : on change une cote, tout
 * se replace ; on ajoute un contrôle, la rangée s'élargit ; et le responsif
 * du studio s'applique par-dessus, inchangé — un gabarit composé est un
 * planogramme comme les treize autres.
 *
 * Le gabarit porte aussi le BRANCHEMENT : quelle voix du moteur, et quel
 * paramètre chaque contrôle pilote, avec sa loi. Une machine dessinée sans
 * branchement est un dessin ; celle-ci sonne.
 *
 * Pur, testé, sans DOM. Le JSON d'un gabarit est ce qu'on enregistre.
 */

                                                       
             
                
              
                 
             
                
                 
                              

/** Les voix du moteur qu'un gabarit peut porter. */
// SHOWRUNNER (09/10) : les vrais moteurs aussi (machines/tuiles.js, TYPE_DE_VOIX) — Macro, le
// Synthé du studio, le Résonateur (Rings), Physique (Elements)
export const VOIX_DE_GABARIT = ["synth", "plaits", "acide", "rythme", "delay", "reverb", "comp", "notes",
  "macro", "soustractif", "resonateur", "physique"]         
                                                            

/** Les lois de branchement : comment une position 0..1 devient une valeur. */
                                        

                              
               
             
             
          
 

                                    
                   
                                                                                  
            
                
                                                             
           
           
                  
                                      
                    
                                                  
               
                        
               
               
                 
                  
                      
 

                                  
                                
                                                                       
                
 

                                   
            
             
                            
 

                          
            
             
             
                            
                                                                       
                
                                                    
                  
                                                                             
                 
                              
 

/* ────────────────────────────────────────────────────────── les cotes */

/** Le bandeau du nom de section, en haut, réservé dans la géométrie. */
export const BANDEAU = 14
/** La marge entre le bord d'une section et son premier contrôle. */
export const MARGE = 7
/** La bande d'un nom SOUS son contrôle. */
export const NOM = 12
/** L'écart par défaut entre deux cellules d'une rangée. */
export const ECART = 14
/** Le jeu entre deux rangées. */
export const JEU = 5
/** Millimètres par caractère de nom, à défaut. */
export const CHASSE = 3.6

/** Le texte qu'un contrôle affiche sous lui — un sélecteur écrit `nom · option`. */
function texteDuNom(controle                   )         {
  if (!controle.label) return ""
  if (controle.kind === "switch" && controle.options?.length) {
    const longue = [...controle.options].sort((a, b) => b.length - a.length)[0] ?? ""
    return `${controle.label} · ${longue}`
  }
  return controle.label
}

/** La largeur que réclame un nom, en mm. */
export function largeurDuNom(controle                   , chasse = CHASSE)         {
  const texte = texteDuNom(controle)
  return texte.length ? texte.length * chasse + 2 : 0
}

/** Un contrôle porte-t-il un nom sous lui ? Les gravures et afficheurs, non. */
function porteUnNom(controle                   )          {
  return controle.kind !== "text" && controle.kind !== "display" && controle.kind !== "led" && controle.kind !== "key" && controle.kind !== "pad" && Boolean(controle.label)
}

/* ────────────────────────────────────────────────────────── composer */

                           
                         
           
           
 

function composerSection(gabarit         , decl                  )                  {
  const chasse = gabarit.chasse ?? CHASSE
  const prefixe = gabarit.id
  const controls                   = []
  let y = BANDEAU
  let largeur = 0

  for (const rangee of decl.rangees) {
    const ecart = rangee.ecart ?? ECART
    const cellules = rangee.controles.map((controle) => ({
      controle,
      w: Math.max(controle.w, porteUnNom(controle) ? largeurDuNom(controle, chasse) : 0),
    }))
    const hauteurControles = Math.max(0, ...cellules.map((c) => c.controle.h))
    const avecNom = cellules.some((c) => porteUnNom(c.controle))
    const hauteurRangee = hauteurControles + (avecNom ? NOM : 0)
    let x = MARGE
    for (const { controle, w } of cellules) {
      const xCoin = x + (w - controle.w) / 2
      const yCoin = y + (hauteurControles - controle.h) / 2
      controls.push(controleVersMachine(controle, prefixe, xCoin, yCoin))
      x += w + ecart
    }
    largeur = Math.max(largeur, x - ecart + MARGE)
    y += hauteurRangee + JEU
  }

  const h = Math.max(BANDEAU + MARGE, y - JEU + MARGE)
  const w = Math.max(2 * MARGE + 10, largeur)
  return {
    section: { id: `${prefixe}_${decl.id}`, name: decl.nom, x: 0, y: 0, w, h, controls },
    w,
    h,
  }
}

/**
 * Le contrôle du planogramme, à partir de sa déclaration et de son coin.
 * Un knob déclare son CENTRE — c'est la convention du planogramme, gravée par
 * un test dans `machines.ts` ; tout le reste déclare son coin.
 */
function controleVersMachine(c                   , prefixe        , xCoin        , yCoin        )                 {
  const id = `${prefixe}_${c.id}`
  const base = { w: c.w, h: c.h }
  switch (c.kind) {
    case "knob":
      return { kind: "knob", id, label: c.label ?? "", x: xCoin + c.w / 2, y: yCoin + c.h / 2, ...base, default: c.default ?? 0.5, ...(c.format ? { format: c.format } : {}) }
    case "switch":
      return { kind: "switch", id, label: c.label ?? "", x: xCoin, y: yCoin, ...base, options: c.options?.length ? c.options : ["off", "on"], default: Math.round(c.default ?? 0) }
    case "fader":
      return { kind: "fader", id, label: c.label ?? "", x: xCoin, y: yCoin, ...base, default: c.default ?? 0.7 }
    case "button":
      return { kind: "button", id, label: c.label ?? "", x: xCoin, y: yCoin, ...base, default: (c.default ?? 0) >= 0.5 ? 1 : 0, ...(c.text ? { digit: c.text } : {}) }
    case "pad":
      return { kind: "pad", id, x: xCoin, y: yCoin, ...base, default: (c.default ?? 0) >= 0.5 ? 1 : 0 }
    case "led":
      return { kind: "led", id, x: xCoin, y: yCoin, ...base, default: c.default ?? 0 }
    case "text":
      return { kind: "text", x: xCoin, y: yCoin, ...base, text: c.text ?? c.label ?? "" }
    case "display":
      return { kind: "display", x: xCoin, y: yCoin, ...base, text: c.text ?? "" }
    case "wheel":
      return { kind: "wheel", id, label: c.label ?? "", x: xCoin, y: yCoin, ...base, default: c.default ?? 0.5, ...(c.spring ? { spring: true } : {}), ...(c.format ? { format: c.format } : {}) }
    case "key":
      return { kind: "key", id, x: xCoin, y: yCoin, ...base, default: 0, ...(c.black ? { black: true } : {}) }
    case "ribbon":
      return { kind: "ribbon", id, label: c.label ?? "", x: xCoin, y: yCoin, ...base, default: c.default ?? 0 }
    case "orbit":
      return { kind: "orbit", id, label: c.label ?? "", x: xCoin, y: yCoin, ...base, default: c.default ?? 0.5 }
    case "matrix":
      return { kind: "matrix", id, label: c.label ?? "", x: xCoin, y: yCoin, ...base, rows: c.rows ?? 4, cols: c.cols ?? 4, default: c.default ?? 0 }
    case "curve":
      return { kind: "curve", id, label: c.label ?? "", x: xCoin, y: yCoin, ...base, default: c.default ?? 0.5 }
    case "vu":
      return { kind: "vu", id, label: c.label ?? "", x: xCoin, y: yCoin, ...base, default: c.default ?? 0 }
  }
}

/** La loi compilée : une position 0..1 → une valeur dans l'unité du paramètre. */
export function compilerLoi(b             )                           {
  const { min, max, loi } = b
  if (loi === "exp") {
    const a = Math.max(min, 1e-6)
    return (n) => a * Math.pow(Math.max(max, a) / a, Math.min(1, Math.max(0, n)))
  }
  if (loi === "rond") return (n) => Math.round(min + (max - min) * Math.min(1, Math.max(0, n)))
  return (n) => min + (max - min) * Math.min(1, Math.max(0, n))
}

                                  
                     
                       
 

/**
 * COMPOSER : du gabarit au planogramme, et à son moteur.
 *
 * Les sections se rangent en `colonnes` colonnes, de gauche à droite puis de
 * haut en bas ; chaque colonne s'ouvre après la section la plus large de la
 * précédente, chaque rang est haut comme sa section la plus haute. Les
 * sections gardent leur propre largeur.
 */
export function composer(gabarit         )                  {
  const composees = gabarit.sections.map((decl) => composerSection(gabarit, decl))
  const colonnes = Math.max(1, Math.min(gabarit.colonnes || 1, Math.max(1, composees.length)))
  const largeurs           = []
  const hauteurs           = []
  composees.forEach((s, i) => {
    const col = i % colonnes
    const rang = Math.floor(i / colonnes)
    largeurs[col] = Math.max(largeurs[col] ?? 0, s.w)
    hauteurs[rang] = Math.max(hauteurs[rang] ?? 0, s.h)
  })
  const xDe = (col        ) => largeurs.slice(0, col).reduce((a, b) => a + b, 0)
  const yDe = (rang        ) => hauteurs.slice(0, rang).reduce((a, b) => a + b, 0)
  // Une section garde SA largeur — celle de son contenu. L'étirer à la colonne
  // faisait un VCO de 544 mm à côté d'un séquenceur, avec ses trois molettes
  // perdues au milieu. Elle prend en revanche la hauteur de son rang : un rang
  // est une ligne de blocs jointifs, et c'est le bas qui doit s'aligner.
  const sections                   = composees.map((s, i) => {
    const col = i % colonnes
    const rang = Math.floor(i / colonnes)
    return { ...s.section, x: xDe(col), y: yDe(rang), w: s.w, h: hauteurs[rang] ?? s.h }
  })
  const w = largeurs.reduce((a, b) => a + b, 0)
  const h = hauteurs.reduce((a, b) => a + b, 0)

  const map                       = {}
  for (const decl of gabarit.sections) {
    for (const rangee of decl.rangees) {
      for (const c of rangee.controles) {
        if (c.moteur) map[`${gabarit.id}_${c.id}`] = { param: c.moteur.param, from: compilerLoi(c.moteur) }
      }
    }
  }
  const voix = gabarit.voix
  const moteur                = {
    voice: voix,
    outSection: `${gabarit.id}_${gabarit.sortie}`,
    // SHOWRUNNER (09/10) : les voix mélodiques neuves reçoivent des notes
    notesIn: ["synth", "plaits", "acide", "macro", "soustractif", "resonateur", "physique"].includes(voix),
    map,
  }
  return {
    machine: { id: gabarit.id, name: gabarit.nom, ref: gabarit.ref, x: 0, y: 0, w, h, sections },
    moteur,
  }
}

/* ─────────────────────────────────────── d'un planogramme à un gabarit */

/**
 * LIRE UNE MACHINE EXISTANTE COMME UN GABARIT.
 *
 * Les treize planogrammes ont des coordonnées absolues ; on les regroupe en
 * rangées par leur hauteur, on trie chaque rangée par sa gauche, et on
 * retire le préfixe de machine des identifiants. Ce n'est pas une inversion
 * exacte — c'est un point de départ pour reprendre une machine dans PLANO,
 * et c'est exactement ce qu'on veut : la recomposer proprement.
 */
export function gabaritDepuisMachine(machine            , moteur                )          {
  const prefixe = `${machine.id}_`
  const local = (id        ) => (id.startsWith(prefixe) ? id.slice(prefixe.length) : id)
  const sections                     = machine.sections.map((section) => {
    const boites = section.controls.map((control) => {
      const centre = control.kind === "knob"
      const x = centre ? control.x - control.w / 2 : control.x
      const y = centre ? control.y - control.h / 2 : control.y
      return { control, x, y, cy: y + control.h / 2 }
    })
    boites.sort((a, b) => a.cy - b.cy || a.x - b.x)
    const rangees                    = []
    let courante                = []
    let reference = -Infinity
    for (const b of boites) {
      const tolerance = Math.max(4, b.control.h / 2)
      if (courante.length && Math.abs(b.cy - reference) > tolerance) {
        rangees.push(rangeeDepuis(courante, local, moteur))
        courante = []
      }
      if (!courante.length) reference = b.cy
      courante.push(b)
    }
    if (courante.length) rangees.push(rangeeDepuis(courante, local, moteur))
    return { id: local(section.id), nom: section.name, rangees }
  })
  const sortie = moteur ? local(moteur.outSection) : (sections[0]?.id ?? "master")
  const voix = moteur?.voice ?? null
  return {
    id: machine.id,
    nom: machine.name,
    ref: machine.ref,
    voix: voix === "table" ? null : (voix                        ),
    sortie,
    colonnes: Math.max(1, Math.round(Math.sqrt(sections.length * 1.6))),
    sections,
  }
}

/**
 * Une rangée relue. Huit petits éléments identiques ou plus — des pas, des
 * diodes, des touches — forment une RANGÉE SERRÉE : l'écart d'une rangée de
 * pas, pas celui de deux molettes nommées.
 */
function rangeeDepuis(
  boites                                               ,
  local                        ,
  moteur                ,
)                  {
  const tries = [...boites].sort((p, q) => p.x - q.x)
  const controles = tries.map((e) => controleDepuisMachine(e.control, local, moteur))
  // Le genre et la cote les plus fréquents de la rangée : si presque tout
  // est pareil et sans nom — des pas, des diodes, des touches — c'est une
  // bande, pas une rangée de réglages.
  const comptes = new Map                ()
  for (const e of tries) {
    const cle = `${e.control.kind}|${e.control.w}|${e.control.h}`
    comptes.set(cle, (comptes.get(cle) ?? 0) + 1)
  }
  const [cleMode, nombre] = [...comptes.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0]
  const genre = cleMode.split("|")[0]
  const sansNom = tries.filter((e) => `${e.control.kind}|${e.control.w}|${e.control.h}` === cleMode && !("label" in e.control && e.control.label)).length
  const serree =
    tries.length >= 8 &&
    nombre >= tries.length * 0.8 &&
    sansNom >= nombre * 0.8 &&
    (genre === "button" || genre === "led" || genre === "pad" || genre === "key")
  return serree ? { controles, ecart: 5 } : { controles }
}

function controleDepuisMachine(control                , local                        , moteur                )                    {
  const base                    = { kind: control.kind, id: "id" in control ? local(control.id) : "", w: control.w, h: control.h }
  if ("label" in control && control.label) base.label = control.label
  if ("default" in control && typeof control.default === "number") base.default = control.default
  if (control.kind === "switch") base.options = [...control.options]
  if (control.kind === "text" || control.kind === "display") base.text = control.text
  if ("format" in control && control.format) base.format = control.format
  if (control.kind === "matrix") { base.rows = control.rows; base.cols = control.cols }
  if (control.kind === "key" && control.black) base.black = true
  if (control.kind === "wheel" && control.spring) base.spring = true
  if (control.kind === "button" && control.digit) base.text = control.digit
  if (moteur && "id" in control) {
    const entree = moteur.map[control.id]
    if (entree) base.moteur = devinerBranchement(entree)
  }
  return base
}

/**
 * Retrouver la loi d'un branchement écrit en fonction : on l'échantillonne.
 * Un milieu à mi-chemin est linéaire ; un milieu à la moyenne géométrique
 * est exponentiel ; des entiers sur une petite plage sont arrondis.
 */
export function devinerBranchement(entree                                                )              {
  const min = entree.from(0)
  const max = entree.from(1)
  const milieu = entree.from(0.5)
  const entier = Number.isInteger(min) && Number.isInteger(max) && Number.isInteger(entree.from(0.3)) && Number.isInteger(entree.from(0.7))
  if (entier && Math.abs(max - min) <= 32) return { param: entree.param, min, max, loi: "rond" }
  if (min > 0 && max > 0 && Math.abs(milieu - Math.sqrt(min * max)) < Math.abs(milieu - (min + max) / 2)) {
    return { param: entree.param, min, max, loi: "exp" }
  }
  return { param: entree.param, min, max, loi: "lin" }
}

/* ─────────────────────────────────────────────────── lecture, écriture */

/** Un gabarit vide, à remplir : une section, une rangée, une molette. */
export function gabaritVierge(id = "nouvelle")          {
  return {
    id,
    nom: "NOUVELLE MACHINE",
    ref: "odio · gabarit",
    voix: "synth",
    sortie: "master",
    colonnes: 2,
    sections: [
      {
        id: "master",
        nom: "master",
        rangees: [{ controles: [{ kind: "knob", id: "vol", label: "volume", w: 15, h: 15, default: 0.8, moteur: { param: "gain", min: 0, max: 1, loi: "lin" } }] }],
      },
    ],
  }
}

/** Ce qu'un paramètre du moteur propose comme branchement par défaut. */
export function branchementParDefaut(descripteur                     )              {
  return {
    param: descripteur.id,
    min: descripteur.min,
    max: descripteur.max,
    loi: descripteur.curve === "exponential" ? "exp" : descripteur.curve === "choice" ? "rond" : "lin",
  }
}

/** Les défauts qui manquent, comblés — pour un JSON lu depuis n'importe où. */
export function normaliser(brut         )          {
  const id = (brut.id || "gabarit").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "gabarit"
  return {
    ...brut,
    id,
    nom: brut.nom || id.toUpperCase(),
    ref: brut.ref || "odio · gabarit",
    voix: VOIX_DE_GABARIT.includes(brut.voix                 ) ? brut.voix : null,
    colonnes: Math.max(1, Math.round(brut.colonnes || 1)),
    sortie: brut.sortie || brut.sections[0]?.id || "master",
    sections: brut.sections.map((s) => ({
      id: (s.id || "section").toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      nom: s.nom || s.id,
      rangees: s.rangees.map((r) => ({
        ...(r.ecart !== undefined ? { ecart: r.ecart } : {}),
        controles: r.controles.map((c) => ({
          ...c,
          id: (c.id || "c").toLowerCase().replace(/[^a-z0-9]+/g, "_"),
          w: Math.max(2, Number(c.w) || 10),
          h: Math.max(2, Number(c.h) || 10),
        })),
      })),
    })),
  }
}
