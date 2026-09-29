// SHOWRUNNER TOOLS — ce que toutes les pages partagent : la liste des
// outils (une seule vérité pour l'accueil et l'en-tête), l'appel au
// serveur, l'en-tête, la file des rendus, le sélecteur d'éléments de la
// bibliothèque et le dépôt de fichiers.
//
// Les adresses sont relatives à la racine du portail, déduite de ce
// fichier : les pages marchent à la racine d'un serveur comme sous un
// sous-chemin (un jour derrière la porte Cloudflare).

export const ROOT = new URL('../', import.meta.url);
export const href = (p) => (p && /^https?:/.test(p) ? p : new URL(p || '', ROOT).href);
// La base de l'API : le portail lui-même, sauf si la page en déclare une autre.
const API = window.SR_API ? new URL(window.SR_API, location.href) : new URL('api/', ROOT);

export const TOOLS = [
  { id: 'asset',     k: 'SR—00', name: 'Asset',             path: 'asset/',    sub: 'images · éléments · vidéos · sons' },
  { id: 'image',     k: 'SR—01', name: 'Image',             path: 'image/',    sub: 'Z-Image · Qwen 2.1 · Krea 2 · édition' },
  { id: 'movie',     k: 'SR—02', name: 'Movie Creator',     path: 'movie/',    sub: 'image → vidéo · références → vidéo · banc' },
  { id: 'character', k: 'SR—03', name: 'Character Factory', path: null,        sub: 'du visage au rig', external: 'cf' },
  { id: 'object',    k: 'SR—04', name: 'Object Creator',    path: 'objet/',    sub: 'une image, des vues, un mesh' },
  { id: 'montage',   k: 'SR—05', name: 'Montage',           path: 'montage/',  sub: 'timeline · découpe · export' },
  { id: 'music',     k: 'SR—06', name: 'Musique',           path: 'musique/',  sub: 'rack · nodal · timeline' },
  { id: 'analyse',   k: 'SR—07', name: 'Movie Analysis',    path: 'analyse/',  sub: 'dépouillement · diarisation' },
  { id: 'ideation',  k: 'SR—08', name: 'Idéation',          path: 'ideation/', sub: 'canvas · planches · idées' },
  { id: 'upscale',   k: 'SR—09', name: 'Upscale',           path: 'upscale/',  sub: 'images · vidéos · netteté' },
];

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
export async function api(path, { method = 'GET', body, raw, headers = {}, signal } = {}) {
  const opts = { method, headers: { ...headers }, signal };
  if (raw !== undefined) opts.body = raw;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(new URL(path.replace(/^\/?(api\/)?/, ''), API), opts);
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = { error: txt.slice(0, 300) }; }
  if (!r.ok) {
    const e = new Error((data && data.error) || `${r.status} ${r.statusText}`);
    e.status = r.status;
    throw e;
  }
  return data;
}

