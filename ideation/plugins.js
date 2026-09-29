// IDÉATION — les modules qui se greffent sur la planche sans toucher au
// canvas : collaboration (présence, fil de discussion, visio), atelier
// (présentation par cadres, vote, projecteur, minuteur, machine
// temporelle, palette de commandes, vues ancrées)… Chacun exporte une
// fonction `install(app)` et s'inscrit dans la liste ci-dessous : une
// ligne d'import, une entrée dans PLUGINS.
//
// Ce qu'un module reçoit : `app` (voir ideation.js : S, node, mutate,
// quiet, select, canvas…) et un bus d'événements :
//   app.on(nom, fn) → rend la fonction qui désabonne
//   app.emit(nom, donnée)
// Les événements émis ici : 'commit' (la planche a changé, geste de Cal),
// 'quiet' (elle a changé seule : un travail qui avance), 'selection',
// 'render', 'board' (une planche s'ouvre : S.board). Le canvas émet les
// siens (il le dit dans son en-tête) : 'view' (la caméra a bougé : S.view,
// { x, y, z }, depuis applyView — plus de relevé par image ici) et 'moving'
// (des objets se déplacent : leurs identifiants ; [] quand le geste finit).

const PLUGINS = [
  // [nom, () => import('./module.js')] — chargés après le départ de la planche
  ['atelier · présentation', () => import('./atelier/presentation.js')],
  ['atelier · vote', () => import('./atelier/vote.js')],
  ['atelier · projecteur', () => import('./atelier/projecteur.js')],
  ['atelier · minuteur', () => import('./atelier/minuteur.js')],
  ['atelier · machine temporelle', () => import('./atelier/machine.js')],
  ['atelier · palette de commandes', () => import('./atelier/commandes.js')],
  ['atelier · vues ancrées', () => import('./atelier/vues.js')],
  ['collab', () => import('./collab.js')],
];

export function installPlugins(app) {
  const subs = new Map();
  app.on = (ev, fn) => {
    if (!subs.has(ev)) subs.set(ev, new Set());
    subs.get(ev).add(fn);
    return () => subs.get(ev)?.delete(fn);
  };
  app.emit = (ev, data) => {
    for (const fn of subs.get(ev) || []) {
      try { fn(data); } catch (e) { console.error(`idéation · ${ev}`, e); }
    }
  };
  // les gestes de la planche passent déjà par ces fonctions : on les
  // enveloppe, le reste du code n'a rien à savoir
  const wrap = (k, ev, data = () => undefined) => {
    const f = app[k];
    if (typeof f !== 'function') return;
    app[k] = (...a) => { const r = f(...a); app.emit(ev, data()); return r; };
  };
  wrap('commit', 'commit', () => app.S.board);
  wrap('quiet', 'quiet', () => app.S.board);
  wrap('selectionChanged', 'selection', () => [...app.S.sel]);
  wrap('render', 'render');
  // une planche qui s'ouvre (openBoard ne passe pas toujours par commit)
  let boardId = null;
  const checkBoard = () => {
    const id = app.S.board?.id || null;
    if (id !== boardId) { boardId = id; app.emit('board', app.S.board); }
  };
  for (const ev of ['commit', 'quiet', 'render', 'selection']) app.on(ev, checkBoard);
  setInterval(checkBoard, 500);
  for (const [name, load] of PLUGINS) {
    load().then((m) => m.install(app)).catch((e) => console.error(`idéation · module ${name}`, e));
  }
}
