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
export const MAX_TRACKS = 20;            // par sorte (vidéo, calque d'effet, son) — le serveur borne pareil
export const clipEnd = (c) => c.start + c.dur;
// V : vidéo, X : calque d'effet (une piste de l'image qui ne porte que des
// calques), A : son. Vidéo et calques forment l'image (en haut), le son en bas.
export const trackKind = (tid) => (tid[0] === 'V' ? 'video' : tid[0] === 'X' ? 'fx' : 'audio');
export const family = (kind) => (kind === 'audio' ? 'audio' : 'image');
// une image fixe et un calque d'effet n'ont ni source qui défile ni vitesse
export const still = (c) => c.kind === 'image' || c.kind === 'adjust';
export const spd = (c) => (still(c) ? 1 : (c.speed > 0 ? c.speed : 1));
export const isOn = (c) => c.enabled !== false;

// Une piste vidéo prend vidéos et images ; une piste son prend les sons,
// et le son d'une vidéo (le plan ne lit alors que sa bande son) ; une piste
// de calques, les calques d'effet.
export function accepts(tid, kind) {
  const k = trackKind(tid);
  if (k === 'fx') return kind === 'adjust';
  return k === 'video' ? kind === 'video' || kind === 'image' : kind === 'audio' || kind === 'video';
}

export const projectEnd = (p) => p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
export const trackClips = (p, tid) => p.clips.filter((c) => c.track === tid).sort((a, b) => a.start - b.start);
export const byId = (p, id) => p.clips.find((c) => c.id === id);
export const trackOf = (p, tid) => p.tracks.find((t) => t.id === tid);
export const groupOf = (p, gid) => (p.groups || []).find((g) => g.id === gid);
export const lockedSet = (p) => new Set(p.tracks.filter((t) => t.lock).map((t) => t.id));
export const trackOrder = (p) => ({ video: p.tracks.filter((t) => t.kind === 'video').map((t) => t.id), audio: p.tracks.filter((t) => t.kind === 'audio').map((t) => t.id),
  fx: p.tracks.filter((t) => t.kind === 'fx').map((t) => t.id) });
export const mediaIds = (p) => p.clips.filter((c) => c.kind !== 'adjust' && c.item).map((c) => c.item);

// ── les effets ───────────────────────────────────────────────
// Un effet est { id, type, on, …réglages } ; une liste d'effets s'applique
// dans l'ordre. Les types sont ceux que l'export sait rendre et que l'aperçu
// calcule pareil : `grade` (exposure, eq, colortemperature — aperçu :
// les formules de Filter Effects) et `lut` (lut3d trilinéaire / lut1d
// linéaire — aperçu : le même calcul en WebGL2). Un plan porte les siens ;
// une piste et un groupe de pistes aussi : ils s'ajoutent à ceux de chacun
// de leurs plans (plan, puis piste, puis groupe). Un calque d'effet (plan
// `adjust` d'une piste X) applique les siens à tout ce qui est dessous.
export const FX_TYPES = ['grade', 'lut'];
export function newFx(type, params = {}) {
  const base = type === 'lut' ? { lut: null, mix: 1 } : { ...NEUTRAL };
  return { id: newId('f'), type, on: true, ...base, ...params };
}
export const cloneFx = (list) => (list || []).map((f) => ({ ...JSON.parse(JSON.stringify(f)), id: newId('f') }));
export const fxOn = (list) => (list || []).filter((f) => f.on !== false && FX_TYPES.includes(f.type));
export const gradeNeutral = (g) => !g.exposure && !g.contrast && !g.saturation && Math.abs((g.temperature || 6500) - 6500) < 0.5;
// ce que l'image d'un plan traverse : ses effets, ceux de sa piste, de son groupe
export function chainOf(p, c) {
  if (!c) return [];
  const t = trackOf(p, c.track);
  if (c.kind === 'adjust') return fxOn(c.fx);
  if (!t || t.kind !== 'video') return [];
  const g = t.grp ? groupOf(p, t.grp) : null;
  return [...fxOn(c.fx), ...fxOn(t.fx), ...(g ? fxOn(g.fx) : [])].filter((f) => f.type !== 'grade' || !gradeNeutral(f));
}
// un plan d'avant ce jour (grade, lut) : ses effets (le serveur fait pareil, `normalize`)
export function normClip(c) {
  if (Array.isArray(c.fx)) { delete c.grade; delete c.lut; return c; }
  const fx = [];
  if (c.grade && !gradeNeutral(c.grade)) fx.push(newFx('grade', { exposure: c.grade.exposure || 0, contrast: c.grade.contrast || 0, saturation: c.grade.saturation || 0, temperature: c.grade.temperature || 6500 }));
  if (c.lut && c.lut.id) fx.push(newFx('lut', { lut: c.lut.id, mix: c.lut.mix ?? 1 }));
  c.fx = fx;
  delete c.grade; delete c.lut;
  return c;
}

