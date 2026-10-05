// Le pilote des poignées du Montage (06/10, Cal : « les poignées sont des in/out sans changer la
// position des frames dans la timeline ») : Chromium sans affichage, un portail d'essai, jamais le
// portail en ligne.
//
//   node montage/pilote_poignees.mjs http://127.0.0.1:8844 /tmp/sr_poignees
//   SR_PLAYWRIGHT=/opt/node22/lib/node_modules/playwright node montage/pilote_poignees.mjs …   (une session cloud)
//
// Les médias sont fabriqués par ffmpeg, en VP9 et Opus (le Chromium d'une session cloud ne lit pas le
// H.264) : une vidéo à 25 i/s dont chaque image porte son numéro, incrusté et codé dans la couleur
// d'un coin (rouge = n mod 16, vert = n div 16, par pas de 16), avec un son de bips (un toutes les
// 0,5 s, un long à 3 s) ; le même son seul ; une image fixe. Déposés par l'API, une séquence par cas.
//
// À la souris, dans le vrai Montage, on tire les poignées et on lit, avant, pendant et après le
// geste : le modèle (début, durée, entrée, vitesse de chaque plan), l'image que montre le moniteur
// à un instant T fixe (le coin codé de l'élément qui se voit), le temps de la source que chaque son
// fait entendre à T (program.sons), l'origine de la bande des vignettes, l'onde (la hauteur
// dessinée à chaque x de l'écran). Les cas : une vidéo avec son, un son seul, les deux ensemble,
// un zoom fort, l'aimant, rogner puis re-tirer vers la gauche, une vitesse de ×1,5, une image fixe,
// le bord de fin, puis B, N, R. Chaque geste se défait par Ctrl+Z. Sombre, puis clair (un cas).
// Aucune erreur de console. Rend 0 si tout passe ; le détail dans <out>/pilote_poignees.log.
import { createRequire } from 'module';
import { writeFileSync, mkdirSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

const require = createRequire('/home/dgx/Character_Sheet/package.json');
const { chromium } = require(process.env.SR_PLAYWRIGHT || 'playwright');
const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };
const J = (x) => JSON.stringify(x);
const api = async (path, body, method = body ? 'POST' : 'GET') => {
  const r = await fetch(`${base}/api/${path}`, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  return r.json();
};

// ── les médias ─────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'sr_poignees_'));
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...a]);
const code = "format=gbrp,geq=r='if(lt(X,160)*lt(Y,160),mod(N,16)*16+8,90)':g='if(lt(X,160)*lt(Y,160),floor(N/16)*16+8,90)':b='if(lt(X,160)*lt(Y,160),128,90)'";
const bips = "aevalsrc='if(lt(mod(t\\,0.5)\\,0.06)\\,0.9*sin(2*PI*880*t)\\,0)+if(between(t\\,3\\,3.4)\\,0.9*sin(2*PI*330*t)\\,0)':d=8:s=48000";
let numero = `${code},drawtext=text='%{frame_num}':fontsize=150:fontcolor=white:box=1:boxcolor=black:x=(w-tw)/2+60:y=(h-th)/2`;
try { ff('-f', 'lavfi', '-i', 'color=c=gray:s=64x36:d=0.04', '-vf', 'drawtext=text=1', '-frames:v', '1', join(tmp, 't.png')); } catch { numero = code; }   // sans freetype : la couleur seule
ff('-f', 'lavfi', '-i', 'color=c=gray:s=640x360:r=25:d=8', '-f', 'lavfi', '-i', bips, '-vf', numero,
  '-c:v', 'libvpx-vp9', '-b:v', '2M', '-deadline', 'realtime', '-cpu-used', '8', '-g', '1', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-shortest', join(tmp, 'num25.webm'));
ff('-f', 'lavfi', '-i', bips, '-c:a', 'libopus', join(tmp, 'bips.ogg'));
ff('-f', 'lavfi', '-i', 'color=c=0x3060c0:s=800x450:d=1', '-frames:v', '1', join(tmp, 'fixe.png'));
const up = async (name, type) => {
  const r = await fetch(`${base}/api/library/upload?name=${name}&tool=montage&title=${name.split('.')[0]}`, { method: 'PUT', headers: { 'Content-Type': type }, body: readFileSync(join(tmp, name)) });
  return r.json();
};
const VID = await up('num25.webm', 'video/webm'), AUD = await up('bips.ogg', 'audio/ogg'), IMG = await up('fixe.png', 'image/png');
rmSync(tmp, { recursive: true, force: true });
ok(VID.kind === 'video' && VID.audio && AUD.kind === 'audio' && IMG.kind === 'image', `médias déposés (${VID.id} ${AUD.id} ${IMG.id})`);

// une séquence 640 × 360 à 25 i/s : la vidéo avec son en V2 (50 → 150, entrée 1 s), son voisin
// (175) ; dessous, en V1, une image fixe (40 → 160) ; le son seul en A1, calé sur la vidéo (même entrée)
async function sequence(name, patch = {}) {
  const p = await api('montage/projects', { name, settings: { format: 'custom', width: 640, height: 360, fps: 25 } });
  const clips = [
    { id: 'kv', track: 'V2', item: VID.id, kind: 'video', title: 'num', start: 50, dur: 100, in: 1.0, src_dur: VID.duration, audio: true, ...(patch.kv || {}) },
    { id: 'kn', track: 'V2', item: VID.id, kind: 'video', title: 'voisin', start: 175, dur: 25, in: 0, src_dur: VID.duration, audio: false },
    { id: 'ki', track: 'V1', item: IMG.id, kind: 'image', title: 'fixe', start: 40, dur: 120, in: 0, src_dur: 0 },
    { id: 'ka', track: 'A1', item: AUD.id, kind: 'audio', title: 'bips', start: 50, dur: 100, in: 1.0, src_dur: AUD.duration, audio: true, ...(patch.ka || {}) },
  ];
  await api(`montage/projects/${p.id}`, { ...p, clips, base_rev: p.rev });
  return p.id;
}

// ── la page ────────────────────────────────────────────────
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--lang=fr-FR'] });
let page = null;
const errs = [];
async function open(seq, theme = 'dark') {
  if (page) await page.context().close();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
  }, theme);
  page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT_AUTHORITY_INVALID|net::ERR_/.test(m.text())) errs.push(`${theme} : ${m.text()}`); });
  page.on('pageerror', (e) => errs.push(`${theme} PAGEERROR : ${e.message}`));
  await page.goto(`${base}/montage/#${seq}`);
  await page.waitForSelector('.clip[data-id="kv"]', { timeout: 20000 });
  await page.waitForFunction(() => window.montage && window.montage.S.p && window.montage.S.p.clips.length === 4);
  await page.waitForTimeout(500);
}
const model = () => page.evaluate(() => Object.fromEntries(window.montage.S.p.clips.map((c) => [c.id, [c.start, c.dur, +(c.in || 0).toFixed(4), c.speed || 1]])));
const geo = (id) => page.$eval(`.clip[data-id="${id}"]`, (n) => {
  // `bande` : l'origine de la bande des vignettes, en px depuis le début de la timeline (le défilement n'y entre pas)
  const r = n.getBoundingClientRect(), b = n.querySelector('.body'), a = n.parentElement.getBoundingClientRect();
  return { l: r.left, w: r.width, t: r.top, h: r.height, bande: r.left - a.left + (parseFloat(getComputedStyle(b).backgroundPositionX) || 0) };
});
// l'image du moniteur : la couche du dessus qui se voit — une vidéo, son numéro lu dans son coin
// codé ; l'image fixe, « fixe » ; rien, null
async function moniteur() {
  for (let k = 0; k < 80; k++) {
    const r = await page.evaluate(() => {
      const vus = [...document.querySelectorAll('#stage video, #stage img')].filter((m) => Number(getComputedStyle(m).opacity) > 0.01)
        .sort((a, b) => (Number(b.style.zIndex) || 0) - (Number(a.style.zIndex) || 0));
      const m = vus[0];
      if (!m) return null;
      if (m.tagName === 'IMG') return 'fixe';
      if (m.seeking || m.readyState < 2) return 'occupé';
      const c = document.createElement('canvas'); c.width = m.videoWidth; c.height = m.videoHeight;
      const x = c.getContext('2d'); x.drawImage(m, 0, 0);
      const d = x.getImageData(Math.round(m.videoWidth * 0.1), Math.round(m.videoHeight * 0.2), 1, 1).data;
      return Math.floor(d[0] / 16) + 16 * Math.floor(d[1] / 16);
    });
    if (r !== 'occupé') return r;
    await page.waitForTimeout(40);
  }
  return 'occupé';
}
// ce que chaque son fait entendre à l'image f : le temps de la source (program.sons, celui du son au défilement)
const sons = (f) => page.evaluate((f) => {
  const P = window.montage.program, p = window.montage.S.p, t = f / p.settings.fps;
  return p.clips.filter((c) => c.kind !== 'image' && (c.track[0] === 'A' || c.audio) && c.start <= f && f < c.start + c.dur)
    .map((c) => [c.id, +(c.in + (t - c.start / p.settings.fps) * (c.speed || 1)).toFixed(4)]).sort();
}, f);
// l'onde d'un plan son : la hauteur dessinée à chaque x entier de l'écran
const onde = (id) => page.$eval(`.clip[data-id="${id}"] canvas.wave`, (cv) => {
  const r = cv.getBoundingClientRect(), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, k = cv.width / r.width, cols = {};
  for (let px = 1; px < r.width - 1; px++) { let s = 0; const cx = Math.floor(px * k); for (let y = 0; y < cv.height; y++) s += d[(y * cv.width + cx) * 4 + 3]; cols[Math.round(r.left + px)] = s; }
  return cols;
}).catch(() => ({}));
// l'onde est-elle restée en place ? Les attaques des bips (le x où une colonne passe du silence au son),
// dans la partie commune aux deux dessins, au pixel près — l'onde se redessine à la résolution de l'écran
// sur un plan qui commence à un x fractionnaire : comparer colonne à colonne mesurerait ce rééchantillonnage
function memeOnde(a, b) {
  const xs = Object.keys(b).map(Number).filter((x) => x in a).sort((u, v) => u - v);
  const haut = Math.max(...xs.map((x) => Math.max(a[x], b[x])));
  const attaques = (o) => xs.filter((x, i) => i > 0 && o[x] > haut * 0.3 && o[xs[i - 1]] <= haut * 0.3);
  const A = attaques(a), B = attaques(b);
  const loin = A.filter((x) => !B.some((y) => Math.abs(x - y) <= 1)).length + B.filter((y) => !A.some((x) => Math.abs(x - y) <= 1)).length;
  return { n: A.length, diff: loin, A, B };
}
async function tete(f) { await page.evaluate((f) => window.montage.program.seekFrame(f), f); await page.waitForTimeout(350); }
const pps = () => page.evaluate(() => window.montage.timeline.pps);
// ce que montre la scène du moniteur, pixel pour pixel (une capture)
const ecran = async () => (await page.locator('#stage').screenshot()).toString('base64');
// tirer une poignée de `n` images (à la souris, en `pas` mouvements) ; `chaque(i)` lit l'état à chaque pas,
// `pendant(…)` avant le lâcher
async function tirer(id, side, n, pendant = null, { pas = 12, chaque = null } = {}) {
  const g = await geo(id), k = await pps() / 25;
  const x0 = side === 'l' ? g.l + 2 : g.l + g.w - 2, y = g.t + g.h / 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let i = 1; i <= pas; i++) {
    await page.mouse.move(x0 + n * k * i / pas, y);
    await page.waitForTimeout(25);
    if (chaque) await chaque(i);
  }
  await page.waitForTimeout(350);
  const vu = pendant ? await pendant() : null;
  await page.mouse.up();
  await page.waitForTimeout(500);
  return vu;
}
const annuler = async () => { await page.keyboard.press('Control+z'); await page.waitForTimeout(400); };
const outil = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(100); };
// l'état complet à l'image T
async function etat(T, ids = ['kv', 'ka']) {
  await tete(T);
  const g = {};
  for (const id of ids) g[id] = await geo(id);
  return { m: await model(), mon: await moniteur(), sons: await sons(T), bande: g.kv && g.kv.bande, onde: ids.includes('ka') ? await onde('ka') : {} };
}

