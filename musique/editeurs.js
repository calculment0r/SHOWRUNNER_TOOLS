// ODIO — les éditeurs du clip choisi (le tiroir sous l'arrangement, et le
// bas du rack) :
//   piano roll   notes, longueurs, vélocités (la voie du bas), grille et
//                quantification, gamme de la session mise en évidence et
//                aimant à la gamme, transposer, accent et liaison (la basse
//                acide d'ODIO)
//   pas          le séquenceur de la batterie : une rangée par voix de la
//                source (DR-9 : huit, boîte à rythme : onze), vélocité par pas
//   audio        gain, fondus, boucle, glisser le son dans le clip, couper
//                à la tête de lecture, normaliser, séparer en pistes

import { toast, href } from '../commun/shell.js';
import { MODULES, TRACK_KINDS, DRUM_MODELS, NOTE_MODELS, drumVoicesOf, noteName, isBlack, inScale, snapToScale, keyLabel,
  MODES, TONICS } from './modules.js';
import { peaks, peakDb } from './moteur.js';
import { el, knob, menu, ask, tok, clamp, put } from './ui.js';

const STEP_MAX = 256;

// ── le tiroir ───────────────────────────────────────────────
export function createDock(app) {
  const { S } = app;
  const root = el('section', { class: 'dk', 'aria-label': 'éditeur' });
  let ed = null;
  function target() {
    const c = app.clip(S.sel.clip);
    if (c) return { c, t: app.track(c.track) };
    const t = app.track(S.sel.track);
    if (t && TRACK_KINDS[t.kind]?.pattern) return { c: null, t };
    return null;
  }
  function render() {
    const tg = target();
    if (!tg || !tg.t) {
      ed = null;
      put(root, el('div', { class: 'dk-empty' }, el('b', { class: 'venus' }, 'Éditeur'),
        el('span', {}, 'choisis un clip : ses notes, ses pas ou sa forme d\'onde s\'ouvrent ici · double-clic sur une piste vide : un clip neuf')));
      return;
    }
    ed = tg.t.kind === 'audio' ? (tg.c ? audioEditor(app, root, tg.c, tg.t) : null) : patternEditor(app, root, tg.t, tg.c);
  }
  return { el: root, render, frame: (b) => ed?.frame?.(b), key: (e) => ed?.key?.(e) };
}

