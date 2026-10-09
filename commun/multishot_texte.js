// SHOWRUNNER TOOLS — le Multishot, côté texte : de la frise de plans au prompt H3, et retour. Pur, sans DOM.
//
// Cal, 04/10 : « on reste en langage naturel et c'est l'interface qui code les balises ». Ce que l'on écrit dans le panneau :
// des plans (une durée, ce qu'on y voit), et dans chaque plan des répliques rattachées à un personnage ; ce que H3 reçoit :
//
//   [Shot 1] <ce qu'on voit>  <personnage> (S1) says: <d>[French] la réplique</d>
//   [Shot 2] …
//
// Les sources de la forme : le guide officiel d'H3 (MiniMax-AI/MiniMax-H3, skills/h3-prompt-writing/references/base-en.txt,
// relu le 09/10) — § 4.2 : « Do not add a timestamp to the first shot […] begin each one with a strictly increasing cut time
// that falls within the video duration: [Shot 2] At 00:03.500, the camera cuts to… » ; § 4.4 : « (S1) says: <d>[Langue] …
// </d> », un identifiant de voix stable par personne. Les temps de coupe s'écrivent donc toujours (jusqu'au 09/10, une case
// éteinte écrivait « (about N seconds) », une forme que le guide ne connaît pas). La durée totale est celle de la page.
//
//   plan = { id, secs, text, lines: [{ who, text }] }       who : « @element1 », « the old man », ou '' (S1 sans nom)

export const LANG = { fr: 'French', en: 'English' };
export const MIN_SECS = 0.5;
const r1 = (x) => Math.round(x * 10) / 10;

let seq = 0;
export const newId = () => `p${++seq}`;
export const plan = (secs, text = '', lines = []) => ({ id: newId(), secs, text, lines });

// des durées qui retombent sur le total (le dernier plan prend l'écart d'arrondi)
export function fit(shots, total) {
  if (!shots.length) return shots;
  const sum = shots.reduce((s, p) => s + p.secs, 0) || 1;
  let acc = 0;
  shots.forEach((p, i) => {
    p.secs = i === shots.length - 1 ? r1(total - acc) : Math.max(MIN_SECS, r1((p.secs / sum) * total));
    acc += p.secs;
  });
  return shots;
}

export const equal = (n, total) => fit(Array.from({ length: n }, () => plan(1)), total);

// déplacer la limite entre le plan i et le plan i+1 de `d` secondes, sans toucher aux autres ni au total
export function moveEdge(shots, i, d) {
  const a = shots[i], b = shots[i + 1];
  if (!a || !b) return shots;
  const lo = MIN_SECS - a.secs, hi = b.secs - MIN_SECS;
  const x = Math.max(lo, Math.min(hi, d));
  a.secs = r1(a.secs + x);
  b.secs = r1(b.secs - x);
  return shots;
}

export function split(shots, i) {
  const p = shots[i];
  if (!p || p.secs < 2 * MIN_SECS) return shots;
  const h = r1(p.secs / 2);
  const q = plan(r1(p.secs - h));
  p.secs = h;
  shots.splice(i + 1, 0, q);
  return shots;
}

export function remove(shots, i) {
  if (shots.length < 2) return shots;
  const [p] = shots.splice(i, 1);
  const to = shots[Math.min(i, shots.length - 1)];
  to.secs = r1(to.secs + p.secs);
  return shots;
}

