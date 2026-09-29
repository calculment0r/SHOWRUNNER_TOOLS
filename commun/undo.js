// SHOWRUNNER TOOLS — l'annulation commune (docs/etudes/preferences.md).
//
// Une pile de gestes par page (un outil, un document) ; chaque geste sait
// se défaire et se refaire. Deux façons de l'écrire :
//   - une commande et son contraire : U.run({ label, do, undo }) fait le
//     geste puis le range ; U.record({ label, undo, redo }) range un geste
//     déjà fait ;
//   - un instantané : const T = U.snapshots({ get, set, describe }) ; T.commit()
//     après chaque changement — annuler repose l'état d'avant, tout entier
//     (le formulaire d'un outil, sa barre de réglages).
// Des gestes rapprochés de même clé `merge` se fondent en un seul (les
// frappes, un curseur qu'on glisse) ; U.group(label, fn) en range plusieurs
// sous un seul libellé (« déplacer 3 plans »).
//
//   import { createUndo } from '../commun/undo.js';
//   const U = createUndo({ name: 'asset', onapply: (e, how) => refresh() });
//   await U.run({ label: 'ranger 3 objets', do: () => …, undo: (r) => … });
//   U.undo() · U.redo() · U.labels() → { undo: 'Annuler : ranger 3 objets', redo }
//   U.buttons() → [↶, ↷, journal] (état et bulles tenus à jour) · U.showLog()
//
// Clavier : Ctrl+Z annule, Ctrl+Maj+Z et Ctrl+Y rétablissent (⌘ sur Mac).
// Dans un champ texte, le navigateur garde la main : sa propre pile défait
// la frappe ; notre pile reprend quand on en sort. Une fenêtre ouverte
// (.scrim) garde aussi la main, sauf le journal.
//
// Ce qui ne s'annule pas (on ne le range pas) : lancer un rendu, envoyer un
// fichier, vider la corbeille, accepter une personne — ce qui est parti
// hors de la page. Un contraire que le serveur refuse (l'objet a changé
// ailleurs, il est parti) fait tomber le geste, et le dit.

import { api, el, $, $$, toast } from './shell.js';
import { prefs, loadPrefsCss } from './prefs.js';

const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
export function keyLabel(which) {
  const mode = prefs.get('general.undoKeys', 'auto');
  const cmd = mode === 'cmd' || (mode === 'auto' && MAC);
  return which === 'undo' ? (cmd ? '⌘Z' : 'Ctrl+Z') : (cmd ? '⌘⇧Z' : 'Ctrl+Maj+Z');
}

let active = null;
const all = new Set();
let seq = 0;
// un titre cité dans un libellé (souvent un prompt entier) : ses 38 premiers signes
const short = (label) => String(label || 'modifier').replace(/«\s?([^»]{40,}?)\s?»/g, (m, t) => `« ${t.slice(0, 38).trim()}… »`);

