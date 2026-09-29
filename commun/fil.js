// SHOWRUNNER TOOLS — le fil : ce qu'un outil a fabriqué, du plus récent au
// plus ancien, sur le modèle de l'historique de Higgsfield (captures de Cal,
// 29/09 : « le fait d'avoir un fil est assez pratique »).
//
//   - en grille (rangées justifiées : chaque image garde son format) ou en
//     liste (grand média à gauche, sa carte à droite : modèle, prompt aux
//     jetons surlignés, références, puces, date) ; un curseur de taille, un
//     filtre simple (tout, aimés, cette session ; la source si l'outil en
//     donne), une recherche ;
//   - les rendus en file et en cours en tête du fil, avec leur place, leur
//     progression, « Arrêter » ; leur image prend leur place à l'arrivée ;
//   - au survol : aimer, réutiliser, recréer, télécharger en accès direct, et
//     le menu « ⋯ » (commun/menu.js) — le même qu'au clic droit ;
//   - un clic ouvre la visionneuse plein écran : la grande image ou la vidéo,
//     son panneau à droite (prompt, références, détails, actions) ; la
//     molette et les flèches passent à l'élément suivant ou précédent du fil,
//     Échap ferme.
//
//   const fil = createFil(box, {
//     id: 'image',                        // la clé des préférences (disposition, taille, filtre)
//     layout: 'grid' | 'list',            // la disposition par défaut
//     title: 'Historique',
//     query: ({ scope }) => 'library?kind=image&tool=image',   // le fil ajoute limit, offset, fav, q
//     scopes: [{ id, label }],            // facultatif : d'où viennent les objets
//     jobs: () => [travaux],              // en file, en cours, en échec : l'outil les tient
//     jobLines: (j) => ['…'], onJob: { cancel(j), retry(j), forget(j) },
//     prompt: (it) => 'ce que la personne a écrit', promptLabel: 'Prompt',
//     badge: (it) => 'KREA 2', chips: (it) => ['1024×1024'], refs: (it) => [ids],
//     details: (it) => [['modèle', '…']], extra: (it) => [nœuds du panneau],
//     alpha: (it) => bool,                // un damier sous une image transparente
//     viewerTools: (it, v) => [boutons],  // v.media(nœud) remplace la grande image, v.reset()
//     viewerActions: (it) => [boutons],   // à côté de « Recréer » dans le panneau
//     reuse: { run(it), why(it) }, recreate: { run(it), why(it), more(it) → sous-menu },
//     menu: (it) => [entrées propres à l'outil],   // placées au milieu du menu « ⋯ »
//     link: (it) => 'adresse qui rouvre cet objet', empty: 'texte du fil vide',
//     onLoad: () => {},                   // après chaque chargement du fil
//   });
//   fil.reload() · fil.add(items) · fil.update(it) · fil.remove(id) · fil.open(idOuObjet)
//   fil.close() · fil.paintJobs() · fil.items() · fil.get(id) · fil.current()
//
// Une action désactivée dit pourquoi (au survol, et au clic). Un seul orange
// dans la visionneuse : « Réutiliser », l'action des variantes.

import { el, $$, api, toast, href, fmtDate, dragItem } from './shell.js';
import { menu, kebab, contextMenu, closeMenus } from './menu.js';

// la feuille du fil, chargée une fois, à côté de ce fichier (comme menu.css)
if (![...document.querySelectorAll('link[rel=stylesheet]')].some((l) => /commun\/fil\.css$/.test(l.href))) {
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./fil.css', import.meta.url).href }));
}

const I = {
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20.3s-7.6-4.7-7.6-10.4A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.6 2.7c0 5.7-7.6 10.4-7.6 10.4z"/></svg>',
  reuse: '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 5V4.5a1 1 0 0 0-1-1h-10a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1H5"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M19.4 12.6a7.5 7.5 0 1 1-2.1-6"/><path d="M19.6 3.8v4.6H15"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 4v11.5M7 10.8l5 5 5-5M5 20h14"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
};
const ico = (k) => el('span', { class: 'fl-i', 'aria-hidden': 'true', html: I[k] });

