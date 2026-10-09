// SHOWRUNNER TOOLS — Admin, la section « Vue d'ensemble » (Cal) et « Tableau de bord »
// (chacun, l'Admin limité). Cal, 09/10 : « il faut que les users aient un dashboard avec la
// possibilité de gérer les accès […] je dois moi avoir un dashboard qui me permette de voir
// toutes les teams, workspaces et assets créés par les gens. »
//
// Ce que la page montre vient de GET /api/tableau (server/tools/tableau.py), qui compte les
// fiches de l'inventaire (core/inventaire.py : chaque outil y énumère ses créations, avec leur
// auteur et leur Workspace) : Cal voit toutes les Teams (?toutes=1, les « Chez moi » de chacun
// comprises) ; un autre compte, ses Teams. Les accès (membres, rôles, invitations, Workspaces)
// se gèrent dans la section Teams, juste après : ce tableau n'écrit rien.
//
// Un clic sur un Workspace déplie ses objets (GET /api/tableau/espace/<sid>, par pages) ; sur
// une personne, tout ce qu'elle a créé et où (GET /api/tableau/personne/<uid>) ; sur un objet,
// il s'ouvre dans son outil, dans un nouvel onglet placé dans son Workspace (?e=<sid>) — l'onglet
// de l'Admin garde le sien. La recherche (un nom, un pseudo, un titre) : GET /api/tableau/cherche.
//
// La section garde son nœud d'un relevé à l'autre (admin.js, render : une section qui rend le
// même nœud reste en place) : le champ de recherche garde la main pendant qu'on tape.
import { api, el, href, fmtDate, toast } from '../commun/shell.js';

const PAGE = 30;
const T = { d: null, at: 0, every: null, ver: 0, built: -1, q: '', found: null, qT: 0, person: null, open: {}, kinds: {}, err: '' };
let ctx = null;   // { head, render, go, isCal }

const root = el('div', { class: 'tdb' });
const headBox = el('div', { class: 'tdb-head' });
const body = el('div', { class: 'tdb-body' });
const input = el('input', { class: 'fld', type: 'search', placeholder: 'chercher une personne ou un titre', 'aria-label': 'chercher une personne ou un titre',
  maxlength: 80, oninput: () => chercher(input.value) });
root.append(headBox, el('div', { class: 'tdb-search' }, input), body);

/** admin.js : ce que la section emprunte à la page (son en-tête, sa repeinte, ses sections). */
export function tableauInit(c) { ctx = c; }
/** Le compte du rack (le nombre d'objets que la personne voit), ou null avant la première lecture. */
export const tableauCount = () => (T.d ? T.d.total : null);

const bump = () => { T.ver++; ctx.render(true); };
const titre = () => (ctx.isCal() ? 'Vue d’ensemble' : 'Tableau de bord');
const kindOf = (k) => T.kinds[k] || { label: k, plural: k };
const nKind = (n, k) => `${n} ${n > 1 ? kindOf(k).plural : kindOf(k).label}`;
const nb = (n, one, many) => `${n} ${n > 1 ? many : one}`;
// la pastille d'une vignette absente : la sorte en capitales (la machine)
const CODE = { image: 'IMG', video: 'VID', audio: 'SON', midi: 'MIDI', document: 'DOC', element: 'ÉLÉM', sequence: 'SÉQ', playlist: 'PLAY',
  planche: 'PLAN', odio: 'ODIO', transcription: 'TRN', lut: 'LUT', atelier: 'ATEL', analyse: 'ANA', space: 'SPACE', lora: 'LORA' };
const VIA = { travail: 'd’après son travail', journal: 'd’après le journal' };
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();

