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
//     (⌥ la libère) ;
//   - le fond : glisser = rectangle de sélection (⌃ ajoute, ⌥ retire), clic
//     milieu glissé = se déplacer, molette = zoom ancré, double-clic = le
//     catalogue ; G grouper / dégrouper, T ranger (la machine se remonte, un
//     bloc seul reprend sa taille, sinon on redresse sans réordonner), F cadrer,
//     Suppr retirer (le câblage se recoud) ;
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
import { MODULES, spec, val, drumVoicesOf } from './modules.js';
import { el, knob, choice, put } from './ui.js';
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
import { TILE_NAME_FONT, TILE_NAME_SPACING, engrave, measureText, onFontsReady } from './machines/tile/measure.js';
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
import { ouvrirCatalogue, ouvrirPalette, ouvrirMenuCable } from './machines/catalogue.js';
import { ouvrirPlano, installerGabaritsDu } from './machines/plano.js';
import { attracteursActifs, blocsDInfluence } from './machines/influence.js';

// le style du nodal : ses tuiles, ses câbles, ses machines (musique/nodal.css)
{
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
/** Ports.tsx, `cablePath` : une cubique qui part à l'horizontale ; `k` rend l'allonge en px écran. */
function cablePath(a, b, k) {
  const reach = Math.max(28 / k, Math.abs(b.x - a.x) * 0.42);
  return `M ${a.x} ${a.y} C ${a.x + reach} ${a.y}, ${b.x - reach} ${b.y}, ${b.x} ${b.y}`;
}

export function createNodal(app) {
  const { S } = app;
  const P = () => S.proj;
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
  app.toys?.attach({ cv, world, view, paintSide: () => paintSide(), paintWires: () => peindreCables() });   // jouets : leurs câbles typés, les billes de la fontaine

  // ═════════════════════════════════════════ les tuiles, lues dans le projet
  function lireTuiles() {
    T = tuilesDe(P(), MODULES).map((t) => {
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
  const expose = (id) => reglage('expose')[id] ?? null;
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
      return { owner, def: BLOCKS.clavier, nom: noms[t.id] || 'CLAVIER', court: noms[t.id] || 'CLV', parametres: CLAVIER, valeurs, power: true, enabled: owner.on !== false,
        onParam: (id, v) => { owner.params = owner.params || {}; owner.params[id] = id === 'octave' ? Math.round(v) : v; app.commit('quiet'); rafraichirApres(t.id); } };
    }
    const m = owner, def = MODULES[m.type];
    if (!def || def.jouet) return null;
    const specs = def.params.filter((s) => (m.type !== 'drums' || s.k === 'lvl') && (m.type !== 'rythme' || !s.k.includes('.')));
    const tous = m.type === 'rythme' ? def.params : specs;   // la boîte à rythme : les réglages de voix vont au groove
    const reg = REGISTRE[m.type] ? BLOCKS[REGISTRE[m.type]] : ['strip', 'master', 'bus'].includes(def.role) ? { layout: CONSOLE(specs.map((s) => s.k)), surface: null } : null;
    const tr = m.track && app.track(m.track);
    const nom = noms[t.id] || engrave(def.role === 'source' && tr ? tr.name : def.role === 'strip' && tr ? `piste ${tr.name}` : def.name);
    return {
      owner: m, def: reg, nom, court: noms[t.id] || nom.slice(0, 4), parametres: tous.map(descripteurDe),
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
      const mode = ev.altKey ? 'remove' : ev.ctrlKey || ev.metaKey ? 'add' : 'replace';
      if (mode === 'remove' && ev.target.closest('.grip, .tile__head')) return;
      selectBlock(t.id, mode);
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
  }
  function grooveSig(m) {
    const tr = m?.track && app.track(m.track), pat = tr && app.pat(tr.pat);
    return pat ? JSON.stringify(pat.lanes || {}) + reglage('voix')[m.id] : '';
  }
  function signature(t, info) {
    const b = sharedBorders(t, T.filter((o) => o.id !== t.id && !o.jouet));
    const it = influ.get(t.id);
    return [t.w, t.h, b.right, b.bottom, expose(t.id), partage(t.id), info?.enabled, t.teinte, info?.nom, machinePanel === info?.owner?.id,
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
    const body = tileBody(rect, borders);
    const narrow = body.w < 112, padX = narrow ? 4 : 8, gap = narrow ? 4 : 7;
    const led = ledSize(body.head, body.w - padX * 2);
    const exposedId = expose(t.id);
    const valeurs = { ...info.valeurs, ...Object.fromEntries(influ.get(t.id) || []) };
    const slots = resolveBody(body.w, body.h, info.parametres, info.def, partage(t.id), exposedId).slots;
    const dExp = info.parametres.find((q) => q.id === exposedId);
    const bodyNames = slots.length === 0 && dExp !== undefined && promotedName(body.w, body.h, dExp.label).size > 0;
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
    const exposedLabel = headerExposed ? engrave(headerExposed) : '';
    const exposedWidth = headerExposed ? measureText(exposedLabel, TILE_NAME_FONT, TILE_NAME_SPACING) : 0;
    const cluster = measureText(info.nom, TILE_NAME_FONT, TILE_NAME_SPACING) + (headerExposed ? gap + exposedWidth : 0);
    const fits = available >= cluster + FIT_MARGIN, showText = available >= MIN_TEXT_TILE, scrolling = showText && !fits;
    if (showText) {
      const nom = h('span', 'tile__name');
      nom.textContent = info.nom;
      nom.title = 'Double-clic pour renommer';
      nom.addEventListener('dblclick', (ev) => { ev.stopPropagation(); renommer(t.id, nom); });
      const ex = headerExposed ? h('span', 'tile__exposed') : null;
      if (ex) { const s = h('span', 'tile__exposed-label'); s.textContent = exposedLabel; ex.append(s); }
      if (scrolling) {
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
    tete.append(h('span', 'tile__spacer'));
    tete.addEventListener('pointerdown', (ev) => startMove(ev, t.id));
    tete.addEventListener('dblclick', (ev) => { ev.stopPropagation(); resetSize(t.id); });

    // le corps : le rendu d'ODIO_01 (BlockBody, MachinePanel), à l'échelle apparente
    const corps = h('div', 'tile__body');
    const { owner } = info;
    vue.panneau = null;
    rendreCorps(corps, {
      width: body.w, height: body.h, parameters: info.parametres, values: valeurs, exposed: exposedId, def: info.def, twin: info.twin, split: partage(t.id),
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
    const teinte = t.teinte ? h('span', 'tile__teinte') : null;
    if (teinte) teinte.style.background = `var(--${t.teinte})`;
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
      selectBlock(t.id, ev.altKey ? 'remove' : ev.ctrlKey || ev.metaKey ? 'add' : 'replace');
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
      tPlan = setTimeout(() => { peindreCables(); peindreLiensKnob(); nettete(); }, 120);
    }
    cv.style.backgroundSize = `${26 * v.z}px ${26 * v.z}px`;
    cv.style.backgroundPosition = `${v.px}px ${v.py}px`;
    const pc = zoomBox.querySelector('.pct');
    if (pc) pc.textContent = `${Math.round(v.z * 100)} %`;
    if (lienPris || boutSurvole || lienEnCours) peindreLiensKnob();
    if (seuilsOuvert) peindreSeuils(false);
    bench.suivreVue?.();
  }
  // Le monde est un calque promu (nodal.css, will-change) : déplacer la vue
  // ne repeint rien, le compositeur le glisse. Après un zoom, on le fait
  // rastériser à la nouvelle échelle — une fois, à l'arrêt du geste — pour
  // que le texte redevienne net.
  function nettete() {
    (stats.nettete = stats.nettete || []).push(Math.round(performance.now()));
    world.classList.add('ndx-net');
    requestAnimationFrame(() => world.classList.remove('ndx-net'));
  }
  function gesteVue() {
    clearTimeout(tGeste);
    tGeste = setTimeout(rattraper, 160);
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
      move: (m) => { poserCam({ k: c0.k, x: c0.x - (m.clientX - x0) / c0.k, y: c0.y - (m.clientY - y0) / c0.k }); gesteVue(); demanderVue(); },
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
    poserCam(zoomCamera(cam(), f > 1 ? -180 : 180, r.width / 2, r.height / 2, plancherCamera(plancher)));
    gesteVue(); appliquerVue(); app.saveUi();
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
    classesSelection(); peindreDessus(); paintSide(); peindreOutils(); paintCableClass();
    // le « bloc pris » d'une section de machine change son T en édition
    if (machinePanel) rafraichir([...new Set([...avant, ...ids])].filter((id) => parId.get(id)?.sec));
  }
  function selectBlock(id, mode) {
    const family = familyOf(id).map((t) => t.id);
    let next;
    if (mode === 'remove') next = sel.filter((o) => !family.includes(o));
    else if (mode === 'add') next = sel.includes(id) ? sel : withFamilies([...sel, id]);
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
        const clean = engrave(inp.value.trim()).slice(0, 18), noms = reglage('noms');
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
      onPick: (type) => poser(type, at || versMonde(...centreEcran())),
      onDrop: (type, e) => {
        const r = cv.getBoundingClientRect();
        if (e.x < r.left || e.x > r.right || e.y < r.top || e.y > r.bottom) return;
        poser(type, versMonde(e.x, e.y));
      },
    });
  }
  function ouvrirLePlano() {
    ouvrirPlano({ projet: P, onGarder: () => app.commit('quiet'), onPoser: (id) => { const c = versMonde(...centreEcran()); poser(`machine:${id}`, { x: c.x - 120, y: c.y - 60 }); } });
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
        // on retire en RECOUSANT : ce qui entrait est rebranché sur ce qui sortait
        const ins = p.cables.filter((c) => c.b === pid && !c.t && typeof c.send !== 'number').map((c) => c.a);
        const outs = p.cables.filter((c) => c.a === pid && !c.t).map((c) => c.b);
        p.cables = p.cables.filter((c) => c.a !== pid && c.b !== pid);
        p.modules = p.modules.filter((x) => x.id !== pid);
        p.auto = (p.auto || []).filter((L) => L.mod !== pid);
        for (const a of ins) for (const b of outs) if (!app.wouldCycle(a, b) && !p.cables.some((c) => c.a === a && c.b === b && !c.t)) p.cables.push({ a, b });
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
    for (const id of pistes) app.removeTrack(id);   // une source ou une tranche : toute sa piste (avec confirmation)
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
    for (const cle of ['expose', 'split', 'noms', 'ports']) { const r = reglage(cle); for (const [a, b] of clone) if (a in r) r[b] = copie(r[a]); }
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
        const snapped = m.altKey && !cloning ? { box: raw, guides: [] } : snapBox(raw, T.filter((t) => !origins.has(t.id) && !t.jouet), SNAP_DISTANCE / k);
        guides = snapped.guides;
        const sx = snapped.box.x - anchor.x, sy = snapped.box.y - anchor.y;
        for (const [tid, o] of origins) { const t = parId.get(tid); if (t) { if (t.jouet) { const mm = app.mod(t.mod); mm.x = Math.round(o.x + sx); mm.y = Math.round(o.y + sy); } else ecrireBoite(P(), tid, { ...t, x: o.x + sx, y: o.y + sy }); } }
        apresGeste();
      },
      end: () => {
        if (!started && cloning) setSel(sel.filter((s) => s !== id));
        busy = null; guides = [];
        classesSelection();
        if (started) app.commit('data'); else peindreDessus();
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
          if (!m.altKey) {
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
        if (horizontal && !m.altKey) { const s = snapValue(edgeX + raw.x, targetsX, SNAP_DISTANCE / k); if (s.guide !== null) { delta.x = s.value - edgeX; rules.push({ axis: 'x', at: s.guide }); } }
        if (vertical && !m.altKey) { const s = snapValue(edgeY + raw.y, targetsY, SNAP_DISTANCE / k); if (s.guide !== null) { delta.y = s.value - edgeY; rules.push({ axis: 'y', at: s.guide }); } }
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
    const mode = event.altKey ? 'remove' : event.ctrlKey || event.metaKey ? 'add' : 'replace';
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
        const next = mode === 'remove' ? base.filter((id) => !hits.includes(id)) : withFamilies([...base, ...hits]);
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
    const trait = (d, key, cable, notes) => {
      const hit = sv('path', { class: 'cable__hit', d });
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
      const g = sv('g', { class: notes ? 'cable cable--notes' : 'cable' });
      g.dataset.key = key;
      g.append(sv('path', { class: 'cable__line', d }));
      cablesSvg.append(g);
      return g;
    };
    for (const c of p.cables) {
      if (c.t) continue;   // jouets : les câbles de notes et de valeur ont leur calque (jouets/index.js)
      const a = pointBorne(c.a, 'out'), b = pointBorne(c.b, 'in');
      if (!a || !b) continue;
      const key = `${c.a}>${c.b}`, jump = hid.get(key);
      if (jump && !(jump.shown || hoverJump === key)) continue;
      const g = trait(cablePath(a, b, k), key, c, false);
      if (jump) { g.firstChild.classList.add('cable__line--jump'); g.style.color = `var(--${jump.color})`; }
      if (typeof c.send === 'number') {
        const tx = sv('text', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, class: 'cable__envoi' });
        tx.textContent = `envoi ${c.send > 0 ? '+' : ''}${c.send.toFixed(1)} dB`;
        g.append(tx);
      }
    }
    // les notes des blocs (clavier, KBD-01, SEQ-01) vers ce qui se joue
    for (const l of liensDe(p)) {
      const a = pointBorne(l.a, 'out'), b = pointNotes(l.b);
      if (a && b) trait(cablePath(a, b, k), `L:${l.a}>${l.b}`, null, true);
    }
    // le câble qu'on tire, et le CADRE DE PARENTAGE : vert si le lâcher fera la liaison, rouge sinon
    if (cabling) {
      if (cabling.vise) {
        const t = parId.get(cabling.vise);
        const fam = t ? (t.machine ? T.filter((o) => o.machine === t.machine) : [t]) : [];
        if (fam.length) {
          const b = boundsOf(fam), m2 = 2 / k;
          const r = sv('rect', { class: cabling.refus ? 'cible cible--refusee' : 'cible cible--permise', x: b.x - m2, y: b.y - m2, width: b.w + 2 * m2, height: b.h + 2 * m2 });
          const tt = sv('title'); tt.textContent = cabling.refus || 'la liaison se fera';
          r.append(tt);
          cablesSvg.append(r);
        }
      }
      const a = pointBorne(cabling.from, 'out');
      if (a) {
        const b = cabling.over ? (cabling.sig === 'notes' ? pointNotes(cabling.over) : pointBorne(cabling.over, 'in')) : { x: cabling.x, y: cabling.y };
        const blocked = cabling.vise && cabling.refus;
        cablesSvg.append(sv('path', { class: `cable__line ${blocked ? 'cable__line--refused' : 'cable__line--drawing'}${cabling.sig === 'notes' ? ' cable__line--notes' : ''}`, d: cablePath(a, b || a, k) }));
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
  function menuCable(c, e) {
    ouvrirMenuCable({ at: { x: e.clientX, y: e.clientY }, saut: !!c.jump,
      onJump: () => {
        if (c.jump) { delete c.jump; delete c.shown; } else c.jump = nextJumpColor(P().cables.filter((x) => !x.t).map((x) => ({ from: x.a, to: x.b, jump: x.jump })));
        app.commit('quiet'); peindreCables(); peindreBornes();
      },
      onInsert: () => ouvrirSurCable(e, c, 'FLUX') });
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
  function relier(a, b) {
    const p = P();
    if (emetNotes(a)) { const n = nodalDe(p); n.liens = [...(n.liens || []), { a, b, sig: 'notes' }]; return; }
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
      const vise = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-bout]')?.getAttribute('data-bout');
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
  cv.addEventListener('pointerdown', (e) => {
    const cible = e.target;
    if (!cible.closest('input, textarea, [contenteditable="true"]')) { try { cv.focus({ preventScroll: true }); } catch { /* cadre */ } }
    if (e.button === 1) {
      // deux gestes revendiquent le clic milieu avant la vue : la borne, et le tracé d'ordre (en édition)
      if (cible.closest('.ndx-borne')) return;
      if (machinePanel && cible.closest('.machine')) return;
      if (!machinePanel && cible.closest('[data-bout]')) return;
      e.preventDefault(); e.stopPropagation();
      startPan(e);
    }
  }, true);
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
  cv.addEventListener('wheel', (e) => {
    if (e.target.closest?.('.palette, .cat, .machine-panel, .ndx-seuils, .nd-tools, .nd-zoom')) return;
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    poserCam(zoomCamera(cam(), dy, e.clientX - r.left, e.clientY - r.top, plancherCamera(plancher)));
    gesteVue(); demanderVue();
    clearTimeout(cv._t); cv._t = setTimeout(() => app.saveUi(), 500);
  }, { passive: false });
  cv.addEventListener('dblclick', (e) => {
    if (e.target.closest('.tile, .nd-card, .bn-meta, .bn-atr, .nd-tools, .nd-zoom, .machine-panel, .group-menu, .cable__hit, .ndx-borne')) return;
    ouvrirLeCatalogue(versMonde(e.clientX, e.clientY));
  });

  // ── le clavier : il revient au canvas dès qu'on y touche (App.tsx) ──
  addEventListener('pointerdown', (e) => { actif = cv.contains(e.target); }, true);
  addEventListener('keydown', (e) => {
    if (S.view !== 'nodal' || !S.proj || !actif || !cv.isConnected) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('.plano, .cat--fenetre, .scrim')) return;
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
    if (e.code === 'KeyG') { stop(); if (e.altKey) ungroupBlocks(); else toggleGroup(); return; }
    if (e.altKey || e.shiftKey) return;
    if (e.code === 'KeyF') { stop(); focusOn(); return; }
    if (e.code === 'KeyT') {
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
  const HINT = 'clic milieu glissé : se déplacer · molette : zoom · glisser le fond : sélectionner · double-clic : le catalogue · ⌥ glissé : dupliquer · T ranger · G grouper · F cadrer · clic droit sur un câble : saut';
  function peindreOutils() {
    const p = P();
    put(tools,
      el('button', { class: 'tb ghost sm', type: 'button', title: 'Le catalogue : les blocs, les instruments, les machines, le Playground (double-clic sur le fond)', onclick: () => ouvrirLeCatalogue(null) }, 'Catalogue'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'PLANO : dessiner une machine en sections, rangées et contrôles — la géométrie suit', onclick: ouvrirLePlano }, 'Plano'),
      el('span', { class: 'lbl' }, `${p.modules.length + (p.nodal?.blocs?.length || 0)} blocs · ${p.cables.length + liensDe(p).length} câbles${sel.length > 1 ? ` · ${sel.length} sélectionnés` : ''}`));
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
      el('button', { class: 'tb ghost sm', type: 'button', title: 'Revenir à 100 %', onclick: () => { const r = cv.getBoundingClientRect(), c = cam(); const cx = c.x + r.width / (2 * c.k), cy = c.y + r.height / (2 * c.k); poserCam({ k: 1, x: cx - r.width / 2, y: cy - r.height / 2 }); gesteVue(); appliquerVue(); app.saveUi(); } }, '100 %'),
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
      secs.push(el('div', { class: 'pan nd-sel', style: { '--k': `var(--${accent})` } },
        el('div', { class: 'row' }, el('b', { class: 'venus' }, def.name), el('span', { class: 'sp' }), el('span', { class: 'lbl' }, `${def.kind || ''}${tr ? ` · ${tr.name}` : ''}`)),
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
      if (big) { bar.style.width = `${Math.max(0, Math.min(100, (db + 60) / 60 * 100)).toFixed(1)}%`; big.textContent = db > -80 ? db.toFixed(1) : '—'; }
      else bar.style.transform = `scaleX(${Math.max(0, Math.min(1, (db + 60) / 60)).toFixed(3)})`;
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
    if (S.view !== 'nodal' || !S.proj || !cv.isConnected) return;
    for (const v of vues.values()) v.sale = true;
    lireTuiles(); calculerPlancher(); planifierMiseEnPage(); peindreCables();
  };
  onTuning(toutRepeindre); onPlanchers(toutRepeindre); onFontsReady(toutRepeindre);
  // une cote retouchée (le poste de conception) ne touche que les sections de machine
  onMachineConfig(() => {
    if (S.view !== 'nodal' || !S.proj || !cv.isConnected) return;
    const ids = T.filter((t) => t.sec).map((t) => t.id);
    for (const id of ids) { const v = vues.get(id); if (v) v.sale = true; }
    planifierMiseEnPage(ids);
  });
  new ResizeObserver(() => { if (S.view === 'nodal' && S.proj) { calculerPlancher(); planifierMiseEnPage(); bench.paintMeta(); bench.renderPlan(); } }).observe(cv);

  function key() { /* le clavier du nodal passe par l'écouteur en capture, plus haut */ }
  // pour les essais (tools : essais de page)
  app.nodal = { tuiles: () => T, selection: () => [...sel], choisir: setSel, vue: view, poser, retirer: retirerTuiles, ranger: tidySelection, grouper: toggleGroup, cadrer: focusOn, uiK, plancher: () => plancher, vues, influ: () => influ, stats };
  return { el: root, render, frame, key, hide: () => bench.hide() };
}
