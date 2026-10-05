// IDÉATION — l'agent Showrunner (Cal, 05/10 : « le mode Showrunner » ; l'étude :
// docs/etudes/agent_showrunner.md). Un panneau façon Claude à droite de la planche (une colonne
// de plus ; sur une page étroite, à la place de l'inspecteur) : le fil de la conversation de la
// planche, que le serveur garde (server/tools/ideation_agent.py), et le champ — au-dessus, les
// vignettes des pièces citées, retirables : glissées du panneau Asset, du disque ou de la planche,
// collées, prises au trombone, ou « Citer dans la discussion » au clic droit d'un objet ou de la
// sélection (menus.js).
//
// Un tour : le serveur LIT (la planche, le texte des documents, les images) et rend des ACTIONS
// {tool, args, why, id?} déjà validées ; la page les applique ici, toutes dans UN app.mutate — un
// seul pas d'annulation, l'enregistrement et la co-édition par le chemin de tous les gestes —,
// après avoir réclamé le tour (`claim` : un tour ne se pose qu'une fois ; un autre onglet, ou la
// page rechargée, propose « Poser ces gestes »). Chaque action devient une ligne (« posé une carte
// Générer image, branchée sur « photo 3 » ») : un clic vole jusqu'à ses objets, les choisit et les
// éclaire. « Annuler ce tour » le défait d'un coup : un app.mutate qui retire ce qu'il a posé et
// remet ce qu'il a déplacé, même après d'autres gestes. Jamais un rendu sans la personne : une
// carte Générer est posée prête ; seule `lancer: true` (une demande explicite, dite au modèle)
// la lance, et la ligne le dit.
//
// La place : des identifiants, jamais des coordonnées (un modèle de langue place mal au pixel).
// `dans` un cadre : une grille qui le remplit — un cadre posé dans le tour a d'avance la taille de
// ce qu'il recevra (la même grille, sur les tailles prévues : un texte est mesuré dans la feuille
// de la planche), un cadre de la planche grandit à la suite de ce qu'il contient ; `pres_de` un
// objet ; sinon une place libre près de la vue, puis à côté du précédent.
//
// L'entrée d'un projet (06/10, après le premier essai réel de Cal) : d'abord ACCUSER RÉCEPTION (la
// route rend l'inventaire compté par le serveur : il s'affiche tout de suite, avant même que le tour
// parte), puis COMPRENDRE et DEMANDER (ce qui ne colle pas, dit ; des questions à choix cliquables,
// « autre » en texte libre), puis PROPOSER peu (un plan court à accepter, changer ou refuser), puis
// FAIRE une étape à la fois (« Annuler ce tour » la défait). Pendant ce temps, les paliers d'arrière-plan
// (les images, les sons) s'annoncent chacun en une ligne, à leur place dans le fil. Le carnet (les
// décisions de la conversation, la « scripte ») se lit et se corrige en haut du panneau.
//
// Le contrat (« Commencer un projet », projet.js, l'appelle ainsi) :
//   app.agent.open()                                     le panneau, le champ prend la main
//   app.agent.send(text, { items | pieces, intent })     → Promise<{ turn, reply, actions, results }>
//       items (ou pieces, le même) : des identifiants de la bibliothèque ou d'objets de la planche
//       (ou des objets {id}) ; intent: 'ingest' : l'entrée d'un projet (la réception, ses questions ;
//       rien n'est posé) ; brief : les pièces qui SONT le brief (son texte est déjà `text` : comptées, pas relues). La promesse est tenue quand le tour est fini ET posé sur la planche ;
//       rejetée sur un refus (le message du portail) ou un tour en échec, arrêté.
//   app.agent.busy()                                     un tour en vol sur cette planche
// et pour la page : app.agent.cite(ids), app.agent.menuItems(objets) (menus.js), app.dropOut
// (canvas.js : un objet de la planche lâché sur le champ y est cité, et revient à sa place).

import { api, el, toast, jobs, pick, dropZone, uploadFile, kindMark, kindFr, fmtWait, studioSeul, studioIci, session, href, ongletCache, auRetour } from '../commun/shell.js';
import { bbox, inside } from './canvas.js';
import { outPort, canWire, replaces, newSlots } from './ports.js';

