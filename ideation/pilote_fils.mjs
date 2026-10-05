// Le pilote des fils d'Idéation (ideation/wires.js, ideation/ports.js, la règle commune des
// références commun/refs.js), sur un portail d'ESSAI (tools/portail_essai.py : porte coupée, on
// entre en Cal, moteurs factices) — jamais le portail en ligne : il range une image et crée une
// planche.
//
//   python3 tools/portail_essai.py 8809 /tmp/sr_essai_fils &
//   node ideation/pilote_fils.mjs http://127.0.0.1:8809 /tmp/sr_pilote_fils
//
// La planche : une image, une note, deux cartes Générer (Z-Image, Krea 2) et quatre fils —
//   w1  image → références de Z-Image : Z-Image est « texte seul » (refs: 0, server/tools/image.py),
//       le fil est GARDÉ (`held`, ports.js) : au repos (`idle`), « non envoyé », la raison au survol,
//       sa vignette grisée (`held`) et son entrée PAS en alerte. C'est la règle des références
//       gardées (au-delà de ce que prend le modèle : grisé, jamais retiré, jamais en alerte) ;
//       l'ancien pilote des fils (05/10, hors du dépôt) attendait encore `bad` ici : ses deux
//       échecs Z-Image venaient de son attente, pas de la page ;
//   w2  note → prompt de Z-Image : envoyé (ni `idle` ni `bad`) ;
//   w3  image → références de Krea 2 : envoyé, « réf. 1 » ;
//   w4  image → prompt de Krea 2 : le prompt ne prend que du texte — IGNORÉ (`bad`), « ignoré »,
//       son entrée en alerte.
// Puis Z-Image → Krea 2 sur la première carte : w1 se rallume (« réf. 1 ») ; et retour : gardé.
// En sombre et en clair, sans erreur de console. Rend 0 si tout passe ; le détail dans
// <out>/pilote.log, les captures dans <out>.
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';

const require = createRequire(import.meta.url);
let chromium;
for (const p of [process.env.SR_PLAYWRIGHT, '/opt/node22/lib/node_modules/playwright', '/home/dgx/Character_Sheet/node_modules/playwright'].filter(Boolean)) {
  try { ({ chromium } = require(p)); break; } catch { /* le suivant */ }
}
const [BASE = 'http://127.0.0.1:8795', OUT = '/tmp/sr_pilote_fils'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };

