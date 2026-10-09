// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/instruments/acid-bass.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * BASSE ACIDE — le circuit d'une TB-303, en Web Audio pur.
 *
 * Ce qui fait ce son n'est pas l'oscillateur : c'est ce qui l'entoure.
 *
 *   1. UN SEUL oscillateur, dent de scie ou carré. Pas de désaccord, pas de
 *      seconde voix — la 303 est monophonique et maigre, et c'est le point.
 *   2. UN FILTRE EN ÉCHELLE, 18 dB par octave. Trois passe-bas en série, pas
 *      un seul : c'est la pente qui donne cette fermeture caoutchouteuse. Un
 *      filtre biquad seul (12 dB) sonne toujours trop ouvert.
 *   3. UNE ENVELOPPE QUI OUVRE LE FILTRE, à décroissance seule — pas d'ADSR.
 *      Elle claque et retombe ; c'est le « wow » de chaque note.
 *   4. LE GLIDE. Une note liée ne redéclenche rien : la hauteur GLISSE vers
 *      elle et le filtre reste ouvert. C'est la moitié du groove acide.
 *   5. L'ACCENT. Il pousse le niveau ET l'ouverture du filtre, et raccourcit
 *      un peu l'enveloppe : la note miaule. Deux états seulement, comme sur la
 *      machine — le motif dit oui ou non.
 *
 * Monophonique par construction : une seule voix vit à la fois, et une
 * nouvelle note reprend la même chaîne. C'est la seule façon d'avoir un vrai
 * glide — deux voix indépendantes ne peuvent pas glisser l'une vers l'autre.
 */

import { midiToFrequency } from "../timing.js"
import { clamp } from "../timing.js"


const ONDES = ["sawtooth", "square"]

/** Les six réglages de la machine, plus l'onde et le niveau. */
const PARAMETERS                                 = [
  { id: "wave", label: "onde", min: 0, max: 1, default: 0, curve: "choice", choices: ONDES },
  { id: "cutoff", label: "coupure", min: 60, max: 8000, default: 520, unit: "Hz", curve: "exponential" },
  { id: "resonance", label: "réso", min: 0.5, max: 22, default: 12, curve: "exponential" },
  { id: "envMod", label: "env mod", min: 0, max: 100, default: 62, unit: "%", curve: "linear" },
  { id: "decay", label: "déclin", min: 0.03, max: 2.4, default: 0.42, unit: "s", curve: "exponential" },
  { id: "accent", label: "accent", min: 0, max: 100, default: 58, unit: "%", curve: "linear" },
  { id: "glide", label: "glide", min: 0.01, max: 0.4, default: 0.06, unit: "s", curve: "exponential" },
  { id: "gain", label: "vol", min: 0, max: 1, default: 0.6, curve: "linear" },
]

/** Les trois étages du filtre en échelle : 3 × 6 dB = 18 dB par octave. */
const ETAGES = 3

/* --------------------------------------------------------- calculs purs */

/**
 * L'ouverture du filtre au sommet de l'enveloppe, en Hz.
 *
 * La coupure est le plancher ; `envMod` dit de combien l'enveloppe la pousse
 * au-dessus, et l'accent ajoute encore. Le résultat est borné au Nyquist
 * pratique : au-delà, le filtre ne filtre plus rien et le son se dénature.
 */
export function ouverture(
  coupure        ,
  envMod        ,
  accent        ,
  accentue         ,
  nyquist = 20000,
)         {
  const facteur = 1 + (envMod / 100) * 11 + (accentue ? (accent / 100) * 9 : 0)
  return clamp(coupure * facteur, coupure, nyquist * 0.92)
}

/**
 * La résonance vue par UN étage.
 *
 * Trois biquads en série multiplient leurs résonances : régler chaque étage à
 * la valeur demandée donnerait un pic trois fois trop haut, qui sature. On
 * répartit — et on garde un plancher, sans quoi le filtre perd son grain.
 */
export function resonanceParEtage(resonance        , etages = ETAGES)         {
  return Math.max(0.5, resonance / Math.sqrt(etages))
}

