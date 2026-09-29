// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/blocks/machines.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Les trois machines, en données pures — F8 de `docs/demandes.md`.
 *
 * Transposition fidèle de `defML`, `defMF` et `defTR` dans
 * `UI/3_machine/ODIO-O1 Hardware.dc.html` : la source de vérité des cotes
 * (mm) reste ce fichier de référence, et ce module en garde la structure
 * déclarative pour que le recalage sur les cotes constructeur reste trivial
 * (voir `UI/3_machine/README.md`).
 *
 * Ce que ce module fournit : le catalogue des trois machines (MINILOGUE XD,
 * MICROFREAK, TR–8S), chacune découpée en sections détachées, chaque section
 * portant ses contrôles avec leurs cotes en mm et leur valeur par défaut. Les
 * identifiants de contrôle sont stables et préfixés par machine
 * (`ml_cut`, `mf_fcut`, `tr_bd_lv`…, README § « À implémenter côté produit »),
 * prêts à être mappés sur le moteur audio.
 *
 * Ce que ce module NE fait PAS : il ne sait pas se dessiner, ni se rendre
 * manipulable comme un bloc ODIO (redimensionnement, câblage, zoom
 * sémantique). C'est la suite du chantier F8, et le regroupement de chaque
 * machine en groupe est F9. Pur et sans DOM, comme le reste de `blocks/` et
 * `tile/` : c'est la partie qu'on vérifie sans navigateur.
 */

// ─────────────────────────────────────────────────────────────── types

import { DRUM_VOICES,                          } from "../../odio/instruments/rhythm-box.js"
import {
  getCoteSection,
  getMachineDesign,
  getMachineLayout,
  getPriorite,
  getRetouches,
} from "../design/machines-config.js"
import { AGENCEMENTS, AGENCEMENTS_VERSION, COMPOSITIONS, COTES } from "./agencements.js"
import { MACHINE_DATA } from "./machines-data.js"
import { TABLE_MIX } from "./table-mix.js"
import {
  composerGrille,
  placeDuControle,
  planchePresente,
  resoudrePlanche,
                     
} from "./planche.js"

                         
          
            
           
            
         
         
          
             
                                                                                         
           
                                                           
         
                                                                              
            
                                                           
           
                                                                       
            
                                                                   
           
                       
        

                       
                   
     
                                                                       
    
                                                                             
                                                                              
                                                                                
                                                                           
                                                                          
    
                                                                     
                                                                             
                                                                               
                                                 
     
           
           
           
           
 

/**
 * Manière de lire une valeur normalisée 0–1 en unité affichable.
 *
 * Transposition de `fmt()` du planogramme. Les formats `n<N>` comptent de 1 à
 * N — une longueur de motif, un numéro de programme : on ne les lit pas en
 * pourcents, on les lit en rangs.
 */
                           
         
       
         
         
         
         
                                                    
        
                                                        
          
                                                    
        
                                                
        
                                            
        

                                                  
              
            
               
                                             
                 
                        
 

                                                    
                
            
               
                            
                                         
                 
 

                                                   
               
            
               
                                             
                 
 

                                                    
                
            
               
                
                                                                                   
                
 

                                                 
             
            
                
 

                                                 
             
            
                 
     
                                  
    
                                                                              
                                                                            
                                                              
     
                     
 

/** Étiquette gravée, non interactive — le nom d'une tranche TR-8S par exemple. */
                                                  
              
              
 

/** Écran encastré, non interactif — reste sombre dans les deux thèmes. */
                                                     
                 
              
 

                                                   
               
            
               
                 
                                                                              
                  
                        
 

                                                 
             
            
                                                                             
                 
                 
 

                                                    
                
            
               
                 
 

                                                   
               
            
               
                 
 

                                                    
                
            
               
              
              
                 
 

                                                   
               
            
               
                 
 

                                                
            
            
               
                 
 

                            
               
                 
                
                 
              
              
               
                  
                
              
                 
                
                 
                
             

/** Contrôle qui porte un identifiant stable — tout sauf le texte gravé et l'afficheur. */
                                                                                      

                                 
            
                                                                           
              
                                                              
           
           
           
           
                                                                                                    
                     
                                     
 

                             
            
              
                                                             
             
                                                                                                       
           
           
           
           
                                     
 

// ──────────────────────────────────────────────────────────── catalogue

/**
 * Les treize planogrammes.
 *
 * La donnée est GÉNÉRÉE depuis le fichier de référence de conception, dont la
 * géométrie a été résolue par exécution (`blocks/machines-data.ts`). On ne
 * l'écrit plus à la main : les trois machines matérielles y ont gagné leur
 * espacement recalculé, et les dix panneaux ODIO originaux n'ont jamais eu de
 * coordonnées écrites — leur géométrie découle de leurs rangées.
 */
const machines               = [...MACHINE_DATA, TABLE_MIX]
export const MACHINES                        = machines

// ────────────────────────────────────────────────────────────── lecture

                              
                         
                   
                   
     
                                                                            
                                                                             
     
            
            
 

/**
 * Rectangle d'un contrôle, coin haut-gauche et taille, en mm.
 *
 * **C'est le seul endroit où la convention du knob se résout.** Un rendu doit
 * passer par ici plutôt que de lire `x`/`y` directement : c'est ce qui garantit
 * qu'il ne peut pas poser un knob à son centre en croyant poser son coin. Le
 * planogramme d'origine faisait ce décalage à la volée dans son code de rendu,
 * dispersé au milieu du calcul de caméra — d'où le piège.
 *
 * Fonctionne aussi bien sur un contrôle relatif à sa section que sur les `ax`
 * / `ay` absolus d'un `FlatControl` : c'est la même convention aux deux
 * échelles.
 */
export function controlBox(control                , x = control.x, y = control.y) {
  const centred = control.kind === "knob"
  return {
    x: centred ? x - control.w / 2 : x,
    y: centred ? y - control.h / 2 : y,
    w: control.w,
    h: control.h,
  }
}

