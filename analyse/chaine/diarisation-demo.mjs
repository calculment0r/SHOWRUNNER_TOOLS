#!/usr/bin/env node
// Garde dans le dépôt le vrai résultat de la démo de outils/diarisation/ : la scène Getaround
// passée par le service Nemotron d'un DGX, au réglage que prend le bouton « Charger la démo »
// (latence 30,4 s). Même contenu que le bouton « Garder comme démo » de la page, sans navigateur.
//
//   node skill/diarisation-demo.mjs [--film wall] [--service URL] [--cle CLÉ]
//
// Par défaut le service de dgx1 dans le tailnet ; « --service http://127.0.0.1:8448 » avec un
// tunnel ssh. Écrit analyses/<film>/diarisation.json (le Studio du film la lit au rendu) : il reste à le commiter et le pousser,
// la démo s'ouvre alors aussitôt, machine éteinte. --film : getaround par défaut ; la vidéo est analyses/<film>/<film>.mp4,
// le titre celui de son shots.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (nom, defaut) => { const i = process.argv.indexOf('--' + nom); return i > 0 ? process.argv[i + 1] : defaut; };
const SERVICE = arg('service', 'https://dgx1.tail6c4306.ts.net:10002/diarisation').replace(/\/+$/, '');
const CLE = arg('cle', process.env.DIARISATION_CLE || '');
const ID = arg('film', 'getaround');
const DOSSIER = join(RACINE, 'analyses', ID);
const FILM = { titre: ID === 'getaround' ? 'Évadez-vous avec Getaround' : JSON.parse(readFileSync(join(DOSSIER, 'shots.json'), 'utf8')).title || ID,
  video: join(DOSSIER, ID + '.mp4') };
const SORTIE = join(DOSSIER, 'diarisation.json');
// le préréglage « 30,4 s » de la page (PRESETS) : le bouton démo calcule avec lui
const PRESET = { chunk_len: 340, chunk_right_context: 40, fifo_len: 40, spkcache_update_period: 300 };
// les seuils de NeMo par défaut (POST_DEFAUT de la page) : la démo s'ouvre avec eux
const POST = { onset: 0.5, offset: 0.5, pad_onset: 0, pad_offset: 0, min_duration_on: 0, min_duration_off: 0 };

const stop = (msg) => { console.error('✗ ' + msg); process.exit(1); };
async function appel(chemin, opts = {}) {
  const r = await fetch(SERVICE + chemin, { ...opts, headers: { ...(opts.headers || {}), ...(CLE ? { 'X-Cle': CLE } : {}) } })
    .catch((e) => stop(`${SERVICE} ne répond pas (${e.cause?.code || e.message}) — le service tourne-t-il ? Tailscale est-il actif sur ce poste ?`));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) stop(`${chemin.split('?')[0]} : ${j.erreur || 'réponse ' + r.status}`);
  return j;
}

const etat = await appel('/etat');
if (!etat.pret) stop(`la machine n'est pas prête : phase « ${etat.phase} »${etat.erreur ? ' — ' + etat.erreur : ''}`);
const reglages = { ...(etat.modele?.reglages_defaut || {}), ...PRESET };
console.log(`machine ${etat.machine} · modèle ${etat.modele?.nom} · réglages ${JSON.stringify(reglages)}`);

const q = new URLSearchParams(Object.entries(reglages).map(([k, v]) => [k, String(v)]));
q.set('nom', FILM.titre);
const corps = readFileSync(FILM.video);
const job = await appel('/analyse?' + q, { method: 'POST', body: corps, headers: { 'Content-Type': 'application/octet-stream' } });
console.log(`envoyé : ${(corps.length / 2 ** 20).toFixed(1)} Mo → analyse ${job.id}`);

let fini = null;
for (const t0 = Date.now(); Date.now() - t0 < 15 * 60e3;) {
  const j = await appel('/travail/' + job.id);
  if (j.etat === 'fini' && j.resultat) { fini = j.resultat; break; }
  if (j.etat === 'erreur' || j.etat === 'annulé') stop(`analyse ${j.etat}${j.erreur ? ' : ' + j.erreur : ''}`);
  await new Promise((ok) => setTimeout(ok, 1000));
}
if (!fini) stop('pas de résultat en 15 minutes');
if (typeof fini.probas?.q !== 'string') stop('résultat sans probabilités : ce service ne parle pas le format de la page');

mkdirSync(dirname(SORTIE), { recursive: true });
writeFileSync(SORTIE, JSON.stringify({ format: 'xverse-diarisation', version: 1, resultat: fini, post: POST }));
const voix = new Set((fini.segments_nemo || []).map((s) => s[2])).size;   // [début, fin, voix]
console.log(`✓ ${SORTIE.slice(RACINE.length + 1)} — ${fini.duree_s?.toFixed(1)} s de son, ${fini.calcul?.diarisation_s} s de calcul, `
  + `${voix} voix dans les segments de NeMo, ${(JSON.stringify(fini).length / 1024).toFixed(0)} Ko`);
console.log('Reste à commiter et pousser ce fichier : « Charger la démo » l\'ouvrira alors aussitôt.');
