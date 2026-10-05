// Le pilote de l'agent Showrunner d'Idéation (agent.js) : un portail d'essai branché sur le faux
// Ollama, jamais le portail en ligne. Dans une session cloud (le playwright de /opt/node22), ou sur
// DGX2 (celui de ~/Character_Sheet) :
//
//   python3 tools/faux_ollama.py --port 11500 &
//   SR_OLLAMA_URL=http://127.0.0.1:11500 python3 tools/portail_essai.py 8802 /tmp/sr_agent &
//   node ideation/pilote_agent.mjs http://127.0.0.1:8802 /tmp/sr_agent_shots http://127.0.0.1:11500
//
// Une planche neuve (deux images, une note, un document) ; le panneau par la touche I ; « Citer dans
// la discussion » au clic droit ; « une image dans ce style » → la carte posée et branchée, un seul
// pas d'annulation ; la ligne du geste montre la carte ; « Annuler ce tour », « Reposer » ; un tour de
// gestes variés (le faux Ollama en script) défait d'un coup, la planche identique ; l'entrée d'un projet
// par app.agent.send(texte, { pieces, intent: 'ingest' }) (06/10 : la réception, ce qui ne colle pas, des
// questions cliquables, RIEN de posé ; une réponse → le plan ; accepté → une étape, un geste, défait d'un
// coup ; le carnet) ; une note glissée sur le champ.
// Captures en sombre et en clair. Rend 0 si tout passe ; le détail dans <out>/pilote.log.
import { createRequire } from 'module';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';

const where = ['/opt/node22/lib/node_modules/playwright', `${homedir()}/Character_Sheet/node_modules/playwright`].find((p) => existsSync(p));
const { chromium } = createRequire(import.meta.url)(where || 'playwright');
const [base = 'http://127.0.0.1:8802', out = '/tmp/sr_agent_shots', faux = 'http://127.0.0.1:11500'] = process.argv.slice(2);
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
const call = (name, args) => ({ function: { name, arguments: args } });

// une planche neuve, à chaque thème
async function planche() {
  const b = await api('ideation/boards', { method: 'POST', body: { name: 'Pilote agent' } });
  const i1 = await api('library/upload?name=kiki.png&title=Kiki&tool=upload', { method: 'PUT', raw: PNG, type: 'image/png' });
  const i2 = await api('library/upload?name=rotonde.png&title=Rotonde&tool=upload', { method: 'PUT', raw: PNG, type: 'image/png' });
  const doc = await api('library/upload?name=scenario.txt&title=Sc%C3%A9nario&tool=upload', { method: 'PUT', type: 'text/plain',
    raw: 'Kiki entre à La Rotonde. Man Ray la photographie. Foujita peint au Dôme.' });
  const nodes = [{ id: 'n1', type: 'media', item: i1.id, kind: 'image', x: 0, y: 0, w: 240, h: 240, title: 'Kiki' },
    { id: 'n2', type: 'media', item: i2.id, kind: 'image', x: 300, y: 0, w: 240, h: 240, title: 'Rotonde' },
    { id: 'n3', type: 'note', x: 0, y: 300, w: 230, h: 80, text: 'Kiki à Montparnasse, 1925' }];
  await api(`ideation/boards/${b.id}`, { method: 'POST', body: { name: b.name, nodes, links: [], base_rev: 1 } });
  return { bid: b.id, i1: i1.id, i2: i2.id, doc: doc.id };
}

