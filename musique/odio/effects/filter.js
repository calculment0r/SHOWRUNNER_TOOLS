// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/effects/filter.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * FILTRE — bloc d'insertion, famille `insert`.
 *
 * Premier bloc conçu selon la règle « la visualisation est le contrôle » : il
 * expose `getFrequencyResponse()`, qui n'est pas une approximation dessinée à
 * la main mais la **réponse réelle du filtre**, lue sur le nœud Web Audio. La
 * courbe affichée et le son entendu sont donc le même objet.
 *
 * Chaîne : entrée → drive (waveshaper tanh) → biquad → sortie interne
 */

import { BaseEffect, GLIDE } from "./base.js"



/**
 * « none » est un passe-tout : magnitude plate, le signal traverse sans être
 * filtré. À ne pas confondre avec l'extinction du bloc — ici le drive continue
 * d'agir, c'est un type de filtre, pas un contournement.
 */
const TYPES = ["lowpass", "highpass", "bandpass", "none"]

const BIQUAD_TYPE                                   = {
  lowpass: "lowpass",
  highpass: "highpass",
  bandpass: "bandpass",
  none: "allpass",
}

const PARAMETERS                                 = [
  { id: "cutoff", label: "coupure", min: 20, max: 20000, default: 1200, unit: "Hz", curve: "exponential" },
  { id: "reso", label: "réso", min: 0.1, max: 18, default: 3.5, curve: "exponential" },
  { id: "drive", label: "drive", min: 0, max: 100, default: 12, unit: "%", curve: "linear" },
  { id: "type", label: "type", min: 0, max: 3, default: 0, curve: "choice", choices: TYPES },
]

const DESCRIPTOR                   = {
  id: "filtre",
  name: "FILTRE",
  short: "FILT",
  ref: "flt-07",
  family: "insert",
}

/**
 * Courbe de saturation douce, tabulée une fois pour toutes.
 *
 * Le buffer est alloué explicitement : les typages Web Audio exigent un
 * `Float32Array` adossé à un `ArrayBuffer`, pas à un `SharedArrayBuffer`.
 */
function makeDriveCurve(amount        )                            {
  const n = 1024
  const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT))
  const k = 1 + (amount / 100) * 24
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / Math.tanh(k)
  }
  return curve
}

export class FilterEffect extends BaseEffect {
           #shaper
           #biquad

  constructor(context                  , id = "filtre", name = "FILTRE") {
    super(context, { ...DESCRIPTOR, id, name }, PARAMETERS)

    this.#shaper = context.createWaveShaper()
    this.#shaper.oversample = "2x"
    this.#biquad = context.createBiquadFilter()
    this.#biquad.type = "lowpass"

    this.input.connect(this.#shaper)
    this.#shaper.connect(this.#biquad)
    this.#biquad.connect(this.stage)

    this.applyAll()
  }

            apply(id        , value        , when        )       {
    switch (id) {
      case "cutoff":
        this.#biquad.frequency.setTargetAtTime(value, when, GLIDE)
        break
      case "reso":
        this.#biquad.Q.setTargetAtTime(value, when, GLIDE)
        break
      case "drive":
        // La table ne s'interpole pas : on la reconstruit. Assez rare pour être
        // sans conséquence, et `2x` d'oversampling évite le repliement.
        this.#shaper.curve = makeDriveCurve(value)
        break
      case "type":
        this.#biquad.type = BIQUAD_TYPE[TYPES[Math.round(value)] ?? "lowpass"] ?? "lowpass"
        break
    }
  }

  /**
   * Réponse en amplitude du filtre, telle qu'elle est réellement appliquée.
   *
   * @param frequencies fréquences en Hz, croissantes
   * @returns gains linéaires (1 = neutre), même longueur que l'entrée
   */
  getFrequencyResponse(frequencies                           )                            {
    const bytes = frequencies.length * Float32Array.BYTES_PER_ELEMENT
    const magnitude = new Float32Array(new ArrayBuffer(bytes))
    const phase = new Float32Array(new ArrayBuffer(bytes))
    this.#biquad.getFrequencyResponse(frequencies, magnitude, phase)
    return magnitude
  }

           dispose()       {
    this.#shaper.disconnect()
    this.#biquad.disconnect()
    super.dispose()
  }
}
