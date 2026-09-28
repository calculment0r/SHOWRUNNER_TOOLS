// MOVIE CREATOR — des plans vidéo avec H3, dans le thème du portail.
//
// Le parcours suit H3 Studio (github.com/underworldhistory1-ctrl/minimax-h3-higgsfield,
// licence MIT, Copyright (c) 2026 Charles Mod) : un rail de création (carte du
// modèle, modes Texte / Images / Références, références nommées @nom, les trois
// champs du prompt H3, LoRA, toiles avec temps estimé, méthode, durée, pas,
// graine), un espace de travail (la vidéo en grand, la progression, « Vidéo en
// cours ») et les vidéos générées. Réécrit ici ; la bibliothèque du portail,
// la file commune et les éléments remplacent leurs fichiers locaux.
//
// Le banc « Comparer » reprend le banc NL de Cal : rideau, côte à côte,
// clignotement, zoom sous le curseur, boucle, écoute A/B, recettes et
// différences.
//
// Le serveur fait foi : /api/movie/plan résout tout (toile, étiquettes H3,
// prompt envoyé, graphe, temps estimé, ce qui manque) ; la page l'affiche et
// soumet à la file (movie.t2v / movie.i2v / movie.r2v).

import { mountHeader, api, jobs, pick, uploadFile, toast, el, $, $$, href, fmtDate, kindFr, etypeFr, dropAnywhere } from '../commun/shell.js';

mountHeader('movie');

