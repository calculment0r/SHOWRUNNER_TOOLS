// ASSET — la page de gestion de la bibliothèque commune du portail.
//
// Cal, 30/09 : « une page dédiée aux assets pour gérer l'organisation, les
// glisser-déposer pour faire les groupes, trier par Team et Workspace : c'est
// TOUS les assets d'un user. Toutes les fonctions de gestion et d'organisation
// sont dans cette page » (le panneau Asset des outils n'est plus qu'un
// visualiseur). La page tient donc tout ce que la personne voit, dans toutes
// ses Teams et tous ses Workspaces :
//
//   à gauche, l'arbre   Tout · Récents · Favoris · Corbeille, puis chaque Team,
//                       ses Workspaces (celui de l'onglet en tête, le point),
//                       leurs dossiers — les comptes à chaque nœud ;
//   en haut             chercher, les sortes, l'auteur, la date, l'origine,
//                       le tri (date, nom, sorte, poids, Workspace), la grille
//                       ou la liste, la taille des vignettes (LE curseur) ;
//   au centre           les dossiers et les objets du lieu choisi.
//
// Les adresses (le lieu est dans l'adresse) :
//   asset/                  Tout              asset/#/recents  asset/#/favoris
//   asset/#/t/<team>        une Team          asset/#/w/<esp>  un Workspace
//   asset/#/d/<esp>/<nom>   un dossier        asset/#/corbeille
//   asset/#<id>             la fiche d'un objet (l'accueil y envoie)
//   (asset/#/d/<nom> : un dossier du Workspace de l'onglet, l'adresse d'avant)
//
// Organiser (le glisser de la page, Pointer Events : souris, doigt, stylet) :
// des cartes choisies (clic, Maj, Ctrl, le lasso) se lâchent
//   · sur un dossier (une carte-dossier, une ligne de l'arbre) : rangées dedans ;
//     la cible s'allume en vert (l'état « accepte » du thème, .drop-on) ;
//   · sur un Workspace : sorties de leur dossier — ou, venues d'un autre
//     Workspace, COPIÉES dedans (rapatrier, POST /api/espaces/<B>/rapatrier),
//     après une confirmation qui dit « copie dans … » : l'original ne bouge pas ;
//   · sur la Corbeille : jetées (jamais effacées ; « Vider la corbeille » est le
//     seul geste qui efface, par l'auteur ou un admin du Workspace) ;
//   · sur Favoris : en favori ; sur une autre carte : un dossier neuf.
// Chaque geste part DANS le Workspace de l'objet (l'en-tête X-SR-Espace) : le
// serveur y juge le rôle de la personne (server/tools/asset.py). Chaque geste
// se range dans la pile de la page (commun/undo.js) : Ctrl+Z, Ctrl+Maj+Z.
// Ne s'annulent pas : un dépôt de fichier, un import de Character Factory, un
// zip, vider la corbeille.
//
// Un dossier : un nom, dans un Workspace, sur un niveau (ARCHITECTURE.md §2) ;
// « Nouveau dossier » le déclare vide (il reste jusqu'à « Supprimer » ou
// « Dégrouper »). La fiche d'un objet (plus bas, « LA FICHE ») est celle
// d'avant : versions, lignée, planche, voix ; un objet d'un autre Workspace que
// celui de l'onglet s'y regarde et se rapatrie.
import {
  mountHeader, api, pick, thumb, kindMark, el, $, $$, href, ROOT, fmtDate, fmtDur, kindFr, etypeFr, dropAnywhere,
  dropZone, dragItem, dock, espace, espaceDocument, enTeteEspace, surEspace, ITEM_MIME, MULTI_MIME, studioSeul, lireSiBesoin,
} from '../commun/shell.js';
import { createUndo, libPatch, libBoard, keyLabel } from '../commun/undo.js';
import { prefs } from '../commun/prefs.js';
import { bind as bindView } from '../commun/proxies.js';
import { contextMenu, pageMenu, copy } from '../commun/menu.js';
import { lecteur, petitLecteur } from '../commun/lecteur.js';   // LE lecteur (30/09) : la vidéo ou le son d'une fiche, sa frise, sa tête
import { liseuse, docLigne, nomDe, unitFr } from '../commun/documents.js';   // LA liseuse (05/10) : les pages, le texte d'un document

mountHeader('asset');
// le panneau Asset commun (commun/dock.js) n'est plus monté ici (Cal, 05/10 : la page est déjà la
// bibliothèque ; commun/shell.js, DOCK.page) — ce réglage reste sans effet tant qu'il ne l'est pas
dock.configure({ kinds: ['image', 'video', 'audio', 'midi', 'sequence', 'element', 'document'], label: 'Asset',
  placeLabel: 'Ouvrir la fiche', place: (items) => { go('#' + items[0].id); }, fiche: (it) => go('#' + it.id),
  hint: 'clic : choisir · double-clic : la fiche' });

// La même base d'API que shell.js (window.SR_API, sinon le portail) : le
// dépôt passe par XMLHttpRequest, seul moyen de suivre l'envoi d'un fichier.
const API = window.SR_API ? new URL(window.SR_API, location.href) : new URL('api/', ROOT);

const amEl = $('#am');
const sideEl = $('#side');
const libEl = $('#lib');
const sheetEl = $('#sheet');
const live = (t) => { $('#live').textContent = t; };

// ── l'icône, tirée des jetons ────────────────────────────────
(function favicon() {
  const cs = getComputedStyle(document.documentElement);
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = cs.getPropertyValue('--or').trim();
  g.beginPath(); g.roundRect(0, 0, 32, 32, 6); g.fill();
  g.fillStyle = cs.getPropertyValue('--on-or').trim();
  g.beginPath(); g.roundRect(12, 12, 8, 8, 2); g.fill();
  $('link[rel="icon"]').href = c.toDataURL();
})();

// ── l'état ───────────────────────────────────────────────────
// Le tri, la taille, la sorte et la vue (grille, liste) sont des préférences de la
// personne (asset/prefs.json, commun/prefs.js) : les mêmes dans tous ses navigateurs.
const OLD = (() => { try { return JSON.parse(localStorage.getItem('sr.asset.prefs')) || {}; } catch { return {}; } })();
const S = {
  kind: prefs.get('asset.kind', OLD.kind || ''), sort: prefs.get('asset.sort', OLD.sort || 'new'), size: prefs.get('asset.size', OLD.size || 190),
  view: prefs.get('asset.view', 'grid'),
  q: '', tool: '', origin: '', author: '', since: '', limit: 300,
  data: null, tree: null, route: { view: 'lib' }, place: { k: 'all' }, folder: '', backHash: '#', item: null,
  sel: new Set(), anchor: null,   // la sélection, et d'où part une plage (maj+clic)
  spaces: [],    // les Workspaces qu'on voit (l'arbre, la vue)
};

// ── les Workspaces : où est chaque objet ─────────────────────
// `here` : le Workspace de l'onglet, tel que le portail l'a pris ; les outils n'atteignent que
// lui (un objet d'ailleurs s'y rapatrie). La page, elle, range chaque objet dans le sien.
const here = () => S.tree?.here || S.data?.here || espace();
const spaceInfo = (id) => (S.spaces || []).find((s) => s.id === id) || null;
const hereInfo = () => spaceInfo(here());
const spaceShort = (id) => spaceInfo(id)?.name || (id || '').replace(/^esp-/, '');
const spaceLong = (id) => { const s = spaceInfo(id); return s ? (s.team_name ? `${s.team_name} / ${s.name}` : s.name) : id || '?'; };
const isForeign = (it) => !!(it?.space && here() && it.space !== here());
const manySpaces = () => (S.spaces || []).length > 1;
// ce qu'un outil ne prend que dans le Workspace de l'onglet (Upscale, le Montage, un élément)
const foreignWhy = (items) => {
  const n = items.filter(isForeign).length;
  return n ? `${n > 1 ? `${n} objets sont` : 'un objet est'} d’un autre Workspace que celui de l’onglet : un outil ne le prend pas — rapatrie-le d’abord` : '';
};
// pourquoi un objet ne se copie pas dans `dest` (le serveur juge pareil : library.import_refusal,
// check_import) ; '' : il se copie
function importWhy(it, dest = here()) {
  if (it.space === dest || (!it.space && dest === here())) return `« ${it.title || it.id} » est déjà dans « ${spaceLong(dest)} »`;
  const h = spaceInfo(dest);
  if (h && h.import === false) return `copier dans « ${spaceLong(dest)} » : ${h.import_why || 'ton rôle ne le permet pas'}`;
  if (isLiving(it)) return 'un élément versionné se rapatrie avec l’étape 9 (sa version figée) — en attendant, rapatrie sa dernière version';
  if (it.kind === 'sequence') return 'une séquence pose d’autres objets de son Workspace : rapatrie ses plans';
  return '';
}
// créer dans un Workspace (déposer, un dossier, un élément) : son rôle le dit
function createWhy(space) {
  const h = spaceInfo(space);
  return h && h.create === false ? `créer dans « ${spaceLong(space)} » : ${h.create_why || 'ton rôle ne le permet pas'}` : '';
}
// la pastille d'un Workspace (capitales mono, règle 5) ; `ailleurs` : pas celui de l'onglet
const wsBadge = (id, extra = '') => el('span', { class: 'wsb' + (id && id !== here() ? ' ailleurs' : '') + extra,
  title: `Workspace · ${spaceLong(id)}${id === here() ? ' · celui de cet onglet' : ''}` }, spaceShort(id));
const savePrefs = () => { prefs.set('asset.kind', S.kind || null); prefs.set('asset.sort', S.sort); prefs.set('asset.size', S.size); prefs.set('asset.view', S.view); };
// changées ailleurs (le panneau, un autre navigateur) : la page suit
for (const k of ['kind', 'sort', 'size', 'view']) {
  prefs.on('asset.' + k, (v) => {
    const nv = v ?? ({ kind: '', sort: 'new', size: 190, view: 'grid' })[k];
    if (S[k] === nv) return;
    S[k] = nv;
    if (S.route.view === 'lib' && parts) {
      if (k === 'size') { parts.grid.style.setProperty('--card', `${S.size}px`); if (parts.size) parts.size.value = S.size; } else loadLib();
    }
  });
}
prefs.on('asset.hint', () => { const h = $('.lib-hint'); if (h) h.hidden = !prefs.get('asset.hint', true); });

// ── l'annulation ─────────────────────────────────────────────
// un geste annulé ou rétabli : la page se relit, et le bandeau d'avant (« … à la corbeille ») s'efface
// devant celui de commun/undo.js (« annulé : … »)
const U = createUndo({ name: 'asset', onapply: () => { $('.a-toast')?.classList.remove('on'); refresh(); } });
const undoBox = () => el('span', { class: 'sr-undo', role: 'group', 'aria-label': 'annuler, rétablir' }, ...U.buttons());
const what = (items) => (items.length > 1 ? plural(items.length, 'objet', 'objets') : `« ${items[0]?.title || items[0]?.id || 'l’objet'} »`);
const titleOf = (id) => S.data?.items.find((x) => x.id === id)?.title || (S.item?.id === id ? S.item.title : '') || id;
// les objets rangés par Workspace : chaque geste part dans le sien
const bySpace = (items) => {
  const m = new Map();
  for (const it of items) { const k = it.space || here() || ''; if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
  return [...m];
};

// les sortes : `sequence` (une séquence du Montage) et `midi` (un clip de
// notes d'ODIO) depuis le 29/09, `document` (tout le reste : PDF, texte, DOCX…)
// depuis le 05/10 (server/core/library.py, KINDS)
const KINDS = [['', 'Tout'], ['image', 'Images'], ['element', 'Éléments'], ['video', 'Vidéos'], ['audio', 'Sons'],
  ['sequence', 'Séquences'], ['midi', 'MIDI'], ['document', 'Documents']];
// les tris (server/tools/asset.py, SORTS)
const SORTS = [['new', 'récents'], ['old', 'anciens'], ['updated', 'modifiés'], ['title', 'nom'], ['kind', 'sorte'], ['size', 'poids'], ['space', 'Workspace']];
const DATES = [['', 'toutes dates'], ['1', 'aujourd’hui'], ['7', '7 derniers jours'], ['30', '30 derniers jours'], ['365', 'cette année']];
const ETYPES = [['character', 'personnage'], ['object', 'objet'], ['place', 'lieu'], ['style', 'style'], ['other', 'autre']];
// les rôles en usage (ARCHITECTURE.md §2)
const ROLES = [['face', 'visage'], ['full body', 'plein pied'], ['expression', 'expression'], ['outfit', 'tenue'],
  ['view', 'vue'], ['detail', 'détail'], ['style', 'style']];
const roleFr = (r) => (ROLES.find(([k]) => k === r) || [r, r || 'sans rôle'])[1];
const ROLE_FOR = { character: 'face', object: 'view', place: 'view', style: 'style', other: 'detail' };
// l'ordre compte : `library.ref_paths` rend les références dans l'ordre, et
// l'import de Character Factory les range « visage d'abord » (core_api._walk_cf)
const ORDER_HINT = {
  character: 'Visage d\'abord, puis les pleins pieds : les outils lisent les références dans cet ordre.',
  object: 'L\'image choisie d\'abord, puis ses vues : les outils lisent les références dans cet ordre.',
  other: 'La plus importante d\'abord : les outils lisent les références dans cet ordre.',
};
const TOOL_FR = {
  upload: 'upload', asset: 'Asset', image: 'Image', movie: 'Vidéo', 'character-factory': 'Character Factory',
  object: 'Object Creator', objet: 'Object Creator', montage: 'Montage', music: 'ODIO', musique: 'ODIO', odio: 'ODIO',
  analyse: 'Movie Analysis', upscale: 'Upscale', ideation: 'Idéation', selecteur: 'le sélecteur',
};
const toolFr = (t) => TOOL_FR[t] || t || 'upload';
const MEDIA = ['image', 'video', 'audio'];
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const KIND_N = { image: ['image', 'images'], element: ['élément', 'éléments'], video: ['vidéo', 'vidéos'], audio: ['son', 'sons'],
  sequence: ['séquence', 'séquences'], midi: ['clip MIDI', 'clips MIDI'], document: ['document', 'documents'] };
// les éléments versionnés (30/09, docs/etudes/apps_studio_elements.md) : une source,
// une pile de versions ; leurs sortes s'ajoutent à celles des planches
const VTYPE_FR = { music: 'musique', sound: 'son', sequence: 'séquence', picture: 'image' };
const typeFr = (t) => VTYPE_FR[t] || etypeFr(t);
const isLiving = (it) => it?.kind === 'element' && Array.isArray(it.element?.versions);
const MEDIA_KINDS = { audio: ['audio'], image: ['image'], video: ['video'], midi: ['midi'], refs: ['element'] };
const STATE_FR = { 'à jour': 'à jour', modifiée: 'modifiée', perdue: 'source perdue', 'sans version': 'pas encore publié', 'non suivie': 'source non suivie' };
const stateLine = (s) => (!s ? '' : s.state === 'modifiée' ? `modifiée depuis la v${s.since}` : STATE_FR[s.state] || s.state);
const fmtSize = (b) => (!b ? '—' : b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} Ko` : b < 1073741824 ? `${(b / 1048576).toFixed(1).replace('.', ',')} Mo` : `${(b / 1073741824).toFixed(2).replace('.', ',')} Go`);

// ── l'adresse : le lieu ──────────────────────────────────────
const ID_RX = /^(ima|vid|aud|ele|seq|mid|doc)-\d{8}-\d{6}-[0-9a-f]{4}$/;
const ESP = /^(esp-[a-z0-9][a-z0-9-]{1,47})$/;
function parseHash(raw = location.hash) {
  let h = raw.slice(1);
  try { h = decodeURIComponent(h); } catch { /* adresse abîmée : Tout */ }
  if (!h) return { view: 'lib', place: { k: 'all' } };
  if (h === '/recents') return { view: 'lib', place: { k: 'recent' } };
  if (h === '/favoris') return { view: 'lib', place: { k: 'fav' } };
  if (h === '/corbeille') return { view: 'trash', place: { k: 'trash' } };
  if (h.startsWith('/t/')) return { view: 'lib', place: { k: 'team', team: h.slice(3) } };
  if (h.startsWith('/w/') && ESP.test(h.slice(3))) return { view: 'lib', place: { k: 'space', space: h.slice(3) } };
  if (h.startsWith('/d/')) {
    // le dossier d'un Workspace : #/d/<esp-…>/<nom> (un nom de dossier n'a pas de « / ») ; #/d/<nom> : celui de l'onglet
    const m = /^(esp-[a-z0-9][a-z0-9-]{1,47})\/(.+)$/.exec(h.slice(3));
    return { view: 'lib', place: m ? { k: 'folder', space: m[1], name: m[2] } : { k: 'folder', space: null, name: h.slice(3) } };
  }
  if (ID_RX.test(h)) return { view: 'sheet', id: h };
  return { view: 'lib', place: { k: 'all' } };
}
function placeHash(p) {
  if (p.k === 'recent') return '#/recents';
  if (p.k === 'fav') return '#/favoris';
  if (p.k === 'trash') return '#/corbeille';
  if (p.k === 'team') return '#/t/' + encodeURIComponent(p.team);
  if (p.k === 'space') return '#/w/' + p.space;
  if (p.k === 'folder') return `#/d/${p.space || here()}/${encodeURIComponent(p.name)}`;
  return '#';
}
const folderHash = (name, space = null) => (!name ? (space ? placeHash({ k: 'space', space }) : '#') : placeHash({ k: 'folder', space: space || here(), name }));
const samePlace = (a, b) => a.k === b.k && (a.team || '') === (b.team || '') && (a.space || '') === (b.space || '') && (a.name || '') === (b.name || '');
// le Workspace du lieu (un Workspace, un de ses dossiers) ; null : plusieurs
const placeSpace = (p = S.place) => (p.k === 'space' || p.k === 'folder' ? p.space || here() : null);
// où va ce qu'on crée depuis ce lieu (déposer, un élément, un dossier) : son Workspace, sinon celui de l'onglet
const target = () => placeSpace() || here();
// compat : la fiche et ses fenêtres lisent le dossier ouvert
const foreignFolder = () => false;
const teamOf = (id) => (S.tree?.teams || []).find((t) => t.id === id) || null;
function go(hash) {
  if (S.route.view !== 'sheet' && hash.length > 1 && ID_RX.test(hash.slice(1))) S.backHash = location.hash || '#';
  if (location.hash === hash || (hash === '#' && !location.hash)) render();
  else location.hash = hash;
}

async function render() {
  const r = parseHash();
  if (r.place?.k === 'folder' && !r.place.space) r.place.space = here();
  S.route = r;
  closeMenu();
  document.body.classList.remove('side-open');
  amEl.hidden = r.view === 'sheet';
  sheetEl.hidden = r.view !== 'sheet';
  paintSel();                                  // la barre de sélection ne vit que sur la grille
  if (r.view === 'sheet') { window.scrollTo({ top: 0 }); return paintSheet(r.id); }
  espaceDocument(null);                        // plus de fiche ouverte : l'en-tête ne dit plus son Workspace
  if (!samePlace(S.place, r.place)) { S.sel = new Set(); S.anchor = null; }
  S.place = r.place;
  S.folder = r.place.k === 'folder' ? r.place.name : '';
  loadTree();
  if (r.view === 'trash') return paintTrash();
  buildLib();
  return loadLib();
}
addEventListener('hashchange', render);
// l'onglet change de Workspace (le sélecteur de l'en-tête) : la page suit, sans se recharger
surEspace(() => { S.sel = new Set(); S.data = null; S.tree = null; render(); });

// ── le bandeau, avec « annuler » ─────────────────────────────
// « annuler » dans le bandeau est Ctrl+Z : le dernier geste de la pile
// (undo = true), celui que le bandeau vient d'annoncer.
let toastT;
function say(msg, undo = false, ms = 6000) {
  let t = $('.a-toast');
  if (!t) {
    t = el('div', { class: 'a-toast', role: 'status' }, el('span', { class: 't' }),
      el('button', { class: 'linkish', type: 'button' }, 'annuler'));
    document.body.append(t);
  }
  $('.t', t).textContent = msg;
  // un seul bandeau à la fois : celui de shell.js (dépôts) s'efface devant le mien
  $('.toast.on')?.classList.remove('on');
  const b = $('button', t);
  const top = undo ? U.done[U.done.length - 1] : null;
  b.hidden = !top;
  b.title = top ? `${U.labels().undo} · ${keyLabel('undo')}` : '';
  b.onclick = async () => {
    t.classList.remove('on');
    if (U.done[U.done.length - 1] !== top) { say('ce geste n’est plus le dernier : le journal (↺) y ramène'); return; }
    const e = await U.undo();
    if (e) live('annulé');
  };
  t.classList.add('on');
  live(msg);
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), ms);
}

// ══ L'ARBRE : Teams → Workspaces → dossiers ═════════════════
// GET /api/asset/tree. Replié ou déplié : une commodité de ce navigateur (localStorage).
const TREE_KEY = 'sr.asset.tree';
const closed = (() => { try { return new Set(JSON.parse(localStorage.getItem(TREE_KEY)) || []); } catch { return new Set(); } })();
const saveClosed = () => { try { localStorage.setItem(TREE_KEY, JSON.stringify([...closed])); } catch { /* sans stockage : pour cette visite */ } };
let treeSeq = 0;
async function loadTree() {
  const seq = ++treeSeq;
  let t;
  try { t = await api('asset/tree'); } catch (e) { if (!S.tree) sideEl.replaceChildren(el('p', { class: 'warn' }, `l’arbre ne répond pas : ${e.message}`)); return; }
  if (seq !== treeSeq) return;
  S.tree = t;
  const nodes = t.teams.flatMap((tm) => tm.spaces);
  if (nodes.length) S.spaces = nodes;
  paintTree();
  if (S.route.view === 'lib' && parts && S.data) { paintTop(); paintCrumbs(); }
}
let newFolderIn = null;   // le Workspace où l'on tape le nom d'un dossier neuf
function paintTree() {
  const t = S.tree;
  if (!t) return;
  const P = S.place;
  const row = ({ cls = '', depth = 0, label, count = null, hash, on = false, drop = null, caret = null, lead = null, tail = null, title = '', data = {} }) => {
    const a = el('a', { class: `tr ${cls}${on ? ' on' : ''}`, href: hash, style: { '--d': depth }, title: title || null,
      'aria-current': on ? 'page' : null, 'data-drop': drop, ...data },
    caret, lead, el('span', { class: 'tn' }, label), tail, count === null ? null : el('span', { class: 'n' }, String(count)));
    return a;
  };
  const caretBtn = (key, name) => el('button', { class: 'cv' + (closed.has(key) ? '' : ' open'), type: 'button', 'aria-expanded': String(!closed.has(key)),
    'aria-label': `${closed.has(key) ? 'déplier' : 'replier'} ${name}`, onclick: (e) => {
      e.preventDefault(); e.stopPropagation();
      if (closed.has(key)) closed.delete(key); else closed.add(key);
      saveClosed(); paintTree();
    } });
  const out = [
    el('div', { class: 'side-head' }, el('span', { class: 'kicker' }, 'la bibliothèque')),
    row({ cls: 'q', label: 'Tout', count: t.total, hash: '#', on: P.k === 'all', lead: el('i', { class: 'ico all', 'aria-hidden': 'true' }), title: 'tout ce que tu vois, dans toutes tes Teams' }),
    row({ cls: 'q', label: 'Récents', count: t.recent, hash: '#/recents', on: P.k === 'recent', lead: el('i', { class: 'ico recent', 'aria-hidden': 'true' }), title: 'touchés ces 7 derniers jours' }),
    row({ cls: 'q', label: 'Favoris', count: t.fav, hash: '#/favoris', on: P.k === 'fav', drop: 'fav', lead: el('i', { class: 'ico fav', 'aria-hidden': 'true' }, '★'), title: 'glisser ici : en favori' }),
    row({ cls: 'q', label: 'Corbeille', count: t.trash, hash: '#/corbeille', on: P.k === 'trash', drop: 'trash', lead: el('i', { class: 'ico trash', 'aria-hidden': 'true' }), title: 'glisser ici : à la corbeille (rien ne s’efface)' }),
    el('div', { class: 'side-sec' }, el('span', { class: 'lbl' }, 'Teams · Workspaces')),
  ];
  for (const tm of t.teams) {
    const tkey = 't:' + tm.id;
    const many = t.teams.length > 1 || tm.spaces.length > 1;
    if (tm.id && many) {
      out.push(row({ cls: 'team', label: tm.name || 'Team', count: tm.count, hash: placeHash({ k: 'team', team: tm.id }), on: P.k === 'team' && P.team === tm.id,
        caret: caretBtn(tkey, tm.name), title: `la Team ${tm.name}${tm.personal ? ' (personnelle)' : ''} : tous ses Workspaces` }));
      if (closed.has(tkey)) continue;
    }
    for (const s of tm.spaces) {
      const skey = 's:' + s.id;
      const depth = tm.id && many ? 1 : 0;
      const plus = el('button', { class: 'plus', type: 'button', title: createWhy(s.id) || `un dossier neuf dans « ${s.name} »`, 'aria-label': `nouveau dossier dans ${s.name}`,
        disabled: !!createWhy(s.id), onclick: (e) => { e.preventDefault(); e.stopPropagation(); closed.delete(skey); newFolderIn = s.id; paintTree(); } }, '+');
      out.push(row({ cls: 'ws' + (s.here ? ' here' : ''), depth, label: s.name, count: s.count, hash: placeHash({ k: 'space', space: s.id }),
        on: P.k === 'space' && P.space === s.id, drop: 'space', data: { 'data-space': s.id },
        caret: s.folders.length || newFolderIn === s.id ? caretBtn(skey, s.name) : el('span', { class: 'cv none' }),
        lead: el('i', { class: 'dot' + (s.here ? ' on' : ''), 'aria-hidden': 'true' }), tail: plus,
        title: `${s.team_name ? `${s.team_name} / ` : ''}${s.name}${s.here ? ' · le Workspace de cet onglet' : ''} — glisser ici : sortir d’un dossier, ou copier d’un autre Workspace` }));
      if (closed.has(skey)) continue;
      for (const f of s.folders) {
        const on = P.k === 'folder' && P.space === s.id && P.name === f.name;
        out.push(row({ cls: 'fo', depth: depth + 1, label: f.name, count: f.count, hash: placeHash({ k: 'folder', space: s.id, name: f.name }), on, drop: 'folder',
          data: { 'data-space': s.id, 'data-folder': f.name }, lead: el('i', { class: 'dir', 'aria-hidden': 'true' }),
          title: `${f.name} · ${plural(f.count, 'objet', 'objets')} — glisser ici pour y ranger ; double-clic : renommer` }));
      }
      if (newFolderIn === s.id) out.push(newFolderRow(s, depth + 1));
    }
  }
  sideEl.replaceChildren(el('nav', { class: 'tree', 'aria-label': 'les lieux de la bibliothèque' }, ...out));
  // des fichiers du disque lâchés sur un dossier, un Workspace de l'arbre : déposés là
  for (const r of $$('[data-drop="folder"], [data-drop="space"]', sideEl)) {
    fileDrop(r, (files) => uploadFiles(files, { folder: r.dataset.folder || '', space: r.dataset.space }));
  }
  $('.nf input', sideEl)?.focus();
}
// le nom d'un dossier neuf, tapé dans l'arbre ; Entrée crée (Ctrl+Z l'oublie), Échap renonce
function newFolderRow(s, depth) {
  const inp = el('input', { class: 'fld', maxlength: 60, placeholder: 'nom du dossier', 'aria-label': `nom du dossier neuf dans ${s.name}`, spellcheck: 'false' });
  const done = () => { newFolderIn = null; paintTree(); };
  inp.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); done(); }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const name = inp.value.trim();
    if (!name) { inp.placeholder = 'il lui faut un nom'; return; }
    newFolderIn = null;
    await createFolder(name, s.id);
  });
  inp.addEventListener('blur', () => setTimeout(() => { if (newFolderIn === s.id && !inp.value.trim()) done(); }, 150));
  return el('div', { class: 'tr nf', style: { '--d': depth } }, el('i', { class: 'dir', 'aria-hidden': 'true' }), inp);
}
// renommer un dossier dans l'arbre (double-clic sur sa ligne)
sideEl.addEventListener('dblclick', (e) => {
  const r = e.target.closest('.tr.fo');
  if (!r) return;
  e.preventDefault();
  renameFolderInline(r.dataset.folder, r.dataset.space, r);
});

