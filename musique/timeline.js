// ODIO — l'arrangement (la vue principale du studio).
//
//   la règle     sections (ajouter, nommer, déplacer avec leurs clips,
//                colorer, dupliquer), mesures, boucle, marqueurs, tête de
//                lecture (clic = aller là ; glisser vers le haut ou le bas =
//                zoomer, comme la règle des temps de Live)
//   l'arc        une piste qu'on peint à la souris : elle pilote la sortie
//                (filtre, volume ou les deux) — et plus bas, sous chaque
//                piste, ses voies d'automation, une par réglage
//   les pistes   muet, solo, armer, volume, panoramique, couleur ; clips de
//                motifs (leurs notes dessinées) et clips audio (leur forme
//                d'onde) ; aimant, sélection multiple, copier / coller,
//                dupliquer, couper, consolider, rogner par les deux bords
//                (la poignée de gauche rogne le DÉBUT, le contenu reste calé
//                dans le temps), boucler, désactiver
//   en bas       la vue de détail, comme celle de Live : le clip choisi (Clip)
//                ou les instruments et effets de la piste (Instrument) ;
//                Maj+Tab bascule ; le séparateur se tire, sa hauteur reste
//   à gauche     le navigateur, en accordéon, repliable ; sa largeur se tire
//
// Gestes et raccourcis : ceux de Live 12 (manuel de référence, chapitres
// « Live Keyboard Shortcuts » et « Arrangement View », ableton.com/en/manual,
// relevés le 29/09/2026) — le détail dans guide.js.

import { toast, api, ITEM_MIME } from '../commun/shell.js';
import { MODULES, TRACK_KINDS, COLORS, COLOR_FR, AUTOMATABLE, SECTION_TAGS, SECTION_NAMES, SOURCES_OF,
  spec, val, fmt, toNorm, fromNorm, drumVoicesOf, guessTag, moduleName } from './modules.js';
import { peaks, projEnd, interp, clipBuffer, audioGeom } from './moteur.js';
import { el, knob, menu, tok, clamp, put, confirmBox, inlineEdit, splitter } from './ui.js';
import { sectionAt, duplicateSection, moveSection, swapSection, removeSection, trimStart } from './projet.js';
import { createDock } from './editeurs.js';
import { createBrowser } from './navigateur.js';

const HEAD_W = 224;
const SEC_H = 22, BAR_H = 30, RULER_H = SEC_H + BAR_H, ARC_H = 58, AUTO_H = 46;
const AUDIO_EXT = /\.(wav|mp3|flac|m4a|ogg|oga|aac)$/i;
export const SNAPS = [[0, 'libre'], [0.25, '1/16'], [0.5, '1/8'], [1, '1/4'], [2, '1/2'], ['bar', 'mesure']];