// ── la trajectoire (06/10) ───────────────────────────────────
// Cal : « déplacer les éléments dans la frame, pour composer des montages avec
// des grilles vidéo, et même le zoom aussi ». Ce sont les effets fixes de
// Premiere (aide d'Adobe, « Apply Motion effect to clips », par les résultats de
// recherche : helpx.adobe.com ne s'ouvre pas d'ici) : Trajectoire (Position,
// Échelle, Largeur d'échelle avec « Échelle uniforme », Rotation, Point
// d'ancrage), Opacité, et le Recadrage (effet Crop : gauche, haut, droite, bas
// en pour cent). Premiere rend les effets fixes APRÈS les effets standard
// (« Types of effects ») : l'étalonnage et la LUT agissent sur l'image du plan,
// puis elle est recadrée, mise à l'échelle, tournée, posée.
//
// `motion` d'un plan vidéo ou image (piste V) ; absent = l'image tient dans le
// cadre, centrée, comme avant : un montage d'avant ne change pas.
//   x, y      la place du point d'ancrage, en FRACTION du cadre (0,5 ; 0,5 : le
//             centre). Pas en pixels : une grille reste juste si le format de la
//             séquence change (1080p → 4K, 16:9 → 9:16 au même endroit relatif),
//             et les cases d'une grille tombent juste (¼, ¾) ; le panneau l'affiche
//             en pixels de la séquence, comme Premiere.
//   scale     l'échelle (1 = 100 % = l'image TIENT dans le cadre, la mise en place
//             d'avant ; Premiere : « Ajuster à la taille de l'image ») ; c'est la
//             hauteur quand `uniform` est faux, `scaleW` la largeur.
//   rot       degrés, sens des aiguilles d'une montre (Premiere ; CSS rotate ; le
//             filtre rotate de ffmpeg, « clockwise »).
//   ax, ay    le point d'ancrage, en fraction de l'image source (0,5 : son centre) :
//             l'échelle et la rotation se font autour de lui.
//   op        l'opacité (0..1), multipliée par les fondus.
//   cl, ct, cr, cb  le recadrage, fraction de la source retirée de chaque côté :
//             ce qui est retiré devient transparent, l'image ne bouge pas (Crop).
// `cadre()` fait le même calcul que `cadre()` de server/tools/montage.py, ligne
// pour ligne : le moniteur et l'export posent l'image au même endroit.
export const MOTION0 = Object.freeze({ x: 0.5, y: 0.5, scale: 1, scaleW: 1, uniform: true, rot: 0, ax: 0.5, ay: 0.5, op: 1, cl: 0, ct: 0, cr: 0, cb: 0 });
export const MOTION_LIM = { x: [-10, 10], y: [-10, 10], scale: [0, 100], scaleW: [0, 100], rot: [-3600, 3600], ax: [-10, 10], ay: [-10, 10],
  op: [0, 1], cl: [0, 1], ct: [0, 1], cr: [0, 1], cb: [0, 1] };
const MKEYS = ['x', 'y', 'scale', 'scaleW', 'rot', 'ax', 'ay', 'op', 'cl', 'ct', 'cr', 'cb'];
// les plans qui ont une trajectoire : ce qui se voit sur une piste vidéo
export const movable = (c) => !!c && (c.kind === 'video' || c.kind === 'image') && trackKind(c.track || '') === 'video';
export const motionOf = (c) => ({ ...MOTION0, ...((c && c.motion) || {}) });

