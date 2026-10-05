// Musique, les Spaces : des dossiers de travail À L'INTÉRIEUR du Workspace.
// L'étude : docs/etudes/musique_spaces_playlists.md § 2 ; le serveur :
// server/tools/chanson.py, section « les Spaces ». Décisions de Cal du 05/10 :
// un Space qu'on crée est partagé avec le Workspace (S1) ; « Mon Space » reste
// à chacun, c'est le Space par défaut ; supprimer un Space renvoie ses chansons
// dans « Mon Space » de leur auteur, rien ne va à la corbeille (S2).
//
// - En haut du rail : « Space : <nom> ▾ » — le menu des Spaces du Workspace,
//   « + Nouveau Space », « Tous les Spaces » ; le « ⋯ » à côté : renommer, la
//   couleur, la pochette, archiver, supprimer le Space choisi. Ce qu'on crée va
//   dans le Space choisi (« Tous » : dans « Mon Space », la ligne le dit).
// - La scène ne montre que le Space choisi ; en vue « Tous », la pastille du
//   Space sur chaque carte.
// - Maj+clic, Ctrl+clic (⌘ sur Mac) choisissent plusieurs cartes ; « Déplacer
//   vers… » (la barre de la sélection, le menu d'une carte), ou glisser les cartes
//   sur un Space du menu ouvert (il s'ouvre aussi au survol du bouton pendant le
//   glisser). Les pistes séparées suivent leur chanson (le serveur). Ctrl+Z rend.
// - « Importer » : des sons du disque, rangés dans le Space choisi dès leur
//   naissance (PUT /api/chanson/import) ; une référence déposée aussi.
// - Le Space choisi est retenu par Workspace : la préférence de page
//   `chanson.spaces` (chanson/prefs.json), des paires « esp-…=msp-… ».
//
// LE CONTRAT des volets voisins (la playlist, wip2/playlists, naît dans le Space courant) :
//   import { spaceCourant } from './spaces.js';
//   spaceCourant() → { id, music_space, name, color, archived, vue, workspace }
//     id           'mon' | 'msp-…' : le Space où naît ce qu'on crée maintenant
//     music_space  '' | 'msp-…'    : la valeur à envoyer au serveur (le `music_space` d'une
//                                    demande ; chanson.creatable_space la juge côté serveur)
//     vue          'mon' | 'msp-…' | '*' : ce que la scène montre (« * » : tous les Spaces)
//   window 'sr:music-space' (CustomEvent, detail = spaceCourant()) : à chaque changement —
//     un autre Space choisi, renommé, recoloré, archivé, supprimé.
//   Une carte de la scène se glisse avec ITEM_MIME et MULTI_MIME (commun/shell.js) : toute
//   zone qui prend des sons la reçoit.
//
// ODIO monte le MÊME menu (06/10, étape 7 de l'étude : la rubrique « Space » de son
// navigateur, musique/space.js) : montrerSpaces({ box, memo: false, esp, vue, nom… })
// — le menu se peint dans `box` au lieu du rail, le Space suit le projet ouvert au
// lieu de la préférence, les lectures et écritures disent le Workspace du projet ;
// choisirSpace(vue) et rechargerSpaces() le mènent. Sa feuille : spaces.css, à côté.
import { api, el, $, $$, toast, href, pick, ITEM_MIME, MULTI_MIME } from '../commun/shell.js';
import { prefs } from '../commun/prefs.js';
import { menu, kebab, closeMenus } from '../commun/menu.js';
import { ask } from '../commun/fil.js';

// la feuille du menu des Spaces, chargée une fois, à côté de ce fichier (l'app Musique et ODIO)
if (!document.querySelector('link[data-sr-spaces]')) {
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./spaces.css', import.meta.url).href, 'data-sr-spaces': '' }));
}

