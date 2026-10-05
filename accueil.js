// L'accueil du portail (docs/etudes/positionnement.md § 5 ;
// apps_studio_elements.md § 3, décision de Cal du 29/09) : le titre et la
// seule action orange, la bibliothèque ; « Reprendre » (Studio) ; A les
// Apps (faire vite, seul) ; B le Studio (les outils liés par les éléments) ;
// C les derniers assets ; les machines et les crédits (le GPU du mois de la
// Team, étape 8) en pied. Les outils viennent de TOOLS
// (commun/shell.js), la seule liste : une carte dont l'outil n'y est pas
// encore est « bientôt » — elle s'allume seule le jour où l'outil y entre
// avec sa page.
import { TOOLS, api, el, $, href, mountHeader, system, session, thumb, toolHref, toast, uploadFile, dropAnywhere, jobs, stateFr, fmtDate, ouvrirFile, studioIci, studioLiens } from './commun/shell.js';
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
  { id: 'image', tool: 'image', verb: 'Créer une image', sub: 'créer · éditer · caméra, objectif', icon: 'image', big: true, img: 'media/accueil-image.webp' },
  { id: 'movie', tool: 'movie', verb: 'Faire une vidéo', sub: 'texte, image, références → vidéo', icon: 'movie', big: true, video: 'media/accueil-video.mp4', poster: 'media/accueil-video.webp' },
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

// Le droit Studio : jugé par la porte (core/auth.py, « le Studio » ;
// apps_studio_elements.md § 3.6), rendu par /api/auth/me et lu d'une seule
// façon (commun/shell.js, studioIci, studioLiens) — un admin l'a toujours, la
// maison sans porte (auth: false) c'est Cal. La demande : POST /api/auth/studio,
// que Cal voit dans Admin. Sans réponse du portail : rien à fermer ici (le serveur juge).
function accessOf(me) {
  const u = me && me.user;
  if (!u) return { access: 'studio', asked: null, liens: [] };
  return { access: studioIci(me) ? 'studio' : 'apps', asked: u.studio_asked || null, liens: studioLiens(me) };
}
// une carte d'outil fermée à ce compte : un outil Studio de TOOLS (sauf `open`), sans le Studio — sauf
// l'outil dont un lien lui ouvre un document (une planche d'Idéation : il y entre pour elle)
const lockedFor = (t) => !!t && S.access === 'apps' && t.tier === 'studio' && !t.open && !S.liens.includes(t.id);

const toolOf = (id) => TOOLS.find((t) => t.id === id && (t.path || t.external)) || null;
// où l'outil calcule : `local` (nos DGX) ; `api` s'ajoutera dans TOOLS
// (`engines`) le jour où un modèle fermé sera branché — pas avant
const enginesOf = (t) => (t && t.engines) || ['local'];
const S = { access: 'studio', asked: null, liens: [], sys: null, budget: null };

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
    try {
      const r = await api('auth/studio', { method: 'POST', body: {} });
      if (r.ok) { location.reload(); return; }
      S.asked = r.asked || new Date().toISOString();
      showWhy();
    } catch (e) { ask.disabled = false; toast(e.message); }
  } }, 'Demander le Studio');
  w.replaceChildren('réservé au Studio · ', S.asked ? `demandé le ${fmtDate(S.asked)} : Cal l’ouvre depuis Admin` : ask);
  if (flash) { w.classList.remove('flash'); void w.offsetWidth; w.classList.add('flash'); }
}

// la seule action orange : commencer un projet (Studio), créer une image (Apps)
function paintActs() {
  const box = $('#acc-acts');
  if (S.access === 'apps') {
    const t = toolOf('image');
    box.replaceChildren(el('a', { class: 'tb go', href: toolHref(t, S.sys) }, 'Créer une image'));
    return;
  }
  // le mode showrunner (Cal, 05/10 ; docs/etudes/mode_showrunner.md) : Idéation sur une planche à
  // venir, avec par-dessus la fenêtre « Commencer un projet » (ideation/projet.js) — un brief et
  // tout ce qu'on a ; elle crée la Team, son Workspace, la planche rangée. Même onglet : l'onglet
  // passera dans le Workspace neuf.
  box.replaceChildren(el('a', { class: 'tb go acc-go', href: href('ideation/?projet=nouveau'),
    title: 'un brief et tout ce que tu as (PDF, images, vidéos, sons, textes) : une Team, un Workspace, une planche rangée' },
  'Commencer un projet'));
  box.append(el('span', { class: 'acc-go-sub' }, 'un brief, tes fichiers · une Team, un Workspace, une planche rangée'));
}

