// SHOWRUNNER TOOLS — la page de Cal : les demandes d'accès, les
// personnes, la file des calculs, les machines, le câblage, le stockage,
// le journal. Le serveur juge (server/tools/admin.py, /api/admin/…) : qui
// n'est pas Cal reçoit 403, et le lit ici.

import { mountHeader, api, el, $, $$, toast, href, fmtDate, stateFr, fmtWait } from '../commun/shell.js';
import { uaShort } from '../commun/porte.js';

mountHeader('admin', { sub: 'la page de Cal' });

const SECTIONS = [
  ['demandes', 'A', 'Demandes', 'les demandes d’accès'],
  ['personnes', 'B', 'Personnes', 'quotas · appareils · suspendre'],
  ['file', 'C', 'La file', 'ordre · priorités · pauses'],
  ['machines', 'D', 'Machines', 'ComfyUI · mémoire · H3 · studio'],
  ['cablage', 'E', 'Câblage', 'les interrupteurs'],
  ['stockage', 'F', 'Stockage', 'bibliothèque · corbeille'],
  ['journal', 'G', 'Journal', 'qui a fait quoi'],
];
const S = { sec: SECTIONS.some(([id]) => id === location.hash.slice(1)) ? location.hash.slice(1) : 'demandes',
  state: null, mach: null, sw: null, store: null, jr: null, t: null, drag: null, dragLane: null, filter: '' };
const main = $('#adm-main');

const post = (path, body) => api(path, { method: 'POST', body: body || {} });
async function act(fn, msg) {
  try { await fn(); if (msg) toast(msg); } catch (e) { toast(e.message); }
  refresh(true);
}
const head = (title, k, cnt) => el('div', { class: 'sect-head' }, el('h2', {}, title), el('span', { class: 'k' }, k),
  cnt != null ? el('span', { class: 'cnt' }, cnt) : null);
const fmtBytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} Go` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} Mo` : `${Math.round(n / 1e3)} Ko`);
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// ── le rack des sections ────────────────────────────────────
function nav() {
  const st = S.state;
  const counts = st ? { demandes: st.requests.length, personnes: st.users.length,
    file: st.queue.running.length + st.queue.queued.length } : {};
  const badge = $('#sr-admin');   // l'en-tête suit sans attendre son propre relevé
  if (badge && st) badge.textContent = st.requests.length ? `Admin · ${st.requests.length}` : 'Admin';
  $('#adm-nav').replaceChildren(...SECTIONS.map(([id, k, name, sub]) => el('li', {},
    el('button', { class: 'item' + (S.sec === id ? ' sel' : ''), onclick: () => go(id) },
      el('span', { class: 'st' + (id === 'demandes' && counts.demandes ? ' run' : '') }),
      el('span', { class: 'txt' }, el('span', { class: 'ref' }, `${k} · ${name}`), el('span', { class: 'nm' }, name),
        el('span', { class: 'sub' }, sub)),
      counts[id] != null ? el('span', { class: 'n' + (id === 'demandes' && counts[id] ? ' amb' : '') }, String(counts[id])) : null,
      el('span', { class: 'dots' })))));
}

async function go(id) {
  S.sec = id;
  history.replaceState(null, '', '#' + id);
  render(true);
  await loadSection();
  render(true);
}

async function loadSection() {
  try {
    if (S.sec === 'machines') S.mach = await api('admin/machines');
    if (S.sec === 'cablage') S.sw = await api('admin/switches');
    if (S.sec === 'stockage') S.store = await api('admin/storage');
    if (S.sec === 'journal') S.jr = await api('admin/journal?n=300');
  } catch (e) { if (e.status !== 403) toast(e.message); }
}

function busy() {
  const a = document.activeElement;
  return S.drag || (a && main.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));
}

