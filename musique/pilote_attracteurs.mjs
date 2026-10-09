// Le pilote des attracteurs (09/10 ; docs/etudes/musique_odio01.md § 6) : un portail d'essai
// NEUF (tools/portail_essai.py, des données jetables), jamais le portail en ligne.
//
//   node musique/pilote_attracteurs.mjs http://127.0.0.1:8921 /tmp/sr_attracteurs
//   SR_PLAYWRIGHT=/opt/node22/lib/node_modules/playwright LC_ALL=C.UTF-8 node …   (une session cloud)
//   … --audit-seul            l'audit seul (il juge aussi une copie d'avant le 09/10 : il ne lit que
//                             le projet, le moteur et influenceA, qu'elle avait déjà)
//
// 1. L'AUDIT (audit.json) : un projet où chaque sorte de module, et trois machines (MINILOGUE XD,
//    ACID-3, TR-8S), a son attracteur — sept anneaux de 400, le centre à 200 du bord : poids 0,5 ;
//    son segment couvre les temps 4 à 8 ; chaque réglage continu loin de son défaut. La lecture en
//    temps réel ; pour chaque réglage continu, ce que le moteur entend avant (temps 2), pendant
//    (temps 6) et après (temps 10) : la valeur que tient l'instrument d'ODIO (getParameter), l'AudioParam
//    d'un module natif, la copie qu'il a reçue, la valeur que lit la scène d'un jouet. Capté (dans la
//    carte d'influenceA), entendu (pendant = neutre + (valeur − neutre) × 0,5, à son pas), rendu (après
//    = la valeur). Ce qui échappe, et pourquoi.
// 2. LE SON (son.json) : rendu hors temps réel (renderMix, comme l'export) d'une phrase de synthé à
//    travers un filtre, un attracteur TIMBRE posé dessus, segment des temps 8 à 16 ; puis le filtre
//    d'ODIO ; puis Macro (AudioWorklet de Plaits), son timbre et sa coupure captés. Par mesure : le
//    niveau (dB), la crête, le centre de gravité du spectre ; ni silence ni écrêtage ; la durée du
//    rendu (la charge de l'AudioWorklet).
// 3. L'INTERFACE, en sombre et en clair : l'attracteur frôlé cerne ce qu'il capte (poids, facettes),
//    la tuile choisie dit ses attracteurs (le panneau, les fils), le banc ses chiffres.
// Rend 0 si tout passe.
import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';

const require = createRequire(process.env.PLAYWRIGHT || `${process.env.SR_PLAYWRIGHT || '/home/dgx/Character_Sheet/node_modules/playwright'}/package.json`);
const { chromium } = require('playwright');
const [base, out] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const auditSeul = process.argv.includes('--audit-seul');
mkdirSync(out, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };
const browser = await chromium.launch({
  ...(process.env.SR_CHROMIUM || process.env.SR_PLAYWRIGHT ? { executablePath: process.env.SR_CHROMIUM || '/opt/pw-browsers/chromium' } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

async function newPage(theme, viewport = { width: 1600, height: 1000 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
  }, theme);
  const page = await ctx.newPage();
  // une ressource d'ailleurs qui ne charge pas (Google Fonts, bloqué dans un conteneur) se note sans compter
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const away = /^Failed to load resource/.test(m.text()) && !(m.location()?.url || '').startsWith(base);
    log.push(`console ${theme}: ${m.text()} ${m.location()?.url || ''}`);
    if (!away) { fails++; console.log(log.at(-1)); }
  });
  page.on('pageerror', (e) => { log.push(`PAGEERROR ${theme}: ${e.message}`); fails++; console.log(log.at(-1)); });
  return { ctx, page };
}
const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${name}.png` }); };
const api = (page, path, body = null) => page.evaluate(async ([p, b]) => {
  const r = await fetch(`/api/${p}`, b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : {});
  return r.json();
}, [path, body]);
async function ouvrir(page, template, nom) {
  await page.goto(`${base}/musique/`, { waitUntil: 'networkidle' });
  const p = await api(page, 'music/projects', { name: nom, template });
  await page.goto(`${base}/musique/?p=${p.id}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__mu?.S?.proj, null, { timeout: 20000 });
  return p.id;
}

