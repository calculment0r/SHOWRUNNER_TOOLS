// Le pilote du parcours de création vidéo (movie/movie.js, commun/multishot.js, commun/entrees.js) : un portail
// d'essai NEUF en moteurs factices (tools/portail_essai.py), jamais le portail en ligne. Il monte lui-même un faux
// studio Character Factory (un personnage, « Nora ») : le portail doit le connaître.
//
//   SR_CF_API=http://127.0.0.1:8897 python3 tools/portail_essai.py 8895 /tmp/sr_video
//   node movie/pilote_video.mjs http://127.0.0.1:8895 /tmp/sr_video/shots 8897
//   SR_PLAYWRIGHT=/opt/node22/lib/node_modules/playwright CHROMIUM=/opt/pw-browsers/chromium LC_ALL=C.UTF-8 node …   (une session cloud)
//
// Le parcours (Cal, 09/10) : une invite en mode Texte → glisser un élément du panneau Asset sur la barre (on passe en
// Références, il arrive avec sa vignette, son jeton @element1 et son nom) → un objet sur les entrées → un personnage
// de la section Character Factory du panneau, pas encore importé (importé au dépôt) → le Multishot dans la barre →
// une image glissée sur le plan 2 (son jeton s'écrit dans le plan) → une coupe à la poignée (le total ne bouge pas) →
// la fin à la poignée (la durée suit, sur la grille d'H3) → un plan glissé à la première place → le format 16:9 et une
// résolution plus petite, la qualité → ce que H3 reçoit → « Générer » (moteur factice) : la vidéo dans le fil.
// À chaque étape : un seul bouton orange. Captures avant / après en sombre et en clair, à 1280 et 390 px de large.
// Rend 0 si tout passe.
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
import { createServer } from 'http';
import { deflateSync } from 'zlib';

const require = createRequire(process.env.PLAYWRIGHT || `${process.env.SR_PLAYWRIGHT || '/home/dgx/Character_Sheet/node_modules/playwright'}/package.json`);
const { chromium } = require('playwright');
const [base, out, cfPort = '8897'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; };

// ── des images d'essai, sans dépendance : un PNG d'aplats (zlib de node) ──
function png(w, h, boxes) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const b = boxes.findLast(([x0, y0, bw, bh]) => x >= x0 && x < x0 + bw && y >= y0 && y < y0 + bh);
      const c = b ? b[4] : [0, 0, 0];
      raw.set(c, y * (w * 3 + 1) + 1 + x * 3);
    }
  }
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = {
  visage: png(256, 256, [[0, 0, 256, 256, [48, 64, 42]], [68, 48, 120, 150, [224, 176, 144]], [95, 100, 15, 10, [32, 32, 32]], [146, 100, 15, 10, [32, 32, 32]]]),
  corps: png(256, 384, [[0, 0, 256, 384, [106, 76, 59]], [88, 60, 80, 100, [224, 176, 144]], [75, 165, 106, 180, [42, 74, 122]]]),
  rue: png(512, 288, [[0, 0, 512, 288, [27, 43, 68]], [0, 190, 512, 98, [58, 58, 58]], [350, 60, 100, 130, [128, 96, 64]]]),
  objet: png(384, 384, [[0, 0, 384, 384, [32, 40, 48]], [142, 100, 100, 190, [192, 48, 48]]]),
  nora: png(256, 256, [[0, 0, 256, 256, [70, 40, 80]], [68, 48, 120, 150, [200, 160, 130]]]),
  noraCorps: png(256, 384, [[0, 0, 256, 384, [70, 40, 80]], [80, 50, 96, 300, [180, 140, 110]]]),
};

// ── le faux studio Character Factory : un personnage au visage verrouillé, pas encore importé ──
const cf = createServer((req, res) => {
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
  if (req.url === '/api/characters') {
    return send(200, JSON.stringify({ characters: [{ slug: 'nora', name: 'Nora', locked: true, costumes: 1, thumb: '/files/nora/face/locked.png' }] }));
  }
  if (req.url === '/api/characters/nora') {
    return send(200, JSON.stringify({ character: { name: 'Nora', face: { locked: 'face/locked.png' },
      costumes: { c1: { name: 'tenue de ville', fullbody: { validated: 'costumes/c1/full.png' } } } } }));
  }
  if (req.url === '/files/nora/face/locked.png') return send(200, PNG.nora, 'image/png');
  if (req.url === '/files/nora/costumes/c1/full.png') return send(200, PNG.noraCorps, 'image/png');
  send(404, '{"error":"introuvable"}');
});
await new Promise((r) => cf.listen(Number(cfPort), '127.0.0.1', r));

