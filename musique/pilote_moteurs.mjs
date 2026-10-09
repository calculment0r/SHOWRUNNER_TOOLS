// Le pilote des moteurs d'ODIO (09/10 ; docs/etudes/odio_synthes.md § 7) : un portail d'essai
// NEUF en moteurs factices (tools/portail_essai.py, des données jetables), jamais le portail en
// ligne. Pour essayer les échantillons, ses données portent au moins une banque :
//
//   python3 tools/echantillons.py importer vcsl-vibraphone salamander --essai 6 --donnees <données>
//   node musique/pilote_moteurs.mjs http://127.0.0.1:8911 /tmp/sr_moteurs/shots
//   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright/package.json node …   (une session cloud)
//
// Le parcours : un projet neuf → une piste Résonateur, une Physique, une Échantillons (la
// première banque installée ; sans banque, le rack doit dire comment en installer) avec un
// préréglage chacune → chaque piste exportée seule : ni silence, ni écrêtage, ni NaN → la vue
// Instruments de chacune → les cinq machines posées dans le nodal sur leurs vrais moteurs (FM-6,
// STRINGS-4 et la MicroFreak sur Macro, POLY-6 et le MINILOGUE sur le Synthé), chacune sonne →
// un projet d'avant (le FM-6 sur l'Analog) migre à l'ouverture → le navigateur : les
// préréglages du Résonateur, ▶ écoute. Captures en sombre et en clair. Rend 0 si tout passe.
import { createRequire } from 'module';
import { mkdirSync } from 'fs';

const require = createRequire(process.env.PLAYWRIGHT || '/home/dgx/Character_Sheet/package.json');
const { chromium } = require('playwright');
const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; };
const browser = await chromium.launch({
  ...(process.env.SR_CHROMIUM ? { executablePath: process.env.SR_CHROMIUM } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

async function newPage(theme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
  }, theme);
  const page = await ctx.newPage();
  // une ressource d'ailleurs qui ne charge pas (Google Fonts, bloqué dans un conteneur) se note sans compter
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const away = /^Failed to load resource/.test(m.text()) && !(m.location()?.url || '').startsWith(base);
    if (!away) { fails++; console.log(`console ${theme}: ${m.text()} ${m.location()?.url || ''}`); }
  });
  page.on('pageerror', (e) => { fails++; console.log(`PAGEERROR ${theme}: ${e.message}`); });
  return { ctx, page };
}
const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${name}.png` }); };
const api = (page, path, body = null) => page.evaluate(async ([p, b]) => {
  const r = await fetch(`/api/${p}`, b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : {});
  return r.json();
}, [path, body]);
const ouvrir = async (page, id) => {
  await page.goto(`${base}/musique/?p=${id}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__mu?.S?.proj);
};

