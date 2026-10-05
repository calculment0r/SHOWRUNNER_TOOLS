// Musique — écouter une playlist dans la page : toute la liste, morceau après
// morceau, avec LA barre de lecture du portail (commun/lecteur.js : le
// bouton, le timecode, l'onde du son, la tête, le son) pour le morceau en
// cours, plus « précédent » et « suivant ». L'étude :
// docs/etudes/musique_spaces_playlists.md § 3.1 (« Écouter joue toute la
// playlist dans la page, avec la barre de lecture ») et § 3.6 (les
// enchaînements) :
//
//   gapless    le suivant part à la fin du précédent, déjà chargé (préchargé
//              dès que le précédent commence). Dans une page, un <audio> ne
//              promet pas l'enchaînement à l'échantillon près : le lecteur
//              publié s'en charge (la branche « écoute ») ;
//   crossfade  le suivant part `crossfade_s` avant la fin du précédent, en
//              fondu à puissance égale (Web Audio : un gain par son, courbes
//              cos / sin par setValueCurveAtTime — MDN, AudioParam) ;
//   single     « un seul fichier continu » se fabrique à la publication
//              (étude § 3.6) : dans la page, il s'écoute comme gapless.
//
//   const P = lecturePlaylist(box, { onChange(i), onPlay(), onStop() })
//   P.jouer(queue, i, transition) · P.toggle() · P.pause() · P.suivant() ·
//   P.precedent() · P.arreter() · P.index · P.lecture · P.etat()
//   queue : [{ it (le son, objet public), titre }]
//
// Aucune couleur ici : la barre est celle du lecteur commun (lecteur.css),
// le reste est habillé par chanson/playlist.css.
import { el, href } from '../commun/shell.js';
import { lecteur } from '../commun/lecteur.js';

const PISTE_H = 52;          // la frise de la barre, plus basse que dans une fiche : le volet est étroit
// les icônes de la barre, au trait comme celles du lecteur commun (lecteur.css, .sr-lect-ic)
const ICON = {
  prec: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M19 5l-10 7 10 7z"/></svg>',
  suiv: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14M5 5l10 7-10 7z"/></svg>',
};

