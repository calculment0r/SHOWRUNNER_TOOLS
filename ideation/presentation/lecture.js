// IDÉATION · PRÉSENTATION — la page de lecture seule (lecture.html#<planche>) et sa page
// d'impression (lecture.html?print#<planche>). Le même rendu que le mode Présentation et le
// lecteur de l'Idéation (scene.js) : une seule vérité. Le début du lecteur publié de l'étude
// (§ 3.4) ; la publication elle-même (R2, /p/<jeton>) reste à faire.
//
// ?print : chaque diapositive sur une page de sa taille (@page 1920 × 1080 px), dans son état
// final (sans entrées : « rien d'animé qui n'ait son équivalent statique », § 2.3), vidéos à
// leur affiche. Imprimer (le navigateur) ou page.pdf() de Chromium sans affichage en font un PDF.

import { api, href } from '../../commun/shell.js';
import { basculer, enPleinEcran, permis } from '../../commun/pleinecran.js';
import { shownOf, isSlide } from '../diapo/ordre.js';
import { buildScene } from './scene.js';
import { styler, fontsReady, modele } from './modeles.js';
import { createPlayer } from './lecteur.js';

const msg = document.getElementById('msg');
const bid = location.hash.slice(1);
const print = new URLSearchParams(location.search).has('print');

async function main() {
  if (!bid) { msg.textContent = 'aucune planche : lecture.html#<planche>'; return; }
  const [board, m] = await Promise.all([api(`ideation/boards/${bid}`), api('ideation/meta')]);
  const meta = m.deck;
  const frames = shownOf(board).filter(isSlide);
  if (!frames.length) { msg.textContent = 'cette planche n’a pas de diapositive 16:9'; return; }
  const ids = [...new Set(board.nodes.filter((n) => n.type === 'media').map((n) => n.item))];
  const items = new Map();
  if (ids.length) {
    const r = await api('library/batch', { method: 'POST', body: { ids } }).catch(() => ({ items: [] }));
    for (const it of r.items || []) items.set(it.id, it);
  }
  const tpl = await modele(board.pres?.template);
  document.title = `${board.name} · Présentation`;
  msg.remove();
  if (!print) {
    createPlayer({ board, frames, items, meta, tpl, href, name: board.name,
      fullscreen: permis() ? { toggle: () => basculer(), on: () => enPleinEcran() } : null,
      onexit: () => { if (enPleinEcran()) basculer(); location.hash = ''; } }).start(0);
    return;
  }
  // l'impression : une page par diapositive
  document.body.classList.add('pl-print');
  const style = styler(meta, board, tpl, false);
  const f0 = frames[0];
  const sheet = document.createElement('style');
  sheet.textContent = `@page { size: ${f0.w}px ${f0.h}px; margin: 0; } .pl-page { width: ${f0.w}px; height: ${f0.h}px; }`;
  document.head.append(sheet);
  const pages = frames.map((f, i) => {
    const page = document.createElement('section');
    page.className = 'pl-page';
    const sc = buildScene({ board, frame: f, items, style, tpl, motionOf: () => null, index: i, count: frames.length, live: false, href, name: board.name });
    page.append(sc.el);
    return { page, sc };
  });
  document.body.append(...pages.map((p) => p.page));
  await fontsReady(style, 4000);
  await Promise.all(pages.flatMap((p) => p.sc.objs.filter((o) => o.img).map((o) => o.img.decode().catch(() => {}))));
  const bar = document.createElement('div');
  bar.className = 'pl-bar';
  const b = document.createElement('button');
  b.className = 'tb ghost sm'; b.type = 'button'; b.textContent = 'Imprimer / PDF'; b.onclick = () => print2();
  bar.append(b);
  document.body.append(bar);
  document.body.dataset.ready = String(frames.length);   // pour Chromium sans affichage (tools/presentation_export.mjs)
}
const print2 = () => window.print();
main().catch((e) => { msg.textContent = e.message; });