// ══ LA BIBLIOTHÈQUE ═════════════════════════════════════════
let parts = null;
function buildLib() {
  if (parts && libEl.contains(parts.grid)) return;
  const fileIn = el('input', { type: 'file', multiple: true, hidden: true, accept: 'image/*,video/*,audio/*',
    onchange: () => { uploadFiles([...fileIn.files], { folder: S.folder, space: target() }); fileIn.value = ''; } });
  parts = {
    crumbs: el('nav', { class: 'crumbs', 'aria-label': 'où' }),
    who: el('div', { class: 'who' }),
    acts: el('div', { class: 'acts' }),
    bar: el('div', { class: 'lib-bar', role: 'toolbar', 'aria-label': 'chercher, filtrer, trier' }),
    grid: el('div', { class: 'lib-grid', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': 'les objets' }),
    more: el('div', { class: 'row more-row' }),
    fileIn,
  };
  const hint = el('p', { class: 'lib-hint lbl', hidden: !prefs.get('asset.hint', true) },
    `clic : choisir · double-clic : ouvrir · ctrl / maj + clic : ajouter, une plage · glisser sur le fond : une zone · glisser des cartes sur un dossier, un Workspace, la corbeille · ${keyLabel('undo')} : annuler`);
  libEl.replaceChildren(el('section', { class: 'lib-top' }, el('div', { class: 'who-col' }, parts.crumbs, parts.who), parts.acts), parts.bar, hint, parts.grid, parts.more, fileIn);
  buildBar();
}

function buildBar() {
  const b = parts.bar;
  const search = el('input', { class: 'fld', type: 'search', placeholder: 'chercher : titre, prompt, tag, description', 'aria-label': 'chercher', value: S.q });
  let t;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { S.q = search.value.trim(); loadLib(); }, 220); });
  const sort = el('select', { class: 'fld', 'aria-label': 'trier' }, ...SORTS.map(([v, l]) => el('option', { value: v, selected: S.sort === v }, `tri · ${l}`)));
  sort.onchange = () => { S.sort = sort.value; savePrefs(); loadLib(); };
  const author = el('select', { class: 'fld', 'aria-label': 'auteur' });
  author.onchange = () => { S.author = author.value; loadLib(); };
  const date = el('select', { class: 'fld', 'aria-label': 'date' }, ...DATES.map(([v, l]) => el('option', { value: v, selected: S.since === v }, l)));
  date.onchange = () => { S.since = date.value; loadLib(); };
  // l'origine : créé dans un outil ou déposé, et l'outil (un seul menu)
  const origin = el('select', { class: 'fld', 'aria-label': 'origine' });
  origin.onchange = () => {
    const [k, v] = origin.value.split(':');
    S.origin = k === 'o' ? v : ''; S.tool = k === 't' ? v : '';
    loadLib();
  };
  const size = el('input', { type: 'range', min: 120, max: 340, step: 10, value: S.size, 'aria-label': 'taille des vignettes' });
  size.oninput = () => { S.size = +size.value; parts.grid.style.setProperty('--card', `${S.size}px`); savePrefs(); };
  const viewSeg = el('div', { class: 'seg vseg', role: 'radiogroup', 'aria-label': 'la vue' },
    ...[['grid', 'Grille', 'des vignettes'], ['list', 'Liste', 'une ligne par objet : Workspace, dossier, auteur, poids, date']].map(([v, l, tt]) => el('button', {
      class: 'tb' + (S.view === v ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(S.view === v), title: tt, 'data-view': v,
      onclick: () => { S.view = v; savePrefs(); paintGrid(); paintBar(); } }, el('i', { class: `vi ${v}`, 'aria-hidden': 'true' }), l)));
  const clear = el('button', { class: 'tb ghost sm clear', type: 'button', title: 'retirer la recherche et tous les filtres', hidden: true,
    onclick: () => { S.q = ''; S.kind = ''; S.author = ''; S.since = ''; S.origin = ''; S.tool = ''; search.value = ''; savePrefs(); loadLib(); } }, 'Effacer les filtres');
  const lieux = el('button', { class: 'tb ghost sm lieux', type: 'button', 'aria-controls': 'side', title: 'les Teams, les Workspaces, les dossiers',
    onclick: () => document.body.classList.toggle('side-open') }, 'Lieux');
  parts.seg = el('div', { class: 'seg kseg', role: 'radiogroup', 'aria-label': 'sorte' });
  Object.assign(parts, { search, sort, author, date, origin, size, viewSeg, clear });
  const sizeBox = el('label', { class: 'size', title: 'taille des vignettes' }, el('span', { class: 'lbl' }, 'taille'), size);
  parts.sizeBox = sizeBox;
  b.replaceChildren(
    el('div', { class: 'bar-row' }, lieux, search, parts.seg),
    el('div', { class: 'bar-row' }, sort, author, date, origin, clear, el('span', { class: 'sp' }), viewSeg, sizeBox));
  parts.grid.style.setProperty('--card', `${S.size}px`);
}

// les paramètres de la vue pour le lieu et les filtres
function viewParams(extra = {}) {
  const P = S.place;
  const p = new URLSearchParams({ sort: S.sort, limit: S.limit, ...extra });
  if (S.kind) p.set('kind', S.kind);
  if (S.q) p.set('q', S.q);
  if (S.tool) p.set('tool', S.tool);
  if (S.origin) p.set('origin', S.origin);
  if (S.author) p.set('author', S.author);
  if (S.since) p.set('since', S.since);
  if (P.k === 'recent') { p.set('flat', '1'); if (!S.since || +S.since > 7) p.set('since', '7'); }
  if (P.k === 'fav') { p.set('flat', '1'); p.set('fav', '1'); }
  if (P.k === 'team') { const tm = teamOf(P.team); if (tm) p.set('space', tm.spaces.map((s) => s.id).join(',')); }
  if (P.k === 'space') p.set('space', P.space);
  if (P.k === 'folder') { p.set('folder', P.name); p.set('fspace', P.space); }
  return p;
}
let loadSeq = 0;
async function loadLib({ append = false } = {}) {
  if (!parts) return;
  // une Team : l'arbre dit ses Workspaces ; attendre qu'il soit là
  if (S.place.k === 'team' && !S.tree) { await loadTree(); }
  const p = viewParams({ offset: append ? S.data.items.length : 0 });
  const seq = ++loadSeq;
  let d;
  try { d = await api('asset/view?' + p); } catch (e) {
    parts.grid.replaceChildren(el('p', { class: 'warn' }, `la bibliothèque ne répond pas : ${e.message}`));
    return;
  }
  if (seq !== loadSeq) return;
  if (append) { S.data.items.push(...d.items); S.data.total = d.total; } else S.data = d;
  if (!S.tree && d.spaces?.length) S.spaces = d.spaces;
  // la sélection ne garde que ce qui est encore à l'écran
  const shown = new Set(S.data.items.map((i) => i.id));
  S.sel = new Set([...S.sel].filter((id) => shown.has(id)));
  paintTop(); paintCrumbs(); paintBar(); paintGrid(); paintSel(true);
}

function countLine(c) {
  return Object.entries(KIND_N).filter(([k]) => c[k]).map(([k, [one, many]]) => plural(c[k], one, many)).join(' · ') || 'vide';
}
function placeTitle(p = S.place) {
  if (p.k === 'recent') return 'Récents';
  if (p.k === 'fav') return 'Favoris';
  if (p.k === 'trash') return 'Corbeille';
  if (p.k === 'team') return teamOf(p.team)?.name || 'Team';
  if (p.k === 'space') return spaceShort(p.space);
  if (p.k === 'folder') return p.name;
  return 'Asset';
}
// le fil : Asset / Team / Workspace / dossier — un Workspace du fil reçoit aussi un glisser
function paintCrumbs() {
  const P = S.place;
  if (P.k === 'all') { parts.crumbs.replaceChildren(); return; }
  const c = [el('a', { class: 'crumb', href: '#' }, 'Asset')];
  const sp = placeSpace(P);
  const info = sp ? spaceInfo(sp) : null;
  const sep = () => el('span', { class: 'lbl' }, '/');
  if (P.k === 'team') c.push(sep(), el('span', { class: 'crumb cur' }, placeTitle(P)));
  if (sp) {
    if (info?.team) c.push(sep(), el('a', { class: 'crumb', href: placeHash({ k: 'team', team: info.team }) }, info.team_name || 'Team'));
    c.push(sep(), P.k === 'folder'
      ? el('a', { class: 'crumb', href: placeHash({ k: 'space', space: sp }), 'data-drop': 'space', 'data-space': sp, title: 'glisser ici : sortir du dossier' }, spaceShort(sp))
      : el('span', { class: 'crumb cur' }, spaceShort(sp)));
  }
  if (P.k === 'folder') c.push(sep(), el('span', { class: 'crumb cur' }, P.name));
  if (P.k === 'recent' || P.k === 'fav' || P.k === 'trash') c.push(sep(), el('span', { class: 'crumb cur' }, placeTitle(P)));
  parts.crumbs.replaceChildren(...c);
}

function paintTop() {
  const d = S.data;
  const P = S.place;
  const sp = target();
  const noCreate = createWhy(sp);
  const where = `dans « ${spaceLong(sp)} »`;
  const drop = (label) => (parts.dropBtn = el('button', { class: 'tb go', type: 'button', disabled: !!noCreate, onclick: () => parts.fileIn.click(),
    title: noCreate || `${where}${S.folder ? `, dossier « ${S.folder} »` : ''} — ou glisser des fichiers n’importe où sur la page` }, label));
  const more = el('button', { class: 'tb ghost more-btn', type: 'button', 'aria-haspopup': 'menu', title: 'les gestes de ce lieu', 'aria-label': 'plus',
    onclick: (e) => { e.stopPropagation(); toggleMenu(e.currentTarget, placeMenu()); } }, '⋯');
  const h1 = el('h1', { class: 'lib-h' }, placeTitle(P));
  if (P.k === 'folder') {
    h1.setAttribute('data-rename', ''); h1.title = 'renommer'; h1.tabIndex = 0;
    h1.onclick = () => renameFolderInline(P.name, P.space, h1);
    h1.onkeydown = (e) => { if (e.key === 'Enter') renameFolderInline(P.name, P.space, h1); };
  }
  parts.who.replaceChildren(h1);
  if (P.k === 'folder') {
    parts.acts.replaceChildren(undoBox(),
      el('button', { class: 'tb ghost', type: 'button', onclick: () => renameFolderInline(P.name, P.space, h1) }, 'Renommer'),
      el('button', { class: 'tb ghost', type: 'button', title: 'ses objets reviennent au Workspace, hors dossier ; le dossier disparaît', onclick: () => ungroupFolder(P.name, P.space) }, 'Dégrouper'),
      el('button', { class: 'tb ghost', type: 'button', title: 'ses objets vont à la corbeille (ils reviennent d’un clic, dans ce dossier)', onclick: () => deleteFolderAsk(P.name, P.space) }, 'Supprimer'),
      drop('Déposer ici'));
  } else {
    const nf = el('button', { class: 'tb ghost', type: 'button', disabled: !!noCreate, title: noCreate || `un dossier vide ${where}`,
      onclick: () => { closed.delete('s:' + sp); newFolderIn = sp; paintTree(); document.body.classList.add('side-open'); } }, 'Nouveau dossier');
    parts.acts.replaceChildren(undoBox(), nf,
      el('button', { class: 'tb ghost', type: 'button', disabled: !!noCreate, title: noCreate || `${where} : une planche de références`, onclick: () => elementModal({ space: sp }) }, 'Nouvel élément'),
      more, drop('Déposer des fichiers'));
    if (noCreate) parts.acts.append(el('p', { class: 'hint why-line' }, noCreate));
  }
  if (S.renameOnLoad && P.k === 'folder' && S.renameOnLoad === P.name) { S.renameOnLoad = null; renameFolderInline(P.name, P.space, h1); }
}
// les gestes du lieu qui ne méritent pas un bouton
function placeMenu() {
  const sp = target();
  const noCreate = createWhy(sp);
  return { title: `${placeTitle()} · ${spaceShort(sp)}`, items: [
    { label: 'Importer de Character Factory…', disabled: !!noCreate, why: noCreate, do: cfModal },
    { label: 'Tout choisir · Ctrl+A', do: selectAll },
    { label: S.view === 'grid' ? 'Voir en liste' : 'Voir en grille', do: () => { S.view = S.view === 'grid' ? 'list' : 'grid'; savePrefs(); paintGrid(); paintBar(); } },
    '-',
    { label: 'La corbeille', do: () => go('#/corbeille') },
  ] };
}

function paintBar() {
  const d = S.data;
  const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
  parts.seg.replaceChildren(...KINDS.map(([k, lab]) => el('button', {
    class: 'tb' + (S.kind === k ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(S.kind === k),
    onclick: () => { S.kind = k; savePrefs(); loadLib(); },
  }, lab, el('b', {}, String(k ? d.counts[k] : total)))));
  const au = d.authors || [];
  parts.author.replaceChildren(el('option', { value: '' }, 'tous les auteurs'),
    ...au.map((a) => el('option', { value: a.id, selected: S.author === a.id }, `${a.name} · ${a.count}`)));
  if (S.author && !au.some((a) => a.id === S.author)) parts.author.append(el('option', { value: S.author, selected: true }, S.author));
  const o = d.origins || { upload: 0, made: 0 };
  const tools = Object.entries(d.tools).filter(([t]) => t !== 'upload').sort((a, b) => b[1] - a[1]);
  const cur = S.origin ? `o:${S.origin}` : S.tool ? `t:${S.tool}` : '';
  parts.origin.replaceChildren(el('option', { value: '' }, `toutes origines · ${o.upload + o.made}`),
    el('option', { value: 'o:made', selected: cur === 'o:made' }, `créations · ${o.made}`),
    el('option', { value: 'o:upload', selected: cur === 'o:upload' }, `uploads · ${o.upload}`),
    tools.length ? el('optgroup', { label: 'par outil' }, ...tools.map(([t, k]) => el('option', { value: `t:${t}`, selected: cur === `t:${t}` }, `${toolFr(t)} · ${k}`))) : null);
  if (parts.sort.value !== S.sort) parts.sort.value = S.sort;
  if (parts.date.value !== S.since) parts.date.value = S.since;
  if (document.activeElement !== parts.search && parts.search.value.trim() !== S.q) parts.search.value = S.q;
  parts.clear.hidden = !(S.q || S.kind || S.author || S.since || S.origin || S.tool);
  for (const bt of $$('[data-view]', parts.viewSeg)) { const on = bt.dataset.view === S.view; bt.classList.toggle('on', on); bt.setAttribute('aria-checked', String(on)); }
  // la taille : les vignettes de la grille ; la liste a ses lignes (le curseur dit pourquoi il attend)
  parts.size.disabled = S.view === 'list';
  parts.sizeBox.title = S.view === 'list' ? 'la liste a des lignes de taille fixe : la taille vaut pour la grille' : 'taille des vignettes';
}

function paintGrid() {
  const d = S.data;
  const list = S.view === 'list';
  parts.grid.className = list ? 'lib-list' : 'lib-grid';
  const cards = list
    ? [listHead(), ...d.folders.map(folderRow), ...d.items.map(listRow)]
    : [...d.folders.map(folderCard), ...d.items.map((it) => itemCard(it))];
  if (!d.folders.length && !d.items.length) {
    const filtered = S.kind || S.q || S.author || S.since || S.tool || S.origin;
    const P = S.place;
    cards.push(el('div', { class: 'empty-state', style: { gridColumn: '1 / -1' } },
      el('b', {}, filtered ? 'Rien avec ces filtres' : P.k === 'folder' ? 'Ce dossier est vide' : P.k === 'fav' ? 'Aucun favori'
        : P.k === 'recent' ? 'Rien de touché ces 7 jours' : 'Rien ici'),
      el('p', { class: 'hint' }, filtered ? 'Change de sorte, d’auteur ou de date, ou efface les filtres.'
        : P.k === 'folder' ? 'Glisse des cartes sur ce dossier (dans l’arbre, à gauche), ou dépose des fichiers ici.'
          : P.k === 'fav' ? 'Glisse des cartes sur « Favoris », ou F sur une sélection.'
            : 'Dépose des fichiers n’importe où sur la page, importe un personnage de Character Factory, ou crée une image dans Image.'),
      filtered ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => parts.clear.click() }, 'Effacer les filtres') : null));
  }
  parts.grid.replaceChildren(...cards);
  const shown = d.items.length;
  parts.more.replaceChildren(...(d.total > shown ? [
    el('span', { class: 'lbl' }, `${shown} sur ${d.total}`),
    el('button', { class: 'tb ghost sm', type: 'button', onclick: () => loadLib({ append: true }) }, 'Voir la suite')] : []));
  paintSel();
}

// ── les cartes ───────────────────────────────────────────────
function wave(n = 9) {
  const hs = [38, 62, 84, 55, 96, 70, 44, 78, 52, 66, 90, 48];
  return el('span', { class: 'wave', 'aria-hidden': 'true' }, ...Array.from({ length: n }, (_, k) => el('i', { style: { height: `${hs[k % hs.length]}%` } })));
}

// un clip MIDI sans image : quelques notes sur une portée ; une séquence sans
// image (aucun plan qui se voie) : la bande d'un film — comme la vague d'un son
function roll(n = 11) {
  const ys = [64, 42, 52, 28, 64, 36, 48, 22, 58, 40, 30, 54], ws = [14, 8, 10, 18, 8, 12, 9, 16, 11, 8, 13];
  let x = 0;
  return el('span', { class: 'roll', 'aria-hidden': 'true' }, ...Array.from({ length: n }, (_, k) => {
    const w = ws[k % ws.length], i = el('i', { style: { left: `${x}%`, top: `${ys[k % ys.length]}%`, width: `${w}%` } });
    x = Math.min(96 - w, x + w * 0.62 + 2);
    return i;
  }));
}
function strip(n = 5) {
  return el('span', { class: 'strip', 'aria-hidden': 'true' }, ...Array.from({ length: n }, () => el('i')));
}
// ce qu'une vignette montre quand l'objet n'a pas d'image
function glyph(kind, small = false) {
  if (kind === 'audio') return null;   // la vraie onde vient de thumb() (api/son/apercu)
  if (kind === 'midi') return roll(small ? 6 : 11);
  if (kind === 'sequence') return strip(small ? 3 : 5);
  return null;
}

function subOf(it) {
  const p = it.params || {};
  if (it.kind === 'midi') return [p.bars ? `${p.bars} mes.` : '', p.notes ? `${p.notes} notes` : '', p.bpm ? `${p.bpm} bpm` : '', toolFr(it.origin?.tool)].filter(Boolean).join(' · ');
  if (it.kind === 'sequence') return [p.clips != null ? plural(p.clips, 'plan', 'plans') : '', it.duration ? fmtDur(it.duration) : '', p.format || ''].filter(Boolean).join(' · ');
  if (it.kind === 'document') return [it.doc?.label || '', unitFr(it.doc?.pages, it.doc?.unit), toolFr(it.origin?.tool)].filter(Boolean).join(' · ');
  if (isLiving(it)) return [it.element.head ? `v${it.element.head}` : 'sans version', plural(it.element.count || 0, 'version', 'versions'), stateLine(it.source_state)].filter(Boolean).join(' · ');
  if (it.kind === 'element') return `${plural(it.element?.refs?.length || 0, 'réf.', 'réf.')}${it.element?.voices?.length ? ' · voix' : ''}${it.element?.meshes?.length ? ' · 3D' : ''} · ${toolFr(it.origin?.tool)}`;
  return [it.width && it.height ? `${it.width}×${it.height}` : '', it.origin?.model || toolFr(it.origin?.tool)].filter(Boolean).join(' · ');
}
// montrer le Workspace de chaque carte : quand le lieu en mêle plusieurs
const showSpace = () => manySpaces() && !placeSpace();

function itemCard(it) {
  const t = thumb(it, { sub: subOf(it), onclick: (e) => onCardClick(e, it) });
  // le glisser d'une carte est celui de la page (ranger, dossiers), pas celui du navigateur
  t.draggable = false;
  t.setAttribute('aria-label', `${it.kind === 'element' ? typeFr(it.element?.type) : kindFr(it.kind)} ${it.title}`);
  t.addEventListener('dblclick', () => go('#' + it.id));
  t.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go('#' + it.id); }
    if (e.key === ' ') { e.preventDefault(); toggleSel(it.id); }
  });
  const im = $('.im', t);
  const living = isLiving(it);
  if (living) {
    // un élément versionné : sa sorte en français sur la pastille commune, la vague de sa
    // dernière version si elle est un son, et la pile (vN, le nombre de versions, l'état de sa source)
    const kt = $('.kmark .kt', im);
    if (kt) kt.textContent = typeFr(it.element.type);
    if (!it.thumb_url && glyph(it.element.head_kind)) im.prepend(glyph(it.element.head_kind));
    if (it.element.head_duration && !$('.dur', im)) im.append(el('span', { class: 'dur' }, fmtDur(it.element.head_duration)));
    const s = it.source_state;
    im.append(el('span', { class: 'verb' + (s?.state === 'modifiée' ? ' dirty' : '') + (it.element.head ? '' : ' none'),
      title: [it.element.head ? `la dernière version : v${it.element.head}` : 'pas encore de version', stateLine(s)].filter(Boolean).join(' · ') },
    it.element.head ? `v${it.element.head}` : 'v—', it.element.count > 1 ? el('i', {}, `/${it.element.count}`) : null));
  } else if (!it.thumb_url && glyph(it.kind)) im.prepend(glyph(it.kind));
  if (it.version?.of) im.append(el('span', { class: 'verb of', title: it.version.of_present ? `v${it.version.n} de « ${it.version.of_title} »` : 'son élément est à la corbeille' }, `v${it.version.n}`));
  if (it.kind === 'element' && !it.thumb_url && !(living && glyph(it.element.head_kind))) im.prepend(el('span', { class: 'noimg' }, living && !it.element.head ? 'pas encore publié' : 'sans image'));
  if (it.fav) im.append(el('span', { class: 'star', title: 'favori' }, '★'));
  if (it.folder && S.place.k !== 'folder') im.append(el('span', { class: 'where', title: 'dans ce dossier' }, it.folder));
  // un élément qui a une voix le montre : la même voix d'un plan à l'autre
  const voice = it.kind === 'element' ? it.element?.voices?.[0] : null;
  if (voice) im.append(el('span', { class: 'vbadge', title: `sa voix · ${voice.label || 'voix'}` }, el('i', { 'aria-hidden': 'true' }), el('i'), el('i'),
    `voix${voice.duration ? ` · ${fmtDur(voice.duration)}` : ''}`));
  if (it.kind === 'video' && it.url) {
    // au survol, la vidéo joue en muet
    t.addEventListener('mouseenter', () => { if (!drag && !$('.live', im)) im.append(el('video', { class: 'live', src: href(it.url), muted: true, autoplay: true, loop: true, playsinline: true })); });
    t.addEventListener('mouseleave', () => $('.live', im)?.remove());
  }
  const on = S.sel.has(it.id);
  if (on) t.classList.add('sel');
  // son Workspace, en tête de la ligne du bas, quand le lieu en mêle plusieurs
  if (showSpace() && it.space) $('.cap .s', t)?.prepend(wsBadge(it.space));
  if (isForeign(it)) t.setAttribute('aria-label', `${t.getAttribute('aria-label')}, dans ${spaceLong(it.space)}`);
  return el('div', { class: 'acard' + (on ? ' sel' : '') + (living && it.element.count > 1 ? ' stack' : ''),
    'data-id': it.id, 'data-space': it.space || null, role: 'option', 'aria-selected': String(on) }, t,
    el('button', { class: 'chk', type: 'button', 'aria-pressed': String(on), title: 'choisir (ctrl/⌘ + clic)', 'aria-label': `choisir ${it.title}`,
      onclick: (e) => { e.stopPropagation(); toggleSel(it.id); } }),
    el('button', { class: 'menu-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'ranger, copier, jeter',
      'aria-label': `ranger ${it.title}`, onclick: (e) => { e.stopPropagation(); toggleMenu(e.currentTarget, itemMenu(it)); } }, '⋯'));
}

