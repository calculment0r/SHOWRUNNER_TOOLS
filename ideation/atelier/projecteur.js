// IDÉATION · ATELIER — le projecteur (prototype de Cal, « Innovation 07 ») :
// tout ce qui n'est pas choisi s'assombrit, pour tenir l'attention d'un
// groupe sur un point. Un cadre choisi éclaire ce qu'il contient ; les liens
// entre deux objets éclairés restent visibles. Échap l'éteint.

import { toast } from '../../commun/shell.js';
import { atelier, inside } from './socle.js';

const ICON = 'M12 8a4 4 0 1 0 .01 0M12 2v3M12 19v3M2 12h3M19 12h3';

export function install(app) {
  const A = atelier(app);
  const { S } = app;
  const lit = A.style('projecteur');
  let on = false;

  function paint() {
    const sel = [...S.sel].filter((id) => app.node(id));
    const shine = on && sel.length > 0 && !A.presenting && !A.replaying;
    A.cv.classList.toggle('at-spot', shine);
    if (!shine) { lit(''); return; }
    const keep = new Set(sel);
    for (const id of sel) {
      const f = app.node(id);
      if (f.type === 'frame') for (const n of S.board.nodes) if (inside(n, f)) keep.add(n.id);
    }
    lit(A.litCss('at-spot', keep, S.board.links.filter((l) => keep.has(l.a) && keep.has(l.b)).map((l) => l.id)));
  }
  function toggle(force) {
    on = force ?? !on;
    btn.classList.toggle('on', on);
    paint();
    if (on && !S.sel.size) toast('projecteur : choisissez ce qu’il faut éclairer, le reste s’assombrit', 4500);
  }

  const btn = A.button({ order: 30, d: ICON, name: 'Projecteur', title: 'projecteur : assombrit tout sauf ce qui est choisi · Échap l’éteint', onclick: () => toggle() });
  A.command({ order: 30, label: 'Projecteur', sub: 'assombrir tout sauf la sélection', run: () => toggle() });
  A.key(50, (e, ctx) => { if (on && e.key === 'Escape' && !ctx.typing && !ctx.overlay) toggle(false); return false; });
  for (const ev of ['selection', 'commit', 'quiet', 'atelier:present', 'atelier:replay']) app.on(ev, paint);
  app.on('board', () => { if (on) toggle(false); });

  A.projecteur = { toggle, get on() { return on; } };
}
