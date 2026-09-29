// SHOWRUNNER TOOLS — la porte : donner son nom, attendre que Cal accepte,
// entrer par un code (celui de Cal, ou un code de liaison) ; et le menu de
// son compte (appareils, relier un appareil, se déconnecter).
//
// shell.js la charge quand il le faut (mountHeader, ou une réponse 401) :
// une page d'outil n'a rien à faire pour être gardée. Le serveur juge
// (core/auth.py) ; cette page ne fait que demander et attendre.

import { api, el, toast, href } from './shell.js';

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
        el('span', {}, el('b', {}, 'Showrunner'), el('small', {}, 'tools'))),
      el('span', { class: 'sp' }),
      el('span', { class: 'lbl' }, 'les outils de Cal · sur ses DGX')),
    el('section', { class: 'hero porte-card' },
      el('span', { class: 'ref' }, '00_PORTE'),
      // Norelli : lettres et espaces seulement — le titre de l'accueil
      el('h1', {}, 'Tous nos outils une seule porte'),
      ...body));
}

function paint(me) {
  clearInterval(pollT);
  const st = me.state;
  if (st === 'pending') return paintWait(me);
  if (st === 'refused') return paintRefused(me);
  if (st === 'suspended') return paintSuspended(me);
  if (st === 'active') { location.reload(); return; }
  paintAsk(me);
}

function paintAsk(me, err = '', codeOpen = false) {
  const name = el('input', { class: 'fld', id: 'porte-nom', placeholder: 'ton nom', maxlength: 24, autocomplete: 'nickname',
    'aria-label': 'ton nom', spellcheck: 'false' });
  const warn = el('p', { class: 'warn', role: 'alert', hidden: !err }, err);
  const go = el('button', { class: 'tb go', type: 'submit' }, 'Demander l’accès');
  const ask = el('form', { class: 'porte-form', onsubmit: async (e) => {
    e.preventDefault();
    go.disabled = true;
    try {
      const d = await api('auth/request', { method: 'POST', body: { name: name.value } });
      paint({ state: 'pending', user: d.user, since: d.since });
    } catch (x) { warn.hidden = false; warn.textContent = x.message; go.disabled = false; name.focus(); }
  } }, el('div', { class: 'row' }, name, go));
  const cName = el('input', { class: 'fld', placeholder: 'ton nom (vide pour Cal)', maxlength: 24, 'aria-label': 'ton nom' });
  const cCode = el('input', { class: 'fld mono-in', placeholder: 'XXXX-XXXX', maxlength: 20, autocomplete: 'one-time-code',
    'aria-label': 'le code', spellcheck: 'false' });
  const cWarn = el('p', { class: 'warn', role: 'alert', hidden: true });
  const enter = el('button', { class: 'tb', type: 'submit' }, 'Entrer');
  const codeForm = el('form', { class: 'porte-code', hidden: !codeOpen, onsubmit: async (e) => {
    e.preventDefault();
    enter.disabled = true;
    try {
      await api('auth/code', { method: 'POST', body: { name: cName.value, code: cCode.value } });
      location.reload();
    } catch (x) { cWarn.hidden = false; cWarn.textContent = x.message; enter.disabled = false; }
  } },
  el('p', {}, 'Un code de liaison se crée sur un appareil déjà connecté : ton nom, en haut à droite, puis « Relier un appareil ». ',
    'Cal entre avec le code écrit sur DGX2.'),
  el('div', { class: 'row' }, cName, cCode, enter), cWarn);
  box.replaceChildren(frame(
    el('p', {}, 'Le portail de Cal : images, vidéos, personnages, sur ses deux DGX quand elles sont allumées. ',
      'Donne ton nom : Cal reçoit ta demande et t’ouvre la porte. Ce navigateur s’en souviendra.'),
    ask, warn,
    el('div', { class: 'porte-alt' },
      el('button', { class: 'tb ghost sm', type: 'button', 'aria-expanded': String(codeOpen), onclick: (e) => {
        codeForm.hidden = !codeForm.hidden;
        e.currentTarget.setAttribute('aria-expanded', String(!codeForm.hidden));
        if (!codeForm.hidden) cCode.focus();
      } }, 'J’ai un code'),
      me.bootstrap ? el('span', { class: 'lbl' }, 'pas encore d’admin : Cal entre d’abord, avec son code') : null),
    codeForm));
  (codeOpen ? cCode : name).focus();
}

