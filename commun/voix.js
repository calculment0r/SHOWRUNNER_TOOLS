// LA frise des voix du portail : une piste par voix — en haut sa ligne de
// dialogue, chaque mot posé à l'instant où on l'entend ; dessous sa
// probabilité de parole trame par trame (le « spectre » du modèle de
// diarisation), le seuil, les répliques retenues. Cal, 30/09 : « notre outil de
// diarisation et sa mise en forme avec les spectres étaient bien ».
//
// C'est le dessin de la diarisation de Movie Analysis, sorti en module :
// analyse/diarisation/index.html — `dessineFrise` (les pistes, l'aire de
// probabilité, le tireté du seuil, les segments), `dessineLignes`, `motsDans`,
// `texteDans`, `rond`, la bulle de `brancheFrise` ; les mêmes règles (la
// police de 11 à 6 px où les trois quarts des mots tiennent, un mot sans place
// n'est plus qu'un trait à son instant, un texte sans mots horodatés reste en
// bloc dans son temps). Movie Analysis garde pour l'instant sa copie (un
// script classique, inliné par sa chaîne) : ce module est la version commune,
// paramétrée, sans globales, que la page de diarisation pourra prendre.
//
// Les teintes : les jetons du portail, lus à l'exécution (le canvas en a besoin
// en valeurs) et relus quand le thème change (sr:theme). Les voix : --pv-0…7
// si la page les déclare (analyse/film/palette.css : les huit teintes
// calculées des voix de Movie Analysis), sinon huit jetons du portail. Aucune
// couleur n'est écrite ici.
//
//   const F = friseVoix({ onSeek: (t) => …, cle: 'transcrire', tete: [nœuds] })
//   box.append(F.el)       `tete` : les nœuds de la page en tête de la frise, à la
//                          place de son titre (Transcrire : le pli, les noms des voix)
//   F.donner({ duree, voix: [{ id, nom, col }], probas: { pas, n, V, q } | null,
//              lignes: [{ id, a, b, voix, texte, mots: [{ w, a, b }] | null }] })
//   F.temps(t, lecture)    la tête ; en lecture, la vue suit
//   F.dessiner()           après un renommage, un thème
//   F.plier(oui)           repliée : sa tête seule (une rangée fine) ; dépliée : sa hauteur
//   F.detruire()
import { el } from './shell.js';
import { brancher, AIDE } from './molette.js';

if (typeof document !== 'undefined' && !document.querySelector('link[data-sr-voix]')) {
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./voix.css', import.meta.url).href, 'data-sr-voix': '' }));
}

export const N_TEINTES = 8;
// la teinte d'une voix pour le DOM (une pastille, un filet) : la palette de la page, sinon celle du portail
export const REPLI = ['--cy', '--coral-2', '--grn2', '--amb', '--coral-3', '--ink2', '--coral-1', '--verd-2'];
export const teinte = (i) => `var(--pv-${((i % N_TEINTES) + N_TEINTES) % N_TEINTES}, var(${REPLI[((i % N_TEINTES) + N_TEINTES) % N_TEINTES]}))`;

const ZOOMS = [1, 2, 4, 8, 24];
const H = { regle: 22, voix: [46, 30, 240], voixDial: [80, 60, 240] };
const SEUIL = 0.5;   // le seuil d'entrée de NeMo par défaut (onset 0,5 : POST_DEFAUT du service, le tireté de Movie Analysis)

