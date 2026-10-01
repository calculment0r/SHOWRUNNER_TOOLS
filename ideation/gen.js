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
//
// Le lot (étude docs/etudes/ideation_weavy.md § 9.3) : le prompt vient d'un
// composeur dont une case varie. La carte dit « Générer 3 × 2 » (valeurs
// cochées × images par valeur), dans le plafond du serveur (/api/ideation/meta,
// celui d'/api/image/generate) ; tout part en un envoi (/api/ideation/lot),
// la même graine d'une valeur à l'autre. Le lot tombe dans un cadre nommé
// d'après la case (« Décor × 3 ») : une colonne par valeur, la valeur en
// légende, les images d'une valeur l'une sous l'autre ; chaque image garde son
// lien de lignée (`out`, marqué `lot` : le cadre), la carte un lien vers le cadre.

import { api, jobs, toast, el, href, dropZone } from '../commun/shell.js';
import { sortable, moveItem, heldTitle, sentLabel } from '../commun/refs.js';
import { arobase } from '../commun/arobase.js';
import { KINDS, nameOf, fromName, short, inPorts, newSlots, DEFAULT_ROLES, cleanLooks } from './ports.js';

// ── ce que les cartes partagent (video.js aussi) ──────────────
// l'étiquette d'une entrée, que le port vise (data-anchor) ; `count` : « 1/2 »
export const plab = (side, id, text, extra = '') => el('span', { class: 'plab', 'data-anchor': `${side}:${id}` }, text, extra ? el('small', {}, extra) : null);
// ce qu'une carte dit de son lot : la case qui varie et ses valeurs cochées
export function lotLine(L) {
  if (!L) return null;
  if (L.conflict) return el('div', { class: 'glot bad' }, el('b', {}, 'deux cases varient'), el('span', {}, L.conflict.map((x) => `« ${x.name} »`).join(', ')));
  const off = L.values.length - L.on.length;
  return el('div', { class: 'glot', title: L.on.map((t, k) => `${k + 1}. ${t}`).join('\n') }, el('b', {}, `${L.name} × ${L.on.length}`),
    el('span', {}, L.on.length ? `une colonne par valeur${off ? ` · ${off} décochée${off > 1 ? 's' : ''}` : ''}` : 'aucune valeur cochée'));
}
// le texte reçu par un fil, en lecture, avec d'où il vient
// (en lecture ; « détacher » copie le texte là où il arrivait et coupe le fil) ;
// sur une carte Générer : son lot, et « voir le prompt envoyé »
export function inbox(app, pr, what = 'le texte est copié dans la carte') {
  const t = (pr.text || '').trim();
  const card = pr.link ? app.node(pr.link.b) : null;
  const maker = card && (card.type === 'gen' || card.type === 'vgen');
  return el('div', { class: 'gin' },
    el('div', { class: 'gin-h' }, el('span', { class: 'from', title: fromName(pr.from) }, fromName(pr.from)),
      maker ? el('button', { class: 'gcut', type: 'button', title: 'le prompt tel qu’il part au modèle, valeur par valeur', onclick: (e) => { e.stopPropagation(); app.gen.showSent(card.id); } }, 'envoyé') : null,
      el('button', { class: 'gcut', type: 'button', title: `détacher : ${what}, le fil coupé`, onclick: () => app.detach(pr.link.id) }, 'détacher')),
    maker ? lotLine(pr.lot) : null,
    el('div', { class: 'gin-t' + (t ? '' : ' ph') }, t || 'vide pour l’instant'));
}
// ce qui empêche un lot de partir ('' : il part) : `per` rendus par valeur
export function lotCheck(app, L, per, unit = 'image') {
  if (!L) return '';
  if (L.conflict) return `deux cases varient (${L.conflict.map((x) => `« ${x.name} »`).join(', ')}) : une seule à la fois`;
  if (!L.on.length) return `« ${L.name} » varie, mais aucune valeur n’est cochée`;
  const max = app.S.meta?.lot?.max;
  if (!max) return 'le plafond d’un lot n’est pas lu (/api/ideation/meta)';
  const n = L.on.length, tot = n * per;
  if (tot <= max) return '';
  const keep = Math.floor(max / per), fewer = Math.floor(max / n);
  const fix = [keep >= 1 ? `décochez ${n - keep} valeur${n - keep > 1 ? 's' : ''}` : '',
    per > 1 && fewer >= 1 ? `passez à ${fewer} ${unit}${fewer > 1 ? 's' : ''} par valeur` : ''].filter(Boolean).join(', ou ');
  return `${n} × ${per} = ${tot} ${unit}s : ${max} au plus par envoi — ${fix}`;
}
// le bouton « composer » d'un prompt écrit : il part dans un composeur neuf, branché
export const composeBtn = (app, id) => el('button', { class: 'gcut', type: 'button',
  title: 'faire de ce prompt un composeur, posé à gauche et branché : le texte dans une case Libre, les cinq cases prêtes',
  onclick: (e) => { e.stopPropagation(); app.gen.composeFrom(id); } }, 'composer');
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
// une vignette d'entrée : numérotée par sa place (la règle commune, commun/refs.js),
// grisée au-delà de ce que prend le modèle (`held`), en alerte, ou en attente ;
// on la glisse pour changer sa place (`refStrip`)
export function chip(app, e, n, { token = '' } = {}) {
  const id = e.item !== undefined ? e.item : app.flow().itemOf(e.from);
  const it = id ? app.S.items.get(id) : null;
  const src = it && !it.missing ? (it.kind === 'element' ? it.element?.refs?.[0]?.thumb_url || it.thumb_url : it.thumb_url) : null;
  const cls = e.held ? ' held' : e.ok === false ? ' bad' : e.pending ? ' wait' : '';
  const name = it?.title || nameOf(e.from);
  const title = e.held ? `${token || 'place ' + n} · ${name} — ${heldTitle(e.why)}` : e.ok === false ? `ignoré : ${e.why}`
    : e.pending ? `en attente : ${e.pending}` : `${token || 'référence ' + n} : ${name} — glisser pour changer sa place`;
  return el('button', { class: 'gchip' + cls, type: 'button', title, style: { backgroundImage: src ? `url("${href(src)}")` : null } },
    el('b', {}, e.ok === false && !e.held ? '×' : token || String(n)));
}
// le carrousel d'une entrée : ses vignettes dans l'ordre des fils ; glisser l'une
// change sa place (et son adresse : réf. 1, @image1…), le texte du prompt ne bouge pas
export function refStrip(app, id, pb, all, strip) {
  sortable(strip, { item: '.gchip', onmove: (a, b) => {
    const order = moveItem(all.map((e) => e.link.id), a, b);
    app.mutate((B) => {
      const at = new Map(order.map((lid, k) => [lid, k]));
      const mine = B.links.filter((l) => at.has(l.id)).sort((x, y) => at.get(x.id) - at.get(y.id));
      let k = 0;
      B.links = B.links.map((l) => (at.has(l.id) ? mine[k++] : l));
    });
  } });
  return strip;
}
// ce qu'une entrée dit de ses places : « 2 sur 5 envoyées » quand toutes ne partent pas
export function placesLabel(all, max) {
  const n = all.filter((e) => e.ok || e.held).length;
  const sent = all.filter((e) => e.ok).length;
  return sent < n ? sentLabel(n, sent) : max ? `${sent}/${max}` : String(sent);
}

