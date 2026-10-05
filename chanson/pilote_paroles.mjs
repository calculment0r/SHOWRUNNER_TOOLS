// Le pilote des paroles calées (commun/lrc.js, server/tools/paroles.py), depuis la carte d'une chanson de
// Musique : Chromium sans affichage, un portail d'essai en moteurs factices, jamais le portail en ligne.
//
//   node chanson/pilote_paroles.mjs http://127.0.0.1:8808 /tmp/sr_paroles/shots
//
// Une chanson d'essai (Rapide, des paroles) → son menu « Caler les paroles » → l'éditeur s'ouvre et la chaîne
// part seule (la voix seule, les mots, le calage) → les lignes arrivent → lecture : toucher une ligne la pose à
// l'instant entendu → décaler tout de + 0,5 s → corriger le texte d'une ligne → Ctrl+Z → tout s'enregistre seul
// (le serveur le relit) → fermer, la carte dit « paroles calées » ; puis en clair, et au téléphone. Rend 0 si
// tout passe ; le détail dans <out>/pilote.log.
import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('/opt/node22/lib/node_modules/playwright'); }               // la session cloud
catch { pw = createRequire('/home/dgx/Character_Sheet/package.json')('playwright'); }   // DGX2
const { chromium } = pw;
const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const H = { 'Content-Type': 'application/json', Origin: base };
const get = (p) => fetch(`${base}/api/${p}`).then((r) => r.json());
const post = (p, b) => fetch(`${base}/api/${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── une chanson d'essai (Rapide, moteur factice), avec ses paroles dans la recette ──
const LYR = "[verse]\nJ'ai vingt ans ce soir et l'été s'en va\nC'est la mer qui chante au bout de nos voix\n\n[chorus]\n"
  + "Qu'on s'en aille à 3 sur la route du port\nEt qu'il pleuve encore, et qu'il pleuve encore\nLe vieux phare s'allume au-dessus des toits";
const job = await post('chanson/create', { prompt: 'folk douce, guitare', vocal: true, preset: 'rapide', duration: 30, lyrics: LYR, title: 'Pilote paroles' });
let j = job;
for (let i = 0; i < 100 && !['done', 'error'].includes(j.state); i++) { await sleep(200); j = await get(`jobs/${job.id}`); }
const sid = j.result?.items?.[0];
ok(j.state === 'done' && sid, `une chanson d'essai (${j.state} ${sid})`);

async function newPage(theme, viewport = { width: 1440, height: 900 }, mobile = false) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
  }, theme);
  // les polices de Google ne passent pas partout (la session cloud) : une feuille vide, pas une erreur
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') { page.errors.push(m.text()); log.push(`console ${theme}: ${m.text()}`); } });
  page.on('pageerror', (e) => { page.errors.push(e.message); log.push(`PAGEERROR ${theme}: ${e.message}`); fails++; });
  return { ctx, page };
}
const shot = async (page, name) => { await page.waitForTimeout(300); await page.screenshot({ path: `${out}/${name}.png` }); };
const rows = (page) => page.$$eval('.lrc-l', (l) => l.map((r) => ({ t: r.querySelector('.lrc-t').textContent, x: r.querySelector('.lrc-x, .lrc-in')?.textContent || '' })));
const secs = (tc) => { const [m, s] = tc.split(':'); return +m * 60 + parseFloat(s); };
const srvLignes = async () => { const g = await get(`paroles/${sid}`); return { g, l: (g.lrc || '').trim().split('\n').filter(Boolean) }; };
async function attendreEnregistre(page) {
  await page.waitForFunction(() => document.querySelector('.lrc-etat')?.textContent === 'enregistré', null, { timeout: 8000 }).catch(() => {});
}
async function ouvrirMenu(page, label) {
  await page.click(`.ch-song[data-id="${sid}"] .sr-kebab`);
  await page.waitForSelector('.sr-menu');
  await page.click(`.sr-menu >> text=${label}`);
}

