// SHOWRUNNER TOOLS — le panneau Asset commun (docs/etudes/panneau_asset.md).
//
// La bibliothèque à gauche de chaque outil, sous la barre du haut. Cal, 30/09 :
// « la page Asset devient un panel accordéon à gauche … comme dans le canva
// Idéation où la bibliothèque est à gauche … qui resize le reste ; Control+Espace
// pour l'afficher et le cacher ». UN composant, monté par `mountHeader`
// (commun/shell.js) dans chaque outil.
//
// Un VISUALISEUR (Cal, 30/09 : « c'est JUSTE un visualiseur avec des filtres et
// des outils de tri pour retrouver un asset ; toutes les fonctions de gestion et
// d'organisation sont dans la page Asset dédiée ») : chercher, filtrer, trier, lire
// les favoris, poser (double-clic, menu, glisser). Rien ne s'y range, ne s'y jette,
// ne s'y renomme ni ne s'y dépose : « Gérer dans Asset ↗ » mène à la page.
//
// LA LANGUETTE (Cal, 30/09) : sur le bord où vit le panneau (le bord gauche fermé,
// le bord du panneau ouvert), quand la souris s'en approche, une étiquette verte
// glisse, ASSET écrit à la verticale ; c'est la poignée : clic = ouvrir ou fermer,
// glisser = la largeur. Elle se range quand la souris s'éloigne ; rien ne glisse au
// chargement (elle n'apparaît qu'à un vrai mouvement de la souris). Sans survol
// (un écran tactile), elle reste sortie, immobile.
//
//   - il POUSSE la page (html.sr-dock-on, commun/shell.css) ; la mise en page des
//     outils répond à la place qu'elle a vraiment (@container sr-page) ; sous
//     860 px de page, il passe par-dessus avec un voile ;
//   - la géométrie de la bibliothèque d'Idéation : poignée dans l'intervalle,
//     glisser = largeur, double-clic = largeur par défaut, flèches 16 px (Maj 64),
//     Entrée = replier ; fermé → un trait court au bord et sa languette ; la
//     largeur retenue par outil et par personne (Préférences, Général : cachées) ;
//   - FERMÉ à l'arrivée sur toute page, sans rien qui glisse (Cal, 30/09 : « changer
//     de page = faire autre chose ») : ouvert ne se garde pas ; seuls les gestes de
//     la personne l'ouvrent et le ferment, et seuls eux l'animent (anime()) ;
//   - en tête : la recherche et le TRI (récents, anciens, nom, modifiés ; retenu
//     pour la personne), les SORTES en pastilles (quoi), puis cinq SECTIONS
//     en accordéon (d'où) — Ce workspace, Récents, Favoris, Autres workspaces,
//     Character Factory (Studio) —, une seule ouverte, qui prend la hauteur ;
//   - les filtres à l'ouverture viennent de l'outil : les `kinds` des zones qui
//     prennent un asset (dropZone / declareZone), ou ceux de la zone active
//     (`dock.contexte`) ; la personne élargit d'un clic, « remettre les filtres » les remet ;
//   - une grille fenêtrée (seules les lignes visibles existent), par pages de 120
//     (GET /api/asset/dock, server/tools/asset.py) ;
//   - clic = choisir (Ctrl : ajouter, Maj : une plage), double-clic ou Entrée =
//     poser (l'action de l'outil) ; `clickPlaces` : un clic pose (Idéation, comme
//     avant — décision de Cal du 30/09) ; glisser = poser là où l'on lâche
//     (ITEM_MIME, plusieurs : MULTI_MIME) ; clic droit = notre menu ; bouton du
//     milieu = faire défiler (la règle de Cal).
//
// Ce qu'un outil lui dit (la façade `dock` de commun/shell.js ; un appel fait
// avant que le panneau ne soit chargé attend) :
//
//   dock.configure({
//     place(items, { how }) → false si rien n'a été posé   poser (double-clic, Entrée, menu ; un clic si clickPlaces) ;
//                               un élément versionné arrive en sa dernière version quand l'outil ne prend
//                               pas d'élément mais sa sorte (comme dropZone) ; sinon, l'élément lui-même
//     clickPlaces: bool         un clic pose au lieu de choisir (Idéation)
//     placeLabel: 'Poser …'     l'entrée du menu
//     menu(it, choisis) → [entrées de commun/menu.js]      les entrées propres à l'outil
//     kinds: ['image', …]       le filtre de l'outil (sinon : l'union des zones inscrites)
//     label: 'la planche'       le nom de ce filtre (« filtres de : la planche »)
//     dockMin: px | () => px    la place que la page garde toujours (720 par défaut)
//     (upload : ignoré depuis le 30/09 — le panneau ne prend plus de fichier ; les zones de l'outil, si)
//     fiche(it)                 « Fiche dans Asset » (sinon : asset/#<id> dans un autre onglet)
//     hint: '…'                 la ligne d'aide du bas
//   })
//   dock.contexte({ kinds, label, why }) · dock.contexte(null)    la zone active a changé
//   declareZone(node, { kinds, label })        une zone qui a son propre écouteur de dépôt
//   dock.open({ focus }) · close() · toggle() · isOpen() · closed() · reload() · recent(items)
//   l'événement `sr:dock` (document) : { open, w } à chaque changement
//
// Les Workspaces (docs/etudes/equipes_espaces.md, étape 5) : « Ce workspace » liste
// celui de l'onglet ; « Autres workspaces » ceux que la personne voit ailleurs
// (GET /api/asset/espaces), un à la fois (une pastille par Workspace ;
// GET /api/asset/dock?space=<id>). Chaque objet dit le sien (`space`). En poser un
// d'ailleurs dans l'outil passe par `rapatrier` (commun/shell.js : une copie neuve
// dans le Workspace de l'onglet, POST /api/espaces/<courant>/rapatrier ; l'original
// ne bouge jamais) : l'outil reçoit la copie ; un refus (viewer, élément versionné,
// séquence) dit pourquoi. Le glisser porte en plus le type vide
// `application/x-sr-space-<espace>` (panneau_asset.md § 5) ; la zone qui reçoit
// (dropZone) rapatrie de même.

import {
  api, el, href, toast, kindFr, etypeFr, fmtDur, session, kindMark, ITEM_MIME, MULTI_MIME, CF_MIME,
  dockState, dockKeyLabel, sorteEffective, TOOLS, espace, rapatrier, SPACE_MIME,
} from './shell.js';
import { pickView } from './proxies.js';
import { prefs } from './prefs.js';
import { menu } from './menu.js';

const D = dockState();
const W = { min: 210, max: 640, def: 250 };
const OVER = 860;          // sous cette largeur de page, pousser ne laisse plus rien : par-dessus
const KEEP = 720;          // la place que la page garde par défaut
const TILE = 90;           // une case : 90 px au moins (deux colonnes dès 210 px, une de plus tous les ~96 px)
const GAP = 6;
const CAP = 32;            // la légende d'une case (titre, une ligne)
const PAGE = 120;
const RECENT_MAX = 60;
const KINDS = ['image', 'video', 'audio', 'midi', 'sequence', 'document', 'element'];   // document : 05/10 (server/tools/documents.py)
const MEDIA = KINDS.filter((k) => k !== 'element');
const ETYPES = ['character', 'object', 'place', 'style', 'other'];
const KIND_PL = { image: 'images', video: 'vidéos', audio: 'sons', midi: 'MIDI', sequence: 'séquences', document: 'documents', element: 'éléments' };
const ETYPE_PL = { character: 'personnages', object: 'objets 3D', place: 'lieux', style: 'styles', other: 'autres' };
const SECS = [['here', 'Ce workspace'], ['recent', 'Récents'], ['fav', 'Favoris'], ['other', 'Autres workspaces'], ['cf', 'Character Factory']];
// le tri : ceux de la bibliothèque (server/core/library.py, query : new, old, title, updated)
const SORTS = [['new', 'Les plus récents', 'récents'], ['old', 'Les plus anciens', 'anciens'], ['title', 'Par nom', 'nom'], ['updated', 'Modifiés récemment', 'modifiés']];
const TAB_NEAR = 24;       // la languette sort quand la souris est à moins de 24 px du bord
const WHY_OTHER ='aucun autre Workspace où tu as un rôle : une Team t’en ouvre (Admin, Teams) ; '
  + 'poser un asset de l’un d’eux en fait une copie dans ce Workspace (l’original ne bouge jamais)';

