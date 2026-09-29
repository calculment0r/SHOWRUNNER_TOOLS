// ASSET — la bibliothèque commune du portail.
//
// Trois vues, portées par l'adresse :
//   asset/                la racine : dossiers et objets rangés nulle part
//   asset/#/d/<dossier>   un dossier ouvert
//   asset/#/corbeille     la corbeille
//   asset/#<id>           la fiche d'un objet (l'accueil y envoie)
//
// Les dossiers reprennent la maquette du 28/09 (Character_Factory,
// docs/img/maquettes/objets.html) et la demande de Cal : glisser une carte
// sur une autre crée un dossier (une fenêtre demande son nom), sur un
// dossier l'y range, sur « Asset » en haut l'en sort. Un dossier n'existe
// que par ses objets (champ `folder`, ARCHITECTURE.md §2), sur un niveau.
//
// La sélection (Cal, 29/09 : « les standards de sélection ») : clic pour
// choisir, double-clic pour ouvrir, ctrl/⌘+clic pour ajouter ou retirer,
// maj+clic pour une plage, glisser sur le fond pour une zone, ctrl+A,
// Échap. Dès qu'il y a une sélection, une barre d'outils s'ouvre en bas.
// Ce qu'on dépose de son disque entre avec `tool: 'upload'` et `via`
// (l'onglet « Uploads ») ; une carte-dossier et la planche d'un élément
// acceptent un dépôt (`dropZone` de shell.js).
import {
  mountHeader, api, pick, thumb, el, $, $$, href, ROOT, fmtDate, fmtDur, kindFr, etypeFr, dropAnywhere,
  dropZone, dragItem,
} from '../commun/shell.js';

mountHeader('asset');

// La même base d'API que shell.js (window.SR_API, sinon le portail) : le
// dépôt passe par XMLHttpRequest, seul moyen de suivre l'envoi d'un fichier.
const API = window.SR_API ? new URL(window.SR_API, location.href) : new URL('api/', ROOT);

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
const PREF = 'sr.asset.prefs';
const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch { return {}; } })();
const S = {
  kind: prefs.kind || '', sort: prefs.sort || 'new', size: prefs.size || 190,
  q: '', fav: false, tool: '', origin: '', folder: '', limit: 300,
  data: null, route: { view: 'lib' }, backHash: '#', item: null,
  sel: new Set(), anchor: null,   // la sélection, et d'où part une plage (maj+clic)
};
const savePrefs = () => { try { localStorage.setItem(PREF, JSON.stringify({ kind: S.kind, sort: S.sort, size: S.size })); } catch { /* navigation privée */ } };

const KINDS = [['', 'Tout'], ['image', 'Images'], ['element', 'Éléments'], ['video', 'Vidéos'], ['audio', 'Sons']];
const SORTS = [['new', 'récents'], ['old', 'anciens'], ['title', 'titre'], ['updated', 'modifiés']];
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
  upload: 'upload', asset: 'Asset', image: 'Image', movie: 'Movie Creator', 'character-factory': 'Character Factory',
  object: 'Object Creator', objet: 'Object Creator', montage: 'Montage', music: 'ODIO', musique: 'ODIO', odio: 'ODIO',
  analyse: 'Movie Analysis', upscale: 'Upscale', ideation: 'Idéation', selecteur: 'le sélecteur',
};
const toolFr = (t) => TOOL_FR[t] || t || 'upload';
const ORIGINS = [['', 'Tout'], ['made', 'Créations'], ['upload', 'Uploads']];
const MEDIA = ['image', 'video', 'audio'];
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const KIND_N = { image: ['image', 'images'], element: ['élément', 'éléments'], video: ['vidéo', 'vidéos'], audio: ['son', 'sons'] };

// ── l'adresse ────────────────────────────────────────────────
const ID_RX = /^(ima|vid|aud|ele)-\d{8}-\d{6}-[0-9a-f]{4}$/;
function parseHash() {
  let h = location.hash.slice(1);
  try { h = decodeURIComponent(h); } catch { /* adresse abîmée : la racine */ }
  if (!h) return { view: 'lib', folder: '' };
  if (h.startsWith('/d/')) return { view: 'lib', folder: h.slice(3) };
  if (h === '/corbeille') return { view: 'trash' };
  if (ID_RX.test(h)) return { view: 'sheet', id: h };
  return { view: 'lib', folder: '' };
}
const folderHash = (name) => (name ? '#/d/' + encodeURIComponent(name) : '#');
function go(hash) {
  if (S.route.view !== 'sheet' && hash.length > 1 && ID_RX.test(hash.slice(1))) S.backHash = location.hash || '#';
  if (location.hash === hash || (hash === '#' && !location.hash)) render();
  else location.hash = hash;
}

async function render() {
  const r = parseHash();
  S.route = r;
  closeMenu();
  libEl.hidden = r.view === 'sheet';
  sheetEl.hidden = r.view !== 'sheet';
  paintSel();                                  // la barre de sélection ne vit que sur la grille
  if (r.view === 'sheet') { window.scrollTo({ top: 0 }); return paintSheet(r.id); }
  if (r.view === 'trash') return paintTrash();
  if (S.folder !== r.folder) { S.q = ''; S.sel = new Set(); }
  S.folder = r.folder;
  buildLib();
  return loadLib();
}
addEventListener('hashchange', render);

// ── le bandeau, avec « annuler » ─────────────────────────────
let toastT;
function say(msg, undo = null, ms = 6000) {
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
  b.hidden = !undo;
  b.onclick = async () => {
    t.classList.remove('on');
    try { await undo(); live('annulé'); } catch (e) { say(e.message); }
  };
  t.classList.add('on');
  live(msg);
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), ms);
}

// ══ LA BIBLIOTHÈQUE ═════════════════════════════════════════
let parts = null;
function buildLib() {
  if (parts && libEl.contains(parts.grid)) return;
  const fileIn = el('input', { type: 'file', multiple: true, hidden: true, accept: 'image/*,video/*,audio/*',
    onchange: () => { uploadFiles([...fileIn.files], { folder: S.folder }); fileIn.value = ''; } });
  parts = {
    who: el('div', { class: 'who' }),
    acts: el('div', { class: 'acts' }),
    bar: el('div', { class: 'lib-bar', role: 'toolbar', 'aria-label': 'trier, filtrer' }),
    grid: el('div', { class: 'lib-grid', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': 'les objets' }),
    more: el('div', { class: 'row', style: { justifyContent: 'center' } }),
    fileIn,
  };
  const hint = el('p', { class: 'lib-hint lbl' },
    'clic : choisir · double-clic : ouvrir · ctrl/⌘ + clic : ajouter · maj + clic : une plage · glisser sur le fond : une zone · ctrl+A : tout · Échap : rien');
  libEl.replaceChildren(el('section', { class: 'lib-top' }, parts.who, parts.acts), parts.bar, hint, parts.grid, parts.more, fileIn);
  buildBar();
}

function buildBar() {
  const b = parts.bar;
  const search = el('input', { class: 'fld', type: 'search', placeholder: 'chercher : titre, prompt, tag, description', 'aria-label': 'chercher', value: S.q });
  let t;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { S.q = search.value.trim(); loadLib(); }, 220); });
  const sort = el('select', { class: 'fld', 'aria-label': 'trier' }, ...SORTS.map(([v, l]) => el('option', { value: v, selected: S.sort === v }, `tri · ${l}`)));
  sort.onchange = () => { S.sort = sort.value; savePrefs(); loadLib(); };
  const tool = el('select', { class: 'fld', 'aria-label': 'outil d\'origine' });
  tool.onchange = () => { S.tool = tool.value; loadLib(); };
  const size = el('input', { type: 'range', min: 120, max: 340, step: 10, value: S.size, 'aria-label': 'taille des vignettes' });
  size.oninput = () => { S.size = +size.value; parts.grid.style.setProperty('--card', `${S.size}px`); savePrefs(); };
  const fav = el('button', { class: 'tb ghost sm', type: 'button', 'aria-pressed': 'false', title: 'seulement les favoris' }, '★ Favoris');
  fav.onclick = () => { S.fav = !S.fav; loadLib(); };
  parts.crumbs = el('nav', { class: 'crumbs', 'aria-label': 'où' });
  parts.seg = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'sorte' });
  parts.oseg = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'origine : créé dans un outil ou déposé' });
  parts.search = search; parts.sort = sort; parts.tool = tool; parts.favBtn = fav;
  b.replaceChildren(parts.crumbs, parts.seg, parts.oseg, fav, tool, sort, el('span', { class: 'sp' }), search,
    el('label', { class: 'size', title: 'taille des vignettes' }, el('span', { class: 'lbl' }, 'taille'), size),
    el('a', { class: 'tb ghost sm', href: '#/corbeille', title: 'les objets jetés, qu\'on peut rétablir' }, 'Corbeille'));
  parts.grid.style.setProperty('--card', `${S.size}px`);
}

