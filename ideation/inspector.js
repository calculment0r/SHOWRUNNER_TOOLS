// IDÉATION — le panneau de droite : ce qui est choisi, ce qu'on peut en
// faire. Rien choisi : la planche (plan, liens, export). Un objet : ses
// réglages, « faire naître » (variations, nuancier, carte Générer),
// « éditer » (image.edit), « production » (les autres outils du portail,
// par les adresses qu'ils lisent déjà). Une carte Générer vidéo ou un
// composeur : leurs panneaux viennent de video.js et composer.js. Un fil :
// ce qu'il porte, d'où, vers quelle entrée, et s'il va. Un groupe : son nom,
// sa mise en forme, ses objets. Plusieurs : encadrer, relier, en faire des
// références ou un élément (aligner, distribuer, même taille, grouper : la
// barre au-dessus de la sélection, selection.js).

import { api, toast, el, href, fmtDate, fmtDur, etypeFr, dropZone } from '../commun/shell.js';
import { bbox, inside } from './canvas.js';
import { KINDS, nameOf, portOf } from './ports.js';
import { inbox } from './gen.js';
import { kidsOf, layoutOf } from './groups.js';

const ROLES = [['face', 'visage'], ['full body', 'plein pied'], ['outfit', 'tenue'], ['view', 'vue'], ['detail', 'détail'], ['style', 'style'], ['expression', 'expression']];

