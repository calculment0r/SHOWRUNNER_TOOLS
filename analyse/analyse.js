// MOVIE ANALYSIS — l'accueil de l'outil dans le portail : les PROJETS, comme la home de MOVIE_ANALYSE (index.html :
// « Projets », « Nouveau projet », une carte par projet avec ses étapes Dépouillement et Voix), dans la grammaire des
// autres outils du portail (Image, Vidéo : commun/fil.css) — le fil en grille ou en liste, un filtre, une recherche, la
// taille des vignettes ; au survol Studio, Voix et « ⋯ » ; le même menu au clic droit (commun/menu.js) ; un clic ouvre
// la visionneuse plein écran, qui porte la page projet de MOVIE_ANALYSE (projet/index.html : son dépouillement, son labo
// des voix, renommer, supprimer, restaurer) ; la molette et les flèches passent au projet voisin, Échap ferme.
//
// Les projets viennent du serveur (/api/analyse/projets) : nos films (analyse/analyses/), les analyses faites d'ici, les
// projets créés dans le portail et ceux du dépôt partagé de MOVIE_ANALYSE, fusionnés comme le fait son commun/projets.js.
// Le dépôt partagé refuse l'écriture depuis l'adresse du portail : la page le dit (encadré C), et vérifie ce que CE
// navigateur en reçoit.
import { mountHeader, api, jobs, pick, thumb, toast, el, $, $$, href, fmtDur, fmtDate, dropZone } from '../commun/shell.js';
import { menu, kebab, contextMenu, closeMenus } from '../commun/menu.js';
import { copyText, ask } from '../commun/fil.js';

mountHeader('analyse');
favicon();

const S = { projets: [], partage: null, portail: null, runs: '', chaine: null, travaux: [], charge: false, erreur: '',
  // la fenêtre « Nouvelle analyse »
  source: 'bib', video: null, langue: 'fr', sceneflow: false, nomLibre: null, nomVu: '', projetLance: null };

// ── l'icône, dessinée depuis les jetons (aucune couleur écrite ici) ──
function favicon() {
  try {
    const cs = getComputedStyle(document.documentElement);
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = cs.getPropertyValue('--or').trim(); g.beginPath(); g.roundRect(0, 0, 32, 32, 6); g.fill();
    g.fillStyle = cs.getPropertyValue('--on-or').trim(); g.fillRect(12, 12, 8, 8);
    $('link[rel=icon]').href = c.toDataURL();
  } catch { /* sans canvas : pas d'icône */ }
}

const I = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  voix: '<svg viewBox="0 0 24 24"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
const ico = (k) => el('span', { class: 'fl-i' + (k === 'play' ? ' plein' : ''), 'aria-hidden': 'true', html: I[k] });
const nb = (x) => (x === null || x === undefined ? '—' : String(x));
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

// ── les préférences du fil (comme commun/fil.js : disposition, taille, filtre) ──
const PREF = 'sr-fil-analyse';
const SIZES = { grid: [140, 480, 250], list: [240, 640, 380] };
const FILTRES = { tout: 'tout', films: 'nos films', analyses: 'analysés d’ici', projets: 'à dépouiller', retires: 'retirés' };
const P = (() => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(PREF) || '{}') || {}; } catch { s = {}; }
  return { layout: s.layout === 'list' ? 'list' : 'grid', filtre: FILTRES[s.filtre] ? s.filtre : 'tout',
    size: { grid: SIZES.grid[2], list: SIZES.list[2], ...(s.size || {}) }, q: '' };
})();
const garde = () => { try { localStorage.setItem(PREF, JSON.stringify({ layout: P.layout, filtre: P.filtre, size: P.size })); } catch { /* stockage fermé */ } };

// ── ce qu'un projet est, à l'instant : son dépouillement (le travail en cours s'il y en a un) ──
const ETATS = { queued: 'en file', running: 'en cours', error: 'échec', cancelled: 'arrêté', interrupted: 'interrompu' };
function travailDe(p) {
  return S.travaux.find((j) => j.kind === 'analyse.run' && (j.params || {}).nom === p.id && ETATS[j.state]) || null;
}
function depDe(p) {
  const d = p.etapes.depouillement;
  if (d.etat === 'fait') return d;
  const j = travailDe(p);
  return j ? { etat: ETATS[j.state], message: j.message || '', progress: j.progress, j } : d;
}
const BADGE = (p) => (p.sorte === 'film' ? 'nos films' : p.sorte === 'analyse' ? 'analysé d’ici' : p.origine === 'partage' ? 'projet · MOVIE_ANALYSE' : 'projet');
function pourquoiPasStudio(p) {
  const d = depDe(p);
  if (p.studio) return '';
  if (d.etat === 'en cours' || d.etat === 'en file') return 'le dépouillement tourne sur DGX2 : le Studio arrive quand il a fini';
  if (d.j) return `le dépouillement s’est arrêté (${d.etat}) : « Relancer » reprend où il en était`;
  return 'pas encore de dépouillement : « Lancer le dépouillement » (sa fiche, ou ⋯)';
}
const lienDe = (p) => href('analyse/?projet=' + encodeURIComponent(p.id));
const arDe = (p) => Math.max(0.42, Math.min(2.6, p.largeur && p.hauteur ? p.largeur / p.hauteur : 16 / 9));
const dateDe = (p) => (p.sorte === 'film' ? 'du dépôt MOVIE_ANALYSE' : p.cree ? 'créé ' + fmtDate(p.cree) : fmtDate(p.date));
const va = (u) => { if (u) location.href = href(u); };

// les étapes d'une carte, celles de la home de MOVIE_ANALYSE (index.html : etape('Dépouillement', faite), etape('Voix', …))
function etapes(p) {
  const d = depDe(p), v = p.etapes.voix;
  const cls = d.etat === 'fait' ? 'faite' : d.etat === 'en cours' || d.etat === 'en file' ? 'encours' : d.j ? 'err' : '';
  const e = (txt, c, title) => el('span', { class: 'ma-etape ' + c, title }, el('i'), txt);
  return el('div', { class: 'ma-etapes' },
    e('Dépouillement' + (d.etat !== 'fait' && d.etat !== 'à faire' ? ' · ' + d.etat : ''), cls,
      d.etat === 'fait' ? d.resume : d.message || pourquoiPasStudio(p)),
    e('Voix', v.etat === 'fait' ? 'faite' : '',
      v.etat === 'fait' ? 'la diarisation Nemotron est dans le Studio' : p.sorte === 'projet' ? 'déposer le son ou la vidéo dans le labo' : 'voix pas encore calculées : le dépouillement suit la chaîne'));
}
function progres(p) {
  const d = depDe(p);
  if (!(d.etat === 'en cours' || d.etat === 'en file')) return null;
  return el('div', { class: 'ma-prog', title: d.message }, el('span', { class: 'ma-bar' }, el('i', { style: { width: `${Math.round((d.progress || 0) * 100)}%` } })),
    el('span', { class: 'ma-prog-t' }, d.message || d.etat));
}

