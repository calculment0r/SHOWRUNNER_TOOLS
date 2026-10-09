// Le pilote des mentions « @ » (l'audit du 09/10, docs/etudes/movie.md § 9) : un portail d'essai NEUF en moteurs
// factices (tools/portail_essai.py), jamais le portail en ligne.
//
//   SR_PLAYWRIGHT=/opt/node22/lib/node_modules/playwright LC_ALL=C.UTF-8 node image/pilote_mentions.mjs http://127.0.0.1:8891 /tmp/sr_mentions
//   (CHROMIUM=/opt/pw-browsers/chromium dans une session cloud)
//
// Le parcours : une image et un personnage dans la bibliothèque ; la barre d'Image avec Qwen-Image 2.1 puis Krea 2 :
// les vignettes portent leur jeton (@image1, @element1), « @ » propose ces jetons et dit ce que le modèle lit
// (<image2>, « le sujet ») ; Z-Image dit pourquoi il n'en prend pas. Puis ce que le serveur compile (/api/image/compose),
// le refus d'une mention qui ne pointe vers rien ; l'aperçu de Vidéo (/api/movie/apercu) sur l'invite de Cal ; le
// panneau Multishot (commun/multishot.js) et ses temps de coupe ; Admin → Diagnostics, « Rendus ». Captures en sombre
// et en clair. Rend 0 si tout passe.
import { createRequire } from 'module';
import { mkdirSync } from 'fs';

const require = createRequire((process.env.SR_PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright') + '/package.json');
const { chromium } = require('playwright');
const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });

