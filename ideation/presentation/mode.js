// IDÉATION · PRÉSENTATION — le mode Présentation (docs/etudes/presentations.md § 10).
//
// Cal, 30/09 : « il ne faut pas alourdir l'interface principale : ce pourrait être un mode
// "expert", un mode particulier d'affichage : on fait la présentation, on cale tout, et on
// fait une passe assistée super cool pour rendre la présentation hyper belle ».
//
// Le mode est chargé seulement quand on y entre (diapo/ : le bouton du panneau Diapositives,
// la palette ⌘K) ; il a sa propre vue, posée par-dessus l'Idéation :
//   à gauche   le plan des diapositives (leurs scènes en petit, dans l'habit du modèle) ;
//   au centre  la scène de la diapositive choisie, qui joue ses entrées ; un clic choisit un
//              objet, sans rien rejouer, et un texte s'y écrit sur place (Cal, 06/10 : le clic
//              qui relançait l'animation empêchait de changer les textes) ; dessous, centrés,
//              les boutons du lecteur du portail (commun/lecteur.css) ;
//   dessous    la minuterie de motion, dans un panneau qu'on redimensionne (commun/split.js) :
//              une piste par objet (son entrée, décalée, ses unités), LA tête de lecture du
//              portail (commun/tete.js) qu'on glisse sur la règle, une barre qu'on déplace (le
//              délai) ou dont on tire les bords (le début, la durée), un losange par image clé qu'on
//              glisse dans le temps (06/10 : un glisser = un pas d'annulation) ; sous l'objet choisi,
//              une ligne par propriété animée ; aucun texte ne s'y sélectionne en glissant ;
//   à droite   Modèles (les dix, essayer, charger l'exemple), Diapositive (transition, durée,
//              courbe, fond, avance seule), Objet (entrée, découpe, délai, durée, courbe,
//              décalage, étape, boucle, profondeur, sortie ; 06/10 : ses images clés à la tête de
//              lecture, la courbe d'une clé avec son dessin en direct, les préréglages d'entrée et de
//              sortie qui fabriquent des clés, la cascade sur les objets choisis par Maj + clic).
// En haut : Lire (le lecteur plein écran), Exporter en PDF (export.js : le travail presentation.pdf,
// Chromium sans affichage sur la page d'impression — et son menu : les images, imprimer depuis ce
// navigateur), et la seule action orange : la passe assistée (avant / après, puis Appliquer). Tout
// ce qui change le document passe par app.mutate : Ctrl+Z l'annule, la co-édition l'envoie. Échap rend l'Idéation telle quelle :
// le mode ne touche ni la caméra, ni la sélection, ni la planche tant qu'on n'y change rien.

import { el, toast, href, api } from '../../commun/shell.js';
import { basculer, enPleinEcran, permis } from '../../commun/pleinecran.js';
import { tete, poser, brancherRegle } from '../../commun/tete.js';   // LA tête de lecture de toutes les timelines (Cal, 30/09 et 06/10)
import { ICON } from '../../commun/lecteur.js';                      // LE lecteur : sa barre (lecteur.css), sa boucle
import { split as panneaux } from '../../commun/split.js';            // les panneaux qu'on redimensionne
import { atelier } from '../atelier/socle.js';
import { shownOf, deckOf, isSlide } from '../diapo/ordre.js';
import { buildScene, releaseScene, slideNodes, partOf, roleOf, readOrder } from './scene.js';
import { createRun, frameMeter, EASE } from './moteur.js';
import { transit, pairsOf } from './transitions.js';
import { loadModeles, styler, fontsReady, motionFor, transFor, applyTo, exampleNodes, legacyTrans } from './modeles.js';
import { propose, recommend, applyProposal } from './assist.js';
import { createPlayer } from './lecteur.js';
import { exporter } from './export.js';   // ── export PDF (06/10) ── l'export de la présentation : PDF, images, vidéo
// les images clés, les courbes, les préréglages, la cascade (06/10 : la note de spécification d'un éditeur de motion design)
import { KEY_PROPS, KEY_PROP, keysAt, setKey, toggleKey, moveKeys, setEaseAt, shiftKeys, presetKeys, dropPreset, hasPreset, cascade,
  PRESET_KINDS, PRESET_DIRS, PRESET0, ORDERS, SAME } from './courbes.js';
import { courbe, EASE_FR } from './courbe.js';

const CSS = new URL('./presentation.css', import.meta.url).href;
export const FX_IN = [['none', 'Aucune'], ['fade', 'Fondu'], ['rise', 'Monte'], ['drop', 'Descend'], ['left', 'Glisse ←'], ['right', 'Glisse →'], ['scale', 'Échelle'],
  ['zoom', 'Zoom'], ['blur', 'Flou'], ['tilt', 'Bascule'], ['mask-up', 'Masque ↑'], ['mask-down', 'Masque ↓'], ['mask-left', 'Masque ←'], ['mask-right', 'Masque →'],
  ['reveal', 'Révélation'], ['draw', 'Dessin'], ['count', 'Compteur'], ['type', 'Machine à écrire']];
const FX_OUT = [['none', 'Aucune'], ['fade', 'Fondu'], ['sink', 'Tombe'], ['blur', 'Flou'], ['scale', 'Échelle'], ['mask-up', 'Masque ↑'], ['mask-left', 'Masque ←']];
const LOOPS = [['none', 'Aucune'], ['drift', 'Dérive'], ['float', 'Flotte'], ['pulse', 'Pulse'], ['spin', 'Tourne'], ['sway', 'Balance']];
const BY = [['all', 'Tout'], ['line', 'Ligne'], ['word', 'Mot'], ['letter', 'Lettre']];
export const TRANS = [['cut', 'Coupe'], ['fade', 'Fondu'], ['push', 'Poussée'], ['wipe', 'Volet'], ['curtain', 'Rideau'], ['zoom', 'Zoom'], ['morph', 'Morph'], ['toile', 'Toile']];
const BGS = [['bg', 'Fond'], ['surface', 'Surface'], ['ink', 'Encre'], ['accent', 'Accent'], ['accent2', 'Accent 2']];
const ROLE_FR = { title: 'titre', section: 'section', image: 'image', quote: 'citation', numbers: 'chiffres', grid: 'grille', content: 'contenu', end: 'fin' };
const PART_FR = { kicker: 'surtitre', title: 'titre', body: 'corps', caption: 'légende', figure: 'chiffre', quote: 'citation', image: 'image', hero: 'plein cadre', stroke: 'trait', shape: 'forme', other: 'objet', decor: 'décor' };
const two = (k) => String(k).padStart(2, '0');
const sec = (ms) => (ms / 1000).toFixed(2);
const FPS = 30;   // le pas à pas (Maj + ← →) et le numéro d'image du transport : la cadence de la vidéo par défaut

let M = null;   // le mode, une fois installé (un seul par page)

// `exemple` : l'id d'un modèle dont l'exemple (ses diapositives, son motion) se pose sur la planche à l'ouverture
// (la galerie des modèles, ideation/galerie.js)
export async function enter(app, { from = null, exemple = null } = {}) {
  if (!M) M = install(app);
  const ok = await M.open(from);
  if (ok && exemple) {
    const m = M.modeles.find((x) => x.id === exemple);
    if (m) await M.loadExample(m);
  }
  return ok;
}
export const current = () => M;

