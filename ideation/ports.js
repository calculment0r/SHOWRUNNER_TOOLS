// IDÉATION — les ports et les fils : ce que chaque objet de la planche
// donne (sa sortie) et reçoit (ses entrées), ce qui peut se brancher, ce
// qu'un fil transporte. Une seule vérité, pure (ni DOM, ni réseau) : le
// canvas, les cartes et l'inspecteur la lisent, et le contrôle
// (server/tools/ideation.py) l'essaie par node.
//
// Un fil (lien de données) : { id, a, b, kind: 'wire', pa, pb, label }
//   a, pa  l'objet d'où il part et sa sortie — l'identifiant de la sortie
//          est sa sorte : text, image, video, audio, element ;
//   b, pb  l'objet où il arrive et son entrée : prompt, refs (carte Générer
//          image), start, end, image, element, video, audio (carte Générer
//          vidéo, selon son mode), s:<case> (une case du composeur).
// Les autres liens sont des annotations : `arrow` et `line` (les flèches
// droites), `out` (la lignée : a a produit b). Plusieurs fils peuvent partir
// d'une sortie ; une entrée à une place (prompt, première image, une case)
// n'en reçoit qu'un ; l'ordre des fils d'une entrée est leur ordre dans la
// planche (réf. 1, 2… ; @image1, @image2…) : une adresse est une place, et le
// modèle prend les N premières — les suivantes sont gardées (`held`), grisées,
// pas envoyées (la règle commune des références, commun/refs.js).
//
// Les capacités viennent des outils : caps.image = /api/image/models,
// caps.movie = /api/movie/options. Tant qu'elles ne sont pas lues, une entrée
// qui en dépend n'a pas de plafond connu (max: null) : rien n'est marqué faux
// sur une supposition.

// les sortes de données et leur teinte (un nom de jeton de commun/tokens.css ;
// server/tools/ideation.py a la même table pour l'export, le contrôle les compare)
export const KINDS = {
  text:    { label: 'texte',   plural: 'textes',   color: 'amb' },
  image:   { label: 'image',   plural: 'images',   color: 'coral-3' },
  element: { label: 'élément', plural: 'éléments', color: 'coral-2' },
  video:   { label: 'vidéo',   plural: 'vidéos',   color: 'cy' },
  audio:   { label: 'son',     plural: 'sons',     color: 'grn2' },
};
export const TEXT_TYPES = ['note', 'sticky', 'title'];
export const MAKERS = ['gen', 'vgen'];          // les cartes qui fabriquent : leur sortie est leur dernier résultat
// les modes de la carte vidéo : ceux de /api/movie/options (movie.py, MODES)
export const VMODES = { t2v: 'Texte', i2v: 'Images', r2v: 'Références' };
const PORT_LABEL = { prompt: 'prompt', refs: 'références', start: 'première image', end: 'dernière image',
  image: 'images', element: 'éléments', video: 'vidéos', audio: 'sons' };

// le composeur de prompt (étude docs/etudes/ideation_weavy.md § 9) : des cases
// à rôle, dans l'ordre où les guides des modèles veulent la prose — le style et
// le plan, les personnages et leurs attributs, leur action, le décor, la
// lumière et la prise de vue (§ 7) ; Son et Musique ne vont qu'à la vidéo, dans
// leurs champs à eux (overall_soundscape, non_diegetic_music d'H3). L'ordre de
// la carte est l'ordre de la prose ; il se change à la main.
export const ROLES = [
  { id: 'style', name: 'Style', hint: 'le médium, le plan : « A candid cinematic photograph. »' },
  { id: 'persos', name: 'Personnages', hint: 'qui, avec ses attributs : « A woman in her thirties, wearing a long red coat. »' },
  { id: 'action', name: 'Action', hint: 'ce qu’ils font : « She runs across the street, looking back. »' },
  { id: 'decor', name: 'Décor', hint: 'où, quand : « A rainy street in Tokyo at night. »' },
  { id: 'photo', name: 'Photographie', hint: 'caméra, objectif, lumière, pellicule : « Shot on 35mm film, soft window light. »' },
  { id: 'son', name: 'Son', hint: 'vidéo seulement : ce qu’on entend (« Rain on the roof, distant traffic. »)', video: true },
  { id: 'musique', name: 'Musique', hint: 'vidéo seulement : la musique hors champ', video: true },
  { id: 'libre', name: 'Libre', hint: 'une composante libre' },
];
export const DEFAULT_ROLES = ['style', 'persos', 'action', 'decor', 'photo'];
export const SLOTS = DEFAULT_ROLES.map((r) => ROLES.find((x) => x.id === r));   // les cinq d'un composeur neuf
const ROLE = Object.fromEntries(ROLES.map((r) => [r.id, r]));
const VIDEO_ONLY = new Set(['son', 'musique']);
// Son et Musique ne varient pas : ils vont aux champs à part d'H3, pas à la prose
export const NO_VARY = VIDEO_ONLY;

