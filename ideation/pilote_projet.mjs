// Le pilote de « Commencer un projet » (ideation/projet.js ; docs/etudes/mode_showrunner.md), de
// bout en bout, sur un portail d'ESSAI (tools/portail_essai.py : porte coupée, on entre en Cal,
// moteurs factices) — jamais le portail en ligne : il crée des comptes et des Teams.
//
//   python3 tools/portail_essai.py 8803 /tmp/sr_essai_projet &
//   node ideation/pilote_projet.mjs http://127.0.0.1:8803 /tmp/sr_pilote_projet [A G B C D E F]
//
// Il fabrique ses fichiers (<out>/fx : image, vidéo, son, PDF, DOCX, textes, un nom accentué ; par
// python3, server/tools/documents.py et PIL ; ffmpeg s'il est là) et trois comptes à proposer.
//   A  (G en clair) l'accueil → « Commencer un projet » → la fenêtre → le brief tapé et un brief.txt
//      glissé, dix fichiers au trombone, un double, un nom NFD → deux personnes → Commencer : la Team,
//      son Workspace renommé, les membres, l'onglet, la planche, les fichiers rangés, brief.md, les
//      cadres, la planche enregistrée AVANT l'analyse, l'agent (un faux : open() puis send()).
//   B  clair, sans agent : un dossier entier (sous-dossier, .DS_Store), deux objets d'Asset par le
//      panneau (d'ici, d'un autre Workspace : rien n'est copié avant le départ), le nom par défaut.
//   C  étroit (390 px), sombre et clair.   D  le compte qui ne crée pas de Team (réponse interceptée).
//   E  30 fichiers et un brief de 6 000 signes : les bornes de l'agent (4 000 signes ; toutes les pièces).
//   F  Échap, le menu, un fichier refusé (la phrase du portail), une étape qui tombe → Reprendre,
//      le brief d'un PDF lu par le portail.
//   H  (06/10) avec le VRAI agent sur un faux Ollama — le portail lancé avec SR_OLLAMA_URL
//      (tools/faux_ollama.py), sinon H est sauté en le disant — sombre et clair : un brief sans
//      rapport, des documents hétéroclites, un .webm et un .mp4 sans image (des sons) ; la
//      réception, ce qui ne colle pas, les questions cliquables, rien de posé ; une réponse → le
//      plan ; accepté → une étape, un geste ; « Annuler ce tour ».
// Chromium tourne en locale UTF-8 : sous la locale POSIX (un conteneur), il laisse tomber sans rien
// dire les chemins non ASCII de setInputFiles (« repérage_rue.mp4 » manquait, 05/10 : un artefact de
// l'essai, pas de la page — un <input> nu fait de même). Rend 0 si tout passe ; le détail dans
// <out>/pilote.log, les captures dans <out>.
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'fs';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
let chromium;
for (const p of [process.env.SR_PLAYWRIGHT, '/opt/node22/lib/node_modules/playwright', '/home/dgx/Character_Sheet/node_modules/playwright'].filter(Boolean)) {
  try { ({ chromium } = require(p)); break; } catch { /* le suivant */ }
}
const REPO = fileURLToPath(new URL('..', import.meta.url));
const [BASE = 'http://127.0.0.1:8795', OUT = '/tmp/sr_pilote_projet', ...want] = process.argv.slice(2);
const FX = `${OUT}/fx`;
mkdirSync(FX, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };
const say = (s) => { log.push(s); console.log(s); };

// ── les fichiers d'essai, fabriqués ici ─────────────────────
execFileSync('python3', ['-c', `
import io, math, os, shutil, struct, subprocess, sys, tempfile, wave
os.environ.setdefault("SHOWRUNNER_DATA", tempfile.mkdtemp(prefix="sr_fx_"))
sys.path.insert(0, ${JSON.stringify(`${REPO}server`)})
from PIL import Image, ImageDraw
from tools import documents
fx = sys.argv[1]
for n, c in (("moodboard_01.png", (200, 80, 60)), ("décor_nuit.jpg", (30, 40, 90)), ("perso.webp", (60, 160, 90))):
    im = Image.new("RGB", (640, 400), c); ImageDraw.Draw(im).rectangle((40, 40, 300, 200), fill=(240, 240, 240)); im.save(os.path.join(fx, n))
d = documents.fixtures()
for n in ("dossier.pdf", "note.docx"):
    open(os.path.join(fx, n), "wb").write(d[n])
open(os.path.join(fx, "notes.md"), "w").write("# Notes\\n\\n- caméra à l'épaule\\n- palette froide\\n")
open(os.path.join(fx, "donnees.bin"), "wb").write(bytes(range(256)))
with wave.open(os.path.join(fx, "ambiance.wav"), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050)
    w.writeframes(b"".join(struct.pack("<h", int(9000 * math.sin(i * 440 * 2 * math.pi / 22050))) for i in range(22050)))
# 06/10 : deux sons dans des conteneurs vidéo (un mémo vocal .webm, une voix off .mp4) : ils vont dans « Sons »
if shutil.which("ffmpeg"):
    for n, codec in (("note_vocale.webm", "libopus"), ("voix_off.mp4", "libopus")):
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=1", "-c:a", codec,
                        os.path.join(fx, n)], check=True)
for n, src, t in (("repérage_rue.mp4", "testsrc", 2), ("plan_large.mp4", "testsrc2", 1)):
    p = os.path.join(fx, n)
    if shutil.which("ffmpeg"):
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"{src}=size=320x180:rate=24", "-t", str(t),
                        "-pix_fmt", "yuv420p", p], check=True)
    else:   # l'en-tête suffit au rangement (library.sniff) ; sans vignette
        open(p, "wb").write(b"\\x00\\x00\\x00\\x18ftypmp42" + b"\\x00" * 64)
`, FX], { stdio: 'inherit' });
const fxNames = readdirSync(FX);

