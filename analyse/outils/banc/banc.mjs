#!/usr/bin/env node
// Le banc d'essai du Studio : les pages d'analyse ouvertes dans Chrome headless (CDP), rejouées comme par l'utilisateur,
// et contrôlées. À relancer après chaque changement de skill/voix.js, son.js, studio.mjs, casting-parts.mjs.
//
//   node outils/banc/banc.mjs [getaround wall …] [--etat <film>=<fichier.json>] [--photos <dossier>] [--base <url>]
//
// Le dépôt partagé (Cloudflare, et l'ancien de dgx1) est INTERCEPTÉ (Fetch.enable) : rien n'y est lu ni écrit. Par défaut il est vide ;
// --etat getaround=partage.json le remplit (ex. une copie du vrai : curl …/corrections/getaround.json).
// Les pages sont servies depuis le dépôt (skill/serve.mjs, port 8811) ; dans le portail, où elles chargent le thème et
// l'en-tête communs (../../../commun/), --base http://127.0.0.1:8795/analyse les prend au portail qui tourne.
// CHROME=<chemin> : le navigateur. PLAYWRIGHT=<package.json> : le Chromium lancé par playwright, ouvert aussi en CDP
// (sur DGX2 : PLAYWRIGHT=/home/dgx/Character_Sheet/package.json — le même binaire lancé à la main n'y charge aucune
// page http, playwright sait le lancer). Code de sortie 1 au moindre échec.
//
// Ce qui est vérifié :
//   timeline   chaque instant de voix dessiné sur une seule piste, la courbe sous chaque réplique sur sa piste
//              (verif.js) ; 30 glisser-déposer au hasard, puis tout annuler = l'état de départ ; « Tout remettre »
//   stabilite  la timeline ne bouge pas d'un pixel quand le sous-titre change (tout le film, pas de 0,25 s)
//   lecture    pendant la lecture le script ne remonte jamais ; l'action est sous la vidéo, colonnes de même hauteur
//   son        chaque version (son.json) se joue, calée sur l'image (< 80 ms) ; fond coupé ; retour au son natif
//   partage    un geste part au dépôt partagé et la mémoire du navigateur se vide ; une vieille mémoire est signalée
//              et « Les oublier » rend les corrections partagées
//   video      la vidéo vient de R2 (GET /video/…, le vrai service : seules ses routes de corrections sont interceptées),
//              on y saute, elle se lit, la forme d'onde se dessine, aucun message « vidéo manquante »
//   repli      R2 en panne (ses requêtes échouent) : la vidéo et les pistes de son viennent d'à côté de la page, sans message
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url)), RACINE = join(ICI, '..', '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i < 0 ? null : args.splice(i, 2)[1]; };
const etats = {};
for (let e; (e = opt('--etat'));) { const [f, p] = e.split('='); etats[f] = readFileSync(p, 'utf8'); }
const PHOTOS = opt('--photos');
const BASE = opt('--base');
const films = args.length ? args : ['getaround', 'wall'];
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VERIF = readFileSync(join(ICI, 'verif.js'), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// d'où viennent les pages : le portail (--base), sinon le petit serveur du dépôt
const ORIGINE = BASE ? BASE.replace(/\/$/, '') : 'http://127.0.0.1:8811';

// le serveur des pages
let serveur = null;
if (!BASE) { try { await fetch('http://127.0.0.1:8811/'); } catch { serveur = spawn(process.execPath, [join(RACINE, 'chaine', 'serve.mjs'), RACINE, '8811'], { stdio: 'ignore' }); await wait(800); } }

const SERVICE = 'https://movie-analysis-partage.luxigone.workers.dev';
async function navigateur(film, { panneR2 = false } = {}) {
  const port = 9400 + Math.floor(Math.random() * 400);
  let ch = null, pw = null;
  if (process.env.PLAYWRIGHT) {
    const { chromium } = createRequire(process.env.PLAYWRIGHT)('playwright');
    pw = await chromium.launch({ args: [`--remote-debugging-port=${port}`, '--remote-allow-origins=*', '--autoplay-policy=no-user-gesture-required'] });
    await (await pw.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
  } else {
    ch = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(tmpdir(), 'banc-studio-' + Date.now())}`,
      '--window-size=1600,1100', '--force-device-scale-factor=1', '--autoplay-policy=no-user-gesture-required',
      // CHROME_ARGS : ce que la machine demande en plus (ex. --no-sandbox)
      ...(process.env.CHROME_ARGS || '').split(' ').filter(Boolean), 'about:blank'], { stdio: 'ignore' });
  }
  let tabs; for (let i = 0; i < 60; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await wait(200); } }
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0, depot = etats[film] || '{}';
  const pend = {}, exceptions = [], puts = [];
  const send = (method, params = {}) => new Promise((r) => { pend[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
    if (d.method === 'Runtime.exceptionThrown') exceptions.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Fetch.requestPaused') {
      const rq = d.params.request;
      if (rq.url.startsWith(SERVICE + '/video/')) { send('Fetch.failRequest', { requestId: d.params.requestId, errorReason: 'ConnectionRefused' }); return; }
      let corps = depot;
      if (rq.method === 'PUT') { depot = rq.postData || depot; puts.push(depot); corps = '{"ok":true}'; }
      if (rq.method === 'OPTIONS') corps = '';
      send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200, body: Buffer.from(corps).toString('base64'),
        responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' },
          { name: 'access-control-allow-methods', value: 'GET,PUT,OPTIONS' }, { name: 'access-control-allow-headers', value: '*' }] });
    }
  };
  await send('Runtime.enable'); await send('Page.enable');
  // le dépôt partagé (Cloudflare, et l'ancien de dgx1) est intercepté : le banc n'y écrit jamais. Les vidéos (R2) passent,
  // sauf pour le scénario « repli », où elles échouent.
  await send('Fetch.enable', { patterns: ['/corrections/*', '/publier/*', '/historique/*', '/verifier*'].concat(panneR2 ? ['/video/*'] : [])
    .map((p) => ({ urlPattern: SERVICE + p })).concat([{ urlPattern: 'https://dgx1.tail6c4306.ts.net/*' }]) });
  const api = {
    exceptions, puts, depot: () => depot,
    async ouvre() { await send('Page.navigate', { url: `${ORIGINE}/analyses/${film}/` }); await wait(4500); await api.ev(VERIF + ';window.confirm=()=>true;'); },
    async ev(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'évaluation'); return r.result.result.value; },
    async glisse(x0, y0, x1, y1) {
      const souris = (type, x, y, b) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: b, clickCount: 1 });
      await souris('mouseMoved', x0, y0, 0); await souris('mousePressed', x0, y0, 1);
      for (let k = 1; k <= 8; k++) { await souris('mouseMoved', x0 + (x1 - x0) * k / 8, y0 + (y1 - y0) * k / 8, 1); await wait(30); }
      await souris('mouseReleased', x1, y1, 0); await wait(900);
    },
    async photo(nom) {
      if (!PHOTOS) return;
      mkdirSync(PHOTOS, { recursive: true });
      const r = await api.ev(`(()=>{const e=document.querySelector('.vx-corps');e.parentElement.scrollIntoView({block:'start'});const b=e.getBoundingClientRect();return {x:b.left,y:b.top+scrollY,w:b.width,h:b.height}})()`);
      const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 }, captureBeyondViewport: true });
      writeFileSync(join(PHOTOS, `${film}-${nom}.png`), Buffer.from(s.result.data, 'base64'));
    },
    ferme() { try { ws.close(); } catch {} if (pw) pw.close().catch(() => {}); else ch.kill(); },
  };
  return api;
}

// la vidéo telle que la page la lit : d'où elle vient, un saut, une seconde et demie de lecture, la forme d'onde
const MESURE_VIDEO = `(async () => {
  const dort = (ms) => new Promise((r) => setTimeout(r, ms));
  const attend = (ev, ms) => new Promise((r) => { const f = () => { video.removeEventListener(ev, f); r(true); }; video.addEventListener(ev, f); setTimeout(() => r(false), ms); });
  if (video.readyState < 1) await attend('loadedmetadata', 10000);
  const cible = Math.round(D * 0.7 * 100) / 100, saute = attend('seeked', 10000);
  video.currentTime = cible;
  const sautOk = await saute, apresSaut = Math.round(video.currentTime * 100) / 100;
  video.muted = true; await video.play().catch(() => {}); await dort(1500);
  const avance = Math.round((video.currentTime - apresSaut) * 100) / 100; video.pause();
  for (let i = 0; i < 40 && VX_ONDE.etat === 'charge'; i++) await dort(250);
  return { r2: window.XV_MEDIA, src: video.currentSrc, pret: video.readyState, sautOk, cible, apresSaut, avance, onde: VX_ONDE.etat,
    message: !document.getElementById('nofile').hidden, erreur: video.error ? video.error.code : 0 };
})()`;
const fautesLecture = (r) => [
  r.erreur && `erreur de lecture ${r.erreur}`, r.message && 'message « vidéo manquante » affiché',
  (!r.sautOk || Math.abs(r.apresSaut - r.cible) > 0.3) && `le saut à ${r.cible} s arrive à ${r.apresSaut} s`,
  !(r.avance > 0.8) && `la lecture n'avance pas (${r.avance} s en 1,5 s)`, r.onde !== 'pret' && `forme d'onde : ${r.onde}`,
].filter(Boolean);

const SCENARIOS = {
  async timeline(api) {
    await api.ouvre();
    const fautes = [];
    const depart = await api.ev('__lignes()');
    const v0 = await api.ev('__verif()'); if (v0.length) fautes.push('départ : ' + v0[0]);
    await api.photo('depart');
    let graine = 7; const hasard = (n) => { graine = (graine * 16807) % 2147483647; return graine % n; };
    let faits = 0;
    for (let k = 0; k < 30; k++) {
      const o0 = await api.ev(`(()=>{const L=[...new Set(VX.boites.map(b=>b.g.l.text))];const P=VX.pistes.filter(r=>r.cible).map(r=>r.cle);return {L,P}})()`);
      const txt = o0.L[hasard(o0.L.length)].slice(0, 14), piste = o0.P[hasard(o0.P.length)];
      const o = await api.ev(`__ou(${JSON.stringify(txt)}, ${JSON.stringify(piste)})`);
      if (!o.ligne || !o.piste || o.ligne.piste === piste || o.piste.y > 990 || o.ligne.y > 990) continue;
      await api.glisse(o.ligne.x, o.ligne.y, o.ligne.x + 3, o.piste.y); faits++;
      const v = await api.ev('__verif()'); if (v.length) fautes.push(`après « ${txt} » → ${piste} : ${v[0]}`);
    }
    // la pile commune du portail (commun/undo.js, branchée par film/film.js), ou le repli de la page ouverte seule
    const peutAnnuler = 'xvPeutAnnuler()';
    for (let k = 0; k < 80 && (await api.ev(peutAnnuler)); k++) { await api.ev('xvAnnule()'); await wait(100); }
    if (JSON.stringify(await api.ev('__lignes()')) !== JSON.stringify(depart)) fautes.push('tout annuler ne revient pas au départ');
    await api.ev('xvRemetTout()'); await wait(1200);
    const v1 = await api.ev('__verif()'); if (v1.length) fautes.push('après Tout remettre : ' + v1[0]);
    return { ok: !fautes.length, detail: `${faits} gestes` + (fautes.length ? ' — ' + fautes.slice(0, 3).join(' | ') : '') };
  },
  async stabilite(api) {
    await api.ouvre();
    const r = await api.ev(`(()=>{const tl=document.getElementById('tl'),st=document.getElementById('st'),pos=new Set();let deb=0;
      for(let t=0;t<D;t+=0.25){video.currentTime=t;majSousTitre(t);pos.add(Math.round(tl.getBoundingClientRect().top+scrollY));if(st.scrollHeight>st.clientHeight+1)deb++}
      return {pos:[...pos],deb}})()`);
    return { ok: r.pos.length === 1 && !r.deb, detail: `timeline à ${r.pos.join(', ')} px, ${r.deb} sous-titre(s) qui débordent` };
  },
  async lecture(api) {
    // pendant la lecture, le script ne remonte jamais (il remontait vers l'en-tête du plan à chaque silence) ; la
    // colonne du script fait la hauteur de la colonne vidéo, l'action est sous la vidéo (28/09)
    await api.ouvre();
    await api.ev(`window.__pos=[]; video.muted=true; video.currentTime=0; video.play(); window.__t=setInterval(()=>__pos.push(document.getElementById('script').scrollTop),100)`);
    await wait(15000);
    const r = await api.ev(`(clearInterval(__t), video.pause(), (()=>{let rem=0;for(let i=1;i<__pos.length;i++) if(__pos[i]-__pos[i-1]<-2) rem++;
      const p=document.querySelector('.player').getBoundingClientRect(), s=document.querySelector('.script').getBoundingClientRect();
      return {rem, n:__pos.length, dansScript: !!document.querySelector('.player #actionnow'), ecart: Math.round(Math.abs(p.height-s.height))}})())`);
    const ok = !r.rem && r.dansScript && r.ecart <= 2;
    return { ok, detail: `${r.rem} remontée(s) du script sur ${r.n} relevés ; action ${r.dansScript ? 'sous la vidéo' : 'PAS sous la vidéo'} ; colonnes à ${r.ecart} px près` };
  },
  async son(api) {
    await api.ouvre();
    const versions = await api.ev(`(typeof SON !== 'undefined' && SON) ? SON.versions.map(v=>v.id) : []`);
    if (!versions.length) return { ok: true, detail: 'pas de son.json : rien à jouer' };
    const fautes = [], vus = [];
    await api.ev(`video.currentTime = 5; video.play()`); await wait(600);
    for (const v of versions.filter((x) => x !== 'vo').concat(['vo'])) {
      await api.ev(`xvSon.auChoisit(${JSON.stringify(v)})`); await wait(2000);
      const m = await api.ev(`({muet: video.muted, sources: xvSon.AU.src.length, derive: xvSon.AU.joue ? Math.round((xvSon.auPosition()-video.currentTime)*1000) : null, st: document.getElementById('st').textContent.length})`);
      if (v === 'vo') { if (m.muet || m.sources) fautes.push('VO entière : le son natif devrait jouer'); }
      else { if (!m.sources) fautes.push(`${v} : aucune piste ne joue`); if (Math.abs(m.derive) > 80) fautes.push(`${v} : ${m.derive} ms d'écart avec l'image`); }
      vus.push(v + (m.derive !== null ? ` ${m.derive} ms` : ' natif'));
    }
    await api.ev(`[...document.querySelectorAll('#vx-son button')].find(b=>/Fond/.test(b.textContent)).click()`); await wait(1200);
    const f = await api.ev(`({muet: video.muted, fond: xvSon.AU.gains.fond ? xvSon.AU.gains.fond.gain.value : null})`);
    if (!f.muet || f.fond !== 0) fautes.push('fond coupé : ' + JSON.stringify(f));
    await api.ev(`video.pause()`);
    // les pistes sont prises sur R2 quand la page le demande (XV_MEDIA)
    const pistes = await api.ev(`({r2: window.XV_MEDIA, l: performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/\\.m4a$/.test(n))})`);
    if (pistes.r2 && pistes.l.some((n) => !n.startsWith(pistes.r2))) fautes.push('piste hors de R2 : ' + pistes.l.find((n) => !n.startsWith(pistes.r2)));
    vus.push(`${pistes.l.length} pistes${pistes.r2 ? ' sur R2' : ''}`);
    return { ok: !fautes.length, detail: vus.join(' · ') + (fautes.length ? ' — ' + fautes.join(' | ') : '') };
  },
  async video(api) {
    await api.ouvre();
    const r = await api.ev(MESURE_VIDEO);
    const fautes = [];
    if (!r.r2) fautes.push('la page ne prend pas la vidéo sur R2 (XV_MEDIA vide : rendue sans --video-url)');
    else if (!r.src.startsWith(r.r2)) fautes.push('la vidéo ne vient pas de R2 : ' + r.src);
    fautes.push(...fautesLecture(r));
    return { ok: !fautes.length, detail: `${r.src.replace(SERVICE, '…')} · saut à ${r.cible} s → ${r.apresSaut} s · lu ${r.avance} s en 1,5 s · onde ${r.onde}` + (fautes.length ? ' — ' + fautes.join(' | ') : '') };
  },
  async repli(api) {
    await api.ouvre();
    const r = await api.ev(MESURE_VIDEO);
    const fautes = [];
    if (!r.src.startsWith(ORIGINE + '/')) fautes.push('R2 en panne, la vidéo ne vient pas d’à côté de la page : ' + r.src);
    fautes.push(...fautesLecture(r));
    let son = '';
    const versions = await api.ev(`(typeof SON !== 'undefined' && SON) ? SON.versions.map(v=>v.id).filter(v=>v!=='vo') : []`);
    if (versions.length) {
      await api.ev(`video.currentTime = 5; video.play()`); await wait(600);
      await api.ev(`xvSon.auChoisit(${JSON.stringify(versions[0])})`); await wait(2500);
      const s = await api.ev(`({sources: xvSon.AU.src.length, etat: document.getElementById('vx-son').textContent, l: performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/\\.m4a$/.test(n) && n.startsWith(location.origin))})`);
      await api.ev(`video.pause()`);
      if (!s.sources) fautes.push(`${versions[0]} : aucune piste ne joue (${s.etat})`);
      son = ` · ${versions[0]} : ${s.l.length} pistes d'à côté`;
    }
    return { ok: !fautes.length, detail: `${r.src.replace(ORIGINE, '')} · saut ${r.apresSaut} s · onde ${r.onde}${son}` + (fautes.length ? ' — ' + fautes.join(' | ') : '') };
  },
  async partage(api) {
    await api.ouvre();
    const fautes = [];
    const o = await api.ev(`(()=>{const b=VX.boites.find(q=>q.g.s>=0);const r=VX.pistes.find(x=>x.cible&&x.cle!==b.piste);return b&&r?__ou(b.g.l.text.slice(0,14),r.cle):null})()`);
    if (o && o.ligne && o.piste) {
      const avant = api.puts.length;
      await api.glisse(o.ligne.x, o.ligne.y, o.ligne.x + 3, o.piste.y); await wait(1200);
      if (api.puts.length === avant) fautes.push('le geste n’est pas parti au dépôt partagé');
      const mem = await api.ev(`JSON.parse(localStorage.getItem(window.XV_CLE)||'{}')`);
      if (Object.values(mem).some((x) => x && Object.keys(x).length)) fautes.push('la mémoire du navigateur garde ce qui est parti : ' + JSON.stringify(mem));
    }
    const id = await api.ev('DATA.cast[0].id');
    await api.ev(`localStorage.setItem(window.XV_CLE, JSON.stringify({noms:{${JSON.stringify(id)}:'Vieux nom du banc'}})); location.reload()`); await wait(4500);
    await api.ev(VERIF);
    const bandeau = await api.ev(`document.getElementById('vx-local').hidden ? '' : document.getElementById('vx-local').textContent`);
    if (!/pas dans le dépôt partagé/.test(bandeau)) fautes.push('vieille mémoire non signalée');
    await api.ev(`[...document.querySelectorAll('#vx-local button')].find(b=>/oublier/.test(b.textContent)).click()`); await wait(800);
    if ((await api.ev('DATA.cast[0].name')) === 'Vieux nom du banc') fautes.push('« Les oublier » garde le vieux nom');
    return { ok: !fautes.length, detail: fautes.join(' | ') || 'geste partagé, mémoire vidée, vieille mémoire signalée puis oubliée' };
  },
};

let echecs = 0;
for (const film of films) {
  if (!BASE && !existsSync(join(RACINE, 'analyses', film, 'index.html'))) { console.log(`${film} : pas de page`); echecs++; continue; }
  for (const [nom, sc] of Object.entries(SCENARIOS)) {
    const api = await navigateur(film, { panneR2: nom === 'repli' });
    let r;
    try { r = await sc(api); } catch (e) { r = { ok: false, detail: 'erreur : ' + e.message }; }
    if (api.exceptions.length) r = { ok: false, detail: r.detail + ' — exception : ' + api.exceptions[0].split('\n')[0] };
    api.ferme();
    if (!r.ok) echecs++;
    console.log(`${r.ok ? 'OK    ' : 'ÉCHEC '} ${film.padEnd(10)} ${nom.padEnd(10)} ${r.detail}`);
  }
}
if (serveur) serveur.kill();
console.log(echecs ? `${echecs} échec(s)` : 'tout passe');
process.exit(echecs ? 1 : 0);
