// IDÉATION · OBJETS — les cartes tâche, lien, mesure, personne (étude
// ideation_atelier.md § 3.2 ; le prototype de Cal : outil C, ici K — C est le
// « commenter » de la collaboration). Une carte : un carré de couleur et sa
// sorte en tête, un titre, puis ce que sa sorte montre ; de près (Détail), les
// étapes d'une tâche, la description d'un lien, la courbe d'une mesure ; de
// loin (Ensemble), le carré de couleur et le titre.
//
//   { id, type: 'card', x, y, w, h, kind: task | link | metric | person, color, text, data }
//   data  task    { status 0-3, who, due, checks: [[texte, fait]…] }
//         link    { url, desc }
//         metric  { value, unit, delta, series: [nombres] }
//         person  { who, role, item }   item : un visage de la bibliothèque (image ou élément)
//
// Les écarts voulus avec le prototype (qui met du corail partout) : la
// progression et les cases cochées en vert (--grn2, « la progression »), les
// valeurs lues en acier ; l'orange reste à l'action.

import { el, href, pick, toast } from '../../commun/shell.js';
import { svg, icon, PALETTE } from './commun.js';
import { swatches } from './formes.js';

export const CARD_KINDS = {
  task:   { name: 'Tâche', ph: 'la tâche', color: 'or', d: 'M4 5h16v14H4zM7 10l2 2 4-4M7 16h10' },
  link:   { name: 'Lien', ph: 'le lien', color: 'cy', d: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1' },
  metric: { name: 'Mesure', ph: 'la mesure', color: 'grn2', d: 'M4 19h16M7 16V11M12 16V6M17 16v-4' },
  person: { name: 'Personne', ph: 'son nom', color: 'amb', d: 'M12 4a4 4 0 1 0 .01 0M5 20c0-4 3-6 7-6s7 2 7 6' },
};
export const CARD_ORDER = Object.keys(CARD_KINDS);
export const STATUS = ['À faire', 'En cours', 'Revue', 'Fait'];
export const TOOL_ICON = 'M3.5 5.5h17v13h-17zM3.5 9.5h17M7 13.5h6';
export const cardIcon = (k) => icon((CARD_KINDS[k] || CARD_KINDS.task).d);

export function cardData(kind) {
  if (kind === 'task') return { status: 0, who: '', due: '', checks: [['Première étape', false], ['Deuxième étape', false]] };
  if (kind === 'link') return { url: '', desc: '' };
  if (kind === 'metric') return { value: '', unit: '', delta: '', series: [] };
  return { who: '', role: '', item: '' };
}
export function cardDefaults(kind = 'task') {
  const k = CARD_KINDS[kind] ? kind : 'task';
  return { w: 300, h: k === 'task' ? 190 : 150, kind: k, color: CARD_KINDS[k].color, text: '', data: cardData(k) };
}
// les initiales : celles écrites, sinon celles du nom (« Léa Brun » : LB)
export const initials = (n) => (n.data?.who || (n.kind === 'person' ? String(n.text || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('') : '')).toUpperCase().slice(0, 4);
export const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');

// le visage d'une carte personne : la plus petite image de l'objet de la bibliothèque
function faceOf(app, n) {
  const it = n.data?.item ? app.S.items.get(n.data.item) : null;
  if (!it || it.missing) return null;
  const u = it.kind === 'element' ? it.element?.refs?.[0]?.thumb_url || it.thumb_url : it.thumb_url || it.url;
  return u ? href(u) : null;
}
function spark(series) {
  const s = (series || []).filter((v) => Number.isFinite(+v)).map(Number);
  if (s.length < 2) return null;
  const mx = Math.max(...s), mn = Math.min(...s);
  const d = s.map((y, j) => `${j ? 'L' : 'M'}${(j / (s.length - 1) * 100).toFixed(1)} ${(22 - (y - mn) / Math.max(1e-9, mx - mn) * 20).toFixed(1)}`).join(' ');
  return svg('svg', { class: 'cspk', viewBox: '0 0 100 24', preserveAspectRatio: 'none' }, svg('path', { d }));
}

export function buildCard(app, n) {
  const d = n.data || {};
  const k = CARD_KINDS[n.kind] || CARD_KINDS.task;
  // un geste sur la carte relit l'objet par son identifiant (après une annulation, il a été remplacé)
  const act = (fn) => (e) => { e.stopPropagation(); const cur = app.node(n.id); if (cur) app.mutate(() => fn(cur)); };
  const st = Math.max(0, Math.min(3, d.status | 0));
  const head = el('div', { class: 'chd' }, el('i', { class: 'cdot' }), el('span', { class: 'ck' }, k.name),
    n.kind === 'task' ? el('button', { class: `cst s${st}`, type: 'button', title: 'l’état — un clic : le suivant', onclick: act((c) => { c.data = { ...c.data, status: ((c.data?.status | 0) + 1) % 4 }; }) }, STATUS[st]) : null);
  const body = [head, el('div', { class: 'txt' + (n.text ? '' : ' ph') }, n.text || k.ph)];
  const who = initials(n);
  if (n.kind === 'task') {
    const checks = Array.isArray(d.checks) ? d.checks : [];
    const done = checks.filter((c) => c[1]).length;
    body.push(el('div', { class: 'crow' }, el('span', { class: 'cav' + (who ? '' : ' ph') }, who || '—'),
      el('span', { class: 'cdue' }, d.due || ''),
      checks.length ? el('span', { class: 'cbar' }, el('i', { style: { width: `${Math.round(done / checks.length * 100)}%` } })) : el('span', { class: 'sp' }),
      checks.length ? el('span', { class: 'cpr' }, `${done}/${checks.length}`) : null));
    if (checks.length) {
      body.push(el('div', { class: 'cchk' }, ...checks.map(([t, on], i) => el('button', { class: 'cc' + (on ? ' on' : ''), type: 'button', title: on ? 'fait — un clic : à refaire' : 'un clic : fait',
        onclick: act((c) => { const L = (c.data?.checks || []).map((x) => [...x]); if (L[i]) L[i][1] = !L[i][1]; c.data = { ...c.data, checks: L }; }) },
      el('i'), el('span', {}, t || 'étape')))));
    }
  } else if (n.kind === 'link') {
    body.push(el('span', { class: 'curl' + (d.url ? '' : ' ph') }, d.url || 'l’adresse'));
    if (d.desc) body.push(el('p', { class: 'cdesc' }, d.desc));
  } else if (n.kind === 'metric') {
    body.push(el('div', { class: 'cmet' }, el('b', { class: 'cval' + (d.value ? '' : ' ph') }, d.value || '—'), el('span', { class: 'cun' }, d.unit || ''),
      el('span', { class: 'cdel' }, d.delta || '')), spark(d.series));
  } else {
    const face = faceOf(app, n);
    body.push(el('div', { class: 'cper' }, el('span', { class: 'cav big' + (face ? ' face' : who ? '' : ' ph'), style: face ? { backgroundImage: `url("${face}")` } : null }, face ? '' : who || '?'),
      el('span', { class: 'crole' + (d.role ? '' : ' ph') }, d.role || 'rôle')));
  }
  return { cls: [`k-${n.kind}`], style: { '--k': `var(--${n.color || k.color})` }, body };
}

export function cardMenu(app, n) {
  const set = (fn) => () => { const c = app.node(n.id); if (c) app.mutate(() => fn(c)); };
  const out = [
    { label: 'Écrire le titre', key: 'Entrée', onclick: () => app.canvas.editText(n.id) },
    { label: 'Sorte', items: CARD_ORDER.map((k) => ({ label: CARD_KINDS[k].name, checked: n.kind === k, onclick: set((c) => changeKind(c, k)) })) },
    { label: 'Couleur', items: PALETTE.map((c) => ({ label: c.name, dot: c.id, checked: n.color === c.id, onclick: set((x) => { x.color = c.id; }) })) },
  ];
  if (n.kind === 'task') out.push({ label: 'État', items: STATUS.map((s, i) => ({ label: s, checked: (n.data?.status | 0) === i, onclick: set((c) => { c.data = { ...c.data, status: i }; }) })) });
  if (n.kind === 'link') {
    const u = safeUrl(n.data?.url);
    out.push({ label: 'Ouvrir le lien', icon: '↗', disabled: !u, why: 'une adresse en http:// ou https:// d’abord (le panneau de droite)', onclick: () => window.open(u, '_blank', 'noopener') });
  }
  if (n.kind === 'person') {
    out.push({ label: 'Visage…', sub: 'depuis la bibliothèque', onclick: () => pickFace(app, n.id) });
    if (n.data?.item) out.push({ label: 'Retirer le visage', onclick: set((c) => { c.data = { ...c.data, item: '' }; }) });
  }
  return out;
}
// changer de sorte : le titre et la couleur restent, les champs sont ceux de la nouvelle sorte
export function changeKind(c, k) {
  if (c.kind === k) return;
  c.kind = k;
  c.data = cardData(k);
  c.h = Math.max(c.h, k === 'task' ? 190 : 150);
}
export async function pickFace(app, id) {
  const got = await pick({ kinds: ['image', 'element'], multiple: false, title: 'Le visage de la carte' });
  const it = got?.[0];
  const c = app.node(id);
  if (!it || !c) return;
  app.S.items.set(it.id, it);
  app.mutate(() => { c.data = { ...c.data, item: it.id }; if (!c.text && it.title) c.text = it.title; });
}

// une image ou un élément lâché sur une carte personne : son visage (l'objet revient à sa place)
export function faceRule(app) {
  const ok = (mv, t) => mv.length === 1 && mv[0].type === 'media' && ['image', 'element'].includes(mv[0].kind) && t?.type === 'card' && t.kind === 'person'
    && !app.S.items.get(mv[0].item)?.missing;
  return {
    name: 'visage d’une carte personne', cls: 'drop-grp', tag: 'VISAGE',
    test: (mv, t) => (ok(mv, t) ? 'lâcher : le visage de la carte (l’image revient à sa place)' : ''),
    run: (mv, t, orig) => {
      for (const [n, x, y] of orig) { n.x = x; n.y = y; }
      const it = app.S.items.get(mv[0].item);
      t.data = { ...t.data, item: mv[0].item };
      if (!t.text && it?.title) t.text = it.title;
      app.commit();
      toast('le visage de la carte — ctrl+Z le retire');
    },
  };
}

export function cardPanel(app, n, K) {
  const { card, row, hint, b } = K;
  const d = n.data || {};
  // un champ : chaque frappe suit sur la carte, un seul pas d'annulation pour la saisie
  const field = (label, value, set, { ph = '', max = 200, area = false, cls = '' } = {}) => {
    const f = el(area ? 'textarea' : 'input', { class: `fld sm ${cls}`.trim(), placeholder: ph, maxlength: max, rows: area ? 3 : null });
    f.value = value || '';
    let ch = () => {};
    f.addEventListener('focus', () => { ch = app.editing(); });
    f.addEventListener('input', () => { ch(); const c = app.node(n.id); if (c) set(c, f.value); app.canvas.renderSoon(); });
    return label ? el('label', { class: 'look' }, el('span', { class: 'lbl' }, label), f) : f;
  };
  const setData = (k2) => (c, v) => { c.data = { ...c.data, [k2]: v }; };
  const seg = (items) => el('div', { class: 'seg' }, ...items.map(([on, label, fn]) => el('button', { class: 'tb' + (on ? ' on' : ''), type: 'button', onclick: fn }, label)));
  const mut = (fn) => () => { const c = app.node(n.id); if (c) app.mutate(() => fn(c)); };
  const parts = [field('', n.text, (c, v) => { c.text = v; }, { ph: CARD_KINDS[n.kind]?.ph || 'le titre', max: 300 }),
    seg(CARD_ORDER.map((k) => [n.kind === k, CARD_KINDS[k].name, mut((c) => changeKind(c, k))])),
    swatches(app, n, 'card-color')];
  if (n.kind === 'task') {
    const checks = Array.isArray(d.checks) ? d.checks : [];
    parts.push(seg(STATUS.map((s, i) => [(d.status | 0) === i, s, mut((c) => { c.data = { ...c.data, status: i }; })])),
      field('qui', d.who, setData('who'), { ph: 'initiales', max: 4 }), field('échéance', d.due, setData('due'), { ph: '12 oct', max: 24 }),
      el('div', { class: 'ob-checks' }, ...checks.map(([t, on], i) => el('div', { class: 'ob-chk' },
        (() => { const c = el('input', { type: 'checkbox', checked: on ? true : null, title: 'fait' }); c.addEventListener('change', mut((x) => { const L = x.data.checks.map((y) => [...y]); L[i][1] = c.checked; x.data = { ...x.data, checks: L }; })); return c; })(),
        field('', t, (x, v) => { const L = x.data.checks.map((y) => [...y]); L[i][0] = v; x.data = { ...x.data, checks: L }; }, { ph: 'étape', max: 200 }),
        b('×', mut((x) => { x.data = { ...x.data, checks: x.data.checks.filter((_, j) => j !== i) }; }), { title: 'retirer l’étape' })))),
      row(b('Ajouter une étape', mut((x) => { x.data = { ...x.data, checks: [...(x.data.checks || []), ['', false]].slice(0, 20) }; }), { disabled: checks.length >= 20 })));
  } else if (n.kind === 'link') {
    const u = safeUrl(d.url);
    parts.push(field('adresse', d.url, setData('url'), { ph: 'https://…', max: 500 }), field('', d.desc, setData('desc'), { ph: 'une description (de près)', max: 1000, area: true }),
      row(b('Ouvrir ↗', () => window.open(u, '_blank', 'noopener'), { disabled: !u, title: u ? u : 'une adresse en http:// ou https://' })));
  } else if (n.kind === 'metric') {
    parts.push(field('valeur', d.value, setData('value'), { ph: '98.4', max: 24 }), field('unité', d.unit, setData('unit'), { ph: '%', max: 12 }),
      field('écart', d.delta, setData('delta'), { ph: '+1.2', max: 12 }),
      field('courbe', (d.series || []).join(' '), (c, v) => { c.data = { ...c.data, series: v.split(/[\s;,]+/).map(Number).filter(Number.isFinite).slice(0, 60) }; }, { ph: 'des nombres : 8 10 9 12', max: 600 }));
  } else {
    parts.push(field('initiales', d.who, setData('who'), { ph: 'celles du nom', max: 4 }), field('rôle', d.role, setData('role'), { ph: 'le rôle', max: 60 }),
      row(b(d.item ? 'Changer le visage…' : 'Visage…', () => pickFace(app, n.id), { title: 'une image ou un personnage de la bibliothèque' }),
        d.item ? b('Retirer', mut((c) => { c.data = { ...c.data, item: '' }; })) : null),
      hint('Glissez une image ou un personnage de la planche sur la carte : il devient son visage.'));
  }
  parts.push(hint(n.kind === 'task' ? 'Un clic sur l’état de la carte le fait avancer ; de près (au-dessus de 130 %), les étapes se cochent sur la carte.'
    : n.kind === 'metric' ? 'De près (au-dessus de 130 %), la carte montre sa courbe.' : n.kind === 'link' ? 'De près (au-dessus de 130 %), la carte montre sa description.' : 'double-clic sur la carte : écrire le nom'));
  return [card('Carte', CARD_KINDS[n.kind]?.name || '', ...parts)];
}
