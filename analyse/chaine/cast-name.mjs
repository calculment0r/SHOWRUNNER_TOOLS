#!/usr/bin/env node
/**
 * Nommer le casting — un portrait à la fois.
 *
 * Sur la planche entière, un modèle 24B confond deux visages et donne le même
 * nom aux deux. Sur UN portrait, il décrit ce qu'il voit et ne se trompe pas.
 * Les identités viennent du visage (reid-face) ; ici on ne fait que les
 * nommer, en français, avec ce qui est visible — jamais un nom d'acteur.
 *
 *   node cast-name.mjs shots.json --portraits portraits/ --model mistral-vlm-16k [-o shots.json]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [shotsFile, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(n); return i < 0 ? d : rest[i + 1]; };
const api = String(flag('--api', 'http://127.0.0.1:11434/v1')).replace(/\/$/, '');
const model = String(flag('--model', 'mistral-vlm-16k'));
const dir = String(flag('--portraits', 'portraits'));
const doc = JSON.parse(readFileSync(shotsFile, 'utf8'));

const schema = { type: 'object', additionalProperties: false, required: ['name', 'note', 'visible'], properties: {
  name: { type: 'string' }, note: { type: 'string' }, visible: { type: 'boolean' } } };

async function describe(file, taken) {
  const body = {
    model, temperature: 0, max_tokens: 200,
    messages: [{ role: 'user', content: [
      { type: 'text', text: `Voici le portrait d'une personne découpé dans un film. Donne-lui un nom court en français fondé UNIQUEMENT sur ce qui est visible : coiffure, lunettes, vêtement, âge apparent (ex. « L'homme aux cheveux gominés en costume gris »). Puis une note d'une ligne. Mets visible=false si aucun visage n'est reconnaissable (nuque, flou, trop petit). Noms déjà pris, à éviter : ${taken.join(' ; ') || 'aucun'}. JSON uniquement.` },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${readFileSync(file).toString('base64')}` } }] }],
    response_format: { type: 'json_schema', json_schema: { name: 'who', strict: true, schema } },
  };
  const r = await fetch(`${api}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return JSON.parse((await r.json()).choices[0].message.content);
}

const taken = [];
for (const c of doc.cast ?? []) {
  const file = c.portrait && existsSync(c.portrait) ? c.portrait : join(dir, `${c.id}.jpg`);
  if (!existsSync(file)) continue;
  try {
    const a = await describe(file, taken);
    let name = a.visible ? a.name.trim() : (c.by === "visage" ? a.name.trim() : `Figurant ${c.id}`);
    // Le modele repete parfois un nom deja pris malgre la consigne. Deux fiches qui
    // portent le meme nom sont indiscernables partout — script, rails, depouillement :
    // on garantit la distinction ici plutot que de la corriger a la main ensuite.
    if (taken.includes(name)) name = `${name} · ${c.id}`;
    c.name = name; c.note = `${a.note.trim()} — ${c.note.replace(/^.*?— /, '')}`;
    taken.push(name);
    process.stderr.write(`   ${c.id.padEnd(4)}${name}${a.visible ? '' : '  (visage non reconnaissable)'}\n`);
  } catch (e) { process.stderr.write(`   ${c.id} : ${e.message}\n`); }
}
// les répliques reprennent les nouveaux noms
const nameOf = (id) => (doc.cast ?? []).find((c) => c.id === id)?.name ?? id;
for (const s of doc.shots) if (s.lines?.length) s.audio = s.lines.map((l) => `${l.speaker ? nameOf(l.speaker) : '?'} : ${l.text}`).join(' / ');
writeFileSync(flag('-o', shotsFile), JSON.stringify(doc, null, 2));
