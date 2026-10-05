// Le pilote du motion du mode Présentation (06/10 : les idées reprises de la note de spécification d'un
// éditeur de motion design — docs/etudes/presentations_motion.md § 10), sur un portail d'ESSAI
// (tools/portail_essai.py : porte coupée, on entre en Cal) — jamais le portail en ligne : il crée des
// planches et range des vidéos.
//
//   python3 tools/portail_essai.py 8863 /tmp/sr_motion-editeur/data &
//   node ideation/pilote_motion.mjs http://127.0.0.1:8863 /tmp/sr_pilote_motion
//
// Une diapositive de trois objets (un titre qui monte, un corps qui apparaît, une forme menée par des
// images clés), en sombre puis en clair :
//   - la minuterie : les losanges de la forme, une ligne par propriété animée ; glisser le losange de
//     « position x » : la clé change d'instant (la planche enregistrée le dit), un Ctrl+Z la remet (un
//     glisser = un pas) ;
//   - la courbe d'une clé : un clic sur un losange la choisit ; « ressort réglé » : la courbe dessinée
//     change, la raideur glissée la redessine en direct (rien n'est écrit), lâchée elle s'écrit ;
//     « cubic-bezier · poignées » : une poignée glissée redessine la courbe et l'écrit au lâcher ;
//   - un préréglage d'entrée sur le corps : des images clés ordinaires (marquées « in »), l'entrée par
//     effet à « Aucune » ; Ctrl+Z rend l'objet tel qu'avant ;
//   - la cascade : Maj + clic sur trois pistes, « Décaler en cascade » de 200 ms : le corps à 200 ms, la
//     forme (ses clés) à 400 ms ; Ctrl+Z la retire ;
//   - « Vidéo · cette diapositive » (le menu ▾) : la progression dans le panneau, puis « Télécharger la
//     vidéo » et la vidéo rangée dans Asset (dossier Idéation, 1920 × 1080, sa durée) ;
//   - un seul bouton orange à l'écran, aucune erreur de console ; des captures dans <out>.
// Rend 0 si tout passe ; le détail dans <out>/pilote.log.
import { createRequire } from 'module';
import { mkdirSync, writeFileSync } from 'fs';

const require = createRequire(import.meta.url);
let chromium;
for (const p of [process.env.SR_PLAYWRIGHT, '/opt/node22/lib/node_modules/playwright', '/home/dgx/Character_Sheet/node_modules/playwright'].filter(Boolean)) {
  try { ({ chromium } = require(p)); break; } catch { /* le suivant */ }
}
const [BASE = 'http://127.0.0.1:8863', OUT = '/tmp/sr_pilote_motion'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };
const api = async (method, path, body) => {
  const r = await fetch(`${BASE}/api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} : ${r.status} ${t.slice(0, 200)}`);
  return JSON.parse(t);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// la planche enregistrée, jusqu'à ce que `cond(nœuds)` tienne (l'enregistrement de la page part seul)
async function until(bid, cond, ms = 10000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    const b = await api('GET', `ideation/boards/${bid}`);
    last = Object.fromEntries(b.nodes.map((n) => [n.id, n]));
    if (cond(last)) return { ok: true, nodes: last };
    await sleep(250);
  }
  return { ok: false, nodes: last };
}

// ── la planche ──
const nodes = [
  { id: 'f1', type: 'frame', x: 0, y: 0, w: 1920, h: 1080, name: 'Trois objets', deck: { ratio: '16:9', trans: 'fade' } },
  { id: 'f2', type: 'frame', x: 2200, y: 0, w: 1920, h: 1080, name: 'Suite', deck: { ratio: '16:9', trans: 'fade' } },
  { id: 't1', type: 'title', x: 96, y: 120, w: 1400, h: 140, text: 'Le titre', size: 'l', style: 'h2', motion: { in: { fx: 'rise', dur: 600, delay: 0, ease: 'out-expo' } } },
  { id: 'n1', type: 'note', x: 96, y: 400, w: 900, h: 80, text: 'Un corps de texte', style: 'body', motion: { in: { fx: 'fade', dur: 500, delay: 0 } } },
  { id: 's1', type: 'shape', kind: 'rect', x: 1300, y: 500, w: 300, h: 300,
    motion: { in: { fx: 'none' }, keys: { x: [{ t: 0, v: -400 }, { t: 1000, v: 0 }], op: [{ t: 0, v: 0 }, { t: 600, v: 1 }] } } },
  { id: 'n2', type: 'note', x: 2300, y: 400, w: 900, h: 80, text: 'La suite', style: 'body' },
];
async function board(name) {
  const b = await api('POST', 'ideation/boards', { name });
  await api('POST', `ideation/boards/${b.id}`, { name, v: b.v || 2, nodes, links: [], base_rev: b.rev });
  return b.id;
}