let loadSeq = 0;
async function loadLib({ append = false } = {}) {
  const p = new URLSearchParams({ sort: S.sort, limit: S.limit, offset: append ? S.data.items.length : 0 });
  if (S.kind) p.set('kind', S.kind);
  if (S.q) p.set('q', S.q);
  if (S.fav) p.set('fav', '1');
  if (S.tool) p.set('tool', S.tool);
  if (S.origin) p.set('origin', S.origin);
  if (S.folder) p.set('folder', S.folder);
  const seq = ++loadSeq;
  let d;
  try { d = await api('asset/view?' + p); } catch (e) {
    parts.grid.replaceChildren(el('p', { class: 'warn' }, `la bibliothèque ne répond pas : ${e.message}`));
    return;
  }
  if (seq !== loadSeq) return;
  if (append) { S.data.items.push(...d.items); S.data.total = d.total; } else S.data = d;
  // la sélection ne garde que ce qui est encore à l'écran
  const shown = new Set(S.data.items.map((i) => i.id));
  S.sel = new Set([...S.sel].filter((id) => shown.has(id)));
  paintTop(); paintBar(); paintGrid(); paintSel(true);
}

function paintTop() {
  const d = S.data;
  const n = Object.values(d.counts).reduce((a, b) => a + b, 0);
  if (S.folder) {
    parts.who.replaceChildren(
      el('span', { class: 'kicker' }, `dossier · ${plural(n, 'objet', 'objets')}`),
      el('h1', { class: 'lib-h', 'data-rename': '', title: 'renommer', tabindex: 0, onclick: renameInline,
        onkeydown: (e) => { if (e.key === 'Enter') renameInline(); } }, S.folder),
      el('span', { class: 'lbl' }, countLine(d.counts)));
    parts.acts.replaceChildren(
      el('button', { class: 'tb ghost', type: 'button', onclick: renameInline }, 'Renommer'),
      el('button', { class: 'tb ghost', type: 'button', title: 'remettre ses objets à la racine ; le dossier disparaît', onclick: () => emptyFolder(S.folder) }, 'Vider le dossier'),
      parts.dropBtn = el('button', { class: 'tb go', type: 'button', onclick: () => parts.fileIn.click(), title: 'ou glisser des fichiers n\'importe où sur la page' }, 'Déposer ici'));
    if (S.renameOnLoad === S.folder) { S.renameOnLoad = null; renameInline(); }
  } else {
    parts.who.replaceChildren(
      el('span', { class: 'kicker' }, 'SR—00 · la bibliothèque'),
      el('h1', { class: 'lib-h' }, 'Asset'),
      el('span', { class: 'lbl' }, `${plural(d.library_total, 'objet', 'objets')} · ${plural(d.all_folders.length, 'dossier', 'dossiers')} · ${countLine(d.counts)}`));
    parts.acts.replaceChildren(
      el('button', { class: 'tb ghost', type: 'button', onclick: cfModal, title: 'un personnage du studio devient un élément' }, 'Importer de Character Factory'),
      el('button', { class: 'tb ghost', type: 'button', onclick: () => elementModal({}) }, 'Nouvel élément'),
      parts.dropBtn = el('button', { class: 'tb go', type: 'button', onclick: () => parts.fileIn.click(), title: 'ou glisser des fichiers n\'importe où sur la page' }, 'Déposer des fichiers'));
  }
}

function countLine(c) {
  return Object.entries(KIND_N).filter(([k]) => c[k]).map(([k, [one, many]]) => plural(c[k], one, many)).join(' · ') || 'vide';
}

