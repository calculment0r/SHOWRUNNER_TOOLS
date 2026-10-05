// SHOWRUNNER TOOLS — l'onde d'un son, DESSINÉE à la résolution de l'écran, juste à tout zoom.
//
// Cal, 01/10 : dans le Montage, l'onde « on dirait une image en basse définition » (une image
// ffmpeg étirée) → les pics (1/200 s), dessinés ici. Cal, 06/10 : « L'onde audio est super mal
// définie (sur une capture zoomée de Transcrire : des blocs en escalier) » — le lecteur commun
// étirait encore le masque de 1200 colonnes, et les pics, d'un son décodé à 8 kHz, sur un octet,
// une valeur par 5 ms, ne disent pas le son sous 5 ms (docs/etudes/onde_spectre.md § 1).
//
// L'onde PRÉCISE (06/10, server/tools/apercu_son.py, « l'onde précise ») : le serveur a décodé le
// son une fois, à sa fréquence, et rangé à côté de lui une PYRAMIDE de paires (min, max) exactes
// (64 échantillons, puis 256, 1024… : le principe de BBC audiowaveform et des résumés d'Audacity)
// et une copie sans perte d'où il lit les ÉCHANTILLONS à l'échantillon près. Pour chaque colonne
// de pixels de l'écran (devicePixelRatio compris), la page prend le palier qui tient sous la
// largeur de la colonne, ou les échantillons eux-mêmes ; elle ne charge que des tuiles de ce qui
// se voit, gardées dans un cache commun (LRU). Trois façons de dessiner, selon le zoom :
//   - plus de 1,5 échantillon par pixel : une barre du min au max de la colonne (la colonne
//     déborde sur la première valeur de la suivante : le trait ne se coupe jamais) ;
//   - moins : les échantillons reliés par un trait ;
//   - un échantillon tous les 6 pixels ou plus : chaque échantillon marqué d'un point
//     (Audacity, Audition : l'onde zoomée montre ses échantillons).
// Tant qu'une tuile manque, un palier plus grossier déjà là la remplace (plus large que le son,
// jamais plus étroit), puis la vraie la remplace ; tant que la pyramide se calcule, les pics de
// 01/10 (`/api/son/pics`) dessinent l'onde d'attente.
//
//   const S = source(id, { voix })                    la source (une par son, partagée)
//   dessiner(canvas, S, { t0, t1, vue, alpha, part }) l'onde de t0 à t1 (s) sur tout le canvas ;
//        vue : 'onde' | 'spectre' | 'deux' (commun/spectre.js ; « deux » : l'onde au-dessus, le
//        spectre dessous, comme Audition) ; alpha : l'opacité de l'onde ; part : 'onde' (la seule
//        onde, à sa place dans la vue — le « joué » du lecteur)
//   pics(id, { voix }) → Promise de la source        (l'entrée de 01/10, gardée : l'écran Source du Montage)
//   vueSon(), poserVueSon(v), VUES                     la vue choisie (onde, spectre, les deux), par navigateur
//   echelleSon(), poserEchelleSon(e)                   l'échelle des fréquences du spectre : 'mel' | 'log'
//   boutonVue()                                        le bouton de la barre qui ouvre le choix (le lecteur, le Montage)
//
// Le canvas se redessine seul quand ses données arrivent (il garde sa dernière demande). La couleur
// de l'onde est celle du canvas en CSS (`color: var(--grn2)` dans la feuille de l'outil) : un jeton,
// les deux thèmes ; aucune couleur ici.

import { api, el } from './shell.js';
import { menu } from './menu.js';

const PICS_V = 1;            // apercu_son.py, VERSION
const ONDE_V = 2;            // apercu_son.py, ONDE_V
const TUILE = 8192;          // paires (min, max) par tuile d'un palier : 32 Ko
export const MORCEAU = 131072; // échantillons par morceau : 256 Ko (2,7 s à 48 kHz ; apercu_son.py, ECH_MAX)
const CACHE_MAX = 96 << 20;  // octets gardés au plus, toutes sources (le spectre lit les mêmes morceaux)
const LIGNE = 1.5;           // échantillons par pixel sous lesquels on relie les échantillons
const POINTS = 1 / 6;        // … sous lesquels on marque chaque échantillon

