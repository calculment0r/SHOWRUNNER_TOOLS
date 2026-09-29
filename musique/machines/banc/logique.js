// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/banc/logique.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * LE BANC — la logique pure du second territoire.
 *
 * Le canvas, c'est l'instrument rangé dans l'espace. Le banc, c'est le même
 * instrument déroulé dans le temps. Cette logique porte tout ce qui se décide
 * sans DOM : les lanes, les segments, l'attracteur et ses opérateurs, les deux
 * têtes de lecture. Le composant `Banc.tsx` ne fait que la dessiner.
 *
 * Les décisions qui la gouvernent sont dans `docs/logique-globale.md`
 * (n° 32 à 85) ; les plus structurantes ici :
 *
 *   - n° 54 — chaque bloc déclare ce qu'il a de chaque thème, facette par
 *     facette. Un anneau ne ramène QUE sa facette : la boîte à rythme n'a rien
 *     de tonal, un attracteur HARMONIE ne la verra jamais.
 *   - n° 55 — le bord d'un anneau n'est pas franc : au centre, l'opérateur
 *     vaut le paramètre du bloc ; au bord, sa valeur NEUTRE. La distance fait
 *     le ratio, la loi (n° 56) courbe ce dégradé.
 *   - n° 62 — l'attracteur est attaché à son segment : il parle quand la tête
 *     gouvernante le traverse.
 *   - n° 80 — deux têtes, deux marches : le transport pilote la tête qui
 *     gouverne, et elle seule.
 */

                                                       

/* ------------------------------------------------------------------ types */

                          
           
           
           
 

                                             

                       
            
             
                 
                                                                                       
           
           
                    
                                                                             
                             
     
                                                                          
                                                                           
     
                 
 

                          
            
              
                                                           
           
           
                                                                                       
              
 

                         
                 
                 
                                                                              
           
                                                                                  
             
 

                             
            
                 
             
                 
                                            
           
           
                                                  
           
                                                                                      
             
                   
 

/** Une boîte en unités monde — la forme des `BlockState` de l'App. */
                        
           
           
           
           
 

/* ------------------------------------------------------- les cinq lanes */

/**
 * L'AMBRE ET LE VERMILLON SONT EXCLUS (n° 44) : l'un est la couleur de l'UI,
 * l'autre celle de l'alerte — et du temps réel.
 */
// SHOWRUNNER : les teintes sont des NOMS de jetons (règle 1 du thème) — celles
// d'ODIO_01 (#3f7a9c, #6b5fa8, #b0567f, #3f8a72, #8a6f5a), en jetons nommés dans
// musique/nodal.css (--nd-ryt, --nd-har, --nd-tim, --nd-nrj, --nd-ten ; sombre
// et clair, au contraste AA) — le rhabillage du 29/09, au lieu des voisines du
// portail (cy, coral-3, coral-2, grn2, coral-1).
export const LANES                  = [
  { id: "ryt", nom: "RYTHME", couleur: "nd-ryt", y: 26, h: 46, nature: "matiere", facettes: ["swing", "densité", "accents"], horizon: 104 },
  { id: "har", nom: "HARMONIE", couleur: "nd-har", y: 78, h: 46, nature: "matiere", facettes: ["tonalité", "tension"], horizon: 76 },
  { id: "tim", nom: "TIMBRE", couleur: "nd-tim", y: 130, h: 46, nature: "matiere", facettes: ["matière", "brillance"], horizon: 62 },
  { id: "nrj", nom: "ÉNERGIE", couleur: "nd-nrj", y: 182, h: 40, nature: "courbe", facettes: [], horizon: 118 },
  { id: "ten", nom: "TENSION", couleur: "nd-ten", y: 228, h: 40, nature: "courbe", facettes: [], horizon: 88 },
]

export const laneDe = (id        )                   => LANES.find((lane) => lane.id === id)

/** Les teintes des anneaux, la couleur de la lane en tête. */
export function teintesAnneaux(lane      )           {
  const reserve = ["nd-har", "nd-nrj", "nd-tim", "nd-ten", "nd-ryt"]
  return [lane.couleur, ...reserve.filter((teinte) => teinte !== lane.couleur)]
}

/* ------------------------------------------------ les facettes des blocs */

/**
 * CE QUE CHAQUE CONTRÔLE RÉEL A « DE RYTHMIQUE, D'HARMONIQUE, DE TIMBRAL ».
 *
 * La table est déclarée sur les identifiants de contrôle des machines
 * (`machines-data.ts`) — c'est la déclaration qui décide, pas le type de bloc
 * (n° 66). Un contrôle absent d'ici n'appartient à aucun thème : le volume, le
 * tempo, les leds n'ont rien à dire à un attracteur.
 *
 * ⚠️ CE PARTAGE EST À RELIRE PAR L'AUTEUR, contrôle par contrôle — c'est lui
 * qui décide de tout le reste (question ouverte n° 6 de logique-globale.md).
 */
