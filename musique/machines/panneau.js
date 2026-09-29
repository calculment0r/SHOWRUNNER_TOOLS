// LE PANNEAU D'UNE SECTION DE MACHINE — porté d'ODIO_01, apps/studio/src/components/MachinePanel.tsx
// (et Knob.tsx pour la molette), de React vers le DOM, sans rien changer à la
// règle : `planPanel` (blocks/machines.js, pur) rend des boîtes, le panneau
// les dessine et ne décide RIEN (docs/regle-du-responsif-machine.md d'ODIO_01).
//
//   - de près, la planche entière ; de loin, on RETIRE par la fin de l'ordre
//     de priorité et les survivants grandissent : ce qui reste à l'écran, ce
//     sont les molettes, les pads, les pas, les courbes — pas des titres ;
//   - le nom d'un contrôle est un bouton : cliquer l'EXPOSE (il passe en
//     tête du retrait) ; un nom qui ne tient plus tombe entier ;
//   - en ÉDITION (le poste de conception de la machine) : un glissé déplace un
//     élément, la poignée le dimensionne (par son centre s'il est seul), le
//     cadre en prend plusieurs, T optimise (tout le bloc) ou range (un
//     sous-ensemble), le clic milieu trace l'ordre d'importance. Tout s'écrit
//     en RETOUCHES de cotes (design/machines-config.js), jamais en mise en page.
//
// Ce qui change, et pourquoi : les couleurs passent par les jetons du portail
// (nodal.css) ; l'état des gabarits graphiques (pad orbital, matrice, courbe)
// vit dans une table de la session plutôt que dans l'état React du composant.

import { beginDrag } from './interaction/drag.js';
import { isDrag } from './interaction/gesture.js';
import { knobNormFromDrag } from './interaction/knob.js';
import {
  celluleDe, controlBox, controlKey, formatControlValue, keyNote, labelOf, labelWidth, machineDesignOf,
  namesFit, rankedControls, planPanel, sectionRetouchee, silkscreenSteps,
} from './blocks/machines.js';
import { coteDuControle, getEcartElements, placeDuControle, getMargeBord, placeElastique, resoudrePlanche } from './blocks/planche.js';
import { getPriorite, getRetouches, saveRetouches, savePriorite } from './design/machines-config.js';
import {
  alignerArete, alignerBoite, ciblesDAlignement, encombrementMinimal, englobe, lotHeurte, mettreALEchelle,
  optimiserControles, rangerControles,
} from './interaction/aligner.js';
import { assemblageDe, resoudreSection } from './blocks/assemblages.js';
import { publierMinimum } from './blocks/minima.js';
import { normToParam, paramToNorm } from './moteur/scale.js';
import { dial } from '../ui.js';   // le cadran des molettes d'ODIO : une seule vérité avec le rack et les cartes
import { fenetreDuGeste } from '../../commun/fenetre.js';   // la bulle de geste dans la fenêtre du geste (le nodal détaché)

/** Corps de police d'un libellé de contrôle, en mm — cote du planogramme. */
const LABEL_MM = 2.8;
/** Corps d'un nom de tranche (TR-8S), en mm. */
const STRIP_MM = 3.2;
/** Corps d'un chiffre de pas, en mm. */
const DIGIT_MM = 2.2;
/** Sous ce corps théorique, un libellé ne se lit plus : il disparaît. */
const LABEL_FLOOR = 4.2;
/** Hauteur de la bulle au-dessus du haut du contrôle, en px — cote du planogramme. */
const BUBBLE_RISE = 12;
const fontSize = (mm, scale, min, max) => Math.max(min, Math.min(max, mm * scale));

// l'état des gabarits graphiques, par bloc et par contrôle (le `riche` du composant)
const RICHE = new Map();
// l'échelle du mode élément, figée à l'entrée — EN MONDE (voir plus bas), par bloc
const GELEE = new Map();
/** Enveloppe par défaut : attaque, tenue, chute. */
const DEFAULT_CURVE = [{ t: 0, v: 0 }, { t: 0.22, v: 1 }, { t: 0.6, v: 0.55 }, { t: 1, v: 0 }];

const h = (tag, cls, style) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (style) for (const [k, v] of Object.entries(style)) e.style[k] = typeof v === 'number' && k !== 'zIndex' && k !== 'opacity' ? `${v}px` : v;
  return e;
};
const posee = (e, s) => { e.style.left = `${s.left}px`; e.style.top = `${s.top}px`; e.style.width = `${s.width}px`; e.style.height = `${s.height}px`; };

// ── la bulle de geste : nom + valeur, rendue dans le corps de la page ──
let bulle = null;
function montrerBulle(x, y, label, readout) {
  if (!bulle) bulle = h('div', 'knob__bubble');
  bulle.replaceChildren();
  if (label) { const l = h('span', 'knob__bubble-label'); l.textContent = label; bulle.append(l); }
  if (readout) { const v = h('span', 'knob__bubble-value'); v.textContent = readout; bulle.append(v); }
  bulle.style.left = `${x}px`; bulle.style.top = `${y}px`;
  // dans la fenêtre du geste : la page, ou celle du nodal détaché (commun/fenetre.js)
  const corps = fenetreDuGeste().document.body;
  if (bulle.parentNode !== corps) corps.append(bulle);
}
function majBulle(readout) { const v = bulle?.querySelector('.knob__bubble-value'); if (v) v.textContent = readout; }
function cacherBulle() { bulle?.remove(); }

/**
 * Rend une section dans `host` (vidé). `props` : ceux de MachinePanel.
 * Rend { ranger(), boites } : `ranger` est le « T » du mode élément.
 */
