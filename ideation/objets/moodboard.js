// IDÉATION · OBJETS — le moodboard (05/10/2026). Cal : « une fonction de moodboard avancée dans
// Idéation : on en fait un élément qu'on remplit d'images et qui fera un LoRA pour nos modèles
// image et vidéo, un truc de cohérence de style comme les moodboards de Midjourney. C'est une
// carte, et quand on dépose des images dedans elle ne grossit pas ; en double-clic, elle
// s'agrandit pour montrer tous les visuels dedans. On peut gérer le lancement des LoRA, voir si
// le LoRA est à jour (si on a ajouté des images il faut le recalculer, mais on peut l'utiliser
// quand même s'il ne l'est pas)… ça peut être une tâche planifiée la nuit (les DGX, des heures). »
//
//   { id, type: 'moodboard', x, y, w, h, name, items: [ids d'images], open, wc, hc }
//   open   ouvert (double-clic) : toutes ses images ; fermé : une mosaïque de neuf au plus,
//          à taille fixe. wc, hc : la taille fermée, gardée pendant qu'il est ouvert.
//
// Y entrent : une image de la planche lâchée dessus (app.dropRules : elle quitte la planche et
// rejoint le moodboard), une image glissée du panneau Asset ou un fichier du disque (dropZone).
// Le LoRA : server/tools/lora.py (son état, ses versions, le lancer, le planifier la nuit) ;
// à jour = les images de la dernière version sont celles du moodboard.

import { el, href, api, toast, dropZone } from '../../commun/shell.js';
import { icon, cut } from './commun.js';

export const MOOD_ICON = 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z';
const SIZE = [264, 250];
const OPEN_W = 760;
const states = new Map();   // id de l'objet → l'état de son LoRA (lu au serveur)
const asked = new Map();    // id → l'heure de la dernière lecture
let models = null;          // les modèles cibles (GET /api/lora/models)

