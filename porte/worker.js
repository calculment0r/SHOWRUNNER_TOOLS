// La porte d'entrée de Showrunner Tools, sur Cloudflare. SQUELETTE, NON DÉPLOYÉ : l'étude qui le justifie est
// docs/etudes/cloudflare.md (28/09/2026). Rien ici n'est encore relié à un compte, un tunnel ou un bucket.
//
// Deux déploiements du même fichier :
//   wrangler.jsonc          → « showrunner »        https://showrunner.luxigone.workers.dev   (le portail)
//   wrangler.studio.jsonc   → « character-factory » https://character-factory.luxigone.workers.dev (le studio de DGX1)
//
// Devant chaque requête, Cloudflare Access (application self-hosted sur le nom d'hôte workers.dev) a déjà demandé
// l'e-mail. Ce Worker ne le croit pas sur parole : il revérifie le jeton (JWT RS256, clés de l'équipe, aud, iss, exp),
// décide du rôle (admin : les e-mails du secret ADMINS ; ami : les autres), puis :
//
//   GET  /api/porte/moi                 → { email, role } : qui je suis pour la porte
//   GET  /api/porte/etat                → les deux DGX : joignables, prêtes (le détail pour un admin seulement)
//   *    /api/*                         → le portail de DGX2 (Workers VPC → tunnel sortant → 127.0.0.1:9790)
//   GET  /library/<id>/<fichier>        → R2 d'abord (Range ; droit lu dans item.json : owner, shared), sinon DGX2
//   *    /pont/<dgx1|dgx2>/<action>     → le pont de la machine (état, préparer, libérer) ; il décide seul des droits
//   *    /agents/*                      → réservé (étude § 6)
//   le reste                            → les pages du portail (assets statiques : le dépôt, sans server/ ni docs/)
//
// En mode studio (MODE = "studio"), tout chemin va au studio de DGX1 tel quel : ses pages y demandent /api/…, /files/…
//
// Vers les DGX, l'identité part signée : x-porte-qui, x-porte-role, x-porte-quand, x-porte-sig =
// HMAC-SHA256(PORTE_CLE, qui \n role \n quand \n méthode \n chemin?requête). Les DGX n'écoutent la porte que sur
// 127.0.0.1 (port de la maison + 1000) et refusent toute requête qui n'est pas signée ainsi : un tunnel rapide, un
// processus voisin ou une erreur de réglage ne donnent rien. La vérification côté DGX (bibliothèque standard) est dans
// l'étude, § 3.
//
// Secrets (npx wrangler secret put …, jamais dans ce dépôt, qui est public) : PORTE_CLE, ADMINS.

const VERSION = 'squelette du 28/09/2026';
const ENC = new TextEncoder();
const DEC = new TextDecoder();
const SANS_CORPS = new Set(['GET', 'HEAD']);

// Ce qui passe de la page aux DGX, et rien d'autre : ni cookie (CF_Authorization), ni en-tête Cf-*, ni x-porte-*
// forgé par la page. Une liste de ce qui passe plutôt qu'une liste de ce qui ne passe pas : juste par construction.
// Content-Length n'y est pas : le FixedLengthStream du corps le donne lui-même (corpsDeLongueurFixe).
const EN_TETES_TRANSMIS = new Set([
  'accept', 'accept-language', 'content-type', 'range', 'if-range',
  'if-none-match', 'if-modified-since', 'x-filename',
]);

// L'hôte de l'URL ne sert qu'à l'en-tête Host : c'est le service VPC qui décide où va la requête
// (https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/).
const HOTE = {
  PORTAIL: 'http://portail', STUDIO: 'http://studio', PONT_DGX1: 'http://pont-dgx1', PONT_DGX2: 'http://pont-dgx2',
};

