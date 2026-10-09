// Le pilote de la validation des invités et des alertes de Cal (D5, D6 du 09/10 ; core/alertes.py,
// docs/etudes/equipes_espaces.md, « Fait le 09/10 »), de bout en bout, sombre puis clair, sur un portail
// d'ESSAI à la porte allumée et un faux Telegram — jamais le portail en ligne : il crée des comptes.
//
//   python3 tools/faux_telegram.py --port 8832 --attente 2 &
//   SR_PORTE=1 SR_TELEGRAM_URL=http://127.0.0.1:8832 python3 tools/portail_essai.py 8831 /tmp/sr_essai_invites &
//   node admin/pilote_invites.mjs http://127.0.0.1:8831 http://127.0.0.1:8832 /tmp/sr_pilote_invites
//
// Il faut un portail NEUF (il compte depuis zéro) et le faux Telegram à son jeton d'essai.
//   1  (sombre) Cal, Admin → Demandes, la carte Alertes : « à brancher », les actions désactivées disent
//      pourquoi ; le jeton collé ; « Trouver mon chat » : le code, envoyé au bot (le faux) ; « branchées » ;
//      « Envoyer un essai » : le message arrive. Le jeton n'est nulle part dans la page.
//   2  Ada (admin d'une Team, pas Cal) met un pseudo neuf : le toast « attend la validation de Cal », la
//      pastille « attend Cal » sur sa ligne ; une liste collée : deux neufs qui attendent, un compte qui
//      existe (il entre ; Cal est informé).
//   3  L'invité tape son pseudo : la porte « invitation · en attente de Cal », qui l'a invité.
//   4  Cal, Admin → Demandes : « invité par Ada dans la Team … (membre) », un seul orange ; Telegram a reçu
//      « invité à valider » (Valider · Refuser), le lot « Valider (2) », l'info du compte existant.
//   5  Cal accepte dans Admin : la page de l'invité s'ouvre seule ; le message Telegram dit « validé par Cal ».
//      Puis « Refuser (2) » depuis Telegram (le faux) : les deux disparaissent des demandes et de la Team.
// Rend 0 si tout passe ; le détail dans <out>/pilote.log, les captures dans <out>.
import { createRequire } from 'module';
import { mkdirSync, writeFileSync } from 'fs';

const require = createRequire(import.meta.url);
let chromium;
for (const p of [process.env.SR_PLAYWRIGHT, '/opt/node22/lib/node_modules/playwright', '/home/dgx/Character_Sheet/node_modules/playwright'].filter(Boolean)) {
  try { ({ chromium } = require(p)); break; } catch { /* le suivant */ }
}
const [BASE = 'http://127.0.0.1:8831', TG = 'http://127.0.0.1:8832', OUT = '/tmp/sr_pilote_invites'] = process.argv.slice(2);
const JETON = '123456:faux-jeton-pour-les-essais-0000';   // celui de tools/faux_telegram.py
mkdirSync(OUT, { recursive: true });
const log = [];
let fails = 0;
const ok = (c, msg) => { log.push(`${c ? 'ok    ' : 'ÉCHEC '} ${msg}`); if (!c) fails++; console.log(log.at(-1)); };
const say = (s) => { log.push(s); console.log(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function attendre(cond, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await cond()) return true; } catch { /* encore */ } await sleep(250); }
  try { return !!(await cond()); } catch { return false; }
}