const api = async (p, o = {}) => {
  const r = await fetch(`${BASE}/api/${p}`, { ...o, headers: { Origin: BASE, ...(typeof o.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(o.headers || {}) } });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { error: t }; }
};
const upload = (name, buf, space) => api(`library/upload?name=${encodeURIComponent(name)}&title=${encodeURIComponent(name.replace(/\.[^.]+$/, ''))}`,
  { method: 'PUT', body: buf, headers: { 'X-SR-Espace': space, 'Content-Type': 'application/octet-stream' } });
const libOf = async (space) => (await api('library?limit=500', { headers: { 'X-SR-Espace': space } })).items || [];
// trois comptes qui existent, à proposer dans « avec qui » (409 : déjà là)
for (const name of ['Hugo Essai', 'Léa Martin', 'Zoé Studio']) await api('admin/users', { method: 'POST', body: JSON.stringify({ name, access: 'studio' }) });

const browser = await chromium.launch({ env: { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' } });
async function newPage(theme, viewport = { width: 1440, height: 900 }, mobile = false) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
  }, theme);
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    // Google Fonts coupé par le réseau d'un conteneur : pas la page
    if (/fonts\.googleapis|ERR_CERT_AUTHORITY_INVALID/.test(m.text() + (m.location()?.url || ''))) return;
    errs.push(`${m.type()}: ${m.text()} ${m.location()?.url || ''}`);
  });
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
  page.on('requestfailed', (r) => { if (!/fonts\.googleapis/.test(r.url())) errs.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`); });
  page.errs = errs;
  page.shot = async (n) => { await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/${n}.png` }); };
  return { ctx, page };
}
const visibleGo = (page) => page.$$eval('.tb.go', (l) => l.filter((x) => x.offsetWidth || x.offsetHeight).length);
async function ouvrir(page, depuisAccueil = false) {
  if (depuisAccueil) {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    ok(await visibleGo(page) === 1, "l'accueil : un seul orange");
    const go = page.locator('a.acc-go');
    ok(await go.count() === 1 && /Commencer un projet/.test(await go.textContent()), "l'accueil : « Commencer un projet »");
    await page.shot(`${page.tag}-01-accueil`);
    await go.click();
    await page.waitForURL(/ideation\/\?projet=nouveau/);
  } else await page.goto(`${BASE}/ideation/?projet=nouveau`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.modal.pj');
  await page.waitForFunction(() => !/vérifie/.test(document.querySelector('.modal.pj .pj-why')?.textContent || ''));
}
async function joindre(page, paths) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.pj-clip')]);
  await fc.setFiles(paths);
}
const tileCount = (page) => page.$$eval('.pj-tile', (l) => l.length);
async function attendreFin(page) {
  await page.waitForFunction(() => { const p = window.ideation.projet; return !p || p.P.done || (!p.P.running && /Reprendre/.test(document.querySelector('.modal.pj .tb.go')?.textContent || '')); },
    null, { timeout: 90000 });
  return page.evaluate(() => {
    const p = window.ideation.projet;
    return p && { done: p.P.done, R: { team: p.P.R.team?.id, space: p.P.R.space?.id, board: p.P.R.board?.id, memberErr: p.P.R.memberErr },
      files: p.P.files.map((f) => ({ name: f.name, state: f.state, error: f.error || '', kind: f.result?.kind || '', space: f.result?.space || '', id: f.result?.id, title: f.result?.title })),
      steps: [...document.querySelectorAll('.pj-steps li')].map((li) => ({ k: li.dataset.k, cls: li.className, t: li.textContent })) };
  });
}
const etapes = (P) => say(P.steps.map((s) => `       ${s.cls || '·'} ${s.t}`).join('\n'));
// l'agent : un faux à la place du vrai (ideation/agent.js), qui note les appels et l'état de la planche
// à cet instant ; ou aucun (B)
const fauxAgent = () => {
  window.__agent = [];
  Object.defineProperty(window.ideation.app, 'agent', { configurable: true, writable: true, value: {
    open: () => window.__agent.push({ open: true }),
    send: (text, o) => { window.__agent.push({ text, o: JSON.parse(JSON.stringify(o)), dirty: window.ideation.S.dirty, saving: !!window.ideation.S.saving, nodes: window.ideation.S.board?.nodes.length }); return Promise.resolve({ turn: 't0' }); },
    busy: () => false } });
};
const sansAgent = () => Object.defineProperty(window.ideation.app, 'agent', { configurable: true, get: () => undefined, set: () => {} });