/** Aplatit une machine en contrôles, avec leur position absolue en mm. */
export function flattenMachine(machine            )                {
  const flat                = []
  for (const section of machine.sections) {
    for (const control of section.controls) {
      flat.push({
        control,
        machineId: machine.id,
        sectionId: section.id,
        ax: machine.x + section.x + control.x,
        ay: machine.y + section.y + control.y,
      })
    }
  }
  return flat
}

/** Aplatit tout le catalogue — pratique pour vérifier l'unicité des identifiants. */
export function flattenMachines(machines                        = MACHINES)                {
  return machines.flatMap(flattenMachine)
}

/**
 * Valeur par défaut d'un contrôle, formatée en unité lisible — transposition
 * de `fmt(e, v)` du planogramme, appliquée ici à la valeur par défaut plutôt
 * qu'à un état vivant : ce module ne connaît que le catalogue, pas l'état.
 */
export function formatControlDefault(control                )         {
  return formatControlValue(control, "default" in control ? control.default : 0)
}

/**
 * Valeur d'un contrôle, lue dans son unité — transposition de `fmt()`.
 *
 * C'est ce qui s'affiche dans la bulle de geste. Un knob de tempo dit
 * « 120 bpm », pas « 35 % » ; une molette de hauteur dit « +0,42 » parce
 * qu'elle est signée et revient au centre.
 */
export function formatControlValue(control                , norm        )         {
  switch (control.kind) {
    case "switch":
      return control.options[Math.round(norm)] ?? String(norm)
    case "button":
    case "pad":
    case "led":
    case "key":
      return norm >= 0.5 ? "on" : "off"
    case "vu":
      return `−${(norm * 20).toFixed(1)} db`
    case "text":
    case "display":
      return ""
    default:
      break
  }
  const format = "format" in control ? control.format : undefined
  switch (format) {
    case "bpm":
      return `${Math.round(56 + norm * 184)} bpm`
    case "n":
      return String(Math.round(1 + norm * 127))
    case "n12":
      return String(1 + Math.round(norm * 11))
    case "n16":
      return String(Math.round(norm * 16))
    case "n32":
      return String(1 + Math.round(norm * 31))
    case "n64":
      return String(1 + Math.round(norm * 63))
    case "pb": {
      const p = (norm - 0.5) * 2
      return `${p >= 0 ? "+" : ""}${p.toFixed(2)}`
    }
    case "note": {
      const noms = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"]
      const n = Math.round(norm * 24)
      return `${noms[n % 12]}${2 + Math.floor(n / 12)}`
    }
    case "r4":
      return `${1 + Math.round(norm * 3)}×`
    case "pm": {
      const m = Math.round((norm - 0.5) * 50)
      return `${m >= 0 ? "+" : ""}${m} ms`
    }
    case "st": {
      const st = Math.round((norm - 0.5) * 24)
      return `${st >= 0 ? "+" : ""}${st} st`
    }
    default:
      return `${Math.round(norm * 100)} %`
  }
}

// ─────────────────────────────────────────── vers le reste de l'interface

/**
 * Descripteurs de paramètres d'une section.
 *
 * Traduit les contrôles adressables dans le contrat que tout ODIO parle déjà
 * (`ParameterDescriptor`) : c'est ce qui leur donne gratuitement les rails, le
 * paramètre exposé, la saisie au clavier et le zoom sémantique, sans un seul
 * cas particulier ailleurs.
 *
 * Un knob et un fader se lisent en pourcents ; un sélecteur, un bouton, un pad
 * et une diode sont des énumérations — on ne les règle pas, on les choisit.
 */
export function sectionParameters(section                )                        {
  const out                        = []
  for (const control of section.controls) {
    if (control.kind === "text" || control.kind === "display") continue
    const label = "label" in control && control.label ? control.label : control.id.split("_").slice(1).join(" ")
    switch (control.kind) {
      case "knob":
      case "fader":
        out.push({ id: control.id, label, min: 0, max: 100, default: control.default * 100, unit: "%", curve: "linear" })
        break
      case "switch":
        out.push({
          id: control.id,
          label,
          min: 0,
          max: control.options.length - 1,
          default: control.default,
          unit: "",
          curve: "choice",
          choices: [...control.options],
        })
        break
      default:
        out.push({ id: control.id, label, min: 0, max: 1, default: control.default, unit: "", curve: "choice", choices: ["off", "on"] })
    }
  }
  return out
}

/** Toutes les sections du catalogue, à plat — une section est un bloc ODIO. */
const sections                                                     = MACHINES.flatMap(
  (machine) => machine.sections.map((section) => ({ machine, section })),
)
export const MACHINE_SECTIONS                                                              = sections

/**
 * AJOUTER UNE MACHINE AU CATALOGUE — la porte des gabarits de PLANO.
 *
 * Une machine du même identifiant est REMPLACÉE : c'est ainsi qu'on reprend
 * un planogramme existant. Les instances déjà posées gardent leurs sections
 * telles qu'elles sont nées ; les suivantes prennent la nouvelle façade.
 */
export function ajouterMachine(machine            , moteur               )       {
  const rang = machines.findIndex((candidate) => candidate.id === machine.id)
  if (rang >= 0) machines.splice(rang, 1, machine)
  else machines.push(machine)
  for (let i = sections.length - 1; i >= 0; i--) {
    if (sections[i] .machine.id === machine.id) sections.splice(i, 1)
  }
  for (const section of machine.sections) sections.push({ machine, section })
  MACHINE_ENGINES[machine.id] = moteur
}

export function sectionOf(id        )                                                               {
  return MACHINE_SECTIONS.find((entry) => entry.section.id === id)
}

// ──────────────────────────────────────────── la machine comme un tout