// « Varier » (étude § 9.3) : une case devient une liste, une valeur par ligne,
// chacune cochée ou non. Écrite : ses valeurs `values` [{ t, on }] (sans liste,
// les lignes de son texte) ; branchée : les lignes du texte reçu, `skip` les
// valeurs décochées (par leur texte : l'ordre de la note peut changer). Une
// seule case varie sur toute la chaîne de composeurs qui mène à une carte.
const lines = (t) => String(t || '').split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
export function valuesOf(s, received = null) {
  if (received !== null) {
    const skip = new Set(s.skip || []);
    return lines(received).map((t) => ({ t, on: !skip.has(t) }));
  }
  if (Array.isArray(s.values)) return s.values.map((v) => ({ t: String(v?.t ?? '').replace(/\s+/g, ' ').trim(), on: v?.on !== false }));
  return lines(s.text).map((t) => ({ t, on: true }));
}
export const picked = (vals) => vals.filter((v) => v.on && v.t).map((v) => v.t);
export const varies = (s) => !!s?.vary && !s.lock && !NO_VARY.has(roleOf(s).id);
// les pastilles d'une case Photographie (celles de l'outil Image : caméra, objectif,
// ouverture, pellicule, lumière) : leurs identifiants, le serveur écrit leur phrase
export const cleanLooks = (L) => Object.fromEntries(Object.entries(L || {}).filter(([g, v]) => g && v));
export const roleOf = (s) => ROLE[s?.role] || ROLE[s?.id] || ROLE.libre;
export const slotHint = (s) => roleOf(s).hint;
// une case neuve : son identifiant est son rôle, ou rôle-2, rôle-3… s'il est pris
export function newSlot(role, slots = []) {
  const r = ROLE[role] || ROLE.libre;
  let id = r.id, k = 2;
  while (slots.some((s) => s.id === id)) id = `${r.id}-${k++}`;
  return { id, role: r.id, name: r.name, text: '', lock: false, off: false };
}
export const newSlots = (roles = DEFAULT_ROLES) => roles.reduce((out, r) => [...out, newSlot(r, out)], []);
// une case devient une phrase : un point s'il en manque un (_sentence d'image.py), rien d'inventé
export function sentence(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return !s || /[.!?»"']$/.test(s) ? s : s + '.';
}
export const SEP = ' ';   // entre deux cases : une espace, un seul paragraphe (Krea 2, Qwen 2.1)

const get = (items, id) => (items && typeof items.get === 'function' ? items.get(id) : items?.[id]);
const nodeMap = (board) => new Map((board?.nodes || []).map((n) => [n.id, n]));
const cut = (s, k = 28) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > k ? s.slice(0, k - 1) + '…' : s; };
export function nameOf(n) {
  if (!n) return '?';
  if (TEXT_TYPES.includes(n.type)) return `${{ note: 'note', sticky: 'post-it', title: 'titre' }[n.type]} « ${cut(n.text) || 'vide'} »`;
  if (n.type === 'compose') return 'le composeur';
  if (n.type === 'gen') return `Générer image « ${cut(n.prompt, 22) || '—'} »`;
  if (n.type === 'vgen') return `Générer vidéo « ${cut(n.prompt, 22) || '—'} »`;
  if (n.type === 'media') return `« ${cut(n.title || n.item)} »`;
  return n.type;
}
// d'où vient un texte, dit comme une phrase : « de la note « … » », « du composeur »
export function fromName(n) {
  if (!n) return 'de ?';
  const t = { note: 'de la note', sticky: 'du post-it', title: 'du titre' }[n.type];
  if (t) return `${t} « ${cut(n.text) || 'vide'} »`;
  if (n.type === 'compose') return 'du composeur';
  return 'de ' + nameOf(n);
}
// une raison courte pour la carte (la longue reste au survol et dans l'inspecteur)
export const short = (why) => String(why || '').split(' : ')[0];
export const imageModel = (caps, id) => caps?.image?.models?.find((m) => m.id === id) || null;
const modeLabel = (caps, mode) => caps?.movie?.modes?.find((m) => m.id === mode)?.label || VMODES[mode] || mode;

