// IDÉATION · ATELIER — la machine temporelle (prototype de Cal, « Innovation
// 10 ») : chaque état de la planche est gardé ; le curseur rejoue son
// histoire, « Restaurer cet état » y revient sans perdre la suite (l'état
// restauré devient le plus récent, ctrl+Z l'annule).
//
// Léger par construction : un état est la liste des objets écrits en JSON,
// et un objet qui n'a pas changé depuis l'état d'avant garde la même chaîne
// (rien n'est recopié) ; les travaux en cours (`jobs`) n'en font pas partie.
// Borne : 300 états et environ 6 millions de caractères neufs, les plus
// anciens s'en vont d'abord. En mémoire, pour la session : une planche
// rouverte recommence son histoire.
//
// Branché sur `commit` (chaque geste) ; les gestes qui n'y passent pas
// (écrire dans une note, les flèches, un travail qui pose ses images) sont
// pris par `app.touch`, une seconde après le dernier.
//
// Rejouer ne touche pas la planche : l'état ancien est prêté au canvas le
// temps d'un rendu, puis la planche reprend le sien (l'enregistrement, les
// travaux, tout continue sur le présent) ; un calque la fige, on peut s'y
// déplacer et zoomer.

import { el, toast } from '../../commun/shell.js';
import { atelier, clamp, hhmm, ago } from './socle.js';

const ICON = 'M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4h4M12 8v4l3 2';
const MAX_STATES = 300;
const MAX_CHARS = 6e6;

