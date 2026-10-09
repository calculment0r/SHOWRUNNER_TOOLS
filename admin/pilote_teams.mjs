// Le pilote des Teams v2 (décisions de Cal du 09/10 : My Team, détruire, le grand ménage ; core/espaces.py,
// server/tools/equipes.py, admin/admin.js, le menu de l'en-tête de commun/shell.js), sur un portail d'ESSAI à la
// porte allumée — jamais le portail en ligne : il crée des comptes, détruit des Teams, fait le ménage.
//
//   SR_PORTE=1 python3 tools/portail_essai.py 8821 /tmp/sr_teams/data &   # une fois, puis l'arrêter par son PID
//   python3 tools/migrer_espaces.py --donnees /tmp/sr_teams/data          # Nirvalab et Général, comme à la maison
//   SR_PORTE=1 python3 tools/portail_essai.py 8821 /tmp/sr_teams/data &
//   LC_ALL=C.UTF-8 node admin/pilote_teams.mjs http://127.0.0.1:8821 /tmp/sr_pilote_teams /tmp/sr_teams/data
//
// Le décor (par l'API, chacun entré par son pseudo) : Cal ; Noé (Studio) qui met Abi (Apps) dans sa My Team ; Kim
// (Studio), sa Team personnelle encore « Chez moi » (comme avant le 09/10 : teams.json écrit à la main) ; la Team
// « Atelier » de Cal et ses comptes créés par une Team (trois étudiants, un guest) ; la Team « Plateau » de Cal (Noé,
// Kim, un étudiant ; Workspaces Tournage et Rushes, une image dans chacun).
//   A  (sombre, B en clair) Cal, Admin → Teams : la carte du ménage, cochée d'avance (les comptes de l'atelier, et
//      Lou, que Noé a invité et qui attend Cal ; l'Atelier, pas le Plateau mixte ; Nirvalab grisée, qui dit
//      pourquoi) ; un seul orange ; les cartes, Détruire.
//   C  Cal détruit « Rushes » : la fenêtre, le bouton grisé tant que le nom n'est pas tapé ; puis Stockage : le
//      Workspace détruit, « Rendre » (dans la My Team de son auteur, Cal).
//   D  (sombre et clair) Abi (Apps) : le menu de l'en-tête (sa My Team, celle de Noé où il est membre) ; Admin →
//      Teams : sa My Team n'invite pas, la phrase dit pourquoi et « Demander le Studio ».
//   E  Noé (Studio) : sa My Team invite (le formulaire), se renomme, ne se détruit pas (grisé, la raison).
//   F  Cal applique le ménage par la page (MENAGE tapé) : le rapport ; ce qu'il reste, lu par l'API.
// Rend 0 si tout passe ; le détail dans <out>/pilote.log, les captures dans <out>.
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';

const require = createRequire(import.meta.url);
let chromium;
for (const p of [process.env.SR_PLAYWRIGHT, '/opt/node22/lib/node_modules/playwright', '/home/dgx/Character_Sheet/node_modules/playwright'].filter(Boolean)) {
  try { ({ chromium } = require(p)); break; } catch { /* le suivant */ }
}
const [BASE = 'http://127.0.0.1:8821', OUT = '/tmp/sr_pilote_teams', DATA = '/tmp/sr_teams/data'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };
const say = (s) => { log.push(s); console.log(s); };

const browser = await chromium.launch({ executablePath: process.env.SR_CHROMIUM || undefined, env: { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' } });
// une personne : son contexte (sa session), son API, ses pages
async function person(pseudo, theme = 'dark') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
  }, theme);
  const r = await ctx.request.post(`${BASE}/api/auth/enter`, { data: { name: pseudo }, headers: { Origin: BASE } });
  const who = await r.json().catch(() => ({}));
  const api = async (path, { method = 'GET', body, headers = {}, raw } = {}) => {
    const res = await ctx.request.fetch(`${BASE}/api/${path}`, { method, headers: { Origin: BASE, ...headers },
      ...(raw ? { data: raw } : body !== undefined ? { data: body } : {}) });
    const txt = await res.text();
    let d; try { d = JSON.parse(txt); } catch { d = txt; }
    return { s: res.status(), d };
  };
  const page = async () => {
    const p = await ctx.newPage();
    p.errs = [];
    p.on('console', (m) => {
      if (m.type() !== 'error' && m.type() !== 'warning') return;
      if (/fonts\.googleapis|ERR_CERT_AUTHORITY_INVALID/.test(m.text() + (m.location()?.url || ''))) return;   // le réseau du conteneur
      // qui n'est pas Cal : la page d'Admin l'apprend de ces deux 403, voulus (admin/admin.js, `limited` ; le kit de Cal)
      if (pseudo !== 'nico007' && /403/.test(m.text()) && /\/api\/(admin\/state|strategie\/moi)$/.test(m.location()?.url || '')) return;
      p.errs.push(`${m.type()}: ${m.text()} ${m.location()?.url || ''}`);
    });
    p.on('pageerror', (e) => p.errs.push(`PAGEERROR ${e.message}`));
    p.shot = async (n) => { await p.waitForTimeout(350); await p.screenshot({ path: `${OUT}/${n}.png` }); };
    return p;
  };
  return { ctx, api, page, who, theme };
}
const visibleGo = (p) => p.$$eval('.tb.go', (l) => l.filter((x) => (x.offsetWidth || x.offsetHeight) && !x.closest('.scrim')).length);
const clean = (p, what) => ok(!p.errs.length, `${what} : aucune erreur dans la console${p.errs.length ? ` — ${p.errs.slice(0, 3).join(' | ')}` : ''}`);

