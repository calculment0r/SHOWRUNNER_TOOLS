// IDÉATION — à plusieurs, greffé sur la planche sans toucher au canvas
// (plugins.js) : qui est là (la barre), les curseurs nommés et colorés des
// autres, leur sélection (un anneau à leur couleur), « où regarde X » (un
// cadre en option), le fil de la planche (messages ancrés à un objet ou à un
// point, pastilles sur la planche, point corail quand le fil est fermé) et
// la visio (WebRTC pair à pair : un panneau flottant qu'on déplace et
// redimensionne, réductible en bulle — visio.js —, caméra, micro, partage
// d'écran, raccrocher ; un relais TURN s'il est réglé, GET …/ice). Le fil et
// l'onglet Visio (qui est en appel, rejoindre) partagent un même bandeau à
// onglets, posé sur la colonne de l'inspecteur ; en mode présentation, le
// bandeau se réduit à une pastille, le panneau de l'appel reste.
//
// Le serveur : server/tools/ideation_collab.py (un flux SSE par onglet, de
// petits POST pour les gestes). L'étude : docs/etudes/ideation_collab.md.
//
// Ce que ce module lit de la planche (sans l'écrire) : S.view {x, y, z}
// (écran = monde × z + x, y ; relatif à la planche), S.sel, S.board, S.rev,
// S.dirty, S.saving, app.node, app.label, app.canvas.el, app.canvas.dom
// (les éléments des objets, sinon [data-id]), app.canvas.applyView ; et le
// bouton « Recharger celle du serveur » (#c-reload) pour recharger la planche
// sans quitter l'appel. Les événements du bus : board, view, selection,
// commit, quiet, render ; il écoute aussi 'present' (true/false, ou {on}),
// que le module de présentation émet quand il commence et s'arrête.
//
// La co-édition (coedition.js, `app.coed`) passe par le même flux : les
// événements `op` (un lot d'opérations, numéroté) et `reset` ; le flux
// s'ouvre avec `since` (la version de la planche ici) et rejoue ce qui manque.
// Sans flux (le tunnel rapide de la démo), l'interrogation longue rend les
// mêmes événements. Le rôle sur la planche (propriétaire, éditeur, spectateur ;
// événement `role`), « Inviter » (un lien, un rôle, une durée), suivre la vue de
// quelqu'un (un clic sur son visage) et « suivez-moi » (la présence porte `lead`).
// L'étude : docs/etudes/ideation_collab.md, § 5 à 8.

import { api, el, toast, href, $, espace } from '../commun/shell.js';
import { menu } from '../commun/menu.js';
import { createCoedition } from './coedition.js';
import { createRecorder } from './enregistrer.js';
import { createPanel, createTalk, VZ_ICO } from './visio.js';
import { fenetres } from '../commun/fenetre.js';

const API = window.SR_API ? new URL(window.SR_API, location.href) : new URL(href('api/'));
const url = (p) => new URL(p, API).href;
const HAS_RTC = typeof RTCPeerConnection === 'function';
// getUserMedia et getDisplayMedia n'existent que dans un contexte sécurisé
// (https, ou localhost) : ailleurs navigator.mediaDevices vaut undefined (MDN).
// RTCPeerConnection, lui, n'y est pas soumis : on peut voir et entendre.
const SECURE = !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
const CAN_SCREEN = SECURE && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
const VIDEO = { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } };
const INSECURE = `la caméra, le micro et le partage d’écran ne s’ouvrent que sur une page sûre (https, ou localhost) : ce portail est servi en http sur ${location.host}, et le navigateur n’y donne pas l’accès aux appareils`;
const MDN = 'https://developer.mozilla.org/fr/docs/Web/Security/Secure_Contexts';
// sans relais TURN, STUN seul : deux réseaux derrière des NAT symétriques (entreprise, mobile) ne se joignent pas
const NO_RELAY = 'hors du même réseau, la visio peut ne pas passer : aucun relais TURN n’est réglé (réglage ideation_turn du portail, showrunner.local.json sur DGX2)';
const ROLE_FR = { owner: 'propriétaire', editor: 'éditeur', viewer: 'spectateur', none: 'sans accès' };