// ── ce qu'un objet donne ───────────────────────────────────
export function outPort(n) {
  if (!n) return null;
  if (TEXT_TYPES.includes(n.type) || n.type === 'compose') return { id: 'text', kind: 'text' };
  if (n.type === 'media' && KINDS[n.kind]) return { id: n.kind, kind: n.kind };
  if (n.type === 'gen') return { id: 'image', kind: 'image' };
  if (n.type === 'vgen') return { id: 'video', kind: 'video' };
  return null;
}

// ── ce qu'un objet reçoit ──────────────────────────────────
// [{ id, label, accepts: [sortes], max: nombre | null (inconnu), why (max 0), lock, off, token }]
export function inPorts(n, caps = {}) {
  if (!n) return [];
  const P = (id, label, accepts, max, extra = {}) => ({ id, label, accepts, max, why: '', ...extra });
  if (n.type === 'gen') {
    const m = imageModel(caps, n.model);
    const refs = P('refs', 'références', ['image', 'element'], m ? m.refs : null);
    if (m && !m.refs) refs.why = m.refs_why || `${m.name} ne prend pas de référence`;
    return [P('prompt', 'prompt', ['text'], 1), refs];
  }
  if (n.type === 'vgen') {
    const L = caps?.movie?.limits;
    const out = [P('prompt', 'prompt', ['text'], 1)];
    if (n.mode === 'i2v') out.push(P('start', 'première image', ['image'], 1), P('end', 'dernière image', ['image'], 1));
    if (n.mode === 'r2v') {
      out.push(P('image', 'images', ['image'], L ? L.image : null, { token: 'image' }),
        P('element', 'éléments', ['element'], L ? L.image : null, { token: 'element' }),
        P('video', 'vidéos', ['video'], L ? L.video : null, { token: 'video' }),
        P('audio', 'sons', ['audio'], L ? L.audio : null, { token: 'audio' }));
    }
    return out;
  }
  if (n.type === 'compose') {
    return (n.slots || []).map((s) => P('s:' + s.id, s.name || 'case', ['text'], 1, { slot: s.id, lock: !!s.lock, off: !!s.off }));
  }
  return [];
}
export const portOf = (n, id, caps) => inPorts(n, caps).find((p) => p.id === id) || null;

// ce qu'un élément envoie à H3 : son premier visage et son premier plein pied,
// sinon ses deux premières images (movie.py, element_parts — le même compte)
const AUDIO_RX = /\.(wav|mp3|flac|m4a|ogg)$/i;
export function elementPictures(it) {
  const imgs = (it?.element?.refs || []).filter((r) => !AUDIO_RX.test(r.file || ''));
  const chosen = ['face', 'full body'].map((role) => imgs.find((x) => x.role === role)).filter(Boolean);
  return (chosen.length ? chosen : imgs.slice(0, 2)).length || 1;
}

