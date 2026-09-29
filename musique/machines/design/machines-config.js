// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/design/machines-config.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * La configuration PAR MACHINE — réglages de conception et agencement sauvés.
 *
 * Chaque machine a sa logique propre : l'échelle du minilogue n'a aucune
 * raison d'être celle de la TR-8S. Les réglages vivent donc PAR machine, dans
 * le panneau qui s'ouvre à sa gauche — pas dans le panneau global des seuils,
 * qui règle l'interface, pas les instruments.
 *
 * C'est aussi l'outil de fabrication de planogrammes : on détache les blocs
 * (`g`), on recompose l'agencement à la main, `t` redresse, et « enregistrer »
 * fige la configuration — l'agencement des blocs entre eux ET les paramètres
 * de règle. Toute machine posée ensuite naît dans cette configuration, et
 * « remonter » y revient.
 *
 * Première persistance du projet (localStorage), volontairement bornée aux
 * machines : le registre G7 (tout sauvegarder) reste ouvert.
 */

/**
 * Les réglages d'une machine, GROUPÉS PAR TYPOLOGIE.
 *
 * L'étude (`docs/organisation-machines.md` § 2) dit que chaque genre de
 * contrôle a son geste, sa lecture et sa taille de visée. Il lui faut donc ses
 * propres réglages : un knob se règle par son diamètre, la longueur de son
 * aiguille et la course de son geste — pas par « une échelle » commune à tout
 * le panneau. Et la typographie a deux corps, pas un : le silkscreen d'une
 * machine dense n'est pas celui d'une machine aérée.
 *
 * Tout est PAR MACHINE : le minilogue et la MicroFreak partent des mêmes
 * valeurs mais divergent dès le premier réglage.
 */
                                
               
     
                                                                              
    
                                                                             
                                                                           
                                                                               
                                                                             
                                                                         
                                                                         
     
               
                                                  
     
                                                
    
                                                                           
                                                                      
                                                                             
                                                                         
             
     
                   
     
                                                    
    
                                                                           
                                                                              
                          
     
                       

                                
                                                                        
                  
                                                                                        
                  
                                           
                       
                                                   
                  

            
                                    
                   
                                                      
                    
                                                                     
                    

             
                                               
                    
                                  
                     

                   
                                                   
                    

                  
                                                            
                  
 

export const DEFAULT_MACHINE_DESIGN                = {
  scale: 0.8,
  margeBloc: 6,
  ecartElements: 5,
  labelMax: 11,
  labelMin: 9,
  labelTracking: 0.04,
  labelGap: 2,
  knobScale: 1,
  knobNeedle: 0.88,
  knobCourse: 140,
  faderTrack: 1,
  faderCursor: 3,
  digitScale: 1,
  ledScale: 1,
}

/** Un bloc de l'agencement sauvé, relatif au coin haut-gauche de la machine. */
                             
                                                                      
                 
           
           
           
           
 

/**
 * LA COMPOSITION D'UN PALIER — le cœur de l'outil.
 *
 * Un palier n'est pas un filtre appliqué au planogramme : c'est une
 * **composition à part entière**. À la planche, le panneau montre l'appareil
 * réel ; en macros, il montre ce que le musicien a composé POUR cette taille —
 * volume et tempo en gros, le reste écarté. Ce sont deux dessins, pas un
 * dessin rétréci.
 *
 * Les places sont en coordonnées NORMALISÉES (0 à 1 de la boîte du panneau) :
 * une composition vaut donc à toute taille de tuile dans son palier, et le
 * même enregistrement sert au canvas comme à un futur export.
 */
                               
                                                                       
            
           
           
           
           
     
                                                                 
    
                                                                           
                                                                           
                                                                              
                                                                           
                                         
     
                  
 

