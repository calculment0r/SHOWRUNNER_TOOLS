// ODIO — la rubrique « Space » du navigateur (06/10 ; docs/etudes/musique_spaces_playlists.md
// § 2 et § 5 étape 7) : le Space de Musique où vit le projet ouvert, et ce qu'il range — ses
// projets ODIO, ses chansons, leurs stems, les autres sons (versions d'une région, références,
// rendus), les clips MIDI —, à glisser dans l'arrangement ou dans une case de la Session (un
// clic : sur la piste choisie, ou dans la case choisie). Elle est AU-DESSUS de la rubrique
// « Projet » (la bibliothèque du projet, biblio.js) : le Space range des projets, le projet
// range ses clips.
//   - Le menu est celui de l'app Musique (chanson/spaces.js), monté ici : changer de Space,
//     « + Nouveau Space », « Tous les Spaces », et le « ⋯ » (renommer, couleur, archiver…).
//     Il montre d'abord le Space du projet ouvert et ne retient rien : le projet porte le
//     sien (`music_space`, tenu par le serveur).
//   - Ce qu'ODIO génère pour le projet (versions, stems, MIDI extrait ou rangé) naît dans
//     le Space DU PROJET (le serveur : chanson.project_space) ; un projet neuf naît dans le
//     Space montré ici (spaceCourant(), musique.js : newProject).
//   - « Ranger le projet ici » quand on regarde un autre Space ; « Déplacer vers… » au clic
//     droit d'un objet ou d'un projet (la route des Spaces) ; Ctrl+Z les rend.
// Le contenu : GET /api/chanson/spaces/contenu (server/tools/chanson.py), relu à chaque
// changement de Space ou de projet, à la fin d'un travail (sr:job), au retour sur l'onglet.
// Les lectures et écritures disent le Workspace DU PROJET (musique.js, espaceDuProjet).

import { api, toast, href, fmtDur, dragItem } from '../commun/shell.js';
import { montrerSpaces, spaceCourant, choisirSpace, rechargerSpaces, spacesListe, menuSpaces, spaceNom } from '../chanson/spaces.js';
import { el } from './ui.js';
import { midiSub, placeMidi } from './generatif_midi.js';
import { STEM_FR } from './generatif.js';

const MON = 'mon', TOUS = '*';
// les couleurs des stems (musique.js, STEM_COLOR ; chanson.py, STEM_COLOR) : des noms de jetons
const STEM_DOT = { vocals: 'coral-3', drums: 'or', bass: 'grn2', other: 'cy', guitar: 'amb', piano: 'coral-2', instrumental: 'cy' };
const PARTS = [['projets', 'Projets ODIO'], ['chansons', 'Chansons'], ['stems', 'Stems'], ['sons', 'Sons'], ['midi', 'MIDI']];
const R = { app: null, U: null, esp: null, ouverte: null, box: null, monte: false, r: null, stale: true, ws: undefined, t: null, seq: 0 };

const pid = () => R.app?.S.proj?.id || null;
const ouEst = () => R.app?.S.proj?.music_space || MON;      // le Space du projet ouvert
const vue = () => spaceCourant().vue;
const avertir = () => document.dispatchEvent(new CustomEvent('mu:space'));
// ce qu'on déplace, en mots (le menu des Spaces le dit dans ses bulles)
const nom = (n) => (n > 1 ? `${n} objets` : 'un objet');

/** Monter le menu des Spaces (une fois, après l'ouverture du premier projet). U : la pile
 *  d'annulation d'ODIO (commun/undo.js) ; esp() : les options d'api() du Workspace du projet ;
 *  ouverte() : la rubrique est-elle ouverte (fermée, rien ne se relit avant qu'on l'ouvre). */
export async function monterSpace(app, { U, esp, ouverte }) {
  if (R.monte || R.box) return;
  R.app = app; R.U = U; R.esp = esp; R.ouverte = ouverte;
  R.box = el('section', { class: 'nv-space', 'aria-label': 'le Space' });
  R.ws = app.S.proj?.space || null;
  // les gestes des Spaces passent par la pile d'ODIO ; annuler ou refaire relit la rubrique
  const relire = (fn) => async (...a) => { const r = await fn(...a); charger(); return r; };
  const pile = { run: (g) => U.run({ ...g, do: relire(g.do), undo: relire(g.undo) }) };
  await montrerSpaces({ box: R.box, memo: false, vue: ouEst(), esp, nom, U: pile, onChange: () => charger(), reload: () => charger() });
  R.monte = true;
  charger();
}

/** Un projet vient de s'ouvrir : la rubrique montre son Space (et relit les Spaces si son Workspace a changé). */
export async function suivreProjet(p) {
  if (!R.monte) return;
  const ws = p?.space || null;
  if (ws !== R.ws) { R.ws = ws; try { await rechargerSpaces(); } catch (e) { toast(`Spaces : ${e.message}`, 6000); } }
  const avant = vue();
  choisirSpace(p?.music_space || MON);
  if (vue() === avant) charger();   // le même Space : le projet ouvert a changé, la marque aussi
}