/** Échelle par défaut du planogramme : 1 mm réel = 0,8 px monde. Réglable (panneau de la machine). */
export const MM_TO_WORLD = 0.8
/**
 * Intervalle entre deux sections : ZÉRO.
 *
 * Conservé nommé pour que l'intention soit lisible — les sections d'une
 * machine se touchent, elles ne sont pas des blocs posés côte à côte.
 */
export const SECTION_GAP_MM = 0

/**
 * Disposition d'une machine entière — F9.
 *
 * **Les sections sont JOINTIVES.** C'était un écartement de 10 mm ; le moteur
 * de composition les colle désormais arête contre arête, deux sections
 * partageant un seul filet de 1 px, et le nom de section vit dans un bandeau
 * réservé EN HAUT DU BLOC plutôt que dans l'interstice. Une machine est un
 * rectangle plein, comme la face avant qu'elle représente.
 *
 * La fonction ne fait donc plus que convertir les millimètres en pixels monde.
 * Elle existe encore parce que c'est le SEUL endroit où cette conversion se
 * fait : le remontage d'une machine ouverte s'en sert aussi, et les deux
 * doivent tomber juste au pixel près.
 */
export function machineLayout(
  machine            ,
  scale = getMachineDesign(machine.id).scale,
)                                                               {
  const S = scale
  return machine.sections.map((section) => ({
    id: section.id,
    x: section.x * S,
    y: section.y * S,
    w: section.w * S,
    h: section.h * S,
  }))
}

/**
 * OÙ SE POSENT LES SECTIONS D'UNE MACHINE — la seule réponse, pour tout le monde.
 *
 * La scène de départ et le menu de création l'appellent tous deux : deux
 * chemins qui répondaient chacun à leur façon ont déjà coûté un agencement
 * perdu à chaque rechargement.
 */
export function placesDeMachine(
  machine            ,
)                                                               {
  // L'agencement ENREGISTRÉ passe devant le planogramme : c'est ce que le
  // musicien a posé et demandé de garder. Ce qui reste débrayé, c'est
  // l'échelle par machine et les quatorze curseurs — eux se disputaient les
  // grandeurs du responsif. Une place de bloc, elle, ne dispute rien à la
  // règle : elle lui donne son énoncé.
  //
  // Une section ABSENTE de l'agencement garde sa place de planogramme : un
  // enregistrement partiel (ou un catalogue qui gagne une section) ne fait
  // pas disparaître un bloc.
  // Un enregistrement fait sous un agencement PÉRIMÉ est ignoré : sinon il
  // fige une mise en page qu'on vient de corriger.
  const enregistre = getMachineLayout(machine.id, AGENCEMENTS_VERSION)
  // Sans enregistrement, l'AGENCEMENT ODIO (`agencements.ts`) prime la façade
  // brute : c'est la mise en page de naissance — le séquenceur du minilogue
  // en bas, pleine largeur. Les cotes, elles, restent celles du planogramme.
  const odio = AGENCEMENTS[machine.id]
  const facade = machineLayout(machine)
  const base = odio
    ? facade.map((place) => {
        const mieux = odio.find((o) => o.id === place.id)
        return mieux ? { id: place.id, x: mieux.x, y: mieux.y, w: mieux.w, h: mieux.h } : place
      })
    : facade
  if (!enregistre) return base
  const parId = new Map(enregistre.map((place) => [place.section, place]))
  return base.map((place) => {
    const garde = parId.get(place.id)
    return garde ? { id: place.id, x: garde.x, y: garde.y, w: garde.w, h: garde.h } : place
  })
}

/**
 * La section, cotes RETOUCHÉES appliquées — la seule porte d'entrée du rendu.
 *
 * Une retouche remplace la cote du constructeur dans les unités de la
 * section, donc AVANT tout le reste : les conteneurs comptent dessus, la
 * règle du responsif décide dessus, et rien en aval n'a besoin de savoir
 * qu'une correction a eu lieu. Les champs sont ceux que déclare le contrôle
 * (pour un knob, son centre) : une retouche est interchangeable avec la
 * donnée d'origine.
 */
export function sectionRetouchee(section                )                 {
  const retouches = getRetouches(section.id)
  const cote = getCoteSection(section.id)
  // La composition de NAISSANCE tient lieu de retouche par défaut : le
  // planogramme optimisé dans son bloc. Celle du musicien passe devant, par
  // contrôle — retoucher un knob ne renvoie pas les autres à la façade.
  const naissance = COMPOSITIONS[section.id]
  const coteNaissance = cote ?? COTES[section.id] ?? null
  if (!retouches && !coteNaissance && !naissance) return section
  let touchee = coteNaissance !== null
  const controls = section.controls.map((control, index) => {
    const cle = controlKey(control, index)
    const box = retouches?.[cle] ?? naissance?.[cle]
    if (!box) return control
    touchee = true
    return { ...control, x: box.x, y: box.y, w: box.w, h: box.h }
  })
  if (!touchee) return section
  return { ...section, controls, ...(coteNaissance ? { w: coteNaissance.w, h: coteNaissance.h } : {}) }
}

/**
 * Un groupe de machine est **soudé** : on ne le dissout pas.
 *
 * Les sections d'une TR-8S ne sont pas des blocs qu'on a réunis par commodité,
 * ce sont les morceaux d'un même appareil, liés par le circuit qui les fait
 * fonctionner ensemble. Les séparer n'aurait pas de sens musical — un bandeau
 * de pas sans son bandeau de tranches ne joue rien. Le groupe se déplace, se
 * range, se redimensionne, s'éteint d'un bloc comme n'importe quel autre ;
 * il ne se défait pas.
 */
export const WELDED_PREFIX = "mach-"

export function isWeldedGroup(group               )          {
  return group !== null && group.startsWith(WELDED_PREFIX)
}

// ─────────────────────────────────── le zoom sémantique d'une machine