// ── les gestes : au survol, dans le menu « ⋯ », au clic droit ──
function gestes(p) {
  const pas = pourquoiPasStudio(p);
  const b = (k, title, fn, why = '') => el('button', { class: 'fl-ib', type: 'button', 'aria-label': title,
    title: why ? `${title} — ${why}` : title, 'aria-disabled': why ? 'true' : null,
    onclick: (e) => { e.stopPropagation(); if (why) { toast(why, 5000); return; } fn(); } }, ico(k));
  return el('div', { class: 'fl-acts' },
    b('play', 'Ouvrir le Studio', () => va(p.studio), pas),
    b('voix', 'Le labo des voix (diarisation)', () => va(p.labo)),
    kebab(() => entrees(p), { cls: 'fl-ib', title: 'plus d’actions' }));
}
function entrees(p) {
  const d = depDe(p), pas = pourquoiPasStudio(p), j = d.j;
  return tidy([
    { label: 'Ouvrir', icon: '⤢', sub: 'la fiche', onclick: () => ouvre(p.id) },
    { label: 'Studio', icon: '▶', disabled: !!pas, why: pas, onclick: () => va(p.studio) },
    { label: 'Casting', icon: '◎', disabled: !!pas, why: pas, onclick: () => va(p.casting) },
    { label: 'Dépouillement', icon: '▤', disabled: !!pas, why: pas, onclick: () => va(p.depouillement) },
    { label: 'Labo des voix', icon: '↗', sub: 'diarisation', onclick: () => va(p.labo) },
    '-',
    p.sorte === 'projet' && !j ? { label: 'Lancer le dépouillement', icon: '▸', sub: S.chaine?.machine || 'DGX2', onclick: () => ouvreNouvelle(p) } : null,
    j && (j.state === 'queued' || j.state === 'running') ? { label: 'Arrêter le dépouillement', icon: '■', onclick: () => jobs.cancel(j.id).catch((e) => toast(e.message)) } : null,
    j && !(j.state === 'queued' || j.state === 'running') ? { label: 'Relancer', icon: '↻', sub: 'reprend où il en était', onclick: () => jobs.retry(j.id).catch((e) => toast(e.message)) } : null,
    p.renommer ? { label: 'Renommer…', icon: '✎', onclick: () => renomme(p) } : null,
    { label: 'Copier le lien', icon: '↗', onclick: () => copyText(lienDe(p), 'lien copié') },
    '-',
    p.retire ? { label: 'Restaurer', icon: '↺', sub: 'sur l’accueil', onclick: () => modifie(p, { supprime: false }, 'remis sur l’accueil') }
      : { label: p.supprimer === 'supprimer' ? 'Supprimer' : 'Retirer de l’accueil', icon: '×', danger: true,
        sub: p.supprimer === 'supprimer' ? 'pour de bon' : 'fichiers gardés', onclick: () => supprime(p) },
  ]);
}

// ── le fil ──────────────────────────────────────────────────
const box = $('#fil');
const count = el('span', { class: 'lbl fl-count' });
const filtreBtn = el('button', { class: 'tb ghost sm fl-filter', type: 'button', 'aria-haspopup': 'menu', title: 'ce que le fil montre',
  onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(r.left, r.bottom + 4, [{ head: 'Montrer' },
    ...Object.entries(FILTRES).map(([k, lab]) => ({ label: lab.charAt(0).toUpperCase() + lab.slice(1), checked: P.filtre === k,
      sub: k === 'retires' ? `${S.projets.filter((x) => x.retire).length}` : '', onclick: () => { P.filtre = k; garde(); peint(); } }))]); } });
const cherche = el('input', { class: 'fld fl-q', type: 'search', placeholder: 'chercher', 'aria-label': 'chercher un projet' });
let qT = null;
cherche.addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => { P.q = cherche.value.trim(); peint(); }, 200); });
const pleinBtn = el('button', { class: 'fl-ib', type: 'button', title: 'plein écran, à partir du premier du fil', 'aria-label': 'plein écran',
  onclick: () => { const l = visibles(); if (l.length) ouvre(l[0].id); else toast('rien à montrer'); } }, ico('full'));
const taille = el('input', { class: 'fl-size', type: 'range', step: 10, 'aria-label': 'taille des vignettes', title: 'taille des vignettes' });
taille.addEventListener('input', () => { P.size[P.layout] = Number(taille.value); tailles(); });
taille.addEventListener('change', garde);
const dispo = el('div', { class: 'seg fl-lay', role: 'group', 'aria-label': 'disposition' },
  ...[['list', 'Liste'], ['grid', 'Grille']].map(([k, lab]) => el('button', { class: 'tb', type: 'button', 'data-l': k,
    onclick: () => { if (P.layout === k) return; P.layout = k; garde(); peint(); } }, lab)));
const corps = el('div', { class: 'fl-body' });
const vide = el('div', { class: 'fl-empty', hidden: true });
box.classList.add('fil');
box.replaceChildren(el('div', { class: 'fl-bar' }, el('h2', {}, 'Projets'), count, filtreBtn, cherche, el('span', { class: 'sp' }), pleinBtn, taille, dispo),
  el('div', { class: 'why ma-err', id: 'fil-err', hidden: true }), corps, vide);

function tailles() {
  const [lo, hi] = SIZES[P.layout];
  P.size[P.layout] = Math.max(lo, Math.min(hi, Number(P.size[P.layout]) || SIZES[P.layout][2]));
  taille.min = lo; taille.max = hi; taille.value = P.size[P.layout];
  box.style.setProperty('--fl-h', P.size.grid + 'px');
  box.style.setProperty('--fl-lh', P.size.list + 'px');
}
function visibles() {
  const q = P.q.toLowerCase();
  return S.projets.filter((p) => {
    if (P.filtre === 'retires' ? !p.retire : p.retire) return false;
    if (P.filtre === 'films' && p.sorte !== 'film') return false;
    if (P.filtre === 'analyses' && p.sorte !== 'analyse') return false;
    if (P.filtre === 'projets' && p.sorte !== 'projet') return false;
    return !q || `${p.nom} ${p.id} ${p.meta || ''}`.toLowerCase().includes(q);
  });
}

