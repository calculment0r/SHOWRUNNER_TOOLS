// MUSIQUE — le projet : sa forme (version 2), la migration d'un projet
// d'avant, l'historique (annuler / rétablir) et les opérations
// d'arrangement qui touchent plusieurs choses à la fois (une section avec
// ses clips et ses courbes, le presse-papiers).
//
// Version 2, ce qui s'ajoute à la version 1 (docs/etudes/musique.md) :
//   key       { tonic 0..11, mode }             la tonalité de la session
//   sections  [{ id, name, a, b, color, tag }]  la règle des sections (en noires) ; `tag` est
//               aussi la balise des paroles d'une région qui la couvre (la structure, plus bas)
//   markers   [{ id, b, name }]                 les marqueurs
//   arc       { on, to: lpf|vol|both, pts }     l'arc d'énergie peint (0..1)
// Les arcs du projet (06/10, même version, champ facultatif ; arcs.js) :
//   arcs      [{ id, k, on, pts }]             les autres arcs du groupe, après
//               l'énergie (vol, filtre, reverb, delay ; largeur, satur, densite,
//               tension), un par sorte ; la Tension prend ses points dans banc.ten
//   ui.arcs   { ouvert, peint }                 le groupe déplié, l'arc que sa rangée peint
//   auto      [{ id, mod, k, on, pts }]         les voies d'automation (0..1)
//   tracks[]  + sub, arm ; sorte « bus » (retour d'effets)
//   cables[]  + send (dB) : un envoi de la console vers un bus
//   clips[]   + gain, fi, fo, loop, llen, mute, name
//   gen       le brouillon du panneau génératif (style, plan, paroles)
// Ajouts du 29/09 (même version, champs facultatifs) :
//   clips[]   + pitch (demi-tons, −48..48 : vitesse et hauteur ensemble),
//               rev (à l'envers), ls (début de la boucle, en secondes de son)
//   presets   [{ id, name, type, params, sub }]  les réglages enregistrés
//   banc      { segs, atts }                     le banc du nodal (banc.js)
// Le génératif (29/09, même version, champs facultatifs ; generatif_region.js) :
//   tracks[]  + gen { model, task }   une piste générative (une piste audio)
//   clips[]   + gen { model, task, v, ctx, takes: [{ item, seed, off, … }], take }
//               une région : sans prise, pas encore d'`item` ; une prise
//               choisie lui donne son `item` et son `off`
//   ui        + genSon (la vue de détail : le son de la prise plutôt que la génération)
// Le nodal et l'arrangement, deux vues du même graphe (29/09, même version) :
//   groups    [{ id, name, fold }]   les groupes de pistes de l'arrangement ;
//   tracks[]  + grp                  le groupe d'une piste (ses membres se suivent)
//   la chaîne d'une piste n'est écrite nulle part : c'est le trajet de sa source
//   à sa tranche dans les câbles (trajets, plus bas) ; un effet que deux pistes
//   traversent est dans les deux chaînes
// La vue Session (05/10, même version, champs facultatifs ; session.js,
// docs/etudes/odio_session.md) — le lanceur de clips de Live, refait le soir
// du 05/10 sur la parole de Cal : une couche « on top » de l'arrangement, qui
// a ses propres colonnes et joue EN PLUS de lui, sur la même horloge :
//   voies     [{ id, name, kind, color, src, strip, mute, solo, arm, sub, pat, piste }]
//               les colonnes de la Session, vierges dans un projet neuf : la
//               forme d'une piste (une source — l'instrument, ou le lecteur d'un
//               son —, une tranche, la chaîne lue dans les câbles, des envois vers
//               les bus de l'arrangement), jamais une piste de l'arrangement.
//               Leurs modules portent `voie` (et pas `track`) ; leurs motifs,
//               `track: <la voie>`. `piste` : la piste de l'arrangement dont la voie
//               est née (« Envoyer à la Session »), pour y renvoyer une scène
//   scenes    [{ id, name, bpm, color }]   les lignes de la grille, dans l'ordre ;
//               un nom vide montre le numéro ; `bpm` : le tempo que la scène pose
//   slots     [{ id, voie, scene, len, … }]  un clip de Session : une case
//               (une voie × une scène, une seule par case), qui boucle sur `len`
//               noires ; les champs d'un clip de l'arrangement (pat, off ; item,
//               off, gain, pitch, rev ; name, color), sans `start` ; + mode
//               (trigger, gate, toggle, repeat : Live, « Launch Modes »), q (sa
//               quantification ; absente : la globale), ref (le clip du projet
//               dont il vient, biblio.clips)
//   launch    { q }   la quantification globale du lancement (QUANTS, ci-dessous)
// La bibliothèque du projet (05/10 ; biblio.js, le navigateur — Cal : « une
// bibliothèque projet pour ODIO pour pouvoir trouver facilement tout ce qu'on
// fait dans cet environnement ») :
//   biblio    { dossiers [{ id, name }],
//               clips [{ id, name, kind: audio|midi, dossier, color, from, … }]
//                 les clips édités du projet, qui n'existent QUE dans le projet :
//                 un son est une RÉFÉRENCE (item, off, len, gain, pitch, rev, fi,
//                 fo, loop, ls, llen), jamais un fichier neuf ; des notes, une
//                 COPIE (drums, steps, notes | lanes ; inst : l'instrument d'où
//                 elles viennent, { type, params })
//               sons [{ item, quoi, kind, dossier }]
//                 ce que le projet a pris ou fabriqué : asset (la bibliothèque
//                 générale), import (le disque), prise, rendu, generation ; un son
//                 posé y entre de lui-même et y reste (retenirSons) }

import { guessTag, MODULES, TRACK_KINDS, COLORS } from './modules.js';
import { SECTION_TAGS } from './modules.js';   // la structure : les étiquettes des paroles (06/10)
import { ARP_PARAMS } from './modules.js';
// les machines du nodal sur leurs vrais moteurs (09/10) : la voix d'une machine et son branchement
import { moteurDe, TYPE_DE_VOIX, VOIX_DES_PANNEAUX, pousserTout } from './machines/tuiles.js';

export const VERSION = 2;
// le groupe des arcs d'un projet neuf, ou d'un projet d'avant (arcs.js en a les définitions)
export const ARCS_DEFAUT = ['vol', 'filtre', 'reverb', 'delay'];
const own = (c) => (c.gen ? { gen: JSON.parse(JSON.stringify(c.gen)) } : {});   // une copie de région a ses propres prises

export function migrate(p) {
  for (const k of ['pending', 'patterns', 'clips', 'cables', 'modules', 'tracks']) p[k] = p[k] || [];
  p.sections = p.sections || [];
  p.markers = p.markers || [];
  p.auto = p.auto || [];
  p.arc = p.arc || { on: true, to: 'lpf', pts: [] };
  // le groupe des arcs (06/10) : un projet d'avant garde son arc d'énergie (p.arc, tel quel) et reçoit le groupe par défaut, vide
  if (!Array.isArray(p.arcs)) p.arcs = ARCS_DEFAUT.map((k) => ({ id: `a${k}`, k, on: true, pts: [] }));
  p.key = p.key || { tonic: 9, mode: 'minor' };
  p.loop = p.loop || { on: false, a: 0, b: 16 };
  p.ui = p.ui || {};
  for (const s of p.sections) if (!s.tag) s.tag = guessTag(s.name);
  // la boucle d'un clip audio a son propre début (Live : « Loop Position »),
  // distinct du marqueur de début ; avant, c'était le même
  for (const c of p.clips) if (c.item && c.loop && c.ls === undefined) c.ls = c.off || 0;
  p.presets = p.presets || [];
  p.banc = p.banc || { segs: [], atts: [] };
  // les groupes de pistes (29/09) : un groupe se replie, se renomme, se défait
  p.groups = p.groups || [];
  rangerGroupes(p);
  // la vue Rack est devenue la vue de détail, en bas de l'arrangement
  if (p.ui.view === 'rack') { p.ui.view = 'timeline'; p.ui.detail = 'device'; }
  // la Session (05/10) : huit scènes vides, comme un set neuf de Live ; une
  // mesure de quantification (le défaut de Live) ; aucune voie : elle est vierge
  if (!Array.isArray(p.scenes)) p.scenes = Array.from({ length: 8 }, (_, i) => ({ id: `sc${i + 1}`, name: '' }));
  p.slots = Array.isArray(p.slots) ? p.slots : [];
  if (!p.launch || !QUANT_OF[p.launch.q]) p.launch = { q: '1' };
  // la refonte du soir (docs/etudes/odio_session.md § 6) : les voies, la
  // Session d'avant convertie, la bibliothèque du projet
  migrerSession(p);
  migrerMachines(p);
  p.v = VERSION;
  return p;
}

