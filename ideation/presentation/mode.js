// IDÉATION · PRÉSENTATION — le mode Présentation (docs/etudes/presentations.md § 10).
//
// Cal, 30/09 : « il ne faut pas alourdir l'interface principale : ce pourrait être un mode
// "expert", un mode particulier d'affichage : on fait la présentation, on cale tout, et on
// fait une passe assistée super cool pour rendre la présentation hyper belle ».
//
// Le mode est chargé seulement quand on y entre (diapo/ : le bouton du panneau Diapositives,
// la palette ⌘K) ; il a sa propre vue, posée par-dessus l'Idéation :
//   à gauche   le plan des diapositives (leurs scènes en petit, dans l'habit du modèle) ;
//   au centre  la scène de la diapositive choisie, qui joue ses entrées (clic : un objet) ;
//   dessous    la minuterie de motion : une piste par objet (son entrée, décalée, ses unités),
//              la tête de lecture qu'on glisse, une barre qu'on déplace (le délai) ou qu'on
//              étire (la durée) ;
//   à droite   Modèles (les dix, essayer, charger l'exemple), Diapositive (transition, durée,
//              courbe, fond, avance seule), Objet (entrée, découpe, délai, durée, courbe,
//              décalage, étape, boucle, profondeur, sortie).
// En haut : Lire (le lecteur plein écran), Imprimer / PDF, et la seule action orange : la passe
// assistée (avant / après, puis Appliquer). Tout ce qui change le document passe par
// app.mutate : Ctrl+Z l'annule, la co-édition l'envoie. Échap rend l'Idéation telle quelle :
// le mode ne touche ni la caméra, ni la sélection, ni la planche tant qu'on n'y change rien.

import { el, toast, href, api } from '../../commun/shell.js';
import { basculer, enPleinEcran, permis } from '../../commun/pleinecran.js';
import { atelier } from '../atelier/socle.js';
import { shownOf, deckOf, isSlide } from '../diapo/ordre.js';
import { buildScene, releaseScene, slideNodes, partOf, roleOf } from './scene.js';
import { createRun, frameMeter, EASE } from './moteur.js';
import { transit, pairsOf } from './transitions.js';
import { loadModeles, styler, fontsReady, motionFor, transFor, applyTo, exampleNodes, legacyTrans } from './modeles.js';
import { propose, recommend, applyProposal } from './assist.js';
import { createPlayer } from './lecteur.js';

const CSS = new URL('./presentation.css', import.meta.url).href;
export const FX_IN = [['none', 'Aucune'], ['fade', 'Fondu'], ['rise', 'Monte'], ['drop', 'Descend'], ['left', 'Glisse ←'], ['right', 'Glisse →'], ['scale', 'Échelle'],
  ['zoom', 'Zoom'], ['blur', 'Flou'], ['tilt', 'Bascule'], ['mask-up', 'Masque ↑'], ['mask-down', 'Masque ↓'], ['mask-left', 'Masque ←'], ['mask-right', 'Masque →'],
  ['reveal', 'Révélation'], ['draw', 'Dessin'], ['count', 'Compteur'], ['type', 'Machine à écrire']];