// ── les images clés de la trajectoire (06/10) ────────────────
// Cal : « on avance avec les images clés ». Le chronomètre de Premiere, dans Options
// d'effet : un par propriété (aide d'Adobe, « Add, navigate, and set keyframes », par
// les résultats de recherche ; helpx.adobe.com ne s'ouvre pas d'ici). Une propriété est
// un GROUPE de champs qui s'animent ensemble — Position (x, y), Échelle (hauteur et
// largeur), Rotation, Point d'ancrage (x, y), Opacité, Recadrage (les quatre côtés).
//   motion.keys = { pos: [[k, [x, y]], [k, [x, y], 1], …], ech: …, rot: …, anc: …, op: …, rec: … }
// k : l'image de la clé, comptée depuis le DÉBUT DU PLAN (un plan déplacé emporte ses
// clés) ; les gestes qui déplacent la tête d'un plan sans déplacer sa matière (rogner le
// début, couper, la propagation, la coupe, le slide) décalent ses clés d'autant : elles
// gardent leur place dans la timeline, comme les images (`shiftKeys`) ; changer la vitesse
// les étire avec la matière (`scaleKeys`). Une clé peut tomber hors du plan (rogné) : elle
// reste, et compte pour ce qui se voit. Le 3ᵉ élément, 1 : le segment qui part de cette clé
// est « lissé » (accélère puis ralentit, smoothstep : u²(3 − 2u)) ; sinon linéaire. Avant
// la première clé, la valeur de la première ; après la dernière, celle de la dernière.
// Une propriété qui a des clés ignore sa valeur fixe. `motionAt` existe deux fois, ligne
// pour ligne (`motion_at`, server/tools/montage.py) : le moniteur et l'export posent la
// même image à la même image.
export const KGROUPS = [
  { id: 'pos', label: 'position', fields: ['x', 'y'] },
  { id: 'ech', label: 'échelle', fields: ['scale', 'scaleW'] },
  { id: 'rot', label: 'rotation', fields: ['rot'] },
  { id: 'anc', label: 'ancrage', fields: ['ax', 'ay'] },
  { id: 'op', label: 'opacité', fields: ['op'] },
  { id: 'rec', label: 'recadrage', fields: ['cl', 'ct', 'cr', 'cb'] },
];
export const KGROUP = Object.fromEntries(KGROUPS.map((g) => [g.id, g]));
export const groupOfField = (f) => KGROUPS.find((g) => g.fields.includes(f));
const MAX_KEYS = 500;
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const borne = (f, v) => r6(Math.max(MOTION_LIM[f][0], Math.min(MOTION_LIM[f][1], v)));
// des clés propres : triées, une par image (la dernière l'emporte), bornées ; [] si rien de lisible
export function cleanKeys(gid, raw) {
  const g = KGROUP[gid];
  if (!g || !Array.isArray(raw)) return [];
  const by = new Map();
  for (const e of raw.slice(0, MAX_KEYS * 2)) {
    if (!Array.isArray(e) || !Array.isArray(e[1]) || e[1].length !== g.fields.length) continue;
    const k = e[0], vals = e[1];
    if (typeof k !== 'number' || !Number.isFinite(k) || !vals.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
    const kk = Math.round(Math.max(-1e6, Math.min(1e6, k)));
    by.set(kk, e[2] === 1 ? [kk, vals.map((v, i) => borne(g.fields[i], v)), 1] : [kk, vals.map((v, i) => borne(g.fields[i], v))]);
  }
  return [...by.values()].sort((a, b) => a[0] - b[0]).slice(0, MAX_KEYS);
}
// la valeur d'un groupe à l'image k (comptée depuis le début du plan)
export function keysAt(keys, k) {
  if (k <= keys[0][0]) return keys[0][1].slice();
  const n = keys.length - 1;
  if (k >= keys[n][0]) return keys[n][1].slice();
  let i = 0;
  while (keys[i + 1][0] <= k) i++;
  const [k0, a, e] = keys[i], [k1, b] = keys[i + 1];
  let u = (k - k0) / (k1 - k0);
  if (e === 1) u = u * u * (3 - 2 * u);
  return a.map((v, j) => v + (b[j] - v) * u);
}
export const hasKeys = (c) => !!(c && c.motion && c.motion.keys && Object.keys(c.motion.keys).length);
export const groupKeys = (c, gid) => (c && c.motion && c.motion.keys && c.motion.keys[gid]) || null;
// La trajectoire d'un plan à l'image `f` de la timeline : ses valeurs fixes, et pour chaque
// groupe qui a des clés, leur valeur à cette image.
export function motionAt(c, f) {
  const m = motionOf(c);
  const keys = c && c.motion && c.motion.keys;
  if (!keys) return m;
  for (const g of KGROUPS) {
    const list = keys[g.id];
    if (!list || !list.length) continue;
    const v = keysAt(list, f - c.start);
    g.fields.forEach((fl, i) => { m[fl] = v[i]; });
  }
  if (m.uniform) m.scaleW = m.scale;
  delete m.keys;
  return m;
}
// Une trajectoire propre : bornée, arrondie (6 décimales), la largeur suit la
// hauteur en échelle uniforme, ses clés propres ; rend null pour celle par défaut
// sans clé (le plan n'en porte pas). Même règle que `_motion` du serveur.
export function cleanMotion(raw) {
  const m = { ...MOTION0 };
  const keys = {};
  if (raw && typeof raw === 'object') {
    for (const k of MKEYS) {
      const v = Number(raw[k]);
      const ok = typeof raw[k] === 'number' || (typeof raw[k] === 'string' && raw[k].trim() !== '');
      if (ok && Number.isFinite(v)) m[k] = Math.round(Math.max(MOTION_LIM[k][0], Math.min(MOTION_LIM[k][1], v)) * 1e6) / 1e6;
    }
    m.uniform = raw.uniform !== false;
    if (raw.keys && typeof raw.keys === 'object') for (const g of KGROUPS) { const l = cleanKeys(g.id, raw.keys[g.id]); if (l.length) keys[g.id] = l; }
  }
  if (m.uniform) m.scaleW = m.scale;
  if (Object.keys(keys).length) { m.keys = keys; return m; }
  return MKEYS.every((k) => Math.abs(m[k] - MOTION0[k]) < 1e-9) && m.uniform ? null : m;
}
// poser une trajectoire sur un plan (un objet neuf : jamais partagé entre deux plans)
export function setMotion(c, patch) {
  const m = cleanMotion({ ...motionOf(c), ...patch });
  if (m) c.motion = m; else delete c.motion;
  return c;
}
// Changer la trajectoire telle qu'elle se voit à l'image `f` : un groupe sans clé prend
// la valeur ; un groupe qui a des clés reçoit une clé à cette image (posée ou mise à jour,
// son lissage gardé) — seulement s'il change. Premiere : « changer une valeur ailleurs pose
// une image clé là » quand le chronomètre est actif.
export function setMotionAt(c, f, patch) {
  const now = motionAt(c, f);
  const base = { ...motionOf(c) };
  const keys = JSON.parse(JSON.stringify((c.motion && c.motion.keys) || {}));
  const k = f - c.start;
  for (const g of KGROUPS) {
    const touche = g.fields.filter((fl) => fl in patch && Math.abs(Number(patch[fl]) - now[fl]) > 1e-9);
    if (!touche.length) continue;
    if (keys[g.id] && keys[g.id].length) {
      const vals = g.fields.map((fl) => (fl in patch ? Number(patch[fl]) : now[fl]));
      const old = keys[g.id].find((e) => e[0] === k);
      keys[g.id] = keys[g.id].filter((e) => e[0] !== k).concat([old && old[2] === 1 ? [k, vals, 1] : [k, vals]]);
    } else for (const fl of g.fields) if (fl in patch) base[fl] = patch[fl];
  }
  if ('uniform' in patch) base.uniform = patch.uniform;
  const m = cleanMotion({ ...base, keys });
  if (m) c.motion = m; else delete c.motion;
  return c;
}
// Le chronomètre d'un groupe : l'allumer pose une clé à l'image `f` avec la valeur qui s'y
// voit ; l'éteindre retire ses clés, la valeur qui se voit à `f` devient sa valeur fixe.
export function setStopwatch(c, gid, f, on) {
  const g = KGROUP[gid], now = motionAt(c, f);
  const keys = JSON.parse(JSON.stringify((c.motion && c.motion.keys) || {}));
  const base = { ...motionOf(c) };
  if (on) keys[gid] = [[f - c.start, g.fields.map((fl) => now[fl])]];
  else { delete keys[gid]; for (const fl of g.fields) base[fl] = now[fl]; }
  const m = cleanMotion({ ...base, keys });
  if (m) c.motion = m; else delete c.motion;
  return c;
}
// Poser (avec la valeur qui se voit) ou retirer la clé d'un groupe à l'image `f` ; le
// dernier retiré, la valeur reste (fixe). Rend vrai si une clé est posée.
export function toggleKey(c, gid, f) {
  const list = groupKeys(c, gid);
  const k = f - c.start;
  if (!list) { setStopwatch(c, gid, f, true); return true; }
  if (list.some((e) => e[0] === k)) {
    if (list.length === 1) { setStopwatch(c, gid, f, false); return false; }
    c.motion = cleanMotion({ ...c.motion, keys: { ...c.motion.keys, [gid]: list.filter((e) => e[0] !== k) } });
    return false;
  }
  const now = motionAt(c, f);
  c.motion = cleanMotion({ ...c.motion, keys: { ...c.motion.keys, [gid]: [...list, [k, KGROUP[gid].fields.map((fl) => now[fl])]] } });
  return true;
}
// le lissage du segment qui part de la clé `k` d'un groupe (vrai : lissé)
export function setEase(c, gid, k, smooth) {
  const list = groupKeys(c, gid);
  if (!list) return;
  c.motion = cleanMotion({ ...c.motion, keys: { ...c.motion.keys, [gid]: list.map((e) => (e[0] === k ? (smooth ? [e[0], e[1], 1] : [e[0], e[1]]) : e)) } });
}
// les images (de la timeline) où un plan a des clés : d'un groupe, ou de tous
export function keyFrames(c, gid = null) {
  const keys = (c && c.motion && c.motion.keys) || {};
  const s = new Set();
  for (const g of KGROUPS) if ((!gid || g.id === gid) && keys[g.id]) for (const e of keys[g.id]) s.add(c.start + e[0]);
  return [...s].sort((a, b) => a - b);
}
// Les gestes qui bougent la tête d'un plan sans bouger sa matière : ses clés reculent de
// `d` images (elles gardent leur place dans la timeline) ; un objet neuf.
export function shiftKeys(motion, d) {
  if (!motion || !motion.keys || !d) return motion;
  const keys = {};
  for (const [gid, list] of Object.entries(motion.keys)) keys[gid] = list.map((e) => [e[0] - d, e[1].slice(), ...e.slice(2)]);
  return { ...motion, keys };
}
// …ou s'étirent avec elle (la vitesse change : `r` = nouvelle durée de la matière / ancienne)
export function scaleKeys(motion, r) {
  if (!motion || !motion.keys || Math.abs(r - 1) < 1e-12) return motion;
  return cleanMotion({ ...motion, keys: Object.fromEntries(Object.entries(motion.keys).map(([gid, list]) => [gid, list.map((e) => [Math.round(e[0] * r), e[1].slice(), ...e.slice(2)])])) });
}

// Où se pose l'image d'un plan de `sw` × `sh` pixels dans un cadre de W × H :
//   k0      l'échelle qui la fait tenir dans le cadre (l'échelle 100 %) ;
//   kx, ky  pixels du cadre par pixel de la source ;
//   x0..x1, y0..y1  la part gardée de la source (le recadrage), en ses pixels ;
//   cx, cy  le centre de cette part, en pixels du cadre ; dw, dh sa taille, avant
//           la rotation `th` (radians) autour de ce centre — c'est la rotation
//           autour du point d'ancrage, dont la place est (x·W, y·H).
export function cadre(m, W, H, sw, sh) {
  const k0 = Math.min(W / sw, H / sh);
  const kx = k0 * (m.uniform === false ? m.scaleW : m.scale), ky = k0 * m.scale;
  const x0 = m.cl * sw, x1 = (1 - m.cr) * sw, y0 = m.ct * sh, y1 = (1 - m.cb) * sh;
  const th = m.rot * Math.PI / 180, co = Math.cos(th), si = Math.sin(th);
  const ux = (x0 + x1) / 2 - m.ax * sw, uy = (y0 + y1) / 2 - m.ay * sh;
  const cx = m.x * W + co * kx * ux - si * ky * uy;
  const cy = m.y * H + si * kx * ux + co * ky * uy;
  const dw = (x1 - x0) * kx, dh = (y1 - y0) * ky;
  return { k0, kx, ky, x0, x1, y0, y1, th, co, si, cx, cy, dw, dh, op: m.op, vis: dw > 0 && dh > 0 && m.op > 0 };
}
// les quatre coins de l'image posée (haut gauche, haut droit, bas droit, bas gauche), en pixels du cadre
export function coins(g) {
  const hx = g.dw / 2, hy = g.dh / 2;
  return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([u, v]) => [g.cx + g.co * u - g.si * v, g.cy + g.si * u + g.co * v]);
}
// un point du cadre → le pixel de la source qui s'y pose
export function versSource(g, X, Y) {
  const dx = X - g.cx, dy = Y - g.cy;
  const u = g.co * dx + g.si * dy, v = -g.si * dx + g.co * dy;
  return [(g.x0 + g.x1) / 2 + u / g.kx, (g.y0 + g.y1) / 2 + v / g.ky];
}
// …et l'inverse : un pixel de la source → sa place dans le cadre
export function versCadre(g, sx, sy) {
  const u = (sx - (g.x0 + g.x1) / 2) * g.kx, v = (sy - (g.y0 + g.y1) / 2) * g.ky;
  return [g.cx + g.co * u - g.si * v, g.cy + g.si * u + g.co * v];
}
// le point d'ancrage, en pixels du cadre
export const ancrage = (m, W, H) => [m.x * W, m.y * H];

