// SHOWRUNNER TOOLS — la porte : taper son pseudo et entrer ; un pseudo
// neuf attend que Cal l'accepte (la page s'ouvre seule) ; et le menu de son
// compte (se déconnecter : on revient en retapant son pseudo).
//
// shell.js la charge quand il le faut (mountHeader, ou une réponse 401) :
// une page d'outil n'a rien à faire pour être gardée. Le serveur juge
// (core/auth.py) ; cette page ne fait que demander et attendre.

import { api, el, toast, href, TOOLS, releve } from './shell.js';

let box = null;
let pollT = null;

function styles() {
  if (document.querySelector('link[data-porte]')) return Promise.resolve();
  return new Promise((ok) => {
    const l = el('link', { rel: 'stylesheet', href: href('commun/porte.css'), 'data-porte': '' });
    l.onload = ok; l.onerror = ok;
    document.head.append(l);
  });
}

const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');

// ── la porte ────────────────────────────────────────────────
export async function door(me) {
  await styles();
  document.documentElement.classList.remove('sr-wait');
  if (!me) { try { me = await api('auth/me'); } catch { me = { state: 'anonymous' }; } }
  // La porte « code » (le Worker, à l'adresse fixe) : les pages sont servies sans lui, la page d'invitation par le
  // portail. Sans code d'invitation, on y va d'abord ; le code donné, elle ramène ici (next).
  if (me.porte === 'code' && !me.invitation && me.state === 'anonymous') {
    location.replace(`/invitation/?next=${encodeURIComponent(location.pathname + location.search)}`);
    return;
  }
  if (!box) {
    box = el('div', { class: 'porte', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'la porte du portail' });
    document.body.append(box);
    document.body.classList.add('porte-on');
  }
  paint(me);
}

function frame(...body) {
  return el('div', { class: 'porte-in' },
    el('div', { class: 'porte-top' },
      el('span', { class: 'logo' }, el('span', { class: 'sq' }, el('i')),
        el('span', {}, el('b', {}, 'Nirvalab'))),
      el('span', { class: 'sp' }),
      el('span', { class: 'lbl' }, 'les outils de Cal · sur ses DGX')),
    el('section', { class: 'hero porte-card' },
      el('span', { class: 'ref' }, '00_PORTE'),
      // Norelli : lettres et espaces seulement — le titre de l'accueil
      el('h1', {}, 'Tous nos outils une seule porte'),
      ...body));
}

function paint(me) {
  pollT?.stop();
  const st = me.state;
  if (st === 'pending') return paintWait(me);
  if (st === 'refused') return paintRefused(me);
  if (st === 'suspended') return paintSuspended(me);
  if (st === 'offnet') return paintAsk(me, me.message || '');
  if (st === 'active') { location.reload(); return; }
  paintAsk(me);
}

function paintAsk(me, err = '') {
  const name = el('input', { class: 'fld', id: 'porte-nom', placeholder: 'ton pseudo', maxlength: 24, autocomplete: 'username',
    'aria-label': 'ton pseudo', spellcheck: 'false', autocapitalize: 'none' });
  const warn = el('p', { class: 'warn', role: 'alert', hidden: !err }, err);
  const go = el('button', { class: 'tb go', type: 'submit' }, 'Entrer');
  const form = el('form', { class: 'porte-form', onsubmit: async (e) => {
    e.preventDefault();
    go.disabled = true;
    try {
      const d = await api('auth/enter', { method: 'POST', body: { name: name.value } });
      if (d.state === 'active') { location.reload(); return; }
      paint({ state: d.state, user: d.user, since: d.since });
    } catch (x) { warn.hidden = false; warn.textContent = x.message; go.disabled = false; name.focus(); }
  } }, el('div', { class: 'row' }, name, go));
  box.replaceChildren(frame(
    el('p', {}, 'Le portail de Cal : images, vidéos, personnages, sur ses deux DGX quand elles sont allumées. ',
      me.sur_liste
        ? 'Tape le pseudo que Cal t’a donné, et entre.'
        : 'Tape ton pseudo : si Cal l’a déjà accepté, tu entres ; sinon, il reçoit ta demande et t’ouvre la porte.'),
    form, warn));
  name.focus();
}

