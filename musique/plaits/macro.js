// ODIO — MACRO : Plaits complet, ses 24 moteurs, dans un AudioWorklet (06/10).
//
// Plaits est le macro-oscillateur d'Émilie Gillet (Mutable Instruments),
// licence MIT (LICENSE-plaits.txt). Le Numérique d'ODIO n'en avait que six
// OSCILLATEURS (odio/instruments/plaits-synth.js) ; Macro joue la VOIX entière
// du module — chaque moteur, sa porte basse, ses enveloppes internes, ses trois
// banques FM-6 au format DX7 —, compilée en WebAssembly par
// tools/plaits_wasm/construire.sh. Étude et mesures : docs/etudes/odio_synthes.md.
//
//   worklet (8 voix plaits::Voice) → enveloppe par voix → UN filtre → VCA → sortie
//
// Le contrat est celui des instruments d'ODIO (odio/types.js) : descripteurs,
// setParameter, noteOn({ note, velocity, time, duration }), noteOff, ping —
// l'adaptateur du studio (moteur.js, odioSource) le joue comme les autres.
//
// Ce que le module fait, et que l'on garde :
//   - la note tenue est son TRIG branché : le front montant déclenche, la porte
//     haute tient (les enveloppes des moteurs FM-6 relâchent quand elle tombe) ;
//   - « Tenu » : son entrée LEVEL branchée (la porte basse suit le niveau, la
//     vélocité) ; « Frappé » : LEVEL débranché, la porte basse « pingée » par le
//     déclenchement — le son percussif du module, réglé par Déclin et Couleur ;
//   - la sortie AUX (un autre son du même moteur), mêlée par « Aux ».
// Ce qui change : Plaits compte en 48 kHz (kSampleRate, plaits/dsp/dsp.h) ; à
// une autre fréquence, la note est corrigée (12 · log2(48000 / fs) demi-tons),
// ses constantes de temps restent celles de 48 kHz (à 44,1 kHz : 8,8 % plus
// lentes). Il rend par blocs de 24 échantillons : le worklet les met en file.

import { clamp } from '../odio/timing.js';

// Les 24 moteurs, dans l'ordre du module (plaits/dsp/voice.cc, Voice::Init).
export const MOTEURS = [
  'VA filtré', 'Distorsion de phase', 'FM-6 · banque 1', 'FM-6 · banque 2', 'FM-6 · banque 3', 'Terrain d\'onde', 'String machine', 'Chiptune',
  'Analogique virtuel', 'Waveshaping', 'FM deux opérateurs', 'Formants granulaires', 'Additif', 'Table d\'ondes', 'Accords', 'Parole',
  'Essaim', 'Bruit filtré', 'Particules', 'Corde', 'Modal', 'Grosse caisse', 'Caisse claire', 'Charley',
];
// les familles, pour le menu du rack
export const FAMILLES = [['Plaits 1.2 · nouveaux moteurs', 0, 8], ['Synthèse', 8, 16], ['Bruits et modèles physiques', 16, 21], ['Percussions', 21, 24]];

// Les noms des 96 patchs des trois banques FM-6, lus dans les données mêmes
// (plaits/resources.cc, syx_bank_0..2 : le format DX7, 128 octets par patch, le
// nom aux octets 118 à 127). Le module choisit le patch par HARMO, quantifié sur
// 32 après × 1,02 (six_op_engine.cc) : `harmoDuPatch` vise le milieu de sa case.
export const PATCHS_FM = [
  ["SOLID BASS", "Mooger Low", "LeaderTape", "MORHOL TB1", "BASS    3", "BILL BASS", "BASS    1", "ELEC BASS", "S.BAS 27.7", "RESONANCES", "SYN-BASS 2", "PRC SYNTH1", "CROMA 2", "ANALOG  4", "ANALOG A", "ANALOG  6", "CS 80", "INSERT 1", "SPIRAL", "DX-TROTT", "GASHAUS", "RING DING", "PAPAGAYO", "WINEGLASS", "AMYTAL", "FAIRLIGHT", "*PPG*Vol.1", "*PPG*Vol.2", "*Fairl. 3", "*Vocoder 2", "*Sequence", "Bounce 4"],
  ["E.PIANO 1", "FENDER 1", "WINTRHODES", "RS-EP C", "*Mark III", "CLAV-E.PNO", "SYN-CLAV", "CLAVINET", "PIANO   5", "GRD PIANO1", "STEINWAY", "GUIT ACOUS", "SITAR", "KOTO", "HARPSICH 1", "CLAV    3", "XYLOPHONE", "MARIMBA", "VIBE    1", "GLOKENSPL", "BELL C", "BELLS", "TUB BELLS", "GONG    2", "KETTLE 6", "MID DRM 3", "ORI DRUM 1", "WOOD 6", "LATN DRM 4", "CIMBAL", "SYNDM 25.8", "B.DRM-SNAR"],
  ["CLICK 124", "*Hammond 1", "E.ORGAN 3", "60-S ORGAN", "OPTIC 28", "PIPES   1", "PIPES   3", "PIPES   2", "JX-33-P", "SOUNDTRACK", "ICE PAD  2", "M1 PADS", "CARLOS   2", "SOFT TOUCH", "*Planets", "CIRRUS", "ENTRIX", "MAL POLY", "Textures 6", "Etherial5a", "'Airy'", "BORON A", "VANGELIS 1", "STRINGS C", "STRINGS 3", "STRINGS 2", "STRINGS 7", "FULL STRIN", "SYN-ORCH", "BRASS   1", "BRASS 6 BC", "BR TRUMPET"],
];
export const harmoDuPatch = (i) => Math.round(((i + 0.5) / 32 / 1.02) * 10000) / 10000;
export const patchDeHarmo = (h) => Math.max(0, Math.min(31, Math.floor(h * 1.02 * 32)));