// ── petites aides ────────────────────────────────────────────────────────────────────────────────────────────────
// Le portail rend ses erreurs en { error } : commun/shell.js les affiche telles quelles.
const json = (corps, statut = 200) => new Response(JSON.stringify(corps), {
  status: statut, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const erreur = (statut, message, plus = {}) => json({ error: message, ...plus }, statut);

const b64u = (s) => Uint8Array.from(
  atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((o) => o.toString(16).padStart(2, '0')).join('');

function cookie(req, nom) {
  for (const morceau of (req.headers.get('cookie') || '').split(';')) {
    const i = morceau.indexOf('=');
    if (i > 0 && morceau.slice(0, i).trim() === nom) return morceau.slice(i + 1).trim();
  }
  return '';
}

// ── le jeton Access ──────────────────────────────────────────────────────────────────────────────────────────────
// https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
// Les clés publiques de l'équipe, gardées d'une requête à l'autre (ce n'est pas un état de requête). Cloudflare en
// change toutes les 6 semaines : un kid inconnu fait relire la liste, au plus une fois par minute.
const cles = { lu: 0, essai: 0, parKid: new Map() };

async function lisCles(env) {
  const r = await fetch(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`certs Access : ${r.status}`);
  const { keys = [] } = await r.json();
  const parKid = new Map();
  for (const k of keys) {
    if (k.kty !== 'RSA' || !k.kid) continue;
    parKid.set(k.kid, await crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  cles.parKid = parKid;
  cles.lu = Date.now();
}

async function cle(env, kid) {
  const perimee = Date.now() - cles.lu > 3600e3;
  if (perimee || (!cles.parKid.has(kid) && Date.now() - cles.essai > 60e3)) {
    cles.essai = Date.now();
    await lisCles(env);
  }
  return cles.parKid.get(kid) || null;
}

// L'e-mail du jeton, ou null. Contrôles de la documentation : signature RS256, iss = le domaine de l'équipe,
// aud = le tag AUD de l'application, exp non dépassé.
async function verifieJeton(jeton, env) {
  const [t, c, s] = jeton.split('.');
  if (!t || !c || !s) return null;
  let tete;
  let corps;
  try {
    tete = JSON.parse(DEC.decode(b64u(t)));
    corps = JSON.parse(DEC.decode(b64u(c)));
  } catch {
    return null;
  }
  if (tete.alg !== 'RS256' || typeof tete.kid !== 'string') return null;
  const k = await cle(env, tete.kid);
  if (!k) return null;
  let bon = false;
  try {
    bon = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', k, b64u(s), ENC.encode(`${t}.${c}`));
  } catch {
    return null;
  }
  if (!bon) return null;
  const maintenant = Date.now() / 1000;
  const aud = [].concat(corps.aud || []);
  if (corps.iss !== env.TEAM_DOMAIN || !aud.includes(env.POLICY_AUD)) return null;
  if (!(corps.exp > maintenant)) return null;
  return typeof corps.email === 'string' && corps.email ? corps.email.toLowerCase() : null;
}

// Qui demande : { email, role } ou null. Le jeton vient de l'en-tête Cf-Access-Jwt-Assertion (préféré par la
// documentation), sinon du cookie CF_Authorization. ctx.access n'est pas utilisé : un Worker à assets statiques ne le
// reçoit pas (https://developers.cloudflare.com/workers/configuration/cloudflare-access/, « ctx.access limitations »).
async function qui(req, env) {
  const jeton = req.headers.get('cf-access-jwt-assertion') || cookie(req, 'CF_Authorization');
  if (!jeton) return null;
  const email = await verifieJeton(jeton, env);
  if (!email) return null;
  const admins = String(env.ADMINS || '').toLowerCase().split(',').map((a) => a.trim()).filter(Boolean);
  return { email, role: admins.includes(email) ? 'admin' : 'ami' };
}

// Une requête qui écrit doit venir d'une page de cette adresse (audit H3 : pas de formulaire piégé ailleurs).
function memeOrigine(req, url) {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origine = req.headers.get('origin');
  return !origine || origine === url.origin;
}

// ── vers les DGX ─────────────────────────────────────────────────────────────────────────────────────────────────
async function signe(env, id, methode, cheminEtRequete) {
  if (!env.PORTE_CLE) throw new Error('la porte n’a pas sa clé (npx wrangler secret put PORTE_CLE)');
  const quand = String(Math.floor(Date.now() / 1000));
  const k = await crypto.subtle.importKey('raw', ENC.encode(env.PORTE_CLE), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, ENC.encode([id.email, id.role, quand, methode, cheminEtRequete].join('\n')));
  return { 'x-porte-qui': id.email, 'x-porte-role': id.role, 'x-porte-quand': quand, 'x-porte-sig': hex(sig) };
}

// Les serveurs des DGX (http.server de Python) lisent Content-Length et ne décodent pas le « chunked » : un corps de
// flux quelconque partirait en chunked (https://developers.cloudflare.com/workers/runtime-apis/request/). On le
// repasse donc dans un FixedLengthStream de la longueur annoncée ; sans longueur annoncée, on refuse (411).
function corpsDeLongueurFixe(req, ctx) {
  if (SANS_CORPS.has(req.method) || !req.body) return undefined;
  const n = Number(req.headers.get('content-length'));
  if (!Number.isSafeInteger(n) || n < 0) return null;
  const { readable, writable } = new FixedLengthStream(n);
  ctx.waitUntil(req.body.pipeTo(writable).catch(() => {}));
  return readable;
}

// La réponse du service, ou null s'il est injoignable (machine éteinte, tunnel coupé, service arrêté).
// https://developers.cloudflare.com/workers-vpc/reference/troubleshooting/ liste les causes.
async function joins(req, env, ctx, nom, id, chemin, { delai } = {}) {
  const service = env[nom];
  if (!service) throw new Error(`pas de liaison ${nom} (wrangler.jsonc, vpc_services)`);
  const cible = new URL(chemin + new URL(req.url).search, HOTE[nom]);
  const corps = corpsDeLongueurFixe(req, ctx);
  if (corps === null) return erreur(411, 'longueur du corps inconnue');
  const h = new Headers();
  for (const [k, v] of req.headers) if (EN_TETES_TRANSMIS.has(k)) h.set(k, v);
  for (const [k, v] of Object.entries(await signe(env, id, req.method, cible.pathname + cible.search))) h.set(k, v);
  try {
    return await service.fetch(cible, {
      method: req.method, headers: h, body: corps, redirect: 'manual',
      signal: delai ? AbortSignal.timeout(delai) : undefined,
    });
  } catch (e) {
    console.log(JSON.stringify({ evenement: 'injoignable', service: nom, chemin, raison: String((e && e.message) || e) }));
    return null;
  }
}

// La réponse du DGX telle quelle, en flux (ni texte ni JSON relu ici : pas de limite de taille, pas de mémoire).
function rends(r) {
  const h = new Headers(r.headers);
  h.delete('server');
  if (!h.has('cache-control')) h.set('cache-control', 'no-store');
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}

const PAGE_ENDORMIE = (env) => `<!doctype html>
<html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Character Factory · machines</title>
<main style="max-width:40rem;margin:4rem auto;padding:0 16px;font:16px/1.6 system-ui,sans-serif">
<h1>Les machines dorment</h1>
<p>Le studio tourne sur les DGX de Cal ; elles sont éteintes ou injoignables pour le moment.
Tes personnages importés restent visibles dans la bibliothèque du portail.</p>
${env.PORTAIL_URL ? `<p><a href="${env.PORTAIL_URL}">Le portail</a></p>` : ''}
</main></html>`;

async function relaie(req, env, ctx, nom, id, chemin) {
  const r = await joins(req, env, ctx, nom, id, chemin);
  if (r) return rends(r);
  const page = req.method === 'GET' && (req.headers.get('accept') || '').includes('text/html');
  if (page) return new Response(PAGE_ENDORMIE(env), { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  return erreur(503, 'les machines dorment : ce qui se calcule attendra qu’elles se réveillent', { machines: false });
}

// ── l'état des machines ──────────────────────────────────────────────────────────────────────────────────────────
// Le pont de chaque DGX dit ce qui tourne ; un pont qui ne répond pas, c'est une machine qu'on ne joint pas.
// Un ami voit « joignable / prête » ; un admin voit aussi le détail (services, mémoire, modèles chargés).
async function etat(req, env, ctx, id) {
  const sonde = async (nom) => {
    if (!env[nom]) return { joignable: false };
    const get = new Request(req.url, { method: 'GET', headers: { accept: 'application/json' } });
    const r = await joins(get, env, ctx, nom, id, '/pont/etat', { delai: 3000 });
    if (!r || !r.ok) return { joignable: false };
    const d = await r.json().catch(() => ({}));
    return id.role === 'admin' ? { joignable: true, pret: !!d.ready, detail: d } : { joignable: true, pret: !!d.ready };
  };
  const [dgx1, dgx2] = await Promise.all([sonde('PONT_DGX1'), sonde('PONT_DGX2')]);
  return json({ at: new Date().toISOString(), dgx1, dgx2 });
}

// ── la bibliothèque dans R2 ──────────────────────────────────────────────────────────────────────────────────────
// Le DGX recopie chaque objet de la bibliothèque dans R2 sous la même clé qu'ici : library/<id>/<fichier>, avec son
// item.json, qui porte owner (l'e-mail) et shared (vu par tous). La page garde ses adresses relatives.
const ID_OBJET = /^[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}$/;
const FICHIER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/;
const TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm',
  mov: 'video/quicktime', wav: 'audio/wav', mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', ogg: 'audio/ogg',
  glb: 'model/gltf-binary', json: 'application/json',
};

// true : il peut voir ; false : non ; null : l'objet n'est pas (encore) publié dans R2.
async function peutVoir(env, id, objet) {
  const fiche = await env.BIBLIO.get(`library/${objet}/item.json`);
  if (!fiche) return null;
  if (id.role === 'admin') return true;
  const it = await fiche.json().catch(() => null);
  return !!it && (it.owner === id.email || it.shared === true);
}

// La plage demandée, bornée au fichier : { debut, long }, 'hors', ou null (reprise de movie-analysis-partage).
function plage(entete, taille) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((entete || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') { const n = Math.min(+m[2], taille); return n > 0 ? { debut: taille - n, long: n } : 'hors'; }
  const debut = +m[1];
  const fin = m[2] === '' ? taille - 1 : Math.min(+m[2], taille - 1);
  return debut < taille && fin >= debut ? { debut, long: fin - debut + 1 } : 'hors';
}

async function depuisR2(req, env, cle) {
  const tete = await env.BIBLIO.head(cle);
  if (!tete) return null;
  const h = new Headers();
  tete.writeHttpMetadata(h);
  if (!h.has('content-type')) h.set('content-type', TYPES[cle.split('.').pop().toLowerCase()] || 'application/octet-stream');
  h.set('etag', tete.httpEtag);
  h.set('accept-ranges', 'bytes');
  h.set('cache-control', 'private, max-age=3600');
  const inm = req.headers.get('if-none-match');
  if (inm && inm.split(',').some((e) => e.trim().replace(/^W\//, '') === tete.httpEtag)) return new Response(null, { status: 304, headers: h });
  const ir = req.headers.get('if-range');
  const p = ir && ir !== tete.httpEtag ? null : plage(req.headers.get('range'), tete.size);
  if (p === 'hors') { h.set('content-range', `bytes */${tete.size}`); return new Response(null, { status: 416, headers: h }); }
  if (req.method === 'HEAD') { h.set('content-length', String(tete.size)); return new Response(null, { headers: h }); }
  const o = await env.BIBLIO.get(cle, p ? { range: { offset: p.debut, length: p.long } } : {});
  if (!o) return null;
  if (!p) { h.set('content-length', String(o.size)); return new Response(o.body, { headers: h }); }
  h.set('content-range', `bytes ${p.debut}-${p.debut + p.long - 1}/${o.size}`);
  h.set('content-length', String(p.long));
  return new Response(o.body, { status: 206, headers: h });
}

async function bibliotheque(req, env, ctx, id, chemin) {
  if (!SANS_CORPS.has(req.method)) return erreur(405, 'lecture seule');
  const [, , objet, fichier, ...reste] = chemin.split('/');
  if (reste.length || !ID_OBJET.test(objet || '') || !FICHIER.test(fichier || '')) return erreur(404, 'introuvable');
  if (env.BIBLIO) {
    const droit = await peutVoir(env, id, objet);
    if (droit === false) return erreur(404, 'introuvable');   // on ne dit pas qu'il existe
    if (droit === true) {
      const r = await depuisR2(req, env, `library/${objet}/${fichier}`);
      if (r) return r;
    }
  }
  // Pas encore dans R2 : le DGX le sert, et juge lui-même le droit (identité signée).
  return relaie(req, env, ctx, 'PORTAIL', id, chemin);
}

// DGX éteintes : la liste de la bibliothèque vient du dernier index publié par DGX2 dans R2 (library/index.json,
// les objets tels que library.public() les rend, avec owner et shared), filtrée pour l'appelant.
async function listeHorsLigne(env, id, url) {
  const o = env.BIBLIO ? await env.BIBLIO.get('library/index.json') : null;
  if (!o) return erreur(503, 'les machines dorment, et la bibliothèque n’est pas encore publiée', { machines: false });
  const index = await o.json().catch(() => ({ items: [] }));
  const sortes = (url.searchParams.get('kind') || '').split(',').filter(Boolean);
  const items = (index.items || []).filter((it) => (id.role === 'admin' || it.owner === id.email || it.shared === true)
    && (!sortes.length || sortes.includes(it.kind)));
  const counts = {};
  for (const it of items) counts[it.kind] = (counts[it.kind] || 0) + 1;
  return json({ items, total: items.length, counts, folders: [], hors_ligne: true, publie: index.at || null });
}

// ── l'entrée ─────────────────────────────────────────────────────────────────────────────────────────────────────
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const chemin = url.pathname;
    let id;
    try {
      id = await qui(req, env);
    } catch (e) {
      console.log(JSON.stringify({ evenement: 'certs', raison: String((e && e.message) || e) }));
      return erreur(503, 'la porte ne peut pas vérifier les jetons pour le moment');
    }
    if (!id) return erreur(403, 'passe par la porte : cette adresse demande la connexion Cloudflare Access');
    if (!SANS_CORPS.has(req.method) && !memeOrigine(req, url)) return erreur(403, 'requête venue d’une autre page : refusée');
    // Limite de débit par personne sur ce qui écrit (audit H4) ; le quota de GPU, lui, est tenu par la file des DGX.
    if (env.LIMITE && !SANS_CORPS.has(req.method)) {
      const { success } = await env.LIMITE.limit({ key: id.email });
      if (!success) return erreur(429, 'trop de demandes d’un coup : attends une minute');
    }

    try {
      if (env.MODE === 'studio') return await relaie(req, env, ctx, 'STUDIO', id, chemin);

      if (chemin === '/api/porte/moi') return json({ email: id.email, role: id.role, version: VERSION });
      if (chemin === '/api/porte/etat') return await etat(req, env, ctx, id);
      if (chemin.startsWith('/library/')) return await bibliotheque(req, env, ctx, id, chemin);
      const pont = chemin.match(/^\/pont\/(dgx1|dgx2)\/(etat|preparer|liberer)$/);
      if (pont) return await relaie(req, env, ctx, pont[1] === 'dgx1' ? 'PONT_DGX1' : 'PONT_DGX2', id, `/pont/${pont[2]}`);
      if (chemin.startsWith('/agents/')) return erreur(501, 'les agents viendront plus tard (docs/etudes/cloudflare.md, § 6)');
      if (chemin.startsWith('/api/')) {
        const r = await joins(req, env, ctx, 'PORTAIL', id, chemin);
        if (r) return rends(r);
        if (req.method === 'GET' && chemin === '/api/library') return await listeHorsLigne(env, id, url);
        return erreur(503, 'les machines dorment : ce qui se calcule attendra qu’elles se réveillent', { machines: false });
      }
      // Les pages passent par les assets sans entrer ici (run_worker_first) ; au cas où :
      return env.ASSETS ? env.ASSETS.fetch(req) : erreur(404, 'introuvable');
    } catch (e) {
      console.log(JSON.stringify({ evenement: 'erreur', chemin, raison: String((e && e.message) || e) }));
      return erreur(500, id.role === 'admin' ? `la porte : ${String((e && e.message) || e)}` : 'la porte a trébuché');
    }
  },
};
