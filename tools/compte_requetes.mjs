// Le compte des requêtes du Worker (docs/etudes/cloudflare.md, « Le compte des requêtes du Worker ») :
// combien de requêtes un onglet ouvert et inactif envoie sur les chemins que le Worker sert lui-même
// (run_worker_first de porte/wrangler.jsonc : chacune compte dans les 100 000 par jour de Workers Free),
// visible, puis caché, puis au retour. Les assets (pages, JS, CSS) sont comptés à part : ils sont gratuits.
//
//   python3 tools/portail_essai.py 8836 /tmp/sr_essai_compte &        # un portail d'essai (arrêté par son PID)
//   node tools/compte_requetes.mjs http://127.0.0.1:8836 [secondes] [pages]   # pages : accueil,asset,…
//   SR_COMPTE_ATTENTE=130 node tools/compte_requetes.mjs …   # compter après 130 s sur la page (le repos de la file)
//
// « Caché » est simulé : document.hidden et visibilityState sont remplacés et visibilitychange est envoyé, comme le
// fait le navigateur (https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API). Chromium sans
// affichage ne cache jamais un onglet (ni bringToFront, ni une fenêtre réduite sous Xvfb : essayé le 06/10), et ce
// qu'il ne fait pas non plus, le ralentissement des minuteries d'un onglet caché, n'est donc pas compté : le chiffre
// « caché » d'avant est celui d'un navigateur qui ne ralentit rien (le pire cas).
// Une requête servie par le cache du navigateur (mémoire, disque) ne compte pas : elle n'atteint pas le Worker ; une
// revalidation (304) compte. Le relevé du protocole de Chromium (Network.*), pas page.on('request'), qui voit aussi
// les réponses du cache.
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const [base = 'http://127.0.0.1:8836', secArg = '60', pagesArg = ''] = process.argv.slice(2);
const SEC = Number(secArg) || 60;
// le temps laissé à la page avant de compter (le relevé de la file passe au repos après deux minutes calmes)
const ATTENTE = Number(process.env.SR_COMPTE_ATTENTE || 10);
const PAGES = { accueil: '', asset: 'asset/', ideation: 'ideation/', odio: 'musique/', admin: 'admin/', character: 'character/', image: 'image/' };
const choix = pagesArg ? pagesArg.split(',') : ['accueil', 'asset', 'ideation', 'odio', 'admin'];

// les motifs de run_worker_first (porte/wrangler.jsonc), dans le même ordre d'idée que worker.js
const MEDIA = /^\/media\/|\.(mp4|m4v|mov|webm|mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;
function sorte(chemin) {
  if (chemin.startsWith('/api/')) return 'api';
  if (chemin.startsWith('/library/')) return 'library';
  if (/^\/(character\/(api|files|v1)|analyse\/runs)\//.test(chemin)) return 'relais';
  if (/^\/(pont|agents|ecoute)\/|^\/(invitation|strategie)(\/|$)/.test(chemin)) return 'relais';
  if (MEDIA.test(chemin)) return 'media';
  return 'asset';
}
// la route, sans identifiant ni requête : « api/jobs », « api/ideation/agent/* »
const route = (chemin) => chemin.replace(/^\//, '').replace(/[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}/g, '*').split('/').slice(0, 4).join('/');

const cache = () => ({ api: 0, library: 0, media: 0, relais: 0, asset: 0, routes: {} });
const somme = (c) => c.api + c.library + c.media + c.relais;

async function mesure(browser, nom) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(() => {
    let cache = false;
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => cache });
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (cache ? 'hidden' : 'visible') });
    window.__cacher = (h) => { cache = !!h; document.dispatchEvent(new Event('visibilitychange')); };
  });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const vus = new Map();   // requestId → { chemin, phase }
  let phase = 'chargement';
  const C = { chargement: cache(), visible: cache(), cache: cache(), retour: cache() };
  const compte = (id) => {
    const r = vus.get(id);
    if (!r || r.compte) return;
    r.compte = true;
    const s = sorte(r.chemin);
    const c = C[r.phase];
    c[s]++;
    if (s !== 'asset') c.routes[route(r.chemin)] = (c.routes[route(r.chemin)] || 0) + 1;
  };
  cdp.on('Network.requestWillBeSent', (e) => {
    const u = new URL(e.request.url);
    if (!u.href.startsWith(base)) return;
    vus.set(e.requestId, { chemin: u.pathname, phase });
  });
  cdp.on('Network.requestServedFromCache', (e) => { const r = vus.get(e.requestId); if (r) r.cacheNav = true; });
  cdp.on('Network.responseReceived', (e) => {
    const r = vus.get(e.requestId);
    if (!r) return;
    if (r.cacheNav || e.response.fromDiskCache || e.response.fromPrefetchCache || e.response.fromServiceWorker) return;
    compte(e.requestId);
  });
  // un flux (EventSource) n'a sa réponse qu'aux en-têtes : déjà compté ; une requête refusée compte aussi
  cdp.on('Network.loadingFailed', (e) => { const r = vus.get(e.requestId); if (r && !r.cacheNav && !e.canceled) compte(e.requestId); });

  await page.goto(`${base}/${PAGES[nom] ?? nom}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(ATTENTE * 1000);
  phase = 'visible';
  await page.waitForTimeout(SEC * 1000);
  phase = 'cache';
  await page.evaluate(() => window.__cacher(true));
  await page.waitForTimeout(SEC * 1000);
  phase = 'retour';
  await page.evaluate(() => window.__cacher(false));
  await page.waitForTimeout(3000);
  await ctx.close();
  return { nom, C, erreurs };
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const res = await Promise.all(choix.map((n) => mesure(browser, n)));
await browser.close();

const parMin = (c) => Math.round((somme(c) * 60) / SEC * 10) / 10;
console.log(`Requêtes du Worker par onglet (api + library + media + relais ; ${SEC} s par phase, ${base})`);
console.log('page        visible/min  caché/min  par jour (visible)  par jour (caché)  retour (3 s)  assets (visible)');
for (const { nom, C } of res) {
  const v = parMin(C.visible), h = parMin(C.cache);
  console.log(`${nom.padEnd(12)}${String(v).padStart(11)}${String(h).padStart(11)}${String(Math.round(v * 1440)).padStart(20)}`
    + `${String(Math.round(h * 1440)).padStart(18)}${String(somme(C.retour)).padStart(14)}${String(C.visible.asset).padStart(18)}`);
}
for (const { nom, C, erreurs } of res) {
  const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '—';
  console.log(`\n${nom} · visible : ${fmt(C.visible.routes)}\n${nom} · caché : ${fmt(C.cache.routes)}\n${nom} · retour : ${fmt(C.retour.routes)}`);
  if (erreurs.length) console.log(`${nom} · erreurs de la page : ${[...new Set(erreurs)].slice(0, 5).join(' | ')}`);
}
if (process.env.SR_COMPTE_JSON) {
  const { writeFileSync } = await import('fs');
  writeFileSync(process.env.SR_COMPTE_JSON, JSON.stringify(res, null, 1));
}
