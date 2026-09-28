#!/usr/bin/env node
/**
 * Les cartons — le texte qui ARRIVE dans un plan, pas seulement celui qu'on y trouve.
 *
 *   node cartons.mjs shots.json --video v.mp4 [--frames frames] [--model mistral-vlm-16k] [-o shots.json]
 *
 * Un carton de fin s'incruste par-dessus le plan qui continue : aucun raccord, donc
 * aucun plan à lui, et le dépouillement le manquait. Le texte à l'image, lui, n'était
 * lu que sur une seule image du plan — sur la pub Getaround il rendait « getaround »
 * et laissait tomber « Louez une voiture en 1 clic ».
 *
 * On relit donc le texte à plusieurs instants du plan, et on garde chaque carton
 * DISTINCT avec le moment où il apparaît.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [file, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(n); return i < 0 ? d : rest[i + 1]; };
if (!file) { console.error('usage: cartons.mjs shots.json --video v.mp4 [-o sortie.json]'); process.exit(1); }
const doc = JSON.parse(readFileSync(file, 'utf8'));
const video = flag('--video', doc.source ?? 'video.mp4');
const api = String(flag('--api', 'http://127.0.0.1:11434/v1')).replace(/\/$/, '');
const model = String(flag('--model', 'mistral-vlm-16k'));
const tmp = mkdtempSync(join(tmpdir(), 'cartons-'));

// Dire « ignore le texte filmé » ne suffisait pas : sur Getaround le modèle rendait MIAMI (le tee-shirt), C22 C20 C19
// (la paroi du fourgon), l'écran du téléphone, le paquet de chips, la plaque. Il doit maintenant dire, pour chaque
// texte, SUR QUOI il est posé ; seul ce qui est incrusté par le montage devient un carton.
const INCRUSTE = 'incrusté par-dessus l’image (titre, carton, sous-titre, logo de fin)';
const SUPPORTS = [INCRUSTE, 'vêtement', 'mur, véhicule ou décor', 'écran filmé (téléphone, ordinateur, télévision)', 'emballage ou objet', 'plaque, panneau ou enseigne'];
const schema = { type: 'object', additionalProperties: false, required: ['textes'], properties: { textes: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['texte', 'support'],
  properties: { texte: { type: 'string' }, support: { type: 'string', enum: SUPPORTS } } } } } };

async function lire(fichier) {
  const body = {
    model, temperature: 0, max_tokens: 600,
    messages: [{ role: 'user', content: [
      { type: 'text', text: "Relève chaque texte lisible sur cette image, tel qu'il est écrit (n'invente rien, ne traduis pas), et dis sur quoi il est posé. « Incrusté » veut dire ajouté au montage, par-dessus la scène : il ne suit ni la perspective ni l'éclairage de la scène. Un texte imprimé sur un vêtement, peint sur un mur ou un véhicule, affiché sur un écran qu'on voit dans la scène, sur un emballage ou une plaque n'est PAS incrusté. Aucun texte : liste vide. JSON uniquement." },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${readFileSync(fichier).toString('base64')}` } }] }],
    response_format: { type: 'json_schema', json_schema: { name: 'carton', strict: true, schema } },
  };
  const r = await fetch(`${api}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const textes = JSON.parse((await r.json()).choices[0].message.content).textes ?? [];
  return textes.filter((x) => x && x.support === INCRUSTE).map((x) => String(x.texte ?? '').trim()).filter(Boolean).join('\n');
}

const cle = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
let trouves = 0;
for (const s of doc.shots ?? []) {
  // début, milieu si le plan dure, fin : un carton qui arrive en cours de plan
  // n'apparaît sur aucune des deux images clés déjà extraites.
  const instants = s.seconds >= 2.5
    ? [s.start + 0.15, (s.start + s.end) / 2, s.end - 0.15]
    : [s.start + 0.1, s.end - 0.1];
  const vus = [];
  for (const t of instants) {
    const f = join(tmp, `${s.id}-${t.toFixed(2)}.jpg`);
    try {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', 'scale=960:-2', f]);
      const texte = await lire(f);
      if (!texte) continue;
      const k = cle(texte);
      if (!k || vus.some((c) => cle(c.texte).includes(k) || k.includes(cle(c.texte)))) continue;
      vus.push({ t: Math.round(t * 100) / 100, texte });
    } catch (e) { process.stderr.write(`   ${s.id} @${t.toFixed(1)}s : ${e.message}\n`); }
  }
  if (!vus.length) { delete s.cards; continue; }
  s.cards = vus;
  s.onscreenText = vus.map((c) => c.texte).join(' · ');
  trouves += vus.length;
  process.stderr.write(`   ${s.id}  ` + vus.map((c) => `${c.t}s « ${c.texte.replace(/\s+/g, ' ').slice(0, 60)} »`).join('  |  ') + '\n');
}
doc.provenance = { ...(doc.provenance ?? {}), cartons: 'texte incruste relu a plusieurs instants du plan ; chaque carton distinct garde son instant' };
writeFileSync(flag('-o', file), JSON.stringify(doc, null, 2));
process.stderr.write(`${trouves} carton(s) sur ${(doc.shots ?? []).length} plans\n`);
