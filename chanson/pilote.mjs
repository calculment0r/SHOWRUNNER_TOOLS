// Le pilote de l'app Musique, sur DGX2 (Chromium sans affichage, le
// playwright de ~/Character_Sheet) : un portail d'essai en moteurs factices,
// jamais le portail en ligne.
//
//   node chanson/pilote.mjs http://127.0.0.1:8861 /tmp/sr_chanson_shots
//
// Écris-les pour moi → Créer → écouter (la forme d'onde avance) → une
// variante → reprendre une chanson (référence son) → séparer les pistes →
// ouvrir dans ODIO (le projet existe, une piste par stem, la page d'ODIO
// l'ouvre) ; le Studio fermé (options interceptées) : le bouton le dit et
// mène à la demande. Captures en sombre et en clair, à 1440 px et en
// mobile. Rend 0 si tout passe ; le détail dans <out>/pilote.log.
import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';

const require = createRequire('/home/dgx/Character_Sheet/package.json');
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
  page.on('console', (m) => { if (m.type() === 'error') log.push(`console ${theme}: ${m.text()}`); });
  page.on('pageerror', (e) => { log.push(`PAGEERROR ${theme}: ${e.message}`); fails++; });
  return { ctx, page };
}
const songs = (page) => page.$$eval('#ch-list .ch-song', (l) => l.map((c) => ({ id: c.dataset.id, t: c.querySelector('.ch-tx b').textContent,
  meta: c.querySelector('.ch-meta').textContent, stems: c.querySelectorAll('.ch-stem').length })));
async function waitSongs(page, n, what, timeout = 90000) {
  try { await page.waitForFunction((k) => document.querySelectorAll('#ch-list .ch-song').length >= k, n, { timeout }); ok(true, what); }
  catch { ok(false, `${what} (${(await songs(page)).length} chansons)`); }
}
// des pixels dessinés dans la forme d'onde (canvas non vide)
const waveInk = (page, id) => page.$eval(`.ch-song[data-id="${id}"] canvas.ch-wave`, (cv) => {
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n;
});
const shot = async (page, name) => { await page.waitForTimeout(350); await page.screenshot({ path: `${out}/${name}.png`, fullPage: false }); };

// ── le parcours, en sombre à 1440 px ────────────────────────
const { ctx, page } = await newPage('dark');
await page.goto(`${base}/chanson/`, { waitUntil: 'networkidle' });
await page.waitForSelector('#ch-create');
ok(await page.$eval('.hdr', (h) => h.textContent.includes('Musique')), "l'en-tête dit « Musique »");
ok((await page.$$('.tb.go')).length === 1, 'un seul bouton orange (Créer)');
ok(await page.$eval('#ch-create', (b) => b.disabled) && /décris/.test(await page.$eval('#ch-act .why', (w) => w.textContent)),
  'Créer désactivé dit pourquoi (décris la chanson)');
ok(await page.$eval('details.ch-adv', (d) => !d.open), 'paramètres avancés fermés');
ok(!(await page.$eval('#rail', (r) => /ACE-Step|YuE/.test([...r.querySelectorAll(':scope > section')].map((s) => s.innerText).join(' ')))),
  'aucun nom de modèle hors des paramètres avancés');
await page.fill('#ch-prompt', 'dreamy pop, piano, warm female vocal, 92 BPM');
await page.click('#ch-chips .opt:has-text("cordes")');
ok((await page.inputValue('#ch-prompt')).includes('strings'), 'un mot de style s’ajoute au prompt');
ok(await page.$eval('#ch-chips .opt:has-text("voix féminine")', (b) => b.classList.contains('on'))
  && !(await page.$eval('#ch-chips .opt:has-text("voix masculine")', (b) => b.classList.contains('on'))),
  'les mots cochés : « female vocal » oui, « male vocal » non (un mot entier)');
