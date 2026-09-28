// MUSIQUE — la vue Nodal : tous les modules du projet et leurs câbles,
// sur le canvas du rack NL (station-nl-rack) : molette = zoom, glisser le
// fond = se déplacer, glisser une sortie vers une entrée = un câble, clic
// sur un câble puis « Couper » (ou Suppr) = le retirer. Lâcher un câble dans
// le vide propose un module neuf déjà branché. Le zoom est sémantique : de
// loin, les cartes ne gardent que leur nom.

import { toast } from '../commun/shell.js';
import { MODULES, TRACK_KINDS, EFFECT_TYPES, spec, val } from './modules.js';
import { el, knob, choice, menu, clamp, put } from './ui.js';

const CARD_W = 236;

export function createNodal(app) {
  const { S } = app;
  const root = el('section', { class: 'nd', 'aria-label': 'nodal' });
  const cv = el('div', { class: 'nd-canvas' });
  const world = el('div', { class: 'nd-world' });
  const wires = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wires.setAttribute('class', 'nd-wires');
  const temp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  temp.setAttribute('class', 'temp');
  const tools = el('div', { class: 'nd-tools' });
  const zoomBox = el('div', { class: 'nd-zoom' });
  const hint = el('div', { class: 'nd-hint lbl' });
  const side = el('aside', { class: 'nd-side' });
  cv.append(world, tools, zoomBox, hint);
  root.append(cv, side);
  const view = () => (S.proj.ui = S.proj.ui || {}, S.proj.ui.nodal = S.proj.ui.nodal || { z: 0.8, px: 40, py: 40 });
  const cards = new Map();
  const meters = [];
  let link = null;   // { from, dir: 'out' | 'in' }

  const title = (m) => {
    const t = m.track && app.track(m.track);
    return { name: MODULES[m.type].name, sub: t ? t.name : m.type === 'master' ? 'master' : 'bus' };
  };
  const accentOf = (m) => (m.track && app.track(m.track)?.color) || MODULES[m.type].color;

  // ── transformer le monde ──
  function applyView() {
    const v = view();
    world.style.transform = `translate(${v.px}px, ${v.py}px) scale(${v.z})`;
    cv.style.backgroundSize = `${26 * v.z}px ${26 * v.z}px`;
    cv.style.backgroundPosition = `${v.px}px ${v.py}px`;
    world.classList.toggle('lod0', v.z < 0.55);
    world.classList.toggle('lod1', v.z < 0.9);
    zoomBox.querySelector('.pct') && (zoomBox.querySelector('.pct').textContent = `${Math.round(v.z * 100)} %`);
  }
  function zoomAt(nz, cx, cy) {
    const v = view(), k = clamp(nz, 0.3, 2) / v.z;
    v.px = cx - (cx - v.px) * k; v.py = cy - (cy - v.py) * k; v.z *= k;
    applyView();
  }
  function fit() {
    const ms = S.proj.modules;
    if (!ms.length) return;
    const xs = ms.map((m) => m.x), ys = ms.map((m) => m.y);
    const x0 = Math.min(...xs) - 40, y0 = Math.min(...ys) - 40;
    const x1 = Math.max(...xs) + CARD_W + 40;
    const y1 = Math.max(...ms.map((m) => m.y + (cards.get(m.id)?.offsetHeight || 200))) + 40;
    const v = view();
    v.z = clamp(Math.min(cv.clientWidth / (x1 - x0), cv.clientHeight / (y1 - y0)) * 0.95, 0.3, 1.2);
    v.px = (cv.clientWidth - (x1 - x0) * v.z) / 2 - x0 * v.z;
    v.py = (cv.clientHeight - (y1 - y0) * v.z) / 2 - y0 * v.z;
    applyView();
  }
  const toWorld = (cx, cy) => {
    const r = cv.getBoundingClientRect(), v = view();
    return [(cx - r.left - v.px) / v.z, (cy - r.top - v.py) / v.z];
  };

  // ── une carte ──
  function card(m) {
    const def = MODULES[m.type], { name, sub } = title(m), accent = accentOf(m);
    const box = el('div', { class: `nd-card${S.sel.mod === m.id ? ' sel' : ''}${m.on === false ? ' off' : ''}`, 'data-id': m.id,
      style: { left: `${m.x}px`, top: `${m.y}px`, width: `${CARD_W}px`, '--k': `var(--${accent})` } });
    if (def.role !== 'source') box.append(el('span', { class: 'port in', title: 'entrée', 'data-port': 'in' }));
    if (def.role !== 'master') box.append(el('span', { class: 'port out', title: 'sortie', 'data-port': 'out' }));
    const hd = el('div', { class: 'hd' }, el('i', { class: 'dot' }),
      el('span', { class: 'nm' }, name), el('span', { class: 'lbl' }, sub));
    const bd = el('div', { class: 'bd' }, (def.face || []).map((k) => {
      const s = spec(m.type, k);
      return knob(s, val(m, k), { size: 'sm', accent, onInput: (v) => { m.params[k] = v; app.commit('param', m); },
        onChange: () => { if (S.sel.mod === m.id) paintSideParams(); } });
    }));
    const ft = el('div', { class: 'ft' });
    if (def.role === 'strip' || def.role === 'master') {
      const mt = el('div', { class: 'mtr' }, el('i'));
      meters.push([m.id, mt]);
      ft.append(mt);
    }
    ft.append(el('div', { class: 'io' }, el('span', {}, def.role === 'source' ? '' : 'in'), el('span', { class: 'lbl' }, def.kind),
      el('span', {}, def.role === 'master' ? '' : 'out')));
    box.append(hd, bd, ft);

    hd.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      select(m.id);
      hd.setPointerCapture(e.pointerId);
      const x0 = e.clientX, y0 = e.clientY, mx = m.x, my = m.y, z = view().z;
      let moved = false;
      const mv = (ev) => {
        moved = true;
        m.x = Math.round(mx + (ev.clientX - x0) / z); m.y = Math.round(my + (ev.clientY - y0) / z);
        box.style.left = `${m.x}px`; box.style.top = `${m.y}px`;
        paintWires();
      };
      const up = () => { hd.removeEventListener('pointermove', mv); hd.removeEventListener('pointerup', up); if (moved) app.commit('data'); };
      hd.addEventListener('pointermove', mv); hd.addEventListener('pointerup', up);
    });
    box.addEventListener('pointerdown', (e) => {
      const port = e.target.dataset?.port;
      if (!port || e.button !== 0) { if (!e.target.closest('.kn')) select(m.id); return; }
      e.preventDefault(); e.stopPropagation();
      link = { from: m.id, dir: port };
      cv.setPointerCapture(e.pointerId);
      hint.textContent = port === 'out' ? 'relâche sur une entrée (à gauche d\'une carte) — dans le vide : un module neuf' : 'relâche sur une sortie';
    });
    box.addEventListener('dblclick', (e) => {
      if (e.target.closest('.kn')) return;
      if (m.track) { app.select({ track: m.track, mod: m.id }); app.setView('rack'); }
    });
    cards.set(m.id, box);
    return box;
  }

  function select(id) {
    S.sel.mod = id; S.sel.cable = null;
    for (const [k, c] of cards) c.classList.toggle('sel', k === id);
    paintWires();
    paintSide();
  }

  // ── les câbles ──
  function portXY(id, dir) {
    const c = cards.get(id), m = app.mod(id);
    if (!c || !m) return null;
    return [m.x + (dir === 'out' ? CARD_W : 0), m.y + Math.min(c.offsetHeight / 2, 34)];
  }
  const curve = ([x1, y1], [x2, y2]) => {
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    return `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };
  function paintWires() {
    const ns = 'http://www.w3.org/2000/svg';
    put(wires);
    for (const c of S.proj.cables) {
      const a = portXY(c.a, 'out'), b = portXY(c.b, 'in');
      if (!a || !b) continue;
      const key = `${c.a}>${c.b}`;
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', `w${S.sel.cable === key ? ' sel' : ''}`);
      g.style.setProperty('--k', `var(--${accentOf(app.mod(c.a))})`);
      const hit = document.createElementNS(ns, 'path'), vis = document.createElementNS(ns, 'path');
      hit.setAttribute('class', 'hit'); vis.setAttribute('class', 'vis');
      const d = curve(a, b);
      hit.setAttribute('d', d); vis.setAttribute('d', d);
      hit.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        S.sel.cable = key; S.sel.mod = null;
        for (const cc of cards.values()) cc.classList.remove('sel');
        paintWires(); paintSide();
      });
      g.append(vis, hit);
      wires.append(g);
    }
    wires.append(temp);
  }

  // ── le fond : se déplacer, zoomer, créer ──
  cv.addEventListener('pointerdown', (e) => {
    if (link || e.target.closest('.nd-card, .nd-tools, .nd-zoom')) return;
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    const v = view(), x0 = e.clientX, y0 = e.clientY, px = v.px, py = v.py;
    let moved = false;
    cv.classList.add('drag');
    const mv = (ev) => { moved = true; v.px = px + ev.clientX - x0; v.py = py + ev.clientY - y0; applyView(); };
    const up = () => {
      cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); cv.classList.remove('drag');
      if (!moved && (S.sel.mod || S.sel.cable)) { S.sel.mod = null; S.sel.cable = null; render(); }
      else if (moved) app.commit('data');
    };
    cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!link) return;
    const p = toWorld(e.clientX, e.clientY), a = portXY(link.from, link.dir);
    if (!a) return;
    temp.setAttribute('d', link.dir === 'out' ? curve(a, p) : curve(p, a));
  });
  cv.addEventListener('pointerup', (e) => {
    if (!link) return;
    const L = link;
    link = null;
    temp.setAttribute('d', '');
    hint.textContent = HINT;
    const tgt = document.elementFromPoint(e.clientX, e.clientY);
    const port = tgt?.dataset?.port, other = tgt?.closest?.('.nd-card')?.dataset.id;
    if (port && other && other !== L.from) {
      if (L.dir === 'out' && port === 'in') app.connect(L.from, other);
      else if (L.dir === 'in' && port === 'out') app.connect(other, L.from);
      else toast(L.dir === 'out' ? 'une sortie se branche sur une entrée' : 'une entrée reçoit une sortie');
      return;
    }
    if (!tgt?.closest?.('.nd-card') && L.dir === 'out') {
      const [wx, wy] = toWorld(e.clientX, e.clientY);
      newModuleMenu(e.clientX, e.clientY, wx, wy, L.from);
    }
  });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    zoomAt(view().z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top);
    clearTimeout(cv._t); cv._t = setTimeout(() => app.commit('data'), 500);
  }, { passive: false });
  cv.addEventListener('dblclick', (e) => {
    if (e.target.closest('.nd-card, .nd-tools, .nd-zoom')) return;
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    newModuleMenu(e.clientX, e.clientY, wx, wy, null);
  });

  function newModuleMenu(cx, cy, wx, wy, from) {
    const src = from && app.mod(from);
    const trackId = src?.track || null;
    const items = [{ head: from ? `brancher après ${MODULES[src.type].name}` : 'un effet' }];
    for (const k of EFFECT_TYPES) {
      items.push({ label: MODULES[k].name, sub: MODULES[k].kind, dot: MODULES[k].color, onclick: () => {
        const m = { id: app.uid('m'), type: k, track: trackId, x: Math.round(wx), y: Math.round(wy - 30), on: true, params: {} };
        S.proj.modules.push(m);
        if (from) {
          const why = app.canConnect(from, m.id);
          if (!why) S.proj.cables.push({ a: from, b: m.id }); else toast(why);
        }
        S.sel.mod = m.id;
        app.commit('graph');
      } });
    }
    if (!from) {
      items.push('-', { head: 'une piste (source + tranche)' });
      for (const [k, K] of Object.entries(TRACK_KINDS)) {
        items.push({ label: K.label, sub: MODULES[K.src].name, dot: K.color, onclick: () => {
          const t = app.addTrack(k);
          const s = app.mod(t.src), st = app.mod(t.strip);
          s.x = Math.round(wx); s.y = Math.round(wy); st.x = s.x + 320; st.y = s.y;
          app.commit('graph');
        } });
      }
    }
    menu(cx, cy, items);
  }

  // ── le panneau de droite ──
  let sideParams = null;
  function paintSideParams() { if (sideParams) sideParams(); }
  function refreshCard(m) {
    const old = cards.get(m.id);
    if (!old) return;
    meters.splice(0, meters.length, ...meters.filter(([id, , big]) => id !== m.id || big));
    const n = card(m);
    old.replaceWith(n);
  }
  function paintSide() {
    const P = S.proj;
    const m = app.mod(S.sel.mod);
    const secs = [];
    if (m) {
      const def = MODULES[m.type], { name, sub } = title(m), accent = accentOf(m);
      const grid = el('div', { class: 'nd-params' });
      // les cartes se redessinent une fois la molette lâchée : les deux vues d'un même réglage restent d'accord
      sideParams = () => put(grid, ...def.params
        .filter((p) => m.type !== 'drums' || p.k === 'lvl')
        .map((p) => (p.opts ? choice(p, val(m, p.k), { onChange: (v) => { m.params[p.k] = v; app.commit('param', m); app.commit('data'); } })
          : knob(p, val(m, p.k), { accent, onInput: (v) => { m.params[p.k] = v; app.commit('param', m); },
            onChange: () => refreshCard(m) }))));
      sideParams();
      secs.push(el('div', { class: 'pan nd-sel', style: { '--k': `var(--${accent})` } },
        el('div', { class: 'row' }, el('b', { class: 'venus' }, name), el('span', { class: 'sp' }), el('span', { class: 'lbl' }, `${def.kind} · ${sub}`)),
        m.type === 'drums' ? el('p', { class: 'lbl' }, 'les huit voix se règlent dans le rack (double-clic sur la carte)') : null,
        grid,
        el('div', { class: 'row' },
          def.role === 'effect' || def.role === 'source' ? el('button', { class: `tb sm${m.on !== false ? ' on' : ' ghost'}`, type: 'button',
            onclick: () => { m.on = m.on === false; app.commit('graph'); } }, m.on !== false ? 'Actif' : 'Bypass') : null,
          def.role === 'effect' ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => {
            const c = { ...m, id: app.uid('m'), x: m.x + 30, y: m.y + 30, params: { ...m.params } };
            S.proj.modules.push(c); S.sel.mod = c.id; app.commit('graph');
          } }, 'Dupliquer') : null,
          m.track ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { app.select({ track: m.track, mod: m.id }); app.setView('rack'); } }, 'Dans le rack') : null,
          el('span', { class: 'sp' }),
          def.role === 'effect' ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.removeModule(m.id) }, 'Retirer') : null)));
    } else {
      sideParams = null;
      secs.push(el('div', { class: 'pan nd-sel' }, el('p', { class: 'lbl' }, 'clic sur une carte : ses réglages ici · double-clic : son rack')));
    }
    const nm = (id) => { const x = app.mod(id); if (!x) return '?'; const t = title(x); return `${t.name} · ${t.sub}`; };
    secs.push(el('div', { class: 'pan' },
      el('div', { class: 'row' }, el('b', { class: 'venus' }, 'Liaisons'), el('span', { class: 'sp' }), el('span', { class: 'lbl' }, `${P.cables.length} câbles`)),
      el('div', { class: 'nd-links' }, P.cables.length ? P.cables.map((c) => {
        const key = `${c.a}>${c.b}`;
        return el('div', { class: `nd-link${S.sel.cable === key ? ' sel' : ''}`,
          onclick: () => { S.sel.cable = key; S.sel.mod = null; render(); } },
        el('span', {}, `${nm(c.a)} → ${nm(c.b)}`), el('button', { class: 'cut', type: 'button', onclick: (e) => { e.stopPropagation(); app.disconnect(c.a, c.b); } }, 'Couper'));
      }) : el('p', { class: 'lbl' }, 'tire depuis une sortie vers une entrée'))));
    const mst = app.master();
    const big = el('b', { class: 'nd-db' }, '—');
    const mt = el('div', { class: 'mtr lg' }, el('i'));
    meters.push([mst.id, mt, big]);
    secs.push(el('div', { class: 'pan' }, el('div', { class: 'row' }, el('b', { class: 'venus' }, 'Sortie'), el('span', { class: 'sp' }), el('span', { class: 'lbl' }, 'dB crête')), big, mt));
    put(side, ...secs);
  }

  // ── l'ensemble ──
  const HINT = 'molette : zoom · glisser le fond : se déplacer · sortie → entrée : un câble · double-clic dans le vide : un module';
  function render() {
    const P = S.proj;
    meters.length = 0;
    cards.clear();
    put(tools,
      el('button', { class: 'tb ghost sm', type: 'button', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); const [wx, wy] = toWorld(r.left + 200, r.bottom + 120); newModuleMenu(r.left, r.bottom + 4, wx, wy, null); } }, '+ Module'),
      el('span', { class: 'lbl' }, `${P.modules.length} modules · ${P.cables.length} câbles`),
      S.sel.cable ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { const [a, b] = S.sel.cable.split('>'); app.disconnect(a, b); } }, 'Couper le câble') : null);
    put(zoomBox,
      el('button', { class: 'tb ghost sm', type: 'button', onclick: () => zoomAt(view().z / 1.2, cv.clientWidth / 2, cv.clientHeight / 2) }, '−'),
      el('span', { class: 'pct' }, ''),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: () => zoomAt(view().z * 1.2, cv.clientWidth / 2, cv.clientHeight / 2) }, '+'),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: fit }, 'Ajuster'));
    hint.textContent = HINT;
    put(world, wires, ...P.modules.map(card));
    applyView();
    paintWires();
    paintSide();
    if (!P.ui?.nodal?.fitted) { requestAnimationFrame(() => { fit(); view().fitted = true; paintWires(); }); }
  }

  function frame() {
    for (const [id, mt, big] of meters) {
      const db = app.engine.level(id);
      mt.firstChild.style.width = `${Math.max(0, Math.min(100, (db + 60) / 60 * 100)).toFixed(1)}%`;
      mt.classList.toggle('hot', db > -1);
      if (big) big.textContent = db > -80 ? db.toFixed(1) : '—';
    }
  }

  function key(e) {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (S.sel.cable) { e.preventDefault(); const [a, b] = S.sel.cable.split('>'); app.disconnect(a, b); }
    else if (S.sel.mod && MODULES[app.mod(S.sel.mod)?.type]?.role === 'effect') { e.preventDefault(); app.removeModule(S.sel.mod); }
  }

  new ResizeObserver(() => { if (S.view === 'nodal') paintWires(); }).observe(cv);
  return { el: root, render, frame, key };
}
