// Le pilote des Spaces de l'app Musique (chanson/spaces.js) : un portail
// d'essai en moteurs factices (tools/portail_essai.py), jamais le portail en ligne.
//
//   node chanson/pilote_spaces.mjs http://127.0.0.1:8805 /tmp/sr_spaces/shots
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright/package.json node …   (une session cloud)
//
// Le parcours : « Mon Space » par défaut → une chanson → « + Nouveau Space » (il
// devient le Space courant) → une chanson y naît → la scène ne montre que lui →
// « Tous les Spaces » (la pastille sur chaque carte) → une variante reste dans le
// Space de sa chanson → Ctrl+clic, Maj+clic, « Déplacer vers… », Ctrl+Z → glisser
// une carte sur un Space du menu ouvert → importer un son → archiver (Créer dit
// pourquoi), rouvrir → le Space retenu au rechargement → supprimer (S2 : retour dans
// « Mon Space »), Ctrl+Z. Le contrat : spaceCourant() et `sr:music-space`. Captures
// en sombre et en clair, à 1440 px et en mobile. Rend 0 si tout passe.
import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';

const require = createRequire(process.env.PLAYWRIGHT || '/home/dgx/Character_Sheet/package.json');
const { chromium } = require('playwright');
const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });

async function newPage(theme, viewport = { width: 1440, height: 900 }, mobile = false) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
  }, theme);
  const page = await ctx.newPage();
  // une ressource d'ailleurs qui ne charge pas (Google Fonts, bloqué dans un conteneur) se note sans compter
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const away = /^Failed to load resource/.test(m.text()) && !(m.location()?.url || '').startsWith(base);
    log.push(`console ${theme}: ${m.text()} ${m.location()?.url || ''}`);
    if (!away) fails++;
  });
  page.on('pageerror', (e) => { log.push(`PAGEERROR ${theme}: ${e.message}`); fails++; });
  return { ctx, page };
}
const shot = async (page, name) => { await page.waitForTimeout(300); await page.screenshot({ path: `${out}/${name}.png`, fullPage: false }); };
const cards = (page) => page.$$eval('#ch-list .ch-song', (l) => l.map((c) => ({ id: c.dataset.id, t: c.querySelector('.ch-tx b').textContent,
  meta: c.querySelector('.ch-meta').textContent, sel: c.classList.contains('sel'), tag: c.querySelector('.ch-sp-tag')?.textContent || '' })));
const nCards = async (page) => (await cards(page)).length;
async function waitCards(page, n, what, timeout = 90000) {
  try { await page.waitForFunction((k) => document.querySelectorAll('#ch-list .ch-song').length === k, n, { timeout }); ok(true, what); }
  catch { ok(false, `${what} (${await nCards(page)} cartes)`); }
}
const item = (page, id) => page.evaluate((x) => fetch(`../api/library/${x}`).then((r) => r.json()), id);
const spaceBtn = (page) => page.textContent('#ch-space-btn b');
async function openMenu(page) { if (!(await page.$('.ch-spmenu'))) await page.click('#ch-space-btn'); await page.waitForSelector('.ch-spmenu'); }
async function chooseSpace(page, label) {
  await openMenu(page);
  await page.click(`.ch-spmenu .mi:has(.lb:text-is("${label}"))`);
  await page.waitForTimeout(400);
}
async function createSong(page, prompt) {
  await page.fill('#ch-prompt', prompt);
  await page.click('#ch-create');
}

// ── le parcours, en sombre à 1440 px ────────────────────────
const { ctx, page } = await newPage('dark');
await page.addInitScript(() => { window.__msp = []; addEventListener('sr:music-space', (e) => window.__msp.push(e.detail)); });
await page.goto(`${base}/chanson/`, { waitUntil: 'networkidle' });
await page.waitForSelector('#ch-space-btn');
ok((await spaceBtn(page)) === 'Mon Space', 'par défaut : « Mon Space », en haut du rail');
ok(await page.$eval('#rail', (r) => r.firstElementChild?.id === 'ch-space'), 'le Space est la première chose du rail');
ok((await page.$$('.tb.go')).length === 1, 'un seul bouton orange');
let cur = await page.evaluate(() => import('./spaces.js').then((m) => m.spaceCourant()));
ok(cur.id === 'mon' && cur.music_space === '' && cur.vue === 'mon' && cur.workspace, `le contrat : spaceCourant() (${JSON.stringify(cur)})`);
ok((await page.evaluate(() => window.__msp.length)) >= 1, 'le contrat : sr:music-space au démarrage');

