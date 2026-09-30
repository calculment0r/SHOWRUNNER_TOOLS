// Essai de bout en bout de la vraie porte, SANS Cloudflare : worker.js tourne ici, dans Node (WebCrypto, fetch), devant
// la porte « access » d'un portail d'essai (Python, 127.0.0.1). Les liaisons Cloudflare sont simulées au plus près :
// la liaison VPC envoie la requête telle que le Worker l'a construite (chemin, en-têtes, corps de longueur fixe) ; les
// clés de l'équipe Access sont servies ici, et les jetons signés ici, par une autre implémentation de RS256 que celle
// du portail. Rien n'est ouvert sur internet.
//
//   node porte/essai.mjs --porte http://127.0.0.1:9813 --certs 9899 --cle /chemin/porte.key [--aud aud-e2e]
//                        [--codes <données>/porte-demo.json [--ouverte oui]]
// (--ouverte oui : le portail d'essai en "mode": "code" avec "invitation": false)
//
// Le portail d'essai doit avoir, dans son showrunner.local.json :
//   "porte": {"mode": "access", "team_domain": "http://127.0.0.1:9899", "aud": "aud-e2e", "cle": "/chemin/porte.key",
//             "emails": {"cal@e2e.test": "cal"}}
// Avec --codes : le portail d'essai en "mode": "code" (le reste pareil ; le chemin « access » y passe aussi), et un
// pseudo créé d'avance (python3 server/showrunner.py --ami su007) : les essais de la porte par code s'ajoutent.
// Rend 0 si tout passe.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import worker from './worker.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const PORTE = args.porte || 'http://127.0.0.1:9813';
const CERTS = Number(args.certs || 9899);
const AUD = args.aud || 'aud-e2e';
const TEAM = `http://127.0.0.1:${CERTS}`;
const CLE = readFileSync(args.cle, 'utf8');   // tel quel, retour à la ligne compris (wrangler secret put < fichier)
const PAGE = 'https://showrunner.luxigone.workers.dev';

// ce que le moteur des Workers fournit et que Node n'a pas
globalThis.FixedLengthStream ??= class {
  constructor() { const t = new TransformStream(); this.readable = t.readable; this.writable = t.writable; }
};

let passes = 0;
const echecs = [];
const ok = (c, m) => { if (c) passes += 1; else { echecs.push(m); console.log('  ÉCHEC', m); } };