export function install(app) {
  const A = atelier(app);
  const { S } = app;
  const cv = A.cv;
  const H = { id: null, states: [], chars: 0, last: new Map() };
  let idx = null, shield = null, soonT = 0;

  // ── garder ───────────────────────────────────────────────
  const json = (n) => {
    if (!('jobs' in n)) return JSON.stringify(n);
    const { jobs, ...rest } = n;
    return JSON.stringify(rest);
  };
  // une planche neuve pour la machine : si des gestes ont déjà eu lieu (le
  // module chargé après eux), la pile d'annulation en garde les états d'avant
  function reset(id) {
    H.id = id; H.states = []; H.chars = 0; H.last = new Map();
    for (const snap of S.undo || []) {
      try { const o = JSON.parse(snap); push(o.nodes || [], o.links || [], null); } catch { /* un état illisible : passé */ }
    }
  }
  function record() {
    const B = S.board;
    if (!B) return;
    if (H.id !== B.id) reset(B.id);
    push(B.nodes, B.links, Date.now());
  }
  function push(list, lks, t) {
    const prev = H.states[H.states.length - 1];
    let same = !!prev && prev.nodes.length === list.length, fresh = 0;
    const nodes = list.map((n, i) => {
      let s = json(n);
      const p = H.last.get(n.id);
      if (p === s) s = p; else fresh += s.length;
      if (same && prev.nodes[i] !== s) same = false;
      return s;
    });
    let links = JSON.stringify(lks);
    if (prev && prev.links === links) links = prev.links; else { fresh += links.length; same = false; }
    if (same) return;
    H.states.push({ t, nodes, links, fresh, n: nodes.length, l: lks.length });
    H.chars += fresh;
    H.last = new Map(list.map((n, i) => [n.id, nodes[i]]));
    while (H.states.length > MAX_STATES || (H.chars > MAX_CHARS && H.states.length > 2)) {
      const gone = H.states.shift();
      H.chars -= gone.fresh;
      // le nouveau premier porte seul ses chaînes
      const first = H.states[0];
      const full = first.nodes.reduce((a, s) => a + s.length, 0) + first.links.length;
      H.chars += full - first.fresh;
      first.fresh = full;
      if (idx !== null) idx = Math.max(0, idx - 1);
    }
    if (idx !== null) paint();
  }
  const soon = () => { clearTimeout(soonT); soonT = setTimeout(record, 1000); };
  app.on('commit', record);
  app.on('quiet', soon);
  app.on('board', () => { if (idx !== null) close(); record(); });
  const touch = app.touch;
  if (typeof touch === 'function') app.touch = (...a) => { const r = touch(...a); soon(); return r; };
  if (S.board) record();

  // ── rejouer ──────────────────────────────────────────────
  const present = () => idx === H.states.length - 1;
  function open() {
    if (!S.board) { toast('ouvrez d’abord une planche'); return; }
    if (A.presenting) return;
    clearTimeout(soonT);
    record();
    if (!H.states.length) return;
    idx = H.states.length - 1;
    A.replaying = true;
    app.select([]);
    shield = A.shield({ pan: true, cls: 'replay' });
    cv.classList.add('at-replay');
    box.hidden = false;
    btn.classList.add('on');
    app.emit('atelier:replay', true);
    paint();
  }
  function close() {
    if (idx === null) return;
    idx = null;
    A.replaying = false;
    shield?.remove(); shield = null;
    cv.classList.remove('at-replay', 'at-past');
    box.hidden = true;
    btn.classList.remove('on');
    app.canvas.render();
    app.emit('atelier:replay', false);
  }
  // l'état ancien prêté au canvas le temps d'un rendu
  function show() {
    const st = H.states[idx];
    cv.classList.toggle('at-past', !present());
    if (present()) { app.canvas.render(); return; }
    const B = S.board;
    const keep = { nodes: B.nodes, links: B.links, sel: S.sel, link: S.link };
    B.nodes = st.nodes.map((s) => JSON.parse(s));
    B.links = JSON.parse(st.links);
    S.sel = new Set(); S.link = null;
    try { app.canvas.render(); } finally { B.nodes = keep.nodes; B.links = keep.links; S.sel = keep.sel; S.link = keep.link; }
  }
  let showF = 0;
  function go(i) {
    if (idx === null) return;
    idx = clamp(Math.round(i), 0, H.states.length - 1);
    cancelAnimationFrame(showF);
    showF = requestAnimationFrame(show);
    paint();
  }
  // un travail qui pose ses images pendant qu'on regarde le passé : la
  // planche s'est repeinte au présent, on remet l'état regardé
  for (const ev of ['commit', 'quiet']) app.on(ev, () => { if (idx !== null && !present()) { cancelAnimationFrame(showF); showF = requestAnimationFrame(show); } });

  function restore() {
    if (idx === null || present()) return;
    const st = H.states[idx];
    const cur = new Map(S.board.nodes.map((n) => [n.id, n]));
    // les travaux en cours restent ceux du présent
    const nodes = st.nodes.map((s) => {
      const n = JSON.parse(s);
      const c = cur.get(n.id);
      if (c && 'jobs' in c) n.jobs = c.jobs;
      else if (n.type === 'media' || n.type === 'gen') n.jobs = [];
      return n;
    });
    const links = JSON.parse(st.links);
    const when = st.t ? `de ${hhmm(st.t)}` : 'ancien';
    close();
    app.mutate((B) => { B.nodes = nodes; B.links = links; });
    toast(`état ${when} restauré — la suite reste dans la machine temporelle (ctrl+Z annule)`, 6000);
  }

  // ── le panneau ───────────────────────────────────────────
  const pos = el('span', { class: 'pos' });
  const info = el('span', { class: 'lbl info' });
  const ticks = el('span', { class: 'ticks' });
  const fill = el('span', { class: 'fill' });
  const knob = el('span', { class: 'knob' });
  const track = el('div', { class: 'at-track', tabindex: '0', role: 'slider', 'aria-label': 'les états de la planche' },
    el('span', { class: 'ln' }), fill, ticks, knob);
  const restoreB = el('button', { class: 'tb go sm', type: 'button', onclick: () => restore() }, 'Restaurer cet état');
  const box = A.panel('at-hist',
    el('div', { class: 'h' }, el('b', {}, 'Machine temporelle'), pos),
    info,
    track,
    el('div', { class: 'row' }, el('span', { class: 'lbl keys' }, '← → · début · fin'), el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'fermer, la planche telle qu’elle est · Échap', onclick: () => close() }, 'Revenir au présent'),
      restoreB));
  box.hidden = true;
  cv.append(box);

  const at = (e) => { const r = track.getBoundingClientRect(); return clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1) * (H.states.length - 1); };
  track.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    go(at(e));
    const mv = (ev) => go(at(ev));
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });

  let infoT = 0;
  function paint() {
    if (idx === null) return;
    const n = H.states.length;
    const st = H.states[idx];
    const p = n > 1 ? idx / (n - 1) : 1;
    knob.style.left = fill.style.width = `${p * 100}%`;
    track.setAttribute('aria-valuemin', '1'); track.setAttribute('aria-valuemax', String(n)); track.setAttribute('aria-valuenow', String(idx + 1));
    if (ticks.childElementCount !== (n <= 120 ? n : 0)) {
      ticks.replaceChildren(...(n <= 120 && n > 1 ? H.states.map((_, i) => el('i', { style: { left: `${(i / (n - 1)) * 100}%` } })) : []));
    }
    pos.textContent = `état ${idx + 1} / ${n}`;
    const d = st.n - S.board.nodes.length;
    const when = st.t ? `${hhmm(st.t)} · ${present() ? 'maintenant' : ago(st.t)}` : 'plus tôt dans la session';
    info.textContent = `${when} · ${st.n} objet${st.n > 1 ? 's' : ''} · ${st.l} lien${st.l > 1 ? 's' : ''}`
      + (present() || !d ? '' : ` · ${Math.abs(d)} de ${d > 0 ? 'plus' : 'moins'} qu’à présent`);
    restoreB.disabled = present();
    restoreB.title = present() ? 'c’est l’état présent : glissez le curseur vers un état passé' : 'revenir à cet état ; la suite reste dans la machine';
    clearTimeout(infoT);
    infoT = setTimeout(paint, 15000);   // « il y a … » vieillit
  }

  const btn = A.button({ order: 50, d: ICON, name: 'Machine temporelle', title: 'machine temporelle : rejouer l’histoire de la planche, restaurer un état sans perdre la suite',
    onclick: () => (idx === null ? open() : close()) });
  A.command({ order: 50, label: 'Machine temporelle', sub: 'rejouer, restaurer un état', run: () => open() });
  app.on('atelier:present', (p) => { if (p) close(); });

  // pendant qu'on rejoue, la planche ne reçoit aucune touche
  A.key(30, (e, ctx) => {
    if (idx === null || ctx.overlay) return false;
    const k = e.key;
    const step = e.shiftKey ? 10 : 1;
    if (k === 'ArrowLeft' || k === 'ArrowDown') { e.preventDefault(); go(idx - step); return true; }
    if (k === 'ArrowRight' || k === 'ArrowUp') { e.preventDefault(); go(idx + step); return true; }
    if (k === 'PageUp') { e.preventDefault(); go(idx - 10); return true; }
    if (k === 'PageDown') { e.preventDefault(); go(idx + 10); return true; }
    if (k === 'Home') { e.preventDefault(); go(0); return true; }
    if (k === 'End') { e.preventDefault(); go(H.states.length - 1); return true; }
    if (k === 'Escape') { e.preventDefault(); close(); return true; }
    // le reste s'arrête ici : les boutons du panneau gardent Entrée, espace, Tab
    // (un défaut du navigateur, que l'arrêt de la propagation ne retire pas)
    return true;
  });

  A.machine = { open, close, go, restore, record, get index() { return idx; }, get length() { return H.states.length; }, get chars() { return H.chars; } };
}
