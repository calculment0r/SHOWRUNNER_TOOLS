// ODIO — la vue de détail, en bas de l'arrangement : une seule colonne qui
// défile (29/09, plus d'onglets) — le clip choisi, puis la chaîne de la piste.
// Maj+Tab ou F12 passe de l'un à l'autre ; Ctrl+Alt+3 : le clip,
// Ctrl+Alt+4 : la chaîne (les raccourcis de Live 12, qui y changent d'onglet).
//   Clip         le clip choisi :
//     piano roll   notes, longueurs, vélocités (la voie du bas), grille et
//                  quantification, gamme de la session mise en évidence et
//                  aimant à la gamme, transposer, accent et liaison (la basse
//                  acide d'ODIO)
//     pas          le séquenceur de la batterie : une rangée par voix de la
//                  source (DR-9 : huit, boîte à rythme : onze), vélocité par pas
//     audio        la « Clip View » de Live pour un son : marqueurs de début
//                  et de fin, boucle (sa position et sa longueur), gain,
//                  transposition, inversion, fondus, calage au tempo
//   Instruments  la chaîne de la piste choisie (rack.js)
//   Génération   une région d'une piste générative : son modèle, sa tâche, ses
//                réglages dessinés depuis le schéma, ses prises
//                (generatif_region.js) ; « Son de la prise » : la vue Clip du son
// Le panneau défile à la verticale ; sa hauteur se tire (timeline.js).

import { toast } from '../commun/shell.js';
import { MODULES, TRACK_KINDS, DRUM_MODELS, NOTE_MODELS, drumVoicesOf, noteName, isBlack, inScale, snapToScale, keyLabel,
  MODES, TONICS } from './modules.js';
import { peaks, peakDb, clipBuffer, audioGeom } from './moteur.js';
import { el, knob, menu, tok, clamp, put, inlineEdit, letter } from './ui.js';
import { createDevices } from './rack.js';
// la molette : la règle commune de toutes les timelines du portail (29/09)
import { brancher, borne, tenirY } from '../commun/molette.js';
import { tete, poser } from '../commun/tete.js';   // LA tête de lecture du portail (30/09) : le piano roll, l'éditeur audio
// le génératif (29/09) : une région (un clip qui porte `gen`) s'ouvre sur sa
// génération ; sa prise choisie, sur la vue Clip d'un son
import { isRegion, isGenTrack, regionPanel, trackPanel } from './generatif_region.js';

const STEP_MAX = 256;

