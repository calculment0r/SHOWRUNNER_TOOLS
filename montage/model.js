// MONTAGE — le modèle d'un montage, sans DOM.
//
// Les positions sur la timeline (start, dur, fondus) sont en images
// entières à la cadence du projet : une coupe tombe toujours sur une
// image. `in` est en secondes dans la source, qui a sa propre cadence ;
// `speed` dit combien de secondes de source passent par seconde de
// timeline (1 = vitesse normale, 0,5 = ralenti de moitié). `windows()`
// fait le même calcul que `windows()` de server/tools/montage.py : ce que
// la page lit est ce que ffmpeg rend.
//
// Aucune piste ne porte deux plans au même instant : chaque geste passe
// par `clearRange` (écraser) ou `insertGap` (insérer), jamais à côté.
//
// Les pistes sont nommées par leur place, comme dans Premiere : V1 est la
// piste vidéo du bas, A1 la piste son du haut. Ajouter ou retirer une piste
// renumérote (`renumber`) et rend la table ancien → nouveau nom.

export const NEUTRAL = { exposure: 0, contrast: 0, saturation: 0, temperature: 6500 };
export const SPEED_MIN = 0.1, SPEED_MAX = 10;
export const MAX_TRACKS = 20;            // par sorte (vidéo, son) — le serveur borne pareil
export const clipEnd = (c) => c.start + c.dur;
export const trackKind = (tid) => (tid[0] === 'V' ? 'video' : 'audio');
export const spd = (c) => (c.kind === 'image' ? 1 : (c.speed > 0 ? c.speed : 1));
export const isOn = (c) => c.enabled !== false;

// Une piste vidéo prend vidéos et images ; une piste son prend les sons,
// et le son d'une vidéo (le plan ne lit alors que sa bande son).
export function accepts(tid, kind) {
  return trackKind(tid) === 'video' ? kind === 'video' || kind === 'image' : kind === 'audio' || kind === 'video';
}

export const projectEnd = (p) => p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
export const trackClips = (p, tid) => p.clips.filter((c) => c.track === tid).sort((a, b) => a.start - b.start);
export const byId = (p, id) => p.clips.find((c) => c.id === id);
export const trackOf = (p, tid) => p.tracks.find((t) => t.id === tid);
export const lockedSet = (p) => new Set(p.tracks.filter((t) => t.lock).map((t) => t.id));
export const trackOrder = (p) => ({ video: p.tracks.filter((t) => t.kind === 'video').map((t) => t.id), audio: p.tracks.filter((t) => t.kind === 'audio').map((t) => t.id) });

let seq = 0;
export const newClipId = () => 'k' + Date.now().toString(36).slice(-5) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);
export const newId = (pre) => pre + Date.now().toString(36).slice(-5) + (seq++).toString(36) + Math.random().toString(36).slice(2, 4);
const clone = (x) => JSON.parse(JSON.stringify(x));

// ── la lecture : fenêtres et rampes ──────────────────────────
export function xfadeFrames(a, b) {
  if (!(b.xfade > 0) || clipEnd(a) !== b.start) return 0;
  return Math.max(0, Math.min(b.xfade, a.dur, b.dur));
}

// Fondu enchaîné de N images entre A et B collés : centré sur la coupe.
// B commence N>>1 images plus tôt et monte de 0 à 1 sur N images, posé
// sur A ; A dure N - (N>>1) images de plus, caché sous B (son son descend).
// Un plan désactivé ne se voit ni ne s'entend : il ne fond avec personne.
export function windows(p) {
  const out = new Map();
  const tracks = new Map();
  for (const c of p.clips) {
    out.set(c.id, { clip: c, ws: c.start, we: clipEnd(c), fin: c.fade_in || 0, fout: c.fade_out || 0, xin: 0, xout: 0 });
    if (!isOn(c)) continue;
    if (!tracks.has(c.track)) tracks.set(c.track, []);
    tracks.get(c.track).push(c);
  }
  for (const cl of tracks.values()) {
    cl.sort((a, b) => a.start - b.start);
    for (let i = 1; i < cl.length; i++) {
      const a = cl[i - 1], b = cl[i], n = xfadeFrames(a, b);
      if (!n) continue;
      const h1 = n >> 1, wa = out.get(a.id), wb = out.get(b.id);
      Object.assign(wb, { ws: b.start - h1, xin: n, fin: 0 });
      Object.assign(wa, { we: clipEnd(a) + (n - h1), xout: n, fout: 0 });
    }
  }
  return out;
}

