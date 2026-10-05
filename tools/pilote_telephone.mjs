// Le pilote du téléphone (Chromium sans affichage, Playwright) : les pages faites pour le téléphone
// (data-appareil="mobile", commun/theme-tot.js), à 390 × 844 (iPhone 15) et 412 × 915 (Pixel 7), en
// portrait et en paysage, dans les deux thèmes ; la tablette (iPad Mini) pour vérifier qu'elle n'est
// pas un téléphone. C'est Chromium avec l'agent et la taille d'un téléphone, pas Safari : ni les bords
// de l'encoche (env(safe-area-inset-*) y vaut 0), ni la barre d'adresse qui se replie (svh), ni le
// plein écran de la vidéo par le système ne s'y voient.
//
//   node tools/pilote_telephone.mjs http://127.0.0.1:8846 /tmp/sr_telephone_captures
//   (un portail d'essai : python3 tools/portail_essai.py 8846 /tmp/sr_telephone ; jamais le portail en ligne)
//
// Pour chaque page et chaque profil : pas de défilement horizontal ; aucune erreur de console ; au plus un
// .tb.go visible ; chaque cible au doigt fait 44 × 44 px (WCAG 2.2, 2.5.5 ; Apple HIG) — sondée : un
// carré de 44 px centré sur chaque contrôle visible, point par point (elementFromPoint : un ::after qui
// élargit la cible compte, un voisin qui la recouvre aussi), écran par écran jusqu'au bas de la page ;
// un lien dans une phrase et un objet de la planche d'Idéation (il grandit avec le zoom) n'en sont pas.
// Puis les gestes : la barre au même x partout ; l'écran d'un outil à grand écran et « Ouvrir quand
// même » ; Idéation au doigt (la Main, Plan, Note, Photo, toucher une image). Une capture de chaque.
// Rend 0 si tout passe ; le détail dans <captures>/pilote_telephone.log.
import { createRequire } from 'module';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const où = ['/opt/node22/lib/node_modules/playwright/package.json', '/home/dgx/Character_Sheet/package.json'].find((p) => existsSync(p));
const { chromium, devices } = createRequire(où)(où.includes('Character_Sheet') ? 'playwright' : '/opt/node22/lib/node_modules/playwright');
const [base = 'http://127.0.0.1:8846', out = '/tmp/sr_telephone_captures'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };
const api = async (path, { body, method, raw, type } = {}) => {
  const r = await fetch(`${base}/api/${path}`, { method: method || (body || raw ? 'POST' : 'GET'),
    headers: raw ? { 'Content-Type': type || 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {},
    body: raw || (body ? JSON.stringify(body) : undefined) });
  return r.json();
};

// ── les données : une image, un son, une planche (faites par l'API si elles manquent) ──
function png(w, h) {   // un PNG plein, sans bibliothèque : IHDR, IDAT (zlib « stored »), IEND
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) row.set([200, 90 + (x % 64), 60], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const blocks = [];
  for (let i = 0; i < raw.length; i += 65535) { const p = raw.subarray(i, i + 65535); const hd = Buffer.alloc(5); hd[0] = i + 65535 >= raw.length ? 1 : 0; hd.writeUInt16LE(p.length, 1); hd.writeUInt16LE(~p.length & 0xffff, 3); blocks.push(hd, p); }
  let a = 1, b2 = 0; for (const x of raw) { a = (a + x) % 65521; b2 = (b2 + a) % 65521; }
  const ad = Buffer.alloc(4); ad.writeUInt32BE(((b2 << 16) | a) >>> 0);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', Buffer.concat([Buffer.from([0x78, 1]), ...blocks, ad])), chunk('IEND', Buffer.alloc(0))]);
}
function wav(s = 6, sr = 22050) {
  const n = s * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / sr) * 2 * Math.PI * 330) * 9000 * (1 - (i % sr) / sr)), 44 + i * 2);
  return b;
}
const lib = (await api('library?limit=200')).items || [];
let img = lib.find((it) => it.kind === 'image' && it.title === 'tel_image');
if (!img) img = await api('library/upload?name=tel_image.png&title=tel_image', { method: 'PUT', raw: png(640, 960), type: 'image/png' });
let son = lib.find((it) => it.kind === 'audio' && it.title === 'tel_son');
if (!son) son = await api('library/upload?name=tel_son.wav&title=tel_son', { method: 'PUT', raw: wav(), type: 'audio/wav' });
let board = ((await api('ideation/boards')).boards || []).find((b) => b.name === 'Planche du téléphone');
if (!board) {
  board = await api('ideation/boards', { body: { name: 'Planche du téléphone' } });
  await api(`ideation/boards/${board.id}`, { body: { name: 'Planche du téléphone', base_rev: board.rev, links: [], nodes: [
    { id: 't1', type: 'title', x: 0, y: -120, w: 520, h: 60, text: 'Repérages' },
    { id: 'm1', type: 'media', x: 0, y: 0, w: 300, h: 450, item: img.id, kind: 'image', title: 'tel_image' },
    { id: 'n1', type: 'note', x: 340, y: 0, w: 260, h: 100, text: 'La lumière tombe à 17 h.' },
    { id: 'a1', type: 'media', x: 340, y: 160, w: 260, h: 104, item: son.id, kind: 'audio', title: 'tel_son' }] } });
}
// une transcription complète du son (le moteur factice : quelques secondes)
let trn = ((await api('transcrire/docs')).docs || []).find((d) => d.item === son.id && d.mode === 'complet');
if (!trn) trn = (await api('transcrire/run', { body: { item: son.id, mode: 'complet' } })).doc;
for (let k = 0; k < 60 && trn && trn.state !== 'done'; k++) { await new Promise((r) => setTimeout(r, 1000)); const d = await api(`transcrire/docs/${trn.id}`); trn = d.doc || d; }
ok(!!(img?.id && son?.id && board?.id && trn?.state === 'done'), `les données d’essai : ${img?.id}, ${son?.id}, ${board?.id}, ${trn?.id} (${trn?.state})`);