// ── 1. sombre ──────────────────────────────────────────────
const T = 120;   // kv : la source à T = 1 + 70/25 = 3,8 s → l'image 95 ; le long bip (3 s) est à l'image 100
await open(await sequence('poignées'));
const s0 = await etat(T);
ok(s0.mon === 95 && J(s0.sons) === J([['ka', 3.8], ['kv', 3.8]]), `départ : à T=${T}, le moniteur montre l'image 95, les deux sons entendent 3,8 s (${s0.mon} ${J(s0.sons)})`);

// 0. le moniteur PENDANT un rognage (06/10, Cal : « on ne lit plus sous la cue, ça affiche le nouveau in […]
// je préfère avoir les fonctions de in et out ») : l'image sous la tête ne change pas d'un pixel tant que le
// bord ne passe pas la tête ; passé la tête, ce qui est dessous apparaît ; Alt maintenu : l'image du bord.
await outil('v');
// le plan choisi d'abord : son cadre se dessine au moniteur (cadre.js), la capture de référence l'a
await page.click('.clip[data-id="kv"] .body', { position: { x: 60, y: 20 } });
await tete(T);
const e0 = await ecran();
const suivi = [];
const coherent = (c) => c[0] - 50 === Math.round((c[2] - 1) * 25) && c[0] + c[1] === 150;
// lentement d'abord : 40 pas d'un demi-pixel (moins d'une image chacun : 1 image = 1,6 px), puis vite jusqu'à +60 (la tête est à 120)
await tirer('kv', 'l', 12.5, null, { pas: 40, chaque: async () => { suivi.push({ m: (await model()).kv, mon: await moniteur(), e: await ecran() }); } });
ok(suivi.every((x) => x.mon === 95 && x.e === e0 && coherent(x.m)) && new Set(suivi.map((x) => x.m[0])).size > 5,
  `pendant un rognage lent (40 pas d'un demi-pixel, ${new Set(suivi.map((x) => x.m[0])).size} débuts différents) : le moniteur montre l'image sous la tête, la même au pixel près ; le modèle reste juste à chaque pas (${J(suivi.map((x) => x.mon).slice(0, 6))} ${J(suivi.at(-1).m)})`);
