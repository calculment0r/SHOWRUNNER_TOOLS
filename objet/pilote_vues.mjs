// Le pilote du parcours des vues d'Object Creator (objet/objet.js, server/tools/objet_vues.py) :
// un portail d'essai NEUF en moteurs factices (tools/portail_essai.py), jamais le portail en ligne.
//
//   node objet/pilote_vues.mjs http://127.0.0.1:8861 /tmp/sr_objet/shots /chemin/image.png [/chemin/three]
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright/package.json LC_ALL=C.UTF-8 node …   (une session cloud)
//
// Le parcours : « Nouvel objet » avec une image (une voiture de 3/4) → la fiche : l'image choisie et
// les trois autres vues principales déjà prévues → « d'où l'image le voit » : 3/4 avant gauche (la
// face rentre dans le plan) → Générer (quatre vues factices, en file puis à valider) → garder trois
// vues, en rejeter une → Ctrl+Z, puis de nouveau → « Plus de vues » (les 3/4 et le dessus, chacun
// depuis la vue gardée la plus proche) → la 3D factice → ses rendus → la planche. À chaque étape :
// un seul bouton orange, et celui de l'étape. Captures en sombre et en clair (et au téléphone).
// Le dernier argument : un dossier `package/` de three@0.170.0 (npm pack) servi à la place de
// jsdelivr, injoignable d'un conteneur ; sans lui, l'aperçu 3D dit qu'il est indisponible.
// Rend 0 si tout passe.
import { createRequire } from 'module';
import { mkdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const require = createRequire(process.env.PLAYWRIGHT || '/home/dgx/Character_Sheet/package.json');
const { chromium } = require('playwright');
const [base, out, image, three] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function newPage(theme, viewport = { width: 1600, height: 1000 }, mobile = false) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
  }, theme);
  if (three && existsSync(three)) {
    // three.js de jsdelivr : le paquet npm de la même version, servi tel quel
    await ctx.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', (route) => {
      const rel = new URL(route.request().url()).pathname.replace('/npm/three@0.170.0/', '');
      const f = join(three, rel);
      return existsSync(f) ? route.fulfill({ body: readFileSync(f), contentType: 'application/javascript' }) : route.abort();
    });
  }
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const away = /^Failed to load resource/.test(m.text()) && !(m.location()?.url || '').startsWith(base);
    console.log(`console ${theme}: ${m.text()} ${m.location()?.url || ''}`);
    if (!away) fails++;
  });
  page.on('pageerror', (e) => { console.log(`PAGEERROR ${theme}: ${e.message}`); fails++; });
  return { ctx, page };
}
const shot = async (page, name, full = true) => { await page.waitForTimeout(350); await page.screenshot({ path: `${out}/${name}.png`, fullPage: full }); };
const gos = (page) => page.$$eval('.tb.go', (l) => l.filter((b) => b.offsetParent !== null).map((b) => b.id || b.textContent.trim()));
const cards = (page) => page.$$eval('.vcard', (l) => l.map((c) => ({ id: c.dataset.slot, state: c.dataset.state, nm: c.querySelector('.nm')?.textContent,
  az: c.querySelector('.az')?.textContent })));
async function waitStates(page, pred, what, timeout = 60000) {
  const t0 = Date.now();
  for (;;) {
    const c = await cards(page);
    if (pred(c)) { ok(true, what); return c; }
    if (Date.now() - t0 > timeout) { ok(false, `${what} (${JSON.stringify(c.map((x) => [x.nm, x.state]))})`); return c; }
    await page.waitForTimeout(400);
  }
}
const card = (page, nm) => page.locator('.vcard', { has: page.locator('.nm', { hasText: new RegExp(`^${nm.replace(/[/.]/g, '\\$&')}$`) }) });

// ── le parcours, en sombre ──────────────────────────────────
const { ctx, page } = await newPage('dark');
await page.goto(`${base}/objet/`, { waitUntil: 'networkidle' });
ok((await gos(page)).length === 1, 'l’accueil : un seul bouton orange (Nouvel objet)');
await shot(page, 'objet-accueil-sombre', false);
await page.click('.o-hero .tb.go');
await page.waitForSelector('#no-form');
await page.setInputFiles('.src-pick input[type=file]', image);
await page.waitForFunction(() => !document.querySelector('.src-pick .prev').classList.contains('none'), null, { timeout: 30000 });
await page.fill('#no-name', 'Voiture rouge');
await page.click('.modal-foot .tb.go');
await page.waitForSelector('.vcard');
let c = await cards(page);
ok(c[0].state === 'source' && c.filter((x) => x.state === 'prevue').map((x) => x.nm).join() === 'gauche · 90°,dos · 180°,droite · 270°',
  `à l’arrivée : l’image choisie (de face par défaut) et les trois autres vues principales prévues (${c.map((x) => x.nm + ':' + x.state)})`);
