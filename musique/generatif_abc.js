// ODIO — la partition de YuE2 : nos clips MIDI écrits dans son dialecte.
//
// YuE2 écrit d'abord une partition ABC (YuE2GenerateABC) puis la chante
// (YuE2GenerateMusic, dont l'entrée `abc` prend « an edited score »). Le
// dialecte natif est borné (~/YuE/skills/yue2-music/references/abc-editing.md,
// repris dans generatif_modeles.json, modeles.yue.partition) : deux voix
// monophoniques Vocal et Ins, les accords entre guillemets dans Vocal, un
// en-tête fixe, des groupes d'une à quatre mesures, des durées tirées d'une
// liste. Ce module écrit ce dialecte depuis des notes d'ODIO — c'est « notre
// propre sérialiseur » de l'étude (docs/etudes/musique_generatif.md § 1.5) —
// et ne le lit pas : la lecture, et le jugement, sont ceux d'abc_tools.py
// côté serveur (POST /api/music/yue/abc/check), la seule vérité.
//
// Ce qui passe : une ligne de chant (Vocal), une ligne de thème (Ins), les
// accords, le tempo, la mesure, la tonalité (majeur ou mineur), les
// sections. Ce qui ne passe pas : batterie, ligne de basse, polyphonie (on
// garde la note la plus haute), triolets — l'étude § 1.5.

import { isMajorish } from './generatif_modeles.js';

