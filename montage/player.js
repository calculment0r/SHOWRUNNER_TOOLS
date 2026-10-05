// MONTAGE — la lecture dans la page : le moniteur programme (le
// montage, plusieurs médias pilotés par une seule horloge) et le
// moniteur source (le plan choisi dans le chutier).
//
// Le programme n'est pas une vidéo : chaque plan actif a son propre
// élément <video>, <img> ou <audio>, posé dans l'ordre des pistes (V1
// dessous). Une horloge (performance.now) donne le temps ; à chaque image
// d'affichage (requestAnimationFrame, MDN), on montre ce qui doit se voir
// à cet instant et on recale chaque média sur elle :
//   - les plans qui arrivent dans les 2 s sont chargés et arrêtés sur leur
//     première image (currentTime, MDN HTMLMediaElement), pour qu'une coupe
//     n'attende pas le réseau ;
//   - un média en avance ou en retard de plus d'une demi-image est
//     rattrapé en douceur par playbackRate (±8 %), au-delà de 0,3 s par un
//     saut (currentTime) — le même principe que le son du Studio de Movie
//     Analysis (son.js : recalage au-delà de 60 ms) ;
//   - l'opacité et le gain de chaque plan suivent `opacityAt`/`gainAt`
//     (model.js), le calcul même des filtres fade/afade de l'export.
// Le son passe par Web Audio (createMediaElementSource + GainNode, MDN)
// pour qu'un volume au-delà de 100 % s'entende comme à l'export.
//
// La vitesse d'un plan (`speed`) règle playbackRate (le son garde sa
// hauteur, preservesPitch vaut vrai par défaut, MDN — comme atempo à
// l'export) ; un plan désactivé ne se voit ni ne s'entend. Un plan qui a
// une LUT se dessine dans un canevas (lut.js : WebGL2, le calcul de lut3d),
// posé à la place de son élément, qui reste dessous comme source.

//
// Les effets (model.js, chainOf : ceux du plan, de sa piste, de son groupe)
// passent par lut.js (drawChain). Une chaîne dont une LUT se charge encore
// ne remplace pas celle qui se voit : l'image garde l'ancienne jusqu'à ce que
// la nouvelle soit prête, puis bascule d'un coup (plus de passage par
// l'image sans LUT). Un calque d'effet actif compose tout le programme dans
// un seul canevas (dans l'ordre des pistes, V1 d'abord, sur du noir comme
// l'export), y applique ses effets à l'endroit de sa piste, et montre ce
// canevas à la place des éléments.
//
// La copie de défilement (commun/defilement.js, la même que le lecteur
// commun ; 05/10) : chaque vidéo du programme et de la source a sa copie, une
// <video> muette posée juste après elle. À l'arrêt, quand la tête bouge (la
// règle, la barre sous le moniteur, les flèches), c'est la copie qui saute et
// qui se voit — une image clé toutes les 6 : l'image suit le geste —, puis
// l'originale se cale et reprend la place dès qu'elle montre la même image.
// Ce qui se voit d'un plan (`vu`) porte son opacité, son filtre, et sert de
// source au canevas des effets ; l'autre reste à 0.
//
// L'aperçu d'un geste de la timeline (`pv`, 06/10, Cal : « voir l'image changer
// EN DIRECT pendant le glisser ») : le programme montre un autre montage que
// celui de la page (`pv.p` : déplacer un plan, tel qu'il serait si l'on lâchait
// maintenant), à un autre instant que la tête (`pv.t`), un seul plan (`pv.seul` :
// le bord qu'on rogne, Alt maintenu, plein, sans fondu ni son — le mode Trim de
// Premiere). Un plan neuf du même média (le morceau d'un plan coupé, une
// copie) reprend l'élément d'un plan qui n'existe plus (`entry`) : rien ne se
// recharge en chemin, et la copie de défilement montre l'image (montage.js, apercu).
//
// La trajectoire d'un plan (06/10, model.js `cadre` : position, échelle, rotation,
// ancrage, opacité, recadrage) : son élément, sa copie de défilement et son canevas
// d'effets sont posés dans la scène (aux proportions de la séquence) par left, top,
// width, height en pour cent du cadre, `rotate` autour du centre de la part gardée,
// `clip-path: inset` pour le recadrage ; l'opacité multiplie celle des fondus. Le
// même calcul que l'export (server/tools/montage.py, `cadre`, `_placement`), qui ne
// pose que des pixels entiers : à un pixel près. Le programme composé (un calque
// d'effet) dessine la même géométrie dans son canevas. Pendant un geste (un rognage
// au moniteur, `pv.seul`), le plan se montre plein, comme avant.

import { href } from '../commun/shell.js';
import { windows, opacityAt, gainAt, audibleTracks, projectEnd, spd, isOn, chainOf, srcTime, cadre, motionOf } from './model.js';
import { getLut, lutFailed, lutGL, passesOf } from './lut.js';
// un saut ne s'empile jamais sur un saut en cours (commun/tete.js, mesuré le 30/09) :
// la tête glissée à l'arrêt, l'image suit au lieu d'attendre la fin du geste
import { sauter, cible } from '../commun/tete.js';
import { copieDefil } from '../commun/defilement.js';
// le son au défilement (06/10) : glisser la tête fait entendre le son sous elle, par grains (commun/scrub.js)
import { scrub as scrubSon, sonDefil, chargerSon } from '../commun/scrub.js';

