// Le pilote de la grande passe d'ODIO (09/10 ; docs/etudes/musique.md, « Fait le 09/10 — la grande
// passe ») : un portail d'essai en moteurs factices (tools/portail_essai.py, des données jetables),
// jamais le portail en ligne. Chaque correction de la passe y a son essai, mesuré dans la page.
//
//   node musique/pilote_odio_passe.mjs http://127.0.0.1:8931 /tmp/sr_odio-passe/shots
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright/package.json CHROMIUM=/opt/pw-browsers/chromium node …   (une session cloud)
//
// Les essais : la Session (un clip de notes lancé s'entend, « Arrêter tous les clips » l'arrête) ;
// l'arrangement (un clip glissé ou collé l'emporte sur ce qu'il recouvre, un seul Ctrl+Z, la prise
// n'efface rien) ; le piano roll (Ctrl+C, X, V : des notes, jamais le clip ; Échap).
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

  // ── suivre la tête : la vue la suit, sauf quand on défile soi-même pendant la lecture ──
  // (09/10 : elle revenait à la tête à chaque image, impossible de regarder plus loin)
  await page.evaluate(() => { const { S, app, engine } = window.__mu; S.proj.ui.ppb = 60; app.renderView(); engine.seek(0); });
  await page.waitForTimeout(400);
  const sl = () => page.evaluate(() => document.querySelector('.ar-scroll').scrollLeft);
  const bord = await page.evaluate(() => { const s = document.querySelector('.ar-scroll'); return (s.scrollLeft + s.clientWidth - 224) / 60; });
  await page.evaluate((b) => window.__mu.engine.seek(b), Math.max(0, bord - 1.2));
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  const s1 = await sl();
  ok(s1 > 0, `${theme} · suivre : la tête arrive au bord droit, la vue la suit (défilement ${s1.toFixed(0)} px)`);
  // sur la voie de la basse, dans la part visible de l'arrangement (la voie commence au temps 0, hors de la vue)
  const voie = await page.evaluate(() => { const v = document.querySelector('.ar-scroll').getBoundingClientRect(), l = document.querySelector('.ar-lane[data-track="t2"]').getBoundingClientRect(); return { x: v.x + 224 + 300, y: l.y + 20 }; });
  await page.mouse.move(voie.x, voie.y);
  await page.keyboard.down('Shift');
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 400);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(150);
  const s2 = await sl();
  await page.waitForTimeout(900);
  const s3 = await sl();
  ok(s2 > s1 + 800 && Math.abs(s3 - s2) < 2, `${theme} · suivre : Maj+molette pendant la lecture — la vue reste où on l'a mise (${s2.toFixed(0)} → ${s3.toFixed(0)} px)`);
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  const s4 = await sl();
  ok(s4 < s2 - 400, `${theme} · suivre : la lecture suivante ramène la vue à la tête (${s4.toFixed(0)} px)`);
  await page.keyboard.press('Space');

  // ── le piano roll : Ctrl+C, X, V copient, coupent, collent des NOTES ──
  // (09/10 : ces touches allaient à l'arrangement, Ctrl+V y collait le clip à la tête de lecture)
  await ouvrir(page, `Passe Notes ${theme}`);
  await page.evaluate(() => { const { S, app } = window.__mu; const c = S.proj.clips.find((x) => x.track === 't4'); app.selectClips([c.id], true); app.showDetail('clip'); window.__mu.engine.seek(0); });
  await page.waitForTimeout(700);
  const etatPR = () => page.evaluate(() => { const { S, app } = window.__mu; const c = app.clip(S.sel.clip); const p = c && app.pat(c.pat); return { clips: S.proj.clips.length, notes: p?.notes.length, choisies: document.querySelectorAll('.pr-n.sel').length, deux: p?.notes.filter((n) => n.s >= 32).map((n) => [n.s, n.p]).sort((a, b) => a[0] - b[0]) }; });
  const pr0 = await etatPR();
  // choisir les notes du premier temps fort (pas 0 à 8) par Maj+glisser
  // la part visible de la grille (elle défile chez elle : le cadre se tire dedans)
  const aire = await page.$eval('.pr-area', (n) => {
    const r = n.getBoundingClientRect(), v = n.closest('.pr').getBoundingClientRect();
    const y0 = Math.max(r.top, v.top), y1 = Math.min(r.bottom, v.bottom);
    return { x: r.x, y: y0, w: r.width, h: y1 - y0 };
  });
  const n0 = await page.$eval('.pr-n', (n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2 }; });
  await page.mouse.click(n0.x + 2, n0.y);                       // une note choisie, le panneau a la main
  await page.keyboard.press('Control+a');
  const total = (await etatPR()).choisies;
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(400);
  const pr1 = await etatPR();
  ok(pr1.clips === pr0.clips && pr1.choisies === total && pr1.notes === pr0.notes,
    `${theme} · piano roll : Ctrl+A, Ctrl+C, Ctrl+V — à la suite des ${total} notes, rien ne tient (le motif est plein) : rien ne change, et aucun clip n'est collé dans l'arrangement (${JSON.stringify({ avant: pr0.clips, apres: pr1.clips, notes: pr1.notes })})`);
  // couper la moitié, la coller à la tête de lecture posée dans le clip (mesure 11 = temps 40 : pas 32 du motif)
  await page.keyboard.press('Escape');
  ok((await etatPR()).choisies === 0 && await page.evaluate(() => !!window.__mu.S.sel.clip), `${theme} · piano roll : Échap ne choisit plus aucune note, le clip reste ouvert`);
  await page.keyboard.down('Shift');
  await page.mouse.move(aire.x + 1, aire.y + 1); await page.mouse.down();
  await page.mouse.move(aire.x + aire.w / 2 - 2, aire.y + aire.h - 2, { steps: 6 }); await page.mouse.up();
  await page.keyboard.up('Shift');
  const moitie = (await etatPR()).choisies;
  await page.keyboard.press('Control+x');
  await page.waitForTimeout(300);
  const pr2 = await etatPR();
  await page.evaluate(() => window.__mu.engine.seek(40));
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(400);
  const pr3 = await etatPR();
  ok(moitie > 0 && pr2.notes === pr0.notes - moitie && pr3.notes >= pr2.notes && pr3.choisies === moitie && pr3.clips === pr0.clips,
    `${theme} · piano roll : Ctrl+X coupe ${moitie} notes, Ctrl+V les colle à la tête de lecture (temps 40, pas 32 du motif) (${JSON.stringify({ coupe: pr2.notes, colle: pr3.notes, a32: pr3.deux?.slice(0, 4) })})`);
  await shot(page, `pianoroll_colle_${theme}`);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  const pr4 = await page.evaluate(() => { const { S, app } = window.__mu; const c = S.proj.clips.find((x) => x.track === 't4'); return app.pat(c.pat).notes.length; });
  ok(pr4 === pr0.notes, `${theme} · piano roll : deux Ctrl+Z rendent le motif d'origine (${pr4} notes)`);

  // ── un clic juste après une saisie n'est plus perdu ──
  // (09/10 : le champ qui perd la main enregistrait, la vue se redessinait entre l'appui et le
  // relâché, le bouton pressé était remplacé : son clic ne venait pas)
  await ouvrir(page, `Passe Clic ${theme}`);
  await page.dblclick('.ar-head[data-track="t2"] .nm');
  await page.waitForTimeout(200);
  await page.keyboard.type('Basse bis');
  await page.click('.ar-head[data-track="t3"] button[title="solo"]');
  await page.waitForTimeout(400);
  const pistes = await page.evaluate(() => window.__mu.S.proj.tracks.slice(1, 3).map((t) => [t.name, t.solo]));
  ok(JSON.stringify(pistes) === JSON.stringify([['Basse bis', false], ['Nappe', true]]),
    `${theme} · renommer la Basse puis cliquer S sur la Nappe : le nom est pris ET la Nappe passe en solo (${JSON.stringify(pistes)})`);
  // le panneau Générer : taper le style, puis « Générer » — le premier clic part
  await page.click('button:has-text("Générer")');
  await page.waitForTimeout(1200);
  await page.click('.gp-dr .gp-tiles :text("Un instrument seul")');
  await page.waitForTimeout(400);
  await page.fill('.gp-dr textarea.gp-style', 'warm analog bass');
  await page.click('#gp-go');
  await page.waitForTimeout(300);
  const envoi = await page.$eval('#gp-go', (b) => [b.textContent, b.disabled]);
  await page.waitForFunction(() => window.__mu.S.proj.pending.length || window.__mu.S.proj.clips.some((c) => c.gen?.takes?.length), null, { timeout: 30000 }).catch(() => {});
  const gen = await page.evaluate(() => ({ attente: window.__mu.S.proj.pending.length, regions: window.__mu.S.proj.clips.filter((c) => c.gen).length }));
  ok(envoi[1] === true && gen.regions === 1,
    `${theme} · Générer : le style tapé, le PREMIER clic part (« ${envoi[0]} », désactivé pendant l'envoi ; ${gen.regions} région, ${gen.attente} travail en file)`);
  await shot(page, `generer_envoi_${theme}`);
  await ctx.close();
}

await browser.close();
writeFileSync(`${out}/journal.txt`, log.join('\n') + '\n');
console.log(fails ? `${fails} échec(s)` : 'tout passe');
process.exit(fails ? 1 : 0);
