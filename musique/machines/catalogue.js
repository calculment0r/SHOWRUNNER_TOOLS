// LE CATALOGUE, LA LISTE RAPIDE, LE MENU D'UN CÂBLE — portés d'ODIO_01
// (components/Catalogue.tsx, Palette.tsx, CableMenu.tsx ; blocks/catalogue-entrees.ts).
//
//   - le CATALOGUE s'ouvre au double-clic sur le fond : une FENÊTRE centrée,
//     toutes ses rubriques à la fois, qui défile verticalement ; chaque entrée
//     a sa vignette (pour une machine, le plan RÉEL de ses sections), et son
//     détail au simple clic (ce qu'elle accepte, ce qu'elle rend, sa taille) ;
//     double-clic : poser au centre de la vue ; glisser : poser là où l'on
//     lâche (la vignette suit le curseur, la fenêtre s'efface le temps du
//     transport). La molette y défile et ne zoome pas le canvas.
//   - la LISTE RAPIDE s'ouvre là où un câble est lâché dans le vide : le bloc
//     choisi naît déjà branché ; sur un câble, restreinte au FLUX.
//   - le MENU D'UN CÂBLE (clic droit) : le passer en saut, ou y insérer un bloc.

import { MODULES, TRACK_KINDS, EFFECT_TYPES, SOURCES_OF } from '../modules.js';
import { menu } from '../ui.js';   // le menu commun du portail (commun/menu.js) : la liste rapide en est un
import { MACHINES, MACHINE_ENGINES } from './blocks/machines.js';
import { prisesDe } from './liens.js';
import { cellulesDe } from './tuiles.js';

const ORDRE = ['ENTREES', 'INSTRUMENTS', 'MACHINES', 'PLAYGROUND', 'EFFETS', 'FLUX', 'SORTIE'];
const NOM_SIGNAL = { audio: 'son', notes: 'notes', tempo: 'tempo', mod: 'modulation' };
const FLUX = ['volume', 'table'];
// la table de mix d'ODIO_01 (TASCAM Model 12) : chaque tranche y est un nœud à
// elle — pas encore portée (docs/etudes/musique_odio01.md)
const MACHINES_ABSENTES = new Set(['mix']);

/** Les entrées du catalogue (catalogue-entrees.ts), rangées par rubrique. */
export function entreesDuCatalogue() {
  const out = [];
  out.push({ type: 'bloc:clavier', name: 'CLAVIER', ref: 'clv-01 · des notes', kind: 'control', category: 'ENTREES', cells: cellulesDe('clavier', MODULES), notes: { in: false, out: true } });
  for (const [k, list] of Object.entries(SOURCES_OF)) {
    if (k === 'bus') continue;
    for (const t of list) out.push({ type: `piste:${k}:${t}`, name: (k === 'audio' ? 'AUDIO' : MODULES[t].name).toUpperCase(), ref: k === 'audio' ? 'clips, import, micro' : MODULES[t].kind,
      kind: 'instrument', category: 'INSTRUMENTS', cells: cellulesDe(t, MODULES), module: t, notes: { in: k !== 'audio', out: false } });
  }
  for (const m of MACHINES) {
    if (MACHINES_ABSENTES.has(m.id)) continue;
    const eng = MACHINE_ENGINES[m.id];
    const emetNotes = eng?.voice === 'notes';
    out.push({ type: `machine:${m.id}`, name: m.name, ref: m.ref, kind: emetNotes || !eng?.voice ? 'control' : ['delay', 'reverb', 'comp'].includes(eng.voice) ? 'effect' : 'instrument',
      category: 'MACHINES', cells: { w: 0, h: 0 }, machine: m, notes: { in: eng?.notesIn === true, out: emetNotes }, audioOut: eng?.voice != null && !emetNotes });
  }
  for (const [t, def] of Object.entries(MODULES)) {
    if (!def.jouet) continue;
    out.push({ type: `jouet:${t}`, name: String(def.name || t).toUpperCase(), ref: def.kind || '', kind: def.role === 'effect' ? 'effect' : 'control', category: 'PLAYGROUND', cells: cellulesDe(t, MODULES), module: t });
  }
  for (const t of EFFECT_TYPES) out.push({ type: `effet:${t}`, name: MODULES[t].name.toUpperCase(), ref: MODULES[t].kind, kind: 'effect', category: FLUX.includes(t) ? 'FLUX' : 'EFFETS', cells: cellulesDe(t, MODULES), module: t });
  out.push({ type: 'bus:reverb', name: 'BUS D\'EFFETS', ref: 'retour de la console', kind: 'effect', category: 'SORTIE', cells: cellulesDe('bus', MODULES) });
  return out;
}

