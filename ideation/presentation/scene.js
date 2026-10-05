// IDÉATION · PRÉSENTATION — la scène d'une diapositive (docs/etudes/presentations.md § 10).
//
// Le module de rendu que l'étude appelait (§ 2.3, « une seule vérité du rendu », étape 4) :
// une diapositive (un cadre `deck` et ce qu'il contient) devient une scène de sa taille
// (1920 × 1080 en 16:9), ses objets posés en px de la scène, dans l'habit de son modèle.
// Le mode Présentation, le lecteur plein écran et la page d'impression (lecture.html, le
// PDF) s'en servent tous ; il ne lit que des données : la planche, les fiches de la
// bibliothèque, les styles et les polices (/api/ideation/meta), le modèle.
//
// Les couleurs d'une scène sont celles du MODÈLE (du contenu : palette déclarée dans son
// JSON, posée en variables --t-* sur la scène) ; sans modèle, la scène prend les jetons du
// thème (presentation.css). Aucune couleur n'est écrite ici.
//
// Chaque objet est emboîté pour le moteur (moteur.js) : .pm-o > .pm-p > .pm-e > .pm-m > .pm-l > .pm-c

import { within } from '../atelier/socle.js';
import { waveUrl } from '../objets/son.js';
import { isFigure, normMotion } from './moteur.js';

const NS = 'http://www.w3.org/2000/svg';
const TITLE_PX = { s: 22, m: 34, l: 52 };   // server/tools/ideation.py, TITLE_SIZES
const SHAPE_D = {
  rect: 'M0 0H100V100H0Z', round: 'M12 0H88Q100 0 100 12V88Q100 100 88 100H12Q0 100 0 88V12Q0 0 12 0Z',
  ellipse: 'M50 0A50 50 0 1 1 49.99 0Z', diamond: 'M50 0L100 50L50 100L0 50Z', hex: 'M22 0H78L100 50L78 100H22L0 50Z', para: 'M18 0H100L82 100H0Z',
};
function h(tag, cls, kids = []) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of [].concat(kids)) if (k) e.append(k);
  return e;
}
function s(tag, attrs = {}, kids = []) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, v);
  for (const k of kids) e.append(k);
  return e;
}
// un trait : points entiers 0-1000 dans sa boîte, lissés par les milieux (le crayon d'Idéation, objets/crayon.js)
export function inkD(flat) {
  const P = [];
  for (let i = 0; i + 1 < (flat || []).length; i += 2) P.push([flat[i], flat[i + 1]]);
  if (!P.length) return '';
  if (P.length < 3) return `M${P[0][0]} ${P[0][1]}` + P.slice(1).map((p) => `L${p[0]} ${p[1]}`).join('');
  let d = `M${P[0][0]} ${P[0][1]}`;
  for (let i = 1; i < P.length - 1; i++) d += `Q${P[i][0]} ${P[i][1]} ${((P[i][0] + P[i + 1][0]) / 2).toFixed(1)} ${((P[i][1] + P[i + 1][1]) / 2).toFixed(1)}`;
  const L = P[P.length - 1];
  return d + `L${L[0]} ${L[1]}`;
}

