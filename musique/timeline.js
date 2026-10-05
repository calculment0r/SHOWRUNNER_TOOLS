// ODIO — l'arrangement (la vue principale du studio).
//
//   la règle     sections (ajouter, nommer, déplacer avec leurs clips,
//                colorer, dupliquer), mesures, boucle, marqueurs, tête de
//                lecture (clic = aller là ; glisser vers le haut ou le bas =
//                zoomer, comme la règle des temps de Live ; son onglet se
//                prend et se glisse)
//   les arcs     un groupe en accordéon, collé sous la règle (06/10, arcs.js) :
//                l'arc d'énergie (il pilote la sortie : filtre, volume ou les
//                deux), le volume, le filtre, les envois de réverbe et de delay,
//                et ceux qu'on ajoute ; replié, une rangée qui résume et peint
//                l'arc choisi, déplié un arc par rangée — et plus bas, sous
//                chaque piste, ses voies d'automation, une par réglage
//   les pistes   choisir un en-tête (Ctrl : ajouter / retirer, Maj : jusqu'à
//                lui), Suppr les retire ; glisser un en-tête : lâché ENTRE
//                deux pistes il s'y range (trait d'insertion), SUR une piste il
//                fait groupe avec elle (elle s'entoure) ; un groupe se replie,
//                se renomme, se défait (Ctrl+G groupe les pistes choisies) ;
//                muet, solo, armer, volume, panoramique, couleur ; clips de
//                motifs (leurs notes dessinées) et clips audio (leur forme
//                d'onde) ; aimant, sélection multiple, copier / coller,
//                dupliquer, couper, consolider, rogner par les deux bords
//                (la poignée de gauche rogne le DÉBUT, le contenu reste calé
//                dans le temps), boucler, désactiver
//   objet, temps comme dans Live (05/10) : la BARRE DE TITRE d'un clip est
//                l'objet (le choisir, le glisser) ; son CORPS et le vide d'une
//                piste sont le temps — un clic y pose le marqueur d'insertion
//                (et la tête de lecture), glisser y choisit une plage sur une
//                ou plusieurs pistes ; Ctrl+E coupe, Suppr retire la plage,
//                Ctrl+D la duplique, Ctrl+J en fait un clip (musique.js, timeSel)
//   en bas       la vue de détail, comme celle de Live : le clip choisi (Clip)
//                ou les instruments et effets de la piste (Instrument) ;
//                Maj+Tab bascule ; le séparateur se tire, sa hauteur reste
//   à gauche     le navigateur, en accordéon, repliable ; sa largeur se tire
//   génératif    une piste générative (+ Piste, ou le navigateur) : tirer sur
//                sa voie dessine une région, que le panneau du bas fait générer
//                en prises (generatif_region.js) ; clic droit sur un clip audio :
//                Extraire le MIDI, Séparer en stems ; sur un clip de notes :
//                le ranger dans la bibliothèque MIDI, le mettre dans une partition
//
// Gestes et raccourcis : ceux de Live 12 (manuel de référence, chapitres
// « Live Keyboard Shortcuts » et « Arrangement View », ableton.com/en/manual,
// relevés le 29/09/2026) — le détail dans guide.js.
//
// Le zoom et la grille (05/10, Cal : « le zoom n'est pas fluide du tout […]
// quand je dézoome, la timeline n'affiche plus la grille à droite […] quand on
// a un clip audio, on ne voit pas la grille ») :
//   - un cran de molette ne refait plus tout l'arrangement (avant : la barre,
//     le navigateur, le panneau du bas, chaque piste et chaque toile, à chaque
//     événement) ; les demandes d'une même image n'en font qu'une
//     (requestAnimationFrame), et le zoom met en place ce qui dépend de lui
//     (`echelle`) : la largeur, la grille, la règle, les clips. Pendant le
//     geste, les formes d'onde sont étirées (transform), puis repeintes nettes
//     quand il s'arrête ;
//   - la grille ne s'arrête jamais à droite (Live) : la largeur va toujours deux
//     écrans au-delà de ce qui se voit, et défiler la rallonge ; ses pas suivent
//     le zoom (`grille`) ;
//   - elle passe AU-DESSUS des clips (.ar-lignes, des traits fins) : on vise un
//     temps à travers une forme d'onde ;
//   - les toiles (formes d'onde, notes, arc, automation) ne se peignent que sur
//     la fenêtre : ce qui se voit et un écran de chaque côté ; avant, une toile
//     faisait la largeur du clip, bornée à 8000 px (de près, un long clip
//     restait vide au-delà).

import { toast, api, ITEM_MIME, MULTI_MIME, uploadFile, declareZone } from '../commun/shell.js';
import { poserObjets } from './panneau.js';
import { MODULES, TRACK_KINDS, COLORS, COLOR_FR, AUTOMATABLE, SECTION_TAGS, SECTION_NAMES, SOURCES_OF,
  spec, val, fmt, fromNorm, drumVoicesOf, guessTag, moduleName } from './modules.js';
import { peaks, projEnd, interp, clipBuffer, audioGeom } from './moteur.js';
import { el, knob, fader, menu, tok, clamp, put, confirmBox, inlineEdit, splitter, letter } from './ui.js';
import { sectionAt, duplicateSection, moveSection, swapSection, removeSection, trimStart, rangerGroupes } from './projet.js';
import { createDock } from './editeurs.js';
import { createBrowser } from './navigateur.js';
// le génératif (29/09) : la piste générative et ses régions, le MIDI
import { isGenTrack, isRegion, genTrackChoices, addGenTrack, newRegion, drawRegion, regionMenuItems, genTarget, soundSlotsOf, useSound, injectFrom, deposerClip } from './generatif_region.js';
import { ouvrirGenerer } from './generatif_panneau.js';   // le panneau « Générer » (06/10)
import { openExtract, placeMidi, saveClipMidi } from './generatif_midi.js';
import { schemaNow } from './generatif_modeles.js';
// le tempo d'un clip audio (05/10) : « Détecter le tempo » au clic droit (bpm.js, tempo.js)
import { openTempo } from './bpm.js';
// la molette : la règle commune de toutes les timelines du portail (29/09)
import { brancher, borne, tenirY, AIDE as MOLETTE } from '../commun/molette.js';
// LA tête de lecture du portail (30/09, Cal : « toutes nos timelines [avec] la même cue […] celle du montage vidéo »)
import { tete, poser, suivre, glisser } from '../commun/tete.js';
// le son au défilement (06/10, Cal : « entendre le son quand on fait glisser la tête […] pour caler un cut ») : commun/scrub.js
import { scrub as scrubSon, actif as scrubActif } from '../commun/scrub.js';
// « ça calcule » (06/10) : la couche d'un clip dont un travail de la file s'occupe (calcul.js, calcul.css)
import { brancherCalculs, etatCalcul, poserCalcul } from './calcul.js';
// la structure (06/10) : les sections qu'une balise des paroles tient (projet.js)
import { sectionsLiees } from './projet.js';
// le groupe des arcs du projet (06/10) : leurs définitions, leurs points, les retours qu'ils tiennent
import { ARCS, ENERGIE, arcNeuf, ptsArc, retoursDe } from './arcs.js';

const HEAD_W = 224;
const Z_MIN = 2, Z_MAX = 160;                           // pixels par noire, les bornes du zoom
const SEC_H = 22, BAR_H = 30, RULER_H = SEC_H + BAR_H, ARC_H = 58, AUTO_H = 46;
// la grille adaptative (Live : « adaptive grid ») : le trait le plus fin garde
// au moins FIN_PX entre deux traits ; les numéros de mesure NUM_PX ; de près
// (une noire de TEMPS_PX au moins), les temps ont le leur (« 5.2 »)
const FIN_PX = 8, NUM_PX = 44, TEMPS_PX = 52;
// la fin d'un geste de zoom : les formes d'onde étirées sont repeintes nettes
const ZOOM_REPOS = 140;
const AUDIO_EXT = /\.(wav|mp3|flac|m4a|ogg|oga|aac)$/i;
export const SNAPS = [[0, 'libre'], [0.25, '1/16'], [0.5, '1/8'], [1, '1/4'], [2, '1/2'], ['bar', 'mesure']];

