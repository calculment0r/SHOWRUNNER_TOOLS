// OBJECT CREATOR — un objet est un élément de la bibliothèque (sorte
// `object`) : l'image que Cal choisit, ses vues (références de rôle
// `view`), et les GLB tirés par TRELLIS.2 (`element.meshes`).
//
//   objet/          les objets et l'état de la chaîne
//   objet/#<id>     la fiche d'un objet
//
// Décision de Cal (28/09, Character_Factory/docs/BRIEF_CAL_2026-09-28.md
// §8 et §10) : une image validée → des vues par nos modèles → TRELLIS sur
// ces vues ; pas de Pixal3D. L'étude du 28/09 : aucun modèle installé ne
// fait encore les vues d'un objet justes. La page dit ce qui marche et ce
// qui attend ; la 3D n'est pas câblée (Cal, 28/09 nuit : l'UX d'abord),
// son bouton lance un cube de contrôle marqué « factice ».
import { mountHeader, api, jobs, pick, el, $, $$, href, fmtDate, uploadFile, dropAnywhere } from '../commun/shell.js';

mountHeader('object');

const app = $('#app');
const live = (t) => { $('#live').textContent = t; };
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const MAQUETTE = 'http://192.168.10.247:8765/docs/img/maquettes/objets.html';
const SRC = {
  trellis: 'https://github.com/microsoft/TRELLIS.2',
  pipe: 'https://github.com/microsoft/TRELLIS.2/blob/main/trellis2/pipelines/trellis2_image_to_3d.py',
  card: 'https://huggingface.co/microsoft/TRELLIS.2-4B',
  orbit: 'https://huggingface.co/ML-Intern-lab/Qwen-Image-2.1-viewpoint-orbit-LoRA',
  pr104: 'https://github.com/microsoft/TRELLIS.2/pull/104',
};
// les quatre vues qu'il faudrait, à 90°, hauteur d'œil (étude du 28/09, §1 et §3)
const VIEWS = [
  { label: 'face · 0°', svg: '<svg viewBox="0 0 100 60"><path d="M30 52 L30 10 Q30 6 36 6 L62 6 Q70 6 70 12 L70 52 Z"/></svg>' },
  { label: 'gauche · 90°', svg: '<svg viewBox="0 0 100 60"><path d="M92 50 L92 18 Q92 8 80 8 L60 8 Q54 8 54 16 L54 30 Q40 32 20 36 Q6 38 6 48 L6 52 L92 52 Z"/></svg>' },
  { label: 'dos · 180°', svg: '<svg viewBox="0 0 100 60"><path d="M30 52 L30 10 Q30 6 36 6 L62 6 Q70 6 70 12 L70 52 Z"/><path d="M36 20 L64 20"/></svg>' },
  { label: 'droite · 270°', svg: '<svg viewBox="0 0 100 60"><path d="M8 50 L8 18 Q8 8 20 8 L40 8 Q46 8 46 16 L46 30 Q60 32 80 36 Q94 38 94 48 L94 52 L8 52 Z"/></svg>' },
];

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

// ── le bandeau ───────────────────────────────────────────────
let toastT;
function say(msg, undo = null) {
  let t = $('.a-toast');
  if (!t) {
    t = el('div', { class: 'a-toast', role: 'status' }, el('span', { class: 't' }), el('button', { class: 'linkish', type: 'button' }, 'annuler'));
    document.body.append(t);
  }
  $('.t', t).textContent = msg;
  const b = $('button', t);
  b.hidden = !undo;
  b.onclick = async () => { t.classList.remove('on'); try { await undo(); } catch (e) { say(e.message); } };
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
        el('p', { class: 'prose' }, 'Un objet suit la logique d\'un personnage, dans une chaîne à lui : une image que tu choisis — faite dans Image ou déposée —, des vues cohérentes entre elles, puis TRELLIS.2 sur ces vues. Chaque objet est un élément de la bibliothèque : on l\'appelle ensuite dans une image ou un plan, comme un personnage.'),
        el('div', { class: 'row' },
          el('button', { class: 'tb go', type: 'button', onclick: () => newObject() }, 'Nouvel objet'),
          el('a', { class: 'tb ghost', href: href('image/?for=object') }, 'Créer son image dans Image'),
          el('a', { class: 'tb ghost', href: href('asset/') }, 'La bibliothèque'))),
      chain),
    el('div', { class: 'sect-head' }, el('h2', {}, 'Les objets'), el('span', { class: 'cnt' }, plural(objs.items.length, 'objet', 'objets'))),
    el('div', { class: 'objs', role: 'list' }, ...(objs.items.length ? objs.items.map(objCard) : [
      el('div', { class: 'empty-state' }, el('b', {}, 'Aucun objet'),
        el('p', { class: 'hint' }, 'Un nom et une image suffisent pour commencer : « Nouvel objet », ou dépose une image n\'importe où sur la page.'))])),
    studyBlock());
}

