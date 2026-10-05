// ODIO — la bibliothèque du projet, et « Envoyer à la Session ».
// Cal (05/10 au soir) : « dans la vue arrangement, on doit pouvoir éditer un
// clip et en faire un truc qu'on envoie dans le mode Session. On devrait je
// pense avoir, comme pour la vidéo, une bibliothèque projet pour ODIO pour
// pouvoir trouver facilement tout ce qu'on fait dans cet environnement […] si
// je prends un clip et que je le découpe plusieurs fois différemment pour
// l'envoyer dans le mode Session, je vais avoir 4/5 clips édités et
// raccourcis, donc cela va être infernal d'avoir cela dans les assets
// généraux ». Le modèle : docs/etudes/odio_session.md § 6.
//
// La bibliothèque est DANS le projet (p.biblio, projet.js) — pas un chutier par
// Workspace comme celui du Montage : ses clips n'existent que dans ce projet,
// ils suivent son annulation et son enregistrement.
//   clips     les clips édités : un son est une RÉFÉRENCE (le même objet de la
//             bibliothèque, son départ, sa longueur, son gain, sa transposition)
//             — jamais un fichier neuf ; des notes, une COPIE (projet.js, refDeClip)
//   sons      ce que le projet a pris ou fabriqué (asset, import, prise, rendu,
//             génération) : un son posé y entre de lui-même et y reste
//             (projet.js, retenirSons) ; « Retirer du projet » quand plus rien
//             ne le pose
//   dossiers  un niveau, pour ranger les deux
// Le navigateur la montre en tête, rubrique « Projet » (navigateur.js) ; on en
// glisse un clip sur une piste de l'arrangement ou dans une case de la Session.
//
// Envoyer à la Session (clic droit sur un clip ou une plage de l'arrangement,
// ou un clip glissé sur l'onglet « Session ») est non destructif : l'arrangement
// ne bouge pas ; chaque morceau devient un clip du projet ET une case de la
// voie née de sa piste (une voie neuve qui joue comme elle, la première fois),
// à la première case libre.

import { api, toast } from '../commun/shell.js';
import { TRACK_KINDS, kindOfSource } from './modules.js';
import { refDeClip, refsDePlage, motifDeRef, champsDeRef, voieDePiste, voieNeuve, trajets, insererScene, slotAt } from './projet.js';

export const QUOI_FR = { asset: 'Asset', import: 'import', prise: 'prise', rendu: 'rendu', generation: 'génération' };

// La sorte de voie (ou de piste) qui joue un clip du projet, et si `o` (une voie, une piste) le prend
export const sorteDeRef = (ref) => (ref.kind === 'audio' ? 'audio' : ref.drums ? 'drums'
  : (ref.inst && ['synth', 'sampler'].includes(kindOfSource(ref.inst.type)) ? kindOfSource(ref.inst.type) : 'synth'));
export function accepte(o, ref) {
  if (!o || !ref) return false;
  if (ref.kind === 'audio') return o.kind === 'audio';
  const pk = TRACK_KINDS[o.kind]?.pattern;
  return ref.drums ? pk === 'drums' : pk === 'notes';
}
export const refDe = (p, id) => (p.biblio?.clips || []).find((x) => x.id === id) || null;
// la longueur d'un clip, en mesures (ou en temps sous la mesure)
export function mesures(p, len) {
  const b = len / p.sig;
  return Number.isInteger(b) ? `${b} mes.` : Number.isInteger(len) ? `${len} t.` : `${b.toFixed(2)} mes.`;
}

// ── la Session : une case d'un clip du projet ──
// La case est remplacée si elle est prise (Ctrl+Z la rend). Des notes : un motif
// copié pour la voie (projet.js, motifDeRef). Rend le clip de Session.
export function slotDeRef(app, ref, v, sid) {
  const p = app.S.proj, old = slotAt(p, v.id, sid);
  if (old) p.slots = p.slots.filter((x) => x !== old);
  const s = { id: app.uid('cl'), voie: v.id, scene: sid, ...champsDeRef(ref) };
  if (ref.kind === 'midi') {
    const pat = motifDeRef(ref, v.id, app.uid);
    p.patterns.push(pat);
    s.pat = pat.id;
    v.pat = pat.id;
  }
  p.slots.push(s);
  return s;
}
// une voie neuve qui joue un clip du projet : le lecteur pour un son ; pour des notes, l'instrument d'où elles viennent
export function voiePourRef(app, ref) {
  const k = sorteDeRef(ref), inst = ref.kind === 'midi' && ref.inst && kindOfSource(ref.inst.type) === k ? ref.inst : null;
  return voieNeuve(app.S.proj, k, { type: inst?.type, params: inst ? JSON.parse(JSON.stringify(inst.params || {})) : {}, name: ref.name }, app.uid);
}
// la première case libre d'une voie, à partir de la scène `from` (une scène neuve, à la fin, s'il n'y en a pas)
export function caseLibre(p, vid, from = null, uid) {
  const i0 = Math.max(0, p.scenes.findIndex((x) => x.id === from));
  for (let i = i0; i < p.scenes.length; i++) if (!slotAt(p, vid, p.scenes[i].id)) return p.scenes[i].id;
  return insererScene(p, p.scenes.length, uid).id;
}