// Les grilles en un clic : des cases en fraction du cadre [x, y, largeur, hauteur].
// L'image dans l'image : un tiers du cadre (0,3), dans la zone d'action (les 90 %
// des zones de sécurité de Premiere : 5 % de marge, celles du moniteur).
export const GRILLES = [
  { id: 'plein', label: 'plein cadre', cells: [[0, 0, 1, 1]] },
  { id: '2h', label: 'deux côte à côte', cells: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
  { id: '2v', label: 'deux l’un au-dessus de l’autre', cells: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] },
  { id: '2x2', label: 'grille 2 × 2', cells: [0, 1].flatMap((j) => [0, 1].map((i) => [i / 2, j / 2, 0.5, 0.5])) },
  { id: '3x3', label: 'grille 3 × 3', cells: [0, 1, 2].flatMap((j) => [0, 1, 2].map((i) => [i / 3, j / 3, 1 / 3, 1 / 3])) },
  { id: 'pip', label: 'image dans l’image', cells: [[0.05, 0.05, 0.3, 0.3], [0.65, 0.05, 0.3, 0.3], [0.05, 0.65, 0.3, 0.3], [0.65, 0.65, 0.3, 0.3]] },
];
// La trajectoire qui pose l'image dans une case : elle y tient (proportions
// gardées), centrée ; l'ancrage revient au centre, la rotation à 0 ; l'opacité et
// le recadrage restent (la part gardée est ce qui tient et se centre).
export function dansCase(m0, cell, W, H, sw, sh) {
  const [fx, fy, fw, fh] = cell;
  const m = { ...m0, rot: 0, ax: 0.5, ay: 0.5, uniform: true };
  const k0 = Math.min(W / sw, H / sh);
  const cw = (1 - m.cl - m.cr) * sw, ch = (1 - m.ct - m.cb) * sh;
  if (!(cw > 0 && ch > 0)) return m;
  m.scale = m.scaleW = Math.min(fw * W / (cw * k0), fh * H / (ch * k0));
  const k = k0 * m.scale;
  m.x = fx + fw / 2 - ((m.cl + 1 - m.cr) / 2 - 0.5) * sw * k / W;
  m.y = fy + fh / 2 - ((m.ct + 1 - m.cb) / 2 - 0.5) * sh * k / H;
  return m;
}

