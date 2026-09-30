// IDÉATION — enregistrer le son de la visio (30/09/2026), greffé par collab.js.
// Demande de Cal : « le mode visio dans l'Idéation doit proposer l'enregistrement
// audio, et on pourra décider de le transcrire et de le résumer par exemple ».
//
// Le consentement se voit chez chacun : qui enregistre le dit dans sa présence
// (`call.rec`, server/tools/ideation_collab.py) ; tous ceux qui sont sur la planche
// voient le voyant ENREGISTREMENT dans la barre (avec qui enregistre), dans le
// bandeau de l'appel et dans l'onglet Visio, et une ligne quand il commence. Rien
// ne s'enregistre hors de l'appel, ni en cachette : arrêter (ou quitter l'appel)
// éteint le voyant partout.
//
// Le son : le mélange de l'appel tel que je l'entends — mon micro et la piste son de
// chaque personne (le maillage pair à pair : je reçois tout le monde) — par Web Audio
// (MDN : `AudioContext.createMediaStreamSource`, une source par piste ;
// `createMediaStreamDestination`, « a MediaStream ... which can be recorded using
// MediaRecorder »), enregistré par `MediaRecorder` (MDN). Une personne qui arrive
// pendant l'enregistrement entre dans le mélange. Le format : un que la bibliothèque
// range en son (core/library.py, EXT_KIND et sniff) — MP4/Opus (.m4a, Chromium 126 et
// suivants), sinon Ogg/Opus (.ogg, Firefox) ; WebM serait rangé en vidéo : un
// navigateur qui n'a que lui le dit (le bouton éteint dit pourquoi, règle 7).
//
// À l'arrêt : le fichier entre dans la bibliothèque du Workspace de la planche
// (`uploadFile`, l'en-tête X-SR-Espace : `S.board.space`, rendu par GET de la planche),
// dossier Idéation ; une carte son se pose sur la planche (le bloc son d'objets/son.js) ;
// puis le choix : Transcrire, Transcrire et résumer, Plus tard. Les deux passent par
// l'accroche que l'outil Transcrire tient pour l'Idéation (server/tools/transcrire.py, en
// tête : « L'ACCROCHE POUR L'IDÉATION ») : POST /api/transcrire/run { item, mode,
// notes: ['resume', 'points'] } — la transcription, puis le carnet (résumé, points,
// décisions, actions) mis en file par elle ; on suit le document (GET …/docs/<id>). Le
// texte revient sur la planche, relié au son ; le résumé, relié au texte.

import { api, el, toast, href, jobs, uploadFile } from '../commun/shell.js';

// l'accroche de l'outil Transcrire, en un seul endroit
export const RUN = 'transcrire/run';
export const DOC = (tid) => `transcrire/docs/${tid}`;
const CARNET = ['resume', 'points'];
const TYPES = [['audio/mp4;codecs=opus', 'm4a'], ['audio/mp4', 'm4a'], ['audio/ogg;codecs=opus', 'ogg']];
const pad = (v) => String(v).padStart(2, '0');
const clock = (s) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;