// le faux Telegram : ce qu'il a reçu, Cal qui écrit, Cal qui clique
const faux = async (path = '', body) => (await fetch(`${TG}/_faux${path}`, body ? { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {})).json();
const msgDe = async (...mots) => (await faux()).messages.filter((m) => mots.every((w) => m.text.includes(w))).at(-1);
const boutons = (m) => ((m && m.reply_markup && m.reply_markup.inline_keyboard) || []).flat().map((b) => b.text);

const browser = await chromium.launch({ env: { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' } });
// un navigateur par personne, au thème voulu ; `pseudo` : entré d'avance par la porte (le cookie de session)
async function personne(theme, pseudo) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('sr.prefs.v1', JSON.stringify({ data: { general: { theme: t } }, dirty: { general: { theme: t } } })); } catch { /* */ }
  }, theme);
  if (pseudo) {
    const r = await ctx.request.post(`${BASE}/api/auth/enter`, { data: { name: pseudo }, headers: { Origin: BASE } });
    ok(r.status() === 200, `${pseudo} entre (${r.status()})`);
  }
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    // Google Fonts coupé par le réseau d'un conteneur ; les refus du serveur que la page attend — l'accueil
    // avant la porte (401), l'Admin d'un non-admin (403 d'admin/state : ses Teams seulement), l'en-tête d'un
    // compte Apps (403 de Stratégie) : pas la page
    if (/fonts\.googleapis|ERR_CERT_AUTHORITY_INVALID/.test(m.text() + (m.location()?.url || ''))) return;
    if (/Failed to load resource: the server responded with a status of 40[13]/.test(m.text())) return;
    errs.push(`${m.type()}: ${m.text()} ${m.location()?.url || ''}`);
  });
  page.on('pageerror', (e) => errs.push(`PAGEERROR ${e.message}`));
  page.errs = errs;
  page.shot = async (n, full = false) => { await page.waitForTimeout(350); await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: full }); };
  const api = async (path, body) => {
    const r = body === undefined ? await ctx.request.get(`${BASE}/api/${path}`)
      : await ctx.request.post(`${BASE}/api/${path}`, { data: body, headers: { Origin: BASE } });
    return { s: r.status(), d: await r.json().catch(() => ({})) };
  };
  return { ctx, page, api };
}
const visibleGo = (page) => page.$$eval('.tb.go', (l) => l.filter((x) => x.offsetWidth || x.offsetHeight).length);
const toastTxt = (page) => page.$eval('.toast', (t) => t.textContent).catch(() => '');
const theme = (page) => page.$eval('html', (h) => h.dataset.theme || 'dark');

// ── la mise en place, par Cal : une Team, son admin (Ada), un compte qui existe déjà (Noa) ──
const cal0 = await personne('dark', 'nico007');
let r = await cal0.api('equipes', { name: 'Atelier Pilote' });
ok(r.s === 200 && r.d.id, `une Team « Atelier Pilote » (${r.s})`);
const tid = r.d.id;
await cal0.api('admin/users', { name: 'Ada Pilote', access: 'studio' });
await cal0.api('admin/users', { name: 'Noa Existe', access: 'studio' });
r = await cal0.api(`equipes/${tid}/membres`, { pseudo: 'Ada Pilote', role: 'admin' });
ok(r.s === 200, `Ada, admin de la Team (${r.s})`);
await cal0.ctx.close();