// ── A (G) : de bout en bout, depuis l'accueil, avec un faux agent ──
async function scenarioA(theme) {
  say(`\n— ${theme === 'dark' ? 'A' : 'G'} : de bout en bout (${theme}, faux agent)`);
  const { ctx, page } = await newPage(theme);
  page.tag = theme === 'dark' ? 'A' : 'G';
  const avant = await api('equipes');
  await ouvrir(page, true);
  ok(await page.$eval('html', (h, t) => (h.dataset.theme || 'dark') === t, theme), `thème ${theme} posé`);
  ok(await page.evaluate(() => !window.ideation.S.board), 'pas de planche avant le départ');
  ok(await page.$eval('.modal.pj .tb.go', (b) => b.disabled) && /dépose/.test(await page.$eval('.pj-why', (w) => w.textContent)), 'Commencer éteint dit pourquoi');
  ok(await visibleGo(page) === 1, 'la fenêtre : un seul orange visible');
  await page.shot(`${page.tag}-02-fenetre-vide`);
  await page.fill('.pj-txt', 'Clip « Les Rues » : une nuit en ville, trois personnages, néons.\nDurée 2 min.');
  await joindre(page, fxNames.map((n) => `${FX}/${n}`));
  await page.waitForFunction((n) => document.querySelectorAll('.pj-tile').length >= n, fxNames.length, { timeout: 5000 }).catch(() => {});
  const tiles = await page.$$eval('.pj-tile .pj-nm', (l) => l.map((t) => t.textContent));
  ok(tiles.length === fxNames.length, `${tiles.length} vignettes sur ${fxNames.length} (manque : ${fxNames.filter((n) => !tiles.includes(n)).join(', ') || 'rien'})`);
  ok(tiles.includes('repérage_rue.mp4') && tiles.includes('décor_nuit.jpg'), 'les noms accentués sont là');
  await joindre(page, [`${FX}/moodboard_01.png`]);
  await page.waitForTimeout(300);
  ok(await tileCount(page) === fxNames.length, 'un double : ignoré');
  // glissés sur la fenêtre : le brief en texte, et un nom décomposé (NFD, un disque HFS+)
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['Le brief détaillé : tourner de nuit, caméra à l’épaule.'], 'brief.txt', { type: 'text/plain' }));
    dt.items.add(new File([new Uint8Array([1, 2, 3])], 'mémo_équipe.txt'.normalize('NFD'), { type: 'text/plain' }));
    const scrim = document.querySelector('.pj-scrim');
    for (const t of ['dragenter', 'dragover', 'drop']) scrim.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction((n) => document.querySelectorAll('.pj-tile').length >= n, fxNames.length + 2, { timeout: 3000 }).catch(() => {});
  ok(await tileCount(page) === fxNames.length + 2, 'deux fichiers glissés sur la fenêtre : deux vignettes de plus');
  ok(await page.evaluate(() => window.ideation.projet.P.files.some((f) => f.name === 'mémo_équipe.txt'.normalize('NFC'))), 'un nom NFD : en NFC dans la vignette');
  await page.locator('.pj-tile', { hasText: 'brief.txt' }).locator('.pj-brief input').check();
  ok(await page.locator('.pj-tile.is-brief', { hasText: 'brief.txt' }).count() === 1, '« c’est le brief » coché');
  const persons = page.locator('.pj-person');
  ok(await persons.count() >= 2, `${await persons.count()} personnes proposées`);
  await persons.nth(0).click();
  await persons.nth(1).click();
  const chosen = await page.$$eval('.pj-person.on span', (l) => l.map((s) => s.textContent));
  ok(chosen.length === 2, `deux personnes choisies (${chosen.join(', ')})`);
  ok(!(await page.$eval('.modal.pj .tb.go', (b) => b.disabled)), 'Commencer allumé');
  await page.fill('.pj-names input >> nth=0', 'Les Rues');
  await page.fill('.pj-names input >> nth=1', 'Repérages');
  await page.shot(`${page.tag}-03-fenetre-pleine`);
  await page.evaluate(fauxAgent);
  await page.click('.modal.pj .tb.go');
  await page.waitForSelector('.pj-steps li');
  await page.waitForTimeout(250);
  await page.shot(`${page.tag}-04-en-cours`);
  const P = await attendreFin(page);
  etapes(P);
  ok(P.done, 'le départ est allé au bout');
  ok(P.files.every((f) => f.state === 'ok'), `les fichiers rangés (${P.files.filter((f) => f.state !== 'ok').map((f) => `${f.name} : ${f.error}`).join(' · ') || 'tous'})`);
  ok(P.files.every((f) => f.space === P.R.space), 'tous dans le Workspace neuf');
  const acc = P.files.find((f) => f.name === 'repérage_rue.mp4');
  ok(acc?.kind === 'video' && acc.title === 'repérage_rue', `le nom accentué rangé : ${acc?.kind} « ${acc?.title} »`);
  const nfd = P.files.find((f) => f.name.startsWith('mémo'));
  ok(nfd && nfd.title === 'mémo_équipe'.normalize('NFC'), `le nom NFD rangé en NFC (${JSON.stringify(nfd?.title)})`);
  const sonsVid = P.files.filter((f) => /^(note_vocale\.webm|voix_off\.mp4)$/.test(f.name));
  ok(sonsVid.every((f) => f.kind === 'audio'), `un .webm et un .mp4 sans image rangés en sons (${sonsVid.map((f) => `${f.name}:${f.kind}`).join(' ') || 'pas de ffmpeg'})`);
  const docs = P.files.filter((f) => /\.(pdf|docx|md|txt|bin)$/.test(f.name));
  ok(docs.every((f) => f.kind === 'document'), `les documents en sorte « document » (${docs.map((f) => `${f.name}:${f.kind}`).join(' ')})`);
  // l'agent : appelé après l'enregistrement de la planche, le brief en tête
  const calls = await page.evaluate(() => window.__agent);
  const send = calls.find((c) => c.text);
  ok(calls[0]?.open && send, `l'agent : open() puis send() (${calls.length} appels)`);
  if (send) {
    const briefId = P.files.find((f) => f.name === 'brief.txt')?.id;
    ok(send.o.intent === 'ingest' && Array.isArray(send.o.pieces) && send.o.pieces[0] === briefId, `l'agent : intent ingest, le brief en tête des pièces (${send.o.pieces.length})`);
    ok(new Set(send.o.pieces).size === send.o.pieces.length && send.o.pieces.length === P.files.length + 1, `les pièces : chaque fichier, et brief.md (${send.o.pieces.length} / ${P.files.length + 1})`);
    ok(send.o.brief?.length === 2 && send.o.brief.includes(briefId), `les pièces qui SONT le brief, nommées (brief.txt et brief.md : ${send.o.brief?.length})`);
    ok(/Les Rues/.test(send.text) && /tourner de nuit/.test(send.text), 'le texte : le brief tapé et celui du document');
    ok(!send.dirty && !send.saving && send.nodes > 0, `la planche enregistrée avant l'analyse (${send.nodes} objets)`);
  }
  await page.waitForTimeout(1500);
  ok(!(await page.$('.modal.pj')), 'la fenêtre se ferme seule quand tout est passé');
  // ce qui est né
  const neuve = (await api('equipes')).teams.find((t) => !avant.teams.some((x) => x.id === t.id));
  ok(neuve?.name === 'Les Rues' && neuve.owner === 'cal', `la Team « ${neuve?.name} », Cal propriétaire`);
  ok(neuve?.spaces.length === 1 && neuve.spaces[0].name === 'Repérages' && neuve.spaces[0].id === P.R.space, `son Workspace, renommé « ${neuve?.spaces?.[0]?.name} »`);
  const team = neuve ? await api(`equipes/${neuve.id}`) : {};
  const mem = (team.members || []).filter((m) => m.role === 'member').map((m) => m.name);
  ok(mem.length === 2 && chosen.every((c) => mem.includes(c)), `les personnes : membres (${mem.join(', ')})`);
  const me = await api('auth/me');
  ok(me.workspace?.id === P.R.space, `l'onglet (et le portail) dans le Workspace neuf (${me.workspace?.id})`);
  ok(await page.$eval('.hdr', (h) => /Les Rues/i.test(h.textContent) && /Repérages/i.test(h.textContent)), "l'en-tête dit « Les Rues / Repérages »");
  const board = await page.evaluate(() => { const b = window.ideation.S.board; return b && { id: b.id, name: b.name, mk: window.ideation.S.meta.media_kinds,
    nodes: b.nodes.map((n) => ({ t: n.type, name: n.name, kind: n.kind, x: n.x, y: n.y, w: n.w, h: n.h })) }; });
  ok(board?.id === P.R.board && board.name === 'Les Rues', `la planche « ${board?.name} »`);
  const frames = board.nodes.filter((n) => n.t === 'frame');
  ok(frames.map((f) => f.name).join(' ') === 'Brief Documents Images Vidéos Sons', `les cadres : ${frames.map((f) => f.name).join(' · ')}`);
  const inside = (n, f) => n.x >= f.x && n.y >= f.y && n.x + n.w <= f.x + f.w && n.y + n.h <= f.y + f.h;
  const loose = board.nodes.filter((n) => n.t !== 'frame' && n.t !== 'title' && !frames.some((f) => inside(n, f)));
  ok(!loose.length, `chaque objet dans un cadre (${loose.length} dehors)`);
  const fV = frames.find((f) => f.name === 'Vidéos');
  const dansV = board.nodes.filter((n) => n.t === 'media' && fV && inside(n, fV)).map((n) => n.kind);
  ok(fV && dansV.length && dansV.every((k) => k === 'video'), `le cadre « Vidéos » : des vidéos seulement (${dansV.join(', ')})`);
  ok(frames.every((a, i) => frames.every((b, j) => i === j || a.x + a.w <= b.x || b.x + b.w <= a.x)), 'les cadres côte à côte, sans chevauchement');
  // un objet media pour chaque sorte que la planche pose (media_kinds : les documents, le jour où elle les pose)
  const lib = await libOf(P.R.space);
  const medias = board.nodes.filter((n) => n.t === 'media').length;
  const attendus = lib.filter((i) => board.mk.includes(i.kind)).length;
  ok(medias === attendus, `posés en objets media : ${medias} (les sortes de la planche : ${board.mk.join(', ')} ; ${attendus} attendus)`);
  const sb = await api(`ideation/boards/${board.id}`, { headers: { 'X-SR-Espace': P.R.space } });
  ok((sb.nodes || []).length === board.nodes.length && sb.space === P.R.space, `la planche enregistrée au portail, dans le Workspace neuf (${(sb.nodes || []).length} objets)`);
  ok(lib.length === P.files.length + 1 && lib.some((i) => i.title === 'Brief'), `Asset : ${lib.length} objets dans le Workspace (les fichiers et brief.md)`);
  ok(lib.every((i) => (i.origin || {}).via === 'projet'), 'Asset : entrés par « projet »');
  // le panneau Asset, relu dans le Workspace neuf
  await page.keyboard.press('Control+Space');
  await page.waitForTimeout(1200);
  const dockIds = await page.$$eval('.sr-dock .lt[data-id]', (l) => l.map((x) => x.dataset.id)).catch(() => []);
  ok(dockIds.length > 0 && dockIds.every((id) => lib.some((i) => i.id === id)), `le panneau Asset montre le Workspace neuf (${dockIds.length} vignettes)`);
  await page.shot(`${page.tag}-05-planche-asset`);
  await page.keyboard.press('Control+Space');
  ok(await visibleGo(page) <= 1, 'la planche : au plus un orange');
  ok(!page.errs.length, `console : ${page.errs.join(' | ') || 'rien'}`);
  await ctx.close();
}

