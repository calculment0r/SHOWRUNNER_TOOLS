// player.js — le moteur de lecture du lien d'écoute.
//
// Le moteur du lecteur d'AGOSTA (dépôt calculment0r/AGOSTA, js/player.js, même auteur), repris tel quel dans sa
// logique et généralisé : il lit les données de playlist.json (l'équivalent en données d'album-data.js), écrit par
// server/tools/ecoute.py. Docs/etudes/musique_spaces_playlists.md § 4.
//
// Un seul <audio> natif pour toute la playlist, jamais recréé : c'est lui que le système reconnaît (écran verrouillé,
// lecture écran éteint, autre application devant). Deux modes :
//   « separate »    un fichier par morceau (les enchaînements « gapless » : le suivant part dès la fin du précédent) ;
//   « continuous »  un seul fichier, jamais remplacé pendant la lecture (le plus sûr sur iPhone écran verrouillé) ;
//                   les fondus enchaînés y sont fabriqués à la publication, les bornes de chaque morceau (start, end)
//                   sont dans playlist.json.
// La Media Session API (pochette, titre, boutons de l'écran verrouillé), la reprise de la position (localStorage),
// des erreurs lisibles.
//
// L'interface (app.js) s'abonne par player.on(évènement, rappel) :
//   trackchange { index, track } · playstate { playing } · time { position, duration } (relatifs au morceau)
//   loaded { index, track } · error { message }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isFiniteNumber = (n) => typeof n === 'number' && isFinite(n);

