// ODIO — PHYSIQUE : Elements, la voix de modélisation physique, dans un
// AudioWorklet (09/10).
//
// Elements est la « voix modale » d'Émilie Gillet (Mutable Instruments),
// licence MIT (LICENSE-mutable.txt), compilée en WebAssembly par
// tools/mutable_wasm/construire.sh — la même méthode que Plaits. Étude et
// mesures : docs/etudes/odio_synthes.md § 7.
//
//   worklet (4 elements::Part, une note chacun) → file rééchantillonnée (32 kHz → contexte) → VCA → sortie stéréo
//
// Le module, tel qu'il est :
//   - trois excitateurs mêlés — l'ARCHET (frottement), le SOUFFLE (bruit
//     granulaire, son FLUX) et la FRAPPE (maillets, plectres, particules, son
//     MAILLET) —, chacun son grain (TIMBRE) ; leur enveloppe, CONTOUR, suit la
//     porte : la note tenue frotte et souffle tant qu'elle dure ;
//   - un résonateur : modal (64 modes), corde ou cordes (ses modèles de la
//     version 1.1) ; GÉOMÉTRIE, BRILLANCE, AMORTI, POSITION ;
//   - ESPACE : la largeur stéréo, puis sa réverbe ;
//   - la voix cachée du module (OminousVoice, « l'œuf de Pâques ») ;
//   - la vélocité est son entrée STRENGTH ; les potentiomètres lissés comme le
//     module les lit (cv_scaler.cc : 1 % par bloc).
// Ce qui change : le module est monophonique ; on en tient quatre, une note
// chacun (la plus ancienne cède sa place) ; il compte en 32 kHz et le worklet
// rééchantillonne (worklet.js) ; une voix dont la porte est tombée et qui ne
// s'entend plus (−100 dBFS une demi-seconde, réverbe comprise) cesse d'être
// calculée.

import { clamp } from '../odio/timing.js';
import { SOURCE_FILE, lireWasm, inscrire, pinger } from './worklet.js';

export const RESONATEURS = ['Modal', 'Corde', 'Cordes', 'Voix cachée'];

const PROCESSEUR = 'odio-physique';
// l'ordre de elements::Patch (patch.h) : les réglages qu'on expose y écrivent
// leur place ; les autres gardent la valeur de Part::Init (signature,
// modulation du résonateur, diffusion et filtre de la réverbe)
const PLACE = { contour: 0, archet: 1, archet_t: 2, souffle: 3, flux: 4, souffle_t: 5, frappe: 6, maillet: 7, frappe_t: 8,
  geometrie: 10, brillance: 11, amorti: 12, position: 13, espace: 18 };
const PARAMETERS = [
  { id: 'resonateur', label: 'résonateur', min: 0, max: RESONATEURS.length - 1, default: 0, curve: 'choice', choices: RESONATEURS },
  // les excitateurs (Part::Init : la frappe seule, à 0,8)
  { id: 'contour', label: 'contour', min: 0, max: 1, default: 1, curve: 'linear' },
  { id: 'archet', label: 'archet', min: 0, max: 1, default: 0, curve: 'linear' },
  { id: 'archet_t', label: 'grain archet', min: 0, max: 1, default: 0.5, curve: 'linear' },
  { id: 'souffle', label: 'souffle', min: 0, max: 1, default: 0, curve: 'linear' },
  { id: 'flux', label: 'flux', min: 0, max: 1, default: 0.5, curve: 'linear' },
  { id: 'souffle_t', label: 'grain souffle', min: 0, max: 1, default: 0.5, curve: 'linear' },
  { id: 'frappe', label: 'frappe', min: 0, max: 1, default: 0.8, curve: 'linear' },
  { id: 'maillet', label: 'maillet', min: 0, max: 1, default: 0.5, curve: 'linear' },
  { id: 'frappe_t', label: 'grain frappe', min: 0, max: 1, default: 0.5, curve: 'linear' },
  // le résonateur
  { id: 'geometrie', label: 'géométrie', min: 0, max: 1, default: 0.2, curve: 'linear' },
  { id: 'brillance', label: 'brillance', min: 0, max: 1, default: 0.5, curve: 'linear' },
  { id: 'amorti', label: 'amorti', min: 0, max: 1, default: 0.25, curve: 'linear' },
  { id: 'position', label: 'position', min: 0, max: 1, default: 0.3, curve: 'linear' },
  { id: 'espace', label: 'espace', min: 0, max: 1, default: 0.5, curve: 'linear' },
  { id: 'gain', label: 'vol', min: 0, max: 1, default: 0.5, curve: 'linear' },
];
const AU_WORKLET = new Set(['resonateur', ...Object.keys(PLACE)]);