// ── B : clair, sans agent, un dossier entier, deux objets d'Asset (d'ici, d'ailleurs) ──
async function scenarioB() {
  say('\n— B : clair, sans agent, dossier, Asset d’ici et d’ailleurs');
  const ici = (await api('auth/me')).workspace?.id;
  const autre = await api('equipes', { method: 'POST', body: JSON.stringify({ name: `Archives ${Date.now() % 100000}` }) });
  const autreWs = autre.spaces[0].id;
  await api('espaces/courant', { method: 'POST', body: JSON.stringify({ workspace: ici }) });
  const dIci = await upload('logo_ici.png', readFileSync(`${FX}/moodboard_01.png`), ici);
  const dLoin = await upload('affiche_loin.jpg', readFileSync(`${FX}/décor_nuit.jpg`), autreWs);
  ok(dIci.id && dLoin.id && dLoin.space === autreWs, `deux objets : un ici (${ici}), un ailleurs (${autreWs})`);
  const avantIci = (await libOf(ici)).length;
  const D = `${OUT}/dossier/Repérages Paris`;
  rmSync(`${OUT}/dossier`, { recursive: true, force: true });
  mkdirSync(`${D}/nuit`, { recursive: true });
  copyFileSync(`${FX}/décor_nuit.jpg`, `${D}/nuit/décor_nuit.jpg`);
  copyFileSync(`${FX}/plan_large.mp4`, `${D}/plan_large.mp4`);
  writeFileSync(`${D}/.DS_Store`, 'x');
  writeFileSync(`${D}/notes.txt`, 'repères');
  const { ctx, page } = await newPage('light');
  page.tag = 'B';
  await ouvrir(page);
  await page.evaluate(sansAgent);
  ok(await page.$eval('html', (h) => h.dataset.theme === 'light'), 'thème clair posé');
  await page.setInputFiles('.pj-box input[webkitdirectory]', D);
  await page.waitForFunction(() => document.querySelectorAll('.pj-tile').length >= 3, null, { timeout: 4000 }).catch(() => {});
  const fd = await page.evaluate(() => window.ideation.projet.P.files.map((f) => [f.name, f.folder]));
  ok(fd.length === 3 && fd.every((f) => f[1] === 'Repérages Paris'), `le dossier : 3 fichiers (le .DS_Store laissé), dans « Repérages Paris » (${JSON.stringify(fd)})`);
  // le panneau Asset : un clic ajoute au projet ; l'objet d'ailleurs arrive tel quel (rapatrié au départ)
  await page.click('.pj-asset');
  await page.waitForSelector(`.sr-dock .lt[data-id="${dIci.id}"]`, { timeout: 8000 });
  await page.click(`.sr-dock .lt[data-id="${dIci.id}"]`);
  await page.click('#sr-dock-h-other');
  await page.click(`.sr-dock [data-w="${autreWs}"]`, { timeout: 8000 });
  await page.click(`.sr-dock .lt[data-id="${dLoin.id}"]`, { timeout: 8000 });
  await page.waitForTimeout(800);
  const fromAsset = await page.evaluate(() => window.ideation.projet.P.files.filter((f) => f.item).map((f) => f.item.id));
  ok(fromAsset.length === 2 && fromAsset.includes(dLoin.id), `deux objets d'Asset ajoutés, celui d'ailleurs en original (${fromAsset.join(', ')})`);
  ok((await libOf(ici)).length === avantIci, "rien n'est copié dans le Workspace d'avant");
  await page.shot('B-01-fenetre-clair');
  await page.keyboard.press('Control+Space');
  await page.click('.modal.pj .tb.go');
  const P = await attendreFin(page);
  etapes(P);
  ok(P.done && P.files.every((f) => f.state === 'ok'), `rangé (${P.files.filter((f) => f.state !== 'ok').map((f) => `${f.name} : ${f.error}`).join(' · ') || 'tout'})`);
  ok(!P.steps.some((s) => s.k === 'agent'), 'sans agent : aucune ligne, aucune erreur');
  const lib = await libOf(P.R.space);
  const from = lib.map((i) => (i.origin?.from || {}).item).filter(Boolean);
  ok(from.length === 2 && from.includes(dLoin.id) && from.includes(dIci.id), `les deux objets d'Asset rapatriés en copies dans le Workspace neuf (${from.length})`);
  ok(lib.filter((i) => i.folder === 'Repérages Paris').length === 3, 'le dossier rangé dans « Repérages Paris »');
  const team = (await api('equipes')).teams.find((t) => t.spaces.some((s) => s.id === P.R.space));
  ok(team?.name === 'notes' && team.spaces[0].name === 'Général', `sans nom tapé : celui du brief détecté (« ${team?.name} »), le Workspace « ${team?.spaces[0].name} »`);
  await page.waitForTimeout(1200);
  ok(!(await page.$('.modal.pj')), 'la fenêtre fermée');
  const cfg = await page.evaluate(async () => { const c = (await import('/commun/shell.js')).dockState().cfg; return { rap: c.rapatrie, label: c.placeLabel }; });
  ok(cfg.rap === undefined && !/projet/.test(cfg.label || ''), `le panneau Asset rendu à Idéation (${JSON.stringify(cfg)})`);
  await page.shot('B-02-planche-clair');
  ok(!page.errs.length, `console : ${page.errs.join(' | ') || 'rien'}`);
  await ctx.close();
}

