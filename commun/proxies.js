// SHOWRUNNER TOOLS — les copies d'affichage : chaque image à la taille où
// elle est vue (docs/etudes/ideation_fluidite.md, § 4 ; tldraw sert l'image
// « à la taille de l'écran, arrondie à la puissance de deux », Figma ne
// charge la haute définition que de ce qu'on regarde).
//
// Le serveur fait, pour chaque image (et l'affiche d'une vidéo), des copies
// WebP de 256, 512, 1024 et 2048 px de grand côté, jamais plus grandes que
// l'original (server/core/library.py) ; l'objet public dit lesquelles
// existent : `views: [256, 512, …]` et `view_urls: {"256": "library/…/view-256.webp?v=…"}`,
// adresses versionnées que le navigateur garde un an.
//
//   pickView(it, cssPx)            → { url, w } : la plus petite copie dont le
//                                    grand côté couvre cssPx × devicePixelRatio ;
//                                    au-delà, l'original (w = ORIGINAL). Sans
//                                    copie : la vignette si elle suffit, sinon l'original
//   needOf(it, boxW, boxH, fit)    → cssPx : le grand côté de l'image quand elle
//                                    remplit (cover) ou tient dans (contain) une boîte
//   swap(img, url, w)              → Promise<bool> : la nouvelle adresse est
//                                    décodée (img.decode()) avant l'échange — pas
//                                    de trou, pas de clignotement ; une image qu'on
//                                    regarde ne redescend pas (w plus petit : rien)
//   bind(img, it, { fit, box })    : pose l'adresse de la boîte estimée, puis
//                                    suit la taille réelle de l'image
//                                    (ResizeObserver) et monte de copie quand elle
//                                    grandit — seulement près de l'écran
//                                    (IntersectionObserver)
//
// Les adresses rendues sont absolues (résolues depuis la racine du portail,
// la même que shell.js), prêtes pour `img.src` ou `background-image`.

const ROOT = new URL('../', import.meta.url);   // la racine du portail, comme ROOT de shell.js
const abs = (p) => (/^https?:/.test(p) ? p : new URL(p, ROOT).href);

export const ORIGINAL = Infinity;
const THUMB = 384;   // la vignette JPEG du socle (library.THUMB)

const dpr = () => window.devicePixelRatio || 1;

/** Les copies qui existent, de la plus petite à la plus grande : [{ w, url }]. */
export function viewsOf(it) {
  const urls = it?.view_urls || {};
  return (Array.isArray(it?.views) ? it.views : []).filter((w) => urls[w]).map((w) => ({ w, url: urls[w] })).sort((a, b) => a.w - b.w);
}

/** L'adresse pour montrer `it` avec `cssPx` px CSS de grand côté. */
export function pickView(it, cssPx, density = dpr()) {
  if (!it) return { url: '', w: 0 };
  const need = Math.max(1, cssPx || 0) * density;
  const list = viewsOf(it);
  const v = list.find((x) => x.w >= need);
  if (v) return { url: abs(v.url), w: v.w };
  if (it.kind === 'image' && it.url) {
    // pas encore de copies (rangée avant elles) : la vignette tant qu'elle suffit
    if (!list.length && it.thumb_url && it.thumb_url !== it.url && need <= THUMB) return { url: abs(it.thumb_url), w: THUMB };
    return { url: abs(it.url), w: ORIGINAL };
  }
  // une vidéo, un élément : leur affiche — la plus grande copie, sinon la
  // vignette ; rien d'autre (le fichier d'une vidéo, d'un son n'est pas une image)
  const top = list[list.length - 1];
  if (top) return { url: abs(top.url), w: top.w };
  if (it.thumb_url) return { url: abs(it.thumb_url), w: THUMB };
  return { url: '', w: 0 };
}

/** Le grand côté (px CSS) de l'image de `it` posée dans une boîte boxW × boxH. */
export function needOf(it, boxW, boxH, fit = 'cover') {
  const W = +it?.width || 0, H = +it?.height || 0;
  if (!W || !H) return Math.max(boxW || 0, boxH || 0);
  const s = fit === 'contain' ? Math.min(boxW / W, boxH / H) : Math.max(boxW / W, boxH / H);
  return Math.max(W, H) * s;
}

/** Échange l'adresse d'une image, décodée d'abord ; jamais vers une copie plus petite (sauf `force`). */
export function swap(img, url, w = 0, { force = false } = {}) {
  if (!img || !url) return Promise.resolve(false);
  const target = abs(url);
  const cur = img.getAttribute('src') ? (+img.dataset.vw || 0) : -1;
  if (!force && cur >= 0 && w <= cur) return Promise.resolve(false);   // elle ne redescend pas
  if (img.dataset.want === target) return img._vwP || Promise.resolve(false);
  img.dataset.want = target;
  const put = () => {
    if (img.dataset.want !== target) return false;   // une autre adresse est partie depuis
    img.src = target;
    img.dataset.vw = String(w);
    return true;
  };
  if (cur < 0) return Promise.resolve(put());   // rien d'affiché encore : rien à décoder avant
  const pre = new Image();
  pre.decoding = 'async';
  pre.src = target;
  // décodée, elle remplace l'autre ; illisible, l'autre reste
  img._vwP = pre.decode().then(put, () => { if (img.dataset.want === target) delete img.dataset.want; return false; });
  return img._vwP;
}

// ── suivre la taille d'une image ─────────────────────────────
const bound = new WeakMap();   // img → { it, fit, vis }
function refit(img) {
  const b = bound.get(img);
  if (!b || !b.vis || !img.isConnected) return;
  const r = img.getBoundingClientRect();
  if (!r.width || !r.height) return;   // cachée
  const p = pickView(b.it, needOf(b.it, r.width, r.height, b.fit));
  swap(img, p.url, p.w);
}
const RO = 'ResizeObserver' in window ? new ResizeObserver((es) => { for (const e of es) refit(e.target); }) : null;
// près de l'écran seulement (une demi-hauteur autour) : ce qui est loin ne télécharge rien de plus
const IO = 'IntersectionObserver' in window ? new IntersectionObserver((es) => {
  for (const e of es) {
    const b = bound.get(e.target);
    if (!b) continue;
    b.vis = e.isIntersecting;
    if (b.vis) refit(e.target);
  }
}, { rootMargin: '50% 0px' }) : null;

/** Pose sur `img` l'adresse de la boîte estimée `box: [w, h]` (px CSS), puis la
 *  suit. Sans `box`, l'adresse vient de la taille réelle, à la première mise
 *  en page (le fetch part une image plus tard, à la bonne taille). */
export function bind(img, it, { fit = 'cover', box = null } = {}) {
  bound.set(img, { it, fit, vis: !IO });
  const p = box ? pickView(it, needOf(it, box[0], box[1], fit)) : (!RO || !IO ? pickView(it, 256) : null);
  if (p?.url) {
    img.src = p.url;
    img.dataset.vw = String(p.w);
  }
  RO?.observe(img);
  IO?.observe(img);
  return img;
}

/** Oublie une image (retirée pour de bon) : plus de suivi. */
export function unbind(img) {
  bound.delete(img);
  RO?.unobserve(img);
  IO?.unobserve(img);
}