// ── lire ────────────────────────────────────────────────────
/** La vue d'ensemble, relue au plus toutes les 30 s (un relevé de la page), ou tout de suite (`force`). */
export async function loadTableau(force = false) {
  const every = ctx.isCal();   // Cal : toutes les Teams ; la page le sait quand admin/state a répondu
  if (!force && T.d && T.every === every && Date.now() - T.at < 30000) return;
  try {
    const d = await api(`tableau${every ? '?toutes=1' : ''}`);
    T.d = d; T.at = Date.now(); T.err = ''; T.every = every;
    T.kinds = Object.fromEntries((d.kinds || []).map((k) => [k.id, k]));
    // ce qui est déplié se relit avec (son filtre, autant de lignes qu'on en avait déroulé)
    await Promise.all(Object.keys(T.open).map((sid) => loadSpace(sid, T.open[sid].kind, 0, true, T.open[sid].items.length)));
    if (T.person) await loadPerson(T.person.uid, T.person.kind, 0, true, T.person.items.length);
    if (T.q) await chercherMaintenant(T.q, true);
  } catch (e) { T.err = e.message; }
  T.ver++;
}

// `n` : combien de lignes relire d'un coup (un relevé garde ce qu'on avait déroulé, 500 au plus : la route)
async function loadSpace(sid, kind = '', offset = 0, quiet = false, n = PAGE) {
  const o = T.open[sid] || (T.open[sid] = { kind: '', items: [], total: 0, counts: {}, busy: false });
  o.busy = true; o.kind = kind;
  try {
    const d = await api(`tableau/espace/${encodeURIComponent(sid)}?${qs({ kind, limit: Math.min(500, Math.max(PAGE, n)), offset })}`);
    Object.assign(o, { items: offset ? [...o.items, ...d.items] : d.items, total: d.total, counts: d.counts, err: '' });
  } catch (e) { o.err = e.message; if (!quiet) toast(e.message); }
  o.busy = false;
}

async function loadPerson(uid, kind = '', offset = 0, quiet = false, n = PAGE) {
  try {
    const d = await api(`tableau/personne/${encodeURIComponent(uid)}?${qs({ kind, limit: Math.min(500, Math.max(PAGE, n)), offset })}`);
    const prev = T.person && T.person.uid === uid && offset ? T.person.items : [];
    T.person = { ...d, uid, kind, items: [...prev, ...d.items] };
  } catch (e) { if (!quiet) toast(e.message); else T.person = null; }
}

function chercher(v) {
  T.q = v.trim();
  clearTimeout(T.qT);
  if (!T.q) { T.found = null; bump(); return; }
  T.qT = setTimeout(() => chercherMaintenant(T.q).then(bump), 220);
}
async function chercherMaintenant(q, quiet = false) {
  try {
    const d = await api(`tableau/cherche?${qs({ q, toutes: ctx.isCal() ? 1 : '' })}`);
    if (q === T.q) T.found = d;
  } catch (e) { if (!quiet) toast(e.message); }
}

