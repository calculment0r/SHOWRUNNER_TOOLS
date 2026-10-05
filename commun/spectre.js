// SHOWRUNNER TOOLS — le SPECTRE d'un son (spectrogramme), la vue « spectre » de commun/onde.js.
//
// Cal, 06/10 : « Quand on est dans Transcrire, on peut afficher un spectre de bonne qualité […] et
// idem dans le banc de Montage, car on va avoir besoin de couper ou d'ajuster de façon ultra précise
// dans le segment. » Le spectre montre ce que l'onde cache : les formants de la parole, les
// consonnes (le souffle des « s », des « ch » dans les aigus), une coupe, un bruit de fond.
//
// Ce qu'on calcule (le calcul : commun/spectre.worker.js, un Worker — la page ne bloque jamais) :
//   - la STFT des ÉCHANTILLONS du son (ceux de l'onde précise, lus dans la copie sans perte du
//     serveur, server/tools/apercu_son.py), fenêtre de Hann, 75 % de recouvrement ; une colonne
//     d'écran plus large qu'un pas fait la moyenne de toutes ses fenêtres ;
//   - la taille de la fenêtre suit le zoom (l'« Auto-adjustable STFT » d'iZotope RX : « adjusts FFT
//     size […] according to the zoom level ») : 16 fois la largeur d'une colonne, de 512 à 4096
//     échantillons à 48 kHz (10,7 à 85 ms) ; les basses gardent 85 ms (le « multi-resolution » de RX) ;
//   - les fréquences de 20 Hz à 20 kHz (ou à la moitié de la fréquence du son) sur l'échelle mel
//     (par défaut : la parole y prend la place) ou logarithmique (une octave = une hauteur) — les
//     deux échelles de RX et d'Audacity pour lire la parole et la musique ;
//   - le niveau en dB sous le plus fort du son, sur 90 dB, aux couleurs du thème : la rampe des
//     jetons `--spec-0` (le silence) à `--spec-4` (le plus fort), commun/tokens.css, deux thèmes ;
//     un changement de thème recolore les tuiles sans rien recalculer.
// Ce qu'on dessine : des tuiles de 128 colonnes d'écran, calculées au zoom exact (rien d'étiré) ;
// tant qu'elles manquent, la dernière image complète du même canvas, remise à l'échelle, tient la
// place (comme une carte qui zoome), puis les vraies la remplacent.
// La borne : le spectre se calcule pour 2^23 échantillons à l'écran au plus (2 min 55 s à 48 kHz :
// 16 Mo d'échantillons lus) ; au-delà, la vue dit de zoomer (docs/etudes/onde_spectre.md § 4).
//
//   peindreSpectre(g, S, { t0, t1, y, w, h, dpr, cv })   appelé par commun/onde.js (la vue)

import { echelleSon } from './onde.js';

const T = 128;                 // colonnes par tuile
export const SPAN_MAX = 1 << 23;   // échantillons à l'écran au plus
const PLAGE = 90;              // dB sous le plus fort
const FMIN = 20, FMAX = 20000;
const TUILES_MAX = 400;        // tuiles gardées (≈ 128 × 160 × 5 octets chacune)
const VOULUE_MS = 1500;        // une tuile qu'aucun dessin n'a demandée depuis : abandonnée

let worker = null, enCours = null;
const attente = new Map();     // cle → {S, p} : à calculer
const voulues = new Map();     // cle → dernier dessin qui l'a demandée
const tuiles = new Map();      // cle → {niv, cols, rows, cv, lutV} (LRU)
let lut = null, lutV = 0;
// pour les mesures : les tuiles calculées, le temps du Worker, ce qui attend
export const mesureSpectre = { tuiles: 0, ms: 0, attente: () => attente.size + (enCours ? 1 : 0) };

// ── la rampe du thème : les jetons --spec-0 … --spec-4, lus et mélangés en 256 teintes ──
function couleur(css, g) {
  g.clearRect(0, 0, 1, 1);
  g.fillStyle = '#000';
  g.fillStyle = css;
  g.fillRect(0, 0, 1, 1);
  return g.getImageData(0, 0, 1, 1).data;
}
function rampe() {
  if (lut) return lut;
  const cs = getComputedStyle(document.documentElement);
  const g = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  const st = [0, 1, 2, 3, 4].map((i) => couleur(cs.getPropertyValue(`--spec-${i}`).trim() || 'transparent', g));
  lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * (st.length - 1), j = Math.min(st.length - 2, Math.floor(x)), f = x - j;
    for (let c = 0; c < 4; c++) lut[i * 4 + c] = st[j][c] + (st[j + 1][c] - st[j][c]) * f;
  }
  lutV++;
  return lut;
}
if (typeof document !== 'undefined') document.addEventListener('sr:theme', () => { lut = null; });