export function createTimeline(app) {
  const { S } = app;
  const P = () => S.proj;
  const ui = () => S.proj.ui;
  const ppb = () => ui().ppb || 83 / 4;                 // pixels par noire
  const th = () => ui().th || 88;                       // hauteur d'une piste
  const snapU = () => { const s = ui().snap ?? 1; return s === 'bar' ? P().sig : s; };
  const navW = () => (ui().nav === false ? 30 : clamp(ui().navW || 214, 160, 420));
  const dockH = () => (ui().dock === false ? 0 : clamp(ui().dockH || 300, 120, Math.max(160, innerHeight - 300)));
  const root = el('section', { class: 'ar', 'aria-label': 'arrangement' });
  const tools = el('div', { class: 'ar-tools' });
  const scroll = el('div', { class: 'ar-scroll' });
  const grid = el('div', { class: 'ar-grid' });
  const ph = el('div', { class: 'ar-ph' });
  const zone = el('div', { class: 'ar-zone' });
  const recBox = el('div', { class: 'ar-rec' }, el('span', {}, 'prise'));
  const marquee = el('div', { class: 'ar-marquee' });
  const dropLine = el('div', { class: 'ar-dropline' });
  scroll.append(grid);
  const browser = createBrowser(app);
  const dock = createDock(app);
  // les deux séparateurs : la largeur du navigateur, la hauteur du bas
  const navSplit = splitter('x', { get: navW, min: 160, max: 420, reset: 214, title: 'tirer : la largeur du navigateur · double-clic : d\'origine',
    set: (v) => { body.style.setProperty('--nav-w', `${v}px`); }, done: (v) => { ui().navW = v; ui().nav = true; app.saveUi(); } });
  const dockSplit = splitter('y', { get: dockH, min: 120, max: 900, invert: true, reset: 300, title: 'tirer : la hauteur du détail · double-clic : d\'origine',
    set: (v) => { dock.el.style.height = `${v}px`; }, done: (v) => { ui().dockH = v; ui().dock = true; app.saveUi(); } });
  const main = el('div', { class: 'ar-main' }, scroll, dockSplit, dock.el);
  const body = el('div', { class: 'ar-body' }, browser.el, navSplit, main);
  root.append(tools, body);

  const X = (b) => b * ppb();
  const beatAt = (clientX) => (clientX - grid.getBoundingClientRect().left - HEAD_W) / ppb();
  const snapB = (b, e) => { const u = e?.altKey ? 0 : snapU(); return u ? Math.round(b / u) * u : b; };
  const width = () => (Math.max(projEnd(P()), P().loop.b, 16 * P().sig) + 8 * P().sig) * ppb();
  const sel = () => new Set(S.sel.clips || []);
  const visTracks = () => P().tracks.filter((t) => t.kind !== 'bus');
  const lanesOf = (t) => (ui().auto?.[t.id] ? (P().auto || []).filter((L) => app.mod(L.mod)?.track === t.id) : []);

  // ── la barre d'outils ──
  function paintTools() {
    const c = app.clip(S.sel.clip);
    const t = c && app.track(c.track);
    const n = (S.sel.clips || []).length;
    const pos = app.pos();
    const inside = c && pos > c.start && pos < c.start + c.len;
    const btn = (label, on, why, fn, title = '') => el('button', { class: 'tb ghost sm', type: 'button', disabled: !on || null,
      title: on ? title : why, onclick: fn }, label);
    const snapSel = el('select', { class: 'fld mu-mini', 'aria-label': 'aimant', title: 'aimant à la grille (Alt en glissant : libre) · Ctrl+1 / Ctrl+2 : resserrer / élargir',
      onchange: (e) => { ui().snap = e.target.value === 'bar' ? 'bar' : +e.target.value; app.saveUi(); paintTools(); } },
    SNAPS.map(([v, l]) => el('option', { value: v, selected: String(ui().snap ?? 1) === String(v) || null }, l)));
    const fileIn = el('input', { type: 'file', multiple: true, accept: 'audio/*,.wav,.mp3,.flac,.m4a,.ogg', hidden: true,
      onchange: () => { app.importFiles([...fileIn.files], { track: S.sel.track, at: app.pos() }); fileIn.value = ''; } });
    put(tools,
      el('button', { class: 'tb ghost sm', type: 'button', title: 'Ctrl+T : piste audio · Ctrl+Maj+T : piste MIDI', onclick: (e) => addTrackMenu(e) }, '+ Piste'),
      el('button', { class: 'tb ghost sm', type: 'button', 'data-imp': '', title: 'des fichiers audio du disque (WAV, MP3, FLAC, M4A, OGG) : à la tête de lecture, sur la piste audio choisie ; on peut aussi les glisser sur l\'arrangement',
        onclick: () => fileIn.click() }, 'Importer'), fileIn,
      el('button', { class: 'tb ghost sm', type: 'button', title: 'un son de la bibliothèque, à la tête de lecture',
        onclick: () => app.addAudio(S.sel.track) }, '+ Son'),
      el('i', { class: 'ar-sep' }),
      el('label', { class: 'ar-lab' }, el('span', { class: 'lbl' }, 'aimant'), snapSel),
      el('i', { class: 'ar-sep' }),
      btn('Couper', inside, c ? 'place la tête de lecture dans le clip' : 'choisis un clip', () => app.splitAtPlayhead(), 'à la tête de lecture · Ctrl+E'),
      btn('Dupliquer', n > 0, 'choisis un clip', () => app.duplicateSel(), 'Ctrl+D'),
      btn('Consolider', n > 0, 'choisis des clips', () => app.consolidateSel(), 'un seul clip · Ctrl+J'),
      btn('Boucler', n > 0, 'choisis des clips', () => app.loopSelection(), 'la boucle sur la sélection · Ctrl+L'),
      btn(c?.mute ? 'Activer' : 'Désactiver', n > 0, 'choisis un clip', () => app.muteSel(), '0'),
      btn('Retirer', n > 0, 'choisis un clip', () => app.removeSel(), 'Suppr'),
      el('span', { class: 'sp' }),
      el('span', { class: 'lbl ar-info' }, n > 1 ? `${n} clips choisis` : c ? `${t.name} · ${app.bar(c.start)} → ${app.bar(c.start + c.len)}` : 'double-clic sur une piste : un clip · glisser : choisir'),
      el('i', { class: 'ar-sep' }),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'dézoomer · − (Ctrl+molette)', onclick: () => setZoom(ppb() / 1.25) }, '−'),
      el('span', { class: 'ar-zoom', title: 'pixels par mesure' }, el('b', {}, String(Math.round(ppb() * P().sig))), ' px/mes'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'zoomer · + (Ctrl+molette)', onclick: () => setZoom(ppb() * 1.25) }, '+'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'tout le morceau dans la fenêtre · W', onclick: fit }, 'Ajuster'),
      el('div', { class: 'seg', title: 'hauteur des pistes · Alt+molette sur une piste, Alt + / Alt − · H : ajuster' }, [[60, 'S'], [88, 'M'], [124, 'L']].map(([h, l]) =>
        el('button', { class: `tb${th() === h ? ' on' : ''}`, type: 'button', onclick: () => { ui().th = h; app.saveUi(); render(); } }, l))),
      el('i', { class: 'ar-sep' }),
      el('button', { class: `tb sm${ui().dock !== false ? ' on' : ' ghost'}`, type: 'button', title: 'la vue de détail en bas : le clip ou les instruments · Ctrl+Alt+3 / Ctrl+Alt+4',
        onclick: () => { ui().dock = ui().dock === false; app.saveUi(); render(); } }, 'Détail'));
  }

  function addTrackMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    menu(r.left, r.bottom + 4, app.trackChoices());
  }

  // zoom horizontal ancré sur un point de l'écran (le curseur, ou le milieu)
  function zoomAround(z, mx = scroll.clientWidth / 2) {
    const b = (scroll.scrollLeft + mx - HEAD_W) / ppb();
    ui().ppb = clamp(z, 2, 160);
    app.saveUi();
    render();
    scroll.scrollLeft = b * ppb() + HEAD_W - mx;
  }
  const setZoom = (z) => zoomAround(z);
  function fit() {
    const end = Math.max(projEnd(P()), P().loop.on ? P().loop.b : 0, 4 * P().sig);
    ui().ppb = clamp((scroll.clientWidth - HEAD_W - 30) / end, 2, 160);
    app.saveUi();
    render();
    scroll.scrollLeft = 0;
  }
  // H : les pistes à la hauteur qui les fait toutes tenir
  function fitHeight() {
    const n = visTracks().length || 1;
    const avail = scroll.clientHeight - RULER_H - ARC_H - 70;
    ui().th = clamp(Math.floor(avail / n), 48, 180);
    app.saveUi();
    render();
  }
  // Z : zoomer sur la sélection (les clips choisis, sinon la boucle) ; X : revenir
  let zoomBack = null;
  function zoomToSelection() {
    const g = P().clips.filter((c) => sel().has(c.id));
    const [a, b] = g.length ? [Math.min(...g.map((c) => c.start)), Math.max(...g.map((c) => c.start + c.len))] : [P().loop.a, P().loop.b];
    if (b <= a) return;
    zoomBack = { ppb: ppb(), left: scroll.scrollLeft };
    ui().ppb = clamp((scroll.clientWidth - HEAD_W - 40) / (b - a), 2, 160);
    app.saveUi();
    render();
    scroll.scrollLeft = X(a);
  }
  function zoomOut() {
    if (!zoomBack) return;
    ui().ppb = zoomBack.ppb; app.saveUi(); render(); scroll.scrollLeft = zoomBack.left; zoomBack = null;
  }

  // ── la règle : sections, mesures, boucle, marqueurs ──
  function ruler() {
    const p = P(), Wd = width(), bars = Math.ceil(Wd / ppb() / p.sig);
    const r = el('div', { class: 'ar-ruler', style: { width: `${Wd}px` } });
    const secRow = el('div', { class: 'ar-secs', title: 'double-clic : une section · sur une section : la renommer · glisser : la déplacer avec ses clips (Maj : l\'étiquette seule) · clic droit : dupliquer, colorer…' });
    for (const s of p.sections) secRow.append(sectionEl(s));
    const barRow = el('div', { class: 'ar-bars' });
    const band = el('div', { class: 'ar-band', title: 'glisser : la boucle' });
    const L = el('div', { class: `ar-loop${p.loop.on ? ' on' : ''}`, style: { left: `${X(p.loop.a)}px`, width: `${X(p.loop.b - p.loop.a)}px` } },
      el('i', { class: 'h a' }), el('i', { class: 'h b' }));
    band.append(L);
    const nums = el('div', { class: 'ar-nums', title: 'clic : aller là · glisser à l\'horizontale : chercher · à la verticale : zoomer · double-clic : zoomer sur la sélection' });
    const every = ppb() * p.sig < 26 ? 4 : ppb() * p.sig < 50 ? 2 : 1;
    for (let b = 0; b <= bars; b++) {
      if (b % every) continue;
      nums.append(el('span', { style: { left: `${X(b * p.sig)}px` } }, String(b + 1)));
    }
    const tri = el('i', { class: 'ar-tri' });
    barRow.append(band, nums, tri);
    for (const m of p.markers) barRow.append(markerEl(m));
    r.append(secRow, barRow);

    // la boucle
    band.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      band.setPointerCapture(e.pointerId);
      const b0 = beatAt(e.clientX);
      const edge = e.target.classList.contains('h') ? (e.target.classList.contains('a') ? 'a' : 'b') : null;
      const inLoop = !edge && e.target === L;
      const la = p.loop.a, lb = p.loop.b;
      const mv = (ev) => {
        const u = ev.altKey ? 0.25 : Math.max(1, snapU()), b = Math.round(beatAt(ev.clientX) / u) * u;
        if (edge === 'a') p.loop.a = clamp(b, 0, p.loop.b - u);
        else if (edge === 'b') p.loop.b = Math.max(p.loop.a + u, b);
        else if (inLoop) { const d = Math.round((beatAt(ev.clientX) - b0) / u) * u; p.loop.a = Math.max(0, la + d); p.loop.b = p.loop.a + (lb - la); }
        else { const s = Math.round(b0 / u) * u; p.loop.a = Math.max(0, Math.min(s, b)); p.loop.b = Math.max(s, b); if (p.loop.b - p.loop.a < u) p.loop.b = p.loop.a + u; }
        L.style.left = `${X(p.loop.a)}px`; L.style.width = `${X(p.loop.b - p.loop.a)}px`;
        paintZone();
      };
      const up = () => { band.removeEventListener('pointermove', mv); band.removeEventListener('pointerup', up); p.loop.on = true; app.commit('meta'); };
      band.addEventListener('pointermove', mv); band.addEventListener('pointerup', up);
    });
    // la règle des temps (Live) : glisser à l'horizontale = chercher, à la verticale = zoomer
    nums.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const x0 = e.clientX, y0 = e.clientY, z0 = ppb();
      const mx = e.clientX - scroll.getBoundingClientRect().left;
      let mode = null;
      app.engine.seek(Math.max(0, snapB(beatAt(e.clientX), e)));
      // zoomer redessine la règle : le geste s'écoute sur la fenêtre, pas sur elle
      const mv = (ev) => {
        if (!mode && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4) mode = Math.abs(ev.clientY - y0) > Math.abs(ev.clientX - x0) ? 'zoom' : 'seek';
        if (mode === 'zoom') zoomAround(z0 * Math.pow(1.012, ev.clientY - y0), mx);
        else if (mode === 'seek') app.engine.seek(Math.max(0, snapB(beatAt(ev.clientX), ev)));
      };
      const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); paintTools(); };
      addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
    });
    nums.addEventListener('dblclick', () => zoomToSelection());
    barRow.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const b = Math.max(0, snapB(beatAt(e.clientX), e));
      menu(e.clientX, e.clientY, [
        { head: `mesure ${app.bar(b)}` },
        { label: 'Aller là', onclick: () => app.engine.seek(b) },
        { label: 'Un marqueur ici', sub: 'Maj+M', onclick: () => app.addMarker(b) },
        { label: 'Une section ici', onclick: () => addSectionAt(b) },
        { label: 'La boucle commence ici', onclick: () => { p.loop.a = Math.min(b, p.loop.b - 1); p.loop.on = true; app.commit('meta'); } },
        { label: 'La boucle finit ici', onclick: () => { p.loop.b = Math.max(b, p.loop.a + 1); p.loop.on = true; app.commit('meta'); } },
      ]);
    });
    secRow.addEventListener('dblclick', (e) => {
      if (e.target !== secRow) return;
      addSectionAt(Math.max(0, Math.floor(beatAt(e.clientX) / p.sig) * p.sig));
    });
    return r;
  }

  function addSectionAt(b) {
    const p = P();
    const next = [...p.sections].filter((s) => s.a > b).sort((x, y) => x.a - y.a)[0];
    const inside = sectionAt(p, b);
    if (inside) { toast(`déjà dans « ${inside.name} » : la section commence où la précédente finit`); return; }
    const end = Math.min(next ? next.a : Infinity, b + 4 * p.sig);
    const name = SECTION_NAMES[p.sections.length % SECTION_NAMES.length];
    const s = { id: app.uid('s'), name, a: b, b: end, color: COLORS[(p.sections.length + 1) % COLORS.length], tag: guessTag(name) };
    p.sections.push(s);
    app.commit('data');
    toast(`section « ${name} » : double-clic dessus pour la renommer`);
  }
  const renameSection = (s, node) => inlineEdit(node, s.name, (n) => { s.name = n.slice(0, 40); s.tag = guessTag(s.name); app.commit('data'); }, { max: 40 });

  function sectionEl(s) {
    const p = P();
    const nm = el('b', {}, s.name);
    const box = el('div', { class: 'ar-sec', style: { left: `${X(s.a)}px`, width: `${Math.max(6, X(s.b - s.a) - 2)}px`, '--c': `var(--${s.color || 'cy'})` },
      title: `${s.name} · ${app.bar(s.a)} → ${app.bar(s.b)} · ${SECTION_TAGS.find(([k]) => k === s.tag)?.[1] || ''} — double-clic : renommer` },
    nm, el('i', { class: 'e l' }), el('i', { class: 'e r' }));
    box.addEventListener('dblclick', (e) => { e.stopPropagation(); renameSection(s, nm); });
    box.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); sectionMenu(e, s, nm); });
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || nm.classList.contains('editing')) return;
      e.preventDefault(); e.stopPropagation();
      const edge = e.target.classList.contains('e') ? (e.target.classList.contains('l') ? 'l' : 'r') : null;
      box.setPointerCapture(e.pointerId);
      const x0 = e.clientX, a0 = s.a, b0 = s.b, bar = p.sig;
      let moved = false;
      const mv = (ev) => {
        const d = Math.round((ev.clientX - x0) / ppb() / bar) * bar;
        if (Math.abs(ev.clientX - x0) > 3) moved = true;
        if (edge === 'l') s.a = clamp(a0 + d, 0, b0 - bar);
        else if (edge === 'r') s.b = Math.max(a0 + bar, b0 + d);
        else { box.style.transform = `translateX(${X(d)}px)`; box.dataset.d = d; return; }
        box.style.left = `${X(s.a)}px`; box.style.width = `${Math.max(6, X(s.b - s.a) - 2)}px`;
      };
      const up = (ev) => {
        box.removeEventListener('pointermove', mv); box.removeEventListener('pointerup', up);
        if (!moved) return;
        if (edge) {
          const clash = p.sections.find((o) => o !== s && o.a < s.b - 1e-9 && o.b > s.a + 1e-9);
          if (clash) { s.a = a0; s.b = b0; toast(`la section toucherait « ${clash.name} »`); render(); return; }
          app.commit('data'); return;
        }
        const d = +box.dataset.d || 0;
        if (!d) { render(); return; }
        if (ev.shiftKey) {
          const clash = p.sections.find((o) => o !== s && o.a < b0 + d - 1e-9 && o.b > a0 + d + 1e-9);
          if (clash || a0 + d < 0) { toast(clash ? `la place est prise par « ${clash.name} »` : 'avant le début'); render(); return; }
          s.a = a0 + d; s.b = b0 + d; app.commit('data'); return;
        }
        const why = moveSection(p, s, a0 + d);
        if (why) { toast(`déplacement refusé : ${why}`); render(); return; }
        toast(`« ${s.name} » déplacée avec ses clips`);
        app.commit('data');
      };
      box.addEventListener('pointermove', mv); box.addEventListener('pointerup', up);
    });
    return box;
  }

  function sectionMenu(e, s, nm) {
    const p = P();
    menu(e.clientX, e.clientY, [
      { head: `${s.name} · ${app.bar(s.a)} → ${app.bar(s.b)}` },
      { label: 'Renommer', sub: 'double-clic', onclick: () => renameSection(s, nm) },
      { label: 'Dupliquer avec ses clips', sub: 'insère la copie après', onclick: () => { const n = duplicateSection(p, s, app.uid); toast(`« ${n.name} » dupliquée : ${app.bar(n.a)} → ${app.bar(n.b)}`); app.commit('data'); } },
      { label: 'Avancer (échanger avec la précédente)', onclick: () => { const w = swapSection(p, s, -1); if (w) toast(w); else app.commit('data'); } },
      { label: 'Reculer (échanger avec la suivante)', onclick: () => { const w = swapSection(p, s, 1); if (w) toast(w); else app.commit('data'); } },
      { label: 'Choisir ses clips', onclick: () => { app.selectClips(p.clips.filter((c) => c.start >= s.a && c.start < s.b).map((c) => c.id)); } },
      { label: 'Boucler sur la section', onclick: () => { p.loop = { on: true, a: s.a, b: s.b }; app.commit('meta'); } },
      '-', { head: 'couleur' },
      ...COLORS.map((c) => ({ label: COLOR_FR[c], dot: c, onclick: () => { s.color = c; app.commit('data'); } })),
      '-', { head: 'dans les paroles (génératif)' },
      ...SECTION_TAGS.map(([k, l]) => ({ label: `${l}${s.tag === k ? ' ·' : ''}`, sub: `[${k}]`, onclick: () => { s.tag = k; app.commit('data'); } })),
      '-',
      { label: 'Retirer la section (garder les clips)', onclick: () => { removeSection(p, s, false); app.commit('data'); } },
      { label: 'Retirer la section et ses clips', onclick: async () => {
        if (!(await confirmBox('Retirer', `Retirer « ${s.name} » et les clips qui y commencent ?`))) return;
        removeSection(p, s, true); app.commit('data');
      } },
    ]);
  }

  function markerEl(m) {
    const nm = el('span', {}, m.name);
    const box = el('div', { class: 'ar-mark', style: { left: `${X(m.b)}px` }, title: `${m.name} · ${app.bar(m.b)} — clic : aller là · glisser : déplacer · double-clic : renommer` },
      el('i'), nm);
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || nm.classList.contains('editing')) return;
      e.preventDefault(); e.stopPropagation();
      box.setPointerCapture(e.pointerId);
      const x0 = e.clientX, b0 = m.b;
      let moved = false;
      const mv = (ev) => { if (Math.abs(ev.clientX - x0) > 3) moved = true; m.b = Math.max(0, snapB(b0 + (ev.clientX - x0) / ppb(), ev)); box.style.left = `${X(m.b)}px`; };
      const up = () => { box.removeEventListener('pointermove', mv); box.removeEventListener('pointerup', up); if (moved) app.commit('data'); else app.engine.seek(m.b); };
      box.addEventListener('pointermove', mv); box.addEventListener('pointerup', up);
    });
    box.addEventListener('dblclick', (e) => { e.stopPropagation(); inlineEdit(nm, m.name, (n) => { m.name = n.slice(0, 40); app.commit('data'); }, { max: 40 }); });
    box.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); menu(e.clientX, e.clientY, [{ label: 'Aller là', onclick: () => app.engine.seek(m.b) }, { label: 'Retirer le marqueur', onclick: () => { P().markers = P().markers.filter((x) => x !== m); app.commit('data'); } }]); });
    return box;
  }

  // ── les courbes peintes : l'arc d'énergie, les voies d'automation ──
  // Glisser : peindre (la valeur suit la souris, posée à chaque pas de la
  // résolution) ; Maj : une droite depuis le point de départ ; clic droit :
  // effacer ce qu'on survole.
  function paintable(cv, getPts, { res, h, color, columns, onDone }) {
    const draw = () => {
      const pts = getPts(), w = Math.max(4, Math.round(width())), dpr = devicePixelRatio || 1;
      if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; cv.style.width = `${w}px`; cv.style.height = `${h}px`; }
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const y = (v) => 4 + (1 - v) * (h - 8);
      if (!pts.length) {
        g.fillStyle = tok('ink3'); g.font = `9px ${tok('f-mono') || 'monospace'}`;
        g.fillText('glisser pour peindre', 8, h / 2 + 3);
        return;
      }
      if (columns) {
        g.fillStyle = tok('or-bg');
        for (let i = 0; i < pts.length; i++) {
          const x0 = X(pts[i][0]), x1 = i + 1 < pts.length ? X(pts[i + 1][0]) : x0 + X(res);
          g.fillRect(x0 + 1, y(pts[i][1]), Math.max(1, x1 - x0 - 2), h - y(pts[i][1]));
        }
      }
      g.strokeStyle = tok(color); g.lineWidth = 1.6; g.beginPath();
      g.moveTo(0, y(pts[0][1]));
      for (const [b, v] of pts) g.lineTo(X(b), y(v));
      g.lineTo(w, y(pts[pts.length - 1][1]));
      g.stroke();
      if (!columns) { g.fillStyle = tok(color); for (const [b, v] of pts) g.fillRect(X(b) - 2, y(v) - 2, 4, 4); }
    };
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      const pts = getPts();
      const erase = e.button === 2;
      const orig = pts.map((p) => [...p]);
      const r = cv.getBoundingClientRect();
      const at = (ev) => ({ b: Math.max(0, (ev.clientX - r.left) / ppb()), v: clamp(1 - (ev.clientY - r.top - 4) / (h - 8), 0, 1) });
      const a0 = at(e);
      let prev = a0;
      const gridB = (b) => Math.round(b / res) * res;
      const put1 = (b, v) => {
        const gb = gridB(b);
        const i = pts.findIndex((p) => Math.abs(p[0] - gb) < res / 2 - 1e-9);
        if (erase) { if (i >= 0) pts.splice(i, 1); return; }
        if (i >= 0) pts[i][1] = v; else pts.push([gb, v]);
      };
      const seg = (p0, p1) => {
        const lo = Math.min(p0.b, p1.b), hi = Math.max(p0.b, p1.b);
        for (let b = gridB(lo); b <= gridB(hi) + 1e-9; b += res) {
          const t = hi > lo ? clamp((b - p0.b) / (p1.b - p0.b), 0, 1) : 1;
          put1(b, p0.v + (p1.v - p0.v) * t);
        }
      };
      seg(a0, a0);
      pts.sort((x, y) => x[0] - y[0]); draw();
      const mv = (ev) => {
        const a = at(ev);
        if (ev.shiftKey && !erase) { pts.splice(0, pts.length, ...orig.map((p) => [...p])); seg(a0, a); }
        else seg(prev, a);
        prev = a;
        pts.sort((x, y) => x[0] - y[0]); draw();
      };
      const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); onDone(); };
      cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
    });
    requestAnimationFrame(draw);
    return draw;
  }

  function arcRow() {
    const p = P(), A = p.arc, mst = app.master();
    const target = { lpf: 'filtre maître', vol: 'volume maître', both: 'filtre et volume' }[A.to] || 'filtre maître';
    const cv = el('canvas', { class: 'ar-curve' });
    const lane = el('div', { class: `ar-arc${A.on ? '' : ' off'}`, style: { width: `${width()}px`, '--bar': `${X(p.sig)}px` } }, cv);
    paintable(cv, () => A.pts, { res: Math.max(0.25, snapU() || 1), h: ARC_H, color: 'or', columns: true, onDone: () => app.commit('data') });
    const head = el('div', { class: `ar-arch${A.on ? '' : ' off'}` },
      el('div', { class: 'txt' }, el('b', {}, 'Arc d\'énergie'), el('span', {}, `peindre · ${target}`)),
      el('div', { class: 'row' },
        el('button', { class: `tb sm${A.on ? ' on' : ' ghost'}`, type: 'button', title: 'l\'arc pilote la sortie ; éteint, la sortie reste ouverte',
          onclick: () => { A.on = !A.on; app.commit('meta'); } }, A.on ? 'Actif' : 'Éteint'),
        knob(spec('master', 'arc_lo'), val(mst, 'arc_lo'), { size: 'xs', accent: 'or', label: 'coupure basse de l\'arc',
          onInput: (v) => { mst.params.arc_lo = v; app.commit('param', mst); }, onChange: () => app.engine.settle() }),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'cible, effacer, automation de la sortie', onclick: (e) => arcMenu(e) }, '···')));
    head.addEventListener('contextmenu', (e) => { e.preventDefault(); arcMenu(e); });
    return [head, lane];
  }

  function arcMenu(e) {
    const p = P(), A = p.arc;
    menu(e.clientX, e.clientY, [
      { head: 'l\'arc pilote' },
      ...[['lpf', 'le filtre de la sortie'], ['vol', 'le volume de la sortie'], ['both', 'les deux']].map(([k, l]) => ({ label: `${l}${A.to === k ? ' ·' : ''}`, onclick: () => { A.to = k; app.commit('meta'); } })),
      '-',
      { label: 'Tout à fond (arc plat)', onclick: () => { A.pts = [[0, 1]]; app.commit('meta'); } },
      { label: 'Suivre les sections', sub: 'intro basse, refrain haut', onclick: () => { A.pts = arcFromSections(p); app.commit('meta'); } },
      { label: 'Effacer l\'arc', onclick: () => { A.pts = []; app.commit('meta'); } },
      '-',
      { label: 'Automation du volume de la sortie', onclick: () => app.addAuto(app.master().id, 'vol') },
    ]);
  }
  // un arc de départ tiré des étiquettes de section (choix de réglage) :
  // l'intro et le final bas, le couplet au milieu, le refrain en haut
  function arcFromSections(p) {
    const lvl = { intro: 0.35, verse: 0.6, 'pre-chorus': 0.75, chorus: 1, bridge: 0.5, instrumental: 0.7, outro: 0.4 };
    const out = [];
    for (const s of [...p.sections].sort((x, y) => x.a - y.a)) for (let b = s.a; b < s.b; b += 2) out.push([b, lvl[s.tag] ?? 0.6]);
    return out.length ? out : [[0, 1]];
  }

  // ── une piste ──
  const renameTrack = (t, node) => inlineEdit(node, t.name, (n) => { t.name = n.slice(0, 60); app.commit('data'); }, { max: 60 });
  function head(t) {
    const st = app.mod(t.strip), src = app.mod(t.src);
    const tog = (label, on, title, fn, cls = '') => el('button', { class: `tb sm ${cls}${on ? ' on' : ' ghost'}`, type: 'button', title, 'aria-pressed': on,
      onclick: (e) => { e.stopPropagation(); fn(); } }, label);
    const volS = spec('strip', 'vol');
    const vol = el('input', { type: 'range', class: 'ar-vol', min: 0, max: 1, step: 0.001, value: toNorm(volS, val(st, 'vol')),
      title: `volume : ${fmt(volS, val(st, 'vol'))} dB`, 'aria-label': 'volume',
      oninput: (e) => { const s = volS; const v = Math.round((s.min + e.target.value * (s.max - s.min)) * 10) / 10; st.params.vol = v; e.target.title = `volume : ${fmt(s, v)} dB`; app.commit('param', st); },
      onchange: () => app.commit('quiet'), ondblclick: (e) => { st.params.vol = 0; e.target.value = toNorm(volS, 0); app.commit('param', st); app.commit('quiet'); },
      onpointerdown: (e) => e.stopPropagation() });
    const mtr = el('div', { class: 'ar-mtr' }, el('i'));
    meters.push([t.strip, mtr]);
    const nm = el('span', { class: 'nm', title: 'double-clic : renommer (Ctrl+R)', ondblclick: (e) => { e.stopPropagation(); renameTrack(t, nm); } }, t.name);
    const box = el('div', { class: `ar-head${S.sel.track === t.id ? ' sel' : ''}${t.mute ? ' muted' : ''}`, style: { '--c': `var(--${t.color})`, height: `${th()}px` },
      'data-track': t.id, onclick: () => app.selectTrack(t.id) },
    el('i', { class: 'bar', title: 'couleur', onclick: (e) => { e.stopPropagation(); colorMenu(e, t); } }),
    el('div', { class: 'txt' },
      nm,
      el('span', { class: 'kd', title: moduleName(src?.type) }, t.sub || `${TRACK_KINDS[t.kind].label} · ${moduleName(src?.type)}`),
      mtr,
      el('div', { class: 'row' },
        tog('M', t.mute, 'muet', () => { t.mute = !t.mute; app.commit('mute'); }),
        tog('S', t.solo, 'solo', () => { t.solo = !t.solo; app.commit('mute'); }),
        tog('●', t.arm, t.kind === 'audio' ? 'armer : la prise enregistre le micro sur cette piste' : 'armer : la prise enregistre le clavier et le MIDI sur cette piste',
          () => { t.arm = !t.arm; app.commit('quiet'); render(); }, 'arm'),
        tog('A', !!ui().auto?.[t.id], 'automation : les courbes de la piste', () => { ui().auto = { ...(ui().auto || {}), [t.id]: !ui().auto?.[t.id] }; app.saveUi(); render(); }),
        vol,
        knob(spec('strip', 'pan'), val(st, 'pan'), { size: 'xs', accent: t.color, label: 'panoramique',
          onInput: (v) => { st.params.pan = v; app.commit('param', st); }, onChange: () => app.commit('quiet') }))));
    box.addEventListener('contextmenu', (e) => { e.preventDefault(); trackMenu(e, t, nm); });
    box.addEventListener('dragover', (e) => onDragOver(e, t));
    box.addEventListener('drop', (e) => onDrop(e, t, app.pos()));
    return box;
  }

  function colorMenu(e, t) {
    menu(e.clientX, e.clientY, [{ head: 'couleur de la piste' }, ...COLORS.map((c) => ({ label: COLOR_FR[c], dot: c, onclick: () => { t.color = c; app.commit('data'); } }))]);
  }

  function trackMenu(e, t, nm) {
    const i = P().tracks.indexOf(t);
    const autos = (AUTOMATABLE[app.mod(t.src)?.type] || []).map((k) => [t.src, k]).concat(
      app.chain(t.id).filter((m) => m.id !== t.src).flatMap((m) => (AUTOMATABLE[m.type] || []).map((k) => [m.id, k])));
    menu(e.clientX, e.clientY, [
      { head: t.name },
      { label: 'Renommer', sub: 'Ctrl+R', onclick: () => renameTrack(t, nm) },
      { label: 'Instruments et effets', sub: 'Maj+Tab', onclick: () => { app.selectTrack(t.id); app.showDetail('device'); } },
      { label: 'Monter', disabled: i <= 0, onclick: () => { const a = P().tracks; [a[i - 1], a[i]] = [a[i], a[i - 1]]; app.commit('data'); } },
      { label: 'Descendre', disabled: i >= P().tracks.length - 1, onclick: () => { const a = P().tracks; [a[i + 1], a[i]] = [a[i], a[i + 1]]; app.commit('data'); } },
      '-', { head: 'instrument' },
      ...(SOURCES_OF[t.kind] || []).filter((x) => x !== 'player' && x !== 'bus').map((type) => ({ label: MODULES[type].name, sub: MODULES[type].kind, dot: MODULES[type].color,
        disabled: app.mod(t.src)?.type === type, onclick: () => app.setSource(t.id, type) })),
      '-', { head: 'automation' },
      ...autos.slice(0, 16).map(([mid, k]) => ({ label: `${moduleName(app.mod(mid).type)} · ${spec(app.mod(mid).type, k).label}`,
        disabled: P().auto.some((L) => L.mod === mid && L.k === k), onclick: () => app.addAuto(mid, k) })),
      '-',
      { label: 'Retirer la piste', onclick: () => app.removeTrack(t.id) },
    ]);
  }

  function lane(t) {
    const p = P();
    const ln = el('div', { class: `ar-lane${S.sel.track === t.id ? ' sel' : ''}`, 'data-track': t.id,
      style: { width: `${width()}px`, height: `${th()}px`, '--bar': `${X(p.sig)}px`, '--beat': `${X(1)}px`, '--c': `var(--${t.color})` } });
    for (const c of p.clips.filter((x) => x.track === t.id)) ln.append(clipEl(c, t));
    ln.addEventListener('dblclick', (e) => {
      if (e.target !== ln) return;
      const b = Math.max(0, Math.floor(beatAt(e.clientX) / p.sig) * p.sig);
      if (t.kind === 'audio') app.addAudio(t.id, b);
      else { const c = app.newClip(t.id, b); if (c) app.showDetail('clip'); }
    });
    ln.addEventListener('pointerdown', (e) => { if (e.target === ln && e.button === 0) startMarquee(e, t); });
    ln.addEventListener('dragover', (e) => onDragOver(e, t));
    ln.addEventListener('dragleave', () => { dropLine.style.display = 'none'; });
    ln.addEventListener('drop', (e) => onDrop(e, t));
    return ln;
  }

  // ── les voies d'automation d'une piste (ou de la sortie) ──
  function autoRows(L) {
    const m = app.mod(L.mod);
    if (!m) return [];
    const s = spec(m.type, L.k), t = m.track && app.track(m.track);
    const color = t?.color || 'cy';
    const cv = el('canvas', { class: 'ar-curve' });
    const ln = el('div', { class: `ar-alane${L.on === false ? ' off' : ''}`, style: { width: `${width()}px`, '--bar': `${X(P().sig)}px`, '--c': `var(--${color})` } }, cv);
    paintable(cv, () => L.pts, { res: 0.25, h: AUTO_H, color, columns: false, onDone: () => app.commit('data') });
    const now = L.pts.length ? fmt(s, fromNormSafe(s, interp(L.pts, app.pos()))) : fmt(s, val(m, L.k));
    const hd = el('div', { class: `ar-ahead${L.on === false ? ' off' : ''}`, style: { '--c': `var(--${color})` } },
      el('div', { class: 'txt' }, el('b', {}, `${moduleName(m.type)} · ${s.label}`), el('span', {}, `${t ? t.name : 'sortie'} · ${now} ${s.unit || ''}`)),
      el('div', { class: 'row' },
        el('button', { class: `tb sm${L.on !== false ? ' on' : ' ghost'}`, type: 'button', title: 'la courbe tient le réglage pendant la lecture',
          onclick: () => { L.on = L.on === false; app.commit('meta'); } }, L.on !== false ? 'Lue' : 'Ignorée'),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'effacer la courbe', onclick: () => { L.pts = []; app.commit('meta'); } }, 'Effacer'),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'retirer la voie', onclick: () => { P().auto = P().auto.filter((x) => x !== L); app.commit('meta'); } }, '×')));
    return [hd, ln];
  }
  const fromNormSafe = (s, v) => (v === null ? s.def : fromNorm(s, v));

  // ── un clip ──
  function clipLabel(c, t, pat) {
    if (c.name) return c.name;
    const sec = sectionAt(P(), c.start);
    const nm = t.kind === 'audio' ? '' : pat?.name || '';
    return sec ? `${sec.name}${nm ? ` · ${nm}` : ''}` : nm;
  }
  const renameClip = (c, node, current) => inlineEdit(node, current, (n) => { c.name = n.slice(0, 60); app.commit('data'); }, { max: 60 });

  function clipEl(c, t) {
    const pat = c.pat && app.pat(c.pat);
    const cv = el('canvas', { class: 'cv' });
    const ttl = el('span', { class: 't' }, clipLabel(c, t, pat));
    const ch = el('div', { class: 'ch', title: 'double-clic : renommer le clip' }, el('i', { class: 'sq' }), ttl,
      c.loop ? el('span', { class: 'lp', title: 'en boucle' }, '∞') : null, c.rev ? el('span', { class: 'lp', title: 'à l\'envers' }, '⇆') : null,
      c.pitch ? el('span', { class: 'lp', title: 'transposé' }, `${c.pitch > 0 ? '+' : ''}${(+c.pitch).toFixed(1)}`) : null);
    const on = sel().has(c.id);
    const box = el('div', { class: `clip${on ? ' sel' : ''}${c.mute || t.mute ? ' muted' : ''}${c.loop ? ' looped' : ''}`, 'data-id': c.id,
      style: { left: `${X(c.start)}px`, width: `${Math.max(4, X(c.len))}px` } },
    ch, cv, el('i', { class: 'rs l', title: 'rogner le début (la fin reste, le contenu reste calé)' }), el('i', { class: 'rs r', title: t.kind === 'audio' ? 'rogner la fin' : 'rogner ou rallonger la fin : le motif se répète' }));
    if (t.kind === 'audio' && !c.name) app.loadItem(c.item).then((it) => { ttl.textContent = `${clipLabel(c, t, null)}${clipLabel(c, t, null) ? ' · ' : ''}${it.title}`; box.title = it.title; }).catch(() => { ttl.textContent = 'son introuvable'; });
    requestAnimationFrame(() => drawClip(cv, c, t, pat));
    box.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      // la capture du pointeur (dragClips) fait du clip la cible du double-clic :
      // c'est la hauteur du geste qui dit s'il tombe sur le titre
      if (e.clientY <= ch.getBoundingClientRect().bottom) { renameClip(c, ttl, c.name || ttl.textContent); return; }
      app.selectClips([c.id], true); app.showDetail('clip');
    });
    box.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!sel().has(c.id)) app.selectClips([c.id], true);
      clipMenu(e, c, t, ttl);
    });
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || ttl.classList.contains('editing')) return;
      e.stopPropagation();
      const edge = e.target.classList.contains('rs') ? (e.target.classList.contains('l') ? 'l' : 'r') : null;
      if ((e.shiftKey || e.ctrlKey || e.metaKey) && !edge && !(e.ctrlKey && sel().has(c.id))) {   // ajouter / retirer de la sélection (Live : Ctrl+clic)
        const s = sel();
        if (s.has(c.id)) s.delete(c.id); else s.add(c.id);
        app.selectClips([...s], true);
        paintSel();
        return;
      }
      if (!sel().has(c.id)) { app.selectClips([c.id], true); paintSel(); }
      else { S.sel.clip = c.id; S.sel.track = t.id; }
      dragClips(e, c, t, box, edge);
    });
    return box;
  }

  function clipMenu(e, c, t, ttl) {
    const n = (S.sel.clips || []).length;
    menu(e.clientX, e.clientY, [
      { head: n > 1 ? `${n} clips` : clipLabel(c, t, app.pat(c.pat)) || 'clip' },
      { label: 'Ouvrir dans la vue Clip', onclick: () => app.showDetail('clip') },
      { label: 'Renommer', sub: 'Ctrl+R', onclick: () => renameClip(c, ttl, c.name || ttl.textContent) },
      { label: 'Couper à la tête de lecture', sub: 'Ctrl+E', onclick: () => app.splitAtPlayhead() },
      { label: 'Dupliquer', sub: 'Ctrl+D', onclick: () => app.duplicateSel() },
      { label: 'Consolider', sub: 'Ctrl+J', onclick: () => app.consolidateSel() },
      { label: 'Boucler la sélection', sub: 'Ctrl+L', onclick: () => app.loopSelection() },
      { label: 'Copier', sub: 'Ctrl+C', onclick: () => app.copySel() },
      { label: 'Couper (presse-papiers)', sub: 'Ctrl+X', onclick: () => app.cutSel() },
      { label: 'Coller à la tête de lecture', sub: 'Ctrl+V', disabled: !app.board, onclick: () => app.paste() },
      { label: c.mute ? 'Activer' : 'Désactiver', sub: '0', onclick: () => app.muteSel() },
      ...(t.kind === 'audio' ? [
        { label: c.rev ? 'À l\'endroit' : 'Inverser', sub: 'R', onclick: () => app.reverseSel() },
        { label: c.loop ? 'Ne plus boucler le son' : 'Boucler le son', onclick: () => app.toggleLoop(c.id) },
        { label: 'Séparer en pistes', sub: 'voix · batterie · basse · autre', onclick: () => app.stems(c.id) },
      ] : [
        { label: 'Motif à part (copie)', onclick: () => app.uniqueClip(c.id) },
      ]),
      '-', { label: 'Retirer', sub: 'Suppr', onclick: () => app.removeSel() },
    ]);
  }

  // la sélection repeinte sans refaire la grille : un double-clic qui suit
  // (renommer) tombe encore sur le même élément
  function paintSel() {
    const s = sel();
    for (const b of grid.querySelectorAll('.clip')) b.classList.toggle('sel', s.has(b.dataset.id));
    for (const b of grid.querySelectorAll('.ar-head, .ar-lane')) b.classList.toggle('sel', b.dataset.track === S.sel.track);
    paintTools();
    if (ui().dock !== false) dock.render();
  }

  // Glisser des clips : le corps les déplace (Ctrl : les copie, Alt : sans
  // aimant), changer de piste (même sorte) ; la poignée de GAUCHE rogne le
  // début (la fin reste à sa place et le contenu reste calé dans le temps :
  // le dessin est retenu pendant le geste), celle de droite la fin. Tout le
  // groupe choisi suit.
  function dragClips(e, c, t, box, edge) {
    const p = P();
    const ids = sel();
    const group = p.clips.filter((x) => ids.has(x.id));
    const orig = new Map(group.map((x) => [x.id, JSON.parse(JSON.stringify(x))]));
    // repartir de l'état d'avant le geste, clés absentes comprises (un
    // « off » posé au pas précédent ne doit pas s'ajouter au suivant)
    const restore = (x) => { const o = orig.get(x.id); for (const k of Object.keys(x)) if (!(k in o)) delete x[k]; Object.assign(x, JSON.parse(JSON.stringify(o))); };
    const rows = visTracks();
    const rowOf = (tid) => rows.findIndex((r) => r.id === tid);
    const x0 = e.clientX;
    let moved = false, dRow = 0;
    box.setPointerCapture(e.pointerId);
    const boxes = new Map([...grid.querySelectorAll('.clip')].filter((b) => ids.has(b.dataset.id)).map((b) => [b.dataset.id, b]));
    const place = (x) => {
      const b = boxes.get(x.id);
      if (!b) return;
      b.style.left = `${X(x.start)}px`; b.style.width = `${Math.max(4, X(x.len))}px`;
      // rogner : le dessin est refait depuis le nouveau départ dans le
      // contenu (off), le son et les notes restent donc à leur place
      if (edge) { const cvx = b.querySelector('.cv'); if (cvx) drawClip(cvx, x, app.track(x.track), x.pat && app.pat(x.pat)); }
    };
    const mv = (ev) => {
      if (Math.abs(ev.clientX - x0) > 2) moved = true;
      if (!moved) return;
      const dx = (ev.clientX - x0) / ppb();
      const o = orig.get(c.id);
      if (edge === 'r') {
        const newEnd = snapB(o.start + o.len + dx, ev);
        const d = newEnd - (o.start + o.len);
        for (const x of group) {
          const ox = orig.get(x.id);
          let len = Math.max(ev.altKey ? 0.0625 : Math.max(0.0625, snapU() || 0.0625), ox.len + d);
          const tr = app.track(x.track);
          if (tr?.kind === 'audio' && !x.loop) {
            const buf = app.engine.buffers.get(x.item);
            if (buf) len = Math.min(len, (buf.duration - (x.off || 0)) / audioGeom(x, buf.duration).rate * p.bpm / 60);
          }
          x.len = len; place(x);
        }
      } else if (edge === 'l') {
        const d = snapB(o.start + dx, ev) - o.start;
        for (const x of group) { restore(x); trimStart(p, x, d); place(x); }
      } else {
        const minStart = Math.min(...group.map((x) => orig.get(x.id).start));
        let d = snapB(o.start + dx, ev) - o.start;
        d = Math.max(d, -minStart);
        for (const x of group) { x.start = orig.get(x.id).start + d; place(x); }
        // changer de piste : la rangée sous la souris
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.ar-lane');
        const r = over ? rowOf(over.dataset.track) : -1;
        const nd = r >= 0 ? r - rowOf(o.track) : dRow;
        if (nd !== dRow) {
          const ok = group.every((x) => { const tr = rows[rowOf(orig.get(x.id).track) + nd]; const t0 = app.track(orig.get(x.id).track); return tr && sameKind(t0, tr); });
          if (ok) {
            dRow = nd;
            for (const x of group) {
              const tr = rows[rowOf(orig.get(x.id).track) + nd];
              const ln = grid.querySelector(`.ar-lane[data-track="${tr.id}"]`);
              const b = boxes.get(x.id);
              if (ln && b) ln.append(b);
            }
          }
        }
      }
    };
    const up = (ev) => {
      box.removeEventListener('pointermove', mv); box.removeEventListener('pointerup', up);
      if (!moved) { paintTools(); dock.render(); return; }
      if (!edge && dRow) {
        for (const x of group) {
          const tr = rows[rowOf(orig.get(x.id).track) + dRow];
          if (tr.id === x.track) continue;
          if (x.pat) {                                      // le motif suit dans la piste d'arrivée
            const src = app.pat(x.pat);
            const cp = { ...JSON.parse(JSON.stringify(src)), id: app.uid('p'), track: tr.id };
            p.patterns.push(cp); x.pat = cp.id;
          }
          x.track = tr.id;
        }
      }
      if (!edge && ev.ctrlKey) {                           // Ctrl : les originaux restent, ce qui bouge est la copie
        for (const x of group) p.clips.push({ ...JSON.parse(JSON.stringify(orig.get(x.id))), id: app.uid('c') });
        toast(`${group.length} clip${group.length > 1 ? 's' : ''} copié${group.length > 1 ? 's' : ''}`);
      }
      app.commit('data');
    };
    box.addEventListener('pointermove', mv); box.addEventListener('pointerup', up);
  }
  const sameKind = (a, b) => a && b && (a.kind === b.kind || (a.kind !== 'audio' && b.kind !== 'audio' && TRACK_KINDS[a.kind].pattern === TRACK_KINDS[b.kind].pattern));

  // tirer un cadre sur les voies vides : les clips qu'il touche ; un simple
  // clic pose la tête de lecture (à l'arrêt) et choisit la piste
  function startMarquee(e, t) {
    const g = grid.getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const base = e.shiftKey || e.ctrlKey ? sel() : new Set();
    const mv = (ev) => {
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 4) moved = true;
      if (!moved) return;
      const l = Math.min(x0, ev.clientX), r = Math.max(x0, ev.clientX), tp = Math.min(y0, ev.clientY), bt = Math.max(y0, ev.clientY);
      Object.assign(marquee.style, { display: 'block', left: `${l - g.left}px`, top: `${tp - g.top}px`, width: `${r - l}px`, height: `${bt - tp}px` });
      const s = new Set(base);
      for (const b of grid.querySelectorAll('.clip')) {
        const rb = b.getBoundingClientRect();
        if (rb.right > l && rb.left < r && rb.bottom > tp && rb.top < bt) s.add(b.dataset.id);
      }
      for (const b of grid.querySelectorAll('.clip')) b.classList.toggle('sel', s.has(b.dataset.id));
      S.sel.clips = [...s];
    };
    const up = (ev) => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      marquee.style.display = 'none';
      if (!moved) {
        S.sel.clips = []; S.sel.clip = null;
        if (!app.engine.running) app.engine.seek(Math.max(0, snapB(beatAt(ev.clientX), ev)));
        app.selectTrack(t.id);
        return;
      }
      app.selectClips(S.sel.clips, true);
      paintSel();
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }

  function drawClip(cv, c, t, pat) {
    const w = Math.max(4, Math.min(8000, Math.round(X(c.len)))), h = Math.max(10, th() - 28);
    const dpr = devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = tok(t.color);
    const p = P();
    if (t.kind === 'audio') {
      const buf0 = app.engine.buffers.get(c.item);
      if (!buf0) { app.engine.buffer(c.item).then(() => drawClip(cv, c, t, pat)).catch(() => {}); return; }
      const buf = clipBuffer(buf0, c), G = audioGeom(c, buf.duration);
      const pk = peaks(buf, 4000), spb = 60 / p.bpm, L = c.len * spb;
      const gain = Math.pow(10, (c.gain || 0) / 20);
      for (let x = 0; x < w; x++) {
        const tau = (x / ppb()) * spb;
        let sec = G.off + tau * G.rate;
        if (G.loop && sec >= G.ls + G.llen) sec = G.ls + ((sec - G.ls) % G.llen);
        if (sec >= buf.duration) break;
        const env = Math.min(1, c.fi ? tau / c.fi : 1, c.fo ? (L - tau) / c.fo : 1);
        const v = pk[Math.min(pk.length - 1, Math.floor(sec / buf.duration * pk.length))] * gain * Math.max(0, env);
        const hh = Math.max(1, Math.min(1, v) * (h - 2));
        g.fillRect(x, (h - hh) / 2, 1, hh);
      }
      // les fondus, en trait
      g.strokeStyle = tok('ink2'); g.lineWidth = 1;
      if (c.fi) { g.beginPath(); g.moveTo(0, h); g.lineTo(X(c.fi / spb), 1); g.stroke(); }
      if (c.fo) { g.beginPath(); g.moveTo(w - X(c.fo / spb), 1); g.lineTo(w, h); g.stroke(); }
      if (G.loop) {
        // les retours en haut de boucle
        g.fillStyle = tok('line-cy');
        const first = (G.ls + G.llen - G.off) / G.rate / spb;
        for (let s = first; s < c.len; s += G.llen / G.rate / spb) if (s > 0) g.fillRect(X(s), 0, 1, h);
      }
      return;
    }
    if (!pat) return;
    const plen = pat.steps / 4, off = c.off || 0;
    if (t.kind === 'drums') {
      const voices = drumVoicesOf(app.mod(t.src)?.type).filter((v) => pat.lanes?.[v.id]?.some(Boolean));
      const rows = Math.max(1, voices.length), rh = h / rows;
      voices.forEach((v, r) => {
        const laneArr = pat.lanes[v.id];
        for (let b = -off; b < c.len; b += plen) {
          laneArr.forEach((vel, s) => {
            const x = X(b + s / 4);
            if (vel && x >= 0 && x < w) { g.globalAlpha = 0.45 + 0.55 * vel; g.fillRect(x, r * rh + rh / 2 - 1.5, Math.max(3, X(0.25) - 2), 3); }
          });
        }
      });
      g.globalAlpha = 1;
    } else {
      const ps = (pat.notes || []).map((n) => n.p);
      const lo = Math.min(...ps, 60) - 1, hi = Math.max(...ps, 61) + 1;
      for (let b = -off; b < c.len; b += plen) {
        for (const n of pat.notes || []) {
          const x = X(b + n.s / 4);
          if (x + X(n.l / 4) < 0 || x >= w) continue;
          const y = h - 3 - ((n.p - lo) / (hi - lo)) * (h - 6);
          g.fillRect(x, y - 1.5, Math.max(2, X(n.l / 4) - 1), 3);
        }
      }
    }
    g.fillStyle = tok('line');
    for (let b = plen - off; b < c.len; b += plen) g.fillRect(X(b), 0, 1, h);
  }

  // ── déposer : fichiers du disque (ils entrent dans la bibliothèque,
  // catégorie Upload), sons glissés d'ailleurs dans le portail (ITEM_MIME de
  // commun/shell.js), éléments du navigateur d'ODIO ──
  const wants = (e) => { const ty = [...(e.dataTransfer?.types || [])]; return ty.includes('Files') || ty.includes('application/x-odio') || ty.includes(ITEM_MIME); };
  function onDragOver(e, t) {
    if (!wants(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const b = Math.max(0, snapB(beatAt(e.clientX), e));
    Object.assign(dropLine.style, { display: 'block', left: `${HEAD_W + X(b)}px` });
    grid.querySelectorAll('.ar-lane.drop').forEach((x) => x.classList.remove('drop'));
    if (t) grid.querySelector(`.ar-lane[data-track="${t.id}"]`)?.classList.add('drop');
  }
  async function onDrop(e, t, atBeat) {
    if (!wants(e)) return;
    e.preventDefault(); e.stopPropagation();
    dropLine.style.display = 'none';
    document.body.classList.remove('dropping');
    grid.querySelectorAll('.ar-lane.drop').forEach((x) => x.classList.remove('drop'));
    const at = atBeat ?? Math.max(0, snapB(beatAt(e.clientX), e));
    const raw = e.dataTransfer.getData(ITEM_MIME);
    if (raw) {
      try {
        const it = await api(`library/${JSON.parse(raw).id}`);
        if (it.kind !== 'audio') { toast(`ODIO prend des sons ; « ${it.title} » est ${it.kind === 'image' ? 'une image' : it.kind === 'video' ? 'une vidéo' : 'un élément'}`); return; }
        app.dropItem({ t: 'son', item: it }, t?.id || null, at);
      } catch (err) { toast(err.message); }
      return;
    }
    if (e.dataTransfer.files?.length) {
      const files = [...e.dataTransfer.files];
      const audio = files.filter((f) => AUDIO_EXT.test(f.name) || f.type.startsWith('audio/'));
      if (audio.length < files.length) toast(`${files.length - audio.length} fichier(s) ignoré(s) : ODIO prend WAV, MP3, FLAC, M4A, OGG`, 5000);
      if (audio.length) app.importFiles(audio, { track: t?.id || null, at, perTrack: !t });
      return;
    }
    let d = null;
    try { d = JSON.parse(e.dataTransfer.getData('application/x-odio')); } catch { return; }
    app.dropItem(d, t?.id || null, at);
  }

  // ── l'ensemble ──
  const meters = [];
  function render() {
    const p = P();
    meters.length = 0;
    paintTools();
    body.style.setProperty('--nav-w', `${navW()}px`);
    body.classList.toggle('nav-off', ui().nav === false);
    browser.render();
    dock.el.hidden = ui().dock === false;
    dockSplit.hidden = ui().dock === false;
    dock.el.style.height = `${dockH()}px`;
    if (ui().dock !== false) dock.render();
    const Wd = width();
    grid.style.setProperty('--head', `${HEAD_W}px`);
    grid.style.setProperty('--ruler', `${RULER_H}px`);
    grid.style.width = `${HEAD_W + Wd}px`;
    const rows = [el('div', { class: 'ar-corner' }, el('span', { class: 'lbl' }, 'pistes'),
      el('span', { class: 'lbl' }, `${visTracks().length} · ${p.sections.length} sections`)), ruler()];
    const [ah, al] = arcRow();
    rows.push(ah, al);
    for (const L of (p.auto || []).filter((x) => !app.mod(x.mod)?.track)) rows.push(...autoRows(L));
    for (const t of visTracks()) {
      rows.push(head(t), lane(t));
      for (const L of lanesOf(t)) rows.push(...autoRows(L));
    }
    const dropHead = el('div', { class: 'ar-droph' }, el('span', { class: 'lbl' }, visTracks().length ? 'déposer ici : une piste neuve' : 'aucune piste'));
    const dropLane = el('div', { class: 'ar-dropz', style: { width: `${Wd}px` } },
      el('span', {}, 'glisser un instrument, un son de la bibliothèque ou des fichiers audio du disque · double-clic : une piste'));
    for (const n of [dropHead, dropLane]) {
      n.addEventListener('dragover', (e) => onDragOver(e, null));
      n.addEventListener('drop', (e) => onDrop(e, null));
    }
    dropLane.addEventListener('dblclick', (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(e.clientX, Math.min(e.clientY, r.bottom), app.trackChoices()); });
    rows.push(dropHead, dropLane);
    paintZone();
    put(grid, ...rows, zone, ph, recBox, marquee, dropLine);
    frame(app.pos());
  }

  function paintZone() {
    const p = P();
    zone.style.left = `${HEAD_W + X(p.loop.a)}px`;
    zone.style.width = `${X(p.loop.b - p.loop.a)}px`;
    zone.classList.toggle('on', !!p.loop.on);
  }

  function frame(beat) {
    const x = HEAD_W + X(beat);
    ph.style.transform = `translateX(${x}px)`;
    const tri = grid.querySelector('.ar-tri');
    if (tri) tri.style.transform = `translateX(${X(beat)}px)`;
    if (app.engine.running) {
      if (x > scroll.scrollLeft + scroll.clientWidth - 60 || x < scroll.scrollLeft + HEAD_W) scroll.scrollLeft = x - HEAD_W - 60;
    }
    for (const [id, mt] of meters) {
      const db = app.engine.level(id);
      mt.firstChild.style.width = `${Math.max(0, Math.min(100, (db + 60) / 66 * 100)).toFixed(1)}%`;
      mt.classList.toggle('hot', db > -1);
    }
    // la prise en cours
    const R = app.rec?.live?.();
    if (R) {
      const row = grid.querySelector(`.ar-lane[data-track="${R.track}"]`);
      if (row) {
        recBox.style.display = 'block';
        recBox.style.left = `${HEAD_W + X(R.a)}px`;
        recBox.style.top = `${row.offsetTop + 3}px`;
        recBox.style.height = `${row.offsetHeight - 6}px`;
        recBox.style.width = `${Math.max(2, X(Math.max(0, R.b - R.a)))}px`;
        recBox.firstChild.textContent = `prise · ${R.n} note${R.n > 1 ? 's' : ''}`;
      }
    } else recBox.style.display = 'none';
    dock.frame(beat);
  }

  // Les raccourcis de l'arrangement, ceux de Live 12 (guide.js les liste,
  // avec leur source). Les lettres seules ne passent ici que si le clavier
  // MIDI de l'ordinateur est éteint (M), comme dans Live.
  // le clavier va là où l'on a cliqué en dernier : la vue de détail ou l'arrangement
  let focusZone = 'arr';
  dock.el.addEventListener('pointerdown', () => { focusZone = 'dock'; }, true);
  scroll.addEventListener('pointerdown', () => { focusZone = 'arr'; }, true);
  function key(e) {
    if (focusZone === 'dock' && ui().dock !== false && dock.key?.(e)) return true;
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    const has = (S.sel.clips || []).length > 0;
    if ((k === 'Delete' || k === 'Backspace') && !ctrl && has) { e.preventDefault(); app.removeSel(); return true; }
    if (ctrl && !e.shiftKey && e.code === 'KeyD') { e.preventDefault(); app.duplicateSel(); return true; }
    if (ctrl && e.code === 'KeyC') { e.preventDefault(); app.copySel(); return true; }
    if (ctrl && e.code === 'KeyX') { e.preventDefault(); app.cutSel(); return true; }
    if (ctrl && e.code === 'KeyV') { e.preventDefault(); app.paste(); return true; }
    if (ctrl && e.code === 'KeyE') { e.preventDefault(); app.splitAtPlayhead(); return true; }
    if (ctrl && !e.shiftKey && e.code === 'KeyJ') { e.preventDefault(); app.consolidateSel(); return true; }
    if (ctrl && !e.shiftKey && e.code === 'KeyL') { e.preventDefault(); app.loopSelection(); return true; }
    if (ctrl && e.code === 'KeyA') { e.preventDefault(); app.selectClips(P().clips.map((c) => c.id)); return true; }
    if (ctrl && e.code === 'KeyR') { e.preventDefault(); renameSelected(); return true; }
    if (ctrl && e.code === 'Digit1') { e.preventDefault(); stepGrid(-1); return true; }
    if (ctrl && e.code === 'Digit2') { e.preventDefault(); stepGrid(1); return true; }
    if (ctrl && e.code === 'Digit4') { e.preventDefault(); ui().snap = (ui().snap ?? 1) ? 0 : 1; app.saveUi(); paintTools(); toast(ui().snap ? 'aimant : 1/4' : 'aimant : libre'); return true; }
    if (ctrl) return false;
    if (e.altKey && (k === '+' || k === '=' || e.code === 'NumpadAdd')) { e.preventDefault(); ui().th = clamp(th() + 12, 48, 180); app.saveUi(); render(); return true; }
    if (e.altKey && (k === '-' || e.code === 'NumpadSubtract')) { e.preventDefault(); ui().th = clamp(th() - 12, 48, 180); app.saveUi(); render(); return true; }
    if (e.altKey) return false;
    if (k === '+' || k === '=' || e.code === 'NumpadAdd') { e.preventDefault(); setZoom(ppb() * 1.25); return true; }
    if (k === '-' || e.code === 'NumpadSubtract') { e.preventDefault(); setZoom(ppb() / 1.25); return true; }
    if (e.code === 'Digit0' || e.code === 'Numpad0') { if (has) { e.preventDefault(); app.muteSel(); } return true; }
    if (k === 'Escape') { app.selectClips([]); return true; }
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && has) {
      e.preventDefault();
      const d = (k === 'ArrowLeft' ? -1 : 1) * (snapU() || 0.25);
      const g = P().clips.filter((c) => sel().has(c.id));
      if (g.every((c) => c.start + d >= 0)) { for (const c of g) c.start += d; app.commit('data'); }
      return true;
    }
    if (e.code === 'KeyR' && has) { app.reverseSel(); return true; }
    if (app.kbdOn()) return false;                     // le clavier MIDI prend les lettres
    if (e.code === 'KeyZ') { zoomToSelection(); return true; }
    if (e.code === 'KeyX') { zoomOut(); return true; }
    if (e.code === 'KeyW') { fit(); return true; }
    if (e.code === 'KeyH') { fitHeight(); return true; }
    return false;
  }
  function stepGrid(d) {
    const list = SNAPS.map(([v]) => v).filter((v) => v !== 0);
    const i = Math.max(0, list.findIndex((v) => String(v) === String(ui().snap ?? 1)));
    ui().snap = list[clamp(i + d, 0, list.length - 1)];
    app.saveUi(); paintTools();
    toast(`aimant : ${SNAPS.find(([v]) => String(v) === String(ui().snap))?.[1]}`, 1200);
  }
  // Ctrl+R (Live : « Rename ») : le clip choisi, sinon la piste choisie
  function renameSelected() {
    const c = app.clip(S.sel.clip);
    if (c) { const b = grid.querySelector(`.clip[data-id="${c.id}"] .t`); if (b) renameClip(c, b, c.name || b.textContent); return; }
    const t = app.track(S.sel.track);
    const n = t && grid.querySelector(`.ar-head[data-track="${t.id}"] .nm`);
    if (n) renameTrack(t, n);
  }

  // la molette (Live 12, « Arrangement View ») : Ctrl = zoom horizontal
  // ancré au curseur, Maj = défiler à l'horizontale, Alt sur une piste = sa
  // hauteur ; seule, elle défile à la verticale
  scroll.addEventListener('wheel', (e) => {
    if (e.altKey) {
      e.preventDefault();
      ui().th = clamp(th() + (e.deltaY < 0 ? 12 : -12), 48, 180); app.saveUi(); render(); return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const mx = e.clientX - scroll.getBoundingClientRect().left;
      zoomAround(ppb() * Math.pow(0.9985, e.deltaY), mx);
    } else if (e.shiftKey) { e.preventDefault(); scroll.scrollLeft += e.deltaY || e.deltaX; }
  }, { passive: false });
  // Ctrl+Alt+glisser : déplacer la vue (Live)
  scroll.addEventListener('pointerdown', (e) => {
    if (!(e.ctrlKey && e.altKey) || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY, l0 = scroll.scrollLeft, t0 = scroll.scrollTop;
    const mv = (ev) => { scroll.scrollLeft = l0 - (ev.clientX - x0); scroll.scrollTop = t0 - (ev.clientY - y0); };
    const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  }, true);
  document.addEventListener('mu:buffer', () => { if (S.view === 'timeline') render(); });
  // les fichiers lâchés à côté des voies (sur la règle, les en-têtes vides)
  scroll.addEventListener('dragover', (e) => onDragOver(e, null));
  scroll.addEventListener('drop', (e) => onDrop(e, null));

  return { el: root, render, frame, key, paintTools, paintSel, fit, dock };
}