// ── en sombre : depuis la carte, la chaîne, puis la main ──
{
  const { ctx, page } = await newPage('dark');
  await page.goto(`${base}/chanson/`, { waitUntil: 'networkidle' });
  await page.waitForSelector(`.ch-song[data-id="${sid}"]`);
  await ouvrirMenu(page, 'Caler les paroles');
  await page.waitForSelector('.lrc-modal');
  ok(true, "le menu de la carte ouvre l'éditeur");
  ok(!(await page.$('.lrc-modal .tb.go')), "aucun orange dans l'éditeur (le geste : toucher une ligne)");
  // la chaîne part seule : la voix seule, les mots, le calage ; les lignes arrivent
  await page.waitForFunction(() => document.querySelectorAll('.lrc-l').length >= 5 && /lignes/.test(document.querySelector('.lrc-chaine')?.textContent || ''),
    null, { timeout: 60000 }).catch(() => {});
  let r = await rows(page);
  ok(r.length === 5 && r[0].x.startsWith("J'ai vingt ans"), `la chaîne a calé les cinq lignes de la recette (${r.length} : ${await page.textContent('.lrc-chaine')})`);
  const ch = (await get(`paroles/${sid}`)).calage;
  ok(ch?.state === 'fini' && ch.jobs?.voix && ch.jobs?.mots && ch.jobs?.calage, `trois travaux : la voix seule, les mots, le calage (${ch?.state})`);
  await shot(page, 'sombre-cale');

  // lecture (Espace), puis toucher la 1re ligne : elle se pose à l'instant entendu, la 2e est choisie
  await page.keyboard.press('Space');
  await page.waitForFunction(() => (document.querySelector('.sr-lect')?.srLecteur?.t || 0) > 1.2, null, { timeout: 8000 }).catch(() => {});
  const before = await page.evaluate(() => document.querySelector('.sr-lect').srLecteur.t);
  await page.click('.lrc-l[data-k="0"] .lrc-x');
  const after = await page.evaluate(() => document.querySelector('.sr-lect').srLecteur.t);
  r = await rows(page);
  const t2 = secs(r[0].t);
  ok(t2 >= before - 0.05 && t2 <= after + 0.05, `toucher une ligne à l'écoute la pose à l'instant (${t2} s, entre ${before.toFixed(2)} et ${after.toFixed(2)})`);
  ok(await page.$eval('.lrc-l[data-k="1"]', (n) => n.classList.contains('sel')), 'la ligne suivante est choisie');
  await page.keyboard.press('Space');   // arrêt
  await attendreEnregistre(page);
  let s = await srvLignes();
  ok(s.l.some((x) => x.startsWith(`[${r[0].t}]J'ai vingt ans`)), `enregistré seul : le serveur a la ligne recalée (${s.l[0]})`);

  // décaler tout de + 0,5 s
  const avant = (await rows(page)).map((x) => secs(x.t));
  await page.click('button[data-decaler="1"]');
  const apres = (await rows(page)).map((x) => secs(x.t));
  ok(apres.every((t, k) => Math.abs(t - Math.min(avant[k] + 0.5, 30)) < 0.011 || t >= 29), `décaler tout : + 0,5 s sur chaque ligne (${avant[0]} → ${apres[0]})`);
  await attendreEnregistre(page);
  s = await srvLignes();
  const ed = (await rows(page)).map((x) => `[${x.t}]${x.x}`).sort();
  ok(JSON.stringify([...s.l].sort()) === JSON.stringify(ed), `le serveur a le décalage (${s.l[0]})`);

  // à l'arrêt, toucher une ligne y mène la lecture
  await page.click('.lrc-l[data-k="1"] .lrc-x');
  const tl = await page.evaluate(() => document.querySelector('.sr-lect').srLecteur.t);
  ok(Math.abs(tl - secs((await rows(page))[1].t)) < 0.1, `à l'arrêt, toucher une ligne y mène la lecture (${tl.toFixed(2)} s)`);

  // corriger le texte d'une ligne (✎), puis Ctrl+Z
  await page.hover('.lrc-l[data-k="4"]');
  await page.click('.lrc-l[data-k="4"] .lrc-ed');
  await page.fill('.lrc-in', 'Le vieux phare s’allume au-dessus des toits gris');
  await page.keyboard.press('Enter');
  r = await rows(page);
  ok(r[4].x.endsWith('toits gris'), 'corriger le texte d’une ligne');
  await attendreEnregistre(page);
  s = await srvLignes();
  ok(s.l[4].endsWith('toits gris'), 'le serveur a le texte corrigé');
  await page.keyboard.press('Control+z');
  r = await rows(page);
  ok(!r[4].x.endsWith('gris'), 'Ctrl+Z rend le texte d’avant');
  await attendreEnregistre(page);
  s = await srvLignes();
  ok(!s.l[4].endsWith('gris'), 'et le serveur aussi');
  await shot(page, 'sombre-edite');
  // Alt + → : la ligne choisie de + 0,1 s
  await page.click('.lrc-l[data-k="0"] .lrc-x');
  const t0 = secs((await rows(page))[0].t);
  await page.keyboard.press('Alt+ArrowRight');
  ok(Math.abs(secs((await rows(page))[0].t) - (t0 + 0.1)) < 0.011, 'Alt + → pousse la ligne choisie de 0,1 s');

  await page.click('.lrc-modal [data-fermer]');
  await page.waitForSelector('.lrc-modal', { state: 'detached' });
  await page.waitForFunction((id) => /paroles calées/.test(document.querySelector(`.ch-song[data-id="${id}"] .ch-meta`)?.textContent || ''), sid, { timeout: 5000 }).catch(() => {});
  ok(/paroles calées/.test(await page.textContent(`.ch-song[data-id="${sid}"] .ch-meta`)), 'fermé : la carte dit « paroles calées »');
  ok(!page.errors.length, `sombre : aucune erreur dans la console (${page.errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// ── en clair : rouvrir (« Paroles calées… »), le LRC est là ──
{
  const { ctx, page } = await newPage('light');
  await page.goto(`${base}/chanson/`, { waitUntil: 'networkidle' });
  await page.waitForSelector(`.ch-song[data-id="${sid}"]`);
  ok(await page.evaluate(() => document.documentElement.dataset.theme === 'light'), 'le thème clair est posé');
  await ouvrirMenu(page, 'Paroles calées…');
  await page.waitForSelector('.lrc-l');
  const s = await srvLignes();
  const r = await rows(page);
  ok(r.length === s.l.length && r.every((x, k) => s.l[k].startsWith(`[${x.t}]`)), `rouvert : les lignes enregistrées (${r.length})`);
  ok(!(await page.textContent('.lrc-chaine')).includes('…'), 'rouvert : aucun calage ne repart seul');
  await page.click('.lrc-l[data-k="1"] .lrc-x');   // à l'arrêt : la lecture va à la 2e ligne
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  ok(await page.$('.lrc-l.on'), 'à l’écoute, la ligne entendue est marquée');
  await page.keyboard.press('Space');
  await shot(page, 'clair');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.lrc-modal', { state: 'detached' });
  ok(true, 'Échap ferme l’éditeur');
  ok(!page.errors.length, `clair : aucune erreur dans la console (${page.errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// ── comme une playlist l'ouvrira : ses propres paroles, sa propre façon d'enregistrer ──
{
  const { ctx, page } = await newPage('dark');
  await page.goto(`${base}/chanson/`, { waitUntil: 'networkidle' });
  await page.evaluate((id) => import('/commun/lrc.js').then((m) => m.ouvrirEditeurLrc({
    item: id, lrc: '', lyrics: '[verse]\nune\ndeux\n\ntrois', onSave: (t) => { window.__vu = t; },
    enregistrer: async (t) => { window.__lrc = t; return { ok: true }; } })), sid);
  await page.waitForSelector('.lrc-l');
  const r = await rows(page);
  ok(r.length === 3 && (await page.$$('.lrc-l.est')).length === 3, `des paroles sans temps : trois lignes estimées (${r.map((x) => x.x).join(' / ')})`);
  ok(!(await page.$('.lrc-caler')), 'une autre façon d’enregistrer : pas de calage automatique proposé');
  await page.keyboard.press('Space');
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');   // la ligne choisie (la 1re estimée) posée à l'instant
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !!window.__lrc, null, { timeout: 5000 }).catch(() => {});
  const got = await page.evaluate(() => [window.__lrc, window.__vu]);
  ok(got[0] && got[0] === got[1] && /^\[00:0[01]\.\d\d\]une\n/.test(got[0]) && (got[0].match(/\n/g) || []).length === 3,
    `Entrée pose la ligne choisie ; enregistrer(lrc) puis onSave(lrc) (${JSON.stringify(got[0])})`);
  ok(!page.errors.length, `playlist : aucune erreur dans la console (${page.errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// ── au téléphone ──
{
  const { ctx, page } = await newPage('dark', { width: 390, height: 844 }, true);
  await page.goto(`${base}/chanson/`, { waitUntil: 'networkidle' });
  await page.waitForSelector(`.ch-song[data-id="${sid}"]`);
  await page.evaluate((id) => import('/commun/lrc.js').then((m) => m.ouvrirEditeurLrc({ item: id })), sid);
  await page.waitForSelector('.lrc-l');
  const w = await page.$eval('.lrc-modal', (n) => n.getBoundingClientRect().width);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(w <= 390 && sw <= 390, `téléphone : la boîte tient dans l'écran (${w} px, défilement ${sw} px)`);
  const hRow = await page.$eval('.lrc-l', (n) => n.getBoundingClientRect().height);
  ok(hRow >= 44, `téléphone : des lignes faciles à toucher (${hRow} px)`);
  await shot(page, 'telephone');
  ok(!page.errors.length, `téléphone : aucune erreur dans la console (${page.errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

await browser.close();
writeFileSync(`${out}/pilote.log`, log.join('\n') + '\n');
console.log(fails ? `${fails} ÉCHEC(S)` : 'tout passe');
process.exit(fails ? 1 : 0);