// ── les Workspaces que la personne voit (GET /api/asset/espaces) ──
// null : pas encore lus ; sinon { list: [{ id, name, team_name, here, import, import_why }], here }
let SPACES = null;
async function loadSpaces() {
  try { const r = await api('asset/espaces'); SPACES = { list: r.spaces || [], here: r.here || espace() }; } catch (e) { SPACES = { list: [], here: espace(), error: e.message }; }
  const others = workspaces();
  if (!others.some((s) => s.id === S.space)) S.space = others[0]?.id || null;
  paintSecs();
  if (S.sec === 'other') { S.lists.other = null; if (S.open && S.space) fetchPage(list('other'), 0); paintAll(); }
}
// ceux d'ailleurs (hors de l'onglet) ; [] : aucun, ou pas encore lus
const workspaces = () => (SPACES ? SPACES.list.filter((s) => !s.here && s.id !== (SPACES.here || espace())) : []);
const spaceName = (id) => { const s = SPACES?.list.find((x) => x.id === id); return s ? `${s.team_name ? s.team_name + ' / ' : ''}${s.name}` : id; };
// ce Workspace-ci prend-il une copie ? (la matrice : `import` du courant) — sinon pourquoi
function importWhy() {
  const h = SPACES?.list.find((s) => s.here || s.id === espace());
  return h && !h.import ? (h.import_why || 'ce Workspace ne prend pas de copie d’ailleurs') : '';
}
const away = (it) => !!(it && !it._cf && it.space && espace() && it.space !== espace());

let T = null;              // l'outil
let N = {};                // les nœuds
const S = {
  open: false, want: W.def, sec: 'here', q: '', sort: 'new', folder: null, space: null,
  userKinds: null, etypes: [], types: false, studio: true, who: false,
  lists: {}, sel: new Map(), anchor: -1, focus: 0, lastFocus: null,
  dirty: true, geo: { w: 0, over: false, open: null }, dragging: false,
};
const nodes = new Map();   // index → nœud de case (la grille fenêtrée)
let seqN = 0;
let audio = null;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const P = (k) => `general.${k}_${T}`;
// ranger une préférence d'ici, sans que son écho (prefs.on) ne relise l'état au milieu d'un geste
let own = 0;
const setPref = (k, v) => { own++; try { prefs.set(k, v); } finally { own--; } };
const zoomOf = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1;
const pageW = () => document.documentElement.clientWidth / zoomOf();
const toolName = () => (TOOLS.find((x) => x.id === T)?.name || T || '').replace(/­/g, '');
const keyOf = (it) => (it._cf ? 'cf:' + it.slug : it.id);
const live = (t) => { if (N.live) N.live.textContent = t; };
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// ── la géométrie ────────────────────────────────────────────
function geometry() {
  const pw = pageW();
  const keep = Number(typeof D.cfg.dockMin === 'function' ? D.cfg.dockMin() : D.cfg.dockMin) || KEEP;
  const room = pw - keep;
  const over = pw < OVER || room < W.min;
  const w = Math.round(clamp(S.want, W.min, Math.max(W.min, Math.min(W.max, over ? pw - 40 : room))));
  return { w, over };
}
function applyLayout() {
  if (!N.aside) return;
  const root = document.documentElement;
  const g = geometry();
  root.style.setProperty('--sr-dock-w', g.w + 'px');
  root.classList.toggle('sr-dock-on', S.open && !g.over);
  root.classList.toggle('sr-dock-over', S.open && g.over);
  N.veil.hidden = !(S.open && g.over);
  N.aside.setAttribute('aria-hidden', String(!S.open));
  N.aside.inert = !S.open;
  const k = dockKeyLabel();
  N.grip.setAttribute('aria-valuenow', S.open ? g.w : 0);
  N.grip.title = S.open ? `Asset · clic : fermer · glisser : la largeur · double-clic : par défaut${k ? ' · ' + k : ''}`
    : `Asset, la bibliothèque · clic : l’ouvrir · glisser : l’ouvrir à la largeur voulue${k ? ' · ' + k : ''}`;
  const changed = g.w !== S.geo.w || g.over !== S.geo.over || S.open !== S.geo.open;
  S.geo = { ...g, open: S.open };
  if (changed) {
    document.dispatchEvent(new CustomEvent('sr:dock', { detail: { open: S.open, w: g.w, over: g.over } }));
    if (S.open) requestAnimationFrame(paintGrid);
  }
}
function setWant(w, keep = true) {
  S.want = clamp(Math.round(w), W.min, W.max);
  applyLayout();
  S.want = geometry().w;   // la largeur choisie, telle qu'elle a pu se montrer
  if (keep) setPref(P('dockW'), S.want === W.def ? null : S.want);
}
// Ouvrir, fermer : toujours un geste de la personne (le bouton, le raccourci, la poignée, ×, le voile),
// jamais le chargement — le panneau glisse alors (html.sr-dock-anim, le temps du glissement ; dock.css,
// shell.css), et seulement alors. `anim: false` : la poignée qu'on tire suit déjà la main.
let animT = 0;
function anime() {
  const root = document.documentElement;
  root.classList.add('sr-dock-anim');
  clearTimeout(animT);
  animT = setTimeout(() => root.classList.remove('sr-dock-anim'), 260);
}
function setOpen(on, { focus = false, anim = true } = {}) {
  if (!D.on || !N.aside) return;
  on = !!on;
  const change = on !== S.open;
  if (on && change) S.lastFocus = document.activeElement;
  const wasIn = N.aside.contains(document.activeElement);
  S.open = on;
  if (anim && change) anime();
  applyLayout();
  if (on) {
    if (S.dirty) reload();
    if (focus) requestAnimationFrame(() => N.q.focus({ preventScroll: true }));
  } else if (wasIn) {
    const back = S.lastFocus && document.contains(S.lastFocus) && !N.aside.contains(S.lastFocus) ? S.lastFocus : null;
    if (back) back.focus({ preventScroll: true }); else document.activeElement?.blur?.();
  }
}

// ── les filtres ─────────────────────────────────────────────
const visible = (n) => n.isConnected && (n.ownerDocument !== document || n.getClientRects().length > 0);
function zoneKinds() {
  const out = new Set();
  for (const z of D.zones) {
    // une zone refaite (une carte redessinée) : l'ancienne, qui a été dans la page et n'y est plus, s'en va
    if (z.node.isConnected) z.seen = true; else if (z.seen) { D.zones.delete(z); continue; }
    if (visible(z.node)) for (const k of z.kinds) if (KINDS.includes(k)) out.add(k);
  }
  return KINDS.filter((k) => out.has(k));
}
function context() {
  const own = (D.ctx?.kinds || []).filter((k) => KINDS.includes(k));
  if (D.ctx && own.length) return { kinds: own, label: D.ctx.label, why: '' };
  const zk = D.cfg.kinds?.length ? [] : zoneKinds();
  const base = D.cfg.kinds?.length ? D.cfg.kinds.filter((k) => KINDS.includes(k)) : zk.length ? zk : KINDS;
  const label = D.ctx ? D.ctx.label : (D.cfg.label || toolName());
  const why = D.ctx ? (D.ctx.why || `${D.ctx.label} ne prend pas d’asset`) : '';
  return { kinds: base, label, why };
}
const activeKinds = () => S.userKinds ?? context().kinds;
let lastActive = '';
function filtersMoved() {
  const k = activeKinds().join(',') + '|' + S.etypes.join(',');
  if (k === lastActive) return false;
  lastActive = k;
  return true;
}

