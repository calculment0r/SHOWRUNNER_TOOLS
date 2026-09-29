// SHOWRUNNER TOOLS — le cadre « Entrées » : ce qu'on donne à un modèle
// (images, vidéos, sons, éléments), rangé par sorte, appelé dans le prompt
// par un jeton de position — @image1, @video2, @audio1, @element1 — comme
// les « @ » de Higgsfield et de Magnific. Décision de Cal du 29/09 : on ne
// nomme pas une référence par son nom, parce qu'on garde souvent le prompt
// en changeant les images.
//
//   - Les places sont stables : déposer sur une vignette la remplace à la
//     même place ; retirer laisse la place vide (son jeton passe au rouge) ;
//     « tasser » renumérote et réécrit les jetons des champs liés.
//   - Glisser une vignette la change de place (la règle commune des
//     références, commun/refs.js) : son jeton devient celui de sa nouvelle
//     place, le texte des champs liés ne change pas.
//   - Une catégorie n'apparaît que si elle a du contenu ; pas de places
//     vides affichées d'avance ; un compteur par sorte, et un refus clair
//     quand c'est plein (« plus de place pour une image : 9 / 9 »).
//   - Dans les champs liés (bindField), chaque jeton est vert s'il pointe
//     vers une place remplie, rouge sinon — en direct, par un calque miroir
//     derrière le textarea (le texte reste du texte simple) ; « @ » ouvre le
//     menu des entrées.
//
// Les capacités viennent de l'outil (limits, cost) : Movie Creator y met
// celles d'H3, l'outil Image celles de ses modèles.
//
//   const E = createEntrees(box, {
//     limits: { image: 9, video: 3, audio: 3, files: 12 },   // ce que le modèle prend
//     cost: (item) => ({ image: 1 }),                          // ce qu'un objet consomme
//     roles: { image: [['auto', 'auto'], …] },                 // « utiliser comme », facultatif
//     via: 'movie', state, onchange: (state) => {…},
//   });
//   E.bindField(textarea) · E.get() · E.set(state) · E.badTokens([textes]) · E.tokens()

import { api, el, toast, href, pick, dropZone, kindFr, etypeFr } from './shell.js';
import { sortable, moveItem } from './refs.js';

