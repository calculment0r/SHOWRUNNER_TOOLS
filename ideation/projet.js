// IDÉATION — « Commencer un projet » : le mode showrunner (Cal, 05/10 ; l'étude :
// docs/etudes/mode_showrunner.md). L'accueil ouvre Idéation sur `?projet=nouveau` : pas encore
// de planche (elle naîtra dans le Workspace neuf), et par-dessus cette fenêtre, le mode « ingest ».
//
//   - UN champ, façon Claude : une zone de texte qui grandit (le brief) ; tout ce qu'on a s'y
//     lâche — sur toute la fenêtre —, se colle, se prend au trombone ou par dossier, se glisse du
//     panneau Asset. Chaque fichier devient une vignette AU-DESSUS du champ (son aperçu, sa sorte,
//     son nom, sa progression), retirable. Un dossier entre entier (webkitGetAsEntry, readEntries
//     rappelé jusqu'au vide) ; mille fichiers ne gèlent pas la page (vignettes par paquets d'une
//     image d'écran, aperçus paresseux).
//   - Le brief : ce qu'on tape, et/ou un document coché « c'est le brief » — détecté quand il est le
//     seul document et que le champ est vide.
//   - Le nom du projet (= la Team) et du Workspace (« Général » par défaut) ; « avec qui » : des
//     comptes qui existent (GET /api/equipes/personnes : Cal voit tout le monde, un autre les gens
//     de ses Teams). Qui ne crée pas de Team l'apprend avant de remplir (GET /api/equipes,
//     create_why : la phrase même du refus), avec ce qui le débloque.
//   - « Commencer » (le seul orange) : la Team (et son Workspace, renommé s'il le faut), les
//     personnes, l'onglet dans ce Workspace sans recharger (entrerEspace), la planche, les fichiers
//     (trois à la fois, la progression sur chaque vignette, un refus n'arrête pas les autres ; ce
//     qui vient d'Asset est rapatrié), le brief (une note ; tapé, il est rangé aussi en brief.md),
//     la mise en page de départ (des cadres : Brief, Documents, Images, Vidéos, Sons, Autres), puis
//     l'analyse de l'agent (app.agent.open(), app.agent.send(brief, { pieces, intent: 'ingest' }))
//     s'il est là — sinon rien : la planche reste rangée par la mise en page de départ.
//
// Rien n'est envoyé avant « Commencer » : le Workspace n'existe pas encore, un envoi ailleurs
// laisserait des doubles. Les fichiers attendent dans la page (des File : lus à l'envoi seulement).

import { api, el, toast, href, uploadFile, entrerEspace, session, dock, dockState, ITEM_MIME, MULTI_MIME, kindFr } from '../commun/shell.js';

// la feuille de la fenêtre : chargée ici (une page qui n'ouvre jamais la fenêtre ne la lit pas)
const FEUILLE = new URL('./projet.css', import.meta.url).href;
function feuille() {
  if (document.querySelector(`link[href="${FEUILLE}"]`)) return;
  document.head.append(el('link', { rel: 'stylesheet', href: FEUILLE }));
}