export function rendrePanneau(host, props) {
  const {
    section: sectionBrute, width, height, parameters, values, exposed = null, onParam, onPromote, onNote,
    edition = false, zoom = 1, apparence = 1, blocId, onLienDebut, onLienSurvol, onLienValeur, worldHeight,
    composing = false, selection = [], onSelection, blocPris = false,
  } = props;
  const design = machineDesignOf(sectionBrute);
  const cleRiche = (id) => `${blocId}|${id}`;
  const lire = (id, defaut) => RICHE.get(cleRiche(id)) ?? defaut;
  const poser = (id, v) => RICHE.set(cleRiche(id), v);
  const poserSelection = (cles) => onSelection?.([...cles]);

  // ── LE COMPTE EN MONDE, L'AFFICHAGE EN APPARENT (MachinePanel.tsx).
  const Z = zoom > 0 ? zoom : 1;
  const sectionSource = sectionRetouchee(sectionBrute);
  const elastique = assemblageDe(sectionSource.id) !== null;
  const section = elastique
    ? resoudreSection(sectionSource, placeElastique(sectionSource, width / Z, height / Z, worldHeight), exposed)
    : sectionSource;
  const plan = planPanel(section, width, height, exposed, elastique, apparence);

  // On ne compose PAS un conteneur (rangée de pas, clavier, grille de tranches).
  const composable = composing && Z > 0 && !elastique;
  const planNormal = resoudrePlanche(section, Math.max(1, width), Math.max(1, height));
  // ENTRER EN MODE ÉLÉMENT NE DOIT RIEN DÉPLACER : l'échelle est celle du
  // rendu en cours, figée à l'entrée — EN MONDE, reportée au zoom courant.
  const cleGelee = blocId || sectionBrute.id;
  if (!composable) GELEE.delete(cleGelee);
  else if (!GELEE.has(cleGelee)) GELEE.set(cleGelee, planNormal.echelle / Z);
  const echelleFigee = (GELEE.get(cleGelee) ?? planNormal.echelle / Z) * Z;
  const resolution = composable
    ? { echelle: echelleFigee, utile: planNormal.utile,
        origine: { x: (width - planNormal.utile.w * echelleFigee) / 2, y: (height - planNormal.utile.h * echelleFigee) / 2 } }
    : planNormal;

  const byId = new Map(parameters.map((p) => [p.id, p]));
  const norm = (id) => { const d = byId.get(id); return d ? paramToNorm(values[id] ?? d.default, d) : 0; };
  const setNorm = (id, value) => {
    const d = byId.get(id);
    if (d) { values[id] = normToParam(value, d); onParam(id, values[id]); }
    // les molettes liées suivent — en POSITION, pas en unité
    if (blocId && onLienValeur) onLienValeur(`${blocId} ${id}`, value);
  };

  // LE RECTANGLE DE SÉCURITÉ — mesuré depuis les bords du BLOC.
  const margeEcran = getMargeBord() * resolution.echelle;
  const zone = { x: margeEcran, y: margeEcran, w: Math.max(1, width - 2 * margeEcran), h: Math.max(1, height - 2 * margeEcran) };
  const dansLaZone = (box) => ({
    ...box,
    x: Math.min(Math.max(box.x, zone.x), Math.max(zone.x, zone.x + zone.w - box.w)),
    y: Math.min(Math.max(box.y, zone.y), Math.max(zone.y, zone.y + zone.h - box.h)),
  });
  // LE RESPONSIF DE POSITION : seuls les écarts se compriment, et seulement si ça ne tient plus.
  const comprimerDansLaZone = (boites) => {
    const cadre = englobe(boites);
    if (!cadre) return boites.map((b) => ({ ...b }));
    const corps = { x: 0, y: 0, w: width, h: height };
    const serrerX = cadre.w > corps.w + 0.5, serrerY = cadre.h > corps.h + 0.5;
    if (!serrerX && !serrerY) return boites.map((b) => ({ ...b }));
    const place = (v, taille, cadreDebut, cadreTaille, zoneDebut, zoneTaille) => {
      const course = Math.max(0, cadreTaille - taille), dispo = Math.max(0, zoneTaille - taille);
      if (course <= 0.01) return zoneDebut + dispo / 2;
      return zoneDebut + ((v - cadreDebut) / course) * dispo;
    };
    return boites.map((b) => ({ ...b,
      x: serrerX ? place(b.x, b.w, cadre.x, cadre.w, corps.x, corps.w) : b.x,
      y: serrerY ? place(b.y, b.h, cadre.y, cadre.h, corps.y, corps.h) : b.y }));
  };
  const dansLeCorps = (box) => ({ ...box,
    x: Math.min(Math.max(box.x, 0), Math.max(0, width - box.w)),
    y: Math.min(Math.max(box.y, 0), Math.max(0, height - box.h)) });

  const brutes = composable ? section.controls.map((c) => placeDuControle(resolution, controlBox(c))) : [];
  const boitesRendues = (() => {
    if (!composable) return plan.boites;
    const posees2 = comprimerDansLaZone(brutes);
    return section.controls.map((control, index) => ({ control, box: dansLeCorps(posees2[index]), cellule: celluleDe(section, control) * resolution.echelle }));
  })();
  const labelPxRendu = composable
    ? (silkscreenSteps(section).find((px) => namesFit(section, resolution.echelle, px, width)) ?? silkscreenSteps(section).at(-1) ?? 9)
    : plan.labelPx;

  // LA BUTÉE DU BLOC — publiée pour les gestes du canvas, en édition seulement.
  if (composable && Z > 0) {
    const enc = encombrementMinimal(brutes, getEcartElements() * resolution.echelle);
    publierMinimum(sectionBrute.id, { minW: (enc.w + 2 * margeEcran) / Z, minH: (enc.h + 2 * margeEcran) / Z, corpsW: width / Z, corpsH: height / Z });
  } else publierMinimum(sectionBrute.id, null);

  const rendu = boitesRendues.map(({ control, box, cellule }, index) => {
    const style = { left: box.x, top: box.y, width: box.w, height: box.h };
    const estime = labelWidth(labelOf(control), labelPxRendu);
    const centre = style.left + style.width / 2;
    const cale = Math.min(Math.max(estime / 2, centre), Math.max(estime / 2, width - estime / 2));
    return {
      control, cle: controlKey(control, index), style,
      labelVisible: estime > 0 && estime <= cellule && estime <= width && style.top + style.height + design.labelGap + labelPxRendu * 1.25 <= height,
      labelDecale: cale - centre,
    };
  });
  const boites = new Map(rendu.map((r) => [r.cle, { x: r.style.left, y: r.style.top, w: r.style.width, h: r.style.height }]));

  // ── le DOM ──
  const root = h('div', composable ? 'machine machine--composing' : `machine machine--${plan.mode}`, { width, height });
  for (const r of rendu) {
    const c = r.control;
    const id = 'id' in c ? c.id : null;
    controle(root, {
      control: c, style: r.style, scale: resolution.echelle, labelPx: labelPxRendu, labelsVisible: r.labelVisible, labelDecale: r.labelDecale,
      descriptor: id ? byId.get(id) : undefined, norm: id ? norm(id) : 0, exposed: id !== null && exposed === id,
      onNorm: (v) => { if (id) setNorm(id, v); }, onPromote: () => { if (id) onPromote?.(id); },
      bout: blocId && id && !composing ? `${blocId} ${id}` : undefined, onLienDebut, onLienSurvol, onNote, design,
      orbit: id ? lire(id, { x: 0.5, y: 0.5 }) : { x: 0.5, y: 0.5 }, onOrbit: (p) => { if (id) poser(id, p); },
      cells: id ? lire(id, []) : [], onCells: (n) => { if (id) poser(id, n); },
      curve: id ? lire(id, DEFAULT_CURVE) : DEFAULT_CURVE, onCurve: (n) => { if (id) poser(id, n); },
    });
  }

  // ── LE MODE ÉLÉMENT ──
  const versCote = (control, box) => {
    const { x, y, w, h: hh } = coteDuControle(resolution, box);
    const c = control.kind === 'knob';
    return { x: c ? x + w / 2 : x, y: c ? y + hh / 2 : y, w, h: hh };
  };
  const lotDe = (cle) => (selection.includes(cle) && selection.length > 1 ? [...selection] : [cle]);
  const voisinesDe = (lot) => rendu.filter((r) => !lot.includes(r.cle)).map((r) => boites.get(r.cle));
  const ecrire = (lot) => {
    const cotes = { ...(getRetouches(sectionBrute.id) ?? {}) };
    for (const [cle, box] of lot) {
      const control = rendu.find((r) => r.cle === cle)?.control;
      if (control) cotes[cle] = versCote(control, box);
    }
    saveRetouches(sectionBrute.id, cotes);
  };
  let reglesEl = [];
  const setRegles = (regles) => {
    for (const e of reglesEl) e.remove();
    reglesEl = regles.map((r) => {
      const e = h('span', `machine__regle machine__regle--${r.axis}`);
      if (r.axis === 'x') Object.assign(e.style, { left: `${r.at}px`, top: '0px', height: `${height}px` });
      else Object.assign(e.style, { left: '0px', top: `${r.at}px`, width: `${width}px` });
      root.append(e);
      return e;
    });
  };
  const deplacerLot = (lot, depart, dx, dy) => {
    const cadre = englobe([...depart.values()]);
    if (!cadre) return false;
    const cale = alignerBoite({ ...cadre, x: cadre.x + dx, y: cadre.y + dy }, voisinesDe(lot), zone);
    const pose = dansLaZone(cale.box);
    const ex = pose.x - cadre.x, ey = pose.y - cadre.y;
    const suivant = new Map();
    for (const cle of lot) { const b = depart.get(cle); if (b) suivant.set(cle, { ...b, x: b.x + ex, y: b.y + ey }); }
    if (lotHeurte([...suivant.values()], voisinesDe(lot), getEcartElements() * resolution.echelle)) return false;
    setRegles(cale.regles);
    ecrire(suivant);
    return true;
  };
  const dimensionnerLot = (lot, depart, dx, dy) => {
    const cadre = englobe([...depart.values()]);
    if (!cadre) return false;
    const voisines = voisinesDe(lot);
    const droite = alignerArete(cadre.x + cadre.w + dx, ciblesDAlignement(voisines, zone, 'x'));
    const bas = alignerArete(cadre.y + cadre.h + dy, ciblesDAlignement(voisines, zone, 'y'));
    setRegles([...(droite.regle !== null ? [{ axis: 'x', at: droite.regle }] : []), ...(bas.regle !== null ? [{ axis: 'y', at: bas.regle }] : [])]);
    const seul = lot.length === 1;
    const w = Math.max(3, droite.valeur - cadre.x), hh = Math.max(3, bas.valeur - cadre.y);
    const vers = seul ? { x: cadre.x + (cadre.w - w) / 2, y: cadre.y + (cadre.h - hh) / 2, w, h: hh } : { x: cadre.x, y: cadre.y, w, h: hh };
    const cles = [...depart.keys()].filter((cle) => lot.includes(cle));
    const mises = mettreALEchelle(cles.map((cle) => depart.get(cle)), cadre, vers);
    const suivant = new Map(cles.map((cle, i) => [cle, dansLaZone(mises[i])]));
    if (lotHeurte([...suivant.values()], voisinesDe(lot), getEcartElements() * resolution.echelle)) return false;
    ecrire(suivant);
    return true;
  };
  const saisirElement = (event, cle, mode) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const ajoute = event.ctrlKey || event.metaKey, retire = event.altKey;
    if (mode === 'deplacer') {
      if (retire) { poserSelection(selection.filter((a) => a !== cle)); return; }
      if (ajoute) { poserSelection(selection.includes(cle) ? selection.filter((a) => a !== cle) : [...selection, cle]); return; }
      if (!selection.includes(cle)) poserSelection([cle]);
    }
    const lot = mode === 'dimensionner' ? (selection.length > 0 ? [...selection] : [cle]) : lotDe(cle);
    const depart = new Map();
    for (const c of lot) { const box = boites.get(c); if (box) depart.set(c, { ...box }); }
    if (depart.size === 0) return;
    const x0 = event.clientX, y0 = event.clientY;
    let okX = 0, okY = 0;
    const geste = mode === 'dimensionner' ? dimensionnerLot : deplacerLot;
    beginDrag(event, {
      cursor: mode === 'dimensionner' ? 'nwse-resize' : 'move',
      move: (m) => {
        const dx = m.clientX - x0, dy = m.clientY - y0;
        if (geste(lot, depart, dx, dy)) { okX = dx; okY = dy; }
        else if (geste(lot, depart, dx, okY)) okX = dx;
        else if (geste(lot, depart, okX, dy)) okY = dy;
      },
      end: () => setRegles([]),
    });
  };
  const tracerMarquee = (event) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const cadre = root.getBoundingClientRect();
    const x0 = event.clientX - cadre.left, y0 = event.clientY - cadre.top;
    const cumul = event.ctrlKey || event.metaKey || event.altKey;
    const base = cumul ? [...selection] : [];
    if (!cumul) poserSelection([]);
    const mq = h('span', 'machine__marquee');
    root.append(mq);
    beginDrag(event, {
      cursor: 'crosshair',
      move: (m) => {
        const x = m.clientX - cadre.left, y = m.clientY - cadre.top;
        const b = { x: Math.min(x0, x), y: Math.min(y0, y), w: Math.abs(x - x0), h: Math.abs(y - y0) };
        Object.assign(mq.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
        const pris = rendu.filter((r) => { const q = boites.get(r.cle); return q && q.x < b.x + b.w && q.x + q.w > b.x && q.y < b.y + b.h && q.y + q.h > b.y; }).map((r) => r.cle);
        poserSelection([...new Set([...base, ...pris])]);
      },
      end: () => mq.remove(),
    });
  };
  // LE TRACÉ D'ORDRE — clic milieu, une courbe, et l'ordre d'exposition est dit.
  const tracerOrdre = (event) => {
    const cadre = root.getBoundingClientRect();
    const vus = [], points = [];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'machine__courbe'); svg.setAttribute('width', width); svg.setAttribute('height', height);
    const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    svg.append(pl); root.append(svg);
    const rangsEl = new Map();
    const montrerRangs = (ordre) => {
      for (const e of rangsEl.values()) e.remove();
      rangsEl.clear();
      ordre.forEach((cle, i) => {
        const r = rendu.find((x) => x.cle === cle);
        if (!r) return;
        const e = h('span', 'machine__rang', { left: r.style.left, top: r.style.top });
        e.textContent = String(i + 1);
        root.append(e); rangsEl.set(cle, e);
      });
    };
    const toucher = (x, y) => {
      points.push({ x, y });
      for (const r of rendu) {
        const b = boites.get(r.cle);
        if (!b || x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) continue;
        if (!vus.includes(r.cle) && 'id' in r.control) { vus.push(r.cle); montrerRangs(vus); }
      }
      pl.setAttribute('points', points.map((p) => `${p.x},${p.y}`).join(' '));
    };
    toucher(event.clientX - cadre.left, event.clientY - cadre.top);
    beginDrag({ currentTarget: null, pointerId: event.pointerId }, {
      cursor: 'crosshair',
      move: (m) => toucher(m.clientX - cadre.left, m.clientY - cadre.top),
      end: () => {
        svg.remove();
        savePriorite(section.id, vus);
        // les rangs restent le temps de les lire
        setTimeout(() => { for (const e of rangsEl.values()) e.remove(); }, 2600);
      },
    });
  };

  if (composable) {
    root.append(h('span', 'machine__marge', { left: zone.x, top: zone.y, width: zone.w, height: zone.h }));
    const e = getEcartElements() * resolution.echelle;
    for (const r of rendu) if (selection.includes(r.cle)) root.append(h('span', 'machine__ecart', { left: r.style.left - e, top: r.style.top - e, width: r.style.width + 2 * e, height: r.style.height + 2 * e }));
    for (const r of rendu) {
      const pr = h('span', selection.includes(r.cle) ? 'machine__prise machine__prise--prise' : 'machine__prise');
      posee(pr, r.style);
      pr.addEventListener('pointerdown', (ev) => saisirElement(ev, r.cle, 'deplacer'));
      root.append(pr);
    }
    const cles = selection.filter((cle) => boites.has(cle));
    const cadre = englobe(cles.map((cle) => boites.get(cle)));
    if (cadre && cles.length) {
      const po = h('span', 'machine__poignee', { left: cadre.x + cadre.w, top: cadre.y + cadre.h });
      po.title = 'Dimensionner — un seul élément grandit par son centre';
      po.addEventListener('pointerdown', (ev) => saisirElement(ev, cles[0], 'dimensionner'));
      root.append(po);
    }
    root.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || ev.target.closest('.machine__prise, .machine__poignee')) return;
      tracerMarquee(ev);
    });
  }
  root.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 1 || !edition) return;
    ev.preventDefault(); ev.stopPropagation();
    tracerOrdre(ev);
  }, true);

  host.replaceChildren(root);

  /** RANGER — « T » en mode élément : les éléments PRIS, ou tout le bloc désigné. */
  const ranger = () => {
    const surTout = selection.length === 0 && blocPris;
    if (!composable || (selection.length < 2 && !surTout)) return false;
    const rangDe = new Map(rankedControls(section, exposed).map((control, index) => [control.id, index]));
    const pris = surTout ? rendu.filter((r) => 'id' in r.control).map((r) => r.cle) : [...selection];
    const cles = pris.filter((cle) => boites.has(cle)).sort((a, b) => (rangDe.get(a) ?? 999) - (rangDe.get(b) ?? 999));
    const total = rendu.filter((r) => 'id' in r.control).length;
    const ecartPx = getEcartElements() * resolution.echelle;
    if (cles.length >= total) {
      const opt = optimiserControles(cles.map((cle) => boites.get(cle)), zone, ecartPx);
      ecrire(new Map(cles.map((cle, i) => [cle, opt[i]])));
    } else {
      const cadreLot = englobe(cles.map((cle) => boites.get(cle)));
      const rangees = rangerControles(cles.map((cle) => boites.get(cle)), cadreLot ?? zone, ecartPx);
      ecrire(new Map(cles.map((cle, i) => [cle, rangees[i]])));
    }
    return true;
  };
  return { ranger, boites, mode: plan.mode, composable, rangs: () => getPriorite(section.id) };
}

