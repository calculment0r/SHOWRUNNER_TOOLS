// ODIO — RÉSONATEUR : Rings, le résonateur modal et à cordes, dans un
// AudioWorklet (09/10).
//
// Rings est le résonateur d'Émilie Gillet (Mutable Instruments), licence MIT
// (LICENSE-mutable.txt), compilé en WebAssembly par tools/mutable_wasm/
// construire.sh — la même méthode que Plaits (plaits/macro.js). Étude et
// mesures : docs/etudes/odio_synthes.md § 7.
//
//   worklet (4 rings::Part, ou son synthé de cordes) → file rééchantillonnée → VCA → sortie stéréo
//
// Le contrat est celui des instruments d'ODIO (odio/types.js) : descripteurs,
// setParameter, noteOn({ note, velocity, time, duration }), noteOff, ping —
// l'adaptateur du studio (moteur.js, odioSource) le joue comme les autres.
//
// Ce que le module fait, et que l'on garde :
//   - rien n'est branché dans IN : chaque note FRAPPE l'excitateur interne (le
//     STRUM du module) et la résonance s'éteint d'elle-même, selon AMORTI. La
//     durée de la note ne compte pas : le module n'a pas de porte ;
//   - ses six modèles (modal, cordes sympathiques, corde inharmonique, voix FM,
//     cordes sympathiques en accords, corde et réverbe) et son synthé de cordes
//     caché (« l'œuf de Pâques » : six effets) ;
//   - ses deux sorties ODD et EVEN : les deux jeux d'harmoniques d'une voix, à
//     gauche et à droite ; LARGEUR les resserre vers le centre ;
//   - la polyphonie à tour de rôle (1 à 4), les accords de Bryan Noll, les
//     potentiomètres lissés comme le module les lit (cv_scaler.cc : 1 % par bloc).
// Ce qui change : quatre Part entiers à la polyphonie 1 plutôt qu'un Part
// polyphonique (tools/mutable_wasm/sr_rings.cc dit pourquoi : les nombres
// dénormaux) ; la vélocité règle le niveau de la voix frappée (le module n'a
// pas d'entrée de vélocité : on frappe plus ou moins fort) ; une voix qui ne
// s'entend plus (−100 dBFS une demi-seconde) cesse d'être calculée.

import { clamp } from '../odio/timing.js';
import { SOURCE_FILE, lireWasm, inscrire, pinger } from './worklet.js';

export const MODELES = ['Modal', 'Cordes sympathiques', 'Corde', 'Voix FM', 'Sympathiques · accords', 'Corde et réverbe',
  'Synthé · formant', 'Synthé · chorus', 'Synthé · réverbe', 'Synthé · formant 2', 'Synthé · ensemble', 'Synthé · réverbe 2'];
// les accords de Bryan Noll (rings/dsp/part.cc, BRYAN_CHORDS), dans l'ordre du module
export const ACCORDS = ['Octave', 'Quinte', 'Sus4', 'Mineur', 'm7', 'm9', 'm11', '6/9', 'Maj9', 'Maj7', 'Majeur'];

const PROCESSEUR = 'odio-resonateur';
const PARAMETERS = [
  { id: 'modele', label: 'modèle', min: 0, max: MODELES.length - 1, default: 0, curve: 'choice', choices: MODELES },
  // une, deux ou quatre notes, comme le module (son manuel : « monophonic, duophonic and quadriphonic »)
  { id: 'poly', label: 'polyphonie', min: 0, max: 2, default: 2, curve: 'choice', choices: ['1', '2', '4'] },
  { id: 'accord', label: 'accord', min: 0, max: ACCORDS.length - 1, default: 3, curve: 'choice', choices: ACCORDS },
  { id: 'structure', label: 'structure', min: 0, max: 1, default: 0.25, curve: 'linear' },
  { id: 'brillance', label: 'brillance', min: 0, max: 1, default: 0.6, curve: 'linear' },
  { id: 'amorti', label: 'amorti', min: 0, max: 1, default: 0.6, curve: 'linear' },
  { id: 'position', label: 'position', min: 0, max: 1, default: 0.35, curve: 'linear' },
  { id: 'largeur', label: 'largeur', min: 0, max: 1, default: 0.7, curve: 'linear' },
  { id: 'gain', label: 'vol', min: 0, max: 1, default: 0.5, curve: 'linear' },
];
// ce que le worklet doit savoir ; le volume vit en Web Audio
const AU_WORKLET = new Set(['modele', 'poly', 'accord', 'structure', 'brillance', 'amorti', 'position', 'largeur']);