/**
 * L'échelle sémantique d'un panneau de machine.
 *
 * Elle n'est PAS celle d'un bloc ODIO ordinaire, et c'est tout l'objet de
 * cette section. Un effet ODIO dégrade vers ses rails : un dessin, puis des
 * lignes nommées, puis une valeur. C'est juste pour un filtre, dont le sens
 * est dans sa courbe.
 *
 * Une machine, non. Un minilogue EST une planche de knobs : sa géométrie et
 * ses molettes sont sa nature même. Le réduire à une pile de rails de texte,
 * c'est en faire un autre objet — on perd la reconnaissance immédiate, et le
 * geste (tourner) devient un autre geste (glisser). La dégradation d'une
 * machine ne **transforme** donc pas ses contrôles : elle en **garde moins,
 * plus gros**. Un knob reste un knob jusqu'au bout.
 *
 * Trois modes, et le passage de l'un à l'autre se calcule :
 *
 *   1. `planche` — le planogramme : chaque contrôle à sa place et à sa taille
 *      réelles. Les libellés gravés tombent d'abord (`labels`), la disposition
 *      reste : on reconnaît une TR-8S à sa géométrie avant de lire un mot.
 *   2. `macros` — la planche ne tient plus au format réel. On abandonne la
 *      géométrie, pas la nature : les contrôles les plus importants restent,
 *      en grille, à une taille confortable. Les autres s'effacent.
 *   3. `seul` — un seul contrôle, en grand. Celui que le musicien a exposé,
 *      à défaut le plus important de la section.
 */
                                                     

/**
 * Importance d'un contrôle, telle que le CONSTRUCTEUR l'a fixée.
 *
 * Sa plus grande dimension réelle, en millimètres. Ce n'est pas une opinion :
 * sur une vraie machine, ce qu'on règle souvent est gros et tombe sous la
 * main, ce qu'on règle une fois est petit. Le `cutoff` du minilogue fait 26 mm
 * quand ses enveloppes en font 10,5 ; les faders de niveau d'une TR-8S font
 * 52 mm. Le classement existait avant nous, il suffit de le lire.
 */
export function importanceOf(control                )         {
  // √(w × h) : le côté du carré de même aire.
  //
  // C'était `max(w, h)`, et c'était faux : un interrupteur de 26 × 9 mm
  // passait devant un knob de 17 mm. Large n'est pas important — un contrôle
  // compte par la place qu'il OCCUPE, pas par sa plus grande dimension.
  return Math.sqrt(control.w * control.h)
}

/**
 * Les contrôles d'une section, du plus important au moins important.
 *
 * Le choix du musicien passe devant celui du constructeur : le paramètre
 * exposé prend la tête, quelle que soit sa taille sur l'appareil. C'est la
 * même règle que `promoteExposed` applique aux rails — ce qu'on a désigné
 * comme important est le dernier à disparaître.
 */
export function rankedControls(section                , exposed                )                       {
  const addressable = section.controls.filter(
    (c)                          => c.kind !== "text" && c.kind !== "display",
  )

  // ── L'ORDRE TRACÉ À LA MAIN PRIME SUR TOUT.
  //
  // Une courbe passée au clic milieu sur les contrôles dit l'ordre
  // d'exposition, dans l'ordre de la traversée. Rien ne peut être plus direct,
  // et rien n'a plus d'autorité : ni la cote du constructeur, ni la lecture
  // des aires composées. Les contrôles non traversés suivent, par importance.
  const tracee = getPriorite(section.id)
  if (tracee) {
    const rang = new Map(tracee.map((id, i) => [id, i]))
    const ranked = [...addressable].sort(
      (a, b) =>
        (rang.get(a.id) ?? Number.POSITIVE_INFINITY) - (rang.get(b.id) ?? Number.POSITIVE_INFINITY) ||
        importanceOf(b) - importanceOf(a),
    )
    if (!exposed) return ranked
    const index = ranked.findIndex((c) => c.id === exposed)
    if (index <= 0) return ranked
    const [pick] = ranked.splice(index, 1)
    return [pick , ...ranked]
  }

  const ranked = [...addressable].sort((a, b) => importanceOf(b) - importanceOf(a))
  if (!exposed) return ranked
  const index = ranked.findIndex((c) => c.id === exposed)
  if (index <= 0) return ranked
  const [pick] = ranked.splice(index, 1)
  return [pick , ...ranked]
}

/**
 * La boîte du CONTENU d'une section — l'englobant réel de ses contrôles.
 *
 * ⚠️ **Ce n'est PAS ce sur quoi on met à l'échelle.** Elle l'a été, et c'était
 * le défaut central du responsif : une section aux trois quarts vide — le
 * `master` du minilogue porte 15 mm de contenu dans 56 mm de large — y rendait
 * une boîte minuscule, donc une échelle énorme, et une seule machine se
 * dessinait à quatre échelles différentes. L'échelle se lit sur la boîte
 * DÉCLARÉE (`boiteUtile`, dans `planche.ts`), qui compte le vide comme ce qu'il
 * est : une intention de composition.
 *
 * Elle reste utile pour ce qu'elle mesure vraiment — où sont les contrôles —
 * et sert aux tests de non-débordement.
 */
export function contenuDe(section                )                                                 {
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  for (const control of section.controls) {
    const box = controlBox(control)
    x0 = Math.min(x0, box.x)
    y0 = Math.min(y0, box.y)
    x1 = Math.max(x1, box.x + box.w)
    y1 = Math.max(y1, box.y + box.h)
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: section.w, h: section.h }
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
}

/** Les réglages de conception de la machine qui porte cette section. */
export function machineDesignOf(section                ) {
  return getMachineDesign(section.id.split("_")[0] ?? "")
}

/**
 * Les trois corps de silkscreen, du plus grand au plus petit.
 *
 * Une section dense imprime plus petit, comme sur une vraie machine — elle ne
 * se tait pas. On garde le plus grand qui tienne PARTOUT.
 */
