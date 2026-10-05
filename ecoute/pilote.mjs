// Le pilote du lien d'écoute (Chromium sans affichage, Playwright) : la liste de contrôle du README d'AGOSTA (§ 9),
// menée sur un paquet de server/tools/ecoute.py — ou sur le site AGOSTA lui-même, qui a les mêmes identifiants : la
// comparaison du premier essai (05/10). Bureau, iPhone et Android émulés (la taille, l'agent, le toucher : c'est
// Chromium, pas Safari), dans les deux thèmes ; une capture de chaque.
//
//   node ecoute/pilote.mjs --dossier <paquet extrait d'un .zip> --captures /tmp/sr_ecoute/captures
//   node ecoute/pilote.mjs --url http://127.0.0.1:18808/ --captures …      (un lecteur déjà servi : AGOSTA, le Worker)
//   options : --profils bureau,iphone,android  --themes dark,light
//
// Ce qui se vérifie sans téléphone : lancer un morceau ; la Media Session (pochette lue, titre, artiste, album, les
// boutons branchés) ; pause, lecture, suivant par ses gestionnaires (ceux qu'appelle l'écran verrouillé) ; la page
// derrière une autre, la lecture continue ; l'interface synchronisée au retour ; la fin d'un morceau (le suivant part
// seul, le blanc mesuré ; en continu, sans changer de fichier) ; les paroles (la ligne active suit, centrée ; toucher
// une ligne y saute ; le plein écran) ; la barre de progression ; le volume, le muet, le clavier ; recharger (le
// morceau et la position, sans démarrer) ; #3 ; « Télécharger » ; l'accent et le thème ; le manifeste, le service
// worker ; aucune erreur console. Ce qui ne se vérifie pas ici : l'écran verrouillé lui-même, la lecture écran éteint,
// les boutons du système, Safari. Rend 0 si tout passe.
import { createRequire } from 'module';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
// Playwright : celui du conteneur cloud, sinon celui de DGX2 (chanson/pilote.mjs)
const où = ['/opt/node22/lib/node_modules/playwright/package.json', '/home/dgx/Character_Sheet/package.json'].find((p) => existsSync(p));
const { chromium, devices } = createRequire(où)(où.includes('Character_Sheet') ? 'playwright' : '/opt/node22/lib/node_modules/playwright');
const OUT = args.captures || '/tmp/ecoute_pilote';
mkdirSync(OUT, { recursive: true });