const PAGES = [
  ['accueil', ''], ['porte', '', { porte: true }], ['asset', 'asset/'], ['fiche-image', `asset/#${img.id}`], ['fiche-son', `asset/#${son.id}`],
  ['transcrire', 'transcrire/'], ['transcription', `transcrire/#${trn.id}`], ['musique-app', 'chanson/'], ['ideation', `ideation/#${board.id}`],
  ['odio', 'musique/'], ['montage', 'montage/'], ['image', 'image/'], ['video', 'movie/'],
];
const PROFILS = [
  ['iphone', devices['iPhone 15'], 390, 844], ['iphone-paysage', devices['iPhone 15'], 844, 390],
  ['android', devices['Pixel 7'], 412, 915], ['android-paysage', devices['Pixel 7'], 915, 412],
];
// la sonde des cibles, à cet écran
const SONDE = () => {
  const W = innerWidth, H = innerHeight;
  window.__ids = window.__ids || new WeakMap(); window.__n = window.__n || 0;
  const idOf = (e) => { if (!window.__ids.has(e)) window.__ids.set(e, ++window.__n); return window.__ids.get(e); };
  const vis = (e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null; const cs = getComputedStyle(e); return cs.visibility === 'hidden' || +cs.opacity === 0 ? null : r; };
  const a = (e, x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === e || e.contains(h) || [...(e.labels || [])].some((l) => l.contains(h))); };
  const bons = [], ko = [];
  for (const e of document.querySelectorAll('a[href], button, input:not([type=hidden]):not([type=file]), select, textarea, [role=button], [role=menuitem], [role=tab], summary')) {
    const lab = /^(checkbox|radio)$/.test(e.type || '') && e.labels?.[0]?.contains(e) ? e.labels[0] : null;
    const r = vis(lab || e); if (!r || r.top < 0 || r.bottom > H || r.left < 0 || r.right > W) continue;
    if (e.tagName === 'A' && getComputedStyle(e).display === 'inline' && e.closest('p')) continue;
    if (getComputedStyle(e).pointerEvents === 'none' || e.closest('.world')) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, d = 21;
    if (!a(e, cx, cy)) continue;
    const pts = r.width >= 44 && r.height >= 44 ? [] : [[cx - d, cy], [cx + d, cy], [cx, cy - d], [cx, cy + d], [cx - d, cy - d], [cx + d, cy - d], [cx - d, cy + d], [cx + d, cy + d]];
    if (pts.every(([x, y]) => x < 0 || y < 0 || x > W || y > H || a(e, x, y))) bons.push(idOf(e));
    else ko.push([idOf(e), `${e.tagName.toLowerCase()}.${String(e.className).trim().split(/\s+/).slice(0, 2).join('.')} ${Math.round(r.width)}×${Math.round(r.height)} « ${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24)} »`]);
  }
  const go = [...document.querySelectorAll('.tb.go')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.bottom > 0 && r.top < H && getComputedStyle(e).visibility !== 'hidden' && a(e, r.left + r.width / 2, r.top + r.height / 2); }).length;
  return { bons, ko, go, plus: scrollY + H < document.scrollingElement.scrollHeight - 2 };
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
async function contexte(dev, w, h, theme) {
  const ctx = await browser.newContext({ ...dev, viewport: { width: w, height: h }, screen: { width: w, height: h } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ } }, theme);
  // Google Fonts, jsdelivr : bloqués dans une session cloud ; la page vit sans
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  return ctx;
}
async function page(ctx, chemin, { porte = false } = {}) {
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 200)));
  if (porte) await p.route(/\/api\/auth\/me/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ auth: true, state: 'anonymous', sur_liste: true }) }));
  await p.goto(`${base}/${chemin}`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3200);
  return { p, errs };
}

