// SHOWRUNNER TOOLS — la page de Cal : les demandes d'accès, les
// personnes, les Teams, la file des calculs, les machines, le câblage, le
// stockage, le journal. Le serveur juge (server/tools/admin.py, /api/admin/…) :
// qui n'est pas Cal reçoit 403, et le lit ici. Les Teams (server/tools/equipes.py,
// /api/equipes/…, core/espaces.py) : l'admin d'une Team y règle la sienne — pour
// lui, la page n'a que cette section (#teams) ; tout compte y voit ses Teams, ses
// Workspaces et ce qu'il peut y faire. Un lien d'invitation de Team mène ici
// (admin/?rejoindre=<jeton>) : la porte d'abord (un pseudo), puis la Team.

//
// L'annulation (commun/undo.js) : les réglages, les quotas, le rôle admin,
// Apps ou Studio d'une personne (et sa demande de Studio, ouverte ou écartée), l'ordre, la priorité et l'épingle d'un travail en file, les pauses, les
// interrupteurs de câblage — chacun avec son contraire, que le serveur juge
// encore (un travail parti ne se replace plus : le geste tombe et le dit).
// Ne s'annulent pas : accepter ou refuser une demande, suspendre (ses travaux
// en file s'en vont), fermer une connexion, arrêter un travail, décharger une
// instance, démarrer ou arrêter H3, vider la corbeille. Dans les Teams, s'annulent :
// un rôle, le mode d'un guest (viewer, acteur), ses Workspaces, un rôle de Workspace,
// renommer, archiver, l'API, l'offre, le budget (plafond, crédits, parts) ; ne s'annulent pas : créer une Team, un
// Workspace, mettre quelqu'un dans une Team (on le retire), un lien (on le retire).
import { mountHeader, api, el, $, $$, toast, href, fmtDate, stateFr, fmtWait, ongletCache, auRetour } from '../commun/shell.js';
import { uaShort } from '../commun/porte.js';
import { createUndo } from '../commun/undo.js';
import { prefs } from '../commun/prefs.js';
import { contextMenu, pageMenu } from '../commun/menu.js';

mountHeader('admin', { sub: 'la page de Cal' });

const SECTIONS = [
  ['demandes', 'A', 'Demandes', 'accès · studio'],
  ['personnes', 'B', 'Personnes', 'apps ou studio · teams · quotas'],
  ['teams', 'C', 'Teams', 'workspaces · membres · guests'],
  ['file', 'D', 'La file', 'ordre · priorités · pauses'],
  ['machines', 'E', 'Machines', 'ComfyUI · mémoire · H3 · studio'],
  ['cablage', 'F', 'Câblage', 'les interrupteurs'],
  ['stockage', 'G', 'Stockage', 'bibliothèque · corbeille'],
  ['journal', 'H', 'Journal', 'qui a fait quoi'],
  ['diag', 'I', 'Diagnostics', 'sans terminal'],
];
// la section d'ouverture : l'adresse, sinon la préférence (admin/prefs.json)
// `limited` : qui n'est pas admin du portail (403 sur admin/state) n'a que les Teams
const S = { sec: SECTIONS.some(([id]) => id === location.hash.slice(1)) ? location.hash.slice(1) : prefs.get('admin.section', 'demandes'),
  state: null, mach: null, sw: null, store: null, jr: null, t: null, drag: null, dragLane: null, filter: '',
  limited: false, teams: null, tf: {}, fresh: {} };
const main = $('#adm-main');
// le clic droit (Cal, 29/09 : jamais le menu du navigateur) : un travail de la
// file a ses gestes ; ailleurs, les sections et la relecture, en tête du menu
// commun de repli (commun/menu.js)
contextMenu(main, (e) => e.target.closest('.qr')?._menu?.() || null);
pageMenu(() => [{ head: 'Admin' },
  { label: 'Relire maintenant', icon: '↻', onclick: () => refresh(true) },
  { label: 'Aller à', icon: '▤', items: shown().map(([id, k, name]) => ({ label: `${k} · ${name}`, checked: S.sec === id, onclick: () => go(id) })) }]);
// les sections qu'on voit : toutes pour un admin du portail, les Teams seulement sinon
function shown() { return S.limited ? SECTIONS.filter(([id]) => id === 'teams') : SECTIONS; }

const post = (path, body) => api(path, { method: 'POST', body: body || {} });
async function act(fn, msg) {
  try { await fn(); if (msg) toast(msg); } catch (e) { toast(e.message); }
  refresh(true);
}
// un geste qui s'annule : fait, rangé avec son contraire, puis la page se relit
const U = createUndo({ name: 'admin', onapply: () => refresh(true) });
const undoable = (label, doFn, undoFn, msg) => act(() => U.run({ label, do: doFn, undo: undoFn }), msg);
$('.adm-nav').prepend(el('div', { class: 'row adm-undo' }, el('span', { class: 'lbl' }, 'les gestes'), el('span', { class: 'sp' }),
  el('span', { class: 'sr-undo', role: 'group', 'aria-label': 'annuler, rétablir' }, ...U.buttons())));
// le kit de présentation de Cal (server/tools/strategie.py, contenu dans <data>/strategie/, jamais dans le dépôt) :
// Cal seul — le serveur juge (403 à tout autre compte, admin compris) et la carte ne se montre alors pas
api('strategie/moi').then((d) => {
  if (!d || !d.cal) return;
  $('.adm-nav').append(el('ul', { class: 'rack adm-kit', style: { marginTop: 'var(--s5)' } }, el('li', {},
    el('a', { class: 'item', href: href('strategie/'), target: '_top', style: { textDecoration: 'none' },   // une page normale : même onglet, jamais le volet
      title: d.pret ? 'le positionnement, le deck, les discours : pour toi seul' : 'le dossier strategie/ manque dans les données du portail' },
    el('span', { class: 'st' + (d.pret ? ' ok' : ' err') }),
    el('span', { class: 'txt' }, el('span', { class: 'ref' }, 'CAL · STRATÉGIE'),
      el('span', { class: 'nm' }, 'Positionnement et kit de présentation'),
      el('span', { class: 'sub' }, d.pret ? 'deck · discours · offres · pour toi seul' : 'pas encore posé : ~/showrunner-data/strategie/')),
    el('span', { class: 'dots' })))));
}).catch(() => { /* pas Cal : rien à montrer */ });
const head =(title, k, cnt) => el('div', { class: 'sect-head' }, el('h2', {}, title), el('span', { class: 'k' }, k),
  cnt != null ? el('span', { class: 'cnt' }, cnt) : null);
const fmtBytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} Go` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} Mo` : `${Math.round(n / 1e3)} Ko`);
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// ── le rack des sections ────────────────────────────────────
// les demandes de Studio (core/auth.py : `studio_request`, un compte Apps qui demande le Studio)
const studioAsks = () => (S.state ? S.state.users.filter((u) => u.state === 'active' && u.access === 'apps' && u.studio_asked) : []);
function nav() {
  const st = S.limited ? null : S.state;
  const waiting = st ? st.requests.length + studioAsks().length : 0;
  const counts = st ? { demandes: waiting, personnes: st.users.length,
    file: st.queue.running.length + st.queue.queued.length } : {};
  if (S.teams) counts.teams = S.teams.teams.filter((t) => !t.personal || !S.teams.everyone).length;
  const badge = $('#sr-admin');   // l'en-tête suit sans attendre son propre relevé
  if (badge && st) badge.textContent = waiting ? `Admin · ${waiting}` : 'Admin';
  $('#adm-nav').replaceChildren(...shown().map(([id, k, name, sub]) => el('li', {},
    el('button', { class: 'item' + (S.sec === id ? ' sel' : ''), onclick: () => go(id) },
      el('span', { class: 'st' + (id === 'demandes' && counts.demandes ? ' run' : '') }),
      el('span', { class: 'txt' }, el('span', { class: 'ref' }, `${k} · ${name}`), el('span', { class: 'nm' }, name),
        el('span', { class: 'sub' }, sub)),
      counts[id] != null ? el('span', { class: 'n' + (id === 'demandes' && counts[id] ? ' amb' : '') }, String(counts[id])) : null,
      el('span', { class: 'dots' })))));
}

async function go(id) {
  if (S.limited) id = 'teams';
  S.sec = id;
  history.replaceState(null, '', location.search + '#' + id);
  render(true);
  await loadSection();
  render(true);
}

// les Teams : les miennes ; Cal les voit toutes (?toutes=1), celles des autres comprises
async function loadTeams() {
  const everyone = !S.limited && !!S.state;
  const d = await api(`equipes${everyone ? '?toutes=1' : ''}`);
  S.teams = { ...d, everyone };
}

async function loadSection() {
  try {
    if (S.sec === 'teams' || S.sec === 'personnes') await loadTeams();
    if (S.sec === 'demandes' && S.porte === undefined) await loadPorte();
    if (S.sec === 'machines') S.mach = await api('admin/machines');
    if (S.sec === 'cablage') S.sw = await api('admin/switches');
    if (S.sec === 'stockage') S.store = await api('admin/storage');
    if (S.sec === 'journal') S.jr = await api('admin/journal?n=300');
    if (S.sec === 'diag') S.dg = await api('admin/diag');
  } catch (e) { if (e.status !== 403) toast(e.message); }
}

function busy() {
  const a = document.activeElement;
  // Cal, 06/10 : une sélection dans une sortie de diagnostic se perdait au relevé suivant (2-3 s)
  const sel = getSelection();
  const selecting = sel && !sel.isCollapsed && sel.anchorNode && main.contains(sel.anchorNode);
  return S.drag || selecting || (a && main.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));
}

async function refresh(now = false) {
  clearTimeout(S.t);
  if (ongletCache()) return;   // onglet caché : rien (docs/etudes/cloudflare.md, « Le compte des requêtes ») ; relu au retour
  try {
    if (!S.limited) {
      try { S.state = await api('admin/state'); } catch (e) {
        if (e.status !== 403 || /réseau de Cal/.test(e.message)) throw e;
        // pas admin du portail : la page d'administration de ses Teams
        S.limited = true; S.state = null;
        if (S.sec !== 'teams') { S.sec = 'teams'; history.replaceState(null, '', location.search + '#teams'); }
      }
    }
    if (['machines', 'journal', 'teams', 'personnes'].includes(S.sec)) await loadSection();
    render(now);
  } catch (e) {
    if (e.status === 403) return denied(e.message);
    if (e.status !== 401) main.replaceChildren(el('p', { class: 'warn' }, e.message));
  }
  // le relevé : la préférence (3 s par défaut ; les machines et le journal un peu moins souvent)
  const base = prefs.get('admin.refresh', 3) * 1000;
  clearTimeout(S.t);
  if (!ongletCache()) S.t = setTimeout(refresh, S.sec === 'machines' ? base * 4 / 3 : S.sec === 'journal' ? base * 2 : base);
}
// de retour sur l'onglet : relu tout de suite (sans forcer la repeinte : un champ en cours reste)
auRetour(() => refresh());

function denied(why = '') {
  $('#adm-nav').replaceChildren();
  main.replaceChildren(head('Réservé aux admins', '—'),
    el('p', { class: 'adm-note' }, why || 'Cette page est la page d’administration du portail : Cal, et ceux à qui il a donné le rôle admin.'),
    el('div', { class: 'row' }, el('a', { class: 'tb ghost', href: href('') }, 'Retour à l’accueil')));
}

function render(force = false) {
  if (!S.state && !(S.limited && S.teams)) return;
  nav();
  if (!force && busy()) return;   // on ne repeint pas sous les doigts de Cal
  const fn = { demandes, personnes, teams: teamsSec, file, machines: machinesSec, cablage, stockage, journal: journalSec, diag: diagSec }[S.sec];
  main.replaceChildren(...[].concat(fn()).filter(Boolean));
}