const browser = await chromium.launch();
async function newPage(theme) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
  }, theme);
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (/fonts\.googleapis|ERR_CERT_AUTHORITY_INVALID/.test(m.text() + (m.location()?.url || ''))) return;   // le réseau du conteneur
    errs.push(`${m.type()}: ${m.text()} ${m.location()?.url || ''}`);
  });
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
  page.errs = errs;
  page.shot = async (n) => { await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/${n}.png` }); };
  return { ctx, page };
}
async function enterMode(page, bid) {
  await page.goto(`${BASE}/ideation/#${bid}`);
  await page.waitForSelector('.dp-pm', { state: 'attached', timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('.dp-pm').click());
  await page.waitForSelector('.pm-mode:not([hidden]) .pm-lane', { timeout: 20000 });
  await page.waitForTimeout(2600);   // l'entrée de la diapositive joue
}
const lane = (page, re) => page.evaluate((src) => { const r = new RegExp(src); const b = [...document.querySelectorAll('.pm-lane:not(.pm-sub) .pm-lab')].find((x) => r.test(x.textContent)); b?.scrollIntoView({ block: 'nearest' }); return !!b; }, re.source);
async function clickLane(page, re, shift = false) {
  await lane(page, re);
  const h = await page.evaluateHandle((src) => { const r = new RegExp(src); return [...document.querySelectorAll('.pm-lane:not(.pm-sub) .pm-lab')].find((x) => r.test(x.textContent)); }, re.source);
  await h.asElement().click({ modifiers: shift ? ['Shift'] : [] });
  await page.waitForTimeout(250);
}
const visibleGo = (page) => page.$$eval('.tb.go', (l) => l.filter((x) => x.offsetWidth || x.offsetHeight).length);
// le dessin d'une courbe de l'inspecteur, par le début de son libellé
const curveOf = (page, label) => page.evaluate((lb) => {
  const cv = [...document.querySelectorAll('.pm-ib .pm-cv')].find((x) => x.querySelector('.pm-cv-h1 .lbl')?.textContent.startsWith(lb));
  return cv ? { d: cv.querySelector('.pm-cv-line').getAttribute('d'), mode: cv.dataset.mode, say: cv.querySelector('.pm-cv-say').textContent } : null;
}, label);
const keyCurve = 'courbe · ';

for (const theme of ['dark', 'light']) {
  const bid = await board(`Pilote · motion (${theme})`);
  const { ctx, page } = await newPage(theme);
  await enterMode(page, bid);
  ok(await page.$eval('html', (h) => h.dataset.theme) === theme, `${theme} : le thème est posé`);
  ok(await visibleGo(page) === 1, `${theme} : un seul bouton orange à l'écran (la passe assistée)`);

  // ── les losanges ──
  await clickLane(page, /forme/);
  const subs = await page.$$eval('.pm-lane.pm-sub', (l) => l.map((x) => x.dataset.prop));
  const dia = await page.$$eval('.pm-lane:not(.pm-sub)[data-id="s1"] .pm-kd', (l) => l.map((x) => x.dataset.t));
  ok(subs.join(',') === 'x,op' && dia.join(',') === '0,600,1000', `${theme} : la forme — ses losanges (${dia}) et une ligne par propriété animée (${subs})`);
  await page.shot(`${theme}-1-losanges`);
  const k0 = page.locator('.pm-lane.pm-sub[data-prop="x"] .pm-kd[data-t="0"]');
  const bx = await k0.boundingBox();
  const W = await page.$eval('.pm-lane.pm-sub[data-prop="x"] .pm-track', (t) => t.getBoundingClientRect().width);
  // la minuterie couvre le motion + 200 ms (1,2 s ici) : 400 ms = W × 400 / 1200
  await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(bx.x + bx.width / 2 + (W * 400 / 1200) * (i / 8), bx.y + bx.height / 2);
  const tip = await page.$eval('.pm-ktip', (t) => t.textContent).catch(() => '');
  await page.mouse.up();
  let r = await until(bid, (N) => N.s1.motion?.keys?.x?.[0]?.t > 300);
  const xs = r.nodes.s1.motion?.keys?.x?.map((k) => k.t);
  ok(r.ok && xs.length === 2 && Math.abs(xs[0] - 400) <= 20 && xs[1] === 1000 && /^0\.[34]\d s$/.test(tip),
    `${theme} : glisser le losange de « position x » : la clé passe à ${xs?.[0]} ms (pendant le geste : ${tip}), l'autre reste`);
  await page.shot(`${theme}-2-glisse`);
  await page.keyboard.press('Control+z');
  r = await until(bid, (N) => N.s1.motion?.keys?.x?.[0]?.t === 0);
  ok(r.ok && r.nodes.s1.motion.keys.x.map((k) => k.t).join(',') === '0,1000', `${theme} : un Ctrl+Z remet la clé (un glisser = un pas d'annulation)`);
  await page.waitForTimeout(500);

  // ── la courbe d'une clé ──
  await clickLane(page, /forme/);
  await page.locator('.pm-lane.pm-sub[data-prop="op"] .pm-kd[data-t="0"]').click();
  await page.waitForTimeout(400);
  let c0 = await curveOf(page, keyCurve);
  ok(!!c0 && c0.mode === 'linear', `${theme} : un clic sur un losange choisit la clé : sa courbe dans l'onglet Objet (${c0?.mode})`);
  await page.evaluate((lb) => {
    const cv = [...document.querySelectorAll('.pm-ib .pm-cv')].find((x) => x.querySelector('.pm-cv-h1 .lbl')?.textContent.startsWith(lb));
    cv.scrollIntoView({ block: 'center' });
    const s = cv.querySelector('select'); s.value = 'sp'; s.dispatchEvent(new Event('change', { bubbles: true }));
  }, keyCurve);
  r = await until(bid, (N) => !!N.s1.motion?.keys?.op?.[0]?.e?.spring);
  await page.waitForTimeout(500);
  const c1 = await curveOf(page, keyCurve);
  ok(r.ok && c1?.mode === 'sp' && c1.d !== c0.d, `${theme} : « ressort réglé » : la clé prend un ressort (${JSON.stringify(r.nodes.s1.motion.keys.op[0].e)}), la courbe dessinée change`);
  // la raideur glissée : le dessin suit (rien n'est écrit), lâchée elle s'écrit
  const live = await page.evaluate((lb) => {
    const cv = [...document.querySelectorAll('.pm-ib .pm-cv')].find((x) => x.querySelector('.pm-cv-h1 .lbl')?.textContent.startsWith(lb));
    const rg = cv.querySelector('.pm-cv-sp input[type=range]');
    const d0 = cv.querySelector('.pm-cv-line').getAttribute('d');
    rg.value = '600'; rg.dispatchEvent(new Event('input', { bubbles: true }));
    return { changed: cv.querySelector('.pm-cv-line').getAttribute('d') !== d0, say: cv.querySelector('.pm-cv-say').textContent };
  }, keyCurve);
  await sleep(600);
  const notYet = (await api('GET', `ideation/boards/${bid}`)).nodes.find((n) => n.id === 's1').motion.keys.op[0].e.spring.k;
  ok(live.changed && /raideur 600/.test(live.say) && notYet === 180, `${theme} : la raideur glissée redessine la courbe en direct (${live.say}), rien n'est encore écrit (${notYet})`);
  await page.shot(`${theme}-3-ressort`);
  await page.evaluate((lb) => {
    const cv = [...document.querySelectorAll('.pm-ib .pm-cv')].find((x) => x.querySelector('.pm-cv-h1 .lbl')?.textContent.startsWith(lb));
    cv.querySelector('.pm-cv-sp input[type=range]').dispatchEvent(new Event('change', { bubbles: true }));
  }, keyCurve);
  r = await until(bid, (N) => N.s1.motion?.keys?.op?.[0]?.e?.spring?.k === 600);
  ok(r.ok, `${theme} : lâchée, la raideur s'écrit (${JSON.stringify(r.nodes.s1.motion.keys.op[0].e)})`);
  await page.waitForTimeout(500);
  // la cubic-bezier : une poignée glissée
  await page.evaluate((lb) => {
    const cv = [...document.querySelectorAll('.pm-ib .pm-cv')].find((x) => x.querySelector('.pm-cv-h1 .lbl')?.textContent.startsWith(lb));
    const s = cv.querySelector('select'); s.value = 'bz'; s.dispatchEvent(new Event('change', { bubbles: true }));
  }, keyCurve);
  r = await until(bid, (N) => !!N.s1.motion?.keys?.op?.[0]?.e?.bz);
  await page.waitForTimeout(500);
  const c2 = await curveOf(page, keyCurve);
  const hb = await page.evaluate((lb) => {
    const cv = [...document.querySelectorAll('.pm-ib .pm-cv')].find((x) => x.querySelector('.pm-cv-h1 .lbl')?.textContent.startsWith(lb));
    cv.scrollIntoView({ block: 'center' });
    const h = cv.querySelector('.pm-cv-h[data-h="1"]').getBoundingClientRect();
    return { x: h.x + h.width / 2, y: h.y + h.height / 2 };
  }, keyCurve);
  await page.mouse.move(hb.x, hb.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(hb.x + 6 * i, hb.y - 9 * i);
  const midDrag = await curveOf(page, keyCurve);
  await page.mouse.up();
  r = await until(bid, (N) => { const b = N.s1.motion?.keys?.op?.[0]?.e?.bz; return b && JSON.stringify(b) !== JSON.stringify(r.nodes.s1.motion.keys.op[0].e.bz); });
  ok(c2?.mode === 'bz' && midDrag && midDrag.d !== c2.d && r.ok,
    `${theme} : « cubic-bezier · poignées » : la poignée glissée redessine la courbe, l'écrit au lâcher (${JSON.stringify(r.nodes.s1.motion.keys.op[0].e)})`);
  await page.shot(`${theme}-4-bezier`);

  // ── un préréglage d'entrée, puis Ctrl+Z ──
  await clickLane(page, /corps/);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.pm-ib button')].find((x) => /^Poser l’entrée$/.test(x.textContent)); b.scrollIntoView({ block: 'center' }); b.click(); });
  r = await until(bid, (N) => N.n1.motion?.keys?.op?.some((k) => k.p === 'in'));
  const kn = r.nodes.n1.motion;
  ok(r.ok && kn.in.fx === 'none' && kn.keys.x?.length === 2 && kn.keys.x[0].v === -80 && kn.keys.op.every((k) => k.p === 'in'),
    `${theme} : « Poser l'entrée » fabrique des images clés ordinaires (x ${kn?.keys?.x?.map((k) => `${k.t}:${k.v}`)}, opacité), l'entrée par effet à « Aucune »`);
  await page.waitForTimeout(600);
  const dn = await page.$$eval('.pm-lane:not(.pm-sub)[data-id="n1"] .pm-kd', (l) => l.length);
  ok(dn === 2, `${theme} : ses losanges dans la minuterie (${dn})`);
  await page.shot(`${theme}-5-prereglage`);
  await page.keyboard.press('Control+z');
  r = await until(bid, (N) => !N.n1.motion?.keys && N.n1.motion?.in?.fx === 'fade');
  ok(r.ok, `${theme} : Ctrl+Z rend le corps tel qu'avant (${JSON.stringify(r.nodes.n1.motion)})`);
  await page.waitForTimeout(600);

  // ── la cascade sur trois objets ──
  await clickLane(page, /titre/);
  await clickLane(page, /corps/, true);
  await clickLane(page, /forme/, true);
  const head = await page.evaluate(() => [...document.querySelectorAll('.pm-ib .pm-sec > .lbl')].map((x) => x.textContent).find((x) => /cascade/.test(x)) || '');
  ok(/cascade · 3 objets/.test(head), `${theme} : Maj + clic sur trois pistes : ${head}`);
  await page.evaluate(() => {
    const f = [...document.querySelectorAll('.pm-ib .pm-f')].find((x) => /^intervalle/.test(x.querySelector('.lbl')?.textContent || ''));
    const i = f.querySelector('input'); i.value = '200'; i.dispatchEvent(new Event('change', { bubbles: true }));
    const b = [...document.querySelectorAll('.pm-ib button')].find((x) => /^Décaler en cascade$/.test(x.textContent)); b.scrollIntoView({ block: 'center' }); b.click();
  });
  r = await until(bid, (N) => N.n1.motion?.in?.delay === 200 && N.s1.motion?.keys?.x?.[0]?.t === 400);
  ok(r.ok && (r.nodes.t1.motion.in.delay || 0) === 0 && r.nodes.s1.motion.keys.x.map((k) => k.t).join(',') === '400,1400',
    `${theme} : « Décaler en cascade » de 200 ms dans l'ordre de lecture : le titre à 0, le corps à ${r.nodes.n1.motion?.in?.delay}, la forme (ses clés) à ${r.nodes.s1.motion?.keys?.x?.map((k) => k.t)}`);
  await page.waitForTimeout(800);
  await page.shot(`${theme}-6-cascade`);
  await page.keyboard.press('Control+z');
  r = await until(bid, (N) => N.n1.motion?.in?.delay === 0 && N.s1.motion?.keys?.x?.[0]?.t === 0);
  ok(r.ok, `${theme} : Ctrl+Z retire la cascade`);
  await page.waitForTimeout(600);
  ok(await visibleGo(page) === 1, `${theme} : toujours un seul bouton orange`);

  // ── la vidéo de cette diapositive ──
  await page.click('.pm-expm');
  await page.waitForSelector('.sr-menu .mi', { timeout: 3000 });
  const items = await page.$$eval('.sr-menu .mi', (l) => l.map((x) => ({ label: x.querySelector('.lb')?.textContent || '', off: x.getAttribute('aria-disabled') === 'true' })));
  const vids = items.filter((x) => /^Vidéo/.test(x.label));
  ok(vids.length === 3 && vids.every((x) => !x.off), `${theme} : le menu d'export a ses vidéos MP4 (${vids.map((x) => x.label).join(' | ')})`);
  await page.shot(`${theme}-7-menu`);
  await page.evaluate(() => [...document.querySelectorAll('.sr-menu .mi')].find((x) => /^Vidéo · cette diapositive/.test(x.querySelector('.lb')?.textContent)).click());
  await page.waitForSelector('.pm-expp:not([hidden]) .job', { timeout: 10000 });
  const seen = new Set();
  const t0 = Date.now();
  let last = '';
  for (;;) {
    last = await page.evaluate(() => document.querySelector('.pm-expp:not([hidden]) .job .js')?.textContent || '');
    if (last) seen.add(last.split(' · ')[0]);
    if (/^(fini|échec|arrêté)/.test(last) || Date.now() - t0 > 180000) break;
    await page.waitForTimeout(200);
  }
  ok(/^fini/.test(last) && [...seen].some((x) => /en file|en cours/.test(x)), `${theme} : la progression dans le panneau (${[...seen].join(' → ')})`);
  await page.waitForSelector('.pm-expa a[download]', { timeout: 10000 });
  const links = await page.$$eval('.pm-expa a', (l) => l.map((a) => ({ t: a.textContent, href: a.getAttribute('href') || '', dl: a.getAttribute('download') || '' })));
  const dl = links.find((x) => x.dl);
  const vid = /library\/(vid-[^/]+)\//.exec(dl?.href || '')?.[1];
  ok(!!vid && /Télécharger la vidéo/.test(dl.t) && dl.dl.endsWith('.mp4') && links.some((x) => /Dans Asset/.test(x.t) && x.href.endsWith(`asset/#${vid}`)),
    `${theme} : « Télécharger la vidéo » et « Dans Asset ↗ » (${links.map((x) => x.t).join(', ')})`);
  if (vid) {
    const it = await api('GET', `library/${vid}`);
    ok(it.kind === 'video' && it.folder === 'Idéation' && it.width === 1920 && it.height === 1080 && Math.abs(it.duration - 3.0) < 0.05 && !!it.thumb_url,
      `${theme} : rangée dans la bibliothèque : une vidéo, dossier Idéation, 1920 × 1080, ${it.duration} s (1 s de motion, 2 s de pause), sa vignette`);
  }
  await page.shot(`${theme}-8-video`);
  ok(!page.errs.length, `${theme} : aucune erreur de console ${page.errs.slice(0, 3).join(' | ')}`);
  await ctx.close();
}
await api('POST', 'prefs', { patch: { general: { theme: 'dark' } } }).catch(() => {});
await browser.close();
writeFileSync(`${OUT}/pilote.log`, log.join('\n') + '\n');
console.log(`\n${log.length - fails} passés, ${fails} en échec — ${OUT}`);
process.exit(fails ? 1 : 0);