// ── 1. chaque page, chaque profil, les deux thèmes ──
for (const theme of ['dark', 'light']) {
  for (const [nom, dev, w, h] of theme === 'light' ? PROFILS.slice(0, 1) : PROFILS) {
    const ctx = await contexte(dev, w, h, theme);
    for (const [pg, chemin, opt] of PAGES) {
      const { p, errs } = await page(ctx, chemin, opt);
      const tag = `[${nom} ${theme}] ${pg}`;
      const app = await p.evaluate(() => document.documentElement.dataset.appareil);
      const sw = await p.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
      await p.screenshot({ path: `${out}/${pg}-${nom}-${theme}.png` });
      const vus = new Set(), ko = new Map();
      let go = 0;
      const H = await p.evaluate(() => document.scrollingElement.scrollHeight);
      for (let y = 0; y < Math.min(H, 12000); y += Math.round(h * 0.8)) {
        await p.evaluate((yy) => scrollTo(0, yy), y);
        await p.waitForTimeout(150);
        const r = await p.evaluate(SONDE);
        r.bons.forEach((i) => vus.add(i)); r.ko.forEach(([i, t]) => { vus.add(i); ko.set(i, t); });
        go = Math.max(go, r.go);
        if (!r.plus) break;
      }
      ok(app === 'mobile', `${tag} : data-appareil = ${app}`);
      ok(sw <= 0, `${tag} : pas de défilement horizontal (${sw > 0 ? '+' + sw + ' px' : 'non'})`);
      ok(!errs.length, `${tag} : aucune erreur de console ${errs.length ? errs.join(' | ') : ''}`);
      ok(go <= 1, `${tag} : un seul bouton orange visible à la fois (${go})`);
      ok(!ko.size, `${tag} : ${vus.size} cibles, toutes de 44 px au moins ${ko.size ? '— ' + [...ko.values()].join(' ; ') : ''}`);
      await p.close();
    }
    await ctx.close();
  }
}

// ── 2. la barre : le même ordre, la navigation au même x sur chaque page ──
{
  const ctx = await contexte(devices['iPhone 15'], 390, 844, 'dark');
  const xs = [];
  for (const [pg, chemin] of [['accueil', ''], ['asset', 'asset/'], ['transcrire', 'transcrire/'], ['ideation', `ideation/#${board.id}`], ['odio', 'musique/'], ['admin', 'admin/']]) {
    const { p } = await page(ctx, chemin);
    const r = await p.evaluate(() => [...document.querySelectorAll('.hdr .logo, .hdr .tools-btn, #sr-asset, #sr-prefs, #sr-me')].map((e) => Math.round(e.getBoundingClientRect().left)));
    xs.push([pg, r.join(',')]);
    await p.close();
  }
  ok(new Set(xs.map(([, v]) => v)).size === 1, `la barre au même x sur chaque page (logo, Outils, Asset, roue, nom : ${xs[0][1]})`);
  await ctx.close();
}