const SOURCE_WORKLET = `${SOURCE_FILE}
class PhysiqueProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const w = new WebAssembly.Instance(new WebAssembly.Module(options.processorOptions.octets), {}).exports
    w.__wasm_call_ctors()
    w.initialiser()
    this.w = w
    this.B = w.tailleBloc()
    this.fsIn = w.frequence()
    this.sortie = new Float32Array(w.memory.buffer, w.tamponSortie(), this.B)
    this.auxi = new Float32Array(w.memory.buffer, w.tamponAux(), this.B)
    this.patch = new Float32Array(w.memory.buffer, w.tamponPatch(), 19)
    this.place = ${JSON.stringify(PLACE)}
    this.cible = Float32Array.from(this.patch)
    this.g = new Float32Array(this.B); this.d = new Float32Array(this.B)
    this.file = new FileStereo(this.fsIn, sampleRate)
    this.resonateur = 0
    this.voix = []
    for (let rang = 0; rang < w.nombreVoix(); rang++) this.voix.push({ rang, libre: true, note: 60, force: 0.8, fin: 0, age: 0, calme: 0 })
    this.horloge = 0
    this.attente = []
    this.dates = []   // les réglages datés (un attracteur, une automation) : posés au bloc de leur heure
    this.commence = false
    this.port.onmessage = (e) => this.recevoir(e.data)
  }
  recevoir(o) {
    if (o.type === 'note') this.attente.push(o)
    else if (o.type === 'reglage' && o.time > currentTime && this.commence) { this.dates.push(o); this.dates.sort((a, b) => a.time - b.time) }
    else if (o.type === 'reglage') this.regler(o)
    else if (o.type === 'silence') { for (const v of this.voix) v.fin = Math.min(v.fin, currentTime); this.attente.length = 0 }
    else if (o.type === 'relacher') {
      for (const v of this.voix) if (!v.libre && v.note === o.note) v.fin = Math.min(v.fin, o.time)
      for (const a of this.attente) if (a.note === o.note) a.duration = Math.max(0.01, o.time - a.time)
    } else if (o.type === 'ping') this.port.postMessage({ pong: o.id })
  }
  regler(o) {
    if (o.id === 'resonateur') this.resonateur = Math.round(o.valeur)
    else if (o.id in this.place) { this.cible[this.place[o.id]] = o.valeur; if (!this.commence) this.patch[this.place[o.id]] = o.valeur }
  }
  prendre() {
    let ancienne = this.voix[0]
    for (const v of this.voix) { if (v.libre) return v; if (v.age < ancienne.age) ancienne = v }
    return ancienne
  }
  bloc(t) {
    const B = this.B, fin = t + B / this.fsIn
    while (this.dates.length && this.dates[0].time < fin) this.regler(this.dates.shift())
    this.attente.sort((a, b) => a.time - b.time)
    while (this.attente.length && this.attente[0].time < fin) {
      const o = this.attente.shift(), v = this.prendre()
      // une voix volée garde sa porte haute : le module ne verrait pas de front ; elle retombe un bloc
      v.bas = !v.libre && v.fin > t ? 1 : 0
      v.libre = false; v.note = o.note; v.force = o.velocity; v.age = ++this.horloge; v.calme = 0
      v.fin = Math.max(o.time + o.duration, o.time + 0.01)
    }
    for (let i = 0; i < 19; i++) this.patch[i] += 0.01 * (this.cible[i] - this.patch[i])
    const g = this.g, d = this.d, seuil = 1e-5, calmeMax = Math.round(0.5 * this.fsIn / B)
    g.fill(0); d.fill(0)
    const res = this.resonateur, oeuf = res >= 3 ? 1 : 0
    for (const v of this.voix) {
      if (v.libre) continue
      const porte = v.bas ? 0 : t < v.fin ? 1 : 0
      if (v.bas) v.bas--
      this.w.rendre(v.rang, v.note, porte, v.force, oeuf ? 0 : res, oeuf, B)
      // la sortie du module : OUT est à droite, AUX à gauche (elements.cc)
      let pic = 0
      for (let i = 0; i < B; i++) { const r = this.sortie[i], l = this.auxi[i]; g[i] += l; d[i] += r; pic = Math.max(pic, Math.abs(l), Math.abs(r)) }
      v.calme = !porte && pic < seuil ? v.calme + 1 : 0
      if (v.calme > calmeMax) v.libre = true
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
registerProcessor(${JSON.stringify(PROCESSEUR)}, PhysiqueProcessor)
`;

const WASM = new URL('./elements.wasm', import.meta.url);

export class Physique {
  descriptor;
  output;
  #ctx;
  #values = new Map();
  #noeud = null;
  #pret = false;

  constructor(ctx, id = 'physique', name = 'PHYSIQUE') {
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

  // `time` (facultatif) : l'instant de l'horloge où le réglage prend effet (le contrat de Macro)
  setParameter(id, value, time) {
    const d = PARAMETERS.find((p) => p.id === id);
    if (!d) return;
    const v = clamp(value, d.min, d.max);
    this.#values.set(id, v);
    if (id === 'gain') this.output.gain.setTargetAtTime(v, Math.max(time ?? 0, this.#ctx.currentTime), 0.01);
    if (AU_WORKLET.has(id)) this.#pousser(id, v, time);
  }

  noteOn(e) {
    if (!this.#noeud) return;
    this.#noeud.port.postMessage({ type: 'note', note: e.note, velocity: clamp(e.velocity, 0, 1), time: Math.max(e.time, this.#ctx.currentTime), duration: Math.max(e.duration, 0.01) });
  }

  noteOff(note, time = this.#ctx.currentTime) { this.#noeud?.port.postMessage({ type: 'relacher', note, time }); }

  allNotesOff() { this.#noeud?.port.postMessage({ type: 'silence' }); }

  ping(ms = 3000) { return pinger(this.#noeud, ms); }

  dispose() {
    this.allNotesOff();
    this.#noeud?.disconnect();
    this.#noeud = null;
    this.#pret = false;
    this.output.disconnect();
  }

  #pousser(id, valeur, time) { this.#noeud?.port.postMessage({ type: 'reglage', id, valeur, time }); }
}
