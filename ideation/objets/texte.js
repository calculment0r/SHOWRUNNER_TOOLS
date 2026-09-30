// IDÉATION · OBJETS — l'objet TEXTE (30/09/2026). Demande de Cal : « un vrai
// travail sur les textes : les mêmes fonctions que Miro, car pour l'instant on
// n'a que les titres et les notes ; on veut gérer les options depuis le texte,
// et le texte sur fond transparent par défaut. »
//
// Ce que Miro en dit (help.miro.com, « Text », lu par le moteur : la page refuse
// les robots ; developers.miro.com, « Text », lu en entier) :
//   - T pose un texte ; ses réglages s'offrent « while typing or when the text box
//     is selected » : police, couleur, alignement, taille, surligneur ;
//   - « When you change the font or text size, the whole text box is affected » ;
//   - la boîte : fond et bord facultatifs — `fillColor` « Default value:
//     transparent (no fill) » (SDK) ;
//   - un lien par « Insert link » ; une liste en tapant « - » ou « 1. » puis espace ;
//   - la taille change aussi en tirant le coin (« the white dot ») ; tirer le bord
//     gauche ou droit règle la largeur, le texte passe à la ligne sans changer de
//     taille (forum de Miro) ;
//   - le contenu : du HTML restreint à `p a strong b em i u s span ol ul li br`,
//     le reste échappé (SDK).
//
//   { id, type: 'text', x, y, w, h, html, font, size, color, bg, align, wrap }
//   html   ce HTML-là ; un passage en couleur : <span data-c="or">, surligné :
//          <span data-h="hl-amb"> — des jetons du thème (commun/tokens.css), jamais une
//          valeur (règle 1) ; le serveur nettoie avec la même liste (ideation.py, text_html)
//   font   chakra | venus | azeret (les polices du thème ; Norelli est au logotype seul)
//   size   en px du monde ; color le jeton de toute la boîte ; bg '' (transparent) ou un jeton
//   wrap   false : la boîte suit le texte (elle s'agrandit en tapant) ; true : largeur fixe
//
// Juste par construction : UNE voie pour mettre en forme — `document.execCommand` sur une
// plage (la sélection en cours d'écriture, ou tout le texte quand la boîte est choisie),
// puis le nettoyage (`clean`) qui ramène tout à la liste permise. Les couleurs passent par
// des valeurs témoins (rgb(1, 2, k)) que le nettoyage traduit en jetons.

import { el, toast } from '../../commun/shell.js';
import { icon, cut } from './commun.js';

// un T et des lignes de texte (le titre garde son T seul)
export const TEXT_ICON = 'M4 5h10M9 5v12M16 10h4M16 14h4M4 19h16';
export const FONTS = [['chakra', 'Chakra Petch', 'ui'], ['venus', 'Venus Rising', 'disp'], ['azeret', 'Azeret Mono', 'mono']];
export const COLORS = [['ink', 'encre'], ['ink2', 'encre douce'], ['ink3', 'gris'], ['or', 'orange'], ['cy', 'acier'], ['grn2', 'vert'], ['amb', 'ambre'], ['coral-2', 'corail']];
export const HL = [['hl-amb', 'ambre'], ['hl-or', 'orange'], ['hl-cy', 'acier'], ['hl-grn', 'vert']];
export const BG = [['', 'aucun (transparent)'], ['panel', 'fond'], ['panel2', 'carte'], ['panel3', 'soutenu'], ['sel-bg', 'acier sourd'], ...HL.map(([k, v]) => [k, `surligneur ${v}`])];
const ALIGN = [['left', 'À gauche'], ['center', 'Au centre'], ['right', 'À droite']];
// les tailles proposées (notre choix, en px du monde ; le 14 du SDK de Miro par défaut)
export const SIZES = [10, 12, 14, 18, 24, 32, 48, 64, 96, 144];
// les icônes de la barre (24 × 24, les traits du prototype de Cal)
const ICONS = {
  left: 'M4 6h16M4 10h10M4 14h16M4 18h10', center: 'M4 6h16M7 10h10M4 14h16M7 18h10', right: 'M4 6h16M10 10h10M4 14h16M10 18h10',
  ul: 'M10 6h10M10 12h10M10 18h10M5 6h.5M5 12h.5M5 18h.5', ol: 'M10 6h10M10 12h10M10 18h10M4 4.5l1.5-.8V9M3.8 14.2c.4-.9 2.6-.9 2.4.5-.1.8-2.4 2-2.4 3.3h2.6',
  link: 'M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.2 1.2M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.2-1.2',
  hl: 'M14.5 4.5l5 5-8 8H6.5v-5zM4 20h8',
};
const tic = (d) => icon(d, 'tic');
const TAGS = new Set(['P', 'A', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SPAN', 'OL', 'UL', 'LI', 'BR']);
const DROP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'TEXTAREA', 'TITLE']);
const MAX = 20000;
const cssDone = { v: false };