// ── la liste : une ligne par objet ───────────────────────────
// les colonnes se trient d'un clic (les mêmes tris que le menu)
const COLS = [['', ''], ['', ''], ['title', 'nom'], ['kind', 'sorte'], ['space', 'Workspace'], ['', 'dossier'], ['', 'auteur'], ['size', 'poids'], ['updated', 'modifié'], ['', '']];
function listHead() {
  return el('div', { class: 'lrow lhead', role: 'presentation' }, ...COLS.map(([k, l]) => (k
    ? el('button', { class: 'lh' + (S.sort === k ? ' on' : ''), type: 'button', title: `trier par ${l}`, onclick: () => { S.sort = k; savePrefs(); loadLib(); } }, l, S.sort === k ? ' ↓' : '')
    : el('span', { class: 'lh' }, l))));
}
const authorName = (id) => (S.data?.authors || []).find((a) => a.id === (id || ''))?.name || id || '—';
function lthumb(it) {
  const pic = it.thumb_url || it.views?.length ? bindView(el('img', { alt: '', loading: 'lazy', decoding: 'async' }), it, { fit: 'cover', box: [44, 44] })
    : glyph(it.kind, true) || kindMark(it, { compact: true });
  return el('span', { class: 'lt' }, pic);
}
function listRow(it) {
  const on = S.sel.has(it.id);
  const kind = it.kind === 'element' ? typeFr(it.element?.type) : kindFr(it.kind);
  const r = el('div', { class: 'acard lrow' + (on ? ' sel' : ''), 'data-id': it.id, 'data-space': it.space || null, role: 'option', 'aria-selected': String(on), tabindex: 0,
    'aria-label': `${kind} ${it.title}` },
  el('button', { class: 'chk', type: 'button', 'aria-pressed': String(on), 'aria-label': `choisir ${it.title}`, onclick: (e) => { e.stopPropagation(); toggleSel(it.id); } }),
  lthumb(it),
  el('span', { class: 'c-t' }, el('b', {}, it.title || it.id, it.fav ? el('i', { class: 'st', title: 'favori' }, ' ★') : null), el('small', {}, subOf(it))),
  el('span', { class: 'c-k lbl' }, kind),
  el('span', { class: 'c-w' }, wsBadge(it.space)),
  el('span', { class: 'c-f' }, it.folder || el('span', { class: 'lbl' }, '—')),
  el('span', { class: 'c-a' }, authorName(it.owner)),
  el('span', { class: 'c-s lbl' }, fmtSize(it.bytes)),
  el('span', { class: 'c-d lbl' }, fmtDate(it.updated || it.created)),
  el('button', { class: 'menu-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'ranger, copier, jeter', 'aria-label': `ranger ${it.title}`,
    onclick: (e) => { e.stopPropagation(); toggleMenu(e.currentTarget, itemMenu(it)); } }, '⋯'));
  r.addEventListener('click', (e) => { if (!e.target.closest('button')) onCardClick(e, it); });
  r.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) go('#' + it.id); });
  r.addEventListener('keydown', (e) => {
    if (e.target !== r) return;
    if (e.key === 'Enter') { e.preventDefault(); go('#' + it.id); }
    if (e.key === ' ') { e.preventDefault(); toggleSel(it.id); }
  });
  return r;
}
function folderRow(f) {
  const r = el('div', { class: 'acard folder lrow', 'data-folder': f.name, 'data-space': f.space || null, role: 'option', 'aria-selected': 'false', tabindex: 0,
    'aria-label': `dossier ${f.name}, ${plural(f.total, 'objet', 'objets')}` },
  el('span', {}), el('span', { class: 'lt fo' }, el('i', { class: 'dir big', 'aria-hidden': 'true' })),
  el('span', { class: 'c-t' }, el('b', {}, f.name), el('small', {}, countLine(f.kinds) === 'vide' ? 'vide' : countLine(f.kinds))),
  el('span', { class: 'c-k lbl' }, 'dossier'), el('span', { class: 'c-w' }, wsBadge(f.space)), el('span', { class: 'c-f' }, ''),
  el('span', { class: 'c-a' }, ''), el('span', { class: 'c-s lbl' }, plural(f.total, 'objet', 'objets')), el('span', { class: 'c-d lbl' }, f.updated ? fmtDate(f.updated) : '—'),
  el('button', { class: 'menu-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'le dossier', 'aria-label': `dossier ${f.name}`,
    onclick: (e) => { e.stopPropagation(); toggleMenu(e.currentTarget, folderMenu(f)); } }, '⋯'));
  const open = () => { if (!suppressClick) go(folderHash(f.name, f.space)); };
  r.addEventListener('click', (e) => { if (!e.target.closest('button')) open(); });
  r.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === r) open(); });
  folderDrops(r, f);
  return r;
}

// ── la sélection ─────────────────────────────────────────────
let lastPointer = 'mouse';
const cardIds = () => (parts ? $$('.acard[data-id]', parts.grid).map((n) => n.dataset.id) : []);
const selItems = () => (S.data?.items || []).filter((it) => S.sel.has(it.id));
function setSel(ids, anchor) {
  S.sel = new Set(ids);
  if (anchor !== undefined) S.anchor = anchor;
  paintSel();
}
function toggleSel(id) {
  const s = new Set(S.sel);
  if (s.has(id)) s.delete(id); else s.add(id);
  setSel(s, id);
}
const clearSel = () => setSel([], null);
const selectAll = () => setSel(cardIds(), S.anchor);

function onCardClick(e, it) {
  if (suppressClick || e.detail === 0) return;          // e.detail 0 : Entrée ou Espace, traités à part
  const mod = e.ctrlKey || e.metaKey;
  // au doigt, sans sélection en cours : un toucher ouvre, comme avant
  if (lastPointer === 'touch' && !S.sel.size && !mod && !e.shiftKey) return go('#' + it.id);
  if (e.shiftKey && S.anchor) {
    const ids = cardIds();
    const a = ids.indexOf(S.anchor), b = ids.indexOf(it.id);
    if (a >= 0 && b >= 0) return setSel([...(mod ? S.sel : []), ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)]);
  }
  if (mod || lastPointer === 'touch') return toggleSel(it.id);
  setSel([it.id], it.id);
}

function paintSel(force = false) {
  if (parts?.grid) {
    for (const n of $$('.acard[data-id]', parts.grid)) {
      const on = S.sel.has(n.dataset.id);
      n.classList.toggle('sel', on);
      n.setAttribute('aria-selected', String(on));
      $('.thumb', n)?.classList.toggle('sel', on);
      $('.chk', n)?.setAttribute('aria-pressed', String(on));
    }
  }
  document.body.classList.toggle('selecting', S.sel.size > 0 && S.route.view === 'lib');
  paintSelBar(force);
}

// les cases d'un dossier (≈ 88 px) et du « nouveau dossier » (56 px) : la copie
// d'affichage qui suffit (commun/proxies.js), suivie à la taille réelle
function miniOf(m) {
  const pic = m.thumb_url || m.views?.length ? bindView(el('img', { alt: '', loading: 'lazy', decoding: 'async' }), m, { fit: 'cover', box: [88, 88] })
    : glyph(m.kind, true) || (m.kind === 'audio' ? wave(7) : null);
  return el('span', { class: 'mini' + (m.kind === 'element' ? ' el' : ''), title: m.title }, pic, el('i', {}, m.title));
}

function folderCard(f) {
  const shown = f.count > 4 ? f.preview.slice(0, 3) : f.preview;
  const cells = shown.map(miniOf);
  if (f.count > 4) cells.push(el('span', { class: 'mini more' }, `+${f.count - 3}`));
  while (cells.length < 4) cells.push(el('span', { class: 'mini empty' }));
  const kinds = Object.entries(KIND_N).filter(([k]) => f.kinds[k]).map(([k, [one, many]]) => plural(f.kinds[k], one, many)).join(' · ');
  const sub = el('div', { class: 's' }, kinds || (f.total ? plural(f.total, 'objet', 'objets') : 'vide'));
  if (showSpace() && f.space) sub.prepend(wsBadge(f.space));
  const b = el('button', { class: 'thumb folder', type: 'button', title: `ouvrir « ${f.name} » · ${spaceLong(f.space)}`,
    'aria-label': `dossier ${f.name}, ${plural(f.total, 'objet', 'objets')}, dans ${spaceLong(f.space)}`,
    onclick: () => { if (!suppressClick) go(folderHash(f.name, f.space)); } },
  el('div', { class: 'im' }, ...cells),
  el('div', { class: 'cap' }, el('div', { class: 't' }, f.name), sub));
  const card = el('div', { class: 'acard folder', 'data-folder': f.name, 'data-space': f.space || null, role: 'option', 'aria-selected': 'false' },
    el('span', { class: 'ftab kicker' }, 'dossier'), b,
    el('button', { class: 'menu-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'le dossier',
      'aria-label': `dossier ${f.name}`, onclick: (e) => { e.stopPropagation(); toggleMenu(e.currentTarget, folderMenu(f)); } }, '⋯'));
  folderDrops(card, f);
  return card;
}
// un dossier reçoit : une vignette glissée (le panneau, un autre onglet) — rangée, ou copiée si elle
// est d'un autre Workspace ; un fichier du disque (catégorie Upload), déposé dans son Workspace
function folderDrops(node, f) {
  itemDrop(node, (items) => landOn({ kind: 'folder', space: f.space, folder: f.name }, items));
  fileDrop(node, (files) => uploadFiles(files, { folder: f.name, space: f.space }));
}
// des fichiers du disque lâchés sur une cible : elle s'allume (l'état « accepte »), et les prend
// avant le dépôt de la page (dropAnywhere)
function fileDrop(node, cb) {
  let depth = 0;
  const has = (e) => e.dataTransfer?.types?.includes('Files');
  node.addEventListener('dragenter', (e) => { if (has(e)) { depth++; node.classList.add('drop-on'); } });
  node.addEventListener('dragleave', (e) => { if (has(e) && --depth <= 0) { depth = 0; node.classList.remove('drop-on'); } });
  node.addEventListener('dragover', (e) => { if (has(e)) e.preventDefault(); });
  node.addEventListener('drop', (e) => {
    if (!has(e) || !e.dataTransfer.files?.length) return;
    e.preventDefault(); e.stopPropagation();
    depth = 0; node.classList.remove('drop-on'); document.body.classList.remove('dropping');
    cb([...e.dataTransfer.files]);
  });
}

// ── rapatrier : une copie neuve dans un Workspace, l'original ne bouge pas ─
// POST /api/espaces/<dest>/rapatrier (server/tools/equipes.py → core/library.py) ; tout ou
// rien. Ctrl+Z met les copies à la corbeille ; rétablir les en sort (pas une copie de plus).
async function rapatrier(items, { dest = here(), folder = '' } = {}) {
  if (!items.length || !dest) return null;
  const why = items.map((it) => importWhy(it, dest)).find(Boolean);
  if (why) { say(why); return null; }
  const where = spaceLong(dest);
  const from = [...new Set(items.map((i) => spaceLong(i.space)))].join(', ');
  let made = null;
  try {
    const r = await U.run({ label: `copier ${what(items)} dans « ${where} »`,
      do: async () => {
        if (made) { await api('asset/restore', { method: 'POST', body: { ids: made.map((x) => x.id) }, espace: dest }); return made; }
        const d = await api(`espaces/${dest}/rapatrier`, { method: 'POST', body: { items: items.map((i) => i.id), folder }, espace: dest });
        made = d.items;
        made.earlier = d.earlier;
        return made;
      },
      undo: (x) => api('asset/trash', { method: 'POST', body: { ids: x.map((i) => i.id) }, espace: dest }) });
    clearSel();
    say(`${items.length > 1 ? plural(items.length, 'copie', 'copies') : `« ${items[0].title} »`} dans « ${where} »${folder ? `, dossier « ${folder} »` : ''} · l’original reste dans « ${from} »`
      + (r?.earlier ? ` · ${r.earlier > 1 ? `${r.earlier} en avaient` : 'il en avait'} déjà une copie là` : ''), true, 8000);
    refresh();
    return r;
  } catch (e) { say(e.message); refresh(); return null; }
}
// la confirmation d'une copie vers un autre Workspace : elle dit « copie dans … », d'où, et ce
// qui ne se copie pas (et pourquoi) ; rend true si la personne copie
function confirmCopy(items, dest, folder = '') {
  const ok = items.filter((it) => !importWhy(it, dest));
  const no = items.filter((it) => importWhy(it, dest));
  const from = [...new Set(items.map((i) => spaceLong(i.space)))].join(', ');
  return new Promise((resolve) => {
    let answered = false;
    const end = (v) => { if (answered) return; answered = true; m.close(); resolve(v ? ok : null); };
    const m = modal({
      title: 'copier dans un autre Workspace',
      body: [
        el('p', { class: 'new-q' }, `Copier ${ok.length > 1 ? `ces ${ok.length} objets` : 'cet objet'} dans « ${spaceLong(dest)} »${folder ? ` / ${folder}` : ''} ?`),
        el('div', { class: 'pending' }, ...ok.slice(0, 8).map(miniOf), ok.length > 8 ? el('span', { class: 'arrow' }, `+${ok.length - 8}`) : null),
        el('p', { class: 'prose' }, 'Une ', el('b', {}, 'copie neuve'), ' arrive dans ', el('b', {}, spaceLong(dest)), ' : titre, recette, tags suivent. ',
          'L’original reste dans ', el('b', {}, from), ' ; modifier l’un ne touche jamais l’autre. Ctrl+Z met la copie à la corbeille.'),
        no.length ? el('p', { class: 'hint warn-line' }, `${plural(no.length, 'objet reste', 'objets restent')} : ${importWhy(no[0], dest)}`) : null,
      ],
      foot: [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: () => end(false) }, 'Pas maintenant'),
        el('button', { class: 'tb go', type: 'button', disabled: !ok.length, title: ok.length ? '' : importWhy(no[0], dest), onclick: () => end(true) },
          `Copier dans « ${spaceShort(dest)} »`)],
      onclose: () => { if (!answered) { answered = true; resolve(null); } },
    });
    setTimeout(() => $('.modal-foot .tb.go', m.scrim)?.focus(), 30);
  });
}
async function copyTo(items, dest, folder = '') {
  const ok = await confirmCopy(items, dest, folder);
  if (ok?.length) return rapatrier(ok, { dest, folder });
  return null;
}
async function rapatrierDossier(name, space, dest = here()) {
  let d;
  try { d = await api('asset/view?' + new URLSearchParams({ folder: name, fspace: space, limit: 2000 })); } catch (e) { say(e.message); return; }
  if (!d.items.length) { say(`« ${name} » est vide`); return; }
  await copyTo(d.items, dest, name);
}
// l'adresse d'Asset dans un autre Workspace (l'onglet le prend : ?e=, commun/shell.js)
function otherTab(space, hash = '') {
  const u = new URL(href('asset/'));
  u.searchParams.set('e', space);
  u.hash = hash.replace(/^#/, '');
  return u.href;
}

// Une vignette lâchée (ITEM_MIME, plusieurs : MULTI_MIME — le panneau, un autre onglet, la
// lignée) : ses objets relus où qu'ils soient (spaces=*), puis posés comme un glisser de la page.
// `node` prend le dépôt avant ses autres écouteurs (dropZone) ; sans `node`, toute la page.
const dragIds = (dt) => {
  try { const many = JSON.parse(dt.getData(MULTI_MIME) || '[]'); if (Array.isArray(many) && many.length) return many.map(String); } catch { /* un seul */ }
  try { const one = JSON.parse(dt.getData(ITEM_MIME) || 'null'); return one?.id ? [String(one.id)] : []; } catch { return []; }
};
const carriesItems = (dt) => !!dt?.types?.includes(ITEM_MIME) && !dt.types.includes('Files');
function itemDrop(node, cb, { capture = true } = {}) {
  node.addEventListener('drop', async (e) => {
    if (!carriesItems(e.dataTransfer) || e.defaultPrevented) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    node.classList?.remove('drop-on');
    document.body.classList.remove('dropping');
    const ids = dragIds(e.dataTransfer);
    if (!ids.length) return;
    let got = [];
    try { got = (await api('library/batch', { method: 'POST', body: { ids, spaces: '*' } })).items; } catch (err) { say(err.message); return; }
    if (got.length) cb(got);
    else say('ces objets ne sont pas (ou plus) visibles pour toi');
  }, capture);
}
// la page : une vignette lâchée hors d'une cible — dans le lieu ouvert s'il est un Workspace ou un
// dossier, sinon dans le Workspace de l'onglet
addEventListener('dragover', (e) => { if (S.route.view === 'lib' && carriesItems(e.dataTransfer)) e.preventDefault(); });
itemDrop(document, (items) => {
  if (S.route.view !== 'lib') return;
  const P = S.place;
  landOn(P.k === 'folder' ? { kind: 'folder', space: P.space, folder: P.name } : { kind: 'space', space: target() }, items);
}, { capture: false });

// ── poser : la cible d'un glisser, et ce qu'elle fait ────────
// dossier (Workspace X) : ceux de X y sont rangés, les autres y sont copiés (confirmation) ;
// Workspace X : ceux de X sortent de leur dossier, les autres y sont copiés ; corbeille : jetés ;
// favoris : aimés ; une carte : un dossier neuf avec elle.
function planOf(t, items) {
  if (!t) return null;
  if (t.kind === 'trash') return { ok: true, say: `à la corbeille · ${what(items)}` };
  if (t.kind === 'fav') return { ok: true, say: `en favori · ${what(items)}` };
  if (t.kind === 'merge') return { ok: true, say: 'un dossier neuf avec cette carte' };
  const dest = t.space;
  const folder = t.folder || '';
  const move = items.filter((it) => (it.space || here()) === dest && (it.folder || '') !== folder);
  const copyN = items.filter((it) => (it.space || here()) !== dest).length;
  if (!move.length && !copyN) return { ok: false, say: folder ? `déjà dans « ${folder} »` : 'déjà hors dossier ici' };
  const parts2 = [];
  if (move.length) parts2.push(folder ? `ranger dans « ${folder} »` : `sortir du dossier${move.length > 1 ? ` · ${move.length}` : ''}`);
  if (copyN) parts2.push(`copier dans « ${spaceShort(dest)} »${copyN < items.length ? ` · ${copyN}` : ''}`);
  return { ok: true, say: parts2.join(' · ') };
}
async function landOn(t, items) {
  if (!t || !items.length) return;
  if (t.kind === 'trash') return trashMany(items);
  if (t.kind === 'fav') return bulkFav(items, true);
  if (t.kind === 'merge') {
    const other = S.data.items.find((x) => x.id === t.id);
    return askFolderName([other, ...items], other.space);
  }
  const dest = t.space;
  const folder = t.folder || '';
  const move = items.filter((it) => (it.space || here()) === dest && (it.folder || '') !== folder);
  const away = items.filter((it) => (it.space || here()) !== dest);
  if (move.length) {
    await moveItems(move, folder, { space: dest, msg: folder ? `${what(move)} rangé${move.length > 1 ? 's' : ''} dans « ${folder} »` : `${what(move)} hors dossier, dans « ${spaceShort(dest)} »` });
    clearSel();
  }
  if (away.length) await copyTo(away, dest, folder);
}

// ── ranger ───────────────────────────────────────────────────
// Le contraire d'un rangement : chacun retourne d'où il venait (le serveur
// rend `moved: [{id, from}]`), à condition d'être encore là où on l'a mis.
async function moveBack(r) {
  const cur = await Promise.all(r.moved.map((m) => api('library/' + m.id, { espace: r.space }).catch(() => null)));
  const moved = cur.filter((c) => c && (c.folder || '') !== r.folder);
  if (moved.length) throw new Error(`${moved.length > 1 ? `${moved.length} objets ont` : `« ${moved[0].title} » a`} changé de dossier ailleurs depuis`);
  const by = {};
  for (const m of r.moved) (by[m.from] ||= []).push(m.id);
  for (const [from, list] of Object.entries(by)) await api('asset/move', { method: 'POST', body: { ids: list, folder: from }, espace: r.space });
}
// ranger des objets (d'un même Workspace, `space`) dans un dossier ('' : hors dossier)
async function moveItems(items, folder, { space = null, msg = '', label = null } = {}) {
  const sp = space || items[0]?.space || here();
  const ids = items.map((i) => (typeof i === 'string' ? i : i.id));
  const named = items.map((i) => (typeof i === 'string' ? { id: i, title: titleOf(i) } : i));
  const lab = label || (folder ? `ranger ${what(named)} dans « ${folder} »` : `sortir ${what(named)} de leur dossier`);
  try {
    await U.run({ label: lab, do: async () => { const r = await api('asset/move', { method: 'POST', body: { ids, folder }, espace: sp }); r.space = sp; return r; }, undo: moveBack });
    say(msg || (folder ? `${what(named)} dans « ${folder} »` : `${what(named)} hors dossier`), true);
  } catch (e) { say(e.message); }
  refresh();
}

function refresh() {
  loadTree();
  if (S.route.view === 'lib') loadLib();
  else if (S.route.view === 'sheet') paintSheet(S.route.id, { keepScroll: true });
  else if (S.route.view === 'trash') paintTrash();
}

// ── les dossiers : créer, renommer, dégrouper, supprimer ─────
async function folderItems(name, space) {
  const d = await api('asset/view?' + new URLSearchParams({ folder: name, fspace: space, limit: 2000 }));
  return d.items;
}
// un dossier vide, déclaré dans son Workspace (POST /api/asset/folders) ; Ctrl+Z l'oublie
async function createFolder(name, space, { open = true } = {}) {
  try {
    const r = await U.run({ label: `créer le dossier « ${name} »`,
      do: () => api('asset/folders', { method: 'POST', body: { name }, espace: space }),
      undo: (x) => api('asset/folders/forget', { method: 'POST', body: { name: x.folder }, espace: space }) });
    say(`Dossier « ${r.folder} » créé dans « ${spaceShort(space)} » · glisse-lui des cartes`, true);
    if (open) go(folderHash(r.folder, space)); else refresh();
    return r;
  } catch (e) { say(e.message); paintTree(); return null; }
}
// dégrouper : ses objets hors dossier, le nom oublié ; Ctrl+Z les y remet et le redéclare
async function ungroupFolder(name, space) {
  let items;
  try { items = await folderItems(name, space); } catch (e) { say(e.message); return; }
  const ids = items.map((i) => i.id);
  try {
    await U.run({ label: `dégrouper le dossier « ${name} »`,
      do: async () => {
        const r = ids.length ? await api('asset/move', { method: 'POST', body: { ids, folder: '' }, espace: space }) : { moved: [], folder: '' };
        await api('asset/folders/forget', { method: 'POST', body: { name }, espace: space });
        r.space = space;
        return r;
      },
      undo: async (r) => { await api('asset/folders', { method: 'POST', body: { name }, espace: space }); if (r.moved.length) await moveBack(r); } });
    say(`« ${name} » dégroupé : ${plural(ids.length, 'objet', 'objets')} hors dossier, dans « ${spaceShort(space)} »`, true);
    if (S.place.k === 'folder' && S.place.name === name && S.place.space === space) go(placeHash({ k: 'space', space }));
    else refresh();
  } catch (e) { say(e.message); }
}
// supprimer : ses objets à la corbeille (tout ou rien, POST /api/asset/folders/delete) ; Ctrl+Z les
// rétablit (la corbeille garde leur dossier) et redéclare le nom
function deleteFolderAsk(name, space) {
  const n = S.tree?.teams.flatMap((t) => t.spaces).find((s) => s.id === space)?.folders.find((f) => f.name === name)?.count ?? null;
  const m = modal({
    title: 'supprimer un dossier',
    body: [el('p', { class: 'new-q' }, `Supprimer « ${name} » ?`),
      el('p', { class: 'prose' }, n ? [`Ses ${plural(n, 'objet va', 'objets vont')} à la `, el('b', {}, 'corbeille'), ' de « ', spaceLong(space), ' » : rien ne s’efface, ils reviennent d’un clic — dans ce dossier. Ctrl+Z annule tout.']
        : 'Il est vide : son nom disparaît. Ctrl+Z le rend.'),
      el('p', { class: 'hint' }, 'Pour garder les objets et défaire seulement le dossier : « Dégrouper ».')],
    foot: [el('button', { class: 'tb ghost', type: 'button', onclick: () => { m.close(); ungroupFolder(name, space); } }, 'Dégrouper plutôt'),
      el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Pas maintenant'),
      el('button', { class: 'tb go', type: 'button', onclick: () => { m.close(); deleteFolder(name, space); } }, n ? `Supprimer · ${plural(n, 'objet', 'objets')} à la corbeille` : 'Supprimer le dossier')],
  });
  setTimeout(() => $('.modal-foot .tb.go', m.scrim)?.focus(), 30);
}
async function deleteFolder(name, space) {
  try {
    const r = await U.run({ label: `supprimer le dossier « ${name} »`,
      do: () => api('asset/folders/delete', { method: 'POST', body: { name }, espace: space }),
      undo: async (x) => {
        if (x.trashed.length) await api('asset/restore', { method: 'POST', body: { ids: x.trashed }, espace: space });
        if (x.declared || !x.trashed.length) await api('asset/folders', { method: 'POST', body: { name }, espace: space });
      } });
    say(`« ${name} » supprimé · ${plural(r.trashed.length, 'objet', 'objets')} à la corbeille`, true, 8000);
    if (S.place.k === 'folder' && S.place.name === name && S.place.space === space) go(placeHash({ k: 'space', space }));
    else refresh();
  } catch (e) { say(e.message); }
}
// renommer : dans l'arbre (double-clic) ou le titre du dossier ouvert ; `node` est remplacé par le champ
function renameFolderInline(old, space, node) {
  if (!node) return;
  const inp = el('input', { class: 'fld', value: old, maxlength: 60, 'aria-label': 'nom du dossier', spellcheck: 'false' });
  const f = el('form', { class: node.classList.contains('tr') ? 'tr nf' : 'rename-f', style: node.classList.contains('tr') ? { '--d': node.style.getPropertyValue('--d') } : null },
    inp, node.classList.contains('tr') ? null : el('button', { class: 'tb ghost sm', type: 'submit' }, 'OK'));
  let gone = false;
  const back = () => { if (gone) return; gone = true; f.replaceWith(node); };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = inp.value.trim();
    if (!v || v === old) return back();
    gone = true;
    try {
      // une fusion avec un dossier qui existait ne se défait pas : on ne
      // saurait plus lesquels venaient d'où ; elle ne se range pas
      const known = S.data?.folders_by_space?.[space] || S.tree?.teams.flatMap((t) => t.spaces).find((s) => s.id === space)?.folders.map((x) => x.name) || [];
      const moveHere = S.place.k === 'folder' && S.place.name === old && S.place.space === space;
      if (known.includes(v)) {
        const r = await api('asset/folders/rename', { method: 'POST', body: { from: old, to: v }, espace: space });
        say(`« ${old} » fondu dans « ${r.folder} », qui existait déjà — une fusion ne s’annule pas`);
        if (moveHere) go(folderHash(r.folder, space)); else refresh();
        return;
      }
      const ren = (from, to) => async () => {
        const r = await api('asset/folders/rename', { method: 'POST', body: { from, to }, espace: space });
        if (S.place.k === 'folder' && S.place.name === from && S.place.space === space) go(folderHash(r.folder, space));
        return r;
      };
      const r = await U.run({ label: `renommer le dossier « ${old} » en « ${v} »`, do: ren(old, v), undo: (x) => ren(x.folder, old)(), redo: ren(old, v) });
      say(`Renommé « ${r.folder} »`, true);
      if (!moveHere) refresh();
    } catch (err) { say(err.message); refresh(); }
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); back(); } });
  inp.addEventListener('blur', () => setTimeout(() => { if (!gone && document.activeElement !== inp) back(); }, 120));
  node.replaceWith(f);
  inp.focus(); inp.select();
}

