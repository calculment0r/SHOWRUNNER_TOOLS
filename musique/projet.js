// MUSIQUE — le projet : sa forme (version 2), la migration d'un projet
// d'avant, l'historique (annuler / rétablir) et les opérations
// d'arrangement qui touchent plusieurs choses à la fois (une section avec
// ses clips et ses courbes, le presse-papiers).
//
// Version 2, ce qui s'ajoute à la version 1 (docs/etudes/musique.md) :
//   key       { tonic 0..11, mode }             la tonalité de la session
//   sections  [{ id, name, a, b, color, tag }]  la règle des sections (en noires)
//   markers   [{ id, b, name }]                 les marqueurs
//   arc       { on, to: lpf|vol|both, pts }     l'arc d'énergie peint (0..1)
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
// docs/etudes/odio_session.md) — le lanceur de clips de Live :
//   scenes    [{ id, name, bpm, color }]   les lignes de la grille, dans l'ordre ;
//               un nom vide montre le numéro ; `bpm` : le tempo que la scène pose
//   slots     [{ id, track, scene, len, … }]  un clip de Session : une case
//               (une piste × une scène, une seule par case), qui boucle sur `len`
//               noires ; les champs d'un clip de l'arrangement (pat, off ; item,
//               off, gain, pitch, rev ; name, color), sans `start` ; + mode
//               (trigger, gate, toggle, repeat : Live, « Launch Modes ») et q (sa
//               quantification ; absente : la globale)
//   launch    { q }   la quantification globale du lancement (QUANTS, ci-dessous)

import { guessTag } from './modules.js';

export const VERSION = 2;
const own = (c) => (c.gen ? { gen: JSON.parse(JSON.stringify(c.gen)) } : {});   // une copie de région a ses propres prises

export function migrate(p) {
  for (const k of ['pending', 'patterns', 'clips', 'cables', 'modules', 'tracks']) p[k] = p[k] || [];
  p.sections = p.sections || [];
  p.markers = p.markers || [];
  p.auto = p.auto || [];
  p.arc = p.arc || { on: true, to: 'lpf', pts: [] };
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
  // mesure de quantification (le défaut de Live)
  if (!Array.isArray(p.scenes)) p.scenes = Array.from({ length: 8 }, (_, i) => ({ id: `sc${i + 1}`, name: '' }));
  p.slots = Array.isArray(p.slots) ? p.slots : [];
  if (!p.launch || !QUANT_OF[p.launch.q]) p.launch = { q: '1' };
  p.v = VERSION;
  return p;
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

export const slotAt = (p, tid, sid) => (p.slots || []).find((s) => s.track === tid && s.scene === sid) || null;
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
// sous `apres`, avec une copie de chaque clip qui joue (`joue` : piste → id)
export function capturerScene(p, joue, apres, uid) {
  const i = apres ? p.scenes.findIndex((x) => x.id === apres) + 1 : p.scenes.length;
  const sc = insererScene(p, i, uid);
  for (const [tid, id] of joue) {
    const s = p.slots.find((x) => x.id === id);
    if (s && p.tracks.some((t) => t.id === tid)) p.slots.push(copieSlot(s, uid, { scene: sc.id, track: tid }));
  }
  return sc;
}

// Une scène dans l'arrangement, à `at` (en noires) : chaque clip de la ligne
// y devient des clips d'arrangement bout à bout, autant de tours qu'il en faut
// pour remplir la scène (sa longueur : le plus long de ses clips) — ce que la
// scène joue, lancée seule. Rend les clips posés et la longueur.
export function sceneVersArrangement(p, sid, at, uid) {
  const ss = p.slots.filter((s) => s.scene === sid && p.tracks.some((t) => t.id === s.track));
  const len = Math.max(0, ...ss.map((s) => s.len));
  const made = [];
  for (const s of ss) {
    for (let a = 0; a < len - 1e-9; a += s.len) {
      const { id, scene, mode, q, color, ...c } = JSON.parse(JSON.stringify(s));
      made.push({ ...c, id: uid('c'), start: at + a, len: Math.min(s.len, len - a) });
    }
  }
  p.clips.push(...made);
  return { made, len };
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
  slots: ['clip de Session', 'clips de Session'], scenes: ['scène', 'scènes'],
};
const WHAT = {
  bpm: 'le tempo', sig: 'la mesure', key: 'la tonalité', loop: 'la boucle', arc: 'l’arc d’énergie', name: 'le nom du projet',
  banc: 'le banc (attracteurs)', nodal: 'le nodal', clips: 'les clips', tracks: 'les pistes', modules: 'les instruments et effets',
  cables: 'les câbles', sections: 'les sections', markers: 'les marqueurs', patterns: 'les motifs', auto: 'l’automation', presets: 'les préréglages',
  groups: 'les groupes de pistes', slots: 'les clips de Session', scenes: 'les scènes', launch: 'la quantification du lancement',
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
        if (k === 'tracks' && ch.length === 1) return `modifier la piste « ${ch[0].name} »`;
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
// console (c.send), ni les câbles typés des jouets (c.t).
export const deSon = (c) => !c.t && typeof c.send !== 'number';
const TRAJ = { p: null, sig: '', v: null };
export function trajets(p) {
  const sig = `${p.tracks.map((t) => `${t.id}:${t.src}:${t.strip}`).join('|')}#${p.cables.map((c) => (deSon(c) ? `${c.a}>${c.b}` : '')).join(',')}`;
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
  for (const t of p.tracks) {
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
/** Les pistes dont la chaîne passe par ce module (0, 1 ou plusieurs). */
export const pistesDuModule = (p, id) => trajets(p).de.get(id) || [];

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
const curves = (p) => [p.arc?.pts || [], ...(p.auto || []).map((L) => L.pts || [])];
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