// ── C : étroit, les deux thèmes ──
async function scenarioC() {
  say('\n— C : étroit, sombre et clair');
  for (const theme of ['dark', 'light']) {
    const { ctx, page } = await newPage(theme, { width: 390, height: 844 }, true);
    page.tag = 'C';
    await ouvrir(page);
    await page.fill('.pj-txt', 'Un court métrage, trois lieux.');
    await joindre(page, ['moodboard_01.png', 'repérage_rue.mp4', 'dossier.pdf', 'ambiance.wav'].map((n) => `${FX}/${n}`));
    await page.waitForTimeout(500);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 0, `${theme} étroit : pas de défilement horizontal (${over})`);
    const m = await page.$eval('.modal.pj', (x) => { const r = x.getBoundingClientRect(); return [r.left, r.right, innerWidth]; });
    ok(m[0] >= 0 && m[1] <= m[2], `${theme} étroit : la fenêtre tient dans la largeur`);
    ok(await page.$eval('.modal.pj .tb.go', (b) => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth; }), `${theme} étroit : « Commencer » visible`);
    await page.shot(`C-${theme}-etroit`);
    ok(!page.errs.length, `console : ${page.errs.join(' | ') || 'rien'}`);
    await ctx.close();
  }
}

// ── D : un compte qui ne crée pas de Team (la réponse du portail interceptée) ──
async function scenarioD() {
  say('\n— D : pas le droit de créer une Team');
  for (const theme of ['dark', 'light']) {
    const { ctx, page } = await newPage(theme);
    page.tag = 'D';
    const why = 'créer une Team : le Studio (ton compte ouvre les Apps) — demande-le à Cal';
    await page.route('**/api/equipes', async (r) => {
      if (r.request().method() !== 'GET') return r.continue();
      const resp = await r.fetch();
      await r.fulfill({ response: resp, json: { ...(await resp.json()), can_create: false, create_why: why } });
    });
    await ouvrir(page);
    ok(await page.$eval('.pj-refus', (x, w) => !x.hidden && x.textContent.includes(w), why), `${theme} : la phrase du refus, avant de remplir`);
    ok(await page.$eval('.pj-form', (x) => x.hidden), `${theme} : le formulaire caché`);
    ok(await page.$$eval('.pj-refus button', (l) => l.some((b) => /Demander le Studio/.test(b.textContent))), `${theme} : « Demander le Studio »`);
    ok(await page.$eval('.modal.pj .tb.go', (b) => b.disabled) && /pas avec ce compte/.test(await page.$eval('.pj-why', (w) => w.textContent)), `${theme} : Commencer éteint dit pourquoi`);
    await page.shot(`D-${theme}-refus`);
    ok(!page.errs.length, `console : ${page.errs.join(' | ') || 'rien'}`);
    await ctx.close();
  }
}

