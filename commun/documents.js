// SHOWRUNNER TOOLS — les documents de la bibliothèque, côté page (05/10/2026).
//
// Une septième sorte d'objet, `document` (server/tools/documents.py) : tout ce
// qui n'est ni une image, ni une vidéo, ni un son, ni un clip MIDI — un PDF, un
// DOCX, un texte, un tableur, un fichier inconnu. Le serveur en tire le texte et
// une couverture ; ce module fait le reste, dans la page :
//
//   extraireDocument(it, { file })   un PDF que le serveur n'a pas su lire (poppler
//                                    absent : `doc.needs_page`) est lu ICI, par pdf.js,
//                                    et son texte et sa couverture lui sont déposés
//                                    (POST /api/library/<id>/texte) ; rend l'objet neuf.
//                                    uploadFile (commun/shell.js) l'appelle seul après
//                                    un tel dépôt : une page qui dépose n'a rien à faire
//   lirePdf(source)                  le texte page par page, la couverture : { pages, count, title, thumb }
//   liseuse(it, { page })            LA liseuse : les pages en vignettes, le texte page par
//                                    page, et pour un PDF ses pages telles qu'elles sont
//                                    (Asset, la fiche ; Idéation, au double-clic d'un document)
//
// pdf.js (Mozilla, Apache 2.0), version épinglée, chargé à la première lecture d'un
// PDF seulement, depuis cdnjs comme three.js vient de son CDN (objet/, character/) :
// rien à construire ni à copier dans le dépôt. cdnjs prend de pdfjs-dist les dossiers
// `build/` et `web/` seulement (cdnjs/packages, packages/p/pdf.js.json, « fileMap ») :
// les tables de caractères (`cmaps/`, un PDF chinois, japonais, coréen) et les polices
// standard (`standard_fonts/`) viennent du même paquet, à la même version, par jsdelivr.
// Le texte d'un document se lit toujours par l'API (GET /api/library/<id>/texte), jamais
// en interprétant le fichier dans la page ; un PDF se lit avec `isEvalSupported: false`.

import { api, el, href, kindFr } from './shell.js';
import { pickView } from './proxies.js';

export const PDFJS_VERSION = '4.10.38';
const PDFJS = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/`;
const PDFJS_DATA = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/`;
// les bornes du serveur (server/tools/documents.py : PAGES_MAX, TEXT_MAX, COVER_PX)
const PAGES_MAX = 5000;
const TEXT_MAX = 2_000_000;
const COVER_PX = 1024;

// ── les mots ─────────────────────────────────────────────────
const UNIT1 = { pages: 'page', diapositives: 'diapositive', feuilles: 'feuille', chapitres: 'chapitre' };
export const unitFr = (n, unit = 'pages') => (n ? `${n} ${n === 1 ? UNIT1[unit] || unit : unit}` : '');
const nombre = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
// la ligne d'un document : « PDF · 12 pages · 3 400 mots »
export function docLigne(it) {
  const d = it?.doc || {};
  return [d.label || (d.format || '').toUpperCase() || kindFr('document'), unitFr(d.pages, d.unit),
    d.words ? `${nombre(d.words)} mots` : ''].filter(Boolean).join(' · ');
}
const estPdf = (it) => (it?.doc?.format || '') === 'pdf';

// ── pdf.js ───────────────────────────────────────────────────
let lib = null;
export function pdfjs() {
  if (!lib) {
    lib = import(/* @vite-ignore */ PDFJS + 'pdf.min.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';   // d'une autre origine : pdf.js l'enveloppe (_createCDNWrapper)
      return m;
    }).catch((e) => {
      lib = null;   // un réseau revenu : on réessaiera
      throw new Error(`pdf.js ne se charge pas (cdnjs injoignable ?) : ${e.message}`);
    });
  }
  return lib;
}

