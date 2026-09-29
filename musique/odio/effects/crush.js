// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/effects/crush.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * CRUSH — quantification de la résolution.
 *
 * Sa surface est la **courbe de transfert réelle**, comme celle de SATURA :
 * ici un escalier. Réduire le nombre de bits, c'est réduire le nombre de
 * marches, et le signal doit choisir la plus proche — le bruit de quantification
 * qu'on entend est exactement l'écart entre la diagonale et l'escalier.
 *
 * Ce que ce bloc ne fait pas, et il faut le dire : il ne décime pas la
 * fréquence d'échantillonnage. Cela demanderait un `AudioWorklet`, donc un
 * module séparé — impossible à tenir dans un fichier HTML unique sans artifice.
 * `tone` filtre la sortie, ce qui adoucit le grain sans prétendre décimer.
 */

import { clamp } from "../timing.js"

import { BaseEffect, GLIDE, buildWetDry, setMix } from "./base.js"

const PARAMETERS                                 = [
  { id: "bits", label: "bits", min: 1.5, max: 16, default: 6, unit: "b", curve: "linear" },
  { id: "drive", label: "drive", min: 0, max: 100, default: 30, unit: "%", curve: "linear" },
  { id: "tone", label: "tone", min: 400, max: 18000, default: 9000, unit: "Hz", curve: "exponential" },
  { id: "mix", label: "mix", min: 0, max: 100, default: 100, unit: "%", curve: "linear" },
]

const TABLE_SIZE = 2048

/**
 * Courbe de quantification, pure et partagée avec l'interface.
 *
 * @param x    échantillon d'entrée, -1 à 1
 * @param bits résolution, 1.5 à 16 — fractionnaire, parce que la transition
 *             d'un nombre de marches au suivant doit s'entendre progressivement
 * @param drive 0-100 — gain avant l'escalier : plus on pousse, plus on occupe
 *             de marches, donc moins on entend la quantification
 */
export function quantize(x        , bits        , drive        )         {
  const gain = 1 + (clamp(drive, 0, 100) / 100) * 3
  const pushed = clamp(x * gain, -1, 1)
  const steps = Math.pow(2, clamp(bits, 1.5, 16)) / 2
  return Math.round(pushed * steps) / steps
}

export class CrushEffect extends BaseEffect {
           #shaper
           #tone
           #dry
           #wet

  constructor(context                  , id = "crush", name = "CRUSH") {
    super(context, { id, name, short: "CRSH", ref: "crs-06", family: "insert" }, PARAMETERS)

    this.#shaper = context.createWaveShaper()
    // Surtout pas de suréchantillonnage : il lisserait l'escalier, donc
    // exactement ce qu'on cherche à entendre.
    this.#shaper.oversample = "none"
    this.#tone = context.createBiquadFilter()
    this.#tone.type = "lowpass"

    const { dry, wet } = buildWetDry(context, this.input, this.stage)
    this.#dry = dry
    this.#wet = wet

    this.input.connect(this.#shaper)
    this.#shaper.connect(this.#tone)
    this.#tone.connect(this.#wet)

    this.#renderCurve()
    this.applyAll()
  }

            apply(id        , value        , when        )       {
    switch (id) {
      case "bits":
      case "drive":
        this.#renderCurve()
        break
      case "tone":
        this.#tone.frequency.setTargetAtTime(value, when, GLIDE)
        break
      case "mix":
        setMix(this.#dry, this.#wet, value, when)
        break
    }
  }

  #renderCurve()       {
    const curve = new Float32Array(new ArrayBuffer(TABLE_SIZE * Float32Array.BYTES_PER_ELEMENT))
    const bits = this.getParameter("bits")
    const drive = this.getParameter("drive")
    for (let i = 0; i < TABLE_SIZE; i++) {
      curve[i] = quantize((i / (TABLE_SIZE - 1)) * 2 - 1, bits, drive)
    }
    this.#shaper.curve = curve
  }

           dispose()       {
    this.#shaper.disconnect()
    this.#tone.disconnect()
    this.#dry.disconnect()
    this.#wet.disconnect()
    super.dispose()
  }
}
