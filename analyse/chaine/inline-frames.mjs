#!/usr/bin/env node
/**
 * Embarque les images clés dans le rapport : le HTML devient réellement
 * autonome (un seul fichier à envoyer, rien à côté, aucune image cassée).
 *
 * Le rapport d'origine construit les chemins au moment du rendu JS
 * (`${CFG.frameDir}/${id}${suffix}.jpg`), donc on pose une table
 * `CFG.frameData` et on branche les deux endroits qui fabriquent un src.
 *
 *   node inline-frames.mjs rapport.html --frames <dir> -o rapport-autonome.html
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [file, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(n); return i < 0 ? d : rest[i + 1]; };
const framesDir = flag('--frames', 'frames');
const out = flag('-o', file);

let html = readFileSync(file, 'utf8');

/* 1. la table des images, uniquement celles que le rapport déclare ---------- */
const cfg = /const CFG=(\{.*?\});\n/s.exec(html);
if (!cfg) throw new Error("bloc CFG introuvable — ce n'est pas un rapport video-shots");
const frames = JSON.parse(cfg[1]).frames ?? {};
const data = {};
let bytes = 0;
let missing = 0;
for (const [id, suffixes] of Object.entries(frames)) {
  for (const suffix of suffixes) {
    const p = join(framesDir, `${id}${suffix}.jpg`);
    if (!existsSync(p)) { missing++; continue; }
    const buf = readFileSync(p);
    bytes += buf.length;
    data[id + suffix] = `data:image/jpeg;base64,${buf.toString('base64')}`;
  }
}

/* 2. brancher les deux fabricants de src ---------------------------------- */
const swaps = [
  ['src="${CFG.frameDir}/${id}${suffix}.jpg"', 'src="${CFG.frameData[id + suffix] || (CFG.frameDir + \'/\' + id + suffix + \'.jpg\')}"'],
  ['has ? `${CFG.frameDir}/${galleryShot.id}${value}.jpg` : \'\'',
    'has ? (CFG.frameData[galleryShot.id + value] || `${CFG.frameDir}/${galleryShot.id}${value}.jpg`) : \'\''],
];
for (const [from, to] of swaps) {
  if (!html.includes(from)) throw new Error(`motif introuvable : ${from.slice(0, 40)}…`);
  html = html.split(from).join(to);
}

/* 3. le poster du lecteur, écrit en dur dans le gabarit -------------------- */
html = html.replace(/poster="([^"]*?)([^/"]+)\.jpg"/g, (m, dir, name) =>
  (data[name] ? `poster="${data[name]}"` : m));

/* 4. poser la table juste après CFG ---------------------------------------- */
html = html.replace(cfg[0], `${cfg[0]}CFG.frameData=${JSON.stringify(data)};\n`);

writeFileSync(out, html);
const mo = (n) => `${(n / 1048576).toFixed(1)} Mo`;
process.stderr.write(`${Object.keys(data).length} images embarquées (${mo(bytes)} d'origine)${missing ? `, ${missing} manquantes` : ''} → ${out} (${mo(Buffer.byteLength(html))})\n`);
