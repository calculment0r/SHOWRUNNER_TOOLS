#!/usr/bin/env node
/**
 * Adhérence : ce que le script DÉCLARE (cues SceneFlow) contre ce que la vidéo
 * MONTRE (plans mesurés par video-shots + jugés par le VLM).
 *
 * SceneFlow a été écrit pour ça — « évaluer comment un modèle vidéo suit le
 * prompt » — mais l'évaluation y est faite à l'œil. Ici elle est calculée :
 *
 *   coupe     le cue commence-t-il sur une coupe mesurée ?           (±tolérance)
 *   caméra    LOCKOFF déclaré mais motion mesurée élevée → dérive
 *             TRACKING/DOLLY déclaré mais motion ≈ 0 → le mouvement n'a pas eu lieu
 *   échelle   WS/MS/MCU/CU déclaré contre l'échelle jugée par le VLM
 *
 * Verdicts : ✓ tenu · ✗ contredit par les pixels · ? invérifiable (pas de mesure)
 *
 *   node adherence.mjs projet-sceneflow.json shots.json --track track.json [-o adherence.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [projectFile, shotsFile, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(n); return i < 0 ? d : rest[i + 1]; };
if (!projectFile || !shotsFile) { console.error('usage: adherence.mjs projet.json shots.json --track track.json'); process.exit(1); }

const project = JSON.parse(readFileSync(projectFile, 'utf8'));
const doc = JSON.parse(readFileSync(shotsFile, 'utf8'));
const track = flag('--track') ? JSON.parse(readFileSync(flag('--track'), 'utf8')) : null;
const P = { cutTolerance: 0.5, staticMaxMotion: 1.5, busyMinMotion: 12, ...(doc.params ?? {}) };

/* ------------------------------------------- lire le vocabulaire du script -- */
// Les cues caméra de SceneFlow sont du texte libre de plateau : « MCU, LOCKOFF,
// eye level… ». On en extrait l'échelle et le mouvement quand ils y sont.
// Anglais de plateau (les scripts SceneFlow) et français de découpage (nos exports).
const SIZE_WORDS = [
  [/\b(EWS|ELS|extreme wide|extreme long|plan général|très grand ensemble)\b/i, 'extreme-wide'],
  [/\b(MWS|MLS|medium wide|medium long|plan moyen)\b/i, 'medium-wide'],
  [/\b(WS|LS|wide shot|wide|long shot|plan d'ensemble)\b/i, 'wide'],
  [/\b(MCU|medium close|plan rapproché)\b/i, 'medium-close'],
  [/\b(MS|medium shot|medium|plan américain|plan taille)\b/i, 'medium'],
  [/\b(ECU|XCU|TCU|extreme close|tight close|très gros plan)\b/i, 'extreme-close'],
  [/\b(CU|close[- ]?up|close|gros plan)\b/i, 'close'],
];
const MOVE_WORDS = [
  [/\b(lock-?off|locked|static|tripod|fixed|fixe)\b/i, 'static'],
  [/\b(hand-?held|à l'épaule)\b/i, 'handheld'],
  [/\b(whip|filé)\b/i, 'whip-pan'],
  [/\b(tracking|steadicam|dolly|push|pull|truck|crane|jib|orbit|arc|zoom|pan|tilt|drone|aerial|travelling|panoramique|grue|montée verticale|descente verticale|rotation)\b/i, 'strong'],
];
const STRONG = new Set(['push-in', 'pull-out', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'tilt-up', 'tilt-down',
  'truck-left', 'truck-right', 'pedestal-up', 'pedestal-down', 'tracking', 'arc', 'whip-pan', 'shake', 'roll', 'drone']);
const parse = (text) => ({
  size: (SIZE_WORDS.find(([re]) => re.test(text)) ?? [])[1] ?? null,
  move: (MOVE_WORDS.find(([re]) => re.test(text)) ?? [])[1] ?? null,
});

/* ------------------------------------------------------ mesures par cue -- */
const cuts = [0, ...doc.shots.slice(1).map((s) => s.start)];
const nearestCut = (t) => cuts.reduce((best, c) => (Math.abs(c - t) < Math.abs(best - t) ? c : best), cuts[0]);
const overlapping = (a, b) => doc.shots.filter((s) => s.end > a && s.start < b);
const median = (xs) => { if (!xs.length) return null; const v = [...xs].sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
const motionBetween = (a, b) => {
  if (!track?.values?.length) return null;
  const hz = track.hz ?? 5;
  const seg = track.values.slice(Math.ceil(a * hz) + 1, Math.floor(b * hz) - 1).filter((v) => v != null);
  return seg.length >= 3 ? Math.round(median(seg) * 10) / 10 : null;
};
const dominant = (shots, key) => {
  const w = {};
  for (const s of shots) if (s[key]) w[s[key]] = (w[s[key]] ?? 0) + s.seconds;
  return Object.entries(w).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
};

const rows = [];
for (const cue of project.cues.filter((c) => c.type === 'camera' || c.type === 'shot')) {
  const claim = parse(cue.selectedText);
  const shots = overlapping(cue.startTime, cue.endTime);
  const cut = nearestCut(cue.startTime);
  const motion = motionBetween(cue.startTime, cue.endTime);
  const seenSize = dominant(shots, 'size');
  const seenCam = dominant(shots, 'camera');
  const row = { id: cue.id, start: cue.startTime, end: cue.endTime, text: cue.selectedText, claim, measured: { cut, motion, size: seenSize, camera: seenCam }, checks: {} };

  // 1. la coupe : le cue démarre-t-il sur une coupe mesurée ?
  const dCut = Math.abs(cut - cue.startTime);
  row.checks.cut = { verdict: dCut <= P.cutTolerance ? 'ok' : 'off', delta: Math.round((cut - cue.startTime) * 100) / 100 };

  // 2. la caméra : la direction que les pixels peuvent contredire
  if (claim.move && motion != null) {
    if (claim.move === 'static' && motion > P.busyMinMotion) row.checks.camera = { verdict: 'off', why: `LOCKOFF déclaré, motion mesurée ${motion} (> ${P.busyMinMotion})` };
    else if (claim.move === 'strong' && motion <= P.staticMaxMotion) row.checks.camera = { verdict: 'off', why: `mouvement déclaré, motion mesurée ${motion} (≤ ${P.staticMaxMotion}) — rien n'a bougé` };
    else row.checks.camera = { verdict: 'ok', why: `motion mesurée ${motion}` };
    if (seenCam) row.checks.camera.vlm = seenCam;
  } else row.checks.camera = { verdict: 'na', why: claim.move ? 'pas de courbe de mouvement' : 'aucun mouvement déclaré' };

  // 3. l'échelle : déclarée contre jugée (le VLM peut se tromper d'un cran, on le dit)
  if (claim.size && seenSize) {
    const ladder = ['none', 'extreme-wide', 'wide', 'medium-wide', 'medium', 'medium-close', 'close', 'extreme-close'];
    const gap = Math.abs(ladder.indexOf(claim.size) - ladder.indexOf(seenSize));
    row.checks.size = { verdict: gap === 0 ? 'ok' : gap === 1 ? 'near' : 'off', declared: claim.size, seen: seenSize, gap };
  } else row.checks.size = { verdict: 'na' };

  rows.push(row);
}

/* -------------------------------------------------------------- bilan -- */
const count = (k, v) => rows.filter((r) => r.checks[k]?.verdict === v).length;
const testable = (k) => rows.filter((r) => r.checks[k] && r.checks[k].verdict !== 'na').length;
const summary = {
  cues: rows.length,
  cut: { ok: count('cut', 'ok'), off: count('cut', 'off') },
  camera: { ok: count('camera', 'ok'), off: count('camera', 'off'), testable: testable('camera') },
  size: { ok: count('size', 'ok'), near: count('size', 'near'), off: count('size', 'off'), testable: testable('size') },
};
const pct = (a, b) => (b ? Math.round((a / b) * 100) + ' %' : '—');
const mark = { ok: '✓', near: '≈', off: '✗', na: '?' };

process.stdout.write(`\nADHÉRENCE — ${doc.title ?? ''} : ${rows.length} cues caméra/plan déclarés\n\n`);
for (const r of rows) {
  const c = r.checks;
  process.stdout.write(`${String(r.start).padStart(5)}→${String(r.end).padEnd(5)} ${mark[c.cut.verdict]} coupe ${c.cut.delta >= 0 ? '+' : ''}${c.cut.delta}s  ${mark[c.camera.verdict]} caméra${c.camera.vlm ? ' (VLM: ' + c.camera.vlm + ')' : ''}  ${mark[c.size.verdict]} échelle${c.size.declared ? ' ' + c.size.declared + '→' + c.size.seen : ''}\n`);
  process.stdout.write(`             « ${r.text.slice(0, 70)} »${c.camera.verdict === 'off' ? '\n             ⚠ ' + c.camera.why : ''}\n`);
}
process.stdout.write(`\ncoupes tenues ${summary.cut.ok}/${rows.length} (${pct(summary.cut.ok, rows.length)}) · caméra tenue ${summary.camera.ok}/${summary.camera.testable} (${pct(summary.camera.ok, summary.camera.testable)}) · échelle exacte ${summary.size.ok}/${summary.size.testable}, à un cran ${summary.size.near}\n`);

const out = flag('-o');
if (out) writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