// ── E : 30 fichiers, un brief de 6 000 signes : les bornes de l'agent (server/tools/ideation_agent.py) ──
async function scenarioE() {
  say('\n— E : 30 fichiers, un brief de 6 000 signes');
  const { ctx, page } = await newPage('dark');
  page.tag = 'E';
  await ouvrir(page);
  await page.fill('.pj-txt', 'Le décor : une ville la nuit, des néons, la pluie. '.repeat(120).trim());
  const png = readFileSync(`${FX}/moodboard_01.png`);
  const files = Array.from({ length: 28 }, (_, i) => ({ name: `plan_${String(i + 1).padStart(2, '0')}.png`, mimeType: 'image/png', buffer: png }));
  files.push({ name: 'scenario.pdf', mimeType: 'application/pdf', buffer: readFileSync(`${FX}/dossier.pdf`) });
  files.push({ name: 'son.wav', mimeType: 'audio/wav', buffer: readFileSync(`${FX}/ambiance.wav`) });
  await page.setInputFiles('.pj-box input[type=file]:not([webkitdirectory])', files);
  await page.waitForFunction(() => document.querySelectorAll('.pj-tile').length >= 30, null, { timeout: 5000 }).catch(() => {});
  ok(await tileCount(page) === 30, `30 vignettes (${await tileCount(page)})`);
  await page.evaluate(fauxAgent);
  await page.click('.modal.pj .tb.go');
  const P = await attendreFin(page);
  etapes(P);
  ok(P.done && P.files.every((f) => f.state === 'ok'), 'tout rangé');
  ok(P.R.team && (await api('equipes')).teams.find((t) => t.id === P.R.team)?.name === 'Le décor : une ville la nuit, des néons', 'le nom : la première ligne du brief, coupée à la fin d’un mot');
  const send = (await page.evaluate(() => window.__agent)).find((c) => c.text);
  ok(send && send.text.length <= 4000 && /brief\.md/.test(send.text), `le texte coupé à 4 000 signes, la suite nommée (${send?.text.length})`);
  const md = (await libOf(P.R.space)).find((i) => i.title === 'Brief');
  const pdf = P.files.find((f) => f.name === 'scenario.pdf');
  ok(send && send.o.pieces.length === 31 && send.o.pieces[0] === md?.id && send.o.pieces[1] === pdf?.id, `toutes les pièces (sa réception les compte) : brief.md, le document, puis les images (${send?.o.pieces.length})`);
  ok(P.steps.some((s) => s.k === 'agent' && /31 pièces/.test(s.t)), 'la ligne de l’agent le dit (31 pièces)');
  await page.waitForTimeout(1200);
  await page.shot('E-planche');
  ok(!page.errs.length, `console : ${page.errs.join(' | ') || 'rien'}`);
  await ctx.close();
}