export function lecturePlaylist(box, { onChange = () => {}, onPlay = () => {}, onStop = () => {} } = {}) {
  const S = { q: [], i: -1, tr: { mode: 'gapless', crossfade_s: 3 }, cur: null, pret: null, partants: [], ctx: null, fondu: false };
  const bPrec = el('button', { class: 'tb ghost sm sr-lect-ic pl-lect-ic', type: 'button', title: 'le morceau précédent (après 3 s : le début de celui-ci)', 'aria-label': 'précédent', html: ICON.prec, onclick: () => precedent() });
  const bSuiv = el('button', { class: 'tb ghost sm sr-lect-ic pl-lect-ic', type: 'button', title: 'le morceau suivant', 'aria-label': 'suivant', html: ICON.suiv, onclick: () => suivant() });
  const titre = el('span', { class: 'pl-lect-t' });
  const tete = el('div', { class: 'pl-lect-h' }, el('span', { class: 'lbl' }, 'en lecture'), titre);
  const corps = el('div', { class: 'pl-lect-corps' });
  box.replaceChildren(tete, corps);
  box.hidden = true;

  // Web Audio : un contexte, ouvert au premier « Écouter » (un geste : la règle de lecture
  // automatique des navigateurs, MDN « Autoplay guide »)
  function contexte() {
    if (!S.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      S.ctx = AC ? new AC() : null;
    }
    if (S.ctx?.state === 'suspended') S.ctx.resume().catch(() => {});
    return S.ctx;
  }
  // un son prêt à jouer : son <audio>, son gain
  function charger(k) {
    const e = S.q[k];
    if (!e?.it?.url) return null;
    const a = el('audio', { preload: 'auto', class: 'pl-lect-src' });
    a.src = href(e.it.url);
    const ctx = contexte();
    let gain = null;
    if (ctx) {
      try {
        gain = ctx.createGain();
        ctx.createMediaElementSource(a).connect(gain).connect(ctx.destination);
      } catch { gain = null; }
    }
    return { k, a, gain, L: null };
  }
  function lacher(x) {
    if (!x) return;
    try { x.L?.detruire(); } catch { /* déjà parti */ }
    try { x.a.pause(); } catch { /* */ }
    x.a.removeAttribute('src');
    try { x.a.load(); } catch { /* */ }
    try { x.gain?.disconnect(); } catch { /* */ }
  }
  const courbe = (montee) => {
    const n = 64, c = new Float32Array(n);
    for (let j = 0; j < n; j++) { const x = j / (n - 1); c[j] = montee ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2); }
    return c;
  };

  // passer au morceau k ; `fondu` : le précédent continue, en s'effaçant
  function demarrer(k, { fondu = false } = {}) {
    if (k < 0 || k >= S.q.length) { fin(); return; }
    const x = S.pret?.k === k ? S.pret : charger(k);
    S.pret = null;
    if (!x) { demarrer(k + 1, { fondu }); return; }            // un son absent : le suivant
    const avant = S.cur;
    S.cur = x; S.i = k; S.fondu = false;
    const e = S.q[k];
    x.L = lecteur(e.it, { clavier: false, media: x.a, outils: [bPrec, bSuiv] });
    const piste = x.L.el.querySelector('.sr-lect-piste');
    if (piste) piste.style.height = PISTE_H + 'px';
    corps.replaceChildren(x.L.el);
    titre.textContent = `${k + 1} / ${S.q.length} · ${e.titre || e.it.title || e.it.id}`;
    titre.title = titre.textContent;
    box.hidden = false;
    const xf = Math.max(0, Math.min(6, +S.tr.crossfade_s || 0));
    if (avant) {
      let ok = false;
      if (fondu && xf > 0 && avant.gain && x.gain && S.ctx) {
        try {
          const t0 = S.ctx.currentTime;
          x.gain.gain.setValueCurveAtTime(courbe(true), t0, xf);
          avant.gain.gain.cancelScheduledValues(t0);
          avant.gain.gain.setValueCurveAtTime(courbe(false), t0, xf);
          ok = true;
        } catch { x.gain.gain.cancelScheduledValues(0); x.gain.gain.value = 1; }   // une courbe refusée : enchaîné sans fondu
      }
      if (ok) {
        S.partants.push(avant);
        setTimeout(() => { S.partants = S.partants.filter((p) => p !== avant); lacher(avant); }, xf * 1000 + 120);
      } else lacher(avant);
    }
    x.a.addEventListener('ended', () => { if (S.cur === x && !x.a.loop) demarrer(k + 1); });
    // la barre a son propre bouton : la page suit la lecture et la pause
    x.a.addEventListener('play', () => { if (S.cur === x) onChange(S.i); });
    x.a.addEventListener('pause', () => { if (S.cur === x) onChange(S.i); });
    x.a.addEventListener('timeupdate', () => {
      if (S.cur !== x || S.fondu || x.a.loop) return;
      const d = x.a.duration;
      if (!isFinite(d) || !d) return;
      if (S.tr.mode === 'crossfade' && xf > 0 && k + 1 < S.q.length && d - x.a.currentTime <= xf && d > xf * 2) {
        S.fondu = true;
        demarrer(k + 1, { fondu: true });
      }
    });
    // le suivant se charge déjà : il part sans attendre le réseau
    if (k + 1 < S.q.length) S.pret = charger(k + 1);
    x.L.play();
    onChange(k);
    onPlay();
  }
  function fin() {
    const k = S.i;
    S.i = -1;
    lacher(S.pret); S.pret = null;
    for (const p of S.partants) lacher(p);
    S.partants = [];
    // la barre reste sur le dernier morceau, arrêté à sa fin
    titre.textContent = S.q.length ? `fin de la playlist · ${S.q.length} morceaux` : '';
    onChange(-1);
    onStop(k);
  }

  function jouer(queue, i = 0, transition = null) {
    if (transition) S.tr = { ...S.tr, ...transition };
    for (const p of S.partants) lacher(p);
    S.partants = [];
    lacher(S.pret); S.pret = null;
    lacher(S.cur); S.cur = null;
    S.q = queue.slice();
    demarrer(Math.max(0, Math.min(queue.length - 1, i)));
  }
  const enLecture = () => !!(S.cur && S.i >= 0 && S.cur.L?.lecture);
  function pause() {
    if (!S.cur) return;
    S.cur.L?.pause();
    for (const p of S.partants) { try { p.a.pause(); } catch { /* */ } }
    onChange(S.i);
  }
  function toggle() {
    if (!S.cur) return false;
    if (S.i < 0) { demarrer(0); return true; }               // la fin : on reprend du début
    if (enLecture()) pause();
    else { contexte(); S.cur.L.play(); onPlay(); onChange(S.i); }
    return true;
  }
  function suivant() { if (S.cur && S.i + 1 < S.q.length) demarrer(S.i + 1); else if (S.cur) { pause(); fin(); } }
  function precedent() {
    if (!S.cur) return;
    if (S.i > 0 && S.cur.a.currentTime < 3) demarrer(S.i - 1);
    else { S.cur.L.seek(0); if (!enLecture()) toggle(); }
  }
  function arreter() {
    for (const p of S.partants) lacher(p);
    S.partants = [];
    lacher(S.pret); S.pret = null;
    lacher(S.cur); S.cur = null;
    S.i = -1; S.q = [];
    corps.replaceChildren();
    box.hidden = true;
    onChange(-1);
  }
  // la liste a changé pendant l'écoute (réordonnée, un morceau ajouté) : le morceau en cours
  // continue, la suite suit le nouvel ordre
  function suite(queue, i) {
    if (!S.cur || i < 0) return;
    S.q = queue.slice();
    S.i = i;
    lacher(S.pret);
    S.pret = i + 1 < S.q.length ? charger(i + 1) : null;
    titre.textContent = `${i + 1} / ${S.q.length} · ${S.q[i].titre || S.q[i].it.title || S.q[i].it.id}`;
  }

  return {
    jouer, toggle, pause, suivant, precedent, arreter, suite,
    get index() { return S.i; },
    get lecture() { return enLecture(); },
    get actif() { return !!S.cur; },
    set transition(t) { S.tr = { ...S.tr, ...t }; },
    etat: () => ({ i: S.i, n: S.q.length, lecture: enLecture(), t: S.cur ? S.cur.a.currentTime : 0, item: S.cur ? S.q[S.cur.k]?.it?.id : null,
      fondu: S.partants.length, mode: S.tr.mode }),
  };
}