// L'opacité d'une image, comme ffmpeg `fade` la calcule (vf_fade) :
// en entrée sur n images, l'image k vaut k/n (la première est
// transparente) ; en sortie, l'image k des n dernières vaut (nf-k)/n.
export function opacityAt(w, frame) {
  const k = frame - w.ws, nf = w.we - w.ws;
  let a = 1;
  if (w.xin) a = Math.min(a, k / w.xin);
  if (w.fin) a = Math.min(a, k / w.fin);
  if (w.fout && k >= nf - w.fout) a = Math.min(a, (nf - k) / w.fout);
  return Math.max(0, Math.min(1, a));
}

// Le gain d'un son (hors volume du plan), comme `afade` (rampe linéaire).
export function gainAt(w, t, fps) {
  const x = t * fps - w.ws, nf = w.we - w.ws;
  let g = 1;
  if (w.xin) g = Math.min(g, x / w.xin);
  if (w.fin) g = Math.min(g, x / w.fin);
  if (w.xout) g = Math.min(g, (nf - x) / w.xout);
  if (w.fout) g = Math.min(g, (nf - x) / w.fout);
  return Math.max(0, Math.min(1, g));
}

// le temps dans la source qui se voit à l'instant t du montage
export const srcTime = (c, t, fps) => (c.in || 0) + (t - c.start / fps) * spd(c);

export function audibleTracks(p) {
  const solo = p.tracks.some((t) => t.solo);
  return new Set(p.tracks.filter((t) => !t.mute && (t.solo || !solo)).map((t) => t.id));
}

// ── les gestes ───────────────────────────────────────────────
function headCut(c, cutFrames, fps) {
  return { ...c, start: c.start + cutFrames, dur: c.dur - cutFrames,
    in: c.kind === 'image' ? 0 : (c.in || 0) + cutFrames / fps * spd(c), xfade: 0, fade_in: Math.min(c.fade_in || 0, c.dur - cutFrames) };
}

// Vide [s, e) sur une piste : les plans couverts partent, ceux qui
// débordent sont rognés, celui qui englobe est coupé en deux.
export function clearRange(p, tid, s, e, keep = new Set()) {
  const fps = p.settings.fps;
  const out = [];
  for (const c of p.clips) {
    if (c.track !== tid || keep.has(c.id)) { out.push(c); continue; }
    const cs = c.start, ce = clipEnd(c);
    if (ce <= s || cs >= e) { out.push(c); continue; }
    if (cs >= s && ce <= e) continue;
    if (cs < s && ce > e) {
      out.push({ ...c, dur: s - cs, fade_out: 0 });
      out.push({ ...clone(headCut(c, e - cs, fps)), id: newClipId() });
      continue;
    }
    if (cs < s) { out.push({ ...c, dur: s - cs, fade_out: Math.min(c.fade_out || 0, s - cs) }); continue; }
    out.push(headCut(c, e - cs, fps));
  }
  p.clips = out;
}

// Ouvre `len` images à `at` sur une piste : coupe ce qui passe par `at`
// et pousse la suite.
export function insertGap(p, tid, at, len) {
  const spanning = p.clips.find((c) => c.track === tid && c.start < at && clipEnd(c) > at);
  if (spanning) cutAt(p, spanning.id, at);
  for (const c of p.clips) if (c.track === tid && c.start >= at) c.start += len;
}

// Coupe un plan à l'image f ; rend l'identifiant du morceau de droite.
export function cutAt(p, id, f) {
  const c = byId(p, id);
  if (!c || f <= c.start || f >= clipEnd(c)) return null;
  const right = { ...clone(headCut(c, f - c.start, p.settings.fps)), id: newClipId(), fade_out: c.fade_out || 0 };
  right.fade_in = 0;
  c.dur = f - c.start;
  c.fade_out = 0;
  c.fade_in = Math.min(c.fade_in || 0, c.dur);
  p.clips.push(right);
  return right.id;
}

export function deleteClips(p, ids) {
  p.clips = p.clips.filter((c) => !ids.has(c.id));
}

// Supprimer avec raccord : la suite de la piste recule d'autant.
export function rippleDelete(p, ids) {
  const gone = p.clips.filter((c) => ids.has(c.id)).sort((a, b) => b.start - a.start);
  p.clips = p.clips.filter((c) => !ids.has(c.id));
  for (const g of gone) {
    for (const c of p.clips) if (c.track === g.track && c.start >= clipEnd(g)) c.start -= g.dur;
  }
}