/** Ce qu'une entrée accepte et rend, en clair. */
function dire(e) {
  let pr;
  if (e.module) pr = prisesDe({ type: e.module }, MODULES);
  else if (e.machine) {
    const eng = MACHINE_ENGINES[e.machine.id];
    pr = eng?.voice === 'notes' ? { emet: ['notes'], accepte: ['tempo'] } : !eng?.voice ? { emet: [], accepte: [] }
      : ['delay', 'reverb', 'comp'].includes(eng.voice) ? { emet: ['audio'], accepte: ['audio', 'tempo'] } : { emet: ['audio'], accepte: ['notes', 'tempo'] };
  } else if (e.type === 'bloc:clavier') pr = { emet: ['notes'], accepte: ['tempo'] };
  else pr = { emet: ['audio'], accepte: ['audio'] };
  const liste = (g) => (g.length === 0 ? '—' : g.map((x) => NOM_SIGNAL[x] ?? x).join(' · '));
  return { entre: liste(pr.accepte), sort: liste(pr.emet) };
}

const ns = 'http://www.w3.org/2000/svg';
const svg = (w, hh) => { const s = document.createElementNS(ns, 'svg'); s.setAttribute('class', 'cat__vignette'); s.setAttribute('viewBox', `0 0 ${w} ${hh}`); s.setAttribute('preserveAspectRatio', 'xMidYMid meet'); return s; };
const sel = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
/** La vignette d'une machine : ses sections, à l'échelle, dans leur vraie place. */
export function planMachine(machine) {
  const s = svg(machine.w, machine.h);
  for (const x of machine.sections) s.append(sel('rect', { x: x.x + 1, y: x.y + 1, width: Math.max(1, x.w - 2), height: Math.max(1, x.h - 2) }));
  return s;
}
/** La silhouette d'un genre de bloc, pour ce qui n'a pas de planogramme. */
function silhouette(kind, cells, type) {
  const w = Math.max(1, cells.w), hh = Math.max(1, cells.h);
  const s = svg(w, hh);
  s.append(sel('rect', { x: 0.15, y: 0.15, width: w - 0.3, height: hh - 0.3 }));
  if (type === 'effet:table') {
    for (const part of [0.28, 0.5, 0.72]) {
      s.append(sel('path', { d: `M ${w * part} ${hh * 0.2} V ${hh * 0.82}` }));
      s.append(sel('rect', { x: w * part - w * 0.09, y: hh * (0.34 + (part === 0.5 ? 0.22 : part === 0.28 ? 0 : 0.34)), width: w * 0.18, height: hh * 0.09 }));
    }
    return s;
  }
  if (kind === 'instrument') s.append(sel('circle', { cx: w / 2, cy: hh / 2, r: Math.min(w, hh) / 3.4 }));
  if (kind === 'effect') s.append(sel('path', { d: `M ${w * 0.2} ${hh * 0.68} Q ${w / 2} ${hh * 0.16} ${w * 0.8} ${hh * 0.68}` }));
  if (kind === 'output') s.append(sel('path', { d: `M ${w * 0.3} ${hh * 0.3} L ${w * 0.7} ${hh / 2} L ${w * 0.3} ${hh * 0.7} Z` }));
  if (kind === 'control') { s.append(sel('path', { d: `M ${w * 0.22} ${hh * 0.62} H ${w * 0.78}` })); s.append(sel('path', { d: `M ${w * 0.22} ${hh * 0.38} H ${w * 0.58}` })); }
  return s;
}
const vignette = (e) => (e.machine ? planMachine(e.machine) : silhouette(e.kind, e.cells, e.type));
const div = (cls, text) => { const e = document.createElement('div'); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
// SHOWRUNNER (29/09, le thème du portail) : une entrée dit son nom comme le
// navigateur d'ODIO (.nv-it) — le module en bas de casse ; une machine garde
// le nom gravé sur sa façade (MINILOGUE XD) ; et sa teinte, un jeton
const nomLisible = (e) => (e.module && MODULES[e.module]?.name) || (e.type === 'bloc:clavier' ? 'Clavier' : e.type.startsWith('bus:') ? 'Bus d\'effets' : e.name);
const teinteDe = (e) => (e.module && MODULES[e.module]?.color) || (e.machine ? 'cy' : 'ink3');

/**
 * La fenêtre du catalogue. `onPick(type)` : poser au centre ; `onDrop(type,
 * {x, y})` : poser au point d'écran ; `onClose()`.
 */
export function ouvrirCatalogue({ onPick, onDrop, onClose }) {
  const entrees = entreesDuCatalogue();
  const voile = document.createElement('span');
  voile.className = 'palette__veil cat__voile';   // le voile d'une fenêtre du portail (.scrim)
  const fen = div('cat cat--fenetre');
  const fermer = () => { voile.remove(); fen.remove(); porte?.remove(); removeEventListener('keydown', echap, true); onClose?.(); };
  const echap = (e) => { if (e.key === 'Escape') { e.stopPropagation(); fermer(); } };
  addEventListener('keydown', echap, true);
  voile.addEventListener('pointerdown', fermer);
  voile.addEventListener('contextmenu', (e) => e.preventDefault());
  fen.addEventListener('pointerdown', (e) => e.stopPropagation());
  fen.addEventListener('dblclick', (e) => e.stopPropagation());
  const tete = div('cat__tete');
  const bx = document.createElement('button');
  bx.className = 'cat__fermer'; bx.type = 'button'; bx.title = 'Fermer'; bx.textContent = '×';
  bx.addEventListener('click', fermer);
  tete.append(div('cat__titre-fenetre', 'catalogue'), div('cat__aide', 'double-clic : poser au centre · glisser : poser où l\'on veut'), bx);
  const corps = div('cat__corps');
  corps.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  let detail = null, porte = null;
  for (const categorie of ORDRE) {
    const dedans = entrees.filter((e) => e.category === categorie);
    if (!dedans.length) continue;
    const sec = document.createElement('section');
    sec.className = 'cat__rubrique';
    const h2 = document.createElement('h2');
    h2.className = 'cat__titre';
    const s1 = document.createElement('span'); s1.textContent = categorie;
    const s2 = document.createElement('span'); s2.className = 'cat__compte'; s2.textContent = String(dedans.length);
    h2.append(s1, s2);
    const liste = div('cat__liste');
    for (const e of dedans) {
      const it = div('cat__item');
      it.title = 'Glisser sur le canvas pour le poser où l\'on veut · double-clic pour le poser au centre';
      const ligne = div('cat__ligne');
      ligne.append(vignette(e), div('cat__nom', nomLisible(e)), div('cat__ref', e.ref));
      it.style.setProperty('--k', `var(--${teinteDe(e)})`);
      it.append(ligne);
      it.addEventListener('click', () => {
        const ouvert = detail === e.type;
        for (const x of liste.parentElement.parentElement.querySelectorAll('.cat__detail')) x.remove();
        for (const x of fen.querySelectorAll('.cat__item--ouvert')) x.classList.remove('cat__item--ouvert');
        detail = ouvert ? null : e.type;
        if (ouvert) return;
        it.classList.add('cat__item--ouvert');
        const { entre, sort } = dire(e);
        const dl = document.createElement('dl');
        dl.className = 'cat__detail';
        const paire = (k, v) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); };
        paire('entre', entre); paire('sort', sort);
        paire('taille', e.machine ? `${Math.round(e.machine.w)} × ${Math.round(e.machine.h)} mm · ${e.machine.sections.length} sections` : `${e.cells.w} × ${e.cells.h}`);
        it.append(dl);
      });
      it.addEventListener('dblclick', () => { fermer(); onPick(e.type); });
      it.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        const x0 = ev.clientX, y0 = ev.clientY;
        let transporte = false;
        const bouge = (m) => {
          if (!transporte) {
            if (Math.hypot(m.clientX - x0, m.clientY - y0) < 5) return;
            transporte = true;
            fen.classList.add('cat--transport');
            porte = div('cat__porte');
            porte.append(vignette(e), div('cat__porte-nom', nomLisible(e)));
            document.body.append(porte);
          }
          porte.style.left = `${m.clientX}px`; porte.style.top = `${m.clientY}px`;
        };
        const lache = (u) => {
          removeEventListener('pointermove', bouge); removeEventListener('pointerup', lache);
          if (!transporte) return;
          porte?.remove(); porte = null;
          fermer();
          onDrop(e.type, { x: u.clientX, y: u.clientY });
        };
        addEventListener('pointermove', bouge); addEventListener('pointerup', lache);
      });
      liste.append(it);
    }
    sec.append(h2, liste);
    corps.append(sec);
  }
  fen.append(tete, corps);
  document.body.append(voile, fen);
  return { fermer };
}

