// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/effects/base.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Socle commun des blocs d'insertion.
 *
 * Chaque effet redit sinon les mêmes trente lignes : stocker les valeurs, les
 * borner, exposer les descripteurs. Ne reste à écrire que ce qui distingue
 * réellement un bloc — son graphe audio et sa réaction aux paramètres.
 */

import { clamp } from "../timing.js"



/** Lissage des changements continus — court pour suivre la main, long pour ne pas zipper. */
export const GLIDE = 0.008

export          class BaseEffect                   {
           descriptor
           input
           output

  /**
   * Sortie interne du traitement : c'est ici que la sous-classe raccorde son
   * graphe, jamais directement sur `output`. Ce point de passage est ce qui
   * rend le contournement possible sans que chaque effet ait à le gérer.
   *
   *   input ─┬─ [graphe de la sous-classe] ─ stage ─ traité ─┬─ output
   *          └──────────────── contourné ───────────────────┘
   */
                     stage

                     context
           #parameters
           #values = new Map                ()
           #processed
           #bypassed
  #enabled = true

  constructor(
    context                  ,
    descriptor                  ,
    parameters                                ,
  ) {
    this.context = context
    this.descriptor = descriptor
    this.#parameters = parameters
    this.input = context.createGain()
    this.output = context.createGain()
    this.stage = context.createGain()
    this.#processed = context.createGain()
    this.#bypassed = context.createGain()

    this.stage.connect(this.#processed)
    this.#processed.connect(this.output)
    this.input.connect(this.#bypassed)
    this.#bypassed.connect(this.output)
    // Actif par défaut : le signal passe par le traitement, pas par le pont.
    this.#bypassed.gain.value = 0

    for (const parameter of parameters) this.#values.set(parameter.id, parameter.default)
  }

  get enabled()          {
    return this.#enabled
  }

  /**
   * Éteint ou rallume le bloc.
   *
   * Le graphe reste câblé et les paramètres restent réglables : on ne fait que
   * basculer le signal sur un pont. Éteindre un bloc doit être un geste sans
   * conséquence, qu'on essaie et qu'on annule — pas une reconstruction.
   *
   * La bascule est lissée sur 12 ms : un basculement instantané produirait un
   * clic à chaque fois.
   */
  setEnabled(enabled         , atTime         )       {
    if (enabled === this.#enabled) return
    this.#enabled = enabled
    const when = atTime ?? this.context.currentTime
    this.#processed.gain.setTargetAtTime(enabled ? 1 : 0, when, 0.012)
    this.#bypassed.gain.setTargetAtTime(enabled ? 0 : 1, when, 0.012)
  }

  /** À appeler par la sous-classe une fois son graphe construit. */
            applyAll()       {
    for (const parameter of this.#parameters) {
      this.apply(parameter.id, this.getParameter(parameter.id), this.context.currentTime)
    }
  }

  getParameters()                                 {
    return this.#parameters
  }

  getParameter(id        )         {
    return this.#values.get(id) ?? 0
  }

  setParameter(id        , value        , atTime         )       {
    const descriptor = this.#parameters.find((parameter) => parameter.id === id)
    if (!descriptor) return
    const next = clamp(value, descriptor.min, descriptor.max)
    if (next === this.#values.get(id)) return
    this.#values.set(id, next)
    this.apply(id, next, atTime ?? this.context.currentTime)
  }

  /** Répercute un paramètre sur le graphe audio. */


  dispose()       {
    this.input.disconnect()
    this.stage.disconnect()
    this.#processed.disconnect()
    this.#bypassed.disconnect()
    this.output.disconnect()
  }
}

/**
 * Câble un effet en parallèle sec / traité, avec un dosage de mixage.
 * Retourne les nœuds à raccorder par la sous-classe.
 */
export function buildWetDry(context                  , input          , output          ) {
  const dry = context.createGain()
  const wet = context.createGain()
  input.connect(dry)
  dry.connect(output)
  wet.connect(output)
  return { dry, wet }
}

/** Applique un dosage 0-100 aux deux branches, en conservant la puissance perçue. */
export function setMix(dry          , wet          , percent        , when        )       {
  const x = clamp(percent, 0, 100) / 100
  // Loi de panoramique en racine : la somme des puissances reste constante,
  // sinon le niveau plonge au milieu de la course.
  dry.gain.setTargetAtTime(Math.cos((x * Math.PI) / 2), when, GLIDE)
  wet.gain.setTargetAtTime(Math.sin((x * Math.PI) / 2), when, GLIDE)
}