// une teinte lue (#rrggbb, rgb(…)) avec son alpha — la même aide que Movie Analysis
function rgba(c, a) {
  c = String(c || '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) c = '#' + m[1].split('').map((x) => x + x).join('');
  m = /^#([0-9a-f]{6})/i.exec(c);
  if (m) { const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
  m = /^rgba?\(([^)]*)\)$/i.exec(c);
  if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean); return `rgba(${p[0]},${p[1]},${p[2]},${a})`; }
  return c;
}
const tc = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); return String(m).padStart(2, '0') + ':' + (s - m * 60).toFixed(2).padStart(5, '0'); };
const pct = (x) => Math.round(x * 100) + ' %';
function b64u8(s) { const bin = atob(s || ''); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

// les probabilités du service (base64) ou déjà en octets
export function probasDe(p) {
  if (!p || !p.q) return null;
  const q = p.q instanceof Uint8Array ? p.q : b64u8(p.q);
  return { pas: +p.pas_s || +p.pas, n: +p.n, V: +p.voix || +p.V, q, source: p.source || '' };
}

function rond(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// Les mots à l'instant où on les entend (motsDans de Movie Analysis) : chaque mot part de son début et va
// jusqu'au mot suivant ; la plus grande police (11 à 6 px) où les trois quarts tiennent ; un mot à l'étroit
// rétrécit seul, puis se coupe ; sans place, un trait à son instant.
function motsDans(ctx, mots, X, y, h, x0, x1, couleur, police) {
  const pos = mots.map((m, i) => [X(m.a), i + 1 < mots.length ? X(mots[i + 1].a) : x1]);
  const place = (i) => pos[i][1] - pos[i][0] - 3;
  const fonte = (t) => { ctx.font = `600 ${t}px ${police}`; };
  let taille = 6;
  for (let t = 11; t > 6; t -= 0.5) {
    fonte(t);
    if (mots.filter((m, i) => ctx.measureText(m.w.trim()).width <= place(i)).length >= mots.length * 0.75) { taille = t; break; }
  }
  ctx.save(); ctx.beginPath(); ctx.rect(x0, y, x1 - x0, h); ctx.clip();
  ctx.fillStyle = couleur; ctx.textBaseline = 'middle';
  const ym = y + h / 2;
  const trait = (x) => { ctx.globalAlpha = 0.45; ctx.fillRect(Math.round(x) + 1, ym - 3, 1, 6); ctx.globalAlpha = 1; };
  mots.forEach((m, i) => {
    const x = pos[i][0], p = place(i);
    if (p < 8) { trait(x); return; }
    let t = m.w.trim(), tt = taille;
    fonte(tt);
    while (tt > 6 && ctx.measureText(t).width > p) fonte(tt -= 0.5);
    if (ctx.measureText(t).width > p) { while (t && ctx.measureText(t + '…').width > p) t = t.slice(0, -1); t = t ? t + '…' : ''; }
    if (!t) trait(x); else ctx.fillText(t, x + 1, ym);
  });
  ctx.restore();
}

// Un texte dans une boîte, sans jamais en sortir (texteDans de Movie Analysis) : de 9,5 à 6 px, sur autant de
// lignes que la hauteur en tient, l'ellipse au bout.
function texteDans(ctx, texte, x, y, w, h, couleur, police) {
  if (w < 10 || !texte) return;
  const wt = w - 2;
  const mots = texte.split(/\s+/).filter(Boolean);
  let rendu = null;
  for (let taille = 9.5; taille >= 6; taille -= 0.5) {
    ctx.font = `600 ${taille}px ${police}`;
    const pas = taille * 1.18, max = Math.max(1, Math.floor((h - 2) / pas));
    const lignes = [];
    let cur = '';
    for (const m of mots) { const essai = cur ? cur + ' ' + m : m; if (!cur || ctx.measureText(essai).width <= wt) cur = essai; else { lignes.push(cur); cur = m; } }
    if (cur) lignes.push(cur);
    rendu = { pas, max, lignes };
    if (lignes.length <= max && lignes.every((l) => ctx.measureText(l).width <= wt)) break;
  }
  let { pas, max, lignes } = rendu;
  const ellipse = (l) => { while (l && ctx.measureText(l + '…').width > wt) l = l.slice(0, -1); return l.trimEnd() + '…'; };
  if (lignes.length > max) { lignes = lignes.slice(0, max); lignes[max - 1] = ellipse(lignes[max - 1]); }
  lignes = lignes.map((l) => (ctx.measureText(l).width > wt ? ellipse(l) : l));
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = couleur; ctx.textBaseline = 'middle';
  const y0 = y + (h - lignes.length * pas) / 2 + pas / 2;
  lignes.forEach((l, i) => ctx.fillText(l, x + 2, y0 + i * pas));
  ctx.restore();
}

export function friseVoix({ onSeek = () => {}, cle = 'page', tete = null } = {}) {
  const KEY = 'sr-voix-hauteurs-' + cle;
  let hauteurs = {};
  try { hauteurs = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { hauteurs = {}; }
  const D = { duree: 0, voix: [], probas: null, lignes: [] };
  const V = { zoom: 1, t: 0, J: {}, cols: [], cleNoms: '' };

  const noms = el('div', { class: 'sr-vx-noms' });
  const cv = el('canvas', { class: 'sr-vx-cv' });
  const espace = el('div', { class: 'sr-vx-espace' }, cv);
  const zone = el('div', { class: 'sr-vx-zone', title: 'clic, glisser : la tête de lecture' }, espace);
  const cue = el('div', { class: 'sr-vx-cue', hidden: true });
  const croix = el('div', { class: 'sr-vx-croix', hidden: true });
  const bulle = el('div', { class: 'sr-vx-bulle', hidden: true });
  const plot = el('div', { class: 'sr-vx-plot' }, zone, cue, croix, bulle);
  const zooms = el('div', { class: 'seg sr-vx-zooms', role: 'group', 'aria-label': 'zoom du temps' },
    ...ZOOMS.map((z) => el('button', { class: 'tb' + (z === 1 ? ' on' : ''), type: 'button', 'data-z': z, onclick: () => zoome(z) }, '×' + z)));
  const legende = el('span', { class: 'lbl sr-vx-leg' });
  const root = el('div', { class: 'sr-vx' },
    el('div', { class: 'sr-vx-tete' }, tete || el('span', { class: 'lbl' }, 'les voix · chaque mot à son instant, sous lui la voix'),
      el('span', { class: 'sp' }), el('span', { class: 'lbl sr-vx-aide' }, AIDE), zooms),
    el('div', { class: 'sr-vx-corps' }, noms, plot), legende);

  function teintes() {
    const cs = getComputedStyle(root);
    const j = (n) => cs.getPropertyValue(n).trim();
    V.J = { ink: j('--ink'), ink3: j('--ink3'), grn: j('--grn'), or: j('--or'), police: `${j('--f-ui') || 'sans-serif'}` };
    V.cols = Array.from({ length: N_TEINTES }, (_, i) => j(`--pv-${i}`) || j(REPLI[i]));
  }
  const col = (v) => V.cols[((v.col ?? 0) % N_TEINTES + N_TEINTES) % N_TEINTES] || V.J.ink;

  function vue() {
    const w = zone.clientWidth || 1, total = w * V.zoom;
    const a = (zone.scrollLeft / total) * D.duree;
    return [a, a + D.duree / V.zoom];
  }
  function hPiste(v, dial) {
    const [d, lo, hi] = dial ? H.voixDial : H.voix;
    return Math.max(lo, Math.min(hi, hauteurs[v.id] || d));
  }
  function pistes() {
    const L = [{ type: 'regle', h: H.regle }];
    for (const v of D.voix) {
      const dial = D.lignes.some((l) => l.voix === v.id);
      L.push({ type: 'voix', v, dial, h: hPiste(v, dial) });
    }
    let y = 0;
    for (const l of L) { l.y = y; y += l.h; }
    return { L, H: y };
  }
  function parler(v) {
    let s = 0, n = 0;
    for (const l of D.lignes) if (l.voix === v.id) { s += l.b - l.a; n++; }
    return [s, n];
  }
  function dessiner() {
    const w = zone.clientWidth;
    if (!w || !D.duree) return;
    if (!V.J.ink) teintes();
    const { L, H: Ht } = pistes();
    espace.style.width = (w * V.zoom) + 'px';
    espace.style.height = Ht + 'px';
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(Ht * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(Ht * dpr); }
    cv.style.width = w + 'px'; cv.style.height = Ht + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, Ht);
    const [a, b] = vue();
    const X = (t) => ((t - a) / (b - a)) * w;
    // les noms, à gauche : refaits quand les pistes (ou un nom) changent
    const cleNoms = L.map((l) => (l.v ? `${l.v.id}:${l.v.nom}:${l.v.col}:${l.h}` : l.type)).join('|');
    if (cleNoms !== V.cleNoms) {
      V.cleNoms = cleNoms;
      noms.replaceChildren(...L.map((l) => {
        if (l.type === 'regle') return el('div', { style: { height: l.h + 'px' } }, 'temps');
        const [s, n] = parler(l.v);
        return el('div', { style: { height: l.h + 'px', '--c': teinte(l.v.col ?? 0) }, 'data-piste': l.v.id, title: 'ctrl + molette : la hauteur de cette piste' },
          el('i'), el('span', { class: 'nv' }, el('b', {}, l.v.nom), el('small', {}, `${n} répl. · ${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)));
      }));
    }
    const pas = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((p) => (b - a) / p <= w / 90) || 1200;
    const P = D.probas;
    for (const l of L) {
      const y = l.y, h = l.h;
      if (l.type === 'regle') {
        ctx.font = `9px ${V.J.police}`; ctx.textBaseline = 'middle';
        for (let t = Math.ceil(a / pas) * pas; t <= b; t += pas) {
          const x = Math.round(X(t)) + 0.5;
          ctx.fillStyle = rgba(V.J.grn, 0.55); ctx.fillRect(x, y + 14, 1, 8);
          ctx.fillStyle = V.J.ink3; ctx.fillText(pas < 1 ? tc(t) : tc(t).slice(0, -3), x + 4, y + 9);
        }
        continue;
      }
      ctx.fillStyle = rgba(V.J.grn, 0.14);
      for (let t = Math.ceil(a / pas) * pas; t <= b; t += pas) ctx.fillRect(Math.round(X(t)), y, 1, h);
      ctx.fillStyle = rgba(V.J.grn, 0.28); ctx.fillRect(0, y + h - 1, w, 1);
      const v = l.v, c = col(v), haut = y + (l.dial ? 40 : 6), bas = y + h - 10, hh = bas - haut;
      // la ligne de dialogue : un cartouche par réplique, teint de la voix, sur son temps
      if (l.dial) {
        for (const d of D.lignes) {
          if (d.voix !== v.id || d.b < a || d.a > b) continue;
          const x0 = X(d.a), x1 = X(d.b), lw = Math.max(2, x1 - x0 - 1);
          ctx.fillStyle = rgba(c, 0.3); rond(ctx, x0, y + 5, lw, 30, 4); ctx.fill();
          if (d.mots && d.mots.length) motsDans(ctx, d.mots, X, y + 5, 30, x0, x1, V.J.ink, V.J.police);
          else { const tx = Math.max(x0, 0) + 4; texteDans(ctx, d.texte, tx, y + 5, Math.min(x1, w) - 4 - tx, 30, V.J.ink, V.J.police); }
        }
      }
      // l'aire de probabilité (le spectre), son trait, le seuil
      const k = v.idx;
      if (P && k != null && k >= 0 && k < P.V) {
        const Y = (p) => bas - p * hh;
        const at = (px) => {
          const t0 = a + (px / w) * (b - a), t1 = a + ((px + 1) / w) * (b - a);
          const i0 = Math.max(0, Math.floor(t0 / P.pas)), i1 = Math.min(P.n, Math.max(i0 + 1, Math.ceil(t1 / P.pas)));
          let m = 0;
          for (let i = i0; i < i1; i++) { const q = P.q[i * P.V + k]; if (q > m) m = q; }
          return m / 255;
        };
        const ys = new Float32Array(w);
        for (let px = 0; px < w; px++) ys[px] = Y(at(px));
        ctx.beginPath(); ctx.moveTo(0, bas);
        for (let px = 0; px < w; px++) ctx.lineTo(px + 0.5, ys[px]);
        ctx.lineTo(w, bas); ctx.closePath();
        ctx.fillStyle = rgba(c, 0.28); ctx.fill();
        ctx.beginPath();
        for (let px = 0; px < w; px++) (px ? ctx.lineTo : ctx.moveTo).call(ctx, px + 0.5, ys[px]);
        ctx.strokeStyle = rgba(c, 0.95); ctx.lineWidth = 1.25; ctx.stroke();
        ctx.setLineDash([3, 4]); ctx.strokeStyle = rgba(V.J.ink, 0.22); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, Math.round(Y(SEUIL)) + 0.5); ctx.lineTo(w, Math.round(Y(SEUIL)) + 0.5); ctx.stroke(); ctx.setLineDash([]);
      }
      // les répliques retenues pour cette voix, en trait sous l'aire
      ctx.fillStyle = c;
      for (const d of D.lignes) {
        if (d.voix !== v.id || d.b < a || d.a > b) continue;
        rond(ctx, X(d.a), bas + 3, Math.max(2, X(d.b) - X(d.a) - 1), 4, 2); ctx.fill();
      }
    }
    placeCue();
  }
  function placeCue() {
    const [a, b] = vue(), w = zone.clientWidth;
    const inView = V.t >= a && V.t <= b && D.duree;
    cue.hidden = !inView;
    if (inView) cue.style.left = ((V.t - a) / (b - a)) * w + 'px';
  }
  function zoome(z, ancreX) {
    if (!D.duree) return;
    const w = zone.clientWidth;
    const [a, b] = vue();
    const x = ancreX ?? (V.t >= a && V.t <= b ? ((V.t - a) / (b - a)) * w : w / 2);
    const t = a + (x / w) * (b - a);
    V.zoom = Math.max(1, Math.min(48, z));
    espace.style.width = (w * V.zoom) + 'px';
    zone.scrollLeft = Math.max(0, (t / D.duree) * w * V.zoom - x);
    zooms.querySelectorAll('.tb').forEach((bt) => bt.classList.toggle('on', +bt.dataset.z === V.zoom));
    dessiner();
  }
  function hauteur(f, id) {
    for (const v of D.voix) {
      if (id && v.id !== id) continue;
      const dial = D.lignes.some((l) => l.voix === v.id);
      const [, lo, hi] = dial ? H.voixDial : H.voix;
      hauteurs[v.id] = Math.round(Math.max(lo, Math.min(hi, hPiste(v, dial) * f)) * 10) / 10;
    }
    try { localStorage.setItem(KEY, JSON.stringify(hauteurs)); } catch { /* stockage fermé */ }
    dessiner();
  }
  function probaA(t) {
    const P = D.probas;
    if (!P) return null;
    const i = Math.floor(t / P.pas);
    if (i < 0 || i >= P.n) return null;
    return D.voix.map((v) => (v.idx != null && v.idx < P.V ? P.q[i * P.V + v.idx] / 255 : 0));
  }

  // les gestes : clic, glisser (la tête) ; survol (la bulle) ; la molette commune (commun/molette.js)
  let glisse = false;
  const tDe = (ev) => { const r = zone.getBoundingClientRect(), [a, b] = vue(); return a + ((ev.clientX - r.left) / r.width) * (b - a); };
  zone.addEventListener('scroll', () => dessiner());
  zone.addEventListener('pointerdown', (ev) => { if (!D.duree || ev.button !== 0) return; glisse = true; zone.setPointerCapture(ev.pointerId); onSeek(Math.max(0, Math.min(D.duree, tDe(ev)))); });
  zone.addEventListener('pointerup', (ev) => { glisse = false; try { zone.releasePointerCapture(ev.pointerId); } catch { /* déjà relâché */ } });
  zone.addEventListener('pointerleave', () => { croix.hidden = true; bulle.hidden = true; });
  zone.addEventListener('pointermove', (ev) => {
    if (!D.duree) return;
    const r = zone.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, t = tDe(ev);
    if (glisse) onSeek(Math.max(0, Math.min(D.duree, t)));
    croix.hidden = false; croix.style.left = x + 'px';
    const p = probaA(t);
    const ici = D.lignes.filter((l) => l.a <= t && t < l.b);
    const rows = [el('div', { class: 't' }, tc(t))];
    if (p) {
      const ordre = D.voix.map((v, i) => [p[i], v]).filter(([q, v]) => q >= 0.02 || ici.some((l) => l.voix === v.id)).sort((m, n) => n[0] - m[0]);
      if (!ordre.length) rows.push(el('div', { class: 'l' }, el('b', {}, '—'), el('i'), el('span', {}, 'aucune voix au-dessus de 2 %')));
      for (const [q, v] of ordre) rows.push(el('div', { class: 'l' + (ici.some((l) => l.voix === v.id) ? ' actif' : ''), style: { '--c': teinte(v.col ?? 0) } },
        el('b', {}, pct(q)), el('i'), el('span', {}, v.nom + (ici.some((l) => l.voix === v.id) ? ' · parle' : ''))));
    }
    for (const l of ici) rows.push(el('div', { class: 'txt' }, `« ${l.texte} »`), el('div', { class: 't' }, D.voix.find((v) => v.id === l.voix)?.nom || ''));
    if (rows.length === 1) { bulle.hidden = true; return; }
    bulle.replaceChildren(...rows);
    bulle.hidden = false;
    const bw = bulle.offsetWidth, bh = bulle.offsetHeight;
    bulle.style.left = Math.min(r.width - bw - 4, x + 14) + 'px';
    bulle.style.top = Math.max(0, Math.min(zone.offsetHeight - bh, y - bh / 2)) + 'px';
  });
  const debrancher = brancher(root.querySelector('.sr-vx-corps'), {
    scroller: zone,
    zoom: (f, cx) => { const r = zone.getBoundingClientRect(); zoome(V.zoom * f, Math.max(0, Math.min(r.width, cx - r.left))); },
    hauteur: (f, id) => hauteur(f, id),
  });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (D.duree) { espace.style.width = zone.clientWidth * V.zoom + 'px'; dessiner(); } }) : null;
  ro?.observe(zone);
  const surTheme = () => { teintes(); V.cleNoms = ''; dessiner(); };
  document.addEventListener('sr:theme', surTheme);

  return {
    el: root,
    donner(d) {
      const neuf = (+d.duree || 0) !== D.duree;
      D.duree = +d.duree || 0;
      // un média neuf : le plus fort des zooms qui montre encore 12 s — à ×1, les mots d'une réplique ne sont que des traits
      if (neuf) V.zoom = ZOOMS.filter((z) => D.duree / z >= 12).pop() || 1;
      D.voix = d.voix || [];
      D.probas = probasDe(d.probas);
      D.lignes = d.lignes || [];
      V.cleNoms = '';
      legende.textContent = D.probas
        ? `aire : probabilité de parole de chaque voix, trame par trame (${Math.round(D.probas.pas * 1000)} ms${D.probas.source === 'factice' ? ', factice' : ''}) · tireté : le seuil ${String(SEUIL).replace('.', ',')} · trait : les répliques retenues`
        : 'le spectre des voix n’est pas là (transcription d’avant le 30/09, ou moteur sans voix) : les répliques seules';
      zooms.querySelectorAll('.tb').forEach((bt) => bt.classList.toggle('on', +bt.dataset.z === V.zoom));
      requestAnimationFrame(() => { teintes(); if (neuf) zone.scrollLeft = 0; dessiner(); });
    },
    temps(t, lecture = false) {
      V.t = t || 0;
      if (lecture && V.zoom > 1 && D.duree) {   // en lecture, la vue suit la tête
        const [a, b] = vue();
        if (V.t < a || V.t > b - (b - a) * 0.05) { zone.scrollLeft = Math.max(0, (V.t / D.duree) * zone.clientWidth * V.zoom - zone.clientWidth * 0.2); return; }
      }
      placeCue();
    },
    dessiner() { V.cleNoms = ''; dessiner(); },
    // repliée, la frise n'a plus de largeur : dépliée, son ResizeObserver la redessine
    plier(oui) { root.classList.toggle('plie', !!oui); },
    zoome,
    detruire() { debrancher(); ro?.disconnect(); document.removeEventListener('sr:theme', surTheme); root.remove(); },
  };
}
