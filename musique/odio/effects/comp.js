// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/effects/comp.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * COMP — compresseur.
 *
 * Sa surface est la **courbe de transfert** : entrée en abscisse, sortie en
 * ordonnée, en décibels. On y tire le point de coude — c'est le seuil — et on
 * plie la pente — c'est le ratio. Deux paramètres, un seul geste, exactement
 * comme la coupure et la résonance sur le filtre.
 */


import { BaseEffect, GLIDE } from "./base.js"

const PARAMETERS                                 = [
  { id: "threshold", label: "seuil", min: -60, max: 0, default: -22, unit: "db", curve: "linear" },
  { id: "ratio", label: "ratio", min: 1, max: 20, default: 4, unit: "x", curve: "exponential" },
  { id: "attack", label: "attaque", min: 0.001, max: 0.4, default: 0.008, unit: "s", curve: "exponential" },
  { id: "release", label: "release", min: 0.02, max: 1.2, default: 0.25, unit: "s", curve: "exponential" },
  { id: "makeup", label: "gain", min: 0, max: 18, default: 3, unit: "db", curve: "linear" },
]

/** Adoucissement du coude, en décibels. */
export const COMP_KNEE = 8

export class CompEffect extends BaseEffect {
           #comp
           #makeup

  constructor(context                  , id = "comp", name = "COMP") {
    super(context, { id, name, short: "COMP", ref: "cmp-03", family: "insert" }, PARAMETERS)

    this.#comp = context.createDynamicsCompressor()
    this.#comp.knee.value = COMP_KNEE
    this.#makeup = context.createGain()

    this.input.connect(this.#comp)
    this.#comp.connect(this.#makeup)
    this.#makeup.connect(this.stage)

    this.applyAll()
  }

            apply(id        , value        , when        )       {
    switch (id) {
      case "threshold":
        this.#comp.threshold.setTargetAtTime(value, when, GLIDE)
        break
      case "ratio":
        this.#comp.ratio.setTargetAtTime(value, when, GLIDE)
        break
      case "attack":
        this.#comp.attack.setTargetAtTime(value, when, GLIDE)
        break
      case "release":
        this.#comp.release.setTargetAtTime(value, when, GLIDE)
        break
      case "makeup":
        this.#makeup.gain.setTargetAtTime(Math.pow(10, value / 20), when, GLIDE)
        break
    }
  }

  /** Réduction de gain instantanée, en dB (négative). Pour un vumètre. */
  get reduction()         {
    return this.#comp.reduction
  }

           dispose()       {
    this.#comp.disconnect()
    this.#makeup.disconnect()
    super.dispose()
  }
}

/**
 * Courbe de transfert du compresseur, en décibels.
 *
 * Reproduit la formule de `DynamicsCompressorNode` : sous le seuil moins un
 * demi-genou le signal passe intact, au-dessus du seuil plus un demi-genou il
 * est réduit du ratio, et entre les deux une interpolation quadratique adoucit
 * le coude. Fonction pure : c'est ce qui la rend testable.
 */
export function compressorCurve(
  inputDb        ,
  threshold        ,
  ratio        ,
  makeup = 0,
  knee = COMP_KNEE,
)         {
  const lower = threshold - knee / 2
  const upper = threshold + knee / 2

  let output
  if (inputDb <= lower) {
    output = inputDb
  } else if (inputDb >= upper) {
    output = threshold + (inputDb - threshold) / ratio
  } else {
    // Raccord quadratique entre la pente 1 et la pente 1/ratio.
    const over = inputDb - lower
    output = inputDb + ((1 / ratio - 1) * over * over) / (2 * knee)
  }
  return output + makeup
}
