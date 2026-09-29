// SHOWRUNNER TOOLS — les préférences : générales et par outil, rangées par
// personne sur le portail (server/tools/prefs.py, /api/prefs), avec un
// miroir dans ce navigateur : le thème se pose avant d'attendre le
// serveur (commun/theme.js), et rien ne se perd si le portail ne répond pas
// (les changements attendent, puis partent au relevé suivant).
//
//   import { prefs, openPrefs } from '../commun/prefs.js';
//   prefs.get('asset.sort', 'new')        la valeur, sinon le défaut du schéma, sinon d
//   prefs.set('asset.sort', 'title')      aussitôt ici, puis sur le portail (regroupé)
//   prefs.on('asset.sort', (v) => …)      à chaque changement (ici, ou relu du portail) ; rend de quoi se désabonner
//   prefs.ready                           promesse : relu du portail une fois
//   prefs.theme() · prefs.setTheme({base, name, tokens})   le thème « le mien » (l'éditeur)
//   openPrefs('asset')                    le panneau, sur l'onglet d'un outil
//
// Chaque outil déclare ses préférences dans `<son dossier>/prefs.json`
// (le Général : commun/prefs.json) ; le serveur refuse ce qui n'y est pas,
// le panneau se dessine seul depuis ces schémas. Rien à « enregistrer » :
// chaque choix vaut dès le clic (règle 7 du thème).

import { api, el, $, $$, toast, TOOLS, href, session } from './shell.js';
import { applyTheme, LOCAL_KEY } from './theme.js';

// la feuille du panneau (et des boutons d'annulation), chargée une fois, à côté de ce fichier
export function loadPrefsCss() {
  if (!document.querySelector('link[data-sr-prefs]')) {
    document.head.append(el('link', { rel: 'stylesheet', href: new URL('./prefs.css', import.meta.url).href, 'data-sr-prefs': '' }));
  }
}

// ── le miroir local ─────────────────────────────────────────
function readStore() {
  try {
    const s = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    if (s && typeof s === 'object') return { data: s.data || {}, rev: s.rev || 0, dirty: s.dirty || {}, at: s.at || null };
  } catch { /* stockage fermé */ }
  return { data: {}, rev: 0, dirty: {}, at: null };
}
const L = readStore();
const S = { schemas: {}, tokens: [], online: null, me: null, pushT: null, pushing: null, subs: new Map(), synced: false };
function writeStore() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ data: L.data, rev: L.rev, dirty: L.dirty, at: new Date().toISOString() })); } catch { /* navigation privée : la session seule */ }
}

const split = (path) => { const i = path.indexOf('.'); return i < 0 ? [path, ''] : [path.slice(0, i), path.slice(i + 1)]; };
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function specOf(tool, key) { return (S.schemas[tool]?.prefs || []).find((p) => p.key === key) || null; }
function defaultOf(tool, key) { const s = specOf(tool, key); return s ? s.default : undefined; }

function notify(paths) {
  for (const p of paths) for (const cb of S.subs.get(p) || []) { try { cb(get(p)); } catch (e) { console.error(e); } }
  for (const cb of S.subs.get('*') || []) { try { cb(paths); } catch (e) { console.error(e); } }
}

function get(path, d) {
  const [tool, key] = split(path);
  const v = L.data[tool]?.[key];
  if (v !== undefined && v !== null) return v;
  const def = defaultOf(tool, key);
  return def !== undefined ? def : d;
}

function mergeDirty(tool, key, v) {
  (L.dirty[tool] ||= {})[key] = v === undefined ? null : v;
}

function set(path, value) {
  const [tool, key] = split(path);
  if (!tool || !key) throw new Error(`préférence sans outil : ${path}`);
  const cur = L.data[tool]?.[key];
  if (same(cur, value)) return;
  if (value === undefined || value === null) { if (L.data[tool]) { delete L.data[tool][key]; if (!Object.keys(L.data[tool]).length) delete L.data[tool]; } }
  else (L.data[tool] ||= {})[key] = clone(value);
  mergeDirty(tool, key, value);
  writeStore();
  if (tool === 'general') applyTheme(L.data);
  notify([path]);
  schedulePush();
}

