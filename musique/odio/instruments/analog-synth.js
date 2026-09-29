// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, packages/engine/src/instruments/analog-synth.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Synthé soustractif polyphonique, en Web Audio pur — aucune dépendance,
 * aucun sample à télécharger. C'est l'instrument qui garantit que le moteur
 * produit du son même hors ligne.
 *
 * Architecture d'une voix :
 *   osc A ┐
 *         ├→ mix → filtre passe-bas (+ enveloppe) → VCA (ADSR) → sortie
 *   osc B ┘  (désaccordé)
 *
 * Une voix par note, créée puis détruite : c'est l'approche idiomatique en
 * Web Audio, les oscillateurs y sont conçus pour être jetables.
 */

import { midiToFrequency } from "../timing.js"


const WAVEFORMS = ["sawtooth", "square", "triangle", "sine"]

/**
 * Libellés courts et en bas de casse : le handoff réserve 44px à la colonne
 * des libellés (54px au-delà de 300px de tuile). Tout ce qui dépasse serait
 * tronqué — et un texte coupé est le défaut que la recette n° 2 interdit.
 */
const PARAMETERS                                 = [
  { id: "wave", label: "onde", min: 0, max: 3, default: 0, curve: "choice", choices: WAVEFORMS },
  { id: "detune", label: "detune", min: 0, max: 50, default: 9, unit: "cents", curve: "linear" },
  { id: "cutoff", label: "coupure", min: 60, max: 14000, default: 2200, unit: "Hz", curve: "exponential" },
  { id: "resonance", label: "réso", min: 0.1, max: 20, default: 4, curve: "exponential" },
  { id: "envAmount", label: "env", min: 0, max: 8000, default: 2600, unit: "Hz", curve: "linear" },
  { id: "attack", label: "att", min: 0.001, max: 2, default: 0.005, unit: "s", curve: "exponential" },
  { id: "decay", label: "déclin", min: 0.01, max: 2, default: 0.18, unit: "s", curve: "exponential" },
  { id: "sustain", label: "sustain", min: 0, max: 1, default: 0.45, curve: "linear" },
  { id: "release", label: "release", min: 0.01, max: 3, default: 0.22, unit: "s", curve: "exponential" },
  { id: "gain", label: "vol", min: 0, max: 1, default: 0.55, curve: "linear" },
]

/** Au-delà, on vole la voix la plus ancienne : mieux vaut une note coupée qu'un CPU saturé. */
const MAX_VOICES = 32








export class AnalogSynth                       {
           descriptor
           output
           ready = true

           #context
           #values = new Map                ()
           #voices = new Set       ()

