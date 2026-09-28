#!/usr/bin/env node
/**
 * Qui parle ? — attribution des répliques aux personnages.
 *
 * Deux régimes :
 *
 *   AVEC diarisation (--diarization turns.json, sortie de diarize-run.py) :
 *     chaque réplique reçoit la voix (SPEAKER_xx) qui la recouvre le plus, puis
 *     chaque voix est rapprochée d'un personnage du casting par co-occurrence :
 *     la personne le plus souvent à l'image quand cette voix parle, c'est elle.
 *     C'est mesuré. Les contre-champs (l'auditeur à l'image) ne trompent plus.
 *
 *   SANS diarisation : règle de plateau, et on le dit.
 *     · une seule personne à l'image pendant la réplique → c'est elle
 *     · deux personnes → champ/contre-champ, on alterne
 *     · sinon → « ? »
 *
 *   node speakers.mjs shots.json transcription.json [--diarization turns.json] [-o shots.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [shotsFile, whisperFile, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(n); return i < 0 ? d : rest[i + 1]; };
if (!shotsFile || !whisperFile) { console.error('usage: speakers.mjs shots.json transcription.json [--diarization turns.json] [-o sortie.json]'); process.exit(1); }

const doc = JSON.parse(readFileSync(shotsFile, 'utf8'));
const tr = JSON.parse(readFileSync(whisperFile, 'utf8'));
const dia = flag('--diarization') ? JSON.parse(readFileSync(flag('--diarization'), 'utf8')).turns : null;
const name = (id) => (doc.cast ?? []).find((c) => c.id === id)?.name ?? id;
const overlap = (a, b, s) => Math.max(0, Math.min(b, s.end) - Math.max(a, s.start));
const hostShot = (a, b) => doc.shots.map((s) => [overlap(a, b, s), s]).sort((x, y) => y[0] - x[0])[0]?.[1] ?? null;

const lines = [];
let mode;

if (dia) {
  mode = 'diarisation';
  // 1. la voix de chaque réplique : le tour de parole qui la recouvre le plus
  for (const seg of tr.segments) {
    const text = String(seg.text).trim(); if (!text) continue;
    const best = dia.map((t) => [overlap(seg.start, seg.end, t), t]).sort((x, y) => y[0] - x[0])[0];
    const voice = best && best[0] > 0 ? best[1].speaker : null;
    lines.push({ start: seg.start, end: seg.end, text, shot: hostShot(seg.start, seg.end)?.id ?? null, voice, speaker: null, how: voice ? 'voix' : 'silence' });
  }
  // 2. voix → personnage : co-occurrence avec les sujets à l'image, pondérée par la durée
  const score = {};   // voix → { personnage → secondes }
  for (const t of dia) {
    for (const s of doc.shots) {
      const ov = overlap(t.start, t.end, s); if (ov <= 0) continue;
      const present = s.subjects ?? [];
      // un seul à l'image : preuve forte ; deux : preuve partagée ; foule : rien
      const w = present.length === 1 ? 1 : present.length === 2 ? 0.5 : 0;
      for (const p of present) { score[t.speaker] ??= {}; score[t.speaker][p] = (score[t.speaker][p] ?? 0) + ov * w; }
    }
  }
  // affectation gloutonne : la paire (voix, personnage) la plus sûre d'abord, chacun une fois
  const pairs = Object.entries(score).flatMap(([v, m]) => Object.entries(m).map(([p, s]) => [s, v, p])).sort((a, b) => b[0] - a[0]);
  const voiceOf = {}, personOf = {};
  for (const [s, v, p] of pairs) { if (voiceOf[v] || personOf[p]) continue; voiceOf[v] = p; personOf[p] = v; }
  let how = 'voix + co-présence';
  // Les lèvres priment sur la co-présence : --voices voices.json (sortie de lips-run.py)
  // donne voix → personnage mesuré sur la bouche, et le locuteur de chaque tour.
  const lips = flag('--voices') ? JSON.parse(readFileSync(flag('--voices'), 'utf8')) : null;
  // médiane d'énergie de bouche par personne, sur tous les tours où on l'a mesurée
  const medianOf = (p) => {
    const v = (lips?.turns ?? []).map((t) => t.scores?.[p]).filter((x) => typeof x === 'number').sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : 0;
  };
  if (lips?.voices) {
    for (const [v, x] of Object.entries(lips.voices)) if (x.person) voiceOf[v] = x.person;
    how = 'voix + lèvres';
    mode = 'diarisation + lèvres';
  }
  for (const l of lines) if (l.voice) {
    // 1. les lèvres du tour, quand un visage a pu être mesuré : c'est la preuve la plus directe
    //    (un seul visage mesuré → lui ; deux visages → celui qui bouge le plus, si l'écart n'est pas nul)
    const turns = (lips?.turns ?? []).filter((t) => Math.min(t.end, l.end) - Math.max(t.start, l.start) > 0 && t.speaker);
    const turn = turns.sort((a, b) => (Math.min(b.end, l.end) - Math.max(b.start, l.start)) - (Math.min(a.end, l.end) - Math.max(a.start, l.start)))[0];
    const faces = turn ? Object.keys(turn.scores).length : 0;
    // à plusieurs visages, un écart sous 0.05 est un bruit de figurant : on rend la main à la voix.
    // un visage seul n'est cru que si sa bouche bouge vraiment (≥ 0.30) : un auditeur filmé
    // en contre-champ frémit aussi, et il n'y a personne à qui le comparer.
    // Le seuil est relatif à la personne : sa bouche qui parle bouge nettement plus que sa
    // bouche qui écoute. On compare à sa médiane sur tous les tours (un auditeur filmé
    // reste sous 1.25 × sa médiane ; un locuteur passe au-dessus).
    // Seuil absolu 0.30 : sur un film DOUBLÉ les lèvres ne suivent pas exactement la voix,
    // un seuil relatif à la personne bascule dans les deux sens (testé, pire). On garde le
    // seuil simple et on dit ce qu'on n'a pas su mesurer.
    const loneScore = turn && faces === 1 ? Object.values(turn.scores)[0] : 0;
    const lonePerson = turn && faces === 1 ? Object.keys(turn.scores)[0] : null;
    const lone = turn && faces === 1 && loneScore >= 0.30;
    if (turn && (lone || (faces > 1 && turn.margin >= 0.05))) {
      l.speaker = turn.speaker; l.how = faces === 1 ? 'lèvres (seul visage)' : `lèvres (écart ${turn.margin})`;
      continue;
    }
    // 2. (option --infer-offscreen) contre-champ muet : un seul visage à l'image, bouche
    //    immobile, et l'un des deux premiers rôles → c'est l'autre qui parle, hors champ.
    //    Déduit, pas mesuré : désactivé par défaut, parce que sur un film doublé la bouche
    //    du locuteur peut aussi rester sous le seuil.
    if (rest.includes('--infer-offscreen') && turn && faces === 1) {
      const leads = (doc.cast ?? []).filter((c) => c.by === 'visage').slice(0, 2).map((c) => c.id);
      const quiet = lonePerson;
      const other = leads.includes(quiet) ? leads.find((p) => p !== quiet) : null;
      if (other) { l.speaker = other; l.how = 'hors champ (déduit : le visage visible ne parle pas)'; continue; }
    }
    // 3. sinon la voix, telle que les lèvres l'ont rattachée sur l'ensemble du film
    l.speaker = voiceOf[l.voice] ?? null;
    l.how = l.speaker ? (lips?.voices?.[l.voice]?.mixed ? `${how}, voix mélangée` : how) : `voix ${l.voice} sans visage`;
  }
  doc.voices = Object.fromEntries(Object.entries(voiceOf).map(([v, p]) => [v, { person: p, name: name(p), seconds: Math.round(Object.values(score[v] ?? {}).reduce((a, b) => a + b, 0) * 10) / 10, by: lips?.voices?.[v] ? 'lèvres' : 'co-présence' }]));
} else {
  mode = 'règle de plateau';
  let last = null;
  for (const seg of tr.segments) {
    const text = String(seg.text).trim(); if (!text) continue;
    const host = hostShot(seg.start, seg.end);
    const present = host?.subjects ?? [];
    let speaker = null, how = 'indécidable';
    if (present.length === 1) { speaker = present[0]; how = 'seul à l\'image'; }
    else if (present.length === 2) { speaker = present.find((p) => p !== last) ?? present[0]; how = 'champ/contre-champ'; }
    else if (present.length > 2 && last && present.includes(last)) { speaker = last; how = 'continuité'; }
    lines.push({ start: seg.start, end: seg.end, text, shot: host?.id ?? null, speaker, how });
    if (speaker) last = speaker;
  }
}

// `audio` par plan : « Nom : réplique / Nom : réplique », et le détail dans `lines`
for (const s of doc.shots) {
  const mine = lines.filter((l) => { const ov = overlap(l.start, l.end, s); return ov > 0 && (ov >= 0.3 || ov >= (l.end - l.start) * 0.5); });
  // une transcription refaite peut avoir retiré des lignes (hallucinations) : on ne garde rien de périmé
  if (!mine.length) { if (s.lines) { delete s.lines; s.audio = ''; } continue; }
  s.lines = mine.map((l) => ({ start: l.start, end: l.end, speaker: l.speaker, voice: l.voice ?? undefined, how: l.how, text: l.text }));
  s.audio = mine.map((l) => `${l.speaker ? name(l.speaker) : '?'} : ${l.text}`).join(' / ');
}
doc.provenance = { ...(doc.provenance ?? {}), speakers: mode };

const out = flag('-o', shotsFile);
writeFileSync(out, JSON.stringify(doc, null, 2));
const attributed = lines.filter((l) => l.speaker).length;
process.stderr.write(`[${mode}] ${lines.length} répliques, ${attributed} attribuées, ${lines.length - attributed} en « ? »\n`);
if (doc.voices) for (const [v, x] of Object.entries(doc.voices)) process.stderr.write(`   ${v} = ${x.name} (${x.seconds} s de co-présence)\n`);
for (const l of lines.slice(0, 10)) process.stderr.write(`   ${l.start.toFixed(2).padStart(6)}  ${(l.speaker ? name(l.speaker) : '?').padEnd(44).slice(0, 44)} ${l.text.slice(0, 50)}   (${l.shot ?? '—'}, ${l.how})\n`);