async function toggleSpace(sid) {
  if (T.open[sid]) { delete T.open[sid]; bump(); return; }
  T.open[sid] = { kind: '', items: [], total: 0, counts: {}, busy: true };
  bump();
  await loadSpace(sid);
  bump();
}
async function openPerson(uid) {
  T.q = ''; input.value = ''; T.found = null;
  await loadPerson(uid);
  bump();
  root.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// ── peindre ─────────────────────────────────────────────────
function counts(c, max = 6) {
  const e = Object.entries(c || {});
  return el('span', { class: 'tdb-counts' }, ...e.slice(0, max).map(([k, n]) => el('span', { class: 'chip' }, nKind(n, k))),
    e.length > max ? el('span', { class: 'chip no', title: e.slice(max).map(([k, n]) => nKind(n, k)).join(' · ') }, `+${e.length - max}`) : null);
}
// la dernière activité : la machine en capitales (la date, l'auteur, la sorte), le titre tel qu'on l'a tapé
const lastLine = (l, where = false) => (l ? [`dernière activité ${fmtDate(l.at)} · ${l.owner_name} · ${kindOf(l.kind).label}`
  + (where && l.space_name ? ` · ${l.team_name} / ${l.space_name}` : '') + ' · ', el('span', { class: 'tl' }, l.title)] : 'rien encore');
const byLine = (authors) => `par ${authors.map((a) => `${a.name} (${a.n})`).join(' · ')}`;

function itemRow(it, { where = false } = {}) {
  const meta = [kindOf(it.kind).label, it.sub, where ? `${it.team_name} / ${it.space_name}` : '',
    `par ${it.owner_name}${it.owner_gone ? ' (compte supprimé)' : ''}${VIA[it.via] ? ` · ${VIA[it.via]}` : ''}`, fmtDate(it.updated)].filter(Boolean);
  return el('a', { class: 'tdb-it', href: href(it.open), target: '_blank', rel: 'noopener', 'data-kind': it.kind,
    title: 'l’ouvrir dans son outil, dans son Workspace (un nouvel onglet)' },
  it.thumb ? el('span', { class: 'th', style: { backgroundImage: `url("${href(it.thumb)}")` } }) : el('span', { class: 'th k' }, CODE[it.kind] || it.kind.slice(0, 4).toUpperCase()),
  el('span', { class: 'tx' }, el('span', { class: 't' }, it.title), el('span', { class: 'm' }, meta.join(' · '))),
  el('span', { class: 'go', 'aria-hidden': 'true' }, '↗'));
}

// les sortes d'une liste : un filtre (la sorte choisie, ou tout)
function kindSeg(c, cur, pick) {
  const total = Object.values(c || {}).reduce((a, n) => a + n, 0);
  return el('div', { class: 'seg wrap tdb-kinds', role: 'group', 'aria-label': 'la sorte' },
    el('button', { class: 'tb sm' + (!cur ? ' on' : ''), type: 'button', 'aria-pressed': !cur ? 'true' : 'false', onclick: () => pick('') }, `tout · ${total}`),
    ...Object.entries(c || {}).map(([k, n]) => el('button', { class: 'tb sm' + (cur === k ? ' on' : ''), type: 'button',
      'aria-pressed': cur === k ? 'true' : 'false', onclick: () => pick(k) }, `${kindOf(k).plural} · ${n}`)));
}

function list(o, { where = false, more }) {
  return [o.err ? el('p', { class: 'warn' }, o.err) : null,
    o.items.length ? el('div', { class: 'tdb-items' }, ...o.items.map((it) => itemRow(it, { where })))
      : el('p', { class: 'lbl' }, o.busy ? 'lecture…' : 'rien ici'),
    o.items.length < o.total ? el('div', { class: 'row' }, el('button', { class: 'tb ghost sm', type: 'button', onclick: more },
      `${o.total - o.items.length} de plus`)) : null];
}

function wsBlock(sp) {
  const o = T.open[sp.id];
  const row = el('button', { class: 'tdb-ws' + (o ? ' open' : '') + (sp.archived ? ' off' : ''), type: 'button', 'data-space': sp.id,
    'aria-expanded': o ? 'true' : 'false', onclick: () => toggleSpace(sp.id) },
  el('span', { class: 'tdb-ws-l' }, el('span', { class: 'ws-nm' }, sp.name),
    sp.archived ? el('span', { class: 'chip no' }, 'archivé') : null,
    sp.orphan ? el('span', { class: 'chip amb' }, 'workspace disparu') : null,
    el('span', { class: 'sp' }), el('span', { class: 'tdb-n' }, sp.total ? nb(sp.total, 'objet', 'objets') : 'vide')),
  sp.total ? el('span', { class: 'tdb-ws-r' }, counts(sp.counts),
    el('span', { class: 'm' }, byLine(sp.authors)),
    el('span', { class: 'm' }, lastLine(sp.last))) : null);
  if (!o) return [row];
  return [row, el('div', { class: 'tdb-list' },
    el('div', { class: 'row' }, kindSeg(o.counts, o.kind, (k) => loadSpace(sp.id, k).then(bump)), el('span', { class: 'sp' }),
      el('a', { class: 'tb ghost sm', href: href(sp.open), target: '_blank', rel: 'noopener', title: 'ce Workspace dans Asset (un nouvel onglet, dans ce Workspace)' }, 'Asset ↗')),
    ...list(o, { more: () => loadSpace(sp.id, o.kind, o.items.length).then(bump) }))];
}

function tdbTeam(t) {
  // une Team dont un Workspace est déplié prend toute la largeur : sa liste a la place d'une ligne
  return el('div', { class: 'card tdb-team' + (t.archived ? ' off' : '') + (t.spaces.some((s) => T.open[s.id]) ? ' wide' : ''), 'data-team': t.id },
    el('div', { class: 'card-head' }, el('span', { class: 'nm' }, t.name),
      t.plan ? el('span', { class: 'chip' + (t.plan === 'studio' ? ' fam' : '') }, t.plan) : null,
      t.personal ? el('span', { class: 'chip' }, 'personnelle') : null,
      t.archived ? el('span', { class: 'chip err' }, el('i'), 'archivée') : null,
      el('span', { class: 'sp' }), el('span', { class: 'tdb-n' }, nb(t.total, 'objet', 'objets'))),
    el('div', { class: 'cmeta' }, lastLine(t.last)),
    el('div', { class: 'tdb-wss' }, ...t.spaces.flatMap(wsBlock)));
}

function personRow(p) {
  const sub = p.unknown ? 'le document ne le dit pas' : p.gone ? 'compte supprimé' : p.id === T.d?.me?.id ? 'toi'
    : (p.pseudo && p.pseudo !== p.name ? p.pseudo : '');
  return el('button', { class: 'tdb-pp', type: 'button', 'data-person': p.id, onclick: () => openPerson(p.id) },
    el('span', { class: 'tdb-pp-n' }, el('span', { class: 't' }, p.name), sub ? el('span', { class: 'm' }, sub) : null),
    el('span', { class: 'tdb-n' }, String(p.total)),
    counts(p.counts, 3),
    el('span', { class: 'm tdb-pp-w' }, p.last ? `${nb(p.spaces, 'workspace', 'workspaces')} · ${fmtDate(p.last.at)} · ${p.last.team_name} / ${p.last.space_name}` : 'rien créé'));
}

function personView() {
  const P = T.person;
  const p = P.person;
  return [el('div', { class: 'row' }, el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { T.person = null; bump(); } }, `← ${titre()}`)),
    el('div', { class: 'card tdb-person' },
      el('div', { class: 'card-head' }, el('span', { class: 'nm' }, p.name),
        p.gone ? el('span', { class: 'chip amb' }, 'compte supprimé') : null,
        el('span', { class: 'sp' }), el('span', { class: 'tdb-n' }, nb(P.total, 'objet', 'objets'))),
      el('div', { class: 'cmeta' }, `${nb(P.spaces.length, 'workspace', 'workspaces')} · `, ...[].concat(lastLine(P.last, true))),
      P.spaces.length ? el('span', { class: 'lbl' }, `les workspaces · ${P.spaces.length}`) : null,
      el('div', { class: 'tdb-wss' }, ...P.spaces.map((s) => el('a', { class: 'tdb-ws', href: href(`asset/?e=${encodeURIComponent(s.space)}#/w/${s.space}`),
        target: '_blank', rel: 'noopener', title: 'ce Workspace dans Asset (un nouvel onglet, dans ce Workspace)' },
      el('span', { class: 'tdb-ws-l' }, el('span', { class: 'ws-nm' }, `${s.team_name} / ${s.space_name}`),
        s.orphan ? el('span', { class: 'chip amb' }, 'workspace disparu') : null,
        el('span', { class: 'sp' }), el('span', { class: 'tdb-n' }, nb(s.n, 'objet', 'objets'))),
      el('span', { class: 'tdb-ws-r' }, counts(s.counts), el('span', { class: 'm' }, `dernière activité ${fmtDate(s.last)}`))))),
      P.total ? el('span', { class: 'lbl' }, 'ce qui a été créé') : el('p', { class: 'lbl' }, 'rien créé, nulle part'),
      P.total ? kindSeg(P.counts, P.kind, (k) => loadPerson(P.uid, k).then(bump)) : null,
      ...(P.total ? list({ ...P, busy: false }, { where: true, more: () => loadPerson(P.uid, P.kind, P.items.length).then(bump) }) : []))];
}