await annuler();
const vite = [];
let altVu = null, apresAlt = null;
await tirer('kv', 'l', 75, async () => {
  // le bord a passé la tête (début 125 > 120) : l'image fixe de V1, dessous ; Alt : le bord (entrée 4 s → l'image 100)
  const dessous = await moniteur();
  await page.keyboard.down('Alt'); await page.waitForTimeout(400);
  altVu = await moniteur();
  await page.keyboard.up('Alt'); await page.waitForTimeout(400);
  apresAlt = await moniteur();
  return dessous;
}, { pas: 15, chaque: async (i) => { vite.push({ i, m: (await model()).kv, mon: await moniteur() }); } }).then((dessous) => {
  const avant = vite.filter((x) => x.m[0] <= 120), apres = vite.filter((x) => x.m[0] > 120);
  ok(avant.length >= 10 && avant.every((x) => x.mon === 95 && coherent(x.m)), `pendant un rognage rapide : tant que le bord n'a pas passé la tête, l'image 95 (${J(avant.map((x) => x.mon))})`);
  ok(apres.length && apres.every((x) => x.mon === 'fixe') && dessous === 'fixe', `le bord passe la tête : ce qui est dessous apparaît (l'image fixe de V1) (${J(apres.map((x) => [x.m[0], x.mon]))})`);
});
ok(altVu === 100 && apresAlt === 'fixe', `Alt maintenu pendant le rognage : l'image du bord tiré (l'entrée, 4 s : 100) ; Alt lâché : de nouveau sous la tête (${altVu} → ${apresAlt})`);
await annuler();
const f0 = [];
await tirer('kv', 'r', -40, null, { pas: 10, chaque: async () => { f0.push({ m: (await model()).kv, mon: await moniteur() }); } });
ok(f0.filter((x) => x.m[0] + x.m[1] > 120).every((x) => x.mon === 95) && f0.filter((x) => x.m[0] + x.m[1] <= 120).every((x) => x.mon === 'fixe'),
  `le bord de fin : l'image sous la tête reste 95, puis, la fin passée avant la tête, l'image de dessous (${J(f0.map((x) => [x.m[0] + x.m[1], x.mon]))})`);