for (const theme of ['dark', 'light']) {
  const { ctx, page } = await newPage(theme);
  await page.goto(`${base}/musique/`, { waitUntil: 'networkidle' });
  const banques = (await api(page, 'music/banques')).banques || [];
  const proj = await api(page, 'music/projects', { name: `Moteurs ${theme}`, template: 'vide' });
  await ouvrir(page, proj.id);

  // ── trois pistes : Résonateur, Physique, Échantillons ──
  const pistes = await page.evaluate(async (bid) => {
    const { app, S } = window.__mu;
    const poser = (kind, type, preset, notes) => {
      const t = app.addTrack(kind, { type });
      if (preset) app.applyPreset(t.id, preset);
      if (bid && type === 'banque') { app.mod(t.src).params.banque = bid; }
      const pat = app.pat(t.pat);
      pat.notes = notes;
      S.proj.clips.push({ id: app.uid('c'), track: t.id, start: 0, pat: pat.id, len: 4 });
      return t.id;
    };
    const accords = [57, 60, 64].map((p) => ({ s: 0, l: 8, p, v: 0.8 })).concat([62, 65, 69].map((p) => ({ s: 8, l: 8, p, v: 0.7 })));
    const ids = {
      resonateur: poser('synth', 'resonateur', 'rs-cloche', [0, 4, 8, 12].map((s, i) => ({ s, l: 4, p: [60, 64, 67, 72][i], v: 0.85 }))),
      physique: poser('synth', 'physique', 'ph-archet', accords),
      banque: poser('sampler', 'banque', null, [0, 4, 8, 12].map((s, i) => ({ s, l: 4, p: 60 + 2 * i, v: 0.4 + 0.2 * i }))),
    };
    app.commit('graph');
    return ids;
  }, banques[0]?.id || null);
  ok(pistes.resonateur && pistes.physique && pistes.banque, `${theme} : trois pistes (Résonateur, Physique, Échantillons${banques[0] ? ` · ${banques[0].nom}` : ', sans banque'})`);

  // ── chaque piste seule, exportée ──
  const niv = await page.evaluate(async (ids) => {
    const { S, engine, renderMix } = window.__mu;
    await engine.need(S.proj);
    const res = {};
    for (const [k, id] of Object.entries(ids)) {
      const buf = await renderMix(engine, S.proj, 0, 4, { solo: id, tail: 1 });
      let pk = 0, nan = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) { if (v !== v) nan++; pk = Math.max(pk, Math.abs(v)); }
      res[k] = { crete: +(20 * Math.log10(pk || 1e-12)).toFixed(1), nan };
    }
    return res;
  }, pistes);
  for (const [k, r] of Object.entries(niv)) {
    if (k === 'banque' && !banques.length) { ok(r.crete < -200, `${theme} : sans banque, la piste Échantillons se tait (${r.crete} dBFS)`); continue; }
    ok(r.nan === 0 && r.crete > -40 && r.crete < -0.5, `${theme} : ${k} exporté seul, ni silence ni écrêtage (${r.crete} dBFS)`);
  }

  // ── la vue Instruments de chacune ──
  for (const [k, id] of Object.entries(pistes)) {
    await page.evaluate((tid) => { const { app, S } = window.__mu; S.sel.track = tid; app.showDetail('device'); }, id);
    await page.waitForTimeout(700);
    if (k === 'banque') {
      const txt = await page.evaluate(() => document.querySelector('.dev.banque')?.innerText || '');
      ok(banques.length ? txt.includes(banques[0].licence) : /tools\/echantillons\.py/.test(txt),
        `${theme} : le rack des Échantillons dit ${banques.length ? 'la banque, sa licence' : 'comment installer une banque'}`);
    } else {
      const n = await page.evaluate((type) => document.querySelectorAll(`.dev.${type} .ap-groupe`).length, k);
      ok(n >= 3, `${theme} : le rack du ${k} range ses molettes en groupes (${n})`);
    }
    await shot(page, `${theme}-rack-${k}`);
  }

  // ── les machines sur leurs vrais moteurs ──
  const machines = await page.evaluate(async () => {
    const { app, S } = window.__mu;
    app.setView('nodal');
    await new Promise((r) => setTimeout(r, 600));
    const res = {};
    let x = 0;
    for (const id of ['f6', 's4', 'mf', 'p6', 'ml']) {
      app.nodal.poser(`machine:${id}`, { x, y: 1200 });
      x += 900;
      res[id] = S.proj.modules.find((m) => m.mach?.id === id)?.type;
    }
    app.commit('graph');
    app.nodal.cadrer?.();
    return res;
  });
  ok(machines.f6 === 'macro' && machines.s4 === 'macro' && machines.mf === 'macro' && machines.p6 === 'synth' && machines.ml === 'synth',
    `${theme} : FM-6, STRINGS-4, MICROFREAK sur Macro ; POLY-6, MINILOGUE sur le Synthé (${JSON.stringify(machines)})`);
  const nivM = await page.evaluate(async () => {
    const { S, engine, renderMix } = window.__mu;
    const res = {};
    for (const m of S.proj.modules.filter((x) => x.mach && x.track)) {
      const buf = await renderMix(engine, S.proj, 0, 16, { solo: m.track, tail: 1 });
      let pk = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) pk = Math.max(pk, Math.abs(v));
      res[m.mach.id] = +(20 * Math.log10(pk || 1e-12)).toFixed(1);
    }
    return res;
  });
  ok(Object.values(nivM).length === 5 && Object.values(nivM).every((v) => v > -40 && v < -0.5), `${theme} : chaque machine posée joue sa phrase (${JSON.stringify(nivM)})`);
  await shot(page, `${theme}-nodal-machines`);

  // ── un projet d'avant : le FM-6 sur l'Analog, migré à l'ouverture ──
  const vieux = await api(page, 'music/projects', { name: `Avant ${theme}`, template: 'vide' });
  const doc = await api(page, `music/projects/${vieux.id}`);
  const tid = 'tf6', src = 'mf6', strip = 'sf6';
  doc.tracks.push({ id: tid, name: 'FM–6', kind: 'synth', color: 'cy', mute: false, solo: false, src, strip });
  doc.modules.push({ id: src, type: 'analog', track: tid, x: 0, y: 0, on: true, params: { wave: 1, cutoff: 5000, gain: 0.35 },
    mach: { id: 'f6', sec: { f6_c1: { x: 0, y: 0, w: 300, h: 200 } }, ctl: { f6_alg: 0 } } },
  { id: strip, type: 'strip', track: tid, x: 400, y: 0, on: true, params: {} });
  const master = doc.modules.find((m) => m.type === 'master');
  doc.cables.push({ a: src, b: strip }, { a: strip, b: master.id });
  const enr = await api(page, `music/projects/${vieux.id}`, doc);
  ok(enr.rev === 2, `${theme} : un projet d'avant, le FM-6 sur l'Analog (${JSON.stringify(enr).slice(0, 80)})`);
  await ouvrir(page, vieux.id);
  const migre = await page.evaluate(() => window.__mu.S.proj.modules.find((m) => m.id === 'mf6'));
  ok(migre?.type === 'macro' && migre.params.moteur === 3 && Math.abs(migre.params.harmo - 0.0153) < 0.001 && migre.params.cutoff === undefined,
    `${theme} : à l'ouverture, son FM-6 joue Macro, la banque 2, le patch de son bouton algo (${JSON.stringify(migre?.params)})`);

  // ── le navigateur : les préréglages du Résonateur, ▶ ──
  await ouvrir(page, proj.id);
  await page.evaluate(() => {
    const { app, S } = window.__mu;
    S.sel.track = S.proj.tracks.find((t) => app.mod(t.src)?.type === 'resonateur').id;
    S.proj.ui.navOpen = { pre: true, space: false, proj: false };
    try { localStorage.setItem('odio.prereglages', JSON.stringify({ inst: 'piste' })); } catch { /* */ }
    app.setView('timeline');
  });
  await page.waitForTimeout(800);
  const noms = await page.evaluate(() => [...document.querySelectorAll('.nv-sec[data-sec="pre"] .nv-list')].map((n) => n.innerText).join(' '));
  ok(/Cloche modale/.test(noms) && /Cordes sympathiques/.test(noms), `${theme} : le navigateur montre les préréglages du Résonateur`);
  const joue = await page.evaluate(async () => {
    const b = document.querySelector('.nv-sec[data-sec="pre"] [data-ecoute="rs-verre"]');
    if (!b) return 'pas de bouton';
    const vu = new Promise((r) => document.addEventListener('mu:ecoute', (e) => { if (e.detail?.id) r(e.detail.id); }, { once: true }));
    b.click();
    return Promise.race([vu, new Promise((r) => setTimeout(() => r('rien en 8 s'), 8000))]);
  });
  ok(joue === 'rs-verre', `${theme} : ▶ écoute « Verre » (${joue})`);
  await shot(page, `${theme}-navigateur`);
  await ctx.close();
}
await browser.close();
console.log(fails ? `${fails} échec(s)` : 'tout passe');
process.exit(fails ? 1 : 0);