// ── le décor ────────────────────────────────────────────────
const png = execFileSync('python3', ['-c', `
import io, sys
from PIL import Image
b = io.BytesIO(); Image.new("RGB", (96, 64), (70, 120, 180)).save(b, "PNG"); sys.stdout.buffer.write(b.getvalue())`]);
const cal = await person('nico007');
ok(cal.who.user?.id === 'cal', `Cal entre (${cal.who.state})`);
for (const [name, access] of [['Noe Studio', 'studio'], ['Abi Apps', 'apps'], ['Kim Ami', 'studio']]) await cal.api('admin/users', { method: 'POST', body: { name, access } });
const atelier = (await cal.api('equipes', { method: 'POST', body: { name: 'Atelier' } })).d;
for (const pseudo of ['Etu Un', 'Etu Deux', 'Etu Trois']) await cal.api(`equipes/${atelier.id}/membres`, { method: 'POST', body: { pseudo, role: 'member' } });
const g = await cal.api(`equipes/${atelier.id}/membres`, { method: 'POST', body: { pseudo: 'Gus Guest', role: 'guest', guest: 'viewer', spaces: [atelier.spaces[0].id] } });
ok(g.s === 200, `un guest dans l'Atelier (${g.s} ${g.d.error || ''})`);
const plateau = (await cal.api('equipes', { method: 'POST', body: { name: 'Plateau' } })).d;
const tournage = (await cal.api(`equipes/${plateau.id}/espaces`, { method: 'POST', body: { name: 'Tournage' } })).d;
const rushes = (await cal.api(`equipes/${plateau.id}/espaces`, { method: 'POST', body: { name: 'Rushes' } })).d;
for (const pseudo of ['Noe Studio', 'Kim Ami', 'Etu Un']) await cal.api(`equipes/${plateau.id}/membres`, { method: 'POST', body: { pseudo, role: 'member' } });
const up = (who, sp, name) => who.api(`library/upload?name=${name}.png&title=${name}`, { method: 'PUT', raw: png, headers: { 'X-SR-Espace': sp, 'Content-Type': 'application/octet-stream' } });
const img1 = await up(cal, rushes.id, 'rush');
await up(cal, tournage.id, 'decor');
await up(cal, atelier.spaces[0].id, 'atelier');
ok(img1.s === 200 && img1.d.space === rushes.id, `une image dans Rushes (${img1.s})`);
const noe = await person('Noe Studio');
const abi = await person('Abi Apps');
const kim = await person('Kim Ami');
for (const p of [noe, abi, kim]) await p.api('auth/me');   // la première requête : sa My Team naît
const r1 = await noe.api('equipes/tea-perso-noe-studio/membres', { method: 'POST', body: { pseudo: 'Abi Apps', role: 'member' } });
ok(r1.s === 200, `Noé (Studio) met Abi dans sa My Team (D2) (${r1.s} ${r1.d.error || ''})`);
await noe.api('equipes/tea-perso-noe-studio/espaces', { method: 'POST', body: { name: 'Montage' } });
// un pseudo neuf que Noé (pas Cal) met dans sa My Team : il attend la validation de Cal (D5) — un compte du ménage aussi
const r2 = await noe.api('equipes/tea-perso-noe-studio/membres', { method: 'POST', body: { pseudo: 'Lou Attente', role: 'member' } });
ok(r2.s === 200 && r2.d.added?.pending, `Noé invite Lou : il attend Cal (${r2.s} ${r2.d.error || ''})`);
// Kim, comme avant le 09/10 : sa Team personnelle s'appelle encore « Chez moi »
const tj = JSON.parse(readFileSync(`${DATA}/teams.json`, 'utf8'));
tj.teams['tea-perso-kim-ami'].name = 'Chez moi';
writeFileSync(`${DATA}/teams.json`, JSON.stringify(tj, null, 1));
await new Promise((r) => setTimeout(r, 50));
ok((await kim.api('equipes')).d.teams?.some((t) => t.id === 'tea-perso-kim-ami' && t.name === 'Chez moi'), 'la Team de Kim, « Chez moi » (d’avant)');