const store = {   // commodité du navigateur : le formulaire en cours
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* navigation privée */ } },
};
const MODE_FR = { t2v: 'texte', i2v: 'images', r2v: 'références' };
const METH_FR = { turbo: 'turbo', origine: 'origine', spectrum: 'spectrum' };
const ROLE_FR = { face: 'visage', 'full body': 'plein pied', expression: 'expression' };
const mmss = (s) => { if (s == null || !isFinite(s)) return '—'; s = Math.max(0, Math.round(s)); return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}` : `${s} s`; };
const p2 = (n) => String(n).padStart(2, '0');
const tcode = (t) => { if (!isFinite(t)) t = 0; const m = Math.floor(t / 60), s = t - m * 60; return p2(m) + ':' + s.toFixed(2).padStart(5, '0'); };
const bg = (u) => (u ? { backgroundImage: `url(${href(u)})` } : null);
// replaceChildren écrirait « null » : on ne passe que des nœuds
const put = (box, ...kids) => box.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
const rng = (e) => (e ? `${mmss(e.low)} – ${mmss(e.high)}` : '');

// ── l'état ──────────────────────────────────────────────────
const saved = store.get('movie.v2', {});
const F = {
  mode: 't2v',
  p: { t2v: { desc: '', sound: '', music: '' }, i2v: { desc: '', sound: '', music: '' }, r2v: { desc: '', sound: '', music: '' } },
  start: null, end: null, refs: [], refKind: 'image', refSize: 'match',
  canvas: { t2v: [1344, 768], i2v: 'auto', r2v: [1344, 768] }, fam: { t2v: 'paysage', i2v: 'image', r2v: 'paysage' },
  method: 'turbo', frames: 124, steps: '', seed: '', loras: {}, adv: {},
  ...saved,
};
for (const k of ['t2v', 'i2v', 'r2v']) F.p[k] = { desc: '', sound: '', music: '', ...((saved.p || {})[k] || {}) };
const S = {
  view: 'create', opts: null, plan: null, seq: 0, items: new Map(), lib: [], libAll: store.get('movie.lib', 'movie'),
  libShown: 8, jobs: [], cur: null, focus: 'create', loras: [], loraMachine: '', A: null, B: null, h3: null, myJobs: new Set(store.get('movie.myjobs', [])),
};
const save = () => store.set('movie.v2', F);
function changed({ focus = true } = {}) { save(); schedulePlan(); if (focus) setFocus('create'); }
async function item(id) {
  if (!id) return null;
  if (S.items.has(id)) return S.items.get(id);
  try { const it = await api('library/' + id); S.items.set(id, it); return it; } catch { S.items.set(id, null); return null; }
}

// Un seul orange : « Générer » pendant la création, l'action du résultat ensuite.
function setFocus(f) {
  S.focus = f;
  const res = f === 'result' && S.cur && S.view === 'create';
  $('#go').classList.toggle('go', !res);
  $('#go').classList.toggle('ghost', !!res);
  $('#res-dl').classList.toggle('go', !!res);
  $('#res-dl').classList.toggle('ghost', !res);
}

// ── vues : créer, comparer ──────────────────────────────────
function setView(v) {
  S.view = v;
  document.body.dataset.view = v;
  $$('.subnav [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  $('#create').hidden = v !== 'create';
  $('#cmp-rail').hidden = v !== 'cmp';
  $('#dock').hidden = v !== 'create';
  $('#view').hidden = v !== 'create';
  $('#bench').hidden = v !== 'cmp';
  if (v === 'cmp') benchLoad(); else pauseBench();
  paintLib();
  setFocus(S.focus);
  syncUrl();
}
$$('.subnav [data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

function setMode(m) {
  F.mode = m;
  document.body.dataset.mode = m;
  $$('#modes [data-mode]').forEach((b) => { const on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $$('#create [data-for]').forEach((n) => { n.hidden = n.dataset.for !== m; });
  $('#desc-lbl').textContent = m === 'r2v' ? 'Description · detailed_description' : 'Description · integrated_multimodal_description';
  $('#desc').placeholder = PH[m];
  syncFields();
  if (m === 'i2v') { paintSlot('start'); paintSlot('end'); }
  if (m === 'r2v') paintRefs();
  paintLoras();
  paintAdv();
  save(); schedulePlan();
  syncUrl();
}
$$('#modes [data-mode]').forEach((b) => b.addEventListener('click', () => { setMode(b.dataset.mode); setFocus('create'); }));

function syncUrl() {
  const q = new URLSearchParams();
  if (S.view === 'cmp') { q.set('view', 'cmp'); if (S.A) q.set('a', S.A); if (S.B) q.set('b', S.B); }
  else { q.set('mode', F.mode); if (S.cur) q.set('id', S.cur); }
  try { history.replaceState(null, '', '?' + q); } catch { /* aperçu */ }
}

// ── Images : début · fin ────────────────────────────────────
async function paintSlot(which) {
  const box = $(which === 'start' ? '#start-slot' : '#end-slot');
  const it = await item(F[which]);
  if (F[which] && !it) { F[which] = null; save(); }
  box.replaceChildren();
  box.onclick = null;
  if (!it) {
    box.className = 'slot empty';
    box.append(el('button', { class: 'slot-empty', type: 'button', onclick: () => chooseImage(which) },
      el('b', {}, which === 'start' ? '+ début' : '+ fin'), el('span', {}, 'choisir, déposer, ou le plein pied d’un personnage')));
    return;
  }
  box.className = 'slot';
  box.title = 'changer d’image';
  box.append(el('img', { src: href(it.thumb_url || it.url), alt: it.title || '' }),
    el('span', { class: 'cap' }, `${it.width}×${it.height}`),
    el('button', { class: 'x', type: 'button', title: 'retirer', onclick: (e) => { e.stopPropagation(); F[which] = null; changed(); paintSlot(which); } }, '×'));
  box.onclick = () => chooseImage(which);
}
async function chooseImage(which) {
  const [it] = await pick({ kinds: ['image', 'element'], multiple: false, title: which === 'start' ? 'Image de début' : 'Image de fin' });
  if (!it) return;
  const img = it.kind === 'element' ? await fromElement(it) : it;
  if (!img) return;
  S.items.set(img.id, img);
  F[which] = img.id;
  if (which === 'start' || !F.start) { F.canvas.i2v = 'auto'; F.fam.i2v = 'image'; }
  changed(); paintSlot(which);
}
// un élément comme image de départ : laquelle de ses images ? (le plein pied d'abord)
function fromElement(elem) {
  const rank = (r) => ({ 'full body': 0, face: 1, expression: 2 }[r] ?? 3);
  const refs = [...(elem.element?.refs || [])].sort((a, b) => rank(a.role) - rank(b.role));
  return new Promise((resolve) => {
    const close = (v) => { scrim.remove(); document.removeEventListener('keydown', esc); resolve(v); };
    const esc = (e) => { if (e.key === 'Escape') close(null); };
    const grid = el('div', { class: 'grid sm' }, ...refs.map((r) => {
      const b = el('button', { class: 'thumb', type: 'button', onclick: async () => {
        b.classList.add('pending');
        try { close(await api('movie/element-image', { method: 'POST', body: { element: elem.id, file: r.file } })); }
        catch (e) { toast(e.message); b.classList.remove('pending'); }
      } },
      el('div', { class: 'im' }, el('img', { src: href(r.thumb_url || r.url), alt: '' }), el('span', { class: 'kind element' }, ROLE_FR[r.role] || r.role || 'réf.')),
      el('div', { class: 'cap' }, el('div', { class: 't' }, r.label || ROLE_FR[r.role] || 'image'), el('div', { class: 's' }, r.width ? `${r.width}×${r.height}` : '')));
      return b;
    }));
    const scrim = el('div', { class: 'scrim picker' }, el('div', { class: 'modal', role: 'dialog', 'aria-label': 'image de départ' },
      el('div', { class: 'modal-head' }, el('span', { class: 't' }, `Quelle image de ${elem.title} ?`), el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', onclick: () => close(null) }, 'Annuler')),
      el('div', { class: 'modal-body' }, el('p', {}, 'Le plan partira exactement de cette image. Le plein pied montre le personnage entier, dans sa tenue.'),
        refs.length ? grid : el('p', { class: 'warn' }, 'cet élément n’a aucune image'))));
    document.addEventListener('keydown', esc);
    document.body.append(scrim);
  });
}

// ── Références nommées ──────────────────────────────────────
const KIND_PICK = { image: ['image', 'element'], video: ['video'], audio: ['audio'] };
$('#ref-kind').value = F.refKind;
$('#ref-kind').addEventListener('change', (e) => { F.refKind = e.target.value; save(); });
$('#ref-size').value = F.refSize;
$('#ref-size').addEventListener('change', (e) => { F.refSize = e.target.value; changed(); });
$('#ref-add').addEventListener('click', addRefs);
function nameFor(title) {
  let n = (title || 'ref').normalize('NFC').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'ref';
  const taken = new Set(F.refs.map((r) => r.name.toLowerCase()));
  let k = 2, base = n;
  while (taken.has(n.toLowerCase())) n = `${base}_${k++}`;
  return n;
}
async function addRefs() {
  const kind = F.refKind;
  const got = await pick({ kinds: KIND_PICK[kind], multiple: true, title: { image: 'Images et éléments', video: 'Vidéos de référence', audio: 'Sons de référence' }[kind] });
  for (const it of got) {
    S.items.set(it.id, it);
    if (F.refs.some((r) => r.item === it.id)) continue;
    const k = it.kind === 'element' || it.kind === 'image' ? 'image' : it.kind;
    const role = (S.opts?.roles[k] || [{ id: '' }])[0].id;
    F.refs.push({ item: it.id, name: nameFor(it.title), role: it.kind === 'element' && it.element?.type === 'place' ? 'location' : role, sound: false });
  }
  if (got.length) { changed(); paintRefs(); }
}
async function paintRefs() {
  const box = $('#refcards');
  const cards = [];
  for (const [i, r] of F.refs.entries()) {
    const it = await item(r.item);
    if (!it) continue;
    const k = it.kind === 'element' || it.kind === 'image' ? 'image' : it.kind;
    const tag = S.plan?.mentions?.[r.name];
    const pics = (S.plan?.pictures || []).filter((p) => p.item === it.id).map((p) => p.tag);
    const src = it.kind === 'element'
      ? `élément · ${etypeFr(it.element?.type)}${pics.length ? ' · ' + pics.join(' ') : ''}`
      : `${kindFr(it.kind)}${it.duration ? ' · ' + it.duration.toFixed(1) + ' s' : ''}${it.width ? ' · ' + it.width + '×' + it.height : ''}${pics.length ? ' · ' + pics.join(' ') : ''}`;
    const name = el('input', { class: 'fld', value: r.name, 'aria-label': 'nom de mention', spellcheck: 'false' });
    name.addEventListener('change', () => {
      const v = name.value.trim().replace(/^@/, '');
      if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(v) || F.refs.some((x, j) => j !== i && x.name.toLowerCase() === v.toLowerCase())) {
        name.value = r.name; toast('un nom unique : lettres, chiffres, _ ou -, sans espace'); return;
      }
      const old = r.name;
      r.name = v;
      const rx = new RegExp('@' + old.replace(/[-]/g, '\\-') + '(?=$|[^\\p{L}\\p{N}_-])', 'gu');
      for (const f of ['desc', 'sound']) F.p.r2v[f] = F.p.r2v[f].replace(rx, '@' + v);
      syncFields(); changed(); paintRefs();
    });
    const role = el('select', { class: 'fld', 'aria-label': 'utiliser comme' },
      ...(S.opts?.roles[k] || []).map((x) => el('option', { value: x.id }, x.label)));
    role.value = r.role;
    role.addEventListener('change', () => { r.role = role.value; changed(); });
    const snd = k === 'video' ? el('label', { class: 'check' + (it.audio ? '' : ' off') },
      el('input', { type: 'checkbox', checked: r.sound || null, disabled: it.audio ? null : true,
        onchange: (e) => { r.sound = e.target.checked; changed(); } }),
      it.audio ? 'utiliser aussi sa bande-son' : 'cette vidéo n’a pas de son') : null;
    cards.push(el('div', { class: 'refcard' + (it.kind === 'element' ? ' element' : '') },
      el('div', { class: 'rh' },
        el('span', { class: 'th', style: bg(it.thumb_url || (it.kind === 'image' ? it.url : null)) }, k === 'audio' ? el('span', { class: 'ico' }, '♪') : null),
        el('span', { class: 'rn' }, el('b', {}, '@' + r.name), el('span', { class: 'lbl' }, tag || '')),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { F.refs.splice(i, 1); changed(); paintRefs(); } }, 'Retirer')),
      el('span', { class: 'src' }, `${it.title} · ${src}`),
      el('div', { class: 'grid2' },
        el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'Nom de mention'), name),
        el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'Utiliser comme'), role)),
      snd));
  }
  box.replaceChildren(...cards);
  const L = S.opts?.limits;
  if (L) {
    const n = S.plan?.mode === 'r2v' ? S.plan : null;
    $('#ref-limits').textContent = `${n ? n.pictures.length : '—'} / ${L.image} images · ${n ? n.videos.length : '—'} / ${L.video} vidéos · ${n ? n.audios.length + n.videos.filter((v) => v.sound).length : '—'} / ${L.audio} sons · ${L.files} fichiers au plus. `
      + `Une bande-son de vidéo compte comme un son ; chaque vidéo ou son dure de ${L.min_seconds} à ${L.seconds} s, ${L.seconds} s par type. Un personnage envoie deux images : visage et plein pied.`;
  }
}

// ── le prompt : trois champs, mentions, caméra ──────────────
const PH = {
  t2v: 'Ce qu’on voit et entend, dans l’ordre. Ex. : [Shot 1] Live-action, cinematic. A lighthouse keeper climbs a spiral staircase at dawn; the camera tracks up with him at slow speed. The weathered man (S1) mutters: <d>[English] Not tonight.</d>',
  i2v: 'Ce qui se passe à partir de l’image : l’action, la caméra, une réplique. Ex. : The man shown in <Picture 1> slowly turns toward the lens and smiles; the camera pushes in with small amplitude at slow speed.',
  r2v: 'Le plan à composer : @nom pour chaque référence. Ex. : @MJ runs through a Paris street at night; a tracking shot follows him at fast speed, neon reflections on wet asphalt.',
};
const descEl = $('#desc'), soundEl = $('#sound'), musicEl = $('#music');
function syncFields() {
  const p = F.p[F.mode];
  descEl.value = p.desc; soundEl.value = p.sound; musicEl.value = p.music;
  paintWords();
}
function paintWords() {
  const n = F.p[F.mode].desc.trim() ? F.p[F.mode].desc.trim().split(/\s+/).length : 0;
  $('#words').textContent = `${n} mot${n > 1 ? 's' : ''} · visé 350–500`;
  $('#words').classList.toggle('low', n > 0 && n < 60);
}
descEl.addEventListener('input', () => { F.p[F.mode].desc = descEl.value; paintWords(); changed(); mention(); });
descEl.addEventListener('click', mention);
descEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#mention-menu').hidden = true; });
descEl.addEventListener('blur', () => setTimeout(() => { $('#mention-menu').hidden = true; }, 150));
soundEl.addEventListener('input', () => { F.p[F.mode].sound = soundEl.value; changed(); });
musicEl.addEventListener('input', () => { F.p[F.mode].music = musicEl.value; changed(); });

function insertAt(t, text, { select = null } = {}) {
  const a = t.selectionStart ?? t.value.length, b = t.selectionEnd ?? a;
  const pre = t.value.slice(0, a), post = t.value.slice(b);
  const pad = pre && !/\s$/.test(pre) ? ' ' : '';
  t.value = pre + pad + text + (post && !/^\s/.test(post) ? ' ' : '') + post;
  const at = (pre + pad).length;
  t.focus();
  if (select) t.setSelectionRange(at + select[0], at + select[1]); else t.setSelectionRange(at + text.length, at + text.length);
  t.dispatchEvent(new Event('input'));
}
// @ ouvre le menu des mentions (H3 Studio)
function mention() {
  const menu = $('#mention-menu');
  const before = descEl.value.slice(0, descEl.selectionStart);
  const m = before.match(/@([\p{L}\p{N}_-]*)$/u);
  if (F.mode !== 'r2v' || !m || !F.refs.length) { menu.hidden = true; return; }
  const list = F.refs.filter((r) => r.name.toLowerCase().startsWith(m[1].toLowerCase()));
  menu.replaceChildren(...list.map((r) => {
    const it = S.items.get(r.item);
    return el('button', { type: 'button', onmousedown: (e) => {
      e.preventDefault();
      const s = descEl.selectionStart - m[0].length;
      descEl.setRangeText('@' + r.name + ' ', s, descEl.selectionStart, 'end');
      menu.hidden = true; descEl.focus(); descEl.dispatchEvent(new Event('input'));
    } }, el('b', {}, '@' + r.name), ' ', el('span', { class: 'lbl' }, it ? (it.kind === 'element' ? etypeFr(it.element?.type) : kindFr(it.kind)) : ''));
  }));
  menu.hidden = !list.length;
}
// les étiquettes à glisser : les mentions (références), les images (début · fin)
function paintChips() {
  const pl = S.plan;
  const chips = F.mode === 'r2v' ? F.refs.map((r) => ({ ins: '@' + r.name, lab: pl?.mentions?.[r.name] || '' }))
    : F.mode === 'i2v' ? (pl?.pictures || []).map((p) => ({ ins: p.tag, lab: p.label })) : [];
  $('#chips').replaceChildren(...chips.map((c) => el('button', { class: 'chip', type: 'button', title: `insérer ${c.ins}`, onclick: () => insertAt(descEl, c.ins) },
    el('b', {}, c.ins), c.lab ? ' ' + c.lab : '')));
}
// la caméra : le vocabulaire contrôlé, écrit dans la phrase
const cam = { amp: '', speed: '' };
function segPick(id, cb) { $$(`#${id} .tb`).forEach((b) => b.addEventListener('click', () => { $$(`#${id} .tb`).forEach((x) => x.classList.toggle('on', x === b)); cb(b.dataset.v); })); }
segPick('cam-amp', (v) => { cam.amp = v; });
segPick('cam-speed', (v) => { cam.speed = v; });
function paintCamera() {
  $('#cam-chips').replaceChildren(...(S.opts?.camera || []).map((c) => el('button', { class: 'chip cam-chip', type: 'button', title: c.phrase,
    onclick: () => {
      const fixed = /Shake|Static|POV/.test(c.id);   // l'amplitude est dans le mot, ou n'a pas de sens
      insertAt(descEl, c.phrase + (fixed ? '' : cam.amp) + (/Static/.test(c.id) ? '' : cam.speed) + '.');
    } }, c.id)));
}
$('#h-say').addEventListener('click', () => insertAt(descEl, '(S1) says: <d>[French] …</d>', { select: [23, 24] }));
$('#h-excl').addEventListener('click', () => insertAt(descEl, 'No text, subtitles, logos or watermarks of any kind, keep the live-action texture.'));