function theme() { return clone(L.data.theme) || { tokens: {} }; }
// le thème « le mien » : base, nom, jetons (null retire un jeton : il revient au défaut)
function setTheme(patch) {
  const t = L.data.theme ? clone(L.data.theme) : {};
  const d = (L.dirty.theme ||= {});
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'tokens') {
      t.tokens = t.tokens || {};
      d.tokens = d.tokens || {};
      if (v === null) { for (const n of Object.keys(t.tokens)) d.tokens[n] = null; t.tokens = {}; continue; }
      for (const [n, c] of Object.entries(v)) {
        if (c === null || c === undefined) delete t.tokens[n]; else t.tokens[n] = c;
        d.tokens[n] = c ?? null;
      }
    } else { t[k] = v; d[k] = v; }
  }
  L.data.theme = t;
  writeStore();
  applyTheme(L.data);
  notify(['theme']);
  schedulePush();
}

function schedulePush() { clearTimeout(S.pushT); S.pushT = setTimeout(push, 400); }
async function push() {
  if (S.pushing) { await S.pushing; }
  if (!Object.keys(L.dirty).length) return;
  const sent = clone(L.dirty);
  S.pushing = (async () => {
    try {
      const r = await api('prefs', { method: 'POST', body: { patch: sent } });
      // ce qui est parti est rangé ; ce qui a changé pendant l'envoi repartira
      for (const [tool, vals] of Object.entries(sent)) {
        for (const [k, v] of Object.entries(vals || {})) {
          if (tool === 'theme' && k === 'tokens') {
            for (const [n, c] of Object.entries(v || {})) if (same(L.dirty.theme?.tokens?.[n], c)) delete L.dirty.theme.tokens[n];
            if (L.dirty.theme?.tokens && !Object.keys(L.dirty.theme.tokens).length) delete L.dirty.theme.tokens;
          } else if (same(L.dirty[tool]?.[k], v)) delete L.dirty[tool][k];
        }
        if (L.dirty[tool] && !Object.keys(L.dirty[tool]).length) delete L.dirty[tool];
      }
      L.rev = r.rev;
      S.online = true;
      writeStore();
      paintStatus();
    } catch (e) {
      if (e.status === 400 || e.status === 413) {
        // refusé par le schéma : ce changement ne vaut rien, il ne repartira pas
        L.dirty = {};
        writeStore();
        toast(`préférence refusée : ${e.message}`, 7000);
        sync();
      } else { S.online = false; paintStatus(); }
    }
  })();
  await S.pushing;
  S.pushing = null;
}

// relire le portail : au chargement, et quand on revient sur l'onglet (un
// autre navigateur a pu changer le thème)
async function sync() {
  let r;
  try { r = await api('prefs'); } catch (e) {
    S.online = false; paintStatus();
    return false;
  }
  S.online = true;
  S.schemas = Object.fromEntries((r.schemas || []).map((s) => [s.tool, s]));
  S.tokens = r.tokens || [];
  if (Object.keys(L.dirty).length) {
    try { r = await api('prefs', { method: 'POST', body: { patch: L.dirty } }); L.dirty = {}; } catch (e) {
      if (e.status === 400) L.dirty = {};   // un vieux changement que le schéma ne prend plus
    }
  }
  const before = clone(L.data);
  L.data = r.prefs || {};
  L.rev = r.rev || 0;
  writeStore();
  applyTheme(L.data);
  const changed = [];
  for (const tool of new Set([...Object.keys(before), ...Object.keys(L.data)])) {
    if (tool === 'theme') { if (!same(before.theme, L.data.theme)) changed.push('theme'); continue; }
    for (const k of new Set([...Object.keys(before[tool] || {}), ...Object.keys(L.data[tool] || {})])) {
      if (!same(before[tool]?.[k], L.data[tool]?.[k])) changed.push(`${tool}.${k}`);
    }
  }
  S.synced = true;
  if (changed.length) notify(changed);
  paintStatus();
  return true;
}

function on(path, cb) {
  if (!S.subs.has(path)) S.subs.set(path, new Set());
  S.subs.get(path).add(cb);
  return () => S.subs.get(path)?.delete(cb);
}

let readyP = null;
function ready() {
  if (!readyP) readyP = session().then((me) => { S.me = me; return me && me.state === 'active' ? sync() : false; }).catch(() => false);
  return readyP;
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.synced) sync(); });

