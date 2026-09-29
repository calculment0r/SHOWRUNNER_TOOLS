// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/instruments/drums-voices.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * LES ONZE VOIX D'UNE BOÎTE À RYTHME, ET LES DEUX CIRCUITS QUI LES FONT.
 *
 * Ce fichier ne contient que des DONNÉES et des fonctions pures : la table des
 * voix, et pour chacune la recette de son timbre dans les deux machines. Le
 * graphe Web Audio est monté ailleurs (`rhythm-box.ts`) — ici, rien qui touche
 * au contexte audio, donc tout est testable sans navigateur.
 *
 * Pourquoi ONZE et pas six : une TR-8S a onze instruments, et son planogramme
 * expose onze faders. Avec six voix, le fader du tom bas pilotait le charley
 * et celui du rimshot pilotait le tom — le geste ne disait pas la vérité.
 *
 * Pourquoi DEUX circuits et pas un jeu de réglages : une 808 et une 909 ne
 * sont pas la même machine réglée autrement. La 808 est entièrement analogique
 * — sa grosse caisse est un pont en T qui sonne longtemps, ses métaux sont six
 * carrés inharmoniques. La 909 est hybride : ses peaux sont analogiques avec
 * une attaque bruitée bien plus violente, et ses métaux étaient des
 * échantillons. Deux tables, donc, et l'honnêteté de le dire.
 *
 * ⚠️ CE QUE CETTE ÉMULATION N'EST PAS. Le charley, la crash et la ride d'une
 * 909 sont des enregistrements DANS la vraie machine. Synthétisés, ils
 * resteront des approximations — plus brillants et plus longs que ceux de la
 * 808, ce qui est l'essentiel de la différence à l'oreille, mais pas la vraie
 * cymbale. C'était le choix assumé de tout garder hors ligne.
 */

/** Les deux machines. Le mot est court parce qu'il s'affiche dans un knob. */

export const KITS                 = ["808", "909"]

/** Comment une voix fabrique son son. */

                            

                                  

                  

                                                                     


/**
 * La recette d'une voix dans une machine donnée.
 *
 * Tout est en unités physiques (Hz, secondes, rapports) : ce sont les cotes du
 * circuit, pas des nombres arbitraires — on peut donc les discuter.
 */


         

        


                         
                                             


          

                              





                    



                                  






                                                    



                                                          

                           






/** Les six carrés inharmoniques de la 808 — les rapports du circuit d'origine. */
const METAL_808 = [1, 1.342, 1.2312, 1.6532, 1.9523, 2.1547]
/** La 909 avait des échantillons : on l'approche avec un métal plus dense et plus haut. */
const METAL_909 = [1, 1.19, 1.417, 1.781, 2.115, 2.629, 3.077]

/**
 * LES ONZE VOIX, dans l'ordre du panneau : les graves à gauche, les métaux à
 * droite. C'est l'ordre d'une TR-8S, et celui de ses onze faders.
 */