export function createGen(app) {
  const { S } = app;
  const M = (id) => S.cfg?.models?.find((m) => m.id === id);
  const followed = new Set();

  // les références qui partent : les fils bons de l'entrée `refs`, avec leur objet
  const refsOf = (g, F = app.flowNow()) => F.take(g.id, 'refs');
  // le prompt : celui du fil (la valeur k si une case varie), sinon le champ de la carte
  const promptOf = (g, F = app.flowNow(), k = null) => F.prompt(g.id, k) || { text: g.prompt || '', from: null, link: null, lot: null, looks: null };
  // la prise de vue : celle du composeur s'il a une case Photographie (une seule vérité), sinon celle de la carte
  const looksOf = (g, pr = promptOf(g)) => cleanLooks(pr.looks || g.looks);
  const quality = (g) => { const m = M(g.model); return !m ? g.quality : m.sizes[g.quality] ? g.quality : m.quality[0].id; };
  const goText = (g, pr = promptOf(g)) => (pr.lot && !pr.lot.conflict && pr.lot.on.length ? `Générer ${pr.lot.on.length} × ${g.count}` : `Générer${g.count > 1 ? ' ×' + g.count : ''}`);

  // le « @ » du prompt (commun/arobase.js) : la même règle que la barre d'Image — Qwen-Image 2.1
  // nomme ses références par leur place (<image1>…, les places ENVOYÉES seulement) ; Krea 2 ne
  // les nomme pas (l'ordre suffit : la scène, puis le sujet) ; un modèle sans référence le dit
  function atChoices(g) {
    const m = M(g.model);
    if (!m) return { why: `modèle inconnu : ${g.model}` };
    if (g.model !== 'qwen21') {
      return { why: g.model === 'krea2' ? 'Krea 2 ne nomme pas ses références : l’ordre suffit (la scène, puis le sujet)'
        : m.refs_why || `${m.name} ne prend pas de référence` };
    }
    const sent = refsOf(g).filter((e) => e.ok && e.item);
    if (!sent.length) return { why: 'aucune référence envoyée : déposez ou branchez des images sur la carte' };
    return { toks: sent.map((e, k) => { const it = S.items.get(e.item);
      return { tag: `<image${k + 1}>`, titre: it?.title || '', vignette: it?.thumb_url || (it?.kind === 'image' ? it.url : null) }; }) };
  }

  // une carte dont un rendu est en file ou en cours : elle ne se relance pas (Cal, 01/10)
  function busy(n) {
    return (n?.jobs || []).some((x) => { const s = S.jobs.get(x.id)?.state ?? 'queued'; return s === 'queued' || s === 'running'; });
  }
  const BUSY_WHY = 'en cours : ce rendu calcule — la carte se libère à la fin (la file dit où il en est)';
  // le bouton d'une carte : éteint, il reste cliquable pour DIRE pourquoi (règle 7 du thème)
  function paintBtn(btn, w, text) {
    btn.disabled = false;
    btn.setAttribute('aria-disabled', String(!!w));
    btn.classList.toggle('off', !!w);
    btn.title = w || '';
    btn.textContent = text;
  }
  // la carte qui demandait : son bouton et sa raison, après un départ ou une fin
  function refreshCard(id) {
    const n = app.node(id);
    if (n?.type === 'gen') refresh(id);
    else if (n?.type === 'vgen') app.video?.refresh(id);
    app.canvas?.paintJobs(id);
  }

  // ce qui empêche de générer, dit en clair (une action éteinte dit pourquoi)
  function why(g) {
    if (busy(g)) return BUSY_WHY;
    if (!S.cfg) return S.cfgError ? `l’outil Image ne répond pas : ${S.cfgError}` : 'lecture des modèles…';
    const m = M(g.model);
    if (!m) return `modèle inconnu : ${g.model}`;
    const F = app.flowNow();
    const pr = promptOf(g, F);
    const lw = lotCheck(app, pr.lot, g.count);
    if (lw) return lw;
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
      // `gprompt` (pas `gp` : c'est la classe des groupes, posée en absolu — le champ sortait de la carte)
      field = el('textarea', { class: 'fld gprompt', rows: 4, spellcheck: 'false', placeholder: 'le prompt, en anglais : le sujet, le lieu, la lumière… ou branchez un texte', 'data-reg': 'prompt' });
      field.value = g.prompt || '';
      let changed = () => {};
      field.addEventListener('focus', () => { changed = app.editing(); });
      field.addEventListener('input', () => { changed(); g.prompt = field.value; refresh(g.id); app.insp?.syncPrompt(g.id); });
      arobase(field, () => atChoices(app.node(g.id) || g));
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
      title: pr?.lot && !pr.lot.conflict ? `${k} image${k > 1 ? 's' : ''} par valeur` : `${k} image${k > 1 ? 's' : ''}`, onclick: () => app.mutate(() => { g.count = k; }) }, String(k))));
    // la prise de vue : celle de la case Photographie du composeur branché, sinon celle de la carte ;
    // aucune pastille : une puce qui ouvre le panneau de la carte (pas de phrase d'aide)
    const fromC = !!pr?.looks;
    const looks = Object.entries(looksOf(g, pr || promptOf(g, F))).map(([gid, lid]) => {
      const it = S.cfg?.looks.find((x) => x.id === gid)?.items.find((x) => x.id === lid);
      return el('span', { class: 'chip', title: it?.sub || '' }, it ? it.name : lid);
    });
    const shot = fromC ? null : el('button', { class: 'gcut', type: 'button', title: 'caméra, objectif, pellicule, lumière : dans le panneau de droite',
      onclick: () => app.select([g.id]) }, looks.length ? 'prise de vue ›' : '+ prise de vue');
    // les références : un carrousel (commun/refs.js) — on y branche, on y dépose (fichier du
    // disque ou vignette), on y ajoute, on glisse une vignette pour changer sa place ; au-delà
    // de ce que prend le modèle, grisées, non envoyées, jamais retirées
    const shut = port && port.max === 0;
    const full = port && port.max !== null && all.length >= port.max;
    const strip = refStrip(app, g.id, 'refs', all, el('div', { class: 'grefs' + (shut ? ' shut' : ''), title: shut ? port.why : null },
      ...all.map((e) => chip(app, e, e.ok || e.held ? e.idx + 1 : 0)),
      // plein : pas de « + » (comme la barre d'Image) — l'étiquette dit combien partent, une grisée dit pourquoi
      shut || full ? null : el('button', { class: 'gadd', type: 'button', 'data-nodrag': '',
        title: 'ajouter une référence depuis la bibliothèque', onclick: () => app.pickRefs(g.id) }, '+'),
      all.length ? null : el('span', { class: 'ghint', title: shut ? port.why : null }, shut ? `texte seul · ${short(port.why)}` : 'déposez ou branchez des images')));
    // fermée aussi, elle reçoit le dépôt : pour dire pourquoi elle le refuse (app.feed → canWire)
    dropZone(strip, { kinds: ['image', 'element'], via: 'ideation', onitems: (items) => app.addRefs(g.id, items) });
    const btn = el('button', { class: 'gbtn', type: 'button', onclick: () => generate(g.id) }, goText(g, pr || promptOf(g, F)));
    const w = el('div', { class: 'gwhy why' });
    const stub = S.cfg?.backend === 'stub';
    setTimeout(() => refresh(g.id));
    return [
      el('div', { class: 'ghead', 'data-anchor': 'out:image' }, el('span', { class: 'lbl k' }, 'générer image'), el('span', { class: 'lbl' }, m?.k || g.model),
        el('span', { class: 'sp' }), stub ? el('span', { class: 'fac lbl', title: 'moteur factice de l’outil Image : des mires dessinées, aucun modèle chargé' }, 'factice') : null),
      el('div', { class: 'gsum' }, (pr ? pr.text : g.prompt) || '—'),
      el('div', { class: 'gform' },
        el('div', { class: 'prow', 'data-row': 'prompt' }, el('div', { class: 'prow-h' }, plab('in', 'prompt', 'prompt', pr ? 'fil' : ''), el('span', { class: 'sp' }),
          pr ? null : composeBtn(app, g.id)), field),
        el('div', { class: 'prow', 'data-row': 'refs' }, plab('in', 'refs', 'références', shut && !all.length ? 'fermé' : placesLabel(all, m?.refs)), strip),
        el('div', { class: 'grow gmodel' }, sel(models, g.model, (v) => app.mutate(() => { g.model = v; app.LS('gen-model', v); }), 'le modèle : il envoie ses N premières références, les autres restent grisées')),
        el('div', { class: 'grow' }, sel(aspects, g.aspect, (v) => app.mutate(() => { g.aspect = v; }), 'le format'), count, shot),
        looks.length ? el('div', { class: 'opts' }, fromC ? el('span', { class: 'lbl dim', title: 'les pastilles de la case Photographie du composeur : celles de la carte ne comptent pas' }, 'du composeur') : null, ...looks) : null,
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
    if (btn) paintBtn(btn, w, goText(g));
    // rien ne bloque : combien de références partent, quand toutes ne partent pas
    const all = app.flowNow().inputs(id).refs || [];
    const sent = sentLabel(all.filter((x) => x.ok || x.held).length, all.filter((x) => x.ok).length);
    if (wy) { wy.textContent = w || (sent ? `réf. ${sent}` : ''); wy.className = 'gwhy ' + (w ? 'why' : 'hint'); }
    if (sum) sum.textContent = promptOf(g).text || '—';
  }

  const refsBody = (g, F) => refsOf(g, F).map((e) => ({ item: e.item, ...(g.refChoice?.[e.item] ? { ref: g.refChoice[e.item] } : {}) }));
  async function generate(id) {
    const g = app.node(id);
    if (!g) return;
    const w = why(g);
    if (w) { toast(w, 5000); return; }
    const F = app.flowNow();
    const pr = promptOf(g, F);
    const body = { model: g.model, prompt: pr.text, aspect: g.aspect, quality: quality(g), count: g.count, looks: looksOf(g, pr),
      realism: g.realism, variant: g.variant, refs: refsBody(g, F) };
    if (g.seed) body.seed = Number(g.seed);
    if (pr.lot) {
      // un lot : une valeur par colonne, la même graine de l'une à l'autre (le serveur la tire une fois)
      const { prompt, count, ...card } = body;
      const values = pr.lot.on.map((t, k) => ({ value: t, prompt: promptOf(g, F, k).text }));
      const wh = M(g.model)?.sizes?.[quality(g)]?.[g.aspect];
      await launchLot(id, { kind: 'image', name: pr.lot.name, values, image: { ...card, count } }, g.count, wh ? wh[0] / wh[1] : 1);
      return;
    }
    await launch(id, async () => (await api('image/generate', { method: 'POST', body })).jobs, 'gen');
  }

  // ── le lot : un envoi, un cadre, une colonne par valeur ───────
  const PAD = 20, GAP = 14, CAP_GAP = 10, CELL = 220;
  // la hauteur d'une légende (une note : 13 px, interligne 1,5, 12 px de marge) : estimée
  // à la pose, relue sur la planche quand les images arrivent (les notes suivent leur texte)
  const capH = (t, w) => Math.round(24 + 19.5 * Math.max(1, Math.ceil(t.length / Math.max(8, Math.floor((w - 24) / 6.9)))));
  // `rows` rendus par valeur ; `ratio` : largeur / hauteur d'un rendu
  async function launchLot(id, body, rows, ratio) {
    if (busy(app.node(id))) { toast(BUSY_WHY, 5000); return false; }
    let r;
    try { r = await api('ideation/lot', { method: 'POST', body }); } catch (e) {
      const n = app.node(id);
      if (n) app.quiet(() => { n.error = e.message; });
      toast(e.message, 8000);
      return false;
    }
    const n = app.node(id);
    if (!n) return false;
    const values = body.values.map((v) => v.value);
    const cols = values.length, cw = CELL, ch = Math.round(CELL / (ratio || 1));
    let name = '';
    app.mutate((B) => {
      const band = Math.max(...values.map((t) => capH(t, cw)));
      const fw = 2 * PAD + cols * cw + (cols - 1) * GAP, fh = 2 * PAD + band + CAP_GAP + rows * ch + (rows - 1) * GAP;
      const [x, y] = app.freeSpot(n.x + n.w + 90, n.y, fw, fh);
      name = `${body.name} × ${cols}`;
      const f = { id: app.uid('n'), type: 'frame', x, y, w: fw, h: fh, name };
      B.nodes.unshift(f);
      values.forEach((t, i) => B.nodes.push({ id: app.uid('n'), type: 'note', x: x + PAD + i * (cw + GAP), y: y + PAD, w: cw, h: capH(t, cw), text: t }));
      B.links.push({ id: app.uid('l'), a: n.id, b: f.id, kind: 'out', label: '' });
      n.error = '';
      n.jobs = [...(n.jobs || []), ...r.jobs.map((j) => ({ id: j.id, act: 'lot', frame: f.id, col: j.col, row: j.row, dx: PAD + j.col * (cw + GAP), w: cw }))];
    });
    for (const j of r.jobs) { S.jobs.set(j.id, j); follow(id, j.id); }
    refreshCard(id);
    toast(`${r.jobs.length} travaux en file, graine ${r.seed} pour chaque valeur — le lot se pose dans le cadre « ${name} »`, 6000);
    return true;
  }
  // un rendu du lot à sa place : sa colonne, sous la légende (la plus haute du cadre), à son rang
  function placeInFrame(from, f, e, items) {
    const caps = S.board.nodes.filter((m) => m.type === 'note' && Math.abs(m.y - (f.y + PAD)) < 3 && m.x >= f.x && m.x + m.w <= f.x + f.w + 1);
    const top = caps.length ? PAD + Math.max(...caps.map((m) => m.h)) + CAP_GAP : PAD;
    for (const it of items) {
      const r = it.width && it.height ? it.width / it.height : 1;
      const w = Math.round(e.w || CELL), h = Math.round((e.w || CELL) / r);
      const x = f.x + (e.dx ?? PAD), y = f.y + top + (e.row || 0) * (h + GAP);
      const node = app.newMedia(it, x, y, w, h);
      S.board.nodes.push(node);
      S.board.links.push({ id: app.uid('l'), a: from.id, b: node.id, kind: 'out', label: '', lot: f.id });
      f.w = Math.max(f.w, x + w + PAD - f.x);
      f.h = Math.max(f.h, y + h + PAD - f.y);
    }
  }

  // « Voir le prompt envoyé » : ce qui part au modèle, valeur par valeur (‹ ›) — la route
  // /api/image/compose de l'outil Image, ou le plan de Vidéo (/api/movie/plan)
  function showSent(id) {
    const n = app.node(id);
    if (!n) return;
    const L0 = app.flowNow().prompt(id)?.lot;
    const L = L0 && !L0.conflict && L0.on.length ? L0 : null;
    const N = L ? L.on.length : 1;
    let k = 0, seq = 0;
    const head = el('div', { class: 'sent-h' });
    const pre = el('pre', { class: 'sent' });
    const notes = el('div', { class: 'sent-n' });
    const prev = el('button', { class: 'tb ghost sm', type: 'button', title: 'la valeur d’avant · ←', onclick: () => go(-1) }, '‹');
    const next = el('button', { class: 'tb ghost sm', type: 'button', title: 'la valeur suivante · →', onclick: () => go(1) }, '›');
    async function paint() {
      const my = ++seq;
      const g = app.node(id);
      if (!g) return;
      const F = app.flowNow();
      prev.disabled = k <= 0; next.disabled = k >= N - 1;
      head.replaceChildren(el('span', { class: 'lbl' }, L ? `${L.name} · ${k + 1} / ${N}` : 'une seule valeur'),
        L ? el('span', { class: 'sent-v' }, `« ${L.on[k]} »`) : null);
      pre.textContent = '…';
      notes.replaceChildren();
      try {
        if (g.type === 'gen') {
          const pr = promptOf(g, F, L ? k : null);
          const r = await api('image/compose', { method: 'POST', body: { model: g.model, prompt: pr.text, looks: looksOf(g, pr), refs: refsBody(g, F) } });
          if (my !== seq) return;
          pre.textContent = r.prompt || '—';
          notes.replaceChildren(...(r.notes || []).map((x) => el('p', { class: 'hint' }, x)),
            (() => {
              const k = Object.keys(looksOf(g, pr)).length;
              return el('p', { class: 'hint' }, `${M(g.model)?.name || g.model} · ${k ? `${k} pastille${k > 1 ? 's' : ''} de prise de vue, écrite${k > 1 ? 's' : ''} par l’outil Image${g.model === 'krea2' ? ' sans marque' : ' avec le matériel nommé'}` : 'aucune pastille de prise de vue'}`);
            })());
        } else {
          const pl = await api('movie/plan', { method: 'POST', body: { mode: g.mode, params: app.video.params(g, F, L ? k : null) } });
          if (my !== seq) return;
          pre.textContent = pl.prompt_sent || (pl.errors || []).join(' ; ') || '—';
          const lk = cleanLooks(F.prompt(id)?.looks);
          notes.replaceChildren(...(pl.errors || []).map((x) => el('p', { class: 'why' }, x)),
            Object.keys(lk).length ? el('p', { class: 'hint' }, 'Les pastilles de prise de vue ne vont pas à H3 : seule la ligne libre de la case Photographie passe.') : null);
        }
      } catch (e) { if (my === seq) pre.textContent = e.message; }
    }
    const go = (d) => { const k2 = Math.max(0, Math.min(N - 1, k + d)); if (k2 !== k) { k = k2; paint(); } };
    const keys = (e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } };
    document.addEventListener('keydown', keys, true);
    app.modal('Le prompt envoyé', el('div', { class: 'stack sent-box' }, head, pre, notes),
      N > 1 ? () => [prev, next, el('span', { class: 'sp' }), el('span', { class: 'lbl' }, `${N} valeurs · la même graine`)] : null,
      { cls: 'lg', onclose: () => document.removeEventListener('keydown', keys, true) });
    paint();
  }

  // « Composer » : le prompt écrit d'une carte part dans un composeur neuf, posé à gauche,
  // branché ; le texte dans une case Libre en tête, les cinq cases prêtes derrière. La prise de
  // vue de la carte passe dans sa case Photographie (une seule vérité ensuite : le composeur).
  function composeFrom(id) {
    const g = app.node(id);
    if (!g || !S.board) return;
    if (app.flowNow().prompt(id)) { toast('le prompt vient déjà d’un fil : détachez-le d’abord'); return; }
    const text = (g.prompt || '').trim();
    let c = null;
    app.mutate((B) => {
      const slots = newSlots(text ? ['libre', ...DEFAULT_ROLES] : DEFAULT_ROLES);
      if (text) slots[0].text = g.prompt;
      const photo = slots.find((s) => s.role === 'photo');
      if (g.type === 'gen' && Object.keys(cleanLooks(g.looks)).length) { photo.looks = cleanLooks(g.looks); g.looks = {}; }
      // sa hauteur, estimée pour lui trouver une place (la page la mesure ensuite) : une case ≈ 80 px
      const h = 150 + slots.length * 80;
      const [x, y] = app.freeSpot(g.x - 340 - 90, g.y, 340, h, { around: true });
      c = { id: app.uid('n'), type: 'compose', x, y, w: 340, h, slots };
      B.nodes.push(c);
      B.links = B.links.filter((l) => !(l.kind === 'wire' && l.b === g.id && l.pb === 'prompt'));
      B.links.push({ id: app.uid('l'), a: c.id, b: g.id, kind: 'wire', pa: 'text', pb: 'prompt', label: '' });
      g.prompt = '';
      S.sel = new Set([c.id]); S.link = null;
    });
    toast(text ? 'un composeur : le prompt est dans la case Libre — répartissez-le dans les cases, puis faites varier l’une d’elles' : 'un composeur branché sur la carte : remplissez ses cases');
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
    if (busy(app.node(id))) { toast(BUSY_WHY, 5000); return false; }
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
    refreshCard(id);
    toast(`${list.length > 1 ? list.length + ' travaux' : 'un travail'} en file — le résultat se posera à côté, relié`);
    return true;
  }

  // suivre un travail jusqu'au bout, puis poser ce qu'il a rendu
  function follow(nodeId, jobId) {
    if (followed.has(jobId)) return;
    followed.add(jobId);
    jobs.wait(jobId, (j) => { S.jobs.set(jobId, j); refreshCard(nodeId); })
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
    const entry = n?.jobs?.find((x) => x.id === j.id);
    const drop = () => { if (n?.jobs) n.jobs = n.jobs.filter((x) => x.id !== j.id); };
    if (j.state === 'done' && fresh.length && n) {
      // un rendu de lot va dans son cadre, s'il est encore là ; sinon à côté de la carte
      const f = entry?.frame ? app.node(entry.frame) : null;
      app.mutate(() => { drop(); if (f?.type === 'frame') placeInFrame(n, f, entry, fresh); else placeResults(n, fresh); });
    } else {
      app.quiet(() => { drop(); if (j.state === 'error' && (n?.type === 'gen' || n?.type === 'vgen')) n.error = j.message; });
      if (j.state === 'done' && fresh.length && !n) toast('le résultat est dans la bibliothèque (l’objet qui le demandait n’est plus sur la planche)');
    }
    if (j.state === 'error') toast(`échec : ${j.message}`, 9000);
    refreshCard(nodeId);
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

  return { card, cardKey, refresh, why, busy, BUSY_WHY, paintBtn, atChoices, refsOf, promptOf, looksOf, goText, quality, generate, variations, edit, recipe, resume, placeResults, launch,
    launchLot, showSent, composeFrom, M, KINDS,
    // pour l'inspecteur : d'où vient la prise de vue de la carte ('composer' : sa case Photographie)
    looksFrom: (g) => (promptOf(g).looks ? 'composer' : 'card') };
}