ok((await gos(page)).join() === 'b-generer', `une étape : « Générer » est le seul orange (${await gos(page)})`);
const nul = async () => !/\bnull\b|undefined/.test(await page.textContent('#app'));
ok(await nul(), 'aucun « null » ni « undefined » écrit dans la fiche');
await shot(page, 'objet-arrivee-sombre');
// la voiture est vue de 3/4 avant gauche : la face rentre dans le plan
await page.click('.az-dot[data-az="45"]');
await page.waitForFunction(() => document.querySelectorAll('.vcard[data-state="prevue"]').length === 4);
c = await cards(page);
ok(c[0].nm === '3/4 avant gauche · 45°' && c.filter((x) => x.state === 'prevue').length === 4,
  `d’où on la voit : 3/4 avant gauche — les quatre vues principales à faire (${c.map((x) => x.nm + ':' + x.state)})`);
await page.click('#b-generer');
await waitStates(page, (l) => l.some((x) => x.state === 'file'), 'Générer : les vues en file');
await shot(page, 'objet-en-file-sombre');
c = await waitStates(page, (l) => l.filter((x) => x.state === 'proposee').length === 4, 'les quatre vues proposées (à valider)');
ok(c.filter((x) => x.state === 'proposee').every((x) => /depuis l.image choisie/.test(x.az)), 'chaque vue dit d’où elle part (l’image choisie)');
ok((await gos(page)).length === 0, `à valider : aucun orange, les vues attendent qu’on les regarde (${await gos(page)})`);
await shot(page, 'objet-a-valider-sombre');
for (const nm of ['face · 0°', 'gauche · 90°', 'dos · 180°']) {
  await card(page, nm).locator('button', { hasText: /^Garder$/ }).click();
  await page.waitForFunction((n) => [...document.querySelectorAll('.vcard')].some((c) => c.querySelector('.nm')?.textContent === n && c.dataset.state === 'gardee'), nm);
}
await card(page, 'droite · 270°').locator('button', { hasText: /^Rejeter$/ }).click();
await waitStates(page, (l) => l.find((x) => x.nm === 'droite · 270°')?.state === 'rejetee', 'trois vues gardées, une rejetée');
ok((await gos(page)).join() === 'b-plus', `l’étape suivante : « Plus de vues » est l’orange (${await gos(page)})`);
await page.keyboard.press('Control+z');
await waitStates(page, (l) => l.find((x) => x.nm === 'droite · 270°')?.state === 'proposee', 'Ctrl+Z : le rejet est défait');
ok(await page.$eval('#b-plus', (b) => b.disabled && /valide d.abord/.test(b.title)), '« Plus de vues » attend, et dit pourquoi');
await page.keyboard.press('Control+Shift+z');
await waitStates(page, (l) => l.find((x) => x.nm === 'droite · 270°')?.state === 'rejetee', 'Ctrl+Maj+Z : rejetée de nouveau');
await shot(page, 'objet-valide-sombre');
const lib = await page.evaluate(() => fetch('../api/library/' + location.hash.slice(1)).then((r) => r.json()));
ok(lib.element.refs.filter((r) => r.role === 'view').length === 4, 'garder : chaque vue gardée est une référence de l’objet (et l’image choisie)');
// plus de vues : les 3/4 et le dessus, depuis la vue gardée la plus proche
await page.click('#b-plus');
c = await waitStates(page, (l) => l.filter((x) => x.state === 'proposee').length === 4 && l.length === 9, 'plus de vues : les 3/4 et le dessus proposés', 90000);
const dep = Object.fromEntries(c.map((x) => [x.nm, x.az]));
ok(/depuis gauche · 90°/.test(dep['3/4 arrière gauche · 135°'] || '') && /depuis dos · 180°/.test(dep['3/4 arrière droit · 225°'] || '')
  && /depuis face · 0°/.test(dep['3/4 avant droit · 315°'] || '') && /depuis l.image choisie/.test(dep['dessus · 90°'] || ''),
  `chaque vue de l’affinage part de la vue gardée la plus proche (${JSON.stringify(dep)})`);