// ── 3. un outil à grand écran : l'écran du téléphone, puis « Ouvrir quand même » ──
{
  const ctx = await contexte(devices['Pixel 7'], 412, 915, 'dark');
  const { p, errs } = await page(ctx, 'montage/');
  ok(await p.isVisible('.sr-tel'), 'Montage au téléphone : l’écran du téléphone');
  ok(await p.evaluate(() => [...document.body.children].filter((e) => !e.matches('.hdr, .sr-tel, .drawer, .toast, script, link, style') && getComputedStyle(e).display !== 'none').length === 0),
    'Montage au téléphone : la page de l’outil est cachée');
  await p.tap('.sr-tel-acts .tb >> text=La file des calculs');
  await p.waitForTimeout(500);
  ok(await p.isVisible('.drawer.on'), 'Montage au téléphone : « La file des calculs » ouvre la file');
  await p.tap('.drawer .pan-head .tb');
  await p.waitForTimeout(300);
  await p.tap('.sr-tel-acts .tb >> text=Ouvrir quand même');
  await p.waitForTimeout(1200);
  ok(!(await p.isVisible('.sr-tel')) && await p.evaluate(() => !document.documentElement.classList.contains('sr-tel-lourd')), '« Ouvrir quand même » : la page du Montage');
  await p.screenshot({ path: `${out}/montage-ouvert-android.png` });
  await p.reload(); await p.waitForTimeout(2500);
  ok(!(await p.isVisible('.sr-tel')), '« Ouvrir quand même » tient pour l’onglet (rechargé)');
  ok(!errs.length, `Montage au téléphone : aucune erreur de console ${errs.join(' | ')}`);
  await ctx.close();
}

// ── 4. Idéation au doigt ──
{
  const ctx = await contexte(devices['iPhone 15'], 390, 844, 'dark');
  const { p, errs } = await page(ctx, `ideation/#${board.id}`);
  const S = () => p.evaluate(() => ({ n: window.ideation.S.board.nodes.length, tool: window.ideation.S.tool }));
  const s0 = await S();
  ok(s0.tool === 'hand', `Idéation : un doigt déplace la vue (outil ${s0.tool})`);
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('#insp')).display === 'none' && getComputedStyle(document.querySelector('.ide-side')).display === 'none'),
    'Idéation : ni inspecteur ni barre latérale, la planche en entier');
  await p.tap('.ide-tel-b.plan'); await p.waitForTimeout(400);
  const lignes = await p.locator('.ide-tel-l').count();
  ok(lignes === s0.n, `Plan : ${lignes} lignes pour ${s0.n} objets`);
  await p.screenshot({ path: `${out}/ideation-plan.png` });
  await p.tap('.ide-tel-l >> nth=0'); await p.waitForTimeout(500);
  ok(!(await p.isVisible('.ide-tel-plan')), 'Plan : toucher une ligne y mène (la boîte se ferme)');
  await p.tap('.ide-tel-b.note'); await p.waitForTimeout(300);
  await p.fill('.ide-tel-ta', 'Écrite au téléphone.');
  await p.tap('.modal .tb.go'); await p.waitForTimeout(700);
  const s1 = await S();
  ok(s1.n === s0.n + 1 && await p.evaluate(() => window.ideation.S.board.nodes.some((n) => n.type === 'note' && n.text === 'Écrite au téléphone.')), 'Note : posée sur la planche');
  ok(s1.tool === 'hand', 'Note : la Main revient');
  await p.setInputFiles('.ide-tel-barre input[type=file]', { name: 'photo.png', mimeType: 'image/png', buffer: png(800, 600) });
  await p.waitForTimeout(2500);
  ok((await S()).n === s1.n + 1, 'Photo : la photo est posée');
  await p.tap('.ide-tel-b.tout'); await p.waitForTimeout(500);
  const c = await p.evaluate((id) => { const r = document.querySelector(`[data-id="${id}"]`).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, 'm1');
  await p.touchscreen.tap(c[0], c[1]); await p.waitForTimeout(700);
  ok(await p.isVisible('.modal.lb'), 'toucher une image : elle s’ouvre en grand');
  await p.screenshot({ path: `${out}/ideation-en-grand.png` });
  ok(!errs.length, `Idéation au téléphone : aucune erreur de console ${errs.join(' | ')}`);
  await ctx.close();
}

// ── 5. la tablette n'est pas un téléphone ──
{
  const ctx = await contexte(devices['iPad Mini'], 768, 1024, 'dark');
  const { p, errs } = await page(ctx, 'montage/');
  const app = await p.evaluate(() => document.documentElement.dataset.appareil);
  ok(app === 'tablette' && !(await p.isVisible('.sr-tel')), `la tablette (data-appareil = ${app}) : le Montage, sans l’écran du téléphone`);
  ok(!errs.length, `la tablette : aucune erreur de console ${errs.join(' | ')}`);
  await ctx.close();
}

await browser.close();
writeFileSync(`${out}/pilote_telephone.log`, log.join('\n') + '\n');
console.log(fails ? `\n${fails} en échec` : '\ntout passe');
process.exit(fails ? 1 : 0);