// ── le cache commun (LRU : la dernière lue repart en queue) ──
const lru = new Map();
let lruOctets = 0;
function garder(k, v) {
  if (lru.has(k)) lruOctets -= lru.get(k).byteLength;
  lru.delete(k);
  lru.set(k, v);
  lruOctets += v.byteLength;
  for (const [k2, v2] of lru) {
    if (lruOctets <= CACHE_MAX) break;
    lru.delete(k2);
    lruOctets -= v2.byteLength;
  }
}
function lire(k) {
  const v = lru.get(k);
  if (v) { lru.delete(k); lru.set(k, v); }
  return v;
}

const sources = new Map();
export function source(id, { voix = null } = {}) {
  const k = `${id}|${voix ?? ''}`;
  if (!sources.has(k)) sources.set(k, new Source(id, voix, k));
  return sources.get(k);
}

// l'entrée de 01/10 (l'écran Source du Montage) : la source, dès que son en-tête (ou l'onde d'attente) est là
export function pics(id, { voix = null } = {}) {
  const S = source(id, { voix });
  return S.pret().then(() => S);
}

class Source {
  constructor(id, voix, cle) {
    this.id = id;
    this.voix = voix;
    this.cle = cle;
    this.h = null;            // l'en-tête de la pyramide : {sr, n, peak, b0, f, niveaux}
    this.vieux = null;        // les pics de 01/10, l'onde d'attente : {bps, a}
    this.erreur = null;
    this.vol = new Map();     // les demandes en cours (clé → promesse)
    this.vues = new Set();    // les canvas qui la montrent (redessinés quand une tuile arrive)
    this.raf = 0;
    this._pret = null;
  }
  q(route) { return `son/${route}/${this.id}?v=${ONDE_V}${this.voix != null ? `&voix=${this.voix}` : ''}`; }
  get sr() { return this.h ? this.h.sr : 0; }
  get duree() { return this.h ? this.h.n / this.h.sr : this.vieux ? this.vieux.a.length / this.vieux.bps : 0; }

  // l'en-tête : la pyramide se calcule peut-être (une file sur le serveur) — on redemande, de plus en
  // plus espacé ; en attendant, les pics de 01/10 (quelques secondes de calcul) dessinent l'onde
  pret() {
    if (this._pret) return this._pret;
    let fin;
    this._pret = new Promise((r) => { fin = r; });
    const vieux = () => api(`son/pics/${this.id}?v=${PICS_V}${this.voix != null ? `&voix=${this.voix}` : ''}`).then((r) => {
      const bin = atob(r.b64 || '');
      const a = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      this.vieux = { bps: r.bps || 200, a };
      this.reveiller();
    }).catch(() => {}).finally(fin);
    let attente = 400, demande = false;
    const tour = () => api(this.q('onde')).then((r) => {
      if (r && r.pret) { this.h = r; fin(); this.reveiller(); return; }
      if (!demande) { demande = true; vieux(); }
      setTimeout(tour, attente);
      attente = Math.min(4000, attente * 1.5);
    }).catch((e) => {
      // 422 : pas de son lisible ; 403, 404 : l'objet n'est plus à nous — l'onde d'attente, si elle vient
      this.erreur = e.message;
      if (!demande) { demande = true; vieux(); } else fin();
      this.reveiller();
    });
    tour();
    return this._pret;
  }

