// Le pilote du son au défilement (commun/scrub.js) : Chromium sans affichage, un portail d'essai,
// jamais le portail en ligne.
//
//   node commun/pilote_scrub.mjs http://127.0.0.1:8847 /tmp/sr_scrub_shots [/tmp/sr_scrub/data]
//   SR_PLAYWRIGHT=/opt/node22/lib/node_modules/playwright node commun/pilote_scrub.mjs …   (une session cloud)
//
// Une vidéo VP9/Opus et un son WAV fabriqués par ffmpeg (le Chromium d'une session cloud ne lit
// pas le H.264), déposés par l'API. On compte les grains programmés en espionnant
// AudioBufferSourceNode.start (un grain : start(quand, où, durée), 0,25 s au plus) et les
// compteurs des pages (le lecteur : `etat().grains` ; le Montage : `program.son` ; ODIO :
// `__muDefil.notes`). En sombre puis en clair :
//   - le LECTEUR commun (la fiche d'Asset, une vidéo puis un son) : glisser la frise → des
//     grains, un simple clic → aucun ; ← → et K tenue + J ou L → un grain par image ; J (la
//     lecture à rebours) → des grains ; la lecture en avant → aucun ; la préférence coupée → aucun ;
//   - le MONTAGE (une séquence faite de la vidéo) : glisser la règle → des grains ; ← → et
//     K + J ou L → un par image ; J → des grains ; la lecture → aucun ; préférence coupée → aucun ;
//   - ODIO (le projet de démonstration, ses clips de notes) : glisser la règle de l'arrangement →
//     des notes, pas plus de huit par pas ; un clic → aucune ; préférence coupée → aucune ;
//   - MOVIE ANALYSIS, si l'on donne le dossier des données du portail d'essai (3ᵉ argument) : une
//     analyse « lancée d'ici » y est posée (portail.json, sa vidéo, `origine.item` = la vidéo
//     déposée) ; glisser la frise de sa visionneuse → des grains, K tenue + L → un par image.
// Aucune erreur de console (hors des ressources externes que le conteneur bloque). Rend 0 si tout
// passe ; le détail dans <out>/pilote_scrub.log.
import { createRequire } from 'module';
import { writeFileSync, mkdirSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

const require = createRequire('/home/dgx/Character_Sheet/package.json');
const { chromium } = require(process.env.SR_PLAYWRIGHT || 'playwright');
const [base, out, donnees] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ── les médias (ffmpeg), déposés ──
const tmp = mkdtempSync(join(tmpdir(), 'sr-pilote-scrub-'));
const deposer = async (nom, args, titre) => {
  const p = join(tmp, nom);
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, p]);
  const r = await fetch(`${base}/api/library/upload?name=${nom}&title=${encodeURIComponent(titre)}`, { method: 'PUT', body: readFileSync(p) });
  return r.json();
};
const vid = await deposer('scrub.webm', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=6', '-f', 'lavfi', '-i', 'sine=f=440:d=6',
  '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '300k', '-c:a', 'libopus', '-shortest'], 'Pilote scrub vidéo');
const son = await deposer('scrub.wav', ['-f', 'lavfi', '-i', 'sine=f=330:d=5'], 'Pilote scrub son');
rmSync(tmp, { recursive: true, force: true });
ok(vid.kind === 'video' && vid.audio && son.kind === 'audio', `les médias déposés (${vid.id}, ${son.id})`);

const browser = await chromium.launch();
const externe = (t) => /ERR_CERT_AUTHORITY_INVALID|ERR_NAME_NOT_RESOLVED|ERR_TUNNEL|ERR_CONNECTION|fonts\.g|jsdelivr/.test(t);
async function page(theme) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t, scrub: true } }, dirty: { general: { theme: t, scrub: true } } })); } catch { /* */ }
    // les grains : start(quand, où, durée) d'un AudioBufferSourceNode, 0,25 s au plus
    window.__sc = { grains: 0 };
    const s0 = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) { if (a.length >= 3 && a[2] <= 0.25) window.__sc.grains++; return s0.apply(this, a); };
  }, theme);
  const pg = await ctx.newPage();
  pg.on('console', (m) => { if (m.type() === 'error' && !externe(m.text())) { log.push(`console ${theme}: ${m.text()}`); fails++; } });
  pg.on('pageerror', (e) => { log.push(`PAGEERROR ${theme}: ${e.message}`); fails++; });
  return { ctx, pg };
}
const grains = (pg) => pg.evaluate(() => window.__sc.grains);
// la préférence Général → « Son au défilement » ; le temps qu'elle parte au serveur (prefs.js : 400 ms),
// pour qu'un « vrai » rendu ne reste pas coupé sur le portail d'essai
const pref = async (pg, on) => { await pg.evaluate(async (v) => { const m = await import('/commun/prefs.js'); m.prefs.set('general.scrub', v); }, on); await pause(700); };
// glisser de x0 à x1 sur la hauteur y, en n mouvements sur ms
async function glisser(pg, x0, x1, y, n = 40, ms = 900) {
  await pg.mouse.move(x0, y);
  await pg.mouse.down();
  for (let i = 1; i <= n; i++) { await pg.mouse.move(x0 + ((x1 - x0) * i) / n, y); await pause(ms / n); }
  await pg.mouse.up();
  await pause(150);
}
async function touches(pg, k, n, gap = 70) { for (let i = 0; i < n; i++) { await pg.keyboard.press(k); await pause(gap); } await pause(120); }
// K tenue, J ou L n fois
async function kTenue(pg, k, n) { await pg.keyboard.down('k'); await pause(60); await touches(pg, k, n); await pg.keyboard.up('k'); }
const delta = async (pg, f) => { const a = await grains(pg); await f(); return (await grains(pg)) - a; };

