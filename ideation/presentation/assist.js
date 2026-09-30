// IDÉATION · PRÉSENTATION — la passe assistée (docs/etudes/presentations.md § 10).
//
// Sur une présentation calée, elle propose un modèle et un jeu d'animations cohérent, par
// RÈGLES EXPLICITES ET DÉTERMINISTES (la même planche donne toujours la même proposition) :
//
//   1. lire   chaque objet prend une part (surtitre, titre, corps, légende, chiffre, citation,
//             image, image plein cadre, trait) et chaque diapositive un rôle (titre, section,
//             image, citation, chiffres, grille, contenu, fin) — scene.js, partOf / roleOf ;
//   2. hiérarchie  une part → un style : titre de titre ou de section → Display (H1 s'il
//             passe trois lignes), surtitre → Étiquette, chiffre → Display, citation → H2… ;
//   3. grille  les 12 colonnes de la scène (marges 96, gouttière 24, ligne de base 8 :
//             DECK_GRID) : le texte s'empile dans une colonne (surtitre, titre, corps) avec des
//             écarts fixes, calé en bas, au centre ou en haut selon le rôle ; les images
//             prennent des colonnes entières ; une image seule sur une diapositive de titre ou
//             d'image passe plein cadre ;
//   4. contraste  le texte sur une image : un voile (tone « veil ») et l'encre claire ; ailleurs,
//             l'encre la plus lisible sur le fond (rapport WCAG, calculé sur la palette) ;
//   5. rythme  l'entrée de chaque part vient du modèle, décalée dans l'ordre de lecture ; les
//             chiffres comptent, les traits se dessinent ; une diapositive qui reprend un objet
//             de la précédente passe en morph ; les autres prennent la transition de leur rôle.
//
// Le résultat est une COPIE de la planche (rien n'est écrit) ; le mode Présentation la
// montre en avant / après et l'applique en un geste (app.mutate : Ctrl+Z l'annule).
// Un LLM local (Ollama sur les DGX : qwen3-vl) pourrait un jour juger l'image rendue ;
// il n'est pas appelé ici — les règles suffisent et restent vérifiables.

import { slideNodes, partOf, roleOf, readOrder, contrast, readableOn } from './scene.js';
import { motionFor, transFor } from './modeles.js';

const G = { cols: 12, margin: 96, gutter: 24, baseline: 8 };
const snap8 = (v) => Math.round(v / G.baseline) * G.baseline;
function grid(W) {
  const cw = (W - 2 * G.margin - (G.cols - 1) * G.gutter) / G.cols;
  return { cw, x: (i) => G.margin + i * (cw + G.gutter), w: (a, b) => (b - a + 1) * cw + (b - a) * G.gutter };
}

// la hauteur d'un texte à son style dans une largeur (un canvas, les mêmes coupures que la page)
let cx2 = null;
export function textHeight(text, st, width) {
  if (!cx2) cx2 = document.createElement('canvas').getContext('2d');
  cx2.font = `${st.weight} ${st.size}px ${st.css}`;
  if ('letterSpacing' in cx2) cx2.letterSpacing = `${(st.track || 0) * st.size}px`;
  const src = st.upper ? String(text || '').toUpperCase() : String(text || '');
  let lines = 0;
  for (const para of src.split('\n')) {
    let cur = '';
    lines += 1;
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = cur ? `${cur} ${w}` : w;
      if (cx2.measureText(t).width <= width || !cur) cur = t;
      else { lines += 1; cur = w; }
    }
  }
  return { lines, h: Math.ceil(lines * st.size * st.lh) };
}

// quel modèle pour cette présentation ? (quand on n'en a ni essayé ni appliqué)
export function recommend(board, frames, modeles) {
  let heroes = 0, figures = 0, chars = 0, texts = 0, images = 0;
  for (const f of frames) {
    for (const n of slideNodes(board, f)) {
      const p = partOf(n, f);
      if (p === 'hero') heroes++;
      if (p === 'image' || p === 'hero') images++;
      if (p === 'figure') figures++;
      if (n.type === 'note' || n.type === 'title') { texts++; chars += String(n.text || '').length; }
    }
  }
  const has = (id) => modeles.some((m) => m.id === id);
  const pick = (id, why) => (has(id) ? { id, why } : { id: modeles[0]?.id, why: 'le premier modèle' });
  if (figures >= 2) return pick('lumiere', `${figures} chiffres : ils comptent, sur un fond qui les porte (Lumière)`);
  if (heroes >= Math.max(1, frames.length / 3)) return pick('generique', `${heroes} images plein cadre sur ${frames.length} diapositives : un générique de cinéma`);
  if (texts && chars / texts > 140) return pick('revue', 'des textes longs : une mise en page de magazine (Revue)');
  if (images >= frames.length) return pick('toile', 'beaucoup d’images : la toile, où l’on vole de l’une à l’autre');
  return pick('metronome', 'des titres courts : la typographie cinétique (Métronome)');
}

