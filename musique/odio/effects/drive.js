// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/effects/drive.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * SATURA — saturation.
 *
 * Sa surface est la **courbe de transfert instantanée** : la fonction qui
 * transforme chaque échantillon. C'est littéralement la table appliquée par le
 * `WaveShaper`, pas une illustration — même exigence d'honnêteté que la courbe
 * du filtre.
 */

import { clamp } from "../timing.js"

import { BaseEffect, GLIDE, buildWetDry, setMix } from "./base.js"

const PARAMETERS                                 = [
  { id: "drive", label: "drive", min: 0, max: 100, default: 38, unit: "%", curve: "linear" },
  { id: "bias", label: "bias", min: -50, max: 50, default: 0, unit: "%", curve: "linear" },
  { id: "tone", label: "tone", min: 500, max: 18000, default: 8000, unit: "Hz", curve: "exponential" },
  { id: "mix", label: "mix", min: 0, max: 100, default: 100, unit: "%", curve: "linear" },
]

const TABLE_SIZE = 1024

/**
 * Fonction de transfert, pure et partagée avec l'interface.
 *
 * @param x    échantillon d'entrée, -1 à 1
 * @param drive 0-100
 * @param bias -50 à 50 — décale la courbe, ce qui fait apparaître les
 *              harmoniques paires : le grain « lampe » plutôt que « transistor »
 */
export function saturate(x        , drive        , bias        )         {
  const k = 1 + (clamp(drive, 0, 100) / 100) * 40
  const offset = clamp(bias, -50, 50) / 100
  const shape = (v        ) => Math.tanh(k * (v + offset)) / Math.tanh(k)

  // Deux corrections, dans cet ordre, et les deux sont nécessaires :
  //
  // 1. retrancher la valeur en zéro supprime la composante continue que le
  //    décalage introduit — sans quoi le signal repart avec un offset permanent ;
  // 2. renormaliser, car l'étape 1 rend la courbe asymétrique : à fort drive et
  //    fort bias, `shape` sature à 1 des deux côtés, la soustraction ramène la
  //    plage à [−2, 0] et le signal sort de ses bornes en écrasant la moitié
  //    négative. On divise donc par la plus grande excursion.
  const dc = shape(0)
  const span = Math.max(Math.abs(shape(-1) - dc), Math.abs(shape(1) - dc), 1e-9)
  return (shape(x) - dc) / span
}

export class DriveEffect extends BaseEffect {
           #shaper
           #tone
           #dry
           #wet

  constructor(context                  , id = "drive", name = "SATURA") {
    super(context, { id, name, short: "SAT", ref: "sat-09", family: "insert" }, PARAMETERS)

    this.#shaper = context.createWaveShaper()
    this.#shaper.oversample = "4x"
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
      case "drive":
      case "bias":
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
    const drive = this.getParameter("drive")
    const bias = this.getParameter("bias")
    for (let i = 0; i < TABLE_SIZE; i++) {
      curve[i] = saturate((i / (TABLE_SIZE - 1)) * 2 - 1, drive, bias)
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
