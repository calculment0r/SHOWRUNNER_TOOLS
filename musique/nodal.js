// MUSIQUE — la vue Nodal, portée du canvas d'ODIO_01 (calculment0r/ODIO_01
// @ 6d8a7ed : apps/studio/src/App.tsx, components/Tile.tsx, Ports.tsx,
// BoundsHandles.tsx, TeinteBtn.tsx, MachineDesignPanel.tsx, Seuils.tsx), de
// React vers le DOM, en gardant sa logique (docs/etudes/musique_odio01.md
// tient l'inventaire, musique/PROVENANCE.md ce qui change) :
//
//   - une TUILE par bloc : un module, une section de machine, un bloc sans son
//     (clavier, séquenceur) ; en-tête glissé = déplacer (toute la sélection,
//     tout le groupe, toute la machine soudée), ⌥ glissé = dupliquer, arêtes
//     et coins = redimensionner avec les voisins collés, double-clic sur
//     l'en-tête = taille d'origine, sur le nom = renommer ; aimantation
//     aux arêtes des voisines (⌥ la libère le temps d'un geste ; « Aimant »
//     dans la barre, au clic droit du fond ou Ctrl+4 l'éteint pour de bon) ;
//     l'étiquette d'une piste se glisse comme l'en-tête de son nœud ;
//   - la souris (Cal, 29/09) : clic gauche = choisir, Maj+clic = ajouter,
//     Ctrl/⌘+clic = ajouter ou retirer (⌥ retire, comme ODIO_01) ; glisser le
//     fond = rectangle de sélection, avec les mêmes touches ; bouton du milieu
//     glissé = se déplacer, PARTOUT sauf sur les réglages d'une tuile, où il
//     TRACE l'ordre d'exposition (le tracé d'ODIO_01, MachinePanel.tsx
//     `tracerOrdre`) : l'ordre de la traversée décide ce que la tuile garde au
//     zoom sémantique ; molette = zoom ancré, double-clic = le catalogue ; G
//     grouper / dégrouper, T ranger (la machine se remonte, un bloc seul
//     reprend sa taille, sinon on redresse sans réordonner), F cadrer, Suppr
//     retirer (le câblage se recoud, chaîne par chaîne) ; clic droit : le menu
//     de ce qu'on survole (commun/menu.js), jamais celui du navigateur ;
//   - les pistes : le nœud de départ d'une piste (sa source) porte sa couleur
//     et son nom, à taille d'écran constante ; les câbles de sa chaîne ont sa
//     couleur ; la couleur se change d'un geste, ici ou sur la piste ;
//     un câble tiré d'un nœud d'une piste vers un effet qu'une autre piste
//     traverse le fait entrer dans cette chaîne aussi (projet.js) ;
//   - les câbles partent des bornes et se lâchent SUR le bloc visé (cadre vert
//     ou rouge avant de lâcher) ; lâchés dans le vide : la liste rapide, le
//     bloc naît branché ; clic droit : saut ou insertion ;
//   - le ZOOM SÉMANTIQUE par la taille apparente : chaque tuile se met en page
//     à l'échelle où on la voit, et de loin il reste ce qui fait le son
//     (molettes, pads, courbes) — pas les titres. Sous le plancher de
//     lisibilité, la tuile garde sa mise en page et rapetisse ;
//   - en bas, le banc (banc.js) : ses attracteurs captent les tuiles et
//     agissent sur le son pendant la lecture (machines/influence.js).
//
// Pour la fluidité (mesurée, docs/etudes/musique_odio01.md) : le monde est UN
// calque transformé (translate + scale), déplacer la vue ne touche à rien
// d'autre ; les tuiles sont gardées par identifiant et ne se remettent en page
// que quand leur taille, leur échelle apparente ou leurs valeurs changent.
//
// Les points d'accroche des jouets (musique/jouets/, marqués « jouets : »)
// sont gardés : leurs cartes, leurs ports typés, leurs câbles, leur boucle.

import { toast } from '../commun/shell.js';
import { brancherCanvas } from '../commun/molette.js';
// le nodal peut être dans sa fenêtre (un 2ᵉ écran) : docs/etudes/fenetres.md § 6
import { $ as $partout, partout, suivreTaille, elementAuPoint } from '../commun/fenetre.js';
import { MODULES, COLORS, COLOR_FR, spec, val, drumVoicesOf, moduleName } from './modules.js';
import { el, knob, choice, put, menu, letter, inlineEdit } from './ui.js';
import { trajets, recoudre, entrerDansLaChaine } from './projet.js';   // le graphe du son : les chaînes des pistes, lues dans les câbles
import { createBench } from './banc.js';
import { portsOf } from './jouets/index.js';   // jouets : leurs ports « notes » et « valeur », les mêmes pour les machines
import { beginDrag } from './machines/interaction/drag.js';
import { ALL_EDGES, EDGE_CURSOR, horizontalOf, verticalOf, isDrag } from './machines/interaction/gesture.js';
import { SNAP_DISTANCE, snapBox, snapValue, edgesOn, resizeCoupled, dividerAt, moveDivider, boundsOf, listDividers, tidyGroup, intersects, rectFrom } from './machines/interaction/layout.js';
import { minDe, scaleEnsemble } from './machines/interaction/ensemble.js';
import { portAt, nearestPort, PORT_HOME, CABLE_SNAP } from './machines/interaction/ports.js';
import { duplicateLinks, nextJumpColor } from './machines/interaction/patch.js';
import { touching, autoJumpColor } from './machines/interaction/sauts.js';
import { lier as lierBouts, delier, retourner, trameDe, propager, sortieDuBord } from './machines/interaction/liens-knob.js';
import { COMPUTER_KEYS } from './machines/interaction/clavier-ordinateur.js';
import { MIN_K, zoomAt as zoomCamera, plancherCamera } from './machines/canvas/camera.js';
import { sharedBorders, tileBody, MIN_TILE } from './machines/tile/shape.js';
import { TILE_NAME_FONT, TILE_NAME_SPACING, CARD_NAME_SPACING, TILE_SUB_FONT, TILE_SUB_SPACING, nomDeCarte, engrave, measureText, onFontsReady } from './machines/tile/measure.js';
import { wireD, wireAt } from '../commun/wire.js';   // le dessin commun des fils (Idéation s'en sert) — et commun/wire.css
import { minLegibleSize, minScaleFor } from './machines/tile/legible.js';
import { getTuning, onTuning } from './machines/design/tuning.js';
import { onMachineConfig, saveMachineLayout, clearMachineLayout, machineRetouches, clearRetouches } from './machines/design/machines-config.js';
import { isWeldedGroup, placesDeMachine, MIN_SECTION } from './machines/blocks/machines.js';
import { AGENCEMENTS_VERSION } from './machines/blocks/agencements.js';
import { BLOCKS } from './machines/blocks/registry.js';
import {
  onPlanchers, getSeuilSemantique, setSeuilSemantique, getPresenceRelative, setPresenceRelative,
  getPlanchers, setPlancher, resetPlanchers, getMargeBord, setMargeBord, getEcartElements, setEcartElements,
} from './machines/blocks/planche.js';
import { rendreCorps, descripteurDe, formatValue, resolveBody, promotedName, groove, touches, valeur as depuisNorme } from './machines/corps.js';
import { rendrePanneau } from './machines/panneau.js';
import {
  CELL, tuilesDe, porteurDeTuile, ecrireBoite, tailleDOrigine, machineDef, moteurDe, descripteursDe, sectionTrouvee,
  valeursDeSection, poserControle, pousserTout, VOIX_DES_PANNEAUX, phraseDeMachine, idSection, ensembleSoude,
  sectionsPosees, sectionPorteuse, recalerPorteur, TYPE_DE_VOIX, PISTE_DE_VOIX,
} from './machines/tuiles.js';
import { liensDe, jouerNotes } from './machines/liens.js';
import { ouvrirCatalogue, ouvrirPalette } from './machines/catalogue.js';
import { ouvrirPlano, installerGabaritsDu } from './machines/plano.js';
import { attracteursActifs, blocsDInfluence } from './machines/influence.js';

// le style du nodal : ses tuiles, ses câbles, ses machines (musique/nodal.css) —
// posé par index.html avant tout dessin (ses jetons nommés, --nd-*, sont lus
// par les dessins sur canvas, ui.js `tok`) ; ici pour une page qui ne l'aurait pas
if (!document.querySelector('link[href$="nodal.css"]')) {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./nodal.css', import.meta.url).href;
  document.head.append(l);
}

const NS = 'http://www.w3.org/2000/svg';
const GRIP = 6;                 // Tile.tsx
const FIT_MARGIN = 3;
const MIN_TEXT_TILE = 7;
// les teintes d'un ensemble : les jetons du portail, sans l'orange (l'action)
// — TeinteBtn.tsx en avait quinze en dur
const TEINTES = ['amb', 'coral-1', 'coral-2', 'coral-3', 'cy', 'grn', 'grn2', 'verd-1', 'verd-2', 'verd-3', 'verd-4', 'verd-5', 'ink2', 'ink3'];
// nos effets d'ODIO portent le bloc d'ODIO_01 du même nom (blocks/registry.js)
const REGISTRE = { filtre: 'filtre', satura: 'drive', comp3: 'comp', rtt: 'delay', reverbe: 'reverb', eq3: 'eq', crush: 'crush', chorus: 'chorus', rythme: 'rythme', drums: 'rythme' };
// ce qui se joue en notes (liens.js, music_jouets.py NOTES_IN)
const SONS = new Set(['drums', 'synth', 'sampler', 'rythme', 'analog', 'acid', 'plaits']);
const rails = (ids, w) => ids.map((id) => ({ id: `p:${id}`, min: { w, h: 19 }, grow: true, max: 26 }));
// la console : un vumètre, puis les réglages (le « vu » d'ODIO_01 est une section de machine)
const CONSOLE = (ids) => ({
  bande: [{ id: 'vu', min: { w: 40, h: 6 }, grow: true, max: 12 }, ...rails(ids, 170)],
  colonne: [{ id: 'vu', min: { w: 6, h: 24 }, minRatio: 0.3, grow: true }, { id: 'faders', min: { w: 14, h: 56 }, grow: true }],
  pave: [{ id: 'vu', min: { w: 30, h: 6 }, grow: true, max: 12 }, ...rails(ids, 112)],
});
// le CLAVIER d'ODIO_01 (rack.ts) : octave, vélocité, durée
const CLAVIER = [
  { id: 'octave', label: 'octave', min: -3, max: 3, default: 0, unit: '', curve: 'linear' },
  { id: 'velocite', label: 'vélocité', min: 0.05, max: 1, default: 0.8, unit: '', curve: 'linear' },
  { id: 'duree', label: 'durée', min: 0.05, max: 2, default: 0.4, unit: 's', curve: 'linear' },
];
const h = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const sv = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const px = (v) => `${v}px`;
/** Tile.tsx, `ledSize` : borné par la hauteur de l'en-tête ET par sa largeur. */
function ledSize(head, largeur = Infinity) {
  const parH = Math.min(getTuning().ledMax ?? 9, Math.round(head * 0.48));
  return Math.max(4, Math.min(parH, Math.max(4, Math.floor(largeur / 3))));
}
/**
 * Un fil : la courbe commune du portail (commun/wire.js, celle du nodal
 * d'avant et d'Idéation) — elle part à l'horizontale d'une sortie et arrive à
 * l'horizontale d'une entrée. SHOWRUNNER (29/09) : au lieu de la cubique
 * d'ODIO_01 (Ports.tsx, `cablePath`) ; son épaisseur, ses tirets et ses
 * étiquettes restent en pixels d'écran (nodal.css, --iz).
 */
const cablePath = (a, b) => wireD([a.x, a.y], [b.x, b.y]);