function colorer(t) {
  const L = rampe();
  if (t.cv && t.lutV === lutV) return t.cv;
  const img = new ImageData(t.cols, t.rows);
  const px = img.data, niv = t.niv;
  for (let i = 0; i < niv.length; i++) {
    const o = niv[i] * 4;
    px[i * 4] = L[o]; px[i * 4 + 1] = L[o + 1]; px[i * 4 + 2] = L[o + 2]; px[i * 4 + 3] = L[o + 3];
  }
  if (!t.cv) t.cv = Object.assign(document.createElement('canvas'), { width: t.cols, height: t.rows });
  t.cv.getContext('2d').putImageData(img, 0, 0);
  t.lutV = lutV;
  return t.cv;
}

// ── la file du Worker : une tuile à la fois, la plus récemment voulue d'abord ──
function lancer() {
  if (!worker) {
    worker = new Worker(new URL('./spectre.worker.js', import.meta.url));
    worker.onmessage = (e) => {
      const { cle, niv, ms } = e.data;
      mesureSpectre.tuiles++;
      mesureSpectre.ms += ms;
      const j = enCours;
      enCours = null;
      if (j && j.cle === cle) {
        tuiles.set(cle, { niv, cols: j.p.cols, rows: j.p.rows, cv: null, lutV: -1 });
        for (const k of tuiles.keys()) { if (tuiles.size <= TUILES_MAX) break; tuiles.delete(k); }
        j.S.reveiller();
      }
      pomper();
    };
    worker.onerror = () => { enCours = null; };
  }
}
function pomper() {
  if (enCours || !attente.size) return;
  const now = performance.now();
  const rangees = [...attente.entries()].sort((x, y) => (voulues.get(y[0]) || 0) - (voulues.get(x[0]) || 0));
  for (const [cle, j] of rangees) {
    if (now - (voulues.get(cle) || 0) > VOULUE_MS) { attente.delete(cle); continue; }
    const p = j.p;
    const pcm = j.S.plage(p.a, p.b);      // les échantillons de la tuile (et ses marges) : là, ou demandés
    if (!pcm) continue;
    attente.delete(cle);
    lancer();
    enCours = { cle, S: j.S, p };
    worker.postMessage({ cle, pcm, a: p.a, n: j.S.h.n, sr: j.S.h.sr, spp: p.spp, c0: p.c0, cols: p.cols, rows: p.rows,
      ech: p.ech, fmin: p.fmin, fmax: p.fmax, nHi: p.nHi, nLo: p.nLo, peak: j.S.h.peak, plage: PLAGE }, [pcm.buffer]);
    return;
  }
}

const p2 = (x) => Math.pow(2, Math.round(Math.log2(x)));