function paintBar() {
  const d = S.data;
  const crumbs = [];
  if (S.folder || S.q) {
    crumbs.push(el('a', { class: 'crumb', href: '#', 'data-drop-root': '', title: S.folder ? 'la racine — glisser une carte ici pour la sortir du dossier' : 'la racine',
      onclick: (e) => { e.preventDefault(); S.q = ''; parts.search.value = ''; go('#'); } }, 'Asset'));
    if (S.folder) crumbs.push(el('span', { class: 'lbl' }, '/'), el('span', { class: 'crumb cur' }, S.folder));
    if (S.q) crumbs.push(el('span', { class: 'lbl' }, '/'), el('span', { class: 'crumb cur' }, `« ${S.q} »`));
  } else crumbs.push(el('span', { class: 'crumb cur' }, 'Asset'));
  parts.crumbs.replaceChildren(...crumbs);
  const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
  parts.seg.replaceChildren(...KINDS.map(([k, lab]) => el('button', {
    class: 'tb' + (S.kind === k ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(S.kind === k),
    onclick: () => { S.kind = k; savePrefs(); loadLib(); },
  }, lab, el('b', {}, String(k ? d.counts[k] : total)))));
  const o = d.origins || { upload: 0, made: 0 };
  parts.oseg.replaceChildren(...ORIGINS.map(([k, lab]) => el('button', {
    class: 'tb' + (S.origin === k ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(S.origin === k),
    title: k === 'upload' ? 'ce qu\'on a déposé de son disque' : k === 'made' ? 'ce que les outils ont fabriqué' : 'tout',
    onclick: () => { S.origin = k; loadLib(); },
  }, lab, el('b', {}, String(k ? o[k] : o.upload + o.made)))));
  parts.favBtn.classList.toggle('on', S.fav);
  parts.favBtn.setAttribute('aria-pressed', String(S.fav));
  const tools = Object.entries(d.tools).sort((a, b) => b[1] - a[1]);
  parts.tool.replaceChildren(el('option', { value: '' }, 'tous les outils'),
    ...tools.map(([t, n]) => el('option', { value: t, selected: S.tool === t }, `${toolFr(t)} · ${n}`)));
  if (S.tool && !d.tools[S.tool]) parts.tool.append(el('option', { value: S.tool, selected: true }, toolFr(S.tool)));
  if (parts.sort.value !== S.sort) parts.sort.value = S.sort;
  if (document.activeElement !== parts.search && parts.search.value.trim() !== S.q) parts.search.value = S.q;
}

function paintGrid() {
  const d = S.data;
  const cards = [...d.folders.map(folderCard), ...d.items.map((it) => itemCard(it, { search: !!S.q }))];
  if (!cards.length) {
    const filtered = S.kind || S.fav || S.tool || S.q || S.origin;
    cards.push(el('div', { class: 'empty-state', style: { gridColumn: '1 / -1' } },
      el('b', {}, S.origin === 'upload' && !S.kind && !S.q ? 'Aucun upload ici' : filtered ? 'Rien avec ces filtres' : S.folder ? 'Ce dossier est vide' : 'La bibliothèque est vide'),
      el('p', { class: 'hint' }, S.origin === 'upload' ? 'Ce qu\'on dépose de son disque — ici ou dans n\'importe quel outil — arrive dans cet onglet.'
        : filtered ? 'Change de sorte ou d\'origine, retire les favoris ou la recherche.'
        : 'Dépose des fichiers n\'importe où sur la page, importe un personnage de Character Factory, ou crée une image dans Image.')));
  }
  parts.grid.replaceChildren(...cards);
  const shown = d.items.length;
  parts.more.replaceChildren(...(d.total > shown ? [
    el('span', { class: 'lbl' }, `${shown} sur ${d.total}`),
    el('button', { class: 'tb ghost sm', type: 'button', onclick: () => loadLib({ append: true }) }, 'Voir la suite')] : []));
}

// ── les cartes ───────────────────────────────────────────────
function wave(n = 9) {
  const hs = [38, 62, 84, 55, 96, 70, 44, 78, 52, 66, 90, 48];
  return el('span', { class: 'wave', 'aria-hidden': 'true' }, ...Array.from({ length: n }, (_, k) => el('i', { style: { height: `${hs[k % hs.length]}%` } })));
}

function subOf(it) {
  if (it.kind === 'element') return `${plural(it.element?.refs?.length || 0, 'réf.', 'réf.')}${it.element?.voices?.length ? ' · voix' : ''}${it.element?.meshes?.length ? ' · 3D' : ''} · ${toolFr(it.origin?.tool)}`;
  return [it.width && it.height ? `${it.width}×${it.height}` : '', it.origin?.model || toolFr(it.origin?.tool)].filter(Boolean).join(' · ');
}

function itemCard(it, { search = false } = {}) {
  const t = thumb(it, { sub: subOf(it), onclick: (e) => onCardClick(e, it) });
  // le glisser d'une carte est celui de la page (ranger, dossiers), pas celui du navigateur
  t.draggable = false;
  t.setAttribute('aria-label', `${it.kind === 'element' ? etypeFr(it.element?.type) : kindFr(it.kind)} ${it.title}`);
  t.addEventListener('dblclick', () => go('#' + it.id));
  t.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go('#' + it.id); }
    if (e.key === ' ') { e.preventDefault(); toggleSel(it.id); }
  });
  const im = $('.im', t);
  if (it.kind === 'audio' && !it.thumb_url) im.prepend(wave());
  if (it.kind === 'element' && !it.thumb_url) im.prepend(el('span', { class: 'noimg' }, 'sans image'));
  if (it.fav) im.append(el('span', { class: 'star', title: 'favori' }, '★'));
  if (search && it.folder) im.append(el('span', { class: 'where', title: 'dans ce dossier' }, it.folder));
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
  return el('div', { class: 'acard' + (on ? ' sel' : ''), 'data-id': it.id, role: 'option', 'aria-selected': String(on) }, t,
    el('button', { class: 'chk', type: 'button', 'aria-pressed': String(on), title: 'choisir (ctrl/⌘ + clic)', 'aria-label': `choisir ${it.title}`,
      onclick: (e) => { e.stopPropagation(); toggleSel(it.id); } }),
    el('button', { class: 'menu-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'ranger',
      'aria-label': `ranger ${it.title}`, onclick: (e) => { e.stopPropagation(); toggleMenu(e.currentTarget, itemMenu(it)); } }, '⋯'));
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

function miniOf(m) {
  const pic = m.thumb_url ? el('img', { src: href(m.thumb_url), alt: '', loading: 'lazy' })
    : m.kind === 'audio' ? wave(5) : null;
  return el('span', { class: 'mini' + (m.kind === 'element' ? ' el' : ''), title: m.title }, pic, el('i', {}, m.title));
}

function folderCard(f) {
  const shown = f.count > 4 ? f.preview.slice(0, 3) : f.preview;
  const cells = shown.map(miniOf);
  if (f.count > 4) cells.push(el('span', { class: 'mini more' }, `+${f.count - 3}`));
  while (cells.length < 4) cells.push(el('span', { class: 'mini empty' }));
  const kinds = Object.entries(KIND_N).filter(([k]) => f.kinds[k]).map(([k, [one, many]]) => plural(f.kinds[k], one, many)).join(' · ');
  const b = el('button', { class: 'thumb folder', type: 'button', title: `ouvrir « ${f.name} »`,
    'aria-label': `dossier ${f.name}, ${plural(f.total, 'objet', 'objets')}`,
    onclick: () => { if (!suppressClick) go(folderHash(f.name)); } },
  el('div', { class: 'im' }, ...cells),
  el('div', { class: 'cap' }, el('div', { class: 't' }, f.name), el('div', { class: 's' }, kinds || plural(f.total, 'objet', 'objets'))));
  const card = el('div', { class: 'acard folder', 'data-folder': f.name, role: 'option', 'aria-selected': 'false' },
    el('span', { class: 'ftab kicker' }, 'dossier'), b,
    el('button', { class: 'menu-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'le dossier',
      'aria-label': `dossier ${f.name}`, onclick: (e) => { e.stopPropagation(); toggleMenu(e.currentTarget, folderMenu(f)); } }, '⋯'));
  // un fichier lâché sur un dossier y entre (catégorie Upload) ; une vignette glissée d'ailleurs aussi
  dropZone(card, { kinds: ['image', 'video', 'audio', 'element'], via: 'asset',
    onitems: (items) => moveItems(items.map((i) => i.id), f.name, `${plural(items.length, 'objet rangé', 'objets rangés')} dans « ${f.name} »`) });
  return card;
}

// ── ranger ───────────────────────────────────────────────────
async function moveItems(ids, folder, msg) {
  try {
    const r = await api('asset/move', { method: 'POST', body: { ids, folder } });
    say(msg, async () => {
      const by = {};
      for (const m of r.moved) (by[m.from] ||= []).push(m.id);
      for (const [from, list] of Object.entries(by)) await api('asset/move', { method: 'POST', body: { ids: list, folder: from } });
      refresh();
    });
  } catch (e) { say(e.message); }
  refresh();
}

function refresh() {
  if (S.route.view === 'lib') loadLib();
  else if (S.route.view === 'sheet') paintSheet(S.route.id, { keepScroll: true });
}

async function folderIds(name) {
  const d = await api('asset/view?' + new URLSearchParams({ folder: name, limit: 2000 }));
  return d.items.map((i) => i.id);
}

async function emptyFolder(name) {
  const ids = await folderIds(name);
  if (!ids.length) return;
  await moveItems(ids, '', `« ${name} » vidé : ${plural(ids.length, 'objet remis', 'objets remis')} à la racine`);
  if (S.folder === name) go('#');
}

