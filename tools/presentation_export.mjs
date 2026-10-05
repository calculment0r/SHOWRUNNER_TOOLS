// Une présentation d'Idéation en PDF (et en images) par Chromium sans affichage : le travail
// `presentation.pdf` (server/tools/presentation_pdf.py) le lance sur la machine du portail (DGX2).
//
//   node tools/presentation_export.mjs <spec.json>                 le rendu (spec : écrit par le travail)
//   node tools/presentation_export.mjs --probe '{"bases": […], "chromium": "", "launch": false}'
//                                                                  Playwright et Chromium sont-ils là ?
//
// La page est celle de la lecture (ideation/presentation/lecture.html?print) : le même rendu que le
// mode Présentation et le lecteur (scene.js), chaque diapositive à son état final, une page nommée
// par taille de scène. Les fichiers statiques (HTML, modules, feuilles, polices du portail) viennent
// du portail lui-même, sur la boucle locale : ils se servent sans session. Les DONNÉES ne passent
// pas par l'API : le travail a lu la planche, les réglages et les fiches de ses objets au nom de la
// personne (spec.api) ; la page les reçoit par page.route, comme si l'API répondait, et seuls les
// fichiers de ces objets se servent (spec.files, spec.web, spec.waves). Aucune session, aucun jeton ;
// toute autre requête de l'API répond 404 (et se dit dans `warnings`), toute écriture est refusée,
// et rien ne sort de la machine que Google Fonts (les polices que la page appelle déjà).
//
// Sortie : une ligne JSON par événement sur stdout — {t: 'progress', p, m}, puis {t: 'done', …} ou
// {t: 'error', message}. Les fichiers : <out>/presentation.pdf, <out>/diapo-NN.png, <out>/cover.png.
//
// Playwright : résolu depuis chaque dossier de `bases` (createRequire, comme tools/shot.mjs depuis
// ~/Character_Sheet), ou un dossier qui EST le paquet playwright ; Chromium : le sien, ou `chromium`
// (un exécutable de la machine). Les arguments de lancement sont ceux de tools/shot.mjs (DGX2).

import { createRequire } from 'module';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';

const LAUNCH_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const ITEM = /^[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}$/;
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-monospace', 'ui-sans-serif', 'ui-serif', 'emoji', 'math']);

const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');

// ── Playwright : le premier dossier d'où il se résout ──────
// (un dossier absent est sauté : node chercherait plus haut, puis dans NODE_PATH, et l'ordre ne dirait plus rien)
function loadPlaywright(bases) {
  const tried = [];
  for (const b of bases || []) {
    if (!b) continue;
    const base = resolve(b);
    if (!existsSync(base)) { tried.push(`${base} (absent)`); continue; }
    try {
      const pkg = join(base, 'package.json');
      const own = existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).name === 'playwright';
      const req = createRequire(join(base, 'noop.js'));
      const where = own ? pkg : req.resolve('playwright/package.json');
      const pw = req(dirname(where));
      if (pw?.chromium) return { pw, base: dirname(where), version: JSON.parse(readFileSync(where, 'utf8')).version || '' };
      tried.push(`${base} (pas de chromium)`);
    } catch (e) {
      tried.push(`${base} (${String(e.code || e.message).slice(0, 80)})`);
    }
  }
  return { pw: null, tried };
}

// ── --probe : la machine sait-elle faire ? ──────────────────
async function probe(opts) {
  const out = { ok: false, why: '', node: process.execPath, playwright: null, version: '', chromium: null };
  const { pw, base, version, tried } = loadPlaywright(opts.bases);
  if (!pw) {
    out.why = `Playwright introuvable depuis ${tried.join(' ; ') || 'aucun dossier'}`;
    return out;
  }
  out.playwright = base;
  out.version = version;
  const exe = opts.chromium || pw.chromium.executablePath();
  out.chromium = exe;
  if (!exe || !existsSync(exe)) {
    out.why = opts.chromium ? `le Chromium réglé n'existe pas (${exe})` : `le Chromium de Playwright ${out.version} n'est pas installé (${exe})`;
    return out;
  }
  if (opts.launch) {
    try {
      const browser = await pw.chromium.launch({ args: LAUNCH_ARGS, ...(opts.chromium ? { executablePath: opts.chromium } : {}) });
      out.browser = browser.version();
      const page = await browser.newPage();
      await page.setContent('<p>essai</p>');
      const pdf = await page.pdf({ width: '100px', height: '100px' });
      out.pdf_bytes = pdf.length;
      await browser.close();
    } catch (e) {
      out.why = `Chromium ne se lance pas : ${String(e.message).split('\n')[0].slice(0, 300)}`;
      return out;
    }
  }
  out.ok = true;
  return out;
}

