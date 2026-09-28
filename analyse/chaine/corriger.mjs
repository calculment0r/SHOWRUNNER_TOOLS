#!/usr/bin/env node
/**
 * Appliquer les corrections du trombinoscope à un document, sans y toucher.
 *
 *   node corriger.mjs shots.json [--corrections corrections.json] -o shots.corrige.json
 *
 * `shots.json` reste la sortie de la chaîne, telle quelle : ce qu'un œil a corrigé
 * — un nom, deux fiches qui sont la même personne, une réplique mal transcrite —
 * vit à part, dans `corrections.json`, et se superpose au rendu. Une correction
 * survit donc à une régénération, et reste défaisable en retirant une ligne.
 *
 * studio.mjs le fait déjà pour la page. Ce script sert aux rendus qui partent du
 * document sans passer par lui — le dépouillement, un export — pour qu'ils ne
 * montrent pas une distribution que la page a déjà corrigée.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { appliqueCorrections } from './casting-parts.mjs';

const [file, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(n); return i < 0 ? d : rest[i + 1]; };
if (!file) { console.error('usage: corriger.mjs shots.json [--corrections corrections.json] -o sortie.json'); process.exit(1); }

const corrFile = flag('--corrections', 'corrections.json');
const doc = JSON.parse(readFileSync(file, 'utf8'));
const avant = (doc.cast ?? []).length;

if (existsSync(corrFile)) {
  const corr = JSON.parse(readFileSync(corrFile, 'utf8'));
  appliqueCorrections(doc, corr);
  process.stderr.write(`corrections : ${Object.keys(corr.noms ?? {}).length} nom(s), ${Object.keys(corr.fusions ?? {}).length} fusion(s), ${Object.keys(corr.repliques ?? {}).length} réplique(s) — ${avant} → ${(doc.cast ?? []).length} fiches\n`);
} else {
  process.stderr.write(`aucun ${corrFile} : document inchangé\n`);
}

writeFileSync(flag('-o', file), JSON.stringify(doc, null, 2));