  constructor(context                  , id = "analog", name = "Analog") {
    this.#context = context
    this.descriptor = { id, name, kind: "melodic" }
    this.output = context.createGain()
    for (const parameter of PARAMETERS) this.#values.set(parameter.id, parameter.default)
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

  /** Les changements prennent effet sur les notes suivantes, pas sur les voix en cours. */
  setParameter(id        , value        )       {
    const descriptor = PARAMETERS.find((parameter) => parameter.id === id)
    if (!descriptor) return
    this.#values.set(id, Math.min(descriptor.max, Math.max(descriptor.min, value)))
  }

  noteOn({ note, velocity, time, duration }               )       {
    const context = this.#context
    const start = Math.max(time, context.currentTime)

    const attack = this.getParameter("attack")
    const decay = this.getParameter("decay")
    const sustain = this.getParameter("sustain")
    const release = this.getParameter("release")
    const cutoff = this.getParameter("cutoff")
    const peak = velocity * this.getParameter("gain")
    const waveform = WAVEFORMS[Math.round(this.getParameter("wave"))] ?? "sawtooth"

    if (this.#voices.size >= MAX_VOICES) this.#stealOldestVoice(start)

    const filter = context.createBiquadFilter()
    filter.type = "lowpass"
    filter.Q.value = this.getParameter("resonance")

    const gain = context.createGain()
    gain.gain.value = 0

    const frequency = midiToFrequency(note)
    const detune = this.getParameter("detune")
    const oscillators = [-detune / 2, detune / 2].map((cents) => {
      const oscillator = context.createOscillator()
      oscillator.type = waveform
      oscillator.frequency.value = frequency
      oscillator.detune.value = cents
      oscillator.connect(filter)
      return oscillator
    })

    // Les deux oscillateurs se partagent le niveau : sinon la somme sature.
    const mix = context.createGain()
    mix.gain.value = 1 / oscillators.length
    filter.connect(mix)
    mix.connect(gain)
    gain.connect(this.output)

    // Enveloppe de filtre : ouverture brutale puis fermeture vers la coupure.
    // `setTargetAtTime` est exponentiel, ce qui est le comportement attendu
    // d'un filtre analogique — une rampe linéaire sonnerait raide.
    filter.frequency.setValueAtTime(Math.min(cutoff + this.getParameter("envAmount"), 20000), start)
    filter.frequency.setTargetAtTime(cutoff, start, Math.max(decay, 0.01) / 3)

    const releaseStart = this.#scheduleAmpEnvelope(gain, start, duration, peak, attack, decay, sustain)
    const endsAt = releaseStart + release + 0.02
    // SHOWRUNNER : la chute manquait — le gain tenait le maintien jusqu'à
    // l'arrêt des oscillateurs, qui coupaient net (un clic en fin de note).
    gain.gain.linearRampToValueAtTime(0, releaseStart + release)

    for (const oscillator of oscillators) {
      oscillator.start(start)
      oscillator.stop(endsAt)
    }

    const voice        = { oscillators, gain, filter, endsAt, note }
    this.#voices.add(voice)
    const first = oscillators[0]
    if (first) {
      first.onended = () => {
        this.#voices.delete(voice)
        gain.disconnect()
        filter.disconnect()
        mix.disconnect()
      }
    }
  }

  // SHOWRUNNER : relâcher une note jouée à la main (clavier, MIDI), dont on
  // ne connaissait pas la durée au moment de l'attaque.
  noteOff(note, time = this.#context.currentTime) {
    const release = this.getParameter("release")
    for (const voice of this.#voices) {
      if (voice.note !== note || voice.endsAt <= time) continue
      const g = voice.gain.gain
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(time)
      else g.cancelScheduledValues(time)
      g.setTargetAtTime(0, time, Math.max(0.002, release / 4))
      voice.endsAt = time + release * 1.6 + 0.05
      for (const oscillator of voice.oscillators) {
        try { oscillator.stop(voice.endsAt) } catch { /* déjà arrêté */ }
      }
    }
  }

  allNotesOff(time = this.#context.currentTime)       {
    for (const voice of this.#voices) {
      voice.gain.gain.cancelScheduledValues(time)
      voice.gain.gain.setTargetAtTime(0, time, 0.01)
      for (const oscillator of voice.oscillators) {
        try {
          oscillator.stop(time + 0.06)
        } catch {
          // Déjà arrêté : rien à faire.
        }
      }
    }
  }

  dispose()       {
    this.allNotesOff()
    this.#voices.clear()
    this.output.disconnect()
  }

  /**
   * Programme l'enveloppe d'amplitude en entier, d'un seul tenant.
   *
   * On calcule analytiquement la valeur atteinte au moment du relâchement, au
   * lieu de s'appuyer sur `cancelAndHoldAtTime` — cette méthode n'est pas
   * implémentée partout, et sans elle une note plus courte que l'attaque
   * produirait un clic.
   *
   * @returns l'instant où commence le relâchement.
   */
  #scheduleAmpEnvelope(
    gain          ,
    start        ,
    duration        ,
    peak        ,
    attack        ,
    decay        ,
    sustain        ,
  )         {
    const attackEnd = start + attack
    const decayEnd = attackEnd + decay
    const sustainLevel = peak * sustain
    // Plancher de 10 ms : une note plus courte n'aurait pas le temps d'exister.
    const releaseStart = Math.max(start + duration, start + 0.01)

    gain.gain.setValueAtTime(0, start)

    if (releaseStart <= attackEnd) {
      // Note relâchée pendant l'attaque : on suit la même pente, en s'arrêtant plus tôt.
      gain.gain.linearRampToValueAtTime((peak * (releaseStart - start)) / attack, releaseStart)
    } else {
      gain.gain.linearRampToValueAtTime(peak, attackEnd)
      if (releaseStart <= decayEnd) {
        const progress = (releaseStart - attackEnd) / decay
        gain.gain.linearRampToValueAtTime(peak + (sustainLevel - peak) * progress, releaseStart)
      } else {
        gain.gain.linearRampToValueAtTime(sustainLevel, decayEnd)
        gain.gain.setValueAtTime(sustainLevel, releaseStart)
      }
    }

    return releaseStart
  }

  #stealOldestVoice(now        )       {
    let oldest               = null
    for (const voice of this.#voices) {
      if (!oldest || voice.endsAt < oldest.endsAt) oldest = voice
    }
    if (!oldest) return
    oldest.gain.gain.cancelScheduledValues(now)
    oldest.gain.gain.setTargetAtTime(0, now, 0.005)
    for (const oscillator of oldest.oscillators) {
      try {
        oscillator.stop(now + 0.03)
      } catch {
        // Déjà arrêté.
      }
    }
    this.#voices.delete(oldest)
  }
}