// ── LoRA ────────────────────────────────────────────────────
async function loadLoras() {
  try {
    const r = await api('movie/loras');
    S.loras = r.loras; S.loraMachine = r.machine;
    $('#lora-count').textContent = r.loras.length ? `${r.loras.length} installés · ${r.machine}` : '';
    if (!r.loras.length) $('#loras').replaceChildren(el('span', { class: 'why' }, r.why || 'aucun LoRA H3 trouvé'));
  } catch (e) { $('#loras').replaceChildren(el('span', { class: 'why' }, e.message)); }
  paintLoras();
}
$('#lora-refresh').addEventListener('click', loadLoras);
function paintLoras() {
  if (!S.loras.length) return;
  const accel = S.loras.filter((l) => l.accel);
  put($('#loras'), ...S.loras.filter((l) => !l.accel).map((l) => {
    const st = F.loras[l.name] || (F.loras[l.name] = { on: false, strength: l.force });
    const fits = l.modes.includes(F.mode);
    const off = l.accel || !fits;
    if (off && st.on) { st.on = false; save(); }
    const force = el('input', { class: 'fld force', inputmode: 'decimal', value: st.strength, 'aria-label': 'force', disabled: off || null,
      onchange: (e) => { const v = parseFloat(e.target.value.replace(',', '.')); st.strength = isFinite(v) ? Math.max(0, Math.min(2, v)) : l.force; e.target.value = st.strength; changed(); } });
    return el('div', { class: 'lora' + (st.on ? ' on' : '') + (off ? ' off' : '') },
      el('label', { class: 'lh' },
        el('input', { type: 'checkbox', checked: st.on || null, disabled: off || null, onchange: (e) => { st.on = e.target.checked; changed(); paintLoras(); } }),
        el('b', {}, l.nom), force),
      el('span', { class: 'hint' }, l.accel ? 'accélérateur : la méthode « turbo » pose celui du banc' : l.note),
      !fits && !l.accel ? el('span', { class: 'why' }, `pas pour ce mode : ${l.modes.map((m) => MODE_FR[m]).join(', ')}`) : null,
      l.warn ? el('span', { class: 'warn-t' }, 'décision de Cal : exclu pour ses personnages') : null);
  }), accel.length ? el('details', { class: 'accel' },
    el('summary', {}, el('span', { class: 'lbl' }, `${accel.length} accélérateurs · la méthode « turbo » pose celui du banc`)),
    el('div', { class: 'accel-list' }, ...accel.map((l) => el('span', { title: l.name }, l.nom)))) : null);
}

// ── Sortie : toile, méthode, durée, pas, graine ─────────────
function paintOutput() {
  const o = S.opts, pl = S.plan;
  if (!o) return;
  const fams = (F.mode === 'i2v' && pl?.canvases?.[0]?.family === 'image' ? ['image'] : []).concat(o.families);
  if (!fams.includes(F.fam[F.mode])) F.fam[F.mode] = fams[0];
  const FAM_FR = { image: 'image', paysage: 'paysage', '21:9': '21:9', portrait: 'portrait', 'carré': 'carré' };
  $('#fam').replaceChildren(...fams.map((f) => el('button', { class: 'tb' + (F.fam[F.mode] === f ? ' on' : ''), type: 'button',
    onclick: () => { F.fam[F.mode] = f; save(); paintOutput(); } }, FAM_FR[f])));
  const rows = (pl?.canvases || o.canvases.map((c) => ({ ...c, estimate: null }))).filter((c) => c.family === F.fam[F.mode]);
  const cur = F.canvas[F.mode];
  $('#canvases').replaceChildren(...rows.map((c) => {
    const on = c.family === 'image' ? cur === 'auto' : Array.isArray(cur) && cur[0] === c.w && cur[1] === c.h;
    return el('button', { class: 'crow' + (on ? ' on' : ''), type: 'button', title: c.source, 'aria-pressed': on,
      onclick: () => { F.canvas[F.mode] = c.family === 'image' ? 'auto' : [c.w, c.h]; changed(); paintOutput(); } },
    el('span', {}, el('b', {}, c.label), ` · ${c.w}×${c.h}`), el('span', { class: 't' }, rng(c.estimate)));
  }));
  $('#method').replaceChildren(...o.methods.map((m) => el('option', { value: m.id }, m.label)));
  $('#method').value = F.method;
  $('#frames').replaceChildren(...o.frames.map((f) => el('option', { value: f.frames }, `${String(f.seconds).replace('.', ',')} s · ${f.frames} images`)));
  $('#frames').value = F.frames;
  const meth = o.methods.find((m) => m.id === F.method);
  const steps = pl?.steps;
  $('#step-presets').replaceChildren(...meth.steps.map((s, i) => el('button', { class: 'tb' + (Number(F.steps || steps) === s ? ' on' : ''), type: 'button',
    onclick: () => { F.steps = String(s); $('#steps').value = F.steps; changed(); paintOutput(); } },
  `${s}${F.method === 'turbo' ? (i ? ' · final' : ' · brouillon') : (i ? '' : ' · conseillé')}`)));
  $('#steps').value = F.steps;
  $('#steps').placeholder = steps ? `auto · ${steps}` : 'auto';
  $('#profile').replaceChildren(el('b', {}, `${meth.label}${steps ? ' · ' + steps + ' pas' : ''}`), el('span', {}, meth.note));
  $('#seed').value = F.seed;
  if (pl) $('#estimate').replaceChildren(el('b', {}, `Estimé ${pl.width}×${pl.height} : ${rng(pl.estimate)}`),
    el('span', { class: 'hint' }, `${pl.estimate.basis}. Chargement du modèle, image et son compris ; le premier rendu après un démarrage d’H3 est plus long.`));
}
$('#method').addEventListener('change', (e) => { F.method = e.target.value; F.steps = ''; changed(); paintOutput(); });
$('#frames').addEventListener('change', (e) => { F.frames = Number(e.target.value); changed(); });
$('#steps').addEventListener('input', (e) => { F.steps = e.target.value.replace(/[^0-9]/g, ''); if (e.target.value !== F.steps) e.target.value = F.steps; changed(); });
$('#seed').addEventListener('input', (e) => { F.seed = e.target.value.replace(/[^0-9]/g, ''); if (e.target.value !== F.seed) e.target.value = F.seed; changed(); });
$('#seed-rand').addEventListener('click', () => { F.seed = String(Math.floor(Math.random() * 2 ** 31)); $('#seed').value = F.seed; changed(); });

