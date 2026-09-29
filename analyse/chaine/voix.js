/* ══ Les voix : la timeline de la diarisation, dans le Studio ═══════════════════════════════════════
   Une piste par personnage. En haut, sa ligne de dialogue, chaque mot à l'instant où on l'entend ; dessous, sa voix
   (la probabilité de Nemotron) ; en fond, sa présence à l'image. Deux personnes qui parlent ensemble : deux lignes.

   Qui dit quoi se décide réplique par réplique, et mot par mot quand la réplique est partagée entre deux voix :
     1. la main — corrections.json → locuteurs (une réplique glissée sur une autre piste) ;
     2. les lèvres — une réplique « vue et entendue » garde le personnage que l'image a vu parler ;
     3. la voix — chaque voix Nemotron prend le personnage de ses ancres (les répliques vues et entendues qu'elle
        porte), ou celui qu'on lui a donné à la main (corrections.json → voix) ;
     4. la chaîne — ce qu'elle avait attribué, quand aucune voix n'est entendue.
   Une voix est « entendue » sous une réplique si elle passe le seuil sur au moins un cinquième de sa durée — ou, à
   défaut, si elle y domine nettement sous le seuil (moyenne ≥ 0,3 et double de la suivante) : c'est ce qui rend à
   l'homme à la moustache de Getaround les répliques que Nemotron entendait à 0,41 au lieu de 0,5.

   Globales du Studio : DATA, video, D, $ (getElementById), tc, castName, castColor, courtNom, repliquesUniques,
   paint, JETON, PALETTE ; VOIX est posé par studio.mjs (diarisation, mots horodatés, labo). */