// mergeMs : 500 ms, le délai de fusion de Yjs (captureTimeout) et de
// ProseMirror (newGroupDelay) ; un champ qu'on remplit se fond par sa clé
// de saisie, sans délai (étude, § fusion des frappes)
export function createUndo({ name = 'page', limit = 200, mergeMs = 500, onapply = null } = {}) {
  const U = {
    name, done: [], undone: [], journal: [], applying: false, queue: Promise.resolve(), subs: new Set(), _g: null,
  };
  const now = () => Date.now();
  const notify = () => { for (const cb of U.subs) { try { cb(U); } catch (e) { console.error(e); } } paintButtons(U); };
  const log = (e, state, msg = '') => {
    U.journal.push({ id: e.id, label: e.label, state, msg, t: new Date() });
    if (U.journal.length > 400) U.journal.shift();
  };

  function push(entry) {
    entry.label = short(entry.label);
    U.done.push(entry);
    if (U.done.length > limit) U.done.shift();
    U.undone = [];
    log(entry, 'fait');
    notify();
    return entry;
  }

  // range un geste déjà fait ; spec : { label, undo, redo, merge, mergeMs }
  U.record = (spec) => {
    if (U.applying) return null;
    const part = { undo: spec.undo, redo: spec.redo };
    if (U._g) { U._g.parts.push(part); return null; }
    const top = U.done[U.done.length - 1];
    const win = spec.mergeMs ?? mergeMs;
    if (spec.merge && top && top.merge === spec.merge && !U.undone.length && now() - top.t < win) {
      top.parts.push(part);
      top.t = now();
      if (spec.label) top.label = short(spec.label);
      notify();
      return top;
    }
    return push({ id: ++seq, label: spec.label || 'modifier', parts: [part], merge: spec.merge || null, t: now() });
  };

  // fait le geste, puis le range ; undo reçoit ce que do a rendu (un id créé…)
  U.run = async (spec) => {
    let r = await spec.do();
    U.record({ label: spec.label, merge: spec.merge, mergeMs: spec.mergeMs,
      undo: () => spec.undo(r),
      redo: async () => { const n = await (spec.redo || spec.do)(r); if (n !== undefined) r = n; return n; } });
    return r;
  };

  // plusieurs gestes sous un seul libellé : U.group('ranger 3 objets', async () => { … })
  U.group = async (label, fn) => {
    const g = { label, parts: [] };
    const prev = U._g;
    U._g = g;
    let out;
    try { out = await fn(); } finally { U._g = prev; }
    if (g.parts.length) {
      if (prev) prev.parts.push(...g.parts);
      else push({ id: ++seq, label, parts: g.parts, merge: null, t: now() });
    }
    return out;
  };

  // un état tout entier : get() le rend (sérialisable), set(état) le repose ;
  // describe(avant, après) → { label, merge, mergeMs } ; ignore : des clés qui
  // suivent l'état sans faire un geste à elles seules (la vue, le mode)
  U.snapshots = ({ get, set, describe = null, ignore = [] }) => {
    const T = { cur: null, next: null };
    const cut = (s) => { const o = { ...s }; for (const k of ignore) delete o[k]; return JSON.stringify(o); };
    T.reset = () => { T.cur = JSON.stringify(get()); };
    T.label = (lab) => { T.next = lab; };
    T.commit = (lab = null, opts = {}) => {
      const nowS = JSON.stringify(get());
      if (T.cur === null) { T.cur = nowS; T.next = null; return; }
      if (nowS === T.cur) { T.next = null; return; }
      const before = T.cur;
      T.cur = nowS;
      if (U.applying) { T.next = null; return; }
      if (cut(JSON.parse(before)) === cut(JSON.parse(nowS))) { T.next = null; return; }   // seule la vue a bougé
      const d = describe ? describe(JSON.parse(before), JSON.parse(nowS)) || {} : {};
      const label = lab || T.next || d.label || 'modifier';
      const merge = T.next ? null : (opts.merge ?? d.merge ?? null);
      const win = opts.mergeMs ?? d.mergeMs ?? mergeMs;
      T.next = null;
      const top = U.done[U.done.length - 1];
      if (merge && top && top.tracker === T && top.merge === merge && !U.undone.length && now() - top.t < win) {
        top.parts[0].after = nowS;
        top.t = now();
        top.label = short(label);
        notify();
        return;
      }
      const part = {
        before, after: nowS,
        undo() { T.cur = this.before; set(JSON.parse(this.before)); },
        redo() { T.cur = this.after; set(JSON.parse(this.after)); },
      };
      push({ id: ++seq, label, parts: [part], merge, t: now(), tracker: T });
    };
    return T;
  };

  async function step(dir) {
    const from = dir === 'undo' ? U.done : U.undone;
    const e = from.pop();
    if (!e) { toast(dir === 'undo' ? 'rien à annuler' : 'rien à rétablir'); notify(); return null; }
    notify();
    U.applying = true;
    const results = [];
    try {
      if (dir === 'undo') for (const p of [...e.parts].reverse()) results.push(await p.undo());
      else for (const p of e.parts) results.push(await p.redo());
    } catch (err) {
      U.applying = false;
      log(e, 'échec', err.message);
      toast(`impossible ${dir === 'undo' ? 'd’annuler' : 'de rétablir'} « ${e.label} » : ${err.message}`, 7000);
      try { onapply?.(e, { dir, failed: true, items: [] }); } catch (x) { console.error(x); }
      notify();
      return null;
    }
    U.applying = false;
    (dir === 'undo' ? U.undone : U.done).push(e);
    log(e, dir === 'undo' ? 'annulé' : 'rétabli');
    const items = results.flat().filter((x) => x && typeof x === 'object' && x.id);
    try { await onapply?.(e, { dir, items }); } catch (x) { console.error(x); }
    if (prefs.get('general.undoSay', true)) toast(`${dir === 'undo' ? 'annulé' : 'rétabli'} : ${e.label}`, 2400);
    notify();
    return e;
  }
  // les appuis rapides s'enchaînent, un à la fois (le serveur répond dans l'ordre)
  U.undo = () => (U.queue = U.queue.then(() => step('undo')));
  U.redo = () => (U.queue = U.queue.then(() => step('redo')));
  U.canUndo = () => U.done.length > 0;
  U.canRedo = () => U.undone.length > 0;
  U.labels = () => ({
    undo: U.done.length ? `Annuler : ${U.done[U.done.length - 1].label}` : 'rien à annuler',
    redo: U.undone.length ? `Rétablir : ${U.undone[U.undone.length - 1].label}` : 'rien à rétablir',
  });
  U.onchange = (cb) => { U.subs.add(cb); return () => U.subs.delete(cb); };
  U.clear = () => { U.done = []; U.undone = []; notify(); };
  U.activate = () => { active = U; };
  // revenir à un état du journal : annuler (ou rétablir) jusqu'à lui
  U.goTo = async (id) => {
    if (id === 0) { while (U.done.length) if (!(await U.undo())) break; return; }
    if (U.done.some((e) => e.id === id)) { while (U.done.length && U.done[U.done.length - 1].id !== id) if (!(await U.undo())) break; return; }
    while (U.undone.length && !U.done.some((e) => e.id === id)) if (!(await U.redo())) break;
  };
  U.buttons = () => makeButtons(U);
  U.showLog = () => showLog(U);
  all.add(U);
  if (!active) active = U;
  return U;
}