// ── les listes (une par section) ────────────────────────────
function freshList(sec) { return { sec, seq: ++seqN, total: null, items: [], pages: new Set(), loading: new Set(), error: '', counts: null, etypes: null, all: null }; }
const cur = () => S.lists[S.sec] || (S.lists[S.sec] = freshList(S.sec));
// `keep` : une relecture qui ne vient pas de la personne (un rendu fini) garde la place et le choix
function reload(keep = false) {
  if (!N.aside) return;
  // rien ne se demande au portail avant de savoir qui entre (l'invité n'a pas le panneau)
  if (!S.open || !S.who) { S.dirty = true; return; }
  S.dirty = false;
  lastActive = activeKinds().join(',') + '|' + S.etypes.join(',');
  S.lists = {};
  clearGrid();
  if (!keep) { S.sel.clear(); S.anchor = -1; S.focus = 0; N.scroll.scrollTop = 0; }
  for (const sec of ['here', 'fav']) fetchPage(list(sec), 0);
  if (S.space) fetchPage(list('other'), 0);
  list('recent'); loadRecent(S.lists.recent);
  if (S.sec === 'cf' && S.studio) loadCf(list('cf'));
  paintAll();
}
const list = (sec) => S.lists[sec] || (S.lists[sec] = freshList(sec));

function queryFor(sec, offset) {
  const kinds = activeKinds();
  const p = new URLSearchParams({ kind: kinds.join(','), q: S.q, sort: S.sort, limit: String(PAGE), offset: String(offset) });
  const media = kinds.filter((k) => MEDIA.includes(k));
  if (media.length) p.set('media', media.join(','));
  if (S.etypes.length && kinds.includes('element')) p.set('etype', S.etypes.join(','));
  if (sec === 'fav') p.set('fav', '1');
  if (sec === 'here' && S.folder !== null) p.set('folder', S.folder);
  if (sec === 'other') p.set('space', S.space || '');
  return 'asset/dock?' + p;
}
async function fetchPage(L, pg) {
  if (L.pages.has(pg) || L.loading.has(pg)) return;
  if (!activeKinds().length || (L.sec === 'other' && !S.space)) { L.total = 0; L.pages.add(pg); return; }
  L.loading.add(pg);
  try {
    const r = await api(queryFor(L.sec, pg * PAGE));
    if (S.lists[L.sec] !== L) return;
    L.total = r.total; L.counts = r.counts; L.etypes = r.etypes;
    if (L.sec === 'here') S.folders = r.folders || [];
    r.items.forEach((it, i) => { L.items[pg * PAGE + i] = it; });
    L.pages.add(pg); L.error = '';
  } catch (e) {
    if (S.lists[L.sec] !== L) return;
    L.error = e.message; if (L.total === null) L.total = 0;
  } finally { L.loading.delete(pg); }
  paintHeads();
  if (L.sec === S.sec) { paintKinds(); paintFolders(); paintGrid(); }
}
// les récents : des ids rangés dans les préférences (les miens, de tous les outils), relus d'un coup
const recentIds = () => String(prefs.get('general.dockRecent', '') || '').split(/\s+/).filter(Boolean);
function matches(it) {
  const kinds = activeKinds();
  const q = S.q.trim().toLowerCase();
  const kindOk = it.kind === 'element'
    ? (kinds.includes('element') && (!S.etypes.length || S.etypes.includes(it.element?.type))) || (MEDIA.includes(sorteEffective(it)) && kinds.includes(sorteEffective(it)))
    : kinds.includes(it.kind);
  return kindOk && (!q || [it.title, it.prompt, ...(it.tags || [])].join(' ').toLowerCase().includes(q));
}
async function loadRecent(L) {
  const ids = recentIds();
  try {
    L.all = ids.length ? (await api('library/batch', { method: 'POST', body: { ids } })).items : [];
  } catch (e) { L.error = e.message; L.all = []; }
  if (S.lists.recent !== L) return;
  refilterLocal(L);
}
// les listes lues d'un coup (Récents, Character Factory) : triées ici, comme le portail trie les autres ;
// « récents » garde leur ordre (le dernier posé d'abord, pour les Récents)
const sortKey = { old: (it) => it.created || '', title: (it) => String(it.title || it.name || '').toLowerCase(), updated: (it) => it.updated || it.created || '' };
function sortLocal(list) {
  const k = sortKey[S.sort];
  if (!k) return list;
  const out = [...list].sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0));
  return S.sort === 'updated' ? out.reverse() : out;
}
function refilterLocal(L) {
  L.items = sortLocal((L.all || []).filter(L.sec === 'cf' ? cfMatches : matches));
  L.total = L.items.length;
  L.pages = new Set([0]);
  paintHeads();
  if (L.sec === S.sec) { paintKinds(); paintGrid(); }
}
// Character Factory : les personnages au visage verrouillé ; posé, un personnage devient un élément
const cfMatches = (c) => {
  const kinds = activeKinds();
  return kinds.includes('element') && (!S.etypes.length || S.etypes.includes('character'))
    && (!S.q.trim() || c.name.toLowerCase().includes(S.q.trim().toLowerCase()));
};
async function loadCf(L) {
  try {
    const { characters } = await api('cf/characters');
    L.all = characters.filter((c) => c.locked).map((c) => ({ ...c, _cf: true, kind: 'element', title: c.name, element: { type: 'character' } }));
  } catch (e) { L.error = `Character Factory : ${e.message}`; L.all = []; }
  if (S.lists.cf !== L) return;
  refilterLocal(L);
}
async function cfItem(ch) {
  if (ch.imported?.[0]) {
    try { return await api('library/' + ch.imported[0]); } catch { /* retiré : on réimporte */ }
  }
  toast('import depuis Character Factory…', 20000);
  const it = await api('cf/import', { method: 'POST', body: { slug: ch.slug } });
  toast(`${it.title} est maintenant un élément de la bibliothèque`);
  ch.imported = [it.id, ...(ch.imported || [])];
  S.dirty = true;
  return it;
}

// ── poser, choisir, glisser ─────────────────────────────────
function targetsFor(it) {
  const k = keyOf(it);
  return S.sel.has(k) && S.sel.size > 1 ? [...S.sel.values()] : [it];
}
// Un élément versionné là où l'outil ne prend pas d'élément, mais la sorte de sa dernière version
// (une chanson d'ODIO pour Transcrire, une image versionnée pour Upscale) : l'outil reçoit cette
// dernière version, comme au dépôt (dropZone, commun/shell.js). Là où l'outil prend les éléments
// (Idéation, Image, le Montage), il reçoit l'élément, et choisit lui-même sa version.
async function versionAPoser(it) {
  const kinds = context().kinds;
  if (it.kind !== 'element' || kinds.includes('element') || !kinds.includes(sorteEffective(it)) || !it.element?.head_item) return it;
  return api('library/' + it.element.head_item + '?spaces=*');   // la dernière version, où qu'elle soit
}
async function place(items, how = 'place') {
  if (!items.length) return;
  if (typeof D.cfg.place !== 'function') {
    toast(`pour la poser : glisse la vignette sur une zone de ${toolName()} qui la prend`);
    return;
  }
  if (items.some(away) && importWhy()) { toast(importWhy(), 7000); return; }
  let out = [];
  for (const it of items) {
    try { out.push(it._cf ? await cfItem(it) : await versionAPoser(it)); } catch (e) { toast(`${it._cf ? 'Character Factory' : it.title || it.id} : ${e.message}`, 7000); }
  }
  if (!out.length) return;
  // d'un autre Workspace : la copie d'ici d'abord (commun/shell.js, rapatrier) ; un refus dit pourquoi
  try { out = await rapatrier(out); } catch (e) { toast(e.message, 7000); return; }
  const r = await D.cfg.place(out, { how });
  if (r === false) return;
  live(out.length > 1 ? `${out.length} posés` : `posé : ${out[0].title || out[0].id}`);
  recent(out);
  if (S.geo.over) setOpen(false);
  if (items.some((it) => it._cf || away(it))) reload(true);   // l'élément importé, la copie : dans « Ce workspace »
}
function recent(items) {
  const ids = items.map((it) => it?.id).filter(Boolean);
  if (!ids.length) return;
  let next = [...new Set([...ids, ...recentIds()])].slice(0, RECENT_MAX);
  while (next.join(' ').length > 1600) next = next.slice(0, -1);
  prefs.set('general.dockRecent', next.join(' '));
  if (S.lists.recent) { S.lists.recent = freshList('recent'); if (S.open) loadRecent(S.lists.recent); }
}
function fiche(it) {
  if (typeof D.cfg.fiche === 'function') { D.cfg.fiche(it); return; }
  window.open(href(`asset/#${it.id}`), '_blank', 'noopener');
}
function listen(it) {
  if (audio && audio._id === it.id && !audio.paused) { audio.pause(); return; }
  audio?.pause();
  audio = new Audio(href(it.url));
  audio._id = it.id;
  audio.play().catch((e) => toast(e.message));
}
function paintSel() {
  if (!N.aside) return;
  for (const [i, n] of nodes) {
    const it = cur().items[i];
    const on = !!it && S.sel.has(keyOf(it));
    n.classList.toggle('sel', on);
    n.setAttribute('aria-selected', String(on));
  }
  const k = S.sel.size;
  N.selbar.hidden = !k;
  N.selN.textContent = k ? `${k} choisi${k > 1 ? 's' : ''}` : '';
  N.selGo.textContent = D.cfg.placeLabel ? D.cfg.placeLabel.split(' ')[0] : 'Poser';
}
function choose(i, it, e) {
  if (e.ctrlKey || e.metaKey) {
    if (S.sel.has(keyOf(it))) S.sel.delete(keyOf(it)); else S.sel.set(keyOf(it), it);
    S.anchor = i;
  } else if (e.shiftKey && S.anchor >= 0) {
    const [a, b] = [Math.min(S.anchor, i), Math.max(S.anchor, i)];
    for (let j = a; j <= b; j++) { const x = cur().items[j]; if (x) S.sel.set(keyOf(x), x); }
  } else {
    S.sel.clear(); S.sel.set(keyOf(it), it); S.anchor = i;
  }
  paintSel();
}

