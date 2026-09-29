/* ═══════════════════════════════════════════════════════ le son : VO, doublages, pistes ── */
// VOIX.son (son.json, posé à côté de l'analyse) : des versions — la VO et ses doublages — faites chacune d'un fond
// (musique, bruitages, sans voix) et d'une piste de voix par personnage. On passe de l'une à l'autre sans que l'image
// s'arrête ; on coupe le fond pour n'entendre que les voix ; un clic sur un personnage de la timeline le coupe
// (alt + clic : on n'entend que lui). La vidéo reste l'horloge : les pistes sont lues en Web Audio et recalées dès
// qu'elles s'en écartent de plus de 60 ms. VO entière, fond compris, rien de coupé : c'est le son de la vidéo elle-même.
const SON = (VOIX.son && VOIX.son.versions && VOIX.son.versions.length) ? VOIX.son : null;
const AU = { ctx: null, buf: {}, charge: {}, version: 'vo', fond: true, muets: new Set(), src: [], gains: {}, t0: 0, off: 0, vit: 1, joue: false, minuterie: null };
try { const v = localStorage.getItem('movie-analysis-son-' + VOIX.slug); if (v && SON && SON.versions.some((x) => x.id === v)) AU.version = v; } catch (e) {}
const auVersion = () => (SON ? SON.versions.find((x) => x.id === AU.version) : null);
// la piste de la timeline → les pistes de voix qu'elle commande ('off' : personne à l'image, et ce que la voix séparée
// contient hors des répliques)
const auPistesDe = (cle) => (cle === 'off' ? ['', 'autres'] : [String(cle).replace(/^P:/, '')]);
const auCleDe = (k) => (k === '' || k === 'autres' ? 'off' : 'P:' + k);
// le son natif suffit : VO, fond, personne de coupé
const auNatif = () => !SON || (AU.version === 'vo' && AU.fond && !AU.muets.size);