// ── Access : une paire de clés de l'équipe, ses certificats, des jetons ──
const enc = new TextEncoder();
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const paire = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const autre = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
// un kid neuf à chaque essai : le portail garde les clés d'un essai précédent une heure (et ne relit un kid inconnu
// qu'une fois par minute) ; relancer l'essai plus d'une fois par minute demande de relancer le portail d'essai
const KID = `e2e-${Date.now().toString(36)}`;
const jwk = { ...(await crypto.subtle.exportKey('jwk', paire.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
let lectures = 0;
const certs = createServer((req, res) => {
  lectures += 1;
  if (req.url !== '/cdn-cgi/access/certs') { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
});
await new Promise((ok_) => certs.listen(CERTS, '127.0.0.1', ok_));

async function jeton(email, plus = {}, cle = paire.privateKey) {
  const t = Math.floor(Date.now() / 1000);
  const tete = b64u(enc.encode(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' })));
  const corps = b64u(enc.encode(JSON.stringify({ iss: TEAM, aud: [AUD], email, iat: t, nbf: t, exp: t + 600, type: 'app', ...plus })));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cle, enc.encode(`${tete}.${corps}`));
  return `${tete}.${corps}.${b64u(sig)}`;
}

// ── la liaison VPC simulée : la requête du Worker, telle quelle, vers la porte du portail ──
const vus = [];
const vpc = (base, { morte = false } = {}) => ({
  async fetch(url, init = {}) {
    if (morte) throw new Error('connection_refused');
    const u = new URL(url);
    vus.push({ chemin: u.pathname + u.search, entetes: Object.fromEntries(new Headers(init.headers)) });
    const corps = init.body ? Buffer.from(await new Response(init.body).arrayBuffer()) : undefined;
    return fetch(base + u.pathname + u.search, { method: init.method, headers: init.headers, body: corps, redirect: 'manual' });
  },
});
// Les assets simulés comme l'asset-worker de Cloudflare (workers-sdk, packages/workers-shared/asset-worker) : le
// fichier du dépôt entier, ETag, 304 sur If-None-Match, AUCUNE plage (Range ignoré, comme l'adresse publique le
// 30/09) ; le corps en morceaux de 7919 octets, pour que les plages tombent au milieu d'un morceau. Les pages : un texte.
const RACINE = new URL('../', import.meta.url);
const assetsDuDepot = {
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (!/^\/media\//.test(pathname)) return new Response('une page des assets', { status: 200 });
    let octets;
    try { octets = readFileSync(new URL(`.${pathname}`, RACINE)); } catch { return new Response('introuvable', { status: 404 }); }
    const etag = `"${createHash('sha256').update(octets).digest('hex').slice(0, 32)}"`;
    // pas de Content-Length : vue du Worker, la réponse des assets n'en a pas (wrangler dev, 30/09)
    const h = { etag, 'content-type': pathname.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream' };
    if (!req.headers.has('range')) h['cache-control'] = 'public, max-age=0, must-revalidate';
    if ([etag, `W/${etag}`].includes(req.headers.get('if-none-match') || '')) return new Response(null, { status: 304, headers: { etag } });
    if (req.method === 'HEAD') return new Response(null, { status: 200, headers: h });
    let i = 0;
    const corps = new ReadableStream({
      pull(c) { if (i >= octets.length) { c.close(); return; } c.enqueue(new Uint8Array(octets.subarray(i, i + 7919))); i += 7919; },
    });
    return new Response(corps, { status: 200, headers: h });
  },
};
const env = {
  TEAM_DOMAIN: TEAM, POLICY_AUD: AUD, PORTE_CLE: CLE, ADMINS: 'cal@e2e.test',
  PORTAIL: vpc(PORTE), ASSETS: assetsDuDepot,
};
const attente = [];
const ctx = { waitUntil: (p) => attente.push(p), passThroughOnException() {} };

async function W(chemin, { email, jwt, method = 'GET', body, headers = {}, e = env } = {}) {
  const h = new Headers(headers);
  if (jwt !== null) h.set('cf-access-jwt-assertion', jwt || (email ? await jeton(email) : ''));
  if (body !== undefined) h.set('content-length', String(body.length));
  const r = await worker.fetch(new Request(PAGE + chemin, { method, headers: h, body }), e, ctx);
  const t = Buffer.from(await r.arrayBuffer());
  let d = t;
  try { d = JSON.parse(t.toString('utf8')); } catch { /* un fichier */ }
  return { s: r.status, d, h: r.headers };
}

// une image PNG de 8 × 6, faite ici (zlib de Node), pour les dépôts
const png = (() => {
  const bloc = (type, data) => {
    const td = Buffer.concat([Buffer.from(type), data]);
    const n = Buffer.alloc(4); n.writeUInt32BE(data.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([n, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(6, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc('IHDR', ihdr),
    bloc('IDAT', deflateSync(Buffer.concat(Array.from({ length: 6 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(8 * 3, 0x40)]))))),
    bloc('IEND', Buffer.alloc(0))]);
})();

let r;

// ── les médias des assets, par plages (Safari les exige) : dans les deux modes, sans DGX2 ni identité ──
{
  const VID = '/media/accueil-video.mp4';
  const fichier = readFileSync(new URL(`.${VID}`, RACINE));
  const N = fichier.length;
  const envCode = { ...env, PORTE_MODE: 'code' };
  const M = (chemin, headers = {}, o = {}) => W(chemin, { jwt: null, e: envCode, headers, ...o });
  const pareil = (d, debut, fin) => Buffer.isBuffer(d) && d.equals(fichier.subarray(debut, fin));
  console.log(`  les médias par plages (${VID}, ${N} octets) :`);
  const n0 = vus.length;
  r = await M(VID);
  ok(r.s === 200 && pareil(r.d, 0, N) && r.h.get('accept-ranges') === 'bytes' && r.h.get('cache-control'),
    `sans Range : 200, le fichier entier, Accept-Ranges: bytes (${r.s} ${r.d.length} ${r.h.get('accept-ranges')})`);
  r = await M(VID, { range: 'bytes=0-1' });
  ok(r.s === 206 && pareil(r.d, 0, 2) && r.h.get('content-range') === `bytes 0-1/${N}` && r.h.get('accept-ranges') === 'bytes'
    && r.h.get('cache-control') === 'public, max-age=0, must-revalidate',
    `bytes=0-1 (la première question de Safari) : 206, 2 octets, Content-Range bytes 0-1/${N} (${r.s} ${r.h.get('content-range')})`);
  r = await M(VID, { range: 'bytes=0-99' });
  ok(r.s === 206 && pareil(r.d, 0, 100) && r.h.get('content-range') === `bytes 0-99/${N}`,
    `bytes=0-99 (le test d'Apple) : 206, 100 octets (${r.s} ${r.d.length})`);
  r = await M(VID, { range: 'bytes=12345-99999' });
  ok(r.s === 206 && pareil(r.d, 12345, 100000) && r.h.get('content-range') === `bytes 12345-99999/${N}`,
    `bytes=12345-99999 : au milieu des morceaux, les octets justes (${r.s} ${r.d.length})`);
  r = await M(VID, { range: `bytes=${N - 1000}-` });
  ok(r.s === 206 && pareil(r.d, N - 1000, N) && r.h.get('content-range') === `bytes ${N - 1000}-${N - 1}/${N}`,
    `bytes=${N - 1000}- : la fin (${r.s} ${r.h.get('content-range')})`);
  r = await M(VID, { range: 'bytes=-500' });
  ok(r.s === 206 && pareil(r.d, N - 500, N), `bytes=-500 : les 500 derniers (${r.s} ${r.h.get('content-range')})`);
  r = await M(VID, { range: `bytes=0-${N + 5000}` });
  ok(r.s === 206 && pareil(r.d, 0, N) && r.h.get('content-range') === `bytes 0-${N - 1}/${N}`, `une fin au-delà du fichier : bornée (${r.s})`);
  r = await M(VID, { range: `bytes=${N}-` });
  ok(r.s === 416 && r.h.get('content-range') === `bytes */${N}`, `une plage hors du fichier : 416, bytes */${N} (${r.s})`);
  r = await M(VID, { range: 'bytes=0-1,5-6' });
  ok(r.s === 200 && pareil(r.d, 0, N), `plusieurs plages : le fichier entier, 200 (permis par la RFC 9110) (${r.s})`);
  const etag = r.h.get('etag');
  r = await M(VID, { range: 'bytes=0-9', 'if-range': etag });
  ok(r.s === 206 && r.d.length === 10, `If-Range = l'ETag : la plage (${r.s})`);
  r = await M(VID, { range: 'bytes=0-9', 'if-range': '"un-autre"' });
  ok(r.s === 200 && r.d.length === N, `If-Range d'un autre fichier : le fichier entier (${r.s})`);
  r = await M(VID, { 'if-none-match': etag });
  ok(r.s === 304, `If-None-Match : 304 des assets (${r.s})`);
  r = await M(VID, { range: 'bytes=0-9' }, { method: 'HEAD' });
  ok(r.s === 206 && r.d.length === 0 && r.h.get('content-range') === `bytes 0-9/${N}`, `HEAD avec Range : 206 sans corps (${r.s})`);
  r = await M(VID, { range: 'bytes=0-9' }, { e: env });
  ok(r.s === 206 && r.d.length === 10, `porte « access » aussi (ni jeton lu : c'est un asset) (${r.s})`);
  r = await M('/media/absent.mp4', { range: 'bytes=0-9' });
  ok(r.s === 404, `un média absent : le 404 des assets (${r.s})`);
  ok(vus.length === n0, 'les médias ne partent jamais vers DGX2');
  r = await M(VID, {}, { method: 'POST', body: Buffer.from('x') });
  ok(r.s === 405, `écrire sur un média : 405 (${r.s})`);
  r = await M('/library/img-20260930-120000-abcd/main.mp4', { range: 'bytes=0-9' });
  ok(r.s === 401, `une vidéo de la bibliothèque n'est pas un asset : la porte la garde (sans cookie, 401) (${r.s})`);
  r = await M('/analyse/runs/x/rendu.mp4', { range: 'bytes=0-9' });
  ok(r.s === 401, `… ni un rendu de Movie Analysis (${r.s})`);
  r = await M(VID, { range: 'bytes=0-9' }, { e: { ...envCode, MODE: 'studio', STUDIO: vpc(PORTE, { morte: true }) } });
  ok(r.s !== 206, `en mode studio, rien de tout cela : tout va au studio (${r.s})`);
}

// ── les essais de la porte « access » (le portail d'essai en porte.mode = "access" ; sans --codes) ──
if (!args.codes) {
r = await W('/api/library', { jwt: null });
ok(r.s === 403, `le Worker, sans jeton Access : 403 (${r.s})`);
r = await W('/api/library', { jwt: await jeton('ami@e2e.test', {}, autre.privateKey) });
ok(r.s === 403, `le Worker, jeton signé par une autre clé : 403 (${r.s})`);
r = await W('/api/library', { jwt: await jeton('ami@e2e.test', { aud: ['autre-app'] }) });
ok(r.s === 403, `le Worker, jeton d'une autre application : 403 (${r.s})`);
r = await W('/api/porte/moi', { email: 'ami@e2e.test', e: { ...env, POLICY_AUD: '<tag AUD de l\'application Access>' } });
ok(r.s === 503 && !vus.length, `déployé sans tag AUD (l'emplacement de wrangler.jsonc) : 503, rien ne part vers DGX2 (${r.s})`);
r = await W('/api/porte/moi', { email: 'Ami@E2E.test' });
ok(r.s === 200 && r.d.email === 'ami@e2e.test' && r.d.role === 'ami', `/api/porte/moi : l'ami, en minuscules (${JSON.stringify(r.d)})`);

r = await W('/api/auth/me', { email: 'ami@e2e.test' });
ok(r.s === 200 && r.d.state === 'active' && r.d.porte === 'access' && r.d.user?.role === 'ami',
  `Worker → porte : la signature et le jeton passent, le portail voit l'ami (${r.s} ${JSON.stringify(r.d)})`);
const dernier = vus.at(-1);
ok(dernier && dernier.entetes['cf-access-jwt-assertion'] && dernier.entetes['x-porte-sig'] && !dernier.entetes.cookie,
  'vers le portail : le jeton Access et la signature, jamais les cookies de la page');

r = await W('/api/admin/state', { email: 'ami@e2e.test' });
ok(r.s === 403, `l'ami n'ouvre pas l'admin (${r.s})`);
r = await W('/api/admin/state', { email: 'cal@e2e.test' });
ok(r.s === 200 && r.d.me?.id === 'cal', `Cal (ADMINS + porte.emails) : admin, sous son compte (${r.s} ${r.d.me?.id})`);
r = await W('/api/auth/enter', { email: 'ami@e2e.test', method: 'POST', body: Buffer.from('{"name":"nico007"}'),
  headers: { 'content-type': 'application/json', origin: PAGE } });
ok(r.s === 409, `taper nico007 derrière la vraie porte : rien (${r.s})`);

// une requête avec une chaîne de requête accentuée : le chemin signé est celui que le portail reçoit
r = await W('/api/library?q=%C3%A9t%C3%A9%20bleu&kind=image&limit=3', { email: 'ami@e2e.test' });
ok(r.s === 200 && Array.isArray(r.d.items), `chemin et requête encodés : la signature tient (${r.s})`);

// un dépôt : corps de longueur fixe, signature sur le chemin avec sa requête
r = await W('/api/library/upload?name=e2e.png&title=Par%20la%20porte', { email: 'cal@e2e.test', method: 'PUT', body: png,
  headers: { 'content-type': 'image/png', origin: PAGE, 'sec-fetch-site': 'same-origin' } });
ok(r.s === 200 && r.d.kind === 'image' && r.d.owner === 'cal', `un dépôt par la porte : rangé, à Cal (${r.s} ${JSON.stringify(r.d).slice(0, 160)})`);
const id = r.d.id;
r = await W(`/library/${id}/main.png`, { email: 'ami@e2e.test' });
ok(r.s === 200 && Buffer.isBuffer(r.d) && r.d.subarray(0, 4).toString('hex') === '89504e47', `le fichier, relayé du portail (pas encore dans R2) (${r.s})`);
r = await W(`/library/${id}/main.png`, { email: 'ami@e2e.test', headers: { range: 'bytes=0-3' } });
ok(r.s === 206 && r.d.length === 4, `… avec les requêtes partielles (${r.s})`);
r = await W('/api/library/upload?name=x.png', { email: 'cal@e2e.test', method: 'PUT', body: png,
  headers: { 'content-type': 'image/png', origin: 'https://evil.example' } });
ok(r.s === 403, `une écriture venue d'une autre page : le Worker la refuse (${r.s})`);
r = await W('/character/api/characters', { email: 'ami@e2e.test' });
ok(r.s === 502 && vus.at(-1).chemin === '/character/api/characters',
  `/character/api/ va au portail (qui relaie au studio ; ici un studio muet : 502) (${r.s})`);
r = await W('/admin/', { email: 'ami@e2e.test' });
ok(r.s === 200 && String(r.d).includes('assets'), `une page : servie par les assets (${r.s})`);

// ── le flux SSE d'Idéation (ideation/collab.js : EventSource sur …/collab/<planche>/stream), par le Worker ──
// Le flux doit arriver morceau par morceau (hello tout de suite, puis chaque événement), rester ouvert, et garder
// son battement (« : ping » toutes les HEARTBEAT_S du portail) sans que la porte ne le coupe (« bye »).
const memePage = { origin: PAGE, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
r = await W('/api/ideation/boards', { email: 'cal@e2e.test', method: 'POST', body: Buffer.from('{"name":"par la porte"}'), headers: memePage });
const planche = r.d && r.d.id;
ok(r.s === 200 && planche, `une planche d'Idéation, créée par la porte (${r.s})`);
const dec = new TextDecoder();
// un Worker qui mettrait la réponse en tampon ne rendrait jamais rien (le flux ne finit pas) : 8 s, puis échec
const flux = await Promise.race([
  worker.fetch(new Request(`${PAGE}/api/ideation/collab/${planche}/stream`, {
    headers: { 'cf-access-jwt-assertion': await jeton('cal@e2e.test'), accept: 'text/event-stream', 'cache-control': 'no-cache', 'last-event-id': '3' },
  }), env, ctx),
  new Promise((res) => setTimeout(() => res(null), 8000)),
]) || (ok(false, 'le flux : aucune réponse du Worker en 8 s (mis en tampon ?)'),
  new Response(new ReadableStream({ start: (c) => c.close() }), { status: 504 }));
ok(flux.status === 200 && (flux.headers.get('content-type') || '').startsWith('text/event-stream'),
  `le flux : 200, text/event-stream (${flux.status} ${flux.headers.get('content-type')})`);
ok(!flux.headers.get('content-length'), 'le flux : sans longueur (pas mis en tampon)');
const vuFlux = vus.at(-1).entetes;
ok(vuFlux.accept === 'text/event-stream' && vuFlux['last-event-id'] === '3' && vuFlux['cache-control'] === 'no-cache',
  `vers le portail : accept, last-event-id, cache-control d'EventSource (${JSON.stringify([vuFlux.accept, vuFlux['last-event-id'], vuFlux['cache-control']])})`);
const lecteur = flux.body.getReader();
let recu = '';
let enCours = null;
let fini = false;
async function jusqua(motif, ms) {   // lit le flux jusqu'à `motif`, au plus `ms` ; faux s'il se tait ou se ferme
  const fin = Date.now() + ms;
  while (!motif.test(recu)) {
    const reste = fin - Date.now();
    if (reste <= 0 || fini) return false;
    enCours ??= lecteur.read();
    const lu = await Promise.race([enCours, new Promise((res) => setTimeout(() => res(null), reste))]);
    if (!lu) return false;
    enCours = null;
    if (lu.done) { fini = true; return motif.test(recu); }
    recu += dec.decode(lu.value, { stream: true });
  }
  return true;
}
let t0 = Date.now();
ok(await jusqua(/event: hello\ndata: .*\n\n/, 5000), `hello arrive tout de suite, flux ouvert (${Date.now() - t0} ms)`);
const hello = JSON.parse(/event: hello\ndata: (.*)\n/.exec(recu)?.[1] || '{}');
ok(hello.cid && !fini, `hello donne l'identifiant de connexion (${hello.cid})`);
t0 = Date.now();
r = await W(`/api/ideation/collab/${planche}/messages`, { email: 'cal@e2e.test', method: 'POST',
  body: Buffer.from(JSON.stringify({ text: 'bonjour par la porte', cid: hello.cid })), headers: memePage });
ok(r.s === 200, `un message posté par la porte (${r.s} ${JSON.stringify(r.d).slice(0, 120)})`);
ok(await jusqua(/event: msg\ndata: .*bonjour par la porte/, 3000), `… il revient aussitôt par le flux (${Date.now() - t0} ms)`);
// la limite de débit (écritures) ne compte pas les gestes de la collaboration : sinon la planche se figerait
const bride = { ...env, LIMITE: { limit: async () => ({ success: false }) } };
r = await W(`/api/ideation/collab/${planche}/presence`, { email: 'cal@e2e.test', method: 'POST',
  body: Buffer.from(JSON.stringify({ cid: hello.cid, cursor: [12, 34] })), headers: memePage, e: bride });
ok(r.s === 200, `limite atteinte : un geste de collaboration (présence) passe encore (${r.s} ${JSON.stringify(r.d).slice(0, 80)})`);
r = await W('/api/ideation/boards', { email: 'cal@e2e.test', method: 'POST', body: Buffer.from('{"name":"trop"}'), headers: memePage, e: bride });
ok(r.s === 429, `… une autre écriture est bridée (${r.s})`);
t0 = Date.now();
ok(await jusqua(/\n: ping\n/, 20000), `le battement du portail traverse la porte (${Date.now() - t0} ms)`);
ok(!/event: bye/.test(recu) && !fini, 'le flux tient, la porte ne le ferme pas (pas de « bye »)');
console.log(`  le flux par le Worker : ${recu.length} octets reçus, ${(recu.match(/^event: /gm) || []).length} événements, ` +
  `${(recu.match(/^: ping$/gm) || []).length} battement(s), toujours ouvert : ${!fini}`);
await lecteur.cancel().catch(() => {});

// DGX2 éteinte : la page le dit
r = await W('/api/jobs', { email: 'ami@e2e.test', e: { ...env, PORTAIL: vpc(PORTE, { morte: true }) } });
ok(r.s === 503 && r.d.machines === false, `DGX2 injoignable : 503 « les machines dorment » (${r.s})`);
r = await W('/api/library', { email: 'ami@e2e.test', e: { ...env, PORTAIL: vpc(PORTE, { morte: true }) } });
ok(r.s === 503, `… la bibliothèque hors ligne attend R2 (${r.s})`);

// un jeton qui dit vrai, un Worker qui signe avec une autre clé : le portail refuse
r = await W('/api/auth/me', { email: 'ami@e2e.test', e: { ...env, PORTE_CLE: 'une-autre-cle-'.repeat(4) } });
ok(r.s === 401, `une autre clé de porte : le portail refuse (${r.s})`);
ok(lectures <= 2, `les certificats de l'équipe sont gardés (lus ${lectures} fois : le Worker, le portail)`);

}

// ── la porte par code (PORTE_MODE = "code" ; le portail d'essai en porte.mode = "code") ──
// --codes <données>/porte-demo.json, et un pseudo créé d'avance (python3 server/showrunner.py --ami su007)
// ── sans invitation (--ouverte oui ; le portail d'essai en porte.mode = "code", porte.invitation = false) ──
// Le Worker n'a rien de neuf à faire : les pages sont des assets, /api/auth/… passe sans cookie ; il garde ESSAIS.
if (args.ouverte) {
  const codes = JSON.parse(readFileSync(args.codes, 'utf8'));
  const IP = '203.0.113.51';
  const envC = { ...env, PORTE_MODE: 'code' };
  const C = (chemin, o = {}) => W(chemin, { jwt: null, e: envC, ...o, headers: { 'cf-connecting-ip': IP, ...(o.headers || {}) } });
  const posee = (h, nom) => (h.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith(`${nom}=`))?.slice(nom.length + 1);
  const avec = (c) => ({ ...(c ? { cookie: c } : {}), 'content-type': 'application/json', origin: PAGE, 'sec-fetch-site': 'same-origin' });
  console.log('  la porte sans invitation :');
  r = await C('/api/auth/me');
  ok(r.s === 200 && r.d.sur_liste === true && r.d.invitation && r.d.state === 'anonymous',
    `sans cookie : /api/auth/me passe le Worker, la porte demande le pseudo (${r.s} ${JSON.stringify(r.d)})`);
  const n0 = vus.length;
  r = await C('/api/library');
  ok(r.s === 401 && vus.length === n0, `sans cookie, l'API : 401 du Worker, rien vers DGX2 (${r.s})`);
  r = await C('/api/auth/enter', { method: 'POST', body: Buffer.from('{"name":"su007"}'), headers: avec() });
  const ses = posee(r.h, 'sr_session');
  ok(r.s === 200 && r.d.state === 'active' && ses, `su007 (ajouté par Cal) : son pseudo, sans cookie ni code → entre (${r.s} ${JSON.stringify(r.d).slice(0, 80)})`);
  r = await C('/api/library', { headers: { cookie: `sr_session=${ses}` } });
  ok(r.s === 200 && Array.isArray(r.d.items), `… la bibliothèque (${r.s})`);
  r = await C('/api/auth/enter', { method: 'POST', body: Buffer.from('{"name":"Personne007"}'), headers: avec() });
  ok(r.s === 403 && /demande à Cal/.test(r.d.error || ''), `un pseudo inconnu : refusé, poliment (${r.s} ${r.d.error})`);
  r = await C('/api/auth/enter', { method: 'POST', body: Buffer.from('{"name":"nico007"}'), headers: avec() });
  ok(r.s === 403 && !posee(r.h, 'sr_session'), `nico007 sans le code admin : 403 (${r.s})`);
  const a = await C(`/invitation/${codes.admin}`);
  r = await C('/api/auth/enter', { method: 'POST', body: Buffer.from('{"name":"nico007"}'), headers: avec(`sr_invitation=${posee(a.h, 'sr_invitation')}`) });
  ok(r.s === 200 && r.d.user?.role === 'admin', `nico007 avec le lien du code admin : admin (${r.s})`);
  const bride = { ...envC, ESSAIS: { limit: async () => ({ success: false }) } };
  r = await C('/api/auth/enter', { e: bride, method: 'POST', body: Buffer.from('{"name":"su007"}'), headers: avec() });
  ok(r.s === 429, `ESSAIS atteint : les pseudos tapés sont bridés par adresse (${r.s})`);
}

if (args.codes && !args.ouverte) {
  const codes = JSON.parse(readFileSync(args.codes, 'utf8'));
  const IP = '203.0.113.50';
  const envC = { ...env, PORTE_MODE: 'code' };
  const C = (chemin, o = {}) => W(chemin, { jwt: null, e: envC, ...o, headers: { 'cf-connecting-ip': IP, ...(o.headers || {}) } });
  const posee = (h, nom) => (h.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith(`${nom}=`))?.slice(nom.length + 1);
  console.log('  la porte par code :');

  let n0 = vus.length;
  r = await C('/api/library');
  ok(r.s === 401 && vus.length === n0, `code, sans cookie : 401 du Worker, rien ne part vers DGX2 (${r.s})`);
  r = await C('/api/jobs', { method: 'POST', body: Buffer.from('{}'), headers: { 'content-type': 'application/json', origin: PAGE } });
  ok(r.s === 401 && vus.length === n0, `code, sans cookie, une écriture : 401 du Worker (${r.s})`);
  r = await C('/api/porte/moi');
  ok(r.s === 200 && r.d.porte === 'code' && !r.d.email, `/api/porte/moi : porte « code », pas d'e-mail (${JSON.stringify(r.d)})`);
  r = await C('/api/auth/me');
  let vu = vus.at(-1).entetes;
  ok(r.s === 200 && r.d.porte === 'code' && r.d.state === 'anonymous' && r.d.invitation === false,
    `code : le portail voit un visiteur signé, sans invitation (${r.s} ${JSON.stringify(r.d)})`);
  ok(vu['x-porte-role'] === 'code' && vu['x-porte-qui'] === IP && !vu['cf-access-jwt-assertion'] && !vu.cookie,
    `vers le portail : rôle « code », l'adresse du visiteur, ni jeton ni cookie (${vu['x-porte-role']} ${vu['x-porte-qui']})`);
  r = await C('/invitation/');
  ok(r.s === 200 && String(r.d).includes('action="/invitation/"'), `la page d'invitation, par le Worker (${r.s})`);
  r = await C(`/invitation/${codes.invitation}`);
  const inv = posee(r.h, 'sr_invitation');
  ok(r.s === 303 && inv && r.h.get('location') === '/' && (r.h.getSetCookie?.() || []).join(' ').includes('Secure'),
    `le lien d'invitation : 303, le cookie du portail revient au navigateur (${r.s})`);
  r = await C('/api/auth/me', { headers: { cookie: `sr_invitation=${inv}; CF_Authorization=abc.def.ghi; autre=1` } });
  vu = vus.at(-1).entetes;
  ok(r.d.invitation === 'invitation' && vu.cookie === `sr_invitation=${inv}`,
    `vers le portail : les cookies du portail seulement, jamais CF_Authorization (${vu.cookie})`);
  const avec = (c) => ({ cookie: c, 'content-type': 'application/json', origin: PAGE, 'sec-fetch-site': 'same-origin' });
  r = await C('/api/auth/enter', { method: 'POST', body: Buffer.from('{"name":"nico007"}'), headers: avec(`sr_invitation=${inv}`) });
  ok(r.s === 403, `code : nico007 avec le code d'invitation → 403 (${r.s} ${r.d.error})`);
  r = await C('/api/auth/enter', { method: 'POST', body: Buffer.from('{"name":"su007"}'), headers: avec(`sr_invitation=${inv}`) });
  const ses = posee(r.h, 'sr_session');
  ok(r.s === 200 && r.d.state === 'active' && ses, `code : su007, créé d'avance par Cal, entre aussitôt (${r.s} ${r.d.state})`);
  const su = `sr_invitation=${inv}; sr_session=${ses}`;
  r = await C('/api/library', { headers: { cookie: su } });
  ok(r.s === 200 && Array.isArray(r.d.items), `su007 : la bibliothèque (${r.s})`);
  r = await C('/api/admin/state', { headers: { cookie: su } });
  ok(r.s === 403, `su007 : pas l'admin (${r.s})`);
  r = await C('/api/auth/enter', { method: 'POST', body: Buffer.from('{"name":"Margaux2"}'), headers: avec(`sr_invitation=${inv}`) });
  ok(r.s === 200 && r.d.state === 'pending', `code : un pseudo neuf attend Cal (${r.s} ${r.d.state})`);
  r = await C('/api/library/upload?name=x.png', { method: 'PUT', body: png, headers: { cookie: su, 'content-type': 'image/png', origin: 'https://evil.example' } });
  ok(r.s === 403, `code : une écriture venue d'une autre page → 403 (${r.s})`);
  r = await C('/pont/dgx2/etat', { headers: { cookie: su } });
  ok(r.s === 403, `code : les ponts ne s'ouvrent pas à une session à code (${r.s})`);

  // pseudo seul : un jeton Access, même vrai (le cookie d'une ancienne session, ou l'en-tête), ne compte pour rien
  const calJ = await jeton('cal@e2e.test');
  r = await C('/api/porte/moi', { jwt: calJ, headers: { cookie: `CF_Authorization=${calJ}` } });
  ok(r.d.porte === 'code' && !r.d.email, `code : le vrai jeton Access de Cal ne compte pas (${JSON.stringify(r.d)})`);
  r = await C('/api/admin/state', { jwt: calJ, headers: { cookie: `CF_Authorization=${calJ}` } });
  ok(r.s === 401, `… sans session du portail, pas d'admin (${r.s})`);
  r = await C('/api/auth/me', { jwt: calJ, headers: { cookie: su } });
  vu = vus.at(-1).entetes;
  ok(r.d.porte === 'code' && vu['x-porte-role'] === 'code' && !vu['cf-access-jwt-assertion'],
    `… et il ne part jamais vers le portail (${vu['x-porte-role']})`);
  const calCode = await C(`/invitation/${codes.admin}`);
  const admCk = posee(calCode.h, 'sr_invitation');
  r = await C('/api/auth/enter', { method: 'POST', body: Buffer.from('{"name":"nico007"}'), headers: avec(`sr_invitation=${admCk}`) });
  const calSes = posee(r.h, 'sr_session');
  ok(r.s === 200 && r.d.user?.role === 'admin' && calSes, `code : Cal, le lien du code admin puis nico007 → admin (${r.s})`);
  r = await C('/api/admin/state', { headers: { cookie: `sr_session=${calSes}` } });
  ok(r.s === 200 && r.d.me?.id === 'cal', `… la page d'admin, par sa seule session ensuite (${r.s})`);
  r = await C('/api/library/upload?name=code.png&title=Par%20le%20code', { method: 'PUT', body: png,
    headers: { cookie: `sr_session=${calSes}`, 'content-type': 'image/png', origin: PAGE, 'sec-fetch-site': 'same-origin' } });
  ok(r.s === 200 && r.d.owner === 'cal', `code : un dépôt de Cal par la porte, à Cal (${r.s})`);
  r = await C(`/library/${r.d.id}/main.png`, { headers: { cookie: su, range: 'bytes=0-3' } });
  ok(r.s === 206 && r.d.length === 4, `su007 : le fichier, jugé par le portail (pas R2 : le Worker ne sait pas qui), Range (${r.s})`);

  // les essais de code et de pseudo, limités par adresse (ESSAIS)
  const cles_ = [];
  const bride2 = { ...envC, ESSAIS: { limit: async ({ key }) => { cles_.push(key); return { success: false }; } } };
  r = await C('/invitation/AAAA-BBBB-CCCC', { e: bride2 });
  ok(r.s === 429 && cles_.at(-1) === IP, `ESSAIS atteint : un code → 429, compté par adresse (${r.s} ${cles_.at(-1)})`);
  r = await C('/api/auth/enter', { e: bride2, method: 'POST', body: Buffer.from('{"name":"x"}'), headers: avec(`sr_invitation=${inv}`) });
  ok(r.s === 429, `… un pseudo tapé aussi (${r.s})`);
  n0 = cles_.length;
  r = await C('/invitation/', { e: bride2 });
  ok(r.s === 200 && cles_.length === n0, `… la page d'invitation seule n'est pas un essai (${r.s})`);
  r = await W('/api/library', { jwt: null });
  ok(r.s === 403, `le Worker en mode « access » : sans jeton, toujours 403 (${r.s})`);
}

await Promise.allSettled(attente);
certs.close();
console.log(`\n${passes} passés, ${echecs.length} en échec`);
process.exit(echecs.length ? 1 : 0);