// ── le menu d'une carte (ranger sans glisser) ────────────────
let menuFor = null;
// les dossiers où l'on peut ranger des objets d'un Workspace
const foldersOf = (space) => S.data?.folders_by_space?.[space] || S.tree?.teams.flatMap((t) => t.spaces).find((s) => s.id === space)?.folders.map((f) => f.name) || [];
// les autres Workspaces, où l'on peut copier
const otherSpaces = (space) => (S.spaces || []).filter((s) => s.id !== space);
function itemMenu(it) {
  const sp = it.space || here();
  const cur = it.folder || '';
  const others = foldersOf(sp).filter((f) => f !== cur);
  return {
    title: `${spaceShort(sp)} · ${it.title}`,
    items: [
      { label: 'Ouvrir la fiche', do: () => go('#' + it.id) },
      '-',
      ...others.map((f) => ({ label: `Dans « ${f} »`, dir: true, do: () => moveItems([it], f, { space: sp }) })),
      { label: 'Dans un nouveau dossier…', dir: true, do: () => askFolderName([it], sp) },
      cur ? { label: `Sortir de « ${cur} »`, do: () => moveItems([it], '', { space: sp }) } : null,
      ...otherSpaces(sp).map((s) => { const why = importWhy(it, s.id); return { label: `Copier dans « ${s.name} »`, disabled: !!why, why, do: () => copyTo([it], s.id) }; }),
      '-',
      { label: it.fav ? 'Retirer des favoris' : 'Mettre en favori', do: () => bulkFav([it], !it.fav) },
      { label: 'Mettre à la corbeille', do: () => trashMany([it]) },
    ].filter(Boolean),
  };
}
function folderMenu(f) {
  return {
    title: `dossier · ${spaceShort(f.space)} · ${f.name}`,
    items: [
      { label: 'Ouvrir', do: () => go(folderHash(f.name, f.space)) },
      { label: 'Renommer', do: () => { S.renameOnLoad = f.name; go(folderHash(f.name, f.space)); } },
      ...otherSpaces(f.space).map((s) => { const why = s.import === false ? `copier dans « ${spaceLong(s.id)} » : ${s.import_why || 'ton rôle ne le permet pas'}` : '';
        return { label: `Copier le dossier dans « ${s.name} »`, disabled: !!why, why, do: () => rapatrierDossier(f.name, f.space, s.id) }; }),
      '-',
      { label: `Dégrouper · ${plural(f.total, 'objet', 'objets')} hors dossier`, do: () => ungroupFolder(f.name, f.space) },
      { label: 'Supprimer…', do: () => deleteFolderAsk(f.name, f.space) },
    ],
  };
}

function toggleMenu(btn, spec) {
  if (menuFor?.btn === btn) return closeMenu(true);
  closeMenu();
  const m = el('div', { class: 'cmenu', role: 'menu' }, el('span', { class: 'lbl' }, spec.title),
    ...spec.items.map((x) => (x === '-' ? el('hr') : el('button', { role: 'menuitem', type: 'button', disabled: x.disabled, title: x.disabled ? x.why : null,
      onclick: () => { closeMenu(); x.do(); } }, x.dir ? el('span', { class: 'dir' }) : null,
      x.disabled && x.why ? el('span', { class: 'mi' }, x.label, el('small', { class: 'why' }, x.why)) : x.label))));
  document.body.append(m);
  const r = btn.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
  m.style.top = `${r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
  btn.setAttribute('aria-expanded', 'true');
  menuFor = { btn, m };
  $('button:not(:disabled)', m)?.focus();
  m.addEventListener('keydown', (e) => {
    const items = $$('button:not(:disabled)', m);
    const k = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(k + 1) % items.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(k - 1 + items.length) % items.length]?.focus(); }
    // Échap ferme le menu, et seulement lui : la sélection reste
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
  });
}
function closeMenu(refocus = false) {
  if (!menuFor) return;
  menuFor.m.remove();
  menuFor.btn.setAttribute('aria-expanded', 'false');
  if (refocus) menuFor.btn.focus();
  menuFor = null;
}
document.addEventListener('click', (e) => { if (menuFor && !e.target.closest('.cmenu') && !e.target.closest('.menu-btn')) closeMenu(); });

// ── glisser-déposer : Pointer Events, souris, doigt, stylet ───
// Souris : on part après 6 px. Doigt : appui long de 350 ms, sinon la page
// défile. Les cibles : une carte-dossier, une ligne de l'arbre (dossier,
// Workspace, Favoris, Corbeille), un Workspace du fil, une autre carte (un
// dossier neuf). La cible qui accepte s'allume en vert ; l'étiquette sous le
// curseur dit ce qui va se passer. Échap annule.
let drag = null;
let suppressClick = false;

function clearMarks() {
  $$('.drop-into, .drop-merge, .drop-on, .drop-no').forEach((n) => n.classList.remove('drop-into', 'drop-merge', 'drop-on', 'drop-no'));
}

function startDrag(e) {
  drag.started = true;
  const r = drag.card.getBoundingClientRect();
  const g = drag.card.classList.contains('lrow')
    ? el('div', { class: 'drag-ghost lghost' }, el('b', {}, drag.title))
    : drag.card.cloneNode(true);
  g.classList.add('drag-ghost');
  g.removeAttribute('data-id');
  $$('video', g).forEach((v) => v.remove());
  if (!drag.card.classList.contains('lrow')) {
    const w = Math.min(r.width, 140);
    g.style.width = `${r.width}px`;
    g.style.transformOrigin = '0 0';
    g.style.transform = `scale(${w / r.width}) rotate(-2.5deg)`;
  }
  $$('.chk, .menu-btn', g).forEach((n) => n.remove());
  if (drag.ids.length > 1) g.append(el('span', { class: 'drag-count' }, String(drag.ids.length)));
  const act = el('div', { class: 'drag-act', 'aria-hidden': 'true' }, 'où poser ?');
  document.body.append(g, act);
  drag.ghost = g; drag.act = act;
  for (const id of drag.ids) $(`.acard[data-id="${id}"]`, parts.grid)?.classList.add('lifting');
  document.body.classList.add('dragging');
  live(`${drag.ids.length > 1 ? plural(drag.ids.length, 'objet', 'objets') : drag.title} saisi. Relâche sur un dossier, un Workspace, Favoris ou la Corbeille, ou Échap pour annuler.`);
  moveDrag(e);
}

function targetAt(x, y) {
  const at = document.elementFromPoint(x, y);
  if (!at) return null;
  const tr = at.closest('[data-drop]');
  if (tr) {
    const k = tr.dataset.drop;
    if (k === 'folder') return { kind: 'folder', space: tr.dataset.space, folder: tr.dataset.folder, node: tr };
    if (k === 'space') return { kind: 'space', space: tr.dataset.space, node: tr };
    if (k === 'trash' || k === 'fav') return { kind: k, node: tr };
  }
  const f = at.closest('.acard.folder');
  if (f) return { kind: 'folder', space: f.dataset.space || here(), folder: f.dataset.folder, node: f, card: true };
  const t = at.closest('.acard[data-id]');
  if (t && !drag.ids.includes(t.dataset.id) && S.view === 'grid') {
    const other = S.data.items.find((x) => x.id === t.dataset.id);
    // une carte : un dossier neuf, quand tout est du même Workspace
    if (other && drag.items.every((x) => x.space === other.space)) return { kind: 'merge', id: other.id, space: other.space, node: t, merge: true };
  }
  return null;
}

function moveDrag(e) {
  drag.ghost.style.left = `${e.clientX + 14}px`;
  drag.ghost.style.top = `${e.clientY + 14}px`;
  drag.act.style.left = `${e.clientX + 16}px`;
  drag.act.style.top = `${e.clientY - 30}px`;
  clearMarks();
  drag.target = null;
  const t = targetAt(e.clientX, e.clientY);
  const plan = planOf(t, drag.items);
  if (t && plan?.ok) {
    drag.target = t;
    t.node.classList.add(t.merge ? 'drop-merge' : t.card ? 'drop-into' : 'drop-on');
    drag.act.textContent = plan.say;
    drag.act.classList.add('ok');
  } else {
    if (t && plan) t.node.classList.add('drop-no');
    drag.act.textContent = plan ? plan.say : 'où poser ?';
    drag.act.classList.remove('ok');
  }
  const edge = 70;
  const inSide = e.clientX < sideEl.getBoundingClientRect().right;
  const sc = inSide ? sideEl : window;
  if (e.clientY < edge + 40) sc.scrollBy(0, -14);
  else if (e.clientY > innerHeight - edge) sc.scrollBy(0, 14);
}

function endDrag(cancel) {
  const d = drag;
  drag = null;
  clearMarks();
  d.ghost?.remove();
  d.act?.remove();
  $$('.acard.lifting').forEach((n) => n.classList.remove('lifting'));
  document.body.classList.remove('dragging');
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 80);
  if (cancel || !d.target) { live('déplacement annulé'); return; }
  landOn(d.target, d.items);
}

document.addEventListener('pointerdown', (e) => {
  lastPointer = e.pointerType || 'mouse';
  if (e.button !== 0 || S.route.view !== 'lib') return;
  const card = e.target.closest('.acard[data-id]');
  if (!card) return startMarquee(e);
  if (e.target.closest('.menu-btn, .chk')) return;
  const it = S.data?.items.find((x) => x.id === card.dataset.id);
  // glisser une carte choisie emporte toute la sélection ; une autre part seule
  const ids = S.sel.has(card.dataset.id) && S.sel.size > 1 ? cardIds().filter((id) => S.sel.has(id)) : [card.dataset.id];
  const items = ids.map((id) => S.data.items.find((x) => x.id === id)).filter(Boolean);
  drag = { id: card.dataset.id, ids, items, title: it?.title || '', card, x0: e.clientX, y0: e.clientY, started: false, touch: e.pointerType !== 'mouse' };
  if (drag.touch) drag.timer = setTimeout(() => { if (drag && !drag.started) { navigator.vibrate?.(12); startDrag(e); } }, 350);
});
document.addEventListener('pointermove', (e) => {
  if (mq) return moveMarquee(e);
  if (!drag) return;
  if (!drag.started) {
    const dist = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
    if (drag.touch) { if (dist > 10) { clearTimeout(drag.timer); drag = null; } return; }
    if (dist < 6) return;
    startDrag(e);
    return;
  }
  moveDrag(e);
});
document.addEventListener('pointerup', () => {
  if (mq) return endMarquee();
  if (!drag) return;
  clearTimeout(drag.timer);
  if (drag.started) endDrag(false); else drag = null;
});
document.addEventListener('pointercancel', () => {
  if (mq) return endMarquee(true);
  if (drag?.started) endDrag(true); else drag = null;
});

// une vignette venue d'ailleurs (le panneau, un autre onglet) survole l'arbre : la ligne s'allume
sideEl.addEventListener('dragover', (e) => {
  if (!carriesItems(e.dataTransfer)) return;
  const tr = e.target.closest('[data-drop]');
  $$('.drop-on', sideEl).forEach((n) => n !== tr && n.classList.remove('drop-on'));
  if (tr) { e.preventDefault(); tr.classList.add('drop-on'); }
});
sideEl.addEventListener('dragleave', (e) => { e.target.closest?.('[data-drop]')?.classList.remove('drop-on'); });
sideEl.addEventListener('drop', async (e) => {
  if (!carriesItems(e.dataTransfer)) return;
  const tr = e.target.closest('[data-drop]');
  if (!tr) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  tr.classList.remove('drop-on');
  const ids = dragIds(e.dataTransfer);
  let got = [];
  try { got = (await api('library/batch', { method: 'POST', body: { ids, spaces: '*' } })).items; } catch (err) { say(err.message); return; }
  const k = tr.dataset.drop;
  landOn(k === 'folder' ? { kind: 'folder', space: tr.dataset.space, folder: tr.dataset.folder } : k === 'space' ? { kind: 'space', space: tr.dataset.space } : { kind: k }, got);
}, true);

// ── la zone de sélection : glisser sur le fond ───────────────
// À la souris et au stylet ; au doigt, glisser fait défiler la page.
// Ctrl/⌘ ou maj : la zone s'ajoute à la sélection au lieu de la remplacer.
// Un clic sur le fond, sans glisser, vide la sélection.
let mq = null;
function startMarquee(e) {
  if (e.pointerType === 'touch' || !parts || !libEl.contains(e.target)) return;
  if (e.target.closest('button, a, input, select, textarea, label, .lib-bar, .lib-top, .lib-hint, .empty-state, .acard')) return;
  mq = { x0: e.pageX, y0: e.pageY, add: e.ctrlKey || e.metaKey || e.shiftKey, base: new Set(S.sel), started: false, last: null };
}
function moveMarquee(e) {
  if (!mq.started) {
    if (Math.hypot(e.pageX - mq.x0, e.pageY - mq.y0) < 5) return;
    mq.started = true;
    mq.box = el('div', { class: 'marquee', 'aria-hidden': 'true' });
    document.body.append(mq.box);
    document.body.classList.add('marqueeing');
    getSelection()?.removeAllRanges();
  }
  const x = Math.min(e.pageX, mq.x0), y = Math.min(e.pageY, mq.y0);
  const w = Math.abs(e.pageX - mq.x0), h = Math.abs(e.pageY - mq.y0);
  Object.assign(mq.box.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  const hits = [];
  for (const n of $$('.acard[data-id]', parts.grid)) {
    const r = n.getBoundingClientRect();
    const L = r.left + scrollX, T = r.top + scrollY;
    if (L < x + w && L + r.width > x && T < y + h && T + r.height > y) hits.push(n.dataset.id);
  }
  mq.last = hits[hits.length - 1] || mq.last;
  S.sel = new Set([...(mq.add ? mq.base : []), ...hits]);
  paintSel();
  if (e.clientY < 70) scrollBy(0, -14);
  else if (e.clientY > innerHeight - 70) scrollBy(0, 14);
}
function endMarquee(cancel = false) {
  const m = mq;
  mq = null;
  document.body.classList.remove('marqueeing');
  m.box?.remove();
  if (cancel) return;
  if (m.started) {
    if (m.last) S.anchor = m.last;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 80);
    live(`${plural(S.sel.size, 'objet choisi', 'objets choisis')}`);
  } else if (!m.add) clearSel();
}

// ── la barre d'outils de la sélection ────────────────────────
// Un seul orange : « Télécharger » ; « Déposer » repasse en gris le temps
// de la sélection. Raccourcis : T télécharger, N nouveau dossier, F favori,
// Entrée ouvrir (un seul), Suppr corbeille, ctrl+A tout, Échap rien.
let selSig = '';
function paintSelBar(force = false) {
  const on = S.sel.size > 0 && S.route.view === 'lib';
  if (parts?.dropBtn) { parts.dropBtn.classList.toggle('go', !on); parts.dropBtn.classList.toggle('ghost', on); }
  document.body.classList.toggle('has-selbar', on);
  let bar = $('.selbar');
  if (!on) { bar?.remove(); selSig = ''; return; }
  const items = selItems();
  const sig = `${items.map((i) => `${i.id}${i.fav ? '*' : ''}`).join(',')}|${JSON.stringify(S.data?.folders_by_space || {})}`;
  if (bar && sig === selSig && !force) return;
  selSig = sig;
  const n = items.length;
  const counts = {};
  for (const i of items) counts[i.kind] = (counts[i.kind] || 0) + 1;
  const imgs = items.filter((i) => i.kind === 'image');
  const ups = items.filter((i) => i.kind === 'image' || i.kind === 'video');
  const one = n === 1 ? items[0] : null;
  const allFav = n > 0 && items.every((i) => i.fav);
  const spaces = bySpace(items);
  const oneSpace = spaces.length === 1 ? spaces[0][0] : null;
  const mixWhy = oneSpace ? '' : `la sélection est dans ${spaces.length} Workspaces : un dossier, un élément sont dans un seul`;
  // ce que les outils prennent : le Workspace de l'onglet seulement
  const fw = foreignWhy(items);
  const b = (label, onclick, { key = '', title = '', disabled = false, go: orange = false } = {}) =>
    el('button', { class: `tb ${orange ? 'go' : 'ghost'} sm`, type: 'button', disabled, onclick,
      title: `${title}${key ? ` · ${key}` : ''}`, 'aria-keyshortcuts': key || null }, label);
  // le clic ne remonte pas : la page fermerait aussitôt le menu qu'il ouvre
  const moveBtn = b('Déplacer ▾', (e) => { e.stopPropagation(); toggleMenu(e.currentTarget, moveMenu(items)); }, { title: 'vers un dossier, hors dossier, ou une copie dans un autre Workspace' });
  moveBtn.setAttribute('aria-haspopup', 'menu');
  const nextBar = el('div', { class: 'selbar', role: 'toolbar', 'aria-label': 'la sélection' },
    el('div', { class: 'cnt' }, el('b', {}, String(n)),
      el('span', { class: 'lbl' }, `${n > 1 ? 'choisis' : 'choisi'}${countLine(counts) !== 'vide' ? ` · ${countLine(counts)}` : ''}${spaces.length > 1 ? ` · ${spaces.length} Workspaces` : ''}`)),
    b('Tout', selectAll, { key: 'Ctrl+A', title: 'choisir tout ce qui est affiché' }),
    el('span', { class: 'sep' }),
    b('Télécharger', () => download(items), { go: true, key: 'T',
      title: one && one.kind !== 'element' ? 'le fichier' : 'un zip, fait par DGX2 qui a les fichiers ; un élément apporte ses références' }),
    b('Créer un dossier', () => askFolderName(items, oneSpace), { key: 'N', disabled: !!mixWhy || !!createWhy(oneSpace), title: mixWhy || createWhy(oneSpace) || 'un dossier neuf avec la sélection ; son nom est demandé' }),
    moveBtn,
    b(allFav ? '☆ Retirer des favoris' : '★ Favori', () => bulkFav(items, !allFav), { key: 'F' }),
    b('Tags', () => tagsModal(items), { title: 'ajouter ou retirer un tag sur toute la sélection' }),
    b('Faire un élément', () => elementModal({ items: imgs, title: imgs[0]?.title || '', folder: commonFolder(imgs), space: oneSpace }), {
      disabled: !imgs.length || !!mixWhy,
      title: mixWhy || (imgs.length ? `un élément avec ${plural(imgs.length, 'image', 'images')} en références, dans « ${spaceShort(oneSpace)} »` : 'aucune image dans la sélection : un élément se fait d\'images') }),
    b('Agrandir', () => { location.href = href(`upscale/?src=${ups.map((i) => i.id).join(',')}`); }, {
      disabled: !ups.length || !!fw,
      title: fw || (!ups.length ? 'Upscale prend des images et des vidéos : il n\'y en a pas dans la sélection'
        : ups.length < n ? `Upscale : les ${plural(ups.length, 'image ou vidéo', 'images et vidéos')} de la sélection seulement` : 'Upscale : agrandir et affiner') }),
    studioSeul(b('Ajouter au montage', () => { location.href = href(`montage/?add=${encodeURIComponent(one.id)}`); }, {
      disabled: !(one && MEDIA.includes(one.kind)) || !!fw,
      title: fw || (one && MEDIA.includes(one.kind) ? 'Montage : au bout de la piste' : n > 1
        ? 'le montage prend un objet à la fois par son adresse (?add=) : n\'en choisis qu\'un' : 'une image, une vidéo ou un son') })),
    one ? b('Ouvrir', () => go('#' + one.id), { key: 'Entrée', title: 'sa fiche' }) : null,
    b('Corbeille', () => trashMany(items), { key: 'Suppr', title: 'à la corbeille ; Ctrl+Z la reprend' }),
    el('button', { class: 'x', type: 'button', title: 'ne plus rien choisir · Échap', 'aria-label': 'vider la sélection', onclick: clearSel }, '×'));
  if (bar) bar.replaceWith(nextBar); else document.body.append(nextBar);
}

function commonFolder(items) {
  const f = new Set(items.map((i) => i.folder || ''));
  return f.size === 1 ? [...f][0] : '';
}

function moveMenu(items) {
  const spaces = bySpace(items);
  const one = spaces.length === 1 ? spaces[0][0] : null;
  const cur = new Set(items.map((i) => i.folder || ''));
  const w = plural(items.length, 'objet', 'objets');
  const out = [];
  if (one) {
    out.push(...foldersOf(one).filter((f) => !(cur.size === 1 && cur.has(f)))
      .map((f) => ({ label: `Dans « ${f} »`, dir: true, do: () => moveItems(items, f, { space: one, msg: `${w} dans « ${f} »` }).then(clearSel) })));
    out.push({ label: 'Dans un nouveau dossier…', dir: true, do: () => askFolderName(items, one) });
    if ([...cur].some(Boolean)) out.push({ label: 'Hors dossier', do: () => moveItems(items, '', { space: one, msg: `${w} hors dossier` }).then(clearSel) });
  } else {
    out.push({ label: 'Hors dossier, chacun dans son Workspace', do: async () => { for (const [sp, list] of spaces) { const inF = list.filter((i) => i.folder); if (inF.length) await moveItems(inF, '', { space: sp }); } clearSel(); } });
  }
  for (const s of S.spaces || []) {
    const away = items.filter((i) => (i.space || here()) !== s.id);
    if (!away.length) continue;
    const why = away.map((it) => importWhy(it, s.id)).find(Boolean) || '';
    out.push({ label: `Copier dans « ${s.name} »${away.length < items.length ? ` · ${away.length}` : ''}`, disabled: why && away.every((it) => importWhy(it, s.id)), why, do: () => copyTo(away, s.id) });
  }
  return { title: `déplacer · ${w}`, items: out };
}

const saveUrl = (url, name) => { const a = el('a', { href: url, download: name || '' }); document.body.append(a); a.click(); a.remove(); };
async function download(items) {
  if (!items.length) return;
  const one = items.length === 1 ? items[0] : null;
  if (one && one.kind !== 'element' && one.url) return saveUrl(href(one.url), `${one.title || one.id}${(one.file || '').replace(/^main/, '')}`);
  say(`préparation du zip · ${plural(items.length, 'objet', 'objets')}`, null, 60000);
  try {
    const z = await api('asset/zip', { method: 'POST', body: { ids: items.map((i) => i.id) } });
    saveUrl(href(z.url), z.name);
    say(`zip prêt · ${plural(z.files, 'fichier', 'fichiers')} · ${fmtSize(z.size)}`);
  } catch (e) { say(`zip : ${e.message}`); }
}

// Un geste en lot sur plusieurs Workspaces : un appel par Workspace, dans l'ordre ; si l'un
// échoue, ceux déjà faits sont défaits (`back`) avant de dire pourquoi — tout ou rien.
async function perSpace(items, doIt, back) {
  const done = [];
  try {
    for (const [sp, list] of bySpace(items)) done.push({ sp, list, r: await doIt(sp, list) });
  } catch (e) {
    for (const d of done.reverse()) { try { await back(d); } catch { /* le journal le dira */ } }
    throw e;
  }
  return done;
}
const unbulkAll = async (done) => { for (const d of done) await api('asset/bulk', { method: 'POST', body: { restore: d.r.before }, espace: d.sp }); };
async function bulkFav(items, on) {
  try {
    await U.run({ label: on ? `mettre ${what(items)} en favori` : `retirer ${what(items)} des favoris`,
      do: () => perSpace(items, (sp, list) => api('asset/bulk', { method: 'POST', body: { ids: list.map((i) => i.id), fav: on }, espace: sp }),
        (d) => api('asset/bulk', { method: 'POST', body: { restore: d.r.before }, espace: d.sp })),
      undo: unbulkAll });
    say(on ? `${what(items)} en favori` : `${what(items)} hors des favoris`, true);
  } catch (e) { say(e.message); }
  refresh();
}

function tagsModal(items) {
  const box = el('div', { class: 'chips' });
  const inp = el('input', { class: 'fld', id: 'tg-add', placeholder: 'un tag pour toute la sélection', maxlength: 40, 'aria-label': 'ajouter un tag' });
  const paint = () => {
    const count = {};
    for (const it of items) for (const t of it.tags || []) count[t] = (count[t] || 0) + 1;
    const tags = Object.entries(count).sort((a, b) => b[1] - a[1]);
    box.replaceChildren(...(tags.length ? tags.map(([t, k]) => el('span', { class: 'chip' }, `${t} · ${k}/${items.length}`,
      el('button', { type: 'button', title: `retirer « ${t} » de toute la sélection`, 'aria-label': `retirer ${t}`, onclick: () => change({ tags_remove: [t] }, `« ${t} » retiré`) }, '×')))
      : [el('span', { class: 'hint' }, 'aucun tag dans la sélection')]));
  };
  async function change(body, msg) {
    try {
      const lab = body.tags_add ? `ajouter le tag « ${body.tags_add[0]} » à ${what(items)}` : `retirer le tag « ${body.tags_remove[0]} » de ${what(items)}`;
      await U.run({ label: lab,
        do: () => perSpace(items, (sp, list) => api('asset/bulk', { method: 'POST', body: { ids: list.map((i) => i.id), ...body }, espace: sp }),
          (d) => api('asset/bulk', { method: 'POST', body: { restore: d.r.before }, espace: d.sp })),
        undo: unbulkAll });
      const fresh = await Promise.all(items.map((it) => api(`library/${it.id}?spaces=*`).catch(() => null)));
      fresh.forEach((f, k) => { if (f) items[k].tags = f.tags; });
      paint();
      say(msg, true);
    } catch (e) { say(e.message); }
  }
  inp.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = inp.value.trim();
    if (v) { inp.value = ''; change({ tags_add: [v] }, `« ${v} » ajouté à ${plural(items.length, 'objet', 'objets')}`); }
  });
  paint();
  const m = modal({
    title: `tags · ${plural(items.length, 'objet', 'objets')}`,
    body: [el('span', { class: 'lbl' }, 'les tags de la sélection · combien l\'ont'), box, el('label', { class: 'new-q', for: 'tg-add' }, 'Ajouter un tag à tous'), inp,
      el('p', { class: 'hint' }, 'Entrée ajoute ; × retire de toute la sélection. Chaque geste s\'annule (Ctrl+Z).')],
    foot: [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Fermer')],
    onclose: refresh,
  });
  setTimeout(() => inp.focus(), 30);
}

// la corbeille : chaque Workspace la sienne (le serveur jette tout ou rien, par Workspace)
async function trashMany(items) {
  try {
    await U.run({ label: `mettre ${what(items)} à la corbeille`,
      do: () => perSpace(items, (sp, list) => api('asset/trash', { method: 'POST', body: { ids: list.map((i) => i.id) }, espace: sp }),
        (d) => api('asset/restore', { method: 'POST', body: { ids: d.list.map((i) => i.id) }, espace: d.sp })),
      undo: async (done) => { for (const d of done) await api('asset/restore', { method: 'POST', body: { ids: d.list.map((i) => i.id) }, espace: d.sp }); } });
    clearSel();
    say(`${what(items)} à la corbeille`, true, 8000);
  } catch (e) { say(e.message); }
  refresh();
}

// les raccourcis de la sélection (hors d'un champ, d'une fenêtre, d'un menu)
document.addEventListener('keydown', (e) => {
  if (S.route.view !== 'lib' || $('.scrim') || menuFor || drag?.started) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'a') { e.preventDefault(); selectAll(); return; }
  if (!S.sel.size || mod || e.altKey) return;
  const items = selItems();
  const spaces = bySpace(items);
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); trashMany(items); }
  else if (k === 't') download(items);
  else if (k === 'n') { e.preventDefault(); if (spaces.length === 1) askFolderName(items, spaces[0][0]); else say('la sélection est dans plusieurs Workspaces : un dossier est dans un seul'); }
  else if (k === 'f') bulkFav(items, !items.every((i) => i.fav));
  else if (e.key === 'Enter' && items.length === 1 && !e.target.closest?.('button, a')) go('#' + items[0].id);
});
document.addEventListener('touchmove', (e) => { if (drag?.started) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', (e) => { if (drag) e.preventDefault(); });
document.addEventListener('dragstart', (e) => { if (e.target.closest?.('.acard, .refc')) e.preventDefault(); });

// ── les fenêtres ─────────────────────────────────────────────
function modal({ title, body, foot, wide = false, onclose }) {
  const box = el('div', { class: 'modal' + (wide ? ' lg' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('div', { class: 'modal-head' }, el('span', { class: 't' }, title)),
    el('div', { class: 'modal-body' }, ...body),
    el('div', { class: 'modal-foot' }, ...foot));
  const scrim = el('div', { class: 'scrim' }, box);
  const last = document.activeElement;
  const close = () => { scrim.remove(); document.removeEventListener('keydown', esc); last?.focus?.(); onclose?.(); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', esc);
  document.body.append(scrim);
  return { close, scrim };
}

// un dossier neuf avec des objets (d'un même Workspace, `space`) : déclaré, puis ils y sont rangés
function askFolderName(items, space = null) {
  const sp = space || items[0]?.space || here();
  const inp = el('input', { class: 'fld big-fld', maxlength: 60, placeholder: 'Planches MJ, Lycée, affaires de Seed…', spellcheck: 'false', 'aria-label': 'nom du dossier' });
  const pending = el('div', { class: 'pending' }, ...items.slice(0, 8).flatMap((it, k) => [k ? el('span', { class: 'arrow' }, '+') : null, miniOf(it)]),
    items.length > 8 ? el('span', { class: 'arrow' }, `+${items.length - 8}`) : null,
    el('span', { class: 'arrow' }, `→ un dossier de « ${spaceShort(sp)} »`));
  const form = el('form', { id: 'mf-form', autocomplete: 'off', style: { display: 'contents' } },
    el('label', { class: 'new-q', for: 'mf-name' }, 'Comment s\'appelle ce dossier ?'), pending, inp,
    el('p', { class: 'hint' }, 'Le nom se change ensuite d\'un double-clic dans l’arbre, ou sur le titre du dossier. Un dossier tient des images, des éléments, des vidéos et des sons — pas d\'autre dossier.'));
  inp.id = 'mf-name';
  const m = modal({
    title: 'nouveau dossier', body: [form],
    foot: [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Pas encore'),
      el('button', { class: 'tb go', type: 'submit', form: 'mf-form' }, 'Créer le dossier')],
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = inp.value.trim();
    if (!name) { inp.placeholder = 'il lui faut un nom'; inp.focus(); return; }
    m.close();
    // un seul geste : déclarer le dossier et y ranger ; Ctrl+Z les remet et l'oublie
    try {
      await U.run({ label: `créer le dossier « ${name} » avec ${what(items)}`,
        do: async () => {
          await api('asset/folders', { method: 'POST', body: { name }, espace: sp });
          const r = await api('asset/move', { method: 'POST', body: { ids: items.map((i) => i.id), folder: name }, espace: sp });
          r.space = sp;
          return r;
        },
        undo: async (r) => { await moveBack(r); await api('asset/folders/forget', { method: 'POST', body: { name }, espace: sp }); } });
      clearSel();
      say(`Dossier « ${name} » créé avec ${what(items)}`, true);
    } catch (err) { say(err.message); }
    refresh();
  };
  setTimeout(() => inp.focus(), 30);
}

// ── Character Factory → éléments ─────────────────────────────
async function cfModal() {
  const grid = el('div', { class: 'cf-grid' }, el('p', { class: 'lbl' }, 'lecture du studio'));
  const studio = el('a', { class: 'tb ghost', href: 'http://192.168.10.247:8765/', target: '_blank', rel: 'noopener' }, 'Ouvrir le studio ↗');
  const m = modal({
    title: 'importer de Character Factory', wide: true,
    body: [el('p', {}, 'Un personnage dont le visage est verrouillé devient un élément : son visage, ses looks, le plein pied de chaque tenue, ses expressions, et ce que sa fiche dit de lui. « Mettre à jour » relit le studio et remplace ses images sur place : l\'élément garde son nom, son dossier, et tout ce qui l\'appelle déjà.'), grid],
    foot: [studio, el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Fermer')],
    onclose: () => { if (S.route.view === 'lib') loadLib(); },
  });
  let data;
  try { data = await api('cf/characters'); } catch (e) { grid.replaceChildren(el('p', { class: 'warn' }, e.message)); return; }
  if (data.studio) studio.href = data.studio;
  const card = (c) => {
    const imported = c.imported?.[0];
    const pic = c.poster || c.thumb;
    const badge = !c.locked ? el('span', { class: 'kind amb' }, 'visage à verrouiller')
      : imported ? el('span', { class: 'kind ok' }, 'déjà importé') : el('span', { class: 'kind' }, 'prêt');
    const btns = el('div', { class: 'row' });
    const n = el('div', { class: 'cf-card' + (c.locked ? '' : ' off') },
      el('div', { class: 'pic' }, pic ? el('img', { src: href(pic), alt: '', loading: 'lazy' }) : null, badge),
      el('div', { class: 'body' }, el('span', { class: 'nm' }, c.name),
        el('span', { class: 'lbl' }, `${plural(c.costumes, 'tenue', 'tenues')} · ${plural(c.expressions, 'expression', 'expressions')}`), btns));
    const busy = async (fn) => { n.classList.add('pending'); try { await fn(); } catch (e) { say(e.message); } n.classList.remove('pending'); };
    if (!c.locked) {
      btns.append(el('button', { class: 'tb ghost sm', type: 'button', disabled: true, title: 'son visage n\'est pas encore verrouillé dans le studio' }, 'Importer'),
        el('a', { class: 'lbl', href: c.open, target: '_blank', rel: 'noopener' }, 'le verrouiller ↗'));
    } else if (imported) {
      btns.append(el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { m.close(); go('#' + imported); } }, 'Ouvrir'),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'relire le studio et remplacer ses images sur place',
          onclick: () => busy(async () => { const it = await api('asset/cf/refresh', { method: 'POST', body: { id: imported } }); say(`${it.title} mis à jour : ${plural(it.element.refs.length, 'référence', 'références')}`); }) }, 'Mettre à jour'));
    } else {
      btns.append(el('button', { class: 'tb ghost sm', type: 'button',
        onclick: () => busy(async () => {
          const it = await api('cf/import', { method: 'POST', body: { slug: c.slug } });
          c.imported = [it.id];
          n.replaceWith(card(c));
          say(`${c.name} est un élément : ${plural(it.element.refs.length, 'référence', 'références')}`, null);
        }) }, 'Importer'));
    }
    return n;
  };
  // d'abord ceux qu'on peut importer, puis les importés, puis ceux qui attendent le studio
  const rank = (c) => (!c.locked ? 2 : c.imported?.length ? 1 : 0);
  const list = [...data.characters].sort((a, b) => rank(a) - rank(b));
  grid.replaceChildren(...list.map(card));
}

// ── un élément neuf ──────────────────────────────────────────
// `space` : le Workspace où il naît (le lieu ouvert, celui des images choisies) ; ses
// références doivent en être (le serveur le juge : un objet d'ailleurs se rapatrie d'abord)
function elementModal({ items = [], title = '', etype = 'character', folder = null, space = null }) {
  const sp = space || items[0]?.space || target();
  let type = etype;
  const chosen = [...items];
  const name = el('input', { class: 'fld big-fld', id: 'me-name', maxlength: 80, value: title, placeholder: 'Seed, bottes LED, la cuisine…', spellcheck: 'false' });
  const seg = el('div', { class: 'seg wrap', role: 'radiogroup', 'aria-label': 'sorte' });
  const role = el('select', { class: 'fld', 'aria-label': 'rôle des références', style: { width: 'auto' } });
  const refs = el('div', { class: 'pending' });
  const desc = el('textarea', { class: 'fld', rows: 3, placeholder: 'la prose que les modèles liront : ce qu\'on voit, matières, couleurs, signes distinctifs' });
  const paintSeg = () => {
    seg.replaceChildren(...ETYPES.map(([k, l]) => el('button', { class: 'tb' + (type === k ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(type === k),
      onclick: () => { type = k; role.value = ROLE_FOR[k]; paintSeg(); } }, l)));
  };
  role.replaceChildren(...ROLES.map(([k, l]) => el('option', { value: k, selected: ROLE_FOR[type] === k }, l)));
  const paintRefs = () => refs.replaceChildren(...chosen.map(miniOf),
    el('button', { class: 'tb ghost sm', type: 'button', onclick: async () => {
      const got = await pick({ kinds: ['image'], multiple: true, title: 'Les références de l\'élément' });
      for (const it of got) if (!chosen.some((c) => c.id === it.id)) chosen.push(it);
      if (!name.value && chosen[0]) name.value = chosen[0].title;
      paintRefs();
    } }, chosen.length ? '+ encore' : 'Choisir dans la bibliothèque'));
  paintSeg(); paintRefs();
  const form = el('form', { id: 'me-form', autocomplete: 'off', style: { display: 'contents' } },
    el('div', { class: 'q-row' }, el('label', { class: 'new-q', for: 'me-name' }, 'Comment s\'appelle-t-il ?'), name),
    el('div', { class: 'q-row' }, el('span', { class: 'lbl' }, 'quelle sorte'), seg),
    el('div', { class: 'q-row' }, el('span', { class: 'lbl' }, 'ses références · on en ajoute ensuite dans sa fiche'), refs,
      el('label', { class: 'row' }, el('span', { class: 'lbl' }, 'avec le rôle'), role)),
    el('div', { class: 'q-row' }, el('span', { class: 'lbl' }, 'ce que les modèles liront'), desc),
    el('p', { class: 'hint' }, 'Un élément s\'appelle ensuite comme référence dans Image et Vidéo, comme une image.'));
  const m = modal({
    title: 'nouvel élément', body: [form],
    foot: [el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Pas encore'),
      el('button', { class: 'tb go', type: 'submit', form: 'me-form' }, 'Créer l\'élément')],
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const t = name.value.trim();
    if (!t) { name.placeholder = 'il lui faut un nom'; name.focus(); return; }
    try {
      // créer un élément se défait en le mettant à la corbeille ; le rétablir l'en sort
      let made = null;
      const it = await U.run({ label: `créer l’élément « ${t} »`,
        do: async () => {
          if (made) { await api(`library/${made.id}/restore`, { method: 'POST', espace: sp }); return made; }
          made = await api('elements', { method: 'POST', espace: sp, body: {
            title: t, type, description: desc.value.trim(), folder: folder ?? (S.route.view === 'lib' && placeSpace() === sp ? S.folder : ''),
            refs: chosen.map((c, k) => ({ item: c.id, role: role.value, label: type === 'object' && k === 0 ? 'face · 0°' : '' })) } });
          return made;
        },
        undo: async (x) => { await api(`library/${x.id}/delete`, { method: 'POST', espace: sp }); if (location.hash === '#' + x.id) go(S.backHash || '#'); } });
      m.close();
      say(`Élément « ${it.title} » créé dans « ${spaceShort(sp)} »`, true);
      go('#' + it.id);
    } catch (err) { say(err.message); }
  };
  setTimeout(() => name.focus(), 30);
}

// ── favori, corbeille ────────────────────────────────────────
async function setFav(it, on) {
  try {
    await libPatch(U, it.id, { fav: on }, on ? `mettre « ${it.title} » en favori` : `retirer « ${it.title} » des favoris`, { before: it });
    it.fav = on;
    say(on ? `${it.title} en favori` : `${it.title} n'est plus en favori`, true);
  } catch (e) { say(e.message); }
  refresh();
}