async function auCharge(v) {
  if (AU.charge[v.id]) return AU.charge[v.id];
  AU.ctx = AU.ctx || new (window.AudioContext || window.webkitAudioContext)();
  // la piste sur R2 (window.XV_MEDIA, comme la vidéo), sinon celle posée à côté de la page
  const sources = (u) => (window.XV_MEDIA && !/^[a-z]+:|^\//i.test(u) ? [window.XV_MEDIA + encodeURI(u)] : []).concat([new URL(u, location.href).href]);
  const un = async (k, u) => {
    let r = null, raison = '';
    for (const x of sources(u)) { try { r = await fetch(x); if (r.ok) break; raison = r.status; } catch (e) { r = null; raison = e.message; } }
    if (!r || !r.ok) throw new Error(u + ' : ' + raison);
    AU.buf[v.id + '|' + k] = await AU.ctx.decodeAudioData(await r.arrayBuffer());
  };
  AU.charge[v.id] = Promise.all([un('fond', v.fond)].concat(Object.entries(v.voix).map(([k, u]) => un('v:' + k, u))));
  return AU.charge[v.id];
}
function auGain(k) {
  if (k === 'fond') return AU.fond ? 1 : 0;
  return AU.muets.has(auCleDe(k)) ? 0 : 1;
}
function auArrete() {
  for (const s of AU.src) { try { s.stop(); } catch (e) {} }
  AU.src = []; AU.gains = {}; AU.joue = false;
}
function auDemarre() {
  auArrete();
  const v = auVersion();
  if (auNatif() || !v || video.paused || !AU.buf[v.id + '|fond']) return;
  const ctx = AU.ctx, t = video.currentTime, vit = video.playbackRate || 1;
  if (ctx.state === 'suspended') ctx.resume();
  const quand = ctx.currentTime + 0.03;
  for (const k of ['fond'].concat(Object.keys(v.voix).map((x) => 'v:' + x))) {
    const b = AU.buf[v.id + '|' + k]; if (!b || t >= b.duration) continue;
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = b; s.playbackRate.value = vit;
    g.gain.value = auGain(k === 'fond' ? 'fond' : k.slice(2));
    s.connect(g).connect(ctx.destination);
    s.start(quand, t + 0.03 * vit);
    AU.src.push(s); AU.gains[k] = g;
  }
  AU.t0 = quand; AU.off = t + 0.03 * vit; AU.vit = vit; AU.joue = true; AU.versionJouee = v.id;
}
// où en sont les pistes, comparé à l'image
const auPosition = () => AU.off + (AU.ctx.currentTime - AU.t0) * AU.vit;
function auSurveille() {
  clearInterval(AU.minuterie);
  AU.minuterie = setInterval(() => {
    if (!AU.joue || video.paused) return;
    if (Math.abs(auPosition() - video.currentTime) > 0.06 || (video.playbackRate || 1) !== AU.vit) auDemarre();
  }, 400);
}
async function auApplique() {
  const v = auVersion();
  video.muted = !auNatif();
  if (auNatif()) { auArrete(); auDessine(); auOnde(); return; }
  auDessine('chargement…');
  try { await auCharge(v); } catch (e) { auDessine('son introuvable : ' + e.message); return; }
  auDessine();
  auOnde();
  // déjà en lecture : un geste (couper un personnage, le fond) règle les gains en place, sans relancer
  if (!video.paused && AU.joue && Object.keys(AU.gains).length && AU.src.length && AU.versionJouee === v.id) { for (const [k, g] of Object.entries(AU.gains)) g.gain.value = auGain(k === 'fond' ? 'fond' : k.slice(2)); return; }
  if (!video.paused) auDemarre();
}
function auChoisit(id) {
  AU.version = id;
  try { localStorage.setItem('movie-analysis-son-' + VOIX.slug, id); } catch (e) {}
  auApplique();
  if (typeof majSousTitre === 'function') { const st = $('st'); if (st) st.dataset.cle = ''; majSousTitre(video.currentTime || 0); }
}
function auBascule(cle, seul) {
  const v = auVersion(); if (!v) return;
  const presentes = new Set(Object.keys(v.voix).map(auCleDe));
  if (seul) {
    const deja = presentes.size > 1 && [...presentes].every((c) => c === cle || AU.muets.has(c)) && !AU.muets.has(cle);
    AU.muets = deja ? new Set() : new Set([...presentes].filter((c) => c !== cle));
  } else if (AU.muets.has(cle)) AU.muets.delete(cle); else AU.muets.add(cle);
  auApplique();
  VX.cleNoms = ''; vxDessine();
}

/* la forme d'onde de la timeline : celle de ce qu'on entend — la VO du film, ou le mélange des pistes actives (un
   doublage, le fond coupé, un personnage seul). Mélange à 16 kHz, gardé par combinaison. */
const AU_ONDES = {};
function auOnde() {
  if (typeof VX_ONDE === 'undefined' || VX_ONDE.etat !== 'pret') return;
  if (!AU.ondeVO) AU.ondeVO = { x: VX_ONDE.x, taux: VX_ONDE.taux, P: VX_ONDE.P, mn: VX_ONDE.mn, mx: VX_ONDE.mx, e2: VX_ONDE.e2, crete: VX_ONDE.crete };
  const v = auVersion();
  if (auNatif() || !v || !AU.buf[v.id + '|fond']) { Object.assign(VX_ONDE, AU.ondeVO); vxDessine(); return; }
  const cle = v.id + '|' + AU.fond + '|' + [...AU.muets].sort().join(',');
  if (!AU_ONDES[cle]) {
    const taux = 16000, actives = [];
    if (AU.fond) actives.push(AU.buf[v.id + '|fond']);
    for (const k of Object.keys(v.voix)) if (auGain(k)) actives.push(AU.buf[v.id + '|v:' + k]);
    const n = Math.ceil(Math.max(1, ...actives.map((b) => b.duration)) * taux), x = new Float32Array(n);
    for (const b of actives) {
      const nc = b.numberOfChannels, pas = b.sampleRate / taux, ch = [];
      for (let c = 0; c < nc; c++) ch.push(b.getChannelData(c));
      for (let i = 0; i < n; i++) { const j = Math.floor(i * pas); if (j >= b.length) break; let s = 0; for (let c = 0; c < nc; c++) s += ch[c][j]; x[i] += s / nc; }
    }
    const P = 64, nb = Math.ceil(n / P), mn = new Float32Array(nb), mx = new Float32Array(nb), e2 = new Float32Array(nb);
    let crete = 1e-4;
    for (let q = 0; q < nb; q++) {
      let lo = 1, hi = -1, e = 0; const i1 = Math.min(n, (q + 1) * P);
      for (let i = q * P; i < i1; i++) { const s = x[i]; if (s < lo) lo = s; if (s > hi) hi = s; e += s * s; }
      mn[q] = lo; mx[q] = hi; e2[q] = e; if (hi > crete) crete = hi; if (-lo > crete) crete = -lo;
    }
    AU_ONDES[cle] = { x, taux, P, mn, mx, e2, crete };
  }
  Object.assign(VX_ONDE, AU_ONDES[cle]);
  vxDessine();
}

/* la barre : la version, le fond ; l'état */
function auDessine(etat) {
  const box = $('vx-son'); if (!box || !SON) return;
  box.textContent = '';
  const lab = document.createElement('span'); lab.className = 'lab'; lab.textContent = 'Son';
  box.append(lab);
  const groupe = document.createElement('div'); groupe.className = 'vx-zooms';
  for (const v of SON.versions) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = v.nom; b.title = v.titre || v.nom;
    b.setAttribute('aria-pressed', String(v.id === AU.version));
    b.addEventListener('click', () => auChoisit(v.id));
    groupe.append(b);
  }
  box.append(groupe);
  const f = document.createElement('button'); f.type = 'button'; f.className = 'vx-bouton';
  f.textContent = AU.fond ? 'Fond : oui' : 'Fond : coupé'; f.setAttribute('aria-pressed', String(!AU.fond));
  f.title = 'Couper la musique et les bruitages : n’entendre que les voix';
  f.addEventListener('click', () => { AU.fond = !AU.fond; auApplique(); });
  box.append(f);
  if (AU.muets.size) {
    const r = document.createElement('button'); r.type = 'button'; r.className = 'vx-bouton'; r.textContent = 'Toutes les voix';
    r.addEventListener('click', () => { AU.muets.clear(); auApplique(); VX.cleNoms = ''; vxDessine(); });
    box.append(r);
  }
  if (etat) { const e = document.createElement('span'); e.className = 'etat'; e.textContent = etat; box.append(e); }
}