const browser = await chromium.launch();
for (const theme of ['dark', 'light']) {
  const P = await planche();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 940 } });
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
  const snap = () => page.evaluate(() => { const B = window.ideation.S.board; return JSON.stringify([B.name, B.nodes.map((n) => [n.id, n.x, n.y, n.w, n.group || '']), B.links.map((l) => [l.a, l.b, l.kind])]); });
  await page.goto(`${base}/ideation/#${P.bid}`);
  await page.waitForFunction(() => window.ideation?.app?.agent && window.ideation.S.board?.nodes?.length === 3 && window.ideation.S.cfg, null, { timeout: 20000 });
  ok(await page.evaluate(() => document.documentElement.dataset.theme || 'dark') === theme || theme === 'dark', `${theme} : le thème posé`);
  await page.click('#cv', { position: { x: 700, y: 640 } });
  await page.keyboard.press('i');
  ok(await page.isVisible('.ag'), `${theme} : la touche I ouvre le panneau`);
  // citer l'image au clic droit
  const c = await page.evaluate(() => { const r = document.querySelector('.cv .nd[data-id="n1"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.mouse.click(c[0], c[1], { button: 'right' });
  await page.click('text=Citer dans la discussion');
  ok((await page.$$('.ag-pcs .ag-pc')).length === 1, `${theme} : « Citer dans la discussion » met l'image au-dessus du champ`);
  const u0 = (await st()).undo;
  await page.fill('.ag-ta', 'une image dans ce style');
  await page.keyboard.press('Enter');
  try { await page.waitForSelector('.ag-act', { timeout: 30000 }); } catch { /* dit plus bas */ }
  await sleep(500);
  const card = await page.evaluate(() => { const { S } = window.ideation; const g = S.board.nodes.find((n) => n.type === 'gen');
    return g && { x: g.x, refs: S.board.links.filter((l) => l.b === g.id && l.pb === 'refs').map((l) => l.a), jobs: (g.jobs || []).length }; });
  const s1 = await st();
  ok(card && card.refs.join() === 'n1' && card.jobs === 0 && card.x > 240, `${theme} : la carte Générer posée à droite de l'image, branchée, pas lancée (${JSON.stringify(card)})`);
  ok(s1.undo - u0 === 1, `${theme} : tout le tour en un seul pas d'annulation (${s1.undo - u0})`);
  await page.screenshot({ path: `${out}/${theme}-1-carte.png` });
  await page.click('.ag-act');
  await sleep(300);
  ok(await page.evaluate(() => { const { S } = window.ideation; return [...S.sel].some((id) => window.ideation.app.node(id)?.type === 'gen'); }), `${theme} : la ligne du geste choisit la carte`);
  await page.click('text=Annuler ce tour');
  await sleep(300);
  ok((await st()).n === 3, `${theme} : « Annuler ce tour » retire la carte`);
  await page.click('text=Reposer');
  await sleep(500);
  ok((await st()).n === 4, `${theme} : « Reposer » la remet`);
  // un tour de gestes variés : défait d'un coup, la planche revient identique
  await page.click('text=Annuler ce tour');
  await sleep(300);
  await fetch(`${faux}/_faux`, { method: 'POST', body: JSON.stringify({ script: [{ tool_calls: [
    call('carte_video', { prompt: 'The camera pushes in.', image: P.i1, pourquoi: 'animer' }),
    call('composeur', { style: 'A 1920s photograph.', decor: 'La Rotonde.', vers: 'new:0', pourquoi: 'le prompt' }),
    call('relier', { de: 'n1', vers: 'n2', texte: 'même époque', pourquoi: 'ensemble' }),
    call('renommer_planche', { nom: 'Kiki 1925', pourquoi: 'le sujet' }),
    call('grouper', { ids: ['n1', 'n2'], nom: 'Références', pourquoi: 'ensemble' }),
    call('poser_cadre', { nom: 'Notes', pourquoi: 'les notes' }),
    call('deplacer', { ids: ['n3'], dans: 'new:3', pourquoi: 'la note' }),
    call('poser_texte', { sorte: 'titre', texte: 'Kiki', dans: 'new:3', pourquoi: 'le titre' })] }, { content: 'Fait.' }] }) });
  const before = await snap();
  const r = await page.evaluate(async () => (await window.ideation.app.agent.send('fais tout')).results.filter((x) => x.ok).length);
  const inside = await page.evaluate(() => { const B = window.ideation.S.board; const f = B.nodes.find((n) => n.type === 'frame');
    return f ? B.nodes.filter((n) => n !== f && n.x >= f.x && n.y >= f.y && n.x + n.w <= f.x + f.w && n.y + n.h <= f.y + f.h).length : 0; });
  ok(r === 8 && inside === 2, `${theme} : huit gestes posés, le cadre neuf à la taille de ce qu'il reçoit (${r}, ${inside} dedans)`);
  await page.evaluate(() => window.ideation.app.canvas.fit());
  await sleep(500);
  await page.screenshot({ path: `${out}/${theme}-2-gestes.png` });
  await page.click('.ag-turn:last-child >> text=Annuler ce tour');
  await sleep(400);
  ok(await snap() === before, `${theme} : « Annuler ce tour » rend la planche identique (nom, places, groupe, fils)`);
  // le contrat de « Commencer un projet » (06/10) : la réception, des questions, rien de posé
  const nIng = (await st()).n;
  const ing = await page.evaluate(async (p) => {
    const r2 = await window.ideation.app.agent.send('Une publicité pour un café en grains.', { pieces: [p.doc, p.i1, p.i2], intent: 'ingest' });
    return { n: r2.results.length, q: (r2.turn.questions || []).length, contra: (r2.turn.contradictions || []).length };
  }, P);
  await sleep(400);
  ok(ing.n === 0 && ing.q >= 3 && ing.contra === 1 && (await st()).n === nIng && await page.isVisible('.ag-recu') && await page.isVisible('.ag-contra'),
    `${theme} : l'entrée accuse réception, dit ce qui ne colle pas, pose ses questions, et ne pose RIEN (${JSON.stringify(ing)})`);
  await page.locator('.ag-qcard .ag-q').nth(1).locator('.ag-opt').first().click();
  ok(await page.locator('.ag-qcard .ag-opt.on').count() === 1 && !(await page.isDisabled('.ag-qcard button:text-is("Répondre")')),
    `${theme} : un choix cliqué allume « Répondre »`);
  await page.screenshot({ path: `${out}/${theme}-4-questions.png` });
  await page.click('.ag-qcard button:text-is("Répondre")');
  await page.waitForSelector('.ag-plancard button:has-text("Accepter")', { timeout: 30000 });
  ok((await st()).n === nIng && await page.locator('.ag-plan li').count() >= 1, `${theme} : la réponse → un plan court, toujours rien de posé`);
  const u1 = (await st()).undo;
  await page.click('.ag-plancard button:has-text("Accepter")');
  await page.waitForSelector('.ag-turn:last-child .ag-acts', { timeout: 30000 });
  await sleep(500);
  ok((await st()).n === nIng + 1 && (await st()).undo - u1 === 1 && await page.isVisible('.ag-suite'),
    `${theme} : le plan accepté → l'étape 1 pose UN geste, un pas d'annulation, l'étape suivante proposée`);
  await page.screenshot({ path: `${out}/${theme}-5-etape.png` });
  await page.click('.ag-turn:last-child >> text=Annuler ce tour');
  await sleep(600);
  ok((await st()).n === nIng && /refaire/i.test(await page.textContent('.ag-suite')), `${theme} : « Annuler ce tour » défait l'étape, qui est à refaire`);
  await page.click('.ag-ch');
  ok(await page.locator('.ag-clist li').count() >= 2, `${theme} : le carnet : la réponse et le plan accepté`);
  // une note de la planche glissée sur le champ : citée, revenue à sa place, sans pas d'annulation
  await page.evaluate(() => window.ideation.app.canvas.flyTo('n3', { ms: 0, zmax: 1 }));
  await sleep(300);
  const s2 = await st();
  const a = await page.evaluate(() => { const r3 = document.querySelector('.cv .nd[data-id="n3"]').getBoundingClientRect(); const n = window.ideation.app.node('n3'); return [r3.x + 20, r3.y + 15, n.x, n.y]; });
  const bx = await page.evaluate(() => { const r3 = document.querySelector('.ag-box').getBoundingClientRect(); return [r3.x + r3.width / 2, r3.y + r3.height / 2]; });
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(a[0] + 30, a[1] + 10, { steps: 3 });
  await page.mouse.move(bx[0], bx[1], { steps: 10 }); await page.mouse.up();
  await sleep(300);
  const back = await page.evaluate(() => { const n = window.ideation.app.node('n3'); return [n.x, n.y]; });
  ok((await page.$$('.ag-pcs .ag-pc')).length === 1 && back[0] === a[2] && back[1] === a[3] && (await st()).undo === s2.undo,
    `${theme} : une note glissée sur le champ est citée et revient à sa place, sans pas d'annulation`);
  await page.screenshot({ path: `${out}/${theme}-3-champ.png` });
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/pilote.log`, log.join('\n') + '\n');
console.log(fails ? `${fails} échec(s)` : 'tout passe');
process.exit(fails ? 1 : 0);