async function refresh(now = false) {
  clearTimeout(S.t);
  try {
    S.state = await api('admin/state');
    if (['machines', 'journal'].includes(S.sec)) await loadSection();
    render(now);
  } catch (e) {
    if (e.status === 403) return denied();
    if (e.status !== 401) main.replaceChildren(el('p', { class: 'warn' }, e.message));
  }
  S.t = setTimeout(refresh, S.sec === 'machines' ? 4000 : S.sec === 'journal' ? 6000 : 3000);
}

function denied() {
  $('#adm-nav').replaceChildren();
  main.replaceChildren(head('Réservé aux admins', '—'),
    el('p', { class: 'adm-note' }, 'Cette page est la page d’administration du portail : Cal, et ceux à qui il a donné le rôle admin.'),
    el('div', { class: 'row' }, el('a', { class: 'tb ghost', href: href('') }, 'Retour à l’accueil')));
}

function render(force = false) {
  if (!S.state) return;
  nav();
  if (!force && busy()) return;   // on ne repeint pas sous les doigts de Cal
  const fn = { demandes, personnes, file, machines: machinesSec, cablage, stockage, journal: journalSec }[S.sec];
  main.replaceChildren(...[].concat(fn()).filter(Boolean));
}

// ── A · les demandes ────────────────────────────────────────
function demandes() {
  const r = S.state.requests;
  return [head('Demandes d’accès', 'A', `${r.length} en attente`),
    el('p', { class: 'adm-note' }, 'Une demande, c’est un pseudo neuf tapé à l’accueil. Accepté, il entre — la page qui attend s’ouvre seule, ',
      'et ensuite ce pseudo suffit, de n’importe quel navigateur ; refusé, la page le dit et le pseudo redevient libre. ',
      'Un pseudo qui imite un admin (casse, accents, 0/O, 1/l/I) est refusé d’office.'),
    r.length ? el('div', { class: 'grid2' }, ...r.map((u, i) => el('div', { class: 'card amb' },
      el('div', { class: 'card-head' }, el('span', { class: 'nm' }, u.name), el('span', { class: 'chip amb' }, el('i'), 'en attente')),
      el('div', { class: 'cmeta' }, `demandé ${fmtDate(u.created)} · `, el('b', {}, u.ip || 'adresse inconnue'), ` · ${uaShort(u.ua)}`),
      el('div', { class: 'row' },
        el('button', { class: i === 0 ? 'tb go' : 'tb', onclick: () => act(() => post(`admin/requests/${u.id}/accept`), `${u.name} peut entrer`) }, 'Accepter'),
        el('button', { class: 'tb ghost', onclick: () => act(() => post(`admin/requests/${u.id}/refuse`), `demande de ${u.name} refusée`) }, 'Refuser')))))
      : el('p', { class: 'lbl' }, 'aucune demande en attente')];
}

// ── B · les personnes ───────────────────────────────────────
function qf(label, value, placeholder, onset, disabled = false) {
  return el('label', { class: 'qf' }, el('span', { class: 'lbl' }, label),
    el('input', { class: 'fld', type: 'number', min: 0, max: 10000, value: value ?? '', placeholder, disabled,
      onchange: (e) => onset(e.target.value === '' ? null : Number(e.target.value)) }));
}

