// MONTAGE — le modèle d'un montage, sans DOM.
//
// Les positions sur la timeline (start, dur, fondus) sont en images
// entières à la cadence du projet : une coupe tombe toujours sur une
// image. `in` est en secondes dans la source, qui a sa propre cadence.
// `windows()` fait le même calcul que `windows()` de
// server/tools/montage.py : ce que la page lit est ce que ffmpeg rend.
//
// Aucune piste ne porte deux plans au même instant : chaque geste passe
// par `clearRange` (écraser) ou `insertGap` (insérer), jamais à côté.

export const NEUTRAL = { exposure: 0, contrast: 0, saturation: 0, temperature: 6500 };
export const clipEnd = (c) => c.start + c.dur;
export const trackKind = (tid) => (tid[0] === 'V' ? 'video' : 'audio');

// Une piste vidéo prend vidéos et images ; une piste son prend les sons,
// et le son d'une vidéo (le plan ne lit alors que sa bande son).
export function accepts(tid, kind) {
  return trackKind(tid) === 'video' ? kind === 'video' || kind === 'image' : kind === 'audio' || kind === 'video';
}

export const projectEnd = (p) => p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
export const trackClips = (p, tid) => p.clips.filter((c) => c.track === tid).sort((a, b) => a.start - b.start);
export const byId = (p, id) => p.clips.find((c) => c.id === id);

let seq = 0;
export const newClipId = () => 'k' + Date.now().toString(36).slice(-5) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);

// ── la lecture : fenêtres et rampes ──────────────────────────
export function xfadeFrames(a, b) {
  if (!(b.xfade > 0) || clipEnd(a) !== b.start) return 0;
  return Math.max(0, Math.min(b.xfade, a.dur, b.dur));
}

// Fondu enchaîné de N images entre A et B collés : centré sur la coupe.
// B commence N>>1 images plus tôt et monte de 0 à 1 sur N images, posé
// sur A ; A dure N - (N>>1) images de plus, caché sous B (son son descend).
export function windows(p) {
  const out = new Map();
  const tracks = new Map();
  for (const c of p.clips) {
    if (!tracks.has(c.track)) tracks.set(c.track, []);
    tracks.get(c.track).push(c);
    out.set(c.id, { clip: c, ws: c.start, we: clipEnd(c), fin: c.fade_in || 0, fout: c.fade_out || 0, xin: 0, xout: 0 });
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

export const srcTime = (c, t, fps) => (c.in || 0) + t - c.start / fps;

export function audibleTracks(p) {
  const solo = p.tracks.some((t) => t.solo);
  return new Set(p.tracks.filter((t) => !t.mute && (t.solo || !solo)).map((t) => t.id));
}

// ── les gestes ───────────────────────────────────────────────
function headCut(c, cutFrames, fps) {
  return { ...c, start: c.start + cutFrames, dur: c.dur - cutFrames,
    in: c.kind === 'image' ? 0 : (c.in || 0) + cutFrames / fps, xfade: 0, fade_in: Math.min(c.fade_in || 0, c.dur - cutFrames) };
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
      out.push({ ...headCut(c, e - cs, fps), id: newClipId() });
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
  const right = { ...headCut(c, f - c.start, p.settings.fps), id: newClipId(), fade_out: c.fade_out || 0 };
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

// Les bornes d'un rognage, en images, fixées au début du geste : on ne
// passe ni sur le voisin, ni au-delà de la source.
export function trimLimits(p, c, side) {
  const fps = p.settings.fps;
  const cl = trackClips(p, c.track);
  const prevEnd = cl.filter((x) => x !== c && clipEnd(x) <= c.start).reduce((m, x) => Math.max(m, clipEnd(x)), 0);
  const next = cl.find((x) => x !== c && x.start >= clipEnd(c));
  const media = c.kind !== 'image' && c.src_dur > 0;
  if (side === 'l') {
    let lo = -(c.start - prevEnd);
    if (c.kind !== 'image') lo = Math.max(lo, -Math.floor((c.in || 0) * fps + 1e-6));
    return [lo, c.dur - 1];
  }
  let hi = next ? next.start - clipEnd(c) : Infinity;
  if (media) hi = Math.min(hi, Math.floor((c.src_dur - (c.in || 0)) * fps + 1e-6) - c.dur);
  return [-(c.dur - 1), Math.max(0, hi)];
}

export function trimClip(c, side, d, fps) {
  if (side === 'l') {
    c.start += d; c.dur -= d;
    if (c.kind !== 'image') c.in = Math.max(0, (c.in || 0) + d / fps);
  } else c.dur += d;
  c.fade_in = Math.min(c.fade_in || 0, c.dur);
  c.fade_out = Math.min(c.fade_out || 0, c.dur);
}

// ── l'aimant ─────────────────────────────────────────────────
export function snapPoints(p, exclude = new Set(), extra = []) {
  const pts = new Set([0, ...extra]);
  for (const c of p.clips) if (!exclude.has(c.id)) { pts.add(c.start); pts.add(clipEnd(c)); }
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
  p.settings.fps = fps;
}

// ── l'affichage du temps ─────────────────────────────────────
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