// ── les boutons ─────────────────────────────────────────────
const ICON = {
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  redo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
  log: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v5l3 2"/><path d="M3.1 11a9 9 0 1 1 .6 4.5"/><path d="M3 20v-5h5"/></svg>',
};
const btnSets = new Map();   // U → [{u, r, l}]
function makeButtons(U) {
  loadPrefsCss();
  const mk = (k, title, fn) => el('button', { class: `tb ghost sm sr-ub sr-ub-${k}`, type: 'button', 'aria-label': title, html: ICON[k], onclick: fn });
  const u = mk('undo', 'annuler', () => (U.canUndo() ? U.undo() : toast('rien à annuler')));
  const r = mk('redo', 'rétablir', () => (U.canRedo() ? U.redo() : toast('rien à rétablir')));
  const l = mk('log', 'le journal des gestes', () => U.showLog());
  const set = { u, r, l };
  if (!btnSets.has(U)) btnSets.set(U, []);
  btnSets.get(U).push(set);
  paintButtons(U);
  return [u, r, l];
}
function paintButtons(U) {
  const lab = U.labels();
  const sets = btnSets.get(U) || [];
  // une fiche repeinte laisse ses anciens boutons : ceux qu'on a vus dans la page et qui n'y sont plus s'oublient
  for (let i = sets.length - 1; i >= 0; i--) {
    if (sets[i].u.isConnected) sets[i].seen = true;
    else if (sets[i].seen) sets.splice(i, 1);
  }
  for (const { u, r, l } of sets) {
    u.setAttribute('aria-disabled', U.canUndo() ? 'false' : 'true');
    r.setAttribute('aria-disabled', U.canRedo() ? 'false' : 'true');
    u.title = U.canUndo() ? `${lab.undo} · ${keyLabel('undo')}` : `rien à annuler · ${keyLabel('undo')}`;
    r.title = U.canRedo() ? `${lab.redo} · ${keyLabel('redo')}` : `rien à rétablir · ${keyLabel('redo')}`;
    l.title = `le journal des gestes · ${U.done.length} fait${U.done.length > 1 ? 's' : ''}${U.undone.length ? `, ${U.undone.length} annulé${U.undone.length > 1 ? 's' : ''}` : ''}`;
  }
}
prefs.on('general.undoKeys', () => { for (const U of all) paintButtons(U); });