// le spectre de t0 à t1 (s) dans la bande [y, y + h) du canvas (pixels d'écran)
export function peindreSpectre(g, S, { t0, t1, y, w, h, dpr, cv }) {
  const H = S.h;
  const st = getComputedStyle(cv);
  const L = rampe();
  g.fillStyle = `rgba(${L[0]}, ${L[1]}, ${L[2]}, ${L[3] / 255})`;   // le silence : le fond de la rampe
  g.fillRect(0, y, w, h);
  if (!H) { mot(g, st, y, w, h, dpr, S.erreur ? 'pas de spectre : ' + S.erreur : 'le spectre attend l’onde de ce son'); return; }
  const span = (t1 - t0) * H.sr;
  if (span > SPAN_MAX) {
    mot(g, st, y, w, h, dpr, `zoomer : le spectre se calcule pour ${Math.floor(SPAN_MAX / H.sr / 60)} min ${Math.round((SPAN_MAX / H.sr) % 60)} s à l’écran au plus`);
    cv.__spec = null;
    return;
  }
  const spp = span / w;
  const ech = echelleSon();
  const k = H.sr / 48000;
  const nHi = p2(Math.max(512 * k, Math.min(4096 * k, spp * 16)));
  const nLo = Math.max(nHi, p2(4096 * k));
  const fmax = Math.min(FMAX, H.sr / 2);
  const c0 = (t0 * H.sr) / spp;                       // la première colonne de l'écran, sur la grille des tuiles
  const j0 = Math.floor(c0 / T), j1 = Math.floor((c0 + w - 1) / T);
  const now = performance.now();
  // le temps que les tuiles arrivent : la dernière image complète, remise à l'échelle
  const prev = cv.__spec;
  if (prev && prev.S === S && prev.h === h && prev.ech === ech && prev.lutV === lutV) {
    const x = ((prev.t0 - t0) / (t1 - t0)) * w, ww = ((prev.t1 - prev.t0) / (t1 - t0)) * w;
    g.drawImage(prev.img, x, y, ww, h);
  }
  let complet = true;
  for (let j = j0; j <= j1; j++) {
    const cle = `${S.cle}|${spp.toPrecision(10)}|${h}|${ech}|${j}`;
    voulues.set(cle, now);
    const t = tuiles.get(cle);
    if (t) {
      tuiles.delete(cle); tuiles.set(cle, t);         // LRU
      g.drawImage(colorer(t), Math.round(j * T - c0), y);
      continue;
    }
    complet = false;
    if (!attente.has(cle) && (!enCours || enCours.cle !== cle)) {
      const a = Math.max(0, Math.floor(j * T * spp - nLo / 2)), b = Math.min(H.n, Math.ceil((j + 1) * T * spp + nLo / 2));
      attente.set(cle, { S, p: { a, b, spp, c0: j * T, cols: T, rows: h, ech, fmin: FMIN, fmax, nHi, nLo } });
    }
  }
  for (const [kk, t] of voulues) if (now - t > 10 * VOULUE_MS) voulues.delete(kk);
  if (complet) {
    // l'image complète, gardée pour le prochain zoom ou défilement
    const img = prev && prev.img.width === w && prev.img.height === h ? prev.img : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const gi = img.getContext('2d');
    gi.clearRect(0, 0, w, h);
    gi.drawImage(cv, 0, y, w, h, 0, 0, w, h);
    cv.__spec = { S, h, ech, lutV, t0, t1, img };
  }
  axe(g, st, H.sr, ech, fmax, y, w, h, dpr);
  pomper();
}

// les repères de fréquence, à gauche : 100 Hz, 1 kHz, 10 kHz (s'il y a la place)
function axe(g, st, sr, ech, fmax, y, w, h, dpr) {
  if (h < 48 * Math.min(dpr, 2) / 2 || w < 120) return;
  const u = ech === 'log' ? (f) => Math.log10(f) : (f) => 2595 * Math.log10(1 + f / 700);
  const u0 = u(FMIN), u1 = u(fmax);
  const fs = Math.round(9 * dpr);
  g.save();
  g.font = `${fs}px ${st.getPropertyValue('--f-mono') || 'monospace'}`;
  g.textBaseline = 'middle';
  for (const [f, nom] of [[100, '100'], [1000, '1k'], [10000, '10k']]) {
    if (f >= fmax) continue;
    const yy = Math.round(y + h - ((u(f) - u0) / (u1 - u0)) * h);
    if (yy < y + fs || yy > y + h - fs) continue;
    const tw = g.measureText(nom).width;
    g.fillStyle = st.getPropertyValue('--veil') || 'transparent';
    g.fillRect(0, yy - fs * 0.7, tw + 8 * dpr, fs * 1.4);
    g.fillStyle = st.getPropertyValue('--ink2') || 'currentColor';
    g.fillText(nom, 3 * dpr, yy);
  }
  g.restore();
}

// un mot dans la bande (ce qui manque, ou ce qu'il faut faire)
function mot(g, st, y, w, h, dpr, texte) {
  g.save();
  const fs = Math.round(10 * dpr);
  g.font = `${fs}px ${st.getPropertyValue('--f-mono') || 'monospace'}`;
  g.fillStyle = st.getPropertyValue('--ink3') || 'currentColor';
  g.textBaseline = 'middle';
  g.fillText(texte, 8 * dpr, y + h / 2, Math.max(10, w - 16 * dpr));
  g.restore();
}