// ── la grille fenêtrée ──────────────────────────────────────
function metrics() {
  const w = Math.max(0, N.scroll.clientWidth - 2);
  const cols = Math.max(2, Math.floor((w + GAP) / (TILE + GAP)));
  const tw = Math.max(40, (w - GAP * (cols - 1)) / cols);
  return { cols, tw, rh: tw + CAP };
}
function clearGrid() { for (const n of nodes.values()) n.remove(); nodes.clear(); }
function viewUrl(it, px) {
  if (it._cf) return it.thumb ? href('api/' + String(it.thumb).replace(/^api\//, '')) : '';
  const u = (it.kind === 'image' || it.kind === 'video' || it.views?.length) ? pickView(it, px).url : '';
  return u || (it.thumb_url ? href(it.thumb_url) : '');
}
function sub(it) {
  if (it._cf) return it.imported?.length ? 'déjà un élément' : `${it.costumes} tenue${it.costumes > 1 ? 's' : ''}`;
  if (it.kind === 'element') {
    const e = it.element || {};
    return e.count ? `${etypeFr(e.type)} · v${e.head || e.count}` : `${etypeFr(e.type)} · ${e.refs?.length || 0} réf.`;
  }
  if (it.duration) return fmtDur(it.duration);
  return it.width ? `${it.width}×${it.height}` : kindFr(it.kind);
}
function tile(it, i, tw) {
  const url = viewUrl(it, Math.round(tw));
  const im = el('span', { class: 'im' });
  if (url) im.append(el('img', { src: url, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }));
  else if (it.kind === 'audio' && it.id) im.append(el('i', { class: 'swave', 'aria-hidden': 'true', style: { '--wave': `url("${href(`api/son/apercu/${it.id}?v=1`)}")` } }));
  im.append(kindMark(it, { compact: tw < 70 }));
  if (it.kind === 'element' && it.element?.count) im.append(el('span', { class: 'ver' }, `v${it.element.head || it.element.count}`));
  const name = it.title || it.id;
  const n = el('div', { class: 'lt', role: 'option', tabindex: '-1', 'aria-selected': 'false', draggable: 'true', 'data-i': i,
    'data-id': it._cf ? null : it.id, title: `${name}${it.prompt ? '\n' + it.prompt.slice(0, 200) : ''}${it._cf ? '\nposé, il devient un élément de la bibliothèque' : ''}`
      + (away(it) ? `\ndans ${spaceName(it.space)} : posé ici, il en devient une copie` : ''),
    'aria-label': `${name}, ${it._cf ? 'personnage' : it.kind === 'element' ? etypeFr(it.element?.type) : kindFr(it.kind)}` },
  im, el('span', { class: 't' }, name), el('span', { class: 's' }, sub(it)));
  return n;
}
function placeholder(i) { return el('div', { class: 'lt ph', 'aria-hidden': 'true', 'data-i': i }, el('span', { class: 'im' })); }
// la gestion (ranger, grouper, jeter, renommer, déposer, aimer) : à la page Asset, jamais ici
const manage = (label = 'Gérer dans Asset ↗') => (T === 'asset' ? null
  : el('a', { class: 'tb ghost sm dk-manage', href: href('asset/'), title: 'la page Asset : ranger, grouper, jeter, renommer, déposer, les favoris, les Teams et Workspaces' }, label));
function emptyState(title, text, actions = []) {
  N.empty.replaceChildren(...[el('b', {}, title), text ? el('p', {}, text) : null, ...actions].filter(Boolean));
  N.empty.hidden = false;
}
function paintGrid() {
  if (!N.aside || !S.open) return;
  const L = cur();
  N.empty.hidden = true;
  if (S.sec === 'other' && !S.space) {
    clearGrid(); N.space.style.height = '0px';
    if (!SPACES) return emptyState('Les Workspaces', 'lecture…');
    if (SPACES.error) return emptyState('Les Workspaces ne répondent pas', SPACES.error, [el('button', { class: 'tb ghost sm', type: 'button', onclick: () => loadSpaces() }, 'Réessayer')]);
    return emptyState('Rien ici', WHY_OTHER);
  }
  if (S.sec === 'cf' && !S.studio) { clearGrid(); return emptyState('Réservé au Studio', 'Character Factory est un outil du Studio : le demander à Cal.'); }
  if (!activeKinds().length) {
    clearGrid(); N.space.style.height = '0px';
    return emptyState('Rien avec ces filtres', 'aucune sorte choisie', [el('button', { class: 'tb ghost sm', type: 'button', onclick: widen }, 'Élargir à toutes les sortes')]);
  }
  if (L.error && !L.items.length) {
    clearGrid(); N.space.style.height = '0px';
    return emptyState('La bibliothèque ne répond pas', L.error, [el('button', { class: 'tb ghost sm', type: 'button', onclick: () => reload() }, 'Réessayer')]);
  }
  const { cols, tw, rh } = metrics();
  const n = L.total === null ? cols * 3 : L.total;   // chargement : des cases vides, à la taille des vignettes
  if (L.total === 0) {
    clearGrid(); N.space.style.height = '0px';
    if (S.sec === 'recent') return emptyState('Rien de récent', 'ce que tu poses ou déposes vient ici, de tous les outils');
    if (S.sec === 'fav') return emptyState('Aucun favori', 'les favoris se marquent dans la page Asset (« Gérer dans Asset », en bas)');
    if (S.sec === 'cf') return emptyState('Aucun personnage', S.q ? 'rien ne répond' : 'aucun personnage au visage verrouillé dans Character Factory');
    if (S.sec === 'other' && !S.q.trim()) return emptyState('Rien ici', `rien dans ${spaceName(S.space)}${activeKinds().length < KINDS.length ? ' avec ces filtres' : ''}`,
      activeKinds().length < KINDS.length ? [el('button', { class: 'tb ghost sm', type: 'button', onclick: widen }, 'Élargir à toutes les sortes')] : []);
    if (S.q.trim()) return emptyState('Rien ne répond', `« ${S.q.trim()} » dans ${KINDS.length === activeKinds().length ? 'toutes les sortes' : activeKinds().map((k) => KIND_PL[k]).join(', ')}`,
      activeKinds().length < KINDS.length ? [el('button', { class: 'tb ghost sm', type: 'button', onclick: widen }, 'Élargir à toutes les sortes')] : []);
    const any = L.counts && Object.values(L.counts).some((x) => x > 0);
    if (any && (activeKinds().length < KINDS.length || S.etypes.length)) {
      return emptyState('Rien avec ces filtres', '', [el('button', { class: 'tb ghost sm', type: 'button', onclick: widen }, 'Élargir à toutes les sortes')]);
    }
    return emptyState('Rien ici', 'crée-le dans un outil, ou dépose un fichier sur l’outil ou dans la page Asset');
  }
  const rows = Math.ceil(n / cols);
  N.space.style.height = rows ? `${rows * (rh + GAP) - GAP}px` : '0px';
  const top = N.scroll.scrollTop, h = N.scroll.clientHeight || 400;
  const r0 = Math.max(0, Math.floor((top - h) / (rh + GAP)));
  const r1 = Math.min(rows - 1, Math.ceil((top + 2 * h) / (rh + GAP)));
  const keep = new Set();
  for (let r = r0; r <= r1; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= n) break;
      keep.add(i);
      const it = L.total === null ? null : L.items[i];
      if (!it && L.total !== null && L.sec !== 'recent' && L.sec !== 'cf') fetchPage(L, Math.floor(i / PAGE));
      const k = it ? keyOf(it) : 'ph';
      let node = nodes.get(i);
      if (!node || node._k !== k) {
        const fresh = it ? tile(it, i, tw) : placeholder(i);
        fresh._k = k;
        if (node) node.replaceWith(fresh); else N.space.append(fresh);
        node = fresh;
        nodes.set(i, node);
      }
      node.style.cssText = `left:${(c * (tw + GAP)).toFixed(1)}px;top:${r * (rh + GAP)}px;width:${tw.toFixed(1)}px;height:${rh}px`;
      node.firstChild.style.height = `${tw.toFixed(1)}px`;
      if (it) {
        const on = S.sel.has(k);
        node.classList.toggle('sel', on);
        node.setAttribute('aria-selected', String(on));
        node.tabIndex = i === S.focus ? 0 : -1;
      }
    }
  }
  for (const [i, node] of nodes) if (!keep.has(i)) { node.remove(); nodes.delete(i); }
  N.scroll.tabIndex = nodes.has(S.focus) ? -1 : 0;
}
function focusTile(i) {
  const L = cur();
  if (!L.total) return;
  i = clamp(i, 0, L.total - 1);
  S.focus = i;
  const { cols, rh } = metrics();
  const y = Math.floor(i / cols) * (rh + GAP);
  if (y < N.scroll.scrollTop) N.scroll.scrollTop = y;
  else if (y + rh > N.scroll.scrollTop + N.scroll.clientHeight) N.scroll.scrollTop = y + rh - N.scroll.clientHeight;
  paintGrid();
  nodes.get(i)?.focus({ preventScroll: true });
}
function widen() { S.userKinds = [...KINDS]; S.etypes = []; reload(); }