// ── F : Échap, le menu, un fichier refusé, une étape qui tombe (Reprendre), le brief d'un PDF ──
async function scenarioF() {
  say('\n— F : Échap, refus, Reprendre, brief PDF');
  const { ctx, page } = await newPage('dark');
  page.tag = 'F';
  await ouvrir(page);
  await joindre(page, [`${FX}/moodboard_01.png`]);
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  ok(await page.$('.modal.pj') && /tout s’oublie/.test(await page.textContent('.modal.pj .modal-head')), 'Échap : « Fermer ? tout s’oublie »');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  ok(!(await page.$('.modal.pj')) && !new URL(page.url()).searchParams.has('projet'), "Échap deux fois : fermée, l'adresse sans ?projet");
  ok(await page.evaluate(() => !!window.ideation.S.board), 'fermée sans commencer : une planche s’ouvre (le départ ordinaire)');
  await page.evaluate(() => window.ideation.app.projet());   // le menu « Commencer un projet… »
  await page.waitForSelector('.modal.pj');
  await page.evaluate(sansAgent);
  writeFileSync(`${OUT}/faux.mp4`, 'pas une vidéo');
  await joindre(page, [`${FX}/dossier.pdf`, `${OUT}/faux.mp4`, `${FX}/perso.webp`]);
  await page.waitForTimeout(300);
  ok(/détecté/.test(await page.locator('.pj-tile.is-brief', { hasText: 'dossier.pdf' }).textContent()), 'le PDF seul document, le champ vide : « brief · détecté »');
  let tombe = 1;
  await page.route('**/api/ideation/boards', async (r) => {
    if (r.request().method() === 'POST' && tombe-- > 0) return r.fulfill({ status: 500, json: { error: 'panne voulue' } });
    return r.continue();
  });
  const avant = (await api('equipes')).teams.length;
  await page.click('.modal.pj .tb.go');
  await page.waitForFunction(() => !window.ideation.projet.P.running && /Reprendre/.test(document.querySelector('.modal.pj .tb.go')?.textContent || ''), null, { timeout: 30000 });
  ok(/panne voulue/.test(await page.textContent('.modal.pj .pj-why')) && await page.locator('.pj-steps li.err', { hasText: 'La planche' }).count() === 1, 'une étape qui tombe : dite, « Reprendre »');
  await page.shot('F-01-reprendre');
  await page.click('.modal.pj .tb.go');
  await page.waitForFunction(() => window.ideation.projet?.P.done, null, { timeout: 60000 });
  const P = await attendreFin(page);
  etapes(P);
  ok((await api('equipes')).teams.length === avant + 1, 'Reprendre : une seule Team');
  const faux = P.files.find((f) => f.name === 'faux.mp4');
  ok(faux?.state === 'echec' && /MP4/.test(faux.error), `un fichier refusé : en échec, la phrase du portail (« ${faux?.error} »)`);
  ok(P.files.filter((f) => f.state === 'ok').length === 2, 'les autres rangés');
  await page.waitForTimeout(1200);
  ok(!!(await page.$('.modal.pj')) && await page.locator('.pj-tile[data-state="echec"] .pj-err').first().isVisible(), 'un échec garde la fenêtre ouverte, la raison sur la vignette');
  ok(await visibleGo(page) === 1 && /Voir la planche/.test(await page.textContent('.modal.pj .modal-foot')), '« Voir la planche », le seul orange');
  await page.shot('F-02-echec');
  const note = await page.evaluate(() => window.ideation.S.board.nodes.find((n) => n.type === 'note')?.text || '');
  ok(/Montparnasse/.test(note), `le brief du PDF : son texte, lu par le portail (poppler), dans la note (« ${note.slice(0, 40)}… »)`);
  await page.click('.modal.pj .modal-foot .tb.go');
  await page.waitForTimeout(400);
  ok(!(await page.$('.modal.pj')), '« Voir la planche » ferme la fenêtre');
  // les 500 et 415 sont ceux de l'essai ; le flux de co-édition de la planche quittée s'arrête
  const errs = page.errs.filter((e) => !/status of (500|415)|collab\/.*\/stream.*ERR_ABORTED/.test(e));
  ok(!errs.length, `console : ${errs.join(' | ') || 'rien'}`);
  await ctx.close();
}

