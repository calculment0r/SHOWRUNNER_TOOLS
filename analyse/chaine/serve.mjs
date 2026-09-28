import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
const ROOT = process.argv[2] ?? '.';
const TYPES = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.json': 'application/json', '.css': 'text/css', '.js': 'text/javascript' };
import { createReadStream } from 'node:fs';
import { writeFileSync } from 'node:fs';

createServer((req, res) => {
  let p = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  // Ecrire corrections.json depuis la page. Sans ca, une correction ne vit que dans le
  // navigateur qui l'a faite : le bouton du trombinoscope ne pouvait que proposer un
  // telechargement, a reposer ensuite dans le dossier a la main. Ici le fichier atterrit
  // a sa place, et il ne reste qu'a le pousser — c'est GitHub qui le garde.
  // Le serveur n'ecoute que sur 127.0.0.1 et n'accepte que ce nom de fichier, nulle part ailleurs.
  if ((req.method === 'PUT' || req.method === 'POST') && basename(p) === 'corrections.json') {
    let corps = '';
    req.on('data', (c) => { corps += c; if (corps.length > 2e6) req.destroy(); });
    req.on('end', () => {
      try {
        JSON.parse(corps);                       // on n'ecrit pas n'importe quoi
        writeFileSync(p, corps);
        process.stderr.write(`corrections ecrites : ${p}
`);
        res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }).end('{"ok":true}');
      } catch (e) {
        res.writeHead(400, { 'access-control-allow-origin': '*' }).end(String(e.message));
      }
    });
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PUT,POST,OPTIONS', 'access-control-allow-headers': 'content-type' }).end();
    return;
  }
  // un dossier sert son index.html, comme GitHub Pages — sinon l'aperçu local ment
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404).end('nope'); return; }
  const size = statSync(p).size;
  const type = TYPES[extname(p)] ?? 'application/octet-stream';
  // CORS ouvert : SceneFlow (port 3000) vient chercher le projet ici via ?project=URL
  // no-cache : un navigateur qui a mémorisé une réponse sans Range croit la vidéo non
  // « seekable » jusqu'à la fin des temps — vu en test, currentTime retombait à 0.
  const base = { 'content-type': type, 'access-control-allow-origin': '*', 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
  // Requêtes partielles : sans elles, le navigateur ne peut pas SAUTER dans une vidéo
  // (currentTime retombe à 0). Indispensable pour cliquer un plan dans la timeline.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }).end(); return; }
    res.writeHead(206, { ...base, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    createReadStream(p, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...base, 'content-length': size });
  createReadStream(p).pipe(res);
}).listen(Number(process.argv[3] ?? 8799), '127.0.0.1');
