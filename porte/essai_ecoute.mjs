// Essai de la route du lien d'écoute du Worker (worker.js, ecoute()), SANS Cloudflare : le Worker tourne ici, dans
// Node, devant un faux bucket R2 en mémoire (les seules méthodes que le Worker appelle : head, get avec plage, put,
// et ce que rendent leurs objets : size, httpEtag, writeHttpMetadata, body, json). Rien n'est ouvert sur internet.
//
//   node porte/essai_ecoute.mjs                       les essais ; rend 0 si tout passe
//   node porte/essai_ecoute.mjs --servir 8817 --paquet <dossier du paquet> [--code 1234] [--fin <ISO>] [--jeton <32 hex>]
//                                                     le Worker sur http://127.0.0.1:8817/ecoute/<jeton>/, le bucket
//                                                     garni du paquet (celui d'un .zip de server/tools/ecoute.py) :
//                                                     pour l'essayer dans un navigateur (Playwright)

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import worker from './worker.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const PAGE = 'https://showrunner.luxigone.workers.dev';
const enc = new TextEncoder();

// ── le faux bucket R2 (https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) ──
const TYPES = { html: 'text/html; charset=utf-8', json: 'application/json', js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', mp3: 'audio/mpeg', lrc: 'text/plain; charset=utf-8', jpg: 'image/jpeg', png: 'image/png',
  webmanifest: 'application/manifest+json' };
function bucket() {
  const objets = new Map();   // clé → { octets, type, etag }
  const objet = (cle, o, octets) => ({
    key: cle, size: o.octets.length, httpEtag: o.etag,
    writeHttpMetadata(h) { if (o.type) h.set('content-type', o.type); },
    body: octets ? new ReadableStream({ start(c) { c.enqueue(octets); c.close(); } }) : undefined,
    async json() { return JSON.parse(new TextDecoder().decode(o.octets)); },
    async text() { return new TextDecoder().decode(o.octets); },
  });
  return {
    objets,
    async head(cle) { const o = objets.get(cle); return o ? objet(cle, o) : null; },
    async get(cle, opts = {}) {
      const o = objets.get(cle);
      if (!o) return null;
      const r = opts.range;
      const octets = r ? o.octets.subarray(r.offset, r.offset + r.length) : o.octets;
      return objet(cle, o, new Uint8Array(octets));
    },
    async put(cle, valeur, opts = {}) {
      const octets = typeof valeur === 'string' ? enc.encode(valeur) : new Uint8Array(valeur);
      const type = (opts.httpMetadata && opts.httpMetadata.contentType) || TYPES[cle.split('.').pop()] || '';
      objets.set(cle, { octets, type, etag: `"${createHash('md5').update(octets).digest('hex')}"` });
    },
    async delete(cle) { objets.delete(cle); },
  };
}

const limite = (n) => { const vus = new Map(); return { async limit({ key }) { const k = (vus.get(key) || 0) + 1; vus.set(key, k); return { success: k <= n }; } }; };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const sha = (s) => createHash('sha256').update(s).digest('hex');

function fiche(plus = {}) {
  return JSON.stringify({ v: 1, title: 'Été « 26 » <b>', artist: 'L’Artiste', ecoutes: true, code: null, fin: null,
    accent: { dark: '#7a9cff', dark_ink: '#0a0d0b', light: '#2d4fb0', light_ink: '#f6f7f5' }, ...plus });
}

async function garnis(b, jeton, f, fichiers) {
  await b.put(`ecoute/${jeton}/_lien.json`, f, { httpMetadata: { contentType: 'application/json' } });
  for (const [nom, contenu] of Object.entries(fichiers)) await b.put(`ecoute/${jeton}/${nom}`, contenu);
}