// ═══════════════════════════════════════════════ 1. l'audit
async function audit() {
  const { page } = await newPage('dark');
  await ouvrir(page, 'vide', 'Attracteurs · audit');
  // le projet : chaque sorte de module, trois machines, chacun sous son attracteur
  const prep = await page.evaluate(async () => {
    const M = await import('/musique/modules.js'), T = await import('/musique/machines/tuiles.js'), MB = await import('/musique/machines/blocks/machines.js');
    const { S, app } = window.__mu, p = S.proj;
    const loin = (s) => (Math.abs(s.max - s.def) >= Math.abs(s.def - s.min) ? s.max : s.min);
    const master = p.modules.find((m) => m.type === 'master');
    let i = 0;
    for (const [type, d] of Object.entries(M.MODULES)) {
      const params = {};
      for (const s of d.params) if (!s.opts) params[s.k] = loin(s);
      // les coupes de l'égaliseur allumées : éteintes, elles sortent du trajet et leurs fréquences ne s'entendent pas
      if (type === 'eq') Object.assign(params, { hpo: 1, lpo: 1 });
      // la fontaine à l'écart, tout en bas : ses billes mélangent les blocs qu'elles touchent (jouets/index.js, shuffle)
      const x = type === 'fount' ? 90000 : (i % 8) * 3000, y = type === 'fount' ? 90000 : 4000 + Math.floor(i / 8) * 3000;
      i++;
      if (type === 'master') { Object.assign(master, { x, y, w: 200, h: 200, params }); continue; }
      p.modules.push({ id: `au${type}`, type, track: null, x, y, w: 200, h: 200, on: true, params });
      // câblé à la sortie : un nœud que rien ne tire n'est pas rendu, ses AudioParam ne bougent pas (un jouet sans son ne se câble pas)
      if (!d.jouet || d.role === 'effect') p.cables.push({ a: `au${type}`, b: master.id });
    }
    for (const [j, [id, type]] of [['ml', 'analog'], ['a3', 'acid'], ['tr', 'rythme']].entries()) {
      const def = MB.MACHINES.find((x) => x.id === id), y = 40000 + j * 3000, ctl = {};
      for (const s of def.sections) for (const d of T.descripteursDe(s.id)) if (d.curve !== 'choice') ctl[d.id] = d.default > 50 ? 0 : 100;
      const sec = Object.fromEntries(def.sections.map((s, k) => [s.id, { x: k * 3000, y, w: 200, h: 200 }]));
      const m = { id: `aum${id}`, type, track: null, x: 0, y, w: 200, h: 200, on: true, params: {}, mach: { id, sec, ctl } };
      T.pousserTout(m);
      p.modules.push(m);
      p.cables.push({ a: m.id, b: master.id });
    }
    p.banc = { segs: [], atts: [] };
    const FAC = ['swing', 'densité', 'accents', 'tonalité', 'tension', 'matière', 'brillance'];
    let n = 0;
    for (const t of T.tuilesDe(p, M.MODULES)) {
      if (t.bloc) continue;
      n++;
      const a = { id: `at${n}`, segment: `sg${n}`, nom: 'AUDIT', couleur: 'nd-tim', x: t.x + t.w + 200, y: t.y + t.h / 2, r: 110, loi: 1,
        anneaux: FAC.map((f) => ({ facette: f, couleur: 'nd-tim', r: 400, ang: -Math.PI / 2 })) };
      p.banc.atts.push(a); p.banc.segs.push({ id: a.segment, lane: 'tim', d: 4, l: 4, atr: a.id });
    }
    p.bpm = 120;
    // une phrase qui fait tourner le transport jusqu'au temps 12
    p.sections = []; p.markers = [];
    app.commit('graph');
    return { modules: p.modules.length, atts: p.banc.atts.length };
  });
  ok(prep.modules > 45 && prep.atts > 60, `l'audit : ${prep.modules} modules, ${prep.atts} attracteurs`);
  await page.waitForTimeout(800);
  const R = await page.evaluate(async () => {
    const M = await import('/musique/modules.js'), T = await import('/musique/machines/tuiles.js'), MB = await import('/musique/machines/blocks/machines.js');
    const I = await import('/musique/machines/influence.js');
    const { S, engine, app } = window.__mu, p = S.proj;
    const borne = (s, v) => { const x = Math.min(s.max, Math.max(s.min, v)); return s.step ? Math.round(x / s.step) * s.step : x; };
    // le banc en jeu de mesure : ce qu'on attend de chaque réglage continu
    const cas = [];
    for (const m of p.modules) {
      if (m.mach) {
        const eng = MB.MACHINE_ENGINES[m.mach.id], def = MB.MACHINES.find((x) => x.id === m.mach.id);
        for (const s of def.sections) for (const d of T.descripteursDe(s.id)) {
          const e = eng.map[d.id];
          if (d.curve === 'choice' || !e) continue;
          const sp = M.spec(m.type, e.param);
          if (!sp || sp.opts) continue;
          const op = d.default + (m.mach.ctl[d.id] - d.default) * 0.5;
          cas.push({ mod: m.id, type: `${m.mach.id}`, k: e.param, ctl: d.id, valeur: M.val(m, e.param), attendu: borne(sp, e.from(T.normeDe(d, op))), s: sp });
        }
        continue;
      }
      for (const s of M.MODULES[m.type].params) {
        if (s.opts) continue;
        cas.push({ mod: m.id, type: m.type, k: s.k, valeur: M.val(m, s.k), attendu: borne(s, s.def + (M.val(m, s.k) - s.def) * 0.5), s, facette: s.facette, sorte: s.sorte, hors: s.hors });
      }
    }
    // ce qui est capté : la carte que le moteur jouera au temps 6
    const carte = I.influenceA(p, 6);
    for (const c of cas) c.capte = !!carte.get(c.mod)?.has(c.k);
    // la lecture ; les nœuds montrent ce qu'ils reçoivent
    engine.keepGoing = true;   // aucun clip : le transport continue quand même (Engine.tick)
    await engine.playFrom(0);
    const g = engine.graph, recu = new Map();
    for (const [id, n] of g.nodes) {
      const u = n.update.bind(n);
      n.update = (mm, bpm) => { for (const [k, v] of Object.entries(mm.params || {})) recu.set(`${id}:${k}`, v); return u(mm, bpm); };
      if (n.setAt) { const sa = n.setAt.bind(n); n.setAt = (k, v, t) => { recu.set(`${id}:${k}`, v); return sa(k, v, t); }; }
    }
    g.sync(p);
    app.toys?.wake?.();
    const lire = (c) => {
      const n = g.nodes.get(c.mod), m = p.modules.find((x) => x.id === c.mod), def = M.MODULES[m.type];
      if (def.jouet && !n?.setAt) {
        const j = app.toys?.inst?.get(c.mod);
        if (j?.eff?.[c.k] !== undefined) return { v: NaN, par: 'mélange' };   // la fontaine le mélange en ce moment : rien à juger
        return { v: j ? j.V(c.k) : M.val(m, c.k), par: 'scène' };
      }
      // l'arpège, le swing : lus par le planificateur sur le module (Graph.entendu depuis le 09/10 ; le projet avant)
      if (M.PLANIFIES ? M.PLANIFIES.has(c.k) : c.k.startsWith('arp_')) return { v: M.val(g.entendu ? g.entendu(m) : m, c.k), par: 'planificateur' };
      if (n?.odio && typeof n.odio.getParameter === 'function' && !def.jouet) return { v: n.odio.getParameter(c.k), par: 'getParameter' };
      const ap = n?.ap?.[c.k];
      if (ap?.length && !def.odio) return { v: ap[0][0].value, par: 'AudioParam', fn: true };
      return { v: recu.has(`${c.mod}:${c.k}`) ? recu.get(`${c.mod}:${c.k}`) : M.val(m, c.k), par: 'copie' };
    };
    // la valeur d'un AudioParam se compare à ce que son module y pose (ap : [[param, fn]])
    const fnDe = (c) => g.nodes.get(c.mod)?.ap?.[c.k]?.[0]?.[1] || ((v) => v);
    const echantillon = async (b) => {
      while (engine.position() < b && engine.play) await new Promise((r) => setTimeout(r, 20));
      return cas.map((c) => lire(c));
    };
    const avant = await echantillon(2), pendant = await echantillon(6), apres = await echantillon(10);
    engine.stop(); engine.keepGoing = false;
    const proche = (a, b, s) => Math.abs(a - b) <= Math.max(1e-3 * Math.abs(b), 1e-3 * (s.max - s.min), s.step ? s.step / 2 : 0, 1e-6);
    const res = cas.map((c, i) => {
      const f = avant[i].fn ? fnDe(c) : (v) => v;
      const projet = f(c.valeur), op = f(c.attendu);
      return {
        type: c.type, k: c.k, ctl: c.ctl, facette: c.facette ?? null, sorte: c.sorte ?? null, hors: c.hors ?? null, par: pendant[i].par, capte: c.capte,
        avant: avant[i].v, pendant: pendant[i].v, apres: apres[i].v, valeur: projet, attendu: op,
        entendu: c.capte && Math.abs(c.attendu - c.valeur) > 1e-9 ? proche(pendant[i].v, op, avant[i].fn ? { max: 1, min: 0 } : c.s) : false,
        repos: proche(avant[i].v, projet, avant[i].fn ? { max: 1, min: 0 } : c.s) && proche(apres[i].v, projet, avant[i].fn ? { max: 1, min: 0 } : c.s),
        neutre: Math.abs(c.attendu - c.valeur) <= 1e-9,
      };
    });
    return { res, total: cas.length };
  });
  writeFileSync(`${out}/audit.json`, JSON.stringify(R, null, 1));
  const capte = R.res.filter((x) => x.capte), entendu = R.res.filter((x) => x.entendu);
  const melange = (x) => [x.avant, x.pendant, x.apres].some((v) => typeof v !== 'number' || Number.isNaN(v));
  const sourds = capte.filter((x) => !x.entendu && !x.neutre && !melange(x)), pasRendu = R.res.filter((x) => !x.repos && !melange(x));
  if (R.res.some(melange)) console.log(`  (mélangés par la fontaine pendant l'audit, non jugés : ${R.res.filter(melange).map((x) => `${x.type}.${x.k}`).join(' ')})`);
  const parType = {};
  for (const x of R.res) {
    const t = (parType[x.type] = parType[x.type] || { n: 0, capte: 0, entendu: 0 });
    t.n++; if (x.capte) t.capte++; if (x.entendu) t.entendu++;
  }
  writeFileSync(`${out}/audit_par_type.json`, JSON.stringify(parType, null, 1));
  console.log(`  ${R.total} réglages continus : ${capte.length} captés, ${entendu.length} entendus pendant, ${pasRendu.length} pas rendus`);
  ok(capte.length > 0, `l'audit : ${capte.length} réglages captés sur ${R.total}`);
  ok(!sourds.length, `l'audit : chaque réglage capté est entendu pendant que l'attracteur parle (${sourds.length} sourds : ${sourds.slice(0, 10).map((x) => `${x.type}.${x.k} ${x.par} ${x.pendant}≠${x.attendu}`).join(' · ')})`);
  ok(!pasRendu.length, `l'audit : avant et après, chaque réglage a sa valeur (${pasRendu.slice(0, 8).map((x) => `${x.type}.${x.k} ${x.avant}/${x.apres}≠${x.valeur}`).join(' · ')})`);
  await page.context().close();
  return R;
}

