// ODIO — le tempo d'un son : battements par minute, première pulsation,
// premier temps fort. Demandé par Cal le 05/10 : « ça serait top d'avoir le
// BPM detector dans audio sur une piste audio qu'on a importée ».
//
// Module pur : ni DOM ni importation. La page l'appelle (bpm.js) sur le son
// que le moteur a déjà décodé ; node l'essaie sur des clics de synthèse
// (server/tools/music_tempo.py, son selftest). Pourquoi dans la page et pas
// sur le serveur : le son y est déjà décodé (moteur.js, Engine.buffer), la
// FFT des tableaux typés y prend une fraction de seconde pour une chanson,
// le résultat agit sur le projet qui vit dans la page, et rien ne passe par
// la file ni par le GPU. Le serveur n'a que la bibliothèque standard :
// aucune FFT, et ffmpeg décode mais n'analyse pas.
//
// La méthode, étape par étape, avec sa source :
//
//  1. Fonction d'attaque : flux spectral, demi-onde, sur un spectre
//     compressé log(1 + 1000·|X|/N), de 30 Hz à 5 kHz, fenêtre de Hann de
//     46 ms, pas de 5,8 ms (172 images/s). La compression et sa constante
//     sont celles de Percival & Tzanetakis 2014 (« Streamlined tempo
//     estimation based on autocorrelation and cross-correlation with
//     pulses », IEEE/ACM TASLP 22(12) ; Essentia, PercivalBpmEstimator :
//     log(1 + 1000·|X|/N), Flux halfRectify) ; le flux demi-onde est celui
//     d'Ellis 2007 (« Beat Tracking by Dynamic Programming », J. New Music
//     Research 36(1), § 3.1) et de librosa.onset.onset_strength.
//  2. Tempo global : autocorrélation de cette fonction (moyenne locale de
//     2 s retirée), pondérée par une loi log-normale centrée sur 120 BPM,
//     d'une octave d'écart-type (librosa.feature.tempo : start_bpm=120,
//     std_bpm=1.0 ; c'est la « tempo period strength » TPS d'Ellis 2007).
//  3. Les erreurs d'octave (60/120, 87/174) : on ne garde pas le pic de TPS
//     seul, on lui ajoute ses multiples, comme les TPS2 (binaire) et TPS3
//     (ternaire) d'Ellis 2007 : TPS2(τ) = TPS(τ) + ½·TPS(2τ) + ¼·TPS(2τ−1) +
//     ¼·TPS(2τ+1), TPS3(τ) = TPS(τ) + ⅓·[TPS(3τ−1) + TPS(3τ) + TPS(3τ+1)] ;
//     le plus fort des deux donne la période (et dit binaire ou ternaire).
//     Même idée que l'« enhance harmonics » de Percival & Tzanetakis
//     (A(τ) + A(2τ) + A(4τ)) : un niveau métrique qui est vraiment la
//     pulsation a ses multiples derrière lui. Ces deux formules d'Ellis sont
//     citées de mémoire (le PDF n'est pas joignable d'ici) ; les essais, eux,
//     sont rejoués à chaque contrôle (server/tools/music_tempo.py).
//     Puis l'autre sens (notre règle) : si, sur les temps suivis, un temps
//     sur deux pèse moins de la moitié de l'autre, la grille alterne fort /
//     faible — c'est la définition d'un niveau métrique au-dessus d'elle
//     (Lerdahl & Jackendoff 1983, GTTM) : la croche avait été prise pour le
//     temps, le tempo est divisé par deux. Sans elle, 90 BPM en croches
//     droites sortait à 180, 60 à 120 ; avec elle, les essais tiennent, et la
//     page dit « ×2 tout aussi plausible » quand le rapport reste proche.
//  4. Les temps : la programmation dynamique d'Ellis 2007 (§ 3.3), écrite
//     comme librosa.beat.beat_track la code (beat.py : tightness 100, score
//     local = fonction d'attaque / écart-type lissée par exp(−½(32k/P)²),
//     prédécesseurs cherchés de P/2 à 2P avec la pénalité −100·(log(Δ/P))²,
//     premier temps au-dessus de 1 % du score local maximum, dernier temps :
//     maximum local du score cumulé au-dessus de la moitié de leur médiane,
//     temps des deux bouts retirés sous ½ RMS du score aux temps lissé par
//     np.hanning(5)). Un écart, le nôtre : au tout début du son, un temps
//     peut ouvrir la suite sans pénalité (sinon un premier temps tombé juste
//     après P/2 perd contre un faux temps sans prédécesseur).
//  5. Calage fin et tempo précis : chaque temps est recalé (± 35 ms) sur la
//     montée d'énergie la plus forte (RMS de 4 ms, pas de 1 ms) — la
//     fonction d'attaque, à 46 ms de fenêtre, voit une attaque avant
//     qu'elle n'arrive ; puis une droite des moindres carrés (temps ↔ rang)
//     donne la période et la première pulsation (la grille prolongée jusqu'à
//     la première attaque du son). L'erreur type de la pente donne
//     l'intervalle du tempo : un entier qui y tombe est proposé tel quel (un
//     tempo de séquenceur), sinon le centième.
//  6. Le temps fort (la phase de la mesure) : parmi les `sig` phases, celle
//     dont les temps portent le plus d'attaque grave (< 150 Hz) et le plus
//     de changement de basse et d'accords d'un temps à l'autre (spectre de
//     30 Hz à 1 kHz, ~2,7 Hz par case) — l'idée de Davies & Plumbley 2006
//     (« A spectral difference approach to downbeat extraction in musical
//     audio », EUSIPCO) et de Goto 2001 (les changements d'accords tombent
//     sur les premiers temps). Une estimation plus fragile que le tempo : la
//     page le dit et laisse choisir le « 1 ».
//  7. La confiance : la part des temps suivis que la grille droite explique
//     (± 25 ms ou 4 % de la période) fois la part des intervalles suivis à
//     ± 5 % de la période — 1 pour des clics, ~0,8 pour une boucle de
//     batterie réelle, ~0,05 pour un orchestre au tempo libre (mesuré sur
//     les exemples de librosa). La clarté de pulsation (l'autocorrélation
//     normalisée, « MaxAutocor » de Lartillot et al. 2008) est rendue à part.
//
// Unités : secondes dans le son (pas dans le projet) ; la page convertit.

