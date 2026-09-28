#!/usr/bin/env node
/**
 * Re-casting sans recalcul : on a refait la ré-identification (nouveaux P1..Pn),
 * mais les masques SAM 3, les sujets et les répliques du document parlent encore
 * des anciens identifiants. On reconstruit la table ancien → nouveau par les pistes
 * (une piste n'appartient qu'à une personne) et on renomme partout.
 *
 *   node remap-cast.mjs ancien.json nouveau.json -o sortie.json
 *   ancien.json : le document complet (masques, répliques…) avec l'ancien casting
 *   nouveau.json : la sortie de reid-face (nouveau casting, nouveaux sujets)
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [oldFile, newFile, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(n); return i < 0 ? d : rest[i + 1]; };
if (!oldFile || !newFile) { console.error('usage: remap-cast.mjs ancien.json nouveau.json -o sortie.json'); process.exit(1); }
const old = JSON.parse(readFileSync(oldFile, 'utf8'));
const neu = JSON.parse(readFileSync(newFile, 'utf8'));

const trackOwner = {};
for (const c of neu.cast ?? []) for (const t of c.tracks ?? []) trackOwner[t] = c.id;
const rename = {};
for (const c of old.cast ?? []) {
  const votes = {};
  for (const t of c.tracks ?? []) { const n = trackOwner[t]; if (n) votes[n] = (votes[n] ?? 0) + 1; }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  rename[c.id] = best ? best[0] : null;     // null = devenu figurant, disparaît des champs
}
const map = (x) => rename[x] === undefined ? x : rename[x];

// le document de sortie : l'ancien (il a tout), avec le nouveau casting et ses sujets
const out = { ...old, cast: neu.cast, faceDist: neu.faceDist, provenance: { ...(old.provenance ?? {}), ...(neu.provenance ?? {}), recast: `${Object.keys(rename).length} → ${(neu.cast ?? []).length}` } };
const newSubjects = Object.fromEntries((neu.shots ?? []).map((s) => [s.id, s.subjects ?? []]));
for (const s of out.shots) {
  s.subjects = newSubjects[s.id] ?? [...new Set((s.subjects ?? []).map(map).filter(Boolean))];
  if (s.lines) for (const l of s.lines) if (l.speaker) l.speaker = map(l.speaker);
  if (s.masks) {
    const m = {};
    for (const [k, v] of Object.entries(s.masks)) { const nk = map(k); if (!nk) continue; m[nk] = m[nk] ? { coverage: Math.round((m[nk].coverage + v.coverage) * 10) / 10, frames: m[nk].frames + v.frames, share: Math.min(1, m[nk].share + v.share) } : v; }
    s.masks = m;
  }
}
if (out.voices) for (const v of Object.values(out.voices)) v.person = map(v.person);
const nameOf = (id) => (out.cast ?? []).find((c) => c.id === id)?.name ?? id;
for (const s of out.shots) if (s.lines?.length) s.audio = s.lines.map((l) => `${l.speaker ? nameOf(l.speaker) : '?'} : ${l.text}`).join(' / ');

writeFileSync(flag('-o', newFile), JSON.stringify(out, null, 2));
process.stderr.write(`recasting : ${Object.entries(rename).map(([a, b]) => `${a}→${b ?? '∅'}`).join('  ')}\n`);
