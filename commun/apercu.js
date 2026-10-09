// L'aperçu au survol du nom, en haut à droite (Cal, 09/10/2026 : « je veux, au survol de mon nom en haut à
// droite, un aperçu rapide de l'état des DGX en termes de mémoire et GPU, et aussi un aperçu des travaux en
// cours de calcul avec leur avancement. Un truc super minimal. »).
//
// Une bulle de valeurs, sans phrase : par machine, la mémoire utilisée / totale (une barre fine) et l'activité
// du GPU — « non mesuré » quand le portail ne la connaît pas (server/tools/machines_apercu.py dit ce qui est
// mesuré) ; les travaux en cours (titre, machine, avancement : pourcentage, sinon l'étape), ceux en file en un
// chiffre. Une note, pas une action : ni orange ni bouton.
//
// Ce qu'elle lit :
// - les travaux : la liste que la page a déjà (le relevé de la file, commun/shell.js : un meneur par navigateur,
//   rien onglet caché) — aucune requête de plus ; l'en-tête la lui passe à chaque liste reçue (liste()) ;
// - les machines : GET /api/machines/apercu, UNE fois par ouverture (une réponse de moins de FRAIS ms resservie),
//   jamais tant qu'elle est fermée (docs/etudes/cloudflare.md : sur l'adresse publique, chaque requête compte) ;
//   refusée (401, 403), plus demandée sur cette page : le portail juge.
// Qui voit quoi : Cal, toute la file ; les autres, leurs travaux (`mine`) ; l'invité d'une planche, ni les
// machines (le portail les lui ferme) ni la file des autres.
//
// Quand : au survol à la souris ou au stylet (après DELAI ms : un pointeur qui passe ne l'ouvre pas), au focus
// clavier (:focus-visible). Elle reste tant que le pointeur est sur le nom ou sur elle (WCAG 2.1, 1.4.13 : on
// peut la survoler) ; Échap la ferme ; un clic sur le nom ouvre le menu du compte, qui prend sa place. Au doigt :
// rien — toucher le nom ouvre son menu, qui porte déjà la file de rendu et l'état des machines ; un appui long
// ne se devine pas et le système le prend (la sélection, la loupe d'iOS).
import { api, el } from './shell.js';

const DELAI = 200;     // le pointeur s'arrête sur le nom
const GRACE = 180;     // le temps d'aller du nom à la bulle (6 px plus bas)
const FRAIS = 5000;    // une réponse plus jeune resservie (le portail garde la sienne autant : machines_apercu.APERCU_S)
const MAX_RUN = 5;     // les travaux en cours montrés ; au-delà, « +n »

let B = null;          // le bouton du nom (#sr-me)
let C = null;          // ce que sait l'en-tête : { liste() → les travaux, moi() → /api/auth/me }
let bulle = null;
let tOuvre = 0, tFerme = 0;
let ecartee = false;   // un clic, Échap pendant ce survol : rien jusqu'à ce que le pointeur reparte
let mach = null;       // { t, v } : la dernière réponse (v null : en échec, `err`)
let refus = false;
let vol = false;

const souris = (ev) => ev.pointerType === 'mouse' || ev.pointerType === 'pen';
const menuOuvert = () => B?.getAttribute('aria-expanded') === 'true';

/** Branche l'aperçu sur le nom ; `ev`, l'approche qui a chargé ce module (commun/shell.js, mountHeader). */
export function brancher(btn, ctx, ev = null) {
  C = ctx;
  if (B !== btn) {
    B = btn;
    btn.addEventListener('pointerenter', (e) => { if (souris(e)) approcher(); });
    btn.addEventListener('pointerleave', (e) => { if (souris(e)) { ecartee = false; quitter(); } });
    btn.addEventListener('pointerdown', () => { ecartee = true; fermer(); });
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { ecartee = true; fermer(); } });
    btn.addEventListener('focus', () => { if (btn.matches(':focus-visible')) approcher(); });
    btn.addEventListener('blur', () => { ecartee = false; quitter(0); });
  }
  if (ev && ((ev.type === 'pointerenter' && souris(ev) && btn.matches(':hover')) || (ev.type === 'focus' && btn.matches(':focus-visible')))) approcher();
}

/** Une liste de la file vient d'arriver (le relevé de l'en-tête) : la bulle ouverte se repeint. */
export function liste() { if (bulle) peindre(); }

