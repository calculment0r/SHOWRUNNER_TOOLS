// L'accueil du portail (docs/etudes/positionnement.md § 5 ;
// apps_studio_elements.md § 3, décision de Cal du 29/09) : le titre et la
// seule action orange, la bibliothèque ; « Reprendre » (Studio) ; A les
// Apps (faire vite, seul) ; B le Studio (les outils liés par les éléments) ;
// C les derniers assets ; les machines en pied. Les outils viennent de TOOLS
// (commun/shell.js), la seule liste : une carte dont l'outil n'y est pas
// encore est « bientôt » — elle s'allume seule le jour où l'outil y entre
// avec sa page.
import { TOOLS, api, el, $, href, mountHeader, system, session, thumb, toolHref, toast, uploadFile, dropAnywhere, jobs, stateFr, fmtDate } from './commun/shell.js';
import { bind } from './commun/proxies.js';

mountHeader(null);

const I = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  image: I('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>'),
  movie: I('<rect x="3" y="5" width="14" height="14" rx="2"/><path d="M17 10l4-2v8l-4-2"/>'),
  song: I('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
  upscale: I('<path d="M4 14v6h6M20 10V4h-6M4 20l7-7M20 4l-7 7"/>'),
  cube: I('<path d="M12 2.5l8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5z"/><path d="M12 12l8.5-4.75M12 12v9.5M12 12L3.5 7.25"/>'),
  talk: I('<path d="M4 5h16v11H10l-6 4z"/><path d="M8 9h8M8 12h5"/>'),
  odio: I('<path d="M6 3v18M12 3v18M18 3v18"/><rect x="4" y="13" width="4" height="3"/><rect x="10" y="7" width="4" height="3"/><rect x="16" y="15" width="4" height="3"/>'),
  montage: I('<path d="M3 6h18v12H3zM3 10h18M3 14h18M8 6v4M14 10v4M11 14v4"/>'),
  board: I('<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="6" width="8" height="6" rx="1"/><rect x="6" y="14" width="10" height="7" rx="1"/>'),
  person: I('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'),
  film: I('<rect x="3" y="4" width="12" height="16" rx="1"/><path d="M6 4v16M12 4v16"/><circle cx="17.5" cy="14.5" r="3"/><path d="M19.7 16.7L22 19"/>'),
  brief: I('<path d="M4 5h16v11H10l-6 4z"/><path d="M12 7.5v6M9 10.5h6"/>'),
  pack: I('<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>'),
  lock: I('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
};

// Les Apps : un verbe par carte, aucun nom de modèle. `tool` : l'id dans
// TOOLS ; `feed` : la dernière création, qui fait le visuel des deux
// grandes. L'app Musique (le générateur de chansons) prend l'id `chanson`
// dans TOOLS le jour où sa page arrive ; ses stems et l'arrangement vont
// dans ODIO (Studio), sa ligne le dit (positionnement.md § 5.3, règle 5).
const APPS = [
  { id: 'image', tool: 'image', verb: 'Créer une image', sub: 'créer · éditer · caméra, objectif', icon: 'image', big: true, feed: 'kind=image&tool=image' },
  { id: 'movie', tool: 'movie', verb: 'Faire une vidéo', sub: 'texte, image, références → vidéo', icon: 'movie', big: true, feed: 'kind=video&tool=movie' },
  { id: 'chanson', tool: 'chanson', verb: 'Faire une chanson', sub: 'style · paroles · reprise — stems : ODIO', icon: 'song' },
  { id: 'upscale', tool: 'upscale', verb: 'Agrandir', sub: 'images · vidéos · netteté', icon: 'upscale' },
  { id: 'object3d', tool: 'object', verb: 'Faire un objet 3D', sub: 'une image → un mesh', icon: 'cube' },
  { id: 'transcrire', tool: 'transcrire', verb: 'Transcrire', sub: 'traduire · sous-titrer', icon: 'talk' },
];
// Le Studio : le nom, le code et la ligne de TOOLS. Asset n'y est pas : la
// bibliothèque est commune, c'est la carte de tête.
const STUDIO = [
  { id: 'ideation', icon: 'board', sub: 'planches · présentations' },
  { id: 'montage', icon: 'montage' },
  { id: 'music', icon: 'odio', sub: 'studio musique · stems · nodal' },
  { id: 'character', icon: 'person' },
  { id: 'object', icon: 'cube' },
  { id: 'analyse', icon: 'film' },
  { id: 'brief', icon: 'brief', name: 'Brief', sub: 'avec un agent' },
  { id: 'package', icon: 'pack', name: 'Package', sub: 'le paquet pour les agences' },
];

// Le droit Studio : `access: "studio"` sur la personne (auth.json,
// apps_studio_elements.md § 3.6) ; un admin l'a toujours ; la maison sans
// porte (auth: false), c'est Cal. /api/auth/me ne le rend pas encore
// (auth.public_user) : on le lit où le serveur le juge déjà, l'état Studio
// de l'app Musique (GET /api/chanson/options → studio {ok, asked}), qui garde
// aussi la demande (POST /api/chanson/studio/demande). Sans l'un ni l'autre :
// le Studio ouvert, comme avant.
async function accessOf(me) {
  const u = me && me.user;
  if (!me || me.auth === false || !u || u.role === 'admin') return { access: 'studio' };
  if (u.access) return { access: u.access === 'studio' ? 'studio' : 'apps' };
  try {
    const s = (await api('chanson/options')).studio;
    if (s) return { access: s.ok ? 'studio' : 'apps', asked: s.asked || null };
  } catch { /* pas d'app Musique sur ce portail */ }
  return { access: 'studio' };
}

const toolOf = (id) => TOOLS.find((t) => t.id === id && (t.path || t.external)) || null;
// où l'outil calcule : `local` (nos DGX) ; `api` s'ajoutera dans TOOLS
// (`engines`) le jour où un modèle fermé sera branché — pas avant
const enginesOf = (t) => (t && t.engines) || ['local'];
const S = { access: 'studio', asked: null, sys: null };

// une carte : un lien, un bouton fermé (qui dit pourquoi), ou « bientôt »
function card(cls, def, t, locked, soon, kids) {
  const attrs = { class: `${cls}${locked ? ' lock' : ''}${soon ? ' soon' : ''}`, 'data-tool': def.id };
  if (soon) return el('div', attrs, kids, el('span', { class: 'acc-st' }, 'bientôt'));
  if (locked) {
    // un bouton qu'on peut presser : il dit pourquoi (règle 7), il ne part pas
    return el('button', { ...attrs, type: 'button', 'aria-describedby': 'acc-why', title: 'réservé au Studio',
      onclick: () => { showWhy(true); toast(`${def.label} : réservé au Studio`); } },
    kids, el('span', { class: 'acc-st', html: ICON.lock }));
  }
  return el('a', { ...attrs, href: toolHref(t, S.sys), target: t.external ? '_blank' : null, rel: t.external ? 'noopener' : null },
    kids, el('span', { class: 'acc-st' }, ...enginesOf(t).map((e) => el('b', { class: 'acc-eng' }, e))));
}

// ce qui débloque (règle 7) : la demande, que Cal voit dans le journal d'Admin
function showWhy(flash = false) {
  const w = $('#acc-why');
  w.hidden = S.access !== 'apps';
  if (w.hidden) return;
  const ask = el('button', { class: 'tb ghost sm', type: 'button', onclick: async () => {
    ask.disabled = true;
    try { S.asked = (await api('chanson/studio/demande', { method: 'POST', body: {} })).asked || new Date().toISOString(); showWhy(); } catch (e) { ask.disabled = false; toast(e.message); }
  } }, 'Demander le Studio');
  w.replaceChildren('réservé au Studio · ', S.asked ? `demandé le ${fmtDate(S.asked)} : Cal l’ouvre depuis Admin` : ask);
  if (flash) { w.classList.remove('flash'); void w.offsetWidth; w.classList.add('flash'); }
}

// la seule action orange : répondre à un brief (Studio), créer une image (Apps)
function paintActs() {
  const box = $('#acc-acts');
  if (S.access === 'apps') {
    const t = toolOf('image');
    box.replaceChildren(el('a', { class: 'tb go', href: toolHref(t, S.sys) }, 'Créer une image'));
    return;
  }
  // tant que le parcours « brief » n'existe pas : une planche d'Idéation neuve
  const go = el('button', { class: 'tb go', type: 'button', onclick: async () => {
    go.disabled = true;
    try {
      const b = await api('ideation/boards', { method: 'POST', body: { name: 'Brief' } });
      location.href = href('ideation/#' + b.id);
    } catch (e) { go.disabled = false; toast(e.message); }
  } }, 'Répondre à un brief');
  box.replaceChildren(go);
}

function paintApps() {
  const tones = ['t3', 't2', 't1'];
  let n = 0;
  const node = (a) => {
    const t = toolOf(a.tool);
    const vis = el('span', { class: 'acc-vis' }, el('span', { class: 'acc-ico', html: ICON[a.icon] }));
    const txt = el('span', { class: 'acc-txt' }, el('b', { class: 'acc-verb' }, a.verb), el('span', { class: 'acc-line' }, a.sub));
    const c = card(`acc-app ${a.big ? 'big' : tones[n++ % 3]}`, { ...a, label: a.verb }, t, false, !t, [vis, txt]);
    if (a.feed && t) feed(c, vis, a.feed);
    return c;
  };
  $('#acc-big').replaceChildren(...APPS.filter((a) => a.big).map(node));
  $('#acc-row').replaceChildren(...APPS.filter((a) => !a.big).map(node));
}

// le visuel d'une grande carte : la dernière création de l'app
async function feed(c, vis, q) {
  try {
    const it = (await api(`library?${q}&limit=1`)).items?.[0];
    if (!it || !it.thumb_url) return;
    vis.prepend(bind(el('img', { alt: '', decoding: 'async' }), it, { fit: 'cover', box: [720, 420] }));
    c.classList.add('has-img');
  } catch { /* la carte garde son icône */ }
}

function paintStudio() {
  const tones = ['v3', 'v4', 'v5'];
  $('#acc-studio').replaceChildren(...STUDIO.map((s, i) => {
    const t = toolOf(s.id);
    const name = s.name || (t && t.name) || s.id;
    return card(`acc-tool ${tones[i % 3]}`, { ...s, label: name }, t, !!t && S.access === 'apps' && !t.open, !t, [
      el('span', { class: 'acc-top-l' }, el('span', { class: 'acc-ico', html: ICON[s.icon] }), t ? el('span', { class: 'acc-code' }, t.k) : null),
      el('span', { class: 'acc-txt' }, el('b', { class: 'acc-name' }, name), el('span', { class: 'acc-line' }, s.sub || (t && t.sub) || ''))]);
  }));
  showWhy();
}

// ── la bibliothèque : le compte, les derniers assets ────────
async function paintAssets() {
  try {
    const res = await api('library?limit=16');
    const c = res.counts || {};
    const n = Object.values(c).reduce((a, b) => a + b, 0);
    $('#acc-n').textContent = String(n).padStart(4, '0');
    $('#acc-detail').textContent = `${c.image || 0} images · ${c.element || 0} éléments · ${c.video || 0} vidéos · ${c.audio || 0} sons`;
    $('#acc-assets').hidden = !res.items.length;
    $('#acc-strip').replaceChildren(...res.items.map((it) => thumb(it, { onclick: () => { location.href = href('asset/#' + it.id); } })));
  } catch (e) { $('#acc-detail').textContent = e.message; }
}

// ── reprendre (Studio) : les travaux en cours, les derniers projets ──
const R = { projs: [], jobs: [] };
async function loadProjects() {
  if (S.access === 'apps') return;
  const get = (path, key, tool, open) => api(path).then((r) => (r[key] || []).map((p) => ({ ...p, tool, open: open(p.id) }))).catch(() => []);
  const lists = await Promise.all([
    get('ideation/boards', 'boards', 'idéation', (id) => 'ideation/#' + id),
    get('montage/projects', 'projects', 'montage', (id) => 'montage/#' + id),
    get('music/projects', 'projects', 'odio', (id) => 'musique/?p=' + encodeURIComponent(id)),
  ]);
  R.projs = lists.flat().sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || ''))).slice(0, 8);
  paintResume();
}
function paintResume() {
  const openQueue = () => $('#sr-queue')?.click();
  const chips = [
    ...R.jobs.map((j) => el('button', { class: 'acc-chip job', type: 'button', onclick: openQueue, title: 'la file des calculs' },
      el('span', { class: 'acc-ck' + (j.state === 'running' ? ' run' : '') }, stateFr(j.state)),
      el('span', { class: 'acc-cn' }, j.title || j.kind),
      el('span', { class: 'acc-cd' }, j.state === 'running' && j.progress != null ? `${Math.round(j.progress * 100)} %` : (j.machine || '')))),
    ...R.projs.map((p) => el('a', { class: 'acc-chip', href: href(p.open) },
      el('span', { class: 'acc-ck' }, p.tool), el('span', { class: 'acc-cn' }, p.name || p.id), el('span', { class: 'acc-cd' }, fmtDate(p.updated)))),
  ];
  $('#acc-resume').hidden = !chips.length;
  $('#acc-chips').replaceChildren(...chips);
}
// la file : le relevé de l'en-tête (jobs.watch)
jobs.watch((list) => {
  R.jobs = list.filter((j) => j.state === 'running' || j.state === 'queued').slice(0, 4);
  if (S.access !== 'apps') paintResume();
});