function renameInline() {
  const old = S.folder;
  const inp = el('input', { class: 'fld', value: old, maxlength: 60, 'aria-label': 'nom du dossier', spellcheck: 'false' });
  const f = el('form', { class: 'rename-f' }, inp, el('button', { class: 'tb ghost sm', type: 'submit' }, 'OK'));
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = inp.value.trim();
    if (!v || v === old) return paintTop();
    try {
      const r = await api('asset/folders/rename', { method: 'POST', body: { from: old, to: v } });
      // une fusion avec un dossier qui existait ne se défait pas d'un clic : pas d'« annuler »
      say(r.merged ? `« ${old} » fondu dans « ${r.folder} », qui existait déjà` : `Renommé « ${r.folder} »`, r.merged ? null : async () => {
        await api('asset/folders/rename', { method: 'POST', body: { from: r.folder, to: old } });
        go(folderHash(old));
      });
      go(folderHash(r.folder));
    } catch (err) { say(err.message); }
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Escape') paintTop(); });
  $('.lib-h', parts.who)?.replaceWith(f);
  inp.focus(); inp.select();
}

// ── le menu d'une carte (ranger sans glisser) ────────────────
let menuFor = null;
function itemMenu(it) {
  const here = it.folder || '';
  const others = (S.data?.all_folders || []).filter((f) => f !== here);
  return {
    title: `ranger · ${it.title}`,
    items: [
      { label: 'Ouvrir la fiche', do: () => go('#' + it.id) },
      '-',
      ...others.map((f) => ({ label: `Dans « ${f} »`, dir: true, do: () => moveItems([it.id], f, `${it.title} rangé dans « ${f} »`) })),
      { label: 'Dans un nouveau dossier…', dir: true, do: () => askFolderName([it]) },
      here ? { label: `Sortir de « ${here} »`, do: () => moveItems([it.id], '', `${it.title} sorti de « ${here} »`) } : null,
      '-',
      { label: it.fav ? 'Retirer des favoris' : 'Mettre en favori', do: () => setFav(it, !it.fav) },
      { label: 'Mettre à la corbeille', do: () => trashItem(it) },
    ].filter(Boolean),
  };
}
function folderMenu(f) {
  return {
    title: `dossier · ${f.name}`,
    items: [
      { label: 'Ouvrir', do: () => go(folderHash(f.name)) },
      { label: 'Renommer', do: () => { S.renameOnLoad = f.name; go(folderHash(f.name)); } },
      '-',
      { label: `Vider le dossier · ${plural(f.total, 'objet', 'objets')} à la racine`, do: () => emptyFolder(f.name) },
    ],
  };
}

function toggleMenu(btn, spec) {
  if (menuFor?.btn === btn) return closeMenu(true);
  closeMenu();
  const m = el('div', { class: 'cmenu', role: 'menu' }, el('span', { class: 'lbl' }, spec.title),
    ...spec.items.map((x) => (x === '-' ? el('hr') : el('button', { role: 'menuitem', type: 'button', disabled: x.disabled,
      onclick: () => { closeMenu(); x.do(); } }, x.dir ? el('span', { class: 'dir' }) : null, x.label))));
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
// défile. Sur une carte : un nouveau dossier ; sur un dossier : dedans ;
// sur « Asset » en haut : hors du dossier. Échap annule. (maquette du 28/09)
let drag = null;
let suppressClick = false;

function clearMarks() {
  $$('.drop-into, .drop-merge').forEach((n) => n.classList.remove('drop-into', 'drop-merge'));
  $$('.drop-say').forEach((n) => n.remove());
  $$('.crumb.drop-ok').forEach((n) => n.classList.remove('drop-ok'));
}

function startDrag(e) {
  drag.started = true;
  const r = drag.card.getBoundingClientRect();
  const g = drag.card.cloneNode(true);
  g.classList.add('drag-ghost');
  g.removeAttribute('data-id');
  $$('video', g).forEach((v) => v.remove());
  const w = Math.min(r.width, 150);
  g.style.width = `${r.width}px`;
  g.style.transformOrigin = '0 0';
  g.style.transform = `scale(${w / r.width}) rotate(-2.5deg)`;
  $$('.chk, .menu-btn', g).forEach((n) => n.remove());
  if (drag.ids.length > 1) g.append(el('span', { class: 'drag-count' }, String(drag.ids.length)));
  document.body.append(g);
  drag.ghost = g;
  for (const id of drag.ids) $(`.acard[data-id="${id}"]`, parts.grid)?.classList.add('lifting');
  document.body.classList.add('dragging');
  $$('.crumb[data-drop-root]').forEach((c) => c.classList.add('drop-armed'));
  live(`${drag.ids.length > 1 ? plural(drag.ids.length, 'objet', 'objets') : drag.title} saisi. Relâche sur une carte, un dossier, ou Échap pour annuler.`);
  moveDrag(e);
}

function moveDrag(e) {
  drag.ghost.style.left = `${e.clientX + 14}px`;
  drag.ghost.style.top = `${e.clientY + 14}px`;
  clearMarks();
  drag.target = null;
  const at = document.elementFromPoint(e.clientX, e.clientY);
  const crumb = at?.closest('.crumb[data-drop-root]');
  if (crumb && S.folder) { crumb.classList.add('drop-ok'); drag.target = { kind: 'out' }; return; }
  const f = at?.closest('.acard.folder');
  if (f) {
    f.classList.add('drop-into');
    f.append(el('span', { class: 'drop-say' }, 'ranger ici'));
    drag.target = { kind: 'into', folder: f.dataset.folder };
  } else {
    const t = at?.closest('.acard[data-id]');
    if (t && !drag.ids.includes(t.dataset.id) && !S.folder && !S.q) {
      t.classList.add('drop-merge');
      t.append(el('span', { class: 'drop-say' }, 'nouveau dossier'));
      drag.target = { kind: 'merge', id: t.dataset.id };
    }
  }
  const edge = 70;
  if (e.clientY < edge) scrollBy(0, -14);
  else if (e.clientY > innerHeight - edge) scrollBy(0, 14);
}

function endDrag(cancel) {
  const d = drag;
  drag = null;
  clearMarks();
  d.ghost?.remove();
  $$('.acard.lifting').forEach((n) => n.classList.remove('lifting'));
  document.body.classList.remove('dragging');
  $$('.crumb.drop-armed').forEach((c) => c.classList.remove('drop-armed'));
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 80);
  if (cancel || !d.target) { live('déplacement annulé'); return; }
  const items = d.ids.map((id) => S.data.items.find((x) => x.id === id)).filter(Boolean);
  const what = items.length > 1 ? plural(items.length, 'objet', 'objets') : items[0].title;
  const t = d.target;
  if (t.kind === 'into') moveItems(d.ids, t.folder, `${what} rangé${items.length > 1 ? 's' : ''} dans « ${t.folder} »`);
  if (t.kind === 'out') moveItems(d.ids, '', `${what} sorti${items.length > 1 ? 's' : ''} de « ${S.folder} »`);
  if (t.kind === 'merge') askFolderName([S.data.items.find((x) => x.id === t.id), ...items]);
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
  drag = { id: card.dataset.id, ids, title: it?.title || '', card, x0: e.clientX, y0: e.clientY, started: false, touch: e.pointerType !== 'mouse' };
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
  const sig = `${items.map((i) => `${i.id}${i.fav ? '*' : ''}`).join(',')}|${(S.data?.all_folders || []).join('/')}`;
  if (bar && sig === selSig && !force) return;
  selSig = sig;
  const n = items.length;
  const counts = {};
  for (const i of items) counts[i.kind] = (counts[i.kind] || 0) + 1;
  const imgs = items.filter((i) => i.kind === 'image');
  const ups = items.filter((i) => i.kind === 'image' || i.kind === 'video');
  const one = n === 1 ? items[0] : null;
  const allFav = n > 0 && items.every((i) => i.fav);
  const b = (label, onclick, { key = '', title = '', disabled = false, go: orange = false } = {}) =>
    el('button', { class: `tb ${orange ? 'go' : 'ghost'} sm`, type: 'button', disabled, onclick,
      title: `${title}${key ? ` · ${key}` : ''}`, 'aria-keyshortcuts': key || null }, label);
  // le clic ne remonte pas : la page fermerait aussitôt le menu qu'il ouvre
  const moveBtn = b('Déplacer ▾', (e) => { e.stopPropagation(); toggleMenu(e.currentTarget, moveMenu(items)); }, { title: 'vers un dossier, ou à la racine' });
  moveBtn.setAttribute('aria-haspopup', 'menu');
  const nextBar = el('div', { class: 'selbar', role: 'toolbar', 'aria-label': 'la sélection' },
    el('div', { class: 'cnt' }, el('b', {}, String(n)),
      el('span', { class: 'lbl' }, `${n > 1 ? 'choisis' : 'choisi'}${countLine(counts) !== 'vide' ? ` · ${countLine(counts)}` : ''}`)),
    b('Tout', selectAll, { key: 'Ctrl+A', title: 'choisir tout ce qui est affiché' }),
    el('span', { class: 'sep' }),
    b('Télécharger', () => download(items), { go: true, key: 'T',
      title: one && one.kind !== 'element' ? 'le fichier' : 'un zip, fait par DGX2 qui a les fichiers ; un élément apporte ses références' }),
    b('Créer un dossier', () => askFolderName(items), { key: 'N', title: 'un dossier neuf avec la sélection ; son nom est demandé' }),
    moveBtn,
    b(allFav ? '☆ Retirer des favoris' : '★ Favori', () => bulkFav(items, !allFav), { key: 'F' }),
    b('Tags', () => tagsModal(items), { title: 'ajouter ou retirer un tag sur toute la sélection' }),
    b('Faire un élément', () => elementModal({ items: imgs, title: imgs[0]?.title || '', folder: commonFolder(imgs) }), {
      disabled: !imgs.length,
      title: imgs.length ? `un élément avec ${plural(imgs.length, 'image', 'images')} en références` : 'aucune image dans la sélection : un élément se fait d\'images' }),
    b('Agrandir', () => { location.href = href(`upscale/?src=${ups.map((i) => i.id).join(',')}`); }, {
      disabled: !ups.length,
      title: !ups.length ? 'Upscale prend des images et des vidéos : il n\'y en a pas dans la sélection'
        : ups.length < n ? `Upscale : les ${plural(ups.length, 'image ou vidéo', 'images et vidéos')} de la sélection seulement` : 'Upscale : agrandir et affiner' }),
    b('Ajouter au montage', () => { location.href = href(`montage/?add=${encodeURIComponent(one.id)}`); }, {
      disabled: !(one && MEDIA.includes(one.kind)),
      title: one && MEDIA.includes(one.kind) ? 'Montage : au bout de la piste' : n > 1
        ? 'le montage prend un objet à la fois par son adresse (?add=) : n\'en choisis qu\'un' : 'une image, une vidéo ou un son' }),
    one ? b('Ouvrir', () => go('#' + one.id), { key: 'Entrée', title: 'sa fiche' }) : null,
    b('Corbeille', () => trashMany(items), { key: 'Suppr', title: 'à la corbeille ; « annuler » dans le bandeau' }),
    el('button', { class: 'x', type: 'button', title: 'ne plus rien choisir · Échap', 'aria-label': 'vider la sélection', onclick: clearSel }, '×'));
  if (bar) bar.replaceWith(nextBar); else document.body.append(nextBar);
}

