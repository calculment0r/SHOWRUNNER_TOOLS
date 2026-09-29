// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/blocks/agencements.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * LES AGENCEMENTS ODIO — la mise en page « produit » des machines posées.
 *
 * Le planogramme (`machines-data.ts`, généré) reste la vérité des COTES : la
 * taille des sections et de leurs contrôles vient de lui, et ce module n'y
 * touche pas. Ce qu'il redit, c'est la PLACE des sections dans la machine —
 * l'organisation ODIO, distincte de la façade du constructeur quand elle sert
 * mieux le travail. Première application, demandée explicitement : le
 * séquenceur du minilogue court EN BAS, sur toute la largeur — c'est une
 * timeline, elle se lit en pleine ligne, pas dans un coin.
 *
 * Un agencement ENREGISTRÉ par le musicien passe toujours devant celui-ci ;
 * « planogramme » (l'oubli) revient ICI, pas à la façade brute — c'est
 * l'agencement de naissance des machines ODIO.
 *
 * Unités : le monde, comme `machineLayout` (mm du planogramme × échelle de
 * pose). Une section absente garde sa place de façade.
 */
/**
 * LA VERSION DE L'AGENCEMENT — à monter à CHAQUE changement ici.
 *
 * Un agencement enregistré par le musicien prime sur celui-ci, et c'est
 * juste. Mais un agencement enregistré AVANT que celui-ci ne change est
 * périmé : il fige une mise en page qu'on vient justement de corriger, et le
 * musicien voit l'ancienne sans comprendre pourquoi — c'est arrivé, le
 * séquenceur restait à droite alors qu'il était passé en bas. Un
 * enregistrement porte donc la version sous laquelle il a été fait ; sous une
 * version périmée, il est ignoré et l'agencement neuf reprend la main.
 */
export const AGENCEMENTS_VERSION = "2026-08-seq-en-bas"

export const AGENCEMENTS         
         
                                                                       
  = {
  ml: [
    { id: "ml_master", x: 0, y: 0, w: 73.6, h: 171.22 },
    { id: "ml_vmode", x: 0, y: 171.22, w: 73.6, h: 108.1 },
    { id: "ml_vco1", x: 73.6, y: 0, w: 73.6, h: 120.95 },
    { id: "ml_vco2", x: 73.6, y: 120.95, w: 73.6, h: 237.32 },
    { id: "ml_multi", x: 147.2, y: 0, w: 73.6, h: 158.82 },
    { id: "ml_mixer", x: 147.2, y: 158.82, w: 73.6, h: 105.61 },
    { id: "ml_filter", x: 220.8, y: 0, w: 73.6, h: 177.62 },
    { id: "ml_eg", x: 220.8, y: 177.62, w: 73.6, h: 99.61 },
    { id: "ml_lfo", x: 294.4, y: 0, w: 112, h: 250.02 },
    { id: "ml_fx", x: 294.4, y: 250.02, w: 112, h: 114.99 },
    { id: "ml_seq", x: 0, y: 365.01, w: 406.4, h: 57.6 },
  ],
}

/**
 * LES COMPOSITIONS DE NAISSANCE — « tout bien mis dans les blocs ».
 *
 * Les cotes du constructeur laissent de grands vides : une façade est dessinée
 * pour une plaque de métal, pas pour un bloc qu'on redimensionne. Ces cotes-ci
 * sont celles du même planogramme OPTIMISÉES dans leur bloc, par la fonction
 * même que « T » applique (`optimiserControles`) : une seule échelle par
 * section, l'ordre d'importance en tête, les distances de sécurité tenues, la
 * surface remplie. Générées, donc reproductibles — jamais posées à la main.
 *
 * Elles se comportent comme une retouche par DÉFAUT : la retouche du musicien
 * passe devant, et « planogramme » (l'oubli) revient ici. Les conteneurs
 * (rangée de pas, clavier) n'y figurent pas : leur géométrie est générée.
 *
 * En millimètres de section, convention du contrôle (le knob déclare son
 * centre). À régénérer avec `scripts/composer-planogramme.mjs` si l'agencement
 * ou les distances de sécurité changent.
 */
export const COMPOSITIONS         
         
                                                                          
  = {
  ml_master: {
    ml_mvol: { x: 46, y: 60, w: 78.01, h: 78.01 },
    ml_mtempo: { x: 46, y: 155.01, w: 78.01, h: 78.01 },
  },
  ml_vmode: {
    ml_vmode: { x: 7, y: 21, w: 78.01, h: 21.94 },
    ml_vdepth: { x: 26.5, y: 79.44, w: 39, h: 39 },
    ml_vl0: { x: 53.31, y: 59.94, w: 12.19, h: 12.19 },
    ml_vl1: { x: 72.81, y: 59.94, w: 12.19, h: 12.19 },
    ml_vl2: { x: 7, y: 115.95, w: 12.19, h: 12.19 },
    ml_vl3: { x: 72.81, y: 115.95, w: 12.19, h: 12.19 },
  },
  ml_vco1: {
    ml_v1pitch: { x: 25.5, y: 39.5, w: 37, h: 37 },
    ml_v1shape: { x: 66.51, y: 39.5, w: 37, h: 37 },
    ml_v1oct: { x: 11.17, y: 75, w: 69.66, h: 19.59 },
    ml_v1wave: { x: 19.88, y: 111.6, w: 52.24, h: 19.59 },
  },
  ml_vco2: {
    ml_v2oct: { x: 7, y: 21, w: 78.01, h: 21.94 },
    ml_v2sync: { x: 15.77, y: 59.94, w: 60.46, h: 26.82 },
    ml_v2ring: { x: 15.77, y: 103.76, w: 60.46, h: 26.82 },
    ml_v2pitch: { x: 25.28, y: 165.86, w: 36.57, h: 36.57 },
    ml_v2xmod: { x: 66.72, y: 165.86, w: 36.57, h: 36.57 },
    ml_v2shape: { x: 46, y: 219.42, w: 36.57, h: 36.57 },
    ml_v2wave: { x: 16.75, y: 254.71, w: 58.51, h: 21.94 },
  },
  ml_multi: {
    ml_mshape: { x: 46, y: 48.63, w: 55.26, h: 55.26 },
    ml_mtype: { x: 7, y: 93.26, w: 78.01, h: 29.25 },
    ml_mtypek: { x: 46, y: 159.01, w: 39, h: 39 },
  },
  ml_mixer: {
    ml_mx1: { x: 25.5, y: 39.5, w: 37, h: 37 },
    ml_mx2: { x: 66.51, y: 39.5, w: 37, h: 37 },
    ml_mx3: { x: 46, y: 93.51, w: 37, h: 37 },
  },
  ml_filter: {
    ml_cut: { x: 46, y: 60, w: 78.01, h: 78.01 },
    ml_drive: { x: 10, y: 116.01, w: 72.01, h: 27 },
    ml_res: { x: 46, y: 181.02, w: 42.01, h: 42.01 },
  },
  ml_eg: {
    ml_ega: { x: 15.25, y: 29.25, w: 16.5, h: 16.5 },
    ml_egd: { x: 35.75, y: 29.25, w: 16.5, h: 16.5 },
    ml_egs: { x: 56.26, y: 29.25, w: 16.5, h: 16.5 },
    ml_egr: { x: 76.76, y: 29.25, w: 16.5, h: 16.5 },
    ml_e2a: { x: 15.25, y: 62.75, w: 16.5, h: 16.5 },
    ml_e2d: { x: 46, y: 62.75, w: 16.5, h: 16.5 },
    ml_e2s: { x: 76.75, y: 62.75, w: 16.5, h: 16.5 },
    ml_e2i: { x: 46, y: 96.26, w: 16.5, h: 16.5 },
  },
  ml_lfo: {
    ml_lwave: { x: 7, y: 21, w: 126.01, h: 47.25 },
    ml_ltgt: { x: 7, y: 85.25, w: 126.01, h: 47.25 },
    ml_lrate: { x: 70, y: 181.01, w: 63, h: 63 },
    ml_lint: { x: 70, y: 261.01, w: 63, h: 63 },
  },
  ml_fx: {
    ml_fxtype: { x: 7, y: 21, w: 79.14, h: 29.68 },
    ml_fxtime: { x: 111.58, y: 42.43, w: 42.87, h: 42.87 },
    ml_fxdep: { x: 70, y: 102.3, w: 42.87, h: 42.87 },
  },
}

/**
 * LA COTE DE NAISSANCE D'UNE SECTION — sa boîte déclarée, ajustée au contenu.
 *
 * Le pendant indispensable de `COMPOSITIONS` : composer sans redimensionner la
 * section laisserait la boîte du constructeur autour d'un contenu qui n'a plus
 * sa forme, donc des vides et un ajustement de travers. Générée avec elle, par
 * `scripts/composer-planogramme.mjs`, et lue par `sectionRetouchee`.
 */
export const COTES                                           = {
  ml_master: { w: 92, h: 214.02 },
  ml_vmode: { w: 92, h: 135.13 },
  ml_vco1: { w: 92, h: 151.19 },
  ml_vco2: { w: 92, h: 296.65 },
  ml_multi: { w: 92, h: 198.52 },
  ml_mixer: { w: 92, h: 132.01 },
  ml_filter: { w: 92, h: 222.02 },
  ml_eg: { w: 92, h: 124.51 },
  ml_lfo: { w: 140, h: 312.52 },
  ml_fx: { w: 140, h: 143.74 },
  ml_seq: { w: 508, h: 72 },
}