const PROCESSEUR = 'odio-macro';

const PARAMETERS = [
  { id: 'moteur', label: 'moteur', min: 0, max: 23, default: 8, curve: 'choice', choices: MOTEURS },
  { id: 'harmo', label: 'harmo', min: 0, max: 1, default: 0.5, curve: 'linear' },
  { id: 'timbre', label: 'timbre', min: 0, max: 1, default: 0.5, curve: 'linear' },
  { id: 'morph', label: 'morph', min: 0, max: 1, default: 0.5, curve: 'linear' },
  { id: 'aux', label: 'aux', min: 0, max: 1, default: 0, curve: 'linear' },
  { id: 'jeu', label: 'jeu', min: 0, max: 1, default: 0, curve: 'choice', choices: ['tenu', 'frappé'] },
  { id: 'declin', label: 'déclin', min: 0, max: 1, default: 0.5, curve: 'linear' },
  { id: 'couleur', label: 'couleur', min: 0, max: 1, default: 0.5, curve: 'linear' },
  { id: 'cutoff', label: 'coupure', min: 60, max: 16000, default: 16000, unit: 'Hz', curve: 'exponential' },
  { id: 'resonance', label: 'réso', min: 0.1, max: 20, default: 0.7, curve: 'exponential' },
  { id: 'attack', label: 'att', min: 0.001, max: 2, default: 0.003, unit: 's', curve: 'exponential' },
  { id: 'decay', label: 'déclin env', min: 0.01, max: 3, default: 0.4, unit: 's', curve: 'exponential' },
  { id: 'sustain', label: 'sustain', min: 0, max: 1, default: 1, curve: 'linear' },
  { id: 'release', label: 'release', min: 0.01, max: 4, default: 0.3, unit: 's', curve: 'exponential' },
  { id: 'gain', label: 'vol', min: 0, max: 1, default: 0.4, curve: 'linear' },
  // 09/10 : le mode du filtre et son enveloppe paraphonique, ceux du Numérique
  // (odio/instruments/plaits-synth.js) — la MicroFreak joue sur Macro et son
  // panneau a un sélecteur LP/BP/HP et une enveloppe vers la coupure. Placés
  // après les autres (la tuile du nodal garde ses rails) ; à leurs défauts
  // (passe-bas, enveloppe nulle), Macro sonne comme avant.
  { id: 'fmode', label: 'mode', min: 0, max: 2, default: 0, curve: 'choice', choices: ['lp', 'bp', 'hp'] },
  { id: 'envAmount', label: 'env', min: 0, max: 8000, default: 0, unit: 'Hz', curve: 'linear' },
];
const TYPES_FILTRE = ['lowpass', 'bandpass', 'highpass'];
// ce que le worklet doit savoir ; le filtre et le volume vivent en Web Audio
const AU_WORKLET = new Set(['moteur', 'harmo', 'timbre', 'morph', 'aux', 'jeu', 'declin', 'couleur', 'attack', 'decay', 'sustain', 'release']);