// ── A · les demandes ────────────────────────────────────────
// Ajouter quelqu'un d'avance (Cal, 29/09 : « un login simple genre su007 », puis « je veux les rentrer côté
// dashboard admin ») : un pseudo créé ici est déjà accepté. Sans invitation (porte.invitation = false), l'ami ouvre
// l'adresse, tape ce pseudo et entre ; un admin, lui, ouvre d'abord le lien du code admin.
async function loadPorte() {
  try { S.porte = await api('admin/porte'); } catch { S.porte = null; }
}
// copier : le presse-papier moderne n'existe qu'en https ; le portail de la maison est en http
// (192.168.10.247:8790), où seule la vieille voie marche, et seulement pendant le clic lui-même :
// on l'appelle donc tout de suite, jamais après une longue attente (Cal, 06/10)
function legacyCopy(txt) {
  const ta = el('textarea', { readonly: '', style: { position: 'fixed', top: '0', left: '-9999px', opacity: '0' } });
  ta.value = txt;
  document.body.append(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, txt.length);
  let good = false;
  try { good = document.execCommand('copy'); } catch { good = false; }
  ta.remove();
  return good;
}
function copyText(txt) {
  if (window.isSecureContext && navigator.clipboard) return navigator.clipboard.writeText(txt).then(() => true, () => legacyCopy(txt));
  return Promise.resolve(legacyCopy(txt));
}
const copier = (txt, quoi) => el('button', { class: 'tb ghost sm', type: 'button', onclick: async () => {
  if (await copyText(txt)) toast(`${quoi} copié`); else toast(txt, 12000);
} }, 'Copier');
function inviter() {
  const p = S.porte || {};
  S.addRole ||= 'ami';
  const name = el('input', { class: 'fld', placeholder: 'su007', maxlength: 24, autocomplete: 'off', spellcheck: 'false',
    autocapitalize: 'none', 'aria-label': 'le pseudo', value: S.addName || '', oninput: (e) => { S.addName = e.target.value; } });
  const role = el('div', { class: 'seg' }, ...[['ami', 'ami·e'], ['admin', 'admin']].map(([v, lab]) =>
    el('button', { class: 'tb' + (S.addRole === v ? ' on' : ''), type: 'button', onclick: () => { S.addRole = v; if (v === 'admin') S.admShow = true; render(true); } }, lab)));
  // Apps ou Studio (un admin a toujours le Studio) ; par défaut, le réglage « un compte neuf »
  const acc = S.addAccess || S.state.settings.new_access || 'studio';
  const access = S.addRole === 'admin' ? el('span', { class: 'chip' }, 'studio · admin')
    : el('div', { class: 'seg', role: 'group', 'aria-label': 'ce qu’il ouvre' }, ...[['apps', 'Apps'], ['studio', 'Studio']].map(([v, lab]) =>
      el('button', { class: 'tb' + (acc === v ? ' on' : ''), type: 'button', onclick: () => { S.addAccess = v; render(true); } }, lab)));
  const lien = p.lien || '';
  // le lien admin reste affiché tant qu'on ne le cache pas (l'état est gardé : un rafraîchissement de la page ne le
  // ferme plus) ; choisir « admin » ou ajouter un admin l'ouvre ; « Copier le message » donne tout ce qu'il faut envoyer
  const admOpen = S.admShow ?? false;
  const admMsg = (who) => `Ouvre ce lien : ${p.lien_admin}\npuis tape le pseudo : ${who}`;
  const admLine = el('div', { class: 'sub-card', hidden: !admOpen || !p.lien_admin },
    el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'lien admin'),
      el('b', { class: 'acct-code' }, p.lien_admin || ''), el('span', { class: 'sp' }), copier(p.lien_admin || '', 'lien admin')),
    S.admFor ? el('div', { class: 'row' }, el('span', { class: 'lbl' }, `pour « ${S.admFor} »`), el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: async () => {
        if (await copyText(admMsg(S.admFor))) toast('message copié : le lien et le pseudo'); else toast(admMsg(S.admFor), 12000);
      } }, 'Copier le message')) : null);
  return el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('span', { class: 'nm' }, 'Ajouter quelqu’un'),
      el('span', { class: 'chip' }, p.mode ? `porte · ${p.mode}${p.mode === 'code' ? (p.invitation_requise ? ' · sur invitation' : ' · sans invitation') : ''}` : 'porte')),
    el('p', { class: 'adm-note' }, 'Un pseudo ajouté ici est déjà accepté : il entre en le tapant, sans attendre. ',
      p.invitation_requise === false ? 'Sans invitation, un pseudo que tu n’as pas ajouté est refusé. ' : '',
      'Un admin entre par l’adresse publique avec le code admin : donne-lui le lien admin, puis son pseudo.'),
    el('form', { class: 'row', onsubmit: (e) => {
      e.preventDefault();
      const v = name.value.trim();
      if (!v) { name.focus(); return; }
      const r = S.addRole;
      S.addName = '';
      if (r === 'admin') { S.admShow = true; S.admFor = v; }
      act(() => post('admin/users', { name: v, role: r, access: r === 'admin' ? 'studio' : acc }), r === 'admin'
        ? `« ${v} » ajouté, admin : le lien admin reste affiché, copie-le` : `« ${v} » peut entrer · ${acc === 'studio' ? 'Studio' : 'Apps'}`);
    } }, name, role, access, el('button', { class: 'tb', type: 'submit' }, 'Ajouter')),
    lien
      ? el('div', { class: 'row' }, el('span', { class: 'lbl' }, p.invitation_requise === false ? 'l’adresse à lui envoyer' : 'le lien à lui envoyer'),
        el('b', { class: 'acct-code' }, lien), el('span', { class: 'sp' }), copier(lien, 'lien'))
      : el('p', { class: 'why' }, p.mode === 'access'
        ? 'porte « access » : tes amis entrent par leur e-mail (la politique Cloudflare Access), pas par un lien'
        : 'pas de lien : la porte publique n’est ni « code » ni une démo en route (tools/porte.sh code)'),
    p.lien_admin ? el('div', { class: 'row' }, el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: (e) => { S.admShow = admLine.hidden; admLine.hidden = !admLine.hidden;
        e.target.textContent = admLine.hidden ? 'Montrer le lien admin' : 'Cacher le lien admin'; } }, admOpen ? 'Cacher le lien admin' : 'Montrer le lien admin')) : null,
    admLine);
}

// ouvrir le Studio d'une personne, ou le lui retirer : un geste qui s'annule (Ctrl+Z), sa demande comprise
function setAccess(u, to) {
  const was = { access: u.access, studio_request: u.studio_asked || null };
  return undoable(to === 'studio' ? `ouvrir le Studio à ${u.name}` : `fermer le Studio à ${u.name}`,
    () => post(`admin/users/${u.id}`, { access: to }), () => post(`admin/users/${u.id}`, was),
    to === 'studio' ? `${u.name} a le Studio` : `${u.name} : les Apps seulement`);
}
function studioDemandes(goFirst) {
  const r = studioAsks();
  return [head('Demandes de Studio', 'A · S', `${r.length} en attente`),
    el('p', { class: 'adm-note' }, 'Un compte Apps ouvre les Apps et Asset ; il demande le Studio depuis l’accueil, l’en-tête ou une page Studio. ',
      'Accepté, sa page s’ouvre seule ; écartée, la demande disparaît et il peut redemander. Les deux s’annulent (Ctrl+Z).'),
    r.length ? el('div', { class: 'grid2' }, ...r.map((u, i) => el('div', { class: 'card amb', 'data-studio-ask': u.id },
      el('div', { class: 'card-head' }, el('span', { class: 'nm' }, u.name), el('span', { class: 'chip amb' }, el('i'), 'studio demandé')),
      el('div', { class: 'cmeta' }, `demandé ${fmtDate(u.studio_asked)} · pseudo `, el('b', {}, u.pseudo || u.name), ' · apps aujourd’hui'),
      el('div', { class: 'row' },
        el('button', { class: goFirst && i === 0 ? 'tb go' : 'tb', onclick: () => setAccess(u, 'studio') }, 'Ouvrir le Studio'),
        el('button', { class: 'tb ghost', onclick: () => undoable(`écarter la demande de Studio de ${u.name}`,
          () => post(`admin/users/${u.id}`, { studio_request: null }), () => post(`admin/users/${u.id}`, { studio_request: u.studio_asked }),
          `demande de ${u.name} écartée`) }, 'Écarter')))))
      : el('p', { class: 'lbl' }, 'aucune demande de Studio')];
}

function demandes() {
  const r = S.state.requests;
  return [head('Demandes d’accès', 'A', `${r.length} en attente`), inviter(),
    el('p', { class: 'adm-note' }, 'Une demande, c’est un pseudo neuf tapé à l’accueil. Accepté, il entre — la page qui attend s’ouvre seule, ',
      'et ensuite ce pseudo suffit, de n’importe quel navigateur ; refusé, la page le dit et le pseudo redevient libre. ',
      'Un pseudo qui imite un admin (casse, accents, 0/O, 1/l/I) est refusé d’office.'),
    r.length ? el('div', { class: 'grid2' }, ...r.map((u, i) => el('div', { class: 'card amb' },
      el('div', { class: 'card-head' }, el('span', { class: 'nm' }, u.name), el('span', { class: 'chip amb' }, el('i'), 'en attente')),
      el('div', { class: 'cmeta' }, `demandé ${fmtDate(u.created)} · `, el('b', {}, u.ip || 'adresse inconnue'), ` · ${uaShort(u.ua)}`),
      el('div', { class: 'row' },
        el('button', { class: i === 0 ? 'tb go' : 'tb', onclick: () => act(() => post(`admin/requests/${u.id}/accept`), `${u.name} peut entrer`) }, 'Accepter'),
        el('button', { class: 'tb ghost', onclick: () => act(() => post(`admin/requests/${u.id}/refuse`), `demande de ${u.name} refusée`) }, 'Refuser')))))
      : el('p', { class: 'lbl' }, 'aucune demande en attente'),
    // un seul orange par écran : la première demande d'accès, sinon la première demande de Studio
    ...studioDemandes(!r.length)];
}

// ── B · les personnes ───────────────────────────────────────
function qf(label, value, placeholder, onset, disabled = false) {
  return el('label', { class: 'qf' }, el('span', { class: 'lbl' }, label),
    el('input', { class: 'fld', type: 'number', min: 0, max: 10000, value: value ?? '', placeholder, disabled,
      onchange: (e) => onset(e.target.value === '' ? null : Number(e.target.value)) }));
}

const SET_FR = { visibility: 'qui voit quoi', admin_first: 'la priorité des admins', admin_lan_only: 'l’entrée des admins', new_access: 'ce qu’ouvre un compte neuf',
  total_queued: 'le total en file', running: 'les travaux simultanés', queued: 'les travaux en file', per_day: 'les travaux par jour' };
function reglages() {
  const s = S.state.settings;
  // le contraire d'un réglage : sa valeur d'avant, lue dans l'état affiché
  const set = (patch, msg = 'enregistré') => {
    const before = {};
    for (const k of Object.keys(patch)) {
      if (k === 'quotas') before.quotas = Object.fromEntries(Object.keys(patch.quotas).map((q) => [q, s.quotas[q] ?? null]));
      else before[k] = s[k] ?? null;
    }
    const key = Object.keys(patch)[0] === 'quotas' ? Object.keys(patch.quotas)[0] : Object.keys(patch)[0];
    return undoable(`changer ${SET_FR[key] || key}`, () => post('admin/settings', patch), () => post('admin/settings', before), msg);
  };
  const seg = (opts, cur, key) => el('div', { class: 'seg' }, ...opts.map(([v, lab]) =>
    el('button', { class: 'tb' + (cur === v ? ' on' : ''), onclick: () => set({ [key]: v }) }, lab)));
  return el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('span', { class: 'nm' }, 'Réglages')),
    el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'qui voit quoi'),
      seg([['all', 'tout le monde voit tout'], ['own', 'chacun le sien et le partagé']], s.visibility, 'visibility')),
    el('p', { class: 'adm-note' }, 'Ta décision est en attente (docs/REPRISE.md) ; par défaut, tout le monde voit tout. Dans les deux cas, ',
      'seul le propriétaire d’un objet — ou toi — le modifie ou le met à la corbeille. L’audit du 28/09 (C2) recommande ',
      '« chacun le sien » : les amis déposeront des photos de visages réels.'),
    el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'dans la file'),
      seg([[true, 'les admins passent devant'], [false, 'tout le monde au tourniquet']], s.admin_first, 'admin_first')),
    el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'un pseudo admin entre'),
      seg([[true, 'depuis le réseau de Cal'], [false, 'de partout']], s.admin_lan_only, 'admin_lan_only')),
    el('p', { class: 'adm-note' }, 'Le réseau de Cal : la maison (192.168.10.x), le câble des DGX, Tailscale. Hors de lui, ',
      'un pseudo admin est refusé — c’est la seule précaution d’une porte sans mot de passe.'),
    el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'un compte neuf ouvre'),
      seg([['studio', 'le Studio (phase d’essai)'], ['apps', 'les Apps seulement']], s.new_access, 'new_access')),
    el('p', { class: 'adm-note' }, 'Ajouté ici, accepté, ou créé par la porte. Les comptes qui existent gardent le leur : ',
      'Apps ou Studio se règle par personne, plus bas. Un compte Apps ouvre les Apps et Asset, et peut demander le Studio.'),
    el('span', { class: 'lbl' }, 'quotas par défaut d’un·e ami·e — vide : sans limite'),
    el('div', { class: 'qfs' },
      qf('simultanés', s.quotas.running, 'sans limite', (v) => set({ quotas: { running: v } })),
      qf('en file', s.quotas.queued, 'sans limite', (v) => set({ quotas: { queued: v } })),
      qf('par jour', s.quotas.per_day, 'sans limite', (v) => set({ quotas: { per_day: v } })),
      qf('total en file, tous', s.total_queued, 'sans limite', (v) => set({ total_queued: v }))));
}

async function paintDevices(u, box) {
  try {
    const { devices } = await api(`admin/users/${u.id}/devices`);
    box.replaceChildren(...(devices.length ? devices.map((d) => el('div', { class: 'acct-dev' },
      el('span', { class: 'ua', title: d.ua }, `${uaShort(d.ua)} · ${d.ip || ''}`),
      el('span', { class: 'lbl' }, `vu ${fmtDate(d.seen)}`),
      el('button', { class: 'tb ghost sm', onclick: async () => {
        try { await post(`admin/users/${u.id}/devices/${d.id}/revoke`); toast('connexion fermée : ce navigateur devra retaper le pseudo'); paintDevices(u, box); } catch (e) { toast(e.message); }
      } }, 'Fermer'))) : [el('p', { class: 'lbl' }, 'aucune connexion')]));
  } catch (e) { box.replaceChildren(el('p', { class: 'warn' }, e.message)); }
}