// Les machines du nodal sur leurs vrais moteurs (09/10, docs/etudes/odio_synthes.md
// § 7) : une machine posée avant porte encore l'ancien module (le FM-6 sur l'Analog,
// la MicroFreak sur le Numérique…). Son module prend la sorte que sa voix demande
// (machines/tuiles.js, TYPE_DE_VOIX), ses réglages repartent de la voix propre du
// panneau, puis chaque commande branchée redescend (pousserTout) : la machine sonne
// comme ses molettes le disent. L'arpège est gardé ; une voie d'automation d'un
// réglage que la nouvelle sorte n'a pas s'en va (elle ne tenait plus rien).
export function migrerMachines(p) {
  const arp = new Set(ARP_PARAMS.map((x) => x.k));
  for (const m of p.modules || []) {
    const voix = m.mach && moteurDe(m.mach.id)?.voice;
    const type = voix && TYPE_DE_VOIX[voix];
    if (!type || m.type === type || !MODULES[type] || MODULES[m.type]?.role !== MODULES[type].role) continue;
    const garde = Object.fromEntries(Object.entries(m.params || {}).filter(([k]) => arp.has(k)));
    m.type = type;
    m.params = { ...(VOIX_DES_PANNEAUX[m.mach.id] || {}), ...garde };
    pousserTout(m);
    const ks = new Set(MODULES[type].params.map((x) => x.k));
    p.auto = (p.auto || []).filter((L) => L.mod !== m.id || ks.has(L.k));
  }
  return p;
}

// La migration de la refonte : la Session d'avant convertie, la bibliothèque
// du projet posée, ce que le projet pose déjà retenu sans geste.
export function migrerSession(p) {
  p.voies = Array.isArray(p.voies) ? p.voies : [];
  if ((p.slots || []).some((s) => !s.voie)) convertirSlots(p);
  p.biblio = biblioDe(p.biblio);
  retenirSons(p);
  return p;
}

// ── la Session d'avant (05/10 au matin) → les voies ─────────
// Ses clips de Session étaient dans la colonne d'une piste de l'arrangement
// (`track`), et la piste qui en jouait un cessait de jouer l'arrangement.
// Chaque piste qui en avait devient UNE voie de Session : une copie de sa
// source (le même instrument, ses réglages), de ses effets dans l'ordre de sa
// chaîne et de sa tranche, avec les mêmes sorties (la sortie, un bus) et les
// mêmes envois ; ses motifs joués en Session sont copiés pour la voie. La
// piste reste dans l'arrangement, intacte. Un clip d'un bus, d'une piste
// disparue, n'avait pas de sens : il part.
const nid = (pfx) => pfx + Math.random().toString(36).slice(2, 9);
function convertirSlots(p) {
  const T = trajets(p), voies = new Map(), pats = new Map();
  const y0 = Math.max(0, ...p.modules.map((m) => m.y || 0)) + 260;
  const garde = [];
  for (const s of p.slots) {
    if (s.voie) { garde.push(s); continue; }
    const t = p.tracks.find((x) => x.id === s.track);
    if (!t || t.kind === 'bus') continue;
    let v = voies.get(t.id);
    if (!v) { v = voieDePiste(p, t, T.ordre.get(t.id), y0 + 260 * voies.size); voies.set(t.id, v); }
    const { track, ...n } = s;
    n.voie = v.id;
    if (s.pat) {
      const k = `${v.id}|${s.pat}`;
      if (!pats.has(k)) {
        const src = p.patterns.find((x) => x.id === s.pat);
        if (!src) continue;
        const cp = { ...JSON.parse(JSON.stringify(src)), id: nid('p'), track: v.id };
        p.patterns.push(cp);
        pats.set(k, cp.id);
        v.pat = v.pat || cp.id;
      }
      n.pat = pats.get(k);
    }
    garde.push(n);
  }
  p.slots = garde;
}

// Une voie de Session qui joue comme la piste `t` : une copie de sa chaîne
// (`seq`, les ids de la source à la tranche ; à défaut, la source et la
// tranche seules), de ses sorties et de ses envois. Les jouets d'une chaîne ne
// se copient pas (leur état vit ailleurs que dans leur module) : la chaîne se
// referme sans eux. Rend la voie, déjà dans p.voies.
export function voieDePiste(p, t, seq, y, uid = nid) {
  const v = { id: uid('v'), name: t.name, kind: t.kind, color: t.color, mute: false, solo: false, src: '', strip: '', piste: t.id };
  if (t.sub) v.sub = t.sub;
  copierChaine(p, t, seq, v, 'voie', y, uid);
  p.voies.push(v);
  return v;
}
// Le chemin inverse (« Vers l'arrangement » d'une scène) : une piste neuve qui
// joue comme la voie `v`, juste avant les bus ; la voie la retient (`piste`),
// les scènes suivantes y vont aussi. Rend la piste.
export function pisteDeVoie(p, v, seq, y, uid = nid) {
  const t = { id: uid('t'), name: v.name, kind: v.kind, color: v.color, mute: false, solo: false, src: '', strip: '' };
  if (v.sub) t.sub = v.sub;
  copierChaine(p, v, seq, t, 'track', y, uid);
  const bus = p.tracks.findIndex((x) => x.kind === 'bus');
  p.tracks.splice(bus < 0 ? p.tracks.length : bus, 0, t);
  v.piste = t.id;
  return t;
}
// La chaîne de `o` (une piste ou une voie : `seq`, les ids de la source à la
// tranche ; à défaut la source et la tranche seules) recopiée pour `dest`, dont
// les modules portent `cle` (track ou voie) ; ses sorties et ses envois aussi.
function copierChaine(p, o, seq, dest, cle, y, uid) {
  const mods = (seq?.length ? seq : [o.src, o.strip]).map((id) => p.modules.find((m) => m.id === id))
    .filter((m) => m && !MODULES[m.type]?.jouet);
  if (mods[0]?.id !== o.src || mods[mods.length - 1]?.id !== o.strip) {
    const src = p.modules.find((m) => m.id === o.src), st = p.modules.find((m) => m.id === o.strip);
    mods.splice(0, mods.length, ...[src, st].filter(Boolean));
  }
  const copies = mods.map((m, i) => {
    const n = { ...JSON.parse(JSON.stringify(m)), id: uid('m'), x: 40 + 340 * i, y };
    delete n.track; delete n.voie;
    n[cle] = dest.id;
    p.modules.push(n);
    return n;
  });
  dest.src = copies[0].id; dest.strip = copies[copies.length - 1].id;
  for (let i = 1; i < copies.length; i++) p.cables.push({ a: copies[i - 1].id, b: copies[i].id });
  // ce qui sort de la tranche : la sortie, un bus (son), et les envois (un niveau)
  for (const c of p.cables.filter((x) => x.a === o.strip && !x.t)) p.cables.push({ ...c, a: dest.strip });
}

// Une voie neuve, vierge (« + Voie ») : une source (l'instrument, ou le lecteur
// d'un son), sa tranche, la sortie ; comme une piste neuve (musique.js,
// addTrack), mais dans p.voies. Rend la voie.
export function voieNeuve(p, kind, { type, params, name, color, sub } = {}, uid = nid) {
  const src = type || TRACK_KINDS[kind].src;
  p.voies = p.voies || [];
  const n = p.voies.filter((v) => v.kind === kind).length + 1;
  const y = Math.max(0, ...p.modules.map((m) => m.y || 0)) + 260;
  const v = {
    id: uid('v'), name: (name || `${kind === 'audio' ? 'Audio' : MODULES[src].name} ${n}`).slice(0, 60), kind,
    color: color || (kind === 'audio' ? 'grn2' : MODULES[src].color || COLORS[p.voies.length % COLORS.length]),
    mute: false, solo: false, src: uid('m'), strip: uid('m'),
  };
  if (sub) v.sub = sub.slice(0, 60);
  const mst = p.modules.find((m) => m.type === 'master');
  p.modules.push({ id: v.src, type: src, voie: v.id, x: 40, y, on: true, params: { ...(params || {}) } },
    { id: v.strip, type: 'strip', voie: v.id, x: 380, y, on: true, params: {} });
  p.cables.push({ a: v.src, b: v.strip }, ...(mst ? [{ a: v.strip, b: mst.id }] : []));
  p.voies.push(v);
  return v;
}
// Retirer des voies : leurs modules (un effet qu'une piste traverse aussi lui
// reste), leurs motifs, leurs clips de Session.
export function retirerVoies(p, ids) {
  const gone = new Set(ids), T = trajets(p);
  const mods = new Set(p.modules.filter((m) => gone.has(m.voie) && !(T.de.get(m.id) || []).some((x) => !gone.has(x))).map((m) => m.id));
  p.modules = p.modules.filter((m) => !mods.has(m.id)).map((m) => {
    if (!gone.has(m.voie)) return m;
    const { voie, ...n } = m;   // une copie : sansSession ne touche pas au projet
    n.track = (T.de.get(m.id) || []).find((x) => p.tracks.some((t) => t.id === x)) || null;
    return n;
  });
  p.cables = p.cables.filter((c) => !mods.has(c.a) && !mods.has(c.b));
  p.patterns = p.patterns.filter((x) => !gone.has(x.track));
  p.slots = (p.slots || []).filter((s) => !gone.has(s.voie));
  p.auto = (p.auto || []).filter((L) => !mods.has(L.mod));
  p.voies = (p.voies || []).filter((v) => !gone.has(v.id));
}
// Le projet sans sa Session (l'export, la forme d'onde de la barre : ce qu'on
// exporte reste l'arrangement, comme dans Live) — sinon le solo d'une voie
// tairait l'export. Une copie ; le projet ne bouge pas.
export function sansSession(p) {
  const voies = p.voies || [];
  if (!voies.length && !(p.slots || []).length) return p;
  const q = { ...p, modules: [...p.modules], cables: [...p.cables], patterns: [...p.patterns], auto: [...(p.auto || [])], slots: [...(p.slots || [])], voies: [...voies] };
  retirerVoies(q, voies.map((v) => v.id));
  return q;
}

