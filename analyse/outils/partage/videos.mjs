#!/usr/bin/env node
// Les vidéos et les pistes de son des analyses vers Cloudflare R2 (bucket movie-analysis-videos), que le Worker sert
// en GET /video/<film>/<chemin> — le chemin qu'a le fichier sous analyses/<film>/ (getaround.mp4, son/vo/fond.m4a…).
// N'envoie que ce qui manque ou a changé : le md5 de chaque fichier est comparé à celui que donne GET /videos.
//
//   node outils/partage/videos.mjs [getaround wall …] [--essai]      (--essai : dit ce qu'il enverrait, n'envoie rien)
//
// Il faut une session Cloudflare (npx wrangler login, fait par l'utilisateur) et le Worker déployé avec le bucket.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url)), RACINE = join(ICI, '..', '..');
const SERVICE = 'https://movie-analysis-partage.luxigone.workers.dev';
const BUCKET = 'movie-analysis-videos';
const TYPES = { mp4: 'video/mp4', m4a: 'audio/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav' };
const args = process.argv.slice(2);
const essai = args.includes('--essai');
const films = args.filter((a) => !a.startsWith('--'));

const tous = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tous(join(d, e.name)) : [join(d, e.name)]));
const locaux = [];
for (const film of films.length ? films : readdirSync(join(RACINE, 'analyses'))) {
  const d = join(RACINE, 'analyses', film);
  if (!existsSync(d) || !statSync(d).isDirectory()) { if (films.length) console.log(`${film} : pas de dossier analyses/${film}`); continue; }
  for (const f of tous(d)) {
    const ext = f.split('.').pop().toLowerCase();
    if (TYPES[ext]) locaux.push({ cle: film + '/' + relative(d, f).split('\\').join('/'), f, type: TYPES[ext] });
  }
}

const distants = new Map();
const r = await fetch(SERVICE + '/videos');
if (!r.ok) { console.error(`${SERVICE}/videos : ${r.status} — le Worker est-il déployé avec le bucket ? (cd outils/partage && npx wrangler deploy)`); process.exit(1); }
for (const o of (await r.json()).fichiers) distants.set(o.cle, o);

let envoyes = 0, echecs = 0, octets = 0;
for (const { cle, f, type } of locaux) {
  const md5 = createHash('md5').update(readFileSync(f)).digest('hex'), taille = statSync(f).size;
  const d = distants.get(cle);
  if (d && d.md5 === md5 && d.taille === taille) { console.log(`=  ${cle}`); continue; }
  console.log(`${d ? '~' : '+'}  ${cle} (${(taille / 1e6).toFixed(1)} Mo)`);
  if (essai) continue;
  const p = spawnSync('npx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${cle}`, '--file', `"${f}"`, '--content-type', type, '--remote'],
    { cwd: ICI, shell: true, encoding: 'utf8' });
  if (p.status !== 0) { echecs++; console.error((p.stderr || p.stdout || '').trim().split('\n').slice(-4).join('\n')); continue; }
  envoyes++; octets += taille;
}
console.log(`${locaux.length} fichier(s), ${essai ? 'essai : rien envoyé' : `${envoyes} envoyé(s) (${(octets / 1e6).toFixed(1)} Mo)`}${echecs ? `, ${echecs} ÉCHEC(S)` : ''}`);
process.exit(echecs ? 1 : 0);