const ITEM = /^[a-z]{3}-\d{8}-\d{6}-[0-9a-f]{4}$/;
const NEW = /^new:\d{1,3}$/;
const KINDS = ['image', 'video', 'audio', 'element', 'document', 'midi', 'sequence'];   // core/library.py KINDS : tout se cite
const MAX_PIECES = 24;    // ideation_agent.MAX_ITEMS
const MAX_TEXT = 4000;    // ideation_agent.MAX_TEXT
const ACTIVE = new Set(['queued', 'running']);
const PAD = 32, GAP = 24;  // la marge d'un cadre, l'écart entre deux objets posés
// la hauteur d'une carte pour la placer : elle suit son contenu (mesurée au rendu, canvas.js AUTO_H) ; large,
// pour qu'une carte plus haute que prévu ne morde pas sur sa voisine
const CARD = { gen: [320, 440], vgen: [330, 520], compose: [340, 380] };
const TEXT = { note: 'note', postit: 'sticky', titre: 'title' };
const TEXT_W = { note: 230, sticky: 190, title: 460 };
const ROLE = { style: 'style', personnages: 'persos', action: 'action', decor: 'decor', photographie: 'photo', son: 'son', musique: 'musique' };
const DISP = { rangee: 'rangée', grille: 'grille', colonne: 'colonne' };
const FIELDS = ['x', 'y', 'w', 'h', 'group'];   // ce qu'un tour change d'un objet qui était là : « Annuler ce tour » le remet
const SUGGEST = ['Que vois-tu sur la planche ?', 'Range les images dans un cadre', 'Une image dans ce style', 'Lis ce document et résume-le en note'];
const ICO = {
  agent: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  plus: 'M12 5v14M5 12h14',
  send: 'M12 19V5M6 11l6-6 6 6',
  close: 'M6 6l12 12M18 6L6 18',
};
const cut = (s, k = 48) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > k ? s.slice(0, k - 1) + '…' : s; };
const plural = (n, s, p = s + 's') => `${n} ${n > 1 ? p : s}`;
const svg = (d) => el('span', { class: 'ag-ico', 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>` });
const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

// la feuille du panneau : chargée par le module (une page qui ne charge pas l'agent ne la lit pas)
const FEUILLE = new URL('./agent.css', import.meta.url).href;

export function install(app) {
  const { S } = app;
  if (!document.querySelector(`link[href="${FEUILLE}"]`)) document.head.append(el('link', { rel: 'stylesheet', href: FEUILLE }));
  const A = {
    open: !!app.LS('agent-open'),
    bid: null, conv: null, err: '', me: null,
    drafts: new Map(),     // planche → { text, pieces } : le champ de chaque planche
    mine: new Set(),       // les tours envoyés d'ici : posés d'office à leur fin
    flying: new Set(),     // les tours qu'on suit (leur travail)
    inv: new Map(),        // tour → de quoi le défaire (posé ici, dans cette page)
    posed: new Set(),      // les tours posés par cette page (son jeton les a réclamés : ils s'y reposent)
    seen: new Map(),       // objets de la bibliothèque lus (les vignettes)
    token: `t${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,   // cet onglet, pour réclamer un tour
    els: new Map(),        // tour → { key, el } : le fil ne refait que ce qui change
    qsel: new Map(),       // tour → { qid: { choix: Set, autre } } : les réponses qu'on est en train de donner
    run0: new Map(),       // tour → l'instant où cette page l'a vu partir (le compteur de secondes)
    carnet: !!app.LS('agent-carnet'),
  };
  // un geste du Studio (il calcule) : retiré pour qui ne l'a pas (l'invité, un ami « Apps »), le panneau aussi
  session().then((me) => { A.me = me?.user || null; if (A.open && !studioIci(me)) setOpen(false); });
  const draft = () => {
    const id = S.board?.id || '';
    if (!A.drafts.has(id)) A.drafts.set(id, { text: '', pieces: [] });
    return A.drafts.get(id);
  };

  // ── le panneau ───────────────────────────────────────────
  const engine = el('span', { class: 'pill ag-eng' }, el('i'), el('span'));
  const bNew = el('button', { class: 'tb ghost sm', type: 'button', title: 'une conversation neuve (l’ancienne est archivée)' }, 'Nouvelle');
  const bClose = el('button', { class: 'ag-b', type: 'button', title: 'fermer le panneau · I', 'aria-label': 'fermer le panneau', onclick: () => setOpen(false) }, svg(ICO.close));
  const fil = el('div', { class: 'ag-fil', role: 'log', 'aria-live': 'polite' });
  const carnet = el('section', { class: 'ag-carnet', hidden: true, 'aria-label': 'le carnet du projet : les décisions' });
  const pcs = el('div', { class: 'ag-pcs' });
  const ta = el('textarea', { class: 'ag-ta', rows: 1, maxlength: MAX_TEXT, spellcheck: 'true', 'aria-label': 'ta demande à Showrunner',
    placeholder: 'Demande à Showrunner — glisse ici des assets, des objets de la planche' });
  const bAttach = el('button', { class: 'ag-b', type: 'button', title: 'citer des assets : la bibliothèque, ou un fichier du disque', 'aria-label': 'citer des assets' }, svg(ICO.plus));
  const bSel = el('button', { class: 'ag-chip', type: 'button', hidden: true, title: 'citer les objets choisis sur la planche' });
  const bSend = el('button', { class: 'ag-send', type: 'button', 'aria-label': 'envoyer · Entrée' }, svg(ICO.send));
  const why = el('p', { class: 'ag-why' });
  const box = el('div', { class: 'ag-box' }, pcs, ta, el('div', { class: 'ag-row' }, bAttach, bSel, el('span', { class: 'sp' }), bSend));
  const panel = el('aside', { class: 'ag', hidden: true, 'aria-label': 'Showrunner, l’agent de la planche' },
    el('div', { class: 'ag-h' }, el('b', { class: 'ag-t' }, 'Showrunner'), engine, el('span', { class: 'sp' }), bNew, bClose),
    carnet, fil, el('div', { class: 'ag-comp' }, box, why));
  const main = document.querySelector('.ide-main');
  (main || document.body).append(panel);
  // ses gestes restent à lui (la planche ne les prend pas)
  panel.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  // le bouton de la barre du haut, après les raccourcis (un geste du Studio : il calcule)
  const btn = studioSeul(el('button', { class: 'tb ghost sm cmp ag-btn', type: 'button', 'aria-label': 'Showrunner', title: 'Showrunner : l’agent de la planche · I',
    onclick: () => setOpen(!A.open) }, el('span', { class: 'bi' }, svg(ICO.agent)), el('span', { class: 'bt' }, 'Showrunner')));
  const help = document.getElementById('b-help');
  if (help) help.after(btn); else document.querySelector('.ide-bar')?.append(btn);

  function setOpen(on, { focus = on } = {}) {
    A.open = !!on && studioIci();
    app.LS('agent-open', A.open);
    panel.hidden = !A.open;
    main?.classList.toggle('ag-on', A.open);
    btn.classList.toggle('on', A.open);
    if (A.open) { load(); paintDraft(); if (focus) setTimeout(() => ta.focus({ preventScroll: true }), 30); }
    // la planche change de largeur : la vue suit (canvas.js observe sa taille)
  }

  // ── la conversation de la planche ────────────────────────
  let loadT = 0;
  async function load() {
    clearTimeout(loadT);
    const bid = S.board?.id || null;
    if (!bid) { A.conv = null; paint(); return; }
    try {
      const c = await api(`ideation/agent/${bid}`);
      if (S.board?.id !== bid) return;
      A.bid = bid; A.conv = c; A.err = '';
    } catch (e) { A.err = e.message; }
    paint();
    // un tour en cours qu'on ne suit pas (un autre onglet, quelqu'un d'autre, la page rechargée) : relu tant qu'il
    // tourne et que l'onglet se voit (commun/shell.js, ongletCache) ; de retour sur l'onglet, relu tout de suite
    // de même tant qu'un palier d'arrière-plan travaille (les images, les sons) : sa ligne arrive quand il a fini
    const other = A.conv?.busy && !A.flying.has(A.conv.busy);
    if (A.open && (other || A.conv?.paliers_busy) && !ongletCache()) loadT = setTimeout(load, 2500);
  }
  auRetour(() => { if (A.open && ((A.conv?.busy && !A.flying.has(A.conv.busy)) || A.conv?.paliers_busy)) load(); });

  // ── envoyer ──────────────────────────────────────────────
  async function send(text, opts = {}) {
    const r = await post(text, opts);
    return follow(r.bid, r.turn, r.job);
  }
  // le tour entre dans la file (ou le portail refuse, en disant pourquoi : 400, 409)
  async function post(text, { items = [], pieces = [], intent = '', answers, questions_turn, plan_turn, etape, brief } = {}) {
    if (!S.board) throw new Error('ouvrez d’abord une planche');
    const bid = S.board.id;
    let content = String(text || '').trim();
    // l'analyse d'entrée reçoit le brief en entier (projet.js) : ce qui dépasse est dans les documents cités
    if (intent === 'ingest' && content.length > MAX_TEXT) content = content.slice(0, MAX_TEXT - 60).trimEnd() + '\n(… la suite est dans les documents cités)';
    const ids = [...new Set([...items, ...pieces].map((x) => String((x && typeof x === 'object' ? x.id : x) || '').trim()).filter(Boolean))];
    // l'agent lit la planche enregistrée : les derniers gestes partent d'abord
    try { await app.flushSave?.(); } catch { /* le refus se dit dans la barre ; l'agent lira la dernière enregistrée */ }
    const more = Object.fromEntries(Object.entries({ answers, questions_turn, plan_turn, etape, brief_items: brief }).filter(([, v]) => v !== undefined));
    const r = await api('ideation/agent', { method: 'POST', body: { board: bid, intent, messages: [{ role: 'user', content, items: ids }], ...more } });
    A.mine.add(r.turn.id);
    if (A.bid === bid && A.conv) {
      A.conv.turns.push(r.turn); A.conv.busy = r.turn.id;
      // les questions auxquelles on vient de répondre se ferment tout de suite ; les paliers neufs entrent dans le fil
      if (questions_turn) { const q = A.conv.turns.find((x) => x.id === questions_turn); if (q) q.answered_by = r.turn.id; }
      if (r.paliers?.length) { A.conv.paliers = [...(A.conv.paliers || []), ...r.paliers]; A.conv.paliers_busy = r.paliers.some((p) => ACTIVE.has(p.state)); }
    }
    paint(true);
    return { bid, ...r };
  }
  // suivre un tour : son travail, puis la conversation relue ; fini, il est posé (s'il vient d'ici)
  function follow(bid, turn, job) {
    A.flying.add(turn.id);
    return (async () => {
      try {
        const j = await jobs.wait(job.id, (jj) => tick(bid, turn.id, jj));
        let conv = null;
        try { conv = await api(`ideation/agent/${bid}`); } catch { /* relu au prochain geste */ }
        if (conv && A.bid === bid) A.conv = conv;
        const t = conv?.turns.find((x) => x.id === turn.id) || { ...turn, state: j.state, error: j.error };
        if (t.state !== 'done') throw new Error(t.error || j.error || (t.state === 'cancelled' ? 'tour arrêté' : `le tour a fini en « ${t.state} »`));
        let out = null;
        if (S.board?.id === bid && !t.claimed) out = await appliquer(t);
        return { turn: t, reply: t.reply || '', actions: t.actions || [], results: out?.results || t.results || [] };
      } finally {
        A.flying.delete(turn.id);
        paint();
        if (A.conv?.paliers_busy && A.bid === bid) { clearTimeout(loadT); loadT = setTimeout(load, 2500); }
      }
    })();
  }
  function tick(bid, tid, j) {
    if (A.bid !== bid || !A.conv) return;
    const t = A.conv.turns.find((x) => x.id === tid);
    if (!t) return;
    t.job_state = { state: j.state, message: j.message, progress: j.progress, position: j.position, ahead: j.ahead, eta_s: j.eta_s };
    if (ACTIVE.has(j.state)) t.state = j.state;
    paint();
  }
  async function fromComposer() {
    const d = draft();
    const text = ta.value.trim();
    const w = sendWhy(text);
    if (w) { why.textContent = w; return; }
    const keep = { text: d.text, pieces: d.pieces.slice() };
    d.text = ''; d.pieces = [];
    paintDraft();
    let r;
    const q = openQuestions(), pl = activePlan();
    const route = q ? { intent: 'plan', questions_turn: q.id, answers: answersOf(q) } : pl?.plan.etat === 'propose' ? { intent: 'plan' } : {};
    try { r = await post(text, { items: keep.pieces.map((x) => x.id), ...route }); } catch (e) {
      // refusé avant d'entrer (400, 409) : le champ revient tel qu'il était
      if (!draft().text && !draft().pieces.length) Object.assign(draft(), keep);
      paintDraft();
      toast(`Showrunner : ${e.message}`, 8000);
      load();
      return;
    }
    follow(r.bid, r.turn, r.job).catch((e) => toast(`Showrunner : ${e.message}`, 8000));
  }
  // ce qui empêche d'envoyer ('' : rien) — une action éteinte dit pourquoi (règle 7)
  function sendWhy(text = ta.value.trim()) {
    if (!S.board) return 'ouvrez d’abord une planche';
    if (A.err) return `l’agent ne répond pas : ${A.err}`;
    const eng = A.conv?.engine;
    if (eng && !eng.ready) return `l’agent n’est pas prêt : ${eng.why}`;
    if (A.conv?.busy || A.flying.size) return 'un tour est en cours : attends sa réponse, ou arrête-le';
    if (!text) return 'écris ta demande';
    return '';
  }

  // ── poser un tour ────────────────────────────────────────
  // `lancer` : faux pour un tour reposé — une carte lancée au premier passage ne se relance pas toute seule
  async function appliquer(t, { lancer = true } = {}) {
    const bid = S.board?.id;
    if (!bid || !t.actions?.length) return { results: [], ids: {} };
    try { await api(`ideation/agent/${bid}/turns/${t.id}`, { method: 'POST', body: { claim: A.token } }); } catch (e) {
      t.claimed = true;
      toast(`ces gestes ne se posent pas ici : ${e.message}`, 7000);
      paint();
      return null;
    }
    t.claimed = true;
    let out;
    try { out = await poser(t.actions); } catch (e) {
      console.error('agent · poser', e);
      toast(`les gestes de Showrunner n’ont pas pu être posés : ${e.message}`, 8000);
      return null;
    }
    A.inv.set(t.id, out.inv);
    A.posed.add(t.id);
    t.results = out.results; t.ids = out.ids; t.applied = true; t.undone = false;
    // jamais un rendu sans la personne : seulement la carte que le modèle a dite demandée (lancer: true)
    for (const L of out.launch) {
      const n = app.node(L.id);
      const r = out.results[L.i];
      if (!n || !r) continue;
      const mod = n.type === 'gen' ? app.gen : app.video;
      const w = typeof mod?.why === 'function' ? mod.why(n) : '';
      const wt = typeof w === 'string' ? w : w?.why || '';
      if (!lancer) { r.text += ' — prête : son bouton Générer est à toi (pas relancée)'; continue; }
      if (wt) { r.text += ` — pas lancée : ${wt}`; continue; }
      r.text += ' — lancée à ta demande';
      Promise.resolve().then(() => mod.generate(n.id)).catch((e) => toast(`la carte ne s’est pas lancée : ${e.message}`, 7000));
    }
    api(`ideation/agent/${bid}/turns/${t.id}`, { method: 'POST', body: { applied: true, token: A.token, ids: out.ids, undone: false,
      results: out.results.map((r) => ({ text: r.text, ok: r.ok, ids: r.made })) } }).then(() => { if (t.intent === 'etape' && !lancer) load(); })
      .catch((e) => console.error('agent · applied', e));
    paint();
    eclairer([...out.inv.made]);   // ce qui vient d'arriver s'éclaire, sans bouger la vue
    return out;
  }

  // les objets de la bibliothèque que nomment les actions, lus d'un coup (montrer : où qu'ils soient)
  async function ensureItems(ids) {
    const want = [...new Set(ids)].filter((id) => id && !S.items.has(id));
    if (!want.length) return;
    try {
      const r = await api('library/batch', { method: 'POST', body: { ids: want, spaces: '*' } });
      for (const it of r.items || []) { S.items.set(it.id, it); A.seen.set(it.id, it); }
    } catch { /* absents : leurs gestes le diront */ }
  }

  // la hauteur d'un texte posé à cette largeur, mesurée dans la feuille de la planche
  function mesure(type, text, w, h0) {
    const host = app.canvas.el.querySelector('.world') || app.canvas.el;
    const p = el('div', { class: `nd ${type}${type === 'title' ? ' sz-m' : ''}`, 'aria-hidden': 'true',
      style: { position: 'absolute', left: '-100000px', top: '0', width: `${w}px`, height: 'auto', visibility: 'hidden' } }, el('div', { class: 'txt' }, text));
    host.append(p);
    const h = p.offsetHeight;
    p.remove();
    return Math.max(h0, Math.ceil(h || 0));
  }
  const autoCols = (n) => Math.max(1, Math.round(Math.sqrt(n * 1.4)));   // les colonnes d'app.tidy
  // une grille : des rangées de `cols`, à la hauteur de la plus haute ; positions depuis le coin d'un cadre
  function grille(sizes, cols) {
    if (!sizes.length) return { pos: [], w: 560, h: 380 };
    const pos = [];
    let y = PAD, wmax = 0;
    for (let i = 0; i < sizes.length; i += cols) {
      const row = sizes.slice(i, i + cols);
      let x = PAD;
      for (const s of row) { pos.push([x, y]); x += s.w + GAP; }
      wmax = Math.max(wmax, x - GAP + PAD);
      y += Math.max(...row.map((s) => s.h)) + GAP;
    }
    return { pos, w: Math.max(360, wmax), h: Math.max(200, y - GAP + PAD) };
  }

  // ce que le tour va poser, et à quelle taille, avant de rien toucher : les cadres neufs ont ainsi
  // la taille de ce qu'ils recevront (les cadres intérieurs d'abord : ils viennent après leur parent)
  function prevoir(actions) {
    const B = S.board;
    const size = new Map();   // new:N → { w, h }
    const onBoard = new Set(B.nodes.filter((n) => n.type === 'media').map((n) => n.item));
    const sizeOf = (ref) => {
      if (NEW.test(ref)) return size.get(ref) || { w: 230, h: 80 };
      const n = app.node(ref);
      return n ? app.canvas.dispBox(n) : { w: 0, h: 0 };
    };
    const plan = actions.map((a) => {
      const g = a.args || {};
      let made = null;
      const refs = [];
      if (a.tool === 'poser_texte') {
        const t = TEXT[g.sorte] || 'note';
        const d = app.def(t);
        made = { w: TEXT_W[t], h: mesure(t, g.texte || '', TEXT_W[t], d.h || 50) };
      } else if (a.tool === 'poser_asset') {
        const it = S.items.get(g.item);
        if (it && !it.missing) { const [w, h] = app.sizeFor(it); made = { w, h }; onBoard.add(it.id); }
      } else if (a.tool === 'carte_image' || a.tool === 'carte_video') {
        const list = a.tool === 'carte_image' ? g.refs || [] : [g.image, g.fin].filter(Boolean);
        for (const r of list) {
          const it = ITEM.test(r) && !onBoard.has(r) ? S.items.get(r) : null;
          if (it && !it.missing) { const [w, h] = app.sizeFor(it, 180); refs.push({ w, h }); onBoard.add(r); }
        }
        const [w, h] = a.tool === 'carte_image' ? CARD.gen : CARD.vgen;
        made = { w, h };
      } else if (a.tool === 'composeur') made = { w: CARD.compose[0], h: CARD.compose[1] };
      else if (a.tool === 'poser_cadre' && !g.autour) made = { w: 560, h: 380 };
      if (a.id && made) size.set(a.id, made);
      return { made, refs };
    });
    const pre = new Map();    // new:N d'un cadre → { pos, w, h }
    for (let i = actions.length - 1; i >= 0; i--) {
      const a = actions[i];
      if (a.tool !== 'poser_cadre' || a.args?.autour || !a.id) continue;
      const kids = [];
      let cols = 0;
      for (let k = i + 1; k < actions.length; k++) {
        const b = actions[k], g = b.args || {};
        if (g.dans !== a.id) continue;
        if (b.tool === 'deplacer' || b.tool === 'ranger') {
          for (const id of g.ids || []) kids.push(sizeOf(id));
          if (b.tool === 'ranger') cols = g.disposition === 'rangee' ? 999 : g.disposition === 'colonne' ? 1 : 0;
        } else {
          kids.push(...plan[k].refs);
          if (plan[k].made) kids.push(plan[k].made);
        }
      }
      const G = grille(kids, cols || autoCols(kids.length));
      pre.set(a.id, G);
      size.set(a.id, { w: G.w, h: G.h });
      plan[i].made = { w: G.w, h: G.h };
    }
    return { plan, pre };
  }

  async function poser(actions) {
    const want = [];
    for (const a of actions) {
      const g = a.args || {};
      if (a.tool === 'poser_asset') want.push(g.item);
      if (a.tool === 'carte_image') want.push(...(g.refs || []).filter((r) => ITEM.test(r)));
      if (a.tool === 'carte_video') want.push(...[g.image, g.fin].filter((r) => r && ITEM.test(r)));
    }
    await ensureItems(want);
    const P = prevoir(actions);
    let out = null;
    app.mutate((B) => { out = run(B, actions, P); });
    if (!out) throw new Error('aucune planche ouverte');
    const name = document.getElementById('b-name');
    if (name && name.value !== S.board.name) { name.value = S.board.name; document.title = `${S.board.name} · Idéation`; }
    return out;
  }

  // tout le tour, dans le app.mutate : des fonctions pures sur la planche (ports.js, groups.js) — jamais
  // les gestes de la page qui prennent chacun leur pas d'annulation (addAt, wire, feed, genWith…)
  function run(B, actions, { plan, pre }) {
    const caps = app.caps();
    const box = (n) => app.canvas.dispBox(n);
    const before = new Map(B.nodes.map((n) => [n.id, Object.fromEntries(FIELDS.map((k) => [k, n[k]]))]));
    const linksBefore = new Map(B.links.map((l) => [l.id, l]));
    const nameBefore = B.name;
    const made = new Map();      // new:N → objet posé
    const ids = {};              // new:N → son identifiant (le serveur le garde)
    const slots = new Map();     // cadre posé dans le tour → { pos, k }
    const cursors = new Map();   // cadre de la planche → où poser le suivant
    const launch = [];
    let last = null;             // le dernier objet posé librement : le suivant se met à côté
    const get = (ref) => (NEW.test(ref || '') ? made.get(ref) || null : B.nodes.find((n) => n.id === ref) || null);
    const label = (ref) => { const n = get(ref); return n ? app.label(n) : ITEM.test(ref || '') ? S.items.get(ref)?.title || ref : '?'; };

    // une place libre de (x0, y0) vers la droite et autour, les cadres compris (un objet posé dans un cadre en ferait partie)
    function libre(x0, y0, w, h, { around = false, skip = null } = {}) {
      const busy = B.nodes.filter((n) => n.type !== 'group' && !skip?.has(n.id)).map(box);
      const free = (x, y) => !busy.some((b) => x < b.x + b.w + 16 && x + w + 16 > b.x && y < b.y + b.h + 16 && y + h + 16 > b.y);
      const sx = Math.min(w + GAP, 420), sy = Math.min(h + GAP, 420), cand = [];
      for (let c = around ? -8 : 0; c <= 12; c++) for (let r = around ? -8 : -3; r <= 12; r++) cand.push([c, r, Math.hypot(c * sx, r * sy * 1.15)]);
      cand.sort((a, b) => a[2] - b[2]);
      for (const [c, r] of cand) if (free(x0 + c * sx, y0 + r * sy)) return [Math.round(x0 + c * sx), Math.round(y0 + r * sy)];
      const all = bbox(busy);   // pleine autour : à droite de tout
      return all ? [Math.round(all.x + all.w + 120), Math.round(all.y)] : [Math.round(x0), Math.round(y0)];
    }
    function placeFree(n, near = null, { left = false } = {}) {
      let x0, y0, around = false;
      if (near) { const b = box(near); [x0, y0] = left ? [b.x - n.w - 70, b.y] : [b.x + b.w + 2 * GAP, b.y]; }
      else if (last && B.nodes.includes(last)) { const b = box(last); [x0, y0] = [b.x + b.w + 2 * GAP, b.y]; }
      else { const [cx, cy] = app.canvas.center(); [x0, y0] = [cx - n.w / 2, cy - n.h / 2]; around = true; }
      [n.x, n.y] = libre(x0, y0, n.w, n.h, { around });
      if (!near) last = n;
    }
    // la suite d'un cadre de la planche : sous ce qu'il contient, en rangées ; il grandit
    function put(F, w, h, { row = false, wrap = true, skip = null } = {}) {
      let c = cursors.get(F.id);
      if (!c) {
        const inner = B.nodes.filter((n) => n !== F && n.type !== 'group' && !skip?.has(n.id) && inside(n, F)).map(box);
        c = { x: F.x + PAD, y: inner.length ? Math.max(...inner.map((b) => b.y + b.h)) + GAP : F.y + PAD, rowH: 0 };
        cursors.set(F.id, c);
      }
      const right = F.x + Math.max(F.w, w + 2 * PAD) - PAD;
      if (c.x > F.x + PAD && (row || (wrap && c.x + w > right))) { c.x = F.x + PAD; c.y += c.rowH + GAP; c.rowH = 0; }
      const at = [Math.round(c.x), Math.round(c.y)];
      c.x += w + GAP; c.rowH = Math.max(c.rowH, h);
      F.w = Math.max(F.w, at[0] + w + PAD - F.x);
      F.h = Math.max(F.h, at[1] + h + PAD - F.y);
      return at;
    }
    // la place suivante d'un cadre : celle prévue (un cadre du tour), sinon la suite (un cadre de la planche)
    function slotIn(F, w, h, opt) {
      const s = slots.get(F.id);
      if (s && s.k < s.pos.length) { const [x, y] = s.pos[s.k++]; return [Math.round(F.x + x), Math.round(F.y + y)]; }
      return put(F, w, h, opt);
    }
    // poser un objet neuf : dans un cadre, près d'un objet, sinon une place libre ; '' ou ce qui n'a pas suivi
    function place(n, g, { frame = false } = {}) {
      const F = g.dans ? get(g.dans) : null;
      let warn = '';
      if (F && F.type === 'frame') [n.x, n.y] = slotIn(F, n.w, n.h);
      else {
        if (g.dans) warn = `le cadre « ${g.dans} » n’est plus là : posé à côté`;
        const near = g.pres_de ? get(g.pres_de) : null;
        if (g.pres_de && !near) warn = 'son voisin n’est plus sur la planche';
        placeFree(n, near);
      }
      if (frame) B.nodes.unshift(n); else B.nodes.push(n);
      return warn;
    }
    const where = (g) => (g.dans ? ` dans « ${label(g.dans)} »` : g.pres_de ? ` près de « ${label(g.pres_de)} »` : '');
    const wire = (from, port, to, out) => {
      const o = outPort(from);
      const w = o ? canWire(B, from.id, o.id, to.id, port, caps, S.items) : `${app.label(from)} ne donne rien à brancher`;
      if (w) return w;
      const old = replaces(B, to.id, port, caps);
      if (old) B.links = B.links.filter((l) => l !== old);
      const l = { id: app.uid('l'), a: from.id, b: to.id, kind: 'wire', pa: o.id, pb: port, label: '' };
      B.links.push(l);
      out.push(l.id);
      return '';
    };
    // une référence d'une carte : un objet de la planche, un objet posé dans le tour, ou un objet de la
    // bibliothèque — déjà posé, il est branché tel quel ; sinon il se pose (à gauche de la carte, ou dans son cadre)
    function refNode(ref, card, g, k, made2) {
      let n = get(ref);
      if (n) return n;
      const it = ITEM.test(ref || '') ? S.items.get(ref) : null;
      if (!it || it.missing) return null;
      n = B.nodes.find((x) => x.type === 'media' && x.item === it.id);
      if (n) return n;
      const [w, h] = app.sizeFor(it, 180);
      n = app.newMedia(it, 0, 0, w, h);
      const F = g.dans ? get(g.dans) : null;
      if (F && F.type === 'frame') [n.x, n.y] = slotIn(F, w, h);
      else if (card) [n.x, n.y] = libre(card.x - w - 70, card.y + k * (h + 16), w, h);
      else [n.x, n.y] = [0, 0];
      B.nodes.push(n);
      made2.push(n.id);
      return n;
    }
    // la carte Générer image : Krea 2 si ses références y tiennent, sinon Qwen-Image 2.1 (la règle d'app.genWith)
    function modelFor(nrefs, d) {
      const models = S.cfg?.models || [];
      if (!nrefs || !models.length) return d;
      const fits = (id) => (models.find((m) => m.id === id)?.refs ?? 0) >= nrefs;
      return ['krea2', 'qwen21'].find(fits) || models.filter((m) => m.refs).sort((a, b) => b.refs - a.refs)[0]?.id || d;
    }
    const units = (list) => list.map(get).filter(Boolean);

    const results = actions.map((a, i) => {
      const g = a.args || {};
      const m2 = [];   // ce que ce geste a créé (objets, liens) : « Annuler ce tour » après un rechargement le retire
      const res = (text, ok = true) => ({ text, ok, made: m2 });
      const mk = (n) => { if (a.id) { made.set(a.id, n); ids[a.id] = n.id; } m2.push(n.id); return n; };
      try {
        switch (a.tool) {
          case 'poser_texte': {
            const t = TEXT[g.sorte] || 'note';
            const n = mk({ id: app.uid('n'), type: t, ...app.def(t), text: g.texte || '', x: 0, y: 0 });
            if (t === 'sticky' && g.couleur) n.color = g.couleur;
            n.w = TEXT_W[t]; n.h = plan[i].made?.h || n.h;
            const w = place(n, g);
            return res(`posé ${{ note: 'une note', sticky: 'un post-it', title: 'un titre' }[t]} « ${cut(g.texte, 60)} »${where(g)}${w ? ` (${w})` : ''}`);
          }
          case 'poser_cadre': {
            const f = { id: app.uid('n'), type: 'frame', ...app.def('frame'), name: g.nom || 'Cadre', x: 0, y: 0 };
            if (g.autour?.length) {
              const r = bbox(units(g.autour).map(box));
              if (!r) return res(`le cadre « ${g.nom} » : ses objets ne sont plus sur la planche`, false);
              Object.assign(f, { x: Math.round(r.x - 36), y: Math.round(r.y - 36), w: Math.round(r.w + 72), h: Math.round(r.h + 72) });
              mk(f);
              B.nodes.unshift(f);
              return res(`posé le cadre « ${f.name} » autour de ${plural(g.autour.length, 'objet')}`);
            }
            const G = pre.get(a.id);
            if (G) { f.w = G.w; f.h = G.h; slots.set(f.id, { pos: G.pos, k: 0 }); }
            mk(f);
            const w = place(f, g, { frame: true });
            return res(`posé le cadre « ${f.name} »${where(g)}${w ? ` (${w})` : ''}`);
          }
          case 'poser_asset': {
            const it = S.items.get(g.item);
            if (!it || it.missing) return res(`« ${g.item} » ne se lit pas ici (corbeille, autre Workspace ?)`, false);
            if (!(S.meta?.media_kinds || ['image', 'video', 'audio', 'element']).includes(it.kind)) return res(`« ${it.title || it.id} » : un ${kindFr(it.kind)} ne se pose pas sur la planche`, false);
            const [w, h] = app.sizeFor(it);
            const n = mk(app.newMedia(it, 0, 0, w, h));
            const ww = place(n, g);
            return res(`posé « ${cut(it.title || it.id, 40)} »${where(g)}${ww ? ` (${ww})` : ''}`);
          }
          case 'carte_image': case 'carte_video': {
            const img = a.tool === 'carte_image';
            const d = app.def(img ? 'gen' : 'vgen');
            const [w, h] = img ? CARD.gen : CARD.vgen;
            const n = { id: app.uid('n'), type: img ? 'gen' : 'vgen', ...d, prompt: g.prompt || '', x: 0, y: 0, w, h };
            const list = img ? (g.refs || []) : [g.image, g.fin].filter(Boolean);
            const ports = img ? list.map(() => 'refs') : [g.image && 'start', g.fin && 'end'].filter(Boolean);
            if (img) {
              n.model = g.modele || modelFor(list.length, d.model);
              if (g.format) n.aspect = g.format;
              if (g.nombre) n.count = g.nombre;
            } else n.mode = g.image || g.fin ? 'i2v' : 't2v';
            // la carte d'abord (ses références de la bibliothèque se posent à sa gauche) ; dans un cadre, ses
            // références neuves prennent les places d'avant la sienne (prevoir les a comptées ainsi)
            const there = list.map((r) => get(r) || (ITEM.test(r) ? B.nodes.find((x) => x.type === 'media' && x.item === r) : null)).filter(Boolean);
            const F = g.dans ? get(g.dans) : null;
            const inFrame = F && F.type === 'frame';
            const refsFirst = inFrame ? list.map((r, k) => refNode(r, null, g, k, m2)) : null;
            mk(n);
            let warn = '';
            if (inFrame) [n.x, n.y] = slotIn(F, w, h);
            else {
              const near = g.pres_de ? get(g.pres_de) : null;
              if (near) placeFree(n, near);
              else if (there.length) { const r = bbox(there.map(box)); [n.x, n.y] = libre(r.x + r.w + 90, r.y, w, h); }
              else placeFree(n);
              if (g.dans) warn = `le cadre « ${g.dans} » n’est plus là`;
            }
            B.nodes.push(n);
            const nodes = refsFirst || list.map((r, k) => refNode(r, n, g, k, m2));
            const refused = [], names = [];
            nodes.forEach((rn, k) => {
              if (!rn) { refused.push(`« ${list[k]} » n’est plus là`); return; }
              const ww = wire(rn, ports[k], n, m2);
              if (ww) refused.push(ww); else names.push(`« ${cut(app.label(rn), 28)} »`);
            });
            if (g.lancer === true) launch.push({ id: n.id, i });
            const what = img ? 'une carte Générer image' : 'une carte Générer vidéo';
            const on = names.length ? (img ? `, branchée sur ${names.join(', ')}` : `, ${names.length > 1 ? 'première et dernière images' : 'première image'} ${names.join(', ')}`) : '';
            const ready = g.lancer === true ? '' : ' — prête : son bouton Générer est à toi';
            return res(`posé ${what}${on}${where(g)}${ready}${refused.length ? ` ; refusé : ${refused.join(' ; ')}` : ''}${warn ? ` (${warn})` : ''}`);
          }
          case 'composeur': {
            const keys = Object.keys(ROLE).filter((k) => String(g[k] || '').trim());
            const slots2 = newSlots(keys.map((k) => ROLE[k]));
            slots2.forEach((s, k) => { s.text = String(g[keys[k]]); });
            const [w, h] = CARD.compose;
            const c = mk({ id: app.uid('n'), type: 'compose', ...app.def('compose'), slots: slots2, x: 0, y: 0, w, h });
            const V = g.vers ? get(g.vers) : null;
            let warn = '';
            if (g.dans || g.pres_de || !V) warn = place(c, g);
            else { [c.x, c.y] = libre(V.x - w - 70, V.y, w, h); B.nodes.push(c); }
            let wired = '';
            if (V) { const ww = wire(c, 'prompt', V, m2); wired = ww ? ` ; pas branché : ${ww}` : `, branché sur « ${cut(app.label(V), 30)} »`; }
            return res(`posé un composeur de prompt (${plural(keys.length, 'case')})${wired}${where(g)}${warn ? ` (${warn})` : ''}`);
          }
          case 'relier': {
            const x = get(g.de), y = get(g.vers);
            if (!x || !y) return res('une flèche : un des deux objets n’est plus là', false);
            if (B.links.some((l) => l.a === x.id && l.b === y.id && l.kind !== 'wire')) return res(`« ${cut(app.label(x), 28)} » et « ${cut(app.label(y), 28)} » sont déjà reliés`, false);
            const l = { id: app.uid('l'), a: x.id, b: y.id, kind: 'arrow', label: g.texte || '' };
            B.links.push(l);
            m2.push(l.id);
            return res(`relié « ${cut(app.label(x), 28)} » → « ${cut(app.label(y), 28)} »${g.texte ? ` (« ${g.texte} »)` : ''}`);
          }
          case 'renommer_planche':
            B.name = g.nom || B.name;
            return res(`renommé la planche « ${B.name} »`);
          case 'grouper': {
            const kids = units(g.ids || []).filter((n) => n.type !== 'group' && !n.group);
            if (kids.length < 2) return res('grouper : il faut deux objets hors d’un groupe', false);
            const grp = mk(app.groups.make(kids, { name: g.nom || '' }));
            return res(`groupé ${plural(kids.length, 'objet')} « ${grp.name} »`);
          }
          case 'ranger': case 'deplacer': {
            const list = units(g.ids || []);
            if (!list.length) return res('ces objets ne sont plus sur la planche', false);
            const skip = new Set(list.map((n) => n.id));
            const F = g.dans ? get(g.dans) : null;
            const shift = (n, x, y) => { const b = box(n); app.groups.shift(n, Math.round(x - b.x), Math.round(y - b.y)); };
            if (F && F.type === 'frame') {
              const cols = a.tool !== 'ranger' ? 0 : g.disposition === 'rangee' ? Infinity : g.disposition === 'colonne' ? 1 : autoCols(list.length);
              list.forEach((n, k) => {
                const b = box(n);
                const opt = cols ? { row: k === 0 || (cols !== Infinity && k % cols === 0), wrap: cols !== Infinity, skip } : { skip };
                const [x, y] = slotIn(F, b.w, b.h, opt);
                shift(n, x, y);
              });
            } else if (a.tool === 'ranger') {
              const cols = g.disposition === 'rangee' ? list.length : g.disposition === 'colonne' ? 1 : autoCols(list.length);
              const r = bbox(list.map(box));
              const G = grille(list.map(box), cols);
              list.forEach((n, k) => shift(n, r.x + G.pos[k][0] - PAD, r.y + G.pos[k][1] - PAD));
            } else if (g.pres_de) {
              const T = get(g.pres_de);
              if (!T) return res('son voisin n’est plus sur la planche', false);
              const r = bbox(list.map(box)), t = box(T);
              const [x, y] = libre(t.x + t.w + 2 * GAP, t.y, r.w, r.h, { skip });
              for (const n of list) app.groups.shift(n, x - r.x, y - r.y);
            } else for (const n of list) app.groups.shift(n, g.dx || 0, g.dy || 0);
            const n = plural(list.length, 'objet');
            if (a.tool === 'ranger') return res(`rangé ${n} en ${DISP[g.disposition] || 'grille'}${where(g)}`);
            return res(`déplacé ${n}${g.dans || g.pres_de ? where(g) : ` de ${Math.round(g.dx || 0)}, ${Math.round(g.dy || 0)}`}`);
          }
          default:
            return res(`geste inconnu : ${a.tool}`, false);
        }
      } catch (e) {
        console.error('agent · geste', a, e);
        return res(`${a.tool} : ${e.message}`, false);
      }
    });

    // de quoi défaire le tour : ce qu'il a créé, ce qu'il a changé de ce qui était là, les fils qu'il a remplacés
    const inv = { made: new Set(), links: new Set(), before: new Map(), removed: [], name: B.name !== nameBefore ? nameBefore : null, newName: B.name };
    for (const n of B.nodes) {
      const b0 = before.get(n.id);
      if (!b0) { inv.made.add(n.id); continue; }
      if (FIELDS.some((k) => n[k] !== b0[k])) inv.before.set(n.id, b0);
    }
    const now = new Set(B.links.map((l) => l.id));
    for (const l of B.links) if (!linksBefore.has(l.id)) inv.links.add(l.id);
    for (const [id, l] of linksBefore) if (!now.has(id)) inv.removed.push(l);
    return { results, ids, launch, inv };
  }

  // « Annuler ce tour » : un seul app.mutate ; posé dans cette page, tout se remet (même après d'autres gestes) ;
  // posé ailleurs ou avant un rechargement, ce qu'il a créé part (le serveur le garde), ses déplacements restent
  function defaire(t) {
    if (!S.board) return;
    const inv = A.inv.get(t.id);
    const made = inv ? inv.made : new Set([...Object.values(t.ids || {}), ...(t.results || []).flatMap((r) => r.ids || [])]);
    const links = inv ? inv.links : made;
    const moved = !inv && (t.actions || []).some((a) => ['ranger', 'deplacer', 'renommer_planche'].includes(a.tool));
    app.mutate((B) => {
      B.nodes = B.nodes.filter((n) => !made.has(n.id));
      B.links = B.links.filter((l) => !links.has(l.id) && !made.has(l.a) && !made.has(l.b));
      if (!inv) return;
      for (const [id, f] of inv.before) {
        const n = B.nodes.find((x) => x.id === id);
        if (n) for (const k of FIELDS) { if (f[k] === undefined) delete n[k]; else n[k] = f[k]; }
      }
      const ids = new Set(B.nodes.map((n) => n.id));
      for (const l of inv.removed) if (!B.links.some((x) => x.id === l.id) && ids.has(l.a) && ids.has(l.b)) B.links.push(l);
      if (inv.name !== null && B.name === inv.newName) B.name = inv.name;
    });
    const name = document.getElementById('b-name');
    if (name && name.value !== S.board.name) { name.value = S.board.name; document.title = `${S.board.name} · Idéation`; }
    t.undone = true;
    A.inv.delete(t.id);
    // une étape défaite est à refaire (le serveur recule le plan) : la conversation relue le montre
    api(`ideation/agent/${S.board.id}/turns/${t.id}`, { method: 'POST', body: { undone: true } }).then(() => { if (t.intent === 'etape') load(); }).catch(() => {});
    toast(moved ? 'tour défait : ce qu’il avait posé est retiré ; ses déplacements restent (il a été posé avant le rechargement de la page)'
      : 'tour défait — ctrl+Z le remet', 6000);
    paint();
  }

  // un clic sur une action : ses objets, vus, choisis, éclairés
  const flashCss = el('style', { 'data-agent': '' });
  document.head.append(flashCss);
  let flashT = 0;
  function montrer(ids) {
    const list = ids.map((id) => app.node(id)).filter(Boolean);
    if (!list.length) { toast('ces objets ne sont plus sur la planche'); return; }
    const units = [...new Set(list.map((n) => (n.group && !list.some((m) => m.id === n.group) ? n.group : n.id)))];
    app.select(units);
    app.canvas.flyTo(bbox(list.map((n) => app.canvas.dispBox(n))), { pad: 90, zmax: 1.2 });
    eclairer(ids);
  }
  function eclairer(ids) {
    const list = ids.map((id) => app.node(id)).filter(Boolean);
    if (!list.length) return;
    flashCss.textContent = '';
    clearTimeout(flashT);
    requestAnimationFrame(() => {
      flashCss.textContent = `${list.map((n) => `.cv .nd[data-id="${CSS.escape(n.id)}"], .cv .fr[data-id="${CSS.escape(n.id)}"]`).join(',\n')} { animation: agFlash 1.8s ease-out 1; }`;
      flashT = setTimeout(() => { flashCss.textContent = ''; }, 1900);
    });
  }
  // les objets d'une action : ce qu'elle a créé, et ceux qu'elle nomme (déplacés, rangés, reliés, branchés)
  function cibles(t, i) {
    const a = t.actions[i], g = a.args || {};
    const r = (t.results || [])[i] || {};
    const map = (ref) => (NEW.test(ref || '') ? t.ids?.[ref] : ref);
    const named = [...(g.ids || []), ...(g.autour || []), g.de, g.vers, ...(g.refs || []).filter((x) => !ITEM.test(x)), a.id].map(map);
    return [...new Set([...(r.made || r.ids || []), ...named].filter((id) => id && app.node(id)))];
  }

  // ── les pièces citées ────────────────────────────────────
  const thumbOf = (it) => it && (it.view_urls?.['256'] || it.thumb_url || (it.kind === 'image' ? it.url : null));
  function pieceOf(id) {
    const n = app.node(id);
    if (n) {
      const it = n.type === 'media' ? S.items.get(n.item) : null;
      return { id, label: app.label(n), kind: n.type === 'media' ? n.kind : n.type, it, type: n.type };
    }
    const it = S.items.get(id) || A.seen.get(id);
    return it ? { id, label: it.title || id, kind: it.kind, it } : null;
  }
  function addPieces(list) {
    const d = draft();
    let over = 0;
    for (const p of list) {
      if (!p || d.pieces.some((x) => x.id === p.id)) continue;
      if (d.pieces.length >= MAX_PIECES) { over++; continue; }
      d.pieces.push(p);
    }
    if (over) toast(`${MAX_PIECES} pièces au plus par message : ${plural(over, 'pièce')} de trop`, 6000);
    paintDraft();
  }
  function addItems(items) {
    for (const it of items) { A.seen.set(it.id, it); if (!S.items.has(it.id)) S.items.set(it.id, it); }
    addPieces(items.map((it) => ({ id: it.id, label: it.title || it.id, kind: it.kind, it })));
  }
  function cite(ids) {
    if (!S.board) return;
    if (!A.open) setOpen(true, { focus: false });
    addPieces(ids.map(pieceOf));
    setTimeout(() => ta.focus({ preventScroll: true }), 30);
  }
  const TYPE_FR = { note: 'note', sticky: 'post-it', title: 'titre', frame: 'cadre', group: 'groupe', gen: 'carte image', vgen: 'carte vidéo', compose: 'composeur' };
  function pieceEl(p, { remove = null, small = false } = {}) {
    const src = thumbOf(p.it);
    const kind = p.it ? kindMark(p.it, { compact: true }) : el('span', { class: 'ag-pck' }, TYPE_FR[p.kind] || kindFr(p.kind) || p.kind || '?');
    return el('div', { class: `ag-pc${src ? '' : ' txt'}${small ? ' sm' : ''}`, title: `${p.label} — ${p.it ? kindFr(p.kind) : TYPE_FR[p.kind] || p.kind}` },
      src ? el('img', { src: href(src), alt: '', loading: 'lazy', decoding: 'async' }) : el('span', { class: 'ag-pct' }, cut(p.label, small ? 18 : 36)),
      kind,
      remove ? el('button', { class: 'ag-pcx', type: 'button', 'aria-label': `retirer « ${p.label} »`, title: 'retirer', onclick: remove }, '×') : null);
  }

  // ── le dessin ────────────────────────────────────────────
  function paintDraft() {
    const d = draft();
    if (ta.value !== d.text) ta.value = d.text;
    pcs.replaceChildren(...d.pieces.map((p) => pieceEl(p, { remove: () => { d.pieces = d.pieces.filter((x) => x !== p); paintDraft(); ta.focus({ preventScroll: true }); } })));
    pcs.hidden = !d.pieces.length;
    grow();
    paintSend();
  }
  function grow() { ta.style.height = 'auto'; ta.style.height = `${Math.min(220, ta.scrollHeight)}px`; }
  function paintSend() {
    const q = A.open && openQuestions(), pl = A.open && !q && activePlan();
    ta.placeholder = q ? 'Réponds ici en toutes lettres, ou dis ce qui compte — les choix sont au-dessus'
      : pl && pl.plan.etat === 'propose' ? 'Dis ce qui change dans le plan : il le refait'
        : 'Demande à Showrunner — glisse ici des assets, des objets de la planche';
    const w = sendWhy();
    bSend.disabled = !!w;
    bSend.title = w || 'envoyer · Entrée (Maj+Entrée : à la ligne)';
    why.textContent = w && w !== 'écris ta demande' ? w : '';
    const n = S.sel.size;
    bSel.hidden = !n || !S.board;
    bSel.textContent = n ? `citer la sélection · ${n}` : '';
  }
  function paintEngine() {
    const e = A.conv?.engine;
    const [cls, txt, tip] = A.err ? ['err', 'injoignable', A.err]
      : !e ? ['', '—', ''] : e.ready ? ['on', e.vision ? 'prêt' : 'prêt · sans vision', `${e.model} · ${e.lane === 'audio' ? 'sur la voie audio, par la file' : 'par la file'}`] : ['err', 'pas prêt', e.why];
    engine.className = `pill ag-eng ${cls}`;
    engine.lastChild.textContent = txt;
    engine.title = tip;
  }
  // `end` : descendre au dernier message (un envoi) ; sinon le fil reste où on le lit, sauf s'il était en bas
  function paint(end = false) {
    paintEngine();
    paintSend();
    if (!A.open) return;
    paintCarnet();
    const atEnd = end || fil.scrollHeight - fil.scrollTop - fil.clientHeight < 40;
    const turns = (S.board && A.conv && A.bid === S.board.id) ? A.conv.turns : [];
    if (!turns.length) {
      A.els.clear();
      fil.replaceChildren(emptyEl());
      return;
    }
    // un palier d'arrière-plan est à sa place dans le fil : sous son tour tant qu'il travaille, à l'heure où il est
    // arrivé ensuite (les heures du serveur, ISO : elles se trient comme des textes)
    const items = turns.map((t) => ({ ts: t.at || '', t }));
    for (const p of A.conv.paliers || []) items.push({ ts: (ACTIVE.has(p.state) ? p.at : p.fini || p.at) || '', p });
    items.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    const busy = !!(A.conv?.busy || A.flying.size);
    const lastId = turns.at(-1)?.id;
    const oq = openQuestions()?.id, ap = activePlan();
    const kids = [];
    for (const { t, p } of items) {
      if (p) {
        const key = JSON.stringify([p.state, p.annonce, p.avance, p.job_state?.message, p.job_state?.state, p.why]);
        let c = A.els.get(p.id);
        if (!c || c.key !== key) { c = { key, el: palierEl(p) }; A.els.set(p.id, c); }
        kids.push(c.el);
        continue;
      }
      const key = JSON.stringify([t.state, t.claimed, t.applied, t.undone, t.job_state, t.results?.map((r) => r.text), A.flying.has(t.id), A.inv.has(t.id), t.error, S.board?.id,
        t.reception?.text, t.questions?.map((q) => q.id), t.answered_by, t.plan, oq === t.id, ap?.id === t.id, ap?.plan?.fait, busy, lastId === t.id]);
      let c = A.els.get(t.id);
      if (!c || c.key !== key) { c = { key, el: turnEl(t) }; A.els.set(t.id, c); }
      kids.push(c.el);
    }
    if (kids.length !== fil.children.length || kids.some((k, i) => fil.children[i] !== k)) fil.replaceChildren(...kids);
    if (atEnd) fil.scrollTop = fil.scrollHeight;
  }
  function emptyEl() {
    if (!S.board) return el('p', { class: 'ag-empty' }, 'Ouvrez une planche : Showrunner travaille sur elle.');
    return el('div', { class: 'ag-intro' },
      el('p', {}, 'Showrunner lit la planche, les documents et les images que tu lui cites, puis il pose ses gestes sur la planche : chacun est listé sous sa réponse, un clic le montre, « Annuler ce tour » les défait d’un coup.'),
      el('p', {}, 'Il ne lance jamais un rendu sans toi : une carte Générer est posée prête, son bouton reste le tien.'),
      el('div', { class: 'ag-sugg' }, ...SUGGEST.map((s) => el('button', { class: 'ag-chip', type: 'button', onclick: () => { ta.value = s; draft().text = s; grow(); paintSend(); ta.focus(); } }, s))));
  }
  function turnEl(t) {
    const u = t.user || {};
    const mineName = A.me && t.by && t.by !== A.me.id ? t.by_name : '';
    const all = u.items || [];
    const cites = all.slice(0, 12).map((c) => pieceEl({ id: c.id, label: c.title || c.id, kind: c.kind, it: S.items.get(c.id) || A.seen.get(c.id) || null }, { small: true }));
    if (all.length > 12) cites.push(el('span', { class: 'ag-pc sm txt ag-plus', title: `${all.length} pièces citées` }, el('span', { class: 'ag-pct' }, `+${all.length - 12}`)));
    const text = u.content || (t.intent === 'ingest' ? 'Commencer le projet (pas de brief écrit).' : t.intent === 'plan' && !t.answers?.length ? 'Vas-y avec ce que tu as.' : '');
    const said = (t.answers || []).map((a) => el('li', {}, el('span', { class: 'ag-qa-q' }, a.question), ' ', [...(a.choix || []), a.autre].filter(Boolean).join(' · ')));
    const userEl = el('div', { class: 'ag-u' },
      cites.length ? el('div', { class: 'ag-ucites' }, ...cites) : null,
      said.length ? el('ul', { class: 'ag-qa' }, ...said) : null,
      text ? el('div', { class: 'ag-ut' + (text.length > 420 ? ' long' : ''), title: text.length > 420 ? text.slice(0, 1500) : null }, text) : null,
      el('div', { class: 'ag-meta' }, [{ ingest: 'commencer un projet', plan: t.answers?.length ? 'réponses' : 'plan', etape: 'étape' }[t.intent] || '', mineName, hhmm(t.at)].filter(Boolean).join(' · ')));
    return el('div', { class: 'ag-turn', 'data-turn': t.id }, userEl, answerEl(t));
  }
  function answerEl(t) {
    const out = el('div', { class: 'ag-a' });
    const rec = receptionEl(t);
    if (rec) out.append(rec);
    if (ACTIVE.has(t.state)) {
      const j = t.job_state || {};
      const queued = (j.state || t.state) === 'queued';
      const txt = queued
        ? `en file${j.ahead ? ` · ${j.ahead} devant` : ''}${j.eta_s ? ` · départ ≈ ${fmtWait(j.eta_s)}` : ''}`
        : j.message || 'réfléchit';
      if (!queued && !A.run0.has(t.id)) A.run0.set(t.id, Date.now());
      out.append(el('div', { class: 'ag-run' }, el('i', { class: 'ag-dot' }), el('span', { class: 'ag-runt' }, txt,
        queued ? null : el('span', { class: 'ag-secs', 'data-t': t.id }, secs(t.id))),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'arrêter ce tour', onclick: () => stop(t) }, 'Arrêter')));
      if (Number.isFinite(j.progress) && j.progress > 0) out.append(el('div', { class: 'ag-bar' }, el('i', { style: { width: `${Math.round(j.progress * 100)}%` } })));
      return out;
    }
    if (t.state !== 'done') {
      const msg = t.state === 'cancelled' ? 'tour arrêté' : t.state === 'interrupted' ? 'tour interrompu : le portail a redémarré' : `échec : ${t.error || 'le tour n’a pas abouti'}`;
      out.append(el('p', { class: 'ag-err' }, msg),
        el('div', { class: 'ag-foot' }, el('button', { class: 'tb ghost sm', type: 'button', title: 'remettre cette demande dans le champ', onclick: () => redo(t) }, 'Reprendre la demande')));
      return out;
    }
    if (t.reply) out.append(el('div', { class: 'ag-reply' }, t.reply));
    const reads = (t.reads || []).map((r) => (r.tool === 'lire_planche' ? 'la planche' : r.tool === 'apercu' ? r.note : r.tool === 'chercher_bibliotheque' ? `cherché « ${r.args?.q || ''} » (${r.note})` : `« ${r.note} »`));
    if (reads.length) out.append(el('p', { class: 'ag-reads' }, `a lu : ${[...new Set(reads)].join(' · ')}`));
    const contra = contraEl(t);
    if (contra) out.append(contra);
    if (t.questions?.length) out.append(questionsEl(t));
    if (t.plan?.etapes?.length) out.append(planEl(t));
    if (t.noted?.length) out.append(el('p', { class: 'ag-reads' }, `noté au carnet : ${t.noted.map((id) => (A.conv?.decisions || []).find((d) => d.id === id)?.text).filter(Boolean).join(' · ')}`));
    const suite = suiteEl(t);
    const acts = t.actions || [];
    if (!acts.length) { if (suite) out.append(suite); return out; }
    const applied = !!t.applied || (t.results || []).length > 0;
    out.append(el('ol', { class: 'ag-acts' + (t.undone ? ' undone' : '') }, ...acts.map((a, i) => {
      const r = (t.results || [])[i];
      const text = r ? r.text : `${planText(t, a)}`;
      const bad = r && !r.ok;
      return el('li', {}, el('button', { class: 'ag-act' + (bad ? ' bad' : '') + (r ? '' : ' plan'), type: 'button', disabled: !applied || t.undone,
        title: !applied ? 'pas encore posé' : t.undone ? 'ce tour est défait' : 'voir sur la planche', onclick: () => montrer(cibles(t, i)) },
      el('span', { class: 'ag-actt' }, text), a.why ? el('span', { class: 'ag-actw' }, a.why) : null));
    })));
    const foot = el('div', { class: 'ag-foot' });
    const meta = el('span', { class: 'ag-meta' }, [plural(acts.length, 'geste'), t.seconds ? `${t.seconds} s` : ''].filter(Boolean).join(' · '));
    if (t.undone) {
      foot.append(el('span', { class: 'ag-meta' }, 'défait'), el('span', { class: 'sp' }),
        A.posed.has(t.id) ? el('button', { class: 'tb ghost sm', type: 'button', title: 'poser à nouveau les gestes de ce tour', onclick: () => reposer(t) }, 'Reposer') : null);
    } else if (applied) {
      foot.append(meta, el('span', { class: 'sp' }), el('button', { class: 'tb ghost sm', type: 'button', title: 'défaire tout ce tour d’un coup', onclick: () => defaire(t) }, 'Annuler ce tour'));
    } else if (!t.claimed && !A.flying.has(t.id)) {
      foot.append(meta, el('span', { class: 'sp' }), el('button', { class: 'tb ghost sm', type: 'button', title: 'ce tour a fini sans être posé (la page qui l’attendait a été fermée ?) : le poser ici', onclick: () => appliquer(t) }, 'Poser ces gestes'));
    } else if (t.claimed) {
      foot.append(el('span', { class: 'ag-meta' }, 'posés ailleurs : un autre onglet, une autre personne'));
    } else foot.append(meta);
    out.append(foot);
    if (suite) out.append(suite);
    return out;
  }
  // le texte d'une action pas encore posée, d'après ses arguments
  function planText(t, a) {
    const g = a.args || {};
    const lab = (ref) => {
      if (NEW.test(ref || '')) { const b = t.actions.find((x) => x.id === ref); return b ? cut(b.args?.texte || b.args?.nom || b.args?.prompt || 'posé plus haut', 28) : 'posé plus haut'; }
      const n = app.node(ref);
      return n ? cut(app.label(n), 28) : S.items.get(ref)?.title || ref;
    };
    const where = g.dans ? ` dans « ${lab(g.dans)} »` : g.pres_de ? ` près de « ${lab(g.pres_de)} »` : '';
    switch (a.tool) {
      case 'poser_texte': return `poser ${{ note: 'une note', postit: 'un post-it', titre: 'un titre' }[g.sorte] || 'une note'} « ${cut(g.texte, 60)} »${where}`;
      case 'poser_cadre': return `poser le cadre « ${g.nom} »${g.autour ? ` autour de ${plural(g.autour.length, 'objet')}` : where}`;
      case 'poser_asset': return `poser « ${lab(g.item)} »${where}`;
      case 'carte_image': return `poser une carte Générer image${g.refs?.length ? `, branchée sur ${g.refs.map((r) => `« ${lab(r)} »`).join(', ')}` : ''}${where}`;
      case 'carte_video': return `poser une carte Générer vidéo${g.image ? `, première image « ${lab(g.image)} »` : ''}${where}`;
      case 'composeur': return `poser un composeur de prompt${g.vers ? ` branché sur « ${lab(g.vers)} »` : ''}${where}`;
      case 'relier': return `relier « ${lab(g.de)} » → « ${lab(g.vers)} »`;
      case 'renommer_planche': return `renommer la planche « ${g.nom} »`;
      case 'grouper': return `grouper ${plural((g.ids || []).length, 'objet')}`;
      case 'ranger': return `ranger ${plural((g.ids || []).length, 'objet')} en ${DISP[g.disposition] || 'grille'}${where}`;
      case 'deplacer': return `déplacer ${plural((g.ids || []).length, 'objet')}${where}`;
      default: return a.tool;
    }
  }
  // ── l'entrée d'un projet : la réception, les questions, le plan, les paliers, le carnet (06/10) ──
  // les questions encore ouvertes : celles du dernier tour d'entrée, fini, auxquelles on n'a pas répondu
  function openQuestions() {
    const t = [...(A.conv?.turns || [])].reverse().find((x) => x.intent === 'ingest');
    return t && t.state === 'done' && t.questions?.length && !t.answered_by ? t : null;
  }
  // le plan vivant : le dernier proposé ou accepté (un plan neuf remplace l'ancien, au serveur)
  function activePlan() {
    const t = [...(A.conv?.turns || [])].reverse().find((x) => x.plan?.etapes?.length);
    return t && ['propose', 'accepte'].includes(t.plan.etat) ? t : null;
  }
  const qsel = (t) => { if (!A.qsel.has(t.id)) A.qsel.set(t.id, {}); return A.qsel.get(t.id); };
  function answersOf(t) {
    const sel = qsel(t);
    return (t.questions || []).map((q) => ({ id: q.id, choix: [...(sel[q.id]?.choix || [])], autre: (sel[q.id]?.autre || '').trim() }))
      .filter((a) => a.choix.length || a.autre);
  }
  const secs = (tid) => (A.run0.has(tid) ? ` · ${Math.max(0, Math.round((Date.now() - A.run0.get(tid)) / 1000))} s` : '');
  // les secondes d'un tour qui tourne : le texte seul change, une fois par seconde (rien n'est redessiné)
  setInterval(() => { if (A.open) for (const n of fil.querySelectorAll('.ag-secs')) n.textContent = secs(n.dataset.t); }, 1000);

  // « J'ai bien reçu… » : l'inventaire du serveur, et la liste des noms à déplier
  function receptionEl(t) {
    const r = t.reception;
    if (!r?.text) return null;
    const noms = Object.entries(r.noms || {});
    return el('div', { class: 'ag-recu' }, el('p', {}, r.text),
      noms.length ? el('details', { class: 'ag-det' }, el('summary', {}, 'la liste'),
        el('ul', {}, ...noms.map(([k, l]) => el('li', {}, el('b', {}, `${kindFr(k)} · ${r.counts?.[k] ?? l.length}`), ' ',
          `${l.join(' · ')}${(r.counts?.[k] || 0) > l.length ? ' …' : ''}`)))) : null);
  }
  // ce qui ne colle pas : dit à voix haute, jamais lissé (Fondations II)
  const contraEl = (t) => (t.contradictions?.length ? el('div', { class: 'ag-contra', role: 'note' },
    el('b', { class: 'ag-lab' }, 'ce qui ne colle pas'), ...t.contradictions.map((c) => el('p', {}, c))) : null);

  // les questions : des choix cliquables (un seul, ou plusieurs), « autre » en texte libre ; Répondre, ou y aller sans
  function questionsEl(t) {
    const open = openQuestions()?.id === t.id;
    const given = open ? null : A.conv?.turns.find((x) => x.id === t.answered_by)?.answers || [];
    const sel = qsel(t);
    const busy = !!(A.conv?.busy || A.flying.size);
    const bAns = el('button', { class: 'tb on sm', type: 'button', onclick: () => repondre(t) }, 'Répondre');
    const bGo = el('button', { class: 'tb ghost sm', type: 'button', title: 'il propose un plan avec ce qu’il a : tu pourras le changer', onclick: () => repondre(t, true) }, 'Vas-y sans répondre');
    const qwhy = el('span', { class: 'ag-why' });
    const paintFoot = () => {
      const n = answersOf(t).length;
      const w = busy ? 'un tour est en cours : attends sa réponse' : !n ? 'choisis une réponse, ou écris-la (autre)' : '';
      bAns.disabled = !!w; bAns.title = w || `envoyer ${plural(n, 'réponse')} : il propose ensuite un plan court`;
      bGo.disabled = busy; qwhy.textContent = w && n ? w : '';
    };
    const box = el('div', { class: 'ag-qs' + (open ? '' : ' closed') });
    for (const q of t.questions) {
      const s = sel[q.id] || (sel[q.id] = { choix: new Set(), autre: '' });
      const g = given?.find((a) => a.id === q.id);
      const opts = el('div', { class: 'ag-opts', role: q.plusieurs ? 'group' : 'radiogroup', 'aria-label': q.question });
      for (const c of q.choix) {
        const on = open ? s.choix.has(c) : !!g?.choix?.includes(c);
        const b = el('button', { class: 'ag-chip ag-opt' + (on ? ' on' : ''), type: 'button', role: q.plusieurs ? 'checkbox' : 'radio',
          'aria-checked': on ? 'true' : 'false', disabled: !open, onclick: () => {
            if (q.plusieurs) { if (s.choix.has(c)) s.choix.delete(c); else s.choix.add(c); } else { const was = s.choix.has(c); s.choix.clear(); if (!was) s.choix.add(c); }
            for (const x of opts.children) { const v = s.choix.has(x.textContent); x.classList.toggle('on', v); x.setAttribute('aria-checked', v ? 'true' : 'false'); }
            paintFoot();
          } }, c);
        opts.append(b);
      }
      const autre = open ? el('input', { class: 'fld ag-autre', type: 'text', maxlength: 400, value: s.autre, placeholder: 'autre : écris-le',
        'aria-label': `autre réponse : ${q.question}`, oninput: (e) => { s.autre = e.target.value; paintFoot(); },
        onkeydown: (e) => { if (e.key === 'Enter' && !bAns.disabled) { e.preventDefault(); repondre(t); } } })
        : g?.autre ? el('p', { class: 'ag-autre-dit' }, g.autre) : null;
      box.append(el('div', { class: 'ag-q' },
        el('p', { class: 'ag-qt' }, q.question, q.palier ? el('span', { class: 'ag-meta' }, ` · après ${q.palier === 'images' ? 'les images' : 'les sons'}`) : null,
          q.plusieurs && open ? el('span', { class: 'ag-meta' }, ' · plusieurs choix') : null),
        opts, autre));
    }
    if (open) { paintFoot(); box.append(el('div', { class: 'ag-foot' }, qwhy, el('span', { class: 'sp' }), bGo, bAns)); }
    else box.append(el('p', { class: 'ag-meta' }, t.answered_by ? 'répondu' : 'questions closes'));
    return el('div', { class: 'ag-qcard' }, el('b', { class: 'ag-lab' }, open ? 'avant de commencer' : 'les questions'), box);
  }
  async function repondre(t, go = false) {
    const answers = go ? [] : answersOf(t);
    if (!go && !answers.length) return;
    try {
      const r = await post(go ? 'Vas-y avec ce que tu as.' : '', { intent: 'plan', questions_turn: t.id, answers });
      follow(r.bid, r.turn, r.job).catch((e) => toast(`Showrunner : ${e.message}`, 8000));
    } catch (e) { toast(`Showrunner : ${e.message}`, 8000); load(); }
  }

  // le plan : ses étapes et ce que chacune posera ; Accepter (l'étape 1 part), Changer (le champ), Refuser
  function planEl(t) {
    const p = t.plan;
    const live = activePlan()?.id === t.id;
    const busy = !!(A.conv?.busy || A.flying.size);
    const fait = p.fait || 0;
    const ol = el('ol', { class: 'ag-plan' }, ...p.etapes.map((e, i) => el('li', { class: i < fait ? 'fait' : '' },
      el('b', {}, e.titre), el('span', {}, e.pose))));
    const etat = { propose: 'proposé : à toi de dire', accepte: `accepté · ${fait}/${p.etapes.length} faite${fait > 1 ? 's' : ''}`,
      refuse: 'refusé', remplace: 'remplacé par un plan plus récent' }[p.etat] || '';
    const foot = el('div', { class: 'ag-foot' }, el('span', { class: 'ag-meta' }, etat), el('span', { class: 'sp' }));
    if (live && p.etat === 'propose') {
      const w = busy ? 'un tour est en cours : attends sa réponse' : '';
      foot.append(
        el('button', { class: 'tb ghost sm', type: 'button', disabled: !!w, title: w || 'non : le carnet le note, rien ne se fait', onclick: () => refuser(t) }, 'Refuser'),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'dis ce qui change dans le champ : il refait le plan', onclick: () => changer() }, 'Changer'),
        el('button', { class: 'tb on sm', type: 'button', disabled: !!w, title: w || `accepter, et faire l’étape 1 : ${p.etapes[0].titre}`, onclick: () => etape(t, 0) }, 'Accepter · étape 1'));
    }
    return el('div', { class: 'ag-plancard' + (live ? '' : ' off') }, el('b', { class: 'ag-lab' }, 'le plan'), ol, foot);
  }
  // l'étape suivante : au bas du dernier tour (le plan accepté, ou la dernière étape faite)
  function suiteEl(t) {
    const pt = activePlan();
    const turns = A.conv?.turns || [];
    if (!pt || pt.plan.etat !== 'accepte' || turns.at(-1)?.id !== t.id || !['etape', 'plan'].includes(t.intent) || ACTIVE.has(t.state)) return null;
    if (t.intent === 'etape' && t.plan_turn !== pt.id) return null;
    const k = pt.plan.fait || 0, n = pt.plan.etapes.length;
    if (k >= n) return el('p', { class: 'ag-reads' }, 'le plan est fait : dis-moi la suite');
    const busy = !!(A.conv?.busy || A.flying.size);
    const redo = t.intent === 'etape' && t.undone && t.etape === k;
    return el('div', { class: 'ag-suite' }, el('span', { class: 'ag-suitet' }, `${redo ? 'refaire l’' : ''}étape ${k + 1}/${n} : ${pt.plan.etapes[k].titre}`),
      el('button', { class: 'tb on sm', type: 'button', disabled: busy, title: busy ? 'un tour est en cours : attends sa réponse' : pt.plan.etapes[k].pose,
        onclick: () => etape(pt, k) }, redo ? 'Refaire' : 'Faire cette étape'));
  }
  async function etape(pt, k) {
    try {
      const r = await post('', { intent: 'etape', plan_turn: pt.id, etape: k });
      follow(r.bid, r.turn, r.job).catch((e) => toast(`Showrunner : ${e.message}`, 8000));
    } catch (e) { toast(`Showrunner : ${e.message}`, 8000); load(); }
  }
  async function refuser(pt) {
    try { await api(`ideation/agent/${S.board.id}/turns/${pt.id}`, { method: 'POST', body: { plan: 'refuse' } }); } catch (e) { toast(e.message, 6000); }
    load();
  }
  function changer() {
    const d = draft();
    if (!d.text) { d.text = 'Change le plan : '; paintDraft(); }
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  // un palier d'arrière-plan : en cours (ce qu'il fait, Arrêter), arrivé (sa ligne, ce qu'est chaque pièce), ou pas parti (pourquoi)
  function palierEl(p) {
    const what = { images: 'les images', sons: 'les sons' }[p.palier] || p.palier;
    const where = p.machine ? ` · ${p.machine}` : '';
    if (ACTIVE.has(p.state)) {
      const j = p.job_state || {};
      const txt = p.palier === 'sons' ? `transcription par Transcrire${p.avance ? ` · ${p.avance}` : ''}`
        : j.state === 'queued' ? `en file${j.ahead ? ` · ${j.ahead} devant` : ''} (la conversation passe devant)` : j.message || 'en cours';
      return el('div', { class: 'ag-pal run' }, el('i', { class: 'ag-dot' }), el('span', { class: 'ag-palt' }, `${what}${where} · ${txt}`),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'arrêter ce palier (la conversation continue)', onclick: () => stopPalier(p) }, 'Arrêter'));
    }
    if (p.state === 'done') {
      return el('div', { class: 'ag-pal done' }, el('b', { class: 'ag-lab' }, `${what} · arrivés${where}`), el('p', {}, p.annonce),
        p.question_libre ? el('p', { class: 'ag-palq' }, `Une question de plus : ${p.question_libre}`) : null,
        p.pieces?.length ? el('details', { class: 'ag-det' }, el('summary', {}, plural(p.pieces.length, 'pièce')),
          el('ul', {}, ...p.pieces.map((x) => el('li', {}, el('b', {}, x.titre), ' ', x.note)))) : null);
    }
    const no = { images: 'pas regardées', sons: 'pas transcrits' }[p.palier] || 'pas lus';
    return el('div', { class: 'ag-pal off' }, el('span', {}, `${what} : ${p.state === 'skipped' ? no : p.state === 'cancelled' ? 'arrêtés' : 'en échec'}${p.why ? ` — ${p.why}` : ''}`));
  }
  async function stopPalier(p) {
    try { await api(`ideation/agent/${S.board.id}/paliers/${p.id}`, { method: 'POST', body: { stop: true } }); toast('palier arrêté'); } catch (e) { toast(e.message, 6000); }
    load();
  }

  // le carnet : les décisions de la conversation (la scripte), que l'agent relit à chaque tour ; la personne en retire
  // une qui ne tient plus, ou en écrit une
  const carnetIn = el('input', { class: 'fld ag-cin', type: 'text', maxlength: 240, placeholder: 'noter une décision', 'aria-label': 'noter une décision au carnet' });
  carnetIn.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !carnetIn.value.trim() || !S.board) return;
    e.preventDefault();
    try { const r = await api(`ideation/agent/${S.board.id}/decisions`, { method: 'POST', body: { texte: carnetIn.value.trim() } }); carnetIn.value = ''; if (A.conv) A.conv.decisions = r.decisions; paintCarnet(true); } catch (err) { toast(err.message, 6000); }
  });
  const BY = { 'réponse': 'ta réponse', agent: 'entendu', plan: 'le plan', personne: 'écrit à la main' };
  function paintCarnet(force = false) {
    const conv = S.board && A.conv && A.bid === S.board.id ? A.conv : null;
    const ds = conv?.decisions || [];
    carnet.hidden = !conv || (!conv.turns.length && !ds.length);
    if (carnet.hidden) return;
    const key = JSON.stringify([ds.map((d) => [d.id, d.text]), A.carnet]);
    if (!force && carnet.dataset.key === key) return;
    carnet.dataset.key = key;
    const head = el('button', { class: 'ag-ch', type: 'button', 'aria-expanded': A.carnet ? 'true' : 'false', title: 'les décisions de la conversation : l’agent les relit à chaque tour',
      onclick: () => { A.carnet = !A.carnet; app.LS('agent-carnet', A.carnet); paintCarnet(true); } },
    el('b', { class: 'ag-lab' }, 'carnet'), el('span', {}, ds.length ? plural(ds.length, 'décision') : 'aucune décision'), el('i', { class: 'ag-car' }, A.carnet ? '−' : '+'));
    const body = A.carnet ? el('div', { class: 'ag-cbody' },
      ds.length ? el('ol', { class: 'ag-clist' }, ...ds.map((d) => el('li', {}, el('span', { class: 'ag-ct' }, d.text),
        el('span', { class: 'ag-meta' }, BY[d.by] || d.by || ''),
        el('button', { class: 'ag-pcx ag-cx', type: 'button', title: 'retirer : cette décision ne tient plus', 'aria-label': `retirer « ${d.text} »`, onclick: async () => {
          try { const r = await api(`ideation/agent/${S.board.id}/decisions`, { method: 'POST', body: { retirer: d.id } }); A.conv.decisions = r.decisions; paintCarnet(true); } catch (err) { toast(err.message, 6000); }
        } }, '×')))) : el('p', { class: 'ag-empty' }, 'Tes réponses, le plan accepté et ce que tu décides dans la conversation s’écrivent ici.'),
      carnetIn) : null;
    carnet.replaceChildren(head, body || '');
  }

  // un tour défait, reposé (son jeton est celui de cette page : le serveur le laisse réclamer encore)
  async function reposer(t) {
    const cur = A.conv?.turns.find((x) => x.id === t.id) || t;
    await appliquer(cur, { lancer: false });
  }
  async function stop(t) {
    if (!t.job) return;
    try { await jobs.cancel(t.job); toast('tour arrêté'); } catch (e) { toast(e.message, 6000); }
    load();
  }
  function redo(t) {
    const d = draft();
    d.text = t.user?.content || '';
    d.pieces = (t.user?.items || []).map((c) => pieceOf(c.node || c.id) || { id: c.id, label: c.title || c.id, kind: c.kind }).filter(Boolean);
    paintDraft();
    ta.focus();
  }

  // ── les gestes du panneau ────────────────────────────────
  ta.addEventListener('input', () => { draft().text = ta.value; grow(); paintSend(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); fromComposer(); }
    if (e.key === 'Escape') { e.preventDefault(); ta.blur(); }
  });
  // coller un fichier (une capture d'écran) : il entre dans la bibliothèque, puis dans les pièces
  ta.addEventListener('paste', async (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    const got = [];
    for (const f of files) {
      toast(`dépôt · ${f.name}`, 60000);
      try { got.push(await uploadFile(f, { tool: 'upload', via: 'ideation' })); } catch (err) { toast(`${f.name} : ${err.message}`, 7000); }
    }
    if (got.length) { toast(got.length > 1 ? `${got.length} fichiers rangés dans la bibliothèque · Upload` : 'rangé dans la bibliothèque · Upload'); addItems(got); }
  });
  bSend.addEventListener('click', () => fromComposer());
  bAttach.addEventListener('click', async () => {
    const got = await pick({ kinds: KINDS, multiple: true, title: 'Citer dans la discussion' });
    if (got?.length) addItems(got);
  });
  bSel.addEventListener('click', () => cite([...S.sel]));
  let armed = 0;
  bNew.addEventListener('click', async () => {
    if (!S.board) return;
    if (!armed) { armed = setTimeout(() => { armed = 0; bNew.textContent = 'Nouvelle'; }, 3000); bNew.textContent = 'Confirmer'; return; }
    clearTimeout(armed); armed = 0; bNew.textContent = 'Nouvelle';
    try { await api(`ideation/agent/${S.board.id}/clear`, { method: 'POST', body: {} }); A.inv.clear(); A.els.clear(); load(); } catch (e) { toast(e.message, 6000); }
  });
  // déposer : un asset du panneau Asset, un fichier du disque (rangé d'abord dans la bibliothèque)
  dropZone(box, { kinds: KINDS, via: 'ideation', label: 'le champ de Showrunner', onitems: (items) => addItems(items) });
  // un objet de la planche lâché sur le champ (canvas.js, app.dropOut) : cité, il revient à sa place
  const overBox = (ev) => { if (panel.hidden) return false; const r = box.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom; };
  const before = app.dropOut;
  app.dropOut = (moving, ev) => {
    if (!overBox(ev)) return before ? before(moving, ev) : false;
    const units = [...S.sel].filter((id) => app.node(id));
    cite(units.length ? units : moving.map((n) => n.id));
    box.classList.remove('drop-on');
    return true;
  };
  const hover = (ev) => box.classList.toggle('drop-on', overBox(ev));
  app.on('moving', (list) => {
    if (list?.length && !panel.hidden) addEventListener('pointermove', hover);
    else { removeEventListener('pointermove', hover); box.classList.remove('drop-on'); }
  });
  app.on('board', () => { A.conv = null; A.els.clear(); paintDraft(); load(); });
  app.on('selection', () => paintSend());
  // la touche I (hors d'un champ, d'une fenêtre, de la présentation)
  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'i' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.target?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
    if (document.querySelector('.scrim, .sr-menu') || document.body.classList.contains('at-presenting') || btn.offsetParent === null) return;
    e.preventDefault();
    setOpen(!A.open);
  });
  // la palette de commandes (⌘K) de l'atelier
  import('./atelier/socle.js').then(({ atelier }) => atelier(app).command({ order: 8, label: 'Showrunner', sub: 'l’agent de la planche', key: 'I', run: () => setOpen(true) }))
    .catch(() => { /* l'atelier absent : le bouton et la touche suffisent */ });

  app.agent = {
    open: () => setOpen(true),
    close: () => setOpen(false),
    isOpen: () => A.open,
    send,
    busy: () => !!(A.flying.size || (A.conv && A.bid === S.board?.id && A.conv.busy)),
    cite,
    // « Citer dans la discussion » : le clic droit d'un objet, d'une sélection (menus.js)
    menuItems: (list) => (list?.length ? [{ label: 'Citer dans la discussion', sub: 'Showrunner', studio: true, onclick: () => cite(list.map((n) => n.id)) }] : []),
  };
  setOpen(A.open, { focus: false });
}