// ── la bibliothèque du projet ───────────────────────────────
export function biblioDe(b) {
  b = b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  return { dossiers: Array.isArray(b.dossiers) ? b.dossiers : [], clips: Array.isArray(b.clips) ? b.clips : [], sons: Array.isArray(b.sons) ? b.sons : [] };
}
// Les sons du projet : chaque son que le projet pose — un clip de
// l'arrangement, les prises d'une région générative, un clip de Session,
// l'échantillonneur, un clip du projet — y entre de lui-même (Live : les
// fichiers du projet), et y reste quand on le retire ; seul « Retirer du
// projet » l'en sort. Un son déjà là garde son origine (`quoi`) ; un neuf
// prend celle qu'on lit ici. Appelé à l'ouverture et à chaque geste
// (musique.js, commit) : la liste est juste par construction. Rend le nombre
// de sons ajoutés.
export function retenirSons(p) {
  const b = p.biblio;
  if (!b) return 0;
  const vus = new Set(b.sons.map((x) => x.item));
  let n = 0;
  const add = (item, quoi) => {
    if (typeof item !== 'string' || !item || vus.has(item)) return;
    vus.add(item); b.sons.push({ item, quoi }); n++;
  };
  for (const c of p.clips) {
    for (const tk of c.gen?.takes || []) add(tk.item, 'generation');
    add(c.item, c.gen ? 'generation' : 'asset');
  }
  for (const s of p.slots || []) add(s.item, 'asset');
  for (const m of p.modules) if (m.type === 'sampler') add(m.params?.item, 'asset');
  for (const c of b.clips) { add(c.item, 'asset'); add(c.inst?.params?.item, 'asset'); }
  return n;
}
// L'origine d'un son que le projet vient de fabriquer ou de prendre (un import,
// une prise, un rendu, une génération) : notée avant que retenirSons ne le
// range comme « asset ». Un son déjà là garde la sienne.
export function noterOrigine(p, item, quoi) {
  if (!p.biblio || typeof item !== 'string' || !item || p.biblio.sons.some((x) => x.item === item)) return;
  p.biblio.sons.push({ item, quoi });
}
// Les usages d'un son dans le projet (le dire avant de le retirer, et dans sa ligne)
export function usagesDuSon(p, id) {
  return {
    arr: p.clips.filter((c) => c.item === id || (c.gen?.takes || []).some((tk) => tk.item === id)).length,
    sess: (p.slots || []).filter((s) => s.item === id).length,
    refs: (p.biblio?.clips || []).filter((c) => c.item === id).length,
    ech: p.modules.filter((m) => m.type === 'sampler' && m.params?.item === id).length,
  };
}

// Un clip du projet tiré d'un morceau [a, b] (en noires) d'un clip de
// l'arrangement — non destructif : l'arrangement ne bouge pas. Un son : une
// référence (le même objet de la bibliothèque, son départ avancé d'autant de
// son que le temps sauté en lit, comme splitClip). Des notes : ce que le clip
// joue vraiment dans le morceau (consolidatePatterns : répétitions,
// décalage, coupes déroulés), copié. Rend la référence, ou un refus (texte).
export function refDeClip(p, c, a, b, uid) {
  a = Math.max(a, c.start); b = Math.min(b, c.start + c.len);
  if (b - a < MIN_LEN - 1e-9) return 'le morceau est trop court (une double croche au moins)';
  const tr = p.tracks.find((t) => t.id === c.track);
  if (!tr) return 'la piste du clip a disparu';
  const base = { id: uid('r'), len: Math.round((b - a) * 1e6) / 1e6, from: c.id };
  // son nom : celui du clip, sinon celui de son motif, sinon celui de sa piste
  const nom = c.name || (c.pat && p.patterns.find((x) => x.id === c.pat)?.name) || tr.name;
  if (nom) base.name = nom.slice(0, 60);
  if (tr.kind === 'audio') {
    if (!c.item) return 'une région sans prise n\'a pas encore de son';
    const ref = { ...base, kind: 'audio', item: c.item, off: Math.round(addAudioOff(c, (a - c.start) * 60 / p.bpm) * 1e6) / 1e6 };
    for (const k of ['gain', 'pitch', 'rev', 'loop', 'ls', 'llen']) if (c[k] !== undefined && c[k] !== null) ref[k] = c[k];
    // un fondu n'a de sens qu'au bord d'origine : un morceau coupé ne le garde pas
    if (c.fi && a <= c.start + 1e-9) ref.fi = c.fi;
    if (c.fo && b >= c.start + c.len - 1e-9) ref.fo = c.fo;
    return ref;
  }
  const r = consolidatePatterns(p, [c], uid, [a, b]);
  if (typeof r === 'string') return r;
  return refDeNotes(p, tr, r.pattern, base);
}
// des notes (un motif consolidé de la piste `tr`) en clip du projet : la copie, et l'instrument d'où elles viennent
function refDeNotes(p, tr, pat, base) {
  const src = p.modules.find((m) => m.id === tr.src);
  const ref = { ...base, kind: 'midi', drums: tr.kind === 'drums', steps: pat.steps };
  if (pat.lanes) ref.lanes = pat.lanes; else ref.notes = pat.notes;
  if (src) ref.inst = { type: src.type, params: JSON.parse(JSON.stringify(src.params || {})) };
  return ref;
}
// Les clips du projet tirés d'une plage [a, b] d'une piste (« Envoyer à la
// Session » sur une sélection de temps) : un son, une référence par morceau de
// clip (chacun garde son son) ; des notes, UNE copie de ce que la piste joue
// dans la plage, le vide compris (Live : une sélection de temps consolidée).
// Rend la liste (vide si la plage n'a rien sur cette piste), ou un refus.
export function refsDePlage(p, tid, a, b, uid) {
  const tr = p.tracks.find((t) => t.id === tid);
  if (!tr || tr.kind === 'bus') return [];
  const cs = p.clips.filter((c) => c.track === tid && !c.mute && c.start < b - 1e-6 && c.start + c.len > a + 1e-6).sort((x, y) => x.start - y.start);
  if (!cs.length) return [];
  if (tr.kind === 'audio') return cs.map((c) => refDeClip(p, c, a, b, uid)).filter((r) => typeof r !== 'string');
  if (b - a < MIN_LEN - 1e-9) return 'la plage est trop courte (une double croche au moins)';
  const r = consolidatePatterns(p, cs, uid, [a, b]);
  if (typeof r === 'string') return r;
  return [refDeNotes(p, tr, r.pattern, { id: uid('r'), len: Math.round((b - a) * 1e6) / 1e6, from: cs[0].id, name: (cs[0].name || tr.name).slice(0, 60) })];
}
// Le motif d'un clip du projet (des notes), pour une piste ou une voie `owner`
export function motifDeRef(ref, owner, uid) {
  const pat = { id: uid('p'), track: owner, name: (ref.name || 'Clip').slice(0, 40), steps: ref.steps };
  if (ref.drums) pat.lanes = JSON.parse(JSON.stringify(ref.lanes || {})); else pat.notes = JSON.parse(JSON.stringify(ref.notes || []));
  return pat;
}
// Les champs d'un clip (de Session, ou de l'arrangement sans `start`) qui joue un clip du projet
export function champsDeRef(ref) {
  const out = { len: ref.len, ref: ref.id };
  if (ref.name) out.name = ref.name;
  if (ref.color) out.color = ref.color;
  if (ref.kind === 'audio') {
    out.item = ref.item; out.off = ref.off || 0;
    for (const k of ['gain', 'pitch', 'rev', 'loop', 'ls', 'llen', 'fi', 'fo']) if (ref[k] !== undefined && ref[k] !== null) out[k] = ref[k];
  }
  return out;
}

// ── la vue Session ──────────────────────────────────────────
// La quantification du lancement : les choix de Live 12 (« Launching Clips »,
// Clip Launch Quantization ; la globale est dans sa barre de transport) — en
// noires : une mesure vaut `sig` noires, 1/4 une noire, T le triolet.
export const QUANTS = [
  ['none', 'Aucune', 0], ['8', '8 mesures', -8], ['4', '4 mesures', -4], ['2', '2 mesures', -2], ['1', '1 mesure', -1],
  ['1/2', '1/2', 2], ['1/2T', '1/2 T', 4 / 3], ['1/4', '1/4', 1], ['1/4T', '1/4 T', 2 / 3], ['1/8', '1/8', 0.5],
  ['1/8T', '1/8 T', 1 / 3], ['1/16', '1/16', 0.25], ['1/16T', '1/16 T', 1 / 6], ['1/32', '1/32', 0.125],
];
const QUANT_OF = Object.fromEntries(QUANTS.map(([k, , v]) => [k, v]));
// en noires ; une valeur négative compte des mesures
export function quantum(key, sig) {
  const v = QUANT_OF[key] ?? -1;
  return v < 0 ? -v * sig : v;
}
// la quantification d'un clip de Session : la sienne, sinon la globale
export const slotQuant = (p, s) => quantum(s?.q && s.q !== 'global' ? s.q : p.launch?.q, p.sig);

