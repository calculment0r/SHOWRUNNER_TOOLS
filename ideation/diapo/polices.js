// IDÉATION · DIAPOSITIVES — la bibliothèque de polices de présentation et les
// styles de texte nommés (docs/etudes/presentations.md § 2.5, étape 3).
//
// La vérité est au serveur (server/tools/ideation.py : FONTS, TEXT_STYLES, lus
// ici dans /api/ideation/meta → `deck`) : chaque police y déclare sa licence et
// ce qu'elle permet (`web`, `pdf` : la publication et le PDF, à venir, s'en
// serviront pour refuser en disant pourquoi). Dans l'éditeur et la présentation,
// qui restent dans le portail, les polices du portail servent telles qu'elles
// sont servies aujourd'hui (commun/base.css, Google Fonts de index.html) ; une
// police proposée (`src: google`) ne se charge que si un style la prend, depuis
// Google Fonts (css2), l'hôte que la page appelle déjà.

const loaded = new Set();

export const deckMeta = (app) => app.S.meta?.deck || null;
export const fontOf = (app, id) => deckMeta(app)?.fonts.find((f) => f.id === id) || null;
export const cssFamily = (f) => (f ? `"${f.family}", ${f.gen || 'sans-serif'}` : 'sans-serif');

// un style tel que la planche le montre : le défaut, puis ce que `pres` en change ; + sa police CSS
export function styleOf(app, sid) {
  const M = deckMeta(app);
  const base = M?.styles?.[sid];
  if (!base) return null;
  const st = { ...base, ...(app.S.board?.pres?.styles?.[sid] || {}) };
  const f = fontOf(app, st.font) || fontOf(app, base.font);
  return { ...st, id: sid, css: cssFamily(f), fontObj: f };
}

// charger une police proposée (une fois) ; `done` : quand elle est prête (la planche remesure ses textes)
export function ensureFont(app, id, done) {
  const f = fontOf(app, id);
  if (!f || f.src !== 'google' || loaded.has(id)) return;
  loaded.add(id);
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = `https://fonts.googleapis.com/css2?family=${f.css}&display=swap`;
  l.dataset.police = id;
  l.addEventListener('load', () => {
    Promise.all((f.weights || [400]).map((w) => document.fonts?.load(`${w} 32px "${f.family}"`).catch(() => null))).finally(() => done?.());
  });
  document.head.append(l);
}

// la feuille des styles : un texte à style (data-st, posé par diapo/index.js) prend sa police,
// sa taille de scène, son interlignage, son approche, ses capitales ; il perd la boîte d'une note
export function stylesCss(app) {
  const M = deckMeta(app);
  if (!M) return '';
  let css = '';
  for (const sid of Object.keys(M.styles)) {
    const st = styleOf(app, sid);
    if (!st) continue;
    if (st.fontObj?.src === 'google') ensureFont(app, st.fontObj.id, () => app.render());
    css += `.cv .nd[data-st="${sid}"] > .txt { font-family: ${st.css}; font-size: ${st.size}px; font-weight: ${st.weight};`
      + ` line-height: ${st.lh}; letter-spacing: ${st.track}em; text-transform: ${st.upper ? 'uppercase' : 'none'}; }\n`;
  }
  return css;
}

// la licence dite en une ligne : ce qu'elle permet ici et à la publication
export function licenceLine(f) {
  if (!f.use) return `${f.licence} — hors des styles`;
  if (f.web && f.pdf) return `${f.licence} — présentation, publication, PDF`;
  return `${f.licence} — présentation ici ; publication et PDF : licence à acheter`;
}