function vignette(p) {
  const im = p.affiche || p.vignette;
  if (im) return el('img', { src: href(im), alt: '', loading: 'lazy', draggable: 'false' });
  const e = depDe(p).etat;
  return el('span', { class: 'ma-vide' }, el('b', {}, e === 'à faire' ? 'à commencer' : 'dépouillement'),
    el('small', {}, e === 'à faire' ? 'pas encore de dépouillement' : e));
}
function hoverPlay(zone, v, url) {
  zone.addEventListener('mouseenter', () => { if (!v.getAttribute('src')) v.src = href(url); v.play().catch(() => {}); });
  zone.addEventListener('mouseleave', () => v.pause());
}
function carteGrille(p) {
  const ar = arDe(p);
  const open = el('button', { class: 'fl-open', type: 'button', title: 'ouvrir la fiche : ' + p.nom, 'aria-label': 'ouvrir ' + p.nom,
    onclick: () => ouvre(p.id) }, vignette(p), el('span', { class: 'fl-tag' }, BADGE(p)));
  const cap = el('div', { class: 'ma-cap' },
    el('div', { class: 'ma-cap-l' }, el('b', {}, p.nom), p.duree ? el('span', { class: 'ma-cap-d' }, fmtDur(p.duree)) : null),
    el('span', { class: 'ma-cap-m' }, p.meta || ''), etapes(p), progres(p));
  const n = el('div', { class: 'fl-card ma-card' + (p.retire ? ' retire' : ''), 'data-id': p.id,
    style: { flexGrow: String(Math.round(ar * 100)), '--ar': String(ar) } },
  el('i', { class: 'fl-pad', style: { paddingBottom: `${100 / ar}%` } }), open, cap, gestes(p));
  contextMenu(n, () => entrees(p));
  return n;
}
function boutonsVues(p) {
  const pas = pourquoiPasStudio(p);
  if (!pas) {
    return [el('a', { class: 'tb ghost sm', href: href(p.studio) }, 'Studio'), el('a', { class: 'tb ghost sm', href: href(p.casting) }, 'Casting'),
      el('a', { class: 'tb ghost sm', href: href(p.depouillement) }, 'Dépouillement'), el('a', { class: 'tb ghost sm', href: href(p.labo) }, 'Voix')];
  }
  const d = depDe(p);
  return [p.sorte === 'projet' && !d.j ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => ouvreNouvelle(p) }, 'Lancer le dépouillement')
    : el('span', { class: 'lbl' }, pas), el('a', { class: 'tb ghost sm', href: href(p.labo) }, 'Voix')];
}
function puces(p) {
  const c = p.chiffres;
  if (!c) return null;
  const perso = c.reunies ? `${c.fiches} fiches de la chaîne, ${c.reunies} réunies par les corrections` : `${c.fiches} fiches de la chaîne`;
  return el('div', { class: 'fl-chips' },
    el('span', { class: 'fl-chip' }, `${nb(c.plans)} plans`),
    el('span', { class: 'fl-chip', title: perso }, `${nb(c.personnages)} personnages`),
    el('span', { class: 'fl-chip' }, `${nb(c.repliques)} répliques`),
    c.langue ? el('span', { class: 'fl-chip', title: 'la langue du dépouillement' }, c.langue) : null);
}
function ligne(p) {
  const im = p.affiche || p.vignette;
  let media;
  if (p.media) { media = el('video', { loop: true, playsinline: true, preload: 'none', poster: im ? href(im) : null }); media.muted = true; }
  else media = vignette(p);
  const open = el('button', { class: 'fl-open', type: 'button', title: 'ouvrir la fiche', 'aria-label': 'ouvrir ' + p.nom, onclick: () => ouvre(p.id) },
    media, p.media ? el('span', { class: 'fl-play' }, ico('play')) : null);
  const stage = el('div', { class: 'fl-stage' }, open, gestes(p));
  if (p.media) hoverPlay(stage, media, p.media);
  const info = el('div', { class: 'fl-info ma-info' },
    el('span', { class: 'fl-badge' }, BADGE(p)),
    el('h3', { class: 'ma-info-t' }, p.nom),
    el('span', { class: 'lbl' }, p.meta || (p.duree ? fmtDur(p.duree) : '')),
    etapes(p), progres(p), puces(p),
    el('div', { class: 'row ma-vues' }, ...boutonsVues(p)),
    el('span', { class: 'lbl fl-date' }, dateDe(p)));
  const n = el('div', { class: 'fl-row' + (p.retire ? ' retire' : ''), 'data-id': p.id }, stage, info);
  contextMenu(n, () => entrees(p));
  return n;
}

function peint() {
  tailles();
  $$('.tb', dispo).forEach((b) => b.classList.toggle('on', b.dataset.l === P.layout));
  filtreBtn.textContent = `Filtre · ${FILTRES[P.filtre]}`;
  filtreBtn.classList.toggle('set', P.filtre !== 'tout');
  const l = visibles();
  const actifs = S.projets.filter((p) => ['en cours', 'en file'].includes(depDe(p).etat)).length;
  count.textContent = `${l.length}` + (actifs ? ` · ${actifs} en cours` : '');
  corps.className = 'fl-body ' + (P.layout === 'grid' ? 'fl-grid' : 'fl-list');
  corps.replaceChildren(...l.map(P.layout === 'grid' ? carteGrille : ligne));
  vide.hidden = !!l.length || !S.charge;
  vide.textContent = P.q ? `aucun projet ne répond à « ${P.q} »` : P.filtre === 'retires' ? 'rien de retiré de l’accueil'
    : P.filtre === 'projets' ? 'aucun projet à dépouiller : « Nouveau projet », à gauche, en crée un'
      : P.filtre === 'analyses' ? 'aucune analyse lancée d’ici : « Nouvelle analyse », à gauche' : 'aucun projet';
  if (V) peintV();
}

// ── charger ─────────────────────────────────────────────────
async function charge(frais = false) {
  try {
    const r = await api('analyse/projets' + (frais ? '?frais=1' : ''));
    S.projets = r.projets || []; S.partage = r.partage; S.portail = r.portail; S.runs = r.runs || '';
    S.charge = true; S.erreur = '';
    if (r.runs) $('#nv-runs').textContent = r.runs.replace(/^\/home\/[^/]+/, '~') + '/';
    $('#fil-err').hidden = true;
  } catch (e) {
    S.erreur = e.message;
    $('#fil-err').hidden = false;
    $('#fil-err').textContent = 'le portail ne répond pas : ' + e.message;
    return;
  }
  peint();
  peintPartage();
  if (!charge.premier) { charge.premier = true; ouvreDemande(); }
}

// ?projet=<id> (le lien d'une fiche, comme projet/?id= dans MOVIE_ANALYSE) ou #<id> (comme le fil) : la fiche s'ouvre
function ouvreDemande() {
  const id = new URLSearchParams(location.search).get('projet') || decodeURIComponent((location.hash || '').slice(1));
  if (id && S.projets.some((p) => p.id === id)) ouvre(id);
  else if (id && new URLSearchParams(location.search).get('projet')) toast(`le projet « ${id} » n’existe pas, ou plus`, 5000);
}