const NAT = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// le nombre d'altérations de chaque armure (abc_tools.py, KEYS)
const MAJ = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MIN = ['Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];
const COUNT = Object.fromEntries([
  ...['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'].map((k, i) => [k, i - 7]),
  ...['Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m'].map((k, i) => [k, i - 7]),
]);
const DURS = [48, 32, 24, 16, 12, 8, 6, 4, 3, 2, 1];
export const VOICES = ['V: Vocal clef=treble name="Vocal Melody" snm="Vocal"', 'V: Ins clef=treble name="Ins Melody" snm="Inst."'];

export const abcKey = (key) => (isMajorish(key?.mode || 'minor') ? MAJ : MIN)[key?.tonic ?? 9];
function keyAlt(key) {
  const n = COUNT[key], alt = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  for (const l of (n > 0 ? 'FCGDAEB' : 'BEADGCF').slice(0, Math.abs(n))) alt[l] = n > 0 ? 1 : -1;
  return alt;
}

// Une hauteur MIDI dans le dialecte (C = do4 = 60, c = do5, C, = do3, c' =
// do6) ; l'altération seulement si l'armure et la mesure ne la donnent pas
// déjà (elle vaut pour la lettre à toutes les octaves : abc-editing.md).
// La même règle que music_yue.abc_note.
export function noteToken(pitch, key, local) {
  const ka = keyAlt(key), count = COUNT[key], pc = ((pitch % 12) + 12) % 12;
  const cands = [];
  for (const [l, n] of Object.entries(NAT)) for (const a of [0, 1, -1]) if ((((n + a) % 12) + 12) % 12 === pc) cands.push([l, a]);
  const rank = ([l, a]) => [a !== ka[l] ? 1 : 0, a !== 0 ? 1 : 0, (count >= 0 ? a < 0 : a > 0) ? 1 : 0];
  cands.sort((x, y) => { const rx = rank(x), ry = rank(y); for (let i = 0; i < 3; i++) if (rx[i] !== ry[i]) return rx[i] - ry[i]; return 0; });
  const [l, a] = cands[0];
  const cur = l in local ? local[l] : ka[l];
  const acc = cur === a ? '' : ({ 0: '=', 1: '^', '-1': '_' })[a];
  if (acc) local[l] = a;
  const oct = Math.floor((pitch - a) / 12) - 1;
  return oct <= 4 ? acc + l + ','.repeat(4 - oct) : acc + l.toLowerCase() + "'".repeat(oct - 5);
}
export function durs(u) { const out = []; while (u > 0) { const d = DURS.find((x) => x <= u); out.push(d); u -= d; } return out; }

// ── réduire nos notes à ce que le dialecte prend ────────────
// La note la plus haute à chaque instant (une ligne monophonique : deux
// notes qui se chevauchent sont refusées par le dialecte) ; une note s'arrête
// où la suivante commence. Notes : { s, l, p } en doubles-croches.
export function skyline(notes) {
  const q = notes.map((n) => ({ s: Math.max(0, Math.round(n.s)), e: Math.round(n.s + n.l), p: n.p })).filter((n) => n.e > n.s)
    .sort((a, b) => a.s - b.s || b.p - a.p);
  const out = [];
  let dropped = 0;
  for (const n of q) {
    const last = out[out.length - 1];
    if (last && n.s < last.e) {
      if (n.s === last.s) { dropped++; continue; }                        // même attaque : la plus haute est déjà là
      if (n.p < last.p && n.e <= last.e) { dropped++; continue; }         // sous une note qui la couvre : cachée
      last.e = n.s;                                                        // la suivante coupe la précédente
    }
    out.push({ ...n });
  }
  return { notes: out.filter((n) => n.e > n.s), dropped };
}

// Reconnaître un accord : l'ensemble des classes de hauteur qui sonnent
// ensemble, lu contre les 15 qualités du dialecte (schéma,
// partition.intervalles) ; la basse d'abord comme racine, sinon une autre
// note et la basse en barre oblique ; sinon la plus grande qualité contenue.
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export function chordName(pitches, key, intervals) {
  const names = COUNT[key] < 0 ? FLAT : SHARP;
  const bass = Math.min(...pitches), bpc = bass % 12;
  const pcs = [...new Set(pitches.map((p) => p % 12))];
  if (pcs.length < 3) return null;
  const roots = [bpc, ...pcs.filter((x) => x !== bpc)];
  const setOf = (r) => new Set(pcs.map((x) => (x - r + 12) % 12));
  for (const exact of [true, false]) {
    let best = null;
    for (const r of roots) {
      const have = setOf(r);
      for (const [q, iv] of Object.entries(intervals)) {
        const ok = exact ? iv.length === have.size && iv.every((x) => have.has(x)) : iv.every((x) => have.has(x));
        if (ok && (!best || iv.length > best.n)) best = { r, q, n: iv.length };
      }
      if (best && exact) break;
    }
    if (best) return `${names[best.r]}${best.q}${best.r !== bpc ? `/${names[bpc]}` : ''}`;
  }
  return null;
}
// les accords d'un clip : à chaque attaque où trois classes de hauteur au
// moins sonnent, un symbole ; seulement quand il change
export function chordsFromNotes(notes, key, intervals) {
  const q = notes.map((n) => ({ s: Math.max(0, Math.round(n.s)), e: Math.round(n.s + n.l), p: n.p })).filter((n) => n.e > n.s);
  const times = [...new Set(q.map((n) => n.s))].sort((a, b) => a - b);
  const out = [];
  for (const t of times) {
    const on = q.filter((n) => n.s <= t && n.e > t).map((n) => n.p);
    const name = on.length >= 3 ? chordName(on, key, intervals) : null;
    if (name && name !== out[out.length - 1]?.name) out.push({ t, name });
  }
  return out;
}

// ── écrire la partition ─────────────────────────────────────
// { bpm, sig, key, bars, sections: [[tag, mesures]], vocal, ins : [{ s, e, p }]
// (doubles-croches depuis le début de la région), chords: [{ t, name }] }
export function writeAbc({ bpm, sig, key, bars, sections, vocal = [], ins = [], chords = [], meter }) {
  const K = abcKey(key), U = sig * 4;
  const lines = ['X:1', 'T:', `M:${meter || `${sig}/4`}`, 'L:1/16', `Q:1/4=${Math.round(bpm)}`, ...VOICES, `K:${K}`];
  const voiceBars = (notes, withChords) => {
    const out = [];
    for (let b = 0; b < bars; b++) {
      const a0 = b * U, a1 = a0 + U;
      const cuts = new Set([a0, a1]);
      for (const n of notes) { if (n.e > a0 && n.s < a1) { cuts.add(Math.max(a0, n.s)); cuts.add(Math.min(a1, n.e)); } }
      const bc = withChords ? chords.filter((c) => c.t >= a0 && c.t < a1) : [];
      for (const c of bc) cuts.add(c.t);
      const pts = [...cuts].sort((x, y) => x - y);
      const local = {};
      let body = '';
      if (!withChords && !notes.some((n) => n.e > a0 && n.s < a1)) { out.push('Z'); continue; }
      for (let i = 0; i + 1 < pts.length; i++) {
        const t0 = pts[i], t1 = pts[i + 1];
        const ch = bc.find((c) => c.t === t0);
        if (ch) body += `"${ch.name}"`;
        const n = notes.find((x) => x.s <= t0 && x.e > t0);
        const parts = durs(t1 - t0);
        if (!n) { body += parts.map((d) => (d === 1 ? 'z' : `z${d}`)).join(''); continue; }
        const tok = noteToken(n.p, K, local);
        const tied = n.e > t1;                                   // la note continue au-delà de ce morceau
        body += parts.map((d, k) => `${tok}${d === 1 ? '' : d}${k < parts.length - 1 || tied ? '-' : ''}`).join('');
      }
      out.push(body);
    }
    return out;
  };
  const V = voiceBars(vocal, true), I = voiceBars(ins, false);
  let b = 0;
  const secs = sections?.length ? sections : [['verse', bars]];
  for (const [tag, n] of secs) {
    for (let g = 0; g < n && b < bars; g += 4) {
      const size = Math.min(4, n - g, bars - b);
      const iv = I.slice(b, b + size);
      const insLine = iv.every((x) => x === 'Z') ? (size === 1 ? 'Z|' : `Z${size}|`) : `${iv.join('|')}|`;
      lines.push(`% ${tag}`, 'V: Vocal', `${V.slice(b, b + size).join('|')}|`, 'V: Ins', insLine);
      b += size;
    }
  }
  return lines.join('\n');
}

// Un symbole du dialecte (« F#m7/C# ») en notes tenues : la racine et ses
// intervalles (schéma, partition.intervalles), la basse en barre oblique une
// octave sous ; [début, durée, hauteur, vélocité, canal 2] en noires.
export function chordToNotes(name, t, l, intervals) {
  const m = /^([A-G])(bb|##|b|#)?(.*?)(?:\/([A-G])(bb|##|b|#)?)?$/.exec(name || '');
  if (!m || !(m[3] in intervals)) return [];
  const acc = { '#': 1, '##': 2, b: -1, bb: -2 };
  const root = (NAT[m[1]] + (acc[m[2]] || 0) + 12) % 12;
  const out = intervals[m[3]].map((x) => [t, l, 48 + root + x, 0.7, 2]);
  if (m[4]) out.push([t, l, 36 + ((NAT[m[4]] + (acc[m[5]] || 0) + 12) % 12), 0.7, 2]);
  return out;
}

// Les sections d'une partition (les commentaires « % tag » et les mesures de
// chaque groupe) : pour réécrire une partition en gardant sa forme.
export function sectionsOf(text) {
  const out = [];
  let tag = 'verse', want = false;
  for (const ln of (text || '').split(/\r?\n/)) {
    const l = ln.trim();
    if (l.startsWith('% ')) { tag = l.slice(2).trim() || tag; continue; }
    if (l === 'V: Vocal') { want = true; continue; }
    if (want && l.endsWith('|')) {                  // la ligne de musique de Vocal : ses mesures (Z2… comptent pour 2…)
      const n = l.slice(0, -1).split('|').reduce((k, bar) => { const m = bar.trim().match(/^Z([2-4])?$/); return k + (m ? +(m[1] || 1) : 1); }, 0);
      const last = out[out.length - 1];
      if (last && last[0] === tag) last[1] += n; else out.push([tag, n]);
      want = false;
    }
  }
  return out;
}

// Le rapport d'abc_tools (onsets et durées en fractions de noire) en notes
// d'ODIO : doubles-croches depuis le début de la partition.
const frac = (s) => { const [a, b] = String(s).split('/'); return +a / (+b || 1); };
export function reportVoices(rep) {
  const v = (name) => (rep?.voices?.[name]?.notes || []).map((n) => ({ s: Math.round(frac(n.onset_quarters) * 4), e: Math.round((frac(n.onset_quarters) + frac(n.duration_quarters)) * 4), p: n.midi_pitch }));
  return { vocal: v('Vocal'), ins: v('Ins'), chords: (rep?.voices?.Vocal?.chords || []).map(([t, name]) => ({ t: Math.round(frac(t) * 4), name })),
    bars: rep?.voices?.Vocal?.measures || 0, bpm: rep?.bpm };
}