// qui la limite : le nom du modèle, ou H3 pour la vidéo
function who(B, caps) {
  if (B.type === 'gen') return imageModel(caps, B.model)?.name || 'ce modèle';
  if (B.type === 'vgen') return 'H3';
  return 'cette entrée';
}
function fullWhy(port, B, caps) {
  if (port.max === 1) return `${port.label} : une seule entrée`;
  // la raison du modèle, dite par l'outil Image (« Krea 2 prend 2 références : la scène, puis le sujet »)
  if (B.type === 'gen' && port.id === 'refs' && imageModel(caps, B.model)?.refs_max_why) return imageModel(caps, B.model).refs_max_why;
  const k = port.accepts.length > 1 ? 'références' : KINDS[port.accepts[0]]?.plural || '';
  return `${who(B, caps)} prend ${port.max} ${k} au plus`;
}
// ce qu'une entrée dit d'une sorte qu'on lui tend ('' : elle la prend)
const ONE = { text: 'un texte', image: 'une image', element: 'un élément', video: 'une vidéo', audio: 'un son' };
export const oneOf = (k) => ONE[k] || k;
function acceptWhy(port, kind, B, caps) {
  if (port.max === 0) return port.why || `${port.label} : fermée`;
  if (!port.accepts.includes(kind)) {
    if (B.type === 'vgen' && (port.id === 'start' || port.id === 'end') && kind === 'element') {
      return `une ${port.label} est une image : un élément va en mode ${modeLabel(caps, 'r2v')}`;
    }
    return `${port.label} : ${port.accepts.map(oneOf).join(' ou ')}, pas ${oneOf(kind)}`;
  }
  if (port.lock) return `la case « ${port.label} » est verrouillée`;
  return '';
}

// b mène-t-il à a par des fils ? (un fil a → b fermerait une boucle)
export function reaches(board, from, to) {
  const next = new Map();
  for (const l of board?.links || []) if (l.kind === 'wire') { if (!next.has(l.a)) next.set(l.a, []); next.get(l.a).push(l.b); }
  const seen = new Set([from]);
  const todo = [from];
  while (todo.length) {
    const x = todo.pop();
    if (x === to) return true;
    for (const y of next.get(x) || []) if (!seen.has(y)) { seen.add(y); todo.push(y); }
  }
  return false;
}

// la dernière image (ou vidéo) posée par une carte qui fabrique : sa lignée `out`
export function latestResult(board, id, kind, items) {
  const nodes = nodeMap(board);
  const L = board?.links || [];
  for (let i = L.length - 1; i >= 0; i--) {
    const l = L[i];
    if (l.kind !== 'out' || l.a !== id) continue;
    const m = nodes.get(l.b);
    if (m && m.type === 'media' && m.kind === kind && !get(items, m.item)?.missing) return m;
  }
  return null;
}

