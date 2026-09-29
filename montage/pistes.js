// MONTAGE — glisser les pistes par leur en-tête, comme dans ODIO
// (musique/timeline.js, « glisser une piste : la déplacer, ou faire un
// groupe ») : le tiers haut et le tiers bas d'une piste sont l'entre-pistes
// (un trait se pose, la piste ira là) ; son cœur est la piste elle-même
// (elle s'entoure : lâchée, la piste glissée fait groupe avec elle). Sur
// l'en-tête d'un groupe : son tiers haut place avant le groupe, le reste y
// fait entrer. L'en-tête d'un groupe se glisse : le groupe entier bouge.
// Une piste reste dans sa famille (l'image en haut, le son en bas). Un clic
// sans glisser choisit la piste (ou le groupe) : l'inspecteur montre ses effets.

import { el } from '../commun/shell.js';
import * as M from './model.js';

const EDGE = 0.3;

export function bindTrackDrag(tl, app) {
  const line = el('div', { class: 'tl-tline', hidden: true });
  tl.root.append(line);

  function rows() { return [...tl.lanes.querySelectorAll('.tl-lane[data-track], .tl-grp[data-grp]')]; }

  function dropTarget(clientY, ids, fam) {
    const p = tl.p;
    const famOf = (tid) => M.family(M.trackOf(p, tid)?.kind || 'video');
    for (const r of rows()) {
      const b = r.getBoundingClientRect();
      if (clientY < b.top || clientY >= b.bottom) continue;
      const rel = (clientY - b.top) / b.height;
      if (r.dataset.grp) {
        const members = p.tracks.filter((x) => x.grp === r.dataset.grp);
        if (!members.length || members.every((x) => ids.includes(x.id)) || M.family(members[0].kind) !== fam) return null;
        if (rel < EDGE) return { mode: 'move', cible: members[0].id, cote: 'avant', y: b.top };
        return { mode: 'group', cible: members.find((x) => !ids.includes(x.id)).id, row: r };
      }
      const id = r.dataset.track;
      if (famOf(id) !== fam) return null;
      if (ids.includes(id)) return { mode: 'none' };
      if (rel < EDGE) return { mode: 'move', cible: id, cote: 'avant', y: b.top };
      if (rel > 1 - EDGE) return { mode: 'move', cible: id, cote: 'apres', y: b.bottom };
      return { mode: 'group', cible: id, row: r };
    }
    return null;
  }

  tl.lanes.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const hd = e.target.closest('.tl-hd');
    if (!hd || e.target.closest('button') || !tl.p) return;
    const p = tl.p;
    const gid = hd.dataset.ghead;
    const tid = hd.dataset.head;
    const ids = gid ? p.tracks.filter((t) => t.grp === gid).map((t) => t.id) : [tid];
    if (!ids.length || !ids[0]) return;
    const fam = M.family(M.trackOf(p, ids[0]).kind);
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY;
    let started = false, target = null, ghost = null;
    const paint = () => {
      tl.lanes.querySelectorAll('.tgrp-on').forEach((n) => n.classList.remove('tgrp-on'));
      line.hidden = true;
      if (!target || target.mode === 'none') return;
      if (target.mode === 'move') {
        const r = tl.root.getBoundingClientRect();
        line.hidden = false;
        line.style.top = `${target.y - r.top - 1}px`;
      } else target.row.classList.add('tgrp-on');
    };
    const mv = (ev) => {
      if (!started) {
        if (Math.abs(ev.clientY - y0) < 5 && Math.abs(ev.clientX - x0) < 5) return;
        started = true;
        tl.root.classList.add('tdragging');
        const g = gid ? M.groupOf(p, gid) : null;
        ghost = el('div', { class: 'tl-tghost' }, g ? g.name : (M.trackOf(p, tid).name || tid));
        document.body.append(ghost);
      }
      Object.assign(ghost.style, { left: `${ev.clientX + 12}px`, top: `${ev.clientY - 10}px` });
      target = dropTarget(ev.clientY, ids, fam);
      ghost.dataset.what = target?.mode === 'group' ? 'grouper' : target?.mode === 'move' ? 'déplacer' : '';
      paint();
      const s = tl.scroll.getBoundingClientRect();
      if (ev.clientY < s.top + 30) tl.scroll.scrollTop -= 10; else if (ev.clientY > s.bottom - 30) tl.scroll.scrollTop += 10;
    };
    const up = (ev) => {
      removeEventListener('pointermove', mv, true);
      removeEventListener('pointerup', up, true);
      tl.root.classList.remove('tdragging');
      ghost?.remove();
      const tg = started ? dropTarget(ev.clientY, ids, fam) : null;
      target = null;
      paint();
      // un clic : choisir — après le clic (et le double-clic qui renomme), pas avant : le
      // redessin remplacerait l'en-tête sous la souris et le double-clic se perdrait
      if (!started) { setTimeout(() => app.selectTrack(gid ? 'g:' + gid : tid), 0); return; }
      if (!tg || tg.mode === 'none') return;
      if (tg.mode === 'move') app.moveTracks(ids, tg.cible, tg.cote);
      else app.groupTracks(ids, tg.cible);
    };
    addEventListener('pointermove', mv, true);
    addEventListener('pointerup', up, true);
  });
}