// Les teintes du dessin (le canvas, les pastilles) : les jetons du portail (commun/tokens.css) et la palette des
// voix (--pv-0…7, déclarée dans analyse/film/palette.css), lus à l'exécution — aucune couleur n'est écrite ici. Relues
// quand le thème change (vxTeintes, appelée par la page sur sr:theme), dans le même objet et le même tableau.
const VXC = {}, VX_COULEURS_VOIX = [];
function vxTeintes() {
  for (const k of ['ink', 'ink2', 'ink3', 'bg', 'panel', 'panel3', 'grn', 'cy', 'amb']) VXC[k] = JETON('--' + k);
  VX_COULEURS_VOIX.splice(0, VX_COULEURS_VOIX.length, ...PALETTE('--pv-', 8));
}
vxTeintes();
const VX_POST_DEFAUT = { onset: 0.5, offset: 0.5, pad_onset: 0, pad_offset: 0, min_duration_on: 0, min_duration_off: 0 };
const VX_POST_CHAMPS = [
  ['onset', 'Seuil d’entrée', 0, 1, 0.01, 'une voix commence au-dessus'],
  ['offset', 'Seuil de sortie', 0, 1, 0.01, 'et s’arrête en dessous'],
  ['min_duration_on', 'Parole minimale', 0, 2, 0.02, 'plus court : effacé (s)'],
  ['min_duration_off', 'Silence minimal', 0, 2, 0.02, 'plus court : comblé (s)'],
  ['pad_onset', 'Marge avant', 0, 1, 0.01, 'ajoutée au début (s)'],
  ['pad_offset', 'Marge après', 0, 1, 0.01, 'ajoutée à la fin (s)'],
];
const VX_CLE = 'movie-analysis-voix-' + (VOIX.slug || '');
const vxLit = (k, d) => { try { const v = localStorage.getItem(VX_CLE + '-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const vxEcrit = (k, v) => { try { localStorage.setItem(VX_CLE + '-' + k, JSON.stringify(v)); } catch (e) {} };
const VX = { zoom: 1, post: Object.assign({}, VX_POST_DEFAUT, vxLit('post', {})), brutes: !!vxLit('brutes', false),
  segs: [], voixPerso: [], voixOff: [], cpl: [], lignes: [], pistes: [], boites: [], lignesFrise: [], H: 0, cleNoms: '', choisi: null };

/* ── la diarisation gardée pour ce film : les probabilités, voix × trames, en octets ── */
const DIAR = (() => {
  const r = VOIX.diar;
  if (!r || !r.probas) return null;
  const bin = atob(r.probas.q || ''), q = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) q[i] = bin.charCodeAt(i);
  return { q, V: r.probas.voix, n: r.probas.n, pas: r.probas.pas_s, r };
})();

/* ── les mots horodatés de la chaîne (whisper.json), rangés par réplique ── */
const VX_MOTS = (() => {
  const m = new Map();
  for (const l of ((VOIX.mots || {}).lignes || [])) m.set(Math.round(l.a * 100) + '-' + Math.round(l.b * 100), l);
  return m;
})();
const vxNet = (t) => String(t || '').trim().replace(/\s+/g, ' ');
function vxMotsDe(l) {
  const m = VX_MOTS.get(Math.round(l.start * 100) + '-' + Math.round(l.end * 100));
  if (!m || !m.mots.length) return null;
  const src = [];
  for (const [w, a, b] of m.mots) {
    const der = src[src.length - 1];
    // un morceau collé (« 'est », « -vous ») ou une ponctuation seule rejoint le mot d'avant
    if (der && (!/^\s/.test(w) || !/[\p{L}\p{N}]/u.test(w))) { der.w += w; der.b = Math.max(der.b, b); continue; }
    src.push({ w, a, b: Math.max(b, a + 0.02) });
  }
  if (vxNet(m.mots.map((x) => x[0]).join('')) === vxNet(l.text)) return src;
  return vxRealigne(src, l.text);
}
// Une réplique corrigée à la main garde ses mots à leur instant : les mots inchangés gardent leur temps (plus longue
// sous-suite commune), ceux qui changent se partagent le temps des mots qu'ils remplacent, au prorata de leur longueur.
function vxRealigne(src, texte) {
  const neuf = [];
  for (const t of String(texte).trim().split(/\s+/).filter(Boolean)) {
    if (neuf.length && !/[\p{L}\p{N}]/u.test(t)) neuf[neuf.length - 1] += ' ' + t; else neuf.push(t);
  }
  if (!neuf.length) return null;
  const cle = (w) => String(w).toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '');
  const A = src.map((x) => cle(x.w)), B = neuf.map(cle), n = A.length, k = B.length;
  const L = Array.from({ length: n + 1 }, () => new Int16Array(k + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = k - 1; j >= 0; j--) L[i][j] = A[i] && A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const paires = [];
  for (let i = 0, j = 0; i < n && j < k;) { if (A[i] && A[i] === B[j]) { paires.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
  paires.push([n, k]);
  const out = [];
  let i0 = 0, j0 = 0;
  for (const [i1, j1] of paires) {
    if (j1 > j0) {   // des mots nouveaux entre deux ancres : le temps des mots remplacés, sinon le blanc entre les ancres
      const a = i1 > i0 ? src[i0].a : (i0 > 0 ? src[i0 - 1].b : src[0].a), b = i1 > i0 ? src[i1 - 1].b : (i1 < n ? src[i1].a : src[n - 1].b);
      const lg = neuf.slice(j0, j1).map((w) => w.length + 1), tot = lg.reduce((x, y) => x + y, 0), d = Math.max(0, b - a);
      let t = a;
      for (let j = j0; j < j1; j++) { const dt = d * lg[j - j0] / tot; out.push({ w: ' ' + neuf[j], a: t, b: Math.max(t + dt, t + 0.02) }); t += dt; }
    }
    if (i1 < n) out.push({ w: ' ' + neuf[j1], a: src[i1].a, b: src[i1].b });
    i0 = i1 + 1; j0 = j1 + 1;
  }
  return out;
}

/* ── le post-traitement de NeMo, à l'identique de l'outil diarisation (hystérésis, marges, durées) ── */
function vxSegmente(q, n, V, s, pas, pp) {
  const f = Math.fround, P = f(pas), avant = f(pp.pad_onset), apres = f(pp.pad_offset);
  const on = pp.onset, off = pp.offset, haut = new Uint8Array(n);
  let etat = 0;
  if (on >= off) { for (let i = 0; i < n; i++) { const v = q[i * V + s] / 255; if (v > on) etat = 1; else if (v < off) etat = 0; haut[i] = etat; } }
  else { for (let i = 0; i < n; i++) { const v = q[i * V + s] / 255; if (v >= off) etat = 1; else if (v <= on) etat = 0; else etat = 1 - etat; haut[i] = etat; } }
  let segs = [], debut = -1;
  for (let i = 0; i <= n; i++) {
    const h = i < n ? haut[i] : 0;
    if (h && debut < 0) debut = i;
    else if (!h && debut >= 0) { const a = Math.max(0, f(f(debut * P) - avant)), b = f(f(i * P) + apres); if (b > a) segs.push([a, b]); debut = -1; }
  }
  if (pp.pad_onset > 0 || pp.pad_offset > 0) segs = vxFusionne(segs);
  const minOn = f(pp.min_duration_on), minOff = f(pp.min_duration_off);
  if (pp.min_duration_on > 0) segs = segs.filter((x) => f(x[1] - x[0]) >= minOn);
  if (pp.min_duration_off > 0 && segs.length > 1) {
    segs.sort((x, y) => x[0] - y[0]);
    const trous = [];
    for (let i = 0; i + 1 < segs.length; i++) { const g = [segs[i][1], segs[i + 1][0]]; if (!(f(g[1] - g[0]) >= minOff)) trous.push(g); }
    segs = vxFusionne(segs.concat(trous));
  }
  return segs;
}
function vxFusionne(segs) {
  if (segs.length < 2) return segs;
  segs = segs.slice().sort((x, y) => x[0] - y[0]);
  const out = []; let cur = segs[0].slice();
  for (let i = 1; i < segs.length; i++) { if (cur[1] >= segs[i][0]) cur[1] = segs[i][1]; else { out.push(cur); cur = segs[i].slice(); } }
  out.push(cur);
  return out;
}
function vxResegmente() {
  VX.segs = [];
  if (!DIAR) return;
  for (let s = 0; s < DIAR.V; s++) VX.segs.push(vxSegmente(DIAR.q, DIAR.n, DIAR.V, s, DIAR.pas, VX.post));
}
const vxRecouvre = (segs, a, b) => { let t = 0; for (const [x, y] of segs || []) { if (y <= a) continue; if (x >= b) break; t += Math.min(b, y) - Math.max(a, x); } return t; };

/* ── les voix sous une réplique : au-dessus du seuil, ou une seule, nettement dominante, en dessous ── */
function vxVoixDe(a, b) {
  if (!DIAR) return [];
  const d = Math.max(1e-6, b - a), out = [];
  for (let s = 0; s < DIAR.V; s++) { const v = vxRecouvre(VX.segs[s], a, b); if (v / d >= 0.2) out.push({ s, sec: v, part: v / d }); }
  if (out.length) return out.sort((x, y) => y.sec - x.sec);
  const i0 = Math.max(0, Math.floor(a / DIAR.pas)), i1 = Math.min(DIAR.n, Math.max(i0 + 1, Math.ceil(b / DIAR.pas)));
  const moy = new Array(DIAR.V).fill(0);
  for (let i = i0; i < i1; i++) for (let s = 0; s < DIAR.V; s++) moy[s] += DIAR.q[i * DIAR.V + s] / 255 / (i1 - i0);
  // seules les voix qui parlent quelque part dans le film comptent : Nemotron ouvre parfois un canal fantôme (V4 sous
  // l'homme à la moustache, à 0,33) qui ne passe jamais le seuil et masquerait la vraie voix
  const tri = moy.map((m, s) => [m, s]).filter(([, s]) => (VX.segs[s] || []).length).sort((x, y) => y[0] - x[0]);
  if (!tri.length) return [];
  if (tri[0][0] >= 0.3 && tri[0][0] >= 2 * (tri[1] ? tri[1][0] : 0)) return [{ s: tri[0][1], sec: d * tri[0][0], part: tri[0][0], faible: true }];
  return [];
}
const vxVue = (l) => /^vue et entendue/.test(l.how || '');
// ce que la chaîne avait attribué, gardé à part : la timeline réécrit ensuite speaker pour le script et le casting
const vxChaine = (l) => (l.speakerChaine !== undefined ? l.speakerChaine : (l.speaker || null));

/* ── les corrections : le fichier partagé, puis ce navigateur par-dessus (clés locuteurs et voix) ── */
function vxCorr() {
  const f = window.XV_CORR_FICHIER || {}, c = window.xvCorrections();
  return { locuteurs: Object.assign({}, f.locuteurs || {}, c.locuteurs || {}), voix: Object.assign({}, f.voix || {}, c.voix || {}) };
}

/* ── une réplique en unités (ses mots, ou elle entière) et la voix de chacune ── */
function vxUnites(l) {
  const voix = vxVoixDe(l.start, l.end), dom = voix.length ? voix[0].s : -1;
  const mots = vxMotsDe(l), unites = mots || [{ w: ' ' + l.text, a: l.start, b: l.end }];
  const sv = unites.map((m) => {
    let best = -1, bv = 0;
    for (const x of voix) { if (x.faible) continue; const r = vxRecouvre(VX.segs[x.s], m.a, m.b); if (r > bv) { bv = r; best = x.s; } }
    return best;
  });
  for (let i = 1; i < sv.length; i++) if (sv[i] < 0) sv[i] = sv[i - 1];
  for (let i = sv.length - 2; i >= 0; i--) if (sv[i] < 0) sv[i] = sv[i + 1];
  for (let i = 0; i < sv.length; i++) if (sv[i] < 0) sv[i] = dom;
  return { voix, dom, mots, unites, sv };
}
// une voix que la main range sous « personne » (les gens de l'hélico, une radio) vit sur la piste Personne
const vxPisteDe = (s) => (VX.voixPerso[s] ? 'P:' + VX.voixPerso[s] : (VX.voixOff[s] ? 'off' : 'V:' + s));

/* ── chaque voix prend le personnage de ses ancres (vote en secondes), ou celui qu'on lui a donné ── */
function vxCouplage() {
  VX.voixPerso = []; VX.voixOff = []; VX.cpl = [];
  if (!DIAR) return;
  const V = DIAR.V, votes = Array.from({ length: V }, () => new Map()), ancres = new Array(V).fill(0);
  for (const l of repliquesUniques()) {
    if (!vxChaine(l) || !vxVue(l)) continue;
    const v = vxVoixDe(l.start, l.end)[0];
    if (!v) continue;
    votes[v.s].set(vxChaine(l), (votes[v.s].get(vxChaine(l)) || 0) + v.sec);
    ancres[v.s]++;
  }
  // La main ancre aussi, à égalité de secondes avec les lèvres : une réplique réattribuée dit qui porte sa voix. Une
  // voix sans ancre (V1 de Getaround, la voix au téléphone de l'homme aux lunettes) suit donc la première réplique
  // qu'on lui rend, et ses autres répliques avec elle ; une voix déjà bien ancrée ne bascule pas pour une réplique.
  const loc = vxCorr().locuteurs, mains = Array.from({ length: V }, () => new Set());
  for (const l of repliquesUniques()) {
    const cle = l.start + '-' + l.end, o = loc[cle];
    if (o === undefined || o === null) continue;
    const U = vxUnites(l);
    U.unites.forEach((m, i) => {
      const man = typeof o === 'string' ? o : (Array.isArray(o) ? o[i] : null), s = U.sv[i];
      if (man === undefined || man === null || s < 0) return;
      votes[s].set(man, (votes[s].get(man) || 0) + (m.b - m.a));
      mains[s].add(cle);
    });
  }
  const forces = vxCorr().voix, vivant = new Set(DATA.cast.map((c) => c.id));
  for (let s = 0; s < V; s++) {
    const tri = Array.from(votes[s].entries()).sort((x, y) => y[1] - x[1]), tot = tri.reduce((t, x) => t + x[1], 0);
    // null : « revenir à l'automatique » (vxForceVoix '__auto', une annulation) — pas une voix forcée sur personne
    const k = 'V' + (s + 1), force = forces[k] === null || forces[k] === undefined ? undefined : forces[k];
    const auto = tri.length ? (tri[0][0] || null) : null;   // '' : la main a dit « personne »
    let qui = force !== undefined ? (force || null) : auto;
    if (qui && !vivant.has(qui)) qui = null;
    VX.voixPerso[s] = qui;
    VX.voixOff[s] = !qui && (force !== undefined ? force === '' : auto === null && tri.length > 0 && tri[0][0] === '');
    VX.cpl.push({ s, ancres: ancres[s], mains: mains[s].size, sec: tot, tri, auto, qui, force: force !== undefined, accord: tot ? tri[0][1] / tot : 0 });
  }
}

/* ── qui dit quoi : chaque mot (ou la réplique entière, sans mots) prend un personnage, puis les mots voisins de
   même personnage et de même origine font une ligne ── */
function vxAttribue() {
  const loc = vxCorr().locuteurs, out = [], vivant = new Set(DATA.cast.map((c) => c.id));
  for (const sh of DATA.shots) for (const l of sh.lines || []) if (l.speakerChaine === undefined) l.speakerChaine = l.speaker || null;
  for (const l of repliquesUniques()) {
    const chaine = vxChaine(l);
    const cle = l.start + '-' + l.end, { voix, dom, mots, unites, sv } = vxUnites(l);
    const o = loc[cle];
    let g = null;
    unites.forEach((m, i) => {
      const s = sv[i];
      let perso, source;
      const man = typeof o === 'string' ? o : (Array.isArray(o) && o[i] != null ? o[i] : undefined);
      if (man !== undefined) { perso = man || null; source = 'main'; }
      // sans diarisation pour ce film, ce n'est pas « Nemotron n'entend personne » : c'est la chaîne, simplement
      else if (s < 0) { perso = chaine; source = !DIAR ? (perso ? 'chaîne' : 'aucune') : (perso ? 'image' : 'aucune'); }
      else if (s === dom && vxVue(l) && chaine) { perso = chaine; source = 'lèvres'; }
      else if (VX.voixPerso[s]) { perso = VX.voixPerso[s]; source = 'voix'; }
      else if (s === dom && chaine) { perso = chaine; source = 'chaîne'; }
      else { perso = null; source = 'voix'; }
      if (perso && !vivant.has(perso)) perso = null;
      // « personne », posé à la main, va sur la piste Personne — pas sur celle d'une voix
      const piste = perso ? 'P:' + perso : (source === 'main' || s < 0 || VX.voixPerso[s] || VX.voixOff[s] ? 'off' : 'V:' + s);
      if (!g || g.piste !== piste || g.source !== source) {
        g = { l, cle, piste, perso, s, source, i0: i, i1: i + 1, n: unites.length, a: m.a, b: m.b, mots: mots ? [] : null,
          faible: !!(voix[0] && voix[0].faible), desaccord: source !== 'main' && !!(perso && chaine && perso !== chaine) };
        out.push(g);
      }
      g.i1 = i + 1; g.b = Math.max(g.b, m.b);
      if (mots) g.mots.push(m);
    });
  }
  for (const g of out) g.texte = g.mots ? g.mots.map((m) => m.w).join('').trim() : g.l.text;
  out.sort((x, y) => x.a - y.a || (x.piste < y.piste ? -1 : 1));
  VX.lignes = out;
  // La courbe d'une voix suit ses répliques : sous une réplique rangée ailleurs que sur la piste de sa voix, la portion
  // de courbe part avec elle. VX.parts[s] : [début, fin, piste] — la réplique, étendue à la parole de la voix qui la
  // déborde, sans sortir des bornes de la réplique (à 0,25 s près).
  // Une réplique que Nemotron n'entend que sous le seuil (aucune voix retenue) emporte quand même la courbe qu'on voit
  // sous elle : celle de la voix la plus présente (moyenne ≥ 0,1), si aucune autre réplique au même instant ne la porte.
  VX.parts = DIAR ? Array.from({ length: DIAR.V }, () => []) : [];
  if (DIAR) {
    for (const g of out) {
      g.porte = g.s;
      if (g.s >= 0) continue;
      const i0 = Math.max(0, Math.floor(g.a / DIAR.pas)), i1 = Math.min(DIAR.n, Math.max(i0 + 1, Math.ceil(g.b / DIAR.pas)));
      let best = -1, bm = 0.1;
      for (let s = 0; s < DIAR.V; s++) {
        if (!(VX.segs[s] || []).length) continue;   // les canaux fantômes n'ont pas de courbe à eux
        let m = 0; for (let i = i0; i < i1; i++) m += DIAR.q[i * DIAR.V + s] / 255;
        m /= (i1 - i0);
        if (m >= bm && !out.some((h) => h !== g && h.s === s && h.a < g.b && h.b > g.a)) { bm = m; best = s; }
      }
      g.porte = best;
    }
    for (const g of out) {
      const s = g.porte;
      if (s < 0 || g.piste === vxPisteDe(s)) continue;
      // la portion s'étend à la parole de la voix qui déborde la réplique (0,25 s au plus), sans entrer sur une autre
      // réplique de la même voix : sinon la courbe de la voisine partait avec elle
      let bas = g.l.start - 0.25, haut = g.l.end + 0.25;
      // (le blanc entre deux répliques de la même voix se partage en son milieu)
      for (const h of out) if (h !== g && h.porte === s) { if (h.b <= g.a) bas = Math.max(bas, (h.b + g.a) / 2); else if (h.a >= g.b) haut = Math.min(haut, (g.b + h.a) / 2); }
      let a0 = g.a, b0 = g.b;
      for (const [x, y] of VX.segs[s] || []) if (y > g.a && x < g.b) { a0 = Math.min(a0, Math.max(x, bas)); b0 = Math.max(b0, Math.min(y, haut)); }
      VX.parts[s].push([a0, b0, g.piste]);
    }
    // deux répliques de la même voix qui se chevauchent (les bornes de Whisper) : la courbe n'est dessinée qu'une fois,
    // coupée au milieu du chevauchement ; deux portions voisines sur la même piste n'en font qu'une
    for (let s = 0; s < VX.parts.length; s++) {
      const P = VX.parts[s].sort((x, y) => x[0] - y[0]), R = [];
      for (const p of P) {
        const q = R[R.length - 1];
        if (q && p[0] < q[1]) {
          if (q[2] === p[2]) { q[1] = Math.max(q[1], p[1]); continue; }
          const m = (p[0] + Math.min(q[1], p[1])) / 2; q[1] = m; p[0] = Math.max(p[0], m);
          if (p[1] <= p[0]) continue;
        }
        R.push(p);
      }
      VX.parts[s] = R;
    }
  }
  // Ce que la timeline décide vaut pour tout le Studio : le script, le casting, le découpage. Une réplique prend le
  // personnage qui en dit le plus de mots ; toutes ses copies (une par plan qu'elle recouvre) suivent.
  const poids = new Map();
  for (const g of out) { const m = poids.get(g.cle) || new Map(); m.set(g.perso || '', (m.get(g.perso || '') || 0) + (g.i1 - g.i0)); poids.set(g.cle, m); }
  for (const sh of DATA.shots) for (const l of sh.lines || []) {
    const m = poids.get(l.start + '-' + l.end); if (!m) continue;
    const [perso] = Array.from(m.entries()).sort((x, y) => y[1] - x[1])[0];
    l.speaker = perso || null;
  }
}

/* ── les pistes : les personnages (ceux qui parlent d'abord, dans l'ordre où ils parlent), les voix sans personnage,
   « personne » ; les voix brutes en option ── */
function vxPistes() {
  const par = {};
  for (const g of VX.lignes) (par[g.piste] = par[g.piste] || []).push(g);
  const presence = (id) => DATA.shots.filter((sh) => (sh.subjects || []).includes(id) || (sh.masks && sh.masks[id])).map((sh) => [sh.start, sh.end]);
  const P = [];
  const voixDe = (cle) => (DIAR ? Array.from({ length: DIAR.V }, (_, s) => s).filter((s) => vxPisteDe(s) === cle || (VX.parts[s] || []).some((p) => p[2] === cle)) : []);
  const persos = DATA.cast.map((c) => { const l = par['P:' + c.id] || [], pr = presence(c.id); return { c, l, pr, t: l.length ? l[0].a : 1e9 + (pr[0] ? pr[0][0] : 1e6) }; })
    .sort((x, y) => x.t - y.t);
  for (const { c, l, pr } of persos) {
    const voix = voixDe('P:' + c.id);
    P.push({ cle: 'P:' + c.id, type: 'perso', id: c.id, nom: c.name, court: courtNom(c.name), couleur: castColor(c.id), lignes: l, voix, presence: pr,
      h: voix.length ? 76 : (l.length ? 42 : 24), cible: true });
  }
  if (DIAR) for (let s = 0; s < DIAR.V; s++) {
    if (VX.voixPerso[s] || VX.voixOff[s]) continue;
    const l = par['V:' + s] || [];
    if (!l.length && !(VX.segs[s] || []).length) continue;
    P.push({ cle: 'V:' + s, type: 'voix', s, nom: 'V' + (s + 1), court: 'V' + (s + 1), couleur: VX_COULEURS_VOIX[s % 8], lignes: l, voix: [s], presence: [], h: 76, cible: false });
  }
  const voixOff = voixDe('off');
  P.push({ cle: 'off', type: 'off', nom: 'Personne', court: 'Personne', couleur: VXC.ink3, lignes: par.off || [], voix: voixOff, presence: [], h: voixOff.length ? 76 : ((par.off || []).length ? 44 : 30), cible: true });
  if (DIAR && VX.brutes) for (let s = 0; s < DIAR.V; s++) P.push({ cle: 'B:' + s, type: 'brute', s, nom: 'V' + (s + 1), court: 'V' + (s + 1), couleur: VX_COULEURS_VOIX[s % 8], lignes: [], voix: [s], presence: [], h: 40, cible: false });
  VX.pistes = P;
}

/* ── le tout : appelé à chaque correction (xvRafraichir), à chaque seuil ── */
function rendreTimeline() {
  if (!VX.segs.length && DIAR) vxResegmente();
  vxCouplage();
  vxAttribue();
  vxPistes();
  VX.cleNoms = '';
  vxDessine();
  vxAvance();
  if (typeof majSousTitre === 'function') majSousTitre(video.currentTime || 0);
}

/* ═════════════════════════════════════════════════════════════════════════ le dessin ── */
// une teinte (un jeton : #rrggbb, ou rgb(…) si le navigateur la rend ainsi) avec son alpha
const vxRgba = (c, a) => {
  c = String(c || '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) { const n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  m = /^rgba?\(([^)]*)\)$/i.exec(c);
  if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean); return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')'; }
  return c;
};
function vxRond(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function vxFenetre() {
  const z = $('vx-zone'), w = z.clientWidth || 1, total = w * VX.zoom, a = z.scrollLeft / total * D;
  return [a, a + D / VX.zoom];
}
function vxRangs() {
  const R = [{ type: 'regle', h: 30 }, { type: 'onde', h: 56 }].concat(VX.pistes);
  let y = 0;
  for (const r of R) { r.y = y; y += r.h; }
  VX.lignesFrise = R; VX.H = y;
  return R;
}
function vxDessine() {
  const zone = $('vx-zone'), cv = $('vx-canvas'), esp = $('vx-espace');
  if (!zone || !cv || $('studio').hidden) return;
  const w = zone.clientWidth;
  if (!w) return;
  const R = vxRangs(), H = VX.H;
  esp.style.width = (w * VX.zoom) + 'px'; esp.style.height = H + 'px';
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr); }
  cv.style.width = w + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, H);
  const [a, b] = vxFenetre(), X = (t) => (t - a) / (b - a) * w;
  vxNoms(R);
  VX.boites = [];
  const pasGrille = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((p) => (b - a) / p <= w / 90) || 1200;
  for (const r of R) {
    const y = r.y, h = r.h;
    if (r.type === 'regle') {
      // le temps en haut, les plans dessous : un filet de la teinte du plan, son numéro s'il y a la place
      ctx.font = '9px "Azeret Mono", monospace'; ctx.textBaseline = 'middle';
      for (let t = Math.ceil(a / pasGrille) * pasGrille; t <= b; t += pasGrille) {
        const x = Math.round(X(t)) + 0.5;
        ctx.fillStyle = vxRgba(VXC.grn, 0.55); ctx.fillRect(x, y + 2, 1, 6);
        ctx.fillStyle = VXC.ink3; ctx.fillText(pasGrille < 1 ? tc(t) : tc(t).slice(0, -3), x + 4, y + 6);
      }
      for (const sh of DATA.shots) {
        if (sh.end < a || sh.start > b) continue;
        const x0 = X(sh.start), x1 = X(sh.end);
        // (la teinte d'un plan est une mesure — la moyenne de ses images clés —, pas une couleur du thème) ; le fond du
        // thème par-dessus, à 62 % : l'encre y tient 4,5:1 sur un plan noir comme sur un plan blanc, dans les deux thèmes
        ctx.fillStyle = sh.teinte && /^#[0-9a-f]{6}$/i.test(sh.teinte) ? sh.teinte : VXC.panel3;
        ctx.fillRect(x0, y + 16, Math.max(1, x1 - x0 - 1), 12);
        ctx.fillStyle = vxRgba(VXC.bg, 0.62); ctx.fillRect(x0, y + 16, Math.max(1, x1 - x0 - 1), 12);
        if (x1 - x0 > 26) { ctx.save(); ctx.beginPath(); ctx.rect(x0, y + 16, x1 - x0 - 2, 12); ctx.clip(); ctx.fillStyle = VXC.ink; ctx.font = '8px "Venus Rising", sans-serif'; ctx.fillText(sh.id, x0 + 4, y + 22.5); ctx.restore(); }
      }
      continue;
    }
    ctx.fillStyle = vxRgba(VXC.grn, 0.12);
    for (let t = Math.ceil(a / pasGrille) * pasGrille; t <= b; t += pasGrille) ctx.fillRect(Math.round(X(t)), y, 1, h);
    ctx.fillStyle = vxRgba(VXC.grn, 0.28); ctx.fillRect(0, y + h - 1, w, 1);
    if (r.type === 'onde') { vxOnde(ctx, a, b, w, y, h); continue; }
    // la présence à l'image : un fond léger sur les plans où le personnage est vu
    for (const [p0, p1] of r.presence) { if (p1 < a || p0 > b) continue; ctx.fillStyle = vxRgba(r.couleur, 0.07); ctx.fillRect(X(p0), y, X(p1) - X(p0), h - 1); }
    const bande = r.h >= 44 && r.type !== 'brute';
    const haut = y + (bande ? (r.type === 'off' ? 30 : 38) : 6), bas = y + h - 8, hh = Math.max(4, bas - haut);
    // la voix (ou les voix) de cette piste : aire de probabilité, seuil, segments retenus
    if (DIAR && r.voix.length && bas - haut > 8) {
      const Y = (v) => bas - v * hh;
      for (const s of r.voix) {
        const parts = VX.parts[s] || [];
        const zones = r.type === 'brute' ? [[a, b]] : (r.cle === vxPisteDe(s) ? vxComplement(a, b, parts.map((p) => [p[0], p[1]])) : parts.filter((p) => p[2] === r.cle).map((p) => [p[0], p[1]]));
        if (!zones.length) continue;
        ctx.save(); ctx.beginPath();
        for (const [z0, z1] of zones) ctx.rect(X(z0), y, Math.max(1, X(z1) - X(z0)), h);
        ctx.clip();
        ctx.beginPath(); ctx.moveTo(0, bas);
        for (let px = 0; px < w; px++) {
          const i0 = Math.max(0, Math.floor((a + px / w * (b - a)) / DIAR.pas)), i1 = Math.min(DIAR.n, Math.max(i0 + 1, Math.ceil((a + (px + 1) / w * (b - a)) / DIAR.pas)));
          let m = 0; for (let i = i0; i < i1; i++) { const v = DIAR.q[i * DIAR.V + s]; if (v > m) m = v; }
          ctx.lineTo(px + 0.5, Y(m / 255));
        }
        ctx.lineTo(w, bas); ctx.closePath();
        ctx.fillStyle = vxRgba(r.couleur, 0.22); ctx.fill();
        ctx.strokeStyle = vxRgba(r.couleur, 0.8); ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = r.couleur;
        for (const [sa, sb] of VX.segs[s] || []) { if (sb < a || sa > b) continue; vxRond(ctx, X(sa), bas + 2, Math.max(2, X(sb) - X(sa) - 1), 3, 1.5); ctx.fill(); }
        ctx.restore();
      }
      ctx.setLineDash([3, 4]); ctx.strokeStyle = vxRgba(VXC.ink, 0.18);
      ctx.beginPath(); ctx.moveTo(0, Math.round(Y(VX.post.onset)) + 0.5); ctx.lineTo(w, Math.round(Y(VX.post.onset)) + 0.5); ctx.stroke(); ctx.setLineDash([]);
    }
    if (bande || r.lignes.length) vxLignes(ctx, r, a, b, X, y + 5, r.type === 'off' ? 22 : 28);
  }
  // la piste visée pendant qu'on glisse une réplique
  if (VX.glisse && VX.glisse.cible) {
    const r = VX.lignesFrise.find((x) => x.cle === VX.glisse.cible);
    if (r) { ctx.fillStyle = vxRgba(VXC.cy, 0.10); ctx.fillRect(0, r.y, w, r.h); ctx.strokeStyle = vxRgba(VXC.cy, 0.7); ctx.lineWidth = 1; ctx.strokeRect(0.5, r.y + 0.5, w - 1, r.h - 2); }
  }
  majCue(video.currentTime || 0);
}
// Les trous d'une liste d'intervalles dans [a, b].
function vxComplement(a, b, ints) {
  const out = []; let t = a;
  for (const [x, y] of ints.slice().sort((p, q) => p[0] - q[0])) { if (x > t) out.push([t, Math.min(x, b)]); t = Math.max(t, y); if (t >= b) break; }
  if (t < b) out.push([t, b]);
  return out.filter(([x, y]) => y > x);
}
function vxNoms(R) {
  const muets = typeof AU !== 'undefined' ? [...AU.muets].join(',') + ':' + AU.version : '';
  const cle = R.map((r) => r.type + ':' + (r.cle || '') + ':' + r.h + ':' + (r.nom || '') + ':' + (r.voix || []).join(',') + ':' + (r.lignes || []).length).join('|') + '|' + ((VX.glisse && VX.glisse.cible) || '') + '|' + muets;
  if (cle === VX.cleNoms) return;
  VX.cleNoms = cle;
  const box = $('vx-noms');
  box.textContent = '';
  for (const r of R) {
    const d = document.createElement('div');
    d.style.height = r.h + 'px';
    if (VX.glisse && VX.glisse.cible === r.cle) d.className = 'cible';
    // le son : un personnage qui a sa piste de voix se coupe d'un clic (son.js)
    if (r.cle && typeof SON !== 'undefined' && SON) {
      const v = auVersion();
      if (v && Object.keys(v.voix).some((k) => auCleDe(k) === r.cle)) { d.dataset.cle = r.cle; d.classList.add('audible'); d.title = 'clic : couper ou rendre sa voix · alt + clic : n’entendre que lui'; if (AU.muets.has(r.cle)) d.classList.add('muet'); }
    }
    if (r.type === 'regle') d.textContent = 'temps · plans';
    else if (r.type === 'onde') d.textContent = 'son';
    else {
      const i = document.createElement('i'); i.style.background = r.couleur;
      const nv = document.createElement('span'); nv.className = 'nv';
      const bb = document.createElement('b'); bb.textContent = r.type === 'perso' ? r.id + ' · ' + r.court : r.court; bb.title = r.nom;
      const sm = document.createElement('small');
      const nl = r.lignes.length, rep = nl + ' réplique' + (nl > 1 ? 's' : '');
      sm.textContent = r.type === 'perso' ? (r.voix.length ? 'voix ' + r.voix.map((s) => 'V' + (s + 1) + (vxPisteDe(s) === r.cle ? '' : ' (en partie)')).join(', ') + ' · ' + rep : (nl ? rep + (DIAR ? ' · sans voix' : '') : 'présent, muet'))
        : r.type === 'voix' ? 'voix sans personnage' : r.type === 'off' ? 'voix off · personne' : 'voix brute';
      nv.append(bb, sm); d.append(i, nv);
    }
    box.append(d);
  }
}
/* Les lignes d'une piste : un cartouche par ligne, sur le temps où elle est dite ; les mots à leur instant. Le trait du
   cartouche dit d'où vient l'attribution : plein et clair = la main ; tireté = l'image seule (Nemotron n'y entend
   personne) ; point ocre = la voix contredit la chaîne. */
function vxLignes(ctx, r, a, b, X, y, h) {
  for (const g of r.lignes) {
    if (g.b < a || g.a > b) continue;
    const x0 = X(g.a), x1 = X(g.b), lw = Math.max(3, x1 - x0 - 1);
    const choisi = VX.choisi === g || (VX.glisse && VX.glisse.g === g);
    ctx.fillStyle = vxRgba(r.couleur, choisi ? 0.55 : 0.34); vxRond(ctx, x0, y, lw, h, 4); ctx.fill();
    if (g.source === 'main' || choisi) { ctx.strokeStyle = choisi ? VXC.cy : vxRgba(VXC.ink, 0.85); ctx.lineWidth = 1.4; vxRond(ctx, x0 + 0.7, y + 0.7, lw - 1.4, h - 1.4, 4); ctx.stroke(); }
    else if (g.source === 'image' || g.faible) { ctx.setLineDash([3, 3]); ctx.strokeStyle = vxRgba(r.couleur, 0.9); ctx.lineWidth = 1; vxRond(ctx, x0 + 0.5, y + 0.5, lw - 1, h - 1, 4); ctx.stroke(); ctx.setLineDash([]); }
    // la voix contredit la chaîne : à regarder (l'ambre du portail, ce qui attend Cal)
    if (g.desaccord) { ctx.fillStyle = VXC.amb; ctx.beginPath(); ctx.arc(x0 + 5, y + 5, 2.5, 0, 7); ctx.fill(); }
    if (g.mots && g.mots.length) vxMotsDans(ctx, g.mots, X, y, h, x0, x0 + lw, g.texte, X(b));
    else { const tx = Math.max(x0, 0) + 4; vxTexteDans(ctx, g.texte, tx, y, Math.min(x0 + lw, X(b)) - 4 - tx, h); }
    VX.boites.push({ x0, x1: x0 + lw, y0: y, y1: y + h, g, piste: r.cle });
  }
}
// Les mots à leur instant quand ils y tiennent (zoomé) ; sinon la réplique entière, lisible, dans son cartouche —
// des mots coupés en traits (« Ok, | | bra… | ») ne se lisaient pas.
function vxMotsDans(ctx, mots, X, y, h, x0, x1, texte, xVu) {
  // chaque mot part de son instant ; s'il chevauche le précédent (Whisper donne parfois 0,02 s à « les »), il est
  // poussé juste après. Si la réplique ne tient plus dans son cartouche, même en petit : elle entière, sur des lignes.
  const police = (t) => { ctx.font = '600 ' + t + 'px "Chakra Petch", sans-serif'; };
  const mw = mots.map((m) => m.w.trim());
  let pos = null, taille = 0;
  for (let t = 11; t >= 7.5 && !pos; t -= 0.5) {
    police(t);
    const esp = t * 0.3, p = [];
    let fin = -Infinity;
    for (let k = 0; k < mots.length; k++) { const x = Math.max(X(mots[k].a) + 1, fin + esp); p.push(x); fin = x + ctx.measureText(mw[k]).width; }
    if (fin <= x1 - 3) { pos = p; taille = t; }
  }
  if (!pos) { const tx = Math.max(x0, 0) + 4; vxTexteDans(ctx, texte, tx, y, Math.min(x1, xVu) - 4 - tx, h); return; }
  ctx.save(); ctx.beginPath(); ctx.rect(x0, y, x1 - x0, h); ctx.clip();
  ctx.fillStyle = VXC.ink; ctx.textBaseline = 'middle'; police(taille);
  mots.forEach((m, k) => ctx.fillText(mw[k], pos[k], y + h / 2));
  ctx.restore();
}
function vxTexteDans(ctx, texte, x, y, w, h) {
  if (w < 10 || !texte) return;
  const wt = w - 2, mots = texte.split(/\s+/).filter(Boolean);
  let rendu = null;
  for (let taille = 9.5; taille >= 6; taille -= 0.5) {
    ctx.font = '600 ' + taille + 'px "Chakra Petch", sans-serif';
    const pas = taille * 1.18, max = Math.max(1, Math.floor((h - 2) / pas)), lignes = [];
    let cur = '';
    for (const m of mots) { const e = cur ? cur + ' ' + m : m; if (!cur || ctx.measureText(e).width <= wt) cur = e; else { lignes.push(cur); cur = m; } }
    if (cur) lignes.push(cur);
    rendu = { pas, max, lignes };
    if (lignes.length <= max && lignes.every((l) => ctx.measureText(l).width <= wt)) break;
  }
  let { pas, max, lignes } = rendu;
  const ellipse = (l) => { while (l && ctx.measureText(l + '…').width > wt) l = l.slice(0, -1); return l.trimEnd() + '…'; };
  if (lignes.length > max) { lignes = lignes.slice(0, max); lignes[max - 1] = ellipse(lignes[max - 1]); }
  lignes = lignes.map((l) => (ctx.measureText(l).width > wt ? ellipse(l) : l));
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = VXC.ink; ctx.textBaseline = 'middle';
  const y0 = y + (h - lignes.length * pas) / 2 + pas / 2;
  lignes.forEach((l, i) => ctx.fillText(l, x + 2, y0 + i * pas));
  ctx.restore();
}

/* ── le son, décodé dans la page : au pixel, creux et crête, l'énergie plus claire, teinté du personnage qui parle ── */
const VX_ONDE = { etat: null, x: null };
async function vxChargeOnde() {
  if (VX_ONDE.etat) return;
  VX_ONDE.etat = 'charge';
  if (D > 1800) { VX_ONDE.etat = 'trop long'; return; }
  try {
    // la vidéo telle qu'elle se lit (R2 ou à côté de la page), sinon son repli (data-repli)
    let rep = null;
    for (const u of [video.currentSrc || video.src, video.dataset.repli]) {
      if (!u) continue;
      try { rep = await fetch(u); if (rep.ok) break; } catch (e) { rep = null; }
    }
    if (!rep || !rep.ok) throw new Error(rep ? String(rep.status) : 'injoignable');
    if (+rep.headers.get('content-length') > 700 * 2 ** 20) throw new Error('trop lourd');
    const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await rep.arrayBuffer());
    const n = audio.length, nc = audio.numberOfChannels, x = new Float32Array(n);
    for (let c = 0; c < nc; c++) { const d = audio.getChannelData(c); for (let i = 0; i < n; i++) x[i] += d[i] / nc; }
    const P = 64, nb = Math.ceil(n / P), mn = new Float32Array(nb), mx = new Float32Array(nb), e2 = new Float32Array(nb);
    let crete = 1e-4;
    for (let q = 0; q < nb; q++) {
      let lo = 1, hi = -1, e = 0; const i1 = Math.min(n, (q + 1) * P);
      for (let i = q * P; i < i1; i++) { const v = x[i]; if (v < lo) lo = v; if (v > hi) hi = v; e += v * v; }
      mn[q] = lo; mx[q] = hi; e2[q] = e; if (hi > crete) crete = hi; if (-lo > crete) crete = -lo;
    }
    Object.assign(VX_ONDE, { etat: 'pret', x, taux: audio.sampleRate, P, mn, mx, e2, crete });
    // le son choisi n'est pas la VO entière (son.js) : la forme d'onde montre ce qu'on entend
    if (typeof auOnde === 'function') { auOnde(); return; }
  } catch (e) { VX_ONDE.etat = 'echec'; }
  vxDessine();
}
function vxOnde(ctx, a, b, w, y, h) {
  const mid = y + h / 2, amp = h / 2 - 3, O = VX_ONDE;
  // la teinte de chaque colonne : le personnage (ou la voix) dont une ligne couvre cet instant
  const teinte = new Array(w).fill(null);
  for (const r of VX.pistes) for (const g of r.lignes) {
    if (g.b < a || g.a > b) continue;
    const p0 = Math.max(0, Math.floor((g.a - a) / (b - a) * w)), p1 = Math.min(w, Math.ceil((g.b - a) / (b - a) * w));
    for (let p = p0; p < p1; p++) if (!teinte[p]) teinte[p] = r.type === 'off' ? null : r.couleur;
  }
  const couleur = (p, fort) => (teinte[p] ? vxRgba(teinte[p], fort ? 0.95 : 0.5) : (fort ? vxRgba(VXC.ink, 0.7) : vxRgba(VXC.ink2, 0.35)));
  if (O.etat === 'pret') {
    const k = amp / O.crete, spp = (b - a) * O.taux / w;
    if (spp < 2) {
      ctx.lineWidth = 1.2;
      let prec;
      for (let px = 0; px < w; px++) {
        const i = Math.floor((a + px / w * (b - a)) * O.taux);
        if (i < 0 || i >= O.x.length) continue;
        if (teinte[px] !== prec || px === 0) { if (px) ctx.stroke(); ctx.beginPath(); ctx.strokeStyle = couleur(px, true); ctx.moveTo(px, mid - O.x[i] * k); prec = teinte[px]; }
        else ctx.lineTo(px, mid - O.x[i] * k);
      }
      ctx.stroke();
    } else {
      for (let px = 0; px < w; px++) {
        const i0 = Math.max(0, Math.floor((a + px / w * (b - a)) * O.taux)), i1 = Math.min(O.x.length, Math.max(i0 + 1, Math.floor((a + (px + 1) / w * (b - a)) * O.taux)));
        if (i0 >= i1) continue;
        let lo = 1, hi = -1, e = 0, n = 0;
        if (i1 - i0 < O.P * 2) { for (let i = i0; i < i1; i++) { const v = O.x[i]; if (v < lo) lo = v; if (v > hi) hi = v; e += v * v; } n = i1 - i0; }
        else { const b0 = Math.floor(i0 / O.P), b1 = Math.ceil(i1 / O.P); for (let q = b0; q < b1; q++) { if (O.mn[q] < lo) lo = O.mn[q]; if (O.mx[q] > hi) hi = O.mx[q]; e += O.e2[q]; } n = (b1 - b0) * O.P; }
        const rms = Math.sqrt(e / n);
        ctx.fillStyle = couleur(px, false); ctx.fillRect(px, mid - hi * k, 1, Math.max(1, (hi - lo) * k));
        ctx.fillStyle = couleur(px, true); ctx.fillRect(px, mid - rms * k, 1, Math.max(1, 2 * rms * k));
      }
    }
  } else if (DIAR && DIAR.r.enveloppe) {
    // sans le son (vidéo absente, trop lourde) : l'enveloppe gardée avec la diarisation, des crêtes toutes les 20 ms
    const E = DIAR.r.enveloppe;
    if (!E.qb) { const bin = atob(E.q || ''); E.qb = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) E.qb[i] = bin.charCodeAt(i); }
    for (let px = 0; px < w; px++) {
      const i0 = Math.floor((a + px / w * (b - a)) / E.pas_s), i1 = Math.max(i0 + 1, Math.ceil((a + (px + 1) / w * (b - a)) / E.pas_s));
      let m = 0; for (let i = Math.max(0, i0); i < Math.min(E.n, i1); i++) if (E.qb[i] > m) m = E.qb[i];
      const hh = Math.max(0.5, m / 255 * amp);
      ctx.fillStyle = couleur(px, false); ctx.fillRect(px, mid - hh, 1, hh * 2);
    }
  }
  ctx.fillStyle = vxRgba(VXC.ink, 0.10); ctx.fillRect(0, Math.round(mid), w, 1);
  if (O.etat === 'charge') { ctx.fillStyle = VXC.ink3; ctx.font = '400 9px "Azeret Mono", monospace'; ctx.textBaseline = 'top'; ctx.fillText('DÉCODAGE DU SON…', 6, y + 4); }
}