// ── peut-on brancher la sortie `pa` de a sur l'entrée `pb` de b ? ('' : oui)
export function canWire(board, a, pa, b, pb, caps = {}, items = null) {
  const nodes = nodeMap(board);
  const A = nodes.get(a), B = nodes.get(b);
  if (!A || !B) return 'un des deux objets n’est plus sur la planche';
  if (a === b) return 'un objet ne se branche pas sur lui-même';
  const out = outPort(A);
  if (!out || out.id !== pa) return `${nameOf(A)} ne donne rien à brancher`;
  const port = portOf(B, pb, caps);
  if (!port) return `${nameOf(B)} n’a pas d’entrée « ${PORT_LABEL[pb] || pb} »`;
  const w = acceptWhy(port, out.kind, B, caps);
  if (w) return w;
  if (A.type === 'media' && get(items, A.item)?.missing) return 'cet objet a quitté la bibliothèque';
  const L = board.links || [];
  const here = L.filter((l) => l.kind === 'wire' && l.b === b && l.pb === pb);
  if (here.some((l) => l.a === a)) return 'déjà branché ici';
  // une entrée à une place : le nouveau fil remplace l'ancien (replaces) ; sinon le plafond
  if (port.max !== null && port.max !== 1 && here.length >= port.max) return fullWhy(port, B, caps);
  if (B.type === 'vgen' && B.mode === 'r2v' && (port.id === 'image' || port.id === 'element')) {
    const limit = caps?.movie?.limits?.image;
    if (limit) {
      const cost = (n) => (n.type === 'media' && n.kind === 'element' ? elementPictures(get(items, n.item)) : 1);
      const used = L.filter((l) => l.kind === 'wire' && l.b === b && (l.pb === 'image' || l.pb === 'element'))
        .reduce((t, l) => t + (nodes.get(l.a) ? cost(nodes.get(l.a)) : 0), 0);
      if (used + cost(A) > limit) return `H3 prend ${limit} images au plus (un personnage en envoie deux)`;
    }
  }
  if (reaches(board, b, a)) return 'une boucle : ce qui sort d’ici y reviendrait';
  return '';
}
// le fil qu'un nouveau branchement sur une entrée à une place remplacerait
export function replaces(board, b, pb, caps = {}) {
  const B = nodeMap(board).get(b);
  const port = B && portOf(B, pb, caps);
  if (!port || port.max !== 1) return null;
  return (board.links || []).find((l) => l.kind === 'wire' && l.b === b && l.pb === pb) || null;
}

// les cartes qu'on peut créer déjà branchées, depuis une sortie qu'on tire
export const TEMPLATES = [
  { type: 'gen', label: 'Générer image', dot: 'or' },
  { type: 'vgen', preset: { mode: 't2v' }, label: 'Générer vidéo · texte', dot: 'cy' },
  { type: 'vgen', preset: { mode: 'i2v' }, label: 'Générer vidéo · image → vidéo', dot: 'cy' },
  { type: 'vgen', preset: { mode: 'r2v' }, label: 'Générer vidéo · références', dot: 'cy' },
  // un texte tiré vers un composeur neuf y entre dans une case Libre : rien ne dit qu'il est un décor plutôt qu'une action
  { type: 'compose', preset: { roles: ['libre'] }, label: 'Composeur de prompt', dot: 'amb' },
];
// pour une sorte : [{ template, port, preset }] — l'entrée qu'elle prendrait dans chaque carte neuve
export function makersFor(kind, caps = {}, defaults = {}) {
  const out = [];
  for (const t of TEMPLATES) {
    const { roles, ...rest } = t.preset || {};
    const n = { type: t.type, ...(defaults[t.type] || {}), ...rest };
    if (t.type === 'compose') n.slots = newSlots(roles);
    let port = inPorts(n, caps).find((p) => p.accepts.includes(kind) && p.max !== 0);
    // une référence tendue à une carte image dont le modèle par défaut n'en prend pas :
    // Krea 2 (« reprend une personne d'après 1 ou 2 références »), sinon le premier qui en prend
    if (!port && t.type === 'gen' && (kind === 'image' || kind === 'element')) {
      const krea = imageModel(caps, 'krea2');
      const alt = krea?.refs ? krea : (caps?.image?.models || []).find((m) => m.refs > 0);
      if (alt || !caps?.image) { n.model = alt ? alt.id : 'krea2'; port = inPorts(n, caps).find((p) => p.accepts.includes(kind)); }
    }
    if (!port) continue;
    const preset = { ...rest };
    if (t.type === 'compose') preset.slots = n.slots;
    if (t.type === 'gen' && n.model !== defaults.gen?.model) preset.model = n.model;
    out.push({ template: t, port, preset });
  }
  return out;
}