export const prefs = {
  get, set, on, theme, setTheme, sync,
  get ready() { return ready(); },
  schemas: () => S.schemas, tokens: () => S.tokens.slice(), online: () => S.online,
  defaultOf: (path) => { const [t, k] = split(path); return defaultOf(t, k); },
};

// ── le panneau ──────────────────────────────────────────────
// Un onglet Général, puis un par outil, dans l'ordre de l'en-tête ; un
// outil sans prefs.json le dit. Chaque réglage vaut dès le clic.
const ORDER = () => ['general', ...TOOLS.map((t) => t.id), 'admin'];
const NAME = () => Object.fromEntries([['general', 'Général'], ...TOOLS.map((t) => [t.id, t.name]), ['admin', 'Admin']]);
const DIR = () => Object.fromEntries(TOOLS.map((t) => [t.id, t.path]));

let panel = null;
function paintStatus() {
  const s = panel && $('.pf-status', panel.node);
  if (!s) return;
  const who = S.me?.user?.name;
  s.textContent = S.online === false ? 'le portail ne répond pas : gardées dans ce navigateur, elles partiront au prochain relevé'
    : Object.keys(L.dirty).length ? 'envoi…' : who ? `rangées sur le portail pour ${who} · tous tes navigateurs` : 'rangées sur le portail';
  s.classList.toggle('off', S.online === false);
}

export async function openPrefs(tab = null) {
  loadPrefsCss();
  if (panel) { panel.close(); return; }
  await ready();
  if (!Object.keys(S.schemas).length) {
    // le portail ne répond pas : les schémas se lisent quand même, fichiers statiques
    const files = [['general', 'commun/prefs.json'], ...Object.entries(DIR()).map(([id, p]) => [id, p + 'prefs.json']), ['admin', 'admin/prefs.json']];
    await Promise.all(files.map(async ([, f]) => {
      try { const r = await fetch(href(f)); if (r.ok) { const s = await r.json(); S.schemas[s.tool] = s; } } catch { /* pas de schéma */ }
    }));
  }
  const isAdmin = S.me?.user?.role === 'admin';
  const names = NAME();
  const tabs = ORDER().filter((id) => id !== 'admin' || isAdmin);
  let cur = tab && tabs.includes(tab) && S.schemas[tab] ? tab : (sessionStorage.getItem('sr-prefs-tab') || 'general');
  if (!tabs.includes(cur)) cur = 'general';
  const nav = el('nav', { class: 'pf-tabs', role: 'tablist', 'aria-label': 'les onglets' });
  const body = el('div', { class: 'pf-pane', role: 'tabpanel' });
  const status = el('span', { class: 'lbl pf-status' });
  const close = () => { scrim.remove(); document.removeEventListener('keydown', esc, true); unsub(); panel = null; last?.focus?.(); };
  const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const last = document.activeElement;
  const scrim = el('div', { class: 'scrim sr-prefs', onclick: (e) => { if (e.target === scrim) close(); } },
    el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'préférences' },
      el('div', { class: 'modal-head' }, el('span', { class: 't' }, 'Préférences'), el('span', { class: 'sp' }), status,
        el('button', { class: 'tb ghost sm', type: 'button', onclick: close, title: 'fermer (Échap)' }, 'Fermer')),
      el('div', { class: 'pf-body' }, nav, body)));
  const paintNav = () => nav.replaceChildren(...tabs.map((id) => el('button', {
    class: 'pf-tab' + (id === cur ? ' on' : '') + (S.schemas[id] ? '' : ' none'), type: 'button', role: 'tab', 'aria-selected': String(id === cur),
    onclick: () => { cur = id; try { sessionStorage.setItem('sr-prefs-tab', id); } catch { /* rien */ } paintNav(); paintPane(); },
  }, el('span', { class: 'nm' }, names[id] || id), el('span', { class: 'n' }, S.schemas[id] ? String(S.schemas[id].prefs.filter((p) => !p.hidden).length) : '—'))));
  const paintPane = () => {
    const s = S.schemas[cur];
    if (!s) {
      const dir = DIR()[cur] || `${cur}/`;
      body.replaceChildren(el('h3', { class: 'pf-h' }, names[cur] || cur),
        el('p', { class: 'hint' }, cur === 'character'
          ? 'Character Factory a son propre studio, sur DGX1 : ses réglages vivent là-bas.'
          : `Cet outil n’a pas encore de préférences. Elles se déclarent dans ${dir}prefs.json : le panneau les dessine seul (docs/etudes/preferences.md).`));
      return;
    }
    body.replaceChildren(el('h3', { class: 'pf-h' }, s.title || names[cur]),
      s.about ? el('p', { class: 'hint pf-about' }, s.about) : null,
      ...s.prefs.filter((p) => !p.hidden).map((p) => row(cur, p)));
  };
  const unsub = on('*', () => { if (panel) { paintPane(); paintNav(); } });
  document.addEventListener('keydown', esc, true);
  document.body.append(scrim);
  panel = { node: scrim, close };
  paintNav(); paintPane(); paintStatus();
  nav.querySelector('.pf-tab.on')?.focus();
}

