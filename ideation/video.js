// IDÉATION — la carte « Générer vidéo » : les travaux de l'outil Vidéo
// (server/tools/movie.py : movie.t2v, movie.i2v, movie.r2v, moteur factice
// aujourd'hui), menés depuis la planche.
//
// Ses entrées suivent son mode, comme la page Vidéo (movie/movie.js) :
//   Texte       prompt
//   Images      prompt, première image, dernière image (une image chacune)
//   Références  prompt, images, éléments, vidéos, sons — appelés dans le
//               prompt par leur place : @image1, @element1, @video1, @audio1
//               (décision de Cal du 29/09), dans l'ordre des fils
// Les plafonds viennent de /api/movie/options (limits). Avant de lancer, la
// carte demande le plan au serveur (/api/movie/plan, la même vérité que la
// page Vidéo) : ses erreurs sont celles qu'elle affiche. Changer de mode
// refait les entrées à l'instant ; un fil qui ne va plus passe en alerte.
// Le résultat se pose à droite de la carte, relié ; sa sortie (une vidéo)
// se branche sur l'entrée vidéo d'une autre carte.
//
// Un lot (une case du composeur varie) : une vidéo par valeur cochée, la même
// graine, dans le plafond d'un envoi (/api/ideation/meta) ; le temps estimé du
// plan est multiplié par le nombre de rendus. Le lot tombe dans un cadre, une
// colonne par valeur (gen.js, launchLot). Les pastilles de prise de vue ne vont
// pas à H3 (son vocabulaire de caméra est à lui) : seule la ligne libre passe.

import { api, jobs, toast, el, href, dropZone, fmtDur, pick } from '../commun/shell.js';
import { KINDS, VMODES, inPorts, nameOf, cleanLooks } from './ports.js';
import { plab, inbox, badList, chip, lotCheck, composeBtn } from './gen.js';

const SLOTS_R2V = ['image', 'element', 'video', 'audio'];