// ── réglages avancés ────────────────────────────────────────
function paintAdv() {
  const o = S.opts;
  if (!o) return;
  const w = o.modes.find((m) => m.id === F.mode).weights;
  const a = F.adv;
  const sel = (id, list, cur) => { const s = $(id); s.replaceChildren(...list.map((x) => el('option', { value: x.v, title: x.t || '' }, x.n))); s.value = cur ?? list[0].v; };
  sel('#a-unet', o.unets[w].map((u) => ({ v: u.f, n: u.nom, t: u.note })), a['unet_' + w]);
  sel('#a-sampler', o.samplers.map((s) => ({ v: s, n: s })), a.sampler);
  sel('#a-scheduler', o.schedulers.map((s) => ({ v: s, n: s + (s === 'simple' ? ' · R5' : '') })), a.scheduler);
  $('#a-crf').value = a.crf || '';
}
$('#a-unet').addEventListener('change', (e) => { F.adv['unet_' + S.opts.modes.find((m) => m.id === F.mode).weights] = e.target.value; changed(); });
$('#a-sampler').addEventListener('change', (e) => { F.adv.sampler = e.target.value; changed(); });
$('#a-scheduler').addEventListener('change', (e) => { F.adv.scheduler = e.target.value; changed(); });
$('#a-crf').addEventListener('input', (e) => { F.adv.crf = e.target.value.replace(/[^0-9]/g, ''); changed(); });

function params(mode = F.mode) {
  const p = F.p[mode];
  const w = S.opts?.modes.find((m) => m.id === mode)?.weights;
  const out = {
    desc: p.desc, sound: p.sound, music: p.music, method: F.method, frames: F.frames,
    steps: F.steps ? Number(F.steps) : null, seed: F.seed === '' ? null : Number(F.seed),
    canvas: F.canvas[mode],
    loras: S.loras.filter((l) => F.loras[l.name]?.on && l.modes.includes(mode) && !l.accel).map((l) => ({ name: l.name, strength: F.loras[l.name].strength })),
    adv: { unet: F.adv['unet_' + w], sampler: F.adv.sampler, scheduler: F.adv.scheduler, crf: F.adv.crf || null },
  };
  if (mode === 'i2v') { out.start = F.start; out.end = F.end; }
  if (mode === 'r2v') { out.refs = F.refs.map((r) => ({ ...r })); out.ref_image_size = F.refSize; }
  return out;
}

// ── le plan résolu par le serveur ───────────────────────────
let planT = null;
function schedulePlan() { clearTimeout(planT); planT = setTimeout(runPlan, 220); }
async function runPlan() {
  const seq = ++S.seq, mode = F.mode;
  try {
    const pl = await api('movie/plan', { method: 'POST', body: { mode, params: params(mode), graph: $('#adv').open } });
    if (seq !== S.seq || mode !== F.mode) return;
    S.plan = pl;
    paintPlan();
  } catch (e) { $('#why').replaceChildren(el('div', {}, 'le portail ne répond pas : ' + e.message)); $('#go').disabled = true; }
}
$('#adv').addEventListener('toggle', () => { if ($('#adv').open) runPlan(); });
const FIX = [   // chaque blocage mène à ce qui le lève
  [/première image, une dernière/, () => chooseImage('start')],
  [/ajoutez une référence/, () => addRefs()],
  [/mentionnez/, (e) => { const m = e.match(/@[\p{L}\p{N}_-]+/gu) || []; insertAt(descEl, m.join(' ')); }],
  [/description|déclencheur/, () => descEl.focus()],
];
function paintPlan() {
  const pl = S.plan;
  $('#why').replaceChildren(...pl.errors.map((e) => {
    const fix = FIX.find(([rx]) => rx.test(e));
    return el('div', { class: fix ? 'fix' : '', role: fix ? 'button' : null, tabindex: fix ? 0 : null, onclick: fix ? () => fix[1](e) : null }, e);
  }));
  $('#go').disabled = !pl.ok;
  $('#go').textContent = pl.ok ? `Générer · ${pl.width}×${pl.height} · ${String(pl.seconds.toFixed(1)).replace('.', ',')} s →` : 'Générer la vidéo →';
  $('#notes').replaceChildren(...pl.notes.map((n) => el('div', {}, n)));
  $('#sent').textContent = pl.prompt_sent || '';
  $('#graph').textContent = pl.graph ? JSON.stringify(pl.graph, null, 1) : (pl.ok ? 'ouvrez ce panneau pour le construire' : 'le graphe se construit quand le plan est complet');
  $('#format-hint').textContent = pl.raw ? 'prompt déjà au format H3 : il part tel quel.'
    : F.mode === 'r2v' ? 'À l’envoi : six sections (subject_definitions, summary, retention_analysis, detailed_description, son, musique) ; les @noms deviennent <Subject n>, <Video n>, <Audio n>.'
      : 'À l’envoi : integrated_multimodal_description, overall_soundscape, non_diegetic_music' + (F.mode === 'i2v' ? ', et la ligne d’ancrage des images avec la durée.' : '.');
  paintChips();
  paintOutput();
  if (F.mode === 'r2v') paintRefs();
}
$('#go').addEventListener('click', launch);
async function launch() {
  const pl = S.plan;
  if (!pl?.ok) return;
  const mode = F.mode;
  $('#go').disabled = true;
  try {
    const title = (F.p[mode].desc.replace(/@([\p{L}\p{N}_-]+)/gu, '$1').trim().replace(/\s+/g, ' ') || MODE_FR[mode]).slice(0, 70);
    const j = await jobs.submit('movie.' + mode, params(mode), { title, tool: 'movie' });
    S.myJobs.add(j.id); store.set('movie.myjobs', [...S.myJobs].slice(-40));
    S.watch = j.id;
    S.jobs = [j, ...S.jobs.filter((x) => x.id !== j.id)];
    S.cur = null;   // la scène montre le plan qui se fabrique ; le précédent reste dans les vidéos
    paintStage(); paintResult(); paintLib(); syncUrl();
    paintProgress();
    toast(pl.engine === 'h3' ? 'rendu en file : H3 démarre s’il dort' : 'rendu en file · moteur factice : une vidéo d’essai');
  } catch (e) { toast(e.message); }
  finally { $('#go').disabled = !S.plan?.ok; }
}

// ── le moteur ───────────────────────────────────────────────
async function paintEngine() {
  const pill = $('#engine-pill');
  try { S.h3 = await api('movie/h3'); } catch { S.h3 = null; }
  const h = S.h3;
  let cls = 'pill', txt = 'moteur illisible', tip = '';
  if (h?.engine === 'factice') { cls = 'pill work'; txt = 'moteur factice · pas H3'; tip = 'une vidéo d’essai (mire, vos images, un bip) : le câblage d’H3 vient ensuite'; }
  else if (h) {
    const up = h.instances.filter((i) => i.up), st = h.instances.find((i) => i.starting_for != null);
    cls = 'pill ' + (up.length ? 'on' : st ? 'work' : '');
    txt = up.length ? `H3 prêt · ${up.map((i) => i.machine).join(' + ')}` : st ? `H3 démarre · ${st.machine}` : 'H3 dort · démarre au rendu';
    tip = up.map((i) => `${i.machine} : ${Math.round(i.free_gb ?? 0)} Go libres${i.stops_in != null ? ` · s’arrête dans ${mmss(i.stops_in)}` : ''}`).join('\n');
  }
  pill.className = cls; pill.lastChild.textContent = txt; pill.title = tip;
}