// ── le journal ──────────────────────────────────────────────
const hm = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function showLog(U) {
  loadPrefsCss();
  if ($('.sr-log')) return;
  const list = el('ol', { class: 'lg-list' });
  const close = () => { scrim.remove(); document.removeEventListener('keydown', esc, true); off(); last?.focus?.(); };
  const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const last = document.activeElement;
  const scrim = el('div', { class: 'scrim sr-log', 'data-undo-ok': '', onclick: (e) => { if (e.target === scrim) close(); } },
    el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'le journal des gestes' },
      el('div', { class: 'modal-head' }, el('span', { class: 't' }, 'Le journal des gestes'), el('span', { class: 'sp' }),
        el('span', { class: 'lbl' }, `${keyLabel('undo')} · ${keyLabel('redo')}`),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: close }, 'Fermer')),
      el('div', { class: 'modal-body' },
        el('p', { class: 'hint' }, 'Chaque geste de cette page, du premier au dernier. Un clic sur une ligne y ramène : ce qui la suit est annulé, et se rétablit d’un autre clic. La page oubliée (rechargée, fermée), le journal repart de zéro.'),
        list,
        el('details', { class: 'lg-more' }, el('summary', { class: 'lbl' }, 'tout ce qui s’est passé, échecs compris'), el('ol', { class: 'lg-raw' })))));
  const paint = () => {
    const rows = [el('li', { class: 'lg-row' + (U.done.length ? '' : ' cur') },
      el('button', { type: 'button', onclick: () => U.goTo(0) }, el('span', { class: 'lg-t' }, '—'), el('span', { class: 'lg-l' }, 'l’état d’ouverture de la page')))];
    for (const e of U.done) {
      rows.push(el('li', { class: 'lg-row' + (e === U.done[U.done.length - 1] ? ' cur' : '') },
        el('button', { type: 'button', onclick: () => U.goTo(e.id) }, el('span', { class: 'lg-t' }, hm(new Date(e.t))), el('span', { class: 'lg-l' }, e.label))));
    }
    for (const e of [...U.undone].reverse()) {
      rows.push(el('li', { class: 'lg-row undone' },
        el('button', { type: 'button', title: 'annulé : un clic le rétablit', onclick: () => U.goTo(e.id) }, el('span', { class: 'lg-t' }, hm(new Date(e.t))), el('span', { class: 'lg-l' }, e.label))));
    }
    list.replaceChildren(...rows);
    $('.lg-raw', scrim).replaceChildren(...[...U.journal].reverse().map((j) => el('li', { class: 'lg-j ' + (j.state === 'échec' ? 'bad' : '') },
      el('span', { class: 'lg-t' }, hm(j.t)), el('span', { class: 'lg-s' }, j.state), el('span', { class: 'lg-l' }, j.label + (j.msg ? ` — ${j.msg}` : '')))));
  };
  const off = U.onchange(paint);
  document.addEventListener('keydown', esc, true);
  document.body.append(scrim);
  paint();
  $('.lg-row.cur button', scrim)?.focus();
}