// la corbeille : depuis sa fiche, on la quitte ; l'annuler y ramène
async function trashItem(it, { leave = false } = {}) {
  const back = S.backHash || '#';
  try {
    await U.run({ label: `mettre « ${it.title} » à la corbeille`,
      do: async () => { await api(`library/${it.id}/delete`, { method: 'POST' }); if (leave && location.hash === '#' + it.id) go(back); },
      undo: async () => { const n = await api(`library/${it.id}/restore`, { method: 'POST' }); if (leave) go('#' + it.id); return n; } });
    say(`« ${it.title} » est à la corbeille`, true, 8000);
    if (!leave) refresh();
  } catch (e) { say(e.message); }
}

// ── déposer des fichiers, avec la progression ────────────────
let upBox = null;
function upRow(file) {
  if (!upBox) { upBox = el('div', { class: 'uploads', role: 'status', 'aria-label': 'dépôts' }); document.body.append(upBox); }
  const bar = el('i');
  const st = el('span', {}, 'envoi');
  const row = el('div', { class: 'up' }, el('span', { class: 'n' }, file.name),
    el('div', { class: 'meter' }, el('div', { class: 'row' }, st, el('span', { class: 'sp' }), el('span', {}, fmtSize(file.size))), el('div', { class: 'bar' }, bar)));
  upBox.append(row);
  return {
    prog: (f, msg) => { bar.style.width = `${Math.round(f * 100)}%`; st.textContent = msg || (f < 1 ? `envoi · ${Math.round(f * 100)} %` : 'rangement'); },
    done: (msg) => { row.classList.add('done'); bar.style.width = '100%'; st.textContent = msg; },
    fail: (msg) => { row.classList.add('err'); st.textContent = msg; },
  };
}
function xhrUpload(file, folder, onprog, space = null) {
  return new Promise((resolve, reject) => {
    // un dépôt du disque : catégorie Upload, entré par Asset (shell.js : uploadFile, même contrat)
    const q = new URLSearchParams({ name: file.name, tool: 'upload', via: 'asset', folder, title: file.name.replace(/\.[^.]+$/, '') });
    const x = new XMLHttpRequest();
    x.open('PUT', new URL('library/upload?' + q, API));
    x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    // le Workspace de l'onglet (api() le pose ; un XMLHttpRequest à la main le prend ici) : le dépôt y
    // entre — ou celui du lieu ouvert dans la page (un Workspace, un de ses dossiers)
    const h = space && space !== espace() ? { 'X-SR-Espace': space } : enTeteEspace();
    for (const [k, v] of Object.entries(h)) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onprog(e.loaded / e.total); };
    x.onload = () => {
      let d;
      try { d = JSON.parse(x.responseText); } catch { d = { error: x.responseText.slice(0, 200) }; }
      if (x.status >= 200 && x.status < 300) resolve(d); else reject(new Error(d.error || `${x.status}`));
    };
    x.onerror = () => reject(new Error('le portail ne répond pas'));
    x.send(file);
  });
}

let upClear;
async function uploadFiles(files, { folder = '', then, space = null } = {}) {
  const why = createWhy(space || here());
  if (why) { say(why); return; }
  clearTimeout(upClear);
  const done = [];
  for (const f of files) {
    const r = upRow(f);
    try {
      let it = await xhrUpload(f, folder, r.prog, space);
      // un PDF que le serveur n'a pas lu (sans poppler) : la page le lit et lui dépose son texte (commun/documents.js)
      if (it?.doc?.needs_page) { r.prog(1, 'lecture du PDF'); it = await lireSiBesoin(it, f); }
      r.done(`rangé${folder ? ` dans « ${folder} »` : ''}${space && space !== here() ? ` · ${spaceShort(space)}` : ''}`);
      done.push(it);
    } catch (e) { r.fail(e.message); }
  }
  if (then && done.length) await then(done);
  refresh();
  const errs = upBox && $$('.up.err', upBox).length;
  upClear = setTimeout(() => { upBox?.remove(); upBox = null; }, errs ? 12000 : 3500);
}

// des images deviennent des références de l'élément ouvert, au rôle choisi ;
// un son devient sa voix (le serveur la range dans `element.voices`)
async function addRefs(it, items) {
  const imgs = items.filter((x) => x.kind === 'image');
  const snd = items.find((x) => x.kind === 'audio');
  if (!imgs.length && !snd) {
    if (items.length) say('une référence est une image, une voix est un son : le reste est rangé dans la bibliothèque');
    return;
  }
  const lab = [imgs.length ? `ajouter ${plural(imgs.length, 'référence', 'références')}` : '', snd ? 'poser sa voix' : ''].filter(Boolean).join(' et ') + ` à « ${it.title} »`;
  try {
    await libBoard(U, it, lab, async () => {
      for (const x of imgs) await api(`elements/${it.id}/refs`, { method: 'POST', body: { item: x.id, role: S.addRole || 'detail', label: '' } });
      if (snd) await putVoice(it, snd);
    });
    say(imgs.length ? `${plural(imgs.length, 'référence ajoutée', 'références ajoutées')} à ${it.title} · rôle ${roleFr(S.addRole)}` : 'voix posée', true);
  } catch (e) { say(e.message); }
  if (imgs.length + (snd ? 1 : 0) < items.length) say('une référence est une image, une voix est un son : le reste est rangé dans la bibliothèque');
}

// la voix d'un élément : un son ; s'il en avait une, elle est remplacée
async function putVoice(it, snd) {
  const had = (it.element.voices || []).length;
  const n = await api(`elements/${it.id}/refs`, { method: 'POST', body: { item: snd.id, role: 'voice', label: snd.title || 'voix' } });
  const vs = n.element.voices || [];
  const added = vs[vs.length - 1];
  if (had) await api(`asset/refs/${it.id}`, { method: 'POST', body: { voices: [{ file: added.file, label: added.label, item: added.item }] } });
  return added;
}
async function setVoice(it, snd, { repaint = true } = {}) {
  const had = (it.element.voices || []).length;
  try {
    const { res: added } = await libBoard(U, it, had ? `remplacer la voix de « ${it.title} »` : `donner une voix à « ${it.title} »`, () => putVoice(it, snd));
    say(had ? `voix remplacée : ${added.label}` : `voix ajoutée : ${added.label}`, true);
  } catch (e) { say(e.message); }
  if (repaint) paintSheet(it.id, { keepScroll: true });
}

// Déposé ailleurs que sur un emplacement : dans la bibliothèque (le dossier
// ouvert) ; sur la fiche d'un élément, ses références.
dropAnywhere((files) => {
  if (S.route.view === 'sheet' && isForeign(S.item)) {
    say(`cette fiche est dans « ${spaceLong(S.item.space)} » : rapatrie-la d’abord, puis dépose sur sa copie`);
    return;
  }
  if (S.route.view === 'sheet' && S.item?.kind === 'element') {
    const it = S.item;
    return uploadFiles(files, { folder: it.folder || '', then: (items) => addRefs(it, items) });
  }
  return uploadFiles(files, S.route.view === 'lib' ? { folder: S.folder, space: target() } : {});
});

// ══ LA FICHE ════════════════════════════════════════════════
let sheetSeq = 0;
async function paintSheet(id, { keepScroll = false } = {}) {
  const y = scrollY;
  if (!keepScroll) sheetEl.replaceChildren(el('p', { class: 'lbl' }, 'chargement'));
  let it;
  // deux peintures qui se croisent (rapatrier repeint la fiche, puis ouvre la copie) : la dernière gagne
  const seq = ++sheetSeq;
  const stale = () => seq !== sheetSeq || S.route.view !== 'sheet' || S.route.id !== id;
  // montrer : la fiche d'un objet où qu'il soit (spaces=*) ; d'un autre Workspace, elle se regarde et se rapatrie
  try { it = await api('library/' + id + '?spaces=*'); } catch (e) {
    if (stale()) return;
    S.item = null;
    espaceDocument(null);
    sheetEl.replaceChildren(backLink(), el('div', { class: 'empty-state' }, el('b', {}, 'Introuvable'),
      el('p', { class: 'hint' }, `${id} n'est pas dans la bibliothèque (${e.message}). Il est peut-être à la corbeille.`),
      el('a', { class: 'tb ghost', href: '#/corbeille' }, 'Voir la corbeille')));
    return;
  }
  if (stale()) return;
  S.item = it;
  // le Workspace de l'onglet et les noms des autres (la vue les rend) : avant de juger « d'ailleurs »
  if (!S.data) { try { S.data = await api('asset/view?limit=1'); S.spaces = S.data.spaces || []; paintDatalist(); } catch { /* la fiche se montre quand même */ } }
  if (stale()) return;
  if (isForeign(it)) {
    espaceDocument(it.space);   // l'en-tête dit le Workspace du document ouvert (§ 4.3)
    sheetEl.replaceChildren(...foreignSheet(it));
    if (keepScroll) scrollTo({ top: y });
    return;
  }
  espaceDocument(null);
  if (isLiving(it)) {
    // un élément versionné : sa pile, sa source, ses usages (GET /api/elements/<id>)
    let d;
    try { d = await api('elements/' + id); } catch (e) { if (!stale()) sheetEl.replaceChildren(backLink(), el('p', { class: 'warn' }, e.message)); return; }
    if (stale()) return;
    S.item = d;
    sheetEl.replaceChildren(...livingSheet(d));
    paintDatalist();
    if (keepScroll) scrollTo({ top: y });
    return;
  }
  sheetEl.replaceChildren(...(it.kind === 'element' ? elementSheet(it) : it.kind === 'sequence' ? sequenceSheet(it)
    : it.kind === 'midi' ? midiSheet(it) : it.kind === 'document' ? documentSheet(it) : itemSheet(it)));
  paintDatalist();
  if (keepScroll) scrollTo({ top: y });
}

function backLink() {
  const h = S.backHash || '#';
  // le lieu d'où l'on vient (le même lecteur que l'adresse : parseHash)
  const p = parseHash(h).place;
  const lab = p && p.k !== 'all' ? `Asset / ${placeTitle(p)}` : 'Asset';
  return el('a', { class: 'o-back', href: h }, `‹ ${lab} · échap`);
}

// une modification de la fiche, rangée avec son contraire (commun/undo.js)
async function patch(it, body, label = null) {
  const n = await libPatch(U, it.id, body, label || `modifier « ${it.title} »`, { before: it });
  Object.assign(it, n);
  return n;
}
const flash = (n) => { n.classList.add('on'); setTimeout(() => n.classList.remove('on'), 1600); };

function sheetHead(it, kicker) {
  const saved = el('span', { class: 'saved', 'aria-live': 'polite' }, 'enregistré');
  const title = el('input', { class: 'sh-title', value: it.title || '', maxlength: 120, 'aria-label': 'titre', spellcheck: 'false' });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') title.blur();
    if (e.key === 'Escape') { e.stopPropagation(); title.value = it.title; title.blur(); }
  });
  title.addEventListener('change', async () => {
    const v = title.value.trim();
    if (!v || v === it.title) { title.value = it.title; return; }
    try { await patch(it, { title: v }, `renommer « ${it.title} » en « ${v} »`); flash(saved); } catch (e) { say(e.message); title.value = it.title; }
  });
  const star = el('button', { class: 'tb ghost star-btn' + (it.fav ? ' on' : ''), type: 'button', 'aria-pressed': String(!!it.fav), title: 'favori' },
    it.fav ? '★ favori' : '☆ favori');
  star.onclick = async () => {
    try {
      await patch(it, { fav: !it.fav }, it.fav ? `retirer « ${it.title} » des favoris` : `mettre « ${it.title} » en favori`);
      star.classList.toggle('on', it.fav); star.setAttribute('aria-pressed', String(it.fav)); star.textContent = it.fav ? '★ favori' : '☆ favori';
    } catch (e) { say(e.message); }
  };
  return el('section', { class: 'sh-head' },
    el('div', { class: 'who' }, backLink(), el('span', { class: 'kicker' }, kicker), title),
    el('div', { class: 'row' }, saved, star, el('span', { class: 'sr-undo', role: 'group', 'aria-label': 'annuler, rétablir' }, ...U.buttons())));
}

const link = (label, url, { go: orange = false, title = '', blank = false } = {}) =>
  el('a', { class: `tb ${orange ? 'go' : 'ghost'}`, href: url, title, target: blank ? '_blank' : null, rel: blank ? 'noopener' : null }, label);
const btn = (label, onclick, { title = '', disabled = false } = {}) => el('button', { class: 'tb ghost', type: 'button', onclick, title, disabled }, label);