export function createTimeline(app) {
  const { S } = app;
  const P = () => S.proj;
  brancherCalculs(app);   // le relevé de la file met à jour la couche « en calcul » des clips (calcul.js)
  const ui = () => S.proj.ui;
  const ppb = () => ui().ppb || 83 / 4;                 // pixels par noire
  const th = () => ui().th || 88;                       // hauteur des pistes (toutes)
  // la hauteur d'UNE piste : la sienne (Ctrl+molette sur son en-tête, ui().thT), sinon celle de toutes.
  // L'en-tête suit sa hauteur réelle par paliers (musique.css, « les paliers de
  // l'en-tête » : pleine, compacte, minimale) ; le plancher est celui de la
  // minimale (une ligne : le nom et les boutons resserrés) — avant (48), le nom
  // s'écrasait déjà (05/10, Cal : « on ne voit plus ce que c'est »)
  const TH_MIN = 26, TH_MAX = 180;
  const thOf = (t) => ui().thT?.[t.id] || th();
  const snapU = () => { const s = ui().snap ?? 1; return s === 'bar' ? P().sig : s; };
  const navW = () => (ui().nav === false ? 30 : clamp(ui().navW || 214, 160, 420));
  // la hauteur du panneau du bas : celle de sa taille (editeurs.js, compact ou grand — d'office, au plus haut)
  const dockH = () => (ui().dock === false ? 0 : clamp((ui().dockGrand ? ui().dockHg || 9999 : ui().dockH) || 300, 120, Math.max(160, innerHeight - 300)));
  const root = el('section', { class: 'ar', 'aria-label': 'arrangement' });
  const tools = el('div', { class: 'ar-tools' });
  const scroll = el('div', { class: 'ar-scroll' });
  const grid = el('div', { class: 'ar-grid' });
  // commun/tete.js : au-dessus de la règle (5), sous le coin (7) ; sous les en-têtes collés, cachée
  const ph = tete({ z: 6 });
  let phX = null;
  // son onglet se prend et se glisse (Cal, 05/10 : « je ne peux pas la slider
  // en attrapant sa tête ») : musique.css le rend saisissable, collé en haut de
  // la vue quand on descend dans les pistes
  ph.firstChild.title = 'la tête de lecture · glisser : la déplacer, aimantée (Alt : libre)';
  ph.firstChild.addEventListener('pointerdown', (e) => grabHead(e));
  const zone = el('div', { class: 'ar-zone' });
  const recBox = el('div', { class: 'ar-rec' }, el('span', {}, 'prise'));
  const marquee = el('div', { class: 'ar-marquee' });
  const dropLine = el('div', { class: 'ar-dropline' });
  const trackLine = el('div', { class: 'ar-trackline', 'aria-hidden': 'true' });   // le trait d'insertion d'une piste qu'on glisse
  scroll.append(grid);
  const browser = createBrowser(app);
  const dock = createDock(app);
  // les deux séparateurs : la largeur du navigateur, la hauteur du bas
  const navSplit = splitter('x', { get: navW, min: 160, max: 420, reset: 214, title: 'tirer : la largeur du navigateur · double-clic : d\'origine',
    set: (v) => { body.style.setProperty('--nav-w', `${v}px`); }, done: (v) => { ui().navW = v; ui().nav = true; app.saveUi(); } });
  const dockSplit = splitter('y', { get: dockH, min: 120, max: 900, invert: true, reset: 300, title: 'tirer : la hauteur du détail · double-clic : d\'origine',
    set: (v) => { dock.el.style.height = `${v}px`; }, done: (v) => { ui()[ui().dockGrand ? 'dockHg' : 'dockH'] = v; ui().dock = true; app.saveUi(); } });
  const main = el('div', { class: 'ar-main' }, scroll, dockSplit, dock.el);
  const body = el('div', { class: 'ar-body' }, browser.el, navSplit, main);
  root.append(tools, body);
  // l'arrangement prend un asset (onDrop, plus bas) : il le dit au panneau Asset, dont il fait les filtres
  declareZone(scroll, { kinds: ['audio', 'midi'], label: 'l’arrangement' });

  const X = (b) => b * ppb();
  const beatAt = (clientX) => (clientX - grid.getBoundingClientRect().left - HEAD_W) / ppb();
  const snapB = (b, e) => { const u = e?.altKey ? 0 : snapU(); return u ? Math.round(b / u) * u : b; };

  // ── la vue : ce qui se voit, la fenêtre des toiles, la largeur ──
  // vueW : la largeur visible des voies (sans les en-têtes), tenue par un
  // ResizeObserver plutôt que lue (clientWidth) à chaque geste ; portee : le
  // bord droit à tenir (px des voies), deux écrans au-delà de ce qui se voit ;
  // win : la fenêtre des toiles, ce qui se voit et un écran de chaque côté.
  let vueW = Math.max(400, innerWidth - HEAD_W);
  let portee = 0;
  let win = { a: 0, b: 0 };
  const fenetre = (sl) => { win = { a: Math.max(0, sl - vueW), b: sl + 2 * vueW }; };
  // la largeur des voies : le morceau et huit mesures, et jamais moins que la
  // portée — la grille continue à droite, comme dans Live
  const finMorceau = () => (Math.max(projEnd(P()), P().loop.b, 16 * P().sig) + 8 * P().sig) * ppb();
  const width = () => Math.max(finMorceau(), portee);
  // la largeur posée sur la grille CSS : la colonne des voies (elles s'y
  // étirent, sans largeur chacune) — une propriété qui ne s'hérite pas : rien
  // n'est recalculé dans les pistes
  function poserLargeur() {
    const Wd = width();
    grid.style.gridTemplateColumns = `${HEAD_W}px ${Wd}px`;
    grid.style.width = `${HEAD_W + Wd}px`;
    return Wd;
  }

  // ── la grille, selon le zoom ──
  // Le trait fin : le premier pas (double-croche, croche, noire, mesure, puis
  // groupes de mesures) qui laisse FIN_PX ; le moyen : le temps (de loin, le
  // fin lui-même) ; le fort : la mesure (de loin, quatre pas fins). Les
  // numéros : toutes les 1, 2, 4… mesures, NUM_PX au moins entre eux.
  function grille() {
    const z = ppb(), sig = P().sig;
    const pas = [0.25, 0.5, 1, sig, 2 * sig, 4 * sig, 8 * sig, 16 * sig, 32 * sig, 64 * sig, 128 * sig];
    const fin = pas.find((s) => s * z >= FIN_PX) ?? pas[pas.length - 1];
    return {
      fin, moyen: Math.max(1, fin), fort: fin < sig ? sig : 4 * fin,
      num: [1, 2, 4, 8, 16, 32, 64, 128, 256].find((k) => k * sig * z >= NUM_PX) ?? 256,
      temps: z >= TEMPS_PX,
    };
  }
  // Les traits, toujours peints sur une toile (jamais en dégradés CSS : trois
  // dégradés répétés sur la zone des pistes coûtaient à eux seuls deux tiers
  // de l'image pendant un zoom — mesuré le 05/10, Chromium sans GPU : 54 ms
  // par image avec eux, 18 sans ; sous SwiftShader, la règle et l'arc en
  // dégradés pesaient encore un tiers). `chaqueTrait(a, w, fn)` : un trait par
  // pas fin entre a et a + w (px des voies) ; `fn(x, force)`, x depuis a, la
  // force celle du plus grand pas qui tombe là. Le trait suit l'encre du
  // thème, plus ou moins appuyé (ALPHA).
  const ALPHA = { fort: 0.2, moyen: 0.1, fin: 0.05 };
  function chaqueTrait(a, w, fn) {
    const z = ppb(), G = grille(), px = G.fin * z;
    const rm = Math.round(G.moyen / G.fin), rf = Math.round(G.fort / G.fin);
    for (let i = Math.max(0, Math.ceil(a / px)); i * px < a + w; i++) fn(i * px - a, i % rf === 0 ? 'fort' : i % rm === 0 ? 'moyen' : 'fin');
  }
  // Les voies : des traits PAR-DESSUS les pistes et leurs clips (on vise un
  // temps à travers une forme d'onde), dans .ar-lignes, posée sur la zone des
  // pistes par les lignes de la grille CSS (render). Les traits sont
  // verticaux : une toile d'UN pixel de haut, étirée sur toute la hauteur, les
  // porte tous — sur la fenêtre, repeinte en quelques microsecondes à chaque
  // image de zoom.
  const lignesCv = el('canvas', { class: 'ar-lignes-cv' });
  const lignes = el('div', { class: 'ar-lignes', 'aria-hidden': 'true' }, lignesCv);
  function peindreLignes() {
    const dpr = devicePixelRatio || 1, lw = Math.max(1, Math.round(dpr));
    const a = Math.floor(win.a), w = Math.max(1, Math.ceil(win.b - a)), W = Math.round(w * dpr);
    if (lignesCv.width !== W) { lignesCv.width = W; lignesCv.height = 1; lignesCv.style.width = `${w}px`; }
    lignesCv.style.transform = `translateX(${a}px)`;
    const g = lignesCv.getContext('2d');
    g.clearRect(0, 0, W, 1);
    g.fillStyle = tok('ink');
    chaqueTrait(a, w, (x, f) => { g.globalAlpha = ALPHA[f]; g.fillRect(Math.round(x * dpr), 0, lw, 1); });
    g.globalAlpha = 1;
  }
  const sel = () => new Set(S.sel.clips || []);
  const visTracks = () => P().tracks.filter((t) => t.kind !== 'bus');
  const lanesOf = (t) => (ui().auto?.[t.id] ? (P().auto || []).filter((L) => app.mod(L.mod)?.track === t.id) : []);

  // ── la barre d'outils ──
  let zoomLab = null;   // le nombre de px par mesure : le zoom le récrit en place
  function paintTools() {
    const c = app.clip(S.sel.clip);
    const t = c && app.track(c.track);
    const n = (S.sel.clips || []).length;
    const pos = app.pos();
    const inside = c && pos > c.start && pos < c.start + c.len;
    const T = app.timeSel(), R = app.timeRange();   // la sélection de temps (musique.js)
    // Couper : une plage, le marqueur dans un clip de ses pistes, sinon la tête dans le clip choisi
    const ins = app.engine.insert;
    const cutOK = R ? true : T ? P().clips.some((x) => T.tracks.includes(x.track) && ins > x.start && ins < x.start + x.len) : inside;
    const btn = (label, on, why, fn, title = '') => el('button', { class: 'tb ghost sm', type: 'button', disabled: !on || null,
      title: on ? title : why, onclick: fn }, label);
    const snapSel = el('select', { class: 'fld mu-mini', 'aria-label': 'aimant', title: 'aimant à la grille (Alt en glissant : libre) · Ctrl+1 / Ctrl+2 : resserrer / élargir',
      onchange: (e) => { ui().snap = e.target.value === 'bar' ? 'bar' : +e.target.value; app.saveUi(); paintTools(); } },
    SNAPS.map(([v, l]) => el('option', { value: v, selected: String(ui().snap ?? 1) === String(v) || null }, l)));
    const fileIn = el('input', { type: 'file', multiple: true, accept: 'audio/*,.wav,.mp3,.flac,.m4a,.ogg', hidden: true,
      onchange: () => { app.importFiles([...fileIn.files], { track: S.sel.track, at: app.pos() }); fileIn.value = ''; } });
    put(tools,
      el('button', { class: 'tb ghost sm', type: 'button', title: 'Ctrl+T : piste audio · Ctrl+Maj+T : piste MIDI', onclick: (e) => addTrackMenu(e) }, '+ Piste'),
      el('button', { class: 'tb ghost sm', type: 'button', 'data-imp': '', title: 'des fichiers audio du disque (WAV, MP3, FLAC, M4A, OGG) : à la tête de lecture, sur la piste audio choisie ; on peut aussi les glisser sur l\'arrangement',
        onclick: () => fileIn.click() }, 'Importer'), fileIn,
      el('button', { class: 'tb ghost sm', type: 'button', title: 'un son de la bibliothèque, à la tête de lecture',
        onclick: () => app.addAudio(S.sel.track) }, '+ Son'),
      el('i', { class: 'ar-sep' }),
      el('label', { class: 'ar-lab' }, el('span', { class: 'lbl' }, 'aimant'), snapSel),
      el('i', { class: 'ar-sep' }),
      btn('Couper', cutOK, T ? 'le marqueur d\'insertion n\'est dans aucun clip : clique dans un clip, là où le couper' : c ? 'clique dans le clip, là où le couper' : 'clique dans un clip, ou glisse une plage', () => app.splitAtPlayhead(), R ? 'aux bords de la plage · Ctrl+E' : 'au marqueur d\'insertion · Ctrl+E'),
      btn('Dupliquer', n > 0 || !!R, 'choisis un clip (sa barre de titre), ou glisse une plage', () => app.duplicateSel(), R ? 'la plage, juste après elle · Ctrl+D' : 'Ctrl+D'),
      btn(R ? 'En faire un clip' : 'Consolider', n > 0 || !!R, 'choisis des clips, ou glisse une plage', () => app.consolidateSel(), R ? 'la plage devient un clip, sur chaque piste · Ctrl+J' : 'un seul clip · Ctrl+J'),
      btn('Boucler', n > 0 || !!R, 'choisis des clips, ou une plage', () => app.loopSelection(), 'la boucle sur la sélection · Ctrl+L'),
      btn(c?.mute ? 'Activer' : 'Désactiver', n > 0, 'choisis un clip', () => app.muteSel(), '0'),
      btn('Retirer', n > 0 || !!R, 'choisis un clip, ou une plage', () => app.removeSel(), R ? 'ce que la plage contient · Suppr' : 'Suppr'),
      el('span', { class: 'sp' }),
      el('span', { class: 'lbl ar-info' }, R ? `plage · ${app.bar(R.a)} → ${app.bar(R.b)} · ${R.tracks.length} piste${R.tracks.length > 1 ? 's' : ''}` : n > 1 ? `${n} clips choisis` : c ? `${t.name} · ${app.bar(c.start)} → ${app.bar(c.start + c.len)}` : 'double-clic sur une piste : un clip · glisser : une plage'),
      el('i', { class: 'ar-sep' }),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'dézoomer · − (Alt+molette)', onclick: () => setZoom(zoomCible() / 1.25) }, '−'),
      el('span', { class: 'ar-zoom', title: 'pixels par mesure' }, zoomLab = el('b', {}, String(Math.round(ppb() * P().sig))), ' px/mes'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'zoomer · + (Alt+molette)', onclick: () => setZoom(zoomCible() * 1.25) }, '+'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'tout le morceau dans la fenêtre · W', onclick: fit }, 'Ajuster'),
      el('div', { class: 'seg', title: 'hauteur des pistes (toutes) · Ctrl+molette ; sur le nom d\'une piste : la sienne · Alt + / Alt − · H : ajuster' }, [[60, 'S'], [88, 'M'], [124, 'L']].map(([h, l]) =>
        el('button', { class: `tb${th() === h ? ' on' : ''}`, type: 'button', onclick: () => { ui().th = h; delete ui().thT; app.saveUi(); render(); } }, l))),
      el('i', { class: 'ar-sep' }),
      el('button', { class: `tb sm${ui().dock !== false ? ' on' : ' ghost'}`, type: 'button', title: 'la vue de détail en bas : le clip ou les instruments · Ctrl+Alt+3 / Ctrl+Alt+4',
        onclick: () => { ui().dock = ui().dock === false; app.saveUi(); render(); } }, 'Détail'));
  }

  function addTrackMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    menu(r.left, r.bottom + 4, [...app.trackChoices(), '-', ...genTrackChoices(app)]);
  }

  // ── le zoom horizontal, ancré sur un point de l'écran (le curseur, ou le milieu) ──
  // Une molette ou un pavé envoient plusieurs événements par image : chacun ne
  // fait que noter la demande (zoomPend, le zoom visé et son ancre, mx : px
  // depuis le bord gauche de la zone qui défile) ; l'image suivante l'applique
  // une fois (appliquerZoom). Les crans d'une même image se multiplient
  // (zoomCible part du zoom déjà demandé, pas du zoom posé).
  let zoomPend = null, zoomRaf = 0, zoomRepos = 0;
  const zoomCible = () => zoomPend?.z ?? ppb();
  function zoomAround(z, mx = HEAD_W + vueW / 2) {
    zoomPend = { z: clamp(z, Z_MIN, Z_MAX), mx };
    if (!zoomRaf) zoomRaf = requestAnimationFrame(appliquerZoom);
  }
  function appliquerZoom() {
    zoomRaf = 0;
    const q = zoomPend;
    zoomPend = null;
    if (!q || q.z === ppb()) return;
    // lu avant toute écriture de l'image : la mise en page est encore propre
    const b = (scroll.scrollLeft + q.mx - HEAD_W) / ppb();
    poserZoom(q.z, b * q.z + HEAD_W - q.mx, true);
    // le geste fini, les formes d'onde étirées sont repeintes nettes
    clearTimeout(zoomRepos);
    zoomRepos = setTimeout(() => pourClips(drawClip), ZOOM_REPOS);
  }
  // poser un zoom et un défilement : en place (echelle), sans refaire la vue
  function poserZoom(z, left, geste = false) {
    if (!geste) zoomPend = null;   // W, Z, X l'emportent sur des crans encore en route
    ui().ppb = clamp(z, Z_MIN, Z_MAX);
    app.saveUi();
    const sl = Math.max(0, left);
    echelle(sl, geste);
    scroll.scrollLeft = sl;    // la largeur va deux écrans au-delà : jamais bornée à droite
    frame(app.pos());          // la tête et l'enregistrement, à leur place dans la même image
  }
  const setZoom = (z) => zoomAround(z);
  function fit() {
    const end = Math.max(projEnd(P()), P().loop.on ? P().loop.b : 0, 4 * P().sig);
    poserZoom((vueW - 30) / end, 0);
  }
  // H : les pistes à la hauteur qui les fait toutes tenir
  function fitHeight() {
    const n = visTracks().length || 1;
    const avail = scroll.clientHeight - RULER_H - ARC_H - (AR().ouvert ? (1 + (P().arcs || []).length) * AUTO_H : 0) - 70;
    ui().th = clamp(Math.floor(avail / n), TH_MIN, TH_MAX);
    delete ui().thT;                                    // toutes à la même hauteur
    app.saveUi();
    render();
  }
  // Ctrl+molette (commun/molette.js) : une piste (son id), ou toutes — les
  // hauteurs propres suivent le même rapport ; toutes : ce qui est sous le
  // curseur y reste. Comme le zoom : une seule mise à jour par image, les
  // crans d'une même image multipliés (une autre piste visée : la demande
  // d'avant part tout de suite).
  let hautPend = null, hautRaf = 0;
  function scaleHeights(f, id, clientY) {
    const cle = id || null;
    if (hautPend && hautPend.id !== cle) appliquerHauteurs();
    hautPend = { f: (hautPend?.f || 1) * f, id: cle, clientY };
    if (!hautRaf) hautRaf = requestAnimationFrame(appliquerHauteurs);
  }
  function appliquerHauteurs() {
    if (hautRaf) { cancelAnimationFrame(hautRaf); hautRaf = 0; }
    const q = hautPend;
    hautPend = null;
    if (!q) return;
    const { f, id, clientY } = q;
    const t = id && app.track(id);
    const k = (h) => Math.round(borne(h * f, TH_MIN, TH_MAX) * 10) / 10;
    const go = () => {
      if (t) ui().thT = { ...(ui().thT || {}), [t.id]: k(thOf(t)) };
      else {
        ui().th = k(th());
        if (ui().thT) ui().thT = Object.fromEntries(Object.entries(ui().thT).map(([i, h]) => [i, k(h)]));
      }
      app.saveUi();
      render();
    };
    if (t || clientY === undefined) go(); else tenirY(scroll, clientY, go);
  }
  // Z : zoomer sur la sélection (les clips choisis, sinon la boucle) ; X : revenir
  let zoomBack = null;
  function zoomToSelection() {
    const g = P().clips.filter((c) => sel().has(c.id));
    const [a, b] = g.length ? [Math.min(...g.map((c) => c.start)), Math.max(...g.map((c) => c.start + c.len))] : [P().loop.a, P().loop.b];
    if (b <= a) return;
    zoomBack = { ppb: ppb(), left: scroll.scrollLeft };
    const z = clamp((vueW - 40) / (b - a), Z_MIN, Z_MAX);
    poserZoom(z, a * z);
  }
  function zoomOut() {
    if (!zoomBack) return;
    poserZoom(zoomBack.ppb, zoomBack.left);
    zoomBack = null;
  }

  // ── la règle : sections, mesures, boucle, marqueurs ──
  // ce que le zoom déplace dans la règle, sans la refaire (echelle)
  const regle = { secs: [], marks: [], loop: null, nums: null };
  function ruler() {
    const p = P();
    const r = el('div', { class: 'ar-ruler' });   // sa largeur : la colonne des voies
    const secRow = el('div', { class: 'ar-secs', title: 'double-clic : une section · sur une section : la renommer · glisser : la déplacer avec ses clips (Maj : l\'étiquette seule) · clic droit : dupliquer, colorer…' });
    const liees = sectionsLiees(p);   // tenues par les balises des paroles d'une région (projet.js, la structure)
    regle.secs = [...p.sections].sort((x, y) => x.a - y.a).map((s) => [sectionEl(s, liees.has(s.id)), s]);
    for (const [box] of regle.secs) secRow.append(box);
    const barRow = el('div', { class: 'ar-bars' });
    const band = el('div', { class: 'ar-band', title: 'glisser : la boucle' });
    const L = el('div', { class: `ar-loop${p.loop.on ? ' on' : ''}`, style: { left: `${X(p.loop.a)}px`, width: `${X(p.loop.b - p.loop.a)}px` } },
      el('i', { class: 'h a' }), el('i', { class: 'h b' }));
    band.append(L);
    regle.loop = L;
    const nums = el('div', { class: 'ar-nums', title: 'clic : aller là · glisser à l\'horizontale : chercher · à la verticale : zoomer · double-clic : zoomer sur la sélection' });
    // les numéros et les graduations, sur la fenêtre (paintNums)
    regle.nums = nums;
    paintNums();
    // (plus de triangle dans la règle : l'onglet de LA tête de lecture la marque, commun/tete.js)
    barRow.append(band, nums);
    regle.marks = p.markers.map((m) => [markerEl(m), m]);
    for (const [box] of regle.marks) barRow.append(box);
    r.append(secRow, barRow);

    // la boucle
    band.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;   // le bouton droit : le menu de la règle, pas un geste
      e.preventDefault();
      band.setPointerCapture(e.pointerId);
      const b0 = beatAt(e.clientX);
      const edge = e.target.classList.contains('h') ? (e.target.classList.contains('a') ? 'a' : 'b') : null;
      const inLoop = !edge && e.target === L;
      const la = p.loop.a, lb = p.loop.b;
      const mv = (ev) => {
        const u = ev.altKey ? 0.25 : Math.max(1, snapU()), b = Math.round(beatAt(ev.clientX) / u) * u;
        if (edge === 'a') p.loop.a = clamp(b, 0, p.loop.b - u);
        else if (edge === 'b') p.loop.b = Math.max(p.loop.a + u, b);
        else if (inLoop) { const d = Math.round((beatAt(ev.clientX) - b0) / u) * u; p.loop.a = Math.max(0, la + d); p.loop.b = p.loop.a + (lb - la); }
        else { const s = Math.round(b0 / u) * u; p.loop.a = Math.max(0, Math.min(s, b)); p.loop.b = Math.max(s, b); if (p.loop.b - p.loop.a < u) p.loop.b = p.loop.a + u; }
        L.style.left = `${X(p.loop.a)}px`; L.style.width = `${X(p.loop.b - p.loop.a)}px`;
        paintZone();
      };
      const up = () => { band.removeEventListener('pointermove', mv); band.removeEventListener('pointerup', up); p.loop.on = true; app.commit('meta'); };
      band.addEventListener('pointermove', mv); band.addEventListener('pointerup', up);
    });
    // la règle des temps (Live) : glisser à l'horizontale = chercher, à la verticale = zoomer
    nums.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const x0 = e.clientX, y0 = e.clientY, z0 = ppb();
      const mx = e.clientX - scroll.getBoundingClientRect().left;
      let mode = null;
      ecouteDebut();
      ecouteSeek(Math.max(0, snapB(beatAt(e.clientX), e)));
      // zoomer redessine la règle : le geste s'écoute sur la fenêtre, pas sur elle
      const mv = (ev) => {
        if (!mode && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4) mode = Math.abs(ev.clientY - y0) > Math.abs(ev.clientX - x0) ? 'zoom' : 'seek';
        if (mode === 'zoom') zoomAround(z0 * Math.pow(1.012, ev.clientY - y0), mx);
        else if (mode === 'seek') ecouteSeek(Math.max(0, snapB(beatAt(ev.clientX), ev)));
      };
      const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); ecoute.fin(); paintTools(); };
      addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
    });
    nums.addEventListener('dblclick', () => zoomToSelection());
    barRow.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const b = Math.max(0, snapB(beatAt(e.clientX), e));
      menu(e.clientX, e.clientY, [
        { head: `mesure ${app.bar(b)}` },
        { label: 'Aller là', onclick: () => app.engine.seek(b) },
        { label: 'Un marqueur ici', sub: 'Maj+M', onclick: () => app.addMarker(b) },
        { label: 'Une section ici', onclick: () => addSectionAt(b) },
        { label: 'La boucle commence ici', onclick: () => { p.loop.a = Math.min(b, p.loop.b - 1); p.loop.on = true; app.commit('meta'); } },
        { label: 'La boucle finit ici', onclick: () => { p.loop.b = Math.max(b, p.loop.a + 1); p.loop.on = true; app.commit('meta'); } },
      ]);
    });
    secRow.addEventListener('dblclick', (e) => {
      if (e.target !== secRow) return;
      addSectionAt(Math.max(0, Math.floor(beatAt(e.clientX) / p.sig) * p.sig));
    });
    return r;
  }

  // Les numéros de mesure et les graduations, sur la fenêtre seulement (le
  // reste n'existe pas : la règle n'a pas de fin à droite). Les numéros :
  // toutes les 1, 2, 4… mesures selon le zoom ; de près, les temps (« 5.2 »),
  // plus pâles. Les graduations : celles de la grille des voies (chaqueTrait),
  // la mesure sur toute la hauteur, le temps et le pas fin en bas.
  const NUMS_H = BAR_H - 7;    // .ar-nums : la rangée des mesures sous la bande de boucle
  const numsCv = el('canvas', { class: 'ar-nums-cv' });
  function paintNums() {
    const nums = regle.nums;
    if (!nums) return;
    const sig = P().sig, z = ppb(), G = grille(), bar = sig * z, k = G.num;
    const m0 = Math.max(0, Math.floor(win.a / bar / k) * k), m1 = Math.ceil(win.b / bar);
    const out = [numsCv];
    for (let m = m0; m <= m1; m += k) {
      out.push(el('span', { style: { left: `${m * bar}px` } }, String(m + 1)));
      if (G.temps && k === 1) for (let t = 1; t < sig; t++) out.push(el('span', { class: 't', style: { left: `${(m * sig + t) * z}px` } }, `${m + 1}.${t + 1}`));
    }
    nums.replaceChildren(...out);
    const dpr = devicePixelRatio || 1, lw = Math.max(1, Math.round(dpr));
    const a = Math.floor(win.a), w = Math.max(1, Math.ceil(win.b - a)), W = Math.round(w * dpr), H = Math.round(NUMS_H * dpr);
    if (numsCv.width !== W || numsCv.height !== H) { numsCv.width = W; numsCv.height = H; numsCv.style.width = `${w}px`; numsCv.style.height = `${NUMS_H}px`; }
    numsCv.style.transform = `translateX(${a}px)`;
    const g = numsCv.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.fillStyle = tok('ink');
    const haut = { fort: H, moyen: Math.round(9 * dpr), fin: Math.round(5 * dpr) };
    chaqueTrait(a, w, (x, f) => { g.globalAlpha = ALPHA[f] * 1.4; g.fillRect(Math.round(x * dpr), H - haut[f], lw, haut[f]); });
    g.globalAlpha = 1;
  }

  function addSectionAt(b) {
    const p = P();
    const next = [...p.sections].filter((s) => s.a > b).sort((x, y) => x.a - y.a)[0];
    const inside = sectionAt(p, b);
    if (inside) { toast(`déjà dans « ${inside.name} » : la section commence où la précédente finit`); return; }
    const end = Math.min(next ? next.a : Infinity, b + 4 * p.sig);
    const name = SECTION_NAMES[p.sections.length % SECTION_NAMES.length];
    const s = { id: app.uid('s'), name, a: b, b: end, color: COLORS[(p.sections.length + 1) % COLORS.length], tag: guessTag(name) };
    p.sections.push(s);
    app.commit('data');
    toast(`section « ${name} » : double-clic dessus pour la renommer`);
  }
  const renameSection = (s, node) => inlineEdit(node, s.name, (n) => { s.name = n.slice(0, 40); s.tag = guessTag(s.name); app.commit('data'); }, { max: 40 });

  // Les mesures d'une section, justes (06/10) : « mesures 5 à 8 · 4 mes. » — la
  // fin d'une section est le début de la suivante (01.1 → 05.1 disait la 5 en trop)
  function mesuresDe(s) {
    const sig = P().sig, m1 = Math.floor(s.a / sig + 1e-9) + 1, m2 = Math.max(m1, Math.ceil(s.b / sig - 1e-9));
    const n = Math.round(((s.b - s.a) / sig) * 100) / 100;
    return { txt: m1 === m2 ? `mesure ${m1}` : `mesures ${m1} à ${m2}`, n: `${String(n).replace('.', ',')} mes.` };
  }
  // `liee` : une balise des paroles d'une région la tient (projet.js, la structure) — son [étiquette] s'affiche
  function sectionEl(s, liee = false) {
    const p = P();
    const nm = el('b', {}, s.name);
    const M = mesuresDe(s);
    const box = el('div', { class: `ar-sec${liee ? ' liee' : ''}`, style: { left: `${X(s.a)}px`, width: `${Math.max(6, X(s.b - s.a) - 2)}px`, '--c': `var(--${s.color || 'cy'})` },
      title: `${s.name} · ${M.txt} · ${M.n} · ${SECTION_TAGS.find(([k]) => k === s.tag)?.[1] || s.tag || ''} [${s.tag || 'verse'}]${liee ? ' · tenue par les paroles d\'une région : la renommer, l\'étiqueter, la déplacer récrit leurs balises' : ''} — double-clic : renommer` },
    nm, liee ? el('i', { class: 'tg' }, `[${s.tag}]`) : null, el('i', { class: 'e l' }), el('i', { class: 'e r' }));
    box.addEventListener('dblclick', (e) => { e.stopPropagation(); renameSection(s, nm); });
    box.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); sectionMenu(e, s, nm); });
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || nm.classList.contains('editing')) return;
      e.preventDefault(); e.stopPropagation();
      const edge = e.target.classList.contains('e') ? (e.target.classList.contains('l') ? 'l' : 'r') : null;
      box.setPointerCapture(e.pointerId);
      const x0 = e.clientX, a0 = s.a, b0 = s.b, bar = p.sig;
      let moved = false;
      const mv = (ev) => {
        const d = Math.round((ev.clientX - x0) / ppb() / bar) * bar;
        if (Math.abs(ev.clientX - x0) > 3) moved = true;
        if (edge === 'l') s.a = clamp(a0 + d, 0, b0 - bar);
        else if (edge === 'r') s.b = Math.max(a0 + bar, b0 + d);
        else { box.style.transform = `translateX(${X(d)}px)`; box.dataset.d = d; return; }
        box.style.left = `${X(s.a)}px`; box.style.width = `${Math.max(6, X(s.b - s.a) - 2)}px`;
      };
      const up = (ev) => {
        box.removeEventListener('pointermove', mv); box.removeEventListener('pointerup', up);
        if (!moved) return;
        if (edge) {
          const clash = p.sections.find((o) => o !== s && o.a < s.b - 1e-9 && o.b > s.a + 1e-9);
          if (clash) { s.a = a0; s.b = b0; toast(`la section toucherait « ${clash.name} »`); render(); return; }
          app.commit('data'); return;
        }
        const d = +box.dataset.d || 0;
        if (!d) { render(); return; }
        if (ev.shiftKey) {
          const clash = p.sections.find((o) => o !== s && o.a < b0 + d - 1e-9 && o.b > a0 + d + 1e-9);
          if (clash || a0 + d < 0) { toast(clash ? `la place est prise par « ${clash.name} »` : 'avant le début'); render(); return; }
          s.a = a0 + d; s.b = b0 + d; app.commit('data'); return;
        }
        const why = moveSection(p, s, a0 + d);
        if (why) { toast(`déplacement refusé : ${why}`); render(); return; }
        toast(`« ${s.name} » déplacée avec ses clips`);
        app.commit('data');
      };
      box.addEventListener('pointermove', mv); box.addEventListener('pointerup', up);
    });
    return box;
  }

  function sectionMenu(e, s, nm) {
    const p = P();
    menu(e.clientX, e.clientY, [
      { head: `${s.name} · ${mesuresDe(s).txt} · ${mesuresDe(s).n}` },
      { label: 'Renommer', sub: 'double-clic', onclick: () => renameSection(s, nm) },
      { label: 'Dupliquer avec ses clips', sub: 'insère la copie après', onclick: () => { const n = duplicateSection(p, s, app.uid); toast(`« ${n.name} » dupliquée : ${app.bar(n.a)} → ${app.bar(n.b)}`); app.commit('data'); } },
      { label: 'Avancer (échanger avec la précédente)', onclick: () => { const w = swapSection(p, s, -1); if (w) toast(w); else app.commit('data'); } },
      { label: 'Reculer (échanger avec la suivante)', onclick: () => { const w = swapSection(p, s, 1); if (w) toast(w); else app.commit('data'); } },
      { label: 'Choisir ses clips', onclick: () => { app.selectClips(p.clips.filter((c) => c.start >= s.a && c.start < s.b).map((c) => c.id)); } },
      { label: 'Boucler sur la section', onclick: () => { p.loop = { on: true, a: s.a, b: s.b }; app.commit('meta'); } },
      '-', { head: 'couleur' },
      ...COLORS.map((c) => ({ label: COLOR_FR[c], dot: c, onclick: () => { s.color = c; app.commit('data'); } })),
      '-', { head: 'dans les paroles (génératif)' },
      ...SECTION_TAGS.map(([k, l]) => ({ label: `${l}${s.tag === k ? ' ·' : ''}`, sub: `[${k}]`, onclick: () => { s.tag = k; app.commit('data'); } })),
      '-',
      { label: 'Retirer la section (garder les clips)', onclick: () => { removeSection(p, s, false); app.commit('data'); } },
      { label: 'Retirer la section et ses clips', onclick: async () => {
        if (!(await confirmBox('Retirer', `Retirer « ${s.name} » et les clips qui y commencent ?`))) return;
        removeSection(p, s, true); app.commit('data');
      } },
    ]);
  }

  function markerEl(m) {
    const nm = el('span', {}, m.name);
    const box = el('div', { class: 'ar-mark', style: { left: `${X(m.b)}px` }, title: `${m.name} · ${app.bar(m.b)} — clic : aller là · glisser : déplacer · double-clic : renommer` },
      el('i'), nm);
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || nm.classList.contains('editing')) return;
      e.preventDefault(); e.stopPropagation();
      box.setPointerCapture(e.pointerId);
      const x0 = e.clientX, b0 = m.b;
      let moved = false;
      const mv = (ev) => { if (Math.abs(ev.clientX - x0) > 3) moved = true; m.b = Math.max(0, snapB(b0 + (ev.clientX - x0) / ppb(), ev)); box.style.left = `${X(m.b)}px`; };
      const up = () => { box.removeEventListener('pointermove', mv); box.removeEventListener('pointerup', up); if (moved) app.commit('data'); else app.engine.seek(m.b); };
      box.addEventListener('pointermove', mv); box.addEventListener('pointerup', up);
    });
    box.addEventListener('dblclick', (e) => { e.stopPropagation(); inlineEdit(nm, m.name, (n) => { m.name = n.slice(0, 40); app.commit('data'); }, { max: 40 }); });
    box.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); menu(e.clientX, e.clientY, [{ label: 'Aller là', onclick: () => app.engine.seek(m.b) }, { label: 'Retirer le marqueur', onclick: () => { P().markers = P().markers.filter((x) => x !== m); app.commit('data'); } }]); });
    return box;
  }

  // ── les courbes peintes : l'arc d'énergie, les voies d'automation ──
  // Glisser : peindre (la valeur suit la souris, posée à chaque pas de la
  // résolution) ; Maj : une droite depuis le point de départ ; clic droit :
  // effacer ce qu'on survole.
  // La toile ne couvre que la fenêtre (win) : posée à sa gauche (transform),
  // elle dessine dans les coordonnées de la voie ; sa taille ne dépend ni du
  // zoom ni de la longueur du morceau. Le zoom la repeint à chaque image (peu
  // de points), le défilement quand on sort de la fenêtre (toiles).
  const toiles = [];
  // `traits` : la toile peint aussi les traits de la grille (l'arc, collé en
  // haut au-dessus de ceux des voies) ; `neutre` : la valeur où la courbe ne
  // change rien (un tiret, les arcs du groupe) ; `fond(g, y)` : ce qui se peint
  // dessous (la rangée du groupe : les autres arcs, pâles)
  function paintable(cv, getPts, { res, h, color, columns, traits = false, neutre = null, fond = null, onDone }) {
    const draw = () => {
      const pts = getPts(), a = Math.floor(win.a), w = Math.max(4, Math.ceil(win.b - a)), dpr = devicePixelRatio || 1;
      const W = Math.round(w * dpr), H = Math.round(h * dpr);
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; cv.style.width = `${w}px`; cv.style.height = `${h}px`; }
      cv.style.transform = `translateX(${a}px)`;
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, -a * dpr, 0);
      g.clearRect(a, 0, w, h);
      if (traits) {
        const lw = Math.max(1, Math.round(dpr)) / dpr;
        g.fillStyle = tok('ink');
        chaqueTrait(a, w, (x, f) => { g.globalAlpha = ALPHA[f]; g.fillRect(a + Math.round(x * dpr) / dpr, 0, lw, h); });
        g.globalAlpha = 1;
      }
      const y = (v) => 4 + (1 - v) * (h - 8);
      if (neutre !== null) {
        g.strokeStyle = tok('ink3'); g.globalAlpha = 0.5; g.lineWidth = 1; g.setLineDash([3, 4]);
        g.beginPath(); g.moveTo(a, Math.round(y(neutre)) + 0.5); g.lineTo(a + w, Math.round(y(neutre)) + 0.5); g.stroke();
        g.setLineDash([]); g.globalAlpha = 1;
      }
      if (fond) fond(g, y, a, w);
      if (!pts.length) {
        g.fillStyle = tok('ink3'); g.font = `9px ${tok('f-mono') || 'monospace'}`;
        g.fillText('glisser pour peindre', 8, h / 2 + 3);
        return;
      }
      if (columns) {
        g.fillStyle = tok('or-bg');
        for (let i = 0; i < pts.length; i++) {
          const x0 = X(pts[i][0]), x1 = i + 1 < pts.length ? X(pts[i + 1][0]) : x0 + X(res);
          g.fillRect(x0 + 1, y(pts[i][1]), Math.max(1, x1 - x0 - 2), h - y(pts[i][1]));
        }
      }
      g.strokeStyle = tok(color); g.lineWidth = 1.6; g.beginPath();
      g.moveTo(0, y(pts[0][1]));
      for (const [b, v] of pts) g.lineTo(X(b), y(v));
      g.lineTo(a + w, y(pts[pts.length - 1][1]));
      g.stroke();
      if (!columns) { g.fillStyle = tok(color); for (const [b, v] of pts) g.fillRect(X(b) - 2, y(v) - 2, 4, 4); }
    };
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.dataset.nomenu = '';   // le bouton droit y efface : c'est un geste, pas un menu
    cv.addEventListener('pointerdown', (e) => {
      if (e.button === 1) return;   // le bouton du milieu n'y peint pas
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      const pts = getPts();
      const erase = e.button === 2;
      const orig = pts.map((p) => [...p]);
      const r = cv.parentNode.getBoundingClientRect();   // la voie (le temps 0), pas la toile posée sur la fenêtre
      const at = (ev) => ({ b: Math.max(0, (ev.clientX - r.left) / ppb()), v: clamp(1 - (ev.clientY - r.top - 4) / (h - 8), 0, 1) });
      const a0 = at(e);
      let prev = a0;
      const gridB = (b) => Math.round(b / res) * res;
      const put1 = (b, v) => {
        const gb = gridB(b);
        const i = pts.findIndex((p) => Math.abs(p[0] - gb) < res / 2 - 1e-9);
        if (erase) { if (i >= 0) pts.splice(i, 1); return; }
        if (i >= 0) pts[i][1] = v; else pts.push([gb, v]);
      };
      const seg = (p0, p1) => {
        const lo = Math.min(p0.b, p1.b), hi = Math.max(p0.b, p1.b);
        for (let b = gridB(lo); b <= gridB(hi) + 1e-9; b += res) {
          const t = hi > lo ? clamp((b - p0.b) / (p1.b - p0.b), 0, 1) : 1;
          put1(b, p0.v + (p1.v - p0.v) * t);
        }
      };
      seg(a0, a0);
      pts.sort((x, y) => x[0] - y[0]); draw();
      const mv = (ev) => {
        const a = at(ev);
        if (ev.shiftKey && !erase) { pts.splice(0, pts.length, ...orig.map((p) => [...p])); seg(a0, a); }
        else seg(prev, a);
        prev = a;
        pts.sort((x, y) => x[0] - y[0]); draw();
      };
      const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); onDone(); };
      cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
    });
    toiles.push(draw);
    requestAnimationFrame(draw);
    return draw;
  }

  // ── les arcs : le groupe en accordéon (06/10, arcs.js) ──
  // Cal : « l'arc d'énergie doit être dans un groupe d'arcs ; on a le volume,
  // mais il en faut d'autres : réverbe et delay […] un groupe par défaut qu'on
  // peut replier en accordéon ». La rangée du groupe, collée en haut sous la
  // règle, résume : toutes les courbes, pâles, et l'arc qu'elle peint (« peindre :
  // Énergie », au choix) ; dépliée, un arc par rangée dessous, chacun se peint
  // (glisser ; Maj : une droite ; clic droit : effacer) et a son menu. Chaque
  // geste passe par app.commit : Ctrl+Z le reprend. Replier n'est pas un geste
  // (ui.arcs, comme la hauteur des pistes).
  const AR = () => (ui().arcs = ui().arcs || { ouvert: false, peint: 'energie' });
  const CIBLE_ENERGIE = { lpf: 'filtre de la sortie', vol: 'volume de la sortie', both: 'filtre et volume' };
  // ce qu'un arc tient, en mots (un retour absent le dit)
  function ditArc(A) {
    const d = ARCS[A.k];
    if (d.son !== 'retour') return d.dit;
    const rs = retoursDe(P(), A.k);
    return rs.length ? `envoi → ${rs.map((t) => t.name).join(', ')}` : `aucun retour de ${A.k === 'reverb' ? 'réverbe' : 'délai'}`;
  }
  // les arcs du groupe, vus par la vue : l'énergie (p.arc) en tête, puis p.arcs
  function arcsVus() {
    const p = P();
    const out = [{ id: 'energie', nom: ENERGIE.nom, couleur: ENERGIE.couleur, A: p.arc, pts: () => p.arc.pts, neutre: null, dit: CIBLE_ENERGIE[p.arc.to] || CIBLE_ENERGIE.lpf, doc: ENERGIE.doc }];
    for (const A of p.arcs || []) {
      const d = ARCS[A.k];
      if (d) out.push({ id: A.id, k: A.k, nom: d.nom, couleur: d.couleur, A, pts: () => ptsArc(p, A), neutre: d.neutre, dit: ditArc(A), doc: d.doc });
    }
    return out;
  }
  // une courbe pâle sous celle qu'on peint (la rangée du groupe)
  function courbePale(g, pts, y, a, w, couleur) {
    if (!pts.length) return;
    g.strokeStyle = tok(couleur); g.globalAlpha = 0.55; g.lineWidth = 1.2; g.beginPath();
    g.moveTo(a, y(pts[0][1]));
    for (const [b, v] of pts) g.lineTo(X(b), y(v));
    g.lineTo(a + w, y(pts[pts.length - 1][1]));
    g.stroke(); g.globalAlpha = 1;
  }
  const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)} %`);

  function arcsRows() {
    const G = AR(), vus = arcsVus();
    const peint = vus.find((v) => v.id === G.peint) || vus[0];
    const cv = el('canvas', { class: 'ar-curve' });
    const lane = el('div', { class: `ar-arc grp${peint.A.on === false ? ' off' : ''}`, title: `peindre l'arc « ${peint.nom} » (${peint.dit}) · Maj : une droite · clic droit : effacer — les autres arcs, pâles, dessous` }, cv);
    // collée en haut, au-dessus des traits des voies : elle peint les siens
    paintable(cv, peint.pts, { res: Math.max(0.25, snapU() || 1), h: ARC_H, color: peint.couleur, columns: peint.id === 'energie', traits: true, neutre: peint.neutre,
      fond: (g, y, a, w) => { for (const v of vus) if (v !== peint && v.A.on !== false) courbePale(g, v.pts(), y, a, w, v.couleur); },
      onDone: () => { app.label(`peindre l'arc « ${peint.nom} »`); app.commit('data'); } });
    const head = el('div', { class: `ar-arch grp${G.ouvert ? ' open' : ''}${peint.A.on === false ? ' off' : ''}` },
      el('div', { class: 'txt' }, el('b', {}, 'Arcs'), el('span', {}, `${vus.length} · ${G.ouvert ? 'un par rangée' : 'replié'} · ${peint.dit}`)),
      el('div', { class: 'row' },
        el('button', { class: 'tb sm ghost ar-pli', type: 'button', 'aria-expanded': G.ouvert ? 'true' : 'false',
          title: G.ouvert ? 'replier le groupe : une seule rangée qui résume' : 'déplier le groupe : un arc par rangée',
          onclick: () => { G.ouvert = !G.ouvert; app.saveUi(); render(); } }, G.ouvert ? '▾' : '▸'),
        el('button', { class: 'tb sm ghost ar-peint', type: 'button', style: { '--c': `var(--${peint.couleur})` }, title: `l'arc que cette rangée peint : ${peint.doc}`,
          onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(r.left, r.bottom + 4, [{ head: 'la rangée du groupe peint' },
            ...vus.map((v) => ({ label: v.nom, dot: v.couleur, checked: v === peint, sub: v.dit, onclick: () => { G.peint = v.id; app.saveUi(); render(); } }))]); } },
        el('i'), peint.nom),
        el('button', { class: `tb sm${peint.A.on !== false ? ' on' : ' ghost'}`, type: 'button', title: `« ${peint.nom} » ${peint.A.on !== false ? 'agit' : 'est éteint'} · clic : ${peint.A.on !== false ? 'l\'éteindre (son neutre)' : 'l\'allumer'}`,
          onclick: () => { peint.A.on = peint.A.on === false; app.label(`${peint.A.on ? 'allumer' : 'éteindre'} l'arc « ${peint.nom} »`); app.commit('meta'); } }, peint.A.on !== false ? 'Actif' : 'Éteint'),
        el('button', { class: 'tb sm ghost', type: 'button', title: 'ajouter un arc au groupe', onclick: (e) => addArcMenu(e) }, '+')));
    head.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); arcMenu(e, peint); });
    const rows = [head, lane];
    if (G.ouvert) for (const v of vus) rows.push(...arcRow(v));
    return rows;
  }

  // une rangée du groupe déplié : un arc
  function arcRow(v) {
    const A = v.A, G = AR(), mst = app.master(), on = A.on !== false;
    const cv = el('canvas', { class: 'ar-curve' });
    const ln = el('div', { class: `ar-alane arcl${on ? '' : ' off'}`, style: { '--c': `var(--${v.couleur})` } }, cv);
    paintable(cv, v.pts, { res: Math.max(0.25, snapU() || 1), h: AUTO_H, color: v.couleur, columns: v.id === 'energie', neutre: v.neutre,
      onDone: () => { app.label(`peindre l'arc « ${v.nom} »`); app.commit('data'); } });
    const pts = v.pts(), now = pts.length ? interp(pts, app.pos()) : v.neutre;
    const hd = el('div', { class: `ar-ahead arch${on ? '' : ' off'}${G.peint === v.id ? ' peint' : ''}`, 'data-arc': v.id, style: { '--c': `var(--${v.couleur})` }, title: v.doc },
      el('div', { class: 'txt' }, el('b', {}, el('i'), v.nom), el('span', {}, `${v.dit} · ${pct(now)}`)),
      el('div', { class: 'row' },
        el('button', { class: `tb sm${on ? ' on' : ' ghost'}`, type: 'button', title: on ? 'l\'arc agit · clic : l\'éteindre (son neutre)' : 'l\'arc est éteint · clic : l\'allumer',
          onclick: () => { A.on = !on; app.label(`${A.on ? 'allumer' : 'éteindre'} l'arc « ${v.nom} »`); app.commit('meta'); } }, on ? 'Actif' : 'Éteint'),
        v.id === 'energie' ? knob(spec('master', 'arc_lo'), val(mst, 'arc_lo'), { size: 'xs', accent: 'or', label: 'coupure basse de l\'arc',
          onInput: (x) => { mst.params.arc_lo = x; app.commit('param', mst); }, onChange: () => app.engine.settle() }) : null,
        el('button', { class: 'tb ghost sm', type: 'button', title: 'ce que l\'arc tient, effacer, monter, retirer', onclick: (e) => arcMenu(e, v) }, '···')));
    hd.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); arcMenu(e, v); });
    return [hd, ln];
  }

  function arcMenu(e, v) {
    const p = P(), A = v.A, G = AR();
    const i = (p.arcs || []).indexOf(A);
    const fait = (lab, fn, kind = 'meta') => () => { fn(); app.label(lab); app.commit(kind); };
    const items = [{ head: `arc · ${v.nom} · ${v.dit}` }];
    if (v.id === 'energie') {
      items.push({ head: 'l\'énergie tient' },
        ...[['lpf', 'le filtre de la sortie'], ['vol', 'le volume de la sortie'], ['both', 'les deux']].map(([k, l]) => ({ label: l, checked: A.to === k, onclick: fait(`l'énergie tient ${l}`, () => { A.to = k; }) })),
        '-',
        { label: 'Tout à fond (arc plat)', onclick: fait('énergie à fond', () => { A.pts = [[0, 1]]; }) },
        { label: 'Suivre les sections', sub: 'intro basse, refrain haut', onclick: fait('l\'énergie suit les sections', () => { A.pts = arcFromSections(p); }) });
    } else if (v.neutre !== null) {
      items.push({ label: 'Plat au neutre', sub: pct(v.neutre), onclick: fait(`« ${v.nom} » à plat`, () => { const pts = v.pts(); pts.splice(0, pts.length, [0, v.neutre]); }) });
    }
    if (ARCS[v.k]?.son === 'retour' && !retoursDe(p, v.k).length) {
      items.push({ label: v.k === 'reverb' ? 'Ajouter un retour de réverbération' : 'Ajouter un retour RTT-01', sub: 'la console', onclick: () => app.addBus(v.k === 'reverb' ? 'reverb' : 'rtt') });
    }
    items.push(
      { label: 'Effacer la courbe', disabled: !v.pts().length, why: 'la courbe est vide', onclick: fait(`effacer l'arc « ${v.nom} »`, () => { const pts = v.pts(); pts.splice(0, pts.length); }) },
      { label: 'La rangée du groupe le peint', checked: G.peint === v.id, onclick: () => { G.peint = v.id; app.saveUi(); render(); } },
      '-',
      { label: 'Monter', disabled: i <= 0, why: v.id === 'energie' ? 'l\'énergie reste en tête du groupe' : 'déjà juste sous l\'énergie', onclick: fait(`monter l'arc « ${v.nom} »`, () => { p.arcs.splice(i - 1, 0, ...p.arcs.splice(i, 1)); }) },
      { label: 'Descendre', disabled: i < 0 || i >= p.arcs.length - 1, why: v.id === 'energie' ? 'l\'énergie reste en tête du groupe' : 'déjà en bas', onclick: fait(`descendre l'arc « ${v.nom} »`, () => { p.arcs.splice(i + 1, 0, ...p.arcs.splice(i, 1)); }) },
      v.id === 'energie' ? { label: 'Automation du volume de la sortie', onclick: () => app.addAuto(app.master().id, 'vol') }
        : { label: 'Retirer l\'arc du groupe', danger: true, onclick: fait(`retirer l'arc « ${v.nom} »`, () => { p.arcs.splice(i, 1); if (G.peint === v.id) G.peint = 'energie'; }) });
    menu(e.clientX, e.clientY, items);
  }
  function addArcMenu(e) {
    const p = P(), G = AR(), r = e.currentTarget.getBoundingClientRect();
    const libres = Object.keys(ARCS).filter((k) => !(p.arcs || []).some((A) => A.k === k));
    menu(r.left, r.bottom + 4, [{ head: 'un arc de plus' },
      ...(libres.length ? libres.map((k) => ({ label: ARCS[k].nom, sub: ARCS[k].dit, dot: ARCS[k].couleur,
        onclick: () => { p.arcs = p.arcs || []; p.arcs.push(arcNeuf(k)); G.ouvert = true; G.peint = `a${k}`; app.saveUi(); app.label(`ajouter l'arc « ${ARCS[k].nom} »`); app.commit('meta'); } }))
        : [{ label: 'Tous les arcs sont là', disabled: true, why: 'un arc par sorte' }])]);
  }
  // un arc de départ tiré des étiquettes de section (choix de réglage) :
  // l'intro et le final bas, le couplet au milieu, le refrain en haut
  function arcFromSections(p) {
    const lvl = { intro: 0.35, verse: 0.6, 'pre-chorus': 0.75, chorus: 1, bridge: 0.5, instrumental: 0.7, outro: 0.4 };
    const out = [];
    for (const s of [...p.sections].sort((x, y) => x.a - y.a)) for (let b = s.a; b < s.b; b += 2) out.push([b, lvl[s.tag] ?? 0.6]);
    return out.length ? out : [[0, 1]];
  }

  // ── une piste ──
  const renameTrack = (t, node) => inlineEdit(node, t.name, (n) => { t.name = n.slice(0, 60); app.commit('data'); }, { max: 60 });
  function head(t) {
    const st = app.mod(t.strip), src = app.mod(t.src);
    const tog = (label, on, title, fn, cls = '') => el('button', { class: `tb sm ${cls}${on ? ' on' : ' ghost'}`, type: 'button', title, 'aria-pressed': on,
      onclick: (e) => { e.stopPropagation(); fn(); } }, label);
    // le volume : le fader de la console couché (ui.js), dans la teinte de la
    // piste — double-clic : 0 dB ; plus de curseur natif au rond (Cal, 06/10)
    const vol = fader(spec('strip', 'vol'), val(st, 'vol'), { couche: true, valeur: false, cls: 'ar-vol', accent: t.color, label: 'volume',
      onInput: (v) => { st.params.vol = Math.round(v * 10) / 10; app.commit('param', st); }, onChange: () => app.commit('quiet') });
    const mtr = el('div', { class: 'ar-mtr' }, el('i'));
    meters.push([t.strip, mtr]);
    // son nom entier au survol : en-tête bas, il est tronqué (musique.css, les paliers)
    const nm = el('span', { class: 'nm', title: `${t.name} · double-clic : renommer (Ctrl+R)`, ondblclick: (e) => { e.stopPropagation(); renameTrack(t, nm); } }, t.name);
    const picked = (S.sel.tracks || []).includes(t.id);
    const box = el('div', { class: `ar-head${S.sel.track === t.id ? ' sel' : ''}${picked ? ' pick' : ''}${t.mute ? ' muted' : ''}${isGenTrack(t) ? ' gen' : ''}${t.grp ? ' in-grp' : ''}`, style: { '--c': `var(--${t.color})`, height: `${thOf(t)}px` },
      'data-track': t.id, 'data-piste': t.id, title: 'clic : choisir (Ctrl : ajouter ou retirer, Maj : jusqu\'à elle) · Suppr : retirer · glisser : déplacer — lâchée ENTRE deux pistes elle s\'y range, SUR une piste elle fait groupe · Ctrl+molette : sa hauteur' },
    el('i', { class: 'bar', title: 'la couleur de la piste — celle de son nœud dans le nodal · clic : la palette', onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); colorMenu(e, t); } }),
    el('div', { class: 'txt' },
      nm,
      el('span', { class: 'kd', title: moduleName(src?.type) }, t.sub || `${TRACK_KINDS[t.kind].label} · ${moduleName(src?.type)}`),
      mtr,
      el('div', { class: 'row' },
        tog('M', t.mute, 'muet', () => { t.mute = !t.mute; app.commit('mute'); }),
        tog('S', t.solo, 'solo', () => { t.solo = !t.solo; app.commit('mute'); }),
        tog('●', t.arm, t.kind === 'audio' ? 'armer : la prise enregistre le micro sur cette piste' : 'armer : la prise enregistre le clavier et le MIDI sur cette piste',
          () => { t.arm = !t.arm; app.commit('quiet'); render(); }, 'arm'),
        tog('A', !!ui().auto?.[t.id], 'automation : les courbes de la piste', () => { ui().auto = { ...(ui().auto || {}), [t.id]: !ui().auto?.[t.id] }; app.saveUi(); render(); }),
        vol,
        knob(spec('strip', 'pan'), val(st, 'pan'), { size: 'xs', accent: t.color, label: 'panoramique',
          onInput: (v) => { st.params.pan = v; app.commit('param', st); }, onChange: () => app.commit('quiet') }))));
    box.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      // une plage qui passe par cette piste reste, et le menu agit sur ses
      // pistes (Live : les pistes d'une sélection de temps sont choisies)
      const R = app.timeRange(), inR = R && R.tracks.includes(t.id);
      if (!inR && !(S.sel.tracks || []).includes(t.id)) app.selectTrack(t.id);
      trackMenu(e, t, nm, inR ? R.tracks : null);
    });
    box.addEventListener('pointerdown', (e) => dragTrack(e, t, box));
    box.addEventListener('dragover', (e) => onDragOver(e, t));
    box.addEventListener('drop', (e) => onDrop(e, t, app.pos()));
    return box;
  }

  // la palette des jetons : la couleur de la piste (et de son nœud de départ dans le nodal)
  const colorItems = (t) => COLORS.map((c) => ({ label: COLOR_FR[c], dot: c, checked: t.color === c, onclick: () => app.setTrackColor(t.id, c) }));
  function colorMenu(e, t) {
    menu(e.clientX, e.clientY, [{ head: `couleur de « ${t.name} »` }, ...colorItems(t)]);
  }

  // plage : les pistes de la plage de temps sous le clic droit (elles font la sélection)
  function trackMenu(e, t, nm, plage = null) {
    const vis = visTracks(), i = vis.indexOf(t);
    const picked = plage ? vis.map((x) => x.id).filter((id) => plage.includes(id))
      : (S.sel.tracks || []).length > 1 && S.sel.tracks.includes(t.id) ? S.sel.tracks : [t.id];
    const g = t.grp && (P().groups || []).find((x) => x.id === t.grp);
    const autos = (AUTOMATABLE[app.mod(t.src)?.type] || []).map((k) => [t.src, k]).concat(
      app.chain(t.id).filter((m) => m.id !== t.src).flatMap((m) => (AUTOMATABLE[m.type] || []).map((k) => [m.id, k])));
    const shared = app.chain(t.id).filter((m) => app.linked(m.id).length > 1);
    menu(e.clientX, e.clientY, [
      { head: picked.length > 1 ? `${picked.length} pistes` : t.name },
      { label: 'Renommer', key: 'Ctrl+R', onclick: () => renameTrack(t, nm) },
      { label: 'Instruments et effets', sub: 'le panneau du bas', onclick: () => { app.selectTrack(t.id); app.showDetail('device'); } },
      { label: 'Voir son nœud dans le nodal', onclick: () => { app.selectTrack(t.id); app.setView('nodal'); app.nodal?.montrerPiste?.(t.id); } },
      { label: 'Couleur', dot: t.color, items: colorItems(t) },
      '-',
      { label: 'Monter', disabled: i <= 0, why: 'déjà en haut', onclick: () => app.moveTracks(picked, vis[i - 1].id, 'avant') },
      { label: 'Descendre', disabled: i >= vis.length - 1, why: 'déjà en bas', onclick: () => app.moveTracks(picked, vis[i + 1].id, 'apres') },
      picked.length > 1 ? { label: `Grouper les ${picked.length} pistes`, key: 'Ctrl+G', onclick: () => groupPicked(picked) }
        : { label: 'Grouper avec…', disabled: vis.length < 2, why: 'une seule piste', items: vis.filter((x) => x.id !== t.id).map((x) => ({ label: x.name, dot: x.color, onclick: () => app.groupTracks([t.id], x.id) })) },
      g ? { label: `Sortir du groupe « ${g.name} »`, onclick: () => { for (const id of picked) delete app.track(id)?.grp; rangerGroupes(P()); app.label(`sortir du groupe « ${g.name} »`); app.commit('data'); } } : null,
      g ? { label: `Défaire le groupe « ${g.name} »`, onclick: () => app.ungroup(g.id) } : null,
      '-', { head: 'instrument' },
      ...(SOURCES_OF[t.kind] || []).filter((x) => x !== 'player' && x !== 'bus').map((type) => ({ label: MODULES[type].name, sub: MODULES[type].kind, dot: MODULES[type].color,
        disabled: app.mod(t.src)?.type === type, why: 'c\'est déjà son instrument', onclick: () => app.setSource(t.id, type) })),
      ...(shared.length ? ['-', { head: 'effets partagés (nodal)' }, ...shared.map((m) => ({ label: `Sortir « ${moduleName(m.type)} » de cette chaîne`, sub: `aussi dans ${app.linked(m.id).filter((x) => x !== t.id).map((x) => app.track(x)?.name).join(', ')}`, onclick: () => app.removeFromTrack(m.id, t.id) }))] : []),
      '-', { head: 'automation' },
      ...autos.slice(0, 16).map(([mid, k]) => ({ label: `${moduleName(app.mod(mid).type)} · ${spec(app.mod(mid).type, k).label}`,
        disabled: P().auto.some((L) => L.mod === mid && L.k === k), why: 'cette voie existe déjà', onclick: () => app.addAuto(mid, k) })),
      '-',
      { label: picked.length > 1 ? `Retirer les ${picked.length} pistes` : 'Retirer la piste', key: 'Suppr', danger: true, onclick: () => app.removeTracks(picked, { ask: false }) },
    ]);
  }
  function groupPicked(picked = S.sel.tracks || []) {
    const ids = picked.filter((id) => app.track(id)?.kind !== 'bus');
    if (ids.length < 2) { toast('Ctrl+G : choisis au moins deux pistes (Ctrl+clic sur leurs en-têtes)'); return; }
    const order = visTracks().map((x) => x.id).filter((id) => ids.includes(id));
    app.groupTracks(order.slice(1), order[0]);
  }

  // ── glisser une piste : la déplacer, ou faire un groupe ──
  // Le magnétisme est franc : le tiers haut et le tiers bas d'un en-tête sont
  // « l'entre-pistes » (un trait d'insertion se pose sur la limite, la piste
  // ira là) ; le cœur de l'en-tête est la piste elle-même (elle s'entoure :
  // lâchée, la piste glissée fait groupe avec elle). Sur l'en-tête d'un
  // groupe : son tiers haut place avant le groupe, le reste y fait entrer.
  const EDGE = 0.3;
  function dropTarget(clientY, ids) {
    const rows = [...grid.querySelectorAll('.ar-head[data-track], .ar-ghead[data-grp]')];
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (clientY < b.top || clientY >= b.bottom) continue;
      const rel = (clientY - b.top) / b.height;
      if (r.dataset.grp) {
        const members = visTracks().filter((x) => x.grp === r.dataset.grp);
        if (!members.length || members.every((x) => ids.includes(x.id))) return null;
        if (rel < EDGE) return { mode: 'move', cible: members[0].id, cote: 'avant', y: b.top, row: r };
        return { mode: 'group', cible: members.find((x) => !ids.includes(x.id)).id, row: r, grp: r.dataset.grp };
      }
      const id = r.dataset.track;
      if (ids.includes(id)) return { mode: 'none', row: r };
      if (rel < EDGE) return { mode: 'move', cible: id, cote: 'avant', y: b.top, row: r };
      if (rel > 1 - EDGE) return { mode: 'move', cible: id, cote: 'apres', y: b.bottom, row: r };
      return { mode: 'group', cible: id, row: r };
    }
    // sous la dernière piste : à la fin
    const last = rows.at(-1), vis = visTracks();
    if (last && clientY >= last.getBoundingClientRect().bottom && vis.length) {
      const tl = vis.filter((x) => !ids.includes(x.id)).at(-1);
      if (tl) { const hl = grid.querySelector(`.ar-head[data-track="${tl.id}"]`) || last; return { mode: 'move', cible: tl.id, cote: 'apres', y: hl.getBoundingClientRect().bottom, row: hl }; }
    }
    return null;
  }
  function dragTrack(e, t, box, idsOverride = null) {
    if (e.button !== 0 || e.target.closest('button, input, select, .kn, .fdr, .bar, .editing, .mu-inline')) return;
    const mode = e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : 'replace';
    const x0 = e.clientX, y0 = e.clientY;
    let started = false, target = null, ghost = null;
    const ids = idsOverride || ((S.sel.tracks || []).includes(t.id) && mode === 'replace' ? visTracks().map((x) => x.id).filter((id) => S.sel.tracks.includes(id)) : [t.id]);
    const paintTarget = () => {
      grid.querySelectorAll('.ar-head.cible, .ar-ghead.cible, .ar-lane.cible, .ar-glane.cible').forEach((n) => n.classList.remove('cible'));
      trackLine.style.display = 'none';
      if (!target || target.mode === 'none') return;
      if (target.mode === 'move') {
        const g = grid.getBoundingClientRect();
        Object.assign(trackLine.style, { display: 'block', top: `${target.y - g.top - 1}px` });
      } else {
        target.row.classList.add('cible');
        target.row.nextElementSibling?.classList.add('cible');
      }
    };
    const mv = (ev) => {
      if (!started) {
        if (Math.abs(ev.clientY - y0) < 5 && Math.abs(ev.clientX - x0) < 5) return;
        started = true;
        box.classList.add('dragging');
        ghost = el('div', { class: 'ar-ghost', style: { '--c': `var(--${t.color})` } }, ids.length > 1 ? `${ids.length} pistes` : t.name);
        document.body.append(ghost);
      }
      Object.assign(ghost.style, { left: `${ev.clientX + 12}px`, top: `${ev.clientY - 10}px` });
      target = dropTarget(ev.clientY, ids);
      ghost.dataset.mode = target?.mode || '';
      ghost.dataset.what = target?.mode === 'group' ? 'grouper' : target?.mode === 'move' ? 'déplacer' : '';
      paintTarget();
      // près des bords : le défilement suit
      const s = scroll.getBoundingClientRect();
      if (ev.clientY < s.top + 40) scroll.scrollTop -= 12; else if (ev.clientY > s.bottom - 40) scroll.scrollTop += 12;
    };
    const up = (ev) => {
      removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true);
      box.classList.remove('dragging');
      ghost?.remove();
      const tg = started ? dropTarget(ev.clientY, ids) : null;
      target = null; paintTarget();
      if (!started) { app.selectTrack(t.id, mode); return; }
      if (!tg || tg.mode === 'none') return;
      if (tg.mode === 'move') app.moveTracks(ids, tg.cible, tg.cote);
      else app.groupTracks(ids, tg.cible);
    };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  }

  // ── un groupe de pistes : son en-tête (replier, renommer, défaire) ──
  function groupHead(g, members) {
    const nm = el('span', { class: 'nm', title: 'double-clic : renommer le groupe' }, g.name);
    nm.addEventListener('dblclick', (e) => { e.stopPropagation(); inlineEdit(nm, g.name, (n) => { g.name = n.slice(0, 40); app.label(`renommer le groupe en « ${g.name} »`); app.commit('data'); }, { max: 40 }); });
    const c = members[0]?.color || 'cy';
    const fold = el('button', { class: 'tb ghost sm ar-fold', type: 'button', title: g.fold ? 'déplier le groupe' : 'replier le groupe', 'aria-expanded': String(!g.fold),
      onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); g.fold = !g.fold; app.label(g.fold ? `replier « ${g.name} »` : `déplier « ${g.name} »`); app.commit('data'); } }, g.fold ? '▸' : '▾');
    const box = el('div', { class: `ar-ghead${g.fold ? ' fold' : ''}`, 'data-grp': g.id, style: { '--c': `var(--${c})` },
      title: 'un groupe de pistes — glisser : le déplacer entier · lâcher une piste dessus : elle y entre · clic droit : replier, renommer, défaire' },
    el('i', { class: 'bar' }), fold, nm, el('span', { class: 'lbl' }, `${members.length} piste${members.length > 1 ? 's' : ''}`));
    box.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, .editing')) return;
      const first = members[0];
      if (first) dragTrack(e, first, box, members.map((x) => x.id));
    });
    box.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); groupMenu(e, g, members, nm); });
    return box;
  }
  // les clips des membres, en traits (le zoom les replace : minis)
  const minis = [];
  const placerMini = (i, c) => { i.style.left = `${X(c.start)}px`; i.style.width = `${Math.max(2, X(c.len) - 1)}px`; };
  function groupLane(g, members) {
    const p = P();
    const ln = el('div', { class: `ar-glane${g.fold ? ' fold' : ''}`, 'data-grp': g.id });
    const n = Math.max(1, members.length), hh = Math.max(2, Math.floor(22 / n));
    members.forEach((t, r) => {
      for (const c of p.clips.filter((x) => x.track === t.id)) {
        const i = el('i', { style: { top: `${2 + r * hh}px`, height: `${Math.max(1, hh - 1)}px`, background: `var(--${t.color})` } });
        placerMini(i, c);
        minis.push([i, c]);
        ln.append(i);
      }
    });
    ln.addEventListener('dblclick', () => { g.fold = !g.fold; app.commit('data'); });
    return ln;
  }
  function groupMenu(e, g, members, nm) {
    menu(e.clientX, e.clientY, [
      { head: `groupe · ${g.name}` },
      { label: g.fold ? 'Déplier' : 'Replier', onclick: () => { g.fold = !g.fold; app.label(g.fold ? `replier « ${g.name} »` : `déplier « ${g.name} »`); app.commit('data'); } },
      { label: 'Renommer', onclick: () => nm && inlineEdit(nm, g.name, (n) => { g.name = n.slice(0, 40); app.commit('data'); }, { max: 40 }) },
      { label: 'Choisir ses pistes', onclick: () => { S.sel.tracks = members.map((x) => x.id); S.sel.track = members[0]?.id || S.sel.track; paintSel(); } },
      { label: 'Couleur de ses pistes', items: COLORS.map((c) => ({ label: COLOR_FR[c], dot: c, onclick: () => { for (const t of members) t.color = c; app.label(`colorer le groupe « ${g.name} »`); app.commit('data'); } })) },
      '-',
      { label: 'Défaire le groupe', sub: 'les pistes restent', onclick: () => app.ungroup(g.id) },
      { label: `Retirer ses ${members.length} pistes`, danger: true, onclick: () => app.removeTracks(members.map((x) => x.id), { ask: true }) },
    ]);
  }

  function lane(t) {
    const p = P();
    const ln = el('div', { class: `ar-lane${S.sel.track === t.id ? ' sel' : ''}`, 'data-track': t.id,
      style: { height: `${thOf(t)}px`, '--c': `var(--${t.color})` } });   // sa largeur : la colonne ; sa grille : .ar-lignes
    for (const c of p.clips.filter((x) => x.track === t.id)) ln.append(clipEl(c, t));
    const T = app.timeSel();
    if (T?.tracks.includes(t.id)) ln.append(tselEl(T));
    if (isGenTrack(t)) ln.classList.add('gen');
    ln.addEventListener('dblclick', (e) => {
      if (e.target !== ln) return;
      const b = Math.max(0, Math.floor(beatAt(e.clientX) / p.sig) * p.sig);
      if (isGenTrack(t)) newRegion(app, t, b, b + 4 * p.sig);          // une région de quatre mesures
      else if (t.kind === 'audio') app.addAudio(t.id, b);
      else { const c = app.newClip(t.id, b); if (c) app.showDetail('clip'); }
    });
    // le vide d'une piste est du temps, comme le corps d'un clip (Live) : un
    // clic, le marqueur d'insertion ; glisser, une plage ; Maj : l'étendre ;
    // Ctrl : le cadre qui choisit des clips ; sur une piste générative, tirer
    // dessine une région
    ln.addEventListener('pointerdown', (e) => {
      if (e.target !== ln || e.button !== 0) return;
      if (e.ctrlKey || e.metaKey) startMarquee(e, t);
      else if (isGenTrack(t) && !e.shiftKey) startRegion(e, t, ln);
      else startTime(e, t);
    });
    ln.addEventListener('dragover', (e) => onDragOver(e, t));
    ln.addEventListener('dragleave', () => { dropLine.style.display = 'none'; });
    ln.addEventListener('drop', (e) => onDrop(e, t));
    return ln;
  }

  // ── les voies d'automation d'une piste (ou de la sortie) ──
  function autoRows(L) {
    const m = app.mod(L.mod);
    if (!m) return [];
    const s = spec(m.type, L.k), t = m.track && app.track(m.track);
    const color = t?.color || 'cy';
    const cv = el('canvas', { class: 'ar-curve' });
    const ln = el('div', { class: `ar-alane${L.on === false ? ' off' : ''}`, style: { '--c': `var(--${color})` } }, cv);
    paintable(cv, () => L.pts, { res: 0.25, h: AUTO_H, color, columns: false, onDone: () => app.commit('data') });
    const now = L.pts.length ? fmt(s, fromNormSafe(s, interp(L.pts, app.pos()))) : fmt(s, val(m, L.k));
    const hd = el('div', { class: `ar-ahead${L.on === false ? ' off' : ''}`, style: { '--c': `var(--${color})` } },
      el('div', { class: 'txt' }, el('b', {}, `${moduleName(m.type)} · ${s.label}`), el('span', {}, `${t ? t.name : 'sortie'} · ${now} ${s.unit || ''}`)),
      el('div', { class: 'row' },
        el('button', { class: `tb sm${L.on !== false ? ' on' : ' ghost'}`, type: 'button', title: 'la courbe tient le réglage pendant la lecture',
          onclick: () => { L.on = L.on === false; app.commit('meta'); } }, L.on !== false ? 'Lue' : 'Ignorée'),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'effacer la courbe', onclick: () => { L.pts = []; app.commit('meta'); } }, 'Effacer'),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'retirer la voie', onclick: () => { P().auto = P().auto.filter((x) => x !== L); app.commit('meta'); } }, '×')));
    hd.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      menu(e.clientX, e.clientY, [{ head: `automation · ${moduleName(m.type)} · ${s.label}` },
        { label: 'Lue pendant la lecture', checked: L.on !== false, onclick: () => { L.on = L.on === false; app.commit('meta'); } },
        { label: 'Effacer la courbe', disabled: !L.pts.length, why: 'la courbe est vide', onclick: () => { L.pts = []; app.commit('meta'); } },
        { label: 'Retirer la voie', danger: true, onclick: () => { P().auto = P().auto.filter((x) => x !== L); app.commit('meta'); } }]);
    });
    return [hd, ln];
  }
  const fromNormSafe = (s, v) => (v === null ? s.def : fromNorm(s, v));

  // ── un clip ──
  function clipLabel(c, t, pat) {
    if (c.name) return c.name;
    if (isRegion(c)) {
      const s = schemaNow(), g = c.gen;
      const M = s?.modeles?.[g.model], T = M?.taches?.[g.task];
      return ['région', M?.court || g.model, T?.nom || g.task, g.v?.track_name ? s.pistes.fr[g.v.track_name] : ''].filter(Boolean).join(' · ');
    }
    const sec = sectionAt(P(), c.start);
    const nm = t.kind === 'audio' ? '' : pat?.name || '';
    return sec ? `${sec.name}${nm ? ` · ${nm}` : ''}` : nm;
  }
  const renameClip = (c, node, current) => inlineEdit(node, current, (n) => { c.name = n.slice(0, 60); app.commit('data'); }, { max: 60 });

  function clipEl(c, t) {
    const pat = c.pat && app.pat(c.pat);
    const cv = el('canvas', { class: 'cv' });
    const ttl = el('span', { class: 't' }, clipLabel(c, t, pat));
    const reg = isRegion(c), takes = reg ? c.gen.takes.length : 0;
    const ch = el('div', { class: 'ch', title: 'double-clic : renommer le clip' }, el('i', { class: 'sq' }), ttl,
      c.loop ? el('span', { class: 'lp', title: 'en boucle' }, '∞') : null, c.rev ? el('span', { class: 'lp', title: 'à l\'envers' }, '⇆') : null,
      c.pitch ? el('span', { class: 'lp', title: 'transposé' }, `${c.pitch > 0 ? '+' : ''}${(+c.pitch).toFixed(1)}`) : null,
      reg && takes ? el('span', { class: 'lp gr-tk', title: 'la prise qui joue · clic droit : les autres' }, `${(c.gen.take ?? -1) + 1}/${takes}`) : null);
    const on = sel().has(c.id);
    const box = el('div', { class: `clip${on ? ' sel' : ''}${c.mute || t.mute ? ' muted' : ''}${c.loop ? ' looped' : ''}${reg ? ` gen-region${c.item ? ' has' : ''}` : ''}`, 'data-id': c.id,
      style: { left: `${X(c.start)}px`, width: `${Math.max(4, X(c.len))}px` } },
    ch, cv, el('i', { class: 'rs l', title: 'rogner le début (la fin reste, le contenu reste calé)' }), el('i', { class: 'rs r', title: t.kind === 'audio' ? 'rogner la fin' : 'rogner ou rallonger la fin : le motif se répète' }));
    if (t.kind === 'audio' && !c.name && c.item) app.loadItem(c.item).then((it) => { ttl.textContent = `${clipLabel(c, t, null)}${clipLabel(c, t, null) ? ' · ' : ''}${it.title}`; box.title = it.title; }).catch(() => { ttl.textContent = 'son introuvable'; });
    requestAnimationFrame(() => drawClip(cv, c, t, pat));
    poserCalcul(box, etatCalcul({ clip: c.id }), c.id);   // un travail de la file s'en occupe : la couche « en calcul »
    box.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      // la capture du pointeur (dragClips) fait du clip la cible du double-clic :
      // c'est la hauteur du geste qui dit s'il tombe sur le titre
      if (e.clientY <= ch.getBoundingClientRect().bottom) { renameClip(c, ttl, c.name || ttl.textContent); return; }
      app.selectClips([c.id], true);
      if (isRegion(c)) { ouvrirGenerer(app, { region: c.id }); return; }   // une région : le panneau Générer
      app.showDetail('clip');
    });
    box.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // sur la plage choisie de cette piste (corps ou barre de titre : une
      // piste basse n'a presque que sa barre) : le menu de la plage, et elle
      // reste ; ailleurs, le clip (choisi s'il ne l'était pas)
      const at = Math.max(0, snapB(beatAt(e.clientX), e));
      const R = plageSous(t, e);
      if (!R && !sel().has(c.id)) { app.selectClips([c.id], true); paintSel(); }
      clipMenu(e, c, t, ttl, R, at);
    });
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || ttl.classList.contains('editing')) return;
      e.stopPropagation();
      const edge = e.target.classList.contains('rs') ? (e.target.classList.contains('l') ? 'l' : 'r') : null;
      // Live 12 : la barre de titre est l'objet (choisir, glisser ; Ctrl :
      // copier) ; le corps est le temps (startTime : un clic, le marqueur
      // d'insertion et la tête de lecture ; glisser, une plage ; Maj :
      // l'étendre). Ctrl+clic dans le corps : ajouter ou retirer le clip.
      if (!edge && !e.target.closest?.('.ch') && !e.ctrlKey && !e.metaKey) { startTime(e, t, c); return; }
      if ((e.shiftKey || e.ctrlKey || e.metaKey) && !edge && !(e.ctrlKey && sel().has(c.id))) {   // ajouter / retirer de la sélection (Live : Ctrl+clic)
        const s = sel();
        if (s.has(c.id)) s.delete(c.id); else s.add(c.id);
        app.selectClips([...s], true);
        paintSel();
        return;
      }
      // le panneau génératif ouvert en bas : il reste là tant que le geste n'est
      // pas fini (un clip glissé jusque dans une de ses cases) ; un simple clic
      // l'ouvre ensuite sur le clip, comme d'habitude (dragClips, up)
      const keepDock = document.body.classList.contains('mu-gen-dock');
      if (!sel().has(c.id)) { app.selectClips([c.id], true); paintSel(keepDock); }
      else { S.sel.clip = c.id; S.sel.track = t.id; if (S.sel.time) { S.sel.time = null; paintTime(); } }
      dragClips(e, c, t, box, edge);
    });
    return box;
  }

  // R : la plage choisie sous le clic droit (son menu, timeItems) ; at : le temps du clic (« Couper ici »)
  function clipMenu(e, c, t, ttl, R = null, at = null) {
    if (R) {
      menu(e.clientX, e.clientY, [...timeItems(R), '-', { head: clipLabel(c, t, app.pat(c.pat)) || 'clip' },
        { label: 'Ouvrir dans la vue Clip', onclick: () => { S.sel.clip = c.id; S.sel.track = t.id; app.showDetail('clip'); } },
        { label: 'Choisir ce clip', sub: 'clic sur sa barre de titre', onclick: () => { app.selectClips([c.id], true); paintSel(); } },
        { label: 'Renommer', sub: 'double-clic sur son titre', onclick: () => renameClip(c, ttl, c.name || ttl.textContent) }]);
      return;
    }
    const n = (S.sel.clips || []).length;
    const cut = at !== null && at >= c.start + 0.0625 && at <= c.start + c.len - 0.0625;   // la borne de splitClip (projet.js)
    // le génératif : les prises d'une région ; un clip audio comme son de la
    // région montrée en bas ; un clip de notes dans sa partition (YuE2)
    const reg = isRegion(c), tgt = genTarget(app), sch = schemaNow();
    const slots = c.item && tgt && tgt.id !== c.id ? soundSlotsOf(app) : [];
    const PT = sch?.modeles?.yue?.partition;
    const yue = tgt && tgt.id !== c.id && tgt.gen.model === 'yue' && (tgt.gen.v?.mode ?? 'full') !== 'off' && PT && t.kind !== 'drums';
    const noSound = 'une région sans prise n\'a pas encore de son';
    menu(e.clientX, e.clientY, [
      ...(reg ? regionMenuItems(app, c) : []),
      { head: n > 1 ? `${n} clips` : clipLabel(c, t, app.pat(c.pat)) || 'clip' },
      { label: 'Ouvrir dans la vue Clip', onclick: () => app.showDetail('clip') },
      { label: 'Renommer', sub: 'Ctrl+R', onclick: () => renameClip(c, ttl, c.name || ttl.textContent) },
      { label: 'Couper ici', sub: cut ? `à ${app.bar(at)}` : '', disabled: !cut, why: 'clic droit dans le corps du clip, là où le couper', onclick: () => app.splitAt(c.id, at) },
      { label: app.timeSel() ? 'Couper au marqueur d\'insertion' : 'Couper à la tête de lecture', sub: 'Ctrl+E', onclick: () => app.splitAtPlayhead() },
      { label: 'Dupliquer', sub: 'Ctrl+D', onclick: () => app.duplicateSel() },
      { label: 'Consolider', sub: 'Ctrl+J', onclick: () => app.consolidateSel() },
      ...versSessionItems({ clips: n > 1 && (S.sel.clips || []).includes(c.id) ? S.sel.clips : [c.id] }, t),
      { label: 'Boucler la sélection', sub: 'Ctrl+L', onclick: () => app.loopSelection() },
      { label: 'Copier', sub: 'Ctrl+C', onclick: () => app.copySel() },
      { label: 'Couper (presse-papiers)', sub: 'Ctrl+X', onclick: () => app.cutSel() },
      { label: 'Coller à la tête de lecture', sub: 'Ctrl+V', disabled: !app.board, onclick: () => app.paste() },
      { label: c.mute ? 'Activer' : 'Désactiver', sub: '0', onclick: () => app.muteSel() },
      ...(t.kind === 'audio' ? [
        { label: c.rev ? 'À l\'endroit' : 'Inverser', sub: 'R', disabled: !c.item, why: noSound, onclick: () => app.reverseSel() },
        { label: c.loop ? 'Ne plus boucler le son' : 'Boucler le son', disabled: !c.item, why: noSound, onclick: () => app.toggleLoop(c.id) },
        { label: 'Séparer en stems', sub: 'voix · batterie · basse · autre', disabled: !c.item, why: noSound, onclick: () => app.stems(c.id) },
        { label: 'Extraire le MIDI', sub: 'notes · partition · batterie', disabled: !c.item, why: noSound, onclick: () => openExtract(app, c.id) },
        { label: 'Détecter le tempo', sub: 'bpm · temps fort · caler', disabled: !c.item, why: noSound, onclick: () => openTempo(app, c.id) },
        { label: 'Générer une variation…', sub: 'le panneau Générer, sur ce clip', disabled: !c.item, why: noSound, onclick: () => ouvrirGenerer(app, { quoi: 'variation', clip: c.id }) },
        ...(slots.length ? ['-', { head: `pour ${tgt.name || (tgt.id ? 'la région' : 'la génération')} (Générer)` }] : []),
        ...slots.map((sl) => ({ label: `Comme ${sl.label}`, sub: 'la case du panneau Générer', onclick: () => useSound(app, sl.region, sl.pid, c.item) })),
      ] : [
        { label: 'Motif à part (copie)', onclick: () => app.uniqueClip(c.id) },
        { label: 'Ranger dans la bibliothèque MIDI', sub: 'navigateur, MIDI', onclick: () => saveClipMidi(app, c) },
        ...(yue ? ['-', { head: `dans la partition de ${tgt.name || 'la région YuE2'}` },
          ...Object.entries(PT.cases).map(([k, cs]) => ({ label: `Comme ${cs.label}`, sub: `voix ${cs.voix}`, onclick: () => injectFrom(app, tgt, sch, k, { clip: c.id }) }))] : []),
      ]),
      '-', { label: 'Retirer', sub: 'Suppr', onclick: () => app.removeSel() },
    ]);
  }

  // la sélection repeinte sans refaire la grille : un double-clic qui suit
  // (renommer) tombe encore sur le même élément
  function paintSel(keepDock = false) {
    const s = sel();
    for (const b of grid.querySelectorAll('.clip')) b.classList.toggle('sel', s.has(b.dataset.id));
    for (const b of grid.querySelectorAll('.ar-head, .ar-lane')) b.classList.toggle('sel', b.dataset.track === S.sel.track);
    const picked = new Set(S.sel.tracks || []);
    for (const b of grid.querySelectorAll('.ar-head')) b.classList.toggle('pick', picked.has(b.dataset.track));
    paintTime();
    paintTools();
    if (ui().dock !== false && !keepDock) dock.render();
  }

  // Glisser des clips : le corps les déplace (Ctrl : les copie, Alt : sans
  // aimant), changer de piste (même sorte) ; la poignée de GAUCHE rogne le
  // début (la fin reste à sa place et le contenu reste calé dans le temps :
  // le dessin est retenu pendant le geste), celle de droite la fin. Tout le
  // groupe choisi suit.
  function dragClips(e, c, t, box, edge) {
    const p = P();
    const ids = sel();
    const group = p.clips.filter((x) => ids.has(x.id));
    const orig = new Map(group.map((x) => [x.id, JSON.parse(JSON.stringify(x))]));
    // repartir de l'état d'avant le geste, clés absentes comprises (un
    // « off » posé au pas précédent ne doit pas s'ajouter au suivant)
    const restore = (x) => { const o = orig.get(x.id); for (const k of Object.keys(x)) if (!(k in o)) delete x[k]; Object.assign(x, JSON.parse(JSON.stringify(o))); };
    const rows = visTracks();
    const rowOf = (tid) => rows.findIndex((r) => r.id === tid);
    const x0 = e.clientX;
    let moved = false, dRow = 0;
    box.setPointerCapture(e.pointerId);
    const boxes = new Map([...grid.querySelectorAll('.clip')].filter((b) => ids.has(b.dataset.id)).map((b) => [b.dataset.id, b]));
    const place = (x) => {
      const b = boxes.get(x.id);
      if (!b) return;
      b.style.left = `${X(x.start)}px`; b.style.width = `${Math.max(4, X(x.len))}px`;
      // rogner : le dessin est refait depuis le nouveau départ dans le
      // contenu (off), le son et les notes restent donc à leur place
      if (edge) { const cvx = b.querySelector('.cv'); if (cvx) drawClip(cvx, x, app.track(x.track), x.pat && app.pat(x.pat)); }
    };
    const mv = (ev) => {
      if (Math.abs(ev.clientX - x0) > 2) moved = true;
      if (!moved) return;
      const dx = (ev.clientX - x0) / ppb();
      const o = orig.get(c.id);
      if (edge === 'r') {
        const newEnd = snapB(o.start + o.len + dx, ev);
        const d = newEnd - (o.start + o.len);
        for (const x of group) {
          const ox = orig.get(x.id);
          let len = Math.max(ev.altKey ? 0.0625 : Math.max(0.0625, snapU() || 0.0625), ox.len + d);
          const tr = app.track(x.track);
          if (tr?.kind === 'audio' && !x.loop) {
            const buf = app.engine.buffers.get(x.item);
            if (buf) len = Math.min(len, (buf.duration - (x.off || 0)) / audioGeom(x, buf.duration).rate * p.bpm / 60);
          }
          x.len = len; place(x);
        }
      } else if (edge === 'l') {
        const d = snapB(o.start + dx, ev) - o.start;
        for (const x of group) { restore(x); trimStart(p, x, d); place(x); }
      } else {
        const minStart = Math.min(...group.map((x) => orig.get(x.id).start));
        let d = snapB(o.start + dx, ev) - o.start;
        d = Math.max(d, -minStart);
        for (const x of group) { x.start = orig.get(x.id).start + d; place(x); }
        // changer de piste : la rangée sous la souris
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.ar-lane');
        const r = over ? rowOf(over.dataset.track) : -1;
        const nd = r >= 0 ? r - rowOf(o.track) : dRow;
        if (nd !== dRow) {
          const ok = group.every((x) => { const tr = rows[rowOf(orig.get(x.id).track) + nd]; const t0 = app.track(orig.get(x.id).track); return tr && sameKind(t0, tr); });
          if (ok) {
            dRow = nd;
            for (const x of group) {
              const tr = rows[rowOf(orig.get(x.id).track) + nd];
              const ln = grid.querySelector(`.ar-lane[data-track="${tr.id}"]`);
              const b = boxes.get(x.id);
              if (ln && b) ln.append(b);
            }
          }
        }
      }
    };
    const up = (ev) => {
      box.removeEventListener('pointermove', mv); box.removeEventListener('pointerup', up);
      if (!moved) { paintTools(); dock.render(); return; }
      // lâché sur l'onglet « Session » : envoyé à la Session (biblio.js), il ne bouge pas
      if (!edge && document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.mu-views [data-view="console"]')) {
        for (const x of group) restore(x);
        app.versSession({ clips: group.map((x) => x.id) });
        app.setView('console');
        return;
      }
      // lâché sur une case du panneau génératif (le son d'une région, une case
      // de sa partition) : le clip y entre, il ne bouge pas
      const slot = !edge && document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-gen-slot], [data-gen-case]');
      if (slot) {
        for (const x of group) restore(x);
        app.commit('data');
        deposerClip(app, slot, c);
        return;
      }
      if (!edge && dRow) {
        for (const x of group) {
          const tr = rows[rowOf(orig.get(x.id).track) + dRow];
          if (tr.id === x.track) continue;
          if (x.pat) {                                      // le motif suit dans la piste d'arrivée
            const src = app.pat(x.pat);
            const cp = { ...JSON.parse(JSON.stringify(src)), id: app.uid('p'), track: tr.id };
            p.patterns.push(cp); x.pat = cp.id;
          }
          x.track = tr.id;
        }
      }
      if (!edge && ev.ctrlKey) {                           // Ctrl : les originaux restent, ce qui bouge est la copie
        for (const x of group) p.clips.push({ ...JSON.parse(JSON.stringify(orig.get(x.id))), id: app.uid('c') });
        toast(`${group.length} clip${group.length > 1 ? 's' : ''} copié${group.length > 1 ? 's' : ''}`);
      }
      app.commit('data');
    };
    box.addEventListener('pointermove', mv); box.addEventListener('pointerup', up);
  }
  const sameKind = (a, b) => a && b && (a.kind === b.kind || (a.kind !== 'audio' && b.kind !== 'audio' && TRACK_KINDS[a.kind].pattern === TRACK_KINDS[b.kind].pattern));

  // Dessiner une région générative : tirer sur le vide d'une piste générative,
  // aimanté à la grille (au moins une double-croche ; Alt : la double-croche) ;
  // un simple clic fait comme ailleurs (la tête de lecture, la piste)
  function startRegion(e, t, ln) {
    e.preventDefault();
    const x0 = e.clientX, b0 = Math.max(0, beatAt(x0));
    const draft = el('div', { class: 'gr-draft' }, el('span'));
    let moved = false, a = b0, b = b0;
    const mv = (ev) => {
      if (Math.abs(ev.clientX - x0) > 4) moved = true;
      if (!moved) return;
      if (!draft.isConnected) ln.append(draft);
      const q = ev.altKey ? 0.25 : Math.max(0.25, snapU() || 0.25), b1 = Math.max(0, beatAt(ev.clientX));
      a = Math.floor(Math.min(b0, b1) / q) * q; b = Math.ceil(Math.max(b0, b1) / q) * q;
      if (b - a < q) b = a + q;
      Object.assign(draft.style, { left: `${X(a)}px`, width: `${X(b - a)}px` });
      draft.firstChild.textContent = `région · ${app.bar(a)} → ${app.bar(b)} · ${((b - a) / P().sig).toFixed(2).replace(/\.?0+$/, '')} mes.`;
    };
    const up = (ev) => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      draft.remove();
      if (!moved) { timePoint(t, Math.max(0, snapB(beatAt(ev.clientX), ev))); return; }
      newRegion(app, t, a, b);
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }

  // Ctrl + tirer un cadre sur les voies vides : les clips qu'il touche ; un
  // simple clic pose le marqueur d'insertion, comme sans Ctrl
  function startMarquee(e, t) {
    const g = grid.getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const base = e.shiftKey || e.ctrlKey ? sel() : new Set();
    const mv = (ev) => {
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 4) moved = true;
      if (!moved) return;
      const l = Math.min(x0, ev.clientX), r = Math.max(x0, ev.clientX), tp = Math.min(y0, ev.clientY), bt = Math.max(y0, ev.clientY);
      Object.assign(marquee.style, { display: 'block', left: `${l - g.left}px`, top: `${tp - g.top}px`, width: `${r - l}px`, height: `${bt - tp}px` });
      const s = new Set(base);
      for (const b of grid.querySelectorAll('.clip')) {
        const rb = b.getBoundingClientRect();
        if (rb.right > l && rb.left < r && rb.bottom > tp && rb.top < bt) s.add(b.dataset.id);
      }
      for (const b of grid.querySelectorAll('.clip')) b.classList.toggle('sel', s.has(b.dataset.id));
      S.sel.clips = [...s];
    };
    const up = (ev) => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      marquee.style.display = 'none';
      if (!moved) { timePoint(t, Math.max(0, snapB(beatAt(ev.clientX), ev))); return; }
      app.selectClips(S.sel.clips, true);
      paintSel();
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }

  // ── le temps : le marqueur d'insertion, la sélection de temps ──
  // Live 12, chapitre « Arrangement View » : « Clicking into the Arrangement
  // background selects a point in time, represented by a flashing insert
  // marker. Clicking and dragging selects a timespan. » ; la barre de titre
  // d'un clip le choisit, son corps choisit du temps ; Maj+clic étend la
  // sélection. Ici : le temps est aimanté à la grille (Alt : libre) ; à
  // l'arrêt la tête de lecture va au marqueur, en lecture la lecture continue
  // et l'arrêt y revient (moteur.js, cue) ; le clip cliqué s'ouvre en bas sans
  // être « choisi ». L'état : S.sel.time (musique.js, timeSel).
  function timePoint(t, b, c = null) {
    Object.assign(S.sel, { time: { a: b, b, tracks: [t.id], from: { b, track: t.id } }, clips: [], tracks: [],
      clip: c ? c.id : null, track: t.id, pat: c?.pat || t.pat || null });
    app.engine.cue(b);
    paintSel();
  }
  function startTime(e, t, c = null) {
    e.preventDefault();
    const T0 = e.shiftKey ? app.timeSel() : null;
    const b0 = Math.max(0, snapB(beatAt(e.clientX), e));
    const from = T0?.from && app.track(T0.from.track) ? T0.from : T0 ? { b: T0.a, track: T0.tracks[0] } : { b: b0, track: t.id };
    const x0 = e.clientX, y0 = e.clientY;
    let moved = !!T0, tid = t.id;
    // la plage du point de départ jusqu'à b, sur les pistes de l'une à l'autre (dans l'ordre des voies)
    const span = (b, to) => {
      const ids = [...grid.querySelectorAll('.ar-lane[data-track]')].map((n) => n.dataset.track);
      const i = ids.indexOf(from.track), j = ids.indexOf(to);
      return { a: Math.min(from.b, b), b: Math.max(from.b, b), tracks: i < 0 || j < 0 ? [to] : ids.slice(Math.min(i, j), Math.max(i, j) + 1), from };
    };
    const show = (T) => { S.sel.time = T; S.sel.clips = []; S.sel.tracks = []; paintTime(); grid.querySelectorAll('.clip.sel').forEach((n) => n.classList.remove('sel')); };
    if (T0) show(span(b0, t.id));
    const mv = (ev) => {
      if (!moved && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 5) return;
      moved = true;
      edgeScroll(ev);
      const ln = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.ar-lane[data-track]');
      if (ln) tid = ln.dataset.track;
      show(span(Math.max(0, snapB(beatAt(ev.clientX), ev)), tid));
    };
    const up = () => {
      removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true);
      if (!moved) { timePoint(t, b0, c); return; }
      // une plage, ou le marqueur sur plusieurs pistes (glissé à la verticale)
      Object.assign(S.sel, { clip: c ? c.id : null, track: t.id, pat: c?.pat || t.pat || null });
      app.engine.cue(S.sel.time.a);
      paintSel();
    };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
  }
  // la sélection dans une voie : la plage en voile, le marqueur en trait qui clignote
  const tselEl = (T) => {
    const pt = T.b - T.a < 1e-6;
    return el('div', { class: `ar-tsel${pt ? ' pt' : ''}`, 'aria-hidden': 'true',
      style: pt ? { left: `${X(app.engine.insert)}px` } : { left: `${X(T.a)}px`, width: `${X(T.b - T.a)}px` } });
  };
  function paintTime() {
    grid.querySelectorAll('.ar-tsel').forEach((n) => n.remove());
    const T = app.timeSel();
    if (!T) return;
    for (const id of T.tracks) grid.querySelector(`.ar-lane[data-track="${id}"]`)?.append(tselEl(T));
    insX = X(app.engine.insert);
  }
  // à chaque image : le marqueur suit le moteur (la règle, Origine, l'arrêt le déplacent)
  let insX = null;
  function frameTime() {
    const x = X(app.engine.insert);
    if (x === insX) return;
    insX = x;
    for (const n of grid.querySelectorAll('.ar-tsel.pt')) n.style.left = `${x}px`;
  }
  // près des bords de la vue, elle défile pendant un geste
  function edgeScroll(ev) {
    const r = scroll.getBoundingClientRect();
    if (ev.clientX > r.right - 24) scroll.scrollLeft += 14; else if (ev.clientX < r.left + HEAD_W + 16) scroll.scrollLeft -= 14;
    if (ev.clientY > r.bottom - 20) scroll.scrollTop += 10;
  }
  // Le clic droit tombe-t-il dans la plage choisie ? (Live 12 : clic droit
  // dans une sélection, le menu de la sélection, qui reste.) Sa piste et son
  // temps, tels que la voile les montre (sans aimant). Rend la plage, ou null.
  function plageSous(t, e) {
    const R = app.timeRange(), at = beatAt(e.clientX);
    return R && R.tracks.includes(t.id) && at >= R.a - 1e-6 && at <= R.b + 1e-6 ? R : null;
  }
  // les commandes de la plage (le clic droit d'un clip, d'une voie)
  const timeItems = (R) => [
    { head: `plage · ${app.bar(R.a)} → ${app.bar(R.b)} · ${R.tracks.length} piste${R.tracks.length > 1 ? 's' : ''}` },
    { label: 'En faire un clip', key: 'Ctrl+J', onclick: () => app.consolidateTime() },
    { label: 'Couper aux bords de la plage', key: 'Ctrl+E', onclick: () => app.splitTime() },
    { label: 'Dupliquer la plage', key: 'Ctrl+D', onclick: () => app.duplicateTime() },
    { label: 'Copier la plage', key: 'Ctrl+C', onclick: () => app.copyTime() },
    { label: 'Couper la plage (presse-papiers)', key: 'Ctrl+X', onclick: () => { if (app.copyTime()) app.deleteTime(); } },
    { label: 'Retirer ce que la plage contient', key: 'Suppr', onclick: () => app.deleteTime() },
    { label: 'Boucler sur la plage', key: 'Ctrl+L', onclick: () => app.loopSelection() },
    { label: 'Générer ici…', sub: 'chanson, un instrument seul… sur la plage', onclick: () => ouvrirGenerer(app) },
    ...versSessionItems({ range: R }),
  ];
  // « Envoyer à la Session » (docs/etudes/odio_session.md § 6, biblio.js) : non destructif —
  // la voie née de la piste (une neuve la première fois), ou une voie choisie de la même sorte
  function versSessionItems(o, t = null) {
    const vs = (P().voies || []).filter((v) => !t || (t.kind === 'audio' ? v.kind === 'audio' : TRACK_KINDS[v.kind]?.pattern === TRACK_KINDS[t.kind]?.pattern));
    return [
      { label: 'Envoyer à la Session', sub: o.range ? 'un clip par piste, par morceau de son' : 'l\'arrangement ne bouge pas', onclick: () => app.versSession(o) },
      { label: 'Envoyer dans une voie', items: [
        { label: 'Une voie neuve', sub: 'qui joue comme la piste', onclick: () => app.versSession({ ...o, neuve: true }) },
        ...(t && vs.length ? ['-', ...vs.map((v) => ({ label: v.name, dot: v.color, onclick: () => app.versSession({ ...o, voie: v.id }) }))] : []),
      ] },
    ];
  }
  // la tête de lecture prise par son onglet : glisser la fait suivre, aimantée
  // (Alt : libre) ; en lecture, la lecture repart d'où on la lâche à chaque pas
  function grabHead(e) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    let last = null;
    ecouteDebut();
    const go = (ev) => {
      edgeScroll(ev);
      const b = Math.max(0, snapB(beatAt(ev.clientX), ev));
      if (b !== last) { last = b; ecouteSeek(b); }
    };
    document.body.classList.add('ar-grab');
    glisser(e, go, () => { document.body.classList.remove('ar-grab'); ecoute.fin(); paintTools(); });
  }

  // ── le son au défilement (06/10, commun/scrub.js) ──
  // Glisser la règle ou l'onglet de la tête, à l'arrêt, fait entendre les clips audio sous
  // la tête, par grains : chacun dans la source de SA piste (player du moteur), donc avec son
  // volume, ses effets, muet et solo ; la place dans le son comme le moteur la calcule
  // (audioGeom : début, transposition, boucle ; clipBuffer : à l'envers), le gain et les
  // fondus du clip. Les clips de notes ne s'entendent pas (les grains sont du son enregistré).
  // En lecture, rien : la lecture repart d'où va la tête (Engine.seek).
  const ecoute = scrubSon({
    contexte: () => app.engine.ctx,
    sons: (t) => {
      const p = P(), eng = app.engine, g = eng.graph;
      if (!p || !g || eng.running) return [];
      const spb = 60 / p.bpm, beat = t / spb, trk = new Map(p.tracks.map((x) => [x.id, x])), out = [];
      for (const c of p.clips) {
        const tr = trk.get(c.track);
        if (!tr || tr.kind !== 'audio' || c.mute || !c.item || beat < c.start || beat >= c.start + c.len) continue;
        const buf = clipBuffer(eng.buffers.get(c.item), c), node = g.nodes.get(tr.src);
        if (!buf || !node || !node.output) continue;
        const G = audioGeom(c, buf.duration), into = (beat - c.start) * spb, L = c.len * spb;
        let at = G.off + into * G.rate;
        if (G.loop && at >= G.ls + G.llen) at = G.ls + ((at - G.ls) % G.llen);
        const fi = c.fi || 0, fo = c.fo || 0;
        const fondu = Math.max(0, Math.min(1, fi > 0 ? into / fi : 1, fo > 0 ? (L - into) / fo : 1));
        out.push({ buffer: buf, at, gain: Math.pow(10, (c.gain || 0) / 20) * fondu, vitesse: G.rate, sortie: node.output });
      }
      return out;
    },
  });
  // le geste commence : le moteur se lance (son contexte, son graphe) s'il ne l'est pas encore
  // — pas si la préférence coupe le son au défilement
  function ecouteDebut() {
    if (!app.engine.running && scrubActif()) app.engine.start().catch(() => {});
    ecoute.debut();
  }
  // la tête va à `b` (noires) : le moteur la pose, le son suit (en secondes)
  function ecouteSeek(b) {
    app.engine.seek(b);
    ecoute.aller(b * 60 / P().bpm);
  }

  // Le dessin d'un clip (forme d'onde, notes, région générative), sur la
  // fenêtre seulement : la toile couvre [xa, xb[ du clip (px depuis son
  // début), posée là par un transform, et l'on dessine dans les coordonnées du
  // clip (le contexte décalé de xa). cv._vue retient ce qui est peint (xa, w,
  // le zoom) : pendant un geste de zoom, echelle étire la toile au lieu de la
  // repeindre.
  function drawClip(cv, c, t, pat) {
    const z = ppb(), x0 = X(c.start), full = X(c.len);
    const xa = Math.max(0, Math.floor(win.a - x0)), xb = Math.max(xa, Math.min(Math.ceil(full), Math.ceil(win.b - x0)));
    const w = xb - xa, h = Math.max(10, thOf(t) - 28);
    const dpr = devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    cv.style.transform = xa ? `translateX(${xa}px)` : '';
    cv._vue = { xa, w, z };
    if (!w) return;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, -xa * dpr, 0);
    g.fillStyle = tok(t.color);
    const p = P();
    if (t.kind === 'audio' && isRegion(c) && !c.item) { drawRegion(g, xb, h, c, app); return; }
    if (t.kind === 'audio') {
      const buf0 = app.engine.buffers.get(c.item);
      if (!buf0) { app.engine.buffer(c.item).then(() => drawClip(cv, c, t, pat)).catch(() => {}); return; }
      const buf = clipBuffer(buf0, c), G = audioGeom(c, buf.duration), D = buf.duration;
      const spb = 60 / p.bpm, L = c.len * spb;
      // les crêtes à la résolution du zoom (une ou deux par pixel) : de près,
      // l'onde reste précise — on y coupe sur un temps
      const n = resCretes((D / G.rate / spb) * z);
      const pk = peaks(buf, n), kps = n / D, parPx = Math.max(1, Math.ceil((spb / z) * G.rate * kps));
      const gain = Math.pow(10, (c.gain || 0) / 20);
      for (let x = xa; x < xb; x++) {
        const tau = (x / z) * spb;
        let sec = G.off + tau * G.rate;
        if (G.loop && sec >= G.ls + G.llen) sec = G.ls + ((sec - G.ls) % G.llen);
        if (sec >= D) break;
        const env = Math.min(1, c.fi ? tau / c.fi : 1, c.fo ? (L - tau) / c.fo : 1);
        // la plus haute des crêtes que couvre ce pixel
        const i0 = Math.min(n - 1, Math.floor(sec * kps)), i1 = Math.min(n, i0 + parPx);
        let v = 0;
        for (let i = i0; i < i1; i++) if (pk[i] > v) v = pk[i];
        v *= gain * Math.max(0, env);
        const hh = Math.max(1, Math.min(1, v) * (h - 2));
        g.fillRect(x, (h - hh) / 2, 1, hh);
      }
      // les fondus, en trait
      g.strokeStyle = tok('ink2'); g.lineWidth = 1;
      if (c.fi) { g.beginPath(); g.moveTo(0, h); g.lineTo(X(c.fi / spb), 1); g.stroke(); }
      if (c.fo) { g.beginPath(); g.moveTo(full - X(c.fo / spb), 1); g.lineTo(full, h); g.stroke(); }
      if (G.loop) {
        // les retours en haut de boucle
        g.fillStyle = tok('line-cy');
        const first = (G.ls + G.llen - G.off) / G.rate / spb;
        for (let s = first; s < c.len; s += G.llen / G.rate / spb) if (s > 0) g.fillRect(X(s), 0, 1, h);
      }
      return;
    }
    if (!pat) return;
    const plen = pat.steps / 4, off = c.off || 0;
    if (t.kind === 'drums') {
      const voices = drumVoicesOf(app.mod(t.src)?.type).filter((v) => pat.lanes?.[v.id]?.some(Boolean));
      const rows = Math.max(1, voices.length), rh = h / rows, wn = Math.max(3, X(0.25) - 2);
      voices.forEach((v, r) => {
        const laneArr = pat.lanes[v.id];
        for (let b = -off; b < c.len; b += plen) {
          laneArr.forEach((vel, s) => {
            const x = X(b + s / 4);
            if (vel && x >= 0 && x + wn > xa && x < xb) { g.globalAlpha = 0.45 + 0.55 * vel; g.fillRect(x, r * rh + rh / 2 - 1.5, wn, 3); }
          });
        }
      });
      g.globalAlpha = 1;
    } else {
      const ps = (pat.notes || []).map((n) => n.p);
      const lo = Math.min(...ps, 60) - 1, hi = Math.max(...ps, 61) + 1;
      for (let b = -off; b < c.len; b += plen) {
        for (const n of pat.notes || []) {
          const x = X(b + n.s / 4);
          if (x + X(n.l / 4) < xa || x >= xb) continue;
          const y = h - 3 - ((n.p - lo) / (hi - lo)) * (h - 6);
          g.fillRect(x, y - 1.5, Math.max(2, X(n.l / 4) - 1), 3);
        }
      }
    }
    g.fillStyle = tok('line');
    for (let b = plen - off; b < c.len; b += plen) g.fillRect(X(b), 0, 1, h);
  }
  // la résolution des crêtes pour une onde de `px` pixels : une puissance de
  // deux (le cache de moteur.js en garde une par résolution), bornée
  const resCretes = (px) => Math.min(1 << 18, Math.max(2048, 2 ** Math.ceil(Math.log2(Math.max(1, px)))));

  // chaque clip de la grille, avec son clip, sa piste, son motif
  function pourClips(fn) {
    const byId = new Map(P().clips.map((c) => [c.id, c]));
    for (const box of grid.querySelectorAll('.clip')) {
      const c = byId.get(box.dataset.id), cv = box.querySelector('.cv');
      const t = c && app.track(c.track);
      if (t && cv) fn(cv, c, t, c.pat && app.pat(c.pat), box);
    }
  }

  // ── le zoom en place ──
  // Tout ce qui dépend du zoom, mis à jour sans rien refaire : la largeur, la
  // grille, la règle (numéros, sections, marqueurs, boucle), la zone de
  // boucle, les clips (place et largeur), les traits des groupes, l'arc et
  // l'automation (repeints : peu de points). Des écritures seulement : la
  // seule lecture de mise en page de l'image est faite avant (appliquerZoom).
  // Pendant un geste (`geste`), la toile d'un clip est étirée (transform,
  // sans la repeindre) tant qu'elle couvre ce qui se voit du clip ; sinon
  // repeinte, dans un budget par image ; le geste fini, toutes sont
  // repeintes nettes (appliquerZoom, ZOOM_REPOS).
  function echelle(sl, geste = false) {
    const z = ppb();
    portee = sl + 2 * vueW;
    poserLargeur();
    fenetre(sl);
    paintNums();
    const p = P();
    for (const [box, s] of regle.secs) { box.style.left = `${X(s.a)}px`; box.style.width = `${Math.max(6, X(s.b - s.a) - 2)}px`; }
    for (const [box, m] of regle.marks) box.style.left = `${X(m.b)}px`;
    if (regle.loop) { regle.loop.style.left = `${X(p.loop.a)}px`; regle.loop.style.width = `${X(p.loop.b - p.loop.a)}px`; }
    paintZone();
    paintTime();   // la plage de temps et le marqueur d'insertion suivent le zoom (ils ne sont pas refaits par render)
    for (const [i, c] of minis) placerMini(i, c);
    const t0 = performance.now();
    pourClips((cv, c, t, pat, box) => {
      box.style.left = `${X(c.start)}px`; box.style.width = `${Math.max(4, X(c.len))}px`;
      const v = cv._vue;
      if (!geste || !v) { drawClip(cv, c, t, pat); return; }
      const k = z / v.z, x0 = X(c.start);
      // ce qui se voit du clip, et ce que la toile étirée en couvre ; étirée
      // de plus du double (ou réduite de plus de moitié), elle est repeinte
      const va = Math.max(0, sl - x0), vb = Math.min(X(c.len), sl + vueW - x0);
      const cache = vb <= va;
      const couvre = cache || (v.xa * k <= va + 1 && (v.xa + v.w) * k >= vb - 1);
      if (!cache && (!couvre || k > 2 || k < 0.5) && performance.now() - t0 < 6) { drawClip(cv, c, t, pat); return; }
      cv.style.transform = `translateX(${v.xa * k}px) scaleX(${k})`;
    });
    for (const d of toiles) d();
    if (zoomLab) zoomLab.textContent = String(Math.round(z * p.sig));
  }

  // Défiler (ou une fenêtre qui change de taille) : plus loin à droite, la
  // largeur s'étend (la grille suit, sans fin) ; sorti de la fenêtre, on la
  // replace et l'on repeint ce qui s'y dessine. Une fois par image.
  let vueRaf = 0;
  function suivreVue() {
    vueRaf = 0;
    const sl = scroll.scrollLeft;
    if (sl + 2 * vueW > width()) { portee = sl + 3 * vueW; poserLargeur(); }
    const marge = vueW / 4;
    if ((win.a > 0 && sl < win.a + marge) || sl + vueW > win.b - marge) {
      fenetre(sl);
      paintNums();
      for (const d of toiles) d();
      pourClips(drawClip);
    }
  }
  const vueBouge = () => { if (!vueRaf) vueRaf = requestAnimationFrame(suivreVue); };
  scroll.addEventListener('scroll', vueBouge, { passive: true });
  new ResizeObserver(([e]) => {
    const w = Math.round(e.contentRect.width) - HEAD_W;
    if (w > 0 && w !== vueW) { vueW = w; vueBouge(); }
  }).observe(scroll);

  // ── déposer : fichiers du disque (ils entrent dans la bibliothèque,
  // catégorie Upload), sons glissés d'ailleurs dans le portail (ITEM_MIME de
  // commun/shell.js), éléments du navigateur d'ODIO ──
  const wants = (e) => { const ty = [...(e.dataTransfer?.types || [])]; return ty.includes('Files') || ty.includes('application/x-odio') || ty.includes(ITEM_MIME); };
  function onDragOver(e, t) {
    if (!wants(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const b = Math.max(0, snapB(beatAt(e.clientX), e));
    Object.assign(dropLine.style, { display: 'block', left: `${HEAD_W + X(b)}px` });
    grid.querySelectorAll('.ar-lane.drop').forEach((x) => x.classList.remove('drop'));
    if (t) grid.querySelector(`.ar-lane[data-track="${t.id}"]`)?.classList.add('drop');
  }
  async function onDrop(e, t, atBeat) {
    if (!wants(e)) return;
    e.preventDefault(); e.stopPropagation();
    dropLine.style.display = 'none';
    document.body.classList.remove('dropping');
    grid.querySelectorAll('.ar-lane.drop').forEach((x) => x.classList.remove('drop'));
    const at = atBeat ?? Math.max(0, snapB(beatAt(e.clientX), e));
    const od = e.dataTransfer.getData('application/x-odio');
    const raw = od ? '' : e.dataTransfer.getData(ITEM_MIME);
    if (raw) {
      // un son, un clip MIDI (ses notes), un élément (sa dernière version) ; plusieurs d'un coup (le
      // panneau Asset, le chutier : MULTI_MIME) : à la suite (panneau.js, poserObjets)
      try {
        let ids = [];
        try { ids = JSON.parse(e.dataTransfer.getData(MULTI_MIME) || '[]'); } catch { ids = []; }
        const list = Array.isArray(ids) && ids.length > 1
          ? (await api('library/batch', { method: 'POST', body: { ids: ids.map(String) } })).items
          : [await api(`library/${JSON.parse(raw).id}`)];
        await poserObjets(app, list, t?.id || null, at);
      } catch (err) { toast(err.message); }
      return;
    }
    if (e.dataTransfer.files?.length && !od) {
      const files = [...e.dataTransfer.files];
      const mids = files.filter((f) => /\.midi?$/i.test(f.name));
      const audio = files.filter((f) => !mids.includes(f) && (AUDIO_EXT.test(f.name) || f.type.startsWith('audio/')));
      if (audio.length + mids.length < files.length) toast(`${files.length - audio.length - mids.length} fichier(s) ignoré(s) : ODIO prend WAV, MP3, FLAC, M4A, OGG et MIDI`, 5000);
      if (audio.length) app.importFiles(audio, { track: t?.id || null, at, perTrack: !t });
      // un fichier MIDI du disque : la bibliothèque (Upload), puis ses notes
      for (const f of mids) {
        try { const it = await uploadFile(f, { tool: 'upload', via: 'odio' }); await placeMidi(app, it.id, t?.id || null, at); } catch (err) { toast(`${f.name} : ${err.message}`, 6000); }
      }
      if (mids.length) document.dispatchEvent(new CustomEvent('mu:midi'));
      return;
    }
    let d = null;
    try { d = JSON.parse(od); } catch { return; }
    if (d.t === 'midi') { await placeMidi(app, d.id, t?.id || null, at); return; }
    if (d.t === 'gen') { await addGenTrack(app, d.model); return; }
    app.dropItem(d, t?.id || null, at);
  }

  // ── l'ensemble ──
  const meters = [];
  // La règle seule, refaite en place (06/10) : les paroles qu'on tape dans le
  // panneau du bas replacent des sections (musique.js, la structure) sans
  // refaire l'arrangement — le champ garde la main.
  let regleEl = null;
  function paintRegle() {
    if (!regleEl?.isConnected) return;
    const n = ruler();
    regleEl.replaceWith(n);
    regleEl = n;
    const nb = grid.querySelector('.ar-corner .lbl:last-child');
    if (nb) nb.textContent = `${visTracks().length} · ${P().sections.length} sections`;
  }
  function render() {
    const p = P();
    const sl = scroll.scrollLeft;   // lu avant toute écriture : la fenêtre et la portée en partent
    meters.length = 0;
    toiles.length = 0;
    minis.length = 0;
    paintTools();
    body.style.setProperty('--nav-w', `${navW()}px`);
    body.classList.toggle('nav-off', ui().nav === false);
    browser.render();
    dock.el.hidden = ui().dock === false;
    dockSplit.hidden = ui().dock === false;
    if (ui().dock === false) document.body.classList.remove('mu-gen-dock');     // le panneau génératif fermé : le GUIDE reprend son orange
    dock.el.style.height = `${dockH()}px`;
    if (ui().dock !== false) dock.render();
    portee = sl + 2 * vueW;
    fenetre(sl);
    grid.style.setProperty('--head', `${HEAD_W}px`);
    grid.style.setProperty('--ruler', `${RULER_H}px`);
    poserLargeur();
    regleEl = ruler();
    const rows = [el('div', { class: 'ar-corner', title: MOLETTE }, el('span', { class: 'lbl' }, 'pistes'),
      el('span', { class: 'lbl' }, `${visTracks().length} · ${p.sections.length} sections`)), regleEl];
    rows.push(...arcsRows());   // le groupe des arcs : sa rangée collée en haut, déplié un arc par rangée (arcs.js)
    for (const L of (p.auto || []).filter((x) => !app.mod(x.mod)?.track)) rows.push(...autoRows(L));
    // les pistes, et au-dessus des membres d'un groupe, son en-tête (replié : lui seul)
    const groups = new Map((p.groups || []).map((g) => [g.id, g])), vus = new Set();
    for (const t of visTracks()) {
      const g = t.grp && groups.get(t.grp);
      if (g && !vus.has(g.id)) { vus.add(g.id); const members = visTracks().filter((x) => x.grp === g.id); rows.push(groupHead(g, members), groupLane(g, members)); }
      if (g?.fold) continue;
      rows.push(head(t), lane(t));
      for (const L of lanesOf(t)) rows.push(...autoRows(L));
    }
    const dropHead = el('div', { class: 'ar-droph' }, el('span', { class: 'lbl' }, visTracks().length ? 'déposer ici : une piste neuve' : 'aucune piste'));
    const dropLane = el('div', { class: 'ar-dropz' },
      el('span', {}, 'glisser un instrument, un son de la bibliothèque ou des fichiers audio du disque · double-clic : une piste'));
    for (const n of [dropHead, dropLane]) {
      n.addEventListener('dragover', (e) => onDragOver(e, null));
      n.addEventListener('drop', (e) => onDrop(e, null));
    }
    dropLane.addEventListener('dblclick', (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(e.clientX, Math.min(e.clientY, r.bottom), [...app.trackChoices(), '-', ...genTrackChoices(app)]); });
    rows.push(dropHead, dropLane);
    // les traits de la grille, par-dessus les voies et leurs clips : de la
    // rangée qui suit l'arc (collé en haut, il porte la sienne) à celle de la
    // zone de dépôt (exclue) ; placés sur les lignes de la grille CSS, sans
    // mesure lue (un enfant absolu d'une grille prend la zone de ses lignes)
    const n = rows.length / 2;
    lignes.style.gridRow = `3 / ${n}`;
    lignes.hidden = n <= 3;
    toiles.push(peindreLignes);
    peindreLignes();
    paintZone();
    put(grid, ...rows, lignes, zone, ph, recBox, marquee, dropLine, trackLine);
    frame(app.pos());
  }

  function paintZone() {
    const p = P();
    zone.style.left = `${HEAD_W + X(p.loop.a)}px`;
    zone.style.width = `${X(p.loop.b - p.loop.a)}px`;
    zone.classList.toggle('on', !!p.loop.on);
  }

  function frame(beat) {
    // LA tête (commun/tete.js) : sa place, cachée sous les en-têtes collés ; en lecture, la vue la suit (comme le Montage)
    phX = poser(ph, X(beat), { decal: HEAD_W, sous: scroll.scrollLeft });
    if (app.engine.running) suivre(scroll, phX, { tete: HEAD_W });
    for (const [id, mt] of meters) {
      const db = app.engine.level(id);
      mt.firstChild.style.transform = `scaleX(${Math.max(0, Math.min(1, (db + 60) / 66)).toFixed(3)})`;   // par transform : musique.css, .ar-mtr
      mt.classList.toggle('hot', db > -1);
    }
    // la prise en cours
    const R = app.rec?.live?.();
    if (R) {
      const row = grid.querySelector(`.ar-lane[data-track="${R.track}"]`);
      if (row) {
        recBox.style.display = 'block';
        recBox.style.left = `${HEAD_W + X(R.a)}px`;
        recBox.style.top = `${row.offsetTop + 3}px`;
        recBox.style.height = `${row.offsetHeight - 6}px`;
        recBox.style.width = `${Math.max(2, X(Math.max(0, R.b - R.a)))}px`;
        recBox.firstChild.textContent = `prise · ${R.n} note${R.n > 1 ? 's' : ''}`;
      }
    } else recBox.style.display = 'none';
    frameTime();
    dock.frame(beat);
  }

  // Les raccourcis de l'arrangement, ceux de Live 12 (guide.js les liste,
  // avec leur source). Les lettres seules ne passent ici que si le clavier
  // MIDI de l'ordinateur est éteint (M), comme dans Live.
  // le clavier va là où l'on a cliqué en dernier : la vue de détail ou l'arrangement
  let focusZone = 'arr';
  dock.el.addEventListener('pointerdown', () => { focusZone = 'dock'; }, true);
  scroll.addEventListener('pointerdown', () => { focusZone = 'arr'; }, true);
  function key(e) {
    if (focusZone === 'dock' && ui().dock !== false && dock.key?.(e)) return true;
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    const has = (S.sel.clips || []).length > 0;
    const L = letter(e);   // la lettre, pas la touche : juste en AZERTY (ui.js)
    // Suppr sur une plage de temps : ce qu'elle contient s'en va (Ctrl+Z le rend)
    if ((k === 'Delete' || k === 'Backspace') && !ctrl && app.timeRange()) { e.preventDefault(); app.deleteTime(); return true; }
    if ((k === 'Delete' || k === 'Backspace') && !ctrl && has) { e.preventDefault(); app.removeSel(); return true; }
    // Suppr sur des en-têtes choisis : les pistes partent (Ctrl+Z les rend)
    if ((k === 'Delete' || k === 'Backspace') && !ctrl && (S.sel.tracks || []).length) { e.preventDefault(); app.removeTracks([...S.sel.tracks], { ask: false }); return true; }
    // Ctrl+G · Ctrl+Maj+G (Live 12, § 42.19 « Commands for Tracks » : Group
    // Selected Tracks, Ungroup Tracks) : grouper les pistes choisies, défaire leur groupe
    if (ctrl && !e.shiftKey && L === 'g') { e.preventDefault(); groupPicked(); return true; }
    if (ctrl && e.shiftKey && L === 'g') {
      e.preventDefault();
      const gs = [...new Set((S.sel.tracks || [S.sel.track]).map((id) => app.track(id)?.grp).filter(Boolean))];
      if (!gs.length) toast('Ctrl+Maj+G : choisis une piste d\'un groupe'); else for (const g of gs) app.ungroup(g);
      return true;
    }
    if (ctrl && !e.shiftKey && L === 'd') { e.preventDefault(); app.duplicateSel(); return true; }
    if (ctrl && L === 'c') { e.preventDefault(); app.copySel(); return true; }
    if (ctrl && L === 'x') { e.preventDefault(); app.cutSel(); return true; }
    if (ctrl && L === 'v') { e.preventDefault(); app.paste(); return true; }
    if (ctrl && L === 'e') { e.preventDefault(); app.splitAtPlayhead(); return true; }
    if (ctrl && !e.shiftKey && L === 'j') { e.preventDefault(); app.consolidateSel(); return true; }
    if (ctrl && !e.shiftKey && L === 'l') { e.preventDefault(); app.loopSelection(); return true; }
    if (ctrl && L === 'a') { e.preventDefault(); app.selectClips(P().clips.map((c) => c.id)); return true; }
    if (ctrl && L === 'r') { e.preventDefault(); renameSelected(); return true; }
    if (ctrl && e.code === 'Digit1') { e.preventDefault(); stepGrid(-1); return true; }
    if (ctrl && e.code === 'Digit2') { e.preventDefault(); stepGrid(1); return true; }
    if (ctrl && e.code === 'Digit4') { e.preventDefault(); ui().snap = (ui().snap ?? 1) ? 0 : 1; app.saveUi(); paintTools(); toast(ui().snap ? 'aimant : 1/4' : 'aimant : libre'); return true; }
    if (ctrl) return false;
    if (e.altKey && (k === '+' || k === '=' || e.code === 'NumpadAdd')) { e.preventDefault(); scaleHeights((th() + 12) / th()); return true; }
    if (e.altKey && (k === '-' || e.code === 'NumpadSubtract')) { e.preventDefault(); scaleHeights((th() - 12) / th()); return true; }
    if (e.altKey) return false;
    if (k === '+' || k === '=' || e.code === 'NumpadAdd') { e.preventDefault(); setZoom(zoomCible() * 1.25); return true; }
    if (k === '-' || e.code === 'NumpadSubtract') { e.preventDefault(); setZoom(zoomCible() / 1.25); return true; }
    if (e.code === 'Digit0' || e.code === 'Numpad0') { if (has) { e.preventDefault(); app.muteSel(); } return true; }
    if (k === 'Escape') { app.selectClips([]); return true; }   // les clips et le temps (selectClips)
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && has) {
      e.preventDefault();
      const d = (k === 'ArrowLeft' ? -1 : 1) * (snapU() || 0.25);
      const g = P().clips.filter((c) => sel().has(c.id));
      if (g.every((c) => c.start + d >= 0)) { for (const c of g) c.start += d; app.commit('data'); }
      return true;
    }
    // sans clip choisi : ← → déplacent le marqueur d'insertion (ou la plage)
    // d'un pas de grille ; Maj : étendre ou resserrer la plage (Live)
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && app.timeSel()) {
      e.preventDefault();
      const T = app.timeSel(), d = (k === 'ArrowLeft' ? -1 : 1) * (snapU() || 0.25);
      const a = T.b - T.a < 1e-6 ? app.engine.insert : T.a, len = T.b - T.a;
      if (e.shiftKey) {
        let A = a, B = a + len;
        if (d > 0 || B + d > A + 1e-6) B += d; else A = Math.max(0, A + d);
        S.sel.time = { ...T, a: A, b: B, from: { b: A, track: T.tracks[0] } };
      } else S.sel.time = { ...T, a: Math.max(0, a + d), b: Math.max(0, a + d) + len, from: { b: Math.max(0, a + d), track: T.tracks[0] } };
      app.engine.cue(S.sel.time.a);
      paintTime(); paintTools();
      return true;
    }
    if (L === 'r' && has) { app.reverseSel(); return true; }
    if (app.kbdOn()) return false;                     // le clavier MIDI prend les lettres
    if (L === 'z') { zoomToSelection(); return true; }
    if (L === 'x') { zoomOut(); return true; }
    if (L === 'w') { fit(); return true; }
    if (L === 'h') { fitHeight(); return true; }
    return false;
  }
  function stepGrid(d) {
    const list = SNAPS.map(([v]) => v).filter((v) => v !== 0);
    const i = Math.max(0, list.findIndex((v) => String(v) === String(ui().snap ?? 1)));
    ui().snap = list[clamp(i + d, 0, list.length - 1)];
    app.saveUi(); paintTools();
    toast(`aimant : ${SNAPS.find(([v]) => String(v) === String(ui().snap))?.[1]}`, 1200);
  }
  // Ctrl+R (Live : « Rename ») : le clip choisi, sinon la piste choisie
  function renameSelected() {
    const c = app.clip(S.sel.clip);
    if (c) { const b = grid.querySelector(`.clip[data-id="${c.id}"] .t`); if (b) renameClip(c, b, c.name || b.textContent); return; }
    const t = app.track(S.sel.track);
    const n = t && grid.querySelector(`.ar-head[data-track="${t.id}"] .nm`);
    if (n) renameTrack(t, n);
  }

  // la molette : la règle commune de toutes les timelines du portail
  // (commun/molette.js, Cal 29/09) — seule : défiler haut / bas ; Maj : dans
  // le temps ; Alt : zoom horizontal ancré au curseur ; Ctrl : hauteur de
  // toutes les pistes, sur l'en-tête d'une piste (à gauche) : la sienne.
  // (Avant : Ctrl zoomait le temps et Alt la hauteur, comme Live 12.)
  brancher(scroll, {
    zoom: (f, cx) => zoomAround(zoomCible() * f, cx - scroll.getBoundingClientRect().left),   // une demande ; l'image l'applique
    hauteur: (f, id, e) => scaleHeights(f, id, e.clientY),
  });
  // Ctrl+Alt+glisser : déplacer la vue (Live)
  scroll.addEventListener('pointerdown', (e) => {
    if (!(e.ctrlKey && e.altKey) || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY, l0 = scroll.scrollLeft, t0 = scroll.scrollTop;
    const mv = (ev) => { scroll.scrollLeft = l0 - (ev.clientX - x0); scroll.scrollTop = t0 - (ev.clientY - y0); };
    const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  }, true);
  document.addEventListener('mu:buffer', () => { if (S.view === 'timeline') render(); });
  // un travail de la file a commencé ou fini sur des clips (calcul.js) : leur toile se redessine (une région dit « en cours »)
  document.addEventListener('mu:calcul', (e) => { const ids = new Set(e.detail?.clips || []); pourClips((cv, c, t, pat) => { if (ids.has(c.id)) drawClip(cv, c, t, pat); }); });
  // défiler : la tête se cache sous les en-têtes collés, ou y reparaît (commun/tete.js)
  scroll.addEventListener('scroll', () => { if (phX !== null) poser(ph, phX, { decal: HEAD_W, sous: scroll.scrollLeft }); }, { passive: true });

  // Le clic droit là où aucune zone n'a ouvert le sien (musique.js le demande) :
  // la voie d'une piste, la rangée des sections, le coin, les outils, le
  // navigateur, le panneau du bas.
  function zoneMenu(e) {
    const tg = e.target, p = P();
    if (dock.el.contains(tg)) return dock.zoneMenu?.(e) || null;
    const ln = tg.closest?.('.ar-lane');
    if (ln) {
      const t = app.track(ln.dataset.track);
      if (!t) return null;
      const b = Math.max(0, Math.floor(beatAt(e.clientX) / p.sig) * p.sig);
      const R = plageSous(t, e);
      // hors de la sélection, le bouton droit choisit ce qui est sous lui,
      // comme un clic (Live) : le marqueur d'insertion là, sur cette piste
      if (!R && e.button === 2) timePoint(t, Math.max(0, snapB(beatAt(e.clientX), e)));
      return [
        ...(R ? [...timeItems(R), '-'] : []),
        { head: `${t.name} · mesure ${app.bar(b)}` },
        isGenTrack(t) ? { label: 'Une région ici', sub: 'quatre mesures', onclick: () => newRegion(app, t, b, b + 4 * p.sig) }
          : t.kind === 'audio' ? { label: 'Un son de la bibliothèque ici', onclick: () => app.addAudio(t.id, b) }
            : { label: 'Un clip ici', sub: 'une mesure', onclick: () => { const c = app.newClip(t.id, b); if (c) app.showDetail('clip'); } },
        { label: 'Coller ici', key: 'Ctrl+V', disabled: !app.board, why: 'rien à coller : Ctrl+C sur des clips ou sur une plage', onclick: () => { S.sel.time = null; app.engine.seek(b); app.paste(); } },
        { label: 'Choisir ses clips', onclick: () => app.selectClips(p.clips.filter((c) => c.track === t.id).map((c) => c.id)) },
        { label: 'Aller là', onclick: () => app.engine.seek(b) },
        '-',
        { label: 'Instruments et effets', onclick: () => { app.selectTrack(t.id); app.showDetail('device'); } },
        { label: 'Couleur', dot: t.color, items: colorItems(t) },
        { label: 'Retirer la piste', danger: true, onclick: () => app.removeTracks([t.id], { ask: false }) },
      ];
    }
    if (tg.closest?.('.ar-secs')) {
      const b = Math.max(0, Math.floor(beatAt(e.clientX) / p.sig) * p.sig);
      return [{ head: `sections · mesure ${app.bar(b)}` }, { label: 'Une section ici', onclick: () => addSectionAt(b) }, { label: 'Aller là', onclick: () => app.engine.seek(b) }];
    }
    if (tg.closest?.('.ar-corner, .ar-droph, .ar-dropz, .ar-tools')) return [{ head: 'l\'arrangement' }, ...app.trackChoices(), '-', ...genTrackChoices(app),
      '-', { label: 'Tout le morceau dans la fenêtre', key: 'W', onclick: fit }, { label: 'Hauteur des pistes : ajuster', key: 'H', onclick: fitHeight },
      { label: ui().dock === false ? 'Montrer le panneau du bas' : 'Cacher le panneau du bas', onclick: () => { ui().dock = ui().dock === false; app.saveUi(); render(); } }];
    if (browser.el.contains(tg)) return [{ head: 'le navigateur' }, { label: ui().nav === false ? 'Déplier le navigateur' : 'Replier le navigateur', key: 'Ctrl+Alt+B', onclick: () => { ui().nav = ui().nav === false; app.saveUi(); render(); } }];
    return null;
  }
  // les fichiers lâchés à côté des voies (sur la règle, les en-têtes vides)
  scroll.addEventListener('dragover', (e) => onDragOver(e, null));
  scroll.addEventListener('drop', (e) => onDrop(e, null));

  return { el: root, render, frame, key, paintTools, paintSel, fit, dock, zoneMenu, paintRegle };
}
