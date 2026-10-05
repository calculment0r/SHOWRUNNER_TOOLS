// Le pilote de l'export PDF du mode Présentation (ideation/presentation/export.js, le travail
// presentation.pdf : server/tools/presentation_pdf.py, tools/presentation_export.mjs), sur un portail
// d'ESSAI (tools/portail_essai.py : porte coupée, on entre en Cal) — jamais le portail en ligne : il
// range des images, crée des planches et des documents.
//
//   python3 tools/portail_essai.py 8850 /tmp/sr_slides-pdf &
//   node ideation/pilote_pdf.mjs http://127.0.0.1:8850 /tmp/sr_pilote_pdf
//
// Une présentation de trois diapositives (un texte, une image, une forme), en sombre puis en clair :
//   - « Exporter en PDF » allumé, un seul bouton orange à l'écran ; son menu (▾) : sept entrées (le PDF, le
//     PDF et les images, les images, trois vidéos MP4 depuis le 06/10, l'impression du navigateur) ;
//   - le clic : le panneau d'export, la progression du travail (la ligne de la file), puis « fini » ;
//     « Télécharger le PDF » mène au document rangé (trois pages de 1440 × 810 pt, son texte, sa
//     couverture, dossier Idéation), « Dans Asset ↗ » à sa fiche ; le PDF et les images : « Images · 3 » ;
// puis les refus, chacun avec sa raison (règle 7) :
//   - un titre sans style (Venus Rising, dont la licence refuse le PDF) : le bouton dit laquelle et où,
//     le menu garde « Une image par diapositive », qui marche ;
//   - un aperçu de modèle : « appliquez le modèle ou quittez l'aperçu » ;
//   - Chromium absent de la machine (la réponse de la machine, interceptée) : le bouton le dit.
// Sans erreur de console (Google Fonts coupé par le réseau d'un conteneur mis à part). Rend 0 si tout
// passe ; le détail dans <out>/pilote.log, les captures dans <out>.
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';

const require = createRequire(import.meta.url);
let chromium;
for (const p of [process.env.SR_PLAYWRIGHT, '/opt/node22/lib/node_modules/playwright', '/home/dgx/Character_Sheet/node_modules/playwright'].filter(Boolean)) {
  try { ({ chromium } = require(p)); break; } catch { /* le suivant */ }
}
const [BASE = 'http://127.0.0.1:8850', OUT = '/tmp/sr_pilote_pdf'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };

const api = async (method, path, body, raw) => {
  const r = await fetch(`${BASE}/api/${path}`, { method, headers: raw ? {} : { 'Content-Type': 'application/json' },
    body: raw || (body !== undefined ? JSON.stringify(body) : undefined) });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { /* */ }
  if (!r.ok) throw new Error(`${method} ${path} : ${r.status} ${t.slice(0, 200)}`);
  return j;
};

// ── les planches, posées par l'API (comme la page les enregistrerait) ──
execFileSync('python3', ['-c', `
import sys
from PIL import Image
im = Image.new("RGB", (800, 450), (220, 30, 30)); im.paste((30, 40, 220), (400, 0, 800, 450)); im.save(sys.argv[1])
`, `${OUT}/diapo.png`]);
const img = await api('PUT', 'library/upload?name=diapo.png&title=Diapo%20du%20pilote', undefined, readFileSync(`${OUT}/diapo.png`));
const G = 2200;
const frame = (id, x, name) => ({ id, type: 'frame', x, y: 0, w: 1920, h: 1080, name, deck: { ratio: '16:9', trans: 'fade' } });
async function board(name, nodes) {
  const b = await api('POST', 'ideation/boards', { name });
  await api('POST', `ideation/boards/${b.id}`, { name, v: b.v || 2, nodes, links: [], base_rev: b.rev });
  return b.id;
}
const A = await board('Pilote · export PDF', [
  frame('f1', 0, 'Ouverture'), frame('f2', G, 'Image'), frame('f3', 2 * G, 'Forme'),
  { id: 't1', type: 'title', x: 96, y: 400, w: 1600, h: 160, text: 'Bonjour le monde', size: 'l', style: 'h2' },
  { id: 'n1', type: 'note', x: 96, y: 700, w: 1200, h: 80, text: 'Une ligne de corps lisible', style: 'body' },
  { id: 'm1', type: 'media', item: img.id, kind: 'image', x: G + 160, y: 140, w: 1600, h: 800, title: 'Diapo' },
  { id: 's1', type: 'shape', kind: 'ellipse', color: 'or', x: 2 * G + 560, y: 240, w: 800, h: 600, text: 'Forme ronde' },
]);
const B = await board('Pilote · licence', [
  frame('f1', 0, 'Une'),
  { id: 't1', type: 'title', x: 96, y: 400, w: 1400, h: 120, text: 'Titre sans style', size: 'l' },
]);
ok(true, `les planches ${A} (trois diapositives) et ${B} (un titre sans style)`);

