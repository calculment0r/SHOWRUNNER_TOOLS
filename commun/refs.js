// SHOWRUNNER TOOLS — la règle commune des références (Cal, 29/09 au soir :
// « on n'affecte pas un @image1 à un visuel : quand on le change d'ordre, il
// prend l'adresse de sa place dans le carrousel des images réf input »).
// Une seule règle pour tous les outils qui prennent des références : Image
// (la barre), Vidéo (les entrées, commun/entrees.js), les cartes Générer
// image et Générer vidéo d'Idéation, et refBoard ci-dessous.
//
//   1. Les références forment un carrousel ordonné ; l'ordre se change en les
//      glissant (ou Alt + ← →, la vignette ayant le clavier) et s'annule par
//      Ctrl+Z (la pile de la page : l'outil range le geste).
//   2. Une adresse (@image1, <image1> pour Qwen, « la scène » pour Krea 2)
//      désigne une PLACE, jamais un visuel : réordonner change qui est
//      @image1, les pastilles suivent, le texte du prompt ne change pas.
//   3. Le modèle choisi envoie les N premières places (N : ce qu'il prend) ;
//      les suivantes restent dans le carrousel, grisées, non envoyées, avec la
//      raison au survol. Changer de modèle ne retire jamais une référence :
//      revenir à un modèle qui en prend plus les rallume.
//   4. On n'ajoute pas au-delà de ce que prend le modèle choisi : le « + » dit
//      pourquoi (une action éteinte dit pourquoi).
//   5. Le serveur applique la même règle : il reçoit le carrousel entier et
//      n'envoie au modèle que les N premières (server/tools/image.py,
//      split_refs) — une seule vérité, lue des deux côtés dans /api/image/models.
//
// Rien ici ne dessine une couleur : les états sont des classes (`held`,
// `dragging`, `drop-before`, `drop-after`) que la feuille de chaque outil
// habille avec les jetons.

import { el, pick, dropZone, toast } from './shell.js';
import { pickView, needOf } from './proxies.js';

// ── la règle ────────────────────────────────────────────────
// `send` : ce que le modèle prend (null : pas encore lu — rien n'est grisé sur une supposition)
export const sentCount = (total, send) => (send == null ? total : Math.max(0, Math.min(total, send)));
export const isHeld = (k, send) => send != null && k >= send;
// ce que dit le bouton d'envoi : « 2 sur 5 envoyées » ('' quand tout part)
export function sentLabel(total, send) {
  const n = sentCount(total, send);
  return n < total ? `${n} sur ${total} envoyée${n > 1 ? 's' : ''}` : '';
}
// la raison au survol d'une référence grisée
export const heldTitle = (why) => `non envoyée — ${why}`;
// une place prise et posée ailleurs : les autres glissent d'une place
export function moveItem(list, from, to) {
  const l = list.slice();
  if (from < 0 || from >= l.length) return l;
  const [x] = l.splice(from, 1);
  l.splice(Math.max(0, Math.min(l.length, to)), 0, x);
  return l;
}

