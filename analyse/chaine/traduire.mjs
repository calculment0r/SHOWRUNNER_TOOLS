#!/usr/bin/env node
// La traduction d'un doublage : chaque réplique traduite pour être DITE dans le temps de l'original — comme l'adapte
// un dialoguiste (« Dubbing v2 » d'ElevenLabs : « adapte les formulations pour sonner naturellement »).
//
//   node traduire.mjs <script.json> --langue zh|en [--noms corrections.json] [--contexte "…"] [--model qwen3:30b-a3b]
//        [--vite] [--api http://127.0.0.1:11434] [-o doublage-zh.json]
//
// <script.json> : lignes [{a, b, qui, texte}] (qui dit quoi, arrêté dans le Studio). La scène entière part d'un coup
// (le contexte : qui parle, à qui, sur quel ton), avec pour chaque réplique un budget de syllabes : sa durée — plus
// le silence qui la suit — au débit que la voix de synthèse tient encore intelligible (mesuré le 25/09 avec Whisper :
// mandarin 6,5 /s, anglais 7 /s ; à 4,8 /s le modèle compressait jusqu'à l'agrammatical). Une réplique qui dépasse
// est redemandée plus courte (deux fois au plus). Les noms de marque restent en lettres latines.
// Ollama (API native) : réflexion coupée, modèle déchargé à la fin (keep_alive 0) — la mémoire revient à ComfyUI.
// Lancer d'abord gpu-libre.sh.
import { readFileSync, writeFileSync } from 'node:fs';

const [source, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(n); return i < 0 ? d : rest[i + 1]; };
const LANGUE = flag('--langue', 'zh');
const MODELE = flag('--model', 'qwen3:30b-a3b');
// le modèle raisonne avant de répondre : 131 s au lieu de 17 pour la scène Getaround, mais sans réflexion il plaçait
// la marque en tête de phrase malgré la règle et ajoutait des phrases (« 但你别急 ») ; --vite pour s'en passer
const REFLECHIR = !rest.includes('--vite');
const API = String(flag('--api', 'http://127.0.0.1:11434')).replace(/\/$/, '');
const RYTHME = { zh: 6.5, en: 7.0 }[LANGUE] || 6.0;
const NOM_LANGUE = { zh: 'chinois mandarin (caractères simplifiés)', en: 'anglais' }[LANGUE] || LANGUE;
const S = JSON.parse(readFileSync(source, 'utf8'));
const CONTEXTE = flag('--contexte', S.contexte || '');
const noms = flag('--noms') ? (JSON.parse(readFileSync(flag('--noms'), 'utf8')).noms || {}) : {};
const L = S.lignes;

// les syllabes, comme doublage.py les compte : un idéogramme = une syllabe ; un mot latin = ses groupes de voyelles
const syllabes = (t) => (t.match(/[㐀-鿿]/g) || []).length
  + (t.match(/[A-Za-z]+/g) || []).reduce((s, w) => s + Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) || []).length), 0);