// ── le processeur, en source (une URL data: ; il ne peut rien importer) ──
// À chaque quantum : les blocs de 24 du module qu'il faut pour remplir la file,
// chacun avec les notes dont l'heure est venue, puis la lecture de la file.
const SOURCE_WORKLET = `${SOURCE_FILE}
class ResonateurProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const w = new WebAssembly.Instance(new WebAssembly.Module(options.processorOptions.octets), {}).exports
    w.__wasm_call_ctors()
    w.initialiser()
    this.w = w
    this.B = w.tailleBloc()
    this.fsIn = 48000
    this.sortie = new Float32Array(w.memory.buffer, w.tamponSortie(), this.B)
    this.auxi = new Float32Array(w.memory.buffer, w.tamponAux(), this.B)
    this.g = new Float32Array(this.B); this.d = new Float32Array(this.B)
    this.file = new FileStereo(this.fsIn, sampleRate)
    // la cible et la valeur lue (les potentiomètres du module : 1 % par bloc)
    this.r = { modele: 0, poly: 2, accord: 3, structure: 0.25, brillance: 0.6, amorti: 0.6, position: 0.35, largeur: 0.7 }
    this.lu = { ...this.r }
    this.voix = []
    for (let rang = 0; rang < w.nombreVoix(); rang++) this.voix.push({ rang, libre: true, note: 60, gain: 0, cible: 0, calme: 0, frappe: false })
    this.synthe = { libre: true, note: 60, calme: 0, frappe: false }
    this.prochaine = 0
    this.attente = []
    this.commence = false
    this.port.onmessage = (e) => this.recevoir(e.data)
  }
  recevoir(o) {
    if (o.type === 'note') this.attente.push(o)
    else if (o.type === 'reglage') { this.r[o.id] = o.valeur; if (!this.commence) this.lu[o.id] = o.valeur }
    else if (o.type === 'silence') this.attente.length = 0
    else if (o.type === 'ping') this.port.postMessage({ pong: o.id })
  }
  // une note frappée : la voix suivante, à tour de rôle (part.cc), ou le synthé
  frapper(o) {
    if (Math.round(this.lu.modele) >= 6) { const s = this.synthe; s.note = o.note; s.frappe = true; s.libre = false; s.calme = 0; return }
    const p = [1, 2, 4][Math.round(this.r.poly)] || 1
    const v = this.voix[this.prochaine % p]
    this.prochaine = (this.prochaine + 1) % p
    v.note = o.note; v.cible = o.velocity; v.frappe = true; v.libre = false; v.calme = 0
  }
  bloc(t) {
    const B = this.B, fin = t + B / this.fsIn
    // les notes de ce bloc (leur ordre d'arrivée garde l'ordre des frappes)
    this.attente.sort((a, b) => a.time - b.time)
    while (this.attente.length && this.attente[0].time < fin) this.frapper(this.attente.shift())
    for (const k of ['structure', 'brillance', 'amorti', 'position', 'largeur']) this.lu[k] += 0.01 * (this.r[k] - this.lu[k])
    for (const k of ['modele', 'poly', 'accord']) this.lu[k] = this.r[k]
    const L = this.lu, m = Math.round(L.modele), g = this.g, d = this.d
    g.fill(0); d.fill(0)
    const seuil = 1e-5, calmeMax = Math.round(0.5 * this.fsIn / B)
    const mel = (gain0, gain1, w) => {
      // ODD à gauche, EVEN à droite ; la largeur les ramène au centre
      const a = 0.5 + 0.5 * w, b = 0.5 - 0.5 * w
      let pic = 0
      for (let i = 0; i < B; i++) {
        const k = gain0 + (gain1 - gain0) * (i + 1) / B
        const o = this.sortie[i], x = this.auxi[i]
        pic = Math.max(pic, Math.abs(o), Math.abs(x))
        g[i] += k * (a * o + b * x); d[i] += k * (b * o + a * x)
      }
      return pic
    }
    if (m >= 6) {
      const s = this.synthe
      if (!s.libre) {
        this.w.rendreSynthe([1, 2, 4][Math.round(L.poly)] || 1, m - 6, s.note + 0, Math.round(L.accord), L.structure, L.brillance, L.amorti, L.position, s.frappe ? 1 : 0, B)
        s.frappe = false
        const pic = mel(1, 1, L.largeur)
        s.calme = pic < seuil ? s.calme + 1 : 0
        if (s.calme > calmeMax) s.libre = true
      }
    } else {
      for (const v of this.voix) {
        if (v.libre) continue
        const g0 = v.gain
        if (v.frappe) v.gain = v.cible
        this.w.rendre(v.rang, m, v.note, Math.round(L.accord), L.structure, L.brillance, L.amorti, L.position, v.frappe ? 1 : 0, B)
        v.frappe = false
        const pic = mel(g0, v.gain, L.largeur)
        v.calme = pic < seuil ? v.calme + 1 : 0
        if (v.calme > calmeMax) v.libre = true
      }
    }
    this.file.pousser(g, d, B)
  }
  process(_e, sorties) {
    const o = sorties[0], sL = o[0], sR = o[1] || o[0]
    if (!sL) return true
    this.commence = true
    const n = sL.length
    while (this.file.manque(n) > 0) this.bloc(this.file.instantEcriture(currentTime, this.fsIn))
    this.file.lire(sL, sR, n)
    return true
  }
}
registerProcessor(${JSON.stringify(PROCESSEUR)}, ResonateurProcessor)
`;

