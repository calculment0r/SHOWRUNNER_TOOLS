// IDÉATION · PRÉSENTATION — les modèles (docs/etudes/presentations.md § 10).
//
// Un modèle est un fichier JSON de modeles/ (des données : lu aussi par le serveur, qui le
// contrôle contre schema.json) :
//   palette   les couleurs du modèle (du contenu, pas des jetons du thème) : --t-* sur la scène
//   styles    les six styles de texte (police OFL, graisse, taille, interligne, approche, capitales),
//             écrits dans `pres.styles` de la planche quand on l'applique : la planche montre
//             les mêmes polices que la présentation
//   slideBg   le fond de chaque rôle de diapositive (titre, section, image, citation…)
//   decor     ce que le modèle pose de lui-même (bandes de cinéma, filets, folio, grain, halo…)
//   motion    le rythme (ms entre deux objets dans l'ordre de lecture), les transitions par
//             rôle de diapositive, l'entrée de chaque sorte d'objet (titre, corps, image…)
//   example   une vraie présentation d'exemple (des diapositives et leurs objets, en px de scène)
// Appliquer un modèle : `pres.template` et `pres.styles` sur la planche (un geste : Ctrl+Z).

import { ensureFont, cssFamily } from '../diapo/polices.js';
import { normMotion } from './moteur.js';

const BASE = new URL('./modeles/', import.meta.url).href;
let cache = null;
// les proposées se chargent au besoin (diapo/polices.js : Google Fonts, l'hôte que la page appelle déjà)
export async function loadModeles() {
  if (cache) return cache;
  cache = (async () => {
    const idx = await fetch(BASE + 'index.json').then((r) => r.json());
    const all = await Promise.all(idx.modeles.map((id) => fetch(`${BASE}${id}.json`).then((r) => r.json())));
    return all;
  })();
  return cache;
}
export async function modele(id) {
  if (!id) return null;
  return (await loadModeles()).find((m) => m.id === id) || null;
}

// ── les styles : ceux de la planche, ou ceux d'un modèle qu'on essaie ─
export function styler(meta, board, tpl = null, preview = false) {
  const fontOf = (id) => meta?.fonts?.find((f) => f.id === id) || null;
  const fake = { S: { meta: { deck: meta } } };
  const memo = new Map();
  return (sid) => {
    if (memo.has(sid)) return memo.get(sid);
    const base = meta?.styles?.[sid];
    if (!base) return null;
    const over = preview && tpl ? tpl.styles?.[sid] : board?.pres?.styles?.[sid];
    const st = { ...base, ...(over || {}) };
    const f = fontOf(st.font) || fontOf(base.font);
    if (f?.src === 'google') ensureFont(fake, f.id, () => {});
    const out = { ...st, id: sid, css: cssFamily(f), fontObj: f };
    memo.set(sid, out);
    return out;
  };
}
// attendre les polices d'un style (avant de couper un texte en lignes, ou de le mesurer)
export async function fontsReady(style, ms = 2500) {
  const want = ['display', 'h1', 'h2', 'body', 'caption', 'label'].map(style).filter(Boolean);
  const loads = want.map((st) => document.fonts?.load?.(`${st.weight} ${Math.round(st.size)}px ${st.css}`).catch(() => null));
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, ms))]);
}

// ── le motion par défaut d'un modèle : par sorte d'objet, dans l'ordre de lecture ─
export function motionFor(tpl) {
  const M = tpl?.motion;
  if (!M?.parts) return () => null;
  return (n, part, order = 0) => {
    const base = M.parts[part] || (part === 'hero' ? M.parts.image : null);
    if (!base) return null;
    const mo = JSON.parse(JSON.stringify(base));
    if (mo.in) mo.in.delay = (mo.in.delay || 0) + (M.rhythm || 0) * order;
    return normMotion(mo);
  };
}
const LEGACY = { cut: 'cut', fade: 'fade', push: 'push', morph: 'morph', toile: 'fly', wipe: 'push', curtain: 'fade', zoom: 'fade' };
export const legacyTrans = (k) => LEGACY[k] || 'fade';
// la transition qui mène à une diapositive : la sienne, sinon celle de son rôle dans le modèle
export function transFor(tpl, f, role) {
  const own = f?.motion?.trans;
  const T = tpl?.motion?.trans || {};
  const def = T[role] || T.default || { kind: 'fade', dur: 700, ease: 'in-out' };
  const kind = own || (f?.deck?.trans && !tpl ? ({ fly: 'toile' }[f.deck.trans] || f.deck.trans) : def.kind) || 'fade';
  return { kind, dur: Number.isFinite(f?.motion?.tdur) ? f.motion.tdur : def.dur || 800, ease: f?.motion?.ease || def.ease || 'in-out' };
}

// ── appliquer (dans app.mutate : un pas d'annulation) ───────
export function applyTo(B, tpl) {
  const p = JSON.parse(JSON.stringify(B.pres || {}));
  if (!tpl) { delete p.template; delete p.styles; }
  else { p.template = tpl.id; p.styles = JSON.parse(JSON.stringify(tpl.styles)); }
  if (Object.keys(p).length) B.pres = p; else delete B.pres;
}
// le modèle d'une planche, s'il y en a un (et s'il existe encore)
export async function boardModele(board) { return board?.pres?.template ? modele(board.pres.template) : null; }
export const hasMotion = (board) => !!(board && (board.pres?.template || board.nodes.some((n) => n.motion)));

// ── l'exemple d'un modèle : ses diapositives posées sur la planche ─
// `origin` : le coin haut gauche de la première ; `uid(prefix)` : des identifiants neufs.
// Rend { frames, nodes, items } (items : les fiches de la bibliothèque qu'il cite).
export function exampleNodes(tpl, origin, uid, { gap = 240 } = {}) {
  const ex = tpl.example;
  const frames = [], nodes = [], items = new Set();
  const W = 1920, H = 1080;
  const mids = new Map();
  ex.slides.forEach((sl, k) => {
    const at = sl.at || [k, 0];
    const fx = Math.round(origin[0] + at[0] * (W + gap)), fy = Math.round(origin[1] + at[1] * (H + gap));
    const f = { id: uid('n'), type: 'frame', x: fx, y: fy, w: W, h: H, name: sl.name || `Diapositive ${k + 1}`, slide: k + 1,
      deck: { ratio: '16:9', trans: legacyTrans(sl.trans || 'fade') } };
    const fm = {};
    if (sl.trans) fm.trans = sl.trans;
    if (sl.bg) fm.bg = sl.bg;
    if (Number.isFinite(sl.tdur)) fm.tdur = sl.tdur;
    if (Number.isFinite(sl.auto)) fm.auto = sl.auto;
    if (Object.keys(fm).length) f.motion = fm;
    frames.push(f);
    for (const o of sl.objects || []) {
      const n = JSON.parse(JSON.stringify(o));
      delete n.mk;
      n.id = uid('n');
      n.x = Math.round(fx + (o.x || 0)); n.y = Math.round(fy + (o.y || 0));
      n.w = Math.round(o.w || 400); n.h = Math.round(o.h || 100);
      if (n.type === 'title' && !n.size) n.size = 'l';
      if (n.type === 'media') { items.add(n.item); n.title = n.title || ''; }
      // la même clé d'une diapositive à l'autre : le même objet (le morph)
      if (o.mk) { if (!mids.has(o.mk)) mids.set(o.mk, uid('m')); n.mid = mids.get(o.mk); }
      nodes.push(n);
    }
  });
  return { frames, nodes, items: [...items] };
}