// ce qui se voit d'une vidéo : l'originale, ou sa copie pendant qu'on cherche
const vu = (e) => (e.dfl && e.dfl.montre === 'nav' ? e.dfl.nav : e.el);
// l'opacité (et le filtre) d'un plan sur ce qui se voit ; l'autre à 0
function voir(e, op, filtre = null) {
  const v = vu(e);
  for (const m of [e.el, e.dfl?.nav]) {
    if (!m) continue;
    m.style.opacity = m === v ? String(op) : '0';
    if (filtre !== null) m.style.filter = m === v ? filtre : 'none';
  }
}
// La place d'un élément selon la trajectoire de son plan (`g` = cadre(), null : la mise
// en place d'avant, celle de .screen .layer). La boîte de l'élément est l'image source
// entière à son échelle ; le recadrage la découpe (clip-path, dans ses coordonnées,
// donc il tourne avec elle) ; la rotation se fait autour du centre de la part gardée.
const POSE = ['left', 'top', 'width', 'height', 'right', 'bottom', 'transform', 'transformOrigin', 'clipPath', 'objectFit'];
const pc = (v) => `${+(v * 100).toFixed(5)}%`;
function poser(m, g, sw, sh, W, H) {
  if (!m) return;
  const key = g ? [g.cx, g.cy, g.kx, g.ky, g.th, g.x0, g.x1, g.y0, g.y1, sw, sh, W, H].map((v) => v.toFixed(4)).join(',') : '';
  if (m._pose === key) return;
  m._pose = key;
  if (!g) { for (const k of POSE) m.style[k] = ''; return; }
  const mx = (g.x0 + g.x1) / 2, my = (g.y0 + g.y1) / 2;
  Object.assign(m.style, {
    left: pc((g.cx - mx * g.kx) / W), top: pc((g.cy - my * g.ky) / H), width: pc(sw * g.kx / W), height: pc(sh * g.ky / H),
    right: 'auto', bottom: 'auto', objectFit: 'fill', transformOrigin: `${pc(mx / sw)} ${pc(my / sh)}`,
    transform: Math.abs(g.th) > 1e-9 ? `rotate(${g.th}rad)` : '',
    clipPath: g.x0 > 0 || g.y0 > 0 || g.x1 < sw || g.y1 < sh ? `inset(${pc(g.y0 / sh)} ${pc(1 - g.x1 / sw)} ${pc(1 - g.y1 / sh)} ${pc(g.x0 / sw)})` : '',
  });
}

// la copie de défilement d'une vidéo (commun/defilement.js), posée juste après elle, comme elle
function copie(el, item, fps, again) {
  const d = copieDefil(el, item, { fps, montrer: again });
  if (d.nav) {
    d.nav.classList.add('layer', 'video');
    d.nav.style.opacity = '0';
    d.nav.addEventListener('seeked', again);
    d.nav.addEventListener('loadeddata', again);
    el.after(d.nav);
  }
  return d;
}

// la signature d'une chaîne : ce qui change l'image
const sigOf = (steps) => JSON.stringify(steps.map((f) => (f.type === 'lut' ? ['l', f.lut, f.mix] : ['g', f.exposure || 0, f.contrast || 0, f.saturation || 0, f.temperature || 6500])));

// ── étalonnage : l'aperçu par les filtres du navigateur ─────
// colortemperature de ffmpeg 6.1 mesuré sur DGX2 (28/09) : un blanc
// (255,255,255) devient ces valeurs RVB ; le filtre multiplie chaque
// canal (mesuré aussi sur des gris 64/128/192 : linéaire). L'aperçu pose
// la même matrice diagonale (feColorMatrix, en sRGB : l'export travaille
// sur les valeurs codées, pas en lumière linéaire).
const KLUT = [[2000, 255, 136, 13], [2500, 255, 159, 70], [3000, 255, 177, 109], [3500, 255, 192, 140],
  [4000, 255, 205, 166], [4500, 255, 217, 187], [5000, 255, 228, 205], [5500, 255, 237, 222],
  [6000, 255, 246, 236], [6500, 255, 254, 250], [7000, 242, 242, 255], [7500, 229, 234, 255],
  [8000, 221, 229, 255], [8500, 214, 225, 255], [9000, 209, 222, 255], [9500, 205, 220, 255],
  [10000, 201, 218, 255], [10500, 198, 216, 255], [11000, 195, 214, 255], [11500, 193, 212, 255],
  [12000, 191, 211, 255]];

export function tempGains(K) {
  K = Math.max(2000, Math.min(12000, K));
  let i = KLUT.findIndex((r) => r[0] >= K);
  if (i <= 0) i = 1;
  const [k0, ...a] = KLUT[i - 1], [k1, ...b] = KLUT[i];
  const u = (K - k0) / (k1 - k0);
  return a.map((v, j) => (v + (b[j] - v) * u) / 255);
}

const SVGNS = 'http://www.w3.org/2000/svg';
let svgDefs = null;
function tempFilter(K) {
  const k = Math.round(K / 50) * 50;
  const id = 'mtg-k' + k;
  if (!document.getElementById(id)) {
    if (!svgDefs) {
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
      svg.style.position = 'absolute';
      svgDefs = document.createElementNS(SVGNS, 'defs');
      svg.append(svgDefs);
      document.body.append(svg);
    }
    const [r, g, b] = tempGains(k);
    const f = document.createElementNS(SVGNS, 'filter');
    f.id = id;
    f.setAttribute('color-interpolation-filters', 'sRGB');   // MDN : linearRGB par défaut
    const m = document.createElementNS(SVGNS, 'feColorMatrix');
    m.setAttribute('type', 'matrix');
    m.setAttribute('values', `${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`);
    f.append(m);
    svgDefs.append(f);
  }
  return id;
}