// Le vide qui contient l'image f sur une piste : [fin du plan d'avant, début du suivant).
export function gapAt(p, tid, f) {
  const cl = trackClips(p, tid);
  if (cl.some((c) => c.start <= f && clipEnd(c) > f)) return null;
  const before = cl.filter((c) => clipEnd(c) <= f).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const next = cl.find((c) => c.start > f);
  if (!next) return null;
  return { track: tid, s: before, e: next.start };
}

export function closeGap(p, gap) {
  const len = gap.e - gap.s;
  for (const c of p.clips) if (c.track === gap.track && c.start >= gap.e) c.start -= len;
}

// Pose un plan : écraser (par défaut) ou insérer (pousse la suite).
export function placeClip(p, clip, mode = 'overwrite') {
  if (mode === 'insert') insertGap(p, clip.track, clip.start, clip.dur);
  else clearRange(p, clip.track, clip.start, clipEnd(clip));
  p.clips.push(clip);
}

// Déplace (ou copie) des plans de `df` images et `dt` pistes (dans leur
// famille), posés en écrasant ou en insérant. Rend les identifiants posés.
export function moveClips(p, ids, df, dt = 0, mode = 'overwrite', copy = false) {
  const order = trackOrder(p);
  const moving = [...ids].map((id) => byId(p, id)).filter(Boolean).map(clone);
  if (!copy) p.clips = p.clips.filter((c) => !ids.has(c.id));
  for (const c of moving) {
    if (copy) c.id = newClipId();
    const list = order[trackKind(c.track)];
    c.track = list[Math.max(0, Math.min(list.length - 1, list.indexOf(c.track) + dt))];
    c.start = Math.max(0, c.start + df);
  }
  moving.sort((a, b) => a.start - b.start);
  for (const c of moving) placeClip(p, c, mode);
  return moving.map((c) => c.id);
}

// Coller des plans copiés (positions relatives gardées) à l'image `at`,
// sur leurs pistes d'origine (ou la cible de leur sorte si elle n'existe
// plus). Insérer ouvre la place sur toutes les pistes libres (la
// synchronisation reste), écraser pose par-dessus.
export function pasteClips(p, clips, at, mode = 'overwrite', target = {}) {
  if (!clips.length) return [];
  const min = Math.min(...clips.map((c) => c.start));
  const span = Math.max(...clips.map(clipEnd)) - min;
  const locked = lockedSet(p);
  if (mode === 'insert') for (const t of p.tracks) if (!locked.has(t.id)) insertGap(p, t.id, at, span);
  const out = [];
  for (const c0 of clips) {
    const c = clone(c0);
    c.id = newClipId();
    if (!trackOf(p, c.track) || !accepts(c.track, c.kind)) c.track = target[c.kind === 'audio' ? 'audio' : 'video'];
    if (!c.track || locked.has(c.track)) continue;
    c.start = at + (c0.start - min);
    placeClip(p, c, 'overwrite');
    out.push(c.id);
  }
  return out;
}

// Lever (Premiere « Prélever », ;) : vider [s, e) sur les pistes libres ;
// extraire (Premiere « Extraire », ') : vider puis refermer. Les marques
// de séquence dans la plage extraite partent (comme dans Premiere).
export function liftRange(p, s, e) {
  const locked = lockedSet(p);
  for (const t of p.tracks) if (!locked.has(t.id)) clearRange(p, t.id, s, e);
}
export function extractRange(p, s, e) {
  const locked = lockedSet(p);
  liftRange(p, s, e);
  for (const c of p.clips) if (!locked.has(c.track) && c.start >= e) c.start -= e - s;
  if (p.markers) p.markers = p.markers.filter((m) => m.f < s || m.f >= e).map((m) => (m.f >= e ? { ...m, f: m.f - (e - s) } : m));
}

// Les bornes d'un rognage, en images, fixées au début du geste : on ne
// passe ni sur le voisin, ni au-delà de la source.
function headRoom(c, fps) { return c.kind === 'image' ? Infinity : Math.floor((c.in || 0) * fps / spd(c) + 1e-6); }
function tailRoom(c, fps) {
  if (c.kind === 'image' || !(c.src_dur > 0)) return Infinity;
  return Math.max(0, Math.floor((c.src_dur - (c.in || 0)) * fps / spd(c) + 1e-6) - c.dur);
}
function neighbours(p, c) {
  const cl = trackClips(p, c.track).filter((x) => x.id !== c.id);
  const prevEnd = cl.filter((x) => clipEnd(x) <= c.start).reduce((m, x) => Math.max(m, clipEnd(x)), 0);
  const next = cl.find((x) => x.start >= clipEnd(c));
  const prev = cl.filter((x) => clipEnd(x) <= c.start).sort((a, b) => clipEnd(b) - clipEnd(a))[0];
  return { prevEnd, prev, next, prevTouch: prev && clipEnd(prev) === c.start ? prev : null, nextTouch: next && next.start === clipEnd(c) ? next : null };
}