export const REGLAGES = {
  sr: 11025,             // la page rééchantillonne le son à ce taux (OfflineAudioContext)
  fenetre: 0.046,        // s : 512 points à 11 025 Hz, 1 024 à 22 050 Hz
  fps: 172.27,           // images par seconde de la fonction d'attaque (pas de 64 à 11 025 Hz)
  fmin: 30, fmax: 5000,  // Hz : les bandes lues
  grave: 150,            // Hz : la bande « grave » du temps fort
  gamma: 1000,           // log(1 + gamma·|X|/N) (Percival & Tzanetakis 2014)
  lissage: 0.010,        // s : écart-type du lissage gaussien de la fonction d'attaque
  moyenne: 2.0,          // s : la moyenne locale retirée avant l'autocorrélation
  bpmMin: 40, bpmMax: 240,
  centre: 120, octaves: 1,   // la loi a priori (librosa : start_bpm, std_bpm)
  tightness: 100,        // librosa.beat.beat_track
  alternance: 0.5,       // un temps sur deux à moins de la moitié de l'autre : une subdivision (notre règle)
  recalage: 0.035,       // s : la fenêtre du calage fin autour de chaque temps
  dureeMin: 4,           // s : en dessous, pas de tempo
};

// ── FFT complexe, radix 2, en place (Cooley-Tukey itératif) ──
const FFTS = new Map();
function plan(n) {
  let p = FFTS.get(n);
  if (p) return p;
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  p = { rev, cos, sin };
  FFTS.set(n, p);
  return p;
}
function fft(re, im) {
  const n = re.length, { rev, cos, sin } = plan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
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

const pause = () => new Promise((r) => setTimeout(r, 0));

// ── 1. la fonction d'attaque ────────────────────────────────
// Images centrées : l'image i couvre [i·pas − N/2, i·pas + N/2[ ; son instant
// est i·pas / sr. `grave` : le même flux, sur les bandes sous 150 Hz.
export async function attaques(x, sr, R = REGLAGES) {
  let N = 1;
  while (N < R.fenetre * sr) N <<= 1;
  const hop = Math.max(1, Math.round(sr / R.fps));
  const fps = sr / hop;
  const n = Math.floor(x.length / hop) + 1;
  const k0 = Math.max(1, Math.ceil((R.fmin * N) / sr)), k1 = Math.min(N / 2, Math.floor((R.fmax * N) / sr));
  const kg = Math.min(k1, Math.max(k0, Math.floor((R.grave * N) / sr)));
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const prev = new Float64Array(k1 + 1), cur = new Float64Array(k1 + 1);
  const flux = new Float32Array(n), grave = new Float32Array(n);
  const g = R.gamma / N;
  for (let f = 0; f < n; f++) {
    const a = f * hop - N / 2;
    for (let i = 0; i < N; i++) { const s = a + i; re[i] = s >= 0 && s < x.length ? x[s] * win[i] : 0; im[i] = 0; }
    fft(re, im);
    let s = 0, sg = 0;
    for (let k = k0; k <= k1; k++) {
      const y = Math.log(1 + g * Math.hypot(re[k], im[k]));
      cur[k] = y;
      const d = y - prev[k];
      if (f > 0 && d > 0) { s += d; if (k <= kg) sg += d; }
    }
    flux[f] = s; grave[f] = sg;
    prev.set(cur);
    if ((f & 4095) === 4095) await pause();       // la page respire pendant une longue chanson
  }
  return { flux, grave, fps, hop, N };
}

// lissage gaussien (écart-type `sd` images), même longueur
function gauss(x, sd) {
  if (sd < 0.5) return Float32Array.from(x);
  const K = Math.ceil(3 * sd), w = new Float64Array(2 * K + 1);
  let tot = 0;
  for (let k = -K; k <= K; k++) tot += (w[k + K] = Math.exp(-0.5 * (k / sd) ** 2));
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let s = 0, ws = 0;
    for (let k = -K; k <= K; k++) { const j = i + k; if (j >= 0 && j < x.length) { s += w[k + K] * x[j]; ws += w[k + K]; } }
    out[i] = ws ? s / ws : 0;
  }
  return out;
}
// la même, moins sa moyenne glissante sur `L` images (passe-haut)
function sansMoyenne(x, L) {
  const n = x.length, h = Math.max(1, Math.floor(L / 2)), c = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) c[i + 1] = c[i] + x[i];
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - h), b = Math.min(n, i + h + 1); out[i] = x[i] - (c[b] - c[a]) / (b - a); }
  return out;
}