// l'auto : un texte découpé en phrases, rangé en n plans de même durée (les phrases se partagent, dans l'ordre)
export function auto(text, n, total) {
  const sent = String(text || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const k = Math.max(1, Math.min(n, sent.length || 1));
  const shots = equal(k, total);
  const per = Math.ceil(sent.length / k) || 1;
  shots.forEach((p, i) => { p.text = sent.slice(i * per, (i + 1) * per).join(' '); });
  return shots;
}

// « 00:03.500 » : le temps de coupe d'un plan, comme le guide l'écrit (server/tools/movie.py, cut_time)
export function cutTime(s) {
  const ms = Math.round(Math.max(0, s) * 1000);
  const p = (n, k) => String(n).padStart(k, '0');
  return `${p(Math.floor(ms / 60000), 2)}:${p(Math.floor((ms % 60000) / 1000), 2)}.${p(ms % 1000, 3)}`;
}

// le prompt : les plans dans l'ordre, chaque plan suivant avec son temps de coupe ; les personnages numérotés S1, S2…
// dans l'ordre où ils parlent
export function compose(shots, { lang = 'fr' } = {}) {
  const name = LANG[lang] || LANG.fr;
  const ids = new Map();
  const sid = (who) => {
    const k = (who || '').trim().toLowerCase();
    if (!ids.has(k)) ids.set(k, ids.size + 1);
    return ids.get(k);
  };
  let at = 0;
  return shots.map((p, i) => {
    const said = (p.lines || []).filter((l) => (l.text || '').trim()).map((l) => {
      const who = (l.who || '').trim();
      return `${who ? who + ' ' : ''}(S${sid(who)}) says: <d>[${name}] ${l.text.trim()}</d>`;
    });
    const head = `[Shot ${i + 1}]${i ? ` At ${cutTime(at)},` : ''}`;
    at += p.secs;
    return [head, (p.text || '').trim(), ...said].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }).join('\n');
}

// retour : un prompt déjà écrit en [Shot n] redevient des plans (texte et répliques ; les temps de coupe « At 00:03.500, »
// redonnent les durées) ; sans [Shot], un seul plan
const SHOT_RX = /\[Shot \d+\](?:\s*At (\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)\s*,?)?/g;
export function parse(desc, total) {
  const src = String(desc || '').trim();
  const has = /\[Shot \d+\]/.test(src);
  const cuts = [...src.matchAll(SHOT_RX)].map((m) => (m[1] != null ? Number(m[1]) * 60 + Number(m[2]) : null));
  const parts = has ? src.split(SHOT_RX).filter((_, k) => k % 3 === 0).map((s) => s.trim()) : [src];
  const lead = has ? parts.shift() : '';           // une ligne de look avant [Shot 1] : gardée dans le premier plan
  const bodies = parts.length ? parts : [''];
  const shots = bodies.map((b, i) => {
    let text = (i === 0 && lead ? lead + ' ' : '') + b;
    const lines = [];
    // « @element1 (S1) says: <d>[French] … </d> » (le nom n'est repris que s'il est un jeton @ ; sinon il reste dans le texte)
    text = text.replace(/\s*(?:(@[\p{L}_]+\d*)\s+)?\(S\d+\)\s*says:\s*<d>\[[^\]]*\]\s*([^<]*?)\s*<\/d>/gu, (_m, who, t) => {
      lines.push({ who: who || '', text: t.trim() });
      return '';
    }).replace(/\s+/g, ' ').trim();
    return plan(1, text, lines);
  });
  // des temps de coupe tous lus, croissants, dans la durée : les durées en découlent ; sinon, parts égales
  const t = [0, ...cuts.slice(1)];
  if (has && t.length === shots.length && t.every((x, k) => x != null && (k === 0 || (x > t[k - 1] && x < total)))) {
    shots.forEach((p, k) => { p.secs = r1((k < shots.length - 1 ? t[k + 1] : total) - t[k]); });
    return shots;
  }
  return fit(shots, total);
}

// ── la frise en images (la barre de la page Vidéo, 09/10) ────────────────────────────────────────────────────────
// Une vidéo H3 est UN rendu : les [Shot n] sont des coupes dans ce rendu. La grille 17k+5 (124 à 362 images à 24 i/s,
// server/tools/movie.py FRAMES, d'après le code du nœud) vaut pour la vidéo entière, pas pour un plan : un plan n'a
// pas de grille documentée, une coupe tombe sur une image (1/24 s) — la grammaire relevée dans le guide d'H3 la date
// à la milliseconde (« [Shot 2] At 00:08.000, », docs/etudes/veille_1009.md § 2.5). D'où, dans la frise :
//   - une coupe (la poignée entre deux plans) se règle à l'image près, le total ne bouge pas (le « roll » du Montage) ;
//   - la fin (la poignée du dernier plan) change la durée de la vidéo, aimantée aux durées permises par H3 ;
//   - un plan garde au moins MIN_FRAMES images (MIN_SECS à 24 i/s) ; il emporte sa durée quand on le déplace.
// `p.frames` (un entier) fait foi, `p.secs` le suit (compose et le texte en secondes).
export const FPS = 24;
export const MIN_FRAMES = Math.round(MIN_SECS * FPS);