await page.click('#ch-dur .tb:has-text("30 s")');
await shot(page, '01-formulaire-sombre-1440');
// Écris-les pour moi (moteur factice)
await page.click('#ch-write');
try {
  await page.waitForFunction(() => document.querySelector('#ch-lyrics').value.includes('[Chorus]'), null, { timeout: 30000 });
  ok(true, 'écris-les pour moi : des paroles avec [Verse] et [Chorus]');
} catch { ok(false, 'écris-les pour moi : aucune parole'); }
ok(!(await page.$eval('#ch-create', (b) => b.disabled)), 'Créer se débloque');
await page.click('#ch-create');
await waitSongs(page, 1, 'Créer : une chanson (moteur factice) arrive dans la liste');
let list = await songs(page);
const s1 = list[0];
ok(s1 && /essai/i.test(s1.meta) && /rapide/i.test(s1.meta) && /0:30/.test(s1.meta), `sa ligne : rapide · 0:30 · chanté · essai (${s1?.meta})`);
await page.waitForTimeout(800);
ok((await waveInk(page, s1.id)) > 200, 'la forme d’onde est dessinée');

// écouter : le lecteur avance, la forme d'onde suit
await page.click(`.ch-song[data-id="${s1.id}"] .ch-play`);
await page.waitForTimeout(1600);
const playing = await page.$eval(`.ch-song[data-id="${s1.id}"]`, (c) => ({ on: c.classList.contains('on'), btn: c.querySelector('.ch-play').classList.contains('on'), t: c.querySelector('.ch-time').textContent }));
ok(playing.on && playing.btn && /^0:0[1-9]/.test(playing.t), `écouter : la lecture avance (${playing.t})`);
await shot(page, '02-lecture-sombre-1440');
const cv = await page.$(`.ch-song[data-id="${s1.id}"] canvas.ch-wave`);
const bb = await cv.boundingBox();
await page.mouse.click(bb.x + bb.width * 0.5, bb.y + bb.height / 2);
await page.waitForTimeout(500);
const t2 = await page.$eval(`.ch-song[data-id="${s1.id}"] .ch-time`, (x) => x.textContent);
ok(/^0:1[45]/.test(t2), `clic au milieu de la forme d'onde : on va à 0:15 (${t2})`);
await page.click(`.ch-song[data-id="${s1.id}"] .ch-play`);

// une variante : même recette, autre graine
await page.click(`.ch-song[data-id="${s1.id}"] [data-act="variant"]`);
await waitSongs(page, 2, 'Variante : une deuxième chanson');
list = await songs(page);
const v = list.find((x) => x.id !== s1.id);
ok(v && /variante/i.test(v.meta), `la variante le dit (${v?.meta})`);
const vit = await page.evaluate((id) => fetch(`../api/library/${id}`).then((r) => r.json()), v.id);
ok(vit.parents?.includes(s1.id) && vit.params.chanson.prompt.includes('strings'), 'la variante descend de la chanson, même recette');

// reprendre : la première chanson comme référence son, choisie dans Asset
await page.click('#ch-ref .tb:has-text("Asset")');
await page.waitForSelector('.scrim.picker .thumb');
await page.click(`.scrim.picker .thumb >> nth=0`);
await page.waitForSelector('#ch-refrow');
await page.click('#ch-refmode .tb:has-text("Reprendre")');
ok(await page.$eval('#ch-presets [data-preset="rapide"]', (b) => b.classList.contains('off')) && await page.$eval('#ch-presets [data-preset="soigne"]', (b) => b.classList.contains('on')),
  'reprendre : la qualité passe à « Soigné », « Rapide » dit pourquoi');
await shot(page, '03-reference-sombre-1440');
await page.click('#ch-create');
await waitSongs(page, 3, 'Reprendre : une troisième chanson');
list = await songs(page);
ok(list.some((x) => /reprise/i.test(x.meta)), 'la reprise le dit');
await page.click('#ch-refrow .ch-x');

// séparer les pistes (moteur factice), puis ouvrir dans ODIO
await page.click(`.ch-song[data-id="${s1.id}"] [data-act="stems"]`);
try {
  await page.waitForFunction((id) => document.querySelectorAll(`.ch-song[data-id="${id}"] .ch-stem`).length === 4, s1.id, { timeout: 90000 });
  ok(true, 'séparer : quatre pistes sous la chanson');
} catch { ok(false, 'séparer : pas de pistes'); }
ok((await songs(page)).length === 3, 'les pistes ne s’ajoutent pas à la liste des chansons');
await page.click(`.ch-song[data-id="${s1.id}"] .ch-stem >> nth=0`);
await page.waitForTimeout(700);
ok(await page.$eval(`.ch-song[data-id="${s1.id}"] .ch-stem`, (c) => c.classList.contains('on')), 'une piste s’écoute seule');
await page.click(`.ch-song[data-id="${s1.id}"] .ch-stem >> nth=0`);
await page.evaluate(() => scrollTo(0, 0));
await shot(page, '04-pistes-sombre-1440');
await Promise.all([page.waitForURL(/musique\/\?p=mus-/, { timeout: 30000 }), page.click(`.ch-song[data-id="${s1.id}"] [data-act="odio"]`)]);
const pid = new URL(page.url()).searchParams.get('p');
const proj = await page.evaluate((id) => fetch(`../api/music/projects/${id}`).then((r) => r.json()), pid);
const clipItems = (proj.clips || []).map((c) => c.item);
ok(proj.tracks?.length === 5 && proj.tracks.every((t) => t.kind === 'audio') && clipItems[0] === s1.id && proj.clips[0].mute,
  `ouvrir dans ODIO : le projet existe, la chanson (muette) + 4 pistes (${proj.tracks?.map((t) => t.name).join(', ')})`);