// une chanson dans « Mon Space » (Rapide, instrumental : rien à relire, pas de paroles)
await page.click('#ch-presets [data-preset="rapide"]');
await page.click('#ch-vocal .tb:has-text("Instrumental")');
await page.click('#ch-dur .tb:has-text("30 s")');
await createSong(page, 'lofi chill, rhodes piano, 80 BPM');
await waitCards(page, 1, '« Mon Space » : une chanson');
const m1 = (await cards(page))[0];
ok(!('music_space' in await item(page, m1.id)), 'sa naissance : pas de champ, « Mon Space »');

// « + Nouveau Space » : il devient le Space courant, la scène est vide
await openMenu(page);
await shot(page, '01-menu-mon-space-sombre');
await page.click('.ch-spmenu .mi:has-text("+ Nouveau Space")');
await page.waitForSelector('.fl-ask input');
await page.fill('.fl-ask input', 'Album été');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelector('#ch-space-btn b')?.textContent === 'Album été', null, { timeout: 8000 }).catch(() => {});
ok((await spaceBtn(page)) === 'Album été', 'nouveau Space : il devient le Space courant');
await waitCards(page, 0, 'nouveau Space : la scène est vide', 8000);
cur = await page.evaluate(() => import('./spaces.js').then((m) => m.spaceCourant()));
const albumId = cur.music_space;
ok(/^msp-[0-9a-f]{12}$/.test(albumId) && cur.name === 'Album été' && (await page.evaluate(() => window.__msp.at(-1)?.music_space)) === albumId,
  `le contrat : spaceCourant() et sr:music-space suivent (${albumId})`);
ok(/partagé avec le Workspace/.test(await page.textContent('.ch-space-n')), 'la ligne dit : partagé avec le Workspace');
ok((await page.textContent('.ch-head > .lbl')) === 'Les chansons du Space', 'la tête de la scène : « Les chansons du Space »');

// une chanson naît dans le Space courant
await createSong(page, 'sunny pop, ukulele, claps, 118 BPM');
await waitCards(page, 1, 'Album été : une chanson y naît');
const a1 = (await cards(page))[0];
ok((await item(page, a1.id)).music_space === albumId, 'sa naissance : music_space = le Space courant');
await shot(page, '02-space-album-sombre');

// retour dans « Mon Space » : seulement la sienne
await chooseSpace(page, 'Mon Space');
await waitCards(page, 1, 'retour dans « Mon Space » : sa seule chanson', 8000);
ok((await cards(page))[0]?.id === m1.id, 'la scène ne montre que le Space choisi');

// « Tous les Spaces » : tout, avec la pastille du Space sur chaque carte
await chooseSpace(page, 'Tous les Spaces');
await waitCards(page, 2, '« Tous les Spaces » : les deux chansons', 8000);
let cs = await cards(page);
ok(cs.find((c) => c.id === a1.id)?.tag === 'Album été' && cs.find((c) => c.id === m1.id)?.tag === 'Mon Space', `la pastille du Space sur chaque carte (${cs.map((c) => c.tag)})`);
ok(/Mon Space/.test(await page.textContent('.ch-space-n')), 'en vue « Tous », la ligne dit où va ce qu’on crée');
await shot(page, '03-tous-les-spaces-sombre');

// une variante reste dans le Space de sa chanson, même vue depuis « Tous »
await page.click(`.ch-song[data-id="${a1.id}"] [data-act="variant"]`);
await waitCards(page, 3, 'une variante arrive');
cs = await cards(page);
const va = cs.find((c) => ![a1.id, m1.id].includes(c.id));
ok(va && (await item(page, va.id)).music_space === albumId && va.tag === 'Album été', 'la variante reste dans le Space de sa chanson (« Album été »)');