/**
 * Une RETOUCHE de planogramme — la cote d'un contrôle, corrigée à la main.
 *
 * C'est la cote du CONSTRUCTEUR qu'on rectifie, dans les unités de la section
 * (les mêmes que le planogramme), et pas une mise en page d'écran : une
 * retouche vaut donc à toute taille de bloc et à tout zoom, et la règle du
 * responsif s'applique par-dessus, inchangée. C'est la différence avec les
 * anciennes compositions par palier, qui figeaient un état d'affichage et
 * entraient en conflit avec la règle.
 *
 * Les champs sont ceux que DÉCLARE le contrôle : pour un knob, `x`/`y` est
 * son centre (voir `controlBox`), pour tous les autres son coin haut-gauche.
 * Une retouche est donc interchangeable avec la donnée d'origine.
 */
                           
           
           
           
           
 

/** Les trois paliers d'une section — voir `docs/organisation-machines.md` § 4. */
                                                      

                 
                                                 
                                       
                                                                                             
                                                                           
     
                                                                   
    
                                                                             
                                                                             
                                                                              
                                                         
     
                                     
     
                                                                           
    
                                                                       
                                                                          
                                                                              
                                                                             
            
     
                                                     
     
                                                                       
    
                                                                             
                                                                             
                                                                      
                                                                             
                                                                  
     
                                                 
     
                                                                               
                                                                                
                                                      
     
                                  
 

const KEY = "odio.machines"

function load()        {
  try {
    const vide        = { designs: {}, layouts: {}, compositions: {}, priorites: {}, retouches: {}, cotes: {}, versions: {} }
    if (typeof localStorage === "undefined") return vide
    const raw = localStorage.getItem(KEY)
    if (!raw) return vide
    const parsed = JSON.parse(raw)         
    return {
      designs: parsed.designs ?? {},
      layouts: parsed.layouts ?? {},
      compositions: parsed.compositions ?? {},
      priorites: parsed.priorites ?? {},
      retouches: parsed.retouches ?? {},
      cotes: parsed.cotes ?? {},
      versions: parsed.versions ?? {},
    }
  } catch {
    return { designs: {}, layouts: {}, compositions: {}, priorites: {}, retouches: {}, cotes: {}, versions: {} }
  }
}

let store        = load()
const listeners = new Set            ()

function persist()       {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    /* stockage plein ou privé : la configuration vit alors le temps de la session */
  }
  for (const listener of listeners) listener()
}

export function getMachineDesign(machineId        )                {
  // DÉBRAYÉ — les réglages enregistrés ne sont plus lus. Quatorze curseurs se
  // disputaient les grandeurs du responsif et faisaient diverger le
  // planogramme ; la règle (`docs/regle-du-responsif-machine.md`) vaut pour
  // toutes les machines, sans réglage. Le magasin garde les données : rien ne
  // s'efface, rien ne se lit.
  void machineId
  return { ...DEFAULT_MACHINE_DESIGN }
}

export function setMachineDesign(machineId        , patch                        )       {
  store.designs[machineId] = { ...store.designs[machineId], ...patch }
  persist()
}

/**
 * L'agencement sauvé d'une machine — `null` s'il n'y en a pas, ou s'il a été
 * fait sous une version d'agencement PÉRIMÉE (voir `AGENCEMENTS_VERSION`).
 */
export function getMachineLayout(machineId        , version         )                      {
  if (version !== undefined && store.versions[machineId] !== version) return null
  return store.layouts[machineId] ?? null
}

export function saveMachineLayout(
  machineId        ,
  places              ,
  version         ,
)       {
  store.layouts[machineId] = places
  if (version !== undefined) store.versions[machineId] = version
  persist()
}

/** Oublie l'agencement sauvé — la machine renaît sur son planogramme. */
export function clearMachineLayout(machineId        )       {
  delete store.layouts[machineId]
  delete store.versions[machineId]
  persist()
}

// ─────────────────────────────────────────── retouches de planogramme

/**
 * Les cotes retouchées d'une section — `null` si le planogramme fait foi.
 *
 * Lues par `sectionRetouchee` (`blocks/machines.ts`), donc par tout ce qui
 * rend une machine. Une seule vérité : il n'y a pas de version par palier de
 * zoom ni par taille de bloc, et c'est délibéré — la règle du responsif
 * dérive tout le reste de ces cotes.
 */