const stemIds = await page.evaluate((id) => fetch('../api/chanson/list').then((r) => r.json()).then((d) => d.songs.find((s) => s.id === id).stems.map((x) => x.id)), s1.id);
ok(stemIds.length === 4 && stemIds.every((x) => clipItems.includes(x)), 'chaque piste du projet est un stem de la chanson');
try {
  await page.waitForFunction((name) => [...document.querySelectorAll('select.mu-proj option')].some((o) => o.selected && o.textContent === name), proj.name, { timeout: 20000 });
  ok(true, `la page d'ODIO ouvre le projet « ${proj.name} »`);
} catch { ok(false, "la page d'ODIO n'a pas ouvert le projet"); }
await page.waitForTimeout(1200);
await shot(page, '05-odio-projet-sombre-1440');
await ctx.close();

// ── le Studio fermé : les options interceptées (le serveur d'essai est « Cal ») ──
{
  const { ctx: c2, page: p2 } = await newPage('dark');
  await p2.route('**/api/chanson/options', async (route) => {
    const r = await route.fetch();
    const j = await r.json();
    j.studio = { ok: false, why: 'Séparer les pistes et ouvrir dans ODIO font partie du Studio.', asked: null };
    await route.fulfill({ response: r, json: j });
  });
  await p2.goto(`${base}/chanson/`, { waitUntil: 'networkidle' });
  await p2.waitForSelector('.ch-song');
  ok((await p2.$$('.ch-song .ch-lock')).length >= 2, 'sans le Studio : les boutons le disent (« Studio »)');
  await p2.click('.ch-song >> nth=1 >> [data-act="odio"]');
  await p2.waitForSelector('.ch-studio-modal');
  ok(/Studio/.test(await p2.$eval('.ch-studio-modal', (m) => m.textContent)) && await p2.$('.ch-studio-modal .tb:has-text("Demander le Studio")'),
    'sans le Studio : le bouton mène à la demande');
  ok(!/musique\//.test(p2.url()), 'sans le Studio : on reste dans l’app');
  await shot(p2, '06-studio-ferme-sombre-1440');
  await c2.close();
}

// ── les captures : clair à 1440, mobile sombre et clair ─────
for (const [theme, vp, mob, name] of [['light', { width: 1440, height: 900 }, false, '07-clair-1440'],
  ['dark', { width: 390, height: 844 }, true, '08-mobile-sombre'], ['light', { width: 390, height: 844 }, true, '09-mobile-clair']]) {
  const { ctx: c, page: p } = await newPage(theme, vp, mob);
  await p.goto(`${base}/chanson/`, { waitUntil: 'networkidle' });
  await p.waitForSelector('.ch-song');
  await p.waitForTimeout(900);
  const th = await p.evaluate(() => document.documentElement.dataset.theme || 'dark');
  ok(th === theme, `thème ${theme} posé (${th})`);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(over <= 1, `${name} : pas de défilement horizontal (${over} px)`);
  await shot(p, name);
  if (mob) {
    await p.evaluate(() => document.querySelector('#stage').scrollIntoView());
    await shot(p, name + '-liste');
  } else {
    await p.click('details.ch-adv > summary');
    await p.evaluate(() => { const r = document.querySelector('#rail'); r.scrollTop = r.scrollHeight; });
    await shot(p, name + '-avances');
  }
  await c.close();
}

await browser.close();
writeFileSync(`${out}/pilote.log`, log.join('\n') + '\n');
console.log(fails ? `${fails} échec(s)` : 'tout passe');
process.exit(fails ? 1 : 0);
