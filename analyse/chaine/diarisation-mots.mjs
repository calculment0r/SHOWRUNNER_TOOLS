#!/usr/bin/env node
// Les mots de la chaîne, horodatés un à un, pour la page outils/diarisation/ : chaque mot s'y pose dans la frise à
// l'instant où on l'entend. Source : le whisper.json d'un run (whisper-run.py, word_timestamps). Rien ne se recalcule.
//
//   node skill/diarisation-mots.mjs <whisper.json> <film> ["d'où il vient"]   → analyses/<film>/mots.json
//
// Les répliques du site (shots.json) sont les segments de Whisper, aux mêmes bornes : la page les apparie par bornes
// et par texte. Une réplique corrigée à la main (corrections.json) ne retrouve plus ses mots : elle reste entière.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [src, film, note] = process.argv.slice(2);
if (!src || !film) { console.error('usage : node skill/diarisation-mots.mjs <whisper.json> <film> ["d\'où il vient"]'); process.exit(1); }
const W = JSON.parse(readFileSync(src, 'utf8'));
const r3 = (x) => Math.round(x * 1000) / 1000;
const out = {
  format: 'xverse-mots', version: 1, film, langue: W.lang, source: 'whisper.json de la chaîne' + (note ? ' (' + note + ')' : ''),
  // les mots gardent leur espace de tête : recollés, ils redonnent le texte exact de la réplique
  lignes: W.segments.map((s) => ({ a: r3(s.start), b: r3(s.end), texte: s.text.trim(), mots: (s.words || []).map((w) => [w.w, r3(w.s), r3(w.e)]) })),
};
const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'analyses', film, 'mots.json');
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out));
console.log(`✓ analyses/${film}/mots.json — ${out.lignes.length} répliques, ${out.lignes.reduce((n, l) => n + l.mots.length, 0)} mots (${out.langue})`);