/* le sous-titre d'un doublage : la réplique traduite, du personnage qui la dit */
if (SON) {
  const sousTitreVO = majSousTitre;
  majSousTitre = function (t) {
    const v = auVersion();
    if (!v || v.id === 'vo' || !v.lignes) return sousTitreVO(t);
    const box = $('st'); if (!box) return;
    const ici = v.lignes.filter((l) => l.a - 0.12 <= t && t < l.b + 0.25);
    // chaque mot souligné quand on l'entend, comme en VO (les mots du doublage : doublage_mots.py)
    const avance = (l) => (l.mots ? l.mots.filter((m) => m[1] <= t).length + (l.mots.some((m) => m[1] <= t && t < m[2]) ? 'i' : '') : '');
    const cle = v.id + ':' + ici.map((l) => l.a + '/' + avance(l)).join('|');
    if (cle === box.dataset.cle) return;
    box.dataset.cle = cle; box.textContent = '';
    for (const l of ici) {
      const ligne = document.createElement('div'); ligne.className = 'ligne';
      const qui = document.createElement('span'); qui.className = 'qui';
      const i = document.createElement('i'); i.style.background = l.qui ? castColor(l.qui) : VXC.ink3;
      qui.append(i, l.qui || 'off');
      const dit = document.createElement('span'); dit.className = 'dit';
      if (l.mots) for (const [w, a, b] of l.mots) { const s = document.createElement('span'); s.className = 'm' + (a <= t ? (t < b ? ' ici' : ' dit') : ''); s.textContent = w; dit.append(s); }
      else dit.textContent = l.trad;
      ligne.append(qui, dit); box.append(ligne);
    }
    vxAjusteST(box);
  };
  video.addEventListener('play', () => { if (!auNatif()) auApplique(); });
  video.addEventListener('playing', () => { if (!auNatif()) auDemarre(); });
  video.addEventListener('pause', auArrete);
  video.addEventListener('waiting', auArrete);
  video.addEventListener('seeked', () => { if (!video.paused && !auNatif()) auDemarre(); });
  video.addEventListener('ratechange', () => { if (!video.paused && !auNatif()) auDemarre(); });
  // un personnage de la timeline : clic = le couper ou le rendre ; alt + clic = n'entendre que lui
  $('vx-noms').addEventListener('click', (ev) => {
    const d = ev.target.closest('[data-cle]'); if (!d) return;
    const v = auVersion(); if (!v || !Object.keys(v.voix).some((k) => auCleDe(k) === d.dataset.cle)) return;
    auBascule(d.dataset.cle, ev.altKey);
  });
  auSurveille();
  auDessine();
  if (!auNatif()) auApplique();
  window.xvSon = { AU, auPosition, auChoisit, auBascule };
}