function blk(ttl, lbl, ...body) {
  return el('div', { class: 'blk' }, el('div', { class: 'blk-head' }, el('span', { class: 'ttl' }, ttl), lbl ? el('span', { class: 'lbl' }, lbl) : null),
    el('div', { class: 'blk-body' }, ...body));
}
function readout(rows) {
  const r = rows.filter(([, v]) => v !== undefined && v !== null && v !== '');
  return el('dl', { class: 'facts' }, ...r.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
}

// Une vidéo ou un son d'une fiche : LE lecteur (commun/lecteur.js), dans le
// thème, l'image qui remplit le cadre dès l'ouverture, la frise et la tête du
// Montage (Cal, 30/09). Quitter la fiche l'arrête.
function mediaPlayer(it) {
  const L = lecteur(it, { clavier: 'page' });
  addEventListener('hashchange', () => L.detruire(), { once: true });
  return el('div', { class: 'sh-media sh-lect' }, L.el);
}

// ── la fiche d'un objet d'un autre Workspace ─────────────────
// Elle se regarde (le média, la recette, la lignée, la fabrication), se télécharge, et se
// rapatrie ; rien ne s'y modifie d'ici (le serveur répond 409 : core_api.elsewhere_or_404).
function foreignSheet(it) {
  const living = isLiving(it);
  const size = it.width && it.height ? `${it.width}×${it.height}` : '';
  const kind = it.kind === 'element' ? `élément · ${typeFr(it.element?.type)}` : kindFr(it.kind);
  const kicker = [kind, size, it.duration ? fmtDur(it.duration) : '', `dans ${spaceLong(it.space)}`].filter(Boolean).join(' · ');
  let media;
  if (!living && (it.kind === 'video' || it.kind === 'audio')) media = mediaPlayer(it);
  else if (it.kind === 'document') media = docReader(it, { deposer: false });
  else if (it.kind === 'element' && !living) {
    // la planche, en lecture : ses références dans l'ordre où un modèle les lit
    media = el('div', { class: 'sh-main' }, blk('références', 'dans l’ordre où un modèle les lit',
      el('div', { class: 'board ro', role: 'list', 'aria-label': 'références' },
        ...(it.element?.refs || []).map((r, i) => el('div', { class: 'refc', role: 'listitem' },
          el('div', { class: 'pic' }, el('img', { src: href(r.thumb_url || r.url), alt: r.label || roleFr(r.role), loading: 'lazy' }),
            el('span', { class: 'n' }, `${String(i + 1).padStart(2, '0')} · ${roleFr(r.role)}`)),
          r.label ? el('div', { class: 'body' }, el('span', { class: 'lbl' }, r.label)) : null)))));
  } else {
    media = el('div', { class: 'viewer sh-media' });
    if (it.kind === 'image' || ((it.kind === 'sequence' || living) && (it.thumb_url || it.views?.length))) {
      media.append(bindView(el('img', { alt: it.title, decoding: 'async' }), it, { fit: 'contain', box: [960, 720] }));
    } else media.append(el('div', { class: 'seq-empty' }, glyph(it.kind) || null, el('p', { class: 'hint' }, 'pas d’aperçu d’ici : sa fiche, dans son Workspace, le montre')));
  }
  const why = importWhy(it);
  const title = el('h1', { class: 'sh-title ro' }, it.title || it.id);
  const head = el('section', { class: 'sh-head' },
    el('div', { class: 'who' }, backLink(), el('span', { class: 'kicker' }, kicker), title),
    el('div', { class: 'row' }, el('span', { class: 'sr-undo', role: 'group', 'aria-label': 'annuler, rétablir' }, ...U.buttons())));
  const bring = el('button', { class: 'tb go', type: 'button', disabled: !!why,
    title: why || `une copie neuve dans « ${spaceLong(here())} » — titre, recette, tags suivent ; l’original ne bouge pas · Ctrl+Z l’annule`,
    onclick: async () => {
      const r = await rapatrier([it]);
      if (r?.[0]) go('#' + r[0].id);   // la copie, ici : elle se modifie, elle sert aux outils
    } }, `Rapatrier dans « ${spaceShort(here())} »`);
  const banner = el('section', { class: 'wsbanner' },
    wsBadge(it.space),
    el('span', { class: 'txt' }, 'Dans ', el('b', {}, spaceLong(it.space)), ' : tu le vois d’ici, on ne s’en sert pas d’ici. ',
      'Le rapatrier en fait une copie neuve dans ', el('b', {}, spaceLong(here())), ', que tes outils pourront poser.'),
    why ? el('span', { class: 'why' }, why) : null);
  const acts = el('section', { class: 'sh-acts' }, bring,
    el('a', { class: 'tb ghost', href: otherTab(it.space, '#' + it.id), title: 'ouvrir sa fiche dans son Workspace (cet onglet y passe)' }, 'Y aller'),
    el('span', { class: 'sp' }),
    it.url && it.kind !== 'element' ? el('a', { class: 'tb ghost', href: href(it.url), download: it.kind === 'document' ? nomDe(it) : `${it.title || it.id}${(it.file || '').replace(/^main/, '')}` }, 'Télécharger')
      : btn('Télécharger', () => download([it]), { title: 'un zip' }));
  const side = [];
  if (it.kind === 'element' && (it.element?.description || '').trim()) side.push(blk('ce que les modèles liront', null, el('p', { class: 'o-prose' }, it.element.description)));
  side.push(recette(it), lineage(it), fabrication(it));
  return [head, banner, acts, el('section', { class: 'sh-grid' }, media, el('aside', { class: 'sh-side' }, ...side))];
}

// une fiche : image, vidéo ou son
function itemSheet(it) {
  // la copie d'affichage à la taille de la fiche, pas l'original (commun/proxies.js)
  const media = it.kind === 'video' || it.kind === 'audio' ? mediaPlayer(it) : el('div', { class: 'viewer sh-media' });
  if (it.kind === 'image') media.append(bindView(el('img', { alt: it.title, decoding: 'async' }), it, { fit: 'contain', box: [960, 720] }));
  const size = it.width && it.height ? `${it.width}×${it.height}` : '';
  const tool = it.origin?.tool;
  const from = it.origin?.model || (!tool || tool === 'upload' ? `upload${it.origin?.via ? ` · par ${toolFr(it.origin.via)}` : ''}` : `fait dans ${toolFr(tool)}`);
  const kicker = [kindFr(it.kind), size, it.duration ? fmtDur(it.duration) : '', from].filter(Boolean).join(' · ');
  const id = encodeURIComponent(it.id);
  const acts = el('section', { class: 'sh-acts' });
  if (it.kind === 'image') {
    acts.append(link('Animer', href(`movie/?start=${id}`), { go: true, title: 'Vidéo : cette image en première image d\'un plan' }),
      link('Éditer dans Image', href(`image/?edit=${id}`)),
      link('Référence vidéo', href(`movie/?ref=${id}`), { title: 'Vidéo : cette image en référence d\'un plan' }),
      studioSeul(link('Ajouter au montage', href(`montage/?add=${id}`))),
      btn('Faire une planche de références', () => elementModal({ items: [it], title: it.title, folder: it.folder || '' }),
        { title: 'un élément de références (personnage, objet, lieu…) : l’image y est copiée' }));
  } else {
    acts.append(studioSeul(link('Ajouter au montage', href(`montage/?add=${id}`), { go: true })));
  }
  acts.append(...versionActs(it));
  acts.append(el('span', { class: 'sp' }),
    el('a', { class: 'tb ghost', href: href(it.url), download: `${it.title || it.id}${(it.file || '').replace(/^main/, '')}` }, 'Télécharger'),
    btn('Corbeille', () => trashItem(it, { leave: true }), { title: 'mettre à la corbeille — on peut l\'annuler' }));
  return [sheetHead(it, kicker), ...versionBanner(it), acts,
    el('section', { class: 'sh-grid' }, media, el('aside', { class: 'sh-side' }, rangement(it), recette(it), lineage(it), fabrication(it)))];
}

// ── une séquence du Montage ──────────────────────────────────
// Sa timeline vit dans `sequence.json` (server/tools/montage.py) ; ici, ce
// qu'on range d'un objet (titre, dossier, tags, corbeille), sa vignette (le
// premier plan qui se voit), les plans qu'elle emploie (sa lignée), et le
// chemin vers le Montage, qui l'ouvre par son adresse (montage/#<id>).
function sequenceSheet(it) {
  const p = it.params || {};
  const open = href(`montage/#${encodeURIComponent(it.id)}`);
  const media = el('div', { class: 'viewer sh-media seq-media' },
    it.thumb_url
      ? el('a', { class: 'seq-open', href: open, title: 'ouvrir dans le Montage' },
        bindView(el('img', { alt: it.title, decoding: 'async' }), it, { fit: 'contain', box: [960, 540] }),
        el('span', { class: 'seq-tag lbl' }, 'le premier plan'))
      : el('div', { class: 'seq-empty' }, strip(7), el('p', { class: 'hint' }, 'Aucun plan qui se voie encore : la séquence est vide, ou n’a que du son.')));
  const kicker = ['séquence', it.width && it.height ? `${it.width}×${it.height}` : '', it.fps ? `${it.fps} i/s` : '',
    it.duration ? fmtDur(it.duration) : '', 'fait dans Montage'].filter(Boolean).join(' · ');
  const acts = el('section', { class: 'sh-acts' },
    link('Ouvrir dans le Montage', open, { go: true, title: 'sa timeline, dans le Montage' }),
    el('span', { class: 'sp' }),
    el('a', { class: 'tb ghost', href: href(it.url), download: `${it.title || it.id}.sequence.json`, title: 'la timeline telle que le Montage la range (sequence.json)' }, 'Télécharger la timeline'),
    btn('Corbeille', () => trashItem(it, { leave: true }), { title: 'mettre à la corbeille — on peut l\'annuler ; le Montage ne la montre plus' }));
  const facts = blk('la séquence', 'lue dans le Montage', readout([
    ['plans', p.clips != null ? String(p.clips) : ''], ['durée', it.duration ? fmtDur(it.duration) : ''], ['format', p.format || ''],
    ['taille', it.width && it.height ? `${it.width} × ${it.height} px` : ''], ['images/s', it.fps],
  ]), el('p', { class: 'hint' }, 'Les plans qu’elle emploie sont sa lignée, ci-dessous : les ouvrir mène à leur fiche.'));
  return [sheetHead(it, kicker), acts,
    el('section', { class: 'sh-grid' }, media, el('aside', { class: 'sh-side' }, facts, rangement(it), lineage(it), fabrication(it)))];
}

// ── un document (05/10, server/tools/documents.py) ───────────
// Le fichier rangé tel qu'il a été déposé, et ce que le portail en a lu : LA liseuse
// (commun/documents.js) — les pages en vignettes, le texte page par page, les pages d'un
// PDF telles qu'elles sont ; Télécharger rend le fichier même ; Ouvrir, ce que le
// navigateur montre lui-même (un PDF, un texte : library.SAFE_TYPES). Un PDF que le
// serveur n'a pas lu est lu par la page à l'ouverture, et la fiche se repeint avec son texte.
const VIA_FR = { pdftotext: 'par poppler', page: 'dans le navigateur (pdf.js)', texte: 'comme texte', html: 'en HTML, sans les balises',
  xml: 'en XML, sans les balises', rtf: 'en RTF, sans la mise en forme', docx: 'dans le DOCX', pptx: 'dans le PPTX', xlsx: 'dans le classeur',
  opendocument: 'dans le fichier OpenDocument', epub: 'dans l’EPUB' };
// ce que le portail sert pour être vu, pas téléchargé (server/core/library.py, SAFE_TYPES)
const INLINE = new Set(['pdf', 'txt', 'md', 'markdown', 'csv', 'tsv', 'yaml', 'yml', 'log', 'srt', 'vtt']);
const docInline = (it) => !!it.url && INLINE.has((it.file || '').split('.').pop().toLowerCase());
let docL = null;   // la liseuse de la fiche ouverte : une seule (la fiche repeinte ferme l'ancienne)
function docReader(it, opts = {}) {
  docL?.detruire();
  const L = docL = liseuse(it, opts);
  addEventListener('hashchange', () => L.detruire(), { once: true });
  return el('div', { class: 'sh-media sh-doc' }, L.el);
}
function documentSheet(it) {
  const d = it.doc || {};
  // lu ici (un PDF sans poppler) : la fiche se repeint avec ce que la page a déposé
  const media = docReader(it, { telecharger: false, onitem: () => { if (S.route.view === 'sheet' && S.route.id === it.id) paintSheet(it.id, { keepScroll: true }); } });
  const tool = it.origin?.tool;
  const from = !tool || tool === 'upload' ? `upload${it.origin?.via ? ` · par ${toolFr(it.origin.via)}` : ''}` : `fait dans ${toolFr(tool)}`;
  const kicker = ['document', docLigne(it), from].filter(Boolean).join(' · ');
  const acts = el('section', { class: 'sh-acts' },
    el('a', { class: 'tb go', href: href(it.url), download: nomDe(it), title: `le fichier tel qu’il a été déposé (${d.label || 'document'})` }, 'Télécharger'),
    docInline(it) ? link('Ouvrir', href(it.url), { blank: true, title: d.format === 'pdf' ? 'le PDF dans la visionneuse du navigateur' : 'le texte tel quel, dans un nouvel onglet' }) : null,
    el('span', { class: 'sp' }),
    btn('Corbeille', () => trashItem(it, { leave: true }), { title: 'mettre à la corbeille — on peut l\'annuler ; son texte part avec lui' }));
  const facts = blk('le document', d.via ? `lu ${VIA_FR[d.via] || d.via}` : null, readout([
    ['format', d.label || ''], [d.unit || 'pages', d.pages ? String(d.pages) : ''], ['mots', d.words ? d.words.toLocaleString('fr-FR') : ''],
    ['titre lu', d.title || ''], ['fichier', nomDe(it)],
  ]), !d.has_text && d.why ? el('p', { class: 'hint' }, d.why) : null,
  d.truncated ? el('p', { class: 'hint' }, 'Le texte gardé s’arrête à deux millions de signes ; le fichier, lui, est entier.') : null);
  return [sheetHead(it, kicker), acts,
    el('section', { class: 'sh-grid' }, media, el('aside', { class: 'sh-side' }, facts, rangement(it), lineage(it), fabrication(it)))];
}

// ── un clip MIDI d'ODIO ──────────────────────────────────────
// Le fichier MIDI (SMF) s'écrit et se lit au serveur seulement
// (server/tools/music_midi.py, une seule vérité) : la fiche lit ses notes en
// noires ([début, durée, hauteur, vélocité, canal] : /api/music/midi/<id>/notes),
// les dessine, et les fait entendre par un synthé de la page (des hauteurs
// et un rythme, pas le son d'ODIO). Le clip se glisse dans l'arrangement
// d'ODIO (le type commun du portail : ODIO pose ses notes, une piste par canal).
const NOTE_FR = ['do', 'do#', 'ré', 'ré#', 'mi', 'fa', 'fa#', 'sol', 'sol#', 'la', 'la#', 'si'];
const noteFr = (n) => (n == null ? '' : `${NOTE_FR[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`);
const CH_TOKEN = { 0: '--cy', 1: '--or', 2: '--grn2', 9: '--amb' };
let midiAudio = null;   // { ctx, out, t0, end, raf } : ce qui joue
function stopMidi() {
  if (!midiAudio) return;
  cancelAnimationFrame(midiAudio.raf);
  try { midiAudio.out.disconnect(); } catch { /* déjà coupé */ }
  for (const n of midiAudio.nodes) { try { n.stop(); } catch { /* fini */ } }
  midiAudio.done?.();
  midiAudio = null;
}
function playMidi(r, bpm, { onFrame, onEnd }) {
  stopMidi();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) { say('ce navigateur ne joue pas de son (Web Audio)'); return; }
  const ctx = playMidi.ctx || (playMidi.ctx = new Ctx());
  ctx.resume?.();
  const spb = 60 / bpm, t0 = ctx.currentTime + 0.08;
  const out = ctx.createGain();
  out.gain.value = 0.2;
  out.connect(ctx.destination);
  const nodes = [];
  const notes = r.notes.slice(0, 4000);   // au-delà : le début seulement (dit dans la fiche)
  let noise = null;
  for (const [s, l, p, v, ch] of notes) {
    const a = t0 + s * spb, d = Math.max(0.04, l * spb), g = ctx.createGain();
    g.connect(out);
    if (ch === 9) {
      // la batterie : un souffle bref, plus grave pour les grosses caisses (hauteur General MIDI)
      if (!noise) { noise = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate); const x = noise.getChannelData(0); for (let i = 0; i < x.length; i++) x[i] = Math.random() * 2 - 1; }
      const src = ctx.createBufferSource(); src.buffer = noise;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = p <= 36 ? 120 : p <= 40 ? 900 : 6000;
      g.gain.setValueAtTime(v, a); g.gain.exponentialRampToValueAtTime(0.001, a + (p <= 36 ? 0.22 : 0.09));
      src.connect(f).connect(g); src.start(a); src.stop(a + 0.25); nodes.push(src);
    } else {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 440 * 2 ** ((p - 69) / 12);
      g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(v * 0.6, a + 0.01); g.gain.setTargetAtTime(0, a + d, 0.04);
      o.connect(g); o.start(a); o.stop(a + d + 0.25); nodes.push(o);
    }
  }
  const end = t0 + Math.max(0, ...notes.map((n) => n[0] + n[1])) * spb + 0.3;
  const A = { ctx, out, nodes, t0, end, raf: 0, done: onEnd };
  const tick = () => {
    if (midiAudio !== A) return;
    const beat = (ctx.currentTime - t0) / spb;
    onFrame?.(beat);
    if (ctx.currentTime >= end) { stopMidi(); return; }
    A.raf = requestAnimationFrame(tick);
  };
  midiAudio = A;
  A.raf = requestAnimationFrame(tick);
}
function drawRoll(cv, r, sig, beat = null) {
  const cs = getComputedStyle(document.documentElement);
  const tok = (n) => cs.getPropertyValue(n).trim();
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 800, H = cv.clientHeight || 260;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const notes = r?.notes || [];
  const len = Math.max(sig, Math.ceil(Math.max(0, ...notes.map((n) => n[0] + n[1])) / sig) * sig);
  const lo = Math.min(...notes.map((n) => n[2]), 60) - 2, hi = Math.max(...notes.map((n) => n[2]), 72) + 2;
  const x = (b) => 8 + (b / len) * (W - 16), rowH = (H - 16) / (hi - lo + 1), y = (p) => 8 + (hi - p) * rowH;
  g.fillStyle = tok('--line');
  for (let b = 0; b <= len; b += 1) g.fillRect(Math.round(x(b)), 8, b % sig ? 0.5 : 1, H - 16);
  for (const [s, l, p, v, ch] of notes) {
    g.globalAlpha = 0.45 + 0.55 * (v || 0.8);
    g.fillStyle = tok(CH_TOKEN[ch] || '--ink2');
    g.fillRect(x(s), y(p), Math.max(2, x(s + l) - x(s) - 1), Math.max(2, rowH - 1));
  }
  g.globalAlpha = 1;
  if (beat != null && beat >= 0 && beat <= len) { g.fillStyle = tok('--or'); g.fillRect(Math.round(x(beat)), 4, 2, H - 8); }
}
function midiSheet(it) {
  const p = it.params || {};
  const sig = [2, 3, 4, 6].includes(p.sig) ? p.sig : 4;
  let data = null;
  const cv = el('canvas', { class: 'roll-cv', role: 'img', 'aria-label': `les notes de « ${it.title} »` });
  const note = el('p', { class: 'hint midi-note' }, 'lecture des notes…');
  const media = el('div', { class: 'viewer sh-media midi-media' }, cv, note);
  const bpm = () => +p.bpm || +data?.file_bpm || 120;
  const listen = el('button', { class: 'tb ghost', type: 'button', disabled: true,
    title: 'un synthé simple de la page : les hauteurs et le rythme du clip, au tempo où il a été rangé — pas le son d’ODIO' }, 'Écouter');
  const paintListen = () => { listen.textContent = midiAudio ? '■ Arrêter' : '▶ Écouter'; };
  listen.onclick = () => {
    if (midiAudio) { stopMidi(); return; }
    playMidi(data, bpm(), { onFrame: (b) => drawRoll(cv, data, sig, b), onEnd: () => { paintListen(); drawRoll(cv, data, sig); } });
    paintListen();
  };
  paintListen();
  api(`music/midi/${encodeURIComponent(it.id)}/notes`).then((r) => {
    data = r;
    listen.disabled = !r.notes.length;
    note.textContent = r.notes.length
      ? `${plural(r.notes.length, 'note', 'notes')} · ${Object.values(r.channels || {}).join(', ')}${r.notes.length > 4000 ? ' · l’écoute s’arrête aux 4000 premières' : ''}`
      : 'ce clip n’a pas de note';
    requestAnimationFrame(() => drawRoll(cv, r, sig));
  }).catch((e) => { note.textContent = `notes illisibles : ${e.message}`; note.className = 'warn'; });
  // le clip, à glisser dans l'arrangement d'ODIO (un autre onglet) : ses notes s'y posent
  const chip = dragItem(el('div', { class: 'midi-drag', title: 'glisser sur une piste de l’arrangement d’ODIO' },
    roll(7), el('span', { class: 'md-t' }, el('b', {}, it.title || it.id), el('span', { class: 'lbl' }, 'glisser dans ODIO'))), it);
  const kicker = ['clip MIDI', p.bars ? plural(p.bars, 'mesure', 'mesures') : '', p.bpm ? `${p.bpm} bpm` : '', `${sig}/4`,
    it.origin?.tool === 'upload' ? 'importé' : `fait dans ${toolFr(it.origin?.tool)}`].filter(Boolean).join(' · ');
  const acts = el('section', { class: 'sh-acts' },
    studioSeul(link('Ouvrir ODIO ↗', href('musique/'), { go: true, blank: true, title: 'ODIO dans un autre onglet : glisse ensuite ce clip sur une piste' })),
    listen,
    el('span', { class: 'sp' }),
    el('a', { class: 'tb ghost', href: href(it.url), download: `${it.title || it.id}.mid` }, 'Télécharger (.mid)'),
    btn('Corbeille', () => trashItem(it, { leave: true }), { title: 'mettre à la corbeille — on peut l\'annuler' }));
  const facts = blk('le clip', 'lu dans le fichier', readout([
    ['notes', p.notes != null ? String(p.notes) : ''], ['mesures', p.bars != null ? String(p.bars) : ''], ['tempo', p.bpm ? `${p.bpm} bpm` : ''],
    ['mesure', `${sig}/4`], ['hauteurs', p.lo != null ? `${noteFr(p.lo)} → ${noteFr(p.hi)}` : ''], ['batterie', p.drums ? 'oui (canal 10)' : ''],
    ['méthode', { notes: 'notes', partition: 'partition', batterie: 'batterie', odio: 'un motif d’ODIO' }[p.method] || p.method || ''],
    ['moteur', p.engine === 'factice' ? 'moteur d’essai (factice)' : p.engine || ''],
  ]));
  const drop = blk('dans ODIO', null, chip,
    el('p', { class: 'hint' }, 'Ouvre ODIO dans un autre onglet, puis glisse ce clip sur une piste de l’arrangement : ses notes s’y posent (sur une piste d’instrument, tous ses canaux ; ailleurs, une piste neuve par canal). Le navigateur d’ODIO, rubrique MIDI, le propose aussi.'));
  acts.querySelector('.sp').before(...versionActs(it));
  const sheet = [sheetHead(it, kicker), ...versionBanner(it), acts,
    el('section', { class: 'sh-grid' }, el('div', { class: 'sh-main' }, media, drop), el('aside', { class: 'sh-side' }, facts, rangement(it), lineage(it), fabrication(it)))];
  // quitter la fiche coupe le son
  addEventListener('hashchange', stopMidi, { once: true });
  return sheet;
}

function rangement(it) {
  const folder =el('input', { class: 'fld', list: 'dl-folders', value: it.folder || '', placeholder: 'à la racine', maxlength: 60, 'aria-label': 'dossier' });
  folder.addEventListener('keydown', (e) => { if (e.key === 'Enter') folder.blur(); });
  folder.addEventListener('change', async () => {
    const v = folder.value.trim();
    const from = it.folder || '';
    if (v === from) return;
    try {
      await U.run({ label: v ? `ranger « ${it.title} » dans « ${v} »` : `sortir « ${it.title} » de « ${from} »`,
        do: () => api('asset/move', { method: 'POST', body: { ids: [it.id], folder: v } }), undo: moveBack });
      it.folder = v;
      say(v ? `rangé dans « ${v} »` : 'remis à la racine', true);
    } catch (e) { say(e.message); folder.value = from; }
  });
  const chips = el('div', { class: 'chips' });
  const paintTags = () => {
    const add = el('input', { class: 'fld', placeholder: '+ un tag', maxlength: 40, 'aria-label': 'ajouter un tag' });
    add.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = add.value.trim();
      if (!v || (it.tags || []).includes(v)) { add.value = ''; return; }
      try { await patch(it, { tags: [...(it.tags || []), v] }, `ajouter le tag « ${v} » à « ${it.title} »`); paintTags(); $('input', chips)?.focus(); } catch (err) { say(err.message); }
    });
    chips.replaceChildren(...(it.tags || []).map((t) => el('span', { class: 'chip' }, t,
      el('button', { type: 'button', title: `retirer « ${t} »`, 'aria-label': `retirer ${t}`, onclick: async () => {
        try { await patch(it, { tags: it.tags.filter((x) => x !== t) }, `retirer le tag « ${t} » de « ${it.title} »`); paintTags(); } catch (err) { say(err.message); }
      } }, '×'))), add);
  };
  paintTags();
  return blk('rangement', 'enregistré seul',
    el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'dossier · un nom neuf crée le dossier'), folder),
    el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'tags'), chips));
}

function paintDatalist() {
  let dl = $('#dl-folders');
  if (!dl) { dl = el('datalist', { id: 'dl-folders' }); document.body.append(dl); }
  dl.replaceChildren(...(S.data?.all_folders || []).map((f) => el('option', { value: f })));
}

function recette(it) {
  const o = it.origin || {};
  const params = Object.entries(it.params || {}).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && !v.length));
  const rows = [['outil', o.tool && o.tool !== 'upload' ? toolFr(o.tool) : ''], ['modèle', o.model], ['travail', o.job]];
  const body = [readout(rows)];
  if (it.prompt) body.push(el('span', { class: 'lbl' }, 'prompt'), el('p', { class: 'o-prose' }, it.prompt));
  if (params.length) body.push(el('span', { class: 'lbl' }, 'réglages'),
    readout(params.map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])));
  if (!it.prompt && !params.length && !o.model) body.push(el('p', { class: 'hint' }, o.tool === 'upload' || !o.tool ? 'Déposé tel quel : pas de recette.' : 'L\'outil n\'a pas laissé de recette.'));
  return blk('recette', 'de quoi le refaire', ...body);
}

