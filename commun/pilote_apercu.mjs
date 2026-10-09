// Le pilote de l'aperçu au survol du nom (commun/apercu.js ; docs/etudes/orchestration.md, « Fait le 09/10 ») :
// sur un portail d'essai NEUF, PORTE ALLUMÉE, avec deux fausses machines (DGX2 mesurée, DGX1 « non mesuré ») —
// jamais le portail en ligne. La file est factice : la page reçoit, à la place de GET /api/jobs, des travaux en
// cours (avec leur machine et leur avancement) et en file ; tout le reste est le vrai portail, la route des
// machines comprise (server/tools/machines_apercu.py, sa mesure seule remplacée par SR_FAUX_MACHINES).
//
//   SR_PORTE=1 SR_FAUX_MACHINES=1 python3 tools/portail_essai.py 8901 /tmp/sr_apercu/data &
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright/package.json node commun/pilote_apercu.mjs http://127.0.0.1:8901 /tmp/sr_apercu/shots
//
// Ce qu'il vérifie, dans les deux thèmes, à 1280 et à 390 px de large : aucune requête des machines tant que la
// bulle est fermée, une seule par survol (et pas de nouvelle dans les 5 s) ; les valeurs (mémoire, GPU ou « non
// mesuré », les travaux, leur avancement, le compte en file) ; la bulle repeinte quand la file change, sans requête
// de plus ; dans la fenêtre ; ni orange, ni bordure, le contraste AA de chaque texte ; on peut la survoler ;
// Échap et le clic (le menu du compte prend sa place) la ferment ; le focus clavier l'ouvre. Puis : ce que voit
// un ami (ses travaux seulement, les machines sans les raisons) ; au doigt, rien (le menu, sans requête).
// Captures dans <captures>. Rend 0 si tout passe ; le détail dans <captures>/pilote_apercu.log.
import { createRequire } from 'module';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const où = [process.env.PLAYWRIGHT, '/opt/node22/lib/node_modules/playwright/package.json', '/home/dgx/Character_Sheet/package.json']
  .find((p) => p && existsSync(p));
