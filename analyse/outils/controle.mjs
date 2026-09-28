#!/usr/bin/env node
// Controles deterministes sur ce qui est publie.
// Meme commande en local et dans la CI : node outils/controle.mjs
//
// Ce fichier est en ASCII pur, accents compris, et c'est voulu : un detecteur
// de caracteres chinois ne doit pas pouvoir en contenir lui-meme. Les bornes
// sont numeriques, jamais une classe de caracteres litterale -- premiere
// version de ce script, la classe avait ete ecrite en litteraux et le
// detecteur se declenchait sur lui-meme.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const IGNORE = new Set(['.git', 'node_modules', 'runs', 'models', 'isole', '__pycache__']);
const SUFFIXES = new Set(['.html', '.md', '.mjs', '.js', '.py', '.css', '.json', '.yml', '.sh']);
// les videos des analyses sur R2, servies par le Worker du depot partage (outils/partage)
const R2_VIDEO = 'https://movie-analysis-partage.luxigone.workers.dev/video/';

// Pleine chasse, ideogrammes CJK et leurs extensions.
const PLAGES = [[0x3000, 0x303f], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xff00, 0xffef]];

function interdit(ligne) {
  for (const ch of ligne) {
    const c = ch.codePointAt(0);
    for (const [bas, haut] of PLAGES) if (c >= bas && c <= haut) return c;
  }
  return null;
}

// Les jetons a portee restreinte de GitHub commencent par github_pat_ et non ghp_ :
// le detecteur les laissait passer. Ajoute apres qu'un jeton de ce format a circule.
const JETON = /(hf_[A-Za-z0-9]{30,}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9]{30,})/;

function fichiers(racine, acc = []) {
  for (const e of readdirSync(racine)) {
    if (IGNORE.has(e)) continue;
    const p = join(racine, e);
    if (statSync(p).isDirectory()) fichiers(p, acc);
    else if (SUFFIXES.has(extname(e))) acc.push(p);
  }
  return acc;
}

const echecs = [];
const exige = (ok, message) => { if (!ok) echecs.push(message); };

// 1. Aucun jeton versionne, nulle part.
for (const f of fichiers('.')) {
  readFileSync(f, 'utf8').split('\n').forEach((ligne, i) => {
    if (JETON.test(ligne)) echecs.push(`${f}:${i + 1} un jeton semble versionne`);
  });
}

// 2. Les pages publiees restent autonomes et fideles aux decisions prises.
//
// Le controle des caracteres chinois porte sur la SORTIE, pas sur la chaine :
// skill/ vient d'un skill amont sinophone, ses consignes existent en zh, en et
// fr (--lang choisit), ses commentaires sont en chinois et selftest.mjs en
// contient expres pour eprouver frenchify. Elargir a skill/ ne signalerait que
// du legitime -- 596 fois -- et noierait un vrai defaut dans la sortie.
// Portail Showrunner (a lancer depuis analyse/) : index.html y est l'accueil de l'outil, dans le theme du portail
// (feuilles et polices communes, en-tete du portail) -- ce n'est pas une page autonome, elle n'entre pas ici.
const pages = [];
if (existsSync('analyses')) {
  for (const a of readdirSync('analyses')) {
    for (const p of ['index.html', 'depouillement.html']) {
      const f = join('analyses', a, p);
      if (existsSync(f)) pages.push(f);
    }
  }
}
exige(pages.length > 0, 'aucune analyse publiee dans analyses/');
// Les outils publies (outils/<nom>/index.html ; dans le portail, diarisation/index.html) passent les memes controles.
if (existsSync('outils')) {
  for (const o of readdirSync('outils')) {
    const f = join('outils', o, 'index.html');
    if (existsSync(f)) pages.push(f);
  }
}
if (existsSync(join('diarisation', 'index.html'))) pages.push(join('diarisation', 'index.html'));
// La page projet (projet/?id=...) et le code commun de la home passent les memes controles.
if (existsSync(join('projet', 'index.html'))) pages.push(join('projet', 'index.html'));
if (existsSync(join('commun', 'projets.js'))) {
  try { new Function(readFileSync(join('commun', 'projets.js'), 'utf8')); }
  catch (e) { exige(false, `commun/projets.js ne se parse pas -- ${e.message}`); }
}
// (.nojekyll : propre a GitHub Pages de MOVIE_ANALYSE ; le portail est servi par server/showrunner.py)

for (const f of pages) {
  const page = readFileSync(f, 'utf8');
  // Zero caractere chinois ni ponctuation pleine chasse dans la sortie.
  page.split('\n').forEach((ligne, i) => {
    const c = interdit(ligne);
    if (c !== null) echecs.push(`${f}:${i + 1} caractere interdit U+${c.toString(16).toUpperCase().padStart(4, '0')}`);
  });
  // La video peut venir de NOTRE service (R2 derriere le Worker d'outils/partage, GET /video/…) a une condition : garder
  // le fichier pose a cote de la page en repli (data-repli, chemin relatif) -- sans R2 la page le lit, rien ne manque.
  const sansR2 = page.replace(/<video[^>]*>/g, (v) => {
    const src = /\ssrc="([^"]*)"/.exec(v), repli = /\sdata-repli="([^"]*)"/.exec(v);
    return src && src[1].startsWith(R2_VIDEO) && repli && repli[1] && !/^[a-z]+:|^\//i.test(repli[1]) ? v.replace(src[0], ' src="R2"') : v;
  });
  // Autonome : aucune ressource ni script ne doit venir du reseau.
  const externes = sansR2.match(/(?:src|href)="https?:\/\/[^"]+"/g) || [];
  exige(externes.length === 0, `${f} appelle ${externes.length} ressource(s) externe(s), ex. ${externes[0]}`);
  // Le theme est clair par defaut : le sombre passe par data-theme explicite,
  // jamais par la preference du systeme.
  exige(!/@media[^{]*prefers-color-scheme/.test(page), `${f} : prefers-color-scheme est revenu dans le CSS`);
  // La video est appelee en chemin relatif, ou sur R2 avec son repli relatif (ci-dessus) : jamais ailleurs.
  const absolue = sansR2.match(/<video[^>]*\ssrc="https?:\/\/[^"]*"/);
  exige(!absolue, `${f} : la video est appelee par une URL absolue (hors R2 avec repli relatif data-repli)`);
  // Le script de la page doit SE PARSER. La page est ecrite par un gabarit :
  // un accent grave, un \r\n ou un ﻿ glisse dans le code emis y devient un
  // vrai caractere, et toute la page devient muette — les boutons ne repondent
  // plus, sans rien dire. Deux fois que ca arrive, une fois que ca se voit.
  for (const bloc of page.match(/<script>([\s\S]*?)<\/script>/g) || []) {
    const js = bloc.slice(8, -9);
    if (!js.trim()) continue;
    try { new Function(js); }
    catch (e) {
      const ligne = js.slice(0, 400).split('\n')[0].slice(0, 60);
      exige(false, `${f} : le script ne se parse pas — ${e.message} (bloc commencant par « ${ligne} »)`);
    }
  }
}

if (echecs.length) {
  for (const e of echecs) console.error(`::error::${e}`);
  console.error(`\n${echecs.length} controle(s) en echec.`);
  process.exit(1);
}
console.log(`Controles passes : ${pages.length} pages autonomes, sortie francaise propre, aucun jeton.`);
