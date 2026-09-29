// MONTAGE — la timeline : les pistes, les plans, la règle, la tête de
// lecture, et les gestes (choisir, déplacer, rogner, couper, poser).
//
// Tout geste passe par `app.commit(nom, p => …)` : une seule entrée
// d'annulation par geste, un seul enregistrement. Pendant un glisser, on
// ne touche que l'affichage ; le projet change au lâcher.
// Zoom : alt + molette (ou ctrl + molette), ancré sous le pointeur — comme
// la timeline des voix du Studio de Movie Analysis (voix.js, vxZoome).

import { el, href, ITEM_MIME } from '../commun/shell.js';
import * as M from './model.js';

export const HEAD = 124;           // la tête de piste, collée à gauche (même largeur que .tl-hd)
const MIN_PPS = 0.5, MAX_PPS = 800;
const SNAP_PX = 8;
// un clic dans la timeline rend le clavier aux raccourcis (un curseur de
// l'inspecteur garderait sinon espace et les flèches)
const blurField = () => { const a = document.activeElement; if (a && a !== document.body && a.matches && a.matches('input, select, textarea, button')) a.blur(); };

const ICON = {
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.1 6.9C3.6 8.6 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 4.2-1"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  unlock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>',
};

export class Timeline {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.pps = 40;
    this.scroll = el('div', { class: 'tl-scroll' });
    this.marks = el('div', { class: 'tl-marks' });
    this.ruler = el('div', { class: 'tl-ruler' }, el('div', { class: 'tl-hd' }, el('span', { class: 'lbl' }, 'pistes')), this.marks);
    this.lanes = el('div', { class: 'tl-lanes' });
    this.ph = el('div', { class: 'tl-ph' }, el('i'));
    this.snapLine = el('div', { class: 'tl-snap', hidden: true });
    this.ghost = el('div', { class: 'tl-ghost', hidden: true });
    this.tip = el('div', { class: 'tl-tip', hidden: true });
    this.inner = el('div', { class: 'tl-inner' }, this.ruler, this.lanes, this.ph, this.snapLine);
    this.scroll.append(this.inner);
    root.append(this.scroll, this.tip);
    this.bind();
  }

  get p() { return this.app.p(); }
  get fps() { return this.p.settings.fps; }
  fx(frames) { return frames / this.fps * this.pps; }
  // l'image sous un point de l'écran (arrondie à l'image la plus proche)
  frameAt(clientX, exact = false) {
    const r = this.scroll.getBoundingClientRect();
    const f = (clientX - r.left - HEAD + this.scroll.scrollLeft) / this.pps * this.fps;
    return exact ? Math.max(0, f) : Math.max(0, Math.round(f));
  }
  tol() { return SNAP_PX / this.pps * this.fps; }

  // ── dessin ───────────────────────────────────────────────
  render() {
    const p = this.p;
    if (!p) return;
    const fps = this.fps;
    const end = Math.max(M.projectEnd(p), this.app.playhead());
    const vis = Math.max(200, this.scroll.clientWidth - HEAD);
    this.width = Math.max(vis, this.fx(end + 20 * fps));
    this.inner.style.width = HEAD + this.width + 'px';
    const win = M.windows(p);
    const sel = this.app.sel();
    const gap = this.app.gap();
    const tgt = this.app.targets();
    const lanes = p.tracks.map((t) => {
      const clips = M.trackClips(p, t.id).map((c) => this.clipNode(c, win.get(c.id), sel.has(c.id), t));
      if (gap && gap.track === t.id) clips.push(el('div', { class: 'gap', style: { left: this.fx(gap.s) + 'px', width: this.fx(gap.e - gap.s) + 'px' } }));
      return el('div', { class: `tl-lane ${t.kind}${t.lock ? ' lock' : ''}${t.hide ? ' hide' : ''}${t.mute ? ' mute' : ''}`, 'data-track': t.id },
        this.head(t, tgt[t.kind] === t.id),
        el('div', { class: 'tl-area', style: { width: this.width + 'px' } }, ...clips));
    });
    this.lanes.replaceChildren(...lanes, this.ghost);
    this.paintRuler();
    this.paintPlayhead(this.app.playhead());
  }

  head(t, isTarget) {
    const act = (k, label) => (e) => { e.stopPropagation(); this.app.toggleTrack(t.id, k, label); };
    return el('div', { class: 'tl-hd' },
      el('button', { class: 'tn' + (isTarget ? ' tgt' : ''), title: isTarget ? 'piste cible (Insérer, Écraser, flèche du chutier)' : 'en faire la piste cible', onclick: (e) => { e.stopPropagation(); this.app.setTarget(t); } }, t.id),
      t.kind === 'video' ? el('button', { class: 'tg' + (t.hide ? ' on' : ''), title: t.hide ? 'piste masquée (ni vue, ni exportée) — la montrer' : 'masquer l’image de cette piste', html: t.hide ? ICON.eyeOff : ICON.eye, onclick: act('hide', 'masquer une piste') }) : null,
      el('button', { class: 'tg m' + (t.mute ? ' on' : ''), title: t.mute ? 'muette (ni entendue, ni exportée) — rendre le son' : 'couper le son de cette piste', onclick: act('mute', 'couper une piste') }, 'M'),
      el('button', { class: 'tg s' + (t.solo ? ' on' : ''), title: t.solo ? 'solo : on n’entend que les pistes en solo' : 'n’entendre que cette piste (solo)', onclick: act('solo', 'solo') }, 'S'),
      el('button', { class: 'tg l' + (t.lock ? ' on' : ''), title: t.lock ? 'verrouillée : rien n’y bouge — déverrouiller' : 'verrouiller la piste', html: t.lock ? ICON.lock : ICON.unlock, onclick: act('lock', 'verrouiller une piste') }));
  }

  clipNode(c, w, selected, t) {
    const it = this.app.item(c.item);
    const fps = this.fps;
    const x = this.fx(c.start), wpx = Math.max(3, this.fx(c.dur));
    const body = el('div', { class: 'body' });
    if (t.kind === 'video' && it && it.thumb_url) body.style.backgroundImage = `url("${href(it.thumb_url)}")`;
    const hasSound = t.kind === 'audio' || (c.kind === 'video' && c.audio);
    if (t.kind === 'audio' && it && (it.kind === 'audio' || it.audio)) {
      const wave = el('i', { class: 'wave' });
      const u = `url("${href('api/montage/wave/' + it.id)}")`;
      const full = (c.src_dur || it.duration || c.dur / fps) * this.pps;
      Object.assign(wave.style, { maskImage: u, webkitMaskImage: u, maskSize: `${full}px 100%`, webkitMaskSize: `${full}px 100%`,
        maskPosition: `${-(c.in || 0) * this.pps}px 0`, webkitMaskPosition: `${-(c.in || 0) * this.pps}px 0` });
      body.append(wave);
    }
    const fin = w ? (w.fin || 0) : 0, fout = w ? (w.fout || 0) : 0;
    if (fin) body.append(el('i', { class: 'fi', style: { width: this.fx(fin) + 'px' } }));
    if (fout) body.append(el('i', { class: 'fo', style: { width: this.fx(fout) + 'px' } }));
    const badges = [];
    if (c.kind === 'video' && t.kind === 'video' && c.audio) badges.push('son');
    if (c.vol !== undefined && Math.abs(c.vol - 1) > 0.005 && hasSound) badges.push(`${Math.round(c.vol * 100)} %`);
    const g = c.grade || M.NEUTRAL;
    if (g.exposure || g.contrast || g.saturation || (g.temperature && g.temperature !== 6500)) badges.push('étal.');
    body.append(el('span', { class: 'nm' }, c.title || (it ? it.title : c.item)));
    if (badges.length) body.append(el('span', { class: 'bd' }, badges.join(' · ')));
    const node = el('div', {
      class: `clip ${c.kind}${t.kind === 'audio' ? ' snd' : ''}${selected ? ' sel' : ''}${it && !it.missing ? '' : ' miss'}`,
      'data-id': c.id,
      title: `${c.title || ''}\n${M.tc(c.start, fps)} → ${M.tc(M.clipEnd(c), fps)} · ${M.short(c.dur / fps)}${it && it.missing ? '\nobjet introuvable dans la bibliothèque (à la corbeille ?)' : ''}`,
      style: { left: x + 'px', width: wpx + 'px' },
    }, body);
    if (w && w.xin) {
      const h1 = w.xin >> 1;
      node.append(el('i', { class: 'xf', title: `fondu enchaîné · ${w.xin} images`, style: { left: -this.fx(h1) + 'px', width: this.fx(w.xin) + 'px' } }));
    } else if (c.xfade > 0) {
      node.append(el('i', { class: 'xf off', title: 'fondu enchaîné sans effet : aucun plan ne touche celui-ci à gauche', style: { left: '0px', width: this.fx(Math.min(c.xfade, c.dur)) + 'px' } }));
    }
    node.append(el('i', { class: 'h l', title: 'rogner le début' }), el('i', { class: 'h r', title: 'rogner la fin' }));
    return node;
  }

  paintRuler() {
    const fps = this.fps, pps = this.pps;
    const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
    const step = steps.find((s) => s * pps >= 84) || 1800;
    const left = this.scroll.scrollLeft, right = left + this.scroll.clientWidth;
    const from = Math.max(0, Math.floor(left / pps / step) - 1), to = Math.ceil(right / pps / step) + 1;
    const out = [];
    for (let i = from; i <= to; i++) {
      const s = i * step;
      const f = Math.round(s * fps);
      const lab = step < 1 ? M.tc(f, fps).slice(3) : M.tc(f, fps).slice(s >= 3600 ? 0 : 3, s >= 3600 ? 8 : 8);
      out.push(el('span', { class: 'mk', style: { left: s * pps + 'px' } }, lab));
      if (step >= 1 && step * pps >= 160) out.push(el('span', { class: 'mk sub', style: { left: (s + step / 2) * pps + 'px' } }));
    }
    this.marks.replaceChildren(...out);
    this.marks.style.width = this.width + 'px';
  }

  paintPlayhead(frame) {
    const x = this.fx(frame);
    this.phX = x;
    this.ph.style.transform = `translateX(${HEAD + x}px)`;
    // sous les têtes de piste (défilement), la tête de lecture ne se dessine pas par-dessus
    this.ph.style.visibility = x < this.scroll.scrollLeft - 1 ? 'hidden' : 'visible';
    if (this.app.playing()) {
      const left = this.scroll.scrollLeft, w = this.scroll.clientWidth - HEAD;
      if (x > left + w - 30 || x < left) this.scroll.scrollLeft = Math.max(0, x - 60);
    }
  }

  // ── zoom ─────────────────────────────────────────────────
  setPps(pps, anchorClientX) {
    const r = this.scroll.getBoundingClientRect();
    const ax = anchorClientX ?? (r.left + HEAD + this.fx(this.app.playhead()) - this.scroll.scrollLeft);
    const f = this.frameAt(ax, true);
    this.pps = Math.max(MIN_PPS, Math.min(MAX_PPS, pps));
    this.render();
    this.scroll.scrollLeft = Math.max(0, this.fx(f) - (ax - r.left - HEAD));
    this.paintRuler();
    this.app.zoomed(this.pps);
  }
  zoom(factor, anchorClientX) { this.setPps(this.pps * factor, anchorClientX); }
  fit() {
    const end = M.projectEnd(this.p) || 10 * this.fps;
    const w = Math.max(200, this.scroll.clientWidth - HEAD - 40);
    this.pps = Math.max(MIN_PPS, Math.min(MAX_PPS, w / (end / this.fps)));
    this.render();
    this.scroll.scrollLeft = 0;
    this.paintRuler();
    this.app.zoomed(this.pps);
  }

  // ── gestes ───────────────────────────────────────────────
  bind() {
    this.scroll.addEventListener('scroll', () => {
      this.paintRuler();
      if (this.phX !== undefined) this.ph.style.visibility = this.phX < this.scroll.scrollLeft - 1 ? 'hidden' : 'visible';
    });
    this.scroll.addEventListener('wheel', (e) => {
      if (e.altKey || e.ctrlKey) {
        e.preventDefault();
        this.zoom(e.deltaY < 0 ? 1.25 : 0.8, e.clientX);
      } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && this.scroll.scrollHeight <= this.scroll.clientHeight + 2) {
        e.preventDefault();
        this.scroll.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    // la règle : cliquer, glisser = la tête de lecture
    this.ruler.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      blurField();
      this.app.focus('program');
      const go = (ev) => this.app.seekFrame(this.frameAt(ev.clientX));
      go(e);
      this.drag(e, go, () => {});
    });

    this.lanes.addEventListener('pointerdown', (e) => this.down(e));
    this.lanes.addEventListener('dblclick', (e) => {
      const n = e.target.closest('.clip');
      if (n) this.app.openClipInSource(n.dataset.id);
    });

    // poser depuis le chutier ou la source (glisser-déposer HTML, MDN) ou des fichiers du disque
    this.lanes.addEventListener('dragover', (e) => {
      const types = [...(e.dataTransfer?.types || [])];
      if (!types.includes(ITEM_MIME) && !types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const lane = e.target.closest('.tl-lane');
      if (!lane) return;
      const d = this.app.dragging();
      const frames = d ? d.frames : 5 * this.fps;
      let f = this.frameAt(e.clientX);
      if (this.app.snap()) {
        const sd = M.snapDelta([f, f + frames], M.snapPoints(this.p, new Set(), [this.app.playhead()]), this.tol());
        if (sd !== null) f += sd;
      }
      f = Math.max(0, f);
      const track = this.app.trackFor(lane.dataset.track, d ? d.kind : null);
      const target = this.lanes.querySelector(`.tl-lane[data-track="${track}"] .tl-area`);
      if (target && this.ghost.parentNode !== target) target.append(this.ghost);
      Object.assign(this.ghost.style, { left: this.fx(f) + 'px', width: Math.max(3, this.fx(frames)) + 'px' });
      this.ghost.hidden = false;
      this.ghost.textContent = (e.ctrlKey || e.metaKey) ? 'insérer' : 'écraser';
      this.dropAt = { track, frame: f };
    });
    this.lanes.addEventListener('dragleave', (e) => { if (!this.lanes.contains(e.relatedTarget)) this.ghost.hidden = true; });
    this.lanes.addEventListener('drop', (e) => {
      const lane = e.target.closest('.tl-lane');
      this.ghost.hidden = true;
      if (!lane || !this.dropAt) return;
      e.preventDefault();
      e.stopPropagation();
      const { track, frame } = this.dropAt;
      this.dropAt = null;
      const mode = (e.ctrlKey || e.metaKey) ? 'insert' : 'overwrite';
      if (e.dataTransfer.files && e.dataTransfer.files.length) { this.app.dropFiles([...e.dataTransfer.files], track, frame, mode); return; }
      // une vignette de ce chutier, de la source, d'une autre page ou du sélecteur (dragItem du socle)
      const raw = e.dataTransfer.getData(ITEM_MIME);
      if (!raw) return;
      try { this.app.placeItem(JSON.parse(raw), track, frame, mode); } catch { /* */ }
    });
  }

  drag(e, move, up) {
    const tgt = e.currentTarget || e.target;
    try { tgt.setPointerCapture(e.pointerId); } catch { /* */ }
    const mv = (ev) => move(ev);
    const done = (ev) => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
      this.snapLine.hidden = true;
      this.tip.hidden = true;
      up(ev);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);
  }

  showSnap(frame) {
    if (frame === null || frame === undefined) { this.snapLine.hidden = true; return; }
    this.snapLine.hidden = false;
    this.snapLine.style.transform = `translateX(${HEAD + this.fx(frame)}px)`;
  }

  showTip(ev, text) {
    this.tip.hidden = false;
    this.tip.textContent = text;
    const r = this.root.getBoundingClientRect();
    this.tip.style.left = (ev.clientX - r.left + 12) + 'px';
    this.tip.style.top = (ev.clientY - r.top - 30) + 'px';
  }

  down(e) {
    if (e.button !== 0 || e.target.closest('.tl-hd')) return;
    const lane = e.target.closest('.tl-lane');
    if (!lane) return;
    blurField();
    this.app.focus('program');
    const p = this.p, fps = this.fps;
    const node = e.target.closest('.clip');
    const track = p.tracks.find((t) => t.id === lane.dataset.track);
    if (!node) {
      this.app.select(new Set(), M.gapAt(p, track.id, this.frameAt(e.clientX)));
      return;
    }
    const id = node.dataset.id;
    const c = M.byId(p, id);
    if (!c) return;
    e.preventDefault();
    if (this.app.tool() === 'blade') {
      let f = this.frameAt(e.clientX);
      const ph = this.app.playhead();
      if (Math.abs(ph - f) <= this.tol()) f = ph;
      this.app.cut(f, e.shiftKey ? null : id);
      return;
    }
    const sel = new Set(this.app.sel());
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      sel.has(id) ? sel.delete(id) : sel.add(id);
      this.app.select(sel);
      return;
    }
    if (!sel.has(id)) { sel.clear(); sel.add(id); this.app.select(sel); }
    if (track.lock) return;
    const handle = e.target.closest('.h');
    if (handle) return this.trim(e, c, handle.classList.contains('l') ? 'l' : 'r', node);
    this.move(e, sel);
  }

  trim(e, c, side, node) {
    const p = this.p, fps = this.fps;
    const [lo, hi] = M.trimLimits(p, c, side);
    const pts = M.snapPoints(p, new Set([c.id]), [this.app.playhead()]);
    const x0 = e.clientX;
    let d = 0;
    const edge0 = side === 'l' ? c.start : M.clipEnd(c);
    this.drag(e, (ev) => {
      d = Math.round((ev.clientX - x0) / this.pps * fps);
      let snapped = null;
      if (this.app.snap()) {
        const sd = M.snapDelta([edge0 + d], pts, this.tol());
        if (sd !== null) { d += sd; snapped = edge0 + d; }
      }
      d = Math.max(lo, Math.min(hi, d));
      this.showSnap(snapped !== null && edge0 + d === snapped ? snapped : null);
      const s = side === 'l' ? c.start + d : c.start, dur = side === 'l' ? c.dur - d : c.dur + d;
      node.style.left = this.fx(s) + 'px';
      node.style.width = Math.max(3, this.fx(dur)) + 'px';
      this.showTip(ev, `${side === 'l' ? 'début' : 'fin'} ${M.tc(side === 'l' ? s : s + dur, fps)} · durée ${M.short(dur / fps)}`);
    }, () => {
      if (d) this.app.commit('rogner', (q) => M.trimClip(M.byId(q, c.id), side, d, fps));
      else this.render();
    });
  }

  move(e, sel) {
    const p = this.p, fps = this.fps;
    const locked = new Set(p.tracks.filter((t) => t.lock).map((t) => t.id));
    const ids = new Set([...sel].filter((id) => { const c = M.byId(p, id); return c && !locked.has(c.track); }));
    const clips = [...ids].map((id) => M.byId(p, id));
    if (!clips.length) return;
    const nodes = new Map(clips.map((c) => [c.id, this.lanes.querySelector(`.clip[data-id="${c.id}"]`)]));
    const order = { video: p.tracks.filter((t) => t.kind === 'video').map((t) => t.id), audio: p.tracks.filter((t) => t.kind === 'audio').map((t) => t.id) };
    const startLane = e.target.closest('.tl-lane').dataset.track;
    const minStart = Math.min(...clips.map((c) => c.start));
    const pts = M.snapPoints(p, ids, [this.app.playhead()]);
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false, df = 0, dt = 0;
    this.drag(e, (ev) => {
      if (!moved && Math.abs(ev.clientX - x0) < 4 && Math.abs(ev.clientY - y0) < 4) return;
      moved = true;
      df = Math.round((ev.clientX - x0) / this.pps * fps);
      let snapped = null;
      if (this.app.snap()) {
        const edges = clips.flatMap((c) => [c.start + df, M.clipEnd(c) + df]);
        const sd = M.snapDelta(edges, pts, this.tol());
        if (sd !== null) {
          df += sd;
          snapped = edges.map((x) => x + sd).find((x) => pts.includes(x));
        }
      }
      df = Math.max(-minStart, df);
      // la piste sous le pointeur, dans la même famille (vidéo / son)
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tl-lane');
      if (over) {
        const k = M.trackKind(startLane);
        if (M.trackKind(over.dataset.track) === k) {
          const cand = order[k].indexOf(over.dataset.track) - order[k].indexOf(startLane);
          const okAll = clips.every((c) => {
            const list = order[M.trackKind(c.track)];
            const j = list.indexOf(c.track) + cand;
            return j >= 0 && j < list.length && !locked.has(list[j]) && M.accepts(list[j], c.kind);
          });
          if (okAll) dt = cand;
        }
      }
      this.showSnap(snapped ?? null);
      for (const c of clips) {
        const n = nodes.get(c.id);
        if (!n) continue;
        const list = order[M.trackKind(c.track)];
        const dest = list[list.indexOf(c.track) + dt];
        const area = this.lanes.querySelector(`.tl-lane[data-track="${dest}"] .tl-area`);
        if (area && n.parentNode !== area) area.append(n);
        n.style.left = this.fx(c.start + df) + 'px';
        n.classList.add('moving');
      }
      this.showTip(ev, `${df >= 0 ? '+' : '−'}${M.short(Math.abs(df) / fps)} · ${M.tc(minStart + df, fps)}${dt ? ` · ${dt > 0 ? '↓' : '↑'} ${Math.abs(dt)} piste` : ''}`);
    }, (ev) => {
      if (!moved || (!df && !dt)) { if (moved) this.render(); return; }
      const mode = ev && (ev.ctrlKey || ev.metaKey) ? 'insert' : 'overwrite';
      this.app.commit('déplacer', (q) => {
        const moving = [...ids].map((id) => ({ ...M.byId(q, id) }));
        q.clips = q.clips.filter((c) => !ids.has(c.id));
        for (const c of moving) {
          const list = order[M.trackKind(c.track)];
          c.track = list[list.indexOf(c.track) + dt];
          c.start = Math.max(0, c.start + df);
        }
        moving.sort((a, b) => a.start - b.start);
        for (const c of moving) M.placeClip(q, c, mode);
      });
    });
  }
}