function personne(u) {
  const adm = u.role === 'admin';
  const def = S.state.settings.quotas;
  const setQ = (k, label) => (v) => {
    const was = u.quotas[k] ?? null;
    return undoable(`changer le quota « ${label} » de ${u.name}`, () => post(`admin/users/${u.id}`, { quotas: { [k]: v } }),
      () => post(`admin/users/${u.id}`, { quotas: { [k]: was } }), `${u.name} · ${label} : ${v ?? 'par défaut'}`);
  };
  const devBox = el('div', { class: 'acct-list', hidden: true });
  const susp = u.state === 'suspended';
  const nAdm = S.state.users.filter((x) => x.role === 'admin' && x.state === 'active').length;
  const lastAdm = adm && nAdm <= 1;
  return el('div', { class: 'card' + (susp ? ' off' : '') },
    el('div', { class: 'card-head' }, el('span', { class: 'nm' }, u.name),
      adm ? el('span', { class: 'chip adm-role' }, 'admin') : el('span', { class: 'chip' }, 'ami·e'),
      susp ? el('span', { class: 'chip err' }, el('i'), 'suspendu') : el('span', { class: 'chip ok' }, el('i'), 'actif'),
      u.studio_asked ? el('span', { class: 'chip amb' }, el('i'), 'studio demandé') : null),
    // Apps ou Studio : le droit `access` (un admin a toujours le Studio) ; s'annule (Ctrl+Z) comme le rôle
    adm || u.role === 'invite' ? null : el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'ouvre'),
      el('div', { class: 'seg', role: 'group', 'aria-label': `ce qu’ouvre ${u.name}`, 'data-access': u.id },
        ...[['apps', 'Apps'], ['studio', 'Studio']].map(([v, lab]) => el('button', { class: 'tb' + (u.access === v ? ' on' : ''), type: 'button',
          'aria-pressed': u.access === v ? 'true' : 'false', disabled: susp || null,
          onclick: () => { if (u.access !== v) setAccess(u, v); } }, lab)))),
    // ses Teams ; un guest : viewer ou acteur se règle ici (décision 2 de Cal, 30/09)
    u.role === 'invite' ? null : teamLine(u),
    el('div', { class: 'cmeta' }, 'pseudo ', el('b', {}, u.pseudo || u.name), ` · entré ${fmtDate(u.accepted || u.created)} · vu ${u.seen ? fmtDate(u.seen) : 'jamais'} · `,
      el('b', {}, plural(u.devices, 'connexion', 'connexions'))),
    el('div', { class: 'cmeta' }, el('b', {}, `${u.running} en cours · ${u.queued} en file · ${u.today} aujourd’hui`),
      ` · ${plural(u.items, 'objet', 'objets')} dans la bibliothèque`),
    adm ? el('p', { class: 'adm-note' }, 'Admin : le Studio, pas de quota, la page d’admin, entre depuis le réseau de Cal.') : el('div', { class: 'qfs' },
      qf('simultanés', u.quotas.running, `défaut ${def.running ?? '∞'}`, setQ('running', 'simultanés')),
      qf('en file', u.quotas.queued, `défaut ${def.queued ?? '∞'}`, setQ('queued', 'en file')),
      qf('par jour', u.quotas.per_day, `défaut ${def.per_day ?? '∞'}`, setQ('per_day', 'par jour'))),
    u.recent.length ? el('div', { class: 'cmeta' }, 'lancé dernièrement : ',
      ...u.recent.slice(0, 4).map((j, i) => el('b', {}, `${i ? ' · ' : ''}${j.title} (${stateFr(j.state)})`))) : null,
    el('div', { class: 'row' },
      el('button', { class: 'tb ghost sm', onclick: () => { devBox.hidden = !devBox.hidden; if (!devBox.hidden) paintDevices(u, devBox); } }, 'Connexions'),
      susp ? null : el('button', { class: 'tb ghost sm', disabled: lastAdm,
        title: lastAdm ? 'le dernier admin garde son rôle : donne-le d’abord à quelqu’un d’autre' : '',
        onclick: () => undoable(adm ? `retirer le rôle admin à ${u.name}` : `donner le rôle admin à ${u.name}`,
          () => post(`admin/users/${u.id}`, { role: adm ? 'ami' : 'admin' }), () => post(`admin/users/${u.id}`, { role: adm ? 'admin' : 'ami' }),
          adm ? `${u.name} n’est plus admin` : `${u.name} est admin`) }, adm ? 'Retirer le rôle admin' : 'Donner le rôle admin'),
      adm ? null : el('button', { class: 'tb ghost sm', onclick: () => act(() => post(`admin/users/${u.id}`, { state: susp ? 'active' : 'suspended' }),
        susp ? `${u.name} peut revenir` : `${u.name} suspendu·e : ses travaux en file sont retirés`) }, susp ? 'Réactiver' : 'Suspendre'),
      // détruire : le compte, ses connexions et ses places dans les Teams ; ce qu'il a rangé reste dans les Workspaces
      adm ? null : el('button', { class: 'tb ghost sm', type: 'button', title: 'détruit le compte : son pseudo redevient libre (ce qu’il a rangé reste dans les Workspaces)',
        onclick: () => confirmBox(`Supprimer ${u.name} ?`,
          'Le compte, ses connexions et sa place dans les Teams disparaissent, et son pseudo redevient libre. Ce qu’il a rangé reste dans les Workspaces. Ça ne s’annule pas.',
          'Supprimer', () => act(() => post(`admin/users/${u.id}/supprimer`), `${u.name} supprimé·e`)) }, 'Supprimer')),
    lastAdm ? el('p', { class: 'why' }, 'dernier admin : son rôle ne se retire pas') : null,
    devBox);
}

function personnes() {
  const us = S.state.users;
  return [head('Personnes', 'B', plural(us.length, 'compte', 'comptes')), reglages(), manyDelete(us),
    el('div', { class: 'grid2' }, ...us.map(personne))];
}

// Supprimer plusieurs comptes d'un coup (Cal, 09/10 : « on enlève tous les derniers logins qu'on a créés pour
// l'atelier avec les étudiants, on a fini ») : on coche, puis chacun passe par le même chemin que « Supprimer »
// (son compte, ses connexions, ses places dans les Teams, ses travaux en file ; ce qu'il a rangé reste dans les
// Workspaces), l'un après l'autre ; un refus dit pourquoi et n'arrête pas les suivants. « Créés par une Team » :
// les pseudos mis dans une Team par son admin (auth.create_invited, `via: equipe`) — ceux d'un atelier.
const VIA_FR = { equipe: 'par une Team', admin: 'par Cal' };
function manyDelete(us) {
  const D = S.del ||= { open: false, sel: [], run: false, out: null };
  const can = us.filter((u) => u.role !== 'admin' && u.state !== 'pending');
  const viaTeam = can.filter((u) => u.via === 'equipe').map((u) => u.id);
  const head2 = el('div', { class: 'card-head' }, el('span', { class: 'nm' }, 'Supprimer plusieurs comptes'), el('span', { class: 'sp' }),
    el('button', { class: 'tb ghost sm', type: 'button', 'aria-expanded': D.open ? 'true' : 'false', disabled: D.run || null,
      onclick: () => { D.open = !D.open; render(true); } }, D.open ? 'Fermer' : 'Ouvrir'));
  if (!D.open) return el('div', { class: 'card many-del' }, head2);
  D.sel = D.sel.filter((id) => can.some((u) => u.id === id));
  const pick = (ids) => { D.sel = ids; render(true); };
  const n = D.sel.length;
  const go = () => {
    const names = can.filter((u) => D.sel.includes(u.id)).map((u) => u.pseudo || u.name);
    confirmBox(`Supprimer ${plural(n, 'compte', 'comptes')}`,
      `${names.join(', ')}. Les comptes, leurs connexions et leurs places dans les Teams disparaissent, leurs pseudos redeviennent libres ; ce qu’ils ont rangé reste dans les Workspaces.`,
      `Supprimer ${n}`, async () => {
        D.run = true; D.out = can.filter((u) => D.sel.includes(u.id)).map((u) => ({ id: u.id, name: u.pseudo || u.name, st: 'wait', msg: '' }));
        render(true);
        for (const row of D.out) {
          row.st = 'run'; render(true);
          try { await post(`admin/users/${row.id}/supprimer`); row.st = 'gone'; } catch (e) { row.st = 'err'; row.msg = e.message; }
        }
        D.run = false;
        const k = (s) => D.out.filter((x) => x.st === s).length;
        D.sel = D.out.filter((x) => x.st === 'err').map((x) => x.id);
        toast(`${plural(k('gone'), 'compte supprimé', 'comptes supprimés')}${k('err') ? `, ${k('err')} refusé${k('err') > 1 ? 's' : ''}` : ''}`, 6000);
        refresh(true);
      });
  };
  const ST = { wait: ['no', 'en attente'], run: ['run', 'en cours'], gone: ['ok', 'supprimé'], err: ['err', 'refusé'] };
  return el('div', { class: 'card many-del' }, head2,
    el('p', { class: 'adm-note' }, 'Coche les comptes à supprimer. Ce qu’ils ont rangé reste dans les Workspaces ; un admin ne se supprime pas d’ici.'),
    el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'cocher'),
      el('button', { class: 'tb ghost sm', type: 'button', disabled: D.run || !viaTeam.length || null,
        title: viaTeam.length ? 'les pseudos qu’un admin de Team a créés (un atelier)' : 'aucun compte créé par une Team',
        onclick: () => pick([...new Set([...D.sel, ...viaTeam])]) }, `créés par une Team · ${viaTeam.length}`),
      el('button', { class: 'tb ghost sm', type: 'button', disabled: D.run || !n || null, onclick: () => pick([]) }, 'aucun'),
      el('span', { class: 'sp' }),
      el('button', { class: 'tb', type: 'button', disabled: D.run || !n || null, title: n ? '' : 'coche d’abord des comptes', onclick: go },
        n ? `Supprimer les ${n}` : 'Supprimer')),
    el('div', { class: 'many-list', role: 'group', 'aria-label': 'les comptes à supprimer' }, ...can.map((u) => {
      const on = D.sel.includes(u.id);
      const tms = (S.teams && S.teams.everyone ? S.teams.teams : []).filter((t) => !t.personal && (t.members || []).some((m) => m.id === u.id)).map((t) => t.name);
      return el('label', { class: 'many-row' + (on ? ' on' : '') },
        el('input', { type: 'checkbox', checked: on || null, disabled: D.run || null,
          onchange: (e) => pick(e.target.checked ? [...D.sel, u.id] : D.sel.filter((x) => x !== u.id)) }),
        el('span', { class: 'nm-s' }, u.pseudo || u.name),
        el('span', { class: 'many-meta' }, [`créé ${fmtDate(u.created)}`, VIA_FR[u.via] || '', tms.join(' · ')].filter(Boolean).join(' · ')));
    })),
    D.out ? el('div', { class: 'bulk-out', role: 'status', 'aria-live': 'polite' }, ...D.out.map((x) => el('div', { class: 'row' },
      el('span', { class: 'chip ' + ST[x.st][0] }, el('i'), ST[x.st][1]), el('span', { class: 'nm-s' }, x.name),
      x.msg ? el('span', { class: 'bulk-why' }, x.msg) : null))) : null);
}

// ── C · les Teams ───────────────────────────────────────────
// Teams et Workspaces (core/espaces.py, docs/etudes/equipes_espaces.md) : une Team décide
// et paie, ses Workspaces possèdent ce qu'on y crée. Rôles de Team : propriétaire, admin,
// membre, guest ; un guest n'entre que dans les Workspaces où on le met, et il est
// « viewer » (voit) ou « acteur » (modifie) — décision 2 de Cal ; il ne calcule jamais.
// Le serveur juge chaque geste : un bouton grisé dit pourquoi (son titre, et la ligne dessous).
const TR = { owner: 'propriétaire', admin: 'admin', member: 'membre', guest: 'guest' };
const WR = { admin: 'admin', editor: 'éditeur', commenter: 'commentateur', viewer: 'lecteur', none: 'sur invitation' };
const GM = [['viewer', 'viewer · voit'], ['acteur', 'acteur · modifie']];
const HOURS_FR = { 24: '24 h', 72: '3 jours', 168: '7 jours', 720: '30 jours' };
const RIGHTS = [['view', 'voir'], ['comment', 'commenter'], ['edit', 'modifier'], ['compute', 'calculer'], ['publish', 'publier'], ['invite', 'inviter']];
const isCal = () => !S.limited && !!S.state;
const tf = (t) => (S.tf[t.id] ||= { pseudo: '', role: 'member', guest: 'viewer', spaces: [], irole: 'guest', iguest: 'viewer', ispaces: [], hours: 72, name: '', ws: '', ren: null });
const segOf = (opts, cur, pick, { label = '', why = {} } = {}) => el('div', { class: 'seg', role: 'group', 'aria-label': label },
  ...opts.map(([v, lab]) => el('button', { class: 'tb' + (cur === v ? ' on' : ''), type: 'button', 'aria-pressed': cur === v ? 'true' : 'false',
    disabled: why[v] ? true : null, title: why[v] || '', onclick: () => { if (cur !== v) pick(v); } }, lab)));
const wsToggles = (t, cur, pick, label) => el('div', { class: 'seg wrap', role: 'group', 'aria-label': label },
  ...t.spaces.filter((s) => !s.archived).map((s) => el('button', { class: 'tb sm' + (cur.includes(s.id) ? ' on' : ''), type: 'button',
    'aria-pressed': cur.includes(s.id) ? 'true' : 'false',
    onclick: () => pick(cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]) }, s.name)));

// ce que la personne peut faire dans un Workspace : une pastille par droit ; ce qui manque dit pourquoi
function rights(sp) {
  const lack = RIGHTS.filter(([k]) => !sp.can[k]);
  const why = [...new Set(lack.map(([k]) => sp.why[k]).filter(Boolean))];
  return [el('div', { class: 'ws-rights', 'aria-label': 'tes droits ici' }, ...RIGHTS.map(([k, lab]) =>
    el('span', { class: 'chip ' + (sp.can[k] ? 'ok' : 'no'), title: sp.can[k] ? '' : (sp.why[k] || '') }, el('i'), lab))),
  why.length && (!sp.can.edit || !sp.can.compute) ? el('p', { class: 'why' }, why.slice(0, 2).join(' · ')) : null];
}

// le mode d'un guest (décision 2) : un geste qui s'annule
function setGuestMode(t, m, to) {
  return undoable(`${m.name} : guest ${to}`, () => post(`equipes/${t.id}/membres/${m.id}`, { guest: to }),
    () => post(`equipes/${t.id}/membres/${m.id}`, { guest: m.guest }), `${m.name} est guest ${to === 'acteur' ? 'acteur : il modifie, ne calcule pas' : 'viewer : il voit seulement'}`);
}
function guestSeg(t, m) {
  const why = t.manage ? {} : { viewer: 'le propriétaire ou un admin de la Team', acteur: 'le propriétaire ou un admin de la Team' };
  return segOf(GM, m.guest, (v) => setGuestMode(t, m, v), { label: `guest ${m.name} : viewer ou acteur`, why });
}

// Personnes : la ligne « teams » d'une carte
function teamLine(u) {
  const T = S.teams && S.teams.everyone ? S.teams.teams : [];
  const rows = [];
  for (const t of T) {
    if (t.personal) continue;
    const m = (t.members || []).find((x) => x.id === u.id);
    if (m) rows.push([t, m]);
  }
  return el('div', { class: 'row adm-tm', 'data-teams-of': u.id }, el('span', { class: 'lbl' }, 'teams'),
    ...(rows.length ? rows.map(([t, m]) => (m.role === 'guest'
      ? el('span', { class: 'tm' }, el('span', { class: 'chip amb' }, `${t.name} · guest`), guestSeg(t, m))
      : el('span', { class: 'chip' }, `${t.name} · ${TR[m.role] || m.role}`))) : [el('span', { class: 'lbl' }, S.teams ? 'aucune' : '…')]),
    u.perso === false ? el('span', { class: 'chip', title: 'entré comme guest : ni Team personnelle, ni calcul' }, 'sans my team') : null);
}

