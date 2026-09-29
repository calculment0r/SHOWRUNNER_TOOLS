// IDÉATION — les liens sur la planche : les dessiner, placer les ports des
// cartes à la hauteur de leur ligne, et le geste « tirer un fil ».
//
//   - Les fils (kind 'wire') : la courbe d'ODIO (commun/wire.js), dans la
//     teinte de ce qu'ils portent ; un fil qui ne va plus (un modèle qui ne
//     prend pas de référence, un mode sans cette entrée…) passe en alerte et
//     dit pourquoi au survol — jamais relu en silence. La lignée (kind 'out' :
//     une carte et ses résultats) : la même courbe, en tirets, plus fine. Les
//     annotations (arrow, line) : les flèches droites de toujours.
//   - Tirer depuis une sortie (ou une entrée) : ce qui peut s'y brancher
//     s'allume, le reste s'éteint ; lâché sur une carte, le fil va sur la
//     bonne entrée (celle qu'on survole, la seule qui prend, ou un petit
//     choix) ; lâché dans le vide, un menu crée un objet déjà branché.
//
// Ce qui peut se brancher ne se décide pas ici : ports.js (canWire, flow).

import { wire, tempWire, paintTemp } from '../commun/wire.js';
import { menu } from '../commun/menu.js';
import { toast, pick } from '../commun/shell.js';
import { KINDS, VMODES, TEXT_TYPES, outPort, inPorts, canWire, replaces, makersFor, nameOf, oneOf } from './ports.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  return n;
};
const CARDS = new Set(['gen', 'vgen', 'compose']);

// le segment d'une boîte à l'autre, de bord à bord (même calcul que l'export) : les flèches d'annotation
export function edgePts(a, b) {
  const clip = (n, dx, dy) => {
    if (!dx && !dy) return [0, 0];
    const t = Math.min(dx ? (n.w / 2) / Math.abs(dx) : Infinity, dy ? (n.h / 2) / Math.abs(dy) : Infinity);
    return [dx * t, dy * t];
  };
  const ca = [a.x + a.w / 2, a.y + a.h / 2], cb = [b.x + b.w / 2, b.y + b.h / 2];
  const dx = cb[0] - ca[0], dy = cb[1] - ca[1];
  const [ox, oy] = clip(a, dx, dy), [ix, iy] = clip(b, -dx, -dy);
  return [[ca[0] + ox, ca[1] + oy], [cb[0] + ix, cb[1] + iy]];
}