function st(cls, txt) { return el('span', { class: `st ${cls}` }, txt); }

function chainPanel(s) {
  const t = s?.trellis || {};
  const machines = (t.machines || []).map((m) => (m.up ? (m.missing?.length ? `${m.machine} : il manque ${m.missing.join(', ')}` : `${m.machine} : modèles présents`) : `${m.machine} : ne répond pas`));
  const step = (n, name, badge, ...p) => el('div', { class: 'step' }, el('span', { class: 'n' }, n), el('span', { class: 'nm' }, name), badge, el('p', {}, ...p));
  return el('aside', { class: 'chain', 'aria-label': 'la chaîne objet' },
    el('div', { class: 'chain-head' }, el('h2', {}, 'La chaîne objet'), el('span', { class: 'lbl' }, 'ce qui marche · ce qui attend')),
    step('01', 'Son image', st('ok', 'prête'),
      'Krea 2 dans ', el('a', { href: href('image/?for=object') }, 'Image'), ', ou une image déposée. C\'est la seule que tu valides : les vues et la 3D en partent.'),
    step('02', 'Ses vues', st('wait', 'aucun modèle'),
      'Il en faudrait quatre à 90°, à hauteur d\'œil, à la même échelle. Aucun modèle installé ne les fait justes (essai botte du 28/09 : Krea 2 1/4, Qwen-Image 2.1 turbo 0/4, ',
      el('a', { href: SRC.orbit, target: '_blank', rel: 'noopener' }, 'LoRA d\'orbite'), ' chargé à moitié 1/3). En attendant : à la main, depuis la bibliothèque.'),
    step('03', 'Sa 3D · TRELLIS.2', t.wired ? st('ok', 'câblé') : st('wait', 'pas câblé'),
      'Une seule image, carrée, détourée, 1024 px, sans marge : la seule entrée documentée (',
      el('a', { href: SRC.pipe, target: '_blank', rel: 'noopener' }, 'pipeline'), '). ',
      t.wired ? 'Le bouton lance TRELLIS.2 sur ComfyUI.' : 'Pas encore lancé ici : Cal valide d\'abord l\'écran (28/09, nuit). Le bouton fait un cube de contrôle, marqué factice.',
      machines.length ? el('span', { class: 'lbl', style: { display: 'block', marginTop: '6px' } }, machines.join(' · ')) : null),
    step('04', 'Sa taille · à qui il est', st('off', 'plus tard'),
      'Mesurée sur le plein pied de son personnage, puis l\'attache : dessinées dans la maquette, pas commencées.'),
    el('div', { class: 'chain-foot' },
      el('a', { href: MAQUETTE, target: '_blank', rel: 'noopener' }, 'la maquette ↗'),
      el('a', { href: '#etude' }, 'l\'étude du 28/09 ↓'),
      el('a', { href: SRC.trellis, target: '_blank', rel: 'noopener' }, 'TRELLIS.2 ↗'),
      el('a', { href: SRC.card, target: '_blank', rel: 'noopener' }, 'sa carte ↗')));
}