function searchView() {
  const F = T.found;
  if (!F) return [el('p', { class: 'lbl' }, 'recherche…')];
  return [el('span', { class: 'lbl' }, `personnes · ${F.people.length}`),
    F.people.length ? el('div', { class: 'tdb-pps' }, ...F.people.map(personRow)) : el('p', { class: 'lbl' }, `personne ne s’appelle « ${F.q} »`),
    el('span', { class: 'lbl' }, `objets · ${F.total}${F.total > F.items.length ? ` · les ${F.items.length} plus récents` : ''}`),
    F.items.length ? el('div', { class: 'tdb-items' }, ...F.items.map((it) => itemRow(it, { where: true }))) : el('p', { class: 'lbl' }, 'aucun titre ne répond')];
}

function overviewView() {
  const d = T.d;
  const full = d.teams.filter((t) => t.total || !t.personal || t.mine);
  const empty = d.teams.filter((t) => !(t.total || !t.personal || t.mine));
  return [
    d.people.length ? el('span', { class: 'lbl' }, ctx.isCal() ? `les personnes · ${d.people.length}` : `qui crée dans tes Teams · ${d.people.length}`) : null,
    d.people.length ? el('div', { class: 'tdb-pps' }, ...d.people.map(personRow)) : null,
    el('span', { class: 'lbl' }, `les teams · ${d.teams.length}`),
    el('div', { class: 'grid2 wide' }, ...full.map(tdbTeam),
      d.orphans ? tdbTeam({ id: 'hors', name: 'Hors des Teams', total: d.orphans.total, last: d.orphans.last, spaces: d.orphans.spaces }) : null),
    empty.length ? el('p', { class: 'adm-note tdb-empty' }, `${nb(empty.length, '« chez moi » sans rien', '« chez moi » sans rien')} : `,
      empty.map((t) => t.name).join(' · ')) : null];
}

