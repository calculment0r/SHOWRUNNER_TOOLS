// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/effects/delay.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * RTT-01 — délai à réinjection, avec un filtre dans la boucle.
 *
 * Le filtre est *dans* la boucle, pas après : chaque répétition passe donc à
 * travers, et s'assombrit un peu plus que la précédente. C'est ce qui fait
 * l'écho dub, et c'est aussi la démonstration concrète de l'imbrication
 * décrite dans l'étude (A3) — un bloc déposé dans la boucle de réinjection d'un
 * autre.
 */

import { clamp } from "../timing.js"

import { BaseEffect, GLIDE, buildWetDry, setMix } from "./base.js"

const MAX_DELAY = 2.4

const PARAMETERS                                 = [
  { id: "time", label: "time", min: 20, max: 2000, default: 340, unit: "ms", curve: "exponential" },
  { id: "fdb", label: "fdb", min: 0, max: 92, default: 42, unit: "%", curve: "linear" },
  { id: "tone", label: "tone", min: 300, max: 16000, default: 3400, unit: "Hz", curve: "exponential" },
  { id: "mix", label: "mix", min: 0, max: 100, default: 28, unit: "%", curve: "linear" },
]

export class DelayEffect extends BaseEffect {
           #delay
           #feedback
           #tone
           #dry
           #wet

  constructor(context                  , id = "delay", name = "RTT-01") {
    super(context, { id, name, short: "RTT", ref: "dly-01", family: "insert" }, PARAMETERS)

    this.#delay = context.createDelay(MAX_DELAY)
    this.#feedback = context.createGain()
    this.#tone = context.createBiquadFilter()
    this.#tone.type = "lowpass"

    const { dry, wet } = buildWetDry(context, this.input, this.stage)
    this.#dry = dry
    this.#wet = wet

    this.input.connect(this.#delay)
    this.#delay.connect(this.#tone)
    this.#tone.connect(this.#feedback)
    // La boucle : le signal filtré retourne à l'entrée du délai.
    this.#feedback.connect(this.#delay)
    this.#tone.connect(this.#wet)

    this.applyAll()
  }

            apply(id        , value        , when        )       {
    switch (id) {
      case "time":
        this.#delay.delayTime.setTargetAtTime(clamp(value / 1000, 0.001, MAX_DELAY), when, GLIDE)
        break
      case "fdb":
        // Plafonné à 92 % par le descripteur : au-delà la boucle diverge et
        // le niveau part à l'infini.
        this.#feedback.gain.setTargetAtTime(value / 100, when, GLIDE)
        break
      case "tone":
        this.#tone.frequency.setTargetAtTime(value, when, GLIDE)
        break
      case "mix":
        setMix(this.#dry, this.#wet, value, when)
        break
    }
  }

  /**
   * Instants et niveaux des répétitions successives — c'est ce que dessine la
   * surface, et ce sur quoi on tirera pour déplacer un tap.
   */
  getTaps(max = 12)                                         {
    const interval = this.getParameter("time") / 1000
    const gain = this.getParameter("fdb") / 100
    const taps                                         = []
    let level = 1
    for (let i = 1; i <= max; i++) {
      level *= gain
      if (level < 0.01) break
      taps.push({ time: interval * i, level })
    }
    return taps
  }

           dispose()       {
    this.#delay.disconnect()
    this.#feedback.disconnect()
    this.#tone.disconnect()
    this.#dry.disconnect()
    this.#wet.disconnect()
    super.dispose()
  }
}
