// MONTAGE — la timeline : les pistes, les plans, la règle (marques, entrée et
// sortie de séquence), la tête de lecture, et les gestes des outils de
// Premiere Pro (noms et raccourcis : doc Adobe, voir docs/etudes/montage.md) :
//
//   Sélection (V)            déplacer, rogner les bords (maj/ctrl : ajouter à la sélection ; alt : copier)
//   Sélection de piste (A)   le plan et tout ce qui suit sur sa piste (maj : toutes les pistes), puis glisser
//   Propagation (B)          rogner un bord en poussant ou tirant la suite de la piste
//   Déplacement de la coupe (N)  bouger la coupe entre deux plans collés
//   Modification de la vitesse (R)  tirer un bord change la vitesse, pas la matière
//   Cutter (C)               couper où l'on clique (maj : toutes les pistes)
//   Déplacer dessous (Y)     « slip » : le contenu glisse dans le plan, place et durée fixes
//   Déplacer le plan (U)     « slide » : le plan glisse entre ses voisins, qui s'ajustent
//   Main (H), Zoom (Z ; alt : dézoomer)
//
// Tout geste passe par `app.commit(nom, p => …)` (une entrée d'annulation)
// ou, pour ceux qui se voient en direct dans le programme (propagation,
// coupe, vitesse, slip, slide), par `app.gesture` : chaque mouvement repart
// du projet d'avant le geste et rejoue l'opération du modèle avec le
// décalage du moment ; le lâcher fait une seule entrée d'annulation.
// molette commune (commun/molette.js) : seule, défiler haut / bas ; Maj : le temps ; Alt : zoom sous le pointeur ; Ctrl : hauteur des pistes, sur un en-tête (à gauche) : la sienne