// ── la vue de détail : UNE colonne qui défile, sans onglets ─
// Demande de Cal (29/09) : « tout sans avoir d'onglet clip et instrument, on
// met tout avec un scroll ». De haut en bas : le clip choisi (ses notes, ses
// pas, son son — ou, pour une région générative, sa génération), puis la
// chaîne de la piste (l'instrument et ses effets, rack.js), le génératif
// étant l'éditeur du clip quand le clip est une région. « Instruments et
// effets » (menus, Maj+Tab, F12, Ctrl+Alt+3 / 4) fait défiler jusqu'à la
// partie voulue au lieu de changer d'onglet.
export function createDock(app) {
  const { S } = app;
  const root = el('section', { class: 'dk', 'aria-label': 'vue de détail' });
  const head = el('div', { class: 'dk-tabs dk-head' });
  const body = el('div', { class: 'dk-body' });
  root.append(head, body);
  const devices = createDevices(app);
  const clipSec = el('section', { class: 'dk-sec dk-sec-clip', 'data-part': 'clip', 'aria-label': 'le clip choisi' });
  const chainSec = el('section', { class: 'dk-sec dk-sec-chain', 'data-part': 'device', 'aria-label': 'la chaîne de la piste' });
  let ed = null;
  function target() {
    const c = app.clip(S.sel.clip);
    if (c) return { c, t: app.track(c.track) };
    const t = app.track(S.sel.track);
    if (t && (TRACK_KINDS[t.kind]?.pattern || isGenTrack(t))) return { c: null, t };
    return null;
  }
  const title = (label, what, ...extra) => el('div', { class: 'dk-title' }, el('span', { class: 'lbl' }, label), what ? el('span', { class: 'dk-what' }, what) : null, el('span', { class: 'sp' }), ...extra);
  function paintHead() {
    const t = app.track(S.sel.track), c = app.clip(S.sel.clip);
    put(head,
      t ? el('i', { class: 'dk-dot', style: { background: `var(--${t.color})` } }) : null,
      el('b', { class: 'venus dk-name' }, t ? t.name : 'aucune piste'),
      el('span', { class: 'lbl dk-what' }, c ? `clip · ${app.bar(c.start)} → ${app.bar(c.start + c.len)}` : '', t ? ` · ${app.chain(t.id).length} modules en chaîne` : ''),
      el('span', { class: 'sp' }),
      el('span', { class: 'lbl' }, 'le clip, puis la chaîne de la piste : faire défiler · tirer le filet du haut : la hauteur'));
  }
  function renderClip() {
    const tg = target();
    const c = tg?.c;
    // une région qui a une prise : la génération, ou le son de la prise (la vue Clip d'un son)
    const reg = c && isRegion(c) && c.item;
    const seg = reg ? el('div', { class: 'seg dk-gen' }, [['gen', 'Génération'], ['son', 'Son de la prise']].map(([k, l]) => el('button', { class: `tb${(S.proj.ui.genSon ? 'son' : 'gen') === k ? ' on' : ''}`, type: 'button',
      onclick: () => { S.proj.ui.genSon = k === 'son' || undefined; app.saveUi(); render(); } }, l))) : null;
    const host = el('div', { class: 'dk-clip' });
    put(clipSec, title(c && isRegion(c) && !(c.item && S.proj.ui.genSon) ? 'génératif · la région' : 'clip', tg?.t ? tg.t.name : '', seg), host);
    if (!tg || !tg.t) {
      ed = null;
      put(host, el('div', { class: 'dk-empty dk-empty-sm' },
        el('span', {}, 'choisis un clip : ses notes, ses pas ou son son s\'ouvrent ici · double-clic sur une piste vide : un clip neuf')));
      return;
    }
    if (tg.t.kind === 'audio' && tg.c && isRegion(tg.c) && !(tg.c.item && S.proj.ui.genSon)) { ed = regionPanel(app, host, tg.c, tg.t); return; }
    if (tg.t.kind === 'audio' && !tg.c && isGenTrack(tg.t)) { ed = trackPanel(app, host, tg.t); return; }
    ed = tg.t.kind === 'audio'
      ? (tg.c ? audioEditor(app, host, tg.c, tg.t) : (put(host, el('div', { class: 'dk-empty dk-empty-sm' }, el('span', {}, 'choisis un clip de cette piste audio'))), null))
      : patternEditor(app, host, tg.t, tg.c);
  }
  function render() {
    paintHead();
    document.body.classList.remove('mu-gen-dock');          // le panneau génératif le remet s'il s'ouvre
    const top = body.scrollTop;
    if (clipSec.parentNode !== body || chainSec.parentNode !== body) put(body, clipSec, chainSec);
    renderClip();
    if (chainSec.firstChild !== devices.el) put(chainSec, devices.el);
    devices.render();
    body.scrollTop = top;
    // « Instruments et effets », « Ouvrir dans la vue Clip » : on va à la partie voulue
    const jump = S.dockJump;
    if (jump) {
      S.dockJump = null;
      // aller au clip : un piano roll s'y centre sur ses notes (le haut de la partie serait do8)
      requestAnimationFrame(() => {
        if (jump !== 'device' && ed?.centrer) { ed.centrer(); return; }
        const sec = jump === 'device' ? chainSec : clipSec; body.scrollTop = Math.max(0, sec.offsetTop);
      });
    }
  }
  function key(e) { return ed?.key?.(e) || devices.key(e) || false; }
  // le clic droit dans le panneau du bas, là où rien n'a le sien
  function zoneMenu(e) {
    const t = app.track(S.sel.track), c = app.clip(S.sel.clip);
    const inChain = chainSec.contains(e.target);
    const dev = e.target.closest?.('.dev[data-mod]');
    if (dev) return devices.menuDe?.(dev.dataset.mod, t) || null;
    return [
      { head: inChain ? `la chaîne · ${t?.name || ''}` : `le clip · ${t?.name || ''}` },
      { label: 'Aller au clip', onclick: () => { S.dockJump = 'clip'; render(); } },
      { label: 'Aller à la chaîne de la piste', onclick: () => { S.dockJump = 'device'; render(); } },
      t ? { label: 'Un effet dans la chaîne', items: devices.fxItems(t.id) } : null,
      c ? { label: 'Retirer le clip', danger: true, onclick: () => app.removeSel((S.sel.clips || []).includes(c.id) ? null : [c.id]) } : null,   // le clip ouvert en bas, choisi ou non (un clic dans son corps)
      '-',
      { label: 'Cacher le panneau du bas', onclick: () => { S.proj.ui.dock = false; app.saveUi(); app.renderView(); } },
    ];
  }
  return { el: root, render, frame: (b) => { devices.frame(b); ed?.frame?.(b); }, key, zoneMenu };
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
    el('div', { class: 'pe-pats' }, pats.map((x) => {
      const b = el('button', {
        class: `tb sm${x.id === pat.id ? ' on' : ' ghost'}`, type: 'button', title: c ? 'le motif que ce clip joue · double-clic : renommer' : 'double-clic : renommer',
        onclick: () => { if (!b.classList.contains('editing') && x.id !== pat.id) setPat(x.id); },
        ondblclick: () => inlineEdit(b, x.name, (n) => { x.name = n.slice(0, 40); app.commit('data'); }, { max: 40 }),
      }, x.name);
      return b;
    })),
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
const CENTRE = new WeakMap();   // ce qui défile → le motif sur lequel on l'a centré
function pianoRoll(app, p, src, t, c, ui, tall) {
  const P = app.S.proj;
  // la hauteur d'une rangée (une note) : Ctrl+molette (commun/molette.js), gardée dans ui (P.ui.ed.rh)
  const LO = 24, HI = 108, RH0 = tall ? 14 : 12, RH_MIN = 8, RH_MAX = 36;
  let RH = borne(ui.rh || RH0, RH_MIN, RH_MAX);
  const zx = () => borne(ui.zx || 1, 1, 16);          // le zoom du temps : 1 = le motif tient dans la largeur
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
  const nowPh = tete({ z: 3 });            // la tête, à l'endroit exact ; la colonne jouée reste dessous
  nowPh.style.display = 'none';
  const box = el('i', { class: 'pr-box' });
  const velLane = el('div', { class: 'pr-vel', title: 'vélocité : glisser une barre' });
  const velScroll = el('div', { class: 'pr-vsx' }, velLane);
  // la voie des vélocités reste sous la grille, hors du défilement vertical
  const velBox = el('div', { class: 'pr-velbox' }, el('span', { class: 'lbl' }, 'vél.'), velScroll);
  area.append(rows, notes, nowCol, box, nowPh);
  scrollX.append(area);
  wrap.append(keys, scrollX);
  scrollX.addEventListener('scroll', () => { velScroll.scrollLeft = scrollX.scrollLeft; });
  for (let q = HI; q >= LO; q--) {
    const inS = inScale(P.key, q), root = ((q - P.key.tonic) % 12 + 12) % 12 === 0;
    keys.append(el('button', { class: `pr-k${isBlack(q) ? ' blk' : ''}${q % 12 === 0 ? ' c' : ''}${inS ? ' in' : ''}${root ? ' root' : ''}`, type: 'button',
      onpointerdown: () => app.engine.preview(src.id, q) }, q % 12 === 0 || root ? noteName(q) : ''));
    rows.append(el('i', { class: `${inS ? 'in' : 'out'}${root ? ' root' : ''}` }));
  }
  // les rangées à la hauteur RH (au départ, et à chaque Ctrl+molette)
  const layoutRows = () => {
    [...keys.children].forEach((k) => { k.style.height = `${RH}px`; });
    [...rows.children].forEach((r, i) => { r.style.top = `${i * RH}px`; r.style.height = `${RH}px`; });
    area.style.height = `${(HI - LO + 1) * RH}px`;
  };
  layoutRows();
  let cw = 14;
  const layout = () => {
    const avail = Math.max(200, scrollX.clientWidth - 2);
    cw = Math.max(avail / p.steps, 9) * zx();
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
    el('button', { class: 'tb ghost sm', type: 'button', title: 'ramener les débuts de notes sur la grille (les notes choisies, sinon toutes) · Ctrl+U', onclick: () => quantize(gridS()) }, 'Quantifier'),
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
  // la molette : la règle commune (commun/molette.js) — seule : monter / descendre
  // dans les notes ; Maj : le temps ; Alt : zoom du temps sous le curseur ;
  // Ctrl : la hauteur des rangées — toutes, même sur le clavier de gauche (une
  // touche n'est pas une piste : une rangée seule plus haute fausserait la gamme)
  brancher(wrap, {
    scroller: scrollX,
    zoom: (f, cx) => {
      const r = scrollX.getBoundingClientRect(), x = cx - r.left, s = (scrollX.scrollLeft + x) / cw;
      ui.zx = Math.round(borne(zx() * f, 1, 16) * 1000) / 1000; app.saveUi();
      layout(); paintNotes();
      scrollX.scrollLeft = s * cw - x;
    },
    // ce qui défile en hauteur : le piano roll lui-même (grand format), sinon la colonne du panneau du bas
    hauteur: (f, _piste, e) => tenirY(wrap.scrollHeight > wrap.clientHeight + 1 ? wrap : (wrap.closest('.dk-body') || wrap), e.clientY, () => {
      RH = Math.round(borne(RH * f, RH_MIN, RH_MAX) * 10) / 10; ui.rh = RH; app.saveUi();
      layoutRows(); layout(); paintNotes();
    }),
  });
  const ro = new ResizeObserver(() => { layout(); paintNotes(); });
  // Centrer sur les notes CE QUI DÉFILE : le piano roll lui-même en grand
  // format, sinon la colonne du panneau du bas (.dk-body) — la même règle que
  // la molette (hauteur, plus haut). La rangée du milieu des notes (ou do4)
  // vient au milieu de sa fenêtre. Dans la colonne, seulement quand le motif
  // change : le panneau se redessine à chaque retouche, il garde alors le
  // défilement qu'on lui a donné.
  const defile = () => (wrap.scrollHeight > wrap.clientHeight + 1 ? wrap : wrap.closest('.dk-body'));
  const centrer = () => {
    const sc = defile();
    if (!sc) return;
    const ps = p.notes.map((n) => n.p);
    const mid = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : 60;
    const y = (HI - mid + 0.5) * RH;                  // dans la grille (.pr-area)
    const top = area.getBoundingClientRect().top - sc.getBoundingClientRect().top;   // la grille dans la fenêtre de ce qui défile
    sc.scrollTop += top + y - sc.clientHeight / 2;
    CENTRE.set(sc, p.id);
  };
  requestAnimationFrame(() => {
    layout(); paintNotes();
    const sc = defile();
    if (sc === wrap || (sc && CENTRE.get(sc) !== p.id)) centrer();
    ro.observe(scrollX);
  });
  return {
    centrer,
    el: el('div', { class: 'pr-wrap', style: { '--k': `var(--${t.color})` } }, tools, wrap, velBox),
    hint: 'clic : une note · glisser : sa longueur · glisser une note : la déplacer · Maj+glisser : choisir · double-clic ou clic droit : l\'ôter · ↑ ↓ transposer · Ctrl+A tout · Suppr · Ctrl+U quantifier · la voie du bas : vélocités · molette : monter, descendre · Maj : le temps · Alt : zoom · Ctrl : hauteur des notes',
    frame() {
      const st = playingStep(app, p, c);
      nowCol.style.display = st >= 0 ? 'block' : 'none';
      if (st >= 0) nowCol.style.transform = `translateX(${Math.floor(st) * cw}px)`;
      nowCol.style.width = `${cw}px`;
      nowPh.style.display = st >= 0 ? '' : 'none';
      if (st >= 0) poser(nowPh, st * cw);
    },
    key(e) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.target.closest?.('input, textarea, select')) return false;
      if ((e.key === 'Delete' || e.key === 'Backspace') && chosen.size) { e.preventDefault(); p.notes = p.notes.filter((n) => !chosen.has(n)); chosen.clear(); commit(); return true; }
      if (ctrl && letter(e) === 'a') { e.preventDefault(); for (const n of p.notes) chosen.add(n); paintNotes(); return true; }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && chosen.size) { e.preventDefault(); transpose((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1)); return true; }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && chosen.size) {
        e.preventDefault();
        const d = (e.key === 'ArrowLeft' ? -1 : 1) * gridS();
        if ([...chosen].every((n) => n.s + d >= 0 && n.s + d + n.l <= p.steps)) { for (const n of chosen) n.s += d; commit(); }
        return true;
      }
      if (ctrl && letter(e) === 'd' && chosen.size) {
        e.preventDefault();
        const g = [...chosen], a = Math.min(...g.map((n) => n.s)), b = Math.max(...g.map((n) => n.s + n.l));
        chosen.clear();
        for (const n of g) if (n.s + (b - a) < p.steps) { const m = { ...n, s: n.s + (b - a) }; p.notes.push(m); chosen.add(m); }
        commit(); return true;
      }
      // Ctrl+U : « Quantize » de Live 12 ; Q, l'ancien raccourci d'ODIO, reste
      if ((ctrl && letter(e) === 'u') || (letter(e) === 'q' && !ctrl)) { e.preventDefault(); quantize(gridS()); return true; }
      return false;
    },
  };
}