export const slotAt = (p, vid, sid) => (p.slots || []).find((s) => s.voie === vid && s.scene === sid) || null;
// le nom d'une scène : le sien, ou son numéro (Live)
export const sceneName = (p, sc) => sc.name || String(p.scenes.indexOf(sc) + 1);

// une scène vide à la place `i` (à la fin par défaut)
export function insererScene(p, i, uid, name = '') {
  const sc = { id: uid('sc'), name };
  p.scenes.splice(i ?? p.scenes.length, 0, sc);
  return sc;
}
// une copie d'un clip de Session (ses prises gardées à part), ailleurs
export function copieSlot(s, uid, patch = {}) {
  return { ...JSON.parse(JSON.stringify(s)), id: uid('cl'), ...patch };
}
// Dupliquer une scène : la copie s'insère juste dessous, avec ses clips
export function dupliquerScene(p, sid, uid) {
  const sc = p.scenes.find((x) => x.id === sid);
  if (!sc) return null;
  const n = { ...sc, id: uid('sc') };
  p.scenes.splice(p.scenes.indexOf(sc) + 1, 0, n);
  for (const s of p.slots.filter((x) => x.scene === sid)) p.slots.push(copieSlot(s, uid, { scene: n.id }));
  return n;
}
export function retirerScene(p, sid) {
  p.scenes = p.scenes.filter((x) => x.id !== sid);
  p.slots = p.slots.filter((x) => x.scene !== sid);
}
// « Capture and Insert Scene » (Live 12, « Session View ») : une scène neuve
// sous `apres`, avec une copie de chaque clip qui joue (`joue` : voie → id)
export function capturerScene(p, joue, apres, uid) {
  const i = apres ? p.scenes.findIndex((x) => x.id === apres) + 1 : p.scenes.length;
  const sc = insererScene(p, i, uid);
  for (const [vid, id] of joue) {
    const s = p.slots.find((x) => x.id === id);
    if (s && (p.voies || []).some((v) => v.id === vid)) p.slots.push(copieSlot(s, uid, { scene: sc.id, voie: vid }));
  }
  return sc;
}

// Une scène dans l'arrangement, à `at` (en noires) : chaque clip de la ligne
// y devient des clips d'arrangement bout à bout, autant de tours qu'il en faut
// pour remplir la scène (sa longueur : le plus long de ses clips) — ce que la
// scène joue, lancée seule. Le clip d'une voie va sur la piste dont elle est
// née (`piste`, si elle est encore là et de la même sorte), sinon sur une
// piste neuve qui joue comme elle (pisteDeVoie) ; ses notes y sont copiées.
// Rend les clips posés, la longueur et les pistes neuves.
export function sceneVersArrangement(p, sid, at, uid) {
  const ss = p.slots.filter((s) => s.scene === sid && (p.voies || []).some((v) => v.id === s.voie));
  const len = Math.max(0, ...ss.map((s) => s.len));
  const made = [], neuves = [];
  for (const s of ss) {
    const v = p.voies.find((x) => x.id === s.voie);
    let t = p.tracks.find((x) => x.id === v.piste && x.kind === v.kind);
    if (!t) {
      const y = Math.max(0, ...p.modules.map((m) => m.y || 0)) + 260;
      t = pisteDeVoie(p, v, trajets(p).ordre.get(v.id), y, uid);
      neuves.push(t);
    }
    let pat = null;
    if (s.pat) {
      const src = p.patterns.find((x) => x.id === s.pat);
      if (!src) continue;
      pat = { ...JSON.parse(JSON.stringify(src)), id: uid('p'), track: t.id };
      p.patterns.push(pat);
    }
    for (let a = 0; a < len - 1e-9; a += s.len) {
      const { id, scene, mode, q, color, voie, ref, ...c } = JSON.parse(JSON.stringify(s));
      made.push({ ...c, ...(pat ? { pat: pat.id } : {}), id: uid('c'), track: t.id, start: at + a, len: Math.min(s.len, len - a) });
    }
  }
  p.clips.push(...made);
  return { made, len, neuves };
}

// ── l'historique ────────────────────────────────────────────
// Un instantané du projet (sans ce qui n'est pas de l'œuvre : version,
// vue, travaux en cours, brouillon du panneau génératif) après chaque geste
// terminé. Annuler rend l'instantané d'avant, tout entier : juste par
// construction, quel que soit le geste. La pile est celle du portail
// (commun/undo.js, U.snapshots : musique.js) ; ici, ce qu'on y range et le
// libellé d'un geste.
const SKIP = new Set(['rev', 'ui', 'pending', 'updated', 'created', 'gen', 'id']);
// Ce que les vues créent en se dessinant n'est pas un geste : les tables
// vides du nodal (noms, exposé, bornes…, nodal.js `reglage`) et la tension
// plate du banc (0,5 partout, banc.js `B`) valent leur absence. Sans cela,
// annuler le premier geste d'une session les retirait, la vue les recréait,
// et ce « changement » effaçait la pile de rétablir.
const vide = (v) => v && typeof v === 'object' && !(Array.isArray(v) ? v.length : Object.keys(v).length);
export function workOf(p) {
  const o = {};
  for (const k of Object.keys(p || {})) if (!SKIP.has(k)) o[k] = p[k];
  if (o.nodal && typeof o.nodal === 'object') {
    const n = Object.fromEntries(Object.entries(o.nodal).filter(([, v]) => !vide(v)));
    if (Object.keys(n).length) o.nodal = n; else delete o.nodal;
  }
  if (o.banc?.ten?.every?.((pt) => pt[1] === 0.5)) { const { ten, ...b } = o.banc; o.banc = b; }
  return o;
}
export const snapshot = (p) => JSON.stringify(workOf(p));

// Le libellé d'un geste, lu dans la différence de deux instantanés : ce qui
// a changé (une clé du projet), et pour une liste d'objets à id, combien
// sont venus ou partis. Un verbe, comme partout (« ajouter 2 clips »).
const NOUN = {
  clips: ['clip', 'clips'], tracks: ['piste', 'pistes'], modules: ['module', 'modules'], cables: ['câble', 'câbles'],
  sections: ['section', 'sections'], markers: ['marqueur', 'marqueurs'], patterns: ['motif', 'motifs'],
  auto: ['voie d’automation', 'voies d’automation'], presets: ['préréglage', 'préréglages'], groups: ['groupe de pistes', 'groupes de pistes'],
  slots: ['clip de Session', 'clips de Session'], scenes: ['scène', 'scènes'], voies: ['voie de Session', 'voies de Session'],
  arcs: ['arc', 'arcs'],
};
const WHAT = {
  bpm: 'le tempo', sig: 'la mesure', key: 'la tonalité', loop: 'la boucle', arc: 'l’arc d’énergie', name: 'le nom du projet',
  banc: 'le banc (attracteurs)', nodal: 'le nodal', clips: 'les clips', tracks: 'les pistes', modules: 'les instruments et effets',
  cables: 'les câbles', sections: 'les sections', markers: 'les marqueurs', patterns: 'les motifs', auto: 'l’automation', presets: 'les préréglages',
  groups: 'les groupes de pistes', slots: 'les clips de Session', scenes: 'les scènes', launch: 'la quantification du lancement',
  voies: 'les voies de Session', biblio: 'la bibliothèque du projet', arcs: 'les arcs',
};
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
export function describeWork(a, b, names = {}) {
  const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter((k) => !same(a[k], b[k]));
  if (!keys.length) return 'modifier le projet';
  if (keys.length === 1) {
    const k = keys[0];
    if (k === 'bpm') return `tempo ${a.bpm} → ${b.bpm}`;
    if (k === 'name') return `renommer le projet en « ${b.name} »`;
    const A = Array.isArray(a[k]) ? a[k] : null, B = Array.isArray(b[k]) ? b[k] : null;
    if (A && B && NOUN[k] && A.every((x) => x && x.id) && B.every((x) => x && x.id)) {
      const ia = new Set(A.map((x) => x.id)), ib = new Set(B.map((x) => x.id));
      const plus = B.filter((x) => !ia.has(x.id)).length, moins = A.filter((x) => !ib.has(x.id)).length;
      const n = (c) => NOUN[k][c > 1 ? 1 : 0];
      if (plus && !moins) return `ajouter ${plus} ${n(plus)}`;
      if (moins && !plus) return `retirer ${moins} ${n(moins)}`;
      if (!plus && !moins) {
        const ch = B.filter((x) => { const o = A.find((y) => y.id === x.id); return o && !same(o, x); });
        if (!ch.length && k === 'tracks') return 'changer l’ordre des pistes';
        if (k === 'modules' && ch.length === 1) return `régler « ${names[ch[0].type] || ch[0].name || ch[0].type} »`;
        if ((k === 'tracks' || k === 'voies') && ch.length === 1) return `modifier la ${k === 'voies' ? 'voie' : 'piste'} « ${ch[0].name} »`;
        if ((k === 'clips' || k === 'slots') && ch.length) return `modifier ${ch.length} ${n(ch.length)}`;
        if (!ch.length && k === 'scenes') return 'changer l’ordre des scènes';
      }
    }
    if (WHAT[k]) return `modifier ${WHAT[k]}`;
  }
  const lab = keys.map((k) => WHAT[k]).filter(Boolean);
  return lab.length ? `modifier ${lab.slice(0, 2).join(' et ')}${lab.length > 2 ? '…' : ''}` : 'modifier le projet';
}

