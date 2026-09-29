// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/instruments/rhythm-box.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * BOITE A RYTHME — onze voix percussives, deux circuits, entièrement synthétisées.
 *
 * Pourquoi ne pas se contenter de `DrumKit` : celui-ci charge des échantillons
 * depuis le réseau. Le prototype doit sonner hors ligne, dans un fichier HTML
 * unique — la même raison qui fait qu'`AnalogSynth` est la source par défaut.
 * Ici, tout est fabriqué à la volée : oscillateurs, bruit, enveloppes.
 *
 * Une voix = un pad = une note MIDI. Chaque déclenchement construit son propre
 * petit graphe, le joue, et le laisse mourir : c'est la façon la plus simple
 * d'être polyphonique sans gérer de vol de voix, et une percussion est par
 * nature un évènement qui ne se relâche pas.
 *
 * Les timbres — les cotes des deux machines — sont dans `drums-voices.ts`,
 * en données pures et testées. Ce fichier ne fait que les monter en Web Audio.
 *
 *   36 BD · 37 SD · 38 LT · 39 MT · 40 HT · 41 RS · 42 CP · 43 CH · 44 OH
 *   45 CC · 46 RC
 */

import { clamp } from "../timing.js"

import {
  dureeFrappe,
  hauteurAttaque,
  melangeCaisse,
  timbreDe,
  voixDeNote,
  KITS,
  PREMIERE_NOTE,
  VOIX,



} from "./drums-voices.js"

export const FIRST_DRUM_NOTE = PREMIERE_NOTE

/**
 * Le contrat que l'interface consomme — elle dessine une tranche par voix.
 * C'est la même forme qu'avant l'arrivée des deux circuits ; ce qui a changé,
 * c'est qu'il y en a onze et que leur timbre dépend du kit.
 */










const enDrumVoice = (voix      )            => ({
  note: voix.note,
  id: voix.id,
  name: voix.nom,
  short: voix.court,
  // Les défauts viennent du kit d'origine : une 808 est la machine de départ.
  tune: { min: voix.tune.min, max: voix.tune.max, default: voix.kits["808"].hauteur },
  decay: { min: voix.chute.min, max: voix.chute.max, default: voix.kits["808"].chute },
  ctrl: { label: voix.ctrl, default: 50 },
})

export const DRUM_VOICES                       = VOIX.map(enDrumVoice)

/** Les quatre réglages d'une tranche, dans l'ordre de la machine. */
export const VOICE_KNOBS = ["tune", "decay", "ctrl", "niv"]


/** Identifiant du paramètre d'une voix : `bd.tune`. */
export function voiceParam(voice           , knob           )         {
  return `${voice.id}.${knob}`
}

const PAD_NAMES                                   = Object.fromEntries(
  DRUM_VOICES.map((voice) => [voice.note, voice.name]),
)

/**
 * Quatre réglages par voix, puis les réglages d'ensemble.
 *
 * C'est la grammaire d'une vraie boîte à rythme, et elle n'est pas
 * décorative : accorder la grosse caisse sans toucher au charley est
 * exactement ce qu'on passe son temps à faire.
 *
 * `kit` est en tête : c'est le réglage qui change tout le reste.
 */