const FX_OUT = [['none', 'Aucune'], ['fade', 'Fondu'], ['sink', 'Tombe'], ['blur', 'Flou'], ['scale', 'Échelle'], ['mask-up', 'Masque ↑'], ['mask-left', 'Masque ←']];
const LOOPS = [['none', 'Aucune'], ['drift', 'Dérive'], ['float', 'Flotte'], ['pulse', 'Pulse'], ['spin', 'Tourne'], ['sway', 'Balance']];
const BY = [['all', 'Tout'], ['line', 'Ligne'], ['word', 'Mot'], ['letter', 'Lettre']];
export const TRANS = [['cut', 'Coupe'], ['fade', 'Fondu'], ['push', 'Poussée'], ['wipe', 'Volet'], ['curtain', 'Rideau'], ['zoom', 'Zoom'], ['morph', 'Morph'], ['toile', 'Toile']];
const EASES = [['out-expo', 'expo'], ['out-quint', 'quint'], ['standard', 'standard'], ['in-out', 'entrée-sortie'], ['in-out-expo', 'expo entrée-sortie'], ['back', 'rebond'], ['spring', 'ressort'], ['linear', 'linéaire']];
const BGS = [['bg', 'Fond'], ['surface', 'Surface'], ['ink', 'Encre'], ['accent', 'Accent'], ['accent2', 'Accent 2']];
const ROLE_FR = { title: 'titre', section: 'section', image: 'image', quote: 'citation', numbers: 'chiffres', grid: 'grille', content: 'contenu', end: 'fin' };
const PART_FR = { kicker: 'surtitre', title: 'titre', body: 'corps', caption: 'légende', figure: 'chiffre', quote: 'citation', image: 'image', hero: 'plein cadre', stroke: 'trait', shape: 'forme', other: 'objet', decor: 'décor' };
const two = (k) => String(k).padStart(2, '0');
const sec = (ms) => (ms / 1000).toFixed(2);

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
  const top = el('header', { class: 'pm-top' },
    el('span', { class: 'lbl' }, 'présentation'), titleB, tplB, el('span', { class: 'sp' }),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'lire la présentation en plein écran, depuis cette diapositive', onclick: () => play() }, 'Lire'),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'une page par diapositive, dans son état final : l’impression du navigateur en fait un PDF', onclick: () => printView() }, 'Imprimer / PDF'),
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
  const tl = el('footer', { class: 'pm-tl' });
  root.append(top, outline, view, insp, tl);
  document.body.append(root);
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
    return { board, items: S.items, style, tpl, preview, motionOf: motionFor(tpl), count: frames().length, href, labelOf: app.label, name: board.name, ...extra };
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
    if (at !== null) run.seek(at);
    else if (replay) playTl(0); else run.seek(run.plan.total);
  }
  function paintOutline() {
    const fs = frames();
    const b = boardNow();
    outline.replaceChildren(el('div', { class: 'pm-oh' }, el('span', { class: 'lbl' }, 'diapositives'), el('span', { class: 'lbl pm-n' }, String(fs.length))),
      ...fs.map((f, i) => {
        const box = el('div', { class: 'pm-mini' });
        const row = el('button', { class: 'pm-row' + (i === cur ? ' on' : ''), type: 'button', title: f.name || '', onclick: () => { cur = i; sel = null; paintOutline(); paintStage(); paintInsp(); } },
          el('span', { class: 'no' }, two(i + 1)), box, el('span', { class: 'nm' }, f.name || `Diapositive ${i + 1}`));
        const sc = sceneFor(b, i, { live: false });
        box.append(sc.el);
        sc.el.style.transform = `scale(${176 / f.w})`;
        return row;
      }),
      ...(fs.length ? [] : [el('p', { class: 'pm-empty' }, 'Aucune diapositive 16:9 ici. Le panneau Diapositives en fait (+ Diapositive), ou un modèle charge son exemple (à droite).')]));
  }

  // ── la sélection d'un objet sur la scène ─────────────────
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.pm-split')) return startSplit(e);
    const o = e.target.closest('.pm-fit:not(.pm-before) .pm-o:not(.pm-dc)');
    sel = o ? o.dataset.id : null;
    paintSel(); paintInsp(sel ? 'objet' : null);
    if (sel) { const tr = run?.plan.tracks.find((t) => t.id === sel); if (tr) playTl(Math.max(0, tr.t0 - 150)); }
  });
  function paintSel() {
    const n = sel && S.board?.nodes.find((x) => x.id === sel);
    const f = frames()[cur];
    if (!n || !f) { selBox.hidden = true; return; }
    Object.assign(selBox.style, { left: `${ox + (n.x - f.x) * k}px`, top: `${oy + (n.y - f.y) * k}px`, width: `${n.w * k}px`, height: `${Math.max(12, (scene?.objs.find((o) => o.id === sel)?.o.offsetHeight || n.h) * k)}px` });
    selBox.hidden = false;
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
  let playing = false;
  function playTl(t = 0) {
    if (!run) return;
    run.playFrom(t);
    playing = true;
    cancelAnimationFrame(tick);
    const step = () => {
      if (!on || !run) return;
      const tt = run.time();
      paintHead(tt);
      if (tt >= run.plan.total - 1 || !run.running()) { playing = false; paintPlay(); paintHead(run.plan.total); return; }
      tick = requestAnimationFrame(step);
    };
    tick = requestAnimationFrame(step);
    paintPlay();
  }
  function pauseTl() { run?.pause(); playing = false; cancelAnimationFrame(tick); paintPlay(); }
  const playB = el('button', { class: 'tb ghost sm pm-play', type: 'button', onclick: () => (playing ? pauseTl() : playTl(run && run.time() < run.plan.total - 5 ? run.time() : 0)) });
  const timeT = el('span', { class: 'pm-time' });
  const ruler = el('div', { class: 'pm-ruler' });
  const lanes = el('div', { class: 'pm-lanes' });
  const head = el('i', { class: 'pm-head' });
  const tlBody = el('div', { class: 'pm-tlb' }, ruler, lanes, head);
  const paintPlay = () => { playB.textContent = playing ? 'Pause' : 'Lire'; playB.title = playing ? 'arrêter · espace' : 'jouer les entrées · espace'; };
  let total = 1;
  const X = (t) => `${(t / total) * 100}%`;
  function paintHead(t) {
    head.style.left = `calc(var(--pm-lab) + (100% - var(--pm-lab)) * ${Math.min(1, t / total)})`;
    timeT.textContent = `${sec(t)} / ${sec(run?.plan.total || 0)} s`;
  }
  function paintTimeline() {
    const plan = run?.plan;
    total = Math.max(1000, (plan?.total || 0) + 200);
    ruler.replaceChildren();
    for (let t = 0; t <= total; t += 250) ruler.append(el('i', { class: t % 1000 ? '' : 'mj', style: { left: `calc(var(--pm-lab) + (100% - var(--pm-lab)) * ${t / total})` } }, t % 1000 ? null : el('span', {}, `${t / 1000}s`)));
    if (plan) for (let s = 1; s < plan.steps; s++) ruler.append(el('b', { class: 'pm-stepmark', style: { left: `calc(var(--pm-lab) + (100% - var(--pm-lab)) * ${plan.offset[s] / total})` }, title: `étape ${s + 1} : au clic` }, `clic ${s}`));
    const tracks = plan?.tracks || [];
    lanes.replaceChildren(...tracks.map((t) => {
      const bar = el('div', { class: `pm-bar pm-k-${t.kind}` + (t.id === sel ? ' on' : ''), style: { left: X(t.t0), width: X(Math.max(40, t.t1 - t.t0)) }, title: `${t.fx}${t.by !== 'all' ? ` · par ${t.by}` : ''} · ${sec(t.t0)} → ${sec(t.t1)} s` },
        el('span', {}, `${t.fx}${t.units > 1 ? ` × ${t.units}` : ''}`), el('i', { class: 'pm-rz', title: 'la durée' }));
      bar.addEventListener('pointerdown', (e) => dragBar(e, t, bar));
      return el('div', { class: 'pm-lane' + (t.id === sel ? ' on' : '') },
        el('button', { class: 'pm-lab', type: 'button', title: t.label, onclick: () => { sel = t.id.startsWith('decor:') ? null : t.id; paintSel(); paintInsp(sel ? 'objet' : null); paintTimeline(); } },
          el('span', { class: 'lbl' }, PART_FR[scene?.all.find((o) => o.id === t.id)?.part] || t.kind), el('span', { class: 'tx' }, t.label)),
        el('div', { class: 'pm-track' }, bar));
    }), ...(tracks.length ? [] : [el('p', { class: 'pm-empty' }, tplNow()?.kind === 'statique' ? 'Un modèle statique : rien n’entre, tout est là. Un modèle motion, ou l’onglet Objet, donne des entrées.' : 'Aucune entrée sur cette diapositive : choisissez un objet sur la scène, puis son entrée (onglet Objet).')]));
    paintHead(run ? run.time() : 0);
    paintPlay();
  }
  ruler.addEventListener('pointerdown', (e) => {
    if (!run) return;
    const r = ruler.getBoundingClientRect();
    const lab = parseFloat(getComputedStyle(tl).getPropertyValue('--pm-lab')) || 150;
    const at = (ev) => Math.max(0, Math.min(total, ((ev.clientX - r.left - lab) / Math.max(1, r.width - lab)) * total));
    pauseTl();
    run.seek(at(e)); paintHead(at(e));
    const mv = (ev) => { const t = at(ev); run.seek(t); paintHead(t); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
  // glisser une barre : le délai ; son bord droit : la durée (au pas de 50 ms) ; un geste = un pas d'annulation
  function dragBar(e, t, bar) {
    e.preventDefault();
    if (t.id.startsWith('decor:')) { toast('le décor appartient au modèle : il ne se règle pas ici'); return; }
    const n = S.board.nodes.find((x) => x.id === t.id);
    const obj = scene.objs.find((o) => o.id === t.id);
    if (!n || !obj?.mo) return;
    const resize = e.target.classList.contains('pm-rz');
    const lanesW = bar.parentElement.getBoundingClientRect().width;
    const x0 = e.clientX, d0 = obj.mo.in.delay, u0 = obj.mo.in.dur;
    let dv = 0;
    const mv = (ev) => {
      dv = Math.round(((ev.clientX - x0) / lanesW) * total / 50) * 50;
      if (resize) bar.style.width = X(Math.max(40, t.t1 - t.t0 + dv));
      else bar.style.left = X(Math.max(0, t.t0 + dv));
    };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      if (!dv) return;
      setMotion(n, obj, (m) => { if (resize) m.in.dur = Math.max(50, u0 + dv); else m.in.delay = Math.max(0, d0 + dv); });
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  tl.append(el('div', { class: 'pm-tlh' }, el('span', { class: 'lbl' }, 'motion'), playB, timeT, el('span', { class: 'sp' }),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'rejouer la diapositive depuis le début', onclick: () => playTl(0) }, 'Rejouer'),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'l’état final : ce que montrent le PDF et prefers-reduced-motion', onclick: () => { pauseTl(); run?.seek(run.plan.total); paintHead(run?.plan.total || 0); } }, 'État final')), tlBody);

  // ── écrire le motion (le document) ───────────────────────
  const serial = (mo) => {
    const o = { in: { ...mo.in } };
    if (mo.out) o.out = { ...mo.out };
    if (mo.loop) o.loop = { ...mo.loop };
    if (mo.depth) o.depth = mo.depth;
    if (mo.step) o.step = mo.step;
    return o;
  };
  function setMotion(n, obj, fn) {
    if (assist) { toast('la passe assistée est ouverte : appliquez-la ou annulez-la d’abord'); return; }
    const base = obj?.mo ? serial(obj.mo) : { in: { fx: 'fade', dur: 800, delay: 0, ease: 'out-expo', by: 'all' } };
    app.mutate(() => { const m = JSON.parse(JSON.stringify(n.motion || base)); fn(m); n.motion = m; });
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
  function paintInsp(force = null) {
    if (force) tab = force;
    if (assist) tab = 'passe';
    else if (tab === 'passe') tab = 'diapo';
    const T = [['modeles', 'Modèles'], ['diapo', 'Diapositive'], ['objet', 'Objet'], ...(assist ? [['passe', 'Passe']] : [])];
    tabs.replaceChildren(...T.map(([v, l]) => el('button', { class: 'tb' + (tab === v ? ' on' : ''), type: 'button', disabled: assist && v !== 'passe' ? true : null,
      title: assist && v !== 'passe' ? 'la passe assistée est ouverte : Appliquer ou Annuler la passe' : null, onclick: () => { tab = v; paintInsp(); } }, l)));
    body.replaceChildren(...(tab === 'modeles' ? inspModeles() : tab === 'diapo' ? inspDiapo() : tab === 'objet' ? inspObjet() : inspPasse()));
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
      el('div', { class: 'pm-row2' }, field('durée', num(tr.dur, { min: 0, max: 4000, step: 50, unit: 'ms' }, (v) => setFrame(f, { tdur: v }))),
        field('courbe', sel2(EASES, tr.ease, (v) => setFrame(f, { ease: v }), 'courbe'))),
      el('button', { class: 'tb ghost sm', type: 'button', disabled: hasPrev ? null : true, title: hasPrev ? 'joue la transition depuis la précédente' : 'la première diapositive n’a pas de transition d’arrivée', onclick: () => previewTrans() }, 'Voir la transition'),
      field('fond', seg(BGS, f.motion?.bg || scene?.bgKey || 'bg', (v) => setFrame(f, { bg: v }))),
      field('avance seule', num(f.motion?.auto || 0, { min: 0, max: 120, step: 1, unit: 's après ses entrées (0 : au clic)' }, (v) => setFrame(f, { auto: v || null }))),
      f.motion ? el('button', { class: 'tb ghost sm', type: 'button', title: 'la diapositive reprend ce que le modèle donne à son rôle', onclick: () => app.mutate(() => { delete f.motion; }) }, 'Du modèle') : null];
  }
  function inspObjet() {
    const n = sel && S.board.nodes.find((x) => x.id === sel);
    const obj = n && scene?.objs.find((o) => o.id === sel);
    if (!n || !obj) return [el('p', { class: 'pm-hint' }, 'Cliquez un objet sur la scène (ou sa piste dans la minuterie) : son entrée, sa boucle, sa profondeur, sa sortie.')];
    const mo = obj.mo || { in: { fx: 'none', dur: 800, delay: 0, ease: 'out-expo', by: 'all', stagger: 60, dist: 60 }, depth: 0, step: 0 };
    const set = (fn) => setMotion(n, obj, fn);
    const txt = !!obj.txt;
    return [el('div', { class: 'pm-h2' }, el('b', {}, obj.label || n.type), el('span', { class: 'lbl' }, `${PART_FR[obj.part] || obj.part}${n.motion ? '' : ' · motion du modèle'}`)),
      field('entrée', sel2(FX_IN, mo.in.fx, (v) => set((m) => { m.in.fx = v; if (v === 'type') m.in.by = 'letter'; }), 'entrée')),
      txt ? field('découpe', seg(BY, mo.in.by, (v) => set((m) => { m.in.by = v; delete m.in.stagger; }))) : null,
      el('div', { class: 'pm-row2' }, field('délai', num(mo.in.delay, { min: 0, max: 20000, step: 50, unit: 'ms' }, (v) => set((m) => { m.in.delay = v; }))),
        field('durée', num(mo.in.dur, { min: 0, max: 6000, step: 50, unit: 'ms' }, (v) => set((m) => { m.in.dur = v; })))),
      el('div', { class: 'pm-row2' }, field('courbe', sel2(EASES, mo.in.ease, (v) => set((m) => { m.in.ease = v; }), 'courbe')),
        field('décalage', num(mo.in.stagger, { min: 0, max: 1000, step: 5, unit: 'ms / unité' }, (v) => set((m) => { m.in.stagger = v; })))),
      el('div', { class: 'pm-row2' }, field('distance', num(mo.in.dist, { min: 0, max: 600, step: 10, unit: 'px' }, (v) => set((m) => { m.in.dist = v; }))),
        field('étape', num(mo.step || 0, { min: 0, max: 9, step: 1, unit: '0 : à l’arrivée' }, (v) => set((m) => { m.step = v; if (!v) delete m.step; })))),
      field('boucle', sel2(LOOPS, mo.loop?.fx || 'none', (v) => set((m) => { if (v === 'none') delete m.loop; else m.loop = { fx: v, dur: m.loop?.dur || 9000, amp: m.loop?.amp || 24 }; }), 'boucle')),
      field('profondeur', (() => { const r = el('input', { type: 'range', min: -1, max: 1, step: 0.1, value: String(mo.depth || 0), 'aria-label': 'profondeur (parallaxe)' });
        r.addEventListener('change', () => set((m) => { m.depth = Number(r.value); if (!m.depth) delete m.depth; })); return el('div', { class: 'pm-range' }, r, el('span', { class: 'lbl' }, 'parallaxe : loin ← → près')); })()),
      field('sortie', sel2(FX_OUT, mo.out?.fx || 'none', (v) => set((m) => { if (v === 'none') delete m.out; else m.out = { fx: v, dur: 420, ease: 'in-out' }; }), 'sortie')),
      el('div', { class: 'pm-row2' },
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { const t = run?.plan.tracks.find((x) => x.id === sel); playTl(Math.max(0, (t?.t0 || 0) - 150)); } }, 'Rejouer'),
        n.motion ? el('button', { class: 'tb ghost sm', type: 'button', title: 'l’objet reprend le motion que le modèle donne à sa part', onclick: () => app.mutate(() => { delete n.motion; }) }, 'Du modèle') : null)];
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
    cur = before; sel = null;
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
    paintOutline(); paintInsp(); paintStage(); paintSplit();
  }
  let repaintT = 0;
  const later = () => { clearTimeout(repaintT); repaintT = setTimeout(() => { if (on && !player) paintAll(); }, 120); };
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
    sel = null; trying = null; assist = null;
    root.hidden = false;
    document.body.classList.add('pm-on');
    subs = [app.on('commit', later), app.on('quiet', later), app.on('board', () => close())];
    tab = 'modeles';
    paintAll();
    app.emit('presentation:mode', true);
    return true;
  }
  function close() {
    if (!on) return;
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
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) app.redoStep(); else app.undoStep(); later(); return true; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); app.redoStep(); later(); return true; }
    if (c.typing) return false;
    const fs = frames();
    if (e.key === 'Escape') { e.preventDefault(); if (assist) stopAssist(); else if (trying) tryTpl(null); else close(); return true; }
    if (['ArrowDown', 'ArrowRight', 'PageDown'].includes(e.key)) { e.preventDefault(); if (cur < fs.length - 1) { cur++; sel = null; paintOutline(); paintStage(); paintInsp(); } return true; }
    if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); if (cur > 0) { cur--; sel = null; paintOutline(); paintStage(); paintInsp(); } return true; }
    if (e.key === ' ') { e.preventDefault(); if (playing) pauseTl(); else playTl(0); return true; }
    if (e.key === 'Enter' && mod) { e.preventDefault(); play(); return true; }
    return true;
  });
  const api2 = { open, close, get on() { return on; }, get cur() { return cur; }, set cur(v) { cur = v; paintAll(); }, get run() { return run; }, get scene() { return scene; },
    get assist() { return assist; }, get trying() { return trying; }, get modeles() { return modeles; }, tryTpl, startAssist, stopAssist, applyAssist, loadExample, play, previewTrans,
    select: (id) => { sel = id; paintSel(); paintInsp('objet'); paintTimeline(); }, paintAll, get player() { return player; } };
  A.presentationMode = api2;
  return api2;
}
