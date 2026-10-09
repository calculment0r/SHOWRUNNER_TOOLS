// Le pilote des tableaux de bord (09/10 ; docs/etudes/equipes_espaces.md, « Fait le 09/10 ») : la vue
// d'ensemble de Cal et le tableau de bord d'un membre, sur un portail d'essai NEUF, PORTE ALLUMÉE (on
// entre par un pseudo), en moteurs factices — jamais le portail en ligne.
//
//   SR_PORTE=1 python3 tools/portail_essai.py 8842 /tmp/sr_tableau/data &
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright/package.json node admin/pilote_tableau.mjs http://127.0.0.1:8842 /tmp/sr_tableau/shots
//
// Le parcours : Cal crée deux Teams (« Studio Nord » : Général et Clip ; « Atelier Sud »), y met trois
// personnes d'essai ; chacune crée (une image, un son, sa transcription, une planche, un projet ODIO) —
// l'une dans son « Chez moi » seulement, le cas de Cal du 09/10 (une transcription lancée par un ami,
// introuvable). Puis : la vue d'ensemble de Cal (les Teams, les « Chez moi », les personnes ; un
// Workspace déplié ; la recherche d'un nom ; tout ce que cette personne a créé, et où ; un objet
// s'ouvre dans son outil, dans son Workspace) ; le tableau de bord d'un membre (ses Teams seulement,
// la section Teams juste après ; l'entrée « Tableau de bord » du menu du compte). Captures en sombre
// et en clair, à 1280 et à 390 px de large. Rend 0 si tout passe.
import { createRequire } from 'module';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';

const require = createRequire(process.env.PLAYWRIGHT || '/home/dgx/Character_Sheet/package.json');
const { chromium } = require('playwright');
const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

// les médias d'essai : une image et un son, faits par ffmpeg
const png = `${out}/essai.png`, wav = `${out}/essai.wav`;
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=1', '-frames:v', '1', png]);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-ar', '16000', wav]);

// une personne : un contexte (son thème, sa largeur), entrée par son pseudo
async function who(pseudo, { theme = 'dark', width = 1280, height = 860 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
  }, theme);
  const r = await ctx.request.post(`${base}/api/auth/enter`, { data: { name: pseudo }, headers: { Origin: base } });
  ok(r.status() === 200, `${pseudo} entre (${r.status()})`);
  const call = async (method, path, body = null, { esp, raw, type } = {}) => {
    const headers = { Origin: base, ...(esp ? { 'X-SR-Espace': esp } : {}) };
    const opt = { method, headers };
    if (raw) { opt.data = raw; headers['Content-Type'] = type; } else if (body) opt.data = body;
    const res = await ctx.request.fetch(`${base}/api/${path}`, opt);
    let j = null;
    try { j = await res.json(); } catch { /* pas du JSON */ }
    return { s: res.status(), j };
  };
  return { ctx, call };
}
async function page(ctx, tag) {
  const p = await ctx.newPage();
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = m.location()?.url || '';
    // ce qui est attendu : une ressource d'ailleurs (Google Fonts, bloqué ici) ; pour un membre, admin/state
    // et le kit de Cal répondent 403 (la page passe alors en tableau de bord)
    const away = /^Failed to load resource/.test(m.text()) && (!url.startsWith(base) || /\/api\/(admin\/(state|porte)|strategie\/moi)/.test(url));
    log.push(`console ${tag}: ${m.text()} ${url}`);
    if (!away) { fails++; console.log(log.at(-1)); }
  });
  p.on('pageerror', (e) => { log.push(`PAGEERROR ${tag}: ${e.message}`); fails++; console.log(log.at(-1)); });
  return p;
}
const shot = async (p, name, full = false) => { await p.waitForTimeout(250); await p.screenshot({ path: `${out}/${name}.png`, fullPage: full }); };
async function upload(u, file, name, title, esp, type) {
  return u.call('PUT', `library/upload?${new URLSearchParams({ name, title })}`, null, { esp, raw: readFileSync(file), type });
}
async function transcrire(u, item, esp) {
  const r = await u.call('POST', 'transcrire/run', { item, mode: 'rapide' }, { esp });
  const id = r.j?.doc?.id;
  for (let i = 0; id && i < 150; i++) {
    const d = await u.call('GET', `transcrire/docs/${id}`, null, { esp });
    if (['done', 'error'].includes(d.j?.state)) return d.j;
    await new Promise((res) => setTimeout(res, 200));
  }
  return r.j;
}

