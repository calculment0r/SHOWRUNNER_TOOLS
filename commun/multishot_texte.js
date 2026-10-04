// SHOWRUNNER TOOLS — le Multishot, côté texte : de la frise de plans au prompt H3, et retour. Pur, sans DOM.
//
// Cal, 04/10 : « on reste en langage naturel et c'est l'interface qui code les balises ». Ce que l'on écrit dans le panneau :
// des plans (une durée, ce qu'on y voit), et dans chaque plan des répliques rattachées à un personnage ; ce que H3 reçoit :
//
//   [Shot 1] <ce qu'on voit>  <personnage> (S1) says: <d>[French] la réplique</d>
//   [Shot 2] …
//
// Les sources de la forme : les plans « [Shot n] » (server/tools/movie.py, _shot) ; la réplique « (S1) says: <d>[Langue] … </d> »
// (l'aide « Réplique » de la page Vidéo, les guides MiniMax). Ce qui n'est PAS établi, et donc facultatif : la durée de chaque
// plan écrite dans le texte (« about 3.2 seconds ») — H3 ne documente, d'après ce que le portail sait, que l'ordre des plans ;
// la case est éteinte par défaut, à essayer en A/B avant d'y croire. La durée totale, elle, est celle du curseur de la page.
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

// le prompt : les plans dans l'ordre ; les personnages numérotés S1, S2… dans l'ordre où ils parlent
export function compose(shots, { lang = 'fr', durations = false } = {}) {
  const name = LANG[lang] || LANG.fr;
  const ids = new Map();
  const sid = (who) => {
    const k = (who || '').trim().toLowerCase();
    if (!ids.has(k)) ids.set(k, ids.size + 1);
    return ids.get(k);
  };
  return shots.map((p, i) => {
    const said = (p.lines || []).filter((l) => (l.text || '').trim()).map((l) => {
      const who = (l.who || '').trim();
      return `${who ? who + ' ' : ''}(S${sid(who)}) says: <d>[${name}] ${l.text.trim()}</d>`;
    });
    const head = `[Shot ${i + 1}]${durations ? ` (about ${String(r1(p.secs))} seconds)` : ''}`;
    return [head, (p.text || '').trim(), ...said].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }).join('\n');
}

// retour : un prompt déjà écrit en [Shot n] redevient des plans (texte et répliques) ; sans [Shot], un seul plan
export function parse(desc, total) {
  const src = String(desc || '').trim();
  const has = /\[Shot \d+\]/.test(src);
  const parts = has ? src.split(/\[Shot \d+\]/).map((s) => s.trim()) : [src];
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
  return fit(shots, total);
}