// Un PDF ouvert : `source` = un File, un Blob, un ArrayBuffer, des octets, ou l'adresse
// (relative au portail) de l'objet. Rend le document de pdf.js (doc.destroy() le ferme).
export async function ouvrirPdf(source, { signal } = {}) {
  const m = await pdfjs();
  let data = source;
  if (typeof source === 'string') {
    const r = await fetch(href(source), { credentials: 'same-origin', signal });
    if (!r.ok) throw new Error(`le PDF ne se lit pas (${r.status})`);
    data = await r.arrayBuffer();
  } else if (source instanceof Blob) data = await source.arrayBuffer();
  const task = m.getDocument({ data: data instanceof Uint8Array ? data : new Uint8Array(data), isEvalSupported: false,
    cMapUrl: PDFJS_DATA + 'cmaps/', cMapPacked: true, standardFontDataUrl: PDFJS_DATA + 'standard_fonts/' });
  signal?.addEventListener('abort', () => task.destroy(), { once: true });
  try { return await task.promise; } catch (e) {
    if (e?.name === 'PasswordException') throw new Error('ce PDF est protégé par un mot de passe : il se télécharge, il ne se lit pas ici');
    throw new Error(`pdf.js ne lit pas ce PDF : ${e?.message || e}`);
  }
}

// Le texte d'une page, dans l'ordre du fichier : les morceaux de pdf.js mis bout à bout,
// une fin de ligne où il la marque (hasEOL) ou quand la ligne change de hauteur, une
// espace entre deux morceaux d'une même ligne séparés d'un blanc
function texteDePage(tc) {
  let out = '', last = null;
  for (const t of tc.items) {
    if (typeof t.str !== 'string') continue;   // un marquage (beginMarkedContent) : pas du texte
    if (last && t.str) {
      const h = Math.abs(t.transform[3]) || t.height || 10;
      if (Math.abs(t.transform[5] - last.transform[5]) > h * 0.6) { if (!out.endsWith('\n')) out += '\n'; }
      else if (!/\s$/.test(out) && !/^\s/.test(t.str) && t.transform[4] - (last.transform[4] + last.width) > h * 0.18) out += ' ';
    }
    out += t.str;
    if (t.hasEOL) out += '\n';
    if (t.str) last = t;
  }
  return out.replace(/[ \t]+\n/g, '\n').trimEnd();
}

