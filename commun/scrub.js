// LE son au défilement de toutes les timelines du portail (06/10/2026).
//
// Cal : « entendre le son quand on fait glisser la tête de lecture […] hyper
// important pour caler un cut ». Une seule mécanique, que chaque timeline
// branche sur sa tête (commun/tete.js) : le Montage (la règle de la timeline,
// les barres sous ses moniteurs : montage/player.js), ODIO (la règle et
// l'onglet de la tête de l'arrangement : musique/timeline.js). Premiere Pro le
// fait (Préférences → Audio, « Play audio while scrubbing » — lu dans des
// guides tiers, la page d'Adobe ne s'ouvre pas d'ici) ; Live, lui, rejoue en
// boucle un morceau de l'arrangement sous la souris dans sa zone de défilement
// (manuel de Live 12, « Arrangement View », Scrub Area).
//
// Le principe : pendant qu'on glisse une tête, chaque fois qu'elle a bougé, un
// grain de son de GRAIN s (60 ms) part à sa place, dans le pas qui vient (un
// toutes les PAS s, 30 ms) :
//   - la fenêtre de Hann (setValueCurveAtTime, MDN) monte de 0 et y retourne :
//     aucun claquement ; deux grains se recouvrent de moitié, et la somme de
//     deux fenêtres de Hann décalées de moitié vaut 1 : un geste régulier
//     s'entend sans trou ni bosse, au niveau de la lecture ;
//   - la vitesse du grain suit celle de la tête (playbackRate = la vitesse du
//     geste sur les 150 dernières ms, bornée de 0,5 à 2 : la hauteur suit, comme
//     une bande qu'on pousse à la main ; au-delà, les grains se suivent sans
//     accélérer davantage) ; à rebours, chaque grain se lit à l'endroit, et ils
//     reculent ;
//   - silence dès que la tête s'arrête (plus de grain après le dernier), rien
//     hors d'un geste, rien au simple clic.
//
// Ce qui sonne, la page le dit : `sons(t)` rend les sons à l'instant t de sa
// timeline (le son décodé, où y lire, le niveau, la vitesse du plan, où
// l'envoyer). Le Montage lit le son de défilement du serveur (`sonDefil` : une
// copie mono en FLAC, server/tools/defilement.py), ODIO ses propres sons
// décodés (musique/moteur.js), par la piste de chaque clip.
//
//   const S = scrub({ contexte, sons, sortie })
//     contexte()   l'AudioContext de la page (créé, relancé au début du geste) ; null : pas encore
//     sons(t)      [{ buffer, at, gain = 1, vitesse = 1, sortie }] — ce qui s'entend à t (s) :
//                  le son (AudioBuffer), où y lire (s), le niveau (linéaire), la vitesse du
//                  plan, l'entrée où l'envoyer (AudioNode ; défaut : `sortie()`)
//     sortie()     l'entrée par défaut (défaut : ctx.destination)
//   S.debut()      un geste commence (la tête suit le pointeur)
//   S.aller(t)     la tête est à t (s) ; un grain part si elle a bougé
//   S.fin()        le geste finit
//   S.grains       le nombre de grains joués depuis le chargement (les essais le lisent)
//   sonDefil(it)   le son de défilement d'un objet de la bibliothèque (AudioBuffer), ou null
//                  tant qu'il se charge (le chargement part au premier appel)
//   chargerSon(it) la même chose en promesse (AudioBuffer | null), pour charger d'avance
//   actif()        la préférence Général → « Son au défilement » (vrai par défaut)

import { api, href } from './shell.js';
import { prefs } from './prefs.js';

export const GRAIN = 0.06;          // s, la durée d'un grain (« quelques dizaines de ms »)
export const PAS = GRAIN / 2;       // s, un grain tous les PAS : recouvrement de moitié
const VITESSE = [0.5, 2];           // les bornes de playbackRate pour la vitesse du geste
const FENETRE_MS = 150;             // la vitesse de la tête se lit sur ce temps
const VOIX = 24;                    // grains en vol au plus (plusieurs pistes × recouvrement)
const SONS_PAR_GRAIN = 8;           // sons d'un même instant joués au plus
const HANN = (() => {
  const n = 64, a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
  return a;
})();

export const actif = () => prefs.get('general.scrub', true) !== false;

