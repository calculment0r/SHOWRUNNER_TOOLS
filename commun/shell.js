// SHOWRUNNER TOOLS — ce que toutes les pages partagent : la liste des
// outils (une seule vérité pour l'accueil et l'en-tête), l'appel au
// serveur, l'en-tête, la file des rendus, le sélecteur d'éléments de la
// bibliothèque et le dépôt de fichiers.
//
// Les adresses sont relatives à la racine du portail, déduite de ce
// fichier : les pages marchent à la racine d'un serveur comme sous un
// sous-chemin (un jour derrière la porte Cloudflare).

// le thème (clair, sombre, le mien), la taille et les animations, posés
// avant que la page ne se dessine (commun/theme.js, préférences Général)
import { readLocal } from './theme.js';
// les copies d'affichage d'une image (thumb) : docs/etudes/ideation_fluidite.md
import { bind as bindView, pickView, needOf } from './proxies.js';
// le plein écran de la page : le bouton tout à droite de la barre, Ctrl+Maj+F (commun/pleinecran.js)
import { boutonPleinEcran, raccourci as raccourciPleinEcran } from './pleinecran.js';

export const ROOT = new URL('../', import.meta.url);
export const href = (p) => (p && /^https?:/.test(p) ? p : new URL(p || '', ROOT).href);
// La base de l'API : le portail lui-même, sauf si la page en déclare une autre.
const API = window.SR_API ? new URL(window.SR_API, location.href) : new URL('api/', ROOT);

// Deux espaces (docs/etudes/apps_studio_elements.md § 3, Cal le 29/09) :
// `tier: 'app'` (faire vite, seul) puis `tier: 'studio'` (les outils liés par
// les éléments) ; l'en-tête et l'accueil les rangent dans cet ordre. `open` :
// ouvert aux comptes sans Studio (la bibliothèque est commune).
export const TOOLS = [
  { id: 'image',     k: 'SR—01', name: 'Image',             path: 'image/',    sub: 'Z-Image · Qwen 2.1 · Krea 2 · édition', tier: 'app' },
  { id: 'movie',     k: 'SR—02', name: 'Vidéo',             path: 'movie/',    sub: 'image → vidéo · références → vidéo · banc', tier: 'app' },
  { id: 'upscale',   k: 'SR—09', name: 'Upscale',           path: 'upscale/',  sub: 'images · vidéos · netteté', tier: 'app' },
  // accroche Transcrire (29/09, docs/etudes/transcrire.md) : une app, côté Apps (tier, apps_studio_elements.md § 3.7)
  { id: 'transcrire', k: 'SR—10', name: 'Trans­crire',  path: 'transcrire/', sub: 'transcription · traduction · sous-titres', tier: 'app' },
  { id: 'chanson', k: 'SR—11', name: 'Musique', path: 'chanson/', sub: 'une chanson par prompt · reprise', tier: 'app' },
  { id: 'asset',     k: 'SR—00', name: 'Asset',             path: 'asset/',    sub: 'images · éléments · vidéos · sons', tier: 'studio', open: true },
  { id: 'music',     k: 'SR—06', name: 'ODIO',              path: 'musique/',  sub: 'studio musique · YuE · stems', tier: 'studio' },
  { id: 'montage',   k: 'SR—05', name: 'Montage',           path: 'montage/',  sub: 'timeline · découpe · export', tier: 'studio' },
  { id: 'ideation',  k: 'SR—08', name: 'Idéation',          path: 'ideation/', sub: 'canvas · planches · idées', tier: 'studio' },
  { id: 'character', k: 'SR—03', name: 'Character Factory', path: 'character/', sub: 'du visage au rig', tier: 'studio' },
  { id: 'object',    k: 'SR—04', name: 'Object Creator',    path: 'objet/',    sub: 'une image, des vues, un mesh', tier: 'studio' },
  { id: 'analyse',   k: 'SR—07', name: 'Movie Analysis',    path: 'analyse/',  sub: 'dépouillement · diarisation', tier: 'studio' },
];
// les pages du portail qui ne sont pas des outils (pas de carte à l'accueil)
const PAGES = { admin: { id: 'admin', k: 'SR—AD', name: 'Admin' } };

// ── le Workspace de l'onglet (docs/etudes/equipes_espaces.md § 4.3, § 4.4) ──
// Chaque onglet est dans UN Workspace : pris de `?e=esp-…` à l'ouverture, sinon
// de sessionStorage (l'onglet, pas le navigateur : deux onglets, deux Workspaces),
// sinon celui que le portail donne à la première lecture de /api/auth/me (le dernier
// de la personne, sinon Général), qui l'y fixe. `api()` le pose sur chaque requête
// (en-tête X-SR-Espace, que lit la porte : core/espaces.py, wanted) ; ce qui ne
// passe pas par api() — un flux SSE (EventSource), sendBeacon, un fetch ou un
// XMLHttpRequest à la main — prend `avecEspace(url)` (`?e=`, que la porte lit aussi)
// ou `enTeteEspace()`. Les médias (/library/…, les vignettes) n'en ont pas besoin :
// le portail les juge par l'objet (auth.can_read_item), pas par l'espace de la
// requête, et une même adresse garde son cache d'un espace à l'autre.
const ESP_RX = /^esp-[a-z0-9][a-z0-9-]{1,47}$/;   // core/espaces.py, SPACE_RX
const ESP_KEY = 'sr-espace', ESP_MSG = 'sr-espace-msg';
const ss = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch { /* stockage fermé : l'URL garde ?e= */ } },
};
let ESPACE = (() => {
  const q = new URLSearchParams(location.search).get('e');
  if (q && ESP_RX.test(q)) { ss.set(ESP_KEY, q); return q; }
  const s = ss.get(ESP_KEY);
  return s && ESP_RX.test(s) ? s : null;
})();
/** Le Workspace de l'onglet (`esp-…`), ou null tant que le portail ne l'a pas dit. */
export const espace = () => ESPACE;
/** Une adresse qui ne passe pas par api() (EventSource, sendBeacon, fetch à la main) : + `e=`. */
export function avecEspace(u) {
  if (!ESPACE) return u;
  const abs = new URL(u, location.href);
  if (!abs.searchParams.has('e')) abs.searchParams.set('e', ESPACE);
  return abs.href;
}
/** Les en-têtes d'un fetch ou d'un XMLHttpRequest fait à la main. */
export const enTeteEspace = () => (ESPACE ? { 'X-SR-Espace': ESPACE } : {});
function fixeEspace(id) { ESPACE = id || null; ss.set(ESP_KEY, ESPACE); }
// Un Workspace qu'on ne voit pas (plus) : le portail le refuse (403 sur une route protégée,
// `workspace_refused` dans /api/auth/me). On l'oublie, et la page repart dans celui que le
// portail donne — rechargée, pour qu'aucune liste ne reste d'un espace et l'en-tête d'un autre.
let oubli = false;
function oublieEspace(id) {
  if (oubli || !id || id !== ESPACE) return;
  oubli = true;
  fixeEspace(null);
  ss.set(ESP_MSG, 'ce Workspace n’est pas (ou plus) pour toi : retour à ton Workspace habituel');
  const u = new URL(location.href);
  u.searchParams.delete('e');
  location.replace(u.href);
}
// L'outil qui sait recharger ses listes sans quitter la page (un document ouvert reste
// ouvert, dans son espace) : surEspace(cb) ; sans lui, changer de Workspace recharge la page.
const espaceCbs = new Set();
export function surEspace(cb) { espaceCbs.add(cb); return () => espaceCbs.delete(cb); }
// Un document ouvert dit toujours son espace (§ 4.3) : l'outil le déclare, l'en-tête le montre
// quand ce n'est pas le Workspace de l'onglet. null : plus de document.
let docEspace = null;
export function espaceDocument(id) { docEspace = id && ESP_RX.test(id) ? id : null; paintEspace(); }

// ── la porte (core/auth.py, commun/porte.js) ────────────────
// qui je suis : { auth, state: anonymous | pending | active | refused | suspended, user,
//   teams, workspace, workspace_refused } — les Teams et le Workspace : core/espaces.py, me_payload
let meP = null;
let doorOn = false;
// La dernière réponse de /api/auth/me, gardée pour l'ONGLET (sessionStorage) : la page suivante
// dessine son en-tête (le compte, le Workspace, les outils fermés) dès sa première image, sans
// attendre le portail — changer d'outil ne fait plus clignoter la barre ; la réponse fraîche la
// corrige ensuite. Rien n'en dépend côté droits : le serveur juge chaque requête.
const ME_KEY = 'sr-me';
const lu = (k) => { try { return JSON.parse(ss.get(k) || 'null'); } catch { return null; } };
let lastMe = lu(ME_KEY);
// entré dans cet onglet (ou la maison sans porte) : la page n'a pas à se cacher en attendant la porte
const entre = (me) => !!(me && (!me.auth || me.state === 'active'));
export const session = (fresh = false) => {
  if (!meP || fresh) {
    meP = api('auth/me').catch(() => null).then((me) => {
      if (me && me.user) {
        if (me.workspace_refused && me.workspace_refused === ESPACE) oublieEspace(ESPACE);
        // l'onglet se fixe au Workspace que donne le portail : un changement fait dans un
        // autre onglet (le « dernier » de la personne) ne le déplace plus
        else if (!ESPACE && me.workspace && me.workspace.id) fixeEspace(me.workspace.id);
      }
      lastMe = me;
      ss.set(ME_KEY, me ? JSON.stringify(me) : null);
      paintEspace();
      return me;
    });
  }
  return meP;
};
export function showDoor(me) {
  if (doorOn) return;
  doorOn = true;
  import('./porte.js').then((m) => m.door(me));
}

