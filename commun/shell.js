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
/** Une adresse qui ne passe pas par api() (EventSource, sendBeacon, fetch à la main) : + `e=` — celui
 *  du document qu'elle nomme s'il est ouvert dans cet onglet (espaceDocument), sinon celui de l'onglet. */
export function avecEspace(u) {
  const e = espaceDe(u);
  if (!e) return u;
  const abs = new URL(u, location.href);
  if (!abs.searchParams.has('e')) abs.searchParams.set('e', e);
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
// `doc`, son identifiant (`ide-…`, `trn-…`, `seq-…`, `mus-…`) : l'onglet le retient (sessionStorage),
// et toute requête qui le nomme part dans SON Workspace — api(), avecEspace() (le flux d'une planche,
// une balise de départ) —, qu'on ait changé de Workspace depuis (l'en-tête) ou rechargé la page (son
// #document se rouvre où il est). Le document ne change pas d'espace parce que l'en-tête change.
// `outil: true` : tant qu'il est ouvert, l'outil travaille dans le Workspace du document — tout ce
// qu'il demande sans dire `espace` y part (générer, déposer, ranger : ce qui naît pour le document
// naît où il est) ; ce qui liste ou crée pour l'onglet (la liste des planches, une planche neuve)
// passe `espace: espace()`. Un objet posé dedans, d'un autre Workspace, y est rapatrié : la copie va
// dans le Workspace du document (rapatrier, ici()).
let docEspace = null, docOutil = false;
const DOC_KEY = 'sr-docs-espace', DOC_MAX = 40;
const DOC_ID = /^[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}$/;
const DOC_IN = /\b[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}\b/g;
const docsEspace = (() => { try { const m = JSON.parse(ss.get(DOC_KEY) || '{}'); return m && typeof m === 'object' ? m : {}; } catch { return {}; } })();
export function espaceDocument(id, doc = null, { outil = false } = {}) {
  docEspace = id && ESP_RX.test(id) ? id : null;
  docOutil = !!(docEspace && outil);
  if (docEspace && typeof doc === 'string' && DOC_ID.test(doc)) {
    delete docsEspace[doc];          // le plus récent en dernier : les plus anciens s'en vont d'abord
    docsEspace[doc] = docEspace;
    const keys = Object.keys(docsEspace);
    for (const k of keys.slice(0, Math.max(0, keys.length - DOC_MAX))) delete docsEspace[k];
    ss.set(DOC_KEY, JSON.stringify(docsEspace));
  }
  paintEspace();
}
// le Workspace d'une requête : celui du document ouvert qu'elle nomme ; sinon celui où l'outil
// travaille (le document `outil`), sinon celui de l'onglet
function espaceDe(path) {
  for (const x of String(path || '').match(DOC_IN) || []) if (docsEspace[x] && ESP_RX.test(docsEspace[x])) return docsEspace[x];
  return docOutil ? docEspace : ESPACE;
}
/** Le Workspace où l'outil travaille en ce moment : celui du document ouvert, sinon celui de l'onglet. */
export const ici = () => docEspace || ESPACE;

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

// ── le Studio ici (core/auth.py, « le Studio ») ─────────────
// /api/auth/me → `studio` : `ici`, le Studio dans le Workspace de l'onglet, jugé comme la porte le
// juge (_studio_only : le compte, ou l'offre de la Team du Workspace) ; `liens`, les outils Studio
// dont un lien lui ouvre un document (une planche d'Idéation). Sans le champ (une réponse d'avant),
// le droit du compte (`user.access`) ; pas encore de réponse : rien ne se retire (le serveur juge).
// Un geste du Studio (Envoyer au Montage, Ouvrir ODIO…) est RETIRÉ pour qui ne l'a pas — « retire
// (reste en Studio) », apps_studio_elements.md § 3.2 — d'une seule façon, pour toutes les pages :
//   - un nœud : studioSeul(nœud), la classe STUDIO_SEUL (`sr-studio`), cachée sous <html data-studio="non">
//     (shell.css) ;
//   - une entrée de menu (commun/menu.js) : `studio: true`, que menu() écarte.
// Le serveur juge de son côté (pages, écritures, travaux) : ceci ne fait que le montrer.
export const STUDIO_SEUL = 'sr-studio';
/** Marque un nœud (un bouton, un lien) comme geste du Studio : retiré sans lui. Rend le nœud. */
export function studioSeul(node) { if (node) node.classList.add(STUDIO_SEUL); return node; }
export function studioIci(me = lastMe) {
  if (!me || !me.user || me.auth === false) return true;
  if (me.user.role === 'invite') return false;
  if (me.studio && typeof me.studio.ici === 'boolean') return me.studio.ici;
  return me.user.access !== 'apps';
}
/** Les outils Studio (ids de TOOLS) qu'un lien ouvre à cette personne sans le Studio. */
export const studioLiens = (me = lastMe) => (me && me.studio && Array.isArray(me.studio.liens) ? me.studio.liens : []);
const poseStudio = (me) => { document.documentElement.dataset.studio = studioIci(me) ? 'oui' : 'non'; };
poseStudio(lastMe);   // dès la première image : ce que l'onglet sait déjà
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
      espaceSu = true;   // le Workspace de l'onglet est fixé : la file peut se partager (brancherPartage)
      if (pollOn) brancherPartage();
      ss.set(ME_KEY, me ? JSON.stringify(me) : null);
      poseStudio(me);
      paintEspace();
      return me;
    });
  }
  return meP;
};
export function showDoor(me) {
  if (doorOn) return;
  doorOn = true;
  if (lacher) lacher();   // la porte fermée : cet onglet ne relève plus la file pour les autres
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
// Un VISUALISEUR (Cal, 30/09) : chercher, filtrer, trier, poser ; la gestion est à la
// page Asset (le bouton ASSET, à droite de la barre). `mountHeader` la monte ; elle
// s'ouvre par sa languette (la poignée au bord gauche) ou le raccourci ; ici, ce
// qui doit exister avant qu'elle ne soit chargée : la façade `dock` (un appel
// fait trop tôt attend le panneau), le registre des zones qui prennent un asset
// (`declareZone` ; `dropZone` s'y inscrit seul), la sorte effective, le raccourci.
//
//   dock.configure({ place, clickPlaces, placeLabel, menu, kinds, label, dockMin, hint, upload, fiche, rapatrie })
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
// `espace` : le Workspace de cette requête — par défaut celui du document ouvert qu'elle nomme
// (espaceDocument : il ne change pas d'espace parce que l'en-tête change), sinon celui de
// l'onglet ; null : aucun.
// `blob` : la réponse est un fichier (un PNG exporté) — rendue en Blob, l'erreur reste en JSON
export async function api(path, { method = 'GET', body, raw, headers = {}, signal, espace: esp = espaceDe(path), blob = false } = {}) {
  const opts = { method, headers: { ...headers }, signal };
  if (esp && !Object.keys(opts.headers).some((k) => k.toLowerCase() === 'x-sr-espace')) opts.headers['X-SR-Espace'] = esp;
  if (raw !== undefined) opts.body = raw;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(new URL(path.replace(/^\/?(api\/)?/, ''), API), opts);
  if (blob && r.ok) return r.blob();
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
  // Une écriture qui rend un travail (son id, ou { job }, ou { jobs }) vient d'en lancer, d'en arrêter, d'en relancer
  // un, quelle que soit sa route (POST /api/image/…, /api/chanson/plan…) : la file est relue tout de suite, puis de
  // près — au repos, elle ne se relit que toutes les 30 s. Les routes de la file le font elles-mêmes (jobs.submit…).
  if (method !== 'GET' && !/^\/?(api\/)?jobs(\/|\?|$)/.test(path) && porteTravail(data)) fileBouge();
  return data;
}

// Un fichier vers la bibliothèque. Ce que quelqu'un dépose de son disque
// garde `tool: 'upload'` (la catégorie « Upload » d'Asset, pour le distinguer
// de ce que les outils fabriquent) et dit par où il est entré (`via`). Un
// outil qui range sa propre création (un mixage exporté…) passe son nom. Il entre là où l'outil
// travaille (le document ouvert `outil`, sinon l'onglet : espaceDocument), ou dans `espace`.
// `onprogress(part, ev)` : la progression de l'envoi, de 0 à 1 (« Commencer un projet »,
// ideation/projet.js) — fetch ne la donne pas, l'envoi passe alors par XMLHttpRequest ; `signal` l'arrête.
export async function uploadFile(file, { tool = 'upload', via = '', folder = '', title = '', espace: esp = espaceDe(''), onprogress = null, signal } = {}) {
  const q = new URLSearchParams({ name: file.name, tool, via, folder, title: title || file.name.replace(/\.[^.]+$/, '') });
  const it = onprogress
    ? await envoiSuivi('library/upload?' + q, file, { espace: esp, onprogress, signal, headers: { 'Content-Type': file.type || 'application/octet-stream' } })
    : await api('library/upload?' + q, { method: 'PUT', raw: file, espace: esp, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  return lireSiBesoin(it, file, { signal });
}
// Un document que le serveur n'a pas su lire (un PDF sans poppler : `doc.needs_page`) : la page
// le lit (commun/documents.js, pdf.js) et lui dépose son texte et sa couverture ; rend l'objet
// neuf. Un échec ne fait pas échouer le dépôt : le document reste rangé, sa fiche dit pourquoi
// (et la liseuse réessaiera). Une page qui dépose par uploadFile n'a rien à faire de plus.
export async function lireSiBesoin(it, file = null, { signal } = {}) {
  if (it?.kind !== 'document' || !it.doc?.needs_page) return it;
  try {
    const { extraireDocument } = await import('./documents.js');
    return (await extraireDocument(it, { file, signal })) || it;
  } catch (e) { console.warn('documents : la page n’a pas lu', it.title || it.id, '—', e.message); return it; }
}
// Un envoi dont on suit la progression (XMLHttpRequest, upload.onprogress), avec les erreurs d'api() :
// le message du portail, `status`, la porte sur un 401.
function envoiSuivi(path, body, { espace: esp = espaceDe(path), headers = {}, onprogress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const fail = (msg, status) => { const e = new Error(msg); e.status = status; reject(e); };
    const x = new XMLHttpRequest();
    x.open('PUT', new URL(path.replace(/^\/?(api\/)?/, ''), API));
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    if (esp) x.setRequestHeader('X-SR-Espace', esp);
    x.upload.onprogress = (e) => { if (e.lengthComputable && e.total) onprogress(Math.min(1, e.loaded / e.total), e); };
    x.onload = () => {
      let data = null;
      try { data = x.responseText ? JSON.parse(x.responseText) : null; } catch { data = { error: x.responseText.slice(0, 300) }; }
      if (x.status >= 200 && x.status < 300) { onprogress(1); resolve(data); return; }
      if (x.status === 401) showDoor();
      fail((data && data.error) || `${x.status} ${x.statusText}`, x.status);
    };
    x.onerror = () => fail('le portail ne répond pas : l’envoi est coupé', 0);
    x.onabort = () => fail('envoi arrêté', 0);
    if (signal) {
      if (signal.aborted) { fail('envoi arrêté', 0); return; }
      signal.addEventListener('abort', () => x.abort(), { once: true });
    }
    x.send(body);
  });
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

// Un objet d'un autre Workspace (it.space ≠ celui où l'outil travaille : le document ouvert, sinon
// l'onglet — ici()) ne se pose jamais tel quel : il est d'abord rapatrié — une copie neuve dans ce
// Workspace, jamais un lien vivant (POST /api/espaces/<ici>/rapatrier, server/tools/equipes.py ;
// equipes_espaces.md, étape 5) — et l'outil reçoit la copie, à la place de l'original, dans le même
// ordre. Tout ou rien : un refus (un viewer, une séquence) lève l'erreur du portail, qui dit pourquoi.
// Un élément versionné arrive en élément neuf dont la v1 est sa version figée (§ 3.3).
export async function rapatrier(items) {
  const here = ici();
  const away = (items || []).filter((it) => it && it.id && it.space && here && it.space !== here);
  if (!away.length) return items;
  const ids = [...new Set(away.map((it) => it.id))];
  const r = await api(`espaces/${here}/rapatrier`, { method: 'POST', body: { items: ids }, espace: here });
  const made = r.items || [];
  // chaque copie dit d'où elle vient (origin.from.item) ; sinon, l'ordre des ids
  const copy = new Map(ids.map((id, i) => [id, made.find((x) => x?.origin?.from?.item === id) || made[i]]));
  const where = here === ESPACE ? 'dans ce Workspace' : `dans « ${nomEspace(here)} », celui du document`;
  toast(ids.length > 1 ? `${ids.length} assets copiés ${where}` : `copié ${where} : ${made[0]?.title || ids[0]}`);
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
  wav: 'audio', mp3: 'audio', flac: 'audio', m4a: 'audio', ogg: 'audio', mid: 'midi', midi: 'midi' };
// une image d'un autre format : le serveur en fait une image PNG si PIL la lit, sinon un document
// (server/tools/documents.py, EXOTIC) ; tout le reste est un document (05/10)
const EXOTIC = new Set(['gif', 'bmp', 'dib', 'tif', 'tiff', 'avif', 'heic', 'heif', 'psd', 'tga', 'ico', 'icns', 'jp2', 'j2k', 'jpf',
  'jpx', 'qoi', 'ppm', 'pgm', 'pbm', 'pnm', 'sgi', 'rgb', 'dds', 'pcx', 'jfif', 'jpe']);
const kindOfFile = (f) => { const x = (f.name.includes('.') ? f.name.split('.').pop() : '').toLowerCase(); return EXT_KIND[x] || (EXOTIC.has(x) ? 'image' : 'document'); };

// Tout bloc qui attend un asset accepte un dépôt : un fichier du disque (il
// entre dans la bibliothèque, catégorie Upload) ou une vignette glissée
// d'ailleurs dans le portail. onitems(objets) reçoit des objets complets de la
// bibliothèque, déjà filtrés par `kinds` (un élément compte pour une image
// quand `kinds` prend 'element'). La zone s'inscrit au registre du panneau
// Asset (declareZone) : ses `kinds` font les filtres du panneau dans l'outil.
// Une zone qui prend 'document' prend tout fichier : ce qui n'est pas un média
// y entre en document (server/tools/documents.py, 05/10).
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
    const odd = [];
    for (let i = 0; i < files.length; i++) {
      toast(files.length > 1 ? `dépôt ${i + 1} / ${files.length} · ${files[i].name}` : `dépôt · ${files[i].name}`, 60000);
      try {
        const it = await uploadFile(files[i], { tool: 'upload', via });
        got.push(it);
        // la sorte est celle du portail, pas celle que l'extension laissait croire (un TIFF que
        // PIL ne lit pas devient un document) : rangé quand même, la zone le dit
        if (!kinds.includes(it.kind)) odd.push(it);
      } catch (err) { toast(`${files[i].name} : ${err.message}`); }
    }
    if (refused.length) toast(`pas pris ici : ${refused.map((f) => f.name).join(', ')} (attendu : ${kinds.map(kindFr).join(', ')})`);
    else if (odd.length) toast(`rangé dans la bibliothèque, pas pris ici : ${odd.map((it) => `${it.title || it.id} (${kindFr(it.kind)})`).join(', ')}`, 6000);
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

// ── l'onglet caché : plus aucun relevé ──────────────────────
// Cal, 06/10 : Cloudflare a compté 80 000 requêtes du Worker dans la journée, sur une limite de 100 000
// (Workers Free ; au-delà, /api/* et /library/* répondent 429 jusqu'à minuit UTC). Chaque onglet relisait
// la file, la session, la page d'admin… même caché. Un onglet caché (Page Visibility, MDN : un autre onglet
// devant, la fenêtre réduite, l'écran éteint — document.hidden) ne relit plus rien ; au retour
// (visibilitychange), chaque relevé repart TOUT DE SUITE. Une fenêtre détachée encore visible
// (commun/fenetre.js : un panneau sur le second écran) garde la page « visible ».
// Ce qui continue caché n'interroge rien : un flux (la collaboration d'Idéation : une seule requête, qui dit
// aussi « absent » aux autres), un enregistrement, une lecture. docs/etudes/cloudflare.md, « Le compte des
// requêtes du Worker » ; le compteur : tools/compte_requetes.mjs.
export const ongletCache = () => document.hidden && !(window.SR_FENETRES && window.SR_FENETRES.visible && window.SR_FENETRES.visible());
const retours = new Set();
let cacheVu = ongletCache();
/** cb() à chaque retour de l'onglet (caché → visible) ; rend de quoi se désabonner. */
export function auRetour(cb) { retours.add(cb); return () => retours.delete(cb); }
/** Tenue tout de suite si l'onglet se voit, sinon à son retour. */
export const quandVisible = () => (!ongletCache() ? Promise.resolve()
  : new Promise((ok) => { const off = auRetour(() => { off(); ok(); }); }));
function visibilite() {
  const c = ongletCache();
  if (c === cacheVu) return;
  cacheVu = c;
  if (c) fileCachee();   // la file : le verrou rendu (plus bas, « un seul relevé de la file par navigateur »)
  else for (const cb of [...retours]) { try { cb(); } catch (e) { console.error('retour de l’onglet', e); } }
}
document.addEventListener('visibilitychange', visibilite);
document.addEventListener('sr:visibilite', visibilite);   // une fenêtre détachée qui se montre, se cache, se ferme

/** Un relevé périodique : fn() toutes les `ms` (un nombre, ou une fonction qui le rend), jamais deux à la
 *  fois, rien tant que l'onglet est caché, tout de suite au retour. Rend { now(), stop() } : now() relit
 *  tout de suite (un relevé en vol : un seul de plus, juste après). */
export function releve(fn, ms, { now = false } = {}) {
  let t = 0, vol = false, encore = false, fini = false;
  const delai = () => (typeof ms === 'function' ? ms() : ms);
  const tour = async () => {
    clearTimeout(t); t = 0;
    if (fini || ongletCache()) return;   // caché : le retour relance
    if (vol) { encore = true; return; }
    vol = true;
    try { await fn(); } catch { /* le serveur redémarre : au tour suivant */ } finally { vol = false; }
    if (encore) { encore = false; tour(); return; }
    if (!fini && !ongletCache()) t = setTimeout(tour, delai());
  };
  const off = auRetour(tour);
  if (now) tour(); else t = setTimeout(tour, delai());
  return { now: tour, stop() { fini = true; clearTimeout(t); off(); } };
}

// ── la file ─────────────────────────────────────────────────
const listeners = new Set();
let lastJobs = [];
let pollT = 0;
let pollOn = false;     // une page relève la file (mountHeader, jobs.watch)
let pollVol = false;    // un relevé en vol
let pollEncore = false; // demandé pendant ce vol : un seul de plus, juste après
let evSeq = null;   // le dernier numéro vu du journal des éléments (ev_seq de GET /api/jobs)
const FINIS = ['done', 'error', 'cancelled', 'interrupted'];
// Les délais du relevé : 1,5 s quand un travail est en file ou en cours ; 6 s pendant les deux minutes qui suivent
// un mouvement (un travail vu en cours, un état qui change, un geste qui lance, arrête, relance : fileBouge) ;
// 30 s au repos. Ce qu'on attend de la file se voit tout de suite quand on l'a lancé d'ici (fileBouge, et api()
// pour toute écriture qui rend un travail) ; ce que lancent les autres, en 30 s au plus au repos.
const FILE_ACTIVE = 1500, FILE_PRES = 6000, FILE_REPOS = 30000, FILE_CALME = 120000, FILE_FILET = 15000;
let bougeA = Date.now();   // le dernier mouvement de la file (l'arrivée sur la page en est un)
let entenduA = 0;          // la dernière liste reçue : relevée ici, ou diffusée par le meneur (plus bas)
/** Un geste vient de toucher la file (lancer, arrêter, relancer, retirer) : relue tout de suite, puis de près. */
function fileBouge() { bougeA = Date.now(); jobs.poll(true); }
const JOB_ID = /^job-\d{4}-\d{6}-[0-9a-f]{4}$/;   // core/jobs.py, submit : « job-MMJJ-HHMMSS-xxxx »
const estTravail = (x) => (typeof x === 'string' ? JOB_ID.test(x) : !!x && typeof x === 'object' && JOB_ID.test(String(x.id || '')));
const porteTravail = (d) => !!d && typeof d === 'object' && (estTravail(d) || estTravail(d.job) || (Array.isArray(d.jobs) && d.jobs.some(estTravail)));

// ── un seul relevé de la file par navigateur ────────────────
// Cal, 06/10 (Observability du Worker) : trois GET /api/jobs à quelques dizaines de millisecondes d'écart —
// plusieurs onglets qui relèvent chacun la file. Les onglets visibles d'un même portail (même origine, même
// Workspace : ev_seq est celui du Workspace) élisent un meneur par un verrou (Web Locks, navigator.locks : tenu
// tant que l'onglet le garde ; l'onglet fermé, le verrou passe au suivant ; caché, la porte fermée, il le rend).
// Le meneur seul relève la file au rythme ci-dessus et diffuse chaque liste (BroadcastChannel) ; chaque onglet
// visible la traite comme la sienne (recevoir) : sr:job, sr:elements, l'en-tête, jobs.wait ; un onglet caché
// garde la dernière et la traite à son retour (gardee : caché, rien ne part, pas même ce que sr:job relit). Un geste qui
// touche la file relève tout de suite dans son onglet, et diffuse aussi. Un suiveur qui n'entend rien pendant le
// délai + 15 s relève lui-même (le filet). Sans ces deux API : chaque onglet relève, comme avant.
const PARTAGE = typeof BroadcastChannel === 'function' && !!(navigator.locks && typeof navigator.locks.request === 'function');
let canal = null;      // le canal du Workspace de l'onglet
let canalNom = '';
let meneur = false;    // cet onglet tient le verrou : il relève pour tous
let lacher = null;     // rend le verrou, ou abandonne la demande en attente
let gardee = null;     // la dernière liste diffusée pendant que l'onglet était caché : traitée à son retour
let espaceSu = false;  // la session a répondu (le Workspace de l'onglet est connu) : avant, chacun relève pour soi
function brancherPartage() {
  if (!PARTAGE || !espaceSu) return;   // un onglet neuf ne sait son Workspace qu'à la réponse de la session
  const nom = `sr-file:${ESPACE || ''}`;
  if (canal && canalNom === nom) { briguer(); return; }
  if (lacher) lacher();
  if (canal) canal.close();
  canal = null;
  canalNom = nom;
  try { canal = new BroadcastChannel(nom); } catch { return; }
  canal.onmessage = (e) => {
    const d = e.data;
    if (!d || d.t !== 'file' || !Array.isArray(d.jobs)) return;
    // caché : gardée pour le retour, rien de traité (un sr:job ferait relire ses pages : Asset, le panneau…)
    if (ongletCache()) { gardee = { jobs: d.jobs, ev: d.ev, bouge: Number(d.bouge) || 0, at: Date.now() }; return; }
    recevoir(d.jobs, d.ev, Number(d.bouge) || 0);
    planifier();
  };
  briguer();
}
function briguer() {
  if (!canal || lacher || !pollOn || doorOn || ongletCache()) return;
  const ctl = new AbortController();
  let rendre = () => {};
  const tenu = new Promise((ok) => { rendre = ok; });
  const mien = () => { lacher = null; meneur = false; ctl.abort(); rendre(); planifier(); };
  lacher = mien;
  navigator.locks.request(canalNom, { signal: ctl.signal }, async () => {
    if (lacher !== mien) return;   // rendu avant d'être tenu
    meneur = true;
    planifier();   // à son heure, comptée depuis la dernière liste entendue : pas de relevé en double
    await tenu;
  }).catch(() => { /* demande abandonnée : caché, porte fermée, autre Workspace */ });
}
// l'onglet se cache : il rend le verrou (un onglet visible le prend) et ne relève plus (visibilite)
function fileCachee() { if (lacher) lacher(); clearTimeout(pollT); pollT = 0; }
function planifier() {
  clearTimeout(pollT); pollT = 0;
  if (!pollOn || doorOn || ongletCache() || pollVol) return;   // un relevé en vol replanifie en finissant
  const active = lastJobs.some((j) => j.state === 'queued' || j.state === 'running');
  const d = active ? FILE_ACTIVE : Date.now() - bougeA < FILE_CALME ? FILE_PRES : FILE_REPOS;
  // le meneur (ou chaque onglet, sans partage) relève à son heure ; un suiveur attend la diffusion (le filet)
  const attente = !canal || meneur ? Math.max(0, d - (Date.now() - entenduA)) : d + FILE_FILET;
  pollT = setTimeout(() => jobs.poll(true), attente);
}
// une liste de la file, relevée ici ou diffusée par un autre onglet : la même suite pour toutes
let dejaRecu = false;   // une première liste reçue : la suivante dit ce qui a changé depuis
function recevoir(list, ev, bouge = 0) {
  entenduA = Date.now();
  if (bouge > bougeA) bougeA = bouge;
  const before = new Map(lastJobs.map((j) => [j.id, j.state]));
  // le plus récent travail de la liste d'avant (heure du portail) : un travail absent d'elle et au moins aussi
  // récent est né depuis (fini entre deux relevés, ou pendant que l'onglet était caché : son sr:job part quand
  // même) ; plus ancien, il remonte seulement dans la fenêtre des 60 (un autre retiré)
  const seuil = lastJobs.reduce((m, j) => (j.created && j.created > m ? j.created : m), '');
  const premier = !dejaRecu;
  dejaRecu = true;
  lastJobs = list;
  for (const cb of listeners) cb(list);
  for (const j of list) {
    const was = before.get(j.id);
    const neuf = was === undefined && !premier && !!j.created && j.created >= seuil;
    if ((was !== undefined && was !== j.state) || neuf) bougeA = Date.now();
    if (['done', 'error', 'cancelled'].includes(j.state) && (was ? was !== j.state : neuf)) {
      document.dispatchEvent(new CustomEvent('sr:job', { detail: j }));
    }
  }
  if (list.some((j) => j.state === 'queued' || j.state === 'running')) bougeA = Date.now();
  // le journal des éléments a avancé dans ce Workspace (server/tools/elements.py, seq_here) :
  // « sr:elements » dit aux pages qui suivent des versions de relire GET /api/elements/changes
  // (docs/etudes/apps_studio_elements.md § 2.11) — le relevé de la file, sans connexion de plus
  if (Number.isInteger(ev)) {
    if (evSeq !== null && ev > evSeq) document.dispatchEvent(new CustomEvent('sr:elements', { detail: { seq: ev, since: evSeq } }));
    evSeq = ev;
  }
}

export const jobs = {
  async submit(kind, params, { title = '', tool = '' } = {}) {
    const j = await api('jobs', { method: 'POST', body: { kind, params, title, tool } });
    fileBouge();
    return j;
  },
  get: (id) => api('jobs/' + id),
  cancel: (id) => api(`jobs/${id}/cancel`, { method: 'POST' }).then((j) => (fileBouge(), j)),
  retry: (id) => api(`jobs/${id}/retry`, { method: 'POST' }).then((j) => (fileBouge(), j)),
  forget: (id) => api(`jobs/${id}/forget`, { method: 'POST' }).then(() => fileBouge()),
  // cb(liste) à chaque relevé ; renvoie de quoi se désabonner
  // (un relevé déjà en vol sert aussi ce nouvel abonné : pas un de plus)
  watch(cb) { listeners.add(cb); if (lastJobs.length) cb(lastJobs); if (pollVol) pollOn = true; else jobs.poll(true); return () => listeners.delete(cb); },
  // Un seul relevé à la fois, une seule minuterie : un poll(true) pendant un relevé en vol en demande
  // UN de plus, juste après (avant le 06/10, chaque jobs.watch lancé pendant un vol ajoutait une chaîne :
  // l'accueil relisait la file deux fois, ODIO trois — tools/compte_requetes.mjs).
  async poll(now = false) {
    pollOn = true;
    brancherPartage();
    clearTimeout(pollT); pollT = 0;
    if (!now) { pollT = setTimeout(() => jobs.poll(true), 1500); return; }
    if (doorOn || ongletCache()) return;   // la porte est fermée, l'onglet caché : rien (le retour relance)
    if (pollVol) { pollEncore = true; return; }
    pollVol = true;
    let lu = null;
    try { lu = await api('jobs?limit=60'); } catch { /* le serveur redémarre : on réessaie */ } finally { pollVol = false; }
    if (lu && Array.isArray(lu.jobs)) {
      recevoir(lu.jobs, lu.ev_seq);
      try { if (canal) canal.postMessage({ t: 'file', jobs: lu.jobs, ev: lu.ev_seq, bouge: bougeA }); } catch { /* */ }
    }
    if (pollEncore) { pollEncore = false; jobs.poll(true); return; }
    planifier();
  },
  // attend la fin d'un travail ; onTick(job) à chaque relevé — onglet caché, il attend son retour. En cours, la
  // liste de la file le porte déjà (relue toutes les 1,5 s, ici ou par le meneur) : pas de requête de plus ;
  // fini, ou absent de la liste, sa fiche complète (avec ses objets, `items`) : une requête.
  async wait(id, onTick) {
    for (;;) {
      await quandVisible();
      const vu = Date.now() - entenduA < 2 * FILE_ACTIVE ? lastJobs.find((x) => x.id === id) : null;
      const j = vu && !FINIS.includes(vu.state) ? vu : await api('jobs/' + id);
      if (onTick) onTick(j);
      if (FINIS.includes(j.state)) return j;
      await new Promise((r) => setTimeout(r, 1200));
    }
  },
};
// de retour sur l'onglet : il brigue le verrou ; la dernière liste diffusée pendant qu'il était caché est traitée
// (les travaux finis entre-temps font leur sr:job maintenant) si elle a moins de 2 s, sinon la file est relue
auRetour(() => {
  if (!pollOn) return;
  brancherPartage();
  const g = gardee;
  gardee = null;
  if (g && Date.now() - g.at < 2000) { recevoir(g.jobs, g.ev, g.bouge); planifier(); } else jobs.poll(true);
});

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

// ── le sélecteur de Workspace (à droite, collé au nom : c'est de l'administration) ──
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
  btn.querySelector('.sr-tm').textContent = cur.t.name || '';
  btn.querySelector('.sr-wsn').textContent = cur.s.name || '';
  const doc = docEspace && docEspace !== ESPACE ? nomEspace(docEspace) : '';
  btn.title = `Team ${cur.t.name} · Workspace ${cur.s.name}${cur.s.role ? ` · ${WS_ROLE[cur.s.role] || cur.s.role}` : ''}`
    + (doc ? `\nle document ouvert est dans ${doc}` : '') + '\nchanger de Workspace';
  const note = box.querySelector('.doc');
  note.hidden = !doc;
  note.textContent = doc ? `document · ${doc}` : '';
  // les liens de l'en-tête gardent le Workspace de l'onglet (ouverts dans un nouvel onglet compris)
  for (const a of ESPACE ? document.querySelectorAll('.hdr a.logo, .hdr #sr-asset, .hdr .tools a, .hdr .tools-menu a') : []) {
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
// Entrer dans un Workspace SANS recharger la page : un parcours qui vient de le créer garde ce
// qu'il a en mémoire (« Commencer un projet », ideation/projet.js : les fichiers déposés). Comme
// changeEspace : le portail le retient, l'onglet le prend, l'adresse suit (?e=) ; puis l'en-tête,
// les écouteurs surEspace, le panneau Asset et la file se relisent. Rend l'identifiant.
export async function entrerEspace(id) {
  if (!ESP_RX.test(id || '')) throw new Error(`Workspace inconnu : ${id}`);
  await api('espaces/courant', { method: 'POST', body: { workspace: id } });
  fixeEspace(id);
  const u = new URL(location.href);
  u.searchParams.set('e', id);
  history.replaceState(history.state, '', u.href);
  await session(true);
  for (const cb of espaceCbs) { try { cb(id); } catch (e) { console.error('surEspace', e); } }
  DOCK.mod?.reload();
  jobs.poll(true);
  return id;
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
//
// Épurée (Cal, 30/09 : « on simplifie le header général des trucs qui polluent visuellement ») :
// à gauche le logotype, le NOM de l'outil en gros, la navigation ; à droite ASSET (la page
// dédiée : l'organisation de la bibliothèque), les préférences (la roue), le plein écran, la
// Team / le Workspace, puis le NOM (le compte), dont le menu porte la file de rendu, les Teams et
// Workspaces, l'Admin et l'état des machines. Plus rien sous le nom de l'outil : l'option `sub`
// des pages est ignorée ici, par construction (tous les onglets d'un coup) — une page peut la
// passer encore, elle ne se dessine plus.
let HDR = null;
// la roue des préférences (un engrenage : pas le soleil d'un thème) et la grille d'Asset — trait currentColor
const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
const GRID = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/></svg>';
export function mountHeader(toolId, { dock: useDock = true } = {}) {
  if (HDR && HDR.isConnected) return HDR;
  // la page reste cachée le temps de savoir qui entre (3 s au plus) — sauf si l'onglet est déjà entré
  if (!entre(lastMe)) {
    document.documentElement.classList.add('sr-wait');
    setTimeout(() => document.documentElement.classList.remove('sr-wait'), 3000);
  }
  const t = TOOLS.find((x) => x.id === toolId) || PAGES[toolId];
  document.documentElement.dataset.srTool = toolId;   // le menu de repli ouvre les préférences de l'outil
  // le panneau Asset (commun/dock.js) : il s'ouvre par sa languette, au bord gauche, et le raccourci
  // pas sur la page Asset elle-même (Cal, 05/10) : elle EST la bibliothèque, le panneau s'y doublait et
  // se disputait la lecture des objets avec elle
  DOCK.page = useDock && toolId !== 'asset' && TOOLS.some((x) => x.id === toolId) ? toolId : null;
  const assetT = TOOLS.find((x) => x.id === 'asset');
  const nav = el('nav', { class: 'tools' });
  // le nom de l'outil : une case de largeur FIXE, la même sur toutes les pages (Cal, 05/10 : « quand je passe
  // d'Image à Transcrire, tout le menu se décale vers la droite »). Tous les noms (TOOLS, PAGES) y sont posés
  // l'un sur l'autre, seul celui de la page se voit (shell.css, .tool-name) : la case a la largeur du plus long,
  // dans sa police, mesurée par le navigateur ; un séparateur fixe la suit, et la navigation commence au même
  // x partout, l'accueil compris (la case y reste vide). Le nom entier au survol, s'il est coupé (barre étroite).
  const noms = el('span', { class: 'tool-name', title: t ? t.name.replace(/\u00ad/g, '') : null },
    [...TOOLS, ...Object.values(PAGES)].map((x) => el('b', x === t ? { class: 'cur' } : { 'aria-hidden': 'true' }, x.name)));
  const hdr = el('header', { class: 'hdr' },
    el('a', { class: 'logo', href: avecEspace(href('')), title: 'le portail' },
      el('span', { class: 'sq' }, el('i')),
      el('span', {}, el('b', {}, 'Nirvalab'))),
    noms,
    el('i', { class: 'tool-sep', 'aria-hidden': 'true' }),
    nav,
    el('span', { class: 'sp' }),
    el('div', { class: 'sr-droite' },
    // la page Asset : tous les assets de la personne, leur organisation (groupes, glisser, Teams et Workspaces)
    el('a', { class: 'tb ghost sm sr-asset-btn', id: 'sr-asset', href: avecEspace(href(assetT.path)),
      'aria-current': toolId === 'asset' ? 'page' : null, title: 'Asset : la bibliothèque et son organisation',
      html: `${GRID}<span>Asset</span>` }),
    // les préférences, générales et par outil (commun/prefs.js) · Ctrl+,
    el('button', { class: 'tb ghost sm sr-gear', id: 'sr-prefs', type: 'button', title: 'préférences · Ctrl+,', 'aria-label': 'préférences',
      html: GEAR, onclick: () => import('./prefs.js').then((m) => m.openPrefs(toolId)) }),
    // le plein écran (Cal, 29/09) ; l'icône dit l'état
    boutonPleinEcran(document, el),
    // la Team et le Workspace de l'onglet, collés au nom (cachés tant que le portail ne les a pas dits)
    el('div', { class: 'sr-ws', id: 'sr-ws', hidden: true },
      el('span', { class: 'doc', hidden: true }),
      el('button', { class: 'sr-ws-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
        onclick: (e) => openWsMenu(e.currentTarget) },
      el('span', { class: 'sr-tm' }), el('span', { class: 'sr-sl', 'aria-hidden': 'true' }, '/'), el('span', { class: 'sr-wsn' }),
      el('i', { class: 'sr-cv', 'aria-hidden': 'true', html: '<svg viewBox="0 0 12 12"><path d="M3 4.5 6 7.5 9 4.5"/></svg>' }))),
    // tout à droite : le nom ; son menu (commun/porte.js, account) : la file, les Teams, l'Admin, les machines
    el('button', { class: 'tb ghost sm sr-me', id: 'sr-me', type: 'button', hidden: true, 'aria-haspopup': 'menu',
      onclick: (e) => menuDuNom(e.currentTarget) },
    el('span', { class: 'sr-nm' }, 'compte'),
    el('i', { class: 'dq', hidden: true, 'aria-hidden': 'true' }), el('i', { class: 'da', hidden: true, 'aria-hidden': 'true' }))));
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
  // la barre ne se coupe jamais : si les noms n'y tiennent pas entiers (douze outils, la case du nom
  // resserrée à son minimum, le compte…), la navigation passe dans le menu « Outils ». Mesurée, pas
  // devinée par une largeur : la navigation ne se resserre pas (shell.css), c'est le groupe de droite qui
  // sortirait du bord de la barre — juste quel que soit le contenu.
  const droite = hdr.querySelector('.sr-droite');
  const fit = () => {
    hdr.classList.remove('squeeze');
    if (!nav.children.length) return;
    const bord = hdr.getBoundingClientRect().right - parseFloat(getComputedStyle(hdr).paddingRight);
    if (droite.getBoundingClientRect().right > bord + 1) hdr.classList.add('squeeze');
  };
  if (window.ResizeObserver) { const ro = new ResizeObserver(fit); ro.observe(hdr); ro.observe(nav); ro.observe(noms); ro.observe(droite); }
  document.fonts?.ready.then(fit);   // les polices arrivées, les noms ont leur vraie largeur
  if (!document.querySelector('link[data-porte]')) {
    document.head.append(el('link', { rel: 'stylesheet', href: href('commun/porte.css'), 'data-porte': '' }));
  }
  // le nom : celui du compte (sans porte, le pseudo-admin du portail : le menu reste le même) ;
  // deux points discrets disent ce qui attend dans son menu — un calcul en cours (acier), une
  // demande à traiter pour Cal (ambre)
  const paintMe = (me) => {
    const mine = $('#sr-me', hdr);
    if (!me || !mine) return;
    mine.hidden = !me.user;
    if (!me.user) return;
    mine.querySelector('.sr-nm').textContent = me.user.name;
    const pend = me.user.role === 'admin' ? me.pending_requests || 0 : 0;
    mine.querySelector('.da').hidden = !pend;
    $('#sr-asset', hdr).hidden = me.user.role === 'invite';   // l'invité d'une planche n'a pas la bibliothèque
    paintFile();
  };
  // Le droit Studio (core/auth.py, « le Studio » ; /api/auth/me → studio, studioIci) : sans lui, les outils
  // Studio sont fermés — grisés, un cadenas, un clic mène à la demande ; sur une page Studio (servie par le
  // Worker de la porte, que le portail ne voit pas), la porte « réservé au Studio » la couvre. Le serveur juge
  // de son côté (pages, écritures, travaux) : ceci ne fait que le montrer.
  // un invité de planche (rôle `invite`) n'a pas le Studio, mais sa planche d'Idéation lui est ouverte :
  // le serveur l'exempte (_studio_only), l'en-tête aussi ; de même, l'outil dont un lien ouvre un
  // document à un compte sans le Studio (studioLiens : un ami « Apps » invité sur une planche)
  const studioOff = (me, x) => !!(me && me.user && me.user.role !== 'invite' && !studioIci(me)
    && x && x.tier === 'studio' && !x.open && !studioLiens(me).includes(x.id));
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
  paintFile();
  session().then((me) => {
    document.documentElement.classList.remove('sr-wait');
    if (me && me.auth && me.state !== 'active') return showDoor(me);
    paintMe(me);
    paintEspace();
    // un lien qui s'ouvre (…/ideation/?invite=<jeton>) : la page l'ouvre elle-même, puis se recharge ;
    // la porte « réservé au Studio » ne la couvre pas entre-temps (le serveur juge le jeton)
    if (studioOff(me, t) && !new URLSearchParams(location.search).has('invite')) import('./porte.js').then((m) => m.studioDoor(me, t));
    import('./prefs.js').then((m) => m.prefs.ready);   // les préférences de la personne, relues du portail
  });
  // La session relue toutes les 60 s (20 s avant le 06/10) : les Teams et Workspaces, les demandes à traiter (Admin),
  // le Studio ouvert ou fermé. Une porte qui se ferme (compte suspendu, connexion retirée) n'attend pas ce relevé :
  // toute requête refusée en 401 la montre aussitôt (api(), showDoor), la file comprise. Onglet caché, rien ; relue
  // dès son retour (releve).
  releve(() => (doorOn ? null : session(true).then(paintMe)), 60000);
  Promise.all([system(), session()]).then(([sys, me]) => {
    paintNav(me, sys);
    paintSys(sys);
  });
  jobs.watch((list) => {
    FILE_N = list.filter((j) => j.state === 'queued' || j.state === 'running').length;
    ss.set(FILE_KEY, FILE_N ? String(FILE_N) : null);
    paintFile();
    if ($('.drawer.on')) paintDrawer(list);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') drawer(false); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === ',' && !e.altKey) { e.preventDefault(); import('./prefs.js').then((m) => m.openPrefs(toolId)); }
  });
  raccourciPleinEcran(document);
  return hdr;
}

// ── le menu du nom ──────────────────────────────────────────
// Ce qui a quitté la barre (Cal, 30/09) : la file de rendu (une ligne, son compte en cours), les
// Teams et Workspaces (l'administration : admin/#teams), l'Admin (pour Cal), l'état des machines ;
// au téléphone, le Workspace aussi (la barre n'a plus sa place). Le reste du menu — le pseudo, se
// déconnecter — est celui du compte (commun/porte.js, account), qui reçoit ces lignes.
// L'état des machines et la file sont gardés pour l'onglet : la page suivante les a dès sa première image.
const SYS_KEY = 'sr-sys', FILE_KEY = 'sr-file';
let SYS = lu(SYS_KEY);
let FILE_N = Number(ss.get(FILE_KEY)) || 0;
function paintFile() {
  const b = document.getElementById('sr-me');
  if (!b) return;
  b.querySelector('.dq').hidden = !FILE_N;
  const pend = lastMe?.user?.role === 'admin' ? lastMe.pending_requests || 0 : 0;
  b.title = ['mon compte · la file, les Teams et Workspaces', FILE_N ? `${FILE_N} calcul${FILE_N > 1 ? 's' : ''} en file` : '',
    pend ? `${pend} demande${pend > 1 ? 's' : ''} à traiter (Admin)` : ''].filter(Boolean).join('\n');
}
function paintSys(sys, node = null) {
  if (sys !== undefined) {
    if (!sys) SYS = { c: 'err', t: 'portail injoignable', title: 'le portail ne répond pas' };
    else {
      const img = (sys.lanes.image || []);
      const up = img.filter((e) => e.up).map((e) => e.machine);
      const h3 = (sys.lanes.h3 || []).filter((e) => e.up).length;
      SYS = { c: up.length ? 'on' : 'err', t: up.length ? `${up.join(' + ')}${h3 ? ' · H3' : ''}` : 'aucune machine',
        title: img.map((e) => `${e.machine} ${e.up ? `prête · ${e.ram_free_gb ?? '?'} Go libres` : 'ne répond pas'}`).join('\n')
          + `\nH3 : ${h3 ? 'démarré' : 'arrêté (il se démarre à la demande)'}` };
    }
    ss.set(SYS_KEY, JSON.stringify(SYS));
  }
  if (node && SYS) { node.className = `sr-ml-sys pill ${SYS.c}`; node.querySelector('.r').textContent = SYS.t; node.title = SYS.title; }
}
/** Ouvrir la file de rendu (le tiroir) : le menu du nom, l'accueil. */
export function ouvrirFile() { drawer(true); }
function menuDuNom(btn) {
  session().then((me) => {
    if (!me || !me.user) return;
    import('./porte.js').then((m) => m.account(me, btn, lignesDuNom(me, m.fermerCompte)));
  });
}
function lignesDuNom(me, fermer) {
  const invite = me.user.role === 'invite';
  const pend = me.user.role === 'admin' ? me.pending_requests || 0 : 0;
  const ligne = (tag, attrs, label, r = '', cls = '') => el(tag, { class: `sr-ml-i${cls ? ' ' + cls : ''}`, role: 'menuitem', ...attrs },
    el('span', { class: 'n' }, label), r ? el('span', { class: 'r' }, r) : null);
  const cur = espaceCourant(me);
  const mach = invite ? null : el('div', { class: 'sr-ml-sys pill', role: 'note' }, el('i'), el('span', { class: 'n' }, 'Machines'), el('span', { class: 'r' }, '…'));
  if (mach) { paintSys(undefined, mach); sysInfo = null; system().then((s) => paintSys(s, mach)); }
  return [
    invite ? null : ligne('button', { type: 'button', onclick: () => { fermer(); drawer(true); } }, 'File de rendu', FILE_N ? `${FILE_N} en cours` : ''),
    // au téléphone seulement (shell.css) : le sélecteur de la barre n'y tient plus
    cur ? ligne('button', { type: 'button', 'aria-haspopup': 'menu', onclick: () => { fermer(); openWsMenu(btnNom()); } },
      'Workspace', `${cur.t.name ? cur.t.name + ' / ' : ''}${cur.s.name}`, 'sr-ml-ws') : null,
    invite ? null : ligne('a', { href: avecEspace(href('admin/#teams')) }, 'Teams et Workspaces'),
    me.user.role === 'admin' ? ligne('a', { href: avecEspace(href('admin/')) }, 'Admin', pend ? `${pend} à traiter` : '', pend ? 'amb' : '') : null,
    mach,
  ];
}
const btnNom = () => document.getElementById('sr-me');

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
  if (!box || !$('.drawer.on') || qBusy || ongletCache()) return;   // caché : relu au retour (plus bas)
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
  if ($('.drawer.on') && !ongletCache()) qT = setTimeout(paintDrawer, busy ? 1500 : 5000);
}
auRetour(() => { if ($('.drawer.on')) paintDrawer(); });

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
// document : tout ce qui n'est pas un média (05/10, server/tools/documents.py)
// playlist : une suite de sons de Musique (05/10, server/tools/playlist.py)
const KIND_FR = { image: 'image', video: 'vidéo', audio: 'son', element: 'élément', midi: 'MIDI', sequence: 'séquence', document: 'document',
  playlist: 'playlist' };
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
  // une page au coin plié : un document (PDF, texte, DOCX…), pas une image
  document: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6"/></svg>',
  // trois lignes et une croche : une playlist (une suite de sons), pas son image de pochette
  playlist: '<svg viewBox="0 0 24 24"><path d="M3 6h12M3 11h12M3 16h7M18 17V6l3-1M18 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/></svg>',
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
    // 'document' : tout fichier (un PDF, un texte, un fichier inconnu) ; sinon, les médias attendus
    const accept = kinds.includes('document') ? '' : [kinds.includes('image') || kinds.includes('element') ? 'image/*' : '', kinds.includes('video') ? 'video/*' : '',
      kinds.includes('audio') ? 'audio/*' : '', kinds.includes('midi') ? '.mid,.midi' : ''].filter(Boolean).join(',');
    const fileIn = el('input', { type: 'file', multiple: true, accept, hidden: true,
      onchange: async () => {
        for (const f of fileIn.files) {
          try {
            const it = await uploadFile(f, { tool: 'upload', via: 'selecteur' });
            // la sorte du portail n'est pas attendue ici (un PDF choisi par « tous les fichiers ») : rangé, pas pris
            if (!kinds.includes(it.kind)) { toast(`rangé dans la bibliothèque, pas pris ici : ${it.title || it.id} (${kindFr(it.kind)})`, 6000); continue; }
            chosen.set(it.id, it); if (!multiple) return close([it]);
          } catch (e) { toast(e.message); }
        }
        paintCount(); load();
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
