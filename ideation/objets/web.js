// IDÉATION · OBJETS — l'objet « Web » (30/09/2026) : une adresse collée sur la
// planche devient une carte. YouTube et Vimeo : leur lecteur officiel ; un site :
// dans un cadre s'il l'autorise, sinon une carte lien propre (titre, image,
// description lus par le serveur) qui dit pourquoi. L'étude, les sources :
// docs/etudes/ideation_collab.md § 10.
//
//   { id, type: 'web', x, y, w, h, url, title, desc, site, img, frame, why, fetched }
//   img    l'empreinte de l'image rangée par le serveur (api/ideation/web/img/<empreinte>)
//   frame  le site se laisse mettre dans un cadre (X-Frame-Options, CSP frame-ancestors)
//
// La sorte (youtube | vimeo | site) et l'adresse du lecteur se DÉDUISENT de `url`
// (web_url.js, la règle du serveur) : rien de ce qu'un cadre charge n'est lu tel
// quel dans la planche.
//
// Comme Miro : la carte d'abord, légère — rien ne se charge chez YouTube, Vimeo ou
// le site avant « Lire » / « Ouvrir ici » (l'image vient du portail). Le cadre
// chargé ne prend ni la molette ni le bouton du milieu de la planche tant qu'on ne
// l'a pas activé (`pointer-events: none`) : un double-clic ou « Interagir »
// l'active ; un clic ailleurs sur la page le rend à la planche (la vidéo continue).
// Qu'il ne charge pas (un bloqueur, le réseau) : la barre du haut garde le titre,
// l'adresse, « ↗ » et « Carte ».
//
// Sécurité (MDN, <iframe>) : `sandbox` sans allow-top-navigation (le site ne peut
// pas emmener la page du portail), sans allow-modals ni allow-downloads ;
// allow-same-origin + allow-scripts ne sont dangereux que pour un document de la
// même origine que la page — ces cadres sont toujours d'une autre origine.
// `allow` (Permissions Policy) : rien pour un site (ni caméra, ni micro, ni
// position, ni plein écran) ; lecture, DRM, image dans l'image et plein écran pour
// les lecteurs vidéo. `referrerpolicy` : strict-origin-when-cross-origin pour
// YouTube (il exige le Referer, erreur 153 sinon ; le portail envoie
// « Referrer-Policy: same-origin », qui n'en enverrait pas), no-referrer pour un site.

import { el, href, api, toast } from '../../commun/shell.js';
import { icon, cut } from './commun.js';
import { parseWeb, playerSrc } from './web_url.js';