function commonFolder(items) {
  const f = new Set(items.map((i) => i.folder || ''));
  return f.size === 1 ? [...f][0] : '';
}

function moveMenu(items) {
  const here = new Set(items.map((i) => i.folder || ''));
  const ids = items.map((i) => i.id);
  const what = plural(items.length, 'objet', 'objets');
  return {
    title: `déplacer · ${what}`,
    items: [
      ...(S.data?.all_folders || []).filter((f) => !(here.size === 1 && here.has(f)))
        .map((f) => ({ label: `Dans « ${f} »`, dir: true, do: () => moveItems(ids, f, `${what} dans « ${f} »`).then(clearSel) })),
      { label: 'Dans un nouveau dossier…', dir: true, do: () => askFolderName(items) },
      [...here].some(Boolean) ? { label: 'À la racine', do: () => moveItems(ids, '', `${what} remis à la racine`).then(clearSel) } : null,
    ].filter(Boolean),
  };
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

async function bulkFav(items, on) {
  try {
    const r = await api('asset/bulk', { method: 'POST', body: { ids: items.map((i) => i.id), fav: on } });
    say(on ? `${plural(items.length, 'objet', 'objets')} en favori` : `${plural(items.length, 'objet retiré', 'objets retirés')} des favoris`,
      async () => { await api('asset/bulk', { method: 'POST', body: { restore: r.before } }); refresh(); });
  } catch (e) { say(e.message); }
  refresh();
}

function tagsModal(items) {
  const ids = items.map((i) => i.id);
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
      const r = await api('asset/bulk', { method: 'POST', body: { ids, ...body } });
      const fresh = await Promise.all(ids.map((id) => api('library/' + id).catch(() => null)));
      fresh.forEach((f, k) => { if (f) items[k].tags = f.tags; });
      paint();
      say(msg, async () => { await api('asset/bulk', { method: 'POST', body: { restore: r.before } }); refresh(); });
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
      el('p', { class: 'hint' }, 'Entrée ajoute ; × retire de toute la sélection. Chaque geste s\'annule dans le bandeau.')],
    foot: [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Fermer')],
    onclose: refresh,
  });
  setTimeout(() => inp.focus(), 30);
}

async function trashMany(items) {
  const ids = items.map((i) => i.id);
  try {
    await api('asset/trash', { method: 'POST', body: { ids } });
    clearSel();
    say(`${plural(ids.length, 'objet', 'objets')} à la corbeille`, async () => {
      await api('asset/restore', { method: 'POST', body: { ids } });
      refresh();
    }, 8000);
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
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); trashMany(items); }
  else if (k === 't') download(items);
  else if (k === 'n') { e.preventDefault(); askFolderName(items); }
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

function askFolderName(items) {
  const inp = el('input', { class: 'fld big-fld', maxlength: 60, placeholder: 'Planches MJ, Lycée, affaires de Seed…', spellcheck: 'false', 'aria-label': 'nom du dossier' });
  const pending = el('div', { class: 'pending' }, ...items.flatMap((it, k) => [k ? el('span', { class: 'arrow' }, '+') : null, miniOf(it)]),
    el('span', { class: 'arrow' }, '→ un dossier'));
  const form = el('form', { id: 'mf-form', autocomplete: 'off', style: { display: 'contents' } },
    el('label', { class: 'new-q', for: 'mf-name' }, 'Comment s\'appelle ce dossier ?'), pending, inp,
    el('p', { class: 'hint' }, 'Le nom se change ensuite d\'un clic sur le titre du dossier. Un dossier tient des images, des éléments, des vidéos et des sons — pas d\'autre dossier.'));
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
    await moveItems(items.map((i) => i.id), name, `Dossier « ${name} » créé avec ${plural(items.length, 'objet', 'objets')}`);
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
function elementModal({ items = [], title = '', etype = 'character', folder = null }) {
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
    el('p', { class: 'hint' }, 'Un élément s\'appelle ensuite comme référence dans Image et Movie Creator, comme une image.'));
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
      const it = await api('elements', { method: 'POST', body: {
        title: t, type, description: desc.value.trim(), folder: folder ?? (S.route.view === 'lib' ? S.folder : ''),
        refs: chosen.map((c, k) => ({ item: c.id, role: role.value, label: type === 'object' && k === 0 ? 'face · 0°' : '' })) } });
      m.close();
      say(`Élément « ${it.title} » créé`);
      go('#' + it.id);
    } catch (err) { say(err.message); }
  };
  setTimeout(() => name.focus(), 30);
}