function reglages() {
  const s = S.state.settings;
  const set = (patch, msg = 'enregistré') => act(() => post('admin/settings', patch), msg);
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
  const setQ = (k, label) => (v) => act(() => post(`admin/users/${u.id}`, { quotas: { [k]: v } }), `${u.name} · ${label} : ${v ?? 'par défaut'}`);
  const devBox = el('div', { class: 'acct-list', hidden: true });
  const susp = u.state === 'suspended';
  const nAdm = S.state.users.filter((x) => x.role === 'admin' && x.state === 'active').length;
  const lastAdm = adm && nAdm <= 1;
  return el('div', { class: 'card' + (susp ? ' off' : '') },
    el('div', { class: 'card-head' }, el('span', { class: 'nm' }, u.name),
      adm ? el('span', { class: 'chip adm-role' }, 'admin') : el('span', { class: 'chip' }, 'ami·e'),
      susp ? el('span', { class: 'chip err' }, el('i'), 'suspendu') : el('span', { class: 'chip ok' }, el('i'), 'actif')),
    el('div', { class: 'cmeta' }, 'pseudo ', el('b', {}, u.pseudo || u.name), ` · entré ${fmtDate(u.accepted || u.created)} · vu ${u.seen ? fmtDate(u.seen) : 'jamais'} · `,
      el('b', {}, plural(u.devices, 'connexion', 'connexions'))),
    el('div', { class: 'cmeta' }, el('b', {}, `${u.running} en cours · ${u.queued} en file · ${u.today} aujourd’hui`),
      ` · ${plural(u.items, 'objet', 'objets')} dans la bibliothèque`),
    adm ? el('p', { class: 'adm-note' }, 'Admin : pas de quota, la page d’admin, entre depuis le réseau de Cal.') : el('div', { class: 'qfs' },
      qf('simultanés', u.quotas.running, `défaut ${def.running ?? '∞'}`, setQ('running', 'simultanés')),
      qf('en file', u.quotas.queued, `défaut ${def.queued ?? '∞'}`, setQ('queued', 'en file')),
      qf('par jour', u.quotas.per_day, `défaut ${def.per_day ?? '∞'}`, setQ('per_day', 'par jour'))),
    u.recent.length ? el('div', { class: 'cmeta' }, 'lancé dernièrement : ',
      ...u.recent.slice(0, 4).map((j, i) => el('b', {}, `${i ? ' · ' : ''}${j.title} (${stateFr(j.state)})`))) : null,
    el('div', { class: 'row' },
      el('button', { class: 'tb ghost sm', onclick: () => { devBox.hidden = !devBox.hidden; if (!devBox.hidden) paintDevices(u, devBox); } }, 'Connexions'),
      susp ? null : el('button', { class: 'tb ghost sm', disabled: lastAdm,
        title: lastAdm ? 'le dernier admin garde son rôle : donne-le d’abord à quelqu’un d’autre' : '',
        onclick: () => act(() => post(`admin/users/${u.id}`, { role: adm ? 'ami' : 'admin' }),
          adm ? `${u.name} n’est plus admin` : `${u.name} est admin`) }, adm ? 'Retirer le rôle admin' : 'Donner le rôle admin'),
      adm ? null : el('button', { class: 'tb ghost sm', onclick: () => act(() => post(`admin/users/${u.id}`, { state: susp ? 'active' : 'suspended' }),
        susp ? `${u.name} peut revenir` : `${u.name} suspendu·e : ses travaux en file sont retirés`) }, susp ? 'Réactiver' : 'Suspendre')),
    lastAdm ? el('p', { class: 'why' }, 'dernier admin : son rôle ne se retire pas') : null,
    devBox);
}

function personnes() {
  const us = S.state.users;
  return [head('Personnes', 'B', plural(us.length, 'compte', 'comptes')), reglages(),
    el('div', { class: 'grid2' }, ...us.map(personne))];
}

// ── C · la file ─────────────────────────────────────────────
function machineCtl(m, s) {
  const mode = s.mode;
  const label = mode === 'active' ? 'active' : mode === 'draining' ? (s.drained ? 'vidée' : 'vidange') : 'en pause';
  return el('div', { class: 'row' },
    el('span', { class: 'chip ' + (mode === 'active' ? 'ok' : 'amb') }, el('i'), `${m} · ${label}`),
    mode === 'active' ? el('button', { class: 'tb ghost sm', title: 'ce qui tourne finit ; rien de neuf ne part sur cette machine',
      onclick: () => act(() => post('admin/pause', { machine: m, mode: 'paused' }), `${m} en pause`) }, 'Pause') : null,
    mode === 'active' ? el('button', { class: 'tb ghost sm', title: 'finir ce qui tourne, puis ne plus rien prendre (avant de l’éteindre)',
      onclick: () => act(() => post('admin/pause', { machine: m, mode: 'draining' }), `${m} en vidange`) }, 'Vidanger') : null,
    mode !== 'active' ? el('button', { class: 'tb ghost sm', onclick: () => act(() => post('admin/pause', { machine: m, mode: 'active' }), `${m} reprend`) }, 'Reprendre') : null);
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
    if (id && id !== row.dataset.id) act(() => post(`admin/queue/${id}`, { before: row.dataset.id }), 'déplacé');
  });
}

