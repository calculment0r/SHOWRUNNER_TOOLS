#!/usr/bin/env node
/**
 * shots.json (video-shots) → projet SceneFlow.
 *
 * SceneFlow synchronise un script avec une vidéo à partir de « cues » :
 * { type, selectedText, startTime, endTime }. Il dit lui-même ne pas savoir
 * les extraire automatiquement. Notre dépouillement produit exactement ça,
 * avec des bornes MESURÉES par ffmpeg — pas estimées par un modèle.
 *
 * Le script généré est la table des plans, écrite comme un découpage
 * technique ; chaque cue cite mot pour mot un passage de ce script, avec ses
 * offsets, comme l'exige l'import de SceneFlow (selectedText verbatim +
 * startIndex/endIndex).
 *
 * Correspondance des vocabulaires (5 chez nous → 8 types SceneFlow) :
 *   chaque plan              → shot        (échelle + description, bornes du plan)
 *   camera ≠ static          → camera      (le mouvement, sur toute la durée du plan)
 *   audio non vide           → dialogue    (speaker = premier sujet du casting)
 *   onscreenText non vide    → vfx         (texte incrusté : c'est du compositing)
 *   transitionIn ≠ cut       → transition  (0,5 s autour de la coupe)
 *   establishing / empty     → environment (le décor, sur toute la durée)
 *   rhythm                   → action      (le rôle de rythme + sa raison)
 *
 *   node sceneflow-export.mjs shots.json [--youtube <id|url>] [-o projet.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [file, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(n); return i < 0 ? d : rest[i + 1]; };
if (!file) { console.error('usage: sceneflow-export.mjs shots.json [--youtube id] [-o projet.json]'); process.exit(1); }

const doc = JSON.parse(readFileSync(file, 'utf8'));
const lang = ['en', 'fr'].includes(doc.lang) ? doc.lang : 'zh';

/* ------------------------------------------------ libellés lisibles ---- */
// On ne réimporte pas le skill : les libellés sont recopiés depuis ses tables,
// dans la langue du document, pour que le script soit lisible tel quel.
const L = {
  fr: {
    sizes: { none: 'sans échelle', 'extreme-wide': 'plan général', wide: "plan d'ensemble", 'medium-wide': 'plan moyen', medium: 'plan américain', 'medium-close': 'plan rapproché', close: 'gros plan', 'extreme-close': 'très gros plan' },
    cams: { static: 'fixe', 'push-in': 'travelling avant', 'pull-out': 'travelling arrière', 'zoom-in': 'zoom avant', 'zoom-out': 'zoom arrière', 'pan-left': 'panoramique gauche', 'pan-right': 'panoramique droite', 'tilt-up': 'panoramique vertical haut', 'tilt-down': 'panoramique vertical bas', 'truck-left': 'travelling latéral gauche', 'truck-right': 'travelling latéral droite', 'pedestal-up': 'montée verticale', 'pedestal-down': 'descente verticale', tracking: "travelling d'accompagnement", arc: 'travelling circulaire', 'whip-pan': 'filé', handheld: "caméra à l'épaule", shake: 'secousses', 'rack-focus': 'changement de point', 'micro-push': 'micro-travelling avant', roll: 'rotation', drone: 'drone' },
    trans: { cut: 'coupe franche', dissolve: 'fondu enchaîné', 'fade-in': 'ouverture en fondu', 'fade-out': 'fermeture en fondu', whip: 'coupe filée', 'match-cut': 'raccord graphique', wipe: 'volet', morph: 'transition truquée' },
    rhythms: { hook: 'accroche', setup: 'mise en place', build: 'montée', beat: 'accent', turn: 'bascule', payoff: 'récompense', breath: 'respiration', close: 'chute' },
    title: 'DÉCOUPAGE TECHNIQUE', shot: 'PLAN', cam: 'CAMÉRA', text: 'TEXTE À L\'IMAGE', rhythm: 'RYTHME', trans: 'TRANSITION',
  },
  en: {
    sizes: { none: 'n/a', 'extreme-wide': 'extreme wide', wide: 'wide', 'medium-wide': 'medium wide', medium: 'medium', 'medium-close': 'medium close', close: 'close-up', 'extreme-close': 'extreme close-up' },
    cams: { static: 'static', 'push-in': 'push in', 'pull-out': 'pull out', 'zoom-in': 'zoom in', 'zoom-out': 'zoom out', 'pan-left': 'pan left', 'pan-right': 'pan right', 'tilt-up': 'tilt up', 'tilt-down': 'tilt down', 'truck-left': 'truck left', 'truck-right': 'truck right', 'pedestal-up': 'pedestal up', 'pedestal-down': 'pedestal down', tracking: 'tracking', arc: 'arc', 'whip-pan': 'whip pan', handheld: 'handheld', shake: 'shake', 'rack-focus': 'rack focus', 'micro-push': 'micro push', roll: 'roll', drone: 'drone' },
    trans: { cut: 'cut', dissolve: 'dissolve', 'fade-in': 'fade in', 'fade-out': 'fade out', whip: 'whip', 'match-cut': 'match cut', wipe: 'wipe', morph: 'morph' },
    rhythms: { hook: 'hook', setup: 'setup', build: 'build', beat: 'beat', turn: 'turn', payoff: 'payoff', breath: 'breath', close: 'close' },
    title: 'SHOT LIST', shot: 'SHOT', cam: 'CAMERA', text: 'ON-SCREEN TEXT', rhythm: 'RHYTHM', trans: 'TRANSITION',
  },
};
L.zh = L.en; // le libellé chinois vit dans le skill ; ici on retombe sur l'anglais
const T = L[lang];
const label = (table, k) => T[table]?.[k] ?? k;
const castName = (id) => (doc.cast ?? []).find((c) => c.id === id)?.name ?? id;
const tc = (s) => { const m = Math.floor(s / 60); return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}`; };
const r2 = (n) => Math.round(n * 100) / 100;

/* -------------------------------------- script + cues, en un seul passage -- */
// On écrit le script et on note l'offset de chaque phrase au moment où on la
// pose : selectedText est garanti verbatim et les index sont exacts.
let script = `${T.title} — ${doc.title ?? doc.source ?? ''}\n\n`;
const cues = [];
let n = 0;
const put = (text) => { const start = script.length; script += text; return { start, end: script.length }; };
const cue = (type, span, startTime, endTime, extra = {}) => {
  cues.push({
    id: `c${++n}`, type, speaker: null,
    selectedText: script.slice(span.start, span.end),
    startIndex: span.start, endIndex: span.end,
    startTime: r2(startTime), endTime: r2(endTime), ...extra,
  });
};

for (const s of doc.shots) {
  const head = put(`${T.shot} ${s.id} · ${tc(s.start)} → ${tc(s.end)} · ${s.seconds}s`);
  script += '\n';

  // le plan lui-même : échelle + description → shot
  const size = label('sizes', s.size);
  const desc = put(`${size ? size.toUpperCase() + '. ' : ''}${s.frame ?? ''}`);
  script += '\n';
  cue('shot', desc, s.start, s.end);

  // le décor, sur les plans d'exposition et d'ambiance → environment
  if (s.category === 'establishing' || s.category === 'empty') cue('environment', head, s.start, s.end);

  // le mouvement de caméra, s'il y en a un → camera
  if (s.camera && s.camera !== 'static') {
    const cam = put(`${T.cam} : ${label('cams', s.camera)}`);
    script += '\n';
    cue('camera', cam, s.start, s.end);
  }

  // la réplique → dialogue, avec le locuteur si le casting le donne
  if (s.audio && String(s.audio).trim()) {
    const who = (s.subjects ?? [])[0];
    const speaker = who ? castName(who) : null;
    if (speaker) { script += `${speaker.toUpperCase()}\n`; }
    const line = put(String(s.audio).trim());
    script += '\n';
    cue('dialogue', line, s.start, s.end, { speaker: speaker ? speaker.toUpperCase() : null });
  }

  // le texte incrusté → vfx
  if (s.onscreenText && String(s.onscreenText).trim()) {
    const txt = put(`${T.text} : ${String(s.onscreenText).trim()}`);
    script += '\n';
    cue('vfx', txt, s.start, s.end);
  }

  // la transition d'entrée → transition, resserrée autour de la coupe
  if (s.transitionIn && s.transitionIn !== 'cut') {
    const tr = put(`${T.trans} : ${label('trans', s.transitionIn)}`);
    script += '\n';
    cue('transition', tr, Math.max(0, s.start - 0.5), s.start + 0.5);
  }

  // le rôle de rythme et sa raison → action
  if (s.rhythm) {
    const rh = put(`${T.rhythm} : ${label('rhythms', s.rhythm)}${s.rhythmNote ? ' — ' + s.rhythmNote : ''}`);
    script += '\n';
    cue('action', rh, s.start, s.end);
  }
  script += '\n';
}

/* ------------------------------------------------------------- projet -- */
const project = {
  // SceneFlow ne lit que YouTube. Sans id on note la source locale : le lecteur
  // restera vide mais le projet se charge (loadRemoteProject exige un youtubeId).
  youtubeId: flag('--youtube', `local:${doc.source ?? file}`),
  scriptText: script,
  cues,
  settings: {
    general: { before: 0, after: 0 },
    dialogue: { before: 0.3, after: 0.5 },
    action: { before: 0, after: 0 }, camera: { before: 0, after: 0 }, shot: { before: 0, after: 0 },
    audio: { before: 0, after: 0 }, vfx: { before: 0, after: 0 }, transition: { before: 0, after: 0 },
    environment: { before: 0, after: 0 },
  },
};

// contrôle : chaque cue cite bien le script, à l'offset annoncé
for (const c of cues) {
  if (script.slice(c.startIndex, c.endIndex) !== c.selectedText) throw new Error(`${c.id} : le passage cité ne correspond pas aux offsets`);
}

const out = flag('-o');
const text = JSON.stringify(project, null, 2);
if (out) writeFileSync(out, text); else process.stdout.write(text);
const byType = cues.reduce((m, c) => ((m[c.type] = (m[c.type] ?? 0) + 1), m), {});
process.stderr.write(`${doc.shots.length} plans → ${cues.length} cues SceneFlow (${Object.entries(byType).map(([k, v]) => `${v} ${k}`).join(', ')}), script de ${script.length} caractères\n`);
