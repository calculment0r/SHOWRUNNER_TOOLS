// SHOWRUNNER TOOLS — l'éditeur de thème (décision de Cal du 29/09 : « on
// a l'éditeur de thème par exemple car on devra avoir un thème clair aussi »).
//
// Chaque jeton de commun/tokens.css, lu dans le fichier lui-même (ses noms,
// ses valeurs sombres et claires, ses commentaires) : une seule vérité. On
// part du sombre ou du clair, on change des couleurs ; l'aperçu, à droite,
// est fait des vrais composants du portail (base.css, shell.css) et de vraies
// vignettes de la bibliothèque ; les contrastes WCAG se mesurent à mesure.
// Le thème ainsi fait est « le mien » (préférence Général → Thème) : rangé
// pour la personne sur le portail (commun/prefs.js), exportable en JSON,
// importable, et chaque changement s'annule (commun/undo.js).
//
// Seules les couleurs se changent : la typographie et les mesures sont les
// mêmes dans tous les thèmes (règles 5 et 6). Une valeur n'est jamais qu'une
// couleur (colorOk, le même motif que le serveur) : rien ne se charge par
// un jeton.

import { mountHeader, api, el, $, $$, toast, href } from './shell.js';
import { prefs } from './prefs.js';
import { colorOk } from './theme.js';
import { createUndo } from './undo.js';

mountHeader(null);
const app = $('#te');

// ── les jetons, lus dans tokens.css ─────────────────────────
async function readTokens() {
  const src = await (await fetch(new URL('./tokens.css', import.meta.url))).text();
  const blk = (rx) => (src.match(rx) || [, ''])[1];
  const rootB = blk(/^:root\s*\{([\s\S]*?)\n\}/m);
  const lightB = blk(/^\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/m);
  const light = Object.fromEntries([...lightB.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const groups = [];
  let g = null;
  let inComment = false;
  for (const line of rootB.split('\n')) {
    const tok = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);\s*(?:\/\*\s*(.*?)\s*\*\/)?/);
    if (tok) {
      if (!g) { g = { title: 'jetons', items: [] }; groups.push(g); }
      const [, name, dark, desc] = tok;
      g.items.push({ name, dark: dark.trim(), light: light[name] ?? dark.trim(), desc: desc || '', color: colorOk(dark.trim()) });
      continue;
    }
    if (inComment) { if (line.includes('*/')) inComment = false; continue; }
    const c = line.match(/^\s*\/\*\s*(.*?)\s*(\*\/)?\s*$/);
    if (c) {
      g = { title: c[1].replace(/\s*[—:].*$/, '').replace(/,.*$/, '') || 'jetons', note: c[1], items: [] };
      groups.push(g);
      if (!c[2]) inComment = true;
    }
  }
  return groups.filter((x) => x.items.length);
}

// ── l'état ──────────────────────────────────────────────────
let groups = [];
let E = { base: 'dark', name: '', tokens: {} };
const liveSet = new Set();
const all = () => groups.flatMap((x) => x.items);
const tokenOf = (n) => all().find((t) => t.name === n);
const baseValue = (n) => { const t = tokenOf(n); return t ? (E.base === 'light' ? t.light : t.dark) : ''; };

// l'éditeur montre toujours le thème qu'on édite, quel que soit celui qu'on porte
function live() {
  const root = document.documentElement;
  root.dataset.theme = E.base;
  for (const n of liveSet) root.style.removeProperty(n);
  liveSet.clear();
  for (const [n, v] of Object.entries(E.tokens)) { root.style.setProperty(n, v); liveSet.add(n); }
}
document.addEventListener('sr:theme', () => { if (groups.length) live(); });