// ── 2-3. le tempo global, et son octave ─────────────────────
export function tempoGlobal(env, fps, R = REGLAGES) {
  const n = env.length;
  const lagMin = Math.max(2, Math.floor((60 * fps) / R.bpmMax)), lagMax = Math.ceil((60 * fps) / R.bpmMin);
  const L = Math.min(n - 1, 3 * lagMax + 2);
  const A = new Float64Array(L + 1);
  for (let t = 0; t <= L; t++) {
    let s = 0;
    for (let i = 0, m = n - t; i < m; i++) s += env[i] * env[i + t];
    A[t] = s / n;
  }
  const bpmOf = (lag) => (60 * fps) / lag;
  const W = (lag) => Math.exp(-0.5 * (Math.log2(bpmOf(lag) / R.centre) / R.octaves) ** 2);
  const TPS = new Float64Array(L + 1);
  for (let t = 1; t <= L; t++) TPS[t] = W(t) * Math.max(0, A[t]);
  const at = (t) => (t >= 1 && t <= L ? TPS[t] : 0);
  const tps2 = (t) => at(t) + 0.5 * at(2 * t) + 0.25 * at(2 * t - 1) + 0.25 * at(2 * t + 1);
  const tps3 = (t) => at(t) + (at(3 * t - 1) + at(3 * t) + at(3 * t + 1)) / 3;
  let b2 = lagMin, b3 = lagMin;
  const S2 = new Float64Array(lagMax + 1), S3 = new Float64Array(lagMax + 1);
  for (let t = lagMin; t <= Math.min(lagMax, L); t++) {
    S2[t] = tps2(t); S3[t] = tps3(t);
    if (S2[t] > S2[b2]) b2 = t;
    if (S3[t] > S3[b3]) b3 = t;
  }
  const ternaire = S3[b3] > S2[b2];
  const lag = ternaire ? b3 : b2;
  const S = ternaire ? S3 : S2;
  // la période au-delà de l'image : la parabole sur l'autocorrélation
  let fin = lag;
  if (lag > 1 && lag < L) {
    const a = A[lag - 1], b = A[lag], c = A[lag + 1], d = a - 2 * b + c;
    if (d < 0) fin = lag + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d));
  }
  // la force (TPS2 ou TPS3) d'un tempo quelconque, pour dire ses voisins d'octave à la page
  const force = (bpm) => {
    const t = (60 * fps) / bpm;
    let best = 0;
    for (let k = Math.max(1, Math.round(t * 0.97)); k <= Math.min(L, Math.round(t * 1.03)); k++) best = Math.max(best, ternaire ? tps3(k) : tps2(k));
    return best;
  };
  // la clarté de pulsation à une période (en s) : l'autocorrélation normalisée (Lartillot et al. 2008)
  const clarte = (p) => {
    const t = Math.round(p * fps);
    return A[0] > 0 && t <= L ? Math.max(0, Math.min(1, A[t] / A[0])) : 0;
  };
  return { periode: fin / fps, lag, bpm: bpmOf(fin), ternaire, clarte, force, A, fps };
}

