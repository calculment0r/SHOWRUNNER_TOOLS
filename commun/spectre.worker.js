// SHOWRUNNER TOOLS — le calcul du spectre (commun/spectre.js), hors du fil de la page.
//
// Une tuile = `cols` colonnes d'écran × `rows` lignes de fréquence. Pour chaque colonne (les
// échantillons [sa, sb) qu'elle couvre) : la transformée de Fourier à court terme (STFT) de
// fenêtres de Hann (« periodic », Harris 1978, « On the use of windows for harmonic analysis
// with the discrete Fourier transform », Proc. IEEE 66-1), au recouvrement de 75 % (pas = N/4) ;
// une colonne plus large que le pas fait la MOYENNE des puissances de ses fenêtres (Welch 1967 :
// toutes ses fenêtres, aucun échantillon sauté) ; une colonne plus étroite prend la fenêtre
// centrée sur elle. Deux tailles de fenêtre (le « multi-resolution » d'iZotope RX : « better
// frequency resolution at low frequencies and better time resolution at high frequencies ») :
// nHi (courte, suit le zoom) pour les lignes plus larges qu'une case de nHi, nLo (85 ms) pour
// les basses. Chaque ligne couvre une bande de l'échelle mel (O'Shaughnessy : m = 2595 log10(1 +
// f/700)) ou logarithmique, de fmin à fmax : la moyenne des cases de la bande, ou, quand la bande
// est plus fine qu'une case, l'interpolation des deux cases voisines. Le niveau : en dB sous le
// plus fort du son (l'amplitude d'un sinus vaut 4|X|/N avec une fenêtre de Hann, dont la somme
// vaut N/2), `plage` dB ramenés sur 0…255.
//
//   reçoit {cle, pcm (Int16Array), a (le n° du premier échantillon), n, sr, spp, c0, cols, rows,
//           ech ('mel' | 'log'), fmin, fmax, nHi, nLo, peak, plage}
//   rend   {cle, niv (Uint8Array rows × cols, la ligne 0 en haut : les aigus), ms}

const plans = new Map();
function plan(N) {
  let p = plans.get(N);
  if (p) return p;
  const lg = Math.round(Math.log2(N));
  const rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    let r = 0, x = i;
    for (let b = 0; b < lg; b++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  const cos = new Float64Array(N / 2), sin = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / N); sin[i] = -Math.sin((2 * Math.PI * i) / N); }
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  p = { N, rev, cos, sin, win, re: new Float64Array(N), im: new Float64Array(N), P: new Float64Array(N / 2 + 1), acc: new Float64Array(N / 2 + 1) };
  plans.set(N, p);
  return p;
}

// la FFT radix 2, en place (Cooley-Tukey, entrée déjà rangée en ordre inversé des bits)
function fft(p) {
  const { N, re, im, cos, sin } = p;
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let i = 0; i < N; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j, b = a + half;
        const tr = re[b] * cos[k] - im[b] * sin[k];
        const ti = re[b] * sin[k] + im[b] * cos[k];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

// la puissance de la fenêtre centrée sur l'échantillon c (hors du son : zéro), dans p.P
function trame(p, pcm, a, n, c) {
  const { N, rev, win, re, im, P } = p;
  const s0 = c - N / 2;
  for (let i = 0; i < N; i++) {
    const s = s0 + i, idx = s - a;
    const v = s >= 0 && s < n && idx >= 0 && idx < pcm.length ? pcm[idx] : 0;
    re[rev[i]] = v * win[i];
    im[rev[i]] = 0;
  }
  fft(p);
  for (let k = 0; k <= N / 2; k++) P[k] = re[k] * re[k] + im[k] * im[k];
}

const MEL = { u: (f) => 2595 * Math.log10(1 + f / 700), f: (u) => 700 * (Math.pow(10, u / 2595) - 1) };
const LOG = { u: (f) => Math.log10(f), f: (u) => Math.pow(10, u) };

// ce que chaque ligne lit : sa fenêtre (nHi ou nLo) et ses cases [k0, k1], ou la case fractionnaire kf
function lignes(rows, ech, fmin, fmax, sr, nHi, nLo) {
  const E = ech === 'log' ? LOG : MEL;
  const u0 = E.u(fmin), u1 = E.u(fmax);
  const out = [];
  for (let r = 0; r < rows; r++) {
    const hi = E.f(u1 - ((u1 - u0) * r) / rows), lo = E.f(u1 - ((u1 - u0) * (r + 1)) / rows);
    const fc = E.f(u1 - ((u1 - u0) * (r + 0.5)) / rows);
    const N = sr / nHi <= hi - lo ? nHi : nLo;
    const k0 = Math.ceil((lo * N) / sr), k1 = Math.min(N / 2, Math.ceil((hi * N) / sr) - 1);
    out.push(k1 >= k0 ? { N, k0, k1 } : { N, kf: Math.min(N / 2 - 1, (fc * N) / sr) });
  }
  return out;
}

onmessage = (e) => {
  const d = e.data;
  const t = performance.now();
  const { pcm, a, n, sr, spp, c0, cols, rows, nHi, nLo, peak, plage } = d;
  const L = lignes(rows, d.ech, d.fmin, d.fmax, sr, nHi, nLo);
  const tailles = nHi === nLo ? [nHi] : [nHi, nLo];
  const moy = new Map(tailles.map((N) => [N, new Float64Array(N / 2 + 1)]));
  const dernier = new Map(tailles.map((N) => [N, NaN]));
  const niv = new Uint8Array(rows * cols);
  const ref = (16 / 1) / Math.max(1, peak * peak);   // P × 16 / (N² peak²) : N² se divise par taille plus bas
  for (let c = 0; c < cols; c++) {
    const sa = (c0 + c) * spp, sb = sa + spp;
    for (const N of tailles) {
      const p = plan(N), M = moy.get(N), hop = N / 4;
      if (spp > hop) {
        const m = Math.ceil(spp / hop);
        p.acc.fill(0);
        for (let i = 0; i < m; i++) {
          trame(p, pcm, a, n, Math.round(sa + ((i + 0.5) * spp) / m));
          for (let k = 0; k <= N / 2; k++) p.acc[k] += p.P[k];
        }
        for (let k = 0; k <= N / 2; k++) M[k] = p.acc[k] / m;
        dernier.set(N, NaN);
      } else {
        const ctr = Math.round((sa + sb) / 2);
        if (ctr !== dernier.get(N)) {                 // au zoom le plus fort, des colonnes voisines partagent leur centre
          trame(p, pcm, a, n, ctr);
          M.set(p.P);
          dernier.set(N, ctr);
        }
      }
    }
    for (let r = 0; r < rows; r++) {
      const l = L[r], M = moy.get(l.N);
      let v;
      if (l.kf === undefined) {
        v = 0;
        for (let k = l.k0; k <= l.k1; k++) v += M[k];
        v /= l.k1 - l.k0 + 1;
      } else {
        const k = Math.floor(l.kf), f = l.kf - k;
        v = M[k] * (1 - f) + M[k + 1] * f;
      }
      const db = 10 * Math.log10((v * ref) / (l.N * l.N) + 1e-30);
      const x = (db + plage) / plage;
      niv[r * cols + c] = x <= 0 ? 0 : x >= 1 ? 255 : Math.round(x * 255);
    }
  }
  postMessage({ cle: d.cle, niv, ms: performance.now() - t }, [niv.buffer]);
};