// ── les sortes, devinées pour la vignette (le portail tranche au rangement : item.kind) ──
const EXT = {
  image: 'png jpg jpeg webp gif avif heic heif tif tiff bmp svg psd exr dng cr2 nef arw raw jfif',
  video: 'mp4 mov m4v webm mkv avi mxf mts m2ts wmv flv mpg mpeg 3gp prores',
  audio: 'wav mp3 flac m4a ogg oga opus aac aif aiff wma mid midi',
  document: 'pdf doc docx odt rtf txt md markdown text pages ppt pptx odp key xls xlsx ods csv tsv numbers epub json html htm xml srt vtt fdx fountain celtx',
};
const EXT_KIND = {};
for (const [k, list] of Object.entries(EXT)) for (const x of list.split(' ')) EXT_KIND[x] = k;
const extOf = (name) => (/\.([^./]+)$/.exec(name || '') || [])[1]?.toLowerCase() || '';
function guessKind(file) {
  const k = EXT_KIND[extOf(file.name)];
  if (k) return k;
  const t = file.type || '';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('text/') || t === 'application/pdf') return 'document';
  return 'autre';
}
// un texte qu'on lit dans la page (le brief, sans attendre le portail)
const TEXTE_LOCAL = new Set('txt md markdown text fountain srt vtt csv tsv json'.split(' '));
// les fichiers du système qu'on ne range pas (un dossier copié d'un Mac, d'un PC)
const BRUIT = /^(\.|~\$)|^(thumbs\.db|desktop\.ini|icon\r)$/i;
const SORTE_FR = { image: 'image', video: 'vidéo', audio: 'son', document: 'document', autre: 'fichier', element: 'élément' };
const ICO = {
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
  video: '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="M17 10l4-2v8l-4-2"/>',
  audio: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10"/>',
  document: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  autre: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  element: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICO[k] || ICO.autre}</svg>`;
const fmtMo = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} Go` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} Mo` : `${Math.max(1, Math.round(n / 1e3))} Ko`)
  .replace('.', ',');
const jour = () => new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
// un nom de 40 signes : coupé à la fin d'un mot, sans la ponctuation qui traînerait (« des néons, »)
const nom40 = (s) => {
  const t = String(s || '').replace(/\s+/g, ' ').replace(/^[#>*\-\s]+/, '').trim();
  let c = t.slice(0, 40);
  if (t.length > 40 && t[40] !== ' ' && c.includes(' ')) c = c.replace(/\s+\S*$/, '');
  return c.replace(/[\s,;:·—–-]+$/, '');
};

// combien d'envois à la fois : assez pour remplir le lien, pas assez pour affamer le portail
const EN_MEME_TEMPS = 3;
// la mise en page de départ : l'ordre des cadres, ce qui va où
const CADRES = ['Brief', 'Documents', 'Images', 'Vidéos', 'Sons', 'Autres'];
const CADRE_DE = { document: 'Documents', image: 'Images', element: 'Images', video: 'Vidéos', audio: 'Sons', midi: 'Sons' };
// ce que l'agent prend d'un message (server/tools/ideation_agent.py : MAX_TEXT, MAX_ITEMS — au-delà, 400) ;
// les pièces dans cet ordre : le brief, les documents, les images, les vidéos, les sons, le reste
const AGENT_TEXTE = 4000;
const AGENT_PIECES = 24;
const ORDRE_PIECES = ['document', 'image', 'element', 'video', 'audio'];

let ouverte = null;   // une fenêtre à la fois

/** Ouvre la fenêtre « Commencer un projet » sur la page d'Idéation. `annule()` : fermée sans commencer. */
export function ouvrirProjet(app, { annule = () => {} } = {}) {
  if (ouverte) return ouverte;
  feuille();
  const P = {
    files: [], seen: new Set(), people: [], chosen: new Set(), peopleWhy: '', peopleErr: '',
    canCreate: null, createWhy: '', asked: null, running: false, done: false, nameTouched: false,
    R: { team: null, space: null, board: null, members: new Set(), memberErr: [], briefMd: null, briefMdErr: '', agent: false, agentErr: '' },
    pending: [], reading: 0,
  };
  let seq = 0;

  // ── la fenêtre ────────────────────────────────────────────
  const tiles = el('div', { class: 'pj-tiles', role: 'list', 'aria-label': 'les fichiers du projet' });
  const txt = el('textarea', { class: 'pj-txt', rows: '3', 'aria-label': 'le brief',
    placeholder: 'Le brief : écris-le ici, ou dépose-le (un texte, un PDF…). Dépose aussi tout le reste — images, vidéos, sons, documents, dossiers entiers : on range tout.' });
  const pickF = el('input', { type: 'file', multiple: true, hidden: true });
  const pickD = el('input', { type: 'file', multiple: true, hidden: true, webkitdirectory: true });
  const count = el('span', { class: 'pj-count' });
  const box = el('div', { class: 'pj-box' }, tiles, txt,
    el('div', { class: 'pj-tools' },
      el('button', { class: 'ic pj-clip', type: 'button', title: 'joindre des fichiers', 'aria-label': 'joindre des fichiers', onclick: () => pickF.click(),
        html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.4 3.4 0 0 1 4.8 4.8l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.7-7.7"/></svg>' }),
      el('button', { class: 'ic pj-dir', type: 'button', title: 'joindre un dossier entier', 'aria-label': 'joindre un dossier entier', onclick: () => pickD.click(),
        html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h6l2 2h10v11H3z"/></svg>' }),
      el('button', { class: 'tb ghost sm pj-asset', type: 'button', title: 'le panneau Asset : glisser ou cliquer un objet l’ajoute au projet',
        onclick: () => dock.open({ focus: true }) }, 'Depuis Asset'),
      count, el('span', { class: 'sp' }),
      el('span', { class: 'pj-hint' }, 'glisser · coller · dossiers')),
    pickF, pickD);
  const nameIn = el('input', { class: 'fld', maxlength: '40', 'aria-label': 'le nom du projet (la Team)', spellcheck: 'false' });
  const wsIn = el('input', { class: 'fld', maxlength: '40', value: 'Général', 'aria-label': 'le nom du Workspace', spellcheck: 'false' });
  const who = el('div', { class: 'pj-who-list', role: 'group', 'aria-label': 'les personnes à mettre dans la Team' });
  const whoFind = el('input', { class: 'fld pj-who-find', placeholder: 'chercher une personne', 'aria-label': 'chercher une personne', hidden: true });
  const whoWhy = el('p', { class: 'pj-note' });
  const names = el('div', { class: 'pj-names' },
    el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'le projet · la Team'), nameIn),
    el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'le Workspace'), wsIn));
  const whoSect = el('div', { class: 'pj-who' }, el('span', { class: 'lbl' }, 'avec qui · des personnes qui ont déjà un compte'), whoFind, who, whoWhy);
  const refus = el('div', { class: 'pj-refus', hidden: true });
  const steps = el('ol', { class: 'pj-steps', hidden: true, 'aria-live': 'polite' });
  const form = el('div', { class: 'pj-form' }, box, names, whoSect);
  const lede = el('p', { class: 'pj-lede' }, 'Un brief, et tout ce que tu as : PDF, images, vidéos, sons, textes, dossiers. Sans export, sans conversion — on range : une Team, son Workspace, une planche organisée, tout dans Asset.');
  const why = el('span', { class: 'pj-why' });
  const go = el('button', { class: 'tb go', type: 'button', onclick: () => commencer() }, 'Commencer');
  let armed = false;
  const shut = el('button', { class: 'tb ghost sm', type: 'button', title: 'fermer · Échap', onclick: () => fermer() }, 'Fermer');
  const modal = el('div', { class: 'modal pj', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Commencer un projet' },
    el('div', { class: 'modal-head' }, el('span', { class: 't' }, 'Commencer un projet'), el('span', { class: 'sp' }), shut),
    el('div', { class: 'modal-body pj-body' }, refus, lede, form, steps),
    el('div', { class: 'modal-foot' }, why, el('span', { class: 'sp' }), go));
  const voile = el('div', { class: 'pj-voile', 'aria-hidden': 'true' }, el('b', {}, 'déposer : tout entre dans le projet'),
    el('span', {}, 'fichiers, dossiers entiers, objets d’Asset'));
  const scrim = el('div', { class: 'scrim pj-scrim' }, modal, voile);
  document.body.append(scrim);
  document.documentElement.classList.add('pj-open');

  // ── les vignettes ─────────────────────────────────────────
  function tileOf(f) {
    const vis = el('div', { class: 'pj-vis' });
    if (f.kind === 'image' && f.file && f.file.size < 60e6) {
      f.url = URL.createObjectURL(f.file);
      vis.append(el('img', { src: f.url, alt: '', loading: 'lazy', decoding: 'async', onerror: (e) => { e.target.replaceWith(el('span', { class: 'pj-ico', html: icon('image') })); } }));
    } else if (f.item?.thumb_url) {
      vis.append(el('img', { src: href(f.item.thumb_url), alt: '', loading: 'lazy', decoding: 'async' }));
    } else {
      vis.append(el('span', { class: 'pj-ico', html: icon(f.kind) }), el('b', { class: 'pj-ext' }, extOf(f.name) || SORTE_FR[f.kind]));
    }
    const brief = f.kind === 'document' ? el('label', { class: 'pj-brief', title: 'ce document est le brief (son texte va dans la note du brief et à l’agent)' },
      el('input', { type: 'checkbox', onchange: (e) => { setBrief(f, e.target.checked); } }), el('span', {}, 'c’est le brief')) : null;
    const x = el('button', { class: 'pj-x', type: 'button', 'aria-label': `retirer ${f.name}`, title: 'retirer', onclick: () => retirer(f) }, '×');
    const n = el('div', { class: `pj-tile k-${f.kind}`, role: 'listitem', 'data-id': f.id, title: f.path || f.name },
      vis, el('div', { class: 'pj-meta' }, el('b', { class: 'pj-nm' }, f.name),
        el('span', { class: 'pj-k' }, [f.item ? 'Asset' : SORTE_FR[f.kind], f.size ? fmtMo(f.size) : '', f.folder ? `dossier ${f.folder}` : ''].filter(Boolean).join(' · '))),
      brief, el('div', { class: 'pj-bar' }, el('i')), el('p', { class: 'pj-err', hidden: true }), x);
    f.node = n;
    return n;
  }
  function paintTile(f) {
    const n = f.node;
    if (!n) return;
    n.dataset.state = f.state;
    n.querySelector('.pj-bar i').style.width = `${Math.round((f.state === 'ok' ? 1 : f.progress || 0) * 100)}%`;
    const e = n.querySelector('.pj-err');
    e.hidden = f.state !== 'echec';
    e.textContent = f.state === 'echec' ? f.error : '';
    const x = n.querySelector('.pj-x');
    x.hidden = P.running || P.done || f.state === 'ok';
  }
  // rangé : la sorte du portail fait foi (core/library.py lit le contenu — un .webm sans image est un son ;
  // l'extension et le type MIME du navigateur ne servaient qu'à la vignette d'avant l'envoi)
  function sorteRangee(f) {
    const k = f.result?.kind === 'element' ? 'element' : SORTE_FR[f.result?.kind] ? f.result.kind : null;
    if (!k || k === f.kind) return;
    const n = f.node;
    if (n) {
      n.classList.replace(`k-${f.kind}`, `k-${k}`);
      const ico = n.querySelector('.pj-vis .pj-ico');
      if (ico) ico.innerHTML = icon(k);
      const lab = n.querySelector('.pj-k');
      if (lab) lab.textContent = [SORTE_FR[k], f.size ? fmtMo(f.size) : '', f.folder ? `dossier ${f.folder}` : ''].filter(Boolean).join(' · ');
    }
    f.kind = k;
  }
  // la progression : repeinte une fois par image d'écran, quel que soit le nombre d'envois
  const dirty = new Set();
  let rafBar = 0;
  function barSoon(f) {
    dirty.add(f);
    if (!rafBar) rafBar = requestAnimationFrame(() => { rafBar = 0; for (const g of dirty) paintTile(g); dirty.clear(); paintCount(); });
  }

  // les fichiers arrivent par paquets : les vignettes se posent par paquets d'une image d'écran
  let rafAdd = 0;
  function ajouter(list) {
    let doubles = 0;
    for (const f of list) {
      const key = f.item ? `asset:${f.item.id}` : `${f.path || f.name}|${f.file.size}|${f.file.lastModified}`;
      if (P.seen.has(key)) { doubles++; continue; }
      P.seen.add(key);
      f.key = key;
      f.id = `f${++seq}`;
      f.state = 'pret';
      f.progress = 0;
      P.files.push(f);
      P.pending.push(f);
    }
    if (doubles) toast(`${doubles} fichier${doubles > 1 ? 's' : ''} déjà là : ignoré${doubles > 1 ? 's' : ''}`);
    if (!rafAdd) rafAdd = requestAnimationFrame(poser);
  }
  function poser() {
    rafAdd = 0;
    const lot = P.pending.splice(0, 80);
    if (lot.length) tiles.append(...lot.map(tileOf));
    for (const f of lot) paintTile(f);
    if (P.pending.length) rafAdd = requestAnimationFrame(poser);
    autoBrief();
    paintCount();
    paintGo();
  }
  function retirer(f) {
    if (P.running) return;
    P.files = P.files.filter((g) => g !== f);
    P.pending = P.pending.filter((g) => g !== f);
    P.seen.delete(f.key);
    if (f.url) URL.revokeObjectURL(f.url);
    f.node?.remove();
    autoBrief();
    paintCount();
    paintGo();
  }
  // le nom en NFC : un nom venu décomposé (NFD, celui d'un disque HFS+ de Mac) s'écrit comme le même nom
  // tapé au clavier — dans la vignette, dans le titre rangé dans Asset, dans une recherche
  const fromFile = (file, path = '', folder = '') => ({ file, name: file.name.normalize('NFC'), size: file.size, kind: guessKind(file),
    path: path.normalize('NFC'), folder: folder.normalize('NFC') });
  const fromItem = (it) => ({ item: it, name: it.title || it.id, size: 0, kind: it.kind === 'element' ? 'element' : (SORTE_FR[it.kind] ? it.kind : 'autre') });
  function ajouterFichiers(files, folder = '') {
    ajouter([...files].filter((f) => !BRUIT.test(f.name)).map((f) => fromFile(f, f.webkitRelativePath || '', folder || dossierDe(f.webkitRelativePath))));
  }
  const dossierDe = (p) => (p && p.includes('/') ? p.split('/')[0].replace(/\s+/g, ' ').slice(0, 60) : '');
  function paintCount() {
    const n = P.files.length;
    if (!n) { count.textContent = P.reading ? `lecture… ${P.reading}` : ''; return; }
    const by = {};
    for (const f of P.files) by[f.kind] = (by[f.kind] || 0) + 1;
    const size = P.files.reduce((t, f) => t + (f.size || 0), 0);
    const ok = P.files.filter((f) => f.state === 'ok').length, ko = P.files.filter((f) => f.state === 'echec').length;
    const parts = Object.entries(by).map(([k, v]) => `${v} ${SORTE_FR[k]}${v > 1 ? 's' : ''}`);
    count.textContent = [parts.join(' · '), size ? fmtMo(size) : '', P.running || P.done ? `${ok} / ${n} rangés${ko ? ` · ${ko} en échec` : ''}` : '',
      P.reading ? `lecture… ${P.reading}` : ''].filter(Boolean).join(' · ');
  }

  // ── le brief : tapé, et/ou un document ────────────────────
  function setBrief(f, on) {
    for (const g of P.files) if (g !== f && g.brief === true && on) { g.brief = null; }
    f.brief = on ? true : false;   // false : l'utilisateur l'a décoché, la détection le laisse
    autoBrief();
  }
  // le document du brief : coché ; sinon détecté (le seul document, le champ vide)
  function briefDoc() {
    const docs = P.files.filter((f) => f.kind === 'document' && f.state !== 'echec');
    const mine = docs.find((f) => f.brief === true);
    if (mine) return { f: mine, auto: false };
    if (!txt.value.trim() && docs.length === 1 && docs[0].brief !== false) return { f: docs[0], auto: true };
    return null;
  }
  function autoBrief() {
    const b = briefDoc();
    for (const f of P.files) {
      if (!f.node || f.kind !== 'document') continue;
      const on = b?.f === f;
      f.node.classList.toggle('is-brief', on);
      const c = f.node.querySelector('.pj-brief input');
      if (c) { c.checked = on; c.disabled = P.running; }
      const s = f.node.querySelector('.pj-brief span');
      if (s) s.textContent = on && b.auto ? 'brief · détecté' : 'c’est le brief';
    }
    paintName();
  }

  // ── les noms ──────────────────────────────────────────────
  function nomParDefaut() {
    const line = txt.value.split('\n').map(nom40).find(Boolean);
    if (line) return line;
    const b = briefDoc();
    if (b) return nom40(b.f.name.replace(/\.[^.]+$/, ''));
    return `Projet du ${jour()}`;
  }
  function paintName() { nameIn.placeholder = nomParDefaut(); }
  nameIn.addEventListener('input', () => { P.nameTouched = true; });
  const grow = () => { txt.style.height = 'auto'; txt.style.height = `${Math.min(txt.scrollHeight + 2, Math.round(innerHeight * 0.34))}px`; };
  txt.addEventListener('input', () => { grow(); autoBrief(); paintGo(); });
  // Ctrl+Entrée (⌘+Entrée) : commencer, comme on envoie un message
  txt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commencer(); } });

  // ── avec qui ──────────────────────────────────────────────
  function paintWho() {
    const q = whoFind.value.trim().toLowerCase();
    whoFind.hidden = P.people.length <= 12;
    const list = P.people.filter((p) => !q || `${p.name} ${p.pseudo}`.toLowerCase().includes(q) || P.chosen.has(p.id));
    who.replaceChildren(...list.map((p) => el('button', { class: 'pj-person' + (P.chosen.has(p.id) ? ' on' : ''), type: 'button',
      'aria-pressed': P.chosen.has(p.id) ? 'true' : 'false', disabled: P.running || null,
      title: p.teams.length ? `dans ${p.teams.join(', ')}` : p.pseudo,
      onclick: () => { if (P.chosen.has(p.id)) P.chosen.delete(p.id); else P.chosen.add(p.id); paintWho(); } },
    el('i', { 'aria-hidden': 'true' }, (p.name || '?').slice(0, 1).toUpperCase()), el('span', {}, p.name))));
    if (!P.people.length && !P.peopleErr) who.append(el('span', { class: 'pj-note' }, 'personne à proposer'));
    whoWhy.textContent = P.peopleErr || [P.chosen.size ? `${P.chosen.size} membre${P.chosen.size > 1 ? 's' : ''} de la Team, en plus de toi` : '', P.peopleWhy].filter(Boolean).join(' · ');
  }
  whoFind.addEventListener('input', paintWho);

  // ── qui crée une Team : dit avant de remplir ──────────────
  function paintRights() {
    const no = P.canCreate === false;
    refus.hidden = !no;
    form.hidden = no;
    lede.hidden = no;
    if (!no) return;
    const ask = el('button', { class: 'tb ghost sm', type: 'button', onclick: async () => {
      ask.disabled = true;
      try {
        const r = await api('auth/studio', { method: 'POST', body: {} });
        if (r.ok) { location.reload(); return; }
        P.asked = r.asked || new Date().toISOString();
        paintRights();
      } catch (e) { ask.disabled = false; toast(e.message, 6000); }
    } }, 'Demander le Studio');
    const studio = /Studio/.test(P.createWhy);
    refus.replaceChildren(
      el('b', {}, 'Ce compte ne crée pas de Team'),
      el('p', {}, P.createWhy),
      el('p', {}, 'Commencer un projet crée une Team et son Workspace, où tout se range. Tu peux travailler sur une planche du Workspace où tu es (Fermer).'),
      studio ? el('div', { class: 'row' }, P.asked ? el('span', { class: 'pj-note' }, `Studio demandé le ${new Date(P.asked).toLocaleDateString('fr-FR')} : Cal l’ouvre depuis Admin`) : ask) : null);
  }

  // ── l'action ──────────────────────────────────────────────
  function paintGo() {
    let w = '';
    if (P.running) w = 'en cours…';
    else if (P.canCreate === null) w = 'je vérifie tes droits…';
    else if (P.canCreate === false) w = 'créer une Team : pas avec ce compte';
    else if (!P.files.length && !txt.value.trim()) w = 'dépose au moins un fichier, ou écris le brief';
    go.disabled = !!w || P.done;
    go.hidden = P.done;
    why.textContent = P.done ? '' : w;
    go.title = w || 'créer la Team et son Workspace, tout ranger, organiser la planche';
    shut.title = P.running ? 'en cours : la fenêtre se ferme quand tout est rangé' : 'fermer · Échap';
    shut.disabled = P.running;
  }

  // ── les dépôts : sur toute la fenêtre ─────────────────────
  let depth = 0;
  const wants = (e) => { const t = e.dataTransfer?.types || []; return t.includes('Files') || t.includes(ITEM_MIME); };
  scrim.addEventListener('dragenter', (e) => { if (!wants(e) || P.running || P.canCreate === false) return; depth++; scrim.classList.add('drag'); });
  scrim.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; scrim.classList.remove('drag'); } });
  scrim.addEventListener('dragover', (e) => { if (!wants(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = P.running ? 'none' : 'copy'; });
  scrim.addEventListener('drop', (e) => {
    if (!wants(e)) return;
    e.preventDefault(); e.stopPropagation();
    depth = 0; scrim.classList.remove('drag');
    if (P.running || P.canCreate === false) return;
    const dt = e.dataTransfer;
    // d'Asset : des objets de la bibliothèque (rapatriés dans le Workspace neuf au départ)
    const raw = dt.getData(ITEM_MIME);
    let many = [];
    try { many = JSON.parse(dt.getData(MULTI_MIME) || '[]'); } catch { many = []; }
    const ids = many.length ? many.map(String) : raw ? [JSON.parse(raw).id] : [];
    if (ids.length) { depuisAsset(ids); return; }
    // du disque : PENDANT l'événement, les entrées (un dossier) et les fichiers — après, plus rien
    const got = [];
    for (const it of [...(dt.items || [])]) {
      if (it.kind !== 'file') continue;
      const entry = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
      got.push(entry ? { entry } : { file: it.getAsFile() });
    }
    if (!got.length) for (const f of [...(dt.files || [])]) got.push({ file: f });
    lireDepot(got);
  });
  async function depuisAsset(ids) {
    try {
      const r = await api('library/batch', { method: 'POST', body: { ids, spaces: '*' } });
      ajouter((r.items || []).map(fromItem));
    } catch (err) { toast(err.message, 6000); }
  }
  // un dossier : tout son contenu, sous-dossiers compris ; ses fichiers, dans un dossier d'Asset à son nom
  async function lireDepot(got) {
    const loose = got.filter((g) => g.file || g.entry?.isFile);
    for (const g of loose) {
      if (g.file) { if (!BRUIT.test(g.file.name)) ajouter([fromFile(g.file)]); continue; }
      try { const f = await fileOf(g.entry); if (!BRUIT.test(f.name)) ajouter([fromFile(f)]); } catch (err) { toast(`${g.entry.name} : ${err.message}`); }
    }
    for (const g of got.filter((x) => x.entry?.isDirectory)) await lireDossier(g.entry, g.entry.name.slice(0, 60));
  }
  const fileOf = (entry) => new Promise((ok, ko) => entry.file(ok, ko));
  const lire = (reader) => new Promise((ok, ko) => reader.readEntries(ok, ko));
  async function lireDossier(dir, folder) {
    const reader = dir.createReader();
    // readEntries rend des paquets (100 dans Chromium) : on le rappelle jusqu'au vide
    for (;;) {
      let batch;
      try { batch = await lire(reader); } catch (err) { toast(`${dir.name} : ${err.message}`); return; }
      if (!batch.length) return;
      const out = [];
      for (const en of batch) {
        if (BRUIT.test(en.name)) continue;
        if (en.isDirectory) { await lireDossier(en, folder); continue; }
        P.reading++;
        try { out.push(fromFile(await fileOf(en), en.fullPath.replace(/^\//, ''), folder)); } catch { /* illisible : sauté */ }
      }
      P.reading = Math.max(0, P.reading - out.length);
      ajouter(out);
      paintCount();
    }
  }
  pickF.addEventListener('change', () => { ajouterFichiers(pickF.files); pickF.value = ''; });
  pickD.addEventListener('change', () => { ajouterFichiers(pickD.files); pickD.value = ''; });
  // coller : des fichiers, des images (dans le champ aussi) ; un texte se colle normalement
  const onPaste = (e) => {
    if (P.running || P.canCreate === false) return;
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    ajouter(files.map((f, i) => fromFile(f.name && f.name !== 'image.png' ? f
      : new File([f], `collé-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}-${i + 1}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type }))));
  };
  document.addEventListener('paste', onPaste, true);

  // le panneau Asset, pendant la fenêtre : un clic ajoute au projet (sa configuration d'Idéation revient après).
  // Un objet d'un autre Workspace arrive tel quel (rapatrie: false) : sa copie se fera au départ, dans le
  // Workspace neuf — pas dans celui d'avant, où elle resterait en double
  const dockAvant = { ...dockState().cfg };
  const dockMien = { place: (items) => { ajouter(items.map(fromItem)); return true; }, placeLabel: 'Ajouter au projet',
    label: 'le projet', clickPlaces: true, hint: 'clic ou glisser sur la fenêtre : au projet', rapatrie: false,
    // tout ce qui se copie d'un Workspace à l'autre (server/core/library.py, IMPORT_KINDS) : les documents aussi
    kinds: ['image', 'video', 'audio', 'document', 'element', 'midi'] };
  dock.configure(dockMien);

  // ── fermer ────────────────────────────────────────────────
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation(); e.preventDefault();
    fermer();
  };
  document.addEventListener('keydown', onKey, true);
  const onUnload = (e) => { if (P.running) { e.preventDefault(); e.returnValue = ''; } };
  addEventListener('beforeunload', onUnload);
  function fermer(apres = false) {
    if (P.running) return;
    // des fichiers déposés, un brief écrit : un second geste confirme (rien ne s'efface sur une fausse touche)
    if (!apres && !P.done && (P.files.length || txt.value.trim()) && !armed) {
      armed = true;
      shut.textContent = 'Fermer ? tout s’oublie';
      setTimeout(() => { armed = false; shut.textContent = 'Fermer'; }, 3500);
      return;
    }
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('paste', onPaste, true);
    removeEventListener('beforeunload', onUnload);
    // configure fusionne : ce que la fenêtre avait ajouté s'efface, la configuration d'Idéation revient
    dock.configure({ ...Object.fromEntries(Object.keys(dockMien).map((k) => [k, undefined])), ...dockAvant });
    for (const f of P.files) if (f.url) URL.revokeObjectURL(f.url);
    scrim.remove();
    document.documentElement.classList.remove('pj-open');
    ouverte = null;
    const u = new URL(location.href);
    if (u.searchParams.has('projet')) { u.searchParams.delete('projet'); history.replaceState(history.state, '', u.href); }
    if (!P.R.board) annule();
  }

  // ── Commencer ─────────────────────────────────────────────
  // une ligne de la liste des étapes : en cours, faite, en échec, ou une simple note
  function step(key, label) {
    let li = steps.querySelector(`[data-k="${key}"]`);
    if (!li) { li = el('li', { 'data-k': key }, el('i'), el('span', { class: 'pj-sl' }), el('small')); steps.append(li); }
    const set = (cls) => (d = '') => { li.className = cls; li.querySelector('.pj-sl').textContent = label; li.querySelector('small').textContent = d; };
    return { work: set('work'), ok: set('ok'), err: set('err'), note: set('') };
  }
  // pendant le départ (et après : tout est rangé), rien ne s'ajoute ni ne se retire
  function verrou(on) {
    P.running = on;
    const lock = on || P.done;
    modal.classList.toggle('busy', on);
    for (const n of [txt, nameIn, wsIn, whoFind]) n.disabled = lock;
    for (const b of box.querySelectorAll('.pj-tools button')) b.disabled = lock;
    for (const f of P.files) paintTile(f);
    autoBrief();
    paintWho();
    paintGo();
  }

  async function commencer() {
    if (P.running || P.done || go.disabled) return;
    const R = P.R;
    const projet = nom40(nameIn.value) || nomParDefaut();
    const wsName = nom40(wsIn.value) || 'Général';
    if (!P.nameTouched || !nom40(nameIn.value)) nameIn.value = projet;
    steps.hidden = false;
    verrou(true);
    try {
      // 1. la Team — elle naît avec son Workspace « Général » (core/espaces.py, create_team)
      const sT = step('team', `Team « ${projet} »`);
      if (!R.team) {
        sT.work('création');
        R.team = await api('equipes', { method: 'POST', body: { name: projet } }).catch((e) => { sT.err(e.message); throw e; });
        R.space = R.team.spaces?.[0] || null;
        if (!R.space) { sT.err('la Team est née sans Workspace'); throw new Error('la Team est née sans Workspace'); }
      }
      sT.ok('créée · tu en es le propriétaire');
      // 2. son Workspace, renommé s'il le faut
      const sW = step('ws', `Workspace « ${wsName} »`);
      if (R.space.name !== wsName) {
        sW.work('nommé');
        const sp = await api(`espaces/${R.space.id}`, { method: 'POST', body: { name: wsName } }).catch((e) => { sW.err(e.message); throw e; });
        R.space.name = sp.name;
      }
      sW.ok('');
      // 3. les personnes (des comptes qui existent) : membres ; un refus est dit, le reste continue
      const want = P.people.filter((p) => P.chosen.has(p.id) && !R.members.has(p.id));
      if (want.length || R.members.size) {
        const sP = step('people', 'Avec qui');
        R.memberErr = [];
        for (const p of want) {
          sP.work(p.name);
          try { await api(`equipes/${R.team.id}/membres`, { method: 'POST', body: { pseudo: p.pseudo, role: 'member' } }); R.members.add(p.id); } catch (e) { R.memberErr.push(`${p.name} : ${e.message}`); }
        }
        const okNames = P.people.filter((p) => R.members.has(p.id)).map((p) => p.name);
        if (R.memberErr.length) sP.err([okNames.length ? `${okNames.join(', ')} : membres` : '', ...R.memberErr].filter(Boolean).join(' · '));
        else sP.ok(`${okNames.join(', ')} : membre${okNames.length > 1 ? 's' : ''} de la Team`);
      }
      // 4. l'onglet passe dans ce Workspace, sans recharger la page (les fichiers sont en mémoire)
      const sO = step('onglet', 'L’onglet dans ce Workspace');
      sO.work('');
      await app.flushSave?.();   // la planche ouverte avant (la fenêtre ouverte par le menu) s'enregistre dans son Workspace
      await entrerEspace(R.space.id).catch((e) => { sO.err(e.message); throw e; });
      sO.ok(`${projet} / ${R.space.name}`);
      // 5. la planche, dans ce Workspace, ouverte
      const sB = step('board', 'La planche');
      if (!R.board) {
        sB.work('création');
        R.board = await api('ideation/boards', { method: 'POST', body: { name: projet }, espace: R.space.id }).catch((e) => { sB.err(e.message); throw e; });
      }
      if (app.S.board?.id !== R.board.id && !(await app.openBoard(R.board.id))) { sB.err('elle ne s’ouvre pas'); throw new Error('la planche ne s’ouvre pas'); }
      sB.ok(R.board.name);
      // 6. les fichiers : trois à la fois ; ce qui vient d'Asset, rapatrié
      await ranger(R.space.id);
      // 7. le brief
      const brief = await leBrief(R.space.id);
      // 8. la mise en page de départ
      const sL = step('layout', 'La planche rangée');
      const lay = miseEnPage(app, P, brief, projet);
      sL.ok(lay.note);
      dock.reload();
      // 9. l'agent
      await agent(brief, projet);
      P.done = true;
      verrou(false);
      const ko = P.files.filter((f) => f.state === 'echec').length;
      paintCount();
      if (!ko && !R.memberErr.length && !lay.left && !R.agentErr) {
        toast(`« ${projet} » : ${P.files.length} fichier${P.files.length > 1 ? 's' : ''} rangé${P.files.length > 1 ? 's' : ''}, la planche organisée`, 6000);
        setTimeout(() => fermer(true), 900);
      } else {
        // un échec garde la fenêtre ouverte sur la liste, raison par raison
        why.textContent = '';
        modal.querySelector('.modal-foot').replaceChildren(
          el('span', { class: 'pj-why' }, ko ? `${ko} fichier${ko > 1 ? 's' : ''} non rangé${ko > 1 ? 's' : ''} : la raison est sur chaque vignette` : 'quelque chose n’est pas passé : voir la liste'),
          el('span', { class: 'sp' }), el('button', { class: 'tb go', type: 'button', onclick: () => fermer(true) }, 'Voir la planche'));
        for (const f of P.files) if (f.state === 'ok') f.node?.classList.add('pj-dim');
      }
    } catch (e) {
      // un geste qui casse : ce qui est fait reste fait (la Team, la planche) ; « Commencer » reprend où il en était
      verrou(false);
      why.textContent = e.message;
      go.textContent = 'Reprendre';
      toast(e.message, 8000);
    }
  }

  // les fichiers, trois à la fois ; un refus n'arrête pas les autres (le fichier reste listé, en échec)
  async function ranger(sid) {
    const todo = P.files.filter((f) => f.state !== 'ok');
    const sF = step('files', 'Les fichiers');
    if (!P.files.length) { sF.note('aucun'); return; }
    const paint = () => {
      const ok = P.files.filter((f) => f.state === 'ok').length, ko = P.files.filter((f) => f.state === 'echec').length;
      (ko ? sF.err : ok === P.files.length ? sF.ok : sF.work)(`${ok} / ${P.files.length} rangés${ko ? ` · ${ko} en échec` : ''}`);
    };
    paint();
    let i = 0;
    const run = async () => {
      while (i < todo.length) {
        const f = todo[i++];
        f.state = 'envoi'; f.progress = 0; f.error = '';
        barSoon(f);
        try {
          if (f.item) {
            // d'Asset : une copie dans le Workspace neuf (jamais un lien vivant : equipes_espaces.md § 3.2)
            const r = f.item.space === sid ? { items: [f.item] } : await api(`espaces/${sid}/rapatrier`, { method: 'POST', body: { items: [f.item.id] } });
            f.result = r.items?.[0];
            if (!f.result) throw new Error('le portail n’a rien rendu');
          } else {
            f.result = await uploadFile(f.file, { tool: 'upload', via: 'projet', folder: (f.folder || '').replace(/\//g, ' · '), espace: sid,
              title: f.name.replace(/\.[^.]+$/, ''),
              onprogress: (p) => { f.progress = p; barSoon(f); } });
          }
          f.state = 'ok';
          sorteRangee(f);
        } catch (e) {
          f.state = 'echec';
          f.error = e.message;   // la phrase du portail (un contenu qui n'est pas ce que dit son nom, trop gros…)
        }
        barSoon(f);
        paint();
      }
    };
    await Promise.all(Array.from({ length: Math.min(EN_MEME_TEMPS, todo.length) }, run));
    paint();
  }

  // le brief : le texte tapé, le texte du document brief (lu dans la page, ou par le portail), rangé
  // aussi en brief.md quand il a été tapé
  async function leBrief(sid) {
    const typed = txt.value.trim();
    const b = briefDoc();
    const out = { typed, docText: '', doc: b?.f || null, docItem: b?.f?.result || null, md: null, docWhy: '' };
    if (b) {
      const f = b.f;
      if (f.file && TEXTE_LOCAL.has(extOf(f.name)) && f.file.size < 2e6) {
        try { out.docText = (await f.file.text()).trim(); } catch { /* illisible : le portail peut-être */ }
      }
      // un PDF, un DOCX… : le texte que le portail en a tiré au rangement (server/tools/documents.py)
      if (!out.docText && f.result?.kind === 'document') {
        try {
          const d = await api(`library/${f.result.id}/texte`, { espace: sid });
          out.docText = String(d?.text || '').trim();
          if (!out.docText) out.docWhy = d?.why || 'pas de texte lisible (un scan ?) : il est dans Asset';
        } catch (e) { out.docWhy = `son texte ne se lit pas : ${e.message}`; }
      }
      if (!out.docText && !out.docWhy) out.docWhy = f.result ? 'son texte n’est pas lu : il est dans Asset' : 'pas rangé : son texte n’est pas lu';
    }
    if (typed) {
      const sM = step('brief', 'Le brief · brief.md');
      if (!P.R.briefMd) {
        sM.work('rangé dans Asset');
        try {
          P.R.briefMd = await uploadFile(new File([`# ${nameIn.value || 'Brief'}\n\n${typed}\n`], 'brief.md', { type: 'text/markdown' }),
            { tool: 'upload', via: 'projet', title: 'Brief', espace: sid });
          P.R.briefMdErr = '';
        } catch (e) { P.R.briefMdErr = e.message; }
      }
      if (P.R.briefMd) sM.ok('rangé dans Asset'); else sM.err(`pas rangé : ${P.R.briefMdErr}`);
      out.md = P.R.briefMd;
    }
    return out;
  }

  // l'analyse de l'agent d'Idéation (ideation/agent.js : app.agent = { open(), send(texte, { pieces, intent }),
  // busy() }) ; il se charge avec les modules de la planche : on lui laisse quelques secondes. Absent : rien,
  // ni ligne ni erreur — la planche reste rangée par la mise en page de départ.
  async function agent(brief, projet) {
    if (P.R.agent) return;   // « Reprendre » ne relance pas une analyse partie
    let ag = app.agent;
    for (let t = 0; typeof ag?.send !== 'function' && t < 30; t++) { await new Promise((r) => setTimeout(r, 100)); ag = app.agent; }
    if (typeof ag?.send !== 'function') return;
    // les pièces : des objets de la bibliothèque (les documents y sont en sorte `document`), le brief en tête
    const briefIds = new Set([brief.docItem?.id, brief.md?.id].filter(Boolean));
    const rang = (it) => { if (briefIds.has(it.id)) return -1; const i = ORDRE_PIECES.indexOf(it.kind); return i < 0 ? ORDRE_PIECES.length : i; };
    const toutes = [...new Map([brief.docItem, brief.md, ...P.files.filter((f) => f.state === 'ok').map((f) => f.result)]
      .filter((it) => it?.id).map((it) => [it.id, it])).values()];
    const pieces = toutes.sort((a, b) => rang(a) - rang(b)).slice(0, AGENT_PIECES).map((it) => it.id);
    let text = [brief.typed, brief.docText].filter(Boolean).join('\n\n')
      || `Projet « ${projet} » : pas de brief écrit — lis les fichiers et organise la planche.`;
    const suite = `…\n\n(la suite : « ${(brief.md ? 'brief.md' : brief.doc?.name || 'le brief').slice(0, 80)} », dans les pièces)`;
    if (text.length > AGENT_TEXTE) text = text.slice(0, AGENT_TEXTE - suite.length).trimEnd() + suite;
    // l'agent lit la planche au portail : la mise en page de départ doit y être enregistrée
    await app.flushSave?.();
    const sA = step('agent', 'L’analyse de l’agent');
    try {
      ag.open?.();
      // `items` : le nom du contrat de l'étude (agent_showrunner.md § 5), `pieces` celui de la page de l'agent
      const p = ag.send(text, { pieces, items: pieces, intent: 'ingest' });
      P.R.agent = true;
      sA.ok(`lancée · ${pieces.length} pièce${pieces.length > 1 ? 's' : ''}${toutes.length > pieces.length
        ? ` sur ${toutes.length} : le brief et les documents d’abord, le reste est sur la planche` : ''}`);
      Promise.resolve(p).catch((e) => toast(`l’agent : ${e.message}`, 8000));
    } catch (e) { P.R.agentErr = e.message; sA.err(e.message); }
  }

  // ── au départ : les droits, les personnes ─────────────────
  (async () => {
    paintGo();
    const [eq, me, pp] = await Promise.all([
      api('equipes').catch((e) => ({ error: e.message })),
      session().catch(() => null),
      api('equipes/personnes').catch((e) => ({ error: e.message })),
    ]);
    if (eq.error) { P.canCreate = false; P.createWhy = `les Teams ne répondent pas : ${eq.error}`; }
    else { P.canCreate = eq.can_create !== false; P.createWhy = eq.create_why || ''; }
    P.asked = me?.user?.studio_asked || null;
    if (pp.error) P.peopleErr = `la liste des personnes : ${pp.error}`;
    else { P.people = pp.people || []; P.peopleWhy = pp.why || ''; }
    paintRights();
    paintWho();
    paintName();
    paintGo();
    if (P.canCreate) txt.focus();
  })();
  paintName();
  paintWho();
  grow();

  ouverte = { P, fermer, ajouter: (files) => ajouterFichiers(files) };
  // pour les essais (Playwright) : l'état de la fenêtre, en lecture
  if (window.ideation) window.ideation.projet = ouverte;
  return ouverte;
}