export const SILKSCREEN_PX = [11, 10, 9]         

/** Les corps à essayer pour une section — bornés par les réglages par défaut. */
export function silkscreenSteps(section                )           {
  const { labelMax, labelMin } = machineDesignOf(section)
  const max = Math.max(labelMin, labelMax)
  const min = Math.min(labelMin, labelMax)
  const mid = Math.round((max + min) / 2)
  return [...new Set([Math.round(max), mid, Math.round(min)])]
}

/**
 * Largeur approchée d'un libellé, en px.
 *
 * Chasse fixe, 0,65 em : la chasse RÉELLE mesurée dans Chromium fait 0,644 em
 * — l'ancienne estimation à 0,62 laissait passer des noms qui débordaient
 * ensuite d'un ou deux pixels réels. L'estimation majore d'une pointe, parce
 * qu'un nom qui frôle vaut un nom qui déborde.
 */
export function labelWidth(text        , px        )         {
  return text.length * px * 0.65
}

/**
 * Le texte que l'étiquette AFFICHE — pas seulement le nom.
 *
 * Un sélecteur écrit « nom · option » : on mesure contre l'option LA PLUS
 * LONGUE, pour que le verdict ne change pas quand on clique le sélecteur.
 */
export function labelOf(control                )         {
  if (!("label" in control) || !control.label) return ""
  if (control.kind === "switch") {
    const longest = [...control.options].sort((a, b) => b.length - a.length)[0] ?? ""
    return `${control.label} · ${longest}`
  }
  return control.label
}

/**
 * Largeur de la CELLULE d'un contrôle, en mm — la place qu'a son NOM.
 *
 * Pas sa propre largeur : la place dont il dispose avant de mordre sur son
 * voisin. Le jour jusqu'au BORD de la section n'appartient qu'à lui ; le jour
 * jusqu'à un VOISIN se partage — le voisin y met son propre nom, centré comme
 * le sien. Une seule mesure pour une seule question : c'est elle qui choisit
 * le corps du silkscreen, et elle encore qui fait tomber un nom à l'écran.
 */
export function celluleDe(section                , control                )         {
  const box = controlBox(control)
  const centre = box.x + box.w / 2
  let gauche = box.x
  let droite = section.w - (box.x + box.w)
  for (const autre of section.controls) {
    if (autre === control) continue
    const b = controlBox(autre)
    // Même rangée : leurs bandes verticales se recouvrent.
    if (b.y >= box.y + box.h || b.y + b.h <= box.y) continue
    const c = b.x + b.w / 2
    if (c < centre) gauche = Math.min(gauche, (box.x - (b.x + b.w)) / 2)
    else droite = Math.min(droite, (b.x - (box.x + box.w)) / 2)
  }
  // Le libellé est centré : il déborde des DEUX côtés, donc il consomme deux
  // fois le plus petit des deux jours, plus le contrôle lui-même.
  return box.w + 2 * Math.max(0, Math.min(gauche, droite))
}

/**
 * Tous les noms de la section tiennent-ils, à ce corps ?
 *
 * Deux places bornent un nom : sa CELLULE (le voisin) et le PANNEAU (le bord).
 * Une section plus étroite que ses cellules — le master, deux knobs dans une
 * colonne mince — choisirait sinon un corps que le bloc ne peut pas loger.
 */
export function namesFit(section                , kEcran        , px        , panneauEcran        )          {
  for (const control of section.controls) {
    const label = labelOf(control)
    if (!label) continue
    const place = Math.min(celluleDe(section, control) * kEcran, panneauEcran)
    if (labelWidth(label, px) > place) return false
  }
  return true
}

                            
     
                                                                
    
                                                                              
                                                                             
                                           
     
                 
                                                                   
                 
     
                                                         
    
                                                                               
                                                                            
                                                               
     
                         
                                              
                 
                                                           
                  
 

/**
 * La clé d'un contrôle — son identifiant, ou son rang dans la liste rendue.
 *
 * Sert au rendu (clés React) et au tracé d'ordre. Le rang est stable tant que
 * le planogramme ne bouge pas.
 */
export function controlKey(control                , index        )         {
  return "id" in control ? control.id : `#${index}`
}

/**
 * Décide ce que montre un panneau dans la place qu'on lui donne — en
 * TAILLE APPARENTE, pixels écran.
 *
 * C'est la doctrine du canvas appliquée à l'intérieur d'une machine : ce
 * qu'on montre n'est pas décidé par un palier de zoom ni par la taille monde
 * du bloc, mais par leur PRODUIT — la place que l'œil a vraiment. Un bloc
 * minuscule regardé de près montre tout ; un grand bloc regardé de loin
 * retire, dans l'ordre de priorité, et ce qui reste grandit.
 *
 * La règle entière est dans `docs/regle-du-responsif-machine.md` ; les
 * mécaniques pures sont dans `planche.ts`.
 */