async function api(path, body, method) {
  const r = await fetch(`${base}/api/${path}`, { method: method || (body ? 'POST' : 'GET'),
    headers: body instanceof Uint8Array ? {} : { 'Content-Type': 'application/json' },
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined });
  return { st: r.status, j: await r.json().catch(() => ({})) };
}
// une image PNG d'une couleur (8 × 8, sans dépendance : la plus petite PNG valide, non compressée)
function png(r, g, b) {
  const { deflateSync } = require('zlib');
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const w = 64, h = 64, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// ── la matière : une image, un personnage ───────────────────
const img = (await api('library/upload?name=port.png&title=Port', png(40, 90, 140), 'PUT')).j;
const vis = (await api('library/upload?name=visage.png&title=Visage', png(200, 150, 120), 'PUT')).j;
const pied = (await api('library/upload?name=pied.png&title=Plein+pied', png(60, 60, 90), 'PUT')).j;
const marc = (await api('elements', { title: 'Marc', type: 'character', description: 'male, 34. Visage carré, barbe de trois jours.',
  refs: [{ item: vis.id, role: 'face', label: 'visage' }, { item: pied.id, role: 'full body', label: 'Costume bleu' }] })).j;
const lea = (await api('elements', { title: 'Léa', type: 'character', description: 'female, 30, short black hair, red jacket',
  refs: [{ item: vis.id, role: 'face', label: 'visage' }, { item: pied.id, role: 'full body', label: 'Survêtement' }] })).j;
ok(img.id && marc.id && lea.id, 'la matière : une image, deux personnages');
// un rendu Vidéo (moteur factice) : de quoi lire le diagnostic « Rendus »
let job = (await api('jobs', { kind: 'movie.r2v', tool: 'movie', title: 'essai', params: { inputs: { image: [{ item: img.id, role: 'location' }],
  element: [{ item: marc.id }, { item: lea.id }] }, desc: '[Shot 1] @element1 and @element2 eat noodles in @image1.\n[Shot 2] At 00:03.000, @element1 (S1) shouts: <d>[French] Tu as pris ma part !</d>',
  method: 'esquisse', format: '16:9' } })).j;
for (let k = 0; k < 120 && !['done', 'error', 'cancelled'].includes(job.state); k++) {
  await new Promise((r) => setTimeout(r, 500));
  job = (await api(`jobs/${job.id}`)).j;
}
ok(job.state === 'done', `un rendu Vidéo factice, Esquisse 16:9 (${job.state} ${job.message})`);

async function newPage(theme, draft) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await ctx.addInitScript(([t, d]) => {
    try {
      localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } }));
      if (d) localStorage.setItem('sr-image-draft', JSON.stringify(d));
    } catch { /* */ }
  }, [theme, draft]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log(`PAGEERROR ${theme}: ${e.message}`); fails++; });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) { console.log(`console ${theme}: ${m.text()}`); fails++; } });
  return { ctx, page };
}
const shot = async (page, name, clip) => { await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${name}.png`, ...(clip ? { clip } : {}) }); };

for (const theme of ['dark', 'light']) {
  const t = theme === 'dark' ? 'sombre' : 'clair';
  // ── Image, Qwen-Image 2.1 : les jetons de la personne, ce que le modèle lit ──
  const { ctx, page } = await newPage(theme, { model: 'qwen21', prompt: '', refs: [img.id, marc.id] });
  await page.goto(`${base}/image/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#pb-refs .pb-ref.r');
  const chips = await page.$$eval('#pb-refs .pb-ref.r .n', (l) => l.map((x) => x.textContent));
  ok(chips.join() === '@image1,@element1', `Image · Qwen (${t}) : les vignettes portent leur jeton (${chips})`);
  await shot(page, `image-qwen-vignettes-${t}`, { x: 0, y: 600, width: 1500, height: 350 });
  await page.click('#prompt');
  await page.keyboard.type('@');
  await page.waitForSelector('#pb-at:not([hidden]) .pb-atb');
  const menu = await page.$$eval('#pb-at .pb-atb', (l) => l.map((b) => b.textContent));
  ok(menu.length === 2 && menu[0].startsWith('@image1<image1>') && menu[1].startsWith('@element1<image2>'),
    `Image · Qwen (${t}) : « @ » propose @image1, @element1 et dit <image1>, <image2> (${menu})`);
  await shot(page, `image-qwen-arobase-${t}`, { x: 0, y: 600, width: 1500, height: 350 });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.type('holds a cup in front of @image1');
  ok((await page.inputValue('#prompt')) === '@element1 holds a cup in front of @image1', 'Image · Qwen : le jeton posé est celui de la personne');
  await ctx.close();
  // ── Image, Krea 2 : la scène puis le sujet ; Z-Image : pourquoi ──
  const k = await newPage(theme, { model: 'krea2', prompt: '', refs: [img.id, marc.id] });
  await k.page.goto(`${base}/image/`, { waitUntil: 'networkidle' });
  await k.page.waitForSelector('#pb-refs .pb-ref.r');
  await k.page.click('#prompt');
  await k.page.keyboard.type('@');
  await k.page.waitForSelector('#pb-at:not([hidden]) .pb-atb');
  const km = await k.page.$$eval('#pb-at .pb-atb', (l) => l.map((b) => b.textContent));
  ok(km.length === 2 && km[0].includes('la scène') && km[1].includes('le sujet'), `Image · Krea 2 (${t}) : @image1 la scène, @element1 le sujet (${km})`);
  await shot(k.page, `image-krea-arobase-${t}`, { x: 0, y: 600, width: 1500, height: 350 });
  await k.ctx.close();
  const z = await newPage(theme, { model: 'zimage', prompt: '', refs: [img.id] });
  await z.page.goto(`${base}/image/`, { waitUntil: 'networkidle' });
  await z.page.click('#prompt');
  await z.page.keyboard.type('@');
  await z.page.waitForSelector('#pb-at:not([hidden])');
  const zw = await z.page.textContent('#pb-at');
  ok(/sans référence|ne prend pas/.test(zw), `Image · Z-Image (${t}) : « @ » dit pourquoi (${zw.trim()})`);
  await z.ctx.close();

  // ── le Multishot : les temps de coupe du guide, plus de case « (about N seconds) » ──
  const m = await newPage(theme);
  await m.page.goto(`${base}/image/`, { waitUntil: 'networkidle' });
  await m.page.evaluate(async () => {
    const { openMultishot } = await import('/commun/multishot.js');
    window.__ms = '';
    openMultishot({ total: 8, lang: 'fr', mentions: [{ token: '@element1', label: 'Marc' }, { token: '@element2', label: 'Léa' }],
      desc: '[Shot 1] @element1 and @element2 eat noodles. [Shot 2] At 00:03.000, Close on @element1. @element1 (S1) says: <d>[French] Tu as pris ma part !</d> [Shot 3] At 00:05.500, They fight.',
      onApply: (x) => { window.__ms = x; } });
  });
  await m.page.waitForSelector('.ms-modal');
  const pre = await m.page.textContent('.ms-pre');
  const segs = await m.page.$$eval('.ms-seg small', (l) => l.map((x) => x.textContent));
  ok(pre.includes('[Shot 2] At 00:03.000,') && pre.includes('[Shot 3] At 00:05.500,') && segs.join() === '3 s,2,5 s,2,5 s'
     && !(await m.page.$('.ms-modal input[type=checkbox]')),
    `Multishot (${t}) : les durées relues des temps de coupe, réécrits comme le guide (${segs} · ${pre.replace(/\n/g, ' | ')})`);
  await shot(m.page, `multishot-${t}`);
  await m.ctx.close();

  // ── Admin → Diagnostics : « Rendus · ce que le modèle a reçu » ──
  const a = await newPage(theme);
  await a.page.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
  const tab = a.page.locator('text=Diagnostics').first();
  if (await tab.count()) await tab.click();
  await a.page.waitForTimeout(600);
  const has = await a.page.locator('text=Rendus · ce que le modèle a reçu').count();
  ok(has > 0, `Admin (${t}) : le diagnostic « Rendus » est dans la liste`);
  const card = a.page.locator('.card', { hasText: 'Rendus · ce que le modèle a reçu' }).first();
  await card.locator('button', { hasText: /lancer|relancer/i }).first().click();
  // la sortie lue par la route, puis la page rouverte (la page repeint seule toutes les 2 s ; l'essai ne compte pas sur elle)
  for (let k = 0; k < 60; k++) {
    const dg = (await api('admin/diag')).j;
    if ((dg.diags || []).find((x) => x.id === 'rendus')?.state === 'done') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await a.page.reload({ waitUntil: 'networkidle' });
  if (await tab.count()) await tab.click();
  await a.page.waitForTimeout(600);
  const txt = await card.textContent();
  ok(txt.includes('invite envoyée à H3') && txt.includes('<Subject 2> (S1) shouts'), `Admin (${t}) : « Rendus » montre ce que H3 a reçu`);
  await card.scrollIntoViewIfNeeded();
  await shot(a.page, `admin-diagnostics-${t}`);
  await a.ctx.close();
}

// ── ce que le serveur compile ───────────────────────────────
let r = await api('image/compose', { model: 'qwen21', prompt: '@element1 holds a cup in front of @image1', refs: [img.id, { item: marc.id }] });
ok(r.st === 200 && r.j.prompt.startsWith('<image2> holds a cup in front of <image1>.'), `compose Qwen : ${r.j.prompt?.slice(0, 60)}`);
r = await api('image/compose', { model: 'krea2', prompt: 'place @element1 in @image1', refs: [img.id, { item: marc.id }] });
ok(r.st === 200 && r.j.prompt.startsWith('place the subject in the scene.'), `compose Krea 2 : ${r.j.prompt?.slice(0, 60)}`);
r = await api('image/compose', { model: 'qwen21', prompt: '@element2 smiles', refs: [{ item: marc.id }] });
ok(r.st === 400 && /ne pointent vers rien/.test(r.j.error || ''), `compose : une mention sans place est refusée (${r.j.error})`);
const cal = 'il mange des @element1 et @element2 se dispute en francais, il en viennent aux main , cinema d\'action';
r = await api('movie/apercu', { mode: 'r2v', params: { inputs: { element: [{ item: marc.id }, { item: lea.id }] }, desc: cal } });
ok(r.st === 200 && r.j.checks?.some((c) => c.id === 'langue' && c.level === 'remarque') && r.j.pictures?.length === 4,
  `aperçu Vidéo : l'invite de Cal, 4 images, la langue signalée (${(r.j.checks || []).map((c) => `${c.id}:${c.level}`).join(' ')})`);
r = await api('movie/options');
ok(r.st === 200 && r.j.scale?.formats?.length === 7, 'options Vidéo : l’échelle des toiles');

await browser.close();
console.log(fails ? `${fails} échec(s)` : 'tout passe');
process.exit(fails ? 1 : 0);