// ── les données : deux Teams, trois personnes d'essai ──────
const cal = await who('nico007');
const t1 = (await cal.call('POST', 'equipes', { name: 'Studio Nord' })).j;
const W1 = t1.spaces[0].id;
const W2 = (await cal.call('POST', `equipes/${t1.id}/espaces`, { name: 'Clip' })).j.id;
const t2 = (await cal.call('POST', 'equipes', { name: 'Atelier Sud' })).j;
const W3 = t2.spaces[0].id;
for (const [t, pseudo] of [[t1, 'Mia Essai'], [t1, 'Tao Essai'], [t2, 'Lou Essai']]) {
  const r = await cal.call('POST', `equipes/${t.id}/membres`, { pseudo, role: 'member' });
  ok(r.s === 200, `Cal met ${pseudo} dans ${t.name} (${r.s} ${r.j?.error || ''})`);
}
await upload(cal, png, 'reperage.png', 'Repérage quai', W1, 'image/png');
await cal.call('POST', 'ideation/boards', { name: 'Moodboard clip' }, { esp: W1 });

const mia = await who('Mia Essai');
const mImg = await upload(mia, png, 'affiche.png', 'Affiche', W1, 'image/png');
const mSon = await upload(mia, wav, 'interview.wav', 'Interview Mia', W1, 'audio/wav');
const mTrn = await transcrire(mia, mSon.j?.id, W1);
ok(mImg.s === 200 && mSon.s === 200 && mTrn?.state === 'done', `Mia crée dans Studio Nord / Général : une image, un son, sa transcription (${mImg.s} ${mSon.s} ${mTrn?.state})`);
await mia.call('POST', 'music/projects', { name: 'Maquette refrain' }, { esp: W2 });

// Tao : dans son « Chez moi » seulement — ce que Cal ne trouvait pas
const tao = await who('Tao Essai');
const taoId = (await tao.call('GET', 'auth/me')).j?.user?.id;
const P = `esp-perso-${taoId}`;
const tSon = await upload(tao, wav, 'notes.wav', 'Notes vocales', P, 'audio/wav');
const tTrn = await transcrire(tao, tSon.j?.id, P);
ok(tTrn?.state === 'done' && tTrn.space === P && tTrn.owner === taoId,
  `Tao transcrit dans son Perso : le document porte son auteur et son Workspace (${tTrn?.state} ${tTrn?.space} ${tTrn?.owner})`);

const lou = await who('Lou Essai');
await lou.call('POST', 'ideation/boards', { name: 'Story Sud' }, { esp: W3 });
await upload(lou, png, 'decor.png', 'Décor Sud', W3, 'image/png');

// ── Cal : la vue d'ensemble ────────────────────────────────
for (const theme of ['dark', 'light']) {
  for (const width of [1280, 390]) {
    const tag = `cal-${width}-${theme === 'dark' ? 'sombre' : 'clair'}`;
    const c = await who('nico007', { theme, width, height: width > 600 ? 860 : 844 });
    const p = await page(c.ctx, tag);
    await p.goto(`${base}/admin/#tableau`);
    await p.waitForSelector('.tdb-team', { timeout: 15000 });
    const txt = await p.innerText('#adm-main');
    if (theme === 'dark' && width === 1280) {
      ok(/STUDIO NORD/i.test(txt) && /ATELIER SUD/i.test(txt) && /CHEZ TAO ESSAI/i.test(txt),
        'Cal voit toutes les Teams, les « Chez moi » de chacun compris');
      ok((await p.$$eval('.tdb-pp', (xs) => xs.map((x) => x.dataset.person))).includes(taoId), 'Cal voit Tao dans les personnes');
      ok((await p.getAttribute('html', 'data-theme')) === 'dark', 'le thème sombre est posé');
    }
    if (theme === 'light' && width === 1280) ok((await p.getAttribute('html', 'data-theme')) === 'light', 'le thème clair est posé');
    await shot(p, tag, width < 600);
    // un Workspace déplié : ses objets, leur auteur, leur lien
    await p.click(`.tdb-ws[data-space="${W1}"]`);
    await p.waitForSelector('.tdb-list .tdb-it', { timeout: 10000 });
    if (theme === 'dark' && width === 1280) {
      const links = await p.$$eval('.tdb-list .tdb-it', (xs) => xs.map((x) => [x.dataset.kind, x.getAttribute('href'), x.innerText]));
      const trn = links.find(([k]) => k === 'transcription');
      ok(trn && trn[1].includes(`e=${W1}`) && /Mia Essai/i.test(trn[2]),
        `Studio Nord / Général déplié : la transcription de Mia, son auteur, son lien dans son Workspace (${trn && trn[1]})`);
    }
    await p.evaluate((sid) => { document.querySelector(`.tdb-ws[data-space="${sid}"]`).scrollIntoView({ block: 'start' }); window.scrollBy(0, -64); }, W1);
    await shot(p, `${tag}-workspace`, width < 600);
    // la recherche d'un nom, puis tout ce que la personne a créé, et où
    await p.fill('.tdb-search input', 'tao');
    await p.waitForSelector(`.tdb-pp[data-person="${taoId}"]`, { timeout: 10000 });
    if (width === 1280) await shot(p, `${tag}-recherche`);
    await p.click(`.tdb-pp[data-person="${taoId}"]`);
    await p.waitForSelector('.tdb-person .tdb-it', { timeout: 10000 });
    const ptxt = await p.innerText('.tdb-person');
    if (theme === 'dark' && width === 1280) {
      ok(/Notes vocales/.test(ptxt) && /Perso/.test(ptxt), 'la recherche « tao » mène à sa transcription, dans son Perso');
      const href = await p.getAttribute('.tdb-person .tdb-it[data-kind="transcription"]', 'href');
      ok(href && href.includes(`transcrire/?e=${P}#`), `la transcription s'ouvre dans Transcrire, dans le Perso de Tao (${href})`);
      // l'ouvrir : un nouvel onglet, dans son Workspace, le document ouvert
      const [tab] = await Promise.all([c.ctx.waitForEvent('page'), p.click('.tdb-person .tdb-it[data-kind="transcription"]')]);
      await tab.waitForLoadState('domcontentloaded');
      await tab.waitForTimeout(2500);
      ok(new URL(tab.url()).searchParams.get('e') === P, `l'onglet ouvert est dans le Perso de Tao (${tab.url()})`);
      await tab.screenshot({ path: `${out}/${tag}-transcription-ouverte.png` });
      await tab.close();
    }
    await shot(p, `${tag}-personne`, width < 600);
    await c.ctx.close();
  }
}

