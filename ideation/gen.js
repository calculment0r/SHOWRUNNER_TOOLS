// IDÉATION — faire naître des images sur la planche.
//
// Aucun modèle n'est câblé ici : tout passe par les routes de l'outil
// Image (`/api/image/generate`, `/redo`, `/edit`), donc par ses travaux
// `image.generate` et `image.edit` et leur moteur — factice aujourd'hui,
// réel le jour où « image_backend » passe à « comfyui ».
//
// La carte « Générer image » : deux entrées, `prompt` (un texte : note,
// post-it, titre, composeur — ou le champ de la carte) et `refs` (images et
// éléments, dans l'ordre des fils ; autant que le modèle en prend, lu dans
// /api/image/models). Changer de modèle refait ses entrées à l'instant : un
// fil qui ne va plus passe en alerte, avec sa raison, et n'est pas envoyé.
// Sa sortie est sa dernière image. Les travaux lancés sont gardés dans
// l'objet (`jobs`) : la page rechargée reprend leur attente, et pose les
// résultats à côté, reliés (lignée `out`). `launch`, `follow`, `finish` et
// `placeResults` servent aussi la carte vidéo (video.js).

import { api, jobs, toast, el, href, dropZone } from '../commun/shell.js';
import { KINDS, nameOf, fromName, short, inPorts } from './ports.js';

// ── ce que les cartes partagent (video.js aussi) ──────────────
// l'étiquette d'une entrée, que le port vise (data-anchor) ; `count` : « 1/2 »
export const plab = (side, id, text, extra = '') => el('span', { class: 'plab', 'data-anchor': `${side}:${id}` }, text, extra ? el('small', {}, extra) : null);
// le texte reçu par un fil, en lecture, avec d'où il vient
// (en lecture ; « détacher » copie le texte là où il arrivait et coupe le fil)
export function inbox(app, pr, what = 'le texte est copié dans la carte') {
  const t = (pr.text || '').trim();
  return el('div', { class: 'gin' },
    el('div', { class: 'gin-h' }, el('span', { class: 'from', title: fromName(pr.from) }, fromName(pr.from)),
      el('button', { class: 'gcut', type: 'button', title: `détacher : ${what}, le fil coupé`, onclick: () => app.detach(pr.link.id) }, 'détacher')),
    el('div', { class: 'gin-t' + (t ? '' : ' ph') }, t || 'vide pour l’instant'));
}
// les fils d'une carte qui ne vont plus : dits sur la carte (une ligne par raison), pas relus
export function badList(app, id) {
  const groups = new Map();
  for (const e of app.flow().bad(id)) { if (!groups.has(e.why)) groups.set(e.why, []); groups.get(e.why).push(e); }
  if (!groups.size) return null;
  return el('div', { class: 'gbad' }, ...[...groups].map(([why, list]) => el('div', { title: `${list.map((e) => nameOf(e.from)).join(', ')} — ${why}` },
    el('b', {}, list.length > 1 ? `${list.length} fils ignorés` : 'fil ignoré'), ` ${short(why)}`,
    el('button', { class: 'gcut', type: 'button', title: list.length > 1 ? 'couper ces fils' : 'couper ce fil', onclick: () => app.cutLink(list.map((e) => e.link.id)) },
      list.length > 1 ? 'les couper' : 'couper'))));
}
// une vignette d'entrée : numérotée, en alerte ou en attente
export function chip(app, e, n, { token = '' } = {}) {
  const id = e.item !== undefined ? e.item : app.flow().itemOf(e.from);
  const it = id ? app.S.items.get(id) : null;
  const src = it && !it.missing ? (it.kind === 'element' ? it.element?.refs?.[0]?.thumb_url || it.thumb_url : it.thumb_url) : null;
  const cls = e.ok === false ? ' bad' : e.pending ? ' wait' : '';
  const title = e.ok === false ? `ignoré : ${e.why}` : e.pending ? `en attente : ${e.pending}` : `${token || 'référence ' + n} : ${it?.title || nameOf(e.from)}`;
  return el('i', { class: 'gchip' + cls, title, style: { backgroundImage: src ? `url("${href(src)}")` : null } },
    el('b', {}, e.ok === false ? '×' : token || String(n)));
}

