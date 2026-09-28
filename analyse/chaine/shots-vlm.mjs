#!/usr/bin/env node
/**
 * shots-vlm — remplit les champs « modèle » de shots.json avec un VLM local
 * (endpoint OpenAI-compatible : vLLM / SGLang sur DGX).
 *
 * La ligne de partage du skill video-shots est conservée telle quelle :
 *   le code mesure (cuts, durées, motion)   → jamais touché ici
 *   le modèle juge (size/category/camera/frame/rhythm) → c'est ce qu'on remplit
 *   le code vérifie (15 portes)             → validate() importé et rejoué en boucle
 *
 * Deux garde-fous structurels, parce qu'un VLM local hallucine plus qu'un agent :
 *   1. l'énum `camera` est RESTREINTE par la motion mesurée AVANT l'appel
 *      → la porte « 运镜实测对账 » devient impossible à faire échouer
 *   2. les catégories à preuve (dialogue/reaction/text-card/empty) sont coercées
 *      a posteriori, chaque coercition étant loggée sur stderr
 *
 * Usage :
 *   node shots-vlm.mjs annotate shots.json --frames frames --track track.json \
 *     --api http://127.0.0.1:8000/v1 --model Qwen3-VL-32B-Instruct -o shots.out.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ---------------------------------------------------------------- args -- */
const argv = process.argv.slice(2);
const cmd = argv[0];
const rest = argv.slice(1);
const flag = (name, def = null) => {
  const i = rest.indexOf(name);
  if (i < 0) return def;
  const next = rest[i + 1];
  return next === undefined || next.startsWith('--') ? true : next;
};
const has = (name) => rest.includes(name);
const positional = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')));

/* --------------------------------------------------- charger le skill -- */
const SKILL_CANDIDATES = [
  flag('--skill'),
  process.env.VIDEO_SHOTS_MJS,
  join(HERE, '..', 'skills', 'video-shots', 'scripts', 'video-shots.mjs'),
  join(process.env.HOME ?? '', '.claude', 'skills', 'video-shots', 'scripts', 'video-shots.mjs'),
  join(process.env.HOME ?? '', '.codex', 'skills', 'video-shots', 'scripts', 'video-shots.mjs'),
].filter((p) => typeof p === 'string' && p);
const skillPath = SKILL_CANDIDATES.find((p) => existsSync(p));
if (!skillPath) {
  console.error('video-shots.mjs introuvable — passe --skill <chemin>');
  process.exit(1);
}
const S = await import(`file://${resolve(skillPath)}`);

/* ------------------------------------------------------ vocabulaires -- */
const nameOf = (table, key, lang) => table[key][lang] ?? table[key].zh;
const listVocab = (table, lang, keys = Object.keys(table)) =>
  keys.map((k) => `  ${k} = ${nameOf(table, k, lang)}`).join('\n');

/** Énum caméra autorisée pour ce plan, selon la motion MESURÉE. */
export function camerasFor(shot, p) {
  const all = Object.keys(S.CAMERA_MOVES);
  const m = shot.motion;
  const measurable = Number(shot.seconds) >= p.motionGateMinSeconds && m != null && Number.isFinite(Number(m));
  if (!measurable) return all;
  if (Number(m) <= p.staticMaxMotion) return all.filter((k) => S.CAMERA_MOVES[k].motion !== 'strong');
  return all;
}

/* --------------------------------------------------------- schéma JSON -- */
export function schemaFor(shot, doc, p, opts) {
  const lang = opts.lang;
  const castIds = (doc.cast ?? []).map((c) => c.id);
  const cams = camerasFor(shot, p);
  const cats = Object.keys(S.SHOT_CATEGORIES).filter((k) => !(k === 'reaction' && !castIds.length));
  const props = {
    size: { type: 'string', enum: Object.keys(S.SHOT_SIZES) },
    category: { type: 'string', enum: cats },
    camera: { type: 'string', enum: cams },
    transitionIn: { type: 'string', enum: Object.keys(S.TRANSITIONS) },
    subjects: castIds.length
      ? { type: 'array', items: { type: 'string', enum: castIds } }
      : { type: 'array', items: { type: 'string' }, maxItems: 0 },
    // minLength : certains backends de decoding contraint (xgrammar) l'ignorent ou
    // le refusent → --no-min-length le retire, la porte le rattrapera en réparation.
    frame: opts.minLength === false ? { type: 'string' }
      : { type: 'string', minLength: lang === 'zh' ? p.minFrameChars : p.minFrameWords * 6 },
    onscreenText: { type: 'string' },
    audio: { type: 'string' },
  };
  if (opts.rhythm) {
    props.rhythm = { type: 'string', enum: Object.keys(S.RHYTHM_ROLES) };
    props.rhythmNote = opts.minLength === false ? { type: 'string' }
      : { type: 'string', minLength: lang === 'zh' ? p.minRhythmChars : p.minRhythmWords * 6 };
  }
  return { type: 'object', additionalProperties: false, required: Object.keys(props), properties: props };
}