// l'étude du 28/09 (hors dépôt), ce qui fonde la page, avec ses sources
function studyBlock() {
  const row = (k, v) => [el('dt', {}, k), el('dd', {}, ...v)];
  const a = (txt, url) => el('a', { href: url, target: '_blank', rel: 'noopener' }, txt);
  return el('details', { class: 'blk', id: 'etude' },
    el('summary', { class: 'blk-head', style: { cursor: 'pointer', paddingBottom: '14px' } }, el('span', { class: 'ttl' }, 'l\'étude du 28/09 · ce qu\'attend TRELLIS.2'), el('span', { class: 'lbl' }, 'ouvrir')),
    el('div', { class: 'blk-body' },
      el('dl', { class: 'facts' },
        ...row('images', ['une : ', el('code', {}, 'run(self, image)'), ' — ', a('pipeline', SRC.pipe), ', « Single Image » — ', a('carte', SRC.card), '. Plusieurs : rien d\'officiel ; une PR ouverte, dont l\'auteur dit que la moyenne rend l\'objet « fatter or thinner » (', a('PR 104', SRC.pr104), ').']),
        ...row('fond', ['détouré : un alpha est pris tel quel, sinon BiRefNet ; notre graphe le détoure (RemoveBackground, birefnet).']),
        ...row('cadrage', ['carré serré sur l\'objet, sans marge : ', el('code', {}, 'size * 1'), ' dans preprocess_image ; « pad_factor=1.0 for TRELLIS.2 » (ComfyUI 0.37.2, nodes_trellis2.py l. 450). Character Factory met 1,1 : ici 1,0.']),
        ...row('taille', ['grand côté ramené à 1024 px.']),
        ...row('angle', ['non documenté ; aucun paramètre caméra.']),
        ...row('vues', ['aucun modèle retenu : Krea 2 face juste 1/4, Qwen-Image 2.1 turbo 0/4 (miroir), ', a('LoRA d\'orbite', SRC.orbit), ' 1/3 mais 128 clés non chargées par ComfyUI — l\'essai ne compte pas.']),
        ...row('non documenté', ['objets fins, transparents, brillants ; éclairage idéal de l\'image ; FOV des vues générées.'])),
      el('p', { class: 'hint' }, 'Étude complète : ETUDE_OBJETS.md (hors dépôt, session du 28/09) ; résumé dans Character_Factory/docs/REPRISE_CAL.md, « Objets ».')));
}

function lastMesh(o) { return (o.element.meshes || []).at(-1); }
function viewsOf(o) { return o.element.refs.map((r, i) => ({ ...r, i })).filter((r) => r.role === 'view'); }

function objCard(o) {
  const views = viewsOf(o);
  const m = lastMesh(o);
  const badge = m ? (m.factice ? st('wait', '3D factice') : st('ok', '3D')) : st('off', 'pas de 3D');
  const named = VIEWS.filter((v) => views.some((r) => r.label === v.label)).length;
  return el('a', { class: 'ocard', href: '#' + o.id, role: 'listitem', 'aria-label': `objet ${o.title}` },
    el('div', { class: 'pic' }, o.thumb_url ? el('img', { src: href(o.thumb_url), alt: '', loading: 'lazy' }) : null,
      el('span', { class: 'kind' }, 'objet'), el('span', { class: 'badge' }, badge)),
    el('div', { class: 'cap' }, el('span', { class: 'nm' }, o.title),
      el('div', { class: 'ticks-mini', title: 'image · vues · 3D' }, el('i', { class: views.length ? 'done' : '' }),
        el('i', { class: named >= 4 ? 'done' : named > 1 ? 'wait' : '' }), el('i', { class: m ? (m.factice ? 'wait' : 'done') : '' })),
      el('span', { class: 'lbl' }, `${plural(named, 'vue', 'vues')} sur 4 · ${fmtDate(o.updated)}`)));
}