// ── le graphe du son : une seule vérité, les câbles ─────────
// Le nodal dessine les câbles ; l'arrangement, la console et le rack lisent
// les mêmes. La CHAÎNE d'une piste n'est rangée nulle part : c'est l'ensemble
// des modules qui sont sur un chemin de sa source à sa tranche (atteints
// depuis la source ET menant à la tranche), dans l'ordre du chemin. Un effet
// que les nœuds de deux pistes traversent est donc dans les deux chaînes, par
// construction ; le moteur (moteur.js, Graph) en joue une voix par piste, avec
// les mêmes réglages : une seule instance, deux passages, le son de chaque
// piste reste dans sa piste. Câbles de SON seulement : ni les envois de la
// console (c.send), ni les câbles typés des jouets (c.t). Les voies de la
// Session ont leur chaîne de la même façon : `ordre`, `dedans` et `de`
// connaissent les pistes ET les voies (leurs ids ne se croisent pas).
export const deSon = (c) => !c.t && typeof c.send !== 'number';
const TRAJ = { p: null, sig: '', v: null };
export function trajets(p) {
  const chaines = [...p.tracks, ...(p.voies || [])];
  const sig = `${chaines.map((t) => `${t.id}:${t.src}:${t.strip}`).join('|')}#${p.cables.map((c) => (deSon(c) ? `${c.a}>${c.b}` : '')).join(',')}`;
  if (TRAJ.p === p && TRAJ.sig === sig) return TRAJ.v;
  const outs = new Map(), ins = new Map();
  for (const c of p.cables) {
    if (!deSon(c)) continue;
    if (!outs.has(c.a)) outs.set(c.a, []);
    if (!ins.has(c.b)) ins.set(c.b, []);
    outs.get(c.a).push(c.b); ins.get(c.b).push(c.a);
  }
  const atteint = (from, adj) => {
    const vu = new Set([from]), pile = [from];
    while (pile.length) { const n = pile.pop(); for (const x of adj.get(n) || []) if (!vu.has(x)) { vu.add(x); pile.push(x); } }
    return vu;
  };
  const ordre = new Map(), dedans = new Map(), de = new Map();
  for (const t of chaines) {
    const av = atteint(t.src, outs), ar = atteint(t.strip, ins);
    const on = new Set([...av].filter((id) => ar.has(id)));
    if (!on.has(t.src) || !on.has(t.strip)) { ordre.set(t.id, []); dedans.set(t.id, new Set()); continue; }
    // l'ordre du chemin : un tri topologique restreint au trajet (Kahn), dans l'ordre des câbles
    const deg = new Map([...on].map((id) => [id, 0]));
    for (const id of on) for (const x of outs.get(id) || []) if (on.has(x)) deg.set(x, deg.get(x) + 1);
    const file = [...on].filter((id) => deg.get(id) === 0), seq = [];
    while (file.length) {
      const n = file.shift();
      seq.push(n);
      for (const x of outs.get(n) || []) if (on.has(x)) { deg.set(x, deg.get(x) - 1); if (!deg.get(x)) file.push(x); }
    }
    ordre.set(t.id, seq); dedans.set(t.id, on);
    for (const id of seq) { if (!de.has(id)) de.set(id, []); de.get(id).push(t.id); }
  }
  TRAJ.p = p; TRAJ.sig = sig;
  TRAJ.v = { ordre, dedans, de };
  return TRAJ.v;
}
/** Les pistes dont la chaîne passe par ce module (0, 1 ou plusieurs) ; pas les voies de la Session. */
export const pistesDuModule = (p, id) => (trajets(p).de.get(id) || []).filter((x) => p.tracks.some((t) => t.id === x));

// Retirer un module EN RECOUSANT, piste par piste : ce qui entrait est
// rebranché sur ce qui sortait, mais seulement le long d'une même chaîne — un
// délai que deux pistes partagent ne recoud pas la basse sur la tranche de la
// voix. Un module sur aucun trajet recoud tout (comme avant).
export function recoudre(p, id, boucle) {
  const T = trajets(p), pistes = T.de.get(id) || [];
  const ins = p.cables.filter((c) => deSon(c) && c.b === id).map((c) => c.a);
  const outs = p.cables.filter((c) => deSon(c) && c.a === id).map((c) => c.b);
  const paires = [];
  if (!pistes.length) for (const a of ins) for (const b of outs) paires.push([a, b]);
  else for (const tid of pistes) { const on = T.dedans.get(tid); for (const a of ins) if (on.has(a)) for (const b of outs) if (on.has(b)) paires.push([a, b]); }
  p.cables = p.cables.filter((c) => c.a !== id && c.b !== id);
  for (const [a, b] of paires) if (!boucle(a, b) && !p.cables.some((c) => c.a === a && c.b === b && !c.t)) p.cables.push({ a, b });
}

// Sortir un module partagé de la chaîne d'UNE piste : ses câbles qui ne
// servent qu'à elle partent, la chaîne se referme autour ; les autres pistes
// le gardent.
export function sortirDeLaChaine(p, id, tid, boucle) {
  const T = trajets(p), on = T.dedans.get(tid);
  if (!on?.has(id)) return false;
  const autres = (T.de.get(id) || []).filter((x) => x !== tid);
  const partage = (x) => autres.some((o) => T.dedans.get(o).has(x));
  const ins = p.cables.filter((c) => deSon(c) && c.b === id && on.has(c.a)).map((c) => c.a);
  const outs = p.cables.filter((c) => deSon(c) && c.a === id && on.has(c.b)).map((c) => c.b);
  p.cables = p.cables.filter((c) => !(deSon(c) && ((c.b === id && ins.includes(c.a) && !partage(c.a)) || (c.a === id && outs.includes(c.b) && !partage(c.b)))));
  for (const a of ins) for (const b of outs) if (!boucle(a, b) && !p.cables.some((c) => c.a === a && c.b === b && !c.t)) p.cables.push({ a, b });
  return true;
}

// Faire entrer un effet dans la chaîne d'une piste, juste après `from` (un
// module de cette chaîne) : les câbles de `from` vers la suite de la chaîne
// passent par l'effet. C'est ce que fait un câble tiré, dans le nodal, d'un
// nœud d'une piste vers un effet qu'une autre piste traverse déjà. Rend un
// refus (texte) ou null.
export function entrerDansLaChaine(p, from, fx, tid, boucle) {
  const on = trajets(p).dedans.get(tid);
  if (!on?.has(from)) return 'ce nœud n’est pas sur la chaîne de sa piste';
  if (on.has(fx)) return 'cet effet est déjà dans la chaîne de cette piste';
  if (boucle(from, fx)) return 'ce câble ferait une boucle : le son tournerait sans fin';
  const suite = p.cables.filter((c) => deSon(c) && c.a === from && on.has(c.b)).map((c) => c.b);
  if (suite.some((b) => boucle(fx, b))) return 'ce câble ferait une boucle : le son tournerait sans fin';
  p.cables = p.cables.filter((c) => !(deSon(c) && c.a === from && suite.includes(c.b)));
  p.cables.push({ a: from, b: fx });
  for (const b of suite) if (!p.cables.some((c) => c.a === fx && c.b === b && !c.t)) p.cables.push({ a: fx, b });
  return null;
}

// ── les groupes de pistes (l'arrangement) ───────────────────
// Un groupe est une étiquette sur des pistes qui se suivent : il se replie,
// se renomme, se défait ; il ne change pas le son. Ses membres restent
// contigus (rangerGroupes, après chaque geste) ; un groupe vide s'efface.
export function rangerGroupes(p) {
  p.groups = (p.groups || []).filter((g) => g && g.id);
  const ids = new Set(p.groups.map((g) => g.id));
  for (const t of p.tracks) if (t.grp && (!ids.has(t.grp) || t.kind === 'bus')) delete t.grp;
  // les membres d'un groupe rejoignent son premier membre, dans leur ordre
  const out = [], place = new Set();
  for (const t of p.tracks) {
    if (place.has(t.id)) continue;
    if (!t.grp) { out.push(t); place.add(t.id); continue; }
    for (const m of p.tracks) if (m.grp === t.grp && !place.has(m.id)) { out.push(m); place.add(m.id); }
  }
  p.tracks.splice(0, p.tracks.length, ...out);
  const vivants = new Set(p.tracks.map((t) => t.grp).filter(Boolean));
  p.groups = p.groups.filter((g) => vivants.has(g.id));
}