/* ═══════════════════════════════════════════════════════════════════ la lecture ── */
function majCue(t) {
  const c = $('vx-cue'), z = $('vx-zone');
  if (!c || !z) return;
  let [a, b] = vxFenetre();
  // pendant la lecture, zoomé : la frise suit la cue
  if (VX.zoom > 1 && !video.paused && (t < a || t > b)) { z.scrollLeft = Math.max(0, t / D * z.clientWidth * VX.zoom - z.clientWidth * 0.1); return; }
  const x = (t - a) / (b - a) * z.clientWidth;
  c.hidden = t < a || t > b;
  c.style.left = x + 'px';
}
/* Le sous-titre : une ligne par personnage qui parle à cet instant, chaque mot souligné quand on l'entend. */
function majSousTitre(t) {
  const box = $('st'); if (!box) return;
  const ici = VX.lignes.filter((g) => g.a - 0.12 <= t && t < g.b + 0.25);
  const avance = (g) => (g.mots ? g.mots.filter((m) => m.a <= t).length + (g.mots.some((m) => m.a <= t && t < m.b) ? 'i' : '') : '');
  // (qui parle entre dans la clé : une correction qui arrive après coup — les corrections partagées lues au chargement, une
  // annulation — change le personnage d'une ligne sans changer sa place ; sans lui, le sous-titre gardait l'ancien)
  const cle = ici.map((g) => VX.lignes.indexOf(g) + ':' + (g.perso || g.s) + ':' + avance(g)).join('|');
  if (cle === box.dataset.cle) return;
  box.dataset.cle = cle;
  box.textContent = '';
  for (const g of ici) {
    const r = VX.pistes.find((x) => x.cle === g.piste) || { couleur: VXC.ink3, court: '' };
    const ligne = document.createElement('div'); ligne.className = 'ligne';
    const qui = document.createElement('span'); qui.className = 'qui';
    const i = document.createElement('i'); i.style.background = r.couleur;
    qui.append(i, g.perso ? g.perso : (g.s >= 0 ? 'V' + (g.s + 1) : 'off'));
    const dit = document.createElement('span'); dit.className = 'dit';
    if (g.mots) for (const m of g.mots) { const s = document.createElement('span'); s.className = 'm' + (m.a <= t ? (t < m.b ? ' ici' : ' dit') : ''); s.textContent = m.w.trim() + ' '; dit.append(s); }
    else dit.textContent = g.texte;
    ligne.append(qui, dit);
    box.append(ligne);
  }
  vxAjusteST(box);
}
// Le sous-titre a une hauteur fixe (la timeline dessous ne doit pas bouger) : trop long, il rétrécit jusqu'à tenir.
function vxAjusteST(box) {
  let t = 15.5;
  box.style.setProperty('--st-taille', t + 'px');
  while (t > 10 && box.scrollHeight > box.clientHeight + 1) { t -= 0.5; box.style.setProperty('--st-taille', t + 'px'); }
}