/**
 * Le niveau d'une note : la vélocité du motif, poussée par l'accent.
 * Jamais au-delà de 1 — au-delà on ne gagne que de la distorsion non voulue.
 */
export function niveauNote(velocite        , accent        , accentue         )         {
  const pousse = accentue ? 1 + (accent / 100) * 0.7 : 1
  return clamp(velocite * pousse, 0, 1)
}

/**
 * La durée de l'enveloppe de filtre. Une note accentuée claque plus vite :
 * c'est ce qui la rend mordante plutôt que simplement plus forte.
 */
export function declinEffectif(decay        , accentue         )         {
  return accentue ? decay * 0.62 : decay
}

/* ------------------------------------------------------------ l'instrument */








export class AcidBass                       {
           descriptor
           output
           ready = true

           #context
           #values = new Map                ()
  #voix              = null
  /** La hauteur en cours — le point de départ d'un glide. */
  #hauteur = 0
  // SHOWRUNNER : toutes les voix planifiées qui n'ont pas fini — la dernière
  // ne suffit pas à l'arrêt : une note posée d'avance (l'ordonnanceur planifie
  // plusieurs doubles croches devant l'horloge) partirait encore après.
  #vivantes = new Set()

  constructor(context                  , id = "acide", name = "BASSE ACIDE") {
    this.#context = context
    this.descriptor = { id, name, kind: "melodic" }
    this.output = context.createGain()
    for (const parameter of PARAMETERS) this.#values.set(parameter.id, parameter.default)
    this.output.gain.value = this.getParameter("gain")
  }

  async load()                {
    // Rien à charger : tout est synthétisé.
  }

  getParameters()                                 {
    return PARAMETERS
  }

  getParameter(id        )         {
    return this.#values.get(id) ?? 0
  }