const MON = 'mon', TOUS = '*';
const CARD_MIME = 'application/x-sr-chanson';   // des cartes de la scène : un type à soi, que le menu Space attend
const PREF = 'chanson.spaces';
// les couleurs : des noms de jetons (server/tools/chanson.py, SPACE_COLORS), leurs mots
const COLOR_FR = { cy: 'acier', grn2: 'vert', amb: 'ambre', 'coral-2': 'corail', 'verd-2': 'vert sombre', 'coral-3': 'rose pâle', 'coral-1': 'cuivre' };
const P = {
  ws: null, mine: { id: MON, name: 'Mon Space', count: 0 }, list: [], all: 0, colors: Object.keys(COLOR_FR),
  canCreate: true, whyCreate: '', loaded: false,
  vue: MON, sel: new Set(), anchor: null, where: new Map(), pop: null, box: null,
  // memo : le Space choisi retenu par Workspace (l'app) ; esp() : les options d'api() du Workspace
  // (ODIO : celui du projet) ; nom(n) : ce qu'on déplace, dit en mots (l'app : des chansons)
  opt: { U: null, onChange: null, reload: null, memo: true, esp: null, nom: null },
};
const A = (path, o = {}) => api(path, { ...o, ...(P.opt.esp?.() || {}) });

const put = (box, ...kids) => box && box.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false && k !== ''));
const byId = (id) => (id === MON ? P.mine : P.list.find((x) => x.id === id) || null);
const tint = (sp) => (sp && sp.id !== MON ? `var(--${sp.color || 'cy'})` : 'var(--ink3)');
const marque = (sp) => (sp?.cover_url ? el('img', { class: 'ch-sp-cov', src: href(sp.cover_url), alt: '' })
  : el('i', { class: 'ch-sp-dot' + (sp ? '' : ' tous'), style: { '--k': sp ? tint(sp) : 'var(--ink2)' } }));
const cartes = (e) => [...(e.dataTransfer?.types || [])].includes(CARD_MIME);
const nChansons = (n) => `${n} chanson${n > 1 ? 's' : ''}`;
const nObjets = (n) => (P.opt.nom ? P.opt.nom(n) : nChansons(n));

// ── le contrat ──────────────────────────────────────────────
/** Le Space courant de la page : celui où naît ce qu'on crée (voir l'en-tête du fichier). */
export function spaceCourant() {
  const sp = byId(P.vue === TOUS ? MON : P.vue) || P.mine;
  return { id: sp.id, music_space: sp.id === MON ? '' : sp.id, name: sp.name, color: sp.id === MON ? null : sp.color || null,
    archived: !!sp.archived, vue: P.vue, workspace: P.ws };
}
/** Ce que la scène montre : 'mon' | 'msp-…' | '*' (le `space` de GET /api/chanson/list). */
export const vueSpace = () => P.vue;
/** Le nom d'un Space du Workspace ('' ou 'mon' : « Mon Space ») ; un Space qui n'est plus là : « Mon Space ». */
export const spaceNom = (id) => (byId(id || MON) || P.mine).name;
/** Pourquoi on ne crée pas dans le Space courant ('' : on peut) — la règle 7 du thème. */
export function spaceWhy() {
  if (!P.loaded) return '';
  const sp = byId(spaceCourant().id);
  if (sp?.archived) return `le Space « ${sp.name} » est archivé : rouvre-le (⋯ à côté du Space) pour y créer`;
  if (!P.canCreate) return P.whyCreate || 'tu ne crées pas dans ce Workspace';
  return '';
}
const annoncer = () => window.dispatchEvent(new CustomEvent('sr:music-space', { detail: spaceCourant() }));

// ── la mémoire : le Space choisi, par Workspace (préférence de page) ──
function memo() {
  const m = new Map();
  for (const pair of String(prefs.get(PREF, '') || '').split(/\s+/)) {
    const [k, v] = pair.split('=');
    if (k && v) m.set(k, v);
  }
  return m;
}
function retenir() {
  if (P.opt.memo === false) return;   // ODIO : le Space est celui du projet ouvert
  const m = memo(), k = P.ws || '-';
  m.delete(k);
  if (P.vue !== MON) m.set(k, P.vue);            // « Mon Space », le défaut, ne s'écrit pas
  prefs.set(PREF, [...m].slice(-40).map(([a, b]) => `${a}=${b}`).join(' '));
}

// ── le serveur ──────────────────────────────────────────────
async function charger() {
  const r = await A('chanson/spaces');
  P.ws = r.workspace || null;
  P.mine = r.mine || P.mine;
  P.list = r.spaces || [];
  P.all = r.all || 0;
  if (Array.isArray(r.colors) && r.colors.length) P.colors = r.colors;
  P.canCreate = r.can_create !== false;
  P.whyCreate = r.why_create || '';
  P.loaded = true;
}
/** Ce que la liste des chansons dit (GET /api/chanson/list) : les comptes, le Space montré, où est chaque carte
 *  (ses projets ODIO compris). Sans `counts` (ODIO : le contenu d'un Space), les comptes restent. */