export function supported() {
  if (typeof MediaRecorder !== 'function' || typeof AudioContext !== 'function') return null;
  return TYPES.find(([t]) => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || null;
}

// env : { K (l'appel : local, pcs), C (la planche à plusieurs : peers, me), sendCall(), repaint() }
export function createRecorder(app, env) {
  const { S } = app;
  const { K, C } = env;
  const R = { on: false, ctx: null, dest: null, mr: null, chunks: [], t0: 0, tick: 0, wired: new Set(), fmt: null, last: null, busy: '' };

  // pourquoi on ne peut pas enregistrer (vide : on peut)
  function why() {
    if (R.busy) return R.busy;
    if (!S.board) return 'ouvrez d’abord une planche';
    if (document.body.classList.contains('ide-guest')) return 'un invité ne range rien dans la bibliothèque : demandez à qui vous a invité d’enregistrer';
    if (!supported()) return 'ce navigateur n’enregistre le son ni en MP4 ni en Ogg (la bibliothèque range les sons en M4A, OGG…) : Chrome, Edge ou Firefox récents le font';
    if (!K.on) return 'rejoignez d’abord l’appel : on enregistre le son de l’appel';
    return '';
  }

  // les pistes son de l'appel : mon micro, et celle de chaque personne reçue
  function tracks() {
    const out = [];
    const a = K.local?.getAudioTracks()[0];
    if (a) out.push(a);
    for (const Q of K.pcs.values()) for (const t of Q.stream.getAudioTracks()) out.push(t);
    return out;
  }
  // brancher dans le mélange ce qui n'y est pas encore (quelqu'un arrive en cours de route)
  function sync() {
    if (!R.on || !R.ctx) return;
    for (const t of tracks()) {
      if (R.wired.has(t.id) || t.readyState === 'ended') continue;
      try {
        R.ctx.createMediaStreamSource(new MediaStream([t])).connect(R.dest);
        R.wired.add(t.id);
      } catch (e) { console.warn('enregistrer · piste', e); }
    }
  }

  async function start() {
    const w = why();
    if (w) { toast(w, 7000); return; }
    const [type, ext] = supported();
    R.fmt = { type, ext };
    R.ctx = new AudioContext();
    try { await R.ctx.resume(); } catch { /* un geste vient d'avoir lieu : il repart */ }
    R.dest = R.ctx.createMediaStreamDestination();
    R.wired = new Set();
    R.on = true;
    sync();
    R.chunks = [];
    try {
      R.mr = new MediaRecorder(R.dest.stream, { mimeType: type });
    } catch (e) { R.on = false; R.ctx.close(); toast(`enregistrer : ${e.message}`, 7000); return; }
    R.mr.ondataavailable = (ev) => { if (ev.data?.size) R.chunks.push(ev.data); };
    R.mr.onstop = () => finish();
    R.mr.start(1000);
    R.t0 = Date.now();
    clearInterval(R.tick);
    R.tick = setInterval(() => { sync(); env.repaint(); }, 1000);
    env.sendCall();   // le voyant, chez tout le monde
    env.repaint();
    toast('enregistrement du son de l’appel : chacun voit le voyant ENREGISTREMENT', 5000);
  }
  function stop() {
    if (!R.on) return;
    R.on = false;
    clearInterval(R.tick);
    env.sendCall();
    try { R.mr?.state !== 'inactive' ? R.mr.stop() : finish(); } catch { finish(); }
    env.repaint();
  }
  const seconds = () => (R.on ? (Date.now() - R.t0) / 1000 : 0);

  // l'arrêt : le fichier, la bibliothèque du Workspace de la planche, la carte son, le choix
  async function finish() {
    try { R.ctx?.close(); } catch { /* */ }
    R.ctx = null; R.dest = null;
    const blob = new Blob(R.chunks, { type: R.fmt?.type || 'audio/mp4' });
    R.chunks = [];
    const dur = (Date.now() - R.t0) / 1000;
    if (!blob.size || dur < 1) { toast('enregistrement trop court : rien n’est rangé', 5000); return; }
    const d = new Date(R.t0);
    const stamp = `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${pad(d.getHours())}h${pad(d.getMinutes())}`;
    const title = `Appel · ${S.board?.name || 'planche'} · ${stamp}`;
    const file = new File([blob], `appel-${d.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${R.fmt.ext}`, { type: R.fmt.type });
    const board = S.board;
    R.busy = 'l’enregistrement précédent se range dans la bibliothèque';
    env.repaint();
    let it;
    try {
      it = await uploadFile(file, { tool: 'ideation', via: 'visio', folder: 'Idéation', title, espace: board?.space || undefined });
    } catch (e) {
      R.busy = '';
      env.repaint();
      toast(`l’enregistrement n’a pas pu entrer dans la bibliothèque : ${e.message}`, 10000);
      return;
    }
    R.busy = '';
    R.last = { it };
    // la carte son, sur la planche qui était ouverte (au centre de la vue)
    let n = null;
    if (S.board && S.board.id === board?.id) {
      const [cx, cy] = app.canvas.center();
      n = app.placeItem(it, cx, cy, { free: true });
      R.last.node = n?.id || null;
    }
    app.lib?.reload?.();
    env.repaint();
    choose(it, n?.id || null);
  }

  // le choix, après l'arrêt : transcrire, transcrire et résumer, plus tard
  function choose(it, nodeId) {
    const body = el('div', { class: 'stack co-recdone' },
      el('p', {}, `« ${it.title} » est dans la bibliothèque (dossier Idéation${it.duration ? `, ${clock(it.duration)}` : ''}) et sur la planche.`),
      el('p', { class: 'hint' }, 'La transcription passe par l’outil Transcrire (le texte revient ici, relié au son). Le résumé suit la transcription.'),
      el('div', { class: 'row' }, el('a', { class: 'tb ghost sm', href: href(`asset/#${it.id}`), target: '_blank', rel: 'noopener' }, 'Dans Asset ↗')));
    const close = app.modal('Enregistrement rangé', body, (cl) => [el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost', type: 'button', onclick: cl }, 'Plus tard'),
      el('button', { class: 'tb ghost', type: 'button', onclick: () => { cl(); transcribe(it, nodeId, false); } }, 'Transcrire'),
      el('button', { class: 'tb on', type: 'button', onclick: () => { cl(); transcribe(it, nodeId, true); } }, 'Transcrire et résumer')]);
    return close;
  }

  // la route de l'outil Transcrire ; le texte, posé à droite du son, relié à lui
  async function transcribe(it, nodeId, summary) {
    let r;
    // l'accroche de Transcrire : la transcription, et, pour « résumer », le carnet qu'elle met en file
    try { r = await api(RUN, { method: 'POST', body: { item: it.id, mode: 'rapide', ...(summary ? { notes: CARNET } : {}) } }); } catch (e) {
      toast(`transcrire : ${e.message}`, 9000);
      return null;
    }
    const tid = r.doc?.id;
    R.last = { ...(R.last || {}), tid, state: 'transcription en cours' };
    env.repaint();
    toast('transcription en cours — elle se pose sur la planche à la fin (et s’ouvre dans Transcrire)', 5000);
    const done = await jobs.wait(r.job.id, (x) => { R.last.state = `transcription ${x.state === 'running' ? Math.round((x.progress || 0) * 100) + ' %' : 'en file'}`; env.repaint(); })
      .catch((e) => ({ state: 'error', message: e.message }));
    if (done.state !== 'done') {
      R.last.state = `transcription en échec : ${done.message || done.state}`;
      env.repaint();
      toast(`transcrire : ${done.message || done.state}`, 9000);
      return null;
    }
    let d;
    try { d = await api(DOC(tid)); } catch (e) { toast(e.message, 7000); return null; }
    const lines = (d.segments || []).map((s) => voice(d, s.text)).filter(Boolean);
    const tnode = putText(nodeId, 'Transcription', app.texte.htmlOf(lines.join('\n')), tid);
    R.last.state = 'transcription posée';
    env.repaint();
    if (summary) await summarize(tid, tnode || nodeId);
    return tid;
  }
  // les voix sont des étiquettes [S1]… dans le carnet (transcrire.py) : le nom de la voix, s'il en a un
  function voice(d, t) {
    const names = new Map((d.speakers || []).map((s) => [s.id || s.label, s.name]).filter(([k, v]) => k && v));
    return String(t || '').replace(/\[(S\d+)\]/g, (m, k) => (names.get(k) ? `${names.get(k)} :` : m));
  }
  // le carnet (résumé, points, décisions, actions) : mis en file par la transcription ; on suit
  // le document jusqu'à ce qu'il soit là (ou dise pourquoi), puis il se pose, relié au texte
  async function summarize(tid, anchorId) {
    R.last.state = 'résumé en cours';
    env.repaint();
    let d = null;
    for (let k = 0; k < 600; k++) {
      try { d = await api(DOC(tid)); } catch (e) { toast(`résumé : ${e.message}`, 8000); return; }
      const st = CARNET.map((c) => d.notes?.[c]?.state);
      if (!d.notes?.resume) break;                                   // rien en file (un texte sans parole)
      if (st.every((s) => !s || !['queued', 'running'].includes(s))) break;
      const live = d.notes.resume.live?.id || d.notes.points?.live?.id;
      if (live) await jobs.wait(live).catch(() => null); else await new Promise((res) => setTimeout(res, 1000));
    }
    const res = d?.notes?.resume, pts = d?.notes?.points;
    if (!res || res.state !== 'done') {
      const why = res?.error || (res ? res.state : 'la transcription ne l’a pas mis en file (aucune parole ?)');
      R.last.state = `résumé : ${why}`;
      env.repaint();
      toast(`résumé : ${why} — il se relance depuis Transcrire (le carnet)`, 9000);
      return;
    }
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const list = (title, arr) => (arr?.length ? `<p><strong>${title}</strong></p><ul>${arr.map((x) => `<li>${esc(voice(d, x.text))}${x.who ? ` — ${esc(voice(d, x.who))}` : ''}</li>`).join('')}</ul>` : '');
    const body = `<p>${esc(voice(d, res.data?.text))}</p>` + (pts?.state === 'done'
      ? list('Points', pts.data?.points) + list('Décisions', pts.data?.decisions) + list('Actions', pts.data?.actions) : '');
    putText(anchorId, 'Résumé', body, tid);
    R.last.state = 'résumé posé';
    env.repaint();
  }
  // un objet texte (objets/texte.js) à droite de `anchorId`, relié à lui (la lignée)
  function putText(anchorId, head, bodyHtml, tid) {
    if (!S.board || !app.texte) return null;
    const a = anchorId ? app.node(anchorId) : null;
    const [cx, cy] = app.canvas.center();
    const x0 = a ? a.x + a.w + 60 : cx, y0 = a ? a.y : cy;
    const [x, y] = app.freeSpot(x0, y0, 380, 200);
    const open = new URL(href(`transcrire/#${tid}`), location.href).href;   // un lien d'objet texte est absolu (http, https)
    const html = `<p><strong>${head}</strong> · <a href="${open}">dans Transcrire</a></p>` + bodyHtml;
    const n = { id: app.uid('n'), type: 'text', x, y, w: 380, h: 60, html: app.texte.clean(html), font: 'chakra', size: 14, color: 'ink', bg: 'panel2', align: 'left', wrap: true };
    app.mutate((B) => {
      B.nodes.push(n);
      if (a) B.links.push({ id: app.uid('l'), a: a.id, b: n.id, kind: 'out', label: '' });
    });
    return n.id;
  }

  // qui enregistre sur la planche (moi compris) : le voyant, chez chacun
  function who() {
    const out = [];
    if (R.on) out.push(C.me?.name ? `${C.me.name} (vous)` : 'vous');
    for (const p of C.peers.values()) if (p.call?.on && p.call?.rec) out.push(p.name || '?');
    return out;
  }
  // une personne qui commence à enregistrer : une ligne chez les autres (le voyant reste)
  const seen = new Set();
  function watch() {
    const now = new Set();
    for (const p of C.peers.values()) if (p.call?.on && p.call?.rec) {
      now.add(p.cid);
      if (!seen.has(p.cid)) toast(`${p.name || 'quelqu’un'} enregistre le son de l’appel — le voyant ENREGISTREMENT reste allumé tant que dure l’enregistrement`, 7000);
    }
    seen.clear();
    for (const c of now) seen.add(c);
  }

  return { start, stop, sync, why, who, watch, on: () => R.on, seconds, clock, last: () => R.last, transcribe, summarize, state: R };
}