// Ctrl+clic, Maj+clic : plusieurs cartes ; « Déplacer vers… » ; Ctrl+Z
const order = (await cards(page)).map((c) => c.id);
await page.click(`.ch-song[data-id="${order[0]}"] .ch-meta`, { modifiers: ['Control'] });
await page.click(`.ch-song[data-id="${order[2]}"] .ch-meta`, { modifiers: ['Shift'] });
cs = await cards(page);
ok(cs.filter((c) => c.sel).length === 3 && /3 choisies/.test(await page.textContent('#ch-selbar')), 'Ctrl+clic puis Maj+clic : trois cartes choisies');
ok(!(await page.$eval(`.ch-song[data-id="${order[0]}"]`, (c) => c.classList.contains('on'))), 'un clic choisi n’écoute pas');
await page.click(`.ch-song[data-id="${order[1]}"] .ch-meta`, { modifiers: ['Control'] });
ok((await cards(page)).filter((c) => c.sel).length === 2, 'Ctrl+clic encore : la carte sort de la sélection');
await shot(page, '04-selection-sombre');
await page.click('#ch-selbar [data-act="move"]');
await page.waitForSelector('.sr-menu .mi:has-text("Album été")');
await page.click('.sr-menu .mi:has-text("Album été")');
await page.waitForTimeout(900);
const moved = [order[0], order[2]];
const where = async () => Promise.all(moved.map(async (id) => (await item(page, id)).music_space || ''));
ok((await where()).every((x) => x === albumId), 'déplacer vers « Album été » : les deux cartes y sont');
ok((await cards(page)).every((c) => !c.sel), 'après le déplacement : plus rien de choisi');
await page.keyboard.press('Control+z');
await page.waitForTimeout(900);
const back = await where();
ok(back.filter((x) => x === albumId).length === moved.filter((id) => [a1.id, va.id].includes(id)).length, `Ctrl+Z : chacune revient d’où elle venait (${back})`);

// glisser une carte sur un Space du menu ouvert
await chooseSpace(page, 'Mon Space');
await waitCards(page, 1, '« Mon Space » : une carte à glisser', 8000);
await openMenu(page);
const src = await page.$(`.ch-song[data-id="${m1.id}"] .ch-tx`);
const dst = await page.$('.ch-spmenu .mi:has(.lb:text-is("Album été"))');
const sb = await src.boundingBox(), db = await dst.boundingBox();
await page.mouse.move(sb.x + 20, sb.y + sb.height / 2);
await page.mouse.down();
await page.mouse.move(sb.x + 40, sb.y + sb.height / 2 + 10, { steps: 4 });
await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2, { steps: 12 });
await page.waitForTimeout(150);
await page.mouse.up();
await page.waitForTimeout(1000);
ok((await item(page, m1.id)).music_space === albumId, 'glisser une carte sur « Album été » du menu ouvert : elle y va');
await waitCards(page, 0, '« Mon Space » se vide', 8000);
await page.keyboard.press('Control+z');
await waitCards(page, 1, 'Ctrl+Z : la carte revient', 8000);

// importer un son : une carte du Space courant
await chooseSpace(page, 'Album été');
const wavPath = `${out}/import.wav`;
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', wavPath]);
const n0 = await nCards(page);
await page.setInputFiles('.ch-head input[type=file]', wavPath);
await waitCards(page, n0 + 1, 'importer : une carte de plus dans le Space', 20000);
const imp = (await cards(page)).find((c) => /importé/i.test(c.meta));
ok(imp && (await item(page, imp.id)).music_space === albumId, 'le son importé naît dans le Space courant, « importé »');
ok(imp && await page.$eval(`.ch-song[data-id="${imp.id}"] [data-act="variant"]`, (b) => b.getAttribute('aria-disabled') === 'true'),
  'un son importé : Variante dit pourquoi elle ne marche pas');

// archiver : Créer dit pourquoi ; rouvrir
await page.click('#ch-space .sr-kebab');
await page.click('.sr-menu .mi:has-text("Archiver")');
await page.waitForTimeout(500);
await page.fill('#ch-prompt', 'dark ambient, drones');
ok(await page.$eval('#ch-create', (b) => b.disabled) && /archivé/.test(await page.textContent('#ch-act .why')), 'archivé : Créer désactivé dit pourquoi');
await shot(page, '05-archive-sombre');
await page.click('#ch-space .sr-kebab');
await page.click('.sr-menu .mi:has-text("Rouvrir")');
await page.waitForTimeout(500);
ok(!(await page.$eval('#ch-create', (b) => b.disabled)), 'rouvert : Créer se débloque');