// un serveur statique avec plages (Range → 206), comme un hébergement réel
let url = args.url;
let serveur = null;
if (!url) {
  const racine = normalize(args.dossier || '.');
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.lrc': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
  serveur = createServer((req, res) => {
    const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = normalize(join(racine, chemin.endsWith('/') ? chemin + 'index.html' : chemin));
    if (!f.startsWith(racine) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404).end(); return; }
    const taille = statSync(f).size;
    const h = { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (!m) { res.writeHead(200, { ...h, 'content-length': taille }); createReadStream(f).pipe(res); return; }
    const debut = m[1] ? +m[1] : taille - +m[2];
    const fin = m[1] && m[2] ? Math.min(+m[2], taille - 1) : taille - 1;
    if (debut >= taille) { res.writeHead(416, { 'content-range': `bytes */${taille}` }).end(); return; }
    res.writeHead(206, { ...h, 'content-range': `bytes ${debut}-${fin}/${taille}`, 'content-length': fin - debut + 1 });
    createReadStream(f, { start: debut, end: fin }).pipe(res);
  });
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${serveur.address().port}/`;
}

const parseLrc = (raw) => {
  const tag = /\[(\d{1,2}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
  const out = [];
  for (const row of raw.replace(/^﻿/, '').split(/\r?\n/)) {
    const ts = [];
    let m;
    tag.lastIndex = 0;
    while ((m = tag.exec(row))) ts.push(parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.')));
    const text = row.replace(tag, '').replace(/\*\*/g, '').replace(/__/g, '').trim();
    for (const t of ts) out.push({ t, text });
  }
  return out.sort((a, b) => a.t - b.t);
};

let echecs = 0;
async function passe(profil, theme) {
  const log = (c, m) => { if (!c) echecs += 1; console.log(`${c ? 'ok    ' : 'ÉCHEC '} [${profil} ${theme}] ${m}`); };
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const dev = profil === 'iphone' ? devices['iPhone 13'] : profil === 'android' ? devices['Pixel 7'] : { viewport: { width: 1280, height: 860 } };
  const { defaultBrowserType, ...opts } = dev;   // eslint-disable-line no-unused-vars
  const context = await browser.newContext({ ...opts, colorScheme: theme });
  await context.addInitScript(() => {
    window.__ms = {};
    if (navigator.mediaSession) {
      const orig = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
      navigator.mediaSession.setActionHandler = (a, h) => { window.__ms[a] = h; return orig(a, h); };
    }
    window.__ev = [];
    window.__src = new Set();
    document.addEventListener('DOMContentLoaded', () => {
      const a = document.getElementById('audio-player');
      for (const e of ['ended', 'playing']) a.addEventListener(e, () => window.__ev.push([e, performance.now()]));
      a.addEventListener('loadstart', () => window.__src.add(a.currentSrc));
    });
  });
  const page = await context.newPage();
  const mobile = profil !== 'bureau';
  const erreurs = [];
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
  page.on('pageerror', (e) => erreurs.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400) erreurs.push(`HTTP ${r.status()} ${r.url()}`); });
  const A = (fn, arg) => page.evaluate(fn, arg);
  const tape = (sel) => (mobile ? page.tap(sel) : page.click(sel));
  const etat = () => A(() => {
    const a = document.getElementById('audio-player');
    return { paused: a.paused, t: a.currentTime, d: a.duration, titre: document.getElementById('np-title').textContent,
      joue: document.getElementById('btn-play').classList.contains('is-playing'),
      courant: [...document.querySelectorAll('#tracklist li')].findIndex((l) => l.classList.contains('current')), sources: window.__src.size };
  });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#tracklist li');
  await page.waitForTimeout(800);
  // les données : playlist.json (le lien d'écoute) ou album-data.js (AGOSTA)
  const d = await A(async () => window.ALBUM_DATA || (await fetch('./playlist.json')).json());
  const notre = !!d.v;
  const T = d.tracks;
  const continu = d.playbackMode === 'continuous';
  const n = T.length;
  const k = Math.max(0, Math.min(n - 3, Math.floor(n / 2)));   // un morceau du milieu, suivi de deux autres
  const titres = await A(() => [...document.querySelectorAll('#tracklist .track-title')].map((e) => e.textContent));
  log(titres.length === n && n >= 3, `${n} morceaux listés (${continu ? 'un fichier continu' : 'un fichier par morceau'})`);
  await page.screenshot({ path: `${OUT}/${profil}-${theme}-accueil.png` });

  // lancer un morceau
  await tape(`#tracklist li:nth-child(${k + 1}) button`);
  await page.waitForTimeout(1500);
  let s = await etat();
  log(!s.paused && s.titre === T[k].title && s.joue && s.courant === k, `lancer un morceau : il joue, l'interface suit (${s.titre})`);
  // la Media Session
  const ms = await A(async () => {
    const m = navigator.mediaSession.metadata;
    const lus = m ? await Promise.all(m.artwork.map((x) => fetch(x.src).then((r) => r.status).catch(() => 0))) : [];
    return { title: m && m.title, artist: m && m.artist, album: m && m.album, lus, handlers: Object.keys(window.__ms) };
  });
  log(ms.title === T[k].title && ms.artist === (d.artist || '') && ms.album === d.title && ms.lus.length >= (d.cover ? 1 : 0) && ms.lus.every((x) => x === 200),
    `écran verrouillé : titre, artiste, album, pochette lue (${ms.title} / ${ms.artist} / ${ms.album} / ${ms.lus})`);
  log(['play', 'pause', 'nexttrack', 'previoustrack', 'seekto'].every((h) => ms.handlers.includes(h)), 'les boutons de l’écran verrouillé sont branchés');
  // la page derrière une autre : la lecture continue ; pause, lecture, suivant par l'écran verrouillé
  const autre = await context.newPage();
  await autre.bringToFront();
  const t0 = (await etat()).t;
  await autre.waitForTimeout(2000);
  s = await etat();
  log(!s.paused && s.t > t0 + 1.2, `une autre page devant : la lecture continue (${t0.toFixed(1)} → ${s.t.toFixed(1)} s)`);
  await A(() => window.__ms.pause());
  await page.waitForTimeout(300);
  const pz = await etat();
  await A(() => window.__ms.play());
  await page.waitForTimeout(600);
  const pl = await etat();
  log(pz.paused && !pz.joue && !pl.paused && pl.joue, 'pause puis lecture depuis l’écran verrouillé');
  await A(() => window.__ms.nexttrack());
  await page.waitForTimeout(1200);
  s = await etat();
  const msn = await A(() => navigator.mediaSession.metadata.title);
  log(!s.paused && s.titre === T[k + 1].title && s.courant === k + 1 && msn === T[k + 1].title, `suivant depuis l'écran verrouillé, l'écran suit (${s.titre})`);
  await page.bringToFront();
  await autre.close();
  await page.waitForTimeout(400);
  const ui = await A(() => document.getElementById('time-current').textContent);
  s = await etat();
  const rel = continu ? s.t - T[k + 1].start : s.t;
  log(Math.abs(ui.split(':').reduce((a, b) => a * 60 + +b, 0) - rel) < 1.6, `revenir : l'interface est synchronisée (${ui} ≈ ${rel.toFixed(1)} s)`);
  // la fin d'un morceau : le suivant part seul
  const fin = continu ? T[k + 1].end : null;
  await A((f) => { window.__ev.length = 0; const a = document.getElementById('audio-player'); a.currentTime = (f ?? a.duration) - 1.2; }, fin);
  await page.waitForTimeout(3500);
  s = await etat();
  const ev = await A(() => window.__ev);
  const e1 = ev.find((e) => e[0] === 'ended');
  const e2 = e1 && ev.find((e) => e[0] === 'playing' && e[1] > e1[1]);
  log(!s.paused && s.titre === T[k + 2 < n ? k + 2 : 0].title && (!continu || s.sources === 1),
    `la fin d'un morceau : le suivant part seul (${s.titre}${continu ? ', sans changer de fichier' : `, blanc ${e1 && e2 ? Math.round(e2[1] - e1[1]) : '?'} ms`})`);
  // les paroles
  const j = T.findIndex((t) => t.lyricsFile);
  if (j >= 0) {
    await A((i) => document.querySelectorAll('#tracklist li button')[i].click(), j);
    await page.waitForTimeout(800);
    const lrc = parseLrc(await A((u) => fetch(u).then((r) => r.text()), T[j].lyricsFile));
    await tape('#sheet-handle');
    await page.waitForTimeout(700);
    const hb = await page.locator('#sheet-handle').boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2, hb.y - 500, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(900);
    const vers = lrc.find((l) => l.t > 20 && l.text) || lrc[Math.min(2, lrc.length - 1)];
    const base = continu ? T[j].start : 0;
    await A((t) => { document.getElementById('audio-player').currentTime = t; }, base + vers.t + 0.4);
    await page.waitForTimeout(2600);
    const par = await A(() => {
      const box = document.getElementById('lyrics-box');
      const act = box.querySelector('.lyric-line.active');
      const rb = box.getBoundingClientRect(), ra = act ? act.getBoundingClientRect() : rb;
      return { text: act && act.textContent, centre: Math.round(ra.top + ra.height / 2 - (rb.top + rb.height / 2)), t: document.getElementById('audio-player').currentTime };
    });
    const pos = par.t - base;
    const att = [...lrc].reverse().find((l) => l.t <= pos + 0.15) || lrc[0];
    log(par.text === (att.text || ' ') && Math.abs(par.centre) <= 24, `les paroles : la ligne active suit, centrée (${par.text} | ${par.centre} px)`);
    const cible = lrc.find((l) => l.t > pos + 15 && l.text);
    if (cible) {
      await page.locator('#lyrics-box .lyric-line').nth(lrc.indexOf(cible)).click();
      await page.waitForTimeout(800);
      log(Math.abs((await etat()).t - base - cible.t) < 1.5, `toucher une ligne y saute (${cible.text})`);
    }
    await page.screenshot({ path: `${OUT}/${profil}-${theme}-paroles.png` });
    if (notre) {
      await tape('#lyrics-full');
      await page.waitForTimeout(700);
      const pe = await A(() => ({ e: document.getElementById('player-sheet').dataset.state, h: document.getElementById('player-sheet').getBoundingClientRect().height, vh: innerHeight }));
      log(pe.e === 'full' && Math.abs(pe.h - pe.vh) < 4, 'les paroles en plein écran');
      await page.screenshot({ path: `${OUT}/${profil}-${theme}-pleinecran.png` });
      await tape('#lyrics-full');
      await page.waitForTimeout(500);
    }
    for (let i = 0; i < 2 && (await A(() => document.getElementById('player-sheet').dataset.state)) !== 'collapsed'; i++) {
      await tape('#mini-cover-btn');
      await page.waitForTimeout(600);
    }
  }
  // la barre de progression, relative au morceau
  const pb = await page.locator('#progress').boundingBox();
  await page.mouse.click(pb.x + pb.width * 0.5, pb.y + pb.height / 2);
  await page.waitForTimeout(500);
  s = await etat();
  const ic = s.courant;
  const f = continu ? (s.t - T[ic].start) / (T[ic].end - T[ic].start) : s.t / s.d;
  log(Math.abs(f - 0.5) < 0.03, `la barre de progression : un clic au milieu du morceau (${f.toFixed(3)})`);
  if (!mobile) {
    await page.locator('#volume').fill('0.3');
    const vol = await A(() => document.getElementById('audio-player').volume);
    await page.click('#btn-mute');
    const mu = await A(() => document.getElementById('audio-player').muted);
    await page.click('#btn-mute');
    log(Math.abs(vol - 0.3) < 0.01 && mu && !(await A(() => document.getElementById('audio-player').muted)), 'le volume et le muet');
    await page.focus('#progress');
    const av = (await etat()).t;
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    const ap = (await etat()).t;
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    const sp = (await etat()).paused;
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    await page.focus('#btn-prev');
    await page.keyboard.press('Tab');
    const fj = await A(() => document.activeElement.id);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const en = (await etat()).paused;
    await page.keyboard.press('Enter');
    log(ap - av > 4 && ap - av < 6.5 && sp && fj === 'btn-play' && en, `le clavier : → +5 s, Espace, Tab jusqu'à lecture, Entrée`);
  }
  // recharger
  await A(() => { const a = document.getElementById('audio-player'); a.currentTime += 3; a.pause(); });
  await page.waitForTimeout(400);
  const avR = await etat();
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#tracklist li.current');
  await page.waitForTimeout(1200);
  s = await etat();
  log(s.paused && s.titre === avR.titre && Math.abs(s.t - avR.t) < 1.5, `recharger : le morceau et la position, sans démarrer (${s.titre} ${s.t.toFixed(1)} s)`);
  if (notre) {
    const css = await A(() => ({ acc: getComputedStyle(document.documentElement).getPropertyValue('--acc').trim(), th: document.documentElement.dataset.theme }));
    log(css.th === theme && (!d.accent || css.acc.toLowerCase() === d.accent[theme]), `le thème du système et l'accent de la pochette (${css.th} ${css.acc})`);
    log((await A(() => document.getElementById('download').hidden)) === (d.download !== true), `« Télécharger » seulement si permis (${d.download})`);
    const p2 = await context.newPage();
    await p2.goto(url + '#3', { waitUntil: 'load' });
    await p2.waitForSelector('#tracklist li.current');
    await p2.waitForTimeout(700);
    const dir = await p2.evaluate(() => ({ titre: document.getElementById('np-title').textContent, t: document.getElementById('audio-player').currentTime }));
    log(dir.titre === T[2].title && Math.abs(dir.t - (continu ? T[2].start : 0)) < 0.5, `#3 : le 3e morceau, au début (${dir.titre})`);
    await p2.close();
  }
  const cdp = await context.newCDPSession(page);
  const man = await cdp.send('Page.getAppManifest').catch(() => ({ errors: ['illisible'] }));
  const sw = await A(async () => { const r = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); return !!(r && r.active); });
  log((man.errors || []).length === 0 && sw, 'le manifeste se lit sans erreur, le service worker est actif');
  log(erreurs.length === 0, `aucune erreur console ni requête en échec (${[...new Set(erreurs)].slice(0, 3)})`);
  await browser.close();
}

for (const profil of (args.profils || 'bureau,iphone,android').split(',')) {
  for (const theme of (args.themes || 'dark,light').split(',')) await passe(profil, theme);
}
if (serveur) serveur.close();
console.log(echecs ? `\n${echecs} en échec` : '\ntout passe');
process.exit(echecs ? 1 : 0);