// ── UN CONTRÔLE : son dessin et son étiquette-bouton ─────────
function controle(root, p) {
  const { control, style, scale, labelPx: imposed, labelsVisible, labelDecale = 0, norm, exposed, onNorm, onPromote, bout, onLienDebut, onLienSurvol, onNote, design } = p;
  const label = 'label' in control ? control.label : '';
  const showLabel = labelsVisible && label !== '';
  const labelPx = imposed ?? fontSize(LABEL_MM, scale, 6, 15);
  const readout = (n) => formatControlValue(control, n);
  let etiquette = null;
  const afficheDe = (n) => (control.kind === 'switch' ? `${label} · ${control.options[Math.round(n * (control.options.length - 1))] ?? ''}` : label);
  // un contrôle qui bouge réécrit son étiquette (le sélecteur dit sa position)
  const setN = (v) => { onNorm(v); if (etiquette && control.kind === 'switch') etiquette.textContent = afficheDe(v); };

  let corps = null;
  switch (control.kind) {
    case 'knob': corps = knob(style, norm, control.default, setN, design, label, readout, bout, onLienDebut, onLienSurvol); break;
    case 'fader': corps = fader({ ...style, width: style.width * design.faderTrack }, norm, control.default, setN, design.faderCursor, design.knobCourse, label, readout); break;
    case 'switch': corps = selecteur(style, control, norm, setN, exposed, onPromote, label); break;
    case 'button': corps = bouton(style, control, norm, setN, scale, design); break;
    case 'pad': corps = bascule(scaled(style, design.ledScale), 'machine__pad', norm, setN); break;
    case 'led': corps = bascule(scaled(style, design.ledScale), 'machine__led', norm, setN); break;
    case 'text': {
      if (LABEL_MM * scale < LABEL_FLOOR) break;
      corps = h('span', 'machine__strip'); posee(corps, style);
      corps.style.fontSize = `${fontSize(STRIP_MM, scale, 6, 16)}px`;
      corps.textContent = control.text;
      break;
    }
    case 'wheel': corps = molette(style, norm, control.spring === true, setN, label, readout); break;
    case 'key': {
      const note = keyNote(control.id);
      corps = touche(style, control.black === true, norm >= 0.5, (down) => { setN(down ? 1 : 0); if (down && note !== null) onNote?.(note); });
      break;
    }
    case 'ribbon': corps = ruban(style, norm, setN, label); break;
    case 'orbit': corps = orbite(style, p.orbit ?? { x: norm, y: 0.5 }, (pt) => { p.onOrbit?.(pt); setN(pt.x); }, label); break;
    case 'matrix': corps = matrice(style, control.rows, control.cols, p.cells ?? [], (n) => p.onCells?.(n), label); break;
    case 'curve': corps = courbe(style, p.curve ?? DEFAULT_CURVE, (n) => p.onCurve?.(n), label); break;
    case 'vu': corps = vu(style, norm, setN, label); break;
    case 'display': {
      corps = h('div', 'machine__display'); posee(corps, style);
      if (labelWidth(control.text, labelPx) <= style.width - 4 && labelPx * 1.2 <= style.height) {
        const t = h('span', 'machine__display-text'); t.style.fontSize = `${labelPx}px`; t.textContent = control.text; corps.append(t);
      }
      break;
    }
    default: break;
  }
  if (corps) root.append(corps);
  // L'ÉTIQUETTE, une pour tous les gabarits, et c'est un BOUTON : cliquer expose.
  const affiche = afficheDe(norm);
  if (showLabel && affiche && control.kind !== 'key') {
    etiquette = h('button', exposed ? 'machine__label machine__label--live machine__label--exposed' : 'machine__label machine__label--live');
    etiquette.type = 'button';
    Object.assign(etiquette.style, { left: `${style.left + style.width / 2 + labelDecale}px`, top: `${style.top + style.height + design.labelGap}px`,
      fontSize: `${labelPx}px`, letterSpacing: `${design.labelTracking}em` });
    etiquette.textContent = affiche;
    etiquette.title = exposed ? 'Ne plus exposer ce contrôle' : 'Exposer ce contrôle';
    etiquette.addEventListener('pointerdown', (e) => e.stopPropagation());
    etiquette.addEventListener('click', (e) => { e.stopPropagation(); onPromote(); });
    root.append(etiquette);
  }
}