// ── l'éditeur de motif (notes ou pas) ───────────────────────
export function patternEditor(app, host, t, c = null, { tall = false } = {}) {
  const { S } = app;
  const P = S.proj;
  const pats = P.patterns.filter((p) => p.track === t.id);
  let pat = c ? app.pat(c.pat) : app.pat(S.sel.pat);
  if (!pat || pat.track !== t.id) pat = app.pat(t.pat) || pats[0];
  if (!pat) { put(host, el('div', { class: 'dk-empty' }, el('span', {}, 'cette piste n\'a pas de motif'))); return null; }
  t.pat = pat.id;
  const src = app.mod(t.src);
  const drums = t.kind === 'drums';
  const ui = P.ui.ed = P.ui.ed || { grid: 1, scale: true };
  const setPat = (id) => {
    if (c) { c.pat = id; app.commit('data'); } else { t.pat = id; S.sel.pat = id; app.commit('data'); }
  };
  const bars = pat.steps / (P.sig * 4);
  const lenSel = el('select', { class: 'fld mu-mini', 'aria-label': 'longueur du motif', title: 'longueur du motif',
    onchange: (e) => { resize(pat, Math.min(STEP_MAX, +e.target.value * P.sig * 4)); app.commit('data'); } },
  [1, 2, 4, 8, 16].filter((n) => n * P.sig * 4 <= STEP_MAX || n === 1).map((n) => el('option', { value: n, selected: Math.abs(bars - n) < 1e-9 || null }, `${n} mes.`)),
  Number.isInteger(bars) && [1, 2, 4, 8, 16].includes(bars) ? null : el('option', { value: bars, selected: true }, `${pat.steps} pas`));
  const head = el('div', { class: 'pe-head' },
    el('span', { class: 'k', style: { '--c': `var(--${t.color})` } }, t.name),
    el('div', { class: 'pe-pats' }, pats.map((x) => el('button', {
      class: `tb sm${x.id === pat.id ? ' on' : ' ghost'}`, type: 'button', title: c ? 'le motif que ce clip joue · double-clic : renommer' : 'double-clic : renommer',
      onclick: () => setPat(x.id),
      ondblclick: async () => { const n = await ask('Renommer le motif', 'Nom', x.name, 'Renommer'); if (n) { x.name = n.slice(0, 40); app.commit('data'); } },
    }, x.name))),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'un motif neuf pour ce clip', onclick: () => { const p = app.newPattern(t.id); setPat(p.id); } }, '+ Motif'),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'une copie de ce motif, que ce clip joue désormais', onclick: () => { const p = app.newPattern(t.id, pat); setPat(p.id); } }, 'Copier'),
    el('span', { class: 'sp' }),
    lenSel,
    el('button', { class: 'tb ghost sm', type: 'button', title: 'répéter le motif sur une longueur double', disabled: pat.steps * 2 > STEP_MAX || null,
      onclick: () => { double(pat); app.commit('data'); } }, 'Doubler'),
    el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { clear(pat); app.commit('data'); } }, 'Effacer'),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'remplir depuis un modèle', onclick: (e) => modelMenu(e) }, 'Modèle'),
    c ? null : el('button', { class: 'tb ghost sm', type: 'button', title: 'poser ce motif en clip à la tête de lecture',
      onclick: () => { app.addClip(t.id, Math.floor(app.pos() / P.sig) * P.sig, { pat: pat.id }); toast('clip posé dans l\'arrangement'); } }, 'Vers l\'arrangement'));

  function modelMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const items = drums
      ? DRUM_MODELS.map((m) => ({ label: m.name, onclick: () => { pat.steps = 16; pat.lanes = JSON.parse(JSON.stringify(m.lanes)); app.commit('data'); } }))
      : NOTE_MODELS.map((m) => ({ label: m.name, sub: keyLabel(P.key), onclick: () => { const g = m.make(P.key, P.sig); pat.steps = g.steps; pat.notes = g.notes; app.commit('data'); } }));
    menu(r.left, r.bottom + 4, [{ head: drums ? 'rythmes (écrits à la main)' : `tirés de la gamme · ${keyLabel(P.key)}` }, ...items]);
  }

  const body = drums ? stepGrid(app, pat, src, t) : pianoRoll(app, pat, src, t, c, ui, tall);
  put(host, el('div', { class: 'pe' }, head, body.el, el('p', { class: 'lbl pe-hint' }, body.hint)));
  return body;
}

function resize(p, n) {
  n = Math.max(4, Math.min(STEP_MAX, Math.round(n / 4) * 4));
  if (p.lanes) for (const k of Object.keys(p.lanes)) p.lanes[k] = Array.from({ length: n }, (_, i) => p.lanes[k][i] || 0);
  if (p.notes) p.notes = p.notes.filter((x) => x.s < n).map((x) => ({ ...x, l: Math.min(x.l, n - x.s) }));
  p.steps = n;
}
function double(p) {
  const n = p.steps;
  if (p.lanes) for (const k of Object.keys(p.lanes)) p.lanes[k] = [...p.lanes[k], ...p.lanes[k]];
  if (p.notes) p.notes = [...p.notes, ...p.notes.map((x) => ({ ...x, s: x.s + n }))];
  p.steps = n * 2;
}
function clear(p) { if (p.lanes) p.lanes = {}; if (p.notes) p.notes = []; }