// ── DOM ─────────────────────────────────────────────────────
export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    // Object.assign ne pose pas les variables CSS (--k) : setProperty les prend
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) {
        if (val === null || val === undefined) continue;
        if (p.startsWith('--')) n.style.setProperty(p, val); else n.style[p] = val;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(9)) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ── le clic droit : jamais le menu du navigateur ────────────
// Cal, 29/09 : « d'une façon générale ne plus avoir de clic droit du
// navigateur partout dans nos outils. on a un menu contextuel dédié à où on
// se trouve au survol. » Toute page du portail importe ce module. Sauf dans
// un champ de texte (copier, coller, l'orthographe : natifs) ou sous
// [data-native-menu], le menu du navigateur n'apparaît jamais :
//   - une zone qui a son menu (commun/menu.js, contextMenu, ou son propre
//     gestionnaire) appelle preventDefault : on l'entend (à la capture, sur
//     window, avant toute zone, on écoute ses appels), et on s'efface ;
//   - personne ne l'a fait : le menu du navigateur est empêché au bout du
//     chemin (window, à la remontée), ou dès qu'une zone arrête la remontée
//     sans l'empêcher, et le menu de repli s'ouvre (menu.js, fallbackMenu).
// Une zone lit donc `e.defaultPrevented` comme d'habitude : vrai seulement si
// une autre zone a pris l'événement.
const NATIVE_TYPES = new Set(['', 'text', 'search', 'url', 'email', 'password', 'tel', 'number']);
function nativeMenuZone(n) {
  if (!(n instanceof Element)) return false;
  if (n.closest('[data-native-menu]') || n.isContentEditable || n.tagName === 'TEXTAREA') return true;
  return n.tagName === 'INPUT' && NATIVE_TYPES.has((n.getAttribute('type') || '').toLowerCase());
}
const BLOCK = Event.prototype.preventDefault;
addEventListener('contextmenu', (e) => {
  if (nativeMenuZone(e.target)) return;
  let zone = false;
  e.preventDefault = function preventDefault() { zone = true; return BLOCK.call(this); };
  // une zone qui arrête la remontée sans rien empêcher : le repli prend sa place
  for (const k of ['stopPropagation', 'stopImmediatePropagation']) {
    const f = Event.prototype[k];
    e[k] = function stop() { if (!this.defaultPrevented) BLOCK.call(this); return f.call(this); };
  }
  const kb = e.button !== 2 && e.clientX === 0 && e.clientY === 0;
  let x = e.clientX, y = e.clientY;
  if (kb && e.target instanceof Element) { const r = e.target.getBoundingClientRect(); x = r.left + 8; y = r.bottom - 4; }
  // après toutes les zones (celles qui se posent sur window après ce module comprises)
  setTimeout(() => { if (!zone) import('./menu.js').then((m) => m.fallbackMenu(e, x, y, kb)); }, 0);
}, true);
addEventListener('contextmenu', (e) => {
  if (!e.defaultPrevented && !nativeMenuZone(e.target)) BLOCK.call(e);
});

// ── le panneau Asset commun (commun/dock.js, docs/etudes/panneau_asset.md) ──
// La bibliothèque à gauche de chaque outil, sous la barre : elle pousse la page.
// `mountHeader` la monte (le bouton ASSET tout à gauche de la barre) ; ici, ce
// qui doit exister avant qu'elle ne soit chargée : la façade `dock` (un appel
// fait trop tôt attend le panneau), le registre des zones qui prennent un asset
// (`declareZone` ; `dropZone` s'y inscrit seul), la sorte effective, le raccourci.
//
//   dock.configure({ place, clickPlaces, placeLabel, menu, kinds, label, dockMin, hint, upload, fiche })
//   dock.contexte({ kinds, label, why }) · dock.contexte(null)     les filtres de la zone active
//   dock.open({ focus }) · close() · toggle() · isOpen() · closed() · reload() · recent(items)
//   declareZone(node, { kinds, label }) → de quoi la retirer
// Le détail de chaque option : l'en-tête de commun/dock.js.
const DOCK = { page: null, on: false, cfg: {}, ctx: null, zones: new Set(), mod: null, wait: [] };
export const dockState = () => DOCK;   // pour commun/dock.js seulement
const withDock = (fn) => { if (DOCK.mod) fn(DOCK.mod); else if (DOCK.page) DOCK.wait.push(fn); };
export const dock = {
  configure(o = {}) { Object.assign(DOCK.cfg, o); DOCK.mod?.refresh(); return dock; },
  contexte(c = null) {
    const next = c && Array.isArray(c.kinds) ? { kinds: [...c.kinds], label: String(c.label || ''), why: String(c.why || '') } : null;
    if (JSON.stringify(next) === JSON.stringify(DOCK.ctx)) return;
    DOCK.ctx = next;
    DOCK.mod?.contexte();
  },
  open(o) { withDock((m) => m.open(o)); },
  close() { withDock((m) => m.close()); },
  toggle(o) { withDock((m) => m.toggle(o)); },
  isOpen: () => !!DOCK.mod?.isOpen(),
  // monté, et fermé (un menu propose alors de l'ouvrir) ; faux pour qui n'a pas le panneau (l'invité)
  closed: () => DOCK.on && !!DOCK.mod && !DOCK.mod.isOpen(),
  reload() { DOCK.mod?.reload(); },
  recent(items) { if (items?.length) withDock((m) => m.recent(items)); },
};
export function declareZone(node, { kinds = [], label = '' } = {}) {
  const z = { node, kinds: [...kinds], label };
  DOCK.zones.add(z);
  DOCK.mod?.zones();
  return () => { DOCK.zones.delete(z); DOCK.mod?.zones(); };
}
// La sorte effective d'un objet (sa jumelle : server/tools/asset.py, sorte_effective) : `kind`, sauf
// l'élément versionné, qui vaut la sorte de sa dernière version (une chanson d'ODIO est un son)
export const sorteEffective = (it) => (it?.kind === 'element' ? it.element?.head_kind || 'element' : it?.kind || '');
// Le raccourci en vigueur (Préférences → Général, commun/prefs.json : dockKey), pour les bulles
export function dockKeyLabel() {
  const k = readLocal().general?.dockKey || 'ctrl-space';
  return { 'ctrl-space': 'Ctrl+Espace', backquote: '²', both: 'Ctrl+Espace ou ²', none: '' }[k] ?? 'Ctrl+Espace';
}
// Un seul écouteur, à la capture sur window : il passe avant ceux des outils (ODIO, Idéation et
// Transcrire prennent Espace sans regarder Ctrl) et arrête l'événement — Ctrl+Espace est réservé
// au panneau, aucun outil n'en voit l'Espace (ni la lecture d'ODIO, ni la main d'Idéation). Une
// saisie IME en cours (isComposing) passe son chemin ; ² (la touche sous Échap, `code` Backquote,
// juste en AZERTY comme en QWERTY) ne se prend jamais dans un champ de texte ; une fenêtre (.scrim)
// garde le clavier. Le clavier d'une fenêtre détachée (commun/fenetre.js) arrive ici aussi.
const typingIn = (t) => !!(t instanceof Element && (t.isContentEditable || t.closest('input, textarea, select, [contenteditable]')));
addEventListener('keydown', (e) => {
  if (!DOCK.page || e.isComposing || e.keyCode === 229) return;
  const bare = !e.altKey && !e.metaKey && !e.shiftKey;
  const ctrlSpace = e.code === 'Space' && e.ctrlKey && bare;
  const quote = e.code === 'Backquote' && !e.ctrlKey && bare && !typingIn(e.target);
  if (!ctrlSpace && !quote) return;
  const k = readLocal().general?.dockKey || 'ctrl-space';
  const wanted = (ctrlSpace && (k === 'ctrl-space' || k === 'both')) || (quote && (k === 'backquote' || k === 'both'));
  // une fenêtre OUVERTE : une .scrim cachée (Movie Analysis garde la sienne, hidden) ne compte pas
  const modal = !!document.querySelector('.scrim:not([hidden])');
  if (quote && (!wanted || !DOCK.on || modal)) return;   // ² reste alors une touche comme une autre
  e.preventDefault();
  e.stopImmediatePropagation();
  if (wanted && !e.repeat && DOCK.on && !modal) dock.toggle({ focus: true });
}, true);