export function trimLimits(p, c, side) {
  const fps = p.settings.fps;
  const { prevEnd, next } = neighbours(p, c);
  if (side === 'l') return [Math.max(-(c.start - prevEnd), -headRoom(c, fps)), c.dur - 1];
  const hi = Math.min(next ? next.start - clipEnd(c) : Infinity, tailRoom(c, fps));
  return [-(c.dur - 1), Math.max(0, hi)];
}

export function trimClip(c, side, d, fps) {
  if (side === 'l') {
    c.start += d; c.dur -= d;
    if (c.kind !== 'image') c.in = Math.max(0, (c.in || 0) + d / fps * spd(c));
  } else c.dur += d;
  c.fade_in = Math.min(c.fade_in || 0, c.dur);
  c.fade_out = Math.min(c.fade_out || 0, c.dur);
}

// Propagation (Premiere, B) : rogner un bord et pousser ou tirer la suite
// de la piste d'autant ; la tête rognée garde sa place (c'est la matière
// qui change), le vide ne se crée pas.
export function rippleLimits(p, c, side) {
  const fps = p.settings.fps;
  if (side === 'l') return [-headRoom(c, fps), c.dur - 1];
  return [-(c.dur - 1), tailRoom(c, fps)];
}
export function rippleTrim(p, id, side, d) {
  const c = byId(p, id), fps = p.settings.fps;
  if (!c || !d) return;
  const end0 = clipEnd(c);
  if (side === 'l') {
    c.dur -= d;
    if (c.kind !== 'image') c.in = Math.max(0, (c.in || 0) + d / fps * spd(c));
  } else c.dur += d;
  c.fade_in = Math.min(c.fade_in || 0, c.dur);
  c.fade_out = Math.min(c.fade_out || 0, c.dur);
  const shift = clipEnd(c) - end0;
  for (const x of p.clips) if (x.id !== c.id && x.track === c.track && x.start >= end0) x.start += shift;
}

// Déplacement de la coupe (Premiere « Rolling », N) : le point de coupe
// entre deux plans collés bouge, la somme de leurs durées ne change pas.
export function rollLimits(p, a, b) {
  const fps = p.settings.fps;
  return [Math.max(-(a.dur - 1), -headRoom(b, fps)), Math.min(b.dur - 1, tailRoom(a, fps))];
}
export function roll(p, aId, bId, d) {
  const a = byId(p, aId), b = byId(p, bId), fps = p.settings.fps;
  if (!a || !b || !d) return;
  a.dur += d;
  b.start += d; b.dur -= d;
  if (b.kind !== 'image') b.in = Math.max(0, (b.in || 0) + d / fps * spd(b));
  for (const x of [a, b]) { x.fade_in = Math.min(x.fade_in || 0, x.dur); x.fade_out = Math.min(x.fade_out || 0, x.dur); }
}
// le voisin collé de ce côté, s'il y en a un (sinon Rolling rogne comme Sélection)
export function rollPair(p, c, side) {
  const n = neighbours(p, c);
  return side === 'l' ? (n.prevTouch ? [n.prevTouch, c] : null) : (n.nextTouch ? [c, n.nextTouch] : null);
}

// Déplacer dessous (Premiere « Slip », Y) : le contenu glisse dans le
// plan ; sa place et sa durée ne bougent pas. Tirer vers la droite montre
// une matière plus ancienne (Adobe : « tiré vers la gauche, les points
// d'entrée et de sortie source avancent »).
export function slipLimits(p, c) {
  const fps = p.settings.fps;
  if (c.kind === 'image') return [0, 0];
  return [-tailRoom(c, fps), headRoom(c, fps)];
}
export function slip(p, id, d) {
  const c = byId(p, id);
  if (!c || c.kind === 'image' || !d) return;
  c.in = Math.max(0, (c.in || 0) - d / p.settings.fps * spd(c));
}