/** Relire ce que range le Space montré (regroupé : plusieurs demandes rapprochées n'en font
 *  qu'une ; la rubrique fermée, à son ouverture). */
export function charger() {
  R.stale = true;
  clearTimeout(R.t);
  R.t = setTimeout(lire, 60);
}
async function lire() {
  if (!R.monte || (R.ouverte && !R.ouverte())) return;
  R.stale = false;
  const v = vue(), seq = ++R.seq;
  let r;
  try {
    r = await api(`chanson/spaces/contenu?${new URLSearchParams({ space: v, ...(pid() ? { projet: pid() } : {}) })}`, R.esp?.() || {});
  } catch (e) { if (seq === R.seq) { R.r = { error: e.message }; avertir(); } return; }
  if (seq !== R.seq) return;                       // un autre Space choisi entre-temps
  R.r = r;
  // le Space du projet ouvert, qu'un autre onglet (ou un geste ici) a pu changer
  const ps = r.projet_space;
  if (ps && R.app?.S.proj) { if (ps === MON) delete R.app.S.proj.music_space; else R.app.S.proj.music_space = ps; }
  // « Déplacer vers… » sait où est chaque objet ; un Space supprimé ailleurs ramène à « Mon Space »
  spacesListe({ space: r.space, songs: [...r.chansons, ...r.stems, ...r.sons, ...r.midi], projets: r.projets });
  avertir();
}
// un travail fini (une version, des stems, un MIDI extrait) : il est peut-être né dans ce Space
document.addEventListener('sr:job', (e) => { if (R.monte && e.detail?.state === 'done') charger(); });

/** Le titre de la rubrique : « Space » et le nom du Space montré. */
export function titreSpace() {
  const v = R.monte ? vue() : ouEst();
  return v === TOUS ? 'Tous les Spaces' : (R.monte ? spaceCourant().name : ouEst() === MON ? 'Mon Space' : '…');
}

// ranger le projet ouvert dans le Space montré (la route des Spaces ; Ctrl+Z le rend)
async function rangerIci() {
  const to = vue(), id = pid();
  if (!id || to === TOUS) return;
  const dest = spaceCourant().name;
  try {
    await R.U.run({ label: `ranger le projet dans « ${dest} »`,
      do: () => api('chanson/spaces/move', { method: 'POST', body: { ids: [id], to }, ...(R.esp?.() || {}) }).then((x) => { charger(); return x; }),
      undo: (x) => (Object.keys(x?.before || {}).length
        ? api('chanson/spaces/move', { method: 'POST', body: { restore: x.before }, ...(R.esp?.() || {}) }).then(() => charger()) : null) });
    toast(`le projet est rangé dans « ${dest} » : ce qu'il génère y naît · Ctrl+Z le rend`, 5000);
  } catch (e) { toast(e.message, 7000); }
}

/** Le corps de la rubrique, peint par le navigateur (navigateur.js) avec ses outils :
 *  item(payload, opts), group(label), listen(it, bouton), playhead(). */
