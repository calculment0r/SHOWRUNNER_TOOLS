// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/blocks/filtre.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Déclaration du bloc FILTRE : ses emplacements par classe de forme.
 *
 * C'est la mise en pratique de la règle §2 de la spec — allonger en largeur
 * demande une lecture horizontale (courbe longue, échelle de fréquences
 * graduée), allonger en hauteur demande une lecture verticale (faders). Le
 * contenu ne s'étire pas : il change de nature.
 */

                                              

/**
 * ORDRE DES RAILS — la règle est contre-intuitive et mérite d'être écrite.
 *
 * Les emplacements sont servis dans l'ordre et la place manque par la fin :
 * le **premier rail est donc le dernier à disparaître**. Il faut y mettre le
 * paramètre le moins accessible autrement.
 *
 * Or la courbe donne déjà `cutoff` (axe horizontal) et `reso` (axe vertical).
 * `drive`, lui, n'est atteignable par aucun geste sur la surface. C'est donc
 * lui qui doit survivre quand il ne reste qu'un seul rail — sinon la tuile
 * offre deux fois le même réglage et en perd un troisième.
 *
 * `type` ferme la marche : il se change rarement, et il dispose d'une valeur
 * « none » qui laisse passer le signal. Le placer plus haut chassait un réglage
 * courant au profit d'un réglage occasionnel.
 *
 * Règle générale : un rail ne sert que ce que la surface ne sait pas dire.
 */
export const FILTRE_LAYOUT         = {
  // Bande : la courbe prend toute la largeur et l'échelle graduée apparaît.
  // C'est le format d'analyse — on lit le spectre.
  bande: [
    { id: "curve", min: { w: 110, h: 34 }, grow: true },
    { id: "scale", min: { w: 210, h: 13 } },
    { id: "p:drive", min: { w: 190, h: 19 }, grow: true, max: 24 },
    { id: "p:cutoff", min: { w: 190, h: 19 }, grow: true, max: 24 },
    { id: "p:reso", min: { w: 190, h: 19 }, grow: true, max: 24 },
    { id: "p:type", min: { w: 190, h: 19 }, grow: true, max: 24 },
  ],
  // Colonne : les faders verticaux dominent, la courbe se réduit à un repère.
  // C'est le format de réglage — on dose.
  colonne: [
    { id: "curve", min: { w: 52, h: 38 } },
    { id: "faders", min: { w: 50, h: 76 }, grow: true },
  ],
  // Pavé : le compromis — courbe manipulable au-dessus, rails en dessous.
  pave: [
    { id: "curve", min: { w: 84, h: 44 }, grow: true },
    { id: "p:drive", min: { w: 118, h: 19 }, grow: true, max: 24 },
    { id: "p:cutoff", min: { w: 118, h: 19 }, grow: true, max: 24 },
    { id: "p:reso", min: { w: 118, h: 19 }, grow: true, max: 24 },
    { id: "p:type", min: { w: 118, h: 19 }, grow: true, max: 24 },
  ],
}

/** Plage verticale de la courbe de réponse, en décibels. */
export const MIN_DB = -34
export const MAX_DB = 22

export function magnitudeToDb(magnitude        )         {
  // Plancher pour éviter −∞ à la coupure d'un filtre très résonnant.
  return 20 * Math.log10(Math.max(magnitude, 1e-5))
}

/** dB → position verticale 0 (haut) à 1 (bas). */
export function dbToNormY(db        )         {
  return 1 - (db - MIN_DB) / (MAX_DB - MIN_DB)
}
