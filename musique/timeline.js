// MUSIQUE — la vue Timeline : l'arrangement.
// Une rangée par piste : son en-tête (muet, solo, volume, panoramique) et
// sa voie de clips. Les clips se déplacent et se rallongent au temps près
// (Alt : à la double croche, Maj : à la mesure) ; double-clic sur une voie
// vide = un clip (motif de la piste, ou un son de la bibliothèque).
// La règle : clic = aller là ; la bande du haut = la boucle.

import { toast } from '../commun/shell.js';
import { MODULES, TRACK_KINDS, DRUM_VOICES, spec, val } from './modules.js';
import { peaks, songEnd } from './moteur.js';
import { el, knob, menu, ask, tok, clamp } from './ui.js';

const HEAD_W = 232;
const ROW_H = 66;

export function createTimeline(app) {
  const { S } = app;
  let zoom = 22;                         // pixels par noire
  const root = el('section', { class: 'tl', 'aria-label': 'timeline' });
  const tools = el('div', { class: 'tl-tools' });
  const scroll = el('div', { class: 'tl-scroll' });
  const grid = el('div', { class: 'tl-grid' });
  const ph = el('div', { class: 'tl-ph' });
  scroll.append(grid);
  root.append(tools, scroll);

  const snapUnit = (e) => (e.altKey ? 0.25 : e.shiftKey ? S.proj.sig : 1);
  const snap = (b, u) => Math.round(b / u) * u;
  const beatAt = (clientX) => (clientX - grid.getBoundingClientRect().left - HEAD_W) / zoom;
  const width = () => (Math.max(songEnd(S.proj), S.proj.loop.b, 16 * S.proj.sig) + 8 * S.proj.sig) * zoom;

  // ── la barre d'outils ──
  function paintTools() {
    const c = app.clip(S.sel.clip);
    const t = c && app.track(c.track);
    const pos = app.pos();
    const inside = c && pos > c.start && pos < c.start + c.len;
    const btn = (label, on, why, fn) => el('button', { class: 'tb ghost sm', type: 'button', disabled: !on || null,
      title: on ? '' : why, onclick: fn }, label);
    tools.replaceChildren(
      el('button', { class: 'tb ghost sm', type: 'button', onclick: (e) => addTrackMenu(e) }, '+ Piste'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'poser un son de la bibliothèque à la tête de lecture',
        onclick: () => app.addAudio(S.sel.track) }, '+ Son'),
      el('span', { class: 'tl-sep' }),
      btn('Couper', inside, c ? 'place la tête de lecture dans le clip' : 'choisis un clip', splitClip),
      btn('Dupliquer', !!c, 'choisis un clip', dupClip),
      btn('Motif à part', c && t.kind !== 'audio', 'choisis un clip de motif', uniqueClip),
      btn('Séparer', c && t.kind === 'audio', 'choisis un clip audio (voix, batterie, basse, reste)', () => app.stems(c.id)),
      btn('Retirer', !!c, 'choisis un clip', removeClip),
      el('span', { class: 'sp' }),
      el('span', { class: 'lbl' }, c ? `${t.name} · ${app.bar(c.start)} → ${app.bar(c.start + c.len)}` : 'double-clic sur une voie : un clip'),
      el('span', { class: 'tl-sep' }),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'dézoomer', onclick: () => setZoom(zoom / 1.3) }, '−'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'zoomer', onclick: () => setZoom(zoom * 1.3) }, '+'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'tout le morceau à l\'écran', onclick: fit }, 'Ajuster'));
  }

  function addTrackMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    menu(r.left, r.bottom + 4, Object.entries(TRACK_KINDS).map(([k, K]) => ({
      label: K.label, dot: K.color, sub: MODULES[K.src].name,
      onclick: () => { app.addTrack(k); app.commit('graph'); },
    })));
  }

  function setZoom(z) {
    const mid = (scroll.scrollLeft + scroll.clientWidth / 2 - HEAD_W) / zoom;
    zoom = clamp(z, 4, 160);
    render();
    scroll.scrollLeft = mid * zoom + HEAD_W - scroll.clientWidth / 2;
  }
  function fit() {
    const end = Math.max(songEnd(S.proj), S.proj.loop.b, 4);
    zoom = clamp((scroll.clientWidth - HEAD_W - 40) / end, 4, 160);
    render();
    scroll.scrollLeft = 0;
  }

  // ── les actions sur un clip ──
  function splitClip() {
    const c = app.clip(S.sel.clip), pos = snap(app.pos(), 0.25);
    if (!c || pos <= c.start || pos >= c.start + c.len) return;
    const t = app.track(c.track);
    const cut = pos - c.start;
    const n = { ...c, id: app.uid('c'), start: pos, len: c.len - cut };
    n.off = t.kind === 'audio' ? (c.off || 0) + cut * 60 / S.proj.bpm : (c.off || 0) + cut;
    c.len = cut;
    S.proj.clips.push(n);
    S.sel.clip = n.id;
    app.commit('data');
  }
  function dupClip() {
    const c = app.clip(S.sel.clip);
    if (!c) return;
    const n = { ...c, id: app.uid('c'), start: c.start + c.len };
    S.proj.clips.push(n);
    S.sel.clip = n.id;
    app.commit('data');
  }
  function uniqueClip() {
    const c = app.clip(S.sel.clip);
    if (!c?.pat) return;
    const p = app.newPattern(c.track, app.pat(c.pat));
    c.pat = p.id;
    toast(`ce clip joue maintenant « ${p.name} »`);
    app.commit('data');
  }
  function removeClip() {
    S.proj.clips = S.proj.clips.filter((x) => x.id !== S.sel.clip);
    S.sel.clip = null;
    app.commit('data');
  }

  // ── la règle et la boucle ──
  function ruler() {
    const P = S.proj, W = width(), bars = Math.ceil(W / zoom / P.sig);
    const r = el('div', { class: 'tl-ruler', style: { width: `${W}px` } });
    const band = el('div', { class: 'tl-band', title: 'glisser : la boucle' });
    const L = el('div', { class: `tl-loop${P.loop.on ? ' on' : ''}`, style: { left: `${P.loop.a * zoom}px`, width: `${(P.loop.b - P.loop.a) * zoom}px` } },
      el('i', { class: 'h a' }), el('i', { class: 'h b' }));
    band.append(L);
    const nums = el('div', { class: 'tl-nums' });
    for (let b = 0; b < bars; b++) {
      if (zoom * P.sig < 26 && b % 4) continue;
      nums.append(el('span', { style: { left: `${b * P.sig * zoom}px` } }, String(b + 1)));
    }
    r.append(band, nums);
    band.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      band.setPointerCapture(e.pointerId);
      const b0 = beatAt(e.clientX);
      const edge = e.target.classList.contains('h') ? (e.target.classList.contains('a') ? 'a' : 'b') : null;
      const inLoop = !edge && e.target === L;
      const la = P.loop.a, lb = P.loop.b;
      const mv = (ev) => {
        const u = ev.altKey ? 0.25 : 1, b = snap(beatAt(ev.clientX), u);
        if (edge === 'a') P.loop.a = clamp(b, 0, P.loop.b - u);
        else if (edge === 'b') P.loop.b = Math.max(P.loop.a + u, b);
        else if (inLoop) { const d = snap(beatAt(ev.clientX) - b0, u); const len = lb - la; P.loop.a = Math.max(0, la + d); P.loop.b = P.loop.a + len; }
        else { const s = snap(b0, u); P.loop.a = Math.max(0, Math.min(s, b)); P.loop.b = Math.max(s, b); if (P.loop.b - P.loop.a < u) P.loop.b = P.loop.a + u; }
        L.style.left = `${P.loop.a * zoom}px`; L.style.width = `${(P.loop.b - P.loop.a) * zoom}px`;
        zone.style.left = `${HEAD_W + P.loop.a * zoom}px`; zone.style.width = `${(P.loop.b - P.loop.a) * zoom}px`;
      };
      const up = () => { band.removeEventListener('pointermove', mv); band.removeEventListener('pointerup', up); P.loop.on = true; app.commit('meta'); };
      band.addEventListener('pointermove', mv); band.addEventListener('pointerup', up);
    });
    nums.addEventListener('pointerdown', (e) => {
      const go = (ev) => app.engine.seek(Math.max(0, snap(beatAt(ev.clientX), ev.altKey ? 0.25 : 1)));
      go(e);
      nums.setPointerCapture(e.pointerId);
      const up = () => { nums.removeEventListener('pointermove', go); nums.removeEventListener('pointerup', up); paintTools(); };
      nums.addEventListener('pointermove', go); nums.addEventListener('pointerup', up);
    });
    return r;
  }
  const zone = el('div', { class: 'tl-zone' });

  // ── une rangée ──
  function head(t) {
    const st = app.mod(t.strip);
    const k = (key) => knob(spec('strip', key), val(st, key), { size: 'xs', accent: t.color,
      onInput: (v) => { st.params[key] = v; app.commit('param', st); } });
    const tog = (label, on, title, fn) => el('button', { class: `tb sm${on ? ' on' : ' ghost'}`, type: 'button', title, 'aria-pressed': on, onclick: (e) => { e.stopPropagation(); fn(); } }, label);
    return el('div', { class: `tl-head${S.sel.track === t.id ? ' sel' : ''}${t.mute ? ' muted' : ''}`, style: { '--c': `var(--${t.color})` },
      onclick: () => app.select({ track: t.id }) },
    el('i', { class: 'bar' }),
    el('div', { class: 'txt' },
      el('span', { class: 'nm', title: 'double-clic : renommer', ondblclick: async (e) => {
        e.stopPropagation();
        const n = await ask('Renommer la piste', 'Nom', t.name, 'Renommer');
        if (n) { t.name = n.slice(0, 60); app.commit('data'); }
      } }, t.name),
      el('span', { class: 'kd' }, `${TRACK_KINDS[t.kind].label} · ${MODULES[app.mod(t.src)?.type]?.name || ''}`),
      el('div', { class: 'row' },
        tog('M', t.mute, 'muet', () => { t.mute = !t.mute; app.commit('mute'); }),
        tog('S', t.solo, 'solo', () => { t.solo = !t.solo; app.commit('mute'); }),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'ouvrir le rack de la piste',
          onclick: (e) => { e.stopPropagation(); app.select({ track: t.id }); app.setView('rack'); } }, 'Rack'),
        el('button', { class: 'tb ghost sm x', type: 'button', title: 'retirer la piste', onclick: (e) => { e.stopPropagation(); app.removeTrack(t.id); } }, '×'))),
    el('div', { class: 'kn2' }, k('vol'), k('pan')));
  }

  function lane(t) {
    const P = S.proj;
    const ln = el('div', { class: 'tl-lane', style: { width: `${width()}px`, '--bar': `${P.sig * zoom}px`, '--beat': `${zoom}px`, '--c': `var(--${t.color})` } });
    for (const c of P.clips.filter((x) => x.track === t.id)) ln.append(clipEl(c, t));
    ln.addEventListener('dblclick', (e) => {
      if (e.target !== ln) return;
      const b = Math.floor(beatAt(e.clientX));
      if (t.kind === 'audio') app.addAudio(t.id, Math.max(0, b));
      else app.addClip(t.id, Math.max(0, snap(b, 1)));
    });
    ln.addEventListener('pointerdown', (e) => {
      if (e.target !== ln) return;
      S.sel.clip = null;
      app.select({ track: t.id });
    });
    return ln;
  }

  function clipEl(c, t) {
    const P = S.proj;
    const pat = c.pat && app.pat(c.pat);
    const name = t.kind === 'audio' ? '' : pat?.name || '';
    const cv = el('canvas', { class: 'cv' });
    const ttl = el('span', { class: 't' }, name);
    const box = el('div', { class: `clip${S.sel.clip === c.id ? ' sel' : ''}${t.mute ? ' muted' : ''}`, 'data-id': c.id,
      style: { left: `${c.start * zoom}px`, width: `${Math.max(4, c.len * zoom)}px` } },
    ttl, cv, el('i', { class: 'rs', title: 'rallonger' }));
    if (t.kind === 'audio') app.loadItem(c.item).then((it) => { ttl.textContent = it.title; box.title = it.title; }).catch(() => { ttl.textContent = 'son introuvable'; });
    requestAnimationFrame(() => drawClip(cv, c, t, pat));
    box.addEventListener('dblclick', (e) => { e.stopPropagation(); if (c.pat) app.openPattern(c.pat); });
    box.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      S.sel.clip = c.id;
      menu(e.clientX, e.clientY, [
        { label: 'Couper à la tête de lecture', onclick: splitClip },
        { label: 'Dupliquer', onclick: dupClip },
        ...(c.pat ? [{ label: 'Ouvrir le motif', onclick: () => app.openPattern(c.pat) }, { label: 'Motif à part (copie)', onclick: uniqueClip }] : []),
        ...(t.kind === 'audio' ? [{ label: 'Séparer voix · batterie · basse · reste', onclick: () => app.stems(c.id) }] : []),
        '-', { label: 'Retirer', onclick: removeClip },
      ]);
    });
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const resize = e.target.classList.contains('rs');
      S.sel.clip = c.id; S.sel.track = t.id;
      root.querySelectorAll('.clip.sel').forEach((x) => x.classList.remove('sel'));
      box.classList.add('sel');
      box.setPointerCapture(e.pointerId);
      const x0 = e.clientX, s0 = c.start, l0 = c.len, tr0 = c.track;
      let moved = false;
      const mv = (ev) => {
        const d = (ev.clientX - x0) / zoom, u = snapUnit(ev);
        if (Math.abs(ev.clientX - x0) > 2) moved = true;
        if (resize) c.len = Math.max(u, snap(l0 + d, u));
        else {
          c.start = Math.max(0, snap(s0 + d, u));
          if (t.kind === 'audio') {           // un clip audio peut changer de piste audio
            const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tl-lane');
            const ot = over && P.tracks[[...grid.querySelectorAll('.tl-lane')].indexOf(over)];
            if (ot && ot.kind === 'audio' && ot.id !== c.track) { c.track = ot.id; over.append(box); }
          }
        }
        box.style.left = `${c.start * zoom}px`; box.style.width = `${Math.max(4, c.len * zoom)}px`;
      };
      const up = () => {
        box.removeEventListener('pointermove', mv); box.removeEventListener('pointerup', up);
        if (moved) { if (resize) drawClip(cv, c, t, pat); app.commit('data'); }
        else { paintTools(); if (c.track !== tr0) app.commit('data'); }
      };
      box.addEventListener('pointermove', mv); box.addEventListener('pointerup', up);
    });
    return box;
  }

  function drawClip(cv, c, t, pat) {
    const w = Math.max(4, Math.min(8000, Math.round(c.len * zoom))), h = ROW_H - 26;
    const dpr = devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = tok(t.color);
    const P = S.proj;
    if (t.kind === 'audio') {
      const buf = app.engine.buffers.get(c.item);
      if (!buf) { app.engine.buffer(c.item).then(() => drawClip(cv, c, t, pat)).catch(() => {}); return; }
      const pk = peaks(buf, 4000), spb = 60 / P.bpm;
      for (let x = 0; x < w; x++) {
        const sec = (c.off || 0) + (x / zoom) * spb;
        if (sec >= buf.duration) break;
        const v = pk[Math.min(pk.length - 1, Math.floor(sec / buf.duration * pk.length))];
        const hh = Math.max(1, v * (h - 2));
        g.fillRect(x, (h - hh) / 2, 1, hh);
      }
      return;
    }
    if (!pat) return;
    const plen = pat.steps / 4, off = c.off || 0;
    if (t.kind === 'drums') {
      const rows = DRUM_VOICES.length, rh = h / rows;
      for (let r = 0; r < rows; r++) {
        const lane = pat.lanes?.[DRUM_VOICES[r].id];
        if (!lane) continue;
        for (let b = -off; b < c.len; b += plen) {
          lane.forEach((v, s) => {
            const x = (b + s / 4) * zoom;
            if (v && x >= 0 && x < w) { g.globalAlpha = 0.45 + 0.55 * v; g.fillRect(x, r * rh + 1, Math.max(2, zoom / 4 - 1), rh - 2); }
          });
        }
      }
      g.globalAlpha = 1;
    } else {
      const ps = (pat.notes || []).map((n) => n.p);
      const lo = Math.min(...ps, 60) - 1, hi = Math.max(...ps, 61) + 1;
      for (let b = -off; b < c.len; b += plen) {
        for (const n of pat.notes || []) {
          const x = (b + n.s / 4) * zoom;
          if (x + n.l / 4 * zoom < 0 || x >= w) continue;
          const y = h - ((n.p - lo) / (hi - lo)) * h;
          g.fillRect(x, y - 2, Math.max(2, n.l / 4 * zoom - 1), 3);
        }
      }
    }
    g.fillStyle = tok('line');
    for (let b = plen - off; b < c.len; b += plen) g.fillRect(b * zoom, 0, 1, h);
  }

  // ── l'ensemble ──
  function render() {
    const P = S.proj;
    paintTools();
    const W = width();
    grid.style.setProperty('--head', `${HEAD_W}px`);
    grid.style.width = `${HEAD_W + W}px`;
    const rows = [el('div', { class: 'tl-corner' },
      el('span', { class: 'lbl' }, `${P.tracks.length} piste${P.tracks.length > 1 ? 's' : ''} · ${P.bpm} bpm`)), ruler()];
    for (const t of P.tracks) rows.push(head(t), lane(t));
    if (!P.tracks.length) rows.push(el('div', { class: 'tl-empty' }, el('b', {}, 'Aucune piste'), el('span', {}, '« + Piste » : une batterie, un synthé, un échantillonneur ou une piste audio')));
    zone.style.left = `${HEAD_W + P.loop.a * zoom}px`;
    zone.style.width = `${(P.loop.b - P.loop.a) * zoom}px`;
    zone.classList.toggle('on', P.loop.on);
    grid.replaceChildren(...rows, zone, ph);
    frame(app.pos());
  }

  function frame(beat) {
    ph.style.transform = `translateX(${HEAD_W + beat * zoom}px)`;
    if (app.engine.running) {
      const x = HEAD_W + beat * zoom;
      if (x > scroll.scrollLeft + scroll.clientWidth - 60 || x < scroll.scrollLeft + HEAD_W) scroll.scrollLeft = x - HEAD_W - 60;
    }
  }

  function key(e) {
    if (e.key === 'Delete' || e.key === 'Backspace') { if (S.sel.clip) { e.preventDefault(); removeClip(); } }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') dupClip();
  }

  scroll.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });
  document.addEventListener('mu:buffer', () => { if (S.view === 'timeline') render(); });

  return { el: root, render, frame, key };
}
