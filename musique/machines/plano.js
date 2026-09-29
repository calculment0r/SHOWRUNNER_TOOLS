// PLANO — le créateur de machines, porté d'ODIO_01 (apps/studio/src/pages/Plano.tsx,
// plano/registre.ts, plano/parametres-moteur.ts), de React vers le DOM.
//
// Trois colonnes, comme dans ODIO_01. À gauche, D'OÙ vient le gabarit : un
// neuf, un des gabarits du projet, ou une des machines du studio relue comme
// gabarit. Au milieu, CE QU'ON ÉCRIT : la machine en sections, rangées et
// contrôles cotés en millimètres, et le branchement de chaque contrôle sur le
// moteur. À droite, CE QUE ÇA REND : chaque section dessinée par le vrai
// panneau du nodal (panneau.js), à quatre tailles apparentes — la bande de
// recul. Rien ne place un contrôle à la main : on déclare, la géométrie suit
// (plano/gabarit.js).
//
// Ce qui change, et pourquoi (musique/PROVENANCE.md) :
//   - les gabarits vivent dans le PROJET (p.nodal.gabarits), pas dans le
//     navigateur : ils voyagent avec le morceau et le serveur les garde ;
//   - « poser dans l'atelier » devient « poser dans le nodal » ;
//   - le COMPAGNON (appel à l'API d'Anthropic avec une clé) et l'écriture sur
//     GitHub ne sont pas portés : tout tourne en local, sans API payante.

import { MACHINES, MACHINE_ENGINES, MM_TO_WORLD, ajouterMachine, sectionParameters } from './blocks/machines.js';
import { enregistrerSectionsDe } from './blocks/registry.js';
import { branchementParDefaut, composer, gabaritDepuisMachine, gabaritVierge, normaliser, VOIX_DE_GABARIT } from './plano/gabarit.js';
import { rendrePanneau } from './panneau.js';
import { TYPE_DE_VOIX, oublierDescripteurs } from './tuiles.js';
import { descripteurDe } from './corps.js';
import { MODULES } from '../modules.js';

const KINDS = ['knob', 'switch', 'fader', 'button', 'pad', 'led', 'wheel', 'key', 'ribbon', 'orbit', 'matrix', 'curve', 'vu', 'text', 'display'];
const LOIS = ['lin', 'exp', 'rond'];
/** Les quatre tailles apparentes de la bande de recul. */
const RECUL = [1, 0.6, 0.4, 0.25];
const NOM_LOI = { lin: 'linéaire', exp: 'exponentielle', rond: 'arrondie' };

// ── le registre (plano/registre.ts) : les gabarits du projet, installés au catalogue ──
const INTEGRES = new Set(MACHINES.map((m) => m.id));
/** Un gabarit est-il une machine du dépôt (relue), ou un brouillon ? */
export const estIntegre = (id) => INTEGRES.has(id);

/** Met le gabarit au catalogue : composé, ajouté aux machines, ses sections au registre. */
export function installerGabarit(g) {
  const propre = normaliser(g);
  const { machine, moteur } = composer(propre);
  ajouterMachine(machine, moteur);
  enregistrerSectionsDe(machine);
  oublierDescripteurs(`${machine.id}_`);
  return propre;
}
/** Les gabarits du projet, remis au catalogue à l'ouverture d'un projet. */
export function installerGabaritsDu(p) {
  for (const g of p?.nodal?.gabarits || []) { try { installerGabarit(g); } catch { /* un gabarit abîmé ne casse pas le nodal */ } }
}

// ── les paramètres du moteur, par voix (plano/parametres-moteur.ts) ──
function parametresParVoix() {
  const out = {};
  for (const v of VOIX_DE_GABARIT) {
    const type = TYPE_DE_VOIX[v];
    out[v] = type && MODULES[type] ? MODULES[type].params.map(descripteurDe) : [];
  }
  return out;
}

