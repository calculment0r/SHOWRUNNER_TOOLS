// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/interaction/knob.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Gabarit knob : les mathématiques pures de l'aiguille et du geste.
 *
 * Le gabarit est celui du planogramme des trois machines
 * (`UI/3_machine/README.md`, § « Gabarits de contrôles ») : cercle 1px, aiguille
 * du centre au bord, course −135° → +135°. Le geste qui le règle est un drag
 * vertical de 140px, avec un mode fin à ×0,22 sous ⇧ — des constantes propres
 * au knob, distinctes de `DRAG_RANGE`/`FINE_FACTOR` du reste de l'interface
 * (200px, ×0,25) parce que ce sont celles du planogramme d'origine, à
 * respecter pour que le recalage reste trivial.
 *
 * Pur et sans DOM, comme le reste de `interaction/` : c'est la partie qu'on
 * vérifie sans navigateur.
 */

/** Course du geste vertical qui parcourt toute la plage du knob, en px écran. */
export const KNOB_COURSE_PX = 140
/** Facteur du mode fin, touche ⇧ enfoncée. */
export const KNOB_FINE_FACTOR = 0.22
/** Butée basse de l'aiguille, en degrés. */
export const KNOB_MIN_DEG = -135
/** Amplitude totale de la course de l'aiguille, en degrés. */
export const KNOB_SWEEP_DEG = 270

/** Angle de l'aiguille pour une valeur normalisée (0 à 1). */
export function knobAngle(norm        )         {
  const clamped = Math.min(1, Math.max(0, norm))
  return KNOB_MIN_DEG + KNOB_SWEEP_DEG * clamped
}

/**
 * Nouvelle valeur normalisée après un déplacement vertical `dy` (en px écran,
 * position courante moins position de départ). Vers le haut fait monter la
 * valeur — le sens attendu partout en audio, le même que `normFromDrag`.
 */
export function knobNormFromDrag(
  startNorm        ,
  dy        ,
  fine = false,
  course = KNOB_COURSE_PX,
)         {
  // La course est réglable PAR MACHINE : un panneau dense veut un geste court,
  // un gros knob de coupure un geste long. La valeur du planogramme (140) reste
  // le défaut, et les tests l'affirment en littéral.
  const delta = (-dy / (course || KNOB_COURSE_PX)) * (fine ? KNOB_FINE_FACTOR : 1)
  return Math.min(1, Math.max(0, startNorm + delta))
}