function install(app) {
  const A = atelier(app);
  const { S } = app;
  if (!document.querySelector('link[data-pm]')) document.head.append(el('link', { rel: 'stylesheet', href: CSS, 'data-pm': '' }));
  const reducedQ = matchMedia('(prefers-reduced-motion: reduce)');
  let on = false, modeles = [], cur = 0, sel = null, trying = null, assist = null, split = 0.5;
  // `sel` : l'objet de l'inspecteur ; `multi` : tous ceux qu'on a choisis (Maj + clic : la cascade) ;
  // `selKey` : la clé choisie (un clic sur un losange) — { prop (null : toutes à cet instant), t (ms dans l'étape) }
  let multi = new Set(), selKey = null;
  let keyUi = null;   // l'onglet Objet suit la tête : ses valeurs, ses ◆ (posé par inspObjet)
  const pre = { in: { ...PRESET0 }, out: { ...PRESET0, dir: 'right', ease: 'in', touched: false } };
  const casc = { order: 'forward', interval: 120, seed: 1 };
  let scene = null, run = null, tick = 0, subs = [], player = null, busy = 0;
  const meta = () => S.meta?.deck;
  const frames = () => shownOf(S.board).filter(isSlide);
  const applied = () => modeles.find((m) => m.id === S.board?.pres?.template) || null;
  const tplNow = () => trying || applied();
  const boardNow = () => (assist ? assist.board : S.board);

  // ── la vue ───────────────────────────────────────────────
  const root = el('div', { class: 'pm-mode', role: 'dialog', 'aria-label': 'mode Présentation', hidden: true });
  const titleB = el('b', { class: 'pm-bname' });
  const tplB = el('span', { class: 'pm-tplname' });
  const goB = el('button', { class: 'tb go sm', type: 'button', onclick: () => (assist ? applyAssist() : startAssist()) }, 'Passe assistée');
  const cancelB = el('button', { class: 'tb ghost sm', type: 'button', hidden: true, onclick: () => stopAssist() }, 'Annuler la passe');
  const exportSlot = el('span', { class: 'pm-exps' });   // ── export PDF ── posé plus bas, une fois le plan monté
  const top = el('header', { class: 'pm-top' },
    el('span', { class: 'lbl' }, 'présentation'), titleB, tplB, el('span', { class: 'sp' }),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'lire la présentation en plein écran, depuis cette diapositive', onclick: () => play() }, 'Lire'),
    exportSlot,
    cancelB, goB,
    el('button', { class: 'tb ghost sm', type: 'button', title: 'retour à l’Idéation · Échap', onclick: () => close() }, 'Retour · Échap'));
  const outline = el('aside', { class: 'pm-out', 'aria-label': 'plan des diapositives' });
  const view = el('main', { class: 'pm-view' });
  const stage = el('div', { class: 'pm-stage pm-edit' });
  const fit = el('div', { class: 'pm-fit' });
  const fitB = el('div', { class: 'pm-fit pm-before' });
  const selBox = el('div', { class: 'pm-selbox', hidden: true });
  const handle = el('div', { class: 'pm-split', hidden: true, title: 'avant · après : glisser' }, el('span', { class: 'lbl' }, 'avant'), el('i'), el('span', { class: 'lbl' }, 'après'));
  const banner = el('div', { class: 'pm-banner', hidden: true });
  stage.append(fitB, fit, selBox, handle);
  view.append(banner, stage);
  const insp = el('aside', { class: 'pm-insp' });
  const tl = el('footer', { class: 'pm-tl', 'aria-label': 'la minuterie de motion' });
  // la scène et la minuterie, l'une sur l'autre : la poignée entre les deux règle la hauteur de la
  // minuterie (commun/split.js : glisser, flèches, double-clic ; gardée dans ce navigateur, clé
  // « sr-split-ideation-motion »)
  const mid = el('div', { class: 'pm-mid' }, view, tl);
  root.append(top, outline, mid, insp);
  document.body.append(root);
  // ── export PDF (06/10) ── le PDF est celui de la planche enregistrée : ni pendant un aperçu, ni pendant une passe
  const exp = exporter({ app, frames: () => frames(), slide: () => frames()[cur] || null, outline, host: root, printView: () => printView(),
    busy: (short) => (assist ? (short ? 'une passe est ouverte : appliquez-la ou annulez-la' : 'une passe assistée est ouverte : appliquez-la ou annulez-la — le PDF est celui de la planche')
      : trying ? (short ? 'un aperçu est ouvert : appliquez le modèle ou Échap' : `aperçu de ${trying.name} : appliquez le modèle ou quittez l’aperçu (Échap) — le PDF est celui de la planche`) : '') });
  exportSlot.replaceWith(exp.el);
  // ── fin export PDF ──
  const rows = panneaux(mid, [{ el: view, grow: 1, min: 240 }, { el: tl, size: 220, min: 120 }], { axis: 'y', key: 'ideation-motion', gutter: 8 });
  rows.gutters[0].setAttribute('aria-label', 'la hauteur de la minuterie de motion');
  for (const ev of ['pointerdown', 'wheel', 'contextmenu', 'dblclick', 'dragover', 'drop']) root.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev === 'wheel' });

  // ── l'échelle de la scène ────────────────────────────────
  let k = 1, ox = 0, oy = 0;
  function place() {
    const f = frames()[cur];
    if (!f) return;
    const W = stage.clientWidth, H = stage.clientHeight;
    k = Math.min((W - 48) / f.w, (H - 48) / f.h);
    ox = (W - f.w * k) / 2; oy = (H - f.h * k) / 2;
    for (const x of [fit, fitB]) { x.style.width = `${f.w}px`; x.style.height = `${f.h}px`; x.style.transform = `translate3d(${ox}px, ${oy}px, 0) scale(${k})`; }
    paintSplit(); paintSel();
  }
  new ResizeObserver(() => { if (on) place(); }).observe(stage);

  // ── rendre ───────────────────────────────────────────────
  const ctxFor = (board, tpl, preview, extra = {}) => {
    const style = styler(meta(), board, tpl, preview);
    return { board, items: S.items, style, tpl, preview, motionOf: motionFor(tpl), count: frames().length, href, labelOf: app.label, name: board.name, fonts: meta()?.fonts || [], ...extra };
  };
  const sceneFor = (board, i, { live = true, tpl = tplNow(), preview = !!trying } = {}) => {
    const f = board.nodes.find((n) => n.id === frames()[i].id);
    return buildScene({ ...ctxFor(board, tpl, preview), frame: f, index: i, live });
  };
  async function paintStage({ replay = true, at = null } = {}) {
    const my = ++busy;
    run?.cancel(); if (scene) { releaseScene(scene); scene.el.remove(); }
    fitB.replaceChildren();
    const fs = frames();
    if (!fs.length) { scene = null; run = null; paintTimeline(); return; }
    cur = Math.max(0, Math.min(cur, fs.length - 1));
    place();
    scene = sceneFor(boardNow(), cur);
    fit.append(scene.el);
    if (assist) { const b = sceneFor(S.board, cur, { tpl: applied(), preview: false }); fitB.append(b.el); }
    await fontsReady(styler(meta(), boardNow(), tplNow(), !!trying), 1500);
    if (my !== busy || !on || !scene) return;
    run = createRun(scene, { reduced: reducedQ.matches });
    paintTimeline();
    paintSel();
    // l'inspecteur lit la scène (le nom d'un objet, le rôle de la diapositive) : il la suit, une fois refaite
    if (tab === 'objet' || tab === 'diapo') paintInsp();
    if (at !== null) { run.seek(at); paintHead(at); }
    else if (replay) playTl(0); else { run.seek(run.plan.total); paintHead(run.plan.total); }
  }
  function paintOutline() {
    const fs = frames();
    const b = boardNow();
    outline.replaceChildren(el('div', { class: 'pm-oh' }, el('span', { class: 'lbl' }, 'diapositives'), el('span', { class: 'lbl pm-n' }, String(fs.length))),
      ...fs.map((f, i) => {
        const box = el('div', { class: 'pm-mini' });
        const row = el('button', { class: 'pm-row' + (i === cur ? ' on' : ''), type: 'button', title: f.name || '', onclick: () => { cur = i; unsel(); paintOutline(); paintStage(); paintInsp(); } },
          el('span', { class: 'no' }, two(i + 1)), box, el('span', { class: 'nm' }, f.name || `Diapositive ${i + 1}`));
        const sc = sceneFor(b, i, { live: false });
        box.append(sc.el);
        sc.el.style.transform = `scale(${176 / f.w})`;
        return row;
      }),
      ...(fs.length ? [] : [el('p', { class: 'pm-empty' }, 'Aucune diapositive 16:9 ici. Le panneau Diapositives en fait (+ Diapositive), ou un modèle charge son exemple (à droite).')]));
  }

  // ── la sélection d'un objet sur la scène ─────────────────
  // Un clic choisit l'objet (l'onglet Objet, sa piste) et ne rejoue rien : la frise reste où elle
  // est (Cal, 06/10). Sur un texte, le clic y pose le curseur : on l'écrit sur place (plus bas).
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.pm-split')) return startSplit(e);
    if (ed && ed.txt.contains(e.target)) return;   // on écrit dans ce texte : le clic y déplace le curseur
    const o = e.target.closest('.pm-fit:not(.pm-before) .pm-o:not(.pm-dc)');
    choose(o ? o.dataset.id : null, e.shiftKey);
  });
  stage.addEventListener('click', (e) => {
    if (ed || e.button !== 0 || e.shiftKey) return;   // Maj + clic choisit plusieurs objets : rien ne s'écrit
    const o = e.target.closest('.pm-fit:not(.pm-before) .pm-o:not(.pm-dc)');
    if (o) startEdit(o.dataset.id, e.clientX, e.clientY);
  });
  // Choisir : un clic, cet objet seul ; Maj + clic, l'ajouter (ou le retirer) — la cascade décale les objets choisis
  function unsel() { sel = null; multi = new Set(); selKey = null; }
  function choose(id, add = false) {
    selKey = null;
    if (!add) { sel = id; multi = new Set(id ? [id] : []); }
    else if (id) {
      if (multi.has(id) && multi.size > 1) { multi.delete(id); if (sel === id) sel = [...multi].pop(); }
      else { multi.add(id); sel = id; }
    }
    paintSel(); paintInsp(sel ? 'objet' : null); paintTracks();
  }
  const extraBoxes = [];   // le cadre des autres objets choisis
  const boxOf = (b, id, f) => {
    const n = id && S.board?.nodes.find((x) => x.id === id);
    if (!n || !f) { b.hidden = true; return; }
    Object.assign(b.style, { left: `${ox + (n.x - f.x) * k}px`, top: `${oy + (n.y - f.y) * k}px`, width: `${n.w * k}px`, height: `${Math.max(12, (scene?.objs.find((o) => o.id === id)?.o.offsetHeight || n.h) * k)}px` });
    b.hidden = false;
  };
  function paintSel() {
    const f = frames()[cur];
    boxOf(selBox, sel, f);
    selBox.classList.toggle('ed', !!ed && ed.id === sel);
    const others = [...multi].filter((id) => id !== sel);
    while (extraBoxes.length < others.length) { const b = el('div', { class: 'pm-selbox multi', hidden: true }); stage.append(b); extraBoxes.push(b); }
    extraBoxes.forEach((b, i) => boxOf(b, others[i], f));
  }

  // ── écrire un texte sur la scène ─────────────────────────
  // Comme sur la planche (canvas.js, editText) : le texte devient éditable là où il est, dans
  // l'habit du modèle ; Échap, Ctrl+Entrée ou un clic ailleurs le posent, en un geste (app.mutate :
  // Ctrl+Z l'annule, la co-édition l'envoie). Pendant qu'on écrit, Ctrl+Z annule la frappe.
  // L'objet se montre dans son état final (ses animations au bout), pas la frise : la tête de
  // lecture ne bouge pas ; la lecture s'arrête (on n'écrit pas dans un texte qui bouge). Une
  // découpe (mot, lettre, compteur) est remise en texte simple le temps d'écrire ; la scène
  // se refait ensuite, au même instant.
  const WRITABLE = new Set(['title', 'note', 'sticky', 'shape']);
  let ed = null;   // { id, txt, t0 } : le texte qu'on écrit, l'instant de la frise où on l'a pris
  function startEdit(id, x, y) {
    if (assist) return false;   // la passe montre une copie : on écrit sur la planche, pas sur la proposition
    const n = S.board?.nodes.find((nn) => nn.id === id);
    const obj = scene?.objs.find((o) => o.id === id);
    const txt = obj && (obj.txt || (n?.type === 'shape' ? obj.c.querySelector('.pm-txt') : null));
    if (!n || !txt || !WRITABLE.has(n.type)) return false;
    if (playing) pauseTl();
    for (const a of obj.o.getAnimations({ subtree: true })) {
      const end = a.effect?.getComputedTiming().endTime;
      if (Number.isFinite(end)) { a.pause(); a.currentTime = end; }
    }
    txt.textContent = n.text || '';
    try { txt.contentEditable = 'plaintext-only'; } catch { txt.contentEditable = 'true'; }
    if (txt.contentEditable !== 'plaintext-only') txt.contentEditable = 'true';
    txt.spellcheck = false;
    txt.classList.add('pm-editing');
    ed = { id, txt, t0: tNow };
    txt.focus({ preventScroll: true });
    // le curseur là où l'on a cliqué (caretPositionFromPoint : Firefox, Chrome 128 ; caretRangeFromPoint : Chrome, Safari)
    const s = getSelection();
    const cp = document.caretPositionFromPoint?.(x, y);
    const cr = !cp && document.caretRangeFromPoint?.(x, y);
    if (cp && txt.contains(cp.offsetNode)) s.collapse(cp.offsetNode, cp.offset);
    else if (cr && txt.contains(cr.startContainer)) s.collapse(cr.startContainer, cr.startOffset);
    else { s.selectAllChildren(txt); s.collapseToEnd(); }
    txt.addEventListener('input', onEditInput);
    txt.addEventListener('paste', onEditPaste);
    txt.addEventListener('blur', () => endEdit(), { once: true });
    paintSel();
    return true;
  }
  const onEditInput = () => paintSel();
  const onEditPaste = (ev) => { if (ed?.txt.contentEditable === 'true') { ev.preventDefault(); document.execCommand('insertText', false, ev.clipboardData.getData('text/plain')); } };
  // le texte tel qu'écrit : innerText rendrait les capitales d'un text-transform (canvas.js, typed)
  const typed = (txt) => { const tt = txt.style.textTransform; txt.style.textTransform = 'none'; const t = txt.innerText; txt.style.textTransform = tt; return t.replace(/\n$/, ''); };
  function endEdit() {
    const E = ed;
    if (!E) return;
    ed = null;
    E.txt.removeEventListener('input', onEditInput);
    E.txt.removeEventListener('paste', onEditPaste);
    const text = typed(E.txt);
    E.txt.contentEditable = 'false';
    E.txt.classList.remove('pm-editing');
    if (document.activeElement === E.txt) E.txt.blur();
    paintSel();
    // la scène se refait au même instant (rien ne se rejoue), le texte écrit ou non
    keepAt = E.t0;
    const n = S.board?.nodes.find((x) => x.id === E.id);
    if (n && text !== (n.text || '')) app.mutate(() => { n.text = text; });
    else later();
  }
  // avant / après : la ligne qui partage la scène
  function paintSplit() {
    handle.hidden = !assist;
    fitB.hidden = !assist;
    if (!assist) { fit.style.clipPath = ''; return; }
    const f = frames()[cur];
    const xs = split * f.w;
    fit.style.clipPath = `inset(0 0 0 ${xs}px)`;
    fitB.style.clipPath = `inset(0 ${f.w - xs}px 0 0)`;
    handle.style.left = `${ox + xs * k}px`;
  }
  function startSplit(e) {
    e.preventDefault();
    const r = stage.getBoundingClientRect(), f = frames()[cur];
    const mv = (ev) => { split = Math.max(0.02, Math.min(0.98, (ev.clientX - r.left - ox) / (f.w * k))); paintSplit(); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }

  // ── la minuterie de motion ───────────────────────────────
  // LA tête de lecture du portail (commun/tete.js : le trait orange et son onglet, comme le Montage,
  // ODIO, le lecteur) ; sa règle, du dessin de LA règle (.sr-mk de tete.css) mais en secondes : le
  // motion se règle à la milliseconde (l'onglet Objet écrit des ms), le timecode à l'image n'y dit rien.
  // Les boutons de lecture sont ceux du lecteur du portail (commun/lecteur.css : Lecture, la boucle,
  // le temps, l'état), centrés sous la scène.
  let playing = false, loop = false, tNow = 0;
  function playTl(t = 0) {
    if (!run) return;
    run.playFrom(t);
    playing = true;
    cancelAnimationFrame(tick);
    const step = () => {
      if (!on || !run) return;
      const tt = run.time();
      paintHead(tt);
      if (tt >= run.plan.total - 1 || !run.running()) {
        if (loop && run.plan.total > 0) { run.playFrom(0); tick = requestAnimationFrame(step); return; }
        playing = false; paintPlay(); paintHead(run.plan.total); return;
      }
      tick = requestAnimationFrame(step);
    };
    tick = requestAnimationFrame(step);
    paintPlay();
  }
  function pauseTl() { run?.pause(); playing = false; cancelAnimationFrame(tick); paintPlay(); }
  // la lecture repart d'où est la tête ; au bout, du début (le lecteur du portail fait de même)
  const toggleTl = () => (playing ? pauseTl() : playTl(run && tNow < run.plan.total - 5 ? tNow : 0));
  const goTl = (t) => { if (!run) return; pauseTl(); run.seek(t); paintHead(t); };
  const IC = {
    debut: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14"/><path d="M18 6v12l-9-6z"/></svg>',
    fin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14"/><path d="M6 6v12l9-6z"/></svg>',
  };
  const playB = el('button', { class: 'tb sm sr-lect-lire', type: 'button', onclick: () => toggleTl() }, 'Lecture');
  const loopB = el('button', { class: 'tb ghost sm sr-lect-ic', type: 'button', html: ICON.boucle, 'aria-pressed': 'false', title: 'boucle : rejouer la diapositive sans fin',
    onclick: () => { loop = !loop; loopB.classList.toggle('on', loop); loopB.setAttribute('aria-pressed', String(loop)); } });
  const nowB = el('b', {}, sec(0));
  const durS = el('small', {}, '/ 0.00 s');
  const frS = el('small', { class: 'pm-fr', title: `le numéro de l’image à ${FPS} images par seconde (Maj + ← → : image par image)` }, `· i 0`);
  const etatS = el('span', { class: 'lbl sr-lect-etat' }, 'arrêt');
  const transport = el('div', { class: 'sr-lect-barre pm-transport', role: 'toolbar', 'aria-label': 'lecture du motion' },
    el('span', { class: 'pm-tp-l' }, el('span', { class: 'timecode sr-lect-tc' }, nowB, durS, frS), etatS),
    el('span', { class: 'pm-tp-c' },
      el('button', { class: 'tb ghost sm sr-lect-ic', type: 'button', html: IC.debut, title: 'au début · Origine', onclick: () => goTl(0) }),
      playB,
      el('button', { class: 'tb ghost sm sr-lect-ic', type: 'button', html: IC.fin, title: 'l’état final : ce que montrent le PDF et prefers-reduced-motion · Fin', onclick: () => goTl(run?.plan.total || 0) })),
    el('span', { class: 'pm-tp-r' }, loopB));
  view.append(transport);
  const nTracks = el('span', { class: 'lbl pm-n' });
  const ruler = el('div', { class: 'pm-ruler', title: 'clic, glisser : la tête de lecture' });
  const lanes = el('div', { class: 'pm-lanes' });
  const head = tete({ z: 3 });
  const tlBody = el('div', { class: 'pm-tlb' }, ruler, lanes, head);
  const paintPlay = () => {
    playB.textContent = playing ? 'Pause' : 'Lecture';
    playB.classList.toggle('on', playing);
    playB.title = playing ? 'pause · Espace' : 'jouer les entrées · Espace';
    etatS.textContent = playing ? 'lecture' : run && tNow >= run.plan.total - 1 && run.plan.total > 0 ? 'fin' : 'arrêt';
  };
  let total = 1;
  const X = (t) => `${(t / total) * 100}%`;
  const at = (t) => `calc(var(--pm-lab) + (100% - var(--pm-lab)) * ${t / total})`;
  // la colonne des noms, la largeur des pistes (la règle a la même gouttière que les pistes : scrollbar-gutter)
  const geo = () => { const lab = parseFloat(getComputedStyle(tl).getPropertyValue('--pm-lab')) || 150; return { lab, W: Math.max(1, ruler.clientWidth - lab) }; };
  function paintHead(t) {
    tNow = t;
    const { lab, W } = geo();
    poser(head, Math.min(1, t / total) * W, { decal: lab });
    nowB.textContent = sec(t);
    durS.textContent = `/ ${sec(run?.plan.total || 0)} s`;
    frS.textContent = `· i ${Math.round((t * FPS) / 1000)}`;
    if (!playing) paintPlay();
    keyUi?.(t);   // l'onglet Objet : les valeurs à la tête, les ◆
  }
  // les graduations : une étiquette tous les 64 px au moins (de 0,1 s à 10 s), des demi-graduations au-delà de 120 px
  const PAS = [100, 250, 500, 1000, 2000, 5000, 10000];
  function paintRuler() {
    const plan = run?.plan;
    const { W } = geo();
    const pas = PAS.find((p) => (p / total) * W >= 64) || 20000;
    const out = [];
    for (let t = 0; t <= total; t += pas) {
      out.push(el('span', { class: 'sr-mk', style: { left: at(t) } }, `${+(t / 1000).toFixed(2)} s`));
      if ((pas / total) * W >= 120 && t + pas / 2 <= total) out.push(el('span', { class: 'sr-mk sub', style: { left: at(t + pas / 2) } }));
    }
    if (plan) for (let s = 1; s < plan.steps; s++) out.push(el('b', { class: 'pm-stepmark', style: { left: at(plan.offset[s]) }, title: `étape ${s + 1} : au clic` }, `clic ${s}`));
    ruler.replaceChildren(...out);
  }
  // les pistes : l'entrée (une barre, ses deux bords), un losange par instant où l'objet a une clé ;
  // sous l'objet choisi, une ligne par propriété animée et ses losanges (06/10)
  const objMo = (id) => scene?.all.find((o) => o.id === id)?.mo || null;
  function paintTimeline() {
    const plan = run?.plan;
    total = Math.max(1000, (plan?.total || 0) + 200);
    paintRuler();
    paintTracks();
    paintHead(run ? run.time() : 0);
    paintPlay();
  }
  function paintTracks() {
    const plan = run?.plan;
    const tracks = plan?.tracks || [];
    nTracks.textContent = tracks.length ? String(tracks.length) : '';
    const rows = [];
    for (const t of tracks) {
      const kids = [];
      if (t.bar) {
        const bar = el('div', { class: `pm-bar pm-k-${t.kind}` + (t.id === sel ? ' on' : ''), style: { left: X(t.bar.t0), width: X(Math.max(40, t.bar.t1 - t.bar.t0)) },
          title: `${t.fx}${t.by !== 'all' ? ` · par ${t.by}` : ''} · ${sec(t.bar.t0)} → ${sec(t.bar.t1)} s — glisser : le délai · bord gauche : le début · bord droit : la durée` },
        el('i', { class: 'pm-rz l', title: 'le début (la fin reste)' }), el('span', {}, `${t.fx}${t.units > 1 ? ` × ${t.units}` : ''}`), el('i', { class: 'pm-rz', title: 'la durée' }));
        bar.addEventListener('pointerdown', (e) => dragBar(e, t, bar));
        kids.push(bar);
      }
      for (const kk of t.keys) kids.push(diamond(t, null, kk.t, kk.at, kk.props));
      rows.push(el('div', { class: 'pm-lane' + (multi.has(t.id) ? ' on' : ''), 'data-id': t.id },
        el('button', { class: 'pm-lab', type: 'button', title: `${t.label} — Maj + clic : l’ajouter aux objets choisis`, onclick: (e) => choose(t.id.startsWith('decor:') ? null : t.id, e.shiftKey) },
          el('span', { class: 'lbl' }, PART_FR[scene?.all.find((o) => o.id === t.id)?.part] || t.kind), el('span', { class: 'tx' }, t.label)),
        el('div', { class: 'pm-track' }, ...kids)));
      if (t.id !== sel) continue;
      const mo = objMo(t.id);
      for (const P of KEY_PROPS) {
        const l = mo?.keys?.[P.id];
        if (!l?.length) continue;
        rows.push(el('div', { class: 'pm-lane pm-sub', 'data-id': t.id, 'data-prop': P.id },
          el('div', { class: 'pm-lab', title: P.tip }, el('span', { class: 'tx' }, P.label)),
          el('div', { class: 'pm-track' }, ...l.map((kk) => diamond(t, P.id, kk.t, plan.offset[t.step] + kk.t, [P.id], kk.p)))));
      }
    }
    lanes.replaceChildren(...rows, ...(tracks.length ? [] : [el('p', { class: 'pm-empty' }, tplNow()?.kind === 'statique' ? 'Un modèle statique : rien n’entre, tout est là. Un modèle motion, ou l’onglet Objet, donne des entrées.' : 'Aucune entrée ni image clé sur cette diapositive : choisissez un objet sur la scène, puis son entrée ou ses images clés (onglet Objet).')]));
  }
  // un losange : une clé (d'une propriété) ou toutes les clés de l'objet à cet instant (prop null)
  function diamond(t, prop, kt, at, props, p = null) {
    const on2 = !!selKey && t.id === sel && selKey.prop === prop && Math.abs(selKey.t - kt) < SAME;
    const what = prop ? KEY_PROP[prop].label : props.map((x) => KEY_PROP[x].label).join(', ');
    const d = el('i', { class: 'pm-kd' + (on2 ? ' on' : '') + (p ? ` p-${p}` : ''), style: { left: X(at) }, role: 'button', tabindex: 0, 'data-t': String(kt),
      title: `${what} · ${sec(at)} s${p ? ` · ${p === 'in' ? 'entrée' : 'sortie'} (préréglage)` : ''} — clic : y aller et la choisir · glisser : la déplacer dans le temps` });
    d.addEventListener('pointerdown', (e) => dragKey(e, t, prop, kt, d));
    return d;
  }
  // la règle : cliquer, glisser = la tête (le geste commun : capture du pointeur, aucun texte sélectionné)
  brancherRegle(ruler, {
    avant: () => !!run,
    temps: (x) => { const { lab, W } = geo(); const r = ruler.getBoundingClientRect(); return Math.max(0, Math.min(total, ((x - r.left - lab) / W) * total)); },
    aller: (t) => { run.seek(t); paintHead(t); },
    debut: () => pauseTl(),
  });
  // la place change (la poignée, la fenêtre) : la tête et les graduations suivent
  new ResizeObserver(() => { if (on) { paintRuler(); paintHead(tNow); } }).observe(tlBody);
  // glisser une barre : le délai ; son bord gauche : le début (la fin reste) ; son bord droit : la durée
  // (au pas de 50 ms) ; un geste = un pas d'annulation
  function dragBar(e, t, bar) {
    e.preventDefault();
    if (t.id.startsWith('decor:')) { toast('le décor appartient au modèle : il ne se règle pas ici'); return; }
    const n = S.board.nodes.find((x) => x.id === t.id);
    const obj = scene.objs.find((o) => o.id === t.id);
    if (!n || !obj?.mo) return;
    const edge = e.target.classList.contains('pm-rz') ? (e.target.classList.contains('l') ? 'l' : 'r') : null;
    const lanesW = bar.parentElement.getBoundingClientRect().width;
    const x0 = e.clientX, d0 = obj.mo.in.delay, u0 = obj.mo.in.dur, b0 = t.bar.t0, b1 = t.bar.t1;
    let dv = 0;
    const mv = (ev) => {
      dv = Math.round(((ev.clientX - x0) / lanesW) * total / 50) * 50;
      if (edge === 'l') dv = Math.max(-d0, Math.min(u0 - 50, dv));
      if (edge === 'r') bar.style.width = X(Math.max(40, b1 - b0 + dv));
      else if (edge === 'l') { bar.style.left = X(b0 + dv); bar.style.width = X(Math.max(40, b1 - b0 - dv)); }
      else bar.style.left = X(Math.max(0, b0 + dv));
    };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      if (!dv) return;
      setMotion(n, obj, (m) => {
        if (edge === 'r') m.in.dur = Math.max(50, u0 + dv);
        else if (edge === 'l') { m.in.delay = Math.max(0, d0 + dv); m.in.dur = Math.max(50, u0 - dv); }
        else m.in.delay = Math.max(0, d0 + dv);
      });
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  // glisser un losange : ses clés dans le temps (au pas de 10 ms, jamais avant le début de l'étape) ;
  // un clic (sans glisser) : la tête y va et la clé se choisit (sa courbe dans l'onglet Objet) ;
  // un glisser = un pas d'annulation ; la tête ne bouge pas
  function dragKey(e, t, prop, kt, d) {
    e.preventDefault(); e.stopPropagation();
    const n = S.board.nodes.find((x) => x.id === t.id);
    const obj = scene?.objs.find((o) => o.id === t.id);
    if (!n || !obj?.mo) return;
    const W = Math.max(1, d.parentElement.getBoundingClientRect().width);
    const off = run.plan.offset[t.step], x0 = e.clientX;
    let dv = 0, moved = false;
    d.setPointerCapture(e.pointerId);
    const tip = el('span', { class: 'pm-ktip' });
    const mv = (ev) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      dv = Math.max(-kt, Math.round((((ev.clientX - x0) / W) * total) / 10) * 10);
      d.style.left = X(off + kt + dv);
      d.classList.add('drag');
      tip.textContent = `${sec(off + kt + dv)} s`;
      tip.style.left = X(off + kt + dv);
      if (!tip.isConnected) d.parentElement.append(tip);
    };
    const up = () => {
      d.removeEventListener('pointermove', mv); d.removeEventListener('pointerup', up); d.removeEventListener('pointercancel', up);
      tip.remove();
      if (!moved) {
        if (sel !== t.id) { sel = t.id; multi = new Set([t.id]); paintSel(); }
        selKey = { prop, t: kt };
        goTl(off + kt);
        paintTracks(); paintInsp('objet');
        return;
      }
      if (!dv) { paintTracks(); return; }
      selKey = { prop, t: kt + dv };
      setMotion(n, obj, (m) => { m.keys = moveKeys(m.keys, prop, kt, dv); if (!m.keys) delete m.keys; }, { keys: true });
    };
    d.addEventListener('pointermove', mv); d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
  }
  tl.append(el('div', { class: 'pm-tlh' }, el('span', { class: 'lbl' }, 'motion'), nTracks, el('span', { class: 'sp' }),
    el('span', { class: 'pm-tlhint', title: 'Espace : lire · Origine, Fin · Maj + ← → : image par image · Maj + clic : choisir plusieurs objets (la cascade)' },
      'la règle : la tête · une barre : son délai, ses bords · un losange : y aller, le glisser · Maj + clic : plusieurs')), tlBody);

  // ── écrire le motion (le document) ───────────────────────
  const serial = (mo) => {
    const o = { in: { ...mo.in } };
    if (mo.out) o.out = { ...mo.out };
    if (mo.loop) o.loop = { ...mo.loop };
    if (mo.depth) o.depth = mo.depth;
    if (mo.step) o.step = mo.step;
    if (mo.keys) o.keys = JSON.parse(JSON.stringify(mo.keys));
    return o;
  };
  // `keys` : un geste sur les images clés — la scène se refait au même instant (on règle une clé là où
  // l'on regarde), et un objet sans motion n'y gagne pas d'entrée (le fondu par défaut des autres réglages)
  function setMotion(n, obj, fn, { keys = false, keep = keys } = {}) {
    if (assist) { toast('la passe assistée est ouverte : appliquez-la ou annulez-la d’abord'); return false; }
    const base = obj?.mo ? serial(obj.mo) : { in: { fx: keys ? 'none' : 'fade', dur: 800, delay: 0, ease: 'out-expo', by: 'all' } };
    if (keep) keepAt = tNow;
    app.mutate(() => { const m = JSON.parse(JSON.stringify(n.motion || base)); fn(m); n.motion = m; });
    return true;
  }
  function setFrame(f, patch) {
    if (assist) { toast('la passe assistée est ouverte : appliquez-la ou annulez-la d’abord'); return; }
    app.mutate(() => {
      const m = { ...(f.motion || {}), ...patch };
      for (const [kk, v] of Object.entries(m)) if (v === null || v === '') delete m[kk];
      if (Object.keys(m).length) f.motion = m; else delete f.motion;
      if (patch.trans && f.deck) f.deck = { ...f.deck, trans: legacyTrans(patch.trans) };
    });
  }

  // ── l'inspecteur ─────────────────────────────────────────
  let tab = 'modeles';
  const tabs = el('div', { class: 'seg pm-tabs' });
  const body = el('div', { class: 'pm-ib' });
  insp.append(tabs, body);
  const seg = (items, val, fn) => el('div', { class: 'seg pm-seg' }, ...items.map(([v, label]) => el('button', { class: 'tb' + (v === val ? ' on' : ''), type: 'button', onclick: () => fn(v) }, label)));
  const sel2 = (items, val, fn, label) => { const s = el('select', { class: 'fld', 'aria-label': label }, ...items.map(([v, l]) => el('option', { value: v, selected: v === val ? true : null }, l))); s.addEventListener('change', () => fn(s.value)); return s; };
  const num = (v, { min, max, step = 10, unit }, fn) => {
    const i = el('input', { class: 'fld', type: 'number', value: String(v), min, max, step, 'aria-label': unit });
    i.addEventListener('change', () => { const x = Number(i.value); if (Number.isFinite(x)) fn(Math.max(min, Math.min(max, x))); });
    return el('label', { class: 'pm-num' }, i, el('span', { class: 'lbl' }, unit));
  };
  const field = (label, ...kids) => el('div', { class: 'pm-f' }, el('span', { class: 'lbl' }, label), ...kids);
  // un réglage et son infobulle : ce qu'il change, en mots simples (la note du 06/10 : « tooltip on every non-obvious control »)
  const fieldT = (label, tip, ...kids) => el('div', { class: 'pm-f', title: tip }, el('span', { class: 'lbl' }, label), ...kids);
  const btn = (label, title, fn, cls = 'tb ghost sm') => el('button', { class: cls, type: 'button', title, 'aria-label': title, onclick: fn }, label);
  function paintInsp(force = null) {
    if (force) tab = force;
    if (assist) tab = 'passe';
    else if (tab === 'passe') tab = 'diapo';
    const T = [['modeles', 'Modèles'], ['diapo', 'Diapositive'], ['objet', 'Objet'], ...(assist ? [['passe', 'Passe']] : [])];
    keyUi = null;
    tabs.replaceChildren(...T.map(([v, l]) => el('button', { class: 'tb' + (tab === v ? ' on' : ''), type: 'button', disabled: assist && v !== 'passe' ? true : null,
      title: assist && v !== 'passe' ? 'la passe assistée est ouverte : Appliquer ou Annuler la passe' : null, onclick: () => { tab = v; paintInsp(); } }, l)));
    // (un réglage absent rend null : replaceChildren l'écrirait « null »)
    body.replaceChildren(...(tab === 'modeles' ? inspModeles() : tab === 'diapo' ? inspDiapo() : tab === 'objet' ? inspObjet() : inspPasse()).filter(Boolean));
  }
  // les modèles : une affiche par modèle (la première diapositive de son exemple, rendue en petit)
  let exItems = null;
  function posterOf(m) {
    const box = el('div', { class: 'pm-poster' });
    const ex = exampleNodes(m, [0, 0], (p) => `${p}x${Math.random().toString(36).slice(2, 8)}`);
    const B = { name: m.example.name, nodes: [...ex.frames, ...ex.nodes], links: [], pres: { template: m.id, styles: m.styles } };
    const f = ex.frames[0];
    const sc = buildScene({ board: B, frame: f, items: exItems || S.items, style: styler(meta(), B, m, true), tpl: m, motionOf: () => null, index: 0, count: ex.frames.length, live: false, href, name: m.example.name });
    sc.el.style.transform = `scale(${128 / 1920})`;
    box.append(sc.el);
    return box;
  }
  function inspModeles() {
    const ap = applied();
    const card = (m) => el('div', { class: 'pm-card' + (trying?.id === m.id ? ' try' : '') + (ap?.id === m.id ? ' ap' : ''), role: 'button', tabIndex: 0, 'data-tpl': m.id,
      title: `${m.name} — ${m.line}`, onclick: () => tryTpl(trying?.id === m.id ? null : m) },
    posterOf(m),
    el('div', { class: 'pm-ci' }, el('b', {}, m.name), el('span', { class: 'lbl' }, `${m.kind} · ${m.direction}`),
      el('span', { class: 'pm-sw' }, ...['bg', 'ink', 'accent', 'accent2'].map((kk) => el('i', { style: { background: m.palette[kk] } }))),
      el('small', {}, m.line),
      el('span', { class: 'pm-cops' },
        ap?.id === m.id ? el('span', { class: 'lbl pm-ap' }, 'appliqué') : null,
        el('button', { class: 'tb ghost sm', type: 'button', title: `ajoute les ${m.example.slides.length} diapositives de l’exemple à la planche (Ctrl+Z les retire)`, onclick: (e) => { e.stopPropagation(); loadExample(m); } }, 'Exemple'))));
    const group = (kind, label) => [el('div', { class: 'pm-gh lbl' }, label), el('div', { class: 'pm-cards' }, ...modeles.filter((m) => m.kind === kind).map(card))];
    return [el('p', { class: 'pm-hint' }, trying ? `Aperçu de ${trying.name} sur votre présentation : rien n’est écrit. La passe assistée l’applique (avant / après).` : 'Un clic : essayer un modèle sur votre présentation (aperçu). Exemple : ses diapositives sur la planche.'),
      ...group('motion', 'motion · 5'), ...group('statique', 'statiques · 5'),
      ap ? el('button', { class: 'tb ghost sm', type: 'button', title: 'la planche revient aux styles par défaut (Ctrl+Z)', onclick: () => { app.mutate((B) => applyTo(B, null)); } }, 'Retirer le modèle') : null];
  }
  function inspDiapo() {
    const f = frames()[cur];
    if (!f) return [el('p', { class: 'pm-hint' }, 'Aucune diapositive.')];
    const role = scene?.role || 'content';
    const tr = transFor(tplNow(), f, role);
    const hasPrev = cur > 0;
    return [el('div', { class: 'pm-h2' }, el('b', {}, f.name || 'Diapositive'), el('span', { class: 'lbl' }, `${two(cur + 1)} · ${ROLE_FR[role] || role}`)),
      field('transition d’arrivée', seg(TRANS, tr.kind, (v) => setFrame(f, { trans: v }))),
      fieldT('durée', 'le temps que dure la transition', num(tr.dur, { min: 0, max: 4000, step: 50, unit: 'ms' }, (v) => setFrame(f, { tdur: v }))),
      courbe(tr.ease, { label: 'courbe', tip: 'la façon dont la transition accélère et ralentit', onChange: (v) => setFrame(f, { ease: v }) }).el,
      el('button', { class: 'tb ghost sm', type: 'button', disabled: hasPrev ? null : true, title: hasPrev ? 'joue la transition depuis la précédente' : 'la première diapositive n’a pas de transition d’arrivée', onclick: () => previewTrans() }, 'Voir la transition'),
      field('fond', seg(BGS, f.motion?.bg || scene?.bgKey || 'bg', (v) => setFrame(f, { bg: v }))),
      field('avance seule', num(f.motion?.auto || 0, { min: 0, max: 120, step: 1, unit: 's après ses entrées (0 : au clic)' }, (v) => setFrame(f, { auto: v || null }))),
      f.motion ? el('button', { class: 'tb ghost sm', type: 'button', title: 'la diapositive reprend ce que le modèle donne à son rôle', onclick: () => app.mutate(() => { delete f.motion; }) }, 'Du modèle') : null];
  }
  function inspObjet() {
    const n = sel && S.board.nodes.find((x) => x.id === sel);
    const obj = n && scene?.objs.find((o) => o.id === sel);
    if (!n || !obj) return [el('p', { class: 'pm-hint' }, 'Cliquez un objet sur la scène (ou sa piste dans la minuterie) : son entrée, ses images clés, sa boucle, sa profondeur, sa sortie. Un texte s’écrit sur place, là où l’on clique. Maj + clic : choisir plusieurs objets (la cascade).')];
    const mo = obj.mo || { in: { fx: 'none', dur: 800, delay: 0, ease: 'out-expo', by: 'all', stagger: 60, dist: 60 }, depth: 0, step: 0 };
    const set = (fn) => setMotion(n, obj, fn);
    const txt = !!obj.txt;
    return [el('div', { class: 'pm-h2' }, el('b', {}, obj.label || n.type), el('span', { class: 'lbl' }, `${PART_FR[obj.part] || obj.part}${n.motion ? '' : ' · motion du modèle'}`)),
      fieldT('entrée', 'comment l’objet apparaît', sel2(FX_IN, mo.in.fx, (v) => set((m) => { m.in.fx = v; if (v === 'type') m.in.by = 'letter'; }), 'entrée')),
      txt ? fieldT('découpe', 'le texte entre d’un bloc, ligne par ligne, mot par mot ou lettre par lettre', seg(BY, mo.in.by, (v) => set((m) => { m.in.by = v; delete m.in.stagger; }))) : null,
      el('div', { class: 'pm-row2' }, fieldT('délai', 'le temps avant que l’entrée commence, depuis l’arrivée de la diapositive (ou le clic de son étape)', num(mo.in.delay, { min: 0, max: 20000, step: 50, unit: 'ms' }, (v) => set((m) => { m.in.delay = v; }))),
        fieldT('durée', 'le temps que dure l’entrée', num(mo.in.dur, { min: 0, max: 6000, step: 50, unit: 'ms' }, (v) => set((m) => { m.in.dur = v; })))),
      courbe(mo.in.ease, { label: 'courbe', tip: 'la façon dont l’entrée accélère et ralentit', onChange: (v) => set((m) => { m.in.ease = v; }) }).el,
      el('div', { class: 'pm-row2' }, fieldT('décalage', 'le temps entre deux lignes, mots ou lettres d’un texte découpé', num(mo.in.stagger, { min: 0, max: 1000, step: 5, unit: 'ms / unité' }, (v) => set((m) => { m.in.stagger = v; }))),
        fieldT('distance', 'le trajet des entrées qui glissent (monte, descend, glisse, bascule)', num(mo.in.dist, { min: 0, max: 600, step: 10, unit: 'px' }, (v) => set((m) => { m.in.dist = v; })))),
      fieldT('étape', '0 : l’objet entre à l’arrivée de la diapositive ; 1 à 9 : au clic suivant, dans cet ordre', num(mo.step || 0, { min: 0, max: 9, step: 1, unit: '0 : à l’arrivée' }, (v) => set((m) => { m.step = v; if (!v) delete m.step; }))),
      fieldT('boucle', 'un mouvement qui se répète après l’entrée, tant que la diapositive est là', sel2(LOOPS, mo.loop?.fx || 'none', (v) => set((m) => { if (v === 'none') delete m.loop; else m.loop = { fx: v, dur: m.loop?.dur || 9000, amp: m.loop?.amp || 24 }; }), 'boucle')),
      fieldT('profondeur', 'la parallaxe : un objet loin bouge peu, un objet près bouge plus, quand la souris bouge', (() => { const r = el('input', { type: 'range', min: -1, max: 1, step: 0.1, value: String(mo.depth || 0), 'aria-label': 'profondeur (parallaxe)' });
        r.addEventListener('change', () => set((m) => { m.depth = Number(r.value); if (!m.depth) delete m.depth; })); return el('div', { class: 'pm-range' }, r, el('span', { class: 'lbl' }, 'parallaxe : loin ← → près')); })()),
      fieldT('sortie', 'comment l’objet s’en va quand on passe à la diapositive suivante', sel2(FX_OUT, mo.out?.fx || 'none', (v) => set((m) => { if (v === 'none') delete m.out; else m.out = { fx: v, dur: 420, ease: 'in-out' }; }), 'sortie')),
      el('div', { class: 'pm-row2' },
        el('button', { class: 'tb ghost sm', type: 'button', title: 'rejoue la diapositive depuis l’entrée de cet objet', onclick: () => { const t = run?.plan.tracks.find((x) => x.id === sel); playTl(Math.max(0, (t?.t0 || 0) - 150)); } }, 'Rejouer'),
        n.motion ? el('button', { class: 'tb ghost sm', type: 'button', title: 'l’objet reprend le motion que le modèle donne à sa part', onclick: () => app.mutate(() => { delete n.motion; }) }, 'Du modèle') : null),
      ...inspCles(n, obj, mo), ...inspPresets(n, obj, mo), ...inspCascade()];
  }
  // ── les images clés de l'objet, à la tête de lecture (06/10) ─
  // Une ligne par propriété : sa valeur à la tête (la changer pose une clé là), ‹ ◆ › (la clé
  // précédente ; poser ou retirer la clé à la tête, à la valeur qui s'y voit ; la suivante). Puis la
  // courbe de la clé choisie (un clic sur un losange) ou de celle qui est sous la tête.
  function inspCles(n, obj, mo) {
    const off = run?.plan.offset[mo.step || 0] || 0;
    const lt = (t = tNow) => Math.max(0, t - off);
    const putKeys = (fn, keep = true) => setMotion(n, obj, (m) => { m.keys = fn(m.keys); if (!m.keys) delete m.keys; }, { keys: true, keep });
    const keysHere = (t) => KEY_PROPS.flatMap((P) => (mo.keys?.[P.id] || []).filter((x) => Math.abs(x.t - t) < SAME).map((x) => ({ ...x, prop: P.id })));
    const jump = (prop, dir) => {
      const t0 = lt(), l = mo.keys?.[prop] || [];
      const k = dir < 0 ? [...l].reverse().find((x) => x.t < t0 - SAME) : l.find((x) => x.t > t0 + SAME);
      if (k) { selKey = { prop, t: k.t }; goTl(off + k.t); paintTracks(); }
    };
    const rows = KEY_PROPS.map((P) => {
      const inp = el('input', { class: 'fld', type: 'number', step: P.step, 'aria-label': `${P.label} (${P.unit})`, title: `${P.tip} — changer la valeur pose une clé à la tête de lecture` });
      inp.addEventListener('change', () => { const v = Number(inp.value); if (Number.isFinite(v)) putKeys((K) => setKey(K, P.id, lt(), v / P.show)); });
      const prev = btn('‹', `${P.label} : la clé précédente`, () => jump(P.id, -1));
      const tog = btn('◆', `${P.label} : poser une clé à la tête`, () => putKeys((K) => toggleKey(K, P.id, lt())), 'tb ghost sm pm-kt');
      const next = btn('›', `${P.label} : la clé suivante`, () => jump(P.id, 1));
      return { P, inp, tog, prev, next, row: el('div', { class: 'pm-kp', title: P.tip }, el('span', { class: 'tx' }, P.label),
        el('label', { class: 'pm-num' }, inp, el('span', { class: 'lbl' }, P.unit)), el('span', { class: 'pm-kn' }, prev, tog, next)) };
    });
    const where = el('small', { class: 'pm-hint' });
    // la courbe : celle de la clé choisie, sinon des clés sous la tête
    const cbox = el('div', { class: 'pm-f' });
    let csig = null;
    const paintCurve = (t) => {
      const target = selKey ? { prop: selKey.prop, t: selKey.t } : keysHere(t).length ? { prop: null, t } : null;
      const sig = target ? `${target.prop}|${target.t}` : '';
      if (sig === csig) return;
      csig = sig;
      const ks = target ? keysHere(target.t).filter((x) => !target.prop || x.prop === target.prop) : [];
      if (!ks.length) {
        cbox.replaceChildren(el('span', { class: 'lbl' }, 'courbe de la clé'),
          el('p', { class: 'pm-hint' }, mo.keys ? 'Cliquez un losange de la minuterie, ou amenez la tête sur une clé : la courbe qui en part se règle ici.' : 'Posez une clé (◆) à la tête de lecture, puis une autre plus loin : l’objet ira de l’une à l’autre.'));
        return;
      }
      const label = target.prop ? KEY_PROP[target.prop].label : [...new Set(ks.map((x) => KEY_PROP[x.prop].label))].join(', ');
      // la courbe d'une clé est celle du chemin qui en part : la dernière d'une propriété n'en a pas
      const last = ks.every((x) => { const l = mo.keys[x.prop]; return l[l.length - 1].t === x.t; });
      cbox.replaceChildren(...[courbe(ks[0].e || 'linear', { label: `courbe · ${sec(off + target.t)} s`,
        tip: `le chemin de ${label} entre cette clé et la suivante`,
        onChange: (e) => putKeys((K) => setEaseAt(K, target.prop, target.t, e)) }).el,
      last ? el('p', { class: 'pm-hint' }, 'C’est la dernière clé : aucun chemin n’en part, sa courbe ne joue pas. Choisissez la clé d’avant.') : null].filter(Boolean));
    };
    keyUi = (t) => {
      const l0 = lt(t), v = keysAt(mo.keys, l0);
      for (const r of rows) {
        const l = mo.keys?.[r.P.id] || [];
        if (document.activeElement !== r.inp) r.inp.value = String(Math.round(v[r.P.id] * r.P.show * 10) / 10);
        const here = l.some((x) => Math.abs(x.t - l0) < SAME);
        r.tog.classList.toggle('on', here);
        r.tog.classList.toggle('some', !here && l.length > 0);
        r.tog.title = here ? `${r.P.label} : retirer la clé à la tête (${sec(t)} s)` : `${r.P.label} : poser une clé à la tête (${sec(t)} s), à la valeur qui s’y voit`;
        r.tog.setAttribute('aria-pressed', String(here));
        const before = l.some((x) => x.t < l0 - SAME), after = l.some((x) => x.t > l0 + SAME);
        r.prev.disabled = !before; r.next.disabled = !after;
        r.prev.title = before ? `${r.P.label} : la clé précédente` : `${r.P.label} : aucune clé avant la tête`;
        r.next.title = after ? `${r.P.label} : la clé suivante` : `${r.P.label} : aucune clé après la tête`;
      }
      where.textContent = `à la tête : ${sec(t)} s${mo.step ? ` · ${sec(l0)} s dans l’étape ${mo.step}` : ''} — changer une valeur y pose une clé`;
      paintCurve(l0);
    };
    keyUi(tNow);
    return [el('div', { class: 'pm-sec' }, el('span', { class: 'lbl' }, 'images clés'), where, ...rows.map((r) => r.row),
      mo.keys ? btn('Retirer les images clés', 'toutes les clés de cet objet (Ctrl+Z les rend)', () => putKeys(() => null, false)) : null, cbox)];
  }
  // ── les préréglages : ils fabriquent des images clés ordinaires (réappliquer remplace) ─
  function inspPresets(n, obj, mo) {
    const off = run?.plan.offset[mo.step || 0] || 0;
    const block = (side) => {
      const P = pre[side], inn = side === 'in';
      if (!inn && !P.touched) P.delay = Math.round(Math.max(0, tNow - off) / 10) * 10;
      const redo = () => paintInsp('objet');
      const dirs = PRESET_DIRS.map(([v, l]) => [v, inn ? l : l.replace('depuis', 'vers')]);
      const dist = P.kind === 'fade' ? null : fieldT(P.kind === 'scale' ? 'ampleur' : 'distance',
        P.kind === 'scale' ? 'de combien la taille change : 20 % = de 80 % à 100 %' : 'le trajet, en pixels de la scène',
        num(P.kind === 'scale' ? (P.sdist ?? 20) : P.dist, { min: 0, max: P.kind === 'scale' ? 100 : 2000, step: P.kind === 'scale' ? 5 : 10, unit: P.kind === 'scale' ? '%' : 'px' },
          (v) => { if (P.kind === 'scale') P.sdist = v; else P.dist = v; }));
      const go = () => {
        const o = { ...P, dist: P.kind === 'scale' ? (P.sdist ?? 20) : P.dist };
        if (setMotion(n, obj, (m) => { m.keys = presetKeys(m.keys, side, o); if (inn) m.in = { ...(m.in || {}), fx: 'none' }; }, { keys: true, keep: false })) {
          toast(`${inn ? 'entrée' : 'sortie'} posée : des images clés ordinaires (les losanges de la minuterie) · Ctrl+Z l’annule`, 4000);
        }
      };
      const had = hasPreset(mo.keys, side);
      return el('div', { class: 'pm-f' },
        el('span', { class: 'lbl' }, inn ? 'entrée par images clés' : 'sortie par images clés'),
        el('div', { class: 'seg pm-seg3' }, ...PRESET_KINDS.map(([v, l]) => el('button', { class: 'tb' + (P.kind === v ? ' on' : ''), type: 'button',
          title: { slide: inn ? 'l’objet arrive en glissant et apparaît' : 'l’objet part en glissant et disparaît', fade: inn ? 'l’objet apparaît sur place' : 'l’objet disparaît sur place', scale: inn ? 'l’objet grandit jusqu’à sa taille en apparaissant' : 'l’objet rapetisse en disparaissant' }[v],
          onclick: () => { P.kind = v; redo(); } }, l))),
        P.kind === 'slide' ? fieldT('direction', inn ? 'le côté d’où l’objet arrive' : 'le côté vers lequel l’objet part', sel2(dirs, P.dir, (v) => { P.dir = v; }, 'direction')) : null,
        el('div', { class: 'pm-row2' }, dist || el('span'),
          fieldT('courbe', 'la façon dont le mouvement accélère et ralentit', sel2(EASE_FR.map(([v, l]) => [v, l]), typeof P.ease === 'string' ? P.ease : 'out', (v) => { P.ease = v; }, 'courbe'))),
        el('div', { class: 'pm-row2' },
          fieldT('début', inn ? 'quand l’entrée commence, depuis l’arrivée de la diapositive' : 'quand la sortie commence (par défaut : la tête de lecture)', num(P.delay, { min: 0, max: 60000, step: 50, unit: 'ms' }, (v) => { P.delay = v; P.touched = true; })),
          fieldT('durée', 'le temps que dure le mouvement', num(P.dur, { min: 50, max: 10000, step: 50, unit: 'ms' }, (v) => { P.dur = v; }))),
        el('div', { class: 'pm-row2' },
          btn(inn ? (had ? 'Reposer l’entrée' : 'Poser l’entrée') : (had ? 'Reposer la sortie' : 'Poser la sortie'),
            `${had ? 'remplace les clés de ' : 'fabrique les clés de '}${inn ? 'l’entrée' : 'la sortie'} (ordinaires, modifiables) ; ${inn ? 'l’entrée par effet passe à « Aucune »' : 'les autres clés restent'} · Ctrl+Z l’annule`, go),
          had ? btn('Retirer', `retire les clés de ${inn ? 'l’entrée' : 'la sortie'} posées par ce préréglage (les autres restent)`, () => setMotion(n, obj, (m) => { m.keys = dropPreset(m.keys, side); if (!m.keys) delete m.keys; }, { keys: true, keep: false })) : el('span')));
    };
    return [el('div', { class: 'pm-sec' }, el('span', { class: 'lbl' }, 'préréglages'),
      el('p', { class: 'pm-hint' }, 'Ils fabriquent des images clés ordinaires : on les règle ensuite comme les autres. Les reposer remplace les leurs, et seulement elles.'),
      block('in'), block('out'))];
  }
  // ── la cascade : les objets choisis (Maj + clic), décalés l'un après l'autre ─
  function inspCascade() {
    const chosen = [...multi].filter((id) => scene?.objs.some((o) => o.id === id));
    const why = chosen.length < 2 ? 'choisissez au moins deux objets : Maj + clic sur la scène ou sur leurs pistes' : '';
    const goB = btn('Décaler en cascade', why || `chaque objet commence ${casc.interval} ms après le précédent, dans l’ordre choisi · Ctrl+Z l’annule`, () => doCascade());
    if (why) goB.setAttribute('aria-disabled', 'true');
    return [el('div', { class: 'pm-sec' }, el('span', { class: 'lbl' }, `cascade · ${chosen.length} objet${chosen.length > 1 ? 's' : ''}`),
      el('p', { class: 'pm-hint' }, why ? `Pour décaler plusieurs objets, ${why}.` : 'Le début de chacun (son entrée, ses images clés) se décale : le premier garde le sien, les suivants viennent l’un après l’autre.'),
      fieldT('ordre', 'avant : l’ordre de lecture (de haut en bas, de gauche à droite) ; arrière : l’inverse ; hasard semé : un ordre mélangé, le même pour la même graine',
        el('div', { class: 'seg pm-seg3' }, ...ORDERS.map(([v, l]) => el('button', { class: 'tb' + (casc.order === v ? ' on' : ''), type: 'button', onclick: () => { casc.order = v; paintInsp('objet'); } }, l)))),
      el('div', { class: 'pm-row2' },
        fieldT('intervalle', 'le temps entre le début d’un objet et celui du suivant', num(casc.interval, { min: 0, max: 5000, step: 10, unit: 'ms' }, (v) => { casc.interval = v; })),
        casc.order === 'random' ? fieldT('graine', 'le même nombre redonne le même ordre mélangé', num(casc.seed, { min: 1, max: 9999, step: 1, unit: '' }, (v) => { casc.seed = v; })) : el('span')),
      goB)];
  }
  function doCascade() {
    if (assist) { toast('la passe assistée est ouverte : appliquez-la ou annulez-la d’abord'); return; }
    const chosen = [...multi].map((id) => S.board.nodes.find((x) => x.id === id)).filter((x) => x && scene?.objs.some((o) => o.id === x.id));
    if (chosen.length < 2) { toast('la cascade : choisissez au moins deux objets (Maj + clic sur la scène ou sur leurs pistes)', 5000); return; }
    const items = readOrder(chosen).map((x) => ({ id: x.id, mo: scene.objs.find((o) => o.id === x.id)?.mo || null }));
    const shift = cascade(items, casc);
    const idle = items.filter((x) => !shift.has(x.id));
    if (!shift.size) { toast('la cascade : aucun des objets choisis n’a d’entrée ni d’image clé — rien à décaler', 5000); return; }
    app.mutate(() => {
      for (const [id, d] of shift) {
        const nn = S.board.nodes.find((x) => x.id === id), mo = items.find((x) => x.id === id).mo;
        const m = JSON.parse(JSON.stringify(nn.motion || serial(mo)));
        if (m.in && m.in.fx && m.in.fx !== 'none') m.in.delay = Math.max(0, (Number(m.in.delay) || 0) + d);
        if (m.keys) { m.keys = shiftKeys(m.keys, d); if (!m.keys) delete m.keys; }
        nn.motion = m;
      }
    });
    toast(`cascade : ${shift.size} objets, ${casc.interval} ms (${ORDERS.find(([v]) => v === casc.order)[1]})${idle.length ? ` · ${idle.length} sans entrée ni clé, laissé${idle.length > 1 ? 's' : ''}` : ''} · Ctrl+Z l’annule`, 5000);
  }
  function inspPasse() {
    const P = assist;
    return [el('div', { class: 'pm-h2' }, el('b', {}, 'Passe assistée'), el('span', { class: 'lbl' }, P.tpl.name)),
      el('p', { class: 'pm-hint' }, P.why),
      field('modèle', sel2(modeles.map((m) => [m.id, `${m.name} · ${m.kind}`]), P.tpl.id, (v) => startAssist(modeles.find((m) => m.id === v)), 'modèle')),
      el('p', { class: 'pm-hint' }, 'Avant à gauche, après à droite : glisser la ligne. Appliquer écrit tout en un geste (Ctrl+Z l’annule).'),
      ...P.report.map((r, i) => el('details', { class: 'pm-rep', open: i === cur ? true : null },
        el('summary', {}, el('span', { class: 'no' }, two(i + 1)), el('b', {}, r.name), el('span', { class: 'lbl' }, ROLE_FR[r.role] || r.role)),
        el('ul', {}, ...r.rules.map((x) => el('li', {}, x)))))];
  }

  // ── essayer, charger, appliquer ──────────────────────────
  function tryTpl(m) {
    trying = m && m.id !== applied()?.id ? m : null;
    paintAll();
  }
  async function loadExample(m) {
    const all = S.board.nodes;
    const x1 = all.length ? Math.max(...all.map((n) => n.x + n.w)) : 0;
    const y0 = all.length ? Math.min(...all.filter((n) => n.type === 'frame').map((n) => n.y).concat([0])) : 0;
    const ex = exampleNodes(m, [x1 + 600, y0], app.uid);
    await itemsFor(ex.items);
    const before = frames().length;
    app.mutate((B) => {
      const base = deckOf(B).seq.length;
      ex.frames.forEach((f, i) => { f.slide = base + i + 1; });
      B.nodes.unshift(...ex.frames);
      B.nodes.push(...ex.nodes);
      if (!B.pres?.template) applyTo(B, m);
    });
    trying = null;
    cur = before; unsel();
    toast(`${m.name} : ${ex.frames.length} diapositives ajoutées à la planche (Ctrl+Z les retire)${applied()?.id === m.id ? '' : ` · le modèle de la planche reste ${applied()?.name || 'aucun'}`}`, 6000);
    paintAll();
  }
  async function itemsFor(ids) {
    const want = ids.filter((id) => !S.items.has(id));
    if (!want.length) return;
    try {
      const r = await api('library/batch', { method: 'POST', body: { ids: want } });
      for (const it of r.items || []) S.items.set(it.id, it);
      for (const id of r.missing || []) S.items.set(id, { id, missing: true });
    } catch { for (const id of want) S.items.set(id, { id, missing: true }); }
  }
  async function startAssist(forced = null) {
    const fs = frames();
    if (!fs.length) { toast('la passe assistée demande des diapositives 16:9 : le panneau Diapositives en fait'); return; }
    const rec = recommend(S.board, fs, modeles);
    const tpl = forced || trying || applied() || modeles.find((m) => m.id === rec.id);
    const why = forced ? `${tpl.name}, choisi ici.` : trying ? `${tpl.name}, le modèle que vous essayiez.` : applied() ? `${tpl.name}, le modèle de la planche.` : `Proposé : ${rec.why}.`;
    const style = styler(meta(), S.board, tpl, true);
    await fontsReady(style, 2500);
    const P = propose({ board: S.board, frames: fs, tpl, style });
    assist = { ...P, why };
    trying = null;
    goB.textContent = 'Appliquer la passe';
    goB.title = 'écrit la proposition sur la planche, en un geste (Ctrl+Z l’annule)';
    cancelB.hidden = false;
    paintAll();
  }
  function stopAssist() {
    assist = null;
    goB.textContent = 'Passe assistée';
    goB.title = 'propose un modèle et un jeu d’animations cohérent : avant / après, puis Appliquer';
    cancelB.hidden = true;
    paintAll();
  }
  function applyAssist() {
    const P = assist;
    const ids = frames().map((f) => f.id);
    app.mutate((B) => applyProposal(B, P, ids));
    stopAssist();
    toast(`Passe appliquée : ${P.tpl.name} · Ctrl+Z l’annule`, 6000);
  }

  // ── lire, imprimer, la transition seule ──────────────────
  function play() {
    const fs = frames();
    if (!fs.length) { toast('rien à lire : aucune diapositive'); return; }
    pauseTl();
    player = createPlayer({ board: boardNow(), frames: fs.map((f) => boardNow().nodes.find((n) => n.id === f.id)), items: S.items, meta: meta(), tpl: tplNow(), preview: !!trying,
      href, labelOf: app.label, name: S.board.name, host: document.body,
      keys: (fn) => { let live = true; A.key(8, (e, c) => (live && !c.overlay ? fn(e) : false)); return () => { live = false; }; },
      fullscreen: permis() ? { toggle: () => basculer(), on: () => enPleinEcran() } : null,
      onexit: () => { player = null; if (enPleinEcran()) basculer(); paintStage({ replay: false }); } });
    if (permis() && !enPleinEcran()) basculer().catch?.(() => {});
    player.start(cur);
    A.player = player;
  }
  async function previewTrans() {
    const fs = frames();
    if (cur < 1 || !scene) return;
    pauseTl();
    const b = boardNow();
    const from = sceneFor(b, cur - 1);
    fit.replaceChildren(from.el);
    const to = sceneFor(b, cur);
    fit.append(to.el);
    const tr = transFor(tplNow(), b.nodes.find((n) => n.id === fs[cur].id), to.role);
    const pairs = tr.kind === 'morph' ? pairsOf(from, to) : [];
    for (const [, x] of pairs) x.mo = null;
    const r2 = createRun(to, { reduced: reducedQ.matches });
    const meter = frameMeter();
    setTimeout(() => r2.play(0), tr.dur * 0.4);
    await transit(pairs.length || tr.kind !== 'morph' ? tr.kind : 'fade', { fit, stage, from, to, dur: tr.dur, ease: tr.ease, pairs, others: [] });
    releaseScene(from);
    A.lastMeter = meter.stop();
    run?.cancel(); scene = to; run = r2;
    paintTimeline();
  }
  function printView() {
    if (!S.board) return;
    window.open(new URL(`./lecture.html?print#${S.board.id}`, import.meta.url).href, '_blank', 'noopener');
  }

  // ── entrer, sortir ───────────────────────────────────────
  function paintAll() {
    if (!on) return;
    titleB.textContent = S.board?.name || '';
    const t = tplNow();
    tplB.textContent = trying ? `aperçu : ${trying.name}` : t ? `modèle : ${t.name}` : 'sans modèle';
    tplB.classList.toggle('try', !!trying);
    banner.hidden = !trying && !assist;
    banner.textContent = assist ? `passe assistée · ${assist.tpl.name} — avant | après` : trying ? `aperçu · ${trying.name} — rien n’est écrit` : '';
    goB.disabled = frames().length ? null : true;
    goB.title = frames().length ? goB.title || 'propose un modèle et un jeu d’animations cohérent : avant / après, puis Appliquer' : 'aucune diapositive 16:9 : le panneau Diapositives en fait (+ Diapositive)';
    const t0 = keepAt;   // après un texte écrit : la scène refaite au même instant, rien ne se rejoue
    keepAt = null;
    paintOutline(); paintInsp(); paintStage(t0 !== null ? { at: t0 } : {}); paintSplit();
    exp.paint();   // ── export PDF ── ses raisons se lisent sur le plan (les polices de ses scènes)
  }
  // un texte qu'on écrit n'est jamais refait sous les doigts : la planche qui change (un geste, un
  // travail, la co-édition) attend qu'il soit posé (endEdit relance)
  let repaintT = 0, keepAt = null;
  const later = () => { clearTimeout(repaintT); repaintT = setTimeout(() => { if (on && !player && !ed) paintAll(); }, 120); };
  async function open(fromId) {
    if (!S.board) { toast('ouvrez d’abord une planche'); return false; }
    if (on) return true;
    if (!modeles.length) {
      try { modeles = await loadModeles(); } catch (e) { toast(`les modèles ne se lisent pas : ${e.message}`); }
      const ids = [...new Set(modeles.flatMap((m) => m.example.slides.flatMap((s) => (s.objects || []).filter((o) => o.type === 'media').map((o) => o.item))))];
      await itemsFor(ids);
      exItems = S.items;
    }
    on = true;
    const fs = frames();
    const at = fromId ? fs.findIndex((f) => f.id === fromId) : fs.findIndex((f) => S.sel.has(f.id));
    cur = Math.max(0, at);
    unsel(); trying = null; assist = null;
    root.hidden = false;
    document.body.classList.add('pm-on');
    subs = [app.on('commit', later), app.on('quiet', later), app.on('board', () => close())];
    tab = 'modeles';
    paintAll();
    exp.refresh();   // ── export PDF ── la machine du portail sait-elle imprimer ?
    app.emit('presentation:mode', true);
    return true;
  }
  function close() {
    if (!on) return;
    if (ed) endEdit();   // le texte en cours se pose avant de partir
    player?.stop();
    on = false;
    busy++;
    pauseTl();
    run?.cancel(); run = null;
    if (scene) { releaseScene(scene); scene.el.remove(); scene = null; }
    fitB.replaceChildren(); outline.replaceChildren();
    for (const u of subs) u?.();
    subs = [];
    assist = null; trying = null;
    root.hidden = true;
    document.body.classList.remove('pm-on');
    app.emit('presentation:mode', false);
  }
  // le clavier : tant que le mode est ouvert, la planche ne reçoit rien
  A.key(9, (e, c) => {
    if (!on || player) return false;
    if (c.overlay) return false;
    // on écrit un texte de la scène : les touches sont au texte (Ctrl+Z y annule la frappe) ; Échap, Ctrl+Entrée le posent
    if (ed && ed.txt.contains(e.target)) {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); endEdit(); }
      return true;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) app.redoStep(); else app.undoStep(); later(); return true; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); app.redoStep(); later(); return true; }
    if (c.typing) return false;
    const fs = frames();
    if (e.key === 'Escape') { e.preventDefault(); if (assist) stopAssist(); else if (trying) tryTpl(null); else close(); return true; }
    if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); goTl(Math.max(0, Math.min(run?.plan.total || 0, (Math.round((tNow * FPS) / 1000) + (e.key === 'ArrowRight' ? 1 : -1)) * (1000 / FPS)))); return true; }
    if (['ArrowDown', 'ArrowRight', 'PageDown'].includes(e.key)) { e.preventDefault(); if (cur < fs.length - 1) { cur++; unsel(); paintOutline(); paintStage(); paintInsp(); } return true; }
    if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); if (cur > 0) { cur--; unsel(); paintOutline(); paintStage(); paintInsp(); } return true; }
    if (e.key === ' ') { e.preventDefault(); toggleTl(); return true; }
    if (e.key === 'Home') { e.preventDefault(); goTl(0); return true; }
    if (e.key === 'End') { e.preventDefault(); goTl(run?.plan.total || 0); return true; }
    if (e.key === 'Enter' && mod) { e.preventDefault(); play(); return true; }
    return true;
  });
  const api2 = { open, close, get on() { return on; }, get cur() { return cur; }, set cur(v) { cur = v; paintAll(); }, get run() { return run; }, get scene() { return scene; },
    get assist() { return assist; }, get trying() { return trying; }, get modeles() { return modeles; }, tryTpl, startAssist, stopAssist, applyAssist, loadExample, play, previewTrans,
    select: (id, add = false) => choose(id, add), get multi() { return [...multi]; }, paintAll, get player() { return player; } };
  A.presentationMode = api2;
  return api2;
}