// ── la planche, posée par l'API (comme la page l'enregistrerait) ──
const api = async (method, path, body, raw) => {
  const r = await fetch(`${BASE}/api/${path}`, { method, headers: raw ? {} : { 'Content-Type': 'application/json' },
    body: raw || (body !== undefined ? JSON.stringify(body) : undefined) });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { /* */ }
  if (!r.ok) throw new Error(`${method} ${path} : ${r.status} ${t.slice(0, 200)}`);
  return j;
};
execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
im = Image.new("RGB", (512, 384), (40, 70, 110)); ImageDraw.Draw(im).ellipse((180, 110, 330, 260), fill=(230, 200, 120)); im.save(sys.argv[1])
`, `${OUT}/reference.png`]);
const img = await api('PUT', 'library/upload?name=reference.png&title=Référence%20des%20fils', undefined, readFileSync(`${OUT}/reference.png`));
const b = await api('POST', 'ideation/boards', { name: 'Pilote · les fils' });
const nodes = [
  { id: 'm1', type: 'media', kind: 'image', item: img.id, title: 'Référence des fils', x: 0, y: 140, w: 240, h: 180 },
  { id: 'n1', type: 'note', text: 'un renard dans la neige, au crépuscule', x: 0, y: -80, w: 240, h: 120 },
  { id: 'g1', type: 'gen', model: 'zimage', prompt: '', x: 420, y: -140, w: 300, h: 400 },
  { id: 'g2', type: 'gen', model: 'krea2', prompt: '', x: 420, y: 320, w: 300, h: 400 },
];
const links = [
  { id: 'w1', a: 'm1', b: 'g1', kind: 'wire', pa: 'image', pb: 'refs' },
  { id: 'w2', a: 'n1', b: 'g1', kind: 'wire', pa: 'text', pb: 'prompt' },
  { id: 'w3', a: 'm1', b: 'g2', kind: 'wire', pa: 'image', pb: 'refs' },
  { id: 'w4', a: 'm1', b: 'g2', kind: 'wire', pa: 'image', pb: 'prompt' },
];
await api('POST', `ideation/boards/${b.id}`, { name: b.name, v: b.v, nodes, links, base_rev: b.rev });
ok(true, `la planche ${b.id} : une image, une note, Z-Image et Krea 2, quatre fils`);

// ── la page ──
const browser = await chromium.launch();
const wireOf = (page, id) => page.evaluate((id) => {
  const g = document.querySelector(`g.sr-wire[data-link="${id}"]`);
  if (!g) return null;
  return { idle: g.classList.contains('idle'), bad: g.classList.contains('bad'), label: g.querySelector('.lab')?.textContent || '',
    why: g.querySelector('title')?.textContent || '' };
}, id);
const portOf = (page, nid, port) => page.evaluate(([nid, port]) => {
  const p = document.querySelector(`[data-id="${nid}"] > .pt[data-side="in"][data-port="${port}"]`);
  return p ? { on: p.classList.contains('on'), bad: p.classList.contains('bad') } : null;
}, [nid, port]);
const chipOf = (page, nid) => page.evaluate((nid) => {
  const c = document.querySelector(`[data-id="${nid}"] .grefs .gchip`);
  return c ? { held: c.classList.contains('held'), bad: c.classList.contains('bad'), title: c.title } : null;
}, nid);
const model = async (page, nid, v) => {
  await page.selectOption(`[data-id="${nid}"] .gmodel select`, v);
  await page.waitForTimeout(500);
};

for (const theme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript((t) => {
    // « dirty » : le choix part au serveur d'essai, qui ne le reprend pas au relevé suivant
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
  }, theme);
  // les polices Google ne passent pas dans un conteneur : les refuser tout de suite (le thème a ses replis)
  await ctx.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_FAILED/.test(m.text() + (m.location()?.url || ''))) errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  // la page garde un flux ouvert (la coédition) : « load », pas « networkidle »
  await page.goto(`${BASE}/ideation/#${b.id}`, { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => document.querySelector('g.sr-wire[data-link="w1"]')?.classList.contains('idle')
      || document.querySelector('g.sr-wire[data-link="w1"]')?.classList.contains('bad'), null, { timeout: 20000 });
  } catch { /* les contrôles disent ce qui manque */ }
  ok((await page.evaluate(() => document.documentElement.dataset.theme)) === theme, `${theme} : le thème est posé`);

  const w1 = await wireOf(page, 'w1');
  ok(w1 && w1.idle && !w1.bad && w1.label === 'non envoyé' && /^non envoyé : Z-Image/.test(w1.why),
    `${theme} : image → Z-Image, gardé : au repos, « non envoyé », la raison au survol (${JSON.stringify(w1)})`);
  const c1 = await chipOf(page, 'g1');
  ok(c1 && c1.held && !c1.bad, `${theme} : sa vignette dans la carte Z-Image est grisée, pas en alerte (${JSON.stringify(c1)})`);
  const p1 = await portOf(page, 'g1', 'refs');
  ok(p1 && !p1.bad, `${theme} : l'entrée « références » de Z-Image n'est pas en alerte (${JSON.stringify(p1)})`);
  const w2 = await wireOf(page, 'w2');
  ok(w2 && !w2.idle && !w2.bad, `${theme} : note → prompt de Z-Image, envoyé (${JSON.stringify(w2)})`);
  const w3 = await wireOf(page, 'w3');
  ok(w3 && !w3.idle && !w3.bad && w3.label === 'réf. 1', `${theme} : image → Krea 2, envoyé, « réf. 1 » (${JSON.stringify(w3)})`);
  const w4 = await wireOf(page, 'w4');
  ok(w4 && w4.bad && !w4.idle && w4.label === 'ignoré' && /^ignoré : /.test(w4.why),
    `${theme} : image → prompt de Krea 2, ignoré, en alerte, la raison au survol (${JSON.stringify(w4)})`);
  const p4 = await portOf(page, 'g2', 'prompt');
  ok(p4 && p4.bad, `${theme} : l'entrée « prompt » de Krea 2 est en alerte (${JSON.stringify(p4)})`);
  await page.screenshot({ path: `${OUT}/fils_${theme}.png` });

  // un modèle qui prend des références : le fil gardé se rallume ; et retour
  await model(page, 'g1', 'krea2');
  const w1b = await wireOf(page, 'w1');
  ok(w1b && !w1b.idle && !w1b.bad && w1b.label === 'réf. 1', `${theme} : Z-Image → Krea 2, le fil se rallume, « réf. 1 » (${JSON.stringify(w1b)})`);
  const c1b = await chipOf(page, 'g1');
  ok(c1b && !c1b.held && !c1b.bad, `${theme} : sa vignette n'est plus grisée (${JSON.stringify(c1b)})`);
  await model(page, 'g1', 'zimage');
  const w1c = await wireOf(page, 'w1');
  ok(w1c && w1c.idle && !w1c.bad, `${theme} : retour à Z-Image, gardé de nouveau, rien de retiré (${JSON.stringify(w1c)})`);
  ok(errs.length === 0, `${theme} : aucune erreur de console${errs.length ? ' — ' + errs.join(' | ') : ''}`);
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/pilote.log`, log.join('\n') + '\n');
console.log(`\n${log.filter((l) => l.startsWith('ok')).length} passés, ${fails} en échec — ${OUT}/pilote.log`);
process.exit(fails ? 1 : 0);
