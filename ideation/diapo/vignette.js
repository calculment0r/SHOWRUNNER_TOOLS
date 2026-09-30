// IDÉATION · DIAPOSITIVES — la vignette d'un cadre (le panneau Diapositives) :
// ce qu'il contient, redessiné en petit sur un <canvas>. Les images : leur
// vignette de la bibliothèque (object-fit: cover, comme sur la planche) ; les
// textes à style : leur police, leur taille de scène réduite ; le reste : un aplat.
// Les couleurs sont lues dans les jetons du thème à chaque dessin (le thème clair
// redessine clair) ; celles d'un nuancier sont des données.

import { href } from '../../commun/shell.js';
import { within } from '../atelier/socle.js';

const imgs = new Map();   // url → Image (chargée une fois)
function image(url, again) {
  let im = imgs.get(url);
  if (!im) {
    im = new Image();
    im.decoding = 'async';
    im.src = url;
    imgs.set(url, im);
  }
  if (!im.complete) im.addEventListener('load', again, { once: true });
  return im.complete && im.naturalWidth ? im : null;
}
function cover(c, im, x, y, w, h) {
  const r = Math.max(w / im.naturalWidth, h / im.naturalHeight);
  const sw = w / r, sh = h / r;
  c.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}
function lines(c, text, width) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    let cur = '';
    for (const w of para.split(' ')) {
      const t = cur ? `${cur} ${w}` : w;
      if (c.measureText(t).width <= width || !cur) cur = t;
      else { out.push(cur); cur = w; }
    }
    out.push(cur);
  }
  return out;
}

// dessine le cadre `f` dans le canvas `cv` (sa taille CSS × densité) ; `again` : redessiner (une image arrive)
export function drawSlide(cv, app, f, style, again, lookFor = null) {
  const { S } = app;
  const dpr = devicePixelRatio || 1;
  const W = cv.clientWidth || 128, H = cv.clientHeight || 72;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cs = getComputedStyle(document.documentElement);
  const tok = (k) => cs.getPropertyValue('--' + k).trim();
  const k = Math.min(W / f.w, H / f.h);
  const ox = (W - f.w * k) / 2, oy = (H - f.h * k) / 2;
  c.clearRect(0, 0, W, H);
  // l'habit du modèle appliqué (presentation/scene.js, lookOf : le fond, la couleur de chaque texte), s'il y en a un
  const look = typeof lookFor === 'function' ? lookFor(f) : null;
  c.fillStyle = look?.bg || tok('panel');
  c.fillRect(ox, oy, f.w * k, f.h * k);
  c.save();
  c.beginPath(); c.rect(ox, oy, f.w * k, f.h * k); c.clip();
  const X = (x) => ox + (x - f.x) * k, Y = (y) => oy + (y - f.y) * k;
  for (const n of S.board.nodes) {
    if (n.type === 'frame' || n.type === 'group' || !within(n, f)) continue;
    const x = X(n.x), y = Y(n.y), w = n.w * k, h = n.h * k;
    if (n.type === 'media') {
      const it = S.items.get(n.item);
      const url = it && !it.missing ? (n.kind === 'element' ? it.element?.refs?.[0]?.thumb_url || it.thumb_url : it.thumb_url || (n.kind === 'image' ? it.url : '')) : '';
      const im = url ? image(href(url), again) : null;
      if (im) cover(c, im, x, y, w, h);
      else { c.fillStyle = tok('panel3'); c.fillRect(x, y, w, h); }
      continue;
    }
    if ((n.type === 'title' || n.type === 'note') && n.style) {
      const st = style(n.style);
      if (!st) continue;
      const px = st.size * k;
      if (px < 1.2) { c.fillStyle = look?.colors.get(n.id) || tok('ink3'); c.fillRect(x, y + h / 3, w * 0.7, Math.max(1, h / 3)); continue; }
      c.font = `${st.weight} ${px}px ${st.css}`;
      c.fillStyle = look?.colors.get(n.id) || tok('ink');
      c.textBaseline = 'top';
      const L = lines(c, st.upper ? String(n.text || '').toUpperCase() : n.text, w);
      L.forEach((t, i) => {
        const tw = c.measureText(t).width;
        const tx = n.align === 'center' ? x + (w - tw) / 2 : n.align === 'right' ? x + w - tw : x;
        c.fillText(t, tx, y + i * px * st.lh);
      });
      continue;
    }
    if (n.type === 'title') { c.fillStyle = tok('ink'); c.fillRect(x, y + h * 0.25, Math.min(w, (n.text || '').length * 20 * k), Math.max(1, h * 0.5)); continue; }
    if (n.type === 'sticky') { c.fillStyle = tok(n.color) || tok('coral-3'); c.fillRect(x, y, w, h); continue; }
    if (n.type === 'palette') {
      const cols = n.colors || [];
      cols.forEach((col, i) => { c.fillStyle = col; c.fillRect(x + (w / cols.length) * i, y, w / cols.length, h); });
      continue;
    }
    c.fillStyle = n.type === 'note' ? tok('panel2') : n.type === 'gen' || n.type === 'vgen' ? tok('or-bg2') : tok('panel3');
    c.fillRect(x, y, w, h);
  }
  c.restore();
}
