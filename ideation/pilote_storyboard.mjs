// Le pilote du storyboard de l'agent (lot 1 de l'agent autonome : docs/etudes/agent_autonome.md § 9.6) : un portail
// d'essai branché sur le faux Ollama, jamais le portail en ligne. Dans une session cloud (le playwright de /opt/node22),
// ou sur DGX2 (celui de ~/Character_Sheet) :
//
//   python3 tools/faux_ollama.py --port 8882 --delay 0.4 &
//   SR_OLLAMA_URL=http://127.0.0.1:8882 python3 tools/portail_essai.py 8881 /tmp/sr_sb &
//   node ideation/pilote_storyboard.mjs http://127.0.0.1:8881 /tmp/sr_sb_shots
//
// Une planche neuve (le scénario, un Fountain, posé dessus ; Lina, un personnage du Workspace) ; le scénario cité dans le
// champ, « fais le storyboard de la séquence 3 » → l'accusé affiché en moins d'une seconde → la question (le rendu) → le
// découpage (4 plans) → une ligne supprimée, deux fusionnées → « Valider le découpage » → la planche posée en UN pas
// d'annulation, les cases dans l'ordre, sans chevauchement, chaque case avec sa note et sa carte prête, Lina branchée sur
// la sienne → « Annuler ce tour » : la planche revient identique → « Reposer » → « Lancer les 2 images » : 2 travaux en
// file. Captures en sombre et en clair. Rend 0 si tout passe ; le détail dans <out>/pilote.log.
import { createRequire } from 'module';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';