/* ═══════════════════════════════════════════════════ réattribuer une réplique ── */
// cible : 'P3' (un personnage), '' (personne, voix off), null (revenir à l'automatique).
function vxAttribueA(g, cible) {
  window.xvMemorise(cible === null ? 'rendre « ' + g.texte + ' » à l’automatique'
    : 'réattribuer « ' + g.texte + ' » à ' + (cible === '' ? 'personne' : cible + ' · ' + castName(cible)));
  const c = window.xvCorrections();
  c.locuteurs = c.locuteurs || {};
  const base = (window.XV_CORR_FICHIER || {}).locuteurs || {};
  const cur = Object.prototype.hasOwnProperty.call(c.locuteurs, g.cle) ? c.locuteurs[g.cle] : base[g.cle];
  if (g.i0 === 0 && g.i1 === g.n) c.locuteurs[g.cle] = cible;
  else {
    const arr = Array.isArray(cur) ? cur.slice() : new Array(g.n).fill(typeof cur === 'string' ? cur : null);
    for (let i = g.i0; i < g.i1; i++) arr[i] = cible;
    c.locuteurs[g.cle] = arr.every((x) => x === null) ? null : (arr.every((x) => x === arr[0]) ? arr[0] : arr);
  }
  // null reste écrit : il doit pouvoir défaire une attribution venue du fichier partagé
  window.xvPoseCorrections(c);
  VX.choisi = null;
  vxFermeMenu();
  window.xvRafraichir();
  vxEnregistre();
}
function vxForceVoix(s, qui) {
  const v = 'la voix V' + (s + 1);
  window.xvMemorise(qui === '__auto' ? 'rendre ' + v + ' à l’automatique' : qui === '' ? 'ranger ' + v + ' sous « personne »'
    : 'donner ' + v + ' à ' + qui + ' · ' + castName(qui));
  const c = window.xvCorrections();
  c.voix = c.voix || {};
  if (qui === '__auto') c.voix['V' + (s + 1)] = null; else c.voix['V' + (s + 1)] = qui;
  window.xvPoseCorrections(c);
  window.xvRafraichir();
  vxEnregistre();
}
// Le dépôt partagé (Cloudflare, outils/partage) reçoit tout de suite certaines corrections — les attributions de la timeline, les fusions du
// casting — sans bouton. Seules ces clés partent : un nom tapé mais pas appliqué reste dans ce navigateur.
const vxMinuteries = {};
window.xvEnregistrePartage = function (cles, etat) {
  const cle = cles.join(',');
  clearTimeout(vxMinuteries[cle]);
  vxMinuteries[cle] = setTimeout(async () => {
    const base = window.XV_CORR_FICHIER || {}, loc = window.xvCorrections(), c = Object.assign({}, base);
    for (const k of cles) {
      c[k] = Object.assign({}, base[k] || {}, loc[k] || {});
      for (const [x, v] of Object.entries(c[k])) if (v === null && !(base[k] || {})[x]) delete c[k][x];
    }
    const dit = (t, local) => { if (etat) { etat.textContent = t; etat.className = local ? 'etat local' : 'etat'; if (window.XV_PARTAGE_REFUS) etat.title = window.XV_PARTAGE_REFUS; } };
    // dans le portail, le portail garde les corrections (le dépôt partagé de MOVIE_ANALYSE y refuse l'écriture)
    const cible = window.XV_CORR_PORTAIL || window.XV_CORR_URL;
    if (!cible) { dit('gardé dans ce navigateur', true); return; }
    try {
      const r = await fetch(cible, { method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(c, null, 2) });
      if (r.ok && (await r.json().catch(() => ({}))).ok === true) {
        window.XV_CORR_FICHIER = c;
        // parti chez tout le monde : ce navigateur ne garde plus ces clés pour lui
        const l = window.xvCorrections(); for (const k of cles) l[k] = {}; window.xvPoseCorrections(l);
        dit(window.XV_CORR_PORTAIL ? 'enregistré dans le portail, pour tous' : 'enregistré pour tous'); window.xvEtatPartage(); return;
      }
      throw new Error('réponse ' + r.status);
    } catch (e) { dit(window.XV_CORR_PORTAIL ? 'gardé dans ce navigateur — le portail n’a pas enregistré (' + e.message + ')' : 'gardé dans ce navigateur — le dépôt partagé ne répond pas', true); }
  }, 500);
};
function vxEnregistre() { window.xvEnregistrePartage(['locuteurs', 'voix'], $('vx-etat')); }
// Ce que CE navigateur garde et que le dépôt partagé n'a pas : des gestes pas encore envoyés (le dépôt partagé ne répondait pas),
// ou une vieille mémoire d'avant le 25/09 — elle passait par-dessus les corrections des autres sans rien dire. On le
// montre, avec le choix : les partager, ou les oublier.
const VX_CLES_CORR = ['noms', 'fusions', 'repliques', 'locuteurs', 'voix'];
function vxEnAttente() {
  const f = window.XV_CORR_FICHIER || {}, l = window.xvCorrections(), out = [];
  for (const k of VX_CLES_CORR) for (const [x, v] of Object.entries(l[k] || {})) {
    let fv = (f[k] || {})[x];
    // ce que vaut une clé absente du fichier : une fusion « à part » (x → x), l'automatique (null) pour le reste — un
    // nom ou une réplique remis à null par une annulation n'est pas une modification en attente
    if (fv === undefined) fv = k === 'fusions' ? x : null;
    if (JSON.stringify(v === undefined ? null : v) !== JSON.stringify(fv)) out.push(k + ':' + x);
  }
  return out;
}
window.xvEtatPartage = function () {
  const b = $('vx-local'), e = $('vx-etat'); if (!b) return;
  // dans le portail : on lit le dépôt partagé de MOVIE_ANALYSE, on écrit dans le portail — et on dit pourquoi (XV_PARTAGE_REFUS)
  const lu = window.XV_PARTAGE === 'lu' ? (window.XV_CORR_PORTAIL ? 'corrections : dépôt partagé lu · enregistrées dans le portail' : 'corrections partagées : lues')
    : window.XV_PARTAGE === 'injoignable' ? 'dépôt partagé injoignable : les corrections des autres ne sont pas lues'
      : window.XV_CORR_PORTAIL && window.XV_PORTAIL === 'lu' ? 'corrections : enregistrées dans le portail' : '';
  if (e && !e.textContent) { e.textContent = lu; if (window.XV_PARTAGE_REFUS) e.title = window.XV_PARTAGE_REFUS; }
  if (e && window.XV_PARTAGE === 'injoignable') e.className = 'etat local';
  const n = vxEnAttente().length;
  b.hidden = !n; b.textContent = '';
  if (!n) return;
  b.append(n + ' modification' + (n > 1 ? 's' : '') + ' de ce navigateur, pas ' + (window.XV_CORR_PORTAIL ? 'dans le portail' : 'dans le dépôt partagé') + ' : ');
  const bouton = (t, f) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'vx-bouton'; x.textContent = t; x.addEventListener('click', f); b.append(x); };
  bouton('Les partager', () => { window.xvEnregistrePartage(VX_CLES_CORR, $('vx-etat')); });
  bouton('Les oublier', () => { window.xvMemorise('oublier ' + n + ' modification' + (n > 1 ? 's' : '') + ' de ce navigateur'); window.xvPoseCorrections({}); window.xvRafraichir(); window.xvEtatPartage(); });
};