let toastT;
export function toast(msg, ms = 3200) {
  let t = $('.toast');
  if (!t) { t = el('div', { class: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), ms);
}

export const fmtDur = (s) => {
  if (s === null || s === undefined || isNaN(s)) return '';
  s = Math.max(0, s);
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(r < 10 && m === 0 ? 1 : 0)}`;
};
export const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

// ── serveur ─────────────────────────────────────────────────
// `espace` : le Workspace de cette requête — par défaut celui de l'onglet ; un document ouvert
// passe le sien (il ne change pas d'espace parce que l'en-tête change) ; null : aucun.
export async function api(path, { method = 'GET', body, raw, headers = {}, signal, espace: esp = ESPACE } = {}) {
  const opts = { method, headers: { ...headers }, signal };
  if (esp && !Object.keys(opts.headers).some((k) => k.toLowerCase() === 'x-sr-espace')) opts.headers['X-SR-Espace'] = esp;
  if (raw !== undefined) opts.body = raw;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(new URL(path.replace(/^\/?(api\/)?/, ''), API), opts);
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = { error: txt.slice(0, 300) }; }
  if (!r.ok) {
    // plus de session (retirée, suspendue, jamais ouverte) : la porte
    if (r.status === 401 && !/^\/?(api\/)?auth\//.test(path)) showDoor();
    // le Workspace de l'onglet refusé (on n'y est plus) : la porte le dit dans /api/auth/me
    if (r.status === 403 && esp && esp === ESPACE && !oubli) {
      api('auth/me', { espace: esp }).then((me) => { if (me && me.workspace_refused === esp) oublieEspace(esp); }).catch(() => {});
    }
    const e = new Error((data && data.error) || `${r.status} ${r.statusText}`);
    e.status = r.status;
    throw e;
  }
  return data;
}

// Un fichier vers la bibliothèque. Ce que quelqu'un dépose de son disque
// garde `tool: 'upload'` (la catégorie « Upload » d'Asset, pour le distinguer
// de ce que les outils fabriquent) et dit par où il est entré (`via`). Un
// outil qui range sa propre création (un mixage exporté…) passe son nom. Il entre dans le
// Workspace de l'onglet (api()), ou dans `espace` (celui du document ouvert).
export async function uploadFile(file, { tool = 'upload', via = '', folder = '', title = '', espace: esp = ESPACE } = {}) {
  const q = new URLSearchParams({ name: file.name, tool, via, folder, title: title || file.name.replace(/\.[^.]+$/, '') });
  return api('library/upload?' + q, { method: 'PUT', raw: file, espace: esp, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
}

// ── glisser un asset d'un endroit à l'autre ─────────────────
// Une vignette glissée porte l'objet sous ce type ; tout emplacement
// `dropZone` l'accepte, comme un fichier venu du disque.
export const ITEM_MIME = 'application/x-sr-item';
// plusieurs objets d'un coup (le chutier du Montage, le panneau Asset) : leurs ids, en plus
// d'ITEM_MIME (le premier) que toute zone comprend
export const MULTI_MIME = 'application/x-sr-items';
// un personnage de Character Factory pas encore importé ({slug, imported}) : la planche d'Idéation
// l'importe au dépôt (ideation/canvas.js) ; déjà importé, le panneau Asset le glisse en ITEM_MIME
export const CF_MIME = 'application/x-sr-cf';
// un objet d'un autre Workspace : le type vide `application/x-sr-space-<espace>` s'ajoute au glisser
// (panneau_asset.md § 5) — il se lit au survol, quand le contenu ne se lit pas encore
export const SPACE_MIME = 'application/x-sr-space-';

// Un objet d'un autre Workspace (it.space ≠ celui de l'onglet) ne se pose jamais tel quel : il est
// d'abord rapatrié — une copie neuve dans le Workspace de l'onglet, jamais un lien vivant
// (POST /api/espaces/<courant>/rapatrier, server/tools/equipes.py ; equipes_espaces.md, étape 5) —
// et l'outil reçoit la copie, à la place de l'original, dans le même ordre. Tout ou rien : un refus
// (un viewer, un élément versionné, une séquence) lève l'erreur du portail, qui dit pourquoi.
export async function rapatrier(items) {
  const here = ESPACE;
  const away = (items || []).filter((it) => it && it.id && it.space && here && it.space !== here);
  if (!away.length) return items;
  const ids = [...new Set(away.map((it) => it.id))];
  const r = await api(`espaces/${here}/rapatrier`, { method: 'POST', body: { items: ids } });
  const made = r.items || [];
  // chaque copie dit d'où elle vient (origin.from.item) ; sinon, l'ordre des ids
  const copy = new Map(ids.map((id, i) => [id, made.find((x) => x?.origin?.from?.item === id) || made[i]]));
  toast(ids.length > 1 ? `${ids.length} assets copiés dans ce Workspace` : `copié dans ce Workspace : ${made[0]?.title || ids[0]}`);
  return items.map((it) => (it && copy.get(it.id)) || it);
}
export function dragItem(node, it) {
  node.draggable = true;
  node.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData(ITEM_MIME, JSON.stringify({ id: it.id, kind: it.kind, title: it.title, thumb_url: it.thumb_url }));
    if (it.url) e.dataTransfer.setData('text/uri-list', href(it.url));
  });
  return node;
}
const EXT_KIND = { png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', mp4: 'video', webm: 'video', mov: 'video', m4v: 'video',
  wav: 'audio', mp3: 'audio', flac: 'audio', m4a: 'audio', ogg: 'audio' };
const kindOfFile = (f) => EXT_KIND[(f.name.split('.').pop() || '').toLowerCase()] || null;

// Tout bloc qui attend un asset accepte un dépôt : un fichier du disque (il
// entre dans la bibliothèque, catégorie Upload) ou une vignette glissée
// d'ailleurs dans le portail. onitems(objets) reçoit des objets complets de la
// bibliothèque, déjà filtrés par `kinds` (un élément compte pour une image
// quand `kinds` prend 'element'). La zone s'inscrit au registre du panneau
// Asset (declareZone) : ses `kinds` font les filtres du panneau dans l'outil.
// Un élément versionné lâché là où l'on attend la sorte de sa dernière version
// (un son, pour une chanson d'ODIO) y pose cette dernière version.
export function dropZone(node, { kinds = ['image', 'element'], multiple = true, via = '', label = '', onitems = () => {} } = {}) {
  declareZone(node, { kinds, label: label || via });
  let depth = 0;
  const wants = (e) => { const t = e.dataTransfer?.types || []; return t.includes('Files') || t.includes(ITEM_MIME); };
  // un dépôt dans une zone intérieure ne passe pas par la zone qui la contient :
  // chaque zone se remet à zéro à tout dépôt ou fin de glisser, où qu'il ait lieu
  const reset = () => { depth = 0; node.classList.remove('drop-on'); };
  addEventListener('drop', reset, true);
  addEventListener('dragend', reset, true);
  node.addEventListener('dragenter', (e) => { if (!wants(e)) return; depth++; node.classList.add('drop-on'); });
  node.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; node.classList.remove('drop-on'); } });
  node.addEventListener('dragover', (e) => { if (wants(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  node.addEventListener('drop', async (e) => {
    if (!wants(e)) return;
    e.preventDefault(); e.stopPropagation();
    depth = 0; node.classList.remove('drop-on'); document.body.classList.remove('dropping');
    const got = [];
    const raw = e.dataTransfer.getData(ITEM_MIME);
    let many = [];
    try { many = JSON.parse(e.dataTransfer.getData(MULTI_MIME) || '[]'); } catch { many = []; }
    // lus où qu'ils soient (`spaces=*` : montrer) ; d'un autre Workspace, ils seront rapatriés plus bas
    if (multiple && Array.isArray(many) && many.length > 1) {
      try { got.push(...(await api('library/batch', { method: 'POST', body: { ids: many.map(String), spaces: '*' } })).items); } catch (err) { toast(err.message); }
    } else if (raw) {
      try { got.push(await api('library/' + JSON.parse(raw).id + '?spaces=*')); } catch (err) { toast(err.message); }
    }
    for (let i = 0; i < got.length; i++) {
      const it = got[i];
      if (it.kind === 'element' && !kinds.includes('element') && kinds.includes(sorteEffective(it)) && it.element?.head_item) {
        try { got[i] = await api('library/' + it.element.head_item + '?spaces=*'); } catch { /* la dernière version n'est plus là : l'élément sera refusé */ }
      }
    }
    const gone = got.filter((it) => !kinds.includes(it.kind));
    if (gone.length) toast(`pas pris ici : ${gone.map((it) => it.title || it.id).join(', ')} (attendu : ${kinds.map(kindFr).join(', ')})`);
    let files = [...(e.dataTransfer.files || [])];
    const refused = files.filter((f) => !kinds.includes(kindOfFile(f)));
    files = files.filter((f) => kinds.includes(kindOfFile(f)));
    if (!multiple) files = files.slice(0, 1);
    for (let i = 0; i < files.length; i++) {
      toast(files.length > 1 ? `dépôt ${i + 1} / ${files.length} · ${files[i].name}` : `dépôt · ${files[i].name}`, 60000);
      try { got.push(await uploadFile(files[i], { tool: 'upload', via })); } catch (err) { toast(`${files[i].name} : ${err.message}`); }
    }
    if (refused.length) toast(`pas pris ici : ${refused.map((f) => f.name).join(', ')} (attendu : ${kinds.map(kindFr).join(', ')})`);
    else if (files.length) toast(files.length > 1 ? `${files.length} fichiers rangés dans la bibliothèque · Upload` : 'rangé dans la bibliothèque · Upload');
    const ok = got.filter((it) => kinds.includes(it.kind));
    if (ok.length) {
      let used = multiple ? ok : ok.slice(0, 1);
      // d'un autre Workspace : la copie d'ici, à sa place (sinon l'outil ne le trouverait pas) ; un refus dit pourquoi
      try { used = await rapatrier(used); } catch (err) { toast(err.message, 7000); return; }
      onitems(used);
      dock.recent(used);   // les Récents du panneau Asset : ce qu'on a posé ou déposé
    }
  });
  return node;
}

// ── la file ─────────────────────────────────────────────────
const listeners = new Set();
let lastJobs = [];
let pollT = null;
export const jobs = {
  async submit(kind, params, { title = '', tool = '' } = {}) {
    const j = await api('jobs', { method: 'POST', body: { kind, params, title, tool } });
    jobs.poll(true);
    return j;
  },
  get: (id) => api('jobs/' + id),
  cancel: (id) => api(`jobs/${id}/cancel`, { method: 'POST' }).then((j) => (jobs.poll(true), j)),
  retry: (id) => api(`jobs/${id}/retry`, { method: 'POST' }).then((j) => (jobs.poll(true), j)),
  forget: (id) => api(`jobs/${id}/forget`, { method: 'POST' }).then(() => jobs.poll(true)),
  // cb(liste) à chaque relevé ; renvoie de quoi se désabonner
  watch(cb) { listeners.add(cb); if (lastJobs.length) cb(lastJobs); jobs.poll(true); return () => listeners.delete(cb); },
  async poll(now = false) {
    clearTimeout(pollT);
    const go = async () => {
      if (doorOn) return;   // la porte est fermée : on ne relit rien
      try {
        const { jobs: list } = await api('jobs?limit=60');
        const before = new Map(lastJobs.map((j) => [j.id, j.state]));
        lastJobs = list;
        for (const cb of listeners) cb(list);
        for (const j of list) {
          const was = before.get(j.id);
          if (was && was !== j.state && ['done', 'error', 'cancelled'].includes(j.state)) {
            document.dispatchEvent(new CustomEvent('sr:job', { detail: j }));
          }
        }
      } catch { /* le serveur redémarre : on réessaie */ }
      const active = lastJobs.some((j) => j.state === 'queued' || j.state === 'running');
      pollT = setTimeout(go, active ? 1500 : 6000);
    };
    if (now) go(); else pollT = setTimeout(go, 1500);
  },
  // attend la fin d'un travail ; onTick(job) à chaque relevé
  async wait(id, onTick) {
    for (;;) {
      const j = await api('jobs/' + id);
      if (onTick) onTick(j);
      if (['done', 'error', 'cancelled', 'interrupted'].includes(j.state)) return j;
      await new Promise((r) => setTimeout(r, 1200));
    }
  },
};

const STATE_FR = { queued: 'en file', running: 'en cours', done: 'fini', error: 'échec', cancelled: 'arrêté', interrupted: 'interrompu' };
export const stateFr = (s) => STATE_FR[s] || s;

// ── l'en-tête ───────────────────────────────────────────────
let sysInfo = null;
export async function system() {
  if (!sysInfo) sysInfo = api('system').catch(() => null);
  return sysInfo;
}
export function toolHref(t, sys) {
  // le studio (la page des personnages), pas la page d'état à la racine du site
  if (t.external === 'cf') return ((sys && sys.cf_studio && sys.cf_studio.url) || 'http://192.168.10.247:8765/') + 'studio.html';
  // `?e=` : ouvert dans un nouvel onglet (clic du milieu), l'outil reste dans ce Workspace
  return avecEspace(href(t.path));
}

// ── le sélecteur de Workspace (en haut à gauche, à côté du logotype) ──
// « TEAM / WORKSPACE » en capitales mono (mots de Cal, 30/09) ; le menu : ses Teams et
// leurs Workspaces tels que le portail les rend (/api/auth/me → teams : un guest n'y a
// que les siens, par construction), « + Nouveau Workspace » dans une Team qu'on gère,
// « Réglages de la Team » (admin/#teams). Discret : il ne prend la couleur qu'au survol.
const WS_ROLE = { admin: 'admin', editor: 'éditeur', commenter: 'commentateur', viewer: 'viewer' };
let wsMenu = null;
function espaceCourant(me = lastMe) {
  if (!me || !Array.isArray(me.teams)) return null;
  for (const t of me.teams) for (const s of t.spaces || []) if (s.id === ESPACE) return { t, s };
  const w = me.workspace;
  return w ? { t: { name: w.team_name, id: w.team }, s: w } : null;
}
function nomEspace(id, me = lastMe) {
  for (const t of (me && me.teams) || []) for (const s of t.spaces || []) if (s.id === id) return `${t.name} / ${s.name}`;
  return id;
}
function paintEspace() {
  const box = document.getElementById('sr-ws');
  if (!box) return;
  const cur = espaceCourant();
  box.hidden = !cur;
  if (!cur) return;
  const btn = box.querySelector('.sr-ws-btn');
  btn.querySelector('.tm').textContent = cur.t.name || '';
  btn.querySelector('.ws').textContent = cur.s.name || '';
  const doc = docEspace && docEspace !== ESPACE ? nomEspace(docEspace) : '';
  btn.title = `Team ${cur.t.name} · Workspace ${cur.s.name}${cur.s.role ? ` · ${WS_ROLE[cur.s.role] || cur.s.role}` : ''}`
    + (doc ? `\nle document ouvert est dans ${doc}` : '') + '\nchanger de Workspace';
  const note = box.querySelector('.doc');
  note.hidden = !doc;
  note.textContent = doc ? `document · ${doc}` : '';
  // les liens de l'en-tête gardent le Workspace de l'onglet (ouverts dans un nouvel onglet compris)
  for (const a of ESPACE ? document.querySelectorAll('.hdr a.logo, .hdr #sr-admin, .hdr .tools a, .hdr .tools-menu a') : []) {
    const u = new URL(a.href, location.href);
    if (u.origin !== ROOT.origin || u.searchParams.get('e') === ESPACE) continue;
    u.searchParams.set('e', ESPACE);
    a.href = u.href;
  }
  if (wsMenu) paintMenu();
}
function closeWsMenu() {
  wsAdd = null;
  if (!wsMenu) return;
  wsMenu.remove();
  wsMenu = null;
  document.removeEventListener('pointerdown', wsOutside, true);
  document.removeEventListener('keydown', wsKey, true);
  const b = document.querySelector('#sr-ws .sr-ws-btn');
  if (b) b.setAttribute('aria-expanded', 'false');
}
function wsOutside(e) { if (wsMenu && !wsMenu.contains(e.target) && !e.target.closest('#sr-ws')) closeWsMenu(); }
function wsKey(e) {
  if (!wsMenu || (e.target instanceof Element && e.target.closest('.sr-ws-add'))) return;   // la saisie a ses touches
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeWsMenu(); document.querySelector('#sr-ws .sr-ws-btn')?.focus(); return; }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...wsMenu.querySelectorAll('[role^="menuitem"]')];
  if (!items.length) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement);
  items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
}
function openWsMenu(btn) {
  if (wsMenu) return closeWsMenu();
  wsMenu = el('div', { class: 'sr-ws-menu', role: 'menu', 'aria-label': 'Teams et Workspaces' });
  document.body.append(wsMenu);
  paintMenu();
  const r = btn.getBoundingClientRect();
  wsMenu.style.top = `${r.bottom + 6}px`;
  wsMenu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - wsMenu.offsetWidth - 8))}px`;
  btn.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', wsOutside, true);
  document.addEventListener('keydown', wsKey, true);
  (wsMenu.querySelector('[aria-checked="true"]') || wsMenu.querySelector('[role^="menuitem"]'))?.focus();
  session(true);   // la liste fraîche (un Workspace créé ailleurs) : repeinte à l'arrivée
}
let wsAdd = null;   // la ligne « nouveau Workspace » ouverte : { tid, v }
function paintMenu() {
  const me = lastMe;
  if (!wsMenu || !me) return;
  const inp = wsMenu.querySelector('.sr-ws-add input');
  const focus = !!inp && document.activeElement === inp;
  const rows = [];
  for (const t of me.teams || []) {
    if (t.archived) continue;
    const spaces = (t.spaces || []).filter((s) => !s.archived || s.id === ESPACE);
    if (!spaces.length && !t.manage) continue;
    const role = t.role === 'guest' ? `guest · ${t.guest || 'viewer'}` : t.personal ? '' : ({ owner: 'propriétaire', admin: 'admin', member: 'membre' }[t.role] || '');
    rows.push(el('div', { class: 'sr-ws-team' }, el('span', { class: 'n' }, t.name), role ? el('span', { class: 'r' }, role) : null));
    for (const s of spaces) {
      const on = s.id === ESPACE;
      const lim = s.can && !s.can.edit ? (WS_ROLE[s.role] || s.role || 'lecture') : '';
      rows.push(el('button', { class: 'sr-ws-item' + (on ? ' on' : ''), type: 'button', role: 'menuitemradio', 'aria-checked': on ? 'true' : 'false',
        title: lim && s.why && s.why.edit ? s.why.edit : null, 'data-ws': s.id, onclick: () => changeEspace(s.id) },
      el('span', { class: 'n' }, s.name), s.archived ? el('span', { class: 'r' }, 'archivé') : lim ? el('span', { class: 'r' }, lim) : null));
    }
    // créer un Workspace : qui gère la Team (core/espaces.py, create_space) ; les autres n'ont pas la ligne
    if (t.manage) {
      rows.push(wsAdd && wsAdd.tid === t.id ? addRow(t) : el('button', { class: 'sr-ws-item sr-ws-new', type: 'button', role: 'menuitem', 'data-team': t.id,
        onclick: () => { wsAdd = { tid: t.id, v: '' }; paintMenu(); wsMenu.querySelector('.sr-ws-add input')?.focus(); } },
      el('span', { class: 'n' }, '+ Nouveau Workspace')));
    }
  }
  if (me.teams_error) rows.push(el('p', { class: 'why' }, me.teams_error));
  rows.push(el('div', { class: 'sr-ws-foot' },
    el('a', { class: 'tb ghost sm', role: 'menuitem', href: avecEspace(href('admin/#teams')) }, 'Réglages de la Team')));
  wsMenu.replaceChildren(...rows);
  if (focus) wsMenu.querySelector('.sr-ws-add input')?.focus();
}
function addRow(t) {
  const inp = el('input', { class: 'fld', maxlength: 40, placeholder: 'nom du Workspace', 'aria-label': `le nom du nouveau Workspace de ${t.name}`,
    oninput: () => { wsAdd.v = inp.value; } });
  inp.value = wsAdd.v || '';
  const err = el('p', { class: 'why', hidden: true });
  const go = el('button', { class: 'tb ghost sm', type: 'submit' }, 'Créer');
  const f = el('form', { class: 'sr-ws-add', onsubmit: async (e) => {
    e.preventDefault();
    const name = inp.value.trim();
    if (!name) { err.hidden = false; err.textContent = 'un nom, d’abord'; inp.focus(); return; }
    go.disabled = true;
    try {
      const sp = await api(`equipes/${t.id}/espaces`, { method: 'POST', body: { name } });
      await changeEspace(sp.id);
    } catch (x) { go.disabled = false; err.hidden = false; err.textContent = x.message; }
  } }, inp, go, err);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); wsAdd = null; paintMenu(); wsMenu?.querySelector(`.sr-ws-new[data-team="${t.id}"]`)?.focus(); }
  });
  return f;
}
// Changer : le portail le retient (le « dernier » de la personne : un nouvel onglet s'y ouvre),
// l'onglet le prend ; l'outil recharge ses listes (surEspace), sinon la page se recharge
// — l'adresse garde son #document : un document rouvert dit son espace.
async function changeEspace(id) {
  if (id === ESPACE) return closeWsMenu();
  try { await api('espaces/courant', { method: 'POST', body: { workspace: id } }); } catch (e) { toast(e.message); return; }
  fixeEspace(id);
  closeWsMenu();
  const u = new URL(location.href);
  u.searchParams.set('e', id);
  if (espaceCbs.size) {
    // l'adresse suit (un ?e= resté d'avant l'emporterait au rechargement)
    history.replaceState(history.state, '', u.href);
    await session(true);
    for (const cb of espaceCbs) { try { cb(id); } catch (e) { console.error('surEspace', e); } }
    DOCK.mod?.reload();
    jobs.poll(true);
    toast(`Workspace · ${nomEspace(id)}`);
    return;
  }
  location.replace(u.href);
}