// ═══════════════════════════════════════════════ 2. le son
async function son() {
  const { page } = await newPage('dark');
  await ouvrir(page, 'vide', 'Attracteurs · son');
  const R = await page.evaluate(async () => {
    const M = await import('/musique/modules.js'), E = await import('/musique/moteur.js');
    const { S, app, engine } = window.__mu, p = S.proj;
    // une piste de synthé : une phrase de huit croches par mesure, sur six mesures
    const tr = app.addTrack('synth', { type: 'synth', name: 'Phrase' });
    const pat = p.patterns.find((x) => x.id === tr.pat);
    pat.steps = 16; pat.notes = [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => ({ s, l: 2, p: [45, 52, 57, 60, 57, 52, 48, 55][i], v: 0.8 }));
    p.clips.push({ id: 'cson', track: tr.id, start: 0, len: 24, pat: pat.id });
    const src = p.modules.find((m) => m.id === tr.src);
    src.params = { ...src.params, cut: 6000, res: 2, fenv: 0, vol: -12 };
    const strip = p.modules.find((m) => m.id === tr.strip);
    // l'effet, entre la source et la tranche
    const fx = (type, params) => {
      p.cables = p.cables.filter((c) => c.b !== strip.id && !c.a.startsWith('sonfx') && !c.b.startsWith('sonfx'));
      p.modules = p.modules.filter((m) => !m.id.startsWith('sonfx'));
      const m = { id: `sonfx${type}`, type, track: tr.id, x: 600, y: 0, w: 200, h: 200, on: true, params };
      p.modules.push(m);
      p.cables.push({ a: src.id, b: m.id }, { a: m.id, b: strip.id });
      return m;
    };
    // n° 55 : au centre, l'opérateur vaut le réglage du bloc ; au bord, sa valeur neutre (le défaut).
    // L'attracteur posé à 0,9 rayon du bord de la boîte : poids 0,1, le réglage ramené aux neuf dixièmes
    // vers son défaut
    const attracteur = (m, facette) => {
      p.banc = { segs: [{ id: 'sgson', lane: 'tim', d: 8, l: 8, atr: 'atson' }],
        atts: [{ id: 'atson', segment: 'sgson', nom: 'TIMBRE', couleur: 'nd-tim', x: m.x + m.w + 378, y: m.y + m.h / 2, r: 110, loi: 1,
          anneaux: [{ facette, couleur: 'nd-tim', r: 420, ang: 0 }] }] };
    };
    // le centre de gravité du spectre, le niveau, la crête, mesure par mesure (2 s à 120 : 96 000 images à 48 kHz)
    const fft = (re, im) => {
      const n = re.length;
      for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
      for (let len = 2; len <= n; len <<= 1) {
        const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
        for (let i = 0; i < n; i += len) {
          let cr = 1, ci = 0;
          for (let j = 0; j < len / 2; j++) {
            const ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
            re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
            const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
          }
        }
      }
    };
    const mesures = (buf) => {
      const sr = buf.sampleRate, d = buf.getChannelData(0), par = Math.round(2 * sr), N = 4096, out = [];
      for (let b = 0; b + par <= d.length && out.length < 6; b += par) {
        let s2 = 0, pk = 0, num = 0, den = 0;
        for (let i = b; i < b + par; i++) { s2 += d[i] * d[i]; pk = Math.max(pk, Math.abs(d[i])); }
        for (let w = b; w + N <= b + par; w += N) {
          const re = new Float64Array(N), im = new Float64Array(N);
          for (let i = 0; i < N; i++) re[i] = d[w + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
          fft(re, im);
          for (let k = 1; k < N / 2; k++) { const mg = Math.hypot(re[k], im[k]); num += mg * k * sr / N; den += mg; }
        }
        out.push({ rms: +(10 * Math.log10(s2 / par + 1e-12)).toFixed(1), crete: +(20 * Math.log10(pk + 1e-12)).toFixed(1), centre: Math.round(num / (den || 1)) });
      }
      return out;
    };
    const rendu = async (nom) => {
      app.commit('graph');
      const t0 = performance.now();
      const buf = await E.renderMix(engine, p, 0, 24, { tail: 0 });
      return { nom, ms: Math.round(performance.now() - t0), secondes: +(buf.length / buf.sampleRate).toFixed(2), mesures: mesures(buf) };
    };
    const out = [];
    // le filtre d'ici : coupure 400 Hz (son défaut, 2 400) ; pendant que l'attracteur parle (temps 8 à 16),
    // 400 + (2 400 − 400) × 0,9 = 2 200 Hz : le son s'éclaircit, puis revient
    attracteur(fx('filter', { freq: 400, q: 1 }), 'brillance');
    out.push(await rendu('filtre natif, coupure 400 → 2 200 Hz (brillance, poids 0,1)'));
    attracteur(fx('filtre', { cutoff: 300, reso: 3.5, drive: 12 }), 'brillance');
    out.push(await rendu('filtre d\'ODIO (flt-07), coupure 300 → 1 110 Hz (brillance, poids 0,1)'));
    // Macro : le timbre et la coupure (brillance) ; la source même est captée
    const mac = p.modules.find((m) => m.id === src.id);
    Object.assign(mac, { type: 'macro', w: 200, h: 200, params: { moteur: 8, timbre: 0.05, cutoff: 900, harmo: 0.5, morph: 0.5, gain: 0.4 } });
    fx('eq3', {});
    attracteur(mac, 'brillance');
    out.push(await rendu('Macro (AudioWorklet), timbre 0,05 → 0,46 et coupure 900 → 14 490 Hz (brillance, poids 0,1)'));
    // le swing : une DR-9, un charley à chaque double croche, swing 75 % ; l'attracteur (anneau swing, poids 0,1)
    // le ramène à 52,5 % pendant les temps 8 à 16 — le retard de chaque double croche impaire, mesuré dans le son
    p.clips = p.clips.filter((c) => c.id !== 'cson');
    const bt = app.addTrack('drums', { type: 'drums', name: 'Charley' });
    const bp = p.patterns.find((x) => x.id === bt.pat);
    bp.steps = 16; bp.lanes = { ch: Array(16).fill(1) };
    p.clips.push({ id: 'cdr', track: bt.id, start: 0, len: 24, pat: bp.id });
    const dr = p.modules.find((m) => m.id === bt.src);
    Object.assign(dr, { w: 200, h: 200, params: { swing: 75 } });
    p.banc = { segs: [{ id: 'sgsw', lane: 'ryt', d: 8, l: 8, atr: 'atsw' }],
      atts: [{ id: 'atsw', segment: 'sgsw', nom: 'RYTHME', couleur: 'nd-ryt', x: dr.x + dr.w + 378, y: dr.y + dr.h / 2, r: 110, loi: 1,
        anneaux: [{ facette: 'swing', couleur: 'nd-ryt', r: 420, ang: 0 }] }] };
    app.commit('graph');
    const buf = await E.renderMix(engine, p, 0, 24, { tail: 0, solo: bt.id });
    const d = buf.getChannelData(0), sr = buf.sampleRate, spb = 60 / p.bpm;
    let pk = 0;
    for (const x of d) pk = Math.max(pk, Math.abs(x));
    const seuil = pk * 0.2, attaques = [];
    let calme = sr;   // échantillons sous le seuil depuis la dernière attaque
    for (let i = 0; i < d.length; i++) {
      if (Math.abs(d[i]) > seuil && calme > sr * 0.03) attaques.push(i / sr);
      calme = Math.abs(d[i]) > seuil ? 0 : calme + 1;
    }
    // le retard d'une attaque sur la grille droite, en ms, pour chaque double croche impaire
    const retard = (b0, b1) => {
      const r = attaques.map((t) => t / spb).filter((b) => b >= b0 && b < b1).map((b) => b * 4).filter((x) => Math.round(x - 0.2) % 2 === 1)
        .map((x) => (x - Math.floor(x + 0.25)) * spb / 4 * 1000);
      return r.length ? Math.round(r.reduce((a, x) => a + x, 0) / r.length * 10) / 10 : null;
    };
    out.push({ nom: 'swing de la DR-9, 75 % → 52,5 % (swing, poids 0,1)', attaques: attaques.length, retards: [retard(0.5, 8), retard(8.5, 16), retard(16.5, 24)] });
    return out;
  });
  writeFileSync(`${out}/son.json`, JSON.stringify(R, null, 1));
  const sw = R.pop();
  console.log(`  ${sw.nom} : ${sw.attaques} attaques ; retard d'une double croche impaire : ${sw.retards.join(' → ')} ms`);
  ok(sw.attaques === 96 && Math.abs(sw.retards[0] - 62.5) < 3 && Math.abs(sw.retards[1] - 6.25) < 3 && Math.abs(sw.retards[2] - 62.5) < 3,
    `le son, le swing : 96 doubles croches ; 62,5 ms de retard à 75 %, 6,25 ms pendant que l'attracteur parle (52,5 %), puis 62,5 ms (${sw.retards.join(' → ')} ms)`);
  for (const r of R) {
    // une mesure = quatre temps (2 s à 120) : 1-2 avant le segment (temps 0-8), 3-4 pendant (8-16), 5-6 après
    console.log(`  ${r.nom} : ${r.mesures.map((m) => `${m.centre} Hz ${m.rms} dB`).join(' | ')} — rendu ${r.ms} ms pour ${r.secondes} s`);
    const avant = r.mesures[1]?.centre, pendant = r.mesures[2]?.centre, apres = r.mesures[4]?.centre;
    ok(r.mesures.length >= 6 && r.mesures.every((m) => m.rms > -60), `le son, ${r.nom} : jamais de silence (${r.mesures.map((m) => m.rms).join(' / ')} dB)`);
    ok(r.mesures.every((m) => m.crete < 0), `le son, ${r.nom} : jamais d'écrêtage (crête ${Math.max(...r.mesures.map((m) => m.crete))} dBFS)`);
    ok(pendant > avant * 1.15 && apres < pendant / 1.15, `le son, ${r.nom} : l'attracteur s'entend — le spectre s'éclaircit pendant qu'il parle, puis revient (${avant} → ${pendant} → ${apres} Hz)`);
  }
  await page.context().close();
  return R;
}

// ═══════════════════════════════════════════════ 3. l'interface
async function interfaces(theme) {
  const { page } = await newPage(theme);
  await ouvrir(page, 'session', `Attracteurs · ${theme}`);
  await page.keyboard.press('Tab').catch(() => {});
  await page.evaluate(() => { const b = document.querySelector('[data-view="nodal"]'); b?.click(); });
  await page.waitForTimeout(1200);
  // deux attracteurs : TIMBRE sur la basse acide, RYTHME sur la boîte à rythme
  const ids = await page.evaluate(() => {
    const { S, app } = window.__mu, p = S.proj;
    const T = app.nodal.tuiles();
    const acid = T.find((t) => t.type === 'acid'), ryt = T.find((t) => t.type === 'rythme');
    // la basse acide loin de ses défauts : l'opérateur se voit (520 Hz, réso 12 par défaut)
    Object.assign(p.modules.find((m) => m.id === acid.mod).params, { cutoff: 2400, resonance: 3, envMod: 20 });
    p.banc = { segs: [{ id: 'gtim', lane: 'tim', d: 0, l: 16, atr: 'atim' }, { id: 'gryt', lane: 'ryt', d: 4, l: 12, atr: 'aryt' }],
      atts: [
        { id: 'atim', segment: 'gtim', nom: 'TIMBRE', couleur: 'nd-tim', x: acid.x + acid.w + 140, y: acid.y + acid.h / 2, r: 110, loi: 1,
          anneaux: [{ facette: 'matière', couleur: 'nd-tim', r: 260, ang: -Math.PI / 2 }, { facette: 'brillance', couleur: 'nd-har', r: 420, ang: -Math.PI / 4 }] },
        { id: 'aryt', segment: 'gryt', nom: 'RYTHME', couleur: 'nd-ryt', x: ryt.x - 160, y: ryt.y + ryt.h / 2, r: 110, loi: 1,
          anneaux: [{ facette: 'swing', couleur: 'nd-ryt', r: 260, ang: -Math.PI / 2 }, { facette: 'densité', couleur: 'nd-har', r: 420, ang: 0 }, { facette: 'accents', couleur: 'nd-nrj', r: 580, ang: Math.PI / 2 }] },
      ] };
    app.commit('meta');
    return { acid: acid.id, ryt: ryt.id };
  });
  await page.waitForTimeout(800);
  // cadrer la basse et la boîte à rythme (F sur la sélection), puis ne plus rien choisir
  await page.evaluate((x) => { const n = window.__mu.app.nodal; n.choisir([x.acid, x.ryt]); n.cadrer(); }, ids);
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__mu.app.nodal.choisir([]));
  await page.waitForTimeout(400);
  // le survol de l'attracteur TIMBRE : ce qu'il capte, cerné
  const c = await page.$('[data-atr="atim"] .bn-centre');
  ok(!!c, `${theme} : l'attracteur TIMBRE est sur le nodal`);
  if (c) {
    const bb = await c.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.waitForTimeout(500);
    const capte = await page.$$eval('.bn-capte-et', (xs) => xs.map((x) => ({ id: x.dataset.capte, et: x.textContent })));
    const cernes = await page.$$eval('.bn-capte', (xs) => xs.length);
    ok(cernes >= 1 && capte.length === cernes && capte.some((x) => /matière|brillance/.test(x.et)), `${theme} : au survol, l'attracteur cerne ce qu'il capte, poids et facettes (${capte.map((x) => x.et).join(' | ')})`);
    await shot(page, `${theme}_1_survol`);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    ok(!(await page.$('.bn-capte')), `${theme} : la souris partie, plus rien n'est cerné`);
  }
  // la tuile choisie : ses attracteurs, dans le panneau et sur les fils
  await page.evaluate((id) => window.__mu.app.nodal.choisir([id]), ids.acid);
  await page.waitForTimeout(600);
  const panneau = await page.$eval('.nd-atr', (n) => n.innerText).catch(() => '');
  ok(/TIMBRE/.test(panneau) && /→/.test(panneau), `${theme} : la tuile choisie dit les attracteurs qui la captent et ce qu'ils ramènent (${panneau.split('\n').slice(0, 4).join(' / ')})`);
  const fils = await page.$$eval('.bn-lien-et', (xs) => xs.map((x) => x.textContent));
  ok(fils.length >= 1, `${theme} : la tuile choisie est reliée à chaque attracteur qui la capte (${fils.join(' | ')})`);
  await shot(page, `${theme}_2_tuile`);
  // la lecture : les chiffres du banc (poids, valeur → opérateur), la tuile qui parle
  await page.evaluate(() => window.__mu.engine.playFrom(5));
  await page.waitForTimeout(1500);
  const lignes = await page.$$eval('.bn-op', (xs) => xs.slice(0, 6).map((x) => x.textContent));
  ok(lignes.some((l) => /×0\.\d\d/.test(l)), `${theme} : le banc dit le poids de chaque réglage capté (${lignes.slice(0, 3).join(' | ')})`);
  await shot(page, `${theme}_3_lecture`);
  await page.evaluate(() => window.__mu.engine.stop());
  // une tuile sans attracteur : ce qu'elle offre, et le geste
  await page.evaluate(() => { const T = window.__mu.app.nodal.tuiles(); const r = T.find((t) => t.type === 'reverb' || t.type === 'reverbe'); if (r) window.__mu.app.nodal.choisir([r.id]); });
  await page.waitForTimeout(500);
  const offre = await page.$eval('.nd-atr', (n) => n.innerText).catch(() => '');
  ok(/offre|capte/.test(offre), `${theme} : une tuile qu'aucun attracteur ne capte dit ce qu'elle offre (${offre.slice(0, 120)})`);
  await shot(page, `${theme}_4_offre`);
  await page.context().close();
}

try {
  await audit();
  if (!auditSeul) {
    await son();
    await interfaces('dark');
    await interfaces('light');
  }
} catch (e) { ok(false, `le pilote a planté : ${e.stack || e}`); }
writeFileSync(`${out}/journal.txt`, log.join('\n'));
await browser.close();
console.log(fails ? `${fails} échec(s)` : 'tout passe');
process.exit(fails ? 1 : 0);
