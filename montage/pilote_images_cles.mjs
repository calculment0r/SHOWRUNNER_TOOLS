// Le pilote des images clés du Montage (06/10, Cal : « on avance avec les images clés ») :
// Chromium sans affichage, un portail d'essai, jamais le portail en ligne.
//
//   node montage/pilote_images_cles.mjs http://127.0.0.1:8844 /tmp/sr_cles
//   SR_PLAYWRIGHT=/opt/node22/lib/node_modules/playwright node montage/pilote_images_cles.mjs …   (une session cloud)
//
// Une vidéo VP9 numérotée (ffmpeg), une séquence 640 × 360. Dans l'inspecteur : le chronomètre de
// la Position pose une clé à la tête ; ailleurs, une valeur tapée pose une clé là ; le moniteur
// suit à l'arrêt (le centre de l'image au pourcentage près) et pendant la lecture ; ‹ › mènent
// d'une clé à l'autre ; le clic droit sur un losange lisse le segment ; un geste au moniteur pose
// une clé à la tête ; Ctrl+Z défait chaque geste ; rogner le début et déplacer le plan gardent les
// clés sur la matière ; éteindre le chronomètre garde la valeur qui se voit. Les losanges sur le
// plan de la timeline. Sombre, puis clair ; aucune erreur de console. Rend 0 si tout passe ; le
// détail dans <out>/pilote_images_cles.log.
import { createRequire } from 'module';
import { writeFileSync, mkdirSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

const require = createRequire('/home/dgx/Character_Sheet/package.json');
const { chromium } = require(process.env.SR_PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };
const J = (x) => JSON.stringify(x);
const near = (a, b, t) => Math.abs(a - b) <= t;

const tmp = mkdtempSync(join(tmpdir(), 'sr_cles_'));
execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=640x360:r=25:d=8',
  '-vf', "format=gbrp,geq=r='if(lt(X,160)*lt(Y,160),mod(N,16)*16+8,90)':g='if(lt(X,160)*lt(Y,160),floor(N/16)*16+8,90)':b='if(lt(X,160)*lt(Y,160),128,200)'",
  '-c:v', 'libvpx-vp9', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8', '-g', '1', '-pix_fmt', 'yuv420p', join(tmp, 'cles.webm')]);
const VID = await (await fetch(`${base}/api/library/upload?name=cles.webm&tool=montage&title=cles`, { method: 'PUT', headers: { 'Content-Type': 'video/webm' }, body: readFileSync(join(tmp, 'cles.webm')) })).json();
rmSync(tmp, { recursive: true, force: true });
ok(VID.kind === 'video', `la vidéo d'essai est déposée (${VID.id})`);
async function sequence(name) {
  const r = await fetch(`${base}/api/montage/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: J({ name, settings: { format: 'custom', width: 640, height: 360, fps: 25 } }) });
  const p = await r.json();
  const clips = [{ id: 'kv', track: 'V1', item: VID.id, kind: 'video', title: 'clés', start: 0, dur: 100, in: 0, src_dur: VID.duration, audio: false }];
  await fetch(`${base}/api/montage/projects/${p.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: J({ ...p, clips, base_rev: p.rev }) });
  return p.id;
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const errs = [];
let page = null;
async function open(seq, theme) {
  if (page) await page.context().close();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ } }, theme);
  page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errs.push(`${theme} : ${m.text()}`); });
  page.on('pageerror', (e) => errs.push(`${theme} PAGEERROR : ${e.message}`));
  await page.goto(`${base}/montage/#${seq}`);
  await page.waitForSelector('.clip[data-id="kv"]', { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.click('.clip[data-id="kv"] .body', { position: { x: 80, y: 18 } });
  await page.waitForSelector('.card.traj .kgrp[data-k="pos"]');
}
const tete = async (f) => { await page.evaluate((f) => window.montage.program.seekFrame(f), f); await page.waitForTimeout(250); };
const cles = (gid = 'pos') => page.evaluate((g) => { const c = window.montage.S.p.clips.find((x) => x.id === 'kv'); return (c.motion && c.motion.keys && c.motion.keys[g]) || null; }, gid);
const clip = () => page.evaluate(() => { const c = window.montage.S.p.clips.find((x) => x.id === 'kv'); return { start: c.start, dur: c.dur, in: c.in, x: c.motion ? c.motion.x : 0.5 }; });
// le centre de l'image au moniteur, en fraction du cadre (le style posé par player.js, `poser`)
const centre = () => page.evaluate(() => {
  const v = [...document.querySelectorAll('#stage video')].find((m) => Number(getComputedStyle(m).opacity) > 0.01) || document.querySelector('#stage video');
  const L = parseFloat(v.style.left), W = parseFloat(v.style.width);
  return { x: (L + W / 2) / 100, f: window.montage.program.frame() };
});
const champ = (label) => page.locator(`.card.traj .slider.reg:has(span:text-is("${label}")) input.nfld`);
const annuler = async () => { await page.keyboard.press('Control+z'); await page.waitForTimeout(350); };
const xAt = (keys, f, start = 0) => {          // la règle de model.js (keysAt), pour la position x
  const k = f - start;
  if (k <= keys[0][0]) return keys[0][1][0];
  if (k >= keys.at(-1)[0]) return keys.at(-1)[1][0];
  let i = 0; while (keys[i + 1][0] <= k) i++;
  let u = (k - keys[i][0]) / (keys[i + 1][0] - keys[i][0]); if (keys[i][2] === 1) u = u * u * (3 - 2 * u);
  return keys[i][1][0] + (keys[i + 1][1][0] - keys[i][1][0]) * u;
};

// ── sombre ─────────────────────────────────────────────────
await open(await sequence('images clés'), 'dark');
await tete(10);
await page.click('.kgrp[data-k="pos"] .kchrono');
await page.waitForTimeout(300);
let k = await cles();
ok(J(k) === J([[10, [0.5, 0.5]]]) && await page.$eval('.kgrp[data-k="pos"] .kchrono', (b) => b.classList.contains('on')),
  `le chronomètre de la Position : une clé à la tête de lecture (10), la valeur qui se voit (${J(k)})`);
await tete(60);
await champ('position x').fill('480');
await champ('position x').press('Enter');
await page.waitForTimeout(300);
k = await cles();
ok(J(k) === J([[10, [0.5, 0.5]], [60, [0.75, 0.5]]]), `une valeur tapée ailleurs (60) pose une clé là (${J(k)})`);
await tete(35);
let cc = await centre();
ok(near(cc.x, 0.625, 0.002), `à l'image 35, le moniteur pose l'image entre les deux clés (centre ${cc.x.toFixed(4)}, attendu 0,625)`);
ok(await champ('position x').inputValue() === '400', `l'inspecteur lit la valeur animée à la tête (${await champ('position x').inputValue()} px)`);
ok(await page.$$eval('.clip[data-id="kv"] .kf', (l) => l.length) === 2 && await page.$$eval('.kgrp[data-k="pos"] .kd', (l) => l.length) === 2,
  'deux losanges sur le plan de la timeline, deux dans la piste de la Position');
await page.click('.kgrp[data-k="pos"] .knav[title="clé précédente"]');
await page.waitForTimeout(250);
const f1 = await page.evaluate(() => window.montage.program.frame());
await page.click('.kgrp[data-k="pos"] .knav[title="clé suivante"]');
await page.waitForTimeout(250);
const f2 = await page.evaluate(() => window.montage.program.frame());
ok(f1 === 10 && f2 === 60, `‹ et › : de 35 à la clé 10, puis à la clé 60 (${f1}, ${f2})`);
await page.click('.kgrp[data-k="pos"] .kd', { button: 'right' });
await page.click('text=Lissée (vers la clé suivante)');
await page.waitForTimeout(300);
k = await cles();
await tete(22);
cc = await centre();
ok(k[0][2] === 1 && near(cc.x, xAt(k, 22), 0.002) && !near(cc.x, 0.56, 0.01), `clic droit, « Lissée » : le segment accélère puis ralentit (à 22 : ${cc.x.toFixed(4)}, lissé ${xAt(k, 22).toFixed(4)}, linéaire 0,56)`);
// pendant la lecture, l'image suit les clés
await tete(0);
await page.evaluate(() => window.montage.program.play(1));
const lus = [];
for (let i = 0; i < 6; i++) { await page.waitForTimeout(180); lus.push(await centre()); }
await page.evaluate(() => window.montage.program.pause());
ok(lus.filter((x) => x.f > 0).length >= 4 && lus.every((x) => [x.f - 1, x.f, x.f + 1].some((f) => near(x.x, xAt(k, f), 0.003))),
  `pendant la lecture, le moniteur suit les clés (${J(lus.map((x) => [x.f, +x.x.toFixed(3)]))})`);
// un geste au moniteur, chronomètre actif : une clé à la tête
await tete(80);
const st = await page.$eval('#stage', (n) => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
cc = await centre();
await page.mouse.move(st.x + cc.x * st.w, st.y + st.h * 0.75);
await page.mouse.down();
await page.mouse.move(st.x + cc.x * st.w - st.w * 0.1, st.y + st.h * 0.75, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
k = await cles();
ok(k.length === 3 && k[2][0] === 80 && near(k[2][1][0], 0.65, 0.01), `un geste au moniteur à l'image 80 pose une clé là (${J(k[2])})`);
await annuler();
ok((await cles()).length === 2, 'Ctrl+Z retire la clé du geste');
// rogner le début, déplacer : les clés gardent leur place sur la matière
await tete(35);
const x35 = (await centre()).x;
const g = await page.$eval('.clip[data-id="kv"]', (n) => { const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, h: r.height, w: r.width }; });
const pps = await page.evaluate(() => window.montage.timeline.pps);
await page.mouse.move(g.l + 2, g.t + g.h / 2); await page.mouse.down();
await page.mouse.move(g.l + 2 + 5 * pps / 25, g.t + g.h / 2, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(400);
let c = await clip();
k = await cles();
await tete(35);
ok(c.start === 5 && J(k.map((e) => e[0])) === J([5, 55]) && near((await centre()).x, x35, 0.0005),
  `rogner le début de 5 : les clés reculent d'autant dans le plan (5, 55), elles gardent leur place dans la timeline ; à 35, la même place (${J(k.map((e) => e[0]))})`);
const g2 = await page.$eval('.clip[data-id="kv"]', (n) => { const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, h: r.height, w: r.width }; });
await page.mouse.move(g2.l + g2.w / 2, g2.t + 8); await page.mouse.down();
await page.mouse.move(g2.l + g2.w / 2 + 20 * pps / 25, g2.t + 8, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(400);
c = await clip();
await tete(55);
ok(c.start === 25 && J((await cles()).map((e) => e[0])) === J([5, 55]) && near((await centre()).x, x35, 0.0005),
  `déplacer le plan de 20 : ses clés le suivent ; à 55, la place qu'il avait à 35 (début ${c.start})`);
await annuler(); await annuler();
c = await clip();
ok(c.start === 0 && J((await cles()).map((e) => e[0])) === J([10, 60]), 'deux Ctrl+Z : le plan et ses clés reviennent');
// éteindre le chronomètre : la valeur qui se voit reste
await tete(35);
const avant = (await centre()).x;
await page.click('.kgrp[data-k="pos"] .kchrono');
await page.waitForTimeout(300);
c = await clip();
ok(!(await cles()) && near(c.x, avant, 1e-6) && near((await centre()).x, avant, 0.0005), `éteindre le chronomètre : plus de clé, la valeur de l'image 35 reste (${c.x})`);
await annuler();
ok((await cles()).length === 2, 'Ctrl+Z rallume le chronomètre et ses clés');
await page.screenshot({ path: `${out}/images-cles-sombre.png` });

// ── clair ──────────────────────────────────────────────────
const s2 = await sequence('images clés clair');
await open(s2, 'light');
await tete(0);
await page.click('.kgrp[data-k="op"] .kchrono');
await tete(50);
await champ('opacité').fill('20');
await champ('opacité').press('Enter');
await page.waitForTimeout(300);
const ko = await cles('op');
await tete(25);
const opv = await page.evaluate(() => Number([...document.querySelectorAll('#stage video')].find((m) => Number(getComputedStyle(m).opacity) > 0.01)?.style.opacity));
ok(J(ko) === J([[0, [1]], [50, [0.2]]]) && near(opv, 0.6, 0.01), `clair : l'opacité animée (1 → 0,2), à 25 le moniteur montre 0,6 (${opv})`);
ok(await page.evaluate(() => document.documentElement.dataset.theme === 'light'), 'clair : le thème clair est posé');
await page.screenshot({ path: `${out}/images-cles-clair.png` });
ok(await page.$$eval('.tb.go', (l) => l.filter((b) => b.offsetParent).length) <= 1, 'un seul bouton orange à l’écran');

ok(!errs.length, `aucune erreur de console (${J(errs.slice(0, 4))})`);
await browser.close();
writeFileSync(`${out}/pilote_images_cles.log`, log.join('\n') + '\n');
console.log(`\n${log.length - fails} passés, ${fails} en échec`);
process.exit(fails ? 1 : 0);