// `dock: false` : une page d'outil sans le panneau Asset (les pages hors outils, Admin, ne l'ont jamais)
//
// La barre est ENTIÈRE dès sa pose (Cal, 30/09 : « quand je change d'atelier, toute la page se repeint
// et ça clignote ») : les outils sont une liste fixe (TOOLS), le compte, le Workspace, les outils fermés
// et l'état des machines viennent de la dernière réponse gardée pour l'onglet ; les réponses fraîches
// ne font que la corriger. La page monte l'en-tête dans son module, que le <head> charge
// render-blocking (<script type="module" blocking="render">) : il est dans la première peinture, et
// la transition entre pages (commun/shell.css, @view-transition) le garde immobile.
// Un deuxième appel rend la barre déjà posée (un <head> peut la monter avant le script de la page).
let HDR = null;
export function mountHeader(toolId, { sub = '', dock: useDock = true } = {}) {
  if (HDR && HDR.isConnected) return HDR;
  // la page reste cachée le temps de savoir qui entre (3 s au plus) — sauf si l'onglet est déjà entré
  if (!entre(lastMe)) {
    document.documentElement.classList.add('sr-wait');
    setTimeout(() => document.documentElement.classList.remove('sr-wait'), 3000);
  }
  const t = TOOLS.find((x) => x.id === toolId) || PAGES[toolId];
  document.documentElement.dataset.srTool = toolId;   // le menu de repli ouvre les préférences de l'outil
  // le panneau Asset (commun/dock.js) : son bouton tout à gauche de la barre, au-dessus du panneau
  // qu'il ouvre (Resolve : le Media Pool, premier bouton de sa barre ; panneau_asset.md § 2.2)
  DOCK.page = useDock && TOOLS.some((x) => x.id === toolId) ? toolId : null;
  const dockBtn = DOCK.page ? el('button', { class: 'tb ghost sm sr-dock-btn', id: 'sr-dock-btn', type: 'button',
    'aria-controls': 'sr-dock', 'aria-pressed': 'false', title: 'la bibliothèque', onclick: () => dock.toggle({ focus: true }),
    html: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M9.5 4.5v15"/></svg><span>Asset</span>' }) : null;
  const nav = el('nav', { class: 'tools' });
  const hdr = el('header', { class: 'hdr' },
    dockBtn,
    el('a', { class: 'logo', href: avecEspace(href('')), title: 'le portail' },
      el('span', { class: 'sq' }, el('i')),
      el('span', {}, el('b', {}, 'Nirvalab'))),
    // la Team et le Workspace de l'onglet (caché tant que le portail ne les a pas dits)
    el('div', { class: 'sr-ws', id: 'sr-ws', hidden: true },
      el('button', { class: 'sr-ws-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
        onclick: (e) => openWsMenu(e.currentTarget) },
      el('span', { class: 'tm' }), el('span', { class: 'sl', 'aria-hidden': 'true' }, '/'), el('span', { class: 'ws' }),
      el('i', { class: 'cv', 'aria-hidden': 'true', html: '<svg viewBox="0 0 12 12"><path d="M3 4.5 6 7.5 9 4.5"/></svg>' })),
      el('span', { class: 'doc', hidden: true })),
    t ? el('span', { class: 'tool-name' }, el('span', { class: 'k' }, t.k), el('b', {}, t.name),
      sub ? el('span', { class: 'lbl' }, sub) : null) : null,
    nav,
    el('span', { class: 'sp' }),
    // (le bouton Asset d'en haut à droite est parti le 30/09 : le panneau s'ouvre tout à gauche,
    // la page Asset plein écran se joint par « ↗ » en tête du panneau et par l'accueil)
    el('span', { class: 'pill', id: 'sr-sys', title: 'les machines' }, el('i'), el('span', {}, 'machines')),
    el('a', { class: 'tb ghost sm', id: 'sr-admin', href: href('admin/'), hidden: true, title: 'la page de Cal' }, 'Admin'),
    el('button', { class: 'tb ghost sm', id: 'sr-me', hidden: true, title: 'mon compte',
      onclick: (e) => session().then((me) => me && import('./porte.js').then((m) => m.account(me, e.target.closest('button')))) }, 'compte'),
    // les préférences, générales et par outil (commun/prefs.js) · Ctrl+,
    el('button', { class: 'tb ghost sm sr-gear', id: 'sr-prefs', type: 'button', title: 'préférences · Ctrl+,', 'aria-label': 'préférences',
      html: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
      onclick: () => import('./prefs.js').then((m) => m.openPrefs(toolId)) }),
    el('button', { class: 'tb ghost sm', id: 'sr-queue', title: 'la file des calculs', onclick: () => drawer(true) }, 'File'),
    // tout à droite : le plein écran (Cal, 29/09) ; l'icône dit l'état
    boutonPleinEcran(document, el));
  // fenêtre étroite : la navigation passe dans un menu « Outils », jamais cachée
  const menu = el('div', { class: 'tools-menu', hidden: true });
  const menuBtn = el('button', { class: 'tb ghost sm tools-btn', type: 'button', title: 'les outils',
    onclick: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; } }, 'Outils');
  nav.after(menuBtn, menu);
  document.addEventListener('click', () => { menu.hidden = true; });
  document.body.prepend(hdr);
  HDR = hdr;
  // le panneau (et sa place, dès maintenant : la page est encore cachée, rien ne saute)
  if (DOCK.page) import('./dock.js').then((m) => m.mount(DOCK.page)).catch((e) => console.error('panneau Asset', e));
  // la barre ne se coupe jamais : si les noms n'y tiennent pas entiers (douze
  // outils, le nom de l'outil, le compte…), elle passe dans le menu « Outils ».
  // Mesurée, pas devinée par une largeur : juste quel que soit le contenu.
  const fit = () => {
    hdr.classList.remove('squeeze');
    if (nav.children.length && nav.scrollWidth > nav.clientWidth + 1) hdr.classList.add('squeeze');
  };
  if (window.ResizeObserver) { const ro = new ResizeObserver(fit); ro.observe(hdr); ro.observe(nav); }
  if (!document.querySelector('link[data-porte]')) {
    document.head.append(el('link', { rel: 'stylesheet', href: href('commun/porte.css'), 'data-porte': '' }));
  }
  const paintMe = (me) => {
    const adm = $('#sr-admin'), mine = $('#sr-me');
    if (!me || !adm) return;
    const isAdmin = me.user && me.user.role === 'admin';
    adm.hidden = !isAdmin;
    adm.textContent = isAdmin && me.pending_requests ? `Admin · ${me.pending_requests}` : 'Admin';
    adm.classList.toggle('on', toolId === 'admin');
    mine.hidden = !(me.auth && me.user);
    if (me.user) mine.textContent = me.user.name;
  };
  // Le droit Studio (core/auth.py, « le Studio » ; /api/auth/me → user.access) : un compte Apps voit les
  // outils Studio fermés — grisés, un cadenas, un clic mène à la demande ; sur une page Studio (servie par le
  // Worker de la porte, que le portail ne voit pas), la porte « réservé au Studio » la couvre. Le serveur juge
  // de son côté (pages, écritures, travaux) : ceci ne fait que le montrer.
  // un invité de planche (rôle `invite`) n'a pas le Studio, mais sa planche d'Idéation lui est ouverte :
  // le serveur l'exempte (_studio_only), l'en-tête aussi
  const studioOff = (me, x) => !!(me && me.user && me.user.access === 'apps' && me.user.role !== 'invite'
    && x && x.tier === 'studio' && !x.open);
  const askStudio = (me, x) => (e) => { e.preventDefault(); menu.hidden = true; import('./porte.js').then((m) => m.studioDoor(me, x, { closable: true })); };
  const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  // le Workspace oublié avant le rechargement (oublieEspace) : le dire ici
  const msg = ss.get(ESP_MSG);
  if (msg) { ss.set(ESP_MSG, null); setTimeout(() => toast(msg, 6000), 400); }
  // les outils : posés tout de suite ; refaits seulement si ce qu'ils montrent change (un outil fermé,
  // une adresse) — la même barre ne se redessine pas
  let navSig = null;
  const paintNav = (me, sys) => {
    const sig = JSON.stringify(TOOLS.map((x) => [toolHref(x, sys), studioOff(me, x)]));
    if (sig === navSig) return;
    navSig = sig;
    nav.replaceChildren();
    menu.replaceChildren();
    let tier = null;
    for (const x of TOOLS) {
      if (x.id === 'asset') continue;   // Asset : le bouton du panneau, tout à gauche (commun/dock.js)
      // Apps | Studio : un filet dans la barre, un intitulé dans le menu
      if (x.tier !== tier) {
        if (tier !== null) nav.append(el('i', { class: 'sep', 'aria-hidden': 'true' }));
        menu.append(el('span', { class: 'grp' }, x.tier === 'app' ? 'Apps' : 'Studio'));
        tier = x.tier;
      }
      const off = studioOff(me, x);
      const cls = [x.id === toolId ? 'on' : '', off ? 'lock' : ''].filter(Boolean).join(' ') || null;
      const why = off ? `${x.name} · réservé au Studio : le demander à Cal` : null;
      // fermé : le lien ouvre la demande (un dialogue), il ne part pas
      nav.append(el('a', { href: toolHref(x, sys), class: cls, title: why, 'aria-haspopup': off ? 'dialog' : null,
        onclick: off ? askStudio(me, x) : null,
        target: x.external && !off ? '_blank' : null, rel: x.external ? 'noopener' : null },
      off ? el('span', { class: 'lk', html: LOCK }) : null, x.name));
      menu.append(el('a', { href: toolHref(x, sys), class: cls, title: why, 'aria-haspopup': off ? 'dialog' : null,
        onclick: off ? askStudio(me, x) : null }, off ? el('span', { class: 'lk', html: LOCK }) : null, x.name));
    }
    fit();
  };
  // la première image : ce que l'onglet sait déjà (la dernière réponse du portail, l'état des machines, la file)
  paintNav(lastMe, null);
  if (entre(lastMe)) { paintMe(lastMe); paintEspace(); }
  const pill = lu(SYS_KEY);
  if (pill) { const p = $('#sr-sys', hdr); p.className = pill.c; p.lastChild.textContent = pill.t; p.title = pill.title; }
  const fileN = ss.get(FILE_KEY);
  if (fileN) $('#sr-queue', hdr).textContent = fileN;
  session().then((me) => {
    document.documentElement.classList.remove('sr-wait');
    if (me && me.auth && me.state !== 'active') return showDoor(me);
    paintMe(me);
    paintEspace();
    if (studioOff(me, t)) import('./porte.js').then((m) => m.studioDoor(me, t));
    import('./prefs.js').then((m) => m.prefs.ready);   // les préférences de la personne, relues du portail
  });
  setInterval(() => { if (!doorOn) session(true).then(paintMe); }, 20000);
  Promise.all([system(), session()]).then(([sys, me]) => {
    paintNav(me, sys);
    paintSys(sys);
  });
  setInterval(() => { sysInfo = null; system().then(paintSys); }, 20000);
  jobs.watch((list) => {
    const n = list.filter((j) => j.state === 'queued' || j.state === 'running').length;
    const txt = n ? `File · ${n}` : 'File';
    $('#sr-queue').textContent = txt;
    ss.set(FILE_KEY, txt === 'File' ? null : txt);
    if ($('.drawer.on')) paintDrawer(list);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') drawer(false); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === ',' && !e.altKey) { e.preventDefault(); import('./prefs.js').then((m) => m.openPrefs(toolId)); }
  });
  raccourciPleinEcran(document);
  return hdr;
}

// l'état des machines et la file, gardés pour l'onglet : la page suivante les montre dès sa première image
const SYS_KEY = 'sr-sys', FILE_KEY = 'sr-file';
function paintSys(sys) {
  const p = $('#sr-sys');
  if (!p) return;
  if (!sys) { p.className = 'pill err'; p.lastChild.textContent = 'portail injoignable'; ss.set(SYS_KEY, null); return; }
  const img = (sys.lanes.image || []);
  const up = img.filter((e) => e.up).map((e) => e.machine);
  const h3 = (sys.lanes.h3 || []).filter((e) => e.up).length;
  p.className = 'pill ' + (up.length ? 'on' : 'err');
  p.lastChild.textContent = up.length ? `${up.join(' + ')}${h3 ? ' · H3' : ''}` : 'aucune machine';
  p.title = img.map((e) => `${e.machine} ${e.up ? `prête · ${e.ram_free_gb ?? '?'} Go libres` : 'ne répond pas'}`).join('\n')
    + `\nH3 : ${h3 ? 'démarré' : 'arrêté (il se démarre à la demande)'}`;
  ss.set(SYS_KEY, JSON.stringify({ c: p.className, t: p.lastChild.textContent, title: p.title }));
}

// ── le tiroir de la file ────────────────────────────────────
// La file de tous (GET /api/queue) : ce qui tourne, ce qui attend dans
// l'ordre où ça partira — sa place (« 2 devant toi »), son départ estimé —
// et ce qu'on vient de finir.
let qT = null;
let qBusy = false;
function drawer(on) {
  let d = $('.drawer');
  if (!d) {
    d = el('aside', { class: 'drawer', 'aria-label': 'la file des calculs' },
      el('div', { class: 'pan-head' }, el('span', { class: 't' }, 'La file des calculs'), el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', onclick: () => drawer(false) }, 'Fermer')),
      el('div', { class: 'list' }));
    document.body.append(d);
  }
  d.classList.toggle('on', on);
  clearTimeout(qT);
  if (on) paintDrawer();
}

async function paintDrawer() {
  const box = $('.drawer .list');
  if (!box || !$('.drawer.on') || qBusy) return;
  qBusy = true;
  clearTimeout(qT);
  let q = null;
  try {
    q = await api('queue');
    await jobItemsFor([...q.running, ...q.queued, ...q.done]);
    const rows = [];
    if (q.paused) rows.push(el('p', { class: 'why' }, 'la file est en pause : Cal la reprendra'));
    for (const [m, s] of Object.entries(q.machines || {})) {
      if (s.mode !== 'active') rows.push(el('p', { class: 'why' }, `${m} ${s.mode === 'draining' ? 'en vidange : finit, puis ne prend plus rien' : 'en pause'}`));
    }
    const head = (t, n) => el('div', { class: 'qh' }, t, el('span', { class: 'n' }, String(n)));
    rows.push(head('en cours', q.running.length), ...q.running.map(jobRow));
    rows.push(head('en file', q.queued.length), ...q.queued.map(jobRow));
    if (q.done.length) rows.push(head(q.admin ? 'fini récemment' : 'mes travaux finis', q.done.length), ...q.done.map(jobRow));
    box.replaceChildren(...rows);
  } catch (e) {
    if (e.status !== 401) box.replaceChildren(el('p', { class: 'warn' }, e.message));
  } finally { qBusy = false; }
  const busy = q && (q.running.length || q.queued.length);
  if ($('.drawer.on')) qT = setTimeout(paintDrawer, busy ? 1500 : 5000);
}

export const fmtWait = (s) => {
  if (s === null || s === undefined) return '';
  if (s < 60) return 'moins d’une minute';
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

// La vignette d'un travail : `j.thumb` est la vignette JPEG (384 px) de son
// image d'entrée ou de sa première sortie ; sa copie d'affichage à 44 px
// (commun/proxies.js) vient de l'objet, lu une fois pour tous les travaux
// de la file (/api/library/batch) et gardé.
const jobItems = new Map();   // id → objet public (null : absent ou invisible)
const THUMB_ID = /library\/([a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4})\//;
const thumbId = (u) => (String(u || '').match(THUMB_ID) || [])[1] || null;
export async function jobItemsFor(list) {
  const want = [...new Set((list || []).map((j) => thumbId(j.thumb)).filter((x) => x && !jobItems.has(x)))];
  if (!want.length) return;
  try {
    const r = await api('library/batch', { method: 'POST', body: { ids: want } });
    for (const it of r.items || []) jobItems.set(it.id, it);
    for (const m of r.missing || []) jobItems.set(m, null);
  } catch { /* la vignette JPEG reste */ }
}
function jobThumb(j, px = 44) {
  const it = (j.items || []).find((x) => x && (x.views || x.thumb_url)) || jobItems.get(thumbId(j.thumb));
  const u = it ? pickView(it, needOf(it, px, px)).url : '';
  return u || (j.thumb ? href(j.thumb) : '');
}

export function jobRow(j) {
  const cls =j.state === 'running' ? 'run' : j.state === 'error' ? 'err' : j.state === 'done' ? 'ok' : '';
  const acts = el('div', { class: 'row' });
  // `can` (la file, core_api) : le sien, ou Cal ; absent : comme avant
  if (j.can !== false) {
    if (j.state === 'queued' || j.state === 'running') acts.append(el('button', { class: 'tb ghost sm', onclick: () => jobs.cancel(j.id).then(paintDrawer).catch((e) => toast(e.message)) }, 'Arrêter'));
    else {
      acts.append(el('button', { class: 'tb ghost sm', onclick: () => jobs.retry(j.id).then(paintDrawer).catch((e) => toast(e.message)) }, 'Relancer'));
      acts.append(el('button', { class: 'tb ghost sm', title: 'retirer de la liste', onclick: () => jobs.forget(j.id).then(paintDrawer).catch((e) => toast(e.message)) }, '×'));
    }
  }
  const who = j.owner_name && !j.mine ? ` · ${j.owner_name}` : '';
  let place = '';
  if (j.state === 'queued' && j.position) {
    place = j.mine ? (j.ahead ? ` · ${j.ahead} devant toi` : ' · le prochain') : ` · n° ${j.position}`;
    if (j.eta_s != null) place += j.eta_s < 30 ? ' · part bientôt' : ` · départ ≈ ${fmtWait(j.eta_s)}`;
  }
  return el('div', { class: 'job' + (j.mine ? ' mine' : ''), title: j.message || '' },
    el('div', { class: 'jt', style: j.thumb || j.items?.length ? { backgroundImage: `url("${jobThumb(j)}")` } : null }),
    el('div', { style: { minWidth: 0 } },
      el('div', { class: 'jn' }, j.title),
      el('div', { class: 'js ' + cls }, `${stateFr(j.state)}${j.machine ? ' · ' + j.machine : ''}${who}${place} — ${j.message || ''}`)),
    acts,
    j.state === 'running' ? el('div', { class: 'bar' }, el('i', { style: { width: j.progress != null ? `${Math.round(j.progress * 100)}%` : '100%', opacity: j.progress != null ? 1 : 0.35 } })) : null);
}

// ── vignettes ───────────────────────────────────────────────
// midi : un clip de notes d'ODIO ; sequence : une séquence du Montage (29/09)
const KIND_FR = { image: 'image', video: 'vidéo', audio: 'son', element: 'élément', midi: 'MIDI', sequence: 'séquence' };
export const kindFr = (k) => KIND_FR[k] || k;
// les sortes d'un élément : les planches (server/core/library.py, ELEMENT_TYPES), puis les sortes d'un
// élément versionné (VERSIONED_TYPES : une chanson, un son, une séquence, une image) — jamais le nom
// anglais du serveur à l'écran (« SOUND » sur la marque d'un élément versionné, relevé le 30/09)
const ETYPE_FR = { character: 'personnage', object: 'objet', place: 'lieu', style: 'style', other: 'élément',
  music: 'musique', sound: 'son', sequence: 'séquence', picture: 'image' };
export const etypeFr = (k) => ETYPE_FR[k] || 'élément';   // une sorte que le portail ne connaît pas encore : « élément », pas son nom anglais

// La marque de la sorte d'un objet — UNE fonction, partout où un objet se
// montre : les vignettes (Asset, le sélecteur, la corbeille : thumb), le
// chutier du Montage (vue liste). Cal, 29/09 : « on repère pas bien les
// séquences dans les assets du montage… il faut une icône lisible dessus car
// c'est comme dans Premiere Pro : on confond avec un clip qui a la même
// première image ». Premiere pose l'icône de la sorte dans le coin de la
// vignette (vue icônes) et devant le nom (vue liste). Ici : la pastille du
// coin porte l'icône des sortes qu'on confondrait à l'image (séquence ≠ clip
// vidéo, clip MIDI ≠ son, élément ≠ image), et la séquence est PLEINE (fond
// acier, --cy / --on-cy) quand le clip vidéo reste un simple voile : la
// différence se voit à toutes les tailles, sans lire. `compact` : l'icône
// seule, pour une vignette de quelques dizaines de pixels.
export const KIND_ICON = {
  // trois pistes, des coupes décalées : l'icône de séquence du Montage (onglets, chutier)
  sequence: '<svg viewBox="0 0 24 24"><path d="M3 6h18v12H3zM3 10h18M3 14h18M8 6v4M14 10v4M11 14v4"/></svg>',
  // deux croches : des notes écrites, pas un son
  midi: '<svg viewBox="0 0 24 24"><path d="M9 17V6l10-2v11M9 17a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 15a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/></svg>',
  // deux fiches l'une sur l'autre : un élément (ses références), pas une image
  element: '<svg viewBox="0 0 24 24"><path d="M4 9h11v11H4zM9 4h11v11h-5"/></svg>',
};
export function kindMark(it, { compact = false } = {}) {
  const k = it.kind;
  const label = k === 'element' ? etypeFr(it.element?.type || it.etype) : kindFr(k);
  const ico = KIND_ICON[k];
  return el('span', { class: `kind kmark ${k}${compact ? ' compact' : ''}`, title: label },
    ico ? el('i', { class: 'ki', 'aria-hidden': 'true', html: ico }) : null,
    compact && ico ? null : el('b', { class: 'kt' }, label));
}

export function thumb(it, { onclick, selected = false, sub } = {}) {
  const im = el('div', { class: 'im' });
  if (it.kind === 'video' && it.url && !it.thumb_url) im.append(el('video', { src: href(it.url), muted: true, preload: 'metadata' }));
  // la copie d'affichage de la case (carrée, remplie ; 180 px en .grid, 118 en
  // .grid.sm : la plus grande sert d'estimation, le chargement paresseux du
  // navigateur la prend), suivie ensuite (commun/proxies.js) ; sans copie, la vignette
  else if (it.thumb_url) im.append(bindView(el('img', { alt: '', loading: 'lazy', decoding: 'async' }), it, { fit: 'cover', box: [180, 180] }));
  else if (it.kind === 'audio' && it.id) im.append(el('i', { class: 'swave', 'aria-hidden': 'true', style: { '--wave': `url("${href(`api/son/apercu/${it.id}?v=1`)}")` } }));   // le visuel du son (server/tools/apercu_son.py)
  im.append(kindMark(it));
  if (it.duration) im.append(el('span', { class: 'dur' }, fmtDur(it.duration)));
  const s = sub ?? (it.kind === 'element' ? `${it.element?.refs?.length || 0} réf.` :
    [it.width && it.height ? `${it.width}×${it.height}` : '', it.origin?.model || it.origin?.tool || ''].filter(Boolean).join(' · '));
  // toute vignette se glisse vers un emplacement qui attend un asset (dropZone)
  return dragItem(el('button', { class: 'thumb' + (selected ? ' sel' : ''), type: 'button', onclick, title: it.prompt || it.title },
    im, el('div', { class: 'cap' }, el('div', { class: 't' }, it.title || it.id), el('div', { class: 's' }, s))), it);
}

// ── le sélecteur : choisir dans la bibliothèque ─────────────
// pick({kinds: ['image','element'], multiple: true, title}) → Promise<[items]>
// Onglet « Character Factory » : un personnage devient un élément d'un clic.
export function pick({ kinds = ['image', 'element'], multiple = false, title = 'Choisir dans la bibliothèque', upload = true } = {}) {
  return new Promise((resolve) => {
    const chosen = new Map();
    let tab = kinds[0] === 'element' || kinds.includes('element') && kinds.length === 1 ? 'element' : 'all';
    let q = '';
    const grid = el('div', { class: 'grid sm' });
    const tabs = el('div', { class: 'seg' });
    const done = el('button', { class: 'tb go', onclick: () => close([...chosen.values()]) }, multiple ? 'Prendre' : 'Prendre');
    const count = el('span', { class: 'lbl' });
    const accept = [kinds.includes('image') || kinds.includes('element') ? 'image/*' : '', kinds.includes('video') ? 'video/*' : '',
      kinds.includes('audio') ? 'audio/*' : ''].filter(Boolean).join(',');
    const fileIn = el('input', { type: 'file', multiple: true, accept, hidden: true,
      onchange: async () => {
        for (const f of fileIn.files) {
          try { const it = await uploadFile(f, { tool: 'upload', via: 'selecteur' }); chosen.set(it.id, it); if (!multiple) return close([it]); } catch (e) { toast(e.message); }
        }
        load();
      } });
    const scrim = el('div', { class: 'scrim picker' },
      el('div', { class: 'modal', role: 'dialog', 'aria-label': title },
        el('div', { class: 'modal-head' }, el('span', { class: 't' }, title), el('span', { class: 'sp' }), tabs,
          el('input', { class: 'fld', placeholder: 'chercher', style: { width: '180px' }, oninput: (e) => { q = e.target.value; load(); } })),
        el('div', { class: 'modal-body' }, grid),
        el('div', { class: 'modal-foot' },
          upload ? el('button', { class: 'tb ghost', onclick: () => fileIn.click() }, 'Déposer un fichier') : null, fileIn,
          count, el('span', { class: 'sp' }),
          el('button', { class: 'tb ghost', onclick: () => close([]) }, 'Annuler'), done)));
    const TABS = [['all', 'Tout'], ...kinds.map((k) => [k, kindFr(k) + 's']), ['upload', 'Uploads'],
      ...(kinds.includes('element') ? [['cf', 'Character Factory']] : [])];
    // déposer des fichiers dans la fenêtre : ils entrent (Upload) et sont choisis
    dropZone(grid, { kinds, via: 'selecteur', onitems: (items) => {
      if (!multiple) return close(items.slice(0, 1));
      for (const it of items) chosen.set(it.id, it);
      paintCount(); load();
    } });
    for (const [id, lab] of TABS) {
      tabs.append(el('button', { class: 'tb' + (tab === id ? ' on' : ''), onclick: (e) => { tab = id; $$('.tb', tabs).forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); load(); } }, lab));
    }
    function close(v) { scrim.remove(); document.removeEventListener('keydown', esc); resolve(v); }
    function esc(e) { if (e.key === 'Escape') close([]); }
    document.addEventListener('keydown', esc);
    function paintCount() { count.textContent = chosen.size ? `${chosen.size} choisi${chosen.size > 1 ? 's' : ''}` : ''; done.disabled = !chosen.size; }
    async function load() {
      grid.replaceChildren(el('p', { class: 'lbl' }, 'chargement'));
      if (tab === 'cf') return loadCf();
      const kind = tab === 'all' || tab === 'upload' ? kinds.join(',') : tab;
      try {
        const res = await api(`library?kind=${kind}&q=${encodeURIComponent(q)}&limit=300${tab === 'upload' ? '&tool=upload' : ''}`);
        grid.replaceChildren(...(res.items.length ? res.items.map(card) : [el('p', { class: 'lbl' }, 'rien ici — déposez un fichier, ou créez-le dans un outil')]));
      } catch (e) { grid.replaceChildren(el('p', { class: 'warn' }, e.message)); }
    }
    function card(it) {
      const n = thumb(it, { selected: chosen.has(it.id), onclick: () => {
        if (!multiple) return close([it]);
        chosen.has(it.id) ? chosen.delete(it.id) : chosen.set(it.id, it);
        n.classList.toggle('sel', chosen.has(it.id)); paintCount();
      } });
      return n;
    }
    async function loadCf() {
      try {
        const { characters } = await api('cf/characters');
        grid.replaceChildren(...characters.filter((c) => c.locked).map((c) => {
          const b = el('button', { class: 'thumb', type: 'button', title: 'en faire un élément', onclick: async () => {
            b.classList.add('pending');
            try {
              const it = await api('cf/import', { method: 'POST', body: { slug: c.slug } });
              toast(`${c.name} est maintenant un élément`);
              if (!multiple) return close([it]);
              chosen.set(it.id, it); paintCount(); b.classList.remove('pending'); b.classList.add('sel');
            } catch (e) { b.classList.remove('pending'); toast(e.message); }
          } },
          el('div', { class: 'im' }, c.thumb ? el('img', { src: href('api/' + c.thumb.replace(/^api\//, '')), alt: '' }) : null,
            el('span', { class: 'kind element' }, 'personnage')),
          el('div', { class: 'cap' }, el('div', { class: 't' }, c.name),
            el('div', { class: 's' }, `${c.costumes} tenue${c.costumes > 1 ? 's' : ''}${c.imported.length ? ' · déjà importé' : ''}`)));
          return b;
        }));
        if (!grid.children.length) grid.append(el('p', { class: 'lbl' }, 'aucun personnage au visage verrouillé'));
      } catch (e) { grid.replaceChildren(el('p', { class: 'warn' }, e.message)); }
    }
    paintCount();
    document.body.append(scrim);
    load();
  });
}

// La planche de références et la règle commune des références : commun/refs.js
export { refBoard, sortable, moveItem, sentCount, sentLabel, isHeld, heldTitle } from './refs.js';

// Dépôt par glisser sur toute la page : cb(fichiers)
export function dropAnywhere(cb) {
  let n = 0;
  addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { n++; document.body.classList.add('dropping'); } });
  addEventListener('dragleave', () => { if (--n <= 0) { n = 0; document.body.classList.remove('dropping'); } });
  addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault(); n = 0; document.body.classList.remove('dropping'); cb([...e.dataTransfer.files]);
  });
}