function row(tool, p) {
  const path = `${tool}.${p.key}`;
  const v = get(path);
  const isDef = same(v, p.default);
  const setV = (x) => set(path, same(x, p.default) ? null : x);
  let ctl;
  if (p.type === 'choice') {
    const opts = (p.options || []).map((o) => (Array.isArray(o) ? o : [o, String(o)]));
    const short = opts.length <= 5 && opts.every(([, l]) => String(l).length <= 22);
    ctl = short
      ? el('div', { class: 'seg wrap', role: 'radiogroup', 'aria-label': p.label }, ...opts.map(([val, lab]) => el('button', {
        class: 'tb' + (same(val, v) ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(same(val, v)), onclick: () => setV(val) }, lab)))
      : el('select', { class: 'fld', 'aria-label': p.label, onchange: (e) => setV(opts[e.target.selectedIndex][0]) },
        ...opts.map(([val, lab]) => el('option', { selected: same(val, v) }, lab)));
  } else if (p.type === 'toggle') {
    ctl = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': p.label },
      ...[[true, 'Oui'], [false, 'Non']].map(([val, lab]) => el('button', { class: 'tb' + (v === val ? ' on' : ''), type: 'button', role: 'radio',
        'aria-checked': String(v === val), onclick: () => setV(val) }, lab)));
  } else if (p.type === 'number') {
    const out = el('b', { class: 'pf-val' }, `${v}${p.unit ? ' ' + p.unit : ''}`);
    const r = el('input', { type: 'range', min: p.min, max: p.max, step: p.step || 1, value: v, 'aria-label': p.label,
      oninput: (e) => { out.textContent = `${e.target.value}${p.unit ? ' ' + p.unit : ''}`; },
      onchange: (e) => setV(Number(e.target.value)) });
    ctl = el('div', { class: 'row pf-num' }, r, out);
  } else {
    ctl = el('input', { class: 'fld', value: v ?? '', maxlength: p.maxlength || 200, 'aria-label': p.label, onchange: (e) => setV(e.target.value) });
  }
  return el('div', { class: 'pf-row' },
    el('div', { class: 'pf-lab' }, el('span', { class: 'pf-name' }, p.label), p.help ? el('span', { class: 'hint' }, p.help) : null,
      p.link ? el('a', { class: 'tb ghost sm pf-link', href: href(p.link.href) }, p.link.label) : null),
    el('div', { class: 'pf-ctl' }, ctl,
      el('button', { class: 'tb ghost sm pf-def', type: 'button', 'aria-disabled': isDef ? 'true' : null,
        title: isDef ? 'c’est déjà la valeur par défaut' : `revenir au défaut : ${labelOf(p, p.default)}`,
        onclick: () => { if (isDef) { toast('c’est déjà la valeur par défaut'); return; } set(path, null); } }, 'défaut')));
}

function labelOf(p, v) {
  if (p.type === 'toggle') return v ? 'oui' : 'non';
  const o = (p.options || []).find((x) => same(Array.isArray(x) ? x[0] : x, v));
  return o ? (Array.isArray(o) ? o[1] : String(o)) : String(v);
}

// Ctrl+, ouvre le panneau (Ableton Live, VS Code) : posé par shell.js
export { sync as syncPrefs };
