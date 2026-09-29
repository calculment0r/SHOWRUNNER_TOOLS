// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/design/tuning.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Seuils du zoom sémantique, réglables en direct.
 *
 * Tous les paliers de l'interface découlent de quelques constantes — rapports
 * de forme, hauteur d'en-tête, marges, corps de police minimaux. Les figer dans
 * le code revient à décider une fois pour toutes pour tous les écrans, alors
 * qu'un 13 pouces en 1080p et un 35 pouces en 4K ne demandent pas les mêmes
 * valeurs. On les expose donc dans un magasin vivant : le panneau « seuils »
 * les règle au curseur, l'interface se recalcule, et un bouton copie l'état
 * pour le coller dans une conversation — c'est l'outil d'accord entre ce que
 * l'utilisateur voit et ce que le code décrète.
 *
 * Les valeurs par défaut SONT le contrat : les tests s'appuient dessus, et le
 * magasin démarre toujours dessus.
 */

                         
                                                                        
                   
                              
                     
                                                       
                   
                                                                                 
                     
                                                    
                
                                                       
                  
                                                           
                 
                                       
                 
                                                                    
                    
                                                  
                
 

export const DEFAULT_TUNING         = {
  bandRatio: 2.2,
  columnRatio: 0.7,
  headerMax: 23,
  headerShare: 0.28,
  padMax: 5,
  padShare: 0.025,
  nameMin: 9,
  nameMax: 22,
  legibleMin: 9,
  ledMax: 11,
}

let current         = { ...DEFAULT_TUNING }
const listeners = new Set            ()

export function getTuning()         {
  return current
}

export function setTuning(patch                 )       {
  current = { ...current, ...patch }
  for (const listener of listeners) listener()
}

/** Prévient à chaque changement — l'interface se recalcule alors entière. */
export function onTuning(listener            )             {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