// exposure (ffmpeg) multiplie les valeurs par 2^IL : brightness() fait de
// même ; eq contrast/saturation pivotent comme contrast()/saturate().
export function gradeCss(g) {
  if (!g) return 'none';
  const parts = [];
  if (g.exposure) parts.push(`brightness(${Math.pow(2, g.exposure).toFixed(4)})`);
  if (g.contrast) parts.push(`contrast(${(1 + g.contrast / 100).toFixed(4)})`);
  if (g.saturation) parts.push(`saturate(${(1 + g.saturation / 100).toFixed(4)})`);
  if (g.temperature && Math.abs(g.temperature - 6500) > 0.5) parts.push(`url(#${tempFilter(g.temperature)})`);
  return parts.join(' ') || 'none';
}

// ── le son ──────────────────────────────────────────────────
let AC = null;
const routed = new Set();
export function audio() {
  if (!AC) {
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { AC = null; }
    for (const e of routed) route(e);
  }
  if (AC && AC.state === 'suspended') AC.resume().catch(() => {});
  return AC;
}
function route(e) {
  routed.add(e);
  if (!AC || e.gain || e.tag === 'img') return;
  try {
    const s = AC.createMediaElementSource(e.el);
    e.gain = AC.createGain();
    s.connect(e.gain).connect(AC.destination);
    e.el.volume = 1;
  } catch { /* déjà relié : on garde volume */ }
}
function setGain(e, v) {
  if (e.tag === 'img') return;
  if (e.gain) { if (Math.abs(e.gain.gain.value - v) > 1e-3) e.gain.gain.value = v; }
  else e.el.volume = Math.max(0, Math.min(1, v));
}

// ── le programme ────────────────────────────────────────────
export class Program {
  constructor(stage, { getP, itemOf, onTick }) {
    this.stage = stage;
    this.getP = getP;
    this.itemOf = itemOf;
    this.onTick = onTick || (() => {});
    this.t = 0;
    this.playing = false;
    this.rate = 1;
    this.els = new Map();
    this.win = null;
    this.raf = 0;
    this.loop = this.loop.bind(this);
    this.son = scrubSon({ contexte: audio, sons: (t) => this.sons(t) });
  }

  get fps() { const p = this.getP(); return p ? p.settings.fps : 25; }
  duration() { const p = this.getP(); return p ? projectEnd(p) / this.fps : 0; }
  frame() { return Math.floor(this.t * this.fps + 1e-6); }

  // le montage a changé : les fenêtres se recalculent
  invalidate() { this.win = null; this.render(); }

  play(rate = 1) {
    audio();
    for (const e of this.els.values()) route(e);
    if (rate > 0 && this.t >= this.duration() - 1e-6) this.t = 0;
    this.rate = rate;
    this.playing = true;
    this.t0 = this.t;
    this.n0 = performance.now();
    // le départ : l'horloge attend que les médias sous la tête de lecture
    // jouent vraiment (play() rend la main avant la première image), puis
    // se cale sur eux — sinon ils partent avec 100 à 150 ms de retard.
    this.starting = rate > 0 ? performance.now() : 0;
    if (!this.raf) this.schedule();
    this.onTick(this.t, true);
  }

  // L'horloge bat au rythme de la fenêtre qui MONTRE le programme
  // (requestAnimationFrame de son document) : détaché sur un 2ᵉ écran
  // (commun/fenetre.js), il continue même si la page principale est
  // cachée (le navigateur suspend les images d'une fenêtre cachée : HTML,
  // « update the rendering »).
  schedule() {
    const w = this.stage.ownerDocument.defaultView || window;
    this.rafWin = w;
    this.raf = w.requestAnimationFrame(this.loop);
  }

  // le moniteur a changé de fenêtre : l'image demandée à l'ancienne ne viendra peut-être jamais
  moved() {
    if (this.raf && this.rafWin) { try { this.rafWin.cancelAnimationFrame(this.raf); } catch { /* fenêtre fermée */ } }
    this.raf = 0;
    if (this.playing) this.schedule(); else this.render();
  }

  pause() {
    this.playing = false;
    this.rate = 1;
    this.t = Math.round(this.t * this.fps) / this.fps;
    this.render();
    this.onTick(this.t, false);
  }

  toggle() { this.playing ? this.pause() : this.play(1); }

  // un geste sur la tête (la règle, la barre du moniteur) commence ou finit : pendant, les
  // copies de défilement restent devant ; au lâcher, les originales se calent. `son` : le son
  // au défilement suit la tête (faux pour un geste de la timeline qui ne la bouge pas : apercu)
  scrub(on, son = true) {
    this.geste = !!on;
    for (const e of this.els.values()) if (e.dfl) { if (on) e.dfl.debut(); else e.dfl.fin(); }
    if (on && son) { this.prechargerSons(); this.son.debut(); } else this.son.fin();
  }