for (const nm of ['3/4 arrière gauche · 135°', '3/4 avant droit · 315°']) {
  await card(page, nm).locator('button', { hasText: /^Garder$/ }).click();
  await page.waitForFunction((n) => [...document.querySelectorAll('.vcard')].some((c) => c.querySelector('.nm')?.textContent === n && c.dataset.state === 'gardee'), nm);
}
// refaire une vue gardée : la nouvelle proposition se feuillette (‹ 2/2 ›), la gardée le reste
await card(page, 'face · 0°').locator('button', { hasText: /^Refaire$/ }).click();
await page.waitForFunction(() => [...document.querySelectorAll('.vcard')].some((c) => c.querySelector('.nm')?.textContent === 'face · 0°' && c.querySelector('.vc-nav')), null, { timeout: 30000 });
ok(await card(page, 'face · 0°').getAttribute('data-state') === 'gardee', 'refaire une vue gardée : elle le reste, la nouvelle proposition se feuillette');
ok(await nul(), 'aucun « null » écrit dans la fiche, avec des propositions à feuilleter');
await shot(page, 'objet-affinage-sombre');
// la 3D factice, ses rendus, la planche
await card(page, '3/4 arrière droit · 225°').locator('button', { hasText: /^Rejeter$/ }).click();
await card(page, 'dessus · 90°').locator('button', { hasText: /^Rejeter$/ }).click();
await page.waitForFunction(() => document.querySelectorAll('.vcard[data-state="proposee"]').length === 0);
ok((await gos(page)).join() === 'b-3d', `toutes décidées : « Tirer la 3D » est l’orange (${await gos(page)})`);
await page.click('#b-3d');
await page.waitForFunction(() => document.querySelector('#o-3d .stats'), null, { timeout: 30000 });
ok(/vues gardées attendent/.test(await page.textContent('#o-3d')), 'la 3D dit que les vues gardées attendent le multi-vues');
ok((await gos(page)).join() === 'b-rendus', `la 3D faite : « Faire les rendus » est l’orange (${await gos(page)})`);
if (three) {
  await page.waitForFunction(() => document.querySelector('#o-3d .three')?.dataset.ready === '1', null, { timeout: 30000 }).then(() => ok(true, 'l’aperçu 3D (three.js) montre le cube'), () => ok(false, 'l’aperçu 3D'));
}
await page.click('#b-rendus');
await page.waitForFunction(() => document.querySelectorAll('#o-rendus .rd').length === 9, null, { timeout: 30000 });
ok(true, 'neuf rendus (factices : la boîte du mesh), rangés avec le modèle');
ok((await gos(page)).join() === 'b-planche', `les rendus faits : « Faire la planche » est l’orange (${await gos(page)})`);
await page.click('#b-planche');
await page.waitForSelector('#o-planche .sheet img', { timeout: 30000 });
const sheet = await page.$eval('#o-planche .sheet img', (i) => new Promise((res) => (i.complete ? res([i.naturalWidth, i.naturalHeight]) : i.addEventListener('load', () => res([i.naturalWidth, i.naturalHeight])))));
ok(sheet[0] >= 3 * sheet[1], `la planche : les vues gardées côte à côte (${sheet})`);
ok((await gos(page)).length === 0, `tout est fait : plus d’orange (${await gos(page)})`);
await shot(page, 'objet-fiche-sombre');
const url = page.url();

// ── en clair : la même fiche, et l'arrivée d'un autre objet ──
const L = await newPage('light');
await L.page.goto(url, { waitUntil: 'networkidle' });
await L.page.waitForSelector('.vcard');
await shot(L.page, 'objet-fiche-clair');
ok((await gos(L.page)).length <= 1, 'en clair : au plus un orange');
await L.page.goto(`${base}/objet/`, { waitUntil: 'networkidle' });
await shot(L.page, 'objet-accueil-clair', false);
// ── au téléphone, en sombre : la fiche se lit en une colonne ──
const M = await newPage('dark', { width: 390, height: 844 }, true);
await M.page.goto(url, { waitUntil: 'networkidle' });
await M.page.waitForSelector('.vcard');
const wide = await M.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
ok(wide, 'au téléphone : pas de défilement de côté');
await shot(M.page, 'objet-fiche-telephone', false);

await browser.close();
console.log(fails ? `${fails} échec(s)` : 'tout passe');
process.exit(fails ? 1 : 0);
