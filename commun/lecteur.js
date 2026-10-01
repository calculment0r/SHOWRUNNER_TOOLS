// LE lecteur du portail : une vidéo ou un son, dans le thème, sans les
// contrôles du navigateur (Cal, 30/09 : « ce player il vient d'où car il
// n'est pas dans le thème de notre interface… je voudrais un player avec la
// cue dont on vient de parler, jouable ? »).
//
//   l'écran      la vidéo remplit le cadre (contain) dès l'ouverture : la
//                taille vient du cadre, jamais de l'affiche (HTML : tant qu'une
//                <video> montre son affiche, sa taille naturelle est celle de
//                l'affiche — la vignette de 384 px de la bibliothèque : d'où la
//                petite image au milieu du grand cadre noir)
//   la frise     la règle des temps et LA tête de lecture du Montage
//                (commun/tete.js) ; sous la règle : la bande des images (une
//                vidéo) ou l'onde du son (api/son/apercu, un masque peint par
//                un jeton, le joué plus soutenu) ; la page y ajoute ses pistes
//                (`piste(nœud)` : les répliques de Transcrire…)
//   les gestes   clic, glisser sur la frise : la tête et l'image suivent ;
//                molette commune (commun/molette.js : Alt = zoom sous le
//                pointeur, Maj = le temps) ; le clavier du Montage : Espace,
//                J K L (arrière, arrêt, avant ; répétés : ×2, ×4, ×8), ← →
//                une image (Maj : une seconde), Début, Fin
//   la barre     lecture, le timecode (HH:MM:SS:FF), la boucle, le son, le
//                plein écran du lecteur (Échap pour sortir)
//
// Le défilement (Cal : « quand je déplace la cue il n'affiche pas trop
// rapidement l'update ») : une vidéo rendue n'a souvent qu'une image clé pour
// 10 s — chaque saut décode depuis le début (850 ms au milieu, mesuré le 30/09
// dans Chromium). Pendant qu'on déplace la tête, le lecteur montre la COPIE DE
// DÉFILEMENT de la vidéo (server/tools/defilement.py : une image clé toutes les
// 6, 960 px, calculée une fois par ffmpeg) : en glissant, l'image suit en une
// image d'écran (17 ms au milieu comme à 95 %, 90 images vues pour 90
// mouvements, mesuré de la même façon). L'originale se cale derrière ; quand elle
// montre la même image (requestVideoFrameCallback, MDN : « when a new video
// frame is sent to the compositor » — sinon `seeked`), elle reprend la place,
// en pleine définition, sans saut. Un saut ne s'empile jamais sur un saut en
// cours (commun/tete.js, `sauter`). `fastSeek` (MDN : « quickly seeks […] with
// precision tradeoff ») n'est pas dans Chromium, et l'image doit être juste :
// on ne s'en sert pas.
//
//   const L = lecteur(it, { clavier: 'page', sur, onTemps(t, lecture) })
//   box.append(L.el) ; L.seek(t) ; L.play() ; L.pause() ; L.toggle() ; L.step(n)
//   L.piste(nœud) ; L.t ; L.duree ; L.etat() ; L.detruire()

import { el, href, api } from './shell.js';
import { tete, poser, suivre, peindreRegle, brancherRegle, sauter, cible, tc } from './tete.js';
import { brancher } from './molette.js';
import { permis } from './pleinecran.js';
import { pickView } from './proxies.js';

if (typeof document !== 'undefined' && !document.querySelector('link[data-sr-lecteur]')) {
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./lecteur.css', import.meta.url).href, 'data-sr-lecteur': '' }));
}

const ICON = {
  full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  unfull: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  son: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
  muet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>',
  boucle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3l3 3-3 3"/><path d="M4 12V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3"/><path d="M20 12v3a3 3 0 0 1-3 3H4"/></svg>',
};
const MAX_PPS = 800;
const PISTE_H = { video: 34, audio: 120 };
const SON = 'sr-lecteur-son';
const lireSon = () => { try { return JSON.parse(localStorage.getItem(SON) || 'null') || { vol: 1, muet: false }; } catch { return { vol: 1, muet: false }; } };
const garderSon = (s) => { try { localStorage.setItem(SON, JSON.stringify(s)); } catch { /* stockage fermé */ } };
const champ = (t) => t && t.closest && t.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');