jobs.watch((list) => {
  const avant = JSON.stringify(S.travaux.map((j) => [j.id, j.state, Math.round((j.progress || 0) * 50)]));
  S.travaux = list.filter((j) => j.kind === 'analyse.run');
  if (JSON.stringify(S.travaux.map((j) => [j.id, j.state, Math.round((j.progress || 0) * 50)])) !== avant && S.charge) peint();
});
document.addEventListener('sr:job', (e) => {
  const j = e.detail;
  if (j.kind !== 'analyse.run') return;
  if (j.state === 'done') { toast(`« ${j.params?.titre || j.params?.nom} » est dépouillé : son Studio est sur sa carte`); charge(); }
  else if (j.state === 'error') { toast('le dépouillement s’est arrêté : le message est sur la carte'); charge(); }
});

// ── renommer, supprimer, restaurer ──────────────────────────
async function modifie(p, corpsReq, dit) {
  try {
    await api('analyse/projets/' + encodeURIComponent(p.id), { method: 'POST', body: corpsReq });
    toast(dit + ' — enregistré dans le portail');
    await charge();
  } catch (e) { toast(e.message, 6000); }
}
async function renomme(p) {
  const nom = await ask({ title: 'Renommer le projet', ok: 'Renommer', field: { value: p.nom, placeholder: 'le nom du projet' } });
  if (nom && nom !== p.nom) modifie(p, { nom }, 'renommé');
}
async function supprime(p) {
  const ok = await ask({ title: p.supprimer === 'supprimer' ? 'Supprimer le projet' : 'Retirer de l’accueil', danger: true,
    ok: p.supprimer === 'supprimer' ? 'Supprimer' : 'Retirer',
    // les phrases de projet/index.html de MOVIE_ANALYSE
    text: p.supprimer === 'supprimer'
      ? `Supprimer le projet « ${p.nom} » ? Les fichiers déjà sur le DGX ne sont pas touchés.`
      : `Retirer « ${p.nom} » de l’accueil ? Il disparaît de l’accueil pour tous ceux qui ouvrent le portail ; l’analyse reste, et « Restaurer » (filtre « retirés ») la remet.` });
  if (!ok) return;
  if (V && V.p.id === p.id) ferme();
  modifie(p, { supprime: true }, p.supprimer === 'supprimer' ? 'supprimé' : 'retiré de l’accueil');
}

// ── Nouveau projet (la home de MOVIE_ANALYSE : le nom tout de suite, on crée, on ouvre) ──
$('#np').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const nom = $('#np-nom').value.trim();
  if (!nom) { $('#np-why').textContent = 'il faut un nom'; $('#np-nom').focus(); return; }
  $('#np-ok').disabled = true; $('#np-why').textContent = '';
  try {
    const r = await api('analyse/projets', { method: 'POST', body: { nom } });
    $('#np-nom').value = '';
    await charge();
    toast(`« ${r.projet.nom} » créé — enregistré dans le portail`);
    if (P.filtre !== 'tout' && P.filtre !== 'projets') { P.filtre = 'tout'; garde(); peint(); }
    ouvre(r.projet.id);
  } catch (e) { $('#np-why').textContent = e.message; }
  $('#np-ok').disabled = false;
});
$('#np-nom').addEventListener('input', () => { $('#np-why').textContent = ''; });

