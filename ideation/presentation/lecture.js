// IDÉATION · PRÉSENTATION — la page de lecture seule (lecture.html#<planche>) et sa page
// d'impression (lecture.html?print#<planche>). Le même rendu que le mode Présentation et le
// lecteur de l'Idéation (scene.js) : une seule vérité. Le début du lecteur publié de l'étude
// (§ 3.4) ; la publication elle-même (R2, /p/<jeton>) reste à faire.
//
// ?print : chaque diapositive sur une page de sa taille (une page nommée par taille de scène :
// 16:9 = 1920 × 1080 px, 9:16, 4:3, 1:1 dans le même PDF), dans son état final (sans entrées :
// « rien d'animé qui n'ait son équivalent statique », § 2.3) ; ce qui ne s'imprime pas montre son
// image fixe et un pied discret (scene.js, `print` : une vidéo son affiche, un objet Web son aperçu,
// un son son onde). Imprimer (le navigateur) ou page.pdf() de Chromium sans affichage en font un
// PDF : le travail `presentation.pdf` (server/tools/presentation_pdf.py, tools/presentation_export.mjs)
// attend `body.dataset.ready` (ou `error`) et lit `window.SR_IMPRESSION` (les pages, leurs polices).
//
// ?video[&slide=<id>][&hold=<ms>] (06/10) : la page de RENDU, sans interface — la présentation (ou une
// diapositive) mise bout à bout comme le lecteur la joue (programme.js), à la taille de sa première
// scène. `window.SR_RENDU.seek(t)` la pose à l'instant t (ms) et rend quand l'image est prête ; le
// travail `presentation.video` (server/tools/presentation_video.py, tools/presentation_export.mjs) la
// capture image par image et donne les images à ffmpeg.

import { api, href } from '../../commun/shell.js';
import { basculer, enPleinEcran, permis } from '../../commun/pleinecran.js';
import { shownOf, isSlide } from '../diapo/ordre.js';
import { ensureFont } from '../diapo/polices.js';
import { buildScene, fontsOf } from './scene.js';
import { styler, fontsReady, modele } from './modeles.js';
import { createPlayer } from './lecteur.js';
import { programme } from './programme.js';

const msg = document.getElementById('msg');
const bid = location.hash.slice(1);
const Q = new URLSearchParams(location.search);
const print = Q.has('print');
const video = Q.has('video');

async function main() {
  if (!bid) throw new Error('aucune planche : lecture.html#<planche>');
  const [board, m] = await Promise.all([api(`ideation/boards/${bid}`), api('ideation/meta')]);
  const meta = m.deck;
  const frames = shownOf(board).filter(isSlide);
  if (!frames.length) throw new Error('cette planche n’a pas de diapositive');
  const ids = [...new Set(board.nodes.filter((n) => n.type === 'media').map((n) => n.item))];
  const items = new Map();
  if (ids.length) {
    const r = await api('library/batch', { method: 'POST', body: { ids } }).catch(() => ({ items: [] }));
    for (const it of r.items || []) items.set(it.id, it);
  }
  const tpl = await modele(board.pres?.template);
  // les polices propres d'un texte sans style (diapo/libre.js) : une police proposée se charge ici comme sur la planche
  const fake = { S: { meta: { deck: meta } } };
  for (const id of new Set(board.nodes.map((n) => n.font).filter(Boolean))) ensureFont(fake, id, () => {});
  document.title = `${board.name} · Présentation`;
  msg.remove();
  if (video) {
    // le rendu image par image : aucune interface, la scène seule, à sa taille
    document.body.classList.add('pl-video');
    const hold = Q.has('hold') ? Number(Q.get('hold')) : undefined;
    const P = programme({ board, frames, only: Q.get('slide') || null, items, meta, tpl, href, name: board.name, host: document.body, hold });
    const info = await P.prepare();
    window.SR_RENDU = { name: board.name, w: P.w, h: P.h, total: info.total, fonts: info.fonts, slides: P.slides, seek: (t) => P.seek(t) };
    await P.seek(0);
    document.body.dataset.ready = String(info.total);
    return;
  }
  if (!print) {
    createPlayer({ board, frames, items, meta, tpl, href, name: board.name,
      fullscreen: permis() ? { toggle: () => basculer(), on: () => enPleinEcran() } : null,
      onexit: () => { if (enPleinEcran()) basculer(); location.hash = ''; } }).start(0);
    return;
  }
  // l'impression : une page par diapositive, chacune à la taille de sa scène (une page nommée par taille)
  document.body.classList.add('pl-print');
  const style = styler(meta, board, tpl, false);
  const f0 = frames[0];
  const sizes = [...new Set(frames.map((f) => `${f.w}x${f.h}`))];
  const sheet = document.createElement('style');
  sheet.textContent = `@page { size: ${f0.w}px ${f0.h}px; margin: 0; }\n`
    + sizes.map((k) => { const [w, h] = k.split('x'); return `@page p${k} { size: ${w}px ${h}px; margin: 0; }`; }).join('\n');
  document.head.append(sheet);
  const pages = frames.map((f, i) => {
    const page = document.createElement('section');
    page.className = 'pl-page';
    page.dataset.frame = f.id;
    Object.assign(page.style, { width: `${f.w}px`, height: `${f.h}px` });
    page.style.setProperty('page', `p${f.w}x${f.h}`);
    const sc = buildScene({ board, frame: f, items, style, tpl, motionOf: () => null, index: i, count: frames.length, live: false, print: true,
      href, name: board.name, fonts: meta.fonts || [] });
    page.append(sc.el);
    return { page, sc, f };
  });
  document.body.append(...pages.map((p) => p.page));
  await fontsReady(style, 4000);
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 8000))]);
  await Promise.all(pages.flatMap((p) => p.sc.objs.filter((o) => o.img).map((o) => o.img.decode().catch(() => {}))));
  const bar = document.createElement('div');
  bar.className = 'pl-bar';
  const b = document.createElement('button');
  b.className = 'tb ghost sm'; b.type = 'button'; b.textContent = 'Imprimer / PDF'; b.onclick = () => print2();
  bar.append(b);
  document.body.append(bar);
  // pour Chromium sans affichage (tools/presentation_export.mjs) : ce qui est imprimé, page par page —
  // la diapositive, sa taille, les objets de la bibliothèque qu'elle montre, les polices de ses textes
  window.SR_IMPRESSION = { name: board.name, pages: pages.map(({ page, sc, f }) => ({ id: f.id, name: f.name || '', w: f.w, h: f.h,
    items: [...new Set(sc.objs.filter((o) => o.n?.type === 'media' && o.n.item).map((o) => o.n.item))], fonts: fontsOf(page) })) };
  document.body.dataset.ready = String(frames.length);
}
const print2 = () => window.print();
main().catch((e) => {
  msg.textContent = e.message;
  if (!msg.isConnected) document.body.prepend(msg);
  document.body.dataset.error = e.message || 'erreur';
});
