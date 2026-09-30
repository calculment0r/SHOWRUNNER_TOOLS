// IDÉATION · OBJETS — le bloc son de la planche (30/09/2026) : le visuel du
// son (sa forme d'onde, calculée une fois par le serveur : server/tools/
// apercu_son.py) et une mini-timeline — lecture / pause, la tête de lecture
// sur l'onde, un clic (ou un glissé) va à ce moment, la durée.
//
// Demande de Cal (30/09) : « on pourrait avoir une timeline aussi dans les
// blocs son sur le canva.. un truc léger pour pas trop alourdir ».
//
// Léger par construction :
// - UN SEUL lecteur `<audio>` pour toute la planche, créé au premier « écouter » :
//   un seul son joue à la fois parce qu'il n'y a qu'un lecteur (jouer un autre bloc
//   lui donne sa source) ; un bloc ne charge rien tant qu'on ne l'écoute pas.
//   Pas de Web Audio : il faudrait décoder tout le fichier en mémoire (AudioBuffer)
//   pour sauter dedans, ou monter un graphe pour rien — l'élément `<audio>` lit en
//   continu, saute par requêtes partielles (le serveur sert les plages, 206), et
//   la forme vient déjà du serveur.
// - L'onde est une image-masque (blanc + alpha) peinte par les jetons : le joué en
//   `--grn2` (la teinte des sons, celle des fils « son »), le reste en `--ink3`.
//   Elle ne se demande qu'une fois le bloc visible (IntersectionObserver) ; hors de
//   la vue, rien ; la tête se repeint à chaque image seulement pendant la lecture,
//   et seulement dans le bloc qui joue.
// - Le bloc est posé par l'habillage du canvas (`canvas.decorate`, plugins.js) :
//   canvas.js dessine le son comme avant, ce module remplace son contenu.

import { el, href, fmtDur, toast, pick } from '../../commun/shell.js';

export const WAVE_V = 1;   // la version du dessin (apercu_son.py, VERSION) : l'adresse change avec lui
const ICON_PLAY = 'M8 5v14l11-7z';
const ICON_PAUSE = 'M7 5h4v14H7zM13 5h4v14h-4z';
const NS = 'http://www.w3.org/2000/svg';
const ico = (d) => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); return s; };
const t2 = (s) => fmtDur(Math.max(0, s || 0)).replace(/\.\d$/, '');

export function waveUrl(it) {
  return href(`api/son/apercu/${it.id}?v=${WAVE_V}`);
}

// la vignette d'un son ailleurs dans Idéation (le panneau de la bibliothèque) : l'onde en
// masque, demandée seulement quand la vignette entre dans la vue (comme <img loading="lazy">)
let tileIo = null;
export function waveMark(it) {
  const i = el('i', { class: 'swave', 'aria-hidden': 'true', 'data-wave': waveUrl(it) });
  tileIo ??= new IntersectionObserver((list) => {
    for (const e of list) if (e.isIntersecting) { tileIo.unobserve(e.target); e.target.style.setProperty('--wave', `url("${e.target.dataset.wave}")`); }
  }, { rootMargin: '300px' });
  tileIo.observe(i);
  return i;
}