export const FACETTES                                   = {
  // — minilogue xd
  ml_v1pitch: "tonalité",
  ml_v2pitch: "tonalité",
  ml_v2xmod: "tension",
  ml_lint: "tension",
  ml_cut: "brillance",
  ml_res: "matière",
  ml_drive: "matière",
  ml_mshape: "matière",
  ml_ega: "matière",
  // — MicroFreak
  mf_fcut: "brillance",
  mf_fres: "matière",
  mf_otim: "matière",
  mf_oshape: "matière",
  mf_camt: "tension",
  mf_crise: "tension",
  mf_eatt: "matière",
  // — TR-8S
  tr_shuf: "swing",
  tr_fill: "densité",
  tr_scat: "accents",
}

/* ------------------------------------------------------- la géométrie */

/** Distance d'un point au bord d'une boîte — nulle dedans. */
export function ecartBoite(boite       , cx        , cy        )         {
  const px = Math.max(boite.x, Math.min(cx, boite.x + boite.w))
  const py = Math.max(boite.y, Math.min(cy, boite.y + boite.h))
  return Math.hypot(cx - px, cy - py)
}

/**
 * LE POIDS D'UN BLOC DANS UN ANNEAU (n° 55-56). 1 sous le centre, 0 au bord,
 * et la loi courbe le dégradé entre les deux. Hors de l'anneau : 0.
 */
export function poids(distance        , rayon        , loi        )         {
  if (rayon <= 0) return 0
  return Math.pow(Math.max(0, Math.min(1, 1 - distance / rayon)), loi)
}

/* ------------------------------------------------------ les opérateurs */

/** Un paramètre réel, tel que l'App le lit sur un bloc capté. */
                              
                                  
                
 

                            
                
                 
                 
                 
               
                                              
                
                                       
           
                                                                          
            
               
 

/**
 * CE QUE L'ATTRACTEUR RAMÈNE dans son segment : pour chaque anneau, les
 * paramètres des blocs captés qui appartiennent à SA facette, pondérés par la
 * distance. La valeur NEUTRE est celle que le bloc déclare — son défaut
 * constructeur (question ouverte n° 5 : bon repère ?).
 */
export function operateurs(
  attracteur            ,
  blocs                                                                                          ,
)              {
  const sortie              = []
  for (const anneau of attracteur.anneaux) {
    for (const bloc of blocs) {
      const distance = ecartBoite(bloc.boite, attracteur.x, attracteur.y)
      if (distance > anneau.r) continue
      const w = poids(distance, anneau.r, attracteur.loi)
      for (const { descripteur, valeur } of bloc.parametres) {
        if (FACETTES[descripteur.id] !== anneau.facette) continue
        sortie.push({
          blocId: bloc.id,
          blocNom: bloc.nom,
          facette: anneau.facette,
          couleur: anneau.couleur,
          label: descripteur.label || descripteur.id,
          valeur,
          w,
          op: descripteur.default + (valeur - descripteur.default) * w,
          unite: descripteur.unit ?? "",
        })
      }
    }
  }
  return sortie.sort((a, b) => b.w - a.w)
}

/** Les blocs qu'un anneau écoute — pour le compte à l'étiquette et la teinte. */
export function membres(
  attracteur            ,
  anneau        ,
  blocs                                                                        ,
)           {
  return blocs
    .filter((bloc) => bloc.facettes.has(anneau.facette))
    .filter((bloc) => ecartBoite(bloc.boite, attracteur.x, attracteur.y) <= anneau.r)
    .map((bloc) => bloc.id)
}

/** Les facettes qu'un bloc déclare, d'après ses descripteurs. */
export function facettesDe(parametres                                )              {
  const facettes = new Set        ()
  for (const descripteur of parametres) {
    const facette = FACETTES[descripteur.id]
    if (facette) facettes.add(facette)
  }
  return facettes
}

/* -------------------------------------------------------- les deux têtes */

                        
                                                                          
              
                                                                 
                
                          
                                        
 

export const tempsGouvernant = (tetes       )         =>
  tetes.gouverne === "eco" ? tetes.ecoute : tetes.reel

/** Le temps décide s'il parle : la tête gouvernante traverse-t-elle le segment ? */
export function actif(segment         , tetes       )          {
  const temps = tempsGouvernant(tetes)
  return segment.d <= temps && temps < segment.d + segment.l
}

/**
 * AVANCER : chaque tête court pour son compte. Arrêter son écoute n'arrête pas
 * le temps réel, qui joue toujours pour la salle — et l'inverse est vrai aussi.
 */
export function avancer(tetes       , dt        , boucle = 128)        {
  const roule = (temps        ) => (temps + dt >= boucle ? temps + dt - boucle : temps + dt)
  return {
    ...tetes,
    reel: tetes.court.reel ? roule(tetes.reel) : tetes.reel,
    ecoute: tetes.court.eco ? roule(tetes.ecoute) : tetes.ecoute,
  }
}

/* -------------------------------------------------------------- formats */

/** Une valeur, écrite comme le bloc l'écrirait — sobre, sans zéros de traîne. */
export function ecrire(valeur        , descripteur                      )         {
  if (descripteur?.curve === "choice" && descripteur.choices) {
    const index = Math.round(valeur)
    return descripteur.choices[index] ?? String(index)
  }
  const ampleur = Math.abs(valeur)
  const texte = ampleur >= 100 ? valeur.toFixed(0) : ampleur >= 10 ? valeur.toFixed(1) : valeur.toFixed(2)
  return texte.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1")
}