export function planPanel(
  section                ,
  corpsW        ,
  corpsH        ,
  exposed                ,
  /**
   * La section porte un conteneur déclaré (`blocks/assemblages.ts`) : elle ne
   * bascule jamais en grille et ne retire jamais ses unités — une rangée de
   * pas vue de loin reste une bande de pas, reconnaissable comme telle. Seuls
   * ses textes cèdent, au seuil d'écran. Son COMPTE, lui, a été résolu en
   * monde avant d'arriver ici.
   */
  elastique = false,
  /**
   * Facteur d'apparence : combien un pixel du corps vaut de pixels écran,
   * BORNÉ par le seuil de dézoom max de la sémantique. L'App le calcule :
   * `max(zoom caméra, seuil) / échelle de mise en page`. Au-dessus du
   * plancher de lisibilité il vaut un (la mise en page suit la caméra) ; en
   * dessous il décroît avec la caméra — la sémantique continue — jusqu'au
   * seuil, où il cesse de varier : la composition gèle, tout rétrécit
   * ensemble, on ne cherche plus à faire de sémantique.
   */
  apparence = 1,
)            {
  const plan = resoudrePlanche(section, Math.max(1, corpsW), Math.max(1, corpsH))

  // ── 1. LA PLANCHE, tant qu'elle est PRÉSENTE : chaque élément au-dessus du
  //       plancher de son type, à l'échelle apparente. À zoom serré, un bloc
  //       minuscule montre donc TOUT ; c'est en s'éloignant qu'on cède.
  if (elastique || planchePresente(section, plan.echelle * apparence)) {
    const boites = section.controls.map((control) => ({
      control,
      box: placeDuControle(plan, controlBox(control)),
      cellule: celluleDe(section, control) * plan.echelle,
    }))
    return {
      mode: "planche",
      echelle: plan.echelle,
      boites,
      // Le plus grand corps qui loge TOUS les noms ; sinon le plus petit, et
      // les noms qui débordent tombent un à un au seuil d'écran.
      labelPx:
        silkscreenSteps(section).find((px) => namesFit(section, plan.echelle, px, corpsW)) ??
        silkscreenSteps(section).at(-1) ??
        9,
      colonnes: 0,
    }
  }

  // ── 2. LE RETRAIT : par la fin de l'ordre de priorité, et les survivants
  //       grandissent dans la place libérée. Chaque cellule porte sa bande de
  //       nom tant qu'elle en a les moyens (`bandeNomDe`) ; la bande tombe
  //       AVANT les éléments, et sa place leur revient.
  const ranked = rankedControls(section, exposed)
  const grille = composerGrille(ranked, corpsW, corpsH, apparence)
  const seul = grille.retenus.length <= 1
  // Le corps des noms s'ADAPTE au pas de colonne : le plus grand cran de
  // sérigraphie qui loge le plus long nom retenu — un cran figé laissait
  // toutes les étiquettes tomber dès que la grille serrait.
  const budget = Math.min(...grille.retenus.map((r) => (r.cellule > 0 ? r.cellule : Infinity)))
  const pas = silkscreenSteps(section)
  const labelPx =
    Number.isFinite(budget)
      ? (pas.find((px) =>
          grille.retenus.every((r) => labelWidth(labelOf(r.control), px) <= r.cellule),
        ) ??
        pas.at(-1) ??
        9)
      : (pas.at(-1) ?? 9)
  return {
    mode: seul ? "seul" : "macros",
    echelle: grille.echelle,
    boites: grille.retenus,
    labelPx: seul ? (pas[0] ?? 11) : labelPx,
    colonnes: grille.colonnes,
  }
}

/**
 * Disposition d'une section.
 *
 * **Un seul emplacement, et c'est délibéré.** Les rails génériques ne
 * figurent pas : ils remplaceraient les molettes par des glissières, c'est-à-dire
 * changeraient l'objet. Le panneau porte lui-même son échelle sémantique
 * (`planPanel`), et son minimum est celui d'un contrôle unique avec son nom —
 * en dessous, la tuile retombe sur le paramètre exposé en grand, comme partout.
 */
/**
 * La taille minimale d'une SECTION de machine, en unités monde. Bien plus
 * petite que la tuile libre minimale : une section vit sous le planogramme,
 * dont plusieurs cotes sont déjà sous la tuile libre — lui appliquer le
 * minimum du canvas fait sauter les gestes au lieu de les borner.
 */
export const MIN_SECTION = { w: 10, h: 10 }

export function sectionLayout(section                )   
                                                                                                                          
                                                                                                                            
                                                                                                                         
  {
  // `aspect` donne à la planche la hauteur qui rend son échelle juste.
  // Le minimum du panneau est MINUSCULE, et c'est voulu : la dernière marche
  // d'une section de machine est un CONTRÔLE en grand (le palier seul), pas
  // un mot. À 26 px, le panneau mourait au dézoom et la tuile retombait sur
  // le texte du paramètre exposé — un séquenceur entier remplacé par le mot
  // « play », qui n'était même pas un bouton.
  const panel = {
    id: "machine",
    min: { ...MIN_SECTION },
    aspect: section.h / section.w,
    grow: true,
  }
  return { bande: [panel], colonne: [panel], pave: [panel] }
}

// ────────────────────────────────────── le branchement au moteur audio

/**
 * Ce qui fait qu'une machine SONNE et se CÂBLE.
 *
 * Sans ça, un planogramme n'est qu'un dessin : on tourne des molettes et rien
 * ne se passe, et surtout on ne peut pas le relier à la SORTIE. C'était le
 * défaut le plus grave de la première livraison — trois instruments posés sur
 * le canvas, aucun moyen de les entendre.
 *
 * Deux décisions, et elles suivent le matériel :
 *
 *   1. **Une machine a UNE sortie**, portée par la section qui porte son
 *      volume — sur l'appareil réel, la prise jack est sur la face qui porte
 *      le master. `ml_master`, `tr_t1` et, faute de section master sur la
 *      MicroFreak, la section qui tient son `vol`.
 *   2. **Un synthé accepte des notes, une boîte à rythme non.** Le minilogue
 *      et la MicroFreak reçoivent le CLAVIER ; la TR-8S joue son propre motif.
 *
 * Le reste est du mapping : quel contrôle du planogramme pilote quel paramètre
 * du moteur. Il est délibérément partiel — on branche ce qui s'entend, et on
 * le dit. Les contrôles non mappés bougent sans effet sonore, ce qui est
 * honnête tant que le moteur ne sait pas les servir.
 */
                                
     
                                        
    
                                                                            
                                                                             
                                                                               
     
                                                                                                         
                                                                                     
                    
                                           
                  
                                                                                         
                                                                        
 