export function createNodal(app) {
  const { S } = app;
  const P = () => S.proj;
  // le nodal se voit : c'est la vue de la page, ou il est dans sa fenêtre (musique.js, app.nodalDetache)
  const vueNodal = () => S.view === 'nodal' || !!app.nodalDetache?.();
  const nodalDe = (p = P()) => (p.nodal = p.nodal || {});
  const reglage = (cle) => (nodalDe()[cle] = nodalDe()[cle] || {});

  // ── le DOM ──
  const root = el('section', { class: 'nd', 'aria-label': 'nodal' });
  const cv = el('div', { class: 'nd-canvas ndx-vue', tabindex: '-1' });
  const world = el('div', { class: 'nd-world ndx-monde' });
  const cadresEl = h('div', 'ndx-cadres');
  const saisie = sv('svg', { class: 'ndx-saisie', 'aria-hidden': 'true' });
  const tuilesEl = h('div', 'ndx-tuiles');
  const cablesSvg = sv('svg', { class: 'ndx-cables', 'aria-hidden': 'true' });
  const bornesEl = h('div', 'ndx-bornes');
  const dessusEl = h('div', 'ndx-dessus');
  world.append(cadresEl, saisie, tuilesEl, cablesSvg, bornesEl, dessusEl);
  const liensSvg = sv('svg', { class: 'ndx-liens', 'aria-hidden': 'true' });
  const tools = el('div', { class: 'nd-tools ndx-outils' });
  const zoomBox = el('div', { class: 'nd-zoom ndx-zoom' });
  const hint = el('div', { class: 'nd-hint lbl' });
  const side = el('aside', { class: 'nd-side' });
  const ecran = h('div', 'ndx-ecran');           // les panneaux en espace écran (seuils)
  cv.append(world, liensSvg, ecran, tools, zoomBox, hint);

  // ── la caméra : { z, px, py } dans le projet (le format que lisent les jouets) ──
  const view = () => {
    const u = (P().ui = P().ui || {});
    if (!u.nodal || typeof u.nodal.z !== 'number') u.nodal = { z: 0.8, px: 40, py: 40, fitted: u.nodal?.fitted };
    return u.nodal;
  };
  // L'AIMANT (Cal, 29/09 : « j'arrive pas à enlever le magnétisme et
  // l'alignement sur la grille… il nous faut l'option quelque part et en clic
  // droit ») : l'état d'interface du projet, comme l'aimant de l'arrangement
  // (ui.snap, Ctrl+4) ; absent = allumé. Il n'y a qu'un aimant dans le nodal :
  // les arêtes des voisines (layout.js snapBox, snapValue — jointure et
  // alignement, les guides orange n'en sont que le tracé) ; la trame du fond
  // n'aimante rien. Il ne touche ni à la soudure des machines (un ensemble
  // soudé se déplace entier, par son groupe) ni au couplage des voisines
  // collées au redimensionnement (le séparateur : ⌥ le défait, comme avant).
  const aimante = () => P()?.ui?.aimantNodal !== false;
  function basculerAimant(on = !aimante()) {
    const u = (P().ui = P().ui || {});
    u.aimantNodal = !!on;
    app.saveUi();
    peindreOutils();
    toast(on ? 'aimant : les blocs se collent aux arêtes de leurs voisins' : 'libre : rien ne s\'aimante (Ctrl+4 le rallume)', 1600);
  }
  const cam = () => { const v = view(); return { x: -v.px / v.z, y: -v.py / v.z, k: v.z }; };
  const poserCam = (c) => { const v = view(); v.z = c.k; v.px = -c.x * c.k; v.py = -c.y * c.k; };
  const versMonde = (cx, cy) => { const r = cv.getBoundingClientRect(), v = view(); return { x: (cx - r.left - v.px) / v.z, y: (cy - r.top - v.py) / v.z }; };

  // ── l'état du canvas (App.tsx) ──
  let T = [], parId = new Map();
  const vues = new Map();
  let sel = [];
  let guides = [], marquee = null, busy = null, cabling = null;
  let machinePanel = null, prisDansBloc = null;
  let plancher = MIN_K;
  let hoverCable = null, hoverJump = null;
  let lienPris = null, boutSurvole = null, lienEnCours = null;
  let seuilsOuvert = false;
  let held = [];
  let influ = new Map(), influSig = '';
  let actif = false;
  let gabaritsDe = null;
  const meters = [];      // [module, élément, grand chiffre ?, tuile ?]

  const bench = createBench(app, {
    cv, world, view: () => view(),
    tuiles: () => T,
    box: (id) => parId.get(id) || null,
    porteur: (id) => porteurDeTuile(P(), id).owner,
  });
  root.append(el('div', { class: 'nd-main' }, cv, bench.el), side);
  app.toys?.attach({ cv, world, view, zNet: () => zNet ?? view().z, paintSide: () => paintSide(), paintWires: () => peindreCables() });   // jouets : leurs câbles typés, les billes de la fontaine

  // ═════════════════════════════════════════ les tuiles, lues dans le projet
  // la piste dont cette tuile est le nœud de DÉPART (sa source ; une machine-instrument : chacune de ses sections)
  function pisteDeDepart(t) {
    if (t.bloc) return null;
    const m = app.mod(t.mod), tr = m?.track && app.track(m.track);
    return tr && tr.src === m.id ? tr : null;
  }
  function lireTuiles() {
    T = tuilesDe(P(), MODULES).map((t) => {
      const tr = pisteDeDepart(t);
      if (tr) { t.piste = tr.id; t.pc = tr.color; }
      const def = MODULES[t.type];
      if (t.bloc || !def?.jouet) return t;
      // jouets : leur carte a la taille de leur scène (jouets/defs.js)
      const m = app.mod(t.mod);
      return { ...t, jouet: true, x: m.x ?? 0, y: m.y ?? 0, w: app.toys?.width(m) || def.w || 236, h: vues.get(t.id)?.hMesure || def.h || 200 };
    });
    parId = new Map(T.map((t) => [t.id, t]));
    return T;
  }
  const porteurDe = (id) => porteurDeTuile(P(), id).owner?.id || id;
  // L'ACCENT d'une tuile (--k), comme celui des cartes d'avant (4a20f41,
  // `accentOf`) : la couleur de sa piste, sinon celle de son module, sinon
  // l'acier. Il colore son témoin, ses molettes, ses curseurs, sa sortie, ses fils.
  function accentDe(t) {
    if (!t) return 'cy';
    if (t.pc) return t.pc;
    const { owner } = porteurDeTuile(P(), t.id);
    if (!owner) return 'cy';
    const tr = owner.track && app.track(owner.track);
    if (tr?.color) return tr.color;
    return MODULES[owner.type]?.color || 'cy';
  }
  const expose = (id) => reglage('expose')[id] ?? null;
  // l'ordre d'exposition TRACÉ au bouton du milieu (tracerOrdreTuile) : ce que la tuile garde en dézoomant
  const ordreDe = (id) => P().nodal?.ordre?.[id] || null;
  const partage = (id) => reglage('split')[id] ?? null;

  // la tuile qui porte les prises d'un porteur (la section porteuse pour une machine)
  function tuileDesPrises(pid) {
    const { owner } = porteurDeTuile(P(), pid);
    if (!owner) return null;
    if (owner.mach) { const s = sectionPorteuse(owner); return s ? parId.get(idSection(owner.id, s)) : null; }
    return parId.get(owner.id) || null;
  }
  // ce qu'une tuile montre comme bornes : { in, out } parmi 'audio', 'notes'
  function prisesDeTuile(t) {
    const { owner, sec } = porteurDeTuile(P(), t.id);
    if (!owner) return {};
    if (owner.mach) {
      if (sec !== sectionPorteuse(owner)) return {};
      const v = moteurDe(owner.mach.id)?.voice;
      if (v === 'notes') return { out: 'notes' };
      if (!v) return {};
      if (['delay', 'reverb', 'comp'].includes(v)) return { in: 'audio', out: 'audio' };
      return { out: 'audio' };           // les notes entrent par le port des jouets (losange)
    }
    if (t.bloc) return owner.type === 'clavier' ? { out: 'notes' } : {};
    const def = MODULES[owner.type];
    if (!def) return {};
    if (def.jouet) return { in: def.ins?.includes('audio') ? 'audio' : null, out: def.outs?.includes('audio') ? 'audio' : null };
    switch (def.role) {
      case 'source': return { out: 'audio' };
      case 'master': return { in: 'audio' };
      default: return { in: 'audio', out: 'audio' };
    }
  }
  const emetNotes = (pid) => { const t = tuileDesPrises(pid); return !!t && prisesDeTuile(t).out === 'notes'; };

  // ── ce qu'une tuile montre et règle ──
  const jumeaux = new Map();
  let ctxJumeau = null;
  function jumeau(m) {
    const def = MODULES[m.type];
    if (!def?.cls) return null;
    let j = jumeaux.get(m.id);
    if (!j || j.type !== m.type) {
      try { ctxJumeau = ctxJumeau || new OfflineAudioContext(2, 128, 48000); j = { type: m.type, fx: new def.cls(ctxJumeau) }; jumeaux.set(m.id, j); } catch { return null; }
    }
    for (const s of def.params) { try { j.fx.setParameter(s.k, val(m, s.k)); } catch { /* un réglage que le jumeau ignore */ } }
    return j.fx;
  }
  function infoTuile(t) {
    const p = P(), { owner, sec } = porteurDeTuile(p, t.id);
    if (!owner) return null;
    const noms = reglage('noms');
    if (sec && owner.mach) {
      const reg = BLOCKS[sec], section = sectionTrouvee(sec);
      if (!section) return null;
      const son = p.modules.includes(owner);
      return {
        owner, sec, section, def: reg || { layout: null, surface: null }, nom: noms[t.id] || reg?.name || sec.toUpperCase(), court: noms[t.id] || reg?.short || sec.slice(0, 4).toUpperCase(),
        parametres: descripteursDe(sec), valeurs: valeursDeSection(owner, sec), power: false, enabled: owner.on !== false,
        onParam: (id, v) => { const r = poserControle(owner, sec, id, v); if (r && son) app.commit('param', owner); else app.commit('quiet'); rafraichirApres(t.id); },
      };
    }
    if (t.bloc) {
      if (owner.type !== 'clavier') return null;
      const valeurs = {};
      for (const d of CLAVIER) valeurs[d.id] = owner.params?.[d.id] ?? d.default;
      return { owner, def: BLOCKS.clavier, nom: noms[t.id] || 'Clavier', court: noms[t.id] || 'Clav', sous: 'notes', parametres: CLAVIER, valeurs, power: true, enabled: owner.on !== false,
        onParam: (id, v) => { owner.params = owner.params || {}; owner.params[id] = id === 'octave' ? Math.round(v) : v; app.commit('quiet'); rafraichirApres(t.id); } };
    }
    const m = owner, def = MODULES[m.type];
    if (!def || def.jouet) return null;
    const specs = def.params.filter((s) => (m.type !== 'drums' || s.k === 'lvl') && (m.type !== 'rythme' || !s.k.includes('.')));
    const tous = m.type === 'rythme' ? def.params : specs;   // la boîte à rythme : les réglages de voix vont au groove
    const reg = REGISTRE[m.type] ? BLOCKS[REGISTRE[m.type]] : ['strip', 'master', 'bus'].includes(def.role) ? { layout: CONSOLE(specs.map((s) => s.k)), surface: null } : null;
    const tr = m.track && app.track(m.track);
    // SHOWRUNNER (29/09, le thème du portail) : une carte dit son nom comme les
    // cartes d'avant (4a20f41) — le module, en bas de casse, et à droite sa piste
    const nom = noms[t.id] || def.name;
    const sous = tr ? tr.name : def.role === 'master' ? 'sortie' : def.role === 'bus' ? 'bus' : def.kind || '';
    return {
      owner: m, def: reg, nom, sous, court: noms[t.id] || nom.slice(0, 4), parametres: tous.map(descripteurDe),
      valeurs: Object.fromEntries(tous.map((s) => [s.k, val(m, s.k)])), power: def.role !== 'master', enabled: m.on !== false,
      twin: reg?.surface ? jumeau(m) : null,
      onParam: (id, v) => { m.params = m.params || {}; m.params[id] = v; app.commit('param', m); if (S.sel.mod === m.id) paintSideParams(); rafraichirApres(t.id); },
    };
  }

  // ═════════════════════════════════════════════ le plancher de lisibilité
  // App.tsx, `zoomFloor` : la plus petite échelle à laquelle CHAQUE tuile montre
  // encore son nom, le nom de son réglage exposé et sa valeur — jamais plus que
  // l'échelle qui fait tenir la scène, jamais au-dessus de 1.
  function calculerPlancher() {
    let f = MIN_K;
    for (const t of T) {
      if (t.jouet) continue;
      const info = infoTuile(t);
      if (!info) continue;
      const d = info.parametres.find((q) => q.id === expose(t.id));
      const valeurTexte = d ? formatValue(d, info.valeurs[d.id] ?? d.default) : '';
      // le plancher se mesure comme chez ODIO_01 (tile/legible.js, le nom en mono) : l'habit ne le déplace pas
      f = Math.max(f, minScaleFor(t, minLegibleSize(info.court, d?.label ?? null, valeurTexte)));
    }
    const b = T.length ? boundsOf(T) : null;
    if (b && b.w > 0 && b.h > 0 && cv.clientWidth > 0) {
      const fit = Math.min((cv.clientWidth - 80) / b.w, (cv.clientHeight - 80) / b.h);
      if (Number.isFinite(fit) && fit > 0) f = Math.min(f, fit);
    }
    plancher = Math.min(1, f);
  }
  // l'échelle à laquelle l'INTERFACE se met en page (App.tsx, `uiK`)
  const uiK = () => Math.max(view().z, plancher);

  // ═══════════════════════════════════════════════════════ une tuile (Tile.tsx)
  function construire(t) {
    const e = h('div', 'nd-card tile');
    e.dataset.id = t.id; e.dataset.block = t.id;
    const mise = h('div', 'tile__mise');
    e.append(mise);
    // en capture : les réglages arrêtent la propagation pour leur propre geste
    e.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      const mode = modeDe(ev);
      if (mode === 'remove' && ev.target.closest('.grip, .tile__head')) return;   // ⌥ glissé sur l'en-tête : dupliquer
      choisirAuClic(ev, t.id, mode);
    }, true);
    const vue = { el: e, mise, L: 0, sig: '', type: t.type, sale: true, id: t.id };
    const { owner } = porteurDeTuile(P(), t.id);
    // jouets : leurs ports « notes » et « valeur » sur un module d'ici (une section de machine : c'est l'ancre de sa machine qui les porte)
    if (owner && !t.bloc && !t.sec) app.toys?.decorate(owner, e, e);
    return vue;
  }
  function placer(vue, t) {
    const s = vue.el.style;
    s.left = px(t.x); s.top = px(t.y); s.width = px(t.w);
    if (!t.jouet) s.height = px(t.h);
    // le nœud de départ d'une piste : sa couleur (nodal.css, .tile--piste)
    vue.el.classList.toggle('tile--piste', !!t.pc);
    if (t.pc) s.setProperty('--pc', `var(--${t.pc})`); else s.removeProperty('--pc');
    // une carte (un bloc) ou une section de machine : deux en-têtes (nodal.css)
    vue.el.classList.toggle('tile--section', !!t.sec);
    vue.el.classList.toggle('tile--carte', !t.sec);
    s.setProperty('--k', `var(--${accentDe(t)})`);
    vue.el.classList.toggle('tile--courante', !!t.piste && t.piste === S.sel.track);
  }
  function grooveSig(m) {
    const tr = m?.track && app.track(m.track), pat = tr && app.pat(tr.pat);
    return pat ? JSON.stringify(pat.lanes || {}) + reglage('voix')[m.id] : '';
  }
  // une voisine collée à gauche, en haut (sharedBorders ne dit que la droite et le bas) : les coins d'une coque
  function voisins(t) {
    const autres = T.filter((o) => o.id !== t.id && !o.jouet);
    return [autres.some((o) => !sharedBorders(o, [t]).right) ? 1 : 0, autres.some((o) => !sharedBorders(o, [t]).bottom) ? 1 : 0];
  }
  function signature(t, info) {
    const b = sharedBorders(t, T.filter((o) => o.id !== t.id && !o.jouet));
    const it = influ.get(t.id);
    return [t.w, t.h, b.right, b.bottom, voisins(t).join(''), accentDe(t), expose(t.id), (ordreDe(t.id) || []).join(','), partage(t.id), info?.enabled, t.teinte, t.pc, info?.nom, info?.sous, machinePanel === info?.owner?.id,
      prisDansBloc?.bloc === t.id ? prisDansBloc.cles.join(',') : '', JSON.stringify(info?.valeurs || {}), it ? JSON.stringify([...it]) : '',
      t.type === 'rythme' || t.type === 'drums' ? grooveSig(info?.owner) : '', t.bloc && info?.owner?.type === 'clavier' ? held.join(',') : ''].join('|');
  }
  const onPromoteDe = (id) => (pid) => { const e2 = reglage('expose'); e2[id] = e2[id] === pid ? null : pid; app.commit('quiet'); rafraichir([id], true); };

  const stats = { tuiles: 0, ms: 0, max: 0 };   // pour les essais : ce que coûte une mise en page
  function peindreTuile(vue, t, L) {
    const t0 = performance.now();
    peindreTuile1(vue, t, L);
    const dt = performance.now() - t0;
    stats.tuiles++; stats.ms += dt; if (dt > stats.max) { stats.max = dt; stats.pire = t.id; }
  }
  function peindreTuile1(vue, t, L) {
    const info = infoTuile(t);
    vue.L = L; vue.sale = false;
    for (let i = meters.length - 1; i >= 0; i--) if (meters[i][3] === t.id) meters.splice(i, 1);
    if (!info) { vue.mise.replaceChildren(); return; }
    const borders = sharedBorders(t, T.filter((o) => o.id !== t.id && !o.jouet));
    const rect = { w: t.w * L, h: t.h * L };
    const m = vue.mise;
    m.style.width = px(rect.w); m.style.height = px(rect.h);
    m.style.transform = `scale(${1 / L})`;
    m.classList.toggle('tile--bd-r', borders.right);
    m.classList.toggle('tile--bd-b', borders.bottom);
    // LES COINS DES CARTES D'AVANT (12 px) : arrondis là où la tuile est libre
    // des deux côtés — les sections soudées d'une machine font une seule coque
    const [gauche, haut] = voisins(t), R = Math.max(2, Math.min(12, Math.round(Math.min(rect.w, rect.h) * 0.12)));
    m.style.borderRadius = [!gauche && !haut, borders.right && !haut, borders.right && borders.bottom, !gauche && borders.bottom].map((libre) => px(libre ? R : 0)).join(' ');
    // la place du corps est celle d'ODIO_01 (tileBody : même en-tête, mêmes filets) :
    // l'habit ne retire aucun réglage au zoom sémantique
    const carte = !t.sec;
    const body = tileBody(rect, borders);
    const narrow = body.w < 112;
    const padX = carte && !narrow ? 10 : narrow ? 4 : 8, gap = narrow ? 4 : 7;
    const led = carte ? Math.min(8, ledSize(body.head, body.w - padX * 2)) : Math.min(7, ledSize(body.head, body.w - padX * 2));
    const nameFont = carte ? nomDeCarte(body.head) : TILE_NAME_FONT, nameSpacing = carte ? CARD_NAME_SPACING : TILE_NAME_SPACING;
    const bw = body.w, bh = body.h;
    const exposedId = expose(t.id), ordre = ordreDe(t.id);
    const valeurs = { ...info.valeurs, ...Object.fromEntries(influ.get(t.id) || []) };
    const slots = resolveBody(bw, bh, info.parametres, info.def, partage(t.id), exposedId, ordre).slots;
    const dExp = info.parametres.find((q) => q.id === exposedId);
    const bodyNames = slots.length === 0 && dExp !== undefined && promotedName(bw, bh, dExp.label).size > 0;
    const headerExposed = !dExp || bodyNames ? null : dExp.label;
    vue.el.classList.toggle('tile--off', !info.enabled);
    vue.el.classList.toggle('tile--influe', influ.has(t.id));

    // l'en-tête : le témoin, le nom et l'exposé — qui défilent au lieu d'être coupés
    const tete = h('div', 'tile__head');
    Object.assign(tete.style, { gap: px(gap), padding: `0 ${padX}px`, height: px(body.head) });
    tete.title = 'Glisser pour déplacer · double-clic pour la taille d\'origine';
    if (info.power) {
      const b = h('button', 'led-btn');
      b.type = 'button';
      b.title = info.enabled ? 'Éteindre ce bloc' : 'Allumer ce bloc';
      const l = h('span', `led led--${!info.enabled ? 'off' : app.engine.running ? 'on' : 'idle'}`);
      l.style.width = px(led); l.style.height = px(led);
      b.append(l);
      b.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      b.addEventListener('click', (ev) => { ev.stopPropagation(); basculer(t.id); });
      tete.append(b);
    }
    const available = body.w - padX * 2 - (led + gap);
    let aDroite = false;
    // l'étiquette de droite (celle des cartes d'avant, .lbl) : le réglage exposé
    const exposedLabel = headerExposed ? engrave(headerExposed) : '';
    const exposedWidth = headerExposed ? measureText(exposedLabel, TILE_SUB_FONT, TILE_SUB_SPACING) : 0;
    const nameWidth = measureText(carte ? info.nom : engrave(info.nom), nameFont, nameSpacing);
    const cluster = nameWidth + (headerExposed ? gap + exposedWidth : 0);
    const fits = available >= cluster + FIT_MARGIN, showText = available >= MIN_TEXT_TILE, scrolling = showText && !fits;
    if (showText) {
      const nom = h('span', 'tile__name');
      nom.textContent = info.nom;
      nom.style.font = nameFont;   // la fonte mesurée est la fonte écrite
      if (!carte) nom.style.letterSpacing = nameSpacing;
      nom.title = 'Double-clic pour renommer';
      nom.addEventListener('dblclick', (ev) => { ev.stopPropagation(); renommer(t.id, nom); });
      let ex = headerExposed ? h('span', 'tile__exposed') : null;
      if (ex) { const s = h('span', 'tile__exposed-label'); s.textContent = exposedLabel; ex.append(s); }
      // sans réglage exposé, la carte dit sa piste à droite, comme les cartes d'avant — si la place le permet
      if (!ex && carte && info.sous && !scrolling) {
        const sous = engrave(info.sous), ws = measureText(sous, TILE_SUB_FONT, TILE_SUB_SPACING);
        if (available >= nameWidth + gap * 2 + ws + FIT_MARGIN) { ex = h('span', 'tile__exposed tile__sous'); const s = h('span', 'tile__exposed-label'); s.textContent = sous; ex.append(s); }
      }
      if (fits && ex) { tete.append(nom, h('span', 'tile__spacer'), ex); ex = null; aDroite = true; }
      else if (scrolling) {
        const shift = available - cluster - FIT_MARGIN;
        const sc = h('span', 'tile__scroll');
        sc.style.setProperty('--shift', px(shift)); sc.style.setProperty('--dur', `${(3 + Math.abs(shift) / 15).toFixed(2)}s`);
        const inner = h('span', 'tile__scroll-inner');
        inner.style.gap = px(gap);
        inner.append(nom, ...(ex ? [ex] : []));
        sc.append(inner);
        tete.append(sc);
      } else tete.append(nom, ...(ex ? [ex] : []));
    }
    if (!aDroite) tete.append(h('span', 'tile__spacer'));
    tete.addEventListener('pointerdown', (ev) => startMove(ev, t.id));
    tete.addEventListener('dblclick', (ev) => { ev.stopPropagation(); resetSize(t.id); });

    // le corps : le rendu d'ODIO_01 (BlockBody, MachinePanel), à l'échelle apparente
    const corps = h('div', 'tile__body');
    const { owner } = info;
    vue.panneau = null;
    rendreCorps(corps, {
      width: bw, height: bh, parameters: info.parametres, values: valeurs, exposed: exposedId, ordre, def: info.def, twin: info.twin, split: partage(t.id), accent: accentDe(t),
      onParam: (id, v) => info.onParam(id, v),
      onPromote: onPromoteDe(t.id),
      onSplit: (v, fin) => {
        if (v === undefined) { if (fin) app.commit('quiet'); return; }
        const s2 = reglage('split');
        if (v === null) delete s2[t.id]; else s2[t.id] = v;
        rafraichir([t.id], true);
        if (v === null) app.commit('quiet');
      },
      renderOwn: (slot, w, hh) => {
        if (slot === 'machine' && info.section) {
          const host = h('div', 'tile__panneau');
          host.style.width = px(w); host.style.height = px(hh);
          vue.panneau = rendrePanneau(host, {
            section: info.section, width: w, height: hh, parameters: info.parametres, values: valeurs, exposed: exposedId,
            onParam: (id, v) => info.onParam(id, v),
            onPromote: onPromoteDe(t.id),
            onNote: (note) => strike(t.id, note),
            zoom: L, apparence: L > 0 ? Math.max(view().z, getSeuilSemantique()) / L : 1,
            blocId: t.id, onLienDebut: tirerLien, onLienSurvol: (cle) => { boutSurvole = cle; peindreLiensKnob(); }, onLienValeur: propagerLien,
            composing: machinePanel === owner.id, edition: machinePanel === owner.id,
            selection: prisDansBloc?.bloc === t.id ? prisDansBloc.cles : [],
            blocPris: sel.length === 1 && sel[0] === t.id,
            onSelection: (cles) => { prisDansBloc = cles.length ? { bloc: t.id, cles } : null; rafraichir([t.id], true); },
            worldHeight: t.h,
          });
          return host;
        }
        if (slot === 'groove') return grooveDe(t, owner, info, valeurs, exposedId, w, hh);
        if (slot === 'touches') {
          const oct = Math.round(owner.params?.octave ?? 0);
          return touches({ first: 48 + oct * 12, held, width: w, height: hh, onDown: (note) => strike(t.id, note) });
        }
        if (slot === 'vu') {
          const mt = h('div', 'ndx-vu');
          mt.style.height = px(hh);
          mt.append(h('i'));
          meters.push([owner.id, mt, null, t.id]);
          return mt;
        }
        return null;
      },
    });

    // les poignées : une seule logique pour tous les modes (App décide selon l'ensemble)
    const grips = ALL_EDGES.map((edge) => {
      const shared = (edge === 'e' && !borders.right) || (edge === 's' && !borders.bottom);
      const g = h('span', shared ? `grip grip--${edge} grip--shared` : `grip grip--${edge}`);
      g.style.cursor = EDGE_CURSOR[edge];
      if (edge.length === 2) { g.style.width = px(GRIP * 2); g.style.height = px(GRIP * 2); } else if (edge === 'n' || edge === 's') g.style.height = px(GRIP); else g.style.width = px(GRIP);
      g.title = shared ? 'Séparateur — glisser pour répartir la place (⌥ pour découpler)' : 'Redimensionner';
      g.addEventListener('pointerdown', (ev) => startResize(ev, t.id, edge));
      return g;
    });
    // la teinte : celle de la PISTE pour son nœud de départ (une seule vérité, t.color), sinon celle de l'ensemble
    const tc = t.pc || t.teinte;
    const teinte = tc ? h('span', t.pc ? 'tile__teinte tile__teinte--piste' : 'tile__teinte') : null;
    if (teinte) teinte.style.background = `var(--${tc})`;
    m.replaceChildren(...(teinte ? [teinte] : []), tete, corps, ...grips);
  }

  // la boîte à rythme : le groove d'ODIO_01 sur le motif de la piste
  function grooveDe(t, m, info, valeurs, exposedId, w, hh) {
    const tr = m.track && app.track(m.track), pat = tr && app.pat(tr.pat);
    if (!pat) return null;
    const voices = drumVoicesOf(m.type);
    const choisie = reglage('voix')[m.id] || voices[0]?.id;
    const steps = Array.from({ length: pat.steps || 16 }, (_, i) => pat.lanes?.[choisie]?.[i] || 0);
    return groove({ voices, steps, parameters: info.parametres, values: valeurs, exposed: exposedId, voice: choisie, playhead: null, width: w, height: hh,
      onParam: (id, v) => info.onParam(id, v),
      onPromote: onPromoteDe(t.id),
      onVoice: (id) => { reglage('voix')[m.id] = id; rafraichir([t.id], true); },
      onToggle: (i, wanted) => {
        pat.lanes = pat.lanes || {};
        if (!pat.lanes[choisie]) pat.lanes[choisie] = Array(pat.steps || 16).fill(0);
        pat.lanes[choisie][i] = wanted ? 0.8 : 0;
        app.commit('quiet');
      } });
  }

  // les cartes des jouets : leur scène, leurs molettes (jouets/index.js décore)
  function carteJouet(t) {
    const m = app.mod(t.mod), def = MODULES[m.type], accent = def.color;
    const box = el('div', { class: `nd-card${m.on === false ? ' off' : ''}`, 'data-id': m.id, 'data-block': m.id, style: { '--k': `var(--${accent})` } });
    const hd = el('div', { class: 'hd' }, el('i', { class: 'dot' }), el('span', { class: 'nm' }, def.name), el('span', { class: 'lbl' }, def.no ? `jouet ${def.no}` : 'jouet'));   // jouets : leur numéro dans le Playground
    const bd = el('div', { class: 'bd' }, (def.face || []).map((k) => {
      const s = spec(m.type, k);
      return knob(s, val(m, k), { size: 'sm', accent, onInput: (v) => { m.params[k] = v; app.commit('param', m); }, onChange: () => { if (S.sel.mod === m.id) paintSideParams(); } });
    }));
    const ft = el('div', { class: 'ft' });
    box.append(hd, bd, ft);
    box.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      choisirAuClic(ev, t.id, modeDe(ev));
    }, true);
    hd.addEventListener('pointerdown', (ev) => startMove(ev, t.id));
    app.toys?.decorate(m, box, hd);   // jouets : la scène sous l'en-tête, les ports notes (losange) et valeur (carré)
    return { el: box, mise: null, L: 1, sig: JSON.stringify(m.params) + m.on, type: t.type, sale: false, id: t.id, jouet: true };
  }

  // les ancres des machines : là où les ports des jouets cherchent le module qui porte le son
  const ancres = new Map();
  function majAncres() {
    const vivants = new Set();
    for (const m of P().modules) {
      if (!m.mach) continue;
      vivants.add(m.id);
      let a = ancres.get(m.id);
      if (!a) { a = h('div', 'nd-card ndx-ancre'); a.dataset.id = m.id; ancres.set(m.id, a); tuilesEl.append(a); app.toys?.decorate(m, a, a); }
      if (!a.isConnected) tuilesEl.append(a);
      recalerPorteur(m);
      Object.assign(a.style, { left: px(m.x), top: px(m.y), width: px(m.w || 60), height: px(m.h || 60) });
    }
    for (const [id, a] of ancres) if (!vivants.has(id)) { a.remove(); ancres.delete(id); }
  }

  // ═══════════════════════════════════════════════════ le rendu, par clés
  function render() {
    const p = P();
    if (!p) return;
    if (gabaritsDe !== p.id) { gabaritsDe = p.id; installerGabaritsDu(p); }
    lireTuiles();
    calculerPlancher();
    for (let i = meters.length - 1; i >= 0; i--) if (meters[i][3] && !meters[i][1].isConnected) meters.splice(i, 1);
    const vus = new Set(), L = uiK();
    for (const t of T) {
      vus.add(t.id);
      let vue = vues.get(t.id);
      if (vue && (vue.type !== t.type || !!vue.jouet !== !!t.jouet)) { vue.el.remove(); vues.delete(t.id); vue = null; }
      if (vue?.jouet) {
        const m = app.mod(t.mod);
        if (JSON.stringify(m.params) + m.on !== vue.sig) { vue.el.remove(); vues.delete(t.id); vue = null; }
      }
      if (!vue) { vue = t.jouet ? carteJouet(t) : construire(t); vues.set(t.id, vue); tuilesEl.append(vue.el); }
      placer(vue, t);
      if (!t.jouet) {
        const sig = signature(t, infoTuile(t));
        if (sig !== vue.sig || Math.abs(vue.L - L) > 1e-4) { vue.sig = sig; vue.sale = true; }
      }
    }
    for (const [id, vue] of vues) if (!vus.has(id)) { vue.el.remove(); vues.delete(id); }
    sel = sel.filter((id) => parId.has(id));
    majAncres();
    miseEnPage(true);
    for (const t of T) if (t.jouet) { const v = vues.get(t.id); const hm = v?.el.offsetHeight; if (hm && hm !== v.hMesure) { v.hMesure = hm; t.h = hm; } }
    classesSelection();
    peindreOutils();
    peindreCables(); peindreBornes(); peindreDessus();
    paintSide();
    bench.render();
    appliquerVue();
    if (!view().fitted) requestAnimationFrame(() => { lireTuiles(); calculerPlancher(); focusOn(true); view().fitted = true; });
  }

  // Remettre en page les tuiles dont l'échelle apparente, la taille ou les
  // valeurs ont changé. `visibles` : celles hors champ attendent d'y entrer.
  function miseEnPage(visibles = true) {
    const L = uiK(), v = view(), W = cv.clientWidth || 1200, H = cv.clientHeight || 800;
    let n = 0;
    for (const t of T) {
      const vue = vues.get(t.id);
      if (!vue || t.jouet) continue;
      if (!vue.sale && Math.abs(vue.L - L) < 1e-4) continue;
      if (visibles && vue.L > 0) {
        const sx = v.px + t.x * v.z, sy = v.py + t.y * v.z;
        if (sx > W + 80 || sy > H + 80 || sx + t.w * v.z < -80 || sy + t.h * v.z < -80) { vue.enRetard = true; continue; }
      }
      peindreTuile(vue, t, L); n++;
    }
    return n;
  }
  // repeindre quelques tuiles tout de suite, ou à l'image suivante
  const aRepeindre = new Set();
  let rafRep = 0;
  function rafraichir(ids, maintenant = false) {
    for (const id of ids) { const v = vues.get(id); if (v) v.sale = true; aRepeindre.add(id); }
    if (maintenant) { flushRep(); return; }
    if (!rafRep) rafRep = requestAnimationFrame(flushRep);
  }
  function flushRep() {
    if (rafRep) cancelAnimationFrame(rafRep);
    rafRep = 0;
    const L = uiK();
    for (const id of aRepeindre) { const t = parId.get(id), v = vues.get(id); if (t && v && !t.jouet) { peindreTuile(v, t, L); v.sig = signature(t, infoTuile(t)); } }
    aRepeindre.clear();
  }
  // après un réglage tourné dans une tuile : sa signature suit (pas de remise en page inutile), le banc relit
  let tApres = 0;
  const apresIds = new Set();
  function rafraichirApres(id) {
    apresIds.add(id);
    if (tApres) return;
    tApres = setTimeout(() => {
      tApres = 0;
      for (const i of apresIds) { const t = parId.get(i), v = vues.get(i); if (t && v) v.sig = signature(t, infoTuile(t)); }
      apresIds.clear();
      bench.paintMeta();
    }, 120);
  }
  function classesSelection() {
    for (const [id, v] of vues) {
      v.el.classList.toggle(v.jouet ? 'sel' : 'tile--selected', sel.includes(id));
      v.el.classList.toggle('tile--moving', busy?.kind === 'move' && sel.includes(id));
    }
  }

  // ═══════════════════════════════════════════════════════════ la caméra
  let rafVue = 0, zAvant = 0, tGeste = 0, tPlan = 0;
  // LA FILE DE MISE EN PAGE : au plus ~8 ms par image, les tuiles visibles
  // d'abord ; une tuile hors champ attend d'y entrer. Le zoom reste fluide,
  // le contenu rattrape l'échelle en quelques images.
  const file = new Set();
  let rafFile = 0;
  function planifierMiseEnPage(ids = null) {
    for (const t of ids ? ids.map((id) => parId.get(id)).filter(Boolean) : T) if (!t.jouet) file.add(t.id);
    if (!rafFile) rafFile = requestAnimationFrame(travailler);
  }
  function travailler() {
    rafFile = 0;
    const t0 = performance.now(), L = uiK(), v = view(), W = cv.clientWidth || 1200, H = cv.clientHeight || 800;
    const visible = (t) => { const sx = v.px + t.x * v.z, sy = v.py + t.y * v.z; return !(sx > W + 80 || sy > H + 80 || sx + t.w * v.z < -80 || sy + t.h * v.z < -80); };
    const cx = W / 2, cy = H / 2;
    const ordre = [...file].map((id) => parId.get(id)).filter(Boolean)
      .map((t) => ({ t, vis: visible(t), d: Math.hypot(v.px + (t.x + t.w / 2) * v.z - cx, v.py + (t.y + t.h / 2) * v.z - cy) }))
      .sort((a, b) => (b.vis - a.vis) || (a.d - b.d));
    for (const { t, vis } of ordre) {
      if (performance.now() - t0 > 8) break;
      file.delete(t.id);
      const vue = vues.get(t.id);
      if (!vue || (!vue.sale && Math.abs(vue.L - L) < 1e-4)) continue;
      if (!vis) { vue.enRetard = true; continue; }
      peindreTuile(vue, t, L);
    }
    for (const id of [...file]) if (!parId.has(id)) file.delete(id);
    if (file.size) rafFile = requestAnimationFrame(travailler);
    else if (boutSurvole || lienPris) peindreLiensKnob();
  }
  function demanderVue() { if (!rafVue) rafVue = requestAnimationFrame(appliquerVue); }
  function appliquerVue() {
    if (rafVue) cancelAnimationFrame(rafVue);
    rafVue = 0;
    const v = view();
    world.style.transform = `translate(${v.px}px, ${v.py}px) scale(${v.z})`;
    if (v.z !== zAvant) {
      zAvant = v.z;
      world.style.setProperty('--iz', (1 / v.z).toFixed(5));
      // la mise en page sémantique suit le zoom sans le freiner : les tuiles
      // se remettent en page quelques-unes par image, les visibles d'abord
      planifierMiseEnPage();
      clearTimeout(tPlan);
      tPlan = setTimeout(() => { peindreCables(); peindreLiensKnob(); }, 120);
    }
    cv.style.backgroundSize = `${26 * v.z}px ${26 * v.z}px`;
    cv.style.backgroundPosition = `${v.px}px ${v.py}px`;
    const pc = zoomBox.querySelector('.pct');
    if (pc) pc.textContent = `${Math.round(v.z * 100)} %`;
    if (lienPris || boutSurvole || lienEnCours) peindreLiensKnob();
    if (seuilsOuvert) peindreSeuils(false);
    bench.suivreVue?.();
  }
  // LE MONDE N'EST UN CALQUE PROMU QUE PENDANT UN GESTE DE LA VUE (Cal, 29/09 :
  // le texte « baveux » au zoom). Pendant qu'on déplace ou qu'on zoome,
  // `.ndx-geste` (nodal.css : will-change: transform) le donne au compositeur,
  // qui le glisse sans rien repeindre. À l'arrêt (160 ms sans geste), la classe
  // part POUR DE BON : le monde se peint avec la page, à l'échelle où on le
  // voit, et un navigateur n'a plus de rastérisation d'avant à étirer —
  // Chrome 53 et suivants gardent l'échelle de rastérisation d'un calque
  // will-change: transform (developer.chrome.com/blog/re-rastering-composite,
  // C. Harrelson, 2016 ; le Chromium 153 de DGX2 re-rastérise pourtant au
  // repos : docs/etudes/musique_theme.md § 10, le défaut dépend du navigateur,
  // le remède ne dépend plus de lui). La remise à net d'avant (`nettete` :
  // la classe ôtée puis remise à l'image suivante) ne donnait jamais une
  // image sans will-change : les rappels requestAnimationFrame passent avant
  // le dessin de la même image (HTML, « update the rendering »).
  // `zNet` : l'échelle à laquelle le monde est rastérisé net (null au repos :
  // celle de la vue) — les canvas des jouets s'y tiennent pendant le geste et
  // se redimensionnent une fois, à l'arrêt (jouets/index.js).
  let zNet = null;
  function gesteVue() {
    if (zNet === null) { zNet = view().z; world.classList.add('ndx-geste'); }
    clearTimeout(tGeste);
    tGeste = setTimeout(repos, 160);
  }
  function repos() {
    zNet = null;
    world.classList.remove('ndx-geste');
    (stats.nettete = stats.nettete || []).push(Math.round(performance.now()));
    rattraper();
  }
  // les tuiles entrées dans le champ pendant un déplacement
  function rattraper() {
    const ids = [];
    for (const t of T) { const v = vues.get(t.id); if (v?.enRetard) { v.enRetard = false; v.sale = true; ids.push(t.id); } }
    if (ids.length) planifierMiseEnPage(ids);
  }
  function startPan(e) {
    const c0 = cam(), x0 = e.clientX, y0 = e.clientY;
    cv.classList.add('drag');
    beginDrag(e, {
      cursor: 'grabbing',
      move: (m) => { gesteVue(); poserCam({ k: c0.k, x: c0.x - (m.clientX - x0) / c0.k, y: c0.y - (m.clientY - y0) / c0.k }); demanderVue(); },
      end: () => { cv.classList.remove('drag'); app.saveUi(); },
    });
  }
  // F — cadrer la sélection, ou toute la scène (jamais au-delà de 100 %)
  function focusOn(tout = false) {
    const fam = !tout && sel.length ? T.filter((t) => sel.includes(t.id)) : T;
    if (!fam.length) return;
    const box = boundsOf(fam), r = cv.getBoundingClientRect(), margin = 28;
    const k = Math.min(1, Math.max(plancher, Math.min(Math.max(40, r.width - margin * 2) / box.w, Math.max(40, r.height - margin * 2) / box.h)));
    poserCam({ k, x: box.x + box.w / 2 - r.width / (2 * k), y: box.y + box.h / 2 - r.height / (2 * k) });
    appliquerVue(); app.saveUi();
  }
  function zoomBouton(f) {
    const r = cv.getBoundingClientRect();
    gesteVue();
    poserCam(zoomCamera(cam(), f > 1 ? -180 : 180, r.width / 2, r.height / 2, plancherCamera(plancher)));
    appliquerVue(); app.saveUi();
  }

  // ═════════════════════════════════════════ sélection, groupes (App.tsx)
  const familyOf = (id) => { const t = parId.get(id); if (!t) return []; return t.group ? T.filter((o) => o.group === t.group) : [t]; };
  const withFamilies = (ids) => { const c = new Set(); for (const id of ids) for (const m of familyOf(id)) c.add(m.id); return T.filter((t) => c.has(t.id)).map((t) => t.id); };
  function setSel(ids) {
    const avant = sel;
    sel = ids;
    const t = parId.get(ids[0]);
    const pid = t ? porteurDe(t.id) : null;
    S.sel.mod = pid && app.mod(pid) ? pid : null;
    if (ids.length) S.sel.cable = null;
    // l'arrangement et le nodal voient le même projet : choisir un nœud d'une piste en fait la piste courante
    const m = pid && app.mod(pid);
    const tid = m?.track && app.track(m.track) ? m.track : (m && app.linked(m.id)[0]) || null;
    if (tid && S.sel.track !== tid) { S.sel.track = tid; S.sel.pat = app.track(tid)?.pat || null; for (const x of T) { const v = vues.get(x.id); if (v) v.el.classList.toggle('tile--courante', !!x.piste && x.piste === tid); } }
    classesSelection(); peindreDessus(); paintSide(); peindreOutils(); paintCableClass();
    // le « bloc pris » d'une section de machine change son T en édition
    if (machinePanel) rafraichir([...new Set([...avant, ...ids])].filter((id) => parId.get(id)?.sec));
  }
  // les touches d'un clic (Cal, 29/09 : « les standards en ajout et enlever de la
  // sélection par clic ») : Maj ajoute, Ctrl/⌘ ajoute ou retire, ⌥ retire (ODIO_01)
  const modeDe = (e) => (e.altKey ? 'remove' : e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'add' : 'replace');
  // Un clic sans glisser sur une tuile déjà prise dans une sélection plus
  // large ne garde qu'elle (l'usage des éditeurs) ; appuyer puis glisser
  // déplace toute la sélection (ODIO_01 : on ne perd pas le lot en le saisissant).
  function choisirAuClic(ev, id, mode) {
    const avant = sel.join();
    selectBlock(id, mode);
    if (mode !== 'replace' || sel.join() !== avant || sel.length <= familyOf(id).length) return;
    const x0 = ev.clientX, y0 = ev.clientY;
    const up = (u) => { removeEventListener('pointerup', up, true); if (Math.hypot(u.clientX - x0, u.clientY - y0) < 4 && sel.includes(id)) setSel(familyOf(id).map((x) => x.id)); };
    addEventListener('pointerup', up, true);
  }
  // les mêmes touches sur l'étiquette d'une piste : elle désigne tout son nœud
  // de départ (une machine-instrument : toutes ses sections)
  function choisirPiste(ev, ids, mode) {
    const avant = sel.join(), tous = ids.every((i) => sel.includes(i));
    const next = mode === 'add' ? withFamilies([...sel, ...ids])
      : mode === 'toggle' ? (tous ? sel.filter((o) => !ids.includes(o)) : withFamilies([...sel, ...ids]))
        : tous ? sel : ids;
    if (next.join() !== sel.join()) setSel(next);
    else if (S.sel.cable) { S.sel.cable = null; paintCableClass(); paintSide(); }
    if (mode !== 'replace' || sel.join() !== avant || sel.length <= ids.length) return;
    const x0 = ev.clientX, y0 = ev.clientY;
    const up = (u) => { removeEventListener('pointerup', up, true); if (Math.hypot(u.clientX - x0, u.clientY - y0) < 4) setSel(ids); };
    addEventListener('pointerup', up, true);
  }
  function selectBlock(id, mode) {
    const family = familyOf(id).map((t) => t.id);
    let next;
    if (mode === 'remove') next = sel.filter((o) => !family.includes(o));
    else if (mode === 'add') next = sel.includes(id) ? sel : withFamilies([...sel, id]);
    else if (mode === 'toggle') next = family.every((f) => sel.includes(f)) ? sel.filter((o) => !family.includes(o)) : withFamilies([...sel, id]);
    else {
      // le second clic ENTRE dans l'assemblage : il ne garde que le bloc
      const entiere = family.length > 1 && family.every((f) => sel.includes(f));
      next = entiere ? [id] : sel.includes(id) ? sel : family;
    }
    if (next.join() !== sel.join()) setSel(next);
    else if (S.sel.cable) { S.sel.cable = null; paintCableClass(); paintSide(); }
  }
  function groupBlocks() {
    if (sel.length < 2) return;
    const g = `grp-${Date.now().toString(36)}`;
    const libres = T.filter((t) => sel.includes(t.id) && !t.machine);
    const arranged = tidyGroup(libres.filter((t) => !t.jouet));
    for (const t of libres) {
      const b = arranged.get(t.id);
      if (b) ecrireBoite(P(), t.id, { ...t, ...b });
      const { owner } = porteurDeTuile(P(), t.id);
      if (owner) owner.grp = g;
    }
    app.commit('data');
  }
  function ungroupBlocks() {
    for (const t of T.filter((x) => sel.includes(x.id))) {
      const { owner } = porteurDeTuile(P(), t.id);
      if (!owner) continue;
      if (owner.mach && t.group === t.machine) owner.mach.ouverte = true;   // une machine s'OUVRE : le lien de circuit reste
      else delete owner.grp;
    }
    sel = [];
    app.commit('data');
  }
  // « G » bascule : un groupe entier se dissout, une machine ouverte se referme, sinon on rassemble
  function toggleGroup() {
    if (!sel.length) return;
    const members = T.filter((t) => sel.includes(t.id));
    const groups = new Set(members.map((t) => t.group));
    if (groups.size === 1 && members[0]?.group) ungroupBlocks();
    else if (members.length && members[0].machine && members.every((t) => t.machine === members[0].machine)) {
      const { owner } = porteurDeTuile(P(), members[0].id);
      if (owner?.mach) { owner.mach.ouverte = false; app.commit('data'); }
    } else groupBlocks();
  }
  function tidy(group) {
    const members = T.filter((t) => t.group === group && !t.jouet);
    if (!members.length) return;
    for (const [id, b] of tidyGroup(members)) ecrireBoite(P(), id, { ...parId.get(id), ...b });
    app.commit('data');
  }
  // « T » comme taille : range la SÉLECTION (App.tsx, `tidySelection`)
  function tidySelection() {
    const members = T.filter((t) => sel.includes(t.id));
    if (!members.length) return;
    const machines = new Set(members.map((t) => t.machine).filter(Boolean));
    if (machines.size === 1) { reassembleMachine(porteurDe(members.find((t) => t.machine).id)); return; }
    if (members.length === 1) { resetSize(members[0].id); return; }
    for (const [id, b] of tidyGroup(members.filter((t) => !t.jouet))) ecrireBoite(P(), id, { ...parId.get(id), ...b });
    app.commit('data');
  }
  function resetSize(id) {
    const t = parId.get(id);
    if (!t || t.jouet) return;
    if (t.sec) {
      const { owner } = porteurDeTuile(P(), id);
      const place = placesDeMachine(machineDef(owner.mach.id)).find((q) => q.id === t.sec);
      if (place) ecrireBoite(P(), id, { x: t.x, y: t.y, w: place.w, h: place.h });
    } else ecrireBoite(P(), id, { x: t.x, y: t.y, ...tailleDOrigine(t.bloc ? porteurDeTuile(P(), id).owner.type : t.type, MODULES) });
    app.commit('data');
  }
  function renommer(id, nomEl) {
    const inp = h('input', 'tile__name tile__name--editing');
    inp.value = nomEl.textContent;
    const fin = (garder) => {
      if (!inp.isConnected) return;
      if (garder) {
        // une section de machine a un nom de machine (capitales) ; une carte, un nom (`nom` d'infoTuile)
        const v = inp.value.trim(), clean = (parId.get(id)?.sec ? engrave(v) : v).slice(0, 18), noms = reglage('noms');
        if (clean) noms[id] = clean; else delete noms[id];
        app.commit('quiet');
      }
      rafraichir([id], true);
    };
    inp.addEventListener('pointerdown', (e) => e.stopPropagation());
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); });
    inp.addEventListener('blur', () => fin(true));
    nomEl.replaceWith(inp);
    inp.focus(); inp.select();
  }
  function basculer(id) {
    const { owner } = porteurDeTuile(P(), id);
    if (!owner) return;
    owner.on = owner.on === false;
    app.commit(app.mod(owner.id) ? 'graph' : 'data');
  }
  function basculerGroupe(g) {
    const owners = [...new Set(T.filter((t) => t.group === g).map((t) => porteurDeTuile(P(), t.id).owner).filter(Boolean))];
    const anyOn = owners.some((o) => o.on !== false);
    for (const o of owners) o.on = !anyOn;
    app.commit('graph');
  }
  // teinter : la SÉLECTION commande quand elle déborde l'ensemble visé
  function poserTeinte(ids, teinte) {
    const touche = sel.some((id) => ids.includes(id));
    const cibles = touche ? withFamilies([...new Set([...sel, ...ids])]) : ids;
    for (const id of cibles) { const { owner } = porteurDeTuile(P(), id); if (owner) { if (teinte) owner.teinte = teinte; else delete owner.teinte; } }
    app.commit('data');
  }

  // ═══════════════════════════════════════════════ les machines (App.tsx)
  function poserMachine(machineId, at) {
    const p = P(), def = machineDef(machineId), eng = moteurDe(machineId);
    if (!def) return null;
    const mach = { id: machineId, sec: sectionsPosees(def, { x: Math.round(at.x), y: Math.round(at.y) }), ctl: {} };
    const voix = eng?.voice, type = voix && TYPE_DE_VOIX[voix];
    let owner;
    if (type && PISTE_DE_VOIX[voix]) {
      // un instrument : une piste de la DAW, sa source porte la machine
      const tr = app.addTrack(PISTE_DE_VOIX[voix], { type, name: def.name.slice(0, 40), params: { ...(VOIX_DES_PANNEAUX[machineId] || {}) } });
      owner = app.mod(tr.src);
      owner.mach = mach;
      pousserTout(owner);
      Object.assign(owner.params, VOIX_DES_PANNEAUX[machineId] || {});
      const b = boundsOf(Object.values(mach.sec)), st = app.mod(tr.strip), o = tailleDOrigine('strip', MODULES);
      Object.assign(st, { x: Math.round(b.x + b.w + CELL), y: Math.round(b.y), w: o.w, h: o.h });
      // LA MACHINE POSÉE DOIT S'ENTENDRE (App.tsx) : sa phrase d'usine, un clip de quatre mesures
      const ph = phraseDeMachine(machineId), pat = app.pat(tr.pat);
      if (ph && pat) {
        Object.assign(pat, ph);
        p.clips.push({ id: app.uid('c'), track: tr.id, start: 0, pat: pat.id, len: 4 * (p.sig || 4) });
      }
    } else if (type) {
      // un effet (TAPE-3, PLATE-24, VARIMU-70) : un module libre, câblé à la main
      owner = { id: app.uid('m'), type, track: null, x: 0, y: 0, on: true, params: {}, mach };
      p.modules.push(owner);
      pousserTout(owner);
    } else {
      // sans son (KBD-01, SEQ-01, INTERACTIONS) : un bloc du nodal
      owner = { id: app.uid('b'), type: 'machine', x: 0, y: 0, on: true, params: {}, mach };
      const n = nodalDe(p);
      n.blocs = [...(n.blocs || []), owner];
    }
    recalerPorteur(owner);
    return owner;
  }
  const tuilesDuPorteur = (pid) => { lireTuiles(); return T.filter((t) => porteurDe(t.id) === pid).map((t) => t.id); };
  // Remonter une machine ouverte dans son agencement (enregistré, sinon celui d'ODIO)
  function reassembleMachine(pid) {
    const { owner } = porteurDeTuile(P(), pid);
    if (!owner?.mach) return;
    const members = T.filter((t) => porteurDe(t.id) === pid);
    if (!members.length) return;
    const anchor = { x: Math.min(...members.map((b) => b.x)), y: Math.min(...members.map((b) => b.y)) };
    for (const place of placesDeMachine(machineDef(owner.mach.id))) {
      if (!owner.mach.sec[place.id]) continue;
      owner.mach.sec[place.id] = { x: Math.round(anchor.x + place.x), y: Math.round(anchor.y + place.y), w: Math.round(place.w), h: Math.round(place.h) };
    }
    owner.mach.ouverte = false;
    recalerPorteur(owner);
    app.commit('data');
  }
  function saveMachine(pid) {
    const { owner } = porteurDeTuile(P(), pid);
    const members = T.filter((t) => porteurDe(t.id) === pid);
    if (!owner?.mach || !members.length) return;
    const coin = { x: Math.min(...members.map((b) => b.x)), y: Math.min(...members.map((b) => b.y)) };
    saveMachineLayout(owner.mach.id, members.map((b) => ({ section: b.sec, x: b.x - coin.x, y: b.y - coin.y, w: b.w, h: b.h })), AGENCEMENTS_VERSION);
    toast(`${machineDef(owner.mach.id)?.name} : configuration enregistrée`);
  }
  function forgetMachine(pid) {
    const { owner } = porteurDeTuile(P(), pid);
    if (!owner?.mach) return;
    clearMachineLayout(owner.mach.id);
    for (const s of Object.keys(machineRetouches(owner.mach.id))) clearRetouches(s);
    reassembleMachine(pid);
  }

  // ═══════════════════════════════════════════════════ poser (App.tsx, spawn)
  function poser(type, at, { from = null, on = null } = {}) {
    const p = P(), [genre, a, b] = type.split(':');
    const x = Math.round(at.x), y = Math.round(at.y);
    let neuf = null;
    if (genre === 'machine') neuf = poserMachine(a, { x, y })?.id;
    else if (genre === 'bloc') {
      const o = tailleDOrigine(a, MODULES), bl = { id: app.uid('b'), type: a, x, y, w: o.w, h: o.h, on: true, params: {} };
      const n = nodalDe(p); n.blocs = [...(n.blocs || []), bl]; neuf = bl.id;
    } else if (genre === 'piste') {
      const tr = app.addTrack(a, { type: b }), s = app.mod(tr.src), st = app.mod(tr.strip);
      const o = tailleDOrigine(b, MODULES), os = tailleDOrigine('strip', MODULES);
      Object.assign(s, { x, y, w: o.w, h: o.h });
      Object.assign(st, { x: x + o.w + CELL, y, w: os.w, h: os.h });
      neuf = s.id;
    } else if (genre === 'jouet') {
      const m = app.toys?.add(a, x, y, true) || (() => { const mm = { id: app.uid('m'), type: a, track: null, x, y, on: true, params: {} }; p.modules.push(mm); return mm; })();
      neuf = m.id;
    } else if (genre === 'effet') {
      const src = (from && app.mod(from)) || (on && app.mod(on.a));
      const o = tailleDOrigine(a, MODULES);
      const m = { id: app.uid('m'), type: a, track: src?.track || null, x, y, w: o.w, h: o.h, on: true, params: {} };
      p.modules.push(m);
      neuf = m.id;
    } else if (genre === 'bus') { app.addBus(a || 'reverb'); return; }
    if (!neuf) return;
    lireTuiles();
    // né au bout d'un câble : branché tout de suite ; né SUR un câble : il s'y insère
    if (from) { const why = verdictDe(from, neuf); if (!why) relier(from, neuf); else toast(why); }
    if (on) {
      const why = verdictDe(on.a, neuf, [on]);
      if (!why) {
        p.cables = p.cables.filter((c) => !(c.a === on.a && c.b === on.b && !c.t));
        p.cables.push({ a: on.a, b: neuf });
        if (!app.canConnect(neuf, on.b)) p.cables.push({ a: neuf, b: on.b });
      } else toast(why);
    }
    sel = tuilesDuPorteur(neuf);
    S.sel.mod = app.mod(neuf) ? neuf : null;
    app.commit('graph');
  }
  const centreEcran = () => { const r = cv.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  function ouvrirLeCatalogue(at) {
    ouvrirCatalogue({
      doc: cv.ownerDocument,       // dans la fenêtre du nodal s'il est détaché
      onPick: (type) => poser(type, at || versMonde(...centreEcran())),
      onDrop: (type, e) => {
        const r = cv.getBoundingClientRect();
        if (e.x < r.left || e.x > r.right || e.y < r.top || e.y > r.bottom) return;
        poser(type, versMonde(e.x, e.y));
      },
    });
  }
  function ouvrirLePlano() {
    ouvrirPlano({ doc: cv.ownerDocument, projet: P, onGarder: () => app.commit('quiet'), onPoser: (id) => { const c = versMonde(...centreEcran()); poser(`machine:${id}`, { x: c.x - 120, y: c.y - 60 }); } });
  }

  // ═════════════════════════════════════════════════════ retirer, dupliquer
  function retirerTuiles(ids) {
    const p = P(), porteurs = [...new Set(ids.map(porteurDe))], pistes = new Set();
    let fait = false;
    for (const pid of porteurs) {
      const m = app.mod(pid);
      if (m) {
        if (MODULES[m.type]?.role === 'master') continue;
        const tr = m.track && app.track(m.track);
        if (tr && (tr.src === m.id || tr.strip === m.id)) { pistes.add(tr.id); continue; }
        // on retire en RECOUSANT, chaîne par chaîne : ce qui entrait est rebranché
        // sur ce qui sortait, le long de la même piste (projet.js, recoudre)
        recoudre(p, pid, app.wouldCycle);
        p.modules = p.modules.filter((x) => x.id !== pid);
        p.auto = (p.auto || []).filter((L) => L.mod !== pid);
        fait = true;
      } else {
        const n = nodalDe(p);
        n.blocs = (n.blocs || []).filter((b) => b.id !== pid);
        fait = true;
      }
    }
    const n = nodalDe(p), vivants = new Set([...p.modules.map((m) => m.id), ...(n.blocs || []).map((b) => b.id)]);
    n.liens = (n.liens || []).filter((l) => vivants.has(l.a) && vivants.has(l.b));
    n.liensKnob = (n.liensKnob || []).filter((l) => vivants.has(porteurDe(l.de.bloc)) && vivants.has(porteurDe(l.vers.bloc)));
    sel = [];
    if (S.sel.mod && !app.mod(S.sel.mod)) S.sel.mod = null;
    if (fait) app.commit('graph');
    // une source ou une tranche : toute sa piste — sans confirmation, comme Suppr dans l'arrangement : Ctrl+Z la rend
    if (pistes.size) app.removeTracks([...pistes], { ask: false });
  }
  // Duplique un lot ; rend les nouveaux identifiants de tuiles, dans l'ordre du lot (App.tsx, `duplicate`)
  function dupliquer(ids) {
    const p = P(), clone = new Map(), cloneP = new Map(), sonDePiste = new Set();
    const copie = (x) => JSON.parse(JSON.stringify(x));
    for (const pid of [...new Set(ids.map(porteurDe))]) {
      const m = app.mod(pid);
      let n = null;
      if (m) {
        const def = MODULES[m.type];
        if (!def || ['master', 'strip', 'bus'].includes(def.role)) continue;
        const tr0 = m.track && app.track(m.track);
        if (tr0 && tr0.src === m.id) {
          // une source : une piste neuve, son motif copié
          const tr = app.addTrack(tr0.kind, { type: m.type, name: tr0.name, color: tr0.color, params: copie(m.params || {}) });
          n = app.mod(tr.src);
          Object.assign(n, copie({ ...m, id: n.id, track: tr.id }));
          const p0 = app.pat(tr0.pat), p1 = app.pat(tr.pat);
          if (p0 && p1) Object.assign(p1, copie({ ...p0, id: p1.id, track: tr.id, name: p1.name }));
          const st = app.mod(tr.strip), b = tuileDesPrises(m.id);
          if (b) Object.assign(st, { x: b.x + b.w + CELL, y: b.y });
          sonDePiste.add(pid);
        } else { n = copie({ ...m, id: app.uid('m') }); p.modules.push(n); }
      } else {
        const b0 = (nodalDe(p).blocs || []).find((b) => b.id === pid);
        if (!b0) continue;
        n = copie({ ...b0, id: app.uid('b') });
        nodalDe(p).blocs.push(n);
      }
      delete n.grp;
      cloneP.set(pid, n.id);
      for (const t of T.filter((t2) => porteurDe(t2.id) === pid)) clone.set(t.id, t.sec ? idSection(n.id, t.sec) : n.id);
    }
    // un lot qui formait un groupe libre en forme un aussi
    const fam = T.filter((t) => ids.includes(t.id)), groupes = new Set(fam.map((t) => t.group));
    if (groupes.size === 1 && fam[0]?.group && !isWeldedGroup(fam[0].group)) {
      const g = `grp-${Date.now().toString(36)}`;
      for (const nid of cloneP.values()) { const { owner } = porteurDeTuile(p, nid); if (owner) owner.grp = g; }
    }
    // le câblage suit (patch.ts, `duplicateLinks`) : internes copiés, sorties gardées
    const son = new Map([...cloneP].filter(([a]) => !sonDePiste.has(a)));
    const liens = p.cables.filter((c) => !c.t && typeof c.send !== 'number').map((c) => ({ from: c.a, to: c.b }));
    for (const l of duplicateLinks(liens, son)) {
      if (liens.some((o) => o.from === l.from && o.to === l.to)) continue;
      if (app.mod(l.from) && app.mod(l.to) && !app.canConnect(l.from, l.to)) p.cables.push({ a: l.from, b: l.to });
    }
    const n = nodalDe(p);
    for (const l of [...(n.liens || [])]) if (cloneP.has(l.a)) n.liens.push({ ...l, a: cloneP.get(l.a) });
    for (const cle of ['expose', 'ordre', 'split', 'noms', 'ports']) { const r = reglage(cle); for (const [a, b] of clone) if (a in r) r[b] = copie(r[a]); }
    lireTuiles();
    return ids.map((id) => clone.get(id)).filter(Boolean);
  }

  // ═══════════════════════════════════════════════════ les gestes (App.tsx)
  // un geste qui bouge des tuiles : tout se redessine à l'image suivante
  let rafGeste = 0;
  const gesteIds = new Set();
  function apresGeste(ids = []) {
    for (const id of ids) gesteIds.add(id);
    if (rafGeste) return;
    rafGeste = requestAnimationFrame(() => {
      rafGeste = 0;
      lireTuiles();
      for (const t of T) { const v = vues.get(t.id); if (v) placer(v, t); }
      const L = uiK();
      for (const id of gesteIds) { const t = parId.get(id), v = vues.get(id); if (t && v && !t.jouet) peindreTuile(v, t, L); }
      gesteIds.clear();
      majAncres();
      peindreCables(); peindreBornes(); peindreDessus();
      bench.paintMeta();
    });
  }
  function startMove(event, id) {
    if (event.button !== 0) return;
    event.stopPropagation();
    let family = sel.includes(id) ? T.filter((t) => sel.includes(t.id)) : familyOf(id);
    if (!family.length) return;
    // HORS ÉDITION, une machine SOUDÉE se déplace ENTIÈRE
    const enEdition = machinePanel && ensembleSoude(machinePanel);
    const soudees = new Set(family.map((t) => t.group).filter((g) => g && isWeldedGroup(g) && g !== enEdition));
    if (soudees.size) { const c = new Set(family.map((t) => t.id)); for (const t of T) if (t.group && soudees.has(t.group)) c.add(t.id); family = T.filter((t) => c.has(t.id)); }
    const cloning = event.altKey;
    let cloned = false, origins = new Map(family.map((t) => [t.id, { x: t.x, y: t.y }])), anchor = { ...family.find((t) => t.id === id) };
    const x0 = event.clientX, y0 = event.clientY, k = view().z, target = event.currentTarget;
    let started = false;
    beginDrag({ currentTarget: null, pointerId: event.pointerId }, {
      cursor: 'move',
      move: (m) => {
        const dx = m.clientX - x0, dy = m.clientY - y0;
        if (!started && !isDrag(dx, dy)) return;
        if (!started) {
          started = true;
          // ⌥ glissé : on duplique, et ce sont les COPIES qu'on déplace
          if (cloning && !cloned) {
            cloned = true;
            const order = family.map((t) => t.id), born = dupliquer(order);
            if (born.length === order.length) {
              const twin = new Map(order.map((o, i) => [o, born[i]]));
              origins = new Map(family.map((t) => [twin.get(t.id), { x: t.x, y: t.y }]));
              anchor = { ...anchor, id: twin.get(id) };
              sel = born;
              render();
            }
          }
          busy = { id: anchor.id, kind: 'move' };
          classesSelection();
          try { target?.setPointerCapture?.(m.pointerId); } catch { /* window */ }
        }
        const raw = { x: anchor.x + dx / k, y: anchor.y + dy / k, w: anchor.w, h: anchor.h };
        const libre = !aimante() || (m.altKey && !cloning);
        const snapped = libre ? { box: raw, guides: [] } : snapBox(raw, T.filter((t) => !origins.has(t.id) && !t.jouet), SNAP_DISTANCE / k);
        guides = snapped.guides;
        const sx = snapped.box.x - anchor.x, sy = snapped.box.y - anchor.y;
        for (const [tid, o] of origins) { const t = parId.get(tid); if (t) { if (t.jouet) { const mm = app.mod(t.mod); mm.x = Math.round(o.x + sx); mm.y = Math.round(o.y + sy); } else ecrireBoite(P(), tid, { ...t, x: o.x + sx, y: o.y + sy }); } }
        apresGeste();
      },
      end: () => {
        if (!started && cloning) setSel(sel.filter((s) => s !== id));
        busy = null; guides = [];
        classesSelection();
        // rien n'a bougé : rien à repeindre — repeindre le dessus ici remplaçait
        // l'étiquette de piste sous le pointeur, et son double-clic se perdait
        if (started) app.commit('data');
      },
    });
  }
  // LA BUTÉE DES SECTIONS EN ÉDITION (App.tsx, `respecteMinima`) — minima.js publie ; la butée n'est pas encore lue ici
  const respecteMinima = () => true;
  function startBoundsResize(event, ids, edge) {
    if (event.button !== 0) return;
    event.stopPropagation(); event.preventDefault();
    const family = T.filter((t) => ids.includes(t.id) && !t.jouet).map((t) => ({ ...t }));
    if (!family.length) return;
    const from = boundsOf(family), x0 = event.clientX, y0 = event.clientY, k = view().z;
    busy = { id: family[0].id, kind: 'resize' };
    beginDrag(event, {
      cursor: EDGE_CURSOR[edge],
      move: (m) => {
        const scaled = scaleEnsemble(family, from, edge, { x: (m.clientX - x0) / k, y: (m.clientY - y0) / k });
        if (!respecteMinima(family, scaled)) return;
        for (const [tid, b] of scaled) ecrireBoite(P(), tid, b);
        apresGeste([...scaled.keys()]);
      },
      end: () => { busy = null; app.commit('data'); },
    });
  }
  function startDividerDrag(event, group, parts) {
    if (event.button !== 0 || !parts.length) return;
    event.stopPropagation(); event.preventDefault();
    const family = T.filter((t) => t.group === group && !t.jouet).map((t) => ({ ...t }));
    if (!family.length) return;
    const min = minDe(family), x0 = event.clientX, y0 = event.clientY, k = view().z;
    const targets = { x: edgesOn(family, 'x'), y: edgesOn(family, 'y') };
    for (const part of parts) targets[part.axis] = targets[part.axis].filter((v) => Math.abs(v - part.at) > 0.5);
    busy = { id: family[0].id, kind: 'resize' };
    beginDrag(event, {
      cursor: parts.length === 2 ? 'move' : parts[0].axis === 'x' ? 'ew-resize' : 'ns-resize',
      move: (m) => {
        const raw = { x: (m.clientX - x0) / k, y: (m.clientY - y0) / k };
        let current = family.map((b) => ({ ...b }));
        const rules = [];
        for (const part of parts) {
          let delta = part.axis === 'x' ? raw.x : raw.y;
          if (!m.altKey && aimante()) {
            const snapped = snapValue(part.at + delta, targets[part.axis], SNAP_DISTANCE / k);
            if (snapped.guide !== null) { delta = snapped.value - part.at; rules.push({ axis: part.axis, at: snapped.guide }); }
          }
          const moved = moveDivider(current, part, delta, min);
          current = current.map((b) => ({ ...b, ...(moved.get(b.id) ?? {}) }));
        }
        guides = rules;
        for (const b of current) ecrireBoite(P(), b.id, b);
        apresGeste(current.map((b) => b.id));
      },
      end: () => { busy = null; guides = []; app.commit('data'); },
    });
  }
  // Redimensionner par une arête — UNE logique, trois contextes (App.tsx, `startResize`)
  function startResize(event, id, edge) {
    if (event.button !== 0) return;
    event.stopPropagation(); event.preventDefault();
    const block = parId.get(id);
    if (!block || block.jouet) return;
    const x0 = event.clientX, y0 = event.clientY, k = view().z;
    const snapshot = T.filter((t) => !t.jouet).map((b) => ({ ...b }));
    const enEdition = machinePanel !== null && block.machine === ensembleSoude(machinePanel);
    const dedans = sel.length === 1 && sel[0] === id && (!block.machine || enEdition);
    const members = dedans ? null : block.group ? snapshot.filter((b) => b.group === block.group)
      : sel.includes(id) && sel.length > 1 ? snapshot.filter((b) => sel.includes(b.id)) : null;
    const horizontal = horizontalOf(edge), vertical = verticalOf(edge);
    const edgeX = horizontal === 'e' ? block.x + block.w : block.x, edgeY = vertical === 's' ? block.y + block.h : block.y;
    const bounds = members ? boundsOf(members) : null;
    const minGeste = members ? minDe(members) : block.machine ? MIN_SECTION : MIN_TILE;
    const outerX = Boolean(block.group) && bounds !== null && horizontal !== null ? Math.abs(edgeX - (horizontal === 'e' ? bounds.x + bounds.w : bounds.x)) <= 1.5 : false;
    const outerY = Boolean(block.group) && bounds !== null && vertical !== null ? Math.abs(edgeY - (vertical === 's' ? bounds.y + bounds.h : bounds.y)) <= 1.5 : false;
    // UNE MACHINE HORS ÉDITION EST UN SEUL OBJET : son pourtour l'étire, ses arêtes intérieures sont inertes
    const interdit = Boolean(block.machine) && !enEdition;
    if (interdit && !outerX && !outerY) return;
    const dividerX = members && horizontal && !outerX && !interdit ? dividerAt(members, 'x', edgeX) : null;
    const dividerY = members && vertical && !outerY && !interdit ? dividerAt(members, 'y', edgeY) : null;
    const outsiders = snapshot.filter((b) => b.id !== id && !members?.some((mm) => mm.id === b.id));
    const targetsX = [...(members ? edgesOn(members, 'x').filter((v) => Math.abs(v - edgeX) > 0.5) : []), ...edgesOn(outsiders, 'x')];
    const targetsY = [...(members ? edgesOn(members, 'y').filter((v) => Math.abs(v - edgeY) > 0.5) : []), ...edgesOn(outsiders, 'y')];
    busy = { id, kind: 'resize' };
    if (!sel.includes(id)) setSel(withFamilies([id]));
    beginDrag(event, {
      cursor: EDGE_CURSOR[edge],
      move: (m) => {
        const raw = { x: (m.clientX - x0) / k, y: (m.clientY - y0) / k }, delta = { ...raw }, rules = [];
        // l'aimant éteint : l'arête ne se pose plus sur celles des voisines ;
        // le couplage (les voisines collées suivent l'arête) reste, ⌥ le défait
        const aim = aimante();
        if (horizontal && !m.altKey && aim) { const s = snapValue(edgeX + raw.x, targetsX, SNAP_DISTANCE / k); if (s.guide !== null) { delta.x = s.value - edgeX; rules.push({ axis: 'x', at: s.guide }); } }
        if (vertical && !m.altKey && aim) { const s = snapValue(edgeY + raw.y, targetsY, SNAP_DISTANCE / k); if (s.guide !== null) { delta.y = s.value - edgeY; rules.push({ axis: 'y', at: s.guide }); } }
        guides = rules;
        let next;
        if (!members || !bounds) next = resizeCoupled(snapshot, id, edge, delta, minGeste, !m.altKey);
        else {
          let current = members.map((b) => ({ ...b }));
          const apply = (map) => { current = current.map((b) => ({ ...b, ...(map.get(b.id) ?? {}) })); };
          if (horizontal) {
            if (outerX) apply(scaleEnsemble(members, bounds, horizontal, { x: delta.x, y: 0 }));
            else if (dividerX) apply(moveDivider(current, dividerX, delta.x, minGeste));
            else apply(resizeCoupled(current, id, horizontal, { x: delta.x, y: 0 }, minGeste, !m.altKey));
          }
          if (vertical) {
            if (outerY) apply(scaleEnsemble(members, bounds, vertical, { x: 0, y: delta.y }));
            else if (dividerY) apply(moveDivider(current, dividerY, delta.y, minGeste));
            else apply(resizeCoupled(current, id, vertical, { x: 0, y: delta.y }, minGeste, !m.altKey));
          }
          next = new Map(current.map((b) => [b.id, b]));
        }
        if (!respecteMinima(snapshot, next)) return;
        for (const [tid, b] of next) ecrireBoite(P(), tid, { ...parId.get(tid), ...b });
        apresGeste([...next.keys()]);
      },
      end: () => { busy = null; guides = []; app.commit('data'); },
    });
  }
  function startMarquee(event) {
    const mode = modeDe(event);
    const base = mode === 'replace' ? [] : [...sel];
    if (mode === 'replace' && sel.length) setSel([]);
    const o = versMonde(event.clientX, event.clientY);
    let bouge = false;
    beginDrag(event, {
      cursor: 'crosshair',
      move: (m) => {
        const q = versMonde(m.clientX, m.clientY), box = rectFrom(o.x, o.y, q.x, q.y);
        if (!bouge && box.w * view().z < 3 && box.h * view().z < 3) return;
        bouge = true;
        marquee = box;
        // toute tuile qui INTERSECTE est prise, et effleurer un groupe le prend en entier
        const hits = withFamilies(T.filter((t) => intersects(box, t)).map((t) => t.id));
        // Ctrl : le cadre inverse ce qu'il touche (Explorateur de Windows, Figma) ; Maj : ajoute ; ⌥ : retire
        const next = mode === 'remove' ? base.filter((id) => !hits.includes(id))
          : mode === 'toggle' ? withFamilies([...base.filter((id) => !hits.includes(id)), ...hits.filter((id) => !base.includes(id))])
            : withFamilies([...base, ...hits]);
        if (next.join() !== sel.join()) { sel = next; classesSelection(); }
        peindreDessus();
      },
      end: () => { marquee = null; setSel(sel); },
    });
  }

  // ═══════════════════════════════════════════════════ les bornes (Ports.tsx)
  function defaultPortU(t, side) {
    if (!t.machine) return PORT_HOME;
    const span = t.w + t.h;
    if (span <= 0) return PORT_HOME;
    return side === 'out' ? (0.8 * t.w) / span : (0.2 * t.w) / span;
  }
  const portU = (t, side) => reglage('ports')[t.id]?.[side] ?? defaultPortU(t, side);
  function pointBorne(pid, side) {
    const t = tuileDesPrises(pid);
    return t ? portAt(t, side, portU(t, side)) : null;
  }
  // l'entrée des NOTES : le port losange des jouets (le même pour tout ce qui se joue)
  function pointNotes(pid) {
    const m = app.mod(pid);
    const q = m && portsOf(m).find((x) => x.dir === 'in' && x.t === 'notes');
    if (q) return { x: m.x, y: m.y + q.y };
    return pointBorne(pid, 'in');
  }
  // les liaisons qu'on ne dessine pas : les sauts, et les blocs qui se touchent
  function caches() {
    const out = new Map();
    for (const c of P().cables) {
      if (c.t) continue;
      const key = `${c.a}>${c.b}`, shown = c.shown === true;
      if (c.jump) { out.set(key, { key, color: c.jump, shown, auto: false }); continue; }
      const a = tuileDesPrises(c.a), b = tuileDesPrises(c.b);
      if (a && b && a !== b && touching(a, b)) out.set(key, { key, color: autoJumpColor(key), shown, auto: true });
    }
    return out;
  }
  function peindreBornes() {
    put(bornesEl);
    const hid = caches(), p = P(), liens = liensDe(p);
    for (const t of T) {
      const pr = prisesDeTuile(t), pid = porteurDe(t.id);
      for (const side of ['in', 'out']) {
        const sig = pr[side];
        if (!sig) continue;
        const pt = portAt(t, side, portU(t, side));
        const mine = side === 'out' ? [...p.cables.filter((c) => !c.t && c.a === pid), ...liens.filter((l) => l.a === pid)] : p.cables.filter((c) => !c.t && c.b === pid);
        const b = h('span', `port ndx-borne port--${side}${sig === 'notes' ? ' port--notes' : ''}${mine.length ? ' port--live' : ''}`);
        b.style.left = px(pt.x); b.style.top = px(pt.y);
        b.style.setProperty('--k', `var(--${accentDe(t)})`);   // la borne dans l'accent de sa carte (les ports d'avant)
        b.dataset.porteur = pid; b.dataset.side = side;
        b.title = side === 'out' ? 'Sortie — glisser un câble · clic milieu pour déplacer la borne · double-clic pour la remettre'
          : 'Entrée — clic milieu pour déplacer la borne · double-clic pour la remettre';
        b.addEventListener('pointerdown', (e) => { if (e.button === 1) startPortDrag(e, t.id, side); else if (side === 'out') startCable(e, pid, sig); else e.stopPropagation(); });
        b.addEventListener('dblclick', (e) => { e.stopPropagation(); const r = reglage('ports'); if (r[t.id]) { delete r[t.id][side]; app.commit('quiet'); apresGeste(); } });
        bornesEl.append(b);
        // un carré PAR saut, empilés sous la borne
        mine.map((c) => hid.get(`${c.a}>${c.b}`)).filter(Boolean).forEach((j, i) => {
          const s = h('span', `jump${j.shown ? ' jump--shown' : ''}${j.auto ? ' jump--auto' : ''}`);
          s.style.left = px(pt.x); s.style.top = px(pt.y); s.style.setProperty('--i', String(i + 1)); s.style.background = `var(--${j.color})`;
          s.title = j.auto ? 'Liaison masquée — les deux blocs se touchent, le fil n\'aurait pas la place. Survoler pour le voir.' : `Saut — survoler pour voir le fil, cliquer pour le garder affiché${j.shown ? ' (affiché)' : ''}`;
          s.addEventListener('pointerenter', () => { hoverJump = j.key; peindreCables(); });
          s.addEventListener('pointerleave', () => { if (hoverJump === j.key) { hoverJump = null; peindreCables(); } });
          s.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            if (e.button !== 0) return;
            const c = p.cables.find((x) => `${x.a}>${x.b}` === j.key);
            if (c) { if (c.shown) delete c.shown; else c.shown = true; app.commit('quiet'); peindreCables(); peindreBornes(); }
          });
          s.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); const c = p.cables.find((x) => `${x.a}>${x.b}` === j.key); if (c) menuCable(c, e); });
          bornesEl.append(s);
        });
      }
    }
  }
  function startPortDrag(event, tileId, side) {
    event.preventDefault(); event.stopPropagation();
    beginDrag(event, {
      cursor: 'crosshair',
      move: (m) => {
        const t = parId.get(tileId);
        if (!t) return;
        const r = reglage('ports');
        r[tileId] = { ...(r[tileId] || {}), [side]: nearestPort(t, side, versMonde(m.clientX, m.clientY)) };
        apresGeste();
      },
      end: () => app.commit('quiet'),
    });
  }

  // ═════════════════════════════════════════════════════════ les câbles
  function peindreCables() {
    put(saisie); put(cablesSvg);
    const p = P(), k = view().z, hid = caches();
    // le fil commun du portail (commun/wire.css : .sr-wire .vis, .hit) ; la zone de
    // clic reste SOUS les tuiles (.ndx-saisie), le trait par-dessus (.ndx-cables)
    const trait = (d, key, cable, notes, couleur = 'ink3') => {
      const hit = sv('path', { class: 'cable__hit hit', d });
      hit.addEventListener('pointerenter', () => { hoverCable = key; paintCableClass(); });
      hit.addEventListener('pointerleave', () => { if (hoverCable === key) { hoverCable = null; paintCableClass(); } });
      hit.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.stopPropagation(); S.sel.cable = key; paintCableClass(); paintSide(); });
      if (cable) {
        hit.addEventListener('dblclick', (e) => { e.stopPropagation(); ouvrirSurCable(e, cable); });
        hit.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); menuCable(cable, e); });
      }
      const tt = sv('title'); tt.textContent = 'Câble — clic pour le désigner (Suppr le retire) · double-clic pour y insérer un bloc · clic droit pour le menu';
      hit.append(tt);
      saisie.append(hit);
      const g = sv('g', { class: notes ? 'cable sr-wire cable--notes' : 'cable sr-wire' });
      g.dataset.key = key;
      g.style.setProperty('--k', `var(--${couleur})`);
      g.append(sv('path', { class: 'cable__line vis', d }));
      cablesSvg.append(g);
      return g;
    };
    // un fil hors de toute chaîne : l'accent de sa source (les fils d'avant, --k de la carte)
    const couleurDe = (id) => accentDe(tuileDesPrises(id) || parId.get(id));
    // les fils d'une chaîne ont la couleur de SA piste (projet.js, trajets) ;
    // un fil que deux chaînes empruntent (un effet partagé) est tireté
    const Tj = trajets(p);
    for (const c of p.cables) {
      if (c.t) continue;   // jouets : les câbles de notes et de valeur ont leur calque (jouets/index.js)
      const a = pointBorne(c.a, 'out'), b = pointBorne(c.b, 'in');
      if (!a || !b) continue;
      const key = `${c.a}>${c.b}`, jump = hid.get(key);
      if (jump && !(jump.shown || hoverJump === key)) continue;
      const g = trait(cablePath(a, b), key, c, false, couleurDe(c.a));
      const communes = typeof c.send === 'number' ? [] : (Tj.de.get(c.a) || []).filter((x) => (Tj.de.get(c.b) || []).includes(x));
      const tr = communes.length && app.track(communes[0]);
      if (tr) { g.classList.add('cable--piste'); if (communes.length > 1) g.classList.add('cable--multi'); g.style.color = `var(--${tr.color})`; g.style.setProperty('--k', `var(--${tr.color})`); g.dataset.piste = communes.join(' '); }
      if (jump) { g.firstChild.classList.add('cable__line--jump'); g.style.color = `var(--${jump.color})`; g.style.setProperty('--k', `var(--${jump.color})`); }
      if (typeof c.send === 'number') {
        // un envoi de la console : tireté (wire.css, .send), son niveau posé sur le fil
        g.classList.add('send');
        const [lx, ly] = wireAt([a.x, a.y], [b.x, b.y]);
        const tx = sv('text', { x: lx, y: ly, class: 'cable__envoi lab' });
        tx.textContent = `envoi ${c.send > 0 ? '+' : ''}${c.send.toFixed(1)} dB`;
        g.append(tx);
      }
    }
    // les notes des blocs (clavier, KBD-01, SEQ-01) vers ce qui se joue
    for (const l of liensDe(p)) {
      const a = pointBorne(l.a, 'out'), b = pointNotes(l.b);
      if (!a || !b) continue;
      const g = trait(cablePath(a, b), `L:${l.a}>${l.b}`, null, true, couleurDe(l.a));
      const mb = app.mod(l.b), tr = mb?.track && app.track(mb.track);
      if (tr) { g.classList.add('cable--piste'); g.style.color = `var(--${tr.color})`; g.style.setProperty('--k', `var(--${tr.color})`); }   // les notes vont jouer CETTE piste
    }
    // le câble qu'on tire, et le CADRE DE PARENTAGE : vert si le lâcher fera la liaison, rouge sinon
    if (cabling) {
      if (cabling.vise) {
        const t = parId.get(cabling.vise);
        const fam = t ? (t.machine ? T.filter((o) => o.machine === t.machine) : [t]) : [];
        if (fam.length) {
          const b = boundsOf(fam), m2 = 3 / k, rx = 14 / k;   // le cadre suit les coins des cartes, à l'écran
          const r = sv('rect', { class: cabling.refus ? 'cible cible--refusee' : 'cible cible--permise', x: b.x - m2, y: b.y - m2, width: b.w + 2 * m2, height: b.h + 2 * m2, rx, ry: rx });
          const tt = sv('title'); tt.textContent = cabling.refus || 'la liaison se fera';
          r.append(tt);
          cablesSvg.append(r);
        }
      }
      const a = pointBorne(cabling.from, 'out');
      if (a) {
        const b = cabling.over ? (cabling.sig === 'notes' ? pointNotes(cabling.over) : pointBorne(cabling.over, 'in')) : { x: cabling.x, y: cabling.y };
        const blocked = cabling.vise && cabling.refus;
        // le fil qu'on tire : celui du portail (wire.css, .sr-wire-temp), plein quand il prendra, en alerte s'il est refusé
        cablesSvg.append(sv('path', { class: `cable__line sr-wire-temp ${blocked ? 'cable__line--refused bad' : 'cable__line--drawing'}${cabling.over && !blocked ? ' snap' : ''}${cabling.sig === 'notes' ? ' cable__line--notes' : ''}`, d: cablePath(a, b || a) }));
      }
    }
    paintCableClass();
    app.toys?.wires();   // jouets : leurs câbles, dessinés au même moment
  }
  function paintCableClass() {
    for (const g of cablesSvg.querySelectorAll('g.cable')) {
      g.classList.toggle('cable--picked', S.sel.cable === g.dataset.key);
      g.classList.toggle('cable--survol', hoverCable === g.dataset.key);
    }
  }
  // le menu d'un câble (CableMenu.tsx : « passer en saut », « insérer un bloc
  // de flux »), par le menu commun ; il dit à quelle(s) chaîne(s) le fil sert
  function menuCable(c, e) {
    const Tj = trajets(P());
    const communes = (Tj.de.get(c.a) || []).filter((x) => (Tj.de.get(c.b) || []).includes(x)).map(app.track).filter(Boolean);
    menu(e.clientX, e.clientY, [
      { head: `câble · ${nomCourt(c.a)} → ${nomCourt(c.b)}` },
      communes.length ? { head: `chaîne de ${communes.map((t) => t.name).join(', ')}` } : null,
      { label: c.jump ? 'Redessiner le fil' : 'Passer en saut', onclick: () => {
        if (c.jump) { delete c.jump; delete c.shown; } else c.jump = nextJumpColor(P().cables.filter((x) => !x.t).map((x) => ({ from: x.a, to: x.b, jump: x.jump })));
        app.commit('quiet'); peindreCables(); peindreBornes();
      } },
      { label: 'Insérer un bloc de flux', onclick: () => ouvrirSurCable(e, c, 'FLUX') },
      { label: 'Insérer un effet', onclick: () => ouvrirSurCable(e, c, 'EFFETS') },
      '-',
      { label: 'Couper le câble', key: 'Suppr', danger: true, onclick: () => app.disconnect(c.a, c.b) },
    ]);
  }
  // le nom d'un porteur pour un menu : son module (et sa piste), sa machine, le clavier
  function nomCourt(id) {
    const x = app.mod(id);
    if (x) { const tr = x.track && app.track(x.track); return `${machineDef(x.mach?.id)?.name || moduleName(x.type)}${tr ? ` (${tr.name})` : ''}`; }
    const b = (nodalDe().blocs || []).find((y) => y.id === id);
    return b?.type === 'clavier' ? 'Clavier' : machineDef(b?.mach?.id)?.name || '?';
  }
  function ouvrirSurCable(e, c, only) {
    const at = versMonde(e.clientX, e.clientY);
    ouvrirPalette({ at: { x: e.clientX, y: e.clientY }, only, onPick: (type) => poser(type, at, { on: c }) });
  }

  // ── le verdict d'une liaison (liaisons.ts : rien ne se branche qui ne sait pas recevoir) ──
  function accepteNotes(pid) {
    const m = app.mod(pid);
    if (!m) return false;
    if (SONS.has(m.type)) return true;
    return !!MODULES[m.type]?.jouet && portsOf(m).some((q) => q.dir === 'in' && q.t === 'notes');
  }
  function verdictDe(a, b, sauf = []) {
    if (!a || !b || a === b) return 'un bloc ne se branche pas sur lui-même';
    const p = P();
    if (emetNotes(a)) {
      if (!accepteNotes(b)) return 'ce bloc ne se joue pas en notes';
      if (liensDe(p).some((l) => l.a === a && l.b === b)) return 'ce câble existe déjà';
      return null;
    }
    const A = app.mod(a), B = app.mod(b);
    if (!A || !B) return 'rien à faire passer : ce bloc n\'a pas de son';
    const tb = tuileDesPrises(b);
    if (!tb || !prisesDeTuile(tb).in) return `${MODULES[B.type]?.name || 'ce bloc'} n'a pas d'entrée`;
    if (sauf.length) {
      const cables = p.cables;
      p.cables = cables.filter((c) => !sauf.some((s) => s.a === c.a && s.b === c.b));
      const r = app.canConnect(a, b);
      p.cables = cables;
      return r;
    }
    return app.canConnect(a, b);
  }
  // Relier deux nœuds. Un câble tiré d'un nœud d'une piste vers un EFFET qui
  // n'est pas (encore) sur sa chaîne l'y fait entrer, juste après ce nœud :
  // c'est ainsi qu'un délai que deux pistes traversent est dans les deux
  // chaînes, et dans les deux racks (demande de Cal, 29/09 ; projet.js,
  // entrerDansLaChaine). Un jouet qu'on traverse n'entre que dans une chaîne :
  // sa scène est un seul son.
  function relier(a, b) {
    const p = P();
    if (emetNotes(a)) { const n = nodalDe(p); n.liens = [...(n.liens || []), { a, b, sig: 'notes' }]; return; }
    const B = app.mod(b), def = B && MODULES[B.type];
    if (def?.role === 'effect') {
      const Tj = trajets(p);
      const tid = (Tj.de.get(a) || []).find((x) => app.track(x)?.strip !== a && !Tj.dedans.get(x).has(b));
      if (tid && (!def.jouet || !(Tj.de.get(b) || []).length)) {
        const why = entrerDansLaChaine(p, a, b, tid, app.wouldCycle);
        if (!why) {
          if (!B.track) B.track = tid;
          const tr = app.track(tid), ps = Tj.de.get(b) || [];
          app.label(`« ${moduleName(B.type)} » dans la chaîne de « ${tr?.name} »`);
          toast(ps.length ? `${moduleName(B.type)} : aussi dans la chaîne de « ${tr?.name} » — un seul effet, lié dans les racks de ${[...ps, tid].map((x) => app.track(x)?.name).join(' et ')}` : `${moduleName(B.type)} entre dans la chaîne de « ${tr?.name} »`, 4500);
          return;
        }
      }
    }
    p.cables.push({ a, b });
  }
  // Tirer un câble depuis une sortie (App.tsx, `startCable`) : on lâche sur la TUILE
  function startCable(event, from, sig) {
    if (event.button !== 0) return;
    event.stopPropagation(); event.preventDefault();
    const accepts = (pid) => pid !== from && verdictDe(from, pid) === null;
    const surviole = (cx, cy) => {
      for (const e of document.elementsFromPoint(cx, cy)) { const t = e.closest?.('[data-block]'); if (t?.dataset.block) return t.dataset.block; }
      return null;
    };
    const targetAt = (cx, cy) => {
      const vise = surviole(cx, cy);
      if (vise) { const pid = porteurDe(vise); return accepts(pid) ? pid : null; }
      const q = versMonde(cx, cy), k = view().z, vus = new Set();
      let best = null;
      for (const t of T) {
        const pid = porteurDe(t.id);
        if (vus.has(pid) || !accepts(pid)) continue;
        vus.add(pid);
        const port = sig === 'notes' ? pointNotes(pid) : pointBorne(pid, 'in');
        if (!port) continue;
        const d = Math.hypot(port.x - q.x, port.y - q.y) * k;
        if (d <= CABLE_SNAP && (!best || d < best.d)) best = { id: pid, d };
      }
      return best?.id ?? null;
    };
    const s = versMonde(event.clientX, event.clientY);
    cabling = { from, sig, x: s.x, y: s.y, over: null, vise: null, refus: null };
    let dragged = false;
    const x0 = event.clientX, y0 = event.clientY;
    beginDrag(event, {
      cursor: 'crosshair',
      move: (m) => {
        if (!dragged && !isDrag(m.clientX - x0, m.clientY - y0)) return;
        dragged = true;
        const q = versMonde(m.clientX, m.clientY);
        const vise = surviole(m.clientX, m.clientY), vp = vise && porteurDe(vise);
        cabling = { from, sig, ...q, over: targetAt(m.clientX, m.clientY), vise: vise && vp !== from ? vise : null, refus: vise && vp !== from ? verdictDe(from, vp) : null };
        peindreCables();
      },
      end: (e) => {
        cabling = null;
        peindreCables();
        if (!e || !dragged) return;
        const to = targetAt(e.clientX, e.clientY);
        if (to) { relier(from, to); app.commit('graph'); return; }
        const vise = surviole(e.clientX, e.clientY);
        if (vise) { const v = verdictDe(from, porteurDe(vise)); if (v) toast(v); return; }
        // lâché dans le vide : la liste rapide, et le bloc naît branché
        const at = versMonde(e.clientX, e.clientY);
        ouvrirPalette({ at: { x: e.clientX, y: e.clientY }, only: sig === 'notes' ? 'INSTRUMENTS' : undefined, onPick: (type) => poser(type, at, { from }) });
      },
    });
  }

  // ═══════════════════════════════════════════ les liens de molettes (liens-knob.ts)
  const liensKnob = () => (nodalDe().liensKnob = nodalDe().liensKnob || []);
  const enBout = (cle) => { const i = cle.indexOf(' '); return { bloc: cle.slice(0, i), param: cle.slice(i + 1) }; };
  function propagerLien(cle, norm) {
    const liens = liensKnob();
    if (!liens.length) return;
    const touchees = new Set();
    for (const at of propager(liens, enBout(cle), norm)) {
      const t = parId.get(at.bout.bloc), info = t && infoTuile(t);
      const d = info?.parametres.find((q) => q.id === at.bout.param);
      if (d) { info.onParam(d.id, depuisNorme(d, at.norm)); touchees.add(t.id); }
    }
    if (touchees.size) rafraichir([...touchees]);
  }
  function tirerLien(cle, e0) {
    lienEnCours = { de: cle, x: e0.x, y: e0.y };
    peindreLiensKnob();
    const bouge = (e) => { lienEnCours = { ...lienEnCours, x: e.clientX, y: e.clientY }; peindreLiensKnob(); };
    const lache = (e) => {
      removeEventListener('pointermove', bouge); removeEventListener('pointerup', lache);
      const vise = elementAuPoint(e.clientX, e.clientY)?.closest?.('[data-bout]')?.getAttribute('data-bout');   // dans la fenêtre du geste
      if (vise && vise !== cle) { nodalDe().liensKnob = lierBouts(liensKnob(), enBout(cle), enBout(vise)); app.commit('quiet'); }
      lienEnCours = null;
      peindreLiensKnob();
    };
    addEventListener('pointermove', bouge); addEventListener('pointerup', lache);
  }
  // les fils DROITS entre molettes, au-dessus des blocs — on ne les voit QU'AU SURVOL
  function peindreLiensKnob() {
    put(liensSvg);
    const liens = nodalDe().liensKnob || [];
    if (!liens.length && !lienEnCours) return;
    const cadre = cv.getBoundingClientRect();
    const place = (cle) => {
      const n = world.querySelector(`[data-bout="${CSS.escape(cle)}"]`);
      if (!n) return null;
      const b = n.getBoundingClientRect();
      return { x: b.left - cadre.left + b.width / 2, y: b.top - cadre.top + b.height / 2, r: Math.max(3, Math.min(b.width, b.height) / 2) };
    };
    const trame = boutSurvole ? trameDe(liens, enBout(boutSurvole)) : [];
    for (const l of liens) {
      const allume = trame.some((o) => o.id === l.id);
      if (!allume && lienPris !== l.id) continue;
      const a = place(`${l.de.bloc} ${l.de.param}`), b = place(`${l.vers.bloc} ${l.vers.param}`);
      if (!a || !b) continue;
      const p1 = sortieDuBord(a, b, a.r), p2 = sortieDuBord(b, a, b.r);
      const g = sv('g', { class: allume ? 'lien lien--allume' : 'lien' });
      g.append(sv('line', { class: 'lien__fil', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }));
      const signe = sv('g', { class: lienPris === l.id ? 'lien__signe lien__signe--pris' : 'lien__signe', transform: `translate(${(p1.x + p2.x) / 2} ${(p1.y + p2.y) / 2})` });
      signe.append(sv('rect', { class: 'lien__signe-cadre', x: -11, y: -11, width: 22, height: 22 }), sv('line', { x1: -6, y1: 0, x2: 6, y2: 0 }));
      if (l.sens === 1) signe.append(sv('line', { x1: 0, y1: -6, x2: 0, y2: 6 }));
      signe.addEventListener('pointerdown', (e) => {
        if (e.button === 2) return;
        e.stopPropagation();
        lienPris = l.id;
        const y0 = e.clientY;
        const suit = (m) => { if (Math.abs(m.clientY - y0) < 4) return; const veut = m.clientY < y0 ? 1 : -1; nodalDe().liensKnob = liensKnob().map((o) => (o.id === l.id ? { ...o, sens: veut } : o)); peindreLiensKnob(); };
        const fin = () => { removeEventListener('pointermove', suit); removeEventListener('pointerup', fin); app.commit('quiet'); };
        addEventListener('pointermove', suit); addEventListener('pointerup', fin);
        peindreLiensKnob();
      });
      signe.addEventListener('dblclick', (e) => { e.stopPropagation(); nodalDe().liensKnob = retourner(liensKnob(), l.id); app.commit('quiet'); peindreLiensKnob(); });
      signe.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); nodalDe().liensKnob = delier(liensKnob(), l.id); if (lienPris === l.id) lienPris = null; app.commit('quiet'); peindreLiensKnob(); });
      g.append(signe);
      liensSvg.append(g);
    }
    if (lienEnCours) {
      const a = place(lienEnCours.de);
      if (a) { const vers = { x: lienEnCours.x - cadre.left, y: lienEnCours.y - cadre.top }, p1 = sortieDuBord(a, vers, a.r); liensSvg.append(sv('line', { class: 'lien__fil lien__fil--tirage', x1: p1.x, y1: p1.y, x2: vers.x, y2: vers.y })); }
    }
  }

  // ═══════════════════════════════════ le dessus : cadres, menus, séparateurs
  const fixe = (e, x, y) => { e.style.left = px(x); e.style.top = px(y); return e; };
  function bouton(cls, contenu, title, fn) {
    const b = h('button', cls);
    b.type = 'button';
    if (title) b.title = title;
    if (typeof contenu === 'string') b.textContent = contenu; else if (contenu) b.append(contenu);
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(e); });
    return b;
  }
  const glyphe = (d) => { const s = sv('svg', { class: 'glyph-pack', width: 11, height: 11, viewBox: '0 0 11 11' }); s.append(sv('path', { d, fill: 'none', stroke: 'currentColor' })); return s; };
  const PACK = 'M1.5 1.5h8v8h-8zM5.5 1.5v8M1.5 5.5h4';
  const MACHINE = 'M1.5 2.5h8v6h-8zM3.5 5.5h1M6.5 5.5h1';
  const DESIGN = 'M1.5 9.5l2-5 5-3-2 5zM3.5 4.5l3 2';
  function teinteBtn(teinte, ids) {
    const w = h('span', 'teinte');
    const past = h('span', teinte ? 'teinte-pastille teinte-pastille--pleine' : 'teinte-pastille');
    if (teinte) past.style.background = `var(--${teinte})`;
    let ouvert = null;
    w.append(bouton('group-menu__btn', past, 'Teinter cet ensemble — choisir une couleur', () => {
      if (ouvert) { ouvert.remove(); ouvert = null; return; }
      ouvert = h('span', 'teinte__nuancier');
      ouvert.addEventListener('pointerdown', (e) => e.stopPropagation());
      for (const c of TEINTES) { const b = bouton(c === teinte ? 'teinte__choix teinte__choix--prise' : 'teinte__choix', null, c, () => poserTeinte(ids, c)); b.style.background = `var(--${c})`; ouvert.append(b); }
      ouvert.append(bouton(teinte === null ? 'teinte__choix teinte__choix--prise' : 'teinte__choix', h('span', 'teinte__barre'), 'Aucune teinte', () => poserTeinte(ids, null)));
      w.append(ouvert);
    }));
    return w;
  }
  // le pourtour saisissable d'un ensemble (BoundsHandles.tsx) — à taille écran constante
  function poignees(rect, ids) {
    const out = [];
    for (const [edge, st] of [['n', { left: rect.x, top: rect.y, width: rect.w }], ['s', { left: rect.x, top: rect.y + rect.h, width: rect.w }], ['w', { left: rect.x, top: rect.y, height: rect.h }], ['e', { left: rect.x + rect.w, top: rect.y, height: rect.h }]]) {
      const e = h('span', `bounds-edge bounds-edge--${edge}`);
      for (const [k2, v] of Object.entries(st)) e.style[k2] = px(v);
      e.style.cursor = EDGE_CURSOR[edge];
      e.addEventListener('pointerdown', (ev) => startBoundsResize(ev, ids, edge));
      out.push(e);
    }
    for (const [edge, x, y] of [['nw', rect.x, rect.y], ['ne', rect.x + rect.w, rect.y], ['sw', rect.x, rect.y + rect.h], ['se', rect.x + rect.w, rect.y + rect.h]]) {
      const e = fixe(h('span', 'bounds-corner'), x, y);
      e.style.cursor = EDGE_CURSOR[edge];
      e.addEventListener('pointerdown', (ev) => startBoundsResize(ev, ids, edge));
      out.push(e);
    }
    return out;
  }
  function peindreDessus() {
    put(cadresEl); put(dessusEl);
    const groupes = new Map(), machines = new Map();
    for (const t of T) {
      if (t.group) { if (!groupes.has(t.group)) groupes.set(t.group, []); groupes.get(t.group).push(t); }
      if (t.machine) { if (!machines.has(t.machine)) machines.set(t.machine, []); machines.get(t.machine).push(t); }
    }
    const kids = [];
    // les commandes d'un groupe : un objet qui s'éteint, se range, se règle par ses séparateurs
    for (const [g, membres] of groupes) {
      const b = boundsOf(membres), ids = membres.map((t) => t.id), pris = ids.some((id) => sel.includes(id));
      const cadre = h('span', 'group-frame');
      Object.assign(cadre.style, { left: px(b.x), top: px(b.y), width: px(b.w), height: px(b.h) });
      cadresEl.append(cadre);
      const owners = [...new Set(membres.map((t) => porteurDeTuile(P(), t.id).owner).filter(Boolean))];
      const anyOn = owners.some((o) => o.on !== false);
      const menu = fixe(h('span', 'group-menu'), b.x, b.y);
      menu.append(bouton('group-menu__btn', h('span', `led led--${!anyOn ? 'off' : app.engine.running ? 'on' : 'idle'}`), anyOn ? 'Éteindre tout le groupe' : 'Allumer tout le groupe', () => basculerGroupe(g)));
      menu.append(bouton('group-menu__btn', glyphe(PACK), 'Ranger (T) : redresser et resserrer, sans jamais déplacer un bloc par rapport aux autres', () => tidy(g)));
      if (isWeldedGroup(g)) {
        const pid = porteurDe(membres[0].id);
        menu.append(bouton('group-menu__btn', glyphe(MACHINE), 'Remonter la machine : rendre à chaque section sa place enregistrée', () => reassembleMachine(pid)));
        const d = bouton(`group-menu__btn${machinePanel === pid ? ' group-menu__btn--on' : ''}`, glyphe(DESIGN), 'Le poste de conception de cette machine — glisser compose, clic milieu : l\'ordre d\'importance, T : optimiser', () => { machinePanel = machinePanel === pid ? null : pid; prisDansBloc = null; render(); });
        d.setAttribute('aria-pressed', String(machinePanel === pid));
        menu.append(d);
      }
      menu.append(teinteBtn(membres[0].teinte || null, ids));
      kids.push(menu);
      // une barre par ligne qui traverse le groupe, et leurs croisements
      const dividers = listDividers(membres.filter((t) => !t.jouet));
      for (const dv of dividers) {
        const e = h('span', `divider divider--${dv.axis}`);
        if (dv.axis === 'x') Object.assign(e.style, { left: px(dv.at), top: px(b.y), height: px(b.h) });
        else Object.assign(e.style, { left: px(b.x), top: px(dv.at), width: px(b.w) });
        e.title = 'Séparateur — glisser pour répartir la place (⌥ libère l\'aimantation)';
        e.addEventListener('pointerdown', (ev) => startDividerDrag(ev, g, [dv]));
        kids.push(e);
      }
      for (const dx of dividers.filter((x) => x.axis === 'x')) for (const dy of dividers.filter((x) => x.axis === 'y')) {
        const j = fixe(h('span', 'junction'), dx.at, dy.at);
        j.title = 'Croisement — glisser pour déplacer les deux séparateurs';
        j.addEventListener('pointerdown', (ev) => startDividerDrag(ev, g, [dx, dy]));
        kids.push(j);
      }
      if (pris) kids.push(...poignees(b, ids));
    }
    // LE NOM DES MACHINES — au-dessus, justifié à droite, à taille constante
    for (const [inst, membres] of machines) {
      const b = boundsOf(membres), pid = porteurDe(membres[0].id), { owner } = porteurDeTuile(P(), membres[0].id);
      const def = owner?.mach && machineDef(owner.mach.id);
      if (b.w * view().z >= 24) { const n = fixe(h('span', 'machine-titre'), b.x + b.w, b.y); n.textContent = def?.name || ''; kids.push(n); }
      if (membres[0].group !== inst) {
        // une machine OUVERTE garde sa commande de remontage
        const menu = fixe(h('span', 'group-menu group-menu--open'), b.x, b.y);
        menu.append(bouton('group-menu__btn', glyphe(MACHINE), 'Remonter la machine : rendre à chaque section sa place enregistrée', () => reassembleMachine(pid)),
          bouton('group-menu__btn', glyphe(DESIGN), 'Le poste de conception de cette machine', () => { machinePanel = machinePanel === pid ? null : pid; render(); }),
          teinteBtn(membres[0].teinte || null, membres.map((t) => t.id)));
        kids.push(menu);
      }
      if (machinePanel === pid) kids.push(posteDeConception(def, pid, b));
    }
    // LE NOM DES PISTES sur leur nœud de départ (Cal, 29/09 : « le nom d'une
    // piste de l'arrangement est ce qui doit être bien visible ») : au-dessus
    // de la source (ou de toute la machine), à taille d'écran constante — il
    // reste lisible à tous les reculs, là où l'en-tête de la tuile se tait —,
    // à la couleur de la piste. Sa pastille ouvre la palette ; double-clic sur
    // le nom : le renommer ; clic : choisir le nœud.
    const parPiste = new Map();
    for (const t of T) if (t.piste) { if (!parPiste.has(t.piste)) parPiste.set(t.piste, []); parPiste.get(t.piste).push(t); }
    for (const [tid, membres] of parPiste) {
      const tr = app.track(tid);
      if (!tr) continue;
      const b = boundsOf(membres);
      const lab = fixe(h('span', `piste-titre${membres[0].group ? ' piste-titre--groupe' : ''}${tid === S.sel.track ? ' piste-titre--courante' : ''}`), b.x, b.y);
      lab.dataset.piste = tid;
      lab.style.setProperty('--c', `var(--${tr.color})`);
      const past = bouton('piste-titre__couleur', null, `la couleur de « ${tr.name} » — celle de sa piste dans l'arrangement · clic : la palette`, (ev) => menu(ev.clientX, ev.clientY,
        [{ head: `couleur de « ${tr.name} »` }, ...COLORS.map((c) => ({ label: COLOR_FR[c], dot: c, checked: tr.color === c, onclick: () => app.setTrackColor(tid, c) }))]));
      const nm = h('span', 'nm');
      nm.textContent = tr.name;
      nm.title = `la piste « ${tr.name} » · glisser : déplacer son nœud · double-clic : la renommer · clic droit : son menu`;
      nm.addEventListener('dblclick', (ev) => { ev.stopPropagation(); renommerPiste(tid); });
      lab.append(past, nm);
      // L'ÉTIQUETTE SE GLISSE (Cal, 29/09 : « il faut qu'on puisse déplacer les
      // nodes de piste par la grosse étiquette ») : elle vaut l'en-tête de son
      // nœud — les mêmes touches pour choisir, le même déplacement (la
      // sélection, le groupe, la machine soudée ; ⌥ duplique), le même
      // aimant, le même Ctrl+Z (un seul commit, à la fin du geste)
      lab.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0 || ev.target.closest('input')) return;
        const mode = modeDe(ev);
        if (mode !== 'remove') choisirPiste(ev, withFamilies(membres.map((x) => x.id)), mode);
        startMove(ev, membres[0].id);
      });
      lab.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); if (!sel.includes(membres[0].id)) setSel(withFamilies(membres.map((x) => x.id))); const it = menuTuile(membres[0]); if (it) menu(ev.clientX, ev.clientY, it); });
      kids.push(lab);
    }
    // une sélection de plusieurs blocs se redimensionne comme un groupe
    if (sel.length > 1) {
      const members = T.filter((t) => sel.includes(t.id)), gs = new Set(members.map((t) => t.group));
      if (members.length > 1 && !(gs.size === 1 && members[0].group)) {
        const b = boundsOf(members), f = h('span', 'selection-frame');
        Object.assign(f.style, { left: px(b.x), top: px(b.y), width: px(b.w), height: px(b.h) });
        kids.push(f, ...poignees(b, sel));
      }
    }
    for (const g of guides) { const e = h('span', `guide guide--${g.axis}`); if (g.axis === 'x') e.style.left = px(g.at); else e.style.top = px(g.at); kids.push(e); }
    if (marquee) { const e = h('span', 'marquee'); Object.assign(e.style, { left: px(marquee.x), top: px(marquee.y), width: px(marquee.w), height: px(marquee.h) }); kids.push(e); }
    dessusEl.append(...kids);
  }
  // le poste de conception (MachineDesignPanel.tsx) : une étiquette au-dessus de la machine
  function posteDeConception(def, pid, b) {
    const p = fixe(h('div', 'machine-panel machine-panel--etiquette'), b.x, b.y);
    p.addEventListener('pointerdown', (e) => e.stopPropagation());
    p.addEventListener('wheel', (e) => e.stopPropagation());
    const nom = h('span', 'machine-panel__name'); nom.textContent = def?.name || '';
    const aide = h('span', 'machine-panel__aide'); aide.textContent = 'édition — glisser compose · clic milieu : l\'ordre d\'importance · T : optimiser';
    const distance = (titre, v, set, title) => {
      const l = h('label', 'machine-panel__distance'); l.title = title;
      const s = h('span'); s.textContent = titre;
      const i = h('input'); i.type = 'number'; i.min = '0'; i.max = '40'; i.step = '1'; i.value = String(v);
      i.addEventListener('keydown', (e) => e.stopPropagation());
      i.addEventListener('change', () => { const n = Number(i.value); if (Number.isFinite(n)) set(n); });
      l.append(s, i);
      return l;
    };
    p.append(nom, aide,
      distance('bord', getMargeBord(), setMargeBord, 'Distance de sécurité entre un élément et le bord du bloc, en mm de section'),
      distance('écart', getEcartElements(), setEcartElements, 'Écart minimal entre deux éléments, en mm de section — butée des gestes et de « T »'),
      bouton('tb ghost sm', 'enregistrer', 'Enregistrer la configuration : les places des blocs de cette machine', () => saveMachine(pid)),
      bouton('tb ghost sm', 'planogramme', 'Oublier la configuration : places des blocs et cotes retouchées, retour au planogramme', () => forgetMachine(pid)),
      bouton('machine-panel__close', '×', 'Fermer', () => { machinePanel = null; prisDansBloc = null; render(); }));
    return p;
  }

  // ═════════════════════════════════ le panneau des seuils (Seuils.tsx)
  const PLANCHER_LIGNES = [['knob', 'knob'], ['switch', 'sélecteur'], ['fader', 'fader'], ['button', 'bouton · pas'], ['pad', 'pad'], ['wheel', 'molette'], ['key', 'touche'],
    ['led', 'diode'], ['ribbon', 'ruban'], ['vu', 'vu'], ['orbit', 'pad orbital'], ['matrix', 'matrice'], ['curve', 'courbe'], ['display', 'afficheur']];
  function curseur(label, min, max, step, v, set, fmt) {
    const l = h('label', 'machine-panel__row');
    const s = h('span', 'machine-panel__label'); s.textContent = label;
    const i = h('input'); Object.assign(i, { type: 'range', min: String(min), max: String(max), step: String(step), value: String(v) });
    const o = h('span', 'machine-panel__value'); o.textContent = fmt(v);
    i.addEventListener('input', () => { set(Number(i.value)); o.textContent = fmt(Number(i.value)); });
    l.append(s, i, o);
    return l;
  }
  function peindreSeuils(reconstruire = true) {
    if (!seuilsOuvert) { put(ecran); return; }
    const zEl = ecran.querySelector('.ndx-seuils-zoom');
    if (!reconstruire && zEl) { zEl.textContent = `zoom caméra ×${view().z.toFixed(2)}${view().z < getSeuilSemantique() ? ' — sous le dézoom max : la sémantique est gelée, tout rétrécit ensemble' : ' — la sémantique suit le zoom'}`; return; }
    const p = h('div', 'machine-panel ndx-seuils');
    p.addEventListener('pointerdown', (e) => e.stopPropagation());
    p.addEventListener('wheel', (e) => e.stopPropagation());
    const tete = h('div', 'machine-panel__head');
    const n = h('span', 'machine-panel__name'); n.textContent = 'seuils';
    tete.append(n, bouton('machine-panel__close', '×', 'Fermer', () => { seuilsOuvert = false; peindreSeuils(); peindreOutils(); }));
    const z = h('p', 'machine-panel__aide ndx-seuils-zoom');
    const aide = h('p', 'machine-panel__aide'); aide.textContent = 'Dézoome, observe à quelle taille d\'écran un élément cesse de dire quelque chose, règle le plancher de son type — puis « copier » pour en faire les défauts du code.';
    const corps = h('div', 'machine-panel__scroll');
    const grp = (titre, ...enfants) => { const g = h('div', 'machine-panel__group'); const t = h('span', 'machine-panel__title'); t.textContent = titre; g.append(t, ...enfants); return g; };
    corps.append(
      grp('présence relative — le moteur de la cascade', curseur('jamais sous', 0.2, 0.9, 0.05, getPresenceRelative(), setPresenceRelative, (v) => `${Math.round(v * 100)} %`)),
      grp('dézoom max de la sémantique', curseur('gel sous ×', 0.05, 1, 0.05, getSeuilSemantique(), setSeuilSemantique, (v) => v.toFixed(2))),
      grp('planchers de présence, par type', ...PLANCHER_LIGNES.map(([k2, l]) => curseur(l, 2, 24, 1, getPlanchers()[k2] ?? 7, (v) => setPlancher(k2, v), (v) => String(v)))));
    const act = h('div', 'machine-panel__actions');
    act.append(bouton('tb ghost sm', 'défauts', 'Revenir aux valeurs par défaut du code', () => { resetPlanchers(); peindreSeuils(); }),
      bouton('tb ghost sm', 'copier', 'Copier les planchers pour les coller dans la conversation', () => navigator.clipboard?.writeText(JSON.stringify({ presenceRelative: getPresenceRelative(), planchers: getPlanchers() }, null, 1)).then(() => toast('planchers copiés'))));
    p.append(tete, z, aide, corps, act);
    put(ecran, p);
    peindreSeuils(false);
  }

  // ═══════════════════════════════════════════════ jouer (App.tsx, `strike`)
  function strike(tileId, note) {
    const { owner } = porteurDeTuile(P(), tileId);
    if (!owner) return;
    const vel = owner.type === 'clavier' ? owner.params?.velocite || 0.8 : 0.8;
    const dur = owner.type === 'clavier' ? owner.params?.duree || 0.4 : 0.4;
    jouerNotes(app, owner.id, note, vel, dur);
    if (!held.includes(note)) held = [...held, note];
    if (owner.type === 'clavier') rafraichir([tileId]);
    setTimeout(() => { held = held.filter((n) => n !== note); if (owner.type === 'clavier') rafraichir([tileId]); }, Math.max(120, dur * 1000));
  }
  // les touches de l'ordinateur jouent QUAND un clavier est désigné SEUL
  function clavierDesigne() {
    if (sel.length !== 1) return null;
    const t = parId.get(sel[0]);
    if (!t) return null;
    const { owner, sec } = porteurDeTuile(P(), t.id);
    if (owner?.type === 'clavier') return t.id;
    if (owner?.mach && moteurDe(owner.mach.id)?.voice === 'notes' && sec) return t.id;
    return null;
  }

  // ═════════════════════════════════════════════════ le fond : les gestes
  // LE BOUTON DU MILIEU — déclaré à un seul endroit, comme dans ODIO_01
  // (App.tsx, `onMiddleDown`, l. 577-606) : il déplace la vue PARTOUT, sauf
  // là où un geste le revendique et le déclare —
  //   la borne (on la fait glisser le long du bloc, ODIO_01) ;
  //   une section de machine en édition (le tracé d'ordre de son panneau, ODIO_01) ;
  //   une molette de machine hors édition (tirer un lien de molettes, ODIO_01) ;
  //   les RÉGLAGES d'une tuile (29/09, Cal : « on dessinait avec l'appui de ce
  //   bouton milieu et on définissait à la volée quel paramètre est le plus
  //   important à conserver lors du zoom sémantique ») : le tracé d'ordre
  //   d'ODIO_01, porté sur les nœuds du nodal (tracerOrdreTuile, plus bas).
  // L'en-tête d'une tuile, ses arêtes, le fond, les câbles : la vue part.
  cv.addEventListener('pointerdown', (e) => {
    const cible = e.target;
    if (!cible.closest('input, textarea, [contenteditable="true"]')) { try { cv.focus({ preventScroll: true }); } catch { /* cadre */ } }
    if (e.button === 1) {
      if (cible.closest('.ndx-borne')) return;
      if (machinePanel && cible.closest('.machine')) return;
      if (!machinePanel && cible.closest('[data-bout]')) return;
      const tuile = cible.closest('.tile');
      const t = tuile && parId.get(tuile.dataset.id);
      if (t && !t.sec && !t.jouet && cible.closest('.tile__body')) { e.preventDefault(); e.stopPropagation(); tracerOrdreTuile(e, t.id); return; }
      e.preventDefault(); e.stopPropagation();
      startPan(e);
    }
  }, true);

  // LE TRACÉ D'ORDRE SUR UNE TUILE — ODIO_01, MachinePanel.tsx, `tracerOrdre`
  // (l. 830-871 ; porté pour les sections de machine dans machines/panneau.js).
  // Bouton du milieu enfoncé, on passe une courbe sur les réglages de la
  // tuile : l'ordre de la TRAVERSÉE devient l'ordre d'exposition. Le premier
  // traversé est le réglage exposé (en grand quand plus rien ne tient) ; les
  // suivants passent en tête des rails, dans cet ordre — le zoom sémantique
  // retire par la fin (corps.js, resolveSlots s'arrête au premier qui ne
  // rentre plus), donc ce qu'on a tracé en premier reste le plus longtemps.
  // Un tracé qui ne traverse rien efface l'ordre : la tuile revient à la
  // disposition de son bloc. Les rangs s'affichent pendant le tracé et le
  // temps de les relire, 2,6 s (ODIO_01 : « un ordre qu'on vient de tracer et
  // qui disparaît aussitôt ne s'est pas vu »).
  function tracerOrdreTuile(e, tileId) {
    const vue = vues.get(tileId), t = parId.get(tileId), info = t && infoTuile(t);
    if (!vue || !info) return;
    const ids = new Set(info.parametres.map((d) => d.id));
    const cadre = cv.getBoundingClientRect();
    // les boîtes des réglages rendus (ODIO_01 : `boites`, les contrôles du rendu)
    const boites = [...vue.el.querySelectorAll('[data-param]')].filter((n) => ids.has(n.dataset.param))
      .map((n) => ({ id: n.dataset.param, r: n.getBoundingClientRect() }));
    const vus = [], points = [];
    const svg = sv('svg', { class: 'machine__courbe ndx-trace', width: cadre.width, height: cadre.height });
    const pl = sv('polyline');
    svg.append(pl);
    const rangs = h('div', 'ndx-rangs');
    cv.append(svg, rangs);
    const montrer = () => put(rangs, ...vus.map((id, i) => {
      const b = boites.find((x) => x.id === id);
      const s = h('span', 'machine__rang');
      s.textContent = String(i + 1);
      s.style.left = px(b.r.left - cadre.left); s.style.top = px(b.r.top - cadre.top);
      return s;
    }));
    let der = null;
    const toucher = (cx, cy) => {
      // entre deux événements, la courbe passe par les points intermédiaires (tous les 4 px)
      const pas = der ? Math.max(1, Math.ceil(Math.hypot(cx - der.x, cy - der.y) / 4)) : 1;
      for (let i = 1; i <= pas; i++) {
        const x = der ? der.x + ((cx - der.x) * i) / pas : cx, y = der ? der.y + ((cy - der.y) * i) / pas : cy;
        for (const b of boites) if (x >= b.r.left && x <= b.r.right && y >= b.r.top && y <= b.r.bottom && !vus.includes(b.id)) { vus.push(b.id); montrer(); }
      }
      der = { x: cx, y: cy };
      points.push(`${cx - cadre.left},${cy - cadre.top}`);
      pl.setAttribute('points', points.join(' '));
    };
    toucher(e.clientX, e.clientY);
    beginDrag({ currentTarget: null, pointerId: e.pointerId }, {
      cursor: 'crosshair',
      move: (m) => toucher(m.clientX, m.clientY),
      end: () => {
        svg.remove();
        const o = reglage('ordre'), x = reglage('expose');
        if (vus.length) { o[tileId] = [...vus]; x[tileId] = vus[0]; } else { delete o[tileId]; delete x[tileId]; }
        app.label(vus.length ? `tracer l'ordre de « ${info.nom} » : ${vus.map((id) => info.parametres.find((d) => d.id === id)?.label).join(', ')}` : `effacer l'ordre de « ${info.nom} »`);
        app.commit('quiet');
        rafraichir([tileId], true);
        stats.trace = { tuile: tileId, ordre: [...vus] };
        setTimeout(() => rangs.remove(), 2600);
      },
    });
  }
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.tile, .nd-card, .bn-meta, .bn-atr, .nd-tools, .nd-zoom, .ndx-seuils, .group-menu, .machine-panel, .ndx-borne, .jump, .bounds-edge, .bounds-corner, .divider, .junction, .cable__hit, .lien__signe')) return;
    if (S.sel.cable) { S.sel.cable = null; paintCableClass(); paintSide(); }
    if (lienPris) { lienPris = null; peindreLiensKnob(); }
    e.preventDefault();
    startMarquee(e);
  });
  cv.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  // la souris ET le pavé, sans réglage (commun/molette.js, brancherCanvas ; comme l'Idéation) : pincer = zoom,
  // deux doigts = déplacer la vue, molette à crans = zoom ancré. Le zoomAt de la caméra veut un « deltaY » :
  // un facteur f vaut ln f / ln 0,9988
  const enregistrerVue = () => { clearTimeout(cv._t); cv._t = setTimeout(() => app.saveUi(), 500); };
  brancherCanvas(cv, {
    ignore: (e) => !!e.target.closest?.('.palette, .cat, .machine-panel, .ndx-seuils, .nd-tools, .nd-zoom'),
    zoom: (f, cx, cy) => {
      const r = cv.getBoundingClientRect();
      gesteVue();
      poserCam(zoomCamera(cam(), Math.log(f) / Math.log(0.9988), cx - r.left, cy - r.top, plancherCamera(plancher)));
      demanderVue(); enregistrerVue();
    },
    pan: (dx, dy) => {
      gesteVue();
      const c = cam();
      poserCam({ ...c, x: c.x + dx / c.k, y: c.y + dy / c.k });
      demanderVue(); enregistrerVue();
    },
  });
  cv.addEventListener('dblclick', (e) => {
    if (e.target.closest('.tile, .nd-card, .bn-meta, .bn-atr, .nd-tools, .nd-zoom, .machine-panel, .group-menu, .cable__hit, .ndx-borne')) return;
    ouvrirLeCatalogue(versMonde(e.clientX, e.clientY));
  });

  // ── le clavier : il revient au canvas dès qu'on y touche (App.tsx) ──
  // (partout : la page et la fenêtre du nodal détaché — un clic là-bas lui donne le clavier)
  partout('pointerdown', (e) => { actif = cv.contains(e.target); }, true);
  addEventListener('keydown', (e) => {
    if (!vueNodal() || !S.proj || !actif || !cv.isConnected) return;
    // un menu ouvert (commun/menu.js) garde le clavier : Échap le ferme, Suppr n'y retire rien
    if (e.target.closest?.('input, textarea, select, [contenteditable]') || $partout('.plano, .cat--fenetre, .scrim, .sr-menu')) return;
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Delete' || e.key === 'Backspace') { if (supprimer()) stop(); return; }
    if (e.key === 'Escape') { if (S.sel.cable || lienPris || sel.length) { stop(); S.sel.cable = null; lienPris = null; setSel([]); peindreLiensKnob(); } return; }
    if (ctrl) return;
    const k = clavierDesigne();
    if (k && e.code in COMPUTER_KEYS && !e.altKey) {
      stop();
      if (!e.repeat) { const { owner } = porteurDeTuile(P(), k); strike(k, 48 + Math.round(owner.params?.octave ?? 0) * 12 + COMPUTER_KEYS[e.code]); }
      return;
    }
    // les lettres par e.key (ui.js, letter) : juste en AZERTY comme en QWERTY ; ⌥G : e.code, ⌥ change la lettre sur Mac
    const L = letter(e);
    if (L === 'g' || (e.altKey && e.code === 'KeyG')) { stop(); if (e.altKey) ungroupBlocks(); else toggleGroup(); return; }
    if (e.altKey || e.shiftKey) return;
    if (L === 'f') { stop(); focusOn(); return; }
    if (L === 't') {
      stop();
      // en mode ÉLÉMENT, T appartient au panneau : il range des contrôles
      if (machinePanel) {
        const cible = prisDansBloc?.bloc || (sel.length === 1 ? sel[0] : null);
        const v = cible && vues.get(cible);
        if (v?.panneau?.ranger?.()) { rafraichir([cible], true); return; }
        if (cible && porteurDe(cible) === machinePanel) return;
      }
      tidySelection();
    }
  }, true);
  // ═══════════════════════════ le clic droit : le menu de ce qu'on survole
  // (musique.js l'appelle quand la zone n'a pas ouvert le sien) : le fond, une
  // tuile (nœud de départ d'une piste, effet, section de machine, clavier), un
  // jouet, une borne, le banc et ses attracteurs, le panneau de droite
  function zoneMenu(e) {
    const tg = e.target;
    if (bench.el.contains(tg) || tg.closest?.('.bn-meta')) return bench.menuDe?.(e) || null;
    const at = versMonde(e.clientX, e.clientY);
    const borne = tg.closest?.('.ndx-borne');
    if (borne) {
      const tile = [...T].find((x) => porteurDe(x.id) === borne.dataset.porteur && prisesDeTuile(x)[borne.dataset.side]);
      return [{ head: borne.dataset.side === 'out' ? 'sortie — glisser : un câble' : 'entrée' },
        { label: 'Remettre la borne à sa place', onclick: () => { const r = reglage('ports'); if (tile && r[tile.id]) { delete r[tile.id][borne.dataset.side]; app.commit('quiet'); apresGeste(); } } },
        { label: 'Couper ses câbles', danger: true, onclick: () => { const pid = borne.dataset.porteur, out = borne.dataset.side === 'out'; P().cables = P().cables.filter((c) => c.t || (out ? c.a !== pid : c.b !== pid)); app.commit('graph'); } }];
    }
    const card = tg.closest?.('.tile, .nd-card');
    if (card?.dataset.id) {
      const t = parId.get(card.dataset.id);
      if (!t) return null;
      if (!sel.includes(t.id)) selectBlock(t.id, 'replace');
      if (t.jouet) return menuJouet(t, tg);
      return menuTuile(t);
    }
    if (side.contains(tg)) return [{ head: 'le panneau de droite' }, { label: 'Le catalogue', onclick: () => ouvrirLeCatalogue(null) }, { label: 'Cadrer toute la scène', key: 'F', onclick: () => focusOn(true) }];
    // le fond (et les barres d'outils du nodal)
    return [
      { head: 'le nodal' },
      { label: 'Le catalogue…', sub: 'double-clic', onclick: () => ouvrirLeCatalogue(at) },
      { label: 'Poser ici', items: [
        ...[['piste:synth:synth', 'Une piste · synthé'], ['piste:synth:acid', 'Une piste · basse acide'], ['piste:drums:rythme', 'Une piste · boîte à rythme']].map(([ty, l]) => ({ label: l, onclick: () => poser(ty, at) })),
        '-', ...['rtt', 'reverbe', 'filtre', 'satura', 'comp3', 'chorus'].filter((k) => MODULES[k]).map((k) => ({ label: MODULES[k].name, sub: 'effet', dot: MODULES[k].color, onclick: () => poser(`effet:${k}`, at) })),
        '-', { label: 'Un clavier', onclick: () => poser('bloc:clavier', at) }] },
      '-',
      { label: 'Tout choisir', onclick: () => setSel(T.map((x) => x.id)) },
      { label: 'Ne rien choisir', key: 'Échap', disabled: !sel.length, why: 'rien n\'est choisi', onclick: () => setSel([]) },
      { label: 'Grouper la sélection', key: 'G', disabled: sel.length < 2, why: 'choisir au moins deux blocs', onclick: () => toggleGroup() },
      { label: 'Ranger', key: 'T', disabled: !sel.length, why: 'rien n\'est choisi', onclick: () => tidySelection() },
      { label: sel.length ? 'Cadrer la sélection' : 'Cadrer toute la scène', key: 'F', onclick: () => focusOn() },
      { label: 'Revenir à 100 %', onclick: () => { const r = cv.getBoundingClientRect(), c = cam(); const cx = c.x + r.width / (2 * c.k), cy = c.y + r.height / (2 * c.k); gesteVue(); poserCam({ k: 1, x: cx - r.width / 2, y: cy - r.height / 2 }); appliquerVue(); app.saveUi(); } },
      { label: 'Aimanter aux voisins', key: 'Ctrl+4', checked: aimante(), title: '⌥ en glissant : libre le temps du geste', onclick: () => basculerAimant() },
      '-',
      { label: 'PLANO', sub: 'dessiner une machine', onclick: ouvrirLePlano },
      { label: seuilsOuvert ? 'Fermer les seuils' : 'Les seuils du zoom sémantique', onclick: () => { seuilsOuvert = !seuilsOuvert; peindreSeuils(); peindreOutils(); } },
      // le nodal dans une fenêtre (un 2ᵉ écran), ou de retour dans la page (commun/fenetre.js)
      ...(app.fenetres ? ['-', app.fenetres.entree('nodal')] : []),
    ];
  }
  // le menu d'une tuile : ce qu'elle est (nœud de départ d'une piste, effet partagé, section de machine…)
  function menuTuile(t) {
    const info = infoTuile(t), { owner } = porteurDeTuile(P(), t.id);
    if (!info || !owner) return null;
    const tr = t.piste && app.track(t.piste);
    const m = app.mod(owner.id), def = m && MODULES[m.type];
    const ps = m ? app.linked(m.id) : [];
    const ordre = ordreDe(t.id) || [], ex = expose(t.id);
    const ids = sel.includes(t.id) ? sel : [t.id];
    const exposer = (id) => { const o = reglage('ordre'), x = reglage('expose'); if (id) { x[t.id] = id; o[t.id] = [id, ...(o[t.id] || []).filter((q) => q !== id)]; } else { delete x[t.id]; delete o[t.id]; } app.commit('quiet'); rafraichir([t.id], true); };
    return [
      { head: tr ? `piste · ${tr.name}` : info.nom },
      tr ? { label: 'Couleur de la piste', dot: tr.color, items: COLORS.map((c) => ({ label: COLOR_FR[c], dot: c, checked: tr.color === c, onclick: () => app.setTrackColor(tr.id, c) })) } : null,
      tr ? { label: 'Renommer la piste', onclick: () => renommerPiste(tr.id) } : null,
      tr ? { label: 'Voir dans l\'arrangement', onclick: () => { app.selectTrack(tr.id); app.setView('timeline'); } } : null,
      m?.track || ps.length ? { label: 'Instruments et effets de sa piste', onclick: () => { S.sel.track = m.track || ps[0]; S.sel.mod = m.id; app.showDetail('device'); } } : null,
      ps.length > 1 ? { head: `effet lié · chaînes de ${ps.map((x) => app.track(x)?.name).join(', ')}` } : null,
      ...(ps.length > 1 ? ps.map((x) => ({ label: `Sortir de la chaîne de « ${app.track(x)?.name} »`, onclick: () => app.removeFromTrack(m.id, x) })) : []),
      '-',
      info.parametres.length && !t.sec ? { label: 'Exposer', sub: 'ou tracer au bouton du milieu', items: [
        ...info.parametres.map((d) => ({ label: d.label, checked: ex === d.id, onclick: () => exposer(ex === d.id ? null : d.id) })),
        '-', { label: 'Effacer l\'ordre tracé', disabled: !ordre.length && !ex, why: 'aucun ordre tracé', onclick: () => exposer(null) }] } : null,
      { label: 'Renommer le bloc', sub: 'double-clic sur son nom', onclick: () => { const n = vues.get(t.id)?.el.querySelector('.tile__name'); if (n) renommer(t.id, n); } },
      { label: 'Taille d\'origine', sub: 'double-clic sur l\'en-tête', onclick: () => resetSize(t.id) },
      info.power ? { label: info.enabled ? 'Éteindre' : 'Allumer', onclick: () => basculer(t.id) } : null,
      { label: 'Dupliquer', sub: '⌥ glisser', onclick: () => { const born = dupliquer(ids); for (const id of born) { const b = parId.get(id); if (b) ecrireBoite(P(), id, { ...b, x: b.x + 40, y: b.y + 40 }); } sel = born; app.commit('graph'); } },
      t.machine ? { label: 'Remonter la machine', key: 'T', onclick: () => reassembleMachine(porteurDe(t.id)) } : null,
      t.machine ? { label: machinePanel === porteurDe(t.id) ? 'Fin de conception' : 'Poste de conception', sub: 'clic milieu : l\'ordre d\'importance', onclick: () => { const pid = porteurDe(t.id); machinePanel = machinePanel === pid ? null : pid; prisDansBloc = null; render(); } } : null,
      sel.length > 1 ? { label: 'Grouper', key: 'G', onclick: () => toggleGroup() } : t.group && !t.machine ? { label: 'Dégrouper', key: '⌥G', onclick: () => ungroupBlocks() } : null,
      !tr ? { label: 'Teinte', items: [...TEINTES.map((c) => ({ label: c, dot: c, checked: t.teinte === c, onclick: () => poserTeinte(ids, c) })), { label: 'Aucune', onclick: () => poserTeinte(ids, null) }] } : null,
      '-',
      def?.role === 'master' ? null : { label: tr ? `Retirer la piste « ${tr.name} »` : 'Retirer', key: 'Suppr', danger: true, onclick: () => retirerTuiles(ids) },
    ];
  }
  function menuJouet(t, tg) {
    const m = app.mod(t.mod), def = m && MODULES[m.type];
    if (!m) return null;
    // le FLIPPER et la NAVETTE jouent du bouton droit dans leur scène : pas de menu là
    if (tg.closest('.jo-cv') && ['pin', 'inv'].includes(m.type)) return [];
    return [
      { head: `jouet · ${def?.name || m.type}` },
      { label: m.on === false ? 'Allumer' : 'Éteindre', onclick: () => { m.on = m.on === false; app.commit('graph'); } },
      { label: 'Cadrer', key: 'F', onclick: () => focusOn() },
      '-',
      { label: 'Retirer', key: 'Suppr', danger: true, onclick: () => { if (!app.toys?.remove(m.id)) app.removeModule(m.id); } },
    ];
  }
  // renommer une piste depuis le nodal : son étiquette devient un champ
  function renommerPiste(tid) {
    const tr = app.track(tid), lab = dessusEl.querySelector(`.piste-titre[data-piste="${tid}"] .nm`);
    if (!tr) return;
    if (lab) inlineEdit(lab, tr.name, (n) => { tr.name = n.slice(0, 60); app.label(`renommer la piste en « ${tr.name} »`); app.commit('data'); }, { max: 60 });
  }

  function supprimer() {
    if (lienPris) { nodalDe().liensKnob = delier(liensKnob(), lienPris); lienPris = null; app.commit('quiet'); peindreLiensKnob(); return true; }
    if (S.sel.cable) {
      const key = S.sel.cable;
      S.sel.cable = null;
      if (key.startsWith('L:')) { const [a, b] = key.slice(2).split('>'); const n = nodalDe(); n.liens = (n.liens || []).filter((l) => !(l.a === a && l.b === b)); app.commit('graph'); }
      else { const [a, b] = key.split('>'); app.disconnect(a, b); }
      return true;
    }
    if (sel.length) { retirerTuiles(sel); return true; }
    if (S.sel.mod && app.toys?.remove(S.sel.mod)) return true;   // jouets : un jouet sans son se retire aussi
    return false;
  }

  // ═════════════════════════════════════════════════════ les outils
  const HINT = 'clic milieu glissé ou deux doigts : se déplacer (sur les réglages d\'une tuile : tracer ce qu\'elle garde au zoom) · molette ou pincer : zoom · clic : choisir, Maj : ajouter, Ctrl : ajouter ou retirer · glisser le fond : cadre · double-clic : le catalogue · ⌥ glissé : dupliquer · Ctrl+4 : aimant · T ranger · G grouper · F cadrer · clic droit : le menu';
  function peindreOutils() {
    const p = P();
    put(tools,
      el('button', { class: 'tb ghost sm', type: 'button', title: 'Le catalogue : les blocs, les instruments, les machines, le Playground (double-clic sur le fond)', onclick: () => ouvrirLeCatalogue(null) }, 'Catalogue'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'PLANO : dessiner une machine en sections, rangées et contrôles — la géométrie suit', onclick: ouvrirLePlano }, 'Plano'),
      // l'aimant : allumé (vert, « Aimant »), éteint (« Libre ») — Idéation dit de même
      el('button', { class: `tb sm ndx-aimant ${aimante() ? 'on' : 'ghost'}`, type: 'button', 'aria-pressed': String(aimante()),
        title: aimante() ? 'Aimant : un bloc glissé ou une arête tirée se colle aux arêtes des voisins (⌥ : libre le temps du geste) — un clic, ou Ctrl+4 : libre'
          : 'Libre : rien ne s\'aimante — un clic, ou Ctrl+4 : l\'aimant', onclick: () => basculerAimant() }, aimante() ? 'Aimant' : 'Libre'),
      el('span', { class: 'lbl' }, `${p.modules.length + (p.nodal?.blocs?.length || 0)} blocs · ${p.cables.length + liensDe(p).length} câbles${sel.length > 1 ? ` · ${sel.length} sélectionnés` : ''}`),
      // détacher le nodal dans une fenêtre (un 2ᵉ écran) ; caché dans la fenêtre, dont la barre dit « Rattacher »
      app.fenetres ? app.fenetres.bouton('nodal') : null);
    const pres = getPresenceRelative();
    const sem = el('label', { class: 'ndx-semantique', title: 'La vitesse du zoom sémantique : un élément ne se rend jamais sous cette fraction de sa taille dessinée — plus haut, les blocs se simplifient plus tôt', onpointerdown: (e) => e.stopPropagation() },
      el('span', { class: 'lbl' }, 'sémantique'));
    const rg = h('input'); Object.assign(rg, { type: 'range', min: '0.2', max: '0.9', step: '0.05', value: String(pres) });
    const pv = el('span', { class: 'lbl ndx-semantique-v' }, `${Math.round(pres * 100)} %`);
    rg.addEventListener('input', () => { setPresenceRelative(Number(rg.value)); pv.textContent = `${Math.round(Number(rg.value) * 100)} %`; });
    sem.append(rg, pv);
    put(zoomBox,
      sem,
      el('button', { class: `tb ghost sm${seuilsOuvert ? ' on' : ''}`, type: 'button', title: 'Les planchers de présence du responsif, réglables en regardant', onclick: () => { seuilsOuvert = !seuilsOuvert; peindreSeuils(); peindreOutils(); } }, 'seuils'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'Revenir à 100 %', onclick: () => { const r = cv.getBoundingClientRect(), c = cam(); const cx = c.x + r.width / (2 * c.k), cy = c.y + r.height / (2 * c.k); gesteVue(); poserCam({ k: 1, x: cx - r.width / 2, y: cy - r.height / 2 }); appliquerVue(); app.saveUi(); } }, '100 %'),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: () => zoomBouton(1 / 1.2) }, '−'),
      el('span', { class: 'pct' }, `${Math.round(view().z * 100)} %`),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: () => zoomBouton(1.2) }, '+'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'Cadrer la sélection, ou toute la scène (F)', onclick: () => focusOn() }, 'Cadrer'));
    hint.textContent = HINT;
  }

  // ═══════════════════════════════════════════════ le panneau de droite
  let sideParams = null;
  function paintSideParams() { if (sideParams) sideParams(); }
  function paintSide() {
    const p = P(), secs = [];
    const t = sel.length && new Set(sel.map(porteurDe)).size === 1 ? parId.get(sel[0]) : null;
    const { owner } = t ? porteurDeTuile(p, t.id) : {};
    sideParams = null;
    for (let i = meters.length - 1; i >= 0; i--) if (meters[i][2]) meters.splice(i, 1);
    if (owner?.mach) {
      const def = machineDef(owner.mach.id), pid = owner.id;
      secs.push(el('div', { class: 'pan nd-sel' },
        el('div', { class: 'row' }, el('b', { class: 'venus' }, def?.name || ''), el('span', { class: 'sp' }), el('span', { class: 'lbl' }, def?.ref || '')),
        el('p', { class: 'lbl' }, `${def?.sections.length || 0} sections · ${app.mod(pid) ? MODULES[owner.type]?.name : 'sans son'} · T la remonte · son poste de conception : le crayon de son menu`),
        el('div', { class: 'row' },
          el('button', { class: 'tb ghost sm', type: 'button', onclick: () => reassembleMachine(pid) }, 'Remonter'),
          el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { machinePanel = machinePanel === pid ? null : pid; render(); } }, machinePanel === pid ? 'Fin de conception' : 'Conception'),
          owner.track ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { S.sel.track = owner.track; S.sel.mod = pid; app.showDetail('device'); } }, 'Instruments') : null,
          el('span', { class: 'sp' }),
          el('button', { class: 'tb ghost sm', type: 'button', onclick: () => retirerTuiles(tuilesDuPorteur(pid)) }, 'Retirer'))));
    } else if (owner && app.mod(owner.id) && MODULES[owner.type]) {
      const m = owner, def = MODULES[m.type], accent = (m.track && app.track(m.track)?.color) || def.color;
      const grid = el('div', { class: 'nd-params' });
      sideParams = () => put(grid, ...def.params
        .filter((q) => (m.type !== 'drums' || q.k === 'lvl') && (m.type !== 'rythme' || !q.k.includes('.')))
        .map((q) => (q.opts ? choice(q, val(m, q.k), { onChange: (v) => { m.params[q.k] = v; app.commit('param', m); rafraichir(tuilesDuPorteur(m.id)); } })
          : knob(q, val(m, q.k), { accent, onInput: (v) => { m.params[q.k] = v; app.commit('param', m); rafraichir(tuilesDuPorteur(m.id)); } }))));
      sideParams();
      const tr = m.track && app.track(m.track);
      const lies = app.linked(m.id).map(app.track).filter(Boolean);
      secs.push(el('div', { class: 'pan nd-sel', style: { '--k': `var(--${accent})` } },
        el('div', { class: 'row' }, el('b', { class: 'venus' }, def.name), el('span', { class: 'sp' }), el('span', { class: 'lbl' }, `${def.kind || ''}${tr ? ` · ${tr.name}` : ''}`)),
        lies.length > 1 ? el('div', { class: 'dev-lien nd-lien', title: 'un seul effet : le régler ici le règle dans le rack de chaque piste qui le traverse' },
          el('span', { class: 'lbl' }, 'lié'), ...lies.map((x) => el('span', { class: 'dev-lien-p', style: { '--c': `var(--${x.color})` } }, el('i'), x.name))) : null,
        grid,
        el('div', { class: 'row' },
          def.role === 'effect' || def.role === 'source' ? el('button', { class: `tb sm${m.on !== false ? ' on' : ' ghost'}`, type: 'button', onclick: () => { m.on = m.on === false; app.commit('graph'); } }, m.on !== false ? 'Actif' : 'Bypass') : null,
          m.track ? el('button', { class: 'tb ghost sm', type: 'button', title: 'la chaîne de sa piste, sous l\'arrangement', onclick: () => { S.sel.track = m.track; S.sel.mod = m.id; app.showDetail('device'); } }, 'Instruments') : null,
          el('span', { class: 'sp' }),
          def.role !== 'master' ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => retirerTuiles(tuilesDuPorteur(m.id)) }, 'Retirer') : null)));
      secs.push(...(app.toys?.side(m) || []));   // jouets : leur geste, leurs ports, Retirer
    } else if (owner) {
      secs.push(el('div', { class: 'pan nd-sel' }, el('div', { class: 'row' }, el('b', { class: 'venus' }, 'Clavier'), el('span', { class: 'sp' }), el('span', { class: 'lbl' }, 'des notes')),
        el('p', { class: 'lbl' }, 'désigné seul, les touches de l\'ordinateur le jouent (Z S X D C…) · sa sortie se tire vers un instrument ou un jouet')));
    } else {
      secs.push(el('div', { class: 'pan nd-sel' }, el('p', { class: 'lbl' }, sel.length > 1 ? `${sel.length} blocs : G les groupe, T les range, Suppr les retire` : 'clic sur une tuile : ses réglages ici · double-clic sur le fond : le catalogue')));
    }
    const blocDe = (id) => (nodalDe(p).blocs || []).find((b) => b.id === id);
    const nm = (id) => {
      const x = app.mod(id);
      if (x) { const tr = x.track && app.track(x.track); return `${machineDef(x.mach?.id)?.name || MODULES[x.type]?.name || x.type}${tr ? ` · ${tr.name}` : ''}`; }
      const b = blocDe(id);
      return b?.type === 'clavier' ? 'Clavier' : machineDef(b?.mach?.id)?.name || '?';
    };
    const lignes = [
      ...p.cables.filter((c) => !c.t).map((c) => ({ key: `${c.a}>${c.b}`, txt: `${nm(c.a)} → ${nm(c.b)}${typeof c.send === 'number' ? ` · envoi ${c.send.toFixed(1)} dB` : ''}`, cut: () => app.disconnect(c.a, c.b) })),
      ...liensDe(p).map((l) => ({ key: `L:${l.a}>${l.b}`, txt: `${nm(l.a)} → ${nm(l.b)} · notes`, cut: () => { const n = nodalDe(p); n.liens = n.liens.filter((x) => x !== l); app.commit('graph'); } })),
    ];
    secs.push(el('div', { class: 'pan' },
      el('div', { class: 'row' }, el('b', { class: 'venus' }, 'Liaisons'), el('span', { class: 'sp' }), el('span', { class: 'lbl' }, `${lignes.length} câbles`)),
      el('div', { class: 'nd-links' }, lignes.length ? lignes.map((x) => el('div', { class: `nd-link${S.sel.cable === x.key ? ' sel' : ''}`, onclick: () => { S.sel.cable = x.key; paintCableClass(); paintSide(); } },
        el('span', {}, x.txt), el('button', { class: 'cut', type: 'button', onclick: (e) => { e.stopPropagation(); x.cut(); } }, 'Couper'))) : el('p', { class: 'lbl' }, 'tire depuis une sortie vers un bloc'))));
    const mst = app.master();
    const big = el('b', { class: 'nd-db' }, '—');
    const mt = el('div', { class: 'mtr lg' }, el('i'));
    if (mst) meters.push([mst.id, mt, big]);
    secs.push(el('div', { class: 'pan' }, el('div', { class: 'row' }, el('b', { class: 'venus' }, 'Sortie'), el('span', { class: 'sp' }), el('span', { class: 'lbl' }, 'dB crête')), big, mt));
    put(side, ...secs);
  }

  // ═══════════════════════════════════════════════════════ à chaque image
  let runAvant = null, tInflu = 0, tInfluTuiles = 0;
  function frame() {
    bench.frame();
    for (const [id, mt, big] of meters) {
      const db = app.engine.level(id), bar = mt.firstChild;
      bar.style.transform = `scaleX(${Math.max(0, Math.min(1, (db + 60) / 60)).toFixed(3)})`;   // .mtr comme .ndx-vu : par transform
      if (big) big.textContent = db > -80 ? db.toFixed(1) : '—';
      mt.classList.toggle('hot', db > -1);
    }
    // le témoin d'un bloc allumé passe au vert quand le transport joue
    if (runAvant !== app.engine.running) {
      runAvant = app.engine.running;
      for (const l of world.querySelectorAll('.led--on, .led--idle')) { l.classList.toggle('led--on', runAvant); l.classList.toggle('led--idle', !runAvant); }
    }
    // LES CHIFFRES BOUGENT : ce qu'un attracteur ramène se lit sur les tuiles qu'il capte, pendant qu'il parle
    const now = performance.now();
    if (now - tInflu > 120) {
      tInflu = now;
      const p = P();
      if (p?.banc?.atts?.length || influ.size) {
        const t = bench.tempsGouvernant?.() ?? app.pos();
        const nouv = new Map(), poidsDe = new Map();
        for (const a of attracteursActifs(p, t, blocsDInfluence(p, T))) {
          for (const o of a.operateurs) {
            const k2 = o.ctl || o.cle;
            if (!k2) continue;
            const cle = `${o.blocId}|${k2}`;
            if ((poidsDe.get(cle) ?? -1) >= o.w) continue;   // capté deux fois : l'opérateur de plus grand poids
            poidsDe.set(cle, o.w);
            if (!nouv.has(o.blocId)) nouv.set(o.blocId, new Map());
            nouv.get(o.blocId).set(k2, o.op);
          }
        }
        const sig = JSON.stringify([...nouv].map(([k2, m]) => [k2, [...m].map(([a, b]) => [a, Math.round(b * 1000) / 1000])]));
        // une tuile se remet en page au plus toutes les 300 ms : le son, lui, suit à chaque tranche (moteur.js)
        if (sig !== influSig && now - tInfluTuiles > 300) {
          tInfluTuiles = now;
          const avant = [...influ.keys()];
          influSig = sig; influ = nouv;
          rafraichir([...new Set([...avant, ...nouv.keys()])]);
        }
      }
    }
  }

  // les réglages du zoom sémantique, les fontes, les cotes retouchées : tout se remet en page
  const toutRepeindre = () => {
    if (!vueNodal() || !S.proj || !cv.isConnected) return;
    for (const v of vues.values()) v.sale = true;
    lireTuiles(); calculerPlancher(); planifierMiseEnPage(); peindreCables();
  };
  onTuning(toutRepeindre); onPlanchers(toutRepeindre); onFontsReady(toutRepeindre);
  // une cote retouchée (le poste de conception) ne touche que les sections de machine
  onMachineConfig(() => {
    if (!vueNodal() || !S.proj || !cv.isConnected) return;
    const ids = T.filter((t) => t.sec).map((t) => t.id);
    for (const id of ids) { const v = vues.get(id); if (v) v.sale = true; }
    planifierMiseEnPage(ids);
  });
  // suivreTaille (commun/fenetre.js) : un ResizeObserver de la fenêtre où est le nodal — celui de
  // la page ne voit pas les changements de taille d'un nœud posé dans une autre fenêtre (mesuré)
  suivreTaille(cv, () => { if (vueNodal() && S.proj) { calculerPlancher(); planifierMiseEnPage(); bench.paintMeta(); bench.renderPlan(); } });

  // le clavier du nodal passe par l'écouteur en capture, plus haut ; musique.js
  // passe ici les combinaisons à Ctrl (ou ⌥) : Ctrl+4, l'aimant, comme dans
  // l'arrangement (timeline.js) — par la touche (e.code), juste en AZERTY
  function key(e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'Digit4') { e.preventDefault(); basculerAimant(); return true; }
    return false;
  }
  // pour les essais (tools : essais de page)
  // montrer un module ou le nœud de départ d'une piste (depuis l'arrangement, le rack)
  function montrer(modId) {
    if (!vueNodal() || !P()) return;
    lireTuiles();
    const ids = T.filter((t) => porteurDe(t.id) === modId).map((t) => t.id);
    if (!ids.length) return;
    setSel(withFamilies(ids));
    requestAnimationFrame(() => focusOn());
  }
  const montrerPiste = (tid) => { const tr = app.track(tid); if (tr) montrer(tr.src); };
  app.nodal = { tuiles: () => T, selection: () => [...sel], choisir: setSel, vue: view, poser, retirer: retirerTuiles, ranger: tidySelection, grouper: toggleGroup, cadrer: focusOn, uiK, plancher: () => plancher, vues, influ: () => influ, stats, montrer, montrerPiste, relier: (a, b) => { const why = verdictDe(a, b); if (why) return why; relier(a, b); app.commit('graph'); return null; } };
  return { el: root, render, frame, key, zoneMenu, hide: () => bench.hide() };
}