const { chromium, devices } = createRequire(où)('playwright');
const [base = 'http://127.0.0.1:8901', out = '/tmp/sr_apercu/shots'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// ── la file factice : ce que GET /api/jobs?limit=60 rendrait (core_api.job_out) ──
let PROG = 0.42;
function file(qui) {
  const j = (id, o) => ({ id, kind: 'image.generate', tool: 'image', lane: 'image', created: `2026-10-09T10:${id.slice(-6, -4)}:00`,
    owner: 'cal', owner_name: 'Cal', can: qui === 'cal', ...o, mine: (o.owner || 'cal') === qui });
  return [
    j('job-1009-101900-aa01', { title: 'Paysage · la crique au lever du jour', state: 'queued', position: 3, ahead: 2 }),
    j('job-1009-101800-aa02', { title: 'Ami · une affiche', state: 'queued', owner: 'lou-apercu', owner_name: 'Lou Apercu', position: 2, ahead: 1 }),
    j('job-1009-101700-aa03', { title: 'Krea 2 · variante 3', state: 'queued', position: 1, ahead: 0 }),
    j('job-1009-101600-aa04', { title: 'Réunion du lundi', kind: 'transcrire.transcribe', tool: 'transcrire', state: 'running', progress: 0.73,
      message: 'transcrit', machine: 'DGX2', started: '2026-10-09T10:16:10', owner: 'lou-apercu', owner_name: 'Lou Apercu' }),
    j('job-1009-101500-aa05', { title: 'Krea 2 · portrait de face, lumière rasante, grain de pellicule', state: 'running', progress: PROG,
      message: 'rendu en cours', machine: 'DGX2', started: '2026-10-09T10:15:05' }),
    j('job-1009-101200-aa06', { title: 'Vidéo H3 · la plage au matin', kind: 'movie.i2v', tool: 'movie', state: 'running', progress: 0,
      message: 'étape 2/5 · encode les images', machine: 'DGX1', started: '2026-10-09T10:12:30' }),
    j('job-1009-100000-aa07', { title: 'Upscale · affiche', state: 'done', progress: 1, machine: 'DGX2', finished: '2026-10-09T10:10:00' }),
  ];
}

// une personne : un contexte (son thème, sa largeur, souris ou doigt), entrée par son pseudo
async function qui(pseudo, { theme = 'dark', width = 1280, height = 820, doigt = false } = {}) {
  const dev = doigt ? devices['iPhone 13'] : {};
  const ctx = await browser.newContext({ ...dev, viewport: { width, height }, deviceScaleFactor: doigt ? dev.deviceScaleFactor : 1 });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
  }, theme);
  // Google Fonts, jsdelivr : bloqués dans une session cloud ; la page vit sans
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const r = await ctx.request.post(`${base}/api/auth/enter`, { data: { name: pseudo }, headers: { Origin: base } });
  ok(r.status() === 200, `${pseudo} entre (${r.status()})`);
  return ctx;
}
async function ouvrirPage(ctx, tag, vue) {
  const p = await ctx.newPage();
  const req = { mach: 0, jobs: 0 };
  p.on('request', (q) => {
    if (q.url().includes('/api/machines/apercu')) req.mach++;
    if (/\/api\/jobs\?limit=60$/.test(q.url())) req.jobs++;
  });
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = m.location()?.url || '';
    const ailleurs = /^Failed to load resource/.test(m.text()) && !url.startsWith(base);
    log.push(`console ${tag}: ${m.text()} ${url}`);
    if (!ailleurs) { fails++; console.log(log.at(-1)); }
  });
  p.on('pageerror', (e) => { log.push(`PAGEERROR ${tag}: ${e.message}`); fails++; console.log(log.at(-1)); });
  await p.route(/\/api\/jobs\?limit=60$/, (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ jobs: file(vue), ev_seq: 0 }) }));
  await p.goto(`${base}/upscale/`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#sr-me:not([hidden])');
  await p.waitForTimeout(1500);
  return { p, req };
}
const bulleOuverte = (p) => p.evaluate(() => !!document.querySelector('.sr-apercu'));
const texte = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((n) => n.textContent.replace(/ /g, ' ').trim()), sel);
async function survoler(p) {
  await p.mouse.move(5, 300);
  await p.hover('#sr-me');
  await p.waitForSelector('.sr-apercu', { timeout: 3000 }).catch(() => null);
}
// le thème dans la bulle : aucune bordure, aucun orange (--or), chaque texte au contraste AA sur son fond
async function theme(p, tag) {
  const r = await p.evaluate(() => {
    const b = document.querySelector('.sr-apercu');
    if (!b) return null;
    const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, bl]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
    };
    const contraste = (a, c) => { const [x, y] = [lum(a), lum(c)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const sonde = document.createElement('i');
    sonde.style.color = 'var(--or)';
    b.append(sonde);
    const orange = getComputedStyle(sonde).color;
    sonde.remove();
    const fond = rgb(getComputedStyle(b).backgroundColor);
    const tous = [b, ...b.querySelectorAll('*')];
    const bords = tous.filter((n) => ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(getComputedStyle(n)[`border${s}Width`]) > 0)).length;
    const oranges = tous.filter((n) => { const s = getComputedStyle(n); return s.color === orange || s.backgroundColor === orange; }).length;
    const faibles = [];
    for (const n of tous) {
      if (![...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
      const k = contraste(rgb(getComputedStyle(n).color), fond);
      if (k < 4.5) faibles.push(`${n.className || n.tagName} ${k.toFixed(2)}`);
    }
    const rb = b.getBoundingClientRect();
    const go = document.querySelectorAll('.tb.go').length;
    return { bords, oranges, faibles, gauche: rb.left, droite: rb.right, bas: rb.bottom, W: innerWidth, H: innerHeight, go,
      theme: document.documentElement.dataset.theme || 'dark' };
  });
  if (!r) return ok(false, `${tag} : la bulle pour le thème`);
  ok(r.bords === 0, `${tag} : des filets, aucune bordure (${r.bords})`);
  ok(r.oranges === 0, `${tag} : pas d'orange, ce n'est pas une action (${r.oranges})`);
  ok(!r.faibles.length, `${tag} : chaque texte au contraste AA, 4,5:1 (${r.faibles.join(', ') || 'tous'})`);
  ok(r.gauche >= 0 && r.droite <= r.W - 7 && r.bas <= r.H, `${tag} : dans la fenêtre (${Math.round(r.gauche)}…${Math.round(r.droite)} / ${r.W})`);
  return r;
}

// ── 1. Cal, souris : les deux thèmes, deux largeurs ──
for (const th of ['dark', 'light']) {
  for (const w of [1280, 390]) {
    const tag = `Cal ${th} ${w}`;
    PROG = 0.42;
    const ctx = await qui('nico007', { theme: th, width: w, height: w > 600 ? 820 : 844 });
    const { p, req } = await ouvrirPage(ctx, tag, 'cal');
    await p.waitForTimeout(2500);
    ok(req.mach === 0, `${tag} : aucune requête des machines tant que la bulle est fermée (${req.mach})`);
    ok(!(await p.evaluate(() => document.getElementById('sr-me').hasAttribute('title'))), `${tag} : le nom n'a plus de bulle du navigateur (title)`);
    await survoler(p);
    await p.waitForSelector('.sr-apercu .ap-r', { timeout: 4000 }).catch(() => null);
    ok(await bulleOuverte(p), `${tag} : la bulle s'ouvre au survol du nom`);
    ok(req.mach === 1, `${tag} : une requête des machines pour ce survol (${req.mach})`);
    const ms = await texte(p, '.sr-apercu .ap-r');
    ok(ms.length === 2 && /^DGX2/.test(ms[0]) && ms[0].includes('42 / 130 Go') && ms[0].includes('GPU 37 %'),
      `${tag} : DGX2, la mémoire utilisée / totale et le GPU (${ms[0]})`);
    ok(/^DGX1/.test(ms[1] || '') && (ms[1] || '').includes('76 / 107 Go') && (ms[1] || '').includes('GPU non mesuré'),
      `${tag} : DGX1, sans mesure du GPU : « non mesuré » (${ms[1]})`);
    const largeur = await p.evaluate(() => [...document.querySelectorAll('.sr-apercu .ap-r .ap-bar > i')].map((n) => n.style.width));
    ok(largeur[0] === '32%' && largeur[1] === '71%', `${tag} : les barres de mémoire (${largeur})`);
    const js = await texte(p, '.sr-apercu .ap-j');
    ok(js.length === 3 && js[0].startsWith('Vidéo H3') && js[0].includes('DGX1') && js[0].includes('étape 2/5'),
      `${tag} : le plus ancien d'abord, son étape quand il n'a pas de pourcentage (${js[0]})`);
    ok((js[1] || '').startsWith('Krea 2 · portrait') && js[1].includes('DGX2') && js[1].includes('42 %'), `${tag} : un travail, sa machine, 42 % (${js[1]})`);
    ok((js[2] || '').includes('73 %'), `${tag} : Cal voit aussi les travaux des autres (${js[2]})`);
    const n = await texte(p, '.sr-apercu .ap-n');
    ok(n[0] === 'en cours3en file3', `${tag} : en cours, en file : deux chiffres (${n[0]})`);
    const r = await theme(p, tag);
    ok(r && r.theme === th, `${tag} : le thème posé (${r && r.theme})`);
    await p.waitForTimeout(150);
    const clip = w > 600 ? { x: w - 460, y: 0, width: 460, height: 330 } : { x: 0, y: 0, width: w, height: 400 };
    await p.screenshot({ path: `${out}/apercu-cal-${th}-${w}.png`, clip });
    if (th === 'dark' && w === 1280) {
      // la file bouge : repeinte au relevé suivant, sans requête des machines
      PROG = 0.8;
      await p.waitForFunction(() => [...document.querySelectorAll('.sr-apercu .ap-j')].some((n) => n.textContent.includes('80')), null, { timeout: 5000 }).catch(() => null);
      ok((await texte(p, '.sr-apercu .ap-j')).some((t) => t.includes('80 %')), `${tag} : la bulle suit la file (80 %)`);
      ok(req.mach === 1, `${tag} : toujours une seule requête des machines, bulle ouverte (${req.mach})`);
      // on peut la survoler (WCAG 1.4.13)
      const bb = await p.locator('.sr-apercu').boundingBox();
      await p.mouse.move(bb.x + bb.width / 2, bb.y + 4, { steps: 4 });
      await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 4 });
      await p.waitForTimeout(500);
      ok(await bulleOuverte(p), `${tag} : la bulle reste quand le pointeur passe dessus`);
      // partie : fermée ; revenue dans les 5 s, aucune requête de plus
      await p.mouse.move(w / 2, 500, { steps: 3 });
      await p.waitForTimeout(400);
      ok(!(await bulleOuverte(p)), `${tag} : le pointeur parti, elle se ferme`);
      await survoler(p);
      ok(await bulleOuverte(p) && req.mach === 1, `${tag} : rouverte dans les 5 s : la réponse resservie (${req.mach})`);
      await p.keyboard.press('Escape');
      await p.waitForTimeout(150);
      ok(!(await bulleOuverte(p)), `${tag} : Échap la ferme`);
      await p.mouse.move(w / 2, 500);
      await p.waitForTimeout(5600);
      ok(req.mach === 1, `${tag} : fermée, rien en boucle (${req.mach})`);
      await survoler(p);
      await p.waitForTimeout(400);
      ok(req.mach === 2, `${tag} : un nouveau survol, passé 5 s : une requête (${req.mach})`);
      // le clic : le menu du compte prend sa place
      await p.click('#sr-me');
      await p.waitForSelector('.acct', { timeout: 3000 }).catch(() => null);
      await p.waitForTimeout(400);
      ok(await p.evaluate(() => !!document.querySelector('.acct') && !document.querySelector('.sr-apercu')),
        `${tag} : le clic ouvre le menu du compte, la bulle s'efface`);
      await p.screenshot({ path: `${out}/apercu-cal-menu-${th}-${w}.png`, clip });
      await p.keyboard.press('Escape');
      await p.mouse.move(w / 2, 500);
      await p.waitForTimeout(400);
      // le focus clavier
      await p.evaluate(() => document.activeElement?.blur());
      await p.keyboard.press('Shift');
      await p.evaluate(() => document.getElementById('sr-me').focus());
      await p.waitForSelector('.sr-apercu', { timeout: 2000 }).catch(() => null);
      ok(await bulleOuverte(p), `${tag} : le focus clavier l'ouvre aussi`);
      ok(await p.evaluate(() => document.getElementById('sr-me').getAttribute('aria-describedby') === 'sr-apercu'),
        `${tag} : le nom est décrit par la bulle (aria-describedby)`);
      await p.keyboard.press('Escape');
      await p.waitForTimeout(150);
      ok(!(await bulleOuverte(p)), `${tag} : Échap la ferme, au clavier aussi`);
    }
    await ctx.close();
  }
}

