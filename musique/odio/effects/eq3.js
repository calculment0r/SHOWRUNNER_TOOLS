// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/effects/eq3.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * EQ-3 — correcteur trois bandes.
 *
 * Comme le filtre, sa surface est sa **vraie** réponse : les trois biquads
 * répondent à `getFrequencyResponse`, et on multiplie leurs magnitudes — ce qui
 * revient à additionner les décibels. Rien n'est redessiné à la main.
 *
 * Le grave et l'aigu sont des plateaux, le médium une cloche dont on déplace la
 * fréquence : c'est la découpe d'une tranche de console, celle que l'oreille
 * attend quand on lui donne trois potentiomètres.
 */


import { BaseEffect, GLIDE } from "./base.js"

export const EQ_PARAMETERS                                 = [
  { id: "low", label: "grave", min: -18, max: 18, default: 0, unit: "dB", curve: "linear" },
  { id: "mid", label: "medium", min: -18, max: 18, default: 0, unit: "dB", curve: "linear" },
  { id: "midHz", label: "centre", min: 200, max: 6000, default: 1200, unit: "Hz", curve: "exponential" },
  { id: "high", label: "aigu", min: -18, max: 18, default: 0, unit: "dB", curve: "linear" },
  { id: "width", label: "largeur", min: 0.3, max: 4, default: 1.1, unit: "Q", curve: "exponential" },
]

/** Fréquences de coude des deux plateaux, en Hz. */
const LOW_CORNER = 220
const HIGH_CORNER = 3800

export class EqEffect extends BaseEffect {
           #low
           #mid
           #high

  constructor(context                  , id = "eq", name = "EQ-3") {
    super(context, { id, name, short: "EQ", ref: "eq-03", family: "insert" }, EQ_PARAMETERS)

    this.#low = context.createBiquadFilter()
    this.#low.type = "lowshelf"
    this.#low.frequency.value = LOW_CORNER

    this.#mid = context.createBiquadFilter()
    this.#mid.type = "peaking"

    this.#high = context.createBiquadFilter()
    this.#high.type = "highshelf"
    this.#high.frequency.value = HIGH_CORNER

    this.input.connect(this.#low)
    this.#low.connect(this.#mid)
    this.#mid.connect(this.#high)
    this.#high.connect(this.stage)

    this.applyAll()
  }

            apply(id        , value        , when        )       {
    switch (id) {
      case "low":
        this.#low.gain.setTargetAtTime(value, when, GLIDE)
        break
      case "mid":
        this.#mid.gain.setTargetAtTime(value, when, GLIDE)
        break
      case "midHz":
        this.#mid.frequency.setTargetAtTime(value, when, GLIDE)
        break
      case "high":
        this.#high.gain.setTargetAtTime(value, when, GLIDE)
        break
      case "width":
        this.#mid.Q.setTargetAtTime(value, when, GLIDE)
        break
    }
  }

  /**
   * Magnitude de la chaîne complète, bande par bande.
   * Les trois réponses se multiplient : c'est ce que fait le signal en série.
   */
  getFrequencyResponse(frequencies                           )                            {
    const bytes = frequencies.length * Float32Array.BYTES_PER_ELEMENT
    const total = new Float32Array(new ArrayBuffer(bytes))
    total.fill(1)
    const magnitude = new Float32Array(new ArrayBuffer(bytes))
    const phase = new Float32Array(new ArrayBuffer(bytes))
    for (const band of [this.#low, this.#mid, this.#high]) {
      band.getFrequencyResponse(frequencies, magnitude, phase)
      for (let i = 0; i < total.length; i++) total[i]  *= magnitude[i]
    }
    return total
  }

           dispose()       {
    this.#low.disconnect()
    this.#mid.disconnect()
    this.#high.disconnect()
    super.dispose()
  }
}