// ── la visionneuse : la fiche du projet (projet/index.html de MOVIE_ANALYSE), plein écran ──
let V = null;
function ouvre(id) {
  const p = S.projets.find((x) => x.id === id);
  if (!p) { toast('projet introuvable : ' + id); return; }
  closeMenus();
  if (!V) construit();
  V.p = p; V.media = null;
  peintV();
}
function construit() {
  const media = el('div', { class: 'fv-media' });
  const tools = el('div', { class: 'fv-tools' });
  const pos = el('span', { class: 'lbl fv-pos' });
  const prev = el('button', { class: 'fv-nav prev', type: 'button', title: 'précédent (← ou molette)', 'aria-label': 'précédent', onclick: () => pas(-1) }, ico('prev'));
  const next = el('button', { class: 'fv-nav next', type: 'button', title: 'suivant (→ ou molette)', 'aria-label': 'suivant', onclick: () => pas(1) }, ico('next'));
  const stage = el('div', { class: 'fv-stage' }, media, el('div', { class: 'fv-top' }, pos, tools), prev, next);
  const side = el('aside', { class: 'fv-side ma-fiche', 'aria-label': 'la fiche du projet' });
  const ov = el('div', { class: 'fv', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'la fiche du projet', tabindex: '-1' }, stage, side);
  V = { ov, mediaBox: media, tools, pos, prev, next, side, acc: 0, lock: 0, last: 0, media: null, restore: document.activeElement };
  document.body.append(ov);
  document.documentElement.classList.add('fv-open');
  ov.addEventListener('wheel', molette, { passive: false });
  document.addEventListener('keydown', clavier);
  contextMenu(stage, () => (V ? entrees(V.p) : null));
  ov.focus({ preventScroll: true });
}
function ferme() {
  if (!V) return;
  V.mediaBox.querySelector('video')?.pause();
  V.ov.remove();
  document.removeEventListener('keydown', clavier);
  document.documentElement.classList.remove('fv-open');
  const back = V.restore;
  V = null;
  try { history.replaceState(null, '', location.pathname); } catch { /* sans historique */ }
  if (back && document.contains(back)) back.focus({ preventScroll: true });
}
function place() { return V ? visibles().findIndex((x) => x.id === V.p.id) : -1; }
function pas(d) {
  if (!V) return;
  const l = visibles(), k = place();
  if (k < 0) { toast('hors du fil : pas de voisin'); return; }
  const n = k + d;
  if (n < 0 || n >= l.length) { V.ov.classList.remove('bump'); void V.ov.offsetWidth; V.ov.classList.add('bump'); return; }
  V.p = l[n]; V.media = null;
  peintV();
}
function molette(e) {
  for (let n = e.target; n && n !== V.ov; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight + 1) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && ((e.deltaY > 0 && n.scrollTop + n.clientHeight < n.scrollHeight - 1) || (e.deltaY < 0 && n.scrollTop > 0))) return;
    }
  }
  e.preventDefault();
  const now = performance.now();
  if (now < V.lock) return;
  if (now - V.last > 220) V.acc = 0;
  V.last = now;
  const dy = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  V.acc += e.deltaMode === 1 ? dy * 16 : e.deltaMode === 2 ? dy * 400 : dy;
  if (Math.abs(V.acc) >= 50) { const d = Math.sign(V.acc); V.acc = 0; V.lock = now + 260; pas(d); }
}
function clavier(e) {
  if (!V || document.querySelector('.sr-menu, .scrim:not([hidden])')) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ferme(); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); pas(-1); }
  else if (['ArrowRight', 'ArrowDown', 'PageDown'].includes(e.key)) { e.preventDefault(); pas(1); }
}
function peintMedia(p) {
  if (V.media === p.id) return;   // la vidéo qui joue n'est pas coupée à chaque relevé de la file
  V.media = p.id;
  V.mediaBox.querySelector('video')?.pause();
  const im = p.affiche || p.vignette;
  let m;
  if (p.media) {
    m = el('video', { src: href(p.media), controls: true, autoplay: true, playsinline: true, preload: 'metadata', poster: im ? href(im) : null });
    // la vidéo de nos films est sur R2 (le Worker de MOVIE_ANALYSE) : si ce navigateur ne la lit pas, on le dit
    m.addEventListener('error', () => {
      const msg = el('p', { class: 'ma-fv-err' }, `Ce navigateur ne lit pas la vidéo (${p.media.startsWith('http') ? 'sur R2 : ' + p.media : 'à côté de la page'}). Le Studio a la sienne, avec son repli.`);
      m.after(msg);
    });
  } else if (im) m = el('img', { src: href(im), alt: '' });
  else {
    const d = depDe(p);
    m = el('div', { class: 'ma-fv-vide' }, el('b', {}, d.etat === 'à faire' ? 'À commencer' : d.etat),
      el('p', {}, d.etat === 'à faire' ? 'Pas encore de dépouillement : la chaîne le fait sur DGX2, à partir d’une vidéo de la bibliothèque ou de YouTube.' : d.message || ''),
      d.etat === 'à faire' ? el('button', { class: 'tb ghost', type: 'button', onclick: () => ouvreNouvelle(p) }, 'Lancer le dépouillement') : null);
  }
  V.mediaBox.replaceChildren(m);
}
function sec(titre, k, ...kids) {
  return el('section', { class: 'fv-sec' }, el('div', { class: 'fv-sh' }, el('span', { class: 'ma-ix' }, k), el('span', { class: 'lbl' }, titre), el('span', { class: 'sp' })), ...kids);
}
function peintV() {
  const cur = S.projets.find((x) => x.id === V.p.id);
  if (cur) V.p = cur;
  const p = V.p, d = depDe(p), v = p.etapes.voix, c = p.chiffres || {};
  try { history.replaceState(null, '', location.pathname + '#' + encodeURIComponent(p.id)); } catch { /* sans historique */ }
  peintMedia(p);
  const l = visibles(), k = place();
  V.pos.textContent = k >= 0 ? `${k + 1} / ${l.length}` : 'hors du fil';
  V.prev.disabled = k <= 0; V.next.disabled = k < 0 || k >= l.length - 1;
  V.prev.title = k < 0 ? 'hors du fil : pas de voisin' : k === 0 ? 'le premier du fil' : 'précédent (← ou molette)';
  V.next.title = V.next.disabled ? (k < 0 ? 'hors du fil : pas de voisin' : 'le dernier du fil') : 'suivant (→ ou molette)';
  V.tools.replaceChildren(el('span', { class: 'lbl fv-pos' }, BADGE(p)));
  const pasStudio = pourquoiPasStudio(p);
  // 01 — le dépouillement : fait, en cours, ou à lancer (sur DGX2, d'ici ; ou à la main, la commande de MOVIE_ANALYSE)
  // la commande de projet/index.html (MOVIE_ANALYSE), avec la copie de la chaîne du portail (analyse/PROVENANCE.md)
  const cmd = "ssh dgx2 'mkdir -p ~/reelbench/runs/" + p.id + ' && cd ~/reelbench/runs/' + p.id
    + ' && SKILL=$HOME/SHOWRUNNER_TOOLS/analyse/chaine bash $HOME/SHOWRUNNER_TOOLS/analyse/chaine/analyse.sh <video.mp4> "'
    + p.nom.replace(/["'\\$\u0060]/g, '') + "\" --lang fr --sceneflow'";
  const dep = sec('Dépouillement', '01',
    el('p', { class: 'ma-quoi' }, 'Plan par plan : coupes et durées, personnages identifiés au visage, silhouettes, échelle et mouvement de caméra — et les voix : qui dit quoi, une piste par personnage, chaque mot à son instant, réattribuable à la main.'),
    etapes(p), progres(p),
    d.etat === 'fait' ? el('dl', { class: 'kv' },
      el('dt', {}, 'plans'), el('dd', {}, nb(c.plans)),
      el('dt', {}, 'personnages'), el('dd', { title: c.reunies ? `${c.fiches} fiches de la chaîne, ${c.reunies} réunies par les corrections` : '' }, nb(c.personnages) + (c.reunies ? ` (${c.fiches} fiches, ${c.reunies} réunies)` : '')),
      el('dt', {}, 'répliques'), el('dd', {}, nb(c.repliques)),
      el('dt', {}, 'durée'), el('dd', {}, c.duree ? fmtDur(c.duree) : '—'),
      el('dt', {}, 'définition'), el('dd', {}, c.largeur ? `${c.largeur} × ${c.hauteur}` : '—'),
      el('dt', {}, 'langue du dépouillement'), el('dd', {}, c.langue || '—'),
      el('dt', {}, 'mots à leur instant'), el('dd', {}, c.mots ? 'oui (mots.json)' : 'non'),
      el('dt', {}, 'vidéo'), el('dd', {}, p.sorte === 'film' ? 'sur R2 (Cloudflare), repli à côté' : 'à côté de la page')) : null,
    d.etat === 'à faire' ? el('div', { class: 'fv-row' }, el('button', { class: 'tb ghost', type: 'button', onclick: () => ouvreNouvelle(p) }, `Lancer sur ${S.chaine?.machine || 'DGX2'}`)) : null,
    d.etat === 'à faire' ? el('details', { class: 'ma-cmd' }, el('summary', { class: 'lbl' }, 'ou à la main, sur un DGX'),
      el('p', { class: 'ma-quoi' }, 'Poser la vidéo dans ', el('code', {}, `~/reelbench/runs/${p.id}/`), ', puis :'), el('pre', {}, cmd),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: () => copyText(cmd, 'commande copiée') }, 'Copier la commande')) : null,
    d.j && (d.j.state === 'queued' || d.j.state === 'running') ? el('div', { class: 'fv-row' }, el('button', { class: 'tb ghost', type: 'button', onclick: () => jobs.cancel(d.j.id).catch((e) => toast(e.message)) }, 'Arrêter')) : null,
    d.j && !(d.j.state === 'queued' || d.j.state === 'running') ? el('p', { class: 'ma-fv-err' }, d.message) : null,
    d.j && !(d.j.state === 'queued' || d.j.state === 'running') ? el('div', { class: 'fv-row' }, el('button', { class: 'tb ghost', type: 'button', onclick: () => jobs.retry(d.j.id).catch((e) => toast(e.message)) }, 'Relancer')) : null);
  // 02 — le labo des voix (la diarisation seule), qui s'ouvre sur ce projet
  const lab = sec('Labo des voix', '02',
    el('p', { class: 'ma-quoi' }, 'La diarisation seule, pour calculer ou recalculer les voix sur le DGX (Nemotron, 8 voix), essayer une autre latence, le direct au micro. Son résultat nourrit le dépouillement.'),
    el('div', { class: 'ma-etapes' }, el('span', { class: 'ma-etape ' + (v.etat === 'fait' ? 'faite' : '') }, el('i'),
      v.etat === 'fait' ? 'voix calculées — déjà dans le dépouillement' : p.sorte === 'projet' ? 'déposer le son ou la vidéo dans le labo' : 'voix pas encore calculées : le dépouillement suit la chaîne')),
    el('div', { class: 'fv-row' }, el('a', { class: 'tb ghost', href: href(p.labo) }, 'Ouvrir le labo')));
  // où vit ce qu'on y change
  const partage = S.partage || {};
  const ou = sec('Où c’est gardé', '03', el('p', { class: 'ma-quoi' },
    p.sorte === 'film'
      ? 'Ses corrections : le fichier du dépôt, puis le dépôt partagé de MOVIE_ANALYSE (lu), puis le portail — ce qu’on corrige ici y est enregistré, pour tous ceux qui ouvrent le portail : le dépôt partagé refuse l’écriture depuis cette adresse.'
      : p.origine === 'partage' ? 'Créé depuis la home de MOVIE_ANALYSE : lu dans son dépôt partagé. Ce qu’on en change ici (nom, suppression) est gardé dans le portail.'
        : 'Enregistré dans le portail, sur DGX2 — le même pour tous ceux qui l’ouvrent.'),
  partage.ecriture ? el('p', { class: 'lbl', title: partage.ecriture.source }, partage.ecriture.source) : null);
  const head = el('div', { class: 'fv-head' }, el('span', { class: 'fl-badge' }, BADGE(p)), el('span', { class: 'lbl' }, dateDe(p)), el('span', { class: 'sp' }),
    el('button', { class: 'fl-ib', type: 'button', title: 'fermer (Échap)', 'aria-label': 'fermer', onclick: ferme }, ico('close')));
  const actes = el('div', { class: 'fv-acts' },
    el('button', { class: 'tb go block', type: 'button', 'aria-disabled': pasStudio ? 'true' : null, title: pasStudio || 'la vidéo, les plans, le script, la timeline des voix',
      onclick: () => (pasStudio ? toast(pasStudio, 5000) : va(p.studio)) }, 'Ouvrir le Studio'),
    el('div', { class: 'fv-row' },
      el('button', { class: 'tb ghost', type: 'button', 'aria-disabled': pasStudio ? 'true' : null, title: pasStudio || 'le trombinoscope', onclick: () => (pasStudio ? toast(pasStudio, 5000) : va(p.casting)) }, 'Casting'),
      el('button', { class: 'tb ghost', type: 'button', 'aria-disabled': pasStudio ? 'true' : null, title: pasStudio || 'la table des plans', onclick: () => (pasStudio ? toast(pasStudio, 5000) : va(p.depouillement)) }, 'Dépouillement'),
      el('a', { class: 'tb ghost', href: href(p.labo), title: 'le labo des voix' }, 'Voix')),
    el('div', { class: 'fv-row' },
      p.renommer ? el('button', { class: 'tb ghost', type: 'button', onclick: () => renomme(p) }, 'Renommer') : null,
      p.retire ? el('button', { class: 'tb ghost', type: 'button', onclick: () => modifie(p, { supprime: false }, 'remis sur l’accueil') }, 'Restaurer')
        : el('button', { class: 'tb ghost fl-danger', type: 'button', onclick: () => supprime(p) }, p.supprimer === 'supprimer' ? 'Supprimer' : 'Retirer'),
      kebab(() => entrees(p), { cls: 'fl-ib', title: 'plus d’actions' })));
  V.side.replaceChildren(head, el('div', { class: 'fv-scroll' },
    el('h3', { class: 'fv-title ma-fv-t' }, p.nom), el('span', { class: 'lbl' }, p.meta || ''),
    p.retire ? el('p', { class: 'why' }, p.retire_par === 'partage' ? 'retiré de l’accueil depuis MOVIE_ANALYSE (dépôt partagé) — « Restaurer » le remet ici' : 'retiré de l’accueil — « Restaurer » le remet') : null,
    dep, lab, ou), actes);
}