await annuler();
ok(J(await model()) === J(s0.m), 'Ctrl+Z rend le plan après chaque rognage');

// 1. V, une vidéo avec son, début +20
let vu = await tirer('kv', 'l', 20, async () => ({ mon: await moniteur(), bulle: await page.$eval('.tl-tip', (n) => n.textContent).catch(() => '') }));
let s1 = await etat(T);
ok(J(s1.m.kv) === J([70, 80, 1.8, 1]) && J(s1.m.ka) === J(s0.m.ka) && J(s1.m.kn) === J(s0.m.kn) && J(s1.m.ki) === J(s0.m.ki),
  `V, vidéo avec son, début +20 : début 70, durée 80, entrée 1,8 s ; rien d'autre ne bouge (${J(s1.m)})`);
ok(s1.mon === s0.mon && J(s1.sons) === J(s0.sons), `V, vidéo avec son : à T, la même image (${s1.mon}) et le même son (${J(s1.sons)})`);
ok(Math.abs(s1.bande - s0.bande) < 0.05, `V, vidéo avec son : la bande des vignettes ne bouge pas (${s0.bande.toFixed(2)} → ${s1.bande.toFixed(2)})`);
ok(vu.mon === 95 && /source 0:01\.8/.test(vu.bulle), `V, vidéo avec son : pendant le geste, le moniteur montre l'image sous la tête ; la bulle dit la source (${vu.mon} · ${vu.bulle})`);
await annuler();
ok(J(await model()) === J(s0.m), 'V, vidéo avec son : Ctrl+Z rend le plan tel qu’il était');