import { el, href, ITEM_MIME } from '../commun/shell.js';
import { brancher, borne, tenirY } from '../commun/molette.js';   // molette commune
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
    this.h = {};                   // molette commune : id de piste → hauteur (px), le temps de la page ; absente : celle de montage.css
    this.scroll = el('div', { class: 'tl-scroll' });
    this.ticks = el('div', { class: 'tl-ticks' });
    this.mlayer = el('div', { class: 'tl-mlayer' });
    this.marks = el('div', { class: 'tl-marks' }, this.ticks, this.mlayer);
    this.ruler = el('div', { class: 'tl-ruler' }, el('div', { class: 'tl-hd' }, el('span', { class: 'lbl' }, 'pistes')), this.marks);
    this.lanes = el('div', { class: 'tl-lanes' });
    this.ph = el('div', { class: 'tl-ph' }, el('i'));
    this.snapLine = el('div', { class: 'tl-snap', hidden: true });
    this.rngv = el('div', { class: 'tl-rngv', hidden: true });
    this.ghost = el('div', { class: 'tl-ghost', hidden: true });
    this.tip = el('div', { class: 'tl-tip', hidden: true });
    this.inner = el('div', { class: 'tl-inner' }, this.ruler, this.lanes, this.rngv, this.ph, this.snapLine);
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
    const end = Math.max(M.projectEnd(p), this.app.playhead(), ...(p.markers || []).map((m) => m.f), (p.range && p.range.out) || 0);
    const vis = Math.max(200, this.scroll.clientWidth - HEAD);
    this.width = Math.max(vis, this.fx(end + 20 * fps));
    this.inner.style.width = HEAD + this.width + 'px';
    const win = M.windows(p);
    const sel = this.app.sel();
    const gap = this.app.gap();
    const tgt = this.app.targets();
    const selT = this.app.selTrack ? this.app.selTrack() : null;
    // au-dessus des membres d'un groupe, son en-tête (glisser : le déplacer entier)
    const rows = [], seen = new Set();
    p.tracks.forEach((t, i) => {
      if (t.grp && !seen.has(t.grp)) {
        seen.add(t.grp);
        const g = M.groupOf(p, t.grp);
        if (g) rows.push(this.groupRow(g, p.tracks.filter((x) => x.grp === g.id), selT === 'g:' + g.id));
      }
      const clips = M.trackClips(p, t.id).map((c) => this.clipNode(c, win.get(c.id), sel.has(c.id), t));
      if (gap && gap.track === t.id) clips.push(el('div', { class: 'gap', style: { left: this.fx(gap.s) + 'px', width: this.fx(gap.e - gap.s) + 'px' } }));
      const last = t.grp && (!p.tracks[i + 1] || p.tracks[i + 1].grp !== t.grp);
      rows.push(el('div', { class: `tl-lane ${t.kind}${t.lock ? ' lock' : ''}${t.hide ? ' hide' : ''}${t.mute ? ' mute' : ''}${t.grp ? ' ingrp' : ''}${last ? ' grplast' : ''}`, 'data-track': t.id, style: this.h[t.id] ? { height: this.h[t.id] + 'px' } : null },   // molette commune
        this.headFor(t, tgt[t.kind] === t.id, selT === t.id),
        el('div', { class: 'tl-area', style: { width: this.width + 'px' } }, ...clips)));
    });
    this.lanes.replaceChildren(...rows, this.ghost);
    this.root.dataset.tool = this.app.tool();
    this.paintRuler();
    this.paintMarks();
    this.paintPlayhead(this.app.playhead());
  }

  // plus de séquence ouverte : une timeline vide qui dit quoi faire
  clear() {
    this.lanes.replaceChildren(el('p', { class: 'tl-none' }, 'aucune séquence ouverte'));
    this.ticks.replaceChildren();
    this.mlayer.replaceChildren();
    this.rngv.hidden = true;
    this.ph.style.visibility = 'hidden';
  }

  head(t, isTarget) {
    const act = (k, label) => (e) => { e.stopPropagation(); this.app.toggleTrack(t.id, k, label); };
    return el('div', { class: 'tl-hd', 'data-head': t.id, 'data-piste': t.id, title: `${t.id}${t.name ? ' · ' + t.name : ''} — clic droit : ajouter, renommer, supprimer la piste… · ctrl + molette : sa hauteur` },   // molette commune : data-piste, l'infobulle
      el('div', { class: 'hr' },
        el('button', { class: 'tn' + (isTarget ? ' tgt' : ''), title: isTarget ? 'piste cible (Insérer, Écraser, Coller)' : 'en faire la piste cible', onclick: (e) => { e.stopPropagation(); this.app.setTarget(t); } }, t.id),
        t.kind === 'video' ? el('button', { class: 'tg' + (t.hide ? ' on' : ''), title: t.hide ? 'piste masquée (ni vue, ni exportée) — la montrer' : 'masquer l’image de cette piste', html: t.hide ? ICON.eyeOff : ICON.eye, onclick: act('hide', 'masquer une piste') }) : null,
        el('button', { class: 'tg m' + (t.mute ? ' on' : ''), title: t.mute ? 'muette (ni entendue, ni exportée) — rendre le son' : 'couper le son de cette piste', onclick: act('mute', 'couper une piste') }, 'M'),
        el('button', { class: 'tg s' + (t.solo ? ' on' : ''), title: t.solo ? 'solo : on n’entend que les pistes en solo' : 'n’entendre que cette piste (solo)', onclick: act('solo', 'solo') }, 'S'),
        el('button', { class: 'tg l' + (t.lock ? ' on' : ''), title: t.lock ? 'verrouillée : rien n’y bouge — déverrouiller' : 'verrouiller la piste', html: t.lock ? ICON.lock : ICON.unlock, onclick: act('lock', 'verrouiller une piste') })),
      el('span', { class: 'tnm', title: 'double-clic : renommer la piste' }, t.name || (t.kind === 'video' ? 'vidéo' : 'son')));
  }

  // l'en-tête d'une piste, retouché selon sa sorte : une piste de calques n'a
  // ni cible, ni muette, ni solo ; choisie (clic), elle s'éclaire ; ses effets s'y voient
  headFor(t, isTarget, selected) {
    const h = this.head(t, isTarget);
    if (selected) h.classList.add('sel');
    if (t.grp) h.classList.add('ingrp');
    if (t.kind === 'fx') {
      h.classList.add('fxh');
      for (const b of h.querySelectorAll('.tg.m, .tg.s')) b.remove();
      const tn = h.querySelector('.tn');
      tn.onclick = (e) => e.stopPropagation();
      tn.title = 'piste de calques d’effet';
      tn.after(el('button', { class: 'tg' + (t.hide ? ' on' : ''), title: t.hide ? 'calques coupés — les remettre' : 'couper ces calques', html: t.hide ? ICON.eyeOff : ICON.eye,
        onclick: (e) => { e.stopPropagation(); this.app.toggleTrack(t.id, 'hide', 'couper un calque'); } }));
      h.querySelector('.tnm').textContent = t.name || 'calque';
    }
    const n = (t.fx || []).filter((f) => f.on !== false).length;
    if (n) h.querySelector('.hr').append(el('i', { class: 'tfx', title: (t.fx || []).map((f) => this.app.fxName(f)).join(' · ') }, 'fx'));
    return h;
  }

  // l'en-tête d'un groupe de pistes : une ligne fine au-dessus de ses membres
  groupRow(g, members, selected) {
    const n = (g.fx || []).filter((f) => f.on !== false).length;
    return el('div', { class: 'tl-grp' + (selected ? ' sel' : ''), 'data-grp': g.id },
      el('div', { class: 'tl-hd grp', 'data-ghead': g.id, title: g.name },
        el('i', { class: 'gbar' }), el('span', { class: 'gnm' }, g.name), el('small', { class: 'num' }, String(members.length)),
        n ? el('i', { class: 'tfx', title: g.fx.map((f) => this.app.fxName(f)).join(' · ') }, 'fx') : null),
      el('div', { class: 'tl-area', style: { width: this.width + 'px' } }));
  }

  clipNode(c, w, selected, t) {
    if (c.kind === 'adjust') return this.fxClipNode(c, w, selected);
    const it = this.app.item(c.item);
    const fps = this.fps;
    const x = this.fx(c.start), wpx = Math.max(3, this.fx(c.dur));
    const body = el('div', { class: 'body' });
    if (t.kind === 'video' && it && it.thumb_url) body.style.backgroundImage = `url("${href(it.thumb_url)}")`;
    const hasSound = t.kind === 'audio' || (c.kind === 'video' && c.audio);
    if (t.kind === 'audio' && it && (it.kind === 'audio' || it.audio)) {
      const wave = el('i', { class: 'wave' });
      const u = `url("${href('api/montage/wave/' + it.id)}")`;
      const sp = M.spd(c);
      const full = (c.src_dur || it.duration || c.dur / fps * sp) / sp * this.pps;
      Object.assign(wave.style, { maskImage: u, webkitMaskImage: u, maskSize: `${full}px 100%`, webkitMaskSize: `${full}px 100%`,
        maskPosition: `${-(c.in || 0) / sp * this.pps}px 0`, webkitMaskPosition: `${-(c.in || 0) / sp * this.pps}px 0` });
      body.append(wave);
    }
    this.fadeMarks(body, w, t.kind === 'audio');
    const badges = [];
    if (!M.isOn(c)) badges.push('désactivé');
    if (c.kind === 'video' && t.kind === 'video' && c.audio) badges.push('son');
    if (Math.abs(M.spd(c) - 1) > 1e-6) badges.push(M.pct(M.spd(c)));
    if (c.vol !== undefined && Math.abs(c.vol - 1) > 0.005 && hasSound) badges.push(`vol ${Math.round(c.vol * 100)} %`);
    const fxs = M.fxOn(c.fx);
    if (fxs.length) badges.push(fxs.length > 1 ? `${fxs.length} effets` : this.app.fxName(fxs[0]));
    body.append(el('span', { class: 'nm' }, c.title || (it ? it.title : c.item)));
    if (badges.length) body.append(el('span', { class: 'bd' }, badges.join(' · ')));
    const node = el('div', {
      class: `clip ${c.kind}${t.kind === 'audio' ? ' snd' : ''}${selected ? ' sel' : ''}${it && !it.missing ? '' : ' miss'}${M.isOn(c) ? '' : ' off'}`,
      'data-id': c.id,
      title: `${c.title || ''}\n${M.tc(c.start, fps)} → ${M.tc(M.clipEnd(c), fps)} · ${M.short(c.dur / fps)}${it && it.missing ? '\nintrouvable dans la bibliothèque' : ''}`,
      style: { left: x + 'px', width: wpx + 'px' },
    }, body);
    const eb = this.app.elementBadge?.(c);      // éléments : la pastille de version (montage/elements.js, 30/09)
    if (eb) node.append(eb);
    if (w && w.xin) {
      const h1 = w.xin >> 1;
      node.append(el('i', { class: 'xf', title: `fondu enchaîné · ${w.xin} images`, style: { left: -this.fx(h1) + 'px', width: this.fx(w.xin) + 'px' } }));
    } else if (c.xfade > 0) {
      node.append(el('i', { class: 'xf off', title: 'fondu enchaîné sans effet : aucun plan actif ne touche celui-ci à gauche', style: { left: '0px', width: this.fx(Math.min(c.xfade, c.dur)) + 'px' } }));
    }
    node.append(el('i', { class: 'h l' }), el('i', { class: 'h r' }));
    this.fadeHandles(node, w);
    return node;
  }

  // Les fondus d'un plan : la courbe (le gain du son selon sa courbe, l'image
  // en ligne droite) et, au-dessus, la part assombrie.
  fadeMarks(body, w, sound) {
    if (!w) return;
    const ramp = (n, curve, side) => {
      const pts = [];
      for (let i = 0; i <= 24; i++) { const x = i / 24; pts.push(`${(x * 100).toFixed(2)},${(100 - 100 * (sound ? M.curveGain(curve, x) : x)).toFixed(2)}`); }
      const path = side === 'l' ? `M0,0 L${pts.join(' L')} L100,0 Z` : `M100,0 L${pts.map((q) => q.split(',')).map(([a, b]) => `${(100 - a).toFixed(2)},${b}`).join(' L')} L0,0 Z`;
      const line = side === 'l' ? `M${pts.join(' L')}` : `M${pts.map((q) => q.split(',')).map(([a, b]) => `${(100 - a).toFixed(2)},${b}`).join(' L')}`;
      const s = el('i', { class: 'fade ' + side, style: { width: this.fx(n) + 'px' },
        html: `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path class="sh" d="${path}"/><path class="ln" d="${line}" vector-effect="non-scaling-stroke"/></svg>` });
      body.append(s);
    };
    if (w.fin) ramp(w.fin, w.cin, 'l');
    if (w.fout) ramp(w.fout, w.cout, 'r');
  }

  // Les poignées de fondu (Premiere, Resolve : dans le coin haut du plan) :
  // glisser vers l'intérieur allonge le fondu. Rien là où un fondu enchaîné
  // tient le bord (il se règle par son propre repère).
  fadeHandles(node, w) {
    if (!w) return;
    if (!w.xin) node.append(el('i', { class: 'fh l', title: 'fondu d’entrée', style: { left: this.fx(w.fin || 0) + 'px' } }));
    if (!w.xout) node.append(el('i', { class: 'fh r', title: 'fondu de sortie', style: { right: this.fx(w.fout || 0) + 'px' } }));
  }

  // Un calque d'effet : une bande qui dit ses effets ; étirable, déplaçable, fondue comme un plan.
  fxClipNode(c, w, selected) {
    const fps = this.fps;
    const body = el('div', { class: 'body' });
    this.fadeMarks(body, w, false);
    const fxs = M.fxOn(c.fx);
    body.append(el('span', { class: 'nm' }, c.title || 'calque'), el('span', { class: 'bd' }, fxs.length ? fxs.map((f) => this.app.fxName(f)).join(' · ') : 'aucun effet'));
    const node = el('div', { class: `clip adjust${selected ? ' sel' : ''}${M.isOn(c) ? '' : ' off'}`, 'data-id': c.id,
      title: `${c.title || ''}\n${M.tc(c.start, fps)} → ${M.tc(M.clipEnd(c), fps)}`, style: { left: this.fx(c.start) + 'px', width: Math.max(3, this.fx(c.dur)) + 'px' } }, body);
    node.append(el('i', { class: 'h l' }), el('i', { class: 'h r' }));
    this.fadeHandles(node, w);
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
    this.ticks.replaceChildren(...out);
    this.marks.style.width = this.width + 'px';
  }

  // les marques de séquence et la plage entrée → sortie
  paintMarks() {
    const p = this.p, fps = this.fps;
    const out = [];
    const r = p.range || {};
    const hasIn = r.in !== null && r.in !== undefined, hasOut = r.out !== null && r.out !== undefined;
    if (hasIn || hasOut) {
      const a = hasIn ? r.in : 0, b = hasOut ? r.out : Math.max(M.projectEnd(p), a + 1);
      out.push(el('i', { class: 'tl-rng', style: { left: this.fx(a) + 'px', width: Math.max(2, this.fx(b - a)) + 'px' },
        title: `${hasIn ? 'entrée ' + M.tc(a, fps) : 'depuis le début'} → ${hasOut ? 'sortie ' + M.tc(b, fps) : 'jusqu’à la fin'} · clic droit : effacer` }));
      if (hasIn) out.push(el('i', { class: 'tl-io in', style: { left: this.fx(a) + 'px' } }));
      if (hasOut) out.push(el('i', { class: 'tl-io out', style: { left: this.fx(b) + 'px' } }));
      Object.assign(this.rngv.style, { left: HEAD + this.fx(a) + 'px', width: Math.max(2, this.fx(b - a)) + 'px' });
      this.rngv.hidden = false;
    } else this.rngv.hidden = true;
    for (const m of p.markers || []) {
      out.push(el('b', { class: 'tl-m', 'data-marker': m.id, style: { left: this.fx(m.f) + 'px' },
        title: `${m.name || 'marque'} · ${M.tc(m.f, fps)}\nclic : y aller · double-clic : renommer · clic droit : supprimer` },
      m.name ? el('span', {}, m.name) : null));
    }
    this.mlayer.replaceChildren(...out);
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
  // molette commune — Ctrl + molette : une piste (id) ou toutes (null), bornée 28–240 px (assez pour l'en-tête) ;
  // toutes : ce qui est sous le pointeur y reste. Point de départ : la hauteur dessinée (montage.css)
  scaleHeights(factor, id, clientY) {
    const p = this.p;
    if (!p) return;
    const one = id && p.tracks.find((t) => t.id === id);
    const cur = (t) => this.h[t.id] || this.lanes.querySelector(`.tl-lane[data-track="${t.id}"]`)?.offsetHeight || 46;
    const apply = () => {
      for (const t of one ? [one] : p.tracks) this.h[t.id] = Math.round(borne(cur(t) * factor, 28, 240) * 10) / 10;
      this.render();
    };
    if (one || clientY === undefined) apply(); else tenirY(this.scroll, clientY, apply);
    this.app.resized?.(this.h);
  }
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
    // molette commune (commun/molette.js) ; les en-têtes portent data-piste
    brancher(this.scroll, {
      zoom: (f, x) => { if (this.p) this.zoom(f, x); },
      hauteur: (f, id, e) => this.scaleHeights(f, id, e.clientY),
    });

    // la règle : cliquer, glisser = la tête de lecture ; une marque : y aller
    this.ruler.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      blurField();
      this.app.focus('program');
      const mk = e.target.closest('.tl-m');
      if (mk) { const m = (this.p.markers || []).find((x) => x.id === mk.dataset.marker); if (m) this.app.seekFrame(m.f); return; }
      const go = (ev) => this.app.seekFrame(this.frameAt(ev.clientX));
      go(e);
      this.drag(e, go, () => {});
    });
    this.ruler.addEventListener('dblclick', (e) => {
      const mk = e.target.closest('.tl-m');
      if (mk) this.app.renameMarker(mk.dataset.marker);
    });

    this.lanes.addEventListener('pointerdown', (e) => this.down(e));
    this.lanes.addEventListener('dblclick', (e) => {
      const hd = e.target.closest('.tl-hd');
      if (hd) {
        if (hd.dataset.ghead) this.app.renameGroup(hd.dataset.ghead);
        else if (e.target.closest('.tnm')) this.app.renameTrack(hd.dataset.head);
        return;
      }
      const n = e.target.closest('.clip');
      if (n && this.app.tool() === 'select') this.app.openClipInSource(n.dataset.id);
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
      // plusieurs objets du panneau Projet : posés à la suite, dans l'ordre
      try {
        const many = JSON.parse(e.dataTransfer.getData('application/x-sr-items') || '[]');
        if (many.length > 1) { this.app.placeMany(many, track, frame, mode); return; }
      } catch { /* */ }
      // une vignette de ce chutier, de la source, d'une autre page ou du sélecteur (dragItem du socle)
      const raw = e.dataTransfer.getData(ITEM_MIME);
      if (!raw) return;
      try { this.app.placeItem(JSON.parse(raw), track, frame, mode); } catch { /* */ }
    });

    // la main et le zoom agissent aussi sur la règle
    this.scroll.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.tl-hd')) return;
      const tool = this.app.tool();
      if (tool === 'hand') { e.preventDefault(); e.stopPropagation(); this.hand(e); }
      else if (tool === 'zoom') { e.preventDefault(); e.stopPropagation(); this.zoom(e.altKey ? 1 / 1.6 : 1.6, e.clientX); }
    }, true);
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
      this.root.classList.remove('dragging');
      up(ev);
    };
    this.root.classList.add('dragging');
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

  hand(e) {
    const x0 = e.clientX, y0 = e.clientY, l0 = this.scroll.scrollLeft, t0 = this.scroll.scrollTop;
    this.drag(e, (ev) => { this.scroll.scrollLeft = l0 - (ev.clientX - x0); this.scroll.scrollTop = t0 - (ev.clientY - y0); }, () => {});
  }

  down(e) {
    if (e.button !== 0 || e.target.closest('.tl-hd')) return;
    const lane = e.target.closest('.tl-lane');
    if (!lane) return;
    blurField();
    this.app.focus('program');
    const p = this.p;
    const tool = this.app.tool();
    const node = e.target.closest('.clip');
    const track = p.tracks.find((t) => t.id === lane.dataset.track);
    const f = this.frameAt(e.clientX);
    if (tool === 'track') {
      // Sélection de piste en avant : ce plan (ou ce point) et tout ce qui suit
      e.preventDefault();
      const sel = new Set(p.clips.filter((c) => (e.shiftKey ? true : c.track === track.id) && !track.lock && (c.start >= f || (node && c.id === node.dataset.id))).map((c) => c.id));
      const locked = M.lockedSet(p);
      for (const id of [...sel]) if (locked.has(M.byId(p, id).track)) sel.delete(id);
      this.app.select(sel);
      if (sel.size) this.move(e, sel, lane.dataset.track);
      return;
    }
    if (!node) {
      this.app.select(new Set(), M.gapAt(p, track.id, f));
      return;
    }
    const id = node.dataset.id;
    const c = M.byId(p, id);
    if (!c) return;
    e.preventDefault();
    if (tool === 'blade') {
      let cf = f;
      const ph = this.app.playhead();
      if (Math.abs(ph - cf) <= this.tol()) cf = ph;
      this.app.cut(cf, e.shiftKey ? null : id);
      return;
    }
    const sel = new Set(this.app.sel());
    if (tool === 'select' && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      sel.has(id) ? sel.delete(id) : sel.add(id);
      this.app.select(sel);
      return;
    }
    if (!sel.has(id) || tool !== 'select') { sel.clear(); sel.add(id); this.app.select(sel); }
    if (track.lock) return this.app.locked(track.id);
    const fh = e.target.closest('.fh');
    if (fh && tool === 'select') return this.fadeDrag(e, c, fh.classList.contains('l') ? 'l' : 'r');
    const handle = e.target.closest('.h');
    const side = handle ? (handle.classList.contains('l') ? 'l' : 'r') : null;
    if (tool === 'slip') return this.slip(e, c);
    if (tool === 'slide') return this.slide(e, c);
    if (tool === 'select') return side ? this.trim(e, c, side, node) : this.move(e, sel, lane.dataset.track);
    if (!side) return;                                   // B, N, R : les bords seulement
    if (tool === 'ripple') return this.ripple(e, c, side);
    if (tool === 'roll') { const pair = M.rollPair(p, c, side); return pair ? this.roll(e, pair[0], pair[1]) : this.trim(e, c, side, node); }
    if (tool === 'stretch') return this.stretch(e, c, side);
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

  // La poignée de fondu : la durée suit la souris, image par image, vue en
  // direct (programme et courbe) ; une seule annulation au lâcher.
  fadeDrag(e, c, side) {
    const fps = this.fps, fin = c.fade_in || 0, fout = c.fade_out || 0;
    const room = Math.max(0, c.dur - fin - fout);
    const lim = side === 'l' ? [-fin, room] : [-room, fout];
    const len = (d) => (side === 'l' ? fin + d : fout - d);
    this.live(e, side === 'l' ? 'fondu d’entrée' : 'fondu de sortie', lim, (q, d) => {
      const x = M.byId(q, c.id);
      if (side === 'l') x.fade_in = len(d); else x.fade_out = len(d);
      M.fitFades(x);
    }, (d) => `${side === 'l' ? 'entrée' : 'sortie'} · ${M.short(len(d) / fps)} · ${len(d)} im.`);
  }

  // Un geste vu en direct : chaque mouvement rejoue `apply(q, d)` sur le
  // projet d'avant le geste. `edge(d)` : l'image du bord qui bouge (aimant).
  live(e, label, [lo, hi], apply, tip, { edge = null, exclude = new Set(), onEnd = null } = {}) {
    const fps = this.fps;
    const pts = edge ? M.snapPoints(this.p, exclude, [this.app.playhead()]) : [];
    const x0 = e.clientX;
    let d = 0;
    this.app.gesture.begin(label);
    this.drag(e, (ev) => {
      let nd = Math.round((ev.clientX - x0) / this.pps * fps);
      let snapped = null;
      if (edge && this.app.snap()) {
        const sd = M.snapDelta([edge(nd)], pts, this.tol());
        if (sd !== null) { nd += sd; snapped = edge(nd); }
      }
      nd = Math.max(lo, Math.min(hi, nd));
      this.showSnap(snapped !== null && edge(nd) === snapped ? snapped : null);
      this.showTip(ev, tip(nd));
      if (nd === d) return;
      d = nd;
      this.app.gesture.apply((q) => apply(q, d));
    }, () => { this.app.gesture.end(); if (onEnd) onEnd(d); });
  }

  ripple(e, c, side) {
    const fps = this.fps;
    this.live(e, 'rogner avec propagation', M.rippleLimits(this.p, c, side), (q, d) => M.rippleTrim(q, c.id, side, d),
      (d) => `propagation · ${side === 'l' ? 'tête' : 'queue'} ${d >= 0 ? '+' : '−'}${Math.abs(d)} im. · durée ${M.short((c.dur + (side === 'l' ? -d : d)) / fps)} · la suite ${side === 'l' ? (d > 0 ? 'recule' : 'avance') : (d > 0 ? 'avance' : 'recule')}`,
      { edge: side === 'r' ? (d) => M.clipEnd(c) + d : null, exclude: new Set([c.id]) });
  }

  roll(e, a, b) {
    const fps = this.fps;
    this.live(e, 'déplacer la coupe', M.rollLimits(this.p, a, b), (q, d) => M.roll(q, a.id, b.id, d),
      (d) => `coupe ${M.tc(b.start + d, fps)} · ${d >= 0 ? '+' : '−'}${Math.abs(d)} im. · « ${a.title || 'A'} » ${M.short((a.dur + d) / fps)} · « ${b.title || 'B'} » ${M.short((b.dur - d) / fps)}`,
      { edge: (d) => b.start + d, exclude: new Set([a.id, b.id]) });
  }

  stretch(e, c, side) {
    const fps = this.fps;
    const sp0 = M.spd(c);
    this.live(e, 'changer la vitesse', M.stretchLimits(this.p, c, side), (q, d) => M.stretch(q, c.id, side, d),
      (d) => { const nd = c.dur + (side === 'l' ? -d : d); return `vitesse ${c.kind === 'image' ? '—' : M.pct(sp0 * c.dur / nd)} · durée ${M.short(nd / fps)}`; },
      { edge: side === 'l' ? (d) => c.start + d : (d) => M.clipEnd(c) + d, exclude: new Set([c.id]) });
  }

  slip(e, c) {
    if (c.kind === 'image') { this.app.say('une image fixe n’a rien à faire glisser dessous'); return; }
    const fps = this.fps, sp = M.spd(c);
    // on montre la première image du plan pendant le geste (Premiere : l'entrée et la sortie au moniteur)
    const back = this.app.peek(c);
    this.live(e, 'déplacer dessous', M.slipLimits(this.p, c), (q, d) => M.slip(q, c.id, d),
      (d) => { const i = Math.max(0, (c.in || 0) - d / fps * sp); return `déplacer dessous · entrée ${M.short(i)} · sortie ${M.short(i + c.dur / fps * sp)}${c.src_dur ? ` / ${M.short(c.src_dur)}` : ''}`; },
      { onEnd: () => back() });
  }

  slide(e, c) {
    const fps = this.fps;
    this.live(e, 'déplacer le plan', M.slideLimits(this.p, c), (q, d) => M.slide(q, c.id, d),
      (d) => `déplacer le plan · ${M.tc(c.start + d, fps)} → ${M.tc(M.clipEnd(c) + d, fps)} · ${d >= 0 ? '+' : '−'}${Math.abs(d)} im.`,
      { edge: (d) => c.start + d, exclude: new Set([c.id]) });
  }

  move(e, sel, startLane) {
    const p = this.p, fps = this.fps;
    const locked = M.lockedSet(p);
    const ids = new Set([...sel].filter((id) => { const c = M.byId(p, id); return c && !locked.has(c.track); }));
    const clips = [...ids].map((id) => M.byId(p, id));
    if (!clips.length) return;
    const nodes = new Map(clips.map((c) => [c.id, this.lanes.querySelector(`.clip[data-id="${c.id}"]`)]));
    const order = M.trackOrder(p);
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
      this.showTip(ev, `${ev.altKey ? 'copier · ' : ''}${df >= 0 ? '+' : '−'}${M.short(Math.abs(df) / fps)} · ${M.tc(minStart + df, fps)}${dt ? ` · ${dt > 0 ? '↓' : '↑'} ${Math.abs(dt)} piste` : ''}`);
    }, (ev) => {
      if (!moved || (!df && !dt)) { if (moved) this.render(); return; }
      const mode = ev && (ev.ctrlKey || ev.metaKey) ? 'insert' : 'overwrite';
      const copy = !!(ev && ev.altKey);
      let placed = [];
      this.app.commit(copy ? 'copier' : 'déplacer', (q) => { placed = M.moveClips(q, ids, df, dt, mode, copy); });
      if (copy) this.app.select(new Set(placed));
    });
  }
}
