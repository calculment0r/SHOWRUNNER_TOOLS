// app.js — l'interface du lien d'écoute.
//
// L'interface du lecteur d'AGOSTA (js/app.js du dépôt calculment0r/AGOSTA), reliée au moteur (player.js) et
// généralisée : les données viennent de playlist.json (server/tools/ecoute.py) au lieu d'album-data.js. Ce qu'elle
// garde d'AGOSTA : la pochette et son fond flouté, la liste avec les durées, le lecteur compact en bas, le karaoké
// (gros lettrage, lignes voisines grisées, ligne active centrée, toucher une ligne pour y sauter, interlude), le
// panneau qu'on tire vers le haut (barre, phrase en cours, karaoké). Ce qu'elle ajoute (docs/etudes/
// musique_spaces_playlists.md § 4) : un morceau direct (#3), « Télécharger » seulement si playlist.json le permet, la
// couleur de la pochette en accent, l'année, la description et les crédits, le plein écran des paroles, le thème du
// système (clair ou sombre), le compteur d'écoutes quand le lien le demande (la destination Cloudflare).
// Le lecteur est à l'artiste : il ne nomme pas l'outil qui l'a fabriqué (décision L3 de Cal, 05/10).

import { createPlayer } from './player.js';

const $ = (id) => document.getElementById(id);
function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}
function showError(message) {
  const b = $('error-banner');
  if (!b) return;
  b.textContent = message;
  b.hidden = false;
  clearTimeout(showError.t);
  showError.t = setTimeout(() => { b.hidden = true; }, 6000);
}
function formatTime(sec) {
  if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec), m = Math.floor(s / 60), r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── le thème : celui du système, suivi s'il change (index.html le pose déjà avant le premier dessin) ──