const PARAMETERS                                 = [
  {
    id: "kit",
    label: "machine",
    min: 0,
    max: KITS.length - 1,
    default: 0,
    curve: "choice",
    choices: KITS,
  },
  ...DRUM_VOICES.flatMap((voice) => [
    {
      id: voiceParam(voice, "tune"),
      label: `${voice.short.toLowerCase()} tune`,
      min: voice.tune.min,
      max: voice.tune.max,
      default: voice.tune.default,
      unit: "Hz",
      curve: "exponential"         ,
    },
    {
      id: voiceParam(voice, "decay"),
      label: `${voice.short.toLowerCase()} decay`,
      min: voice.decay.min,
      max: voice.decay.max,
      default: voice.decay.default,
      unit: "s",
      curve: "exponential"         ,
    },
    {
      id: voiceParam(voice, "ctrl"),
      label: `${voice.short.toLowerCase()} ${voice.ctrl.label}`,
      min: 0,
      max: 100,
      default: voice.ctrl.default,
      unit: "%",
      curve: "linear"         ,
    },
    {
      id: voiceParam(voice, "niv"),
      label: voice.name.toLowerCase(),
      min: 0,
      max: 1.4,
      default: 1,
      unit: "",
      curve: "linear"         ,
    },
  ]),
  { id: "drive", label: "drive", min: 0, max: 100, default: 18, unit: "%", curve: "linear" },
  { id: "gain", label: "gain", min: 0, max: 1.4, default: 0.85, unit: "", curve: "linear" },
]

/** Longueur du bruit de fond, en secondes. Assez long pour ne jamais s'entendre boucler. */
const NOISE_SECONDS = 2

export class RhythmBox                       {
           descriptor
           output

  #ready = false
           #context
           #values = new Map                ()
           #shaper
           #voices
  #noise                     = null
  /** Sources en vol, pour pouvoir tout couper net sur un panic. */
           #playing = new Set                          ()

  constructor(context                  , id = "rythme", name = "BOITE A RYTHME") {
    this.#context = context
    this.descriptor = { id, name, kind: "drum", padNames: PAD_NAMES }

    this.#voices = context.createGain()
    this.#shaper = context.createWaveShaper()
    this.#shaper.oversample = "2x"
    this.output = context.createGain()

    this.#voices.connect(this.#shaper)
    this.#shaper.connect(this.output)

    for (const parameter of PARAMETERS) this.#values.set(parameter.id, parameter.default)
    this.#renderCurve()
    this.output.gain.value = this.getParameter("gain")
  }

  get ready()          {
    return this.#ready
  }

