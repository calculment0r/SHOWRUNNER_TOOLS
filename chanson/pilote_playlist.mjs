// Le pilote des playlists de Musique (chanson/playlist.js) : Chromium sans
// affichage, un portail d'essai en moteurs factices, jamais le portail en ligne.
//
//   node chanson/pilote_playlist.mjs http://127.0.0.1:8806 /tmp/sr_playlists_shots
//   SR_PLAYWRIGHT=/opt/node22/lib/node_modules/playwright node chanson/pilote_playlist.mjs …   (une session cloud)
//
// Le parcours, en sombre puis en clair : trois chansons d'essai (90, 110 et
// 128 BPM, faites par l'API si elles manquent) ; ouvrir le volet ; glisser les
// trois cartes dedans (une playlist naît) ; réordonner en glissant ; écouter
// (la barre de lecture, le morceau suivant) ; proposer un ordre (l'arc du
// tempo), annuler ; proposer encore, garder, Ctrl+Z ; l'export .zip et « Caler
// les paroles » éteints disent pourquoi tant que leurs branches manquent ; la
// fiche d'Asset. Un seul bouton orange, aucune erreur de console. Rend 0 si
// tout passe ; le détail dans <out>/pilote_playlist.log.
import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';

const require = createRequire('/home/dgx/Character_Sheet/package.json');
const { chromium } = require(process.env.SR_PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };
const api = async (path, body) => {
  const r = await fetch(`${base}/api/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  return r.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── trois chansons d'essai, à des tempos connus (lus dans le style) ──
const TITRES = [['Pilote lent', 'slow folk, acoustic guitar, 90 BPM'], ['Pilote moyen', 'pop, piano, 110 BPM'], ['Pilote vif', 'upbeat electronic, 128 BPM']];
const lesChansons = async () => (await api('chanson/list?limit=200')).songs || [];
let songs = await lesChansons();
for (const [title, prompt] of TITRES) {
  if (songs.some((s) => s.title.startsWith(title))) continue;
  await api('chanson/create', { prompt, title, lyrics: '[Verse]\nla nuit\n[Chorus]\nreste', duration: 12, preset: 'rapide', n: 1, seed: 7 });
}
for (let k = 0; k < 120 && TITRES.some(([t]) => !songs.some((s) => s.title.startsWith(t))); k++) { await sleep(1000); songs = await lesChansons(); }
ok(TITRES.every(([t]) => songs.some((s) => s.title.startsWith(t))), 'trois chansons d’essai (90, 110, 128 BPM)');

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
async function newPage(theme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } }));
      if (!sessionStorage.getItem('pl-pilote')) { localStorage.removeItem('sr-chanson-playlist.v1'); sessionStorage.setItem('pl-pilote', '1'); }
    } catch { /* */ }
  }, theme);
  // Google Fonts ne répond pas partout (une session cloud) : la page vit sans
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') { log.push(`console ${theme}: ${m.text()}`); fails++; } });
  page.on('pageerror', (e) => { log.push(`PAGEERROR ${theme}: ${e.message}`); fails++; });
  return { ctx, page };
}
const shot = async (page, name) => { await page.waitForTimeout(300); await page.screenshot({ path: `${out}/${name}.png` }); };
const titres = (page) => page.$$eval('.pl-tr', (l) => l.map((r) => r.querySelector('.pl-tt b').textContent));
const serveur = (id) => api('playlist/' + id);

for (const theme of ['dark', 'light']) {
  const { ctx, page } = await newPage(theme);
  await page.goto(`${base}/chanson/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.pl-btn');
  ok((await page.$$('.tb.go')).length === 1, `${theme} : un seul bouton orange (celui du rail)`);
  await page.click('.pl-btn');
  ok(await page.$eval('#pl-volet', (v) => !v.hidden), `${theme} : le volet s'ouvre à droite`);

  // glisser trois cartes de la scène (une playlist naît avec la première)
  for (const [t] of TITRES) {
    await page.dragAndDrop(`.ch-song:has(.ch-tx b:text-matches("^${t}")) .ch-meta`, '.pl-vide');   // sous la liste : à la fin
    await page.waitForTimeout(700);
  }
  const t0 = await titres(page);
  ok(t0.length === 3 && TITRES.every(([t], k) => t0[k].startsWith(t)), `${theme} : trois sons glissés, dans l'ordre (${t0.join(' | ')})`);
  ok(/3 morceaux/.test(await page.textContent('.pl-sum')), `${theme} : la durée totale en tête (${await page.textContent('.pl-sum')})`);
  const id = (await api('playlist')).playlists[0].id;
  let d = await serveur(id);
  ok(d.playlist.tracks.length === 3 && d.kind === 'playlist', `${theme} : écrite sur le serveur (${id}, rev ${d.rev})`);
  await shot(page, `${theme}-1-trois-sons`);

  // réordonner : le dernier en tête, en glissant
  const r3 = await (await page.$('.pl-tr:nth-child(3) .pl-tt')).boundingBox();
  const r1 = await (await page.$('.pl-tr:nth-child(1)')).boundingBox();
  await page.mouse.move(r3.x + 20, r3.y + r3.height / 2);
  await page.mouse.down();
  await page.mouse.move(r3.x + 20, r3.y - 12, { steps: 4 });
  await page.mouse.move(r1.x + 60, r1.y + 4, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const t1 = await titres(page);
  d = await serveur(id);
  ok(t1[0] === t0[2] && t1[1] === t0[0] && d.items[d.playlist.tracks[0].item].title === t0[2], `${theme} : réordonné en glissant, écrit (${t1.join(' | ')})`);

  // écouter : la barre de lecture, le morceau suivant
  await page.click('[data-act="ecouter"]');
  await page.waitForTimeout(1200);
  ok(await page.$eval('.pl-barre', (b) => !b.hidden) && !!(await page.$('.pl-barre .sr-lect')), `${theme} : écouter montre la barre de lecture du portail`);
  ok(await page.$eval('.pl-tr:nth-child(1)', (r) => r.classList.contains('on')), `${theme} : le premier morceau joue`);
  const tA = await page.$eval('.pl-barre .sr-lect', (n) => n.srLecteur.t);
  await page.waitForTimeout(700);
  const tB = await page.$eval('.pl-barre .sr-lect', (n) => n.srLecteur.t);
  ok(tB > tA, `${theme} : la lecture avance (${tA.toFixed(2)} → ${tB.toFixed(2)} s)`);
  await page.click('.pl-barre [aria-label="suivant"]');
  await page.waitForTimeout(700);
  ok(await page.$eval('.pl-tr:nth-child(2)', (r) => r.classList.contains('on')), `${theme} : suivant, le deuxième joue`);
  await shot(page, `${theme}-2-ecoute`);
  await page.click('[data-act="ecouter"]');

  // proposer un ordre, annuler
  await page.click('[data-act="ordre"]');
  await page.waitForSelector('.pl-ordre', { timeout: 30000 }).catch(() => {});
  const prop = await titres(page);
  ok(!!(await page.$('.pl-ordre')) && JSON.stringify(prop) !== JSON.stringify(t1), `${theme} : un ordre proposé (${prop.join(' | ')})`);
  ok(prop[0].startsWith('Pilote lent') && prop[1].startsWith('Pilote vif'), `${theme} : le tempo en arc — lent, vif au sommet, puis redescend`);
  d = await serveur(id);
  ok(d.items[d.playlist.tracks[0].item].title === t1[0], `${theme} : rien n'est écrit pendant la proposition`);
  await shot(page, `${theme}-3-ordre-propose`);
  await page.click('[data-act="annuler"]');
  await page.waitForTimeout(300);
  ok(JSON.stringify(await titres(page)) === JSON.stringify(t1) && !(await page.$('.pl-ordre')), `${theme} : annulé, l'ordre d'avant revient`);

  // proposer, garder, puis Ctrl+Z
  await page.click('[data-act="ordre"]');
  await page.waitForSelector('.pl-ordre', { timeout: 30000 }).catch(() => {});
  await page.click('[data-act="garder"]');
  await page.waitForTimeout(900);
  d = await serveur(id);
  ok(d.items[d.playlist.tracks[0].item].title === prop[0] && d.items[d.playlist.tracks[1].item].title === prop[1], `${theme} : gardé, écrit`);
  await page.mouse.click(700, 880);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(900);
  d = await serveur(id);
  ok(d.items[d.playlist.tracks[0].item].title === t1[0], `${theme} : Ctrl+Z rend l'ordre d'avant`);

  // ce qui attend d'autres branches : éteint, et dit pourquoi
  const o = await api('playlist/options');
  const zip = await page.$eval('[data-act="zip"]', (b) => ({ off: b.getAttribute('aria-disabled'), why: b.title }));
  ok(o.zip.ready ? zip.off !== 'true' : zip.off === 'true' && /écoute/.test(zip.why), `${theme} : « Exporter en .zip » ${o.zip.ready ? 'prêt' : 'éteint, la raison au survol'}`);
  await page.click('.pl-tr:nth-child(1) .sr-kebab');
  await page.waitForTimeout(200);
  const caler = await page.$$eval('.sr-menu *', (l) => l.map((n) => n.textContent).find((t) => /Caler les paroles/.test(t)) || '');
  ok(o.lrc.ready || /commun\/lrc\.js/.test(caler), `${theme} : « Caler les paroles » ${o.lrc.ready ? 'prêt' : 'dit pourquoi (commun/lrc.js)'}`);
  await page.keyboard.press('Escape');
  await shot(page, `${theme}-4-volet`);

  // la fiche d'Asset
  const fiche = await ctx.newPage();
  fiche.on('console', (m) => { if (m.type() === 'error') { log.push(`console ${theme} (Asset): ${m.text()}`); fails++; } });
  await fiche.goto(`${base}/asset/#${id}`, { waitUntil: 'networkidle' });
  await fiche.waitForSelector('.pl-sh-tr', { timeout: 15000 }).catch(() => {});
  ok(/playlist · 3 morceaux/.test(await fiche.textContent('.kicker').catch(() => '')) && (await fiche.$$('.pl-sh-tr')).length === 3,
    `${theme} : la fiche d'Asset (playlist, trois morceaux à écouter)`);
  ok((await fiche.$$('.tb.go')).length === 1, `${theme} : la fiche a un seul orange (Ouvrir dans Musique)`);
  await fiche.screenshot({ path: `${out}/${theme}-5-fiche-asset.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/pilote_playlist.log`, log.join('\n') + '\n');
console.log(fails ? `${fails} échec(s)` : 'tout passe');
process.exit(fails ? 1 : 0);