const LANGS = ['zh', 'en', 'fr'];

const MODEL_FIELDS = ['size', 'category', 'camera', 'transitionIn', 'subjects', 'frame', 'onscreenText', 'audio', 'rhythm', 'rhythmNote'];

/* ------------------------------------------------------------ prompts -- */
/** Les consignes, dans les trois langues du skill. */
const PROMPTS = {
  zh: {
    role: '你在做拉片：看一个镜头的首尾两帧，只判断景别、类别、运镜、画面描述和节奏角色。',
    frames: '两张图：第一张是镜头起手（15% 处），第二张是收尾（85% 处）。',
    reading: '取景变了 → 推拉摇移；取景没变、只有主体动 → 固定机位。',
    heads: { size: '景别', cat: '类别', cam: '运镜', trans: '转场', rhythm: '节奏角色', cast: '人物表（subjects 只能填这些编号）' },
    frameRule: (p) => `画面描述（frame）：写看得见的东西，${p.minFrameChars} 字起。不许空话，不许用「这个镜头/本镜头」开头。`,
    evidence: '证据规则：dialogue 必须有台词进 audio（画面烧录的字幕算台词）；text-card 必须有 onscreenText；empty 里不许有人。没有台词就判 subject，别判 dialogue。',
    noAsr: '没有语音转写：audio 只来自画面上烧录的字幕，读不到就留空字符串。',
    json: '只输出 JSON，不要解释。',
    lang: '画面描述、台词、节奏理由全部用中文写。',
    noCast: '  （没有声明人物，subjects 必须留空）',
  },
  en: {
    role: 'You are doing a shot breakdown. From the first and last frame of one shot, judge only: size, category, camera, frame description, rhythm.',
    frames: 'Two images: first = 15% into the shot, second = 85% in.',
    reading: 'Framing changed → push/pull/pan/truck. Framing identical, only the subject moved → static camera.',
    heads: { size: 'SIZE', cat: 'CATEGORY', cam: 'CAMERA', trans: 'TRANSITION', rhythm: 'RHYTHM', cast: 'CAST (subjects may only use these ids)' },
    frameRule: (p) => `frame: describe what is visible, ${p.minFrameWords} words minimum. No vague words (${S.VAGUE_WORDS_EN.slice(0, 5).join(', ')}), never start with "This shot" / "We see".`,
    evidence: 'Evidence rules: dialogue requires audio (burned-in subtitles count); text-card requires onscreenText; empty must have no subjects. No dialogue line, use subject instead.',
    noAsr: 'There is no speech transcription: audio comes only from burned-in on-screen subtitles; leave it empty otherwise.',
    json: 'Output JSON only, no prose.',
    lang: 'Write the frame description, the dialogue and the rhythm reason in English.',
    noCast: '  (no cast declared — subjects must stay empty)',
  },
  fr: {
    role: "Tu dépouilles un film plan par plan. À partir de la première et de la dernière image d'un plan, tu juges uniquement : l'échelle, la catégorie, le mouvement de caméra, la description de l'image et le rôle de rythme.",
    frames: "Deux images : la première est prise à 15 % du plan, la seconde à 85 %.",
    reading: "Le cadre a changé → travelling / panoramique / zoom. Le cadre est identique et seul le sujet a bougé → caméra fixe.",
    heads: { size: 'ÉCHELLE', cat: 'CATÉGORIE', cam: 'MOUVEMENT', trans: 'TRANSITION', rhythm: 'RYTHME', cast: 'CASTING (subjects ne peut contenir que ces identifiants)' },
    frameRule: (p) => `frame : décris ce qui est visible, ${p.minFrameWords} mots minimum. Pas de formule creuse (${S.VAGUE_WORDS_FR.slice(0, 5).join(', ')}), ne commence jamais par « ce plan » / « on voit ».`,
    evidence: "Règles de preuve : « dialogue » exige une réplique dans audio (les sous-titres incrustés comptent) ; « carton » exige onscreenText ; « plan d'ambiance » interdit tout sujet. Sans réplique, mets « sujet » et non « dialogue ».",
    noAsr: "Il n'y a aucune transcription de la parole : audio ne vient que des sous-titres incrustés à l'image ; sinon laisse la chaîne vide.",
    json: "Ne sors que du JSON, aucune explication.",
    lang: "TOUT est en français : la description, les répliques, la raison de rythme. Si le texte incrusté à l'image est dans une autre langue (chinois, anglais), traduis-le en français — ne recopie jamais les caractères d'origine.",
    noCast: "  (aucun personnage déclaré — subjects doit rester vide)",
  },
};