function endZone(lane) {
  const z = el('div', { class: 'q-end', 'data-lane': lane }, el('span', { class: 'lbl' }, 'déposer ici : en fin de voie'));
  z.addEventListener('dragover', (e) => { if (S.drag && S.dragLane === lane) { e.preventDefault(); z.classList.add('over'); } });
  z.addEventListener('dragleave', () => z.classList.remove('over'));
  z.addEventListener('drop', (e) => {
    e.preventDefault(); z.classList.remove('over');
    const id = S.drag; S.drag = null;
    if (id) act(() => post(`admin/queue/${id}`, { to_end: true }), 'en fin de voie');
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
        el('button', { class: 'tb' + (pr === p ? ' on' : ''), title: `priorité ${lab}`, onclick: () => act(() => post(`admin/queue/${j.id}`, { priority: p })) }, s))),
      running ? null : el('button', { class: 'tb ghost sm' + (j.top ? ' on' : ''), title: j.top ? 'ne plus épingler' : 'épingler en tête de la file',
        onclick: () => act(() => post(`admin/queue/${j.id}`, { top: !j.top })) }, j.top ? 'épinglé' : 'en tête'),
      el('button', { class: 'tb ghost sm', onclick: () => act(() => post(`jobs/${j.id}/cancel`), running ? 'arrêt demandé' : 'retiré de la file') },
        running ? 'Arrêter' : 'Annuler')),
    running ? el('div', { class: 'bar' }, el('i', { style: { width: j.progress != null ? `${Math.round(j.progress * 100)}%` : '100%',
      opacity: j.progress != null ? 1 : 0.35 } })) : null);
  if (!running) dragify(row);
  return row;
}