/** Interpolation linéaire — pour écrire les mappings sans bruit. */
const lin = (min        , max        ) => (norm        ) => min + (max - min) * norm
/** Interpolation exponentielle — les fréquences et les durées s'entendent ainsi. */
const exp = (min        , max        ) => (norm        ) => min * Math.pow(max / min, norm)

/**
 * LE PANNEAU D'UNE BOÎTE À RYTHME, VOIX PAR VOIX.
 *
 * Le planogramme TR-8S expose onze instruments, chacun avec ses quatre
 * réglages — accord, déclin, contrôle, niveau. Le moteur porte exactement les
 * mêmes onze voix : la correspondance est donc UN POUR UN, et elle se génère
 * plutôt que de s'écrire à la main.
 *
 * Ce n'est pas un détail de style. Écrite à la main, cette table mentait :
 * le fader du tom bas pilotait le charley, celui du rimshot pilotait le tom.
 * Un geste qui ne fait pas ce qu'il dit est pire qu'un geste absent.
 *
 * Seule irrégularité, assumée : le panneau nomme le clap `hc` (hand clap),
 * le moteur `cp`. Le reste des sigles coïncide.
 */
const VOIX_TR                              = [
  ["bd", "bd"], ["sd", "sd"], ["lt", "lt"], ["mt", "mt"], ["ht", "ht"],
  ["rs", "rs"], ["hc", "cp"], ["ch", "ch"], ["oh", "oh"], ["cc", "cc"], ["rc", "rc"],
]

function reglagesDeVoix()                                                                 {
  const table                                                                 = {}
  for (const [panneau, voix] of VOIX_TR) {
    const descripteurs = DRUM_VOICES.find((candidate) => candidate.id === voix)
    if (!descripteurs) continue
    table[`tr_${panneau}_tun`] = { param: `${voix}.tune`, from: exp(descripteurs.tune.min, descripteurs.tune.max) }
    table[`tr_${panneau}_dec`] = { param: `${voix}.decay`, from: exp(descripteurs.decay.min, descripteurs.decay.max) }
    table[`tr_${panneau}_ctl`] = { param: `${voix}.ctrl`, from: lin(0, 100) }
    table[`tr_${panneau}_lv`] = { param: `${voix}.niv`, from: lin(0, 1.4) }
  }
  return table
}

/** Les réglages d'un synthé soustractif, mappés sur les noms usuels d'un panneau. */
const coupure = { param: "cutoff", from: exp(60, 14000) }
const resonance = { param: "resonance", from: exp(0.1, 20) }
const volume = { param: "gain", from: lin(0, 1) }