// Déplacer le plan (Premiere « Slide », U) : le plan garde sa matière et
// sa durée ; il glisse entre ses voisins, dont la sortie (avant) et
// l'entrée (après) s'ajustent. Sans voisin collé, c'est le vide qui change.
export function slideLimits(p, c) {
  const fps = p.settings.fps;
  const n = neighbours(p, c);
  let lo = n.prevTouch ? -(n.prevTouch.dur - 1) : -(c.start - n.prevEnd);
  let hi = n.nextTouch ? n.nextTouch.dur - 1 : (n.next ? n.next.start - clipEnd(c) : Infinity);
  if (n.prevTouch) hi = Math.min(hi, tailRoom(n.prevTouch, fps));
  if (n.nextTouch) lo = Math.max(lo, -headRoom(n.nextTouch, fps));
  return [lo, hi];
}
export function slide(p, id, d) {
  const c = byId(p, id), fps = p.settings.fps;
  if (!c || !d) return;
  const n = neighbours(p, c);
  if (n.prevTouch) { const a = byId(p, n.prevTouch.id); a.dur += d; a.fade_out = Math.min(a.fade_out || 0, a.dur); }
  if (n.nextTouch) {
    const b = byId(p, n.nextTouch.id);
    b.start += d; b.dur -= d;
    if (b.kind !== 'image') b.in = Math.max(0, (b.in || 0) + d / fps * spd(b));
    b.fade_in = Math.min(b.fade_in || 0, b.dur);
  }
  c.start += d;
}

// Modification de la vitesse (Premiere « Rate Stretch », R) : tirer un
// bord change la durée ; la matière (de l'entrée à la sortie) reste la
// même, c'est la vitesse qui suit. Une image fixe se rogne simplement.
export function stretchLimits(p, c, side) {
  const { prevEnd, next } = neighbours(p, c);
  const srcFrames = c.dur * spd(c);                    // la matière, en images de timeline à vitesse 1
  const img = c.kind === 'image';
  const dMin = img ? 1 : Math.ceil(srcFrames / SPEED_MAX - 1e-9), dMax = img ? Infinity : Math.floor(srcFrames / SPEED_MIN + 1e-9);
  const lo = Math.max(1, dMin), hiRoom = side === 'l' ? c.start - prevEnd : (next ? next.start - clipEnd(c) : Infinity);
  const hi = Math.min(dMax, c.dur + hiRoom);
  return side === 'l' ? [c.dur - hi, c.dur - lo] : [lo - c.dur, hi - c.dur];
}
export function stretch(p, id, side, d) {
  const c = byId(p, id);
  if (!c || !d) return;
  const nd = c.dur + (side === 'l' ? -d : d);
  if (nd < 1) return;
  if (c.kind !== 'image') c.speed = Math.max(SPEED_MIN, Math.min(SPEED_MAX, spd(c) * c.dur / nd));
  if (side === 'l') c.start += d;
  c.dur = nd;
  c.fade_in = Math.min(c.fade_in || 0, c.dur);
  c.fade_out = Math.min(c.fade_out || 0, c.dur);
}

// Vitesse/Durée (Premiere, Ctrl+R) : la matière reste, la durée suit la
// vitesse. Avec propagation, la suite de la piste se décale ; sans, la
// durée s'arrête au plan suivant (rend la durée obtenue).
export function setSpeed(p, id, speed, ripple = false) {
  const c = byId(p, id);
  if (!c || c.kind === 'image') return 0;
  speed = Math.max(SPEED_MIN, Math.min(SPEED_MAX, speed));
  const end0 = clipEnd(c);
  let nd = Math.max(1, Math.round(c.dur * spd(c) / speed));
  const { next } = neighbours(p, c);
  if (!ripple && next) nd = Math.min(nd, next.start - c.start);
  c.speed = speed;
  c.dur = nd;
  c.fade_in = Math.min(c.fade_in || 0, c.dur);
  c.fade_out = Math.min(c.fade_out || 0, c.dur);
  if (ripple) for (const x of p.clips) if (x.id !== c.id && x.track === c.track && x.start >= end0) x.start += clipEnd(c) - end0;
  return nd;
}

// Sélection de piste en avant (Premiere, A) : le plan sous le pointeur et
// tout ce qui commence après, sur sa piste (maj : sur toutes les pistes).
export function selectForward(p, f, tid = null) {
  const locked = lockedSet(p);
  return new Set(p.clips.filter((c) => (tid ? c.track === tid : !locked.has(c.track)) && clipEnd(c) > f).map((c) => c.id));
}

