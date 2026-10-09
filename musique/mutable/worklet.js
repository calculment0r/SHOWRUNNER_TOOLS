// ODIO — ce que le Résonateur (Rings) et Physique (Elements) partagent : la
// lecture de leur WebAssembly, l'inscription de leur processeur, et la file
// rééchantillonnée de leur worklet (09/10, docs/etudes/odio_synthes.md § 7).
//
// Les modules comptent à LEUR fréquence (Rings 48 kHz, Elements 32 kHz :
// kSampleRate de leurs dsp.h) et rendent par petits blocs (24, 16). Macro
// (plaits/macro.js) corrige la note quand le contexte n'est pas à 48 kHz et
// laisse ses constantes de temps glisser (8,8 % à 44,1 kHz) ; ici on
// rééchantillonne : la hauteur ET les temps sont ceux du module, à toute
// fréquence du contexte. À fréquence égale, la file est une simple copie.
//
// Le filtre : un sinus cardinal fenêtré (Blackman), 16 points, 64 phases
// interpolées, coupé à 90 % du plus petit des deux Nyquist (un module à 32 kHz
// rend jusqu'à 14,4 kHz, comme le sien s'arrêtait à 16 kHz) ; chaque phase est
// normalisée à un gain continu de 1. Noyau symétrique : aucun retard de phase
// — l'échantillon k du module sonne à l'instant où la tête de lecture passe k.

// Le source de la file, inséré tel quel dans celui de chaque processeur (une
// URL data: ne peut rien importer).
export const SOURCE_FILE = `
class FileStereo {
  constructor(fsIn, fsOut) {
    this.N = 8192; this.L = new Float32Array(this.N); this.R = new Float32Array(this.N)
    this.ecrit = 0; this.lu = 0; this.pas = fsIn / fsOut; this.direct = Math.abs(this.pas - 1) < 1e-9
    const H = 8, P = 64, fc = 0.9 * Math.min(1, fsOut / fsIn)
    this.H = H; this.P = P; this.table = new Float32Array((P + 1) * 2 * H)
    for (let ph = 0; ph <= P; ph++) {
      const f = ph / P; let somme = 0
      for (let m = -H + 1; m <= H; m++) {
        const x = f - m, a = Math.PI * fc * x
        const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(a) / a
        const u = (x + H) / (2 * H)
        const w = u <= 0 || u >= 1 ? 0 : 0.42 - 0.5 * Math.cos(2 * Math.PI * u) + 0.08 * Math.cos(4 * Math.PI * u)
        const h = fc * sinc * w
        this.table[ph * 2 * H + m + H - 1] = h; somme += h
      }
      for (let j = 0; j < 2 * H; j++) this.table[ph * 2 * H + j] /= somme
    }
    // la place du module sous la tête : un indice fractionnaire ; l'avance
    // demandée avant de lire (le noyau voit H échantillons en avant)
    this.pos = this.direct ? 0 : H
    this.ecrit = this.direct ? 0 : H
  }
  // combien d'échantillons du module manquent pour sortir n échantillons
  manque(n) {
    const fin = this.direct ? this.lu + n : Math.floor(this.pos + (n - 1) * this.pas) + this.H + 1
    return Math.max(0, fin - this.ecrit)
  }
  // l'instant (horloge du contexte) de l'échantillon du module à venir, vu de la tête
  instantEcriture(t0, fsIn) { return t0 + ((this.ecrit - (this.direct ? this.lu : this.pos)) / fsIn) }
  pousser(g, d, n) {
    const N = this.N
    for (let i = 0; i < n; i++) { const k = (this.ecrit + i) % N; this.L[k] = g[i]; this.R[k] = d[i] }
    this.ecrit += n
  }
  lire(oL, oR, n) {
    const N = this.N
    if (this.direct) {
      for (let i = 0; i < n; i++) { const k = (this.lu + i) % N; oL[i] = this.L[k]; oR[i] = this.R[k] }
      this.lu += n
      return
    }
    const H = this.H, P = this.P, T = this.table, H2 = 2 * H
    for (let i = 0; i < n; i++) {
      const base = Math.floor(this.pos), f = (this.pos - base) * P, ph = Math.floor(f), b = f - ph
      const r0 = ph * H2, r1 = r0 + H2
      let sl = 0, sr = 0
      for (let j = 0; j < H2; j++) {
        const h = T[r0 + j] + (T[r1 + j] - T[r0 + j]) * b
        const k = (base - H + 1 + j + N) % N
        sl += this.L[k] * h; sr += this.R[k] * h
      }
      oL[i] = sl; oR[i] = sr
      this.pos += this.pas
    }
    // garder les indices petits (la file tourne sur N)
    if (this.pos > 4 * N) { const d = Math.floor(this.pos / N - 2) * N; this.pos -= d; this.ecrit -= d }
  }
}
`;

// le module WebAssembly : lu une fois par page et par fichier (même origine, aucun CDN)
const octets = new Map();
export function lireWasm(url) {
  const cle = String(url);
  if (!octets.has(cle)) {
    octets.set(cle, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${cle.split('/').pop()} : ${r.status}`);
      return r.arrayBuffer();
    }).catch((e) => { octets.delete(cle); throw e; }));
  }
  return octets.get(cle);
}

// un contexte n'inscrit un processeur qu'une fois (addModule deux fois lève)
const inscriptions = new WeakMap();
export function inscrire(ctx, nom, source) {
  let par = inscriptions.get(ctx);
  if (!par) { par = new Map(); inscriptions.set(ctx, par); }
  let p = par.get(nom);
  if (!p) {
    if (!ctx.audioWorklet) return Promise.reject(new Error('ce contexte n\'a pas d\'AudioWorklet'));
    p = ctx.audioWorklet.addModule(`data:text/javascript,${encodeURIComponent(source)}`);
    par.set(nom, p);
  }
  return p;
}

// l'attente de l'export : les notes postées au worklet sont arrivées (MessagePort garde l'ordre)
export function pinger(noeud, ms = 3000) {
  if (!noeud) return Promise.resolve(false);
  return new Promise((res) => {
    const id = Math.random();
    const t = setTimeout(() => res(false), ms);
    noeud.port.onmessage = (e) => { if (e.data?.pong === id) { clearTimeout(t); res(true); } };
    noeud.port.postMessage({ type: 'ping', id });
  });
}
