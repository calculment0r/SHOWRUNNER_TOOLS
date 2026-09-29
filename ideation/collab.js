// IDÉATION — à plusieurs, greffé sur la planche sans toucher au canvas
// (plugins.js) : qui est là (la barre), les curseurs nommés et colorés des
// autres, leur sélection (un anneau à leur couleur), « où regarde X » (un
// cadre en option), le fil de la planche (messages ancrés à un objet ou à un
// point, pastilles sur la planche, point corail quand le fil est fermé) et
// la visio (WebRTC pair à pair : bandeau de vignettes repliable au-dessus de
// la planche, caméra, micro, partage d'écran). Le fil et la visio partagent
// un même bandeau à onglets, posé sur la colonne de l'inspecteur ; en mode
// présentation, tout se réduit à une pastille.
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

import { api, el, toast, href, $ } from '../commun/shell.js';
import { menu } from '../commun/menu.js';

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
    views: LS('co-views') === true, pins: LS('co-pins') !== false, fold: LS('co-fold') === true, compact: false, before: null,
    cursor: null, last: null, selKey: '', rev: null, viewT: 0, whoKey: '', callKey: '',
  };
  const K = { on: false, joining: false, local: null, cam: false, screen: null, pcs: new Map(), camWhy: '', micWhy: '' };

  // ── la barre : qui est là, l'appel, le fil, la visio ─────────
  const linkSt = el('span', { class: 'pill co-link', hidden: true, role: 'status' }, el('i'), el('span'));
  const who = el('div', { class: 'co-who', role: 'list', 'aria-label': 'sur la planche' });
  const notice = el('button', { class: 'co-notice', type: 'button', hidden: true, onclick: () => reloadBoard() });
  const callPill = el('button', { class: 'co-callpill', type: 'button', hidden: true, onclick: () => openDock('visio') }, el('i'), el('span'));
  const bPin = el('button', { class: 'co-ic', type: 'button', 'aria-label': 'commenter ici', title: 'commenter ici : un message épinglé sur un objet ou un point de la planche · C', onclick: () => pinMode(!C.pinning) }, svg(ICO.pin));
  const filDot = el('b', { class: 'co-dot', hidden: true });
  const bFil = el('button', { class: 'co-ic', type: 'button', 'aria-label': 'le fil', title: 'le fil de la planche : messages et commentaires épinglés', onclick: () => toggleDock('fil') }, svg(ICO.fil), filDot);
  const bVis = el('button', { class: 'co-ic', type: 'button', 'aria-label': 'la visio', title: 'la visio de la planche', onclick: () => toggleDock('visio') }, svg(ICO.cam));
  const barBox = el('div', { class: 'co-bar' }, linkSt, notice, who, callPill, bPin, bFil, bVis);
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
  const bJoin = el('button', { class: 'tb on sm', type: 'button', onclick: () => (K.on ? leaveCall() : joinCall()) });
  const ctl = (kind, label, fn) => el('button', { class: 'co-ctlb', type: 'button', 'aria-pressed': 'false', onclick: fn }, svg(ICO[kind]), el('span', {}, label));
  const bMic = ctl('mic', 'Micro', () => toggleMic());
  const bCam = ctl('cam', 'Caméra', () => toggleCam());
  const bScr = ctl('screen', 'Écran', () => toggleScreen());
  const stripTog = el('button', { class: 'co-tog', type: 'button', title: 'le bandeau des vignettes, au-dessus de la planche', onclick: () => fold(!C.fold) }, 'vignettes');
  const visNote = el('p', { class: 'co-note' });
  visPane.append(
    el('div', { class: 'co-fhead' }, el('span', { class: 'lbl' }, 'visio · pair à pair'), el('span', { class: 'sp' }), stripTog),
    visWarn, visList,
    el('div', { class: 'co-vrow' }, bJoin, el('div', { class: 'co-ctl' }, bMic, bCam, bScr)),
    visNote);

  // le bandeau des vignettes : au-dessus de la planche, jamais sur les outils
  const tiles = el('div', { class: 'co-tiles' });
  const strip = el('div', { class: 'co-strip', hidden: true, 'aria-label': 'vignettes de l’appel' },
    el('button', { class: 'co-fold', type: 'button', title: 'replier les vignettes (la visio reste ouverte)', onclick: () => fold(true) }, el('span', { class: 'lbl' }, 'appel'), el('span', { class: 'lbl co-n' })),
    tiles);
  const ideMain = $('.ide-main');
  if (ideMain?.parentNode) ideMain.parentNode.insertBefore(strip, ideMain); else { strip.classList.add('in-cv'); cv.append(strip); }

  // sur la planche : curseurs, anneaux, cadres de vue, pastilles
  const layer = el('div', { class: 'co-layer', 'aria-hidden': 'true' });
  const mini = el('button', { class: 'co-mini', type: 'button', hidden: true, title: 'le fil et la visio, réduits pendant la présentation', onclick: () => setCompact(false) });
  cv.append(layer, mini);

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
    if (C.es) C.es.close();
    C.es = null;
  }
  function open(resume) {
    closeStream();
    if (!C.bid) return;
    const g = C.gen;
    const q = resume && C.cid ? `?resume=${encodeURIComponent(C.cid)}` : '';
    const es = new EventSource(url(`ideation/collab/${C.bid}/stream${q}`));
    C.es = es;
    if (!C.cid) setLink('work', 'connexion');
    const on = (ev, fn) => es.addEventListener(ev, (e) => {
      if (g !== C.gen) return;
      let d;
      try { d = JSON.parse(e.data); } catch { return; }
      try { fn(d); } catch (err) { console.error('collab ·', ev, err); }
    });
    on('hello', onHello); on('p', onPresence); on('join', onJoin); on('leave', onLeave);
    on('msg', onMsg); on('del', onDel); on('sig', onSig); on('bye', onBye);
    es.onerror = () => { if (g !== C.gen) return; es.close(); C.es = null; lost(g); };
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
    C.cid = d.cid; C.me = d.me; C.ice = d.ice || []; C.limits = d.limits || {}; C.retry = 0; C.total = d.total || 0;
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
    paintAll();
    reconcile(true);
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
    paintWho(); paintNotice(); schedule(); reconcile();
  }
  function onJoin(p) { if (p.cid !== C.cid) C.peers.set(p.cid, p); paintWho(); schedule(); reconcile(); }
  function onLeave(d) { C.peers.delete(d.cid); closePeer(d.cid); paintWho(); paintNotice(); schedule(); reconcile(); }

  function connect(bid) {
    if (bid === C.bid) { if (bid && !C.es && !C.retryT) open(true); return; }
    if (C.bid) {
      if (K.on) { leaveCall(true); toast('appel quitté : une autre planche s’ouvre', 4000); }
      if (C.cid) beacon('leave', { cid: C.cid });
    }
    closeStream();
    Object.assign(C, { bid, cid: null, me: null, anchor: null, reply: null, focus: null, total: 0, rev: null });
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
  const callState = () => ({ on: K.on, mic: !!audioTrack()?.enabled, cam: K.cam && !!K.local?.getVideoTracks()[0], screen: !!K.screen, recv: !K.local?.getTracks().length });
  function sendFull() {
    C.selKey = [...S.sel].join(',');
    C.rev = S.rev ?? null;
    send({ cursor: C.cursor, sel: [...S.sel].slice(0, 200), view: viewArr(), away: document.hidden, rev: C.rev, call: K.on ? callState() : null });
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
    const on = cv.contains(e.target) && !e.target.closest?.('.co-mini, .zoombox, .mini, .co-strip, .co-pin');
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
    setCompact(!!f && f !== document.documentElement && f !== document.body && f.contains(cv));
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
    const key = `${C.me?.color}|${C.me?.name}|${K.on}|` + ps.map(({ best: p, tabs }) => `${p.cid}:${p.name}:${p.color}:${p.away}:${p.lost}:${p.call?.on}:${tabs}`).join(';');
    if (key !== C.whoKey) {
      C.whoKey = key;
      const av = (p, { me = false, tabs = 1 } = {}) => el('button', {
        class: `co-av${me ? ' me' : ''}${p.away ? ' away' : ''}${p.lost ? ' lost' : ''}`, type: 'button', role: 'listitem',
        style: { '--c': col(p.color) },
        title: me ? `${p.name} · vous` : `${p.name}${p.lost ? ' · connexion coupée' : p.away ? ' · ailleurs (onglet caché)' : ''}${tabs > 1 ? ` · ${tabs} onglets` : ''}${p.call?.on ? ' · en appel' : ''}`,
        onclick: (e) => personMenu(e, p, me),
      }, initials(p.name), (me ? K.on : p.call?.on) ? el('i', { class: 'co-oncall' }) : null);
      const shown = ps.slice(0, 5);
      const rest = ps.slice(5);
      fill(who, ...(C.me ? [av({ ...C.me, call: { on: K.on } }, { me: true })] : []),
        ...shown.map(({ best, tabs }) => av(best, { tabs })),
        rest.length ? el('button', { class: 'co-av more', type: 'button', title: rest.map((x) => x.best.name).join(', '),
          onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(r.left, r.bottom + 4, [{ head: 'aussi sur la planche' }, ...rest.map(({ best }) => ({ label: best.name, dot: best.color, onclick: () => goView(best) }))]); } }, `+${rest.length}`) : null);
    }
    paintCallPill();
  }
  function personMenu(e, p, me) {
    const r = e.currentTarget.getBoundingClientRect();
    menu(r.left, r.bottom + 4, [
      { head: me ? `${p.name} · vous` : p.name },
      me ? null : { label: 'Aller à sa vue', sub: 'ce qu’il regarde', disabled: !p.view, why: 'sa vue n’est pas encore connue', onclick: () => goView(p) },
      { label: 'Voir où regardent les autres', checked: C.views, onclick: () => { C.views = !C.views; LS('co-views', C.views); schedule(); } },
      !me && p.call?.on ? { label: 'En appel · ouvrir la visio', onclick: () => openDock('visio') } : null,
    ]);
  }
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
    notice.hidden = !ahead.length || !S.board || !!S.conflict;
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
    const why = !C.bid ? 'aucune planche ouverte' : '';
    sendBtn.disabled = !!why;
    if (why) compWhy.textContent = why;
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
  }
  function fold(on) {
    C.fold = on;
    LS('co-fold', on);
    paintTiles(); paintCall();
  }

  // ── la visio ────────────────────────────────────────────────
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
      K.on = false; K.joining = false; stopLocal();
      toast(e.message, 7000); paintCall(); return;
    }
    K.joining = false;
    if (C.fold) fold(false);
    reconcile(true); paintWho(); paintCall();
  }
  function leaveCall(silent = false) {
    for (const cid of [...K.pcs.keys()]) closePeer(cid);
    stopLocal();
    K.on = false;
    if (!silent) send({ call: null });
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
  }
  function newPeer(cid, offerer) {
    const pc = new RTCPeerConnection({ iceServers: C.ice || [] });
    const Q = { cid, pc, offerer, stream: new MediaStream(), t: Date.now() };
    pc.ontrack = (e) => { Q.stream.addTrack(e.track); e.track.addEventListener('unmute', () => paintTiles()); paintTiles(); };
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
    const t = setTimeout(res, 2500);
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
      t = { el: el('figure', { class: 'co-tile' }, v, el('span', { class: 'co-ph' }), el('span', { class: 'co-state lbl' }),
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
      t.el.classList.toggle('wait', !!w.Q && st !== 'connected');
      t.el.querySelector('.co-state').textContent = !w.Q || st === 'connected' ? (w.call?.recv ? 'écoute' : '')
        : st === 'failed' ? 'pas de chemin réseau' : st === 'disconnected' ? 'coupé…' : 'connexion…';
      t.el.querySelector('.co-flag').textContent = w.call?.screen ? 'écran' : !w.call?.mic ? 'muet' : '';
      // à sa place seulement : une vidéo qu'on déplace dans la page peut s'arrêter
      const i = want.indexOf(w);
      if (tiles.children[i] !== t.el) tiles.insertBefore(t.el, tiles.children[i] || null);
    }
    strip.hidden = !K.on || C.compact;
    strip.classList.toggle('fold', C.fold);
    strip.querySelector('.co-n').textContent = `· ${want.length}`;
    requestAnimationFrame(placeDock);
  }
  function paintCall() {
    const inCall = [...C.peers.values()].filter((p) => p.call?.on);
    const warn = !HAS_RTC ? ['ce navigateur n’a pas WebRTC : la visio ne peut pas s’ouvrir ici.']
      : !SECURE ? [`${INSECURE[0].toUpperCase()}${INSECURE.slice(1)}. Vous pouvez rejoindre l’appel pour voir et entendre les autres.`,
        'Pour parler et montrer : ouvrir le portail par localhost (un tunnel ssh : ssh -L 8790:127.0.0.1:8790 dgx2, puis http://localhost:8790/), ou attendre la porte Cloudflare (https).']
        : [K.camWhy, K.micWhy].filter(Boolean);
    visWarn.hidden = !warn.length;
    fill(visWarn, ...warn.map((w) => el('p', {}, w)),
      !SECURE && HAS_RTC ? el('a', { href: MDN, target: '_blank', rel: 'noopener' }, 'contexte sécurisé · MDN ↗') : null);
    bJoin.disabled = !HAS_RTC || K.joining || !C.cid;
    bJoin.title = !C.cid ? 'la planche n’est pas encore reliée au portail' : '';
    bJoin.className = K.on ? 'tb ghost sm' : 'tb on sm';
    bJoin.textContent = K.joining ? 'ouverture…' : K.on ? 'Quitter l’appel' : SECURE ? (inCall.length ? 'Rejoindre l’appel' : 'Lancer l’appel') : 'Rejoindre (voir, entendre)';
    const cs = callState();
    const off = (b, on, why) => {
      b.setAttribute('aria-disabled', why ? 'true' : 'false');
      b.setAttribute('aria-pressed', String(!!on));
      b.classList.toggle('on', !!on);
      b.title = why || '';
    };
    const need = !HAS_RTC ? 'ce navigateur n’a pas WebRTC' : !SECURE ? INSECURE : !K.on ? 'rejoignez d’abord l’appel' : '';
    off(bMic, K.on && cs.mic, need || (K.on && !audioTrack() ? K.micWhy || 'pas de micro : cliquer pour réessayer' : ''));
    off(bCam, K.on && cs.cam, need || (K.on && !K.cam && K.camWhy ? K.camWhy : ''));
    off(bScr, K.on && cs.screen, need || (!CAN_SCREEN ? 'ce navigateur ne partage pas l’écran' : ''));
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
    visNote.textContent = K.on ? `pair à pair, sans serveur relais : sur le réseau de la maison seulement (${C.limits.call || 6} personnes au plus).`
      : 'l’image et le son vont directement d’un navigateur à l’autre ; le portail ne fait que les présenter.';
    stripTog.classList.toggle('on', !C.fold);
    stripTog.hidden = !K.on;
    paintCallPill();
  }
  // un contrôle désactivé reste cliquable : il dit pourquoi
  for (const b of [bMic, bCam, bScr]) b.addEventListener('click', (e) => { if (b.getAttribute('aria-disabled') === 'true') { e.stopImmediatePropagation(); if (b.title) toast(b.title, 7000); } }, true);

  function paintAll() {
    C.whoKey = '';
    paintWho(); paintNotice(); paintDots(); paintFil(); paintComposer(); paintTiles(); paintCall(); schedule();
  }

  // pour les essais (playwright) et le module de présentation
  app.collab = { C, K, open: openDock, close: closeDock, present: setCompact, pin: pinMode };
  const t0 = LS('co-tab');
  if (t0 === 'fil' || t0 === 'visio') openDock(t0);
  paintAll();
  if (S.board) connect(S.board.id);
}