function lineage(it) {
  const box = el('div', { class: 'lineage' }, el('p', { class: 'lbl' }, 'lecture'));
  // une vignette de la lignée se glisse vers un emplacement (la planche d'un élément…)
  // (d'un autre Workspace : la pastille le dit — la lignée d'une copie rapatriée reste dans A)
  const lk = (x) => dragItem(el('a', { class: 'lk', href: '#' + x.id, title: `${x.title}${x.space && x.space !== here() ? ` · dans ${spaceLong(x.space)}` : ''}` },
    x.thumb_url || x.views?.length ? bindView(el('img', { alt: '', loading: 'lazy', decoding: 'async' }), x, { fit: 'cover', box: [72, 72] }) : glyph(x.kind, true),
    x.space && x.space !== here() ? wsBadge(x.space, ' lkws') : null,
    el('i', {}, x.title)), x);
  api('asset/lineage/' + it.id).then((l) => {
    const parts2 = [];
    const frm = it.origin?.from;
    if (frm) {
      parts2.push(el('span', { class: 'lbl' }, `rapatrié de · ${spaceLong(frm.space)} · ${fmtDate(frm.at)}`),
        l.source ? el('div', { class: 'strip2' }, lk(l.source)) : el('p', { class: 'hint' }, l.source_gone ? 'l’original n’est plus visible (à la corbeille, ou hors de tes Workspaces) : la copie, elle, a tout.' : ''));
    }
    parts2.push(el('span', { class: 'lbl' }, `vient de · ${l.parents.length}${l.hidden ? ` · ${l.hidden} hors de ta vue` : ''}`),
      l.parents.length ? el('div', { class: 'strip2' }, ...l.parents.map(lk)) : el('p', { class: 'hint' }, l.hidden ? 'ses origines sont dans un Workspace que tu ne vois pas.' : 'rien : c\'est une origine.'));
    parts2.push(el('span', { class: 'lbl' }, `a servi à · ${l.children.length}`),
      l.children.length ? el('div', { class: 'strip2' }, ...l.children.map(lk)) : el('p', { class: 'hint' }, 'rien encore.'));
    if (l.copies?.length) parts2.push(el('span', { class: 'lbl' }, `rapatrié ailleurs · ${l.copies.length}`), el('div', { class: 'strip2' }, ...l.copies.map(lk)));
    box.replaceChildren(...parts2);
  }).catch((e) => box.replaceChildren(el('p', { class: 'warn' }, e.message)));
  return blk('lignée', null, box);
}

function fabrication(it) {
  const o = it.origin || {};
  return blk('fabrication', null, readout([
    ['origine', o.tool === 'upload' || !o.tool ? 'upload · déposé de son disque' : `fait dans ${toolFr(o.tool)}`],
    ['entré par', o.tool === 'upload' || !o.tool ? (o.via ? toolFr(o.via) : 'non dit (déposé avant le 29/09)') : ''],
    ['Workspace', manySpaces() || it.space !== here() ? spaceLong(it.space) : ''],
    ['rapatrié de', o.from ? `${spaceLong(o.from.space)} · ${fmtDate(o.from.at)}` : ''],
    ['machine', o.machine], ['créé', fmtDate(it.created)], ['modifié', it.updated && it.updated !== it.created ? fmtDate(it.updated) : ''],
    ['taille', it.width && it.height ? `${it.width} × ${it.height} px` : ''], ['durée', it.duration ? `${String(it.duration).replace('.', ',')} s` : ''],
    ['images/s', it.fps], ['fichier', it.file], ['id', it.id],
  ]));
}

// ══ LES ÉLÉMENTS VERSIONNÉS ═════════════════════════════════
// (30/09, docs/etudes/apps_studio_elements.md) Un élément relie une source
// vivante (un projet ODIO, une séquence, la recette d'un objet) à une pile de
// versions : des objets immuables, marqués `version: {of, n}`. Ici : « Faire un
// élément » d'un objet (il en devient la v1, sans copie), publier un objet comme
// version suivante, la fiche d'un élément (sa pile, sa source, ses usages).
// Les routes : server/tools/elements.py.

// l'objet est une version : de quel élément, et s'il y en a une plus récente
function versionBanner(it) {
  const v = it.version;
  if (!v?.of) return [];
  const newer = v.head && v.head !== v.n;
  return [el('section', { class: 'vbanner' + (newer ? ' newer' : '') },
    el('span', { class: 'vnum' }, `v${v.n}`),
    el('span', {}, v.of_present ? ['version ', el('b', {}, `${v.n}`), ' de ', el('a', { href: '#' + v.of }, `« ${v.of_title} »`),
      v.state === 'withdrawn' ? ' · retirée' : newer ? ` · la v${v.head} existe` : ' · la dernière'] : 'version d’un élément qui est à la corbeille'),
    el('span', { class: 'sp' }),
    el('span', { class: 'lbl' }, 'une version publiée ne change plus : titre, dossier et tags restent libres'))];
}

// « Faire un élément » (l'objet en devient la v1) ou « Publier comme version de… »
function versionActs(it) {
  if (it.version?.of || isLiving(it) || !['image', 'video', 'audio', 'midi', 'element'].includes(it.kind)) return [];
  return [btn('Faire un élément (v1)', () => makeElementFrom(it), { title: 'un élément versionné dont cet objet est la v1 — rien n’est recopié' }),
    btn('Publier comme version de…', () => publishInto(it), { title: 'ranger cet objet comme version suivante d’un élément à toi' })];
}

async function makeElementFrom(it) {
  try {
    let made = null;
    const d = await U.run({ label: `faire de « ${it.title} » la v1 d’un élément`,
      do: async () => {
        if (made) { await api(`library/${made.id}/restore`, { method: 'POST' }); return made; }
        made = await api('elements', { method: 'POST', body: { from_item: it.id, note: 'v1' } });
        return made;
      },
      undo: async (x) => { await api(`library/${x.id}/delete`, { method: 'POST' }); if (location.hash === '#' + x.id) go(S.backHash || '#'); } });
    say(`« ${d.title} » est un élément : cet objet en est la v1`, true);
    go('#' + d.id);
  } catch (e) { say(e.message); }
}

// publier : l'objet devient la version n+1 ; l'annuler la retire (elle reste dans la pile)
async function publishVersion(elId, item, note) {
  const r = await U.run({ label: `publier « ${item.title} » comme version`,
    do: async (again) => {
      if (again?.version) { await api(`elements/${elId}/versions/${again.version.n}`, { method: 'POST', body: { state: 'ready' } }); return again; }
      return api(`elements/${elId}/versions`, { method: 'POST', body: { item: item.id, note } });
    },
    undo: (x) => api(`elements/${elId}/versions/${x.version.n}`, { method: 'POST', body: { state: 'withdrawn' } }) });
  say(`publié : v${r.version.n} de « ${r.element.title} »`, true);
  return r;
}

// choisir l'élément (les siens, de la bonne sorte), puis la note
async function publishInto(it) {
  let list = [];
  try { list = (await api('elements')).items || []; } catch (e) { say(e.message); return; }
  const media = { image: 'image', video: 'video', audio: 'audio', midi: 'midi', element: 'refs' }[it.kind];
  const fit = list.filter((e) => !e.element.media || e.element.media === media);
  const note = el('input', { class: 'fld', maxlength: 400, placeholder: 'ce qui change : refrain court, nouvelle lumière…', 'aria-label': 'note de publication' });
  let chosen = null;
  const rows = el('div', { class: 'vpick' }, ...(fit.length ? fit.map((e) => {
    const b = el('button', { class: 'vpick-row', type: 'button', 'aria-pressed': 'false', onclick: () => {
      chosen = e; $$('.vpick-row', rows).forEach((n) => n.setAttribute('aria-pressed', String(n === b))); ok.disabled = false; ok.title = ''; } },
    el('b', {}, e.title), el('span', { class: 'lbl' }, `${typeFr(e.element.type)} · ${e.element.head ? `v${e.element.head}` : 'sans version'} → v${(e.element.count || 0) + 1}`));
    return b;
  }) : [el('p', { class: 'hint' }, `Aucun élément à toi qui prenne ${kindFr(it.kind)} comme version. « Faire un élément (v1) » en crée un.`)]));
  const ok = el('button', { class: 'tb go', type: 'button', disabled: true, title: 'choisis d’abord l’élément' }, 'Publier');
  const m = modal({ title: 'publier comme version', wide: true,
    body: [el('p', {}, `« ${it.title} » devient la version suivante de l’élément choisi. Les endroits qui posent une version plus ancienne la gardent, et voient qu’une nouvelle existe.`),
      rows, el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'note de publication'), note)],
    foot: [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Pas encore'), ok] });
  ok.onclick = async () => {
    if (!chosen) return;
    try { await publishVersion(chosen.id, it, note.value.trim()); m.close(); go('#' + chosen.id); } catch (e) { say(e.message); }
  };
}

// depuis la fiche d'un élément : choisir l'objet qui sera la version suivante
async function publishFrom(d) {
  const kinds = MEDIA_KINDS[d.element.media] || ['image', 'video', 'audio'];
  const [got] = await pick({ kinds, title: `La v${(d.element.count || 0) + 1} de ${d.title}` });
  if (!got) return;
  if (got.version?.of) { say(`« ${got.title} » est déjà la v${got.version.n} d’un élément`); return; }
  const note = el('input', { class: 'fld', maxlength: 400, placeholder: 'ce qui change', 'aria-label': 'note de publication' });
  const ok = el('button', { class: 'tb go', type: 'button' }, `Publier la v${(d.element.count || 0) + 1}`);
  const m = modal({ title: 'publier une version',
    body: [el('div', { class: 'pending' }, miniOf(got), el('span', { class: 'arrow' }, `→ v${(d.element.count || 0) + 1} de « ${d.title} »`)),
      el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'note de publication'), note)],
    foot: [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Pas encore'), ok] });
  setTimeout(() => note.focus(), 30);
  note.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
  ok.onclick = async () => {
    try { await publishVersion(d.id, got, note.value.trim()); m.close(); paintSheet(d.id, { keepScroll: true }); } catch (e) { say(e.message); }
  };
}

const useLine = (u) => (u.hidden ? el('li', { class: 'hint' }, `${u.what} d’une autre personne`)
  : el('li', {}, el('a', { href: href(u.open), title: `ouvrir ${u.what}` }, `${u.what} « ${u.title} »`), el('span', { class: 'lbl' }, ` ${u.where}`),
    u.n != null ? el('span', { class: 'vchip' + (u.latest ? '' : ' old') }, `v${u.n}${u.latest ? '' : ' · pas la dernière'}`) : null));

function versionRow(d, v) {
  const o = v.object;
  const pic = o && (o.thumb_url || o.views?.length) ? bindView(el('img', { alt: '', loading: 'lazy', decoding: 'async' }), o, { fit: 'cover', box: [96, 96] })
    : glyph(o?.kind || (d.element.media === 'audio' ? 'audio' : ''), true) || el('span', { class: 'noimg' }, '—');
  const chips = [v.head ? el('span', { class: 'vchip on' }, 'la dernière') : null,
    v.state === 'withdrawn' ? el('span', { class: 'vchip' }, 'retirée') : null,
    v.trashed ? el('span', { class: 'vchip' }, 'à la corbeille') : null,
    el('span', { class: 'vchip' + (v.uses.length ? ' used' : '') }, v.uses.length ? plural(v.uses.length, 'usage', 'usages') : 'posée nulle part')].filter(Boolean);
  const acts = [];
  if (o) acts.push(el('a', { class: 'tb ghost sm', href: '#' + o.id }, 'Fiche'));
  if (v.present) {
    acts.push(btn(v.state === 'withdrawn' ? 'Remettre' : 'Retirer', async () => {
      const st = v.state === 'withdrawn' ? 'ready' : 'withdrawn';
      try {
        await U.run({ label: `${st === 'ready' ? 'remettre' : 'retirer'} la v${v.n} de « ${d.title} »`,
          do: () => api(`elements/${d.id}/versions/${v.n}`, { method: 'POST', body: { state: st } }),
          undo: () => api(`elements/${d.id}/versions/${v.n}`, { method: 'POST', body: { state: v.state } }) });
        say(st === 'ready' ? `v${v.n} remise` : `v${v.n} retirée : elle ne se propose plus ; ses usages la gardent`, true);
      } catch (e) { say(e.message); }
      paintSheet(d.id, { keepScroll: true });
    }, { title: v.state === 'withdrawn' ? 'la remettre dans les versions proposées' : 'une version ratée : elle ne se propose plus, ses usages la gardent' }));
  }
  if (o?.url && ['audio'].includes(o.kind)) acts.push(petitLecteur(o.url, { duree: o.duration || 0, titre: `v${v.n}` }));
  return el('li', { class: 'vrow' + (v.head ? ' head' : '') + (v.state === 'withdrawn' || v.trashed ? ' off' : ''), 'data-n': v.n },
    el('div', { class: 'vpic' }, pic),
    el('div', { class: 'vn' }, `v${v.n}`),
    el('div', { class: 'vmeta' }, el('b', {}, v.note || (o?.title ?? v.item)),
      el('span', { class: 'lbl' }, [v.by_name, fmtDate(v.at), o?.duration ? fmtDur(o.duration) : '', o && v.note ? o.title : ''].filter(Boolean).join(' · ')),
      el('div', { class: 'chips' }, ...chips),
      v.uses.length ? el('ul', { class: 'vuses' }, ...v.uses.map(useLine)) : null),
    el('div', { class: 'vacts' }, ...acts));
}

function livingSheet(d) {
  const e = d.element;
  const s = d.source_state || {};
  const kicker = ['élément', typeFr(e.type), e.head ? `v${e.head}` : 'pas encore publié', plural(e.count || 0, 'version', 'versions')].join(' · ');
  const head = sheetHead(d, kicker);
  const cur = d.versions.find((v) => v.head);
  const o = cur?.object;
  const acts = el('section', { class: 'sh-acts' },
    el('button', { class: 'tb go', type: 'button', onclick: () => publishFrom(d), title: 'ranger un objet de la bibliothèque comme version suivante' }, `Publier la v${(e.count || 0) + 1}…`),
    s.open ? link(`Ouvrir la source · ${s.what || toolFr(s.tool)}`, href(s.open), { title: s.title || '' }) : null,
    el('span', { class: 'sp' }),
    btn('Télécharger', () => download([d]), { title: 'la dernière version' }),
    btn('Corbeille', () => trashItem(d, { leave: true }), { title: 'mettre l’élément à la corbeille — ses versions restent des objets, ses usages ne cassent pas' }));
  const media = o?.kind === 'video' || o?.kind === 'audio' ? mediaPlayer(o) : el('div', { class: 'viewer sh-media' });
  if (o?.kind === 'image') media.append(bindView(el('img', { alt: o.title, decoding: 'async' }), o, { fit: 'contain', box: [960, 720] }));
  else if (o?.kind === 'video' || o?.kind === 'audio') { /* le lecteur, ci-dessus */ }
  else if (o?.kind === 'element') media.append(el('a', { class: 'seq-open', href: '#' + o.id }, o.thumb_url ? bindView(el('img', { alt: o.title }), o, { fit: 'contain', box: [960, 720] }) : 'la planche'));
  else media.append(el('div', { class: 'seq-empty' }, el('p', { class: 'hint' }, e.count ? 'Aucune version prête : elles sont retirées ou à la corbeille.' : 'Pas encore de version : publie la première depuis la source, ou range un objet comme v1.')));
  const pile = blk('les versions', `${plural(e.count || 0, 'version', 'versions')} · la plus récente devant`,
    d.versions.length ? el('ol', { class: 'vpile' }, ...d.versions.map((v) => versionRow(d, v))) : el('p', { class: 'hint' }, 'Aucune encore.'));
  const srcBlk = blk('source', STATE_FR[s.state] ? stateLine(s) : '',
    readout([['outil', toolFr(s.tool)], ['document', s.title], ['état', stateLine(s)], ['rev', s.rev != null ? String(s.rev) : '']]),
    s.state === 'modifiée' ? el('p', { class: 'hint' }, `La source a changé depuis la v${s.since} : publie la v${(e.count || 0) + 1} depuis son outil (ODIO : menu ⋯ → Publier comme élément), ou range ici un objet rendu.`) : null,
    s.state === 'non suivie' ? el('p', { class: 'hint' }, 'Cette source n’a pas encore d’empreinte : on ne sait pas dire si elle a changé.') : null);
  const usesBlk = blk('usages', d.uses.length ? plural(d.uses.length, 'endroit', 'endroits') : 'aucun',
    d.uses.length ? el('ul', { class: 'vuses' }, ...d.uses.map(useLine)) : el('p', { class: 'hint' }, 'Aucun document ne pose encore une de ses versions.'));
  const side = [srcBlk, usesBlk];
  if (d.contains?.length) side.push(blk('contient', null, el('ul', { class: 'vuses' }, ...d.contains.map((c) => el('li', {}, el('a', { href: '#' + c.el }, `« ${c.title} »`))))));
  side.push(rangement(d), fabrication(d));
  return [head, acts, el('section', { class: 'sh-grid' }, el('div', { class: 'sh-main' }, media, pile), el('aside', { class: 'sh-side' }, ...side))];
}

// une fiche d'élément : la planche de références
function elementSheet(it) {
  const e = it.element;
  const src = e.source || {};
  const kicker = () => `élément · ${etypeFr(it.element.type)} · ${plural(it.element.refs.length, 'référence', 'références')}${it.element.voices?.length ? ' · une voix' : ''}`;
  const head = sheetHead(it, kicker());
  const id = encodeURIComponent(it.id);
  const acts = el('section', { class: 'sh-acts' },
    link('Référence vidéo', href(`movie/?ref=${id}`), { go: true, title: 'Vidéo : cet élément en référence d\'un plan' }));
  if (e.type === 'object') acts.append(link('Ouvrir dans Object Creator', href(`objet/#${id}`)));
  if (src.tool === 'character-factory') {
    acts.append(link('Sa fiche dans Character Factory ↗', src.open, { blank: true }),
      btn('Mettre à jour depuis le studio', async (ev) => {
        const b = ev.currentTarget; b.disabled = true; b.textContent = 'lecture du studio…';
        try { const n = await api('asset/cf/refresh', { method: 'POST', body: { id: it.id } }); say(`${n.title} mis à jour : ${plural(n.element.refs.length, 'référence', 'références')}`); paintSheet(it.id, { keepScroll: true }); } catch (err) { say(err.message); b.disabled = false; b.textContent = 'Mettre à jour depuis le studio'; }
      }, { title: it.version?.of ? 'relire le personnage : une planche neuve, publiée comme version suivante de son élément' : 'relire le personnage et remplacer ses images sur place' }));
  }
  acts.append(...versionActs(it), el('span', { class: 'sp' }),
    btn('Télécharger', () => download([it]), { title: 'un zip : ses références dans l\'ordre, sa 3D, sa description' }),
    btn('Corbeille', () => trashItem(it, { leave: true }), { title: 'mettre à la corbeille — on peut l\'annuler' }));

  // la planche
  const board = el('div', { class: 'board', role: 'list', 'aria-label': 'références' });
  if (S.addRoleFor !== it.id) {
    // un personnage qui a déjà son visage reçoit plutôt des expressions
    S.addRole = e.type === 'character' && e.refs.some((r) => r.role === 'face') ? 'expression' : ROLE_FOR[e.type] || 'detail';
    S.addRoleFor = it.id;
  }
  const addRole = el('select', { class: 'fld', style: { width: 'auto' }, 'aria-label': 'rôle des références ajoutées' },
    ...ROLES.map(([k, l]) => el('option', { value: k, selected: S.addRole === k }, l)));
  addRole.onchange = () => { S.addRole = addRole.value; };
  // toute retouche de la planche (rôle, libellé, ordre, retrait) se range avec son contraire
  const saveRefs = async (list, msg, label = null) => {
    try {
      const { item: n } = await libBoard(U, it, label || msg || `retoucher la planche de « ${it.title} »`,
        () => api('asset/refs/' + it.id, { method: 'POST', body: { refs: list.map((r) => ({ file: r.file, role: r.role, label: r.label, item: r.item })) } }));
      Object.assign(it, n);
      paintBoard();
      $('.kicker', head).textContent = kicker();
      if (msg) say(msg, true);
    } catch (err) { say(err.message); paintBoard(); }
  };
  const refCard = (r, i) => {
    const sel = el('select', { class: 'fld', 'aria-label': `rôle de la référence ${i + 1}` }, el('option', { value: '' }, 'rôle ?'),
      ...ROLES.map(([k, l]) => el('option', { value: k, selected: r.role === k }, l)),
      r.role && !ROLES.some(([k]) => k === r.role) ? el('option', { value: r.role, selected: true }, r.role) : null);
    sel.onchange = () => { const list = it.element.refs.map((x) => ({ ...x })); list[i].role = sel.value; saveRefs(list, null, `changer le rôle de la référence ${i + 1} en « ${roleFr(sel.value)} »`); };
    const lab = el('input', { class: 'fld', value: r.label || '', placeholder: 'libellé', maxlength: 80, 'aria-label': `libellé de la référence ${i + 1}` });
    lab.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') lab.blur(); });
    lab.onchange = () => { const list = it.element.refs.map((x) => ({ ...x })); list[i].label = lab.value.trim(); saveRefs(list, null, `changer le libellé de la référence ${i + 1}`); };
    const x = el('button', { class: 'x', type: 'button', title: 'retirer de l\'élément', 'aria-label': `retirer la référence ${i + 1}`,
      onclick: () => { const list = it.element.refs.filter((_, k) => k !== i).map((y) => ({ ...y })); saveRefs(list, `référence ${i + 1} retirée`, `retirer la référence ${i + 1} de « ${it.title} »`); } }, '×');
    return el('div', { class: 'refc' + (r.role ? '' : ' role-none'), 'data-i': i, role: 'listitem' },
      el('div', { class: 'pic', title: 'glisser pour changer l\'ordre' }, el('img', { src: href(r.thumb_url || r.url), alt: r.label || roleFr(r.role) }),
        el('span', { class: 'n' }, `${String(i + 1).padStart(2, '0')} · ${roleFr(r.role)}`), x),
      el('div', { class: 'body' }, sel, lab));
  };
  const paintBoard = () => {
    board.replaceChildren(...it.element.refs.map(refCard),
      el('button', { class: 'refc add', type: 'button', onclick: async () => {
        const got = await pick({ kinds: ['image'], multiple: true, title: `Ajouter à ${it.title}` });
        if (!got.length) return;
        try {
          const { item: n } = await libBoard(U, it, `ajouter ${plural(got.length, 'référence', 'références')} à « ${it.title} »`, async () => {
            for (const g of got) await api(`elements/${it.id}/refs`, { method: 'POST', body: { item: g.id, role: S.addRole, label: '' } });
          });
          Object.assign(it, n);
          say(`${plural(got.length, 'référence ajoutée', 'références ajoutées')} · rôle ${roleFr(S.addRole)}`, true);
        } catch (err) { say(err.message); }
        paintBoard(); $('.kicker', head).textContent = kicker();
      } }, el('b', {}, '+'), el('span', { class: 'lbl' }, 'ajouter depuis la bibliothèque'), el('span', { class: 'hint' }, 'ou déposer ici des images : de ton disque, ou une vignette glissée')));
  };
  paintBoard();
  enableRefDrag(board, it, saveRefs);
  // une vignette glissée d'un autre Workspace (le panneau, un autre onglet) : rapatriée d'abord,
  // puis sa copie devient la référence — l'élément ne pose jamais un objet d'ailleurs
  itemDrop(board, async (items) => {
    const away = items.filter(isForeign);
    const copies = away.length ? (await rapatrier(away, { folder: it.folder || '' })) || [] : [];
    const use = [];
    for (const x of items.filter((y) => !isForeign(y))) {   // un élément versionné : sa dernière version (comme dropZone)
      if (isLiving(x) && x.element?.head_item) { try { use.push(await api('library/' + x.element.head_item)); } catch { /* partie */ } } else use.push(x);
    }
    use.push(...copies);
    if (use.length) { await addRefs(it, use); paintSheet(it.id, { keepScroll: true }); }
    dock.recent(use);
  });
  // les références se déposent : un fichier du disque (catégorie Upload) ou une vignette glissée
  dropZone(board, { kinds: ['image', 'audio'], via: 'asset', onitems: async (items) => {
    await addRefs(it, items);
    paintSheet(it.id, { keepScroll: true });
  } });

  // la voix : un son, le même d'un plan à l'autre (Cal, 29/09 : « l'audio consistant »)
  const voices = e.voices || [];
  const pickVoice = async () => {
    const [snd] = await pick({ kinds: ['audio'], title: `La voix de ${it.title}` });
    if (snd) setVoice(it, snd);
  };
  const removeVoice = async (v) => {
    const keep = voices.filter((x) => x.file !== v.file).map((x) => ({ file: x.file, label: x.label, item: x.item }));
    try {
      await libBoard(U, it, `retirer la voix de « ${it.title} »`, () => api(`asset/refs/${it.id}`, { method: 'POST', body: { voices: keep } }));
      say('voix retirée', true);
    } catch (err) { say(err.message); }
    paintSheet(it.id, { keepScroll: true });
  };
  const voiceBlk = blk('sa voix', voices.length ? plural(voices.length, 'son', 'sons') : 'pas encore',
    ...(voices.length ? voices.map((v) => el('div', { class: 'voice' },
      wave(14),
      el('div', { class: 'vmeta' }, el('b', {}, v.label || 'voix'),
        el('span', { class: 'lbl' }, [v.duration ? fmtDur(v.duration) : '', (v.file.split('.').pop() || '').toUpperCase()].filter(Boolean).join(' · '))),
      petitLecteur(v.url, { duree: v.duration || 0, titre: v.label || 'voix' }),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'retirer la voix — on peut l\'annuler', onclick: () => removeVoice(v) }, 'Retirer')))
      : [el('p', { class: 'hint' }, 'Aucune voix : dépose ici un son (WAV, MP3, FLAC, M4A, OGG) ou choisis-en un dans la bibliothèque. L\'élément la portera avec ses images, pour que ce personnage garde la même voix d\'un plan à l\'autre.')]),
    el('div', { class: 'row' }, el('button', { class: 'tb ghost sm', type: 'button', onclick: pickVoice }, voices.length ? 'Remplacer depuis la bibliothèque' : 'Choisir dans la bibliothèque'),
      el('span', { class: 'lbl' }, 'ou déposer un son ici')));
  voiceBlk.classList.add('voice-blk');
  dropZone(voiceBlk, { kinds: ['audio'], multiple: false, via: 'asset', onitems: ([snd]) => setVoice(it, snd) });

  // la colonne
  const saved = el('span', { class: 'saved' }, 'enregistré');
  const desc = el('textarea', { class: 'fld', rows: 7, placeholder: 'ce qu\'on voit, matières, couleurs, signes distinctifs : la prose que les modèles liront', 'aria-label': 'description' });
  desc.value = e.description || '';
  desc.addEventListener('change', async () => {
    try { await patch(it, { element: { description: desc.value.trim() } }, `réécrire la description de « ${it.title} »`); flash(saved); } catch (err) { say(err.message); }
  });
  const seg = el('div', { class: 'seg wrap', role: 'radiogroup', 'aria-label': 'sorte' });
  const paintSeg = () => seg.replaceChildren(...ETYPES.map(([k, l]) => el('button', { class: 'tb' + (it.element.type === k ? ' on' : ''), type: 'button', role: 'radio',
    'aria-checked': String(it.element.type === k), onclick: async () => {
      try { await patch(it, { element: { type: k } }, `faire de « ${it.title} » un ${etypeFr(k)}`); paintSeg(); $('.kicker', head).textContent = kicker(); } catch (err) { say(err.message); }
    } }, l)));
  paintSeg();
  const side = [
    blk('sorte', null, seg),
    blk('ce que les modèles liront', null, desc, el('div', { class: 'row' }, saved, el('span', { class: 'sp' }), el('span', { class: 'lbl' }, 'enregistré en quittant le champ'))),
  ];
  if (src.tool === 'character-factory') {
    side.push(blk('source', 'Character Factory', readout([['personnage', src.slug], ['importé', fmtDate(it.created)], ['mis à jour', src.refreshed ? fmtDate(src.refreshed) : 'jamais']]),
      el('a', { class: 'lbl', href: src.open, target: '_blank', rel: 'noopener' }, 'sa fiche dans le studio ↗')));
  } else if (src.tool === 'object') {
    side.push(blk('source', 'Object Creator', el('p', { class: 'hint' }, 'Créé dans Object Creator : ses vues et sa 3D s\'y suivent.'),
      el('a', { class: 'lbl', href: href(`objet/#${id}`) }, 'ouvrir dans Object Creator')));
  }
  if (e.meshes?.length) {
    side.push(blk('3D', `${e.meshes.length}`, readout(e.meshes.slice().reverse().map((m) => [m.file, `${m.factice ? 'factice · ' : ''}${m.faces ?? '?'} faces · ${fmtDate(m.created)}`]))));
  }
  side.push(rangement(it), lineage(it), fabrication(it));

  return [head, ...versionBanner(it), acts, el('section', { class: 'sh-grid' },
    el('div', { class: 'sh-main' },
      blk('références', 'dans l\'ordre où un modèle les lit',
        el('div', { class: 'row' }, el('span', { class: 'hint' }, `${ORDER_HINT[e.type] || ORDER_HINT.other} Glisser une image pour la déplacer.`),
          el('span', { class: 'sp' }), el('label', { class: 'row' }, el('span', { class: 'lbl' }, 'ajouter comme'), addRole)), board),
      voiceBlk),
    el('aside', { class: 'sh-side' }, ...side))];
}

