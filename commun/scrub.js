// LE son au défilement de toutes les timelines du portail (06/10/2026).
//
// Cal : « entendre le son quand on fait glisser la tête de lecture […] hyper
// important pour caler un cut ». Une seule mécanique, que chaque timeline
// branche sur sa tête (commun/tete.js) : le Montage (la règle de la timeline,
// les barres sous ses moniteurs : montage/player.js), ODIO (la règle et
// l'onglet de la tête de l'arrangement : musique/timeline.js), le lecteur
// commun (sa frise : commun/lecteur.js — Asset, le fil d'Image et de Vidéo,
// Transcrire, Idéation, les paroles calées, la playlist). Premiere Pro le
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
// Le pas à pas (06/10) : avancer d'une image au clavier (← →, et J ou L la
// touche K tenue) fait entendre un grain, un seul, à la nouvelle place, à la
// vitesse du son (`coup`). Premiere le fait : « Play audio while scrubbing »
// vaut pour la tête glissée, les flèches et J K L (fils du forum d'Adobe
// « Sound when going frame by frame in Premiere Pro », « Audio preview frame by
// frame », lus par les résultats de recherche : community.adobe.com et
// helpx.adobe.com ne s'ouvrent pas d'ici ; « Shift+S » y bascule la
// préférence, d'après les mêmes fils) ; la lecture à rebours (J), qui n'a pas
// de son à elle, est un geste comme un autre (`debut`, `aller`, `fin`) ; la
// lecture en avant a le sien : aucun grain.
//
// Ce qui sonne, la page le dit : `sons(t)` rend les sons à l'instant t de sa
// timeline (le son décodé, où y lire, le niveau, la vitesse du plan, où
// l'envoyer). Le Montage et le lecteur commun (commun/lecteur.js) lisent le son
// de défilement du serveur (`sonDefil` : une copie mono en FLAC,
// server/tools/defilement.py), ODIO ses propres sons décodés
// (musique/moteur.js), par la piste de chaque clip. Ce qui COMMENCE quelque part
// (les notes d'un clip de motif d'ODIO), la page le joue quand la tête passe
// dessus (`notes`) : la mécanique lui donne le chemin parcouru depuis le pas
// d'avant et l'instant où jouer.
//
//   const S = scrub({ contexte, sons, notes, sortie })
//     contexte()   l'AudioContext de la page (créé, relancé au début du geste) ; null : pas encore
//                  (défaut : `contexteCommun`, un contexte pour les pages qui n'en ont pas)
//     sons(t)      [{ buffer, at, gain = 1, vitesse = 1, sortie }] — ce qui s'entend à t (s) :
//                  le son (AudioBuffer), où y lire (s), le niveau (linéaire), la vitesse du
//                  plan, l'entrée où l'envoyer (AudioNode ; défaut : `sortie()`)
//     notes(a, b, T, r)  facultatif : la tête est passée de a à b (s ; b < a à rebours) depuis
//                  le pas d'avant ; la page joue ce qui commence entre les deux, à l'instant T
//                  de l'horloge du contexte, r la vitesse du geste (0,5 à 2), et rend combien
//     sortie()     l'entrée par défaut (défaut : ctx.destination)
//   S.debut()      un geste commence (la tête suit le pointeur, ou la lecture à rebours)
//   S.aller(t)     la tête est à t (s) ; un grain part si elle a bougé
//   S.fin()        le geste finit
//   S.coup(t)      un pas à pas : un grain à t, à la vitesse du son (hors d'un geste)
//   S.grains       le nombre de grains joués depuis le chargement (les essais le lisent)
//   S.notes        le nombre de notes jouées par `notes` (idem)
//   sonDefil(it)   le son de défilement d'un objet de la bibliothèque (AudioBuffer), ou null
//                  tant qu'il se charge (le chargement part au premier appel)
//   chargerSon(it) la même chose en promesse (AudioBuffer | null), pour charger d'avance
//   aSon(it)       l'objet a-t-il un son de défilement à demander (un son, une vidéo avec son)
//   actif()        la préférence Général → « Son au défilement » (vrai par défaut)
//   contexteCommun()  l'AudioContext partagé des pages sans moteur de son (le lecteur commun),
//                  créé au premier appel — toujours dans un geste (pointeur, touche) : la
//                  politique de lecture automatique le laisse partir (MDN, « Autoplay guide
//                  for media and Web Audio APIs »)

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