export function getRetouches(sectionId        )                                  {
  return store.retouches[sectionId] ?? null
}

/** Écrit les cotes retouchées d'une section. Un objet vide vaut effacement. */
export function saveRetouches(sectionId        , retouches                          )       {
  if (Object.keys(retouches).length === 0) delete store.retouches[sectionId]
  else store.retouches[sectionId] = retouches
  persist()
}

/** Oublie les retouches — la section revient à la cote du constructeur. */
export function clearRetouches(sectionId        )       {
  delete store.retouches[sectionId]
  delete store.cotes[sectionId]
  persist()
}

/** La taille retouchée d'une section — `null` si le planogramme fait foi. */
export function getCoteSection(sectionId        )                                  {
  return store.cotes[sectionId] ?? null
}

/** Écrit la taille d'une section — le bloc redimensionné en mode élément. */
export function saveCoteSection(sectionId        , cote                          )       {
  store.cotes[sectionId] = cote
  persist()
}

/** Toutes les retouches d'une machine — pour les relire et corriger la source. */
export function machineRetouches(machineId        )                                           {
  const out                                           = {}
  for (const [sectionId, cotes] of Object.entries(store.retouches)) {
    if (sectionId.startsWith(`${machineId}_`)) out[sectionId] = cotes
  }
  for (const sectionId of Object.keys(store.cotes)) {
    if (sectionId.startsWith(`${machineId}_`) && !out[sectionId]) out[sectionId] = {}
  }
  return out
}

// ───────────────────────────────────────────── compositions de palier

/**
 * La composition d'un palier — DÉBRAYÉE : le rendu ne l'appelle plus.
 *
 * Les compositions enregistrées figeaient un palier que la règle pouvait ne
 * plus choisir, et devenaient invisibles sans qu'on sache pourquoi. Les
 * données restent ; l'outil reviendra porté par la règle, pas à côté d'elle.
 */
export function getComposition(sectionId        , palier            )                        {
  return store.compositions[sectionId]?.[palier] ?? null
}

export function saveComposition(sectionId        , palier            , places                )       {
  store.compositions[sectionId] = { ...store.compositions[sectionId], [palier]: places }
  persist()
}

/** Oublie la composition d'un palier — le rendu générique reprend la main. */
export function clearComposition(sectionId        , palier            )       {
  const section = store.compositions[sectionId]
  if (!section) return
  delete section[palier]
  persist()
}

/** Toutes les compositions d'une machine — pour l'export et pour l'inférence. */
export function machineCompositions(machineId        )                                                              {
  const out                                                              = {}
  for (const [sectionId, palier] of Object.entries(store.compositions)) {
    if (sectionId.startsWith(`${machineId}_`)) out[sectionId] = palier
  }
  return out
}

// ───────────────────────────────────────────── ordre d'exposition

/** L'ordre tracé à la main pour une section, ou `null`. */
export function getPriorite(sectionId        )                  {
  const ordre = store.priorites[sectionId]
  return ordre && ordre.length > 0 ? ordre : null
}

export function savePriorite(sectionId        , ordre                   )       {
  if (ordre.length === 0) {
    delete store.priorites[sectionId]
  } else {
    store.priorites[sectionId] = [...ordre]
  }
  persist()
}

export function clearPriorite(sectionId        )       {
  delete store.priorites[sectionId]
  persist()
}

export function onMachineConfig(listener            )             {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** L'état complet d'une machine, prêt à coller dans la conversation. */
export function exportMachineConfig(machineId        )         {
  return JSON.stringify(
    {
      machine: machineId,
      design: getMachineDesign(machineId),
      layout: getMachineLayout(machineId),
      compositions: machineCompositions(machineId),
      priorites: Object.fromEntries(
        Object.entries(store.priorites).filter(([id]) => id.startsWith(`${machineId}_`)),
      ),
    },
    null,
    1,
  )
}