// la colonne jouée : le clip de ce motif sous la tête de lecture
function playingStep(app, pat, c) {
  if (!app.engine.running) return -1;
  const beat = app.pos();
  const cl = c && c.pat === pat.id && beat >= c.start && beat < c.start + c.len ? c
    : app.S.proj.clips.find((x) => x.pat === pat.id && beat >= x.start && beat < x.start + x.len);
  if (!cl) return -1;
  const plen = pat.steps / 4;
  return ((((beat - cl.start + (cl.off || 0)) % plen) + plen) % plen) * 4;
}

// ── le séquenceur à pas ─────────────────────────────────────
function stepGrid(app, p, src, t) {
  const voices = drumVoicesOf(src?.type);
  const sig = app.S.proj.sig;
  const rowsEl = [];
  const g = el('div', { class: 'sq', style: { '--n': p.steps } });
  let paint = null;
  const velOf = (x) => (x >= 0.9 ? 'on' : x >= 0.55 ? 'mid' : x > 0 ? 'soft' : '');
  for (const v of voices) {
    const laneArr = p.lanes[v.id] || Array(p.steps).fill(0);
    const on = laneArr.filter(Boolean).length;
    const row = el('div', { class: 'sq-row' },
      el('button', { class: 'sq-lab', type: 'button', title: `${v.name} — clic : écouter`, onpointerdown: () => app.engine.hit(src.id, v.id, 1) },
        el('b', {}, v.short), el('span', {}, v.name), on ? el('small', {}, String(on)) : null));
    const cells = el('div', { class: 'sq-cells' });
    for (let s = 0; s < p.steps; s++) {
      const cell = el('span', { class: `sq-c${s % (sig * 4) === 0 ? ' bar' : s % 4 === 0 ? ' b4' : ''} ${velOf(laneArr[s])}`, 'data-s': s,
        title: 'clic : poser / ôter · Alt : coup léger · clic droit : vélocité' });
      const set = (vel) => {
        if (!p.lanes[v.id]) p.lanes[v.id] = Array(p.steps).fill(0);
        p.lanes[v.id][s] = vel;
        cell.className = `sq-c${s % (sig * 4) === 0 ? ' bar' : s % 4 === 0 ? ' b4' : ''} ${velOf(vel)}`;
      };
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const cur = (p.lanes[v.id] || [])[s] || 0;
        const next = cur >= 0.9 ? 0.7 : cur >= 0.55 ? 0.4 : cur > 0 ? 1 : 1;
        set(next); app.engine.hit(src.id, v.id, next); app.commit('quiet');
      });
      cell.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const cur = (p.lanes[v.id] || [])[s] || 0;
        const vel = cur ? 0 : e.altKey ? 0.5 : 1;
        paint = { lane: v.id, vel };
        set(vel);
        if (vel) app.engine.hit(src.id, v.id, vel);
        const up = () => { removeEventListener('pointerup', up); paint = null; if (!p.lanes[v.id].some(Boolean)) delete p.lanes[v.id]; app.commit('quiet'); };
        addEventListener('pointerup', up);
      });
      cell.addEventListener('pointerenter', () => { if (paint && paint.lane === v.id) set(paint.vel); });
      cells.append(cell);
    }
    rowsEl.push(cells);
    row.append(cells);
    g.append(row);
  }
  let last = -1;
  return {
    el: g,
    hint: `${MODULES[src?.type]?.name || 'batterie'} · clic : poser ou ôter un coup · Alt+clic : léger · clic droit : vélocité (fort, moyen, léger) · glisser : peindre · la colonne claire suit la lecture`,
    frame() {
      const st = Math.floor(playingStep(app, p, app.clip(app.S.sel.clip)));
      if (st === last) return;
      for (const cells of rowsEl) { cells.children[last]?.classList.remove('now'); if (st >= 0) cells.children[st]?.classList.add('now'); }
      last = st;
    },
  };
}