let AC = null;
export function contexteCommun() {
  if (!AC) { try { AC = new AudioContext(); } catch { AC = null; } }
  return AC;
}

export function scrub({ contexte = contexteCommun, sons, notes = null, sortie = null }) {
  const S = { on: false, t: null, gt: null, hist: [], next: 0, voix: 0, timer: 0, grains: 0, notes: 0 };

  // la vitesse de la tête (s de timeline par s), sur les dernières FENETRE_MS ; 1 sans mesure
  function vitesse() {
    const now = performance.now();
    const h = S.hist.filter((x) => now - x.w <= FENETRE_MS);
    S.hist = h.length ? h : S.hist.slice(-1);
    if (h.length < 2) return 1;
    const a = h[0], b = h[h.length - 1], dw = (b.w - a.w) / 1000;
    return dw > 0.004 ? (b.t - a.t) / dw : 1;
  }

  // l'instant du prochain grain, et le pas suivant ; null : le contexte n'est pas prêt (il se
  // relance), ou le grain du pas en cours est déjà parti (`avance` : jusqu'où un grain peut
  // attendre son pas — un pas à pas ne perd pas le sien quand deux touches se suivent de près)
  function instant(avance = 0.012) {
    const ctx = contexte();
    if (!ctx) return null;
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); return null; }
    if (ctx.state !== 'running') return null;
    const now = ctx.currentTime;
    if (S.next > now + avance) return null;
    const T = Math.max(now + 0.005, S.next);
    S.next = T + PAS;
    return { ctx, T };
  }

  // les sons à t, lus à la vitesse r, à l'instant T
  function poser(ctx, T, t, r) {
    let liste = [];
    try { liste = sons(t) || []; } catch (e) { console.error(e); return; }
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

  function grain() {
    if (!S.on || S.t === null || S.t === S.gt || !actif()) return;   // la tête n'a pas bougé depuis le dernier grain
    const q = instant();
    if (!q) return;
    const a = S.gt;
    S.gt = S.t;
    const r = Math.max(VITESSE[0], Math.min(VITESSE[1], Math.abs(vitesse())));
    poser(q.ctx, q.T, S.t, r);
    if (notes) { try { S.notes += notes(a, S.t, q.T, r) || 0; } catch (e) { console.error(e); } }
  }

  // un pas à pas : un grain à t, dans son pas (trois au plus en attente) ; le premier relance le
  // contexte (créé dans la touche) puis joue
  function coup(t, encore = true) {
    if (!Number.isFinite(t) || !actif()) return;
    const ctx = contexte();
    if (ctx && ctx.state === 'suspended' && encore) { ctx.resume().then(() => coup(t, false), () => {}); return; }
    const q = instant(3 * PAS);
    if (q) poser(q.ctx, q.T, t, 1);
  }

  return {
    get grains() { return S.grains; },
    get notes() { return S.notes; },
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
    coup,
  };
}

// ── le son de défilement d'un objet (GET /api/defil/<id>/son) ──
// Décodé une fois par page, à sa fréquence (mono, 22 050 Hz, 11 025 au-delà de 10 min) :
// un OfflineAudioContext d'une image suffit à décoder (MDN), et rend le son à SA fréquence.
const SONS = new Map();             // id → { buf, p, why }
// un objet de la bibliothèque qui a un son (une vidéo sans son n'en a pas : le serveur le dit aussi)
export const aSon = (it) => !!(it && it.id && (it.kind === 'audio' || (it.kind === 'video' && it.audio)));
export function chargerSon(it) {
  if (!aSon(it)) return Promise.resolve(null);
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