// ── l'arrangement : un clip d'un clip du projet ──
// Sur la piste `tid` si elle le prend, sinon une piste neuve (le lecteur, ou
// l'instrument d'origine des notes). Rend le clip.
export function clipDeRef(app, ref, tid, at) {
  const p = app.S.proj;
  let t = tid && app.track(tid);
  if (!accepte(t, ref)) {
    const k = sorteDeRef(ref), inst = ref.kind === 'midi' && ref.inst && kindOfSource(ref.inst.type) === k ? ref.inst : null;
    t = app.addTrack(k, { type: inst?.type, params: inst ? JSON.parse(JSON.stringify(inst.params || {})) : undefined, name: ref.name });
  }
  const c = { id: app.uid('c'), track: t.id, start: Math.max(0, at), ...champsDeRef(ref) };
  if (ref.kind === 'midi') {
    const pat = motifDeRef(ref, t.id, app.uid);
    p.patterns.push(pat);
    c.pat = pat.id;
  }
  p.clips.push(c);
  app.selectClips([c.id], true);
  app.label(`poser « ${ref.name || 'clip du projet'} » dans l'arrangement`);
  app.commit('graph');
  return c;
}

// ── Envoyer à la Session ──
// `lots` : [{ track, refs }], les clips du projet tirés de chaque piste. `voie` :
// une voie choisie ; `neuve` : une voie neuve qui joue comme la piste ; sinon la
// voie née de la piste (voieDePiste la première fois). Rend les clips de Session.
function envoyer(app, lots, { voie = null, neuve = false } = {}) {
  const p = app.S.proj, made = [];
  for (const { track, refs } of lots) {
    const t = app.track(track);
    if (!t || !refs.length) continue;
    let v = voie ? app.voie(voie) : null;
    if (v && !accepte(v, refs[0])) { toast(`« ${v.name} » ne prend pas ${refs[0].kind === 'audio' ? 'un son' : refs[0].drums ? 'des pas de batterie' : 'des notes'} : une voie de la même sorte`, 5000); continue; }
    if (!v && !neuve) v = p.voies.find((x) => x.piste === t.id && accepte(x, refs[0]));
    if (!v) v = voieDePiste(p, t, trajets(p).ordre.get(t.id), Math.max(0, ...p.modules.map((m) => m.y || 0)) + 260, app.uid);
    let sid = caseLibre(p, v.id, null, app.uid);
    for (const ref of refs) {
      p.biblio.clips.push(ref);
      made.push({ s: slotDeRef(app, ref, v, sid), v, ref });
      sid = caseLibre(p, v.id, sid, app.uid);
    }
  }
  return made;
}
// Des clips de l'arrangement (`clips`, des ids) ou une plage (`range` : { a, b,
// tracks }) vers la Session. Un geste, une annulation.
export function versSession(app, { clips = null, range = null, voie = null, neuve = false } = {}) {
  const p = app.S.proj, lots = new Map(), refus = [];
  const lot = (tid) => { if (!lots.has(tid)) lots.set(tid, { track: tid, refs: [] }); return lots.get(tid).refs; };
  if (range) {
    for (const tid of range.tracks) {
      const r = refsDePlage(p, tid, range.a, range.b, app.uid);
      if (typeof r === 'string') refus.push(`${app.track(tid)?.name || 'piste'} : ${r}`); else if (r.length) lot(tid).push(...r);
    }
  } else {
    for (const c of (clips || []).map(app.clip).filter(Boolean).sort((x, y) => x.start - y.start)) {
      const r = refDeClip(p, c, c.start, c.start + c.len, app.uid);
      if (typeof r === 'string') refus.push(`${app.track(c.track)?.name || 'piste'} : ${r}`); else lot(c.track).push(r);
    }
  }
  if (refus.length) toast(refus[0], 5000);
  if (!lots.size) { if (!refus.length) toast(range ? 'la plage est vide : rien à envoyer' : 'choisis un clip à envoyer'); return []; }
  const made = envoyer(app, [...lots.values()], { voie, neuve });
  if (!made.length) return [];
  const voies = [...new Set(made.map((x) => x.v.name))];
  app.S.sel.voie = made[0].v.id;
  app.S.sel.slot = made[0].s.id;
  app.label(made.length > 1 ? `envoyer ${made.length} clips à la Session` : `envoyer « ${made[0].ref.name || 'le clip'} » à la Session`);
  app.commit('graph');
  toast(`${made.length > 1 ? `${made.length} clips envoyés` : `« ${made[0].ref.name || 'clip'} » envoyé`} à la Session, dans « ${voies.join(' », « ')} » · l'arrangement n'a pas bougé · Tab : la Session`, 6000);
  return made;
}

// ── les sons du projet : leurs fiches (titre, durée, adresse), lues par lots ──
// Une fiche n'est demandée qu'une fois (DEMANDES) : un serveur qui ne répond pas
// ne fait pas tourner la page en rond. Rend vrai si des fiches sont arrivées.
const FICHES = new Map();   // id → l'objet public, ou null (absent, à la corbeille, d'un autre Workspace)
const DEMANDES = new Set();
export async function fiches(ids) {
  const manque = [...new Set(ids)].filter((id) => !FICHES.has(id) && !DEMANDES.has(id));
  let neuves = false;
  for (const id of manque) DEMANDES.add(id);
  for (let i = 0; i < manque.length; i += 500) {
    const lot = manque.slice(i, i + 500);
    try {
      const r = await api('library/batch', { method: 'POST', body: { ids: lot } });
      for (const it of r.items || []) FICHES.set(it.id, it);
      for (const id of lot) if (!FICHES.has(id)) FICHES.set(id, null);
      neuves = true;
    } catch { /* restent « … » jusqu'au prochain chargement de la page */ }
  }
  return neuves;
}
export const fiche = (id) => FICHES.get(id);
