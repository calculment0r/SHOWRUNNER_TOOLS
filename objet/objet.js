// OBJECT CREATOR — un objet est un élément de la bibliothèque (sorte
// `object`) : l'image que Cal choisit, ses vues (références de rôle
// `view`), les GLB tirés par TRELLIS.2 (`element.meshes`), leurs rendus,
// et sa planche pour H3 (référence de rôle `sheet`).
//
//   objet/          les objets et l'état de la chaîne
//   objet/#<id>     la fiche d'un objet
//
// Décision de Cal (28/09, Character_Factory/docs/BRIEF_CAL_2026-09-28.md
// §8 et §10) : une image validée → des vues par nos modèles → TRELLIS sur
// ces vues ; pas de Pixal3D. Puis le 09/10 : « quand je donne l'image d'une
// voiture en perspective, il ne me propose pas automatiquement de faire les
// vues dont il a besoin … on valide les vues principales, et si on valide on
// refait plus de vues avec nos vues validées ». Le parcours, et ce qui le
// fonde : server/tools/objet_vues.py, docs/etudes/objet_scenes_3d.md —
//   1. l'image arrive : le plan des vues est là (les quatre principales), le
//      modèle qui voit dit ce qu'elle montre et d'où (s'il est là) ;
//   2. « Générer » : un travail par vue ; chaque vue se garde, se refait, se
//      rejette ;
//   3. les principales décidées : « Plus de vues » (les 3/4 et le dessus),
//      chacune depuis la vue gardée la plus proche ;
//   4. la 3D (TRELLIS.2, image unique), ses rendus, la planche pour H3.
// Les générateurs, les rendus et TRELLIS.2 ont leur interrupteur (Admin →
// Câblage) ; sans eux, des factices étiquetés montrent tout le parcours.
//
// L'annulation (commun/undo.js) : créer un objet (il part à la corbeille), le
// renommer, sa description, son image, d'où on la voit, ce qu'elle est,
// garder / rejeter une vue (rouvrir est leur contraire), poser une image en
// vue. Ne s'annulent pas : un calcul lancé (vues, 3D, rendus, planche), un
// fichier déposé.
import { mountHeader, api, jobs, pick, el, $, $$, href, fmtDate, uploadFile, dropAnywhere, dropZone, dock, stateFr } from '../commun/shell.js';
import { createUndo, libPatch, libBoard, libTrash, keyLabel } from '../commun/undo.js';
import { contextMenu, pageMenu, menu } from '../commun/menu.js';
import { prefs } from '../commun/prefs.js';
import { reducedMotion } from '../commun/theme.js';

// Un fichier déposé ici entre dans la bibliothèque comme tout dépôt du
// disque : catégorie Upload, entré par Object Creator (shell.js, uploadFile).
const UP = { tool: 'upload', via: 'objet' };

mountHeader('object');

const app = $('#app');
const live = (t) => { $('#live').textContent = t; };
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const MAQUETTE = 'http://192.168.10.247:8765/docs/img/maquettes/objets.html';
const ETUDE = 'docs/etudes/objet_scenes_3d.md';
const SRC = {
  trellis: 'https://github.com/microsoft/TRELLIS.2',
  pipe: 'https://github.com/microsoft/TRELLIS.2/blob/main/trellis2/pipelines/trellis2_image_to_3d.py',
  card: 'https://huggingface.co/microsoft/TRELLIS.2-4B',
  orbit: 'https://huggingface.co/ML-Intern-lab/Qwen-Image-2.1-viewpoint-orbit-LoRA',
  pr104: 'https://github.com/microsoft/TRELLIS.2/pull/104',
  fal: 'https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA',
  anyangle: 'https://huggingface.co/lilylilith/QI_2.1_AnyAngle',
};
// les angles (objet_vues.py) : l'azimut depuis la face, vers la GAUCHE de l'objet (90° : son côté gauche)
const AZ = { 0: 'face', 45: '3/4 avant gauche', 90: 'gauche', 135: '3/4 arrière gauche', 180: 'dos', 225: '3/4 arrière droit', 270: 'droite', 315: '3/4 avant droit' };
const EL = { 0: 'hauteur d’œil', 30: 'surélevé', 60: 'plongée', 90: 'dessus' };
const angleLabel = (az, el) => (el === 90 ? 'dessus · 90°' : `${AZ[az]} · ${az}°${el ? ` · ${EL[el].split(' ')[0]} ${el}°` : ''}`);
const CLASSES = [['objet', 'objet'], ['batiment', 'bâtiment'], ['decor', 'décor extérieur'], ['interieur', 'pièce intérieure'], ['personnage', 'personnage']];
const STATE = { prevue: 'prévue', file: 'en file', proposee: 'à valider', gardee: 'gardée', rejetee: 'rejetée', echec: 'échec', source: 'l’image choisie' };

// la boussole d'une vue, vue de dessus : l'objet au centre, sa face en bas, la caméra sur le cercle
// (90°, son côté gauche, à droite : quand il nous fait face) ; les couleurs sont celles de objet.css
function compassSvg(az, el, { big = false } = {}) {
  const r = 38 * (el >= 90 ? 0 : Math.cos((el * Math.PI) / 180));
  const x = 50 + r * Math.sin((az * Math.PI) / 180), y = 50 + r * Math.cos((az * Math.PI) / 180);
  return `<svg class="compass${big ? ' big' : ''}" viewBox="0 0 100 100" aria-hidden="true"><circle class="ring" cx="50" cy="50" r="38"/>`
    + '<rect class="obj" x="41" y="41" width="18" height="18" rx="2"/><line class="front" x1="41" y1="59" x2="59" y2="59"/>'
    + `<line class="ray" x1="50" y1="50" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/><circle class="cam" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6"/></svg>`;
}

// ── l'icône, tirée des jetons ────────────────────────────────
(function favicon() {
  const cs = getComputedStyle(document.documentElement);
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = cs.getPropertyValue('--or').trim();
  g.beginPath(); g.roundRect(0, 0, 32, 32, 6); g.fill();
  g.fillStyle = cs.getPropertyValue('--on-or').trim();
  g.beginPath(); g.roundRect(12, 12, 8, 8, 2); g.fill();
  $('link[rel="icon"]').href = c.toDataURL();
})();

// ── l'annulation ─────────────────────────────────────────────
// après un Ctrl+Z, la vue ouverte se repeint depuis le serveur
const U = createUndo({ name: 'object', onapply: () => {
  const h = decodeURIComponent(location.hash.slice(1));
  if (ID_RX.test(h)) paintObject(h, { keepScroll: true }); else paintHome();
} });
const undoGroup = () => el('span', { class: 'sr-undo', role: 'group', 'aria-label': 'annuler, rétablir' }, ...U.buttons());

// ── le bandeau ───────────────────────────────────────────────
// « annuler » dans le bandeau est Ctrl+Z : le geste qu'il vient d'annoncer (undo = true)
let toastT;
function say(msg, undo = false) {
  let t = $('.a-toast');
  if (!t) {
    t = el('div', { class: 'a-toast', role: 'status' }, el('span', { class: 't' }), el('button', { class: 'linkish', type: 'button' }, 'annuler'));
    document.body.append(t);
  }
  $('.t', t).textContent = msg;
  $('.toast.on')?.classList.remove('on');   // un seul bandeau : celui de shell.js (dépôts) s'efface
  const b = $('button', t);
  const top = undo ? U.done[U.done.length - 1] : null;
  b.hidden = !top;
  b.title = top ? `${U.labels().undo} · ${keyLabel('undo')}` : '';
  b.onclick = async () => {
    t.classList.remove('on');
    if (U.done[U.done.length - 1] !== top) { say('ce geste n’est plus le dernier : le journal (↺) y ramène'); return; }
    await U.undo();
  };
  t.classList.add('on');
  live(msg);
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 6000);
}

function modal({ title, body, foot }) {
  const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('div', { class: 'modal-head' }, el('span', { class: 't' }, title)),
    el('div', { class: 'modal-body' }, ...body), el('div', { class: 'modal-foot' }, ...foot));
  const scrim = el('div', { class: 'scrim' }, box);
  const last = document.activeElement;
  const close = () => { scrim.remove(); document.removeEventListener('keydown', esc); last?.focus?.(); };
  const esc = (e) => { if (e.key === 'Escape' && !$('.scrim.picker')) close(); };
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', esc);
  document.body.append(scrim);
  return { close };
}

// ── l'adresse ────────────────────────────────────────────────
const ID_RX = /^ele-\d{8}-\d{6}-[0-9a-f]{4}$/;
let stateP = null;
const state = (fresh = false) => { if (fresh || !stateP) stateP = api('objet/state').catch((e) => ({ error: e.message })); return stateP; };

async function render() {
  const h = decodeURIComponent(location.hash.slice(1));
  window.scrollTo({ top: 0 });
  if (ID_RX.test(h)) return paintObject(h);
  return paintHome();
}
addEventListener('hashchange', render);