export function rubriqueSpace({ item, group, listen, playhead }) {
  const app = R.app;
  if (!R.monte || !app) return [el('p', { class: 'lbl nv-note' }, 'chargement des Spaces')];
  if (R.stale) charger();   // fermée pendant un changement : relue maintenant qu'on la montre
  const out = [R.box];
  const v = vue(), ici = ouEst(), r = R.r;
  // où est le projet ouvert, et le geste qui l'amène ici
  if (v === TOUS) out.push(el('p', { class: 'lbl nv-note nv-space-ou' }, `tous les Spaces · le projet est dans « ${spaceNom(ici)} »`));
  else if (v === ici) out.push(el('p', { class: 'lbl nv-note nv-space-ou' }, 'le projet est ici : ce qu’il génère y naît'));
  else {
    const arch = spaceCourant().archived;
    out.push(el('p', { class: 'lbl nv-note nv-space-ou' }, `le projet est dans « ${spaceNom(ici)} »`),
      el('button', { class: 'tb ghost sm nv-wide', type: 'button', 'data-act': 'ranger', 'aria-disabled': arch ? 'true' : null,
        title: arch ? 'ce Space est archivé : rouvre-le (⋯) pour y ranger' : 'le projet et ce qu’il générera ensuite iront dans ce Space (Ctrl+Z le rend)',
        onclick: () => (arch ? toast('ce Space est archivé : rouvre-le (⋯ à côté du Space) pour y ranger', 5000) : rangerIci()) },
      `Ranger le projet dans « ${spaceCourant().name} »`));
  }
  if (!r) { out.push(el('p', { class: 'lbl nv-note' }, 'chargement')); return out; }
  if (r.error) { out.push(el('p', { class: 'lbl nv-note warn' }, `le Space ne répond pas : ${r.error}`)); return out; }
  const tous = v === TOUS;
  const ou = (x) => (tous ? spaceNom(x.music_space) : '');
  const deplacer = (x) => ({ ...menuSpaces({ id: x.id }), sub: 'un autre Space' });
  const asset = (x) => ({ label: 'Révéler dans Asset', sub: 'sa fiche, un autre onglet', onclick: () => open(href(`asset/#${x.id}`), '_blank') });
  const son = (it, dot, sub) => {
    const btn = el('button', { class: 'nv-play', type: 'button', title: 'écouter', onclick: (e) => { e.stopPropagation(); listen(it, btn); } }, '▶');
    const n = item({ t: 'son', item: it }, { name: it.title || it.id, sub: [ou(it), ...sub].filter(Boolean).join(' · '), dot, extra: btn,
      title: 'glisser sur une piste audio (ou sous les pistes) ou dans une case de la Session · sur un échantillonneur : son son · clic : sur la piste choisie',
      ctx: () => [{ head: it.title || it.id }, { label: 'Écouter', onclick: () => listen(it, btn) }, deplacer(it), asset(it)] });
    dragItem(n, it);          // le type commun du portail (ITEM_MIME), en plus du nôtre
    n.dataset.id = it.id;
    return n;
  };
  const rows = {
    projets: (x) => {
      const ouvert = x.id === pid();
      const n = item({ t: 'projet', id: x.id }, {
        name: x.name, dot: ouvert ? 'cy' : 'ink3',
        sub: [ou(x), ouvert ? 'ouvert' : '', `${x.tracks} piste${x.tracks > 1 ? 's' : ''}`, x.mine ? '' : x.owner_name].filter(Boolean).join(' · '),
        title: ouvert ? 'le projet ouvert' : 'un projet ODIO de ce Space · clic : l’ouvrir (celui-ci s’enregistre seul)',
        onclick: () => (ouvert ? toast('ce projet est ouvert') : app.ouvrirProjet(x.id)),
        ctx: () => [{ head: x.name }, { label: ouvert ? 'Ouvert' : 'Ouvrir', disabled: ouvert, why: 'c’est le projet ouvert', onclick: () => app.ouvrirProjet(x.id) },
          { label: 'Dans un autre onglet', onclick: () => open(href(x.open), '_blank') }, deplacer(x)] });
      n.draggable = false;
      n.dataset.id = x.id;
      n.classList.add('nv-proj');
      if (ouvert) n.classList.add('on');
      return n;
    },
    chansons: (it) => son(it, 'coral-2', [it.origin?.via === 'import' ? 'importé' : 'chanson', fmtDur(it.duration)]),
    stems: (it) => son(it, STEM_DOT[it.params?.stem] || 'cy', [STEM_FR[it.params?.stem] || it.params?.stem, fmtDur(it.duration)]),
    sons: (it) => son(it, 'grn2', [it.params?.task ? 'version' : it.origin?.tool === 'upload' ? 'dépôt' : it.origin?.tool === 'music' ? 'ODIO' : '', fmtDur(it.duration)]),
    midi: (it) => {
      const n = item({ t: 'midi', id: it.id }, { name: it.title || it.id, sub: [ou(it), midiSub(it)].filter(Boolean).join(' · '), dot: it.params?.drums ? 'or' : 'cy',
        title: 'glisser sur une piste d’instrument : ses notes · ailleurs : une piste neuve par canal · clic : sur la piste choisie, à la tête de lecture',
        onclick: () => placeMidi(app, it.id, app.S.sel.track, playhead()),
        ctx: () => [{ head: it.title || it.id }, { label: 'Sur des pistes neuves', sub: 'une par canal', onclick: () => placeMidi(app, it.id, null, playhead()) }, deplacer(it), asset(it)] });
      dragItem(n, it);
      n.dataset.id = it.id;
      return n;
    },
  };
  let rien = true;
  for (const [k, label] of PARTS) {
    const xs = r[k] || [], tot = r.totals?.[k] ?? xs.length;
    if (!xs.length) continue;
    rien = false;
    out.push(group(`${label} · ${tot}`), ...xs.map(rows[k]));
    if (tot > xs.length) out.push(el('p', { class: 'lbl nv-note' }, `et ${tot - xs.length} autres : le panneau Asset les a tous`));
  }
  if (rien) out.push(el('p', { class: 'lbl nv-note' }, tous ? 'rien encore dans les Spaces' : 'rien encore ici · les chansons de l’app Musique, ce que ce projet génère, les projets ODIO y viennent'));
  return out;
}

/** Où naît un projet neuf : le Space montré dans la rubrique (« Tous » : « Mon Space »), sinon celui du projet ouvert. */
export function spacePourNeuf() {
  if (R.monte) { const c = spaceCourant(); return { music_space: c.music_space, name: c.name, archived: c.archived }; }
  const m = ouEst();
  return { music_space: m === MON ? '' : m, name: m === MON ? 'Mon Space' : '…', archived: false };
}
