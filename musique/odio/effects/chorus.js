// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/effects/chorus.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * CHORUS — épaississement par retards modulés.
 *
 * Trois lignes de retard très courtes, chacune balayée par son propre
 * oscillateur basse fréquence déphasé d'un tiers de tour. C'est le déphasage
 * qui distingue un chorus d'un vibrato : les trois copies ne montent et ne
 * descendent jamais ensemble, donc elles battent entre elles.
 *
 * Sa surface est le **plan de modulation** : en abscisse la vitesse, en
 * ordonnée la profondeur — les deux grandeurs qui décident du caractère, du
 * léger scintillement au désaccord franc.
 */

import { clamp } from "../timing.js"

import { BaseEffect, GLIDE, buildWetDry, setMix } from "./base.js"

const PARAMETERS                                 = [
  { id: "rate", label: "vitesse", min: 0.05, max: 8, default: 0.7, unit: "Hz", curve: "exponential" },
  { id: "depth", label: "profond", min: 0, max: 100, default: 45, unit: "%", curve: "linear" },
  { id: "spread", label: "largeur", min: 0, max: 100, default: 70, unit: "%", curve: "linear" },
  { id: "mix", label: "mix", min: 0, max: 100, default: 50, unit: "%", curve: "linear" },
]

/** Retard central de chaque voix, en secondes. */
const BASE_DELAY = [0.011, 0.017, 0.023]
/** Excursion maximale de la modulation, en secondes. */
const MAX_SWING = 0.006








export class ChorusEffect extends BaseEffect {
           #voices          = []
           #dry
           #wet

  constructor(context                  , id = "chorus", name = "CHORUS") {
    super(context, { id, name, short: "CHR", ref: "chr-04", family: "insert" }, PARAMETERS)

    const { dry, wet } = buildWetDry(context, this.input, this.stage)
    this.#dry = dry
    this.#wet = wet

    BASE_DELAY.forEach((base, index) => {
      const delay = context.createDelay(0.1)
      delay.delayTime.value = base
      const lfo = context.createOscillator()
      lfo.type = "sine"
      // Un tiers de tour d'écart : c'est le déphasage qui fait le chorus.
      // Un `OscillatorNode` ne prend pas de phase, on la simule par un délai
      // de démarrage sur la période la plus lente qu'on puisse jouer.
      const swing = context.createGain()
      swing.gain.value = 0
      lfo.connect(swing)
      swing.connect(delay.delayTime)
      lfo.start(context.currentTime + (index / 3) * 0.37)

      const pan = context.createStereoPanner()
      this.input.connect(delay)
      delay.connect(pan)
      pan.connect(this.#wet)

      this.#voices.push({ delay, lfo, swing, pan })
    })

    this.applyAll()
  }

            apply(id        , value        , when        )       {
    switch (id) {
      case "rate":
        for (const voice of this.#voices) voice.lfo.frequency.setTargetAtTime(value, when, GLIDE)
        break
      case "depth": {
        const swing = (clamp(value, 0, 100) / 100) * MAX_SWING
        for (const voice of this.#voices) voice.swing.gain.setTargetAtTime(swing, when, GLIDE)
        break
      }
      case "spread": {
        const width = clamp(value, 0, 100) / 100
        // Voix gauche, centre, droite : au maximum elles s'écartent en entier.
        const places = [-1, 0, 1]
        this.#voices.forEach((voice, index) => {
          voice.pan.pan.setTargetAtTime(places[index]  * width, when, GLIDE)
        })
        break
      }
      case "mix":
        setMix(this.#dry, this.#wet, value, when)
        break
    }
  }

           dispose()       {
    for (const voice of this.#voices) {
      try {
        voice.lfo.stop()
      } catch {
        // Jamais démarré : rien à arrêter.
      }
      voice.lfo.disconnect()
      voice.swing.disconnect()
      voice.delay.disconnect()
      voice.pan.disconnect()
    }
    this.#dry.disconnect()
    this.#wet.disconnect()
    super.dispose()
  }
}