// ── l'annulation : l'état entier du thème, par instantanés ──
const U = createUndo({ name: 'theme' });
let typing = 0;
let T = null;
function describe(b, a) {
  if (b.base !== a.base) return { label: a.base === 'light' ? 'partir du clair' : 'partir du sombre' };
  if (b.name !== a.name) return { label: 'renommer le thème', merge: `name#${typing}`, mergeMs: Infinity };
  const names = [...new Set([...Object.keys(b.tokens), ...Object.keys(a.tokens)])].filter((n) => b.tokens[n] !== a.tokens[n]);
  if (names.length === 1) return { label: a.tokens[names[0]] ? `changer ${names[0]}` : `rendre ${names[0]} au défaut`, merge: `tok:${names[0]}#${typing}` };
  return { label: `changer ${names.length} jetons` };
}
// ce que la page écrit elle-même ne doit pas revenir comme un changement fait ailleurs
let selfWrite = false;
function save(patch) { selfWrite = true; try { prefs.setTheme(patch); } finally { selfWrite = false; } }
function restore(s) {
  E = { base: s.base, name: s.name, tokens: { ...s.tokens } };
  save({ base: E.base, name: E.name, tokens: null });
  if (Object.keys(E.tokens).length) save({ tokens: E.tokens });
  live(); paint();
}
const commit = () => T?.commit();

// la base part avec chaque jeton : « le mien » sait toujours de quel thème il part
function setToken(n, v) {
  const def = baseValue(n);
  if (v === null || v === undefined || v.trim() === def) { delete E.tokens[n]; save({ base: E.base, tokens: { [n]: null } }); }
  else { E.tokens[n] = v.trim(); save({ base: E.base, tokens: { [n]: v.trim() } }); }
  live(); commit(); paintRow(n); paintContrast(); paintHead();
}