function wsRow(t, sp) {
  const f = tf(t);
  const renaming = f.ren === sp.id;
  const inp = el('input', { class: 'fld sm', value: sp.name, maxlength: 40, 'aria-label': 'le nom du Workspace' });
  const title = renaming
    ? el('form', { class: 'row', onsubmit: (e) => {
      e.preventDefault(); f.ren = null;
      const v = inp.value.trim();
      if (!v || v === sp.name) return render(true);
      undoable(`renommer « ${sp.name} »`, () => post(`espaces/${sp.id}`, { name: v }), () => post(`espaces/${sp.id}`, { name: sp.name }), 'renommé');
    } }, inp, el('button', { class: 'tb sm', type: 'submit' }, 'OK'), el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { f.ren = null; render(true); } }, 'Annuler'))
    : el('span', { class: 'ws-nm' }, sp.name);
  const lastOpen = t.spaces.filter((s) => !s.archived).length <= 1 && !sp.archived;
  const noDestroy = sp.can.destroy ? '' : (sp.why.destroy || 'détruire : le propriétaire ou un admin de sa Team, ou Cal');
  return el('div', { class: 'ws' + (sp.archived ? ' off' : ''), 'data-ws': sp.id },
    el('div', { class: 'ws-l' }, title,
      el('div', { class: 'cmeta' }, `membres : ${WR[sp.default_role] || sp.default_role}`,
        t.role === 'guest' ? ` · toi : guest ${t.guest}` : sp.role ? ` · toi : ${WR[sp.role]}` : '',
        sp.archived ? ' · archivé' : '')),
    el('div', { class: 'ws-r' }, ...rights(sp)),
    t.manage ? el('div', { class: 'acts' },
      el('select', { class: 'fld sm', title: 'le rôle des membres de la Team ici', 'aria-label': `rôle par défaut dans ${sp.name}`,
        onchange: (e) => { const was = sp.default_role; const to = e.target.value;
          undoable(`rôle par défaut de « ${sp.name} » : ${WR[to]}`, () => post(`espaces/${sp.id}`, { default_role: to }), () => post(`espaces/${sp.id}`, { default_role: was })); } },
      ...Object.entries(WR).map(([v, lab]) => el('option', { value: v, selected: sp.default_role === v ? true : null }, `membres : ${lab}`))),
      renaming ? null : el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { f.ren = sp.id; render(true); setTimeout(() => inp.focus(), 0); } }, 'Renommer'),
      el('button', { class: 'tb ghost sm', type: 'button', disabled: !sp.archived && lastOpen ? true : null,
        title: !sp.archived && lastOpen ? 'le dernier Workspace ouvert de la Team ne s’archive pas : crée-en un autre d’abord' : '',
        onclick: () => undoable(sp.archived ? `rouvrir « ${sp.name} »` : `archiver « ${sp.name} »`, () => post(`espaces/${sp.id}`, { archived: !sp.archived }),
          () => post(`espaces/${sp.id}`, { archived: !!sp.archived }), sp.archived ? 'rouvert' : 'archivé : lecture seule') }, sp.archived ? 'Rouvrir' : 'Archiver'),
      // détruire (D4) : ne s'annule pas — Cal le rend depuis Admin → Stockage ; le nom tapé confirme
      el('button', { class: 'tb ghost sm', type: 'button', 'data-destroy-ws': sp.id, disabled: noDestroy ? true : null, title: noDestroy,
        onclick: () => confirmBox(`Détruire « ${sp.name} »`,
          `Le Workspace « ${sp.name} » de « ${teamName(t)} » disparaît pour tous ceux qui y entraient. Ce qu’il tient — objets, planches, projets, séquences, `
          + 'transcriptions… — part à la corbeille ; Cal peut le rendre (Admin → Stockage), tel quel, dans une My Team. Ça ne s’annule pas d’ici.',
          'Détruire', (nom) => act(() => post(`espaces/${sp.id}/detruire`, { nom }), `« ${sp.name} » détruit : son contenu est à la corbeille`),
          { typed: sp.name }) }, 'Détruire')) : null);
}

function memberRow(t, m) {
  const canAdmin = t.role === 'owner' || isCal();
  const owner = m.role === 'owner';
  const noAdmin = canAdmin ? {} : { admin: 'le rôle admin : le propriétaire de la Team, ou Cal' };
  const setRole = (to) => undoable(`${m.name} : ${TR[to]}`,
    () => post(`equipes/${t.id}/membres/${m.id}`, { role: to, ...(to === 'guest' ? { guest: 'viewer' } : {}) }),
    () => post(`equipes/${t.id}/membres/${m.id}`, { role: m.role, ...(m.role === 'guest' ? { guest: m.guest, spaces: m.spaces } : {}) }),
    `${m.name} : ${TR[to]}`);
  const role = owner ? el('span', { class: 'chip adm-role' }, 'propriétaire')
    : t.manage ? segOf([['admin', 'admin'], ['member', 'membre'], ['guest', 'guest']], m.role, setRole,
      { label: `rôle de ${m.name}`, why: m.role === 'admin' ? { member: noAdmin.admin, guest: noAdmin.admin } : noAdmin })
      : el('span', { class: 'chip' }, TR[m.role]);
  const perWs = !owner && m.role !== 'admin' && t.manage && m.role !== 'guest' ? el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'par workspace'),
    ...t.spaces.filter((s) => !s.archived).map((s) => {
      const cur = (s.members && s.members[m.id] && s.members[m.id].role) || '';
      return el('select', { class: 'fld sm', 'aria-label': `rôle de ${m.name} dans ${s.name}`,
        onchange: (e) => { const to = e.target.value || null;
          undoable(`${m.name} dans « ${s.name} » : ${to ? WR[to] : 'par défaut'}`, () => post(`espaces/${s.id}/membres/${m.id}`, { role: to }),
            () => post(`espaces/${s.id}/membres/${m.id}`, { role: cur || null })); } },
      el('option', { value: '', selected: !cur ? true : null }, `${s.name} : par défaut (${WR[s.default_role]})`),
      ...Object.entries(WR).map(([v, lab]) => el('option', { value: v, selected: cur === v ? true : null }, `${s.name} : ${lab}`)));
    })) : null;
  return el('div', { class: 'mem-row', 'data-member': m.id },
    el('div', { class: 'row' }, el('span', { class: 'nm-s' }, m.name), el('span', { class: 'lbl' }, m.pseudo !== m.name ? m.pseudo : ''),
      m.state && m.state !== 'active' ? el('span', { class: 'chip err' }, el('i'), m.state === 'suspended' ? 'suspendu' : m.state) : null,
      el('span', { class: 'sp' }), role,
      owner ? null : el('button', { class: 'tb ghost sm', type: 'button',
        disabled: !t.manage || (m.role === 'admin' && !canAdmin) ? true : null,
        title: !t.manage ? 'retirer : le propriétaire ou un admin de la Team' : m.role === 'admin' && !canAdmin ? 'retirer un admin : le propriétaire, ou Cal' : '',
        onclick: () => confirmBox(`Retirer ${m.name}`, `${m.name} quitte « ${t.name} » : il ne voit plus ses Workspaces. Ce qu’il y a fait reste à la Team. Pour le remettre : l’ajouter de nouveau.`,
          'Retirer', () => act(() => post(`equipes/${t.id}/membres/${m.id}/retirer`), `${m.name} retiré de ${t.name}`)) }, 'Retirer')),
    m.role === 'guest' ? el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'guest'), guestSeg(t, m),
      el('span', { class: 'lbl' }, 'dans'), t.manage ? wsToggles(t, m.spaces, (list) => undoable(`les Workspaces de ${m.name}`,
        () => post(`equipes/${t.id}/membres/${m.id}`, { spaces: list }), () => post(`equipes/${t.id}/membres/${m.id}`, { spaces: m.spaces })), `les Workspaces de ${m.name}`)
        : el('span', { class: 'lbl' }, t.spaces.filter((s) => m.spaces.includes(s.id)).map((s) => s.name).join(' · ') || 'aucun')) : null,
    perWs);
}

// une liste collée : un pseudo par ligne (ou séparés par des virgules), sans doublon ni ligne vide
function pseudoList(txt) {
  const seen = new Map();
  for (const s of String(txt || '').split(/[\n,;]+/)) { const v = s.trim(); if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v); }
  return [...seen.values()];
}
const BULK_ST = { wait: ['no', 'en attente'], run: ['run', 'en cours'], created: ['ok', 'créé'], in: ['fam', 'déjà inscrit'], err: ['err', 'refusé'] };

// Coller une liste (Cal, 07/10, un workshop : « plein de login… affecte les gens à la bonne team ») : chaque pseudo
// passe par le même chemin qu'« Ajouter », l'un après l'autre — créé déjà accepté s'il n'existe pas, sinon mis dans
// la Team ; un refus dit pourquoi et n'arrête pas les suivants ; ce qui est refusé reste dans le champ, à corriger.
async function addMany(t, f, list, guest) {
  f.bulkRun = true;
  f.bulkOut = list.map((p) => ({ pseudo: p, st: 'wait', msg: '' }));
  render(true);
  for (const row of f.bulkOut) {
    row.st = 'run'; render(true);
    try {
      const r = await post(`equipes/${t.id}/membres`, { pseudo: row.pseudo, role: f.role, ...(guest ? { guest: f.guest, spaces: f.spaces } : {}) });
      row.st = r.added && r.added.created ? 'created' : 'in';
      if (r.added) row.pseudo = r.added.pseudo || r.added.name || row.pseudo;
    } catch (e) { row.st = 'err'; row.msg = e.message; }
  }
  f.bulkRun = false;
  const n = (k) => f.bulkOut.filter((x) => x.st === k).length;
  f.list = f.bulkOut.filter((x) => x.st === 'err').map((x) => x.pseudo).join('\n');
  toast(`${t.name} : ${n('created')} créé${n('created') > 1 ? 's' : ''}, ${n('in')} déjà inscrit${n('in') > 1 ? 's' : ''}${n('err') ? `, ${n('err')} refusé${n('err') > 1 ? 's' : ''}` : ''}`, 6000);
  refresh(true);
}

function addForm(t) {
  const f = tf(t);
  const canAdmin = t.role === 'owner' || isCal();
  const name = el('input', { class: 'fld', placeholder: 'pseudo', maxlength: 24, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none',
    'aria-label': `le pseudo à mettre dans ${t.name}`, value: f.pseudo, oninput: (e) => { f.pseudo = e.target.value; } });
  const guest = f.role === 'guest';
  const bulkLabel = () => { const k = pseudoList(f.list).length; return k ? `Ajouter les ${k}` : 'Ajouter'; };
  const submit = el('button', { class: 'tb', type: 'submit', disabled: f.bulkRun ? true : null, title: f.bulkRun ? 'la liste passe : un pseudo après l’autre' : '' },
    f.bulk ? bulkLabel() : 'Ajouter');
  const area = f.bulk ? el('textarea', { class: 'fld bulk-list', rows: 8, spellcheck: 'false', autocapitalize: 'none', autocomplete: 'off',
    placeholder: 'un pseudo par ligne (ou séparés par des virgules)', 'aria-label': `les pseudos à mettre dans ${t.name}, un par ligne`,
    oninput: (e) => { f.list = e.target.value; submit.textContent = bulkLabel(); } }, f.list || '') : null;
  return el('form', { class: 'sub-card', 'data-add': t.id, onsubmit: (e) => {
    e.preventDefault();
    if (f.bulkRun) return;
    if (guest && !f.spaces.length) { toast('un guest n’entre que dans les Workspaces où on le met : choisis-en au moins un'); return; }
    if (f.bulk) {
      const list = pseudoList(f.list);
      if (!list.length) { area.focus(); return; }
      addMany(t, f, list, guest);
      return;
    }
    const v = name.value.trim();
    if (!v) { name.focus(); return; }
    f.pseudo = '';
    act(async () => {
      const r = await post(`equipes/${t.id}/membres`, { pseudo: v, role: f.role, ...(guest ? { guest: f.guest, spaces: f.spaces } : {}) });
      toast(r.added && r.added.created ? `« ${r.added.pseudo} » créé : il entre en tapant ce pseudo` : `${r.added ? r.added.name : v} est dans ${t.name}`, 6000);
    });
  } },
  el('div', { class: 'row' }, el('span', { class: 'lbl' }, f.bulk ? 'mettre une liste' : 'mettre quelqu’un'), f.bulk ? null : name,
    segOf([['member', 'membre'], ['guest', 'guest'], ['admin', 'admin']], f.role, (v) => { f.role = v; render(true); },
      { label: f.bulk ? 'leur rôle' : 'son rôle', why: canAdmin ? {} : { admin: 'faire un admin : le propriétaire de la Team, ou Cal' } }),
    submit,
    el('button', { class: 'tb ghost sm', type: 'button', 'aria-pressed': f.bulk ? 'true' : 'false', disabled: f.bulkRun ? true : null,
      onclick: () => { f.bulk = !f.bulk; if (!f.bulk) f.bulkOut = null; render(true); if (f.bulk) setTimeout(() => $(`[data-add="${t.id}"] .bulk-list`)?.focus(), 0); } },
      f.bulk ? 'Un seul' : 'Coller une liste')),
  area,
  f.bulk && f.bulkOut ? el('div', { class: 'bulk-out', role: 'status', 'aria-live': 'polite' }, ...f.bulkOut.map((x) => el('div', { class: 'row' },
    el('span', { class: 'chip ' + BULK_ST[x.st][0] }, el('i'), BULK_ST[x.st][1]), el('span', { class: 'nm-s' }, x.pseudo),
    x.msg ? el('span', { class: 'bulk-why' }, x.msg) : null))) : null,
  guest ? el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'guest'), segOf(GM, f.guest, (v) => { f.guest = v; render(true); }, { label: 'viewer ou acteur' }),
    el('span', { class: 'lbl' }, 'dans'), wsToggles(t, f.spaces, (l) => { f.spaces = l; render(true); }, 'ses Workspaces')) : null,
  el('p', { class: 'adm-note' }, 'Un pseudo qui n’existe pas encore est créé ici, déjà accepté : il entre en le tapant. ',
    'Un guest n’entre que dans les Workspaces choisis ; viewer, il voit ; acteur, il modifie ; il ne lance jamais de calcul, et n’a pas de My Team.'));
}

