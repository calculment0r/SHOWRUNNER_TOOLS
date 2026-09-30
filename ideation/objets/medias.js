// IDÉATION · OBJETS — le son et le web sur la planche (30/09/2026) : le module
// greffé (plugins.js, une ligne) qui pose le bloc son (son.js) et les gestes de
// l'objet « Web » (web.js ; l'objet lui-même entre dans app.objets par
// objets/index.js). L'étude : docs/etudes/ideation_collab.md § 10.
//
// Ce qu'il expose (les deux boutons de la barre, posés par qui range la barre) :
//   app.medias.son(at?)   poser un son — le sélecteur de la bibliothèque, sons seulement
//                         (on y dépose aussi un fichier du disque)            touche A
//   app.medias.web(at?)   intégrer une adresse — YouTube, Vimeo, un site      touche W
// et coller une adresse (ctrl+V) sur la planche pose un objet Web.

import { toast } from '../../commun/shell.js';
import { installSon } from './son.js';
import { mediasCss } from './web.js';
import { parseWeb } from './web_url.js';

const typing = (t) => t?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]');

export function install(app) {
  const { S } = app;
  mediasCss();
  const son = installSon(app);
  const web = app.web;   // posé par objets/web.js (extendWeb) au départ de la planche
  const busy = () => !S.board || app.canvas.isLocked() || !!document.querySelector('.scrim') || app.atelier?.presenting || app.atelier?.replaying;
  app.medias = {
    son: (at = null) => { if (app.canvas.isLocked()) { toast('la planche est en lecture seule ici'); return; } son.place(at); },
    web: (at = null) => web?.ask(at),
    player: son,
  };
  if (web) {
    app.on('commit', web.tidy);
    app.on('board', () => { for (const id of web.state().live) web.unload(id); });
  }

  // coller une adresse seule sur la planche : un objet Web (avant le collage d'Idéation, qui
  // ne prend que des fichiers et des objets copiés ; un texte dans un champ reste au champ)
  addEventListener('paste', (e) => {
    if (typing(e.target) || busy() || !web) return;
    if (e.clipboardData?.files?.length) return;
    const txt = (e.clipboardData?.getData('text/plain') || '').trim();
    if (!txt || /\s/.test(txt)) return;
    const p = parseWeb(txt);
    if (!p.ok) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    toast(`aperçu de ${p.host}…`, 2500);
    web.create(p.url);
  }, true);

  // A : un son, W : une adresse web (les lettres libres de la planche ; aucune n'est prise ailleurs)
  document.addEventListener('keydown', (e) => {
    if (typing(e.target) || busy() || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'a') { e.preventDefault(); app.medias.son(); }
    else if (k === 'w') { e.preventDefault(); app.medias.web(); }
  });

  // la palette ⌘K de l'atelier, quand elle est là
  let cmds = false;
  const commands = () => {
    const A = app.atelier;
    if (cmds || !A?.command) return;
    cmds = true;
    A.command({ order: 66, label: 'Poser un son…', key: 'A', sub: 'depuis la bibliothèque ou le disque', run: () => app.medias.son() });
    A.command({ order: 67, label: 'Intégrer une adresse web…', key: 'W', sub: 'YouTube, Vimeo, un site', run: () => app.medias.web() });
  };
  commands();
  for (const ev of ['board', 'commit', 'selection']) app.on(ev, commands);
}