  // redessiner, à l'image d'écran suivante, les canvas qui la montrent encore
  reveiller() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      for (const cv of this.vues) {
        if (!cv.isConnected) { this.vues.delete(cv); continue; }
        const d = cv.__onde;
        if (d && d.src === this) peindre(cv, this, d.opts);
      }
    });
  }

  // une tuile d'un palier ou un morceau d'échantillons : là, ou demandé (null)
  _tuile(cle, url) {
    const v = lire(cle);
    if (v) return v;
    if (!this.vol.has(cle)) {
      this.vol.set(cle, api(url, { blob: true }).then((b) => b.arrayBuffer()).then((buf) => {
        garder(cle, new Int16Array(buf));
        this.vol.delete(cle);
        this.reveiller();
      }).catch(() => { setTimeout(() => this.vol.delete(cle), 3000); }));
    }
    return null;
  }
  niveau(k, j) {
    const n = Math.min(TUILE, this.h.niveaux[k] - j * TUILE);
    return this._tuile(`${this.cle}|n${k}|${j}`, `${this.q('onde')}&niveau=${k}&de=${j * TUILE}&n=${n}`);
  }
  morceau(j) {
    const n = Math.min(MORCEAU, this.h.n - j * MORCEAU);
    return this._tuile(`${this.cle}|e${j}`, `${this.q('echantillons')}&de=${j * MORCEAU}&n=${n}`);
  }
  // les échantillons [a, b) : un Int16Array si tous sont là, sinon null (les morceaux manquants sont demandés)
  plage(a, b) {
    a = Math.max(0, a); b = Math.min(this.h.n, b);
    const ms = [];
    let pret = true;
    for (let j = Math.floor(a / MORCEAU); j * MORCEAU < b; j++) {
      const m = this.morceau(j);
      if (!m) pret = false;
      ms.push(m);
    }
    if (!pret) return null;
    const out = new Int16Array(Math.max(0, b - a));
    ms.forEach((m, i) => {
      const j = Math.floor(a / MORCEAU) + i;
      const s0 = Math.max(a, j * MORCEAU), s1 = Math.min(b, (j + 1) * MORCEAU);
      out.set(m.subarray(s0 - j * MORCEAU, s1 - j * MORCEAU), s0 - a);
    });
    return out;
  }
  // min et max des échantillons [a, b) : [mn, mx], ou null s'il en manque (demandés)
  minmax(a, b) {
    let mn = 32767, mx = -32768;
    for (let j = Math.floor(a / MORCEAU); j * MORCEAU < b; j++) {
      const m = this.morceau(j);
      if (!m) return null;
      const lo = Math.max(a, j * MORCEAU) - j * MORCEAU, hi = Math.min(b, (j + 1) * MORCEAU) - j * MORCEAU;
      for (let i = lo; i < hi; i++) { const v = m[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    }
    return [mn, mx];
  }
  // min et max des paires [i0, i1) du palier k — ou d'un palier plus grossier déjà là, en attendant : [mn, mx] ou null
  paires(k, i0, i1) {
    const H = this.h;
    for (let kk = k; kk < H.niveaux.length; kk++) {
      const div = Math.pow(H.f, kk - k);
      const a = Math.floor(i0 / div), b = Math.max(a + 1, Math.ceil(i1 / div));
      let mn = 32767, mx = -32768, ok = true;
      for (let j = Math.floor(a / TUILE); j * TUILE < b; j++) {
        const t = kk === k ? this.niveau(kk, j) : lire(`${this.cle}|n${kk}|${j}`);
        if (!t) { ok = false; break; }
        const lo = Math.max(a, j * TUILE) - j * TUILE, hi = Math.min(b, (j + 1) * TUILE, H.niveaux[kk]) - j * TUILE;
        for (let i = lo; i < hi; i++) { if (t[2 * i] < mn) mn = t[2 * i]; if (t[2 * i + 1] > mx) mx = t[2 * i + 1]; }
      }
      if (ok) return [mn, mx];
    }
    return null;
  }
}

// ── la vue choisie (onde, spectre, les deux) et l'échelle du spectre : des préférences de ce
// navigateur, communes aux pages (un changement redessine tout ce qui les montre : `sr:vue-son`) ──
export const VUES = [['onde', 'onde'], ['spectre', 'spectre'], ['deux', 'les deux']];
const VUE = 'sr-onde-vue', ECH = 'sr-spectre-echelle';
const lireLS = (k, ok, d) => { try { const v = localStorage.getItem(k); return ok.includes(v) ? v : d; } catch { return d; } };
const poserLS = (k, v) => {
  try { localStorage.setItem(k, v); } catch { /* stockage fermé : le temps de la page */ }
  document.dispatchEvent(new CustomEvent('sr:vue-son'));
};
export const vueSon = () => lireLS(VUE, VUES.map(([k]) => k), 'onde');
export const poserVueSon = (v) => poserLS(VUE, v);
export const echelleSon = () => lireLS(ECH, ['mel', 'log'], 'mel');
export const poserEchelleSon = (e) => poserLS(ECH, e);
if (typeof window !== 'undefined') {
  // un autre onglet a changé la vue : celui-ci suit
  addEventListener('storage', (e) => { if (e.key === VUE || e.key === ECH) document.dispatchEvent(new CustomEvent('sr:vue-son')); });
}

// le bouton de la barre : il dit la vue, et ouvre le choix (le menu commun)
export function boutonVue({ cls = 'tb ghost sm' } = {}) {
  const b = el('button', { class: `${cls} sr-vue-son`, type: 'button', 'aria-haspopup': 'menu',
    title: 'la vue du son : l’onde, le spectre (les fréquences dans le temps), ou les deux' });
  const peindreB = () => {
    if (b.isConnected) b.__vu = true;
    else if (b.__vu) { document.removeEventListener('sr:vue-son', peindreB); return; }   // retiré de la page
    const v = vueSon();
    b.textContent = (VUES.find(([k]) => k === v) || VUES[0])[1];
    b.dataset.vue = v;
  };
  b.addEventListener('pointerdown', (e) => e.stopPropagation());   // posé dans une règle : pas un geste de la tête
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = b.getBoundingClientRect();
    menu(r.left, r.bottom + 4, [
      { head: 'VUE DU SON' },
      ...VUES.map(([k, nom]) => ({ label: nom, checked: vueSon() === k, onclick: () => poserVueSon(k) })),
      '-',
      { head: 'FRÉQUENCES DU SPECTRE' },
      { label: 'mel', sub: 'la parole prend la place (formants, consonnes)', checked: echelleSon() === 'mel', onclick: () => poserEchelleSon('mel') },
      { label: 'logarithmique', sub: 'une octave, une même hauteur (la musique)', checked: echelleSon() === 'log', onclick: () => poserEchelleSon('log') },
    ]);
  });
  document.addEventListener('sr:vue-son', peindreB);
  peindreB();
  return b;
}