// ── un objet neuf ────────────────────────────────────────────
function newObject({ item = null } = {}) {
  let chosen = item;
  const name = el('input', { class: 'fld big-fld', id: 'no-name', maxlength: 80, placeholder: 'sac de toile, lunettes rondes, bottes LED…', spellcheck: 'false', value: item?.title || '' });
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
    try { chosen = await uploadFile(f, { tool: 'object' }); if (!name.value) name.value = chosen.title; } catch (e) { say(e.message); }
    paint();
  } });
  name.addEventListener('input', paint);
  const form = el('form', { id: 'no-form', autocomplete: 'off', style: { display: 'contents' } },
    el('div', { class: 'q-row' }, el('label', { class: 'new-q', for: 'no-name' }, 'Comment s\'appelle-t-il ?'), name),
    el('div', { class: 'q-row' }, el('span', { class: 'lbl' }, 'son image · la seule que tu valides'),
      el('div', { class: 'src-pick' }, prev, el('div', { class: 'row' },
        el('button', { class: 'tb ghost', type: 'button', onclick: async () => {
          const [it] = await pick({ kinds: ['image'], title: 'L\'image de l\'objet', upload: true });
          if (it) { chosen = it; if (!name.value) name.value = it.title; paint(); }
        } }, 'Dans la bibliothèque'),
        el('button', { class: 'tb ghost', type: 'button', onclick: () => fileIn.click() }, 'Déposer une image'),
        el('a', { class: 'tb ghost', href: href('image/?for=object') }, 'La créer dans Image ↗'), fileIn)),
      el('p', { class: 'hint' }, 'L\'objet entier, sur un fond simple : TRELLIS.2 le détoure et le recadre en carré lui-même.')),
    el('div', { class: 'q-row' }, el('span', { class: 'lbl' }, 'ce que c\'est'), desc));
  const m = modal({ title: 'nouvel objet', body: [form], foot: [why, el('span', { class: 'sp' }),
    el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Pas encore'), create] });
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (create.disabled) return;
    try {
      const o = await api('objet/objects', { method: 'POST', body: { title: name.value.trim(), description: desc.value.trim(), item: chosen.id } });
      m.close();
      say(`Objet « ${o.title} » créé`);
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
  let o;
  try { o = await api('library/' + id); } catch (e) {
    app.replaceChildren(el('a', { class: 'o-back', href: '#' }, '‹ objets'), el('div', { class: 'empty-state' }, el('b', {}, 'Introuvable'),
      el('p', { class: 'hint' }, `${id} : ${e.message}. Il est peut-être à la corbeille de la bibliothèque.`),
      el('a', { class: 'tb ghost', href: href('asset/#/corbeille') }, 'La corbeille')));
    return;
  }
  if (o.kind !== 'element' || o.element.type !== 'object') {
    app.replaceChildren(el('a', { class: 'o-back', href: '#' }, '‹ objets'), el('div', { class: 'empty-state' }, el('b', {}, 'Pas un objet'),
      el('p', { class: 'hint' }, `« ${o.title} » est un ${o.kind === 'element' ? 'élément d\'une autre sorte' : o.kind}. Sa sorte se change dans sa fiche.`),
      el('a', { class: 'tb ghost', href: href(`asset/#${o.id}`) }, 'Sa fiche dans la bibliothèque')));
    return;
  }
  const s = await state();
  viewer?.stop();
  app.replaceChildren(...objectSheet(o, s));
  if (keepScroll) scrollTo({ top: y });
  followJob(o);
}

function objectSheet(o, s) {
  const e = o.element;
  const views = viewsOf(o);
  const main = views.find((r) => r.label === VIEWS[0].label) || views[0] || e.refs[0];
  const m = lastMesh(o);
  const wired = !!s?.trellis?.wired;
  const named = VIEWS.filter((v) => views.some((r) => r.label === v.label)).length;

  // l'en-tête
  const saved = el('span', { class: 'saved' }, 'enregistré');
  const name = el('input', { class: 'o-name', value: o.title, maxlength: 80, 'aria-label': 'nom de l\'objet', spellcheck: 'false' });
  name.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') name.blur(); if (ev.key === 'Escape') { name.value = o.title; name.blur(); } });
  name.addEventListener('change', async () => {
    const v = name.value.trim();
    if (!v || v === o.title) { name.value = o.title; return; }
    try { Object.assign(o, await api('library/' + o.id, { method: 'POST', body: { title: v } })); saved.classList.add('on'); setTimeout(() => saved.classList.remove('on'), 1600); } catch (err) { say(err.message); }
  });
  const tick = (cls, txt) => el('span', { class: `tick ${cls}` }, el('i'), el('span', {}, txt));
  const go3d = el('button', { class: 'tb go', type: 'button', id: 'go3d', disabled: !main,
    title: !main ? 'il lui faut une image' : wired ? 'TRELLIS.2 sur l\'image choisie' : 'un cube de contrôle : TRELLIS.2 n\'est pas encore câblé ici',
    onclick: () => run3d(o, wired) }, wired ? 'Tirer la 3D' : 'Tirer la 3D · factice');
  const head = el('section', { class: 'o-head' },
    el('div', { class: 'who' }, el('a', { class: 'o-back', href: '#' }, '‹ objets'), name,
      el('div', { class: 'o-specs' }, el('span', {}, 'objet'), main?.width ? el('span', {}, `${main.width} × ${main.height}`) : null,
        el('span', {}, `${plural(named, 'vue', 'vues')} sur 4`), el('span', {}, m ? (m.factice ? '3D factice' : '3D') : 'pas de 3D'), saved)),
    el('div', { class: 'o-act' },
      el('div', { class: 'ticks', 'aria-label': 'avancement' }, tick(main ? 'done' : 'wait', 'image'), tick(named >= 4 ? 'done' : 'wait', 'vues'),
        tick(m && !m.factice ? 'done' : m ? 'wait' : '', '3D'), tick('', 'taille')),
      el('a', { class: 'tb ghost', href: href(`asset/#${o.id}`) }, 'Dans la bibliothèque'), go3d),
    wired ? null : el('p', { class: 'why', style: { gridColumn: '1 / -1' } },
      'TRELLIS.2 n\'est pas câblé ici (Cal, 28/09 nuit : l\'écran d\'abord) — le bouton fait un cube de contrôle, marqué factice, pour montrer le parcours.'));

  // l'image choisie
  const hero = el('figure', { class: 'blk', style: { margin: 0 } },
    el('div', { class: 'pic-big' }, main ? el('img', { src: href(main.url), alt: `l'image de ${o.title}` }) : null,
      el('span', { class: 'src-tag' }, 'image choisie'),
      el('figcaption', {}, el('span', { class: 'lbl' }, 'face · 0°'), el('span', { class: 'lbl' }, main?.width ? `${main.width} × ${main.height}` : ''))),
    el('div', { class: 'blk-body' },
      el('p', { class: 'hint' }, 'La seule image que tu valides : TRELLIS.2 part d\'elle, et les vues aussi quand un modèle saura les faire.'),
      el('div', { class: 'row-end' },
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => changeImage(o, main) }, 'Changer d\'image'),
        el('a', { class: 'tb ghost sm', href: href('image/?for=object') }, 'En créer une dans Image ↗'))));

  // les vues
  const slot = (v, k) => {
    const r = views.find((x) => x.label === v.label) || (k === 0 ? main : null);
    if (r) {
      return el('div', { class: 'view ref' }, el('img', { src: href(r.thumb_url || r.url), alt: v.label }), el('span', { class: 'veil2' }),
        k ? el('button', { class: 'x', type: 'button', title: 'retirer cette vue', 'aria-label': `retirer ${v.label}`, onclick: () => removeRef(o, r) }, '×') : null,
        el('span', { class: 'nm' }, v.label), el('span', { class: `az ${k ? 'wait' : 'ok'}` }, k ? 'à la main · non contrôlée' : 'l\'image choisie'));
    }
    return el('button', { class: 'view empty', type: 'button', title: `ajouter la vue ${v.label} depuis la bibliothèque`, onclick: () => addView(o, v.label), html: v.svg },
      el('span', { class: 'nm' }, v.label), el('span', { class: 'az' }, 'aucun modèle · ajouter à la main'));
  };
  const extra = views.filter((r) => r !== main && !VIEWS.some((v) => v.label === r.label));
  const viewsBlk = el('div', { class: 'blk' },
    el('div', { class: 'blk-head' }, el('span', { class: 'ttl' }, 'ses vues'), el('span', { class: 'lbl' }, 'à 90°, hauteur d\'œil, même échelle')),
    el('div', { class: 'blk-body' },
      el('div', { class: 'turn' }, ...VIEWS.map(slot)),
      extra.length ? el('div', { class: 'turn' }, ...extra.map((r) => el('div', { class: 'view ref' }, el('img', { src: href(r.thumb_url || r.url), alt: '' }), el('span', { class: 'veil2' }),
        el('button', { class: 'x', type: 'button', title: 'retirer', onclick: () => removeRef(o, r) }, '×'), el('span', { class: 'nm' }, r.label || 'autre vue')))) : null,
      el('p', { class: 'hint' }, 'Aucun modèle installé ne fait encore ces vues justes (étude du 28/09). Celles qu\'on ajoute à la main servent de références ; TRELLIS.2, lui, n\'en lit officiellement qu\'une : l\'image choisie.')));

  // la 3D
  const three = el('div', { class: 'three' });
  const runBar = el('div', { class: 'run-bar', hidden: true }, el('i', { style: { width: '0%' } }));
  const runMsg = el('span', { class: 'lbl', id: 'run-msg' });
  const meshesRow = el('div', { class: 'row-end' });
  if (m) {
    three.append(el('span', { class: 'lbl tl' }, m.factice ? 'cube de contrôle · glisser pour tourner' : 'glisser pour tourner'),
      m.factice ? el('span', { class: 'st wait tr' }, 'factice · pas TRELLIS.2') : null);
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
    el('span', {}, el('b', {}, m.model || '?'))) : null;
  const threeBlk = el('div', { class: 'blk' },
    el('div', { class: 'blk-head' }, el('span', { class: 'ttl' }, 'en 3D'), el('span', { class: 'lbl' }, m ? (m.factice ? 'factice' : 'TRELLIS.2 · image unique') : 'pas encore')),
    el('div', { class: 'blk-body' }, three, runBar, runMsg, stats, meshesRow));

  // la colonne : ce que c'est, ce qu'on lit pour la 3D
  const desc = el('textarea', { class: 'fld', rows: 5, placeholder: 'ce que c\'est : matières, couleurs, taille, détails', 'aria-label': 'description' });
  desc.value = e.description || '';
  const dsaved = el('span', { class: 'saved' }, 'enregistré');
  desc.addEventListener('change', async () => {
    try { Object.assign(o, await api('library/' + o.id, { method: 'POST', body: { element: { description: desc.value.trim() } } })); dsaved.classList.add('on'); setTimeout(() => dsaved.classList.remove('on'), 1600); } catch (err) { say(err.message); }
  });
  const square = main?.width && main.width === main.height;
  const t = s?.trellis || {};
  const mach = (t.machines || []).map((x) => `${x.machine} ${x.up ? (x.missing?.length ? '· il manque ' + x.missing.join(', ') : '· modèles présents') : '· ne répond pas'}`).join(' ; ');
  const side = el('aside', { class: 'o-side' },
    el('div', { class: 'blk' }, el('div', { class: 'blk-head' }, el('span', { class: 'ttl' }, 'ce que c\'est'), el('span', { class: 'lbl' }, 'les modèles le liront')),
      el('div', { class: 'blk-body' }, desc, el('div', { class: 'row-end' }, dsaved, el('span', { class: 'lbl' }, 'enregistré en quittant le champ')))),
    el('div', { class: 'blk' }, el('div', { class: 'blk-head' }, el('span', { class: 'ttl' }, 'lu pour la 3D'), el('span', { class: 'lbl' }, 'TRELLIS.2 · étude du 28/09')),
      el('div', { class: 'blk-body' }, el('dl', { class: 'facts' },
        el('dt', {}, 'entrée'), el('dd', {}, el('b', {}, 'une image'), ' : l\'image choisie ; les vues ne partent pas'),
        el('dt', {}, 'cette image'), el('dd', {}, main?.width ? `${main.width} × ${main.height} ` : '? ', square ? el('span', {}, '· carrée') : el('span', { class: 'flag' }, '· pas carrée : le graphe la recadre sur l\'objet')),
        el('dt', {}, 'fond'), el('dd', {}, 'détouré par BiRefNet dans le graphe'),
        el('dt', {}, 'cadrage'), el('dd', {}, 'carré serré, sans marge (pad 1,0), 1024 px'),
        el('dt', {}, 'sortie'), el('dd', {}, 'un GLB texturé, Y en haut, rangé dans l\'élément'),
        el('dt', {}, 'machines'), el('dd', {}, mach || 'aucune voie « image » déclarée'),
        el('dt', {}, 'câblage'), el('dd', {}, wired ? el('b', {}, 'câblé') : el('span', { class: 'flag' }, 'pas encore : cube de contrôle'))))),
    el('div', { class: 'blk' }, el('div', { class: 'blk-head' }, el('span', { class: 'ttl' }, 'la chaîne'), el('span', { class: 'lbl' }, 'où on en est')),
      el('div', { class: 'blk-body' }, el('p', { class: 'hint' }, 'Image : prête. Vues : aucun modèle retenu. 3D : TRELLIS.2 image unique, documenté, pas câblé. Taille et attache : plus tard.'),
        el('div', { class: 'row-end' }, el('a', { class: 'tb ghost sm', href: '#' }, 'L\'état de la chaîne'), el('a', { class: 'tb ghost sm', href: MAQUETTE, target: '_blank', rel: 'noopener' }, 'La maquette ↗')))));

  S.run = { bar: runBar, msg: runMsg, go3d };
  return [head, el('section', { class: 'o-grid' }, hero, el('div', { class: 'o-mid' }, viewsBlk, threeBlk), side)];
}

const S = { run: null };

// ── les vues, l'image ────────────────────────────────────────
async function addView(o, label, items = null) {
  const got = items || await pick({ kinds: ['image'], title: `La vue ${label} de ${o.title}` });
  const it = got[0];
  if (!it) return;
  try {
    await api(`elements/${o.id}/refs`, { method: 'POST', body: { item: it.id, role: 'view', label } });
    say(`vue ${label} ajoutée`);
  } catch (e) { say(e.message); }
  paintObject(o.id, { keepScroll: true });
}

async function removeRef(o, r) {
  const before = o.element.refs.map((x) => ({ file: x.file, role: x.role, label: x.label, item: x.item }));
  const list = before.filter((x) => x.file !== r.file);
  try {
    await api(`asset/refs/${o.id}`, { method: 'POST', body: { refs: list } });
    say(`${r.label || 'vue'} retirée`, async () => { await api(`asset/refs/${o.id}`, { method: 'POST', body: { refs: before } }); paintObject(o.id, { keepScroll: true }); });
  } catch (e) { say(e.message); }
  paintObject(o.id, { keepScroll: true });
}

async function changeImage(o, main) {
  const [it] = await pick({ kinds: ['image'], title: `Une autre image pour ${o.title}` });
  if (!it) return;
  try {
    const n = await api(`elements/${o.id}/refs`, { method: 'POST', body: { item: it.id, role: 'view', label: VIEWS[0].label } });
    const refs = n.element.refs;
    const added = refs[refs.length - 1];
    // la nouvelle en tête ; l'ancienne reste dans l'élément, en « détail »
    const list = [added, ...refs.slice(0, -1).map((x) => (main && x.file === main.file ? { ...x, role: 'detail', label: 'ancienne image' } : x))]
      .map((x) => ({ file: x.file, role: x.role, label: x.label, item: x.item }));
    await api(`asset/refs/${o.id}`, { method: 'POST', body: { refs: list } });
    say('nouvelle image choisie ; l\'ancienne reste dans l\'élément, en détail');
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
  };
  const done = await jobs.wait(j.id, paint);
  following = null;
  if (done.state === 'done') say(done.result?.note ? `3D rangée · ${done.result.note}` : '3D rangée');
  else say(`3D : ${done.message || done.state}`);
  if (location.hash.slice(1) === o.id) paintObject(o.id, { keepScroll: true });
}

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
    controls.autoRotate = true;
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
dropAnywhere(async (files) => {
  const f = files.find((x) => /^image\//.test(x.type)) || files[0];
  let it;
  try { it = await uploadFile(f, { tool: 'object' }); } catch (e) { say(e.message); return; }
  const h = decodeURIComponent(location.hash.slice(1));
  if (ID_RX.test(h)) {
    const o = await api('library/' + h);
    const have = viewsOf(o).map((r) => r.label);
    const free = VIEWS.find((v) => !have.includes(v.label));
    if (!free) { say('les quatre vues sont là : l\'image est rangée dans la bibliothèque'); return; }
    return addView(o, free.label, [it]);
  }
  newObject({ item: it });
});

render();