// ── 4. les temps : la programmation dynamique d'Ellis 2007 (librosa) ──
export function suivreTemps(onset, fps, periode, tightness = REGLAGES.tightness) {
  const n = onset.length, P = Math.max(2, Math.round(periode * fps));
  let m = 0;
  for (let i = 0; i < n; i++) m += onset[i];
  m /= n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (onset[i] - m) ** 2;
  const sd = Math.sqrt(v / Math.max(1, n - 1)) || 1;
  // score local : la fonction d'attaque normalisée, lissée par exp(−½(32k/P)²), k ∈ [−P, P]
  const K = P, w = new Float64Array(2 * K + 1);
  for (let k = -K; k <= K; k++) w[k + K] = Math.exp(-0.5 * ((k * 32) / P) ** 2);
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -K; k <= K; k++) { const j = i + k; if (j >= 0 && j < n) s += w[k + K] * onset[j]; }
    local[i] = s / sd;
  }
  let lmax = 0;
  for (let i = 0; i < n; i++) if (local[i] > lmax) lmax = local[i];
  const seuil = 0.01 * lmax;
  const d0 = Math.round(P / 2), d1 = 2 * P;
  const pen = new Float64Array(d1 + 1);
  for (let d = d0; d <= d1; d++) pen[d] = tightness * (Math.log(d) - Math.log(P)) ** 2;
  const back = new Int32Array(n).fill(-1), cum = new Float64Array(n);
  let premier = true;
  for (let i = 0; i < n; i++) {
    let best = -Infinity, at = -1;
    for (let d = d0; d <= d1; d++) {
      const j = i - d;
      if (j < 0) break;
      const s = cum[j] - pen[d];
      if (s > best) { best = s; at = j; }
    }
    // le début du son : tant que la fenêtre des prédécesseurs déborde avant lui, un temps
    // peut aussi ouvrir la suite sans pénalité (librosa ne le fait pas : un premier temps
    // tombé juste après P/2 y perd contre un faux temps sans prédécesseur, fait vu sur des
    // clics à 90 BPM qui commencent à 0,37 s)
    if (i < d1 && best < 0) { best = 0; at = -1; }
    cum[i] = at >= 0 ? local[i] + best : local[i];
    if (premier && local[i] < seuil) back[i] = -1;
    else { back[i] = at; premier = false; }
  }
  // le dernier temps : un maximum local du score cumulé, au-dessus de la moitié de leur médiane
  const maxs = [];
  for (let i = 1; i < n - 1; i++) if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1]) maxs.push(cum[i]);
  maxs.sort((a, b) => a - b);
  const med = maxs.length ? maxs[Math.floor(maxs.length / 2)] : 0;
  let fin = n - 1;
  for (let i = n - 2; i >= 1; i--) if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1] && cum[i] >= 0.5 * med) { fin = i; break; }
  const temps = [];
  for (let i = fin; i >= 0; i = back[i]) temps.push(i);
  temps.reverse();
  // les temps faibles des deux bouts (librosa, __trim_beats) : le seuil est la moitié du
  // RMS du score local aux temps lissé par np.hanning(5) = [0, ½, 1, ½, 0] ; on retire
  // les temps d'avant la première image qui le dépasse, et d'après la dernière
  const lb = temps.map((t) => local[t]);
  const hw = [0, 0.5, 1, 0.5, 0];
  const lisse = lb.map((_, i) => hw.reduce((s, h, k) => s + h * (lb[i + k - 2] ?? 0), 0));
  const seuilBouts = 0.5 * Math.sqrt(lisse.reduce((s, x) => s + x * x, 0) / Math.max(1, lisse.length));
  let a = 0, b = n - 1;
  while (a < n && local[a] <= seuilBouts) a++;
  while (b >= 0 && local[b] <= seuilBouts) b--;
  return temps.filter((t) => t >= a && t <= b);
}