export function spacesListe(r) {
  if (r?.space && r.space !== P.vue) { P.vue = r.space; retenir(); annoncer(); }   // un Space supprimé ailleurs : « Mon Space »
  const c = r?.counts;
  if (c) {
    P.mine.count = c[MON] || 0;
    for (const sp of P.list) sp.count = c[sp.id] || 0;
    P.all = Object.values(c).reduce((a, b) => a + b, 0);
  }
  P.where = new Map([...(r?.songs || []), ...(r?.projets || [])].map((s) => [s.id, s.music_space || MON]));
  for (const id of [...P.sel]) if (!P.where.has(id)) P.sel.delete(id);
  // un Space créé par quelqu'un d'autre depuis : la liste des Spaces se relit
  if ([...Object.keys(c || {}), ...P.where.values()].some((k) => k !== MON && !byId(k))) charger().then(peindre).catch(() => {});
  peindre();
}

// ── monter : le rail, la tête de la scène, la sélection ─────
/** opt : { U (l'annulation de la page), onChange() (un autre Space choisi), reload() (relire les chansons) ;
 *  pour une autre page qu'elle (ODIO) : box (le nœud où se peint le menu), memo: false (ne rien retenir),
 *  vue (le Space montré d'abord), esp() (les options d'api() : le Workspace), nom(n) (ce qu'on déplace) } */
export async function montrerSpaces(opt = {}) {
  Object.assign(P.opt, opt);
  P.box = opt.box || el('section', { class: 'ch-space', id: 'ch-space', 'aria-label': 'le Space' });
  P.box.classList.add('ch-space');
  if (!opt.box) $('#rail')?.prepend(P.box);
  monterTete();
  ecouterSelection();
  try { await charger(); } catch (e) { toast(`Spaces : ${e.message}`, 6000); }
  let want = opt.vue;
  if (want === undefined) {
    // la préférence relue du portail une fois (le miroir de ce navigateur sinon), sans attendre plus d'un instant
    await Promise.race([prefs.ready, new Promise((r) => setTimeout(r, 1500))]);
    want = memo().get(P.ws || '-');
  }
  want = want || MON;
  P.vue = want === TOUS || byId(want) ? want : MON;
  peindre();
  annoncer();
}
/** Montrer ce Space ('mon' | 'msp-…' | '*' ; un Space qui n'est plus là : « Mon Space ») — ODIO : celui du projet ouvert. */
export const choisirSpace = (vue) => choisir(vue || MON);
/** Relire les Spaces du Workspace (ODIO : un projet d'un autre Workspace vient de s'ouvrir), puis repeindre. */
export async function rechargerSpaces() {
  await charger();
  if (P.vue !== TOUS && !byId(P.vue)) choisir(MON); else { peindre(); annoncer(); }
}

function choisir(vue) {
  if (vue !== TOUS && !byId(vue)) vue = MON;
  const changed = vue !== P.vue;
  P.vue = vue;
  retenir();
  P.sel.clear(); P.anchor = null;
  peindre();
  annoncer();
  if (changed) P.opt.onChange?.();
}

let peint = '';
function peindre() {
  const box = P.box;
  if (!box) return;
  const cur = P.vue === TOUS ? null : byId(P.vue);
  const n = cur ? cur.count || 0 : P.all;
  const lb = $('.ch-head > .lbl');
  if (lb) lb.textContent = P.vue === TOUS ? 'Toutes les chansons' : P.vue === MON ? 'Tes chansons' : 'Les chansons du Space';
  peindreSel();
  // rien n'a changé (la liste se relit souvent) : le bouton reste, et le focus avec lui
  const sig = JSON.stringify([P.loaded, P.vue, cur && [cur.name, cur.color, cur.cover_url, cur.archived, cur.owner_name], n, !!P.pop]);
  if (sig === peint && box.firstChild) return;
  peint = sig;
  const btn = el('button', { class: 'ch-space-btn', id: 'ch-space-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': P.pop ? 'true' : 'false',
    title: 'le Space : ce que tu crées y va · glisse des cartes ici pour les ranger', onclick: () => (P.pop ? fermer() : ouvrir()) },
  marque(cur), el('b', {}, cur ? cur.name : 'Tous les Spaces'), el('small', {}, String(n)), el('span', { class: 'arr', 'aria-hidden': 'true' }, '▾'));
  // des cartes qu'on glisse : le menu s'ouvre au survol du bouton
  btn.addEventListener('dragenter', (e) => { if (cartes(e)) { e.preventDefault(); btn.classList.add('drop-on'); if (!P.pop) ouvrir(); } });
  btn.addEventListener('dragover', (e) => { if (cartes(e)) e.preventDefault(); });
  btn.addEventListener('dragleave', () => btn.classList.remove('drop-on'));
  const note = !P.loaded ? '' : P.vue === TOUS ? 'tout ce que tu vois · tu crées dans Mon Space'
    : cur?.archived ? 'archivé : on l’écoute, on n’y crée plus'
      : cur && cur.id !== MON ? `partagé avec le Workspace${cur.owner_name ? ` · créé par ${cur.owner_name}` : ''}`
        : 'le tien : les autres ne le voient pas';
  put(box, el('span', { class: 'lbl' }, 'Space'), btn, kebab(menuGerer, { title: 'ce Space', cls: 'ch-space-k' }),
    note ? el('p', { class: 'ch-note ch-space-n' + (cur?.archived ? ' arch' : '') }, note) : null);
}