// ── glisser pour réordonner ─────────────────────────────────
// sortable(box, { item, onmove(from, to), stop }) : les enfants de `box` qui
// répondent à `item` se réordonnent au glisser (bouton gauche seulement : le
// bouton du milieu reste à la page — déplacer la vue) ; un simple clic reste
// un clic. `onmove(from, to)` reçoit les places, 0 d'abord. `stop` : le
// geste ne remonte pas (une carte d'Idéation ne part pas avec la vignette).
// Au clavier : Alt + ← → sur une vignette qui a le focus.
export function sortable(box, { item = '[data-k]', onmove = () => {}, stop = false } = {}) {
  let drag = null;
  const list = () => [...box.children].filter((n) => n.matches(item));
  const clear = () => list().forEach((n) => n.classList.remove('drop-before', 'drop-after', 'dragging'));
  // la place visée : la vignette la plus proche du pointeur, avant ou après elle
  function target(x, y) {
    let best = null;
    for (const [k, n] of list().entries()) {
      const r = n.getBoundingClientRect();
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (!best || d < best.d) best = { k, n, d, after: x > r.left + r.width / 2 };
    }
    return best;
  }
  box.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const n = e.target.closest?.(item);
    if (!n || n.parentElement !== box || e.target.closest('.x, [data-nodrag]')) return;
    if (stop) e.stopPropagation();
    drag = { n, from: list().indexOf(n), x: e.clientX, y: e.clientY, id: e.pointerId, on: false, to: null };
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.on) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      drag.on = true;
      try { box.setPointerCapture(e.pointerId); } catch { /* le pointeur est déjà parti */ }
      drag.n.classList.add('dragging');
    }
    if (stop) e.stopPropagation();
    const t = target(e.clientX, e.clientY);
    list().forEach((n) => n.classList.remove('drop-before', 'drop-after'));
    if (!t || t.n === drag.n) { drag.to = null; return; }
    t.n.classList.add(t.after ? 'drop-after' : 'drop-before');
    let to = t.k + (t.after ? 1 : 0);
    if (to > drag.from) to -= 1;          // la place une fois la vignette retirée
    drag.to = to === drag.from ? null : to;
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    clear();
    if (!d.on) return;
    if (stop) e.stopPropagation();
    dropped = Date.now();
    if (e.type === 'pointerup' && d.to !== null) onmove(d.from, d.to);
  };
  // le clic qui suit un glisser n'ouvre rien (seulement dans le carrousel)
  let dropped = 0;
  box.addEventListener('click', (c) => { if (Date.now() - dropped < 400) { c.stopPropagation(); c.preventDefault(); dropped = 0; } }, true);
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  box.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const n = e.target.closest?.(item);
    if (!n || n.parentElement !== box) return;
    const from = list().indexOf(n), to = from + (e.key === 'ArrowLeft' ? -1 : 1);
    if (to < 0 || to >= list().length) return;
    e.preventDefault();
    onmove(from, to);
    requestAnimationFrame(() => list()[to]?.focus());
  });
  return box;
}

// ── la planche de références d'un outil ─────────────────────
// refBoard(box, { kinds, max, send, heldWhy, onchange, label, via }) : un
// carrousel de vignettes numérotées par leur place, « + » qui ouvre le
// sélecteur ; on y dépose aussi des fichiers du disque ou des vignettes.
//   max      ce que prend le carrousel (le plus grand des modèles de l'outil)
//   send()   ce que prend le modèle choisi (les suivantes sont grisées)
//   heldWhy() la raison dite au survol d'une grisée
export function refBoard(box, { kinds = ['image', 'element'], max = 3, send = () => max, heldWhy = () => '',
  onchange = () => {}, label = 'réf.', via = '' } = {}) {
  const refs = [];
  const room = () => Math.min(max, send() ?? max);
  const add = (items) => {
    const before = refs.length;
    for (const it of items) if (refs.length < room() && !refs.some((r) => r.id === it.id)) refs.push(it);
    if (items.length && refs.length - before < items.length && refs.length >= room()) toast(`${room()} références au plus`);
    paint(); onchange(refs);
  };
  box.classList.add('refs');
  dropZone(box, { kinds, via, onitems: add });
  sortable(box, { item: '.ref-chip[data-k]', onmove: (a, b) => { const l = moveItem(refs, a, b); refs.splice(0, refs.length, ...l); paint(); onchange(refs); } });
  function paint() {
    // la copie d'affichage de la case (64 px, remplie : commun/proxies.js), pas la vignette de 384
    const src = (it) => pickView(it, needOf(it, 64, 64)).url;
    const n = send();
    // replaceChildren(null) écrirait « null » : on ne passe que des nœuds
    box.replaceChildren(...[...refs.map((it, i) => {
      const held = isHeld(i, n);
      return el('div', { class: 'ref-chip' + (held ? ' held' : ''), 'data-k': i, tabindex: 0,
        title: held ? heldTitle(heldWhy()) : `${label} ${i + 1} · ${it.title} — glisser pour changer sa place`,
        style: { backgroundImage: src(it) ? `url("${src(it)}")` : null } },
      el('span', { class: 'n' }, `${i + 1} · ${it.title}`),
      el('button', { class: 'x', type: 'button', title: 'retirer', onclick: () => { refs.splice(i, 1); paint(); onchange(refs); } }, '×'));
    }),
    refs.length < room() ? el('button', { class: 'ref-chip add', type: 'button', title: 'ajouter une référence', onclick: async () => {
      add(await pick({ kinds, multiple: true, title: `Références (${room()} au plus)` }));
    } }, '+') : null].filter(Boolean));
  }
  paint();
  return { get: () => refs.slice(), sent: () => refs.slice(0, sentCount(refs.length, send())),
    set: (list) => { refs.splice(0, refs.length, ...list.slice(0, max)); paint(); onchange(refs); }, paint };
}
