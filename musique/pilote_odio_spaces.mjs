// Le pilote d'« ODIO dans les Spaces » (06/10 ; docs/etudes/musique_spaces_playlists.md § 5
// étape 7) : un portail d'essai NEUF en moteurs factices (tools/portail_essai.py, des données
// jetables), jamais le portail en ligne.
//
//   node musique/pilote_odio_spaces.mjs http://127.0.0.1:8849 /tmp/sr_odio-spaces/shots
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright/package.json node …   (une session cloud)
//
// Le parcours : deux Spaces et une chanson dans chacun → l'app Musique, Space « Album été » :
// « Ouvrir dans ODIO » → le projet naît dans le Space de la chanson ; la rubrique « Space »
// au-dessus de « Projet » (le menu de l'app, la chanson, le projet ouvert) → choisir « Démos »
// dans le menu → un clic pose sa chanson sur l'arrangement → « Ranger le projet dans « Démos » »,
// Ctrl+Z → une région générée depuis le panneau naît dans le Space du projet, et y paraît →
// des stems d'un son sans Space aussi → la Session : la rubrique y est, un clic pose dans une
// case → « Nouveau projet » naît dans le Space montré → « Tous les Spaces » → l'app : les
// projets ODIO du Space, « Déplacer vers… », Ctrl+Z, « Ouvrir dans ODIO ». Captures en sombre
// et en clair. Rend 0 si tout passe.
import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';

const require = createRequire(process.env.PLAYWRIGHT || '/home/dgx/Character_Sheet/package.json');
const { chromium } = require('playwright');
const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });

