// IDÉATION · ATELIER — le minuteur d'atelier (prototype de Cal, « Innovation
// 06 ») : 3, 5 ou 10 minutes pour cadrer un exercice. Le décompte se pose
// en haut à droite de la planche (il reste là pendant une présentation),
// passe à l'orange d'alerte sur la dernière minute et prévient à la fin. Il
// survit à un rechargement (l'heure de fin est gardée dans ce navigateur).

import { el, toast } from '../../commun/shell.js';
import { menu } from '../../commun/menu.js';
import { atelier } from './socle.js';

const ICON = 'M12 5a8 8 0 1 0 .01 0M12 9v4l2.5 1.5M10 2.5h4';
const PRESETS = [3, 5, 10];

export function install(app) {
  const A = atelier(app);
  // { dur (s), end (horodatage) quand il tourne, left (s) quand il est en pause }
  let T = app.LS('at-timer');
  if (!T || !Number.isFinite(T.dur)) T = null;
  let tick = 0, endT = 0;

  const left = () => (T ? (T.end ? Math.max(0, (T.end - Date.now()) / 1000) : T.left) : 0);
  const mmss = (s) => { const k = Math.ceil(s); return `${String(Math.floor(k / 60)).padStart(2, '0')}:${String(k % 60).padStart(2, '0')}`; };
  const keep = () => app.LS('at-timer', T);

  function begin(min) {
    clearTimeout(endT);
    T = { dur: min * 60, end: Date.now() + min * 60000, left: min * 60 };
    keep(); run(); paint();
  }
  function pause() {
    if (!T) return;
    if (T.end) T = { ...T, left: left(), end: null };
    else T = { ...T, end: Date.now() + T.left * 1000 };
    keep(); run(); paint();
  }
  function cancel() { clearTimeout(endT); T = null; keep(); run(); paint(); }
  function run() {
    clearInterval(tick);
    if (T?.end) tick = setInterval(step, 250);
  }
  function step() {
    if (!T?.end) return;
    if (left() <= 0) {
      clearInterval(tick);
      T = { ...T, end: null, left: 0, over: true };
      keep(); paint();
      toast('temps écoulé · fin de l’exercice', 8000);
      endT = setTimeout(() => { if (T?.over) cancel(); }, 9000);
      return;
    }
    paint();
  }

  const time = el('span', { class: 't' });
  const pb = el('button', { class: 'tb ghost sm', type: 'button', onclick: () => pause() });
  const chip = A.panel('at-timer', el('span', { class: 'lbl' }, 'minuteur'), time, pb,
    el('button', { class: 'tb ghost sm', type: 'button', title: 'arrêter le minuteur', 'aria-label': 'arrêter', onclick: () => cancel() }, '×'));
  chip.hidden = true;
  A.corner(chip, 10);

  function paint() {
    chip.hidden = !T;
    btn.classList.toggle('on', !!T);
    if (!T) return;
    const s = left();
    time.textContent = mmss(s);
    chip.classList.toggle('paused', !T.end && !T.over);
    chip.classList.toggle('last', !!T.end && s <= 60);
    chip.classList.toggle('end', !!T.over);
    pb.hidden = !!T.over;
    pb.textContent = T.end ? 'Pause' : 'Reprendre';
    pb.title = T.end ? 'mettre le décompte en pause' : 'reprendre le décompte';
  }
  function choose(e, b) {
    const r = b.getBoundingClientRect();
    menu(r.left, r.bottom + 4, [{ head: 'Minuteur d’atelier' },
      ...PRESETS.map((m) => ({ label: `${m} minutes`, key: `${m}'`, onclick: () => begin(m) })),
      ...(T ? ['-', { label: T.end ? 'Pause' : 'Reprendre', disabled: !!T.over, why: 'le temps est écoulé', onclick: () => pause() },
        { label: 'Arrêter', onclick: () => cancel() }] : [])]);
  }

  const btn = A.button({ order: 40, d: ICON, name: 'Minuteur…', title: 'minuteur d’atelier : 3, 5 ou 10 minutes', onclick: choose });
  PRESETS.forEach((m, i) => A.command({ order: 40 + i, label: `Minuteur ${m} minutes`, sub: 'minuteur d’atelier', run: () => begin(m) }));
  A.command({ order: 44, label: 'Arrêter le minuteur', when: () => (T ? true : 'aucun minuteur en cours'), run: () => cancel() });

  if (T?.over || (T?.end && left() <= 0)) T = null;
  keep(); run(); paint();

  A.minuteur = { begin, pause, cancel, get state() { return T ? { ...T, left: left() } : null; } };
}