// ── l'en-tête : pastilles, contexte, dossiers, sections ─────
function kindCount(k) {
  const L = cur();
  if (L.sec === 'recent' || L.sec === 'cf') {
    return (L.all || []).filter((it) => (k === 'element' ? it.kind === 'element' : it.kind === k || sorteEffective(it) === k)).length;
  }
  return L.counts ? L.counts[k] ?? 0 : null;
}
function paintKinds() {
  if (!N.aside) return;
  const act = activeKinds();
  N.kinds.replaceChildren(...KINDS.map((k) => {
    const c = kindCount(k);
    return el('button', { class: `dk-k${act.includes(k) ? ' on' : ''}${c === 0 ? ' zero' : ''}`, type: 'button', 'data-k': k, 'aria-pressed': String(act.includes(k)),
      title: `${KIND_PL[k]}${c !== null ? ` · ${c}` : ''} — clic : ajouter ou retirer · Ctrl+clic : elle seule` },
    KIND_PL[k], c !== null ? el('i', {}, String(c)) : null);
  }));
  // les éléments ▸ leurs types (personnage, objet 3D, lieu, style) : dépliés à la demande
  const showE = act.includes('element') && (S.types || S.etypes.length > 0);
  if (act.includes('element')) {
    N.kinds.append(el('button', { class: `dk-k dk-more${S.etypes.length ? ' on' : ''}`, type: 'button', 'data-more': '1', 'aria-expanded': String(showE),
      title: 'les types d’élément : personnages, objets 3D, lieux, styles' }, 'types'));
  }
  N.etypes.hidden = !showE;
  if (showE) {
    const counts = cur().etypes || {};
    N.etypes.replaceChildren(...ETYPES.map((t) => el('button', { class: `dk-k${S.etypes.includes(t) ? ' on' : ''}${counts[t] === 0 || (cur().etypes && !counts[t]) ? ' zero' : ''}`,
      type: 'button', 'data-t': t, 'aria-pressed': String(S.etypes.includes(t)), title: `éléments : ${ETYPE_PL[t]} (aucun choisi : tous)` },
    ETYPE_PL[t], counts[t] ? el('i', {}, String(counts[t])) : null)));
  }
  const c = context();
  if (S.userKinds || S.etypes.length) {
    N.ctx.className = 'dk-ctx reset';
    N.ctx.disabled = false;
    N.ctx.textContent = `‹ remettre les filtres de : ${c.label}`;
    N.ctx.title = `revenir à ${c.kinds.map((k) => KIND_PL[k]).join(', ')}`;
  } else {
    N.ctx.className = 'dk-ctx';
    N.ctx.disabled = true;
    N.ctx.textContent = c.why ? `‹ ${c.label} : ${c.why}` : `‹ filtres de : ${c.label}`;
    N.ctx.title = c.why || `ce que ${c.label} prend : ${c.kinds.map((k) => KIND_PL[k]).join(', ')}`;
  }
  N.ctx.hidden = !c.label;
}
function paintFolders() {
  if (!N.aside) return;
  // « Autres workspaces » : une pastille par Workspace, un seul montré à la fois
  if (S.sec === 'other') {
    const ws = workspaces();
    N.folders.hidden = ws.length < 1;
    N.folders.replaceChildren(...ws.map((s) => el('button', { class: `dk-k${S.space === s.id ? ' on' : ''}`, type: 'button', 'data-w': s.id,
      'aria-pressed': String(S.space === s.id), title: `Team ${s.team_name || '—'} · Workspace ${s.name}` }, s.name)));
    return;
  }
  const on = S.sec === 'here' && S.folders?.length;
  N.folders.hidden = !on;
  if (!on) return;
  N.folders.replaceChildren(
    el('button', { class: `dk-k${S.folder === null ? ' on' : ''}`, type: 'button', 'data-f': '' }, 'tous'),
    ...S.folders.map((f) => el('button', { class: `dk-k${S.folder === f ? ' on' : ''}`, type: 'button', 'data-f': f, title: `le dossier ${f}` }, f)));
}
function paintHeads() {
  if (!N.aside) return;
  for (const [id] of SECS) {
    const h = N.heads[id];
    if (!h) continue;
    const L = S.lists[id];
    const c = id === 'other' && !workspaces().length ? '—' : L && L.total !== null ? String(L.total) : '';
    h.btn.querySelector('.c').textContent = c;
    h.btn.setAttribute('aria-expanded', String(S.sec === id));
    h.box.classList.toggle('open', S.sec === id);
  }
  N.count.textContent = S.lists.here?.total != null ? String(S.lists.here.total) : '';
}
function paintSecs() {
  if (!N.aside) return;
  N.heads.cf.box.hidden = !S.studio;
  if (S.sec === 'cf' && !S.studio) S.sec = 'here';
  // « Autres workspaces » : désactivée et dit pourquoi tant qu'il n'y en a pas (règle 7) ; ouverte, elle le redit
  const none = !workspaces().length;
  N.heads.other.btn.setAttribute('aria-disabled', none ? 'true' : 'false');
  N.heads.other.btn.title = none ? WHY_OTHER : 'les assets des autres Workspaces que tu vois ; posé ici, un asset en devient une copie';
  const h = N.heads[S.sec];
  h.box.append(N.body);
  N.body.setAttribute('aria-labelledby', h.btn.id);
  N.scroll.setAttribute('aria-label', SECS.find(([k]) => k === S.sec)[1]);
  paintHeads();
}
function paintAll() {
  paintSecs(); paintKinds(); paintFolders(); paintGrid(); paintSel();
  N.foot.textContent = D.cfg.hint || (D.cfg.clickPlaces ? 'glisser : là où l’on lâche · clic : poser'
    : 'clic : choisir · double-clic : poser · glisser : là où l’on lâche');
  N.go.hidden = T === 'asset';
  paintSort();
}
function paintSort() {
  const s = SORTS.find(([k]) => k === S.sort) || SORTS[0];
  N.sort.querySelector('.v').textContent = s[2];
  N.sort.title = `trier : ${s[1].toLowerCase()} — clic : changer`;
}
function setSort(k) {
  if (k === S.sort || !SORTS.some(([x]) => x === k)) return;
  S.sort = k;
  prefs.set('general.dockSort', k === 'new' ? null : k);
  paintSort();
  reload();
}
function sortMenu(kb = false) {
  const r = N.sort.getBoundingClientRect();
  menu(r.left, r.bottom + 4, [{ head: 'Trier' },
    ...SORTS.map(([k, label]) => ({ label, checked: S.sort === k, onclick: () => setSort(k) }))], { focusFirst: kb });
}
function openSection(id) {
  if (S.sec === id) return;
  S.sec = id;
  prefs.set('general.dockSec', id === 'here' ? null : id);
  S.sel.clear(); S.anchor = -1; S.focus = 0;
  clearGrid(); N.scroll.scrollTop = 0;
  if (id === 'cf' && S.studio && !S.lists.cf) loadCf(list('cf'));
  if (id === 'recent' && !S.lists.recent) loadRecent(list('recent'));
  if ((id === 'here' || id === 'fav' || (id === 'other' && S.space)) && !S.lists[id]) fetchPage(list(id), 0);
  paintAll();
}