// ── la page ──
const browser = await chromium.launch();
async function newPage(theme, route = null) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
  }, theme);
  if (route) await ctx.route('**/api/ideation/presentation/pdf', route);
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (/fonts\.googleapis|ERR_CERT_AUTHORITY_INVALID/.test(m.text() + (m.location()?.url || ''))) return;   // le réseau du conteneur
    errs.push(`${m.type()}: ${m.text()} ${m.location()?.url || ''}`);
  });
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
  page.errs = errs;
  page.shot = async (n) => { await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/${n}.png` }); };
  return { ctx, page };
}
async function enterMode(page, bid) {
  await page.goto(`${BASE}/ideation/#${bid}`);
  await page.waitForSelector('.dp-pm', { state: 'attached', timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('.dp-pm').click());
  await page.waitForSelector('.pm-mode:not([hidden]) .pm-expb', { timeout: 20000 });
  // la machine a répondu (le bouton n'attend plus)
  await page.waitForFunction(() => !/on demande à la machine/.test(document.querySelector('.pm-expb')?.title || ''), null, { timeout: 15000 });
  await page.waitForTimeout(500);
}
const btn = (page) => page.$eval('.pm-expb', (b) => ({ dis: b.getAttribute('aria-disabled') === 'true', title: b.title }));
const visibleGo = (page) => page.$$eval('.tb.go', (l) => l.filter((x) => x.offsetWidth || x.offsetHeight).length);
const menuItems = (page) => page.$$eval('.sr-menu .mi', (l) => l.map((x) => ({ label: x.querySelector('.lb')?.textContent || '',
  text: x.textContent, off: x.getAttribute('aria-disabled') === 'true' })));
// une entrée du menu par son libellé (le menu a grandi le 06/10 : les vidéos MP4)
const entry = (items, re) => items.find((x) => re.test(x.label)) || { off: null, label: '?' };
const PDF = /^PDF$/, PDFPNG = /^PDF et une image/, PNG = /^Une image par/, PRINT = /^Imprimer/, VIDEO = /^Vidéo/;
async function waitPanel(page, before = '', ms = 120000) {
  const seen = new Set();
  const t0 = Date.now();
  // un nouvel export : le panneau suit un autre travail que le précédent
  await page.waitForFunction((b) => { const p = document.querySelector('.pm-expp:not([hidden])'); return p && p.dataset.job && p.dataset.job !== b; },
    before, { timeout: 15000 });
  for (;;) {
    const s = await page.evaluate(() => document.querySelector('.pm-expp:not([hidden]) .job .js')?.textContent || '');
    if (s) seen.add(s.split(' · ')[0]);
    if (/^(fini|échec|arrêté)/.test(s) || Date.now() - t0 > ms) return { last: s, seen: [...seen] };
    await page.waitForTimeout(150);
  }
}
const pdfFacts = (file) => {
  const info = execFileSync('pdfinfo', ['-f', '1', '-l', '99', file]).toString();
  return { pages: +(/^Pages:\s+(\d+)/m.exec(info)?.[1] || 0), sizes: [...info.matchAll(/^Page\s+\d+ size:\s+([\d.]+ x [\d.]+) pts/gm)].map((m) => m[1]),
    text: execFileSync('pdftotext', ['-enc', 'UTF-8', file, '-']).toString() };
};

for (const theme of ['dark', 'light']) {
  const { ctx, page } = await newPage(theme);
  await enterMode(page, A);
  ok(await page.$eval('html', (h) => h.dataset.theme) === theme, `${theme} : le thème est posé`);
  let b = await btn(page);
  ok(!b.dis && /une page par diapositive/.test(b.title), `${theme} : « Exporter en PDF » allumé (${b.title.slice(0, 60)}…)`);
  ok(await visibleGo(page) === 1, `${theme} : un seul bouton orange à l'écran (la passe assistée)`);
  await page.click('.pm-expm');
  await page.waitForSelector('.sr-menu .mi', { timeout: 3000 });
  const items = await menuItems(page);
  ok(items.length === 7 && items.every((x) => !x.off) && PDF.test(items[0].label) && PRINT.test(items[6].label) && items.filter((x) => VIDEO.test(x.label)).length === 3,
    `${theme} : le menu d'export : ${items.map((x) => x.text.replace(/\s+/g, ' ').trim()).join(' | ')}`);
  await page.shot(`${theme}-menu`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // le PDF seul, depuis le bouton
  await page.click('.pm-expb');
  await page.waitForSelector('.pm-expp:not([hidden]) .job', { timeout: 10000 });
  b = await btn(page);
  ok(b.dis && /déjà en route/.test(b.title), `${theme} : pendant l'export, le bouton dit qu'il est en route`);
  const run = await waitPanel(page);
  ok(/^fini/.test(run.last) && run.seen.some((s) => /en file|en cours/.test(s)),
    `${theme} : la progression dans le panneau (${run.seen.join(' → ')})`);
  await page.waitForSelector('.pm-expa a[download]', { timeout: 10000 });
  const links = await page.$$eval('.pm-expa a, .pm-expa button', (l) => l.map((a) => ({ t: a.textContent, href: a.getAttribute('href') || '', dl: a.getAttribute('download') || '' })));
  const dl = links.find((x) => x.dl);
  const docId = /library\/(doc-[^/]+)\/main\.pdf/.exec(dl?.href || '')?.[1];
  ok(!!docId && dl.dl === 'Pilote · export PDF.pdf' && links.some((x) => /Dans Asset/.test(x.t) && x.href.endsWith(`asset/#${docId}`)),
    `${theme} : « Télécharger le PDF » et « Dans Asset ↗ » mènent au document (${links.map((x) => x.t).join(', ')})`);
  ok(await visibleGo(page) === 1, `${theme} : toujours un seul bouton orange, le panneau ouvert`);
  await page.shot(`${theme}-fini`);
  if (docId) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('.pm-expa a[download]')]);
    const file = `${OUT}/${theme}.pdf`;
    await download.saveAs(file);
    const f = pdfFacts(file);
    ok(f.pages === 3 && f.sizes.every((s) => s === '1440 x 810') && /Bonjour le monde/.test(f.text) && /Forme ronde/.test(f.text),
      `${theme} : le PDF téléchargé : ${f.pages} pages ${f.sizes.join(', ')}, son texte`);
    const it = await api('GET', `library/${docId}`);
    ok(it.kind === 'document' && it.folder === 'Idéation' && it.doc?.has_text && it.doc?.pages === 3 && !!it.thumb_url && it.parents.includes(img.id),
      `${theme} : rangé dans la bibliothèque : un document, dossier Idéation, son texte, sa couverture, sa lignée`);
  }
  // le PDF et les images, depuis le menu
  await page.click('.pm-expm');
  await page.waitForSelector('.sr-menu .mi', { timeout: 3000 });
  const before = await page.$eval('.pm-expp', (p) => p.dataset.job || '');
  await page.evaluate(() => [...document.querySelectorAll('.sr-menu .mi')].find((x) => /PDF et une image/.test(x.querySelector('.lb')?.textContent)).click());
  const run2 = await waitPanel(page, before);
  await page.waitForTimeout(400);
  const zipB = await page.$$eval('.pm-expa button', (l) => l.map((x) => x.textContent));
  ok(/^fini/.test(run2.last) && zipB.some((t) => /Images · 3/.test(t)), `${theme} : le PDF et une image par diapositive (${zipB.join(', ')})`);
  ok(!page.errs.length, `${theme} : aucune erreur de console ${page.errs.slice(0, 3).join(' | ')}`);
  await ctx.close();
}

