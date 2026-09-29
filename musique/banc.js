// ODIO — LE BANC, sous le nodal : le même instrument déroulé dans le temps.
//
// Repris d'ODIO_01 (calculment0r/ODIO_01 @ 6d8a7ed) : la logique de
// apps/studio/src/banc/logique.ts et les gestes de Banc.tsx, qui tiennent
// les décisions n° 32 à 85 de docs/logique-globale.md. Rien n'est réinventé ;
// ce qui change est dit ici et dans PROVENANCE.md :
//   - le haut du banc est une image simplifiée de l'arrangement (les
//     sections, une rangée par piste et ses clips), à la même échelle que les
//     lanes d'ODIO_01 dessous — la demande de Cal du 29/09 ;
//   - la lane ÉNERGIE est l'arc d'énergie du projet (les mêmes points) ;
//   - la tête rouge (temps réel) est le transport de la DAW ; la verte
//     (écoute) est libre, comme dans ODIO_01 ;
//   - les « blocs » sont les cartes du nodal, et la table FACETTES dit ce
//     que chaque réglage de nos modules a de rythmique, d'harmonique, de
//     timbral — À RELIRE PAR CAL, comme celle d'ODIO_01 l'était par son
//     auteur (question ouverte n° 6) ;
//   - les couleurs d'ODIO_01 sont en dur dans son code ; ici elles passent
//     par des jetons existants (commun/tokens.css) : acier pour RYTHME, les
//     corail pour HARMONIE, TIMBRE, TENSION, le vert pour ÉNERGIE. L'ambre
//     et le vermillon restent exclus des facettes (n° 44).
// Les opérateurs sont une LECTURE de ce que l'attracteur ramènerait :
// ODIO_01 non plus ne les branche pas au moteur (« le chantier suivant »).
//
// Les gestes (ceux d'ODIO_01) :
//   banc     molette : zoom ancré au curseur · clic milieu glissé : déplacer
//            la vue · la barre des temps se tire : la hauteur du banc (n° 51, 70)
//   lane     glisser (sur RYTHME, HARMONIE, TIMBRE) : un segment, dormant
//            (n° 59) · son nom se tire : le déplacer, même d'une lane à
//            l'autre · son bord droit : sa longueur
//   segment  clic milieu tiré vers le haut, jusque sur le nodal : un
//            attracteur en naît (n° 60, 82) ; lâché dans le banc, ou Échap,
//            il n'a jamais existé · survol : le fil (n° 63, 83)
//   attracteur  le prendre : le déplacer (n° 77) · frôler un anneau : sa
//            poignée vient sous la souris, la tirer : son rayon et son angle
//            (n° 75, 76) · « loi » tirée à l'horizontale : la loi de
//            distance (n° 56) · Suppr : il disparaît, son segment redort (n° 84)
//   têtes    rouge : le temps réel ; verte : l'écoute · la bascule dit celle
//            qui gouverne (clic, ou touche « c ») · « marche » lance ou arrête
//            la tête qui gouverne, l'autre continue comme elle est (n° 80) ·
//            une tête s'attrape n'importe où sur son trait (n° 81)
//   courbes  aire pleine derrière la tête rouge, ligne et points devant ; un
//            point devant se tire à la verticale (n° 53)

import { toast } from '../commun/shell.js';
import { MODULES, spec, val, moduleName } from './modules.js';
import { songEnd, projEnd } from './moteur.js';
import { el, put, tok, clamp } from './ui.js';

/** Unités de plan par battement — l'échelle horizontale du banc (ODIO_01). */
const PPB = 9;
/** Le disque central d'un attracteur, en unités monde du canvas. */
const RAYON_DISQUE = 110;
/** Les anneaux, du plus serré au plus large. */
const RAYONS_ANNEAUX = [260, 420, 580];
const MARGE = 4;

// Les cinq lanes d'ODIO_01, leurs hauteurs et leurs écarts gardés ; y est
// compté depuis le haut des lanes (sous l'image de l'arrangement).
export const LANES = [
  { id: 'ryt', nom: 'RYTHME', couleur: 'cy', y: 0, h: 46, nature: 'matiere', facettes: ['swing', 'densité', 'accents'] },
  { id: 'har', nom: 'HARMONIE', couleur: 'coral-3', y: 52, h: 46, nature: 'matiere', facettes: ['tonalité', 'tension'] },
  { id: 'tim', nom: 'TIMBRE', couleur: 'coral-2', y: 104, h: 46, nature: 'matiere', facettes: ['matière', 'brillance'] },
  { id: 'nrj', nom: 'ÉNERGIE', couleur: 'grn2', y: 156, h: 40, nature: 'courbe', facettes: [] },
  { id: 'ten', nom: 'TENSION', couleur: 'coral-1', y: 202, h: 40, nature: 'courbe', facettes: [] },
];
// les teintes des anneaux, la couleur de la lane en tête (l'ordre de la
// réserve d'ODIO_01 : harmonie, énergie, timbre, tension, rythme)
const RESERVE = ['coral-3', 'grn2', 'coral-2', 'coral-1', 'cy'];
const teintesAnneaux = (lane) => [lane.couleur, ...RESERVE.filter((t) => t !== lane.couleur)];