// réordonner la planche : glisser une image entre deux autres
function enableRefDrag(board, it, saveRefs) {
  // le pointeur est capturé par la planche : aucun écouteur ne reste sur la page
  let rd = null;
  board.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const c = e.target.closest('.refc[data-i]');
    if (!c || !e.target.closest('.pic') || e.target.closest('button')) return;
    e.preventDefault();          // pas de sélection de texte pendant le glisser
    rd = { i: +c.dataset.i, card: c, x0: e.clientX, y0: e.clientY, started: false };
    board.setPointerCapture(e.pointerId);
  });
  const clear = () => $$('.ins-before, .ins-after', board).forEach((n) => n.classList.remove('ins-before', 'ins-after'));
  board.addEventListener('pointercancel', () => { if (rd) { clear(); rd.card.classList.remove('lifting'); document.body.classList.remove('dragging'); rd = null; } });
  board.addEventListener('pointermove', (e) => {
    if (!rd) return;
    if (!rd.started) {
      if (Math.hypot(e.clientX - rd.x0, e.clientY - rd.y0) < 6) return;
      rd.started = true; rd.card.classList.add('lifting'); document.body.classList.add('dragging');
    }
    clear();
    rd.to = null;
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('.refc[data-i]');
    if (!t || t === rd.card) return;
    const r = t.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    t.classList.add(after ? 'ins-after' : 'ins-before');
    rd.to = +t.dataset.i + (after ? 1 : 0);
  });
  board.addEventListener('pointerup', () => {
    if (!rd) return;
    const d = rd; rd = null;
    clear(); d.card.classList.remove('lifting'); document.body.classList.remove('dragging');
    if (!d.started || d.to === null || d.to === undefined) return;
    const before = it.element.refs.map((x) => ({ ...x }));
    const list = before.slice();
    const [moved] = list.splice(d.i, 1);
    list.splice(d.to > d.i ? d.to - 1 : d.to, 0, moved);
    if (list.every((r, k) => r.file === before[k].file)) return;
    saveRefs(list, `référence déplacée en ${list.indexOf(moved) + 1}ᵉ place`, `déplacer la référence ${d.i + 1} en ${list.indexOf(moved) + 1}ᵉ place`);
  });
}


// ══ LA CORBEILLE ════════════════════════════════════════════
// Celle de chaque Workspace qu'on voit (GET /api/asset/trash?spaces=*) : ce que la personne peut
// rendre (le sien ; tout, pour un admin du Workspace). Rétablir le remet à sa place, dans son
// dossier. « Vider » est le seul geste qui efface : il le dit, et ne s'annule pas.
async function paintTrash() {
  parts = null;
  document.body.classList.remove('has-selbar', 'selecting');
  $('.selbar')?.remove();
  libEl.replaceChildren(el('p', { class: 'lbl' }, 'chargement'));
  let d;
  try { d = await api('asset/trash?spaces=*'); } catch (e) { libEl.replaceChildren(el('p', { class: 'warn' }, e.message)); return; }
  if (S.route.view !== 'trash') return;
  const grid = el('div', { class: 'lib-grid' });
  grid.style.setProperty('--card', `${S.size}px`);
  const restore = (t) => api(`library/${t.id}/restore`, { method: 'POST', espace: t.space });
  const card = (t) => {
    const im = el('div', { class: 'im' }, t.thumb_url ? el('img', { src: href(t.thumb_url), alt: '', loading: 'lazy' })
      : (glyph(t.kind) || (t.kind === 'audio' ? wave() : el('span', { class: 'noimg' }, 'sans image'))),
      kindMark(t));   // la marque de la sorte commune (commun/shell.js)
    const n = el('div', { class: 'acard trash-card', role: 'listitem', 'data-trash': t.id },
      el('div', { class: 'thumb' }, im, el('div', { class: 'cap' }, el('div', { class: 't' }, t.title || t.id),
        el('div', { class: 's' }, manySpaces() ? wsBadge(t.space) : null, `jeté ${fmtDate(t.trashed)}${t.folder ? ` · de « ${t.folder} »` : ''}`)),
      el('div', { class: 'acts2' }, el('button', { class: 'tb ghost sm', type: 'button', onclick: async () => {
        try {
          await U.run({ label: `rétablir « ${t.title} »`, do: () => restore(t),
            undo: () => api(`library/${t.id}/delete`, { method: 'POST', espace: t.space }) });
          say(`« ${t.title} » rétabli${t.folder ? ` dans « ${t.folder} »` : ''} · ${spaceShort(t.space)}`, true);
          loadTree();
          n.remove();
          if (!$('.trash-card', grid)) paintTrash();
        } catch (e) { say(e.message); }
      } }, 'Rétablir'))));
    return n;
  };
  grid.replaceChildren(...(d.items.length ? d.items.map(card)
    : [el('div', { class: 'empty-state', style: { gridColumn: '1 / -1' } }, el('b', {}, 'La corbeille est vide'), el('p', { class: 'hint' }, 'Ce qu\'on met à la corbeille attend ici, avec son fichier, sa recette et son dossier.'))]));
  const all = d.items;
  const restoreAll = el('button', { class: 'tb ghost', type: 'button', disabled: !all.length, title: all.length ? 'chacun revient à sa place, dans son dossier' : 'la corbeille est vide',
    onclick: async () => {
      try {
        await U.run({ label: `rétablir ${plural(all.length, 'objet', 'objets')}`,
          do: () => perSpace(all, (sp, list) => api('asset/restore', { method: 'POST', body: { ids: list.map((t) => t.id) }, espace: sp }),
            (x) => api('asset/trash', { method: 'POST', body: { ids: x.list.map((t) => t.id) }, espace: x.sp })),
          undo: async (done) => { for (const x of done) await api('asset/trash', { method: 'POST', body: { ids: x.list.map((t) => t.id) }, espace: x.sp }); } });
        say(`${plural(all.length, 'objet rétabli', 'objets rétablis')}`, true);
        refresh();
      } catch (e) { say(e.message); }
    } }, 'Tout rétablir');
  const empty = el('button', { class: 'tb ghost danger', type: 'button', disabled: !all.length, title: all.length ? 'effacer pour de bon : le seul geste qui ne s’annule pas' : 'la corbeille est vide : rien à effacer',
    onclick: () => emptyTrashAsk(all) }, 'Vider la corbeille…');
  libEl.replaceChildren(
    el('section', { class: 'lib-top' }, el('div', { class: 'who-col' },
      el('nav', { class: 'crumbs', 'aria-label': 'où' }, el('a', { class: 'crumb', href: '#' }, 'Asset'), el('span', { class: 'lbl' }, '/'), el('span', { class: 'crumb cur' }, 'Corbeille')),
      el('div', { class: 'who' }, el('h1', { class: 'lib-h' }, 'Corbeille'),
        el('span', { class: 'lbl' }, all.length ? `${plural(all.length, 'objet', 'objets')}${manySpaces() ? ` · ${plural(new Set(all.map((t) => t.space)).size, 'Workspace', 'Workspaces')}` : ''}` : 'vide'))),
    el('div', { class: 'acts' }, undoBox(), restoreAll, empty)),
    el('p', { class: 'hint' }, 'Un objet jeté garde tout — fichier, recette, dossier — et revient à sa place d\'un clic. Rien ne s\'efface, sauf par « Vider la corbeille » (l’auteur, ou un admin du Workspace).'),
    grid);
}
function emptyTrashAsk(all) {
  const groups = bySpace(all);
  const m = modal({
    title: 'vider la corbeille',
    body: [el('p', { class: 'new-q' }, `Effacer pour de bon ${plural(all.length, 'objet', 'objets')} ?`),
      el('p', { class: 'prose' }, 'Leurs fichiers, leurs recettes disparaissent du disque. ', el('b', {}, 'Ce geste ne s’annule pas'), ' (Ctrl+Z ne le reprend pas).'),
      el('p', { class: 'hint' }, groups.map(([sp, list]) => `${spaceLong(sp)} · ${list.length}`).join(' — ')),
      el('p', { class: 'hint' }, 'Une copie rapatriée dans un autre Workspace garde son fichier.')],
    foot: [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Garder'),
      el('button', { class: 'tb go', type: 'button', onclick: async () => {
        m.close();
        let gone = 0;
        try {
          for (const [sp, list] of groups) gone += (await api('asset/trash/empty', { method: 'POST', body: { ids: list.map((t) => t.id) }, espace: sp })).removed.length;
          say(`${plural(gone, 'objet effacé', 'objets effacés')} pour de bon`);
        } catch (e) { say(e.message); }
        refresh();
      } }, `Effacer ${plural(all.length, 'objet', 'objets')}`)],
  });
  setTimeout(() => $('.modal-foot .tb.ghost', m.scrim)?.focus(), 30);   // le bouton sûr d'abord
}

// ── clavier, travaux finis ───────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (drag?.started) { endDrag(true); return; }
  if (mq) { endMarquee(true); return; }
  if ($('.scrim') || menuFor) return;
  if (document.body.classList.contains('side-open')) { document.body.classList.remove('side-open'); return; }
  if (S.route.view === 'lib' && S.sel.size && !e.target.closest?.('input, textarea, select')) { clearSel(); live('plus rien de choisi'); return; }
  if (S.route.view === 'sheet' && !e.target.closest?.('input, textarea, select')) go(S.backHash || '#');
});
document.addEventListener('sr:job', () => { if (S.route.view === 'lib') refresh(); });
// l'arbre en tiroir (téléphone) : un lieu choisi le referme
sideEl.addEventListener('click', (e) => { if (e.target.closest('a.tr')) document.body.classList.remove('side-open'); });
$('#side-scrim')?.addEventListener('click', () => document.body.classList.remove('side-open'));

// ── le clic droit (Cal, 29/09 : « un menu contextuel dédié à où on se trouve ») ──
// Une carte : ses gestes (ceux de la barre de sélection si elle fait partie
// d'une sélection) ; un dossier : le sien ; la corbeille : rétablir ; une ligne
// de l'arbre : la sienne. Ailleurs : les entrées de la page, en tête du menu
// commun de repli (commun/menu.js : pageMenu).
const toItems = (spec) => [{ head: spec.title }, ...spec.items.map((x) => (x === '-' ? '-'
  : { label: x.label, icon: x.dir ? '▭' : '', disabled: x.disabled, why: x.why, onclick: x.do }))];
const goTo = (u) => () => { location.href = href(u); };
function kindItems(it) {
  const id = encodeURIComponent(it.id);
  if (it.kind === 'image') {
    return [{ label: 'Animer', icon: '▶', sub: 'Vidéo', onclick: goTo(`movie/?start=${id}`) },
      { label: 'Éditer dans Image', icon: '✎', onclick: goTo(`image/?edit=${id}`) },
      { label: 'Référence vidéo', icon: '◎', onclick: goTo(`movie/?ref=${id}`) },
      { label: 'Agrandir', icon: '⤢', sub: 'Upscale', onclick: goTo(`upscale/?src=${id}`) },
      { label: 'Ajouter au montage', icon: '▤', studio: true, onclick: goTo(`montage/?add=${id}`) },
      { label: 'Faire une planche de références', icon: '▦', onclick: () => elementModal({ items: [it], title: it.title, folder: it.folder || '', space: it.space }) },
      ...versionItems(it)];
  }
  if (it.kind === 'video') return [{ label: 'Agrandir', icon: '⤢', sub: 'Upscale', onclick: goTo(`upscale/?src=${id}`) }, { label: 'Ajouter au montage', icon: '▤', studio: true, onclick: goTo(`montage/?add=${id}`) }, ...versionItems(it)];
  if (it.kind === 'audio') return [{ label: 'Ajouter au montage', icon: '▤', studio: true, onclick: goTo(`montage/?add=${id}`) }, ...versionItems(it)];
  if (isLiving(it)) {
    const src = it.element.source || {};
    return [{ label: `Publier la v${(it.element.count || 0) + 1}…`, icon: '◆', onclick: async () => publishFrom(await api('elements/' + it.id)) },
      src.open ? { label: 'Ouvrir la source', icon: '↗', onclick: goTo(src.open) } : null];
  }
  if (it.kind === 'element') {
    return [{ label: 'Référence vidéo', icon: '◎', onclick: goTo(`movie/?ref=${id}`) },
      it.element?.type === 'object' ? { label: 'Ouvrir dans Object Creator', icon: '◇', studio: true, onclick: goTo(`objet/#${id}`) } : null, ...versionItems(it)];
  }
  if (it.kind === 'sequence') return [{ label: 'Ouvrir dans le Montage', icon: '▤', studio: true, onclick: goTo(`montage/#${id}`) }];
  if (it.kind === 'midi') return [{ label: 'Ouvrir ODIO', icon: '↗', sub: 'nouvel onglet', studio: true, onclick: () => window.open(href('musique/'), '_blank', 'noopener') }, ...versionItems(it)];
  if (it.kind === 'document' && docInline(it)) return [{ label: 'Ouvrir', icon: '↗', sub: 'nouvel onglet', onclick: () => window.open(href(it.url), '_blank', 'noopener') }];
  return [];
}
// le menu d'un objet ordinaire : il devient la v1 d'un élément, ou la version suivante d'un des siens
function versionItems(it) {
  if (it.version?.of) return [{ label: `v${it.version.n} de « ${it.version.of_title || '…'} »`, icon: '◆', disabled: !it.version.of_present, why: 'son élément est à la corbeille', onclick: () => go('#' + it.version.of) }];
  return [{ label: 'Faire un élément (v1)', icon: '◆', onclick: () => makeElementFrom(it) },
    { label: 'Publier comme version de…', icon: '◆', onclick: () => publishInto(it) }];
}
function cardMenu(it) {
  const spec = itemMenu(it);
  const move = spec.items.filter((x) => x !== '-' && (x.dir || /^Sortir/.test(x.label || '')));
  const copies = spec.items.filter((x) => x !== '-' && /^Copier dans/.test(x.label || ''));
  // les outils ne prennent que le Workspace de l'onglet : d'ailleurs, on rapatrie d'abord
  const tools = isForeign(it)
    ? [{ label: `Rapatrier dans « ${spaceShort(here())} »`, icon: '↓', sub: 'une copie neuve', disabled: !!importWhy(it), why: importWhy(it), onclick: () => copyTo([it], here()) },
      { label: 'Y aller', icon: '↗', sub: spaceShort(it.space), onclick: () => { location.href = otherTab(it.space, '#' + it.id); } }]
    : kindItems(it);
  return [{ head: `${spaceShort(it.space)} · ${it.kind === 'element' ? typeFr(it.element?.type) : kindFr(it.kind)} · ${it.title || it.id}` },
    { label: 'Ouvrir la fiche', icon: '⤢', key: 'Entrée', onclick: () => go('#' + it.id) },
    ...tools, '-',
    { label: 'Ranger', icon: '▭', items: move.map((x) => ({ label: x.label, onclick: x.do })) },
    copies.length ? { label: 'Copier dans un Workspace', icon: '⇉', items: copies.map((x) => ({ label: x.label, disabled: x.disabled, why: x.why, onclick: x.do })) } : null,
    { label: 'Favori', checked: !!it.fav, key: 'F', onclick: () => bulkFav([it], !it.fav) },
    { label: 'Tags…', icon: '#', onclick: () => tagsModal([it]) },
    { label: 'Télécharger', icon: '↓', key: 'T', onclick: () => download([it]) },
    { label: 'Copier le lien de la fiche', icon: '↗', onclick: () => copy(isForeign(it) ? otherTab(it.space, '#' + it.id) : href('asset/#' + it.id), 'lien copié') },
    '-',
    { label: 'Mettre à la corbeille', icon: '×', danger: true, key: 'Suppr', onclick: () => trashMany([it]) }].filter(Boolean);
}
function selectionMenu(items) {
  const imgs = items.filter((i) => i.kind === 'image');
  const ups = items.filter((i) => i.kind === 'image' || i.kind === 'video');
  const allFav = items.every((i) => i.fav);
  const spaces = bySpace(items);
  const one = spaces.length === 1 ? spaces[0][0] : null;
  const mixWhy = one ? '' : `la sélection est dans ${spaces.length} Workspaces : un dossier, un élément sont dans un seul`;
  const fw = foreignWhy(items);
  const mv = moveMenu(items).items;
  return [{ head: `la sélection · ${countLine(items.reduce((c, i) => { c[i.kind] = (c[i.kind] || 0) + 1; return c; }, {}))}${spaces.length > 1 ? ` · ${spaces.length} Workspaces` : ''}` },
    { label: 'Télécharger', icon: '↓', key: 'T', sub: 'un zip', onclick: () => download(items) },
    { label: 'Créer un dossier', icon: '+', key: 'N', disabled: !!mixWhy, why: mixWhy, onclick: () => askFolderName(items, one) },
    { label: 'Déplacer', icon: '▭', items: mv.filter((x) => !/^Copier/.test(x.label)).map((x) => ({ label: x.label, onclick: x.do })) },
    { label: 'Copier dans un Workspace', icon: '⇉', items: mv.filter((x) => /^Copier/.test(x.label)).map((x) => ({ label: x.label, disabled: x.disabled, why: x.why, onclick: x.do })) },
    { label: allFav ? 'Retirer des favoris' : 'Mettre en favori', icon: '★', key: 'F', onclick: () => bulkFav(items, !allFav) },
    { label: 'Tags…', icon: '#', onclick: () => tagsModal(items) },
    { label: 'Faire un élément', icon: '◆', disabled: !imgs.length || !!mixWhy, why: mixWhy || 'aucune image dans la sélection : un élément se fait d’images',
      onclick: () => elementModal({ items: imgs, title: imgs[0]?.title || '', folder: commonFolder(imgs), space: one }) },
    { label: 'Agrandir', icon: '⤢', sub: 'Upscale', disabled: !ups.length || !!fw, why: fw || 'Upscale prend des images et des vidéos', onclick: goTo(`upscale/?src=${ups.map((i) => i.id).join(',')}`) },
    '-',
    { label: 'Ne plus rien choisir', key: 'Échap', onclick: clearSel },
    { label: 'Mettre à la corbeille', icon: '×', danger: true, key: 'Suppr', onclick: () => trashMany(items) }];
}
contextMenu(libEl, (e) => {
  if (drag || mq) return [];
  const card = e.target.closest('.acard[data-id]');
  if (card && S.route.view === 'lib') {
    const it = S.data?.items.find((x) => x.id === card.dataset.id);
    if (!it) return null;
    // clic droit sur une carte choisie parmi d'autres : la sélection ; sinon, elle seule (et elle devient la sélection)
    if (S.sel.has(it.id) && S.sel.size > 1) return selectionMenu(selItems());
    setSel([it.id], it.id);
    return cardMenu(it);
  }
  const f = e.target.closest('.acard.folder[data-folder]');
  if (f) {
    const spec = folderMenu((S.data?.folders || []).find((x) => x.name === f.dataset.folder && (x.space || '') === (f.dataset.space || ''))
      || { name: f.dataset.folder, space: f.dataset.space || here(), total: 0 });
    return toItems(spec);
  }
  const t = e.target.closest('.trash-card');
  if (t) { const b = $('.acts2 button', t); return b ? [{ label: 'Rétablir', icon: '↺', onclick: () => b.click() }] : null; }
  return null;
});
// une ligne de l'arbre : les gestes de son lieu
contextMenu(sideEl, (e) => {
  const r = e.target.closest('.tr');
  if (!r) return null;
  if (r.classList.contains('fo')) {
    const f = { name: r.dataset.folder, space: r.dataset.space, total: +($('.n', r)?.textContent || 0) };
    const spec = folderMenu(f);
    spec.items.splice(1, 1, { label: 'Renommer', do: () => renameFolderInline(f.name, f.space, r) });
    return toItems(spec);
  }
  if (r.classList.contains('ws')) {
    const sp = r.dataset.space;
    const why = createWhy(sp);
    return [{ head: `Workspace · ${spaceLong(sp)}` },
      { label: 'Ouvrir', icon: '⤢', onclick: () => go(placeHash({ k: 'space', space: sp })) },
      { label: 'Nouveau dossier', icon: '+', disabled: !!why, why, onclick: () => { closed.delete('s:' + sp); newFolderIn = sp; paintTree(); } },
      sp !== here() ? { label: 'Passer l’onglet dans ce Workspace', icon: '↗', sub: 'les outils y lisent', onclick: () => { location.href = otherTab(sp, location.hash); } } : null].filter(Boolean);
  }
  if (r.dataset.drop === 'trash') return [{ head: 'la corbeille' }, { label: 'Ouvrir', icon: '⤢', onclick: () => go('#/corbeille') }];
  return null;
});
// ailleurs : les gestes de la vue, en tête du menu de repli
pageMenu(() => {
  if (S.route.view === 'sheet' && S.item && isForeign(S.item)) {
    const it = S.item;
    const why = importWhy(it);
    return [{ head: `la fiche · ${spaceShort(it.space)} · ${it.title || it.id}` }, { label: 'Revenir', icon: '‹', key: 'Échap', onclick: () => go(S.backHash || '#') },
      { label: `Rapatrier dans « ${spaceShort(here())} »`, icon: '↓', disabled: !!why, why, onclick: async () => { const r = await rapatrier([it]); if (r?.[0]) go('#' + r[0].id); } },
      { label: 'Y aller', icon: '↗', sub: spaceShort(it.space), onclick: () => { location.href = otherTab(it.space, '#' + it.id); } },
      { label: 'Télécharger', icon: '↓', onclick: () => download([it]) }];
  }
  if (S.route.view === 'sheet' && S.item) {
    const it = S.item;
    return [{ head: `la fiche · ${it.title || it.id}` }, { label: 'Revenir', icon: '‹', key: 'Échap', onclick: () => go(S.backHash || '#') },
      ...kindItems(it), '-',
      { label: 'Favori', checked: !!it.fav, onclick: () => setFav(it, !it.fav) },
      { label: 'Télécharger', icon: '↓', onclick: () => download([it]) },
      { label: 'Mettre à la corbeille', icon: '×', danger: true, onclick: () => trashItem(it, { leave: true }) }];
  }
  if (S.route.view === 'trash') return [{ head: 'la corbeille' }, { label: 'Revenir à Asset', icon: '‹', onclick: () => go('#') }];
  if (!parts) return null;
  const sp = target();
  const why = createWhy(sp);
  return [{ head: `${placeTitle()} · ${spaceShort(sp)}` },
    { label: S.folder ? 'Déposer des fichiers ici…' : 'Déposer des fichiers…', icon: '↑', disabled: !!why, why, onclick: () => parts.fileIn.click() },
    { label: 'Nouveau dossier…', icon: '+', disabled: !!why, why, onclick: () => { closed.delete('s:' + sp); newFolderIn = sp; paintTree(); } },
    { label: 'Nouvel élément…', icon: '◆', disabled: !!why, why, onclick: () => elementModal({ space: sp }) },
    { label: 'Importer de Character Factory…', icon: '↗', disabled: !!why, why, onclick: cfModal },
    S.place.k === 'folder' ? { label: 'Renommer le dossier', icon: '✎', onclick: () => renameFolderInline(S.place.name, S.place.space, $('.lib-h', libEl)) } : null,
    '-',
    { label: 'Tout choisir', key: 'Ctrl+A', disabled: !cardIds().length, why: 'rien à choisir ici', onclick: selectAll },
    S.sel.size ? { label: 'Ne plus rien choisir', key: 'Échap', onclick: clearSel } : null,
    { label: 'Montrer', icon: '▦', items: KINDS.map(([k, lab]) => ({ label: lab, checked: S.kind === k, onclick: () => { S.kind = k; savePrefs(); loadLib(); } })) },
    { label: 'Trier', icon: '↕', items: SORTS.map(([k, lab]) => ({ label: lab, checked: S.sort === k, onclick: () => { S.sort = k; savePrefs(); loadLib(); } })) },
    { label: S.view === 'grid' ? 'Voir en liste' : 'Voir en grille', icon: '☰', onclick: () => { S.view = S.view === 'grid' ? 'list' : 'grid'; savePrefs(); paintGrid(); paintBar(); } },
    { label: 'La corbeille', icon: '×', onclick: () => go('#/corbeille') }].filter(Boolean);
});

render();