const ICO = {
  fil: 'M4 5h16v11h-9l-5 4v-4H4z',
  pin: 'M12 21c-3.6-4-6-7.2-6-10.5a6 6 0 0 1 12 0C18 13.8 15.6 17 12 21zM12 8v5M9.5 10.5h5',
  cam: 'M3 7h12v10H3zM15 11l6-3.5v9L15 13',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21',
  screen: 'M3 5h18v11H3zM9 20h6M12 16v4',
};
const svg = (d) => el('span', { class: 'co-svg', html: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>` });
const ARROW = '<svg viewBox="0 0 16 20" aria-hidden="true"><path d="M1.5 1.5v14.2l3.9-3.7 2.7 6.4 2.6-1.1-2.7-6.3h5.4z"/></svg>';
const col = (c) => `var(--${/^[a-z0-9-]+$/.test(c || '') ? c : 'ink3'})`;
const initials = (name) => (name || '?').trim().split(/[\s._-]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const typing = (t) => t?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]');
const stop = (e) => { e.stopPropagation(); };
// replaceChildren écrirait « null » pour un enfant absent
const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
const mtime = (m) => parseInt(String(m.id || '').slice(2).split('-')[0], 16) || 0;
function when(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? hm : `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${hm}`;
}
function mediaWhy(e, what) {
  const n = e?.name || '';
  if (n === 'NotAllowedError') return `accès à ${what} refusé : l’autoriser dans le navigateur (l’icône à gauche de l’adresse), puis réessayer`;
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return `pas de ${what.replace(/^(la |le |l’)/, '')} sur cet appareil`;
  if (n === 'NotReadableError') return `${what} est déjà prise par une autre application`;
  if (n === 'SecurityError' || n === 'TypeError') return INSECURE;
  return `${what} : ${e?.message || n || 'erreur inconnue'}`;
}

export function install(app) {
  if (!document.querySelector('link[data-co-css]')) {
    document.head.append(el('link', { rel: 'stylesheet', href: new URL('./collab.css', import.meta.url).href, 'data-co-css': '' }));
  }
  const { S } = app;
  const cv = app.canvas.el;
  const LS = app.LS || (() => null);
  // C : la planche à plusieurs ; K : l'appel
  const C = {
    bid: null, es: null, gen: 0, retry: 0, retryT: 0, hideT: 0, cid: null, me: null, ice: [], limits: {},
    peers: new Map(), msgs: new Map(), order: [], total: 0, readT: 0,
    tab: null, pinning: false, anchor: null, reply: null, focus: null, bottom: false,
    views: LS('co-views') === true, pins: LS('co-pins') !== false, compact: false, before: null,
    cursor: null, last: null, selKey: '', rev: null, viewT: 0, whoKey: '', callKey: '',
    // le rôle sur la planche (propriétaire, éditeur, spectateur) ; suivre la vue de quelqu'un
    role: '', can: null, follow: null, byLead: false, broke: null, leadMe: false, leads: new Map(), flyT: 0,
  };
  const K = { on: false, joining: false, local: null, cam: false, screen: null, pcs: new Map(), camWhy: '', micWhy: '' };
  // la même planche, dans le même Workspace, par l'adresse https du portail (hello.https : la
  // porte publique) ; `visio=1` y ouvre l'onglet Visio
  function httpsHere() {
    if (!C.https) return '';
    try {
      const u = new URL(location.pathname, `${C.https}/`);
      if (espace()) u.searchParams.set('e', espace());
      u.searchParams.set('visio', '1');
      u.hash = C.bid || location.hash.slice(1);
      return u.href;
    } catch { return ''; }
  }
  // la co-édition : ses opérations passent par ce flux ; elle prend l'enregistrement de la planche
  const CO = createCoedition(app, { url, moved: () => schedule(), status: () => paintNotice() });
  app.coed = CO;
  // l'enregistrement du son de l'appel (enregistrer.js) : son voyant se voit chez chacun (call.rec)
  const REC = createRecorder(app, { K, C, sendCall: () => sendCall(), repaint: () => paintRec() });

  // ── la barre : qui est là, l'appel, le fil, la visio ─────────
  const linkSt = el('span', { class: 'pill co-link', hidden: true, role: 'status' }, el('i'), el('span'));
  const who = el('div', { class: 'co-who', role: 'list', 'aria-label': 'sur la planche' });
  const notice = el('button', { class: 'co-notice', type: 'button', hidden: true, onclick: () => reloadBoard() });
  const callPill = el('button', { class: 'co-callpill', type: 'button', hidden: true, onclick: () => openDock('visio') }, el('i'), el('span'));
  const bPin = el('button', { class: 'co-ic', type: 'button', 'aria-label': 'commenter ici', title: 'commenter ici : un message épinglé sur un objet ou un point de la planche · C', onclick: () => pinMode(!C.pinning) }, svg(ICO.pin));
  const filDot = el('b', { class: 'co-dot', hidden: true });
  const bFil = el('button', { class: 'co-ic', type: 'button', 'aria-label': 'le fil', title: 'le fil de la planche : messages et commentaires épinglés', onclick: () => toggleDock('fil') }, svg(ICO.fil), filDot);
  const bVis = el('button', { class: 'co-ic', type: 'button', 'aria-label': 'la visio', title: 'la visio de la planche', onclick: () => toggleDock('visio') }, svg(ICO.cam));
  // suivre : « suit Lina · arrêter », ou « reprendre » après un geste qui a rompu le suivi
  const followPill = el('button', { class: 'co-follow', type: 'button', hidden: true, onclick: () => followClick() }, el('i'), el('span'));
  const roleChip = el('span', { class: 'co-role lbl', hidden: true });
  // étroite, la barre n'en montre que l'icône (ideation.css, .cmp)
  const bInvite = el('button', { class: 'tb ghost sm co-inv cmp', type: 'button', hidden: true, 'aria-label': 'inviter', title: 'inviter quelqu’un sur cette planche : un lien, un rôle, une durée', onclick: () => inviteModal() },
    el('span', { class: 'bi', html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M19 8v6M16 11h6"/></svg>' }), el('span', { class: 'bt' }, 'Inviter'));
  // le voyant ENREGISTREMENT : chez chacun, tant que quelqu'un enregistre l'appel
  const recPill = el('button', { class: 'co-recpill', type: 'button', hidden: true, role: 'status', onclick: () => openDock('visio') }, el('i'), el('span', { class: 'lbl' }));
  const barBox = el('div', { class: 'co-bar' }, linkSt, notice, followPill, recPill, who, callPill, roleChip, bInvite, bPin, bFil, bVis);
  const ideBar = $('.ide-bar');
  if (ideBar) ideBar.append(barBox); else document.body.append(barBox);

  // ── le bandeau à onglets (posé sur la colonne de l'inspecteur) ─
  const tabDot = el('b', { class: 'co-dot', hidden: true });
  const tabLive = el('i', { class: 'co-live', hidden: true });
  const tabFil = el('button', { class: 'co-tab', type: 'button', role: 'tab', onclick: () => openDock('fil') }, 'Fil', tabDot);
  const tabVis = el('button', { class: 'co-tab', type: 'button', role: 'tab', onclick: () => openDock('visio') }, 'Visio', tabLive);
  const dock = el('aside', { class: 'co-dock', hidden: true, 'aria-label': 'fil et visio de la planche' },
    el('div', { class: 'co-dhead', role: 'tablist' }, tabFil, tabVis, el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'replier le bandeau : l’inspecteur revient', onclick: () => closeDock() }, 'Fermer')));
  const filPane = el('section', { class: 'co-pane', role: 'tabpanel', 'aria-label': 'fil' });
  const visPane = el('section', { class: 'co-pane', role: 'tabpanel', 'aria-label': 'visio', hidden: true });
  dock.append(filPane, visPane);
  document.body.append(dock);

  // le fil
  const filCount = el('span', { class: 'lbl' });
  const pinsTog = el('button', { class: 'co-tog', type: 'button', title: 'les pastilles des messages épinglés, sur la planche', onclick: () => { C.pins = !C.pins; LS('co-pins', C.pins); paintFil(); schedule(); } }, 'pastilles');
  const list = el('div', { class: 'co-list', role: 'log', 'aria-live': 'polite' });
  const anchorBtn = el('button', { class: 'co-chip', type: 'button', title: 'où ce message s’épingle', onclick: (e) => anchorMenu(e) });
  const replyChip = el('button', { class: 'co-chip reply', type: 'button', hidden: true, title: 'ne plus répondre : un message neuf', onclick: () => { C.reply = null; paintComposer(); } });
  const ta = el('textarea', { class: 'fld co-ta', rows: 2, maxlength: 2000, placeholder: 'écrire au fil — Entrée : envoyer · Maj+Entrée : à la ligne', 'aria-label': 'message' });
  const compWhy = el('span', { class: 'co-why' });
  const sendBtn = el('button', { class: 'tb ghost sm', type: 'button', onclick: () => sendMsg() }, 'Envoyer');
  filPane.append(
    el('div', { class: 'co-fhead' }, filCount, el('span', { class: 'sp' }), pinsTog),
    list,
    el('div', { class: 'co-comp' },
      el('div', { class: 'co-arow' }, el('span', { class: 'lbl' }, 'sur'), anchorBtn, replyChip),
      ta, el('div', { class: 'co-srow' }, compWhy, sendBtn)));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMsg(); }
    if (e.key === 'Escape') { e.preventDefault(); ta.blur(); }
  });
  ta.addEventListener('input', () => { compWhy.textContent = ''; });

  // la visio
  const visWarn = el('div', { class: 'co-warn', hidden: true });
  const visList = el('div', { class: 'co-vlist' });
  // rejoindre : sur une page qui n'est pas sûre (http hors localhost), le bouton est
  // éteint, dit pourquoi, et mène à la même planche par l'adresse https (bHttps)
  const bJoin = el('button', { class: 'tb on sm', type: 'button', onclick: () => (K.on ? leaveCall() : joinCall()) });
  bJoin.addEventListener('click', (e) => { if (bJoin.getAttribute('aria-disabled') === 'true') { e.stopImmediatePropagation(); if (bJoin.title) toast(bJoin.title, 8000); } }, true);
  const bHttps = el('a', { class: 'tb ghost sm co-https', hidden: true, rel: 'noopener' }, 'Ouvrir en https ↗');
  const bListen = el('button', { class: 'co-tog', type: 'button', hidden: true, title: 'rejoindre sans caméra ni micro : voir et entendre les autres', onclick: () => joinCall() }, 'écouter seulement');
  const bShow = el('button', { class: 'co-tog', type: 'button', hidden: true, title: 'le panneau de l’appel, qu’on déplace et redimensionne', onclick: () => { VZ.show(true); VZ.mini(false); } }, 'panneau');
  // les commandes du panneau : une icône, le mot quand il y a la place
  const ctl = (label, ic, fn) => el('button', { class: 'co-ctlb vz-b', type: 'button', 'aria-pressed': 'false', 'aria-label': label, onclick: fn },
    el('span', { class: 'vz-ico', html: `<svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg>` }), el('span', { class: 'vz-w' }, label));
  const bMic = ctl('Micro', VZ_ICO.micOff, () => toggleMic());
  const bCam = ctl('Caméra', VZ_ICO.camOff, () => toggleCam());
  const bScr = ctl('Écran', `<path d="${ICO.screen}"/>`, () => toggleScreen());
  const visNote = el('p', { class: 'co-note' });
  // enregistrer le son de l'appel (enregistrer.js) : le bouton, l'état, le voyant de qui enregistre
  const bRec = el('button', { class: 'co-ctlb vz-b co-recb', type: 'button', 'aria-pressed': 'false', 'aria-label': 'enregistrer le son de l’appel', onclick: () => (REC.on() ? REC.stop() : REC.start()) },
    el('i', { class: 'co-recdot' }), el('span', { class: 'vz-w' }, 'Enregistrer'));
  bRec.addEventListener('click', (e) => { if (bRec.getAttribute('aria-disabled') === 'true') { e.stopImmediatePropagation(); if (bRec.title) toast(bRec.title, 7000); } }, true);
  // raccrocher : une action qui coupe, pas l'action de la page — l'orange de l'alerte
  // en filet et en encre, jamais l'aplat (.tb.go, un seul par écran)
  const bHang = el('button', { class: 'co-ctlb vz-b vz-hang', type: 'button', 'aria-label': 'raccrocher', title: 'raccrocher : quitter l’appel (la planche reste ouverte)', onclick: () => leaveCall() },
    el('span', { class: 'vz-ico', html: `<svg viewBox="0 0 24 24" aria-hidden="true">${VZ_ICO.hang}</svg>` }), el('span', { class: 'vz-w' }, 'Raccrocher'));
  const recSt = el('span', { class: 'co-recst lbl' });
  const recRow = el('div', { class: 'co-recrow' }, recSt);
  visPane.append(
    el('div', { class: 'co-fhead' }, el('span', { class: 'lbl' }, 'visio · pair à pair'), el('span', { class: 'sp' }), bShow),
    visWarn, visList,
    el('div', { class: 'co-vrow' }, bJoin, bHttps, bListen),
    recRow,
    visNote);

  // le panneau de l'appel (visio.js) : flottant, au-dessus de la planche, sans voile ;
  // il peut passer dans une fenêtre du navigateur (commun/fenetre.js)
  const FEN = fenetres('ideation', { onchange: () => afterMove() });
  const relayChip = el('span', { class: 'vz-relay lbl' });
  const VZ = createPanel({ label: 'visio', head: [relayChip], bar: [bMic, bCam, bScr, bRec, el('span', { class: 'sp' }), bHang] });
  FEN.panneau('visio', { node: VZ.root, title: 'Visio' });
  VZ.root.querySelector('.vz-head .sp').after(FEN.bouton('visio'));
  // une vidéo déplacée d'un document à l'autre s'arrête : on la relance
  function afterMove() {
    for (const t of tilePool.values()) if (t.v.srcObject && t.v.paused) t.v.play().catch(() => t.el.classList.add('blocked'));
    VZ.show(K.on); VZ.layout();
  }
  const TALK = createTalk((k) => { C.talk = k; paintTiles(); });

  // sur la planche : curseurs, anneaux, cadres de vue, pastilles
  const layer = el('div', { class: 'co-layer', 'aria-hidden': 'true' });
  const mini = el('button', { class: 'co-mini', type: 'button', hidden: true, title: 'le fil et la visio, réduits pendant la présentation', onclick: () => setCompact(false) });
  // pendant la présentation : « suivez-moi » à portée de main (la barre est cachée)
  const leadMini = el('button', { class: 'co-mini co-leadmini', type: 'button', hidden: true, onclick: () => lead(!C.leadMe) });
  cv.append(layer, mini, leadMini);

  // ── le flux ────────────────────────────────────────────────
  const post = (path, body) => api(`ideation/collab/${C.bid}/${path}`, { method: 'POST', body });
  const beacon = (path, body) => {
    try { navigator.sendBeacon(url(`ideation/collab/${C.bid}/${path}`), new Blob([JSON.stringify(body)], { type: 'application/json' })); } catch { /* */ }
  };
  function setLink(cls, txt) {
    linkSt.hidden = !txt;
    linkSt.className = `pill co-link ${cls}`;
    linkSt.lastChild.textContent = txt;
  }
  function closeStream() {
    C.gen++;
    clearTimeout(C.retryT);
    clearTimeout(C.helloT);
    if (C.es) C.es.close();
    C.es = null;
    CO.stream(false);
  }
  // les événements du flux (et de l'interrogation, qui rend les mêmes)
  const EVENTS = {
    hello: (d) => onHello(d), p: (d) => onPresence(d), join: (d) => onJoin(d), leave: (d) => onLeave(d),
    msg: (d) => onMsg(d), del: (d) => onDel(d), sig: (d) => onSig(d), bye: (d) => onBye(d),
    op: (d) => CO.event(d), reset: () => CO.reset(), role: (d) => onRole(d),
  };
  const query = (resume) => {
    const qs = new URLSearchParams();
    if (resume && C.cid) qs.set('resume', C.cid);
    // la version de la planche ici : le serveur rejoue d'abord les lots d'après
    const since = CO.since();
    if (since !== null && since !== undefined) qs.set('since', String(since));
    return qs;
  };
  // sans flux (le tunnel rapide de la démo : « Quick Tunnels do not support Server-Sent
  // Events ») : l'interrogation longue ; aussi quand un flux ne dit jamais bonjour, deux fois
  C.poll = /\.trycloudflare\.com$/i.test(location.hostname) || new URLSearchParams(location.search).has('poll') || LS('co-poll') === true;
  function open(resume) {
    closeStream();
    if (!C.bid) return;
    const g = C.gen;
    if (!C.cid) setLink('work', 'connexion');
    if (C.poll) { pollLoop(g, resume); return; }
    const qs = query(resume);
    const es = new EventSource(url(`ideation/collab/${C.bid}/stream${qs.toString() ? `?${qs}` : ''}`));
    C.es = es;
    let hi = false;
    const noHello = () => { C.noHello = (C.noHello || 0) + 1; if (C.noHello >= 2) { C.poll = true; console.warn('collab · pas de flux : interrogation'); } };
    C.helloT = setTimeout(() => { if (g === C.gen && !hi) { noHello(); es.close(); C.es = null; lost(g); } }, 9000);
    for (const [ev, fn] of Object.entries(EVENTS)) {
      es.addEventListener(ev, (e) => {
        if (g !== C.gen) return;
        if (ev === 'hello') { hi = true; C.noHello = 0; clearTimeout(C.helloT); }
        let d;
        try { d = JSON.parse(e.data); } catch { return; }
        try { fn(d); } catch (err) { console.error('collab ·', ev, err); }
      });
    }
    es.onerror = () => { if (g !== C.gen) return; if (!hi) noHello(); clearTimeout(C.helloT); es.close(); C.es = null; CO.stream(false); lost(g); };
  }
  async function pollLoop(g, resume) {
    let fails = 0, first = true;
    while (g === C.gen && C.bid) {
      const qs = query(resume || !first);
      qs.set('wait', first ? '0' : '20');
      let r;
      try { r = await api(`ideation/collab/${C.bid}/poll?${qs}`); } catch (e) {
        if (g !== C.gen) return;
        CO.stream(false);
        if (e.status === 401) { setLink('err', 'hors connexion'); return; }
        if (e.status === 403 || e.status === 404) { C.cid = null; C.peers.clear(); setLink('err', e.message); paintAll(); return; }
        setLink('work', 'reconnexion');
        await new Promise((res) => setTimeout(res, Math.min(15000, 800 * 2 ** fails++)));
        continue;
      }
      if (g !== C.gen) return;
      fails = 0; first = false;
      for (const [ev, d] of r.events || []) { try { EVENTS[ev]?.(d); } catch (err) { console.error('collab · poll', ev, err); } }
      if (!C.cid || g !== C.gen) return;   // bye
    }
  }
  async function lost(g) {
    setLink('work', 'reconnexion');
    let wait = Math.min(15000, 800 * 2 ** C.retry++);
    try {
      const st = await api(`ideation/collab/${C.bid}`);
      if (!st.join.ok) { setLink('err', st.join.why); wait = 15000; }
    } catch (e) {
      if (e.status === 401) { setLink('err', 'hors connexion'); return; }
      if (e.status === 404) { setLink('err', 'planche absente'); return; }
    }
    if (g !== C.gen) return;
    C.retryT = setTimeout(() => { if (g === C.gen && C.bid) open(true); }, wait);
  }
  function onHello(d) {
    const fresh = d.cid !== C.cid;
    C.cid = d.cid; C.me = d.me; C.limits = d.limits || {}; C.retry = 0; C.total = d.total || 0;
    // les serveurs ICE du flux : STUN seul ; ceux du relais (identifiants de courte durée) viennent de …/ice
    if (!C.iceExp) { C.ice = d.ice || []; C.relay = d.relay || ''; }
    C.https = d.https || '';
    C.peers = new Map((d.peers || []).map((p) => [p.cid, p]));
    C.msgs = new Map(); C.order = [];
    for (const m of d.messages || []) putMsg(m);
    C.readT = Number(LS(`co-read-${C.bid}`)) || 0;
    setLink('', '');
    // un nouvel identifiant pendant l'appel : les autres nous voient arriver, tout se refait
    if (fresh && K.on) for (const cid of [...K.pcs.keys()]) closePeer(cid);
    delete P.pend.call;
    sendFull();
    if (C.tab === 'fil') markRead();
    setRole(d.me?.role, d.can);
    paintAll();
    reconcile(true);
    CO.hello(d.ops);
    // quelqu'un demande déjà qu'on le suive (« suivez-moi ») : on le suit
    C.leads = new Map([...C.peers.values()].map((p) => [p.cid, !!p.lead]));
    const lead = [...C.peers.values()].find((p) => p.lead && !p.lost);
    if (lead && !C.follow && !C.leadMe) startFollow(lead.cid, { byLead: true });
  }
  function onRole(d) {
    const was = C.role;
    setRole(d.role, d.can);
    if (was && was !== d.role) toast(`votre rôle sur cette planche : ${ROLE_FR[d.role] || d.role}`, 5000);
  }
  function setRole(role, can) {
    C.role = role || '';
    C.can = can || null;
    CO.role(role, can);
    paintRole();
    paintComposer();
  }
  function onBye(d) {
    closeStream();
    if (K.on) leaveCall(true);
    C.cid = null; C.peers.clear();
    setLink('err', d?.why || 'coupé');
    paintAll();
  }
  function onPresence(listP) {
    for (const p of listP) if (p.cid !== C.cid) C.peers.set(p.cid, p);
    for (const p of listP) if (p.cid !== C.cid) watchLead(p);
    const f = C.follow && listP.find((p) => p.cid === C.follow);
    if (f?.view) followView(f.view);
    paintWho(); paintNotice(); schedule(); reconcile();
  }
  function onJoin(p) { if (p.cid !== C.cid) { C.peers.set(p.cid, p); watchLead(p); } paintWho(); schedule(); reconcile(); }
  function onLeave(d) {
    C.peers.delete(d.cid); C.leads.delete(d.cid); closePeer(d.cid);
    if (C.follow === d.cid) { stopFollow(); toast('la personne suivie a quitté la planche', 4000); }
    if (C.broke === d.cid) { C.broke = null; paintFollow(); }
    paintWho(); paintNotice(); schedule(); reconcile();
  }

  function connect(bid) {
    if (bid === C.bid) { if (bid && !C.es && !C.retryT) open(true); return; }
    if (C.bid) {
      if (K.on) { leaveCall(true); toast('appel quitté : une autre planche s’ouvre', 4000); }
      if (C.cid) beacon('leave', { cid: C.cid });
    }
    closeStream();
    Object.assign(C, { bid, cid: null, me: null, anchor: null, reply: null, focus: null, total: 0, rev: null,
      role: '', can: null, follow: null, broke: null, byLead: false, leadMe: false, leads: new Map() });
    C.peers.clear(); C.msgs.clear(); C.order = [];
    P.pend = {};
    if (bid) open(false); else setLink('', '');
    paintAll();
  }

  // ── la présence : ce que j'envoie ───────────────────────────
  // une seule requête à la fois, fusionnée : jamais plus d'une connexion prise
  const P = { pend: {}, busy: false, t: 0, timer: 0 };
  function send(patch) {
    if (!C.cid) return;
    Object.assign(P.pend, patch);
    if (P.timer || P.busy) return;
    P.timer = setTimeout(flush, Math.max(0, 60 - (Date.now() - P.t)));
  }
  async function flush() {
    P.timer = 0;
    if (!C.cid || P.busy || !Object.keys(P.pend).length) return;
    const body = { cid: C.cid, ...P.pend };
    P.pend = {};
    P.busy = true;
    P.t = Date.now();
    try { await post('presence', body); } catch (e) {
      if (e.status === 410) { C.cid = null; open(false); }
    } finally {
      P.busy = false;
      if (Object.keys(P.pend).length) send({});
    }
  }
  const viewArr = () => {
    const v = S.view;
    return [-v.x / v.z, -v.y / v.z, cv.clientWidth / v.z, cv.clientHeight / v.z].map((k) => Math.round(k * 10) / 10);
  };
  const callState = () => ({ on: K.on, mic: !!audioTrack()?.enabled, cam: K.cam && !!K.local?.getVideoTracks()[0], screen: !!K.screen, recv: !K.local?.getTracks().length,
    rec: !!REC?.on() });
  function sendFull() {
    C.selKey = [...S.sel].join(',');
    C.rev = S.rev ?? null;
    send({ cursor: C.cursor, sel: [...S.sel].slice(0, 200), view: viewArr(), away: document.hidden, rev: C.rev, call: K.on ? callState() : null, lead: C.leadMe });
  }
  function toWorld(x, y) {
    const r = cv.getBoundingClientRect(), v = S.view;
    return [(x - r.left - v.x) / v.z, (y - r.top - v.y) / v.z];
  }
  function trackCursor() {
    if (!C.cid) return;
    if (!C.last) { if (C.cursor) { C.cursor = null; send({ cursor: null }); } return; }
    const [wx, wy] = toWorld(...C.last);
    C.cursor = [Math.round(wx * 10) / 10, Math.round(wy * 10) / 10];
    send({ cursor: C.cursor });
  }
  // le curseur ne compte que sur la planche même (pas sur la mini-carte, le zoom, le bandeau)
  addEventListener('pointermove', (e) => {
    const on = cv.contains(e.target) && !e.target.closest?.('.co-mini, .zoombox, .mini, .co-pin');
    C.last = on ? [e.clientX, e.clientY] : null;
    trackCursor();
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => { C.last = null; if (C.cursor) { C.cursor = null; send({ cursor: null }); } });
  app.on('view', () => { C.viewT = Date.now(); if (C.cid) { send({ view: viewArr() }); trackCursor(); } schedule(); });
  const watchSel = () => {
    const k = [...S.sel].join(',');
    if (k !== C.selKey) { C.selKey = k; send({ sel: [...S.sel].slice(0, 200) }); }
  };
  const watchRev = () => {
    if ((S.rev ?? null) !== C.rev) { C.rev = S.rev ?? null; send({ rev: C.rev }); paintNotice(); }
  };
  app.on('selection', watchSel);
  for (const ev of ['commit', 'quiet', 'render']) app.on(ev, () => { watchSel(); watchRev(); schedule(); });
  setInterval(() => { watchRev(); if (K.on) reconcile(); }, 1500);
  app.on('board', (b) => connect(b?.id || null));
  // la présentation par cadres (atelier/presentation.js) : fil et visio se réduisent à une pastille
  app.on('atelier:present', (v) => setCompact(!!v));
  app.on('present', (v) => setCompact(v === true || !!v?.on));
  document.addEventListener('fullscreenchange', () => {
    const f = document.fullscreenElement;
    // la présentation met toute la page en plein écran (commun/pleinecran.js) : elle reste réduite
    setCompact(!!app.atelier?.presenting || (!!f && f !== document.documentElement && f !== document.body && f.contains(cv)));
  });
  document.addEventListener('visibilitychange', () => {
    if (!C.bid) return;
    clearTimeout(C.hideT);
    if (document.hidden) {
      send({ away: true });
      // un onglet caché hors appel rend sa connexion après une minute (le
      // navigateur n'en ouvre que six par adresse en HTTP/1.1)
      if (!K.on) {
        C.hideT = setTimeout(() => {
          if (!document.hidden || K.on || !C.cid) return;
          beacon('leave', { cid: C.cid });
          closeStream();
          C.cid = null; C.peers.clear();
          setLink('', 'en pause (onglet caché)');
          paintAll();
        }, 60000);
      }
    } else if (!C.es) open(!!C.cid);
    else send({ away: false });
  });
  addEventListener('pagehide', () => { if (C.cid && C.bid) beacon('leave', { cid: C.cid }); });

  // ── la barre : qui est là ───────────────────────────────────
  function people() {
    // une personne, même dans plusieurs onglets : un seul visage (le plus présent)
    const byUser = new Map();
    for (const p of C.peers.values()) {
      const cur = byUser.get(p.user);
      const score = (x) => (x.lost ? 0 : x.away ? 1 : 2) + (x.call?.on ? 4 : 0);
      if (!cur || score(p) > score(cur.best)) byUser.set(p.user, { best: p, tabs: (cur?.tabs || 0) + 1 });
      else cur.tabs++;
    }
    return [...byUser.values()].sort((a, b) => a.best.name.localeCompare(b.best.name));
  }
  function paintWho() {
    const ps = people();
    const key = `${C.me?.color}|${C.me?.name}|${K.on}|${C.follow}|${C.leadMe}|` + ps.map(({ best: p, tabs }) => `${p.cid}:${p.name}:${p.color}:${p.away}:${p.lost}:${p.call?.on}:${p.lead}:${p.role}:${tabs}`).join(';');
    if (key !== C.whoKey) {
      C.whoKey = key;
      const av = (p, { me = false, tabs = 1 } = {}) => el('button', {
        class: `co-av${me ? ' me' : ''}${p.away ? ' away' : ''}${p.lost ? ' lost' : ''}`, type: 'button', role: 'listitem',
        style: { '--c': col(p.color) },
        title: me ? `${p.name} · vous${C.role && C.role !== 'editor' ? ` · ${ROLE_FR[C.role]}` : ''}`
          : `${p.name}${p.lost ? ' · connexion coupée' : p.away ? ' · ailleurs (onglet caché)' : ''}${tabs > 1 ? ` · ${tabs} onglets` : ''}${p.call?.on ? ' · en appel' : ''}${p.role === 'viewer' ? ' · spectateur' : ''}${p.lead ? ' · « suivez-moi »' : ''}${C.follow === p.cid ? ' · vous suivez sa vue' : ' · clic : suivre sa vue'}`,
        // un clic sur quelqu'un : on suit sa vue (Figma : « If you click on another person's
        // avatar, you will begin to follow their view ») ; le menu dit le reste
        onclick: (e) => { if (!me && C.follow !== p.cid) startFollow(p.cid); personMenu(e, p, me); },
      }, initials(p.name), (me ? K.on : p.call?.on) ? el('i', { class: 'co-oncall' }) : null,
        !me && C.follow === p.cid ? el('i', { class: 'co-eye' }) : null,
        (me ? C.leadMe : p.lead) ? el('i', { class: 'co-lead' }) : null);
      const shown = ps.slice(0, 5);
      const rest = ps.slice(5);
      fill(who, ...(C.me ? [av({ ...C.me, call: { on: K.on } }, { me: true })] : []),
        ...shown.map(({ best, tabs }) => av(best, { tabs })),
        rest.length ? el('button', { class: 'co-av more', type: 'button', title: rest.map((x) => x.best.name).join(', '),
          onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(r.left, r.bottom + 4, [{ head: 'aussi sur la planche' }, ...rest.map(({ best }) => ({ label: best.name, dot: best.color, onclick: () => goView(best) }))]); } }, `+${rest.length}`) : null);
    }
    paintCallPill();
    // qui enregistre : le voyant, et une ligne quand quelqu'un commence (enregistrer.js)
    REC.watch();
    paintRec();
  }
  function personMenu(e, p, me) {
    const r = e.currentTarget.getBoundingClientRect();
    menu(r.left, r.bottom + 4, [
      { head: me ? `${p.name} · vous${C.role ? ` · ${ROLE_FR[C.role]}` : ''}` : `${p.name}${p.role === 'viewer' ? ' · spectateur' : ''}` },
      me ? { label: C.leadMe ? 'Arrêter « suivez-moi »' : 'Suivez-moi', sub: C.leadMe ? 'chacun reprend sa vue' : 'tous suivent votre vue',
        checked: C.leadMe, onclick: () => lead(!C.leadMe) }
        : { label: C.follow === p.cid ? 'Ne plus suivre' : 'Suivre sa vue', sub: 'un geste sur la planche rompt le suivi', checked: C.follow === p.cid,
          disabled: !p.view, why: 'sa vue n’est pas encore connue', onclick: () => (C.follow === p.cid ? stopFollow() : startFollow(p.cid)) },
      me ? null : { label: 'Aller à sa vue', sub: 'une fois', disabled: !p.view, why: 'sa vue n’est pas encore connue', onclick: () => { stopFollow(); goView(p); } },
      { label: 'Voir où regardent les autres', checked: C.views, onclick: () => { C.views = !C.views; LS('co-views', C.views); schedule(); } },
      !me && p.call?.on ? { label: 'En appel · ouvrir la visio', onclick: () => openDock('visio') } : null,
      C.can?.invite ? '-' : null,
      C.can?.invite ? { label: 'Inviter, rôles…', sub: 'un lien, éditeur ou spectateur', onclick: () => inviteModal() } : null,
    ]);
  }

  // ── suivre la vue de quelqu'un ──────────────────────────────
  // Figma : cliquer sur quelqu'un suit sa vue ; « Spotlight » demande à tous de suivre la
  // sienne (« They'll have a few seconds to click Not now before automatically being shown
  // your view ») ; « Stop following » en haut. Ici : on suit sa vue (le cadre qu'il voit,
  // envoyé avec sa présence), un geste sur la planche rompt le suivi, « reprendre » le rétablit.
  function startFollow(cid, { byLead = false } = {}) {
    const p = C.peers.get(cid);
    if (!p || cid === C.cid) return;
    C.follow = cid; C.byLead = byLead; C.broke = null;
    if (p.view) followView(p.view, true);
    if (byLead) toast(`${p.name} vous fait suivre sa vue — un geste sur la planche, ou « arrêter », vous rend la vôtre`, 5000);
    paintFollow(); C.whoKey = ''; paintWho();
  }
  function stopFollow({ broke = false } = {}) {
    if (!C.follow) return;
    const was = C.follow, p = C.peers.get(was);
    C.follow = null;
    // rompu par un geste : « reprendre » le rétablit (tant qu'il est là)
    C.broke = broke && p ? was : null;
    C.byLead = false;
    paintFollow(); C.whoKey = ''; paintWho();
  }
  function followClick() {
    if (C.follow) stopFollow();
    else if (C.broke && C.peers.has(C.broke)) startFollow(C.broke);
    else { C.broke = null; paintFollow(); }
  }
  function paintFollow() {
    const p = C.peers.get(C.follow || C.broke);
    followPill.hidden = !p;
    if (!p) return;
    followPill.classList.toggle('on', !!C.follow);
    followPill.style.setProperty('--c', col(p.color));
    followPill.lastChild.textContent = C.follow ? `suit ${p.name} · arrêter` : `${p.name}${p.lead ? ' présente' : ''} · reprendre`;
    followPill.title = C.follow ? 'vous suivez sa vue : un geste sur la planche, ou ce bouton, vous rend la vôtre' : 'suivre de nouveau sa vue';
  }
  // sa vue [x, y, w, h] tient dans la mienne, centrée (le vol est court : 20 présences par seconde)
  function followView(v, first = false) {
    if (!v || document.body.classList.contains('at-presenting')) return;
    const cw = cv.clientWidth, ch = cv.clientHeight;
    const [x, y, w, h] = v;
    const z = Math.max(0.08, Math.min(4, cw / Math.max(w, 1), ch / Math.max(h, 1)));
    const to = { x: cw / 2 - (x + w / 2) * z, y: ch / 2 - (y + h / 2) * z, z };
    C.flyT = Date.now();
    if (app.canvas.flyTo) app.canvas.flyTo(to, { ms: first ? 380 : 140 });
    else { Object.assign(S.view, to); app.canvas.applyView?.(); }
  }
  // un geste de celui qui suit (molette, glisser, clavier de la vue) rompt le suivi
  const breakFollow = () => { if (C.follow) stopFollow({ broke: true }); };
  cv.addEventListener('wheel', breakFollow, { capture: true, passive: true });
  cv.addEventListener('pointerdown', (e) => { if (e.button === 0 || e.button === 1) breakFollow(); }, true);
  document.addEventListener('keydown', (e) => {
    if (!C.follow || typing(e.target) || document.querySelector('.scrim')) return;
    if (['+', '=', '-', '_', ' '].includes(e.key) || (e.shiftKey && ['Digit0', 'Digit1'].includes(e.code))) breakFollow();
  }, true);
  // « suivez-moi » : ma présence le dit, les autres me suivent
  function lead(on) {
    C.leadMe = !!on;
    send({ lead: C.leadMe });
    if (on) { stopFollow(); toast('suivez-moi : les autres suivent votre vue', 4000); }
    C.whoKey = ''; paintWho(); paintMini();
  }
  function watchLead(p) {
    const was = C.leads.get(p.cid) || false;
    C.leads.set(p.cid, !!p.lead);
    if (p.lead && !was && !C.leadMe) startFollow(p.cid, { byLead: true });
    if (!p.lead && was) {
      if (C.follow === p.cid && C.byLead) stopFollow();
      if (C.broke === p.cid) { C.broke = null; paintFollow(); }
    }
  }

  // ── le rôle, les invitations ────────────────────────────────
  function paintRole() {
    const r = C.role;
    roleChip.hidden = !r || r === 'editor' || r === 'owner';
    roleChip.textContent = ROLE_FR[r] || '';
    roleChip.title = r === 'viewer' ? `spectateur : vous voyez tout en direct, sans rien modifier${C.can?.comment ? ' ; vous pouvez écrire au fil' : ''}` : '';
    bInvite.hidden = !C.can?.invite;
    bPin.hidden = !!C.can && !C.can.comment;
  }
  async function inviteModal() {
    if (!C.bid) return;
    const bid = C.bid;
    const body = el('div', { class: 'stack co-invite' });
    let A = null;
    const hoursFr = (h) => (h < 24 ? `${h} h` : h === 24 ? '1 jour' : `${h / 24} jours`);
    const left = (t) => { const s = t - Date.now() / 1000; return s <= 0 ? 'expiré' : s < 3600 ? `${Math.ceil(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} j`; };
    const role = el('select', { class: 'fld' }, el('option', { value: 'viewer' }, 'spectateur — voit tout en direct, ne modifie rien'), el('option', { value: 'editor' }, 'éditeur — modifie la planche avec vous'));
    const dur = el('select', { class: 'fld' });
    const out = el('div', { class: 'co-link-out', hidden: true });
    const make = el('button', { class: 'tb go', type: 'button', onclick: async () => {
      make.disabled = true;
      try {
        const r = await api(`ideation/collab/${bid}/invites`, { method: 'POST', body: { role: role.value, hours: Number(dur.value) } });
        const link = new URL(`?invite=${encodeURIComponent(r.token)}#${bid}`, location.href.split('?')[0].split('#')[0]).href;
        const inp = el('input', { class: 'fld', value: link, readonly: true });
        out.hidden = false;
        fill(out, el('span', { class: 'lbl' }, `lien · ${ROLE_FR[r.role]} · ${hoursFr(Number(dur.value))} — il ne s’affiche qu’une fois`), inp,
          el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { inp.select(); navigator.clipboard?.writeText(link).then(() => toast('lien copié'), () => toast('sélectionné : ctrl+C')); } }, 'Copier'));
        setTimeout(() => inp.select(), 30);
        await load();
      } catch (e) { toast(e.message, 6000); } finally { make.disabled = false; }
    } }, 'Créer le lien');
    const lists = el('div', { class: 'stack' });
    const setA = async (patch) => { try { A = await api(`ideation/collab/${bid}/access`, { method: 'POST', body: patch }); paint(); } catch (e) { toast(e.message, 6000); } };
    async function load() { try { A = await api(`ideation/collab/${bid}/access`); paint(); } catch (e) { fill(lists, el('p', { class: 'warn' }, e.message)); } }
    function paint() {
      if (!A) return;
      if (!dur.children.length) fill(dur, ...A.hours.map((h) => el('option', { value: String(h), selected: h === 24 ? true : null }, `valable ${hoursFr(h)}`)));
      const inv = (A.invites || []).map((i) => el('div', { class: 'co-irow' + (i.revoked || i.expired ? ' off' : '') },
        el('span', { class: 'lbl' }, ROLE_FR[i.role]),
        el('span', { class: 'nm' }, i.revoked ? 'retiré' : i.expired ? 'expiré' : `expire dans ${left(i.exp)}`,
          el('small', {}, ` · par ${i.by_name}${i.uses.length ? ` · ouvert par ${i.uses.map((x) => x.name).join(', ')}` : ' · pas encore ouvert'}`)),
        i.revoked || i.expired ? null : el('button', { class: 'tb ghost sm', type: 'button', title: 'le lien ne marche plus ; ce qu’il a donné est retiré',
          onclick: async () => { try { A = await api(`ideation/collab/${bid}/invites/${i.id}/revoke`, { method: 'POST' }); paint(); } catch (e) { toast(e.message); } } }, 'Retirer')));
      const mem = (A.members || []).map((m) => el('div', { class: 'co-irow' },
        el('span', { class: 'nm' }, m.name, el('small', {}, m.via ? ' · par un lien' : '')),
        el('select', { class: 'fld sm', onchange: (e) => setA({ member: { id: m.id, role: e.target.value } }) },
          ...['editor', 'viewer'].map((x) => el('option', { value: x, selected: m.role === x ? true : null }, ROLE_FR[x]))),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => setA({ member: { id: m.id, role: null } }) }, 'Retirer')));
      const comments = el('input', { type: 'checkbox', checked: A.comments ? true : null, onchange: (e) => setA({ comments: e.target.checked }) });
      const open = el('select', { class: 'fld sm', onchange: (e) => setA({ open: e.target.value }) },
        ...[['editor', 'éditeurs'], ['viewer', 'spectateurs'], ['none', 'sans accès']].map(([v, t]) => el('option', { value: v, selected: A.open === v ? true : null }, t)));
      fill(lists,
        el('div', { class: 'co-ihead lbl' }, `les liens · ${inv.length}`), inv.length ? inv : el('p', { class: 'co-empty' }, 'Aucun lien encore.'),
        el('div', { class: 'co-ihead lbl' }, `les personnes invitées · ${mem.length}`), mem.length ? mem : el('p', { class: 'co-empty' }, 'Personne n’a encore de rôle à part sur cette planche.'),
        el('div', { class: 'co-ihead lbl' }, 'réglages'),
        el('label', { class: 'co-irow' }, comments, el('span', { class: 'nm' }, 'les spectateurs peuvent écrire au fil')),
        el('label', { class: 'co-irow' }, el('span', { class: 'nm' }, 'les autres membres du portail y sont'), open));
    }
    fill(body,
      el('p', { class: 'hint' }, `Propriétaire : ${C.me?.name || '—'}. Un lien donne un rôle sur cette planche seulement ; la personne entre par la porte du portail (son pseudo). Un spectateur voit tout en direct — objets, curseurs, fil, visio — et ne modifie rien.`),
      el('div', { class: 'co-irow mk' }, role, dur, make), out, lists);
    app.modal('Inviter sur cette planche', body, null, { cls: 'lg' });
    load();
  }
  // un lien d'invitation ouvert (…/ideation/?invite=<jeton>#<planche>) : la porte d'abord (un pseudo),
  // puis le rôle sur la planche ; une demande neuve est acceptée par le lien (le propriétaire l'a créé)
  async function redeem(tok) {
    for (let i = 0; i < 400; i++) {
      let me = null;
      try { me = await api('auth/me'); } catch { /* le portail ne répond pas : on réessaie */ }
      if (me && (!me.auth || me.state === 'active' || me.state === 'pending')) {
        try {
          const r = await api(`auth/ideation-invite/${encodeURIComponent(tok)}`, { method: 'POST', body: {} });
          toast(`invitation : ${r.role_fr} sur cette planche`, 5000);
          history.replaceState(null, '', `${location.pathname}#${r.board}`);
          setTimeout(() => location.reload(), 600);
          return;
        } catch (e) {
          if ([404, 410, 403].includes(e.status)) {
            toast(e.message, 12000);
            history.replaceState(null, '', location.pathname + location.hash);
            return;
          }
        }
      }
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
  const invTok = new URLSearchParams(location.search).get('invite');
  if (invTok) redeem(invTok);
  function paintCallPill() {
    const n = [...C.peers.values()].filter((p) => p.call?.on).length + (K.on ? 1 : 0);
    callPill.hidden = !n;
    callPill.classList.toggle('on', K.on);
    callPill.lastChild.textContent = K.on ? `en appel · ${n}` : `appel en cours · ${n}`;
    callPill.title = K.on ? 'vous êtes dans l’appel : ouvrir la visio' : 'un appel a lieu sur cette planche : le rejoindre';
    tabLive.hidden = !n;
    paintMini();
  }
  function paintNotice() {
    const mine = S.rev || 0;
    const ahead = [...C.peers.values()].filter((p) => !p.lost && p.rev && p.rev > mine).sort((a, b) => b.rev - a.rev);
    // co-édition : les gestes des autres arrivent d'eux-mêmes ; l'avis ne reste que pour le repli
    notice.hidden = CO.on() || !ahead.length || !S.board || !!S.conflict;
    if (notice.hidden) return;
    const p = ahead[0];
    notice.style.setProperty('--c', col(p.color));
    notice.replaceChildren(el('i'), el('span', {}, `${p.name} a changé la planche · recharger`));
    notice.title = `${p.name} a enregistré la planche (version ${p.rev}, la vôtre ${mine}) : sans co-édition, ses changements n’apparaissent ici qu’en rechargeant`;
  }
  function reloadBoard() {
    if (S.dirty || S.saving) { toast('vos derniers gestes ne sont pas encore enregistrés : rechargez quand la planche dit « enregistrée »', 6000); return; }
    const b = document.getElementById('c-reload');
    if (b) b.click(); else toast('rechargez la page (F5) pour voir la planche de l’autre', 6000);
  }

  // ── la vue : aller où regarde quelqu'un, vers un objet ──────
  function setView(x, y, w, h, zmax = 4) {
    const cw = cv.clientWidth, ch = cv.clientHeight, v = S.view;
    const z = Math.max(0.08, Math.min(zmax, cw / Math.max(w, 1), ch / Math.max(h, 1)));
    v.z = z; v.x = cw / 2 - (x + w / 2) * z; v.y = ch / 2 - (y + h / 2) * z;
    app.canvas.applyView?.();
  }
  function goView(p) {
    if (!p.view) { toast('sa vue n’est pas encore connue'); return; }
    const [x, y, w, h] = p.view;
    setView(x, y, w, h);
  }
  function flyTo(a, id) {
    if (a.node) {
      const n = app.node(a.node);
      if (!n) { toast('cet objet n’est plus sur la planche'); return; }
      setView(n.x - 160, n.y - 120, n.w + 320, n.h + 240, Math.max(1, S.view.z));
    } else {
      const v = S.view;
      v.x = cv.clientWidth / 2 - a.x * v.z; v.y = cv.clientHeight / 2 - a.y * v.z;
      app.canvas.applyView?.();
    }
    C.focus = id;
    paintFil(); schedule();
  }

  // ── sur la planche : curseurs, anneaux, vues, pastilles ─────
  const pool = new Map();
  let raf = 0, seen = null, moveLoop = false;
  function schedule() { if (!raf) raf = requestAnimationFrame(paintLayer); }
  const domOf = (id) => app.canvas.dom?.get?.(id)?.el || cv.querySelector(`[data-id="${CSS.escape(id)}"]`);
  function node(key, make) {
    let e = pool.get(key);
    if (!e) { e = make(); pool.set(key, e); layer.append(e); }
    seen.add(key);
    return e;
  }
  const put = (e, x, y) => { e.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`; };
  function box(e, x, y, w, h) { put(e, x, y); e.style.width = `${Math.round(w)}px`; e.style.height = `${Math.round(h)}px`; }
  function paintLayer() {
    raf = 0;
    seen = new Set();
    const r = cv.getBoundingClientRect();
    const v = S.view;
    const W = r.width, H = r.height;
    layer.classList.toggle('jump', Date.now() - C.viewT < 180);
    const live = [...C.peers.values()].filter((p) => !p.lost);
    // en présentation, seuls les curseurs restent (la diapositive d'abord)
    const full = S.board && C.cid && !C.compact;
    if (full) {
      // « où regarde X »
      if (C.views) for (const p of live) {
        if (!p.view) continue;
        const [x, y, w, h] = p.view;
        const e = node(`v:${p.cid}`, () => el('div', { class: 'co-view' }, el('span', { class: 'co-tag' })));
        e.style.setProperty('--c', col(p.color));
        const sx = x * v.z + v.x, sy = y * v.z + v.y;
        box(e, sx, sy, w * v.z, h * v.z);
        e.firstChild.textContent = `vue · ${p.name}`;
        put(e.firstChild, Math.max(0, Math.min(-sx + 6, W - sx - 120)) , Math.max(0, -sy + 6));
      }
      // les sélections des autres
      for (const p of live) {
        let first = true;
        for (const id of (p.sel || []).slice(0, 60)) {
          const d = domOf(id);
          if (!d) continue;
          const b = d.getBoundingClientRect();
          if (!b.width && !b.height) continue;
          const e = node(`r:${p.cid}:${id}`, () => el('div', { class: 'co-ring' }, el('span', { class: 'co-tag' })));
          e.style.setProperty('--c', col(p.color));
          box(e, b.left - r.left - 5, b.top - r.top - 5, b.width + 10, b.height + 10);
          e.firstChild.hidden = !first;
          e.firstChild.textContent = p.name;
          first = false;
        }
      }
      // les pastilles des messages épinglés (et celle du message qu'on écrit)
      if (C.pins) {
        for (const { root, replies } of threads()) {
          const alive = [root, ...replies].filter((m) => !m.deleted);
          if (!root.anchor || !alive.length) continue;
          const at = anchorAt(root.anchor, r, v);
          if (!at || at[0] < -30 || at[1] < -10 || at[0] > W + 10 || at[1] > H + 40) continue;
          const e = node(`p:${root.id}`, () => el('button', { class: 'co-pin', type: 'button', onpointerdown: stop, ondblclick: stop,
            onclick: (ev) => { ev.stopPropagation(); focusThread(ev.currentTarget.dataset.thr); } }, el('b')));
          e.dataset.thr = root.id;
          e.style.setProperty('--c', col(root.color));
          e.firstChild.textContent = String(alive.length);
          e.title = `${root.name} : ${(alive[0].text || '').slice(0, 140)}${alive.length > 1 ? ` · ${alive.length} messages` : ''}`;
          e.classList.toggle('on', C.focus === root.id);
          e.classList.toggle('new', alive.some((m) => m.user !== C.me?.id && mtime(m) > C.readT));
          put(e, at[0], at[1] - 26);
        }
      }
      if (C.anchor && !C.reply && C.tab === 'fil') {
        const at = anchorAt(C.anchor, r, v);
        if (at) {
          const e = node('draft', () => el('span', { class: 'co-pin draft' }, el('b', {}, '+')));
          e.style.setProperty('--c', col(C.me?.color));
          put(e, at[0], at[1] - 26);
        }
      }
    }
    if (S.board && C.cid) {
      // les curseurs, dessus (aussi pendant une présentation ou un vote)
      for (const p of live) {
        if (p.away || !p.cursor) continue;
        const sx = p.cursor[0] * v.z + v.x, sy = p.cursor[1] * v.z + v.y;
        if (sx < -20 || sy < -20 || sx > W + 4 || sy > H + 4) continue;
        const e = node(`c:${p.cid}`, () => el('div', { class: 'co-cur', html: ARROW }, el('span', { class: 'co-tag' })));
        e.style.setProperty('--c', col(p.color));
        e.lastChild.textContent = p.name;
        put(e, sx, sy);
      }
    }
    for (const [k, e] of pool) if (!seen.has(k)) { e.remove(); pool.delete(k); }
    seen = null;
    // pendant qu'on déplace des objets, les anneaux et pastilles suivent image par image
    if (cv.classList.contains('moving') && !moveLoop) {
      moveLoop = true;
      const loop = () => { if (!cv.classList.contains('moving')) { moveLoop = false; schedule(); return; } paintLayer(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
  }
  function anchorAt(a, r, v) {
    if (a.node) {
      const d = domOf(a.node);
      if (!d) return null;
      const b = d.getBoundingClientRect();
      return [b.right - r.left - 12, b.top - r.top + 12];
    }
    return [a.x * v.z + v.x, a.y * v.z + v.y];
  }
  new MutationObserver(() => { if (cv.classList.contains('moving')) schedule(); }).observe(cv, { attributes: true, attributeFilter: ['class'] });
  new ResizeObserver(() => { schedule(); placeDock(); }).observe(cv);
  addEventListener('resize', () => { placeDock(); schedule(); });

  // ── le fil ──────────────────────────────────────────────────
  function putMsg(m) {
    if (!m?.id) return;
    if (!C.msgs.has(m.id)) C.order.push(m.id);
    C.msgs.set(m.id, m);
  }
  function threads() {
    const roots = [], by = new Map();
    for (const id of C.order) {
      const m = C.msgs.get(id);
      if (!m) continue;
      if (m.reply_to && C.msgs.has(m.reply_to)) { if (!by.has(m.reply_to)) by.set(m.reply_to, []); by.get(m.reply_to).push(m); }
      else roots.push(m);
    }
    return roots.map((root) => ({ root, replies: by.get(root.id) || [] }));
  }
  function unread() {
    let n = 0;
    for (const m of C.msgs.values()) if (!m.deleted && m.user !== C.me?.id && mtime(m) > C.readT) n++;
    return n;
  }
  function markRead() {
    if (document.hidden) return;
    let t = C.readT;
    for (const m of C.msgs.values()) t = Math.max(t, mtime(m));
    if (t !== C.readT) { C.readT = t; LS(`co-read-${C.bid}`, t); }
    paintDots();
  }
  function paintDots() {
    const n = unread();
    filDot.hidden = tabDot.hidden = !n;
    bFil.title = n ? `le fil : ${n} message${n > 1 ? 's' : ''} non lu${n > 1 ? 's' : ''}` : 'le fil de la planche : messages et commentaires épinglés';
    paintMini();
  }
  function onMsg(m) {
    putMsg(m);
    if (C.tab === 'fil' && !document.hidden && !C.compact) markRead();
    paintFil(); paintDots(); schedule();
  }
  function onDel(d) {
    const m = C.msgs.get(d.id);
    if (m) { m.deleted = true; m.text = ''; }
    paintFil(); paintDots(); schedule();
  }
  function anchorChip(a, id) {
    const n = a.node ? app.node(a.node) : null;
    const txt = a.node ? (n ? `« ${app.label(n)} »` : `« ${a.label || a.node} » · retiré`) : 'un point de la planche';
    return el('button', { class: 'co-chip', type: 'button', title: a.node && !n ? 'cet objet n’est plus sur la planche' : 'y aller', onclick: () => flyTo(a, id) }, txt);
  }
  function msgEl(m, root) {
    const mine = m.user === C.me?.id;
    let armed = false;
    const del = !m.deleted && (mine || C.me?.admin) ? el('button', { class: 'co-act', type: 'button', title: 'retirer ce message du fil', onclick: async (e) => {
      const b = e.currentTarget;
      if (!armed) { armed = true; b.textContent = 'Confirmer'; setTimeout(() => { armed = false; b.textContent = 'Retirer'; }, 3000); return; }
      try { await post(`messages/${m.id}/delete`, {}); onDel({ id: m.id }); } catch (err) { toast(err.message, 5000); }
    } }, 'Retirer') : null;
    return el('div', { class: `co-msg${m.deleted ? ' gone' : ''}` },
      el('span', { class: 'co-av sm', style: { '--c': col(m.color) } }, initials(m.name)),
      el('div', { class: 'co-mb' },
        el('div', { class: 'co-mh' }, el('b', {}, m.name), el('time', { datetime: m.t, title: m.t }, when(m.t)), el('span', { class: 'sp' }), del),
        root && m.anchor ? anchorChip(m.anchor, m.id) : null,
        el('div', { class: 'co-mt' }, m.deleted ? 'message retiré' : m.text)));
  }
  function paintFil() {
    const T = threads();
    const n = C.msgs.size;
    filCount.textContent = `fil · ${n} message${n > 1 ? 's' : ''}${C.total > n ? ` (les ${n} derniers)` : ''}`;
    pinsTog.classList.toggle('on', C.pins);
    if (filPane.hidden || dock.hidden) return;
    const near = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.replaceChildren(...(T.length ? T.map(({ root, replies }) => el('article', { class: `co-thr${C.focus === root.id ? ' on' : ''}`, 'data-thr': root.id },
      msgEl(root, true),
      replies.length ? el('div', { class: 'co-reps' }, ...replies.map((m) => msgEl(m, false))) : null,
      el('button', { class: 'co-act rep', type: 'button', onclick: () => replyTo(root) }, replies.length ? `Répondre · ${replies.length} réponse${replies.length > 1 ? 's' : ''}` : 'Répondre')))
      : [el('p', { class: 'co-empty' }, 'Personne n’a encore écrit ici. Un message peut viser un objet ou un point : touche C, puis un clic sur la planche.')]));
    const f = C.focus && list.querySelector(`[data-thr="${CSS.escape(C.focus)}"]`);
    if (f && C.scrollFocus) { f.scrollIntoView({ block: 'nearest' }); C.scrollFocus = false; }
    else if (near || C.bottom) list.scrollTop = list.scrollHeight;
    C.bottom = false;
  }
  function focusThread(id) {
    C.focus = id; C.scrollFocus = true;
    openDock('fil');
    schedule();
  }
  function replyTo(m) {
    C.reply = { id: m.id, name: m.name };
    C.focus = m.id;
    paintComposer(); paintFil(); schedule();
    ta.focus();
  }
  function paintComposer() {
    replyChip.hidden = !C.reply;
    anchorBtn.hidden = !!C.reply;
    if (C.reply) replyChip.textContent = `en réponse à ${C.reply.name} · ×`;
    const a = C.anchor;
    const n = a?.node ? app.node(a.node) : null;
    anchorBtn.textContent = !a ? 'toute la planche' : a.node ? `« ${n ? app.label(n) : a.label} »` : 'un point de la planche';
    anchorBtn.classList.toggle('on', !!a);
    const why = !C.bid ? 'aucune planche ouverte'
      : C.can && !C.can.comment ? 'spectateur : le propriétaire n’a pas ouvert le fil aux spectateurs (vous le lisez)' : '';
    sendBtn.disabled = !!why;
    ta.disabled = !!(C.can && !C.can.comment);
    compWhy.textContent = why;
    schedule();
  }
  function anchorMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const one = S.sel.size === 1 ? app.node([...S.sel][0]) : null;
    menu(r.left, r.bottom + 4, [
      { head: 'épingler ce message' },
      { label: 'Toute la planche', sub: 'sans pastille', checked: !C.anchor, onclick: () => { C.anchor = null; paintComposer(); } },
      { label: one ? `L’objet choisi : « ${app.label(one)} »` : 'L’objet choisi', disabled: !one, why: 'choisissez d’abord un seul objet sur la planche',
        onclick: () => { C.anchor = { node: one.id, label: app.label(one) }; paintComposer(); } },
      { label: 'Un objet ou un point…', key: 'C', onclick: () => pinMode(true) },
    ]);
  }
  async function sendMsg() {
    const text = ta.value.trim();
    if (!text || !C.bid) return;
    sendBtn.disabled = true;
    try {
      const m = await post('messages', { text, anchor: C.reply ? null : C.anchor, reply_to: C.reply?.id || null, cid: C.cid });
      putMsg(m);
      ta.value = '';
      C.focus = m.reply_to || (m.anchor ? m.id : null);
      C.anchor = null; C.reply = null; C.bottom = true;
      markRead();
      paintComposer(); paintFil(); schedule();
    } catch (e) { compWhy.textContent = e.message; }
    finally { sendBtn.disabled = !C.bid; }
  }
  // commenter ici : le prochain clic sur la planche choisit l'objet ou le point
  function pinMode(on) {
    if (on && !S.board) { toast('ouvrez d’abord une planche'); return; }
    if (on && C.can && !C.can.comment) { toast('spectateur : le propriétaire n’a pas ouvert le fil aux spectateurs', 5000); return; }
    C.pinning = on;
    cv.classList.toggle('co-pinning', on);
    bPin.classList.toggle('on', on);
    if (on) toast('cliquez sur un objet ou un point de la planche · Échap : annuler', 4000);
  }
  cv.addEventListener('pointerdown', (e) => {
    if (!C.pinning || e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const id = e.target.closest?.('[data-id]')?.dataset.id;
    const n = id && app.node(id);
    if (n) C.anchor = { node: n.id, label: app.label(n) };
    else { const [x, y] = toWorld(e.clientX, e.clientY); C.anchor = { x: Math.round(x), y: Math.round(y) }; }
    C.reply = null;
    pinMode(false);
    openDock('fil');
    paintComposer();
    setTimeout(() => ta.focus(), 20);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && C.pinning) { pinMode(false); return; }
    if (typing(e.target) || document.querySelector('.scrim') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'c' || e.key === 'C') { if (S.board) { e.preventDefault(); pinMode(!C.pinning); } }
  });

  // ── le bandeau ──────────────────────────────────────────────
  function openDock(tab) {
    if (C.compact) setCompact(false);
    C.tab = tab;
    dock.hidden = false;
    filPane.hidden = tab !== 'fil';
    visPane.hidden = tab !== 'visio';
    tabFil.classList.toggle('on', tab === 'fil'); tabFil.setAttribute('aria-selected', String(tab === 'fil'));
    tabVis.classList.toggle('on', tab === 'visio'); tabVis.setAttribute('aria-selected', String(tab === 'visio'));
    bFil.classList.toggle('on', tab === 'fil');
    bVis.classList.toggle('on', tab === 'visio');
    LS('co-tab', tab);
    placeDock();
    if (tab === 'fil') { C.bottom = !C.focus; paintFil(); markRead(); paintComposer(); }
    else paintCall();
    schedule();
  }
  function closeDock() {
    C.tab = null;
    dock.hidden = true;
    bFil.classList.remove('on'); bVis.classList.remove('on');
    LS('co-tab', null);
    schedule(); paintDots();
  }
  const toggleDock = (tab) => (C.tab === tab && !dock.hidden ? closeDock() : openDock(tab));
  function placeDock() {
    if (dock.hidden) return;
    const insp = document.getElementById('insp');
    let r = insp?.getBoundingClientRect();
    const float = !r || r.width < 240 || r.height < 260;
    if (float) {
      const c = cv.getBoundingClientRect();
      r = { left: c.right - 332, top: c.top + 12, width: 320, height: Math.max(260, c.height - 180) };
    }
    dock.classList.toggle('float', float);
    Object.assign(dock.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }
  const insp = document.getElementById('insp');
  if (insp) new ResizeObserver(placeDock).observe(insp);
  function setCompact(on) {
    if (on === C.compact) return;
    C.compact = on;
    if (on) { C.before = C.tab; dock.hidden = true; }
    else if (C.before) { const t = C.before; C.before = null; openDock(t); }
    paintTiles(); paintMini();
  }
  function paintMini() {
    const n = [...C.peers.values()].filter((p) => p.call?.on).length + (K.on ? 1 : 0);
    const u = unread();
    mini.hidden = !C.compact || (!n && !u && !C.before);
    fill(mini,
      n ? el('span', { class: 'lbl on' }, el('i'), `appel · ${n}`) : null,
      el('span', { class: 'lbl' }, 'fil', u ? el('b', { class: 'co-dot' }) : null));
    leadMini.hidden = !C.compact || !C.peers.size || !!C.follow;
    leadMini.classList.toggle('on', C.leadMe);
    leadMini.classList.toggle('alone', mini.hidden);
    fill(leadMini, el('span', { class: 'lbl' + (C.leadMe ? ' on' : '') }, C.leadMe ? el('i') : null, C.leadMe ? 'on vous suit · arrêter' : 'suivez-moi'));
    leadMini.title = C.leadMe ? 'les autres suivent votre vue : arrêter' : 'demander à tous de suivre votre vue pendant la présentation';
  }
  // ── la visio ────────────────────────────────────────────────
  // les serveurs ICE : STUN du réglage, et le relais TURN s'il est réglé — des identifiants
  // de courte durée (GET …/ice, server/tools/ideation_collab.py), redemandés avant la fin
  async function freshIce() {
    if (C.iceExp && C.iceExp * 1000 - Date.now() > 120000) return;
    try {
      const d = await api(`ideation/collab/${C.bid}/ice`);
      C.ice = d.iceServers || []; C.relay = d.relay || ''; C.relayWhy = d.why || '';
      C.iceExp = d.expires || 0;
      // Cloudflare : « refresh credentials … using RTCPeerConnection.setConfiguration() »
      for (const Q of K.pcs.values()) { try { Q.pc.setConfiguration({ iceServers: C.ice }); } catch { /* */ } }
    } catch (e) { C.relayWhy = e.message; }
    paintRelay();
  }
  setInterval(() => { if (K.on && C.iceExp) freshIce(); }, 5 * 60000);
  function paintRelay() {
    const has = !!C.relay && !C.relayWhy;
    relayChip.textContent = has ? 'relais' : 'stun seul';
    relayChip.classList.toggle('ok', has);
    relayChip.title = has ? `un relais TURN (${C.relay}) : la visio passe aussi d’un réseau à l’autre`
      : C.relayWhy ? `le relais TURN ne répond pas : ${C.relayWhy}` : NO_RELAY;
    const failed = [...K.pcs.values()].some((Q) => Q.pc.connectionState === 'failed');
    VZ.note.hidden = has && !failed;
    fill(VZ.note, el('span', {}, failed && !has ? `pas de chemin réseau vers quelqu’un : ${NO_RELAY}` : has ? 'pas de chemin réseau vers quelqu’un, même par le relais : réessayez, ou vérifiez le réseau' : C.relayWhy ? `relais en panne (${C.relayWhy}) : hors du même réseau, la visio peut ne pas passer` : NO_RELAY));
    VZ.note.title = VZ.note.textContent;
  }

  const audioTrack = () => K.local?.getAudioTracks()[0] || null;
  const videoTrack = () => K.screen || (K.cam ? K.local?.getVideoTracks()[0] : null) || null;
  function stopLocal() {
    for (const t of K.local?.getTracks() || []) t.stop();
    K.screen?.stop();
    K.local = null; K.screen = null; K.cam = false;
  }
  const sendCall = () => send({ call: K.on ? callState() : null });
  function gate(kind) {
    const why = !HAS_RTC ? 'ce navigateur n’a pas WebRTC'
      : !SECURE ? INSECURE
        : kind === 'screen' && !CAN_SCREEN ? 'ce navigateur ne partage pas l’écran'
          : !K.on ? 'rejoignez d’abord l’appel' : '';
    if (why) toast(why, 7000);
    return !why;
  }
  async function joinCall() {
    if (K.on || K.joining) return;
    if (!HAS_RTC) { toast('ce navigateur n’a pas WebRTC : la visio ne peut pas s’ouvrir ici', 6000); return; }
    if (!C.cid) { toast('la planche n’est pas encore reliée au portail : un instant', 4000); return; }
    K.joining = true; K.camWhy = ''; K.micWhy = '';
    paintCall();
    TALK.start();   // le geste qui rejoint ouvre aussi l'AudioContext (qui parle)
    await freshIce();
    if (SECURE) {
      try { K.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: VIDEO }); K.cam = true; } catch (e1) {
        K.camWhy = mediaWhy(e1, 'la caméra');
        try { K.local = await navigator.mediaDevices.getUserMedia({ audio: true }); K.cam = false; } catch (e2) {
          K.local = null; K.cam = false; K.micWhy = mediaWhy(e2, 'le micro');
        }
      }
    }
    K.on = true;
    delete P.pend.call;
    try { await post('presence', { cid: C.cid, call: callState() }); } catch (e) {
      K.on = false; K.joining = false; stopLocal(); TALK.stop();
      toast(e.message, 7000); paintCall(); return;
    }
    K.joining = false;
    VZ.show(true);
    reconcile(true); paintWho(); paintCall(); paintTiles();
  }
  function leaveCall(silent = false) {
    // quitter l'appel arrête l'enregistrement : ce qui est pris se range (enregistrer.js)
    if (REC.on()) REC.stop();
    for (const cid of [...K.pcs.keys()]) closePeer(cid);
    stopLocal();
    TALK.stop();
    K.on = false;
    if (!silent) send({ call: null });
    // la fenêtre détachée se referme avec l'appel ; le panneau se cache
    if (FEN.detache('visio')) FEN.rattacher('visio');
    VZ.show(false);
    paintTiles(); paintWho(); paintCall();
  }
  function toggleMic() {
    if (!gate('mic')) return;
    const t = audioTrack();
    if (!t) { reacquire('audio'); return; }
    t.enabled = !t.enabled;
    sendCall(); paintTiles(); paintCall();
  }
  async function reacquire(kind) {
    try {
      const s = await navigator.mediaDevices.getUserMedia(kind === 'audio' ? { audio: true } : { video: VIDEO });
      if (!K.local) K.local = new MediaStream();
      for (const t of s.getTracks()) K.local.addTrack(t);
      if (kind === 'audio') { K.micWhy = ''; await push('audio'); } else { K.cam = true; K.camWhy = ''; await push('video'); }
    } catch (e) {
      const w = mediaWhy(e, kind === 'audio' ? 'le micro' : 'la caméra');
      if (kind === 'audio') K.micWhy = w; else K.camWhy = w;
      toast(w, 7000);
    }
    sendCall(); paintTiles(); paintCall();
  }
  async function toggleCam() {
    if (!gate('cam')) return;
    if (K.cam) {
      const t = K.local?.getVideoTracks()[0];
      if (t) { t.stop(); K.local.removeTrack(t); }
      K.cam = false;
      await push('video');
      sendCall(); paintTiles(); paintCall();
    } else reacquire('video');
  }
  async function toggleScreen() {
    if (!gate('screen')) return;
    if (K.screen) { K.screen.stop(); K.screen = null; } else {
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        K.screen = s.getVideoTracks()[0];
        K.screen.addEventListener('ended', () => { K.screen = null; push('video'); sendCall(); paintTiles(); paintCall(); });
      } catch (e) {
        if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') toast(mediaWhy(e, 'le partage d’écran'), 7000);
        return;
      }
    }
    await push('video');
    sendCall(); paintTiles(); paintCall();
  }
  async function push(kind) {
    const t = kind === 'audio' ? audioTrack() : videoTrack();
    for (const Q of K.pcs.values()) {
      for (const tr of Q.pc.getTransceivers()) {
        if (tr.receiver.track?.kind === kind && tr.currentDirection !== 'stopped') await tr.sender.replaceTrack(t).catch(() => {});
      }
    }
  }
  // le maillage : chaque paire d'onglets dans l'appel, l'offre vient du plus petit cid
  function reconcile(force = false) {
    if (!HAS_RTC) return;
    const want = new Set();
    if (K.on && C.cid) for (const [cid, p] of C.peers) if (p.call?.on) want.add(cid);
    for (const cid of [...K.pcs.keys()]) if (!want.has(cid)) closePeer(cid);
    for (const cid of want) {
      const Q = K.pcs.get(cid);
      const stale = Q && Q.offerer && Date.now() - Q.t > 8000
        && (['failed', 'closed'].includes(Q.pc.connectionState) || Q.pc.signalingState === 'have-local-offer');
      if (stale) closePeer(cid);
      if (!K.pcs.has(cid) && C.cid < cid) offerTo(cid);
    }
    const key = `${K.on}|${[...K.pcs.entries()].map(([cid, Q]) => `${cid}:${Q.pc.connectionState}:${JSON.stringify(C.peers.get(cid)?.call)}`).join(';')}`;
    if (force || key !== C.callKey) { C.callKey = key; paintTiles(); paintCall(); }
    paintCallPill();
    REC.sync();   // une personne arrivée pendant l'enregistrement entre dans le mélange
  }
  function newPeer(cid, offerer) {
    const pc = new RTCPeerConnection({ iceServers: C.ice || [] });
    const Q = { cid, pc, offerer, stream: new MediaStream(), t: Date.now() };
    pc.ontrack = (e) => { Q.stream.addTrack(e.track); e.track.addEventListener('unmute', () => paintTiles()); paintTiles(); REC.sync(); };
    pc.onconnectionstatechange = () => { Q.t = Date.now(); reconcile(true); };
    K.pcs.set(cid, Q);
    return Q;
  }
  function closePeer(cid) {
    const Q = K.pcs.get(cid);
    if (!Q) return;
    K.pcs.delete(cid);
    try { Q.pc.close(); } catch { /* */ }
  }
  const gathered = (pc) => new Promise((res) => {
    if (pc.iceGatheringState === 'complete') { res(); return; }
    // un relais au loin se rassemble moins vite que le réseau de la maison (sans « trickle »,
    // l'offre part avec ce qui est là au bout du délai)
    const t = setTimeout(res, C.relay ? 4000 : 2500);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });
  // pas de « trickle » : l'offre part avec tous ses candidats (réseau local, rassemblés en quelques ms)
  async function offerTo(cid) {
    const Q = newPeer(cid, true);
    try {
      const a = Q.pc.addTransceiver('audio', { direction: 'sendrecv' });
      const v = Q.pc.addTransceiver('video', { direction: 'sendrecv' });
      await a.sender.replaceTrack(audioTrack());
      await v.sender.replaceTrack(videoTrack());
      await Q.pc.setLocalDescription(await Q.pc.createOffer());
      await gathered(Q.pc);
      if (K.pcs.get(cid) !== Q) return;
      await post('signal', { cid: C.cid, to: cid, kind: 'offer', data: Q.pc.localDescription.toJSON() });
    } catch (e) { Q.err = e.message; console.warn('collab · offre', e); }
  }
  async function onSig(d) {
    const from = d.from;
    if (d.kind === 'bye') { closePeer(from); reconcile(true); return; }
    if (!K.on) { post('signal', { cid: C.cid, to: from, kind: 'bye' }).catch(() => {}); return; }
    if (d.kind === 'offer') {
      closePeer(from);
      const Q = newPeer(from, false);
      try {
        await Q.pc.setRemoteDescription(d.data);
        for (const tr of Q.pc.getTransceivers()) {
          tr.direction = 'sendrecv';
          await tr.sender.replaceTrack(tr.receiver.track?.kind === 'audio' ? audioTrack() : videoTrack());
        }
        await Q.pc.setLocalDescription(await Q.pc.createAnswer());
        await gathered(Q.pc);
        if (K.pcs.get(from) !== Q) return;
        await post('signal', { cid: C.cid, to: from, kind: 'answer', data: Q.pc.localDescription.toJSON() });
      } catch (e) { Q.err = e.message; console.warn('collab · réponse', e); }
    } else if (d.kind === 'answer') {
      const Q = K.pcs.get(from);
      if (Q?.pc.signalingState === 'have-local-offer') await Q.pc.setRemoteDescription(d.data).catch((e) => { Q.err = e.message; });
    }
    reconcile(true);
  }

  // les vignettes
  const tilePool = new Map();
  function tile(key) {
    let t = tilePool.get(key);
    if (!t) {
      const v = el('video', { autoplay: true, playsinline: true });
      v.muted = key === 'me';
      // les icônes d'état (micro coupé, caméra coupée) : chez chacun, d'après la présence (call)
      const icos = el('span', { class: 'co-icos' },
        el('span', { class: 'vz-ico co-i-mic', title: 'micro coupé', html: `<svg viewBox="0 0 24 24" aria-hidden="true">${VZ_ICO.micOff}</svg>` }),
        el('span', { class: 'vz-ico co-i-cam', title: 'caméra coupée', html: `<svg viewBox="0 0 24 24" aria-hidden="true">${VZ_ICO.camOff}</svg>` }));
      t = { el: el('figure', { class: 'co-tile', role: 'listitem' }, v, el('span', { class: 'co-ph' }), el('span', { class: 'co-state lbl' }), icos,
        el('figcaption', {}, el('span', { class: 'nm' }), el('i', { class: 'co-flag' }))), v, src: null };
      t.el.addEventListener('click', () => { if (t.v.paused) t.v.play().then(() => t.el.classList.remove('blocked')).catch(() => {}); });
      tilePool.set(key, t);
    }
    return t;
  }
  function paintTiles() {
    const want = [];
    if (K.on) want.push({ key: 'me', name: C.me?.name || 'vous', color: C.me?.color, call: callState(), stream: null });
    for (const [cid, Q] of K.pcs) {
      const p = C.peers.get(cid);
      want.push({ key: cid, name: p?.name || '…', color: p?.color, call: p?.call, Q });
    }
    const keep = new Set(want.map((w) => w.key));
    for (const [k, t] of tilePool) if (!keep.has(k)) { t.v.srcObject = null; t.el.remove(); tilePool.delete(k); }
    for (const w of want) {
      const t = tile(w.key);
      t.el.style.setProperty('--c', col(w.color));
      t.el.querySelector('.nm').textContent = w.key === 'me' ? `${w.name} · vous` : w.name;
      t.el.querySelector('.co-ph').textContent = initials(w.name);
      let src;
      if (w.key === 'me') {
        const vt = videoTrack();
        if (t.track !== vt) { t.track = vt; t.v.srcObject = vt ? new MediaStream([vt]) : null; }
        src = t.v.srcObject;
      } else if (t.src !== w.Q.stream) { t.src = w.Q.stream; t.v.srcObject = w.Q.stream; }
      if (t.v.srcObject && t.v.paused && !t.trying) {
        t.trying = true;
        t.v.play().then(() => t.el.classList.remove('blocked')).catch(() => t.el.classList.add('blocked')).finally(() => { t.trying = false; });
      }
      const cam = !!(w.call?.cam || w.call?.screen);
      const st = w.Q ? w.Q.pc.connectionState : 'connected';
      t.el.classList.toggle('nocam', !cam || (w.key === 'me' && !src));
      t.el.classList.toggle('mirror', w.key === 'me' && !K.screen);
      t.el.classList.toggle('screen', !!w.call?.screen);
      t.el.classList.toggle('mute', !w.call?.mic);
      t.el.classList.toggle('camoff', !cam);
      t.el.classList.toggle('wait', !!w.Q && st !== 'connected');
      t.el.classList.toggle('talk', !!C.talk && C.talk === w.key && !!w.call?.mic && want.length > 1);
      t.el.querySelector('.co-state').textContent = !w.Q || st === 'connected' ? (w.call?.recv ? 'écoute' : '')
        : st === 'failed' ? 'pas de chemin réseau' : st === 'disconnected' ? 'coupé…' : 'connexion…';
      t.el.querySelector('.co-flag').textContent = w.call?.screen ? 'écran' : '';
      t.el.setAttribute('aria-label', `${w.name}${w.call?.mic ? '' : ', micro coupé'}${cam ? '' : ', caméra coupée'}`);
      // à sa place seulement : une vidéo qu'on déplace dans la page peut s'arrêter
      const i = want.indexOf(w);
      const grid = VZ.grid;
      if (grid.children[i] !== t.el) grid.insertBefore(t.el, grid.children[i] || null);
    }
    // qui parle : la piste son de chacun (la mienne, celle reçue de chaque personne)
    const tracks = new Map();
    for (const w of want) tracks.set(w.key, w.key === 'me' ? audioTrack() : w.Q.stream.getAudioTracks()[0] || null);
    TALK.set(tracks);
    VZ.count(want.length);
    VZ.faces(want.map((w) => ({ name: w.key === 'me' ? `${w.name} · vous` : w.name, color: col(w.color), initials: initials(w.name),
      talk: C.talk === w.key && !!w.call?.mic, mute: !w.call?.mic })));
    paintRelay();
  }
  function paintCall() {
    const inCall = [...C.peers.values()].filter((p) => p.call?.on);
    const https = SECURE ? '' : httpsHere();
    const warn = !HAS_RTC ? ['ce navigateur n’a pas WebRTC : la visio ne peut pas s’ouvrir ici.']
      : !SECURE ? [`${INSECURE[0].toUpperCase()}${INSECURE.slice(1)}.`,
        https ? 'Pour parler et montrer : la même planche par l’adresse https du portail (« Ouvrir en https »). Ici, on peut seulement écouter.'
          : 'Pour parler et montrer : ouvrir le portail par localhost (un tunnel ssh : ssh -L 8790:127.0.0.1:8790 dgx2, puis http://localhost:8790/). Ici, on peut seulement écouter.']
        : [K.camWhy, K.micWhy].filter(Boolean);
    visWarn.hidden = !warn.length;
    fill(visWarn, ...warn.map((w) => el('p', {}, w)),
      !SECURE && HAS_RTC ? el('a', { href: MDN, target: '_blank', rel: 'noopener' }, 'contexte sécurisé · MDN ↗') : null);
    // sur une page qui n'est pas sûre : éteint, il dit pourquoi, et « Ouvrir en https » y mène
    const insecure = HAS_RTC && !SECURE && !K.on;
    bJoin.disabled = !HAS_RTC || K.joining || (!C.cid && !insecure);
    bJoin.setAttribute('aria-disabled', insecure ? 'true' : 'false');
    bJoin.classList.toggle('why', insecure);
    bJoin.title = insecure ? `${INSECURE}${https ? ' : « Ouvrir en https » ouvre la même planche par l’adresse sûre' : ''}`
      : !C.cid ? 'la planche n’est pas encore reliée au portail' : '';
    bJoin.className = `${K.on ? 'tb ghost sm' : 'tb on sm'}${insecure ? ' why' : ''}`;
    bJoin.textContent = K.joining ? 'ouverture…' : K.on ? 'Quitter l’appel' : !SECURE ? 'Rejoindre en visio' : inCall.length ? 'Rejoindre en visio' : 'Lancer la visio';
    bHttps.hidden = !insecure || !https;
    if (https) { bHttps.href = https; bHttps.title = `la même planche, dans le même Workspace, par ${new URL(https).host} : la caméra et le micro y sont permis`; }
    bListen.hidden = !insecure || !C.cid;
    bShow.hidden = !K.on;
    const cs = callState();
    const off = (b, on, why, tip) => {
      b.setAttribute('aria-disabled', why ? 'true' : 'false');
      b.setAttribute('aria-pressed', String(!!on));
      b.classList.toggle('on', !!on);
      b.title = why || tip;
    };
    const need = !HAS_RTC ? 'ce navigateur n’a pas WebRTC' : !SECURE ? INSECURE : !K.on ? 'rejoignez d’abord l’appel' : '';
    off(bMic, K.on && cs.mic, need || (K.on && !audioTrack() ? K.micWhy || 'pas de micro : cliquer pour réessayer' : ''),
      cs.mic ? 'couper le micro (les autres voient l’icône)' : 'rétablir le micro');
    off(bCam, K.on && cs.cam, need || (K.on && !K.cam && K.camWhy ? K.camWhy : ''),
      cs.cam ? 'couper la caméra (les autres voient l’icône)' : 'rétablir la caméra');
    off(bScr, K.on && cs.screen, need || (!CAN_SCREEN ? 'ce navigateur ne partage pas l’écran' : ''),
      cs.screen ? 'arrêter de partager l’écran' : 'partager l’écran (une fenêtre, un onglet, l’écran entier)');
    // un mot désactivé dit pourquoi, et reste cliquable pour le redire (règle 7)
    for (const b of [bMic, bCam, bScr]) if (b.getAttribute('aria-disabled') === 'true' && b.title) b.classList.add('why'); else b.classList.remove('why');
    const rows = [];
    if (K.on) rows.push({ name: `${C.me?.name} · vous`, color: C.me?.color, call: cs, st: 'connected' });
    for (const p of inCall) rows.push({ name: p.name, color: p.color, call: p.call, st: K.pcs.get(p.cid)?.pc.connectionState || (K.on ? 'new' : '') });
    visList.replaceChildren(...(rows.length ? rows.map((r) => el('div', { class: 'co-vrow2' },
      el('span', { class: 'co-av sm', style: { '--c': col(r.color) } }, initials(r.name)),
      el('span', { class: 'nm' }, r.name),
      el('span', { class: 'lbl' }, [r.call?.recv ? 'écoute' : r.call?.mic ? 'micro' : 'muet', r.call?.cam ? 'caméra' : '', r.call?.screen ? 'écran' : ''].filter(Boolean).join(' · ')),
      r.st && r.st !== 'connected' ? el('span', { class: `lbl st ${r.st}` }, r.st === 'failed' ? 'pas de chemin' : r.st === 'new' || r.st === 'connecting' ? 'connexion' : r.st) : null))
      : [el('p', { class: 'co-empty' }, 'Personne n’est en appel sur cette planche.')]));
    visNote.textContent = `l’image et le son vont directement d’un navigateur à l’autre (${C.limits.call || 6} personnes au plus) ; `
      + (C.relay ? `hors du même réseau, par le relais TURN (${C.relay}).` : NO_RELAY);
    paintCallPill();
    paintRec();
  }
  // un contrôle désactivé reste cliquable : il dit pourquoi
  for (const b of [bMic, bCam, bScr]) b.addEventListener('click', (e) => { if (b.getAttribute('aria-disabled') === 'true') { e.stopImmediatePropagation(); if (b.title) toast(b.title, 7000); } }, true);

  // l'enregistrement : le bouton (qui dit pourquoi s'il est éteint), le temps, l'état de la
  // transcription ; le voyant de qui enregistre, dans la barre et le bandeau, chez chacun
  function paintRec() {
    const on = REC.on(), why = on ? '' : REC.why();
    bRec.setAttribute('aria-pressed', String(on));
    bRec.setAttribute('aria-disabled', why ? 'true' : 'false');
    bRec.classList.toggle('on', on);
    bRec.classList.toggle('why', !!why);
    bRec.title = why || (on ? 'arrêter : le son se range dans la bibliothèque, une carte son se pose sur la planche' : 'enregistrer le son de l’appel (le mélange de tous) : chacun verra le voyant ENREGISTREMENT');
    bRec.lastChild.textContent = on ? `Arrêter · ${REC.clock(REC.seconds())}` : 'Enregistrer';
    const L = REC.last();
    recSt.textContent = on ? 'chacun voit le voyant' : L?.state || (L?.it ? `rangé : ${L.it.title}` : '');
    const ws = REC.who();
    recPill.hidden = !ws.length;
    recPill.lastChild.textContent = ws.length ? `enregistrement · ${ws.join(', ')}` : '';
    recPill.title = ws.length ? `${ws.join(', ')} enregistre${ws.length > 1 ? 'nt' : ''} le son de l’appel` : '';
    VZ.root.classList.toggle('rec', !!ws.length);
    VZ.bub.classList.toggle('rec', !!ws.length);
    tabVis.classList.toggle('rec', !!ws.length);
  }
  function paintAll() {
    C.whoKey = '';
    paintWho(); paintNotice(); paintDots(); paintFil(); paintComposer(); paintTiles(); paintCall(); paintRole(); paintFollow(); paintRec(); schedule();
  }

  // pour les essais (playwright) et le module de présentation
  app.collab = { C, K, CO, rec: REC, open: openDock, close: closeDock, present: setCompact, pin: pinMode, stream: { open, close: closeStream },
    follow: startFollow, unfollow: stopFollow, lead, invite: inviteModal };
  const t0 = LS('co-tab');
  // venu de « Ouvrir en https » (une page http du réseau local) : l'onglet Visio, ouvert
  // (l'adresse de la navigation : ideation.js a pu déjà réécrire celle de la page)
  let nav = location.href;
  try { nav = performance.getEntriesByType('navigation')[0]?.name || nav; } catch { /* */ }
  const qv = new URLSearchParams(location.search);
  if (new URL(nav).searchParams.has('visio') || qv.has('visio')) {
    if (qv.has('visio')) {
      qv.delete('visio');
      history.replaceState(history.state, '', `${location.pathname}${qv.toString() ? `?${qv}` : ''}${location.hash}`);
    }
    openDock('visio');
  } else if (t0 === 'fil' || t0 === 'visio') openDock(t0);
  paintAll();
  if (S.board) connect(S.board.id);
}