// ── C · le dépôt partagé : ce que le portail en lit, ce que CE navigateur en reçoit, et pourquoi on n'y écrit pas ──
let navigateur = null;
function peintPartage() {
  const pt = S.partage;
  if (!pt) return;
  const box2 = $('#partage-corps');
  const base = pt.url.replace(/\/corrections\/projets\.json$/, '');
  $('#partage-cnt').textContent = pt.etat === 'lu' ? 'lu' : 'injoignable';
  const ligneEtat = (cls, txt, sous) => el('div', { class: 'ma-l' }, el('span', { class: 'pill ' + cls }, el('i'), el('span', {}, txt)), sous ? el('p', { class: 'ma-note' }, sous) : null);
  const e = pt.ecriture || {};
  box2.replaceChildren(
    ligneEtat(pt.etat === 'lu' ? 'on' : 'err', pt.etat === 'lu' ? `lu par le portail · ${fmtDate(pt.lu)}` : 'le portail ne le lit pas',
      pt.etat === 'lu' ? (pt.n ? `${pt.n} projet${pt.n > 1 ? 's' : ''} partagé${pt.n > 1 ? 's' : ''} (projets.json), fusionnés ici` : 'aucun projet créé depuis la home de MOVIE_ANALYSE (projets.json est vide) : ses projets sont nos films')
        : pt.erreur),
    navigateur ? ligneEtat(navigateur.ok ? 'on' : 'err', navigateur.ok ? 'lu par ce navigateur' : 'ce navigateur ne le lit pas', navigateur.texte)
      : ligneEtat('work', 'ce navigateur : on vérifie', ''),
    ligneEtat('err', 'écriture refusée depuis cette adresse', e.pourquoi),
    el('details', { class: 'ma-cmd' }, el('summary', { class: 'lbl' }, 'le détail'),
      el('p', { class: 'ma-note' }, el('b', {}, 'Où : '), e.source), el('p', { class: 'ma-note' }, el('b', {}, 'Ici : '), e.ici, '.'),
      el('p', { class: 'ma-note' }, el('b', {}, 'Pour y écrire aussi : '), e.remede, '.'),
      el('p', { class: 'ma-note' }, el('code', {}, base))));
  if (!navigateur && !peintPartage.encours) { peintPartage.encours = true; verifieNavigateur(base); }
}
async function verifieNavigateur(base) {
  const t = async (u) => {
    const c = new AbortController(), tm = setTimeout(() => c.abort(), 6000);
    try {
      const r = await fetch(u, { cache: 'no-store', signal: c.signal });
      return { ok: r.ok, statut: r.status, json: r.ok ? await r.json().catch(() => null) : null };
    } catch (e) { return { ok: false, erreur: e.name === 'AbortError' ? 'pas de réponse en 6 s' : e.message }; } finally { clearTimeout(tm); }
  };
  const [pj, vd] = await Promise.all([t(base + '/corrections/projets.json'), t(base + '/videos')]);
  const nv = vd.json && Array.isArray(vd.json.fichiers) ? vd.json.fichiers.length : null;
  navigateur = pj.ok && vd.ok
    ? { ok: true, texte: `projets.json et la liste des vidéos lus d’ici (${nv} fichiers sur R2) : les vidéos de nos films se lisent dans ce navigateur` }
    : { ok: false, texte: `projets.json : ${pj.ok ? 'lu' : pj.erreur || 'réponse ' + pj.statut} · vidéos R2 : ${vd.ok ? 'lues' : vd.erreur || 'réponse ' + vd.statut} — les Studios de nos films liront leur vidéo à côté de la page si elle y est, sinon ils le diront` };
  peintPartage();
}