// ── le clavier ──────────────────────────────────────────────
const TEXT_TYPES = new Set(['', 'text', 'search', 'url', 'email', 'password', 'tel', 'number', 'date', 'time', 'datetime-local', 'month', 'week']);
export function isTextField(n) {
  if (!n || n.nodeType !== 1) return false;
  if (n.isContentEditable) return true;
  if (n.tagName === 'TEXTAREA') return !n.readOnly;
  if (n.tagName === 'INPUT') return TEXT_TYPES.has((n.getAttribute('type') || '').toLowerCase()) && !n.readOnly;
  return false;
}
document.addEventListener('keydown', (e) => {
  if (!active || e.defaultPrevented || e.isComposing || e.altKey) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  // e.key et non e.code : sur un clavier AZERTY, la touche Z n'est pas KeyZ
  const k = (e.key || '').toLowerCase();
  const isUndo = k === 'z' && !e.shiftKey;
  const isRedo = (k === 'z' && e.shiftKey) || (k === 'y' && !e.shiftKey);
  if (!isUndo && !isRedo) return;
  if (isTextField(e.target) || isTextField(document.activeElement)) return;   // la pile du navigateur
  if ($$('.scrim').some((s) => !s.hidden && !s.hasAttribute('data-undo-ok'))) return;
  e.preventDefault();
  if (isUndo) active.undo(); else active.redo();
});

// ── la bibliothèque : un changement et son contraire, lu sur le serveur ──
// Le contraire ne s'applique que si l'objet est encore tel que le geste l'a
// laissé : un changement fait ailleurs depuis (un autre onglet, quelqu'un
// d'autre) n'est pas écrasé, le geste tombe et le dit.
const FIELD_FR = { title: 'son titre', folder: 'son dossier', fav: 'son favori', tags: 'ses tags', element: 'sa fiche', shared: 'son partage' };
function pickFields(it, patch) {
  const o = {};
  for (const k of Object.keys(patch)) {
    if (k === 'element' && patch.element && typeof patch.element === 'object') {
      o.element = {};
      for (const j of Object.keys(patch.element)) o.element[j] = clone(it.element?.[j] ?? null);
    } else o[k] = clone(it[k] ?? (k === 'fav' || k === 'shared' ? false : k === 'tags' ? [] : k === 'folder' ? '' : null));
  }
  return o;
}
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const norm = (k, v) => (k === 'fav' || k === 'shared' ? !!v : k === 'folder' ? (v || '') : k === 'tags' ? (v || []) : v);
async function casWrite(id, expect, value) {
  const cur = await api('library/' + id);
  for (const k of Object.keys(expect)) {
    const now = k === 'element' ? pickFields(cur, { element: expect.element }).element : norm(k, cur[k]);
    const want = k === 'element' ? expect.element : norm(k, expect[k]);
    if (JSON.stringify(now) !== JSON.stringify(want)) throw new Error(`« ${cur.title || id} » a changé ailleurs depuis (${FIELD_FR[k] || k})`);
  }
  return api('library/' + id, { method: 'POST', body: value });
}
export async function libPatch(U, id, patch, label, { merge = null, before = null } = {}) {
  const was = before || await api('library/' + id);
  const n = await api('library/' + id, { method: 'POST', body: patch });
  const old = pickFields(was, patch), neu = pickFields(n, patch);
  if (JSON.stringify(old) !== JSON.stringify(neu)) {
    U.record({ label, merge, undo: () => casWrite(id, neu, old), redo: () => casWrite(id, old, neu) });
  }
  return n;
}
// corbeille, retour : l'un défait l'autre
export async function libTrash(U, it, label) {
  await api(`library/${it.id}/delete`, { method: 'POST' });
  U.record({ label: label || `mettre « ${it.title || it.id} » à la corbeille`,
    undo: () => api(`library/${it.id}/restore`, { method: 'POST' }),
    redo: async () => { await api(`library/${it.id}/delete`, { method: 'POST' }); return { id: it.id, gone: true }; } });
}