  seek(t) {
    this.t = Math.max(0, Math.min(this.duration(), t));
    if (this.playing) { this.t0 = this.t; this.n0 = performance.now(); }
    else if (this.geste) this.son.aller(this.t);
    this.render();
    this.onTick(this.t, this.playing);
  }

  // ── le son au défilement (commun/scrub.js) ──
  // Ce qui s'entend à l'instant t, comme render le règle : les plans des pistes son et le
  // son des vidéos, muet et solo, fondus et volume, la vitesse du plan ; lus dans le son de
  // défilement de leur média (une copie mono, décodée une fois : server/tools/defilement.py).
  sons(t) {
    const p = this.getP();
    if (!p) return [];
    const fps = p.settings.fps, win = this.pv ? windows(p) : (this.win || (this.win = windows(p)));
    const hear = audibleTracks(p), kind = new Map(p.tracks.map((x) => [x.id, x.kind])), out = [];
    for (const c of p.clips) {
      const k = kind.get(c.track);
      if (!isOn(c) || !hear.has(c.track) || c.kind === 'image' || c.kind === 'adjust' || !(k === 'audio' || (k === 'video' && c.audio))) continue;
      const w = win.get(c.id);
      if (!w || t < w.ws / fps || t >= w.we / fps) continue;
      const buffer = sonDefil(this.itemOf(c.item));
      if (buffer) out.push({ buffer, at: srcTime(c, t, fps), gain: (c.vol ?? 1) * gainAt(w, t, fps), vitesse: spd(c) });
    }
    return out;
  }
  // les sons de la séquence, chargés d'avance (au survol de la règle, au début du geste)
  prechargerSons() {
    const p = this.getP();
    if (p) for (const c of p.clips) if (c.kind !== 'image' && c.kind !== 'adjust' && c.item) chargerSon(this.itemOf(c.item));
  }
  seekFrame(f) { this.seek(f / this.fps); }
  step(n) { if (this.playing) this.pause(); this.seekFrame(this.frame() + n); }

  loop() {
    this.raf = 0;
    if (!this.playing) return;
    if (this.starting) {
      this.render();
      const now = performance.now();
      const media = this.media || [];
      const ready = media.every(({ e }) => !e.el.paused && e.el.readyState >= 3 && e.el.currentTime > 0);
      if (!ready && now - this.starting < 600) { this.schedule(); return; }
      this.starting = 0;
      // le temps du montage que disent les médias partis : on prend le plus en retard
      const fps = this.fps;
      const said = media.filter(({ e }) => !e.el.paused).map(({ e, c }) => (e.el.currentTime - (c.in || 0)) / spd(c) + c.start / fps);
      if (said.length) this.t = Math.max(this.t, Math.min(...said));
      this.t0 = this.t;
      this.n0 = now;
    }
    let t = this.t0 + (performance.now() - this.n0) / 1000 * this.rate;
    const D = this.duration();
    if (t >= D || t <= 0) {
      this.t = Math.max(0, Math.min(D, t));
      this.pause();
      return;
    }
    this.t = t;
    this.render();
    this.onTick(t, true);
    this.schedule();
  }

  entry(c, track, ids = null) {
    const item = this.itemOf(c.item);
    if (!item || !item.url) return null;
    const tag = track.kind === 'video' ? (c.kind === 'image' ? 'img' : 'video') : 'audio';
    let e = this.els.get(c.id);
    if (e && (e.item !== item.id || e.tag !== tag)) { this.drop(c.id); e = null; }
    // un plan neuf du même média (un morceau coupé, une copie, l'aperçu d'un geste) : l'élément
    // d'un plan qui n'est plus dans le montage, déjà chargé, plutôt qu'un nouveau
    if (!e && ids) {
      for (const [k, x] of this.els) {
        if (ids.has(k) || x.item !== item.id || x.tag !== tag) continue;
        this.els.delete(k);
        this.els.set(c.id, x);
        e = x;
        break;
      }
    }
    if (!e) {
      const el = document.createElement(tag);
      el.className = 'layer ' + tag;
      el.draggable = false;
      if (tag !== 'img') { el.preload = 'auto'; el.playsInline = true; }
      el.src = href(item.url);
      el.style.opacity = '0';
      this.stage.append(el);
      e = { el, tag, item: item.id, dur: item.duration || 0, idle: 0 };
      // une image arrêtée qui change (recherche, chargement, l'originale qui reprend la place de
      // sa copie) : le canevas LUT se redessine
      const again = () => { e.drawn = ''; if (!this.playing) this.render(); };
      el.addEventListener(tag === 'img' ? 'load' : 'seeked', again);
      if (tag === 'video') { el.addEventListener('loadeddata', again); e.dfl = copie(el, item, item.fps || this.fps, again); }
      route(e);
      this.els.set(c.id, e);
    }
    return e;
  }