function systemPrompt(doc, p, opts) {
  const lang = opts.lang;
  const T = PROMPTS[lang] ?? PROMPTS.zh;
  const cast = (doc.cast ?? []).map((c) => `  ${c.id} = ${c.name}${c.note ? ` (${c.note})` : ''}`).join('\n') || T.noCast;
  return [
    T.role, '', T.frames, T.reading, '',
    `${T.heads.size}:\n${listVocab(S.SHOT_SIZES, lang)}`,
    `${T.heads.cat}:\n${listVocab(S.SHOT_CATEGORIES, lang)}`,
    `${T.heads.cam}:\n${listVocab(S.CAMERA_MOVES, lang)}`,
    `${T.heads.trans}:\n${listVocab(S.TRANSITIONS, lang)}`,
    opts.rhythm ? `${T.heads.rhythm}:\n${listVocab(S.RHYTHM_ROLES, lang)}` : '',
    `${T.heads.cast}:\n${cast}`,
    '', T.frameRule(p), T.evidence, T.noAsr, T.lang, T.json,
  ].filter(Boolean).join('\n');
}

function userPrompt(shot, doc, p, opts, extra) {
  const zh = opts.lang === 'zh';
  const m = shot.motion;
  const cams = camerasFor(shot, p);
  const restricted = cams.length < Object.keys(S.CAMERA_MOVES).length;
  const lines = [
    `${zh ? '镜号' : 'shot'}: ${shot.id}`,
    `${zh ? '起止' : 'time'}: ${S.fmtTime(shot.start)} -> ${S.fmtTime(shot.end)}  (${shot.seconds}s)`,
    `${zh ? '实测帧间变化（中位数）' : 'measured frame change (median)'}: ${m == null ? 'n/a' : m}`,
  ];
  if (restricted) {
    lines.push(zh
      ? `⚠ 实测 ${m} ≤ ${p.staticMaxMotion}：画面几乎没动，推/拉/摇/移/跟这类运镜已从选项里去掉——像素不动，机位就没动。`
      : `⚠ measured ${m} <= ${p.staticMaxMotion}: the picture barely changes, so push/pull/pan/truck/tracking were removed from the options — still pixels, still camera.`);
  } else if (m != null && Number(m) >= p.busyMinMotion) {
    lines.push(zh
      ? `实测 ${m} 偏高：可能是机位在动，也可能是机位固定、主体在动——看两帧的取景决定，别默认是运镜。`
      : `measured ${m} is high: could be a camera move, could be a locked-off camera on a moving subject — decide from the framing, do not assume a move.`);
  }
  if (extra?.prev) lines.push(`${zh ? '上一镜' : 'previous shot'}: ${extra.prev}`);
  if (extra?.violations?.length) {
    lines.push('', zh ? '⛔ 上一版这一镜被质量门拦下，按这些改：' : '⛔ the gates rejected your previous answer for this shot, fix exactly these:');
    for (const v of extra.violations) lines.push(`  - ${v}`);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------- client -- */
function imagePart(file) {
  const b64 = readFileSync(file).toString('base64');
  return { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } };
}

function parseJson(text) {
  const t = String(text).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch { /* le modèle a bavardé autour */ }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error(`réponse non-JSON: ${t.slice(0, 200)}`);
}

async function askShot(shot, doc, p, opts, extra) {
  const frames = [join(opts.framesDir, `${shot.id}a.jpg`), join(opts.framesDir, `${shot.id}b.jpg`)];
  const images = frames.filter(existsSync).map(imagePart);
  if (!images.length) throw new Error(`pas de keyframe pour ${shot.id} dans ${opts.framesDir} — lance d'abord: video-shots.mjs frames`);
  const schema = schemaFor(shot, doc, p, opts);
  const body = {
    model: opts.model,
    temperature: opts.temperature,
    max_tokens: 700,
    messages: [
      { role: 'system', content: systemPrompt(doc, p, opts) },
      { role: 'user', content: [{ type: 'text', text: userPrompt(shot, doc, p, opts, extra) }, ...images] },
    ],
  };
  if (opts.schemaMode === 'response_format') body.response_format = { type: 'json_schema', json_schema: { name: 'shot', strict: true, schema } };
  if (opts.schemaMode === 'guided_json') body.guided_json = schema;

  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(`${opts.api}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.key}` },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
      const j = await r.json();
      return parseJson(j.choices?.[0]?.message?.content ?? '');
    } catch (e) {
      if (attempt >= opts.retries) throw e;
      await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
    }
  }
}