/** La section : un seul nœud, gardé d'un relevé à l'autre ; son contenu se refait quand les données changent. */
export function tableauSec() {
  if (T.built === T.ver && root.isConnected) return [root];
  T.built = T.ver;
  const d = T.d;
  const me = d && d.people.find((p) => p.id === d.me?.id);
  headBox.replaceChildren(ctx.head(titre(), '0', d ? `${nb(d.total, 'objet', 'objets')} · ${nb(d.people.filter((p) => !p.unknown).length, 'personne', 'personnes')}` : null),
    el('p', { class: 'adm-note' }, ctx.isCal()
      ? 'Ce que chacun a créé, et où : chaque Team (les « Chez moi » de chacun comprises), chaque Workspace, qui y crée et quand pour la dernière fois. Tu entres partout, en lecture : un objet s’ouvre dans son outil, dans un nouvel onglet placé dans son Workspace. Les accès se règlent dans Teams.'
      : 'Ce qui a été créé dans tes Teams, et par qui. Un objet s’ouvre dans son outil, dans un nouvel onglet placé dans son Workspace. Les accès — membres, rôles, invitations, Workspaces — se gèrent dans la section Teams.'),
    el('div', { class: 'row' },
      d && !ctx.isCal() ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => openPerson(d.me.id) }, `Ce que j’ai créé · ${me ? me.total : 0}`) : null,
      el('button', { class: 'tb ghost sm', type: 'button', onclick: () => ctx.go('teams') }, ctx.isCal() ? 'Les accès : Teams →' : 'Gérer les accès : Teams →')));
  body.replaceChildren(...[].concat(
    T.err ? el('p', { class: 'warn' }, T.err) : [],
    !d ? el('p', { class: 'lbl' }, 'lecture…') : T.q ? searchView() : T.person ? personView() : overviewView()).filter(Boolean));
  return [root];
}
