// IDÉATION · ATELIER — les vues ancrées (prototype de Cal, « Innovation 02 ») :
// quatre emplacements de caméra, pour passer d'une zone de la planche à
// l'autre pendant une réunion. Le prototype enregistre par Maj + 1…4 ; ici
// Maj+1 est déjà « tout voir » (ideation.js), donc :
//   Alt + 1…4  enregistre la vue courante      1…4  y revient, en vol animé
// (les touches physiques : sur un clavier AZERTY, sans Maj, comme les
// chiffres du pavé numérique). Les pastilles en bas à gauche : un clic y va
// (ou enregistre une vue vide), Alt + clic enregistre.
// Une vue est le point du monde au centre et le zoom : elle reste juste si la
// planche change de taille. Gardées dans ce navigateur, par planche.

import { el, toast } from '../../commun/shell.js';
import { atelier } from './socle.js';

const N = 4;

export function install(app) {
  const A = atelier(app);
  const { S } = app;
  let views = Array(N).fill(null), boardId = null;

  const load = () => {
    boardId = S.board?.id || null;
    const v = boardId ? app.LS('at-views-' + boardId) : null;
    views = Array.from({ length: N }, (_, i) => (v?.[i] && Number.isFinite(v[i].z) ? v[i] : null));
    paint();
  };
  const keep = () => { if (boardId) app.LS('at-views-' + boardId, views.some(Boolean) ? views : null); };

  function save(i) {
    if (!S.board) { toast('ouvrez d’abord une planche'); return; }
    const c = A.current();
    views[i] = { cx: Math.round(c.cx), cy: Math.round(c.cy), z: Number(c.z.toFixed(4)) };
    keep(); paint();
    toast(`vue ${i + 1} enregistrée — la touche ${i + 1} y revient`);
  }
  function go(i) {
    if (!views[i]) { toast(`vue ${i + 1} vide : Alt+${i + 1} l’enregistre ici`); return; }
    A.fly(A.toView(views[i]), { ms: 620 });
    flash(i);
  }

  const chips = Array.from({ length: N }, (_, i) => el('button', { type: 'button', 'data-view': String(i + 1),
    onclick: (e) => { if (e.altKey || e.shiftKey || !views[i]) save(i); else go(i); } }, String(i + 1)));
  const box = A.panel('at-views', el('span', { class: 'lbl' }, 'vues'), ...chips);
  A.cv.append(box);
  function paint() {
    chips.forEach((c, i) => {
      c.classList.toggle('set', !!views[i]);
      c.title = views[i] ? `vue ${i + 1} · clic ou touche ${i + 1} : y aller · Alt + clic ou Alt+${i + 1} : l’enregistrer ici`
        : `vue ${i + 1} vide · clic ou Alt+${i + 1} : enregistrer la vue courante`;
    });
  }
  let flashT = 0;
  function flash(i) {
    chips.forEach((c, k) => c.classList.toggle('now', k === i));
    clearTimeout(flashT);
    flashT = setTimeout(() => chips[i].classList.remove('now'), 900);
  }

  A.key(40, (e, ctx) => {
    if (ctx.typing || ctx.overlay || A.presenting || A.replaying || !S.board) return false;
    if (e.ctrlKey || e.metaKey || e.shiftKey) return false;
    const m = /^(Digit|Numpad)([1-9])$/.exec(e.code);
    if (!m || Number(m[2]) > N) return false;
    if (m[1] === 'Numpad' && !/^[1-9]$/.test(e.key)) return false;   // pavé sans verr. num : des flèches
    const i = Number(m[2]) - 1;
    e.preventDefault();
    if (e.altKey) save(i); else go(i);
    return true;
  });
  for (let i = 0; i < N; i++) A.command({ order: 55 + i, label: `Aller à la vue ${i + 1}`, key: String(i + 1), sub: 'vues ancrées', when: () => (views[i] ? true : `vide : Alt+${i + 1} l’enregistre`), run: () => go(i) });
  A.command({ order: 59, label: 'Enregistrer la vue courante', sub: 'dans la première place libre', key: 'alt+1…4', run: () => { const i = views.findIndex((v) => !v); save(i < 0 ? 0 : i); } });

  app.on('board', load);
  load();

  A.vues = { save, go, get views() { return views.map((v) => (v ? { ...v } : null)); } };
}