export function createVideo(app) {
  const { S } = app;
  const plans = new Map();     // id → { sig, pl, err }
  const timers = new Map();
  const O = () => S.mopts;
  const modes = () => O()?.modes || Object.entries(VMODES).map(([id, label]) => ({ id, label }));
  const modeName = (id) => modes().find((m) => m.id === id)?.label || VMODES[id] || id;
  // le prompt : le texte d'un fil (d'un composeur : sa prose — la valeur k si une case varie —,
  // et son Son, sa Musique à part), sinon le champ
  const promptOf = (v, F = app.flowNow(), k = null) => F.prompt(v.id, k) || { text: v.prompt || '', from: null, link: null, son: '', musique: '', lot: null, looks: null };
  const lotOf = (v, F = app.flowNow()) => promptOf(v, F).lot;
  const canvasOf = (v) => (v.mode === 'i2v' && v.canvas === 'auto' ? 'auto'
    : (v.canvas && v.canvas !== 'auto' ? v.canvas : '1344x768').split('x').map(Number));

  // ce que la page Vidéo enverrait pour cette carte (movie.js, params) ; `k` : la valeur du lot
  function params(v, F = app.flowNow(), k = null) {
    const take = (pb) => F.take(v.id, pb).filter((e) => e.item);
    const pr = promptOf(v, F, k);
    const p = { desc: pr.text, sound: pr.son || v.sound || '', music: pr.musique || v.music || '', method: v.method || 'turbo', frames: v.frames,
      steps: null, seed: v.seed ? Number(v.seed) : null, canvas: canvasOf(v), loras: [], adv: {} };
    if (v.mode === 'i2v') { p.start = take('start')[0]?.item || ''; p.end = take('end')[0]?.item || ''; }
    if (v.mode === 'r2v') {
      p.inputs = Object.fromEntries(SLOTS_R2V.map((k) => [k, take(k).map((e) => ({ item: e.item }))]));
      p.ref_image_size = 'match';
    }
    return p;
  }

  // le plan du serveur, redemandé quand ce qui part change
  function schedulePlan(v) {
    const sig = JSON.stringify([v.mode, params(v)]);
    if (plans.get(v.id)?.sig === sig) return;
    clearTimeout(timers.get(v.id));
    timers.set(v.id, setTimeout(async () => {
      const cur = app.node(v.id);
      if (!cur) return;
      const s2 = JSON.stringify([cur.mode, params(cur)]);
      try {
        const pl = await api('movie/plan', { method: 'POST', body: { mode: cur.mode, params: params(cur) } });
        plans.set(v.id, { sig: s2, pl });
      } catch (e) { plans.set(v.id, { sig: s2, err: e.message }); }
      refresh(v.id);
      if (S.sel.has(v.id)) app.insp?.render();
    }, 260));
  }

  function why(v) {
    if (!O()) return S.moptsError ? `l’outil Vidéo ne répond pas : ${S.moptsError}` : 'lecture des réglages de Vidéo…';
    const F = app.flowNow();
    const pr = promptOf(v, F);
    const lw = lotCheck(app, pr.lot, 1, 'vidéo');
    if (lw) return lw;
    if (!pr.text.trim()) return pr.from ? `le prompt vient de ${nameOf(pr.from)} : il est vide` : 'écrivez la description (ce qu’on voit, ce qu’on entend), ou branchez un texte';
    const wait = Object.values(F.inputs(v.id)).flat().find((e) => e.ok && e.pending);
    if (wait) return `en attente : ${wait.pending}`;
    if (v.mode === 'i2v' && !F.take(v.id, 'start').length && !F.take(v.id, 'end').length) return 'branchez une première image, une dernière, ou les deux';
    if (v.mode === 'r2v' && !SLOTS_R2V.some((k) => F.take(v.id, k).length)) return 'branchez une entrée : une image, un élément, une vidéo ou un son';
    const sig = JSON.stringify([v.mode, params(v, F)]);
    const p = plans.get(v.id);
    if (!p || p.sig !== sig) { schedulePlan(v); return 'lecture du plan…'; }
    if (p.err) return `le plan ne répond pas : ${p.err}`;
    return p.pl.errors[0] || '';
  }
  const planOf = (v) => { const p = plans.get(v.id); return p && !p.err && p.sig === JSON.stringify([v.mode, params(v)]) ? p.pl : null; };
  // un lot : combien de rendus (les valeurs cochées), 1 sinon
  const renders = (v) => { const L = lotOf(v); return L && !L.conflict && L.on.length ? L.on.length : 1; };
  const goLabel = (v) => {
    const pl = planOf(v), n = renders(v);
    if (!pl?.ok) return 'Générer la vidéo';
    const s = `${pl.width}×${pl.height} · ${String(pl.seconds.toFixed(1)).replace('.', ',')} s`;
    return n > 1 ? `Générer ${n} × 1 · ${s}` : `Générer · ${s}`;
  };
  // le temps estimé (le plan de l'outil Vidéo) multiplié par le nombre de rendus
  const estimate = (v) => {
    const pl = planOf(v), n = renders(v);
    if (!pl?.estimate) return '';
    const lo = Math.round((pl.estimate.low * n) / 60), hi = Math.round((pl.estimate.high * n) / 60);
    return `estimé ${lo} à ${hi} min sur H3${n > 1 ? ` pour ${n} rendus` : ''} — ${pl.estimate.basis}`;
  };

  const cardKey = (v) => '|' + app.flow().sig(v.id) + (O() ? '|o' : '') + '|' + (O()?.engine || '');

  // une entrée de la carte : son étiquette (le port la vise) et ce qui y arrive
  function slot(v, port, all) {
    const ok = all.filter((e) => e.ok);
    const multi = port.max !== 1;
    const tok = port.token;
    const body = el('div', { class: 'grefs' + (port.max === 0 ? ' shut' : '') },
      ...all.map((e) => chip(app, e, e.ok ? e.idx + 1 : 0, { token: tok && e.ok ? `@${tok}${e.idx + 1}` : '' })),
      !all.length ? el('span', { class: 'ghint' }, port.id === 'start' ? 'branchez ou déposez l’image d’où part le plan'
        : port.id === 'end' ? 'facultatif : l’image où il finit' : `branchez ou déposez : @${tok}1, @${tok}2… dans le prompt`) : null);
    dropZone(body, { kinds: port.accepts, via: 'ideation', multiple: multi, onitems: (items) => app.feed(v.id, port.id, items) });
    const count = multi && port.max ? `${ok.length}/${port.max}` : '';
    return el('div', { class: 'prow', 'data-row': port.id }, plab('in', port.id, port.label, count), body);
  }

  function card(v) {
    const F = app.flow();
    const pr = F.prompt(v.id);
    const o = O();
    const ports = inPorts(v, app.caps());
    let field;
    if (pr) field = inbox(app, pr, 'la prose (et son Son, sa Musique) est copiée dans la carte');
    else {
      field = el('textarea', { class: 'fld gp', rows: 4, spellcheck: 'false',
        placeholder: v.mode === 'r2v' ? 'ce qu’on voit et entend, en anglais ; les entrées par leur place : @image1 walks…' : 'ce qu’on voit et entend, en anglais… ou branchez un texte' });
      field.value = v.prompt || '';
      let changed = () => {};
      field.addEventListener('focus', () => { changed = app.editing(); });
      field.addEventListener('input', () => { changed(); v.prompt = field.value; refresh(v.id); });
    }
    const seg = el('div', { class: 'seg vmodes' }, ...modes().map((m) => el('button', { class: 'tb' + (v.mode === m.id ? ' on' : ''), type: 'button',
      title: m.sub || '', onclick: () => { if (v.mode !== m.id) app.mutate(() => { v.mode = m.id; }); } }, m.label)));
    const frames = el('select', { class: 'fld sm', title: 'la durée : la grille d’H3 (17k+5 images à 24 i/s)' },
      ...(o?.frames || [{ frames: v.frames, seconds: v.frames / 24 }]).map((f) => el('option', { value: f.frames, selected: f.frames === v.frames ? true : null },
        `${String(f.seconds.toFixed(1)).replace('.', ',')} s`)));
    frames.addEventListener('change', () => app.mutate(() => { v.frames = Number(frames.value); }));
    const cur = Array.isArray(canvasOf(v)) ? canvasOf(v).join('x') : 'auto';
    const canv = el('select', { class: 'fld sm', title: 'la toile (les toiles d’H3 Studio et du banc de Cal)' },
      v.mode === 'i2v' ? el('option', { value: 'auto', selected: cur === 'auto' ? true : null }, 'd’après l’image') : null,
      ...(o?.canvases || []).map((c) => el('option', { value: `${c.w}x${c.h}`, selected: `${c.w}x${c.h}` === cur ? true : null }, `${c.w}×${c.h} · ${c.family}`)));
    canv.addEventListener('change', () => app.mutate(() => { v.canvas = canv.value; }));
    const btn = el('button', { class: 'gbtn', type: 'button', onclick: () => generate(v.id) }, 'Générer');
    const w = el('div', { class: 'gwhy why' });
    const stub = o && o.engine !== 'h3';
    const lk = pr ? cleanLooks(pr.looks) : {};
    setTimeout(() => refresh(v.id));
    return [
      el('div', { class: 'ghead', 'data-anchor': 'out:video' }, el('span', { class: 'lbl k' }, 'générer vidéo'), el('span', { class: 'lbl' }, modeName(v.mode)),
        el('span', { class: 'sp' }), stub ? el('span', { class: 'fac lbl', title: 'moteur factice de l’outil Vidéo : une vidéo d’essai (ffmpeg), pas H3' }, 'factice') : null),
      el('div', { class: 'gsum' }, (pr ? pr.text : v.prompt) || '—'),
      el('div', { class: 'gform' }, seg,
        el('div', { class: 'prow', 'data-row': 'prompt' }, el('div', { class: 'prow-h' }, plab('in', 'prompt', v.mode === 'r2v' ? 'prompt · @image1…' : 'prompt', pr ? 'fil' : ''),
          el('span', { class: 'sp' }), pr ? null : composeBtn(app, v.id)), field),
        Object.keys(lk).length ? el('span', { class: 'ghint', title: 'le guide d’H3 : le mouvement de caméra s’écrit dans la description, avec son vocabulaire' },
          'pastilles de prise de vue du composeur : ignorées par H3 (seule la ligne libre de Photographie passe)') : null,
        ...ports.filter((p) => p.id !== 'prompt').map((p) => slot(v, p, F.inputs(v.id)[p.id] || [])),
        el('div', { class: 'grow' }, frames, canv),
        el('div', { class: 'grow' }, btn, w),
        el('span', { class: 'ghint vest' }),
        badList(app, v.id)),
      v.error ? el('p', { class: 'gerr' }, v.error) : null,
    ];
  }

  function refresh(id) {
    const v = app.node(id);
    const e = app.canvas?.dom.get(id)?.el;
    if (!v || v.type !== 'vgen' || !e) return;
    const w = why(v);
    const btn = e.querySelector('.gbtn'), wy = e.querySelector('.gwhy'), sum = e.querySelector('.gsum'), est = e.querySelector('.vest');
    if (btn) { btn.disabled = !!w; btn.textContent = w ? 'Générer' : goLabel(v); }
    if (wy) wy.textContent = w;
    if (sum) sum.textContent = promptOf(v).text || '—';
    // un lot : le temps estimé multiplié par le nombre de rendus, sur la carte
    if (est) { est.textContent = !w && renders(v) > 1 ? estimate(v) : ''; est.hidden = !est.textContent; }
    paintGo(v);
  }

  async function generate(id) {
    const v = app.node(id);
    if (!v) return;
    const w = why(v);
    if (w) { toast(w, 6000); return; }
    const mode = v.mode;
    const F = app.flowNow();
    const L = lotOf(v, F);
    if (L) {
      // un lot : une vidéo par valeur, la même graine (le serveur la tire une fois si la carte n'en a pas)
      const pl = planOf(v);
      const values = L.on.map((t, k) => ({ value: t, params: params(v, F, k) }));
      await app.gen.launchLot(id, { kind: 'video', mode, name: L.name, values }, 1, pl ? pl.width / pl.height : 16 / 9);
      return;
    }
    const p = params(v);
    const title = (p.desc.replace(/@([\p{L}\p{N}_-]+)/gu, '$1').trim().replace(/\s+/g, ' ') || modeName(mode)).slice(0, 70);
    await app.gen.launch(id, async () => [await jobs.submit('movie.' + mode, p, { title, tool: 'movie' })], 'video');
  }

  // ── l'inspecteur ──────────────────────────────────────────
  function paintGo(v) {
    const box = document.getElementById('insp-vgo');
    if (!box || !S.sel.has(v.id)) return;
    const w = why(v);
    box.replaceChildren(el('button', { class: 'tb go block', type: 'button', disabled: w ? true : null, onclick: () => generate(v.id) }, w ? 'Générer la vidéo' : goLabel(v)),
      el('p', { class: w ? 'why' : 'hint' }, w || 'la vidéo se pose à droite de la carte, reliée'));
  }
  function panels(v, K) {
    const { card: cardP, b, row, hint } = K;
    const o = O();
    if (!o) return [cardP('Générer vidéo', null, hint(S.moptsError ? `L’outil Vidéo ne répond pas : ${S.moptsError}` : 'lecture des réglages de Vidéo…'))];
    const F = app.flowNow();
    const pr = F.prompt(v.id);
    const out = [];
    let field;
    if (pr) field = inbox(app, pr, 'la prose (et son Son, sa Musique) est copiée dans la carte');
    else {
      field = el('textarea', { class: 'fld', rows: 5, placeholder: v.mode === 'r2v' ? 'la description, en anglais : @image1, @element1… par leur place' : 'la description, en anglais' });
      field.value = v.prompt || '';
      let ch = () => {};
      field.addEventListener('focus', () => { ch = app.editing(); });
      field.addEventListener('input', () => {
        ch(); v.prompt = field.value;
        const c = app.canvas.dom.get(v.id)?.el.querySelector('textarea.gp');
        if (c) c.value = v.prompt;
        refresh(v.id);
      });
    }
    out.push(cardP('Générer vidéo', o.engine === 'h3' ? 'H3' : 'moteur factice',
      el('div', { class: 'seg' }, ...o.modes.map((m) => el('button', { class: 'tb' + (v.mode === m.id ? ' on' : ''), type: 'button', title: m.sub,
        onclick: () => { if (v.mode !== m.id) app.mutate(() => { v.mode = m.id; }); } }, m.label))),
      hint({ t2v: 'le prompt seul', i2v: 'le plan part de la première image, ou finit sur la dernière (movie.i2v)', r2v: 'des images, des éléments, des vidéos, des sons, appelés dans le prompt par leur place (movie.r2v)' }[v.mode] || ''),
      field,
      el('div', { class: 'go-row', id: 'insp-vgo' }),
      o.engine !== 'h3' ? el('p', { class: 'why' }, 'Moteur factice : l’outil Vidéo rend une vidéo d’essai (mire ffmpeg, les images posées dessus, un bip), pas H3. Le câblage s’allume dans showrunner.local.json (« movie_engine »).') : null));
    setTimeout(() => paintGo(v));
    // les entrées, dans l'ordre des fils
    const ports = inPorts(v, app.caps()).filter((p) => p.id !== 'prompt');
    if (ports.length) {
      out.push(cardP('Entrées', modeName(v.mode), ...ports.map((p) => {
        const list = F.inputs(v.id)[p.id] || [];
        const lines = list.map((e) => {
          const itemId = F.itemOf(e.from);
          const it = itemId ? S.items.get(itemId) : null;
          const k = list.filter((x) => x.ok).indexOf(e);
          return el('div', { class: 'rrow' + (e.ok ? '' : ' bad') },
            el('b', { class: 'rn' }, e.ok ? (p.token ? `@${p.token}${e.idx + 1}` : String(e.idx + 1)) : '×'),
            el('span', { class: 'rim', style: { backgroundImage: it?.thumb_url ? `url("${href(it.thumb_url)}")` : null } }),
            el('div', { class: 'rt' }, el('span', {}, it?.title || nameOf(e.from)), !e.ok ? el('small', { class: 'why' }, e.why) : e.pending ? el('small', { class: 'hint' }, e.pending) : null),
            e.ok && k > 0 ? b('↑', () => app.moveWire(e.link.id, -1), { title: 'passer avant : l’ordre fait les jetons' }) : null,
            b('×', () => app.cutLink(e.link.id), { title: 'couper ce fil' }));
        });
        return el('div', { class: 'stack sm' }, el('div', { class: 'row' }, el('span', { class: 'lbl' }, p.label), el('span', { class: 'sp' }),
          el('span', { class: 'lbl' }, p.max && p.max !== 1 ? `${list.filter((e) => e.ok).length}/${p.max}` : '')),
        lines.length ? el('div', { class: 'rlist' }, ...lines) : null,
        row(b('Depuis la bibliothèque', async () => {
          const got = await pick({ kinds: p.accepts, multiple: p.max !== 1, title: `${p.label} · vidéo` });
          if (got?.length) app.feed(v.id, p.id, got);
        })));
      }), hint(v.mode === 'r2v' ? 'Dans le prompt, chaque entrée par sa place : @image1, @element1, @video1, @audio1 — un personnage envoie son visage et son plein pied.'
        : 'Une image seulement ; un élément va en mode Références.')));
    }
    // durée, toile, méthode, graine, son
    const pl = planOf(v);
    const frames = el('select', { class: 'fld sm' }, ...o.frames.map((f) => el('option', { value: f.frames, selected: f.frames === v.frames ? true : null }, `${fmtDur(f.seconds)} · ${f.frames} images`)));
    frames.addEventListener('change', () => app.mutate(() => { v.frames = Number(frames.value); }));
    const cur = Array.isArray(canvasOf(v)) ? canvasOf(v).join('x') : 'auto';
    const canv = el('select', { class: 'fld sm' }, v.mode === 'i2v' ? el('option', { value: 'auto', selected: cur === 'auto' ? true : null }, 'd’après l’image') : null,
      ...o.canvases.map((c) => el('option', { value: `${c.w}x${c.h}`, selected: `${c.w}x${c.h}` === cur ? true : null, title: c.source }, `${c.w}×${c.h} · ${c.family} · ${c.label}`)));
    canv.addEventListener('change', () => app.mutate(() => { v.canvas = canv.value; }));
    const meth = el('select', { class: 'fld sm' }, ...o.methods.map((m) => el('option', { value: m.id, selected: m.id === v.method ? true : null, title: m.note }, m.label)));
    meth.addEventListener('change', () => app.mutate(() => { v.method = meth.value; }));
    const seed = el('input', { class: 'fld seed', value: v.seed || '', placeholder: 'graine au hasard', inputmode: 'numeric' });
    let c2 = () => {};
    seed.addEventListener('focus', () => { c2 = app.editing(); });
    seed.addEventListener('input', () => { c2(); seed.value = seed.value.replace(/\D/g, '').slice(0, 15); v.seed = seed.value; refresh(v.id); });
    // le son et la musique : les champs à part d'H3 ; d'un composeur branché s'il a ces cases
    const field2 = (k, ph, fromC) => {
      if (fromC) return el('p', { class: 'hint' }, `${k === 'sound' ? 'Son' : 'Musique'} : de la case du composeur — ${fromC}`);
      const t = el('textarea', { class: 'fld', rows: 2, placeholder: ph });
      t.value = v[k] || '';
      let c3 = () => {};
      t.addEventListener('focus', () => { c3 = app.editing(); });
      t.addEventListener('input', () => { c3(); v[k] = t.value; refresh(v.id); });
      return t;
    };
    const sound = el('div', { class: 'stack sm' },
      field2('sound', 'le son : ce qu’on entend (facultatif — sinon le son naturel de la scène)', pr?.son),
      field2('music', 'la musique hors champ (facultatif)', pr?.musique));
    out.push(cardP('Plan', pl ? `${pl.width} × ${pl.height} · ${String(pl.seconds.toFixed(1)).replace('.', ',')} s` : '',
      el('label', { class: 'look' }, el('span', { class: 'lbl' }, 'durée'), frames),
      el('label', { class: 'look' }, el('span', { class: 'lbl' }, 'toile'), canv),
      el('label', { class: 'look' }, el('span', { class: 'lbl' }, 'méthode'), meth),
      el('label', { class: 'look' }, el('span', { class: 'lbl' }, 'graine'), seed),
      sound,
      pl?.estimate ? hint(estimate(v)) : null,
      ...(pl?.notes || []).map((n) => el('p', { class: 'hint' }, n)),
      pl?.prompt_sent ? el('details', { class: 'pr' }, el('summary', { class: 'lbl' }, 'prompt envoyé à H3'), el('pre', { class: 'sent' }, pl.prompt_sent)) : null));
    return out;
  }

  return { card, cardKey, refresh, why, params, generate, panels, promptOf, goLabel, KINDS };
}