// ── favori, corbeille ────────────────────────────────────────
async function setFav(it, on) {
  try { await api('library/' + it.id, { method: 'POST', body: { fav: on } }); it.fav = on; say(on ? `${it.title} en favori` : `${it.title} n'est plus en favori`); } catch (e) { say(e.message); }
  refresh();
}

async function trashItem(it, { leave = false } = {}) {
  try {
    await api(`library/${it.id}/delete`, { method: 'POST' });
    say(`« ${it.title} » est à la corbeille`, async () => {
      await api(`library/${it.id}/restore`, { method: 'POST' });
      if (leave) go('#' + it.id); else refresh();
    }, 8000);
    if (leave) go(S.backHash || '#'); else refresh();
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
    prog: (f) => { bar.style.width = `${Math.round(f * 100)}%`; st.textContent = f < 1 ? `envoi · ${Math.round(f * 100)} %` : 'rangement'; },
    done: (msg) => { row.classList.add('done'); bar.style.width = '100%'; st.textContent = msg; },
    fail: (msg) => { row.classList.add('err'); st.textContent = msg; },
  };
}
const fmtSize = (b) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} Ko` : `${(b / 1048576).toFixed(1).replace('.', ',')} Mo`);

function xhrUpload(file, folder, onprog) {
  return new Promise((resolve, reject) => {
    // un dépôt du disque : catégorie Upload, entré par Asset (shell.js : uploadFile, même contrat)
    const q = new URLSearchParams({ name: file.name, tool: 'upload', via: 'asset', folder, title: file.name.replace(/\.[^.]+$/, '') });
    const x = new XMLHttpRequest();
    x.open('PUT', new URL('library/upload?' + q, API));
    x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
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
async function uploadFiles(files, { folder = '', then } = {}) {
  clearTimeout(upClear);
  const done = [];
  for (const f of files) {
    const r = upRow(f);
    try {
      const it = await xhrUpload(f, folder, r.prog);
      r.done(`rangé${folder ? ` dans « ${folder} »` : ''}`);
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
  for (const x of imgs) await api(`elements/${it.id}/refs`, { method: 'POST', body: { item: x.id, role: S.addRole || 'detail', label: '' } });
  if (snd) await setVoice(it, snd, { repaint: false });
  if (imgs.length) say(`${plural(imgs.length, 'référence ajoutée', 'références ajoutées')} à ${it.title} · rôle ${roleFr(S.addRole)}`);
  if (imgs.length + (snd ? 1 : 0) < items.length) say('une référence est une image, une voix est un son : le reste est rangé dans la bibliothèque');
}

// la voix d'un élément : un son ; s'il en avait une, elle est remplacée (« annuler » la remet)
async function setVoice(it, snd, { repaint = true } = {}) {
  const before = (it.element.voices || []).map((v) => ({ file: v.file, label: v.label, item: v.item }));
  try {
    const n = await api(`elements/${it.id}/refs`, { method: 'POST', body: { item: snd.id, role: 'voice', label: snd.title || 'voix' } });
    const vs = n.element.voices || [];
    const added = vs[vs.length - 1];
    if (before.length) await api(`asset/refs/${it.id}`, { method: 'POST', body: { voices: [{ file: added.file, label: added.label, item: added.item }] } });
    say(before.length ? `voix remplacée : ${added.label}` : `voix ajoutée : ${added.label}`, before.length ? async () => {
      await api(`asset/refs/${it.id}`, { method: 'POST', body: { voices: before } });
      paintSheet(it.id, { keepScroll: true });
    } : null);
  } catch (e) { say(e.message); }
  if (repaint) paintSheet(it.id, { keepScroll: true });
}

// Déposé ailleurs que sur un emplacement : dans la bibliothèque (le dossier
// ouvert) ; sur la fiche d'un élément, ses références.
dropAnywhere((files) => {
  if (S.route.view === 'sheet' && S.item?.kind === 'element') {
    const it = S.item;
    return uploadFiles(files, { folder: it.folder || '', then: (items) => addRefs(it, items) });
  }
  return uploadFiles(files, { folder: S.route.view === 'lib' ? S.folder : '' });
});

// ══ LA FICHE ════════════════════════════════════════════════
async function paintSheet(id, { keepScroll = false } = {}) {
  const y = scrollY;
  if (!keepScroll) sheetEl.replaceChildren(el('p', { class: 'lbl' }, 'chargement'));
  let it;
  try { it = await api('library/' + id); } catch (e) {
    S.item = null;
    sheetEl.replaceChildren(backLink(), el('div', { class: 'empty-state' }, el('b', {}, 'Introuvable'),
      el('p', { class: 'hint' }, `${id} n'est pas dans la bibliothèque (${e.message}). Il est peut-être à la corbeille.`),
      el('a', { class: 'tb ghost', href: '#/corbeille' }, 'Voir la corbeille')));
    return;
  }
  S.item = it;
  if (!S.data) api('asset/view?limit=1').then((d) => { S.data = d; paintDatalist(); }).catch(() => {});
  sheetEl.replaceChildren(...(it.kind === 'element' ? elementSheet(it) : itemSheet(it)));
  paintDatalist();
  if (keepScroll) scrollTo({ top: y });
}

function backLink() {
  const h = S.backHash || '#';
  let lab = 'Asset';
  if (h.startsWith('#/d/')) { try { lab = `Asset / ${decodeURIComponent(h.slice(4))}`; } catch { /* rien */ } }
  if (h === '#/corbeille') lab = 'Corbeille';
  return el('a', { class: 'o-back', href: h }, `‹ ${lab} · échap`);
}

async function patch(it, body) {
  const n = await api('library/' + it.id, { method: 'POST', body });
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
    try { await patch(it, { title: v }); flash(saved); } catch (e) { say(e.message); title.value = it.title; }
  });
  const star = el('button', { class: 'tb ghost star-btn' + (it.fav ? ' on' : ''), type: 'button', 'aria-pressed': String(!!it.fav), title: 'favori' },
    it.fav ? '★ favori' : '☆ favori');
  star.onclick = async () => {
    try {
      await patch(it, { fav: !it.fav });
      star.classList.toggle('on', it.fav); star.setAttribute('aria-pressed', String(it.fav)); star.textContent = it.fav ? '★ favori' : '☆ favori';
    } catch (e) { say(e.message); }
  };
  return el('section', { class: 'sh-head' },
    el('div', { class: 'who' }, backLink(), el('span', { class: 'kicker' }, kicker), title),
    el('div', { class: 'row' }, saved, star));
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