/** Met une boîte à l'échelle autour de son centre — diodes et pads. */
function scaled(style, ratio) {
  if (ratio === 1) return style;
  const w = style.width * ratio, hh = style.height * ratio;
  return { left: style.left + (style.width - w) / 2, top: style.top + (style.height - hh) / 2, width: w, height: hh };
}

/**
 * Le knob (Knob.tsx), dessiné comme les molettes d'ODIO (ui.js, `dial` : la
 * piste de 270°, l'arc de la valeur et l'aiguille dans l'accent de la carte —
 * SHOWRUNNER, 29/09 : le thème du portail au lieu du cercle d'un pixel).
 * La course reste −135° → +135°. Glisser verticalement règle (140 px, ⇧ fin) ;
 * double-clic : la valeur par défaut ; clic milieu : tirer un lien vers une
 * autre molette. La capture n'est prise qu'une fois le glissé avéré (sinon le
 * double-clic n'arrive jamais).
 */
function knob(style, value, defaultValue, onChange, design, label, readout, bout, onLien, onSurvolLien) {
  const box = h('div', 'machine__ctl'); posee(box, style);
  const size = style.width;
  const k = h('div', 'knob', { width: size, height: size });
  const body = h('div', 'knob__body', { width: size, height: size });
  const cadran = dial();
  cadran.svg.setAttribute('class', 'knob__dial');
  let cur = value;
  const paint = () => cadran.paint(Math.min(1, Math.max(0, cur)));
  paint();
  body.append(cadran.svg);
  if (label) body.title = label;
  if (bout) {
    body.dataset.bout = bout;
    body.addEventListener('pointerenter', () => onSurvolLien?.(bout));
    body.addEventListener('pointerleave', () => onSurvolLien?.(null));
  }
  body.addEventListener('pointerdown', (event) => {
    if (event.button === 1 && bout && onLien) { event.preventDefault(); event.stopPropagation(); onLien(bout, { x: event.clientX, y: event.clientY }); return; }
    if (event.button !== 0) return;
    event.stopPropagation();
    const startY = event.clientY, startNorm = cur, target = event.currentTarget;
    let moved = false;
    beginDrag({ currentTarget: null, pointerId: event.pointerId }, {
      cursor: 'ns-resize',
      move: (m) => {
        const dy = m.clientY - startY;
        if (!moved && !isDrag(0, dy)) return;
        if (!moved) {
          moved = true;
          const r = target.getBoundingClientRect();
          montrerBulle(r.left + r.width / 2, r.top - BUBBLE_RISE, label, readout(cur));
          try { target.setPointerCapture(m.pointerId); } catch { /* window reçoit tout */ }
        }
        cur = knobNormFromDrag(startNorm, dy, m.shiftKey, design.knobCourse);
        paint(); onChange(cur); majBulle(readout(cur));
      },
      end: () => { cacherBulle(); try { if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId); } catch { /* rendue */ } },
    });
  });
  body.addEventListener('dblclick', (e) => { e.stopPropagation(); cur = defaultValue; paint(); onChange(cur); });
  k.append(body);
  box.append(k);
  return box;
}