// ── le menu des Spaces (le même habit que le menu commun : .sr-menu) ──
// À soi plutôt que commun/menu.js : ses lignes reçoivent des cartes glissées, et il reste
// ouvert quand on commence à glisser une carte (il se ferme au clic dehors, pas à l'appui).
function ouvrir() {
  fermer();
  closeMenus();
  const btn = $('#ch-space-btn');
  if (!btn) return;
  const node = el('div', { class: 'sr-menu ch-spmenu', role: 'menu', tabindex: '-1', 'aria-label': 'les Spaces de ce Workspace' });
  const ligne = (id, label, { mark = null, sub = null, onclick, drop = null, why = '', cls = '' }) => {
    const on = id === P.vue;
    const b = el('button', { class: `mi${on ? ' cur' : ''}${cls ? ' ' + cls : ''}`, type: 'button', role: 'menuitemradio',
      'aria-checked': on ? 'true' : 'false', 'aria-disabled': why ? 'true' : null, title: why || null, 'data-sp': id },
    mark || el('span', { class: 'ic' }), el('span', { class: 'lb' }, label), sub !== null ? el('span', { class: 'sub' }, String(sub)) : null,
    why ? el('span', { class: 'why' }, why) : null);
    b.addEventListener('click', (e) => { e.stopPropagation(); if (why) { toast(why); return; } fermer(); onclick(); });
    b.addEventListener('pointerenter', () => marquer(b));
    if (drop) cible(b, drop);
    return b;
  };
  const live = P.list.filter((x) => !x.archived), arch = P.list.filter((x) => x.archived);
  node.append(el('span', { class: 'head' }, 'Spaces'),
    ligne(MON, 'Mon Space', { mark: marque(P.mine), sub: P.mine.count || 0, onclick: () => choisir(MON), drop: (ids) => deplacer(ids, MON) }),
    ...live.map((sp) => ligne(sp.id, sp.name, { mark: marque(sp), sub: sp.count || 0, onclick: () => choisir(sp.id), drop: (ids) => deplacer(ids, sp.id) })),
    arch.length ? el('span', { class: 'head' }, 'Archivés') : '',
    ...arch.map((sp) => ligne(sp.id, sp.name, { mark: marque(sp), sub: sp.count || 0, cls: 'arch', onclick: () => choisir(sp.id) })),
    el('i', { class: 'sep', role: 'separator' }),
    ligne('', '+ Nouveau Space', { why: P.canCreate ? '' : P.whyCreate, onclick: () => nouveau(), drop: P.canCreate ? (ids) => nouveau(ids) : null }),
    ligne(TOUS, 'Tous les Spaces', { mark: marque(null), sub: P.all, onclick: () => choisir(TOUS) }));
  document.body.append(node);
  const r = btn.getBoundingClientRect();
  node.style.minWidth = `${Math.max(220, Math.round(r.width))}px`;
  node.style.left = `${Math.max(8, Math.min(r.left, innerWidth - node.offsetWidth - 8))}px`;
  node.style.top = `${Math.max(8, Math.min(r.bottom + 4, innerHeight - node.offsetHeight - 8))}px`;
  P.pop = node;
  btn.setAttribute('aria-expanded', 'true');
  node.focus({ preventScroll: true });
  setTimeout(() => { addEventListener('click', dehors, true); addEventListener('keydown', clavier, true); addEventListener('resize', fermer); });
}
function fermer() {
  if (!P.pop) return;
  P.pop.remove();
  P.pop = null;
  removeEventListener('click', dehors, true);
  removeEventListener('keydown', clavier, true);
  removeEventListener('resize', fermer);
  const b = $('#ch-space-btn');
  b?.setAttribute('aria-expanded', 'false');
  b?.classList.remove('drop-on');
}
function dehors(e) { if (P.pop && !P.pop.contains(e.target) && !e.target.closest?.('#ch-space-btn')) fermer(); }
const lignes = () => [...(P.pop?.querySelectorAll(':scope > .mi') || [])];
function marquer(b) { for (const x of lignes()) x.classList.toggle('on', x === b); b?.scrollIntoView({ block: 'nearest' }); }
function clavier(e) {
  if (!P.pop) return;
  const list = lignes(), at = list.findIndex((x) => x.classList.contains('on'));
  if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); fermer(); $('#ch-space-btn')?.focus(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation();
    const from = at < 0 ? list.findIndex((x) => x.classList.contains('cur')) : at;
    marquer(list[(from + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]);
    return;
  }
  // Entrée, Espace : la ligne marquée (l'Espace n'écoute pas la chanson derrière le menu)
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (at >= 0) list[at].click(); }
}
// une ligne qui reçoit des cartes glissées : les ranger dans ce Space
function cible(node, fn) {
  let depth = 0;
  node.addEventListener('dragenter', (e) => { if (!cartes(e)) return; e.preventDefault(); depth++; node.classList.add('drop-on'); });
  node.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; node.classList.remove('drop-on'); } });
  node.addEventListener('dragover', (e) => { if (cartes(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
  node.addEventListener('drop', (e) => {
    if (!cartes(e)) return;
    e.preventDefault(); e.stopPropagation();
    depth = 0; node.classList.remove('drop-on');
    let ids = [];
    try { ids = JSON.parse(e.dataTransfer.getData(CARD_MIME) || '[]'); } catch { ids = []; }
    fermer();
    if (ids.length) fn(ids);
  });
}

// ── gérer le Space choisi (le « ⋯ ») ────────────────────────
function menuGerer() {
  const sp = P.vue === TOUS || P.vue === MON ? null : byId(P.vue);
  const nouv = { label: 'Nouveau Space…', icon: '+', disabled: !P.canCreate, why: P.whyCreate, onclick: () => nouveau() };
  if (!sp) {
    return [{ head: P.vue === MON ? 'Mon Space' : 'Tous les Spaces' }, nouv, '-',
      { label: 'Renommer…', icon: '✎', disabled: true, why: P.vue === MON ? '« Mon Space » est le tien : il garde son nom' : 'choisis d’abord un Space' }];
  }
  const noEdit = sp.can?.edit ? '' : 'ton rôle dans ce Workspace ne le permet pas';
  const noDel = sp.can?.delete ? '' : `seul·e ${sp.owner_name || 'son auteur'} (son auteur) ou un admin du Workspace le supprime`;
  return [{ head: sp.name },
    { label: 'Renommer…', icon: '✎', disabled: !!noEdit, why: noEdit, onclick: () => renommer(sp) },
    { label: 'Couleur', icon: '●', disabled: !!noEdit, why: noEdit,
      items: P.colors.map((c) => ({ label: COLOR_FR[c] || c, dot: c, sub: c === sp.color ? 'la sienne' : '', onclick: () => changer(sp, { color: c }) })) },
    { label: sp.cover ? 'Changer la pochette…' : 'Une pochette…', icon: '▣', sub: 'une image', disabled: !!noEdit, why: noEdit, onclick: () => pochette(sp) },
    sp.cover ? { label: 'Retirer la pochette', icon: '×', disabled: !!noEdit, why: noEdit, onclick: () => changer(sp, { cover: '' }) } : null,
    { label: sp.archived ? 'Rouvrir' : 'Archiver', icon: sp.archived ? '↺' : '▤', sub: sp.archived ? '' : 'on n’y crée plus', disabled: !!noEdit, why: noEdit,
      onclick: () => changer(sp, { archived: !sp.archived }) },
    '-', nouv, '-',
    { label: 'Supprimer le Space…', icon: '×', danger: true, disabled: !!noDel, why: noDel, onclick: () => supprimer(sp) }];
}
const LABEL = { name: 'renommer', color: 'changer la couleur de', cover: 'changer la pochette de', archived: 'archiver' };
async function majSpace(id, patch) {
  const r = await A('chanson/spaces', { method: 'POST', body: { action: 'update', id, ...patch } });
  const i = P.list.findIndex((x) => x.id === id);
  if (i >= 0) P.list[i] = r; else P.list.push(r);
  peindre();
  annoncer();
  return r;
}
async function changer(sp, patch) {
  const k = Object.keys(patch)[0];
  const before = { [k]: k === 'cover' ? sp.cover || '' : sp[k] };
  const label = k === 'archived' ? `${patch.archived ? 'archiver' : 'rouvrir'} le Space « ${sp.name} »` : `${LABEL[k] || 'changer'} le Space « ${sp.name} »`;
  try { await P.opt.U.run({ label, do: () => majSpace(sp.id, patch), undo: () => majSpace(sp.id, before) }); } catch (e) { toast(e.message, 6000); }
}
async function renommer(sp) {
  const name = await ask({ title: 'Renommer le Space', ok: 'Renommer', field: { value: sp.name, placeholder: 'son nom' } });
  if (name && name !== sp.name) changer(sp, { name });
}
async function pochette(sp) {
  const got = await pick({ kinds: ['image'], title: `La pochette de « ${sp.name} »` });
  if (got[0]) changer(sp, { cover: got[0].id });
}
async function nouveau(ids = null) {
  if (!P.canCreate) { toast(P.whyCreate || 'tu ne crées pas dans ce Workspace', 6000); return; }
  const name = await ask({ title: 'Nouveau Space', ok: 'Créer',
    text: 'Un dossier de travail partagé avec le Workspace : tout le monde y voit ce qui s’y crée. Ce que tu crées ensuite y va.',
    field: { placeholder: 'son nom — ex. Album été' } });
  if (!name) return;
  let sp;
  try { sp = await A('chanson/spaces', { method: 'POST', body: { action: 'create', name } }); } catch (e) { toast(e.message, 6000); return; }
  P.list = [...P.list.filter((x) => x.id !== sp.id), sp].sort((a, b) => (a.archived - b.archived) || a.name.localeCompare(b.name, 'fr'));
  if (ids?.length) await deplacer(ids, sp.id);
  choisir(sp.id);
  toast(`Space « ${sp.name} » : ce que tu crées y va`, 4000);
}
async function supprimer(sp) {
  const n = sp.count || 0;
  const yes = await ask({ title: `Supprimer « ${sp.name} » ?`, ok: 'Supprimer', danger: true,
    text: n ? `Ses ${nChansons(n)} retournent dans « Mon Space » de leur auteur. Rien ne va à la corbeille.` : 'Il est vide. Rien ne va à la corbeille.' });
  if (!yes) return;
  const apres = async () => {
    await charger();
    if (P.vue !== TOUS && !byId(P.vue)) choisir(MON); else { peindre(); annoncer(); }
  };
  try {
    const r = await P.opt.U.run({ label: `supprimer le Space « ${sp.name} »`,
      do: async () => { const x = await A('chanson/spaces', { method: 'POST', body: { action: 'delete', id: sp.id } }); await apres(); return x; },
      undo: async () => { await A('chanson/spaces', { method: 'POST', body: { action: 'restore', id: sp.id } }); await apres(); } });
    toast(r.returned ? `« ${sp.name} » supprimé : ${nChansons(r.returned)} de retour dans « Mon Space » · Ctrl+Z le rend` : `« ${sp.name} » supprimé · Ctrl+Z le rend`, 5000);
  } catch (e) { toast(e.message, 7000); }
}

// ── déplacer ────────────────────────────────────────────────
async function deplacer(ids, to) {
  const dest = byId(to);
  if (!dest || !ids.length) return;
  const label = `déplacer ${ids.length > 1 ? nObjets(ids.length) : P.opt.nom ? P.opt.nom(1) : 'une chanson'} vers « ${dest.name} »`;
  try {
    const r = await P.opt.U.run({ label,
      do: () => A('chanson/spaces/move', { method: 'POST', body: { ids, to } }),
      undo: (x) => (Object.keys(x?.before || {}).length ? A('chanson/spaces/move', { method: 'POST', body: { restore: x.before } }) : null) });
    P.sel.clear(); P.anchor = null;
    const songs = r.moved.length - (r.stems || 0);
    const more = [r.stems ? `leurs ${r.stems} pistes avec` : '', r.elsewhere ? `${nObjets(r.elsewhere)} d’autres personnes retournent dans leur « Mon Space »` : ''].filter(Boolean);
    toast(r.moved.length ? `${nObjets(songs)} → « ${dest.name} »${more.length ? ' · ' + more.join(' · ') : ''} · Ctrl+Z les rend` : `déjà dans « ${dest.name} »`, 4500);
    P.opt.reload?.();
  } catch (e) { toast(e.message, 7000); }
}
// les Spaces où l'on peut ranger (un menu commun : la barre de la sélection, le menu d'une carte)
function cibles(ids) {
  const all = (id) => ids.length && ids.every((x) => (P.where.get(x) || MON) === id);
  return [{ label: 'Mon Space', dot: 'ink3', disabled: all(MON), why: 'déjà là', onclick: () => deplacer(ids, MON) },
    ...P.list.filter((x) => !x.archived).map((sp) => ({ label: sp.name, dot: sp.color || 'cy', disabled: all(sp.id), why: 'déjà là',
      onclick: () => deplacer(ids, sp.id) })),
    '-', { label: 'Nouveau Space…', icon: '+', disabled: !P.canCreate, why: P.whyCreate, onclick: () => nouveau(ids) }];
}
/** L'entrée « Déplacer vers… » du menu d'une carte : la carte, ou toute la sélection si elle en est. */
export function menuSpaces(s) {
  const ids = P.sel.has(s.id) && P.sel.size > 1 ? ordreSel() : [s.id];
  return { label: ids.length > 1 ? `Déplacer les ${ids.length} vers…` : 'Déplacer vers…', icon: '⇢', items: cibles(ids) };
}

// ── la sélection : Maj+clic, Ctrl+clic ──────────────────────
const ordreSel = () => $$('#ch-list .ch-song[data-id]').map((c) => c.dataset.id).filter((id) => P.sel.has(id));
function ecouterSelection() {
  const list = $('#ch-list');
  if (!list) return;
  // Maj : pas de texte sélectionné au passage
  list.addEventListener('mousedown', (e) => { if (e.shiftKey && e.target.closest('.ch-song')) e.preventDefault(); });
  list.addEventListener('click', (e) => {
    const c = e.target.closest('.ch-song[data-id]');
    if (!c) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      // un clic choisi n'écoute pas, ne lance rien : il choisit
      e.preventDefault(); e.stopPropagation();
      const id = c.dataset.id;
      if (e.shiftKey && P.anchor) {
        const ids = $$('#ch-list .ch-song[data-id]').map((x) => x.dataset.id);
        const a = ids.indexOf(P.anchor), b = ids.indexOf(id);
        if (!(e.ctrlKey || e.metaKey)) P.sel.clear();
        for (const x of a < 0 ? [id] : ids.slice(Math.min(a, b), Math.max(a, b) + 1)) P.sel.add(x);
      } else {
        if (P.sel.has(id)) P.sel.delete(id); else P.sel.add(id);
        P.anchor = id;
      }
      peindreSel();
      return;
    }
    // un clic simple hors des commandes : la sélection s'en va
    if (P.sel.size && !e.target.closest('button, a, canvas, input, select, textarea')) { P.sel.clear(); peindreSel(); }
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && P.sel.size && !P.pop && !document.querySelector('.scrim, .sr-menu')) { P.sel.clear(); peindreSel(); }
  });
}
function peindreSel() {
  for (const c of $$('#ch-list .ch-song[data-id]')) c.classList.toggle('sel', P.sel.has(c.dataset.id));
  const n = P.sel.size;
  put($('#ch-selbar'), n ? [el('span', { class: 'n' }, n > 1 ? `${n} choisies` : '1 choisie'),
    el('button', { class: 'tb ghost sm', type: 'button', 'data-act': 'move', onclick: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      menu(r.left, r.bottom + 4, [{ head: n > 1 ? `déplacer ${nChansons(n)}` : 'déplacer vers' }, ...cibles(ordreSel())]);
    } }, 'Déplacer vers…'),
    el('button', { class: 'ch-x', type: 'button', title: 'ne plus rien choisir (Échap)', onclick: () => { P.sel.clear(); peindreSel(); } }, '×')] : []);
}