// une fiche : image, vidéo ou son
function itemSheet(it) {
  const media = el('div', { class: 'viewer sh-media' });
  if (it.kind === 'image') media.append(el('img', { src: href(it.url), alt: it.title }));
  if (it.kind === 'video') media.append(el('video', { src: href(it.url), controls: true, playsinline: true, preload: 'metadata', poster: it.thumb_url ? href(it.thumb_url) : null }));
  if (it.kind === 'audio') media.append(el('div', { class: 'audio-box' }, wave(24), el('audio', { src: href(it.url), controls: true, preload: 'metadata' })));
  const size = it.width && it.height ? `${it.width}×${it.height}` : '';
  const tool = it.origin?.tool;
  const from = it.origin?.model || (!tool || tool === 'upload' ? `upload${it.origin?.via ? ` · par ${toolFr(it.origin.via)}` : ''}` : `fait dans ${toolFr(tool)}`);
  const kicker = [kindFr(it.kind), size, it.duration ? fmtDur(it.duration) : '', from].filter(Boolean).join(' · ');
  const id = encodeURIComponent(it.id);
  const acts = el('section', { class: 'sh-acts' });
  if (it.kind === 'image') {
    acts.append(link('Animer', href(`movie/?start=${id}`), { go: true, title: 'Movie Creator : cette image en première image d\'un plan' }),
      link('Éditer dans Image', href(`image/?edit=${id}`)),
      link('Référence vidéo', href(`movie/?ref=${id}`), { title: 'Movie Creator : cette image en référence d\'un plan' }),
      link('Ajouter au montage', href(`montage/?add=${id}`)),
      btn('Faire un élément', () => elementModal({ items: [it], title: it.title, folder: it.folder || '' })));
  } else {
    acts.append(link('Ajouter au montage', href(`montage/?add=${id}`), { go: true }));
  }
  acts.append(el('span', { class: 'sp' }),
    el('a', { class: 'tb ghost', href: href(it.url), download: `${it.title || it.id}${(it.file || '').replace(/^main/, '')}` }, 'Télécharger'),
    btn('Corbeille', () => trashItem(it, { leave: true }), { title: 'mettre à la corbeille — on peut l\'annuler' }));
  return [sheetHead(it, kicker), acts,
    el('section', { class: 'sh-grid' }, media, el('aside', { class: 'sh-side' }, rangement(it), recette(it), lineage(it), fabrication(it)))];
}

