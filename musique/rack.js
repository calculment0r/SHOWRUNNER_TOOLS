// MUSIQUE — la vue Rack : la chaîne d'une piste (source → effets →
// tranche), module par module avec ses molettes, et l'éditeur de motifs
// (séquenceur à pas pour la DR-9, piano roll pour le synthé et
// l'échantillonneur). Les effets s'ajoutent, se déplacent et se retirent
// ici ; c'est la même chaîne de câbles que dans la vue Nodal.

import { toast, pick, href } from '../commun/shell.js';
import { MODULES, TRACK_KINDS, EFFECT_TYPES, DRUM_VOICES, spec, val, noteName, isBlack, fmt } from './modules.js';
import { peaks } from './moteur.js';
import { el, knob, choice, menu, ask, tok, put } from './ui.js';

const BUS = '__bus';

export function createRack(app) {
  const { S } = app;
  const root = el('section', { class: 'rk', 'aria-label': 'rack' });
  const side = el('aside', { class: 'rk-side' });
  const main = el('div', { class: 'rk-main' });
  root.append(side, main);
  let padSel = 'bd';
  const meters = [];

  // ── la liste des pistes ──
  function paintSide() {
    const P = S.proj;
    put(side,
      el('div', { class: 'c-head' }, el('h2', {}, 'Pistes'), el('span', { class: 'cnt' }, String(P.tracks.length))),
      el('ul', { class: 'rack' }, P.tracks.map((t) => el('li', {},
        el('button', { class: `item${S.sel.track === t.id ? ' sel' : ''}`, type: 'button', style: { '--c': `var(--${t.color})` },
          onclick: () => app.select({ track: t.id, mod: null }) },
        el('i', { class: 'st rk-dot' }),
        el('span', { class: 'txt' }, el('span', { class: 'ref' }, `${TRACK_KINDS[t.kind].label}${t.mute ? ' · muet' : ''}${t.solo ? ' · solo' : ''}`),
          el('span', { class: 'nm' }, t.name),
          el('span', { class: 'sub' }, app.chain(t.id).map((m) => MODULES[m.type].name).join(' → '))),
        el('span', { class: 'dots' })))),
      el('li', {}, el('button', { class: `item${S.sel.track === BUS ? ' sel' : ''}`, type: 'button', onclick: () => app.select({ track: BUS, mod: null }) },
        el('i', { class: 'st ok' }),
        el('span', { class: 'txt' }, el('span', { class: 'ref' }, 'bus'), el('span', { class: 'nm' }, 'Bus et sortie'),
          el('span', { class: 'sub' }, `${P.modules.filter((m) => !m.track).length} module(s) · la sortie`))))),
      el('button', { class: 'tb ghost block', type: 'button', onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        menu(r.left, r.bottom + 4, Object.entries(TRACK_KINDS).map(([k, K]) => ({ label: K.label, dot: K.color, sub: MODULES[K.src].name,
          onclick: () => { app.addTrack(k); app.commit('graph'); } })));
      } }, '+ Piste'));
  }

  // ── un module ──
  const onoff = (m) => el('button', { class: `tb sm${m.on !== false ? ' on' : ' ghost'}`, type: 'button', title: 'actif ou court-circuité',
    onclick: () => { m.on = m.on === false; app.commit('graph'); } }, m.on !== false ? 'Actif' : 'Bypass');

  function kn(m, k, accent, size = 'md') {
    const s = spec(m.type, k);
    if (s.opts && size !== 'xs') return choice(s, val(m, k), { onChange: (v) => { m.params[k] = v; app.commit('param', m); app.commit('data'); } });
    return knob(s, val(m, k), { accent, size, onInput: (v) => { m.params[k] = v; app.commit('param', m); },
      // les dessins (enveloppe, filtre, départ du son) suivent une fois la molette lâchée
      onChange: () => { if (m.type === 'synth' || m.type === 'sampler') paintMain(); } });
  }

  function devHead(m, t, extra = []) {
    const def = MODULES[m.type], fx = def.role === 'effect';
    const ch = t ? app.chain(t.id) : [];
    const i = ch.findIndex((x) => x.id === m.id);
    return el('div', { class: 'dev-head' },
      el('i', { class: 'dot' }),
      el('b', { class: 'venus' }, def.name), el('span', { class: 'lbl' }, def.kind),
      ...extra,
      el('span', { class: 'sp' }),
      fx && t && i > 0 ? el('button', { class: 'tb ghost sm', type: 'button', title: 'plus tôt dans la chaîne', disabled: i <= 1 || null, onclick: () => app.moveInChain(t.id, m.id, -1) }, '↑') : null,
      fx && t && i > 0 ? el('button', { class: 'tb ghost sm', type: 'button', title: 'plus tard dans la chaîne', disabled: i >= ch.length - 2 || null, onclick: () => app.moveInChain(t.id, m.id, 1) }, '↓') : null,
      def.role === 'source' || fx ? onoff(m) : null,
      fx ? el('button', { class: 'tb ghost sm', type: 'button', title: 'retirer l\'effet (ses câbles se referment)', onclick: () => app.removeModule(m.id) }, '×') : null);
  }

  function device(m, t) {
    const def = MODULES[m.type];
    const accent = t?.color || def.color;
    const box = el('div', { class: `dev ${m.type}${m.on === false ? ' off' : ''}`, style: { '--k': `var(--${accent})` }, 'data-mod': m.id });
    if (m.type === 'drums') box.append(devHead(m, t), drumBody(m, t, accent));
    else if (m.type === 'synth') box.append(devHead(m, t), synthBody(m, accent));
    else if (m.type === 'sampler') box.append(devHead(m, t), samplerBody(m, t, accent));
    else if (m.type === 'player') {
      const n = S.proj.clips.filter((c) => c.track === t.id).length;
      box.append(devHead(m, t), el('div', { class: 'dev-body' },
        el('p', { class: 'lbl' }, `lit les ${n} clip${n > 1 ? 's' : ''} audio de la piste`), kn(m, 'vol', accent),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.addAudio(t.id) }, '+ Son')));
    } else if (def.role === 'strip' || def.role === 'master') {
      const mt = el('div', { class: 'mtr' }, el('i'));
      meters.push([m.id, mt]);
      box.append(devHead(m, t), el('div', { class: 'dev-body' },
        ...def.params.map((p) => kn(m, p.k, accent)), mt,
        t ? el('div', { class: 'row' },
          el('button', { class: `tb sm${t.mute ? ' on' : ' ghost'}`, type: 'button', onclick: () => { t.mute = !t.mute; app.commit('mute'); } }, 'Muet'),
          el('button', { class: `tb sm${t.solo ? ' on' : ' ghost'}`, type: 'button', onclick: () => { t.solo = !t.solo; app.commit('mute'); } }, 'Solo')) : null));
    } else {
      box.append(devHead(m, t), el('div', { class: 'dev-body' }, ...def.params.map((p) => kn(m, p.k, accent))));
    }
    return box;
  }

  // la DR-9 : huit pads (clic = écouter et régler cette voix)
  function drumBody(m, t, accent) {
    const v = DRUM_VOICES.find((x) => x.id === padSel) || DRUM_VOICES[0];
    const pads = el('div', { class: 'pads' }, DRUM_VOICES.map((x, i) => el('button', {
      class: `pad${x.id === v.id ? ' on' : ''}`, type: 'button', title: `${x.name} — clic : écouter`,
      onpointerdown: () => { padSel = x.id; app.engine.hit(m.id, x.id, 1); paintMain(); },
    }, el('span', { class: 'no' }, String(i + 1).padStart(2, '0')), el('span', { class: 'nm' }, x.name))));
    return el('div', { class: 'dev-body dr9' },
      el('div', { class: 'padsel' }, el('span', { class: 'lbl' }, 'pad choisi'),
        el('b', { class: 'venus' }, String(DRUM_VOICES.indexOf(v) + 1).padStart(2, '0')), el('span', {}, v.name)),
      pads,
      el('div', { class: 'kns' }, kn(m, `${v.id}_tune`, accent), kn(m, `${v.id}_dec`, accent), kn(m, `${v.id}_lvl`, accent),
        el('i', { class: 'vsep' }), kn(m, 'lvl', 'cy')));
  }

  function synthBody(m, accent) {
    const def = MODULES.synth;
    return el('div', { class: 'dev-body synth' }, def.sections.map(([name, keys]) => el('div', { class: 'sec' },
      el('span', { class: 'lbl' }, name),
      name === 'Oscillateur' ? waveSvg(val(m, 'wave')) : name === 'Enveloppe' ? adsrSvg(m) : name === 'Filtre' ? filterSvg(m) : null,
      el('div', { class: 'kns' }, keys.map((k) => kn(m, k, k === keys[0] ? accent : 'cy'))))));
  }

  function samplerBody(m, t, accent) {
    const id = m.params.item;
    const cv = el('canvas', { class: 'wave' });
    const title = el('span', { class: 'sn' }, id ? '…' : 'aucun son');
    if (id) {
      app.loadItem(id).then((it) => { title.textContent = it.title; }).catch(() => { title.textContent = 'son introuvable'; });
      app.engine.buffer(id).then((buf) => drawWave(cv, buf, val(m, 'start'))).catch(() => {});
    }
    return el('div', { class: 'dev-body sampler' },
      el('div', { class: 'snd' }, el('span', { class: 'lbl' }, 'son'), title,
        el('button', { class: 'tb ghost sm', type: 'button', onclick: async () => {
          const [it] = await pick({ kinds: ['audio'], title: 'Un son pour l\'échantillonneur' });
          if (!it) return;
          app.items.set(it.id, Promise.resolve({ ...it, href: href(it.url) }));
          m.params.item = it.id;
          await app.engine.buffer(it.id).catch((e) => toast(e.message));
          app.commit('graph');
        } }, id ? 'Changer' : 'Choisir un son'),
        id ? el('button', { class: 'tb ghost sm', type: 'button', title: 'jouer la note racine', onclick: () => app.engine.preview(m.id, val(m, 'root')) }, 'Écouter') : null),
      cv,
      el('div', { class: 'kns' }, MODULES.sampler.params.map((p) => kn(m, p.k, p.k === 'root' ? accent : 'cy'))));
  }

  // ── petits dessins (SVG, couleurs par classes) ──
  const svg = (w, h, d) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', `0 0 ${w} ${h}`); s.setAttribute('preserveAspectRatio', 'none'); s.setAttribute('class', 'viz');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    s.append(p);
    return s;
  };
  function waveSvg(w) {
    const pts = [];
    for (let x = 0; x <= 120; x += 2) {
      const ph = (x / 120) * 4 * Math.PI;
      const y = w === 0 ? Math.sin(ph) : w === 1 ? (2 / Math.PI) * Math.asin(Math.sin(ph)) : w === 2 ? 2 * ((ph / (2 * Math.PI)) % 1) - 1 : Math.sign(Math.sin(ph));
      pts.push(`${x} ${(19 - y * 14).toFixed(1)}`);
    }
    return svg(120, 38, `M${pts.join(' L')}`);
  }
  function adsrSvg(m) {
    const a = Math.log(val(m, 'a') / 0.001) / Math.log(3000), d = Math.log(val(m, 'd') / 0.01) / Math.log(300);
    const s = val(m, 's'), r = Math.log(val(m, 'r') / 0.005) / Math.log(800);
    const x1 = 4 + a * 30, x2 = x1 + 6 + d * 30, x3 = 116 - 6 - r * 30, ys = 34 - s * 28;
    return svg(120, 38, `M4 34 L${x1.toFixed(1)} 6 L${x2.toFixed(1)} ${ys.toFixed(1)} L${x3.toFixed(1)} ${ys.toFixed(1)} L116 34`);
  }
  function filterSvg(m) {
    const c = 4 + Math.log(val(m, 'cut') / 40) / Math.log(400) * 100, q = val(m, 'res') / 24;
    return svg(120, 38, `M4 14 L${(c - 16).toFixed(1)} 14 Q${(c - 3).toFixed(1)} ${(14 - q * 12).toFixed(1)} ${c.toFixed(1)} ${(12 + q * 4).toFixed(1)} T116 34`);
  }
  function drawWave(cv, buf, start) {
    const w = cv.clientWidth || 300, h = cv.clientHeight || 46, dpr = devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const pk = peaks(buf, 1200);
    g.fillStyle = tok('cy');
    for (let x = 0; x < w; x++) {
      const v = pk[Math.floor(x / w * pk.length)], hh = Math.max(1, v * (h - 2));
      g.fillRect(x, (h - hh) / 2, 1, hh);
    }
    g.fillStyle = tok('or');
    g.fillRect(Math.round(start * w), 0, 2, h);
  }

  // ── l'éditeur de motifs ──
  function editor(t) {
    const P = S.proj;
    const pats = P.patterns.filter((p) => p.track === t.id);
    let p = app.pat(S.sel.pat);
    if (!p || p.track !== t.id) p = app.pat(t.pat) || pats[0];
    if (!p) return el('div', {});
    S.sel.pat = p.id; t.pat = p.id;
    const src = app.mod(t.src);
    const head = el('div', { class: 'pe-head' },
      el('span', { class: 'lbl' }, 'motifs'),
      el('div', { class: 'pe-pats' }, pats.map((x) => el('button', {
        class: `tb sm${x.id === p.id ? ' on' : ' ghost'}`, type: 'button', title: 'double-clic : renommer',
        onclick: () => { t.pat = x.id; S.sel.pat = x.id; app.commit('data'); },
        ondblclick: async () => { const n = await ask('Renommer le motif', 'Nom', x.name, 'Renommer'); if (n) { x.name = n.slice(0, 40); app.commit('data'); } },
      }, x.name))),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.newPattern(t.id) }, '+ Motif'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'une copie de ce motif', onclick: () => app.newPattern(t.id, p) }, 'Copier'),
      el('span', { class: 'sp' }),
      el('div', { class: 'seg' }, [16, 32, 64].map((n) => el('button', { class: `tb${p.steps === n ? ' on' : ''}`, type: 'button',
        onclick: () => { resize(p, n); app.commit('data'); } }, `${n} pas`))),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'répéter le motif sur une longueur double', disabled: p.steps * 2 > 64 || null,
        onclick: () => { double(p); app.commit('data'); } }, 'Doubler'),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { clear(p); app.commit('data'); } }, 'Effacer'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'poser ce motif en clip à la tête de lecture',
        onclick: () => { app.addClip(t.id, Math.floor(app.pos()), { pat: p.id }); toast('clip posé sur la timeline'); } }, 'Vers la timeline'));
    const body = t.kind === 'drums' ? stepGrid(p, src) : pianoRoll(p, src);
    return el('div', { class: 'pe' }, head, body,
      el('p', { class: 'lbl pe-hint' }, t.kind === 'drums'
        ? 'clic : poser ou ôter un coup · Alt+clic : coup léger · glisser : peindre · la colonne claire suit la lecture'
        : 'clic sur la grille : une note · glisser : sa longueur · glisser une note : la déplacer · clic sur une note : l\'ôter · clavier de l\'ordinateur : jouer'));
  }

  function resize(p, n) {
    if (p.lanes) for (const k of Object.keys(p.lanes)) p.lanes[k] = Array.from({ length: n }, (_, i) => p.lanes[k][i] || 0);
    if (p.notes) p.notes = p.notes.filter((x) => x.s < n).map((x) => ({ ...x, l: Math.min(x.l, n) }));
    p.steps = n;
  }
  function double(p) {
    const n = p.steps;
    if (p.lanes) for (const k of Object.keys(p.lanes)) p.lanes[k] = [...p.lanes[k], ...p.lanes[k]];
    if (p.notes) p.notes = [...p.notes, ...p.notes.map((x) => ({ ...x, s: x.s + n }))];
    p.steps = n * 2;
  }
  function clear(p) { if (p.lanes) p.lanes = {}; if (p.notes) p.notes = []; }

  let stepCells = null, curPat = null;
  function stepGrid(p, src) {
    curPat = p;
    stepCells = [];
    const g = el('div', { class: 'sq', style: { '--n': p.steps } });
    let paint = null;
    for (const v of DRUM_VOICES) {
      const lane = p.lanes[v.id] || Array(p.steps).fill(0);
      const row = el('div', { class: 'sq-row' },
        el('button', { class: 'sq-lab', type: 'button', title: 'écouter', onpointerdown: () => app.engine.hit(src.id, v.id, 1) },
          el('b', {}, v.short), el('span', {}, v.name)));
      const cells = el('div', { class: 'sq-cells' });
      for (let s = 0; s < p.steps; s++) {
        const c = el('span', { class: `sq-c${s % 4 === 0 ? ' b4' : ''}${lane[s] >= 0.75 ? ' on' : lane[s] > 0 ? ' soft' : ''}`, 'data-s': s });
        const set = (vel) => {
          if (!p.lanes[v.id]) p.lanes[v.id] = Array(p.steps).fill(0);
          p.lanes[v.id][s] = vel;
          c.classList.toggle('on', vel >= 0.75); c.classList.toggle('soft', vel > 0 && vel < 0.75);
        };
        c.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const cur = (p.lanes[v.id] || [])[s] || 0;
          const vel = cur ? 0 : e.altKey ? 0.5 : 1;
          paint = { lane: v.id, vel };
          set(vel);
          if (vel) app.engine.hit(src.id, v.id, vel);
          const up = () => { removeEventListener('pointerup', up); paint = null; if (!p.lanes[v.id].some(Boolean)) delete p.lanes[v.id]; app.commit('quiet'); };
          addEventListener('pointerup', up);
        });
        c.addEventListener('pointerenter', () => { if (paint && paint.lane === v.id) set(paint.vel); });
        cells.append(c);
      }
      stepCells.push(cells);
      row.append(cells);
      g.append(row);
    }
    // les cellules d'une voie peinte doivent recevoir pointerenter : pas de capture
    return g;
  }

  let roll = null, ro = null;
  function pianoRoll(p, src) {
    curPat = p;
    const LO = 24, HI = 96, RH = 14;
    const wrap = el('div', { class: 'pr' });
    const keys = el('div', { class: 'pr-keys' });
    const area = el('div', { class: 'pr-area' });
    const notes = el('div', { class: 'pr-notes' });
    const nowCol = el('i', { class: 'pr-now' });
    area.append(notes, nowCol);
    wrap.append(keys, area);
    for (let q = HI; q >= LO; q--) {
      keys.append(el('button', { class: `pr-k${isBlack(q) ? ' blk' : ''}${q % 12 === 0 ? ' c' : ''}`, type: 'button', style: { height: `${RH}px` },
        onpointerdown: () => app.engine.preview(src.id, q) }, q % 12 === 0 ? noteName(q) : ''));
    }
    area.style.height = `${(HI - LO + 1) * RH}px`;
    const cw = () => area.clientWidth / p.steps;
    const paintNotes = () => {
      const w = cw();
      area.style.setProperty('--cw', `${w}px`); area.style.setProperty('--rh', `${RH}px`);
      put(notes, ...p.notes.map((n, i) => el('div', { class: 'pr-n', 'data-i': i,
        style: { left: `${n.s * w}px`, top: `${(HI - n.p) * RH}px`, width: `${Math.max(3, n.l * w - 1)}px`, height: `${RH - 1}px` } },
      el('i', { class: 'rs' }))));
    };
    let lastLen = 1;
    area.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      area.setPointerCapture(e.pointerId);
      const r = area.getBoundingClientRect(), w = cw();
      const at = (ev) => ({ s: Math.floor((ev.clientX - r.left) / w), p: HI - Math.floor((ev.clientY - r.top) / RH) });
      const hitEl = e.target.closest('.pr-n');
      const a0 = at(e);
      let moved = false, n;
      if (hitEl) {
        n = p.notes[+hitEl.dataset.i];
        const resize = e.target.classList.contains('rs');
        const s0 = n.s, p0 = n.p, l0 = n.l;
        const mv = (ev) => {
          const a = at(ev);
          if (a.s !== a0.s || a.p !== a0.p) moved = true;
          if (resize) n.l = Math.max(1, Math.min(p.steps, l0 + a.s - a0.s));
          else {
            n.s = Math.max(0, Math.min(p.steps - 1, s0 + a.s - a0.s));
            const np = Math.max(LO, Math.min(HI, p0 + a.p - a0.p));
            if (np !== n.p) { n.p = np; app.engine.preview(src.id, np); }
          }
          paintNotes();
        };
        const up = () => {
          area.removeEventListener('pointermove', mv); area.removeEventListener('pointerup', up);
          if (!moved) p.notes.splice(p.notes.indexOf(n), 1);
          else lastLen = n.l;
          paintNotes(); app.commit('quiet');
        };
        area.addEventListener('pointermove', mv); area.addEventListener('pointerup', up);
        return;
      }
      if (a0.s < 0 || a0.s >= p.steps || a0.p < LO || a0.p > HI) return;
      n = { s: a0.s, l: Math.min(lastLen, p.steps), p: a0.p, v: 0.8 };
      p.notes.push(n);
      app.engine.preview(src.id, n.p);
      paintNotes();
      const mv = (ev) => { const a = at(ev); n.l = Math.max(1, Math.min(p.steps, a.s - n.s + 1)); paintNotes(); };
      const up = () => { area.removeEventListener('pointermove', mv); area.removeEventListener('pointerup', up); lastLen = n.l; app.commit('quiet'); };
      area.addEventListener('pointermove', mv); area.addEventListener('pointerup', up);
    });
    roll = { area, nowCol, p, cw };
    requestAnimationFrame(() => {
      paintNotes();
      const ps = p.notes.map((n) => n.p);
      const mid = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : 60;
      wrap.scrollTop = (HI - mid) * RH - wrap.clientHeight / 2;
    });
    if (ro) ro.disconnect();
    ro = new ResizeObserver(() => paintNotes());
    ro.observe(area);
    return wrap;
  }

  // ── l'ensemble ──
  function paintMain() {
    const P = S.proj;
    meters.length = 0;
    stepCells = null; roll = null; curPat = null;
    if (S.sel.track === BUS) {
      const mods = P.modules.filter((m) => !m.track);
      put(main,
        el('div', { class: 'rk-head' }, el('span', { class: 'k' }, 'bus'), el('b', { class: 'venus' }, 'Bus et sortie'),
          el('span', { class: 'lbl' }, 'les effets partagés et la sortie ; leurs câbles se tirent dans la vue Nodal'),
          el('span', { class: 'sp' }),
          el('button', { class: 'tb ghost sm', type: 'button', onclick: (e) => fxMenu(e, null) }, '+ Effet')),
        el('div', { class: 'rk-chain' }, mods.map((m) => device(m, null))));
      return;
    }
    const t = app.track(S.sel.track) || P.tracks[0];
    if (!t) { put(main, el('div', { class: 'tl-empty' }, el('b', {}, 'Aucune piste'), el('span', {}, '« + Piste » à gauche'))); return; }
    S.sel.track = t.id;
    const ch = app.chain(t.id);
    const loose = P.modules.filter((m) => m.track === t.id && !ch.includes(m));
    put(main,
      el('div', { class: 'rk-head', style: { '--c': `var(--${t.color})` } },
        el('span', { class: 'k' }, TRACK_KINDS[t.kind].label), el('b', { class: 'venus' }, t.name),
        el('span', { class: 'lbl' }, `${ch.length} module${ch.length > 1 ? 's' : ''} en chaîne`),
        el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: (e) => fxMenu(e, t.id) }, '+ Effet'),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.setView('nodal') }, 'Voir les câbles')),
      el('div', { class: 'rk-chain' }, ch.map((m, i) => [i ? el('i', { class: 'rk-arrow', 'aria-hidden': 'true' }, '→') : null, device(m, t)])),
      loose.length ? el('div', { class: 'rk-loose' }, el('span', { class: 'why' }, 'hors chaîne : ces modules de la piste ne sont pas sur le trajet source → tranche ; câble-les dans la vue Nodal'),
        el('div', { class: 'rk-chain' }, loose.map((m) => device(m, t)))) : null,
      TRACK_KINDS[t.kind].pattern ? editor(t) : el('p', { class: 'lbl pe-hint' }, 'une piste audio joue des clips de la bibliothèque : « + Son », ou « Générer » en haut'));
  }

  function fxMenu(e, trackId) {
    const r = e.currentTarget.getBoundingClientRect();
    menu(r.left, r.bottom + 4, EFFECT_TYPES.map((k) => ({ label: MODULES[k].name, sub: MODULES[k].kind, dot: MODULES[k].color,
      onclick: () => { const m = app.addEffect(trackId, k); if (!trackId) toast(`${MODULES[k].name} ajouté au bus : câble-le dans la vue Nodal`); return m; } })));
  }

  function render() { paintSide(); paintMain(); }

  function frame(beat) {
    for (const [id, mt] of meters) {
      const db = app.engine.level(id);
      mt.firstChild.style.width = `${Math.max(0, Math.min(100, (db + 60) / 60 * 100)).toFixed(1)}%`;
      mt.classList.toggle('hot', db > -1);
    }
    if (!curPat) return;
    // la colonne jouée : le clip de ce motif sous la tête de lecture
    let step = -1;
    if (app.engine.running) {
      const c = S.proj.clips.find((x) => x.pat === curPat.id && beat >= x.start && beat < x.start + x.len);
      if (c) {
        const plen = curPat.steps / 4;
        step = Math.floor((((beat - c.start + (c.off || 0)) % plen) + plen) % plen * 4);
      }
    }
    if (stepCells) {
      for (const cells of stepCells) {
        const prev = cells.querySelector('.now');
        if (prev && +prev.dataset.s !== step) prev.classList.remove('now');
        if (step >= 0) cells.children[step]?.classList.add('now');
      }
    }
    if (roll) {
      roll.nowCol.style.display = step >= 0 ? 'block' : 'none';
      if (step >= 0) roll.nowCol.style.transform = `translateX(${step * roll.cw()}px)`;
      roll.nowCol.style.width = `${roll.cw()}px`;
    }
  }

  function key(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel.mod) {
      const m = app.mod(S.sel.mod);
      if (m && MODULES[m.type].role === 'effect') { e.preventDefault(); app.removeModule(m.id); }
    }
  }

  function played(t) { if (t.kind === 'drums') { /* rien à montrer de plus */ } }

  document.addEventListener('mu:buffer', () => { if (S.view === 'rack') paintMain(); });

  return { el: root, render, frame, key, played };
}

export { fmt };
