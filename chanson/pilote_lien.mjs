// Le pilote du partage des playlists de Musique (chanson/playlist.js : « Exporter en .zip »,
// « Publier le lien ») : Chromium sans affichage, un portail d'essai, jamais le portail en ligne.
//
//   node chanson/pilote_lien.mjs http://127.0.0.1:8831 /tmp/sr_lien_shots
//   SR_PLAYWRIGHT=/opt/node22/lib/node_modules/playwright node chanson/pilote_lien.mjs …   (une session cloud)
//
// Le parcours, en sombre puis en clair : trois tons fabriqués par ffmpeg, déposés par l'API, une
// playlist ; « Exporter en .zip » : la progression sous le bouton (la file), puis le téléchargement
// — un vrai .zip, son lecteur dedans ; « Publier le lien » sans jeton R2 : le panneau le dit,
// propose le .zip, et Publier éteint dit pourquoi sans rien envoyer ; le téléchargement permis et
// l'enchaînement écrits depuis le panneau ; un guest (l'état du lien rendu comme pour lui :
// `peut_publier: false`, la raison de server/core/espaces.py) : les deux boutons éteints, la raison
// sous eux, rien n'est envoyé. Le presse-papiers moderne est retiré, comme en http.
// Avec un faux R2 (SR_FAUX_R2=1 python3 tools/portail_essai.py …) : publier avec un code et une
// date de fin, l'adresse, Copier (la vieille voie execCommand), Republier sans le code (la même
// adresse), les écoutes (rangées dans le faux bucket si SR_FAUX_R2_POINT donne son adresse, que le
// portail affiche au démarrage), Retirer (confirmé). Un seul bouton orange, aucune erreur de
// console. Rend 0 si tout passe ; le détail dans <out>/pilote_lien.log.
import { createRequire } from 'module';
import { writeFileSync, mkdirSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';

const require = createRequire('/home/dgx/Character_Sheet/package.json');
const { chromium } = require(process.env.SR_PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
const FAUX_R2 = process.env.SR_FAUX_R2_POINT || '';
mkdirSync(out, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };
const api = async (path, body) => {
  const r = await fetch(`${base}/api/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  return r.json();
};
const R2_ATTEND = 'le lien d’écoute attend le jeton R2 (Admin / docs/etudes/cloudflare.md, geste 9)';
const GUEST = 'publier un lien d\'écoute : guest : calculer et publier sont réservés aux membres de la Team — demande à un admin de la Team';

// ── trois tons (ffmpeg), une playlist ──
const tmp = mkdtempSync(join(tmpdir(), 'sr-pilote-lien-'));
const sons = [];
for (const [k, f, d, v] of [[0, 330, 24, 0.1], [1, 440, 18, 0.5], [2, 550, 12, 0.25]]) {
  const p = join(tmp, `ton${k}.wav`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=f=${f}:d=${d}:sample_rate=44100`, '-af', `volume=${v}`, '-ac', '2', p]);
  const r = await fetch(`${base}/api/library/upload?name=ton${k}.wav&title=${encodeURIComponent(`Pilote lien ${k + 1}`)}`, { method: 'PUT', body: readFileSync(p) });
  sons.push((await r.json()).id);
}
rmSync(tmp, { recursive: true, force: true });
ok(sons.every(Boolean), `trois tons fabriqués par ffmpeg, dans la bibliothèque (${sons.join(', ')})`);
const pl = await api('playlist', { title: 'Pilote du lien', tracks: sons });
const id = pl.id;
ok(id?.startsWith('pla-') && pl.playlist.tracks.length === 3, `une playlist de trois morceaux (${id})`);
const etat0 = await api(`ecoute/${id}`);
const r2 = !!etat0.r2?.pret;
ok(etat0.peut_publier === true, `l'état du lien : on peut publier (${JSON.stringify(etat0).slice(0, 160)})`);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function newPage(theme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
    // comme en http : pas de presse-papiers moderne ; ce que la vieille voie copie est gardé pour le pilote
    Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined, configurable: true });
    document.addEventListener('copy', (e) => {
      const n = e.target;
      window.__copie = n && 'value' in n ? n.value.slice(n.selectionStart, n.selectionEnd) : String(getSelection());
    }, true);
  }, theme);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') { log.push(`console ${theme}: ${m.text()}`); fails++; } });
  page.on('pageerror', (e) => { log.push(`PAGEERROR ${theme}: ${e.message}`); fails++; });
  return { ctx, page };
}
const shot = async (page, name) => { await page.waitForTimeout(300); await page.screenshot({ path: `${out}/${name}.png` }); };
const attr = (page, sel, a) => page.$eval(sel, (n, x) => n.getAttribute(x), a).catch(() => null);
const texte = (page, sel) => page.$eval(sel, (n) => n.textContent).catch(() => '');
const ouvrir = async (page) => {
  await page.goto(`${base}/chanson/?playlist=${id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.pl-tr:nth-child(3)', { timeout: 15000 });
  await page.waitForSelector('[data-act="lien"]', { timeout: 15000 });
  await page.waitForTimeout(400);
};
const postes = (page) => { const l = []; page.on('request', (q) => { if (q.method() === 'POST' && /\/api\/ecoute\//.test(q.url())) l.push(q.url()); }); return l; };

for (const theme of ['dark', 'light']) {
  const { ctx, page } = await newPage(theme);
  const envois = postes(page);
  await ouvrir(page);
  ok((await page.$$('.tb.go')).length === 1, `${theme} : un seul bouton orange (celui du rail)`);
  ok(await attr(page, '[data-act="zip"]', 'aria-disabled') === null && await attr(page, '[data-act="lien"]', 'aria-disabled') === null,
    `${theme} : « Exporter en .zip » et « Publier le lien » allumés`);

  // 1. le .zip : la progression (la file), puis le téléchargement
  const dl = page.waitForEvent('download', { timeout: 180000 });
  await page.click('[data-act="zip"]');
  const vu = await page.waitForFunction(() => {
    const b = document.querySelector('[data-act="zip"]');
    return /\.zip ·|Envoi/.test(b?.textContent || '') || !!document.querySelector('[data-job=".zip"] .pill.work');
  }, null, { timeout: 15000 }).then(() => true, () => false);
  ok(vu, `${theme} : le .zip en cours se voit sous le bouton (la file)`);
  await shot(page, `${theme}-1-zip-en-cours`);
  const fichier = await dl.catch(() => null);
  const chemin = fichier ? `${out}/${theme}-${fichier.suggestedFilename()}` : '';
  if (fichier) await fichier.saveAs(chemin);
  const z = chemin ? readFileSync(chemin) : Buffer.alloc(0);
  ok(fichier && /-ecoute\.zip$/.test(fichier.suggestedFilename()) && z.subarray(0, 2).toString() === 'PK'
    && z.includes('pilote-du-lien/index.html') && z.includes('pilote-du-lien/playlist.json') && z.includes('pilote-du-lien/audio/'),
  `${theme} : le .zip se télécharge quand il est prêt, le lecteur dedans (${fichier?.suggestedFilename()} · ${z.length} octets)`);
  await page.waitForSelector('[data-act="zip-get"]', { timeout: 10000 }).catch(() => {});
  ok(/\.zip prêt/.test(await texte(page, '[data-job=".zip"]')) && /api\/asset\/zip\//.test(await attr(page, '[data-act="zip-get"]', 'href') || ''),
    `${theme} : le .zip prêt reste à reprendre (${(await texte(page, '[data-job=".zip"]')).trim()})`);
  await shot(page, `${theme}-2-zip-pret`);

  // 2. « Publier le lien »
  await page.click('[data-act="lien"]');
  await page.waitForSelector('.pl-lien [data-act="publier"]', { timeout: 10000 });
  ok(await attr(page, '[data-act="lien"]', 'aria-pressed') === 'true', `${theme} : « Publier le lien » ouvre son panneau`);
  if (!r2) {
    ok((await texte(page, '[data-why="r2"]')).includes(R2_ATTEND), `${theme} : sans jeton R2, le panneau le dit clairement`);
    ok(!!(await page.$('[data-why="r2"] [data-act="zip-plutot"]')), `${theme} : … et propose le .zip à la place`);
    ok(await attr(page, '[data-act="publier"]', 'aria-disabled') === 'true' && (await attr(page, '[data-act="publier"]', 'title') || '').includes('jeton R2')
      && /jeton r2/i.test(await texte(page, '[data-act="publier"] .ch-lock')), `${theme} : Publier éteint, la raison au survol et sur sa pastille`);
    const n0 = envois.length;
    await page.click('[data-act="publier"]', { force: true });   // éteint (aria-disabled), il se clique quand même : il redit pourquoi
    await page.waitForTimeout(400);
    ok(envois.length === n0 && (await texte(page, '.toast')).includes('jeton R2'), `${theme} : un clic sur Publier redit pourquoi, sans rien envoyer`);
    await shot(page, `${theme}-3-lien-sans-r2`);
  }
  // le téléchargement permis et l'enchaînement, depuis le panneau : écrits tout de suite
  const dlAvant = (await api('playlist/' + id)).playlist.download;
  await page.click('.pl-lien .pl-dl input');
  await page.click('.pl-lien [data-lf="mode-crossfade"]');
  await page.waitForTimeout(1200);
  let s = (await api('playlist/' + id)).playlist;
  ok(s.download === !dlAvant && s.transition.mode === 'crossfade' && /Fondu/.test(await texte(page, 'details.pl-plus summary')),
    `${theme} : le téléchargement permis et l'enchaînement, écrits depuis le panneau (${s.download}, ${s.transition.mode})`);
  await page.click('.pl-lien [data-lf="mode-gapless"]');
  await page.click('.pl-lien .pl-dl input');
  await page.waitForTimeout(1200);
  s = (await api('playlist/' + id)).playlist;
  ok(s.download === dlAvant && s.transition.mode === 'gapless', `${theme} : remis comme avant`);

  if (r2) {
    // 3. publier (code, date de fin), l'adresse, Copier, Republier, les écoutes, Retirer
    const fin = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
    await page.fill('.pl-lien [data-lf="code"]', '12 34');
    await page.fill('.pl-lien [data-lf="fin"]', fin);
    const rep = page.waitForResponse((r) => /\/api\/ecoute\/[^/]+\/publier$/.test(r.url()));
    await page.click('[data-act="publier"]');
    const lien0 = (await (await rep).json()).lien || {};
    const jeton = (/\/ecoute\/([0-9a-f]{32})\/$/.exec(lien0.url || '') || [])[1];
    if (FAUX_R2 && jeton) {   // deux écoutes du morceau 1, une du 3, rangées comme le Worker le fait
      const jour = new Date().toISOString().slice(0, 10);
      const vide = createHash('sha256').update('').digest('hex');
      for (const [k, n] of [[0, 1], [1, 1], [2, 3]]) {
        await fetch(`${FAUX_R2}/showrunner-bibliotheque/ecoute/${jeton}/_ecoutes/${jour}/${Date.now()}${k}-abc${k}-${n}`,
          { method: 'PUT', headers: { authorization: 'AWS4-HMAC-SHA256 Credential=essai', 'x-amz-content-sha256': vide }, body: '' });
      }
    }
    const pub = await page.waitForFunction(() => document.querySelector('[data-job="publication"] .pill.work'), null, { timeout: 10000 }).then(() => true, () => false);
    ok(pub, `${theme} : la publication en cours se voit dans le panneau`);
    await page.waitForSelector('.pl-lien-adr input', { timeout: 180000 }).catch(() => {});
    const url = await page.$eval('.pl-lien-adr input', (n) => n.value).catch(() => '');
    const st = await texte(page, '.pl-lien-stats');
    ok(jeton && url === lien0.url, `${theme} : publié, l'adresse à copier (${url})`);
    ok(/un code le protège/.test(st) && st.includes(`jusqu’au ${fin.split('-').reverse().join('/')} inclus`), `${theme} : le code et la date de fin dits (${st})`);
    if (FAUX_R2) ok(await texte(page, '.pl-lien-n b') === '3' && /3 ces 7 jours/.test(await texte(page, '.pl-lien-n')), `${theme} : les écoutes (${await texte(page, '.pl-lien-n')})`);
    ok(/Lien publié/.test(await texte(page, '[data-act="lien"]')), `${theme} : le bouton dit « Lien publié »`);
    await page.click('[data-act="copier"]');
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => window.__copie) === url && /adresse copiée/.test(await texte(page, '.toast')), `${theme} : Copier marche sans presse-papiers moderne (execCommand)`);
    await shot(page, `${theme}-4-lien-publie`);
    await page.click('.pl-lien [data-lf="sans-code"]');
    await page.click('[data-act="publier"]');
    await page.waitForFunction(() => /sans code/.test(document.querySelector('.pl-lien-stats')?.textContent || ''), null, { timeout: 180000 }).catch(() => {});
    ok(await page.$eval('.pl-lien-adr input', (n) => n.value).catch(() => '') === url && /sans code/.test(await texte(page, '.pl-lien-stats')),
      `${theme} : Republier sans le code, la même adresse`);
    await page.click('[data-act="retirer"]');
    await page.waitForSelector('.fl-ask .modal-foot .tb:last-child', { timeout: 5000 });
    ok(/Retirer le lien/.test(await texte(page, '.fl-ask .modal-foot .tb:last-child')), `${theme} : Retirer demande confirmation`);
    await page.click('.fl-ask .modal-foot .tb:last-child');
    await page.waitForFunction(() => !document.querySelector('.pl-lien-adr'), null, { timeout: 10000 }).catch(() => {});
    ok(!(await page.$('.pl-lien-adr')) && (await api(`ecoute/${id}`)).lien === null && /Publier le lien/.test(await texte(page, '[data-act="lien"]')),
      `${theme} : le lien retiré, plus d'adresse`);
  }
  await ctx.close();

  // 4. un guest : l'état du lien rendu comme pour lui (le portail d'essai entre en Cal)
  const g = await newPage(theme);
  const envoisG = postes(g.page);
  await g.page.route(/\/api\/ecoute\/pla-[^/?]+(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const r = await route.fetch();
    route.fulfill({ response: r, json: { ...(await r.json()), peut_publier: false, pourquoi: GUEST } });
  });
  await ouvrir(g.page);
  const zg = await attr(g.page, '[data-act="zip"]', 'aria-disabled'), lg = await attr(g.page, '[data-act="lien"]', 'aria-disabled');
  ok(zg === 'true' && lg === 'true' && (await attr(g.page, '[data-act="lien"]', 'title') || '').includes('guest'), `${theme} : un guest, les deux boutons éteints, la raison au survol`);
  ok((await texte(g.page, '[data-why="droits"]')).includes('demande à un admin de la Team'), `${theme} : … et sous eux, qui le débloque`);
  await g.page.click('[data-act="zip"]', { force: true });
  await g.page.click('[data-act="lien"]', { force: true });
  await g.page.waitForTimeout(400);
  ok(!envoisG.length && !(await g.page.$('.pl-lien')) && (await texte(g.page, '.toast')).includes('guest'), `${theme} : un clic redit pourquoi, rien n'est envoyé`);
  await shot(g.page, `${theme}-5-guest`);
  await g.ctx.close();
}
await browser.close();
writeFileSync(`${out}/pilote_lien.log`, log.join('\n') + '\n');
console.log(fails ? `${fails} échec(s)` : 'tout passe');
process.exit(fails ? 1 : 0);