function inviteBlock(t) {
  const f = tf(t);
  const guest = f.irole === 'guest';
  const fresh = S.fresh[t.id];
  const link = fresh ? new URL(`admin/?rejoindre=${encodeURIComponent(fresh.token)}`, href('')).href : '';
  return el('div', { class: 'sub-card', 'data-invite': t.id },
    el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'un lien'),
      segOf([['member', 'membre'], ['guest', 'guest']], f.irole, (v) => { f.irole = v; render(true); }, { label: 'le rôle du lien' }),
      guest ? segOf(GM, f.iguest, (v) => { f.iguest = v; render(true); }, { label: 'viewer ou acteur' }) : null,
      segOf(Object.entries(HOURS_FR).map(([h, lab]) => [Number(h), lab]), f.hours, (v) => { f.hours = v; render(true); }, { label: 'sa durée' }),
      el('button', { class: 'tb', type: 'button', disabled: guest && !f.ispaces.length ? true : null,
        title: guest && !f.ispaces.length ? 'un guest n’entre que dans les Workspaces choisis : choisis-en au moins un' : '',
        onclick: () => act(async () => {
          S.fresh[t.id] = await post(`equipes/${t.id}/invitations`, { role: f.irole, hours: f.hours, ...(guest ? { guest: f.iguest, spaces: f.ispaces } : {}) });
        }, 'lien créé : il ne se montre qu’une fois') }, 'Créer le lien')),
    guest ? el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'dans'), wsToggles(t, f.ispaces, (l) => { f.ispaces = l; render(true); }, 'les Workspaces du lien')) : null,
    link ? el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'à envoyer'), el('b', { class: 'acct-code' }, link), el('span', { class: 'sp' }), copier(link, 'lien')) : null,
    link ? el('p', { class: 'why' }, 'Ce lien ne se montre qu’une fois. Qui l’ouvre tape son pseudo : un pseudo neuf est accepté par le lien. ',
      'Sur l’adresse publique sans code d’invitation, un pseudo neuf est refusé : ajoute-le plutôt par son pseudo, ci-dessus.') : null,
    ...(t.invites || []).map((i) => el('div', { class: 'row inv-row' },
      el('span', { class: 'chip' + (i.role === 'guest' ? ' amb' : '') }, i.role === 'guest' ? `guest · ${i.guest}` : TR[i.role]),
      el('span', { class: 'lbl' }, `${i.spaces.length ? t.spaces.filter((s) => i.spaces.includes(s.id)).map((s) => s.name).join(', ') + ' · ' : ''}jusqu’au ${fmtDate(new Date(i.exp * 1000).toISOString())} · ouvert ${i.uses} fois · par ${i.by_name}`),
      el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: () => act(() => post(`equipes/${t.id}/invitations/${i.id}/retirer`), 'lien retiré : il ne s’ouvre plus') }, 'Retirer'))));
}

// le budget de la Team (étape 8 ; décision 6) : les secondes de GPU du mois, mesurées
// (conso.jsonl) et réservées par les travaux en cours ; le plafond (vide : illimité), les
// crédits API (0 : coupée), des parts facultatives par personne et par Workspace — en heures
// ici, en secondes au serveur (/api/equipes/<t>/budget). Chaque réglage s'annule.
const fmtS = (s) => {
  s = Math.max(0, Math.round(s || 0));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
};
const hoursOf = (s) => (s == null ? '' : String(Math.round((s / 3600) * 100) / 100));
const secsOf = (v) => (v === '' || v == null ? null : Math.round(Number(v) * 3600));
const budBar = (spent, cap) => el('span', { class: 'bud-bar' + (spent >= cap ? ' full' : ''), role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100',
  'aria-valuenow': String(cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 100) },
el('span', { style: `width:${cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 100}%` }));
const budUse = (r) => `${fmtS(r.gpu_used_s)}${r.gpu_held_s ? ` + ${fmtS(r.gpu_held_s)} réservées` : ''}${r.gpu_cap_s != null ? ` / ${fmtS(r.gpu_cap_s)}` : ''}`;
function budgetBlock(t) {
  const b = t.conso;
  if (!b || !b.total) return null;
  const T = b.total;
  const line = el('div', { class: 'row bud-tot' }, el('span', { class: 'lbl' }, `gpu · ${b.month_fr}`), el('span', { class: 'bud-n' }, budUse(T)),
    T.gpu_cap_s != null ? budBar(T.gpu_used_s + T.gpu_held_s, T.gpu_cap_s) : el('span', { class: 'chip' }, 'sans plafond'),
    el('span', { class: 'sp' }),
    el('span', { class: 'chip' + (b.api_open && T.credits_cap ? ' ok' : '') }, el('i'),
      b.api_open && T.credits_cap ? `api · ${T.credits_used + T.credits_held} / ${T.credits_cap} crédits` : 'api coupée · 0 crédit'));
  if (!b.manage) {
    return [el('span', { class: 'lbl' }, 'budget'), line,
      t.manage && b.manage_why ? el('p', { class: 'why' }, b.manage_why)
        : el('p', { class: 'why' }, `le plafond et les parts : ${b.unblock} (Admin → Teams)`)];
  }
  const set0 = b.settings;
  const setB = (label, patch, before) => undoable(label, () => post(`equipes/${t.id}/budget`, patch), () => post(`equipes/${t.id}/budget`, before), 'budget enregistré');
  const num = (label, value, placeholder, step, onset) => el('label', { class: 'qf' }, el('span', { class: 'lbl' }, label),
    el('input', { class: 'fld', type: 'number', min: 0, step, value, placeholder, onchange: (e) => onset(e.target.value) }));
  const part = (key, r) => el('div', { class: 'bud-row', 'data-part': r.id },
    el('span', { class: 'nm-s' }, r.name), el('span', { class: 'lbl' }, budUse(r)),
    r.gpu_cap_s != null ? budBar(r.gpu_used_s + r.gpu_held_s, r.gpu_cap_s) : el('span'),
    el('input', { class: 'fld sm', type: 'number', min: 0, step: 0.5, value: hoursOf(r.gpu_cap_s), placeholder: 'sans part',
      'aria-label': `la part de GPU de ${r.name}, en heures par mois`,
      onchange: (e) => setB(`part de GPU de ${r.name}`, { [key]: { [r.id]: { gpu_s: secsOf(e.target.value) } } }, { [key]: { [r.id]: { gpu_s: r.gpu_cap_s } } }) }));
  return [el('span', { class: 'lbl' }, 'budget'), line,
    el('div', { class: 'qfs' },
      num('plafond gpu du mois · heures', hoursOf(set0.gpu_s), 'illimité', 0.5, (v) => setB(`plafond GPU de ${t.name}`, { gpu_s: secsOf(v) }, { gpu_s: set0.gpu_s })),
      num('crédits api du mois', String(set0.api_credits || 0), '0', 1, (v) => setB(`crédits API de ${t.name}`, { api_credits: Math.max(0, Math.round(Number(v) || 0)) }, { api_credits: set0.api_credits || 0 }))),
    el('p', { class: 'adm-note' }, 'Le budget est à la Team. Chaque calcul réserve son estimation avant de partir ; à la fin, la mesure la remplace ; ',
      'annulé ou en échec, il rend tout. Plafond vide : illimité. L’API payante reste coupée tant qu’elle n’a pas de crédits (1 crédit = 0,01 €). ',
      'Une part, par personne ou par Workspace, est facultative (vide : sans part).'),
    (b.users || []).length ? el('span', { class: 'lbl' }, 'parts · personnes') : null,
    el('div', { class: 'bud-list' }, ...(b.users || []).map((r) => part('users', r))),
    (b.spaces || []).length ? el('span', { class: 'lbl' }, 'parts · workspaces') : null,
    el('div', { class: 'bud-list' }, ...(b.spaces || []).filter((s) => !s.archived).map((r) => part('spaces', r)))];
}

// le nom d'une Team pour la page : la My Team d'un autre dit à qui elle est (chacun a la sienne, toutes nées « My Team »)
const teamName = (t) => (t.personal && t.role !== 'owner' && t.owner_name ? `${t.name} · ${t.owner_name}` : t.name);

// « Demander le Studio » (règle 7 : ce qui débloque) — la My Team d'un compte Apps n'invite personne
function askStudio() {
  const b = el('button', { class: 'tb ghost sm', type: 'button', onclick: async () => {
    b.disabled = true;
    try {
      const r = await api('auth/studio', { method: 'POST', body: {} });
      toast(r.ok ? 'tu as le Studio' : 'Studio demandé : Cal l’ouvre depuis Admin', 6000);
      refresh(true);
    } catch (e) { b.disabled = false; toast(e.message); }
  } }, 'Demander le Studio');
  return b;
}

function teamCard(t) {
  const f = tf(t);
  const canArchive = t.role === 'owner' || isCal();
  const renaming = f.ren === t.id;
  const inp = el('input', { class: 'fld sm', value: t.name, maxlength: 40, 'aria-label': 'le nom de la Team' });
  const newWs = el('input', { class: 'fld sm', placeholder: 'nouveau workspace', maxlength: 40, 'aria-label': 'le nom du nouveau Workspace',
    value: f.ws, oninput: (e) => { f.ws = e.target.value; } });
  const why = t.invite_why;
  // les membres : une Team partagée, ou une My Team qui invite (D2) ou a déjà quelqu'un
  const showMembers = t.members && (!t.personal || t.members.length > 1 || (t.manage && t.invite));
  return el('div', { class: 'card team' + (t.archived ? ' off' : ''), 'data-team': t.id },
    el('div', { class: 'card-head' },
      renaming ? el('form', { class: 'row', onsubmit: (e) => {
        e.preventDefault(); f.ren = null;
        const v = inp.value.trim();
        if (!v || v === t.name) return render(true);
        undoable(`renommer la Team « ${t.name} »`, () => post(`equipes/${t.id}`, { name: v }), () => post(`equipes/${t.id}`, { name: t.name }), 'renommée');
      } }, inp, el('button', { class: 'tb sm', type: 'submit' }, 'OK')) : el('span', { class: 'nm' }, teamName(t)),
      el('span', { class: 'chip' + (t.plan === 'studio' ? ' fam' : '') }, t.plan),
      t.personal ? el('span', { class: 'chip' }, 'personnelle') : null,
      t.role ? el('span', { class: 'chip' + (t.role === 'guest' ? ' amb' : t.role === 'owner' ? ' adm-role' : '') }, t.role === 'guest' ? `toi : guest · ${t.guest}` : `toi : ${TR[t.role]}`) : null,
      t.archived ? el('span', { class: 'chip err' }, el('i'), 'archivée') : null,
      el('span', { class: 'sp' }),
      // renommer : qui gère ; My Team, son propriétaire (ou Cal) — D1
      t.manage && !renaming ? el('button', { class: 'tb ghost sm', type: 'button', disabled: t.rename ? null : true, title: t.rename ? '' : (t.rename_why || ''),
        onclick: () => { f.ren = t.id; render(true); setTimeout(() => inp.focus(), 0); } }, 'Renommer') : null,
      t.manage && !t.personal ? el('button', { class: 'tb ghost sm', type: 'button', disabled: canArchive ? null : true,
        title: canArchive ? '' : 'archiver une Team : son propriétaire, ou Cal',
        onclick: () => undoable(t.archived ? `rouvrir « ${t.name} »` : `archiver « ${t.name} »`, () => post(`equipes/${t.id}`, { archived: !t.archived }),
          () => post(`equipes/${t.id}`, { archived: !!t.archived }), t.archived ? 'rouverte' : 'archivée : lecture seule') }, t.archived ? 'Rouvrir' : 'Archiver') : null,
      // détruire (D4) : son propriétaire ou Cal ; grisé, il dit pourquoi (une My Team, Nirvalab, un admin de la Team)
      t.manage ? el('button', { class: 'tb ghost sm', type: 'button', 'data-destroy-team': t.id, disabled: t.destroy ? null : true, title: t.destroy ? '' : (t.destroy_why || ''),
        onclick: () => confirmBox(`Détruire la Team « ${t.name} »`,
          `« ${t.name} » et ses ${plural(t.spaces.length, 'Workspace', 'Workspaces')} disparaissent ; ${t.members ? plural(Math.max(0, t.members.length - 1), 'personne en sort', 'personnes en sortent') : 'ses membres en sortent'}, `
          + 'ses liens d’invitation ne s’ouvrent plus, son budget s’efface. Ce que ses Workspaces tiennent part à la corbeille : Cal peut rendre chacun '
          + '(Admin → Stockage) dans une My Team. Ça ne s’annule pas d’ici.',
          'Détruire', (nom) => act(() => post(`equipes/${t.id}/detruire`, { nom }), `Team « ${t.name} » détruite : son contenu est à la corbeille`),
          { typed: t.name }) }, 'Détruire') : null),
    el('div', { class: 'cmeta' }, `propriétaire `, el('b', {}, t.owner_name || '—'), ` · ${t.spaces.length} workspace${t.spaces.length > 1 ? 's' : ''}`,
      t.members ? ` · ${t.members.length} personne${t.members.length > 1 ? 's' : ''}` : ''),
    t.manage && !t.personal ? el('div', { class: 'row' },
      el('span', { class: 'lbl' }, 'api payante'),
      segOf([[false, 'coupée'], [true, 'ouverte']], t.api, (v) => undoable(v ? `ouvrir l’API à ${t.name}` : `couper l’API de ${t.name}`,
        () => post(`equipes/${t.id}`, { api: v }), () => post(`equipes/${t.id}`, { api: t.api })), { label: 'l’API payante' }),
      el('span', { class: 'lbl' }, 'offre'),
      segOf([['apps', 'Apps'], ['studio', 'Studio']], t.plan, (v) => undoable(`${t.name} : offre ${v}`, () => post(`equipes/${t.id}`, { plan: v }),
        () => post(`equipes/${t.id}`, { plan: t.plan })), { label: 'l’offre', why: isCal() ? {} : { apps: 'l’offre : Cal la règle', studio: 'l’offre : Cal la règle' } })) : null,
    ...[].concat(budgetBlock(t) || []),
    el('span', { class: 'lbl' }, 'workspaces'),
    el('div', { class: 'ws-list' }, ...t.spaces.map((sp) => wsRow(t, sp))),
    t.manage && !t.archived ? el('form', { class: 'row', onsubmit: (e) => {
      e.preventDefault();
      const v = newWs.value.trim();
      if (!v) { newWs.focus(); return; }
      f.ws = '';
      act(() => post(`equipes/${t.id}/espaces`, { name: v }), `Workspace « ${v} » créé`);
    } }, newWs, el('button', { class: 'tb sm', type: 'submit' }, '+ Workspace')) : null,
    showMembers ? el('span', { class: 'lbl' }, 'membres') : null,
    showMembers ? el('div', { class: 'mem-list' }, ...t.members.map((m) => memberRow(t, m))) : null,
    t.manage && t.invite ? addForm(t) : null,
    t.manage && t.invite ? inviteBlock(t) : null,
    !t.invite && why && (t.manage || t.personal) ? el('div', { class: 'row' }, el('p', { class: 'why' }, `inviter : ${why}`),
      t.personal && t.role === 'owner' && /Demander le Studio/.test(why) ? askStudio() : null) : null);
}