// ── le rendu ────────────────────────────────────────────────
async function render(spec) {
  const t0 = Date.now();
  const warnings = [];
  const { pw, tried } = loadPlaywright(spec.bases);
  if (!pw) throw new Error(`Playwright introuvable depuis ${tried.join(' ; ')}`);
  say({ t: 'progress', p: 0.05, m: 'lance Chromium' });
  const browser = await pw.chromium.launch({ args: LAUNCH_ARGS, ...(spec.chromium ? { executablePath: spec.chromium } : {}) });
  try {
    const base = new URL(spec.base);
    const root = base.pathname.endsWith('/') ? base.pathname : base.pathname + '/';
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'fr-FR', reducedMotion: 'reduce' });
    // les préférences de la personne (le thème : commun/theme-tot.js les lit avant la première peinture),
    // la taille de l'interface toujours à 100 % (le zoom changerait la scène)
    await ctx.addInitScript(([key, data]) => { try { localStorage.setItem(key, JSON.stringify({ data })); } catch { /* */ } },
      ['sr.prefs.v1', spec.prefs || {}]);
    const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
    const file = (route, path) => {
      const ext = path.split('.').pop().toLowerCase();
      if (!TYPES[ext] || !existsSync(path) || !statSync(path).isFile()) return json(route, 404, { error: 'introuvable' });
      return route.fulfill({ status: 200, path, contentType: TYPES[ext], headers: { 'Cache-Control': 'no-store' } });
    };
    await ctx.route('**/*', (route) => {
      const req = route.request();
      const u = new URL(req.url());
      const method = req.method();
      if (u.origin === base.origin && u.pathname.startsWith(root)) {
        const rel = decodeURIComponent(u.pathname.slice(root.length));
        if (rel.startsWith('api/')) {
          const key = `${method} ${rel.slice(4)}`;
          if (Object.hasOwn(spec.api || {}, key)) return json(route, 200, spec.api[key]);
          let m = /^api\/ideation\/web\/img\/([0-9a-f]{24})$/.exec(rel);
          if (m && method === 'GET' && spec.web?.[m[1]]) return file(route, spec.web[m[1]]);
          m = /^api\/son\/apercu\/([a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4})$/.exec(rel);
          if (m && method === 'GET' && spec.waves?.[m[1]]) return file(route, spec.waves[m[1]]);
          warnings.push(`api non servie : ${method} ${rel}`);
          return json(route, 404, { error: 'pas servi à l’impression' });
        }
        if (!['GET', 'HEAD'].includes(method)) { warnings.push(`écriture refusée : ${method} ${rel}`); return route.abort(); }
        const lib = /^library\/([^/]+)\/([^/]+)$/.exec(rel);
        if (lib) {
          const dir = ITEM.test(lib[1]) ? spec.files?.[lib[1]] : null;
          if (!dir || !FILE.test(lib[2])) { warnings.push(`fichier non servi : ${rel}`); return json(route, 404, { error: 'introuvable' }); }
          return file(route, join(dir, lib[2]));
        }
        return route.continue();   // les pages et les modules : le portail
      }
      if (FONT_HOSTS.has(u.hostname) && method === 'GET') return route.continue();
      return route.abort();
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    say({ t: 'progress', p: 0.12, m: 'ouvre la présentation' });
    await page.goto(new URL(spec.page, base).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    say({ t: 'progress', p: 0.2, m: 'polices et images' });
    await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error, null, { timeout: 120000, polling: 100 });
    const err = await page.evaluate(() => document.body.dataset.error || '');
    if (err) throw new Error(`la page d'impression : ${err}`);
    // les polices : celles que la page a demandées, chargées (ou abandonnées) ; les images : décodées par lecture.js
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 20000))]));
    const info = await page.evaluate(() => {
      const strip = (s) => String(s || '').trim().replace(/^["']|["']$/g, '');
      const loaded = new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => strip(f.family)));
      const I = window.SR_IMPRESSION || { pages: [] };
      const nodes = [...document.querySelectorAll('.pl-page')];
      return { name: I.name || document.title, loaded: [...loaded],
        pages: I.pages.map((p, k) => ({ ...p, text: (nodes[k]?.innerText || '').replace(/\n{3,}/g, '\n\n').trim() })) };
    });
    const n = info.pages.length;
    if (!n) throw new Error('la page d’impression n’a aucune diapositive');
    // la licence des polices : le PDF embarque les siennes (server/tools/ideation.py, FONTS : `pdf`)
    const used = new Map();
    info.pages.forEach((p, k) => { for (const f of p.fonts || []) { if (!used.has(f)) used.set(f, []); used.get(f).push(k + 1); } });
    const refuse = new Map((spec.pdf_refuse || []).map((f) => [f.family, f]));
    const bad = [...used].filter(([f]) => refuse.has(f));
    if (spec.pdf && bad.length) {
      const [family, slides] = bad[0];
      return { refused: { family, slides, why: refuse.get(family).why || '', others: bad.slice(1).map(([x]) => x) }, pages: info.pages };
    }
    const fallback = [...used.keys()].filter((f) => !GENERIC.has(f.toLowerCase()) && !info.loaded.includes(f));
    if (fallback.length) warnings.push(`police de repli à la place de ${fallback.join(', ')} (non chargée)`);
    await page.emulateMedia({ media: 'print' });
    let pdf = null;
    if (spec.pdf) {
      say({ t: 'progress', p: 0.4, m: `PDF · ${n} ${n > 1 ? 'pages' : 'page'}` });
      pdf = join(spec.out, 'presentation.pdf');
      await page.pdf({ path: pdf, printBackground: true, preferCSSPageSize: true, timeout: 180000 });
    }
    // les images : chaque page telle que l'impression la peint (le même CSS que le PDF), à la taille de sa scène ;
    // la première sert de couverture au document
    const shots = [];
    const sections = page.locator('.pl-page');
    const count = spec.png ? n : 1;
    for (let k = 0; k < count; k++) {
      say({ t: 'progress', p: 0.55 + 0.4 * (k / Math.max(1, count)), m: spec.png ? `images · ${k + 1} / ${n}` : 'couverture' });
      const p = info.pages[k];
      const path = join(spec.out, spec.png ? `diapo-${String(k + 1).padStart(2, '0')}.png` : 'cover.png');
      await sections.nth(k).screenshot({ path, animations: 'disabled', timeout: 60000 });
      shots.push({ path, w: p.w, h: p.h });
    }
    if (errors.length) warnings.push(...errors.slice(0, 5).map((e) => `la page : ${e.slice(0, 200)}`));
    return { pdf, png: spec.png ? shots.map((s) => s.path) : [], cover: shots[0]?.path || null, pages: info.pages,
      fonts: [...used.keys()], warnings: [...new Set(warnings)].slice(0, 20), ms: Date.now() - t0 };
  } finally {
    await browser.close().catch(() => {});
  }
}

const args = process.argv.slice(2);
try {
  if (args[0] === '--probe') {
    say({ t: 'probe', ...(await probe(JSON.parse(args[1] || '{}'))) });
  } else {
    const spec = JSON.parse(readFileSync(args[0], 'utf8'));
    say({ t: 'done', ...(await render(spec)) });
  }
} catch (e) {
  say({ t: 'error', message: String(e?.message || e).split('\n')[0].slice(0, 600) });
  process.exitCode = 2;
}