export function createInspector(app) {
  const { S } = app;
  const box = document.getElementById('insp');
  const drafts = new Map();   // la consigne d'édition en cours, par objet
  let pending = false;

  const card = (title, right, ...kids) => el('section', { class: 'card' },
    el('div', { class: 'card-h' }, el('span', { class: 'lbl' }, title), right ? el('span', { class: 'r' }, right) : null), ...kids);
  const b = (label, onclick, { title = '', disabled = false, cls = 'tb ghost sm' } = {}) =>
    el('button', { class: cls, type: 'button', title: title || null, disabled: disabled ? true : null, onclick }, label);
  const go = (label, url, title = '') => el('a', { class: 'tb ghost sm', href: href(url), target: '_blank', rel: 'noopener', title: title || null }, label, ' ↗');
  const row = (...kids) => el('div', { class: 'row' }, ...kids);
  const hint = (t) => el('p', { class: 'hint' }, t);

  // l'inspecteur ne se refait pas sous les doigts : il attend qu'on quitte le champ
  box.addEventListener('focusout', () => setTimeout(() => { if (pending && !box.contains(document.activeElement)) render(); }));
  function render() {
    const a = document.activeElement;
    // un champ où l'on écrit attend qu'on le quitte ; un sélecteur qu'on vient de changer, non (tout se refait à l'instant)
    if (a && box.contains(a) && a.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"])')) { pending = true; return; }
    pending = false;
    const top = box.scrollTop;
    let parts;
    if (!S.board) parts = [card('Planche', null, hint('Aucune planche ouverte.'), row(b('Les planches', () => app.boardsModal()), b('Nouvelle', () => app.newBoard())))];
    else if (S.link) parts = linkPanels();
    else if (!S.sel.size) parts = boardPanels();
    else if (S.sel.size === 1) parts = nodePanels(app.node([...S.sel][0]));
    else parts = multiPanels();
    box.replaceChildren(...parts.filter(Boolean));
    box.scrollTop = top;
  }

  // ── rien de choisi : la planche ─────────────────────────────
  function boardPanels() {
    const B = S.board;
    const frames = B.nodes.filter((n) => n.type === 'frame');
    const rest = B.nodes.filter((n) => n.type !== 'frame');
    const out = [];
    out.push(card('Planche', `${B.nodes.length} objets · ${B.links.length} liens`,
      el('h2', { class: 'ttl' }, B.name),
      el('p', { class: 'hint' }, `modifiée ${fmtDate(B.updated) || '—'} · elle s’enregistre seule`),
      row(b('Tout voir', () => app.canvas.fit(), { title: 'Maj+1' }),
        b('Exporter en PNG', () => app.exportBoard(''), { title: 'la planche entière, dans la bibliothèque (dossier Idéation)', disabled: !B.nodes.length })),
      !B.nodes.length ? hint('Exporter : posez d’abord quelque chose.') : null));
    // un objet d'un groupe se choisit dans son groupe (le groupe s'ouvre) ; caché dans une carte, on va à la carte
    const item = (n) => el('button', { class: 'oline' + (n.group ? ' kid' : ''), type: 'button', onclick: () => {
      const g = app.canvas.hiddenIn(n.id);
      if (g) { app.select([g]); app.canvas.fit(bbox([app.canvas.dispBox(app.node(g))])); return; }
      if (n.group) app.enter(n.id); else app.select([n.id]);
      app.canvas.fit(bbox([app.canvas.dispBox(n)]));
    } },
      el('i', { class: 'dot t-' + (n.type === 'media' ? n.kind : n.type), style: n.type === 'sticky' ? { background: `var(--${n.color})` } : null }),
      el('span', {}, app.label(n)), el('small', { class: 'lbl' }, app.kindLabel(n)));
    out.push(card('Plan', `${frames.length} cadre${frames.length > 1 ? 's' : ''}`,
      el('div', { class: 'olist' }, ...(B.nodes.length ? [...frames, ...rest].slice(0, 120).map(item) : [hint('rien encore')]))));
    const F = app.flowNow();
    out.push(card('Liens', String(B.links.length),
      el('div', { class: 'olist' }, ...(B.links.length ? B.links.slice(0, 80).map((l) => {
        const st = l.kind === 'wire' ? F.state(l.id) : null;
        const to = l.kind === 'wire' ? ` · ${portOf(app.node(l.b), l.pb, app.caps())?.label || l.pb}` : '';
        return el('div', { class: 'lline' + (S.link === l.id ? ' on' : '') + (st && !st.ok ? ' bad' : ''), title: st && !st.ok ? `ignoré : ${st.why}` : '' },
          l.kind === 'wire' ? el('i', { class: 'kd', style: { background: `var(--${KINDS[l.pa]?.color || 'ink3'})` } }) : null,
          el('button', { class: 'nm', type: 'button', onclick: () => app.selectLink(l.id) }, `${app.label(app.node(l.a))} → ${app.label(app.node(l.b))}${to}`),
          el('button', { class: 'cut', type: 'button', onclick: () => app.cutLink(l.id) }, 'Couper'));
      })
        : [hint('Tirez depuis la sortie d’un objet (le point à sa droite) jusqu’à une entrée : un texte vers un prompt, une image vers des références. L : une flèche d’annotation.')]))));
    out.push(card('Gestes', null, el('dl', { class: 'keys' }, ...[
      ['molette · pincer', 'zoomer'], ['espace + glisser', 'se déplacer'], ['glisser le fond', 'choisir (Alt : lasso)'],
      ['double-clic', 'poser, écrire'], ['N S T F G', 'note, post-it, titre, cadre, générer'], ['R K B D', 'forme, carte, mind map, crayon'], ['L', 'relier'],
      ['objet sur objet', 'un groupe (Alt : par-dessus)'], ['ctrl+G · ctrl+maj+G', 'grouper, dégrouper'],
      ['ctrl+Z · ctrl+maj+Z', 'annuler, rétablir'], ['ctrl+D · Suppr', 'dupliquer, supprimer'], ['[ ]', 'arrière, premier plan']]
      .flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]))));
    return out;
  }

  // ── un lien ─────────────────────────────────────────────────
  function linkPanels() {
    const l = S.board.links.find((x) => x.id === S.link);
    if (!l) { S.link = null; return boardPanels(); }
    const a = app.node(l.a), z = app.node(l.b);
    const lab = el('input', { class: 'fld', value: l.label || '', maxlength: 120, placeholder: 'un mot sur le lien (facultatif)' });
    let ch = () => {};
    lab.addEventListener('focus', () => { ch = app.editing(); });
    lab.addEventListener('input', () => { ch(); l.label = lab.value; app.canvas.paintLinks(); });
    const cut = b('Couper', () => { app.cutLink(l.id); S.link = null; render(); }, { title: 'Suppr' });
    if (l.kind === 'wire') {
      // un fil de données : ce qu'il porte, vers quelle entrée, s'il va
      const st = app.flowNow().state(l.id) || { ok: false, why: 'fil illisible' };
      const port = portOf(z, l.pb, app.caps());
      const k = KINDS[l.pa] || KINDS.text;
      return [card('Fil', k.label,
        el('p', { class: 'lk-ends' }, el('b', {}, nameOf(a)), ' → ', el('b', {}, nameOf(z)), ` · ${port?.label || l.pb}`),
        st.ok ? hint(st.pending ? `En attente : ${st.pending}.` : st.off ? 'La case est coupée : ce fil ne compte pas tant qu’elle l’est.'
          : l.pb === 'refs' ? `Référence ${st.idx + 1} de la carte, dans l’ordre des fils.` : port?.token ? `Dans le prompt : @${port.token}${st.idx + 1}.` : 'Il est lu à chaque génération : changer la source change ce qui part.')
          : el('p', { class: 'why' }, `Ignoré : ${st.why}. Il n’est pas envoyé ; il revient quand la carte le reprend (un autre modèle, un autre mode).`),
        lab, row(el('span', { class: 'sp' }), cut))];
    }
    return [card('Lien', l.kind === 'out' ? 'résultat' : 'annotation',
      el('p', { class: 'lk-ends' }, el('b', {}, app.label(a)), ' → ', el('b', {}, app.label(z))),
      hint(l.kind === 'out' ? 'La lignée : cet objet est né de l’autre.' : 'Une flèche d’annotation : elle ne porte rien. Pour qu’une image ou un texte parte dans une carte, tirez un fil depuis sa sortie.'),
      el('div', { class: 'seg' }, ...[['arrow', 'Flèche'], ['line', 'Ligne'], ['out', 'Résultat']].map(([k, v]) =>
        el('button', { class: 'tb' + (l.kind === k ? ' on' : ''), type: 'button', onclick: () => app.mutate(() => { l.kind = k; }) }, v))),
      lab,
      row(b('Inverser', () => app.mutate(() => { [l.a, l.b] = [l.b, l.a]; })), el('span', { class: 'sp' }), cut))];
  }

  // ── un objet ────────────────────────────────────────────────
  function nodePanels(n) {
    if (!n) return boardPanels();
    const out = [];
    const K = { card, b, row, hint };
    if (n.type === 'media') out.push(...mediaPanels(n));
    else if (n.type === 'gen') out.push(...genPanels(n));
    else if (n.type === 'vgen') out.push(...app.video.panels(n, K));
    else if (n.type === 'compose') out.push(...app.composer.panels(n, K));
    else if (n.type === 'frame') out.push(framePanel(n));
    else if (n.type === 'group') out.push(groupPanel(n));
    else if (n.type === 'palette') out.push(palettePanel(n));
    // formes, cartes, nœuds de mind map, traits (objets/)
    else if (app.objets?.has(n.type)) out.push(...app.objets.panels(n, K));
    else out.push(textPanel(n));
    out.push(card('Disposition', null, row(
      b('Dupliquer', () => app.duplicate(), { title: 'ctrl+D' }), b('Premier plan', () => app.order(1), { title: ']' }),
      b('Arrière-plan', () => app.order(-1), { title: '[' }), el('span', { class: 'sp' }), b('Supprimer', () => app.remove(), { title: 'Suppr' }))));
    return out;
  }

  function mediaPanels(n) {
    const it = S.items.get(n.item);
    if (!it || it.missing) {
      return [card('Absent', null, hint(`« ${n.title || n.item} » n’est plus dans la bibliothèque — à la corbeille d’Asset, d’où il peut revenir.`),
        row(go('Asset', 'asset/'), b('Retirer de la planche', () => app.remove())))];
    }
    const id = it.id;
    const out = [];
    const meta = [it.width && it.height ? `${it.width} × ${it.height}` : '', it.duration ? fmtDur(it.duration) : '',
      (it.origin?.model || it.origin?.tool || '').replace(/-factice$/, ' (factice)'), fmtDate(it.created)].filter(Boolean).join(' · ');
    const kindT = { image: 'Image', video: 'Vidéo', audio: 'Son', element: etypeFr(it.element?.type) }[n.kind] || 'Objet';
    out.push(card(kindT, null, el('h2', { class: 'ttl' }, it.title || id), el('p', { class: 'hint' }, meta),
      it.prompt ? el('details', { class: 'pr' }, el('summary', { class: 'lbl' }, 'prompt envoyé'), el('pre', { class: 'sent' }, it.prompt)) : null,
      row(go('Dans Asset', `asset/#${id}`, 'sa fiche : recette, lignée'),
        n.kind === 'image' || n.kind === 'video' ? b('Voir en grand', () => app.lightbox(n)) : null)));
    if (n.kind === 'image') {
      const rec = app.gen.recipe(it);
      out.push(card('Faire naître', null,
        row(b('Variations ×4', () => app.gen.variations(n.id, 4), { disabled: !rec, title: 'la même recette, quatre autres graines (outil Image)' }),
          b('Nuancier', () => app.palette(n.id), { title: 'les couleurs dominantes, posées dessous' }),
          b('Carte Générer', () => app.genWith([n.id]), { title: 'une carte qui prend cette image en référence' })),
        rec ? null : el('p', { class: 'why' }, 'Variations : image sans recette (déposée ou faite ailleurs) — une carte Générer la prend en référence.')));
      const d = drafts.get(n.id) || { prompt: '', model: 'qwen21' };
      drafts.set(n.id, d);
      const ta = el('textarea', { class: 'fld', rows: 3, id: 'insp-edit', placeholder: d.model === 'qwen21' ? 'la consigne, en anglais : « Change the jacket in <image1> to red leather »' : 'la consigne, en anglais : « Recolor the jacket to red leather »' });
      ta.value = d.prompt;
      const run = b('Éditer', () => app.gen.edit(n.id, { tool: 'instruct', model: d.model, prompt: d.prompt }), { disabled: !d.prompt.trim() });
      const why = el('span', { class: 'why' }, d.prompt.trim() ? '' : 'écrivez une consigne');
      ta.addEventListener('input', () => { d.prompt = ta.value; run.disabled = !d.prompt.trim(); why.textContent = d.prompt.trim() ? '' : 'écrivez une consigne'; });
      out.push(card('Éditer', 'image.edit',
        el('div', { class: 'seg' }, ...[['qwen21', 'Qwen 2.1'], ['krea2', 'Krea 2']].map(([k, v]) =>
          el('button', { class: 'tb' + (d.model === k ? ' on' : ''), type: 'button', onclick: () => { d.model = k; render(); } }, v))),
        ta, row(run, why),
        row(b('Détourer', () => app.gen.edit(n.id, { tool: 'matte' }), { title: 'BiRefNet : le sujet seul, fond transparent' }),
          b('Agrandir ×2', () => app.gen.edit(n.id, { tool: 'upscale', factor: 2 }), { title: 'SeedVR2', disabled: Math.max(it.width || 0, it.height || 0) * 2 > 8192 })),
        hint('Le résultat se pose à droite, relié à l’image. Plus d’outils (zone peinte, angle, affiner) : Éditer dans Image.')));
      out.push(card('Production', null, el('div', { class: 'prod' },
        go('Éditer dans Image', `image/#${id}`, 'l’outil Image, cette image ouverte'),
        go('Animer', `movie/?start=${id}`, 'Vidéo : cette image en première image d’un plan'),
        go('Référence vidéo', `movie/?ref=${id}`, 'Vidéo : cette image en référence d’un plan'),
        go('Ajouter au montage', `montage/?add=${id}`),
        b('Faire un élément', () => app.elementModal([n.id]), { title: 'un personnage, un objet, un lieu, un style réutilisable partout' }))));
    } else if (n.kind === 'video') {
      out.push(card('Production', null, el('div', { class: 'prod' },
        go('Référence vidéo', `movie/?ref=${id}`, 'Vidéo : ce mouvement en référence'),
        go('Ajouter au montage', `montage/?add=${id}`))));
    } else if (n.kind === 'audio') {
      out.push(card('Production', null, el('div', { class: 'prod' },
        go('Ajouter au montage', `montage/?add=${id}`),
        go('Référence vidéo', `movie/?ref=${id}`, 'Vidéo : cette voix en référence'))));
    } else if (n.kind === 'element') {
      const refs = it.element?.refs || [];
      out.push(card('Références', `${refs.length}`,
        el('div', { class: 'erefs' }, ...refs.map((r) => el('i', { title: `${r.label || ''} · ${r.role || ''}`, style: { backgroundImage: `url("${href(r.thumb_url)}")` } },
          el('span', {}, r.label || r.role || '')))),
        it.element?.description ? el('p', { class: 'hint' }, it.element.description) : null));
      out.push(card('Faire naître', null, row(b('Carte Générer', () => app.genWith([n.id]), { title: 'une carte qui prend cet élément en référence' }),
        b('Nuancier', () => app.palette(n.id)))));
      out.push(card('Production', null, el('div', { class: 'prod' },
        go('Référence vidéo', `movie/?ref=${id}`, 'Vidéo : cet élément dans un plan'),
        it.element?.source?.open ? el('a', { class: 'tb ghost sm', href: it.element.source.open, target: '_blank', rel: 'noopener' }, 'Character Factory ↗') : null)));
    }
    return out;
  }

  function textPanel(n) {
    const ta = el('textarea', { class: 'fld', rows: n.type === 'title' ? 2 : 5, placeholder: 'le texte', 'data-reg': 'text' });
    ta.value = n.text || '';
    let ch = () => {};
    ta.addEventListener('focus', () => { ch = app.editing(); });
    ta.addEventListener('input', () => { ch(); n.text = ta.value; app.canvas.renderSoon(); });
    const name = { note: 'Note', sticky: 'Post-it', title: 'Titre' }[n.type];
    const outs = S.board.links.filter((l) => l.kind === 'wire' && l.a === n.id).map((l) => nameOf(app.node(l.b)));
    return card(name, outs.length ? `${outs.length} fil${outs.length > 1 ? 's' : ''}` : null, ta,
      outs.length ? hint(`Ce texte part vers : ${outs.join(', ')} — le changer les change.`)
        : hint('Tirez sa sortie (le point à droite) vers le prompt d’une carte, ou lâchez-le sur un autre texte : un composeur.'),
      n.type === 'sticky' ? el('div', { class: 'swatches' }, ...(S.meta?.sticky || []).map((c) =>
        el('button', { class: 'swc' + (n.color === c.id ? ' on' : ''), type: 'button', title: c.id, style: { background: `var(--${c.id})` },
          onclick: () => { app.mutate(() => { n.color = c.id; }); app.LS('sticky', c.id); } }))) : null,
      n.type === 'title' ? el('div', { class: 'seg' }, ...[['s', 'Petit'], ['m', 'Moyen'], ['l', 'Grand']].map(([k, v]) =>
        el('button', { class: 'tb' + (n.size === k ? ' on' : ''), type: 'button', onclick: () => app.mutate(() => { n.size = k; }) }, v))) : null,
      hint('double-clic sur l’objet : écrire sur place'));
  }

  function framePanel(n) {
    const inner = S.board.nodes.filter((m) => m !== n && inside(m, n));
    const imgs = inner.filter((m) => m.type === 'media' && m.kind === 'image' && !S.items.get(m.item)?.missing);
    const name = el('input', { class: 'fld', value: n.name || '', maxlength: 120, placeholder: 'le nom du cadre', 'data-reg': 'name' });
    let ch = () => {};
    name.addEventListener('focus', () => { ch = app.editing(); });
    name.addEventListener('input', () => { ch(); n.name = name.value; app.render(); });
    return card('Cadre', `${inner.length} objet${inner.length > 1 ? 's' : ''}`, name,
      row(b('Exporter ce cadre', () => app.exportBoard(n.id), { title: 'en PNG, dans la bibliothèque (dossier Idéation)' }),
        b('Voir', () => app.canvas.fit(bbox([n]))),
        b('Choisir son contenu', () => app.select(inner.map((m) => m.id)), { disabled: !inner.length })),
      row(b(`Faire un élément (${imgs.length} image${imgs.length > 1 ? 's' : ''})`, () => app.elementModal(imgs.map((m) => m.id), n.name),
        { disabled: !imgs.length, title: 'une planche d’ambiance → un élément « style » ou « lieu », pris en référence par Image et Vidéo' })),
      imgs.length ? null : el('p', { class: 'why' }, 'Faire un élément : posez des images dans ce cadre.'),
      hint('Déplacer le cadre emmène ce qu’il contient. Double-clic sur son nom : le renommer.'));
  }

  // un groupe : une appartenance (pas une zone) — son nom, sa mise en forme, ses objets
  function groupPanel(g) {
    const G = app.groups;
    const kids = kidsOf(S.board, g.id);
    const L = layoutOf(g);
    const name = el('input', { class: 'fld', value: g.name || '', maxlength: 120, placeholder: 'le nom du groupe', 'data-reg': 'name' });
    let ch = () => {};
    name.addEventListener('focus', () => { ch = app.editing(); });
    name.addEventListener('input', () => { ch(); g.name = name.value; app.canvas.renderSoon(); });
    const seg = (items) => el('div', { class: 'seg' }, ...items.map(([on, label, fn, title]) => el('button', { class: 'tb' + (on ? ' on' : ''), type: 'button', title, onclick: fn }, label)));
    const gens = kids.filter((k) => k.type === 'gen' || k.type === 'vgen').length;
    return card('Groupe', `${kids.length} objet${kids.length > 1 ? 's' : ''}${gens ? ` · ${gens} génération${gens > 1 ? 's' : ''}` : ''}`, name,
      seg([[L.mode !== 'flow', 'Libre', () => G.flow(g.id, false), 'les objets restent où on les pose'],
        [L.mode === 'flow', 'Rangée', () => G.flow(g.id, true), 'à la suite, à la ligne quand la largeur est atteinte']]),
      seg([[!L.fit, 'Libres', () => G.setLayout(g.id, { fit: '' }), 'chacun sa taille'],
        [L.fit === 'h', 'Même hauteur', () => G.setLayout(g.id, { fit: 'h' }), 'la hauteur du premier ; une image garde ses proportions'],
        [L.fit === 'w', 'Même largeur', () => G.setLayout(g.id, { fit: 'w' }), 'la largeur du premier']]),
      row(el('span', { class: 'lbl' }, `espacement ${Math.round(L.gap)} px`), el('span', { class: 'sp' }),
        b('−', () => G.gap(g.id, -8), { disabled: L.mode !== 'flow' || L.gap <= 0, title: L.mode !== 'flow' ? 'en rangée seulement' : '8 px de moins' }),
        b('+', () => G.gap(g.id, 8), { disabled: L.mode !== 'flow', title: L.mode !== 'flow' ? 'en rangée seulement' : '8 px de plus' })),
      L.mode !== 'flow' ? el('p', { class: 'why' }, 'Espacement : passez en Rangée (ou tirez la pastille à droite du cadre).') : null,
      el('label', { class: 'tog' }, (() => {
        const c = el('input', { type: 'checkbox', checked: g.lod ? true : null });
        c.addEventListener('change', () => G.lod(g.id));
        return c;
      })(), el('span', {}, 'Se réduit de loin'), el('small', { class: 'lbl' }, 'une carte sous 42 %, quand il fait moins de 240 px')),
      row(g.collapsed ? b('Déplier', () => G.collapse(g.id, false), { title: 'double-clic sur la carte' }) : b('Réduire', () => G.collapse(g.id, true), { title: 'une carte à ports' }),
        b('Dégrouper', () => G.ungroup([g.id]), { title: 'ctrl+maj+G' })),
      el('div', { class: 'olist' }, ...kids.map((k) => el('button', { class: 'oline', type: 'button', disabled: g.collapsed ? true : null,
        title: g.collapsed ? 'dépliez le groupe pour choisir un de ses objets' : 'le choisir dans le groupe (double-clic sur la planche)', onclick: () => app.enter(k.id) },
      el('i', { class: 'dot t-' + (k.type === 'media' ? k.kind : k.type), style: k.type === 'sticky' ? { background: `var(--${k.color})` } : null }),
      el('span', {}, app.label(k)), el('small', { class: 'lbl' }, app.kindLabel(k))))),
      hint('Un clic sur un objet choisit le groupe, un double-clic l’objet (Échap remonte). Lâcher un objet sur un objet du groupe l’y ajoute ; le glisser à plus de 32 px du groupe l’en sort.'));
  }

  function palettePanel(n) {
    return card('Nuancier', `${(n.colors || []).length} couleurs`,
      el('div', { class: 'pal' }, ...(n.colors || []).map((c) => el('button', { class: 'pc', type: 'button', title: 'copier',
        onclick: () => navigator.clipboard?.writeText(c).then(() => toast(`${c} copiée`), () => toast(c)) },
      // une couleur tirée d'une image : une donnée, pas une teinte du thème
      el('i', { style: { background: c } }), el('span', {}, c)))),
      row(b('Tout copier', () => navigator.clipboard?.writeText((n.colors || []).join(' ')).then(() => toast('couleurs copiées'), () => {}))),
      hint('Quantification médiane (PIL) de l’image d’origine, de la plus présente à la moins présente.'));
  }

  // ── la carte Générer ────────────────────────────────────────
  function genPanels(n) {
    const G = app.gen;
    const cfg = S.cfg;
    if (!cfg) return [card('Générer', null, hint(S.cfgError ? `L’outil Image ne répond pas : ${S.cfgError}` : 'lecture des modèles…'))];
    const m = G.M(n.model);
    const q = G.quality(n);
    const out = [];
    const F = app.flowNow();
    const pr = F.prompt(n.id);
    let ta;
    if (pr) {
      ta = inbox(app, pr, 'la prose est copiée dans le prompt de la carte');
      if (pr.son || pr.musique) ta.append(el('p', { class: 'why' }, 'Son et Musique du composeur ne vont qu’à la vidéo : ignorés ici.'));
    } else {
      ta = el('textarea', { class: 'fld', rows: 5, id: 'insp-prompt', placeholder: 'le prompt, en anglais — ou branchez un texte, un composeur', 'data-reg': 'prompt' });
      ta.value = n.prompt || '';
      let ch = () => {};
      ta.addEventListener('focus', () => { ch = app.editing(); });
      ta.addEventListener('input', () => {
        ch(); n.prompt = ta.value;
        const c = app.canvas.dom.get(n.id)?.el.querySelector('textarea.gp');
        if (c) c.value = n.prompt;
        G.refresh(n.id); paintGo(n);
      });
    }
    out.push(card('Générer image', cfg.backend === 'stub' ? 'moteur factice' : m?.name,
      el('div', { class: 'models' }, ...cfg.models.map((x) => el('button', { class: 'opt model' + (n.model === x.id ? ' on' : ''), type: 'button', title: x.role,
        onclick: () => { app.mutate(() => { n.model = x.id; }); app.LS('gen-model', x.id); } },
      el('b', {}, x.name), el('small', {}, x.refs ? `${x.refs} réf. au plus` : 'texte seul')))),
      m ? el('p', { class: 'hint' }, m.role) : null,
      ta,
      el('div', { class: 'go-row', id: 'insp-go' }),
      cfg.backend === 'stub' ? el('p', { class: 'why' }, 'Moteur factice : l’outil Image rend des mires dessinées, aucun modèle n’est chargé. Le câblage réel s’allume dans showrunner.local.json (« image_backend »).') : null));
    setTimeout(() => paintGo(n));

    // les références : tous les fils de l'entrée, dans leur ordre ; ceux qui ne vont plus disent pourquoi
    const all = F.inputs(n.id).refs || [];
    const refs = all.filter((e) => e.ok);
    const refCard = card('Références', m ? `${refs.length} / ${m.refs}` : String(refs.length),
      all.length ? el('div', { class: 'rlist' }, ...all.map((e) => {
        const itemId = F.itemOf(e.from);
        const it = itemId ? S.items.get(itemId) : null;
        const erefs = it?.kind === 'element' ? it.element?.refs || [] : [];
        return el('div', { class: 'rrow' + (e.ok ? '' : ' bad') },
          el('b', { class: 'rn' }, e.ok ? String(e.idx + 1) : '×'),
          el('span', { class: 'rim', style: { backgroundImage: it?.thumb_url ? `url("${href(it.thumb_url)}")` : null } }),
          el('div', { class: 'rt' }, el('span', {}, it?.title || nameOf(e.from)),
            !e.ok ? el('small', { class: 'why' }, e.why) : e.pending ? el('small', { class: 'hint' }, e.pending) : null,
            e.ok && erefs.length ? (() => {
              const s = el('select', { class: 'fld sm', title: 'quelle image de l’élément envoyer' },
                ...erefs.map((x) => el('option', { value: x.file, selected: (n.refChoice?.[itemId] || erefs[0].file) === x.file ? true : null },
                  `${x.label || x.role || x.file}${x.role ? ' · ' + x.role : ''}`)));
              s.addEventListener('change', () => app.mutate(() => { n.refChoice = { ...(n.refChoice || {}), [itemId]: s.value }; }));
              return s;
            })() : null),
          e.ok && e.idx > 0 ? b('↑', () => app.moveWire(e.link.id, -1), { title: 'passer avant (l’ordre des références compte)' }) : null,
          b('×', () => app.cutLink(e.link.id), { title: 'couper ce fil' }));
      })) : null,
      hint(n.model === 'qwen21' ? 'dans l’ordre : <image1>, <image2>, <image3> — nommez-les dans le prompt'
        : n.model === 'krea2' ? '1 référence : la personne ou l’objet à reprendre · 2 : la scène d’abord, puis le sujet'
          : m?.refs_why || 'ce modèle ne prend pas de référence'),
      row(b('Ajouter depuis la bibliothèque', () => app.pickRefs(n.id), { disabled: m && refs.length >= m.refs,
        title: m && refs.length >= m.refs ? (m.refs ? `${m.name} prend ${m.refs} références au plus` : m.refs_why) : 'posées à gauche de la carte, branchées' })),
      hint('On peut aussi y déposer un fichier du disque ou une vignette de la bibliothèque.'));
    // tout bloc qui attend un asset accepte un dépôt (règle de Cal, 29/09)
    dropZone(refCard, { kinds: ['image', 'element'], via: 'ideation', onitems: (items) => app.addRefs(n.id, items) });
    out.push(refCard);

    // format, taille, nombre
    const sizes = m?.sizes[q] || {};
    out.push(card('Format', sizes[n.aspect] ? `${sizes[n.aspect][0]} × ${sizes[n.aspect][1]}` : '',
      el('div', { class: 'opts' }, ...cfg.aspects.map((a) => el('button', { class: 'opt' + (n.aspect === a ? ' on' : ''), type: 'button', disabled: sizes[a] ? null : true,
        title: sizes[a] ? `${sizes[a][0]} × ${sizes[a][1]}` : 'non documenté pour ce modèle à cette taille', onclick: () => app.mutate(() => { n.aspect = a; }) }, a))),
      m ? el('div', { class: 'opts' }, ...m.quality.map((x) => el('button', { class: 'opt' + (q === x.id ? ' on' : ''), type: 'button',
        onclick: () => app.mutate(() => { n.quality = x.id; }) }, x.label))) : null,
      n.model === 'zimage' && m?.variants ? el('div', { class: 'opts' }, ...m.variants.map((v) => el('button', { class: 'opt' + (n.variant === v.id ? ' on' : ''), type: 'button',
        onclick: () => app.mutate(() => { n.variant = v.id; }) }, v.label))) : null,
      n.model === 'krea2' ? el('label', { class: 'tog' }, (() => {
        const c = el('input', { type: 'checkbox', checked: n.realism ? true : null });
        c.addEventListener('change', () => app.mutate(() => { n.realism = c.checked; }));
        return c;
      })(), el('span', {}, 'UltraReal 0,7'), el('small', { class: 'lbl' }, 'LoRA photo · sans effet avec une référence')) : null,
      row(el('span', { class: 'lbl' }, 'nombre'), el('div', { class: 'seg' }, ...[1, 2, 3, 4].map((k) => el('button', { class: 'tb' + (n.count === k ? ' on' : ''), type: 'button',
        onclick: () => app.mutate(() => { n.count = k; }) }, String(k)))), el('span', { class: 'sp' }),
      (() => {
        const s = el('input', { class: 'fld seed', value: n.seed || '', placeholder: 'graine au hasard', inputmode: 'numeric', title: 'la même graine et la même recette refont la même image' });
        let c2 = () => {};
        s.addEventListener('focus', () => { c2 = app.editing(); });
        s.addEventListener('input', () => { c2(); s.value = s.value.replace(/\D/g, '').slice(0, 15); n.seed = s.value; });
        return s;
      })())));

    // prise de vue : les pastilles de l'outil Image, une liste par groupe — cachées quand
    // la case Photographie d'un composeur branché les porte (composer.js, gen.looksFrom)
    if (app.gen.looksFrom?.(n) !== 'composer') out.push(card('Prise de vue', Object.keys(n.looks || {}).length ? `${Object.keys(n.looks).length} réglage${Object.keys(n.looks).length > 1 ? 's' : ''}` : 'aucune',
      ...cfg.looks.map((g) => {
        const s = el('select', { class: 'fld sm', title: g.about || '' }, el('option', { value: '' }, '—'),
          ...g.items.map((x) => el('option', { value: x.id, selected: n.looks?.[g.id] === x.id ? true : null, title: `source : ${x.src}` },
            `${x.name}${x.sub ? ' · ' + x.sub.toLowerCase() : ''}`)));
        s.addEventListener('change', () => app.mutate(() => {
          const L = { ...(n.looks || {}) };
          if (s.value) L[g.id] = s.value; else delete L[g.id];
          n.looks = L;
        }));
        return el('label', { class: 'look' }, el('span', { class: 'lbl' }, g.label), s);
      }),
      hint('Les phrases de l’outil Image (étude image.md §4), ajoutées au prompt : sans marque pour Krea 2.')));
    return out;
  }
  // le seul bouton orange de l'écran : générer la carte choisie
  function paintGo(n) {
    const box2 = document.getElementById('insp-go');
    if (!box2) return;
    const w = app.gen.why(n);
    // le libellé de la carte elle-même (gen.goText : « Générer 3 × 2 » pour un lot)
    const label = app.gen.goText ? app.gen.goText(n) : `Générer${n.count > 1 ? ' ' + n.count + ' images' : ''}`;
    box2.replaceChildren(el('button', { class: 'tb go block', type: 'button', disabled: w ? true : null, onclick: () => app.gen.generate(n.id) },
      label), el('p', { class: w ? 'why' : 'hint' }, w || 'les images se posent à droite de la carte, reliées'));
  }
  function syncPrompt(id) {
    const ta = document.getElementById('insp-prompt');
    const n = app.node(id);
    if (ta && n && S.sel.has(id) && document.activeElement !== ta) ta.value = n.prompt || '';
    if (n && S.sel.has(id)) paintGo(n);
  }

  // ── plusieurs objets ────────────────────────────────────────
  function multiPanels() {
    const list = [...S.sel].map((id) => app.node(id)).filter(Boolean);
    const all = app.groups.expand(list);
    const refable = all.filter((n) => n.type === 'media' && ['image', 'element'].includes(n.kind) && !S.items.get(n.item)?.missing);
    const imgs = refable.filter((n) => n.kind === 'image');
    const why = app.groups.whyNot(list);
    return [card(`${list.length} objets`, all.length > list.length ? `${all.length} avec les groupes` : null,
      hint('Aligner, distribuer, même hauteur ou largeur, ranger, grouper : la barre au-dessus de la sélection. Les coins du cadre mettent à l’échelle, la pastille à droite range.'),
      row(b('Grouper', () => app.groups.group(), { title: why || 'ctrl+G', disabled: !!why }),
        b('Encadrer', () => app.frameAround(), { title: 'un cadre autour de la sélection · ctrl+alt+G' }),
        b('Relier dans l’ordre', () => app.chain(), { title: 'des liens de l’un à l’autre, dans l’ordre où vous les avez choisis' })),
      why && list.length > 1 ? el('p', { class: 'why' }, `Grouper : ${why}.`) : null),
    card('Faire naître', null,
      row(b(`Carte Générer (${refable.length} réf.)`, () => app.genWith(refable.map((n) => n.id)), { disabled: !refable.length }),
        b(`Faire un élément (${imgs.length})`, () => app.elementModal(imgs.map((n) => n.id)), { disabled: !imgs.length })),
      !refable.length ? el('p', { class: 'why' }, 'choisissez des images ou des éléments pour en faire des références') : null),
    card('Disposition', null, row(b('Dupliquer', () => app.duplicate(), { title: 'ctrl+D' }), el('span', { class: 'sp' }),
      b('Supprimer', () => app.remove(), { title: 'Suppr' })))];
  }

  // ── un élément fait sur la planche ──────────────────────────
  function elementModal(ids, name = '') {
    const nodes = ids.map((id) => app.node(id)).filter((n) => n && n.type === 'media' && n.kind === 'image');
    if (!nodes.length) return;
    const first = S.items.get(nodes[0].item);
    const title = el('input', { class: 'fld', value: name || first?.title || '', maxlength: 120, placeholder: 'son nom' });
    const type = el('select', { class: 'fld' }, ...(S.meta?.element_types || ['character', 'object', 'place', 'style', 'other'])
      .map((t) => el('option', { value: t, selected: t === (nodes.length > 1 ? 'style' : 'character') ? true : null }, etypeFr(t))));
    const role = el('select', { class: 'fld' }, ...ROLES.map(([k, v]) => el('option', { value: k, selected: k === (nodes.length > 1 ? 'style' : 'face') ? true : null }, v)));
    const desc = el('textarea', { class: 'fld', rows: 3, placeholder: 'une description en prose, lue par les modèles (facultatif)' });
    const strip = el('div', { class: 'erefs' }, ...nodes.map((n) => el('i', { style: { backgroundImage: `url("${href(S.items.get(n.item)?.thumb_url || '')}")` } })));
    app.modal('Faire un élément', el('div', { class: 'stack' }, strip,
      el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'nom'), title),
      el('div', { class: 'row' }, el('label', { class: 'field fgrow' }, el('span', { class: 'lbl' }, 'sorte'), type),
        el('label', { class: 'field fgrow' }, el('span', { class: 'lbl' }, `rôle de ${nodes.length > 1 ? 'ces images' : 'l’image'}`), role)),
      el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'description'), desc),
      el('p', { class: 'hint' }, 'Un élément se réutilise partout : Image et Vidéo le prennent en référence ; il se retrouve dans Asset.')),
    (close) => [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: close }, 'Annuler'),
      el('button', { class: 'tb go', type: 'button', onclick: async () => {
        if (!title.value.trim()) { title.focus(); return; }
        let it;
        try {
          it = await api('elements', { method: 'POST', body: { title: title.value.trim(), type: type.value, description: desc.value.trim(),
            refs: nodes.map((n) => ({ item: n.item, role: role.value })) } });
        } catch (e) { toast(e.message, 7000); return; }
        close();
        S.items.set(it.id, it);
        const r = bbox(nodes);
        const [w, h] = app.sizeFor(it, 220);
        const [x, y] = app.freeSpot(r.x + r.w + 70, r.y, w, h);
        app.mutate((B) => {
          const e = app.newMedia(it, x, y, w, h);
          B.nodes.push(e);
          for (const n of nodes) B.links.push({ id: app.uid('l'), a: n.id, b: e.id, kind: 'out', label: '' });
          S.sel = new Set([e.id]);
        });
        app.lib?.reload();
        toast(`« ${it.title} » est un élément — dans Asset, et en référence dans Image et Vidéo`);
      } }, 'Créer l’élément')]);
  }

  // « Éditer » depuis la barre de la sélection : la consigne d'édition de l'image, au clavier
  function focusEdit(id) {
    if (!S.sel.has(id)) app.select([id]);
    render();
    const ta = document.getElementById('insp-edit');
    if (!ta) return;
    ta.scrollIntoView({ block: 'center', behavior: 'smooth' });
    ta.focus({ preventScroll: true });
  }

  return { render, syncPrompt, elementModal, focusEdit };
}