function teamsSec() {
  if (!S.teams) return [head('Teams', 'C'), el('p', { class: 'lbl' }, 'lecture…')];
  const all = S.teams.teams;
  // les miennes (ma My Team, celle d'un autre où l'on m'a mis : D2) ; les My Team des autres, que Cal voit, en bref
  const mine = all.filter((t) => !t.personal || t.member);
  const others = all.filter((t) => t.personal && !t.member);
  const f = S.tf._new ||= { name: '' };
  const nm = el('input', { class: 'fld', placeholder: 'le nom de la Team', maxlength: 40, 'aria-label': 'le nom de la nouvelle Team',
    value: f.name, oninput: (e) => { f.name = e.target.value; } });
  return [head('Teams', 'C', `${mine.length} team${mine.length > 1 ? 's' : ''}`),
    isCal() ? menageCard() : null,
    el('p', { class: 'adm-note' }, 'Une Team décide et paie ; ses Workspaces possèdent ce qu’on y crée. Chacun a la sienne, My Team ; un membre entre dans tous les ',
      'Workspaces de la Team, avec leur rôle par défaut ; un guest n’entre que dans ceux où on l’a mis, viewer (il voit) ou acteur (il modifie) — il ne lance ',
      'jamais de calcul. ', isCal() ? 'Tu vois toutes les Teams, celles de chacun comprises.' : 'Tu vois tes Teams ; celles que tu gères ont leurs réglages ici.'),
    S.teams.can_create ? el('form', { class: 'row', onsubmit: (e) => {
      e.preventDefault();
      const v = nm.value.trim();
      if (!v) { nm.focus(); return; }
      f.name = '';
      act(() => post('equipes', { name: v }), `Team « ${v} » créée, avec un Workspace « Général »`);
    } }, nm, el('button', { class: 'tb', type: 'submit' }, '+ Team'))
      : el('p', { class: 'why' }, all.some((t) => t.personal && t.role === 'owner')
        ? 'créer une Team : le Studio (ton compte ouvre les Apps) — ta My Team a ses Workspaces'
        : 'créer une Team : un compte du Studio — tu es ici comme guest : demande à Cal'),
    el('div', { class: 'grid2 wide' }, ...mine.map(teamCard)),
    others.length ? el('span', { class: 'lbl' }, `les my team des autres · ${others.length}`) : null,
    others.length ? el('div', { class: 'grid2' }, ...others.map(teamMini)) : null];
}

// la Team personnelle d'un autre (Cal les voit toutes) : en bref ; ses réglages sont à son propriétaire
function teamMini(t) {
  const n = (t.members || []).length;
  return el('div', { class: 'card team-mini', 'data-team': t.id },
    el('div', { class: 'card-head' }, el('span', { class: 'nm' }, teamName(t)),
      el('span', { class: 'chip' + (t.plan === 'studio' ? ' fam' : '') }, t.plan),
      n > 1 ? el('span', { class: 'chip' }, plural(n, 'personne', 'personnes')) : null),
    el('div', { class: 'ws-names' }, ...t.spaces.map((s) => el('span', { class: 'chip' + (s.archived ? ' no' : '') }, s.name))));
}

// un lien d'invitation de Team (admin/?rejoindre=<jeton>) : la porte d'abord (un pseudo), puis la Team ;
// une demande neuve est acceptée par le lien (qui l'a fait a vouché pour elle)
async function rejoindre(tok) {
  for (let i = 0; i < 400; i++) {
    let me = null;
    try { me = await api('auth/me'); } catch { /* le portail ne répond pas : on réessaie */ }
    if (me && (me.state === 'active' || me.state === 'pending')) {
      try {
        const r = await api(`auth/equipe/${encodeURIComponent(tok)}`, { method: 'POST', body: {} });
        toast(`bienvenue dans ${r.team_name} : ${r.role === 'guest' ? `guest ${r.guest}` : r.role_fr}`, 6000);
        setTimeout(() => location.replace(`${location.pathname}#teams`), 900);
        return;
      } catch (e) {
        if ([404, 409, 410, 403].includes(e.status)) {
          toast(e.message, 12000);
          history.replaceState(null, '', location.pathname + location.hash);
          return;
        }
      }
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
}
const joinTok = new URLSearchParams(location.search).get('rejoindre');
if (joinTok) { S.sec = 'teams'; rejoindre(joinTok); }

// ── D · la file ─────────────────────────────────────────────
const MODE_FR = { active: 'reprendre', paused: 'mettre en pause', draining: 'vidanger' };
function machineCtl(m, s) {
  const mode = s.mode;
  const label = mode === 'active' ? 'active' : mode === 'draining' ? (s.drained ? 'vidée' : 'vidange') : 'en pause';
  const to = (next, msg) => undoable(`${MODE_FR[next]} ${m}`, () => post('admin/pause', { machine: m, mode: next }), () => post('admin/pause', { machine: m, mode }), msg);
  return el('div', { class: 'row' },
    el('span', { class: 'chip ' + (mode === 'active' ? 'ok' : 'amb') }, el('i'), `${m} · ${label}`),
    mode === 'active' ? el('button', { class: 'tb ghost sm', title: 'ce qui tourne finit ; rien de neuf ne part sur cette machine',
      onclick: () => to('paused', `${m} en pause`) }, 'Pause') : null,
    mode === 'active' ? el('button', { class: 'tb ghost sm', title: 'finir ce qui tourne, puis ne plus rien prendre (avant de l’éteindre)',
      onclick: () => to('draining', `${m} en vidange`) }, 'Vidanger') : null,
    mode !== 'active' ? el('button', { class: 'tb ghost sm', onclick: () => to('active', `${m} reprend`) }, 'Reprendre') : null);
}

// la place d'un travail dans sa voie, pour la lui rendre : le suivant, ou la fin
function nextInLane(id) {
  const q = S.state.queue.queued;
  const me = q.find((j) => j.id === id);
  if (!me) return null;
  const lane = q.filter((j) => j.lane === me.lane);
  const k = lane.findIndex((j) => j.id === id);
  return lane[k + 1] ? { before: lane[k + 1].id } : { to_end: true };
}
const titleOfJob = (id) => S.state.queue.queued.find((j) => j.id === id)?.title || 'un travail';
function moveJob(id, body, msg) {
  const back = nextInLane(id);
  const lab = body.to_end ? `mettre « ${titleOfJob(id)} » en fin de voie` : `déplacer « ${titleOfJob(id)} » dans la file`;
  if (!back) return act(() => post(`admin/queue/${id}`, body), msg);
  return undoable(lab, () => post(`admin/queue/${id}`, body), () => post(`admin/queue/${id}`, back), msg);
}

function dragify(row) {
  row.addEventListener('dragstart', (e) => {
    S.drag = row.dataset.id; S.dragLane = row.dataset.lane;
    row.classList.add('drag');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.dataset.id);
  });
  row.addEventListener('dragend', () => {
    S.drag = null; row.classList.remove('drag');
    $$('.qr.over, .q-end.over').forEach((n) => n.classList.remove('over'));
  });
  row.addEventListener('dragover', (e) => {
    if (!S.drag || S.drag === row.dataset.id || S.dragLane !== row.dataset.lane) return;
    e.preventDefault(); row.classList.add('over');
  });
  row.addEventListener('dragleave', () => row.classList.remove('over'));
  row.addEventListener('drop', (e) => {
    e.preventDefault(); row.classList.remove('over');
    const id = S.drag; S.drag = null;
    if (id && id !== row.dataset.id) moveJob(id, { before: row.dataset.id }, 'déplacé');
  });
}

function endZone(lane) {
  const z = el('div', { class: 'q-end', 'data-lane': lane }, el('span', { class: 'lbl' }, 'déposer ici : en fin de voie'));
  z.addEventListener('dragover', (e) => { if (S.drag && S.dragLane === lane) { e.preventDefault(); z.classList.add('over'); } });
  z.addEventListener('dragleave', () => z.classList.remove('over'));
  z.addEventListener('drop', (e) => {
    e.preventDefault(); z.classList.remove('over');
    const id = S.drag; S.drag = null;
    if (id) moveJob(id, { to_end: true }, 'en fin de voie');
  });
  return z;
}

const WAITING = /^(attend|mémoire|en attente|file en pause|laissé)/;

function qrow(j, i) {
  const running = j.state === 'running';
  const pr = j.priority ?? 0;
  const eta = !running && j.eta_s != null ? ` · départ ≈ ${fmtWait(j.eta_s)}` : '';
  const est = j.est_s ? ` · dure ≈ ${fmtWait(j.est_s)}` : '';
  const text = running ? `en cours · ${j.machine || ''} · ${j.message || ''}` : (j.message || 'en file');
  const row = el('div', { class: 'qr' + (running ? ' run' : '') + (j.top ? ' top' : ''), 'data-id': j.id, 'data-lane': j.lane,
    draggable: running ? null : 'true' },
    el('span', { class: 'grip', title: running ? '' : 'glisser pour déplacer' }, running ? '' : '⋮⋮'),
    el('span', { class: 'pos' }, running ? '▸' : String(j.position || i + 1)),
    el('span', { class: 'th', style: j.thumb ? { backgroundImage: `url(${href(j.thumb)})` } : null }),
    el('div', { style: { minWidth: 0 } }, el('div', { class: 't', title: j.title }, j.title),
      el('div', { class: 's ' + (running ? 'run' : WAITING.test(j.message || '') ? 'amb' : ''), title: text }, text + eta + est)),
    el('div', { class: 'who' }, el('span', { class: 'chip' }, j.owner_name || 'système'),
      j.family && j.family !== '?' ? el('span', { class: 'chip fam', title: j.gpu ? 'passe par ComfyUI' : 'moteur factice : rien de chargé' }, j.family) : null,
      el('span', { class: 'chip' }, j.lane)),
    el('div', { class: 'acts' },
      running ? null : el('div', { class: 'seg', role: 'group', 'aria-label': 'priorité' }, ...[[1, '↑', 'haute'], [0, '=', 'normale'], [-1, '↓', 'basse']].map(([p, s, lab]) =>
        el('button', { class: 'tb' + (pr === p ? ' on' : ''), title: `priorité ${lab}`,
          onclick: () => (pr === p ? null : undoable(`donner la priorité ${lab} à « ${j.title} »`, () => post(`admin/queue/${j.id}`, { priority: p }),
            () => post(`admin/queue/${j.id}`, { priority: pr }))) }, s))),
      running ? null : el('button', { class: 'tb ghost sm' + (j.top ? ' on' : ''), title: j.top ? 'ne plus épingler' : 'épingler en tête de la file',
        onclick: () => undoable(j.top ? `désépingler « ${j.title} »` : `épingler « ${j.title} » en tête`, () => post(`admin/queue/${j.id}`, { top: !j.top }),
          () => post(`admin/queue/${j.id}`, { top: !!j.top })) }, j.top ? 'épinglé' : 'en tête'),
      el('button', { class: 'tb ghost sm', onclick: () => act(() => post(`jobs/${j.id}/cancel`), running ? 'arrêt demandé' : 'retiré de la file') },
        running ? 'Arrêter' : 'Annuler')),
    running ? el('div', { class: 'bar' }, el('i', { style: { width: j.progress != null ? `${Math.round(j.progress * 100)}%` : '100%',
      opacity: j.progress != null ? 1 : 0.35 } })) : null);
  if (!running) dragify(row);
  // le clic droit sur un travail : les mêmes gestes que ses boutons
  row._menu = () => [{ head: `${running ? 'en cours' : 'en file'} · ${j.title}` },
    ...(running ? [] : [[1, 'haute'], [0, 'normale'], [-1, 'basse']].map(([p, lab]) => ({ label: `Priorité ${lab}`, checked: pr === p,
      onclick: () => (pr === p ? null : undoable(`donner la priorité ${lab} à « ${j.title} »`, () => post(`admin/queue/${j.id}`, { priority: p }), () => post(`admin/queue/${j.id}`, { priority: pr }))) }))),
    running ? null : { label: j.top ? 'Ne plus épingler' : 'Épingler en tête', icon: '⤒',
      onclick: () => undoable(j.top ? `désépingler « ${j.title} »` : `épingler « ${j.title} » en tête`, () => post(`admin/queue/${j.id}`, { top: !j.top }), () => post(`admin/queue/${j.id}`, { top: !!j.top })) },
    running ? null : { label: 'En fin de voie', icon: '⤓', onclick: () => moveJob(j.id, { to_end: true }, 'en fin de voie') },
    '-',
    { label: running ? 'Arrêter' : 'Retirer de la file', icon: '■', danger: true, sub: 'ne s’annule pas', onclick: () => act(() => post(`jobs/${j.id}/cancel`), running ? 'arrêt demandé' : 'retiré de la file') }];
  return row;
}

function file() {
  const q = S.state.queue;
  const lanes = {};
  for (const j of q.queued) (lanes[j.lane] ||= []).push(j);
  const out = [head('La file des calculs', 'D',`${q.running.length} en cours · ${q.queued.length} en file`),
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('span', { class: 'nm' }, q.paused ? 'La file est en pause' : 'La file tourne'),
        q.paused ? el('span', { class: 'chip amb' }, el('i'), 'pause') : el('span', { class: 'chip ok' }, el('i'), 'active'),
        el('span', { class: 'sp' }),
        q.paused ? el('button', { class: 'tb go', onclick: () => undoable('reprendre la file', () => post('admin/pause', { mode: 'active' }), () => post('admin/pause', { mode: 'paused' }), 'la file reprend') }, 'Reprendre la file')
          : el('button', { class: 'tb ghost', onclick: () => undoable('mettre la file en pause', () => post('admin/pause', { mode: 'paused' }), () => post('admin/pause', { mode: 'active' }), 'file en pause : ce qui tourne finit') }, 'Mettre la file en pause')),
      el('div', { class: 'row' }, ...Object.entries(q.machines).map(([m, s]) => machineCtl(m, s))),
      el('p', { class: 'adm-note' }, 'L’ordre de départ : les travaux épinglés en tête, puis la priorité, puis le tourniquet entre les personnes. ',
        'Glisse une rangée pour la déplacer dans sa voie. Une pause laisse finir ce qui tourne ; les travaux sur le processeur du portail ',
        '(montage, analyse) ne s’arrêtent qu’avec toute la file.'))];
  out.push(el('div', { class: 'q-lane' }, 'en cours', el('span', { class: 'n' }, String(q.running.length))));
  out.push(el('div', { class: 'q' }, ...(q.running.length ? q.running.map(qrow) : [el('p', { class: 'lbl' }, 'rien ne tourne')])));
  if (!q.queued.length) out.push(el('div', { class: 'q-lane' }, 'en file', el('span', { class: 'n' }, '0')), el('p', { class: 'lbl' }, 'la file est vide'));
  for (const [lane, list] of Object.entries(lanes)) {
    out.push(el('div', { class: 'q-lane' }, `en file · voie ${lane}`, el('span', { class: 'n' }, String(list.length))));
    out.push(el('div', { class: 'q' }, ...list.map(qrow), endZone(lane)));
  }
  if (q.done.length) {
    out.push(el('div', { class: 'q-lane' }, 'fini récemment', el('span', { class: 'n' }, String(q.done.length))));
    out.push(el('div', { class: 'q' }, ...q.done.slice(0, 12).map((j) => el('div', { class: 'qr' },
      el('span'), el('span', { class: 'pos' }, ''), el('span', { class: 'th', style: j.thumb ? { backgroundImage: `url(${href(j.thumb)})` } : null }),
      el('div', { style: { minWidth: 0 } }, el('div', { class: 't' }, j.title),
        el('div', { class: 's ' + (j.state === 'done' ? 'ok' : j.state === 'error' ? 'err' : '') }, `${stateFr(j.state)} · ${j.machine || ''} · ${j.message || ''}`)),
      el('div', { class: 'who' }, el('span', { class: 'chip' }, j.owner_name || 'système'), j.family && j.family !== '?' ? el('span', { class: 'chip fam' }, j.family) : null),
      el('div', { class: 'acts' }, el('button', { class: 'tb ghost sm', onclick: () => act(() => post(`jobs/${j.id}/retry`), 'relancé') }, 'Relancer'))))));
  }
  return out;
}