// la proposition : { board (copie), report: [{ id, name, role, rules: [..] }], tpl }
export function propose({ board, frames, tpl, style }) {
  const B = JSON.parse(JSON.stringify(board));
  const byId = new Map(B.nodes.map((n) => [n.id, n]));
  const pal = tpl.palette;
  const motionOf = motionFor(tpl);
  const report = [];
  const isMotion = tpl.kind === 'motion';
  B.pres = { ...(B.pres || {}), template: tpl.id, styles: JSON.parse(JSON.stringify(tpl.styles)) };
  const L = tpl.layout || {};
  let prevKeys = null;
  frames.forEach((f0, fi) => {
    const f = byId.get(f0.id);
    const W = f.w, H = f.h, g = grid(W);
    const list = slideNodes(B, f);
    const parts = new Map(list.map((n) => [n.id, partOf(n, f)]));
    const role = roleOf([...parts.values()], fi, frames.length);
    const rules = [];
    const P = (p) => readOrder(list.filter((n) => parts.get(n.id) === p));
    const kickers = P('kicker'), titles = P('title'), bodies = P('body'), captions = P('caption'), figures = P('figure'), quotes = P('quote');
    let images = [...P('hero'), ...P('image')];
    const strokes = P('stroke');
    const localOf = (n) => ({ x: n.x - f.x, y: n.y - f.y });
    const put = (n, x, y, w, h) => { n.x = Math.round(f.x + x); n.y = Math.round(f.y + snap8(y)); n.w = Math.round(w); if (h) n.h = Math.round(h); };

    // ── 2. la hiérarchie ─────────────────────────────────
    const setStyle = (n, sid, why) => { if (n.style !== sid) { n.style = sid; rules.push(why); } };
    const big = ['title', 'section', 'image', 'end'].includes(role);
    for (const n of titles) {
      let sid = big ? 'display' : 'h1';
      if (sid === 'display' && textHeight(n.text, style('display'), g.w(0, 9)).lines > 3) sid = 'h1';
      setStyle(n, sid, `« ${cut(n.text)} » : ${sid === 'display' ? 'Display' : 'H1'} (le titre de la diapositive)`);
    }
    for (const n of kickers) setStyle(n, 'label', `« ${cut(n.text)} » : Étiquette (surtitre)`);
    for (const n of bodies) setStyle(n, 'body', `« ${cut(n.text)} » : Corps`);
    for (const n of captions) setStyle(n, 'caption', `« ${cut(n.text)} » : Légende`);
    for (const n of figures) setStyle(n, 'display', `${n.text} : Display, un chiffre qui compte`);
    for (const n of quotes) setStyle(n, String(n.text).length < 90 ? 'h1' : 'h2', 'la citation : H1 ou H2 selon sa longueur');

    // ── 3. la grille ─────────────────────────────────────
    const centered = (L.align || 'left') === 'center' || role === 'quote' || role === 'end';
    const span = centered ? [2, 9] : (L.cols?.[role] || (role === 'content' && images.length ? [0, 5] : role === 'section' ? [0, 8] : [0, 9]));
    const stackW = g.w(span[0], span[1]);
    const stackX = g.x(span[0]);
    const heightOf = (n, w) => textHeight(n.text, style(n.style || 'body'), w).h;
    const stack = (items, x, w, anchor, top = G.margin, bottom = H - G.margin) => {
      const gaps = { label: 32, display: 40, h1: 36, h2: 32, body: 24, caption: 20 };
      const hs = items.map((n) => heightOf(n, w));
      const total = hs.reduce((a, b) => a + b, 0) + items.slice(1).reduce((a, n, k) => a + (gaps[items[k].style] || 24), 0);
      let y = anchor === 'bottom' ? bottom - total : anchor === 'center' ? (top + bottom - total) / 2 : top;
      items.forEach((n, k) => {
        put(n, x, y, w, hs[k]);
        if (centered) n.align = 'center'; else delete n.align;
        y += hs[k] + (gaps[n.style] || 24);
      });
      return total;
    };

    // les images : plein cadre, colonne, rangée
    if (images.length === 1 && ['title', 'image', 'end', 'section'].includes(role)) {
      const im = images[0];
      put(im, 0, 0, W, H);
      rules.push('l’image passe plein cadre (bord à bord)');
      if (titles.length || kickers.length || bodies.length) { if (im.tone !== 'veil') { im.tone = 'veil'; rules.push('un voile sur l’image : le texte reste lisible'); } }
      // l'image derrière le reste
      B.nodes.splice(B.nodes.indexOf(im), 1);
      B.nodes.splice(B.nodes.indexOf(f) + 1, 0, im);
    } else if (images.length && role === 'content') {
      const x0 = g.x(6), w = g.w(6, 11), n = images.length, gap = G.gutter;
      const hh = (H - 2 * G.margin - (n - 1) * gap) / n;
      images.forEach((im, k) => put(im, x0, G.margin + k * (hh + gap), w, hh));
      rules.push(`${n} image${n > 1 ? 's' : ''} sur les colonnes 7 à 12, à fleur des marges`);
    } else if (images.length >= 2) {
      const n = images.length, rows = n > 4 ? 2 : 1, per = Math.ceil(n / rows);
      const top = snap8(G.margin + 250), gap = G.gutter;
      const hh = (H - G.margin - top - (rows - 1) * gap) / rows;
      const w = (W - 2 * G.margin - (per - 1) * gap) / per;
      images.forEach((im, k) => put(im, G.margin + (k % per) * (w + gap), top + Math.floor(k / per) * (hh + gap), w, hh));
      rules.push(`une grille de ${n} images : ${per} colonnes égales${rows > 1 ? ', deux rangées' : ''}, une gouttière de 24`);
    }

    const heroFull = images.length === 1 && images[0].w === W;
    if (role === 'numbers' && figures.length) {
      stack([...kickers, ...titles], g.x(0), g.w(0, 8), 'top');
      const k = figures.length, per = Math.floor(12 / k);
      const rest = readOrder([...bodies, ...captions]);
      figures.forEach((n, i) => {
        const a = i * per, b = Math.min(11, a + per - 1);
        const fh = heightOf(n, g.w(a, b));
        put(n, g.x(a), 460, g.w(a, b), fh);
        const cap = rest[i];
        if (cap) put(cap, g.x(a), 460 + fh + 24, g.w(a, b), heightOf(cap, g.w(a, b)));
      });
      rules.push(`${k} chiffres alignés sur ${per} colonnes chacun, leur légende dessous`);
      for (const n of rest.slice(figures.length)) put(n, g.x(0), H - G.margin - heightOf(n, g.w(0, 8)), g.w(0, 8));
    } else if (role === 'grid' || (images.length >= 2 && role !== 'content')) {
      stack([...kickers, ...titles, ...bodies.slice(0, 1)], g.x(0), g.w(0, 8), 'top', G.margin, G.margin + 230);
      captions.forEach((n, i) => { const im = images[i]; if (im) put(n, im.x - f.x, im.y - f.y + im.h + 12, im.w, heightOf(n, im.w)); });
      rules.push('le titre en haut, sur 9 colonnes');
    } else if (role === 'quote') {
      stack([...kickers, ...quotes, ...titles, ...bodies, ...captions], stackX, stackW, 'center');
      rules.push('la citation au centre, sur les colonnes 3 à 10');
    } else {
      const anchor = L.anchor?.[role] || (role === 'title' || role === 'image' ? 'bottom' : role === 'end' || role === 'section' ? 'center' : 'center');
      const items = [...kickers, ...titles, ...quotes, ...bodies, ...captions, ...figures];
      if (items.length) {
        stack(items, stackX, stackW, anchor, G.margin, H - G.margin - (heroFull ? 24 : 0));
        rules.push(`le texte en colonne (${span[0] + 1} à ${span[1] + 1}), calé ${anchor === 'bottom' ? 'en bas' : anchor === 'top' ? 'en haut' : 'au centre'}, sur la ligne de base de 8`);
      }
    }
    // les traits : gardés, mis sur la grille
    for (const n of strokes) { const l = localOf(n); put(n, g.x(Math.max(0, Math.min(11, Math.round((l.x - G.margin) / (g.cw + G.gutter))))), l.y, n.w); }

    // ── 4. le contraste (dit dans le rapport, posé par la scène) ─
    const bgKey = f.motion?.bg || tpl.slideBg?.[role] || 'bg';
    const ink = heroFull ? (contrast(pal.inverse, pal.veil || pal.ink) >= contrast(pal.ink, pal.veil || pal.ink) ? 'inverse' : 'ink') : readableOn(pal, bgKey);
    const ratio = heroFull ? contrast(pal[ink], pal.veil || pal.ink) : contrast(pal[ink], pal[bgKey] || pal.bg);
    rules.push(`contraste du texte : ${ratio.toFixed(1)}:1 ${ratio >= 7 ? '(AAA)' : ratio >= 4.5 ? '(AA)' : ratio >= 3 ? '(AA grands textes)' : '(faible)'}`);

    // ── 5. le rythme ─────────────────────────────────────
    const order = readOrder(slideNodes(B, f));
    const keys = new Set(order.map((n) => n.mid || (n.type === 'media' ? `i:${n.item}` : '')).filter(Boolean));
    const shared = prevKeys ? [...keys].filter((k) => prevKeys.has(k)).length : 0;
    prevKeys = keys;
    if (isMotion) {
      order.forEach((n, k) => {
        const mo = motionOf(n, partOf(n, f), k, role);
        if (mo) {
          const o = { in: { ...mo.in } };
          if (mo.out) o.out = { ...mo.out };
          if (mo.loop) o.loop = { ...mo.loop };
          if (mo.depth) o.depth = mo.depth;
          n.motion = o;
        } else delete n.motion;
      });
      const withIn = order.filter((n) => n.motion?.in && n.motion.in.fx !== 'none').length;
      rules.push(`${withIn} entrée${withIn > 1 ? 's' : ''} dans l’ordre de lecture, ${tpl.motion.rhythm} ms entre deux`);
    } else {
      for (const n of order) delete n.motion;
      rules.push('modèle statique : aucune entrée animée');
    }
    const tr = transFor(tpl, { deck: f.deck }, role);
    const kind = shared && fi > 0 && isMotion ? 'morph' : tr.kind;
    f.motion = { ...(f.motion || {}), trans: kind };
    if (f.deck) f.deck = { ...f.deck, trans: { toile: 'fly', wipe: 'push', curtain: 'fade', zoom: 'fade' }[kind] || kind };
    rules.push(shared && kind === 'morph' ? `transition : morph (${shared} objet${shared > 1 ? 's' : ''} repris de la précédente)` : `transition : ${kind}`);
    report.push({ id: f.id, name: f.name || `Diapositive ${fi + 1}`, role, rules });
  });
  return { board: B, report, tpl };
}
const cut = (s) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > 28 ? s.slice(0, 27) + '…' : s; };

// appliquer la proposition à la planche vivante (dans app.mutate) : ce que la passe change, et rien d'autre
export function applyProposal(B, P, frameIds) {
  const src = new Map(P.board.nodes.map((n) => [n.id, n]));
  const touched = new Set(frameIds);
  const inSlides = new Set();
  for (const id of frameIds) { const f = src.get(id); for (const n of slideNodes(P.board, f)) inSlides.add(n.id); }
  for (const n of B.nodes) {
    const p = src.get(n.id);
    if (!p || (!touched.has(n.id) && !inSlides.has(n.id))) continue;
    for (const k of ['x', 'y', 'w', 'h', 'style', 'align', 'tone', 'motion', 'deck']) { if (p[k] === undefined) delete n[k]; else n[k] = JSON.parse(JSON.stringify(p[k])); }
  }
  // l'ordre des objets (une image passée derrière) : celui de la proposition
  const rank = new Map(P.board.nodes.map((n, i) => [n.id, i]));
  B.nodes.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
  B.pres = JSON.parse(JSON.stringify(P.board.pres));
}