// la planche d'un élément (références et voix) : l'état d'avant et d'après,
// reposés par /api/asset/refs (qui sait remettre une référence retirée : son
// fichier reste dans le dossier de l'élément)
export const boardOf = (it) => ({
  refs: (it.element?.refs || []).map((r) => ({ file: r.file, role: r.role || '', label: r.label || '', item: r.item })),
  voices: (it.element?.voices || []).map((v) => ({ file: v.file, label: v.label || '', item: v.item })),
});
export async function libBoard(U, it, label, fn) {
  const before = boardOf(it);
  const res = await fn();
  const fresh = await api('library/' + it.id);
  const after = boardOf(fresh);
  if (JSON.stringify(before) === JSON.stringify(after)) return { res, item: fresh };
  const put = async (expect, value) => {
    const cur = await api('library/' + it.id);
    if (JSON.stringify(boardOf(cur)) !== JSON.stringify(expect)) throw new Error(`la planche de « ${cur.title} » a changé ailleurs depuis`);
    return api('asset/refs/' + it.id, { method: 'POST', body: value });
  };
  U.record({ label, undo: () => put(after, before), redo: () => put(before, after) });
  return { res, item: fresh };
}

export function describeLibPatch(it, patch) {
  const t = `« ${it?.title || it?.id || 'l’objet'} »`;
  const keys = Object.keys(patch);
  if (keys.length === 1 && 'fav' in patch) return patch.fav ? `aimer ${t}` : `ne plus aimer ${t}`;
  if (keys.length === 1 && 'folder' in patch) return patch.folder ? `ranger ${t} dans « ${patch.folder} »` : `retirer ${t} de son dossier`;
  if (keys.length === 1 && 'title' in patch) return `renommer ${t} en « ${patch.title} »`;
  if (keys.length === 1 && 'tags' in patch) return `changer les tags de ${t}`;
  return `modifier ${t}`;
}

// Le pont du fil (commun/fil.js aime, range et jette par lui-même, en
// appelant /api/library) : tant que le fil n'appelle pas l'annulation
// lui-même, la page lit ces écritures au passage — l'état d'avant sur le
// serveur, puis l'écriture, puis son contraire rangé. Une seule page, ses
// propres écritures ; rien d'autre n'est touché. Quand fil.js appellera
// U.record, retirer ce pont (étude, § Montage, ODIO…).
const LIB_RX = /\/api\/library\/((?:ima|vid|aud|ele)-\d{8}-\d{6}-[0-9a-f]{4})(\/delete)?$/;
export function watchLibrary(U) {
  if (window.__srLibWatch) return;
  window.__srLibWatch = U;
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const m = method === 'POST' && url.origin === location.origin ? url.pathname.match(LIB_RX) : null;
    if (!m || U.applying || typeof init.body !== 'string') return orig(input, init);
    const id = m[1];
    if (m[2]) {   // à la corbeille
      let before = null;
      try { const r = await orig(url.href.replace(/\/delete$/, ''), { method: 'GET' }); before = r.ok ? await r.json() : null; } catch { before = null; }
      const res = await orig(input, init);
      if (res.ok) {
        U.record({ label: `mettre « ${before?.title || id} » à la corbeille`,
          undo: () => api(`library/${id}/restore`, { method: 'POST' }),
          redo: async () => { await api(`library/${id}/delete`, { method: 'POST' }); return { id, gone: true }; } });
      }
      return res;
    }
    let patch;
    try { patch = JSON.parse(init.body); } catch { return orig(input, init); }
    if (!patch || typeof patch !== 'object') return orig(input, init);
    let before = null;
    try { const r = await orig(url.href, { method: 'GET' }); before = r.ok ? await r.json() : null; } catch { before = null; }
    const res = await orig(input, init);
    if (res.ok && before) {
      const n = await res.clone().json().catch(() => null);
      if (n) {
        const old = pickFields(before, patch), neu = pickFields(n, patch);
        if (JSON.stringify(old) !== JSON.stringify(neu)) {
          U.record({ label: describeLibPatch(before, patch), undo: () => casWrite(id, neu, old), redo: () => casWrite(id, old, neu) });
        }
      }
    }
    return res;
  };
}