// 1 bis. le bord de fin −20 : la sortie seule
await tirer('kv', 'r', -20);
s1 = await etat(T);
ok(J(s1.m.kv) === J([50, 80, 1, 1]) && s1.mon === s0.mon && J(s1.sons) === J(s0.sons), `V, fin −20 : durée 80, entrée inchangée ; à T la même image et le même son (${J(s1.m.kv)} ${s1.mon})`);
await annuler();

// 2. V, le son seul, début +20 : l'onde reste à sa place
await tirer('ka', 'l', 20);
s1 = await etat(T);
const o = memeOnde(s0.onde, s1.onde);
ok(J(s1.m.ka) === J([70, 80, 1.8, 1]) && J(s1.m.kv) === J(s0.m.kv), `V, son seul, début +20 : début 70, durée 80, entrée 1,8 s ; la vidéo ne bouge pas (${J(s1.m.ka)})`);
ok(o.n >= 5 && !o.diff, `V, son seul : l'onde reste à sa place (${o.n} attaques de bips, au même x d'écran à 1 px près : ${J(o.A.slice(0, 5))} / ${J(o.B.slice(0, 5))})`);
ok(J(s1.sons) === J(s0.sons), `V, son seul : à T, les deux sons entendent le même temps de leur source (${J(s1.sons)})`);
await annuler();

// 3. les deux ensemble : choisis tous deux, chacun son geste (un plan dissocié n'est lié à rien)
await page.click('.clip[data-id="kv"] .body', { position: { x: 120, y: 20 } });
await page.click('.clip[data-id="ka"] .body', { position: { x: 120, y: 20 }, modifiers: ['Shift'] });
await tirer('kv', 'l', 20);
let m = await model();
ok(J(m.kv) === J([70, 80, 1.8, 1]) && J(m.ka) === J(s0.m.ka), `ensemble : la poignée de la vidéo ne rogne qu'elle (le son dissocié n'y est pas lié) (${J(m.kv)} ${J(m.ka)})`);
await tirer('ka', 'l', 20);
s1 = await etat(T);
ok(J(s1.m.ka) === J([70, 80, 1.8, 1]) && J(s1.sons) === J(s0.sons) && s1.mon === s0.mon,
  `ensemble : les deux rognés de 20, l'image et le son restent sur la même seconde à T (${s1.mon} ${J(s1.sons)})`);
