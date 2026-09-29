// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/effects/volume.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * VOLUME — doser et placer ce qui passe dans un câble.
 *
 * Le premier des blocs de flux : il ne transforme rien, il règle. C'est
 * précisément ce qui manquait pour qu'une chaîne soit mixable — jusqu'ici, le
 * seul niveau réglable était celui de la sortie générale, donc doser une voix
 * contre une autre demandait de changer le gain d'un effet, ce qui n'est pas la
 * même chose et ne veut pas dire la même chose.
 *
 * Le niveau est en décibels, parce que c'est ainsi que l'oreille compte et que
 * les consoles sont graduées. Le zéro est l'unité : à 0 dB, ce qui entre sort.
 */


import { BaseEffect, GLIDE } from "./base.js"

const PARAMETERS                                 = [
  { id: "niveau", label: "niveau", min: -60, max: 12, default: 0, unit: "dB", curve: "linear" },
  { id: "pano", label: "pano", min: -1, max: 1, default: 0, unit: "", curve: "linear" },
]

/** Décibels → rapport d'amplitude. Sous le plancher, c'est le silence franc. */
export function dbToGain(db        )         {
  return db <= -60 ? 0 : Math.pow(10, db / 20)
}

export class VolumeEffect extends BaseEffect {
           #gain
           #pan

  constructor(context                  , id = "volume", name = "VOLUME") {
    super(context, { id, name, short: "VOL", ref: "vol-05", family: "bus" }, PARAMETERS)
    this.#gain = context.createGain()
    this.#pan = context.createStereoPanner()
    this.input.connect(this.#gain)
    this.#gain.connect(this.#pan)
    this.#pan.connect(this.stage)
    this.applyAll()
  }

            apply(id        , value        , when        )       {
    if (id === "niveau") this.#gain.gain.setTargetAtTime(dbToGain(value), when, GLIDE)
    if (id === "pano") this.#pan.pan.setTargetAtTime(value, when, GLIDE)
  }

           dispose()       {
    this.#gain.disconnect()
    this.#pan.disconnect()
    super.dispose()
  }
}