// ── l'espace de travail ─────────────────────────────────────
let stageKey = '';
async function paintStage() {
  const box = $('#stage');
  const it = S.cur ? await item(S.cur) : null;
  const j = S.jobs.find((x) => x.id === S.watch && ['queued', 'running'].includes(x.state));
  const key = it ? 'v' + it.id : j ? 'j' + j.id : 'vide';
  if (key === stageKey) return;
  stageKey = key;
  if (it) {
    box.replaceChildren(el('video', { src: href(it.url), poster: it.thumb_url ? href(it.thumb_url) : null, controls: true, loop: true, playsinline: true, preload: 'metadata' }),
      el('div', { class: 'badges' },
        it.params?.mode ? el('span', { class: 'badge' }, `${MODE_FR[it.params.mode]} · ${METH_FR[it.params.method] || ''}`) : null,
        it.audio ? el('span', { class: 'badge snd' }, 'son') : el('span', { class: 'badge' }, 'muet'),
        it.params?.engine === 'factice' ? el('span', { class: 'badge fake' }, 'factice') : null));
  } else if (j) {
    put(box, j.thumb ? el('img', { class: 'poster', src: href(j.thumb), alt: '' }) : null,
      el('div', { class: 'empty' }, el('b', {}, 'Le plan se fabrique'), el('span', {}, 'il s’affichera ici, et dans les vidéos générées')));
  } else {
    box.replaceChildren(el('div', { class: 'empty' }, el('span', { class: 'play' }, '▶'), el('b', {}, 'Votre vidéo s’affichera ici'),
      el('span', {}, 'choisissez un mode, décrivez la scène et le son, générez : la progression et le plan restent ici')));
  }
}
function show(id) { S.cur = id; stageKey = ''; paintStage(); paintResult(); paintLib(); setFocus('result'); syncUrl(); }

function paintProgress() {
  const j = S.jobs.find((x) => x.id === S.watch) || S.jobs.find((x) => ['queued', 'running'].includes(x.state));
  const lab = $('#st-label'), pct = $('#st-pct'), bar = $('#st-bar'), el_ = $('#st-elapsed'), left = $('#st-left'), q = $('#st-queue');
  const cancel = $('#st-cancel');
  if (!j) { lab.textContent = 'rien en cours'; pct.textContent = '—'; bar.firstChild.style.width = '0%'; bar.classList.remove('busy');
    el_.textContent = '—'; left.textContent = 'restant : —'; q.textContent = queueText(); cancel.hidden = true; return; }
  const run = j.state === 'running', wait = j.state === 'queued';
  const p = j.progress;
  lab.textContent = run ? (j.message || 'en cours') : wait ? (j.message || 'en file') : j.state === 'done' ? `fini · ${j.result?.note || ''}`
    : j.state === 'error' ? 'échec : ' + (j.message || '') : j.state === 'cancelled' ? 'arrêté' : j.message || j.state;
  lab.classList.toggle('err', j.state === 'error');
  pct.textContent = p != null ? Math.round(p * 100) + ' %' : run ? '…' : wait ? 'en file' : '—';
  bar.firstChild.style.width = (p != null ? p * 100 : j.state === 'done' ? 100 : 0) + '%';
  bar.classList.toggle('busy', run && p == null);
  const t0 = j.started ? Date.parse(j.started) : null, t1 = j.finished ? Date.parse(j.finished) : Date.now();
  const elapsed = t0 ? (t1 - t0) / 1000 : null;
  el_.textContent = elapsed != null ? `écoulé : ${mmss(elapsed)}` : 'pas encore commencé';
  const est = j.estimate || j.params?.estimate;
  let rest = null;
  if (run && p > 0.2 && elapsed) rest = (elapsed * (1 - p)) / p;
  else if (run && est && elapsed != null) rest = (est.low + est.high) / 2 - elapsed;
  left.textContent = !run ? (j.state === 'done' ? 'restant : 0 s' : 'restant : —') : rest != null ? (rest > 0 ? `restant ≈ ${mmss(rest)}` : 'estimation dépassée · ça continue') : 'restant : —';
  q.textContent = queueText(j);
  cancel.hidden = !(run || wait);
  cancel.onclick = () => jobs.cancel(j.id).then(() => toast('rendu arrêté'));
}
function queueText(j) {
  const active = S.allJobs?.filter((x) => (x.lane === 'h3' || x.kind?.startsWith('movie.')) && ['queued', 'running'].includes(x.state)) || [];
  if (!j) return `file : ${active.length ? active.length + ' rendu' + (active.length > 1 ? 's' : '') + ' vidéo' : 'vide'}`;
  if (j.state === 'running') return `file : rendu en cours${j.machine ? ' sur ' + j.machine : ''} · ${active.length} travail${active.length > 1 ? 'x' : ''} vidéo en tout`;
  if (j.state === 'queued') { const ahead = active.filter((x) => x.id !== j.id && Date.parse(x.created) <= Date.parse(j.created)).length; return `file : ${ahead} devant`; }
  return 'file : —';
}

async function paintResult() {
  const card = $('#result-card');
  const it = S.cur ? await item(S.cur) : null;
  card.hidden = !it;
  if (!it) return;
  const p = it.params || {};
  $('#res-title').textContent = it.prompt || it.title;
  $('#res-meta').textContent = [it.width && `${it.width}×${it.height}`, it.duration && `${it.duration.toFixed(1)} s`, it.render_seconds != null && `rendu ${mmss(it.render_seconds)}`, fmtDate(it.created)].filter(Boolean).join(' · ');
  $('#res-pin').textContent = it.fav ? 'Épinglée ★' : 'Épingler';
  $('#res-pin').onclick = async () => { const n = await api('library/' + it.id, { method: 'POST', body: { fav: !it.fav } }); S.items.set(n.id, n); S.lib = S.lib.map((x) => (x.id === n.id ? n : x)); paintResult(); paintLib(); };
  $('#res-details').onclick = () => details(it);
  $('#res-dl').href = href(it.url);
  $('#res-dl').setAttribute('download', `${(it.title || it.id).slice(0, 40).replace(/[^\p{L}\p{N}_-]+/gu, '_')}.mp4`);
  const del = $('#res-del');
  del.textContent = 'Supprimer';
  del.onclick = async () => {
    if (!del.dataset.arm) { del.dataset.arm = '1'; del.textContent = 'Confirmer : à la corbeille'; setTimeout(() => { delete del.dataset.arm; del.textContent = 'Supprimer'; }, 4000); return; }
    delete del.dataset.arm;
    try { await api(`library/${it.id}/delete`, { method: 'POST' }); toast('à la corbeille de la bibliothèque (elle peut en revenir)'); S.cur = null; S.items.delete(it.id); await loadLib(); show(S.lib[0]?.id || null); }
    catch (e) { toast(e.message); }
  };
  void p;
}