// La courbe d'un fondu de son, comme `afade` (ffmpeg 6.1.1,
// libavfilter/af_afade.c, fade_gain) : x de 0 à 1 le long du fondu. L'image
// fond toujours en ligne droite : le filtre `fade` de ffmpeg 6.1 n'a pas de
// courbe (ffmpeg -h filter=fade).
export const CURVES = [['tri', 'linéaire'], ['qsin', 'quart de sinus'], ['hsin', 'demi-sinus'], ['esin', 'sinus exponentiel'], ['log', 'logarithmique'],
  ['exp', 'exponentielle'], ['par', 'parabole'], ['ipar', 'parabole inversée'], ['qua', 'carré'], ['squ', 'racine carrée']];
export function curveGain(curve, x) {
  const g = Math.max(0, Math.min(1, x));
  switch (curve) {
    case 'qsin': return Math.sin(g * Math.PI / 2);
    case 'hsin': return (1 - Math.cos(g * Math.PI)) / 2;
    case 'esin': return 1 - Math.cos(Math.PI / 4 * (Math.pow(2 * g - 1, 3) + 1));
    case 'log': return Math.max(0, Math.min(1, 1 + 0.2 * Math.log10(g)));
    case 'exp': return Math.exp(-11.512925464970227 * (1 - g));
    case 'par': return 1 - Math.sqrt(1 - g);
    case 'ipar': return 1 - (1 - g) * (1 - g);
    case 'qua': return g * g;
    case 'squ': return Math.sqrt(g);
    default: return g;
  }
}

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
    const fc = c.fcurve || {};
    out.set(c.id, { clip: c, ws: c.start, we: clipEnd(c), fin: c.fade_in || 0, fout: c.fade_out || 0, xin: 0, xout: 0, cin: fc.in || 'tri', cout: fc.out || 'tri' });
    if (!isOn(c) || c.kind === 'adjust') continue;
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