/**
 * Fader vertical du planogramme, dessiné comme le fader de la console d'ODIO
 * (ui.js `fader`, musique.css .fdr) : un rail arrondi, le trait de la valeur
 * dans l'accent, un chapeau plein. Le chapeau a au moins la cote du
 * planogramme (`cursor`) et grandit avec la largeur, pour se saisir.
 */
function fader(style, value, defaultNorm, onNorm, cursor, course, label, readout) {
  const e = h('div', 'machine__fader'); posee(e, style);
  const cur = h('span', 'machine__fader-cursor');
  const fill = h('span', 'machine__fader-fill');
  const capH = Math.max(cursor, Math.min(10, Math.round(style.width * 0.45)));
  let n = value;
  const paint = () => {
    const y = (1 - n) * (style.height - capH);
    Object.assign(cur.style, { top: `${y}px`, height: `${capH}px` });
    fill.style.height = `${Math.max(0, style.height - y - capH / 2)}px`;
  };
  paint();
  e.append(h('span', 'machine__fader-rail'), fill, cur);
  e.addEventListener('dblclick', (ev) => { ev.stopPropagation(); n = defaultNorm; paint(); onNorm(n); });
  e.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const startY = event.clientY, start = n, target = event.currentTarget;
    let moved = false;
    beginDrag({ currentTarget: null, pointerId: event.pointerId }, {
      cursor: 'ns-resize',
      move: (m) => {
        const dy = m.clientY - startY;
        if (!moved && !isDrag(0, dy)) return;
        if (!moved) {
          moved = true;
          const r = target.getBoundingClientRect();
          montrerBulle(r.left + r.width / 2, r.top - BUBBLE_RISE, label, readout(n));
          try { target.setPointerCapture(m.pointerId); } catch { /* window */ }
        }
        n = knobNormFromDrag(start, dy, m.shiftKey, course); paint(); onNorm(n); majBulle(readout(n));
      },
      end: () => cacherBulle(),
    });
  });
  return e;
}

