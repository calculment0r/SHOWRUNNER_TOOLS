// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/effects/reverb.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * REVERB — réverbération à convolution, sur une réponse impulsionnelle
 * synthétisée : bruit blanc enveloppé d'une décroissance exponentielle.
 *
 * Le choix de la convolution n'est pas gratuit : c'est la même mécanique qui
 * permettra plus tard de **déposer un fichier audio sur le bloc pour qu'il
 * devienne la pièce** (voir l'étude, A3). Le geste-signature d'ODIO tient à ce
 * que la réverbe soit convolutive dès le départ.
 */


import { BaseEffect, GLIDE, buildWetDry, setMix } from "./base.js"

const PARAMETERS                                 = [
  { id: "size", label: "taille", min: 5, max: 100, default: 55, unit: "%", curve: "linear" },
  { id: "decay", label: "decay", min: 0.2, max: 8, default: 2.4, unit: "s", curve: "exponential" },
  { id: "damp", label: "damp", min: 400, max: 18000, default: 5200, unit: "Hz", curve: "exponential" },
  { id: "mix", label: "mix", min: 0, max: 100, default: 32, unit: "%", curve: "linear" },
]

export class ReverbEffect extends BaseEffect {
           #convolver
           #damp
           #dry
           #wet
  /** Évite de régénérer la réponse à chaque pixel d'un glissement. */
  #pending                                       = null

  constructor(context                  , id = "reverb", name = "REVERB") {
    super(context, { id, name, short: "RVB", ref: "rvb-02", family: "insert" }, PARAMETERS)

    this.#convolver = context.createConvolver()
    this.#damp = context.createBiquadFilter()
    this.#damp.type = "lowpass"

    const { dry, wet } = buildWetDry(context, this.input, this.stage)
    this.#dry = dry
    this.#wet = wet

    this.input.connect(this.#damp)
    this.#damp.connect(this.#convolver)
    this.#convolver.connect(this.#wet)

    this.#renderImpulse()
    this.applyAll()
  }

            apply(id        , value        , when        )       {
    switch (id) {
      case "damp":
        this.#damp.frequency.setTargetAtTime(value, when, GLIDE)
        break
      case "mix":
        setMix(this.#dry, this.#wet, value, when)
        break
      case "size":
      case "decay":
        // Une réponse impulsionnelle de plusieurs secondes coûte cher à
        // fabriquer : on attend la fin du geste plutôt que de la recalculer
        // soixante fois par seconde.
        if (this.#pending !== null) clearTimeout(this.#pending)
        this.#pending = setTimeout(() => {
          this.#pending = null
          this.#renderImpulse()
        }, 90)
        break
    }
  }

  /** Durée réelle de la queue, en secondes — utile au dessin de la surface. */
  // SHOWRUNNER : l'export hors temps réel ne peut pas attendre les 90 ms du
  // geste — la réponse se refait tout de suite si elle est en attente.
  flush() {
    if (this.#pending === null) return
    clearTimeout(this.#pending)
    this.#pending = null
    this.#renderImpulse()
  }

  get tailSeconds()         {
    return this.getParameter("decay") * (0.3 + this.getParameter("size") / 100)
  }

  #renderImpulse()       {
    const rate = this.context.sampleRate
    const seconds = Math.min(8, this.tailSeconds)
    const length = Math.max(1, Math.floor(rate * seconds))
    const buffer = this.context.createBuffer(2, length, rate)

    // Pré-délai proportionnel à la taille : une grande pièce met plus longtemps
    // à renvoyer sa première réflexion.
    const preDelay = Math.floor(rate * 0.005 * (this.getParameter("size") / 100) * 4)

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel)
      for (let i = 0; i < length; i++) {
        if (i < preDelay) {
          data[i] = 0
          continue
        }
        const t = (i - preDelay) / (length - preDelay || 1)
        // Décroissance exponentielle : la queue s'éteint sans coupure franche.
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6)
      }
    }
    this.#convolver.buffer = buffer
  }

           dispose()       {
    if (this.#pending !== null) clearTimeout(this.#pending)
    this.#convolver.disconnect()
    this.#damp.disconnect()
    this.#dry.disconnect()
    this.#wet.disconnect()
    super.dispose()
  }
}