// ── le processeur, en source (une URL data: ; il ne peut rien importer) ──
// À chaque quantum : les notes dont l'heure est venue (au bon échantillon),
// puis chaque voix vivante, échantillon par échantillon : sa file de 24
// remplie par le WASM au besoin, son enveloppe, la somme.
const SOURCE_WORKLET = `
class MacroProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const w = new WebAssembly.Instance(new WebAssembly.Module(options.processorOptions.octets), {}).exports
    w.__wasm_call_ctors()
    w.initialiser()
    this.w = w
    this.B = w.tailleBloc()
    this.sortie = new Float32Array(w.memory.buffer, w.tamponSortie(), this.B)
    this.auxi = new Float32Array(w.memory.buffer, w.tamponAux(), this.B)
    this.decal = 12 * Math.log2(48000 / sampleRate)
    this.r = { moteur: 8, harmo: 0.5, timbre: 0.5, morph: 0.5, aux: 0, jeu: 0, declin: 0.5, couleur: 0.5, attack: 0.003, decay: 0.4, sustain: 1, release: 0.3 }
    this.voix = []
    for (let rang = 0; rang < w.nombreVoix(); rang++) this.voix.push({ rang, etat: 'libre', note: 0, vel: 0, env: 0, fin: 0, age: 0, debut: 0, bas: 0, porte: 0, file: new Float32Array(this.B), lu: this.B })
    this.attente = []
    this.horloge = 0
    this.port.onmessage = (e) => this.recevoir(e.data)
  }
  recevoir(o) {
    if (o.type === 'note') this.attente.push(o)
    else if (o.type === 'reglage') this.r[o.id] = o.valeur
    else if (o.type === 'silence') { for (const v of this.voix) if (v.etat !== 'libre') v.etat = 'release'; this.attente.length = 0 }
    else if (o.type === 'relacher') {
      for (const v of this.voix) if (v.etat !== 'libre' && v.note === o.note) v.fin = Math.min(v.fin, o.time)
      for (const a of this.attente) if (a.note === o.note) a.duration = Math.max(0.01, o.time - a.time)
    } else if (o.type === 'ping') this.port.postMessage({ pong: o.id })
  }
  prendre() {
    let libre = null, ancienne = this.voix[0]
    for (const v of this.voix) { if (v.etat === 'libre') { libre = v; break } if (v.age < ancienne.age) ancienne = v }
    return libre || ancienne
  }
  process(_e, sorties) {
    const s = sorties[0][0]
    if (!s) return true
    const n = s.length, t0 = currentTime, fin = t0 + n / sampleRate
    s.fill(0)
    for (let i = this.attente.length - 1; i >= 0; i--) {
      const o = this.attente[i]
      if (o.time >= fin) continue
      this.attente.splice(i, 1)
      const v = this.prendre()
      if (v.etat === 'libre') v.lu = this.B   // une voix libre repart d'une file vide
      // une voix encore tenue (volée) : sa porte retombe un bloc, pour que le module voie un front
      v.bas = v.porte ? 1 : 0
      v.etat = 'attaque'; v.note = o.note; v.vel = o.velocity; v.age = ++this.horloge
      v.fin = Math.max(o.time + o.duration, o.time + 0.01)
      v.debut = Math.max(0, Math.min(n - 1, Math.round((o.time - t0) * sampleRate)))
    }
    const r = this.r, B = this.B
    const pasA = 1 / Math.max(1, r.attack * sampleRate)
    const chuteD = Math.exp(-1 / Math.max(1, r.decay * sampleRate * 0.35))
    const chuteR = Math.exp(-1 / Math.max(1, r.release * sampleRate * 0.35))
    for (const v of this.voix) {
      if (v.etat === 'libre') continue
      let env = v.env, etat = v.etat
      const plancher = v.vel * r.sustain
      for (let i = v.debut; i < n; i++) {
        const instant = t0 + i / sampleRate
        if (etat !== 'release' && instant >= v.fin) etat = 'release'
        if (v.lu >= B) {
          v.porte = v.bas > 0 ? 0 : etat === 'release' ? 0 : 1
          if (v.bas > 0) v.bas--
          this.w.rendre(v.rang, Math.round(r.moteur), v.note + this.decal, r.harmo, r.timbre, r.morph, v.porte, 0.4 + 0.6 * v.vel, r.declin, r.couleur, r.jeu ? 1 : 0, B)
          const a = r.aux, f = v.file
          for (let k = 0; k < B; k++) f[k] = this.sortie[k] * (1 - a) + this.auxi[k] * a
          v.lu = 0
        }
        if (etat === 'attaque') { env += v.vel * pasA; if (env >= v.vel) { env = v.vel; etat = 'chute' } }
        else if (etat === 'chute') env = plancher + (env - plancher) * chuteD
        else env *= chuteR
        s[i] += v.file[v.lu++] * env
      }
      v.debut = 0; v.env = env; v.etat = etat
      if (etat === 'release' && env < 0.0002) { v.etat = 'libre'; v.porte = 0 }
    }
    return true
  }
}
registerProcessor(${JSON.stringify(PROCESSEUR)}, MacroProcessor)
`;

// le module WebAssembly : lu une fois par page (même origine, aucun CDN)
let octets = null;
const lireOctets = () => (octets ||= fetch(new URL('./plaits.wasm', import.meta.url)).then((r) => {
  if (!r.ok) throw new Error(`plaits.wasm : ${r.status}`);
  return r.arrayBuffer();
}).catch((e) => { octets = null; throw e; }));