function rangement(it) {
  const folder = el('input', { class: 'fld', list: 'dl-folders', value: it.folder || '', placeholder: 'à la racine', maxlength: 60, 'aria-label': 'dossier' });
  folder.addEventListener('keydown', (e) => { if (e.key === 'Enter') folder.blur(); });
  folder.addEventListener('change', async () => {
    const v = folder.value.trim();
    const from = it.folder || '';
    if (v === from) return;
    try {
      await api('asset/move', { method: 'POST', body: { ids: [it.id], folder: v } });
      it.folder = v;
      say(v ? `rangé dans « ${v} »` : 'remis à la racine', async () => { await api('asset/move', { method: 'POST', body: { ids: [it.id], folder: from } }); paintSheet(it.id, { keepScroll: true }); });
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
      try { await patch(it, { tags: [...(it.tags || []), v] }); paintTags(); $('input', chips)?.focus(); } catch (err) { say(err.message); }
    });
    chips.replaceChildren(...(it.tags || []).map((t) => el('span', { class: 'chip' }, t,
      el('button', { type: 'button', title: `retirer « ${t} »`, 'aria-label': `retirer ${t}`, onclick: async () => {
        try { await patch(it, { tags: it.tags.filter((x) => x !== t) }); paintTags(); } catch (err) { say(err.message); }
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
  const lk = (x) => dragItem(el('a', { class: 'lk', href: '#' + x.id, title: x.title },
    x.thumb_url ? el('img', { src: href(x.thumb_url), alt: '' }) : (x.kind === 'audio' ? wave(5) : null), el('i', {}, x.title)), x);
  api('asset/lineage/' + it.id).then((l) => {
    const parts2 = [];
    parts2.push(el('span', { class: 'lbl' }, `vient de · ${l.parents.length}`),
      l.parents.length ? el('div', { class: 'strip2' }, ...l.parents.map(lk)) : el('p', { class: 'hint' }, 'rien : c\'est une origine.'));
    parts2.push(el('span', { class: 'lbl' }, `a servi à · ${l.children.length}`),
      l.children.length ? el('div', { class: 'strip2' }, ...l.children.map(lk)) : el('p', { class: 'hint' }, 'rien encore.'));
    box.replaceChildren(...parts2);
  }).catch((e) => box.replaceChildren(el('p', { class: 'warn' }, e.message)));
  return blk('lignée', null, box);
}

function fabrication(it) {
  const o = it.origin || {};
  return blk('fabrication', null, readout([
    ['origine', o.tool === 'upload' || !o.tool ? 'upload · déposé de son disque' : `fait dans ${toolFr(o.tool)}`],
    ['entré par', o.tool === 'upload' || !o.tool ? (o.via ? toolFr(o.via) : 'non dit (déposé avant le 29/09)') : ''],
    ['machine', o.machine], ['créé', fmtDate(it.created)], ['modifié', it.updated && it.updated !== it.created ? fmtDate(it.updated) : ''],
    ['taille', it.width && it.height ? `${it.width} × ${it.height} px` : ''], ['durée', it.duration ? `${String(it.duration).replace('.', ',')} s` : ''],
    ['images/s', it.fps], ['fichier', it.file], ['id', it.id],
  ]));
}

// une fiche d'élément : la planche de références
function elementSheet(it) {
  const e = it.element;
  const src = e.source || {};
  const kicker = () => `élément · ${etypeFr(it.element.type)} · ${plural(it.element.refs.length, 'référence', 'références')}${it.element.voices?.length ? ' · une voix' : ''}`;
  const head = sheetHead(it, kicker());
  const id = encodeURIComponent(it.id);
  const acts = el('section', { class: 'sh-acts' },
    link('Référence vidéo', href(`movie/?ref=${id}`), { go: true, title: 'Movie Creator : cet élément en référence d\'un plan' }));
  if (e.type === 'object') acts.append(link('Ouvrir dans Object Creator', href(`objet/#${id}`)));
  if (src.tool === 'character-factory') {
    acts.append(link('Sa fiche dans Character Factory ↗', src.open, { blank: true }),
      btn('Mettre à jour depuis le studio', async (ev) => {
        const b = ev.currentTarget; b.disabled = true; b.textContent = 'lecture du studio…';
        try { const n = await api('asset/cf/refresh', { method: 'POST', body: { id: it.id } }); say(`${n.title} mis à jour : ${plural(n.element.refs.length, 'référence', 'références')}`); paintSheet(it.id, { keepScroll: true }); } catch (err) { say(err.message); b.disabled = false; b.textContent = 'Mettre à jour depuis le studio'; }
      }, { title: 'relire le personnage et remplacer ses images sur place' }));
  }
  acts.append(el('span', { class: 'sp' }),
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
  const saveRefs = async (list, msg, undoList) => {
    try {
      const n = await api('asset/refs/' + it.id, { method: 'POST', body: { refs: list.map((r) => ({ file: r.file, role: r.role, label: r.label, item: r.item })) } });
      Object.assign(it, n);
      paintBoard();
      $('.kicker', head).textContent = kicker();
      if (msg) say(msg, undoList ? () => saveRefs(undoList, 'référence remise') : null);
    } catch (err) { say(err.message); paintBoard(); }
  };
  const refCard = (r, i) => {
    const sel = el('select', { class: 'fld', 'aria-label': `rôle de la référence ${i + 1}` }, el('option', { value: '' }, 'rôle ?'),
      ...ROLES.map(([k, l]) => el('option', { value: k, selected: r.role === k }, l)),
      r.role && !ROLES.some(([k]) => k === r.role) ? el('option', { value: r.role, selected: true }, r.role) : null);
    sel.onchange = () => { const list = it.element.refs.map((x) => ({ ...x })); list[i].role = sel.value; saveRefs(list); };
    const lab = el('input', { class: 'fld', value: r.label || '', placeholder: 'libellé', maxlength: 80, 'aria-label': `libellé de la référence ${i + 1}` });
    lab.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') lab.blur(); });
    lab.onchange = () => { const list = it.element.refs.map((x) => ({ ...x })); list[i].label = lab.value.trim(); saveRefs(list); };
    const x = el('button', { class: 'x', type: 'button', title: 'retirer de l\'élément', 'aria-label': `retirer la référence ${i + 1}`,
      onclick: () => { const before = it.element.refs.map((y) => ({ ...y })); const list = before.filter((_, k) => k !== i); saveRefs(list, `référence ${i + 1} retirée`, before); } }, '×');
    return el('div', { class: 'refc' + (r.role ? '' : ' role-none'), 'data-i': i, role: 'listitem' },
      el('div', { class: 'pic', title: 'glisser pour changer l\'ordre' }, el('img', { src: href(r.thumb_url || r.url), alt: r.label || roleFr(r.role) }),
        el('span', { class: 'n' }, `${String(i + 1).padStart(2, '0')} · ${roleFr(r.role)}`), x),
      el('div', { class: 'body' }, sel, lab));
  };
  const paintBoard = () => {
    board.replaceChildren(...it.element.refs.map(refCard),
      el('button', { class: 'refc add', type: 'button', onclick: async () => {
        const got = await pick({ kinds: ['image'], multiple: true, title: `Ajouter à ${it.title}` });
        for (const g of got) {
          try { Object.assign(it, await api(`elements/${it.id}/refs`, { method: 'POST', body: { item: g.id, role: S.addRole, label: '' } })); } catch (err) { say(err.message); }
        }
        if (got.length) { say(`${plural(got.length, 'référence ajoutée', 'références ajoutées')} · rôle ${roleFr(S.addRole)}`); paintBoard(); $('.kicker', head).textContent = kicker(); }
      } }, el('b', {}, '+'), el('span', { class: 'lbl' }, 'ajouter depuis la bibliothèque'), el('span', { class: 'hint' }, 'ou déposer ici des images : de ton disque, ou une vignette glissée')));
  };
  paintBoard();
  enableRefDrag(board, it, saveRefs);
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
    const before = voices.map((x) => ({ file: x.file, label: x.label, item: x.item }));
    try {
      await api(`asset/refs/${it.id}`, { method: 'POST', body: { voices: before.filter((x) => x.file !== v.file) } });
      say('voix retirée', async () => { await api(`asset/refs/${it.id}`, { method: 'POST', body: { voices: before } }); paintSheet(it.id, { keepScroll: true }); });
    } catch (err) { say(err.message); }
    paintSheet(it.id, { keepScroll: true });
  };
  const voiceBlk = blk('sa voix', voices.length ? plural(voices.length, 'son', 'sons') : 'pas encore',
    ...(voices.length ? voices.map((v) => el('div', { class: 'voice' },
      wave(14),
      el('div', { class: 'vmeta' }, el('b', {}, v.label || 'voix'),
        el('span', { class: 'lbl' }, [v.duration ? fmtDur(v.duration) : '', (v.file.split('.').pop() || '').toUpperCase()].filter(Boolean).join(' · '))),
      el('audio', { src: href(v.url), controls: true, preload: 'metadata' }),
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
    try { await patch(it, { element: { description: desc.value.trim() } }); flash(saved); } catch (err) { say(err.message); }
  });
  const seg = el('div', { class: 'seg wrap', role: 'radiogroup', 'aria-label': 'sorte' });
  const paintSeg = () => seg.replaceChildren(...ETYPES.map(([k, l]) => el('button', { class: 'tb' + (it.element.type === k ? ' on' : ''), type: 'button', role: 'radio',
    'aria-checked': String(it.element.type === k), onclick: async () => {
      try { await patch(it, { element: { type: k } }); paintSeg(); $('.kicker', head).textContent = kicker(); } catch (err) { say(err.message); }
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

  return [head, acts, el('section', { class: 'sh-grid' },
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
    saveRefs(list, `référence déplacée en ${list.indexOf(moved) + 1}ᵉ place`, before);
  });
}

// ══ LA CORBEILLE ════════════════════════════════════════════
async function paintTrash() {
  libEl.replaceChildren(el('p', { class: 'lbl' }, 'chargement'));
  parts = null;
  let d;
  try { d = await api('asset/trash'); } catch (e) { libEl.replaceChildren(el('p', { class: 'warn' }, e.message)); return; }
  const grid = el('div', { class: 'lib-grid' });
  grid.style.setProperty('--card', `${S.size}px`);
  const card = (t) => {
    const im = el('div', { class: 'im' }, t.thumb_url ? el('img', { src: href(t.thumb_url), alt: '', loading: 'lazy' }) : (t.kind === 'audio' ? wave() : el('span', { class: 'noimg' }, 'sans image')),
      el('span', { class: 'kind ' + t.kind }, t.kind === 'element' ? etypeFr(t.etype) : kindFr(t.kind)));
    const n = el('div', { class: 'acard trash-card', role: 'listitem' },
      el('div', { class: 'thumb' }, im, el('div', { class: 'cap' }, el('div', { class: 't' }, t.title || t.id),
        el('div', { class: 's' }, `jeté ${fmtDate(t.trashed)}${t.folder ? ` · de « ${t.folder} »` : ''}`)),
      el('div', { class: 'acts2' }, el('button', { class: 'tb ghost sm', type: 'button', onclick: async () => {
        try {
          await api(`library/${t.id}/restore`, { method: 'POST' });
          say(`« ${t.title} » rétabli${t.folder ? ` dans « ${t.folder} »` : ''}`);
          n.remove();
          if (!$('.trash-card', grid)) paintTrash();
        } catch (e) { say(e.message); }
      } }, 'Rétablir'))));
    return n;
  };
  grid.replaceChildren(...(d.items.length ? d.items.map(card)
    : [el('div', { class: 'empty-state', style: { gridColumn: '1 / -1' } }, el('b', {}, 'La corbeille est vide'), el('p', { class: 'hint' }, 'Ce qu\'on met à la corbeille attend ici, avec son fichier, sa recette et son dossier.'))]));
  libEl.replaceChildren(
    el('section', { class: 'lib-top' }, el('div', { class: 'who' }, el('a', { class: 'o-back', href: '#' }, '‹ Asset'),
      el('span', { class: 'kicker' }, 'la corbeille'), el('h1', { class: 'lib-h' }, 'Corbeille'), el('span', { class: 'lbl' }, plural(d.items.length, 'objet', 'objets')))),
    el('p', { class: 'hint' }, 'Un objet jeté garde tout — fichier, recette, dossier — et revient à sa place d\'un clic. Rien ne s\'efface d\'ici.'),
    grid);
}

// ── clavier, travaux finis ───────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (drag?.started) { endDrag(true); return; }
  if (mq) { endMarquee(true); return; }
  if ($('.scrim') || menuFor) return;
  if (S.route.view === 'lib' && S.sel.size && !e.target.closest?.('input, textarea, select')) { clearSel(); live('plus rien de choisi'); return; }
  if (S.route.view === 'sheet' && !e.target.closest?.('input, textarea, select')) go(S.backHash || '#');
});
document.addEventListener('sr:job', () => { if (S.route.view === 'lib') loadLib(); });

render();