// la recette d'une vidéo, lisible
function recipeRows(it) {
  const p = it.params || {};
  const o = S.opts;
  const unet = o && p.weights ? (o.unets[p.weights]?.find((u) => u.f === p.unet)?.nom || p.unet) : p.unet;
  return [
    ['Mode', MODE_FR[p.mode]],
    ['Méthode', p.method ? `${o?.methods.find((m) => m.id === p.method)?.label || p.method}` : null],
    ['Toile', it.width ? `${it.width} × ${it.height}${p.family ? ' · ' + p.family : ''}` : null],
    ['Durée', it.duration ? `${it.duration.toFixed(2)} s${p.frames ? ` · ${p.frames} images` : ''}${it.fps ? ` · ${it.fps} i/s` : ''}` : null],
    ['Pas', p.steps], ['Graine', p.seed],
    ['Sampler', p.sampler ? `${p.sampler} · ${p.scheduler}` : null],
    ['Modèle', unet],
    ['LoRA', p.method !== undefined ? [...(p.loras || []).map((l) => `${l.name.split('/').pop().replace('.safetensors', '')} × ${l.strength}`), p.turbo ? 'turbo du banc' : null].filter(Boolean).join(' + ') || 'aucun' : null],
    ['Références', p.mode === 'r2v' ? (p.refs || []).map((r) => `@${r.name} → ${p.mentions?.[r.name] || '?'} (${r.role})`).join(' · ') + ` · détail ${p.ref_image_size}` : null],
    ['Images', p.mode === 'i2v' ? [p.start ? 'début' : null, p.end ? 'fin' : null].filter(Boolean).join(' + ') : null],
    ['Son', it.audio ? 'oui, rendu avec l’image' : 'non'],
    ['Moteur', p.engine === 'factice' ? 'factice · vidéo d’essai, pas H3' : it.origin?.model || it.origin?.tool],
    ['Rendu', it.render_seconds != null ? `${mmss(it.render_seconds)}${it.machine ? ' · ' + it.machine : ''}${p.estimate ? ` (estimé H3 ${rng(p.estimate)})` : ''}` : null],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');
}
function details(it) {
  const p = it.params || {};
  const close = () => { scrim.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const scrim = el('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) close(); } },
    el('div', { class: 'modal lg', role: 'dialog', 'aria-label': 'réglages de la vidéo' },
      el('div', { class: 'modal-head' }, el('span', { class: 't' }, 'Réglages de la vidéo'), el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', onclick: close }, 'Fermer')),
      el('div', { class: 'modal-body' },
        el('p', { class: 'ttl' }, it.prompt || it.title),
        el('dl', { class: 'kv' }, ...recipeRows(it).flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, String(v))])),
        p.sound ? el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'Son demandé'), el('p', {}, p.sound)) : null,
        p.music ? el('div', { class: 'field' }, el('span', { class: 'lbl' }, 'Musique'), el('p', {}, p.music)) : null,
        p.prompt_sent ? el('details', { class: 'sentbox', open: true }, el('summary', { class: 'lbl' }, 'Le prompt envoyé à H3'), el('pre', { class: 'sent' }, p.prompt_sent)) : null,
        p.graph ? el('details', { class: 'sentbox' }, el('summary', { class: 'lbl' }, 'Le graphe H3'), el('pre', { class: 'sent' }, JSON.stringify(p.graph, null, 1))) : null),
      el('div', { class: 'modal-foot' },
        p.mode ? el('button', { class: 'tb ghost', onclick: () => { close(); reuse(it); } }, 'Reprendre ces réglages') : null,
        el('button', { class: 'tb ghost', onclick: () => { close(); S.A = it.id; if (S.B === it.id) S.B = null; setView('cmp'); } }, 'Comparer'),
        el('span', { class: 'sp' }), el('span', { class: 'lbl' }, fmtDate(it.created)))));
  document.addEventListener('keydown', esc);
  document.body.append(scrim);
}
function reuse(it) {
  const p = it.params || {};
  F.p[p.mode] = { desc: p.desc ?? it.prompt ?? '', sound: p.sound || '', music: p.music || '' };
  F.method = p.method || 'turbo'; F.frames = p.frames || 124; F.seed = p.seed != null ? String(p.seed) : ''; F.steps = p.steps ? String(p.steps) : '';
  F.canvas[p.mode] = p.family === 'image' ? 'auto' : [p.width, p.height];
  F.fam[p.mode] = p.family || 'paysage';
  if (p.mode === 'i2v') { F.start = p.start || null; F.end = p.end || null; }
  if (p.mode === 'r2v') { F.refs = (p.refs || []).map((r) => ({ item: r.item, name: r.name, role: r.role, sound: !!r.sound })); F.refSize = p.ref_image_size || 'match'; $('#ref-size').value = F.refSize; }
  for (const k of Object.keys(F.loras)) F.loras[k].on = false;
  for (const l of p.loras || []) F.loras[l.name] = { on: true, strength: l.strength };
  if (p.weights) F.adv['unet_' + p.weights] = p.unet;
  F.adv.sampler = p.sampler; F.adv.scheduler = p.scheduler; F.adv.crf = p.crf && p.crf !== 19 ? String(p.crf) : '';
  if (S.view !== 'create') setView('create');
  setMode(p.mode);
  setFocus('create');
  toast('réglages repris, graine comprise : videz la graine pour une variante');
}

// ── les vidéos générées (la bibliothèque) ───────────────────
async function loadLib() {
  const q = S.libAll === 'all' ? 'library?kind=video&limit=500' : 'library?kind=video&tool=movie&limit=500';
  try { const r = await api(q); S.lib = r.items; for (const it of r.items) S.items.set(it.id, it); }
  catch (e) { S.lib = []; toast(e.message); }
  paintLib();
}
$$('#lib-seg .tb').forEach((b) => {
  b.classList.toggle('on', b.dataset.h === S.libAll);
  b.addEventListener('click', () => { S.libAll = b.dataset.h; store.set('movie.lib', S.libAll); $$('#lib-seg .tb').forEach((x) => x.classList.toggle('on', x === b)); S.libShown = 8; loadLib(); });
});
$('#lib-more').addEventListener('click', () => { S.libShown += 8; paintLib(); });
function paintLib() {
  const cmp = S.view === 'cmp';
  const list = S.lib.slice(0, S.libShown);
  $('#lib-count').textContent = `${S.lib.length} vidéo${S.lib.length > 1 ? 's' : ''}`;
  $('#vgrid').replaceChildren(...(list.length ? list.map((it) => vcard(it, cmp)) : [el('div', { class: 'vempty' },
    S.libAll === 'all' ? 'aucune vidéo dans la bibliothèque : déposez un mp4 sur la page, ou générez-en une'
      : 'vos rendus arriveront ici, avec leur recette ; ils restent dans la bibliothèque jusqu’à leur suppression')]));
  $('#lib-more').hidden = S.lib.length <= S.libShown;
  $('#lib-more').textContent = `Voir plus · ${S.lib.length - S.libShown} autres`;
}
function vcard(it, cmp) {
  const p = it.params || {};
  const sel = !cmp && S.cur === it.id;
  const ab = (k) => el('button', { type: 'button', class: 'abk' + (S[k] === it.id ? ' is' + k : ''), title: `charger en ${k}`, onclick: (e) => { e.stopPropagation(); assign(k, it.id); } }, k);
  return el('div', { class: 'vcard' + (sel ? ' sel' : '') + (S.A === it.id ? ' selA' : '') + (S.B === it.id ? ' selB' : '') + (it.fav ? ' pinned' : '') },
    el('button', { class: 'vopen', type: 'button', title: it.prompt || it.title, onclick: () => (cmp ? assign(S.A ? 'B' : 'A', it.id) : show(it.id)) },
      el('span', { class: 'vm', style: bg(it.thumb_url) },
        it.duration ? el('span', { class: 'dur' }, it.duration.toFixed(1) + ' s') : null,
        it.fav ? el('span', { class: 'pin' }, '★') : null,
        p.engine === 'factice' ? el('span', { class: 'fk' }, 'factice') : null),
      el('span', { class: 'vl' }, el('span', { class: 't' }, it.title || it.id),
        el('span', { class: 's' }, [fmtDate(it.created), it.render_seconds != null ? 'rendu ' + mmss(it.render_seconds) : null, p.mode ? MODE_FR[p.mode] : null].filter(Boolean).join(' · ')))),
    cmp ? el('span', { class: 'abs' }, ab('A'), ab('B'))
      : el('button', { class: 'vdet', type: 'button', onclick: () => details(it) }, 'Détails'));
}

// ── la file ─────────────────────────────────────────────────
let jobsKey = '';
jobs.watch((list) => {
  S.allJobs = list;
  S.jobs = list.filter((j) => j.tool === 'movie');
  const key = S.jobs.map((j) => `${j.id}:${j.state}:${j.progress}:${j.message}`).join('|');
  if (key === jobsKey) return;
  jobsKey = key;
  if (!S.watch) S.watch = S.jobs.find((j) => ['queued', 'running'].includes(j.state))?.id || null;
  paintProgress();
  paintStage();
});
document.addEventListener('sr:job', async (e) => {
  const j = e.detail;
  if (j.tool !== 'movie') return;
  if (j.state === 'done') {
    await loadLib();
    if (j.id === S.watch && j.result?.items?.[0] && S.view === 'create') show(j.result.items[0]);
    toast(`vidéo prête · ${j.message || ''}`);
  } else if (j.state === 'error') toast('échec : ' + (j.message || '').slice(0, 160));
  paintProgress();
});
setInterval(() => { if (S.jobs.some((j) => j.state === 'running')) paintProgress(); }, 1000);   // l'écoulé avance

