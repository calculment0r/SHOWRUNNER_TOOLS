// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/effects/table.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * LA TABLE DE MIX — une tranche de console, posable sur le général.
 *
 * Demandée le 19 août : « il nous faut aussi une table de mix, comme ça on
 * peut mettre des effets direct sur le général ». C'est exactement son rôle :
 * on y fait entrer ce qu'on veut mixer, on y règle ce qu'une console règle, et
 * on en sort vers la SORTIE — qui reste un bloc À PART, précisément pour
 * pouvoir contourner la table et retrouver le son brut d'un geste.
 *
 * **Une piste au départ**, et tout ce qui caractérise une tranche, dans
 * l'ordre où la main les rencontre sur une vraie console :
 *
 *   gain d'entrée → correcteur trois bandes → panoramique → atténuateur
 *
 * Le correcteur est celui de l'EQ-3 (mêmes coudes, même cloche déplaçable) :
 * une table qui n'aurait pas la même égalisation que le bloc EQ mentirait sur
 * ce qu'elle fait. Le gain d'entrée et l'atténuateur sont deux étages
 * distincts et c'est la raison d'être d'une tranche — on cadre le niveau qui
 * ENTRE dans la correction, puis on dose ce qui en SORT.
 *
 * Les décibels partout où l'oreille compte en décibels, le zéro à l'unité.
 */


import { BaseEffect, GLIDE } from "./base.js"
import { dbToGain } from "./volume.js"

/**
 * Les fréquences de coude, reprises de l'EQ-3 — même correcteur, mêmes cotes.
 */
const LOW_CORNER = 220
const HIGH_CORNER = 3800

export const TABLE_PARAMETERS                                 = [
  { id: "gain", label: "gain", min: -24, max: 24, default: 0, unit: "dB", curve: "linear" },
  { id: "low", label: "grave", min: -18, max: 18, default: 0, unit: "dB", curve: "linear" },
  { id: "mid", label: "medium", min: -18, max: 18, default: 0, unit: "dB", curve: "linear" },
  { id: "midHz", label: "centre", min: 200, max: 6000, default: 1200, unit: "Hz", curve: "exponential" },
  { id: "high", label: "aigu", min: -18, max: 18, default: 0, unit: "dB", curve: "linear" },
  { id: "pano", label: "pano", min: -1, max: 1, default: 0, unit: "", curve: "linear" },
  { id: "niveau", label: "niveau", min: -60, max: 12, default: 0, unit: "dB", curve: "linear" },
  { id: "envoi", label: "fx", min: -60, max: 6, default: -60, unit: "dB", curve: "linear" },
  // La COUPURE est franche et distincte du fader : couper puis rallumer doit
  // rendre EXACTEMENT le mixage qu'on avait, donc elle ne touche pas au
  // niveau. Ce n'est pas non plus le contournement du bloc (`setEnabled`),
  // qui laisserait passer le signal brut — l'exact contraire d'une coupure.
  { id: "coupe", label: "mute", min: 0, max: 1, default: 0, unit: "", curve: "linear" },
]

export class MixTable extends BaseEffect {
           #gain
           #low
           #mid
           #high
           #pan
           #fader
           #send
           #coupe

  /**
   * LE DÉPART D'EFFET — piqué APRÈS le fader, comme sur une console.
   *
   * Post-fader et pas pré-fader : c'est la convention d'un départ de mixage,
   * et c'est ce que l'oreille attend — baisser une tranche baisse aussi ce
   * qu'elle envoie à la réverbération, sinon un fader fermé continuerait de
   * mouiller le mixage.
   *
   * Il est exposé pour que la TABLE le branche sur sa boucle. Une tranche
   * seule, posée comme bloc de flux, laisse ce départ dans le vide : il ne
   * coûte rien et ne s'entend pas.
   */
  get send()           {
    return this.#send
  }

  constructor(context                  , id = "table", name = "TABLE DE MIX") {
    super(context, { id, name, short: "MIX", ref: "mix-01", family: "bus" }, TABLE_PARAMETERS)

    this.#gain = context.createGain()

    this.#low = context.createBiquadFilter()
    this.#low.type = "lowshelf"
    this.#low.frequency.value = LOW_CORNER

    this.#mid = context.createBiquadFilter()
    this.#mid.type = "peaking"

    this.#high = context.createBiquadFilter()
    this.#high.type = "highshelf"
    this.#high.frequency.value = HIGH_CORNER

    this.#pan = context.createStereoPanner()
    this.#fader = context.createGain()
    this.#send = context.createGain()
    this.#coupe = context.createGain()

    this.input.connect(this.#gain)
    this.#gain.connect(this.#low)
    this.#low.connect(this.#mid)
    this.#mid.connect(this.#high)
    this.#high.connect(this.#pan)
    this.#pan.connect(this.#fader)
    this.#fader.connect(this.#coupe)
    this.#coupe.connect(this.stage)
    // Le départ est piqué APRÈS la coupure : une tranche coupée n'envoie plus
    // rien à l'effet non plus, sinon on entendrait sa réverbération seule.
    this.#coupe.connect(this.#send)

    this.applyAll()
  }

            apply(id        , value        , when        )       {
    switch (id) {
      case "gain":
        this.#gain.gain.setTargetAtTime(dbToGain(value), when, GLIDE)
        break
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
      case "pano":
        this.#pan.pan.setTargetAtTime(value, when, GLIDE)
        break
      case "niveau":
        this.#fader.gain.setTargetAtTime(dbToGain(value), when, GLIDE)
        break
      case "envoi":
        this.#send.gain.setTargetAtTime(dbToGain(value), when, GLIDE)
        break
      case "coupe":
        this.#coupe.gain.setTargetAtTime(value >= 0.5 ? 0 : 1, when, GLIDE)
        break
    }
  }

           dispose()       {
    this.#gain.disconnect()
    this.#low.disconnect()
    this.#mid.disconnect()
    this.#high.disconnect()
    this.#pan.disconnect()
    this.#fader.disconnect()
    this.#send.disconnect()
    this.#coupe.disconnect()
    super.dispose()
  }
}
