// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/blocks/registry.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Registre des blocs : ce que chacun montre, selon sa forme.
 *
 * C'est ici qu'on vérifie si la logique se déploie. Chaque bloc déclare la même
 * chose — une identité, trois listes d'emplacements, une surface — et rien
 * d'autre. Aucun bloc ne connaît le moteur de disposition, aucun n'a de cas
 * particulier dans le rendu.
 *
 * Deux règles gouvernent l'ordre des rails, et elles se vérifient bloc par bloc :
 *   1. la place manque par la fin, donc **le premier rail est le dernier à
 *      disparaître** ;
 *   2. **un rail ne sert que ce que la surface ne sait pas dire** — un
 *      paramètre déjà atteignable par un geste sur le dessin passe en dernier.
 */

             
               
             
              
              
              
           
               
               
                     
import {
  FREQ_TICKS,
  formatHz,
  freqToNorm,
  normToFreq,
  quantize,
  saturate,
} from "../moteur/index.js"
// SHOWRUNNER : la courbe du compresseur que le nœud applique vraiment (la vue Instruments s'en sert),
// à la place de compressorCurve d'ODIO_01 — voir compSurface
import { compresseur, coefs, module as moduleBiquad, linVersDb } from "../../appareils/calcul.js"
import { COMP_KNEE } from "../../odio/effects/comp.js"
// SHOWRUNNER (06/10) : les coudes des plateaux de l'EQ-3, pour sa loi (voir eqSurface)
import { LOW_CORNER, HIGH_CORNER } from "../../odio/effects/eq3.js"
                                                                
import { MACHINE_SECTIONS, sectionLayout,                 } from "./machines.js"
                                              
import { MAX_DB, MIN_DB, dbToNormY, magnitudeToDb } from "./filtre.js"

                           
            
              
               
             
                
                                                                                             
                                    
 

/**
 * La disposition d'un bloc à SCÈNE : la scène pousse, les rails suivent.
 *
 * La scène prend la place que le bloc lui laisse, exactement comme la surface
 * d'un filtre — c'est elle qu'on regarde et qu'on joue. Les rails de réglage
 * viennent dessous, et cèdent les premiers quand la place manque : une scène
 * sans ses rails reste jouable, des rails sans leur scène ne sont plus rien.
 */
function sceneLayout(ids                   ) {
  const scene = { id: "scene", min: { w: 96, h: 64 }, grow: true }
  return {
    bande: [scene, ...rows(ids, 84)],
    colonne: [scene, ...rows(ids, 72)],
    pave: [scene, ...rows(ids, 84)],
  }
}

/** Fabrique une liste de rails à partir d'identifiants, dans l'ordre donné. */
function rows(ids                   , minWidth        ) {
  // Pas de `grow` : dans un bloc à surface, c'est la surface qui absorbe la
  // place. Des rails extensibles la laissaient réduite à sa hauteur minimale.
  return ids.map((id) => ({ id: `p:${id}`, min: { w: minWidth, h: 19 } }))
}

/**
 * Disposition standard d'un bloc à surface : la surface domine et s'étire, les
 * rails complètent. Seules changent la liste des rails et leur ordre.
 */
function surfaceLayout(order                   )         {
  return {
    bande: [
      { id: "surface", min: { w: 110, h: 34 }, minRatio: 0.42, grow: true },
      { id: "scale", min: { w: 210, h: 13 } },
      ...rows(order, 190),
    ],
    colonne: [
      { id: "surface", min: { w: 46, h: 30 }, minRatio: 0.28 },
      { id: "faders", min: { w: 14, h: 52 }, grow: true },
    ],
    // La surface réclame près de la moitié du bloc : c'est elle qu'on
    // manipule, les rails ne servent que ce qu'elle ne sait pas dire.
    pave: [
      { id: "surface", min: { w: 80, h: 40 }, minRatio: 0.46, grow: true },
      ...rows(order, 112),
    ],
  }
}

const CURVE_POINTS = 200

// ───────────────────────────────────────────────────────────── FILTRE