export const CATS = [   // l'ordre d'affichage ; `token` fait le jeton, `kinds` ce qui s'y range
  { id: 'image', label: 'Images', token: 'image', kinds: ['image'] },
  { id: 'element', label: 'Éléments', token: 'element', kinds: ['element'] },
  { id: 'video', label: 'Vidéos', token: 'video', kinds: ['video'] },
  { id: 'audio', label: 'Sons', token: 'audio', kinds: ['audio'] },
];
const CAT_OF = { image: 'image', element: 'element', video: 'video', audio: 'audio' };
const RES_FR = { image: ['image', 'images'], video: ['vidéo', 'vidéos'], audio: ['son', 'sons'], files: ['fichier', 'fichiers'] };
const ONE_FR = { image: 'une image', video: 'une vidéo', audio: 'un son', files: 'un fichier' };
const plural = (n, r) => `${RES_FR[r][n > 1 ? 1 : 0]}`;
// un jeton : @ + une sorte + une place ; pas après une lettre (une adresse mél n'en est pas un)
export const TOKEN_RX = /(?<![\p{L}\p{N}_@])@([\p{L}_]+)(\d*)/gu;
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function createEntrees(box, { limits = { image: 9, video: 3, audio: 3, files: 12 }, cost = defaultCost, roles = {},
  via = '', state = null, onchange = () => {}, title = 'Entrées' } = {}) {
  const S = { image: [], element: [], video: [], audio: [] };
  const items = new Map();
  const fields = [];
  let lastField = null;
  let on = true;   // éteint : aucun jeton ne pointe vers rien (un mode sans entrées)

  // ── l'état : des places, remplies ou vides ────────────────
  function set(st) {
    for (const c of CATS) S[c.id] = Array.isArray(st?.[c.id]) ? st[c.id].map((p) => (p && p.item ? { ...p } : null)) : [];
    load().then(() => { paint(); refreshFields(); });
  }
  const get = () => Object.fromEntries(CATS.map((c) => [c.id, S[c.id].map((p) => (p ? { ...p } : null))]));
  async function load() {
    const ids = CATS.flatMap((c) => S[c.id].filter(Boolean).map((p) => p.item)).filter((id) => !items.has(id));
    await Promise.all(ids.map(async (id) => { try { items.set(id, await api('library/' + id)); } catch { items.set(id, null); } }));
  }
  const changed = () => { paint(); refreshFields(); onchange(get()); };

  function usage(skip = null) {   // ce que consomment les places remplies (skip : une place qu'on remplace)
    const u = { image: 0, video: 0, audio: 0, files: 0 };
    for (const c of CATS) S[c.id].forEach((p, i) => {
      if (!p || (skip && skip.cat === c.id && skip.pos === i)) return;
      const it = items.get(p.item);
      if (!it) return;
      const k = cost(it, p);
      for (const r of Object.keys(u)) u[r] += k[r] || 0;
    });
    return u;
  }
  // la place manque : le message dit laquelle, avec le compte
  function overflow(it, p, skip) {
    const u = usage(skip), k = cost(it, p);
    for (const r of Object.keys(k)) {
      if (limits[r] != null && u[r] + (k[r] || 0) > limits[r]) {
        return `plus de place pour ${it.kind === 'element' ? `« ${it.title} » (${k[r]} ${plural(k[r], r)})` : ONE_FR[r]} : ${u[r]} / ${limits[r]} ${plural(limits[r], r)}`;
      }
    }
    return '';
  }
  function defaultRole(it) {
    const cat = CAT_OF[it.kind];
    return (roles[cat] || [])[0]?.[0] || '';
  }
  function add(list) {   // chaque objet dans sa catégorie : la première place vide, sinon à la suite
    let n = 0;
    for (const it of list) {
      const cat = CAT_OF[it.kind];
      if (!cat) { toast(`${it.title} : ${kindFr(it.kind)}, pas une entrée`); continue; }
      items.set(it.id, it);
      if (S[cat].some((p) => p && p.item === it.id)) { toast(`${it.title} est déjà là (${tokenOf(cat, S[cat].findIndex((p) => p && p.item === it.id))})`); continue; }
      const p = { item: it.id, role: defaultRole(it), sound: false };
      const why = overflow(it, p);
      if (why) { toast(why, 5000); continue; }
      const hole = S[cat].indexOf(null);
      if (hole >= 0) S[cat][hole] = p; else S[cat].push(p);
      n++;
    }
    if (n) changed();
    return n;
  }
  function replace(cat, pos, it) {   // déposer sur une place : la même place, le même jeton
    if (CAT_OF[it.kind] !== cat) { toast(`une ${kindFr(it.kind)} ne va pas à la place ${tokenOf(cat, pos)}`); return; }
    items.set(it.id, it);
    const p = { item: it.id, role: S[cat][pos]?.role || defaultRole(it), sound: false };
    const why = overflow(it, p, { cat, pos });
    if (why) { toast(why, 5000); return; }
    S[cat][pos] = p;
    changed();
    toast(`${tokenOf(cat, pos)} : ${it.title}`);
  }
  function remove(cat, pos) {
    S[cat][pos] = null;   // la place reste : le jeton du prompt passe au rouge, rien n'est renuméroté
    // une place vide en bout de liste que le prompt ne cite pas n'a plus de raison d'être
    while (S[cat].length && S[cat][S[cat].length - 1] === null && !mentioned(cat, S[cat].length - 1)) S[cat].pop();
    changed();
  }
  // tasser : plus de places vides ; les jetons des champs liés suivent
  function pack() {
    const map = {};
    for (const c of CATS) {
      const kept = [];
      S[c.id].forEach((p, i) => {
        const old = `${c.token}${i + 1}`;
        if (p) { kept.push(p); map[old] = `${c.token}${kept.length}`; } else map[old] = `${c.token}X`;
      });
      S[c.id] = kept;
    }
    for (const f of fields) {
      f.ta.value = f.ta.value.replace(TOKEN_RX, (m, kind, num) => {
        const k = `${kind.toLowerCase()}${num}`;
        return map[k] ? `@${map[k]}` : m;
      });
      f.ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    changed();
    toast('places tassées : les jetons du prompt ont suivi');
  }

  // ── les jetons ────────────────────────────────────────────
  const tokenOf = (cat, pos) => `@${CATS.find((c) => c.id === cat).token}${pos + 1}`;
  function tokens() {
    const out = {};
    if (!on) return out;
    for (const c of CATS) S[c.id].forEach((p, i) => { if (p) out[`${c.token}${i + 1}`] = { cat: c.id, pos: i, ...p, it: items.get(p.item) }; });
    return out;
  }
  const mentioned = (cat, pos) => fields.some((f) => new RegExp(`${tokenOf(cat, pos)}(?!\\d)`, 'i').test(f.ta.value));
  function scan(text) {   // [{tok, ok}] pour chaque jeton du texte
    const t = tokens(), out = [];
    for (const m of text.matchAll(TOKEN_RX)) out.push({ tok: `@${m[1]}${m[2]}`, ok: !!t[`${m[1].toLowerCase()}${m[2]}`] });
    return out;
  }
  const badTokens = (texts) => [...new Set(texts.flatMap((x) => scan(x || '').filter((s) => !s.ok).map((s) => s.tok)))];

  // ── le cadre ──────────────────────────────────────────────
  const zone = el('button', { class: 'ent-drop', type: 'button', onclick: choose });
  const cats = el('div', { class: 'ent-cats' });
  const head = el('div', { class: 'ent-head' }, el('h3', {}, title), el('span', { class: 'sp' }), el('span', { class: 'lbl ent-use' }));
  box.classList.add('ent');
  box.replaceChildren(head, zone, cats);
  dropZone(box, { kinds: ['image', 'element', 'video', 'audio'], multiple: true, via, onitems: add });
  async function choose() {
    const got = await pick({ kinds: ['image', 'element', 'video', 'audio'], multiple: true, title: 'Entrées · images, éléments, vidéos, sons' });
    add(got);
  }
  function paint() {
    const u = usage();
    const full = Object.keys(limits).filter((r) => u[r] >= limits[r]);
    box.querySelector('.ent-use').textContent = `${u.files} / ${limits.files} fichiers`;
    const any = CATS.some((c) => S[c.id].length);
    zone.classList.toggle('compact', any);
    zone.replaceChildren(el('b', {}, '+'), el('span', {}, full.length
      ? `plein pour les ${full.map((r) => `${RES_FR[r][1]} (${u[r]} / ${limits[r]})`).join(', ')} — déposez sur une vignette pour la remplacer`
      : any ? 'déposer ou choisir une autre entrée' : 'déposez des images, des vidéos, des sons, des éléments — ou cliquez pour choisir'));
    zone.classList.toggle('full', full.length > 0);
    cats.replaceChildren(...CATS.filter((c) => S[c.id].length).map((c) => catBox(c, u)));
  }
  function catBox(c, u) {
    const filled = S[c.id].filter(Boolean).length, holes = S[c.id].length - filled;
    let count;
    if (c.id === 'element') {
      const k = S[c.id].filter(Boolean).map((p) => cost(items.get(p.item) || {}, p));
      const im = k.reduce((a, x) => a + (x.image || 0), 0), au = k.reduce((a, x) => a + (x.audio || 0), 0);
      count = `${filled} · ${im} ${plural(im, 'image')}${au ? ` · ${au} voix` : ''}`;
    } else {
      const r = c.id;
      count = `${u[r]} / ${limits[r]}${u[r] >= limits[r] ? ' · plein' : ''}`;
    }
    return el('div', { class: 'ent-cat' },
      el('div', { class: 'ent-cat-head' }, el('span', { class: 'lbl' }, c.label), el('span', { class: 'lbl n' + (c.id !== 'element' && u[c.id] >= limits[c.id] ? ' full' : '') }, count),
        el('span', { class: 'sp' }), holes ? el('button', { class: 'tb ghost sm', type: 'button', title: 'retirer les places vides et renuméroter ; les jetons du prompt suivent', onclick: pack }, 'Tasser') : null),
      // la règle commune des références (commun/refs.js) : glisser une vignette change sa
      // place, donc son jeton ; le texte des champs liés ne change pas (c'est la place qui compte)
      sortable(el('div', { class: 'ent-slots' }, ...S[c.id].map((p, i) => slot(c, p, i))), { item: '.ent-slot',
        onmove: (a, b) => { S[c.id] = moveItem(S[c.id], a, b); changed(); } }));
  }
  function slot(c, p, i) {
    const tok = tokenOf(c.id, i);
    const it = p ? items.get(p.item) : null;
    const node = el('div', { class: 'ent-slot' + (p ? '' : ' hole') + (c.id === 'element' ? ' element' : ''),
      title: p ? `${it?.title || ''} — cliquer : insérer ${tok} dans le prompt · déposer ici : remplacer` : `${tok} : place vide — déposez ici pour la remplir` });
    dropZone(node, { kinds: c.kinds, multiple: false, via, onitems: ([x]) => replace(c.id, i, x) });
    if (!p) {
      node.append(el('span', { class: 'ent-im' }, el('span', { class: 'ent-empty' }, 'vide')), el('span', { class: 'ent-tok bad' }, tok),
        el('button', { class: 'ent-x', type: 'button', title: 'oublier cette place', onclick: (e) => { e.stopPropagation(); S[c.id].splice(i, 1); changed(); } }, '×'));
      return node;
    }
    const thumb = it?.thumb_url || (it?.kind === 'image' ? it.url : null);
    node.append(
      el('button', { class: 'ent-im', type: 'button', style: thumb ? { backgroundImage: `url(${href(thumb)})` } : null, onclick: () => insertToken(tok) },
        c.id === 'audio' ? el('span', { class: 'ent-ico' }, '♪') : null,
        it?.duration ? el('span', { class: 'ent-dur' }, `${it.duration.toFixed(1)} s`) : null),
      el('span', { class: 'ent-tok ok' }, tok),
      el('button', { class: 'ent-x', type: 'button', title: 'retirer (la place reste, son jeton passe au rouge)', onclick: (e) => { e.stopPropagation(); remove(c.id, i); } }, '×'));
    const rl = roles[c.id];
    if (rl && rl.length > 1) {
      const cur = rl.findIndex((r) => r[0] === p.role);
      node.append(el('button', { class: 'ent-role', type: 'button', title: 'utiliser comme — cliquer pour changer',
        onclick: (e) => { e.stopPropagation(); p.role = rl[(cur + 1) % rl.length][0]; changed(); } }, (rl[cur] || rl[0])[1]));
    } else if (c.id === 'element') {
      node.append(el('span', { class: 'ent-role still' }, etypeFr(it?.element?.type)));
    }
    if (c.id === 'video' && it?.audio) {
      node.append(el('button', { class: 'ent-snd' + (p.sound ? ' on' : ''), type: 'button', title: 'utiliser aussi sa bande-son (compte comme un son)',
        onclick: (e) => {
          e.stopPropagation();
          if (!p.sound && usage().audio + 1 > limits.audio) { toast(`plus de place pour un son : ${usage().audio} / ${limits.audio} sons`); return; }
          p.sound = !p.sound; changed();
        } }, p.sound ? '♪ son' : '♪'));
    }
    return node;
  }

  // ── les champs liés : jetons en couleur, menu « @ » ───────
  function bindField(ta) {
    const wrap = el('div', { class: 'ent-wrap' });
    const mirror = el('div', { class: 'ent-mirror', 'aria-hidden': 'true' });
    const menu = el('div', { class: 'ent-menu', hidden: true });
    ta.parentNode.insertBefore(wrap, ta);
    wrap.append(mirror, ta, menu);
    ta.classList.add('ent-ta');
    const f = { ta, mirror, menu, sel: 0 };
    fields.push(f);
    const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    f.paint = () => {
      const v = ta.value;
      let html = '', last = 0;
      const t = tokens();
      for (const m of v.matchAll(TOKEN_RX)) {
        const at = m.index, tok = m[0];
        const ok = !!t[`${m[1].toLowerCase()}${m[2]}`];
        html += esc(v.slice(last, at)) + `<mark class="${ok ? 'ok' : 'bad'}">${esc(tok)}</mark>`;
        last = at + tok.length;
      }
      mirror.innerHTML = html + esc(v.slice(last)) + '​';
      grow();
    };
    ta.addEventListener('input', () => { f.paint(); menuFor(f); });
    ta.addEventListener('focus', () => { lastField = ta; });
    ta.addEventListener('click', () => menuFor(f));
    ta.addEventListener('keydown', (e) => {
      if (menu.hidden) return;
      const bs = [...menu.querySelectorAll('button')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); f.sel = (f.sel + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length; bs.forEach((b, k) => b.classList.toggle('on', k === f.sel)); }
      else if (e.key === 'Enter' || e.key === 'Tab') { if (bs[f.sel]) { e.preventDefault(); bs[f.sel].dispatchEvent(new MouseEvent('mousedown')); } }
      else if (e.key === 'Escape') menu.hidden = true;
    });
    ta.addEventListener('blur', () => setTimeout(() => { menu.hidden = true; }, 150));
    f.paint();
    return f;
  }
  function menuFor(f) {
    const { ta, menu } = f;
    const m = ta.value.slice(0, ta.selectionStart).match(/(?<![\p{L}\p{N}_@])@([\p{L}_]*\d*)$/u);
    const list = m ? Object.entries(tokens()).filter(([k]) => k.startsWith(m[1].toLowerCase())) : [];
    if (!m || !list.length) { menu.hidden = true; return; }
    f.sel = 0;
    menu.replaceChildren(...list.map(([k, t], idx) => {
      const thumb = t.it?.thumb_url || (t.it?.kind === 'image' ? t.it.url : null);
      return el('button', { type: 'button', class: idx === 0 ? 'on' : '', onmousedown: (e) => {
        e.preventDefault();
        const start = ta.selectionStart - m[0].length;
        ta.setRangeText(`@${k} `, start, ta.selectionStart, 'end');
        menu.hidden = true; ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }));
      } }, el('span', { class: 'mi', style: thumb ? { backgroundImage: `url(${href(thumb)})` } : null }, t.cat === 'audio' ? '♪' : ''),
      el('b', {}, '@' + k), el('span', {}, t.it?.title || ''));
    }));
    menu.hidden = false;
  }
  function insertToken(tok) {
    const ta = lastField || fields[0]?.ta;
    if (!ta) return;
    const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
    const pre = ta.value.slice(0, a), post = ta.value.slice(b);
    const pad = pre && !/\s$/.test(pre) ? ' ' : '';
    ta.value = pre + pad + tok + (post && !/^\s/.test(post) ? ' ' : '') + post;
    const at = (pre + pad + tok + ' ').length;
    ta.focus(); ta.setSelectionRange(at, at);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function refreshFields() { for (const f of fields) f.paint(); }
  function enable(v) { on = !!v; refreshFields(); }

  set(state);
  return { get, set, add, tokens, badTokens, bindField, refreshFields, insertToken, usage, limits, enable };
}

// ce qu'un objet consomme, par défaut : une place de sa sorte
function defaultCost(it) {
  if (it.kind === 'element') return { image: Math.min(2, (it.element?.refs || []).length), files: Math.min(2, (it.element?.refs || []).length) };
  return { [it.kind]: 1, files: 1 };
}