  // La taille de l'image d'un plan telle qu'elle se décode (celle de son élément ; avant
  // qu'il soit chargé, celle de l'objet de la bibliothèque), ou null.
  dims(c) {
    const e = this.els.get(c.id);
    if (e && e.tag === 'img' && e.el.naturalWidth) return [e.el.naturalWidth, e.el.naturalHeight];
    if (e && e.tag === 'video' && e.el.videoWidth) return [e.el.videoWidth, e.el.videoHeight];
    const it = this.itemOf(c.item);
    return it && it.width > 0 && it.height > 0 ? [it.width, it.height] : null;
  }
  // Où se pose l'image d'un plan dans le cadre (model.js, cadre), ou null tant que sa taille
  // n'est pas connue. `p` : le montage (celui de la page par défaut).
  geometry(c, p = this.getP()) {
    const d = p && this.dims(c);
    if (!d) return null;
    const g = cadre(motionOf(c), p.settings.width || 1920, p.settings.height || 1080, d[0], d[1]);
    g.sw = d[0]; g.sh = d[1];
    return g;
  }
  // l'élément, sa copie, son canevas d'effets : à la place de la trajectoire
  pose(e, g, p) {
    const W = p.settings.width || 1920, H = p.settings.height || 1080;
    for (const m of [e.el, e.dfl?.nav, e.cv]) poser(m, g, g ? g.sw : 0, g ? g.sh : 0, W, H);
  }

  // La chaîne prête d'un plan (ou d'un calque) : ses passes, quand toutes ses
  // LUT sont chargées. Tant qu'une LUT se charge, c'est la chaîne d'avant qui
  // reste (`hold.ready`) : l'image ne repasse jamais par « sans LUT ».
  chainReady(hold, steps) {
    const sig = sigOf(steps);
    if (hold.ready && hold.ready.sig === sig) return hold.ready;
    const luts = new Map();
    let pending = false;
    const cb = hold.waiting === sig ? null : () => { if (!this.playing) this.render(); };   // un rappel par chaîne attendue
    for (const f of steps) {
      if (f.type !== 'lut' || !(f.mix > 0)) continue;
      const l = getLut(f.lut, cb);
      if (l) luts.set(f.lut, l);
      else if (!lutFailed(f.lut)) pending = true;
    }
    if (pending) { hold.waiting = sig; return hold.ready || null; }
    hold.waiting = null;
    hold.ready = { sig, empty: !steps.length, passes: passesOf(steps, luts, tempGains) };
    return hold.ready;
  }

  // Le canevas d'un plan qui a des effets : la source passée par la chaîne,
  // à la taille de la source (1920 px de large au plus).
  paintChain(e, ready) {
    // la source : ce qui se voit (la copie pendant qu'on cherche) ; la taille : celle de l'originale
    const src = vu(e), o = e.el;
    const vw = e.tag === 'img' ? o.naturalWidth : (o.videoWidth || src.videoWidth), vh = e.tag === 'img' ? o.naturalHeight : (o.videoHeight || src.videoHeight);
    if (!vw || !vh || (e.tag === 'video' && src.readyState < 2)) return;
    const s = Math.min(1, 1920 / vw);
    const w = Math.max(2, Math.round(vw * s)), h = Math.max(2, Math.round(vh * s));
    const key = `${e.tag === 'img' ? 0 : `${src === o ? 'o' : 'c'}${src.currentTime}`}|${ready.sig}|${w}`;
    if (!this.playing && e.drawn === key) return;
    const gl = lutGL();
    if (!gl.ok) return;
    if (!gl.drawChain(src, w, h, ready.passes)) return;
    if (e.cv.width !== w || e.cv.height !== h) { e.cv.width = w; e.cv.height = h; }
    e.ctx.clearRect(0, 0, w, h);
    e.ctx.drawImage(gl.cv, 0, 0);
    e.drawn = key;
    e.shown = ready.sig;
  }