// ── le montage ──────────────────────────────────────────────
// La feuille d'abord : un panneau posé avant elle se montrait nu, en travers de la page, puis
// glissait hors de vue à son arrivée (le « ouvert puis refermé » de Vidéo et de Character Factory,
// mesuré le 30/09 : 10 à 14 images visibles au chargement de chaque outil).
function cssReady() {
  let link = document.querySelector('link[data-sr-dock]');
  if (!link) {
    link = el('link', { rel: 'stylesheet', href: new URL('./dock.css', import.meta.url).href, 'data-sr-dock': '' });
    document.head.append(link);
  }
  if (link.sheet) return Promise.resolve();
  return new Promise((ok) => { link.addEventListener('load', ok, { once: true }); link.addEventListener('error', ok, { once: true }); });
}
function build() {
  N.count = el('span', { class: 'n' });
  N.q = el('input', { class: 'fld dk-q', type: 'search', placeholder: 'chercher', 'aria-label': 'chercher dans la bibliothèque', spellcheck: 'false' });
  N.sort = el('button', { class: 'dk-sort', type: 'button', 'aria-haspopup': 'menu' },
    el('i', { 'aria-hidden': 'true', html: '<svg viewBox="0 0 16 16"><path d="M5 3v10M2.5 10.5 5 13l2.5-2.5M11 13V3M8.5 5.5 11 3l2.5 2.5"/></svg>' }),
    el('span', { class: 'v' }, 'récents'));
  N.kinds = el('div', { class: 'dk-kinds', role: 'group', 'aria-label': 'les sortes' });
  N.etypes = el('div', { class: 'dk-etypes', role: 'group', 'aria-label': 'les types d’élément', hidden: true });
  N.ctx = el('button', { class: 'dk-ctx', type: 'button', hidden: true });
  N.folders = el('div', { class: 'dk-folders', role: 'group', 'aria-label': 'les dossiers', hidden: true });
  N.space = el('div', { class: 'dk-space' });
  N.empty = el('div', { class: 'dk-empty', hidden: true });
  N.scroll = el('div', { class: 'dk-scroll', role: 'listbox', 'aria-multiselectable': 'true', tabindex: '0' }, N.empty, N.space);
  N.selN = el('span', { class: 'n' });
  N.selGo = el('button', { class: 'tb ghost sm', type: 'button', onclick: () => place([...S.sel.values()]) }, 'Poser');
  N.selbar = el('div', { class: 'dk-selbar', hidden: true }, N.selN, N.selGo,
    el('button', { class: 'tb ghost sm', type: 'button', title: 'plus rien de choisi (Échap)', onclick: () => { S.sel.clear(); paintSel(); } }, '×'));
  N.body = el('div', { class: 'dk-sb', role: 'region', id: 'sr-dock-sb' }, N.folders, N.scroll, N.selbar);
  N.heads = {};
  const secs = el('div', { class: 'dk-secs' });
  for (const [id, label] of SECS) {
    const btn = el('button', { class: 'dk-sh', type: 'button', id: `sr-dock-h-${id}`, 'aria-controls': 'sr-dock-sb', 'aria-expanded': 'false',
      'aria-disabled': id === 'other' ? 'true' : null, title: id === 'other' ? WHY_OTHER : null, 'data-sec': id }, label, el('span', { class: 'c' }));
    const box = el('div', { class: 'dk-sec', 'data-sec': id }, el('h3', {}, btn));
    N.heads[id] = { btn, box };
    secs.append(box);
  }
  N.foot = el('p', { class: 'dk-f' });
  N.go = manage() || el('span', { hidden: true });
  N.live = el('div', { class: 'dk-live', 'aria-live': 'polite' });
  N.aside = el('aside', { class: 'sr-dock', id: 'sr-dock', 'aria-label': 'Asset, la bibliothèque' },
    el('div', { class: 'dk-h' }, el('span', { class: 't' }, 'Asset'), N.count, el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm dk-x', type: 'button', title: 'fermer le panneau (Échap)', 'aria-label': 'fermer le panneau', onclick: () => setOpen(false) }, '×')),
    el('div', { class: 'dk-qs' }, N.q, N.sort), N.kinds, N.etypes, N.ctx, secs,
    el('div', { class: 'dk-bas' }, N.go, N.foot), N.live);
  // la poignée, et sa languette : l'étiquette verte ASSET, à la verticale (dock.css)
  // (la fenêtre de la languette la cache tant qu'elle est rentrée : rien ne dépasse sur le panneau ouvert)
  N.tab = el('span', { class: 'sr-dock-tab' }, el('b', {}, 'Asset'));
  N.grip = el('div', { class: 'sr-dock-grip', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-controls': 'sr-dock',
    'aria-valuemin': W.min, 'aria-valuemax': W.max, 'aria-label': 'Asset : la poignée du panneau (Entrée : ouvrir ou fermer ; flèches : la largeur)' },
  el('span', { class: 'sr-dock-tabclip', 'aria-hidden': 'true' }, N.tab));
  N.veil = el('div', { class: 'sr-dock-veil', hidden: true, onclick: () => setOpen(false) });
  document.body.append(N.aside, N.grip, N.veil);
  wire();
}

function wire() {
  const { aside, grip, scroll, space } = N;
  // la recherche : 220 ms après la dernière frappe ; Échap la vide, puis rend la main à la page
  let qT = 0;
  N.q.addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => { S.q = N.q.value; reload(); }, 220); });
  N.q.addEventListener('keydown', (e) => {
    // Échap : vider la recherche ; vide, le panneau se ferme (plus bas)
    if (e.key === 'Escape' && N.q.value) { e.preventDefault(); e.stopPropagation(); N.q.value = ''; S.q = ''; reload(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); focusTile(S.focus); }
  });
  N.sort.addEventListener('click', (e) => sortMenu(e.detail === 0));
  // les pastilles : clic = ajouter / retirer, Ctrl+clic = elle seule ; l'élargissement tient jusqu'au prochain contexte
  N.kinds.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { S.types = !S.types; paintKinds(); return; }
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    const act = activeKinds();
    S.userKinds = e.ctrlKey || e.metaKey ? [k] : act.includes(k) ? act.filter((x) => x !== k) : KINDS.filter((x) => act.includes(x) || x === k);
    if (!S.userKinds.includes('element')) S.etypes = [];
    reload();
  });
  N.etypes.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const t = b.dataset.t;
    S.etypes = e.ctrlKey || e.metaKey ? [t] : S.etypes.includes(t) ? S.etypes.filter((x) => x !== t) : [...S.etypes, t];
    if (!S.userKinds) S.userKinds = activeKinds();
    reload();
  });
  N.ctx.addEventListener('click', () => { S.userKinds = null; S.etypes = []; reload(); });
  N.folders.addEventListener('click', (e) => {
    const w = e.target.closest('[data-w]');
    if (w) {
      if (S.space === w.dataset.w) return;
      S.space = w.dataset.w;
      S.sel.clear(); S.anchor = -1; S.focus = 0;
      S.lists.other = freshList('other'); clearGrid(); N.scroll.scrollTop = 0;
      fetchPage(S.lists.other, 0); paintFolders(); paintGrid();
      return;
    }
    const b = e.target.closest('[data-f]');
    if (!b) return;
    S.folder = b.dataset.f || null;
    S.lists.here = freshList('here'); clearGrid(); N.scroll.scrollTop = 0;
    fetchPage(S.lists.here, 0); paintFolders(); paintGrid();
  });
  for (const [id] of SECS) {
    N.heads[id].btn.addEventListener('click', () => openSection(id));
  }
  // la grille : défiler repeint les lignes visibles ; sa largeur change : aussi
  scroll.addEventListener('scroll', () => requestAnimationFrame(paintGrid), { passive: true });
  new ResizeObserver(() => paintGrid()).observe(scroll);
  const at = (e) => { const n = e.target.closest?.('.lt'); if (!n || n.classList.contains('ph')) return null; const i = Number(n.dataset.i); const it = cur().items[i]; return it ? { n, i, it } : null; };
  space.addEventListener('click', (e) => {
    const h = at(e);
    if (!h) return;
    S.focus = h.i;
    if (D.cfg.clickPlaces && !e.ctrlKey && !e.metaKey && !e.shiftKey) { place(targetsFor(h.it), 'click'); return; }
    choose(h.i, h.it, e);
    h.n.focus({ preventScroll: true });
  });
  space.addEventListener('dblclick', (e) => {
    const h = at(e);
    if (!h || D.cfg.clickPlaces) return;
    place(targetsFor(h.it), 'dblclick');
  });
  space.addEventListener('dragstart', (e) => {
    const h = at(e);
    if (!h) { e.preventDefault(); return; }
    const it = h.it;
    S.dragging = true;
    if (it._cf) {
      e.dataTransfer.effectAllowed = 'copy';
      if (it.imported?.[0]) e.dataTransfer.setData(ITEM_MIME, JSON.stringify({ id: it.imported[0], kind: 'element', title: it.name }));
      else e.dataTransfer.setData(CF_MIME, JSON.stringify({ slug: it.slug, imported: '' }));
      return;
    }
    const many = targetsFor(it).filter((x) => !x._cf);
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData(ITEM_MIME, JSON.stringify({ id: it.id, kind: it.kind, title: it.title, thumb_url: it.thumb_url, space: it.space || null }));
    if (many.length > 1) e.dataTransfer.setData(MULTI_MIME, JSON.stringify(many.map((x) => x.id)));
    // d'un autre Workspace : un type vide qui le dit dès le survol (le contenu ne se lit qu'au dépôt)
    for (const sp of new Set(many.filter(away).map((x) => x.space))) e.dataTransfer.setData(SPACE_MIME + sp, '1');
    if (it.url) e.dataTransfer.setData('text/uri-list', href(it.url));
  });
  addEventListener('dragend', () => { S.dragging = false; }, true);
  addEventListener('drop', () => { S.dragging = false; }, true);
  // le clic droit : notre menu, jamais celui du navigateur
  const openMenu = (h, x, y, kb = false) => {
    const tg = targetsFor(h.it);
    const it = h.it;
    const many = tg.length > 1;
    const extra = typeof D.cfg.menu === 'function' ? (D.cfg.menu(it, tg) || []) : [];
    menu(x, y, [{ head: many ? `${tg.length} objets` : (it.title || it.id) },
      { label: D.cfg.placeLabel || 'Poser', sub: D.cfg.clickPlaces ? 'clic' : 'double-clic',
        disabled: typeof D.cfg.place !== 'function' || (tg.some(away) && !!importWhy()),
        why: typeof D.cfg.place !== 'function' ? `pour la poser : glisse la vignette sur une zone de ${toolName()} qui la prend` : importWhy(),
        onclick: () => place(tg, 'menu') },
      ...extra,
      '-',
      !it._cf && it.kind === 'audio' ? { label: audio && audio._id === it.id && !audio.paused ? 'Arrêter l’écoute' : 'Écouter', icon: '▶', onclick: () => listen(it) } : null,
      // un visualiseur : la gestion (aimer, ranger, jeter, renommer) est à la page Asset, sur sa fiche
      !it._cf && !many ? { label: 'Fiche dans Asset', icon: '↗', sub: 'gérer', onclick: () => fiche(it) } : null], { focusFirst: kb });
  };
  space.addEventListener('contextmenu', (e) => {
    const h = at(e);
    if (!h) return;
    e.preventDefault();
    const kb = e.button !== 2 && e.clientX === 0 && e.clientY === 0;
    const r = h.n.getBoundingClientRect();
    openMenu(h, kb ? r.left + 8 : e.clientX, kb ? r.bottom - 4 : e.clientY, kb);
  });
  // le bouton du milieu : faire défiler la liste (la règle de Cal), jamais le défilement automatique
  scroll.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  scroll.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  scroll.addEventListener('pointerdown', (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    const y0 = e.clientY, s0 = scroll.scrollTop, z = zoomOf();
    try { scroll.setPointerCapture(e.pointerId); } catch { /* */ }
    scroll.classList.add('panning');
    const mv = (ev) => { scroll.scrollTop = s0 - (ev.clientY - y0) / z; };
    const up = () => { scroll.classList.remove('panning'); scroll.removeEventListener('pointermove', mv); scroll.removeEventListener('pointerup', up); scroll.removeEventListener('pointercancel', up); };
    scroll.addEventListener('pointermove', mv);
    scroll.addEventListener('pointerup', up);
    scroll.addEventListener('pointercancel', up);
  });
  // le clavier de la grille (APG, listbox) : flèches, Entrée = poser, Espace = choisir, Maj+flèches, Ctrl+A, Échap
  scroll.addEventListener('keydown', (e) => {
    const L = cur();
    const n = L.total || 0;
    if (e.target === N.scroll && ['ArrowDown', 'ArrowRight', 'Home'].includes(e.key) && n) { e.preventDefault(); focusTile(S.focus); return; }
    const h = at(e);
    const { cols } = metrics();
    const mv = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols, Home: -1e9, End: 1e9, PageUp: -cols * 4, PageDown: cols * 4 }[e.key];
    if (mv !== undefined && n) {
      e.preventDefault();
      const to = clamp(S.focus + mv, 0, n - 1);
      if (e.shiftKey) { const it = L.items[to]; if (it) { S.sel.set(keyOf(it), it); if (S.anchor < 0) S.anchor = S.focus; } }
      focusTile(to);
      if (e.shiftKey) paintSel();
      return;
    }
    if (!h) return;
    if (e.key === 'Enter') { e.preventDefault(); if (e.altKey && !h.it._cf) fiche(h.it); else place(targetsFor(h.it), 'key'); return; }
    if (e.key === ' ') { e.preventDefault(); choose(h.i, h.it, { ctrlKey: true }); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      L.items.forEach((it) => { if (it) S.sel.set(keyOf(it), it); });
      paintSel(); live(`${S.sel.size} choisis`);
      return;
    }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = h.n.getBoundingClientRect(); openMenu(h, r.left + 8, r.bottom - 4, true); }
  });
  // Échap dans le panneau : vider la sélection, sinon (la recherche vide) fermer le panneau — le focus
  // revient où il était (setOpen)
  aside.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.querySelector('.sr-menu')) {
      if (S.sel.size) { S.sel.clear(); paintSel(); live('plus rien de choisi'); } else if (!(e.target === N.q && N.q.value)) setOpen(false);
    }
    // le panneau garde les touches qu'il traite : l'Espace qui choisit ne lance pas la lecture d'ODIO,
    // Suppr ne jette rien (un visualiseur) ; Ctrl+Z et les autres raccourcis Ctrl vont à l'outil
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() === 'a') e.stopPropagation();
  });
  // la poignée et sa languette : glisser = la largeur (fermé, elle l'ouvre en glissant) ; un clic sur la
  // languette ouvre ou ferme, sur le trait seul il ouvre (ouvert, le trait n'est qu'une largeur) ;
  // double-clic = la largeur par défaut
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const was = S.open, x0 = e.clientX, z = zoomOf();
    const onTab = !!e.target.closest?.('.sr-dock-tab');
    const w0 = was ? geometry().w : 0;
    let moved = false;
    try { grip.setPointerCapture(e.pointerId); } catch { /* */ }
    grip.classList.add('on');
    document.documentElement.classList.add('sr-dock-resizing');
    const mv = (ev) => {
      const d = (ev.clientX - x0) / z;
      if (!moved && Math.abs(d) < 3) return;
      if (!moved) { moved = true; if (!was) setOpen(true, { anim: false }); }
      setWant(w0 + d, false);
    };
    const up = () => {
      grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
      grip.classList.remove('on');
      document.documentElement.classList.remove('sr-dock-resizing');
      if (moved) setWant(S.want);
      else if (!was) setOpen(true, { focus: true });
      else if (onTab) setOpen(false);
      setNear(false);
    };
    grip.addEventListener('pointermove', mv);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', (e) => { e.preventDefault(); setWant(W.def); if (!S.open) setOpen(true); });
  // la languette : elle sort quand la souris approche du bord (TAB_NEAR px de part et d'autre du bord du
  // panneau ; fermé, du bord de la fenêtre), et sur elle-même ; à un vrai mouvement seulement — rien au
  // chargement, rien sous un doigt (dock.css : sans survol, elle reste sortie) — ; elle se range 300 ms
  // après que la souris s'éloigne, jamais pendant un geste. Aucun voile : la page garde ses clics.
  let nearT = 0, nearEv = null;
  function setNear(on) {
    clearTimeout(nearT);
    if (on) grip.classList.add('near');
    else if (grip.classList.contains('near')) nearT = setTimeout(() => { if (!grip.classList.contains('on')) grip.classList.remove('near'); }, 300);
  }
  const nearCheck = () => {
    const e = nearEv;
    nearEv = null;
    if (!e || !N.grip) return;
    const r = grip.getBoundingClientRect();
    const t = N.tab.getBoundingClientRect();
    const onTab = grip.classList.contains('near') && e.clientX >= t.left - 4 && e.clientX <= t.right + 4 && e.clientY >= t.top - 4 && e.clientY <= t.bottom + 4;
    const byEdge = e.clientY >= r.top && e.clientY <= r.bottom && Math.abs(e.clientX - r.left) <= TAB_NEAR;
    setNear(onTab || byEdge);
  };
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || (!e.movementX && !e.movementY)) return;
    if (!nearEv) requestAnimationFrame(nearCheck);
    nearEv = e;
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => setNear(false));
  grip.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.open) { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setOpen(!S.open, { focus: !S.open }); return; }
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); if (!S.open) setOpen(true); setWant(e.key === 'Home' ? W.min : W.max); return; }
    const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    if (!S.open) { if (d > 0) setOpen(true); return; }
    setWant(geometry().w + d * (e.shiftKey ? 64 : 16));
  });
  // un clic ailleurs rend le clavier à la page : la recherche du panneau ne garde pas le focus quand
  // l'outil empêche le sien (la planche d'Idéation), sinon ses raccourcis s'écriraient dans « chercher »
  addEventListener('pointerdown', (e) => {
    const a = document.activeElement;
    if (N.aside && a && N.aside.contains(a) && !N.aside.contains(e.target) && !e.target.closest?.('.sr-menu, .sr-dock-grip')) a.blur();
  }, true);
  // la barre du haut : sa hauteur place le panneau ; la fenêtre change : la largeur choisie reste, bornée
  const hdr = document.querySelector('body > .hdr');
  const hdrH = () => document.documentElement.style.setProperty('--sr-hdr-h', `${hdr && hdr.offsetParent !== null ? hdr.offsetHeight : 0}px`);
  if (hdr) new ResizeObserver(hdrH).observe(hdr);
  hdrH();
  addEventListener('resize', () => applyLayout());
  // relire : un rendu fini, le choix d'un autre navigateur, les récents rangés ailleurs
  let jT = 0;
  document.addEventListener('sr:job', () => { clearTimeout(jT); jT = setTimeout(() => { S.dirty = true; if (S.open) reload(true); }, 300); });
  prefs.on(P('dockW'), () => { if (!own) { readState(); applyLayout(); } });
  prefs.on('general.dockKey', () => applyLayout());
}