export const VOIX                  = [
  {
    note: 36, id: "bd", nom: "GROSSE", court: "BD", ctrl: "attaque",
    tune: { min: 30, max: 90 }, chute: { min: 0.08, max: 1.8 },
    kits: {
      // La 808 : un pont en T qui résonne. Elle tient longtemps et descend peu.
      "808": { moteur: "peau", hauteur: 52, chute: 0.62, saut: 2.1, glisse: 0.05, souffle: 0.04, couleur: 2000, niveau: 1 },
      // La 909 : plus courte, un saut plus violent, et un clic d'attaque net.
      "909": { moteur: "peau", hauteur: 56, chute: 0.38, saut: 4.6, glisse: 0.022, souffle: 0.14, couleur: 3200, niveau: 1 },
    },
  },
  {
    note: 37, id: "sd", nom: "CAISSE", court: "SD", ctrl: "timbre",
    tune: { min: 90, max: 400 }, chute: { min: 0.04, max: 0.8 },
    kits: {
      // Deux partiels accordés, peu de souffle : la caisse 808 est sèche et creuse.
      "808": { moteur: "caisse", hauteur: 186, chute: 0.19, saut: 1, glisse: 0.004, souffle: 0.45, couleur: 1400, niveau: 0.95, bandes: [186, 294] },
      // La 909 est bien plus bruitée, c'est sa signature.
      "909": { moteur: "caisse", hauteur: 208, chute: 0.24, saut: 1, glisse: 0.004, souffle: 0.78, couleur: 1800, niveau: 0.95, bandes: [208, 336] },
    },
  },
  {
    note: 38, id: "lt", nom: "TOM BAS", court: "LT", ctrl: "chute",
    tune: { min: 60, max: 200 }, chute: { min: 0.1, max: 1.2 },
    kits: {
      "808": { moteur: "peau", hauteur: 88, chute: 0.5, saut: 1.5, glisse: 0.09, souffle: 0.03, couleur: 900, niveau: 0.9 },
      "909": { moteur: "peau", hauteur: 92, chute: 0.42, saut: 1.9, glisse: 0.06, souffle: 0.22, couleur: 1200, niveau: 0.9 },
    },
  },
  {
    note: 39, id: "mt", nom: "TOM MED", court: "MT", ctrl: "chute",
    tune: { min: 90, max: 300 }, chute: { min: 0.08, max: 1 },
    kits: {
      "808": { moteur: "peau", hauteur: 130, chute: 0.42, saut: 1.5, glisse: 0.08, souffle: 0.03, couleur: 1100, niveau: 0.9 },
      "909": { moteur: "peau", hauteur: 138, chute: 0.36, saut: 1.9, glisse: 0.055, souffle: 0.22, couleur: 1500, niveau: 0.9 },
    },
  },
  {
    note: 40, id: "ht", nom: "TOM HAUT", court: "HT", ctrl: "chute",
    tune: { min: 130, max: 420 }, chute: { min: 0.06, max: 0.9 },
    kits: {
      "808": { moteur: "peau", hauteur: 190, chute: 0.35, saut: 1.5, glisse: 0.07, souffle: 0.03, couleur: 1400, niveau: 0.9 },
      "909": { moteur: "peau", hauteur: 200, chute: 0.3, saut: 1.9, glisse: 0.05, souffle: 0.22, couleur: 1900, niveau: 0.9 },
    },
  },
  {
    note: 41, id: "rs", nom: "RIMSHOT", court: "RS", ctrl: "corps",
    tune: { min: 900, max: 2600 }, chute: { min: 0.02, max: 0.2 },
    kits: {
      "808": { moteur: "bruit", hauteur: 1700, chute: 0.045, saut: 1, glisse: 0.002, souffle: 0.6, couleur: 1500, niveau: 0.8, bandes: [1700, 480] },
      "909": { moteur: "bruit", hauteur: 1900, chute: 0.038, saut: 1, glisse: 0.002, souffle: 0.75, couleur: 1800, niveau: 0.8, bandes: [1900, 520] },
    },
  },
  {
    note: 42, id: "cp", nom: "CLAP", court: "CP", ctrl: "ecart",
    tune: { min: 700, max: 3000 }, chute: { min: 0.05, max: 0.7 },
    kits: {
      "808": { moteur: "bruit", hauteur: 1450, chute: 0.24, saut: 1, glisse: 0.002, souffle: 1, couleur: 1000, niveau: 0.85, bandes: [1450], bouffees: { nombre: 3, ecart: 0.011 } },
      "909": { moteur: "bruit", hauteur: 1650, chute: 0.3, saut: 1, glisse: 0.002, souffle: 1, couleur: 1200, niveau: 0.85, bandes: [1650], bouffees: { nombre: 4, ecart: 0.009 } },
    },
  },
  {
    note: 43, id: "ch", nom: "CHARLEY", court: "CH", ctrl: "serrage",
    tune: { min: 4000, max: 14000 }, chute: { min: 0.02, max: 0.3 },
    kits: {
      "808": { moteur: "metal", hauteur: 8400, chute: 0.055, saut: 1, glisse: 0.001, souffle: 0.1, couleur: 7000, niveau: 0.62, partiels: METAL_808 },
      "909": { moteur: "metal", hauteur: 9200, chute: 0.048, saut: 1, glisse: 0.001, souffle: 0.34, couleur: 8000, niveau: 0.62, partiels: METAL_909 },
    },
  },
  {
    note: 44, id: "oh", nom: "OUVERT", court: "OH", ctrl: "ouverture",
    tune: { min: 4000, max: 14000 }, chute: { min: 0.1, max: 1.4 },
    kits: {
      "808": { moteur: "metal", hauteur: 8000, chute: 0.42, saut: 1, glisse: 0.001, souffle: 0.1, couleur: 6200, niveau: 0.58, partiels: METAL_808 },
      "909": { moteur: "metal", hauteur: 8800, chute: 0.55, saut: 1, glisse: 0.001, souffle: 0.34, couleur: 7000, niveau: 0.58, partiels: METAL_909 },
    },
  },
  {
    note: 45, id: "cc", nom: "CRASH", court: "CC", ctrl: "brillance",
    tune: { min: 3000, max: 12000 }, chute: { min: 0.3, max: 3.5 },
    kits: {
      "808": { moteur: "metal", hauteur: 6400, chute: 1.5, saut: 1, glisse: 0.001, souffle: 0.14, couleur: 4200, niveau: 0.5, partiels: METAL_808 },
      "909": { moteur: "metal", hauteur: 7000, chute: 2.1, saut: 1, glisse: 0.001, souffle: 0.42, couleur: 4800, niveau: 0.5, partiels: METAL_909 },
    },
  },
  {
    note: 46, id: "rc", nom: "RIDE", court: "RC", ctrl: "brillance",
    tune: { min: 3000, max: 12000 }, chute: { min: 0.2, max: 3 },
    kits: {
      "808": { moteur: "metal", hauteur: 7200, chute: 0.9, saut: 1, glisse: 0.001, souffle: 0.08, couleur: 5200, niveau: 0.48, partiels: METAL_808 },
      "909": { moteur: "metal", hauteur: 7800, chute: 1.3, saut: 1, glisse: 0.001, souffle: 0.26, couleur: 6000, niveau: 0.48, partiels: METAL_909 },
    },
  },
]

