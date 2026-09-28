#!/usr/bin/env node
/**
 * Sous-titres YouTube → champ `audio` des plans.
 *
 * Le skill n'a pas de transcription : `audio` ne vient que des sous-titres
 * incrustés, et la catégorie « dialogue » se fait rétrograder faute de preuve.
 * YouTube, lui, a déjà transcrit la vidéo, avec des horodatages. On les
 * rapporte plan par plan par recouvrement temporel — et la porte « catégorie
 * étayée » a enfin sa preuve.
 *
 * Les sous-titres automatiques de YouTube arrivent en « rouleau » : chaque
 * ligne est répétée dans plusieurs blocs qui se chevauchent. On dédoublonne
 * en gardant, pour chaque ligne, le premier bloc où elle apparaît.
 *
 *   node captions-to-audio.mjs shots.json sous-titres.srt [-o shots.json] [--min-overlap 0.3]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [shotsFile, srtFile, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(n); return i < 0 ? d : rest[i + 1]; };

/* ------------------------------------------------------------- lire le SRT -- */
const toSec = (t) => { const [h, m, s] = t.replace(',', '.').split(':'); return (+h) * 3600 + (+m) * 60 + parseFloat(s); };
export function parseSrt(text) {
  const blocks = text.replace(/\r/g, '').split(/\n\n+/);
  const out = [];
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim());
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, z] = lines[ti].split('-->').map((x) => toSec(x.trim().split(' ')[0]));
    const body = lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (body) out.push({ start: a, end: z, text: body });
  }
  return out;
}

/**
 * Dédoublonne le « rouleau » YouTube : une ligne répétée dans des blocs qui se
 * CHEVAUCHENT n'est comptée qu'une fois. Une ligne qui revient plus tard dans le
 * film (« Ouais. » dit trois fois) est une vraie réplique à chaque fois — on ne
 * la fusionne pas, sinon elle s'étale sur tous les plans entre les deux.
 */
export function dedupe(cues, gap = 0.5) {
  const last = new Map(); // ligne → dernière entrée posée
  const lines = [];
  for (const c of cues) {
    for (const raw of c.text.split(/\s*>>\s*|\s{2,}/)) {
      const line = raw.replace(/^>>\s*/, '').trim();
      if (!line) continue;
      const key = line.toLowerCase();
      const prev = last.get(key);
      if (prev && c.start <= prev.end + gap) { prev.end = Math.max(prev.end, c.end); continue; }
      const entry = { start: c.start, end: c.end, text: line };
      last.set(key, entry);
      lines.push(entry);
    }
  }
  return lines.sort((a, b) => a.start - b.start);
}

/* ---------------------------------------------------- rapporter aux plans -- */
export function mergeCaptions(doc, lines, minOverlap = 0.3, log = []) {
  let filled = 0;
  for (const s of doc.shots) {
    const inShot = lines.filter((l) => {
      const ov = Math.min(l.end, s.end) - Math.max(l.start, s.start);
      // une ligne courte tient entière dans un plan ; une longue compte si elle y passe assez de temps
      return ov > 0 && (ov >= minOverlap || ov >= (l.end - l.start) * 0.5);
    });
    if (!inShot.length) continue;
    const text = inShot.map((l) => l.text).join(' / ');
    if (!String(s.audio ?? '').trim()) { s.audio = text; filled++; }
    else if (!s.audio.includes(text)) s.audio = `${s.audio} / ${text}`;

    // La preuve est là : quelqu'un parle et quelqu'un est à l'image. Un plan
    // jugé « sujet » faute de réplique devient « dialogue » — la porte
    // « catégories étayées » exigeait exactement cette preuve. On le dit.
    if (s.category === 'subject' && (s.subjects ?? []).length) {
      s.category = 'dialogue';
      log.push(`${s.id}: sujet → dialogue (réplique transcrite, ${s.subjects.length} personne(s) à l'image)`);
    }
  }
  return filled;
}

// Le corps CLI ne tourne que si le fichier est lancé directement : importable sans effet de bord.
const isMain = process.argv[1] && new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).pathname.endsWith('/captions-to-audio.mjs');
if (isMain) {
  if (!shotsFile || !srtFile) { console.error('usage: captions-to-audio.mjs shots.json sous-titres.srt [-o sortie.json]'); process.exit(1); }
  const doc = JSON.parse(readFileSync(shotsFile, 'utf8'));
  const lines = dedupe(parseSrt(readFileSync(srtFile, 'utf8')));
  const log = [];
  const filled = mergeCaptions(doc, lines, Number(flag('--min-overlap', 0.3)), log);
  const out = flag('-o', shotsFile);
  writeFileSync(out, JSON.stringify(doc, null, 2));
  process.stderr.write(`${lines.length} lignes de sous-titres (après dédoublonnage) → audio rempli sur ${filled}/${doc.shots.length} plans → ${out}\n`);
  for (const l of log) process.stderr.write(`   · ${l}\n`);
}
