// Captures du portail en étant connecté (porte d'entrée active), sur DGX2.
//   node tools/shot_connecte.mjs http://192.168.10.247:8790 /tmp/sr_c nico007 '[{"name":"a","url":"analyse/"}]'
// Seule l'entrée par pseudo écrit (POST /api/auth/enter) ; toute autre
// requête d'écriture est bloquée. Journal : erreurs de console, requêtes en
// échec (réseau ou statut ≥ 400), dans <out>/<name>.log.
import { createRequire } from 'module';
import { writeFileSync } from 'fs';

const require = createRequire('/home/dgx/Character_Sheet/package.json');
const { chromium } = require('playwright');
const [base, out, pseudo, spec] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const r = await ctx.request.post(`${base}/api/auth/enter`, { data: { name: pseudo }, headers: { Origin: base } });
console.log('entrée', r.status(), (await r.text()).slice(0, 120));
for (const t of JSON.parse(spec)) {
  const page = await ctx.newPage();
  const log = [];
  await page.route('**/*', (rt) => {
    const q = rt.request();
    if (['GET', 'HEAD'].includes(q.method())) return rt.continue();
    log.push('BLOQUÉ ' + q.method() + ' ' + q.url()); return rt.abort();
  });
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => log.push('PAGEERROR ' + e.message));
  page.on('requestfailed', (q) => log.push(`ÉCHEC ${q.failure()?.errorText} ${q.url()}`));
  page.on('response', (s) => { if (s.status() >= 400) log.push(`${s.status()} ${s.url()}`); });
  await page.goto(`${base}/${t.url || ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(t.wait || 5000);
  for (const c of t.clicks || []) { try { await page.click(c, { timeout: 3000 }); await page.waitForTimeout(1500); } catch { log.push('clic raté ' + c); } }
  if (t.eval) { try { log.push('EVAL ' + JSON.stringify(await page.evaluate(t.eval))); } catch (e) { log.push('EVAL raté ' + e.message); } }
  await page.screenshot({ path: `${out}/${t.name}.png`, fullPage: !!t.full });
  writeFileSync(`${out}/${t.name}.log`, log.join('\n'));
  await page.close();
}
await ctx.request.post(`${base}/api/auth/logout`, { headers: { Origin: base } });
await browser.close();