const filtreSurface                            = {
  dragX: "cutoff",
  dragY: "reso",
  draw({ ctx, width, height, effect, colors, active }) {
    ctx.strokeStyle = colors.tick
    ctx.globalAlpha = 0.4
    ctx.beginPath()
    for (const hz of FREQ_TICKS) {
      const x = Math.round(freqToNorm(hz) * width) + 0.5
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
    }
    ctx.stroke()
    ctx.globalAlpha = 1

    const frequencies = new Float32Array(new ArrayBuffer(CURVE_POINTS * 4))
    for (let i = 0; i < CURVE_POINTS; i++) frequencies[i] = normToFreq(i / (CURVE_POINTS - 1))
    const magnitude = effect.getFrequencyResponse(frequencies)

    ctx.beginPath()
    for (let i = 0; i < CURVE_POINTS; i++) {
      const x = (i / (CURVE_POINTS - 1)) * width
      const y = dbToNormY(magnitudeToDb(magnitude[i] ?? 0)) * height
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = colors.acc
    ctx.stroke()
    fillUnder(ctx, width, height, colors.acc)

    if (active) {
      const index = Math.round(freqToNorm(effect.getParameter("cutoff")) * (CURVE_POINTS - 1))
      handle(
        ctx,
        freqToNorm(effect.getParameter("cutoff")) * width,
        dbToNormY(magnitudeToDb(magnitude[index] ?? 1)) * height,
        height,
        colors,
      )
    }
  },
}

// ───────────────────────────────────────────────────────────── SATURA

const driveSurface                           = {
  dragX: "bias",
  dragY: "drive",
  draw({ ctx, width, height, effect, colors, active }) {
    // Repères : les diagonales de la transparence, et les axes.
    ctx.strokeStyle = colors.tick
    ctx.globalAlpha = 0.5
    ctx.beginPath()
    ctx.moveTo(0, height)
    ctx.lineTo(width, 0)
    ctx.moveTo(0, height / 2)
    ctx.lineTo(width, height / 2)
    ctx.moveTo(width / 2, 0)
    ctx.lineTo(width / 2, height)
    ctx.stroke()
    ctx.globalAlpha = 1

    const drive = effect.getParameter("drive")
    const bias = effect.getParameter("bias")
    ctx.beginPath()
    for (let i = 0; i < CURVE_POINTS; i++) {
      const t = i / (CURVE_POINTS - 1)
      const x = t * width
      const y = (1 - (saturate(t * 2 - 1, drive, bias) + 1) / 2) * height
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = colors.acc
    ctx.stroke()

    if (active) handle(ctx, width / 2 + (bias / 100) * width, height / 2, height, colors)
  },
}

// ───────────────────────────────────────────────────────────── EQ-3

/** Plage verticale du correcteur, en décibels. Symétrique : le zéro est au milieu. */
const EQ_SPAN = 20

const eqSurface                        = {
  dragX: "midHz",
  dragY: "mid",
  draw({ ctx, width, height, effect, colors, active }) {
    const toY = (db        ) => (0.5 - db / (EQ_SPAN * 2)) * height

    ctx.strokeStyle = colors.tick
    ctx.globalAlpha = 0.4
    ctx.beginPath()
    for (const hz of FREQ_TICKS) {
      const x = Math.round(freqToNorm(hz) * width) + 0.5
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
    }
    ctx.stroke()
    // Le zéro : la ligne du « rien corrigé », qu'on doit voir sans la chercher.
    ctx.globalAlpha = 0.7
    ctx.beginPath()
    ctx.moveTo(0, Math.round(toY(0)) + 0.5)
    ctx.lineTo(width, Math.round(toY(0)) + 0.5)
    ctx.stroke()
    ctx.globalAlpha = 1

    // SHOWRUNNER (06/10) : la loi du moteur, une seule — appareils/calcul.js (les coefficients
    // des BiquadFilterNode de la spécification Web Audio), celle de la vue Instruments
    // (appareils/egaliseur.js) : les trois étages de l'EqEffect (odio/effects/eq3.js : plateau
    // grave à LOW_CORNER, cloche, plateau aigu à HIGH_CORNER), leurs décibels ajoutés, à la
    // fréquence d'échantillonnage du moteur (celle du jumeau, nodal.js). Avant, la courbe venait
    // de getFrequencyResponse du jumeau — un EqEffect sur un contexte hors temps réel jamais
    // rendu, dont les réglages partent par setTargetAtTime : elle restait PLATE, jusqu'à 30 dB
    // du son rendu (docs/etudes/odio_appareils.md § 5.4).
    const fs = effect.context?.sampleRate || 48000
    const etages = [
      coefs("lowshelf", LOW_CORNER, 1, effect.getParameter("low"), fs),
      coefs("peaking", effect.getParameter("midHz"), effect.getParameter("width"), effect.getParameter("mid"), fs),
      coefs("highshelf", HIGH_CORNER, 1, effect.getParameter("high"), fs),
    ]
    const gainDb = (hz        ) => etages.reduce((somme, c) => somme + linVersDb(moduleBiquad(c, hz, fs)), 0)

    ctx.beginPath()
    for (let i = 0; i < CURVE_POINTS; i++) {
      const x = (i / (CURVE_POINTS - 1)) * width
      const y = toY(gainDb(normToFreq(i / (CURVE_POINTS - 1))))
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = colors.acc
    ctx.stroke()

    if (active) {
      handle(ctx, freqToNorm(effect.getParameter("midHz")) * width, toY(effect.getParameter("mid")), height, colors)
    }
  },
}

// ───────────────────────────────────────────────────────────── CRUSH

const crushSurface                           = {
  dragX: "drive",
  dragY: "bits",
  draw({ ctx, width, height, effect, colors, active }) {
    ctx.strokeStyle = colors.tick
    ctx.globalAlpha = 0.5
    ctx.beginPath()
    // La diagonale : ce que ferait une résolution infinie. L'escalier s'en
    // écarte exactement du bruit de quantification qu'on entend.
    ctx.moveTo(0, height)
    ctx.lineTo(width, 0)
    ctx.stroke()
    ctx.globalAlpha = 1

    const bits = effect.getParameter("bits")
    const drive = effect.getParameter("drive")
    ctx.beginPath()
    for (let i = 0; i < CURVE_POINTS * 3; i++) {
      const t = i / (CURVE_POINTS * 3 - 1)
      const x = t * width
      const y = (1 - (quantize(t * 2 - 1, bits, drive) + 1) / 2) * height
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = colors.acc
    ctx.stroke()

    if (active) handle(ctx, (drive / 100) * width, height / 2, height, colors)
  },
}

// ───────────────────────────────────────────────────────────── CHORUS

const chorusSurface                            = {
  dragX: "rate",
  dragY: "depth",
  draw({ ctx, width, height, effect, colors, active }) {
    const rate = effect.getParameter("rate")
    const depth = effect.getParameter("depth") / 100

    ctx.strokeStyle = colors.tick
    ctx.globalAlpha = 0.5
    ctx.beginPath()
    ctx.moveTo(0, Math.round(height / 2) + 0.5)
    ctx.lineTo(width, Math.round(height / 2) + 0.5)
    ctx.stroke()
    ctx.globalAlpha = 1

    // Les trois oscillateurs, déphasés d'un tiers de tour : c'est littéralement
    // ce qui balaie les trois lignes de retard. Leur écartement se voit.
    const cycles = 0.6 + rate * 0.9
    for (const [index, phase] of [0, 1 / 3, 2 / 3].entries()) {
      ctx.beginPath()
      for (let i = 0; i < CURVE_POINTS; i++) {
        const t = i / (CURVE_POINTS - 1)
        const x = t * width
        const y = height / 2 - Math.sin((t * cycles + phase) * Math.PI * 2) * depth * height * 0.42
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = colors.acc
      ctx.globalAlpha = index === 0 ? 1 : 0.42
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    if (active) handle(ctx, (Math.min(1, rate / 8) * width), height / 2 - depth * height * 0.42, height, colors)
  },
}

// ───────────────────────────────────────────────────────────── COMP

const compSurface                          = {
  dragX: "threshold",
  dragY: "ratio",
  draw({ ctx, width, height, effect, colors, active }) {
    const toX = (db        ) => ((db + 60) / 60) * width
    const toY = (db        ) => height - ((db + 60) / 60) * height

    ctx.strokeStyle = colors.tick
    ctx.globalAlpha = 0.45
    ctx.beginPath()
    for (const db of [-48, -36, -24, -12]) {
      ctx.moveTo(Math.round(toX(db)) + 0.5, 0)
      ctx.lineTo(Math.round(toX(db)) + 0.5, height)
    }
    // La diagonale du « rien fait » : au-dessus, du gain (le rattrapage, le gain du module) ;
    // en dessous, réduit.
    ctx.moveTo(toX(-60), toY(-60))
    ctx.lineTo(toX(0), toY(0))
    ctx.stroke()
    ctx.globalAlpha = 1

    const threshold = effect.getParameter("threshold")
    const ratio = effect.getParameter("ratio")
    const makeup = effect.getParameter("makeup")
    // SHOWRUNNER (05/10) : la courbe que le moteur applique vraiment — le DynamicsCompressorNode
    // tel que Chromium le calcule (le genou de COMP_KNEE dB commence au seuil, il n'est pas
    // centré), plus son gain de rattrapage automatique (spécification Web Audio : (1 / courbe(0
    // dB))^0,6), puis le GainNode du module (`makeup`) : appareils/calcul.js, compresseur, la
    // même loi que la vue Instruments (docs/etudes/odio_appareils.md § 5.2). compressorCurve
    // d'ODIO_01 (genou centré, sans rattrapage) s'en écartait jusqu'à une dizaine de dB. Sans
    // butée à 0 dB : le nœud ne limite pas, au-dessus le trait sort du cadre.
    const loi = compresseur(threshold, COMP_KNEE, ratio)
    const sortie = (db        ) => loi.sortie(db) + makeup

    ctx.beginPath()
    for (let i = 0; i < CURVE_POINTS; i++) {
      const db = -60 + (i / (CURVE_POINTS - 1)) * 60
      const x = toX(db)
      const y = toY(sortie(db))
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = colors.acc
    ctx.stroke()

    // Le seuil, matérialisé : c'est le point qu'on attrape.
    ctx.strokeStyle = colors.acc2
    ctx.globalAlpha = 0.7
    ctx.beginPath()
    ctx.moveTo(Math.round(toX(threshold)) + 0.5, 0)
    ctx.lineTo(Math.round(toX(threshold)) + 0.5, height)
    ctx.stroke()
    ctx.globalAlpha = 1

    if (active) {
      handle(ctx, toX(threshold), Math.max(0, Math.min(height, toY(sortie(threshold)))), height, colors)
    }
  },
}

// ───────────────────────────────────────────────────────────── RTT-01

const delaySurface                           = {
  dragX: "time",
  dragY: "fdb",
  draw({ ctx, width, height, effect, colors, active }) {
    const span = 2.4
    ctx.strokeStyle = colors.tick
    ctx.globalAlpha = 0.4
    ctx.beginPath()
    for (let s = 0.5; s < span; s += 0.5) {
      const x = Math.round((s / span) * width) + 0.5
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
    }
    ctx.moveTo(0, height - 0.5)
    ctx.lineTo(width, height - 0.5)
    ctx.stroke()
    ctx.globalAlpha = 1

    // L'attaque sèche, puis chaque répétition : le dessin EST la structure
    // rythmique du délai, pas une décoration.
    ctx.strokeStyle = colors.ink
    ctx.beginPath()
    ctx.moveTo(0.5, height)
    ctx.lineTo(0.5, height * 0.06)
    ctx.stroke()

    ctx.strokeStyle = colors.acc
    ctx.beginPath()
    for (const tap of effect.getTaps()) {
      const x = Math.round((tap.time / span) * width) + 0.5
      if (x > width) break
      ctx.moveTo(x, height)
      ctx.lineTo(x, height - tap.level * height * 0.94)
    }
    ctx.stroke()

    if (active) {
      const x = (effect.getParameter("time") / 1000 / span) * width
      handle(ctx, x, height * 0.5, height, colors)
    }
  },
}

// ───────────────────────────────────────────────────────────── REVERB

const reverbSurface                            = {
  dragX: "damp",
  dragY: "decay",
  draw({ ctx, width, height, effect, colors, active }) {
    const tail = effect.tailSeconds
    const span = 8

    ctx.strokeStyle = colors.tick
    ctx.globalAlpha = 0.4
    ctx.beginPath()
    for (let s = 1; s < span; s++) {
      const x = Math.round((s / span) * width) + 0.5
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
    }
    ctx.stroke()
    ctx.globalAlpha = 1

    // L'enveloppe de la queue : sa longueur EST le decay, sa courbure la taille.
    ctx.beginPath()
    for (let i = 0; i < CURVE_POINTS; i++) {
      const t = (i / (CURVE_POINTS - 1)) * span
      const level = t > tail ? 0 : Math.pow(1 - t / tail, 2.6)
      const x = (t / span) * width
      const y = height - level * height * 0.94
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = colors.acc
    ctx.stroke()
    fillUnder(ctx, width, height, colors.acc)

    // L'amortissement : plus il descend, plus la pièce est sourde.
    const dampY = height * (1 - freqToNorm(effect.getParameter("damp")))
    ctx.strokeStyle = colors.acc2
    ctx.globalAlpha = 0.6
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(0, Math.round(dampY) + 0.5)
    ctx.lineTo(width, Math.round(dampY) + 0.5)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1

    if (active) handle(ctx, (Math.min(tail, span) / span) * width, height * 0.5, height, colors)
  },
}

// ───────────────────────────────────────────────────────────── communs

function fillUnder(ctx                          , width        , height        , color        ) {
  ctx.lineTo(width, height)
  ctx.lineTo(0, height)
  ctx.closePath()
  ctx.globalAlpha = 0.1
  ctx.fillStyle = color
  ctx.fill()
  ctx.globalAlpha = 1
}

/** Poignée : invisible au repos, révélée au survol. Jamais de manette permanente. */
function handle(
  ctx                          ,
  x        ,
  y        ,
  height        ,
  colors                               ,
) {
  ctx.strokeStyle = colors.acc
  ctx.globalAlpha = 0.5
  ctx.beginPath()
  ctx.moveTo(Math.round(x) + 0.5, 0)
  ctx.lineTo(Math.round(x) + 0.5, height)
  ctx.stroke()
  ctx.globalAlpha = 1

  ctx.beginPath()
  ctx.arc(x, y, 4, 0, Math.PI * 2)
  ctx.fillStyle = colors.well
  ctx.fill()
  ctx.stroke()
}

// ───────────────────────────────────────────────────────────── le registre

export const BLOCKS                           = {
  /**
   * L'AIMANT — un bloc du playground : sa surface est une SCÈNE.
   *
   * Elle occupe la place comme une surface de filtre, mais elle n'est pas
   * dessinée par `SurfaceSpec` : une scène a son propre état (le chemin qu'on
   * a tracé), sa propre horloge et son propre geste. Elle passe donc par
   * l'emplacement PROPRE du bloc (`renderOwn`), le même mécanisme que les
   * sections de machine — ce qui lui donne gratuitement le responsif, le zoom
   * sémantique du canvas et le repli sur le paramètre exposé.
   *
   * La coupure et la résonance ne sont PAS dans les rails : c'est l'aimant qui
   * les écrit, les mettre à portée de main inviterait à lutter contre lui.
   */
  aimant: {
    id: "aimant",
    name: "AIMANT",
    short: "AIM",
    ref: "jeu-06",
    layout: sceneLayout(["mesures", "type", "drive"]),
    surface: null,
  },
  ressort: {
    id: "ressort",
    name: "RESSORT",
    short: "RSRT",
    ref: "jeu-05",
    layout: sceneLayout(["decay", "size", "damp"]),
    surface: null,
  },
  pong: {
    id: "pong",
    name: "PING-PONG",
    short: "PONG",
    ref: "jeu-03",
    layout: sceneLayout(["grav", "elast", "spin", "gamme"]),
    surface: null,
  },
  pachinko: {
    id: "pachinko",
    name: "PACHINKO",
    short: "PACH",
    ref: "jeu-09",
    layout: sceneLayout(["biais", "gamme"]),
    surface: null,
  },
  fontaine: {
    id: "fontaine",
    name: "SHUFFLE FOUNTAIN",
    short: "FONT",
    ref: "jeu-00",
    layout: sceneLayout(["force", "cadence", "fusion", "maintien"]),
    surface: null,
  },
  reel: {
    id: "reel",
    name: "REEL-2",
    short: "REEL",
    ref: "jeu-01",
    layout: sceneLayout(["time", "fdb", "mix"]),
    surface: null,
  },
  alchimie: {
    id: "alchimie",
    name: "ALCHIMIE",
    short: "ALCH",
    ref: "jeu-02",
    layout: sceneLayout(["niveau", "visc", "pano"]),
    surface: null,
  },
  lancepierre: {
    id: "lancepierre",
    name: "LANCE-PIERRE",
    short: "LANC",
    ref: "jeu-04",
    layout: sceneLayout(["elastique", "vitesse", "gamme"]),
    surface: null,
  },
  ninja: {
    id: "ninja",
    name: "NINJA",
    short: "NINJ",
    ref: "jeu-07",
    layout: sceneLayout(["debit", "gamme"]),
    surface: null,
  },
  secousse: {
    id: "secousse",
    name: "SECOUSSE",
    short: "SECS",
    ref: "jeu-08",
    layout: sceneLayout(["gamme"]),
    surface: null,
  },
  grillepain: {
    id: "grillepain",
    name: "GRILLE-PAIN",
    short: "GRIL",
    ref: "jeu-10",
    layout: sceneLayout(["brunissage", "ressort"]),
    surface: null,
  },
  flipper: {
    id: "flipper",
    name: "FLIPPER",
    short: "FLIP",
    ref: "jeu-11",
    layout: sceneLayout(["gamme"]),
    surface: null,
  },
  invaders: {
    id: "invaders",
    name: "INVADERS",
    short: "INVD",
    ref: "jeu-12",
    layout: sceneLayout(["vitesse", "gamme"]),
    surface: null,
  },
  newton: {
    id: "newton",
    name: "NEWTON",
    short: "NEWT",
    ref: "jeu-13",
    layout: sceneLayout(["amorti", "gamme"]),
    surface: null,
  },
  filtre: {
    id: "filtre",
    name: "FILTRE",
    short: "FILT",
    ref: "flt-07",
    // La courbe donne coupure et réso ; drive et type n'ont aucun autre accès.
    layout: surfaceLayout(["drive", "type", "cutoff", "reso"]),
    surface: filtreSurface                      ,
  },
  drive: {
    id: "drive",
    name: "SATURA",
    short: "SAT",
    ref: "sat-09",
    // La courbe donne bias et drive ; restent tone et mix.
    layout: surfaceLayout(["tone", "mix", "drive", "bias"]),
    surface: driveSurface                      ,
  },
  comp: {
    id: "comp",
    name: "COMP",
    short: "COMP",
    ref: "cmp-03",
    // La courbe donne seuil et ratio ; attaque, release et gain n'y sont pas.
    layout: surfaceLayout(["attack", "release", "makeup", "threshold", "ratio"]),
    surface: compSurface                      ,
  },
  delay: {
    id: "delay",
    name: "RTT-01",
    short: "RTT",
    ref: "dly-01",
    // Le dessin donne time et fdb ; tone et mix restent au rail.
    layout: surfaceLayout(["tone", "mix", "time", "fdb"]),
    surface: delaySurface                      ,
  },
  reverb: {
    id: "reverb",
    name: "REVERB",
    short: "RVB",
    ref: "rvb-02",
    // L'enveloppe donne decay et damp ; taille et mix passent devant.
    layout: surfaceLayout(["size", "mix", "decay", "damp"]),
    surface: reverbSurface                      ,
  },
  eq: {
    id: "eq",
    name: "EQ-3",
    short: "EQ",
    ref: "eq-03",
    // La courbe donne le médium et sa fréquence ; grave, aigu et largeur non.
    layout: surfaceLayout(["low", "high", "width", "mid", "midHz"]),
    surface: eqSurface                      ,
  },
  crush: {
    id: "crush",
    name: "CRUSH",
    short: "CRSH",
    ref: "crs-06",
    // L'escalier donne bits et drive ; restent tone et mix.
    layout: surfaceLayout(["tone", "mix", "bits", "drive"]),
    surface: crushSurface                      ,
  },
  /**
   * BOITE A RYTHME — l'écriture d'abord.
   *
   * Le groove (niveaux + pas) occupe le centre et s'étire ; les réglages de
   * grain viennent après, et ce sont eux qui cèdent en premier. On peut perdre
   * `tune` et continuer à écrire ; on ne peut pas perdre les pas.
   */
  rythme: {
    id: "rythme",
    name: "BOITE A RYTHME",
    short: "RYT",
    ref: "ryt-06",
    layout: {
      bande: [
        { id: "groove", min: { w: 190, h: 20 }, minRatio: 0.6, grow: true },
        ...rows(["drive", "gain"], 190),
      ],
      // Étroite et haute : la grille ne tient plus en largeur, ce sont les
      // faders génériques qui prennent le relais.
      colonne: [{ id: "faders", min: { w: 14, h: 52 }, grow: true }],
      pave: [
        { id: "groove", min: { w: 120, h: 20 }, minRatio: 0.68, grow: true },
        ...rows(["drive", "gain"], 112),
      ],
    },
    surface: null,
  },
  /**
   * CLAVIER — ce qui entre dans un instrument quand on joue à la main.
   *
   * Les touches d'abord : c'est le seul contenu qui se joue. Octave, vélocité
   * et durée sont des réglages qu'on pose une fois, donc ils cèdent en premier.
   */
  /**
   * TEMPO — l'horloge posée sur le canvas.
   *
   * L'afficheur réclame l'essentiel du bloc : c'est lui qu'on lit de loin et
   * qu'on manipule. Les rails ne servent qu'au dézoom, quand l'écran n'a plus
   * la place de dire ce qu'il vaut.
   */
  tempo: {
    id: "tempo",
    name: "TEMPO",
    short: "BPM",
    ref: "tmp-01",
    layout: {
      bande: [
        { id: "tempo", min: { w: 64, h: 26 }, minRatio: 0.62, grow: true },
        ...rows(["bpm"], 190),
      ],
      colonne: [{ id: "tempo", min: { w: 44, h: 40 }, minRatio: 0.5, grow: true }],
      pave: [
        { id: "tempo", min: { w: 58, h: 40 }, minRatio: 0.6, grow: true },
        ...rows(["bpm"], 112),
      ],
    },
    surface: null,
  },
  clavier: {
    id: "clavier",
    name: "CLAVIER",
    short: "CLV",
    ref: "clv-01",
    layout: {
      bande: [
        { id: "touches", min: { w: 70, h: 14 }, minRatio: 0.5, grow: true },
        ...rows(["octave", "velocite", "duree"], 190),
      ],
      colonne: [{ id: "faders", min: { w: 14, h: 52 }, grow: true }],
      pave: [
        { id: "touches", min: { w: 70, h: 14 }, minRatio: 0.5, grow: true },
        ...rows(["octave", "velocite", "duree"], 112),
      ],
    },
    surface: null,
  },
  chorus: {
    id: "chorus",
    name: "CHORUS",
    short: "CHR",
    ref: "chr-04",
    // Le balayage donne vitesse et profondeur ; largeur et mix restent au rail.
    layout: surfaceLayout(["spread", "mix", "rate", "depth"]),
    surface: chorusSurface                      ,
  },
}

/**
 * Les sections de machine — F8.
 *
 * Chaque section détachée du planogramme entre au registre comme n'importe
 * quel autre bloc : une identité, trois listes d'emplacements, pas de surface.
 * Son emplacement propre `machine` porte le panneau ; les rails servent les
 * mêmes contrôles, et c'est ce qui donne au panneau tout le zoom sémantique
 * sans une ligne de cas particulier.
 *
 * Le panneau réclame la majeure partie du bloc (`minRatio`) : une section de
 * machine réduite à deux rails n'est plus une machine. Quand la place manque
 * vraiment, ce sont les rails qui cèdent, puis le panneau, et il reste le
 * paramètre exposé — comme partout ailleurs.
 */
export function enregistrerSectionsDe(machine            )       {
  for (const section of machine.sections) {
    // Le nom de la MACHINE ne se répète pas dans chaque section : il est déjà
    // sur le cadre du groupe, et le relire onze fois sur une TR-8S est du bruit.
    const nom = section.name.toUpperCase()
    BLOCKS[section.id] = {
      id: section.id,
      name: nom,
      short: section.name.slice(0, 4).toUpperCase(),
      ref: `${machine.id}-${section.id.split("_").slice(1).join("-")}`,
      layout: sectionLayout(section),
      surface: null,
    }
  }
}
for (const machine of new Set(MACHINE_SECTIONS.map((entree) => entree.machine))) enregistrerSectionsDe(machine)

export const DB_RANGE = { min: MIN_DB, max: MAX_DB }
export { formatHz }