// CE QUE CHAQUE RÉGLAGE A « DE RYTHMIQUE, D'HARMONIQUE, DE TIMBRAL »
// (n° 54, 66) : la déclaration décide, pas le type de module. Un réglage
// absent n'appartient à aucun thème (le volume, le panoramique…). Le partage
// suit celui d'ODIO_01 (hauteur → tonalité, modulation croisée → tension,
// coupure → brillance, résonance, saturation, forme → matière, accent →
// accents). ⚠ À RELIRE PAR CAL, réglage par réglage. Nos boîtes à rythme
// n'ont ni swing ni densité : RYTHME ne capte que l'accent de la basse acide.
export const FACETTES = {
  'synth.oct': 'tonalité', 'synth.oct2': 'tonalité', 'synth.det': 'tension', 'synth.cut': 'brillance',
  'synth.res': 'matière', 'synth.fenv': 'matière', 'synth.wave': 'matière',
  'analog.detune': 'tension', 'analog.cutoff': 'brillance', 'analog.resonance': 'matière', 'analog.envAmount': 'matière', 'analog.wave': 'matière',
  'acid.cutoff': 'brillance', 'acid.resonance': 'matière', 'acid.envMod': 'matière', 'acid.accent': 'accents',
  'plaits.timbre': 'brillance', 'plaits.harmo': 'matière', 'plaits.morph': 'matière', 'plaits.cutoff': 'brillance', 'plaits.resonance': 'matière',
  'sampler.root': 'tonalité',
  'rythme.drive': 'matière',
  'filtre.cutoff': 'brillance', 'filtre.reso': 'matière', 'filtre.drive': 'matière',
  'satura.drive': 'matière', 'crush.bits': 'matière', 'eq3.high': 'brillance',
};

// ── la géométrie et les opérateurs (logique.ts, tels quels) ──
/** Distance d'un point au bord d'une boîte — nulle dedans. */
export function ecartBoite(b, cx, cy) {
  const px = Math.max(b.x, Math.min(cx, b.x + b.w)), py = Math.max(b.y, Math.min(cy, b.y + b.h));
  return Math.hypot(cx - px, cy - py);
}
/** Le poids d'un bloc dans un anneau (n° 55-56) : 1 sous le centre, 0 au bord. */
export function poids(distance, rayon, loi) {
  if (rayon <= 0) return 0;
  return Math.pow(Math.max(0, Math.min(1, 1 - distance / rayon)), loi);
}
/** Ce que l'attracteur ramène : neutre + (valeur − neutre) × poids (n° 55). */
export function operateurs(atr, blocs) {
  const out = [];
  for (const an of atr.anneaux) {
    for (const b of blocs) {
      const d = ecartBoite(b.boite, atr.x, atr.y);
      if (d > an.r) continue;
      const w = poids(d, an.r, atr.loi);
      for (const p of b.parametres) {
        if (p.facette !== an.facette) continue;
        out.push({ blocId: b.id, blocNom: b.nom, facette: an.facette, couleur: an.couleur, label: p.label, valeur: p.valeur, w,
          op: p.def + (p.valeur - p.def) * w, unite: p.unit || '' });
      }
    }
  }
  return out.sort((a, b) => b.w - a.w);
}
const membres = (atr, an, blocs) => blocs.filter((b) => b.facettes.has(an.facette) && ecartBoite(b.boite, atr.x, atr.y) <= an.r);
/** Le temps décide s'il parle : la tête gouvernante traverse-t-elle le segment ? */
const actif = (seg, t) => seg.d <= t && t < seg.d + seg.l;
/** Une valeur, sobre, sans zéros de traîne (ecrire d'ODIO_01). */
function ecrire(v) {
  const a = Math.abs(v);
  const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}
// ne retire jamais une lettre : la plus longue forme qui tient, ou rien
let mctx = null;
function largeur(t) {
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  mctx.font = `9px ${tok('f-mono') || 'monospace'}`;
  return mctx.measureText(t).width;
}
const tient = (cands, place) => cands.find((t) => t && largeur(t) + MARGE <= place) || null;

let suite = 1;
const nid = (p) => `${p}${Date.now().toString(36).slice(-4)}${(suite++).toString(36)}`;