export const PREMIERE_NOTE = 36

export const voixDeNote = (note        )                   => VOIX.find((voix) => voix.note === note)

/** Le timbre d'une voix dans un kit — la donnée que le graphe audio lira. */
export const timbreDe = (voix      , kit     )         => voix.kits[kit]

/* ------------------------------------------------------- calculs purs */

export const borner = (valeur        , min        , max        )         =>
  Math.min(max, Math.max(min, valeur))

/**
 * La hauteur de départ d'une frappe : la voix accordée, multipliée par son
 * saut d'attaque. `ctrl` la creuse ou l'accentue selon la voix.
 */
export function hauteurAttaque(timbre        , accord        , ctrl        )         {
  const saut = timbre.moteur === "peau" ? 1 + (timbre.saut - 1) * (0.35 + ctrl * 1.3) : timbre.saut
  return accord * saut
}

/**
 * La durée réelle d'une frappe, queue comprise — ce qui décide quand on peut
 * jeter les nœuds. `ctrl` allonge les métaux (un charley qu'on ouvre) et
 * n'allonge rien d'autre.
 */
export function dureeFrappe(timbre        , chute        , ctrl        )         {
  const allonge = timbre.moteur === "metal" ? 1 + ctrl * 2.2 : 1
  const bouffees = timbre.bouffees ? timbre.bouffees.nombre * timbre.bouffees.ecart : 0
  return chute * allonge + bouffees + 0.05
}

/**
 * Le mélange corps/souffle d'une caisse claire. `ctrl` est le « timbre » de la
 * machine : à zéro on n'entend que le corps accordé, à fond que le timbre.
 */
export function melangeCaisse(timbre        , ctrl        )                                     {
  const souffle = borner(timbre.souffle * (0.35 + ctrl * 1.3), 0, 1.2)
  return { corps: borner(1 - ctrl * 0.55, 0, 1), souffle }
}