const WASM = new URL('./rings.wasm', import.meta.url);

export class Resonateur {
  descriptor;
  output;
  #ctx;
  #values = new Map();
  #noeud = null;
  #pret = false;

  constructor(ctx, id = 'resonateur', name = 'RÉSONATEUR') {
    this.#ctx = ctx;
    this.descriptor = { id, name, kind: 'melodic' };
    this.output = ctx.createGain();
    for (const p of PARAMETERS) this.#values.set(p.id, p.default);
    this.output.gain.value = this.getParameter('gain');
  }

  get ready() { return this.#pret; }

  async load() {
    if (this.#pret) return;
    const [o] = await Promise.all([lireWasm(WASM), inscrire(this.#ctx, PROCESSEUR, SOURCE_WORKLET)]);
    const noeud = new AudioWorkletNode(this.#ctx, PROCESSEUR, { numberOfInputs: 0, outputChannelCount: [2], processorOptions: { octets: o.slice(0) } });
    noeud.connect(this.output);
    this.#noeud = noeud;
    this.#pret = true;
    for (const id of AU_WORKLET) this.#pousser(id, this.getParameter(id));
  }

  getParameters() { return PARAMETERS; }
  getParameter(id) { return this.#values.get(id) ?? 0; }

  setParameter(id, value) {
    const d = PARAMETERS.find((p) => p.id === id);
    if (!d) return;
    const v = clamp(value, d.min, d.max);
    this.#values.set(id, v);
    if (id === 'gain') this.output.gain.setTargetAtTime(v, this.#ctx.currentTime, 0.01);
    if (AU_WORKLET.has(id)) this.#pousser(id, v);
  }

  noteOn(e) {
    if (!this.#noeud) return;
    this.#noeud.port.postMessage({ type: 'note', note: e.note, velocity: clamp(e.velocity, 0, 1), time: Math.max(e.time, this.#ctx.currentTime) });
  }

  // le module n'a pas de porte : relâcher ne fait rien, la résonance s'éteint d'elle-même
  noteOff() {}

  allNotesOff() { this.#noeud?.port.postMessage({ type: 'silence' }); }

  ping(ms = 3000) { return pinger(this.#noeud, ms); }

  dispose() {
    this.allNotesOff();
    this.#noeud?.disconnect();
    this.#noeud = null;
    this.#pret = false;
    this.output.disconnect();
  }

  #pousser(id, valeur) { this.#noeud?.port.postMessage({ type: 'reglage', id, valeur }); }
}