// ── D · la diarisation ──────────────────────────────────────
async function chargeDiar() {
  const b = $('#diar-corps');
  let d;
  try { d = await api('analyse/diarisation'); } catch (e) { b.replaceChildren(el('p', { class: 'warn' }, e.message)); return; }
  const ouvrir = el('div', { class: 'row' }, el('a', { class: 'tb ghost sm', href: './diarisation/' }, 'Ouvrir le labo'),
    el('a', { class: 'tb ghost sm', href: './diarisation/?projet=getaround' }, 'La démo Getaround'));
  $('#diar-cnt').textContent = d.up ? (d.pret ? 'prête' : (d.phase || 'répond')) : 'ne répond pas';
  if (d.up) {
    b.replaceChildren(el('div', { class: 'ma-l' }, el('span', { class: 'pill ' + (d.pret ? 'on' : 'work') }, el('i'), el('span', {}, `${d.machine || 'dgx1'} · ${d.pret ? 'prêt' : d.phase}`))),
      el('dl', { class: 'kv' },
        el('dt', {}, 'modèle'), el('dd', {}, d.modele || '—'),
        el('dt', {}, 'voix'), el('dd', {}, nb(d.voix)),
        el('dt', {}, 'transcription'), el('dd', {}, d.transcription ? 'possible' : 'non'),
        el('dt', {}, 'file'), el('dd', {}, d.file ? `${d.file.en_cours ? 'un calcul' : 'libre'} · ${d.file.attente || 0} en attente` : '—')),
      el('p', { class: 'ma-note' }, 'Nemotron 3 : qui parle, quand, jusqu’à huit voix. Le labo passe par le relais du portail — pas besoin de Tailscale ici.'), ouvrir);
  } else {
    b.replaceChildren(el('div', { class: 'ma-l' }, el('span', { class: 'pill err' }, el('i'), el('span', {}, 'le service ne répond pas'))),
      el('p', { class: 'ma-note' }, 'Le portail n’atteint pas ', el('code', {}, d.url), ` (${d.why}). Le labo s’ouvre quand même : la démo Getaround, un résultat gardé, les exports.`),
      el('details', { class: 'ma-cmd' }, el('summary', { class: 'lbl' }, 'le remettre en route'), el('ul', { class: 'ma-list' }, ...(d.remedes || []).map((r) => el('li', {}, r)))), ouvrir);
  }
}

// ── E · la chaîne ───────────────────────────────────────────
async function chargeChaine() {
  const b = $('#chaine-corps');
  try { S.chaine = await api('analyse/chaine'); } catch (e) { b.replaceChildren(el('p', { class: 'warn' }, e.message)); majLancer(); return; }
  const c = S.chaine;
  $('#nv-machine').textContent = c.machine;
  $('#chaine-cnt').textContent = c.pret ? `prête · ${c.machine}` : 'incomplète';
  const rb = c.reelbench || {};
  const retard = rb.compare && (rb.differe.length || rb.absents.length)
    ? `${rb.chemin} est en retard sur cette copie : ${rb.differe.length} fichier(s) diffèrent (${rb.differe.join(', ')}), ${rb.absents.length} manquent`
    : rb.compare ? `${rb.chemin} : identique à cette copie` : '';
  b.replaceChildren(
    el('div', { class: 'ma-l' }, el('span', { class: 'pill ' + (c.pret ? 'on' : 'err') }, el('i'), el('span', {}, `${c.machine} · ${c.pret ? 'prête' : 'incomplète'}`))),
    el('ul', { class: 'ma-outils' }, ...c.outils.map((o) => el('li', { class: o.ok ? 'ok' : o.requis ? 'err' : 'opt', title: o.chemin + (o.pour ? ' — ' + o.pour : '') },
      el('i'), el('span', {}, o.nom), el('span', { class: 'lbl' }, o.ok ? 'là' : o.requis ? 'manque' : 'absent')))),
    el('details', { class: 'ma-cmd' }, el('summary', { class: 'lbl' }, 'le détail'),
      el('dl', { class: 'kv ma-kv' },
        el('dt', {}, 'voie'), el('dd', {}, `analyse, une à la fois${c.scope ? ' · mémoire plafonnée (systemd-run)' : ' · nice seul'}`),
        el('dt', {}, 'chaîne'), el('dd', {}, c.skill + (c.copie_du_depot ? ' (la copie du dépôt MOVIE_ANALYSE)' : '')),
        el('dt', {}, 'travail'), el('dd', {}, c.runs + '/<nom>/'),
        retard ? el('dt', {}, 'reelbench') : null, retard ? el('dd', {}, retard) : null),
      el('p', { class: 'ma-note' }, 'La chaîne tourne en local, rien ne part chez un fournisseur. Chaque étape reprend ce qui existe déjà : relancer une analyse arrêtée repart de là où elle en était.')));
  const langs = $('#nv-langue');
  langs.replaceChildren(...Object.entries(c.langues || { fr: 'français' }).map(([k, v]) =>
    el('button', { class: 'opt' + (k === S.langue ? ' on' : ''), type: 'button', onclick: () => { S.langue = k; $$('.opt', langs).forEach((b2) => b2.classList.toggle('on', b2.textContent.startsWith(v))); } }, v)));
  majLancer();
}

// ── Nouvelle analyse (et le dépouillement d'un projet : le même lancement, sous son nom) ──
const slug = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
const ytId = (u) => { const m = /(?:[?&]v=|youtu\.be\/|shorts\/|live\/)([A-Za-z0-9_-]{6,20})/.exec(u || ''); return m ? m[1] : ''; };
const estYt = (u) => /^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/|live\/)|youtu\.be\/)/i.test(u || '');

