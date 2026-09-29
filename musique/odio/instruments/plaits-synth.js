// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/instruments/plaits-synth.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * LE SYNTHÉ NUMÉRIQUE — les oscillateurs de Plaits, dans un AudioWorklet.
 *
 * C'est le moteur de la MicroFreak : le vrai code d'Émilie Gillet compilé en
 * WebAssembly (`packages/engine/wasm/`), pas une imitation écrite de mémoire.
 * Jusqu'ici la MicroFreak et le minilogue partageaient le même synthé
 * soustractif et sonnaient donc pareil, ce qui rendait absurde le fait d'en
 * poser deux.
 *
 * L'ARCHITECTURE SUIT LA MACHINE RÉELLE, et ce n'est pas de la coquetterie :
 *
 *   worklet (8 voix numériques) → UN filtre → UN VCA → sortie
 *
 * Une MicroFreak est **paraphonique** : plusieurs oscillateurs, un seul filtre
 * analogique. Ce n'est pas une limite qu'on subit, c'est ce qui fait son
 * comportement — jouer un accord ouvre le filtre une fois, pas quatre, et les
 * notes se tiennent ensemble au lieu de s'empiler. Un synthé polyphonique
 * ordinaire sonne autrement. On garde donc le filtre en Web Audio (c'est la
 * partie analogique de la machine) et l'oscillateur en wasm (la partie
 * numérique). La frontière est au même endroit que dans l'appareil.
 *
 * POURQUOI UN `data:` ET PAS UN `blob:` pour charger le worklet : le studio se
 * livre en UN fichier qu'on ouvre en double-cliquant, donc sous `file://`. Là,
 * Chromium REFUSE `audioWorklet.addModule` sur une URL blob (« Unable to load
 * a worklet's module ») et accepte une URL `data:`. Vérifié, pas supposé.
 */

import { clamp, midiToFrequency } from "../timing.js"
import { octetsPlaits } from "./plaits-wasm.js"


/**
 * LES SIX MODÈLES, dans l'ordre d'une palette qu'on parcourt : du plus
 * familier au plus étrange. Les noms sont ceux qu'on dirait à voix haute, pas
 * ceux du manuel — « formants » et pas « oscillateur à formants ».
 */
export const MODELES_PLAITS = ["forme", "scie", "harmo", "grain", "phase", "formants"]

/**
 * LES TROIS MODES DU FILTRE. La MicroFreak porte ce sélecteur sur son panneau
 * depuis le début ; le synthé soustractif ne savait pas le servir et il ne
 * faisait rien. Un contrôle qui ment est pire qu'un contrôle absent.
 */
export const MODES_FILTRE = ["lp", "bp", "hp"]
const TYPES_FILTRE                              = ["lowpass", "bandpass", "highpass"]

/** Le nom du processeur dans le worklet. Une seule inscription par contexte. */
const PROCESSEUR = "odio-plaits"

const PARAMETERS                                 = [
  { id: "modele", label: "modèle", min: 0, max: 5, default: 0, curve: "choice", choices: MODELES_PLAITS },
  { id: "harmo", label: "harmo", min: 0, max: 1, default: 0.4, curve: "linear" },
  { id: "timbre", label: "timbre", min: 0, max: 1, default: 0.5, curve: "linear" },
  { id: "morph", label: "morph", min: 0, max: 1, default: 0.35, curve: "linear" },
  { id: "fmode", label: "mode", min: 0, max: 2, default: 0, curve: "choice", choices: MODES_FILTRE },
  { id: "cutoff", label: "coupure", min: 60, max: 14000, default: 3200, unit: "Hz", curve: "exponential" },
  { id: "resonance", label: "réso", min: 0.1, max: 20, default: 3, curve: "exponential" },
  { id: "envAmount", label: "env", min: 0, max: 8000, default: 2400, unit: "Hz", curve: "linear" },
  { id: "attack", label: "att", min: 0.001, max: 2, default: 0.006, unit: "s", curve: "exponential" },
  { id: "decay", label: "déclin", min: 0.01, max: 2, default: 0.22, unit: "s", curve: "exponential" },
  { id: "sustain", label: "sustain", min: 0, max: 1, default: 0.5, curve: "linear" },
  { id: "release", label: "release", min: 0.01, max: 3, default: 0.25, unit: "s", curve: "exponential" },
  { id: "gain", label: "vol", min: 0, max: 1, default: 0.5, curve: "linear" },
]

/** Les réglages que le worklet doit connaître — les autres vivent en Web Audio. */
const AU_WORKLET = new Set(["modele", "harmo", "timbre", "morph", "attack", "decay", "sustain", "release"])

/* ------------------------------------------------------- le code du worklet */

/**
 * LE PROCESSEUR, en source. Il part en `data:` URL, donc il ne peut RIEN
 * importer : tout ce dont il a besoin arrive par `processorOptions` (les
 * octets du module) ou par messages.
 *
 * Ce qu'il fait à chaque bloc, dans cet ordre : réveiller les notes dont
 * l'heure est venue, rendre chaque voix vivante, appliquer son enveloppe
 * ÉCHANTILLON PAR ÉCHANTILLON, accumuler.
 *
 * L'enveloppe est en JavaScript et pas dans le wasm exprès. Le module rend une
 * voix à la fois dans son tampon ; si on lui passait le niveau, l'enveloppe
 * serait plate sur tout un bloc — soit des marches de 2,7 ms, parfaitement
 * audibles sur une attaque courte. Mille multiplications par bloc ne coûtent
 * rien et l'attaque redevient propre.
 */
const SOURCE_WORKLET = `
const NB = 8

class PlaitsProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const octets = options.processorOptions.octets
    // Compilation SYNCHRONE : dans un worklet il n'y a pas d'await, et le
    // plafond des 4 ko du fil principal ne s'applique pas ici.
    const module_ = new WebAssembly.Module(octets)
    this.wasm = new WebAssembly.Instance(module_, {}).exports
    this.wasm.__wasm_call_ctors && this.wasm.__wasm_call_ctors()
    this.wasm.initialiser()
    this.blocMax = this.wasm.tailleBloc()
    this.tampon = new Float32Array(this.wasm.memory.buffer, this.wasm.tampon(), this.blocMax)

    this.reglages = { modele: 0, harmo: 0.4, timbre: 0.5, morph: 0.35, attack: 0.006, decay: 0.22, sustain: 0.5, release: 0.25 }
    this.voix = []
    for (let rang = 0; rang < NB; rang++) {
      this.voix.push({ rang, etat: "libre", f0: 0, cible: 0, env: 0, debut: 0, fin: 0, age: 0 })
    }
    this.attente = []
    this.horloge = 0

    this.port.onmessage = (message) => this.recevoir(message.data)
    this.port.postMessage({ pret: true })
  }

  recevoir(ordre) {
    if (ordre.type === "note") {
      this.attente.push(ordre)
    } else if (ordre.type === "reglage") {
      this.reglages[ordre.id] = ordre.valeur
    } else if (ordre.type === "silence") {
      for (const voix of this.voix) if (voix.etat !== "libre") voix.etat = "release"
      this.attente.length = 0
    } else if (ordre.type === "ping") {
      // SHOWRUNNER : l'export attend que les notes postées soient arrivées
      this.port.postMessage({ pong: ordre.id })
    } else if (ordre.type === "relacher") {
      // SHOWRUNNER : relâcher une note jouée à la main (sa fin avancée)
      for (const voix of this.voix) if (voix.etat !== "libre" && Math.abs(voix.f0 - ordre.f0) < 1e-9) voix.fin = Math.min(voix.fin, ordre.time)
      for (const attente of this.attente) if (Math.abs(attente.f0 - ordre.f0) < 1e-9) attente.duration = Math.max(0.01, ordre.time - attente.time)
    }
  }

  /** Une voix libre, sinon la plus ancienne : mieux vaut voler que refuser. */
  prendreVoix() {
    let libre = null
    let ancienne = this.voix[0]
    for (const voix of this.voix) {
      if (voix.etat === "libre") { libre = voix; break }
      if (voix.age < ancienne.age) ancienne = voix
    }
    const prise = libre || ancienne
    this.wasm.reinitialiserVoix(prise.rang)
    return prise
  }

  process(_entrees, sorties) {
    const sortie = sorties[0][0]
    if (!sortie) return true
    const taille = Math.min(sortie.length, this.blocMax)
    sortie.fill(0)

    // ── LES NOTES DONT L'HEURE EST VENUE, avant de rendre le bloc.
    const finBloc = currentTime + taille / sampleRate
    for (let rang = this.attente.length - 1; rang >= 0; rang--) {
      const ordre = this.attente[rang]
      if (ordre.time > finBloc) continue
      this.attente.splice(rang, 1)
      const voix = this.prendreVoix()
      voix.etat = "attaque"
      voix.f0 = ordre.f0
      voix.cible = ordre.velocity
      voix.env = 0
      voix.fin = Math.max(ordre.time + ordre.duration, ordre.time + 0.01)
      voix.age = ++this.horloge
    }

    const { modele, harmo, timbre, morph, attack, decay, sustain, release } = this.reglages
    const pasAttaque = 1 / Math.max(1, attack * sampleRate)
    // Décroissances multiplicatives : une pente exponentielle, comme un
    // circuit qui se décharge. Une rampe droite sonnerait raide.
    const chuteDecay = Math.exp(-1 / Math.max(1, decay * sampleRate * 0.35))
    const chuteRelease = Math.exp(-1 / Math.max(1, release * sampleRate * 0.35))

    for (const voix of this.voix) {
      if (voix.etat === "libre") continue
      this.wasm.rendre(voix.rang, modele, voix.f0, harmo, timbre, morph, 1, taille, 1)

      let env = voix.env
      let etat = voix.etat
      const plancher = voix.cible * sustain
      for (let i = 0; i < taille; i++) {
        const instant = currentTime + i / sampleRate
        if (etat !== "release" && instant >= voix.fin) etat = "release"
        if (etat === "attaque") {
          env += voix.cible * pasAttaque
          if (env >= voix.cible) { env = voix.cible; etat = "chute" }
        } else if (etat === "chute") {
          env = plancher + (env - plancher) * chuteDecay
        } else {
          env *= chuteRelease
        }
        sortie[i] += this.tampon[i] * env
      }
      voix.env = env
      voix.etat = etat
      // Sous ce seuil la voix ne s'entend plus : la rendre libère un doigt.
      if (etat === "release" && env < 0.0002) voix.etat = "libre"
    }
    return true
  }
}

registerProcessor(${JSON.stringify(PROCESSEUR)}, PlaitsProcessor)
`

/**
 * Un contexte n'inscrit le processeur qu'UNE fois — `addModule` deux fois avec
 * le même nom lève. On mémorise la promesse, pas le fait : deux instruments
 * créés dans la même image doivent attendre le même chargement.
 */
const inscriptions = new WeakMap                                 ()

function inscrire(context                  )                {
  const deja = inscriptions.get(context)
  if (deja) return deja
  const worklet = (context                                              ).audioWorklet
  if (!worklet) return Promise.reject(new Error("ce contexte n'a pas d'AudioWorklet"))
  const promesse = worklet.addModule("data:text/javascript," + encodeURIComponent(SOURCE_WORKLET))
  inscriptions.set(context, promesse)
  return promesse
}

/* ------------------------------------------------------------ l'instrument */

export class PlaitsSynth                       {
           descriptor
           output

           #context
           #values = new Map                ()
           #filtre
  #noeud                          = null
  #pret = false

  constructor(context                  , id = "plaits", name = "NUMÉRIQUE") {
    this.#context = context
    this.descriptor = { id, name, kind: "melodic" }
    this.output = context.createGain()
    for (const parameter of PARAMETERS) this.#values.set(parameter.id, parameter.default)
    this.output.gain.value = this.getParameter("gain")

    // Le filtre existe dès la naissance, même si le worklet n'est pas prêt :
    // les réglages qu'on lui pousse avant `load()` ne tombent pas dans le vide.
    this.#filtre = context.createBiquadFilter()
    this.#filtre.type = "lowpass"
    this.#filtre.frequency.value = this.getParameter("cutoff")
    this.#filtre.Q.value = this.getParameter("resonance")
    this.#filtre.connect(this.output)
  }

  get ready()          {
    return this.#pret
  }

  async load()                {
    if (this.#pret) return
    await inscrire(this.#context)
    const Noeud = (globalThis                                                  ).AudioWorkletNode
    if (!Noeud) throw new Error("AudioWorkletNode indisponible")
    const noeud = new Noeud(this.#context                                                     , PROCESSEUR, {
      numberOfInputs: 0,
      outputChannelCount: [1],
      processorOptions: { octets: octetsPlaits() },
    })
    noeud.connect(this.#filtre)
    this.#noeud = noeud
    this.#pret = true
    // Le worklet naît avec ses valeurs par défaut ; on lui pousse les nôtres,
    // qui ont pu changer avant que le chargement se termine.
    for (const id of AU_WORKLET) this.#pousser(id, this.getParameter(id))
  }

  getParameters()                                 {
    return PARAMETERS
  }

  getParameter(id        )         {
    return this.#values.get(id) ?? 0
  }

  setParameter(id        , value        )       {
    const descriptor = PARAMETERS.find((parameter) => parameter.id === id)
    if (!descriptor) return
    const next = clamp(value, descriptor.min, descriptor.max)
    this.#values.set(id, next)
    const maintenant = this.#context.currentTime
    if (id === "gain") this.output.gain.setTargetAtTime(next, maintenant, 0.01)
    if (id === "resonance") this.#filtre.Q.setTargetAtTime(next, maintenant, 0.01)
    if (id === "cutoff") this.#filtre.frequency.setTargetAtTime(next, maintenant, 0.02)
    if (id === "fmode") this.#filtre.type = TYPES_FILTRE[Math.round(next)] ?? "lowpass"
    if (AU_WORKLET.has(id)) this.#pousser(id, next)
  }

  noteOn(event               )       {
    if (!this.#noeud) return
    const debut = Math.max(event.time, this.#context.currentTime)
    this.#noeud.port.postMessage({
      type: "note",
      // Plaits raisonne en fréquence NORMALISÉE ; convertir ici évite une
      // division par échantillon dans le worklet.
      f0: midiToFrequency(event.note) / this.#context.sampleRate,
      velocity: clamp(event.velocity, 0, 1),
      time: debut,
      duration: Math.max(event.duration, 0.01),
    })

    // L'ENVELOPPE DE FILTRE, PARAPHONIQUE : une seule, partagée, redéclenchée
    // à chaque note. C'est le comportement de la machine — un accord ouvre le
    // filtre une fois. Deux notes très proches se contentent donc de le
    // rouvrir, elles ne s'additionnent pas.
    const coupure = this.getParameter("cutoff")
    const sommet = Math.min(coupure + this.getParameter("envAmount") * event.velocity, 18000)
    const declin = this.getParameter("decay")
    const frequence = this.#filtre.frequency
    frequence.cancelScheduledValues(debut)
    frequence.setValueAtTime(sommet, debut)
    frequence.setTargetAtTime(coupure, debut, Math.max(declin, 0.01) / 3)
  }

  // SHOWRUNNER : un aller-retour avec le worklet — les messages arrivent dans
  // l'ordre (MessagePort) : quand la réponse revient, les notes postées avant
  // sont arrivées. L'export hors temps réel l'attend avant de rendre.
  ping(ms = 3000) {
    const noeud = this.#noeud
    if (!noeud) return Promise.resolve(false)
    return new Promise((resolve) => {
      const id = Math.random()
      const t = setTimeout(() => resolve(false), ms)
      noeud.port.onmessage = (e) => { if (e.data && e.data.pong === id) { clearTimeout(t); resolve(true) } }
      noeud.port.postMessage({ type: "ping", id })
    })
  }

  // SHOWRUNNER : relâcher une note jouée à la main (clavier, MIDI)
  noteOff(note, time = this.#context.currentTime) {
    this.#noeud?.port.postMessage({ type: "relacher", f0: midiToFrequency(note) / this.#context.sampleRate, time })
  }

  allNotesOff(time         )       {
    this.#noeud?.port.postMessage({ type: "silence" })
    const quand = time ?? this.#context.currentTime
    this.#filtre.frequency.cancelScheduledValues(quand)
    this.#filtre.frequency.setValueAtTime(this.getParameter("cutoff"), quand)
  }

  dispose()       {
    this.allNotesOff()
    this.#noeud?.disconnect()
    this.#noeud = null
    this.#pret = false
    this.#filtre.disconnect()
    this.output.disconnect()
  }

  #pousser(id        , valeur        )       {
    this.#noeud?.port.postMessage({
      type: "reglage",
      id,
      valeur: id === "modele" ? Math.round(valeur) : valeur,
    })
  }
}
