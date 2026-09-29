// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/interaction/drag.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Un seul chemin pour tous les gestes tirés.
 *
 * Chaque geste de l'interface — déplacer une tuile, tirer une arête, étirer un
 * groupe, régler un paramètre — répétait le même montage : deux écouteurs sur
 * `window`, retirés au relâché. Ça marche tant que rien ne sort du cadre, et
 * trois choses en sortent :
 *
 *   - **le pointeur dépasse la poignée.** Une poignée suit ce qu'elle
 *     redimensionne ; dès que le geste bute sur une taille minimale, ou qu'on
 *     va plus vite qu'elle, le pointeur se retrouve au-dessus du canvas et
 *     hérite de son curseur. On voyait la main de déplacement au milieu d'un
 *     redimensionnement.
 *   - **le pointeur sort de la fenêtre.** Sans capture, `pointermove` cesse
 *     d'arriver, et le geste se fige sur sa dernière valeur connue.
 *   - **le navigateur annule le pointeur** (`pointercancel`) sans jamais
 *     envoyer de `pointerup`. Le geste reste alors accroché : on relâche le
 *     bouton et l'objet continue de suivre la souris.
 *
 * `beginDrag` répond aux trois : capture du pointeur, écoute de l'annulation,
 * et curseur imposé à toute la page pour la durée du geste.
 */

                              
                                                                 
                                     
     
                                                                        
    
                                                                           
                                                                               
                                                            
     
                                      
     
                                                     
    
                                                                            
                                                                           
     
                 
 

/** Classe posée sur `<html>` le temps du geste — voir app.css. */
export const DRAGGING_CLASS = "dragging"

                         
                                                 
                                                     
                                                    
 

export function beginDrag(
  event                                                          ,
  options             ,
)       {
  if (typeof window === "undefined") return
  const target = event.currentTarget                                        
  const { pointerId } = event

  // La capture garde le geste vivant hors de la fenêtre. Elle peut échouer si
  // le pointeur a déjà disparu — ce n'est pas une raison d'abandonner le geste,
  // les écouteurs sur `window` suffisent alors.
  try {
    target?.setPointerCapture?.(pointerId)
  } catch {
    /* pointeur déjà relâché */
  }

  const root = document.documentElement
  const previousCursor = root.style.cursor
  if (options.cursor) root.style.cursor = options.cursor
  root.classList.add(DRAGGING_CLASS)

  let done = false
  const move = (moveEvent              ) => {
    if (!done) options.move(moveEvent)
  }
  const finish = (endEvent               ) => {
    if (done) return
    done = true
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", onUp)
    window.removeEventListener("pointercancel", onCancel)
    root.style.cursor = previousCursor
    root.classList.remove(DRAGGING_CLASS)
    try {
      if (target?.hasPointerCapture?.(pointerId)) target.releasePointerCapture?.(pointerId)
    } catch {
      /* capture déjà rendue */
    }
    options.end?.(endEvent)
  }
  const onUp = (upEvent              ) => finish(upEvent)
  const onCancel = () => finish()

  // Seul le relâchement porte une position exploitable : une annulation ne dit
  // pas où le geste s'est arrêté, donc elle ne transmet rien.
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", onUp)
  window.addEventListener("pointercancel", onCancel)
}