// ── le piano roll ───────────────────────────────────────────
const GRIDS = [[0.5, '1/32'], [1, '1/16'], [2, '1/8'], [4, '1/4']];
function pianoRoll(app, p, src, t, c, ui, tall) {
  const P = app.S.proj;
  const LO = 24, HI = 108, RH = tall ? 14 : 12;
  const acid = src?.type === 'acid';
  const chosen = new Set();
  let lastLen = 2;
  const wrap = el('div', { class: `pr${tall ? ' tall' : ''}` });
  const keys = el('div', { class: 'pr-keys' });
  const scrollX = el('div', { class: 'pr-sx' });
  const area = el('div', { class: 'pr-area' });
  const rows = el('div', { class: 'pr-rows' });
  const notes = el('div', { class: 'pr-notes' });
  const nowCol = el('i', { class: 'pr-now' });
  const box = el('i', { class: 'pr-box' });
  const velLane = el('div', { class: 'pr-vel', title: 'vélocité : glisser une barre' });
  const velScroll = el('div', { class: 'pr-vsx' }, velLane);
  // la voie des vélocités reste sous la grille, hors du défilement vertical
  const velBox = el('div', { class: 'pr-velbox' }, el('span', { class: 'lbl' }, 'vél.'), velScroll);
  area.append(rows, notes, nowCol, box);
  scrollX.append(area);
  wrap.append(keys, scrollX);
  scrollX.addEventListener('scroll', () => { velScroll.scrollLeft = scrollX.scrollLeft; });
  for (let q = HI; q >= LO; q--) {
    const inS = inScale(P.key, q), root = ((q - P.key.tonic) % 12 + 12) % 12 === 0;
    keys.append(el('button', { class: `pr-k${isBlack(q) ? ' blk' : ''}${q % 12 === 0 ? ' c' : ''}${inS ? ' in' : ''}${root ? ' root' : ''}`, type: 'button',
      style: { height: `${RH}px` }, onpointerdown: () => app.engine.preview(src.id, q) }, q % 12 === 0 || root ? noteName(q) : ''));
    rows.append(el('i', { class: `${inS ? 'in' : 'out'}${root ? ' root' : ''}`, style: { top: `${(HI - q) * RH}px`, height: `${RH}px` } }));
  }
  const H = (HI - LO + 1) * RH;
  area.style.height = `${H}px`;
  let cw = 14;
  const layout = () => {
    const avail = Math.max(200, scrollX.clientWidth - 2);
    cw = Math.max(avail / p.steps, 9);
    area.style.width = `${p.steps * cw}px`;
    velLane.style.width = `${p.steps * cw}px`;
    area.style.setProperty('--cw', `${cw}px`); area.style.setProperty('--bar', `${cw * P.sig * 4}px`); area.style.setProperty('--rh', `${RH}px`);
  };
  const gridS = () => ui.grid || 1;
  const snapS = (s) => Math.round(s / gridS()) * gridS();
  const paintNotes = () => {
    put(notes, ...p.notes.map((n, i) => el('div', { class: `pr-n${chosen.has(n) ? ' sel' : ''}${n.ac ? ' ac' : ''}${n.sl ? ' sl' : ''}`, 'data-i': i,
      style: { left: `${n.s * cw}px`, top: `${(HI - n.p) * RH}px`, width: `${Math.max(3, n.l * cw - 1)}px`, height: `${RH - 1}px`, opacity: 0.45 + 0.55 * (n.v ?? 0.8) },
      title: `${noteName(n.p)} · vélocité ${Math.round((n.v ?? 0.8) * 100)}${n.ac ? ' · accent' : ''}${n.sl ? ' · liée' : ''}` }, el('i', { class: 'rs' }))));
    put(velLane, ...p.notes.map((n, i) => el('i', { class: chosen.has(n) ? 'sel' : '', 'data-i': i,
      style: { left: `${n.s * cw}px`, height: `${Math.round((n.v ?? 0.8) * 100)}%` } })));
  };
  const commit = () => { paintNotes(); app.commit('quiet'); };
  const at = (ev) => {
    const r = area.getBoundingClientRect();
    return { s: (ev.clientX - r.left) / cw, p: HI - Math.floor((ev.clientY - r.top) / RH) };
  };
  area.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const hit = e.target.closest('.pr-n');
    if (hit) { const n = p.notes[+hit.dataset.i]; p.notes.splice(p.notes.indexOf(n), 1); chosen.delete(n); commit(); }
  });
  area.addEventListener('dblclick', (e) => {
    const hit = e.target.closest('.pr-n');
    if (hit) { const n = p.notes[+hit.dataset.i]; p.notes.splice(p.notes.indexOf(n), 1); chosen.delete(n); commit(); }
  });
  area.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    area.setPointerCapture(e.pointerId);
    const a0 = at(e);
    const hitEl = e.target.closest('.pr-n');
    let moved = false;
    if (hitEl) {
      const n = p.notes[+hitEl.dataset.i];
      const resizing = e.target.classList.contains('rs');
      if (e.shiftKey) { if (chosen.has(n)) chosen.delete(n); else chosen.add(n); paintNotes(); return; }
      if (!chosen.has(n)) { chosen.clear(); chosen.add(n); }
      const group = [...chosen].map((x) => ({ x, s: x.s, p: x.p, l: x.l }));
      const mv = (ev) => {
        const a = at(ev);
        const ds = snapS(a.s - a0.s), dp = a.p - a0.p;
        if (ds || dp) moved = true;
        for (const g of group) {
          if (resizing) g.x.l = Math.max(gridS() / 2, Math.min(p.steps - g.x.s, g.l + ds));
          else {
            g.x.s = clamp(g.s + ds, 0, p.steps - Math.min(g.l, p.steps));
            let np = clamp(g.p + dp, LO, HI);
            if (ui.scale) np = snapToScale(P.key, np);
            if (np !== g.x.p) { g.x.p = np; if (g.x === n) app.engine.preview(src.id, np); }
          }
        }
        paintNotes();
      };
      const up = () => {
        area.removeEventListener('pointermove', mv); area.removeEventListener('pointerup', up);
        if (moved) lastLen = n.l;
        commit();
      };
      area.addEventListener('pointermove', mv); area.addEventListener('pointerup', up);
      return;
    }
    if (e.shiftKey) {                                         // cadre de sélection
      const r = area.getBoundingClientRect();
      const mv = (ev) => {
        const a = at(ev);
        const s0 = Math.min(a0.s, a.s), s1 = Math.max(a0.s, a.s), p0 = Math.min(a0.p, a.p), p1 = Math.max(a0.p, a.p);
        Object.assign(box.style, { display: 'block', left: `${s0 * cw}px`, width: `${(s1 - s0) * cw}px`, top: `${(HI - p1) * RH}px`, height: `${(p1 - p0 + 1) * RH}px` });
        chosen.clear();
        for (const n of p.notes) if (n.s + n.l > s0 && n.s < s1 && n.p >= p0 && n.p <= p1) chosen.add(n);
        paintNotes();
      };
      const up = () => { area.removeEventListener('pointermove', mv); area.removeEventListener('pointerup', up); box.style.display = 'none'; void r; };
      area.addEventListener('pointermove', mv); area.addEventListener('pointerup', up);
      return;
    }
    const s = Math.floor(a0.s / gridS()) * gridS();
    let pitch = a0.p;
    if (s < 0 || s >= p.steps || pitch < LO || pitch > HI) return;
    if (ui.scale) pitch = snapToScale(P.key, pitch);
    const n = { s, l: Math.min(lastLen, p.steps - s), p: pitch, v: 0.8 };
    p.notes.push(n);
    chosen.clear(); chosen.add(n);
    app.engine.preview(src.id, n.p);
    paintNotes();
    const mv = (ev) => { const a = at(ev); n.l = Math.max(gridS() / 2, Math.min(p.steps - n.s, Math.ceil((a.s - n.s) / gridS()) * gridS())); paintNotes(); };
    const up = () => { area.removeEventListener('pointermove', mv); area.removeEventListener('pointerup', up); lastLen = n.l; commit(); };
    area.addEventListener('pointermove', mv); area.addEventListener('pointerup', up);
  });
  velLane.addEventListener('pointerdown', (e) => {
    const bar = e.target.closest('i[data-i]');
    if (!bar) return;
    e.preventDefault();
    velLane.setPointerCapture(e.pointerId);
    const n = p.notes[+bar.dataset.i];
    const targets = chosen.has(n) ? [...chosen] : [n];
    const r = velLane.getBoundingClientRect();
    const mv = (ev) => { const v = clamp(1 - (ev.clientY - r.top) / r.height, 0.05, 1); for (const x of targets) x.v = Math.round(v * 100) / 100; paintNotes(); };
    mv(e);
    const up = () => { velLane.removeEventListener('pointermove', mv); velLane.removeEventListener('pointerup', up); commit(); };
    velLane.addEventListener('pointermove', mv); velLane.addEventListener('pointerup', up);
  });

  const selOrAll = () => (chosen.size ? [...chosen] : p.notes);
  function quantize(q) {
    for (const n of selOrAll()) { n.s = clamp(Math.round(n.s / q) * q, 0, p.steps - q / 2); if (n.l < q / 2) n.l = q / 2; }
    commit(); toast(`quantifié à ${GRIDS.find(([v]) => v === q)?.[1] || q}`);
  }
  function transpose(d) {
    const g = selOrAll();
    for (const n of g) { let np = clamp(n.p + d, LO, HI); if (ui.scale && Math.abs(d) === 1) { np = n.p; do { np += d; } while (np >= LO && np <= HI && !inScale(P.key, np)); np = clamp(np, LO, HI); } n.p = np; }
    commit();
  }
  const tools = el('div', { class: 'pr-tools' },
    el('span', { class: 'lbl' }, 'grille'),
    el('div', { class: 'seg' }, GRIDS.map(([v, l]) => el('button', { class: `tb${gridS() === v ? ' on' : ''}`, type: 'button', onclick: (e) => {
      ui.grid = v; app.saveUi(); [...e.currentTarget.parentNode.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget));
    } }, l))),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'ramener les débuts de notes sur la grille (les notes choisies, sinon toutes) · Q', onclick: () => quantize(gridS()) }, 'Quantifier'),
    el('i', { class: 'ar-sep' }),
    el('button', { class: `tb sm${ui.scale ? ' on' : ' ghost'}`, type: 'button', title: `aimanter les notes à la gamme de la session (${keyLabel(P.key)})`,
      onclick: (e) => { ui.scale = !ui.scale; app.saveUi(); e.currentTarget.classList.toggle('on', ui.scale); e.currentTarget.classList.toggle('ghost', !ui.scale); } },
    `Gamme ${TONICS[P.key.tonic]} ${MODES[P.key.mode].label}`),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'descendre (↓ ; Maj : une octave)', onclick: () => transpose(-1) }, '−'),
    el('button', { class: 'tb ghost sm', type: 'button', title: 'monter (↑ ; Maj : une octave)', onclick: () => transpose(1) }, '+'),
    acid ? el('i', { class: 'ar-sep' }) : null,
    acid ? el('button', { class: 'tb ghost sm', type: 'button', title: 'accent : plus fort et plus ouvert (la 303)', onclick: () => { for (const n of selOrAll()) n.ac = !n.ac || undefined; commit(); } }, 'Accent') : null,
    acid ? el('button', { class: 'tb ghost sm', type: 'button', title: 'liaison : la note glisse depuis la précédente (la 303)', onclick: () => { for (const n of selOrAll()) n.sl = !n.sl || undefined; commit(); } }, 'Liaison') : null,
    el('span', { class: 'sp' }),
    el('span', { class: 'lbl' }, `${p.notes.length} note${p.notes.length > 1 ? 's' : ''}`));
  const ro = new ResizeObserver(() => { layout(); paintNotes(); });
  requestAnimationFrame(() => {
    layout(); paintNotes();
    const ps = p.notes.map((n) => n.p);
    const mid = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : 60;
    wrap.scrollTop = (HI - mid) * RH - wrap.clientHeight / 2;
    ro.observe(scrollX);
  });
  return {
    el: el('div', { class: 'pr-wrap', style: { '--k': `var(--${t.color})` } }, tools, wrap, velBox),
    hint: 'clic : une note · glisser : sa longueur · glisser une note : la déplacer · Maj+glisser : choisir · double-clic ou clic droit : l\'ôter · ↑ ↓ transposer · Ctrl+A tout · Suppr · Q quantifier · la voie du bas : vélocités',
    frame() {
      const st = playingStep(app, p, c);
      nowCol.style.display = st >= 0 ? 'block' : 'none';
      if (st >= 0) nowCol.style.transform = `translateX(${Math.floor(st) * cw}px)`;
      nowCol.style.width = `${cw}px`;
    },
    key(e) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.target.closest?.('input, textarea, select')) return false;
      if ((e.key === 'Delete' || e.key === 'Backspace') && chosen.size) { e.preventDefault(); p.notes = p.notes.filter((n) => !chosen.has(n)); chosen.clear(); commit(); return true; }
      if (ctrl && e.code === 'KeyA') { e.preventDefault(); for (const n of p.notes) chosen.add(n); paintNotes(); return true; }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && chosen.size) { e.preventDefault(); transpose((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1)); return true; }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && chosen.size) {
        e.preventDefault();
        const d = (e.key === 'ArrowLeft' ? -1 : 1) * gridS();
        if ([...chosen].every((n) => n.s + d >= 0 && n.s + d + n.l <= p.steps)) { for (const n of chosen) n.s += d; commit(); }
        return true;
      }
      if (ctrl && e.code === 'KeyD' && chosen.size) {
        e.preventDefault();
        const g = [...chosen], a = Math.min(...g.map((n) => n.s)), b = Math.max(...g.map((n) => n.s + n.l));
        chosen.clear();
        for (const n of g) if (n.s + (b - a) < p.steps) { const m = { ...n, s: n.s + (b - a) }; p.notes.push(m); chosen.add(m); }
        commit(); return true;
      }
      if (e.code === 'KeyQ' && !ctrl) { e.preventDefault(); quantize(gridS()); return true; }
      return false;
    },
  };
}