// ══ L'ACCUEIL : la chaîne, les objets ═══════════════════════
async function paintHome() {
  S.obj = null;
  S.plan = null;
  dock.contexte(null);   // les filtres de l'outil : images, « un nouvel objet »
  app.replaceChildren(el('p', { class: 'lbl' }, 'chargement'));
  let objs;
  try { objs = await api('objet/objects'); } catch (e) { app.replaceChildren(el('p', { class: 'warn' }, `le portail ne répond pas : ${e.message}`)); return; }
  const chain = el('aside', { class: 'chain' }, el('p', { class: 'lbl', style: { padding: '14px 18px' } }, 'lecture de la chaîne'));
  state().then((st) => chain.replaceWith(chainPanel(st)));
  app.replaceChildren(
    el('section', { class: 'o-top' },
      el('div', { class: 'o-hero' },
        el('span', { class: 'kicker' }, 'SR—04 · object creator'),
        el('h1', { class: 'big' }, 'Objets'),
        el('p', { class: 'prose' }, 'Une image arrive — faite dans Image ou déposée — et l\'outil propose aussitôt les vues qu\'il faut : la face, les côtés, le dos. Tu valides les principales, il en refait d\'autres à partir de celles que tu as gardées, puis la 3D, ses rendus et la planche pour une vidéo. Chaque objet est un élément de la bibliothèque : on l\'appelle ensuite dans une image ou un plan, comme un personnage.'),
        el('div', { class: 'row' },
          el('button', { class: 'tb go', type: 'button', onclick: () => newObject() }, 'Nouvel objet'),
          el('a', { class: 'tb ghost', href: href('image/?for=object') }, 'Créer son image dans Image'),
          el('a', { class: 'tb ghost', href: href('asset/') }, 'La bibliothèque'), undoGroup())),
      chain),
    el('div', { class: 'sect-head' }, el('h2', {}, 'Les objets'), el('span', { class: 'cnt' }, plural(objs.items.length, 'objet', 'objets'))),
    el('div', { class: 'objs', role: 'list' }, ...(objs.items.length ? objs.items.map(objCard) : [
      el('div', { class: 'empty-state' }, el('b', {}, 'Aucun objet'),
        el('p', { class: 'hint' }, 'Un nom et une image suffisent pour commencer : « Nouvel objet », ou dépose une image n\'importe où sur la page.'))])),
    studyBlock());
}

function st(cls, txt) { return el('span', { class: `st ${cls}` }, txt); }

// pourquoi TRELLIS.2, câblé, ne peut pas partir : le gabarit, puis chaque machine
function notReady(s) {
  const t = s?.trellis || {};
  if (s?.error) return `l'état de la chaîne est illisible (${s.error})`;
  if (!t.template_ok) return `le graphe TRELLIS.2 de Character Factory est introuvable (${t.template})`;
  if (!(t.machines || []).length) return 'aucune machine ComfyUI dans la voie « image »';
  return t.machines.map((m) => (m.up ? `${m.machine} : il manque ${(m.missing || []).join(', ')}` : `${m.machine} ne répond pas`)).join(' ; ');
}

function chainPanel(s) {
  const t = s?.trellis || {};
  const gen = s?.vues?.gen || { id: 'factice', name: 'factice' };
  const machines = (t.machines || []).map((m) => (m.up ? (m.missing?.length ? `${m.machine} : il manque ${m.missing.join(', ')}` : `${m.machine} : modèles présents`) : `${m.machine} : ne répond pas`));
  const step = (n, name, badge, ...p) => el('div', { class: 'step' }, el('span', { class: 'n' }, n), el('span', { class: 'nm' }, name), badge, el('p', {}, ...p));
  const a = (txt, url) => el('a', { href: url, target: '_blank', rel: 'noopener' }, txt);
  return el('aside', { class: 'chain', 'aria-label': 'la chaîne objet' },
    el('div', { class: 'chain-head' }, el('h2', {}, 'La chaîne objet'), el('span', { class: 'lbl' }, 'ce qui marche · ce qui attend')),
    step('01', 'Son image', st('ok', 'prête'),
      'Krea 2 dans ', el('a', { href: href('image/?for=object') }, 'Image'), ', ou une image déposée. Le modèle qui voit dit ce qu\'elle montre (objet, bâtiment, décor, pièce, personnage) et d\'où.'),
    step('02', 'Ses vues', gen.id === 'factice' ? st('wait', 'factice') : st('ok', 'câblé'),
      'Proposées à l\'arrivée : les quatre principales, puis les 3/4 et le dessus depuis celles qu\'on garde. ',
      gen.id === 'factice' ? 'Générateur factice ici : une mire par vue (Admin → Câblage → « Object Creator · vues »). '
        : `Générateur : ${gen.name} (${gen.sub}). `,
      'Candidats : ', a('Qwen-Edit 2511 · angles', SRC.fal), ' (installé), ', a('AnyAngle', SRC.anyangle), ' (depuis un rendu du modèle 3D).'),
    step('03', 'Sa 3D · TRELLIS.2', t.wired ? (t.ready ? st('ok', 'câblé') : st('wait', 'câblé · attend')) : st('wait', 'pas câblé'),
      'Une seule image, carrée, détourée, 1024 px, sans marge : la seule entrée documentée (',
      a('pipeline', SRC.pipe), '). Les vues gardées attendent une reconstruction multi-vues. ',
      t.wired ? (t.ready ? '≈ 2 min 40 sur DGX1 (30/09), un travail GPU à la fois par machine.' : `Câblé, mais ${notReady(s)}.`)
        : 'Pas encore câblé ici : un cube de contrôle, marqué factice.',
      machines.length ? el('span', { class: 'lbl', style: { display: 'block', marginTop: '6px' } }, machines.join(' · ')) : null),
    step('04', 'Rendus · planche', s?.vues?.rendus?.wired ? st('ok', 'câblé') : st('wait', 'factice'),
      'Le modèle vu des mêmes angles (Render Mesh de ComfyUI), et la planche face · profil · dos que Vidéo envoie à H3.'),
    step('05', 'Sa taille · à qui il est', st('off', 'plus tard'),
      'Mesurée sur le plein pied de son personnage, puis l\'attache : dessinées dans la maquette, pas commencées.'),
    el('div', { class: 'chain-foot' },
      el('a', { href: MAQUETTE, target: '_blank', rel: 'noopener' }, 'la maquette ↗'),
      el('a', { href: '#etude' }, 'les études ↓'),
      el('a', { href: SRC.trellis, target: '_blank', rel: 'noopener' }, 'TRELLIS.2 ↗'),
      el('a', { href: SRC.card, target: '_blank', rel: 'noopener' }, 'sa carte ↗')));
}

// ce qui fonde la page, avec ses sources : l'étude du 28/09 (hors dépôt) et celle du 09/10
function studyBlock() {
  const row = (k, v) => [el('dt', {}, k), el('dd', {}, ...v)];
  const a = (txt, url) => el('a', { href: url, target: '_blank', rel: 'noopener' }, txt);
  return el('details', { class: 'blk', id: 'etude' },
    el('summary', { class: 'blk-head', style: { cursor: 'pointer', paddingBottom: '14px' } }, el('span', { class: 'ttl' }, 'les études · ce qu\'attendent les modèles'), el('span', { class: 'lbl' }, 'ouvrir')),
    el('div', { class: 'blk-body' },
      el('dl', { class: 'facts' },
        ...row('images', ['TRELLIS.2 en lit une : ', el('code', {}, 'run(self, image)'), ' — ', a('pipeline', SRC.pipe), '. Plusieurs : rien d\'officiel (', a('PR 104', SRC.pr104), ').']),
        ...row('vues', ['le 28/09 : Krea 2 1/4, Qwen 2.1 turbo 0/4, ', a('LoRA d\'orbite', SRC.orbit), ' 1/3. Le 09/10 : deux LoRA d\'angles pour Qwen et AnyAngle, qui prend l\'angle dans un rendu du modèle 3D — l\'étude les compare.']),
        ...row('angles', ['l\'azimut se compte depuis la face, vers la gauche de l\'objet : 90° voit son côté gauche (la convention de Pixal3D et des nœuds multi-vues de ComfyUI).']),
        ...row('planche', ['la forme de celle des personnages pour H3 : face, profil, dos, fond blanc ; aucun guide MiniMax ne documente celle d\'un objet.']),
        ...row('non documenté', ['l\'angle exact d\'une vue générée ; la face du GLB de TRELLIS.2 (réglable sur la fiche) ; objets fins, transparents, brillants.'])),
      el('p', { class: 'hint' }, `L'étude du 09/10 : ${ETUDE} (le dépôt). Celle du 28/09 : ETUDE_OBJETS.md, hors dépôt.`)));
}

function lastMesh(o) { return (o.element.meshes || []).at(-1); }
function viewsOf(o) { return o.element.refs.map((r, i) => ({ ...r, i })).filter((r) => r.role === 'view'); }