  // Le programme composé (un calque d'effet est actif) : les couches du bas
  // vers le haut, cadrées comme l'export (contenues, centrées), sur du noir ;
  // un calque applique ses effets à ce qui est déjà posé, mêlé selon son fondu.
  compose(layers) {
    const p = (this.pv && this.pv.p) || this.getP();
    const W = p.settings.width || 1920, H = p.settings.height || 1080;
    const s = Math.min(1, 1920 / W);
    const w = Math.max(2, Math.round(W * s)), h = Math.max(2, Math.round(H * s));
    if (!this.comp) {
      this.comp = document.createElement('canvas');
      this.comp.className = 'layer comp';
      this.cctx = this.comp.getContext('2d');
      this.stage.append(this.comp);
    }
    const cv = this.comp, ctx = this.cctx;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; this.black = null; }
    if (!this.black) {                     // le fond : du noir opaque (0, 0, 0), celui de `color=c=black` à l'export
      const d = new ImageData(w, h);
      for (let i = 3; i < d.data.length; i += 4) d.data[i] = 255;
      this.black = d;
    }
    ctx.globalAlpha = 1;
    ctx.putImageData(this.black, 0, 0);
    const gl = lutGL();
    for (const L of layers) {
      if (L.op <= 0) continue;
      if (L.adj) {
        if (!gl.ok || !gl.drawChain(cv, w, h, L.ready.passes)) continue;
        ctx.globalAlpha = L.op;
        ctx.drawImage(gl.cv, 0, 0);
        continue;
      }
      const el = vu(L.e);
      const src = L.e.cv && L.e.shown ? L.e.cv : el;
      const vw = L.e.tag === 'img' ? el.naturalWidth : el.videoWidth, vh = L.e.tag === 'img' ? el.naturalHeight : el.videoHeight;
      if (!vw || !vh || (L.e.tag === 'video' && el.readyState < 2)) continue;
      ctx.globalAlpha = L.op;
      ctx.filter = src === el ? (L.css || 'none') : 'none';
      if (L.g) {
        // la trajectoire : la part gardée de la source, centrée sur son centre dans le cadre, tournée
        const g = L.g, s = w / W, rx = (src === el ? vw : src.width) / g.sw, ry = (src === el ? vh : src.height) / g.sh;
        ctx.save();
        ctx.translate(g.cx * s, g.cy * s);
        ctx.rotate(g.th);
        ctx.drawImage(src, g.x0 * rx, g.y0 * ry, (g.x1 - g.x0) * rx, (g.y1 - g.y0) * ry, -g.dw * s / 2, -g.dh * s / 2, g.dw * s, g.dh * s);
        ctx.restore();
      } else {
        const k = Math.min(w / vw, h / vh), dw = vw * k, dh = vh * k;
        ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
      }
      ctx.filter = 'none';
    }
    ctx.globalAlpha = 1;
  }

  lutLayer(e, on) {
    if (on && !e.cv) {
      e.cv = document.createElement('canvas');
      e.cv.className = 'layer lut';
      e.ctx = e.cv.getContext('2d');
      e.el.after(e.cv);
      e.drawn = '';
      e.shown = null;
    } else if (!on && e.cv) { e.cv.remove(); e.cv = null; e.ctx = null; e.shown = null; }
  }

  drop(id) {
    const e = this.els.get(id);
    if (!e) return;
    if (e.dfl) e.dfl.detruire();
    try { e.el.pause(); } catch { /* */ }
    e.el.removeAttribute('src');
    if (e.tag !== 'img') e.el.load();
    e.el.remove();
    if (e.cv) e.cv.remove();
    routed.delete(e);
    this.els.delete(id);
  }

  clear() { for (const id of [...this.els.keys()]) this.drop(id); }

  render() {
    const pv = this.pv;                      // l'aperçu d'un geste de la timeline (en tête de ce fichier)
    const p = (pv && pv.p) || this.getP();
    if (!p) return;
    const fps = p.settings.fps;
    if (!this.win) this.win = windows(p);
    const t = pv && pv.t !== undefined && pv.t !== null ? pv.t : this.t, frame = Math.floor(t * fps + 1e-6);
    const seul = (pv && pv.seul) || null;
    const ids = new Set(p.clips.map((c) => c.id));
    const hear = audibleTracks(p);
    const hidden = new Set(p.tracks.filter((x) => x.hide).map((x) => x.id));
    const fwd = this.playing && this.rate > 0;
    // l'image du bas vers le haut (V1 d'abord, les calques à leur place), puis le son
    const order = [...p.tracks.filter((x) => x.kind !== 'audio').reverse(), ...p.tracks.filter((x) => x.kind === 'audio')];
    const need = new Set();
    const media = [];
    const layers = [];
    let adjOn = false;
    let z = 1;
    const now = performance.now();
    const gl = lutGL();
    this.adjHold = this.adjHold || new Map();
    this.visible = [];
    for (const track of order) {
      const clips = p.clips.filter((c) => c.track === track.id && isOn(c)).sort((a, b) => a.start - b.start);
      if (track.kind === 'fx') {
        // un calque d'effet actif (piste non coupée, chaîne prête) : le programme sera composé
        if (track.hide || !gl.ok || seul) continue;
        for (const c of clips) {
          const w = this.win.get(c.id);
          if (!w || frame < w.ws || frame >= w.we) continue;
          if (!this.adjHold.has(c.id)) this.adjHold.set(c.id, {});
          const ready = this.chainReady(this.adjHold.get(c.id), chainOf(p, c));
          if (!ready || ready.empty) continue;
          layers.push({ adj: true, c, op: opacityAt(w, frame), ready });
          adjOn = true;
        }
        continue;
      }
      for (const c of clips) {
        if (seul && c.id !== seul) continue;
        const w = this.win.get(c.id);
        if (!w) continue;
        const a = w.ws / fps, b = w.we / fps;
        const active = t >= a && t < b;
        const soon = fwd && t < a && a - t < 2;
        if (!active && !soon) continue;
        const e = this.entry(c, track, ids);
        if (!e) continue;
        need.add(c.id);
        e.idle = 0;
        e.el.style.zIndex = String(z++);
        const sp = spd(c);
        const target = (c.in || 0) + ((active ? t : a) - c.start / fps) * sp;
        // des effets (chaîne prête) : le canevas se montre, l'élément reste dessous comme source ;
        // sans WebGL2, l'étalonnage seul passe par les filtres CSS
        const steps = e.tag !== 'audio' ? chainOf(p, c) : [];
        const ready = steps.length && gl.ok ? this.chainReady(e, steps) : null;
        const lut = ready && !ready.empty ? ready : null;
        e.css = !gl.ok ? steps.filter((f) => f.type === 'grade').map(gradeCss).filter((x) => x !== 'none').join(' ') || 'none' : 'none';
        this.lutLayer(e, !!lut);
        // la trajectoire (pas pendant le rognage d'un bord : le plan seul et plein) ; sa taille pas encore
        // connue, le plan attend caché plutôt que de se montrer un instant plein cadre
        const mo = e.tag !== 'audio' && !seul && !!c.motion;
        const g = mo ? this.geometry(c, p) : null;
        this.pose(e, g, p);
        const mop = !mo ? 1 : g && g.vis ? g.op : 0;
        if (e.cv) e.cv.style.zIndex = e.el.style.zIndex;
        if (e.dfl?.nav) e.dfl.nav.style.zIndex = e.el.style.zIndex;
        if (!active) {                      // en attente : arrêté sur sa première image
          if (e.tag !== 'img') {
            if (!e.el.paused) e.el.pause();
            const want = Math.max(0, target) + 0.001;
            if (Math.abs(cible(e.el) - want) > 0.05) sauter(e.el, want);
          }
          voir(e, 0);
          if (e.cv) e.cv.style.opacity = '0';
          setGain(e, 0);
          continue;
        }
        if (e.tag !== 'audio') {
          const op = (seul ? 1 : hidden.has(track.id) ? 0 : opacityAt(w, frame)) * mop;
          if (e.cv) {
            voir(e, 0, 'none');
            e.cv.style.opacity = String(op);
          } else voir(e, op, e.css);
          if (op > 0) { this.visible.push(c); layers.push({ e, c, op, css: e.css, g }); }
        }
        const sound = !seul && hear.has(track.id) && (track.kind === 'audio' || c.audio) && c.kind !== 'image';
        setGain(e, sound ? (c.vol ?? 1) * gainAt(w, t, fps) : 0);
        if (e.tag !== 'img') {
          this.sync(e, target, fwd, fps, sp);
          if (target >= 0 && (!e.dur || target < e.dur - 0.05)) media.push({ e, c });
        }
        if (e.cv && lut) this.paintChain(e, lut);
      }
    }
    // un calque d'effet actif : tout se compose dans un canevas, les éléments restent dessous comme sources
    if (adjOn) {
      this.compose(layers);
      this.comp.style.opacity = '1';
      for (const L of layers) if (!L.adj) { voir(L.e, 0); if (L.e.cv) L.e.cv.style.opacity = '0'; }
    } else if (this.comp) this.comp.style.opacity = '0';
    this.composed = adjOn;
    this.media = media;
    for (const [id, e] of this.els) {
      if (need.has(id)) continue;
      if (e.tag !== 'img' && !e.el.paused) e.el.pause();
      voir(e, 0);
      if (e.cv) e.cv.style.opacity = '0';
      setGain(e, 0);
      if (!e.idle) e.idle = now;
      else if (now - e.idle > 8000) this.drop(id);
    }
  }

  sync(e, target, fwd, fps, sp = 1) {
    const el = e.el, dfl = e.dfl;
    const D = e.dur || (isFinite(el.duration) ? el.duration : 0);
    const hi = D ? D - 0.5 / fps : Infinity;
    const outside = target < 0 || target > hi;     // tête ou queue figée d'un fondu enchaîné
    const want = Math.max(0, Math.min(hi, target));
    // playbackRate : 1/16 à 16 dans Chromium (au-delà : NotSupportedError)
    const rate = Math.max(0.0625, Math.min(16, this.rate * sp));
    if (fwd && !outside) {
      if (dfl) dfl.lire();               // la copie, si elle se voyait, laisse la place dès que l'originale joue
      if (el.paused) {
        if (Math.abs(cible(el) - want) > 0.03) sauter(el, want);
        el.playbackRate = rate;
        el.play().catch(() => {});
        return;
      }
      const drift = el.currentTime - want;
      if (Math.abs(drift) > 0.3 * sp) { sauter(el, want); el.playbackRate = rate; }
      else if (Math.abs(drift) > 0.5 / fps * sp) el.playbackRate = Math.max(0.0625, Math.min(16, rate * (1 - Math.max(-0.08, Math.min(0.08, drift * 2 / sp)))));
      else if (el.playbackRate !== rate) el.playbackRate = rate;
      return;
    }
    if (!el.paused) el.pause();
    const at = want + (outside ? 0 : 0.001);       // + 1 ms : l'image qui commence à cet instant, pas la précédente
    // à l'arrêt (et à rebours) : la copie de défilement saute, l'originale se cale ensuite (commun/defilement.js)
    if (dfl) {
      dfl.arret();
      const g = this.geste || (this.playing && this.rate < 0);
      if (Math.abs(dfl.cible() - at) > 0.3 / fps && el.readyState >= 1) dfl.aller(at, { geste: g });
      else if (!g) dfl.repos();
      return;
    }
    if (Math.abs(cible(el) - at) > 0.3 / fps && el.readyState >= 1) sauter(el, at);
  }
}