function file() {
  const q = S.state.queue;
  const lanes = {};
  for (const j of q.queued) (lanes[j.lane] ||= []).push(j);
  const out = [head('La file des calculs', 'C', `${q.running.length} en cours · ${q.queued.length} en file`),
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('span', { class: 'nm' }, q.paused ? 'La file est en pause' : 'La file tourne'),
        q.paused ? el('span', { class: 'chip amb' }, el('i'), 'pause') : el('span', { class: 'chip ok' }, el('i'), 'active'),
        el('span', { class: 'sp' }),
        q.paused ? el('button', { class: 'tb go', onclick: () => act(() => post('admin/pause', { mode: 'active' }), 'la file reprend') }, 'Reprendre la file')
          : el('button', { class: 'tb ghost', onclick: () => act(() => post('admin/pause', { mode: 'paused' }), 'file en pause : ce qui tourne finit') }, 'Mettre la file en pause')),
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
      el('p', { class: 'adm-note' }, `Démarré à la demande, arrêté après ${h3.idle_minutes} min sans rendu ; ${h3.min_free_gb} Go libres exigés avant un rendu.`),
    ...(h3.instances || []).map((i) => el('div', { class: 'inst' }, el('span', { class: 'port' }, i.machine),
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
  if (!M) return [head('Les machines', 'D'), el('p', { class: 'lbl' }, 'relevé des machines…')];
  const fam = Object.entries(M.families.gb || {}).map(([k, v]) => `${k} ${v} Go`).join(' · ');
  return [head('Les machines', 'D', M.paused ? 'file en pause' : ''),
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
  if (!d) return [head('Câblage', 'E'), el('p', { class: 'lbl' }, 'lecture…')];
  const pending = d.items.filter((i) => i.pending);
  const setSw = (key, value) => act(async () => { S.sw = await post('admin/switches', { key, value }); }, `${key} = ${JSON.stringify(value)} : écrit, au redémarrage`);
  return [head('Câblage', 'E', d.file),
    el('p', { class: 'adm-note' }, 'Les interrupteurs de câblage des modèles. Ils s’écrivent dans showrunner.local.json dès le clic et prennent effet ',
      'au redémarrage du portail : le serveur ne relit ce fichier qu’au démarrage.'),
    pending.length ? el('div', { class: 'cmd' }, el('span', { class: 'why' }, 'à relancer'), el('code', {}, d.restart),
      el('button', { class: 'tb ghost sm', onclick: () => navigator.clipboard.writeText(d.restart).then(() => toast('copié'), () => toast(d.restart)) }, 'Copier')) : null,
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
function confirmBox(title, text, go, action) {
  const scrim = el('div', { class: 'scrim' }, el('div', { class: 'modal', role: 'dialog', 'aria-label': title },
    el('div', { class: 'modal-head' }, el('span', { class: 't' }, title)),
    el('div', { class: 'modal-body' }, el('p', {}, text)),
    el('div', { class: 'modal-foot' }, el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost', onclick: () => scrim.remove() }, 'Annuler'),
      el('button', { class: 'tb go', onclick: () => { scrim.remove(); action(); } }, go))));
  document.body.append(scrim);
}

function stockage() {
  const d = S.store;
  if (!d) return [head('Stockage', 'F'), el('p', { class: 'lbl' }, 'mesure…')];
  const total = d.parts.reduce((a, p) => a + p.bytes, 0);
  const trash = d.parts.find((p) => p.name === 'trash') || { bytes: 0 };
  const disk = d.disk;
  return [head('Stockage', 'F', d.data_dir),
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
  if (!d) return [head('Journal', 'G'), el('p', { class: 'lbl' }, 'lecture…')];
  const f = S.filter.toLowerCase();
  const rows = d.events.filter((e) => !f || JSON.stringify(e).toLowerCase().includes(f)).slice(0, 250);
  const detail = (e) => Object.entries(e).filter(([k]) => !['t', 'event', 'user'].includes(k) && !(k === 'by' && !e.user))
    .map(([k, v]) => (k === 'by' ? `par ${v}` : `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`)).join(' · ');
  return [head('Journal', 'G', `${d.events.length} événements`),
    el('div', { class: 'row' }, el('input', { class: 'fld', placeholder: 'filtrer (un nom, un chemin, un événement)', value: S.filter, style: { maxWidth: '420px' },
      oninput: (e) => {
        S.filter = e.target.value;
        render(true);
        const i = main.querySelector('input.fld');
        if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
      } })),
    el('div', {}, ...rows.map((e) => el('div', { class: 'jr' },
      el('span', {}, fmtDate(e.t)),
      el('span', { class: 'ev' + (BAD.has(e.event) || (e.status >= 400) ? ' bad' : e.event === 'demande' ? ' amb' : '') },
        e.event === 'http' ? `${e.method} ${e.status}` : e.event),
      el('span', {}, e.user || e.by || '—'),
      el('span', { class: 'd', title: detail(e) }, e.event === 'http' ? e.path : detail(e))))),
    el('span', { class: 'lbl' }, `le journal du serveur · ${d.log_file}`),
    el('pre', { class: 'log' }, d.log.length ? d.log.join('\n') : '(vide, ou pas de fichier)')];
}

addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id !== S.sec && SECTIONS.some(([x]) => x === id)) go(id); });
go(S.sec).then(() => refresh(true));