// Un fichier du disque de Cal vers la bibliothèque.
export async function uploadFile(file, { tool = 'upload', folder = '', title = '' } = {}) {
  const q = new URLSearchParams({ name: file.name, tool, folder, title: title || file.name.replace(/\.[^.]+$/, '') });
  return api('library/upload?' + q, { method: 'PUT', raw: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
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
  return href(t.path);
}

export function mountHeader(toolId, { sub = '' } = {}) {
  const t = TOOLS.find((x) => x.id === toolId);
  const nav = el('nav', { class: 'tools' });
  const hdr = el('header', { class: 'hdr' },
    el('a', { class: 'logo', href: href('') , title: 'le portail' },
      el('span', { class: 'sq' }, el('i')),
      el('span', {}, el('b', {}, 'Showrunner'), el('small', {}, 'tools'))),
    t ? el('span', { class: 'tool-name' }, el('span', { class: 'k' }, t.k), el('b', {}, t.name),
      sub ? el('span', { class: 'lbl' }, sub) : null) : null,
    nav,
    el('span', { class: 'sp' }),
    el('span', { class: 'pill', id: 'sr-sys', title: 'les machines' }, el('i'), el('span', {}, 'machines')),
    el('button', { class: 'tb ghost sm', id: 'sr-queue', title: 'la file des rendus', onclick: () => drawer(true) }, 'File'));
  document.body.prepend(hdr);
  system().then((sys) => {
    for (const x of TOOLS) {
      nav.append(el('a', { href: toolHref(x, sys), class: x.id === toolId ? 'on' : null,
        target: x.external ? '_blank' : null, rel: x.external ? 'noopener' : null }, x.name));
    }
    paintSys(sys);
  });
  setInterval(() => { sysInfo = null; system().then(paintSys); }, 20000);
  jobs.watch((list) => {
    const n = list.filter((j) => j.state === 'queued' || j.state === 'running').length;
    $('#sr-queue').textContent = n ? `File · ${n}` : 'File';
    if ($('.drawer.on')) paintDrawer(list);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') drawer(false); });
  return hdr;
}

function paintSys(sys) {
  const p = $('#sr-sys');
  if (!p) return;
  if (!sys) { p.className = 'pill err'; p.lastChild.textContent = 'portail injoignable'; return; }
  const img = (sys.lanes.image || []);
  const up = img.filter((e) => e.up).map((e) => e.machine);
  const h3 = (sys.lanes.h3 || []).filter((e) => e.up).length;
  p.className = 'pill ' + (up.length ? 'on' : 'err');
  p.lastChild.textContent = up.length ? `${up.join(' + ')}${h3 ? ' · H3' : ''}` : 'aucune machine';
  p.title = img.map((e) => `${e.machine} ${e.up ? `prête · ${e.ram_free_gb ?? '?'} Go libres` : 'ne répond pas'}`).join('\n')
    + `\nH3 : ${h3 ? 'démarré' : 'arrêté (il se démarre à la demande)'}`;
}

// ── le tiroir de la file ────────────────────────────────────
function drawer(on) {
  let d = $('.drawer');
  if (!d) {
    d = el('aside', { class: 'drawer', 'aria-label': 'file des rendus' },
      el('div', { class: 'pan-head' }, el('span', { class: 't' }, 'La file des rendus'), el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', onclick: () => drawer(false) }, 'Fermer')),
      el('div', { class: 'list' }));
    document.body.append(d);
  }
  d.classList.toggle('on', on);
  if (on) jobs.poll(true), paintDrawer(lastJobs);
}

function paintDrawer(list) {
  const box = $('.drawer .list');
  if (!box) return;
  box.replaceChildren(...(list.length ? list.map(jobRow) : [el('p', { class: 'lbl' }, 'rien en file')]));
}

export function jobRow(j) {
  const cls = j.state === 'running' ? 'run' : j.state === 'error' ? 'err' : j.state === 'done' ? 'ok' : '';
  const acts = el('div', { class: 'row' });
  if (j.state === 'queued' || j.state === 'running') acts.append(el('button', { class: 'tb ghost sm', onclick: () => jobs.cancel(j.id) }, 'Arrêter'));
  else {
    acts.append(el('button', { class: 'tb ghost sm', onclick: () => jobs.retry(j.id) }, 'Relancer'));
    acts.append(el('button', { class: 'tb ghost sm', title: 'retirer de la liste', onclick: () => jobs.forget(j.id) }, '×'));
  }
  return el('div', { class: 'job', title: j.message || '' },
    el('div', { class: 'jt', style: j.thumb ? { backgroundImage: `url(${href(j.thumb)})` } : null }),
    el('div', { style: { minWidth: 0 } },
      el('div', { class: 'jn' }, j.title),
      el('div', { class: 'js ' + cls }, `${stateFr(j.state)}${j.machine ? ' · ' + j.machine : ''} — ${j.message || ''}`)),
    acts,
    j.state === 'running' ? el('div', { class: 'bar' }, el('i', { style: { width: j.progress != null ? `${Math.round(j.progress * 100)}%` : '100%', opacity: j.progress != null ? 1 : 0.35 } })) : null);
}

// ── vignettes ───────────────────────────────────────────────
const KIND_FR = { image: 'image', video: 'vidéo', audio: 'son', element: 'élément' };
export const kindFr = (k) => KIND_FR[k] || k;
const ETYPE_FR = { character: 'personnage', object: 'objet', place: 'lieu', style: 'style', other: 'élément' };
export const etypeFr = (k) => ETYPE_FR[k] || k;

export function thumb(it, { onclick, selected = false, sub } = {}) {
  const im = el('div', { class: 'im' });
  if (it.kind === 'video' && it.url && !it.thumb_url) im.append(el('video', { src: href(it.url), muted: true, preload: 'metadata' }));
  else if (it.thumb_url) im.append(el('img', { src: href(it.thumb_url), alt: '', loading: 'lazy' }));
  im.append(el('span', { class: 'kind ' + it.kind }, it.kind === 'element' ? etypeFr(it.element?.type) : kindFr(it.kind)));
  if (it.duration) im.append(el('span', { class: 'dur' }, fmtDur(it.duration)));
  const s = sub ?? (it.kind === 'element' ? `${it.element?.refs?.length || 0} réf.` :
    [it.width && it.height ? `${it.width}×${it.height}` : '', it.origin?.model || it.origin?.tool || ''].filter(Boolean).join(' · '));
  return el('button', { class: 'thumb' + (selected ? ' sel' : ''), type: 'button', onclick, title: it.prompt || it.title },
    im, el('div', { class: 'cap' }, el('div', { class: 't' }, it.title || it.id), el('div', { class: 's' }, s)));
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
    const fileIn = el('input', { type: 'file', multiple: true, accept: kinds.includes('video') ? 'image/*,video/*' : 'image/*', hidden: true,
      onchange: async () => {
        for (const f of fileIn.files) {
          try { const it = await uploadFile(f); chosen.set(it.id, it); if (!multiple) return close([it]); } catch (e) { toast(e.message); }
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
    const TABS = [['all', 'Tout'], ...kinds.map((k) => [k, kindFr(k) + 's']), ...(kinds.includes('element') ? [['cf', 'Character Factory']] : [])];
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
      const kind = tab === 'all' ? kinds.join(',') : tab;
      try {
        const res = await api(`library?kind=${kind}&q=${encodeURIComponent(q)}&limit=300`);
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

// La planche de références d'un outil : des vignettes, un « + » qui ouvre le sélecteur.
export function refBoard(box, { kinds = ['image', 'element'], max = 3, onchange = () => {}, label = 'réf.' } = {}) {
  const refs = [];
  const paint = () => {
    box.replaceChildren(...refs.map((it, i) => el('div', { class: 'ref-chip', title: it.title,
      style: { backgroundImage: it.thumb_url ? `url(${href(it.thumb_url)})` : null } },
      el('span', { class: 'n' }, `${i + 1} · ${it.title}`),
      el('button', { class: 'x', title: 'retirer', onclick: () => { refs.splice(i, 1); paint(); onchange(refs); } }, '×'))),
    refs.length < max ? el('button', { class: 'ref-chip add', title: 'ajouter une référence', onclick: async () => {
      const got = await pick({ kinds, multiple: true, title: `Références (${max} au plus)` });
      for (const it of got) if (refs.length < max && !refs.some((r) => r.id === it.id)) refs.push(it);
      paint(); onchange(refs);
    } }, '+') : null);
  };
  paint();
  return { get: () => refs.slice(), set: (list) => { refs.splice(0, refs.length, ...list.slice(0, max)); paint(); onchange(refs); }, paint };
}

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