async function newPage(theme, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
  }, theme);
  const page = await ctx.newPage();
  // une ressource d'ailleurs qui ne charge pas (Google Fonts, bloqué dans un conteneur) se note sans compter
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const away = /^Failed to load resource/.test(m.text()) && !(m.location()?.url || '').startsWith(base);
    log.push(`console ${theme}: ${m.text()} ${m.location()?.url || ''}`);
    if (!away) { fails++; console.log(log.at(-1)); }
  });
  page.on('pageerror', (e) => { log.push(`PAGEERROR ${theme}: ${e.message}`); fails++; console.log(log.at(-1)); });
  return { ctx, page };
}
const shot = async (page, name) => { await page.waitForTimeout(300); await page.screenshot({ path: `${out}/${name}.png`, fullPage: false }); };
const api = (page, path, body = null, method = null) => page.evaluate(async ([p, b, m]) => {
  const r = await fetch(`/api/${p}`, b ? { method: m || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : { method: m || 'GET' });
  return r.json();
}, [path, body, method]);
async function waitJob(page, id, timeout = 90000) {
  const t0 = Date.now();
  for (;;) {
    const j = await api(page, `jobs/${id}`);
    if (['done', 'error', 'cancelled'].includes(j.state) || Date.now() - t0 > timeout) return j;
    await page.waitForTimeout(400);
  }
}
const projet = (page, id) => api(page, `music/projects/${id}`);
const titre = (page) => page.textContent('.nv-sec[data-sec="space"] .nv-spn');
const rubrique = (page) => page.$eval('.nv-sec[data-sec="space"] .nv-list', (n) => n.innerText).catch(() => '');
async function attendre(page, fn, arg, what, timeout = 20000) {
  try { await page.waitForFunction(fn, arg, { timeout }); ok(true, what); } catch { ok(false, what); }
}
async function choisirSpace(page, label) {
  if (!(await page.$('.ch-spmenu'))) await page.click('#ch-space-btn');
  await page.waitForSelector('.ch-spmenu');
  await page.click(`.ch-spmenu .mi:has(.lb:text-is("${label}"))`);
  await page.waitForTimeout(500);
}

// ── la mise en place : deux Spaces, une chanson dans chacun ──
const { ctx, page } = await newPage('dark');
await page.goto(`${base}/chanson/`, { waitUntil: 'networkidle' });
// (un portail déjà essayé : les Spaces du premier passage servent)
const deja = (await api(page, 'chanson/spaces')).spaces || [];
const space = async (name, extra = {}) => deja.find((x) => x.name === name) || api(page, 'chanson/spaces', { name, ...extra });
const A = await space('Album été');
const B = await space('Démos', { color: 'amb' });
ok(A.id && B.id, `deux Spaces : « Album été », « Démos » (${A.id} ${B.id})`);
const recette = (sp, prompt) => ({ prompt, preset: 'rapide', vocal: false, lyrics: '', duration: 30, music_space: sp });
const ja = await waitJob(page, (await api(page, 'chanson/create', recette(A.id, 'nappe d’été, piano'))).id);
const jb = await waitJob(page, (await api(page, 'chanson/create', recette(B.id, 'démo funk, basse'))).id);
const songA = ja.items?.[0], songB = jb.items?.[0];
ok(songA?.music_space === A.id && songB?.music_space === B.id, `une chanson dans chacun (${ja.state} ${jb.state})`);

// ── l'app Musique : « Ouvrir dans ODIO » depuis une chanson d'« Album été » ──
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#ch-space-btn');
await choisirSpace(page, 'Album été');
await page.waitForSelector(`.ch-song[data-id="${songA.id}"]`);
ok(!(await page.$('#ch-projets .ch-proj')), 'l’app : pas encore de projet ODIO dans « Album été »');
await Promise.all([page.waitForURL(/\/musique\/\?p=mus-/, { timeout: 30000 }), page.click(`.ch-song[data-id="${songA.id}"] [data-act="odio"]`)]);
const pid = new URL(page.url()).searchParams.get('p');
await page.waitForSelector('.nv-sec[data-sec="space"] .nv-spn');
await attendre(page, () => document.querySelector('.nv-sec[data-sec="space"] .nv-spn')?.textContent === 'Album été', null, 'ODIO : la rubrique dit « Space · Album été », le Space de la chanson');
let pj = await projet(page, pid);
ok(pj.music_space === A.id, `le projet ouvert depuis la chanson est dans son Space (${pj.music_space})`);
const secs = await page.$$eval('.nv-sec', (l) => l.map((s) => s.dataset.sec));
ok(secs[0] === 'space' && secs[1] === 'proj', `la rubrique « Space » est au-dessus de « Projet » (${secs.slice(0, 3).join(', ')})`);
await attendre(page, (t) => document.querySelector('.nv-sec[data-sec="space"] .nv-list')?.innerText.includes(t), songA.title, 'la rubrique montre la chanson du Space');
let txt = await rubrique(page);
ok(/le projet est ici/i.test(txt) && /ouvert/i.test(txt) && /projets odio · 1/i.test(txt), 'le projet ouvert y est, marqué ; « le projet est ici »');
ok((await page.$$('.tb.go')).length === 1, 'un seul bouton orange');
ok(await page.$eval('.nv-sec[data-sec="space"] #ch-space-btn', (b) => b.textContent.includes('Album été')), 'le menu des Spaces de l’app, dans la rubrique');
await shot(page, 'odio_space_sombre');

// ── le menu : un autre Space ; un clic pose sa chanson ──
await page.click('#ch-space-btn');
await page.waitForSelector('.ch-spmenu');
const lignes = await page.$$eval('.ch-spmenu .mi .lb', (l) => l.map((x) => x.textContent));
ok(['Mon Space', 'Album été', 'Démos', '+ Nouveau Space', 'Tous les Spaces'].every((x) => lignes.includes(x)), `le menu : ${lignes.join(', ')}`);
await shot(page, 'odio_space_menu_sombre');
await page.click('.ch-spmenu .mi:has(.lb:text-is("Démos"))');
await attendre(page, (t) => document.querySelector('.nv-sec[data-sec="space"] .nv-list')?.innerText.includes(t), songB.title, 'choisir « Démos » : la rubrique montre sa chanson');
txt = await rubrique(page);
ok(/le projet est dans « Album été »/i.test(txt) && (await page.$('[data-act="ranger"]')), 'elle dit où est le projet, et propose de le ranger ici');
ok((await projet(page, pid)).music_space === A.id, 'regarder un autre Space ne déplace pas le projet');
const nClips = await page.evaluate(() => window.__mu.S.proj.clips.length);
await page.click(`.nv-sec[data-sec="space"] .nv-it[data-id="${songB.id}"]`);
await attendre(page, ([n, id]) => window.__mu.S.proj.clips.length === n + 1 && window.__mu.S.proj.clips.some((c) => c.item === id), [nClips, songB.id],
  'un clic sur la chanson de « Démos » la pose sur l’arrangement');
await page.waitForTimeout(500);

// ── ranger le projet ici ; Ctrl+Z ──
await page.click('[data-act="ranger"]');
await attendre(page, () => /le projet est ici/i.test(document.querySelector('.nv-sec[data-sec="space"] .nv-list')?.innerText || ''), null, '« Ranger le projet dans « Démos » » : il y est');
pj = await projet(page, pid);
ok(pj.music_space === B.id, `le serveur le dit (${pj.music_space})`);
await page.evaluate(() => document.activeElement?.blur());   // hors d'un champ : Ctrl+Z est à la pile d'ODIO
await page.keyboard.press('Control+z');
await page.waitForTimeout(1200);
pj = await projet(page, pid);
ok(pj.music_space === A.id, `Ctrl+Z : le projet revient dans « Album été » (${pj.music_space})`);
await attendre(page, () => /le projet est dans « Album été »/i.test(document.querySelector('.nv-sec[data-sec="space"] .nv-list')?.innerText || ''), null, 'la rubrique le redit');

// ── ce que génère le panneau naît dans le Space du projet ──
const bodies = [];
page.on('request', (r) => { if (r.method() === 'POST' && /api\/music\/(gen\/generate|stems\/separate)/.test(r.url())) bodies.push(JSON.parse(r.postData() || '{}')); });
await page.evaluate(async () => {
  const { addGenTrack, newRegion } = await import('./generatif_region.js');
  const t = await addGenTrack(window.__mu.app, 'ace');
  await newRegion(window.__mu.app, t, 0, 8);
});
await page.waitForSelector('#gp-go');
await page.click('#gp-go');
await attendre(page, () => (window.__mu.S.proj.pending || []).some((x) => x.kind === 'takes'), null, 'une région en file depuis le panneau Générer');
const gen = bodies.find((b) => b.model);
ok(gen?.project === pid && !gen.music_space, 'la page dit le projet, jamais le Space');
const jg = await waitJob(page, (await page.evaluate(() => window.__mu.S.proj.pending.find((x) => x.kind === 'takes')?.job)));
const takes = jg.items || [];
ok(jg.state === 'done' && takes.length && takes.every((x) => x.music_space === A.id), `les versions naissent dans le Space du projet (${takes.map((x) => x.music_space).join(' ')})`);
await choisirSpace(page, 'Album été');
await attendre(page, (t) => document.querySelector('.nv-sec[data-sec="space"] .nv-list')?.innerText.includes(t), takes[0]?.title, 'et y paraissent (rubrique « Space », Sons)');
// des stems d'un son sans Space : dans le Space du projet
const up = await page.evaluate(async (u) => {
  const blob = await (await fetch(`/${u}`)).blob();
  const r = await fetch('/api/library/upload?name=nu.wav&title=Son%20nu', { method: 'PUT', body: blob });
  return r.json();
}, songA.url);
await page.evaluate(async (it) => { const [c] = await window.__mu.app.placeItems([it], {}); window.__mu.app.stems(c.id); }, up);
await attendre(page, () => (window.__mu.S.proj.pending || []).some((x) => x.kind === 'stems'), null, 'une séparation en file');
const sep = bodies.find((b) => b.src === up.id);
const js = await waitJob(page, (await page.evaluate(() => window.__mu.S.proj.pending.find((x) => x.kind === 'stems')?.job)) || '');
const stems = await Promise.all(Object.values(js.result?.stems || {}).map((id) => api(page, `library/${id}`)));
ok(sep?.project === pid && js.state === 'done' && stems.length && stems.every((x) => x.music_space === A.id),
  `les stems d’un son sans Space naissent dans le Space du projet (${js.state} ${stems.map((x) => x.music_space).join(' ')})`);
await attendre(page, () => /stems ·/i.test(document.querySelector('.nv-sec[data-sec="space"] .nv-list')?.innerText || ''), null, 'et paraissent dans la rubrique (Stems)');
await shot(page, 'odio_space_genere_sombre');

// ── la Session : le même navigateur, la même rubrique ──
await page.click('.gp-dr button:has-text("Fermer")');   // le panneau Générer, refermé
await page.click('.mu-views [data-view="console"]');
await page.waitForSelector('.ss-body .nv-sec[data-sec="space"] .nv-spn');
ok((await page.textContent('.ss-body .nv-sec[data-sec="space"] .nv-spn')) === 'Album été', 'la Session : la rubrique « Space » y est aussi');
const nSlots = await page.evaluate(() => (window.__mu.S.proj.slots || []).length);
await page.click(`.ss-body .nv-sec[data-sec="space"] .nv-it[data-id="${songA.id}"]`);
await attendre(page, (n) => (window.__mu.S.proj.slots || []).length === n + 1, nSlots, 'un clic sur la chanson la pose dans une case de la Session');
await shot(page, 'odio_space_session_sombre');
await page.click('.mu-views [data-view="timeline"]');

// ── un projet neuf naît dans le Space montré ──
await choisirSpace(page, 'Démos');
await page.click('.mu-bar button[title^="nouveau projet"]');
await page.click('.sr-menu .mi:has-text("Nouveau projet")');
await page.waitForSelector('.mu-tpl-sp');
ok((await page.textContent('.mu-tpl-sp')).includes('« Démos »'), 'Nouveau projet : il dit le Space où il naît');
await page.fill('.modal input.fld', 'Projet des démos');
await Promise.all([page.waitForURL(/\?p=mus-/), page.click('.modal .tb.go')]);
await page.waitForFunction((old) => new URL(location.href).searchParams.get('p') !== old, pid);
const pid2 = new URL(page.url()).searchParams.get('p');
ok((await projet(page, pid2)).music_space === B.id, 'il naît dans « Démos »');
await attendre(page, () => document.querySelector('.nv-sec[data-sec="space"] .nv-spn')?.textContent === 'Démos', null, 'la rubrique suit le projet ouvert');
// un clic sur un projet du Space l'ouvre
await choisirSpace(page, 'Album été');
await page.click(`.nv-sec[data-sec="space"] .nv-proj[data-id="${pid}"]`);
await attendre(page, (id) => new URL(location.href).searchParams.get('p') === id, pid, 'un clic sur un projet de la rubrique l’ouvre');
await choisirSpace(page, 'Tous les Spaces');
txt = await rubrique(page);
ok(/tous les spaces · le projet est dans « Album été »/i.test(txt) && txt.includes('DÉMOS') && txt.includes('ALBUM ÉTÉ'), '« Tous les Spaces » : chaque objet dit son Space');
await ctx.close();

// ── le clair ──
{
  const { ctx: c2, page: p2 } = await newPage('light');
  await p2.goto(`${base}/musique/?p=${pid}`, { waitUntil: 'networkidle' });
  await p2.waitForSelector('.nv-sec[data-sec="space"] .nv-spn');
  await attendre(p2, (t) => document.querySelector('.nv-sec[data-sec="space"] .nv-list')?.innerText.includes(t), songA.title, 'clair : la rubrique, le Space du projet');
  ok((await p2.getAttribute('html', 'data-theme')) === 'light', 'le thème clair est posé');
  await shot(p2, 'odio_space_clair');
  await p2.click('#ch-space-btn');
  await shot(p2, 'odio_space_menu_clair');
  await c2.close();
}

// ── l'app Musique : les projets ODIO du Space ──
for (const theme of ['dark', 'light']) {
  const { ctx: c3, page: p3 } = await newPage(theme);
  await p3.goto(`${base}/chanson/`, { waitUntil: 'networkidle' });
  await p3.waitForSelector('#ch-space-btn');
  await choisirSpace(p3, 'Album été');
  await attendre(p3, (id) => !!document.querySelector(`#ch-projets .ch-proj[data-id="${id}"]`), pid, `${theme} : l’app montre le projet ODIO du Space`);
  ok(!(await p3.$(`#ch-projets .ch-proj[data-id="${pid2}"]`)), `${theme} : pas celui de « Démos »`);
  ok((await p3.$$('.tb.go')).length === 1, `${theme} : un seul bouton orange`);
  await shot(p3, `app_projets_${theme === 'dark' ? 'sombre' : 'clair'}`);
  if (theme === 'dark') {
    await p3.click(`#ch-projets .ch-proj[data-id="${pid}"] .sr-kebab`);
    await p3.click('.sr-menu .mi:has-text("Déplacer vers")');
    await p3.click('.sr-menu .mi:has-text("Démos")');
    await attendre(p3, (id) => !document.querySelector(`#ch-projets .ch-proj[data-id="${id}"]`), pid, '« Déplacer vers… » : le projet quitte « Album été »');
    ok((await projet(p3, pid)).music_space === B.id, 'le serveur le range dans « Démos »');
    await p3.evaluate(() => document.activeElement?.blur());
    await p3.keyboard.press('Control+z');
    await attendre(p3, (id) => !!document.querySelector(`#ch-projets .ch-proj[data-id="${id}"]`), pid, 'Ctrl+Z le rend');
    await choisirSpace(p3, 'Tous les Spaces');
    await attendre(p3, (id) => !!document.querySelector(`#ch-projets .ch-proj[data-id="${id}"] .ch-sp-tag`), pid2, '« Tous les Spaces » : la pastille du Space sur chaque projet');
    await Promise.all([p3.waitForURL(/\/musique\/\?p=/), p3.click(`#ch-projets .ch-proj[data-id="${pid2}"] [data-act="odio"]`)]);
    ok(new URL(p3.url()).searchParams.get('p') === pid2, '« Ouvrir dans ODIO » ouvre le projet');
  }
  await c3.close();
}

await browser.close();
writeFileSync(`${out}/pilote_odio_spaces.log`, log.join('\n') + '\n');
console.log(`\n${fails ? `${fails} ÉCHEC(S)` : 'tout passe'} — captures et journal dans ${out}`);
process.exit(fails ? 1 : 0);