/* ══════════════════════════════════════════════════════ annuler, rétablir ══
   La pile commune du portail (commun/undo.js), posée par analyse/film/film.js : window.xvBrancheAnnulation(U). film.js
   est un module, exécuté après ce script — d'où le branchement après coup, comme le menu commun (SR_MENU). Chaque geste
   est un instantané des corrections (U.snapshots) ; annuler repose l'état d'avant, tout entier, et l'enregistre comme
   un geste de plus (au portail, pour les clés qui y partent seules). Le clavier (Ctrl+Z, Ctrl+Maj+Z, Ctrl+Y, lus par
   e.key), les boutons ↶ ↷ et le journal sont ceux d'undo.js ; dans un champ, Ctrl+Z est au navigateur.
   S'annulent : réattribuer une réplique (menu, glisser), la rendre à l'automatique, forcer une voix, réunir ou séparer
   des fiches, défaire les fusions, tout remettre, remettre en automatique, « les oublier », renommer (« Appliquer »),
   corriger le texte d'une réplique (un geste par saisie : du moment où le champ prend la main à celui où il la rend),
   repartir de la chaîne.
   Ne s'annulent pas : « Enregistrer » et « Publier sur GitHub » (partis hors de la page, pour tous : on les défait en
   corrigeant de nouveau) ; les seuils de NeMo et « montrer les voix brutes » (des réglages de lecture gardés par ce
   navigateur, pas des corrections) ; la vue (onglet, zoom, disposition, son choisi).
   La page ouverte seule, sans le portail (pas de film.js) : un repli — annuler sans rétablir, 80 états, les boutons
   « ↶ Annuler » de la page et Ctrl+Z, lu par e.key (la touche Z d'un clavier AZERTY aussi) ; il se tait dès qu'undo.js
   est là. */