// ── les machines, en pied : discret ─────────────────────────
function paintSys(sys) {
  const box = $('#acc-sys');
  const pill = (cls, txt, title = '') => el('span', { class: `pill ${cls}`, title }, el('i'), el('span', {}, txt));
  if (!sys) { box.replaceChildren(pill('err', 'le portail ne répond pas')); return; }
  const by = new Map();
  for (const [lane, eps] of Object.entries(sys.lanes || {})) {
    for (const e of eps) {
      const m = by.get(e.machine) || { lanes: {}, ram: null };
      m.lanes[lane] = e.up;
      if (e.up && e.ram_free_gb != null) m.ram = `${e.ram_free_gb} / ${e.ram_total_gb} Go libres`;
      by.set(e.machine, m);
    }
  }
  const pills = [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, s]) =>
    pill(s.lanes.image ? 'on' : 'err', m, [s.lanes.image ? 'ComfyUI prêt' : 'ComfyUI ne répond pas', s.ram].filter(Boolean).join(' · ')));
  const h3 = (sys.lanes?.h3 || []).some((e) => e.up);
  pills.push(pill(h3 ? 'on' : '', h3 ? 'H3' : 'H3 au repos', h3 ? 'H3 démarré' : 'H3 se démarre à la demande'));
  if (sys.cf_studio) pills.push(pill(sys.cf_studio.up ? 'on' : 'err', 'Character Factory', sys.cf_studio.up ? 'le studio répond' : 'le studio ne répond pas'));
  pills.push(el('span', { class: 'pill' }, el('span', {}, sys.queued ? `${sys.queued} en file` : 'file vide')));
  // les modèles fermés (positionnement.md § 5.3, règle 8) : rien n'est branché
  pills.push(el('span', { class: 'pill', title: 'tout calcule sur nos DGX' }, el('span', {}, 'API : pas encore branchées')));
  box.replaceChildren(...pills);
}

async function paint() {
  const [sys, me] = await Promise.all([system(), session()]);
  S.sys = sys;
  Object.assign(S, await accessOf(me));
  document.documentElement.dataset.access = S.access;
  paintActs();
  paintApps();
  paintStudio();
  paintSys(sys);
  paintAssets();
  loadProjects();
}

dropAnywhere(async (files) => {
  for (const f of files) {
    try { await uploadFile(f, { tool: 'upload' }); toast(`${f.name} rangé dans la bibliothèque`); } catch (e) { toast(`${f.name} : ${e.message}`); }
  }
  paintAssets();
});

setInterval(() => system().then(paintSys), 20000);
paint();