// un contexte n'inscrit le processeur qu'une fois (addModule deux fois lève)
const inscriptions = new WeakMap();
function inscrire(ctx) {
  let p = inscriptions.get(ctx);
  if (!p) {
    if (!ctx.audioWorklet) return Promise.reject(new Error('ce contexte n\'a pas d\'AudioWorklet'));
    p = ctx.audioWorklet.addModule(`data:text/javascript,${encodeURIComponent(SOURCE_WORKLET)}`);
    inscriptions.set(ctx, p);
  }
  return p;
}

export class MacroPlaits {
  descriptor;
  output;
  #ctx;
  #values = new Map();
  #filtre;
  #noeud = null;
  #pret = false;

  constructor(ctx, id = 'macro', name = 'MACRO') {
    this.#ctx = ctx;
    this.descriptor = { id, name, kind: 'melodic' };
    this.output = ctx.createGain();
    for (const p of PARAMETERS) this.#values.set(p.id, p.default);
    this.output.gain.value = this.getParameter('gain');
    // le filtre existe avant le worklet : les réglages posés avant load() ne se perdent pas
    this.#filtre = ctx.createBiquadFilter();
    this.#filtre.type = 'lowpass';
    this.#filtre.frequency.value = Math.min(this.getParameter('cutoff'), ctx.sampleRate * 0.45);
    this.#filtre.Q.value = this.getParameter('resonance');
    this.#filtre.connect(this.output);
  }

  get ready() { return this.#pret; }

  async load() {
    if (this.#pret) return;
    const [o] = await Promise.all([lireOctets(), inscrire(this.#ctx)]);
    const noeud = new AudioWorkletNode(this.#ctx, PROCESSEUR, { numberOfInputs: 0, outputChannelCount: [1], processorOptions: { octets: o.slice(0) } });
    noeud.connect(this.#filtre);
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
    const t = this.#ctx.currentTime;
    if (id === 'gain') this.output.gain.setTargetAtTime(v, t, 0.01);
    if (id === 'cutoff') this.#filtre.frequency.setTargetAtTime(Math.min(v, this.#ctx.sampleRate * 0.45), t, 0.02);
    if (id === 'resonance') this.#filtre.Q.setTargetAtTime(v, t, 0.01);
    if (id === 'fmode') this.#filtre.type = TYPES_FILTRE[Math.round(v)] ?? 'lowpass';
    if (AU_WORKLET.has(id)) this.#pousser(id, v);
  }

  noteOn(e) {
    if (!this.#noeud) return;
    const debut = Math.max(e.time, this.#ctx.currentTime);
    this.#noeud.port.postMessage({ type: 'note', note: e.note, velocity: clamp(e.velocity, 0, 1), time: debut, duration: Math.max(e.duration, 0.01) });
    // l'enveloppe de filtre, paraphonique (plaits-synth.js) : une seule, rouverte à
    // chaque note, qui retombe au rythme du déclin ; rien tant que son montant est nul
    const env = this.getParameter('envAmount');
    if (env > 0) {
      const coupure = Math.min(this.getParameter('cutoff'), this.#ctx.sampleRate * 0.45);
      const f = this.#filtre.frequency;
      f.cancelScheduledValues(debut);
      f.setValueAtTime(Math.min(coupure + env * clamp(e.velocity, 0, 1), 18000, this.#ctx.sampleRate * 0.45), debut);
      f.setTargetAtTime(coupure, debut, Math.max(this.getParameter('decay'), 0.01) / 3);
    }
  }

  noteOff(note, time = this.#ctx.currentTime) { this.#noeud?.port.postMessage({ type: 'relacher', note, time }); }

  allNotesOff() { this.#noeud?.port.postMessage({ type: 'silence' }); }

  // l'export hors temps réel attend que les notes postées soient arrivées (MessagePort garde l'ordre)
  ping(ms = 3000) {
    const n = this.#noeud;
    if (!n) return Promise.resolve(false);
    return new Promise((res) => {
      const id = Math.random();
      const t = setTimeout(() => res(false), ms);
      n.port.onmessage = (e) => { if (e.data?.pong === id) { clearTimeout(t); res(true); } };
      n.port.postMessage({ type: 'ping', id });
    });
  }

  dispose() {
    this.allNotesOff();
    this.#noeud?.disconnect();
    this.#noeud = null;
    this.#pret = false;
    this.#filtre.disconnect();
    this.output.disconnect();
  }

  #pousser(id, valeur) { this.#noeud?.port.postMessage({ type: 'reglage', id, valeur: id === 'moteur' ? Math.round(valeur) : valeur }); }
}