const VX_CLES = ['locuteurs', 'voix', 'fusions', 'noms', 'repliques'];
// les clés qui partent seules au portail à chaque geste (un nom attend « Enregistrer », comme avant)
const VX_PARTAGEES = ['locuteurs', 'voix', 'fusions', 'repliques'];
// ce que vaut une clé absente : une fusion « à part » (x → x), l'automatique (null) pour le reste
const vxNeutre = (k, x, v) => v === null || v === undefined || (k === 'fusions' && v === x);
// l'état des corrections tel que la page le montre (le fichier, le dépôt partagé, le portail, puis ce navigateur),
// sans les valeurs neutres et dans un ordre fixe : deux états égaux s'écrivent pareil
function vxEtat() {
  const f = window.XV_CORR_FICHIER || {}, l = window.xvCorrections(), e = {};
  for (const k of VX_CLES) {
    const m = Object.assign({}, f[k] || {}, l[k] || {}), o = {};
    for (const x of Object.keys(m).sort()) if (!vxNeutre(k, x, m[x])) o[x] = m[x];
    e[k] = o;
  }
  return e;
}
// reposer un état : ce navigateur ne garde que ce qui diffère de la base ; ce que la base dit en trop est défait
// explicitement (sinon le fichier, le dépôt partagé ou le portail le rendraient) ; ce qui a changé et part seul au
// portail y part
function vxRestaure(e) {
  const f = window.XV_CORR_FICHIER || {}, avant = vxEtat(), c = window.xvCorrections(), parties = [];
  for (const k of VX_CLES) {
    const base = f[k] || {}, voulu = (e && e[k]) || {}, loc = {};
    for (const [x, v] of Object.entries(voulu)) if (JSON.stringify(base[x]) !== JSON.stringify(v)) loc[x] = v;
    for (const [x, v] of Object.entries(base)) if (!(x in voulu) && !vxNeutre(k, x, v)) loc[x] = k === 'fusions' ? x : null;
    c[k] = loc;
    if (JSON.stringify(avant[k]) !== JSON.stringify(voulu)) parties.push(k);
  }
  window.xvPoseCorrections(c);
  window.xvRafraichir();
  const envoi = parties.filter((k) => VX_PARTAGEES.includes(k));
  if (envoi.length) window.xvEnregistrePartage(envoi, $('vx-etat'));
  window.xvEtatPartage();
}
const VX_ANNUL = { U: null, T: null, repli: [], avant: null };
window.xvBrancheAnnulation = (U) => {
  if (VX_ANNUL.T || !U || typeof U.snapshots !== 'function') return;
  VX_ANNUL.U = U;
  VX_ANNUL.T = U.snapshots({ get: vxEtat, set: vxRestaure });
  VX_ANNUL.T.reset();
  VX_ANNUL.repli = [];
  // les boutons de la page cèdent la place à ceux de la pile commune (↶ ↷ journal) : leurs bulles disent le geste
  for (const id of ['vx-annuler', 'cast-annuler']) {
    const b = $(id); if (!b) continue;
    const g = document.createElement('span');
    g.className = 'sr-undo'; g.setAttribute('role', 'group'); g.setAttribute('aria-label', 'annuler, rétablir');
    g.append(...U.buttons());
    b.replaceWith(g);
  }
};
// un geste : son début (l'état d'avant, relu à cet instant — les corrections des autres ont pu arriver depuis), sa fin
// (l'état d'après, rangé sous son libellé, un verbe). xvMemorise(libellé) : les deux, autour d'un geste immédiat.
function vxDebut() {
  if (VX_ANNUL.T) VX_ANNUL.T.reset(); else VX_ANNUL.avant = JSON.stringify(vxEtat());
}
function vxFin(label) {
  if (VX_ANNUL.T) { VX_ANNUL.T.commit(label || 'corriger'); return; }
  const avant = VX_ANNUL.avant; VX_ANNUL.avant = null;
  if (avant === null || avant === JSON.stringify(vxEtat())) return;
  VX_ANNUL.repli.push({ label: label || 'corriger', e: avant });
  if (VX_ANNUL.repli.length > 80) VX_ANNUL.repli.shift();
  vxMajAnnuler();
}
window.xvGesteDebut = vxDebut;
window.xvGesteFin = vxFin;
window.xvMemorise = (label) => { vxDebut(); setTimeout(() => vxFin(label), 0); };
window.xvAnnule = () => {
  if (VX_ANNUL.U) return VX_ANNUL.U.undo();
  const d = VX_ANNUL.repli.pop(); if (!d) return null;
  vxRestaure(JSON.parse(d.e)); vxMajAnnuler();
  const e = $('vx-etat'); if (e) e.textContent = 'annulé : ' + d.label;
  return d;
};
window.xvRetablit = () => (VX_ANNUL.U ? VX_ANNUL.U.redo() : null);
window.xvPeutAnnuler = () => (VX_ANNUL.U ? VX_ANNUL.U.canUndo() : VX_ANNUL.repli.length > 0);
window.xvPeutRetablir = () => (VX_ANNUL.U ? VX_ANNUL.U.canRedo() : false);
function vxMajAnnuler() {
  const n = VX_ANNUL.repli.length;
  for (const id of ['vx-annuler', 'cast-annuler']) {
    const b = $(id); if (!b) continue;
    b.disabled = !n; b.title = n ? 'Annuler : ' + VX_ANNUL.repli[n - 1].label + ' · Ctrl+Z' : 'rien à annuler';
  }
}
// Tout remettre comme le dépôt : les répliques déplacées, les voix forcées, les fiches réunies dans la page sont
// défaites ; ce que le corrections.json du dépôt attribue (relu, commité) reste, comme les fusions cuites au rendu ;
// les noms et les répliques corrigés ne bougent pas.
window.xvRemetTout = () => {
  if (!confirm('Tout remettre comme le dépôt ? Les répliques déplacées, les voix forcées et les fiches réunies dans cette page sont défaites, pour tout le monde. Ctrl+Z (ou ↶) le défait.')) return;
  window.xvMemorise('tout remettre comme le dépôt');
  const cuites = {}, depot = window.XV_CORR_DEPOT || {};
  ((typeof DATA0 !== 'undefined' && DATA0.cast) || []).forEach((q) => (q.absorbees || []).forEach((a) => { cuites[a] = true; }));
  const e = vxEtat(), vide = { locuteurs: Object.assign({}, depot.locuteurs || {}), voix: Object.assign({}, depot.voix || {}), fusions: {},
    noms: e.noms, repliques: e.repliques };
  for (const [x, v] of Object.entries(e.fusions)) if (cuites[x]) vide.fusions[x] = v;
  vxRestaure(vide);
};