function paintApps() {
  const tones = ['t3', 't2', 't1'];
  let n = 0;
  const node = (a) => {
    const t = toolOf(a.tool);
    const vis = el('span', { class: 'acc-vis' }, el('span', { class: 'acc-ico', html: ICON[a.icon] }));
    const txt = el('span', { class: 'acc-txt' }, el('b', { class: 'acc-verb' }, a.verb), el('span', { class: 'acc-line' }, a.sub));
    // une app dont l'outil est encore au Studio (Object Creator, avant l'app 3D : étude § 4, étape 11) se ferme de même
    const c = card(`acc-app ${a.big ? 'big' : tones[n++ % 3]}`, { ...a, label: a.verb }, t, lockedFor(t), !t, [vis, txt]);
    if (a.img || a.video) {
      let m;
      if (a.video) {
        m = el('video', { poster: a.poster, loop: true, playsinline: true, preload: 'auto', 'aria-hidden': 'true' });
        m.muted = true;              // la propriété : l'attribut posé après coup ne suffit pas à l'autoplay
        m.src = a.video;
        m.play().catch(() => {});    // refusée (économie d'énergie…) : l'affiche reste
      } else m = el('img', { src: a.img, alt: '', decoding: 'async' });
      vis.prepend(m);
      c.classList.add('has-img');
    } else if (a.feed && t) feed(c, vis, a.feed);
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
    return card(`acc-tool ${tones[i % 3]}`, { ...s, label: name }, t, lockedFor(t), !t, [
      el('span', { class: 'acc-top-l' }, el('span', { class: 'acc-ico', html: ICON[s.icon] }), t ? el('span', { class: 'acc-code' }, t.k) : null),
      el('span', { class: 'acc-txt' }, el('b', { class: 'acc-name' }, name), el('span', { class: 'acc-line' }, s.sub || (t && t.sub) || ''))]);
  }));
  showWhy();
}

// ── la bibliothèque : le compte, les derniers assets ────────
async function paintAssets() {
  try {
    const res = await api('library?limit=16');
    $('#acc-assets').hidden = !res.items.length;
    $('#acc-strip').replaceChildren(...res.items.map((it) => thumb(it, { onclick: () => { location.href = href('asset/#' + it.id); } })));
  } catch { $('#acc-assets').hidden = true; }
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
  const openQueue = () => ouvrirFile();   // la file : le menu du nom (commun/shell.js), plus un bouton de la barre
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
  const credits = budgetPills(pill);
  pills.push(...credits);
  // les modèles fermés (positionnement.md § 5.3, règle 8) : rien n'est branché
  if (!credits.length) pills.push(el('span', { class: 'pill', title: 'tout calcule sur nos DGX' }, el('span', {}, 'API : pas encore branchées')));
  box.replaceChildren(...pills);
}