for (const th of ['dark', 'light']) {
  const T = th === 'dark' ? 'Sombre' : 'Clair';
  say(`\n— ${th}`);

  // 1. la carte Alertes
  const cal = await personne(th, 'nico007');
  await cal.page.goto(`${BASE}/admin/#demandes`, { waitUntil: 'networkidle' });
  await cal.page.waitForSelector('[data-alertes] .al-steps');
  ok(await theme(cal.page) === th, `Cal : thème ${th} posé`);
  const chip = () => cal.page.$eval('[data-alertes] .card-head .chip:last-child', (c) => c.textContent.trim());
  if (th === 'dark') {
    ok(await chip() === 'à brancher', `alertes : « à brancher » (${await chip()})`);
    const dis = await cal.page.$$eval('[data-alertes] button[disabled]', (l) => l.map((b) => [b.textContent, b.title]));
    ok(dis.length >= 2 && dis.every(([, t]) => /jeton/.test(t)), `alertes : les actions désactivées disent pourquoi (${JSON.stringify(dis)})`);
    ok(/pose d’abord le jeton/.test(await cal.page.$eval('[data-alertes]', (c) => c.textContent)), 'alertes : … et la carte le dit en clair');
    await cal.page.shot('1-alertes-a-brancher-dark');
    await cal.page.fill('[data-alertes] input[type=password]', JETON);
    await cal.page.click('[data-alertes] form button[type=submit]');
    ok(await attendre(async () => await chip() === 'chat à trouver'), `alertes : le jeton posé, « chat à trouver » (${await chip()})`);
    ok(await cal.page.$eval('[data-alertes] input[type=password]', (i) => i.value === ''), 'alertes : le champ du jeton se vide');
    ok(await attendre(async () => /@portail_essai_bot/.test(await cal.page.$eval('[data-alertes]', (c) => c.textContent))), 'alertes : le nom du bot (getMe)');
    await cal.page.getByRole('button', { name: 'Trouver mon chat' }).click();
    await cal.page.waitForSelector('[data-cherche]');
    const code = (await cal.page.$eval('[data-cherche] .acct-code', (b) => b.textContent)).replace('/start ', '').trim();
    ok(/^[A-Z0-9]{6}$/.test(code), `alertes : un code à envoyer au bot (${code})`);
    ok(await cal.page.$eval('[data-cherche] a', (a) => a.href).catch(() => '') === `https://t.me/portail_essai_bot?start=${code}`, 'alertes : le lien t.me du bot');
    await cal.page.shot('2-alertes-code-dark');
    await faux('/ecrit', { text: `/start ${code}` });
    ok(await attendre(async () => await chip() === 'branchées', 20000), `alertes : le chat trouvé, « branchées » (${await chip()})`);
    await cal.page.getByRole('button', { name: 'Envoyer un essai' }).click();
    ok(await attendre(async () => !!(await msgDe('SHOWRUNNER · essai'))), 'alertes : « Envoyer un essai » : le message arrive');
    ok(await attendre(async () => /parti/.test(await cal.page.$eval('[data-alertes]', (c) => c.textContent)), 15000), 'alertes : le dernier envoi « parti »');
  } else {
    ok(await chip() === 'branchées', `alertes : toujours « branchées » (${await chip()})`);
  }
  ok(!(await cal.page.content()).includes(JETON.split(':')[1]), 'alertes : le jeton n’est nulle part dans la page');
  await cal.page.shot(`3-alertes-branchees-${th}`);

  // 2. Ada met un pseudo neuf, puis une liste
  const ada = await personne(th, 'Ada Pilote');
  await ada.page.goto(`${BASE}/admin/#teams`, { waitUntil: 'networkidle' });
  await ada.page.waitForSelector(`[data-add="${tid}"]`);
  ok(/attend la validation de Cal/.test(await ada.page.$eval(`[data-add="${tid}"]`, (f) => f.textContent)), 'Ada : le formulaire dit qu’un pseudo neuf attend Cal');
  await ada.page.fill(`[data-add="${tid}"] input.fld`, `Leo ${T}`);
  await ada.page.click(`[data-add="${tid}"] button[type=submit]`);
  ok(await attendre(async () => /attend la validation de Cal/.test(await toastTxt(ada.page))), `Ada : le toast « attend la validation de Cal » (${await toastTxt(ada.page)})`);
  const leoRow = ada.page.locator(`[data-team="${tid}"] [data-member]`, { hasText: `Leo ${T}` });
  ok(await attendre(async () => /attend Cal/.test(await leoRow.textContent())), 'Ada : la pastille « attend Cal » sur sa ligne');
  await ada.page.shot(`4-ada-pseudo-neuf-${th}`);
  // l'alerte part seule (des invités arrivés ensemble partent en un message : on attend qu'elle soit partie)
  ok(await attendre(async () => !!(await msgDe('invité à valider', `« Leo ${T} »`))), 'Telegram : Leo annoncé à Cal');
  await ada.page.locator(`[data-add="${tid}"]`).getByRole('button', { name: 'Coller une liste' }).click();
  await ada.page.fill(`[data-add="${tid}"] textarea`, `Una ${T}\nUli ${T}\nNoa Existe`);
  await ada.page.click(`[data-add="${tid}"] button[type=submit]`);
  ok(await attendre(async () => /attendent la validation de Cal/.test(await toastTxt(ada.page)), 20000), `Ada : la liste, le toast (${await toastTxt(ada.page)})`);
  const bulk = await ada.page.$$eval(`[data-add="${tid}"] .bulk-out .row`, (l) => l.map((x) => x.textContent));
  ok(bulk.filter((x) => /attend Cal/.test(x)).length === 2 && bulk.some((x) => /déjà inscrit|Noa/.test(x)),
    `Ada : deux « attend Cal », le compte existant entre (${JSON.stringify(bulk)})`);
  ok(await visibleGo(ada.page) <= 1, `Ada : au plus un orange (${await visibleGo(ada.page)})`);
  await ada.page.shot(`5-ada-liste-${th}`, true);

  // 3. l'invité tape son pseudo : la porte le fait attendre, et dit qui l'a invité
  const leo = await personne(th);
  await leo.page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await leo.page.waitForSelector('#porte-nom');
  await leo.page.fill('#porte-nom', `Leo ${T}`);
  await leo.page.click('.porte-form button[type=submit]');
  await leo.page.waitForSelector('.porte-state');
  const porte = await leo.page.$eval('.porte', (p) => p.textContent);
  ok(/invitation · en attente de Cal/.test(porte) && /Ada Pilote t’a invité/.test(porte) && /ton compte attend la validation de Cal/.test(porte),
    `Leo : la porte « invitation · en attente de Cal », invité par Ada (${porte.slice(0, 160)})`);
  await leo.page.shot(`6-invite-attend-${th}`);

  // 4. Cal : les demandes ; Telegram a reçu les alertes
  await cal.page.reload({ waitUntil: 'networkidle' });
  const card = cal.page.locator('[data-demande]', { hasText: `Leo ${T}` });
  await card.waitFor();
  const txt = await card.textContent();
  ok(/invité par\s*Ada Pilote\s*dans la Team\s*Atelier Pilote\s*\(membre\)/.test(txt), `Cal : « invité par Ada Pilote dans la Team Atelier Pilote (membre) » (${txt.slice(0, 140)})`);
  ok(await visibleGo(cal.page) === 1, `Cal : un seul orange (${await visibleGo(cal.page)})`);
  ok(await cal.page.locator('[data-demande]', { hasText: `Una ${T}` }).count() === 1, 'Cal : Una attend aussi');
  await cal.page.shot(`7-cal-demandes-${th}`, true);
  const mLeo = await msgDe('invité à valider', `« Leo ${T} »`);
  ok(mLeo && JSON.stringify(boutons(mLeo)) === '["Valider","Refuser"]' && /« Ada Pilote » invite dans la Team « Atelier Pilote »/.test(mLeo.text),
    `Telegram : « invité à valider », Valider · Refuser (${mLeo && mLeo.text.replace(/\n/g, ' | ')})`);
  const mLot = await msgDe('invités à valider', `« Una ${T} »`, `« Uli ${T} »`);
  ok(mLot && JSON.stringify(boutons(mLot)) === '["Valider (2)","Refuser (2)"]', `Telegram : le lot de la liste, « Valider (2) » (${JSON.stringify(boutons(mLot))})`);
  if (th === 'dark') ok(!!(await msgDe('pour info', '« Noa Existe »')), 'Telegram : le compte existant, pour info');
  ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test((await faux()).messages.map((m) => m.text + boutons(m).join('')).join('')), 'Telegram : aucun emoji');

  // 5. Cal accepte Leo dans Admin : sa page s'ouvre seule ; le message le dit
  await card.getByRole('button', { name: 'Accepter' }).click();
  ok(await attendre(async () => (await leo.page.$('.porte')) === null || !(await leo.page.$eval('body', (b) => b.classList.contains('porte-on'))), 20000),
    'Leo : accepté, sa page s’ouvre seule');
  await leo.page.waitForTimeout(800);
  await leo.page.shot(`8-invite-entre-${th}`);
  ok(await attendre(async () => { const m = (await faux()).messages.find((x) => x.message_id === mLeo.message_id); return /validé par Cal/.test(m.text) && !m.reply_markup; }),
    'Telegram : le message de Leo dit « validé par Cal », sans boutons');
  // « Refuser (2) » depuis Telegram : Una et Uli disparaissent
  await faux('/clic', { bouton: 'Refuser', message_id: mLot.message_id });
  ok(await attendre(async () => (await faux()).answers.some((a) => /refusé par Cal/.test(a.text))), 'Telegram : la réponse au clic « refusé par Cal »');
  ok(await attendre(async () => { await cal.page.waitForTimeout(500); return await cal.page.locator('[data-demande]', { hasText: `Una ${T}` }).count() === 0; }, 15000),
    'Cal : Una n’est plus dans les demandes');
  await ada.page.reload({ waitUntil: 'networkidle' });
  await ada.page.waitForSelector(`[data-team="${tid}"]`);
  const rows = await ada.page.$$eval(`[data-team="${tid}"] [data-member]`, (l) => l.map((x) => x.textContent));
  ok(!rows.some((x) => x.includes(`Una ${T}`) || x.includes(`Uli ${T}`)) && rows.some((x) => x.includes(`Leo ${T}`) && !/attend Cal/.test(x)),
    'Ada : Una et Uli sont partis de la Team, Leo y est sans pastille');
  await ada.page.shot(`9-ada-apres-${th}`, true);

  for (const [qui, p] of [['Cal', cal.page], ['Ada', ada.page], ['Leo', leo.page]]) ok(!p.errs.length, `${qui} (${th}) : console propre ${p.errs.join(' | ')}`);
  for (const p of [cal, ada, leo]) await p.ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/pilote.log`, log.join('\n') + '\n');
say(`\n${fails ? `${fails} ÉCHEC(S)` : 'tout passe'} — captures dans ${OUT}`);
process.exit(fails ? 1 : 0);