  /**
   * Rien à télécharger : on ne fabrique que le tampon de bruit, une fois.
   * `load()` reste asynchrone pour respecter le contrat commun.
   */
  async load()                {
    if (this.#ready) return
    const frames = Math.floor(this.#context.sampleRate * NOISE_SECONDS)
    const buffer = this.#context.createBuffer(1, frames, this.#context.sampleRate)
    const data = buffer.getChannelData(0)
    // Bruit blanc simple : pour de la percussion, la coloration vient des
    // filtres qui le suivent, pas de la source.
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1
    this.#noise = buffer
    this.#ready = true
  }

  /** La machine en cours — c'est elle qui décide de tous les timbres. */
  get kit()      {
    return KITS[Math.round(this.getParameter("kit"))] ?? "808"
  }

  noteOn(event               )       {
    if (!this.#ready) return
    const voix = voixDeNote(event.note)
    if (!voix) return
    const timbre = timbreDe(voix, this.kit)
    // La vélocité du pas et le niveau de la voix se multiplient : l'un vient de
    // la phrase, l'autre du fader. Ce sont deux gestes différents, et le fader
    // ne doit pas écraser ce que la phrase a écrit.
    const niveau = clamp(event.velocity, 0, 1) * this.getParameter(`${voix.id}.niv`) * timbre.niveau
    const accord = this.getParameter(`${voix.id}.tune`)
    const chute = this.getParameter(`${voix.id}.decay`)
    const ctrl = this.getParameter(`${voix.id}.ctrl`) / 100
    const t = event.time

    switch (timbre.moteur) {
      case "peau":
        this.#peau(t, niveau, accord, chute, ctrl, timbre)
        break
      case "caisse":
        this.#caisse(t, niveau, accord, chute, ctrl, timbre)
        break
      case "bruit":
        this.#bruit(t, niveau, accord, chute, ctrl, timbre)
        break
      case "metal":
        this.#metal(t, niveau, accord, chute, ctrl, timbre)
        break
    }
  }

  allNotesOff(time         )       {
    const when = time ?? this.#context.currentTime
    for (const source of this.#playing) {
      try {
        source.stop(when)
      } catch {
        // Déjà arrêtée : rien à faire.
      }
    }
    this.#playing.clear()
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
    if (next === this.#values.get(id)) return
    this.#values.set(id, next)
    if (id === "gain") {
      this.output.gain.setTargetAtTime(next, this.#context.currentTime, 0.01)
    } else if (id === "drive") {
      this.#renderCurve()
    }
    // Les réglages de voix sont lus au déclenchement : une percussion déjà en
    // vol ne change pas de hauteur en cours de route.
  }

  dispose()       {
    this.allNotesOff()
    this.#voices.disconnect()
    this.#shaper.disconnect()
    this.output.disconnect()
  }

  // ------------------------------------------------------------- les voix

  /** Enveloppe percussive : attaque immédiate, décroissance exponentielle. */
  #envelope(time        , peak        , decay        )           {
    const gain = this.#context.createGain()
    gain.gain.setValueAtTime(0, time)
    gain.gain.linearRampToValueAtTime(Math.max(0.0002, peak), time + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.01, decay))
    gain.connect(this.#voices)
    return gain
  }

  #start(source                          , time        , stop        )       {
    source.start(time)
    source.stop(stop)
    this.#playing.add(source)
    source.onended = () => this.#playing.delete(source)
  }

  #noiseSource()                               {
    if (!this.#noise) return null
    const source = this.#context.createBufferSource()
    source.buffer = this.#noise
    // Départ au hasard dans le tampon : deux coups de suite ne sont jamais
    // identiques, ce qui est tout l'intérêt d'un bruit long.
    return source
  }

  /**
   * PEAU — grosse caisse et toms. Un sinus accordé dont la hauteur tombe :
   * c'est la chute qui fait le « boum », pas la note. La 909 y ajoute une
   * bouffée de bruit très courte, son clic d'attaque.
   */
  #peau(time        , niveau        , accord        , chute        , ctrl        , timbre        )       {
    const duree = dureeFrappe(timbre, chute, ctrl)
    const osc = this.#context.createOscillator()
    osc.type = "sine"
    osc.frequency.setValueAtTime(hauteurAttaque(timbre, accord, ctrl), time)
    osc.frequency.exponentialRampToValueAtTime(accord, time + timbre.glisse + (1 - ctrl) * 0.04)
    const env = this.#envelope(time, niveau, chute)
    osc.connect(env)
    this.#start(osc, time, time + duree)

    if (timbre.souffle > 0.05) {
      const bruit = this.#noiseSource()
      if (bruit) {
        const passe = this.#context.createBiquadFilter()
        passe.type = "highpass"
        passe.frequency.value = timbre.couleur
        const clic = this.#envelope(time, niveau * timbre.souffle, 0.012)
        bruit.connect(passe)
        passe.connect(clic)
        this.#start(bruit, time, time + 0.06)
      }
    }
  }

  /**
   * CAISSE — un corps de deux partiels inharmoniques, plus le timbre bruité.
   * `ctrl` bascule de l'un à l'autre : c'est le bouton « timbre » des machines.
   */
  #caisse(time        , niveau        , accord        , chute        , ctrl        , timbre        )       {
    const { corps, souffle } = melangeCaisse(timbre, ctrl)
    const duree = dureeFrappe(timbre, chute, ctrl)

    for (const [rapport, part] of [
      [1, 0.6],
      [1.58, 0.4],
    ]         ) {
      const osc = this.#context.createOscillator()
      osc.type = "triangle"
      osc.frequency.value = accord * rapport
      const env = this.#envelope(time, niveau * corps * part, chute * 0.62)
      osc.connect(env)
      this.#start(osc, time, time + duree)
    }

    const bruit = this.#noiseSource()
    if (!bruit) return
    const passe = this.#context.createBiquadFilter()
    passe.type = "highpass"
    passe.frequency.value = timbre.couleur
    const env = this.#envelope(time, niveau * souffle * 0.7, chute)
    bruit.connect(passe)
    passe.connect(env)
    this.#start(bruit, time, time + duree)
  }

  /**
   * BRUIT — rimshot et clap. Des bandes étroites de bruit ; le clap en répète
   * plusieurs, serrées, avec une queue : c'est un rebond, pas un coup.
   */
  #bruit(time        , niveau        , accord        , chute        , ctrl        , timbre        )       {
    const bandes = timbre.bandes ?? [accord]
    const bouffees = timbre.bouffees
    const ecart = bouffees ? bouffees.ecart * (0.4 + ctrl * 1.8) : 0
    const nombre = bouffees ? bouffees.nombre : 1

    for (let rang = 0; rang < nombre; rang++) {
      const dernier = rang === nombre - 1
      const depart = time + rang * ecart
      const longueur = dernier ? chute : 0.018
      for (const bande of bandes) {
        const bruit = this.#noiseSource()
        if (!bruit) continue
        const filtre = this.#context.createBiquadFilter()
        filtre.type = "bandpass"
        // La première bande suit l'accord ; les autres gardent leur rapport.
        filtre.frequency.value = bande === bandes[0] ? accord : (bande * accord) / bandes[0]
        filtre.Q.value = bouffees ? 1.1 : 4 + ctrl * 6
        const env = this.#envelope(depart, niveau * (dernier ? 1 : 0.85) * 0.7, longueur)
        bruit.connect(filtre)
        filtre.connect(env)
        this.#start(bruit, depart, depart + longueur + 0.05)
      }
    }
  }