function paintWait(me) {
  const nm = me.user?.name || '';
  const since = el('span', { class: 'lbl' }, me.since ? `demandé à ${hhmm(me.since)}` : '');
  box.replaceChildren(frame(
    el('span', { class: 'porte-state' }, el('i'), 'demande envoyée · en attente de Cal'),
    el('p', {}, `Bonjour ${nm}. Cal doit accepter ta demande ; cette page s’ouvrira toute seule, tu peux la laisser ouverte.`),
    el('div', { class: 'porte-pulse', 'aria-hidden': 'true' }, el('i')),
    el('div', { class: 'row' }, since, el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm', onclick: async () => {
        try { await api('auth/cancel', { method: 'POST' }); } catch { /* */ }
        paintAsk({ state: 'anonymous' });
      } }, 'Annuler la demande'))));
  pollT = setInterval(async () => {
    try {
      const m = await api('auth/me');
      if (m.state !== 'pending') paint(m);
    } catch { /* le portail redémarre : on réessaie */ }
  }, 4000);
}

function paintRefused(me) {
  box.replaceChildren(frame(
    el('span', { class: 'porte-state off' }, el('i'), 'demande refusée'),
    el('p', {}, `Cal n’a pas accepté la demande${me.name ? ` de ${me.name}` : ''}.`),
    el('div', { class: 'row' }, el('button', { class: 'tb ghost', onclick: async () => {
      try { await api('auth/cancel', { method: 'POST' }); } catch { /* */ }
      paintAsk({ state: 'anonymous' });
    } }, 'Faire une autre demande'))));
}

function paintSuspended(me) {
  box.replaceChildren(frame(
    el('span', { class: 'porte-state off' }, el('i'), 'accès suspendu'),
    el('p', {}, `${me.user?.name || 'Ton accès'} : Cal a suspendu cet accès. Vois avec lui.`),
    el('div', { class: 'row' }, el('button', { class: 'tb ghost', onclick: async () => {
      try { await api('auth/logout', { method: 'POST' }); } catch { /* */ }
      paintAsk({ state: 'anonymous' });
    } }, 'Se déconnecter'))));
}

// ── le menu de son compte ───────────────────────────────────
let menu = null;
function closeMenu() { if (menu) { menu.remove(); menu = null; document.removeEventListener('pointerdown', outside, true); } }
function outside(e) { if (menu && !menu.contains(e.target) && !e.target.closest('#sr-me')) closeMenu(); }

export async function account(me, anchor) {
  await styles();
  if (menu) return closeMenu();
  const list = el('div', { class: 'acct-list' }, el('p', { class: 'lbl' }, 'chargement'));
  const link = el('div', { class: 'acct-link' });
  menu = el('div', { class: 'acct', role: 'menu', 'aria-label': 'mon compte' },
    el('div', { class: 'acct-head' }, el('b', {}, me.user.name),
      el('span', { class: 'lbl' }, me.user.role === 'admin' ? 'admin' : 'ami·e')),
    el('span', { class: 'lbl' }, 'mes appareils'), list,
    el('div', { class: 'row' },
      el('button', { class: 'tb ghost sm', onclick: async () => {
        try {
          const c = await api('auth/link', { method: 'POST' });
          const t0 = Date.now();
          const left = el('span', { class: 'lbl' });
          const tick = () => {
            const s = Math.max(0, c.expires_in - Math.round((Date.now() - t0) / 1000));
            left.textContent = s ? `valable ${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}` : 'expiré';
            if (s && menu) setTimeout(tick, 1000);
          };
          link.replaceChildren(el('span', { class: 'lbl' }, 'sur l’autre appareil : « J’ai un code », ton nom, puis'),
            el('b', { class: 'acct-code' }, c.code), left);
          tick();
        } catch (e) { toast(e.message); }
      } }, 'Relier un appareil'),
      el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm', onclick: async () => {
        try { await api('auth/logout', { method: 'POST' }); } catch { /* */ }
        location.href = href('');
      } }, 'Se déconnecter')),
    link);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  document.body.append(menu);
  document.addEventListener('pointerdown', outside, true);
  const paintDevices = async () => {
    try {
      const { devices } = await api('auth/devices');
      list.replaceChildren(...devices.map((d) => el('div', { class: 'acct-dev' + (d.current ? ' cur' : '') },
        el('span', { class: 'ua', title: d.ua }, uaShort(d.ua)),
        el('span', { class: 'lbl' }, d.current ? 'celui-ci' : `vu ${new Date(d.seen).toLocaleDateString('fr-FR')}`),
        d.current ? null : el('button', { class: 'tb ghost sm', title: 'ce navigateur n’entrera plus', onclick: async () => {
          try { await api(`auth/devices/${d.id}/revoke`, { method: 'POST' }); paintDevices(); } catch (e) { toast(e.message); }
        } }, 'Retirer'))));
    } catch (e) { list.replaceChildren(el('p', { class: 'warn' }, e.message)); }
  };
  paintDevices();
}

export function uaShort(ua = '') {
  const b = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'navigateur';
  const o = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return o ? `${b} · ${o}` : b;
}