/** Chaque carte de la scène : glissable (vers un Space, une playlist, une zone qui prend des sons),
 *  choisie ou non, et en vue « Tous » la pastille de son Space. */
export function carteSpace(card, s) {
  card.classList.toggle('sel', P.sel.has(s.id));
  card.draggable = true;
  card.addEventListener('dragstart', (e) => {
    if (e.target !== card) return;
    const ids = P.sel.has(s.id) ? ordreSel() : [s.id];
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData(CARD_MIME, JSON.stringify(ids));
    e.dataTransfer.setData(ITEM_MIME, JSON.stringify({ id: s.id, kind: s.kind, title: s.title, thumb_url: s.thumb_url }));
    e.dataTransfer.setData(MULTI_MIME, JSON.stringify(ids));
    if (ids.length > 1) {
      const g = el('div', { class: 'ch-ghost' }, nChansons(ids.length));
      document.body.append(g);
      e.dataTransfer.setDragImage(g, 14, 14);
      setTimeout(() => g.remove());
    }
    for (const id of ids) $(`.ch-song[data-id="${id}"]`)?.classList.add('drag');
  });
  card.addEventListener('dragend', () => { for (const c of $$('.ch-song.drag')) c.classList.remove('drag'); fermer(); });
  if (P.vue === TOUS) card.querySelector('.ch-meta')?.prepend(pastilleSpace(s.music_space), ' · ');
}
/** La pastille d'un Space (la vue « Tous ») : sa couleur, son nom — une carte, un projet ODIO. */
export function pastilleSpace(id) {
  const sp = byId(id || MON) || P.mine;
  return el('span', { class: 'ch-sp-tag', title: `Space : ${sp.name}` }, el('i', { style: { '--k': tint(sp) } }), sp.name);
}