  /**
   * MÉTAL — charley et cymbales. Six carrés inharmoniques passés au coupe-bas,
   * exactement comme le circuit analogique : ce sont eux qui font ce timbre
   * qu'aucun oscillateur seul ne donne. `ctrl` ouvre — il abaisse le coupe-bas
   * et allonge la queue.
   *
   * Sur la 909 ces sons étaient des ÉCHANTILLONS. On ajoute donc du bruit au
   * mélange pour approcher leur densité, sans prétendre à l'exactitude.
   */
  #metal(time        , niveau        , accord        , chute        , ctrl        , timbre        )       {
    const longueur = chute * (1 + ctrl * 2.2)
    const duree = dureeFrappe(timbre, chute, ctrl)
    const coupe = this.#context.createBiquadFilter()
    coupe.type = "highpass"
    coupe.frequency.value = timbre.couleur * (1 - ctrl * 0.45)
    const cloche = this.#context.createBiquadFilter()
    cloche.type = "bandpass"
    cloche.frequency.value = accord * 1.15
    cloche.Q.value = 1.2
    const env = this.#envelope(time, niveau, longueur)
    coupe.connect(cloche)
    cloche.connect(env)

    for (const rapport of timbre.partiels ?? [1]) {
      const osc = this.#context.createOscillator()
      osc.type = "square"
      osc.frequency.value = (accord / 8) * rapport
      osc.connect(coupe)
      this.#start(osc, time, time + duree)
    }

    if (timbre.souffle > 0.05) {
      const bruit = this.#noiseSource()
      if (bruit) {
        const part = this.#context.createGain()
        part.gain.value = timbre.souffle
        bruit.connect(part)
        part.connect(coupe)
        this.#start(bruit, time, time + duree)
      }
    }
  }

  #renderCurve()       {
    const drive = this.getParameter("drive") / 100
    const size = 512
    const curve = new Float32Array(new ArrayBuffer(size * Float32Array.BYTES_PER_ELEMENT))
    const k = 1 + drive * 14
    for (let i = 0; i < size; i++) {
      const x = (i / (size - 1)) * 2 - 1
      curve[i] = Math.tanh(k * x) / Math.tanh(k)
    }
    this.#shaper.curve = curve
  }
}
