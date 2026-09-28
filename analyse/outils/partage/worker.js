// Le dépôt partagé de Movie Analysis, sur Cloudflare : les corrections de chaque film (noms, fusions, répliques, qui dit
// quoi) et la liste des projets, lisibles et modifiables depuis n'importe quel ordinateur, sans jeton dans le
// navigateur — et « Publier sur GitHub » fait ici, avec un jeton gardé par le service (secret GITHUB_TOKEN).
//
//   GET  /corrections/<nom>.json      → le document (ou {})
//   PUT  /corrections/<nom>.json      → l'enregistre ; l'ancienne version reste 30 jours (hist:<nom>:<date>)
//   POST /publier/<film>              → corps = les corrections : enregistrées ici, puis commitées dans
//                                       analyses/<film>/corrections.json (dépôt DEPOT, branche BRANCHE)
//   GET  /historique/<nom>            → les versions gardées (dates), pour revenir en arrière
//   GET  /video/<film>/<chemin>       → une vidéo ou une piste de son du bucket R2 VIDEOS (clé <film>/<chemin>, le
//                                       chemin qu'elle a sous analyses/<film>/), avec les requêtes Range : sans elles
//                                       le navigateur ne peut ni lire en continu ni sauter dans la vidéo
//   GET  /videos                      → ce que le bucket contient (clé, taille, md5) : outils/partage/videos.mjs
//                                       n'envoie que ce qui a changé
//
// Remplace le service de dgx1 (skill/corrections-serveur.mjs, mêmes chemins) : il n'a plus besoin d'être allumé.
// Seules les pages du site (et le poste, en local) peuvent écrire ; les vidéos, publiques, se lisent de partout.
const ORIGINES = [/^https:\/\/calculment0r\.github\.io$/, /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/];
const NOM = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TAILLE_MAX = 1 << 20;
const GARDE_S = 30 * 24 * 3600;

const entetes = (req) => ({
  'access-control-allow-origin': req.headers.get('origin') || '*',
  'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
  'access-control-allow-headers': 'content-type, range',
  'access-control-max-age': '86400',
  'vary': 'origin',
  'cache-control': 'no-store',
});
const rep = (req, corps, statut = 200) => new Response(typeof corps === 'string' ? corps : JSON.stringify(corps),
  { status: statut, headers: { ...entetes(req), 'content-type': 'application/json; charset=utf-8' } });
const peutEcrire = (req) => ORIGINES.some((o) => o.test(req.headers.get('origin') || ''));

async function lisJson(req) {
  const texte = await req.text();
  if (texte.length > TAILLE_MAX) throw new Error('document trop gros');
  const doc = JSON.parse(texte);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('un objet JSON est attendu');
  return JSON.stringify(doc, null, 2);
}

async function enregistre(env, nom, texte) {
  const avant = await env.PARTAGE.get('doc:' + nom);
  if (avant !== null && avant !== texte) await env.PARTAGE.put(`hist:${nom}:${new Date().toISOString()}`, avant, { expirationTtl: GARDE_S });
  await env.PARTAGE.put('doc:' + nom, texte);
}

const base64 = (texte) => {
  const o = new TextEncoder().encode(texte); let b = '';
  for (let i = 0; i < o.length; i += 0x8000) b += String.fromCharCode(...o.subarray(i, i + 0x8000));
  return btoa(b);
};