// Déplacer des pistes avant ou après une autre. Le groupe suit la place :
// entre deux membres d'un groupe, on y entre ; au bord de son propre groupe,
// on y reste (réordonner dedans) ; ailleurs, on en sort. Un groupe entier
// qu'on déplace (par son en-tête) reste un groupe.
export function groupeALaPlace(p, ids, cible, cote) {
  const reste = p.tracks.filter((t) => !ids.includes(t.id));
  const tc = reste.find((t) => t.id === cible);
  if (!tc) return null;
  const i = reste.indexOf(tc) + (cote === 'apres' ? 1 : 0);
  const av = reste[i - 1], ap = reste[i];
  const bouge = p.tracks.filter((t) => ids.includes(t.id));
  const siens = new Set(bouge.map((t) => t.grp || ''));
  const g0 = siens.size === 1 ? [...siens][0] : '';
  if (g0 && p.tracks.filter((t) => t.grp === g0).every((t) => ids.includes(t.id))) return { i, g: g0, reste, bouge };   // un groupe entier
  if (av?.grp && av.grp === ap?.grp) return { i, g: av.grp, reste, bouge };
  if (g0 && (av?.grp === g0 || ap?.grp === g0)) return { i, g: g0, reste, bouge };
  return { i, g: null, reste, bouge };
}
export function deplacerPistes(p, ids, cible, cote) {
  if (ids.includes(cible)) return false;
  const q = groupeALaPlace(p, ids, cible, cote);
  if (!q || !q.bouge.length) return false;
  for (const t of q.bouge) { if (q.g) t.grp = q.g; else delete t.grp; }
  q.reste.splice(q.i, 0, ...q.bouge);
  p.tracks.splice(0, p.tracks.length, ...q.reste);
  rangerGroupes(p);
  return true;
}

// Grouper des pistes avec une autre (lâcher une piste sur une autre) : la cible
// garde son groupe s'il existe, sinon un groupe neuf naît autour des deux.
export function grouperPistes(p, ids, cible, uid) {
  const tc = p.tracks.find((t) => t.id === cible);
  if (!tc || tc.kind === 'bus' || ids.includes(cible)) return null;
  let g = tc.grp && p.groups.find((x) => x.id === tc.grp);
  if (!g) {
    const n = p.groups.length + 1;
    g = { id: uid('g'), name: `Groupe ${n}`, fold: false };
    p.groups.push(g);
    tc.grp = g.id;
  }
  const bouge = p.tracks.filter((t) => ids.includes(t.id) && t.kind !== 'bus');
  const reste = p.tracks.filter((t) => !ids.includes(t.id));
  const membres = reste.filter((t) => t.grp === g.id);
  const i = reste.indexOf(membres[membres.length - 1]) + 1;
  for (const t of bouge) t.grp = g.id;
  reste.splice(i, 0, ...bouge);
  p.tracks.splice(0, p.tracks.length, ...reste);
  rangerGroupes(p);
  return g;
}
export function degrouper(p, gid) {
  for (const t of p.tracks) if (t.grp === gid) delete t.grp;
  p.groups = p.groups.filter((g) => g.id !== gid);
}

// ── les sections ────────────────────────────────────────────
export const sorted = (p) => [...p.sections].sort((x, y) => x.a - y.a);
export const sectionAt = (p, b) => p.sections.find((s) => b >= s.a && b < s.b) || null;
const within = (x, a, b) => x >= a - 1e-9 && x < b - 1e-9;

// tout ce qui commence à partir de `at` recule de `d` (clips, sections,
// marqueurs, points de l'arc et de l'automation)
export function shiftFrom(p, at, d) {
  for (const c of p.clips) if (c.start >= at - 1e-9) c.start += d;
  for (const s of p.sections) if (s.a >= at - 1e-9) { s.a += d; s.b += d; }
  for (const m of p.markers) if (m.b >= at - 1e-9) m.b += d;
  for (const pts of curves(p)) for (const pt of pts) if (pt[0] >= at - 1e-9) pt[0] += d;
}
// (les arcs du projet aussi, 06/10 : déplacer une section emporte leurs points ; la Tension est au banc)
const curves = (p) => [p.arc?.pts || [], ...(p.auto || []).map((L) => L.pts || []), ...(p.arcs || []).filter((A) => A.k !== 'tension').map((A) => A.pts || (A.pts = []))];
const sortPts = (p) => { for (const pts of curves(p)) pts.sort((x, y) => x[0] - y[0]); };

// déplace ce qui commence dans [a, b) de `d` : clips et points des courbes ;
// les points qui étaient déjà à l'arrivée cèdent la place
function carry(p, a, b, d) {
  const moved = new Set();
  for (const c of p.clips) if (within(c.start, a, b)) { c.start += d; moved.add(c); }
  for (const pts of curves(p)) {
    const go = pts.filter((pt) => within(pt[0], a, b));
    const keep = pts.filter((pt) => !within(pt[0], a, b) && !within(pt[0], a + d, b + d));
    pts.splice(0, pts.length, ...keep, ...go.map((pt) => { pt[0] += d; return pt; }));
  }
  sortPts(p);
  return moved;
}

// Dupliquer une section AVEC ses clips : la copie s'insère juste après
// l'original, et tout ce qui suivait recule d'autant.
export function duplicateSection(p, sec, uid) {
  const len = sec.b - sec.a;
  const copies = p.clips.filter((c) => within(c.start, sec.a, sec.b)).map((c) => ({ ...c, ...own(c), id: uid('c'), start: c.start + len }));
  const ptsCopies = curves(p).map((pts) => pts.filter((pt) => within(pt[0], sec.a, sec.b)).map(([b, v]) => [b + len, v]));
  shiftFrom(p, sec.b, len);
  p.clips.push(...copies);
  curves(p).forEach((pts, i) => pts.push(...ptsCopies[i]));
  sortPts(p);
  const n = { ...sec, id: uid('s'), a: sec.b, b: sec.b + len };
  p.sections.push(n);
  return n;
}

// Déplacer une section avec ce qu'elle contient ; refusé si la place est prise
export function moveSection(p, sec, na) {
  const len = sec.b - sec.a, d = na - sec.a;
  if (na < 0) return 'avant le début du morceau';
  const clash = p.sections.find((s) => s !== sec && s.a < na + len - 1e-9 && s.b > na + 1e-9);
  if (clash) return `la place est prise par « ${clash.name} »`;
  carry(p, sec.a, sec.b, d);
  sec.a += d; sec.b += d;
  return null;
}

// Échanger une section avec sa voisine (dir -1 : la précédente, +1 : la
// suivante), leur contenu compris ; l'écart entre elles est gardé.
export function swapSection(p, sec, dir) {
  const list = sorted(p), i = list.indexOf(sec), j = i + dir;
  if (j < 0 || j >= list.length) return 'pas de voisine de ce côté';
  const [A, B] = dir > 0 ? [sec, list[j]] : [list[j], sec];
  const lenA = A.b - A.a, lenB = B.b - B.a, gap = B.a - A.b;
  const dA = lenB + gap, dB = -(lenA + gap);
  const inA = p.clips.filter((c) => within(c.start, A.a, A.b)), inB = p.clips.filter((c) => within(c.start, B.a, B.b));
  for (const c of inA) c.start += dA;
  for (const c of inB) c.start += dB;
  for (const pts of curves(p)) for (const pt of pts) {
    if (within(pt[0], A.a, A.b)) pt[0] += dA; else if (within(pt[0], B.a, B.b)) pt[0] += dB;
  }
  sortPts(p);
  const a0 = A.a;
  B.a = a0; B.b = a0 + lenB;
  A.a = a0 + lenB + gap; A.b = A.a + lenA;
  return null;
}

export function removeSection(p, sec, withClips = false) {
  if (withClips) {
    p.clips = p.clips.filter((c) => !within(c.start, sec.a, sec.b));
    for (const pts of curves(p)) pts.splice(0, pts.length, ...pts.filter((pt) => !within(pt[0], sec.a, sec.b)));
  }
  p.sections = p.sections.filter((s) => s !== sec);
}

// ── la structure : les sections et les balises des paroles (06/10) ──
// Cal, 06/10 : « si on place [verse], [chorus], [bridge]… dans les paroles
// d'une région générative, les sections correspondantes apparaissent alignées
// au-dessus de l'arc d'énergie, sur la bonne plage de mesures, et inversement ».
//
// LE CONTRAT (le panneau génératif, generatif*.js, s'y tient sans rien appeler) :
//   - les SECTIONS vivent dans le projet : p.sections [{ id, name, a, b, color,
//     tag }], en noires. C'est le plan que la génération envoie déjà
//     (generatif_region.js, sectionsFor → [[étiquette, mesures]]) ;
//   - les PAROLES d'une région vivent dans c.gen.v.lyrics : un texte, des blocs
//     ouverts par une ligne « [Étiquette] » (YuE : « structure labels (e.g.,
//     [verse], [chorus], [bridge], [outro]) prepended […] separated by 2 newline »,
//     README de YuE ; ACE-Step écrit « [Verse] », INFERENCE.md) ;
//   - le lien est l'ORDRE : le i-ème bloc ↔ la i-ème section que la région
//     couvre (sectionsDeRegion : tout recouvrement, la règle de `covered`) ;
//   - musique.js le tient à chaque geste (app.commit → suivreStructure) : des
//     paroles qui changent replacent les sections de la région ; des sections
//     qui changent (renommer, étiqueter, tirer, déplacer, retirer), ou une région
//     qui bouge, récrivent les balises de ses paroles (les vers restent). Le
//     panneau écrit c.gen.v.lyrics et fait app.commit, comme aujourd'hui ; un
//     autre champ de paroles appelle structureDepuisParoles / parolesDepuisStructure
//     avec son texte.
// Sans balise dans les paroles, rien ne bouge (on ne met pas de balises dans
// des paroles qui n'en veulent pas) ; des blocs en trop (plus de blocs que de
// sections) restent tels quels — aucun vers ne se perd.