/* ------------------------------------------------- coercitions (code) -- */
export function coerce(shot, answer, doc, p, log) {
  const out = {};
  for (const k of MODEL_FIELDS) if (answer[k] !== undefined) out[k] = answer[k];
  const say = (msg) => log.push(`${shot.id}: ${msg}`);

  if (!S.SHOT_SIZES[out.size]) { say(`size "${out.size}" hors vocabulaire -> none`); out.size = 'none'; }
  if (!S.SHOT_CATEGORIES[out.category]) { say(`category "${out.category}" hors vocabulaire -> subject`); out.category = 'subject'; }
  if (!S.CAMERA_MOVES[out.camera]) { say(`camera "${out.camera}" hors vocabulaire -> static`); out.camera = 'static'; }
  if (out.transitionIn && !S.TRANSITIONS[out.transitionIn]) { say(`transitionIn "${out.transitionIn}" hors vocabulaire -> cut`); out.transitionIn = 'cut'; }

  // porte 运镜 : prétendre un mouvement fort quand les pixels ne bougent pas
  if (!camerasFor(shot, p).includes(out.camera)) {
    say(`camera "${out.camera}" (mouvement fort) vs motion mesurée ${shot.motion} -> static`);
    out.camera = 'static';
  }

  // portes « preuve »
  const ids = new Set((doc.cast ?? []).map((c) => c.id));
  out.subjects = (out.subjects ?? []).filter((x) => ids.has(x));
  const audio = String(out.audio ?? '').trim();
  const ost = String(out.onscreenText ?? '').trim();
  if (out.category === 'dialogue' && !audio) { say('dialogue sans réplique -> subject'); out.category = 'subject'; }
  if (out.category === 'reaction' && !out.subjects.length) { say('reaction sans sujet -> subject'); out.category = 'subject'; }
  if (out.category === 'text-card' && !ost) { say('text-card sans onscreenText -> insert'); out.category = 'insert'; }
  if (out.category === 'empty' && out.subjects.length) { say('empty avec des personnes -> subject'); out.category = 'subject'; }

  if (out.rhythm !== undefined && !S.RHYTHM_ROLES[out.rhythm]) {
    say(`rhythm "${out.rhythm}" hors vocabulaire -> vidé`);
    delete out.rhythm;
    delete out.rhythmNote;
  }
  return out;
}

/* ------------------------------------------------------ boucle portes -- */
const shotIdsIn = (msg) => [...String(msg).matchAll(/\bS\d{2,3}\b/g)].map((m) => m[0]);

function violationsByShot(doc, ctx) {
  const v = S.validate(doc, ctx);
  const map = new Map();
  for (const g of v.gates) {
    if (g.ok) continue; // gate() : { id, label, ok, skipped, issues }
    for (const item of g.issues ?? []) {
      for (const id of new Set(shotIdsIn(item))) {
        if (!map.has(id)) map.set(id, []);
        map.get(id).push(String(item));
      }
    }
  }
  return { v, map };
}