/* ── le menu d'une réplique : à qui l'attribuer ── */
function vxFermeMenu() { const m = document.querySelector('.vx-menu'); if (m) m.remove(); }
// Dans le portail, le menu commun (commun/menu.js, posé par analyse/film/film.js dans window.SR_MENU) : le même qu'au clic
// droit partout ailleurs — clavier, sous-menus, une entrée désactivée dit pourquoi. Les pastilles sont les jetons des
// personnages (--pc-N, analyse/film/film.css). Sans lui (la page ouverte seule), le menu de la page.
const VX_SOURCE_FR = { main: 'attribuée à la main', 'lèvres': 'vue et entendue', voix: 'reconnue à la voix', image: 'l’image seule — Nemotron n’y entend personne', 'chaîne': 'attribution de la chaîne', aucune: 'personne' };
function vxMenuCommun(g, clientX, clientY) {
  const M = window.SR_MENU;
  VX.choisi = g; vxDessine();
  const items = vxItemsReplique(g);
  // en fin, les entrées communes du portail : annuler, rétablir (le geste qu'on vient de faire), le journal…
  if (M.commonItems) items.push('-', ...M.commonItems());
  const ouvert = M.menu(clientX, clientY, items);
  // le menu refermé (entrée choisie, clic ailleurs, Échap) : la réplique n'est plus désignée
  if (ouvert && ouvert.node) {
    const obs = new MutationObserver(() => { if (!document.contains(ouvert.node)) { obs.disconnect(); if (VX.choisi === g) { VX.choisi = null; vxDessine(); } } });
    obs.observe(document.body, { childList: true });
  }
}
// les entrées du menu d'une réplique (la timeline, le script : chaine/menus.js)
function vxItemsReplique(g) {
  const n = CAST_COLORS.length || 1;
  // l'en-tête du menu de la page : l'instant, d'où vient l'attribution, et ce que dit la réplique
  const dit = String(g.texte || '');
  const items = [{ head: tc(g.a) + ' → ' + tc(g.b) + ' · ' + (VX_SOURCE_FR[g.source] || g.source) },
    { label: '« ' + (dit.length > 64 ? dit.slice(0, 63) + '…' : dit) + ' »', disabled: true, why: 'la réplique choisie : l’attribuer ci-dessous' }];
  DATA.cast.forEach((c, i) => items.push({ label: c.id + ' · ' + c.name, dot: 'pc-' + (i % n), sub: g.perso === c.id ? 'actuel' : '',
    title: '« ' + g.texte + ' » → ' + c.name, onclick: () => vxAttribueA(g, c.id) }));
  items.push({ label: 'Personne — voix off, narrateur', dot: 'ink3', sub: !g.perso ? 'actuel' : '', onclick: () => vxAttribueA(g, '') });
  items.push('-');
  items.push({ label: 'Revenir à l’automatique', icon: '↺', disabled: g.source !== 'main', why: 'cette réplique n’a pas été attribuée à la main', onclick: () => vxAttribueA(g, null) });
  items.push({ label: 'Corriger le texte', icon: '✎', sub: 'script', onclick: () => {
    const el = document.querySelector('.sc-say[data-cle="' + g.l.start + '-' + g.l.end + '"]');
    if (el) { el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  } });
  return items;
}
function vxMenu(g, clientX, clientY) {
  vxFermeMenu();
  if (window.SR_MENU && window.SR_MENU.menu) { vxMenuCommun(g, clientX, clientY); return; }
  VX.choisi = g; vxDessine();
  const plot = document.querySelector('.vx-plot'), rp = plot.getBoundingClientRect();
  const m = document.createElement('div'); m.className = 'vx-menu';
  const t = document.createElement('div'); t.className = 't';
  t.textContent = tc(g.a) + ' → ' + tc(g.b) + ' · ' + ({ main: 'attribuée à la main', 'lèvres': 'vue et entendue', voix: 'reconnue à la voix', image: 'l’image seule — Nemotron n’y entend personne', 'chaîne': 'attribution de la chaîne', aucune: 'personne' }[g.source] || g.source);
  const dit = document.createElement('div'); dit.className = 'dit'; dit.textContent = '« ' + g.texte + ' »';
  m.append(t, dit);
  const bouton = (couleur, texte, cible, courant) => {
    const b = document.createElement('button'); b.type = 'button';
    if (courant) b.setAttribute('aria-current', 'true');
    const i = document.createElement('i'); i.style.background = couleur;
    b.append(i, texte);
    b.addEventListener('click', (e) => { e.stopPropagation(); vxAttribueA(g, cible); });
    m.append(b);
  };
  for (const c of DATA.cast) bouton(castColor(c.id), c.id + ' · ' + c.name, c.id, g.perso === c.id);
  bouton(VXC.ink3, 'Personne — voix off, narrateur', '', !g.perso);
  if (g.source === 'main') { m.append(document.createElement('hr')); bouton('transparent', 'Revenir à l’automatique', null, false); }
  plot.append(m);
  const mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(0, Math.min(rp.width - mw, clientX - rp.left + 8)) + 'px';
  m.style.top = Math.max(0, Math.min(Math.max(0, rp.height - mh), clientY - rp.top + 8)) + 'px';
}

/* ═════════════════════════════════════════════════════════════ les gestes ── */
(function () {
  const zone = $('vx-zone'); if (!zone) return;
  const croix = $('vx-croix'), bulle = $('vx-bulle');
  const tDe = (clientX) => { const r = zone.getBoundingClientRect(), [a, b] = vxFenetre(); return a + (clientX - r.left) / r.width * (b - a); };
  const yDe = (clientY) => clientY - zone.getBoundingClientRect().top;
  const boite = (x, y) => VX.boites.find((q) => x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1);
  const rangA = (y) => VX.lignesFrise.find((r) => y >= r.y && y < r.y + r.h);
  const aller = (t) => { video.currentTime = Math.max(0, Math.min(D, t)); paint(video.currentTime, true); };
  let geste = null;
  zone.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    vxFermeMenu();
    const r = zone.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, q = boite(x, y);
    zone.setPointerCapture(ev.pointerId);
    geste = q ? { type: 'ligne', q, x0: ev.clientX, y0: ev.clientY, bouge: false } : { type: 'cue' };
    if (!q) aller(tDe(ev.clientX));
  });
  zone.addEventListener('pointermove', (ev) => {
    const r = zone.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    if (geste && geste.type === 'cue') { aller(tDe(ev.clientX)); return; }
    if (geste && geste.type === 'ligne') {
      if (!geste.bouge && Math.hypot(ev.clientX - geste.x0, ev.clientY - geste.y0) > 6) {
        geste.bouge = true; zone.classList.add('saisie'); bulle.hidden = true;
        VX.glisse = { g: geste.q.g, cible: null };
        const f = document.createElement('div'); f.className = 'vx-fantome'; f.id = 'vx-fantome'; document.body.append(f);
      }
      if (geste.bouge) {
        const rg = rangA(y), ok = rg && rg.cible && rg.cle !== geste.q.piste;
        VX.glisse.cible = ok ? rg.cle : null;
        const f = $('vx-fantome');
        f.textContent = geste.q.g.texte;
        const sm = document.createElement('small'); sm.textContent = ok ? '→ ' + (rg.type === 'off' ? 'personne (voix off)' : rg.id + ' · ' + rg.nom) : 'glisser sur la piste d’un personnage';
        f.append(sm);
        f.style.left = (ev.clientX + 14) + 'px'; f.style.top = (ev.clientY + 12) + 'px';
        vxDessine();
      }
      return;
    }
    // survol : la bulle
    const t = tDe(ev.clientX);
    croix.hidden = false; croix.style.left = x + 'px';
    const ici = VX.lignes.filter((g) => g.a <= t && t < g.b), dites = new Set();
    bulle.textContent = '';
    const e = (tag, cls, txt) => { const d = document.createElement(tag); d.className = cls; d.textContent = txt; return d; };
    bulle.append(e('div', 't', tc(t)));
    for (const g of ici) {
      bulle.append(e('div', 'qui', g.perso ? g.perso + ' · ' + castName(g.perso) : (g.s >= 0 ? 'V' + (g.s + 1) + ' · voix sans personnage' : 'personne')));
      if (!dites.has(g.l)) bulle.append(e('div', 'dit', '« ' + (g.mots ? g.l.text : g.texte) + ' »'));
      dites.add(g.l);
      bulle.append(e('div', 'src', ({ main: 'à la main', 'lèvres': 'vue et entendue', voix: 'reconnue à la voix', image: 'l’image seule — Nemotron n’entend personne', 'chaîne': 'attribution de la chaîne', aucune: '' }[g.source] || '')
        + (g.faible ? ' · voix faible, sous le seuil' : '') + (g.desaccord ? ' · la chaîne disait ' + vxChaine(g.l) : '')));
    }
    if (DIAR) {
      const i = Math.floor(t / DIAR.pas);
      if (i >= 0 && i < DIAR.n) {
        const p = []; for (let s = 0; s < DIAR.V; s++) p.push([DIAR.q[i * DIAR.V + s] / 255, s]);
        const top = p.filter((x2) => x2[0] >= 0.05).sort((m, n) => n[0] - m[0]).slice(0, 3);
        if (top.length) bulle.append(e('div', 'src', 'voix : ' + top.map(([v, s]) => 'V' + (s + 1) + ' ' + Math.round(v * 100) + ' %').join(' · ')));
      }
    }
    if (!ici.length && bulle.childElementCount === 1) bulle.append(e('div', 'src', 'personne ne parle'));
    bulle.hidden = false;
    const bw = bulle.offsetWidth, bh = bulle.offsetHeight;
    bulle.style.left = Math.min(r.width - bw - 4, x + 14) + 'px';
    bulle.style.top = Math.max(0, Math.min(zone.offsetHeight - bh, y - bh / 2)) + 'px';
  });
  const fin = (ev) => {
    if (geste && geste.type === 'ligne') {
      const g = geste.q.g;
      if (geste.bouge) {
        const cible = VX.glisse && VX.glisse.cible;
        VX.glisse = null; zone.classList.remove('saisie');
        const f = $('vx-fantome'); if (f) f.remove();
        if (cible) vxAttribueA(g, cible === 'off' ? '' : cible.slice(2)); else vxDessine();
      } else { aller(g.a + 0.01); vxMenu(g, ev.clientX, ev.clientY); }
    }
    geste = null;
    try { zone.releasePointerCapture(ev.pointerId); } catch (e) {}
  };
  zone.addEventListener('pointerup', fin);
  zone.addEventListener('pointercancel', fin);
  zone.addEventListener('pointerleave', () => { croix.hidden = true; bulle.hidden = true; });
  // le clic droit sur une réplique ouvre le même menu (la grammaire du portail : ⋯ et clic droit, un seul menu)
  zone.addEventListener('contextmenu', (ev) => {
    const r = zone.getBoundingClientRect(), q = boite(ev.clientX - r.left, ev.clientY - r.top);
    if (!q) return;
    ev.preventDefault(); ev.stopPropagation();
    bulle.hidden = true;
    aller(q.g.a + 0.01); vxMenu(q.g, ev.clientX, ev.clientY);
  });
  zone.addEventListener('scroll', () => vxDessine());
  zone.addEventListener('wheel', (ev) => {
    if (!(ev.altKey || ev.ctrlKey)) return;
    ev.preventDefault();
    const r = zone.getBoundingClientRect();
    vxZoome(VX.zoom * (ev.deltaY < 0 ? 1.25 : 0.8), ev.clientX - r.left);
  }, { passive: false });
  document.addEventListener('pointerdown', (ev) => { if (!ev.target.closest('.vx-menu') && !ev.target.closest('#vx-zone')) { if (document.querySelector('.vx-menu')) { vxFermeMenu(); VX.choisi = null; vxDessine(); } } });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && document.querySelector('.vx-menu')) { vxFermeMenu(); VX.choisi = null; vxDessine(); } });
  // Ctrl+Z : celui de commun/undo.js. Le repli seul (la page ouverte sans le portail) écoute ici, et se tait dès que la
  // pile commune est branchée — jamais deux piles au clavier.
  document.addEventListener('keydown', (ev) => {
    if (VX_ANNUL.T || ev.defaultPrevented || ev.altKey || ev.shiftKey || !(ev.ctrlKey || ev.metaKey) || (ev.key || '').toLowerCase() !== 'z') return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((ev.target || {}).tagName) || (ev.target && ev.target.isContentEditable)) return;
    ev.preventDefault(); window.xvAnnule();
  });
  if ($('vx-annuler')) $('vx-annuler').addEventListener('click', () => window.xvAnnule());
  if ($('vx-remise')) $('vx-remise').addEventListener('click', () => window.xvRemetTout());
  if ($('cast-annuler')) $('cast-annuler').addEventListener('click', () => window.xvAnnule());
  vxMajAnnuler();
  document.querySelectorAll('#vx-zooms button').forEach((b) => b.addEventListener('click', () => vxZoome(+b.dataset.z)));
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => setTimeout(() => { VX.cleNoms = ''; vxDessine(); }, 30)));
  window.addEventListener('resize', () => { vxZoome(VX.zoom); });
  video.addEventListener('loadedmetadata', vxChargeOnde, { once: true });
  if (video.readyState >= 1) vxChargeOnde();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { VX.cleNoms = ''; vxDessine(); });
})();
function vxZoome(z, ancreX) {
  const zone = $('vx-zone'); if (!zone) return;
  const w = zone.clientWidth, [a, b] = vxFenetre();
  const x = ancreX == null ? w / 2 : ancreX;
  const tCentre = ancreX == null ? Math.max(a, Math.min(b, video.currentTime || 0)) : a + x / w * (b - a);
  VX.zoom = Math.max(1, Math.min(48, z));
  $('vx-espace').style.width = (w * VX.zoom) + 'px';
  zone.scrollLeft = Math.max(0, tCentre / D * w * VX.zoom - x);
  document.querySelectorAll('#vx-zooms button').forEach((bt) => bt.setAttribute('aria-pressed', String(+bt.dataset.z === VX.zoom)));
  vxDessine();
}