// ── A, B : Admin → Teams, la carte du ménage ────────────────
for (const theme of ['dark', 'light']) {
  const tag = theme === 'dark' ? 'A' : 'B';
  say(`\n— ${tag} : Cal, Admin → Teams (${theme})`);
  const c = await person('nico007', theme);
  const p = await c.page();
  await p.goto(`${BASE}/admin/#teams`, { waitUntil: 'networkidle' });
  await p.waitForSelector('.card.menage');
  ok(await p.$eval('html', (h, t) => (h.dataset.theme || 'dark') === t, theme), `thème ${theme} posé`);
  await p.click('.card.menage .card-head button[aria-expanded]');
  await p.waitForSelector('.card.menage [data-compte]');
  const st = await p.evaluate(() => ({
    comptes: [...document.querySelectorAll('.card.menage [data-compte]')].map((x) => [x.dataset.compte, x.querySelector('input').checked]),
    pending: [...document.querySelectorAll('.card.menage [data-compte]')].filter((x) => /attend cal/i.test(x.textContent)).map((x) => x.dataset.compte),
    teams: [...document.querySelectorAll('.card.menage [data-menage-team]')].map((x) => [x.querySelector('.nm-s').textContent, x.querySelector('input').checked, x.querySelector('input').disabled, x.title]),
    go: document.querySelector('[data-menage-go]')?.textContent, goOff: document.querySelector('[data-menage-go]')?.disabled,
    note: document.querySelector('.card.menage .adm-note:last-of-type')?.textContent }));
  say(`       ${JSON.stringify(st)}`);
  ok(st.comptes.length === 5 && st.comptes.every(([, on]) => on) && st.pending.join() === 'lou-attente',
     `${tag} : les cinq comptes créés par une Team, cochés d'avance — Lou, qui attend Cal, compris`);
  const t = Object.fromEntries(st.teams.map(([n, on, off, why]) => [n, { on, off, why }]));
  ok(t.Atelier?.on && t.Plateau && !t.Plateau.on && t.Nirvalab?.off && /instance/.test(t.Nirvalab.why),
     `${tag} : l'Atelier coché, le Plateau (mixte) non, Nirvalab grisée qui dit pourquoi`);
  ok(st.go === 'Appliquer le ménage' && !st.goOff, `${tag} : le bouton dit ce qu'il fait`);
  ok(await visibleGo(p) === 1, `${tag} : un seul orange`);
  await p.locator('.card.menage').screenshot({ path: `${OUT}/${tag}-menage.png` });
  await p.shot(`${tag}-teams`);
  // les cartes : Détruire sur le Plateau (Cal), grisé sur sa My Team, qui dit pourquoi
  const dt = await p.evaluate((ids) => ids.map((id) => { const b = document.querySelector(`[data-destroy-team="${id}"]`); return b && [b.disabled, b.title]; }),
    [plateau.id, 'tea-perso-cal']);
  ok(dt[0] && !dt[0][0] && dt[1] && dt[1][0] && /maison/.test(dt[1][1]), `${tag} : Détruire une Team ; My Team grisée, la raison (${dt[1]?.[1]})`);
  await p.locator(`[data-team="${plateau.id}"]`).screenshot({ path: `${OUT}/${tag}-plateau.png` });
  clean(p, tag);
  await c.ctx.close();
}

