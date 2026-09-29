// IDÉATION — faire naître des images sur la planche.
//
// Aucun modèle n'est câblé ici : tout passe par les routes de l'outil
// Image (`/api/image/generate`, `/redo`, `/edit`), donc par ses travaux
// `image.generate` et `image.edit` et leur moteur — factice aujourd'hui,
// réel le jour où « image_backend » passe à « comfyui ».
//
// La carte « Générer » : prompt, modèle, format, nombre, prise de vue ; les
// images et éléments qui lui sont reliés sont ses références, dans l'ordre
// des liens. Les travaux lancés sont gardés dans l'objet (`jobs`) : la page
// rechargée reprend leur attente, et pose les résultats à côté, reliés.

import { api, jobs, toast, el, href, dropZone } from '../commun/shell.js';

export function createGen(app) {
  const { S } = app;
  const M = (id) => S.cfg?.models?.find((m) => m.id === id);
  const followed = new Set();

  const refsOf = (g) => S.board.links.filter((l) => l.b === g.id).map((l) => app.node(l.a))
    .filter((n) => n && n.type === 'media' && (n.kind === 'image' || n.kind === 'element'));
  const quality = (g) => { const m = M(g.model); return !m ? g.quality : m.sizes[g.quality] ? g.quality : m.quality[0].id; };

  // ce qui empêche de générer, dit en clair (une action éteinte dit pourquoi)
  function why(g) {
    if (!S.cfg) return S.cfgError ? `l’outil Image ne répond pas : ${S.cfgError}` : 'lecture des modèles…';
    const m = M(g.model);
    if (!m) return `modèle inconnu : ${g.model}`;
    if (!(g.prompt || '').trim()) return 'écrivez un prompt';
    const refs = refsOf(g);
    if (refs.some((n) => S.items.get(n.item)?.missing)) return 'une référence a quitté la bibliothèque : retirez son lien';
    if (refs.length > m.refs) {
      return m.refs ? `${m.name} prend ${m.refs} référence${m.refs > 1 ? 's' : ''} au plus — ${refs.length} reliées`
        : `${m.name} ne prend pas de référence (${refs.length} reliée${refs.length > 1 ? 's' : ''}) : passez à Qwen 2.1 ou Krea 2`;
    }
    const q = quality(g);
    if (!m.sizes[q]?.[g.aspect]) return `${g.aspect} n’est pas documenté pour ${m.name} en ${m.quality.find((x) => x.id === q)?.label || q}`;
    return '';
  }

  // ce qui refait la carte : ses références et la lecture des modèles
  const cardKey = (g) => '|' + refsOf(g).map((n) => n.item + (S.items.get(n.item)?.missing ? 'x' : '') + (g.refChoice?.[n.item] || '')).join(',')
    + (S.cfg ? '|c' : '') + '|' + (S.cfg?.backend || '');

  function refThumb(g, n) {
    const it = S.items.get(n.item);
    if (!it || it.missing) return null;
    if (it.kind !== 'element') return it.thumb_url;
    const refs = it.element?.refs || [];
    return (refs.find((r) => r.file === g.refChoice?.[n.item]) || refs[0])?.thumb_url || it.thumb_url;
  }

  function card(g) {
    const m = M(g.model);
    const refs = refsOf(g);
    const ta = el('textarea', { class: 'fld gp', rows: 4, spellcheck: 'false',
      placeholder: 'le prompt, en anglais : le sujet, le lieu, la lumière…' });
    ta.value = g.prompt || '';
    let changed = () => {};
    ta.addEventListener('focus', () => { changed = app.editing(); });
    ta.addEventListener('input', () => { changed(); g.prompt = ta.value; refresh(g.id); app.insp?.syncPrompt(g.id); });
    const sel = (opts, cur, on, title) => {
      const s = el('select', { class: 'fld sm', title },
        ...opts.map(([v, l, dis]) => el('option', { value: v, selected: v === cur ? true : null, disabled: dis ? true : null }, l)));
      s.addEventListener('change', () => on(s.value));
      return s;
    };
    const models = S.cfg ? S.cfg.models.map((x) => [x.id, x.name]) : [[g.model, g.model]];
    const aspects = S.cfg ? S.cfg.aspects.map((a) => [a, a, m ? !m.sizes[quality(g)]?.[a] : false]) : [[g.aspect, g.aspect]];
    const count = el('div', { class: 'seg' }, ...[1, 2, 3, 4].map((k) => el('button', { class: 'tb' + (g.count === k ? ' on' : ''), type: 'button',
      title: `${k} image${k > 1 ? 's' : ''}`, onclick: () => app.mutate(() => { g.count = k; }) }, String(k))));
    const looks = Object.entries(g.looks || {}).map(([gid, lid]) => {
      const it = S.cfg?.looks.find((x) => x.id === gid)?.items.find((x) => x.id === lid);
      return el('span', { class: 'chip' }, it ? it.name : lid);
    });
    // l'emplacement des références : on y relie, on y dépose (fichier du disque ou vignette), on y ajoute
    const full = m && refs.length >= m.refs;
    const strip = el('div', { class: 'grefs', title: 'déposez ici des images ou des éléments : les références de la carte' }, ...refs.map((n, k) => {
      const src = refThumb(g, n);
      return el('i', { title: `référence ${k + 1} : ${S.items.get(n.item)?.title || n.title || n.item}`,
        style: { backgroundImage: src ? `url("${href(src)}")` : null } }, el('b', {}, String(k + 1)));
    }),
    m && !m.refs ? null : el('button', { class: 'gadd', type: 'button', disabled: full ? true : null,
      title: full ? `${m.name} : ${m.refs} au plus` : 'ajouter une référence depuis la bibliothèque', onclick: () => app.pickRefs(g.id) }, '+'),
    refs.length ? null : el('span', { class: 'ghint' }, m ? (m.refs ? `déposez ou reliez-y des images, des éléments : ses références (${m.refs} au plus)` : 'texte seul : ce modèle ne prend pas de référence')
      : 'déposez ou reliez-y des images : ses références'));
    dropZone(strip, { kinds: ['image', 'element'], via: 'ideation', onitems: (items) => app.addRefs(g.id, items) });
    const btn = el('button', { class: 'gbtn', type: 'button', onclick: () => generate(g.id) }, `Générer${g.count > 1 ? ' ×' + g.count : ''}`);
    const w = el('div', { class: 'gwhy why' });
    const stub = S.cfg?.backend === 'stub';
    setTimeout(() => refresh(g.id));
    return [
      el('div', { class: 'ghead' }, el('span', { class: 'lbl k' }, 'générer'), el('span', { class: 'lbl' }, m?.k || g.model),
        el('span', { class: 'sp' }), stub ? el('span', { class: 'fac lbl', title: 'moteur factice de l’outil Image : des mires dessinées, aucun modèle chargé' }, 'factice') : null),
      el('div', { class: 'gsum' }, g.prompt || '—'),
      el('div', { class: 'gform' }, strip, ta,
        el('div', { class: 'grow' }, sel(models, g.model, (v) => app.mutate(() => { g.model = v; app.LS('gen-model', v); }), 'le modèle'),
          sel(aspects, g.aspect, (v) => app.mutate(() => { g.aspect = v; }), 'le format'), count),
        looks.length ? el('div', { class: 'opts' }, ...looks) : el('span', { class: 'ghint' }, 'prise de vue (caméra, objectif, pellicule, lumière) : panneau de droite'),
        el('div', { class: 'grow' }, btn, w)),
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
    if (sum) sum.textContent = g.prompt || '—';
  }

  async function generate(id) {
    const g = app.node(id);
    if (!g) return;
    const w = why(g);
    if (w) { toast(w, 5000); return; }
    const refs = refsOf(g);
    const body = { model: g.model, prompt: g.prompt, aspect: g.aspect, quality: quality(g), count: g.count, looks: g.looks,
      realism: g.realism, variant: g.variant,
      refs: refs.map((n) => ({ item: n.item, ...(g.refChoice?.[n.item] ? { ref: g.refChoice[n.item] } : {}) })) };
    if (g.seed) body.seed = Number(g.seed);
    await launch(id, 'image/generate', body, 'gen');
  }

  // Variations : la recette de l'image, d'autres graines (route « redo » de l'outil Image)
  const recipe = (it) => ['image.generate', 'image.edit'].includes(it?.params?.job);
  async function variations(id, n = 4) {
    const node = app.node(id);
    const it = node && S.items.get(node.item);
    if (!recipe(it)) { toast('cette image n’a pas de recette (déposée, ou faite ailleurs) : une carte Générer la prend en référence', 6000); return; }
    await launch(id, 'image/redo', { item: node.item, variations: n }, 'var');
  }
  async function edit(id, opts) {
    const node = app.node(id);
    if (!node) return;
    await launch(id, 'image/edit', { source: node.item, ...opts }, opts.tool);
  }

  async function launch(id, path, body, act) {
    let r;
    try { r = await api(path, { method: 'POST', body }); } catch (e) {
      const n = app.node(id);
      if (n && n.type === 'gen') app.quiet(() => { n.error = e.message; });
      toast(e.message, 8000);
      return false;
    }
    const n = app.node(id);
    if (!n) return false;
    app.quiet(() => {
      if (n.type === 'gen') n.error = '';
      n.jobs = [...(n.jobs || []), ...r.jobs.map((j) => ({ id: j.id, act }))];
    });
    for (const j of r.jobs) { S.jobs.set(j.id, j); follow(id, j.id); }
    toast(`${r.jobs.length > 1 ? r.jobs.length + ' travaux' : 'un travail'} en file — les images se poseront à côté`);
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
      app.quiet(() => { drop(); if (j.state === 'error' && n?.type === 'gen') n.error = j.message; });
      if (j.state === 'done' && fresh.length && !n) toast('les images sont dans la bibliothèque (l’objet qui les demandait n’est plus sur la planche)');
    }
    if (j.state === 'error') toast(`échec : ${j.message}`, 9000);
    app.lib?.reload();
  }

  // à droite de ce qui les a demandées, sur une place libre, reliées
  function placeResults(from, items) {
    const W = from.type === 'gen' ? 240 : Math.max(160, Math.min(from.w, 280));
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

  return { card, cardKey, refresh, why, refsOf, quality, generate, variations, edit, recipe, resume, placeResults, M };
}