// ── H : le vrai agent (un faux Ollama derrière) — la réception, les questions, le plan, une étape ──
async function scenarioH() {
  say('\n— H : le vrai agent, un brief sans rapport, des documents hétéroclites');
  const essai = await api('ideation/boards', { method: 'POST', body: JSON.stringify({ name: 'essai moteur' }) });
  const eng = (await api(`ideation/agent/${essai.id}`)).engine || {};
  if (!eng.ready) {
    ok(!want.includes('H'), `H sauté : l'agent n'est pas prêt sur ce portail (${eng.why || 'pas de réponse'}) — le lancer avec SR_OLLAMA_URL=…faux_ollama`);
    return;
  }
  for (const theme of ['dark', 'light']) {
    const { ctx, page } = await newPage(theme, { width: 1600, height: 940 });
    page.tag = `H-${theme}`;
    await ouvrir(page);
    await page.fill('.pj-txt', 'Une publicité de 30 secondes pour une marque de café en grains, ton chaleureux.');
    const names = ['dossier.pdf', 'note.docx', 'notes.md', 'moodboard_01.png', 'perso.webp', 'ambiance.wav', 'repérage_rue.mp4', 'note_vocale.webm', 'voix_off.mp4']
      .filter((n) => fxNames.includes(n));
    await joindre(page, names.map((n) => `${FX}/${n}`));
    await page.waitForFunction((n) => document.querySelectorAll('.pj-tile').length >= n, names.length, { timeout: 5000 }).catch(() => {});
    await page.click('.modal.pj .tb.go');
    await page.waitForSelector('.ag-recu', { timeout: 60000 });
    const recu = await page.textContent('.ag-recu p');
    ok(new RegExp(`J'ai bien reçu ${names.length + 1} pièces`).test(recu) && /rien ne se pose sur la planche/.test(recu), `${theme} : la réception, comptée par le portail (« ${recu.slice(0, 90)}… »)`);
    await page.waitForSelector('.ag-qcard .ag-opt', { timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('.modal.pj'), null, { timeout: 15000 }).catch(() => {});
    const nodes0 = await page.evaluate(() => window.ideation.S.board.nodes.length);
    const notes = await page.evaluate(() => window.ideation.S.board.nodes.filter((n) => ['note', 'sticky'].includes(n.type)).length);
    ok(notes <= 1, `${theme} : aucune note ni post-it de l'agent avant les réponses (${notes} : la note du brief)`);
    ok(await page.locator('.ag-qcard .ag-q').count() >= 3 && /lequel est le projet/i.test(await page.textContent('.ag-contra')),
      `${theme} : le brief sans rapport est dit à voix haute ; des questions à choix`);
    ok(await page.isDisabled('.ag-qcard button:text-is("Répondre")'), `${theme} : « Répondre » éteint tant que rien n'est choisi (il dit pourquoi)`);
    await page.evaluate(() => { document.querySelector('.ag-fil').scrollTop = 0; });
    await page.shot(`${page.tag}-1-reception`);
    await page.locator('.ag-qcard .ag-q').first().locator('.ag-opt').first().click();
    await page.evaluate(() => { const f = document.querySelector('.ag-fil'); f.scrollTop = f.scrollHeight; });
    await page.shot(`${page.tag}-2-questions`);
    await page.click('.ag-qcard button:text-is("Répondre")');
    await page.waitForSelector('.ag-plancard button:has-text("Accepter")', { timeout: 60000 });
    ok(await page.evaluate(() => window.ideation.S.board.nodes.length) === nodes0, `${theme} : la réponse → un plan, toujours rien de posé`);
    await page.shot(`${page.tag}-3-plan`);
    await page.click('.ag-plancard button:has-text("Accepter")');
    await page.waitForSelector('.ag-turn:last-child .ag-acts', { timeout: 60000 });
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => window.ideation.S.board.nodes.length) === nodes0 + 1, `${theme} : l'étape 1 pose un geste`);
    await page.shot(`${page.tag}-4-etape`);
    await page.click('.ag-turn:last-child >> text=Annuler ce tour');
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => window.ideation.S.board.nodes.length) === nodes0, `${theme} : « Annuler ce tour » la défait`);
    await page.waitForFunction(() => document.querySelectorAll('.ag-pal.done, .ag-pal.off').length >= 2, null, { timeout: 60000 }).catch(() => {});
    const pal = await page.$$eval('.ag-pal', (l) => l.map((x) => x.className + ' ' + x.textContent.slice(0, 60)));
    ok(pal.length >= 2, `${theme} : les paliers (images, sons) annoncés dans le fil (${pal.join(' | ')})`);
    await page.click('.ag-ch');
    await page.shot(`${page.tag}-5-carnet`);
    ok(await visibleGo(page) <= 1, `${theme} : au plus un orange`);
    ok(!page.errs.length, `console : ${page.errs.join(' | ') || 'rien'}`);
    await ctx.close();
  }
}

const all = { A: () => scenarioA('dark'), G: () => scenarioA('light'), B: scenarioB, C: scenarioC, D: scenarioD, E: scenarioE, F: scenarioF, H: scenarioH };
for (const [k, f] of Object.entries(all)) {
  if (want.length && !want.includes(k)) continue;
  try { await f(); } catch (e) { ok(false, `scénario ${k} : ${e.message.split('\n')[0]}`); }
}
await browser.close();
writeFileSync(`${OUT}/pilote.log`, log.join('\n') + '\n');
console.log(fails ? `${fails} échec(s)` : 'tout passe');
process.exit(fails ? 1 : 0);