// ── C : détruire un Workspace, puis le rendre ────────────────
{
  say('\n— C : Cal détruit « Rushes », puis le rend (Stockage)');
  const c = await person('nico007');
  const p = await c.page();
  await p.goto(`${BASE}/admin/#teams`, { waitUntil: 'networkidle' });
  await p.click(`[data-destroy-ws="${rushes.id}"]`);
  await p.waitForSelector('.modal input.confirm-typed');
  const off = await p.$eval('.modal .tb.go', (b) => [b.disabled, b.title]);
  ok(off[0] && /Rushes/.test(off[1]), `C : le bouton grisé tant que le nom n'est pas tapé (${off[1]})`);
  await p.fill('.modal input.confirm-typed', 'rushes');
  ok(await p.$eval('.modal .tb.go', (b) => b.disabled), 'C : un nom approché ne suffit pas');
  await p.fill('.modal input.confirm-typed', 'Rushes');
  ok(!(await p.$eval('.modal .tb.go', (b) => b.disabled)), 'C : le nom exact : il part');
  await p.shot('C-detruire');
  await p.click('.modal .tb.go');
  await p.waitForFunction((id) => !document.querySelector(`[data-ws="${id}"]`), rushes.id, { timeout: 8000 });
  const after = (await c.api(`equipes/${plateau.id}`)).d;
  ok(!after.spaces.some((s) => s.id === rushes.id), 'C : « Rushes » n’est plus dans le Plateau');
  const lib = await c.api(`library/${img1.d.id}`);
  ok(lib.s === 404 || lib.s === 403, `C : son image n'est plus à personne, Cal compris (${lib.s})`);
  await p.goto(`${BASE}/admin/#stockage`, { waitUntil: 'networkidle' });
  await p.waitForSelector(`[data-detruit="${rushes.id}"]`);
  const row = await p.$eval(`[data-detruit="${rushes.id}"]`, (x) => x.textContent);
  ok(/Rushes/.test(row) && /1 objet/.test(row) && /Plateau/.test(row), `C : Stockage le liste, ce qu'il tient (${row.slice(0, 120)})`);
  ok(await visibleGo(p) === 1, 'C : Stockage, un seul orange (Vider la corbeille)');
  await p.shot('C-stockage');
  await p.click(`[data-rendre="${rushes.id}"]`);
  await p.waitForFunction((id) => !document.querySelector(`[data-detruit="${id}"]`), rushes.id, { timeout: 8000 });
  const back = (await c.api('equipes/tea-perso-cal')).d;
  ok(back.spaces?.some((s) => s.id === rushes.id), 'C : rendu, le même, dans la My Team de son auteur (Cal)');
  const lib2 = await c.api(`library/${img1.d.id}`, { headers: { 'X-SR-Espace': rushes.id } });
  ok(lib2.s === 200 && lib2.d.space === rushes.id, `C : son image revient telle quelle (${lib2.s})`);
  clean(p, 'C');
  await c.ctx.close();
}