const where = [process.env.SR_PLAYWRIGHT, '/opt/node22/lib/node_modules/playwright', `${homedir()}/Character_Sheet/node_modules/playwright`].find((p) => p && existsSync(p));
const { chromium } = createRequire(import.meta.url)(where || 'playwright');
const [base = 'http://127.0.0.1:8881', out = '/tmp/sr_sb_shots'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, { method = 'GET', body, raw, type = 'application/json' } = {}) => {
  const r = await fetch(`${base}/api/${path}`, { method, headers: body || raw ? { 'Content-Type': type } : {}, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  return r.json();
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const QUAI = 'Title: Le quai\n\nINT. BAR - NUIT #2#\n\nLina boit seule au comptoir.\n\nEXT. QUAI - NUIT #3#\n\nLa pluie tombe sur le quai désert.\n\n'
  + 'Lina attend sous un réverbère.\n\nLINA\nIl ne viendra pas.\n\nUn train passe sans s\'arrêter.\n\nLina ferme les yeux.\n\nINT. VOITURE - JOUR #4#\n\nIls roulent.\n';

async function planche(theme) {
  const b = await api('ideation/boards', { method: 'POST', body: { name: `Storyboard ${theme}` } });
  const doc = await api('library/upload?name=quai.fountain&title=Le%20quai&tool=upload', { method: 'PUT', raw: QUAI, type: 'text/plain' });
  const img = await api('library/upload?name=lina.png&title=Lina%20face&tool=upload', { method: 'PUT', raw: PNG, type: 'image/png' });
  const lina = await api('elements', { method: 'POST', body: { title: 'Lina', type: 'character', description: 'une danseuse en manteau rouge', refs: [{ item: img.id, role: 'face' }] } });
  const nodes = [{ id: 'nd1', type: 'media', item: doc.id, kind: 'document', x: 0, y: 0, w: 240, h: 320, title: 'Le quai' }];
  await api(`ideation/boards/${b.id}`, { method: 'POST', body: { name: b.name, nodes, links: [], base_rev: 1 } });
  return { bid: b.id, doc: doc.id, lina: lina.id };
}

const browser = await chromium.launch(existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
for (const theme of ['dark', 'light']) {
  const P = await planche(theme);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 } });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } }));
      localStorage.removeItem('ide-agent-open');
    } catch { /* */ }
  }, theme);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') { log.push(`console ${theme}: ${m.text()}`); fails++; } });
  page.on('pageerror', (e) => { log.push(`PAGEERROR ${theme}: ${e.message}`); fails++; });
  const st = () => page.evaluate(() => { const { S } = window.ideation; return { n: S.board.nodes.length, l: S.board.links.length, undo: S.undo.length }; });
  const snap = () => page.evaluate(() => { const B = window.ideation.S.board; return JSON.stringify([B.name, B.nodes.map((n) => [n.id, n.x, n.y, n.w, n.h, n.group || '']), B.links.map((l) => [l.a, l.b, l.kind])]); });
  await page.goto(`${base}/ideation/#${P.bid}`);
  await page.waitForFunction(() => window.ideation?.app?.agent && window.ideation.S.board?.nodes?.length === 1 && window.ideation.S.cfg, null, { timeout: 20000 });
  ok(await page.evaluate(() => document.documentElement.dataset.theme || 'dark') === theme || theme === 'dark', `${theme} : le thème posé`);
  await page.click('#cv', { position: { x: 900, y: 700 } });
  await page.keyboard.press('i');
  ok(await page.isVisible('.ag'), `${theme} : la touche I ouvre le panneau`);
  // le scénario cité : le clic droit de sa carte sur la planche
  const c = await page.evaluate(() => { const r = document.querySelector('.cv .nd[data-id="nd1"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.mouse.click(c[0], c[1], { button: 'right' });
  await page.click('text=Citer dans la discussion');
  ok((await page.$$('.ag-pcs .ag-pc')).length === 1, `${theme} : le scénario cité au-dessus du champ`);
  // l'accusé tout de suite
  await page.fill('.ag-ta', 'fais le storyboard de la séquence 3');
  const t0 = Date.now();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.ag-acc', { timeout: 5000 });
  const dt = Date.now() - t0;
  const acc = await page.textContent('.ag-acc');
  ok(dt < 1000 && /^Reçu : 1 document/.test(acc.trim()), `${theme} : l'accusé affiché en ${dt} ms (« ${acc.trim()} »)`);
  // la question : le rendu des cases
  await page.waitForSelector('.ag-qcard .ag-opt', { timeout: 30000 });
  const qs = await page.locator('.ag-qcard .ag-qt').allTextContents();
  ok(qs.length === 1 && /cases/i.test(qs[0]) && (await st()).n === 1, `${theme} : une question (${qs.join(' | ')}), rien de posé`);
  await page.screenshot({ path: `${out}/${theme}-1-question.png` });
  await page.click('.ag-qcard .ag-opt:text-is("photoréaliste")');
  await page.click('.ag-qcard button:text-is("Répondre")');
  // le découpage
  await page.waitForSelector('.ag-dec .ag-dl[data-plan]', { timeout: 30000 });
  const n0 = await page.locator('.ag-dec .ag-dl').count();
  ok(n0 === 4 && (await st()).n === 1, `${theme} : le découpage arrive (${n0} plans), toujours rien de posé`);
  await page.screenshot({ path: `${out}/${theme}-2-decoupage.png` });
  await page.click('.ag-dl[data-plan="4"] button[aria-label="supprimer ce plan"]');
  await page.waitForFunction(() => document.querySelectorAll('.ag-dec .ag-dl').length === 3, null, { timeout: 10000 });
  await page.click('.ag-dl[data-plan="2"] button[aria-label="fusionner avec le suivant"]');
  await page.waitForFunction(() => document.querySelectorAll('.ag-dec .ag-dl').length === 2, null, { timeout: 10000 });
  const merged = await page.inputValue('.ag-dl[data-plan="2"] textarea');
  ok(/réverbère.*\/.*train/.test(merged), `${theme} : une ligne supprimée, deux fusionnées (« ${merged.slice(0, 80)} »)`);
  const cut = await page.isDisabled('.ag-dl[data-plan="2"] button[aria-label="fusionner avec le suivant"]');
  ok(cut && (await page.getAttribute('.ag-dl[data-plan="2"] button[aria-label="fusionner avec le suivant"]', 'title')).includes('suivant'),
    `${theme} : une action éteinte dit pourquoi (le dernier plan n'a pas de suivant)`);
  // valider : la planche posée en UN pas d'annulation
  const before = await snap();
  const u0 = (await st()).undo;
  await page.click('.ag-dec button:has-text("Valider le découpage")');
  await page.waitForSelector('.ag-turn:last-child .ag-acts', { timeout: 30000 });
  await sleep(600);
  const s1 = await st();
  const lay = await page.evaluate(() => {
    const { S } = window.ideation;
    const B = S.board;
    const box = (n) => window.ideation.app.canvas.dispBox(n);
    const inside = (a, f) => { const x = box(a), y = box(f); return x.x >= y.x && x.y >= y.y && x.x + x.w <= y.x + y.w && x.y + x.h <= y.y + y.h; };
    const over = (a, b) => { const x = box(a), y = box(b); return x.x < y.x + y.w && x.x + x.w > y.x && x.y < y.y + y.h && x.y + x.h > y.y; };
    const sb = B.nodes.find((n) => n.type === 'frame' && (n.name || '').startsWith('Storyboard'));
    const cases = B.nodes.filter((n) => n.type === 'frame' && /^\d+ · /.test(n.name || '')).sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10));
    const persos = B.nodes.find((n) => n.type === 'frame' && n.name === 'Personnages');
    const gens = B.nodes.filter((n) => n.type === 'gen');
    const each = cases.map((f) => ({ note: B.nodes.some((n) => n.type === 'note' && inside(n, f)), gen: gens.find((g) => inside(g, f)) }));
    const lina = B.nodes.find((n) => n.type === 'media' && n.kind === 'element');
    return {
      sb: !!sb, cases: cases.map((f) => f.name), inSb: sb ? cases.every((f) => inside(f, sb)) : false,
      order: cases.length === 2 && (box(cases[0]).y < box(cases[1]).y || (box(cases[0]).y === box(cases[1]).y && box(cases[0]).x < box(cases[1]).x)),
      overlap: cases.some((a, i) => cases.some((b, j) => i < j && over(a, b))) || (persos && sb ? over(persos, sb) : false),
      full: each.every((e) => e.note && e.gen), launched: gens.some((g) => (g.jobs || []).length),
      linaOn: lina ? B.links.filter((l) => l.a === lina.id && l.pb === 'refs').map((l) => l.b) : [],
      card2: each[1]?.gen?.id, prompt: each[0]?.gen?.prompt || '', aspect: each[0]?.gen?.aspect,
    };
  });
  ok(lay.sb && lay.cases.length === 2 && lay.inSb && lay.order && !lay.overlap && lay.full && !lay.launched,
    `${theme} : validé → le cadre Storyboard, 2 cases dans l'ordre, sans chevauchement, chacune sa note et sa carte, rien de lancé (${JSON.stringify(lay.cases)})`);
  ok(lay.linaOn.length === 1 && lay.linaOn[0] === lay.card2 && lay.prompt.startsWith('Cinematic film still') && lay.aspect === '16:9',
    `${theme} : Lina branchée sur sa case (la 2), le prompt préfixé du rendu, le format 16:9 (${JSON.stringify(lay.linaOn)} ${lay.aspect})`);
  ok(s1.undo - u0 === 1, `${theme} : toute la planche en un seul pas d'annulation (${s1.undo - u0})`);
  await page.evaluate(() => window.ideation.app.canvas.fit());
  await sleep(500);
  await page.screenshot({ path: `${out}/${theme}-3-planche.png` });
  // Annuler ce tour, Reposer
  await page.click('.ag-turn:last-child >> text=Annuler ce tour');
  await sleep(500);
  ok(await snap() === before, `${theme} : « Annuler ce tour » rend la planche identique`);
  ok(await page.isDisabled('.ag-lancer') && /Reposer/.test(await page.getAttribute('.ag-lancer', 'title')), `${theme} : défait, « Lancer » éteint dit pourquoi`);
  await page.click('.ag-turn:last-child >> text=Reposer');
  await sleep(700);
  ok((await st()).n === s1.n, `${theme} : « Reposer » remet la planche (${(await st()).n} objets)`);
  // le consentement : les 2 images en file
  const jobs0 = (await api('jobs?limit=200')).jobs.filter((j) => j.kind === 'image.generate').length;
  const lab = await page.textContent('.ag-lancer');
  ok(/^Lancer les 2 images · /.test(lab.trim()), `${theme} : « ${lab.trim()} »`);
  await page.click('.ag-lancer');
  await page.waitForFunction(() => /lancées/.test(document.querySelector('.ag-lancer')?.textContent || ''), null, { timeout: 15000 });
  await sleep(800);
  const jobs1 = (await api('jobs?limit=200')).jobs.filter((j) => j.kind === 'image.generate').length;
  const conv = await api(`ideation/agent/${P.bid}`);
  ok(jobs1 - jobs0 === 2 && conv.decisions.some((d) => d.text.startsWith('Accord : les 2 images')),
    `${theme} : « Lancer les 2 images » : 2 travaux en file, l'accord au carnet (${jobs1 - jobs0})`);
  await page.screenshot({ path: `${out}/${theme}-4-lance.png` });
  await page.click('.ag-ch');
  await sleep(200);
  await page.screenshot({ path: `${out}/${theme}-5-carnet.png` });
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/pilote.log`, log.join('\n') + '\n');
console.log(fails ? `${fails} échec(s)` : 'tout passe');
process.exit(fails ? 1 : 0);