function nomCourant() {
  if (S.projetLance) return S.projetLance.id;
  if (S.source === 'yt') return ytId($('#nv-url').value.trim());
  return $('#nv-nom').value.trim();
}
let nomT;
function verifieNom() {
  clearTimeout(nomT);
  const nom = nomCourant();
  if (!nom || nom === S.nomVu) return majLancer();
  nomT = setTimeout(async () => {
    try { S.nomLibre = await api('analyse/nom/' + encodeURIComponent(nom)); S.nomVu = nom; } catch (e) { S.nomLibre = { nom, erreur: e.message }; S.nomVu = nom; }
    majLancer();
  }, 250);
}
function pourquoi() {
  if (!S.chaine) return 'lecture de la chaîne';
  if (!S.chaine.pret) return 'la chaîne n’est pas prête : ' + S.chaine.outils.filter((o) => o.requis && !o.ok).map((o) => o.nom).join(', ') + ' — voir « La chaîne », à gauche';
  if (S.source === 'bib' && !S.video) return 'choisir une vidéo de la bibliothèque, ou la déposer';
  const url = $('#nv-url').value.trim();
  if (S.source === 'yt') {
    if (!url) return 'coller une adresse YouTube';
    if (!estYt(url) || !ytId(url)) return 'une adresse YouTube : youtube.com/watch?v=…, youtu.be/…';
    if (!S.chaine.outils.find((o) => o.nom === 'yt-dlp')?.ok) return 'yt-dlp manque sur ' + S.chaine.machine;
  }
  if (S.source === 'bib' && !$('#nv-titre').value.trim()) return 'il faut un titre';
  const nom = nomCourant();
  if (S.source === 'bib' && !/^[a-z0-9][a-z0-9-]{0,47}$/.test(nom)) return 'le dossier : minuscules, chiffres et tirets';
  const L = S.nomLibre;
  if (!L || L.nom !== nom) return 'vérification du dossier';
  if (L.erreur) return L.erreur;
  if (!L.libre && !(L.reprendre && $('#nv-reprendre').checked)) {
    return L.reprendre ? `runs/${nom}/ existe (lancée d’ici) : cocher « reprendre », ou changer le titre`
      : `runs/${nom}/ existe déjà et n’a pas été lancé d’ici : on n’y touche pas — changer le titre`;
  }
  return '';
}
function majLancer() {
  const L = S.nomLibre;
  $('#nv-rep-champ').hidden = !(L && L.nom === nomCourant() && !L.libre && L.reprendre);
  const why = pourquoi();
  $('#nv-why').textContent = why;
  $('#nv-lancer').disabled = !!why;
  const top = S.chaine && !S.chaine.pret ? 'la chaîne n’est pas prête : voir « La chaîne »' : '';
  $('#why-nouvelle').hidden = !top; $('#why-nouvelle').textContent = top;
}
function ouvreNouvelle(p = null) {
  S.projetLance = p && p.sorte === 'projet' ? p : null;
  $('#nv-t').textContent = S.projetLance ? `Dépouiller « ${S.projetLance.nom} »` : 'Nouvelle analyse';
  const nomIn = $('#nv-nom');
  nomIn.readOnly = !!S.projetLance;
  if (S.projetLance) { $('#nv-titre').value = S.projetLance.nom; nomIn.value = S.projetLance.id; nomIn.dataset.touche = '1'; }
  else if (nomIn.dataset.projet) { nomIn.value = ''; nomIn.dataset.touche = ''; $('#nv-titre').value = ''; }
  nomIn.dataset.projet = S.projetLance ? '1' : '';
  $('#nv-nom-champ').hidden = S.source !== 'bib' && !S.projetLance;
  S.nomVu = ''; verifieNom();
  $('#nv').hidden = false;
  majLancer();
  (S.source === 'yt' ? $('#nv-url') : $('#nv-titre')).focus();
}
function fermeNouvelle() { $('#nv').hidden = true; }
$('#nouvelle').onclick = () => ouvreNouvelle(null);
$$('[data-ferme]').forEach((b) => (b.onclick = fermeNouvelle));
$('#nv').addEventListener('click', (e) => { if (e.target.id === 'nv') fermeNouvelle(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#nv').hidden && !$('.picker')) { e.stopPropagation(); fermeNouvelle(); } }, true);
$$('#nv-src .tb').forEach((b) => (b.onclick = () => {
  S.source = b.dataset.src;
  $$('#nv-src .tb').forEach((x) => x.classList.toggle('on', x === b));
  $('#nv-bib').hidden = S.source !== 'bib';
  $('#nv-yt').hidden = S.source !== 'yt';
  $('#nv-nom-champ').hidden = S.source !== 'bib' && !S.projetLance;
  S.nomVu = ''; verifieNom(); majLancer();
}));
function prendVideo(it) {
  if (!it) return;
  S.video = it;
  $('#nv-video').replaceChildren(thumb(it, { onclick: () => $('#nv-choisir').click() }));
  $('#nv-choisir').textContent = 'Changer de vidéo';
  if (!$('#nv-titre').value.trim()) $('#nv-titre').value = it.title || '';
  if (!$('#nv-nom').dataset.touche) $('#nv-nom').value = slug($('#nv-titre').value);
  verifieNom(); majLancer();
}
$('#nv-choisir').onclick = async () => { const [it] = await pick({ kinds: ['video'], title: 'Une vidéo à dépouiller' }); prendVideo(it); };
// la règle de Cal (29/09) : tout bloc qui attend un asset accepte un dépôt (commun/shell.js, dropZone)
dropZone($('#nv-bib'), { kinds: ['video'], multiple: false, via: 'analyse', onitems: ([it]) => prendVideo(it) });
$('#nv-titre').oninput = () => { if (S.source === 'bib' && !$('#nv-nom').dataset.touche) $('#nv-nom').value = slug($('#nv-titre').value); verifieNom(); majLancer(); };
$('#nv-nom').oninput = () => { $('#nv-nom').dataset.touche = $('#nv-nom').value ? '1' : ''; verifieNom(); majLancer(); };
$('#nv-url').oninput = () => { verifieNom(); majLancer(); };
$('#nv-reprendre').onchange = majLancer;
$('#nv-sceneflow').onclick = () => { S.sceneflow = !S.sceneflow; $('#nv-sceneflow').classList.toggle('on', S.sceneflow); $('#nv-sceneflow').setAttribute('aria-pressed', String(S.sceneflow)); };
$('#nv-lancer').onclick = async () => {
  if (pourquoi()) return;
  const c = { titre: $('#nv-titre').value.trim(), langue: S.langue, sceneflow: S.sceneflow, reprendre: $('#nv-reprendre').checked };
  if (S.projetLance) c.projet = S.projetLance.id;
  if (S.source === 'bib') { c.item = S.video.id; if (!S.projetLance) c.nom = nomCourant(); } else c.url = $('#nv-url').value.trim();
  $('#nv-lancer').disabled = true;
  try {
    const j = await api('analyse/run', { method: 'POST', body: c });
    fermeNouvelle();
    toast(`« ${j.params.titre || j.params.nom} » en file : elle démarre quand ${S.chaine?.machine || 'la machine'} est libre`);
    jobs.poll(true);
    S.nomVu = ''; S.nomLibre = null;
    await charge();
  } catch (e) { $('#nv-why').textContent = e.message; $('#nv-lancer').disabled = false; }
};

charge();
chargeDiar();
chargeChaine();
setInterval(() => { if (!document.hidden) chargeDiar(); }, 30000);