// Une page rendue dans un canevas, `px` de grand côté (pixels de l'écran)
export async function rendrePage(pdf, n, px, canvas = document.createElement('canvas')) {
  const page = await pdf.getPage(n);
  const v1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: px / Math.max(v1.width, v1.height) });
  canvas.width = Math.max(1, Math.round(vp.width));
  canvas.height = Math.max(1, Math.round(vp.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  page.cleanup();
  return canvas;
}

// Le texte d'un PDF page par page, et sa couverture (la page 1 en PNG, COVER_PX) :
// { pages: [{n, text}], count, title, thumb, truncated } — bornés comme au serveur.
export async function lirePdf(source, { onprogress = null, signal, couverture = true } = {}) {
  const pdf = await ouvrirPdf(source, { signal });
  try {
    const count = pdf.numPages;
    let title = '';
    try { title = String((await pdf.getMetadata())?.info?.Title || '').trim().slice(0, 200); } catch { /* sans métadonnées */ }
    const pages = [];
    let left = TEXT_MAX, truncated = false;
    for (let n = 1; n <= count; n++) {
      if (signal?.aborted) throw new Error('lecture arrêtée');
      if (n > PAGES_MAX || left <= 0) { truncated = true; break; }
      const page = await pdf.getPage(n);
      let text = texteDePage(await page.getTextContent());
      page.cleanup();
      if (text.length > left) { text = text.slice(0, left); truncated = true; }
      left -= text.length;
      pages.push({ n, text });
      onprogress?.(n / count);
    }
    let thumb = null;
    if (couverture && count) {
      try { thumb = (await rendrePage(pdf, 1, COVER_PX)).toDataURL('image/png'); } catch { /* la carte du serveur reste */ }
    }
    return { pages, count, title, thumb, truncated };
  } finally {
    pdf.destroy();
  }
}

// Ce que la page a lu, déposé à l'objet (dans SON Workspace) : l'objet neuf
export async function deposerLecture(it, lu) {
  return api(`library/${encodeURIComponent(it.id)}/texte`, { method: 'POST', espace: it.space || undefined,
    body: { pages: lu.pages, count: lu.count, ...(lu.thumb ? { thumb: lu.thumb } : {}) } });
}

// Un document que le serveur n'a pas su lire (un PDF sans poppler) : lu ici, déposé.
// `file` : le fichier qu'on vient de déposer (pas de second téléchargement) ; sinon
// l'adresse de l'objet. Rend l'objet neuf ; lève l'erreur (pdf.js absent, 403…).
export async function extraireDocument(it, { file = null, onprogress = null, signal } = {}) {
  if (it?.kind !== 'document' || !it.doc?.needs_page) return it;
  if (!estPdf(it)) return it;   // aujourd'hui, seul un PDF attend la page (server/tools/documents.py, _pdf)
  const lu = await lirePdf(file || it.url, { onprogress, signal });
  return deposerLecture(it, lu);
}

// ── la liseuse ───────────────────────────────────────────────
// Les pages en vignettes à gauche (les pages rendues par le serveur, sinon pdf.js pour
// un PDF, sinon les premières lignes de la page), à droite le texte page par page — ou,
// pour un PDF, ses pages telles qu'elles sont (« Pages »). Un PDF que le serveur n'a pas
// lu est lu ici et, si la personne peut écrire l'objet, son texte lui est déposé
// (`onitem(objet neuf)`). Rend { el, aller(n), detruire() }.
let css = false;
function feuille() {
  if (css || document.querySelector('link[data-sr-documents]')) { css = true; return; }
  css = true;
  document.head.append(el('link', { rel: 'stylesheet', href: href('commun/documents.css'), 'data-sr-documents': '' }));
}

export function liseuse(it, { page = 1, mode = '', deposer = true, onitem = null, telecharger = true } = {}) {
  feuille();
  const d = { ...(it.doc || {}) };   // une copie : ce que la page lit ne touche pas l'objet de l'appelant
  const unit = d.unit || 'pages';
  const pdf = estPdf(it);
  const imgs = d.page_urls || [];
  let pages = [];                 // le texte : [{n, text}]
  let doc = null;                 // le PDF ouvert par pdf.js (une promesse), pour les vignettes et « Pages »
  let cur = 0, gone = false;
  let vue = mode || (pdf && !d.has_text && !d.needs_page ? 'pages' : 'texte');
  const pdfDoc = () => {
    if (!doc) doc = ouvrirPdf(it.url).catch((e) => { note(e.message); return null; });
    return doc;
  };

  const info = el('span', { class: 'lbl sr-lis-info' }, docLigne(it) + (d.truncated ? ' · texte tronqué' : ''));
  const pos = el('span', { class: 'lbl sr-lis-pos', 'aria-live': 'polite' });
  const seg = pdf ? el('div', { class: 'seg sr-lis-seg', role: 'radiogroup', 'aria-label': 'ce qu’on lit' },
    ...[['texte', 'Texte'], ['pages', 'Pages']].map(([k, lab]) => el('button', {
      class: 'tb' + (vue === k ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(vue === k), 'data-vue': k,
      title: k === 'texte' ? 'le texte lu dans le PDF, page par page' : 'les pages telles qu’elles sont (pdf.js)',
      onclick: () => { if (vue !== k) { const n = cur; vue = k; paintSeg(); peindre(); requestAnimationFrame(() => aller(n)); } } }, lab))) : null;
  const msg = el('p', { class: 'hint sr-lis-msg', hidden: true });
  const pgs = el('nav', { class: 'sr-lis-pgs', 'aria-label': 'les pages' });
  const main = el('div', { class: 'sr-lis-main', tabindex: '0', 'aria-label': 'le document' });
  const root = el('div', { class: 'sr-lis' + (pdf ? ' pdf' : ''), 'data-vue': vue },
    el('div', { class: 'sr-lis-bar' }, info, el('span', { class: 'sp' }), pos, seg),
    msg, el('div', { class: 'sr-lis-body' }, pgs, main));
  function note(t) { msg.textContent = t; msg.hidden = !t; }
  function paintSeg() {
    root.dataset.vue = vue;
    for (const b of seg?.children || []) { const on = b.dataset.vue === vue; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
  }
  const total = () => Math.min(PAGES_MAX, Math.max(d.pages || 0, pages.length, imgs.length));
  const label = (n) => `${UNIT1[unit] || 'page'} ${n}`;

  // une file : une page rendue à la fois (la mémoire d'un gros PDF)
  let file = Promise.resolve();
  const plusTard = (job) => { file = file.then(() => (gone ? null : job())).catch(() => {}); return file; };
  // rendu quand il approche de la vue : un seul observateur par colonne (un PDF de 5000 pages)
  const jobs = new Map();
  const obs = new Map();
  function paresseux(box, rootEl, job) {
    let o = obs.get(rootEl);
    if (!o) {
      o = new IntersectionObserver((es) => {
        for (const e of es) {
          if (!e.isIntersecting || !jobs.has(e.target)) continue;
          const j = jobs.get(e.target);
          jobs.delete(e.target);
          o.unobserve(e.target);
          plusTard(j);
        }
      }, { root: rootEl, rootMargin: '400px' });
      obs.set(rootEl, o);
    }
    jobs.set(box, job);
    o.observe(box);
  }
  // une colonne repeinte : ses rendus en attente s'oublient
  function oublier(rootEl) {
    const o = obs.get(rootEl);
    for (const b of [...jobs.keys()]) if (rootEl.contains(b)) { o?.unobserve(b); jobs.delete(b); }
  }

  // ── les vignettes ──
  function vignette(n) {
    const p = pages.find((x) => x.n === n);
    const pic = el('span', { class: 'pic' });
    if (imgs[n - 1]) pic.append(el('img', { src: href(imgs[n - 1]), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }));
    else if (pdf) {
      pic.classList.add('wait');
      paresseux(pic, pgs, async () => {
        const D = await pdfDoc();
        if (!D || gone || n > D.numPages) return;
        const c = await rendrePage(D, n, 112 * 2 * Math.min(2, window.devicePixelRatio || 1));
        pic.classList.remove('wait');
        pic.append(c);
      });
    } else pic.append(el('span', { class: 'sr-lis-mini' }, (p?.text || '').slice(0, 420)));
    return el('button', { class: 'sr-lis-pg', type: 'button', 'data-n': String(n), title: `aller à la ${label(n)}`,
      onclick: () => aller(n) }, pic, el('span', { class: 'n' }, String(n)));
  }
  function peindreVignettes() {
    const N = total();
    pgs.replaceChildren(...Array.from({ length: N }, (_, k) => vignette(k + 1)));
    pgs.hidden = N < 2 && !pdf;   // une seule page de texte : la colonne ne dit rien
    root.classList.toggle('seule', pgs.hidden);
  }

  // ── la page principale ──
  function vide() {
    const cover = pickView(it, 720);
    return el('div', { class: 'sr-lis-vide' },
      cover.url ? el('img', { src: cover.url, alt: it.title || '', decoding: 'async' }) : null,
      el('p', { class: 'hint' }, d.why || 'aucun texte dans ce document'),
      telecharger && it.url ? el('a', { class: 'tb ghost', href: href(it.url), download: nomDe(it) }, 'Télécharger') : null);
  }
  function peindreTexte() {
    const avec = pages.filter((p) => (p.text || '').trim());
    if (!avec.length) { main.replaceChildren(vide()); return; }
    main.replaceChildren(...avec.map((p) => el('section', { class: 'sr-lis-p', 'data-n': String(p.n) },
      enTete(p.n), el('div', { class: 'sr-lis-t' }, p.text))));
  }
  const enTete = (n) => (total() > 1 ? el('h4', { class: 'lbl' }, label(n)) : null);
  function peindrePages() {
    const N = total() || 1;
    main.replaceChildren(...Array.from({ length: N }, (_, k) => {
      const n = k + 1;
      const box = el('div', { class: 'sr-lis-big wait' });
      paresseux(box, main, async () => {
        const D = await pdfDoc();
        if (!D || gone || n > D.numPages) { if (imgs[n - 1]) { box.classList.remove('wait'); box.append(el('img', { src: href(imgs[n - 1]), alt: '' })); } return; }
        const w = Math.min(1100, Math.max(320, main.clientWidth - 48));
        const c = await rendrePage(D, n, w * Math.min(2, window.devicePixelRatio || 1) * 1.3);
        box.classList.remove('wait');
        box.style.aspectRatio = `${c.width} / ${c.height}`;
        box.append(c);
      });
      return el('section', { class: 'sr-lis-p', 'data-n': String(n) }, enTete(n), box);
    }));
  }
  function peindre() {
    oublier(main);
    if (vue === 'pages') peindrePages(); else peindreTexte();
    suivre();
  }

  // ── où l'on est ──
  function suivre() {
    const secs = [...main.querySelectorAll('.sr-lis-p')];
    const top = main.getBoundingClientRect().top + 24;
    let n = secs.length ? +secs[0].dataset.n : 1;
    for (const s of secs) { if (s.getBoundingClientRect().top <= top) n = +s.dataset.n; else break; }
    if (n === cur) return;
    cur = n;
    pos.textContent = total() > 1 ? `${n} / ${total()}` : '';
    for (const b of pgs.children) b.classList.toggle('on', +b.dataset.n === n);
    const on = pgs.querySelector('.sr-lis-pg.on');
    if (on && !pgs.hidden) {
      const r = on.getBoundingClientRect(), R = pgs.getBoundingClientRect();
      if (r.top < R.top || r.bottom > R.bottom) on.scrollIntoView({ block: 'nearest' });
    }
  }
  main.addEventListener('scroll', () => requestAnimationFrame(suivre), { passive: true });
  function aller(n) {
    const secs = [...main.querySelectorAll('.sr-lis-p')];
    const s = secs.filter((x) => +x.dataset.n <= n).pop() || secs[0];
    if (s) main.scrollTo({ top: main.scrollTop + s.getBoundingClientRect().top - main.getBoundingClientRect().top - 8 });
    requestAnimationFrame(suivre);
  }

  // ── le texte ──
  (async () => {
    main.replaceChildren(el('p', { class: 'lbl' }, 'lecture'));
    try {
      const t = await api(`library/${encodeURIComponent(it.id)}/texte`, { espace: it.space || undefined });
      pages = (t.pages || []).filter((p) => p && typeof p.text === 'string');
    } catch (e) { note(e.message); }
    if (gone) return;
    if (pdf && d.needs_page && !pages.some((p) => p.text.trim())) {
      // le serveur n'a pas lu ce PDF : la page le lit (et le lui dépose, si elle peut écrire)
      main.replaceChildren(el('p', { class: 'lbl' }, 'lecture du PDF'));
      try {
        const lu = await lirePdf(it.url, { couverture: deposer });
        if (gone) return;
        pages = lu.pages;
        d.pages = d.pages || lu.count;
        info.textContent = docLigne({ ...it, doc: { ...d, words: lu.pages.reduce((k, p) => k + (p.text.match(/[\p{L}\p{N}_]+/gu) || []).length, 0) } });
        if (deposer) deposerLecture(it, lu).then((n) => { if (!gone && n) onitem?.(n); }).catch(() => { /* lecture seule : le texte est montré, pas gardé */ });
      } catch (e) { if (!gone) note(e.message); }
    }
    if (gone) return;
    peindreVignettes();
    peindre();
    if (page > 1) requestAnimationFrame(() => aller(page));
  })();

  return {
    el: root,
    aller,
    detruire() {
      gone = true;
      for (const o of obs.values()) o.disconnect();
      jobs.clear();
      doc?.then((D) => D?.destroy()).catch(() => {});
    },
  };
}

// Le nom proposé au téléchargement : le titre, l'extension du fichier rangé (main.<ext>)
export const nomDe = (it) => `${it.title || it.id}${(it.file || '').replace(/^main/, '').replace(/^\.bin$/, '')}`;