// ── les pistes ───────────────────────────────────────────────
export function renumber(p) {
  const vids = p.tracks.filter((t) => t.kind === 'video'), auds = p.tracks.filter((t) => t.kind === 'audio');
  const map = {};
  vids.forEach((t, i) => { map[t.id] = 'V' + (vids.length - i); });
  auds.forEach((t, i) => { map[t.id] = 'A' + (i + 1); });
  p.tracks = [...vids, ...auds].map((t) => ({ ...t, id: map[t.id] }));
  for (const c of p.clips) c.track = map[c.track];
  return map;
}

// Ajouter une piste de cette sorte au-dessus ou au-dessous de `ref` (à
// l'écran) ; rend { map, id } : la table des anciens noms et le nom de la
// nouvelle.
export function addTrack(p, kind, ref, where = 'above') {
  const n = p.tracks.filter((t) => t.kind === kind).length;
  if (n >= MAX_TRACKS) return null;
  const t = { id: '_new', kind, mute: false, solo: false, lock: false, hide: false, name: '' };
  let i = p.tracks.findIndex((x) => x.id === ref && x.kind === kind);
  if (i < 0) i = kind === 'video' ? (where === 'above' ? 0 : n - 1) : (where === 'above' ? p.tracks.findIndex((x) => x.kind === 'audio') : p.tracks.length - 1);
  p.tracks.splice(where === 'above' ? i : i + 1, 0, t);
  const map = renumber(p);
  return { map, id: map._new };
}

export function deleteTrack(p, tid) {
  const t = trackOf(p, tid);
  if (!t || p.tracks.filter((x) => x.kind === t.kind).length <= 1) return null;
  p.clips = p.clips.filter((c) => c.track !== tid);
  p.tracks = p.tracks.filter((x) => x.id !== tid);
  const map = renumber(p);
  map[tid] = null;
  return map;
}

// ── les marques ──────────────────────────────────────────────
export function addMarker(p, f, name = '') {
  p.markers = (p.markers || []).filter((m) => m.f !== f);
  const m = { id: newId('m'), f, name };
  p.markers.push(m);
  p.markers.sort((a, b) => a.f - b.f);
  return m;
}

// ── l'aimant ─────────────────────────────────────────────────
export function snapPoints(p, exclude = new Set(), extra = []) {
  const pts = new Set([0, ...extra]);
  for (const c of p.clips) if (!exclude.has(c.id)) { pts.add(c.start); pts.add(clipEnd(c)); }
  for (const m of p.markers || []) pts.add(m.f);
  return [...pts];
}

// Rend le décalage (en images) qui colle l'un des `edges` au point le plus proche, dans la tolérance.
export function snapDelta(edges, points, tol) {
  let best = null;
  for (const e of edges) for (const q of points) {
    const d = q - e;
    if (Math.abs(d) <= tol && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best;
}

export function editPoints(p) {
  const s = new Set([0]);
  for (const c of p.clips) { s.add(c.start); s.add(clipEnd(c)); }
  return [...s].sort((a, b) => a - b);
}

// Changer de cadence : chaque bord est arrondi à la nouvelle grille,
// deux plans collés le restent.
export function convertFps(p, fps) {
  const r = fps / p.settings.fps;
  if (r === 1) return;
  for (const c of p.clips) {
    const s = Math.round(c.start * r), e = Math.round(clipEnd(c) * r);
    c.start = s; c.dur = Math.max(1, e - s);
    c.fade_in = Math.min(c.dur, Math.round((c.fade_in || 0) * r));
    c.fade_out = Math.min(c.dur, Math.round((c.fade_out || 0) * r));
    c.xfade = Math.round((c.xfade || 0) * r);
  }
  for (const m of p.markers || []) m.f = Math.round(m.f * r);
  if (p.range) for (const k of ['in', 'out']) if (p.range[k] !== null && p.range[k] !== undefined) p.range[k] = Math.round(p.range[k] * r);
  p.settings.fps = fps;
}

// ── l'affichage du temps ─────────────────────────────────────
// Toujours le même nombre de signes (HH:MM:SS:II) : posé en mono à
// chiffres tabulaires, rien ne bouge sur la ligne pendant la lecture.
const two = (n) => String(n).padStart(2, '0');
export function tc(frames, fps) {
  frames = Math.max(0, Math.floor(frames + 1e-6));
  const s = Math.floor(frames / fps), f = frames - s * fps;
  return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}:${two(f)}`;
}
export function short(sec) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(s < 10 && m === 0 ? 1 : 0)}`;
}
export const pct = (x) => `${Math.round(x * 100)} %`;
