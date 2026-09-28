#!/usr/bin/env node
// Les pistes du Studio : la VO et ses doublages, encodées pour la page (AAC), et le son.json qui les décrit.
//
//   node skill/son-pistes.mjs <dossier de l'analyse> vo=<dossier> zh=<dossier> en=<dossier> ...
//
// Chaque dossier (sortie de pistes-vo.py ou de doublage.py) contient fond.wav et voix-<P>.wav (voix-personne,
// voix-autres). Écrit <analyse>/son/<version>/*.m4a et <analyse>/son.json ; les répliques traduites viennent de
// <analyse>/doublage-<version>.json (le sous-titre du doublage). Puis régénérer la page : studio.mjs lit son.json.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const [analyse, ...args] = process.argv.slice(2);
if (!analyse || !args.length) { console.error('usage : son-pistes.mjs <analyse> vo=<dossier> zh=<dossier> ...'); process.exit(1); }
const NOMS = { vo: ['VO', 'Version originale'], zh: ['中文', 'Doublage chinois'], en: ['EN', 'Doublage anglais'] };
const versions = [];
for (const a of args) {
  const [id, dossier] = a.split('=');
  const sortie = join(analyse, 'son', id);
  mkdirSync(sortie, { recursive: true });
  const enc = (src, dst, voix) => execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', join(dossier, src),
    ...(voix ? ['-ac', '1', '-b:a', '96k'] : ['-ac', '2', '-b:a', '160k']), '-c:a', 'aac', join(sortie, dst)]);
  enc('fond.wav', 'fond.m4a', false);
  const voix = {};
  for (const f of readdirSync(dossier).filter((x) => /^voix-.+\.wav$/.test(x) && x !== 'voix-seule.wav').sort()) {
    const qui = f.slice(5, -4), cle = qui === 'personne' ? '' : qui;
    enc(f, f.replace(/\.wav$/, '.m4a'), true);
    voix[cle] = `son/${id}/${f.replace(/\.wav$/, '.m4a')}`;
  }
  const v = { id, nom: (NOMS[id] || [id])[0], titre: (NOMS[id] || [id, id])[1], fond: `son/${id}/fond.m4a`, voix };
  const script = join(analyse, `doublage-${id}.json`);
  if (id !== 'vo' && existsSync(script)) {
    // les mots du doublage à leur instant (doublage_mots.py : mots.json dans le dossier), pour le sous-titre
    const mots = existsSync(join(dossier, 'mots.json')) ? JSON.parse(readFileSync(join(dossier, 'mots.json'), 'utf8')) : [];
    v.lignes = JSON.parse(readFileSync(script, 'utf8')).lignes.map(({ a, b, qui, trad }) => {
      const m = mots.find((x) => Math.abs(x.a - a) < 0.005);
      return m ? { a, b, qui, trad, mots: m.mots } : { a, b, qui, trad };
    });
  }
  versions.push(v);
  console.log(`${id} : fond + ${Object.keys(voix).length} voix (${Object.keys(voix).map((k) => k || 'personne').join(', ')})`);
}
writeFileSync(join(analyse, 'son.json'), JSON.stringify({ format: 'movie-analysis-son', version: 1, versions }, null, 1) + '\n');
console.log(`→ ${join(analyse, 'son.json')}`);