/**
 * La liste rapide (Palette.tsx) — au point d'écran `at`, `only` : une rubrique.
 * SHOWRUNNER (29/09) : c'est le menu commun du portail (commun/menu.js, par
 * ui.js), comme la liste du nodal d'avant (« brancher après… », une entrée
 * par module : son nom, son genre, sa teinte) — il se retourne seul au bord de
 * la fenêtre, se ferme à Échap, se lit au clavier.
 */
export function ouvrirPalette({ at, only, onPick }) {
  const entrees = entreesDuCatalogue();
  const cats = ['ENTREES', 'INSTRUMENTS', 'EFFETS', 'FLUX', 'MACHINES', 'PLAYGROUND', 'SORTIE'].filter((c) => !only || c === only);
  const items = [];
  for (const c of cats) {
    const dedans = entrees.filter((e) => e.category === c);
    if (!dedans.length) continue;
    if (items.length) items.push('-');
    items.push({ head: c.toLowerCase() });
    for (const e of dedans) items.push({ label: nomLisible(e), sub: e.machine ? 'machine' : (MODULES[e.module]?.kind || e.ref || '').slice(0, 22), dot: teinteDe(e), onclick: () => onPick(e.type) });
  }
  const node = menu(at.x, at.y, items);
  return { fermer: () => node?.remove() };
}

/** Le menu d'un câble (CableMenu.tsx) : le premier item tombe sous le curseur. */
export function ouvrirMenuCable({ at, saut, onJump, onInsert, onClose }) {
  const voile = document.createElement('span');
  voile.className = 'palette__veil';
  const p = div('palette palette--menu');
  const fermer = () => { voile.remove(); p.remove(); onClose?.(); };
  voile.addEventListener('pointerdown', fermer);
  voile.addEventListener('contextmenu', (e) => e.preventDefault());
  p.addEventListener('pointerdown', (e) => e.stopPropagation());
  const item = (t, fn) => { const b = document.createElement('button'); b.className = 'palette__item'; b.type = 'button'; b.textContent = t; b.addEventListener('click', () => { fermer(); fn(); }); p.append(b); };
  item(saut ? 'REDESSINER LE FIL' : 'PASSER EN SAUT', onJump);
  item('INSÉRER UN BLOC DE FLUX', onInsert);
  p.style.left = `${at.x - 14}px`; p.style.top = `${at.y - 22 / 2 - 5}px`;
  document.body.append(voile, p);
  return { fermer };
}

export { TRACK_KINDS };