// la force de chaque temps suivi (le pic de la fonction d'attaque à ± 2 images),
// la moyenne des temps pairs et impairs, et leur rapport (le plus faible sur le plus fort)
function alternance(e, frames) {
  const f = frames.map((t) => { let m = 0; for (let k = t - 2; k <= t + 2; k++) if (k >= 0 && k < e.length && e[k] > m) m = e[k]; return m; });
  let p = 0, i = 0, np = 0, ni = 0;
  f.forEach((v, k) => { if (k % 2) { i += v; ni++; } else { p += v; np++; } });
  p /= Math.max(1, np); i /= Math.max(1, ni);
  return { pairs: p, impairs: i, rapport: Math.max(p, i) > 0 ? Math.min(p, i) / Math.max(p, i) : 1 };
}

// ── 5. calage fin : la plus forte montée d'énergie près de chaque temps ──
function montees(x, sr) {
  const hop = Math.max(1, Math.round(sr * 0.001)), W = Math.max(2, Math.round(sr * 0.004));
  const n = Math.floor(x.length / hop);
  const r = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    const a = f * hop;
    for (let i = 0; i < W; i++) { const v = x[a + i] || 0; s += v * v; }
    r[f] = Math.sqrt(s / W);
  }
  // la montée à l'instant f : ce que la fenêtre qui commence en f a de plus que celle qui finit en f
  const d = new Float32Array(n);
  const k = Math.round(W / hop);
  for (let f = k; f < n; f++) d[f] = Math.max(0, r[f] - r[f - k]);
  return { d, pas: hop / sr };
}
function recaler(t, M, demi) {
  const a = Math.max(0, Math.floor((t - demi) / M.pas)), b = Math.min(M.d.length - 1, Math.ceil((t + demi) / M.pas));
  let best = -1, at = -1;
  for (let f = a; f <= b; f++) if (M.d[f] > best) { best = M.d[f]; at = f; }
  return best > 0 ? at * M.pas : t;
}

// droite des moindres carrés t = t0 + k·T ; rend aussi l'erreur type de T
function droite(ks, ts) {
  const n = ks.length;
  const mk = ks.reduce((s, k) => s + k, 0) / n, mt = ts.reduce((s, t) => s + t, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (ks[i] - mk) ** 2; sxy += (ks[i] - mk) * (ts[i] - mt); }
  const T = sxx ? sxy / sxx : 0, t0 = mt - T * mk;
  let se = 0;
  for (let i = 0; i < n; i++) se += (ts[i] - t0 - T * ks[i]) ** 2;
  const res = Math.sqrt(se / Math.max(1, n - 2));
  return { T, t0, res, eT: sxx ? res / Math.sqrt(sxx) : Infinity };
}