function paintWait(me) {
  const nm = me.user?.name || '';
  // un invité (D5, 09/10) : un admin de Team l'a mis dans sa Team, Cal valide ; « annuler » ne ferait que fermer
  // ce navigateur (son compte n'est pas à lui de défaire : core/auth.py, cancel_request)
  const inv = me.invited;
  box.replaceChildren(frame(
    el('span', { class: 'porte-state' }, el('i'), inv ? 'invitation · en attente de Cal' : 'demande envoyée · en attente de Cal'),
    inv ? el('p', {}, `Bonjour ${nm}. ${inv.by_name ? `${inv.by_name} t’a invité ; ` : ''}ton compte attend la validation de Cal. `,
      'Cette page s’ouvrira toute seule dès qu’il l’aura validé, tu peux la laisser ouverte. Ensuite, il suffira de retaper ton pseudo, d’où tu veux.')
      : el('p', {}, `Bonjour ${nm}. Cal doit accepter ce pseudo ; cette page s’ouvrira toute seule, tu peux la laisser ouverte. `,
        'Ensuite, il suffira de retaper ton pseudo, d’où tu veux.'),
    el('div', { class: 'porte-pulse', 'aria-hidden': 'true' }, el('i')),
    el('div', { class: 'row' }, el('span', { class: 'lbl' }, inv?.at ? `invité à ${hhmm(inv.at)}` : me.since ? `demandé à ${hhmm(me.since)}` : ''),
      el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm', onclick: async () => {
        try { await api('auth/cancel', { method: 'POST' }); } catch { /* */ }
        paintAsk({ state: 'anonymous' });
      } }, inv ? 'Taper un autre pseudo' : 'Annuler la demande'))));
  // relu toutes les 4 s, onglet visible seulement ; de retour sur l'onglet, tout de suite (shell.js, releve)
  pollT = releve(async () => {
    try {
      const m = await api('auth/me');
      if (m.state !== 'pending') paint(m);
    } catch { /* le portail redémarre : on réessaie */ }
  }, 4000);
}

function paintRefused(me) {
  box.replaceChildren(frame(
    el('span', { class: 'porte-state off' }, el('i'), 'demande refusée'),
    el('p', {}, `Cal n’a pas accepté ${me.name ? `le pseudo ${me.name}` : 'cette demande'}.`),
    el('div', { class: 'row' }, el('button', { class: 'tb ghost', onclick: async () => {
      try { await api('auth/cancel', { method: 'POST' }); } catch { /* */ }
      paintAsk({ state: 'anonymous' });
    } }, 'Taper un autre pseudo'))));
}

function paintSuspended(me) {
  box.replaceChildren(frame(
    el('span', { class: 'porte-state off' }, el('i'), 'accès suspendu'),
    el('p', {}, `${me.user?.name || 'Ce compte'} : Cal a suspendu cet accès. Vois avec lui.`),
    el('div', { class: 'row' }, el('button', { class: 'tb ghost', onclick: async () => {
      try { await api('auth/logout', { method: 'POST' }); } catch { /* */ }
      paintAsk({ state: 'anonymous' });
    } }, 'Taper un autre pseudo'))));
}

// ── réservé au Studio ───────────────────────────────────────
// Un compte Apps (core/auth.py : `access`) devant un outil Studio : ce qui est
// fermé, pourquoi, et la seule action qui le débloque, « Demander le Studio »
// (règle 7). La page d'un outil Studio la pose d'office (mountHeader, et la page
// que le portail sert à la place : /api/auth/studio-ferme) ; un outil fermé de
// l'en-tête l'ouvre au clic (`closable`). Tant que la demande attend, la page
// relit /api/auth/me : Cal ouvre le Studio dans Admin, elle s'ouvre seule.
let sBox = null;
let sPoll = null;
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '');