// ── le clip audio (la « Clip View » de Live pour un son) ────
// Ce que le manuel de Live 12 range dans les boîtes Clip et Sample, réduit
// à ce que le moteur tient (moteur.js, audioGeom) :
//   début, fin   les marqueurs dans le son (fanions en haut de l'onde) ; le
//                clip dans l'arrangement lit de l'un à l'autre
//   boucle       l'accolade au-dessus de l'onde : sa position et sa longueur
//                dans le son ; le clip part du marqueur de début, puis
//                tourne dans l'accolade aussi longtemps qu'on le tire
//   gain, transposition (demi-tons et cents), inversion, fondus
//   caler        le calage au tempo : la région jouée dure N mesures. C'est
//                le mode « Re-Pitch » de Live : la vitesse change, la hauteur
//                suit (AudioBufferSourceNode.playbackRate, MDN). Un étirement
//                qui garde la hauteur demanderait un algorithme de plus
//                (vocodeur de phase, WSOLA) dans un AudioWorklet : pas fait.
// L'onde, avec la molette commune (commun/molette.js) : Alt+molette zoome
// autour du curseur, Maj+molette (ou glisser) la fait défiler, double-clic :
// tout le son. Seule, la molette fait défiler le panneau (une seule voie :
// rien à défiler en hauteur) ; Ctrl+molette n'a pas de hauteur à changer ici
// (et ne zoome pas la page). Avant le 29/09 : Ctrl zoomait, la molette seule
// défilait l'onde.
function audioEditor(app, host, c, t) {
  const P = app.S.proj;
  const spb = () => 60 / P.bpm;
  const cv = el('canvas', { class: 'ae-wave' });
  const now = tete({ z: 3 });              // LA tête de lecture (commun/tete.js), sur l'onde
  now.style.display = 'none';
  const info = el('span', { class: 'lbl ae-info' }, '…');
  const title = el('span', { class: 'sn' }, '…');
  const cname = el('b', { class: 'venus ae-name', title: 'double-clic : renommer le clip' }, c.name || 'clip');
  cname.addEventListener('dblclick', () => inlineEdit(cname, c.name || '', (n) => { c.name = n.slice(0, 60); app.commit('data'); }, { max: 60 }));
  app.loadItem(c.item).then((it) => { title.textContent = it.title; if (!c.name) cname.textContent = it.title; }).catch(() => { title.textContent = 'son introuvable'; });
  let view = null;                          // [v0, v1] : la part du son montrée, en secondes
  const src = () => app.engine.buffers.get(c.item);
  const buf = () => clipBuffer(src(), c);
  const D = () => src()?.duration || 1;
  const G = () => audioGeom(c, D());
  const endSec = () => Math.min(D(), (c.off || 0) + c.len * spb() * G().rate);
  const region = () => (c.loop ? [G().ls, G().ls + G().llen] : [c.off || 0, endSec()]);
  const BR = 16;                            // la bande de l'accolade, en haut
  const xOf = (s, w) => ((s - view[0]) / (view[1] - view[0])) * w;
  const sOf = (x, w) => view[0] + (x / w) * (view[1] - view[0]);

  let vw = 0;                               // la largeur peinte : frame() la relit sans forcer de mise en page
  function draw() {
    const b0 = src();
    const w = cv.clientWidth || 600, h = cv.clientHeight || 150, dpr = devicePixelRatio || 1;
    vw = w;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!b0) { app.engine.buffer(c.item).then(draw).catch(() => {}); return; }
    const bf = buf(), Dd = bf.duration;
    if (!view) view = [0, Dd];
    const pk = peaks(bf, 6000);
    const [ra, rb] = region(), off = c.off || 0, gm = G();
    const wy = BR + 4, wh = h - wy - 4;
    // la région qui joue
    g.fillStyle = tok('cy-bg'); g.fillRect(xOf(ra, w), wy, Math.max(1, xOf(rb, w) - xOf(ra, w)), wh);
    const gain = Math.pow(10, (c.gain || 0) / 20);
    for (let x = 0; x < w; x++) {
      const s = sOf(x, w);
      if (s < 0 || s >= Dd) continue;
      const i0 = Math.floor((s / Dd) * pk.length), i1 = Math.max(i0 + 1, Math.floor((sOf(x + 1, w) / Dd) * pk.length));
      let v = 0;
      for (let i = i0; i < Math.min(i1, pk.length); i++) v = Math.max(v, pk[i]);
      const hh = Math.max(1, Math.min(1, v * gain) * (wh - 2));
      const inside = c.loop ? (s >= Math.min(off, ra) && s < rb) : (s >= ra && s < rb);
      g.fillStyle = inside ? tok(t.color) : tok('ink3');
      g.fillRect(x, wy + (wh - hh) / 2, 1, hh);
    }
    // les fondus, depuis le début du clip et avant sa fin
    const L = c.len * spb();
    g.strokeStyle = tok('ink2'); g.lineWidth = 1;
    if (c.fi) { g.beginPath(); g.moveTo(xOf(off, w), wy + wh); g.lineTo(xOf(off + c.fi * gm.rate, w), wy); g.stroke(); }
    if (c.fo && !c.loop) { const e = off + L * gm.rate; g.beginPath(); g.moveTo(xOf(e - c.fo * gm.rate, w), wy); g.lineTo(xOf(e, w), wy + wh); g.stroke(); }
    // la bande de l'accolade
    g.fillStyle = tok('panel3'); g.fillRect(0, 0, w, BR);
    if (c.loop) {
      g.fillStyle = tok('line-cy'); g.fillRect(xOf(ra, w), 2, Math.max(2, xOf(rb, w) - xOf(ra, w)), BR - 4);
      g.fillStyle = tok('cy'); g.fillRect(xOf(ra, w), 0, 2, BR); g.fillRect(xOf(rb, w) - 2, 0, 2, BR);
      g.fillStyle = tok('on-cy'); g.font = `9px ${tok('f-mono') || 'monospace'}`;
      g.fillText('BOUCLE', xOf(ra, w) + 6, BR - 5);
    }
    // les marqueurs : début (toujours), fin (sans boucle)
    const flag = (s, label, right) => {
      const x = xOf(s, w);
      g.fillStyle = tok('ink'); g.fillRect(x - (right ? 1 : 0), wy, 1.5, wh);
      g.beginPath();
      if (right) { g.moveTo(x, wy); g.lineTo(x - 9, wy); g.lineTo(x, wy + 9); } else { g.moveTo(x, wy); g.lineTo(x + 9, wy); g.lineTo(x, wy + 9); }
      g.fill();
      g.font = `9px ${tok('f-mono') || 'monospace'}`; g.fillStyle = tok('ink2');
      g.fillText(label, right ? x - 9 - g.measureText(label).width - 2 : x + 11, wy + 9);
    };
    flag(off, 'DÉBUT', false);
    if (!c.loop) flag(rb, 'FIN', true);
    const pkDb = peakDb(bf, ra, rb);
    info.textContent = `son ${Dd.toFixed(2)} s · ${bf.sampleRate / 1000} kHz · début ${off.toFixed(3)} s · ${c.loop ? `boucle ${ra.toFixed(3)} → ${rb.toFixed(3)} s` : `fin ${rb.toFixed(3)} s`} · vitesse ×${gm.rate.toFixed(3)} · crête ${isFinite(pkDb) ? pkDb.toFixed(1) : '−∞'} dBFS`;
  }

  // les gestes sur l'onde : fanions, accolade, défilement
  cv.addEventListener('pointerdown', (e) => {
    if (!src() || e.button !== 0) return;
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    const r = cv.getBoundingClientRect(), w = r.width;
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const off0 = c.off || 0, [ra, rb] = region(), gm = G(), Dd = D();
    const near = (s) => Math.abs(xOf(s, w) - x) < 7;
    let what = null;
    if (y < BR && c.loop) what = near(ra) ? 'ls' : near(rb) ? 'le' : (x > xOf(ra, w) && x < xOf(rb, w)) ? 'lmove' : null;
    if (!what && y >= BR) what = near(off0) ? 'start' : (!c.loop && near(rb)) ? 'end' : 'pan';
    if (!what) return;
    const s0 = sOf(x, w), v0 = [...view], ls0 = gm.ls, llen0 = gm.llen, end0 = rb;
    const mv = (ev) => {
      const s = clamp(sOf(ev.clientX - r.left, w), 0, Dd);
      if (what === 'pan') { const d = (ev.clientX - r.left - x) / w * (v0[1] - v0[0]); const a = clamp(v0[0] - d, 0, Math.max(0, Dd - (v0[1] - v0[0]))); view = [a, a + (v0[1] - v0[0])]; }
      else if (what === 'start') {
        c.off = clamp(s, 0, Dd - 0.01);
        if (!c.loop) { c.off = Math.min(c.off, end0 - 0.01); c.len = Math.max(0.0625, (end0 - c.off) / (gm.rate * spb())); }
      } else if (what === 'end') c.len = Math.max(0.0625, (Math.max(s, off0 + 0.01) - off0) / (gm.rate * spb()));
      else if (what === 'ls') { const e2 = ls0 + llen0; c.ls = clamp(s, 0, e2 - 0.02); c.llen = e2 - c.ls; }
      else if (what === 'le') c.llen = clamp(s - ls0, 0.02, Dd - ls0);
      else if (what === 'lmove') c.ls = clamp(ls0 + (s - s0), 0, Dd - llen0);
      draw();
      if (what !== 'pan') paintNums();
    };
    const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); if (what !== 'pan') app.commit('data'); };
    cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
  });
  cv.addEventListener('pointermove', (e) => {
    if (e.buttons || !src() || !view) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, w = r.width;
    const [ra, rb] = region(), near = (s) => Math.abs(xOf(s, w) - x) < 7;
    cv.style.cursor = (y < BR && c.loop && (near(ra) || near(rb))) || (y >= BR && (near(c.off || 0) || (!c.loop && near(rb)))) ? 'ew-resize'
      : y < BR && c.loop ? 'grab' : 'default';
  });
  brancher(cv, {
    zoom: (f, cx) => {
      if (!view) return;
      const r = cv.getBoundingClientRect(), w = r.width, Dd = D(), span = view[1] - view[0];
      const s = sOf(cx - r.left, w), ns = clamp(span / f, 0.05, Dd);
      const a = clamp(s - (s - view[0]) * (ns / span), 0, Math.max(0, Dd - ns));
      view = [a, a + ns];
      draw();
    },
    defilerX: (px) => {
      if (!view) return;
      const w = cv.getBoundingClientRect().width || 1, Dd = D(), span = view[1] - view[0];
      const a = clamp(view[0] + (px / w) * span, 0, Math.max(0, Dd - span));
      view = [a, a + span];
      draw();
    },
  });
  cv.addEventListener('dblclick', () => { view = [0, D()]; draw(); });

  // ── les réglages ──
  const nums = el('div', { class: 'ae-nums' });
  function paintNums() {
    const gm = G(), [ra, rb] = region();
    put(nums,
      el('span', {}, el('i', {}, 'dans l\'arrangement'), el('b', {}, `${app.bar(c.start)} → ${app.bar(c.start + c.len)}`)),
      el('span', {}, el('i', {}, 'longueur'), el('b', {}, `${(c.len / P.sig).toFixed(2)} mes.`)),
      el('span', {}, el('i', {}, 'début'), el('b', {}, `${(c.off || 0).toFixed(3)} s`)),
      c.loop ? el('span', {}, el('i', {}, 'boucle'), el('b', {}, `${ra.toFixed(3)} s · ${gm.llen.toFixed(3)} s`))
        : el('span', {}, el('i', {}, 'fin'), el('b', {}, `${rb.toFixed(3)} s`)));
  }
  const pitchSt = () => Math.round(c.pitch || 0), pitchCt = () => Math.round(((c.pitch || 0) - pitchSt()) * 100);
  // transposer garde la région du son : sans boucle, le clip s'allonge ou
  // raccourcit dans l'arrangement (comme un clip non calé de Live)
  const setPitch = (p) => {
    const gm = G(), reg = c.len * spb() * gm.rate;
    c.pitch = clamp(Math.round(p * 100) / 100, -48, 48) || undefined;
    if (!c.loop) c.len = Math.max(0.0625, reg / (spb() * G().rate));
    draw(); paintNums();
  };
  const kSt = knob({ k: 'st', label: 'Transpo', min: -24, max: 24, def: 0, unit: 'dt', step: 1 }, pitchSt(), { accent: t.color,
    onInput: (v) => setPitch(v + pitchCt() / 100), onChange: () => app.commit('data') });
  const kCt = knob({ k: 'ct', label: 'Désaccord', min: -50, max: 50, def: 0, unit: 'ct', step: 1 }, pitchCt(), { accent: t.color,
    onInput: (v) => setPitch(pitchSt() + v / 100), onChange: () => app.commit('data') });
  const K = (label, k, min, max, def, unit) => knob({ k, label, min, max, def, unit, step: 0 }, c[k] ?? def, { accent: t.color,
    onInput: (v) => { c[k] = Math.round(v * 1000) / 1000 || undefined; draw(); }, onChange: () => app.commit('data') });
  const normalize = () => {
    const b = buf();
    if (!b) return;
    const [ra, rb] = region(), pk = peakDb(b, ra, rb);
    if (!isFinite(pk)) { toast('le clip est silencieux'); return; }
    c.gain = Math.round((-1 - pk) * 10) / 10;
    toast(`gain ${c.gain > 0 ? '+' : ''}${c.gain} dB : la crête du clip à −1 dBFS`);
    app.commit('data');
  };
  // caler au tempo : la région jouée (sans boucle, du début à la fin ; en
  // boucle, l'accolade) dure N mesures de la session
  const regSec = () => { const [ra, rb] = region(); return rb - ra; };
  // ce que la région dure aujourd'hui, en mesures (le son lu à sa vitesse), arrondi à une puissance de deux
  const guessBars = () => { const n = regSec() / G().rate / (P.sig * spb()); return Math.max(1, Math.pow(2, Math.round(Math.log2(Math.max(0.5, n))))); };
  let bars = guessBars();
  const barsSel = el('select', { class: 'fld mu-mini', 'aria-label': 'mesures', onchange: (e) => { bars = +e.target.value; } },
    [1, 2, 4, 8, 16, 32, 64].map((n) => el('option', { value: n, selected: n === bars || null }, `${n} mes.`)));
  const fit = () => {
    const reg = regSec();
    const rate = reg / (bars * P.sig * spb());
    const p = 12 * Math.log2(rate);
    if (!(Math.abs(p) <= 48)) { toast(`caler sur ${bars} mesures demanderait ${p.toFixed(1)} demi-tons : au-delà de ±48`); return; }
    c.pitch = Math.round(p * 100) / 100 || undefined;
    if (!c.loop) c.len = bars * P.sig;
    toast(`calé : ${reg.toFixed(2)} s de son = ${bars} mesure${bars > 1 ? 's' : ''} à ${P.bpm} bpm · vitesse ×${rate.toFixed(3)} (${p > 0 ? '+' : ''}${p.toFixed(2)} demi-tons, la hauteur suit : Re-Pitch)`, 6000);
    app.commit('data');
  };
  const tog = (label, on, title, fn) => el('button', { class: `tb sm${on ? ' on' : ' ghost'}`, type: 'button', title, onclick: fn }, label);
  paintNums();
  put(host, el('div', { class: 'ae', style: { '--k': `var(--${t.color})` } },
    el('div', { class: 'ae-side' },
      el('div', { class: 'ae-box' }, el('span', { class: 'lbl' }, 'clip'), cname, title,
        el('div', { class: 'row' },
          tog(c.mute ? 'Désactivé' : 'Actif', !c.mute, 'activer ou désactiver le clip · 0', () => { c.mute = !c.mute || undefined; app.commit('data'); }),
          el('button', { class: 'tb ghost sm', type: 'button', title: 'à la tête de lecture · Ctrl+E', onclick: () => app.splitAtPlayhead() }, 'Couper'),
          el('button', { class: 'tb ghost sm', type: 'button', title: 'voix, batterie, basse, autre : chacun sur sa piste, alignés', onclick: () => app.stems(c.id) }, 'Séparer'))),
      el('div', { class: 'ae-box' }, el('span', { class: 'lbl' }, 'son'),
        el('div', { class: 'kns' }, K('Gain', 'gain', -24, 12, 0, 'dB'), kSt, kCt),
        el('div', { class: 'row' },
          tog('Inverser', !!c.rev, 'lire le son à l\'envers · R', () => app.reverseSel([c.id])),
          el('button', { class: 'tb ghost sm', type: 'button', title: 'la crête de la région jouée à −1 dBFS', onclick: normalize }, 'Normaliser'))),
      el('div', { class: 'ae-box' }, el('span', { class: 'lbl' }, 'tempo · re-pitch'),
        el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'la région dure'), barsSel,
          el('button', { class: 'tb ghost sm', type: 'button', title: 'régler la vitesse pour que la région jouée dure ces mesures ; la hauteur suit la vitesse (Re-Pitch) : l\'étirement qui garde la hauteur n\'est pas fait', onclick: fit }, 'Caler'))),
      el('div', { class: 'ae-box' }, el('span', { class: 'lbl' }, 'boucle · fondus'),
        el('div', { class: 'row' }, tog(c.loop ? 'Boucle' : 'Sans boucle', !!c.loop, 'le son tourne dans l\'accolade ; tirer le bord droit du clip le répète', () => app.toggleLoop(c.id))),
        el('div', { class: 'kns' }, K('Entrée', 'fi', 0, 10, 0, 's'), K('Sortie', 'fo', 0, 10, 0, 's')))),
    el('div', { class: 'ae-w' }, el('div', { class: 'ae-cv' }, cv, now), nums, info,
      el('p', { class: 'lbl pe-hint' }, 'fanions DÉBUT et FIN : où le clip commence et finit dans le son · la bande du haut : l\'accolade de la boucle (bords : sa longueur ; milieu : sa place) · Alt+molette : zoomer · Maj+molette ou glisser : défiler · double-clic : tout le son'))));
  requestAnimationFrame(draw);
  const ro = new ResizeObserver(() => draw());
  requestAnimationFrame(() => ro.observe(cv));
  return {
    frame(beat) {
      if (!view || !src() || beat < c.start || beat >= c.start + c.len || !app.engine.running) { now.style.display = 'none'; return; }
      const gm = G(), into = (beat - c.start) * spb();
      let pos = gm.off + into * gm.rate;
      if (gm.loop && pos >= gm.ls + gm.llen) pos = gm.ls + ((pos - gm.ls) % gm.llen);
      const w = vw || cv.clientWidth;   // relue au dessin (ResizeObserver) : rien à mesurer à chaque image
      now.style.display = '';
      poser(now, xOf(pos, w));
    },
    key() { return false; },
  };
}