/** Sélecteur n positions : clic = position suivante ; double-clic : l'exposer. */
function selecteur(style, control, norm, onNorm, exposed, onPromote, label) {
  const n = control.options.length;
  let index = Math.round(norm * (n - 1));
  const e = h('div', exposed ? 'machine__switch machine__switch--exposed' : 'machine__switch'); posee(e, style);
  const mark = h('span', 'machine__switch-mark');
  const vertical = style.height >= style.width;
  const cell = vertical ? (style.height - 2) / n : (style.width - 2) / n;
  const paint = () => {
    if (vertical) Object.assign(mark.style, { left: '1px', right: '1px', height: `${cell}px`, top: `${1 + (n - 1 - index) * cell}px` });
    else Object.assign(mark.style, { top: '1px', bottom: '1px', width: `${cell}px`, left: `${1 + index * cell}px` });
    e.title = `${label} · ${control.options[index]}`;
  };
  paint();
  e.append(mark);
  e.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  e.addEventListener('click', (ev) => { ev.stopPropagation(); index = (index + 1) % n; paint(); onNorm(index / Math.max(1, n - 1)); });
  e.addEventListener('dblclick', (ev) => { ev.stopPropagation(); onPromote(); });
  return e;
}

/** Bouton / pas : rectangle 1 px ; actif = plein ; le chiffre d'un pas. */
function bouton(style, control, norm, onNorm, scale, design) {
  let on = norm >= 0.5;
  const e = h('div', on ? 'machine__btn machine__btn--on' : 'machine__btn'); posee(e, style);
  e.title = control.label || control.digit || '';
  if (control.digit && style.width >= 13) {
    const d = h('span', 'machine__digit'); d.style.fontSize = `${fontSize(DIGIT_MM, scale, 5, 12) * design.digitScale}px`; d.textContent = control.digit; e.append(d);
  }
  e.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  e.addEventListener('click', (ev) => { ev.stopPropagation(); on = !on; e.classList.toggle('machine__btn--on', on); onNorm(on ? 1 : 0); });
  return e;
}
/** Pad et diode : une bascule. */
function bascule(style, cls, norm, onNorm) {
  let on = norm >= 0.5;
  const e = h('div', on ? `${cls} ${cls}--on` : cls); posee(e, style);
  e.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  e.addEventListener('click', (ev) => { ev.stopPropagation(); on = !on; e.classList.toggle(`${cls}--on`, on); onNorm(on ? 1 : 0); });
  return e;
}