export function extendMoodboard(app, api0) {
  const { S } = app;
  const thumb = (id) => { const it = S.items.get(id); return it && !it.missing ? it.thumb_url || (it.kind === 'image' ? it.url : '') : ''; };
  // un moodboard de sons (Cal, 05/10 : « des LoRA pour nos modèles image, vidéo et son ») : que des sons,
  // pour ACE-Step ; sinon des images. La sorte se lit dans ses objets, la première qui entre décide
  const kindOf = (n) => { const k = (n.items || []).map((id) => S.items.get(id)?.kind).find(Boolean); return k === 'audio' ? 'audio' : 'image'; };
  const word = (n, k) => (kindOf(n) === 'audio' ? (k > 1 ? 'sons' : 'son') : (k > 1 ? 'images' : 'image'));
  const MIN = { image: 4, audio: 2 };

  // ── l'état du LoRA : lu au serveur, relu tant qu'un entraînement est prévu ou en cours ──
  async function refresh(id, { force = false } = {}) {
    if (!S.board) return null;
    const t = asked.get(id) || 0;
    if (!force && Date.now() - t < 4000) return states.get(id) || null;
    asked.set(id, Date.now());
    try {
      const s = await api(`lora/${S.board.id}/${id}`);
      models = s.models || models;
      const before = JSON.stringify(states.get(id) || null);
      states.set(id, s);
      if (JSON.stringify(s) !== before) { const d = app.canvas?.dom.get(id); if (d) d.key = ''; app.canvas?.renderSoon(); if (S.sel.has(id)) app.insp.render(); }
      return s;
    } catch { return null; }
  }
  // un entraînement prévu ou en cours : relu toutes les 10 s, tant qu'il l'est
  setInterval(() => {
    if (!S.board || document.hidden) return;
    for (const n of S.board.nodes) if (n.type === 'moodboard') { const s = states.get(n.id); if (s && (s.job || s.plan)) refresh(n.id, { force: true }); }
  }, 10000);

  // à jour ? les images de la dernière version contre celles du moodboard
  function status(n) {
    const s = states.get(n.id);
    if (!s) return { k: 'idle', label: 'LoRA · …' };
    const last = s.versions?.[s.versions.length - 1];
    const j = s.job_state;
    if (s.job && j && !j.finished) {
      return j.state === 'running' ? { k: 'run', label: `LoRA · ${Math.round((j.progress || 0) * 100)} %`, why: j.message || '' }
        : { k: 'queue', label: 'LoRA · en file', why: j.message || '' };
    }
    if (s.plan) return { k: 'plan', label: `LoRA · ${s.plan.at.slice(11, 16)}`, why: `prévu le ${s.plan.at.replace('T', ' à ')}` };
    if (!last) return { k: 'none', label: 'pas de LoRA', why: s.last_job?.state === 'error' ? s.last_job.message : '' };
    const cur = new Set(n.items || []), was = new Set(last.items || []);
    const add = [...cur].filter((x) => !was.has(x)).length, rem = [...was].filter((x) => !cur.has(x)).length;
    if (!add && !rem) return { k: 'ok', label: `LoRA v${last.v} · à jour` };
    return { k: 'stale', label: `LoRA v${last.v} · périmé`, why: `${add ? `${add} image${add > 1 ? 's' : ''} ajoutée${add > 1 ? 's' : ''}` : ''}${add && rem ? ', ' : ''}${rem ? `${rem} retirée${rem > 1 ? 's' : ''}` : ''} depuis la v${last.v} — elle reste utilisable` };
  }

  // ── le dessin ─────────────────────────────────────────────
  function build(n) {
    if (!states.has(n.id)) refresh(n.id);
    const ids = n.items || [];
    const st = status(n);
    const MAXC = 9;
    const shown = n.open ? ids : ids.slice(0, ids.length > MAXC ? MAXC - 1 : MAXC);
    const more = n.open ? 0 : ids.length - shown.length;
    const cell = (id) => {
      const u = thumb(id);
      const it = S.items.get(id);
      const c = el('div', { class: 'mb-c' + (it?.kind === 'audio' ? ' snd' : ''), 'data-item': id, title: it?.title || id },
        u ? el('img', { src: href(u), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' })
          : it?.kind === 'audio' ? el('span', { class: 'mb-snd' }, icon('M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10'), el('b', {}, cut(it.title || 'son', 22)))
            : el('span', { class: 'mb-miss' }, '?'));
      if (n.open) c.append(el('button', { class: 'mb-x', type: 'button', title: 'retirer du moodboard (l’image reste dans la bibliothèque)', 'data-rm': id }, '×'));
      return c;
    };
    const grid = el('div', { class: 'mb-g' + (n.open ? ' open' : '') }, ...shown.map(cell),
      more > 0 ? el('div', { class: 'mb-c mb-more' }, `+${more + 1}`) : null,
      !ids.length ? el('p', { class: 'mb-empty' }, 'déposez des images (un LoRA d’image ou de vidéo) ou des sons (un LoRA de son) : de la planche, du panneau Asset ou du disque') : null);
    const root = el('div', { class: 'mb' },
      el('div', { class: 'mb-h' }, el('span', { class: 'mb-k' }, 'moodboard'), el('b', { class: 'mb-n', title: n.name || '' }, n.name || 'sans nom'),
        el('span', { class: 'sp' }), el('span', { class: 'mb-cnt' }, String(ids.length))),
      grid,
      el('div', { class: 'mb-f' }, el('span', { class: `mb-lora ${st.k}`, title: st.why || '' }, el('i'), st.label),
        el('span', { class: 'sp' }), el('span', { class: 'mb-hint' }, n.open ? 'double-clic : refermer' : 'double-clic : tout voir')));
    root.addEventListener('click', (e) => {
      const rm = e.target.closest?.('[data-rm]');
      if (!rm) return;
      e.stopPropagation();
      removeItem(n.id, rm.dataset.rm);
    });
    root.addEventListener('dblclick', (e) => {
      const c = app.node(n.id);
      if (!c || (c.group && S.focus !== c.group)) return;
      e.stopPropagation();
      toggle(c.id);
    });
    // une image du panneau Asset ou un fichier du disque (rangé dans la bibliothèque, Upload)
    dropZone(root, { kinds: ['image', 'audio'], via: 'ideation', label: 'le moodboard', onitems: (items) => addItems(n.id, items) });
    return { cls: ['mb-node', n.open ? 'open' : ''].filter(Boolean), body: [root] };
  }
  const key = (n) => `|${(n.items || []).map((id) => (thumb(id) ? 1 : 0)).join('')}|${JSON.stringify(status(n))}`;

  // ── les gestes ────────────────────────────────────────────
  function toggle(id) {
    const n = app.node(id);
    if (!n) return;
    app.mutate(() => {
      if (n.open) {
        n.open = false;
        n.w = n.wc || SIZE[0]; n.h = n.hc || SIZE[1];
        delete n.wc; delete n.hc;
      } else {
        n.wc = n.w; n.hc = n.h;
        n.open = true;
        const cols = 5, cw = (OPEN_W - 24 - (cols - 1) * 6) / cols;
        const rows = Math.max(1, Math.ceil((n.items || []).length / cols));
        n.w = OPEN_W; n.h = Math.round(36 + 34 + 12 + rows * (cw + 6));
      }
    });
  }
  function addItems(id, items) {
    const n = app.node(id);
    if (!n) return;
    const want = (n.items || []).length ? kindOf(n) : (items.find((it) => it.kind === 'image' || it.kind === 'audio')?.kind || 'image');
    const imgs = items.filter((it) => it.kind === want);
    if (!imgs.length) { toast(want === 'audio' ? 'ce moodboard est un moodboard de sons : il ne prend que des sons' : 'ce moodboard prend des images (ou, vide, des sons)'); return; }
    if (imgs.length < items.length) toast(`un moodboard ne mélange pas images et sons : ${items.length - imgs.length} laissé${items.length - imgs.length > 1 ? 's' : ''} de côté`, 5000);
    for (const it of imgs) S.items.set(it.id, it);
    const before = new Set(n.items || []);
    const fresh = imgs.filter((it) => !before.has(it.id));
    if (!fresh.length) { toast('déjà dans le moodboard'); return; }
    app.mutate(() => { n.items = [...(n.items || []), ...fresh.map((it) => it.id)]; if (n.open) fitOpen(n); });
    toast(`${fresh.length} ${want === 'audio' ? 'son' : 'image'}${fresh.length > 1 ? 's' : ''} dans « ${n.name || 'moodboard'} »${states.get(id)?.versions?.length ? ' — le LoRA est maintenant périmé (il reste utilisable)' : ''}`);
  }
  function removeItem(id, item) {
    const n = app.node(id);
    if (!n) return;
    app.mutate(() => { n.items = (n.items || []).filter((x) => x !== item); if (n.open) fitOpen(n); });
  }
  function fitOpen(n) {
    const cols = 5, cw = (OPEN_W - 24 - (cols - 1) * 6) / cols;
    n.h = Math.round(36 + 34 + 12 + Math.max(1, Math.ceil((n.items || []).length / cols)) * (cw + 6));
  }
  // une image de la planche lâchée sur le moodboard : elle y entre et quitte la planche
  const rule = {
    name: 'ajouter au moodboard', cls: 'drop-grp', tag: 'MOODBOARD',
    test: (mv, t) => {
      if (t?.type !== 'moodboard' || !mv.length) return '';
      const k = (t.items || []).length ? kindOf(t) : mv[0].kind;
      if (!mv.every((m) => m.type === 'media' && m.kind === k && (k === 'image' || k === 'audio') && !S.items.get(m.item)?.missing)) return '';
      return `lâcher : ${mv.length > 1 ? `ces ${mv.length} ${k === 'audio' ? 'sons' : 'images'} entrent` : k === 'audio' ? 'le son entre' : 'l’image entre'} dans le moodboard`;
    },
    run: (mv, t) => {
      const ids = new Set(mv.map((m) => m.id));
      const have = new Set(t.items || []);
      t.items = [...(t.items || []), ...mv.map((m) => m.item).filter((x) => !have.has(x))];
      if (t.open) fitOpen(t);
      S.board.nodes = S.board.nodes.filter((m) => !ids.has(m.id));
      S.board.links = S.board.links.filter((l) => !ids.has(l.a) && !ids.has(l.b));
      for (const x of ids) S.sel.delete(x);
      app.commit();
      toast(`dans « ${t.name || 'moodboard'} » — ctrl+Z les remet sur la planche`);
    },
  };

  // ── le LoRA : lancer, planifier, annuler ─────────────────
  async function train(id, { model, when }) {
    const n = app.node(id);
    if (!n || !S.board) return;
    await app.flushSave?.();
    try {
      const s = await api(`lora/${S.board.id}/${id}/train`, { method: 'POST', body: { items: n.items || [], model, when, name: n.name || '' } });
      states.set(id, s);
      models = s.models || models;
      toast(when === 'now' ? 'entraînement en file : il occupe un DGX pendant des heures' : `entraînement prévu à ${when}`, 6000);
    } catch (e) { toast(e.message, 8000); }
    const d = app.canvas?.dom.get(id); if (d) d.key = '';
    app.render(); app.insp.render();
  }
  async function cancel(id) {
    try { states.set(id, await api(`lora/${S.board.id}/${id}/cancel`, { method: 'POST', body: {} })); } catch (e) { toast(e.message, 6000); }
    const d = app.canvas?.dom.get(id); if (d) d.key = '';
    app.render(); app.insp.render();
  }
  // la fenêtre « Entraîner » : le modèle cible, maintenant ou la nuit, ce que ça coûte
  function trainModal(id, preset = 'night') {
    const n = app.node(id);
    if (!n) return;
    const kind = kindOf(n);
    const ms = (models || []).filter((m) => m.kind === kind);
    if (!ms.length) { refresh(id, { force: true }).then(() => (models ? trainModal(id, preset) : toast('les modèles ne se lisent pas : le portail répond-il ?'))); return; }
    let model = (ms.find((m) => m.ready) || ms[0]).id, when = preset;
    const time = el('input', { class: 'fld sm', type: 'time', value: '01:00', step: 60, title: 'l’heure de la machine' });
    const why = el('p', { class: 'why' });
    const go = el('button', { class: 'tb go', type: 'button' }, 'Lancer');
    const seg = (list, cur, set) => el('div', { class: 'seg' }, ...list.map(([k, v, t]) => el('button', { class: 'tb' + (cur() === k ? ' on' : ''), type: 'button', title: t || '',
      onclick: (e) => { set(k); for (const b of e.currentTarget.parentNode.children) b.classList.toggle('on', b === e.currentTarget); paint(); } }, v)));
    const paint = () => {
      const m = ms.find((x) => x.id === model);
      const few = (n.items || []).length < MIN[kind];
      why.textContent = !m.ready ? m.why : few ? `il faut au moins ${MIN[kind]} ${word(n, 2)}` : `${m.name} : environ ${m.hours} d’un DGX entier, qui ne fait rien d’autre pendant ce temps.`;
      go.disabled = !m.ready || few;
      go.textContent = when === 'now' ? 'Lancer maintenant' : 'Planifier';
      time.disabled = when === 'now';
    };
    const body = el('div', { class: 'stack mb-train' },
      el('p', { class: 'hint' }, `« ${n.name || 'moodboard'} » · ${(n.items || []).length} ${word(n, 2)}. Le LoRA apprend leur style commun ; la version d’avant reste utilisable pendant l’entraînement.`),
      el('span', { class: 'lbl' }, 'pour le modèle'),
      seg(ms.map((m) => [m.id, m.name, m.ready ? `prêt · environ ${m.hours}` : m.why]), () => model, (k) => { model = k; }),
      el('span', { class: 'lbl' }, 'quand'),
      seg([['night', 'Cette nuit', 'à l’heure choisie (par défaut 1 h) : les DGX sont libres'], ['now', 'Maintenant', 'tout de suite : un DGX est pris pendant des heures']], () => when, (k) => { when = k; }),
      el('label', { class: 'look' }, el('span', { class: 'lbl' }, 'à'), time),
      why);
    const close = app.modal('Entraîner le LoRA', body, (cl) => [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: cl }, 'Annuler'), go]);
    go.addEventListener('click', () => { close(); train(id, { model, when: when === 'now' ? 'now' : time.value || '01:00' }); });
    paint();
  }

  // ── les menus, l'inspecteur ──────────────────────────────
  function menu(n) {
    const s = states.get(n.id);
    return [
      { label: n.open ? 'Refermer' : 'Tout voir', sub: 'double-clic', onclick: () => toggle(n.id) },
      { label: 'Entraîner le LoRA…', sub: 'maintenant ou la nuit', disabled: !(n.items || []).length, why: 'le moodboard est vide', onclick: () => trainModal(n.id) },
      s?.job || s?.plan ? { label: s.job ? 'Arrêter l’entraînement' : 'Annuler le plan', danger: true, onclick: () => cancel(n.id) } : null,
    ].filter(Boolean);
  }
  function panels(n, K) {
    const { card, row, hint, b } = K;
    refresh(n.id);
    const s = states.get(n.id);
    const st = status(n);
    const nm = el('input', { class: 'fld sm', value: n.name || '', maxlength: 120, placeholder: 'le nom du moodboard', 'data-reg': 'name' });
    let ch = () => {};
    nm.addEventListener('focus', () => { ch = app.editing(); });
    nm.addEventListener('input', () => { ch(); const c = app.node(n.id); if (c) c.name = nm.value; app.canvas.renderSoon(); });
    const vers = (s?.versions || []).slice().reverse();
    const mname = (id) => (models || []).find((m) => m.id === id)?.name || id;
    return [
      card(kindOf(n) === 'audio' ? 'Moodboard de sons' : 'Moodboard', `${(n.items || []).length} ${word(n, (n.items || []).length)}`,
        el('label', { class: 'look' }, el('span', { class: 'lbl' }, 'nom'), nm),
        row(b(n.open ? 'Refermer' : 'Tout voir', () => toggle(n.id), { title: 'double-clic sur la carte aussi' })),
        hint('Glissez-y des images (un LoRA d’image ou de vidéo) ou des sons (un LoRA de son), sans les mélanger : de la planche (ils y entrent), du panneau Asset ou du disque. Fermé, il garde sa taille ; ouvert, il montre tout et chacun se retire (×).')),
      card('LoRA de style', st.label.replace(/^LoRA · /, ''),
        el('p', { class: `mb-lora big ${st.k}` }, el('i'), st.label),
        st.why ? hint(st.why) : null,
        s?.last_job && s.last_job.state === 'error' ? el('p', { class: 'why' }, `dernier essai : ${s.last_job.message}`) : null,
        s?.job || s?.plan
          ? row(b(s.job ? 'Arrêter' : 'Annuler le plan', () => cancel(n.id)))
          : row(b('Planifier cette nuit', () => trainModal(n.id, 'night'), { disabled: (n.items || []).length < MIN[kindOf(n)], title: (n.items || []).length < MIN[kindOf(n)] ? `il faut au moins ${MIN[kindOf(n)]} ${word(n, 2)}` : 'à 1 h par défaut : les DGX sont libres' }),
            b('Maintenant…', () => trainModal(n.id, 'now'), { disabled: (n.items || []).length < MIN[kindOf(n)] })),
        vers.length ? el('div', { class: 'mb-vers' }, ...vers.map((v) => el('div', { class: 'mb-v' }, el('b', {}, `v${v.v}`),
          el('span', {}, `${mname(v.model)} · ${(v.items || []).length} ${word(n, 2)} · ${(v.at || '').slice(0, 16).replace('T', ' ')}${v.factice ? ' · essai' : ''}${v.comfy ? ` · ${v.comfy}${v.trigger ? ` (mot : ${v.trigger})` : ''}` : ''}`)))) : null,
        hint('Un entraînement occupe un DGX entier pendant des heures : planifiez-le la nuit. Une image ajoutée rend le LoRA périmé ; la dernière version reste utilisable jusqu’au suivant.')),
    ];
  }

  const L0 = app.label, K0 = app.kindLabel;
  app.label = (n) => (n?.type === 'moodboard' ? cut(n.name || 'moodboard', 42) : L0(n));
  app.kindLabel = (n) => (n?.type === 'moodboard' ? 'moodboard' : K0(n));

  api0.TYPES.add('moodboard');
  api0.defs.moodboard = () => ({ w: SIZE[0], h: SIZE[1], name: `Moodboard ${(S.board?.nodes || []).filter((x) => x.type === 'moodboard').length + 1}`, items: [], open: false });
  const wrap = (k, fn) => { const f0 = api0[k]; api0[k] = (n, ...a) => (n?.type === 'moodboard' ? fn(n, ...a) : f0(n, ...a)); };
  wrap('build', build);
  wrap('key', key);
  wrap('menu', menu);
  wrap('panels', panels);
  wrap('mini', (n, tok) => tok('amb'));
  const I0 = api0.items;
  api0.items = (board) => [...I0(board), ...(board?.nodes || []).filter((n) => n.type === 'moodboard').flatMap((n) => n.items || [])];
  const B0 = api0.boardItems;
  api0.boardItems = (wx, wy) => [...B0(wx, wy), { label: 'Moodboard', sub: 'des images → un LoRA de style', onclick: () => place(wx, wy) }];
  function place(wx, wy) {
    if (!S.board) { toast('ouvrez ou créez d’abord une planche'); return null; }
    return app.addAt('moodboard', wx - SIZE[0] / 2, wy - SIZE[1] / 2, { select: true });
  }
  app.moodboard = { place, toggle, addItems, train, cancel, trainModal, refresh, rule, status, state: (id) => states.get(id) || null };
  return api0;
}

// le bouton de l'outil, dans la barre de gauche
export function moodTool(app) {
  return el('button', { class: 'ic', type: 'button', title: 'un moodboard : des images d’où naît un LoRA de style', onclick: () => {
    const [x, y] = app.canvas.center();
    app.moodboard.place(x, y);
  } }, icon(MOOD_ICON));
}