const o2 = memeOnde(s0.onde, s1.onde);
ok(o2.n >= 5 && !o2.diff && Math.abs(s1.bande - s0.bande) < 0.05, `ensemble : l'onde (${o2.n} attaques au même x) et les vignettes ne bougent pas`);
await annuler(); await annuler();
ok(J(await model()) === J(s0.m), 'ensemble : deux Ctrl+Z rendent les deux plans');

// 4. un zoom fort : 800 px par seconde (32 px par image), le début de kv à l'écran, +3 images
const pps0 = await pps();
await page.evaluate(() => { const tl = window.montage.timeline; tl.setPps(800); });
await page.evaluate(() => { const tl = window.montage.timeline; tl.scroll.scrollLeft = 50 / 25 * 800 - 200; tl.render(); });
await page.waitForTimeout(300);
const gz0 = await geo('kv');
await tete(53);
const mz0 = await moniteur();
await tirer('kv', 'l', 3);
const gz1 = await geo('kv');
m = await model();
const mz1 = await moniteur();
ok(J(m.kv) === J([53, 97, 1.12, 1]) && Math.abs((gz1.l - gz0.l) - 96) < 1 && Math.abs(gz1.bande - gz0.bande) < 0.05,
  `zoom fort : +3 images = 96 px, entrée 1,12 s, la bande des vignettes ne bouge pas (${J(m.kv)} ${(gz1.l - gz0.l).toFixed(1)} px)`);
ok(mz0 === 28 && mz1 === 28, `zoom fort : à l'image 53 (la première qui reste), le moniteur montre la même image avant et après (${mz0} → ${mz1})`);
await annuler();
await page.evaluate((v) => window.montage.timeline.setPps(v), pps0);
await page.waitForTimeout(200);

// 5. l'aimant : la tête à 68, le bord tiré de ~17,3 images (une image avant elle) se colle à elle
await tete(68);
let snap = false;
await tirer('kv', 'l', 17.3, async () => { snap = await page.$eval('.tl-snap', (n) => !n.hidden); return null; });
m = await model();
s1 = await etat(T);
ok(J(m.kv) === J([68, 82, 1.72, 1]) && snap, `aimant : le bord se colle à la tête (68), l'entrée suit d'autant (1,72 s), le repère se voit (${J(m.kv)} ${snap})`);
ok(s1.mon === s0.mon && J(s1.sons) === J(s0.sons), `aimant : à T, la même image et le même son (${s1.mon})`);
await annuler();

// 6. rogner, puis re-tirer vers la gauche : révéler le début, jusqu'au début de la source
await tirer('kv', 'l', 20);
await tirer('kv', 'l', -12);
s1 = await etat(T);
ok(J(s1.m.kv) === J([58, 92, 1.32, 1]) && s1.mon === s0.mon && J(s1.sons) === J(s0.sons) && Math.abs(s1.bande - s0.bande) < 0.05,
  `re-tirer : +20 puis −12 → début 58, entrée 1,32 s (à −15, l'aimant le colle au début du son, à 50) ; à T la même image, le même son ; la bande ne bouge pas (${J(s1.m.kv)} ${s1.mon} ${J(s1.sons)} ${s0.bande.toFixed(2)} → ${s1.bande.toFixed(2)})`);
await tirer('kv', 'l', -60);
s1 = await etat(T);
await tete(25);
const mDebut = await moniteur();
ok(J(s1.m.kv) === J([25, 125, 0, 1]) && s1.mon === s0.mon && mDebut === 0,
  `re-tirer au-delà : arrêté au début de la source (début 25, entrée 0) ; à T la même image ; à 25, l'image 0 (${J(s1.m.kv)} ${mDebut})`);
await annuler(); await annuler(); await annuler();
ok(J(await model()) === J(s0.m), 're-tirer : trois Ctrl+Z rendent le plan d’origine');