const clair = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
function poseTheme(theme) {
  const t = theme === 'light' || theme === 'dark' ? theme : (clair && clair.matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = t;
}

// ── la couleur de la pochette : deux teintes calculées au serveur, une par thème, au contraste AA sur le fond ──
function poseAccent(acc) {
  if (!acc || typeof acc !== 'object') return;   // sans pochette : l'accent du thème (ecoute.css)
  const s = document.documentElement.style;
  const ok = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  if (ok(acc.dark)) s.setProperty('--acc-sombre', acc.dark);
  if (ok(acc.dark_ink)) s.setProperty('--acc-sombre-encre', acc.dark_ink);
  if (ok(acc.light)) s.setProperty('--acc-clair', acc.light);
  if (ok(acc.light_ink)) s.setProperty('--acc-clair-encre', acc.light_ink);
}

async function charge() {
  try {
    const r = await fetch('./playlist.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } catch (e) {
    console.error('[lecteur] playlist.json :', e);
    return null;
  }
}

const data = await charge();
poseTheme(data && data.theme);
if (clair && clair.addEventListener) clair.addEventListener('change', () => poseTheme(data && data.theme));

if (!data || typeof data !== 'object' || !Array.isArray(data.tracks) || data.tracks.length === 0) {
  showError('Cette playlist est introuvable ou vide.');
} else {
  demarre(data);
}

function demarre(data) {
  const audio = $('audio-player');
  poseAccent(data.accent);

  // ── l'en-tête ──
  const cover = $('cover');
  const coverFrame = cover.closest('.cover-frame');
  if (data.cover) {
    cover.src = data.cover;
    cover.onerror = () => { cover.style.opacity = '0'; };
    cover.alt = `Pochette de ${data.title || 'la playlist'}`;
  } else {
    coverFrame.classList.add('sans-pochette');
    $('cover-empty').textContent = data.title || '';
    cover.remove();
  }
  const miniCover = $('mini-cover');
  if (data.artwork512 || data.cover) miniCover.src = data.artwork512 || data.cover;
  else miniCover.closest('.mini-cover').classList.add('sans-pochette');

  // le fond : la pochette floutée
  const ambient = $('ambient-img');
  if (ambient && (data.cover || data.artwork512)) {
    ambient.style.backgroundImage = `url("${encodeURI(data.artwork512 || data.cover)}")`;
    requestAnimationFrame(() => ambient.classList.add('on'));
  }

  $('artist').textContent = data.artist || '';
  const titre = $('album-title');
  titre.textContent = data.title || 'Playlist';
  // le titre en grand, sans jamais couper un mot : sa taille baisse tant que le plus long déborde (AGOSTA tient, un
  // titre plus long aussi), jusqu'à 1,6 rem ; au-delà, le mot se coupe (un seul mot démesuré)
  function ajusteTitre() {
    titre.style.fontSize = '';
    titre.style.overflowWrap = '';
    let px = parseFloat(getComputedStyle(titre).fontSize);
    const min = 1.6 * parseFloat(getComputedStyle(document.documentElement).fontSize);
    while (titre.scrollWidth > titre.clientWidth + 1 && px > min) {
      px = Math.max(min, px * 0.94);
      titre.style.fontSize = `${px}px`;
    }
    if (titre.scrollWidth > titre.clientWidth + 1) titre.style.overflowWrap = 'anywhere';
  }
  ajusteTitre();
  let retaille = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(retaille); retaille = requestAnimationFrame(ajusteTitre); });
  const year = $('year');
  year.textContent = data.year || '';
  year.hidden = !data.year;
  const desc = $('description');
  desc.textContent = data.description || '';
  desc.hidden = !data.description;
  document.title = (data.title || 'Playlist') + (data.artist ? ` — ${data.artist}` : '');

  // ── la liste ──
  const trackEls = [];
  const list = $('tracklist');
  $('tracks-count').textContent = `${String(data.tracks.length).padStart(2, '0')} titres`;
  data.tracks.forEach((t, i) => {
    const li = el('li', 'track');
    const btn = el('button', 'track-btn');
    btn.type = 'button';
    btn.setAttribute('aria-label', `Lire ${t.title || `le morceau ${i + 1}`}`);
    const num = el('span', 'track-num mono', String(t.number != null ? t.number : i + 1).padStart(2, '0'));
    const main = el('div', 'track-main');
    main.appendChild(el('div', 'track-title', t.title || 'Sans titre'));
    if (t.credits) main.appendChild(el('div', 'track-credits', t.credits));
    const eq = el('span', 'track-eq');
    eq.setAttribute('aria-hidden', 'true');
    eq.append(el('i'), el('i'), el('i'));
    const dur = el('span', 'track-dur');
    // la durée connue d'avance (le champ duration, ou les bornes start / end du mode continu)
    let d = null;
    if (typeof t.duration === 'number') d = t.duration;
    else if (typeof t.start === 'number' && typeof t.end === 'number') d = t.end - t.start;
    dur.textContent = d != null ? formatTime(d) : '';
    btn.append(num, main, eq, dur);
    btn.addEventListener('click', () => player.select(i));
    li.appendChild(btn);
    list.appendChild(li);
    trackEls.push({ li, btn, dur });
  });

  // ── les paroles ──
  const lyricsBadge = $('lyrics-badge');
  const lyricsBox = $('lyrics-box');
  const sheetEl = $('player-sheet');
  const sheetHandle = $('sheet-handle');
  const sheetLyrics = $('sheet-lyrics');
  const fullBtn = $('lyrics-full');

  let lyricsOpen = false;   // le panneau est déplié
  let currentLyrics = { synced: false, lines: [] };
  let lineEls = [];
  let activeLine = -1;
  let userScrollUntil = 0;
  let lyricsToken = 0;   // un .lrc arrivé après un changement de morceau n'est pas montré

  function parseLyrics(raw) {
    if (typeof raw !== 'string') return { synced: false, lines: [] };
    raw = raw.replace(/^﻿/, '');   // le BOM des fichiers faits sous Windows
    if (raw.trim() === '') return { synced: false, lines: [] };
    const tag = /\[(\d{1,2}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
    const timed = [], plain = [];
    let hasTimed = false;
    for (const row of raw.split(/\r?\n/)) {
      const matches = [];
      let m;
      tag.lastIndex = 0;
      while ((m = tag.exec(row)) !== null) matches.push(parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.')));
      const text = row.replace(tag, '').replace(/\*\*/g, '').replace(/__/g, '').trim();
      if (matches.length) { hasTimed = true; for (const t of matches) timed.push({ t, text }); }
      else if (!/^\[[a-z]+:.*\]$/i.test(text)) plain.push({ t: null, text });   // [ar:…], [ti:…] : des étiquettes LRC
    }
    if (hasTimed) { timed.sort((a, b) => a.t - b.t); return { synced: true, lines: timed }; }
    return { synced: false, lines: plain };
  }

  function renderLyricLines() {
    activeLine = -1;
    lineEls = [];
    lyricsBox.textContent = '';
    for (const line of currentLyrics.lines) {
      const d = el('div', 'lyric-line', line.text || ' ');
      d.setAttribute('role', 'listitem');
      if (currentLyrics.synced) {
        d.classList.add('seekable');
        d.addEventListener('click', () => {
          player.seekRelative(line.t);
          if (!player.isPlaying()) player.play();
        });
      }
      lyricsBox.appendChild(d);
      lineEls.push(d);
    }
  }

  const placeholder = (text) => lyricsBox.appendChild(el('div', 'lyric-line placeholder', text));

  function loadLyrics(track) {
    const token = ++lyricsToken;
    currentLyrics = { synced: false, lines: [] };
    activeLine = -1;
    lineEls = [];
    lyricsBox.textContent = '';
    function apply(raw) {
      if (token !== lyricsToken) return;   // le morceau a changé entre-temps
      currentLyrics = parseLyrics(raw);
      renderLyricLines();
      lyricsBadge.hidden = !currentLyrics.synced;
      if (currentLyrics.lines.length === 0) placeholder('— instrumental —');
      if (lyricsOpen) syncLyrics(player.relPosition(), true);
    }
    if (track && track.lyricsFile) {
      lyricsBadge.hidden = true;
      placeholder('Chargement des paroles…');
      fetch(track.lyricsFile).then((r) => (r.ok ? r.text() : '')).then(apply).catch(() => apply(''));
    } else {
      apply(track && track.lyrics);
    }
  }

  // Quatre états : « collapsed » (la barre), « peek » (la phrase en cours), « expanded » (le karaoké), « full » (le
  // karaoké en plein écran : l'écran entier par l'API Fullscreen là où elle existe, la fenêtre entière sinon — l'iPhone)
  let sheetState = 'collapsed';
  function setState(state) {
    sheetState = state;
    lyricsOpen = state !== 'collapsed';
    sheetEl.setAttribute('data-state', state);
    sheetHandle.setAttribute('aria-expanded', lyricsOpen ? 'true' : 'false');
    sheetHandle.setAttribute('aria-label', lyricsOpen ? 'Réduire le lecteur' : 'Afficher les paroles');
    fullBtn.setAttribute('aria-pressed', state === 'full' ? 'true' : 'false');
    fullBtn.setAttribute('aria-label', state === 'full' ? 'Quitter le plein écran' : 'Paroles en plein écran');
    if (lyricsOpen) syncLyrics(player.relPosition(), true);
  }

  function syncLyrics(position, force) {
    if (!currentLyrics.synced || !lyricsOpen || lineEls.length === 0) return;
    const lines = currentLyrics.lines;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].t <= position + 0.15) idx = i;
      else break;
    }
    if (idx === -1) idx = 0;
    if (idx !== activeLine || force) {
      for (const n of lineEls) n.classList.remove('active', 'near', 'waiting');
      activeLine = idx;
      const node = lineEls[idx];
      if (node) {
        node.classList.add('active');
        if (lineEls[idx - 1]) lineEls[idx - 1].classList.add('near');
        if (lineEls[idx + 1]) lineEls[idx + 1].classList.add('near');
        autoScrollTo(node);
      }
    }
    updateWaiting(idx, position);
  }

  // un long passage instrumental : la ligne active « attend » (des points qui respirent)
  function updateWaiting(idx, position) {
    const node = lineEls[idx];
    if (!node) return;
    const lines = currentLyrics.lines;
    const cur = lines[idx].t;
    let nxt = idx + 1 < lines.length ? lines[idx + 1].t : player.relDuration();
    if (!isFinite(nxt)) nxt = cur + 4;
    const gap = nxt - cur, into = position - cur, toNext = nxt - position;
    const avant = node.classList.contains('waiting');
    node.classList.toggle('waiting', gap > 6 && into > 3.5 && toNext > 2);
    // les points grandissent la ligne : on la recentre (AGOSTA la laissait glisser d'une douzaine de pixels)
    if (avant !== node.classList.contains('waiting')) autoScrollTo(node);
  }

  // la ligne active au centre de la boîte
  function autoScrollTo(node) {
    if (Date.now() < userScrollUntil) return;
    const box = lyricsBox;
    const target = node.offsetTop - box.clientHeight / 2 + node.clientHeight / 2;
    if (reduceMotion || typeof box.scrollTo !== 'function') box.scrollTop = target;
    else box.scrollTo({ top: target, behavior: 'smooth' });
  }

  lyricsBox.addEventListener('wheel', () => { userScrollUntil = Date.now() + 4000; }, { passive: true });
  lyricsBox.addEventListener('touchmove', () => { userScrollUntil = Date.now() + 4000; }, { passive: true });

  // ── le panneau : on le tire depuis toute la barre (poignée, titre, vide), sauf les commandes, la barre de
  // progression, la vignette et les paroles ──
  let collapsedPx = 0, peekPx = 0, expandedPx = 0;
  let dragStartY = 0, dragStartH = 0, sheetDragging = false, dragMoved = false;
  requestAnimationFrame(() => { collapsedPx = sheetEl.offsetHeight; });

  function cssPx(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (v.slice(-2) === 'vh') return (window.innerHeight * parseFloat(v)) / 100;
    if (v.slice(-2) === 'px') return parseFloat(v);
    return fallback;
  }
  function computeHeights() {
    peekPx = cssPx('--sheet-peek', 224);
    expandedPx = cssPx('--sheet-expanded', window.innerHeight * 0.6);
  }
  const dragY = (ev) => (ev.clientY != null ? ev.clientY : (ev.touches && ev.touches[0] ? ev.touches[0].clientY : 0));
  function nearestState(h) {
    if (h < (collapsedPx + peekPx) / 2) return 'collapsed';
    if (h < (peekPx + expandedPx) / 2) return 'peek';
    return 'expanded';
  }
  function onDragStart(ev) {
    if (sheetState === 'full' || ev.target.closest('.controls, .seek, .mini-cover, .lyrics-box, .lyrics-full')) return;
    computeHeights();
    if (sheetState === 'collapsed') collapsedPx = sheetEl.offsetHeight;
    dragStartY = dragY(ev);
    dragStartH = sheetEl.offsetHeight;
    sheetDragging = true;
    dragMoved = false;
    sheetEl.classList.add('dragging');
    if (sheetEl.setPointerCapture && ev.pointerId != null) try { sheetEl.setPointerCapture(ev.pointerId); } catch { /* rien */ }
  }
  function onDragMove(ev) {
    if (!sheetDragging) return;
    const dy = dragStartY - dragY(ev);
    if (Math.abs(dy) > 4) dragMoved = true;
    const h = Math.max(collapsedPx, Math.min(expandedPx, dragStartH + dy));
    sheetEl.style.height = `${h}px`;
    const ratio = expandedPx > collapsedPx ? (h - collapsedPx) / (expandedPx - collapsedPx) : 0;
    sheetLyrics.style.opacity = String(Math.max(0, Math.min(1, ratio)));
    if (!lyricsOpen && ratio > 0.02) { lyricsOpen = true; syncLyrics(player.relPosition(), true); }
    ev.preventDefault();
  }
  function onDragEnd() {
    if (!sheetDragging) return;
    sheetDragging = false;
    const h = sheetEl.getBoundingClientRect().height;
    sheetEl.classList.remove('dragging');
    sheetEl.style.height = '';
    sheetLyrics.style.opacity = '';
    if (!dragMoved) { setState(sheetState === 'collapsed' ? 'peek' : 'collapsed'); return; }   // un toucher
    setState(nearestState(h));
  }
  sheetEl.addEventListener('pointerdown', onDragStart);
  sheetEl.addEventListener('pointermove', onDragMove);
  sheetEl.addEventListener('pointerup', onDragEnd);
  sheetEl.addEventListener('pointercancel', onDragEnd);
  // la ligne active recentrée une fois la hauteur arrivée
  sheetEl.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'height' && lyricsOpen) syncLyrics(player.relPosition(), true);
  });

  // la vignette ouvre et referme aussi le panneau
  $('mini-cover-btn').addEventListener('click', () => setState(sheetState === 'collapsed' ? 'peek' : 'collapsed'));

  // le plein écran des paroles
  const fsOk = () => !!(document.fullscreenEnabled && document.documentElement.requestFullscreen);
  fullBtn.addEventListener('click', () => {
    if (sheetState === 'full') {
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
      setState('expanded');
      return;
    }
    setState('full');
    if (fsOk()) document.documentElement.requestFullscreen().catch(() => { /* refusé : la fenêtre entière suffit */ });
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && sheetState === 'full') setState('expanded');   // Échap, ou le geste du système
  });

  // ── le moteur ──
  const player = createPlayer(audio, data);

  const npTitle = $('np-title');
  const btnPlay = $('btn-play');
  const progress = $('progress');
  const progressFill = $('progress-fill');
  const progressKnob = $('progress-knob');
  const timeCurrent = $('time-current');
  const timeDuration = $('time-duration');
  const download = $('download');

  // « Télécharger » : seulement si la playlist le permet ; le fichier qu'on écoute (le morceau, ou la playlist
  // entière en mode continu). Rien n'empêche qui a l'adresse de garder le son : ce n'est pas une protection.
  function poseTelechargement(i) {
    if (data.download !== true) return;
    const cont = player.getMode() === 'continuous';
    const t = data.tracks[i] || {};
    const href = cont ? data.continuousFile : t.file;
    if (!href) return;
    download.href = href;
    download.setAttribute('download', cont ? `${data.title || 'playlist'}.mp3`
      : `${String(t.number != null ? t.number : i + 1).padStart(2, '0')} - ${t.title || 'morceau'}.mp3`);
    download.textContent = cont ? 'Télécharger la playlist' : 'Télécharger le morceau';
    download.hidden = false;
  }

  // le compteur d'écoutes (la destination Cloudflare : playlist.json dit `stats`) : un morceau compte une fois qu'on
  // en a vraiment entendu 30 s (ou presque tout, s'il est plus court), chaque fois qu'on y revient. La page le dit au
  // Worker (porte/worker.js, POST ./_ecoute), qui le range ; sans `stats`, rien ne part.
  const ecoute = { index: -1, entendu: 0, compte: false, dernier: null };
  function compteEcoute(pos) {
    if (data.stats !== true) return;
    const i = player.getIndex();
    if (i !== ecoute.index) Object.assign(ecoute, { index: i, entendu: 0, compte: false, dernier: null });
    if (!player.isPlaying()) { ecoute.dernier = null; return; }
    if (ecoute.dernier != null) {
      const dt = pos - ecoute.dernier;
      if (dt > 0 && dt < 1.5) ecoute.entendu += dt;   // un saut ne compte pas
    }
    ecoute.dernier = pos;
    const dur = player.relDuration();
    const seuil = isFinite(dur) && dur > 0 ? Math.min(30, dur * 0.9) : 30;
    if (!ecoute.compte && ecoute.entendu >= seuil) {
      ecoute.compte = true;
      const corps = `n=${i + 1}`;
      if (!(navigator.sendBeacon && navigator.sendBeacon('./_ecoute', corps))) {
        fetch('./_ecoute', { method: 'POST', body: corps, keepalive: true }).catch(() => {});
      }
    }
  }

  player.on('trackchange', (e) => {
    const t = e.track || {};
    npTitle.textContent = t.title || '';
    trackEls.forEach((ref, i) => {
      const active = i === e.index;
      ref.li.classList.toggle('current', active);
      if (active) ref.btn.setAttribute('aria-current', 'true');
      else ref.btn.removeAttribute('aria-current');
    });
    poseTelechargement(e.index);
    loadLyrics(t);
  });

  player.on('playstate', (e) => {
    btnPlay.classList.toggle('is-playing', e.playing);
    btnPlay.setAttribute('aria-label', e.playing ? 'Pause' : 'Lecture');
    document.body.classList.toggle('is-playing', e.playing);
  });

  player.on('time', (e) => {
    const dur = e.duration, pos = e.position;
    const pct = isFinite(dur) && dur > 0 ? Math.max(0, Math.min(100, (pos / dur) * 100)) : 0;
    progressFill.style.width = `${pct}%`;
    progressKnob.style.left = `${pct}%`;
    progress.setAttribute('aria-valuenow', String(Math.round(pct)));
    progress.setAttribute('aria-valuetext', `${formatTime(pos)} sur ${formatTime(dur)}`);
    timeCurrent.textContent = formatTime(pos);
    timeDuration.textContent = formatTime(dur);
    syncLyrics(pos, false);
    compteEcoute(pos);
  });

  player.on('loaded', (e) => {
    // en mode « separate » sans durée connue d'avance : celle du fichier, une fois chargé
    const ref = trackEls[e.index];
    if (ref && !ref.dur.textContent) ref.dur.textContent = formatTime(player.relDuration());
  });

  player.on('error', (e) => showError(e.message || 'Erreur de lecture.'));

  // ── le transport ──
  btnPlay.addEventListener('click', () => player.toggle());
  $('btn-next').addEventListener('click', () => player.next());
  $('btn-prev').addEventListener('click', () => player.previous());

  // ── la barre de progression ──
  function fractionFromEvent(ev) {
    const rect = progress.getBoundingClientRect();
    let x = ev.clientX;
    if (x == null && ev.touches && ev.touches[0]) x = ev.touches[0].clientX;
    return Math.max(0, Math.min(1, (x - rect.left) / rect.width));
  }
  let seeking = false;
  progress.addEventListener('pointerdown', (ev) => {
    seeking = true;
    if (progress.setPointerCapture) try { progress.setPointerCapture(ev.pointerId); } catch { /* rien */ }
    player.seekFraction(fractionFromEvent(ev));
    ev.preventDefault();
  });
  progress.addEventListener('pointermove', (ev) => { if (seeking) player.seekFraction(fractionFromEvent(ev)); });
  const endSeek = () => { seeking = false; };
  progress.addEventListener('pointerup', endSeek);
  progress.addEventListener('pointercancel', endSeek);
  progress.addEventListener('keydown', (ev) => {
    const pos = player.relPosition(), dur = player.relDuration();
    let handled = true;
    switch (ev.key) {
      case 'ArrowRight': case 'ArrowUp': player.seekRelative(pos + 5); break;
      case 'ArrowLeft': case 'ArrowDown': player.seekRelative(pos - 5); break;
      case 'Home': player.seekRelative(0); break;
      case 'End': if (isFinite(dur)) player.seekRelative(dur - 0.5); break;
      default: handled = false;
    }
    if (handled) ev.preventDefault();
  });

  // ── le volume ──
  const volumeSlider = $('volume');
  const iconVol = document.querySelector('.i-vol');
  const iconMute = document.querySelector('.i-mute');
  function refreshVolumeUI() {
    const muted = player.isMuted() || player.getVolume() === 0;
    iconVol.style.display = muted ? 'none' : 'block';
    iconMute.style.display = muted ? 'block' : 'none';
    $('btn-mute').setAttribute('aria-label', muted ? 'Rétablir le son' : 'Couper le son');
    volumeSlider.value = String(player.getVolume());
  }
  volumeSlider.addEventListener('input', () => {
    player.setVolume(parseFloat(volumeSlider.value));
    if (player.isMuted() && parseFloat(volumeSlider.value) > 0) player.setMuted(false);
    refreshVolumeUI();
  });
  $('btn-mute').addEventListener('click', () => { player.toggleMute(); refreshVolumeUI(); });

  // ── les raccourcis : Espace joue ou arrête, hors d'un champ et hors d'un bouton (qui a déjà son Espace) ──
  document.addEventListener('keydown', (ev) => {
    const tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return;
    if (ev.code === 'Space' || ev.key === ' ') { ev.preventDefault(); player.toggle(); }
  });

  // ── un morceau direct : …/#3 ouvre le 3e morceau au début (sans lancer la lecture : un geste d'abord) ──
  const direct = () => {
    const m = /^#(\d{1,3})$/.exec(location.hash || '');
    const n = m ? parseInt(m[1], 10) : NaN;
    return n >= 1 && n <= data.tracks.length ? n - 1 : null;
  };
  window.addEventListener('hashchange', () => {
    const i = direct();
    if (i != null && i !== player.getIndex()) player.jump(i, player.isPlaying());
  });

  // ── le démarrage ──
  player.init(direct());
  refreshVolumeUI();
  document.body.classList.add('pret');

  if ('serviceWorker' in navigator) {
    const inscris = () => navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    if (document.readyState === 'complete') inscris();
    else window.addEventListener('load', inscris);
  }
}