export const MACHINE_ENGINES                                = {
  /**
   * LA TABLE DE MIX — la seule machine dont CHAQUE tranche est un nœud audio.
   *
   * Partout ailleurs, une machine a une section porteuse et une seule : c'est
   * elle qui tient l'instrument ou l'effet, les autres sections ne sont que
   * des contrôles. Une table est faite pour recevoir PLUSIEURS sources ; sa
   * particularité est donc que chaque tranche a sa propre entrée, et que le
   * câblage y mène directement — c'est ce qui répond, sans nouveau mécanisme
   * de bornes multiples, à « une piste par source ».
   *
   * Le mapping est vide : chaque tranche a son propre effet, réglé par
   * `pousserTranche` dans le rack, pas par la table de correspondance qui ne
   * sait viser qu'un moteur unique.
   */
  mix: { voice: "table", outSection: "mix_main", notesIn: false, map: {} },
  // ── les instruments : ils reçoivent des notes et sortent du son
  ml: {
    voice: "synth",
    outSection: "ml_master",
    notesIn: true,
    map: {
      ml_cut: coupure,
      ml_res: resonance,
      ml_mvol: volume,
      ml_v1wave: { param: "wave", from: (n) => Math.round(n * 2) },
      ml_v2pitch: { param: "detune", from: lin(0, 50) },
      ml_e2i: { param: "envAmount", from: lin(0, 8000) },
      ml_ega: { param: "attack", from: exp(0.001, 2) },
      ml_egd: { param: "decay", from: exp(0.01, 2) },
      ml_egs: { param: "sustain", from: lin(0, 1) },
      ml_egr: { param: "release", from: exp(0.01, 3) },
    },
  },
  /**
   * LA MICROFREAK — le seul moteur NUMÉRIQUE du plateau.
   *
   * Elle partageait le synthé soustractif du minilogue et sonnait donc
   * exactement comme lui : poser les deux n'avait aucun sens. Elle porte
   * maintenant Plaits, compilé depuis les sources d'Émilie Gillet — c'est
   * littéralement le moteur que la vraie machine embarque.
   *
   * LE PANNEAU N'A PAS BOUGÉ D'UN CONTRÔLE, et c'est le point : la section
   * OSC de la MicroFreak porte déjà `type / wave / timbre / shape`, qui EST
   * la grammaire de Plaits. Ces quatre molettes existaient et ne servaient à
   * rien de juste ; elles servent maintenant à ce qu'elles annoncent.
   *
   *   type   → le modèle d'oscillateur (six)
   *   wave   → les harmoniques
   *   timbre → le timbre
   *   shape  → le morph
   *
   * Le sélecteur `mode` du filtre (lp/bp/hp) était mort lui aussi — le synthé
   * soustractif ne savait pas le servir. Il coupe maintenant pour de vrai.
   *
   * Reste non mappé, et c'est dit plutôt que caché : la machine n'a qu'une
   * molette `decay` là où le moteur distingue déclin et release. On branche le
   * déclin ; le release garde sa valeur et se règle ailleurs, plutôt que
   * d'inventer une liaison que l'appareil ne fait pas.
   */
  mf: {
    voice: "plaits",
    outSection: "mf_x8",
    notesIn: true,
    map: {
      mf_fcut: coupure,
      mf_fres: resonance,
      mf_pvol: volume,
      mf_otype: { param: "modele", from: (n) => Math.round(n * 5) },
      mf_owave: { param: "harmo", from: lin(0, 1) },
      mf_otim: { param: "timbre", from: lin(0, 1) },
      mf_oshape: { param: "morph", from: lin(0, 1) },
      mf_fmode: { param: "fmode", from: (n) => Math.round(n * 2) },
      mf_camt: { param: "envAmount", from: lin(0, 8000) },
      mf_eatt: { param: "attack", from: exp(0.001, 2) },
      mf_edec: { param: "decay", from: exp(0.01, 2) },
      mf_esus: { param: "sustain", from: lin(0, 1) },
    },
  },
  p6: {
    voice: "synth",
    outSection: "p6_a7",
    notesIn: true,
    map: { p6_cut: coupure, p6_res: resonance, p6_vol: volume },
  },
  /**
   * L'ACID-3 est une 303, pas un synthé poly réglé grave.
   *
   * Elle tournait sur le synthé soustractif générique : deux oscillateurs
   * désaccordés, filtre 12 dB, ADSR — rien de ce qui fait le son. Elle porte
   * maintenant la BASSE ACIDE du moteur : mono, filtre en échelle 18 dB,
   * enveloppe à décroissance seule, glide sur note liée, accent. Et son
   * panneau, qui avait déjà les bonnes molettes, les pilote enfin toutes.
   */
  a3: {
    voice: "acide",
    outSection: "a3_b1",
    notesIn: true,
    map: {
      a3_wv: { param: "wave", from: (n) => Math.round(n) },
      a3_glide: { param: "glide", from: exp(0.01, 0.4) },
      a3_cut: { param: "cutoff", from: exp(60, 8000) },
      a3_res: { param: "resonance", from: exp(0.5, 22) },
      a3_emod: { param: "envMod", from: lin(0, 100) },
      a3_dec: { param: "decay", from: exp(0.03, 2.4) },
      a3_acc: { param: "accent", from: lin(0, 100) },
      a3_vol: { param: "gain", from: lin(0, 1) },
    },
  },
  f6: { voice: "synth", outSection: "f6_c1", notesIn: true, map: {} },
  s4: { voice: "synth", outSection: "s4_d4", notesIn: true, map: { s4_ovol: volume } },

  // ── la boîte à rythme : elle joue son propre motif, pas de notes en entrée
  tr: {
    voice: "rythme",
    outSection: "tr_t1",
    notesIn: false,
    map: {
      tr_vol: { param: "gain", from: lin(0, 1.4) },
      // Le sélecteur de kit du panneau choisit la MACHINE : 808 ou 909. Ce ne
      // sont pas deux réglages du même circuit, ce sont deux circuits.
      tr_kit: { param: "kit", from: (norm        ) => Math.round(norm) },
      ...reglagesDeVoix(),
    },
  },

  // ── les effets : ils reçoivent du son et en rendent
  t3: {
    voice: "delay",
    outSection: "t3_e2",
    notesIn: false,
    map: {
      t3_rate: { param: "time", from: exp(20, 1200) },
      t3_int: { param: "fdb", from: lin(0, 95) },
      t3_evol: { param: "mix", from: lin(0, 100) },
      t3_rtone: { param: "tone", from: exp(400, 12000) },
    },
  },
  pl: {
    voice: "reverb",
    outSection: "pl_g4",
    notesIn: false,
    map: {
      pl_dec: { param: "decay", from: exp(0.3, 12) },
      pl_hf: { param: "damp", from: exp(600, 14000) },
      pl_out: { param: "mix", from: lin(0, 100) },
    },
  },
  vm: {
    voice: "comp",
    outSection: "vm_h4",
    notesIn: false,
    map: {
      vm_thr: { param: "threshold", from: lin(-60, 0) },
      vm_att: { param: "attack", from: exp(0.001, 0.3) },
      vm_rel: { param: "release", from: exp(0.02, 2) },
      vm_mk: { param: "makeup", from: lin(0, 24) },
    },
  },

  // ── les émetteurs de notes : aucun son propre, une borne de notes en sortie
  kb: { voice: "notes", outSection: "kb_k3", notesIn: false, map: {} },
  sq: { voice: "notes", outSection: "sq_q1", notesIn: false, map: {} },

  // ── le panneau de démonstration des gabarits : rien à brancher
  ix: { voice: null, outSection: "ix_i1", notesIn: false, map: {} },
}

/** La section porte-t-elle la sortie audio de sa machine ? */
export function isOutSection(sectionId        )          {
  return Object.values(MACHINE_ENGINES).some((engine) => engine.outSection === sectionId)
}

/** Le moteur d'une machine, depuis un identifiant de section. */
export function engineOfSection(sectionId        )                                                           {
  const machineId = sectionId.split("_")[0]
  const engine = machineId ? MACHINE_ENGINES[machineId] : undefined
  return engine && machineId ? { machineId, engine } : undefined
}

// ─────────────────────────────────────────────── les notes du clavier

/**
 * Note MIDI d'une touche du KBD-01, à partir de son identifiant.
 *
 * Les blanches `kb_w0`…`kb_w14` suivent la gamme majeure (deux octaves plus
 * un do) ; les noires `kb_b0`…`kb_b9` s'intercalent par groupes de cinq. La
 * base est do3 (48) — la même que le CLAVIER du catalogue.
 */
export const KEY_BASE_NOTE = 48

export function keyNote(controlId        )                {
  const match = /^kb_(w|b)(\d+)$/.exec(controlId)
  if (!match) return null
  const index = Number(match[2])
  if (match[1] === "w") {
    const octave = Math.floor(index / 7)
    const degres = [0, 2, 4, 5, 7, 9, 11]
    return KEY_BASE_NOTE + octave * 12 + (degres[index % 7] ?? 0)
  }
  const octave = Math.floor(index / 5)
  const noires = [1, 3, 6, 8, 10]
  return KEY_BASE_NOTE + octave * 12 + (noires[index % 5] ?? 1)
}