export function installSon(app) {
  const { S } = app;
  let audio = null;          // le seul lecteur de la planche
  let cur = null;            // { id: l'objet de la planche, item }
  let raf = 0;
  const seen = new WeakSet();

  // l'onde ne se demande qu'une fois la timeline à l'écran (un bloc hors de la vue est en display: none) ;
  // on observe la timeline (elle a une boîte), le masque se pose sur l'onde qu'elle contient
  const io = new IntersectionObserver((list) => {
    for (const e of list) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const m = e.target.querySelector('.sn-m');
      if (m?.dataset.wave) m.style.setProperty('--wave', `url("${m.dataset.wave}")`);
    }
  }, { rootMargin: '200px' });

  function player() {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = 'none';
    const again = () => { if (cur) paint(cur.id); };
    for (const ev of ['play', 'pause', 'ended', 'loadedmetadata', 'seeked', 'durationchange']) audio.addEventListener(ev, again);
    audio.addEventListener('play', loop);
    audio.addEventListener('error', () => { if (cur) { toast('ce son ne se lit pas (fichier absent ou format que le navigateur ne lit pas)', 6000); paint(cur.id); } });
    return audio;
  }
  function loop() {
    cancelAnimationFrame(raf);
    const step = () => { if (!cur || !audio || audio.paused) return; paint(cur.id); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
  }
  const blockOf = (id) => app.canvas.dom.get(id)?.el.querySelector('.sn');
  function duration(n) {
    const it = S.items.get(n.item);
    if (cur?.id === n.id && audio && Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    return it?.duration || 0;
  }

  // repeindre un bloc : la tête, le joué, le temps, le bouton (`el` : le bloc qu'on construit,
  // pas encore rangé dans le canvas)
  function paint(id, el0 = null) {
    const b = el0 || blockOf(id);
    const n = app.node(id);
    if (!b || !n) return;
    const d = duration(n);
    const mine = cur?.id === id && audio;
    const t = mine ? audio.currentTime : +(b.dataset.at || 0);
    const p = d > 0 ? Math.max(0, Math.min(1, t / d)) : 0;
    b.style.setProperty('--p', `${(p * 100).toFixed(3)}%`);
    const on = !!(mine && !audio.paused);
    b.classList.toggle('on', on);
    b.classList.toggle('cur', !!mine || t > 0);
    if (b.dataset.on !== String(on)) {   // le bouton ne change qu'avec l'état (pas à chaque image)
      b.dataset.on = String(on);
      const go = b.querySelector('.sn-go');
      go.replaceChildren(ico(on ? ICON_PAUSE : ICON_PLAY));
      go.setAttribute('aria-label', on ? 'pause' : 'écouter');
      go.title = on ? 'pause · espace sur la timeline' : 'écouter — un seul son joue à la fois sur la planche';
    }
    b.querySelector('.sn-c').textContent = mine || t > 0 ? `${t2(t)} / ${t2(d)}` : t2(d);
    const w = b.querySelector('.sn-w');
    w.setAttribute('aria-valuemax', String(Math.round(d)));
    w.setAttribute('aria-valuenow', String(Math.round(t)));
    w.setAttribute('aria-valuetext', `${t2(t)} sur ${t2(d)}`);
  }

  // jouer un bloc (à `at` secondes, sinon là où il en était) ; le bloc qui jouait s'arrête : même lecteur
  function play(n, at = null) {
    const it = S.items.get(n.item);
    if (!it || it.missing) return;
    const a = player();
    const prev = cur?.id;
    if (!cur || cur.id !== n.id || cur.item !== it.id) {
      a.pause();
      cur = { id: n.id, item: it.id };
      a.src = href(it.url);
      const from = at ?? +(blockOf(n.id)?.dataset.at || 0);
      if (from > 0) a.currentTime = from;
      if (prev && prev !== n.id) { const pb = blockOf(prev); if (pb) pb.dataset.at = '0'; paint(prev); }
    } else if (at !== null) a.currentTime = at;
    a.play().catch((e) => { if (e.name !== 'AbortError') toast(`lecture impossible : ${e.message}`, 5000); });
    paint(n.id);
  }
  function toggle(n) {
    if (cur?.id === n.id && audio && !audio.paused) { audio.pause(); return; }
    play(n);
  }
  function seek(n, frac) {
    const d = duration(n);
    if (!(d > 0)) { play(n); return; }
    const at = Math.max(0, Math.min(d - 0.05, frac * d));
    if (cur?.id === n.id && audio) { audio.currentTime = at; if (audio.paused) audio.play().catch(() => {}); paint(n.id); return; }
    play(n, at);
  }
  function stop() { if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); } const was = cur?.id; cur = null; if (was) paint(was); }

  // ── le bloc ─────────────────────────────────────────────
  function decorate(n, e) {
    if (n.type !== 'media' || n.kind !== 'audio') return;
    const it = S.items.get(n.item);
    if (!it || it.missing) return;
    for (const c of e.querySelectorAll(':scope > .k, :scope > .nm, :scope > .arow, :scope > audio, :scope > .sn')) c.remove();
    const id = n.id;
    const m = el('i', { class: 'sn-m', 'data-wave': waveUrl(it) });
    const w = el('button', { class: 'sn-w', type: 'button', role: 'slider', 'aria-label': 'position dans le son', 'aria-valuemin': '0',
      title: 'un clic : aller à ce moment (et écouter) — glisser : chercher — ← → : 5 s' },
    el('i', { class: 'sn-z' }), m, el('i', { class: 'sn-hd' }));
    const go = el('button', { class: 'sn-go', type: 'button' });
    const b = el('div', { class: 'sn', 'data-at': cur?.id === id ? '' : '0' },
      el('div', { class: 'sn-h' }, go,
        el('div', { class: 'sn-t' }, el('span', { class: 'sn-k' }, 'son'), el('b', { class: 'sn-n', title: it.title || it.id }, it.title || n.title || it.id)),
        el('span', { class: 'sn-c' })),
      w);
    go.addEventListener('click', (ev) => { ev.stopPropagation(); const c = app.node(id); if (c) toggle(c); });
    // la timeline : un clic va au moment ; un glissé cherche (la tête suit), relâché : on y va
    const frac = (ev) => { const r = w.getBoundingClientRect(); return r.width ? Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) : 0; };
    let drag = null;
    w.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      drag = { f: frac(ev), moved: false };
      w.setPointerCapture?.(ev.pointerId);
    });
    w.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      drag.f = frac(ev); drag.moved = true;
      const c = app.node(id);
      b.style.setProperty('--p', `${(drag.f * 100).toFixed(3)}%`);
      if (c) b.querySelector('.sn-c').textContent = `${t2(drag.f * duration(c))} / ${t2(duration(c))}`;
    });
    const end = (ev) => {
      if (!drag) return;
      const f = ev.type === 'pointercancel' ? null : drag.f;
      drag = null;
      const c = app.node(id);
      if (c && f !== null) seek(c, f); else if (c) paint(id);
    };
    w.addEventListener('pointerup', end);
    w.addEventListener('pointercancel', end);
    w.addEventListener('keydown', (ev) => {
      const c = app.node(id);
      if (!c) return;
      const d = duration(c), now = cur?.id === id && audio ? audio.currentTime : 0;
      const k = { ArrowLeft: -5, ArrowRight: 5, ArrowDown: -5, ArrowUp: 5, PageDown: -30, PageUp: 30 }[ev.key];
      // la planche prend sinon les flèches (déplacer l'objet) et l'espace (se déplacer)
      if (k !== undefined) { ev.preventDefault(); ev.stopPropagation(); if (d > 0) seek(c, (now + k) / d); return; }
      if (ev.key === 'Home' || ev.key === 'End') { ev.preventDefault(); ev.stopPropagation(); if (d > 0) seek(c, ev.key === 'Home' ? 0 : 0.999); return; }
      if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); toggle(c); }
    });
    // le son de la bibliothèque a ses propres contrôles ailleurs ; ici, le bloc garde sa place
    e.prepend(b);
    if (!seen.has(w)) { seen.add(w); io.observe(w); }
    paint(id, b);
  }

  app.canvas.decorate(decorate);
  // l'objet qui jouait a quitté la planche (supprimé, planche changée) : le son s'arrête
  const check = () => { if (cur && !app.node(cur.id)) stop(); };
  for (const ev of ['commit', 'render', 'board']) app.on(ev, check);

  // ── poser un son (le bouton « Son » de la barre, la touche A, la palette ⌘K) ──
  async function place(at = null) {
    if (!S.board) { toast('ouvrez ou créez d’abord une planche'); return; }
    const got = await pick({ kinds: ['audio'], multiple: true, title: 'Poser un son — depuis la bibliothèque ou le disque' });
    if (!got?.length) return;
    const [wx, wy] = at || app.canvas.center();
    app.placeMany(got, wx, wy, { free: !at });
  }
  return { place, play: (id, at) => { const n = app.node(id); if (n) play(n, at); }, stop, seek: (id, f) => { const n = app.node(id); if (n) seek(n, f); },
    state: () => ({ id: cur?.id || null, t: audio?.currentTime || 0, paused: audio ? audio.paused : true, src: audio?.src || '' }) };
}