// une ligne de balise : « [Verse] », « [verse 2] », « [Pre-Chorus] »… seule sur sa ligne
const BALISE_RX = /^\s*\[([^\]\n]{1,40})\]\s*$/;
const sansAccent = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// L'étiquette d'une balise : une des sept de SECTION_TAGS (modules.js), sinon le
// mot écrit (« [Build] » → build), gardé tel quel : il revient dans les paroles.
export function etiquetteDe(txt) {
  const n = sansAccent(txt).replace(/\d+/g, ' ').trim();
  if (/pre.?(refrain|chorus)/.test(n)) return 'pre-chorus';
  if (/refrain|chorus|hook/.test(n)) return 'chorus';
  if (/couplet|verse/.test(n)) return 'verse';
  if (/pont|bridge/.test(n)) return 'bridge';
  if (/intro/.test(n)) return 'intro';
  if (/outro|final|\bfin\b|\bend\b|coda/.test(n)) return 'outro';
  if (/instru|solo|break|interlude|pause/.test(n)) return 'instrumental';
  return n.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'verse';
}
// Les blocs des paroles : [{ tag, ligne (l'index de la ligne de balise), vers (le nombre de lignes chantées) }]
export function lireParoles(texte) {
  const lignes = (texte || '').split('\n'), blocs = [];
  lignes.forEach((l, i) => {
    const m = l.match(BALISE_RX);
    if (m) blocs.push({ tag: etiquetteDe(m[1]), ligne: i, vers: 0, bas: m[1] === m[1].toLowerCase() });
    else if (blocs.length && l.trim()) blocs[blocs.length - 1].vers += 1;
  });
  return { lignes, blocs };
}
// Une balise écrite comme les autres du texte : en bas de casse si elles le sont
// toutes (YuE), sinon « [Pre-Chorus] » (ACE-Step, et le bouton « Les sections »).
const ecrireBalise = (tag, bas) => `[${bas ? tag : tag.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join('-')}]`;
// Le texte dont les blocs portent `tags` dans l'ordre : les balises qui diffèrent
// sont récrites, les sections en plus deviennent des blocs vides à la fin, les
// blocs en plus restent. Rend le texte (le même s'il n'y a rien à changer).
export function ecrireParoles(texte, tags) {
  const { lignes, blocs } = lireParoles(texte);
  const bas = blocs.length > 0 && blocs.every((b) => b.bas);
  for (let i = 0; i < Math.min(blocs.length, tags.length); i++) if (blocs[i].tag !== tags[i]) lignes[blocs[i].ligne] = ecrireBalise(tags[i], bas);
  let out = lignes.join('\n');
  for (const t of tags.slice(blocs.length)) out = `${out.replace(/\s*$/, '')}\n\n${ecrireBalise(t, bas)}\n`;
  return out;
}

// les régions génératives qui ont des paroles (le contrat : c.gen.v.lyrics)
const regionsParoles = (p) => (p.clips || []).filter((c) => c.gen && typeof c.gen.v?.lyrics === 'string');
// les sections qu'une région couvre, dans l'ordre du temps
export function sectionsDeRegion(p, c) {
  const a = c.start, b = c.start + c.len;
  return sorted(p).filter((s) => s.b > a + 1e-9 && s.a < b - 1e-9);
}
// les couleurs des sections nées des paroles : celles de la session de la
// maquette (server/tools/music.py : intro cy, couplet grn2, refrain or, final coral-3)
const COULEUR_TAG = { intro: 'cy', verse: 'grn2', 'pre-chorus': 'amb', chorus: 'or', bridge: 'coral-1', instrumental: 'coral-2', outro: 'coral-3' };
const nomTag = (tag) => SECTION_TAGS.find(([k]) => k === tag)?.[1] || (tag[0] || '').toUpperCase() + tag.slice(1).replace(/-/g, ' ');
// un nom qui suit son étiquette (« Couplet », « Couplet 2 », « Verse ») suivra la nouvelle
const nomSuit = (s) => { const n = sansAccent(s.name).replace(/\s*\d+$/, '').trim(); return n === sansAccent(nomTag(s.tag || '')) || n === sansAccent(s.tag || ''); };
function nomNeuf(p, tag, sauf = null) {
  const base = nomTag(tag).slice(0, 36);
  const pris = new Set(p.sections.filter((s) => s !== sauf).map((s) => s.name));
  if (!pris.has(base)) return base;
  for (let k = 2; ; k++) if (!pris.has(`${base} ${k}`)) return `${base} ${k}`;
}

// Les paroles → les sections de la région. Autant de blocs que de sections
// couvertes : chaque section prend l'étiquette de son bloc (et son nom, s'il
// suivait l'ancienne). Sinon la plage de la région est replanifiée : un bloc,
// une section, des mesures entières, la même durée pour chacun (YuE : « each
// session is around 30s », README — une durée par bloc, pas par vers) ; les
// sections qui débordaient de la région gardent leur part au-dehors. Rend ce
// qui a changé, en mots, ou null.
export function structureDepuisParoles(p, c, uid, texte = c.gen?.v?.lyrics) {
  const { blocs } = lireParoles(texte);
  if (!blocs.length || !(c.len > 0)) return null;
  const cov = sectionsDeRegion(p, c);
  if (cov.length === blocs.length) {
    let n = 0;
    cov.forEach((s, i) => {
      const t = blocs[i].tag;
      if (s.tag === t) return;
      if (nomSuit(s)) s.name = nomNeuf(p, t, s);
      s.tag = t; n++;
    });
    return n ? `${n} section${n > 1 ? 's' : ''} ré-étiquetée${n > 1 ? 's' : ''} par les paroles` : null;
  }
  // replanifier : k blocs sur N mesures (une mesure au moins chacun)
  const a = c.start, e = c.start + c.len, sig = p.sig || 4;
  const N = Math.max(1, Math.round(c.len / sig)), k = Math.min(blocs.length, N);
  const base = Math.floor(N / k), plus = N - base * k;
  const plan = [];
  let x = a;
  for (let i = 0; i < k; i++) {
    const y = i === k - 1 ? e : x + (base + (i < plus ? 1 : 0)) * sig;
    plan.push({ tag: blocs[i].tag, a: x, b: y });
    x = y;
  }
  // déjà ainsi (des blocs en trop pour la région) : rien à refaire
  if (cov.length === plan.length && cov.every((s, i) => s.tag === plan[i].tag && Math.abs(s.a - plan[i].a) < 1e-9 && Math.abs(s.b - plan[i].b) < 1e-9)) return null;
  const garde = [];
  for (const s of p.sections) {
    if (s.b <= a + 1e-9 || s.a >= e - 1e-9) { garde.push(s); continue; }
    const apres = s.b > e + 1e-9 ? { ...s, a: e } : null;
    if (s.a < a - 1e-9) { s.b = a; garde.push(s); if (apres) garde.push({ ...apres, id: uid('s') }); } else if (apres) garde.push(Object.assign(s, { a: e }));
  }
  p.sections = garde;
  for (const q of plan) p.sections.push({ id: uid('s'), name: nomNeuf(p, q.tag), a: q.a, b: q.b, color: COULEUR_TAG[q.tag] || 'cy', tag: q.tag });
  return `${plan.length} section${plan.length > 1 ? 's' : ''} posée${plan.length > 1 ? 's' : ''} par les paroles`;
}

// Les sections → les balises des paroles de la région (les vers restent). Rend
// le texte neuf, ou null s'il n'y a rien à changer (ou pas de balise du tout).
export function parolesDepuisStructure(p, c, texte = c.gen?.v?.lyrics) {
  if (!lireParoles(texte).blocs.length) return null;
  const neuf = ecrireParoles(texte, sectionsDeRegion(p, c).map((s) => s.tag || guessTag(s.name)));
  return neuf === texte ? null : neuf;
}

// Les sections qu'une balise de paroles tient (la vue les marque de leur [étiquette]).
export function sectionsLiees(p) {
  const out = new Set();
  for (const c of regionsParoles(p)) {
    const n = lireParoles(c.gen.v.lyrics).blocs.length;
    sectionsDeRegion(p, c).slice(0, n).forEach((s) => out.add(s.id));
  }
  return out;
}

