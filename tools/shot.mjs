// Captures d'écran du portail, sur DGX2 (Chromium sans affichage, le
// playwright de ~/Character_Sheet). Aucune écriture : toute requête autre
// que GET/HEAD est bloquée avant de partir.
//
//   node tools/shot.mjs http://127.0.0.1:8790 /tmp/sr_shots '[{"name":"home","url":"","w":1600,"h":1000}]'
//
// Chaque cible : name, url (relative à la base), w, h, full (page entière),
// wait (ms), clicks (sélecteurs), mobile. Le journal des erreurs de la page
// s'écrit dans <out>/<name>.log.
import { createRequire } from 'module';
import { writeFileSync } from 'fs';

const require = createRequire('/home/dgx/Character_Sheet/package.json');
const { chromium } = require('playwright');
const [base, out, spec] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const t of JSON.parse(spec)) {
  const ctx = await browser.newContext({ viewport: { width: t.w || 1600, height: t.h || 1000 }, isMobile: !!t.mobile, hasTouch: !!t.mobile });
  const page = await ctx.newPage();
  const log = [];
  await page.route('**/*', (r) => (['GET', 'HEAD'].includes(r.request().method()) ? r.continue() : (log.push('BLOQUÉ ' + r.request().url()), r.abort())));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => log.push('PAGEERROR ' + e.message));
  await page.goto(`${base}/${t.url || ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(t.wait || 2500);
  for (const c of t.clicks || []) { try { await page.click(c, { timeout: 3000 }); await page.waitForTimeout(700); } catch { log.push('clic raté ' + c); } }
  await page.screenshot({ path: `${out}/${t.name}.png`, fullPage: !!t.full });
  writeFileSync(`${out}/${t.name}.log`, log.join('\n'));
  await ctx.close();
}
await browser.close();