// ── 6. le temps fort : la phase de la mesure ────────────────
function phaseMesure(grille, sig, A, x, sr) {
  if (grille.length < 2 * sig) return null;
  const fps = A.fps;
  // l'attaque grave au temps (± 30 ms)
  const pres = Math.round(0.03 * fps);
  const g = grille.map((t) => {
    const f = Math.round(t * fps);
    let m = 0;
    for (let k = f - pres; k <= f + pres; k++) if (k >= 0 && k < A.grave.length && A.grave[k] > m) m = A.grave[k];
    return m;
  });
  // le changement de son d'un temps à l'autre, là où vivent la basse et les accords
  // (30 Hz - 1 kHz, FFT de 4 096 points à zéros complétés : ~2,7 Hz par case, de quoi
  // distinguer deux notes de basse) : le spectre log de chaque intervalle entre deux
  // temps, centré et normé, comparé au précédent (distance cosinus). Les changements
  // d'accords et de basse tombent sur les premiers temps (Goto 2001 ; Davies & Plumbley 2006)
  const N = 4096, re = new Float64Array(N), im = new Float64Array(N);
  const k0 = Math.max(1, Math.ceil((30 * N) / sr)), k1 = Math.min(N / 2 - 1, Math.floor((1000 * N) / sr));
  const spec = (a, b) => {
    const s0 = Math.floor(a * sr), len = Math.max(16, Math.min(N, Math.floor((b - a) * sr * 0.9)));
    re.fill(0); im.fill(0);
    for (let i = 0; i < len && s0 + i < x.length; i++) re[i] = x[s0 + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len));
    fft(re, im);
    const v = new Float64Array(k1 - k0 + 1);
    let m = 0;
    for (let k = k0; k <= k1; k++) { v[k - k0] = Math.log(1e-6 + Math.hypot(re[k], im[k])); m += v[k - k0]; }
    m /= v.length;
    let nn = 0;
    for (let k = 0; k < v.length; k++) { v[k] -= m; nn += v[k] * v[k]; }
    nn = Math.sqrt(nn) || 1;
    for (let k = 0; k < v.length; k++) v[k] /= nn;
    return v;
  };
  const S = grille.slice(0, -1).map((t, i) => spec(t, grille[i + 1]));
  const ch = grille.map((_, i) => (i === 0 || i >= S.length ? 0 : 1 - S[i].reduce((s, v, k) => s + v * S[i - 1][k], 0)));
  const z = (v) => {
    const m = v.reduce((s, x) => s + x, 0) / v.length;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) || 1;
    return v.map((x) => (x - m) / sd);
  };
  const zg = z(g), zc = z(ch);
  const score = Array.from({ length: sig }, (_, p) => {
    let s = 0, c = 0;
    for (let i = p; i < grille.length; i += sig) { s += zg[i] + (i > 0 ? zc[i] : 0); c++; }
    return c ? s / c : -Infinity;
  });
  const ord = score.map((s, p) => [s, p]).sort((a, b) => b[0] - a[0]);
  const marge = ord.length > 1 ? ord[0][0] - ord[1][0] : 0;
  return { phase: ord[0][1], scores: score, confiance: Math.max(0, Math.min(1, marge / 1.5)) };
}