// ── la source ───────────────────────────────────────────────
// Un seul média, sa lecture native ; J/K/L et l'image par image se
// règlent sur sa propre cadence (celle de l'objet, sinon celle du projet).
export class Source {
  constructor(box, { onTick, fpsOf }) {
    this.box = box;
    this.onTick = onTick || (() => {});
    this.fpsOf = fpsOf || (() => 25);
    this.item = null;
    this.el = null;
    this.in = 0;
    this.out = 0;
    this.rate = 0;
    this.rev = 0;
    // le son au défilement : le son de l'objet à la tête de la source (commun/scrub.js)
    this.son = scrubSon({ contexte: audio, sons: (t) => { const b = this.item && sonDefil(this.item); return b ? [{ buffer: b, at: t }] : []; } });
  }

  get fps() { return (this.item && this.item.fps) || this.fpsOf(); }
  get duration() { return this.item ? (this.item.kind === 'image' ? 0 : (this.item.duration || (this.el && this.el.duration) || 0)) : 0; }
  // le temps de la source : là où va l'image qui se voit (la copie de défilement pendant qu'on cherche)
  get t() { return this.el && this.item && this.item.kind !== 'image' ? (this.dfl ? this.dfl.cible() : this.el.currentTime) : 0; }
  get playing() { return !!(this.el && this.item && this.item.kind !== 'image' && (!this.el.paused || this.rev)); }