const sync = (shots, fps) => { for (const p of shots) p.secs = p.frames / fps; return shots; };

// des images entières qui retombent sur le total, à partir des durées en secondes (ou des images déjà là)
export function fitFrames(shots, total, { fps = FPS, min = MIN_FRAMES } = {}) {
  if (!shots.length) return shots;
  const w = shots.map((p) => Math.max(1e-6, Number.isFinite(p.frames) ? p.frames : (p.secs || 1) * fps));
  const sum = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  shots.forEach((p, i) => {
    const left = shots.length - 1 - i;
    p.frames = i === shots.length - 1 ? total - acc : Math.max(min, Math.min(total - acc - left * min, Math.round((w[i] / sum) * total)));
    acc += p.frames;
  });
  return sync(shots, fps);
}

export const equalFrames = (n, total, o = {}) => fitFrames(Array.from({ length: n }, () => plan(1)), total, o);

// la coupe entre le plan i et le plan i+1, déplacée de d images ; le total ne bouge pas
export function cutFrames(shots, i, d, { fps = FPS, min = MIN_FRAMES } = {}) {
  const a = shots[i], b = shots[i + 1];
  if (!a || !b) return shots;
  const x = Math.max(min - a.frames, Math.min(b.frames - min, Math.round(d)));
  a.frames += x;
  b.frames -= x;
  return sync(shots, fps);
}

// la vidéo passe à `total` images : le dernier plan prend l'écart ; trop court, les plans d'avant cèdent, du dernier
// au premier, jusqu'à leur minimum (le total est déjà sur la grille d'H3 : snapTotal)
export function trimEnd(shots, total, { fps = FPS, min = MIN_FRAMES } = {}) {
  if (!shots.length) return shots;
  let rest = total - shots.reduce((s, p) => s + p.frames, 0);
  const last = shots[shots.length - 1];
  if (rest >= 0) { last.frames += rest; return sync(shots, fps); }
  for (let k = shots.length - 1; k >= 0 && rest < 0; k--) {
    const give = Math.min(shots[k].frames - min, -rest);
    shots[k].frames -= give;
    rest += give;
  }
  return sync(shots, fps);
}

// la durée permise la plus proche (la grille d'H3) ; `grid` : les nombres d'images permis, croissants
export function snapTotal(frames, grid) {
  if (!grid?.length) return Math.round(frames);
  return grid.reduce((best, f) => (Math.abs(f - frames) < Math.abs(best - frames) ? f : best), grid[0]);
}
// le plus de plans qu'une durée peut tenir
export const maxShots = (total, min = MIN_FRAMES) => Math.max(1, Math.floor(total / min));

// déplacer le plan `from` à la place `to` : il emporte sa durée, son texte, ses répliques
export function moveShot(shots, from, to) {
  if (from === to || from < 0 || to < 0 || from >= shots.length || to >= shots.length) return shots;
  const [p] = shots.splice(from, 1);
  shots.splice(to, 0, p);
  return shots;
}

// couper un plan en deux (à l'image près) ; trop court pour deux minimums, rien
export function splitFrames(shots, i, { fps = FPS, min = MIN_FRAMES } = {}) {
  const p = shots[i];
  if (!p || p.frames < 2 * min) return shots;
  const h = Math.max(min, Math.round(p.frames / 2));
  const q = plan(0);
  q.frames = p.frames - h;
  p.frames = h;
  shots.splice(i + 1, 0, q);
  return sync(shots, fps);
}

// retirer un plan : sa durée passe au voisin (le suivant, ou le précédent pour le dernier)
export function removeFrames(shots, i, { fps = FPS } = {}) {
  if (shots.length < 2 || !shots[i]) return shots;
  const [p] = shots.splice(i, 1);
  shots[Math.min(i, shots.length - 1)].frames += p.frames;
  return sync(shots, fps);
}

// où commence chaque plan, en images (la frise, les temps de coupe)
export const starts = (shots) => { let at = 0; return shots.map((p) => { const s = at; at += p.frames; return s; }); };
