// Le pilote de l'outil Upscale, sur DGX2 (Chromium sans affichage, le
// playwright de ~/Character_Sheet) : un portail d'essai en moteur factice,
// jamais le portail en ligne.
//
//   node upscale/pilote.mjs http://127.0.0.1:8849 /tmp/sr_up_shots image.png video.mp4
//
// Déposer une image → sa pile → deux essais factices → le rideau → le zoom à
// la molette, lié entre A et B, le bouton du milieu, le double-clic ; puis
// une vidéo, de même, avec la lecture synchronisée. Captures en sombre et en
// clair. Rend 0 si tout passe ; le détail dans <out>/pilote.log.
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';

const require = createRequire('/home/dgx/Character_Sheet/package.json');
const { chromium } = require('playwright');
const [base, out, imgPath, vidPath] = process.argv.slice(2);
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function newPage(theme) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript((t) => {
    // « dirty » : le choix part au serveur d'essai, qui ne le reprend pas au relevé suivant
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
  }, theme);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') log.push(`console ${theme}: ${m.text()}`); });
  page.on('pageerror', (e) => { log.push(`PAGEERROR ${theme}: ${e.message}`); fails++; });
  return { ctx, page };
}

// un fichier du disque déposé sur un nœud, comme le ferait l'explorateur
async function drop(page, sel, path, type) {
  const b64 = readFileSync(path).toString('base64');
  const dt = await page.evaluateHandle(({ b64, name, type }) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const d = new DataTransfer();
    d.items.add(new File([u], name, { type }));
    return d;
  }, { b64, name: basename(path), type });
  for (const ev of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent(sel, ev, { dataTransfer: dt });
}
const rows = (page) => page.$$eval('#side .prow[data-id]', (l) => l.map((r) => ({ id: r.dataset.id, a: r.classList.contains('selA'), b: r.classList.contains('selB'), txt: r.innerText })));
const zs = (page) => page.$$eval('#mon .zs', (l) => l.map((z) => z.style.transform));
const box = (page) => page.$eval('#mon', (m) => { const r = m.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
async function waitRows(page, n, what) {
  try { await page.waitForFunction((k) => document.querySelectorAll('#side .prow[data-id]').length >= k, n, { timeout: 60000 }); ok(true, what); }
  catch { ok(false, `${what} (${(await rows(page)).length} rangées)`); }
}
async function essai(page, n, what) {
  await page.waitForFunction(() => { const b = document.querySelector('#act .tb.go'); return b && !b.disabled; }, null, { timeout: 15000 }).catch(() => {});
  await page.click('#act .tb.go');
  await waitRows(page, n, what);
  await page.waitForTimeout(600);
}
// le zoom, la position : les mêmes pour A et B, et le point visé ne bouge pas
async function zoomChecks(page, tag) {
  const r = await box(page);
  const px = r.x + r.w * 0.62, py = r.y + r.h * 0.4;
  await page.mouse.move(px, py);
  const probe = () => page.evaluate(([x, y]) => {
    const z = document.querySelector('#mon .layer.a .zs'); const L = z.parentElement.getBoundingClientRect();
    const m = new DOMMatrix(getComputedStyle(z).transform === 'none' ? undefined : getComputedStyle(z).transform);
    const p = m.inverse().transformPoint(new DOMPoint(x - L.left, y - L.top));
    return [p.x / L.width, p.y / L.height];
  }, [px, py]);
  const before = await probe();
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(250);
  const t = await zs(page);
  const after = await probe();
  ok(t.length >= 1 && /scale\(/.test(t[0]) && t.every((x) => x === t[0]), `${tag} : molette = zoom, le même sur A et B (${t[0]})`);
  ok(Math.abs(before[0] - after[0]) < 0.004 && Math.abs(before[1] - after[1]) < 0.004, `${tag} : le point sous la souris ne bouge pas (${before.map((v) => v.toFixed(3))} → ${after.map((v) => v.toFixed(3))})`);
  const wipe0 = await page.$eval('#mon .layer.b', (l) => l.style.clipPath).catch(() => '');
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(px - 120, py - 60, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  const t2 = await zs(page);
  const wipe1 = await page.$eval('#mon .layer.b', (l) => l.style.clipPath).catch(() => '');
  ok(t2[0] !== t[0] && t2.every((x) => x === t2[0]), `${tag} : bouton du milieu = déplacer, lié (${t2[0]})`);
  ok(wipe0 === wipe1, `${tag} : le bouton du milieu ne bouge pas le rideau`);
  return t2[0];
}

async function wipeChecks(page, tag) {
  const r = await box(page);
  await page.mouse.move(r.x + r.w * 0.3, r.y + r.h * 0.7);
  await page.mouse.down();
  await page.mouse.move(r.x + r.w * 0.72, r.y + r.h * 0.7, { steps: 8 });
  await page.mouse.up();
  const c = await page.$eval('#mon .layer.b', (l) => l.style.clipPath);
  const m = /inset\(0(px)? 0(px)? 0(px)? ([\d.]+)%\)/.exec(c);
  ok(m && Math.abs(+m[4] - 72) < 1.5, `${tag} : le rideau suit la souris (${c})`);
}

// ── l'image ────────────────────────────────────────────────
const { ctx, page } = await newPage('dark');
await page.goto(`${base}/upscale/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#act .tb.go', { timeout: 15000 });
ok(!(await page.$('#mon .layer')), 'image : moniteur vide avant le dépôt');
ok(!(await page.isVisible('details.adv .advin')), 'réglages : « Paramètres avancés » fermé par défaut');
const txt0 = await page.innerText('#rail');
ok(!/SeedVR2|ESRGAN|Z-Image/i.test(txt0), 'réglages : aucun nom de modèle visible par défaut');
ok(/Upscale précis/.test(txt0) && /Upscale créatif/.test(txt0), 'réglages : « Upscale précis », « Upscale créatif »');
await drop(page, '#mon', imgPath, 'image/png');
await waitRows(page, 1, 'image : le dépôt ouvre sa pile (la source)');
await page.waitForSelector('#mon .layer.a img', { timeout: 15000 });
await page.waitForTimeout(500);
ok(!(await page.$('#mon .layer.b')), 'image : la source seule avant tout essai');
await zoomChecks(page, 'image, source seule');
await page.dblclick('#mon');
ok((await zs(page)).every((x) => x === ''), 'image : double-clic = ajuster');

await essai(page, 2, 'image : essai 1 (précis) empilé');
await page.click('.opt.preset:has-text("Upscale créatif")');
await page.waitForTimeout(300);
ok(await page.isVisible('#p-set .fixed'), 'image : « créatif » fixe la taille');
await essai(page, 3, 'image : essai 2 (créatif) empilé');
await page.waitForFunction(() => document.querySelectorAll('#mon .layer.b img').length === 1, null, { timeout: 15000 });
await page.click('#vtools .tb:has-text("Rideau")');   // la vue est une préférence : on la pose
let rs = await rows(page);
ok(rs[0].a && rs.at(-1).b, 'image : A = la source, B = le dernier essai');
ok(/Précis · ×2/.test(rs[1].txt) && /Créatif · affinée/.test(rs[2].txt), `image : chaque essai dit ses réglages (${rs[1].txt.split('\n')[1]} | ${rs[2].txt.split('\n')[1]})`);
await wipeChecks(page, 'image');
await zoomChecks(page, 'image A/B');
await page.screenshot({ path: `${out}/image-rideau-sombre.png` });
// comparer deux essais : essai 1 en A
await page.click(`#side .prow[data-id="${rs[1].id}"] .ab:has-text("A")`);
await page.waitForTimeout(400);
rs = await rows(page);
ok(rs[1].a && rs[2].b, 'image : deux essais comparés (A = essai 1, B = essai 2)');
ok((await zs(page)).every((x, i, l) => x === l[0] && x !== ''), 'image : le zoom tient quand on change A');
await page.click('#vtools .tb:has-text("Côte à côte")');
await page.waitForTimeout(300);
const r = await box(page);
await page.mouse.move(r.x + r.w * 0.8, r.y + r.h * 0.5);
await page.mouse.wheel(0, -300);
await page.waitForTimeout(200);
const ts = await zs(page);
ok(ts.length === 2 && ts[0] === ts[1], `image : côte à côte, zoom lié (${ts[0]})`);
const inA = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.layer.a'), [r.x + r.w * 0.4, r.y + r.h * 0.5]);
ok(inA, 'image : côte à côte, B agrandie ne déborde pas sur A');
await page.screenshot({ path: `${out}/image-cote-sombre.png` });
await page.click('#vtools .tb:has-text("Rideau")');
// retirer un essai (corbeille), l'annuler ; rejouer un essai
const menuOf = async (id, label) => {
  await page.click(`#side .prow[data-id="${id}"] .sr-kebab`);
  await page.click(`.sr-menu .mi:has-text("${label}")`);
};
await menuOf(rs[1].id, 'Retirer de la pile');
await page.waitForFunction(() => document.querySelectorAll('#side .prow[data-id]').length === 2, null, { timeout: 10000 }).catch(() => {});
ok((await rows(page)).length === 2, 'image : « Retirer de la pile » ôte l’essai');
await page.mouse.click(5, 990);
await page.keyboard.press('Control+z');
await page.waitForFunction(() => document.querySelectorAll('#side .prow[data-id]').length === 3, null, { timeout: 10000 }).catch(() => {});
ok((await rows(page)).length === 3, 'image : Ctrl+Z le remet dans la pile');
await menuOf((await rows(page))[1].id, 'Rejouer');
await waitRows(page, 4, 'image : « Rejouer » empile un nouvel essai');
rs = await rows(page);
ok(/Précis · ×2/.test(rs[3].txt), 'image : l’essai rejoué garde les réglages');
// un avancé touché : « Personnalisé »
await page.click('details.adv summary');
await page.click('.opt.preset:has-text("Upscale précis")');
await page.waitForTimeout(200);
await page.click('details.adv .opts.four .opt:has-text("Ondelettes")');
await page.waitForTimeout(300);
ok(await page.isVisible('.opt.preset.custom'), 'réglages : toucher un avancé passe en « Personnalisé »');
await page.screenshot({ path: `${out}/image-avances-sombre.png` });
const imgId = rs[0].id, imgTrial = rs[2].id;

// ── la vidéo ───────────────────────────────────────────────
await page.click('.opt.preset:has-text("Upscale précis")');
await drop(page, '#mon', vidPath, 'video/mp4');
await page.waitForFunction(() => document.querySelector('#mon .layer.a video'), null, { timeout: 30000 });
await waitRows(page, 1, 'vidéo : le dépôt ouvre sa pile');
ok(await page.$eval('.opt.preset:has-text("Upscale créatif")', (b) => b.classList.contains('off')), 'vidéo : « créatif » éteint, et dit pourquoi');
ok(/1080p/i.test(await page.innerText('#p-set .seg.sz')), 'vidéo : le média choisit ses tailles (1080p, 4K)');
await page.click('#p-set .seg.sz .tb:has-text("1080p")');
await page.waitForTimeout(400);
await essai(page, 2, 'vidéo : essai 1 (précis, 1080p) empilé');
await page.click('.opt.preset:has-text("Aperçu rapide")');
await page.click('#p-set .seg.sz .tb:has-text("×2")');
await essai(page, 3, 'vidéo : essai 2 (rapide ×2) empilé');
await page.waitForFunction(() => document.querySelectorAll('#mon .layer video').length === 2, null, { timeout: 30000 });
await page.click('#vtools .tb:has-text("Rideau")');
rs = await rows(page);
ok(/Précis · 1080p/.test(rs[1].txt) && /Rapide · ×2/.test(rs[2].txt), 'vidéo : chaque essai dit ses réglages');
await page.click('#transport .tb:has-text("Lire")');
await page.waitForTimeout(1500);
const sync = await page.$$eval('#mon video', (v) => v.map((x) => x.currentTime));
ok(sync.length === 2 && sync[0] > 0 && Math.abs(sync[0] - sync[1]) < 0.15, `vidéo : lecture synchronisée (${sync.map((t) => t.toFixed(2))})`);
await page.click('#transport .tb:has-text("Pause")');
await wipeChecks(page, 'vidéo');
await zoomChecks(page, 'vidéo A/B');
await page.screenshot({ path: `${out}/video-rideau-sombre.png` });
const vidId = rs[0].id, vidTrial = rs[2].id;
await ctx.close();

// ── le clair ───────────────────────────────────────────────
for (const [name, src, trial] of [['image', imgId, imgTrial], ['video', vidId, vidTrial]]) {
  const L = await newPage('light');
  await L.page.goto(`${base}/upscale/?src=${src}#${trial}`, { waitUntil: 'domcontentloaded' });
  await L.page.waitForSelector('#mon .layer.b', { timeout: 20000 });
  await L.page.waitForTimeout(1200);
  ok((await L.page.getAttribute('html', 'data-theme')) === 'light', `${name} : thème clair posé`);
  const lr = await box(L.page);
  await L.page.mouse.move(lr.x + lr.w * 0.55, lr.y + lr.h * 0.45);
  await L.page.mouse.wheel(0, -400);
  await L.page.waitForTimeout(400);
  await L.page.screenshot({ path: `${out}/${name}-rideau-clair.png` });
  await L.ctx.close();
}
await browser.close();
writeFileSync(`${out}/pilote.log`, log.join('\n') + '\n');
console.log(fails ? `${fails} en échec` : 'tout passe');
process.exit(fails ? 1 : 0);