function objCard(o) {
  const views = viewsOf(o);
  const m = lastMesh(o);
  const kept = Math.max(0, views.length - 1);
  const sheet = o.element.refs.some((r) => r.role === 'sheet');
  const badge = m ? (m.factice ? st('wait', '3D factice') : st('ok', '3D')) : st('off', 'pas de 3D');
  const card = el('a', { class: 'ocard', href: '#' + o.id, role: 'listitem', 'aria-label': `objet ${o.title}` },
    el('div', { class: 'pic' }, o.thumb_url ? el('img', { src: href(o.thumb_url), alt: '', loading: 'lazy' }) : null,
      el('span', { class: 'kind' }, 'objet'), el('span', { class: 'badge' }, badge)),
    el('div', { class: 'cap' }, el('span', { class: 'nm' }, o.title),
      el('div', { class: 'ticks-mini', title: 'image · vues · 3D · planche' }, el('i', { class: views.length ? 'done' : '' }),
        el('i', { class: kept >= 3 ? 'done' : kept ? 'wait' : '' }), el('i', { class: m ? (m.factice ? 'wait' : 'done') : '' }),
        el('i', { class: sheet ? 'done' : '' })),
      el('span', { class: 'lbl' }, `${plural(kept, 'vue gardée', 'vues gardées')} · ${fmtDate(o.updated)}`)));
  // le clic droit sur la carte : ses gestes
  card._menu = () => [{ head: `objet · ${o.title}` },
    { label: 'Ouvrir', icon: '⤢', onclick: () => { location.hash = '#' + o.id; } },
    { label: 'Dans la bibliothèque', icon: '▦', onclick: () => { location.href = href(`asset/#${o.id}`); } },
    { label: 'Référence vidéo', icon: '◎', onclick: () => { location.href = href(`movie/?ref=${encodeURIComponent(o.id)}`); } },
    '-',
    { label: 'Mettre à la corbeille', icon: '×', danger: true, sub: 'Ctrl+Z le rend', onclick: async () => {
      try { await libTrash(U, o, `mettre l’objet « ${o.title} » à la corbeille`); say(`« ${o.title} » est à la corbeille`, true); paintHome(); } catch (err) { say(err.message); }
    } }];
  return card;
}