// ── les crédits : la consommation du mois de la Team du Workspace courant ──
// (étape 8, equipes_espaces.md § 2.6 ; GET /api/budget, server/tools/equipes.py) : les
// secondes de GPU mesurées (conso.jsonl) et réservées par les travaux en cours ; la part
// utilisée s'il y a un plafond ; plafond atteint, la pastille le dit et mène à qui
// débloque (règle 7). Un guest ne calcule pas : rien.
const fmtS = (s) => {
  s = Math.max(0, Math.round(s || 0));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
};
async function loadBudget() {
  try { S.budget = await api('budget'); } catch { S.budget = null; }
  if (S.sys !== null) paintSys(S.sys);
}
function meter(spent, cap) {
  const pc = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 100;
  return el('span', { class: 'acc-meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pc),
    'aria-label': `${pc} % du plafond` }, el('span', { style: `width:${pc}%` }));
}
function budgetPills(pill) {
  const b = S.budget;
  if (!b || !b.team || b.hidden || !b.total) return [];
  const t = b.total;
  const who = b.personal ? 'chez moi' : b.name;
  const spent = t.gpu_used_s + t.gpu_held_s;
  const unblock = (what) => (b.manage
    ? el('a', { class: 'acc-fix', href: href('admin/#teams') }, what)
    : el('span', { class: 'acc-fix' }, `demande à ${b.unblock}`));
  const out = [];
  const detail = [`${b.month_fr} : ${fmtS(t.gpu_used_s)} de GPU mesurées`,
    t.gpu_held_s ? `${fmtS(t.gpu_held_s)} réservées par les travaux en cours` : null,
    t.gpu_cap_s == null ? 'sans plafond' : `plafond ${fmtS(t.gpu_cap_s)}`].filter(Boolean).join(' · ');
  if (t.gpu_cap_s == null) {
    out.push(pill('on', `GPU · ${who} · ${fmtS(t.gpu_used_s)} ce mois`, detail));
  } else {
    const full = spent >= t.gpu_cap_s;
    const p = pill(full ? 'err' : 'on', `GPU · ${who} · ${fmtS(spent)} / ${fmtS(t.gpu_cap_s)}`, detail);
    p.append(meter(spent, t.gpu_cap_s));
    out.push(p);
    if (full) out.push(unblock('relever le plafond'));
  }
  // la part de la personne, s'il y en a une
  const me = b.me;
  if (me && me.gpu_cap_s != null) {
    const mine = me.gpu_used_s + me.gpu_held_s;
    const full = mine >= me.gpu_cap_s;
    const p = pill(full ? 'err' : '', `ta part · ${fmtS(mine)} / ${fmtS(me.gpu_cap_s)}`, `${b.month_fr} : ta part de GPU dans ${who}`);
    p.append(meter(mine, me.gpu_cap_s));
    out.push(p);
    if (full && !(t.gpu_cap_s != null && spent >= t.gpu_cap_s)) out.push(unblock('agrandir la part'));
  }
  // l'API payante : coupée par défaut, sans crédit (décision 6)
  const off = !b.api_open || !t.credits_cap;
  out.push(pill('', off ? 'API : coupée · 0 crédit' : `API · ${t.credits_used + t.credits_held} / ${t.credits_cap} crédits`,
    off ? 'aucun modèle payant n’est branché ; un admin de la Team ouvre l’API et pose des crédits' : `${b.month_fr} : 1 crédit = 0,01 €`));
  return out;
}

// le positionnement et le kit de présentation (server/tools/strategie.py : au seul compte de Cal) :
// Cal, 05/10 — un panneau à droite du titre, un seul gros bouton qui mène à la page du positionnement,
// comme une page normale du portail : même onglet, jamais le volet (commun/coquille.js ne prend que
// les liens « nouvel onglet ») ; `_top` : la page entière, même depuis un cadre du portail. Les pages
// du kit ont leur barre d'accès direct (commun/kit_nav.js). Un autre compte reçoit 403 : rien ne se montre.
async function paintKit() {
  const box = $('#acc-kit');
  let d;
  try { d = await api('strategie/plan'); } catch { box.hidden = true; return; }
  const docs = d.docs || [];
  const autres = docs.filter((x) => x.path !== 'index.html').map((x) => x.titre);
  box.replaceChildren(el('a', { class: 'acc-kit-go', href: href('strategie/'), target: '_top' },
    el('span', { class: 'acc-ref' }, '00_KIT · pour toi seul'),
    el('span', { class: 'acc-kit-t' }, 'Positionnement'),
    el('span', { class: 'acc-lede' }, docs.length ? (autres.length ? autres.join(' · ') : 'le kit de présentation')
      : 'le kit n’est pas encore posé : ~/showrunner-data/strategie/ sur DGX2'),
    el('span', { class: 'acc-kit-arr', 'aria-hidden': 'true' }, '→')));
  box.hidden = false;
  box.closest('.acc-top')?.classList.add('kit');
}

async function paint() {
  const [sys, me] = await Promise.all([system(), session()]);
  S.sys = sys;
  Object.assign(S, accessOf(me));
  document.documentElement.dataset.access = S.access;
  paintActs();
  paintApps();
  paintStudio();
  paintSys(sys);
  paintAssets();
  loadProjects();
  loadBudget();
  paintKit();
}

dropAnywhere(async (files) => {
  for (const f of files) {
    try { await uploadFile(f, { tool: 'upload' }); toast(`${f.name} rangé dans la bibliothèque`); } catch (e) { toast(`${f.name} : ${e.message}`); }
  }
  paintAssets();
});

setInterval(() => system().then((sys) => { S.sys = sys; paintSys(sys); loadBudget(); }), 20000);
paint();