/** Molette de clavier maître — `spring` : elle revient au centre au relâché. */
function molette(style, norm, spring, onNorm, label, readout) {
  const e = h('div', 'machine__wheel'); posee(e, style);
  e.title = label;
  const cur = h('span', spring ? 'machine__wheel-cursor machine__wheel-cursor--spring' : 'machine__wheel-cursor');
  let n = norm;
  const paint = () => { cur.style.top = `calc(${(1 - n) * 100}% - 2px)`; };
  paint();
  e.append(h('span', 'machine__wheel-well'), h('span', 'machine__wheel-mid'), cur);
  e.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const startY = event.clientY, start = n, target = event.currentTarget;
    let moved = false;
    beginDrag({ currentTarget: null, pointerId: event.pointerId }, {
      cursor: 'ns-resize',
      move: (m) => {
        const dy = m.clientY - startY;
        if (!moved && !isDrag(0, dy)) return;
        if (!moved) {
          moved = true;
          const r = target.getBoundingClientRect();
          montrerBulle(r.left + r.width / 2, r.top - 12, label, readout(n));
          try { target.setPointerCapture(m.pointerId); } catch { /* window */ }
        }
        n = knobNormFromDrag(start, dy, m.shiftKey); paint(); onNorm(n); majBulle(readout(n));
      },
      end: () => { cacherBulle(); if (spring) { n = 0.5; paint(); onNorm(0.5); } },
    });
  });
  return e;
}

/** Touche de clavier — momentanée : enfoncée, elle s'accentue. */
function touche(style, black, held, onHold) {
  const e = h('div', ['machine__key', black ? 'machine__key--black' : 'machine__key--white', held ? 'machine__key--held' : ''].filter(Boolean).join(' '));
  posee(e, style);
  e.style.zIndex = black ? 2 : 1;
  e.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    e.classList.add('machine__key--held'); onHold(true);
    beginDrag({ currentTarget: null, pointerId: event.pointerId }, { move: () => {}, end: () => { e.classList.remove('machine__key--held'); onHold(false); } });
  });
  return e;
}

/** Bande de geste à traînée : seize marques qui s'effacent. */
function ruban(style, norm, onNorm, label) {
  const e = h('div', 'machine__ribbon'); posee(e, style);
  e.title = label;
  const head = h('span', 'machine__ribbon-head');
  head.style.left = `${norm * 100}%`;
  e.append(head);
  let trail = [];
  const paintTrail = () => {
    for (const x of e.querySelectorAll('.machine__ribbon-mark')) x.remove();
    trail.forEach((t, i) => { const m = h('span', 'machine__ribbon-mark'); m.style.left = `${t * 100}%`; m.style.opacity = String(Math.max(0, 1 - i * 0.062)); e.append(m); });
  };
  const set = (clientX, rect) => {
    const v = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onNorm(v); head.style.left = `${v * 100}%`;
    trail = [v, ...trail].slice(0, 16); paintTrail();
  };
  e.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const rect = e.getBoundingClientRect();
    set(event.clientX, rect);
    beginDrag({ currentTarget: null, pointerId: event.pointerId }, { cursor: 'ew-resize', move: (m) => set(m.clientX, rect), end: () => { trail = []; paintTrail(); } });
  });
  return e;
}

/** Pad XY à inertie : il garde l'élan au relâchement (friction 0,988, rebond). */
function orbite(style, point, onPoint, label) {
  const e = h('div', 'machine__orbit'); posee(e, style);
  e.title = label;
  const x = h('span', 'machine__orbit-x'), y = h('span', 'machine__orbit-y'), dot = h('span', 'machine__orbit-dot');
  const paint = (p) => { x.style.left = `${p.x * 100}%`; y.style.top = `${p.y * 100}%`; dot.style.left = `${p.x * 100}%`; dot.style.top = `${p.y * 100}%`; };
  paint(point);
  e.append(x, y, dot);
  let inertie = null;
  const emettre = (p) => { paint(p); onPoint(p); };
  e.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (inertie !== null) cancelAnimationFrame(inertie);
    const rect = e.getBoundingClientRect();
    const lire = (cx, cy) => ({ x: Math.min(1, Math.max(0, (cx - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (cy - rect.top) / rect.height)) });
    let last = lire(event.clientX, event.clientY), vitesse = { x: 0, y: 0 };
    emettre(last);
    beginDrag({ currentTarget: null, pointerId: event.pointerId }, {
      cursor: 'crosshair',
      move: (m) => { const p = lire(m.clientX, m.clientY); vitesse = { x: p.x - last.x, y: p.y - last.y }; last = p; emettre(p); },
      end: () => {
        let p = { ...last }, v = { ...vitesse };
        const pas = () => {
          if (!e.isConnected) return;
          v = { x: v.x * 0.988, y: v.y * 0.988 };
          if (Math.abs(v.x) < 0.0004 && Math.abs(v.y) < 0.0004) return;
          p = { x: p.x + v.x, y: p.y + v.y };
          if (p.x < 0 || p.x > 1) { v.x = -v.x; p.x = Math.min(1, Math.max(0, p.x)); }
          if (p.y < 0 || p.y > 1) { v.y = -v.y; p.y = Math.min(1, Math.max(0, p.y)); }
          emettre(p);
          inertie = requestAnimationFrame(pas);
        };
        inertie = requestAnimationFrame(pas);
      },
    });
  });
  return e;
}