// ── D · les machines ────────────────────────────────────────
const loadedLabel = (v) => (v === null || v === undefined ? 'inconnu (vidée au prochain travail)' : v === '' ? 'rien (vidée)' : v);

function instRow(inst) {
  const busyBy = inst.items.filter((it) => it.who !== 'la file du portail');
  const why = !inst.up ? 'elle ne répond pas' : inst.items.length ? 'elle calcule : on ne décharge pas sous un travail' : '';
  return el('div', { class: 'inst' },
    el('span', { class: 'port' }, `:${inst.port}`),
    el('div', { style: { minWidth: 0 } },
      el('div', { class: 'lbl' }, `${inst.lanes.join(' · ') || 'hors des voies'} · ${inst.up ? 'répond' : 'ne répond pas'}${inst.free_gb != null ? ` · ${inst.free_gb} Go libres` : ''}`),
      el('div', { class: 'lbl' }, `chargé : ${loadedLabel(inst.loaded)}`),
      inst.running.length ? el('div', { class: 'lbl' }, `la file : ${inst.running.join(', ')}`) : null,
      busyBy.length ? el('div', { class: 'why' }, busyBy.map((it) => `${it.who} · ${it.state === 'running' ? 'calcule' : 'en attente'}`).join(' · ')) : null,
      ...Object.entries(inst.takes || {}).map(([lane, t]) => el('div', { class: 'lbl' },
        `voie ${lane} : ${t.job ? `prendrait « ${t.job} »` : (t.why || 'rien à prendre')}`))),
    el('button', { class: 'tb ghost sm', disabled: !!why, title: why || 'décharger ses modèles (/free) : la file vide est la seule condition',
      onclick: () => act(() => post('admin/instances/free', { url: inst.url }), `:${inst.port} vidée`) }, 'Décharger'));
}

function machineCard(m) {
  const pct = m.total_gb ? Math.round(100 * (m.total_gb - (m.free_gb || 0)) / m.total_gb) : 0;
  const ol = m.ollama || {};
  return el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('span', { class: 'nm' }, m.name), el('span', { class: 'sp' }),
      machineCtl(m.name, m)),
    el('div', { class: 'mem' }, el('span', { class: 'lbl' }, m.total_gb ? `mémoire : ${m.free_gb} Go libres sur ${m.total_gb}` : 'mémoire : pas de relevé'),
      el('div', { class: 'bar' }, el('i', { style: { width: `${pct}%` } }))),
    ...m.instances.map(instRow),
    ol.url ? el('div', { class: 'inst' }, el('span', { class: 'port' }, 'ollama'),
      el('div', { class: 'lbl' }, ol.up ? (ol.models.length ? ol.models.map((x) => `${x.name} · ${x.size_gb} Go`).join(' · ') : 'aucun modèle de texte chargé') : 'ne répond pas'),
      el('div', { class: 'row' }, ...(ol.models || []).map((x) => el('button', { class: 'tb ghost sm', title: `décharger ${x.name} (keep_alive 0) : il se recharge à la prochaine conversation`,
        onclick: () => act(() => post('admin/ollama/unload', { machine: m.name, model: x.name }), `${x.name} déchargé`) }, 'Décharger')))) : null);
}

function h3Card(h3) {
  if (!h3) return null;
  if (h3.error) return el('div', { class: 'card' }, el('span', { class: 'nm' }, 'H3'), el('p', { class: 'warn' }, h3.error));
  const off = h3.engine !== 'h3';
  return el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('span', { class: 'nm' }, 'H3 · vidéo'),
      el('span', { class: 'chip ' + (off ? '' : 'ok') }, el('i'), off ? 'moteur factice' : 'câblé')),
    off ? el('p', { class: 'adm-note' }, 'H3 n’est pas câblé (Câblage → movie_engine = h3) : rien ne le démarre, les vidéos sont d’essai.') :
      // le câblage de Cal (30/09) : la voie h3 = les ComfyUI :8188 des deux DGX, toujours allumés ; une instance
      // ComfyUI-H3TEST (:8189, « managed ») n'est démarrée et arrêtée par le portail que si la voie en déclare une
      el('p', { class: 'adm-note' }, (h3.instances || []).some((i) => i.managed)
        ? `Démarré à la demande, arrêté après ${h3.idle_minutes} min sans rendu ; ${h3.min_free_gb} Go libres exigés avant un rendu.`
        : `Sur les ComfyUI de la voie h3, toujours allumés : le portail ne les démarre ni ne les arrête ; ${h3.min_free_gb} Go libres exigés avant un rendu (sinon il décharge les autres modèles de la machine).`),
    ...(h3.instances || []).map((i) => !i.managed ? el('div', { class: 'inst' }, el('span', { class: 'port' }, i.machine),
      el('div', { class: 'lbl' }, [`ComfyUI :${i.port} · toujours allumé`, i.up ? '' : 'ne répond pas',
        i.free_gb != null ? `${i.free_gb} Go libres` : '', i.busy ? 'calcule' : ''].filter(Boolean).join(' · '))) :
      el('div', { class: 'inst' }, el('span', { class: 'port' }, i.machine),
      el('div', { class: 'lbl' }, [i.up ? 'démarré' : i.starting_for != null ? `démarre depuis ${i.starting_for} s` : 'arrêté',
        i.free_gb != null ? `${i.free_gb} Go libres` : '', i.busy ? 'calcule' : '', i.stops_in != null ? `s’arrête dans ${fmtWait(i.stops_in)}` : '',
        i.error || ''].filter(Boolean).join(' · ')),
      el('div', { class: 'row' },
        el('button', { class: 'tb ghost sm', disabled: i.up, onclick: () => act(() => post('movie/h3/start', { endpoint: i.url }), `H3 démarre sur ${i.machine}`) }, 'Démarrer'),
        el('button', { class: 'tb ghost sm', disabled: !i.up || i.busy, title: i.busy ? 'il calcule : on ne l’arrête pas en plein rendu' : '',
          onclick: () => act(() => post('movie/h3/stop', { endpoint: i.url }), `H3 arrêté sur ${i.machine}`) }, 'Arrêter')))));
}

function cfCard(cf, relay) {
  const run = cf.running;
  return el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('span', { class: 'nm' }, 'Studio Character Factory'),
      el('span', { class: 'chip ' + (cf.up ? 'ok' : 'err') }, el('i'), cf.up ? 'répond' : 'ne répond pas')),
    el('p', { class: 'adm-note' }, 'Sa propre file, sur DGX1 (lecture seule ici). Quand il calcule sur une machine, la file du portail y attend.'),
    cf.up ? el('dl', { class: 'kv2' },
      el('dt', {}, 'en cours'), el('dd', {}, run ? `${run.label || run.action} · ${run.slug}${run.message ? ' · ' + run.message : ''}` : 'rien'),
      el('dt', {}, 'en file'), el('dd', {}, String(cf.queued)),
      ...cf.jobs.slice(0, 5).flatMap((j) => [el('dt', {}, stateFr(j.status)), el('dd', {}, `${j.label || j.action} · ${j.slug}${j.auto ? ' · autopilote' : ''}`)]))
      : el('p', { class: 'lbl' }, cf.why || ''),
    el('div', { class: 'row' }, el('span', { class: 'chip ' + (relay.up ? 'ok' : 'err') }, el('i'), `relais ${relay.url || ''} · ${relay.up ? 'répond' : 'ne répond pas'}`),
      el('span', { class: 'sp' }), el('a', { class: 'tb ghost sm', href: href('character/') }, 'Ouvrir le studio')));
}

function machinesSec() {
  const M = S.mach;
  if (!M) return [head('Les machines', 'E'), el('p', { class: 'lbl' }, 'relevé des machines…')];
  const fam = Object.entries(M.families.gb || {}).map(([k, v]) => `${k} ${v} Go`).join(' · ');
  return [head('Les machines', 'E', M.paused ? 'file en pause' : ''),
    el('div', { class: 'grid2 wide' }, ...M.machines.map(machineCard), h3Card(M.h3), cfCard(M.cf, M.relay)),
    el('div', { class: 'card' }, el('span', { class: 'nm' }, 'Les règles de la file'),
      el('p', { class: 'adm-note' }, `Un seul travail GPU du portail par machine (${M.rules.gpu_jobs_per_machine}) ; rien sous le rendu d’un autre `,
        '(le studio, une autre session) : on attend en le disant. Une instance qui change de famille de modèles est vidée (/free) ; ',
        `la famille déjà chargée passe d’abord parmi les ${M.rules.group_window} premiers travaux, un travail n’est pas doublé plus de `,
        `${M.rules.max_overtake} fois. Les règles de mémoire sont celles du studio (factory/memory.py).`),
      el('dl', { class: 'kv2' }, el('dt', {}, 'mémoire des familles'), el('dd', {}, fam || 'inconnue'),
        el('dt', {}, 'lue dans'), el('dd', {}, M.families.source)))];
}

// ── E · le câblage ──────────────────────────────────────────
function cablage() {
  const d = S.sw;
  if (!d) return [head('Câblage', 'F'), el('p', { class: 'lbl' }, 'lecture…')];
  const pending = d.items.filter((i) => i.pending);
  const setSw = (key, value) => {
    const it = d.items.find((i) => i.key === key) || {};
    const was = it.file !== undefined ? it.file : it.running;   // pas encore dans le fichier : la valeur en marche
    return undoable(`${key} = ${JSON.stringify(value)}`, async () => { S.sw = await post('admin/switches', { key, value }); },
      async () => { S.sw = await post('admin/switches', { key, value: was }); }, `${key} = ${JSON.stringify(value)} : écrit, au redémarrage`);
  };
  return [head('Câblage', 'F', d.file),
    el('p', { class: 'adm-note' }, 'Les interrupteurs de câblage des modèles. Ils s’écrivent dans showrunner.local.json dès le clic et prennent effet ',
      'au redémarrage du portail : le serveur ne relit ce fichier qu’au démarrage.'),
    pending.length ? el('div', { class: 'cmd' }, el('span', { class: 'why' }, 'à relancer'), el('code', {}, d.restart),
      el('button', { class: 'tb ghost sm', onclick: async () => { if (await copyText(d.restart)) toast('copié'); else toast(d.restart, 12000); } }, 'Copier')) : null,
    ...d.items.map((it) => el('div', { class: 'card' + (it.pending ? ' amb' : '') },
      el('div', { class: 'sw' },
        el('div', { style: { minWidth: 0 } }, el('div', { class: 'nm' }, it.label), el('div', { class: 'k' }, it.key)),
        el('div', { class: 'seg' }, ...it.values.map((v) => el('button', { class: 'tb' + (JSON.stringify(it.file) === JSON.stringify(v) ? ' on' : ''),
          onclick: () => setSw(it.key, v) }, String(v))))),
      el('p', { class: 'adm-note' }, it.doc),
      it.pending ? el('div', { class: 'why' }, `écrit : ${JSON.stringify(it.file)} · en marche : ${JSON.stringify(it.running)} — au redémarrage`)
        : el('div', { class: 'lbl' }, `en marche : ${JSON.stringify(it.running)}`))),
    Object.keys(d.others).length ? el('div', { class: 'card' }, el('span', { class: 'nm' }, 'Autres réglages du fichier'),
      el('p', { class: 'adm-note' }, 'Lus seulement : leurs valeurs ne sont pas déclarées par un outil.'),
      el('dl', { class: 'kv2' }, ...Object.entries(d.others).flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, JSON.stringify(v))]))) : null,
    d.expected.length ? el('p', { class: 'lbl' }, `à déclarer par leur outil (config.declare_switch) : ${d.expected.join(', ')}`) : null];
}

