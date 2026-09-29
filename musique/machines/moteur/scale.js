// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/scale.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Mise à l'échelle des paramètres — fonctions pures.
 *
 * L'interface et le moteur doivent s'accorder exactement sur la conversion
 * entre une position (un pixel sur une courbe, un rail) et une valeur
 * physique. Si les deux la calculent chacun de leur côté, le curseur dérive
 * de la valeur réelle. Ce fichier est donc la source unique.
 *
 * L'oreille est logarithmique : une fréquence ou une durée se règle sur une
 * échelle exponentielle, jamais linéaire. Un rail linéaire de 20 Hz à 20 kHz
 * mettrait tout le spectre utile dans les premiers 5 % de sa course.
 */

import { clamp } from "../../odio/timing.js"

/** Bornes du spectre audible utilisées par les courbes de réponse. */
export const MIN_HZ = 20
export const MAX_HZ = 20000

/** Valeur physique → position normalisée 0-1, sur une échelle exponentielle. */
export function toNormExp(value        , min        , max        )         {
  const v = clamp(value, min, max)
  return Math.log(v / min) / Math.log(max / min)
}

/** Position normalisée 0-1 → valeur physique, sur une échelle exponentielle. */
export function fromNormExp(norm        , min        , max        )         {
  return min * Math.pow(max / min, clamp(norm, 0, 1))
}

export function toNormLin(value        , min        , max        )         {
  if (max === min) return 0
  return clamp((value - min) / (max - min), 0, 1)
}

export function fromNormLin(norm        , min        , max        )         {
  return min + clamp(norm, 0, 1) * (max - min)
}

/** Fréquence → position horizontale 0-1 sur une courbe de réponse. */
export function freqToNorm(hz        )         {
  return toNormExp(hz, MIN_HZ, MAX_HZ)
}

/** Position horizontale 0-1 → fréquence. */
export function normToFreq(norm        )         {
  return fromNormExp(norm, MIN_HZ, MAX_HZ)
}

/**
 * Normalise selon la courbe déclarée par le paramètre.
 * `choice` se comporte comme du linéaire : la valeur est un index.
 */
export function paramToNorm(
  value        ,
  descriptor                                                                           ,
)         {
  return descriptor.curve === "exponential"
    ? toNormExp(value, descriptor.min, descriptor.max)
    : toNormLin(value, descriptor.min, descriptor.max)
}

export function normToParam(
  norm        ,
  descriptor                                                                           ,
)         {
  return descriptor.curve === "exponential"
    ? fromNormExp(norm, descriptor.min, descriptor.max)
    : fromNormLin(norm, descriptor.min, descriptor.max)
}

/** Graduations de fréquence lisibles pour une échelle logarithmique. */
export const FREQ_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]         

/** Étiquette courte d'une fréquence : 440 → « 440 », 12000 → « 12k ». */
export function formatHz(hz        )         {
  return hz >= 1000 ? `${+(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : String(Math.round(hz))
}
