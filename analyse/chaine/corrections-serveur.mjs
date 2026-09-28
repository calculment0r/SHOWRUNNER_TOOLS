#!/usr/bin/env node
/**
 * Le dépôt des corrections — pour que la page EN LIGNE sache écrire.
 *
 *   node corrections-serveur.mjs [dossier] [port]
 *
 * Un hébergement statique n'écrit rien, et mettre un jeton GitHub dans la page
 * reviendrait à donner le droit d'écriture sur le dépôt à quiconque a le lien :
 * une page servie est téléchargée par le navigateur, son contenu est lisible.
 * Ce petit service tient donc les corrections, et la page l'appelle.
 *
 *   GET  /<film>.json   ce qui est enregistré pour ce film (objet vide sinon)
 *   PUT  /<film>.json   enregistre — le corps doit être du JSON valide
 *
 * Publié en HTTPS par Tailscale, il est joignable depuis la page en ligne sans
 * que personne ait de jeton à coller :
 *
 *   tailscale serve --bg --https=443 --set-path=/corrections http://127.0.0.1:8447
 *
 * Ce qu'il accepte est volontairement étroit : un nom de film sans chemin, du
 * JSON, 2 Mo au plus. Il ne sert rien d'autre et ne lit rien d'autre.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DOSSIER = process.argv[2] ?? join(process.env.HOME ?? '.', 'reelbench', 'corrections');
const PORT = Number(process.argv[3] ?? 8447);
mkdirSync(DOSSIER, { recursive: true });

const ENTETES = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,PUT,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
};

createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, ENTETES).end(); return; }

  // « /corrections/getaround.json » comme « /getaround.json » : on ne garde que le
  // dernier segment, et il doit être un nom de film — pas un chemin.
  const dernier = decodeURIComponent(req.url.split('?')[0]).split('/').filter(Boolean).pop() ?? '';
  const m = /^([a-z0-9][a-z0-9_-]{0,63})\.json$/i.exec(dernier);
  if (!m) { res.writeHead(400, ENTETES).end('nom attendu : <film>.json'); return; }
  const fichier = join(DOSSIER, `${m[1]}.json`);

  if (req.method === 'GET') {
    const corps = existsSync(fichier) ? readFileSync(fichier, 'utf8') : '{}';
    res.writeHead(200, { ...ENTETES, 'content-type': 'application/json' }).end(corps);
    return;
  }

  if (req.method === 'PUT') {
    let corps = '';
    req.on('data', (c) => { corps += c; if (corps.length > 2e6) req.destroy(); });
    req.on('end', () => {
      try {
        const o = JSON.parse(corps);
        if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('objet attendu');
        writeFileSync(fichier, JSON.stringify(o, null, 2));
        process.stderr.write(`${new Date().toISOString()}  ${m[1]} — ${Object.keys(o.noms ?? {}).length} nom(s), ${Object.keys(o.fusions ?? {}).length} fusion(s), ${Object.keys(o.repliques ?? {}).length} réplique(s)\n`);
        res.writeHead(200, { ...ENTETES, 'content-type': 'application/json' }).end('{"ok":true}');
      } catch (e) {
        res.writeHead(400, ENTETES).end(String(e.message));
      }
    });
    return;
  }

  res.writeHead(405, ENTETES).end('GET ou PUT');
}).listen(PORT, '127.0.0.1', () => {
  process.stderr.write(`corrections : ${DOSSIER} servi sur http://127.0.0.1:${PORT}\n`);
});