export function createPlayer(audio, data, { storeKey } = {}) {
  const mode = data.playbackMode === 'continuous' ? 'continuous' : 'separate';
  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  const listeners = {};
  let index = 0;
  let pendingSeekRel = null;   // position relative à poser après loadedmetadata
  let manualSeek = false;
  // une clé par lien : tous les liens d'une même adresse (…/ecoute/<jeton>/) partagent un seul localStorage
  const key = storeKey || `ecoute:${location.pathname}:${data.id || data.title || 'playlist'}`;

  // ── un petit émetteur d'évènements ──
  function on(evt, cb) {
    (listeners[evt] || (listeners[evt] = [])).push(cb);
    return () => { listeners[evt] = (listeners[evt] || []).filter((f) => f !== cb); };
  }
  function emit(evt, payload) {
    for (const cb of listeners[evt] || []) {
      try { cb(payload); } catch (e) { console.error('[lecteur] un abonné a échoué :', e); }   // jamais le moteur
    }
  }

  // ── les bornes d'un morceau ──
  const trackStart = (t) => (isFiniteNumber(t.start) ? t.start : 0);
  function trackEnd(t, i) {
    if (isFiniteNumber(t.end)) return t.end;
    const next = tracks[i + 1];   // en dernier recours : la borne suivante, ou la durée du média
    if (next && isFiniteNumber(next.start)) return next.start;
    return isFiniteNumber(audio.duration) ? audio.duration : Infinity;
  }

  // la durée relative d'un morceau (celle qu'on montre)
  function relDuration(i) {
    const t = tracks[i];
    if (!t) return NaN;
    if (mode === 'continuous') return trackEnd(t, i) - trackStart(t);
    return isFiniteNumber(audio.duration) ? audio.duration : (isFiniteNumber(t.duration) ? t.duration : NaN);
  }

  // la position relative dans le morceau courant
  function relPosition() {
    if (mode === 'continuous') {
      const t = tracks[index];
      return t ? clamp(audio.currentTime - trackStart(t), 0, Infinity) : 0;
    }
    return audio.currentTime || 0;
  }

  // en mode continu : quel morceau joue à cet instant ? Avec des fondus enchaînés, les bornes se chevauchent : le
  // morceau reste le précédent jusqu'à sa fin (le fondu entendu est le sien qui s'éteint)
  function indexForTime(time) {
    for (let i = 0; i < tracks.length; i++) if (time < trackEnd(tracks[i], i) - 0.001) return i;
    return tracks.length - 1;
  }

  // ── charger un morceau ──
  function load(i, opts = {}) {
    if (i < 0 || i >= tracks.length) return;
    index = i;
    const t = tracks[i];
    if (mode === 'continuous') {
      const src = data.continuousFile;
      // ne JAMAIS remplacer la source pendant la lecture continue
      if (!audio.src || decodeURI(audio.src) !== decodeURI(absolute(src))) audio.src = src;
      applyCurrentTime(trackStart(t) + (isFiniteNumber(opts.rel) ? opts.rel : 0));
    } else {
      if (decodeURI(audio.src || '') !== decodeURI(absolute(t.file))) {
        audio.src = t.file;
        audio.load();
      }
      pendingSeekRel = isFiniteNumber(opts.rel) ? opts.rel : 0;
      applyPendingSeek();
    }
    emit('trackchange', { index, track: t });
    updateMediaMetadata();
    save();
    if (opts.autoplay) play();
    else emit('time', { position: relPosition(), duration: relDuration(index) });   // l'affichage, même à l'arrêt
  }

  function applyCurrentTime(target) {
    if (isFiniteNumber(audio.duration) && audio.duration > 0) {
      try { audio.currentTime = clamp(target, 0, audio.duration); } catch { /* avant que le tampon soit prêt */ }
      return;
    }
    pendingSeekRel = target;   // les métadonnées ne sont pas prêtes : plus tard
    audio.addEventListener('loadedmetadata', function once() {
      audio.removeEventListener('loadedmetadata', once);
      try { audio.currentTime = clamp(target, 0, audio.duration || target); } catch { /* idem */ }
      pendingSeekRel = null;
    });
  }

  function applyPendingSeek() {
    if (pendingSeekRel == null || !isFiniteNumber(audio.duration)) return;   // sinon : loadedmetadata, plus bas
    try { audio.currentTime = clamp(pendingSeekRel, 0, audio.duration); } catch { /* idem */ }
    pendingSeekRel = null;
  }

  // ── le transport ──
  function play() {
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        // NotAllowedError : une lecture qu'aucun geste n'a demandée (règle des navigateurs)
        if (err && err.name === 'NotAllowedError') emit('error', { message: 'Touchez le bouton lecture pour démarrer le son.' });
        else if (err && err.name !== 'AbortError') emit('error', { message: messageForMediaError() });
      });
    }
  }
  const pause = () => audio.pause();
  const toggle = () => (audio.paused ? play() : pause());

  function next() {
    if (index < tracks.length - 1) selectByUser(index + 1, true);
    else { pause(); selectByUser(0, false); }   // la fin de la playlist
  }

  function previous() {
    // plus de 3 s (ou déjà le premier morceau) : au début du morceau ; sinon le précédent
    if (relPosition() > 3 || index === 0) seekRelative(0);
    else selectByUser(index - 1, !audio.paused);
  }

  // un choix explicite (un titre touché, suivant, précédent, #3)
  function selectByUser(i, autoplay) {
    if (mode !== 'continuous') { load(i, { autoplay, rel: 0 }); return; }
    index = clamp(i, 0, tracks.length - 1);
    manualSeek = true;
    applyCurrentTime(trackStart(tracks[index]));
    emit('trackchange', { index, track: tracks[index] });
    updateMediaMetadata();
    save();
    if (autoplay) play();
    emit('time', { position: 0, duration: relDuration(index) });
  }

  // se déplacer dans le morceau courant (secondes relatives)
  function seekRelative(relSeconds) {
    const t = tracks[index];
    if (!t) return;
    const dur = relDuration(index);
    const r = clamp(relSeconds, 0, isFiniteNumber(dur) ? dur : relSeconds);
    try {
      if (mode === 'continuous') {
        manualSeek = true;
        audio.currentTime = clamp(trackStart(t) + r, 0, audio.duration || trackStart(t) + r);
      } else {
        audio.currentTime = r;
      }
    } catch { /* idem */ }
    emit('time', { position: relPosition(), duration: relDuration(index) });
  }

  // par fraction [0..1] (la barre de progression)
  function seekFraction(f) {
    const dur = relDuration(index);
    if (isFiniteNumber(dur) && dur > 0) seekRelative(clamp(f, 0, 1) * dur);
  }

  function setVolume(v) { audio.volume = clamp(v, 0, 1); save(); }
  function setMuted(m) { audio.muted = !!m; save(); }
  function toggleMute() { setMuted(!audio.muted); return audio.muted; }

  // ── la Media Session API (écran verrouillé, commandes du système) ──
  const hasMediaSession = () => 'mediaSession' in navigator;

  function updateMediaMetadata() {
    if (!hasMediaSession() || typeof window.MediaMetadata === 'undefined') return;
    const t = tracks[index] || {};
    const art = [];
    if (data.artwork512) art.push({ src: absolute(data.artwork512), sizes: '512x512', type: guessType(data.artwork512) });
    if (data.cover) art.push({ src: absolute(data.cover), sizes: '1200x1200', type: guessType(data.cover) });
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: t.title || '', artist: t.artist || data.artist || '', album: data.title || '', artwork: art,
      });
    } catch { /* pas bloquant */ }
  }

  function setActionHandler(action, handler) {
    if (!hasMediaSession()) return;
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* action que ce navigateur n'a pas */ }
  }

  function setupMediaSession() {
    if (!hasMediaSession()) return;
    setActionHandler('play', () => play());
    setActionHandler('pause', () => pause());
    setActionHandler('previoustrack', () => previous());
    setActionHandler('nexttrack', () => next());
    setActionHandler('seekbackward', (d) => seekRelative(relPosition() - ((d && d.seekOffset) || 10)));
    setActionHandler('seekforward', (d) => seekRelative(relPosition() + ((d && d.seekOffset) || 10)));
    setActionHandler('seekto', (d) => {
      if (!d) return;
      if (d.fastSeek && typeof audio.fastSeek === 'function' && mode === 'separate') audio.fastSeek(d.seekTime);
      else if (isFiniteNumber(d.seekTime)) seekRelative(d.seekTime);
    });
    setActionHandler('stop', () => { pause(); seekRelative(0); });
  }

  function updatePositionState() {
    if (!hasMediaSession() || typeof navigator.mediaSession.setPositionState !== 'function') return;
    const dur = relDuration(index);
    if (!isFiniteNumber(dur) || dur <= 0) return;
    try {
      navigator.mediaSession.setPositionState({ duration: dur, position: clamp(relPosition(), 0, dur), playbackRate: audio.playbackRate || 1 });
    } catch { /* des valeurs incohérentes le temps d'un chargement */ }
  }

  function setPlaybackState(state) {
    if (hasMediaSession()) try { navigator.mediaSession.playbackState = state; } catch { /* idem */ }
  }

  // ── des erreurs lisibles ──
  function messageForMediaError() {
    const err = audio.error;
    switch (err && err.code) {
      case 1: return 'Lecture interrompue.';
      case 2: return 'Problème de réseau pendant le chargement du morceau.';
      case 3: return 'Ce fichier audio semble abîmé.';
      case 4: return 'Fichier audio introuvable, ou format non pris.';
      default: return 'Impossible de lire ce morceau.';
    }
  }

  // ── la reprise ──
  let saveThrottle = 0;
  function save(force) {
    const now = Date.now();
    if (!force && now - saveThrottle < 3000) return;
    saveThrottle = now;
    try {
      localStorage.setItem(key, JSON.stringify({ index, rel: relPosition(), volume: audio.volume, muted: audio.muted }));
    } catch { /* navigation privée, stockage bloqué */ }
  }

  function readState() {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  }

  // le morceau et la position d'avant, SANS lancer la lecture ; `start` (un morceau direct, #3) passe avant
  function restore(start) {
    const st = readState();
    if (st && isFiniteNumber(st.volume)) audio.volume = clamp(st.volume, 0, 1);
    if (st && typeof st.muted === 'boolean') audio.muted = st.muted;
    if (isFiniteNumber(start)) { load(clamp(start, 0, tracks.length - 1), { autoplay: false, rel: 0 }); return st; }
    const i = st && isFiniteNumber(st.index) ? clamp(st.index, 0, tracks.length - 1) : 0;
    load(i, { autoplay: false, rel: st && isFiniteNumber(st.rel) ? st.rel : 0 });
    return st;
  }

  // ── les adresses (relatives : le lecteur marche à la racine comme dans un sous-dossier) ──
  function absolute(path) {
    try { return new URL(path, document.baseURI).href; } catch { return path; }
  }
  function guessType(path) {
    const p = String(path).toLowerCase().split('?')[0];
    if (p.endsWith('.png')) return 'image/png';
    if (p.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
  }

  // ── les évènements de <audio> ──
  audio.addEventListener('loadedmetadata', () => {
    applyPendingSeek();
    emit('loaded', { index, track: tracks[index] });
    emit('time', { position: relPosition(), duration: relDuration(index) });
    updatePositionState();
  });

  audio.addEventListener('play', () => {
    setPlaybackState('playing');
    emit('playstate', { playing: true });
    updatePositionState();
  });

  audio.addEventListener('pause', () => {
    setPlaybackState('paused');
    emit('playstate', { playing: false });
    save(true);
  });

  audio.addEventListener('timeupdate', () => {
    if (mode === 'continuous' && !manualSeek) {
      const i = indexForTime(audio.currentTime);   // le passage d'un morceau au suivant, pendant la lecture
      if (i !== index) {
        index = i;
        emit('trackchange', { index, track: tracks[index] });
        updateMediaMetadata();
      }
    }
    manualSeek = false;
    emit('time', { position: relPosition(), duration: relDuration(index) });
    updatePositionState();
    save();
  });

  audio.addEventListener('ended', () => {
    if (mode === 'continuous') { pause(); selectByUser(0, false); return; }   // le fichier entier est fini
    if (index < tracks.length - 1) { load(index + 1, { autoplay: true, rel: 0 }); return; }   // le suivant, aussitôt
    setPlaybackState('none');   // le dernier : on s'arrête proprement
    emit('playstate', { playing: false });
    load(0, { autoplay: false, rel: 0 });
  });

  audio.addEventListener('error', () => {
    if (audio.src) emit('error', { message: messageForMediaError() });   // l'erreur « vide » d'avant toute source
  });

  // la position gardée quand la page se ferme ou passe derrière
  for (const ev of ['pagehide', 'beforeunload']) window.addEventListener(ev, () => save(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(true); });

  return {
    on,
    init(start) { setupMediaSession(); return restore(start); },
    load,
    select: (i) => selectByUser(i, true),
    jump: (i, autoplay) => selectByUser(i, autoplay),
    play, pause, toggle, next, previous, seekFraction, seekRelative, setVolume, setMuted, toggleMute,
    getIndex: () => index,
    isPlaying: () => !audio.paused,
    getVolume: () => audio.volume,
    isMuted: () => audio.muted,
    getMode: () => mode,
    relPosition,
    relDuration: () => relDuration(index),
  };
}