// ── F · le stockage ─────────────────────────────────────────
// `typed` (détruire, le ménage : D4, D7) : ce qu'il faut taper pour que le bouton parte — un nom, MENAGE ;
// le bouton reste grisé et dit pourquoi tant que ce n'est pas tapé ; `action` reçoit ce qui l'a été
// (le serveur le rejuge). Échap et « Annuler » ferment sans rien faire.
function confirmBox(title, text, go, action, { typed = null } = {}) {
  const inp = typed != null ? el('input', { class: 'fld confirm-typed', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none',
    'aria-label': `tape « ${typed} » pour confirmer`, placeholder: typed }) : null;
  const need = `tape « ${typed} » pour confirmer`;
  const same = () => !inp || inp.value.split(/\s+/).filter(Boolean).join(' ') === typed;
  const btn = el('button', { class: 'tb go', type: 'submit', disabled: inp ? true : null, title: inp ? need : '' }, go);
  const close = () => { scrim.remove(); document.removeEventListener('keydown', esc, true); };
  const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  if (inp) inp.addEventListener('input', () => { btn.disabled = !same(); btn.title = same() ? '' : need; });
  const scrim = el('div', { class: 'scrim' }, el('form', { class: 'modal', role: 'dialog', 'aria-label': title,
    onsubmit: (e) => { e.preventDefault(); if (!same()) return; const v = inp ? inp.value : undefined; close(); action(v); } },
  el('div', { class: 'modal-head' }, el('span', { class: 't' }, title)),
  el('div', { class: 'modal-body' }, el('p', {}, text),
    inp ? el('label', { class: 'confirm-row' }, el('span', { class: 'lbl' }, 'pour confirmer'), inp) : null),
  el('div', { class: 'modal-foot' }, el('span', { class: 'sp' }),
    el('button', { class: 'tb ghost', type: 'button', onclick: close }, 'Annuler'), btn)));
  document.body.append(scrim);
  document.addEventListener('keydown', esc, true);
  (inp || btn).focus();
}

function stockage() {
  const d = S.store;
  if (!d) return [head('Stockage', 'G'), el('p', { class: 'lbl' }, 'mesure…')];
  const total = d.parts.reduce((a, p) => a + p.bytes, 0);
  const trash = d.parts.find((p) => p.name === 'trash') || { bytes: 0 };
  const disk = d.disk;
  return [head('Stockage', 'G', d.data_dir),
    disk ? el('div', { class: 'card' }, el('div', { class: 'mem' },
      el('span', { class: 'lbl' }, `disque : ${fmtBytes(disk.free)} libres sur ${fmtBytes(disk.total)} · le portail en garde ${fmtBytes(total)}`),
      el('div', { class: 'bar' }, el('i', { style: { width: `${Math.round(100 * (disk.total - disk.free) / disk.total)}%` } })))) : null,
    el('div', { class: 'grid2' },
      el('div', { class: 'card' }, el('span', { class: 'nm' }, 'La bibliothèque'),
        el('dl', { class: 'kv2' }, el('dt', {}, 'objets'), el('dd', {}, String(d.items)),
          ...Object.entries(d.counts).flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, String(v))]))),
      el('div', { class: 'card' }, el('span', { class: 'nm' }, 'La corbeille'),
        el('p', { class: 'adm-note' }, `${plural(d.trash_items, 'objet', 'objets')} · ${fmtBytes(trash.bytes)}. Un objet mis à la corbeille peut revenir ; vidée, elle ne rend plus rien.`),
        el('div', { class: 'row' }, el('button', { class: d.trash_items ? 'tb go' : 'tb', disabled: !d.trash_items,
          title: d.trash_items ? '' : 'la corbeille est vide',
          onclick: () => confirmBox('Vider la corbeille', `${plural(d.trash_items, 'objet', 'objets')} (${fmtBytes(trash.bytes)}) supprimés pour de bon.`, 'Vider',
            () => act(async () => { await post('admin/trash/empty'); S.store = await api('admin/storage?fresh=1'); }, 'corbeille vidée')) }, 'Vider la corbeille')))),
    el('div', { class: 'card' }, el('span', { class: 'nm' }, 'Par dossier'),
      el('dl', { class: 'kv2' }, ...d.parts.sort((a, b) => b.bytes - a.bytes).flatMap((p) => [el('dt', {}, p.name), el('dd', {}, `${fmtBytes(p.bytes)} · ${plural(p.files, 'fichier', 'fichiers')}`)])))];
}

// ── G · le journal ──────────────────────────────────────────
const BAD = new Set(['code refusé', 'refusé', 'appareil retiré']);
function journalSec() {
  const d = S.jr;
  if (!d) return [head('Journal', 'H'), el('p', { class: 'lbl' }, 'lecture…')];
  const f = S.filter.toLowerCase();
  const rows = d.events.filter((e) => !f || JSON.stringify(e).toLowerCase().includes(f)).slice(0, 250);
  const detail = (e) => Object.entries(e).filter(([k]) => !['t', 'event', 'user'].includes(k) && !(k === 'by' && !e.user))
    .map(([k, v]) => (k === 'by' ? `par ${v}` : `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`)).join(' · ');
  return [head('Journal', 'H', `${d.events.length} événements`),
    el('div', { class: 'row' }, el('input', { class: 'fld', placeholder: 'filtrer (un nom, un chemin, un événement)', value: S.filter, style: { maxWidth: '420px' },
      oninput: (e) => {
        S.filter = e.target.value;
        render(true);
        const i = main.querySelector('input.fld');
        if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
      } })),
    el('div', {}, ...rows.map((e) => el('div', { class: 'jr' },
      el('span', {}, fmtDate(e.t)),
      el('span', { class: 'ev' + (BAD.has(e.event) || (e.status >= 400) ? ' bad' : e.event === 'demande' || e.event === 'demande de Studio' ? ' amb' : '') },
        e.event === 'http' ? `${e.method} ${e.status}` : e.event),
      el('span', {}, e.user || e.by || '—'),
      el('span', { class: 'd', title: detail(e) }, e.event === 'http' ? e.path : detail(e))))),
    el('span', { class: 'lbl' }, `le journal du serveur · ${d.log_file}`),
    el('pre', { class: 'log' }, d.log.length ? d.log.join('\n') : '(vide, ou pas de fichier)')];
}

// ── I · les diagnostics : une liste fixe de scripts du dépôt, lancés d'un clic (server/tools/admin.py, DIAGS) ──
// Cal, 05/10 : plus de terminal pour savoir ce qui se passe ; la sortie s'affiche ici, et se relit tant qu'un script tourne.
let dgTimer = 0;
let allBusy = '', allNote = '', allText = '';
// tous les diagnostics qui ne changent rien, l'un après l'autre, puis un seul texte dans le presse-papier.
// Il continue onglet caché (le seul relevé d'Admin qui le fasse) : chaque relevé lance le script suivant,
// l'arrêter arrêterait la suite elle-même ; Cal la lance, puis va attendre ailleurs (20 scripts, bornés).
async function runAll() {
  const list = (S.dg?.diags || []).filter((x) => !x.action);
  const parts = [`Diagnostics Showrunner · ${new Date().toLocaleString('fr-FR')}`];
  allNote = '';
  for (const [k, x] of list.entries()) {
    allBusy = `${k + 1}/${list.length} · ${x.label}`;
    render();
    try { await post(`admin/diag/${x.id}`); } catch (e) { parts.push(`===== ${x.id} · ${x.label} · non lancé : ${e.message} =====`); continue; }
    let r = null;
    for (let t = 0; t < 400; t++) {   // jusqu'à 20 min par script (le plus long : 300 s)
      await new Promise((ok) => setTimeout(ok, 3000));
      try { S.dg = await api('admin/diag'); } catch { continue; }
      r = S.dg.diags.find((y) => y.id === x.id);
      render();
      if (r && r.state !== 'running') break;
    }
    parts.push(`===== ${x.id} · ${x.label} · ${r?.state || '?'}${r?.rc != null ? ` (code ${r.rc})` : ''} =====\n${r?.out || ''}`);
  }
  allBusy = '';
  allText = parts.join('\n\n');
  // après plusieurs minutes, le navigateur refuse la copie (le clic est trop loin) : le texte
  // reste affiché, et le bouton « Copier tout » le copie dans son propre clic
  allNote = `fini (${signes(allText)}) : clique sur « Copier tout », puis colle dans le chat de Claude`;
  toast(allNote, 8000);
  render(true);
}
const signes = (t) => (t.length < 1000 ? `${t.length} signes` : `${Math.round(t.length / 1000)} k signes`);
const copyAll = async () => {
  const good = await copyText(allText);
  allNote = good ? `copié (${signes(allText)}) : colle-le dans le chat de Claude`
    : 'copie refusée par le navigateur : clique dans le texte ci-dessous, Ctrl+A puis Ctrl+C';
  toast(allNote, 8000);
  render(true);
};
function diagSec() {
  const d = S.dg;
  if (!d) return [head('Diagnostics', 'I'), el('p', { class: 'lbl' }, 'lecture…')];
  const running = d.diags.some((x) => x.state === 'running');
  clearTimeout(dgTimer);
  // pas de repeinte forcée : une sélection en cours dans une sortie reste (busy)
  if (running) dgTimer = setTimeout(async () => { if (S.sec !== 'diag' || ongletCache()) return; try { S.dg = await api('admin/diag'); } catch { /* */ } render(); }, 2000);
  const start = async (x) => {
    try { await post(`admin/diag/${x.id}`); S.dg = await api('admin/diag'); render(true); } catch (e) { toast(e.message); }
  };
  const chip = (x) => x.state === 'running' ? el('span', { class: 'chip amb' }, el('i'), 'en cours')
    : x.state === 'done' ? el('span', { class: 'chip ok' }, el('i'), `fini ${fmtDate(new Date(x.ended * 1000).toISOString())}`)
      : x.state === 'failed' ? el('span', { class: 'chip err' }, el('i'), `échec${x.rc != null && x.rc !== -1 ? ` (code ${x.rc})` : ''}`) : null;
  return [head('Diagnostics', 'I', running ? 'un script tourne' : `${d.diags.length} scripts`),
    el('p', { class: 'adm-note' }, 'Les scripts de vérification du dépôt, sans terminal : un clic, la sortie s’affiche ici. Ils ne changent rien, sauf « Planche · créer », qui crée la planche de la réunion (une deuxième fois : une deuxième planche).'),
    // Cal, 05/10 : « c'est infernal de copier-coller les diagnostics » — un clic les lance tous (sauf la
    // planche, qui crée quelque chose), un seul texte part dans le presse-papier : un Ctrl+V pour Claude
    el('div', { class: 'row' }, el('button', { class: 'tb' + (allText && !allBusy ? ' ghost' : ' go') + ' sm', type: 'button', disabled: running || allBusy ? true : null,
      title: 'lance chaque diagnostic l’un après l’autre, puis rassemble toutes leurs sorties en un seul texte', onclick: () => runAll() },
    allBusy ? `en cours : ${allBusy}` : allText ? 'Tout relancer' : 'Tout lancer'),
    allText && !allBusy ? el('button', { class: 'tb go sm', type: 'button', title: 'copie toutes les sorties en un seul texte', onclick: copyAll }, 'Copier tout') : null,
    el('span', { class: 'adm-note' }, allNote)),
    // le texte rassemblé, dans un champ qui ne bouge pas : un clic le sélectionne en entier (secours si la copie est refusée)
    allText && !allBusy ? el('textarea', { class: 'fld diag-all', readonly: '', rows: 8, spellcheck: 'false',
      onfocus: (e) => e.target.select() }, allText) : null,
    el('div', { class: 'grid2' }, ...d.diags.map((x) => el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('span', { class: 'nm' }, x.label), chip(x)),
      el('p', { class: 'adm-note' }, x.doc),
      el('div', { class: 'row' }, el('span', { class: 'sp' }),
        el('button', { class: 'tb' + (x.action ? '' : ' ghost') + ' sm', type: 'button', disabled: x.state === 'running' ? true : null,
          title: x.state === 'running' ? 'il tourne : sa sortie arrive' : '',
          onclick: () => (x.action ? confirmBox('Créer la planche de la réunion ?', 'Ça crée une nouvelle planche dans la Team « LES ANEES FOLLES », avec des photos d’époque téléchargées de Wikimedia Commons (quelques minutes). Une deuxième fois en crée une deuxième.', 'Créer la planche', () => start(x)) : start(x)) },
        x.action ? 'Lancer' : x.state ? 'Relancer' : 'Lancer'),
        x.out ? copier(`===== ${x.id} · ${x.label} · ${x.state || '?'}${x.rc != null ? ` (code ${x.rc})` : ''} =====\n${x.out}`, 'sortie') : null),
      x.out ? el('pre', { class: 'log' }, x.out) : null)))];
}

addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id !== S.sec && SECTIONS.some(([x]) => x === id)) go(id); });
go(S.sec).then(() => refresh(true));