// ── les couleurs : lire, écrire ─────────────────────────────
const probe = el('i', { style: { position: 'absolute', width: '0', height: '0', overflow: 'hidden' }, 'aria-hidden': 'true' });
document.body.append(probe);
function rgba(css) {
  probe.style.color = '';
  probe.style.color = css;
  const m = getComputedStyle(probe).color.match(/rgba?\(([^)]+)\)/);
  if (!m) return [0, 0, 0, 1];
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}
const hex2 = (x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0');
const toHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const withAlpha = (hex, a) => {
  if (a >= 1) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(a * 100) / 100})`;
};
const cur = (n) => E.tokens[n] ?? baseValue(n);

// WCAG 2.2, 1.4.3 : luminance relative et rapport (w3.org/WAI/WCAG22/Understanding/contrast-minimum)
function lum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
function solid(n, under = '--bg') {
  const c = rgba(`var(${n})`);
  if (c[3] >= 1 || n === under) return c;
  return over(c, solid(under));
}
function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

// ── la page ─────────────────────────────────────────────────
const parts = {};
function build() {
  parts.name = el('input', { class: 'fld te-name', maxlength: 60, placeholder: 'le nom de ton thème', 'aria-label': 'le nom du thème', value: E.name || '',
    oninput: (e) => { E.name = e.target.value; save({ base: E.base, name: E.name }); commit(); } });
  parts.base = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'partir de' });
  parts.wear = el('div', { class: 'te-wear' });
  parts.list = el('div', { class: 'te-list' });
  parts.q = el('input', { class: 'fld', type: 'search', placeholder: 'chercher un jeton : or, panel, ink…', 'aria-label': 'chercher un jeton',
    oninput: () => paintList() });
  const fileIn = el('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => { importTheme(fileIn.files[0]); fileIn.value = ''; } });
  const head = el('section', { class: 'te-head' },
    el('div', { class: 'who' }, el('span', { class: 'kicker lbl' }, 'commun/tokens.css · le thème'), el('h1', { class: 'te-h' }, 'Éditeur de thème'),
      el('p', { class: 'te-p' }, 'Chaque jeton de couleur du portail, lu dans tokens.css. Pars du sombre ou du clair, change ce que tu veux : l’aperçu à droite est fait des vrais composants, les contrastes se mesurent à mesure. Ton thème se range pour toi, sur le portail ; Ctrl+Z défait chaque changement.')),
    el('div', { class: 'te-acts' },
      el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'partir de'), parts.base, parts.name),
      el('div', { class: 'row' },
        el('button', { class: 'tb ghost sm', type: 'button', onclick: exportTheme, title: 'un fichier JSON : son nom, sa base, ses jetons' }, 'Exporter'),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => fileIn.click(), title: 'un fichier exporté d’ici' }, 'Importer'), fileIn,
        el('button', { class: 'tb ghost sm', type: 'button', onclick: resetAll, title: 'tous les jetons reviennent à leur valeur de base — Ctrl+Z les rend' }, 'Revenir au défaut'),
        el('span', { class: 'sp' }), el('span', { class: 'sr-undo', role: 'group', 'aria-label': 'annuler, rétablir' }, ...U.buttons())),
      parts.wear));
  const left = el('aside', { class: 'te-left', 'aria-label': 'les jetons' }, el('div', { class: 'te-search' }, parts.q), parts.list);
  parts.preview = el('section', { class: 'te-preview', 'aria-label': 'l’aperçu' });
  parts.contrast = el('section', { class: 'te-contrast pan', 'aria-label': 'les contrastes' });
  app.replaceChildren(head, el('div', { class: 'te-grid' }, left, el('div', { class: 'te-right' }, parts.preview, parts.contrast)));
  app.addEventListener('focusin', (e) => { if (e.target.matches?.('input')) typing++; });
}

function paintHead() {
  parts.base.replaceChildren(...[['dark', 'Sombre'], ['light', 'Clair']].map(([k, lab]) => el('button', { class: 'tb' + (E.base === k ? ' on' : ''), type: 'button',
    role: 'radio', 'aria-checked': String(E.base === k),
    onclick: () => { if (E.base === k) return; E.base = k; for (const n of Object.keys(E.tokens)) if (E.tokens[n] === baseValue(n)) delete E.tokens[n];
      save({ base: k }); live(); commit(); paint(); } }, lab)));
  if (document.activeElement !== parts.name) parts.name.value = E.name || '';
  const worn = prefs.get('general.theme', 'dark');
  const n = Object.keys(E.tokens).length;
  parts.wear.replaceChildren(worn === 'custom'
    ? el('div', { class: 'row' }, el('span', { class: 'pill on' }, el('i'), el('span', {}, 'porté : c’est ton thème du portail')),
      el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: () => prefs.set('general.theme', 'dark') }, 'Porter le sombre'),
      el('button', { class: 'tb ghost sm', type: 'button', onclick: () => prefs.set('general.theme', 'light') }, 'Porter le clair'))
    : el('div', { class: 'row' }, el('span', { class: 'why' }, `tu portes le thème ${worn === 'light' ? 'clair' : 'sombre'} : ce que tu fais ici ne se voit que dans cet éditeur`),
      el('span', { class: 'sp' }),
      el('button', { class: 'tb go', type: 'button', onclick: () => { save({ base: E.base }); prefs.set('general.theme', 'custom'); toast('ton thème est porté sur tout le portail'); } },
        `Porter ce thème${n ? ` · ${n} jeton${n > 1 ? 's' : ''} changé${n > 1 ? 's' : ''}` : ''}`)));
}

function row(t) {
  const n = t.name;
  if (!t.color) {
    return el('div', { class: 'te-row ro', 'data-n': n }, el('span', { class: 'te-sw ro' }, 'Aa'),
      el('div', { class: 'te-tx' }, el('code', {}, n), t.desc ? el('span', { class: 'hint' }, t.desc) : null),
      el('code', { class: 'te-val' }, t.dark));
  }
  const v = cur(n);
  const c = rgba(v);
  const hasA = rgba(baseValue(n))[3] < 1 || c[3] < 1;
  const changed = n in E.tokens;
  const pick = el('input', { type: 'color', value: toHex(c), 'aria-label': `la couleur de ${n}`,
    oninput: (e) => setToken(n, withAlpha(e.target.value, hasA ? Number(alpha?.value ?? c[3]) : 1)) });
  const alpha = hasA ? el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: c[3], class: 'te-a', 'aria-label': `l’opacité de ${n}`, title: 'opacité',
    oninput: (e) => setToken(n, withAlpha(pick.value, Number(e.target.value))) }) : null;
  const txt = el('input', { class: 'fld te-txt', value: v, spellcheck: 'false', 'aria-label': `la valeur de ${n}`,
    onchange: (e) => { const x = e.target.value.trim(); if (!colorOk(x)) { toast(`${n} : une couleur (#rrggbb, rgb(), rgba(), hsl()), rien d’autre`); e.target.value = cur(n); return; } setToken(n, x); } });
  return el('div', { class: 'te-row' + (changed ? ' changed' : ''), 'data-n': n },
    el('span', { class: 'te-sw', style: { background: `var(${n})` }, title: v }),
    el('div', { class: 'te-tx' }, el('code', {}, n), t.desc ? el('span', { class: 'hint' }, t.desc) : null,
      el('span', { class: 'lbl te-def' }, changed ? `défaut ${baseValue(n)}` : E.base === 'light' ? 'valeur du clair' : 'valeur du sombre')),
    el('div', { class: 'te-ctl' }, pick, alpha, txt,
      el('button', { class: 'tb ghost sm', type: 'button', 'aria-disabled': changed ? null : 'true', title: changed ? `revenir à ${baseValue(n)}` : 'déjà la valeur de base',
        onclick: () => (changed ? setToken(n, null) : toast('déjà la valeur de base')) }, 'défaut')));
}
function paintRow(n) {
  const old = $(`.te-row[data-n="${n}"]`, parts.list);
  const t = tokenOf(n);
  if (old && t) {
    const focusIn = old.contains(document.activeElement) && document.activeElement.type !== 'color' && document.activeElement.type !== 'range';
    if (focusIn) return;   // on ne repeint pas sous les doigts
    // le curseur de couleur ouvert garde la main : seules la pastille et le texte suivent
    if (old.contains(document.activeElement)) {
      $('.te-txt', old).value = cur(n);
      old.classList.toggle('changed', n in E.tokens);
      return;
    }
    old.replaceWith(row(t));
  }
}
function paintList() {
  const q = parts.q.value.trim().toLowerCase();
  parts.list.replaceChildren(...groups.map((g) => {
    const items = g.items.filter((t) => !q || t.name.includes(q) || (t.desc || '').toLowerCase().includes(q) || g.title.toLowerCase().includes(q));
    if (!items.length) return null;
    const colors = items.filter((t) => t.color), fixed = items.filter((t) => !t.color);
    return el('section', { class: 'te-group' },
      el('div', { class: 'te-gh' }, el('span', { class: 'lbl' }, g.title), el('span', { class: 'cnt lbl' }, String(items.length))),
      g.note && g.note !== g.title ? el('p', { class: 'hint te-note' }, g.note) : null,
      ...colors.map(row),
      fixed.length ? el('details', { class: 'te-fixed' }, el('summary', { class: 'lbl' }, `${fixed.length} jeton${fixed.length > 1 ? 's' : ''} hors couleur · les mêmes dans tous les thèmes`), ...fixed.map(row)) : null);
  }).filter(Boolean));
}

