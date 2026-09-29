// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/interaction/clavier-ordinateur.ts
// Types retirés à la main (une seule annotation) ; voir musique/PROVENANCE.md.

/**
 * Les touches de l'ordinateur, par POSITION physique et non par lettre.
 *
 * `event.code` désigne la touche là où elle est sur la machine : la même
 * rangée tombe sous les mêmes doigts en AZERTY comme en QWERTY. Utiliser la
 * lettre imprimée dessus aurait décalé tout le clavier d'un demi-ton selon le
 * pays.
 */
export const COMPUTER_KEYS = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6,
  KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12,
}