// ── le dessin ──
// le spectre (commun/spectre.js, son Worker) ne se charge que la première fois qu'on le montre
let specMod = null, specVient = null;
function avecSpectre(S) {
  if (!specVient) specVient = import('./spectre.js').then((m) => { specMod = m; });
  specVient.then(() => S.reveiller());
}

// dessine la source de t0 à t1 secondes sur toute la largeur du canvas (taille CSS lue ici)
export function dessiner(cv, S, opts = {}) {
  if (!cv || !S) return;
  if (!(S instanceof Source)) { dessinerPics(cv, S, opts); return; }   // des pics bruts ({bps, a})
  cv.__onde = { src: S, opts };
  S.vues.add(cv);
  S.pret();
  peindre(cv, S, opts);
}

function peindre(cv, S, { t0 = 0, t1 = null, vue = 'onde', alpha = 1, part = 'tout' } = {}) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(cv.clientWidth * dpr));
  const h = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== w) cv.width = w;
  if (cv.height !== h) cv.height = h;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  const fin = t1 ?? S.duree;
  if (!(fin > t0)) return;
  // la place de chacun : « les deux » met l'onde au-dessus (40 %), le spectre dessous (Audition, « Show Both »)
  const hO = vue === 'spectre' ? 0 : vue === 'deux' ? Math.round(h * 0.4) : h;
  if (hO > 0) {
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = g.strokeStyle = getComputedStyle(cv).color;
    if (S.h) ondePrecise(g, S, t0, fin, w, hO, dpr);
    else if (S.vieux) ondePics(g, S.vieux, t0, fin, w, hO, dpr);
    g.restore();
  }
  if (hO < h && part !== 'onde') {
    if (specMod) specMod.peindreSpectre(g, S, { t0, t1: fin, y: hO, w, h: h - hO, dpr, cv });
    else avecSpectre(S);
  }
}