export function createWires(app, env) {
  const { S } = app;
  const { cv, layer, dom, toWorld, drag, hint, HINT } = env;
  const temp = tempWire();

  // ── les ports : à la hauteur de leur ligne (data-anchor="in:prompt", "out:image"…)
  // sans ligne visible (de loin, une entrée que le mode n'a plus) : en haut d'une carte, au milieu d'un objet
  const fallback = (n) => (CARDS.has(n.type) ? Math.min(30, n.h / 2) : n.h / 2);
  function placePorts() {
    const z = S.view.z;
    const put = [];   // tout lire d'abord, tout écrire ensuite : une seule mise en page
    for (const [id, d] of dom) {
      const n = app.node(id);
      const pts = n ? d.el.querySelectorAll(':scope > .pt') : [];
      if (!pts.length) continue;
      const top = CARDS.has(n.type) ? d.el.getBoundingClientRect().top : 0;
      d.py = {};
      for (const p of pts) {
        const k = `${p.dataset.side}:${p.dataset.port}`;
        const a = CARDS.has(n.type) ? d.el.querySelector(`[data-anchor="${CSS.escape(k)}"]`) : null;
        const r = a && a.offsetParent !== null ? a.getBoundingClientRect() : null;
        const y = r && r.height ? Math.round(((r.top + r.height / 2 - top) / z) * 10) / 10 : fallback(n);
        put.push([p, y]);
        d.py[k] = y;
      }
    }
    for (const [p, y] of put) p.style.top = `${y}px`;
  }
  // un bout de fil, en coordonnées de la planche ; un objet caché dans un groupe réduit
  // (canvas.js, env.alias) : le port de la carte du groupe
  function portPoint(n, port, side) {
    const al = env.alias?.(n.id, port, side);
    if (al) return al;
    const y = dom.get(n.id)?.py?.[`${side}:${port}`];
    return [side === 'out' ? n.x + n.w : n.x, n.y + (y ?? fallback(n))];
  }

  // ── dessiner ──────────────────────────────────────────────
  function defs() {
    const d = svg('defs');
    for (const [id, cls] of [['ar', ''], ['ar-sel', 'sel']]) {
      const m = svg('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 11, markerHeight: 11, markerUnits: 'userSpaceOnUse', orient: 'auto' });
      m.append(svg('path', { d: 'M0 0L10 5L0 10z', class: 'mk ' + cls }));
      d.append(m);
    }
    return d;
  }
  function paint() {
    layer.replaceChildren(defs());
    if (!S.board) return;
    const F = app.flow();
    for (const l of S.board.links) {
      let a = app.node(l.a), b = app.node(l.b);
      if (!a || !b) continue;
      // les groupes réduits (canvas.js, env.shown) : un lien du dedans se cache, une flèche va au bord de la carte
      if (env.shown) { const ab = env.shown(l, a, b); if (!ab) continue; [a, b] = ab; }
      const sel = S.link === l.id;
      if (l.kind === 'wire') {
        const st = F.state(l.id) || { ok: false, why: 'fil illisible' };
        const kind = KINDS[l.pa] ? l.pa : 'text';
        // gardé (au-delà de ce que prend le modèle, commun/refs.js) : au repos, pas en alerte
        const cls = [st.ok ? (st.off || st.pending ? 'idle' : '') : st.held ? 'idle' : 'bad', sel ? 'sel' : ''].filter(Boolean).join(' ');
        const tok = b.type === 'vgen' && ['image', 'element', 'video', 'audio'].includes(l.pb);
        const label = l.label || (st.ok && l.pb === 'refs' ? `réf. ${st.idx + 1}` : st.ok && tok ? `@${l.pb}${st.idx + 1}` : st.held ? 'non envoyé' : !st.ok ? 'ignoré' : '');
        const why = st.held ? `non envoyé : ${st.why}` : !st.ok ? `ignoré : ${st.why}` : st.pending ? `en attente : ${st.pending}` : st.off ? 'la case est coupée : ce fil ne compte pas'
          : `${KINDS[kind].label} · ${nameOf(a)} → ${nameOf(b)}`;
        layer.append(wire(portPoint(a, l.pa, 'out'), portPoint(b, l.pb, 'in'), { color: KINDS[kind].color, id: l.id, cls, why, label }));
      } else if (l.kind === 'out') {
        // un rendu d'un lot : la carte est déjà reliée au cadre du lot, pas un fil par image
        if (l.lot && app.node(l.lot)) continue;
        const o = outPort(a);
        const from = o ? portPoint(a, o.id, 'out') : [a.x + a.w, a.y + a.h / 2];
        layer.append(wire(from, [b.x, b.y + b.h / 2], { color: o ? KINDS[o.kind].color : 'grn2', id: l.id, cls: 'lineage' + (sel ? ' sel' : ''),
          why: `résultat de ${nameOf(a)}`, label: l.label }));
      } else {
        // les annotations : les flèches droites
        const [p, q] = edgePts(a, b);
        const d = `M${p[0]} ${p[1]}L${q[0]} ${q[1]}`;
        const g = svg('g', { class: `lk ${l.kind}${sel ? ' sel' : ''}`, 'data-link': l.id });
        g.append(svg('path', { class: 'vis', d, 'marker-end': l.kind === 'line' ? null : `url(#${sel ? 'ar-sel' : 'ar'})` }),
          svg('path', { class: 'hit', d, 'data-link': l.id }));
        if (l.label) {
          const t = svg('text', { class: 'lbt', x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2 });
          t.textContent = l.label;
          g.append(t);
        }
        layer.append(g);
      }
    }
    layer.append(temp);
  }
  // l'état des ports : branché (plein), en alerte
  function paintPorts() {
    if (!S.board) return;
    const F = app.flow();
    const on = new Set(), bad = new Set();
    for (const l of S.board.links) {
      if (l.kind !== 'wire') continue;
      const st = F.state(l.id);
      if (st?.ok) { on.add(`${l.b}|in:${l.pb}`); on.add(`${l.a}|out:${l.pa}`); } else if (!st?.held) bad.add(`${l.b}|in:${l.pb}`);
    }
    for (const [id, d] of dom) {
      for (const p of d.el.querySelectorAll(':scope > .pt')) {
        const k = `${id}|${p.dataset.side}:${p.dataset.port}`;
        p.classList.toggle('on', on.has(k));
        p.classList.toggle('bad', bad.has(k));
      }
    }
  }

  // ── tirer un fil ──────────────────────────────────────────
  // depuis une sortie : vers les entrées qui prennent sa sorte ; depuis une
  // entrée : vers les sorties qu'elle prend
  function start(e, id, port, side) {
    const A = app.node(id);
    if (!A || !S.board) return;
    const caps = app.caps();
    const fromOut = side === 'out';
    const out = fromOut ? outPort(A) : null;
    const inp = fromOut ? null : inPorts(A, caps).find((p) => p.id === port);
    if (fromOut && !out) return;
    if (!fromOut && !inp) return;
    if (inp && inp.max === 0) { toast(inp.why, 6000); return; }
    if (inp?.lock) { toast(`la case « ${inp.label} » est verrouillée`); return; }
    const color = KINDS[fromOut ? out.kind : inp.accepts[0]].color;
    const cand = new Map();
    for (const n of S.board.nodes) {
      if (n.id === id || n.type === 'frame') continue;
      if (fromOut) cand.set(n.id, inPorts(n, caps).map((p) => ({ port: p, why: canWire(S.board, id, port, n.id, p.id, caps, S.items) })));
      else {
        const o = outPort(n);
        cand.set(n.id, o ? [{ port: o, why: canWire(S.board, n.id, o.id, id, port, caps, S.items) }] : []);
      }
    }
    // allumer ce qui prend, éteindre le reste
    const lit = [];
    const mark = (node, c) => { node.classList.add(c); lit.push([node, c]); };
    cv.classList.add('wiring');
    const own = dom.get(id)?.el.querySelector(`:scope > .pt[data-side="${side}"][data-port="${CSS.escape(port)}"]`);
    if (own) mark(own, 'src');
    for (const [nid, list] of cand) {
      const d = dom.get(nid);
      if (!d) continue;
      mark(d.el, list.some((c) => !c.why) ? 'w-ok' : 'w-no');
      for (const c of list) {
        const pe = d.el.querySelector(`:scope > .pt[data-side="${fromOut ? 'in' : 'out'}"][data-port="${CSS.escape(c.port.id)}"]`);
        if (pe) mark(pe, c.why ? 'no' : 'ok');
        if (fromOut && !c.why) { const row = d.el.querySelector(`[data-row="${CSS.escape(c.port.id)}"]`); if (row) mark(row, 'r-ok'); }
      }
    }
    hint.textContent = fromOut
      ? `${KINDS[out.kind].label} : relâchez sur une entrée allumée — sur une carte, la bonne entrée ; dans le vide, un objet neuf déjà branché`
      : `${inp.label} : relâchez sur une sortie allumée — dans le vide, de quoi la remplir`;
    let hot = [];
    const target = (ev) => {
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      const nd = t?.closest?.('.nd[data-id]');
      const nid = nd?.dataset.id;
      if (!nid || nid === id || !cand.has(nid)) return { t, nid: null };
      const list = cand.get(nid);
      const okl = list.filter((c) => !c.why);
      const want = t.closest(`.pt[data-side="${fromOut ? 'in' : 'out'}"]`)?.dataset.port || (fromOut ? t.closest('[data-row]')?.dataset.row : null);
      let pk = want ? okl.find((c) => c.port.id === want) || null : null;
      if (!pk && okl.length === 1) pk = okl[0];
      return { t, nid, list, okl, pick: pk };
    };
    const move = (ev) => {
      const [wx, wy] = toWorld(ev.clientX, ev.clientY);
      const h = target(ev);
      for (const n of hot) n.classList.remove('hit');
      hot = [];
      const B = h.nid ? app.node(h.nid) : null;
      if (B && h.pick) {
        const d = dom.get(B.id);
        const pe = d?.el.querySelector(`:scope > .pt[data-side="${fromOut ? 'in' : 'out'}"][data-port="${CSS.escape(h.pick.port.id)}"]`);
        const row = fromOut ? d?.el.querySelector(`[data-row="${CSS.escape(h.pick.port.id)}"]`) : null;
        for (const n of [pe, row, d?.el]) if (n) { n.classList.add('hit'); hot.push(n); }
      }
      const end = B && h.pick ? portPoint(B, h.pick.port.id, fromOut ? 'in' : 'out') : [wx, wy];
      const mine = portPoint(A, port, side);
      paintTemp(temp, fromOut ? mine : end, fromOut ? end : mine, { color, snapped: !!(B && h.pick) });
    };
    move(e);
    drag(move, (ev) => {
      for (const n of hot) n.classList.remove('hit');
      for (const [n, c] of lit) n.classList.remove(c);
      cv.classList.remove('wiring');
      paintTemp(temp, null, null);
      hint.textContent = HINT;
      const h = target(ev);
      if (h.nid) { land(h, ev); return; }
      if (h.t && cv.contains(h.t) && !h.t.closest('.zoombox, .mini, .banner')) voidMenu(ev);
    });

    const connect = (nid, c) => (fromOut ? app.wire(id, port, nid, c.port.id) : app.wire(nid, c.port.id, id, port));
    const sub = (nid, c) => {
      if (!fromOut) return '';
      const old = replaces(S.board, nid, c.port.id, caps);
      return old ? 'remplace' : c.port.max ? `${(S.board.links.filter((l) => l.kind === 'wire' && l.b === nid && l.pb === c.port.id).length) + 1}/${c.port.max}` : '';
    };
    // lâché sur une carte
    function land(h, ev) {
      const B = app.node(h.nid);
      if (h.pick) { connect(h.nid, h.pick); return; }
      if (h.okl.length > 1) {
        menu(ev.clientX, ev.clientY, [{ head: `brancher sur ${nameOf(B)}` },
          ...h.okl.map((c) => ({ label: c.port.label, dot: color, sub: sub(h.nid, c), onclick: () => connect(h.nid, c) }))]);
        return;
      }
      // rien ne prend : dire pourquoi, proposer une flèche d'annotation
      const items = [{ head: fromOut ? `${nameOf(B)} ne prend pas ${oneOf(out.kind)}` : `${nameOf(B)} ne donne rien pour « ${inp.label} »` }];
      for (const c of h.list) items.push({ label: `${c.port.label || KINDS[c.port.kind]?.label} — ${c.why}`, disabled: true, why: c.why });
      if (!h.list.length) items.push({ label: fromOut ? 'aucune entrée' : 'aucune sortie', disabled: true, why: fromOut ? 'cet objet ne reçoit rien' : 'cet objet ne donne rien' });
      items.push('-', { label: 'Relier par une flèche', sub: 'annotation', onclick: () => (fromOut ? app.connect(id, h.nid) : app.connect(h.nid, id)) });
      menu(ev.clientX, ev.clientY, items);
    }
    // lâché dans le vide : un objet neuf, déjà branché
    function voidMenu(ev) {
      const [wx, wy] = toWorld(ev.clientX, ev.clientY);
      const items = [{ head: 'créer, déjà branché' }];
      if (fromOut) {
        const makers = makersFor(out.kind, caps, { gen: { model: app.LS('gen-model') || 'krea2' } });
        const make = (m) => () => app.addAt(m.template.type, wx, wy - 26, { select: true, preset: m.preset, wireIn: { from: id, pa: port, pb: m.port.id } });
        const vids = makers.filter((m) => m.template.type === 'vgen');
        for (const m of makers) {
          if (m.template.type === 'vgen') {
            if (m !== vids[0]) continue;
            if (vids.length === 1) items.push({ label: 'Générer vidéo', sub: `${VMODES[m.preset.mode] || ''} · ${m.port.label}`, dot: m.template.dot, onclick: make(m) });
            else {
              items.push({ label: 'Générer vidéo', dot: m.template.dot, items: vids.map((v) => ({ label: caps.movie?.modes?.find((x) => x.id === v.preset.mode)?.label || VMODES[v.preset.mode],
                sub: v.port.label, onclick: make(v) })) });
            }
          } else items.push({ label: m.template.label, sub: m.port.label, dot: m.template.dot, onclick: make(m) });
        }
        if (items.length === 1) items.push({ label: 'aucune carte ne prend cela', disabled: true, why: `rien ne reçoit ${oneOf(out.kind)} ici` });
        items.push('-', { head: 'une annotation, fléchée' },
          { label: 'Note', onclick: () => app.addAt('note', wx, wy - 30, { edit: true, select: true, link: id }) },
          { label: 'Post-it', onclick: () => app.addAt('sticky', wx, wy - 30, { edit: true, select: true, link: id }) });
      } else {
        // depuis une entrée : de quoi la remplir, posé à gauche du point
        if (inp.accepts.includes('text')) {
          for (const [type, label] of [['note', 'Note'], ['sticky', 'Post-it'], ['compose', 'Composeur de prompt']]) {
            items.push({ label, sub: 'vers ' + inp.label, dot: type === 'compose' ? 'amb' : null, onclick: () => {
              const w = type === 'compose' ? 340 : type === 'sticky' ? 190 : 230;
              app.addAt(type, wx - w, wy - 26, { edit: TEXT_TYPES.includes(type), select: true, wireOut: { to: id, pb: port } });
            } });
          }
        }
        const lib = inp.accepts.filter((k) => k !== 'text');
        if (lib.length) {
          items.push({ label: 'Depuis la bibliothèque…', sub: lib.map((k) => KINDS[k].plural).join(', '), onclick: async () => {
            const got = await pick({ kinds: lib, multiple: inp.max !== 1, title: `${inp.label} · ${nameOf(A)}` });
            if (got?.length) app.feed(id, port, got, { at: [wx, wy] });
          } });
        }
      }
      menu(ev.clientX, ev.clientY, items);
    }
  }

  return { paint, paintPorts, placePorts, portPoint, start, temp };
}