// ── les refus, chacun avec sa raison ──
{
  const { ctx, page } = await newPage('dark');
  await enterMode(page, B);
  const b = await btn(page);
  ok(b.dis && /Venus Rising/.test(b.title) && /diapositive 1/.test(b.title) && /images PNG seules/.test(b.title),
    `licence : le bouton dit laquelle et où (${b.title.slice(0, 110)}…)`);
  await page.evaluate(() => document.querySelector('.pm-expb').click());   // aria-disabled : Playwright ne cliquerait pas
  await page.waitForTimeout(300);
  ok(/Venus Rising/.test(await page.$eval('.toast', (t) => t.textContent).catch(() => '')) && await page.$('.pm-expp:not([hidden])') === null,
    'licence : le clic redit la raison, rien ne part');
  await page.click('.pm-expm');
  await page.waitForSelector('.sr-menu .mi', { timeout: 3000 });
  const items = await menuItems(page);
  ok(entry(items, PDF).off && entry(items, PDFPNG).off && !entry(items, PNG).off && !entry(items, PRINT).off
    && items.filter((x) => VIDEO.test(x.label)).every((x) => x.off && /ni le PDF ni la vidéo/.test(x.text)),
    `licence : le menu éteint le PDF et la vidéo (la même licence), garde les images et l'impression du navigateur`);
  await page.shot('licence-menu');
  await page.evaluate(() => [...document.querySelectorAll('.sr-menu .mi')].find((x) => /^Une image/.test(x.querySelector('.lb')?.textContent)).click());
  const run = await waitPanel(page);
  await page.waitForTimeout(400);
  const zipB = await page.$$eval('.pm-expa button', (l) => l.map((x) => x.textContent));
  ok(/^fini/.test(run.last) && zipB.some((t) => /Images · 1/.test(t)), `licence : les images seules passent (${zipB.join(', ')})`);
  // un aperçu de modèle : le PDF est celui de la planche
  await page.click('.pm-expp .pm-exph button');
  await page.click('.pm-card[data-tpl="revue"]');
  await page.waitForTimeout(800);
  const t = await btn(page);
  ok(t.dis && /aperçu de/.test(t.title) && /quittez l’aperçu/.test(t.title), `aperçu : le bouton le dit (${t.title.slice(0, 90)}…)`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  ok(/Venus Rising/.test((await btn(page)).title), 'aperçu quitté : la raison de la planche revient');
  ok(!page.errs.length, `refus : aucune erreur de console ${page.errs.slice(0, 3).join(' | ')}`);
  await ctx.close();
}
{
  const { ctx, page } = await newPage('light', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: false, why: 'node n’est pas sur la machine du portail (essai du pilote)', refused_fonts: [] }) }));
  await enterMode(page, A);
  const b = await btn(page);
  ok(b.dis && /Chromium n’est pas disponible/.test(b.title) && /Diagnostics/.test(b.title), `sans Chromium : le bouton le dit et mène au diagnostic (${b.title.slice(0, 90)}…)`);
  await page.click('.pm-expm');
  await page.waitForSelector('.sr-menu .mi', { timeout: 3000 });
  const items = await menuItems(page);
  ok(items.filter((x) => !PRINT.test(x.label)).every((x) => x.off) && !entry(items, PRINT).off, 'sans Chromium : seule l’impression du navigateur reste');
  await page.shot('sans-chromium');
  ok(!page.errs.length, `sans Chromium : aucune erreur de console ${page.errs.slice(0, 3).join(' | ')}`);
  await ctx.close();
}
// le thème de Cal revient au sombre (le pilote l'a changé sur le portail d'essai)
await api('POST', 'prefs', { patch: { general: { theme: 'dark' } } }).catch(() => {});
await browser.close();
writeFileSync(`${OUT}/pilote.log`, log.join('\n') + '\n');
console.log(`\n${log.length - fails} passés, ${fails} en échec — ${OUT}`);
process.exit(fails ? 1 : 0);