// l'onde à partir de la pyramide et des échantillons : chaque colonne d'écran, exacte
function ondePrecise(g, S, t0, t1, w, h, dpr) {
  const H = S.h;
  const mid = h / 2;
  const k = Math.max(1, mid - dpr) / Math.max(1, H.peak);   // l'échelle : le plus fort touche presque le bord
  const spp = ((t1 - t0) * H.sr) / w;                        // échantillons par pixel d'écran
  const s0 = t0 * H.sr;
  if (spp <= LIGNE) {
    // les échantillons eux-mêmes, reliés ; un point sur chacun quand ils s'écartent
    const a = Math.max(0, Math.floor(s0) - 1), b = Math.min(H.n - 1, Math.ceil(s0 + w * spp) + 1);
    const pas = 1 / spp;
    g.lineWidth = Math.max(1, dpr);
    g.lineJoin = 'round';
    g.beginPath();
    let trait = false, j = -1, m = null;
    const pts = [];
    for (let s = a; s <= b; s++) {
      if (Math.floor(s / MORCEAU) !== j) { j = Math.floor(s / MORCEAU); m = S.morceau(j); }
      if (!m) { trait = false; continue; }
      const x = (s - s0) * pas, y = mid - m[s - j * MORCEAU] * k;
      if (trait) g.lineTo(x, y); else g.moveTo(x, y);
      trait = true;
      if (spp <= POINTS) pts.push(x, y);
    }
    g.stroke();
    const r = 1.5 * dpr;
    for (let i = 0; i < pts.length; i += 2) g.fillRect(pts[i] - r, pts[i + 1] - r, 2 * r, 2 * r);
    return;
  }
  // une barre par colonne : du min au max des échantillons qu'elle couvre (et de la première valeur de la suivante)
  let niv = -1, B = 1;
  if (spp >= H.b0) {
    niv = Math.min(H.niveaux.length - 1, Math.floor(Math.log(spp / H.b0) / Math.log(H.f) + 1e-9));
    B = H.b0 * Math.pow(H.f, niv);
  }
  for (let x = 0; x < w; x++) {
    const a = Math.max(0, Math.floor(s0 + x * spp)), b = Math.min(H.n, Math.floor(s0 + (x + 1) * spp) + 1);
    if (b <= a) continue;
    // le palier qui tient sous la colonne ; sous 64 échantillons par pixel, les échantillons (en attendant : le palier 0)
    const r = niv >= 0 ? S.paires(niv, Math.floor(a / B), Math.ceil(b / B))
      : S.minmax(a, b) || S.paires(0, Math.floor(a / H.b0), Math.ceil(b / H.b0));
    if (!r) continue;
    const yT = Math.floor(mid - r[1] * k), yB = Math.ceil(mid - r[0] * k);
    g.fillRect(x, yT, 1, Math.max(1, yB - yT));
  }
}

// l'onde d'attente : les pics de 01/10 (le pic de chaque 1/200 s, 0 à 255), symétrique
function ondePics(g, P, t0, t1, w, h, dpr) {
  const { bps, a } = P;
  const mid = h / 2;
  const parPx = ((t1 - t0) * bps) / w;
  for (let x = 0; x < w; x++) {
    const i0 = Math.floor((t0 * bps) + x * parPx);
    const i1 = Math.max(i0 + 1, Math.floor((t0 * bps) + (x + 1) * parPx));
    if (i1 <= 0 || i0 >= a.length) continue;
    let m = 0;
    for (let i = Math.max(0, i0); i < Math.min(a.length, i1); i++) if (a[i] > m) m = a[i];
    const y = Math.max(dpr * 0.5, (m / 255) * mid);
    g.fillRect(x, mid - y, 1, y * 2);
  }
}

// des pics bruts ({bps, a}) : dessinés tels quels
function dessinerPics(cv, P, { t0 = 0, t1 = null } = {}) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(cv.clientWidth * dpr));
  const h = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== w) cv.width = w;
  if (cv.height !== h) cv.height = h;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  const fin = t1 ?? P.a.length / P.bps;
  if (!(fin > t0) || !P.a.length) return;
  g.fillStyle = getComputedStyle(cv).color;
  ondePics(g, P, t0, fin, w, h, dpr);
}