// ── le mode « servir » : le Worker devant un vrai paquet, pour un navigateur ──
if (args.servir) {
  const b = bucket();
  const jeton = args.jeton || randomBytes(16).toString('hex');
  const racine = args.paquet;
  const lis = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? lis(join(d, n)) : [join(d, n)]));
  const fichiers = {};
  for (const f of lis(racine)) if (!f.endsWith('LISEZMOI.txt')) fichiers[relative(racine, f).split('\\').join('/')] = readFileSync(f);
  const pl = JSON.parse(readFileSync(join(racine, 'playlist.json'), 'utf8'));
  let code = null;
  if (args.code) { const sel = randomBytes(8).toString('hex'); code = { sel, sha256: sha(`${sel}:${String(args.code).toUpperCase()}`) }; }
  await garnis(b, jeton, fiche({ title: pl.title, artist: pl.artist, accent: pl.accent || null, code, fin: args.fin || null }), fichiers);
  const env = { BIBLIO: b, PORTE_CLE: 'cle-essai-ecoute', PORTE_MODE: 'code', ESSAIS: limite(1000), LIMITE: limite(1000) };
  const port = Number(args.servir);
  createServer(async (req, res) => {
    const morceaux = [];
    for await (const m of req) morceaux.push(m);
    const corps = morceaux.length ? Buffer.concat(morceaux) : undefined;
    const h = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') h.set(k, v);
    // ce que le bord de Cloudflare poserait : l'origine publique est celle de ce serveur d'essai
    const r = await worker.fetch(new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: h, body: corps }), env, ctx);
    const out = {};
    r.headers.forEach((v, k) => { out[k] = v; });
    // le cookie « Secure » ne passe pas en http : pour l'essai local seulement, on l'ôte
    if (out['set-cookie']) out['set-cookie'] = out['set-cookie'].replace('; Secure', '');
    res.writeHead(r.status, out);
    res.end(r.body ? Buffer.from(await r.arrayBuffer()) : undefined);
  }).listen(port, '127.0.0.1', () => {
    console.log(`lien d'écoute d'essai : http://127.0.0.1:${port}/ecoute/${jeton}/  (${Object.keys(fichiers).length} fichiers, code ${args.code || 'aucun'})`);
  });
  // les écoutes rangées, à la demande : kill -USR2 <pid>
  process.on('SIGUSR2', () => console.log([...b.objets.keys()].filter((k) => k.includes('/_ecoutes/')).join('\n')));
} else {
  let passes = 0;
  const echecs = [];
  const ok = (c, m) => { if (c) passes += 1; else { echecs.push(m); console.log('  ÉCHEC', m); } };
  const b = bucket();
  const env = { BIBLIO: b, PORTE_CLE: 'cle-essai-ecoute\n', PORTE_MODE: 'code', ESSAIS: limite(3), LIMITE: limite(1000) };
  const W = async (chemin, { method = 'GET', headers = {}, body, e = env } = {}) => {
    const h = new Headers(headers);
    if (body !== undefined) h.set('content-length', String(enc.encode(body).length));
    const r = await worker.fetch(new Request(PAGE + chemin, { method, headers: h, body }), e, ctx);
    const t = Buffer.from(await r.arrayBuffer());
    return { s: r.status, t, x: t.toString('utf8'), h: r.headers };
  };
  const meme = { origin: PAGE, 'sec-fetch-site': 'same-origin' };
  const MP3 = randomBytes(5000);
  const paquet = { 'index.html': '<!doctype html><title>lecteur</title>', 'playlist.json': '{"title":"x"}', 'ecoute.css': ':root{}',
    'app.js': '//', 'audio/01-un.mp3': MP3, 'assets/icon-192.png': randomBytes(50), 'assets/cover-1200.jpg': randomBytes(80),
    'paroles/01-un.lrc': '[00:01.00] un' };
  const J1 = randomBytes(16).toString('hex');
  await garnis(b, J1, fiche(), paquet);
  await b.put(`ecoute/${J1}/_ecoutes/2026-10-05/1-aa-1`, '');

  console.log('  un lien ouvert :');
  let r = await W(`/ecoute/${J1}/`);
  ok(r.s === 200 && r.x.includes('<title>lecteur</title>') && r.h.get('content-type').startsWith('text/html')
    && r.h.get('cache-control') === 'no-cache' && r.h.get('x-robots-tag') === 'noindex' && r.h.get('referrer-policy') === 'same-origin',
  `la racine sert index.html, revalidé, ni indexé, le référent jamais ailleurs (${r.s} ${r.h.get('cache-control')})`);
  r = await W(`/ecoute/${J1}`);
  ok(r.s === 301 && r.h.get('location') === `/ecoute/${J1}/`, `sans la barre finale : 301 vers …/ (${r.s} ${r.h.get('location')})`);
  r = await W(`/ecoute/${J1}/audio/01-un.mp3?v=abc`);
  ok(r.s === 200 && r.t.equals(MP3) && r.h.get('accept-ranges') === 'bytes' && r.h.get('content-type') === 'audio/mpeg'
    && r.h.get('cache-control') === 'private, max-age=31536000, immutable', `un MP3 versionné : entier, gardé un an (${r.s} ${r.h.get('cache-control')})`);
  r = await W(`/ecoute/${J1}/audio/01-un.mp3`, { headers: { range: 'bytes=0-1' } });
  ok(r.s === 206 && r.t.equals(MP3.subarray(0, 2)) && r.h.get('content-range') === `bytes 0-1/${MP3.length}`,
    `la première question de Safari (bytes=0-1) : 206 (${r.s} ${r.h.get('content-range')})`);
  r = await W(`/ecoute/${J1}/audio/01-un.mp3`, { headers: { range: 'bytes=4000-' } });
  ok(r.s === 206 && r.t.equals(MP3.subarray(4000)) && r.h.get('content-length') === '1000', `une plage ouverte : 206, la fin (${r.s})`);
  r = await W(`/ecoute/${J1}/audio/01-un.mp3`, { headers: { range: 'bytes=9000-9100' } });
  ok(r.s === 416 && r.h.get('content-range') === `bytes */${MP3.length}`, `une plage hors du fichier : 416 (${r.s})`);
  const etag = (await W(`/ecoute/${J1}/playlist.json`)).h.get('etag');
  r = await W(`/ecoute/${J1}/playlist.json`, { headers: { 'if-none-match': etag } });
  ok(r.s === 304, `If-None-Match : 304 (${r.s})`);
  r = await W(`/ecoute/${J1}/index.html`, { method: 'HEAD' });
  ok(r.s === 200 && r.t.length === 0 && Number(r.h.get('content-length')) > 10, `HEAD (${r.s})`);
  for (const p of ['_lien.json', '_ecoutes/2026-10-05/1-aa-1', '../x', 'audio/../_lien.json', 'audio/UN.mp3', 'autre.html', 'assets/x.png', '%2e%2e/_lien.json']) {
    r = await W(`/ecoute/${J1}/${p}`);
    ok(r.s === 404, `jamais servi : ${p} (${r.s})`);
  }
  r = await W(`/ecoute/${J1}/index.html`, { method: 'PUT', body: 'x', headers: meme });
  ok(r.s === 405, `lecture seule (${r.s})`);
  for (const p of ['/ecoute/', '/ecoute/abc/', `/ecoute/${'0'.repeat(32)}/`, `/ecoute/${J1.toUpperCase()}/`]) {
    r = await W(p);
    ok(r.s === 404 && r.x.includes('Ce lien n’existe pas'), `un lien inconnu ou mal formé : 404, une page (${p} ${r.s})`);
  }
  r = await W(`/ecoute/${J1}/`, { headers: { cookie: 'sr_session=abc' } });
  ok(r.s === 200, 'hors de la porte à code : ni session ni invitation demandées, rien vers les DGX');

  console.log('  le compteur d’écoutes :');
  const avant = [...b.objets.keys()].filter((k) => k.includes('/_ecoutes/')).length;
  r = await W(`/ecoute/${J1}/_ecoute`, { method: 'POST', body: 'n=3', headers: meme });
  const apres = [...b.objets.keys()].filter((k) => k.startsWith(`ecoute/${J1}/_ecoutes/`));
  ok(r.s === 204 && apres.length === avant + 1 && apres.some((k) => /\/_ecoutes\/\d{4}-\d{2}-\d{2}\/\d+-[0-9a-f]{8}-3$/.test(k)),
    `une écoute : un objet vide de plus, ecoute/<jeton>/_ecoutes/<jour>/<ms>-<hasard>-3 (${r.s} ${apres.slice(-1)})`);
  r = await W(`/ecoute/${J1}/_ecoute`, { method: 'POST', body: 'n=3', headers: { origin: 'https://ailleurs.test', 'sec-fetch-site': 'cross-site' } });
  ok(r.s === 403, `une écoute venue d'une autre page : 403 (${r.s})`);
  for (const corps of ['n=0', 'n=abc', 'x', 'n=1234']) {
    r = await W(`/ecoute/${J1}/_ecoute`, { method: 'POST', body: corps, headers: meme });
    ok(r.s === 400, `une écoute mal formée : 400 (${corps} ${r.s})`);
  }
  const J2 = randomBytes(16).toString('hex');
  await garnis(b, J2, fiche({ ecoutes: false }), paquet);
  r = await W(`/ecoute/${J2}/_ecoute`, { method: 'POST', body: 'n=1', headers: meme });
  ok(r.s === 404 && ![...b.objets.keys()].some((k) => k.startsWith(`ecoute/${J2}/_ecoutes/`)), `un lien qui ne compte pas : rien n'est rangé (${r.s})`);

  console.log('  la date de fin :');
  const J3 = randomBytes(16).toString('hex');
  await garnis(b, J3, fiche({ fin: new Date(Date.now() - 1000).toISOString() }), paquet);
  r = await W(`/ecoute/${J3}/`);
  const r2 = await W(`/ecoute/${J3}/audio/01-un.mp3`);
  ok(r.s === 410 && r.x.includes('a expiré') && r2.s === 410, `un lien expiré : 410, une page, et plus aucun fichier (${r.s} ${r2.s})`);
  const J4 = randomBytes(16).toString('hex');
  await garnis(b, J4, fiche({ fin: new Date(Date.now() + 3600e3).toISOString() }), paquet);
  ok((await W(`/ecoute/${J4}/`)).s === 200, 'avant sa fin, le lien marche');

  console.log('  un code :');
  const J5 = randomBytes(16).toString('hex');
  const sel = randomBytes(8).toString('hex');
  await garnis(b, J5, fiche({ code: { sel, sha256: sha(`${sel}:AB12`) }, fin: new Date(Date.now() + 7 * 86400e3).toISOString() }), paquet);
  r = await W(`/ecoute/${J5}/`);
  ok(r.s === 200 && r.h.get('cache-control') === 'no-store' && r.x.includes('action="./_code"') && r.x.includes('Été « 26 » &lt;b&gt;') && r.x.includes('--acc-sombre:#7a9cff')
    && !r.x.includes('og:image') && !/showrunner/i.test(r.x) && r.x.includes('href="./ecoute.css"'),
  `sans le code : la page du code (titre échappé, l'accent, ni pochette en aperçu ni nom d'outil) (${r.s})`);
  for (const p of ['playlist.json', 'audio/01-un.mp3', 'assets/cover-1200.jpg', 'paroles/01-un.lrc']) {
    r = await W(`/ecoute/${J5}/${p}`);
    ok(r.s === 401, `sans le code : ${p} refusé (${r.s})`);
  }
  for (const p of ['ecoute.css', 'assets/icon-192.png']) ok((await W(`/ecoute/${J5}/${p}`)).s === 200, `sans le code : ${p} passe (le style de la page, l'icône)`);
  r = await W(`/ecoute/${J5}/_ecoute`, { method: 'POST', body: 'n=1', headers: meme });
  ok(r.s === 401, `sans le code, pas d'écoute comptée (${r.s})`);
  const form = { ...meme, 'content-type': 'application/x-www-form-urlencoded' };
  r = await W(`/ecoute/${J5}/_code`, { method: 'POST', body: 'code=XXXX', headers: form });
  ok(r.s === 200 && r.x.includes('pas le bon code') && !r.h.get('set-cookie'), `un mauvais code : la page, sans cookie (${r.s})`);
  r = await W(`/ecoute/${J5}/_code`, { method: 'POST', body: 'code=ab+12', headers: form });
  const sc = r.h.get('set-cookie') || '';
  const val = (/ecoute_code=([0-9a-f]{64})/.exec(sc) || [])[1];
  const age = Number((/Max-Age=(\d+)/.exec(sc) || [])[1]);
  ok(r.s === 303 && r.h.get('location') === `/ecoute/${J5}/` && val && sc.includes(`Path=/ecoute/${J5}/`) && sc.includes('HttpOnly')
    && sc.includes('Secure') && sc.includes('SameSite=Lax') && age > 6 * 86400 && age <= 7 * 86400,
  `le bon code (sans casse ni espaces) : un cookie scellé, propre au lien, jusqu'à sa fin (${r.s} ${sc.slice(0, 120)})`);
  const avec = { cookie: `ecoute_code=${val}` };
  r = await W(`/ecoute/${J5}/audio/01-un.mp3`, { headers: { ...avec, range: 'bytes=0-9' } });
  ok(r.s === 206 && r.t.equals(MP3.subarray(0, 10)), `avec le cookie : le son, par plages (${r.s})`);
  r = await W(`/ecoute/${J5}/`, { headers: avec });
  ok(r.s === 200 && r.x.includes('<title>lecteur</title>'), 'avec le cookie : le lecteur');
  ok((await W(`/ecoute/${J5}/_ecoute`, { method: 'POST', body: 'n=1', headers: { ...meme, ...avec } })).s === 204, 'avec le cookie : une écoute comptée');
  ok((await W(`/ecoute/${J1}/audio/01-un.mp3`, { headers: { cookie: `ecoute_code=${val}` } })).s === 200, 'le cookie d’un lien n’ouvre rien d’autre (J1 est ouvert de toute façon)');
  ok((await W(`/ecoute/${J5}/playlist.json`, { headers: { cookie: `ecoute_code=${'0'.repeat(64)}` } })).s === 401, 'un cookie forgé : 401');
  // changer le code ferme les anciens cookies
  const sel2 = randomBytes(8).toString('hex');
  await b.put(`ecoute/${J5}/_lien.json`, fiche({ code: { sel: sel2, sha256: sha(`${sel2}:NEUF`) } }));
  const e2 = { ...env };   // un autre isolat : la fiche n'est pas en mémoire
  const fresh = async (chemin, o = {}) => {
    const mod = await import(`./worker.js?isolat=${Math.random()}`);
    const h = new Headers(o.headers || {});
    const rr = await mod.default.fetch(new Request(PAGE + chemin, { method: 'GET', headers: h }), e2, ctx);
    return rr.status;
  };
  ok(await fresh(`/ecoute/${J5}/playlist.json`, { headers: avec }) === 401, 'le code changé : l’ancien cookie ne vaut plus rien');
  // les essais de code bornés par adresse
  const J6 = randomBytes(16).toString('hex');
  const sel3 = randomBytes(8).toString('hex');
  await garnis(b, J6, fiche({ code: { sel: sel3, sha256: sha(`${sel3}:1234`) } }), paquet);
  const ip = { ...form, 'cf-connecting-ip': '203.0.113.9' };
  let dernier = 0;
  for (let k = 0; k < 4; k++) dernier = (await W(`/ecoute/${J6}/_code`, { method: 'POST', body: 'code=0000', headers: ip })).s;
  ok(dernier === 429, `les essais de code, bornés par adresse (ESSAIS) : 429 au-delà (${dernier})`);
  r = await W(`/ecoute/${J6}/_code`, { method: 'POST', body: 'code=1234', headers: { ...form, origin: 'https://ailleurs.test', 'sec-fetch-site': 'cross-site' } });
  ok(r.s === 403, `un code envoyé d'une autre page : 403 (${r.s})`);
  const sansCle = { ...env, PORTE_CLE: '' };
  r = await W(`/ecoute/${J6}/_code`, { method: 'POST', body: 'code=1234', headers: { ...form, 'cf-connecting-ip': '203.0.113.10' }, e: sansCle });
  ok(r.s === 503, `sans PORTE_CLE, un lien à code ne s'ouvre pas (${r.s})`);

  console.log('  le reste du Worker ne bouge pas :');
  r = await W('/api/library', { e: { ...env, PORTAIL: { fetch: async () => new Response('{}', { status: 200 }) } } });
  ok(r.s === 401, `/api/* reste derrière la porte à code (${r.s})`);
  r = await W('/ecoute-ailleurs/x.mp3', { e: { ...env, ASSETS: { fetch: async () => new Response('m', { status: 200 }) } } });
  ok(r.s === 200, `un média hors de /ecoute/ reste un asset (${r.s})`);

  console.log(`\n${passes} passés, ${echecs.length} en échec`);
  process.exit(echecs.length ? 1 : 0);
}