// ── le banc A/B (repris du banc NL de Cal) ──────────────────
const vA = $('#vA'), vB = $('#vB'), mon = $('#monitor'), layA = $('#layA'), layB = $('#layB'), handle = $('#handle');
const zsA = $('#zsA'), zsB = $('#zsB'), scrub = $('#scrub'), fill = $('#fill');
const BS = { mode: store.get('movie.bench.mode', 'wipe'), listen: 'a', zoom: 1, pan: { x: 0, y: 0 }, loop: store.get('movie.bench.loop', true),
  speed: 1, wipe: 50, blinkT: null, seeking: false, volume: 1 };
function assign(k, id) { S[k] = id; if (S.view !== 'cmp') setView('cmp'); else { benchLoad(); paintLib(); syncUrl(); } }
function paintSlots() {
  for (const k of ['A', 'B']) {
    const it = S[k] ? S.items.get(S[k]) : null;
    const p = it?.params || {};
    $('#slot-' + k.toLowerCase()).replaceChildren(
      el('div', { class: 'th', style: bg(it?.thumb_url) }, el('b', {}, k)),
      el('div', { class: 'ab-txt' }, el('span', { class: 't' }, it ? (it.title || it.id) : 'aucun plan'),
        el('span', { class: 'lbl' }, it ? [p.mode ? MODE_FR[p.mode] : null, p.method || null, it.width ? `${it.width}×${it.height}` : null].filter(Boolean).join(' · ') : 'à choisir')),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: () => chooseAB(k) }, 'Choisir'));
  }
}
async function chooseAB(k) { const [it] = await pick({ kinds: ['video'], multiple: false, title: `Plan ${k}` }); if (it) { S.items.set(it.id, it); assign(k, it.id); } }
const master = () => (vA.getAttribute('src') ? vA : vB);
const both = () => [vA, vB].filter((v) => v.getAttribute('src'));
function minDur() { const ds = both().filter((v) => isFinite(v.duration)).map((v) => v.duration); return ds.length ? Math.min(...ds) : 0; }
function fpsOf() { const a = S.items.get(S.A), b = S.items.get(S.B); return (a && a.fps) || (b && b.fps) || 24; }
async function benchLoad() {
  const [a, b] = [await item(S.A), await item(S.B)];
  const t = vA.currentTime || 0;
  for (const [v, it] of [[vA, a], [vB, b]]) {
    const src = it?.url ? href(it.url) : null;
    if (src && v.getAttribute('src') !== src) { v.setAttribute('src', src); v.load(); }
    else if (!src && v.getAttribute('src')) { v.removeAttribute('src'); v.load(); }
    v.playbackRate = BS.speed;
  }
  $('#tagA').textContent = a ? (a.title || a.id) : '—';
  $('#tagB').textContent = b ? (b.title || b.id) : '—';
  $('#benchEmpty').hidden = !!(a || b);
  applyAudio();
  const once = (v) => v.addEventListener('loadedmetadata', () => { seekBoth(Math.min(t, minDur())); updateTime(); }, { once: true });
  once(vA); once(vB);
  paintMetas(a, b); paintSlots(); setBenchMode(BS.mode);
}
function seekBoth(t) { BS.seeking = true; both().forEach((v) => { try { v.currentTime = t; } catch { /* pas prête */ } }); setTimeout(() => { BS.seeking = false; }, 30); }
async function play() { const vs = both(); if (!vs.length) return; try { await Promise.all(vs.map((v) => v.play())); } catch { /* geste requis */ } setPlayIcon(); }
function pauseBench() { both().forEach((v) => v.pause()); setPlayIcon(); }
const playing = () => { const m = master(); return m && !m.paused && !m.ended; };
function setPlayIcon() { $('#icoPlay').innerHTML = playing() ? '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>' : '<path d="M7 4l13 8-13 8z"/>'; }
$('#bPlay').addEventListener('click', () => (playing() ? pauseBench() : play()));
setInterval(() => { if (!playing() || BS.seeking) return; const m = master(), o = m === vA ? vB : vA; if (o.getAttribute('src') && isFinite(o.duration) && Math.abs(o.currentTime - m.currentTime) > 0.06) o.currentTime = m.currentTime; }, 200);
[vA, vB].forEach((v) => {
  v.addEventListener('ended', () => { if (v !== master()) return; if (BS.loop) { seekBoth(0); play(); } else pauseBench(); });
  v.addEventListener('timeupdate', updateTime); v.addEventListener('play', setPlayIcon); v.addEventListener('pause', setPlayIcon);
});
function updateTime() {
  const m = master(); if (!m) return;
  const t = m.currentTime || 0, d = minDur() || m.duration || 0, fps = fpsOf();
  $('#tc').firstChild.nodeValue = tcode(t);
  $('#frameNo').textContent = `img ${Math.round(t * fps)} / ${Math.round(d * fps)}`;
  $('#readout').textContent = tcode(t); $('#tlL').textContent = tcode(t); $('#tlR').textContent = tcode(d);
  if (!scrub.matches(':active')) scrub.value = d ? Math.round((t / d) * 1000) : 0;
  fill.style.width = (d ? (t / d) * 100 : 0) + '%';
}
scrub.addEventListener('input', () => { seekBoth((scrub.value / 1000) * minDur()); updateTime(); });
function step(n) { pauseBench(); const m = master(); if (!m) return; seekBoth(Math.max(0, Math.min(minDur(), m.currentTime + n / fpsOf()))); updateTime(); }
$('#bPrev').addEventListener('click', () => step(-1));
$('#bNext').addEventListener('click', () => step(1));
$('#bLoop').classList.toggle('on', BS.loop);
$('#bLoop').addEventListener('click', () => { BS.loop = !BS.loop; $('#bLoop').classList.toggle('on', BS.loop); store.set('movie.bench.loop', BS.loop); });
$('#bSwap').addEventListener('click', () => { [S.A, S.B] = [S.B, S.A]; benchLoad(); paintLib(); syncUrl(); });
function seg(id, attr, cb) { $$(`#${id} .tb`).forEach((b) => b.addEventListener('click', () => { $$(`#${id} .tb`).forEach((x) => x.classList.remove('on')); b.classList.add('on'); cb(b.dataset[attr]); })); }
seg('segSpeed', 'v', (v) => { BS.speed = +v; vA.playbackRate = vB.playbackRate = BS.speed; });
seg('segMode', 'm', (m) => setBenchMode(m));
seg('segAudio', 'a', (a) => { BS.listen = a; applyAudio(); });
seg('segZoom', 'z', (z) => zoomAt(+z, null, null));
$('#vol').addEventListener('input', (e) => { BS.volume = e.target.value / 100; vA.volume = vB.volume = BS.volume; });
function setBenchMode(m) {
  BS.mode = m; mon.className = 'monitor mode-' + m; clearInterval(BS.blinkT);
  layA.style.visibility = layB.style.visibility = '';
  if (m === 'blink') { let on = false; BS.blinkT = setInterval(() => { on = !on; layB.style.visibility = on ? 'visible' : 'hidden'; layA.style.visibility = on ? 'hidden' : 'visible'; }, 500); }
  if (m === 'wipe') setWipe(BS.wipe); else layB.style.clipPath = '';   // le rideau pose un découpage en ligne
  $$('#segMode .tb').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
  store.set('movie.bench.mode', m);
}
function applyAudio() {
  const hasA = !!vA.getAttribute('src'), hasB = !!vB.getAttribute('src');
  let src = BS.listen;
  if (src === 'a' && !hasA && hasB) src = 'b';
  if (src === 'b' && !hasB && hasA) src = 'a';
  vA.muted = !(src === 'a' && hasA); vB.muted = !(src === 'b' && hasB);
  vA.volume = vB.volume = BS.volume;
  $('#spkA').classList.toggle('on', !vA.muted); $('#spkB').classList.toggle('on', !vB.muted);
  $$('#segAudio .tb').forEach((b) => b.classList.toggle('on', b.dataset.a === BS.listen));
}
function setWipe(p) { BS.wipe = Math.max(0, Math.min(100, p)); layB.style.clipPath = `inset(0 0 0 ${BS.wipe}%)`; handle.style.left = BS.wipe + '%'; handle.setAttribute('aria-valuenow', Math.round(BS.wipe)); }
const ZMIN = 1, ZMAX = 12;   // zoom continu ancré sous le curseur : le point visé ne bouge pas
function zoomAt(nz, cx, cy) {
  nz = Math.max(ZMIN, Math.min(ZMAX, nz));
  const r = mon.getBoundingClientRect();
  if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
  BS.pan.x = cx - (cx - BS.pan.x) * (nz / BS.zoom); BS.pan.y = cy - (cy - BS.pan.y) * (nz / BS.zoom); BS.zoom = nz;
  if (BS.zoom <= ZMIN + 1e-4) { BS.zoom = ZMIN; BS.pan = { x: 0, y: 0 }; }
  applyZoom();
  const z = BS.zoom;
  $('#zoomBadge').hidden = z <= ZMIN + 1e-4;
  $('#zoomBadge').textContent = `zoom ${z < 10 ? z.toFixed(z % 1 ? 1 : 0) : Math.round(z)}× · glisser pour déplacer`;
  $$('#segZoom .tb').forEach((b) => b.classList.toggle('on', Math.abs(+b.dataset.z - z) < 0.02));
}
function applyZoom() {
  const r = mon.getBoundingClientRect();
  BS.pan.x = Math.max(-r.width * (BS.zoom - 1), Math.min(0, BS.pan.x)); BS.pan.y = Math.max(-r.height * (BS.zoom - 1), Math.min(0, BS.pan.y));
  zsA.style.transform = zsB.style.transform = `translate(${BS.pan.x.toFixed(2)}px, ${BS.pan.y.toFixed(2)}px) scale(${BS.zoom})`;
  mon.style.cursor = BS.zoom > 1 ? 'grab' : '';
}
mon.addEventListener('wheel', (e) => { e.preventDefault(); const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? mon.clientHeight : 1; const r = mon.getBoundingClientRect(); zoomAt(BS.zoom * Math.exp(-e.deltaY * unit * 0.0022), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
let drag = null;
mon.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const r = mon.getBoundingClientRect();
  const onHandle = BS.mode === 'wipe' && Math.abs(e.clientX - (r.left + (r.width * BS.wipe) / 100)) < 16;
  if (onHandle) drag = { k: 'wipe' };
  else if (BS.zoom > 1) drag = { k: 'pan', x: e.clientX - BS.pan.x, y: e.clientY - BS.pan.y };
  else if (BS.mode === 'wipe') { drag = { k: 'wipe' }; setWipe(((e.clientX - r.left) / r.width) * 100); }
  if (drag) { mon.setPointerCapture(e.pointerId); e.preventDefault(); if (drag.k === 'pan') mon.style.cursor = 'grabbing'; }
});
mon.addEventListener('pointermove', (e) => { if (!drag) return; const r = mon.getBoundingClientRect(); if (drag.k === 'wipe') setWipe(((e.clientX - r.left) / r.width) * 100); else { BS.pan.x = e.clientX - drag.x; BS.pan.y = e.clientY - drag.y; applyZoom(); } });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => mon.addEventListener(ev, () => { drag = null; if (BS.zoom > 1) mon.style.cursor = 'grab'; }));
mon.addEventListener('dblclick', (e) => { const r = mon.getBoundingClientRect(); zoomAt(BS.zoom > 1 ? 1 : 2, e.clientX - r.left, e.clientY - r.top); });
document.addEventListener('keydown', (e) => {
  if (S.view !== 'cmp' || $('.scrim')) return;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); playing() ? pauseBench() : play(); }
  else if (k === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) { pauseBench(); seekBoth(Math.max(0, master().currentTime - 1)); updateTime(); } else step(-1); }
  else if (k === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) { pauseBench(); seekBoth(Math.min(minDur(), master().currentTime + 1)); updateTime(); } else step(1); }
  else if (k === '[') setWipe(BS.wipe - 2); else if (k === ']') setWipe(BS.wipe + 2);
  else if (k === 'l' || k === 'L') $('#bLoop').click(); else if (k === 's' || k === 'S') $('#bSwap').click();
  else if (k === 'a' || k === 'A') { BS.listen = 'a'; applyAudio(); } else if (k === 'b' || k === 'B') { BS.listen = 'b'; applyAudio(); }
  else if (k === 'm' || k === 'M') { BS.listen = '0'; applyAudio(); }
  else if (k === '+' || k === '=') zoomAt(BS.zoom * 1.25, null, null); else if (k === '-') zoomAt(BS.zoom / 1.25, null, null); else if (k === '0') zoomAt(1, null, null);
  else if (k >= '1' && k <= '5') setBenchMode(['wipe', 'side', 'a', 'b', 'blink'][+k - 1]);
});
function paintMetas(a, b) {   // les recettes côte à côte : ce qui diffère est marqué
  const rows = (it) => (it ? Object.fromEntries(recipeRows(it).concat([['Prompt', it.prompt || ''], ['Son demandé', it.params?.sound || '']])) : null);
  const ra = rows(a), rb = rows(b);
  const keys = [...new Set([...(ra ? Object.keys(ra) : []), ...(rb ? Object.keys(rb) : [])])];
  const differs = (k) => ra && rb && k !== 'Rendu' && String(ra[k] ?? '') !== String(rb[k] ?? '');
  const dk = keys.filter(differs);
  $('#diffline').replaceChildren(!(a && b) ? el('span', { class: 'lbl' }, 'choisissez deux plans pour voir ce qui diffère')
    : dk.length ? el('span', {}, el('b', {}, `${dk.length} différence${dk.length > 1 ? 's' : ''}`), ' · ' + dk.join(', ').toLowerCase())
      : el('span', {}, 'mêmes réglages : seul le hasard du rendu les sépare'));
  for (const [k, it, r] of [['a', a, ra], ['b', b, rb]]) {
    const box = $('#meta' + k.toUpperCase());
    const head = el('div', { class: 'head' }, el('b', {}, k.toUpperCase()), el('span', { class: 'lbl' }, it ? fmtDate(it.created) : '—'));
    if (!it) { box.replaceChildren(el('span', { class: 'dots' }), head, el('span', { class: 'lbl' }, 'aucun plan')); continue; }
    box.replaceChildren(el('span', { class: 'dots' }), head, el('div', { class: 'name' }, it.title || it.id),
      el('dl', { class: 'kv' }, ...keys.filter((x) => r[x] !== undefined && r[x] !== '').flatMap((x) => {
        const d = differs(x) ? 'diff' : '';
        const long = x === 'Prompt' || x === 'Son demandé' || x === 'Références' ? ' long' : '';
        return [el('dt', { class: d }, x), el('dd', { class: (d + long + (x === 'Rendu' ? ' big' : '')).trim() }, String(r[x]))];
      })));
  }
}