// ── le nettoyage : la liste de Miro, les couleurs en jetons ─────────
// une couleur témoin par jeton (et 0 : « aucune ») : ce que execCommand écrit, relu ici
const probe = (k) => `rgb(1, 2, ${k})`;
const probeHex = (k) => `#0102${k.toString(16).padStart(2, '0')}`;
const C_PROBE = new Map([[0, ''], ...COLORS.map(([id], i) => [i + 1, id])]);
const H_PROBE = new Map([[0, ''], ...HL.map(([id], i) => [i + 21, id])]);
const probeOf = (s) => { const m = /rgb\(\s*1,\s*2,\s*(\d+)\s*\)/.exec(s || '') || /^#0102([0-9a-f]{2})$/i.exec(s || ''); return m ? (m[0].startsWith('#') ? parseInt(m[1], 16) : +m[1]) : -1; };

export function clean(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '').slice(0, MAX * 2);
  const out = document.createElement('div');
  const walk = (src, dst) => {
    for (const nd of [...src.childNodes]) {
      if (nd.nodeType === 3) { dst.append(nd.textContent); continue; }
      if (nd.nodeType !== 1) continue;
      let tag = nd.tagName;
      const st = nd.getAttribute('style') || '';
      let c = nd.getAttribute('data-c'), h = nd.getAttribute('data-h');
      // ce que execCommand écrit : <font color>, style="color / background-color" aux valeurs témoins
      const fc = probeOf(nd.getAttribute('color'));
      if (fc >= 0) c = C_PROBE.get(fc) ?? null;
      const sc = probeOf(/(?:^|;)\s*color:\s*([^;]+)/i.exec(st)?.[1]);
      if (sc >= 0) c = C_PROBE.get(sc) ?? null;
      const sh = probeOf(/background(?:-color)?:\s*([^;]+)/i.exec(st)?.[1]);
      if (sh >= 0) h = H_PROBE.get(sh) ?? null;
      if (/font-weight:\s*(bold|[6-9]00)/i.test(st) && tag === 'SPAN') tag = 'B';
      if (/font-style:\s*italic/i.test(st) && tag === 'SPAN') tag = 'I';
      if (DROP.has(tag)) continue;   // un script, un style : ni la balise ni ce qu'elle contient (le serveur : TEXT_DROP)
      if (tag === 'FONT') tag = 'SPAN';
      if (tag === 'DIV') tag = 'P';
      if (tag === 'STRIKE' || tag === 'DEL') tag = 'S';
      if (!TAGS.has(tag)) { walk(nd, dst); continue; }
      if (tag === 'BR') { dst.append(document.createElement('br')); continue; }
      const e = document.createElement(tag.toLowerCase());
      if (tag === 'A') {
        const href = (nd.getAttribute('href') || '').trim();
        if (!/^(https?:\/\/|mailto:)/i.test(href) || href.length > 2048) { walk(nd, dst); continue; }
        e.setAttribute('href', href);
      }
      if (tag === 'SPAN') {
        if (c && COLORS.some(([k]) => k === c)) e.setAttribute('data-c', c);
        if (h && HL.some(([k]) => k === h)) e.setAttribute('data-h', h);
        if (!e.attributes.length) { walk(nd, dst); continue; }
      }
      walk(nd, e);
      // un paragraphe sans rien (pas même le <br> d'une ligne vide) : un reste d'édition, il tombe
      if ((tag === 'P' || tag === 'LI') && !e.childNodes.length) continue;
      dst.append(e);
    }
  };
  walk(tpl.content, out);
  // un paragraphe vide garde sa ligne (le serveur garde <br>) ; un texte fait d'un seul <br> est vide
  const s = out.innerHTML;
  return plainOf(s).trim() ? s : '';
}
// le texte sans balises (le libellé, un texte vide, la migration)
export function plainOf(html) {
  const d = document.createElement('div');
  d.innerHTML = String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li)>/gi, '\n');
  return (d.textContent || '').replace(/\n{2,}/g, '\n').replace(/\n$/, '');
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// un texte simple (une note, un titre) en paragraphes
export const htmlOf = (text) => String(text || '').split('\n').map((l) => `<p>${l ? esc(l) : '<br>'}</p>`).join('');