// ── le lecteur commun : la fiche d'Asset ──
async function lecteur(theme, it, quoi) {
  const { ctx, pg } = await page(theme);
  await pg.goto(`${base}/asset/#${it.id}`);
  await pg.waitForFunction(() => document.querySelector('.sr-lect')?.srLecteur?.duree > 0, null, { timeout: 20000 });
  const L = (f) => pg.evaluate(f);
  const frise = await pg.$eval('.sr-lect-defile', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
  // le son de défilement se charge au survol
  const flac = pg.waitForResponse((r) => r.url().includes('defil-son'), { timeout: 15000 }).catch(() => null);
  await pg.mouse.move(frise.x + 20, frise.y);
  ok(!!(await flac), `${theme} · lecteur ${quoi} : le son de défilement se charge au survol de la frise`);
  await pause(500);
  let d = await delta(pg, () => glisser(pg, frise.x + 30, frise.x + frise.w * 0.7, frise.y));
  const e = await L(() => document.querySelector('.sr-lect').srLecteur.etat());
  ok(d >= 15 && e.grains === d, `${theme} · lecteur ${quoi} : glisser la frise → ${d} grains (le lecteur en compte ${e.grains})`);
  d = await delta(pg, async () => { await pg.mouse.click(frise.x + frise.w * 0.4, frise.y); await pause(300); });
  ok(d === 0, `${theme} · lecteur ${quoi} : un simple clic → ${d} grain`);
  await pg.mouse.move(frise.x + frise.w * 0.4, frise.y + 300);
  d = await delta(pg, () => touches(pg, 'ArrowRight', 6));
  ok(d === 6, `${theme} · lecteur ${quoi} : → six fois → ${d} grains`);
  d = await delta(pg, () => touches(pg, 'ArrowLeft', 4));
  ok(d === 4, `${theme} · lecteur ${quoi} : ← quatre fois → ${d} grains`);
  const t0 = await L(() => document.querySelector('.sr-lect').srLecteur.t);
  d = await delta(pg, () => kTenue(pg, 'l', 5));
  const t1 = await L(() => document.querySelector('.sr-lect').srLecteur.t);
  const fps = it.fps || 25;
  ok(d === 5 && Math.round((t1 - t0) * fps) === 5, `${theme} · lecteur ${quoi} : K tenue + L cinq fois → ${d} grains, ${Math.round((t1 - t0) * fps)} images`);
  d = await delta(pg, () => kTenue(pg, 'j', 3));
  ok(d === 3, `${theme} · lecteur ${quoi} : K tenue + J trois fois → ${d} grains`);
  d = await delta(pg, async () => { await pg.keyboard.press('j'); await pause(700); await pg.keyboard.press('k'); await pause(150); });
  ok(d >= 8, `${theme} · lecteur ${quoi} : J (à rebours) → ${d} grains`);
  d = await delta(pg, async () => { await pg.keyboard.press('Home'); await pg.keyboard.press(' '); await pause(1200); await pg.keyboard.press(' '); await pause(150); });
  const lu = await L(() => document.querySelector('.sr-lect').srLecteur.t);
  ok(d === 0 && lu > 0.5, `${theme} · lecteur ${quoi} : la lecture (${lu.toFixed(2)} s) → ${d} grain`);
  await pg.screenshot({ path: join(out, `lecteur_${quoi}_${theme}.png`) });
  await pref(pg, false);
  d = await delta(pg, async () => { await glisser(pg, frise.x + 30, frise.x + frise.w * 0.7, frise.y); await pg.mouse.move(frise.x, frise.y + 300); await touches(pg, 'ArrowRight', 3); await kTenue(pg, 'l', 2); });
  ok(d === 0, `${theme} · lecteur ${quoi} : préférence coupée → ${d} grain`);
  await pref(pg, true);
  await ctx.close();
}

// ── le Montage : une séquence faite de la vidéo ──
async function montage(theme, seq) {
  const { ctx, pg } = await page(theme);
  await pg.goto(`${base}/montage/`);
  await pg.waitForFunction(() => window.montage && window.montage.openProject, null, { timeout: 20000 });
  await pg.evaluate((id) => window.montage.openProject(id), seq);
  await pg.waitForFunction(() => window.montage.S.p && window.montage.program.duration() > 1, null, { timeout: 20000 });
  await pg.evaluate(() => { window.montage.program.prechargerSons(); window.montage.focus('program'); });
  await pause(1500);
  const M = (f) => pg.evaluate(f);
  const r = await pg.evaluate(() => { const b = window.montage.timeline.ruler.getBoundingClientRect(); return { x: b.left, y: b.top + b.height / 2, w: b.width }; });
  let d = await delta(pg, () => glisser(pg, r.x + 20, r.x + Math.min(r.w * 0.5, 400), r.y));
  ok(d >= 10, `${theme} · Montage : glisser la règle → ${d} grains`);
  await pg.mouse.move(r.x, r.y + 400);
  await M(() => { window.montage.program.seek(1); window.montage.focus('program'); });
  d = await delta(pg, () => touches(pg, 'ArrowRight', 6));
  const f1 = await M(() => window.montage.program.frame());
  ok(d === 6, `${theme} · Montage : → six fois → ${d} grains (image ${f1})`);
  d = await delta(pg, () => kTenue(pg, 'l', 4));
  const f2 = await M(() => window.montage.program.frame());
  ok(d === 4 && f2 - f1 === 4, `${theme} · Montage : K tenue + L quatre fois → ${d} grains, ${f2 - f1} images`);
  d = await delta(pg, () => kTenue(pg, 'j', 2));
  ok(d === 2, `${theme} · Montage : K tenue + J deux fois → ${d} grains`);
  d = await delta(pg, async () => { await pg.keyboard.press('j'); await pause(600); await pg.keyboard.press('k'); await pause(150); });
  ok(d >= 8, `${theme} · Montage : J (à rebours) → ${d} grains`);
  d = await delta(pg, async () => { await M(() => window.montage.program.seek(0)); await pg.keyboard.press('l'); await pause(1200); await pg.keyboard.press('k'); await pause(150); });
  const lu = await M(() => window.montage.program.t);
  ok(d === 0 && lu > 0.5, `${theme} · Montage : la lecture (${lu.toFixed(2)} s) → ${d} grain`);
  // le moniteur source : la vidéo seule, ses pas et son rebours
  await M(async () => { const it = await (await fetch('/api/library/' + window.montage.program.getP().clips[0].item)).json(); window.montage.source.load(it); });
  await pg.waitForFunction(() => window.montage.source.el?.readyState >= 1, null, { timeout: 15000 });
  await M(() => { window.montage.source.seek(1); window.montage.focus('source'); });
  await pause(300);
  d = await delta(pg, () => touches(pg, 'ArrowRight', 5));
  ok(d === 5, `${theme} · Montage, la source : → cinq fois → ${d} grains`);
  d = await delta(pg, () => kTenue(pg, 'j', 3));
  ok(d === 3, `${theme} · Montage, la source : K tenue + J trois fois → ${d} grains`);
  d = await delta(pg, async () => { await M(() => window.montage.source.seek(4)); await pg.keyboard.press('j'); await pause(600); await pg.keyboard.press('k'); await pause(150); });
  ok(d >= 8, `${theme} · Montage, la source : J (à rebours) → ${d} grains`);
  await M(() => window.montage.focus('program'));
  await pg.screenshot({ path: join(out, `montage_${theme}.png`) });
  await pref(pg, false);
  d = await delta(pg, async () => { await glisser(pg, r.x + 20, r.x + Math.min(r.w * 0.5, 400), r.y); await pg.mouse.move(r.x, r.y + 400); await touches(pg, 'ArrowRight', 3); await kTenue(pg, 'l', 2); });
  ok(d === 0, `${theme} · Montage : préférence coupée → ${d} grain`);
  await pref(pg, true);
  await ctx.close();
}

// ── ODIO : les clips de notes du projet de démonstration ──
async function odio(theme) {
  const { ctx, pg } = await page(theme);
  await pg.goto(`${base}/musique/`);
  await pg.waitForFunction(() => window.__mu?.S?.proj && window.__muDefil && document.querySelector('.ar-nums'), null, { timeout: 30000 });
  await pause(800);
  const n0 = await pg.evaluate(() => window.__muDefil.notes);
  const nums = await pg.$eval('.ar-nums', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
  // le moteur part au premier geste : un premier glisser l'allume
  await glisser(pg, nums.x + 10, nums.x + 40, nums.y, 6, 200);
  await pg.waitForFunction(() => window.__mu.engine.ctx?.state === 'running', null, { timeout: 10000 }).catch(() => {});
  const avant = await pg.evaluate(() => ({ n: window.__muDefil.notes, g: window.__muDefil.grains }));
  // les pas de la mécanique, notés : pas plus de huit notes par pas
  await pg.evaluate(() => {
    const e = window.__muDefil, s0 = e.aller; window.__pas = [];
    let n = e.notes;
    e.aller = (t) => { s0(t); if (e.notes !== n) { window.__pas.push(e.notes - n); n = e.notes; } };
  });
  await glisser(pg, nums.x + 10, nums.x + Math.min(nums.w - 20, 900), nums.y, 60, 1500);
  const apres = await pg.evaluate(() => ({ n: window.__muDefil.notes, g: window.__muDefil.grains, pas: window.__pas, beat: window.__mu.engine.pos }));
  const dn = apres.n - avant.n;
  ok(dn >= 10, `${theme} · ODIO : glisser la règle de l'arrangement (jusqu'à la noire ${apres.beat.toFixed(1)}) → ${dn} notes en ${apres.pas.length} pas`);
  ok(Math.max(0, ...apres.pas) <= 8, `${theme} · ODIO : ${Math.max(0, ...apres.pas)} notes au plus par pas (huit permises)`);
  ok(apres.g === avant.g, `${theme} · ODIO : aucun grain de son (le projet de démonstration n'a pas de clip audio)`);
  let d = await pg.evaluate(() => window.__muDefil.notes);
  await pg.mouse.click(nums.x + 200, nums.y); await pause(300);
  d = (await pg.evaluate(() => window.__muDefil.notes)) - d;
  ok(d === 0, `${theme} · ODIO : un simple clic sur la règle → ${d} note`);
  // à rebours aussi
  d = await pg.evaluate(() => window.__muDefil.notes);
  await glisser(pg, nums.x + Math.min(nums.w - 20, 900), nums.x + 300, nums.y, 40, 1000);
  d = (await pg.evaluate(() => window.__muDefil.notes)) - d;
  ok(d >= 5, `${theme} · ODIO : glisser à rebours → ${d} notes`);
  await pg.screenshot({ path: join(out, `odio_${theme}.png`) });
  await pref(pg, false);
  d = await pg.evaluate(() => window.__muDefil.notes);
  await glisser(pg, nums.x + 10, nums.x + Math.min(nums.w - 20, 900), nums.y, 40, 1000);
  d = (await pg.evaluate(() => window.__muDefil.notes)) - d;
  ok(d === 0, `${theme} · ODIO : préférence coupée → ${d} note`);
  await pref(pg, true);
  ok(n0 === 0, `${theme} · ODIO : aucune note avant le premier geste (${n0})`);
  await ctx.close();
}

// ── Movie Analysis : une analyse lancée d'ici, posée dans les données du portail d'essai ──
async function analyse(theme) {
  const { ctx, pg } = await page(theme);
  await pg.goto(`${base}/analyse/#pilote-scrub`);
  await pg.waitForFunction(() => document.querySelector('.sr-lect')?.srLecteur?.duree > 0, null, { timeout: 20000 });
  await pause(600);
  const fr = await pg.$eval('.sr-lect-defile', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
  await pg.mouse.move(fr.x + 20, fr.y);
  await pause(1200);
  let d = await delta(pg, () => glisser(pg, fr.x + 30, fr.x + fr.w * 0.6, fr.y));
  ok(d >= 15, `${theme} · Movie Analysis : glisser la frise de la visionneuse → ${d} grains`);
  await pg.mouse.move(fr.x, fr.y - 300);
  d = await delta(pg, () => kTenue(pg, 'l', 3));
  ok(d === 3, `${theme} · Movie Analysis : K tenue + L trois fois → ${d} grains (les flèches y changent de projet)`);
  await pg.screenshot({ path: join(out, `analyse_${theme}.png`) });
  await ctx.close();
}

try {
  if (donnees) {
    const { cpSync } = await import('fs');
    const d = join(donnees, 'analyses', 'pilote-scrub');
    mkdirSync(d, { recursive: true });
    cpSync(join(donnees, 'library', vid.id, vid.file), join(d, 'pilote-scrub.webm'));
    writeFileSync(join(d, 'index.html'), '<!doctype html><meta charset="utf-8"><title>pilote</title>\n');
    writeFileSync(join(d, 'portail.json'), JSON.stringify({ titre: 'Pilote scrub', page: 'index.html', forme: 'portail', video: 'pilote-scrub.webm', origine: { item: vid.id } }));
    const pr = ((await (await fetch(`${base}/api/analyse/projets`)).json()).projets || []).find((x) => x.id === 'pilote-scrub');
    ok(pr && pr.item === vid.id, `Movie Analysis : l'analyse posée dit sa vidéo de la bibliothèque (${pr && pr.item})`);
  }
  const r = await fetch(`${base}/api/montage/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from_item: vid.id }) });
  const seq = await r.json();
  ok(!!seq.id, `une séquence faite de la vidéo (${seq.id})`);
  for (const theme of ['dark', 'light']) {
    await lecteur(theme, vid, 'vidéo');
    await lecteur(theme, son, 'son');
    await montage(theme, seq.id);
    await odio(theme);
    if (donnees) await analyse(theme);
  }
} catch (e) { ok(false, `le pilote s'est arrêté : ${e.stack || e.message}`); }
await browser.close();
writeFileSync(join(out, 'pilote_scrub.log'), log.join('\n') + '\n');
console.log(fails ? `${fails} échec(s)` : 'tout passe');
process.exit(fails ? 1 : 0);