function approcher() {
  clearTimeout(tFerme);
  if (bulle || ecartee || menuOuvert()) return;
  clearTimeout(tOuvre);
  tOuvre = setTimeout(ouvrir, DELAI);
}
function quitter(d = GRACE) {
  clearTimeout(tOuvre);
  clearTimeout(tFerme);
  tFerme = setTimeout(fermer, d);
}
function echap(e) {
  if (e.key !== 'Escape' || !bulle) return;
  ecartee = true;
  fermer();
}
function ouvrir() {
  if (bulle || !B?.isConnected || B.hidden || menuOuvert()) return;
  bulle = el('div', { class: 'sr-apercu', id: 'sr-apercu', role: 'tooltip',
    onpointerenter: () => clearTimeout(tFerme), onpointerleave: (e) => { if (souris(e)) quitter(); } });
  document.body.append(bulle);
  B.setAttribute('aria-describedby', 'sr-apercu');
  document.addEventListener('keydown', echap, true);
  addEventListener('resize', placer);
  peindre();
  lireMachines();
}
function fermer() {
  clearTimeout(tOuvre);
  clearTimeout(tFerme);
  if (!bulle) return;
  bulle.remove();
  bulle = null;
  B?.removeAttribute('aria-describedby');
  document.removeEventListener('keydown', echap, true);
  removeEventListener('resize', placer);
}
// sous le nom, son bord droit sur le sien (le menu du compte se pose de même : commun/porte.js, account)
function placer() {
  if (!bulle || !B) return;
  const r = B.getBoundingClientRect();
  bulle.style.top = `${Math.round(r.bottom + 6)}px`;
  bulle.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`;
}

// ── les machines : une lecture par ouverture ────────────────
function lireMachines() {
  const me = C?.moi?.();
  if (refus || vol || me?.user?.role === 'invite') return;
  if (mach && Date.now() - mach.t < FRAIS) return;
  vol = true;
  // sans Workspace : la route n'en dépend pas, et un 403 n'y dit rien de l'onglet (api() relirait la session)
  api('machines/apercu', { espace: null })
    .then((v) => { mach = { t: Date.now(), v }; })
    .catch((e) => {
      if (e.status === 401 || e.status === 403) refus = true;
      mach = { t: Date.now(), v: null, err: e.message };
    })
    .finally(() => { vol = false; peindre(); });
}

// ── la bulle ────────────────────────────────────────────────
const go = (x) => (x >= 10 ? String(Math.round(x)) : String(Math.round(x * 10) / 10).replace('.', ','));
const barre = (part, cls = '') => el('i', { class: `ap-bar${cls ? ' ' + cls : ''}`, 'aria-hidden': 'true' },
  el('i', { style: { width: `${Math.round(Math.max(0, Math.min(1, part)) * 100)}%` } }));
const MEM_SRC = { meminfo: 'mémoire : /proc/meminfo', comfyui: 'mémoire : ComfyUI (/system_stats), bornée par son service' };

function peindre() {
  if (!bulle) return;
  const me = C?.moi?.() || null;
  const admin = me?.user?.role === 'admin';
  const invite = me?.user?.role === 'invite';
  const tous = (C?.liste?.() || []).filter((j) => admin || j.mine);
  const run = tous.filter((j) => j.state === 'running').sort((a, b) => String(a.started || '').localeCompare(String(b.started || '')));
  const file = tous.filter((j) => j.state === 'queued').length;
  bulle.replaceChildren(...[invite || refus ? null : blocMachines(admin), blocTravaux(run, file)].filter(Boolean));
  placer();
}

function blocMachines(admin) {
  if (!mach) return el('div', { class: 'ap-m' }, el('b', {}, 'machines'), el('span', { class: 'v ap-attente' }, '…'));
  if (!mach.v) return el('div', { class: 'ap-m', title: mach.err || '' }, el('b', {}, 'machines'), el('span', { class: 'v' }, '—'));
  const ms = mach.v.machines || [];
  if (!ms.length) return null;   // aucune instance de calcul déclarée (un portail d'essai)
  return el('div', { class: 'ap-m' }, ms.map((m) => {
    const mem = m.total_gb ? m.used_gb / m.total_gb : null;
    const why = [MEM_SRC[m.mem_src] || '', m.gpu === null && admin && m.gpu_why ? `GPU : ${m.gpu_why}` : ''].filter(Boolean).join('\n');
    return el('div', { class: `ap-r${m.up ? '' : ' off'}`, title: why || null },
      el('b', {}, m.name),
      barre(mem ?? 0),
      el('span', { class: 'v' }, mem === null ? '—' : `${go(m.used_gb)} / ${go(m.total_gb)} Go`),
      el('span', { class: 'g' }, 'GPU ', el('span', { class: m.gpu === null ? 'nm' : '' }, m.gpu === null ? 'non mesuré' : `${m.gpu} %`)));
  }));
}

function blocTravaux(run, file) {
  const rows = run.slice(0, MAX_RUN).map((j) => {
    const p = typeof j.progress === 'number' && j.progress > 0 ? Math.min(1, j.progress) : null;
    return el('div', { class: 'ap-j', title: [j.title, j.message].filter(Boolean).join(' · ') || null },
      el('span', { class: 'n' }, j.title || j.kind || '—'),
      el('span', { class: 'm' }, j.machine || ''),
      p !== null ? el('span', { class: 'p' }, `${Math.round(p * 100)} %`) : el('span', { class: 'p etape' }, j.message || '…'),
      barre(p ?? 1, p === null ? 'flou' : ''));
  });
  return el('div', { class: 'ap-t' }, rows,
    run.length > MAX_RUN ? el('div', { class: 'ap-plus' }, `+${run.length - MAX_RUN}`) : null,
    el('div', { class: 'ap-n' }, el('span', {}, 'en cours'), el('b', {}, String(run.length)),
      el('span', {}, 'en file'), el('b', {}, String(file))));
}