// ── la tête de la scène : la barre de la sélection, « Importer » ──
function monterTete() {
  const head = $('.ch-head');
  if (!head) return;
  const inp = el('input', { type: 'file', accept: 'audio/*', multiple: true, hidden: true,
    onchange: async () => { const fs = [...inp.files]; inp.value = ''; if (fs.length) await importer(fs); } });
  const undo = head.querySelector('.sr-undo');
  head.insertBefore(el('span', { class: 'ch-selbar', id: 'ch-selbar', role: 'group', 'aria-label': 'les cartes choisies' }), undo);
  head.insertBefore(el('button', { class: 'tb ghost sm', type: 'button', id: 'ch-import', title: 'des sons du disque, rangés dans le Space choisi',
    onclick: () => inp.click() }, 'Importer'), undo);
  head.append(inp);
}

// ── naître dans le Space : importer, déposer une référence ──
const depot = (f, as) => api(`chanson/import?${new URLSearchParams({ name: f.name, title: f.name.replace(/\.[^.]+$/, ''), space: spaceCourant().id, as })}`,
  { method: 'PUT', raw: f, headers: { 'Content-Type': f.type || 'application/octet-stream' } });
/** Des sons du disque, chacun une carte du Space courant (sans recette). */
export async function importer(files) {
  const why = spaceWhy();
  if (why) { toast(why, 6000); return; }
  const sp = spaceCourant();
  let n = 0;
  for (const [i, f] of files.entries()) {
    toast(files.length > 1 ? `import ${i + 1} / ${files.length} · ${f.name}` : `import · ${f.name}`, 60000);
    try { await depot(f, 'son'); n++; } catch (e) { toast(`${f.name} : ${e.message}`, 6000); }
  }
  if (n) { toast(`${n > 1 ? `${n} sons importés` : 'un son importé'} dans « ${sp.name} »`, 4000); P.opt.reload?.(); }
}
/** Une référence son déposée (disque, glisser) : rangée dans la bibliothèque, dans le Space courant. */
export function deposerRef(f) {
  return depot(f, 'ref');
}
/** Une zone qui dépose elle-même les fichiers (commun/shell.js, dropZone) : ses fichiers passent par
 *  `onfile` (deposerRef) avant elle — ils naissent dans le Space courant ; les cartes glissées restent à elle. */
export function fichiersAuSpace(node, onfile) {
  node.addEventListener('drop', (e) => {
    const f = [...(e.dataTransfer?.files || [])];
    if (!f.length) return;
    e.preventDefault(); e.stopImmediatePropagation();
    node.classList.remove('drop-on');
    document.body.classList.remove('dropping');
    onfile(f[0]);
  }, true);
  return node;
}