// ── un objet neuf ────────────────────────────────────────────
function newObject({ item = null } = {}) {
  let chosen = item;
  const name = el('input', { class: 'fld big-fld', id: 'no-name', maxlength: 80, placeholder: 'sac de toile, lunettes rondes, voiture rouge…', spellcheck: 'false', value: item?.title || '' });
  const desc = el('textarea', { class: 'fld', rows: 3, placeholder: 'ce que c\'est : matières, couleurs, taille, détails — la prose que les modèles liront' });
  const prev = el('div', { class: 'prev none' });
  const why = el('span', { class: 'why lbl' });
  const create = el('button', { class: 'tb go', type: 'submit', form: 'no-form' }, 'Créer l\'objet');
  const paint = () => {
    prev.className = 'prev' + (chosen ? '' : ' none');
    prev.style.backgroundImage = chosen ? `url(${href(chosen.thumb_url || chosen.url)})` : '';
    const miss = !chosen ? 'il lui faut une image' : !name.value.trim() ? 'il lui faut un nom' : '';
    create.disabled = !!miss;
    create.title = miss;
    why.textContent = miss;
  };
  const fileIn = el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
    const f = fileIn.files[0];
    if (!f) return;
    why.textContent = 'envoi de l\'image';
    try { chosen = await uploadFile(f, UP); if (!name.value) name.value = chosen.title; } catch (e) { say(e.message); }
    paint();
  } });
  name.addEventListener('input', paint);
  const pickBox = el('div', { class: 'src-pick', title: 'dépose une image ici : de ton disque, ou une vignette glissée' });
  dropZone(pickBox, { kinds: ['image'], multiple: false, via: 'objet', onitems: ([it]) => {
    chosen = it;
    if (!name.value) name.value = it.title;
    paint();
  } });
  pickBox.append(prev, el('div', { class: 'row' },
    el('button', { class: 'tb ghost', type: 'button', onclick: async () => {
      const [it] = await pick({ kinds: ['image'], title: 'L\'image de l\'objet', upload: true });
      if (it) { chosen = it; if (!name.value) name.value = it.title; paint(); }
    } }, 'Dans la bibliothèque'),
    el('button', { class: 'tb ghost', type: 'button', onclick: () => fileIn.click() }, 'Déposer une image'),
    el('a', { class: 'tb ghost', href: href('image/?for=object') }, 'La créer dans Image ↗'), fileIn));
  const form = el('form', { id: 'no-form', autocomplete: 'off', style: { display: 'contents' } },
    el('div', { class: 'q-row' }, el('label', { class: 'new-q', for: 'no-name' }, 'Comment s\'appelle-t-il ?'), name),
    el('div', { class: 'q-row' }, el('span', { class: 'lbl' }, 'son image · la seule que tu valides · on peut la déposer ici'), pickBox,
      el('p', { class: 'hint' }, 'L\'objet entier, sur un fond simple, sous n\'importe quel angle : les vues qui manquent sont proposées ensuite.')),
    el('div', { class: 'q-row' }, el('span', { class: 'lbl' }, 'ce que c\'est'), desc));
  const m = modal({ title: 'nouvel objet', body: [form], foot: [why, el('span', { class: 'sp' }),
    el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Pas encore'), create] });
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (create.disabled) return;
    try {
      // créer se défait en mettant l'objet à la corbeille ; le rétablir l'en sort
      let made = null;
      const title = name.value.trim(), description = desc.value.trim(), item = chosen.id;
      const o = await U.run({ label: `créer l’objet « ${title} »`,
        do: async () => {
          if (made) { await api(`library/${made.id}/restore`, { method: 'POST' }); return made; }
          made = await api('objet/objects', { method: 'POST', body: { title, description, item } });
          return made;
        },
        undo: async (x) => { await api(`library/${x.id}/delete`, { method: 'POST' }); if (location.hash === '#' + x.id) location.hash = ''; } });
      m.close();
      say(`Objet « ${o.title} » créé : ses vues sont prévues`, true);
      S.arrive = o.id;   // à l'arrivée : le modèle qui voit, s'il est là et si la préférence le veut
      location.hash = '#' + o.id;
    } catch (err) { say(err.message); }
  };
  paint();
  setTimeout(() => name.focus(), 30);
}

// ══ LA FICHE D'UN OBJET ═════════════════════════════════════
let viewer = null;
async function paintObject(id, { keepScroll = false } = {}) {
  const y = scrollY;
  if (!keepScroll) app.replaceChildren(el('p', { class: 'lbl' }, 'chargement'));
  let o, plan;
  try { [o, plan] = await Promise.all([api('library/' + id), api(`objet/${id}/vues`).catch(() => null)]); } catch (e) {
    app.replaceChildren(el('a', { class: 'o-back', href: '#' }, '‹ objets'), el('div', { class: 'empty-state' }, el('b', {}, 'Introuvable'),
      el('p', { class: 'hint' }, `${id} : ${e.message}. Il est peut-être à la corbeille de la bibliothèque.`),
      el('a', { class: 'tb ghost', href: href('asset/#/corbeille') }, 'La corbeille')));
    return;
  }
  if (o.kind !== 'element' || o.element.type !== 'object' || !plan) {
    app.replaceChildren(el('a', { class: 'o-back', href: '#' }, '‹ objets'), el('div', { class: 'empty-state' }, el('b', {}, 'Pas un objet'),
      el('p', { class: 'hint' }, `« ${o.title} » est un ${o.kind === 'element' ? 'élément d\'une autre sorte' : o.kind}. Sa sorte se change dans sa fiche.`),
      el('a', { class: 'tb ghost', href: href(`asset/#${o.id}`) }, 'Sa fiche dans la bibliothèque')));
    return;
  }
  const s = await state();
  viewer?.stop();
  S.plan = plan;
  app.replaceChildren(...objectSheet(o, s, plan));
  if (keepScroll) scrollTo({ top: y });
  followJob(o);
  // à l'arrivée d'un objet neuf : ce qu'est l'image et d'où, demandé au modèle qui voit (préférence)
  if (S.arrive === id) {
    S.arrive = null;
    if (prefs.get('object.classer_auto', true) && s?.vues?.vision?.ready && !plan.classe.value) classer(o, { quiet: true });
  }
}

// la prochaine étape : le seul bouton orange de la fiche (thème, règle 4)
function nextStep(o, P) {
  const slots = P.vues.slots.filter((x) => x.pass);
  const m = lastMesh(o);
  if (P.go.ok && slots.some((x) => x.state === 'prevue' || x.state === 'echec')) return 'generer';
  if (slots.some((x) => x.state === 'file' || x.state === 'proposee')) return null;   // les vues attendent qu'on les regarde
  if (P.pass_open.ok) return 'plus';
  if (!m) return '3d';
  if (!(m.rendus || []).length) return 'rendus';
  if (!o.element.refs.some((r) => r.role === 'sheet') && !sheetWhy(o, P)) return 'planche';
  return null;
}

// la planche (objet_vues.sheet_why) : la face, et un profil ou le dos, gardés
function sheetWhy(o, P) {
  const az = new Set(o.element.refs.filter((r) => r.role === 'view' && Number.isInteger(r.az) && !r.el).map((r) => r.az));
  P.vues.slots.filter((x) => x.state === 'gardee' && !x.el).forEach((x) => az.add(x.az));
  if (P.vues.slots[0] && !P.vues.slots[0].el) az.add(P.vues.slots[0].az);
  if (!az.has(0)) return 'la planche part de la face (0°) : garde-la, ou dis que l’image choisie la montre';
  if (![90, 270, 180].some((a) => az.has(a))) return 'il faut la face et au moins un profil ou le dos, gardés';
  return '';
}

function objectSheet(o, s, P) {
  const e = o.element;
  const V = P.vues;
  const src = V.slots[0];
  const main = e.refs.find((r) => r.file === src?.ref) || viewsOf(o)[0] || e.refs[0];
  const m = lastMesh(o);
  const wired = !!s?.trellis?.wired;
  const kept = V.slots.filter((x) => x.state === 'gardee').length;
  const sheet = e.refs.filter((r) => r.role === 'sheet').at(-1);
  const step = nextStep(o, P);
  const btn = (id, label, attrs = {}) => el('button', { class: `tb ${step === id ? 'go' : 'ghost'}`, type: 'button', id: `b-${id}`, ...attrs }, label);

  // l'en-tête
  const saved = el('span', { class: 'saved' }, 'enregistré');
  const name = el('input', { class: 'o-name', value: o.title, maxlength: 80, 'aria-label': 'nom de l\'objet', spellcheck: 'false' });
  name.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') name.blur(); if (ev.key === 'Escape') { name.value = o.title; name.blur(); } });
  name.addEventListener('change', async () => {
    const v = name.value.trim();
    if (!v || v === o.title) { name.value = o.title; return; }
    try { Object.assign(o, await libPatch(U, o.id, { title: v }, `renommer « ${o.title} » en « ${v} »`, { before: o })); saved.classList.add('on'); setTimeout(() => saved.classList.remove('on'), 1600); } catch (err) { say(err.message); }
  });
  const tick = (cls, txt) => el('span', { class: `tick ${cls}` }, el('i'), el('span', {}, txt));
  const running = V.slots.some((x) => x.state === 'file');
  const head = el('section', { class: 'o-head' },
    el('div', { class: 'who' }, el('a', { class: 'o-back', href: '#' }, '‹ objets'), name,
      el('div', { class: 'o-specs' }, el('span', {}, 'objet'), main?.width ? el('span', {}, `${main.width} × ${main.height}`) : null,
        el('span', {}, plural(kept, 'vue gardée', 'vues gardées')), el('span', {}, m ? (m.factice ? '3D factice' : '3D') : 'pas de 3D'),
        sheet ? el('span', {}, 'planche') : null, saved)),
    el('div', { class: 'o-act' },
      el('div', { class: 'ticks', 'aria-label': 'avancement' }, tick(main ? 'done' : 'wait', 'image'),
        tick(running ? 'run' : kept >= 3 ? 'done' : kept ? 'wait' : '', 'vues'),
        tick(m && !m.factice ? 'done' : m ? 'wait' : '', '3D'), tick((m?.rendus || []).length ? (m.rendus_meta?.factice ? 'wait' : 'done') : '', 'rendus'),
        tick(sheet ? 'done' : '', 'planche')),
      undoGroup(), el('a', { class: 'tb ghost', href: href(`asset/#${o.id}`) }, 'Dans la bibliothèque')),
    wiringLine(s, P));

  // la colonne de l'image : elle, ce qu'elle est, d'où on la voit, ce que c'est
  const hero = el('figure', { class: 'blk', style: { margin: 0 } },
    el('div', { class: 'pic-big' }, main ? el('img', { src: href(main.url), alt: `l'image de ${o.title}` }) : null,
      el('span', { class: 'src-tag' }, 'image choisie'),
      el('figcaption', {}, el('span', { class: 'lbl' }, src ? angleLabel(src.az, src.el) : ''), el('span', { class: 'lbl' }, main?.width ? `${main.width} × ${main.height}` : ''))),
    el('div', { class: 'blk-body' },
      el('div', { class: 'row-end' },
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => changeImage(o, main) }, 'Changer d\'image'),
        el('a', { class: 'tb ghost sm', href: href('image/?for=object') }, 'En créer une dans Image ↗')),
      el('p', { class: 'lbl' }, 'ou dépose une image sur celle-ci pour la remplacer')));
  dropZone(hero, { kinds: ['image'], multiple: false, via: 'objet', onitems: ([it]) => changeImage(o, main, it) });

  const C = P.classe || {};
  const route = s?.vues?.routes?.[C.value || 'objet'] || 'objet';
  const vision = s?.vues?.vision || {};
  const whatBlk = el('div', { class: 'blk', id: 'o-what' },
    el('div', { class: 'blk-head' }, el('span', { class: 'ttl' }, 'ce que c\'est'),
      el('span', { class: 'lbl' }, C.by === 'modele' ? 'proposé par le modèle qui voit' : C.by === 'personne' ? 'dit par toi' : 'à dire')),
    el('div', { class: 'blk-body' },
      el('div', { class: 'opts', role: 'radiogroup', 'aria-label': 'ce que montre l\'image' },
        ...CLASSES.map(([k, lab]) => el('button', { class: `opt${C.value === k ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(C.value === k),
          onclick: () => setClasse(o, C, C.value === k ? null : k) }, lab))),
      C.job ? el('p', { class: 'hint run-note' }, el('span', { class: 'st run' }, 'en cours'), ' le modèle qui voit regarde l\'image…') : null,
      C.why ? el('p', { class: 'hint' }, el('span', { class: 'flag' }, C.why)) : null,
      C.proposal && C.by === 'personne' && C.proposal.value && C.proposal.value !== C.value
        ? el('p', { class: 'hint' }, `le modèle y voit plutôt ${CLASSES.find((x) => x[0] === C.proposal.value)?.[1] || C.proposal.value}${C.proposal.sujet ? ` (${C.proposal.sujet})` : ''}`) : null,
      C.by === 'modele' && C.proposal?.sujet ? el('p', { class: 'hint' }, `« ${C.proposal.sujet} »`) : null,
      route !== 'objet' ? el('p', { class: 'hint route' }, s?.vues?.class_why?.[route] || '',
        route === 'character' ? [' — ', el('a', { href: href('character/') }, 'le studio Character Factory')] : null) : null,
      el('div', { class: 'row-end' },
        el('button', { class: 'tb ghost sm', type: 'button', id: 'b-classer', disabled: !vision.ready || !!C.job,
          title: !vision.ready ? (vision.why || 'le modèle qui voit n’est pas là') : C.job ? 'il regarde déjà' : 'il dit ce qu’est l’image et d’où elle la voit',
          onclick: () => classer(o) }, 'Demander au modèle'),
        !vision.ready ? el('span', { class: 'lbl' }, vision.why ? 'modèle qui voit absent' : '') : null)));

  const fromBlk = el('div', { class: 'blk', id: 'o-from' },
    el('div', { class: 'blk-head' }, el('span', { class: 'ttl' }, 'd\'où l\'image le voit'),
      el('span', { class: 'lbl' }, V.source.by === 'modele' ? 'proposé par le modèle' : V.source.by === 'personne' ? 'dit par toi' : 'de face, par défaut')),
    el('div', { class: 'blk-body from-grid' },
      el('div', { class: 'from-ring', role: 'radiogroup', 'aria-label': 'l\'azimut de l\'image choisie' },
        el('span', { class: 'from-c', html: compassSvg(src?.az || 0, src?.el || 0, { big: true }) }),
        ...Object.keys(AZ).map(Number).map((az) => el('button', { class: `az-dot${src?.az === az && src?.el !== 90 ? ' on' : ''}`, type: 'button', role: 'radio',
          'aria-checked': String(src?.az === az && src?.el !== 90), title: angleLabel(az, 0), 'aria-label': AZ[az], 'data-az': az,
          style: { '--x': (50 + 44 * Math.sin((az * Math.PI) / 180)).toFixed(1) + '%', '--y': (50 + 44 * Math.cos((az * Math.PI) / 180)).toFixed(1) + '%' },
          onclick: () => setSource(o, V, az, src?.el === 90 ? 0 : src?.el || 0) }))),
      el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'la hauteur de la caméra' },
        ...[0, 30, 60, 90].map((elv) => el('button', { class: `tb${(src?.el || 0) === elv ? ' on' : ''}`, type: 'button', role: 'radio',
          'aria-checked': String((src?.el || 0) === elv), title: EL[elv], onclick: () => setSource(o, V, elv === 90 ? 0 : src?.az || 0, elv) },
        elv === 90 ? 'dessus' : elv ? `${elv}°` : 'œil'))),
      el('p', { class: 'hint' }, 'La place de l\'image dans la grille des vues : les autres partent d\'elle. 90° voit son côté gauche.')));

  const desc = el('textarea', { class: 'fld', rows: 4, placeholder: 'ce que c\'est : matières, couleurs, taille, détails', 'aria-label': 'description' });
  desc.value = e.description || '';
  const dsaved = el('span', { class: 'saved' }, 'enregistré');
  desc.addEventListener('change', async () => {
    try { Object.assign(o, await libPatch(U, o.id, { element: { description: desc.value.trim() } }, `réécrire la description de « ${o.title} »`, { before: o })); dsaved.classList.add('on'); setTimeout(() => dsaved.classList.remove('on'), 1600); } catch (err) { say(err.message); }
  });
  const descBlk = el('div', { class: 'blk' }, el('div', { class: 'blk-head' }, el('span', { class: 'ttl' }, 'sa description'), el('span', { class: 'lbl' }, 'les modèles la liront')),
    el('div', { class: 'blk-body' }, desc, el('div', { class: 'row-end' }, dsaved, el('span', { class: 'lbl' }, 'enregistré en quittant le champ'))));

  // les vues
  const viewsBlk = viewsBlock(o, P, step, btn);

  // la 3D
  const three = el('div', { class: 'three' });
  const runBar = el('div', { class: 'run-bar', hidden: true }, el('i', { style: { width: '0%' } }));
  const runMsg = el('span', { class: 'lbl', id: 'run-msg' });
  const runStop = el('button', { class: 'tb ghost sm', type: 'button', id: 'run-stop', hidden: true }, 'Arrêter');
  const meshesRow = el('div', { class: 'row-end' });
  if (m) {
    // append(null) écrirait « null » : l'étiquette factice seulement quand elle existe
    three.append(el('span', { class: 'lbl tl' }, m.factice ? 'cube de contrôle' : 'glisser pour tourner'));
    if (m.factice) three.append(el('span', { class: 'st wait tr' }, 'factice · pas TRELLIS.2'));
    viewer = preview(three, href(`library/${o.id}/${m.file}`));
    meshesRow.append(el('a', { class: 'tb ghost sm', href: href(`library/${o.id}/${m.file}`), download: `${o.title}-${m.file}` }, 'Télécharger le GLB'),
      el('span', { class: 'lbl' }, `${m.file} · ${fmtDate(m.created)}${(e.meshes || []).length > 1 ? ` · ${e.meshes.length} versions` : ''}`));
  } else {
    three.append(el('div', { class: 'none', html: '<svg viewBox="0 0 100 80"><path d="M20 30 L50 15 L80 30 L80 60 L50 75 L20 60 Z M20 30 L50 45 L80 30 M50 45 L50 75"/></svg>' },
      el('span', { class: 'lbl' }, 'pas encore de 3D')));
  }
  const stats = m ? el('div', { class: 'stats' },
    el('span', {}, el('b', {}, (m.faces ?? '?').toLocaleString('fr-FR')), ' faces'),
    el('span', {}, el('b', {}, (m.vertices ?? '?').toLocaleString('fr-FR')), ' sommets'),
    m.extent ? el('span', {}, 'boîte ', el('b', {}, m.extent.map((x) => x.toLocaleString('fr-FR', { maximumFractionDigits: 3 })).join(' × '))) : null,
    el('span', {}, el('b', {}, String(m.textures ?? 0)), ' textures'),
    m.secs ? el('span', {}, el('b', {}, `${Math.round(m.secs)} s`), m.machine ? ` sur ${m.machine}` : '') : null,
    el('span', {}, el('b', {}, m.model || '?'))) : null;
  // câblé mais aucune machine prête : le bouton dit pourquoi (règle 7)
  const blocked = !main ? 'il lui faut une image' : wired && !s?.trellis?.ready ? notReady(s) : '';
  const go3d = btn('3d', wired ? 'Tirer la 3D' : 'Tirer la 3D · factice', { disabled: !!blocked,
    title: blocked || (wired ? 'TRELLIS.2 sur l\'image choisie' : 'un cube de contrôle : TRELLIS.2 n\'est pas encore câblé ici'),
    onclick: () => run3d(o, wired) });
  const threeBlk = el('div', { class: 'blk', id: 'o-3d' },
    el('div', { class: 'blk-head' }, el('span', { class: 'ttl' }, 'en 3D'), el('span', { class: 'lbl' }, m ? (m.factice ? 'factice' : 'TRELLIS.2 · image unique') : 'pas encore')),
    el('div', { class: 'blk-body' }, three, runBar, el('div', { class: 'row-end' }, runMsg, runStop), stats,
      el('p', { class: 'hint' }, 'TRELLIS.2 lit une image : l\'image choisie', kept ? ` ; ${plural(kept, 'vue gardée attend', 'vues gardées attendent')} une reconstruction multi-vues (non câblée — l'étude, § 3).` : '.'),
      el('div', { class: 'row-end' }, go3d, blocked && main ? el('a', { class: 'linkish', href: href('admin/#machines') }, 'Admin → Machines') : null), meshesRow));

  // les rendus du modèle
  const rendus = m?.rendus || [];
  const rwired = !!s?.vues?.rendus?.wired;
  const rendusBlk = el('div', { class: 'blk', id: 'o-rendus' },
    el('div', { class: 'blk-head' }, el('span', { class: 'ttl' }, 'ses rendus'),
      el('span', { class: 'lbl' }, rendus.length ? (m.rendus_meta?.factice ? 'factices · la boîte du mesh' : 'Render Mesh') : rwired ? 'Render Mesh · câblé' : 'factices ici')),
    el('div', { class: 'blk-body' },
      rendus.length ? el('div', { class: 'strip' }, ...rendus.map((r) => el('a', { class: 'rd', href: href(`library/${o.id}/${r.file}`), target: '_blank', rel: 'noopener', title: r.label },
        el('img', { src: href(`library/${o.id}/${r.thumb || r.file}`), alt: r.label, loading: 'lazy' }), el('span', { class: 'nm' }, r.label))))
        : el('p', { class: 'hint' }, m ? 'Le modèle vu des angles de la planche, sur fond blanc.' : 'Après la 3D : le modèle vu des angles de la planche, sur fond blanc.'),
      el('div', { class: 'row-end' },
        btn('rendus', rendus.length ? 'Refaire les rendus' : 'Faire les rendus', { disabled: !m, title: m ? '' : 'il faut d’abord la 3D', onclick: () => runRendus(o) }),
        el('label', { class: 'lbl face-sel', title: 'si le rendu « face » ne montre pas la face de l’image choisie : tourne la face du modèle (non documenté pour TRELLIS.2)' }, 'face du modèle ',
          el('select', { class: 'fld', 'aria-label': 'la face du modèle 3D', onchange: (ev) => setFace(o, V, Number(ev.target.value)) },
            ...[0, 90, 180, 270].map((f) => el('option', { value: f, selected: (V.face || 0) === f }, `${f}°`)))))));

  // la planche
  const sw = sheetWhy(o, P);
  const sheetBlk = el('div', { class: 'blk', id: 'o-planche' },
    el('div', { class: 'blk-head' }, el('span', { class: 'ttl' }, 'sa planche'), el('span', { class: 'lbl' }, 'face · profil · dos, pour H3')),
    el('div', { class: 'blk-body' },
      sheet ? el('a', { class: 'sheet', href: href(sheet.url), target: '_blank', rel: 'noopener' }, el('img', { src: href(sheet.thumb_url || sheet.url), alt: 'la planche de ' + o.title }))
        : el('p', { class: 'hint' }, 'Les vues gardées côte à côte sur fond blanc : ce que Vidéo envoie à H3 pour cet objet (la forme de la planche des personnages).'),
      el('div', { class: 'row-end' },
        btn('planche', sheet ? 'Refaire la planche' : 'Faire la planche', { disabled: !!sw, title: sw || '', onclick: () => runPlanche(o) }),
        el('a', { class: 'tb ghost sm', href: href(`movie/?ref=${encodeURIComponent(o.id)}`), title: 'l’objet en référence d’un plan H3 (@element)' }, 'Dans Vidéo ↗')),
      sw ? el('p', { class: 'lbl' }, sw) : null));

  S.run = { bar: runBar, msg: runMsg, stop: runStop, go3d };
  // le panneau Asset : ce qu'il pose va dans cet objet
  S.obj = { o, main, P };
  dock.contexte({ kinds: ['image'], label: `l’objet « ${o.title} »` });
  // le clic droit ailleurs sur la fiche (commun/menu.js, pageMenu) : ses gestes
  S.sheet = () => {
    const todo = P.vues.slots.filter((x) => x.pass && (x.state === 'prevue' || x.state === 'echec'));
    return [{ head: `objet · ${o.title}` },
      { label: `Générer ${plural(todo.length, 'vue prévue', 'vues prévues')}`, icon: '▶', disabled: !todo.length || !P.go.ok, why: P.go.why || 'aucune vue prévue', onclick: () => generer(o) },
      { label: 'Plus de vues à partir des gardées', icon: '+', disabled: !P.pass_open.ok, why: P.pass_open.why, onclick: () => plusDeVues(o) },
      { label: go3d.textContent, icon: '◆', disabled: go3d.disabled, why: go3d.title, onclick: () => run3d(o, wired) },
      '-',
      { label: 'Changer d’image…', icon: '▭', onclick: () => changeImage(o, main) },
      m ? { label: 'Télécharger le GLB', icon: '↓', onclick: () => { const a = el('a', { href: href(`library/${o.id}/${m.file}`), download: `${o.title}-${m.file}` }); document.body.append(a); a.click(); a.remove(); } } : null,
      { label: 'Dans la bibliothèque', icon: '▦', onclick: () => { location.href = href(`asset/#${o.id}`); } },
      { label: 'Revenir aux objets', icon: '‹', onclick: () => { location.hash = ''; } }];
  };
  return [head, el('section', { class: 'o-grid' },
    el('div', { class: 'o-col' }, hero, whatBlk, fromBlk, descBlk),
    viewsBlk,
    el('aside', { class: 'o-side' }, threeBlk, rendusBlk, sheetBlk))];
}

// ce qui est câblé, ce qui est factice : une ligne sous l'en-tête, avec le chemin pour le changer
function wiringLine(s, P) {
  const parts = [];
  if (P.gen.id === 'factice') parts.push('vues : des mires factices');
  if (!s?.trellis?.wired) parts.push('3D : un cube de contrôle');
  if (!s?.vues?.rendus?.wired) parts.push('rendus : la boîte du mesh');
  if (!parts.length) return null;
  return el('p', { class: 'why', style: { gridColumn: '1 / -1' } }, `Pas encore câblé ici — ${parts.join(' · ')} : tout le parcours se voit, rien n'est calculé. `,
    el('a', { href: href('admin/#cablage') }, 'Admin → Câblage'));
}

// ── les vues : le plan, une carte par place ──────────────────
function viewsBlock(o, P, step, btn) {
  const V = P.vues;
  const by = (p) => V.slots.filter((x) => x.pass === p);
  const todo = V.slots.filter((x) => x.pass && (x.state === 'prevue' || x.state === 'echec'));
  const gen = P.gen;
  const cant = todo.filter((x) => !gen.els.includes(x.el));
  const section = (title, why, list) => (list.length ? el('div', { class: 'vsect' },
    el('div', { class: 'vsect-head' }, el('span', { class: 'ttl' }, title), el('span', { class: 'lbl' }, why)),
    el('div', { class: 'vgrid' }, ...list.map((x) => slotCard(o, P, x)))) : null);
  const kept = V.slots.filter((x) => x.state === 'gardee').length;
  const nTodo = todo.length - cant.length;
  const genWhy = !P.go.ok ? P.go.why : !nTodo ? (cant.length ? `${gen.name} ne fait pas ${cant.map((x) => x.label).join(', ')}` : 'aucune vue à faire : toutes sont proposées, gardées ou rejetées') : '';
  const blk = el('div', { class: 'blk o-vues', id: 'o-vues' },
    el('div', { class: 'blk-head' }, el('span', { class: 'ttl' }, 'ses vues'),
      el('span', { class: 'lbl' }, `${plural(kept, 'gardée', 'gardées')} · générateur ${gen.name}`)),
    el('div', { class: 'blk-body' },
      el('p', { class: 'hint gen-line' }, gen.id === 'factice'
        ? ['Générateur factice : une mire par vue, qui dit l\'angle, la vue de départ et ce que le vrai générateur recevrait. ', el('a', { href: href('admin/#cablage') }, 'Admin → Câblage')]
        : `${gen.name} — ${gen.sub}.`),
      section('principales', 'les quatre vues d’une reconstruction multi-vues et de la planche', [V.slots[0], ...by(1)].filter(Boolean)),
      section('affinage', 'depuis la vue gardée la plus proche', by(2)),
      section('ajoutées', 'à la main', by(3)),
      el('div', { class: 'row-end vfoot' },
        btn('generer', nTodo ? `Générer ${plural(nTodo, 'vue', 'vues')}` : 'Générer', { disabled: !!genWhy, title: genWhy || `${gen.name} : un travail par vue`, onclick: () => generer(o) }),
        btn('plus', 'Plus de vues', { disabled: !P.pass_open.ok, title: P.pass_open.ok ? 'les 3/4 et le dessus, depuis les vues gardées' : P.pass_open.why, onclick: () => plusDeVues(o) }),
        el('button', { class: 'tb ghost', type: 'button', id: 'b-ajout', title: 'une vue à un angle de la grille', onclick: (ev) => addAngleMenu(o, P, ev) }, '+ une vue')),
      genWhy && !P.go.ok ? el('p', { class: 'lbl why-l' }, genWhy) : !P.pass_open.ok && !V.passes.includes(2) ? el('p', { class: 'lbl why-l' }, `Plus de vues : ${P.pass_open.why}`) : null));
  return blk;
}

function slotCard(o, P, x) {
  const items = x.items || [];
  const shown = { k: Math.max(0, items.indexOf(x.pick) >= 0 && x.state === 'gardee' ? items.indexOf(x.pick) : items.length - 1) };
  const item = () => P.items[items[shown.k]];
  const isSrc = x.pass === 0;
  const pic = el('div', { class: 'vc-pic' });
  const act = el('div', { class: 'vc-act' });
  const a = (label, fn, { title = '', dis = false } = {}) => el('button', { class: 'tb ghost sm', type: 'button', title, disabled: dis, onclick: fn }, label);
  const put = (...n) => act.append(...n.filter(Boolean));   // append(null) écrirait « null »
  // les gestes suivent la proposition montrée (« Garder celle-ci » quand on en feuillette une autre)
  const paintAct = () => {
    if (isSrc) return;
    act.replaceChildren();
    if (x.state === 'proposee') put(a('Garder', () => slotAction(o, x, 'garder', items[shown.k]), { title: 'cette proposition devient une vue de l’objet' }),
      a('Refaire', () => generer(o, [x.id]), { title: 'une autre proposition (une autre graine)' }), a('Rejeter', () => slotAction(o, x, 'rejeter')));
    else if (x.state === 'gardee') put(items.length > 1 && items[shown.k] !== x.pick ? a('Garder celle-ci', () => slotAction(o, x, 'garder', items[shown.k])) : null,
      a('Refaire', () => generer(o, [x.id])), a('Ne plus garder', () => slotAction(o, x, 'rouvrir'), { title: 'elle redevient une proposition' }));
    else if (x.state === 'rejetee') put(a('Refaire', () => generer(o, [x.id])), a('Rouvrir', () => slotAction(o, x, 'rouvrir')));
    else if (x.state === 'echec') put(a('Refaire', () => generer(o, [x.id])));
    else if (x.state === 'prevue') put(a('Faire', () => generer(o, [x.id]), { dis: !P.go.ok || !P.gen.els.includes(x.el), title: !P.go.ok ? P.go.why : !P.gen.els.includes(x.el) ? `${P.gen.name} ne fait pas cette vue` : '' }));
    else if (x.state === 'file' && x.job) put(a('Arrêter', async () => { try { await jobs.cancel(x.job); } catch (e) { say(e.message); } }));
    if (x.pass === 3 && !['file', 'gardee'].includes(x.state)) put(a('×', () => slotAction(o, x, 'retirer'), { title: 'retirer cette vue du plan' }));
  };
  const paintPic = () => {
    const it = item();
    const url = isSrc ? x.ref_thumb : (x.state === 'gardee' && items[shown.k] === x.pick ? x.ref_thumb : null) || it?.thumb_url || it?.url;
    // replaceChildren(null) écrirait « null » (movie.md § 7) : les nœuds absents sont filtrés
    pic.replaceChildren(...[url ? el('img', { src: href(url), alt: x.label, loading: 'lazy' }) : el('span', { class: 'vc-empty', html: compassSvg(x.az, x.el) }),
      el('span', { class: 'vc-tag' }, isSrc ? 'image choisie' : x.state === 'file' ? (x.job_state === 'running' ? 'en cours' : 'en file') : STATE[x.state] || x.state),
      items.length > 1 && !isSrc ? el('span', { class: 'vc-nav' },
        el('button', { type: 'button', 'aria-label': 'proposition précédente', disabled: shown.k === 0, onclick: (ev) => { ev.stopPropagation(); shown.k--; paintPic(); } }, '‹'),
        el('span', {}, `${shown.k + 1}/${items.length}`),
        el('button', { type: 'button', 'aria-label': 'proposition suivante', disabled: shown.k >= items.length - 1, onclick: (ev) => { ev.stopPropagation(); shown.k++; paintPic(); } }, '›')) : null].filter(Boolean));
    paintAct();
  };
  paintPic();
  const from = item()?.params?.from;
  const bar = el('div', { class: 'run-bar', hidden: x.state !== 'file' }, el('i', { style: { width: `${Math.round((x.progress ?? 0.03) * 100)}%` } }));
  const card = el('div', { class: `vcard s-${x.state}${isSrc ? ' src' : ''}`, 'data-slot': x.id, 'data-state': x.state, role: 'group', 'aria-label': `vue ${x.label} · ${STATE[x.state] || x.state}` },
    pic,
    el('div', { class: 'vc-cap' }, el('span', { class: 'nm' }, x.label),
      el('span', { class: 'az' }, isSrc ? 'l’image choisie' : x.state === 'file' ? (x.message || 'en file') : x.state === 'echec' ? (x.why || 'échec') : from ? `depuis ${from.label}` : x.state === 'prevue' ? 'à faire' : '')),
    bar, act);
  // une image déposée sur une place : elle devient cette vue (une image de la bibliothèque, ou un fichier)
  if (!isSrc) dropZone(card, { kinds: ['image'], multiple: false, via: 'objet', onitems: ([it]) => slotAction(o, x, 'poser', it.id) });
  card._menu = () => (isSrc ? [{ head: 'l’image choisie' }, { label: 'Changer d’image…', icon: '▭', onclick: () => changeImage(o, S.obj?.main) }]
    : [{ head: `vue · ${x.label}` },
      { label: 'Garder', icon: '✓', disabled: x.state !== 'proposee', why: 'aucune proposition à garder', onclick: () => slotAction(o, x, 'garder', items[shown.k]) },
      { label: 'Refaire', icon: '↻', disabled: x.state === 'file' || !P.go.ok, why: x.state === 'file' ? 'en train de se faire' : P.go.why, onclick: () => generer(o, [x.id]) },
      { label: 'Rejeter', icon: '×', disabled: ['file', 'rejetee'].includes(x.state), why: 'déjà rejetée, ou en cours', onclick: () => slotAction(o, x, 'rejeter') },
      { label: 'Poser une image de la bibliothèque…', icon: '▭', onclick: async () => { const [it] = await pick({ kinds: ['image'], title: `La vue ${x.label}` }); if (it) slotAction(o, x, 'poser', it.id); } },
      item() ? { label: 'Ouvrir la proposition', icon: '↗', onclick: () => window.open(href(item().url), '_blank', 'noopener') } : null]);
  return card;
}

// ── les gestes du plan ───────────────────────────────────────
const vuesApi = (o, path, body) => api(`objet/${o.id}/${path}`, { method: 'POST', body });

async function generer(o, slots = null) {
  try {
    const r = await vuesApi(o, 'vues/generer', slots ? { slots } : {});
    say(`${plural(r.jobs.length, 'vue en file', 'vues en file')}${r.skipped?.length ? ` · le générateur ne fait pas ${r.skipped.join(', ')}` : ''}${r.refused ? ` · le reste refusé : ${r.refused}` : ''}`);
  } catch (e) { say(e.message); }
  paintObject(o.id, { keepScroll: true });
}

async function plusDeVues(o) {
  try {
    await vuesApi(o, 'vues/plan', { pass: 2 });
    await generer(o);
  } catch (e) { say(e.message); paintObject(o.id, { keepScroll: true }); }
}

// garder, rejeter, rouvrir, poser : chacun avec son contraire (Ctrl+Z)
async function slotAction(o, x, action, item = null) {
  const label = { garder: `garder la vue ${x.label}`, rejeter: `rejeter la vue ${x.label}`, rouvrir: `rouvrir la vue ${x.label}`,
    poser: `poser une image en vue ${x.label}`, retirer: `retirer la vue ${x.label}` }[action];
  const prev = { state: x.state, pick: x.pick };
  try {
    if (action === 'retirer') await vuesApi(o, `vues/${x.id}`, { action });
    else {
      await U.run({ label,
        do: () => vuesApi(o, `vues/${x.id}`, { action, ...(item ? { item } : {}) }),
        // le contraire : ce qui était gardé le redevient (sa proposition), sinon la place se rouvre ou se rejette
        undo: () => (prev.state === 'gardee' && prev.pick ? vuesApi(o, `vues/${x.id}`, { action: 'garder', item: prev.pick })
          : prev.state === 'rejetee' ? vuesApi(o, `vues/${x.id}`, { action: 'rejeter' })
            : vuesApi(o, `vues/${x.id}`, { action: 'rouvrir' })) });
    }
    say(`vue ${x.label} : ${{ garder: 'gardée', poser: 'posée', rejeter: 'rejetée', rouvrir: 'rouverte', retirer: 'retirée' }[action]}`, action !== 'retirer');
  } catch (e) { say(e.message); }
  paintObject(o.id, { keepScroll: true });
}

async function setSource(o, V, az, elv) {
  const before = { az: V.source.az, el: V.source.el };
  if (before.az === az && before.el === elv) return;
  try {
    await U.run({ label: `l’image choisie vue ${angleLabel(az, elv)}`,
      do: () => vuesApi(o, 'vues/source', { az, el: elv }), undo: () => vuesApi(o, 'vues/source', before) });
    say(`l’image choisie : ${angleLabel(az, elv)} — le plan suit`, true);
  } catch (e) { say(e.message); }
  paintObject(o.id, { keepScroll: true });
}

async function setClasse(o, C, value) {
  const before = C.value ?? null;
  try {
    await U.run({ label: `l’image montre : ${value || 'à dire'}`,
      do: () => vuesApi(o, 'classe', { value }), undo: () => vuesApi(o, 'classe', { value: before }) });
  } catch (e) { say(e.message); }
  paintObject(o.id, { keepScroll: true });
}

async function classer(o, { quiet = false } = {}) {
  try {
    await vuesApi(o, 'classer', {});
    if (!quiet) say('le modèle qui voit regarde l’image');
  } catch (e) { if (!quiet) say(e.message); }
  paintObject(o.id, { keepScroll: true });
}

async function setFace(o, V, face) {
  const before = V.face || 0;
  try { await U.run({ label: `la face du modèle à ${face}°`, do: () => vuesApi(o, 'face', { face }), undo: () => vuesApi(o, 'face', { face: before }) }); } catch (e) { say(e.message); }
  paintObject(o.id, { keepScroll: true });
}

async function runRendus(o) {
  try { await vuesApi(o, 'rendus', {}); say('rendus en file'); } catch (e) { say(e.message); }
  paintObject(o.id, { keepScroll: true });
}

async function runPlanche(o) {
  try { await vuesApi(o, 'planche', {}); say('planche en file'); } catch (e) { say(e.message); }
  paintObject(o.id, { keepScroll: true });
}

// une vue à un angle de la grille : les azimuts par hauteur, ceux déjà prévus éteints
function addAngleMenu(o, P, ev) {
  const have = new Set(P.vues.slots.map((x) => `${x.az}/${x.el}`));
  const add = (az, elv) => async () => {
    try { await vuesApi(o, 'vues/plan', { az, el: elv }); } catch (e) { say(e.message); }
    paintObject(o.id, { keepScroll: true });
  };
  const r = ev.currentTarget.getBoundingClientRect();
  menu(r.left, r.bottom + 4, [{ head: 'une vue de plus' },
    ...[0, 30, 60].map((elv) => ({ label: EL[elv], sub: `${elv}°`, items: Object.keys(AZ).map(Number).map((az) => ({
      label: angleLabel(az, elv), disabled: have.has(`${az}/${elv}`), why: 'déjà dans le plan', onclick: add(az, elv) })) })),
    { label: 'dessus · 90°', disabled: have.has('0/90'), why: 'déjà dans le plan', onclick: add(0, 90) }]);
}

// ── le clic droit (Cal, 29/09 : jamais le menu du navigateur) ──
// une carte d'objet, une vue : leur menu ; ailleurs, les gestes de la vue
// ouverte en tête du menu commun de repli
const S = { run: null, sheet: null, obj: null, plan: null, arrive: null };
contextMenu(app, (e) => e.target.closest('.ocard, .vcard')?._menu?.() || null);
pageMenu(() => (ID_RX.test(decodeURIComponent(location.hash.slice(1))) && S.sheet ? S.sheet()
  : [{ head: 'Object Creator' }, { label: 'Nouvel objet…', icon: '+', onclick: () => newObject() },
    { label: 'Créer son image dans Image', icon: '↗', onclick: () => { location.href = href('image/?for=object'); } },
    { label: 'La bibliothèque', icon: '▦', onclick: () => { location.href = href('asset/'); } }]));

// ── l'image choisie ──────────────────────────────────────────
const refRow = (x) => ({ file: x.file, role: x.role, label: x.label, item: x.item });

async function changeImage(o, main, given = null) {
  const it = given || (await pick({ kinds: ['image'], title: `Une autre image pour ${o.title}` }))[0];
  if (!it) return;
  const src = S.plan?.vues?.source || { az: 0, el: 0 };
  try {
    await libBoard(U, o, `changer l’image de « ${o.title} »`, async () => {
      const n = await api(`elements/${o.id}/refs`, { method: 'POST', body: { item: it.id, role: 'view', label: angleLabel(src.az, src.el) } });
      const refs = n.element.refs;
      const added = refs[refs.length - 1];
      // la nouvelle en tête ; l'ancienne reste dans l'élément, en « détail » ; le plan la prend pour image choisie
      const list = [added, ...refs.slice(0, -1).map((x) => (main && x.file === main.file ? { ...x, role: 'detail', label: 'ancienne image' } : x))].map(refRow);
      await api(`asset/refs/${o.id}`, { method: 'POST', body: { refs: list } });
      await vuesApi(o, 'vues/source', { az: src.az, el: src.el, file: added.file });
    });
    say('nouvelle image choisie ; l\'ancienne reste dans l\'élément, en détail', true);
  } catch (e) { say(e.message); }
  paintObject(o.id, { keepScroll: true });
}

// ── la 3D : le travail, sa progression ───────────────────────
async function run3d(o, wired) {
  const kind = wired ? 'objet.mesh' : 'objet.mesh_factice';
  try {
    const j = await jobs.submit(kind, { element: o.id }, { title: `${o.title} · 3D${wired ? '' : ' factice'}`, tool: 'object' });
    followJob(o, j);
  } catch (e) { say(e.message); }
}

let following = null;
async function followJob(o, j = null) {
  if (!j) {
    try {
      const { jobs: list } = await api('jobs?active=1&limit=40');
      j = list.find((x) => x.kind?.startsWith('objet.mesh') && x.params?.element === o.id);
    } catch { return; }
    if (!j) return;
  }
  if (following === j.id) return;
  following = j.id;
  const paint = (x) => {
    if (!S.run || !S.run.bar.isConnected) return;
    S.run.bar.hidden = false;
    $('i', S.run.bar).style.width = `${Math.round((x.progress ?? 0.05) * 100)}%`;
    S.run.msg.textContent = `${x.state === 'queued' ? 'en file' : 'en cours'} · ${x.message || ''}`;
    S.run.go3d.disabled = true;
    S.run.go3d.title = 'un travail 3D tourne déjà pour cet objet';
    // arrêter : le sien (ou Cal) ; ComfyUI est interrompu, le GLB n'est pas rangé
    S.run.stop.hidden = x.can === false;
    S.run.stop.onclick = async () => {
      S.run.stop.disabled = true;
      try { await jobs.cancel(j.id); S.run.msg.textContent = 'arrêt demandé'; } catch (e) { say(e.message); S.run.stop.disabled = false; }
    };
  };
  const done = await jobs.wait(j.id, paint);
  following = null;
  if (done.state === 'done') say(done.result?.note ? `3D rangée · ${done.result.note}` : '3D rangée');
  else say(`3D : ${done.message || done.state}`);
  if (location.hash.slice(1) === o.id) paintObject(o.id, { keepScroll: true });
}

// ── les travaux des vues : la progression en place, la fiche relue à la fin ──
// La file (jobs.watch) porte la progression de chaque vue en cours : la barre de sa carte suit,
// sans relire la fiche ; un travail de cet objet qui finit (sr:job) la fait relire, une fois.
jobs.watch((list) => {
  const P = S.plan;
  if (!P || !S.obj) return;
  for (const x of P.vues.slots) {
    if (!x.job) continue;
    const j = list.find((y) => y.id === x.job);
    const card = $(`.vcard[data-slot="${x.id}"]`);
    if (!j || !card) continue;
    const i = $('.run-bar i', card);
    if (i) i.style.width = `${Math.round((j.progress ?? 0.03) * 100)}%`;
    const az = $('.vc-cap .az', card);
    if (az && (j.state === 'queued' || j.state === 'running')) az.textContent = j.message || stateFr(j.state);
    const tag = $('.vc-tag', card);
    if (tag && (j.state === 'queued' || j.state === 'running')) tag.textContent = stateFr(j.state);
  }
});
let relire = 0;
document.addEventListener('sr:job', (ev) => {
  const j = ev.detail || {};
  const id = S.obj?.o?.id;
  if (!id || !String(j.kind || '').startsWith('objet.') || j.params?.element !== id || j.kind.startsWith('objet.mesh')) return;
  clearTimeout(relire);
  relire = setTimeout(() => { if (decodeURIComponent(location.hash.slice(1)) === id) paintObject(id, { keepScroll: true }); }, 250);
  if (j.state === 'error') say(`${j.title || j.kind} : ${j.message || 'échec'}`);
  else if (j.state === 'done' && j.kind !== 'objet.vue_factice' && j.kind !== 'objet.vue') say(j.result?.note || `${j.title || j.kind} : fini`);
});

// ── l'aperçu 3D : three.js, couleurs tirées des jetons ───────
function tokenRGB(name) {
  const p = el('i', { hidden: true });
  document.body.append(p);
  p.style.color = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const [r = 0, g = 0, b = 0] = (getComputedStyle(p).color.match(/[\d.]+/g) || []).map(Number);
  p.remove();
  return [r / 255, g / 255, b / 255];
}

function preview(box, url) {
  let stop = false;
  const ctl = { stop: () => { stop = true; } };
  (async () => {
    let THREE, OrbitControls, GLTFLoader, RoomEnvironment;
    try {
      THREE = await import('three');
      ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js'));
      ({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'));
      ({ RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js'));
    } catch {
      box.append(el('div', { class: 'none' }, el('span', { class: 'lbl' }, 'aperçu 3D indisponible : three.js vient du CDN jsdelivr, injoignable d\'ici'),
        el('a', { class: 'tb ghost sm', href: url, download: '' }, 'Télécharger le GLB')));
      return;
    }
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.NeutralToneMapping;
    box.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    const [r, g, b] = tokenRGB('--ink');
    const key = new THREE.DirectionalLight(new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace), 0.9);
    key.position.set(2, 3, 2.5);
    scene.add(key);
    const camera = new THREE.PerspectiveCamera(35, 4 / 3, 0.01, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // la préférence « l'aperçu tourne seul » ; les animations réduites l'arrêtent aussi
    controls.autoRotate = prefs.get('object.autorotate', true) && !reducedMotion();
    controls.autoRotateSpeed = 1.4;
    controls.addEventListener('start', () => { controls.autoRotate = false; });
    let model;
    try { model = (await new GLTFLoader().loadAsync(url)).scene; } catch (e) {
      box.append(el('div', { class: 'none' }, el('span', { class: 'lbl' }, `GLB illisible : ${e.message}`)));
      renderer.dispose();
      return;
    }
    scene.add(model);
    const bb = new THREE.Box3().setFromObject(model);
    const center = bb.getCenter(new THREE.Vector3());
    const radius = Math.max(bb.getSize(new THREE.Vector3()).length() / 2, 1e-3);
    controls.target.copy(center);
    // la sphère englobante tient dans le champ (35°), avec de l'air autour
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.1;
    camera.position.copy(center).add(new THREE.Vector3(1.5, 0.9, 2.1).normalize().multiplyScalar(dist));
    camera.near = radius / 100;
    camera.far = radius * 100;
    camera.updateProjectionMatrix();
    const fit = () => {
      const w = box.clientWidth, h = box.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    new ResizeObserver(fit).observe(box);
    fit();
    const loop = () => {
      if (stop || !renderer.domElement.isConnected) { renderer.dispose(); pmrem.dispose(); return; }
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    };
    loop();
    box.dataset.ready = '1';
  })();
  return ctl;
}

// ── déposer une image : un objet neuf, ou une vue de l'objet ouvert ─
// Le même geste pour un fichier lâché n'importe où et pour « poser » depuis le
// panneau Asset : sur l'accueil, un objet neuf ; sur une fiche, la première vue
// qui n'est pas gardée (dans l'ordre du plan). Faux si rien n'a été posé.
async function placeImage(it, full) {
  const h = decodeURIComponent(location.hash.slice(1));
  if (ID_RX.test(h) && S.obj && S.plan) {
    const free = S.plan.vues.slots.find((x) => x.pass && !['gardee', 'file'].includes(x.state));
    if (!free) { say(full); return false; }
    await slotAction(S.obj.o, free, 'poser', it.id);
    return true;
  }
  newObject({ item: it });
  return true;
}
dropAnywhere(async (files) => {
  const f = files.find((x) => /^image\//.test(x.type)) || files[0];
  let it;
  try { it = await uploadFile(f, UP); } catch (e) { say(e.message); return; }
  placeImage(it, 'toutes les vues sont gardées ou en cours : l\'image est rangée dans la bibliothèque');
});

// ── le panneau Asset (commun/dock.js, Ctrl+Espace) ────────────
// Poser (double-clic, Entrée) : comme un fichier lâché sur la page. Le clic droit
// d'une vignette : l'image choisie, ou une vue précise, sur la fiche ouverte.
// Ses filtres : les images (un objet part d'une image).
const onSheet = () => ID_RX.test(decodeURIComponent(location.hash.slice(1))) && S.obj && S.plan;
dock.configure({
  kinds: ['image'],
  label: 'un nouvel objet',
  placeLabel: 'Poser',
  hint: 'double-clic : un objet neuf, ou la première vue libre · glisser : sur l’image ou sur une vue',
  place: (items) => {
    const it = items.find((x) => x.kind === 'image');
    if (!it) { say('un objet part d’une image'); return false; }
    return placeImage(it, 'toutes les vues sont gardées ou en cours : glisse l’image sur une vue pour la remplacer');
  },
  menu: (it, chosen) => {
    if (chosen.length !== 1 || it.kind !== 'image') return [];
    if (!onSheet()) return [{ label: 'Nouvel objet avec cette image', icon: '+', onclick: () => newObject({ item: it }) }];
    const { o, main } = S.obj;
    return [{ label: 'En image choisie', sub: angleLabel(S.plan.vues.source.az, S.plan.vues.source.el), onclick: () => changeImage(o, main, it) },
      ...S.plan.vues.slots.filter((x) => x.pass && x.state !== 'file').map((x) => ({ label: `En vue ${x.label}`, sub: x.state === 'gardee' ? 'la remplace' : '',
        onclick: () => slotAction(o, x, 'poser', it.id) }))];
  },
});

render();