// ── l'aperçu : les vrais composants ─────────────────────────
async function paintPreview() {
  let items = [];
  try { items = (await api('library?kind=image&limit=4')).items || []; } catch { items = []; }
  const tile = (cls, k, nm, sub) => el('span', { class: 'tile', 'data-c': cls }, el('span', { class: 'k' }, k), el('span', { class: 'st' }), el('span', { class: 'nm' }, nm), el('span', { class: 'sub' }, sub));
  parts.preview.replaceChildren(
    el('div', { class: 'te-ph' }, el('span', { class: 'lbl' }, 'l’aperçu · les composants du portail'), el('span', { class: 'sp' }), el('span', { class: 'lbl' }, 'base.css · shell.css')),
    el('div', { class: 'te-cols' },
      el('div', { class: 'col' },
        el('div', { class: 'pan' }, el('span', { class: 'dots' }),
          el('div', { class: 'c-head' }, el('h2', {}, 'Réglages'), el('span', { class: 'sec' }, 'SR—01'), el('span', { class: 'cnt' }, '3 champs')),
          el('div', { class: 'te-stack' },
            el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'un champ'), el('input', { class: 'fld', value: 'a lighthouse at dawn', 'aria-label': 'exemple' })),
            el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'vide'), el('input', { class: 'fld', placeholder: 'le texte d’attente', 'aria-label': 'exemple vide' })),
            el('div', { class: 'opts' }, el('button', { class: 'opt on', type: 'button' }, 'Krea 2', el('small', {}, 'retenue')),
              el('button', { class: 'opt', type: 'button' }, 'Qwen 2.1', el('small', {}, 'pastille')), el('button', { class: 'opt', type: 'button' }, 'Z-Image')),
            el('div', { class: 'seg' }, el('button', { class: 'tb on', type: 'button' }, 'Grille'), el('button', { class: 'tb', type: 'button' }, 'Liste')),
            el('div', { class: 'row' },
              el('span', { class: 'tb go', 'aria-hidden': 'true', title: 'l’orange : l’action, une seule par écran' }, 'Générer'),
              el('button', { class: 'tb', type: 'button' }, 'Bouton'), el('button', { class: 'tb ghost', type: 'button' }, 'Filet'),
              el('button', { class: 'tb ghost', type: 'button', disabled: true }, 'Éteint')),
            el('p', { class: 'why' }, 'ce qui manque pour agir · en ambre, jamais une action'),
            el('div', { class: 'warn' }, 'un avertissement · l’orange qui alerte'),
            el('div', { class: 'meter' }, el('div', { class: 'row' }, el('span', {}, 'progression'), el('span', { class: 'sp' }), el('span', {}, '62 %')),
              el('div', { class: 'bar' }, el('i', { style: { width: '62%' } }))))),
        el('ul', { class: 'rack' },
          el('li', {}, el('button', { class: 'item sel', type: 'button' }, el('span', { class: 'st run' }),
            el('span', { class: 'txt' }, el('span', { class: 'ref' }, 'A · choisie'), el('span', { class: 'nm' }, 'Rangée choisie'), el('span', { class: 'sub' }, '--sel-bg · --line-cy')), el('span', { class: 'dots' }))),
          el('li', {}, el('button', { class: 'item done', type: 'button' }, el('span', { class: 'st ok' }),
            el('span', { class: 'txt' }, el('span', { class: 'ref' }, 'B · faite'), el('span', { class: 'nm' }, 'Étage validé'), el('span', { class: 'sub' }, '--grn2 · --line-gr')), el('span', { class: 'dots' }))),
          el('li', {}, el('button', { class: 'item', type: 'button' }, el('span', { class: 'st err' }),
            el('span', { class: 'txt' }, el('span', { class: 'ref' }, 'C · en échec'), el('span', { class: 'nm' }, 'Un rendu raté'), el('span', { class: 'sub' }, '--or')), el('span', { class: 'dots' }))))),
      el('div', { class: 'col' },
        el('div', { class: 'meta a' }, el('span', { class: 'dots' }),
          el('dl', { class: 'kv' }, el('dt', {}, 'lu'), el('dd', { class: 'big' }, '1344 × 768'), el('dt', {}, 'modèle'), el('dd', {}, 'MiniMax H3'),
            el('dt', {}, 'durée'), el('dd', {}, '5,16 s · 124 images'))),
        el('div', { class: 'row' }, el('span', { class: 'pill on' }, el('i'), el('span', {}, 'DGX2 + DGX1')), el('span', { class: 'pill work' }, el('i'), el('span', {}, 'en cours')),
          el('span', { class: 'pill err' }, el('i'), el('span', {}, 'injoignable'))),
        el('div', { class: 'grid sm te-thumbs' }, ...(items.length ? items.map((it) => el('div', { class: 'thumb' },
          el('div', { class: 'im' }, it.thumb_url ? el('img', { src: href(it.thumb_url), alt: '' }) : null, el('span', { class: 'kind image' }, 'image')),
          el('div', { class: 'cap' }, el('div', { class: 't' }, it.title || it.id), el('div', { class: 's' }, `${it.width || '?'}×${it.height || '?'}`))))
          : [el('div', { class: 'thumb' }, el('div', { class: 'im' }, el('span', { class: 'kind element' }, 'élément')), el('div', { class: 'cap' }, el('div', { class: 't' }, 'sans image'), el('div', { class: 's' }, 'la bibliothèque est vide')))])),
        el('div', { class: 'monitor te-mon' }, el('div', { class: 'empty' }, el('b', {}, 'Moniteur'), el('span', {}, '--black · le fond d’une vidéo'))),
        el('div', { class: 'modal te-modal' }, el('div', { class: 'modal-head' }, el('span', { class: 't' }, 'une fenêtre'), el('span', { class: 'sp' }),
          el('button', { class: 'tb ghost sm', type: 'button' }, 'Fermer')),
          el('div', { class: 'modal-body' }, el('p', {}, 'La prose reste en bas de casse, en Chakra Petch ; ', el('code', {}, 'le code en acier'), '.')),
          el('div', { class: 'modal-foot' }, el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button' }, 'Annuler'), el('button', { class: 'tb', type: 'button' }, 'Valider'))))),
    el('div', { class: 'stack' },
      el('span', { class: 'slab t3' }, el('span', { class: 'body' }, el('span', { class: 'line' }, el('span', { class: 'ref' }, 'SR—01'), el('span', { class: 'nm' }, 'Image')), el('span', { class: 'sub' }, '--coral-3 · --on-light')), el('span', { class: 'dots' }), el('span', { class: 'go' }, 'Ouvrir')),
      el('span', { class: 'slab t2' }, el('span', { class: 'body' }, el('span', { class: 'line' }, el('span', { class: 'ref' }, 'SR—02'), el('span', { class: 'nm' }, 'Vidéo')), el('span', { class: 'sub' }, '--coral-2 · --on-light')), el('span', { class: 'dots' }), el('span', { class: 'go' }, 'Ouvrir')),
      el('span', { class: 'slab t1' }, el('span', { class: 'body' }, el('span', { class: 'line' }, el('span', { class: 'ref' }, 'SR—03'), el('span', { class: 'nm' }, 'Character Factory')), el('span', { class: 'sub' }, '--coral-1 · --on-coral1')), el('span', { class: 'dots' }), el('span', { class: 'go' }, 'Ouvrir'))),
    el('div', { class: 'tiles' }, tile('3', 'SR—05', 'Montage', '--verd-3 · --on-grn'), tile('4', 'SR—06', 'ODIO', '--verd-4'), tile('5', 'SR—08', 'Idéation', '--verd-5')),
    el('div', { class: 'te-cols' },
      el('span', { class: 'statcard' }, el('span', { class: 'ref' }, 'Asset · la bibliothèque'), el('span', { class: 'n' }, '0042'), el('span', { class: 'foot' }, '--or · --on-or'), el('span', { class: 'dots' })),
      el('div', { class: 'hero' }, el('span', { class: 'ref' }, '00_PORTAIL'), el('h1', {}, 'Tous nos outils'),
        el('p', {}, 'Norelli ne tient que le logotype et ce titre ; Venus Rising porte l’affichage ; Azeret Mono les étiquettes de la machine.'))));
}

// ── les contrastes, mesurés sur ce qu'affiche la page ───────
const INKS = ['--ink', '--ink2', '--ink3', '--cy', '--or', '--grn2', '--amb'];
const BGS = ['--bg', '--panel', '--panel2', '--panel3', '--sel-bg', '--hdr-bg'];
const FILLS = [['--or', '--on-or', '« Générer »'], ['--or', '--on-or', 'carte de compte'], ['--grn', '--on-grn', 'bouton engagé'], ['--cy', '--on-cy', 'aplat acier'],
  ['--coral-3', '--on-light', 'corail 3'], ['--coral-2', '--on-light', 'corail 2'], ['--coral-1', '--on-coral1', 'corail 1'], ['--verd-3', '--on-grn', 'carte verte'],
  ['--black', '--ink3', 'moniteur vide']];
function paintContrast() {
  if (!parts.contrast) return;
  const cell = (r) => el('td', { class: r >= 4.5 ? 'ok' : r >= 3 ? 'mid' : 'bad', title: r >= 4.5 ? 'AA' : r >= 3 ? 'AA pour le grand texte seulement (3:1)' : 'sous 3:1' }, r.toFixed(2));
  let fails = 0;
  const rows = INKS.map((ink) => el('tr', {}, el('th', {}, el('code', {}, ink)), ...BGS.map((bg) => {
    const r = ratio(solid(ink, bg), solid(bg));
    if (r < 4.5) fails++;
    return cell(r);
  })));
  const frows = FILLS.map(([bg, ink, what]) => {
    const r = ratio(solid(ink, bg), solid(bg));
    return el('tr', {}, el('th', {}, el('code', {}, ink), ' sur ', el('code', {}, bg)), el('td', { class: 'lbl' }, what), cell(r));
  });
  parts.contrast.replaceChildren(
    el('div', { class: 'te-ph' }, el('span', { class: 'lbl' }, 'les contrastes · WCAG 2.2, 1.4.3'), el('span', { class: 'sp' }),
      el('span', { class: 'lbl ' + (fails ? 'te-bad' : 'te-ok') }, fails ? `${fails} sous 4,5:1` : 'tout en AA')),
    el('p', { class: 'hint' }, 'Chaque encre sur chaque fond, mesurée sur ce que la page affiche (un jeton translucide posé sur le fond qu’il recouvre). AA : 4,5:1 pour le texte courant, 3:1 pour le grand texte.'),
    el('div', { class: 'te-tw' }, el('table', { class: 'te-t' }, el('thead', {}, el('tr', {}, el('th', {}, 'encre \\ fond'), ...BGS.map((b) => el('th', {}, el('code', {}, b))))), el('tbody', {}, ...rows))),
    el('div', { class: 'te-tw' }, el('table', { class: 'te-t' }, el('thead', {}, el('tr', {}, el('th', {}, 'aplats et leur encre'), el('th', {}, 'où'), el('th', {}, 'rapport'))), el('tbody', {}, ...frows))));
}

// ── exporter, importer, revenir au défaut ───────────────────
function exportTheme() {
  const doc = { 'showrunner-theme': 1, name: E.name || '', base: E.base, tokens: E.tokens };
  const blob = new Blob([JSON.stringify(doc, null, 2) + '\n'], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `theme-${(E.name || E.base).normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'showrunner'}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('le thème est exporté : un fichier JSON');
}
async function importTheme(f) {
  if (!f) return;
  let d;
  try { d = JSON.parse(await f.text()); } catch { toast('ce fichier n’est pas du JSON'); return; }
  if (!d || typeof d !== 'object' || d['showrunner-theme'] !== 1) { toast('ce fichier n’est pas un thème exporté d’ici (« showrunner-theme »)'); return; }
  const known = new Set(all().filter((t) => t.color).map((t) => t.name));
  const tokens = {}, bad = [];
  for (const [n, v] of Object.entries(d.tokens || {})) { if (known.has(n) && colorOk(v)) tokens[n] = v.trim(); else bad.push(n); }
  E = { base: d.base === 'light' ? 'light' : 'dark', name: String(d.name || '').slice(0, 60), tokens };
  save({ base: E.base, name: E.name, tokens: null });
  if (Object.keys(tokens).length) save({ tokens });
  T.label(`importer le thème « ${E.name || f.name} »`);
  live(); commit(); paint();
  toast(`thème importé · ${Object.keys(tokens).length} jetons${bad.length ? ` · laissés : ${bad.slice(0, 4).join(', ')}${bad.length > 4 ? '…' : ''}` : ''}`, 6000);
}
function resetAll() {
  if (!Object.keys(E.tokens).length) { toast('aucun jeton changé : c’est déjà le thème de base'); return; }
  E.tokens = {};
  save({ tokens: null });
  T.label(`revenir au ${E.base === 'light' ? 'clair' : 'sombre'} de base`);
  live(); commit(); paint();
}

function paint() { paintHead(); paintList(); paintContrast(); }

// ── démarrage ───────────────────────────────────────────────
(async function start() {
  app.replaceChildren(el('p', { class: 'lbl' }, 'lecture de tokens.css'));
  try { groups = await readTokens(); } catch (e) { app.replaceChildren(el('p', { class: 'warn' }, `tokens.css illisible : ${e.message}`)); return; }
  await prefs.ready;
  const t = prefs.theme();
  const worn = prefs.get('general.theme', 'dark');
  // un thème à soi part de sa base ; sans jeton changé, on part de celui qu'on porte
  const own = worn === 'custom' || Object.keys(t.tokens || {}).length;
  E = { base: own ? (t.base || 'dark') : (worn === 'light' ? 'light' : 'dark'), name: t.name || '', tokens: { ...(t.tokens || {}) } };
  build();
  live();
  paint();
  paintPreview();
  T = U.snapshots({ get: () => ({ base: E.base, name: E.name, tokens: E.tokens }), set: restore, describe });
  T.reset();
  prefs.on('general.theme', () => { paintHead(); live(); });
  // changé ailleurs (un autre navigateur, une autre page) : relu
  prefs.on('theme', () => {
    if (selfWrite) return;
    const x = prefs.theme();
    if (JSON.stringify({ b: x.base, t: x.tokens || {} }) === JSON.stringify({ b: E.base, t: E.tokens })) return;
    E = { base: x.base || 'dark', name: x.name || '', tokens: { ...(x.tokens || {}) } };
    T.reset(); live(); paint();
  });
})();
