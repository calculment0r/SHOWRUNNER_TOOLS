#!/usr/bin/env node
/**
 * Filet de sécurité : aucun caractère chinois ne doit survivre dans le rapport.
 *
 * Le VLM lit les sous-titres incrustés à l'image ; même en lui demandant du
 * français, il recopie parfois les caractères d'origine dans `audio` ou
 * `onscreenText`. On repasse derrière : chaque champ contenant du CJK part en
 * traduction, et on revérifie après coup.
 *
 *   node frenchify.mjs shots-fr.json --api http://127.0.0.1:11434/v1 --model mistral-vlm-16k
 *   node frenchify.mjs shots-fr.json --check      (scan seul, aucun appel)
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CJK = /[㐀-鿿぀-ヿ가-힯＀-￯]/;
const FIELDS = ['frame', 'audio', 'onscreenText', 'rhythmNote', 'note'];

const [file, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(n); return i < 0 ? d : rest[i + 1]; };
const doc = JSON.parse(readFileSync(file, 'utf8'));

/* ------------------------------------------------------------- inventaire -- */
const found = [];
const scan = (where, value, set) => { if (typeof value === 'string' && CJK.test(value)) found.push({ where, value, set }); };
scan('title', doc.title, (v) => { doc.title = v; });
for (const c of doc.cast ?? []) {
  scan(`cast ${c.id}.name`, c.name, (v) => { c.name = v; });
  scan(`cast ${c.id}.note`, c.note, (v) => { c.note = v; });
}
for (const s of doc.shots ?? []) for (const f of FIELDS) scan(`${s.id}.${f}`, s[f], (v) => { s[f] = v; });

if (!found.length) { process.stderr.write('✅ aucun caractère chinois dans le document\n'); process.exit(0); }
process.stderr.write(`${found.length} champ(s) encore en chinois :\n${found.map((h) => `   · ${h.where} : ${h.value.slice(0, 50)}`).join('\n')}\n`);
if (rest.includes('--check')) process.exit(1);

/* -------------------------------------------------------------- traduction -- */
const api = String(flag('--api', 'http://127.0.0.1:11434/v1')).replace(/\/$/, '');
const model = String(flag('--model', 'mistral-vlm-16k'));

async function translate(text) {
  const body = {
    model, temperature: 0, max_tokens: 400,
    messages: [
      { role: 'system', content: "Tu traduis en français, pour une fiche technique de dépouillement de film. Rends une traduction naturelle et concise, sans guillemets superflus, sans commentaire. N'ajoute rien, ne conserve aucun caractère chinois." },
      { role: 'user', content: `Traduis en français :\n${text}` },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'tr', strict: true, schema: { type: 'object', additionalProperties: false, required: ['fr'], properties: { fr: { type: 'string' } } } } },
  };
  const r = await fetch(`${api}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return JSON.parse(j.choices[0].message.content).fr.trim();
}

let fixed = 0;
for (const hit of found) {
  try {
    let fr = await translate(hit.value);
    if (CJK.test(fr)) fr = await translate(`Retire tout caractère chinois et donne uniquement du français : ${hit.value}`);
    if (CJK.test(fr)) { process.stderr.write(`   ✗ ${hit.where} : encore du chinois après deux essais, champ vidé\n`); fr = ''; }
    hit.set(fr);
    fixed++;
    process.stderr.write(`   → ${hit.where} : ${fr.slice(0, 60)}\n`);
  } catch (e) {
    process.stderr.write(`   ✗ ${hit.where} : ${e.message}\n`);
  }
}

writeFileSync(file, JSON.stringify(doc, null, 2));
const still = JSON.stringify(doc).match(CJK) ? 'IL RESTE DU CHINOIS' : 'plus un seul caractère chinois';
process.stderr.write(`${fixed}/${found.length} champs traduits — ${still}\n`);