// Ouvert ou fermé ne se garde pas : chaque page arrive panneau FERMÉ (Cal, 30/09 : « changer de page =
// faire autre chose, on n'a plus besoin du panneau »). Seule la largeur choisie se garde, par outil.
function readState() {
  S.want = clamp(Number(prefs.get(P('dockW'), W.def)) || W.def, W.min, W.max);
}

// ── ce que la façade de shell.js appelle ────────────────────
const M = {
  open: (o = {}) => setOpen(true, o),
  close: () => setOpen(false),
  toggle: (o = {}) => setOpen(!S.open, o),
  isOpen: () => S.open,
  // (un changement de Workspace passe par ici : la liste des autres change avec lui)
  reload: () => { S.dirty = true; if (S.who) loadSpaces(); reload(true); },
  recent,
  refresh: () => { if (!N.aside) return; paintAll(); applyLayout(); if (filtersMoved()) reload(); },
  contexte: () => { S.userKinds = null; S.etypes = []; if (!N.aside) return; if (filtersMoved()) reload(); else paintKinds(); },
  zones: () => { queueMicrotask(() => { if (!N.aside || D.ctx || S.userKinds) return; if (filtersMoved()) reload(); else paintKinds(); }); },
};

let mounting = false;
export async function mount(tool) {
  if (D.mod || !tool || mounting) return;
  mounting = true;
  await cssReady();
  T = tool;
  build();
  D.mod = M; D.on = true;
  mounting = false;
  readState();
  const sec = prefs.get('general.dockSec', 'here');
  S.sec = SECS.some(([k]) => k === sec) ? sec : 'here';
  const readSort = () => { const s = prefs.get('general.dockSort', 'new'); S.sort = SORTS.some(([k]) => k === s) ? s : 'new'; };
  readSort();
  applyLayout();
  paintAll();
  for (const fn of D.wait.splice(0)) { try { fn(M); } catch (e) { console.error('panneau Asset', e); } }
  // la largeur et le tri relus du portail (un autre navigateur a pu les changer)
  prefs.ready.then(() => { readState(); applyLayout(); const was = S.sort; readSort(); if (S.sort !== was) { paintSort(); S.dirty = true; if (S.open) reload(); } });
  // qui entre : l'invité d'une planche n'a pas le panneau ; Character Factory est au Studio
  session().then((me) => {
    if (me?.user?.role === 'invite') { unmount(); return; }
    // pas encore entré (la porte est devant la page : une demande, un lien d'invitation en cours) : rien à lire
    if (me?.auth && me.state !== 'active') return;
    S.studio = !(me?.user && me.user.access === 'apps');
    S.who = true;
    loadSpaces();
    paintSecs();
    if (S.open) reload();
  });
}
function unmount() {
  for (const n of [N.aside, N.grip, N.veil]) n?.remove();
  const root = document.documentElement;
  root.classList.remove('sr-dock-on', 'sr-dock-over');
  N = {};
  S.lists = {};
  D.on = false;
  D.mod = null;
  D.wait.length = 0;
  S.open = false;
  document.dispatchEvent(new CustomEvent('sr:dock', { detail: { open: false, w: 0, over: false, gone: true } }));
}