/* --------------------------------------------------------------- pool -- */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/* ----------------------------------------------------------- commande -- */
async function annotate() {
  const file = positional[0];
  if (!file) { console.error('usage: shots-vlm.mjs annotate <shots.json> [--frames dir] [--track t.json] --model <m>'); process.exit(1); }
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const p = S.paramsOf(doc);
  const opts = {
    api: String(flag('--api', process.env.VLM_API ?? 'http://127.0.0.1:8000/v1')).replace(/\/$/, ''),
    model: String(flag('--model', process.env.VLM_MODEL ?? '')),
    key: String(flag('--key', process.env.VLM_KEY ?? 'EMPTY')),
    framesDir: String(flag('--frames', p.frameDir)),
    lang: LANGS.includes(flag('--lang', doc.lang)) ? String(flag('--lang', doc.lang)) : 'zh',
    rhythm: !has('--no-rhythm'),
    minLength: !has('--no-min-length'),
    concurrency: Number(flag('--concurrency', 4)),
    repair: Number(flag('--repair', 2)),
    retries: Number(flag('--retries', 2)),
    temperature: Number(flag('--temperature', 0)),
    schemaMode: String(flag('--schema-mode', 'response_format')),
  };
  if (!opts.model) { console.error('--model manquant (le nom servi par vLLM/SGLang)'); process.exit(1); }
  const track = flag('--track') ? JSON.parse(readFileSync(String(flag('--track')), 'utf8')) : null;
  const ctx = { lang: opts.lang, track, frameDir: opts.framesDir };

  const log = [];
  const t0 = Date.now();
  // --repair-only : le document est déjà annoté, on ne refait pas le premier passage,
  // on ne re-demande que les plans que les portes recalent.
  const repairOnly = has('--repair-only');
  const answers = repairOnly ? doc.shots.map(() => null) : await pool(doc.shots, opts.concurrency, async (shot, k) => {
    const prev = k > 0 ? `${doc.shots[k - 1].id} ${doc.shots[k - 1].frame ?? ''}`.trim() : null;
    try {
      const a = await askShot(shot, doc, p, opts, { prev });
      process.stderr.write(`· ${shot.id} ok\n`);
      return coerce(shot, a, doc, p, log);
    } catch (e) {
      process.stderr.write(`✗ ${shot.id} ${e.message}\n`);
      return null;
    }
  });
  doc.shots.forEach((s, i) => { if (answers[i]) Object.assign(s, answers[i]); });

  // rythme : tout ou rien, la porte refuse une demi-table
  if (opts.rhythm) {
    const filled = doc.shots.filter((s) => s.rhythm).length;
    if (filled && filled < doc.shots.length) {
      process.stderr.write(`! rythme incomplet (${filled}/${doc.shots.length}) -> retiré partout (la porte refuse une demi-table)\n`);
      for (const s of doc.shots) { delete s.rhythm; delete s.rhythmNote; }
    }
  }

  // boucle de réparation pilotée par les portes
  for (let round = 1; round <= opts.repair; round++) {
    const { v, map } = violationsByShot(doc, ctx);
    if (v.ok) break;
    const targets = doc.shots.filter((s) => map.has(s.id));
    if (!targets.length) {
      process.stderr.write('! portes en échec mais aucune violation rattachée à un plan — à regarder à la main\n');
      break;
    }
    process.stderr.write(`↻ réparation ${round}/${opts.repair} : ${targets.length} plan(s)\n`);
    const fixed = await pool(targets, opts.concurrency, async (shot) => {
      try {
        const a = await askShot(shot, doc, p, opts, { violations: map.get(shot.id) });
        return coerce(shot, a, doc, p, log);
      } catch (e) { process.stderr.write(`✗ ${shot.id} ${e.message}\n`); return null; }
    });
    targets.forEach((s, i) => { if (fixed[i]) Object.assign(s, fixed[i]); });
  }

  const { v } = violationsByShot(doc, ctx);
  const passed = v.gates.filter((g) => g.ok && !g.skipped).length;
  const failed = v.gates.filter((g) => !g.ok);
  const skipped = v.gates.filter((g) => g.skipped).length;
  process.stderr.write(`\n${v.ok ? '✅' : '⛔'} portes: ${passed} passées, ${failed.length} en échec, ${skipped} sautées, ${v.hints.length} indice(s) — ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  for (const g of failed) {
    process.stderr.write(`   ⛔ ${g.label ?? g.id}\n`);
    for (const i of g.issues.slice(0, 5)) process.stderr.write(`      · ${i}\n`);
  }
  if (log.length) {
    process.stderr.write(`\n${log.length} coercition(s) faites par le code (le modèle a été corrigé) :\n`);
    for (const l of log) process.stderr.write(`   · ${l}\n`);
  }

  const out = flag('-o') ?? flag('--out');
  const text = JSON.stringify(doc, null, 2);
  if (typeof out === 'string') writeFileSync(out, text);
  else process.stdout.write(text);
  process.exitCode = v.ok ? 0 : 2;
}

if (cmd === 'annotate') await annotate();
else if (cmd) { console.error(`commande inconnue: ${cmd}`); process.exit(1); }