export async function studioDoor(me, tool, { closable = false } = {}) {
  await styles();
  document.documentElement.classList.remove('sr-wait');
  if (!sBox) {
    sBox = el('div', { class: 'porte studio-door', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'réservé au Studio' });
    document.body.append(sBox);
  }
  document.body.classList.add('porte-on');
  sBox.hidden = false;
  paintStudio(me, tool, closable);
  sPoll?.stop();
  sPoll = releve(async () => {   // onglet visible seulement, tout de suite à son retour (shell.js, releve)
    try {
      const m = await api('auth/me');
      if (m.user && m.user.access === 'studio') { sPoll?.stop(); location.reload(); }
    } catch { /* le portail redémarre : on réessaie */ }
  }, 5000);
}

function closeStudio() {
  sPoll?.stop();
  if (sBox) sBox.hidden = true;
  if (!document.querySelector('.porte:not([hidden]):not(.studio-door)')) document.body.classList.remove('porte-on');
}

function paintStudio(me, tool, closable) {
  const asked = me.user && me.user.studio_asked;
  const studio = TOOLS.filter((x) => x.tier === 'studio' && !x.open).map((x) => x.name.replace(/­/g, ''));
  const apps = TOOLS.filter((x) => x.tier === 'app' || x.open).map((x) => x.name.replace(/­/g, ''));
  const state = el('div', { class: 'studio-ask' });
  const paintAsk = (when) => {
    if (when) {
      state.replaceChildren(
        el('span', { class: 'porte-state' }, el('i'), `demandé le ${fmtDay(when)} · en attente de Cal`),
        el('p', {}, 'Cal ouvre le Studio depuis sa page d’admin ; cette page s’ouvrira toute seule, tu peux la laisser ouverte.'));
      return;
    }
    const go = el('button', { class: 'tb go', type: 'button', onclick: async () => {
      go.disabled = true;
      try {
        const r = await api('auth/studio', { method: 'POST', body: {} });
        if (r.ok) { location.reload(); return; }
        if (me.user) me.user.studio_asked = r.asked;
        paintAsk(r.asked);
        toast('demande envoyée à Cal');
      } catch (e) { go.disabled = false; toast(e.message); }
    } }, 'Demander le Studio');
    state.replaceChildren(el('div', { class: 'row' }, go));
  };
  paintAsk(asked);
  sBox.replaceChildren(el('div', { class: 'porte-in' },
    el('div', { class: 'porte-top' },
      el('span', { class: 'logo' }, el('span', { class: 'sq' }, el('i')), el('span', {}, el('b', {}, 'Nirvalab'))),
      el('span', { class: 'sp' }),
      el('span', { class: 'lbl' }, `${tool.k || 'SR'} · réservé au Studio`)),
    el('section', { class: 'hero porte-card' },
      el('span', { class: 'ref' }, '00_STUDIO'),
      el('h2', { class: 'studio-t' }, `${tool.name.replace(/­/g, '')} fait partie du Studio`),
      el('p', {}, 'Le Studio, ce sont les outils liés entre eux par les éléments : ', el('b', {}, studio.join(' · ')), '. ',
        `Ton compte${me.user ? ` (${me.user.name})` : ''} ouvre les Apps et la bibliothèque : `, el('b', {}, apps.join(' · ')), '.'),
      state,
      el('div', { class: 'row' },
        el('a', { class: 'tb ghost sm', href: href('') }, 'Retour à l’accueil'),
        el('a', { class: 'tb ghost sm', href: href('asset/') }, 'Ouvrir Asset'),
        el('span', { class: 'sp' }),
        closable ? el('button', { class: 'tb ghost sm', type: 'button', onclick: closeStudio }, 'Fermer') : null))));
  if (closable) {
    const esc = (e) => { if (e.key === 'Escape') { closeStudio(); removeEventListener('keydown', esc); } };
    addEventListener('keydown', esc);
  }
}

