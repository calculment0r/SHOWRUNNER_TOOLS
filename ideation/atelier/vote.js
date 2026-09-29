// IDÉATION · ATELIER — le vote par points (prototype de Cal, « Innovation
// 05 ») : en mode vote, un clic sur un objet lui donne une voix, Alt + clic
// en retire une ; le panneau classe les objets en direct, un clic y fait
// voler la caméra. Les pastilles restent sur les objets jusqu'à la remise à
// zéro. Les voix sont gardées dans ce navigateur, par planche
// (`ide-at-votes-<planche>`) : un vote à plusieurs attend la collaboration.

import { el, toast } from '../../commun/shell.js';
import { atelier, bbox } from './socle.js';

const ICON = 'M12 3a9 9 0 1 0 .01 0M8 12l3 3 5-6';
const TOP = 8;

export function install(app) {
  const A = atelier(app);
  const { S } = app;
  const cv = A.cv;
  let on = false, votes = new Map(), boardId = null;

  const load = () => {
    boardId = S.board?.id || null;
    const v = boardId ? app.LS('at-votes-' + boardId) : null;
    votes = new Map(Object.entries(v && typeof v === 'object' ? v : {}).filter(([, n]) => Number(n) > 0).map(([k, n]) => [k, Number(n)]));
  };
  const save = () => { if (boardId) app.LS('at-votes-' + boardId, votes.size ? Object.fromEntries(votes) : null); };
  const total = () => [...votes.values()].reduce((a, b) => a + b, 0);

  function vote(id, d) {
    const n = Math.max(0, (votes.get(id) || 0) + d);
    if (n) votes.set(id, n); else votes.delete(id);
    save(); paint();
  }
  function toggle(force) {
    on = force ?? !on;
    if (on && A.presenting) on = false;
    if (on) app.select([]);
    cv.classList.toggle('at-voting', on);
    btn.classList.toggle('on', on);
    box.hidden = !on;
    paint();
    if (on) toast('vote : un clic sur un objet lui donne une voix, Alt + clic en retire une', 4500);
  }

  // ── les clics : en mode vote, un objet ne se choisit ni ne se déplace ─
  const target = (e) => {
    if (!on || A.presenting || A.replaying || e.button !== 0) return null;
    if (e.target.closest?.('.at-panel, .zoombox, .mini')) return null;
    const host = e.target.closest?.('[data-id]');
    return host && cv.contains(host) && app.node(host.dataset.id) ? host.dataset.id : null;
  };
  cv.addEventListener('pointerdown', (e) => {
    const id = target(e);
    if (!id) return;
    e.preventDefault(); e.stopPropagation();
    vote(id, e.altKey ? -1 : 1);
  }, true);
  for (const ev of ['click', 'dblclick']) cv.addEventListener(ev, (e) => { if (target(e)) { e.preventDefault(); e.stopPropagation(); } }, true);

  // ── les pastilles, sur les objets eux-mêmes (elles suivent un objet qu'on
  // déplace ; un objet refait par le canvas les retrouve au passage suivant) ─
  function badges() {
    for (const b of cv.querySelectorAll('.at-vbadge')) {
      const id = b.parentElement?.dataset.id;
      if (!votes.has(id) || A.nodeEl(id) !== b.parentElement) b.remove();
    }
    for (const [id, n] of votes) {
      const host = A.nodeEl(id);
      if (!host) continue;
      let b = host.querySelector(':scope > .at-vbadge');
      if (!b) { b = el('span', { class: 'at-vbadge', 'aria-label': 'voix' }); host.append(b); }
      if (b.textContent !== String(n)) b.textContent = String(n);
    }
  }
  let badgeF = 0;
  const soon = () => { cancelAnimationFrame(badgeF); badgeF = requestAnimationFrame(badges); };
  const watch = new MutationObserver(soon);
  for (const layer of cv.querySelectorAll('.world > .layer')) watch.observe(layer, { childList: true });

  // ── le panneau ───────────────────────────────────────────
  const sum = el('span', { class: 'lbl' });
  const rank = el('div', { class: 'at-rank' });
  const reset = el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { votes.clear(); save(); paint(); toast('voix remises à zéro'); } }, 'Remettre à zéro');
  const box = A.panel('at-vote',
    el('div', { class: 'h' }, el('b', {}, 'Vote'), sum),
    el('p', {}, 'Un clic sur un objet : une voix. Alt + clic : en retirer une. Un clic ici : y aller.'),
    rank,
    el('div', { class: 'row' }, reset, el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'quitter le mode vote (les pastilles restent) · Échap', onclick: () => toggle(false) }, 'Terminer')));
  box.hidden = true;
  A.corner(box, 20);

  function paint() {
    for (const id of [...votes.keys()]) if (!app.node(id)) votes.delete(id);
    const t = total();
    sum.textContent = `${t} voix`;
    reset.disabled = !t;
    reset.title = t ? 'effacer toutes les voix de cette planche' : 'aucune voix à effacer';
    const list = [...votes.entries()].sort((a, b) => b[1] - a[1] || app.label(app.node(a[0])).localeCompare(app.label(app.node(b[0])), 'fr'));
    rank.replaceChildren(...(list.length ? list.slice(0, TOP).map(([id, n], i) => el('button', { class: 'ri', type: 'button', title: 'y aller', onclick: () => flyTo(id) },
      el('span', { class: 'no' }, String(i + 1).padStart(2, '0')), el('span', { class: 'nm' }, app.label(app.node(id))), el('span', { class: 'n' }, String(n))))
      : [el('span', { class: 'none' }, 'aucune voix pour l’instant')]));
    if (list.length > TOP) rank.append(el('span', { class: 'none' }, `+ ${list.length - TOP} autre${list.length - TOP > 1 ? 's' : ''}`));
    badges();
  }
  function flyTo(id) {
    const n = app.node(id);
    if (!n) return;
    const r = bbox([n]);
    A.fly(A.viewFor({ x: r.x - 60, y: r.y - 60, w: r.w + 120, h: r.h + 120 }, { pad: 70, zmax: 1.2 }), { ms: 600 });
  }

  const btn = A.button({ order: 20, d: ICON, name: 'Vote par points', title: 'vote par points : un clic sur un objet = une voix, Alt + clic en retire une · classement en direct',
    onclick: () => toggle() });
  A.command({ order: 20, label: 'Mode vote', sub: 'vote par points', run: () => toggle() });
  A.command({ order: 21, label: 'Remettre les voix à zéro', when: () => (total() ? true : 'aucune voix sur cette planche'), run: () => { votes.clear(); save(); paint(); } });

  // Échap : on quitte le mode vote (la planche, elle, oublie la sélection)
  A.key(50, (e, ctx) => { if (on && e.key === 'Escape' && !ctx.typing && !ctx.overlay) toggle(false); return false; });
  app.on('board', () => { load(); if (on) toggle(false); else paint(); });
  app.on('commit', soon);
  app.on('quiet', soon);
  app.on('atelier:present', (p) => { if (p && on) toggle(false); });
  load(); paint();

  A.vote = { toggle, vote, get votes() { return Object.fromEntries(votes); }, get on() { return on; } };
}