export function createGen(app) {
  const { S } = app;
  const M = (id) => S.cfg?.models?.find((m) => m.id === id);
  const followed = new Set();

  // les références qui partent : les fils bons de l'entrée `refs`, avec leur objet
  const refsOf = (g, F = app.flowNow()) => F.take(g.id, 'refs');
  const promptOf = (g, F = app.flowNow()) => F.prompt(g.id) || { text: g.prompt || '', from: null, link: null };
  const quality = (g) => { const m = M(g.model); return !m ? g.quality : m.sizes[g.quality] ? g.quality : m.quality[0].id; };

  // ce qui empêche de générer, dit en clair (une action éteinte dit pourquoi)
  function why(g) {
    if (!S.cfg) return S.cfgError ? `l’outil Image ne répond pas : ${S.cfgError}` : 'lecture des modèles…';
    const m = M(g.model);
    if (!m) return `modèle inconnu : ${g.model}`;
    const F = app.flowNow();
    const pr = promptOf(g, F);
    if (!pr.text.trim()) return pr.from ? `le prompt vient de ${nameOf(pr.from)} : il est vide` : 'écrivez un prompt, ou branchez un texte';
    const refs = refsOf(g, F);
    const wait = refs.find((e) => e.pending);
    if (wait) return `la référence ${wait.idx + 1} attend : ${wait.pending}`;
    const q = quality(g);
    if (!m.sizes[q]?.[g.aspect]) return `${g.aspect} n’est pas documenté pour ${m.name} en ${m.quality.find((x) => x.id === q)?.label || q}`;
    return '';
  }

  // ce qui refait la carte : ce qu'elle reçoit, la lecture des modèles, les choix d'image des éléments
  const cardKey = (g) => '|' + app.flow().sig(g.id) + '|' + JSON.stringify(g.refChoice || {}) + (S.cfg ? '|c' : '') + '|' + (S.cfg?.backend || '');

  function card(g) {
    const F = app.flow();
    const m = M(g.model);
    const pr = F.prompt(g.id);
    const all = F.inputs(g.id).refs || [];
    const refs = all.filter((e) => e.ok);
    const port = inPorts(g, app.caps()).find((p) => p.id === 'refs');
    // le prompt : le champ de la carte, ou le texte d'un fil
    let field;
    if (pr) {
      field = inbox(app, pr, 'la prose est copiée dans le prompt de la carte');
      if (pr.son || pr.musique) field.append(el('span', { class: 'ghint' }, 'Son et Musique du composeur ne vont qu’à la vidéo : ignorés ici'));
    } else {
      field = el('textarea', { class: 'fld gp', rows: 4, spellcheck: 'false', placeholder: 'le prompt, en anglais : le sujet, le lieu, la lumière… ou branchez un texte' });
      field.value = g.prompt || '';
      let changed = () => {};
      field.addEventListener('focus', () => { changed = app.editing(); });
      field.addEventListener('input', () => { changed(); g.prompt = field.value; refresh(g.id); app.insp?.syncPrompt(g.id); });
    }
    const sel = (opts, cur, on, title) => {
      const s = el('select', { class: 'fld sm', title },
        ...opts.map(([v, l, dis]) => el('option', { value: v, selected: v === cur ? true : null, disabled: dis ? true : null }, l)));
      s.addEventListener('change', () => on(s.value));
      return s;
    };
    const models = S.cfg ? S.cfg.models.map((x) => [x.id, `${x.name}${x.refs ? ` · ${x.refs} réf.` : ' · texte seul'}`]) : [[g.model, g.model]];
    const aspects = S.cfg ? S.cfg.aspects.map((a) => [a, a, m ? !m.sizes[quality(g)]?.[a] : false]) : [[g.aspect, g.aspect]];
    const count = el('div', { class: 'seg' }, ...[1, 2, 3, 4].map((k) => el('button', { class: 'tb' + (g.count === k ? ' on' : ''), type: 'button',
      title: `${k} image${k > 1 ? 's' : ''}`, onclick: () => app.mutate(() => { g.count = k; }) }, String(k))));
    const looks = Object.entries(g.looks || {}).map(([gid, lid]) => {
      const it = S.cfg?.looks.find((x) => x.id === gid)?.items.find((x) => x.id === lid);
      return el('span', { class: 'chip' }, it ? it.name : lid);
    });
    // les références : on y branche, on y dépose (fichier du disque ou vignette), on y ajoute
    const shut = port && port.max === 0;
    const full = port && port.max !== null && refs.length >= port.max;
    const strip = el('div', { class: 'grefs' + (shut ? ' shut' : ''), title: shut ? port.why : 'déposez ici des images ou des éléments : les références de la carte' },
      ...all.map((e) => chip(app, e, e.ok ? e.idx + 1 : 0)),
      shut ? null : el('button', { class: 'gadd', type: 'button', disabled: full ? true : null,
        title: full ? `${m.name} : ${m.refs} au plus` : 'ajouter une référence depuis la bibliothèque', onclick: () => app.pickRefs(g.id) }, '+'),
      all.length ? null : el('span', { class: 'ghint', title: shut ? port.why : null }, shut ? `texte seul : ${short(port.why)}`
        : m ? `branchez ou déposez des images, des éléments (${m.refs} au plus)` : 'branchez ou déposez des images'));
    // fermée aussi, elle reçoit le dépôt : pour dire pourquoi elle le refuse (app.feed → canWire)
    dropZone(strip, { kinds: ['image', 'element'], via: 'ideation', onitems: (items) => app.addRefs(g.id, items) });
    const btn = el('button', { class: 'gbtn', type: 'button', onclick: () => generate(g.id) }, `Générer${g.count > 1 ? ' ×' + g.count : ''}`);
    const w = el('div', { class: 'gwhy why' });
    const stub = S.cfg?.backend === 'stub';
    setTimeout(() => refresh(g.id));
    return [
      el('div', { class: 'ghead', 'data-anchor': 'out:image' }, el('span', { class: 'lbl k' }, 'générer image'), el('span', { class: 'lbl' }, m?.k || g.model),
        el('span', { class: 'sp' }), stub ? el('span', { class: 'fac lbl', title: 'moteur factice de l’outil Image : des mires dessinées, aucun modèle chargé' }, 'factice') : null),
      el('div', { class: 'gsum' }, (pr ? pr.text : g.prompt) || '—'),
      el('div', { class: 'gform' },
        el('div', { class: 'prow', 'data-row': 'prompt' }, plab('in', 'prompt', 'prompt', pr ? 'fil' : ''), field),
        el('div', { class: 'prow', 'data-row': 'refs' }, plab('in', 'refs', 'références', shut ? 'fermé' : m ? `${refs.length}/${m.refs}` : String(refs.length)), strip),
        el('div', { class: 'grow' }, sel(models, g.model, (v) => app.mutate(() => { g.model = v; app.LS('gen-model', v); }), 'le modèle : ses entrées suivent'),
          sel(aspects, g.aspect, (v) => app.mutate(() => { g.aspect = v; }), 'le format'), count),
        looks.length ? el('div', { class: 'opts' }, ...looks) : el('span', { class: 'ghint' }, 'prise de vue (caméra, objectif, pellicule, lumière) : panneau de droite'),
        el('div', { class: 'grow' }, btn, w),
        badList(app, g.id)),
      g.error ? el('p', { class: 'gerr' }, g.error) : null,
    ];
  }

  // le bouton et sa raison, sans refaire la carte (on y écrit peut-être)
  function refresh(id) {
    const g = app.node(id);
    const e = app.canvas?.dom.get(id)?.el;
    if (!g || !e) return;
    const w = why(g);
    const btn = e.querySelector('.gbtn'), wy = e.querySelector('.gwhy'), sum = e.querySelector('.gsum');
    if (btn) { btn.disabled = !!w; btn.textContent = `Générer${g.count > 1 ? ' ×' + g.count : ''}`; }
    if (wy) wy.textContent = w;
    if (sum) sum.textContent = promptOf(g).text || '—';
  }

  async function generate(id) {
    const g = app.node(id);
    if (!g) return;
    const w = why(g);
    if (w) { toast(w, 5000); return; }
    const F = app.flowNow();
    const refs = refsOf(g, F);
    const body = { model: g.model, prompt: promptOf(g, F).text, aspect: g.aspect, quality: quality(g), count: g.count, looks: g.looks,
      realism: g.realism, variant: g.variant,
      refs: refs.map((e) => ({ item: e.item, ...(g.refChoice?.[e.item] ? { ref: g.refChoice[e.item] } : {}) })) };
    if (g.seed) body.seed = Number(g.seed);
    await launch(id, async () => (await api('image/generate', { method: 'POST', body })).jobs, 'gen');
  }

  // Variations : la recette de l'image, d'autres graines (route « redo » de l'outil Image)
  const recipe = (it) => ['image.generate', 'image.edit'].includes(it?.params?.job);
  async function variations(id, n = 4) {
    const node = app.node(id);
    const it = node && S.items.get(node.item);
    if (!recipe(it)) { toast('cette image n’a pas de recette (déposée, ou faite ailleurs) : une carte Générer la prend en référence', 6000); return; }
    await launch(id, async () => (await api('image/redo', { method: 'POST', body: { item: node.item, variations: n } })).jobs, 'var');
  }
  async function edit(id, opts) {
    const node = app.node(id);
    if (!node) return;
    await launch(id, async () => (await api('image/edit', { method: 'POST', body: { source: node.item, ...opts } })).jobs, opts.tool);
  }

  // lancer : `run()` rend les travaux mis en file ; l'objet les garde, la page les suit
  async function launch(id, run, act) {
    let list;
    try { list = await run(); } catch (e) {
      const n = app.node(id);
      if (n && (n.type === 'gen' || n.type === 'vgen')) app.quiet(() => { n.error = e.message; });
      toast(e.message, 8000);
      return false;
    }
    const n = app.node(id);
    if (!n) return false;
    app.quiet(() => {
      if (n.type === 'gen' || n.type === 'vgen') n.error = '';
      n.jobs = [...(n.jobs || []), ...list.map((j) => ({ id: j.id, act }))];
    });
    for (const j of list) { S.jobs.set(j.id, j); follow(id, j.id); }
    toast(`${list.length > 1 ? list.length + ' travaux' : 'un travail'} en file — le résultat se posera à côté, relié`);
    return true;
  }

  // suivre un travail jusqu'au bout, puis poser ce qu'il a rendu
  function follow(nodeId, jobId) {
    if (followed.has(jobId)) return;
    followed.add(jobId);
    jobs.wait(jobId, (j) => { S.jobs.set(jobId, j); app.canvas.paintJobs(nodeId); })
      .then((j) => finish(nodeId, j))
      .catch(() => {                       // le travail a été retiré de la file
        followed.delete(jobId);
        const n = app.node(nodeId);
        if (n?.jobs?.some((x) => x.id === jobId)) app.quiet(() => { n.jobs = n.jobs.filter((x) => x.id !== jobId); });
      });
  }
  function finish(nodeId, j) {
    S.jobs.set(j.id, j);
    const n = app.node(nodeId);
    const fresh = (j.items || []).filter((it) => !S.board.nodes.some((x) => x.type === 'media' && x.item === it.id));
    for (const it of j.items || []) S.items.set(it.id, it);
    const drop = () => { if (n?.jobs) n.jobs = n.jobs.filter((x) => x.id !== j.id); };
    if (j.state === 'done' && fresh.length && n) {
      app.mutate(() => { drop(); placeResults(n, fresh); });
    } else {
      app.quiet(() => { drop(); if (j.state === 'error' && (n?.type === 'gen' || n?.type === 'vgen')) n.error = j.message; });
      if (j.state === 'done' && fresh.length && !n) toast('le résultat est dans la bibliothèque (l’objet qui le demandait n’est plus sur la planche)');
    }
    if (j.state === 'error') toast(`échec : ${j.message}`, 9000);
    app.lib?.reload();
  }

  // à droite de ce qui les a demandées, sur une place libre, reliées (la lignée)
  function placeResults(from, items) {
    const W = from.type === 'gen' || from.type === 'vgen' ? 240 : Math.max(160, Math.min(from.w, 280));
    const made = [];
    for (const it of items) {
      const [w, h] = app.sizeFor(it, W);
      const [x, y] = app.freeSpot(from.x + from.w + 70, from.y, w, h);
      const node = app.newMedia(it, x, y, w, h);
      S.board.nodes.push(node);
      S.board.links.push({ id: app.uid('l'), a: from.id, b: node.id, kind: 'out', label: '' });
      made.push(node);
    }
    return made;
  }

  // reprendre les travaux gardés dans la planche (page rechargée)
  function resume() {
    for (const n of S.board?.nodes || []) for (const j of n.jobs || []) follow(n.id, j.id);
  }

  return { card, cardKey, refresh, why, refsOf, promptOf, quality, generate, variations, edit, recipe, resume, placeResults, launch, M, KINDS };
}
