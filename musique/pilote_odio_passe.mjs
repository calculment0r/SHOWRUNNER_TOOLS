// Le pilote de la grande passe d'ODIO (09/10 ; docs/etudes/musique.md, « Fait le 09/10 — la grande
// passe ») : un portail d'essai en moteurs factices (tools/portail_essai.py, des données jetables),
// jamais le portail en ligne. Chaque correction de la passe y a son essai, mesuré dans la page.
//
//   node musique/pilote_odio_passe.mjs http://127.0.0.1:8931 /tmp/sr_odio-passe/shots
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright/package.json CHROMIUM=/opt/pw-browsers/chromium node …   (une session cloud)
//
// Les essais : la Session (un clip de notes lancé s'entend, « Arrêter tous les clips » l'arrête).
// Captures en sombre et en clair. Rend 0 si tout passe.
import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';

const require = createRequire(process.env.PLAYWRIGHT || '/home/dgx/Character_Sheet/package.json');
const { chromium } = require('playwright');
const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'] });

async function newPage(theme, viewport = { width: 1600, height: 1000 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
  }, theme);
  const page = await ctx.newPage();
  // une ressource d'ailleurs qui ne charge pas (Google Fonts, bloqué dans un conteneur) se note sans compter
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const away = /^Failed to load resource/.test(m.text()) && !(m.location()?.url || '').startsWith(base);
    log.push(`console ${theme}: ${m.text()} ${m.location()?.url || ''}`);
    if (!away) { fails++; console.log(log.at(-1)); }
  });
  page.on('pageerror', (e) => { log.push(`PAGEERROR ${theme}: ${e.message}`); fails++; console.log(log.at(-1)); });
  return { ctx, page };
}
const shot = async (page, name) => { await page.waitForTimeout(300); await page.screenshot({ path: `${out}/${name}.png`, fullPage: false }); };
const api = (page, path, body = null, method = null) => page.evaluate(async ([p, b, m]) => {
  const r = await fetch(`/api/${p}`, b ? { method: m || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : { method: m || 'GET' });
  return r.json();
}, [path, body, method]);
// un projet neuf (le départ « Session » de la maquette), ouvert
async function ouvrir(page, name, template = 'session') {
  await page.goto(`${base}/musique/`, { waitUntil: 'networkidle' });
  const p = await api(page, 'music/projects', { name, template });
  await page.goto(`${base}/musique/?p=${p.id}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__mu?.S?.proj, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  return p.id;
}
// le niveau de la sortie (dBFS crête, gauche ou droite), relevé toutes les 50 ms
const niveaux = (page, n) => page.evaluate(async (n) => {
  const { engine, app } = window.__mu;
  const lv = [];
  for (let i = 0; i < n; i++) { await new Promise((r) => setTimeout(r, 50)); lv.push(Math.max(...engine.levelLR(app.master().id))); }
  return lv;
}, n);

for (const theme of ['dark', 'light']) {
  const { ctx, page } = await newPage(theme);

  // ── la Session : un clip de notes lancé s'entend ; « Arrêter tous les clips » l'arrête ──
  // (09/10 : le paramètre de Graph.scheduleSession masquait la fonction `joue` de moteur.js :
  // chaque réveil jetait, la Session restait muette et « Arrêter tous les clips » ne venait jamais)
  await ouvrir(page, `Passe Session ${theme}`);
  await page.evaluate(() => window.__mu.app.setView('console'));
  await page.waitForTimeout(400);
  await page.click('text=+ Voie synthé');
  await page.waitForTimeout(400);
  await page.dblclick('.ss-c[data-s="sc1"]');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const { S, app } = window.__mu;
    for (const t of S.proj.tracks) t.mute = true;   // l'arrangement muet : seule la Session sonne
    const p = app.pat(S.proj.slots[0].pat);
    p.notes = [0, 4, 8, 12].map((s, i) => ({ s, l: 3, p: 60 + [0, 3, 7, 10][i], v: 0.9 }));
    app.commit('data');
  });
  await page.click('.ss-c[data-s="sc1"] button');
  const lv = await niveaux(page, 40);
  const fin = lv.filter(Number.isFinite);
  const ab = await page.evaluate(() => window.__mu.engine.play?.ab || 0);
  ok(fin.length && Math.max(...fin) > -30 && lv.filter((x) => !(x > -60)).length === 0 && ab > 2,
    `${theme} · Session : le clip de notes lancé s'entend (crête ${Math.max(...fin, -999).toFixed(1)} dBFS, ${lv.filter((x) => !(x > -60)).length} silences sur ${lv.length}, horloge planifiée ${ab.toFixed(2)})`);
  await shot(page, `session_joue_${theme}`);
  await page.click('.ss-all');
  await page.waitForTimeout(2800);   // une mesure à 112 BPM : 2,14 s
  const sess = await page.evaluate(() => ({ joue: window.__mu.engine.sess.joue.size, file: window.__mu.engine.sess.file.length }));
  ok(sess.joue === 0 && sess.file === 0, `${theme} · Session : « Arrêter tous les clips » arrête à la mesure (${JSON.stringify(sess)})`);
  await page.keyboard.press('Space');

  // ── l'arrangement : un clip posé l'emporte sur ce qu'il recouvre de sa piste ──
  // (09/10 : collé, glissé, copié par Ctrl, il s'y superposait et le moteur jouait les deux)
  await ouvrir(page, `Passe Recouvrement ${theme}`);
  const basse = () => page.evaluate(() => window.__mu.S.proj.clips.filter((c) => c.track === 't2').map((c) => [c.id, c.start, c.len]).sort((a, b) => a[1] - b[1]));
  const sonnent = (a, b) => page.evaluate(([a, b]) => window.__mu.S.proj.clips.filter((c) => c.track === 't2' && !c.mute && c.start < b && c.start + c.len > a).length, [a, b]);
  const avant = await basse();
  const titre = async (id) => page.$eval(`.clip[data-id="${id}"] .ch`, (n) => { const r = n.getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; });
  const ppb = await page.evaluate(() => window.__mu.S.proj.ui.ppb || 83 / 4);
  let t0 = await titre(avant[0][0]);
  await page.mouse.move(t0.x, t0.y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(t0.x + i * ppb, t0.y);
  await page.mouse.up();
  await page.waitForTimeout(300);
  let apres = await basse();
  ok(JSON.stringify(apres) === JSON.stringify([[avant[0][0], 24, 16], [avant[1][0], 40, 8], [avant[2][0], 48, 16]]) && await sonnent(32, 40) === 1,
    `${theme} · le couplet de la basse glissé de 8 temps rogne le refrain par le début, un seul clip sonne entre 32 et 40 (${JSON.stringify(apres)})`);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  ok(JSON.stringify(await basse()) === JSON.stringify(avant), `${theme} · un seul Ctrl+Z rend les deux clips (${JSON.stringify(await basse())})`);
  // copier le couplet, le coller au temps 40 : il coupe le refrain autour de lui
  t0 = await titre(avant[0][0]);
  await page.mouse.click(t0.x, t0.y);
  await page.keyboard.press('Control+c');
  await page.evaluate(() => window.__mu.engine.seek(36));
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(400);
  apres = await basse();
  ok(apres.length === 4 && JSON.stringify(apres.map((c) => [c[1], c[2]])) === JSON.stringify([[16, 16], [32, 4], [36, 16], [52, 12]]) && await sonnent(36, 52) === 1,
    `${theme} · collé à 36, le couplet coupe le refrain et rogne le final ; un seul clip sonne de 36 à 52 (${JSON.stringify(apres)})`);
  await shot(page, `recouvrement_colle_${theme}`);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  ok(JSON.stringify(await basse()) === JSON.stringify(avant), `${theme} · Ctrl+Z rend le refrain et le final entiers`);
  // la prise n'efface rien : les clips qu'elle recouvre deviennent muets et restent
  await page.evaluate(() => { const { S, app } = window.__mu; S.proj.tracks[1].arm = true; app.selectTrack('t2'); app.commit('quiet'); window.__mu.engine.seek(32); });
  await page.keyboard.press('F9');
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  for (const k of ['KeyA', 'KeyD', 'KeyG']) { await page.keyboard.down(k); await page.waitForTimeout(150); await page.keyboard.up(k); await page.waitForTimeout(80); }
  await page.keyboard.press('Space');
  await page.keyboard.press('F9');
  await page.waitForTimeout(600);
  const prise = await page.evaluate(() => window.__mu.S.proj.clips.filter((c) => c.track === 't2').map((c) => [c.start, c.len, !!c.mute, c.name || '']).sort((a, b) => a[0] - b[0]));
  ok(prise.some((c) => c[3] === 'Nouveau') && prise.some((c) => c[0] === 32 && c[1] === 16 && c[2]),
    `${theme} · la prise se pose, le refrain qu'elle recouvre reste entier et muet (${JSON.stringify(prise)})`);
  await ctx.close();
}

await browser.close();
writeFileSync(`${out}/journal.txt`, log.join('\n') + '\n');
console.log(fails ? `${fails} échec(s)` : 'tout passe');
process.exit(fails ? 1 : 0);