// ── le menu de son compte ───────────────────────────────────
let menu = null;
let menuFrom = null;
function closeMenu() {
  if (!menu) return;
  menu.remove(); menu = null;
  document.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('keydown', menuKey, true);
  menuFrom?.setAttribute('aria-expanded', 'false');
}
function outside(e) { if (menu && !menu.contains(e.target) && !e.target.closest('#sr-me')) closeMenu(); }
function menuKey(e) {
  if (!menu) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const b = menuFrom; closeMenu(); b?.focus(); return; }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...menu.querySelectorAll('[role="menuitem"]')].filter((n) => n.offsetParent !== null);
  if (!items.length) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement);
  items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
}
/** Fermer le menu du compte (une de ses lignes a servi). */
export const fermerCompte = () => closeMenu();

// Derrière la vraie porte (porte « access », /api/auth/me le dit), le portail n'a pas de session à lui : c'est
// Cloudflare Access qui tient la connexion. Se déconnecter, c'est donc fermer la session Access : l'adresse
// <domaine de l'application>/cdn-cgi/access/logout retire le cookie de l'application et révoque la session sur
// toutes les applications de l'équipe (https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/).
// Chemin absolu : Access le sert à la racine du nom d'hôte, jamais sous une page d'outil.
const ACCESS_LOGOUT = '/cdn-cgi/access/logout';

// Le menu du nom, en haut à droite (Cal, 30/09) : `lignes` (commun/shell.js, lignesDuNom) — la file de
// rendu, les Teams et Workspaces, l'Admin, les machines — puis ce qui est au compte : le pseudo, comment
// revenir, se déconnecter (rien de cela sans porte : le portail n'a alors pas de compte à quitter).
export async function account(me, anchor, lignes = []) {
  await styles();
  if (menu) return closeMenu();
  const adm = me.user.role === 'admin';
  const access = me.porte === 'access';
  const door = !!me.auth;
  const rows = (lignes || []).filter(Boolean);
  menu = el('div', { class: 'acct', role: 'menu', 'aria-label': 'mon compte' },
    el('div', { class: 'acct-head' }, el('b', {}, me.user.name), el('span', { class: 'lbl' }, adm ? 'admin' : me.user.role === 'invite' ? 'invité·e' : 'ami·e')),
    rows.length ? el('div', { class: 'sr-ml', role: 'group' }, ...rows) : null,
    !door || access ? null : el('p', { class: 'acct-note' }, 'Pseudo : ', el('b', { class: 'acct-code' }, me.user.pseudo || me.user.name)),
    !door ? null : el('p', { class: 'acct-note' }, access
      ? 'Pour revenir : ton e-mail, puis le code que Cloudflare t’envoie.'
      : adm
        ? (me.porte ? 'Pour revenir par cette adresse : le code admin, puis ce pseudo.'
          : 'Pour revenir : retaper ce pseudo, depuis le réseau de Cal (la maison, le câble, Tailscale).')
        : 'Pour revenir, d’ici ou d’ailleurs : retaper ce pseudo.'),
    !door ? null : el('div', { class: 'row' },
      el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm', role: 'menuitem', onclick: async () => {
        if (access) { location.href = ACCESS_LOGOUT; return; }
        try { await api('auth/logout', { method: 'POST' }); } catch (e) { toast(e.message); }
        location.href = href('');
      } }, 'Se déconnecter')));
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  document.body.append(menu);
  menuFrom = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', menuKey, true);
  menu.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
}

export function uaShort(ua = '') {
  const b = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'navigateur';
  const o = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return o ? `${b} · ${o}` : b;
}