// ── ce qui passe dans les fils d'une planche ───────────────
// flow(board, caps, items) : l'état de chaque fil et ce que chaque entrée
// reçoit, calculé d'un coup. Un fil `ok: false` est dessiné en alerte, avec
// sa raison, et n'est pas lu ; `pending` : sa source fabrique et n'a pas
// encore de résultat ; `off` : il arrive dans une case coupée.
export function flow(board, caps = {}, items = null) {
  const nodes = nodeMap(board);
  const L = board?.links || [];
  const state = new Map();
  const into = new Map();
  const count = new Map();
  const pics = new Map();
  const over = new Set();   // les entrées déjà pleines (judge, ci-dessous)
  const add = (b, pb, e) => {
    if (!into.has(b)) into.set(b, {});
    const o = into.get(b);
    (o[pb] = o[pb] || []).push(e);
  };
  for (const l of L) {
    if (l.kind !== 'wire') continue;
    const A = nodes.get(l.a), B = nodes.get(l.b);
    if (!A || !B) continue;
    const st = judge(l, A, B);
    state.set(l.id, st);
    add(B.id, l.pb, { link: l, from: A, ...st });
  }
  // la règle commune des références (commun/refs.js) : au-delà de ce que prend le modèle, un
  // fil est gardé (`held`), grisé, pas envoyé — il se rallume avec un modèle qui en prend plus ;
  // une fois une place gardée, les suivantes le sont aussi (le modèle prend les N premières).
  // (`over` : déclaré avant la boucle qui juge les fils, plus haut)
  function judge(l, A, B) {
    const bad = (why) => ({ ok: false, why });
    const held = (why, k) => { over.add(B.id + '|' + l.pb); return { ok: false, held: true, why, idx: k }; };
    const out = outPort(A);
    if (!out || out.id !== l.pa) return bad(`${nameOf(A)} ne donne plus ${KINDS[l.pa] ? 'de ' + KINDS[l.pa].label : 'rien'}`);
    if (A.type === 'media' && get(items, A.item)?.missing) return bad('cet objet a quitté la bibliothèque (corbeille d’Asset ?)');
    const port = portOf(B, l.pb, caps);
    if (!port) {
      if (B.type === 'vgen') return bad(`le mode ${modeLabel(caps, B.mode)} n’a pas d’entrée « ${PORT_LABEL[l.pb] || l.pb} »`);
      if (B.type === 'compose') return bad('cette case a été retirée du composeur');
      return bad(`${nameOf(B)} n’a pas d’entrée « ${PORT_LABEL[l.pb] || l.pb} »`);
    }
    if (!port.accepts.includes(out.kind)) return bad(acceptWhy({ ...port, lock: false }, out.kind, B, caps));
    if (reaches(board, B.id, A.id)) return bad('une boucle : ce qui sort d’ici y revient');
    const key = B.id + '|' + l.pb;
    const k = count.get(key) || 0;
    if (port.max === 0) { count.set(key, k + 1); return held(port.why || `${port.label} : fermée`, k); }
    if (port.max !== null && k >= port.max) {
      if (port.max === 1) return bad(`${port.label} : une seule entrée, ce fil est en trop`);
      count.set(key, k + 1);
      return held(`${fullWhy(port, B, caps)} — ce fil est le ${k + 1}e`, k);
    }
    if (B.type === 'vgen' && B.mode === 'r2v' && (l.pb === 'image' || l.pb === 'element')) {
      const limit = caps?.movie?.limits?.image;
      const cost = A.type === 'media' && A.kind === 'element' ? elementPictures(get(items, A.item)) : 1;
      const used = pics.get(B.id) || 0;
      if (limit && (used + cost > limit || over.has(B.id + '|pics'))) {
        over.add(B.id + '|pics');
        count.set(key, k + 1);
        return held(`H3 prend ${limit} images au plus (un personnage en envoie deux)`, k);
      }
      pics.set(B.id, used + cost);
    }
    count.set(key, k + 1);
    const st = { ok: true, why: '', idx: k };
    if (MAKERS.includes(A.type) && !latestResult(board, A.id, out.kind, items)) st.pending = `${nameOf(A)} n’a pas encore de résultat`;
    if (port.off) st.off = true;
    return st;
  }

  // la valeur d'une entrée : l'objet de la bibliothèque (une image, un élément…) ou le texte
  const itemOf = (A) => {
    if (A.type === 'media') return A.item;
    const o = outPort(A);
    return MAKERS.includes(A.type) && o ? latestResult(board, A.id, o.kind, items)?.item || null : null;
  };
  // le texte d'une sortie : une note telle qu'écrite ; un composeur, ses cases
  // (ni coupées, ni vides, ni Son ni Musique) en phrases jointes par une espace.
  // `sub` { cid, sid, t } : la valeur que prend la case qui varie (sinon sa première cochée)
  function textOf(id, seen = new Set(), sub = null) {
    const n = nodes.get(id);
    if (!n || seen.has(id)) return '';
    if (TEXT_TYPES.includes(n.type)) return n.text || '';
    if (n.type !== 'compose') return '';
    seen.add(id);
    return parts(n, seen, sub).filter((p) => !p.off && !VIDEO_ONLY.has(p.role) && p.text.trim()).map((p) => sentence(p.text)).join(SEP);
  }
  function parts(C, seen = new Set([C.id]), sub = null) {
    const got = into.get(C.id) || {};
    return (C.slots || []).map((s) => {
      const e = (got['s:' + s.id] || []).find((x) => x.ok);
      let text = e ? textOf(e.from.id, new Set(seen), sub) : (s.text || '');
      let values = null;
      if (varies(s)) {
        values = valuesOf(s, e ? text : null);
        const on = picked(values);
        text = sub && sub.cid === C.id && sub.sid === s.id ? sub.t : on[0] || '';
      }
      return { slot: s, role: roleOf(s).id, text, values, from: e ? e.from : null,
        link: e ? e.link : null, off: !!s.off, bad: (got['s:' + s.id] || []).filter((x) => !x.ok) };
    });
  }
  // le son et la musique d'un composeur (et des composeurs qui s'y branchent) : les champs à part
  // d'H3 ; et ses pastilles de prise de vue (ses cases Photographie, puis les composeurs branchés,
  // dans l'ordre de la prose : la dernière dit vrai) — null s'il n'a aucune case Photographie
  function extras(id, seen = new Set()) {
    const n = nodes.get(id);
    const out = { son: [], musique: [] };
    let looks = null;
    if (!n || n.type !== 'compose' || seen.has(id)) return { son: '', musique: '', looks: null };
    seen.add(id);
    for (const p of parts(n, new Set(seen))) {
      if (p.off) continue;
      if (VIDEO_ONLY.has(p.role) && p.text.trim()) out[p.role].push(sentence(p.text));
      if (p.role === 'photo') looks = { ...(looks || {}), ...cleanLooks(p.slot.looks) };
      if (p.from?.type === 'compose') {
        const x = extras(p.from.id, seen);
        if (x.son) out.son.push(x.son);
        if (x.musique) out.musique.push(x.musique);
        if (x.looks) looks = { ...(looks || {}), ...x.looks };
      }
    }
    return { son: out.son.join(SEP), musique: out.musique.join(SEP), looks };
  }
  // les cases qui varient sous une sortie : celles du composeur et des composeurs qui s'y branchent
  function lotsIn(id, seen = new Set()) {
    const n = nodes.get(id);
    if (!n || n.type !== 'compose' || seen.has(id)) return [];
    seen.add(id);
    const out = [];
    for (const p of parts(n, new Set(seen))) {
      if (p.off) continue;
      if (p.values) out.push({ cid: n.id, sid: p.slot.id, name: p.slot.name || roleOf(p.slot).name, values: p.values, on: picked(p.values) });
      else if (p.from?.type === 'compose') out.push(...lotsIn(p.from.id, seen));
    }
    return out;
  }
  // le lot d'une sortie : { cid, sid, name, values, on } — la case qui varie, ses valeurs cochées
  // (`on`) ; { conflict: [cases] } si deux cases varient ; null si rien ne varie
  const lot = (id) => { const L = lotsIn(id); return !L.length ? null : L.length === 1 ? L[0] : { conflict: L }; };
  // le texte d'une sortie pour la valeur k de son lot (la première cochée sans lot)
  const textAt = (id, k = 0) => {
    const L = lot(id);
    if (!L || L.conflict || !L.on.length) return textOf(id);
    return textOf(id, new Set(), { cid: L.cid, sid: L.sid, t: L.on[Math.max(0, Math.min(k, L.on.length - 1))] });
  };
  const inputs = (id) => into.get(id) || {};
  // ce qu'une entrée reçoit de lisible : les fils bons, dans l'ordre, avec leur valeur
  const take = (id, pb) => (inputs(id)[pb] || []).filter((e) => e.ok).map((e) => ({ ...e, item: itemOf(e.from), text: outPort(e.from)?.kind === 'text' ? textOf(e.from.id) : '' }));
  // le prompt reçu par un fil : sa prose (celle de la valeur k si une case varie), son lot, et
  // d'un composeur son son, sa musique (pour la vidéo) et ses pastilles de prise de vue
  const prompt = (id, k = null) => {
    const e = take(id, 'prompt')[0];
    if (!e) return null;
    return { text: k === null ? e.text : textAt(e.from.id, k), from: e.from, link: e.link, lot: lot(e.from.id), ...extras(e.from.id) };
  };
  // la signature de ce qu'une carte reçoit : ce qui, s'il change, refait la carte
  const brief = (L) => (!L ? '' : L.conflict ? 'x' + L.conflict.map((x) => x.name).join('+') : `${L.name}:${L.values.map((v) => (v.on ? '1' : '0') + v.t).join('\n')}`);
  const sig = (id) => {
    const o = inputs(id);
    return Object.keys(o).sort().map((pb) => pb + ':' + o[pb].map((e) => [e.link.id, e.ok ? 1 : 0, e.why, e.pending || '', e.off ? 1 : 0,
      e.ok ? itemOf(e.from) || '' : '', e.ok && outPort(e.from)?.kind === 'text' ? textOf(e.from.id) + JSON.stringify(extras(e.from.id)) + brief(lot(e.from.id)) : ''].join('~')).join(',')).join('|');
  };
  // `bad` : les fils en alerte (pas ceux gardés au-delà de ce que prend le modèle : grisés sur la carte)
  return { state: (lid) => state.get(lid) || null, inputs, take, prompt, text: textOf, textAt, parts, extras, lot, sig, itemOf,
    bad: (id) => Object.values(inputs(id)).flat().filter((e) => !e.ok && !e.held) };
}