export function extendTexte(app, api0) {
  const { S } = app;
  if (!cssDone.v && !document.querySelector('link[data-ide-texte]')) {
    document.head.append(el('link', { rel: 'stylesheet', href: new URL('./texte.css', import.meta.url).href, 'data-ide-texte': '' }));
  }
  cssDone.v = true;
  const txtOf = (id) => app.canvas?.dom.get(id)?.el.querySelector('.txt');

  // ── le dessin (canvas.js l'habille : .nd.text, data-id, sortie, poignée du coin) ──
  function build(n) {
    const f = FONTS.find(([k]) => k === n.font) || FONTS[0];
    const txt = el('div', { class: 'txt rt' + (n.html ? '' : ' ph') });
    if (n.html) txt.innerHTML = n.html; else txt.textContent = 'un texte';
    for (const a of txt.querySelectorAll('a[href]')) a.title = `${a.getAttribute('href')} — ctrl+clic : ouvrir`;
    return {
      cls: [`f-${f[2]}`, n.wrap ? 'wrap' : 'auto', n.bg ? 'fill' : '', `al-${n.align || 'left'}`].filter(Boolean),
      style: { '--ts': `${n.size || 14}px`, '--tc': `var(--${n.color || 'ink'})`, '--tb': n.bg ? `var(--${n.bg})` : null },
      // le bord droit : la largeur (le texte passe à la ligne) ; le coin (canvas.js) : la taille
      body: [txt, el('span', { class: 'rz rz-e', 'data-rz': 'x', title: 'la largeur : le texte passe à la ligne, sa taille reste' })],
    };
  }

  // ── écrire sur place : l'édition riche (double-clic, Entrée, à la pose) ──
  let ed = null;   // { id, txt, saved, done }
  function editRich(id) {
    const n = app.node(id);
    const txt = txtOf(id);
    if (!n || !txt || app.canvas.isLocked()) return;
    if (ed?.id === id) { txt.focus({ preventScroll: true }); return; }
    app.select([id]);
    txt.innerHTML = n.html || '<p><br></p>';
    txt.classList.remove('ph');
    txt.classList.add('editing');
    txt.contentEditable = 'true';
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); document.execCommand('styleWithCSS', false, false); } catch { /* */ }
    txt.focus({ preventScroll: true });
    const sel = getSelection();
    sel.selectAllChildren(txt);
    if (n.html) sel.collapseToEnd();
    const changed = app.editing();
    const E = ed = { id, txt, saved: null, wrote: false };
    const onInput = () => {
      E.wrote = true;
      changed();
      const c = app.node(id);
      if (c) c.html = clean(txt.innerHTML);
      app.canvas.reflow();
      requestAnimationFrame(() => app.canvas.sel.paint());   // la barre suit la boîte qui grandit
    };
    // « - » ou « 1. » puis espace en tête de ligne : une liste (Miro)
    const onKey = (ev) => {
      if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); ev.stopPropagation(); finish(); return; }
      if (ev.key === ' ' && !ev.ctrlKey && !ev.metaKey) {
        const r = getSelection().rangeCount ? getSelection().getRangeAt(0) : null;
        const blk = r?.startContainer && (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement)?.closest('p, li');
        if (blk && txt.contains(blk) && blk.tagName === 'P' && r.collapsed) {
          const before = blk.textContent.slice(0, r.startOffset + (r.startContainer === blk.firstChild ? 0 : 0));
          const t = before.trim();
          if ((t === '-' || t === '*' || t === '1.') && blk.textContent.trim() === t) {
            ev.preventDefault();
            blk.textContent = '';
            blk.append(document.createElement('br'));
            const rr = document.createRange(); rr.setStart(blk, 0); rr.collapse(true);
            getSelection().removeAllRanges(); getSelection().addRange(rr);
            document.execCommand(t === '1.' ? 'insertOrderedList' : 'insertUnorderedList');
            onInput();
          }
        }
      }
      ev.stopPropagation();
    };
    // coller : le texte seul (ce qui vient d'ailleurs apporterait ses couleurs en dur)
    const onPaste = (ev) => { ev.preventDefault(); document.execCommand('insertText', false, ev.clipboardData.getData('text/plain')); };
    // la sélection en écrivant : gardée pour les menus de la barre (le focus part au menu, et
    // la sélection du document avec lui) — seulement tant que le texte a le focus
    const onSel = () => {
      const s = getSelection();
      if (document.activeElement === txt && s.rangeCount && txt.contains(s.anchorNode)) E.saved = s.getRangeAt(0).cloneRange();
      paintStates();
    };
    // quitter le champ pour un menu de la barre (police, couleur…) n'est pas finir : on y revient
    const onBlur = () => setTimeout(() => {
      if (ed !== E) return;
      const a = document.activeElement;
      if (a === txt || a?.closest?.('.sr-menu, .sbar, .scrim')) {
        if (a?.closest?.('.sr-menu, .scrim')) a.addEventListener('focusout', () => setTimeout(() => { if (ed === E && !txt.contains(document.activeElement) && !document.activeElement?.closest?.('.sr-menu, .sbar, .scrim')) finish(); }), { once: true });
        return;
      }
      finish();
    });
    txt.addEventListener('input', onInput);
    txt.addEventListener('keydown', onKey);
    txt.addEventListener('paste', onPaste);
    txt.addEventListener('blur', onBlur);
    document.addEventListener('selectionchange', onSel);
    E.stop = () => {
      txt.removeEventListener('input', onInput); txt.removeEventListener('keydown', onKey);
      txt.removeEventListener('paste', onPaste); txt.removeEventListener('blur', onBlur);
      document.removeEventListener('selectionchange', onSel);
    };
    function finish() {
      if (ed !== E) return;
      ed = null;
      E.stop();
      txt.contentEditable = 'false';
      txt.classList.remove('editing');
      if (document.activeElement === txt) txt.blur();
      const d = app.canvas.dom.get(id);
      if (d) d.key = '';
      const c = app.node(id);
      // un texte laissé vide s'en va (Miro fait de même)
      if (c && !plainOf(c.html).trim()) {
        app.mutate((B) => { B.nodes = B.nodes.filter((m) => m.id !== id); B.links = B.links.filter((l) => l.a !== id && l.b !== id); S.sel.delete(id); });
        return;
      }
      if (E.wrote) app.commit(); else app.render();
      app.selectionChanged();
    }
    E.finish = finish;
    app.selectionChanged();
  }
  const editing = (id) => ed?.id === id;

  // ── mettre en forme : la sélection en cours d'écriture, sinon tout le texte ──
  // `cmd` : une commande d'execCommand ; `val` sa valeur. Un seul chemin pour les deux cas.
  function exec(id, cmd, val = null) {
    const n = app.node(id);
    if (!n) return;
    const live = ed?.id === id;
    const txt = live ? ed.txt : txtOf(id);
    if (!txt) return;
    const s = getSelection();
    if (live) {
      txt.focus({ preventScroll: true });
      // la sélection d'avant le menu (le focus l'a quittée), sinon tout le texte
      if (!(s.rangeCount && txt.contains(s.anchorNode) && !s.isCollapsed)) {
        s.removeAllRanges();
        if (ed.saved && !ed.saved.collapsed && txt.contains(ed.saved.startContainer)) s.addRange(ed.saved);
        else if (cmd !== 'createLink') s.selectAllChildren(txt);
        else if (ed.saved) s.addRange(ed.saved);
      }
      document.execCommand('styleWithCSS', false, cmd === 'hiliteColor');
      document.execCommand(cmd, false, val);
      const c = app.node(id);
      const changed = app.editing();
      changed();
      if (c) c.html = clean(txt.innerHTML);
      app.canvas.reflow();
      paintStates();
      return;
    }
    // la boîte choisie : tout le texte, le temps d'un geste (un pas d'annulation)
    txt.innerHTML = n.html || '';
    txt.contentEditable = 'true';
    txt.focus({ preventScroll: true });
    s.selectAllChildren(txt);
    document.execCommand('styleWithCSS', false, cmd === 'hiliteColor');
    document.execCommand(cmd, false, val);
    const html = clean(txt.innerHTML);
    txt.contentEditable = 'false';
    txt.blur();
    s.removeAllRanges();
    app.mutate(() => { n.html = html; });
  }
  // la couleur, le surligneur : un passage (en écrivant), sinon toute la boîte (sa couleur,
  // et les couleurs de passage retirées : « the whole text box is affected »)
  function color(id, c) {
    const n = app.node(id);
    if (!n) return;
    if (ed?.id === id && hasRange()) { exec(id, 'foreColor', probeHex(c ? COLORS.findIndex(([k]) => k === c) + 1 : 0)); return; }
    app.mutate(() => { n.color = c || 'ink'; n.html = strip(n.html, 'data-c'); });
  }
  function highlight(id, h) {
    const n = app.node(id);
    if (!n) return;
    const k = h ? HL.findIndex(([x]) => x === h) + 21 : 0;
    if (ed?.id === id && hasRange()) { exec(id, 'hiliteColor', probe(k)); return; }
    if (!h) { app.mutate(() => { n.html = strip(n.html, 'data-h'); }); return; }
    exec(id, 'hiliteColor', probe(k));
  }
  const hasRange = () => { const s = getSelection(); return (s.rangeCount && !s.isCollapsed && ed?.txt.contains(s.anchorNode)) || (ed?.saved && !ed.saved.collapsed); };
  function strip(html, attr) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    for (const e of d.querySelectorAll(`[${attr}]`)) e.removeAttribute(attr);
    return clean(d.innerHTML);
  }
  function set(id, patch) {
    const n = app.node(id);
    if (!n) return;
    if (ed?.id === id) { Object.assign(n, patch); const d = app.canvas.dom.get(id); if (d) applyBox(d.el, n); app.editing()(); app.canvas.reflow(); requestAnimationFrame(paintBarKey); return; }
    app.mutate(() => Object.assign(n, patch));
  }
  // la boîte change sous les doigts (l'objet où l'on écrit n'est pas refait) : son habit seul
  function applyBox(e, n) {
    const b = build(n);
    e.className = ['nd', 'text', ...b.cls, ...[...e.classList].filter((c) => ['sel', 'solo', 'ingrp', 'open'].includes(c))].join(' ');
    for (const [k, v] of Object.entries(b.style)) { if (v === null) e.style.removeProperty(k); else e.style.setProperty(k, v); }
  }
  function link(id) {
    const n = app.node(id);
    if (!n) return;
    const was = ed?.id === id ? ed.saved?.cloneRange() : null;
    const inp = el('input', { class: 'fld', placeholder: 'https://…', maxlength: 2048, spellcheck: 'false' });
    const a0 = was?.startContainer?.parentElement?.closest?.('a[href]');
    if (a0) inp.value = a0.getAttribute('href');
    const msg = el('p', { class: 'hint' }, was && !was.collapsed ? 'le lien se pose sur le passage choisi' : 'le lien se pose sur tout le texte');
    const ok = () => {
      const u = inp.value.trim();
      if (u && !/^(https?:\/\/|mailto:)/i.test(u)) { msg.textContent = 'une adresse commence par https://, http:// ou mailto:'; inp.focus(); return; }
      close();
      if (ed?.id === id && was) ed.saved = was;
      exec(id, u ? 'createLink' : 'unlink', u || null);
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    const close = app.modal('Lien', el('div', { class: 'stack' }, el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'adresse'), inp), msg),
      (cl) => [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: cl }, 'Annuler'),
        el('button', { class: 'tb ghost', type: 'button', onclick: () => { inp.value = ''; ok(); } }, 'Retirer le lien'),
        el('button', { class: 'tb on', type: 'button', onclick: ok }, 'Poser')]);
    setTimeout(() => inp.focus(), 30);
  }

  // ── la barre au-dessus du texte choisi (selection.js, mode « text ») ──
  // K : { btn, sub, sep } de la barre ; ses boutons gardent le focus du texte (mousedown)
  let barRoot = null;
  function barItems(n, K) {
    const { btn, sub, sep } = K;
    const id = n.id;
    const keep = (b) => { b.addEventListener('mousedown', (e) => e.preventDefault()); return b; };
    const f = FONTS.find(([k]) => k === n.font) || FONTS[0];
    const size = n.size || 14;
    const step = (dir) => { const i = SIZES.findIndex((v) => v >= size); const j = dir > 0 ? (SIZES[i] === size ? i + 1 : i) : (i <= 0 ? 0 : i - 1); return SIZES[Math.max(0, Math.min(SIZES.length - 1, j))]; };
    const cmdBtn = (label, cmd, title, cls) => { const b = keep(btn(label, () => exec(id, cmd), { title, cls })); b.dataset.cmd = cmd; return b; };
    const dot = (tok) => el('i', { class: 'tdot', style: { background: `var(--${tok})` } });
    const al = n.align || 'left';
    const out = [
      keep(sub(el('span', { class: `tfont f-${f[2]}` }, f[1].split(' ')[0]), () => [{ head: 'police' },
        ...FONTS.map(([k, name]) => ({ label: name, checked: (n.font || 'chakra') === k, onclick: () => set(id, { font: k }) }))], { title: 'la police de toute la boîte (les polices du thème)' })),
      el('span', { class: 'tsize' },
        keep(btn('−', () => set(id, { size: step(-1) }), { title: 'plus petit', why: size <= SIZES[0] ? 'déjà la plus petite taille' : '' })),
        keep(sub(el('b', { class: 'sv' }, String(Math.round(size))), () => [{ head: 'taille' }, ...SIZES.map((v) => ({ label: `${v}`, checked: v === size, onclick: () => set(id, { size: v }) }))], { title: 'la taille de toute la boîte (tirer le coin aussi)' })),
        keep(btn('+', () => set(id, { size: step(1) }), { title: 'plus grand', why: size >= SIZES[SIZES.length - 1] ? 'déjà la plus grande taille' : '' }))),
      sep(),
      cmdBtn('G', 'bold', 'gras · ctrl+B', 'tb-b'), cmdBtn('I', 'italic', 'italique · ctrl+I', 'tb-i'),
      cmdBtn('S', 'underline', 'souligné · ctrl+U', 'tb-u'), cmdBtn('B', 'strikeThrough', 'barré', 'tb-s'),
      sep(),
      keep(sub(el('span', { class: 'tsw', 'aria-label': 'couleur' }, el('b', { class: 'tA', style: { '--k': `var(--${n.color || 'ink'})` } }, 'A')), () => [{ head: ed?.id === id && hasRange() ? 'couleur · le passage choisi' : 'couleur · toute la boîte' },
        ...COLORS.map(([k, name]) => ({ label: name, dot: k, checked: (n.color || 'ink') === k, onclick: () => color(id, k) }))], { title: 'la couleur du texte : le passage choisi en écrivant, sinon toute la boîte' })),
      keep(sub(el('span', { class: 'tsw', 'aria-label': 'surligner' }, tic(ICONS.hl), el('i', { class: 'tdot hl' })), () => [{ head: 'surligneur' },
        ...HL.map(([k, name]) => ({ label: name, dot: k, onclick: () => highlight(id, k) })), '-', { label: 'Sans surligneur', onclick: () => highlight(id, '') }], { title: 'surligner le passage choisi, sinon tout le texte' })),
      sep(),
      keep(sub(el('span', { class: 'tsw', 'aria-label': 'alignement' }, tic(ICONS[al])), () => [{ head: 'alignement' },
        ...ALIGN.map(([k, v]) => ({ label: v, checked: al === k, onclick: () => set(id, { align: k }) }))], { title: `l’alignement de toute la boîte (${ALIGN.find(([k]) => k === al)[1].toLowerCase()})` })),
      cmdBtn(tic(ICONS.ul), 'insertUnorderedList', 'une liste à puces (ou « - » puis espace en écrivant)', 'tb-ic'),
      cmdBtn(tic(ICONS.ol), 'insertOrderedList', 'une liste numérotée (ou « 1. » puis espace)', 'tb-ic'),
      keep(btn(tic(ICONS.link), () => link(id), { title: 'un lien sur le passage choisi, sinon sur tout le texte — ctrl+clic l’ouvre', cls: 'tb-ic' })),
      sep(),
      keep(sub(el('span', { class: 'tsw' }, n.bg ? dot(n.bg) : el('i', { class: 'tdot none' }), 'Fond'), () => [{ head: 'le fond de la boîte' },
        ...BG.map(([k, name]) => ({ label: name, dot: k || null, checked: (n.bg || '') === k, onclick: () => set(id, { bg: k }) }))], { title: 'un fond facultatif (transparent par défaut)' })),
      keep(btn(n.wrap ? 'Fixe' : 'Auto', () => set(id, { wrap: !n.wrap }), { on: !!n.wrap,
        title: n.wrap ? 'largeur fixe : la boîte garde sa largeur, le texte passe à la ligne — un clic : elle suit le texte' : 'largeur auto : la boîte suit le texte — tirer son bord droit (ou un clic) : largeur fixe' })),
    ];
    requestAnimationFrame(paintStates);
    return out;
  }
  // l'état des boutons G, I, S, B, listes : ce que dit la sélection en écrivant
  function paintStates() {
    const bar = document.querySelector('.sbar:not([hidden])');
    if (!bar) return;
    for (const b of bar.querySelectorAll('.sbt[data-cmd]')) {
      let on = false;
      try { on = !!ed && document.queryCommandState(b.dataset.cmd); } catch { /* */ }
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  const paintBarKey = () => app.canvas.sel.paint();
  // ce qui, dans la barre, dépend de l'objet : pour qu'elle se refasse quand il change
  const barKey = (n) => JSON.stringify([n.font, n.size, n.color, n.bg, n.align, n.wrap, ed?.id === n.id]);

  // un lien dans un texte : ctrl+clic l'ouvre (un clic choisit le texte, comme le reste)
  addEventListener('click', (e) => {
    const a = e.target.closest?.('.nd.text .rt a[href]');
    if (!a || a.closest('.editing')) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) window.open(a.getAttribute('href'), '_blank', 'noopener,noreferrer');
  }, true);

  // ── les menus, l'inspecteur ──────────────────────────────
  function menu(n) {
    return [{ label: 'Écrire', key: 'Entrée', onclick: () => editRich(n.id) },
      { label: 'Police', items: FONTS.map(([k, name]) => ({ label: name, checked: (n.font || 'chakra') === k, onclick: () => set(n.id, { font: k }) })) },
      { label: 'Taille', items: SIZES.map((v) => ({ label: String(v), checked: v === (n.size || 14), onclick: () => set(n.id, { size: v }) })) },
      { label: 'Couleur', items: COLORS.map(([k, name]) => ({ label: name, dot: k, checked: (n.color || 'ink') === k, onclick: () => color(n.id, k) })) },
      { label: 'Fond', items: BG.map(([k, name]) => ({ label: name, dot: k || null, checked: (n.bg || '') === k, onclick: () => set(n.id, { bg: k }) })) },
      { label: n.wrap ? 'Largeur : suivre le texte' : 'Largeur fixe', onclick: () => set(n.id, { wrap: !n.wrap }) }];
  }
  function panels(n, K) {
    const { card, row, hint, b } = K;
    const p = plainOf(n.html);
    return [card('Texte', `${p.length} signe${p.length > 1 ? 's' : ''}`,
      el('p', { class: 'rt-prev' }, cut(p, 160) || '—'),
      row(b('Écrire', () => editRich(n.id), { title: 'double-clic ou Entrée' }), b(n.wrap ? 'Largeur auto' : 'Largeur fixe', () => set(n.id, { wrap: !n.wrap }))),
      hint('La barre au-dessus du texte règle police, taille, gras, couleur, surligneur, alignement, listes, lien et fond : sur le passage choisi en écrivant, sinon sur toute la boîte. Fond transparent par défaut. Tirer le coin : la taille ; le bord droit : la largeur.'))];
  }

  // ── une note, un titre, un post-it en texte (sans perte : leurs lignes deviennent des paragraphes) ──
  // (pas un texte branché : un objet texte n'a pas de sortie, ses fils seraient perdus)
  const whyNotText = (n) => (!['note', 'title'].includes(n?.type) ? 'une note ou un titre seulement'
    : S.board.links.some((l) => l.kind === 'wire' && l.a === n.id) ? 'ce texte part dans des fils (un objet texte n’a pas de sortie) : coupez-les d’abord' : '');
  function fromNote(n) {
    const why = whyNotText(n);
    if (why) { toast(why, 6000); return; }
    const size = n.type === 'title' ? { s: 22, m: 34, l: 52 }[n.size || 'm'] : 13;
    const text = n.text || '';
    const font = n.type === 'title' ? 'venus' : 'chakra';
    const bg = n.type === 'note' ? 'panel2' : '';
    app.mutate(() => {
      const keepK = ['id', 'x', 'y', 'w', 'group', 'mid'];
      for (const k of Object.keys(n)) if (!keepK.includes(k)) delete n[k];
      Object.assign(n, { type: 'text', h: 30, html: htmlOf(text), font, size, color: 'ink', bg, align: 'left', wrap: true });
    });
  }

  // ── ce que l'app en dit ──────────────────────────────────
  const L0 = app.label, K0 = app.kindLabel;
  app.label = (n) => (n?.type === 'text' ? cut(plainOf(n.html) || 'texte vide', 42) : L0(n));
  app.kindLabel = (n) => (n?.type === 'text' ? 'texte' : K0(n));

  api0.TYPES.add('text');
  api0.defs.text = () => ({ w: 40, h: 28, html: '', font: 'chakra', size: 14, color: 'ink', bg: '', align: 'left', wrap: false });
  const wrap = (k, fn) => { const f0 = api0[k]; api0[k] = (n, ...a) => (n?.type === 'text' ? fn(n, ...a) : f0(n, ...a)); };
  wrap('build', build);
  wrap('key', () => '');
  wrap('menu', menu);
  wrap('panels', panels);
  wrap('mini', (n, tok) => tok(n.bg || n.color || 'ink'));
  const B0 = api0.boardItems;
  api0.boardItems = (wx, wy) => [{ label: 'Texte', key: 'T', sub: 'fond transparent', onclick: () => api0.place('text', wx, wy) }, ...B0(wx, wy)];
  app.texte = { edit: editRich, editing, exec, color, highlight, set, link, barItems, barKey, fromNote, whyNotText, clean, plainOf, htmlOf, finish: () => ed?.finish(),
    // pour les essais (playwright) : le passage gardé pour la barre
    saved: () => (ed?.saved ? { text: ed.saved.toString(), collapsed: ed.saved.collapsed } : null) };
  return api0;
}

// le bouton de l'outil, à côté du titre (la barre des outils, à gauche de la planche)
export function textTool() {
  const b = el('button', { class: 'ic', type: 'button', 'data-tool': 'text', title: 'un texte, fond transparent : police, taille, couleur, listes, lien depuis sa barre · T' }, icon(TEXT_ICON));
  return b;
}