// un jeton de prompt : @image1, @element2… (pas après une lettre : une adresse
// mél n'en est pas un), <image1> de Qwen, les étiquettes d'H3
const TOK = /((?<![\p{L}\p{N}_@])@[\p{L}_]+\d*|<(?:image|Picture|Subject|Video|Audio) ?\d+>)/gu;
function rich(text) {
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(TOK)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(el('mark', {}, m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const slug = (s) => String(s || '').normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'asset';
const ms = (iso) => Date.parse(iso || '') || 0;

// copier sans « navigator.clipboard » : le portail est servi en http sur le
// réseau de Cal, où le presse-papiers moderne n'existe pas
export function copyText(text, done = 'copié') {
  const ok = () => toast(done);
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(ok, () => legacy());
    return;
  }
  legacy();
  function legacy() {
    const ta = el('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let good = false;
    try { good = document.execCommand('copy'); } catch { good = false; }
    ta.remove();
    if (good) ok(); else toast('copie refusée par le navigateur : sélectionnez le texte à la main', 5000);
  }
}

// une petite fenêtre : confirmer, ou donner un nom (un dossier)
export function ask({ title, text = '', ok = 'OK', danger = false, field = null }) {
  return new Promise((resolve) => {
    const inp = field ? el('input', { class: 'fld', value: field.value || '', placeholder: field.placeholder || '', maxlength: 80 }) : null;
    const done = (v) => { scrim.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
    const go = () => done(inp ? (inp.value.trim() || null) : true);
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
      // Entrée dans le champ valide ; sur un bouton, c'est le bouton qui répond
      else if (e.key === 'Enter' && inp && document.activeElement === inp) { e.preventDefault(); e.stopPropagation(); go(); }
    };
    const scrim = el('div', { class: 'scrim fl-ask', onclick: (e) => { if (e.target === scrim) done(null); } },
      el('div', { class: 'modal', role: 'dialog', 'aria-label': title },
        el('div', { class: 'modal-head' }, el('span', { class: 't' }, title)),
        el('div', { class: 'modal-body' }, text ? el('p', {}, text) : null, inp),
        el('div', { class: 'modal-foot' }, el('span', { class: 'sp' }),
          el('button', { class: 'tb ghost', type: 'button', onclick: () => done(null) }, 'Annuler'),
          el('button', { class: 'tb' + (danger ? ' ghost fl-danger' : ''), type: 'button', onclick: go }, ok))));
    document.addEventListener('keydown', key, true);
    document.body.append(scrim);
    (inp || scrim.querySelector('.modal-foot .tb:last-child')).focus();
  });
}

const prefs = {
  get(id) { try { return JSON.parse(localStorage.getItem('sr-fil-' + id) || '{}') || {}; } catch { return {}; } },
  set(id, v) { try { localStorage.setItem('sr-fil-' + id, JSON.stringify(v)); } catch { /* stockage fermé : rien à garder */ } },
};
// le début de cette session : le premier chargement de la page dans cet onglet
function sessionStart(id) {
  try {
    const k = 'sr-fil-session-' + id;
    let s = sessionStorage.getItem(k);
    if (!s) { s = new Date().toISOString(); sessionStorage.setItem(k, s); }
    return s;
  } catch { return new Date().toISOString(); }
}

const SIZES = { grid: [120, 480, 220], list: [240, 760, 420] };
const FILTER_FR = { all: 'tout', fav: 'aimés', session: 'session' };

export function createFil(box, o = {}) {
  const id = o.id || 'fil';
  const saved = prefs.get(id);
  const P = {
    layout: ['grid', 'list'].includes(saved.layout) ? saved.layout : (o.layout || 'grid'),
    filter: FILTER_FR[saved.filter] ? saved.filter : 'all',
    scope: (o.scopes || []).some((s) => s.id === saved.scope) ? saved.scope : (o.scopes?.[0]?.id || ''),
    size: { grid: SIZES.grid[2], list: SIZES.list[2], ...(saved.size || {}) },
    q: '',
  };
  const S = { items: [], total: 0, folders: [], loading: false, seq: 0, fresh: new Set(), cells: new Map(), jcells: new Map(),
    lib: new Map(), session: sessionStart(id), loaded: false };
  const save = () => prefs.set(id, { layout: P.layout, filter: P.filter, scope: P.scope, size: P.size });
  let V = null;   // la visionneuse, quand elle est ouverte

  // ── la barre ──────────────────────────────────────────────
  const count = el('span', { class: 'lbl fl-count' });
  const filterBtn = el('button', { class: 'tb ghost sm fl-filter', type: 'button', 'aria-haspopup': 'menu', title: 'ce que le fil montre',
    onclick: (e) => openFilter(e.currentTarget) });
  const search = el('input', { class: 'fld fl-q', type: 'search', placeholder: 'chercher', 'aria-label': 'chercher dans le fil' });
  let qT = null;
  search.addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => { P.q = search.value.trim(); load(false); }, 280); });
  const fullBtn = el('button', { class: 'fl-ib', type: 'button', title: 'plein écran, à partir du premier du fil', 'aria-label': 'plein écran',
    onclick: () => { const l = shown(); if (l.length) open(l[0]); else toast('rien à montrer encore'); } }, ico('full'));
  const size = el('input', { class: 'fl-size', type: 'range', step: 10, 'aria-label': 'taille des vignettes', title: 'taille des vignettes' });
  size.addEventListener('input', () => { P.size[P.layout] = Number(size.value); applySize(); });
  size.addEventListener('change', save);
  const lay = el('div', { class: 'seg fl-lay', role: 'group', 'aria-label': 'disposition' },
    ...[['list', 'Liste'], ['grid', 'Grille']].map(([k, lab]) => el('button', { class: 'tb', type: 'button', 'data-l': k,
      onclick: () => { if (P.layout === k) return; P.layout = k; save(); paint(); } }, lab)));
  const bar = el('div', { class: 'fl-bar' }, el('h2', {}, o.title || 'Historique'), count, filterBtn, search,
    el('span', { class: 'sp' }), fullBtn, size, lay);
  const body = el('div', { class: 'fl-body' });
  const empty = el('div', { class: 'fl-empty', hidden: true });
  const moreBtn = el('button', { class: 'tb ghost sm fl-more', type: 'button', hidden: true, onclick: () => load(true) });
  box.classList.add('fil');
  box.replaceChildren(bar, body, empty, moreBtn);
  // la suite se charge quand on arrive en bas du fil
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && hasMore() && !S.loading) load(true); }, { rootMargin: '600px' })
      .observe(moreBtn);
  }

  function applySize() {
    const [lo, hi] = SIZES[P.layout];
    P.size[P.layout] = Math.max(lo, Math.min(hi, Number(P.size[P.layout]) || SIZES[P.layout][2]));
    size.min = lo; size.max = hi; size.value = P.size[P.layout];
    box.style.setProperty('--fl-h', P.size.grid + 'px');
    box.style.setProperty('--fl-lh', P.size.list + 'px');
  }

  function openFilter(btn) {
    const r = btn.getBoundingClientRect();
    const f = (k, label, sub) => ({ label, sub, checked: P.filter === k, onclick: () => { P.filter = k; save(); load(false); } });
    menu(r.left, r.bottom + 4, [
      { head: 'Montrer' }, f('all', 'Tout'), f('fav', 'Aimés'), f('session', 'Cette session', 'depuis l’ouverture'),
      ...(o.scopes?.length > 1 ? ['-', { head: 'Source' }, ...o.scopes.map((s) => ({ label: s.label, checked: P.scope === s.id,
        onclick: () => { P.scope = s.id; save(); load(false); } }))] : []),
    ]);
  }

  // ── les objets ────────────────────────────────────────────
  const inSession = (it) => ms(it.created) >= ms(S.session);
  const shown = () => (P.filter === 'session' ? S.items.filter(inSession) : S.items);
  const hasMore = () => S.items.length < S.total && !(P.filter === 'session' && S.items.length && !inSession(S.items[S.items.length - 1]));
  const libItem = (iid) => {
    if (!S.lib.has(iid)) S.lib.set(iid, api('library/' + iid).catch(() => null));
    return S.lib.get(iid);
  };

  async function load(more = false) {
    if (more && (S.loading || !hasMore())) return;
    const seq = more ? S.seq : ++S.seq;
    S.loading = true;
    paintMore();
    const base = o.query ? o.query({ filter: P.filter, scope: P.scope, q: P.q }) : 'library';
    const qs = new URLSearchParams({ limit: String(o.page || 60), offset: String(more ? S.items.length : 0) });
    if (P.filter === 'fav') qs.set('fav', '1');
    if (P.q) qs.set('q', P.q);
    let r;
    try { r = await api(base + (base.includes('?') ? '&' : '?') + qs); } catch (e) {
      if (seq === S.seq) { S.loading = false; toast(e.message, 6000); paint(); }
      return;
    }
    if (seq !== S.seq) return;   // un autre filtre est parti entre-temps
    S.loading = false;
    S.loaded = true;
    const known = new Set(more ? S.items.map((x) => x.id) : []);
    const got = r.items.filter((x) => !known.has(x.id));
    for (const it of got) S.lib.set(it.id, Promise.resolve(it));
    S.items = more ? S.items.concat(got) : got;
    S.total = r.total;
    S.folders = r.folders || S.folders;
    if (!more) { S.cells.clear(); }
    paint();
    if (V) paintPos();
    o.onLoad?.();
  }

  function add(items, { fresh = true } = {}) {
    let n = 0;
    for (const it of items || []) {
      if (!it?.id) continue;
      S.lib.set(it.id, Promise.resolve(it));
      const k = S.items.findIndex((x) => x.id === it.id);
      if (k >= 0) { S.items[k] = it; dropCells(it.id); continue; }
      if (P.filter === 'fav' && !it.fav) continue;
      S.items.push(it);
      S.total += 1; n++;
      if (fresh) S.fresh.add(it.id);
    }
    S.items.sort((a, b) => ms(b.created) - ms(a.created));   // le plus récent en tête
    paint();
    if (V) paintPos();   // la visionneuse ouverte : sa place dans le fil a bougé
    return n;
  }
  function dropCells(iid) {
    for (const key of [...S.cells.keys()]) if (key.endsWith(':' + iid)) S.cells.delete(key);
  }
  function update(it) {
    if (!it?.id) return;
    S.lib.set(it.id, Promise.resolve(it));
    const k = S.items.findIndex((x) => x.id === it.id);
    if (k >= 0) S.items[k] = it;
    dropCells(it.id);
    paint();
    if (V && V.it.id === it.id) { V.it = it; paintSide(); }
  }
  function remove(iid) {
    const before = shown().findIndex((x) => x.id === iid);
    const was = S.items.length;
    S.items = S.items.filter((x) => x.id !== iid);
    if (S.items.length < was) S.total = Math.max(0, S.total - 1);
    dropCells(iid);
    S.fresh.delete(iid);
    if (V && V.it.id === iid) {
      const l = shown();
      if (l.length) { V.it = l[Math.max(0, Math.min(before, l.length - 1))]; paintViewer(); } else close();
    }
    paint();
  }

  // ── les actions communes ──────────────────────────────────
  async function like(it) {
    try {
      const n = await api('library/' + it.id, { method: 'POST', body: { fav: !it.fav } });
      update(n);
      toast(n.fav ? 'aimé' : 'n’est plus aimé');
    } catch (e) { toast(e.message, 6000); }
  }
  function download(it) {
    if (!it.url) { toast('cet objet n’a pas de fichier à télécharger'); return; }
    const file = it.file || '';
    const ext = file.includes('.') ? file.slice(file.lastIndexOf('.')) : (it.kind === 'video' ? '.mp4' : '.png');
    const a = el('a', { href: href(it.url), download: slug(it.title || it.id) + ext });
    document.body.append(a);
    a.click();
    a.remove();
  }
  async function askDelete(it) {
    const yes = await ask({ title: 'Mettre à la corbeille', ok: 'À la corbeille', danger: true,
      text: `« ${it.title || it.id} » part à la corbeille de la bibliothèque ; il en revient depuis Asset (Corbeille).` });
    if (!yes) return;
    try { await api(`library/${it.id}/delete`, { method: 'POST' }); } catch (e) { toast(e.message, 6000); return; }
    remove(it.id);
    toast('à la corbeille — il revient depuis Asset');
    o.onRemoved?.(it);
  }
  async function setFolder(it, folder) {
    try {
      const n = await api('library/' + it.id, { method: 'POST', body: { folder } });
      if (folder && !S.folders.includes(folder)) S.folders = [...S.folders, folder].sort((a, b) => a.localeCompare(b, 'fr'));
      update(n);
      toast(folder ? `rangé dans « ${folder} »` : 'hors de tout dossier');
    } catch (e) { toast(e.message, 6000); }
  }
  async function newFolder(it) {
    const name = await ask({ title: 'Nouveau dossier', ok: 'Ranger', field: { placeholder: 'le nom du dossier' },
      text: 'Les dossiers sont ceux d’Asset : on y retrouve ce qu’on range ici.' });
    if (name) setFolder(it, name);
  }
  const promptOf = (it) => String((o.prompt ? o.prompt(it) : it.prompt) || '').trim();

  const tidy = (list) => {
    const out = [];
    for (const x of list) {
      if (!x) continue;
      if (x === '-' && (!out.length || out[out.length - 1] === '-')) continue;
      out.push(x);
    }
    while (out[out.length - 1] === '-') out.pop();
    return out;
  };
  function menuItems(it) {
    const rw = o.reuse?.why?.(it) || '', cw = o.recreate?.why?.(it) || '';
    const more = !cw && o.recreate?.more ? o.recreate.more(it) : null;
    const pr = promptOf(it);
    const cur = it.folder || '';
    return tidy([
      { label: 'Ouvrir', icon: '⤢', sub: 'plein écran', onclick: () => open(it) },
      o.reuse ? { label: 'Réutiliser', icon: '⧉', sub: 'variante', disabled: !!rw, why: rw, title: 'ses réglages dans le formulaire', onclick: () => { close(); o.reuse.run(it); } } : null,
      o.recreate ? (more ? { label: 'Recréer', icon: '↻', items: more }
        : { label: 'Recréer', icon: '↻', sub: 'nouvelle graine', disabled: !!cw, why: cw, onclick: () => o.recreate.run(it) }) : null,
      '-',
      ...(o.menu ? o.menu(it) : []),
      '-',
      { label: 'Aimer', checked: !!it.fav, onclick: () => like(it) },
      { label: 'Ajouter à un dossier', icon: '▭', items: tidy([
        ...S.folders.map((f) => ({ label: f, checked: f === cur, onclick: () => setFolder(it, f) })),
        S.folders.length ? '-' : null,
        { label: 'Nouveau dossier…', icon: '+', onclick: () => newFolder(it) },
        cur ? { label: 'Retirer du dossier', onclick: () => setFolder(it, '') } : null,
      ]) },
      { label: 'Copier le prompt', icon: '“', disabled: !pr, why: 'aucun prompt : un objet déposé, ou fait ailleurs', onclick: () => copyText(pr, 'prompt copié') },
      { label: 'Copier le lien', icon: '↗', onclick: () => copyText(o.link ? o.link(it) : href('asset/#' + it.id), 'lien copié') },
      { label: 'Voir dans Asset', icon: '▦', onclick: () => { location.href = href('asset/#' + it.id); } },
      { label: 'Télécharger', icon: '↓', onclick: () => download(it) },
      '-',
      { label: 'Supprimer', icon: '×', danger: true, sub: 'corbeille', onclick: () => askDelete(it) },
    ]);
  }

  // les gestes au survol : aimer, réutiliser, recréer, télécharger, « ⋯ »
  function acts(it) {
    const rw = o.reuse?.why?.(it) || '', cw = o.recreate?.why?.(it) || '';
    const b = (k, title, fn, why = '', cls = '') => el('button', { class: 'fl-ib ' + cls, type: 'button', 'aria-label': title,
      title: why ? `${title} — ${why}` : title, 'aria-disabled': why ? 'true' : null,
      onclick: (e) => { e.stopPropagation(); if (why) { toast(why, 5000); return; } fn(); } }, ico(k));
    return el('div', { class: 'fl-acts' },
      b('heart', it.fav ? 'Ne plus aimer' : 'Aimer', () => like(it), '', it.fav ? 'on' : ''),
      o.reuse ? b('reuse', 'Réutiliser : ses réglages dans le formulaire, pour une variante', () => o.reuse.run(it), rw) : null,
      o.recreate ? b('redo', 'Recréer : les mêmes réglages, une nouvelle graine', () => o.recreate.run(it), cw) : null,
      b('down', 'Télécharger', () => download(it)),
      kebab(() => menuItems(it), { cls: 'fl-ib', title: 'plus d’actions' }));
  }

  function refsRow(it) {
    const ids = (o.refs ? o.refs(it) : it.parents || []).filter(Boolean).slice(0, 9);
    if (!ids.length) return null;
    const row = el('div', { class: 'fl-refs' });
    for (const rid of ids) {
      const b = el('button', { class: 'fl-ref', type: 'button', title: 'une référence' });
      row.append(b);
      libItem(rid).then((x) => {
        if (!x) { b.remove(); return; }
        b.title = `${x.title || x.id} — ouvrir`;
        const t = x.thumb_url || (x.kind === 'image' ? x.url : null);
        if (t) b.style.backgroundImage = `url("${href(t)}")`;
        else b.textContent = x.kind === 'audio' ? '♪' : '▶';
        b.onclick = (e) => { e.stopPropagation(); open(x); };
        dragItem(b, x);
      });
    }
    return row;
  }

  function hoverPlay(zone, v, it) {
    zone.addEventListener('mouseenter', () => {
      if (!v.getAttribute('src')) v.src = href(it.url);
      v.play().catch(() => {});
    });
    zone.addEventListener('mouseleave', () => v.pause());
  }

  const arOf = (w, h) => Math.max(0.42, Math.min(2.6, (w || 1) / (h || 1)));
  function gridCard(it) {
    const ar = arOf(it.width, it.height);
    const big = P.size.grid > 260;
    let media;
    if (it.kind === 'video') {
      media = el('video', { loop: true, playsinline: true, preload: 'none', poster: it.thumb_url ? href(it.thumb_url) : null });
      media.muted = true;
    } else if (it.kind === 'image') {
      media = el('img', { src: href(big ? it.url : (it.thumb_url || it.url)), alt: '', loading: 'lazy', draggable: 'false' });
    } else {
      media = el('span', { class: 'fl-nomedia' }, it.kind === 'audio' ? '♪' : '◆');
    }
    const badge = o.badge ? o.badge(it) : '';
    const openB = el('button', { class: 'fl-open', type: 'button', title: promptOf(it) || it.title || '', 'aria-label': `ouvrir ${it.title || ''}`,
      onclick: () => open(it) }, media,
    badge ? el('span', { class: 'fl-tag' }, badge) : null,
    it.duration ? el('span', { class: 'fl-dur' }, `${it.duration.toFixed(1)} s`) : null);
    const n = el('div', { class: 'fl-card', 'data-id': it.id, style: { flexGrow: String(Math.round(ar * 100)), '--ar': String(ar) } },
      el('i', { class: 'fl-pad', style: { paddingBottom: `${100 / ar}%` } }), openB, acts(it));
    dragItem(openB, it);
    if (it.kind === 'video') hoverPlay(n, media, it);
    contextMenu(n, () => menuItems(it));
    return n;
  }
  function listCard(it) {
    let media;
    if (it.kind === 'video') {
      media = el('video', { src: href(it.url), loop: true, playsinline: true, preload: 'metadata', poster: it.thumb_url ? href(it.thumb_url) : null });
      media.muted = true;
    } else if (it.kind === 'image') {
      media = el('img', { src: href(it.url), alt: '', loading: 'lazy', draggable: 'false' });
    } else media = el('span', { class: 'fl-nomedia' }, '◆');
    const openB = el('button', { class: 'fl-open', type: 'button', title: 'ouvrir en grand', 'aria-label': `ouvrir ${it.title || ''}`, onclick: () => open(it) },
      media, it.kind === 'video' ? el('span', { class: 'fl-play' }, ico('play')) : null);
    const stage = el('div', { class: 'fl-stage' }, openB, acts(it));
    const pr = promptOf(it);
    const badge = o.badge ? o.badge(it) : '';
    const chips = (o.chips ? o.chips(it) : [it.width ? `${it.width}×${it.height}` : '']).filter(Boolean);
    const info = el('div', { class: 'fl-info' },
      badge ? el('span', { class: 'fl-badge' }, badge) : null,
      el('p', { class: 'fl-prompt' + (pr ? '' : ' none') }, ...(pr ? rich(pr) : [it.title || it.id])),
      refsRow(it),
      chips.length ? el('div', { class: 'fl-chips' }, ...chips.map((c) => el('span', { class: 'fl-chip' }, c))) : null,
      el('span', { class: 'lbl fl-date' }, fmtDate(it.created)));
    const n = el('div', { class: 'fl-row', 'data-id': it.id }, stage, info);
    dragItem(openB, it);
    if (it.kind === 'video') hoverPlay(stage, media, it);
    contextMenu(n, () => menuItems(it));
    return n;
  }
  function card(it) {
    const key = `${P.layout}:${it.id}`;
    let n = S.cells.get(key);
    if (!n) { n = P.layout === 'grid' ? gridCard(it) : listCard(it); S.cells.set(key, n); }
    n.classList.toggle('fresh', S.fresh.has(it.id));
    return n;
  }

  // ── les rendus en file et en cours, en tête du fil ────────
  function jobCard(j) {
    const key = `${P.layout}:j:${j.id}`;
    let n = S.jcells.get(key);
    if (!n) {
      const pp = j.params || {};
      const cv = Array.isArray(pp.canvas) ? pp.canvas : [];
      const w = pp.width || cv[0] || 16, h = pp.height || cv[1] || 9;
      const ar = arOf(w, h);
      const call = (k) => (e) => { e.stopPropagation(); o.onJob?.[k]?.(n._j); };
      const parts = {
        st: el('b', { class: 'fl-jst' }), bar: el('i'), title: el('span', { class: 'fl-jt' }), lines: el('span', { class: 'fl-jl' }),
        stop: el('button', { class: 'tb ghost sm', type: 'button', title: 'arrêter ce rendu', onclick: call('cancel') }, 'Arrêter'),
        retry: el('button', { class: 'tb ghost sm', type: 'button', title: 'le relancer, mêmes réglages', onclick: call('retry') }, 'Relancer'),
        forget: el('button', { class: 'tb ghost sm', type: 'button', title: 'le retirer du fil', onclick: call('forget') }, '×'),
      };
      const media = el('div', { class: 'fl-jm' }, j.thumb ? el('span', { class: 'fl-jthumb', style: { backgroundImage: `url("${href(j.thumb)}")` } }) : null,
        parts.st, el('span', { class: 'fl-jbar' }, parts.bar));
      const jacts = el('span', { class: 'fl-jacts' }, parts.stop, parts.retry, parts.forget);
      n = P.layout === 'grid'
        ? el('div', { class: 'fl-card fl-job', style: { flexGrow: String(Math.round(ar * 100)), '--ar': String(ar) } },
          el('i', { class: 'fl-pad', style: { paddingBottom: `${100 / ar}%` } }), media, el('div', { class: 'fl-jcap' }, parts.title, parts.lines, jacts))
        : el('div', { class: 'fl-row fl-job' }, el('div', { class: 'fl-stage' }, media),
          el('div', { class: 'fl-info' }, el('span', { class: 'fl-badge' }, 'rendu'), parts.title, parts.lines, jacts));
      n._p = parts;
      S.jcells.set(key, n);
    }
    n._j = j;
    const p = n._p;
    const run = j.state === 'running', wait = j.state === 'queued', arriving = j.state === 'done';
    const err = !run && !wait && !arriving;
    n.classList.toggle('run', run || arriving);
    n.classList.toggle('err', err);
    const pct = j.progress != null ? Math.round(j.progress * 100) : null;
    p.st.textContent = arriving ? 'arrive' : err ? ({ cancelled: 'arrêté', interrupted: 'interrompu' }[j.state] || 'échec')
      : run ? (pct != null ? `${pct} %` : 'en cours')
        : j.ahead > 0 ? `en file · ${j.ahead} devant` : j.ahead === 0 ? 'en file · le prochain' : j.position ? `en file · n° ${j.position}` : 'en file';
    p.title.textContent = j.title || '';
    p.title.title = j.title || '';
    const lines = err ? [j.message || ''] : (o.jobLines ? o.jobLines(j) : [j.machine, j.message === 'en file' ? '' : j.message]);
    p.lines.textContent = lines.filter(Boolean).join(' · ');
    p.bar.style.width = arriving ? '100%' : run && pct != null ? `${pct}%` : '0';
    const can = j.can !== false;
    p.stop.hidden = !can || err || arriving;
    p.retry.hidden = !can || !err;
    p.forget.hidden = !err;
    return n;
  }

  // ── peindre le fil ────────────────────────────────────────
  // les nœuds déjà en place n'en bougent pas : une vidéo qui joue au survol
  // n'est pas coupée à chaque relevé de la file
  function reconcile(parent, nodes) {
    for (let i = 0; i < nodes.length; i++) {
      const cur = parent.children[i];
      if (cur !== nodes[i]) parent.insertBefore(nodes[i], cur || null);
    }
    while (parent.children.length > nodes.length) parent.lastElementChild.remove();
  }
  function paintMore() {
    const more = hasMore();
    moreBtn.hidden = !more && !S.loading;
    moreBtn.disabled = S.loading;
    moreBtn.textContent = S.loading ? 'chargement…' : `Plus — ${S.total - S.items.length} autres`;
  }
  function paint() {
    applySize();
    $$('.tb', lay).forEach((b) => b.classList.toggle('on', b.dataset.l === P.layout));
    const scope = (o.scopes || []).find((s) => s.id === P.scope);
    filterBtn.textContent = `Filtre · ${FILTER_FR[P.filter]}${o.scopes?.length > 1 && scope && scope !== o.scopes[0] ? ' · ' + scope.label.toLowerCase() : ''}`;
    filterBtn.classList.toggle('set', P.filter !== 'all' || (o.scopes?.length > 1 && scope !== o.scopes[0]));
    const list = shown();
    const js = o.jobs ? o.jobs() : [];
    const live = js.filter((j) => ['queued', 'running'].includes(j.state)).length;
    count.textContent = (P.filter === 'session' ? `${list.length}` : `${S.total}`) + (live ? ` · ${live} en cours` : '');
    body.className = 'fl-body ' + (P.layout === 'grid' ? 'fl-grid' : 'fl-list');
    // les cartes de rendus d'une autre disposition n'ont plus lieu d'être
    for (const key of [...S.jcells.keys()]) if (!js.some((j) => key === `${P.layout}:j:${j.id}`)) S.jcells.delete(key);
    const nodes = [...js.map(jobCard), ...list.map(card)];
    reconcile(body, nodes);
    empty.hidden = !!nodes.length || !S.loaded;
    empty.textContent = P.q ? `rien ne répond à « ${P.q} »` : P.filter === 'fav' ? 'aucun objet aimé : le cœur, au survol d’une vignette, en ajoute'
      : P.filter === 'session' ? 'rien encore dans cette session : « Tout » montre ce qui a été fait avant'
        : (o.empty || 'rien encore : un rendu paraît ici dès l’envoi');
    paintMore();
  }

  // ── la visionneuse plein écran ────────────────────────────
  function open(x) {
    if (!x) return;
    const it = typeof x === 'string' ? S.items.find((i) => i.id === x) : x;
    if (!it) { libItem(x).then((got) => (got ? open(got) : toast('introuvable dans la bibliothèque'))); return; }
    closeMenus();
    if (S.fresh.delete(it.id)) S.cells.get(`${P.layout}:${it.id}`)?.classList.remove('fresh');
    if (!V) build();
    V.it = it;
    paintViewer();
  }
  function build() {
    const media = el('div', { class: 'fv-media' });
    const tools = el('div', { class: 'fv-tools' });
    const pos = el('span', { class: 'lbl fv-pos' });
    const prev = el('button', { class: 'fv-nav prev', type: 'button', title: 'précédent (← ou molette)', 'aria-label': 'précédent', onclick: () => step(-1) }, ico('prev'));
    const next = el('button', { class: 'fv-nav next', type: 'button', title: 'suivant (→ ou molette)', 'aria-label': 'suivant', onclick: () => step(1) }, ico('next'));
    const stage = el('div', { class: 'fv-stage' }, media, el('div', { class: 'fv-top' }, pos, tools), prev, next);
    const side = el('aside', { class: 'fv-side', 'aria-label': 'l’objet' });
    const ov = el('div', { class: 'fv', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'visionneuse', tabindex: '-1' }, stage, side);
    V = { ov, media, tools, pos, prev, next, side, acc: 0, lock: 0, last: 0, custom: null, restore: document.activeElement };
    document.body.append(ov);
    document.documentElement.classList.add('fv-open');
    ov.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKey);
    contextMenu(stage, () => (V ? menuItems(V.it) : null));
    ov.focus({ preventScroll: true });
  }
  function close() {
    if (!V) return;
    V.media.querySelector('video')?.pause();
    V.ov.remove();
    document.removeEventListener('keydown', onKey);
    document.documentElement.classList.remove('fv-open');
    const back = V.restore;
    V = null;
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* sans historique */ }
    if (back && document.contains(back)) back.focus({ preventScroll: true });
    o.onClose?.();
  }
  const vapi = {
    media(node) { if (!V) return; V.custom = node; paintMedia(); },
    reset() { if (!V) return; V.custom = null; paintMedia(); },
    item: () => V?.it || null,
  };
  function index() { return V ? shown().findIndex((i) => i.id === V.it.id) : -1; }
  async function step(d) {
    if (!V) return;
    const k = index();
    if (k < 0) { toast('hors du fil : pas de voisin'); return; }
    let l = shown();
    if (k + d >= l.length && hasMore()) { await load(true); l = shown(); }
    const n = k + d;
    if (n < 0 || n >= l.length) { V.ov.classList.remove('bump'); void V.ov.offsetWidth; V.ov.classList.add('bump'); return; }
    V.it = l[n];
    paintViewer();
  }
  function onWheel(e) {
    // un panneau qui peut encore défiler dans ce sens garde la molette
    for (let n = e.target; n && n !== V.ov; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight + 1) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === 'auto' || oy === 'scroll')
          && ((e.deltaY > 0 && n.scrollTop + n.clientHeight < n.scrollHeight - 1) || (e.deltaY < 0 && n.scrollTop > 0))) return;
      }
    }
    e.preventDefault();
    const now = performance.now();
    if (now < V.lock) return;
    if (now - V.last > 220) V.acc = 0;
    V.last = now;
    const dy = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    V.acc += e.deltaMode === 1 ? dy * 16 : e.deltaMode === 2 ? dy * 400 : dy;
    if (Math.abs(V.acc) >= 50) {
      const d = Math.sign(V.acc);
      V.acc = 0;
      V.lock = now + 260;
      step(d);
    }
  }
  function onKey(e) {
    if (!V || document.querySelector('.sr-menu, .scrim')) return;   // un menu, une fenêtre par-dessus
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); step(-1); }
    else if (['ArrowRight', 'ArrowDown', 'PageDown'].includes(e.key)) { e.preventDefault(); step(1); }
  }
  function paintPos() {
    const k = index(), l = shown();
    V.pos.textContent = k >= 0 ? `${k + 1} / ${P.filter === 'session' ? l.length : Math.max(S.total, l.length)}` : 'hors du fil';
    V.prev.disabled = k <= 0;
    V.next.disabled = k < 0 || (k >= l.length - 1 && !hasMore());
    // un bouton éteint dit pourquoi
    V.prev.title = k < 0 ? 'hors du fil : pas de voisin' : k === 0 ? 'le premier du fil' : 'précédent (← ou molette)';
    V.next.title = V.next.disabled ? (k < 0 ? 'hors du fil : pas de voisin' : 'le dernier du fil') : 'suivant (→ ou molette)';
  }
  function paintMedia() {
    const it = V.it;
    V.media.querySelector('video')?.pause();
    V.media.classList.toggle('alpha', !V.custom && !!o.alpha?.(it));
    if (V.custom) { V.media.replaceChildren(V.custom); return; }
    let m;
    if (it.kind === 'video') {
      m = el('video', { src: href(it.url), controls: true, autoplay: true, loop: true, playsinline: true, poster: it.thumb_url ? href(it.thumb_url) : null });
    } else if (it.kind === 'image') {
      m = el('img', { src: href(it.url), alt: it.title || '' });
      dragItem(m, it);   // la grande image se glisse vers un emplacement (références, image à éditer…)
    } else if (it.kind === 'audio') {
      m = el('audio', { src: href(it.url), controls: true, autoplay: true });
    } else {
      m = el('div', { class: 'fv-el' }, ...(it.element?.refs || []).slice(0, 6).map((r) => el('img', { src: href(r.thumb_url || r.url), alt: '' })));
    }
    V.media.replaceChildren(m);
  }
  function paintViewer() {
    const it = V.it;
    try { history.replaceState(null, '', location.pathname + location.search + '#' + it.id); } catch { /* sans historique */ }
    V.custom = null;
    paintMedia();
    paintPos();
    V.tools.replaceChildren(...(o.viewerTools ? o.viewerTools(it, vapi) : []).filter(Boolean));
    paintSide();
    // les voisins se préparent : la molette ne fait pas attendre
    const l = shown(), k = index();
    for (const x of [l[k + 1], l[k - 1]]) if (x?.kind === 'image' && x.url) { const im = new Image(); im.src = href(x.url); }
  }
  function paintSide() {
    const it = V.it;
    const pr = promptOf(it);
    const rw = o.reuse?.why?.(it) || '', cw = o.recreate?.why?.(it) || '';
    const badge = o.badge ? o.badge(it) : '';
    const kv = (o.details ? o.details(it) : [['taille', it.width ? `${it.width} × ${it.height}` : ''], ['créé', fmtDate(it.created)]])
      .filter(([, v]) => v !== '' && v !== null && v !== undefined);
    const head = el('div', { class: 'fv-head' }, badge ? el('span', { class: 'fl-badge' }, badge) : null,
      el('span', { class: 'lbl' }, fmtDate(it.created)), el('span', { class: 'sp' }),
      el('button', { class: 'fl-ib', type: 'button', title: 'fermer (Échap)', 'aria-label': 'fermer', onclick: close }, ico('close')));
    const prompt = el('section', { class: 'fv-sec' },
      el('div', { class: 'fv-sh' }, el('span', { class: 'lbl' }, o.promptLabel || 'Prompt'), el('span', { class: 'sp' }),
        pr ? el('button', { class: 'tb ghost sm', type: 'button', title: 'copier ce prompt', onclick: () => copyText(pr, 'prompt copié') }, 'Copier') : null),
      refsRow(it),
      pr ? el('p', { class: 'fv-prompt' }, ...rich(pr)) : el('p', { class: 'hint' }, 'aucun prompt : un objet déposé, ou fait ailleurs'));
    const details = el('section', { class: 'fv-sec' },
      el('div', { class: 'fv-sh' }, el('span', { class: 'lbl' }, 'Détails'), el('span', { class: 'sp' }),
        el('a', { class: 'lbl fv-asset', href: href('asset/#' + it.id), title: 'la fiche de l’objet dans Asset' }, 'dans Asset')),
      el('dl', { class: 'kv' }, ...kv.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, String(v))])));
    const extra = (o.extra ? o.extra(it) : []).filter(Boolean);
    const actsB = el('div', { class: 'fv-acts' },
      o.reuse ? el('button', { class: 'tb go block', type: 'button', 'aria-disabled': rw ? 'true' : null,
        title: rw || 'ses réglages dans le formulaire, graine vidée : changez un détail, générez une variante',
        onclick: () => { if (rw) { toast(rw, 5000); return; } close(); o.reuse.run(it); } }, 'Réutiliser') : null,
      el('div', { class: 'fv-row' },
        o.recreate ? el('button', { class: 'tb ghost', type: 'button', 'aria-disabled': cw ? 'true' : null,
          title: cw || 'les mêmes réglages, une nouvelle graine : remis en file', onclick: () => (cw ? toast(cw, 5000) : o.recreate.run(it)) }, 'Recréer') : null,
        ...(o.viewerActions ? o.viewerActions(it) : []).filter(Boolean)),
      el('div', { class: 'fv-row' },
        el('button', { class: 'tb ghost', type: 'button', onclick: () => download(it) }, 'Télécharger'),
        el('button', { class: 'fl-ib' + (it.fav ? ' on' : ''), type: 'button', title: it.fav ? 'ne plus aimer' : 'aimer', 'aria-label': 'aimer',
          'aria-pressed': it.fav ? 'true' : 'false', onclick: () => like(it) }, ico('heart')),
        kebab(() => menuItems(it), { cls: 'fl-ib', title: 'plus d’actions' })));
    V.side.replaceChildren(head, el('div', { class: 'fv-scroll' }, el('h3', { class: 'fv-title' }, it.title || it.id), prompt, details, ...extra), actsB);
  }

  paint();
  load(false);
  return {
    reload: () => load(false), add, update, remove, open, close, paintJobs: paint,
    items: () => S.items.slice(), get: (iid) => S.items.find((x) => x.id === iid) || null,
    current: () => V?.it || null, isOpen: () => !!V, menuItems, like, download, askDelete, element: box,
  };
}