// Le gain d'un son (hors volume du plan), comme `afade` : le fondu enchaîné
// en ligne droite, les fondus d'entrée et de sortie selon leur courbe
// (curveGain ; afade multiplie ses rampes l'une après l'autre).
export function gainAt(w, t, fps) {
  const x = t * fps - w.ws, nf = w.we - w.ws;
  let g = 1;
  if (w.xin) g *= Math.max(0, Math.min(1, x / w.xin));
  if (w.fin) g *= curveGain(w.cin, x / w.fin);
  if (w.xout) g *= Math.max(0, Math.min(1, (nf - x) / w.xout));
  if (w.fout) g *= curveGain(w.cout, (nf - x) / w.fout);
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
    in: still(c) ? 0 : (c.in || 0) + cutFrames / fps * spd(c), xfade: 0, fade_in: Math.min(c.fade_in || 0, c.dur - cutFrames),
    ...(c.motion ? { motion: shiftKeys(c.motion, cutFrames) } : {}) };   // les clés gardent leur place dans la timeline
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
    const c = normClip(clone(c0));
    c.id = newClipId();
    if (!trackOf(p, c.track) || !accepts(c.track, c.kind)) c.track = c.kind === 'adjust' ? (p.tracks.find((t) => t.kind === 'fx') || {}).id : target[c.kind === 'audio' ? 'audio' : 'video'];
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
function headRoom(c, fps) { return still(c) ? Infinity : Math.floor((c.in || 0) * fps / spd(c) + 1e-6); }
function tailRoom(c, fps) {
  if (still(c) || !(c.src_dur > 0)) return Infinity;
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
    if (!still(c)) c.in = Math.max(0, (c.in || 0) + d / fps * spd(c));
    if (c.motion) c.motion = shiftKeys(c.motion, d);    // les clés, comme les images, gardent leur place
  } else c.dur += d;
  fitFades(c);
}

// les fondus tiennent dans le plan : entrée + sortie ≤ durée (la sortie cède d'abord)
export function fitFades(c) {
  c.fade_in = Math.max(0, Math.min(c.fade_in || 0, c.dur));
  c.fade_out = Math.max(0, Math.min(c.fade_out || 0, c.dur - c.fade_in));
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
    if (!still(c)) c.in = Math.max(0, (c.in || 0) + d / fps * spd(c));
    if (c.motion) c.motion = shiftKeys(c.motion, d);    // la matière avance de d sous la tête : ses clés aussi
  } else c.dur += d;
  fitFades(c);
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
  if (!still(b)) b.in = Math.max(0, (b.in || 0) + d / fps * spd(b));
  if (b.motion) b.motion = shiftKeys(b.motion, d);
  for (const x of [a, b]) fitFades(x);
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
  if (still(c)) return [0, 0];
  return [-tailRoom(c, fps), headRoom(c, fps)];
}
export function slip(p, id, d) {
  const c = byId(p, id);
  if (!c || still(c) || !d) return;
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
  if (n.prevTouch) { const a = byId(p, n.prevTouch.id); a.dur += d; fitFades(a); }
  if (n.nextTouch) {
    const b = byId(p, n.nextTouch.id);
    b.start += d; b.dur -= d;
    if (!still(b)) b.in = Math.max(0, (b.in || 0) + d / fps * spd(b));
    if (b.motion) b.motion = shiftKeys(b.motion, d);
    fitFades(b);
  }
  c.start += d;
}