// ── l'éditeur audio ─────────────────────────────────────────
function audioEditor(app, host, c, t) {
  const P = app.S.proj;
  const spb = 60 / P.bpm;
  const cv = el('canvas', { class: 'ae-wave', title: 'glisser : choisir où le clip commence dans le son' });
  const info = el('span', { class: 'lbl' }, '…');
  const title = el('b', { class: 'venus' }, c.name || '…');
  app.loadItem(c.item).then((it) => { if (!c.name) title.textContent = it.title; }).catch(() => { title.textContent = 'son introuvable'; });
  const K = (label, k, min, max, def, unit, curve = 'lin') => knob({ k, label, min, max, def, unit, curve, step: 0 }, c[k] ?? def, { accent: t.color,
    onInput: (v) => { c[k] = Math.round(v * 1000) / 1000; draw(); }, onChange: () => app.commit('data') });
  const draw = () => {
    const buf = app.engine.buffers.get(c.item);
    const w = cv.clientWidth || 600, h = cv.clientHeight || 110, dpr = devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!buf) { app.engine.buffer(c.item).then(draw).catch(() => {}); return; }
    const pk = peaks(buf, 2400), D = buf.duration;
    const off = c.off || 0, L = c.len * spb;
    const regionEnd = c.loop ? off + Math.min(c.llen || (D - off), D - off) : Math.min(D, off + L);
    const xOf = (s) => (s / D) * w;
    g.fillStyle = tok('cy-bg'); g.fillRect(xOf(off), 0, Math.max(1, xOf(regionEnd) - xOf(off)), h);
    for (let x = 0; x < w; x++) {
      const v = pk[Math.floor((x / w) * pk.length)], hh = Math.max(1, v * (h - 4));
      const s = (x / w) * D;
      g.fillStyle = s >= off && s < regionEnd ? tok(t.color) : tok('ink3');
      g.fillRect(x, (h - hh) / 2, 1, hh);
    }
    g.strokeStyle = tok('or'); g.lineWidth = 1.5; g.beginPath();
    const fi = c.fi || 0, fo = c.fo || 0;
    g.moveTo(xOf(off), fi ? h - 2 : 2); g.lineTo(xOf(off + Math.min(fi, L)), 2);
    g.lineTo(xOf(Math.min(regionEnd, off + Math.max(0, L - fo))), 2); g.lineTo(xOf(regionEnd), fo ? h - 2 : 2);
    g.stroke();
    const pkDb = peakDb(buf, off, regionEnd);
    info.textContent = `son ${D.toFixed(2)} s · clip ${L.toFixed(2)} s · départ ${off.toFixed(2)} s · crête ${pkDb.toFixed(1)} dBFS${c.gain ? ` (+ gain ${c.gain > 0 ? '+' : ''}${c.gain.toFixed(1)} dB)` : ''}`;
  };
  cv.addEventListener('pointerdown', (e) => {
    const buf = app.engine.buffers.get(c.item);
    if (!buf) return;
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    const x0 = e.clientX, o0 = c.off || 0, w = cv.clientWidth;
    const maxOff = c.loop ? buf.duration - 0.02 : Math.max(0, buf.duration - c.len * spb);
    const mv = (ev) => { c.off = clamp(o0 + ((ev.clientX - x0) / w) * buf.duration, 0, Math.max(0, maxOff)); draw(); };
    const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); app.commit('data'); };
    cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
  });
  const normalize = () => {
    const buf = app.engine.buffers.get(c.item);
    if (!buf) return;
    const off = c.off || 0, pk = peakDb(buf, off, off + c.len * spb);
    if (!isFinite(pk)) { toast('le clip est silencieux'); return; }
    c.gain = Math.round((-1 - pk) * 10) / 10;
    toast(`gain ${c.gain > 0 ? '+' : ''}${c.gain} dB : la crête du clip à −1 dBFS`);
    app.commit('data');
  };
  put(host, el('div', { class: 'ae' },
    el('div', { class: 'pe-head' }, el('span', { class: 'k', style: { '--c': `var(--${t.color})` } }, t.name), title, el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'à la tête de lecture · Ctrl+E', onclick: () => app.splitAtPlayhead() }, 'Couper'),
      el('button', { class: `tb sm${c.loop ? ' on' : ' ghost'}`, type: 'button', title: 'le son se répète sur toute la longueur du clip (tirer le bord droit)', onclick: () => app.toggleLoop(c.id) }, c.loop ? 'En boucle' : 'Boucler'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'la crête du clip à −1 dBFS', onclick: normalize }, 'Normaliser'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'voix, batterie, basse, autre : chacun sur sa piste, alignés', onclick: () => app.stems(c.id) }, 'Séparer en pistes'),
      el('a', { class: 'tb ghost sm', href: href('asset/'), target: '_blank', rel: 'noopener' }, 'Asset')),
    el('div', { class: 'ae-body' },
      el('div', { class: 'kns' },
        K('Gain', 'gain', -24, 12, 0, 'dB'), K('Fondu entrée', 'fi', 0, 10, 0, 's'), K('Fondu sortie', 'fo', 0, 10, 0, 's'),
        c.loop ? K('Boucle', 'llen', 0.05, 30, 2, 's', 'log') : null),
      el('div', { class: 'ae-w' }, cv, info))));
  requestAnimationFrame(draw);
  return { frame() {}, key() { return false; } };
}
