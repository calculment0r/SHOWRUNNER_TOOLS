// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/types.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Types partagés du moteur.
 *
 * Règle de conception : rien ici ne dépend du DOM, de React ou d'un framework.
 * L'interface `Instrument` est volontairement calquée sur le standard
 * Web Audio Modules (WAM) — un instrument reçoit des évènements datés sur
 * l'horloge de l'AudioContext et expose un `output` + une liste de paramètres.
 * C'est ce qui permettra de brancher de vrais plugins WAM plus tard sans
 * réécrire le séquenceur. Voir docs/architecture.md.
 */

/** Numéro de note MIDI (0-127). 60 = do central. */


/** Une note à déclencher, datée sur l'horloge de l'AudioContext. */


                        

                   

                      


                           


                                                   

                                   

                                                    



                


                                                                          
                                         
            




/**
 * Description d'un paramètre exposé par un instrument.
 * L'UI se construit à partir de cette liste — le moteur ne dessine rien.
 */








                                     
        
                            









                                           
                                                


                                                     

                                                          



/**
 * Contrat que doit remplir tout instrument branché au séquenceur.
 * Trois implémentations natives sont fournies ; un adaptateur WAM viendra
 * s'ajouter ici sans rien changer au reste du moteur.
 */


                                

                                                                                  

                                           



                             