// ── de petites fabriques DOM ──
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const bouton = (cls, text, fn, title) => { const b = h('button', cls, text); b.type = 'button'; if (title) b.title = title; b.addEventListener('click', fn); return b; };
function champ(label, input, large = false) { const l = h('label', large ? 'plano__champ plano__champ--large' : 'plano__champ', label); l.append(input); return l; }
function saisie(value, onInput, attrs = {}) {
  const i = h('input');
  for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
  i.value = value ?? '';
  i.addEventListener('change', () => onInput(i.value));
  i.addEventListener('keydown', (e) => e.stopPropagation());
  return i;
}
function liste(value, options, onChange) {
  const s = h('select');
  for (const [v, t] of options) { const o = h('option', null, t); o.value = v; s.append(o); }
  s.value = value ?? '';
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

// ── les modifications pures (Plano.tsx, en bas) ──
const clone = (x) => JSON.parse(JSON.stringify(x));
const majSection = (g, s, patch) => ({ ...g, sections: g.sections.map((x, i) => (i === s ? { ...x, ...patch } : x)) });
function majRangee(g, s, r, patch) {
  return majSection(g, s, { rangees: g.sections[s].rangees.map((x, i) => {
    if (i !== r) return x;
    const { ecart, ...reste } = x; void ecart;
    return patch.ecart === undefined ? reste : { ...reste, ecart: patch.ecart };
  }) });
}
function deplacerSection(g, s, sens) {
  const sections = [...g.sections], cible = s + sens;
  if (cible < 0 || cible >= sections.length) return g;
  const [prise] = sections.splice(s, 1);
  sections.splice(cible, 0, prise);
  return { ...g, sections };
}
function ajouterControle(g, s, r) {
  const rangee = g.sections[s].rangees[r];
  const n = g.sections.flatMap((x) => x.rangees.flatMap((y) => y.controles)).length + 1;
  const neuf = { kind: 'knob', id: `k${n}`, label: `k${n}`, w: 15, h: 15, default: 0.5 };
  return majSection(g, s, { rangees: g.sections[s].rangees.map((x, i) => (i === r ? { ...rangee, controles: [...rangee.controles, neuf] } : x)) });
}
const majControle = (g, p, c) => majSection(g, p.s, { rangees: g.sections[p.s].rangees.map((x, i) => (i === p.r ? { ...x, controles: x.controles.map((y, j) => (j === p.c ? c : y)) } : x)) });
function deplacerControle(g, p, sens) {
  const rangee = g.sections[p.s].rangees[p.r], controles = [...rangee.controles], cible = p.c + sens;
  if (cible < 0 || cible >= controles.length) return g;
  const [pris] = controles.splice(p.c, 1);
  controles.splice(cible, 0, pris);
  return majSection(g, p.s, { rangees: g.sections[p.s].rangees.map((x, i) => (i === p.r ? { ...rangee, controles } : x)) });
}
const retirerControle = (g, p) => majSection(g, p.s, { rangees: g.sections[p.s].rangees.map((x, i) => (i === p.r ? { ...x, controles: x.controles.filter((_, j) => j !== p.c) } : x)) });

/**
 * Ouvre PLANO par-dessus le nodal. `projet()` rend le projet courant ;
 * `onPoser(machineId)` pose la machine dans le nodal ; `onGarder()` enregistre
 * le projet (les gabarits y vivent).
 */
export function ouvrirPlano({ projet, onPoser, onGarder, onClose }) {
  const parametres = parametresParVoix();
  let courant = null, pris = null, message = null, panneau = null, valeurs = {};
  const gabarits = () => { const p = projet(); p.nodal = p.nodal || {}; return (p.nodal.gabarits = p.nodal.gabarits || []); };

  const voile = h('span', 'palette__veil');
  const page = h('section', 'plano');
  page.setAttribute('aria-label', 'PLANO');
  const fermer = () => { voile.remove(); page.remove(); removeEventListener('keydown', echap, true); onClose?.(); };
  const echap = (e) => { if (e.key === 'Escape' && !e.target.closest?.('input, textarea, select')) { e.stopPropagation(); fermer(); } };
  addEventListener('keydown', echap, true);
  voile.addEventListener('pointerdown', fermer);
  page.addEventListener('pointerdown', (e) => e.stopPropagation());
  page.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  page.addEventListener('dblclick', (e) => e.stopPropagation());

  const entete = h('div', 'plano__entete');
  const gauche = h('div', 'plano__liste'), milieu = h('div', 'plano__editeur'), droite = h('div', 'plano__apercu');
  page.append(entete, gauche, milieu, droite);

  const modifier = (fn) => { if (courant) { courant = fn(courant); peindre(); } };
  const ouvrir = (g) => { courant = clone(g); pris = null; message = null; valeurs = {}; peindre(); };
  const nouveau = () => ouvrir(gabaritVierge(`m${Date.now().toString(36).slice(-5)}`));
  const relire = (id) => {
    const m = MACHINES.find((x) => x.id === id);
    if (!m) return;
    ouvrir(gabaritDepuisMachine(m, MACHINE_ENGINES[id]));
    message = { genre: 'ok', texte: `${m.name} relue en gabarit — recomposée par rangées, à reprendre.` };
    peindre();
  };
  const doublons = () => {
    if (!courant) return [];
    const vus = new Map(), secs = new Map();
    for (const s of courant.sections) { secs.set(s.id, (secs.get(s.id) || 0) + 1); for (const r of s.rangees) for (const c of r.controles) if (c.id) vus.set(c.id, (vus.get(c.id) || 0) + 1); }
    return [...[...vus].filter(([, n]) => n > 1).map(([id]) => `contrôle « ${id} »`), ...[...secs].filter(([, n]) => n > 1).map(([id]) => `section « ${id} »`)];
  };
  const poserDansLeStudio = () => {
    if (!courant) return null;
    const d = doublons();
    if (d.length) { message = { genre: 'erreur', texte: `Identifiants en double : ${d.join(', ')}.` }; peindre(); return null; }
    let propre;
    try { propre = installerGabarit(courant); } catch (e) { message = { genre: 'erreur', texte: String(e) }; peindre(); return null; }
    const liste2 = gabarits(), i = liste2.findIndex((x) => x.id === propre.id);
    if (i >= 0) liste2.splice(i, 1, propre); else liste2.push(propre);
    onGarder?.();
    courant = propre;
    return propre;
  };

  function peindre() {
    // l'en-tête
    entete.replaceChildren(h('span', 'plano__titre', 'PLANO'),
      message ? h('span', `plano__message${message.genre === 'erreur' ? ' plano__message--erreur' : ''}`, message.texte)
        : h('span', 'plano__message', 'un gabarit se déclare en sections, rangées et contrôles cotés en millimètres — la géométrie suit'),
      bouton('plano__fermer', '×', fermer, 'Fermer (Échap)'));

    // à gauche : d'où vient le gabarit
    gauche.replaceChildren(h('div', 'plano__rubrique', 'GABARIT'), bouton('plano__btn plano__btn--acc', 'nouveau', nouveau), h('div', 'plano__rubrique', 'GABARITS DU PROJET'));
    const bs = gabarits();
    if (!bs.length) gauche.append(h('div', 'plano__aide', 'aucun pour l\'instant'));
    for (const g of bs) {
      const b = bouton(courant?.id === g.id ? 'plano__item plano__item--pris' : 'plano__item', '', () => ouvrir(g));
      b.append(h('span', null, g.nom), h('span', 'plano__item-id', estIntegre(g.id) ? 'dépôt' : 'brouillon'));
      gauche.append(b);
    }
    gauche.append(h('div', 'plano__rubrique', 'MACHINES DU STUDIO'));
    for (const m of MACHINES) {
      if (bs.some((g) => g.id === m.id) && !estIntegre(m.id)) continue;
      const b = bouton('plano__item', '', () => relire(m.id), 'Relire cette machine comme gabarit, pour la reprendre');
      b.append(h('span', null, m.name), h('span', 'plano__item-id', m.id));
      gauche.append(b);
    }

    // au milieu : ce qu'on écrit
    milieu.replaceChildren();
    if (!courant) {
      milieu.append(h('p', 'plano__aide', 'Choisis à gauche un gabarit à reprendre, relis une machine du studio, ou pars d\'un gabarit neuf. On déclare des sections, des rangées, des contrôles cotés en millimètres ; le planogramme en découle, et le nodal le rend avec son zoom sémantique.'));
      const act = h('div', 'plano__actions');
      act.append(bouton('plano__btn', 'importer un JSON', () => { panneau = panneau === 'importer' ? null : 'importer'; peindre(); }));
      milieu.append(act);
    } else {
      const act = h('div', 'plano__actions');
      const d = doublons();
      const poser = bouton('plano__btn plano__btn--acc', 'poser dans le nodal', () => {
        const propre = poserDansLeStudio();
        if (!propre) return;
        fermer();
        onPoser(propre.id);
      }, 'Mettre la machine au catalogue et la poser dans le nodal');
      poser.disabled = d.length > 0;
      act.append(poser,
        bouton('plano__btn', 'garder au projet', () => { if (poserDansLeStudio()) { message = { genre: 'ok', texte: `${courant.nom} est au catalogue du projet.` }; peindre(); } }, 'Le gabarit est gardé dans le projet et mis au catalogue, sans être posé'),
        bouton('plano__btn', 'copier le JSON', () => {
          navigator.clipboard?.writeText(JSON.stringify(normaliser(courant), null, 2)).then(() => { message = { genre: 'ok', texte: 'JSON copié.' }; peindre(); },
            () => { message = { genre: 'erreur', texte: 'Le presse-papier n\'est pas accessible ici.' }; peindre(); });
        }),
        bouton('plano__btn', 'importer', () => { panneau = panneau === 'importer' ? null : 'importer'; peindre(); }));
      if (bs.some((g) => g.id === courant.id)) act.append(bouton('plano__btn', 'oublier ce gabarit', () => {
        const liste2 = gabarits(), i = liste2.findIndex((x) => x.id === courant.id);
        if (i >= 0) liste2.splice(i, 1);
        onGarder?.();
        message = { genre: 'ok', texte: 'Gabarit oublié (les machines déjà posées restent).' };
        peindre();
      }));
      milieu.append(act);
      if (d.length) milieu.append(h('p', 'plano__message plano__message--erreur', `identifiants en double : ${d.join(', ')}`));
    }
    if (panneau === 'importer') milieu.append(importer());
    if (courant) {
      const g = courant;
      const champs = h('div', 'plano__champs');
      champs.append(
        champ('nom', saisie(g.nom, (v) => modifier((x) => ({ ...x, nom: v })))),
        champ('identifiant', saisie(g.id, (v) => modifier((x) => ({ ...x, id: v })))),
        champ('référence', saisie(g.ref, (v) => modifier((x) => ({ ...x, ref: v })))),
        champ('voix du moteur', liste(g.voix ?? '', [['', 'aucune (panneau muet)'], ...VOIX_DE_GABARIT.map((v) => [v, v])], (v) => modifier((x) => ({ ...x, voix: v || null })))),
        champ('section de sortie', liste(g.sortie, g.sections.map((s) => [s.id, s.nom || s.id]), (v) => modifier((x) => ({ ...x, sortie: v })))),
        champ('colonnes', saisie(g.colonnes, (v) => modifier((x) => ({ ...x, colonnes: Number(v) || 1 })), { type: 'number', min: 1, max: 8 })),
        champ('chasse (mm / caractère)', saisie(g.chasse ?? 3.6, (v) => modifier((x) => ({ ...x, chasse: Number(v) || 3.6 })), { type: 'number', min: 1, max: 8, step: 0.2 })));
      milieu.append(champs);
      g.sections.forEach((section, s) => {
        const bloc = h('div', 'plano__section');
        const tete = h('div', 'plano__section-tete');
        const nom = saisie(section.nom, (v) => modifier((x) => majSection(x, s, { nom: v })), { title: 'Le nom de la section' }); nom.className = 'plano__nom';
        const ident = saisie(section.id, (v) => modifier((x) => majSection(x, s, { id: v })), { title: 'L\'identifiant de la section' }); ident.className = 'plano__id';
        const haut = bouton('plano__mini', '↑', () => modifier((x) => deplacerSection(x, s, -1)), 'Monter'); haut.disabled = s === 0;
        const bas = bouton('plano__mini', '↓', () => modifier((x) => deplacerSection(x, s, 1)), 'Descendre'); bas.disabled = s === g.sections.length - 1;
        tete.append(nom, ident,
          bouton(g.sortie === section.id ? 'plano__mini plano__mini--on' : 'plano__mini', 'sortie', () => modifier((x) => ({ ...x, sortie: section.id })), 'Cette section porte la sortie'),
          haut, bas, bouton('plano__mini', '×', () => { pris = null; modifier((x) => ({ ...x, sections: x.sections.filter((_, i) => i !== s) })); }, 'Retirer la section'));
        bloc.append(tete);
        section.rangees.forEach((rangee, r) => {
          const ligne = h('div', 'plano__rangee');
          ligne.append(h('span', 'plano__rangee-num', String(r + 1)));
          rangee.controles.forEach((c, i) => {
            const chip = bouton(['plano__chip', pris && pris.s === s && pris.r === r && pris.c === i ? 'plano__chip--pris' : '', c.moteur ? 'plano__chip--branche' : ''].filter(Boolean).join(' '), '',
              () => { pris = { s, r, c: i }; peindre(); }, c.moteur ? `branché sur ${c.moteur.param}` : 'sans branchement');
            chip.append(h('span', 'plano__chip-kind', c.kind), document.createTextNode(c.label || c.id || c.text || '—'), h('span', 'plano__chip-cote', `${c.w}×${c.h}`));
            ligne.append(chip);
          });
          ligne.append(
            bouton('plano__mini', '+ contrôle', () => { const n = rangee.controles.length; modifier((x) => ajouterControle(x, s, r)); pris = { s, r, c: n }; peindre(); }, 'Ajouter un contrôle à cette rangée'),
            bouton('plano__mini', rangee.ecart === 5 ? 'serrée' : 'espacée', () => modifier((x) => majRangee(x, s, r, { ecart: rangee.ecart === 5 ? undefined : 5 })), 'Écart serré (rangée de pas)'),
            bouton('plano__mini', '×', () => { pris = null; modifier((x) => majSection(x, s, { rangees: section.rangees.filter((_, i) => i !== r) })); }, 'Retirer la rangée'));
          bloc.append(ligne);
        });
        bloc.append(bouton('plano__mini', '+ rangée', () => modifier((x) => majSection(x, s, { rangees: [...section.rangees, { controles: [] }] }))));
        milieu.append(bloc);
      });
      milieu.append(bouton('plano__btn', '+ section', () => modifier((x) => ({ ...x, sections: [...x.sections, { id: `s${x.sections.length + 1}`, nom: `section ${x.sections.length + 1}`, rangees: [{ controles: [] }] }] }))));
      const c = pris && g.sections[pris.s]?.rangees[pris.r]?.controles[pris.c];
      if (c) milieu.append(proprietes(c, g, pris));
    }

    // à droite : ce que ça rend
    droite.replaceChildren();
    if (!courant) { droite.append(h('p', 'plano__aide', 'L\'aperçu montre chaque section rendue par le nodal lui-même, à quatre tailles : on voit ce qui reste quand la place manque.')); return; }
    let compose;
    try { compose = composer(normaliser(courant)); } catch (e) { droite.append(h('p', 'plano__message plano__message--erreur', String(e))); return; }
    for (const section of compose.machine.sections) for (const q of sectionParameters(section)) if (!(q.id in valeurs)) valeurs[q.id] = q.default;
    const titre = h('div', 'plano__apercu-titre');
    titre.append(h('span', null, compose.machine.name), h('span', 'plano__apercu-cote', `${Math.round(compose.machine.w)} × ${Math.round(compose.machine.h)} mm · ${compose.machine.sections.length} sections`));
    droite.append(titre);
    for (const section of compose.machine.sections) droite.append(apercu(section));
  }

  // l'aperçu d'une section, à quatre reculs (Plano.tsx, Apercu)
  function apercu(section) {
    const params = sectionParameters(section);
    const monde = { w: section.w * MM_TO_WORLD, h: section.h * MM_TO_WORLD };
    const bloc = h('div', 'plano__apercu-section');
    const titre = h('div', 'plano__apercu-titre');
    titre.append(h('span', null, section.name), h('span', 'plano__apercu-cote', `${Math.round(section.w)} × ${Math.round(section.h)} mm · ${section.controls.length} contrôles`));
    const recul = h('div', 'plano__recul');
    for (const k of RECUL) {
      const w = Math.max(8, Math.round(monde.w * k)), hh = Math.max(8, Math.round(monde.h * k));
      const ech = h('div', 'plano__echelle');
      const cadre = h('div', 'plano__cadre');
      cadre.style.width = `${w + 2}px`; cadre.style.height = `${hh + 23 + 2}px`;
      const corps = h('div', 'plano__cadre-corps');
      corps.style.width = `${w}px`; corps.style.height = `${hh}px`;
      rendrePanneau(corps, { section, width: w, height: hh, parameters: params, values: valeurs, exposed: null,
        onParam: (id, v) => { valeurs[id] = v; }, onPromote: () => {}, zoom: k, apparence: k });
      cadre.append(h('span', 'plano__cadre-nom', w > 40 ? section.name.toUpperCase() : ''), corps);
      ech.append(h('span', 'plano__echelle-k', `× ${k}`), cadre);
      recul.append(ech);
    }
    bloc.append(titre, recul);
    return bloc;
  }

  // les propriétés d'un contrôle (Plano.tsx, Proprietes)
  function proprietes(c, g, p) {
    const bloc = h('div', 'plano__proprietes');
    const tete = h('div', 'plano__proprietes-tete');
    const ch = (cle, v) => modifier((x) => majControle(x, p, { ...c, [cle]: v }));
    const gau = bouton('plano__mini', '←', () => { modifier((x) => deplacerControle(x, p, -1)); pris = { ...p, c: p.c - 1 }; peindre(); }, 'Vers la gauche'); gau.disabled = p.c === 0;
    const long = g.sections[p.s]?.rangees[p.r]?.controles.length ?? 0;
    const dro = bouton('plano__mini', '→', () => { modifier((x) => deplacerControle(x, p, 1)); pris = { ...p, c: p.c + 1 }; peindre(); }, 'Vers la droite'); dro.disabled = p.c >= long - 1;
    const acts = h('span');
    acts.append(gau, dro, bouton('plano__mini', 'retirer', () => { pris = null; modifier((x) => retirerControle(x, p)); }, 'Retirer ce contrôle'), bouton('plano__mini', '×', () => { pris = null; peindre(); }, 'Fermer'));
    tete.append(h('span', null, `CONTRÔLE — section ${p.s + 1}, rangée ${p.r + 1}, place ${p.c + 1}`), acts);
    const champs = h('div', 'plano__champs');
    champs.append(
      champ('genre', liste(c.kind, KINDS.map((k) => [k, k]), (v) => ch('kind', v))),
      champ('identifiant', saisie(c.id, (v) => ch('id', v))),
      champ('nom', saisie(c.label ?? '', (v) => ch('label', v || undefined))),
      champ('largeur (mm)', saisie(c.w, (v) => ch('w', Number(v)), { type: 'number', min: 2, max: 400, step: 0.5 })),
      champ('hauteur (mm)', saisie(c.h, (v) => ch('h', Number(v)), { type: 'number', min: 2, max: 400, step: 0.5 })),
      champ(`défaut ${c.kind === 'switch' ? '(index)' : '(0 à 1)'}`, saisie(c.default ?? 0, (v) => ch('default', Number(v)), { type: 'number', step: c.kind === 'switch' ? 1 : 0.05 })));
    if (c.kind === 'switch') champs.append(champ('positions, séparées par des virgules', saisie((c.options || []).join(', '), (v) => ch('options', v.split(',').map((o) => o.trim()).filter(Boolean))), true));
    if (c.kind === 'text' || c.kind === 'display' || c.kind === 'button') champs.append(champ('texte', saisie(c.text ?? '', (v) => ch('text', v || undefined))));
    if (c.kind === 'matrix') champs.append(champ('lignes', saisie(c.rows ?? 4, (v) => ch('rows', Number(v)), { type: 'number', min: 1, max: 16 })), champ('colonnes', saisie(c.cols ?? 4, (v) => ch('cols', Number(v)), { type: 'number', min: 1, max: 16 })));
    const ps = g.voix ? parametres[g.voix] || [] : [];
    const sel = liste(c.moteur?.param ?? '', [['', g.voix ? 'rien — ce contrôle ne règle pas le moteur' : 'choisis d\'abord une voix du moteur'],
      ...ps.map((q) => [q.id, `${q.id} — ${q.label} (${q.min}…${q.max}${q.unit ? ` ${q.unit}` : ''})`])], (v) => {
      const d = ps.find((q) => q.id === v);
      modifier((x) => majControle(x, p, { ...c, moteur: d ? branchementParDefaut(d) : undefined }));
    });
    sel.disabled = !g.voix;
    champs.append(champ('branché sur', sel, true));
    if (c.moteur) champs.append(
      champ('min', saisie(c.moteur.min, (v) => ch('moteur', { ...c.moteur, min: Number(v) }), { type: 'number', step: 'any' })),
      champ('max', saisie(c.moteur.max, (v) => ch('moteur', { ...c.moteur, max: Number(v) }), { type: 'number', step: 'any' })),
      champ('loi', liste(c.moteur.loi, LOIS.map((l) => [l, NOM_LOI[l]]), (v) => ch('moteur', { ...c.moteur, loi: v }))));
    bloc.append(tete, champs);
    return bloc;
  }

  // importer un JSON (Plano.tsx, Importer)
  function importer() {
    const bloc = h('div', 'plano__panneau');
    const t = h('textarea');
    t.placeholder = '{ "id": "…", "sections": [ … ] }';
    t.addEventListener('keydown', (e) => e.stopPropagation());
    const champs = h('div', 'plano__champs');
    champs.append(champ('colle un gabarit', t, true));
    const act = h('div', 'plano__actions');
    act.append(bouton('plano__btn plano__btn--acc', 'lire', () => {
      try {
        const lu = JSON.parse(t.value);
        if (!Array.isArray(lu.sections)) throw new Error('pas de sections');
        panneau = null;
        ouvrir(normaliser(lu));
      } catch (e) { message = { genre: 'erreur', texte: `JSON illisible : ${e?.message || e}` }; peindre(); }
    }));
    bloc.append(h('div', 'plano__panneau-tete', 'IMPORTER UN JSON'), champs, act);
    return bloc;
  }

  peindre();
  document.body.append(voile, page);
  return { fermer };
}