// ── D : Abi (Apps), le menu de l'en-tête et sa My Team ───────
for (const theme of ['dark', 'light']) {
  say(`\n— D : Abi (Apps), ${theme}`);
  const a = await person('Abi Apps', theme);
  const p = await a.page();
  await p.goto(`${BASE}/asset/`, { waitUntil: 'networkidle' });
  await p.click('#sr-ws .sr-ws-btn');
  await p.waitForSelector('.sr-ws-menu .sr-ws-team');
  const teams = await p.$$eval('.sr-ws-menu .sr-ws-team', (l) => l.map((x) => x.textContent));
  say(`       ${JSON.stringify(teams)}`);
  ok(teams[0] === 'My Team' && /^My Team · Noe Studio/.test(teams[1] || '') && /membre/.test(teams[1] || ''),
     `D : le menu dit sa My Team d'abord, puis celle de Noé où il est membre (${teams.join(' | ')})`);
  const ws = await p.$$eval('.sr-ws-menu .sr-ws-item:not(.sr-ws-new) .n', (l) => l.map((x) => x.textContent));
  ok(ws.includes('Montage') && ws.filter((x) => x === 'Général').length === 2, `D : tous les Workspaces de la My Team de Noé (${ws.join(', ')})`);
  await p.shot(`D-${theme}-menu`);
  await p.keyboard.press('Escape');
  await p.goto(`${BASE}/admin/#teams`, { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-team="tea-perso-abi-apps"]');
  const why = await p.$eval('[data-team="tea-perso-abi-apps"]', (x) => [[...x.querySelectorAll('.why')].map((w) => w.textContent).find((w) => /^inviter/.test(w)) || '',
    [...x.querySelectorAll('button')].map((b) => b.textContent)]);
  ok(/Apps/.test(why[0]) && /Studio/.test(why[0]) && why[1].includes('Demander le Studio'), `D : sa My Team n'invite pas ; la phrase, et ce qui débloque (${why[0].slice(0, 90)})`);
  ok(!(await p.$('.card.menage')), 'D : pas de ménage pour un autre que Cal');
  await p.shot(`D-${theme}-teams`);
  clean(p, `D ${theme}`);
  await a.ctx.close();
}

// ── E : Noé (Studio), sa My Team invite ─────────────────────
{
  say('\n— E : Noé (Studio), clair');
  const n = await person('Noe Studio', 'light');
  const p = await n.page();
  await p.goto(`${BASE}/admin/#teams`, { waitUntil: 'networkidle' });
  const card = '[data-team="tea-perso-noe-studio"]';
  await p.waitForSelector(card);
  const st = await p.$eval(card, (x) => ({ add: !!x.querySelector('input[placeholder="pseudo"]'), members: [...x.querySelectorAll('[data-member]')].map((m) => m.dataset.member),
    ren: [...x.querySelectorAll('button')].find((b) => b.textContent === 'Renommer')?.disabled,
    des: (() => { const b = x.querySelector('[data-destroy-team]'); return b && [b.disabled, b.title]; })() }));
  ok(st.add && st.members.includes('abi-apps') && st.ren === false && st.des?.[0] && /maison/.test(st.des[1]),
     `E : My Team en Studio — le formulaire d'invitation, Abi membre, Renommer, Détruire grisé (${JSON.stringify(st)})`);
  await p.locator(card).screenshot({ path: `${OUT}/E-light-myteam.png` });
  clean(p, 'E');
  await n.ctx.close();
}

// ── F : le ménage, appliqué par la page ──────────────────────
{
  say('\n— F : Cal applique le ménage');
  const c = await person('nico007');
  const p = await c.page();
  await p.goto(`${BASE}/admin/#teams`, { waitUntil: 'networkidle' });
  await p.click('.card.menage .card-head button[aria-expanded]');
  await p.waitForSelector('[data-menage-go]:not([disabled])');
  await p.click('[data-menage-go]');
  await p.waitForSelector('.modal input.confirm-typed');
  ok(await p.$eval('.modal .tb.go', (b) => b.disabled), 'F : MENAGE à taper d’abord');
  const txt = await p.$eval('.modal .modal-body p', (x) => x.textContent);
  ok(/supprimer 5 comptes/.test(txt) && /détruire 1 Team/.test(txt) && /retirer/.test(txt) && /renommer 1 Team personnelle/.test(txt),
     `F : la fenêtre dit ce qu'il va faire (${txt.slice(0, 160)})`);
  await p.fill('.modal input.confirm-typed', 'MENAGE');
  await p.shot('F-confirme');
  await p.click('.modal .tb.go');
  await p.waitForSelector('.card.menage [role="status"]', { timeout: 20000 });
  await p.waitForTimeout(800);
  // la carte se relit après le ménage (loadMenage) : la capture reprend le nœud neuf s'il a été remplacé
  for (let i = 0; i < 5; i++) {
    try { await p.locator('.card.menage').screenshot({ path: `${OUT}/F-rapport.png` }); break; } catch { await p.waitForTimeout(400); }
  }
  const users = (await c.api('admin/state')).d.users.map((u) => u.id);
  ok(!['etu-un', 'etu-deux', 'etu-trois', 'gus-guest', 'lou-attente'].some((x) => users.includes(x)) && ['cal', 'noe-studio', 'abi-apps', 'kim-ami'].every((x) => users.includes(x)),
     'F : les comptes de l’atelier supprimés, Lou refusé, les autres là');
  const all = (await c.api('equipes?toutes=1')).d.teams;
  const by = Object.fromEntries(all.map((t) => [t.id, t]));
  ok(!by[atelier.id], 'F : l’Atelier détruit');
  ok(by[plateau.id] && by[plateau.id].members.map((m) => m.id).join() === 'cal', `F : le Plateau ne garde que son propriétaire (${by[plateau.id]?.members.map((m) => m.id)})`);
  ok(by['tea-perso-noe-studio']?.members.length === 1, 'F : la My Team de Noé ne garde que Noé');
  ok(by['tea-perso-kim-ami']?.name === 'My Team', 'F : « Chez moi » devenue My Team');
  const kimMe = (await kim.api('auth/me')).d;
  ok(kimMe.teams.length === 1 && kimMe.teams[0].id === 'tea-perso-kim-ami', `F : Kim n'a plus que sa My Team (${kimMe.teams.map((t) => t.name)})`);
  await p.shot('F-apres');
  clean(p, 'F');
  await c.ctx.close();
}

await browser.close();
say(`\n${fails ? `${fails} ÉCHEC(S)` : 'tout passe'}`);
writeFileSync(`${OUT}/pilote.log`, log.join('\n') + '\n');
process.exit(fails ? 1 : 0);