// ── 2. un ami : ses travaux seulement ; les machines, sans les raisons ──
{
  const cal = await browser.newContext();
  await cal.request.post(`${base}/api/auth/enter`, { data: { name: 'nico007' }, headers: { Origin: base } });
  const r = await cal.request.post(`${base}/api/admin/users`, { data: { name: 'Lou Apercu' }, headers: { Origin: base } });
  ok([200, 409].includes(r.status()), `Cal crée l'ami Lou Apercu (${r.status()})`);
  await cal.close();
  for (const th of ['dark', 'light']) {
    const tag = `ami ${th} 1280`;
    const ctx = await qui('Lou Apercu', { theme: th });
    const { p, req } = await ouvrirPage(ctx, tag, 'lou-apercu');
    await survoler(p);
    await p.waitForSelector('.sr-apercu .ap-r', { timeout: 4000 }).catch(() => null);
    const js = await texte(p, '.sr-apercu .ap-j');
    ok(js.length === 1 && js[0].startsWith('Réunion du lundi') && js[0].includes('73 %'), `${tag} : ses travaux seulement (${js.join(' | ')})`);
    const n = await texte(p, '.sr-apercu .ap-n');
    ok(n[0] === 'en cours1en file1', `${tag} : ses comptes (${n[0]})`);
    ok((await texte(p, '.sr-apercu .ap-r')).length === 2 && req.mach === 1, `${tag} : les machines, que le portail lui montre (${req.mach})`);
    const titres = await p.evaluate(() => [...document.querySelectorAll('.sr-apercu .ap-r')].map((n) => n.title));
    ok(titres.every((t) => !t.includes('GPU :')), `${tag} : sans les raisons internes (${titres.join(' | ')})`);
    await theme(p, tag);
    await p.screenshot({ path: `${out}/apercu-ami-${th}-1280.png`, clip: { x: 820, y: 0, width: 460, height: 300 } });
    await ctx.close();
  }
}

// ── 3. au doigt : rien ; toucher le nom ouvre son menu, sans requête des machines ──
{
  const tag = 'doigt dark 390';
  const ctx = await qui('nico007', { doigt: true, width: 390, height: 844 });
  const { p, req } = await ouvrirPage(ctx, tag, 'cal');
  await p.tap('#sr-me');
  await p.waitForSelector('.acct', { timeout: 3000 }).catch(() => null);
  await p.waitForTimeout(600);
  ok(await p.evaluate(() => !!document.querySelector('.acct') && !document.querySelector('.sr-apercu')), `${tag} : le menu du nom, pas de bulle`);
  ok(req.mach === 0, `${tag} : aucune requête des machines (${req.mach})`);
  await p.screenshot({ path: `${out}/apercu-doigt-dark-390.png`, clip: { x: 0, y: 0, width: 390, height: 520 } });
  await ctx.close();
}

await browser.close();
writeFileSync(`${out}/pilote_apercu.log`, log.join('\n') + '\n');
console.log(fails ? `${fails} échec(s)` : 'tout passe');
process.exit(fails ? 1 : 0);