async function publie(env, film, texte) {
  if (!env.GITHUB_TOKEN) return { ok: false, statut: 503, erreur: 'le service n’a pas encore de jeton GitHub (npx wrangler secret put GITHUB_TOKEN, dans outils/partage)' };
  const chemin = `analyses/${film}/corrections.json`;
  const gh = (url, init = {}) => fetch('https://api.github.com/' + url, { ...init, headers: {
    authorization: 'Bearer ' + env.GITHUB_TOKEN, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28',
    'user-agent': 'movie-analysis-partage', ...(init.headers || {}) } });
  const vu = await gh(`repos/${env.DEPOT}/contents/${chemin}?ref=${encodeURIComponent(env.BRANCHE)}`);
  if (vu.status === 401 || vu.status === 403) return { ok: false, statut: 502, erreur: `GitHub refuse le jeton du service (${vu.status}) : portée « Contents: Read and write » sur ${env.DEPOT}` };
  const sha = vu.status === 200 ? (await vu.json()).sha : undefined;
  const r = await gh(`repos/${env.DEPOT}/contents/${chemin}`, { method: 'PUT', body: JSON.stringify({
    message: `corrections : ${film} (depuis le Studio)`, content: base64(texte + '\n'), branch: env.BRANCHE, ...(sha ? { sha } : {}) }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, statut: 502, erreur: `GitHub : ${r.status} ${d.message || ''}`.trim() };
  return { ok: true, commit: d.commit && d.commit.html_url };
}

// Les vidéos : une clé <film>/<chemin> (dossiers et noms simples, pas de « .. »), des types connus.
const CLE_VIDEO = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/(?:[A-Za-z0-9][A-Za-z0-9_.-]*\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.(mp4|m4a|webm|mp3|wav)$/;
const TYPES = { mp4: 'video/mp4', m4a: 'audio/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav' };
const entetesVideo = (obj, cle) => {
  const h = new Headers();
  obj.writeHttpMetadata(h);
  if (!h.has('content-type')) h.set('content-type', TYPES[cle.split('.').pop()]);
  h.set('etag', obj.httpEtag);
  h.set('last-modified', obj.uploaded.toUTCString());
  h.set('accept-ranges', 'bytes');
  h.set('access-control-allow-origin', '*');
  h.set('access-control-expose-headers', 'content-length, content-range, accept-ranges, etag');
  h.set('cache-control', 'public, max-age=3600');
  return h;
};

// La plage demandée (Range: bytes=a-b, a-, -n), bornée au fichier : { debut, long }, 'hors' si elle n'y tombe pas,
// null si l'en-tête manque ou n'est pas une plage simple (HTTP permet alors de rendre le fichier entier).
function plage(entete, taille) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((entete || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') { const n = Math.min(+m[2], taille); return n > 0 ? { debut: taille - n, long: n } : 'hors'; }
  const debut = +m[1], fin = m[2] === '' ? taille - 1 : Math.min(+m[2], taille - 1);
  return debut < taille && fin >= debut ? { debut, long: fin - debut + 1 } : 'hors';
}

async function video(req, env, cle) {
  const absent = () => new Response(null, { status: 404, headers: { 'access-control-allow-origin': '*' } });
  const tete = await env.VIDEOS.head(cle);
  if (!tete) return absent();
  const h = entetesVideo(tete, cle);
  // une condition (If-None-Match) qui dit « déjà là » : 304, sans corps
  const inm = req.headers.get('if-none-match');
  if (inm && inm.split(',').some((e) => e.trim().replace(/^W\//, '') === tete.httpEtag)) return new Response(null, { status: 304, headers: h });
  // If-Range : la plage ne vaut que pour la même version du fichier
  const ir = req.headers.get('if-range');
  const p = ir && ir !== tete.httpEtag ? null : plage(req.headers.get('range'), tete.size);
  if (p === 'hors') { h.set('content-range', `bytes */${tete.size}`); return new Response(null, { status: 416, headers: h }); }
  if (req.method === 'HEAD') { h.set('content-length', String(tete.size)); return new Response(null, { headers: h }); }
  const o = await env.VIDEOS.get(cle, p ? { range: { offset: p.debut, length: p.long } } : {});
  if (!o) return absent();
  if (!p) { h.set('content-length', String(o.size)); return new Response(o.body, { headers: h }); }
  h.set('content-range', `bytes ${p.debut}-${p.debut + p.long - 1}/${o.size}`);
  h.set('content-length', String(p.long));
  return new Response(o.body, { status: 206, headers: h });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: entetes(req) });
    let m;
    if ((m = url.pathname.match(/^\/video\/(.+)$/)) && (req.method === 'GET' || req.method === 'HEAD')) {
      let cle; try { cle = decodeURIComponent(m[1]); } catch (e) { cle = ''; }
      if (!CLE_VIDEO.test(cle)) return new Response(null, { status: 404, headers: { 'access-control-allow-origin': '*' } });
      return video(req, env, cle);
    }
    if (url.pathname === '/videos' && req.method === 'GET') {
      const fichiers = [];
      let curseur;
      do {
        const l = await env.VIDEOS.list({ cursor: curseur, limit: 1000 });
        for (const o of l.objects) fichiers.push({ cle: o.key, taille: o.size, md5: o.etag });
        curseur = l.truncated ? l.cursor : undefined;
      } while (curseur);
      return rep(req, { fichiers });
    }
    if ((m = url.pathname.match(/^\/corrections\/([^/]+)\.json$/)) && NOM.test(m[1])) {
      const nom = m[1];
      if (req.method === 'GET') return rep(req, (await env.PARTAGE.get('doc:' + nom)) || '{}');
      if (req.method === 'PUT') {
        if (!peutEcrire(req)) return rep(req, { ok: false, erreur: 'origine non autorisée' }, 403);
        try { await enregistre(env, nom, await lisJson(req)); } catch (e) { return rep(req, { ok: false, erreur: e.message }, 400); }
        return rep(req, { ok: true });
      }
    }
    if ((m = url.pathname.match(/^\/publier\/([^/]+)$/)) && NOM.test(m[1]) && req.method === 'POST') {
      if (!peutEcrire(req)) return rep(req, { ok: false, erreur: 'origine non autorisée' }, 403);
      let texte;
      try { texte = await lisJson(req); } catch (e) { return rep(req, { ok: false, erreur: e.message }, 400); }
      await enregistre(env, m[1], texte);
      const r = await publie(env, m[1], texte);
      return rep(req, r, r.ok ? 200 : r.statut);
    }
    // le jeton GitHub du service marche-t-il ? lecture seule : rien n'est écrit dans le dépôt
    if (url.pathname === '/verifier' && req.method === 'GET') {
      if (!env.GITHUB_TOKEN) return rep(req, { jeton: false });
      const r = await fetch(`https://api.github.com/repos/${env.DEPOT}`, { headers: {
        authorization: 'Bearer ' + env.GITHUB_TOKEN, accept: 'application/vnd.github+json', 'user-agent': 'movie-analysis-partage' } });
      const d = await r.json().catch(() => ({}));
      return rep(req, { jeton: true, depot: env.DEPOT, branche: env.BRANCHE, github: r.status, lecture: r.ok, ecriture: !!(d.permissions && d.permissions.push) });
    }
    if ((m = url.pathname.match(/^\/historique\/([^/]+)$/)) && NOM.test(m[1]) && req.method === 'GET') {
      const l = await env.PARTAGE.list({ prefix: `hist:${m[1]}:` });
      return rep(req, { versions: l.keys.map((k) => k.name.slice(`hist:${m[1]}:`.length)) });
    }
    return rep(req, { ok: false, erreur: 'inconnu' }, 404);
  },
};
