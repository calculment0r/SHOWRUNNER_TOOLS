// IDÉATION — le panneau de droite : ce qui est choisi, ce qu'on peut en
// faire. Rien choisi : la planche (plan, liens, export). Un objet : ses
// réglages, « faire naître » (variations, nuancier, carte Générer),
// « éditer » (image.edit), « production » (les autres outils du portail,
// par les adresses qu'ils lisent déjà). Plusieurs : aligner, répartir,
// encadrer, relier, en faire des références ou un élément.

import { api, toast, el, href, fmtDate, fmtDur, etypeFr, dropZone } from '../commun/shell.js';
import { bbox, inside } from './canvas.js';

const ROLES = [['face', 'visage'], ['full body', 'plein pied'], ['outfit', 'tenue'], ['view', 'vue'], ['detail', 'détail'], ['style', 'style'], ['expression', 'expression']];
const ICONS = {
  left: 'M4 3v18M8 7h12v4H8zM8 13h7v4H8z', hcenter: 'M12 3v18M6 7h12v4H6zM8 13h8v4H8z', right: 'M20 3v18M4 7h12v4H4zM9 13h7v4H9z',
  top: 'M3 4h18M7 8v12h4V8zM13 8v7h4V8z', vmiddle: 'M3 12h18M7 6v12h4V6zM13 8v8h4V8z', bottom: 'M3 20h18M7 4v12h4V4zM13 9v7h4V9z',
  dh: 'M4 4v16M20 4v16M9 8h6v8H9z', dv: 'M4 4h16M4 20h16M8 9h8v6H8z', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
};
const icon = (k) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[k]);
  s.append(p);
  return s;
};

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
    if (a && box.contains(a) && a.matches('input, textarea, select')) { pending = true; return; }
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
    const item = (n) => el('button', { class: 'oline', type: 'button', onclick: () => { app.select([n.id]); app.canvas.fit(bbox([n])); } },
      el('i', { class: 'dot t-' + (n.type === 'media' ? n.kind : n.type), style: n.type === 'sticky' ? { background: `var(--${n.color})` } : null }),
      el('span', {}, app.label(n)), el('small', { class: 'lbl' }, app.kindLabel(n)));
    out.push(card('Plan', `${frames.length} cadre${frames.length > 1 ? 's' : ''}`,
      el('div', { class: 'olist' }, ...(B.nodes.length ? [...frames, ...rest].slice(0, 120).map(item) : [hint('rien encore')]))));
    out.push(card('Liens', String(B.links.length),
      el('div', { class: 'olist' }, ...(B.links.length ? B.links.slice(0, 80).map((l) => el('div', { class: 'lline' + (S.link === l.id ? ' on' : '') },
        el('button', { class: 'nm', type: 'button', onclick: () => app.selectLink(l.id) }, `${app.label(app.node(l.a))} → ${app.label(app.node(l.b))}`),
        el('button', { class: 'cut', type: 'button', onclick: () => app.mutate(() => { S.board.links = S.board.links.filter((x) => x.id !== l.id); }) }, 'Couper')))
        : [hint('Tirez depuis le point à droite d’un objet jusqu’à un autre. Une image reliée à une carte Générer en devient la référence.')]))));
    out.push(card('Gestes', null, el('dl', { class: 'keys' }, ...[
      ['molette · pincer', 'zoomer'], ['espace + glisser', 'se déplacer'], ['glisser le fond', 'choisir (Alt : lasso)'],
      ['double-clic', 'poser, écrire'], ['N S T F G', 'note, post-it, titre, cadre, générer'], ['L', 'relier'],
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
    const ref = z?.type === 'gen' && a?.type === 'media' && ['image', 'element'].includes(a.kind);
    return [card('Lien', ref ? 'référence' : l.kind === 'out' ? 'résultat' : '',
      el('p', { class: 'lk-ends' }, el('b', {}, app.label(a)), ' → ', el('b', {}, app.label(z))),
      ref ? hint('Cette image est une référence de la carte Générer, dans l’ordre des liens.') : null,
      el('div', { class: 'seg' }, ...[['arrow', 'Flèche'], ['line', 'Ligne'], ['out', 'Résultat']].map(([k, v]) =>
        el('button', { class: 'tb' + (l.kind === k ? ' on' : ''), type: 'button', onclick: () => app.mutate(() => { l.kind = k; }) }, v))),
      lab,
      row(b('Inverser', () => app.mutate(() => { [l.a, l.b] = [l.b, l.a]; })), el('span', { class: 'sp' }),
        b('Couper', () => { app.mutate(() => { S.board.links = S.board.links.filter((x) => x.id !== l.id); }); S.link = null; render(); }, { title: 'Suppr' })))];
  }

  // ── un objet ────────────────────────────────────────────────
  function nodePanels(n) {
    if (!n) return boardPanels();
    const out = [];
    if (n.type === 'media') out.push(...mediaPanels(n));
    else if (n.type === 'gen') out.push(...genPanels(n));
    else if (n.type === 'frame') out.push(framePanel(n));
    else if (n.type === 'palette') out.push(palettePanel(n));
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
      const ta = el('textarea', { class: 'fld', rows: 3, placeholder: d.model === 'qwen21' ? 'la consigne, en anglais : « Change the jacket in <image1> to red leather »' : 'la consigne, en anglais : « Recolor the jacket to red leather »' });
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
    const ta = el('textarea', { class: 'fld', rows: n.type === 'title' ? 2 : 5, placeholder: 'le texte' });
    ta.value = n.text || '';
    let ch = () => {};
    ta.addEventListener('focus', () => { ch = app.editing(); });
    ta.addEventListener('input', () => { ch(); n.text = ta.value; app.render(); });
    const name = { note: 'Note', sticky: 'Post-it', title: 'Titre' }[n.type];
    return card(name, null, ta,
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
    const name = el('input', { class: 'fld', value: n.name || '', maxlength: 120, placeholder: 'le nom du cadre' });
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
    const ta = el('textarea', { class: 'fld', rows: 5, id: 'insp-prompt', placeholder: 'le prompt, en anglais' });
    ta.value = n.prompt || '';
    let ch = () => {};
    ta.addEventListener('focus', () => { ch = app.editing(); });
    ta.addEventListener('input', () => {
      ch(); n.prompt = ta.value;
      const c = app.canvas.dom.get(n.id)?.el.querySelector('textarea.gp');
      if (c) c.value = n.prompt;
      G.refresh(n.id); paintGo(n);
    });
    out.push(card('Générer', cfg.backend === 'stub' ? 'moteur factice' : m?.name,
      el('div', { class: 'models' }, ...cfg.models.map((x) => el('button', { class: 'opt model' + (n.model === x.id ? ' on' : ''), type: 'button', title: x.role,
        onclick: () => { app.mutate(() => { n.model = x.id; }); app.LS('gen-model', x.id); } },
      el('b', {}, x.name), el('small', {}, x.refs ? `${x.refs} réf. au plus` : 'texte seul')))),
      m ? el('p', { class: 'hint' }, m.role) : null,
      ta,
      el('div', { class: 'go-row', id: 'insp-go' }),
      cfg.backend === 'stub' ? el('p', { class: 'why' }, 'Moteur factice : l’outil Image rend des mires dessinées, aucun modèle n’est chargé. Le câblage réel s’allume dans showrunner.local.json (« image_backend »).') : null));
    setTimeout(() => paintGo(n));

    const refs = G.refsOf(n);
    const refCard = card('Références', m ? `${refs.length} / ${m.refs}` : String(refs.length),
      refs.length ? el('div', { class: 'rlist' }, ...refs.map((r, k) => {
        const it = S.items.get(r.item);
        const link = S.board.links.find((l) => l.a === r.id && l.b === n.id);
        const erefs = it?.kind === 'element' ? it.element?.refs || [] : [];
        return el('div', { class: 'rrow' },
          el('b', { class: 'rn' }, String(k + 1)),
          el('span', { class: 'rim', style: { backgroundImage: it?.thumb_url ? `url("${href(it.thumb_url)}")` : null } }),
          el('div', { class: 'rt' }, el('span', {}, it?.title || r.title || r.item),
            erefs.length ? (() => {
              const s = el('select', { class: 'fld sm', title: 'quelle image de l’élément envoyer' },
                ...erefs.map((x) => el('option', { value: x.file, selected: (n.refChoice?.[r.item] || erefs[0].file) === x.file ? true : null },
                  `${x.label || x.role || x.file}${x.role ? ' · ' + x.role : ''}`)));
              s.addEventListener('change', () => app.mutate(() => { n.refChoice = { ...(n.refChoice || {}), [r.item]: s.value }; }));
              return s;
            })() : null),
          k > 0 ? b('↑', () => app.mutate(() => {
            const L = S.board.links;
            const prev = L.find((l) => l.a === refs[k - 1].id && l.b === n.id);
            const i = L.indexOf(link), j = L.indexOf(prev);
            [L[i], L[j]] = [L[j], L[i]];
          }), { title: 'passer avant (l’ordre des références compte)' }) : null,
          b('×', () => app.mutate(() => { S.board.links = S.board.links.filter((l) => l !== link); }), { title: 'délier' }));
      })) : null,
      hint(n.model === 'qwen21' ? 'dans l’ordre : <image1>, <image2>, <image3> — nommez-les dans le prompt'
        : n.model === 'krea2' ? '1 référence : la personne ou l’objet à reprendre · 2 : la scène d’abord, puis le sujet'
          : 'Z-Image ne prend pas de référence'),
      row(b('Ajouter depuis la bibliothèque', () => app.pickRefs(n.id), { disabled: m && refs.length >= m.refs, title: 'posées à gauche de la carte, reliées' })),
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

    // prise de vue : les pastilles de l'outil Image, une liste par groupe
    out.push(card('Prise de vue', Object.keys(n.looks || {}).length ? `${Object.keys(n.looks).length} réglage${Object.keys(n.looks).length > 1 ? 's' : ''}` : 'aucune',
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
    box2.replaceChildren(el('button', { class: 'tb go block', type: 'button', disabled: w ? true : null, onclick: () => app.gen.generate(n.id) },
      `Générer${n.count > 1 ? ' ' + n.count + ' images' : ''}`), el('p', { class: w ? 'why' : 'hint' }, w || 'les images se posent à droite de la carte, reliées'));
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
    const refable = list.filter((n) => n.type === 'media' && ['image', 'element'].includes(n.kind) && !S.items.get(n.item)?.missing);
    const imgs = refable.filter((n) => n.kind === 'image');
    const al = (k, t) => el('button', { class: 'ic', type: 'button', title: t, onclick: () => app.align(k) }, icon(k));
    return [card(`${list.length} objets`, null,
      el('div', { class: 'aligns' }, al('left', 'aligner à gauche'), al('hcenter', 'centrer'), al('right', 'aligner à droite'),
        al('top', 'aligner en haut'), al('vmiddle', 'au milieu'), al('bottom', 'aligner en bas'),
        el('button', { class: 'ic', type: 'button', title: 'répartir à l’horizontale', onclick: () => app.distribute('x'), disabled: list.length < 3 ? true : null }, icon('dh')),
        el('button', { class: 'ic', type: 'button', title: 'répartir à la verticale', onclick: () => app.distribute('y'), disabled: list.length < 3 ? true : null }, icon('dv')),
        el('button', { class: 'ic', type: 'button', title: 'ranger en grille', onclick: () => app.tidy() }, icon('grid'))),
      row(b('Encadrer', () => app.frameAround(), { title: 'un cadre autour de la sélection' }),
        b('Relier dans l’ordre', () => app.chain(), { title: 'des liens de l’un à l’autre, dans l’ordre où vous les avez choisis' }))),
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

  return { render, syncPrompt, elementModal };
}
