#!/usr/bin/env node
/**
 * Les portes — ce que le code refuse au modèle, preuve en main.
 *
 *   node portes.mjs shots.json [-o sortie.json] [--essai]
 *
 * Le modèle juge l'échelle, la catégorie, le mouvement. Sur ce qui se MESURE, il
 * n'a pas le dernier mot : une catégorie contredite par les mesures est corrigée,
 * et la correction est tracée — jamais effacée.
 *
 * Porte « dialogue sans personne » : un plan classé dialogue alors qu'aucun
 * personnage n'est à l'image et qu'aucune silhouette n'y a été segmentée n'est pas
 * un plan de dialogue. La réplique qu'on y entend vient d'ailleurs — c'est un
 * carton quand un texte est incrusté, un insert sinon. Vu sur le carton de fin de
 * getaround, classé « dialogue » parce que la phrase de fin le recouvre.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [file, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(n); return i < 0 ? d : rest[i + 1]; };
if (!file) { console.error('usage: portes.mjs shots.json [-o sortie.json] [--essai]'); process.exit(1); }
const doc = JSON.parse(readFileSync(file, 'utf8'));

const corrections = [];
for (const s of doc.shots ?? []) {
  const personne = !(s.subjects ?? []).length && !Object.keys(s.masks ?? {}).length;
  if (s.category === 'dialogue' && personne) {
    const vers = s.onscreenText ? 'text-card' : 'insert';
    corrections.push({ plan: s.id, de: s.category, vers, motif: `aucun personnage ni silhouette à l'image${s.onscreenText ? ' ; texte incrusté' : ''}` });
    s.category = vers;
    s.note = [s.note, `catégorie corrigée par le code : dialogue → ${vers}, aucun personnage à l'image`].filter(Boolean).join(' · ');
  }
}

doc.portes = [...(doc.portes ?? []), ...corrections];
if (corrections.length) {
  process.stderr.write(`${corrections.length} catégorie(s) corrigée(s) :\n`);
  for (const c of corrections) process.stderr.write(`   ${c.plan} : ${c.de} → ${c.vers} — ${c.motif}\n`);
} else process.stderr.write('aucune catégorie à corriger\n');

if (!rest.includes('--essai')) writeFileSync(flag('-o', file), JSON.stringify(doc, null, 2));