// Modification de la vitesse (Premiere « Rate Stretch », R) : tirer un
// bord change la durée ; la matière (de l'entrée à la sortie) reste la
// même, c'est la vitesse qui suit. Une image fixe se rogne simplement.
export function stretchLimits(p, c, side) {
  const { prevEnd, next } = neighbours(p, c);
  const srcFrames = c.dur * spd(c);                    // la matière, en images de timeline à vitesse 1
  const img = still(c);
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
  if (!still(c)) c.speed = Math.max(SPEED_MIN, Math.min(SPEED_MAX, spd(c) * c.dur / nd));
  // les clés s'étirent avec la matière ; une image fixe se rogne simplement : elles gardent leur place
  if (c.motion) c.motion = still(c) ? (side === 'l' ? shiftKeys(c.motion, d) : c.motion) : scaleKeys(c.motion, nd / c.dur);
  if (side === 'l') c.start += d;
  c.dur = nd;
  fitFades(c);
}

// Vitesse/Durée (Premiere, Ctrl+R) : la matière reste, la durée suit la
// vitesse. Avec propagation, la suite de la piste se décale ; sans, la
// durée s'arrête au plan suivant (rend la durée obtenue).
export function setSpeed(p, id, speed, ripple = false) {
  const c = byId(p, id);
  if (!c || still(c)) return 0;
  speed = Math.max(SPEED_MIN, Math.min(SPEED_MAX, speed));
  const end0 = clipEnd(c);
  let nd = Math.max(1, Math.round(c.dur * spd(c) / speed));
  const { next } = neighbours(p, c);
  if (!ripple && next) nd = Math.min(nd, next.start - c.start);
  if (c.motion) c.motion = scaleKeys(c.motion, spd(c) / speed);   // les clés suivent la matière
  c.speed = speed;
  c.dur = nd;
  fitFades(c);
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
// Les pistes de l'image (vidéo et calques, dans l'ordre de l'écran, la plus
// haute en premier) puis le son. V et X se comptent du bas, A du haut.
export function renumber(p) {
  const img = p.tracks.filter((t) => t.kind !== 'audio'), auds = p.tracks.filter((t) => t.kind === 'audio');
  const map = {};
  for (const [kind, pre] of [['video', 'V'], ['fx', 'X']]) {
    const list = img.filter((t) => t.kind === kind);
    list.forEach((t, i) => { map[t.id] = pre + (list.length - i); });
  }
  auds.forEach((t, i) => { map[t.id] = 'A' + (i + 1); });
  // deux passes : un nom neuf peut être l'ancien nom d'une autre piste
  p.tracks = [...img, ...auds].map((t) => ({ ...t, id: map[t.id] }));
  for (const c of p.clips) c.track = map[c.track];
  rangerGroupes(p);
  return map;
}

const blankTrack = (id, kind, name = '') => ({ id, kind, mute: false, solo: false, lock: false, hide: false, name, fx: [] });

// Ajouter une piste de cette sorte au-dessus ou au-dessous de `ref` (à
// l'écran) ; rend { map, id } : la table des anciens noms et le nom de la
// nouvelle.
export function addTrack(p, kind, ref, where = 'above', name = '') {
  const n = p.tracks.filter((t) => t.kind === kind).length;
  if (n >= MAX_TRACKS) return null;
  const t = blankTrack('_new', kind, name);
  const fam = family(kind);
  let i = p.tracks.findIndex((x) => x.id === ref && family(x.kind) === fam);
  if (i < 0) {
    const first = p.tracks.findIndex((x) => family(x.kind) === fam);
    const last = p.tracks.length - 1 - [...p.tracks].reverse().findIndex((x) => family(x.kind) === fam);
    i = fam === 'image' ? (where === 'above' ? 0 : Math.max(0, last)) : (where === 'above' ? first : p.tracks.length - 1);
  }
  const g = p.tracks[i] && p.tracks[i].grp;
  p.tracks.splice(where === 'above' ? i : i + 1, 0, t);
  // entre deux membres d'un groupe, la piste neuve y entre
  const av = p.tracks[p.tracks.indexOf(t) - 1], ap = p.tracks[p.tracks.indexOf(t) + 1];
  if (g && av && ap && av.grp === g && ap.grp === g) t.grp = g;
  const map = renumber(p);
  return { map, id: map._new };
}

// Un calque d'effet : une piste de calques tout en haut de l'image, nommée
// « FX <effet> », qui porte un calque de `start` à `start + dur` avec cet effet.
export function addFxLayer(p, fx, start, dur, name) {
  const r = addTrack(p, 'fx', null, 'above', name);
  if (!r) return null;
  const c = { id: newClipId(), track: r.id, item: '', kind: 'adjust', title: name, start: Math.max(0, start), dur: Math.max(1, dur),
    in: 0, src_dur: 0, speed: 1, enabled: true, vol: 1, fade_in: 0, fade_out: 0, xfade: 0, audio: false, fx: [fx] };
  p.clips.push(c);
  return { ...r, clip: c.id };
}

export function deleteTrack(p, tid) {
  const t = trackOf(p, tid);
  if (!t || (t.kind !== 'fx' && p.tracks.filter((x) => x.kind === t.kind).length <= 1)) return null;
  p.clips = p.clips.filter((c) => c.track !== tid);
  p.tracks = p.tracks.filter((x) => x.id !== tid);
  const map = renumber(p);
  map[tid] = null;
  return map;
}

// ── les groupes de pistes ────────────────────────────────────
// Comme dans ODIO (musique/projet.js) : un groupe est une étiquette sur des
// pistes qui se suivent, d'une même famille (l'image, ou le son). Il porte
// son nom et ses effets (qui s'appliquent à chacun des plans de ses pistes).
// Ses membres restent contigus ; un groupe d'une seule piste se défait.
export function rangerGroupes(p) {
  p.groups = (p.groups || []).filter((g) => g && g.id);
  const ids = new Set(p.groups.map((g) => g.id));
  for (const t of p.tracks) if (t.grp && !ids.has(t.grp)) delete t.grp;
  // une famille par groupe : celle de son premier membre
  const fam = new Map();
  for (const t of p.tracks) if (t.grp) { if (!fam.has(t.grp)) fam.set(t.grp, family(t.kind)); else if (fam.get(t.grp) !== family(t.kind)) delete t.grp; }
  const out = [], place = new Set();
  for (const t of p.tracks) {
    if (place.has(t.id)) continue;
    if (!t.grp) { out.push(t); place.add(t.id); continue; }
    for (const m of p.tracks) if (m.grp === t.grp && !place.has(m.id)) { out.push(m); place.add(m.id); }
  }
  p.tracks.splice(0, p.tracks.length, ...out);
  const count = new Map();
  for (const t of p.tracks) if (t.grp) count.set(t.grp, (count.get(t.grp) || 0) + 1);
  for (const t of p.tracks) if (t.grp && count.get(t.grp) < 2) delete t.grp;
  p.groups = p.groups.filter((g) => (count.get(g.id) || 0) >= 2);
}

// Déplacer des pistes avant ou après une autre, dans leur famille. Le groupe
// suit la place : entre deux membres d'un groupe, on y entre ; au bord de son
// propre groupe, on y reste ; ailleurs, on en sort. Un groupe entier qu'on
// déplace (par son en-tête) reste un groupe. Rend la table des noms, ou null.
export function moveTracks(p, ids, cible, cote) {
  if (ids.includes(cible)) return null;
  const tc = trackOf(p, cible);
  const bouge = p.tracks.filter((t) => ids.includes(t.id));
  if (!tc || !bouge.length || bouge.some((t) => family(t.kind) !== family(tc.kind))) return null;
  const reste = p.tracks.filter((t) => !ids.includes(t.id));
  const i = reste.indexOf(reste.find((t) => t.id === cible)) + (cote === 'apres' ? 1 : 0);
  const av = reste[i - 1], ap = reste[i];
  const siens = new Set(bouge.map((t) => t.grp || ''));
  const g0 = siens.size === 1 ? [...siens][0] : '';
  let g = null;
  if (g0 && p.tracks.filter((t) => t.grp === g0).every((t) => ids.includes(t.id))) g = g0;
  else if (av && ap && av.grp && av.grp === ap.grp) g = av.grp;
  else if (g0 && ((av && av.grp === g0) || (ap && ap.grp === g0))) g = g0;
  const sig = (list) => list.map((t) => t.id + ':' + (t.grp || '')).join(',');
  const before = sig(p.tracks);
  for (const t of bouge) { if (g) t.grp = g; else delete t.grp; }
  reste.splice(i, 0, ...bouge);
  if (sig(reste) === before) return null;
  p.tracks = reste;
  return renumber(p);
}

// Lâcher des pistes sur une autre : la cible garde son groupe s'il existe,
// sinon un groupe neuf naît autour d'elles. Rend { g, map } ou null.
export function groupTracks(p, ids, cible) {
  const tc = trackOf(p, cible);
  if (!tc || ids.includes(cible)) return null;
  const bouge = p.tracks.filter((t) => ids.includes(t.id) && family(t.kind) === family(tc.kind));
  if (!bouge.length) return null;
  p.groups = p.groups || [];
  let g = tc.grp && groupOf(p, tc.grp);
  if (!g) {
    let n = p.groups.length + 1;
    while (p.groups.some((x) => x.name === `Groupe ${n}`)) n++;
    g = { id: newId('g'), name: `Groupe ${n}`, fx: [] };
    p.groups.push(g);
    tc.grp = g.id;
  }
  const reste = p.tracks.filter((t) => !bouge.includes(t));
  const membres = reste.filter((t) => t.grp === g.id);
  const i = reste.indexOf(membres[membres.length - 1]) + 1;
  for (const t of bouge) t.grp = g.id;
  reste.splice(i, 0, ...bouge);
  p.tracks = reste;
  return { g, map: renumber(p) };
}
export function ungroup(p, gid) {
  for (const t of p.tracks) if (t.grp === gid) delete t.grp;
  p.groups = (p.groups || []).filter((g) => g.id !== gid);
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
    // une clé reste à sa place dans la timeline, arrondie à la nouvelle grille comme les bords
    if (c.motion && c.motion.keys) {
      c.motion = cleanMotion({ ...c.motion, keys: Object.fromEntries(Object.entries(c.motion.keys).map(([gid, list]) =>
        [gid, list.map((k) => [Math.round((c.start + k[0]) * r) - s, k[1].slice(), ...k.slice(2)])])) });
    }
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