  load(item, { in: tin = 0, out = null, at = null } = {}) {
    this.stop();
    if (this.el) { try { this.el.pause(); } catch { /* */ } this.el.remove(); }
    if (this.dfl) { this.dfl.detruire(); this.dfl = null; }
    this.item = item;
    this.el = null;
    this.box.querySelector('.empty')?.toggleAttribute('hidden', !!item);
    if (!item) { this.onTick(); return; }
    const tag = item.kind === 'image' ? 'img' : item.kind === 'audio' ? 'audio' : 'video';
    const el = document.createElement(tag);
    el.className = 'layer ' + tag;
    el.draggable = false;
    if (tag !== 'img') { el.preload = 'auto'; el.playsInline = true; }
    el.src = href(item.url);
    this.box.append(el);
    this.el = el;
    this.in = tin;
    this.out = out ?? (item.duration || 0);
    if (tag === 'video') {
      // la copie de défilement (commun/defilement.js) : par-dessus, opaque seulement pendant qu'on cherche
      const montrer = (qui) => { if (d.nav) d.nav.style.opacity = qui === 'nav' ? '1' : '0'; this.onTick(); };
      const d = copieDefil(el, item, { fps: this.fps, montrer });
      if (d.nav) { d.nav.classList.add('layer', 'video'); d.nav.style.opacity = '0'; el.after(d.nav); }
      this.dfl = d;
    }
    if (tag !== 'img') {
      el.addEventListener('timeupdate', () => this.onTick());
      el.addEventListener('seeked', () => this.onTick());
      el.addEventListener('pause', () => { if (this.dfl) this.dfl.arret(); this.onTick(); });
      el.addEventListener('play', () => this.tick());
      el.addEventListener('loadedmetadata', () => {
        if (!this.out) this.out = el.duration || 0;
        if (at !== null || tin) el.currentTime = at !== null ? at : tin;   // `at` : concordance des images (F)
        this.onTick();
      }, { once: true });
    }
    this.onTick();
  }

  tick() {
    if (!this.el || this.el.paused) return;
    this.onTick();
    const w = this.box.ownerDocument.defaultView || window;   // la fenêtre qui montre la source (commun/fenetre.js)
    if (this.tk && this.tkWin) { try { this.tkWin.cancelAnimationFrame(this.tk); } catch { /* */ } }
    this.tkWin = w;
    this.tk = w.requestAnimationFrame(() => { this.tk = 0; this.tick(); });
  }
  moved() { this.tick(); }

  stop() { clearInterval(this.rev); this.rev = 0; this.rate = 0; }

  // un geste sur la tête de la source (sa barre) commence ou finit (la copie de défilement, le son)
  scrub(on) {
    this.geste = !!on;
    if (this.dfl) { if (on) this.dfl.debut(); else this.dfl.fin(); }
    if (on) { this.prechargerSons(); this.son.debut(); } else this.son.fin();
  }
  prechargerSons() { if (this.item) chargerSon(this.item); }

  // aller à t (s) : la copie de défilement si elle est prête, l'originale sinon
  go(t, geste = false) {
    if (this.dfl) this.dfl.aller(t, { geste: geste || this.geste }); else sauter(this.el, t);
  }

  play(rate = 1) {
    if (!this.el || this.item.kind === 'image') return;
    audio();
    this.stop();
    this.rate = rate;
    if (rate < 0) {
      this.el.pause();
      if (this.dfl) this.dfl.arret();
      this.rev = setInterval(() => {
        const t = this.t + rate / 30;
        if (t <= 0) { this.go(0, true); this.stop(); this.dfl?.repos(); }
        else this.go(t, true);
        this.onTick();
      }, 1000 / 30);
      this.onTick();
      return;
    }
    const at = this.t;
    if (this.el.ended || at >= this.duration - 0.05) sauter(this.el, this.in || 0);
    else if (Math.abs(cible(this.el) - at) > 0.5 / this.fps) sauter(this.el, at);   // l'originale part d'où la copie montrait
    this.el.playbackRate = rate;
    if (this.dfl) this.dfl.lire();
    this.el.play().catch(() => {});
  }

  pause() {
    this.stop();
    if (this.el && this.el.pause) this.el.pause();
    if (this.dfl) { this.dfl.arret(); this.dfl.repos(); }
    this.onTick();
  }
  toggle() { this.playing ? this.pause() : this.play(1); }
  seek(t) {
    if (!this.el || this.item.kind === 'image') return;
    const at = Math.max(0, Math.min(this.duration, t));
    this.go(at);
    if (this.geste && !this.playing) this.son.aller(at);
    this.onTick();
  }
  step(n) { if (!this.el || this.item.kind === 'image') return; this.pause(); this.seek(this.t + n / this.fps); }
  markIn() { if (!this.item || this.item.kind === 'image') return; this.in = Math.min(this.t, Math.max(0, this.out - 1 / this.fps)); this.onTick(); }
  markOut() { if (!this.item || this.item.kind === 'image') return; this.out = Math.max(this.t, this.in + 1 / this.fps); this.onTick(); }
  clearIn() { if (this.item) { this.in = 0; this.onTick(); } }
  clearOut() { if (this.item) { this.out = this.duration; this.onTick(); } }
}