  // SHOWRUNNER : `time` (facultatif), l'instant où le réglage prend effet (un attracteur, moteur.js)
  setParameter(id        , value        , time         )       {
    const descriptor = PARAMETERS.find((parameter) => parameter.id === id)
    if (!descriptor) return
    const next = clamp(value, descriptor.min, descriptor.max)
    this.#values.set(id, next)
    const maintenant = Math.max(time ?? 0, this.#context.currentTime)
    if (id === "gain") this.output.gain.setTargetAtTime(next, maintenant, 0.01)
    if (id === "wave" && this.#voix) this.#voix.osc.type = ONDES[Math.round(next)] ?? "sawtooth"
    if (id === "resonance" && this.#voix) {
      const parEtage = resonanceParEtage(next)
      for (const etage of this.#voix.etages) etage.Q.setTargetAtTime(parEtage, maintenant, 0.01)
    }
  }

  noteOn(event               )       {
    const frequence = midiToFrequency(event.note)
    const accentue = event.accent === true
    const glisse = event.slide === true && this.#voix !== null

    const coupure = this.getParameter("cutoff")
    const sommet = ouverture(coupure, this.getParameter("envMod"), this.getParameter("accent"), accentue)
    const declin = declinEffectif(this.getParameter("decay"), accentue)
    const niveau = niveauNote(event.velocity, this.getParameter("accent"), accentue)
    const fin = event.time + Math.max(event.duration, declin) + 0.05

    const voix = glisse && this.#voix ? this.#voix : this.#nouvelleVoix(event.time)

    // LA HAUTEUR. Une note liée glisse depuis la précédente ; une note piquée
    // se pose net. C'est le seul endroit où `slide` agit sur l'oscillateur.
    if (glisse && this.#hauteur > 0) {
      voix.osc.frequency.cancelScheduledValues(event.time)
      voix.osc.frequency.setValueAtTime(this.#hauteur, event.time)
      voix.osc.frequency.exponentialRampToValueAtTime(
        frequence,
        event.time + this.getParameter("glide"),
      )
    } else {
      voix.osc.frequency.setValueAtTime(frequence, event.time)
    }
    this.#hauteur = frequence

    // L'ENVELOPPE DE FILTRE. Elle claque et retombe vers la coupure — pas de
    // sustain : c'est une enveloppe à décroissance seule, comme la machine.
    for (const etage of voix.etages) {
      etage.frequency.cancelScheduledValues(event.time)
      etage.frequency.setValueAtTime(sommet, event.time)
      etage.frequency.exponentialRampToValueAtTime(Math.max(60, coupure), event.time + declin)
    }

    // LE VCA. Une note liée ne le redéclenche pas : le son ne se coupe jamais
    // entre deux notes liées, c'est exactement ce qui les lie.
    const vca = voix.vca.gain
    vca.cancelScheduledValues(event.time)
    if (glisse) {
      vca.setTargetAtTime(niveau, event.time, 0.008)
    } else {
      vca.setValueAtTime(0.0001, event.time)
      vca.exponentialRampToValueAtTime(Math.max(0.0002, niveau), event.time + 0.004)
    }
    // La note s'éteint à sa fin, sauf si une note liée reprend avant.
    const coupe = event.time + Math.max(0.02, event.duration)
    vca.setTargetAtTime(0.0001, coupe, 0.02)

    voix.finit = fin
  }

  // SHOWRUNNER : relâcher la note jouée à la main (clavier, MIDI) — la voix
  // monophonique ne s'éteint que si c'est bien sa hauteur qui sonne encore.
  noteOff(note, time = this.#context.currentTime) {
    if (!this.#voix || Math.abs(this.#hauteur - midiToFrequency(note)) > 0.01) return
    const vca = this.#voix.vca.gain
    vca.cancelScheduledValues(time)
    vca.setTargetAtTime(0.0001, time, 0.02)
  }

  allNotesOff(time         )       {
    const quand = time ?? this.#context.currentTime
    // SHOWRUNNER : chaque voix planifiée, pas seulement la dernière (#vivantes)
    for (const voix of this.#vivantes) {
      voix.vca.gain.cancelScheduledValues(quand)
      voix.vca.gain.setTargetAtTime(0.0001, quand, 0.01)
      try {
        voix.osc.stop(quand + 0.06)
      } catch {
        // déjà arrêtée
      }
    }
    this.#vivantes.clear()
    this.#voix = null
    this.#hauteur = 0
  }

  dispose()       {
    this.allNotesOff()
    this.output.disconnect()
  }

  #nouvelleVoix(time        )       {
    // La voix précédente s'en va : la 303 est monophonique, une note en
    // remplace une autre. On la coupe court plutôt que de la laisser traîner.
    if (this.#voix) {
      const partante = this.#voix
      partante.vca.gain.cancelScheduledValues(time)
      partante.vca.gain.setTargetAtTime(0.0001, time, 0.006)
      try {
        partante.osc.stop(time + 0.05)
      } catch {
        // déjà arrêtée
      }
    }

    const osc = this.#context.createOscillator()
    osc.type = ONDES[Math.round(this.getParameter("wave"))] ?? "sawtooth"

    // LE FILTRE EN ÉCHELLE : trois passe-bas en série. C'est la pente à 18 dB
    // qui fait la 303 ; un seul biquad reste trop ouvert et le son s'éclaircit.
    const parEtage = resonanceParEtage(this.getParameter("resonance"))
    const etages                     = []
    let precedent            = osc
    for (let rang = 0; rang < ETAGES; rang++) {
      const etage = this.#context.createBiquadFilter()
      etage.type = "lowpass"
      // Seul le premier étage porte la résonance : trois pics superposés
      // saturent, et c'est le premier qui donne le grain.
      etage.Q.value = rang === 0 ? parEtage : 0.5
      precedent.connect(etage)
      precedent = etage
      etages.push(etage)
    }

    const vca = this.#context.createGain()
    vca.gain.value = 0.0001
    precedent.connect(vca)
    vca.connect(this.output)

    osc.start(time)
    const voix       = { osc, etages, vca, finit: time }
    this.#voix = voix
    this.#vivantes.add(voix)
    osc.onended = () => this.#vivantes.delete(voix)   // SHOWRUNNER : voir #vivantes
    return voix
  }
}
