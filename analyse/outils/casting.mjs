#!/usr/bin/env node
// Pose sur les pages deja produites :
//   1. le trombinoscope -- un onglet Casting, portraits et noms modifiables ;
//   2. la propagation des noms -- scenario, timeline, fiche de plan, depouillement ;
//   3. le theme sombre dans le depouillement, qui est une iframe et ne le
//      recevait jamais du parent.
//
// Idempotent : relancer ne double rien. A terme la meme chose doit sortir de
// skill/studio.mjs ; ici on repare ce qui est deja publie.
//
// Usage : node outils/casting.mjs [analyses/<nom> ...]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import * as CASTING from '../chaine/casting-parts.mjs';
import { join } from 'node:path';

const MARQUE = 'xverse-casting-v1';

// Les morceaux viennent de skill/casting-parts.mjs : studio.mjs les pose a la
// generation, cet outil les recolle sur les pages deja produites. Un seul code.
const CSS = `\n<style id="${MARQUE}-css">${CASTING.CASTING_CSS}\n</style>`;
const APPLIQUE = (slug) => `\n<script id="${MARQUE}-applique">${CASTING.CORRECTIONS_JS}\n${CASTING.appliqueNoms(slug)}\n</script>`;
const TROMBI = `\n<script id="${MARQUE}-js">${CASTING.TROMBINOSCOPE}\n</script>`;
const THEME_PARENT = `\n<script id="${MARQUE}-theme">${CASTING.THEME_VERS_IFRAME}\n</script>`;
const THEME_IFRAME = `\n<script id="${MARQUE}-theme-dep">${CASTING.THEME_DANS_DEPOUILLEMENT}\n</script>`;
const NOMS_IFRAME = (slug) => `\n<script id="${MARQUE}-noms-dep">${CASTING.NOMS_DANS_DEPOUILLEMENT(slug)}\n</script>`;

/* ------------------------------------------------------------- le montage -- */
// Trouve la fin d'un littéral objet en comptant les accolades : une regex
// paresseuse s'arrête à la première "}" du JSON, qui en contient partout.
function finDuLitteral(texte, nom) {
  const m = new RegExp('const\\s+' + nom + '\\s*=\\s*\\{').exec(texte);
  if (!m) return -1;
  let i = texte.indexOf('{', m.index);
  let profondeur = 0, chaine = null, echap = false;
  for (; i < texte.length; i++) {
    const c = texte[i];
    if (chaine) {
      if (echap) echap = false;
      else if (c === '\\') echap = true;
      else if (c === chaine) chaine = null;
      continue;
    }
    if (c === '"' || c === "'") { chaine = c; continue; }
    if (c === '{') profondeur++;
    else if (c === '}') { profondeur--; if (profondeur === 0) break; }
  }
  if (profondeur !== 0) return -1;
  // avaler le ";" et le saut de ligne qui suivent, s'ils sont là
  let j = i + 1;
  if (texte[j] === ';') j++;
  if (texte[j] === '\n') j++;
  return j;
}

function poseStudio(fichier, slug) {
  let t = readFileSync(fichier, 'utf8');
  if (t.includes(`${MARQUE}-js`)) return 'deja pose';
  // Une page produite par la chaine corrigee porte deja le trombinoscope :
  // studio.mjs l'emet nativement, sans le marqueur de cet outil. Ne pas doubler.
  if (t.includes('data-tab="casting"')) return 'natif';

  // 1. le style, avant </head>
  t = t.replace('</head>', CSS + '\n</head>');

  // 2. l'onglet
  const onglet = CASTING.CASTING_ONGLET;
  const avantTabs = '<button data-tab="depouillement" aria-pressed="false">Dépouillement</button>';
  if (!t.includes(onglet)) {
    if (!t.includes(avantTabs)) throw new Error(fichier + ' : bouton Dépouillement introuvable');
    t = t.replace(avantTabs, avantTabs + onglet);
  }

  // 3. la section
  const section = CASTING.CASTING_SECTION;
  const ancre = '<main id="depouillement" hidden>';
  const fin = t.indexOf('</main>', t.indexOf(ancre)) + '</main>'.length;
  if (t.indexOf(ancre) < 0) throw new Error(fichier + ' : section Dépouillement introuvable');
  t = t.slice(0, fin) + '\n' + section + t.slice(fin);

  // 4. la bascule a trois onglets
  const ancienneBascule = /document\.querySelectorAll\('#tabs button'\)\.forEach\(\(b\) => b\.addEventListener\('click', \(\) => \{[\s\S]*?\}\)\);/;
  if (!ancienneBascule.test(t)) throw new Error(fichier + ' : bascule d\'onglets introuvable');
  t = t.replace(ancienneBascule, CASTING.ONGLETS.trim());

  // 5. les noms memorises, juste apres DATA
  const apresData = finDuLitteral(t, 'DATA');
  if (apresData < 0) throw new Error(fichier + ' : DATA introuvable');
  t = t.slice(0, apresData) + '</script>' + APPLIQUE(slug) + '<script>\n' + t.slice(apresData);

  // 6. trombinoscope et theme, en fin de document
  t = t.replace('</body>', TROMBI + THEME_PARENT + '\n</body>');
  writeFileSync(fichier, t);
  return 'pose';
}

function poseDepouillement(fichier, slug) {
  let t = readFileSync(fichier, 'utf8');
  if (t.includes(`${MARQUE}-theme-dep`)) return 'deja pose';
  // dans le portail (29/09), depouillement.html ne fait plus que renvoyer a la vue de la page du film
  if (!/const\s+DOC\s*=/.test(t)) return 'renvoi vers la page du film, rien a poser';
  const apres = finDuLitteral(t, 'DOC');
  if (apres < 0) throw new Error(fichier + ' : DOC introuvable');
  t = t.slice(0, apres) + '</script>' + NOMS_IFRAME(slug) + '<script>\n' + t.slice(apres);
  t = t.replace('</body>', THEME_IFRAME + '\n</body>');
  writeFileSync(fichier, t);
  return 'pose';
}

const cibles = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync('analyses').map((n) => join('analyses', n));

for (const dossier of cibles) {
  const slug = dossier.split(/[\\/]/).filter(Boolean).pop();
  const studio = join(dossier, 'index.html');
  const dep = join(dossier, 'depouillement.html');
  if (!existsSync(studio)) { console.log(`${slug} : pas de page Studio, ignore`); continue; }
  console.log(`${slug} : studio ${poseStudio(studio, slug)}` + (existsSync(dep) ? `, depouillement ${poseDepouillement(dep, slug)}` : ''));
}