export function scrub({ contexte, sons, sortie = null }) {
  const S = { on: false, t: null, gt: null, hist: [], next: 0, voix: 0, timer: 0, grains: 0 };

  // la vitesse de la tête (s de timeline par s), sur les dernières FENETRE_MS ; 1 sans mesure
  function vitesse() {
    const now = performance.now();
    const h = S.hist.filter((x) => now - x.w <= FENETRE_MS);
    S.hist = h.length ? h : S.hist.slice(-1);
    if (h.length < 2) return 1;
    const a = h[0], b = h[h.length - 1], dw = (b.w - a.w) / 1000;
    return dw > 0.004 ? (b.t - a.t) / dw : 1;
  }

  function grain() {
    if (!S.on || S.t === null || S.t === S.gt || !actif()) return;   // la tête n'a pas bougé depuis le dernier grain
    const ctx = contexte();
    if (!ctx) return;
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); return; }
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (S.next > now + 0.012) return;                 // le grain du pas en cours est déjà parti
    const T = Math.max(now + 0.005, S.next);
    S.next = T + PAS;
    S.gt = S.t;
    const r = Math.max(VITESSE[0], Math.min(VITESSE[1], Math.abs(vitesse())));
    let liste = [];
    try { liste = sons(S.t) || []; } catch (e) { console.error(e); return; }
    for (const s of liste.slice(0, SONS_PAR_GRAIN)) {
      const buf = s && s.buffer;
      if (!buf || S.voix >= VOIX || !(s.at >= 0) || s.at >= buf.duration) continue;
      const k = r * (s.vitesse > 0 ? s.vitesse : 1);
      // au bout du son, le grain raccourcit (et sa fenêtre avec : il finit à zéro, sans claquer)
      const d = Math.min(GRAIN, (buf.duration - s.at) / k);
      const niveau = Math.max(0, Math.min(4, s.gain ?? 1));
      if (d < 0.01 || niveau <= 0) continue;
      const src = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: k });
      const g = new GainNode(ctx, { gain: 0 });
      g.gain.setValueCurveAtTime(HANN.map((x) => x * niveau), T, d);
      src.connect(g).connect(s.sortie || (sortie && sortie()) || ctx.destination);
      src.start(T, s.at, d * k);
      src.stop(T + d + 0.002);
      S.voix++;
      S.grains++;
      src.onended = () => { S.voix--; try { g.disconnect(); } catch { /* déjà débranché */ } };
    }
  }

  return {
    get grains() { return S.grains; },
    debut() {
      S.on = true; S.t = null; S.gt = null; S.hist = []; S.next = 0;
      if (actif()) { const ctx = contexte(); if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }
      clearInterval(S.timer);
      S.timer = setInterval(grain, 10);               // le pas suivant, même si le pointeur se tait un instant
    },
    aller(t) {
      if (!S.on || !Number.isFinite(t)) return;
      const w = performance.now();
      if (S.t === null) { S.t = t; S.gt = t; S.hist = [{ t, w }]; return; }   // l'appui : rien n'a encore bougé
      if (t === S.t) return;
      S.t = t;
      S.hist.push({ t, w });
      grain();
    },
    fin() { S.on = false; S.t = null; S.gt = null; clearInterval(S.timer); S.timer = 0; },
  };
}

// ── le son de défilement d'un objet (GET /api/defil/<id>/son) ──
// Décodé une fois par page, à sa fréquence (mono, 22 050 Hz, 11 025 au-delà de 10 min) :
// un OfflineAudioContext d'une image suffit à décoder (MDN), et rend le son à SA fréquence.
const SONS = new Map();             // id → { buf, p, why }
export function chargerSon(it) {
  if (!it || !it.id || !(it.kind === 'audio' || (it.kind === 'video' && it.audio))) return Promise.resolve(null);
  let e = SONS.get(it.id);
  if (!e) {
    e = { buf: null, p: null, why: '' };
    e.p = (async () => {
      const r = await api('defil/' + encodeURIComponent(it.id) + '/son');
      if (!r || !r.ready) { e.why = (r && r.why) || ''; return null; }
      const raw = await (await fetch(href(r.url))).arrayBuffer();
      e.buf = await new OfflineAudioContext(1, 1, r.sr || 22050).decodeAudioData(raw);
      return e.buf;
    })().catch((er) => { e.why = er.message; return null; });
    SONS.set(it.id, e);
  }
  return e.p;
}
export function sonDefil(it) {
  const e = it && SONS.get(it.id);
  if (!e) { chargerSon(it); return null; }
  return e.buf;
}