/** Matrice de croisement : clic = cycle d'intensité, glisser = peint. */
function matrice(style, rows, cols, cells, onCells, label) {
  const e = h('div', 'machine__matrix'); posee(e, style);
  e.style.gridTemplateColumns = `repeat(${cols}, 1fr)`; e.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  e.title = label;
  let peint = null;
  const next = [...cells];
  for (let i = 0; i < rows * cols; i++) {
    const c = h('span', 'machine__matrix-cell');
    const paint = () => { c.dataset.n = String(next[i] || 0); };
    paint();
    c.addEventListener('pointerdown', (ev) => { if (ev.button !== 0) return; ev.stopPropagation(); peint = ((next[i] || 0) + 1) % 4; next[i] = peint; paint(); onCells([...next]); });
    c.addEventListener('pointerenter', (ev) => { if (peint === null || ev.buttons !== 1) return; next[i] = peint; paint(); onCells([...next]); });
    c.addEventListener('pointerup', () => { peint = null; });
    e.append(c);
  }
  return e;
}

/** Courbe à points de rupture — extrémités verrouillées en t, un point ne dépasse pas ses voisins. */
function courbe(style, points, onPoints, label) {
  const e = h('div', 'machine__curve'); posee(e, style);
  e.title = label;
  const ns = 'http://www.w3.org/2000/svg';
  const w = style.width, hh = style.height;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', w); svg.setAttribute('height', hh);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('class', 'machine__curve-trace');
  svg.append(path);
  let pts = points.map((q) => ({ ...q }));
  const cercles = pts.map(() => { const c = document.createElementNS(ns, 'circle'); c.setAttribute('r', '3'); c.setAttribute('class', 'machine__curve-pt'); svg.append(c); return c; });
  const paint = () => {
    path.setAttribute('d', pts.map((q, i) => `${i === 0 ? 'M' : 'L'}${(q.t * w).toFixed(1)} ${((1 - q.v) * hh).toFixed(1)}`).join(' '));
    pts.forEach((q, i) => { cercles[i].setAttribute('cx', q.t * w); cercles[i].setAttribute('cy', (1 - q.v) * hh); });
  };
  paint();
  cercles.forEach((c, index) => c.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const rect = svg.getBoundingClientRect();
    beginDrag({ currentTarget: null, pointerId: event.pointerId }, {
      cursor: 'move',
      move: (m) => {
        const t = Math.min(1, Math.max(0, (m.clientX - rect.left) / rect.width));
        const v = Math.min(1, Math.max(0, 1 - (m.clientY - rect.top) / rect.height));
        const premier = index === 0, dernier = index === pts.length - 1;
        const min = premier ? 0 : pts[index - 1].t + 0.02, max = dernier ? 1 : pts[index + 1].t - 0.02;
        pts[index] = { t: premier || dernier ? pts[index].t : Math.min(max, Math.max(min, t)), v };
        paint(); onPoints(pts.map((q) => ({ ...q })));
      },
    });
  }));
  e.append(svg);
  return e;
}

/** VU à aiguille : onze graduations sur ±58°, zone d'alerte au-delà de 70 %. */
function vu(style, norm, onNorm, label) {
  const e = h('div', 'machine__vu'); posee(e, style);
  e.title = label;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', style.width); svg.setAttribute('height', style.height);
  svg.setAttribute('viewBox', '0 0 100 62'); svg.setAttribute('preserveAspectRatio', 'none');
  for (let i = 0; i < 11; i++) {
    const a = (-58 + (116 * i) / 10) * (Math.PI / 180);
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', 50 + Math.sin(a) * 40); l.setAttribute('y1', 58 - Math.cos(a) * 40);
    l.setAttribute('x2', 50 + Math.sin(a) * 46); l.setAttribute('y2', 58 - Math.cos(a) * 46);
    l.setAttribute('class', i >= 7 ? 'machine__vu-tick machine__vu-tick--haut' : 'machine__vu-tick');
    svg.append(l);
  }
  const aiguille = document.createElementNS(ns, 'line');
  aiguille.setAttribute('class', 'machine__vu-aiguille');
  aiguille.setAttribute('x1', '50'); aiguille.setAttribute('y1', '58');
  let n = norm;
  const paint = () => { const a = (-58 + 116 * n) * (Math.PI / 180); aiguille.setAttribute('x2', 50 + Math.sin(a) * 42); aiguille.setAttribute('y2', 58 - Math.cos(a) * 42); };
  paint();
  svg.append(aiguille);
  e.append(svg);
  e.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const startY = event.clientY, start = n;
    beginDrag({ currentTarget: null, pointerId: event.pointerId }, { cursor: 'ns-resize', move: (m) => { n = knobNormFromDrag(start, m.clientY - startY, m.shiftKey); paint(); onNorm(n); } });
  });
  return e;
}

export { knob as knobMachine, fader as faderMachine };