// ── les assets d'essai, rangés par l'API comme une page le ferait ──
const up = async (name, title, buf) => (await fetch(`${base}/api/library/upload?name=${name}&title=${encodeURIComponent(title)}&tool=upload&via=movie`,
  { method: 'PUT', body: buf, headers: { 'Content-Type': 'image/png' } })).json();
const post = async (p, body) => (await fetch(`${base}/api/${p}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })).json();
const visage = await up('visage.png', 'Mara visage', PNG.visage);
const corps = await up('corps.png', 'Mara plein pied', PNG.corps);
const rue = await up('rue.png', 'Rue de nuit', PNG.rue);
const objet = await up('objet.png', 'Valise rouge', PNG.objet);
const mara = await post('elements', { title: 'Mara', type: 'character', description: 'a woman in her thirties',
  refs: [{ item: visage.id, role: 'face' }, { item: corps.id, role: 'full body' }] });
const valise = await post('elements', { title: 'Valise', type: 'object', description: 'a red suitcase', refs: [{ item: objet.id, role: 'sheet' }] });
ok(mara.id && valise.id && rue.id, 'les assets d’essai sont rangés (un personnage, un objet, des images)');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function newPage(theme, viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
  }, theme);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const away = /^Failed to load resource/.test(m.text()) && !(m.location()?.url || '').startsWith(base);
    if (away || /favicon/.test(m.location()?.url || '')) return;
    console.log(`console ${theme}: ${m.text()} ${m.location()?.url || ''}`);
    fails++;
  });
  page.on('pageerror', (e) => { console.log(`PAGEERROR ${theme}: ${e.message}`); fails++; });
  return { ctx, page };
}
const shot = async (page, name) => { await page.waitForTimeout(350); await page.screenshot({ path: `${out}/${name}.png` }); };
const gos = (page) => page.$$eval('.tb.go', (l) => l.filter((b) => b.offsetParent !== null).map((b) => b.id || b.textContent.trim()));
const oneGo = async (page, what) => { const g = await gos(page); ok(g.length === 1, `${what} : un seul bouton orange (${g.join(', ')})`); };
const toks = (page) => page.$$eval('#entrees .ent-slot', (l) => l.map((n) => `${n.querySelector('.ent-tok')?.textContent}=${n.querySelector('.ent-name')?.textContent}`));
const segs = (page) => page.$$eval('#ms .ms-seg', (l) => l.map((n) => ({ t: n.querySelector('.ms-ex')?.textContent, d: n.querySelector('.ms-sl small')?.textContent })));
const msState = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('movie.v2') || '{}'));
async function waitFor(fn, what, timeout = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) { ok(true, what); return v; }
    if (Date.now() - t0 > timeout) { ok(false, `${what} (délai dépassé)`); return null; }
    await new Promise((r) => setTimeout(r, 250));
  }
}
// le panneau Asset ouvert sur une section (« Ce workspace », Character Factory), la recherche posée : la vignette
// voulue est dessinée (la grille ne dessine que ses lignes visibles)
async function dockShow(page, sec, q) {
  if (!(await page.$('html.sr-dock-on'))) await page.keyboard.press('Control+Space');
  await page.waitForSelector(`.dk-sec[data-sec="${sec}"] h3 button`, { timeout: 15000 });
  await page.click(`.dk-sec[data-sec="${sec}"] h3 button`);
  await page.fill('.dk-q', q);
  await page.waitForTimeout(700);
}
const dockClose = async (page) => { if (await page.$('html.sr-dock-on')) await page.keyboard.press('Control+Space'); await page.waitForTimeout(400); };
// une vignette du panneau : par son objet (data-id), ou un personnage de Character Factory par son nom
const tile = (page, it) => page.locator(typeof it === 'string' ? `.lt[draggable=true][title^="${it}"]` : `.lt[draggable=true][data-id="${it.id}"]`).first();
// glisser une poignée de dx pixels, pas à pas (comme une main)
async function drag(page, sel, dx, steps = 14) {
  // la barre se recentre (et change de hauteur) quand le panneau Asset se ferme : on attend qu'elle ne bouge plus
  // (cinq relevés de suite au même endroit : sous charge, une animation peut sauter une image)
  let b = await (await page.$(sel)).boundingBox();
  for (let k = 0, still = 0; k < 60 && still < 5; k++) {
    await page.waitForTimeout(150);
    const n = await (await page.$(sel)).boundingBox();
    still = n.x === b.x && n.y === b.y ? still + 1 : 0;
    b = n;
  }
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + (dx * i) / steps, y);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

// ── le parcours, en sombre, à 1280 px ───────────────────────
const { ctx, page } = await newPage('dark');
await page.goto(`${base}/movie/?mode=t2v`, { waitUntil: 'networkidle' });
await page.waitForSelector('#pb-chips .pc');
await oneGo(page, 'l’arrivée');
ok(await page.$eval('#pbar', (n) => getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().bottom > innerHeight - 40),
  'la barre de création est en bas, au-dessus du fil');
const chipsText = await page.$eval('#pb-chips', (n) => n.textContent);
ok(/2,4:1/.test(chipsText) && /Brouillon≈ \d/.test(chipsText) && /5,2 s/.test(chipsText),
  `le format, la qualité et la résolution, la durée sont des puces principales (${chipsText.replace(/\s+/g, ' ').slice(0, 120)})`);
await page.fill('#desc', 'A woman crosses a rainy street at night and stops in front of a shop window. She turns toward the camera. A neon sign flickers above her.');
await page.waitForTimeout(500);
await shot(page, 'apres-video-sombre-1280');

// un élément glissé du panneau Asset sur la barre : on passe en Références, il arrive avec son jeton et son nom
await dockShow(page, 'here', 'Mara');
await tile(page, mara).dragTo(page.locator('#pb-text'));
await waitFor(async () => (await toks(page)).length, 'Mara arrive dans les entrées');
ok(await page.$eval('body', (b) => b.dataset.mode) === 'r2v', 'un élément déposé en mode Texte fait passer en Références');
ok((await toks(page)).includes('@element1=Mara'), `Mara : sa vignette, son jeton @element1, son nom (${await toks(page)})`);
ok(/A woman crosses a rainy street/.test(await page.inputValue('#desc')), 'l’invite reste quand le mode change (une seule invite)');
// un objet, sur les entrées
await dockShow(page, 'here', 'Valise');
await tile(page, valise).dragTo(page.locator('#entrees'));
await waitFor(async () => (await toks(page)).includes('@element2=Valise'), 'l’objet Valise arrive en @element2');
// un personnage de Character Factory, pas encore importé : importé au dépôt
await dockShow(page, 'cf', 'Nora');
await tile(page, 'Nora').dragTo(page.locator('#entrees'));
await waitFor(async () => (await toks(page)).includes('@element3=Nora'), 'Nora (Character Factory) est importée au dépôt et arrive en @element3');
await shot(page, 'apres-entrees-dock-sombre-1280');
await dockClose(page);

// le Multishot, dans la barre
await page.click('.pc.ms-chip');
await page.waitForSelector('#ms .ms-seg');
let sg = await segs(page);
ok(sg.length === 3 && /rainy street/.test(sg[0].t), `le Multishot découpe l’invite en plans, dans la barre (${sg.map((x) => x.d).join(' | ')})`);
ok(!(await page.$('.ms-modal')) && await page.$eval('#ms', (n) => !!n.closest('#pbar')), 'le Multishot n’est plus une fenêtre : il est dans la barre');
await oneGo(page, 'le Multishot allumé');
// une image glissée sur le plan 2 : son jeton s'écrit dans le plan
await dockShow(page, 'here', 'Rue');
const seg2 = page.locator('#ms .ms-seg').nth(1);
await tile(page, rue).dragTo(seg2);
await waitFor(async () => (await segs(page))[1]?.t.includes('@image1'), 'l’image glissée sur le plan 2 y écrit @image1');
ok((await toks(page)).includes('@image1=Rue de nuit'), 'l’image glissée sur un plan est aussi dans les entrées');
await dockClose(page);
// une coupe, à la poignée : le plan 1 s'allonge, le plan 2 raccourcit, le total ne bouge pas
let st = await msState(page);
const f0 = st.ms.shots.map((p) => p.frames), tot0 = f0.reduce((a, b) => a + b, 0);
await drag(page, '#ms .ms-h', 50);
st = await msState(page);
const f1 = st.ms.shots.map((p) => p.frames);
ok(f1[0] > f0[0] && f1[1] < f0[1] && f1.reduce((a, b) => a + b, 0) === tot0, `la coupe se déplace à la poignée (${f0.join('+')} → ${f1.join('+')} images)`);
// la fin, à la poignée : la durée suit, sur la grille d'H3 (17k+5)
await drag(page, '#ms .ms-end', 120);
st = await msState(page);
const tot1 = st.ms.shots.reduce((a, p) => a + p.frames, 0);
ok(tot1 > tot0 && tot1 % 17 === 5 && st.frames === tot1, `la fin se tire à la poignée : ${tot0} → ${tot1} images, sur la grille d’H3`);
ok((await page.$eval('.pc.count.dur b', (n) => n.textContent)) === `${String(Math.round((tot1 / 24) * 10) / 10).replace('.', ',')} s`, 'la puce de durée suit la poignée de fin');
// un plan glissé à la première place
const before = (await segs(page)).map((x) => x.t);
const s3 = await (await page.$$('#ms .ms-seg'))[2].boundingBox();
const s1 = await (await page.$$('#ms .ms-seg'))[0].boundingBox();
await page.mouse.move(s3.x + s3.width / 2, s3.y + s3.height / 2);
await page.mouse.down();
for (let i = 1; i <= 16; i++) await page.mouse.move(s3.x + s3.width / 2 + ((s1.x + 6) - (s3.x + s3.width / 2)) * i / 16, s3.y + s3.height / 2);
await page.mouse.up();
await page.waitForTimeout(400);
const after = (await segs(page)).map((x) => x.t);
ok(after[0] === before[2] && after[1] === before[0], 'un plan glissé change de place, il emporte son texte');
ok(/^\[Shot 1\] A neon sign/.test(await page.inputValue('#desc')) && /\[Shot 2\] At 00:0\d\.\d{3},/.test(await page.inputValue('#desc')),
  'l’invite suit la frise ([Shot 1] est le plan déplacé, les plans suivants avec leur temps de coupe)');
// le plan choisi s'édite sur place, une réplique
await (await page.$$('#ms .ms-seg'))[1].click();
await page.click('#ms .ms-add');
await page.fill('#ms .ms-line .ms-say', 'Encore toi ?');
await page.waitForTimeout(400);
ok(/\(S1\) says: <d>\[French\] Encore toi \?<\/d>/.test(await page.inputValue('#desc')), 'une réplique du plan choisi s’écrit dans l’invite, au format H3');
await shot(page, 'apres-multishot-sombre-1280');

// le format et la résolution, des commandes principales ; l'échelle du serveur, de l'Esquisse à la Qualité, le temps à côté
await page.click('.pc.fmt');
await page.waitForSelector('[data-pop="fmt"] .v-fmt');
await shot(page, 'apres-format-sombre-1280');
const fmts = await page.$$eval('[data-pop="fmt"] .v-fmt b', (l) => l.map((n) => n.textContent));
ok(['2,4:1', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].every((f) => fmts.includes(f)), `les formats de l’échelle (${fmts.join(', ')})`);
await page.click('[data-pop="fmt"] .v-fmt:has-text("16:9")');
await page.waitForTimeout(700);
const rows = await page.$$eval('[data-pop="fmt"] .cv-row', (l) => l.map((n) => `${n.querySelector('em')?.textContent} ${n.querySelector('b').textContent} ${n.querySelector('.cv-e').textContent}`));
ok(rows.length === 4 && /^Esquisse 672 × 384/.test(rows[0]) && rows.every((r) => /min|s$/.test(r)),
  `le 16:9 propose ses quatre résolutions, la plus petite d’abord, chacune avec son temps (${rows.join(' | ')})`);
await page.click('[data-pop="fmt"] .cv-row >> nth=0');
await page.waitForTimeout(700);
const plan = await page.evaluate(() => {
  const st = JSON.parse(localStorage.getItem('movie.v2'));
  return { format: st.format, method: st.method, canvas: st.canvas.r2v, chip: document.querySelector('.pc.res b')?.textContent,
    fmt: document.querySelector('.pc.fmt b')?.textContent, est: document.querySelector('.pc.res .pc-s')?.textContent,
    tip: document.querySelector('.pc.res')?.title };
});
ok(plan.fmt === '16:9' && plan.format === '16:9' && plan.method === 'esquisse' && plan.canvas === null && plan.chip === 'Esquisse'
   && /672×384/.test(plan.tip) && /≈/.test(plan.est || ''),
  `le format et la plus petite résolution se lisent sur les puces, avec le temps estimé (${plan.fmt} · ${plan.chip} ${plan.est})`);
await page.click('[data-pop="fmt"] .cv-row:has-text("Qualité")');
await page.waitForTimeout(500);
ok(/^Qualité/.test(await page.$eval('.pc.res b', (n) => n.textContent)) && /1536×864/.test(await page.$eval('.pc.res', (n) => n.title)),
  'la Qualité au même endroit, à la taille du format');
await page.click('[data-pop="fmt"] .cv-row:has-text("Esquisse")');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
// une information une fois par écran : le temps estimé sur la puce de résolution seulement, la durée sur sa puce
ok(!(await page.$eval('#go', (b) => b.textContent)).match(/min|≈/) && !(await page.$('#ms .ms-n')),
  'une information une fois : ni le temps sur « Générer », ni la durée en tête du Multishot');
// ce que H3 reçoit (POST /api/movie/apercu) : les vérifications, les sujets, les images dans l'ordre, le prompt compilé
await page.click('.pc.recu');
await page.waitForSelector('#recu pre.sent');
await page.waitForTimeout(600);
const sent = await page.$eval('#recu pre.sent', (n) => n.textContent);
ok(/subject_definitions/.test(sent) && /\[Shot 2\] At 00:0/.test(sent) && /<Subject 1>/.test(sent), 'ce que H3 reçoit : le prompt compilé, ses plans et leurs temps de coupe, ses sujets');
ok((await page.$$('#recu .v-checks li')).length >= 5, 'ce que H3 reçoit : les vérifications du code');
ok((await page.$$('#recu .v-pic')).length >= 3, 'ce que H3 reçoit : les images chargées, dans l’ordre');
ok((await page.$$('#recu .v-def textarea')).length >= 4, 'ce que H3 reçoit : la définition de chaque sujet et le résumé, à corriger');
await shot(page, 'apres-recu-sombre-1280');
// la mise en forme (sans modèle de texte ici : le gabarit) : un travail, puis la barre remplie
await page.click('#recu .v-inv');
await waitFor(async () => (await page.$eval('#recu .v-inv', (b) => b.textContent).catch(() => '')) === 'Mettre en forme'
  && /gabarit|modèle de texte/.test(await page.$eval('.toast', (t) => t.textContent).catch(() => '')), 'la mise en forme tourne, puis rend la main (le gabarit, et pourquoi)', 30000);
ok(/\[Shot 2\] At 00:0/.test(await page.inputValue('#desc')), 'après la mise en forme, l’invite garde ses plans et leurs temps de coupe');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
// « Générer » (moteur factice) : le rendu en tête du fil, puis sa vidéo
await waitFor(() => page.$eval('#go', (b) => !b.disabled), '« Générer » s’allume');
await oneGo(page, 'prêt à lancer');
const vids = () => page.$$eval('#fil [data-id]:not(.fl-job)', (l) => l.length);
const n0 = await vids();
await page.click('#go');
await waitFor(() => page.$('#fil .fl-job'), 'le rendu paraît en tête du fil dès l’envoi', 15000);
await waitFor(async () => (await vids()) > n0, 'la vidéo arrive dans le fil, à la place du rendu', 120000);
await page.waitForTimeout(800);
await shot(page, 'apres-rendu-sombre-1280');
const page1 = page;

// ── en clair, et au téléphone ───────────────────────────────
for (const [theme, w, h] of [['light', 1280, 800], ['dark', 390, 844], ['light', 390, 844]]) {
  const { ctx: c2, page: p2 } = await newPage(theme, { width: w, height: h });
  await p2.goto(`${base}/movie/?mode=r2v`, { waitUntil: 'networkidle' });
  await p2.waitForSelector('#pb-chips .pc');
  await p2.waitForTimeout(800);
  const st2 = await p2.evaluate(() => JSON.parse(localStorage.getItem('movie.v2') || '{}'));
  if (!st2.ms?.on) await p2.click('.pc.ms-chip');
  await p2.waitForTimeout(700);
  await oneGo(p2, `${theme} ${w} px`);
  const wide = await p2.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
  ok(wide <= 1, `${theme} ${w} px : pas de défilement horizontal de la page (${wide} px)`);
  await shot(p2, `apres-multishot-${theme === 'dark' ? 'sombre' : 'clair'}-${w}`);
  await p2.click('.pc.fmt');
  await p2.waitForSelector('[data-pop="fmt"] .v-fmt');
  await shot(p2, `apres-format-${theme === 'dark' ? 'sombre' : 'clair'}-${w}`);
  await c2.close();
}
await ctx.close();
await browser.close();
cf.close();
console.log(fails ? `${fails} échec(s)` : 'tout passe');
process.exit(fails ? 1 : 0);
