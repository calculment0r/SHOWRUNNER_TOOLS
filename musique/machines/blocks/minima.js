// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/blocks/minima.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * LES MINIMA DES SECTIONS EN ÉDITION — le canal entre le panneau et le canvas.
 *
 * Le panneau d'une section sait ce que ses éléments exigent (tailles fixes,
 * distances de sécurité) ; les gestes de redimensionnement, eux, vivent dans
 * le canvas et ne voient que des blocs. Ce petit magasin fait le pont : le
 * panneau publie l'encombrement minimal de son CORPS et sa taille courante
 * (en unités monde), le geste s'en sert comme BUTÉE — on ne peut pas
 * rétrécir un bloc en deçà de ce que sa composition exige. Publié seulement
 * pendant l'édition ; hors édition la règle du responsif s'adapte, elle.
 */
                                 
                                                
              
              
                                                                             
                
                
 

const minima = new Map                        ()

export function publierMinimum(sectionId        , minimum                       )       {
  if (minimum) minima.set(sectionId, minimum)
  else minima.delete(sectionId)
}

export function minimumDe(sectionId        )                        {
  return minima.get(sectionId) ?? null
}