// ── dépôt n'importe où ──────────────────────────────────────
dropAnywhere(async (files) => {
  for (const f of files) {
    try {
      const it = await uploadFile(f, { tool: 'upload' });
      S.items.set(it.id, it);
      if (S.view === 'cmp' && it.kind === 'video') assign(!S.A ? 'A' : 'B', it.id);
      else if (F.mode === 'i2v' && it.kind === 'image') { if (!F.start) F.start = it.id; else F.end = it.id; }
      else if (F.mode === 'r2v' && ['image', 'video', 'audio'].includes(it.kind)) F.refs.push({ item: it.id, name: nameFor(it.title), role: (S.opts?.roles[it.kind] || [{ id: '' }])[0].id, sound: false });
      toast(`${kindFr(it.kind)} rangé${it.kind === 'image' ? 'e' : ''} dans la bibliothèque`);
    } catch (e) { toast(e.message); }
  }
  changed();
  if (F.mode === 'i2v') { paintSlot('start'); paintSlot('end'); }
  if (F.mode === 'r2v') paintRefs();
  loadLib();
});

// ── démarrage ───────────────────────────────────────────────
(async function boot() {
  const q = new URLSearchParams(location.search);
  if (q.get('start')) { F.start = q.get('start'); F.mode = 'i2v'; F.canvas.i2v = 'auto'; F.fam.i2v = 'image'; }
  if (q.get('ref')) { const id = q.get('ref'); const it = await item(id); if (it && !F.refs.some((r) => r.item === id)) F.refs.push({ item: id, name: nameFor(it.title), role: it.kind === 'video' ? 'motion' : it.kind === 'audio' ? 'voice' : 'character', sound: false }); F.mode = 'r2v'; }
  if (q.get('mode') && ['t2v', 'i2v', 'r2v'].includes(q.get('mode'))) F.mode = q.get('mode');
  if (q.get('a') || q.get('b')) { S.A = q.get('a'); S.B = q.get('b'); }
  try { S.opts = await api('movie/options'); } catch (e) { toast('options illisibles : ' + e.message); }
  paintCamera();
  await loadLib();
  S.cur = q.get('id') || S.lib[0]?.id || null;
  setMode(F.mode);
  setView(q.get('view') === 'cmp' || q.get('a') ? 'cmp' : 'create');
  paintStage(); paintResult(); paintProgress();
  setFocus(S.cur ? 'result' : 'create');
  loadLoras();
  paintEngine();
  setInterval(paintEngine, 15000);
})();