// ── les couleurs du modèle : contraste (WCAG 2.x, luminance relative) ─
function channels(hex) {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function lum(hex) {
  const c = channels(hex);
  if (!c) return null;
  const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
export function contrast(a, b) {
  const la = lum(a), lb = lum(b);
  if (la === null || lb === null) return 0;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
// le ton d'encre le plus lisible sur un fond (ink ou inverse)
export function readableOn(pal, bgKey) {
  if (!pal) return null;
  const bg = pal[bgKey] || pal.bg;
  return contrast(pal.ink, bg) >= contrast(pal.inverse, bg) ? 'ink' : 'inverse';
}
export function tplVars(tpl) {
  const out = {};
  for (const [k, v] of Object.entries(tpl?.palette || {})) out[`--t-${k}`] = v;
  return out;
}

// ── lire une diapositive : ses objets, leur rôle, le rôle de la diapositive ─
export const slideNodes = (board, f) => board.nodes.filter((n) => n.type !== 'frame' && n.type !== 'group' && within(n, f));
export function partOf(n, f) {
  if (n.type === 'media') return n.w * n.h >= 0.45 * f.w * f.h ? 'hero' : 'image';
  if (n.type === 'ink') return 'stroke';
  if (n.type === 'shape') return 'shape';
  if (n.type !== 'title' && n.type !== 'note') return 'other';
  const t = String(n.text || '').trim();
  const st = n.style || (n.type === 'title' ? 'h1' : 'body');
  if (['display', 'h1', 'h2'].includes(st) && isFigure(t)) return 'figure';
  if (/^[«“"„]/.test(t)) return 'quote';
  if (st === 'display' || st === 'h1') return 'title';
  if (st === 'h2') return 'title';
  if (st === 'label') return 'kicker';
  if (st === 'caption') return 'caption';
  return 'body';
}
export function roleOf(parts, index, count) {
  const c = (p) => parts.filter((x) => x === p).length;
  if (index === 0) return 'title';
  if (count > 2 && index === count - 1) return 'end';
  if (c('hero')) return 'image';
  if (c('quote')) return 'quote';
  if (c('figure') >= 2) return 'numbers';
  if (c('image') >= 3) return 'grid';
  // un titre seul (un surtitre, une ligne de corps au plus) : une section
  if (c('body') <= 1 && !c('image') && !c('figure') && !c('stroke') && (c('title') || c('kicker'))) return 'section';
  return 'content';
}
// l'ordre de lecture dans la scène : de haut en bas, puis de gauche à droite (par bandes de 60 px)
export function readOrder(list) {
  return [...list].sort((a, b) => Math.round(a.y / 60) - Math.round(b.y / 60) || a.x - b.x);
}

// ── la scène ────────────────────────────────────────────────
// ctx : { board, frame, items (Map), style(sid) → {css, size, weight, lh, track, upper}, tpl,
//         motionOf(n, part, order) → motion | null, index, count, live, print, href(url), name }
// `print` (la page d'impression, le PDF) : ce qui ne s'imprime pas — une vidéo, un objet Web, un son —
// montre son image fixe (l'affiche, l'aperçu, l'onde) et un pied discret qui dit ce qu'il est (footOf)
let cssOn = false;
export function ensureCss() {
  if (cssOn || document.querySelector('link[data-pm]')) { cssOn = true; return; }
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('./presentation.css', import.meta.url).href; l.dataset.pm = '';
  document.head.append(l);
  cssOn = true;
}
// l'habit d'une diapositive, sans rien construire : son rôle, son fond, le ton de chaque objet
// (la scène s'en sert ; la planche aussi, pour montrer les couleurs du modèle — diapo/index.js)
export function lookOf(board, f, tpl, index = 0, count = 1) {
  const pal = tpl?.palette || null;
  const list = slideNodes(board, f);
  const parts = new Map(list.map((n) => [n.id, partOf(n, f)]));
  const role = roleOf([...parts.values()], index, count);
  const bgKey = f.motion?.bg || tpl?.slideBg?.[role] || 'bg';
  const inkTone = readableOn(pal, bgKey);
  const heroes = list.filter((n) => parts.get(n.id) === 'hero' || (n.type === 'media' && n.tone === 'veil'));
  const over = (n) => heroes.find((m) => m !== n && n.x + n.w / 2 > m.x && n.x + n.w / 2 < m.x + m.w && n.y + n.h / 2 > m.y && n.y + n.h / 2 < m.y + m.h);
  const tones = new Map();
  for (const n of list) {
    const part = parts.get(n.id);
    let tone = n.tone && n.tone !== 'veil' ? n.tone : null;
    if (!tone && pal && ['title', 'note', 'ink', 'shape', 'sticky'].includes(n.type)) {
      const under = over(n);
      tone = under ? (contrast(pal.inverse, pal.veil || pal.ink) >= contrast(pal.ink, pal.veil || pal.ink) ? 'inverse' : 'ink')
        : (n.type === 'ink' || n.type === 'shape') ? 'accent'
          : part === 'figure' && contrast(pal.accent, pal[bgKey] || pal.bg) >= 3 ? 'accent'
            : part === 'kicker' || part === 'caption' ? (contrast(pal.muted, pal[bgKey] || pal.bg) >= 4.5 ? 'muted' : inkTone) : inkTone;
    }
    if (tone) tones.set(n.id, tone);
  }
  return { list, parts, role, bgKey, inkTone, tones };
}
export function buildScene(ctx) {
  ensureCss();
  const { board, frame: f, tpl } = ctx;
  const href = ctx.href || ((u) => u);
  const pal = tpl?.palette || null;
  const look = lookOf(board, f, tpl, ctx.index ?? 0, ctx.count ?? 1);
  const { list, parts, role, bgKey } = look;
  const root = h('div', 'pm-scene');
  root.dataset.role = role;
  root.dataset.bg = bgKey;
  root.dataset.tpl = tpl?.id || '';
  Object.assign(root.style, { width: `${f.w}px`, height: `${f.h}px` });
  for (const [k, v] of Object.entries(tplVars(tpl))) root.style.setProperty(k, v);
  const bg = h('div', 'pm-bg');
  const back = h('div', 'pm-decor pm-back');
  const front = h('div', 'pm-decor pm-front');
  root.append(bg, back);

  const inkTone = look.inkTone;
  const objs = [];
  const order = new Map(readOrder(list).map((n, k) => [n.id, k]));

  for (const n of list) {
    const part = parts.get(n.id);
    const o = h('div', 'pm-o');
    o.dataset.id = n.id;
    o.dataset.part = part;
    o.dataset.type = n.type;
    Object.assign(o.style, { left: `${n.x - f.x}px`, top: `${n.y - f.y}px`, width: `${n.w}px` });
    const p = h('div', 'pm-p'), e = h('div', 'pm-e'), m = h('div', 'pm-m'), l = h('div', 'pm-l'), c = h('div', 'pm-c');
    l.append(c); m.append(l); e.append(m); p.append(e); o.append(p);
    const obj = { id: n.id, n, part, kind: n.type === 'media' ? n.kind : n.type, o, p, e, m, l, c, txt: null, text: '', paths: [], media: false,
      label: '', key: n.mid || (n.type === 'media' ? `i:${n.item}` : (n.type === 'title' || n.type === 'note') && n.text ? `t:${n.style || n.type}:${n.text}` : '') };
    // le ton : celui de l'objet, sinon le plus lisible sur ce qu'il y a dessous (lookOf)
    const tone = look.tones.get(n.id);
    if (tone) o.dataset.tone = tone;

    if (n.type === 'title' || n.type === 'note' || n.type === 'sticky') {
      const sid = n.style || (n.type === 'title' ? 'h1' : 'body');
      // sans style, le texte tel que la planche le montre (une seule vérité) : un titre à sa taille
      // de planche (TITLE_SIZES du serveur : 22, 34, 52), une note en carte de 13 px
      // (un modèle qu'on essaie, lui, habille aussi les textes sans style : Titre → H1, note → Corps)
      const st = n.style || ctx.preview ? ctx.style(sid) || {} : n.type === 'sticky' ? ctx.style('body') || {}
        : n.type === 'title' ? { css: 'var(--f-disp)', size: TITLE_PX[n.size] || 34, weight: 400, lh: 1.15, track: 0.05, upper: true }
          : { css: 'var(--f-ui)', size: 13, weight: 400, lh: 1.5, track: 0, upper: false };
      if (!n.style && !ctx.preview && n.type === 'note') o.classList.add('pm-note');
      const txt = h('div', 'pm-txt');
      txt.textContent = n.text || '';
      // sans style, ce que la barre du texte a réglé (diapo/libre.js : police, taille, couleur, fond)
      const free = !n.style && !ctx.preview && n.type !== 'sticky';
      const ff = free && n.font ? (ctx.fonts || []).find((x) => x.id === n.font) : null;
      Object.assign(txt.style, { fontFamily: ff ? `"${ff.family}", ${ff.gen || 'sans-serif'}` : st.css || '', fontSize: `${(free && n.fs) || st.size || 34}px`, fontWeight: String(st.weight || 400),
        lineHeight: String(st.lh || 1.3), letterSpacing: `${st.track || 0}em`, textTransform: st.upper ? 'uppercase' : 'none',
        textAlign: n.align || 'left' });
      if (free && n.color) txt.style.color = `var(--${n.color})`;
      if (free && n.bg) { if (n.bg === 'none') o.classList.remove('pm-note'); else { o.style.background = `var(--${n.bg})`; o.style.padding = '12px'; } }
      txt.dataset.st = sid;
      if (n.type === 'sticky') { o.classList.add('pm-sticky'); o.style.height = `${n.h}px`; }
      c.append(txt);
      obj.txt = txt; obj.text = n.text || '';
      obj.label = (n.text || '').replace(/\s+/g, ' ').slice(0, 40) || n.type;
    } else if (n.type === 'media') {
      o.style.height = `${n.h}px`;
      e.classList.add('pm-clip');
      obj.media = true;
      const it = ctx.items?.get(n.item);
      const big = n.w > 900;
      let url = null, poster = null;
      if (it && !it.missing) {
        if (n.kind === 'element') url = it.element?.refs?.[0]?.url || it.element?.refs?.[0]?.thumb_url || it.thumb_url;
        else if (n.kind === 'image') url = big ? it.url : it.view_urls?.['1024'] || it.url;
        poster = it.view_urls?.['1024'] || it.thumb_url;
      }
      if (n.kind === 'audio') {
        // un son : son onde (le masque du serveur, server/tools/apercu_son.py), peinte par le ton du modèle, et son titre
        const wave = h('i', 'pm-wave');
        if (it && !it.missing) {
          const u = waveUrl(it);
          wave.style.setProperty('--wave', `url("${u}")`);
          const pre = new Image();   // attendue avant l'impression comme une image (lecture.js : decode)
          pre.src = u;
          obj.img = pre;
        }
        c.append(h('div', ctx.print ? 'pm-snd pm-snd-pied' : 'pm-snd', [wave, h('span', 'pm-sndt', [document.createTextNode(n.title || it?.title || 'son')])]));
      } else if (n.kind === 'video' && it && !it.missing && ctx.live) {
        const v = document.createElement('video');
        Object.assign(v, { muted: true, loop: true, playsInline: true, autoplay: true, preload: 'auto' });
        v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
        if (poster) v.poster = href(poster);
        v.src = href(it.url);
        v.className = 'pm-img';
        c.append(v);
        obj.video = v;
      } else if (url || poster) {
        const img = new Image();
        img.decoding = 'async';
        img.className = 'pm-img';
        img.alt = n.title || it?.title || '';
        img.src = href(url || poster);
        c.append(img);
        obj.img = img;
      } else {
        // une image absente de cette bibliothèque : un aplat du modèle, qui garde la place
        c.append(h('div', 'pm-ph', [h('span', 'pm-phl', [document.createTextNode(n.kind === 'video' ? 'vidéo' : 'image')])]));
      }
      if (n.tone === 'veil') l.append(h('div', 'pm-veil'));
      if (ctx.print && (n.kind === 'video' || n.kind === 'audio')) c.append(footOf(n.kind === 'video' ? 'vidéo' : 'son'));
      obj.label = n.title || it?.title || n.kind;
    } else if (n.type === 'shape') {
      o.style.height = `${n.h}px`;
      const path = s('path', { d: SHAPE_D[n.kind] || SHAPE_D.round, 'vector-effect': 'non-scaling-stroke', pathLength: '1' });
      c.append(s('svg', { class: 'pm-shp', viewBox: '0 0 100 100', preserveAspectRatio: 'none' }, [path]));
      obj.paths = [path];
      if (n.text) {
        const st = ctx.style('body') || {};
        const t = h('div', 'pm-txt pm-shtxt');
        t.textContent = n.text;
        Object.assign(t.style, { fontFamily: st.css || '', fontSize: `${st.size || 34}px`, fontWeight: String(st.weight || 400), lineHeight: String(st.lh || 1.3) });
        c.append(t);
      }
      obj.label = n.text || 'forme';
    } else if (n.type === 'ink') {
      o.style.height = `${n.h}px`;
      const path = s('path', { d: inkD(n.pts), pathLength: '1', 'vector-effect': 'non-scaling-stroke' });
      path.style.strokeWidth = `${Math.max(2, (n.width || 2.2) * 3)}px`;
      c.append(s('svg', { class: 'pm-ink', viewBox: '0 0 1000 1000', preserveAspectRatio: 'none' }, [path]));
      obj.paths = [path];
      obj.label = 'trait';
    } else if (n.type === 'web') {
      // un objet Web : l'image de son aperçu (lue et rangée par le serveur, server/tools/web_apercu.py), jamais
      // le site lui-même ; sans image, son titre et son site
      o.style.height = `${n.h}px`;
      e.classList.add('pm-clip');
      obj.media = true;
      if (n.img) {
        const img = new Image();
        img.decoding = 'async';
        img.className = 'pm-img';
        img.alt = n.title || n.site || '';
        img.src = href(`api/ideation/web/img/${n.img}`);
        c.append(img);
        obj.img = img;
      } else {
        c.append(h('div', 'pm-other pm-webt', [h('b', '', [document.createTextNode(n.title || n.url || 'web')]),
          n.site ? h('span', '', [document.createTextNode(n.site)]) : null]));
      }
      if (ctx.print) c.append(footOf(n.site ? `web · ${n.site}` : 'web'));
      obj.label = n.title || n.site || 'web';
    } else {
      // le reste (cartes, mind map…) : une surface du modèle et son nom
      o.style.height = `${n.h}px`;
      c.append(h('div', 'pm-other', [document.createTextNode(ctx.labelOf ? ctx.labelOf(n) : n.type)]));
      obj.label = n.type;
    }
    obj.mo = normMotion(n.motion) || (ctx.motionOf ? ctx.motionOf(n, part, order.get(n.id), role) : null);
    objs.push(obj);
    root.append(o);
  }

  // ── le décor du modèle (des données : tpl.decor) ─────────
  const decor = [];
  for (const [k, d] of (tpl?.decor || []).entries()) {
    if (d.on && d.on !== 'all' && !(Array.isArray(d.on) ? d.on : [d.on]).includes(role)) continue;
    if (d.not && (Array.isArray(d.not) ? d.not : [d.not]).includes(role)) continue;
    const obj = decorItem(d, k, { ctx, role, bgKey, pal, inkTone, f });
    if (!obj) continue;
    (d.layer === 'back' ? back : front).append(obj.o);
    decor.push(obj);
  }
  root.append(front);
  bg.style.background = `var(--t-${bgKey})`;
  return { el: root, objs, decor, all: [...decor.filter((d) => d.mo && d.layer !== 'front'), ...objs, ...decor.filter((d) => d.mo && d.layer === 'front')], role, bgKey, frame: f };
}

// un élément de décor : même emboîtement que les objets (le moteur l'anime pareil)
function decorItem(d, k, { ctx, role, bgKey, pal, inkTone, f }) {
  const o = h('div', `pm-o pm-dc pm-dc-${d.kind}`);
  const p = h('div', 'pm-p'), e = h('div', 'pm-e'), m = h('div', 'pm-m'), l = h('div', 'pm-l'), c = h('div', 'pm-c');
  l.append(c); m.append(l); e.append(m); p.append(e); o.append(p);
  const obj = { id: `decor:${k}`, n: null, part: 'decor', kind: d.kind, o, p, e, m, l, c, txt: null, text: '', paths: [], label: `décor · ${d.kind}`, layer: d.layer || 'front' };
  const tone = d.tone === 'auto' || !d.tone ? inkTone || 'ink' : d.tone;
  o.dataset.tone = tone;
  const box = (x, y, w, hh) => Object.assign(o.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${hh}px` });
  const style = (sid) => ctx.style(sid) || {};
  const text = (str, sid) => {
    const st = style(sid);
    const t = h('div', 'pm-txt');
    t.textContent = str;
    Object.assign(t.style, { fontFamily: st.css || '', fontSize: `${d.size || st.size || 18}px`, fontWeight: String(d.weight || st.weight || 400),
      lineHeight: String(st.lh || 1.2), letterSpacing: `${d.track ?? st.track ?? 0}em`, textTransform: (d.upper ?? st.upper) ? 'uppercase' : 'none', textAlign: d.align || 'left', whiteSpace: 'pre' });
    c.append(t);
    obj.txt = t; obj.text = str;
  };
  const W = f.w, H = f.h;
  switch (d.kind) {
    case 'bars': {   // le cadre large du cinéma : deux bandes, haut et bas
      box(0, 0, W, H);
      const hh = d.h || 132;
      const top = h('i', 'pm-lb pm-lb-t'), bot = h('i', 'pm-lb pm-lb-b');
      top.style.height = bot.style.height = `${hh}px`;
      c.append(top, bot);
      obj.bars = [top, bot];
      break;
    }
    case 'rule': box(d.x ?? 96, d.y ?? 96, d.w ?? (W - 192), Math.max(1, d.h || 2)); { const b = h('i', 'pm-rule'); c.append(b); obj.bar = b; } break;
    case 'folio': box(d.x ?? 96, d.y ?? (H - 96 - 24), d.w ?? 400, 40); text(d.total === false ? String((ctx.index ?? 0) + 1).padStart(2, '0') : `${String((ctx.index ?? 0) + 1).padStart(2, '0')} / ${String(ctx.count ?? 1).padStart(2, '0')}`, d.style || 'label'); break;
    case 'mark': box(d.x ?? 96, d.y ?? 72, d.w ?? 800, 40); text(d.text || ctx.tpl?.brand || ctx.name || '', d.style || 'label'); break;
    case 'num': box(d.x ?? (W - 96 - 700), d.y ?? 40, d.w ?? 700, d.size ? d.size * 1.1 : 480); text(String((ctx.index ?? 0) + 1).padStart(2, '0'), d.style || 'display'); o.classList.add(d.stroke ? 'pm-outline' : 'pm-solid'); break;
    case 'grain': box(0, 0, W, H); c.append(h('div', 'pm-grain')); o.style.opacity = String(d.opacity ?? 0.08); break;
    case 'glow': { const r = d.r || 520; box((d.x ?? W / 2) - r, (d.y ?? H / 2) - r, 2 * r, 2 * r); c.append(h('div', 'pm-glow')); o.style.opacity = String(d.opacity ?? 0.55); break; }
    case 'grid': { box(96, 0, W - 192, H); const g = h('div', 'pm-gridlines'); c.append(g); o.style.opacity = String(d.opacity ?? 0.14); break; }
    case 'block': box(d.x ?? 0, d.y ?? 0, d.w ?? 240, d.h ?? H); c.append(h('i', 'pm-block')); break;
    case 'ring': {
      const r = d.r || 300;
      box((d.x ?? W / 2) - r, (d.y ?? H / 2) - r, 2 * r, 2 * r);
      const path = s('circle', { cx: 50, cy: 50, r: 49, pathLength: '1', 'vector-effect': 'non-scaling-stroke' });
      path.style.strokeWidth = `${d.width || 2}px`;
      c.append(s('svg', { class: 'pm-ring', viewBox: '0 0 100 100' }, [path]));
      obj.paths = [path];
      break;
    }
    case 'scan': box(0, 0, W, H); c.append(h('div', 'pm-scan'), h('div', 'pm-sweep')); o.style.opacity = String(d.opacity ?? 0.5); break;
    case 'border': { const i = d.inset ?? 40; box(i, i, W - 2 * i, H - 2 * i); c.append(h('i', 'pm-border')); break; }
    case 'ticker': {
      box(0, d.y ?? (H - 64), W, d.h || 64);
      const band = h('div', 'pm-tick');
      const str = `${d.text || ctx.tpl?.brand || ctx.name || ''}   ·   `;
      const st = style(d.style || 'label');
      band.textContent = str.repeat(24);
      Object.assign(band.style, { fontFamily: st.css || '', fontSize: `${d.size || st.size || 18}px`, letterSpacing: `${st.track || 0.2}em`, textTransform: 'uppercase' });
      c.append(band);
      obj.band = band;
      break;
    }
    default: return null;
  }
  obj.mo = d.motion ? normMotion(d.motion) : null;
  return obj;
}

// le pied discret d'un objet qui ne s'imprime pas : ce qu'il est (« vidéo », « son », « web · site »)
function footOf(text) {
  return h('span', 'pm-foot', [document.createTextNode(text)]);
}

// les polices qu'une scène montre : la première famille de chaque texte (celle qu'on a voulue, pas un repli).
// Le PDF embarque ses polices : leur licence le permet-elle (server/tools/ideation.py, FONTS : `pdf`) ?
// La page d'impression le dit au travail (lecture.js, SR_IMPRESSION) ; le mode, avant de le lancer.
export function fontsOf(root) {
  const out = new Set();
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    if (!t.nodeValue.trim() || !t.parentElement) continue;
    const first = (getComputedStyle(t.parentElement).fontFamily || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
    if (first) out.add(first);
  }
  return [...out];
}

// les vidéos d'une scène : en pause quand elle s'en va (et relâchées)
export function releaseScene(sc) {
  for (const o of sc?.objs || []) if (o.video) { try { o.video.pause(); o.video.removeAttribute('src'); o.video.load(); } catch { /* */ } }
}
// les images d'une scène, décodées (avant une transition : rien ne se décode pendant qu'elle joue)
export function decoded(sc, ms = 1800) {
  const ps = (sc?.objs || []).filter((o) => o.img).map((o) => o.img.decode().catch(() => {}));
  return Promise.race([Promise.all(ps), new Promise((r) => setTimeout(r, ms))]);
}
