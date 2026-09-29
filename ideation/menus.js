// IDÉATION — les menus du clic droit. Règle de Cal (29/09) : plus jamais le
// menu du navigateur sur la planche ; chaque zone a le sien, par commun/menu.js :
// le fond (poser ici, coller, tout choisir), un objet selon sa sorte, un fil,
// une flèche, un cadre, un groupe, une sélection de plusieurs, la barre de la
// sélection, le zoom et la mini-carte, un champ où l'on écrit. Une entrée
// éteinte dit pourquoi (why) ; les raccourcis sont ceux du clavier de la page.

import { href, toast } from '../commun/shell.js';
import { KINDS, nameOf, outPort, portOf } from './ports.js';
import { kidsOf, layoutOf } from './groups.js';

export function createMenus(app) {
  const { S } = app;
  const G = () => app.groups;
  const C = () => app.canvas;
  const open = (url) => window.open(href(url), '_blank', 'noopener');
  const refable = (list) => list.filter((n) => n.type === 'media' && ['image', 'element'].includes(n.kind) && !S.items.get(n.item)?.missing);

  const alignItems = () => [{ head: 'aligner' },
    { label: 'À gauche', key: 'Alt+A', onclick: () => app.align('left') }, { label: 'Au centre', key: 'Alt+H', onclick: () => app.align('hcenter') },
    { label: 'À droite', key: 'Alt+D', onclick: () => app.align('right') }, '-',
    { label: 'En haut', key: 'Alt+W', onclick: () => app.align('top') }, { label: 'Au milieu', key: 'Alt+V', onclick: () => app.align('vmiddle') },
    { label: 'En bas', key: 'Alt+S', onclick: () => app.align('bottom') }];
  const colorItems = (list) => (S.meta?.sticky || []).map((c) => ({ label: c.name || c.id, dot: c.id, checked: list.every((s) => s.color === c.id),
    onclick: () => { app.mutate(() => { for (const s of list) s.color = c.id; }); app.LS('sticky', c.id); } }));
  const order = [{ label: 'Dupliquer', key: 'ctrl+D', onclick: () => app.duplicate() },
    { label: 'Premier plan', key: ']', onclick: () => app.order(1) }, { label: 'Arrière-plan', key: '[', onclick: () => app.order(-1) }];
  const remove = { label: 'Supprimer', key: 'Suppr', danger: true, onclick: () => app.remove() };

  // ── plusieurs objets choisis (le menu de la barre, et son « ⋯ ») ──
  function selection(us) {
    const flat = G().expand(us);
    const refs = refable(flat);
    const stickies = flat.filter((n) => n.type === 'sticky');
    const why = G().whyNot(us);
    const sized = us.filter((n) => n.type !== 'group' && n.type !== 'frame');
    const noSize = sized.length < 2 ? 'choisissez au moins deux objets (un groupe ou un cadre ne se met pas à la taille d’un autre)' : '';
    return [{ head: `${us.length} objets` },
      { label: 'Grouper', key: 'ctrl+G', disabled: !!why, why, onclick: () => G().group() },
      us.some((n) => n.type === 'group') ? { label: 'Dégrouper', key: 'ctrl+maj+G', onclick: () => G().ungroup() } : null,
      '-',
      { label: 'Aligner', items: alignItems() },
      { label: 'Distribuer', disabled: us.length < 3, why: 'distribuer : trois objets au moins', items: [
        { label: 'À l’horizontale', key: 'Alt+maj+H', onclick: () => app.distribute('x') },
        { label: 'À la verticale', key: 'Alt+maj+V', onclick: () => app.distribute('y') }] },
      { label: 'Même hauteur', sub: 'le premier choisi', disabled: !!noSize, why: noSize, onclick: () => app.sameSize('h') },
      { label: 'Même largeur', sub: 'le premier choisi', disabled: !!noSize, why: noSize, onclick: () => app.sameSize('w') },
      { label: 'Ranger', key: 'ctrl+alt+T', onclick: () => app.tidy() },
      '-',
      { label: 'Encadrer', key: 'ctrl+alt+G', onclick: () => app.frameAround() },
      { label: 'Relier dans l’ordre', sub: 'des flèches', onclick: () => app.chain() },
      refs.length ? { label: 'Carte Générer', sub: `${refs.length} réf.`, dot: 'or', onclick: () => app.genWith(refs.map((n) => n.id)) } : null,
      stickies.length ? { label: 'Couleur des post-it', items: colorItems(stickies) } : null,
      // regrouper par couleur, convertir en mind map (objets/)
      ...(app.objets?.selectionItems(us) || []),
      '-', ...order, remove];
  }

  // ── un objet, selon sa sorte ─────────────────────────────────
  function node(n) {
    const out = [{ head: `${app.kindLabel(n) || n.type} · ${app.label(n)}` }];
    if (n.type === 'media') {
      const it = S.items.get(n.item);
      const gone = !it || it.missing;
      if (n.kind === 'image' || n.kind === 'video') out.push({ label: 'Voir en grand', sub: 'double-clic', disabled: gone, why: 'cet objet a quitté la bibliothèque', onclick: () => app.lightbox(n) });
      if (n.kind === 'image') {
        const rec = !gone && app.gen.recipe(it);
        out.push({ label: 'Variations ×4', disabled: !rec, why: 'image sans recette (déposée ou faite ailleurs) : une carte Générer la prend en référence', onclick: () => app.gen.variations(n.id, 4) },
          { label: 'Éditer…', sub: 'la consigne, à droite', onclick: () => app.insp.focusEdit?.(n.id) },
          { label: 'Nuancier', onclick: () => app.palette(n.id) });
      }
      if (n.kind === 'image' || n.kind === 'element') out.push({ label: 'Carte Générer', sub: 'en référence', dot: 'or', onclick: () => app.genWith([n.id]) });
      if (n.kind === 'image') out.push({ label: 'Faire un élément…', onclick: () => app.elementModal([n.id]) });
      if (n.kind === 'element') out.push({ label: 'Nuancier', onclick: () => app.palette(n.id) });
      if (!gone) {
        const go = [{ label: 'Dans Asset', icon: '↗', onclick: () => open(`asset/#${it.id}`) }];
        if (n.kind === 'image') go.push({ label: 'Éditer dans Image', icon: '↗', onclick: () => open(`image/#${it.id}`) }, { label: 'Animer', icon: '↗', onclick: () => open(`movie/?start=${it.id}`) });
        if (n.kind !== 'element') go.push({ label: 'Ajouter au montage', icon: '↗', onclick: () => open(`montage/?add=${it.id}`) });
        go.push({ label: 'Référence vidéo', icon: '↗', onclick: () => open(`movie/?ref=${it.id}`) });
        out.push({ label: 'Ouvrir ailleurs', items: go });
      }
    } else if (n.type === 'note' || n.type === 'sticky' || n.type === 'title') {
      out.push({ label: 'Écrire', key: 'Entrée', onclick: () => C().editText(n.id) });
      if (n.type === 'sticky') out.push({ label: 'Couleur', items: colorItems([n]) });
      if (n.type === 'title') out.push({ label: 'Taille', items: [['s', 'Petit'], ['m', 'Moyen'], ['l', 'Grand']].map(([k, v]) => ({ label: v, checked: n.size === k, onclick: () => app.mutate(() => { n.size = k; }) })) });
    } else if (n.type === 'frame') {
      const P = app.atelier?.presentation;
      const inner = S.board.nodes.filter((m) => m !== n && m.type !== 'group' && m.x >= n.x && m.y >= n.y && m.x + m.w <= n.x + n.w && m.y + m.h <= n.y + n.h);
      out.push({ label: 'Renommer', key: 'Entrée', onclick: () => C().renameFrame(n.id) },
        { label: 'Présenter d’ici', disabled: !P, why: 'la présentation (atelier) n’est pas chargée', onclick: () => P.start(n.id) },
        { label: 'Exporter en PNG', sub: 'dans la bibliothèque', onclick: () => app.exportBoard(n.id) },
        { label: 'Choisir son contenu', disabled: !inner.length, why: 'ce cadre est vide', onclick: () => app.select(inner.map((m) => (m.group && S.focus !== m.group ? m.group : m.id))) },
        { label: 'Voir', onclick: () => C().flyTo(n.id) });
    } else if (n.type === 'group') {
      const L = layoutOf(n);
      const kids = kidsOf(S.board, n.id);
      if (n.collapsed) out.push({ label: 'Déplier', sub: 'double-clic', onclick: () => G().collapse(n.id, false) });
      else {
        out.push({ label: 'Réduire', sub: 'une carte à ports', onclick: () => G().collapse(n.id, true) },
          { label: 'Rangée', checked: L.mode === 'flow', onclick: () => G().flow(n.id, L.mode !== 'flow') },
          { label: 'Même hauteur', checked: L.fit === 'h', onclick: () => G().fit(n.id, 'h') },
          { label: 'Même largeur', checked: L.fit === 'w', onclick: () => G().fit(n.id, 'w') },
          { label: 'Se réduit de loin', checked: !!n.lod, onclick: () => G().lod(n.id) },
          { label: 'Choisir un objet', items: kids.slice(0, 30).map((k) => ({ label: app.label(k), sub: app.kindLabel(k), onclick: () => app.enter(k.id) })) });
      }
      out.push({ label: 'Dégrouper', key: 'ctrl+maj+G', onclick: () => G().ungroup([n.id]) });
    } else if (n.type === 'gen' || n.type === 'vgen') {
      const w = n.type === 'gen' ? app.gen.why(n) : '';
      if (n.type === 'gen') out.push({ label: app.gen.goText ? app.gen.goText(n) : 'Générer', dot: 'or', disabled: !!w, why: w, onclick: () => app.gen.generate(n.id) });
      out.push({ label: 'Écrire le prompt', onclick: () => C().dom.get(n.id)?.el.querySelector('textarea:not([readonly])')?.focus({ preventScroll: true }) });
    } else if (n.type === 'palette') {
      out.push({ label: 'Copier les couleurs', onclick: () => navigator.clipboard?.writeText((n.colors || []).join(' ')).then(() => toast('couleurs copiées'), () => toast((n.colors || []).join(' '))) });
    } else if (app.objets?.has(n.type)) {
      // formes, cartes, nœuds de mind map, traits (objets/)
      out.push(...app.objets.menu(n));
    }
    // un post-it, une note, une forme, une carte : en mind map ; des post-it : par couleur
    if (['note', 'sticky', 'title', 'shape', 'card'].includes(n.type) && app.objets) out.push({ label: 'Convertir en mind map', onclick: () => app.objets.toMind() });
    // un objet choisi dans son groupe : l'en sortir (une mind map sort tout entière)
    if (n.group && n.type !== 'group') {
      const g = app.node(n.group);
      out.push({ label: `Sortir du groupe « ${g?.name || 'groupe'} »`, onclick: () => app.mutate(() => { for (const m of app.objets ? app.objets.tree(n) : [n]) delete m.group; S.focus = null; }) });
    }
    out.push('-', ...order, remove);
    return out;
  }

  // ── un lien : un fil, une flèche, une lignée ────────────────
  function link(l) {
    const a = app.node(l.a), b = app.node(l.b);
    if (l.kind === 'wire') {
      const st = app.flowNow().state(l.id) || { ok: false, why: 'fil illisible' };
      const port = portOf(b, l.pb, app.caps());
      const same = S.board.links.filter((x) => x.kind === 'wire' && x.b === l.b && x.pb === l.pb);
      const k = same.indexOf(l);
      const text = KINDS[l.pa] && outPort(a)?.kind === 'text';
      return [{ head: `fil · ${KINDS[l.pa]?.label || l.pa} → ${port?.label || l.pb}` },
        { label: `${nameOf(a)} → ${nameOf(b)}`, disabled: true, why: st.ok ? 'ce fil porte ce que sa source donne' : `ignoré : ${st.why}` },
        { label: 'Choisir', sub: 'le détail à droite', onclick: () => app.selectLink(l.id) },
        text ? { label: 'Détacher', sub: 'le texte copié, le fil coupé', onclick: () => app.detach(l.id) } : null,
        same.length > 1 ? { label: 'Passer avant', disabled: k <= 0, why: 'déjà le premier', onclick: () => app.moveWire(l.id, -1) } : null,
        same.length > 1 ? { label: 'Passer après', disabled: k >= same.length - 1, why: 'déjà le dernier', onclick: () => app.moveWire(l.id, 1) } : null,
        '-', { label: 'Couper le fil', key: 'Suppr', danger: true, onclick: () => app.cutLink(l.id) }];
    }
    return [{ head: l.kind === 'out' ? 'lignée · résultat' : 'annotation' },
      { label: `${app.label(a)} → ${app.label(b)}`, disabled: true, why: l.kind === 'out' ? 'cet objet est né de l’autre' : 'une flèche d’annotation ne porte rien' },
      { label: 'Choisir', sub: 'un mot sur le lien, à droite', onclick: () => app.selectLink(l.id) },
      ...[['arrow', 'Flèche'], ['line', 'Ligne'], ['out', 'Résultat']].map(([k, v]) => ({ label: v, checked: l.kind === k, onclick: () => app.mutate(() => { l.kind = k; }) })),
      { label: 'Pointillé', checked: !!l.dash, disabled: l.kind === 'out', why: 'la lignée est une courbe à elle', onclick: () => app.mutate(() => { if (l.dash) delete l.dash; else l.dash = true; }) },
      { label: 'Inverser', onclick: () => app.mutate(() => { [l.a, l.b] = [l.b, l.a]; }) },
      '-', { label: 'Supprimer', key: 'Suppr', danger: true, onclick: () => app.cutLink(l.id) }];
  }

  // ── le fond : poser ici (double-clic aussi) ; au clic droit, coller, tout choisir, la vue ──
  function board(wx, wy, { more = false } = {}) {
    const at = (type) => () => app.addAt(type, wx, wy, { edit: ['note', 'sticky', 'title'].includes(type), select: true });
    const out = [{ head: 'poser ici' },
      { label: 'Note', key: 'N', onclick: at('note') }, { label: 'Post-it', key: 'S', onclick: at('sticky') },
      { label: 'Titre', key: 'T', onclick: at('title') }, { label: 'Cadre', key: 'F', onclick: at('frame') },
      // forme, carte, mind map, modèle d'atelier (objets/)
      ...(app.objets?.boardItems(wx, wy) || []),
      '-', { label: 'Générer image', key: 'G', dot: 'or', onclick: at('gen') },
      { label: 'Générer vidéo', key: 'M', dot: 'cy', onclick: at('vgen') },
      { label: 'Composeur de prompt', key: 'P', dot: 'amb', onclick: at('compose') },
      // le panneau fermé (pas pour l'invité) : l'ouvrir ; ouvert, il est là, l'entrée se tait (Cal, 29/09)
      ...(app.lib?.closed() ? ['-', { label: 'Depuis la bibliothèque', onclick: () => app.lib.open() }] : [])];
    if (!more) return out;
    const st = (S.board?.nodes || []).filter((n) => n.type === 'sticky').length;
    out.push({ label: 'Coller ici', key: 'ctrl+V', disabled: !S.clip?.length, why: 'rien de copié : ctrl+C sur des objets de la planche', onclick: () => app.pasteAt?.(wx, wy) },
      '-', { label: 'Tout choisir', key: 'ctrl+A', disabled: !S.board?.nodes.length, why: 'la planche est vide', onclick: () => app.select(S.board.nodes.filter((n) => !n.group).map((n) => n.id)) },
      app.objets ? { label: 'Regrouper les post-it par couleur', sub: `${st} post-it`, disabled: st < 2, why: 'il faut au moins deux post-it', onclick: () => app.objets.regroup() } : null,
      ...view());
    return out;
  }
  // ── la vue (le zoom, la mini-carte) ─────────────────────────
  function view() {
    return [{ head: 'la vue' },
      { label: 'Tout voir', key: 'Maj+1', onclick: () => C().fit() }, { label: 'Zoom à 100 %', key: 'Maj+0', onclick: () => C().zoomTo(1) },
      { label: 'Zoomer', key: '+', onclick: () => C().zoomBy(1.25) }, { label: 'Dézoomer', key: '−', onclick: () => C().zoomBy(0.8) },
      { label: 'La trame', checked: !!S.grid, onclick: () => { S.grid = !S.grid; app.LS('grid', S.grid); C().applyView(); } }];
  }
  // ── un champ où l'on écrit (le presse-papiers : ce que le navigateur permet ici) ──
  function text(fld) {
    const sel = (() => { try { return fld.matches('input, textarea') ? fld.selectionEnd > fld.selectionStart : !getSelection().isCollapsed; } catch { return false; } })();
    const ro = fld.readOnly || fld.disabled || fld.getAttribute('contenteditable') === 'false';
    const read = !!navigator.clipboard?.readText;
    const cmd = (c) => () => { fld.focus({ preventScroll: true }); document.execCommand(c); };
    return [{ head: 'le texte' },
      { label: 'Couper', key: 'ctrl+X', disabled: !sel || ro, why: ro ? 'ce champ se lit seulement' : 'choisissez d’abord du texte', onclick: cmd('cut') },
      { label: 'Copier', key: 'ctrl+C', disabled: !sel, why: 'choisissez d’abord du texte', onclick: cmd('copy') },
      { label: 'Coller', key: 'ctrl+V', disabled: ro || !read, why: ro ? 'ce champ se lit seulement' : 'ici, le navigateur ne laisse pas une page lire le presse-papiers : ctrl+V',
        onclick: async () => { try { const t = await navigator.clipboard.readText(); fld.focus({ preventScroll: true }); document.execCommand('insertText', false, t); } catch (e) { toast(`coller : ${e.message}`); } } },
      { label: 'Tout sélectionner', key: 'ctrl+A', onclick: () => { fld.focus({ preventScroll: true }); if (fld.select) fld.select(); else document.execCommand('selectAll'); } }];
  }
  // ce que la barre de la sélection montre, au clic droit et sous son « ⋯ »
  function forSelection(us) {
    if (us.length > 1) return selection(us);
    return us.length ? node(us[0]) : null;
  }
  return { selection, node, link, board, view, text, forSelection };
}