// ── tout : un son mono → tempo, temps, temps fort, confiance ──
// `x` : Float32Array mono ; `sr` : son taux ; `sig` : les temps de la mesure
// du projet (2, 3, 4 ou 6). Rend { ok: false, pourquoi } quand il n'y a rien
// à en dire.
export async function analyser(x, sr, { sig = 4, R = REGLAGES } = {}) {
  const duree = x.length / sr;
  if (!(duree >= R.dureeMin)) return { ok: false, pourquoi: `trop court pour un tempo (${R.dureeMin} s au moins)` };
  let pk = 0;
  for (let i = 0; i < x.length; i += 7) { const v = Math.abs(x[i]); if (v > pk) pk = v; }
  if (pk < 1e-4) return { ok: false, pourquoi: 'le son est muet' };
  const t0 = Date.now();
  const A = await attaques(x, sr, R);
  const lisse = gauss(A.flux, R.lissage * A.fps);
  const env = sansMoyenne(lisse, Math.round(R.moyenne * A.fps));
  const G = tempoGlobal(env, A.fps, R);
  if (!(G.clarte(G.periode) > 0)) return { ok: false, pourquoi: 'aucune pulsation régulière dans ce son' };
  await pause();
  let frames = suivreTemps(lisse, A.fps, G.periode, R.tightness);
  if (frames.length < 4) return { ok: false, pourquoi: 'trop peu de temps suivis pour en tirer un tempo' };
  // la subdivision prise pour le temps : si un temps suivi sur deux est nettement plus
  // faible que l'autre, la grille alterne fort / faible, c'est-à-dire qu'un niveau métrique
  // plus lent existe au-dessus d'elle (la définition d'un niveau métrique : Lerdahl &
  // Jackendoff 1983, GTTM) — le temps est alors deux fois plus lent
  const alt = alternance(lisse, frames);
  let periode = G.periode, double = false;
  if (R.alternance && alt.rapport < R.alternance && (60 / (2 * periode)) >= R.bpmMin) {
    const f2 = suivreTemps(lisse, A.fps, 2 * periode, R.tightness);
    if (f2.length >= 4) { frames = f2; periode *= 2; double = true; }
  }
  const M = montees(x, sr);
  const brut = frames.map((f) => f / A.fps);
  const cales = brut.map((t) => recaler(t, M, R.recalage));
  // les rangs : un intervalle de deux périodes est un temps sauté
  const ks = [0];
  for (let i = 1; i < cales.length; i++) ks.push(ks[i - 1] + Math.max(1, Math.round((cales[i] - cales[i - 1]) / periode)));
  let L = droite(ks, cales);
  // un temps recalé sur autre chose (un charleston, un fla) s'écarte : on refait la droite sans lui
  const garde = ks.map((k, i) => Math.abs(cales[i] - L.t0 - L.T * k) <= Math.max(0.02, 3 * L.res));
  if (garde.filter(Boolean).length >= 4 && garde.some((g) => !g)) L = droite(ks.filter((_, i) => garde[i]), cales.filter((_, i) => garde[i]));
  const T = L.T > 0 ? L.T : periode;
  const bpm = 60 / T;
  const tol = Math.max(0.025, 0.04 * T);
  const ebpm = Number.isFinite(L.eT) ? (60 / (T * T)) * L.eT * 2 : Infinity;     // ± deux erreurs types
  const entier = Math.round(bpm);
  const propose = Math.abs(bpm - entier) <= Math.max(0.02, ebpm) ? entier : Math.round(bpm * 100) / 100;
  // le début de la musique : la première image dont l'attaque passe le dixième du
  // 95e centile (une intro calme compte : le suivi peut ne commencer qu'après elle)
  const tri = Float32Array.from(A.flux).sort();
  const p95 = tri[Math.floor(0.95 * (tri.length - 1))];
  let debut = 0;
  for (let f = 0; f < A.flux.length; f++) if (A.flux[f] > 0.1 * p95) { debut = recaler(f / A.fps, M, R.recalage); break; }
  // la première pulsation : la grille droite prolongée vers le début, son premier point
  // à partir du début de la musique (à la tolérance près)
  let premier = L.t0 + Math.ceil((debut - tol - L.t0) / T) * T;
  if (premier < 0) premier += T;
  const grille = [];
  for (let t = premier; t < duree - 0.05; t += T) grille.push(t);
  // la confiance : la part des temps suivis que la grille droite explique (± 25 ms ou
  // 4 % de la période), fois la part des intervalles suivis à ± 5 % de la période
  const accord = cales.filter((t) => Math.abs(t - L.t0 - Math.round((t - L.t0) / T) * T) <= tol).length / cales.length;
  const stables = brut.slice(1).filter((t, i) => Math.abs(t - brut[i] - periode) <= 0.05 * periode).length / Math.max(1, brut.length - 1);
  const ph = phaseMesure(grille, sig, A, x, sr);
  const tempsFort = ph ? grille[ph.phase] : null;
  // les voisins d'octave : leur force relative (TPS2 ou TPS3) ; « ×2 » est le tempo double
  const f0 = G.force(bpm) || 1;
  const autres = [[2, '×2'], [0.5, '÷2'], ...(G.ternaire ? [[3, '×3'], [1 / 3, '÷3']] : [[1.5, '×3/2'], [2 / 3, '×2/3']])]
    .filter(([f]) => bpm * f >= 20 && bpm * f <= 300)
    .map(([f, nom]) => ({ nom, facteur: f, bpm: bpm * f, score: G.force(bpm * f) / f0 }));
  // l'octave est-elle douteuse ? (la page le dit et met le voisin en avant)
  let octave = null;
  if (double && alt.rapport >= 0.35) octave = { nom: '×2', pourquoi: `un temps sur deux plus faible (rapport ${alt.rapport.toFixed(2)}) : le double tient aussi` };
  else {
    const v = autres.filter((a) => a.facteur === 2 || a.facteur === 0.5).sort((a, b) => b.score - a.score)[0];
    if (v && v.score >= 0.85) octave = { nom: v.nom, pourquoi: `sa périodicité est presque aussi forte (${v.score.toFixed(2)})` };
  }
  return {
    ok: true, bpm, propose, ebpm, ternaire: G.ternaire, double, alternance: alt.rapport, octave,
    confiance: Math.max(0, Math.min(1, accord * stables)), accord, stables, clarte: G.clarte(T),
    debut, premier, tempsFort, phase: ph?.phase ?? null, sig, phaseConfiance: ph?.confiance ?? 0, phaseScores: ph?.scores || [],
    ecart: L.res, stable: L.res < 0.015, autres,
    temps: cales, grille, duree, sr, fps: A.fps, flux: lisse,
    ms: Date.now() - t0,
  };
}