// le Space choisi est retenu (préférence de page, par Workspace)
await page.waitForTimeout(800);   // l'envoi des préférences est regroupé (400 ms)
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#ch-space-btn');
await page.waitForTimeout(600);
ok((await spaceBtn(page)) === 'Album été', 'rechargée : le Space choisi est retenu');
const pr = await page.evaluate(() => fetch('../api/prefs').then((r) => r.json()));
ok(new RegExp(`=${albumId}`).test(pr.prefs?.chanson?.spaces || ''), `la préférence chanson.spaces (${pr.prefs?.chanson?.spaces})`);

// supprimer (S2) : ses chansons retournent dans « Mon Space » ; rien à la corbeille ; Ctrl+Z
const inAlbum = (await cards(page)).map((c) => c.id);
await page.click('#ch-space .sr-kebab');
await page.click('.sr-menu .mi:has-text("Supprimer le Space")');
await page.waitForSelector('.fl-ask');
ok(/retournent dans « Mon Space »/.test(await page.textContent('.fl-ask')), 'supprimer : la fenêtre dit où vont les chansons');
await shot(page, '06-supprimer-sombre');
await page.click('.fl-ask .modal-foot .tb:last-child');
await page.waitForFunction(() => document.querySelector('#ch-space-btn b')?.textContent === 'Mon Space', null, { timeout: 8000 }).catch(() => {});
ok((await spaceBtn(page)) === 'Mon Space', 'supprimé : la page revient dans « Mon Space »');
await page.waitForTimeout(800);
const ids = (await cards(page)).map((c) => c.id);
ok(inAlbum.every((id) => ids.includes(id)), `S2 : ses ${inAlbum.length} chansons sont dans « Mon Space »`);
const trash = await page.evaluate(() => fetch('../api/asset/trash').then((r) => r.json()));
ok(!JSON.stringify(trash).includes(inAlbum[0]), 'S2 : rien à la corbeille');
await page.keyboard.press('Control+z');
await page.waitForTimeout(1200);
await openMenu(page);
ok(!!(await page.$('.ch-spmenu .mi:has(.lb:text-is("Album été"))')), 'Ctrl+Z : le Space revient dans le menu');
await page.keyboard.press('Escape');
await chooseSpace(page, 'Album été');
await waitCards(page, inAlbum.length, 'Ctrl+Z : ses chansons avec lui', 8000);
await shot(page, '07-rendu-sombre');
await ctx.close();

// ── les captures : clair à 1440, mobile sombre et clair ─────
for (const [theme, vp, mob, name] of [['light', { width: 1440, height: 900 }, false, '08-clair-1440'],
  ['dark', { width: 390, height: 844 }, true, '09-mobile-sombre'], ['light', { width: 390, height: 844 }, true, '10-mobile-clair']]) {
  const { ctx: c, page: p } = await newPage(theme, vp, mob);
  await p.goto(`${base}/chanson/`, { waitUntil: 'networkidle' });
  await p.waitForSelector('#ch-space-btn');
  await p.waitForTimeout(700);
  ok((await p.evaluate(() => document.documentElement.dataset.theme || 'dark')) === theme, `thème ${theme} posé`);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(over <= 1, `${name} : pas de défilement horizontal (${over} px)`);
  await shot(p, name);
  if (!mob) {
    const first = await p.$('#ch-list .ch-song');
    if (first) await p.click('#ch-list .ch-song .ch-meta', { modifiers: ['Control'] });
    await openMenu(p);
    await shot(p, name + '-menu');
  } else {
    await openMenu(p);
    await shot(p, name + '-menu');
  }
  await c.close();
}

await browser.close();
writeFileSync(`${out}/pilote_spaces.log`, log.join('\n') + '\n');
console.log(fails ? `${fails} échec(s)` : 'tout passe');
process.exit(fails ? 1 : 0);