export const WEB_ICON = 'M12 3a9 9 0 1 0 .01 0M3.5 9h17M3.5 15h17M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9M12 3c-2.4 2.6-3.6 5.6-3.6 9s1.2 6.4 3.6 9';
const PLAY = 'M8 5v14l11-7z';
const VIDEO = { sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox',
  allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', referrerpolicy: 'strict-origin-when-cross-origin' };
const SITE = { sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox',
  allow: '', referrerpolicy: 'no-referrer' };
const KIND_NAME = { youtube: 'YouTube', vimeo: 'Vimeo', site: 'site' };
const SIZE = { video: [420, 272], site: [360, 250] };

let cssDone = false;
export function mediasCss() {
  if (cssDone || document.querySelector('link[data-ide-medias]')) { cssDone = true; return; }
  cssDone = true;
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./medias.css', import.meta.url).href, 'data-ide-medias': '' }));
}

// ce que l'objet garde de l'aperçu du serveur (server/tools/web_apercu.py, node_fields)
const FIELDS = ['url', 'title', 'desc', 'site', 'img', 'frame', 'why', 'fetched'];
const fieldsOf = (g) => Object.fromEntries(FIELDS.map((k) => [k, k === 'frame' ? !!g[k] : String(g[k] ?? '')]));

// les cadres chargés (id → true), et celui qui reçoit la souris : un état de cette page seulement
// (activer un lecteur chez moi ne le lance pas chez les autres)
const live = new Set();
let active = null;

export function extendWeb(app, api0) {
  const { S } = app;
  mediasCss();
  const P = (n) => parseWeb(n.url);
  const video = (p) => p.kind === 'youtube' || p.kind === 'vimeo';
  const canLive = (n, p = P(n)) => p.ok && (video(p) || (n.frame && /^https:\/\//i.test(p.url)));
  const whyNot = (n, p = P(n)) => (!p.ok ? p.why : n.why || (!/^https:\/\//i.test(p.url) ? 'une page en http:// ne s’intègre pas' : 'ce site ne s’intègre pas'));
  const imgUrl = (n) => (n.img ? href(`api/ideation/web/img/${n.img}`) : '');
  const nodeEl = (id) => app.canvas?.dom.get(id)?.el;

  // ── charger, activer, rendre ─────────────────────────────
  function frameFor(n) {
    const p = P(n);
    const cfg = video(p) ? VIDEO : SITE;
    const f = el('iframe', { class: 'wb-if', src: video(p) ? playerSrc(p) : p.url, title: n.title || p.host, sandbox: cfg.sandbox,
      allow: cfg.allow || null, referrerpolicy: cfg.referrerpolicy });   // « fullscreen » est dans allow (allowfullscreen : l'ancienne forme)
    return f;
  }
  function load(id) {
    const n = app.node(id);
    if (!n || !canLive(n)) { if (n) toast(whyNot(n), 6000); return; }
    live.add(id);
    const e = nodeEl(id);
    const body = e?.querySelector('.wb-body');
    if (body && !body.querySelector('iframe')) body.append(frameFor(n));
    e?.classList.add('live');
    activate(id);
  }
  function activate(id) {
    if (!live.has(id)) { load(id); return; }
    if (active && active !== id) deactivate();
    active = id;
    const e = nodeEl(id);
    e?.classList.add('on');
    e?.querySelector('iframe')?.focus({ preventScroll: true });
  }
  function deactivate() {
    if (!active) return;
    nodeEl(active)?.classList.remove('on');
    active = null;
  }
  function unload(id) {
    if (active === id) deactivate();
    live.delete(id);
    const e = nodeEl(id);
    e?.querySelector('iframe')?.remove();
    e?.classList.remove('live', 'on');
  }
  // un clic ailleurs dans la page rend le cadre à la planche (les clics DANS le cadre ne
  // remontent pas jusqu'ici) ; la barre du cadre actif garde ses boutons
  addEventListener('pointerdown', (e) => {
    if (!active) return;
    if (e.target.closest?.('.wb-bar') && e.target.closest('[data-id]')?.dataset.id === active) return;
    deactivate();
  }, true);
  const tidy = () => { for (const id of [...live]) if (!app.node(id)) unload(id); };

  // ── le dessin (canvas.js l'habille : .nd.web, data-id, poignée) ──
  function build(n) {
    const p = P(n);
    const vid = video(p);
    const can = canLive(n, p);
    const on = live.has(n.id);
    const out = el('a', { class: 'wb-out', href: p.ok ? p.url : null, target: '_blank', rel: 'noopener noreferrer', title: `ouvrir dans un onglet — ${p.url}` }, '↗');
    const bar = el('div', { class: 'wb-bar' },
      el('span', { class: 'wb-k' }, vid ? KIND_NAME[p.kind] : can ? 'site' : 'lien'),
      el('span', { class: 'wb-h', title: p.url }, p.host || '—'), el('span', { class: 'sp' }),
      el('button', { class: 'wb-b wb-act', type: 'button', title: 'le cadre reçoit la souris et la molette — un clic hors de lui les rend à la planche' }, 'Interagir'),
      el('button', { class: 'wb-b wb-back', type: 'button', title: 'fermer le cadre : revenir à la carte' }, 'Carte'),
      out);
    const pic = imgUrl(n);
    const title = n.title || (vid ? `Vidéo ${KIND_NAME[p.kind]}` : p.host) || 'adresse';
    const meta = el('div', { class: 'wb-meta' },
      el('b', { class: 'wb-t', title }, title),
      // ce qui empêche l'intégration passe avant la description : c'est ce que la carte doit dire
      !can || n.why ? el('p', { class: 'wb-why' }, n.why || whyNot(n, p)) : null,
      n.desc ? el('p', { class: 'wb-d' }, n.desc) : null,
      can && !vid ? el('button', { class: 'wb-b wb-open', type: 'button', title: 'le site dans la carte, sans quitter la planche' }, 'Ouvrir ici') : null);
    const card = el('div', { class: 'wb-card' + (pic ? '' : ' noimg') },
      el('div', { class: 'wb-img' }, pic ? el('img', { src: pic, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }) : icon(WEB_ICON, 'wb-glyph'),
        vid ? el('button', { class: 'wb-play', type: 'button', 'aria-label': `lire la vidéo ${KIND_NAME[p.kind]}`, title: `lire ici — rien ne se charge chez ${KIND_NAME[p.kind]} avant ce clic` }, icon(PLAY)) : null),
      meta);
    const body = el('div', { class: 'wb-body' }, card, on && can ? frameFor(n) : null);
    const root = el('div', { class: 'wb' }, bar, body);
    root.addEventListener('click', (e) => {
      const b = e.target.closest?.('button');
      if (!b) return;
      if (b.matches('.wb-play, .wb-open, .wb-act')) { e.stopPropagation(); load(n.id); }
      else if (b.matches('.wb-back')) { e.stopPropagation(); unload(n.id); }
    });
    // double-clic : activer (un enfant de groupe fermé garde la règle du canvas : le choisir d'abord)
    root.addEventListener('dblclick', (e) => {
      const c = app.node(n.id);
      if (!c || (c.group && S.focus !== c.group)) return;
      e.stopPropagation();
      if (canLive(c)) load(c.id); else window.open(P(c).url, '_blank', 'noopener,noreferrer');
    });
    const cls = ['wb-' + (vid ? 'video' : can ? 'site' : 'lien')];
    if (on && can) cls.push('live');
    if (on && active === n.id) cls.push('on');
    return { cls, body: [root] };
  }
  const key = () => '';

  // ── poser : une adresse → l'aperçu du serveur → l'objet (un seul pas d'annulation) ──
  async function create(raw, at = null) {
    if (!S.board) { toast('ouvrez ou créez d’abord une planche'); return null; }
    if (app.canvas.isLocked()) { toast('la planche est en lecture seule ici'); return null; }
    const p = parseWeb(raw);
    if (!p.ok) { toast(p.why, 6000); return null; }
    let g = null, err = '';
    try { g = await api('ideation/web/apercu', { method: 'POST', body: { url: p.url, board: S.board.id } }); }
    catch (e) { if (e.status === 400) { toast(e.message, 6000); return null; } err = e.message; }
    const f = g ? fieldsOf(g) : { ...fieldsOf({ url: p.url, site: p.host }), why: `pas d’aperçu : ${err}` };
    const [w, h] = SIZE[video(p) ? 'video' : 'site'];
    // au point du menu ; sinon une place libre près du centre de la vue (comme un fichier déposé)
    const [x, y] = at ? [at[0] - w / 2, at[1] - h / 2] : app.freeSpot(app.canvas.center()[0] - w / 2, app.canvas.center()[1] - h / 2, w, h, { around: true });
    const n = app.addAt('web', x, y, { preset: { ...f, w, h }, select: true });
    if (n && f.why && !video(p)) toast(f.why, 5000);
    return n;
  }
  async function refresh(id, raw = null) {
    const n = app.node(id);
    if (!n) return;
    const p = parseWeb(raw ?? n.url);
    if (!p.ok) { toast(p.why, 6000); return; }
    let g;
    try { g = await api('ideation/web/apercu', { method: 'POST', body: { url: p.url, board: S.board?.id } }); } catch (e) { toast(e.message, 6000); return; }
    const c = app.node(id);
    if (!c) return;
    if (c.url !== g.url) unload(id);
    app.mutate(() => Object.assign(c, fieldsOf(g)));
    toast(g.why ? `aperçu relu — ${g.why}` : 'aperçu relu');
  }
  function ask(at = null) {
    if (!S.board) { toast('ouvrez ou créez d’abord une planche'); return; }
    if (app.canvas.isLocked()) { toast('la planche est en lecture seule ici'); return; }
    const inp = el('input', { class: 'fld', placeholder: 'https://www.youtube.com/watch?v=…  ·  https://vimeo.com/…  ·  un site', maxlength: 2048, spellcheck: 'false' });
    const msg = el('p', { class: 'hint wb-ask-m' }, 'YouTube et Vimeo : leur lecteur officiel (YouTube sans cookie de suivi : youtube-nocookie.com). Un site : dans la carte s’il l’autorise, sinon une carte lien qui dit pourquoi. On peut aussi coller l’adresse directement sur la planche (ctrl+V).');
    let busy = false;
    const go = async () => {
      if (busy) return;
      const p = parseWeb(inp.value);
      if (!p.ok) { msg.textContent = p.why; msg.classList.add('err'); inp.focus(); return; }
      busy = true; okB.disabled = true; msg.classList.remove('err'); msg.textContent = 'le serveur lit la page (8 s au plus)…';
      const n = await create(p.url, at);
      busy = false; okB.disabled = false;
      if (n) close(); else { msg.textContent = 'rien de posé : voir le message en bas'; msg.classList.add('err'); }
    };
    const okB = el('button', { class: 'tb go', type: 'button', onclick: go }, 'Intégrer');
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const close = app.modal('Intégrer une adresse web', el('div', { class: 'wb-ask' }, el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'adresse'), inp), msg),
      (cl) => [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: cl }, 'Annuler'), okB]);
    setTimeout(() => inp.focus(), 30);
  }

  // ── les menus, l'inspecteur ──────────────────────────────
  function menu(n) {
    const p = P(n), can = canLive(n, p), on = live.has(n.id);
    return [
      video(p) ? { label: on ? 'Interagir' : 'Lire ici', sub: 'double-clic', disabled: !can, why: whyNot(n, p), onclick: () => load(n.id) }
        : { label: on ? 'Interagir' : 'Ouvrir ici', sub: 'double-clic', disabled: !can, why: whyNot(n, p), onclick: () => load(n.id) },
      on ? { label: 'Revenir à la carte', sub: 'le cadre se ferme', onclick: () => unload(n.id) } : null,
      { label: 'Ouvrir dans un onglet', icon: '↗', disabled: !p.ok, why: p.why, onclick: () => window.open(p.url, '_blank', 'noopener,noreferrer') },
      { label: 'Copier l’adresse', onclick: () => navigator.clipboard?.writeText(p.url).then(() => toast('adresse copiée'), () => toast(p.url)) },
      { label: 'Relire l’aperçu', sub: 'titre, image, cadre', disabled: app.canvas.isLocked(), why: 'lecture seule', onclick: () => refresh(n.id) },
    ].filter(Boolean);
  }
  function panels(n, K) {
    const { card, row, hint, b } = K;
    const p = P(n), can = canLive(n, p);
    const urlF = el('input', { class: 'fld sm', value: n.url || '', maxlength: 2048, spellcheck: 'false', title: 'Entrée : relire l’aperçu de cette adresse' });
    urlF.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); refresh(n.id, urlF.value); } });
    const tF = el('input', { class: 'fld sm', value: n.title || '', maxlength: 300, placeholder: 'le titre', 'data-reg': 'title' });
    let ch = () => {};
    tF.addEventListener('focus', () => { ch = app.editing(); });
    tF.addEventListener('input', () => { ch(); const c = app.node(n.id); if (c) c.title = tF.value; app.canvas.renderSoon(); });
    return [card('Web', video(p) ? KIND_NAME[p.kind] : can ? 'site intégrable' : 'carte lien',
      el('label', { class: 'look' }, el('span', { class: 'lbl' }, 'adresse'), urlF),
      el('label', { class: 'look' }, el('span', { class: 'lbl' }, 'titre'), tF),
      row(b(video(p) ? 'Lire ici' : 'Ouvrir ici', () => load(n.id), { disabled: !can, title: can ? 'dans la carte' : whyNot(n, p) }),
        el('a', { class: 'tb ghost sm', href: p.url, target: '_blank', rel: 'noopener noreferrer' }, 'Onglet ↗'),
        b('Relire', () => refresh(n.id), { title: 'relire titre, image et droit d’intégrer', disabled: app.canvas.isLocked() })),
      !can ? hint(`${whyNot(n, p)} — « Onglet ↗ » l’ouvre à côté.`) : null,
      hint(video(p) ? `Le lecteur officiel de ${KIND_NAME[p.kind]}${p.kind === 'youtube' ? ' en mode confidentialité renforcée (youtube-nocookie.com)' : ' avec « dnt »'} ; rien ne se charge chez eux avant « Lire ». Double-clic ou « Interagir » : le cadre prend la souris ; un clic ailleurs la rend à la planche.`
        : 'L’image et le titre ont été lus par le serveur (rien n’est demandé au site par cette page tant que le cadre est fermé).'),
      n.fetched ? hint(`aperçu lu le ${n.fetched.replace('T', ' à ')}`) : null)];
  }

  // ── ce que l'app en dit ──────────────────────────────────
  const L0 = app.label, K0 = app.kindLabel;
  app.label = (n) => (n?.type === 'web' ? cut(n.title || P(n).host || 'adresse', 42) : L0(n));
  app.kindLabel = (n) => (n?.type === 'web' ? (video(P(n)) ? 'vidéo web' : 'web') : K0(n));

  // l'objet d'atelier « web » dans app.objets : les sortes, le dessin, les menus, l'inspecteur
  api0.TYPES.add('web');
  api0.defs.web = () => ({ w: SIZE.site[0], h: SIZE.site[1], url: '', title: '', desc: '', site: '', img: '', frame: false, why: '', fetched: '' });
  const wrap = (k, fn) => { const f0 = api0[k]; api0[k] = (n, ...a) => (n?.type === 'web' ? fn(n, ...a) : f0(n, ...a)); };
  wrap('build', build);
  wrap('key', key);
  wrap('menu', menu);
  wrap('panels', panels);
  wrap('mini', (n, tok) => tok('cy'));
  const B0 = api0.boardItems;
  api0.boardItems = (wx, wy) => [...B0(wx, wy), { label: 'Adresse web…', key: 'W', sub: 'YouTube, Vimeo, un site', onclick: () => ask([wx, wy]) }];
  app.web = { ask, create, refresh, load, activate, deactivate, unload, tidy, state: () => ({ live: [...live], active }) };
  return api0;
}