// L'empreinte de la structure : les sections, et pour chaque région ses paroles et sa place.
export function empreinteStructure(p) {
  return {
    secs: JSON.stringify((p.sections || []).map((s) => [s.id, s.a, s.b, s.tag, s.name])),
    regions: new Map(regionsParoles(p).map((c) => [c.id, { lyr: c.gen.v.lyrics, a: c.start, b: c.start + c.len }])),
  };
}
// Tenir la structure après un geste (musique.js, app.commit). `vu` : l'empreinte
// du geste d'avant. Les paroles changées d'une région replacent ses sections ;
// puis les autres régions (sections changées, région déplacée, collée)
// récrivent leurs balises. Rend { vu (l'empreinte neuve), changed, dit }.
export function suivreStructure(p, vu, uid) {
  const now = empreinteStructure(p);
  vu = vu || now;
  let changed = false, dit = '';
  const lyr = new Set();
  for (const c of regionsParoles(p)) {
    const o = vu.regions.get(c.id);
    if (!o || o.lyr === c.gen.v.lyrics) continue;
    lyr.add(c.id);
    const r = structureDepuisParoles(p, c, uid);
    if (r) { changed = true; dit = r; }
  }
  const secs = changed || now.secs !== vu.secs;
  for (const c of regionsParoles(p)) {
    if (lyr.has(c.id)) continue;
    const o = vu.regions.get(c.id);
    if (!secs && o && o.a === c.start && o.b === c.start + c.len) continue;
    const t = parolesDepuisStructure(p, c);
    if (t !== null) { c.gen.v.lyrics = t; changed = true; dit = dit || 'balises des paroles récrites'; }
  }
  return { vu: changed ? empreinteStructure(p) : now, changed, dit };
}

// ── le presse-papiers des clips ─────────────────────────────
export function copyClips(p, ids) {
  const cs = p.clips.filter((c) => ids.includes(c.id));
  if (!cs.length) return null;
  const base = Math.min(...cs.map((c) => c.start));
  return { base, len: Math.max(...cs.map((c) => c.start + c.len)) - base, items: cs.map((c) => JSON.parse(JSON.stringify(c))) };
}

// colle à `at` ; un clip retrouve sa piste, ou prend `fallback` si elle
// n'existe plus (et seulement si c'est la même sorte de piste)
export function pasteClips(p, board, at, uid, fallback = null) {
  const out = [];
  for (const c of board.items) {
    let tr = p.tracks.find((t) => t.id === c.track);
    if (!tr && fallback) { const f = p.tracks.find((t) => t.id === fallback); if (f && (f.kind === 'audio') === !!c.item) tr = f; }
    if (!tr) continue;
    if (c.pat && !p.patterns.some((x) => x.id === c.pat && x.track === tr.id)) continue;
    const n = { ...JSON.parse(JSON.stringify(c)), id: uid('c'), track: tr.id, start: Math.max(0, at + (c.start - board.base)) };
    p.clips.push(n);
    out.push(n);
  }
  return out;
}

// ── consolider (Ctrl+J, « Consolidate » de Live) ────────────
// Les clips de motif choisis d'une même piste deviennent UN clip, sur un
// motif neuf qui contient ce qu'ils jouaient réellement (répétitions,
// décalages et coupes déroulés). Rend { pattern, clip } ou un refus.
// `range` [a, b] (une plage de temps choisie) : le clip la couvre tout
// entière, le vide compris (Live : consolider une sélection de temps).
export function consolidatePatterns(p, clips, uid, range = null) {
  const tr = p.tracks.find((t) => t.id === clips[0].track);
  const a = range ? range[0] : Math.floor(Math.min(...clips.map((c) => c.start)) * 4) / 4;
  const b = range ? range[1] : Math.max(...clips.map((c) => c.start + c.len));
  const steps = Math.ceil(((b - a) * 4) / 4) * 4;
  if (steps > 256) return 'un motif tient 64 temps au plus (256 pas)';
  const drums = tr.kind === 'drums';
  const pat = { id: uid('p'), track: tr.id, name: 'Consolidé', steps: Math.max(4, steps) };
  if (drums) pat.lanes = {}; else pat.notes = [];
  for (const c of clips) {
    if (c.mute) continue;
    const src = p.patterns.find((x) => x.id === c.pat);
    if (!src) continue;
    const plen = src.steps / 4, origin = c.start - (c.off || 0), ce = c.start + c.len;
    for (let k = Math.floor((c.start - origin) / plen); origin + k * plen < ce; k++) {
      const base = origin + k * plen;
      if (drums) {
        for (const [v, arr] of Object.entries(src.lanes || {})) arr.forEach((vel, s) => {
          const bt = base + s / 4;
          if (!vel || bt < c.start || bt >= ce || bt < a - 1e-9 || bt >= b) return;
          const i = Math.round((bt - a) * 4);
          if (i < 0 || i >= pat.steps) return;
          if (!pat.lanes[v]) pat.lanes[v] = Array(pat.steps).fill(0);
          pat.lanes[v][i] = Math.max(pat.lanes[v][i], vel);
        });
      } else {
        for (const n of src.notes || []) {
          const bt = base + n.s / 4;
          if (bt < c.start || bt >= ce || bt < a - 1e-9 || bt >= b) continue;   // dans le clip, et dans la plage
          const s = Math.round((bt - a) * 4 * 100) / 100;
          if (s < 0 || s > pat.steps - 1e-6) continue;
          const l = Math.max(0.25, Math.min(n.l, (ce - bt) * 4, pat.steps - s));
          pat.notes.push({ ...n, s, l });
        }
      }
    }
  }
  const clip = { id: uid('c'), track: tr.id, start: a, len: range ? b - a : pat.steps / 4, pat: pat.id };
  return { pattern: pat, clip };
}

// ── la sélection de temps (Live 12, « Arrangement View ») ───
// Les clips des pistes `ids` sont coupés aux bornes a et b (splitClip) ;
// rend ceux qui sont entre les deux. a === b : une seule coupe.
export function splitRange(p, ids, a, b, uid) {
  const on = new Set(ids);
  for (const x of [a, b]) for (const c of p.clips.filter((y) => on.has(y.track))) splitClip(p, c, x, uid);
  // (à moins d'une double-croche d'une borne, un clip n'a pas été coupé : il compte comme dedans)
  return p.clips.filter((c) => on.has(c.track) && c.start >= a - MIN_LEN && c.start + c.len <= b + MIN_LEN
    && (b - a < 1e-6 || (c.start < b - 1e-6 && c.start + c.len > a + 1e-6)));
}
// la même chose sans toucher au projet : des copies de ce que la plage
// contient (le presse-papiers, dupliquer la plage), chacune avec son propre
// id (un morceau que rien ne coupe garderait celui de l'original : le serveur
// refuse un clip en double)
export function piecesIn(p, ids, a, b, uid) {
  const on = new Set(ids);
  const clips = p.clips.filter((c) => on.has(c.track) && c.start < b - 1e-6 && c.start + c.len > a + 1e-6).map((c) => JSON.parse(JSON.stringify(c)));
  return splitRange({ tracks: p.tracks, bpm: p.bpm, clips }, ids, a, b, uid).map((c) => ({ ...c, id: uid('c') }));
}

// ── couper, rogner ──────────────────────────────────────────
// `off` d'un clip de motif est en noires (où en est le motif), celui d'un
// clip audio en secondes (où en est le son)
// Aucun morceau sous la double-croche : le serveur refuse un clip plus court
// (server/tools/music.py, « longueur de clip ») — une coupe sans aimant tout
// près d'un bord n'a pas lieu.
const MIN_LEN = 0.0625;
export function splitClip(p, c, pos, uid) {
  if (pos < c.start + MIN_LEN - 1e-9 || pos > c.start + c.len - MIN_LEN + 1e-9) return null;
  const tr = p.tracks.find((t) => t.id === c.track);
  const cut = pos - c.start;
  const n = { ...c, ...own(c), id: uid('c'), start: pos, len: c.len - cut };
  n.off = tr?.kind === 'audio' ? addAudioOff(c, cut * 60 / p.bpm) : (c.off || 0) + cut;
  if (tr?.kind === 'audio') { n.fi = 0; c.fo = 0; }
  c.len = cut;
  p.clips.push(n);
  return n;
}
// la vitesse de lecture d'un clip audio (sa transposition, lue comme le
// « Re-Pitch » de Live) : `secs` de temps lisent `secs × rate` de son
export const clipRate = (c) => Math.pow(2, (c.pitch || 0) / 12);
function addAudioOff(c, secs) {
  const pos = (c.off || 0) + secs * clipRate(c);
  if (!c.loop || !c.llen) return pos;
  // dans une boucle, la coupe tombe quelque part dans la région qui se répète
  const ls = c.ls ?? (c.off || 0);
  return pos < ls + c.llen ? pos : ls + ((pos - ls) % c.llen);
}

// rogner par le bord gauche : le clip commence plus tard, son contenu reste en place
export function trimStart(p, c, d) {
  d = Math.max(-c.start, Math.min(c.len - 0.0625, d));
  const tr = p.tracks.find((t) => t.id === c.track);
  if (tr?.kind === 'audio') {
    // rogner le début : le marqueur de début avance dans le son d'autant de
    // son que le temps retiré en lit ; le son reste calé dans le temps
    const rate = clipRate(c);
    if (c.loop && c.ls === undefined) c.ls = c.off || 0;
    if ((c.off || 0) + d * 60 / p.bpm * rate < 0) d = -(c.off || 0) / rate * p.bpm / 60;
    c.off = d > 0 ? addAudioOff(c, d * 60 / p.bpm) : Math.max(0, (c.off || 0) + d * 60 / p.bpm * rate);
  } else {
    // le motif se répète : on le lit modulo sa longueur
    const pat = p.patterns.find((x) => x.id === c.pat), plen = pat ? pat.steps / 4 : 4;
    c.off = ((((c.off || 0) + d) % plen) + plen) % plen;
  }
  c.start += d; c.len -= d;
  return d;
}