// ── la mise en page de départ ────────────────────────────────
// Des cadres côte à côte, dans l'ordre de CADRES, ceux qui ont quelque chose ; dans chacun, une grille
// régulière (colonnes à la largeur du plus large, rangées à la hauteur de la plus haute) ; le brief en
// note en tête de son cadre ; le nom du projet en titre au-dessus. Un seul app.mutate : un seul pas
// d'annulation. Au-delà de la limite des planches, le reste est dans Asset, pas posé (on le dit).
export function miseEnPage(app, P, brief, projet) {
  const { S } = app;
  const kinds = S.meta?.media_kinds || ['image', 'video', 'audio', 'element'];
  const cap = Math.max(0, (S.meta?.limits?.nodes || 3000) - (S.board?.nodes.length || 0) - 16);
  const groups = new Map(CADRES.map((c) => [c, []]));
  const briefIds = new Set([brief.docItem?.id, brief.md?.id].filter(Boolean));
  const items = P.files.filter((f) => f.state === 'ok' && f.result).map((f) => f.result);
  if (brief.md) items.push(brief.md);
  let left = 0;
  for (const it of items) {
    if (!it) continue;
    const c = briefIds.has(it.id) ? 'Brief' : CADRE_DE[it.kind === 'element' ? (it.element?.head_kind || 'element') : it.kind] || 'Autres';
    groups.get(c).push(it);
  }
  const PAD = 36, GAP = 24, FGAP = 150;
  const nodes = [];
  let x = 0, placed = 0;
  const top = 0;
  // la taille d'un objet posé ; une sorte que la planche ne pose pas (un document, si le portail ne
  // le connaît pas encore ; un MIDI) devient une note qui le nomme : il est dans Asset
  const sizeOf = (it) => {
    if (!kinds.includes(it.kind)) return [240, 92];
    if (it.kind === 'document' && !(it.width && it.height)) return [190, 250];
    return app.sizeFor(it, it.kind === 'video' ? 300 : 240);
  };
  const nodeOf = (it, nx, ny, w, h) => {
    if (kinds.includes(it.kind)) { S.items.set(it.id, it); return app.newMedia(it, nx, ny, w, h); }
    return { id: app.uid('n'), type: 'note', x: Math.round(nx), y: Math.round(ny), w, h,
      text: `« ${it.title || it.id} » — ${kindFr(it.kind)}${it.doc?.label ? ` ${it.doc.label}` : ''} : dans Asset` };
  };
  // le brief : une note, la première chose qu'on lit
  const briefText = [brief.typed, brief.docText].filter(Boolean).join('\n\n');
  const noteText = briefText
    ? (briefText.length > 3000 ? `${briefText.slice(0, 3000).trim()}…\n\n(la suite : ${brief.md ? 'brief.md' : brief.doc?.name || 'le document'}, dans Asset)` : briefText)
    : brief.doc ? `Le brief : « ${brief.doc.name} »${brief.docWhy ? ` — ${brief.docWhy}` : ''}.` : '';
  for (const c of CADRES) {
    const list = groups.get(c);
    const hasNote = c === 'Brief' && !!noteText;
    if (!list.length && !hasNote) continue;
    const room = Math.max(0, cap - placed - 1 - (hasNote ? 1 : 0));
    const keep = list.slice(0, room);
    left += list.length - keep.length;
    const sizes = keep.map(sizeOf);
    const cols = Math.max(1, Math.min(keep.length || 1, c === 'Brief' ? 2 : 10, Math.round(Math.sqrt((keep.length || 1) * 1.6))));
    const cellW = Math.max(0, ...sizes.map((s) => s[0]));
    let y = top + PAD;
    const inner = [];
    let noteW = 0;
    if (hasNote) {
      noteW = Math.max(460, cols * cellW + (cols - 1) * GAP);
      const lines = noteText.split('\n').reduce((t, l) => t + Math.max(1, Math.ceil(l.length / Math.max(30, Math.round(noteW / 7.4)))), 0);
      const h = Math.min(1400, Math.max(96, Math.round(32 + lines * 19.5)));
      inner.push({ id: app.uid('n'), type: 'note', x: x + PAD, y, w: noteW, h, text: noteText });
      y += h + GAP;
    }
    for (let i = 0; i < keep.length; i += cols) {
      const row = keep.slice(i, i + cols);
      const rh = Math.max(...row.map((_, k) => sizes[i + k][1]));
      row.forEach((it, k) => {
        const [w, h] = sizes[i + k];
        inner.push(nodeOf(it, x + PAD + k * (cellW + GAP) + (cellW - w) / 2, y, w, h));
      });
      y += rh + GAP;
    }
    const fw = Math.max(noteW, cols * cellW + (cols - 1) * GAP, 260) + 2 * PAD;
    const fh = Math.max(y - GAP + PAD - top, 160);
    nodes.push({ id: app.uid('n'), type: 'frame', x, y: top, w: Math.round(fw), h: Math.round(fh), name: c }, ...inner);
    placed += inner.length + 1;
    x += Math.round(fw) + FGAP;
  }
  if (nodes.length) {
    const title = { id: app.uid('n'), type: 'title', x: 0, y: top - 150, w: Math.min(1800, Math.max(420, 60 + projet.length * 36)), h: 72, text: projet, size: 'l' };
    app.mutate((B) => { B.nodes.push(title, ...nodes); S.sel.clear(); S.link = null; });
    requestAnimationFrame(() => app.canvas.fit());
  }
  const n = nodes.filter((nd) => nd.type !== 'frame').length;
  const frames = nodes.filter((nd) => nd.type === 'frame').map((nd) => nd.name);
  return { left, note: `${frames.join(' · ') || 'rien à poser'}${n ? ` · ${n} objet${n > 1 ? 's' : ''}` : ''}${left ? ` · ${left} dans Asset seulement (la planche est pleine)` : ''}` };
}