// ── un membre : son tableau de bord ────────────────────────
for (const theme of ['dark', 'light']) {
  for (const width of [1280, 390]) {
    const tag = `membre-${width}-${theme === 'dark' ? 'sombre' : 'clair'}`;
    const m = await who('Mia Essai', { theme, width, height: width > 600 ? 860 : 844 });
    const p = await page(m.ctx, tag);
    await p.goto(`${base}/admin/`);
    await p.waitForSelector('.tdb-team', { timeout: 15000 });
    const txt = await p.innerText('#adm-main');
    if (theme === 'dark' && width === 1280) {
      ok(/STUDIO NORD/i.test(txt) && !/ATELIER SUD/i.test(txt) && !/CHEZ TAO/i.test(txt),
        'Mia voit Studio Nord et son « Chez moi », ni Atelier Sud ni le « Chez moi » de Tao');
      const nav = await p.$$eval('#adm-nav .item .nm', (xs) => xs.map((x) => x.textContent));
      ok(JSON.stringify(nav) === JSON.stringify(['Tableau de bord', 'Teams']), `le rack de Mia : son tableau de bord, puis Teams (${nav})`);
      ok(new URL(p.url()).hash === '#tableau', `Mia arrive sur son tableau de bord (${p.url()})`);
      // le menu du compte : « Tableau de bord » mène ici
      await p.click('#sr-me');
      const a = await p.waitForSelector('a.sr-ml-i:has-text("Tableau de bord")', { timeout: 5000 }).catch(() => null);
      ok(a && /admin\/.*#tableau$/.test(await a.getAttribute('href')), 'le menu du compte : « Tableau de bord » → admin/#tableau');
      await p.keyboard.press('Escape');
      // ce qu'elle a créé
      await p.click('button:has-text("Ce que j’ai créé")');
      await p.waitForSelector('.tdb-person .tdb-it', { timeout: 10000 });
      const mine = await p.innerText('.tdb-person');
      ok(/Interview Mia/.test(mine) && /Maquette refrain/.test(mine) && !/Repérage quai/.test(mine), 'Mia : « Ce que j’ai créé » — le sien, pas celui de Cal');
      await shot(p, `${tag}-moi`);
      await p.click('button:has-text("← Tableau de bord")');
      await p.waitForSelector('.tdb-team');
      // la section Teams reste où l'on gère les accès
      await p.click('button:has-text("Gérer les accès")');
      await p.waitForFunction(() => location.hash === '#teams');
      ok(true, 'Mia passe à la section Teams (les accès)');
      await p.click('#adm-nav .item:has-text("Tableau de bord")');
      await p.waitForSelector('.tdb-team');
    }
    await shot(p, tag, width < 600);
    await p.click(`.tdb-ws[data-space="${W1}"]`);
    await p.waitForSelector('.tdb-list .tdb-it', { timeout: 10000 });
    await p.evaluate((sid) => { document.querySelector(`.tdb-ws[data-space="${sid}"]`).scrollIntoView({ block: 'start' }); window.scrollBy(0, -64); }, W1);
    await shot(p, `${tag}-workspace`, width < 600);
    await m.ctx.close();
  }
}

// un membre ne lit pas ce qui n'est pas à lui : le Workspace d'une autre Team, le tableau d'un autre
const s1 = (await mia.call('GET', `tableau/espace/${W3}`)).s;
const s2 = (await mia.call('GET', `tableau/personne/${taoId}`)).s;
ok(s1 === 404 && s2 === 403, `Mia : le Workspace d'Atelier Sud n'existe pas pour elle, le tableau de Tao lui est refusé (${s1} ${s2})`);

await browser.close();
writeFileSync(`${out}/pilote.log`, log.join('\n') + '\n');
console.log(`\n${fails ? `${fails} ÉCHEC(S)` : 'tout passe'} — captures dans ${out}`);
process.exit(fails ? 1 : 0);