// les composeurs reliés à celui-ci par des fils de composeur à composeur (dans les deux
// sens) : une seule case varie sur toute cette famille (une carte n'en reçoit qu'une)
export function composerFamily(board, id) {
  const nodes = nodeMap(board);
  const next = new Map();
  for (const l of board?.links || []) {
    if (l.kind !== 'wire' || nodes.get(l.a)?.type !== 'compose' || nodes.get(l.b)?.type !== 'compose') continue;
    for (const [x, y] of [[l.a, l.b], [l.b, l.a]]) { if (!next.has(x)) next.set(x, []); next.get(x).push(y); }
  }
  const seen = new Set([id]);
  const todo = [id];
  while (todo.length) for (const y of next.get(todo.pop()) || []) if (!seen.has(y)) { seen.add(y); todo.push(y); }
  return [...seen].map((x) => nodes.get(x)).filter(Boolean);
}
// pourquoi cette case ne peut pas varier ('' : elle le peut)
export function varyWhy(board, c, s) {
  if (s.lock) return 'verrouillée : elle ne varie pas';
  if (NO_VARY.has(roleOf(s).id)) return `${roleOf(s).name} ne varie pas : il va au champ à part d’H3`;
  for (const n of composerFamily(board, c.id)) {
    const o = (n.slots || []).find((x) => varies(x) && !(n.id === c.id && x.id === s.id));
    if (o) return `« ${o.name} »${n.id === c.id ? '' : ' (un autre composeur branché)'} varie déjà : une case à la fois`;
  }
  return '';
}

// le texte composé d'un composeur (raccourci)
export const composed = (board, id, caps, items) => flow(board, caps, items).text(id);