/* ═══════════════════════════════════════════════════════ les paramètres avancés ── */
function vxAvance() {
  const box = $('vx-avance-corps'); if (!box) return;
  const el = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) { if (v == null || v === false) continue; if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c);
    return e;
  };
  box.textContent = '';
  // 1. les voix et leurs personnages
  if (DIAR) {
    const t = el('table', null, el('tr', null, el('th', { text: 'voix' }), el('th', { text: 'ancres' }), el('th', { text: 'personnage' })));
    for (const v of VX.cpl) {
      if (!v.ancres && !v.mains && !v.force && !(VX.segs[v.s] || []).length) continue;
      const sel = el('select', { 'aria-label': 'Personnage de la voix V' + (v.s + 1), onchange: (e) => vxForceVoix(v.s, e.target.value) });
      sel.append(el('option', { value: '__auto', text: 'auto — ' + (v.auto ? v.auto + ' · ' + castName(v.auto) : 'pas d’ancre') }));
      for (const c of DATA.cast) sel.append(el('option', { value: c.id, text: c.id + ' · ' + c.name }));
      sel.append(el('option', { value: '', text: 'personne — voix off' }));
      sel.value = v.force ? (v.qui || '') : '__auto';
      const anc = [v.ancres ? v.ancres + ' vue' + (v.ancres > 1 ? 's' : '') : '', v.mains ? v.mains + ' à la main' : ''].filter(Boolean).join(' · ');
      t.append(el('tr', null, el('td', null, el('b', { text: 'V' + (v.s + 1) })), el('td', { text: anc ? anc + (v.tri.length > 1 ? ' · aussi ' + v.tri.slice(1, 3).map((x) => x[0] || 'personne').join(', ') : '') : '—' }), el('td', null, sel)));
    }
    box.append(el('div', { class: 'bloc' }, el('h4', { text: 'Les voix et leurs personnages' }),
      el('p', { class: 'note', text: 'Chaque voix prend le personnage des répliques « vues et entendues » qu’elle porte, et de celles qu’on a réattribuées à la main. Une voix mal rangée se corrige aussi ici, d’un coup, pour toutes ses répliques.' }), t));
  }
  // 2. les seuils
  if (DIAR) {
    const champs = el('div', { class: 'champs' });
    for (const [k, nom, mn, mx, pas, aide] of VX_POST_CHAMPS) {
      champs.append(el('label', null, nom, el('input', { type: 'number', min: mn, max: mx, step: pas, value: VX.post[k], oninput: (e) => {
        const v = parseFloat(e.target.value); if (!isFinite(v)) return;
        VX.post[k] = Math.max(mn, Math.min(mx, v)); vxEcrit('post', VX.post); vxResegmente(); rendreTimeline(); } }), el('small', { text: aide })));
    }
    box.append(el('div', { class: 'bloc' }, el('h4', { text: 'Seuils · post-traitement de NeMo' }), champs,
      el('div', { class: 'rangee' }, el('button', { class: 'btn', type: 'button', text: 'Réglages NeMo', onclick: () => { VX.post = Object.assign({}, VX_POST_DEFAUT); vxEcrit('post', VX.post); vxResegmente(); rendreTimeline(); } }),
        el('label', { class: 'note' }, el('input', { type: 'checkbox', checked: VX.brutes, onchange: (e) => { VX.brutes = e.target.checked; vxEcrit('brutes', VX.brutes); rendreTimeline(); } }), ' montrer les 8 voix brutes'))));
  }
  // 3. d'où viennent les voix, et la main
  const loc = vxCorr().locuteurs, nMain = Object.values(loc).filter((v) => v !== null && v !== undefined).length;
  const info = el('dl', { class: 'info' });
  const ligne = (k, v) => info.append(el('dt', { text: k }), el('dd', { text: v || '—' }));
  if (DIAR) {
    const r = DIAR.r;
    ligne('modèle', (r.modele && r.modele.nom) || 'Nemotron');
    ligne('calcul', (r.machine || '') + (r.date ? ' · ' + String(r.date).replace('T', ' ') : ''));
    ligne('latence', r.latence_s != null ? String(r.latence_s).replace('.', ',') + ' s' : '');
  } else ligne('diarisation', 'pas encore calculée pour ce film : les pistes suivent l’attribution de la chaîne (lèvres, empreintes)');
  ligne('mots', VX_MOTS.size ? VX_MOTS.size + ' répliques horodatées mot à mot (Whisper)' : 'pas d’horodatage mot à mot');
  ligne('à la main', nMain ? nMain + ' réplique' + (nMain > 1 ? 's' : '') + ' réattribuée' + (nMain > 1 ? 's' : '') : 'aucune');
  const actions = el('div', { class: 'rangee' });
  if (nMain) actions.append(el('button', { class: 'btn', type: 'button', text: 'Tout remettre en automatique', onclick: () => {
    if (!confirm('Remettre toutes les répliques réattribuées à la main en automatique ?')) return;
    window.xvMemorise('remettre ' + nMain + ' réplique' + (nMain > 1 ? 's' : '') + ' en automatique');
    const c = window.xvCorrections(); c.locuteurs = {}; for (const k of Object.keys(loc)) c.locuteurs[k] = null;
    window.xvPoseCorrections(c); window.xvRafraichir(); vxEnregistre(); } }));
  if (VOIX.labo) actions.append(el('a', { class: 'btn', href: VOIX.labo, text: DIAR ? 'Recalculer, direct, micro — le labo' : 'Calculer la diarisation — le labo' }));
  box.append(el('div', { class: 'bloc' }, el('h4', { text: 'Diarisation' }), info, actions));
  // 4. les exports
  const csv = () => {
    const ech = (v) => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lignes = [['debut', 'fin', 'personnage', 'nom', 'voix', 'origine', 'texte'].join(',')].concat(VX.lignes.map((g) =>
      [g.a.toFixed(2), g.b.toFixed(2), g.perso || '', g.perso ? castName(g.perso) : '', g.s >= 0 ? 'V' + (g.s + 1) : '', g.source, g.texte].map(ech).join(',')));
    vxTelecharge((VOIX.slug || 'film') + '-dialogues.csv', '﻿' + lignes.join('\r\n'), 'text/csv;charset=utf-8');
  };
  const rttm = () => {
    const out = [];
    for (const g of VX.lignes) out.push(['SPEAKER', VOIX.slug || 'film', 1, g.a.toFixed(3), (g.b - g.a).toFixed(3), '<NA>', '<NA>', g.perso || (g.s >= 0 ? 'V' + (g.s + 1) : 'personne'), '<NA>', '<NA>'].join(' '));
    vxTelecharge((VOIX.slug || 'film') + '.rttm', out.join('\n') + '\n', 'text/plain;charset=utf-8');
  };
  const json = () => vxTelecharge((VOIX.slug || 'film') + '-voix.json', JSON.stringify({ format: 'movie-analysis-voix', version: 1, film: VOIX.slug, post: VX.post,
    voix: VX.cpl.map((v) => ({ voix: 'V' + (v.s + 1), personnage: v.qui, force: v.force, ancres: v.ancres, secondes: +v.sec.toFixed(2) })),
    lignes: VX.lignes.map((g) => ({ debut: g.a, fin: g.b, replique: g.cle, mots: [g.i0, g.i1], personnage: g.perso, voix: g.s >= 0 ? 'V' + (g.s + 1) : null, origine: g.source, texte: g.texte })) }, null, 1), 'application/json');
  box.append(el('div', { class: 'bloc' }, el('h4', { text: 'Exports' }),
    el('div', { class: 'rangee' }, el('button', { class: 'btn', type: 'button', text: 'Dialogues .csv', onclick: csv }), el('button', { class: 'btn', type: 'button', text: 'RTTM', onclick: rttm }), el('button', { class: 'btn', type: 'button', text: 'Voix .json', onclick: json }))));
}
function vxTelecharge(nom, contenu, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([contenu], { type })); a.download = nom;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