// 7. l'image fixe : début +10, sans borne de source ; rien d'autre ne bouge
await tirer('ki', 'l', 10);
m = await model();
ok(J(m.ki) === J([50, 110, 0, 1]) && J(m.kv) === J(s0.m.kv) && J(m.kn) === J(s0.m.kn), `image fixe, début +10 : début 50, durée 110 ; rien d'autre ne bouge (${J(m.ki)})`);
await tirer('ki', 'l', -150);
m = await model();
ok(J(m.ki) === J([0, 160, 0, 1]), `image fixe : re-tirée sans borne de source, jusqu'au début de la timeline (rien d'autre en V1) (${J(m.ki)})`);
await annuler(); await annuler();

// 8. B, N, R au début de kv (ce que fait chacun, comme Premiere)
await outil('b');
await tirer('kv', 'l', 20);
s1 = await etat(T);
ok(J(s1.m.kv) === J([50, 80, 1.8, 1]) && s1.m.kn[0] === 155 && s1.mon === 115,
  `B (propagation) : la tête garde sa place, la matière avance (entrée 1,8 s), la suite de la piste recule de 20 ; à T, l'image 115 (${J(s1.m.kv)} ${s1.m.kn[0]} ${s1.mon})`);
await annuler();
await outil('n');
await tirer('kv', 'l', 20);
s1 = await etat(T);
ok(J(s1.m.kv) === J([70, 80, 1.8, 1]) && s1.mon === s0.mon, `N sans voisin collé : rogne comme V (${J(s1.m.kv)} ${s1.mon})`);
await annuler();
await outil('r');
await tirer('kv', 'l', 20);
s1 = await etat(T);
ok(J(s1.m.kv) === J([70, 80, 1, 1.25]), `R (vitesse) : la même matière en 80 images, à 125 % (${J(s1.m.kv)})`);
await annuler();
await outil('v');
ok(J(await model()) === J(s0.m), 'B, N, R : Ctrl+Z rend tout');
await page.screenshot({ path: `${out}/poignees-sombre.png` });

// 9. une vitesse de ×1,5 (vidéo avec son et son seul, même entrée, même vitesse)
await open(await sequence('poignées ×1,5', { kv: { dur: 66, speed: 1.5 }, ka: { dur: 66, speed: 1.5 } }));
const v0 = await etat(100);
await tirer('kv', 'l', 12);
await tirer('ka', 'l', 12);
const v1 = await etat(100);
ok(J(v1.m.kv) === J([62, 54, 1.72, 1.5]) && J(v1.m.ka) === J([62, 54, 1.72, 1.5]), `×1,5, début +12 : entrée + 12/25 × 1,5 = 1,72 s (${J(v1.m.kv)} ${J(v1.m.ka)})`);
ok(v1.mon === v0.mon && J(v1.sons) === J(v0.sons), `×1,5 : à T, la même image (${v0.mon} → ${v1.mon}) et le même son (${J(v1.sons)})`);
const o3 = memeOnde(v0.onde, v1.onde);
ok(o3.n >= 5 && !o3.diff && Math.abs(v1.bande - v0.bande) < 0.05, `×1,5 : l'onde (${o3.n} attaques au même x : ${J(o3.A.slice(0, 4))} / ${J(o3.B.slice(0, 4))}) et les vignettes ne bougent pas`);

// ── 2. clair : le premier cas ──────────────────────────────
await open(await sequence('poignées clair'), 'light');
const c0 = await etat(T);
await tirer('kv', 'l', 20);
const c1 = await etat(T);
ok(J(c1.m.kv) === J([70, 80, 1.8, 1]) && c1.mon === c0.mon && J(c1.sons) === J(c0.sons), `clair : V, début +20, à T la même image et le même son (${c1.mon})`);
ok(await page.evaluate(() => document.documentElement.dataset.theme === 'light'), 'clair : le thème clair est posé');
await page.screenshot({ path: `${out}/poignees-clair.png` });
ok(await page.$$eval('.tb.go', (l) => l.filter((b) => b.offsetParent).length) <= 1, 'un seul bouton orange à l’écran');

ok(!errs.length, `aucune erreur de console (${J(errs.slice(0, 4))})`);
await browser.close();
writeFileSync(`${out}/pilote_poignees.log`, log.join('\n') + '\n');
console.log(`\n${log.length - fails} passés, ${fails} en échec`);
process.exit(fails ? 1 : 0);