// createBench(app, nodal) — nodal : { cv, view() → {px, py, z}, box(id) → {x, y, w, h} }
export function createBench(app, nodal) {
  const { S } = app;
  const P = () => S.proj;
  // 360 px : les pistes en petit et les cinq lanes tiennent sans défiler (ODIO_01 : 240, sans les pistes)
  const U = () => (P().ui.banc = P().ui.banc || { h: 360, cam: { x: -30, y: -2, k: 1 } });
  const B = () => {
    const p = P();
    p.banc = p.banc || { segs: [], atts: [] };
    if (!p.banc.ten) {
      // la tension part plate, un point toutes les deux mesures, jusqu'au bout du morceau
      const end = Math.max(32, Math.ceil(projEnd(p) / 8) * 8);
      p.banc.ten = Array.from({ length: end / 8 + 1 }, (_, i) => [i * 8, 0.5]);
    }
    return p.banc;
  };
  const heads = { eco: 0, gouverne: 'reel', courtEco: false };
  let selection = null, survol = null, surAnneau = null, pose = null, dragging = false;
  let lastT = null, lastParle = '';

  const root = el('div', { class: 'bn', style: { height: `${U().h}px` } });
  const bar = el('div', { class: 'bn-bar', title: 'la barre des temps : la tirer règle la hauteur du banc' });
  const plan = el('div', { class: 'bn-plan' });
  root.append(bar, plan);
  const meta = el('div', { class: 'bn-meta' });
  nodal.cv.append(meta);
  const filSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  filSvg.setAttribute('class', 'bn-fil');
  const filPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  filSvg.append(filPath);
  const poseEl = el('div', { class: 'bn-pose' }, el('span', { class: 'bn-titre' }), el('span', { class: 'bn-centre bn-pose-disque' }));

  // ── projections du plan ──
  const cam = () => U().cam;
  const pxB = (t) => (t * PPB - cam().x) * cam().k;
  const pyB = (y) => (y - cam().y) * cam().k;
  const versTemps = (px) => (px / cam().k + cam().x) / PPB;
  const reel = () => app.pos();
  const gouvernant = () => (heads.gouverne === 'eco' ? heads.eco : reel());

  // ── la mise en page : l'arrangement simplifié, puis les lanes d'ODIO_01 ──
  function layout() {
    const tracks = P().tracks.filter((t) => t.kind !== 'bus');
    const rows = [];
    let y = 22;
    for (const t of tracks) { rows.push({ t, y, h: 12 }); y += 14; }
    const base = y + 8;
    return { rows, lanes: LANES.map((L) => ({ ...L, y: base + L.y })), secY: 4, secH: 14 };
  }
  const laneAt = (lanes, id) => lanes.find((L) => L.id === id);

  // ── les blocs : les cartes du nodal qui déclarent un thème ──
  function blocs() {
    const out = [];
    for (const m of P().modules) {
      const ps = (MODULES[m.type]?.params || []).map((s) => ({ s, f: FACETTES[`${m.type}.${s.k}`] })).filter((x) => x.f);
      if (!ps.length) continue;
      const boite = nodal.box(m.id);
      if (!boite) continue;
      const t = m.track && app.track(m.track);
      out.push({ id: m.id, nom: `${moduleName(m.type)}${t ? ` · ${t.name}` : ''}`, boite, facettes: new Set(ps.map((x) => x.f)),
        parametres: ps.map(({ s, f }) => ({ facette: f, label: s.label, def: s.def, unit: s.unit, valeur: val(m, s.k) })) });
    }
    return out;
  }

  // ── la barre des temps ──
  const tps = el('span', { class: 'bn-tps' });
  function paintBar() {
    const g = heads.gouverne;
    const courtG = g === 'reel' ? app.engine.running : heads.courtEco;
    put(bar,
      el('span', { class: 'bn-grip' }),
      el('span', { class: 'lbl' }, 'banc'),
      el('button', { class: `bn-tetes ${g}`, type: 'button', title: 'quelle tête gouverne — clic ou touche « c »',
        onpointerdown: (e) => e.stopPropagation(), onclick: toggleHeads }, g === 'reel' ? 'temps réel' : 'écoute'),
      el('button', { class: `bn-marche ${g}${courtG ? ' on' : ''}`, type: 'button', title: 'lance ou arrête la tête qui gouverne — l\'autre continue comme elle est (le temps réel est le transport de la DAW)',
        onpointerdown: (e) => e.stopPropagation(), onclick: marche }, courtG ? 'arrêt' : 'marche'),
      tps,
      el('span', { class: 'sp' }),
      el('span', { class: 'lbl bn-aide' }, 'glisser sur une lane : un segment · clic milieu tiré d\'un segment vers le haut : un attracteur'));
    paintTps();
  }
  function paintTps() {
    tps.textContent = `temps ${reel().toFixed(1)} ${app.engine.running ? '▸' : '■'} · écoute ${heads.eco.toFixed(1)} ${heads.courtEco ? '▸' : '■'} · gouverne ${gouvernant().toFixed(1)}`;
  }
  function toggleHeads() { heads.gouverne = heads.gouverne === 'reel' ? 'eco' : 'reel'; U().gouverne = heads.gouverne; app.saveUi(); paintBar(); renderPlan(); paintMeta(); }
  function marche() {
    if (heads.gouverne === 'reel') app.playStop();
    else { heads.courtEco = !heads.courtEco; lastT = null; }
    paintBar();
  }
  // la barre sert de poignée pour la hauteur du banc (n° 70)
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = U().h;
    const mv = (ev) => { U().h = clamp(h0 - (ev.clientY - y0), 120, innerHeight - 220); root.style.height = `${U().h}px`; renderPlan(); };
    const up = () => { bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); app.saveUi(); paintMeta(); };
    bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up);
  });

  // ── le plan ──
  function renderPlan() {
    const L = layout(), k = cam().k, W = plan.clientWidth || 800;
    const kids = [];
    // l'arrangement, simplifié : les sections, puis une rangée par piste
    for (const s of P().sections) {
      const x = pxB(s.a), w = (s.b - s.a) * PPB * k;
      if (x + w < 0 || x > W) continue;
      kids.push(el('div', { class: 'bn-sec', style: { left: `${x}px`, top: `${pyB(L.secY)}px`, width: `${Math.max(2, w - 1)}px`, height: `${L.secH * k}px`, '--c': `var(--${s.color || 'cy'})` } },
        k * L.secH >= 11 ? tient([s.name, s.name.slice(0, 3)], w - 6) || '' : ''));
    }
    for (const r of L.rows) {
      const y = pyB(r.y), h = r.h * k;
      kids.push(el('div', { class: 'bn-trk', style: { top: `${y}px`, height: `${h}px` } }));
      for (const c of P().clips.filter((x) => x.track === r.t.id)) {
        const x = pxB(c.start), w = c.len * PPB * k;
        if (x + w < 0 || x > W) continue;
        kids.push(el('i', { class: `bn-clip${c.mute ? ' muted' : ''}`, style: { left: `${x}px`, top: `${y + 1}px`, width: `${Math.max(2, w - 1)}px`, height: `${Math.max(2, h - 2)}px`, '--c': `var(--${r.t.color})` } }));
      }
      if (h >= 9) kids.push(el('span', { class: 'bn-trknom', style: { top: `${y}px`, height: `${h}px`, '--c': `var(--${r.t.color})` } }, tient([r.t.name, r.t.name.slice(0, 8)], 120) || ''));
    }
    // les lanes d'ODIO_01, leur horizon (n° 69) : jusqu'où le futur est
    // écrit — pour une courbe, son dernier point ; pour une lane de matière,
    // la fin de l'arrangement
    for (const lane of L.lanes) {
      const y = pyB(lane.y), h = lane.h * k;
      const hz = lane.id === 'nrj' ? lastPt(P().arc.pts) : lane.id === 'ten' ? lastPt(B().ten) : songEnd(P());
      const xh = pxB(hz);
      const ln = el('div', { class: 'bn-lane', 'data-lane': lane.id, style: { top: `${y}px`, height: `${h}px` } },
        xh < W ? el('div', { class: 'bn-hz', style: { left: `${Math.max(0, xh)}px`, '--c': `var(--${lane.couleur})` } },
          // l'étiquette ne passe pas sous le nom de la lane quand l'horizon est tout à gauche
          h >= 16 ? el('span', { style: { left: `${Math.max(5, 104 - Math.max(0, xh))}px` } }, tient([`horizon ${lane.nom.toLowerCase()}`, 'horizon', 'hz'], Math.max(0, W - xh - 10)) || '') : null) : null,
        lane.nature === 'matiere' && !B().segs.some((s) => s.lane === lane.id) && h >= 30 ? el('span', { class: 'bn-vide' }, 'glisser : un segment') : null);
      if (lane.nature === 'matiere') ln.addEventListener('pointerdown', (e) => tracerSegment(e, lane));
      kids.push(ln);
      if (h >= 15) kids.push(el('span', { class: 'bn-lanenom', style: { top: `${y}px`, '--c': `var(--${lane.couleur})` } }, el('i'), tient([lane.nom, lane.nom.slice(0, 3)], 92) || ''));
    }
    kids.push(curves(L, W));
    for (const s of B().segs) { const n = segmentEl(s, L, W); if (n) kids.push(n); }
    // l'avance de l'écoute sur le temps réel, les deux têtes
    const xr = pxB(reel()), xe = pxB(heads.eco);
    kids.push(el('div', { class: 'bn-avance', style: { left: `${Math.min(xr, xe)}px`, width: `${Math.abs(xe - xr)}px` } }));
    kids.push(cueEl('reel', xr), cueEl('eco', xe));
    put(plan, ...kids);
  }
  const lastPt = (pts) => (pts?.length ? pts[pts.length - 1][0] : 0);

  function cueEl(which, x) {
    const n = el('div', { class: `bn-cue ${which}`, 'data-cue': which, style: { left: `${x}px`, zIndex: heads.gouverne === which ? 31 : 30 } },
      el('span', { class: 'bn-cuez', title: which === 'reel' ? 'le temps réel — attrape-le n\'importe où sur son trait' : 'l\'écoute — attrape-la n\'importe où sur son trait' }));
    n.firstChild.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const r = plan.getBoundingClientRect();
      const poser = (ev) => {
        const t = Math.max(0, versTemps(ev.clientX - r.left));
        if (which === 'reel') app.engine.seek(t); else heads.eco = t;
        frame(true);
      };
      poser(e);
      n.firstChild.setPointerCapture(e.pointerId);
      const up = () => { n.firstChild.removeEventListener('pointermove', poser); n.firstChild.removeEventListener('pointerup', up); };
      n.firstChild.addEventListener('pointermove', poser); n.firstChild.addEventListener('pointerup', up);
    });
    return n;
  }

  // les courbes : aire pleine derrière la tête rouge, ligne à points devant
  function curves(L, W) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'bn-courbes');
    svg.setAttribute('width', W); svg.setAttribute('height', plan.clientHeight || 300);
    const k = cam().k, tr = reel();
    for (const lane of L.lanes.filter((x) => x.nature === 'courbe')) {
      const pts = lane.id === 'nrj' ? P().arc.pts : B().ten;
      if (!pts.length) continue;
      const y0 = pyB(lane.y), h = lane.h * k;
      const co = pts.map(([b, v], i) => ({ x: pxB(b), y: y0 + 4 * k + (1 - v) * (h - 10 * k), b, i }));
      const path = (list) => (list.length > 1 ? `M ${list.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')}` : '');
      const passe = co.filter((p) => p.b <= tr), futur = co.filter((p) => p.b >= tr);
      const col = tok(lane.couleur), bas = y0 + h - 3;
      const add = (d, attrs) => { if (!d) return; const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); for (const [a, v] of Object.entries(attrs)) p.setAttribute(a, v); svg.append(p); };
      if (passe.length > 1) add(`${path(passe)} L ${passe.at(-1).x.toFixed(1)} ${bas.toFixed(1)} L ${passe[0].x.toFixed(1)} ${bas.toFixed(1)} Z`, { fill: col, 'fill-opacity': 0.13, stroke: 'none' });
      add(path(passe), { stroke: col, 'stroke-width': 1.5, fill: 'none' });
      add(path(futur), { stroke: col, 'stroke-width': 1, fill: 'none', opacity: 0.55 });
      if (h < 22) continue;
      for (const p of futur) {
        if (p.x < -10 || p.x > W + 10) continue;
        const c = document.createElementNS(ns, 'circle');
        c.setAttribute('class', 'bn-pt'); c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', 3.5);
        c.setAttribute('stroke', col); c.setAttribute('stroke-width', 1.5);
        c.addEventListener('pointerdown', (e) => tirerPoint(e, lane, pts, p.i));
        svg.append(c);
      }
    }
    return svg;
  }
  function tirerPoint(e, lane, pts, i) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const r = plan.getBoundingClientRect();
    e.target.setPointerCapture(e.pointerId);
    const mv = (ev) => {
      const yPlan = (ev.clientY - r.top) / cam().k + cam().y;
      const L = laneAt(layout().lanes, lane.id);
      pts[i][1] = Math.round(clamp(1 - (yPlan - L.y - 4) / (L.h - 10), 0, 1) * 1000) / 1000;
      renderPlan();
    };
    const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); app.commit(lane.id === 'nrj' ? 'meta' : 'quiet'); };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  }

  // ── les segments ──
  function segmentEl(seg, L, W) {
    const lane = laneAt(L.lanes, seg.lane);
    if (!lane) return null;
    const k = cam().k;
    const atr = seg.atr && B().atts.find((a) => a.id === seg.atr);
    const parle = atr ? actif(seg, gouvernant()) : false;
    const x = pxB(seg.d), w = seg.l * PPB * k, y = pyB(lane.y + 3), h = (lane.h - 6) * k;
    // le contenu se recale sur la part visible (n° 52)
    const gx = Math.max(0, -x), vw = Math.min(w, W - x) - gx;
    const nom = vw >= 30 && h >= 14 ? tient([lane.nom, lane.nom.slice(0, 3)], vw - 10) : null;
    const lignes = [];
    if (atr && vw >= 120 && h >= 30) {
      let reste = h - 18;
      const bl = blocs();
      for (const o of operateurs(atr, bl)) {
        if (reste < 14) break;
        const valeur = ecrire(o.op), source = `${ecrire(o.valeur)}${o.unite} → `;
        let mis = null;
        for (const src of [source, '']) {
          const et = tient([`${o.blocNom} · ${o.label}`, o.label], vw - 12 - (src ? largeur(src) : 0) - largeur(valeur) - 10);
          if (et) { mis = { et, src }; break; }
        }
        if (!mis) continue;
        reste -= 14;
        lignes.push(el('div', { class: 'bn-op', style: { '--c': `var(--${o.couleur})` } }, el('span', {}, mis.et), mis.src ? el('u', {}, mis.src) : null, el('b', {}, valeur)));
      }
    }
    const dort = !atr && vw >= 60 && h >= 26 ? tient(['dormant', '·'], vw - 12) : null;
    const nomEl = el('div', { class: 'bn-segnom', style: { left: `${gx}px` }, title: 'tirer : déplacer le segment (même vers une autre lane)' }, nom || '');
    const rx = el('div', { class: 'bn-segrx', title: 'tirer : la longueur' });
    const box = el('div', { class: `bn-seg${atr ? ' lie' : ''}${parle ? ' parle' : ''}`, 'data-seg': seg.id,
      style: { left: `${x}px`, top: `${y}px`, width: `${Math.max(6, w)}px`, height: `${Math.max(8, h)}px`, '--c': `var(--${atr ? atr.couleur : lane.couleur})` },
      title: 'clic milieu tiré vers le haut : un attracteur en naît' },
    nomEl, el('div', { class: 'bn-segcorps', style: { left: `${gx}px`, width: `${Math.max(0, vw)}px` } }, lignes.length ? lignes : dort ? el('span', { class: 'bn-dort' }, dort) : null), rx);
    box.addEventListener('pointerdown', (e) => naitre(e, seg));
    box.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
    box.addEventListener('pointerenter', () => { if (seg.atr) { survol = seg.atr; paintFil(); } });
    box.addEventListener('pointerleave', () => { if (survol === seg.atr) { survol = null; paintFil(); } });
    nomEl.addEventListener('pointerdown', (e) => tirerSegment(e, seg));
    rx.addEventListener('pointerdown', (e) => etirerSegment(e, seg));
    return box;
  }

  function tracerSegment(e, lane) {
    if (e.button !== 0 || e.target.closest('.bn-seg, .bn-cuez, .bn-pt')) return;
    e.preventDefault(); e.stopPropagation();
    const r = plan.getBoundingClientRect(), x0 = e.clientX - r.left;
    const mq = el('div', { class: 'bn-marquee' });
    const L = laneAt(layout().lanes, lane.id);
    Object.assign(mq.style, { top: `${pyB(L.y)}px`, height: `${L.h * cam().k}px`, left: `${x0}px`, width: '0px' });
    plan.append(mq);
    const mv = (ev) => { const x1 = ev.clientX - r.left; mq.style.left = `${Math.min(x0, x1)}px`; mq.style.width = `${Math.abs(x1 - x0)}px`; };
    const up = (ev) => {
      removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true);
      mq.remove();
      const x1 = ev.clientX - r.left;
      if (Math.abs(x1 - x0) < 14) return;
      const d = Math.max(0, Math.round(versTemps(Math.min(x0, x1))));
      const l = Math.max(2, Math.round(Math.abs(x1 - x0) / (PPB * cam().k)));
      B().segs.push({ id: nid('g'), lane: lane.id, d, l });
      app.commit('quiet'); renderPlan();
    };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  }
  function tirerSegment(e, seg) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const r = plan.getBoundingClientRect(), x0 = e.clientX, d0 = seg.d;
    const mv = (ev) => {
      seg.d = Math.max(0, Math.round(d0 + (ev.clientX - x0) / (PPB * cam().k)));
      const yPlan = (ev.clientY - r.top) / cam().k + cam().y;
      const dessus = layout().lanes.find((L) => L.nature === 'matiere' && yPlan >= L.y && yPlan < L.y + L.h);
      if (dessus) seg.lane = dessus.id;
      renderPlan(); paintMeta();
    };
    const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); app.commit('quiet'); };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  }
  function etirerSegment(e, seg) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, l0 = seg.l;
    const mv = (ev) => { seg.l = Math.max(2, Math.round(l0 + (ev.clientX - x0) / (PPB * cam().k))); renderPlan(); paintMeta(); };
    const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); app.commit('quiet'); };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  }

  // ── la naissance (n° 60, 73, 82) ──
  // Clic milieu tiré depuis un segment : le disque paraît aussitôt sous la
  // souris, avec son fil ; les anneaux n'arrivent qu'en montant sur le
  // nodal. Lâché dans le banc, ou Échap : il n'a jamais existé. Tiré d'un
  // segment qui a déjà le sien : on le déplace (et il revient s'il retombe).
  function naitre(e, seg) {
    if (e.button !== 1) return;
    const lane = LANES.find((L) => L.id === seg.lane);
    if (!lane) return;
    e.preventDefault(); e.stopPropagation();
    const deja = seg.atr && B().atts.find((a) => a.id === seg.atr);
    const origine = deja ? { x: deja.x, y: deja.y } : null;
    let vif = deja?.id || null, cree = false, annule = false;
    const cadre = nodal.cv.getBoundingClientRect();
    const surCanvas = (g) => g.clientY < cadre.bottom && g.clientY >= cadre.top;
    const echap = (k) => { if (k.key === 'Escape') { annule = true; k.stopPropagation(); } };
    addEventListener('keydown', echap, true);
    const showPose = (g) => { pose = { x: g.clientX, y: g.clientY, nom: lane.nom, couleur: lane.couleur, seg: seg.id }; paintPose(); paintFil(); };
    showPose(e);
    survol = seg.atr || null;
    dragging = true;
    const mv = (g) => {
      if (annule) return;
      if (surCanvas(g)) {
        const v = nodal.view(), wx = (g.clientX - cadre.left - v.px) / v.z, wy = (g.clientY - cadre.top - v.py) / v.z;
        pose = null; paintPose();
        if (!vif) {
          const teintes = teintesAnneaux(lane);
          const n = { id: nid('a'), segment: seg.id, nom: lane.nom, couleur: lane.couleur, x: wx, y: wy, r: RAYON_DISQUE, loi: 1,
            anneaux: lane.facettes.map((f, i) => ({ facette: f, couleur: teintes[i % teintes.length], r: RAYONS_ANNEAUX[i] ?? RAYONS_ANNEAUX.at(-1) + i * 120, ang: -Math.PI / 2 })) };
          B().atts.push(n); seg.atr = n.id; vif = n.id; cree = true; selection = n.id; survol = n.id;
        } else {
          const a = B().atts.find((x) => x.id === vif);
          if (a) { a.x = wx; a.y = wy; }
        }
        paintMeta(); paintFil();
      } else {
        // redescendu dans le banc : ce qui venait de naître se défait
        if (cree && vif) { undoBirth(vif, seg); vif = null; cree = false; selection = null; }
        showPose(g);
        paintMeta();
      }
    };
    const up = (g) => {
      removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); removeEventListener('keydown', echap, true);
      dragging = false;
      pose = null; paintPose(); survol = null;
      const bonne = !annule && surCanvas(g);
      if (!bonne) {
        if (cree && vif) { undoBirth(vif, seg); selection = null; }
        else if (deja && origine) Object.assign(deja, origine);
      } else toast(cree ? `attracteur ${lane.nom} : il parle quand la tête qui gouverne traverse son segment` : 'attracteur déplacé', 3500);
      app.commit('quiet');
      renderPlan(); paintMeta(); paintFil();
    };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  }
  function undoBirth(id, seg) {
    B().atts = B().atts.filter((a) => a.id !== id);
    if (seg.atr === id) delete seg.atr;
  }
  function paintPose() {
    if (!pose) { poseEl.remove(); return; }
    if (!poseEl.isConnected) document.body.append(poseEl);
    const [t, d] = poseEl.children;
    t.textContent = pose.nom;
    t.style.left = `${pose.x - (largeur(pose.nom) + MARGE + 8) / 2}px`; t.style.top = `${pose.y - 34}px`;
    d.style.left = `${pose.x - 15}px`; d.style.top = `${pose.y - 15}px`;
    d.style.setProperty('--c', `var(--${pose.couleur})`);
  }

  // ── la couche méta, sur le nodal ──
  function paintMeta() {
    const v = nodal.view(), atts = B().atts;
    if (!atts.length) { put(meta); return; }
    const bl = blocs(), tg = gouvernant();
    const kids = [];
    // le choisi passe au-dessus des autres (n° 77)
    const order = [...atts].sort((a, b) => (a.id === selection) - (b.id === selection));
    for (const a of order) {
      const cx = v.px + a.x * v.z, cy = v.py + a.y * v.z, R = a.r * v.z;
      const seg = B().segs.find((s) => s.id === a.segment);
      const parle = seg ? actif(seg, tg) : false;
      const choisi = selection === a.id;
      const g = el('div', { class: `bn-atr${parle ? '' : ' off'}${choisi ? ' sel' : ''}` });
      const forces = a.anneaux.map((an) => {
        const dedans = membres(a, an, bl);
        const tot = dedans.reduce((s, b) => s + poids(ecartBoite(b.boite, a.x, a.y), an.r, a.loi), 0);
        return { an, dedans, compte: dedans.length, force: dedans.length ? tot / dedans.length : 0 };
      });
      // la teinte, derrière rien, à travers les blocs captés : du plus large au plus étroit (n° 44, 65, 85)
      if (parle || (dragging && choisi)) {
        for (const { an, dedans } of [...forces].reverse()) {
          for (const b of dedans) {
            const bx = v.px + b.boite.x * v.z, by = v.py + b.boite.y * v.z, rr = an.r * v.z;
            const w = poids(ecartBoite(b.boite, a.x, a.y), an.r, a.loi);
            kids.push(el('div', { class: 'bn-teinte', style: { left: `${bx}px`, top: `${by}px`, width: `${b.boite.w * v.z}px`, height: `${b.boite.h * v.z}px` } },
              el('i', { style: { left: `${cx - bx - rr}px`, top: `${cy - by - rr}px`, width: `${rr * 2}px`, height: `${rr * 2}px`, background: `var(--${an.couleur})`, opacity: (0.08 + 0.14 * w).toFixed(3) } })));
          }
        }
      }
      for (const { an, compte } of forces) {
        const rr = an.r * v.z;
        const vise = surAnneau && surAnneau.atr === a.id && surAnneau.facette === an.facette;
        const ang = vise ? surAnneau.ang : an.ang;
        g.append(el('span', { class: 'bn-anneau', style: { left: `${cx - rr}px`, top: `${cy - rr}px`, width: `${rr * 2}px`, height: `${rr * 2}px`, '--c': `var(--${an.couleur})` } }));
        if (vise || choisi) {
          const hx = cx + Math.cos(ang) * rr, hy = cy + Math.sin(ang) * rr;
          const et = `${an.facette} · ${compte}`, pl = largeur(et) + MARGE + 8;
          const h = el('span', { class: 'bn-poignee', style: { left: `${hx}px`, top: `${hy}px`, '--c': `var(--${an.couleur})` }, title: `${an.facette} : tirer — le rayon et l'angle` });
          h.addEventListener('pointerdown', (e) => tirerRayon(e, a, an.facette));
          g.append(h, el('span', { class: 'bn-etiquette', style: { left: `${hx + (Math.cos(ang) >= 0 ? 10 : -10 - pl)}px`, top: `${hy + (Math.sin(ang) >= 0 ? 4 : -17)}px`, '--c': `var(--${an.couleur})` } }, et));
        }
      }
      g.append(el('span', { class: 'bn-titre', style: { left: `${cx - (largeur(a.nom) + MARGE + 8) / 2}px`, top: `${cy - R - 16}px` } }, a.nom));
      // le centre est responsif (n° 72) : la plus grande taille qui tient
      const lignes = a.anneaux.length + 1 + (parle ? 0 : 1);
      const txt = forces.map(({ an, force }) => `${an.facette} ${force.toFixed(2)}`);
      const plusLarge = Math.max(1, ...txt.map(largeur));
      const corps = Math.max(8, Math.min(17, Math.floor((R * 1.42) / (lignes * 1.3)), Math.floor((9 * (R * 1.55 - MARGE)) / plusLarge)));
      const centre = el('span', { class: 'bn-centre', style: { left: `${cx - R}px`, top: `${cy - R}px`, width: `${R * 2}px`, height: `${R * 2}px`, fontSize: `${corps}px`, '--c': `var(--${a.couleur})` } },
        forces.map(({ an, force }) => { const t = tient([`${an.facette} ${force.toFixed(2)}`, force.toFixed(2)], R * 1.55); return t ? el('em', { style: { '--c': `var(--${an.couleur})` } }, t) : null; }));
      if (tient([`loi ×${a.loi.toFixed(2)}`, `×${a.loi.toFixed(2)}`], R * 1.55)) {
        const loi = el('em', { class: 'bn-loi', title: 'la loi de distance : tire à l\'horizontale' }, `loi ×${a.loi.toFixed(2)}`);
        loi.addEventListener('pointerdown', (e) => reglerLoi(e, a));
        centre.append(loi);
      }
      if (!parle && tient(['muet', '·'], R * 1.55)) centre.append(el('em', { class: 'bn-muet' }, 'muet'));
      centre.addEventListener('pointerdown', (e) => tirerAttracteur(e, a));
      centre.addEventListener('pointerenter', () => { survol = a.id; paintFil(); });
      centre.addEventListener('pointerleave', () => { if (survol === a.id) { survol = null; paintFil(); } });
      g.append(centre);
      kids.push(g);
    }
    put(meta, ...kids);
    paintFil();
  }

  function tirerAttracteur(e, a) {
    if (e.button !== 0 || e.target.classList.contains('bn-loi')) return;
    e.preventDefault(); e.stopPropagation();
    selection = a.id; dragging = true;
    const x0 = e.clientX, y0 = e.clientY, ax = a.x, ay = a.y, z = nodal.view().z;
    const mv = (ev) => { a.x = ax + (ev.clientX - x0) / z; a.y = ay + (ev.clientY - y0) / z; paintMeta(); };
    const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); dragging = false; app.commit('quiet'); paintMeta(); renderPlan(); };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
    paintMeta();
  }
  function tirerRayon(e, a, facette) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    selection = a.id;
    const cadre = nodal.cv.getBoundingClientRect();
    const mv = (ev) => {
      const v = nodal.view(), cx = v.px + a.x * v.z, cy = v.py + a.y * v.z;
      const dx = ev.clientX - cadre.left - cx, dy = ev.clientY - cadre.top - cy;
      const an = a.anneaux.find((x) => x.facette === facette);
      an.r = Math.max(a.r + 30, Math.hypot(dx, dy) / v.z);
      an.ang = Math.atan2(dy, dx);
      surAnneau = { atr: a.id, facette, ang: an.ang };
      paintMeta();
    };
    const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); surAnneau = null; app.commit('quiet'); paintMeta(); renderPlan(); };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  }
  function reglerLoi(e, a) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    selection = a.id;
    const x0 = e.clientX, l0 = a.loi;
    const mv = (ev) => { a.loi = clamp(l0 * Math.exp((ev.clientX - x0) / 130), 0.25, 4); paintMeta(); };
    const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); app.commit('quiet'); renderPlan(); };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  }

  // frôler un anneau sur le nodal : sa poignée vient sous la souris (n° 75)
  nodal.cv.addEventListener('pointermove', (e) => {
    if (e.buttons || !B().atts.length) return;
    const v = nodal.view(), r = nodal.cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    let trouve = null, mieux = 11;
    for (const a of B().atts) {
      const cx = v.px + a.x * v.z, cy = v.py + a.y * v.z, d = Math.hypot(mx - cx, my - cy);
      for (const an of a.anneaux) {
        const ec = Math.abs(d - an.r * v.z);
        if (ec < mieux) { mieux = ec; trouve = { atr: a.id, facette: an.facette, ang: Math.atan2(my - cy, mx - cx) }; }
      }
    }
    if (!surAnneau && !trouve) return;
    if (surAnneau && trouve && surAnneau.atr === trouve.atr && surAnneau.facette === trouve.facette && Math.abs(surAnneau.ang - trouve.ang) < 0.004) return;
    surAnneau = trouve;
    paintMeta();
  });
  nodal.cv.addEventListener('pointerleave', () => { if (surAnneau) { surAnneau = null; paintMeta(); } });
  // un clic sur le fond du nodal ne choisit plus d'attracteur
  nodal.cv.addEventListener('pointerdown', (e) => { if (!e.target.closest('.bn-centre, .bn-poignee') && selection) { selection = null; paintMeta(); } });

  // ── le fil (n° 63, 83) : du bas du cercle au haut du segment, tangentes verticales ──
  function paintFil() {
    let cible = null, x1, y1, couleur;
    if (pose) cible = B().segs.find((s) => s.id === pose.seg);
    else if (survol) { const a = B().atts.find((x) => x.id === survol); cible = a && B().segs.find((s) => s.id === a.segment); }
    const lane = cible && laneAt(layout().lanes, cible.lane);
    if (!cible || !lane || S.view !== 'nodal') { filSvg.remove(); return; }
    const cv = nodal.cv.getBoundingClientRect(), pr = plan.getBoundingClientRect(), v = nodal.view();
    if (pose) { x1 = pose.x; y1 = pose.y + 14; couleur = pose.couleur; } else {
      const a = B().atts.find((x) => x.id === survol);
      x1 = cv.left + v.px + a.x * v.z; y1 = cv.top + v.py + a.y * v.z + a.r * v.z + 2; couleur = a.couleur;
    }
    const x2 = Math.max(pr.left + 4, Math.min(pr.right - 4, pr.left + pxB(cible.d + cible.l / 2)));
    const y2 = Math.max(pr.top, pr.top + pyB(lane.y + 3));
    const sens = y2 >= y1 ? 1 : -1, amp = Math.max(34, Math.abs(y2 - y1) * 0.55);
    filPath.setAttribute('d', `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${(y1 + sens * amp).toFixed(1)}, ${x2.toFixed(1)} ${(y2 - sens * amp).toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`);
    filPath.style.stroke = `var(--${couleur})`;
    if (!filSvg.isConnected) document.body.append(filSvg);
  }

  // ── la caméra du banc : molette ancrée au curseur, clic milieu pour se déplacer (n° 51, 61) ──
  plan.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = plan.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, c = cam();
    const wx = mx / c.k + c.x, wy = my / c.k + c.y;
    const k = clamp(c.k * (e.deltaY > 0 ? 0.9 : 1.111), 0.25, 3);
    U().cam = { k, x: wx - mx / k, y: wy - my / k };
    renderPlan(); paintFil();
    clearTimeout(plan._t); plan._t = setTimeout(() => app.saveUi(), 400);
  }, { passive: false });
  plan.addEventListener('pointerdown', (e) => {
    if (e.button !== 1 || e.target.closest('.bn-seg')) return;
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY, c0 = { ...cam() };
    plan.setPointerCapture(e.pointerId);
    plan.classList.add('drag');
    const mv = (ev) => { U().cam = { ...c0, x: c0.x - (ev.clientX - x0) / c0.k, y: c0.y - (ev.clientY - y0) / c0.k }; renderPlan(); paintFil(); };
    const up = () => { plan.removeEventListener('pointermove', mv); plan.removeEventListener('pointerup', up); plan.classList.remove('drag'); app.saveUi(); };
    plan.addEventListener('pointermove', mv); plan.addEventListener('pointerup', up);
  });
  plan.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

  // ── clavier : « c » bascule les têtes, Suppr retire l'attracteur choisi (n° 71, 84) ──
  addEventListener('keydown', (e) => {
    if (S.view !== 'nodal' || !S.proj || e.target.closest?.('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyC' && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); toggleHeads(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
      e.preventDefault(); e.stopImmediatePropagation();
      const id = selection;
      B().atts = B().atts.filter((a) => a.id !== id);
      for (const s of B().segs) if (s.atr === id) delete s.atr;
      selection = null; if (survol === id) survol = null;
      app.commit('quiet'); renderPlan(); paintMeta();
    }
  }, true);

  // ── à chaque image ──
  function frame(force = false) {
    if (S.view !== 'nodal') return;
    const now = performance.now();
    if (heads.courtEco) {
      const dt = lastT ? ((now - lastT) / 1000) * (P().bpm / 60) : 0;
      const end = Math.max(16, projEnd(P()));
      heads.eco = heads.eco + dt >= end ? heads.eco + dt - end : heads.eco + dt;
    }
    lastT = now;
    if (frame.run !== app.engine.running) { frame.run = app.engine.running; paintBar(); }
    const tg = gouvernant();
    const parle = B().segs.filter((s) => s.atr && actif(s, tg)).map((s) => s.id).join(',');
    const moved = Math.abs((frame.r ?? -1) - reel()) > 0.2 || Math.abs((frame.e ?? -1) - heads.eco) > 0.05;
    if (force || parle !== lastParle || moved) {
      if (parle !== lastParle || force) { lastParle = parle; paintMeta(); }
      frame.r = reel(); frame.e = heads.eco;
      renderPlan();
    }
    paintTps();
  }

  function render() {
    heads.gouverne = U().gouverne === 'eco' ? 'eco' : 'reel';
    root.style.height = `${U().h}px`;
    paintBar();
    requestAnimationFrame(() => { renderPlan(); paintMeta(); });
  }
  function hide() { filSvg.remove(); poseEl.remove(); }

  return { el: root, render, frame, paintMeta, renderPlan, hide, state: () => ({ heads, selection }) };
}