const debuts = L.map((l) => l.a).sort((x, y) => x - y), fin = Math.max(...L.map((l) => l.b)) + 2;
const budgets = L.map((l) => {
  const suivant = debuts.find((a) => a > l.a + 1e-6) ?? fin;
  const place = Math.max(0.4, suivant - l.a - 0.05);
  return { vise: Math.max(1, Math.round((l.b - l.a) * RYTHME)), max: Math.max(1, Math.floor(Math.min(place, (l.b - l.a) + 0.8) * RYTHME)) };
});
// Ce que la voix de synthèse prononce mal (mesuré le 25/09, Whisper à la réécoute) : en chinois, « 5分钟 » est lu
// « 三分钟 » — les nombres s'écrivent en caractères ; un nom latin n'est bien dit qu'en FIN de phrase (essai du 25/09,
// 6 versions : en fin 3/6 justes, au milieu ou en tête 0/6 — la voix bascule en anglais pour la suite).
const REGLES_LANGUE = {
  zh: " En chinois : écris tous les nombres en caractères chinois (五分钟, jamais 5分钟) ; un nom en lettres latines (Getaround) se place en FIN de phrase, jamais en tête ni au milieu (ex. 说走就走，就用 Getaround。 ; 我上周刚租过一辆 Getaround。).",
  en: ' En anglais : écris les nombres en toutes lettres (five minutes).',
}[LANGUE] || '';
const CHIFFRES = '零一二三四五六七八九';
// filet : un chiffre isolé resté dans une traduction chinoise devient son caractère
// et une fuite de JSON (« 要车。'}, { ») : le modèle déborde parfois de son champ
const nettoie = (t0) => { const t = t0.replace(/\s*['"]?\s*\}\s*,?\s*\{?[^]*$/, '').trim(); return LANGUE === 'zh' ? t.replace(/(?<![0-9A-Za-z])[0-9](?![0-9A-Za-z])/g, (c) => CHIFFRES[+c]) : t; };
// en chinois, un nom latin ailleurs qu'en fin de phrase : la voix le rate — on redemande
const latinMalPlace = (t) => LANGUE === 'zh' && /[A-Za-z]{3,}[^A-Za-z]*[\u3400-\u9fff]/.test(t) && !/^[A-Z]{2,4}[^A-Za-z]/.test(t.replace(/^[^A-Za-z\u3400-\u9fff]+/, ''));
const quiDit = (q) => (q ? (noms[q] ? `${noms[q]} (${q})` : q) : 'voix hors champ');

async function demande(consigne, n) {
  const schema = { type: 'object', required: ['lignes'], properties: { lignes: { type: 'array', minItems: n, maxItems: n,
    items: { type: 'object', required: ['i', 'trad'], properties: { i: { type: 'integer' }, trad: { type: 'string' } } } } } };
  const r = await fetch(`${API}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    model: MODELE, stream: false, think: REFLECHIR, keep_alive: '2m', format: schema, options: { temperature: 0.3 },
    messages: [{ role: 'system', content: `Tu es dialoguiste de doublage. Tu adaptes des dialogues de film du français vers le ${NOM_LANGUE}, pour qu'ils soient dits par des comédiens en synchronisation avec l'image. Règles : le sens, le ton et l'intention d'abord (humour, tension, familiarité) ; une langue parlée naturelle et grammaticale — jamais de style télégraphique, jamais de calque du français (« c'est top » n'est pas « that's top ») ; respecte le budget de syllabes de chaque réplique en choisissant une formulation plus courte, pas en supprimant des mots nécessaires ; un slogan reste un slogan : court, idiomatique, qui sonne comme une vraie publicité dans la langue cible ; garde les noms de marque et les noms propres en lettres latines, tels quels (ex. Getaround) ; n'ajoute ni didascalie, ni guillemets, ni explication.${REGLES_LANGUE} Réponds uniquement en JSON.` },
      { role: 'user', content: consigne }] }) });
  if (!r.ok) throw new Error(`Ollama ${r.status} : ${await r.text()}`);
  return JSON.parse((await r.json()).message.content).lignes;
}

const t0 = Date.now();
const entete = CONTEXTE ? `Contexte : ${CONTEXTE}\n\n` : '';
const scene = entete + L.map((l, i) => `${i}. [${quiDit(l.qui)}, ${(l.b - l.a).toFixed(1)} s, cible ${budgets[i].vise} syllabes, maximum ${budgets[i].max}] ${l.texte}`).join('\n');
const trad = new Array(L.length).fill('');
for (const x of await demande(`Voici la scène, réplique par réplique (numéro, qui parle, durée, budget). Traduis chaque réplique en ${NOM_LANGUE}.\n\n${scene}`, L.length)) {
  if (x.i >= 0 && x.i < L.length) trad[x.i] = nettoie(String(x.trad || '').trim());
}
// ce qui dépasse, ou manque : redemandé, réplique par réplique, avec la scène pour contexte
for (let passe = 0; passe < 2; passe++) {
  const aRefaire = L.map((l, i) => i).filter((i) => !trad[i] || syllabes(trad[i]) > budgets[i].max || latinMalPlace(trad[i]));
  if (!aRefaire.length) break;
  const consigne = `La scène :\n${scene}\n\nCes traductions sont trop longues, manquent, ou placent un nom latin ailleurs qu'en fin de phrase. Refais-les en gardant le sens et le ton, sous le maximum de syllabes${REGLES_LANGUE} :\n`
    + aRefaire.map((i) => `${i}. maximum ${budgets[i].max} syllabes — actuelle (${syllabes(trad[i])} syllabes) : ${trad[i] || '(vide)'} — original : ${L[i].texte}`).join('\n');
  for (const x of await demande(consigne, aRefaire.length)) if (aRefaire.includes(x.i) && x.trad) trad[x.i] = nettoie(String(x.trad).trim());
}
// décharger le modèle : la mémoire revient à ComfyUI
await fetch(`${API}/api/generate`, { method: 'POST', body: JSON.stringify({ model: MODELE, keep_alive: 0 }) }).catch(() => {});

const out = { ...S, langue: LANGUE, source: 'fr', traduction: `automatique : ${MODELE} (Ollama), ${new Date().toISOString().slice(0, 10)}, budget ${RYTHME} syllabes/s`,
  lignes: L.map((l, i) => ({ ...l, trad: trad[i] })) };
writeFileSync(flag('-o', `doublage-${LANGUE}.json`), JSON.stringify(out, null, 1) + '\n');
L.forEach((l, i) => console.log(`${String(l.a).padStart(6)}  ${String(syllabes(trad[i])).padStart(2)}/${budgets[i].max}  ${trad[i]}   ← ${l.texte}`));
console.log(`traduit en ${((Date.now() - t0) / 1000).toFixed(0)} s par ${MODELE}`);