// Au survol d'une vignette vidéo (le fil, la planche d'Idéation) : la lecture AVEC le son
// (Cal, 01/10), au volume et au « muet » du lecteur. Le navigateur ne permet le son sans
// geste qu'après une première interaction avec la page (MDN, « Autoplay guide for media and
// Web Audio APIs » ; Chrome, « Autoplay policy ») : avant, la lecture refusée repart muette.
export function survolSon(v) {
  const son = lireSon();
  v.volume = Math.max(0, Math.min(1, +son.vol || 0));
  v.muted = !!son.muet || !(navigator.userActivation?.hasBeenActive ?? true);
  v.play().catch(() => { if (!v.muted) { v.muted = true; v.play().catch(() => {}); } });
}

// Le PETIT lecteur, pour un son dans une liste (une version, une voix) : lecture / pause,
// le curseur du thème (commun/curseur.css), le temps. Jamais les contrôles du navigateur.
// Un seul petit lecteur joue à la fois.
let petitEnCours = null;
export function petitLecteur(url, { duree = 0, titre = '' } = {}) {
  const a = el('audio', { preload: 'none' });
  a.src = href(url);
  const son = lireSon();
  a.volume = Math.max(0, Math.min(1, +son.vol || 0));
  a.muted = !!son.muet;
  const b = el('button', { class: 'tb ghost sm sr-mini-lire', type: 'button', title: titre ? `écouter « ${titre} »` : 'écouter', 'aria-label': 'lecture' }, '▶');
  const r = el('input', { type: 'range', min: '0', max: '1000', step: '1', value: '0', 'aria-label': 'position' });
  const t = el('span', { class: 'lbl sr-mini-t' }, fmt(0, duree));
  function fmt(s, d) { const m = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`; return d ? `${m(s)} / ${m(d)}` : m(s); }
  const d = () => (Number.isFinite(a.duration) && a.duration > 0 ? a.duration : duree);
  let tient = false;
  const peindre = () => {
    if (!tient && d()) r.value = String(Math.round((a.currentTime / d()) * 1000));
    t.textContent = fmt(a.currentTime, d());
    b.textContent = a.paused ? '▶' : '❚❚';
    b.setAttribute('aria-label', a.paused ? 'lecture' : 'pause');
  };
  b.addEventListener('click', () => {
    if (a.paused) {
      if (petitEnCours && petitEnCours !== a) petitEnCours.pause();
      petitEnCours = a;
      a.play().catch(() => {});
    } else a.pause();
  });
  r.addEventListener('input', () => { tient = true; if (d()) { a.currentTime = (Number(r.value) / 1000) * d(); peindre(); } });
  r.addEventListener('change', () => { tient = false; });
  for (const ev of ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata']) a.addEventListener(ev, peindre);
  return el('div', { class: 'sr-mini' }, b, r, t, a);
}

export function lecteur(it, { clavier = 'page', sur = null, onTemps = null, fps: fpsDit = null, defilement = true } = {}) {
  const kind = it.kind === 'audio' ? 'audio' : 'video';
  const fps = fpsDit || it.fps || 25;
  const S = { t: 0, lecture: false, rate: 0, rev: 0, pps: 0, fit: true, boucle: false, defile: false, geste: false,
    nav: null, navEtat: kind === 'video' && defilement ? 'attente' : 'sans', montre: 'source', raf: 0, cale: 0, fini: false };
  const son = lireSon();

  // ── les médias ──
  const src = el(kind, { class: 'sr-lect-src', preload: 'auto', playsinline: true, draggable: false });
  src.src = href(it.url);
  src.volume = Math.max(0, Math.min(1, son.vol));
  src.muted = !!son.muet;
  const nav = kind === 'video' ? el('video', { class: 'sr-lect-nav', preload: 'auto', playsinline: true, muted: true, draggable: false }) : null;
  if (nav) nav.muted = true;
  // l'image d'attente : la copie d'affichage de l'affiche, dans le cadre, le temps que la vidéo arrive
  let attente = null;
  if (kind === 'video' && (it.view_urls || it.thumb_url)) {
    const v = pickView(it, 1024);
    if (v && v.url) attente = el('img', { class: 'sr-lect-attente', src: v.url, alt: '', decoding: 'async' });
  }
  const sous = el('div', { class: 'sr-lect-sur' });
  if (sur) sous.append(sur);
  const ecran = kind === 'video' ? el('div', { class: 'sr-lect-ecran', title: 'clic : lecture · pause · double-clic : plein écran' },
    attente, src, nav, sous) : null;

  // ── la barre ──
  const bLire = el('button', { class: 'tb sm sr-lect-lire', type: 'button', title: 'lecture · pause (Espace) · J K L : arrière, arrêt, avant' }, 'Lecture');
  const tcNow = el('b', {}, tc(0, fps));
  const tcDur = el('small', {}, '/ ' + tc(Math.round((it.duration || 0) * fps), fps));
  const etat = el('span', { class: 'lbl sr-lect-etat' }, 'arrêt');
  const bBoucle = el('button', { class: 'tb ghost sm sr-lect-ic', type: 'button', html: ICON.boucle, title: 'boucle : repartir du début à la fin', 'aria-pressed': 'false' });
  const bSon = el('button', { class: 'tb ghost sm sr-lect-ic', type: 'button', title: 'couper le son' });
  const vol = el('input', { class: 'sr-lect-vol', type: 'range', min: '0', max: '1', step: '0.01', value: String(src.volume), 'aria-label': 'volume' });
  const defil = el('span', { class: 'lbl sr-lect-dfl' });
  const bFull = el('button', { class: 'tb ghost sm sr-lect-ic', type: 'button' });
  const barre = el('div', { class: 'sr-lect-barre' },
    bLire, el('span', { class: 'timecode sr-lect-tc' }, tcNow, tcDur), etat, el('span', { class: 'sp' }), defil,
    bBoucle, bSon, vol, bFull);

  // ── la frise ──
  const ticks = el('div', { class: 'sr-lect-ticks' });
  const regle = el('div', { class: 'sr-lect-regle', title: 'clic, glisser : la tête de lecture · Alt + molette : zoom · Maj + molette : le temps' }, ticks);
  const bande = el('div', { class: `sr-lect-piste sr-lect-${kind}`, style: { height: PISTE_H[kind] + 'px' } });
  let joue = null;
  if (kind === 'audio') {
    const u = `url("${href(`api/son/apercu/${it.id}?v=1`)}")`;
    const onde = (cls) => { const n = el('i', { class: 'sr-lect-onde ' + cls }); Object.assign(n.style, { maskImage: u, webkitMaskImage: u }); return n; };
    joue = onde('joue');
    bande.append(onde('fond'), joue);
  } else if (it.thumb_url) {
    bande.style.backgroundImage = `url("${href(it.thumb_url)}")`;
  }
  const ph = tete({ z: 4 });
  const dedans = el('div', { class: 'sr-lect-in' }, regle, bande, ph);
  const defile = el('div', { class: 'sr-lect-defile' }, dedans);
  const frise = el('div', { class: 'sr-lect-frise' }, defile);
  const root = el('div', { class: `sr-lect ${kind}`, tabindex: '0', 'data-kind': kind, 'aria-label': `lecteur · ${it.title || it.id}` }, ecran, barre, frise);

  // ── le temps ──
  const D = () => (isFinite(src.duration) && src.duration) || it.duration || 0;
  const imageDe = (t) => Math.floor(t * fps + 1e-6);
  // la cible d'un saut : le début de l'image + 1 ms (l'image qui commence là, pas la précédente — le Montage)
  const viser = (t) => Math.max(0, Math.min(D() - 0.5 / fps, imageDe(t) / fps + 0.001));
  const pps = () => S.pps || 1;
  const xDe = (t) => t * pps();

  function peindre() {
    const d = D();
    const t = S.t;
    tcNow.textContent = tc(imageDe(t), fps);
    tcDur.textContent = '/ ' + tc(Math.round(d * fps), fps);
    const x = poser(ph, xDe(t));
    if (S.lecture) suivre(defile, x);
    if (joue) joue.style.clipPath = `inset(0 ${Math.max(0, dedans.clientWidth - x)}px 0 0)`;
    bLire.textContent = S.lecture || S.rev ? (S.rate !== 1 ? `×${S.rate}` : 'Pause') : 'Lecture';
    bLire.classList.toggle('on', !!(S.lecture || S.rev));
    etat.textContent = S.rev ? 'arrière' : S.lecture ? 'lecture' : (d && t >= d - 1 / fps ? 'fin' : 'arrêt');
    if (onTemps) onTemps(t, S.lecture || !!S.rev);
  }

  function mesurer() {
    const d = D();
    const w = Math.max(80, defile.clientWidth);
    if (S.fit || !S.pps) S.pps = d ? w / d : 1;
    S.pps = Math.max(d ? w / d : 1, Math.min(MAX_PPS, S.pps));
    dedans.style.width = Math.max(w, xDe(d)) + 'px';
    if (kind === 'audio') for (const n of bande.children) { n.style.maskSize = `${xDe(d)}px 100%`; n.style.webkitMaskSize = `${xDe(d)}px 100%`; }
    peindreRegle(ticks, { pps: S.pps, fps, gauche: defile.scrollLeft, droite: defile.scrollLeft + defile.clientWidth });
    peindre();
  }
  function zoomer(f, clientX) {
    const d = D();
    if (!d) return;
    const r = defile.getBoundingClientRect();
    const ax = clientX ?? (r.left + xDe(S.t) - defile.scrollLeft);
    const tAx = (ax - r.left + defile.scrollLeft) / pps();
    const min = Math.max(80, defile.clientWidth) / d;
    S.pps = Math.max(min, Math.min(MAX_PPS, pps() * f));
    S.fit = S.pps <= min * 1.0001;
    mesurer();
    defile.scrollLeft = Math.max(0, tAx * S.pps - (ax - r.left));
    peindreRegle(ticks, { pps: S.pps, fps, gauche: defile.scrollLeft, droite: defile.scrollLeft + defile.clientWidth });
  }

  // ── montrer l'une ou l'autre ──
  function montrer(qui) {
    if (S.montre === qui) return;
    S.montre = qui;
    root.dataset.montre = qui;
    root.classList.toggle('defile', qui === 'nav');
  }
  // l'originale se cale sur la tête ; quand elle MONTRE l'image voulue, elle reprend la place
  function caler() {
    clearTimeout(S.cale);
    const want = viser(S.t);
    sauter(src, want);
    if (S.montre !== 'nav') return;
    const tv = S.t;
    const rendre = () => { if (!S.geste && !S.lecture && !S.rev && S.t === tv) montrer('source'); };
    if (src.requestVideoFrameCallback) {
      const ok = (now, md) => {
        if (S.t !== tv || S.geste) return;
        if (Math.abs(md.mediaTime - want) < 0.75 / fps) rendre(); else src.requestVideoFrameCallback(ok);
      };
      src.requestVideoFrameCallback(ok);
    }
    const vu = () => { if (!src.seeking && Math.abs(src.currentTime - want) < 0.75 / fps) setTimeout(rendre, 80); };
    src.addEventListener('seeked', vu, { once: true });
  }

  // aller à t (s) : la tête et le timecode tout de suite ; l'image dès qu'elle est décodée
  function seek(t, { geste = false } = {}) {
    const d = D();
    S.t = Math.max(0, Math.min(d || 0, t));
    S.fini = false;
    peindre();
    if (!d) return;
    const want = viser(S.t);
    if (S.lecture) { sauter(src, want); return; }
    if (S.nav && S.navEtat === 'pret') {
      montrer('nav');
      sauter(S.nav, want);
      clearTimeout(S.cale);
      // l'originale se cale quand le geste s'arrête (au lâcher, ou 150 ms sans mouvement)
      if (!geste) S.cale = setTimeout(caler, 150);
      return;
    }
    sauter(src, want);
  }

  // ── la lecture ──
  function boucleRaf() {
    cancelAnimationFrame(S.raf);
    const w = root.ownerDocument.defaultView || window;
    const f = () => {
      if (!S.lecture) return;
      S.t = src.currentTime;
      peindre();
      S.raf = w.requestAnimationFrame(f);
    };
    S.raf = w.requestAnimationFrame(f);
  }
  function stopArriere() { clearInterval(S.rev); S.rev = 0; }
  function play(rate = 1) {
    const d = D();
    if (!d) return;
    stopArriere();
    S.rate = rate;
    if (rate < 0) {
      // en arrière : des sauts à 30 par seconde (le lecteur n'a pas de lecture à rebours), sur la copie
      if (!src.paused) src.pause();
      S.lecture = false;
      S.rev = setInterval(() => {
        const t = S.t + rate / 30;
        if (t <= 0) { seek(0); stopArriere(); S.rate = 0; peindre(); return; }
        seek(t, { geste: true });
      }, 1000 / 30);
      peindre();
      return;
    }
    if (S.t >= d - 1 / fps) S.t = 0;
    const want = viser(S.t);
    if (Math.abs(cible(src) - want) > 0.5 / fps) sauter(src, want);
    src.playbackRate = Math.max(0.0625, Math.min(16, rate));
    S.lecture = true;
    src.play().catch(() => { S.lecture = false; peindre(); });
    // la copie reste devant tant que l'originale n'a pas montré une image
    if (S.montre === 'nav' && src.requestVideoFrameCallback) src.requestVideoFrameCallback(() => { if (S.lecture) montrer('source'); });
    else montrer('source');
    boucleRaf();
    peindre();
  }
  function pause() {
    const wasRev = !!S.rev;
    stopArriere();
    S.rate = 0;
    if (S.lecture) { S.lecture = false; src.pause(); S.t = imageDe(src.currentTime) / fps; }
    cancelAnimationFrame(S.raf);
    if (wasRev) caler();
    peindre();
  }
  const toggle = () => (S.lecture || S.rev ? pause() : play(1));
  function step(n) { pause(); seek((imageDe(S.t) + n) / fps); }
  function navette(dir) {
    if (dir === 0) { pause(); return; }
    let r = S.lecture ? S.rate : S.rev ? S.rate : 0;
    if (dir > 0) r = r <= 0 ? 1 : Math.min(8, r * 2);
    else r = r >= 0 ? -1 : Math.max(-8, r * 2);
    play(r);
  }

  src.addEventListener('loadedmetadata', () => mesurer());
  src.addEventListener('loadeddata', () => { if (attente) { attente.remove(); attente = null; } root.classList.add('pret'); });
  src.addEventListener('pause', () => { if (S.lecture) { S.lecture = false; S.t = src.currentTime; cancelAnimationFrame(S.raf); peindre(); } });
  src.addEventListener('ended', () => { S.lecture = false; S.t = D(); S.fini = true; cancelAnimationFrame(S.raf); peindre(); });
  src.addEventListener('error', () => { etat.textContent = 'illisible'; root.classList.add('erreur'); });

  // ── la copie de défilement ──
  function paintDefil() {
    const m = { pret: ['défilement fluide', 'la copie de défilement est prête : l’image suit la tête'],
      calcul: ['copie en calcul', 'la copie de défilement se calcule (quelques secondes) : en attendant, l’image suit plus lentement'],
      refus: ['défilement direct', S.navWhy || 'pas de copie de défilement : l’image suit la vidéo elle-même'],
      attente: ['', ''], sans: ['', ''] }[S.navEtat] || ['', ''];
    defil.textContent = m[0];
    defil.title = m[1];
    root.dataset.copie = S.navEtat;
    defil.classList.toggle('ok', S.navEtat === 'pret');
  }
  async function chercherCopie(n = 0) {
    if (!nav || S.mort) return;
    try {
      const r = await api('defil/' + encodeURIComponent(it.id));
      if (S.mort) return;
      if (r.ready) {
        nav.addEventListener('loadeddata', () => { S.nav = nav; S.navEtat = 'pret'; paintDefil(); }, { once: true });
        nav.addEventListener('error', () => { S.nav = null; S.navEtat = 'refus'; S.navWhy = 'la copie de défilement ne se lit pas : l’image suit la vidéo elle-même'; paintDefil(); }, { once: true });
        nav.src = href(r.url);
        S.navEtat = 'calcul';
      } else if (r.pending && n < 90) { S.navEtat = 'calcul'; setTimeout(() => { if (root.isConnected) chercherCopie(n + 1); }, 1500); }
      else { S.navEtat = 'refus'; S.navWhy = r.why; }
    } catch (e) { S.navEtat = 'refus'; S.navWhy = e.message; }
    paintDefil();
  }

  // ── les gestes ──
  const tempsA = (clientX) => {
    const r = defile.getBoundingClientRect();
    return Math.max(0, (clientX - r.left + defile.scrollLeft) / pps());
  };
  brancherRegle(dedans, {
    avant: () => { root.focus({ preventScroll: true }); return !!D(); },
    temps: tempsA,
    debut: () => { S.geste = true; if (S.lecture) pause(); stopArriere(); },
    aller: (t) => seek(t, { geste: true }),
    // au lâcher, l'originale se cale un peu après : la copie décode d'abord l'image voulue, sans
    // partager le processeur avec l'originale (mesuré : un clic, 50 → 15 ms sur une vidéo à une clé)
    fin: () => { S.geste = false; if (S.montre === 'nav') { clearTimeout(S.cale); S.cale = setTimeout(caler, 120); } },
  });
  brancher(frise, { zoom: (f, x) => zoomer(f, x), scroller: defile });
  defile.addEventListener('scroll', () => peindreRegle(ticks, { pps: pps(), fps, gauche: defile.scrollLeft, droite: defile.scrollLeft + defile.clientWidth }));
  if (ecran) {
    ecran.addEventListener('click', (e) => { if (e.target.closest('.sr-lect-sur a, .sr-lect-sur button')) return; root.focus({ preventScroll: true }); toggle(); });
    ecran.addEventListener('dblclick', (e) => { e.preventDefault(); plein(); });
  }
  bLire.addEventListener('click', toggle);
  bBoucle.addEventListener('click', () => {
    S.boucle = !S.boucle; src.loop = S.boucle;
    bBoucle.classList.toggle('on', S.boucle); bBoucle.classList.toggle('ghost', !S.boucle);
    bBoucle.setAttribute('aria-pressed', String(S.boucle));
  });
  const paintSon = () => {
    bSon.innerHTML = src.muted || src.volume === 0 ? ICON.muet : ICON.son;
    bSon.title = src.muted ? 'rendre le son' : 'couper le son';
    bSon.setAttribute('aria-pressed', String(src.muted));
    vol.value = String(src.muted ? 0 : src.volume);
  };
  bSon.addEventListener('click', () => { src.muted = !src.muted; if (!src.muted && src.volume === 0) src.volume = 1; garderSon({ vol: src.volume, muet: src.muted }); paintSon(); });
  vol.addEventListener('input', () => { src.volume = +vol.value; src.muted = +vol.value === 0; garderSon({ vol: src.volume, muet: src.muted }); paintSon(); });
  // le plein écran DU lecteur (l'image, sa frise, sa barre) : Fullscreen API (MDN Element.requestFullscreen)
  const doc = root.ownerDocument;
  const plein = () => {
    if (doc.fullscreenElement === root) return doc.exitFullscreen().catch(() => {});
    if (!permis(doc) || !root.requestFullscreen) return Promise.resolve();
    return root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  };
  const paintFull = () => {
    const on = doc.fullscreenElement === root, ok = permis(doc) && !!root.requestFullscreen;
    bFull.innerHTML = on ? ICON.unfull : ICON.full;
    bFull.setAttribute('aria-pressed', String(on));
    bFull.setAttribute('aria-disabled', String(!ok));
    bFull.title = !ok ? 'ce navigateur refuse le plein écran à cette page — F11 met toute la fenêtre en plein écran'
      : on ? 'quitter le plein écran · Échap' : 'plein écran · double-clic sur l’image · Échap pour sortir';
    root.classList.toggle('plein', on);
    requestAnimationFrame(mesurer);
  };
  bFull.addEventListener('click', plein);
  const onFull = () => paintFull();
  doc.addEventListener('fullscreenchange', onFull);
  // commun/pleinecran.js garde Échap pour la page (Keyboard Lock) : le lecteur plein écran en sort lui-même,
  // un cran à la fois (Échap rend l'état d'avant ; une fenêtre qui le porte se ferme à l'Échap suivant)
  const onEsc = (e) => {
    if (e.key !== 'Escape' || doc.fullscreenElement !== root) return;
    e.preventDefault(); e.stopPropagation();
    doc.exitFullscreen().catch(() => {});
  };
  doc.addEventListener('keydown', onEsc, true);

  // le clavier du Montage ; `clavier: 'page'` : partout sur la page (hors d'un champ, d'une boîte, d'un menu)
  function cle(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key;
    const sh = e.shiftKey;
    switch (k) {
      case ' ': toggle(); break;
      case 'j': case 'J': navette(-1); break;
      case 'k': case 'K': navette(0); break;
      case 'l': case 'L': navette(1); break;
      case 'ArrowLeft': step(sh ? -Math.round(fps) : -1); break;
      case 'ArrowRight': step(sh ? Math.round(fps) : 1); break;
      case 'Home': pause(); seek(0); break;
      case 'End': pause(); seek(D()); break;
      default: return false;
    }
    e.preventDefault();
    return true;
  }
  const onKey = (e) => {
    if (!root.isConnected) { detruire(); return; }
    if (e.defaultPrevented || champ(e.target) || doc.querySelector('.scrim:not([hidden]), .sr-menu')) return;
    if (clavier !== 'page' && !root.contains(doc.activeElement)) return;
    if (e.key === ' ' && e.target.matches && e.target.matches('button, input[type=range]')) e.target.blur();
    cle(e);
  };
  if (clavier) doc.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => mesurer());
  ro.observe(defile);

  function detruire() {
    S.mort = true;
    stopArriere(); cancelAnimationFrame(S.raf); clearTimeout(S.cale);
    try { src.pause(); } catch { /* */ }
    doc.removeEventListener('keydown', onKey);
    doc.removeEventListener('fullscreenchange', onFull);
    doc.removeEventListener('keydown', onEsc, true);
    ro.disconnect();
    for (const m of [src, nav]) if (m) { m.removeAttribute('src'); try { m.load(); } catch { /* */ } }
  }

  paintSon(); paintFull(); paintDefil(); peindre();
  root.dataset.montre = S.montre;
  if (nav) chercherCopie();

  const L = {
    el: root, media: src, fps, kind,
    get t() { return S.t; },
    get duree() { return D(); },
    get lecture() { return S.lecture || !!S.rev; },
    seek: (t) => seek(t), play, pause, toggle, step, cle, detruire,
    // une piste de la page sous la bande (les répliques de Transcrire…) : ses enfants se placent en %
    // de la durée (la largeur de la frise = durée × zoom : ils suivent le zoom d'eux-mêmes)
    piste(node) { node.classList.add('sr-lect-piste'); dedans.insertBefore(node, ph); mesurer(); return node; },
    xDe, pps,
    etat: () => ({ t: S.t, montre: S.montre, copie: S.navEtat, src: src.currentTime, nav: nav ? nav.currentTime : null, pps: S.pps, lecture: S.lecture, rev: !!S.rev, rate: S.rate }),
  };
  root.srLecteur = L;       // pour les pilotes (Chromium sans affichage) : l'état, sans toucher à rien
  return L;
}
