// ODIO — le panneau « Générer » (06/10).
//
// Cal (06/10) : « câbler directement des éléments généraux d'ODIO sur notre
// mode génératif : le tempo, la tonalité (qu'on peut modifier, mais par
// défaut il prend la nôtre), un clip qui sert d'inspiration […] comme Suno et
// leur Studio : pouvoir rajouter juste un instrument […] il faut revoir le
// design de notre panneau génératif, car il est très confus » ; puis : « des
// champs de saisie super larges, ça n'a aucun sens : les paroles plus hautes
// et étroites » ; « un truc super ergonomique pour la STRUCTURE au lieu de
// taper les balises » ; « les VERSIONS : comment elles s'affichent et comment
// on affecte la bonne dans le segment de la timeline ».
// L'étude : docs/etudes/musique_generatif.md § 8.
//
// UNE seule entrée (la barre du haut, le dessin d'une région, le clic droit
// d'une plage ou d'un clip) et UNE seule question en haut : « Que veux-tu
// générer ? » — une chanson entière, un instrument seul, une variation d'un
// clip, la suite. Pour chaque réponse, les voies du schéma (intentions,
// generatif_modeles.json) : la première prête est prise, on peut en choisir
// une autre, ce qui manque est grisé avec la raison. Le panneau travaille sur
// une CIBLE : une région existante, ou une plage encore vide (le brouillon,
// P.gen.brouillon) — rien n'est posé dans l'arrangement avant « Générer ».
//
// Trois colonnes, chaque champ à la forme de ce qu'il contient :
//   les réglages   la question, où (la plage, la piste d'arrivée), ce qui vient
//                  du projet (tempo, tonalité, mesure : « du projet » ou
//                  « changé »), l'instrument, l'inspiration, le guide MIDI, le
//                  modèle, les réglages courts et avancés
//   le texte       le style (trois lignes), la structure et les paroles (une
//                  colonne haute et étroite : les sections du projet en blocs),
//                  la partition de YuE2
//   les versions   les prises de la région, en cartes (forme d'onde, écoute,
//                  « dans le segment », A/B dans le morceau)
// En pied : où le résultat atterrit et le seul orange.
//
// La structure est celle du projet (P.sections : la rangée au-dessus de l'arc
// d'énergie, une seule vérité) : un bloc est une section — son étiquette
// (tag), son nom, sa longueur, ses paroles (`paroles`, 06/10) ; ajouter,
// dupliquer, réordonner, allonger un bloc change la rangée (projet.js). Taper
// « refrain », « couplet 2 », « [chorus] » seul sur une ligne crée la section ;
// les balises du moteur ([Verse], [Chorus]…) s'écrivent seules.

import { api, jobs, toast, href, pick, stateFr } from '../commun/shell.js';
import { TONICS, TONICS_FR, MODES, SECTION_TAGS, COLORS } from './modules.js';
import { songEnd, peaks } from './moteur.js';
import { valeursArcs } from './arcs.js';
import { shiftFrom, duplicateSection, swapSection, removeSection, sorted, lireParoles, sectionsDeRegion, structureDepuisParoles, etiquetteDe } from './projet.js';
import { el, put, menu, tok, drawer } from './ui.js';
import { loadSchema, schemaNow, model, task, cond, defaultsFor, requestV, unavailable, trackFr, aceKeyOf, secs, choiceIds, choiceLabel } from './generatif_modeles.js';
import { reportVoices, chordToNotes, abcKey } from './generatif_abc.js';
import { placeNotes, listMidi, midiSub, openExtract } from './generatif_midi.js';
import { engines, engNow, effectif, fingerprint, stale, sectionsFor, regionBars, around, windowOf, renderContext,
  chooseTake, keepTake, dropTake, takesToTracks, injectFrom, check, lastCheck, setCheck, quoiDe, isRegion, isGenTrack, itemOfDrop,
  useSound } from './generatif_region.js';
import { options } from './generatif.js';

// quand le schéma ne publie pas de suggestions de style
const SUGGEST = {
  genre: ['synthwave', 'pop', 'french pop', 'indie rock', 'hip-hop', 'lo-fi', 'ambient', 'cinematic', 'funk', 'house', 'jazz'],
  instruments: ['analog synth', 'synth bass', 'drum machine', 'electric guitar', 'piano', 'strings', 'pads'],
  mood: ['dark', 'melancholic', 'uplifting', 'energetic', 'dreamy', 'warm'],
  voice: ['female vocal', 'male vocal', 'breathy', 'choir'],
};
const SUG_FR = { genre: 'genre', instruments: 'instruments', mood: 'humeur', voice: 'voix' };
const TAG_FR = Object.fromEntries(SECTION_TAGS);
const TAG_LEN = { intro: 4, outro: 4, 'pre-chorus': 4 };          // la longueur d'un bloc neuf sans paroles (mesures), sinon 8
const cap = (tag) => tag.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('-');
const SRC_FR = { selection: 'la sélection', boucle: 'la boucle', sections: 'les sections', clip: 'le clip', tete: 'ici · 8 mesures', apres: 'après la fin', manuel: 'réglée', region: 'la région' };

let O = null;                        // le panneau ouvert : { app, dr, region, paint }
let stemsO = null;                   // les séparateurs (music/stems/options), lus à l'ouverture
let player = null;                   // l'écoute d'une version seule

// ── la cible ────────────────────────────────────────────────
export function cibleOuverte(app) {
  if (!O || !document.body.contains(O.dr.root)) return null;
  return cible(app);
}
export function repeindre() { if (O && document.body.contains(O.dr.root)) O.paint(); }

function brouillon(app) {
  const P = app.S.proj;
  if (!P.gen || typeof P.gen !== 'object') P.gen = {};
  if (!P.gen.brouillon) {
    // le style du tiroir d'avant le 06/10, s'il y en avait un
    P.gen.brouillon = { quoi: 'chanson', voie: null, v: P.gen.tags ? { tags: P.gen.tags, caption: P.gen.tags.slice(0, 512) } : {}, libre: {}, plage: null, takes: [], take: null, ctx: null };
  }
  const b = P.gen.brouillon;
  b.takes = []; b.take = null; b.v = b.v || {}; b.libre = b.libre || {};
  return b;
}
function cible(app) {
  const c = O?.region && app.clip(O.region);
  if (c?.gen) return c;
  const b = brouillon(app);
  if (!b.plage) b.plage = plageDefaut(app, b);
  return { id: null, track: null, name: '', start: b.plage.a, len: Math.max(0.25, b.plage.b - b.plage.a), gen: b };
}

// La plage d'une génération neuve : la sélection de temps, sinon le clip
// choisi, la boucle, les sections (une chanson), la tête de lecture + 8 mesures.
function plageDefaut(app, g, want = null) {
  const P = app.S.proj, sig = P.sig, R = app.timeRange();
  const at = Math.max(0, Math.floor(app.pos() / sig) * sig);
  const secs = [...P.sections].sort((x, y) => x.a - y.a);
  const clip = app.clip(app.S.sel.clip);
  const src = want || (g.quoi === 'suite' ? 'apres' : R ? 'selection' : g.quoi === 'variation' && clip?.item ? 'clip'
    : clip && !isRegion(clip) ? 'clip' : P.loop?.on ? 'boucle' : g.quoi === 'chanson' && secs.length ? 'sections' : 'tete');
  if (src === 'selection' && R) return { src, a: R.a, b: R.b };
  if (src === 'clip' && clip) return { src, a: clip.start, b: clip.start + clip.len, clip: clip.id };
  if (src === 'boucle' && P.loop?.on) return { src, a: P.loop.a, b: P.loop.b };
  if (src === 'sections' && secs.length) return { src, a: secs[0].a, b: Math.max(...secs.map((s) => s.b)) };
  if (src === 'apres') { const a = Math.ceil(songEnd(P) / sig - 1e-9) * sig; return { src, a, b: a + 8 * sig }; }
  return { src: 'tete', a: at, b: at + 8 * sig };
}
const plageSuit = (app, b) => { if (b.plage?.src === 'sections') b.plage = plageDefaut(app, b, 'sections'); };

// ── les voies ───────────────────────────────────────────────
const I = () => schemaNow()?.intentions;
function etatVoie(V) {
  const E = engNow();
  if (!E || E.error) return { ok: false, why: `moteurs illisibles : ${E?.error || 'lecture…'}` };
  const x = E.engines?.[V.model]?.tasks?.[V.task];
  if (!x) return { ok: false, why: 'tâche inconnue de ce portail' };
  if (V.garder && !(stemsO?.ok && (stemsO.o.models || []).some((m) => m.ready !== false))) return { ok: false, why: `séparation indisponible : ${stemsO?.why || 'aucun séparateur prêt'}` };
  if (x.essai) return { ok: true, essai: true };
  return x.real.ok ? { ok: true, doc: x.real.doc } : { ok: false, why: `pas câblé en réel — ${x.real.pourquoi}` };
}
function voieDe(g) {
  const Q = I()?.[quoiDe(g)];
  if (!Q) return null;
  return Q.voies.find((V) => V.id === g.voie) || Q.voies.find((V) => V.model === g.model && V.task === g.task && !V.garder && !g.voie)
    || Q.voies.find((V) => etatVoie(V).ok) || Q.voies[0];
}
// la voie choisie fixe le modèle et la tâche ; ce qui a le même nom reste (le style, la graine…)
function appliquerVoie(app, c, V) {
  const g = c.gen, s = schemaNow();
  g.quoi = quoiDe(g);
  if (g.voie === V.id && g.model === V.model && g.task === V.task) return;
  const T = task(s, V.model, V.task), keep = {};
  for (const k of Object.keys(g.v || {})) if (T.params.includes(k) || k === 'tags' || k === 'caption') keep[k] = g.v[k];
  if (V.model === 'ace' && !keep.caption && g.v?.tags) keep.caption = g.v.tags.slice(0, 512);
  if (V.model === 'yue' && !keep.tags && g.v?.caption) keep.tags = g.v.caption;
  g.voie = V.id; g.model = V.model; g.task = V.task;
  g.v = { ...defaultsFor(s, V.model, V.task), ...keep };
  if (c.id) { const t = app.track(c.track); if (t?.gen) t.gen = { model: V.model, task: V.task }; }
}

// ── ouvrir ──────────────────────────────────────────────────
// { region } : une région existante ; { quoi, clip } : une génération neuve
// (une variation d'un clip de l'arrangement, par son menu)
export async function ouvrirGenerer(app, { region = null, quoi = null, clip = null } = {}) {
  await loadSchema();
  const sel = app.clip(app.S.sel.clip);
  const reg = region || (!quoi && !clip && sel && isRegion(sel) ? sel.id : null);   // une génération neuve demandée : pas la région choisie
  const dr = drawer({ title: 'Générer', cls: 'gen gp-dr', head: [el('span', { class: 'gp-tgt' })] });
  O = { app, dr, region: reg, paint: () => {} };
  put(dr.body, el('p', { class: 'lbl' }, 'lecture des moteurs…'));
  await Promise.all([engines(), options('music/stems/options', 'music.stems').then((x) => { stemsO = x; })]);
  if (!reg) {
    const b = brouillon(app);
    if (quoi) { b.quoi = quoi; b.voie = null; }
    if (clip && app.clip(clip)?.item) {
      const x = app.clip(clip);
      b.plage = { src: 'clip', a: x.start, b: x.start + x.len, clip };
      b.voie = null;
      const V = voieDe(b);
      if (V) { appliquerVoie(app, { gen: b }, V); b.v[V.task === 'reprise' ? 'ref' : 'src_audio'] = x.item; }
    } else b.plage = plageDefaut(app, b);
  }
  const paint = () => peindre(app);
  O.paint = paint;
  // l'état des travaux, à chaque relevé de la file
  const off = jobs.watch((list) => {
    for (const n of dr.root.querySelectorAll('[data-gen-job]')) {
      const j = list.find((x) => x.id === n.dataset.genJob);
      if (j) n.textContent = `${stateFr(j.state)}${j.progress != null && j.state === 'running' ? ` · ${Math.round(j.progress * 100)} %` : ''}${j.message ? ` · ${j.message}` : ''}`.slice(0, 90);
    }
  });
  const onPlaced = () => repeindre();
  document.addEventListener('mu:placed', onPlaced);
  const obs = new MutationObserver(() => { if (!document.body.contains(dr.root)) { off(); obs.disconnect(); document.removeEventListener('mu:placed', onPlaced); stopEcoute(); } });
  obs.observe(document.body, { childList: true });
  paint();
  return dr;
}

// ── le dessin ───────────────────────────────────────────────
// Redessiner retire le champ qui a le focus : son « change » (au blur) redemande un
// dessin pendant celui-ci ; il est fait juste après, jamais dedans
let enPeinture = false, encore = false;
function peindre(app) {
  if (enPeinture) { encore = true; return; }
  enPeinture = true;
  try { peindre1(app); } finally { enPeinture = false; }
  if (encore) { encore = false; peindre(app); }
}
function peindre1(app) {
  if (!O) return;
  if (!(O.region && app.clip(O.region)?.gen)) plageSuit(app, brouillon(app));     // la plage « les sections » suit la structure
  const s = schemaNow(), c = cible(app), g = c.gen, P = app.S.proj;
  const V = voieDe(g);
  if (V && (g.voie !== V.id || g.model !== V.model || g.task !== V.task)) appliquerVoie(app, c, V);
  const head = O.dr.root.querySelector('.gp-tgt');
  if (head) {
    put(head, c.id ? `région · ${app.track(c.track)?.name || ''}` : 'une plage encore vide',
      c.id ? el('button', { class: 'tb ghost sm gp-neuve', type: 'button', title: 'une autre génération, sur la plage choisie (cette région garde ses versions)',
        onclick: () => { O.region = null; const b = brouillon(app); b.plage = plageDefaut(app, b); repeindre(); } }, '+ Nouvelle') : null);
  }
  const T = task(s, g.model, g.task), M = model(s, g.model);
  const ctx = { app, s, c, g, P, V, T, M, et: V ? etatVoie(V) : { ok: false, why: 'aucune voie' } };
  const scroll = O.dr.body.scrollTop;
  put(O.dr.body,
    el('div', { class: 'gp' },
      el('div', { class: 'gp-col gp-a' }, questionBox(ctx), essentielBox(ctx), ouBox(ctx), projetBox(ctx), inspirationBox(ctx), guideBox(ctx), modeleBox(ctx)),
      el('div', { class: 'gp-col gp-b' }, styleBox(ctx), structureBox(ctx), partitionBox(ctx)),
      el('div', { class: 'gp-col gp-c' }, versionsBox(app, c, {}))),
    piedBox(ctx));
  O.dr.body.scrollTop = scroll;
  if (O.focus) {
    const ta = O.dr.body.querySelector(`.gp-bloc[data-section="${O.focus}"] textarea`);
    O.focus = null;
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }
}
const sec = (titre, ...body) => el('section', { class: 'gp-sec' }, el('h3', { class: 'gp-h' }, titre), ...body);
const commit = (app, kind = 'data') => { app.commit(kind); repeindre(); };

// 1. la question
function questionBox({ app, c, g }) {
  const Q = I();
  return sec('Que veux-tu générer ?', el('div', { class: 'gp-tiles' }, Q.ordre.map((q) => {
    const vs = Q[q].voies.map((V) => [V, etatVoie(V)]), best = vs.find(([, e]) => e.ok);
    const court = best ? model(schemaNow(), best[0].model).court : '';
    const sub = best ? `${best[0].label.includes(court) ? best[0].label : `${court} · ${best[0].label}`}${best[1].essai ? ' · essai' : ''}` : 'pas câblé';
    return el('button', { class: `gp-tile${quoiDe(g) === q ? ' on' : ''}${best ? '' : ' off'}`, type: 'button', 'data-quoi': q,
      title: best ? Q[q].doc : `${Q[q].doc}\n— ${vs[0]?.[1].why || ''}${Q[q].sans ? `\n— ${Object.values(Q[q].sans).join(' ; ')}` : ''}`,
      onclick: () => {
        if (quoiDe(g) === q) return;
        g.quoi = q; g.voie = null;
        if (!c.id && g.plage?.src !== 'manuel') g.plage = plageDefaut(app, g);
        commit(app);
      } }, el('b', {}, Q[q].label), el('span', {}, Q[q].sous), el('small', {}, sub));
  })));
}

// 2. où : la plage et la piste d'arrivée
function ouBox({ app, c, g, P }) {
  const a = c.start, b = c.start + c.len, sR = c.len * 60 / P.bpm;
  const src = c.id ? 'region' : g.plage?.src || 'tete';
  const R = app.timeRange(), clip = app.clip(app.S.sel.clip), secsP = P.sections.length;
  const choix = c.id ? null : el('div', { class: 'gp-chips' }, [
    ['selection', !R ? 'glisse une plage sur les pistes de l\'arrangement' : ''],
    ['clip', !clip || isRegion(clip) ? 'choisis un clip dans l\'arrangement' : ''],
    ['boucle', !P.loop?.on ? 'la boucle est éteinte' : ''],
    ['sections', !secsP ? 'l\'arrangement n\'a pas de section : la rangée au-dessus de l\'arc, ou la structure ci-contre' : ''],
    ['tete', ''], ['apres', ''],
  ].map(([k, why]) => el('button', { class: `opt${src === k ? ' on' : ''}`, type: 'button', disabled: why ? true : null, title: why || '',
    onclick: () => { g.plage = plageDefaut(app, g, k); commit(app); } }, SRC_FR[k])));
  const setPlage = (na, nl) => {
    na = Math.max(0, na); nl = Math.max(P.sig / 4, nl);
    if (c.id) { const r = app.clip(c.id); r.start = na; r.len = nl; commit(app); return; }
    g.plage = { src: 'manuel', a: na, b: na + nl }; commit(app);
  };
  const debut = el('input', { class: 'fld gp-num', type: 'number', min: 1, step: 1, value: Math.floor(a / P.sig) + 1, 'aria-label': 'mesure de début',
    onchange: (e) => setPlage((Math.max(1, +e.target.value) - 1) * P.sig, c.len) });
  const longueur = el('input', { class: 'fld gp-num', type: 'number', min: 0.25, step: 1, value: +(c.len / P.sig).toFixed(2), 'aria-label': 'longueur en mesures',
    onchange: (e) => setPlage(a, Math.max(0.25, +e.target.value) * P.sig) });
  const dest = destination(app, c);
  return sec('Où',
    el('div', { class: 'gp-plage' }, el('b', {}, `${app.bar(a)} → ${app.bar(b)}`), el('span', {}, `${regionBars(P, c)} mes. · ${secs(sR)}`), el('small', {}, SRC_FR[src])),
    choix,
    el('div', { class: 'gp-row' }, el('label', { class: 'gp-f' }, el('span', { class: 'lbl' }, 'mesure'), debut), el('label', { class: 'gp-f' }, el('span', { class: 'lbl' }, 'mesures'), longueur)),
    el('p', { class: 'gp-note' }, dest.texte));
}
function destination(app, c) {
  if (c.id) return { texte: `les versions se rangent dans la région, sur « ${app.track(c.track)?.name} » ; la déplacer ou l'étirer dans l'arrangement` };
  const t = pisteLibre(app, c);
  return { t, texte: t ? `le résultat atterrit sur « ${t.name} », à la place de la plage, et dans la bibliothèque du projet` : `le résultat atterrit sur une piste générative neuve (« ${nomPiste(c.gen)} »), à la place de la plage, et dans la bibliothèque du projet` };
}
function pisteLibre(app, c) {
  const t = app.track(app.S.sel.track), a = c.start, b = c.start + c.len;
  if (!isGenTrack(t)) return null;
  return app.S.proj.clips.some((x) => x.track === t.id && x.start < b && x.start + x.len > a) ? null : t;
}
function nomPiste(g) {
  const q = quoiDe(g);
  if (q === 'instrument') { const n = trackFr(schemaNow(), g.instrument || 'drums'); return n === 'other' ? 'Instrument' : n[0].toUpperCase() + n.slice(1); }
  return { chanson: 'Chanson', variation: 'Variation', suite: 'Suite' }[q] || 'Génératif';
}

// 3. ce qui vient du projet
function projetBox({ app, c, g, P }) {
  const E = effectif(P, g), L = g.libre || {};
  const setLibre = (patch) => {
    const n = { ...L, ...patch }, base = { bpm: P.bpm, sig: P.sig, tonic: P.key.tonic, mode: P.key.mode };
    for (const k of Object.keys(n)) if (n[k] === undefined || n[k] === base[k]) delete n[k];
    g.libre = n; commit(app);
  };
  const pill = (k, label, value, changed, edit, reset) => el('div', { class: `gp-pill${changed ? ' chg' : ''}`, 'data-verrou': k },
    el('i', {}, label), el('button', { class: 'gp-val', type: 'button', title: 'changer pour cette génération', onclick: edit }, value),
    el('small', {}, changed ? 'changé' : 'du projet'),
    changed ? el('button', { class: 'tb ghost sm', type: 'button', title: 'revenir à celle du projet', onclick: reset }, '↺') : null);
  const tempo = pill('bpm', 'tempo', `${E.bpm}`, 'bpm' in L, (e) => {
    const b = e.currentTarget, inp = el('input', { class: 'fld gp-num', type: 'number', min: 20, max: 300, step: 1, value: E.bpm });
    b.replaceWith(inp); inp.focus(); inp.select();
    const ok = () => { const v = Math.round(+inp.value); if (v >= 20 && v <= 300) setLibre({ bpm: v }); else { toast('tempo : de 20 à 300'); repeindre(); } };
    inp.addEventListener('change', ok); inp.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') repeindre(); });
  }, () => setLibre({ bpm: undefined }));
  const ton = pill('key', 'tonalité', `${TONICS_FR[E.key.tonic]} ${MODES[E.key.mode].label}`, 'tonic' in L || 'mode' in L, (e) => keyPop(e, E, setLibre),
    () => setLibre({ tonic: undefined, mode: undefined }));
  const mes = pill('sig', 'mesure', E.sig === 6 ? '6/8' : `${E.sig}/4`, 'sig' in L, (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    menu(r.left, r.bottom + 4, [{ head: 'mesure de cette génération' }, ...[2, 3, 4, 6].map((n) => ({ label: n === 6 ? '6/8' : `${n}/4`, checked: E.sig === n, onclick: () => setLibre({ sig: n }) }))]);
  }, () => setLibre({ sig: undefined }));
  const ace = g.model === 'ace';
  // les arcs du projet sur la plage (arcs.js, valeursArcs) : l'énergie, la densité, la tension
  // deviennent des mots du style — notre choix, aucun des deux modèles n'a d'entrée pour elles
  const { A, mots } = motsArcs(P, c);
  const pc = (v) => (v == null ? '—' : `${Math.round(v * 100)}`);
  const arcs = el('div', { class: 'gp-arcs', title: 'les arcs du projet (la rangée au-dessus de l\'arrangement), moyennés sur la plage ; une valeur loin du milieu ajoute ses mots au style' },
    el('i', {}, 'arcs'), el('span', {}, `énergie ${pc(A.energie)} · densité ${pc(A.densite)} · tension ${pc(A.tension)}`),
    el('label', { class: 'opt mu-check' }, el('input', { type: 'checkbox', checked: g.arcs !== false || null, onchange: (e) => { g.arcs = e.target.checked ? undefined : false; commit(app); } }),
      mots.length ? ` dans le style : « ${mots.join(', ')} »` : ' dans le style (rien à dire : les arcs sont au milieu, ou vides)'));
  return sec('Du projet', el('div', { class: 'gp-pills' }, tempo, ton, mes), arcs,
    el('p', { class: 'gp-note' }, ace ? `ACE-Step reçoit bpm ${E.bpm}, « ${aceKeyOf(E.key)} », mesure ${E.sig} (des nombres)${['major', 'minor'].includes(E.key.mode) ? '' : ` — le mode ${MODES[E.key.mode].label} ramené à ${aceKeyOf(E.key).split(' ')[1] === 'major' ? 'majeur' : 'mineur'} par la tierce`}`
      : `YuE2 n'a pas d'entrée tempo : « ${E.bpm} BPM, ${aceKeyOf(E.key)} » s'ajoutent au style, et sa partition dit Q:1/4=${E.bpm}, K:${abcKey(E.key)}`));
}
function keyPop(e, E, setLibre) {
  const r = e.currentTarget.getBoundingClientRect();
  const pop = el('div', { class: 'mu-menu mu-keypop', role: 'dialog' },
    el('div', { class: 'head' }, 'tonique'),
    el('div', { class: 'kp-t' }, TONICS.map((n, i) => el('button', { class: `tb sm${E.key.tonic === i ? ' on' : ' ghost'}`, type: 'button', title: TONICS_FR[i],
      onclick: () => { pop.remove(); setLibre({ tonic: i }); } }, n))),
    el('div', { class: 'head' }, 'mode'),
    el('div', { class: 'kp-m' }, Object.entries(MODES).map(([k, m]) => el('button', { class: `tb sm${E.key.mode === k ? ' on' : ' ghost'}`, type: 'button',
      onclick: () => { pop.remove(); setLibre({ mode: k }); } }, m.label))));
  document.body.append(pop);
  pop.style.left = `${Math.min(r.left, innerWidth - 340)}px`; pop.style.top = `${r.bottom + 6}px`; pop.style.zIndex = 80;
  setTimeout(() => addEventListener('pointerdown', function off(ev) { if (!pop.contains(ev.target)) { pop.remove(); removeEventListener('pointerdown', off, true); } }, true));
}

// 4. l'essentiel de la réponse : l'instrument, le clip à varier, ce qui joue autour
function essentielBox(ctx) {
  const { g, T, V } = ctx, q = quoiDe(g), out = [];
  if (q === 'instrument') out.push(instrumentBox(ctx, V?.garder && !(T?.params || []).includes('autour')));
  const sonPid = (T?.params || []).find((pid) => ['src_audio', 'ref'].includes(pid));
  if (sonPid) out.push(sec(q === 'variation' ? 'Le clip à varier' : ctx.M.params[sonPid].label, soundSlot(ctx, sonPid, { requis: true })));
  if ((T?.params || []).includes('autour')) out.push(sec(q === 'suite' ? 'Ce qui joue avant' : 'Ce qu\'elle entend', contextBox(ctx)));
  return out.length ? el('div', { class: 'gp-ess' }, out) : null;
}
const stemPret = (stem) => (stemsO?.ok ? (stemsO.o.models || []).filter((m) => m.ready !== false && (m.stems || []).includes(stem)) : []);
function instrumentBox({ app, s, g, V }, sourde = false) {
  const I0 = I();
  const ids = V?.garder ? ['drums', 'bass', 'vocals', 'guitar', 'keyboard', 'other'] : s.pistes.ordre;
  if (!g.instrument || !ids.includes(g.instrument)) g.instrument = ids[0];
  return sec('Quel instrument ?', el('div', { class: 'gp-chips' }, ids.map((id) => {
    const stem = V?.garder ? I0.stems[id]?.stem : null;
    const why = stem && !stemPret(stem).length ? `aucun séparateur prêt ne rend « ${stem} » (${stem === 'guitar' || stem === 'piano' ? 'BS-RoFormer SW, à télécharger' : 'music_stems.py'}) : choisis « autre », ou la voie « dans le contexte »` : '';
    return el('button', { class: `opt${g.instrument === id ? ' on' : ''}`, type: 'button', disabled: why ? true : null, title: why || (stem ? `on garde le stem « ${stem} »` : ''),
      onclick: () => { g.instrument = id; commit(app); } }, id === 'other' ? 'autre (tout le reste)' : trackFr(s, id));
  })), sourde ? el('p', { class: 'gp-note' }, 'elle n\'entend pas les autres pistes : une chanson au même tempo, dans la même tonalité, dont on garde un stem ; la chanson entière reste dans la bibliothèque') : null);
}

// une case de son : un clip glissé de l'arrangement, du navigateur, d'Asset, du disque, ou « la sélection »
function soundSlot({ app, c, M }, pid, { requis = false, off = '' } = {}) {
  const v = c.gen.v?.[pid];
  const title = el('span', { class: 'gp-snd-t' }, off ? 'pas ici' : v ? '…' : 'aucun');
  if (v && !off) app.loadItem(v).then((it) => { title.textContent = it.title; }).catch(() => { title.textContent = 'son introuvable'; });
  const chosen = () => app.S.proj.clips.find((x) => (app.S.sel.clips || []).includes(x.id) && x.id !== c.id && x.item);
  const set = (id, clip = null) => {
    c.gen.v = { ...c.gen.v, [pid]: id };
    if (clip && !c.id && ['src_audio', 'ref'].includes(pid)) c.gen.plage = { src: 'clip', a: clip.start, b: clip.start + clip.len, clip: clip.id };
    commit(app);
  };
  const slot = el('div', { class: `gp-snd${v && !off ? ' has' : ''}${off ? ' off' : ''}`, 'data-gen-slot': off ? null : pid, 'data-gen-region': c.id || '',
    title: off || 'glisser ici un clip audio de l\'arrangement, un son du navigateur, d\'Asset ou du disque' },
  title, el('span', { class: 'sp' }),
  el('button', { class: 'tb ghost sm', type: 'button', disabled: off ? true : null, title: off || 'le clip audio choisi dans l\'arrangement',
    onclick: () => { const x = chosen(); if (!x) { toast('choisis d\'abord un clip audio dans l\'arrangement'); return; } set(x.item, x); } }, 'Sélection'),
  el('button', { class: 'tb ghost sm', type: 'button', disabled: off ? true : null, onclick: async () => { const [it] = await pick({ kinds: ['audio'], title: M.params[pid]?.label || 'Un son' }); if (it) set(it.id); } }, 'Choisir'),
  v && !off ? el('button', { class: 'tb ghost sm', type: 'button', title: 'retirer', onclick: () => { const n = { ...c.gen.v }; delete n[pid]; c.gen.v = n; commit(app); } }, '×') : null);
  if (!off) {
    slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drop-on'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('drop-on'));
    slot.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation(); slot.classList.remove('drop-on');
      try {
        const id = await itemOfDrop(e);
        const it = id && await app.loadItem(id);
        if (!it || it.kind !== 'audio') { toast(`${M.params[pid]?.label || 'cette case'} : un son`); return; }
        set(it.id);
      } catch (err) { toast(err.message); }
    });
  }
  return el('div', { class: 'gp-f', 'data-requis': requis ? '' : null }, slot, off ? el('p', { class: 'gp-why' }, off) : null);
}
function contextBox({ app, c, g, P }) {
  const vals = { ...g.v }, [w0, w1] = windowOf(P, c, vals.marge);
  const list = around(app, c, w0, w1);
  const on = new Set(g.ctx || list.map((t) => t.id));
  const marge = el('input', { class: 'fld gp-num', type: 'number', min: 0, max: 8, step: 1, value: vals.marge ?? 2, 'aria-label': 'marge en mesures',
    onchange: (e) => { g.v = { ...g.v, marge: Math.max(0, Math.min(8, Math.round(+e.target.value))) }; commit(app); } });
  return el('div', { class: 'gp-f' },
    list.length ? el('div', { class: 'gp-chips' }, list.map((t) => el('button', { class: `opt${on.has(t.id) ? ' on' : ''}`, type: 'button', style: { '--c': `var(--${t.color})` },
      onclick: () => { if (on.has(t.id)) on.delete(t.id); else on.add(t.id); g.ctx = [...on]; commit(app); } }, el('i', { class: 'dot' }), t.name)))
      : el('p', { class: 'gp-why' }, 'rien ne joue autour de la plage : pose des clips sur d\'autres pistes'),
    el('div', { class: 'gp-row' }, el('label', { class: 'gp-f' }, el('span', { class: 'lbl' }, 'marge (mesures)'), marge),
      el('span', { class: 'gp-note' }, `${app.bar(w0)} → ${app.bar(w1)} · ${secs((w1 - w0) * 60 / P.bpm)}, rendu puis envoyé`)));
}

// 5. l'inspiration et le guide MIDI
function inspirationBox(ctx) {
  const { s, g, T, M } = ctx;
  const has = (T?.params || []).includes('style_audio');
  const why = has ? '' : (unavailable(s, g.model, 'style_audio') || `« ${T?.nom} » ne prend pas de son d'inspiration${quoiDe(g) === 'variation' ? ' : le clip à varier en tient lieu' : ''}`);
  return sec(el('span', {}, 'Clip d\'inspiration', has && g.model === 'ace' ? el('small', { class: 'gp-tag', title: 'ReferenceTimbreAudio (nodes_ace.py) : un nœud expérimental, écrit et jugé à vide, jamais rendu en vrai' }, 'expérimental') : null),
    soundSlot(ctx, 'style_audio', { off: why }), has ? el('p', { class: 'gp-note' }, `son timbre guide ${M.nom} (audio de référence)`) : null);
}
function guideBox(ctx) {
  const { s, g, T } = ctx;
  const has = g.model === 'yue' && (T?.params || []).includes('abc');
  const why = has ? '' : g.model === 'ace' ? 'ACE-Step ne lit pas de MIDI : ses entrées sont du texte, des nombres et du son (étude § 8.3) — le guide MIDI passe par YuE2'
    : 'la reprise prend la mélodie du clip ; le guide MIDI va avec « Une chanson entière »';
  const PT = s.modeles.yue.partition;
  return sec('Guide MIDI', el('div', { class: `gp-cases${has ? '' : ' off'}` }, Object.entries(PT.cases).map(([k, cs]) => caseSlot(ctx, k, cs, !has))),
    has ? el('p', { class: 'gp-note' }, `deux lignes et des accords dans la partition de YuE2 ; ${PT.refuse.split(' : ')[0]} ne passent pas`) : el('p', { class: 'gp-why' }, why));
}
function caseSlot({ app, s, c }, k, cs, off) {
  const box = el('div', { class: 'gp-case', 'data-gen-case': off ? null : k, 'data-gen-region': c.id || '', title: off ? '' : `${cs.doc}\nglisser ici un clip de notes, un motif ou un clip MIDI · source : ${cs.source}` },
    el('b', {}, cs.label), el('small', {}, cs.voix),
    el('button', { class: 'tb ghost sm', type: 'button', disabled: off || null, onclick: () => {
      const x = app.S.proj.clips.find((y) => (app.S.sel.clips || []).includes(y.id) && y.pat);
      if (!x) { toast('choisis d\'abord un clip de notes dans l\'arrangement'); return; }
      injectFrom(app, c, s, k, { clip: x.id });
    } }, 'Sélection'),
    el('button', { class: 'tb ghost sm', type: 'button', disabled: off || null, onclick: (e) => caseMenu(app, c, s, k, e) }, '…'));
  if (off) return box;
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drop-on'); });
  box.addEventListener('dragleave', () => box.classList.remove('drop-on'));
  box.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation(); box.classList.remove('drop-on');
    try {
      const od = e.dataTransfer.getData('application/x-odio'), raw = e.dataTransfer.getData('application/x-sr-item');
      const d = od ? JSON.parse(od) : null;
      if (d?.t === 'midi') { await injectFrom(app, c, s, k, { item: d.id }); return; }
      if (d?.t === 'motif') { await injectFrom(app, c, s, k, { pat: d.pat }); return; }
      if (raw) { const it = JSON.parse(raw); if (it.kind === 'midi') { await injectFrom(app, c, s, k, { item: it.id }); return; } }
      toast(`${cs.label} : un clip de notes (arrangement), un motif ou un clip MIDI de la bibliothèque`);
    } catch (err) { toast(err.message); }
  });
  return box;
}
async function caseMenu(app, c, s, k, e) {
  const P = app.S.proj, a = c.start, b = c.start + c.len, x0 = e.clientX, y0 = e.clientY;
  const clips = P.clips.filter((x) => x.pat && x.start < b && x.start + x.len > a && app.track(x.track)?.kind !== 'drums');
  const lib = (await listMidi().catch(() => [])).filter((it) => !it.params?.drums).slice(0, 12);
  menu(x0, y0, [{ head: `guide MIDI · ${s.modeles.yue.partition.cases[k].label}` },
    { head: clips.length ? 'les clips de notes sur la plage' : 'aucun clip de notes sur la plage' },
    ...clips.slice(0, 20).map((x) => ({ label: `${app.track(x.track).name} · ${app.pat(x.pat)?.name || 'motif'}`, sub: `${app.bar(x.start)} → ${app.bar(x.start + x.len)}`,
      onclick: () => injectFrom(app, c, s, k, { clip: x.id }) })),
    '-', { head: lib.length ? 'la bibliothèque MIDI' : 'bibliothèque MIDI vide' },
    ...lib.map((it) => ({ label: it.title, sub: midiSub(it), onclick: () => injectFrom(app, c, s, k, { item: it.id }) }))]);
}

// 6. le modèle, les réglages courts, les avancés
const GERES = new Set(['caption', 'tags', 'lyrics', 'instrumental', 'track_name', 'track_classes', 'autour', 'marge', 'style_audio', 'src_audio', 'ref', 'abc', 'mode', 'n', 'seed', 'language']);
function modeleBox(ctx) {
  const { app, s, c, g, M, T, V, et } = ctx;
  const Q = I()[quoiDe(g)];
  const seg = el('div', { class: 'gp-voies' }, Q.voies.map((W) => {
    const e = etatVoie(W);
    return el('button', { class: `gp-voie${W.id === V?.id ? ' on' : ''}${e.ok ? '' : ' off'}`, type: 'button', title: `${W.doc}${e.ok ? '' : `\n— ${e.why}`}`,
      onclick: () => { if (W.id === V?.id) return; appliquerVoie(app, c, W); commit(app); } },
    el('b', {}, model(s, W.model).court), el('span', {}, W.label), el('small', {}, e.ok ? (e.essai ? 'essai' : 'prêt') : 'pas câblé'));
  }));
  const sans = Q.sans ? Object.entries(Q.sans).map(([mid, why]) => el('p', { class: 'gp-why' }, `${model(s, mid).nom} : ${why}`)) : [];
  const vals = valeurs(ctx);
  const court = ['n', 'seed', 'mode', 'language'].filter((pid) => T.params.includes(pid) && cond(M.params[pid].si, vals))
    .map((pid) => field(ctx, pid, M.params[pid], vals)).filter(Boolean);
  const adv = T.params.filter((pid) => !GERES.has(pid) && !M.params[pid].projet && cond(M.params[pid].si, vals)).map((pid) => field(ctx, pid, M.params[pid], vals)).filter(Boolean);
  const moteur = et.essai ? `moteur d'essai : ${g.model === 'yue' ? 'la partition jouée en sinus, à son tempo' : 'un son synthétisé au tempo, dans la tonalité, à la mesure'} — pas ${M.nom} ; en réel : ${engNow()?.engines?.[g.model]?.tasks?.[g.task]?.real?.ok ? 'câblé' : 'pas câblé'}`
    : et.ok ? `${M.nom} · ${T.nom} : prêt, en réel` : `${M.nom} · ${T.nom} : ${et.why}`;
  return sec('Modèle', seg, ...sans, el('p', { class: `gp-note${et.ok ? '' : ' gp-why'}`, title: et.doc || '' }, moteur),
    court.length ? el('div', { class: 'gp-court' }, court) : null,
    adv.length ? el('details', { class: 'gp-adv', open: O.adv || null, ontoggle: (e) => { O.adv = e.target.open; } },
      el('summary', {}, `réglages avancés · ${adv.length}`), el('div', { class: 'gp-court' }, adv)) : null);
}
// un champ du schéma (réglages courts et avancés)
function field({ app, c }, pid, pd, vals) {
  const v = vals[pid];
  const set = (x) => { c.gen.v = { ...c.gen.v, [pid]: x }; commit(app); };
  const lab = (node, extra = '') => el('label', { class: 'gp-f', title: `${pd.doc ? `${pd.doc}\n` : ''}source : ${pd.source}${pd.envoi ? `\nenvoyé comme : ${pd.envoi}` : ''}` },
    el('span', { class: 'lbl' }, pid === 'n' ? 'versions' : pd.label, extra ? el('b', {}, ` · ${extra}`) : null), node);
  if (pd.type === 'bool') return el('label', { class: 'gp-f gp-bool opt mu-check', title: `source : ${pd.source}` }, el('input', { type: 'checkbox', checked: v || null, onchange: (e) => set(e.target.checked) }), ` ${pd.label}`);
  if (pd.type === 'choix') {
    const ids = choiceIds(pd);
    return lab(el('select', { class: 'fld', onchange: (e) => set(e.target.value) }, ids.map((id) => el('option', { value: id, selected: id === v || null }, choiceLabel(pd, id)))));
  }
  if (pd.type === 'nombre' || pd.type === 'entier') {
    const inp = el('input', { class: 'fld gp-num', type: 'number', min: pd.min, max: pd.max, step: pd.step || (pd.type === 'entier' ? 1 : 'any'), value: v === -1 ? '' : v ?? '',
      placeholder: pid === 'seed' ? 'au hasard' : '',
      onchange: (e) => {
        const x = e.target.value === '' ? (pid === 'seed' ? -1 : pd.defaut) : +e.target.value;
        if (!(x >= pd.min && x <= pd.max)) { toast(`${pd.label} : de ${pd.min} à ${pd.max}`); repeindre(); return; }
        set(pd.type === 'entier' ? Math.round(x) : x);
      } });
    return lab(inp, pid === 'seed' ? '' : `${pd.min}–${pd.max}`);
  }
  if (pd.type === 'texte') {
    const ta = el('textarea', { class: 'fld', rows: 2, maxlength: pd.max, placeholder: pd.exemple || '', onchange: (e) => set(e.target.value) });
    ta.value = v || '';
    return lab(ta);
  }
  return null;
}

// les arcs d'une plage, en mots du style (seuils : notre choix ; la densité et la tension
// sont « lues par le génératif », arcs.js ; musique_generatif.md § 6.3 et § 8.4)
export function motsArcs(P, c) {
  const A = valeursArcs(P, c.start, c.start + c.len), mots = [];
  if (A.energie != null) { if (A.energie < 0.33) mots.push('calm', 'low energy'); else if (A.energie > 0.66) mots.push('high energy'); }
  if (A.densite < 0.35) mots.push('sparse arrangement'); else if (A.densite > 0.65) mots.push('dense arrangement');
  if (A.tension < 0.35) mots.push('relaxed'); else if (A.tension > 0.65) mots.push('tense', 'building up');
  return { A, mots };
}
// les valeurs envoyées : défauts du schéma, réglages, et ce que le panneau calcule
function valeurs({ s, c, g, P, V }) {
  const vals = { ...defaultsFor(s, g.model, g.task), ...g.v };
  if (g.arcs !== false) {
    const sk = g.model === 'ace' ? 'caption' : 'tags', mots = motsArcs(P, c).mots.filter((w) => !(vals[sk] || '').toLowerCase().includes(w));
    const max = model(s, g.model).params[sk]?.max || 512;
    if (mots.length && (vals[sk] || '').trim()) vals[sk] = `${vals[sk].trim()}, ${mots.join(', ')}`.slice(0, max);
  }
  const q = quoiDe(g), chante = q !== 'instrument' || ['vocals', 'backing_vocals'].includes(g.instrument);
  const ly = chante ? parolesDe(P, c, g) : '';
  if ('lyrics' in vals || task(s, g.model, g.task).params.includes('lyrics')) vals.lyrics = ly;
  if (task(s, g.model, g.task).params.includes('instrumental')) vals.instrumental = !ly;
  if (g.task === 'lego' || g.task === 'extract') vals.track_name = g.instrument && g.instrument !== 'other' ? g.instrument : 'drums';
  void V;
  return vals;
}

// ── le texte : le style, la structure et les paroles, la partition ──
function styleBox({ app, g, M, P }) {
  const pid = g.model === 'ace' ? 'caption' : 'tags', pd = M.params[pid];
  const max = pd?.max || 512;
  const count = el('small', { class: 'gp-count' });
  const E = effectif(P, g);
  const upd = () => { count.textContent = `${(g.v[pid] || '').length} / ${max}`; };
  const ta = el('textarea', { class: 'fld gp-style', rows: 3, maxlength: max, placeholder: pd?.exemple || 'genre, instruments, humeur, voix… (en anglais : les exemples des modèles le sont)',
    oninput: (e) => { g.v = { ...g.v, [pid]: e.target.value }; upd(); app.commit('quiet'); }, onchange: () => repeindre() });
  ta.value = g.v[pid] || '';
  upd();
  const has = (w) => (g.v[pid] || '').split(',').map((x) => x.trim().toLowerCase()).includes(w.toLowerCase());
  const chips = Object.entries(SUGGEST).map(([k, words]) => el('div', { class: 'gp-sug' }, el('span', { class: 'lbl' }, SUG_FR[k]),
    words.map((w) => el('button', { class: `opt${has(w) ? ' on' : ''}`, type: 'button', onclick: () => {
      const parts = (g.v[pid] || '').split(',').map((x) => x.trim()).filter(Boolean);
      const i = parts.findIndex((x) => x.toLowerCase() === w.toLowerCase());
      if (i >= 0) parts.splice(i, 1); else parts.push(w);
      g.v = { ...g.v, [pid]: parts.join(', ').slice(0, max) }; commit(app, 'quiet');
    } }, w))));
  return sec(el('span', {}, 'Style', count),
    ta,
    el('details', { class: 'gp-adv', open: O.sug || null, ontoggle: (e) => { O.sug = e.target.open; } }, el('summary', {}, 'des mots à cocher'), ...chips),
    el('p', { class: 'gp-note' }, g.model === 'yue' ? `+ « ${E.bpm} BPM, ${aceKeyOf(E.key)} » ajoutés seuls (YuE2 les lit dans le style)` : 'le tempo, la tonalité, la mesure partent à part, en nombres'));
}

// ── La structure et les paroles ──────────────────────────────
// Le contrat (projet.js, 06/10, wip2/odio-arcs-session) : les SECTIONS vivent
// dans le projet (p.sections, la rangée au-dessus de l'arc) ; les PAROLES d'une
// génération dans c.gen.v.lyrics, des blocs ouverts par « [Étiquette] » ; le
// lien est l'ordre — le i-ème bloc va avec la i-ème section que la plage couvre.
// Pour une région, musique.js tient les deux côtés à chaque geste
// (suivreStructure) ; pour le brouillon (pas encore de région), le panneau
// appelle structureDepuisParoles lui-même. L'éditeur n'a aucune copie : un bloc
// affiche la section i (son étiquette, sa longueur) et les vers du bloc i ;
// ajouter, dupliquer, déplacer, retirer touche les deux d'un même geste, pour
// que le nombre de blocs reste celui des sections (sinon la plage serait
// replanifiée, structureDepuisParoles).
const balise = (tag, bas) => `[${bas ? tag : cap(tag)}]`;
// les paroles en blocs : { tete (ce qui précède la première balise), bas (balises en bas de casse), blocs: [{ tag, vers }] }
function blocsDe(texte) {
  const { lignes, blocs } = lireParoles(texte || '');
  const fin = (i) => (blocs[i + 1] ? blocs[i + 1].ligne : lignes.length);
  return {
    tete: lignes.slice(0, blocs.length ? blocs[0].ligne : lignes.length).join('\n').trim(),
    bas: blocs.length > 0 && blocs.every((b) => b.bas),
    blocs: blocs.map((b, i) => ({ tag: b.tag, vers: lignes.slice(b.ligne + 1, fin(i)).join('\n').replace(/^\n+|\n+$/g, '') })),
  };
}
const ecrireBlocs = (B) => [B.tete || null, ...B.blocs.map((b) => `${balise(b.tag, B.bas)}${b.vers ? `\n${b.vers}` : ''}`)].filter((x) => x != null && x !== '').join('\n\n');
// les blocs alignés sur les sections couvertes (autant de blocs que de sections ; les blocs en trop restent derrière)
function aligne(B, cov) {
  for (let i = 0; i < cov.length; i++) {
    if (!B.blocs[i]) B.blocs[i] = { tag: cov[i].tag || 'verse', vers: '' };
    else B.blocs[i].tag = cov[i].tag || B.blocs[i].tag;
  }
  return B;
}
// écrire les paroles d'une cible ; `struct` : la structure a pu changer (le brouillon la suit lui-même)
function poserParoles(app, c, B, kind = 'quiet') {
  c.gen.v = { ...c.gen.v, lyrics: ecrireBlocs(B) };
  if (kind === 'quiet') { app.commit('quiet'); O.majEnvoi?.(); return; }
  commit(app, kind);
}

function structureBox(ctx) {
  const { app, s, c, g, P, T } = ctx, q = quoiDe(g);
  if (!T.params.includes('lyrics')) return null;
  if (q === 'instrument' && !['vocals', 'backing_vocals'].includes(g.instrument)) return null;
  const cov = sectionsDeRegion(P, c);
  const B = aligne(blocsDe(g.v.lyrics), cov);
  const inst = el('label', { class: 'opt mu-check', title: 'sans paroles : les sections restent, le chant non' },
    el('input', { type: 'checkbox', checked: g.inst || null, onchange: (e) => { g.inst = e.target.checked || undefined; commit(app); } }), ' sans paroles');
  const blocks = el('div', { class: 'gp-blocs' });
  cov.forEach((sc, i) => blocks.append(bloc(ctx, sc, i, cov)));
  const enTrop = B.blocs.slice(cov.length);
  const trop = enTrop.length ? el('p', { class: 'gp-why' }, `${enTrop.length} bloc${enTrop.length > 1 ? 's' : ''} de paroles sans section (${enTrop.map((b) => balise(b.tag)).join(' ')}) : ils restent dans les paroles ; « + une section après » leur en donne une`) : null;
  const ajout = el('div', { class: 'gp-ajout' }, el('span', { class: 'lbl' }, cov.length ? '+ une section après' : '+ commencer la structure'),
    SECTION_TAGS.map(([k, l]) => el('button', { class: 'opt', type: 'button', title: cov.length ? `une section « ${l} » après la dernière, dans la rangée de structure (ce qui suit se décale)` : `une section « ${l} » sur la plage, dans la rangée de structure`,
      onclick: () => (cov.length ? inserer(app, c, cov.length, [{ tag: k, vers: '' }]) : commencer(app, c, [{ tag: k, vers: '' }])) }, l)));
  const libre = !cov.length ? texteLibre(ctx) : null;
  const vide = P.sections.length && !cov.length ? el('p', { class: 'gp-note' }, 'la plage ne couvre aucune section du projet',
    !c.id ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { g.plage = plageDefaut(app, g, 'sections'); commit(app); } }, 'Prendre les sections') : null) : null;
  const regle = c.id && cov.length && (cov[0].a !== c.start || cov[cov.length - 1].b !== c.start + c.len)
    ? el('button', { class: 'tb ghost sm', type: 'button', title: 'la région prend les bornes des sections qu\'elle touche', onclick: () => {
      const r = app.clip(c.id);
      r.start = cov[0].a; r.len = cov[cov.length - 1].b - cov[0].a; commit(app);
    } }, 'Ajuster la région à la structure') : null;
  // ce que le moteur lira, tenu à jour pendant la frappe (sans redessiner le panneau)
  const lit = (txt) => (txt ? `${s.modeles[g.model].court} lira : ${lireParoles(txt).blocs.map((b) => balise(b.tag, false)).join(' ') || 'les paroles telles quelles'}` : 'rien à chanter : instrumental');
  O.majEnvoi = () => { const n = O.dr.body.querySelector('.gp-envoi'); if (n) { const t = parolesDe(P, c, g); n.textContent = lit(t); n.title = t || '(rien : instrumental)'; } };
  const envoi = parolesDe(P, c, g);
  return sec(el('span', {}, 'Structure et paroles', el('small', { class: 'gp-tag', title: 'les sections du projet : la rangée au-dessus de l\'arc d\'énergie ; les paroles : c.gen.v.lyrics, un bloc par section' }, 'la structure du projet')),
    el('div', { class: 'gp-row' }, inst, regle),
    vide, blocks, trop, libre, ajout,
    el('p', { class: 'gp-note gp-envoi', title: envoi || '(rien : instrumental)' }, lit(envoi)));
}
function bloc({ app, c, g, P }, sc, i, cov) {
  const B0 = aligne(blocsDe(g.v.lyrics), cov), vers = B0.blocs[i]?.vers || '';
  const ta = el('textarea', { class: 'fld gp-par', rows: Math.max(2, Math.min(10, vers.split('\n').length + 1)), spellcheck: 'true',
    placeholder: ['instrumental', 'intro', 'outro'].includes(sc.tag) ? '(sans paroles : la section reste)' : 'les paroles de cette section ; « refrain », « couplet 2 »… seul sur une ligne crée la section suivante' });
  ta.value = vers;
  ta.addEventListener('input', () => {
    ta.rows = Math.max(2, Math.min(10, ta.value.split('\n').length + 1));
    const B = aligne(blocsDe(g.v.lyrics), sectionsDeRegion(P, c));
    // une ligne d'en-tête suivie d'un retour à la ligne : la suite devient une section neuve ;
    // tapée en tête d'un bloc vide, elle ré-étiquette ce bloc (et sa section)
    const cut = decouper(ta.value, true);
    if (cut.sections.length) {
      const reste = [...cut.sections];
      if (!cut.avant.trim()) {
        const h = reste.shift();
        etiqueter(sc, h.tag, h.n);
        B.blocs[i] = { tag: h.tag, vers: h.paroles };
        if (!reste.length) { O.focus = sc.id; poserParoles(app, c, B, 'data'); return; }
      } else B.blocs[i].vers = cut.avant;
      c.gen.v = { ...c.gen.v, lyrics: ecrireBlocs(B) };
      inserer(app, c, i + 1, reste.map((x) => ({ tag: x.tag, n: x.n, vers: x.paroles })));
      return;
    }
    B.blocs[i].vers = sansEnCours(ta.value).slice(0, 4000);
    poserParoles(app, c, B);
  });
  const tag = el('select', { class: 'fld gp-tagsel', 'aria-label': 'étiquette', title: 'l\'étiquette de la section, celle de la rangée de structure et de la balise des paroles', onchange: (e) => {
    etiqueter(sc, e.target.value);
    const B = aligne(blocsDe(g.v.lyrics), sectionsDeRegion(P, c));
    poserParoles(app, c, B, 'data');
  } }, [...(TAG_FR[sc.tag] ? [] : [[sc.tag, cap(sc.tag || 'verse')]]), ...SECTION_TAGS].map(([k, l]) => el('option', { value: k, selected: sc.tag === k || null }, l)));
  const bars = Math.round((sc.b - sc.a) / P.sig);
  const len = el('input', { class: 'fld gp-num', type: 'number', min: 1, max: 64, step: 1, value: bars, 'aria-label': 'mesures', title: 'sa longueur en mesures : ce qui suit se décale, comme dans la rangée de structure',
    onchange: (e) => {
      const nb = Math.max(1, Math.min(64, Math.round(+e.target.value))), d = (nb - bars) * P.sig;
      if (!d) return;
      const at = sc.b, avant = c.id ? app.clip(c.id)?.start : null;
      shiftFrom(P, at, d); sc.b += d; suivre(app, c, at, d, avant); commit(app);
    } });
  const handle = el('span', { class: 'gp-poignee', draggable: 'true', title: 'glisser pour déplacer la section (son contenu et ses paroles suivent)' }, '⠿');
  const box = el('div', { class: 'gp-bloc', 'data-section': sc.id, style: { '--c': `var(--${sc.color || 'cy'})` } },
    el('div', { class: 'gp-bloc-h' }, handle, tag, sc.name && sc.name !== TAG_FR[sc.tag] ? el('b', { title: 'son nom dans la rangée de structure' }, sc.name) : null, el('span', { class: 'sp' }), len, el('small', {}, 'mes.'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'dupliquer (un refrain repris) : la copie suit, avec ses paroles et son contenu', onclick: () => {
        const cv = sectionsDeRegion(P, c), B = aligne(blocsDe(g.v.lyrics), cv), at = sc.b, avant = c.id ? app.clip(c.id)?.start : null;
        const n = duplicateSection(P, sc, app.uid);
        suivre(app, c, at, n.b - n.a, avant);
        B.blocs.splice(i + 1, 0, { ...B.blocs[i] });
        O.focus = n.id;
        poserParoles(app, c, B, 'data');
      } }, '⧉'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'retirer la section de la structure, et son bloc de paroles (ses clips restent)', onclick: () => {
        const B = aligne(blocsDe(g.v.lyrics), sectionsDeRegion(P, c));
        B.blocs.splice(i, 1);
        removeSection(P, sc, false);
        poserParoles(app, c, B, 'data');
      } }, '×')),
    ta);
  handle.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-gp-section', sc.id); e.dataTransfer.effectAllowed = 'move'; });
  box.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('application/x-gp-section')) { e.preventDefault(); box.classList.add('drop-on'); } });
  box.addEventListener('dragleave', () => box.classList.remove('drop-on'));
  box.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData('application/x-gp-section');
    box.classList.remove('drop-on');
    if (!id || id === sc.id) return;
    e.preventDefault();
    deplacerSection(app, c, id, sc.id);
  });
  return box;
}
// l'étiquette d'une section ; son nom la suit s'il suivait l'ancienne (« Couplet », « Couplet 2 »)
function etiqueter(sc, tag, n = null) {
  const suit = !sc.name || /^(Intro|Couplet|Pré-refrain|Refrain|Pont|Instrumental|Final)( \d+)?$/.test(sc.name);
  sc.tag = tag;
  if (suit) sc.name = `${TAG_FR[tag] || cap(tag)}${n ? ` ${n}` : ''}`;
}
// les paroles sans section encore : taper un en-tête crée les sections (structureDepuisParoles)
function texteLibre({ app, c, g }) {
  const ta = el('textarea', { class: 'fld gp-par', rows: 8, spellcheck: 'true', placeholder: 'colle ou tape les paroles ; « refrain », « couplet 2 », « [chorus] », « pont »… seul sur une ligne crée la section, dans la rangée de structure' });
  ta.value = g.v.lyrics || '';
  const convert = (fin) => {
    const cut = decouper(ta.value, !fin);
    if (!cut.sections.length) return false;
    commencer(app, c, [...(cut.avant.trim() ? [{ tag: 'verse', vers: cut.avant }] : []), ...cut.sections.map((x) => ({ tag: x.tag, n: x.n, vers: x.paroles }))]);
    return true;
  };
  ta.addEventListener('input', () => { if (convert(false)) return; g.v = { ...g.v, lyrics: sansEnCours(ta.value).slice(0, 4000) }; app.commit('quiet'); O.majEnvoi?.(); });
  ta.addEventListener('change', () => convert(true));
  return ta;
}

// Une balise qu'on est en train de taper (la dernière ligne, pas encore de retour à
// la ligne) n'entre pas dans les paroles : le contrat la lirait déjà comme un bloc
// (projet.js, lireParoles) ; elle y entre au retour à la ligne (decouper).
const BAL = /^\s*\[([^\]\n]{1,40})\]\s*$/;
const sansEnCours = (t) => { const l = (t || '').split('\n'); return lireEntete(l[l.length - 1]) ? l.slice(0, -1).join('\n') : t; };
// « refrain », « Couplet 2 », « [chorus] », « [Build] », « (Pont) : » seul sur sa ligne : un en-tête de
// section ; entre crochets, toute étiquette (etiquetteDe du contrat), sans crochets, les mots connus
const ENTETES = [[/^intro(duction)?$/, 'intro'], [/^(couplet|verse|strophe)$/, 'verse'], [/^(pre ?refrain|pre ?chorus|prechorus)$/, 'pre-chorus'],
  [/^(refrain|chorus|hook)$/, 'chorus'], [/^(pont|bridge)$/, 'bridge'], [/^(instrumental|instru|solo|break|interlude)$/, 'instrumental'], [/^(outro|final|fin|coda)$/, 'outro']];
export function lireEntete(line) {
  const b = (line || '').match(BAL);
  if (b) { const k = b[1].match(/(\d+)\s*$/); return { tag: etiquetteDe(b[1]), n: k ? +k[1] : null }; }
  const n = (line || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (!n || n.length > 30) return null;
  const m = n.match(/^[[(]?\s*([a-z][a-z -]*?)\s*(\d+)?\s*[\])]?\s*:?$/);
  if (!m) return null;
  const w = m[1].replace(/-/g, ' ').trim();
  for (const [rx, tag] of ENTETES) if (rx.test(w)) return { tag, n: m[2] ? +m[2] : null };
  return null;
}
// le texte coupé à ses en-têtes : { avant, sections: [{ tag, n, paroles }] } ;
// `fini` : un en-tête ne compte que suivi d'un retour à la ligne (on est en train de le taper)
export function decouper(text, fini = false) {
  const lines = (text || '').split('\n'), avant = { paroles: [] }, sections = [];
  let cur = avant;
  lines.forEach((ln, i) => {
    const h = lireEntete(ln);
    if (h && (!fini || i < lines.length - 1)) { cur = { tag: h.tag, n: h.n, paroles: [] }; sections.push(cur); } else cur.paroles.push(ln);
  });
  const net = (a) => a.join('\n').replace(/^\n+|\n+$/g, '');
  return { avant: net(avant.paroles), sections: sections.map((x) => ({ tag: x.tag, n: x.n, paroles: net(x.paroles) })) };
}
// La première structure, depuis des blocs de paroles : les balises écrites, puis la plage
// planifiée par le contrat (structureDepuisParoles : un bloc, une section, des mesures
// entières) — musique.js le fait pour une région, le panneau pour le brouillon.
function commencer(app, c, list) {
  const P = app.S.proj, B = blocsDe(c.gen.v.lyrics);
  B.tete = ''; B.blocs = list.map((x) => ({ tag: x.tag, vers: x.vers || '' }));
  c.gen.v = { ...c.gen.v, lyrics: ecrireBlocs(B) };
  if (!c.id) structureDepuisParoles(P, c, app.uid);
  // les noms numérotés tapés (« couplet 2 ») : ceux des sections que la plage couvre désormais
  sectionsDeRegion(P, c).forEach((sc, i) => { if (list[i]?.n) sc.name = `${TAG_FR[sc.tag] || sc.name}${` ${list[i].n}`}`; });
  O.focus = sectionsDeRegion(P, c).slice(-1)[0]?.id || null;
  toast(`${list.length > 1 ? `${list.length} sections` : 'une section'} dans la rangée de structure`, 3000);
  commit(app);
}
// Des sections neuves après le i-ème bloc (projet.js, shiftFrom : ce qui suit se décale,
// comme « insérer du temps ») et leurs blocs de paroles au même rang ; leur longueur :
// deux mesures par vers (le choix de chanson.py), au moins quatre
function inserer(app, c, i, list) {
  const P = app.S.proj, cov = sectionsDeRegion(P, c), B = aligne(blocsDe(c.gen.v.lyrics), cov);
  const at = cov[i - 1] ? cov[i - 1].b : c.start, avant = c.id ? app.clip(c.id)?.start : null;
  let pos = at, total = 0;
  const made = list.map((x) => {
    const lines = (x.vers || '').split('\n').filter((l) => l.trim()).length;
    const bars = lines ? Math.max(4, Math.ceil((2 * lines) / 4) * 4) : (TAG_LEN[x.tag] || 8);
    const len = bars * P.sig;
    const sc = { id: app.uid('s'), name: `${TAG_FR[x.tag] || cap(x.tag)}${x.n ? ` ${x.n}` : ''}`, a: pos, b: pos + len, color: COLORS[(P.sections.length + 1) % COLORS.length], tag: x.tag };
    pos += len; total += len;
    return sc;
  });
  shiftFrom(P, at, total);
  P.sections.push(...made);
  suivre(app, c, at, total, avant);
  B.blocs.splice(i, 0, ...list.map((x) => ({ tag: x.tag, vers: x.vers || '' })));
  O.focus = made[made.length - 1].id;
  toast(`${made.length > 1 ? `${made.length} sections` : `la section « ${made[0].name} »`} dans la rangée de structure`, 3000);
  poserParoles(app, c, B, 'data');
}
// la cible suit la structure : une région (ou la plage du brouillon) qui contient
// le point d'insertion s'allonge d'autant ; une qui commence après lui suit le décalage
function suivre(app, c, at, d, avant = null) {
  if (c.id) {
    const r = app.clip(c.id);
    if (!r) return;
    // insérer au début de la région : shiftFrom l'a poussée, elle revient et contient la section neuve
    if (avant != null && Math.abs(avant - at) < 1e-9) { r.start = avant; r.len = Math.max(0.25, r.len + d); return; }
    if (at > r.start + 1e-9 && at <= r.start + r.len + 1e-9) r.len = Math.max(0.25, r.len + d);
    else if (d > 0 && at > r.start + r.len) r.len = at + d - r.start;     // après une section qui dépassait : la région la rejoint
  } else if (c.gen.plage && c.gen.plage.src !== 'sections') {
    const pl = c.gen.plage;
    if (at >= pl.a - 1e-9 && at <= pl.b + 1e-9) pl.b = Math.max(pl.a + 0.25, pl.b + d);
    else if (pl.a >= at) { pl.a += d; pl.b += d; }
  }
}
// déplacer une section (et son bloc de paroles) à la place d'une autre
function deplacerSection(app, c, id, versId) {
  const P = app.S.proj, list = sorted(P), i = list.findIndex((x) => x.id === id), j = list.findIndex((x) => x.id === versId);
  if (i < 0 || j < 0) return;
  const cov = sectionsDeRegion(P, c), B = aligne(blocsDe(c.gen.v.lyrics), cov);
  const bi = cov.findIndex((x) => x.id === id), bj = cov.findIndex((x) => x.id === versId);
  const sc = list[i], dir = j > i ? 1 : -1;
  for (let k = i; k !== j; k += dir) {
    const why = swapSection(P, sc, dir);
    if (why) { toast(why); break; }
  }
  if (bi >= 0 && bj >= 0) { const [m] = B.blocs.splice(bi, 1); B.blocs.splice(bj, 0, m); }
  poserParoles(app, c, B, 'data');
}
// les paroles que le moteur lit : celles de la génération (c.gen.v.lyrics), telles quelles
export function parolesDe(P, c, g) {
  void P; void c;
  return g.inst ? '' : (g.v?.lyrics || '').trim();
}

// la partition de YuE2 : écrite d'abord, relue, retouchée (05/10), la faute dite en français (06/10)
function partitionBox(ctx) {
  const { app, s, c, g, P, T } = ctx;
  if (g.model !== 'yue' || !T.params.includes('abc') || !cond('mode!=off', { ...defaultsFor(s, g.model, g.task), ...g.v })) return null;
  const relire = g.relire !== false;
  const ta = el('textarea', { class: 'fld gp-abc', rows: 9, spellcheck: 'false', 'aria-label': 'la partition (ABC)',
    placeholder: relire ? '« Écrire la partition » (le bouton orange) : YuE2 l\'écrit d\'abord, tu la relis ici avant le chant ; ou dépose un guide MIDI' : 'sans relire : YuE2 écrit sa partition et chante d\'un trait' });
  ta.value = g.v.abc || '';
  const state = el('span', { class: 'gp-abc-s lbl' });
  const roll = el('canvas', { class: 'gp-roll' });
  const paintState = (r) => {
    if (!r) { put(state, g.v.abc ? 'pas vérifiée' : 'vide'); state.className = 'gp-abc-s lbl'; drawRoll(roll, null, P); return; }
    if (r.ok === null) { put(state, `vérification indisponible : ${r.why}`); state.className = 'gp-abc-s lbl'; return; }
    if (!r.ok) {
      put(state, `ne passe pas : ${r.error_fr || r.error}`, r.corriger ? el('button', { class: 'tb ghost sm', type: 'button', title: r.corriger.notes.join(' · '),
        onclick: () => { g.v = { ...g.v, abc: r.corriger.abc }; app.commit('data'); toast(r.corriger.notes.join(' · '), 6000); repeindre(); } }, 'Corriger') : null);
      state.className = 'gp-abc-s lbl no'; drawRoll(roll, null, P); return;
    }
    const vo = r.report.voices;
    put(state, `vérifiée · ${vo.Vocal.measures} mes. · Q ${r.report.bpm} · chant ${vo.Vocal.sounding_notes} notes · thème ${vo.Ins.sounding_notes} · ${vo.Vocal.chords.length} accords`);
    state.className = 'gp-abc-s lbl ok';
    drawRoll(roll, r.report, P);
  };
  let t = null;
  const recheck = async () => { const r = await check(g.v.abc); setCheck(c, r); paintState(r); };
  ta.addEventListener('input', () => { g.v = { ...g.v, abc: ta.value }; app.commit('quiet'); clearTimeout(t); t = setTimeout(recheck, 700); });
  requestAnimationFrame(() => (lastCheck(c) !== undefined ? paintState(lastCheck(c)) : recheck()));
  const busy = (P.pending || []).find((x) => x.kind === 'abc' && (x.clip || null) === (c.id || null));
  const fromTake = (g.takes || []).filter((x) => x.score);
  return sec(el('span', {}, 'Partition', el('small', { class: 'gp-tag' }, 'YuE2')),
    el('div', { class: 'gp-row' },
      el('label', { class: 'opt mu-check', title: 'YuE2 écrit d\'abord sa partition ; tu la relis, puis Générer la chante telle quelle' },
        el('input', { type: 'checkbox', checked: relire || null, onchange: (e) => { g.relire = e.target.checked ? undefined : false; commit(app); } }), ' relire avant de chanter'),
      el('span', { class: 'sp' }),
      busy ? el('span', { class: 'lbl', 'data-gen-job': busy.job }, 'en file') : null,
      g.v.abc ? el('button', { class: 'tb ghost sm', type: 'button', title: 'une autre partition', onclick: () => { g.v = { ...g.v, abc: '' }; ecrirePartition(ctx); } }, 'Réécrire') : null,
      fromTake.length ? el('button', { class: 'tb ghost sm', type: 'button', title: 'la partition qu\'une version a chantée', onclick: (e) => menu(e.clientX, e.clientY,
        [{ head: 'la partition d\'une version' }, ...fromTake.map((x) => ({ label: `Version ${x.k + 1}`, sub: `graine ${x.seed}`, onclick: () => { g.v = { ...g.v, abc: x.score }; commit(app); } }))]) }, 'D\'une version') : null,
      el('button', { class: 'tb ghost sm', type: 'button', title: 'la jouer tout de suite par nos instruments : une piste de notes par voix', disabled: !lastCheck(c)?.ok || !c.id || null, onclick: () => toMotifs(app, c, s) }, 'Par nos instruments'),
      g.v.abc ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { g.v = { ...g.v, abc: '' }; commit(app); } }, 'Vider') : null),
    state, ta, roll);
}
async function ecrirePartition({ app, c, g, P }) {
  const E = effectif(P, g), vals = valeurs({ s: schemaNow(), c, g, P });
  if (!(vals.tags || '').trim()) { toast('décris d\'abord le style (YuE2 le lit pour écrire la partition)'); return; }
  try {
    const j = await api('music/yue/abc', { method: 'POST', body: { tags: vals.tags, lyrics: vals.lyrics || '', seed: vals.seed ?? -1, mode: vals.mode || 'full', precision: vals.precision || 'bf16',
      projet: { bpm: E.bpm, sig: E.sig, tonic: E.key.tonic, mode: E.key.mode }, sections: sectionsFor(P, c), title: c.name || 'région' } });
    P.pending.push({ job: j.id, kind: 'abc', clip: c.id, title: j.title });
    commit(app); jobs.poll(true);
  } catch (e) { toast(e.message, 6000); }
}
// la partition jouée par nos instruments : une piste de notes par voix, sous la région
function toMotifs(app, c, s) {
  const P = app.S.proj, rep = lastCheck(c)?.report;
  if (!rep) return;
  const d = reportVoices(rep), k = P.bpm / rep.bpm;
  const t = app.track(c.track);
  let at = P.tracks.indexOf(t) + 1;
  const made = [];
  const q = (n) => [n.s / 4 * k, (n.e - n.s) / 4 * k, n.p, 0.85, 0];
  const end = rep.voices.Vocal.measures * P.sig * 4;
  const groups = [['Chant', d.vocal.map(q)], ['Thème', d.ins.map(q)],
    ['Accords', d.chords.flatMap((ch, i) => chordToNotes(ch.name, ch.t / 4 * k, ((d.chords[i + 1]?.t ?? end) - ch.t) / 4 * k, s.modeles.yue.partition.intervalles))]];
  for (const [nm, notes] of groups) {
    if (!notes.length) continue;
    const nt = app.addTrack('synth', { type: 'synth', name: `${nm} · ${c.name || 'partition'}`.slice(0, 60), at: at++ });
    made.push(...placeNotes(app, nt.id, notes, c.start, { quantize: 'libre', name: nm }).made);
  }
  app.selectClips(made.map((x) => x.id), true);
  toast(`la partition jouée par nos instruments : ${made.length} clip${made.length > 1 ? 's' : ''}, sous la région`, 5000);
  app.commit('graph');
}
function drawRoll(cv, rep, P) {
  const w = cv.clientWidth || 360, h = cv.clientHeight || 100, dpr = devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!rep) { g.fillStyle = tok('line'); g.fillRect(0, h / 2, w, 1); return; }
  const d = reportVoices(rep), end = Math.max(1, rep.voices.Vocal.measures * P.sig * 4);
  const all = [...d.vocal, ...d.ins].map((n) => n.p);
  const lo = Math.min(...all, 55) - 2, hi = Math.max(...all, 80) + 2;
  const X = (u) => (u / end) * w, Y = (p) => 14 + (1 - (p - lo) / (hi - lo)) * (h - 18);
  g.fillStyle = tok('line');
  for (let b = 0; b <= end; b += P.sig * 4) g.fillRect(X(b), 0, 1, h);
  g.font = `8px ${tok('f-mono') || 'monospace'}`;
  for (const ch of d.chords) { g.fillStyle = tok('amb'); g.fillText(ch.name, X(ch.t) + 2, 9); }
  for (const [notes, col] of [[d.ins, 'cy'], [d.vocal, 'coral-3']]) {
    g.fillStyle = tok(col);
    for (const n of notes) g.fillRect(X(n.s), Y(n.p) - 1.5, Math.max(2, X(n.e) - X(n.s) - 1), 3);
  }
}

// ── les versions (les prises) ───────────────────────────────
// Des cartes : la forme d'onde (la part qui joue dans le segment en couleur),
// l'écoute au clic, « dans le segment » (celle qui joue dans l'arrangement :
// comme le dossier de prises de Logic ou les « take lanes » de Live, la région
// garde toutes ses versions et l'on change d'un geste), A/B dans le morceau,
// garder, jeter, séparer, extraire le MIDI. `bande` : la vue du bas, en rangée.
export function versionsBox(app, c, { bande = false } = {}) {
  const P = app.S.proj, g = c.gen;
  const pend = c.id ? (P.pending || []).filter((x) => x.clip === c.id && x.kind === 'takes') : [];
  const gardes = c.id ? (P.pending || []).filter((x) => x.clip === c.id && x.kind === 'garder') : [];
  const head = el('div', { class: 'gp-vh' }, el('h3', { class: 'gp-h' }, `Versions${g.takes.length ? ` · ${g.takes.length}` : ''}`), el('span', { class: 'sp' }),
    c.id && g.takes.length ? el('button', { class: 'tb ghost sm', type: 'button', title: 'boucler sur la région et la jouer dans le morceau : « dans le segment » change de version sans s\'arrêter', onclick: () => dansLeMorceau(app, c) }, 'Écouter dans le morceau') : null,
    c.id && g.takes.length > 1 ? el('button', { class: 'tb ghost sm', type: 'button', title: g.ab != null && g.takes[g.ab] ? `passer à la version ${g.ab + 1} (et revenir) : la comparaison A/B, en lecture` : 'choisis d\'abord une autre version : A/B passe de l\'une à l\'autre',
      disabled: g.ab == null || !g.takes[g.ab] || null, onclick: () => chooseTake(app, c, g.ab) }, 'A/B') : null,
    bande && c.id ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => ouvrirGenerer(app, { region: c.id }) }, 'Générer…') : null);
  const cards = g.takes.map((tk, i) => carte(app, c, tk, i, gardes.find((x) => x.take === tk.item)));
  const busy = pend.map((x) => el('div', { class: 'gv-card busy' }, el('span', { class: 'pill work' }, el('i'), el('span', {}, 'génère')), el('span', { class: 'lbl', 'data-gen-job': x.job }, 'en file')));
  const vide = !g.takes.length && !pend.length
    ? el('p', { class: 'gp-note' }, c.id ? 'aucune version encore : Générer, en bas' : 'les versions arriveront ici, rangées dans la région, à sa place dans l\'arrangement ; la première joue dans le segment, on en change d\'un geste') : null;
  return el('div', { class: `gp-versions${bande ? ' bande' : ''}` }, head, el('div', { class: 'gv-list' }, busy, cards, vide),
    c.id && g.takes.length > 1 && !bande ? el('button', { class: 'tb ghost sm', type: 'button', title: 'une piste audio par version, sous la piste générative (muettes)', onclick: () => takesToTracks(app, c) }, 'Les versions en pistes') : null);
}
function carte(app, c, tk, i, garde) {
  const g = c.gen, on = g.take === i, old = stale(app, c, tk), P = app.S.proj;
  const cv = el('canvas', { class: 'gv-onde', title: 'écouter cette version seule, d\'ici' });
  const play = el('button', { class: 'gv-play', type: 'button', title: 'écouter cette version seule' }, '▶');
  const segS = c.len * 60 / P.bpm;
  play.addEventListener('click', () => ecouter(app, tk, tk.off || 0, segS, cv, play));
  cv.addEventListener('click', (e) => { const r = cv.getBoundingClientRect(); const dur = cv._dur || 0; ecouter(app, tk, Math.max(0, (e.clientX - r.left) / r.width * dur), segS, cv, play); });
  requestAnimationFrame(() => onde(app, cv, tk, segS));
  const meta = [`graine ${tk.seed ?? '?'}`, tk.engine === 'factice' ? 'essai' : '', tk.stem ? `stem ${tk.stem}` : '', garde ? `sépare : ${garde.stem}…` : ''].filter(Boolean).join(' · ');
  return el('div', { class: `gv-card${on ? ' on' : ''}${old ? ' old' : ''}`, 'data-take': i },
    el('div', { class: 'gv-top' },
      el('button', { class: 'gv-pick', type: 'button', title: on ? 'cette version joue dans le segment de l\'arrangement' : 'la mettre dans le segment (l\'arrangement la joue ; les autres restent ici)',
        onclick: () => chooseTake(app, c, i) }, el('i'), on ? 'dans le segment' : 'mettre dans le segment'),
      el('span', { class: 'sp' }), el('b', {}, `V${i + 1}`)),
    el('div', { class: 'gv-meta' }, meta, old ? el('span', { class: 'gv-old', title: 'la région, ses réglages, le tempo, la mesure ou la tonalité ont changé depuis cette version : elle joue toujours, Générer en refait' }, 'périmée') : null,
      garde ? el('span', { class: 'lbl', 'data-gen-job': garde.job }, '') : null),
    cv,
    el('div', { class: 'gv-act' }, play,
      el('button', { class: 'tb ghost sm', type: 'button', title: 'voix, batterie, basse… chacune sur sa piste, sous la région', onclick: () => { chooseTake(app, c, i, true); app.stems(c.id); } }, 'Stems'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'les notes de cette version, en clips de notes sous elle', onclick: () => { chooseTake(app, c, i, true); app.commit('data'); openExtract(app, c.id); } }, 'MIDI'),
      el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'garder celle-ci : la région devient un clip audio ordinaire (les autres restent dans la bibliothèque)', onclick: () => { chooseTake(app, c, i, true); keepTake(app, c); } }, 'Garder'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'jeter cette version (son son reste dans la bibliothèque)', onclick: () => dropTake(app, c, i) }, '×')));
}
async function onde(app, cv, tk, segS) {
  const w = cv.clientWidth || 240, h = cv.clientHeight || 44, dpr = devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = tok('line'); g.fillRect(0, h / 2, w, 1);
  let buf = null;
  try { buf = await app.engine.buffer(tk.item); } catch { return; }
  if (!buf || !cv.isConnected) return;
  cv._dur = buf.duration;
  const n = Math.max(16, Math.floor(w / 2)), pk = peaks(buf, n), a = (tk.off || 0) / buf.duration, b = Math.min(1, ((tk.off || 0) + segS) / buf.duration);
  g.clearRect(0, 0, w, h);
  for (let k = 0; k < n; k++) {
    const x = k / n, v = Math.max(1, pk[k] * (h - 4));
    g.fillStyle = tok(x >= a && x <= b ? 'cy' : 'ink3');
    g.fillRect(k * (w / n), (h - v) / 2, Math.max(1, w / n - 1), v);
  }
}
function stopEcoute() {
  if (!player) return;
  player.a.pause(); cancelAnimationFrame(player.raf);
  if (player.btn?.isConnected) player.btn.textContent = '▶';
  player = null;
}
function ecouter(app, tk, at, segS, cv, btn) {
  const same = player && player.tk === tk;
  stopEcoute();
  if (same && at === (tk.off || 0)) return;
  app.loadItem(tk.item).then((it) => {
    const a = new Audio(href(it.url));
    a.currentTime = at;
    a.play().catch(() => {});
    btn.textContent = '■';
    const stopAt = Math.max(at + 0.5, (tk.off || 0) + segS);
    player = { a, tk, btn, raf: 0 };
    const tick = () => {
      if (!player || player.a !== a) return;
      if (a.currentTime >= stopAt || a.ended) { stopEcoute(); return; }
      // la tête d'écoute sur la forme d'onde
      if (cv.isConnected && cv._dur) {
        const g = cv.getContext('2d'), dpr = devicePixelRatio || 1, w = cv.width / dpr, h = cv.height / dpr;
        onde(app, cv, tk, segS).then(() => { g.fillStyle = tok('or'); g.fillRect(a.currentTime / cv._dur * w, 0, 1.5, h); });
      }
      player.raf = requestAnimationFrame(() => setTimeout(tick, 120));
    };
    tick();
  });
}
function dansLeMorceau(app, c) {
  const P = app.S.proj;
  P.loop = { on: true, a: c.start, b: c.start + c.len };
  app.commit('meta');
  app.engine.seek(c.start);
  if (!app.engine.running) app.playStop();
  toast('la région en boucle, dans le morceau : « dans le segment » ou A/B changent de version sans s\'arrêter', 5000);
}

// ── le pied : où le résultat atterrit, et le seul orange ────
function raison(ctx) {
  const { app, s, c, g, P, T, M, et } = ctx;
  if (!et.ok) return et.why;
  const E = effectif(P, g), secsR = c.len * 60 / P.bpm, vals = valeurs(ctx);
  for (const pid of T.params) {
    const pd = M.params[pid];
    if (!pd.requis || !cond(pd.si, vals)) continue;
    if (pd.type === 'contexte') {
      const [w0, w1] = windowOf(P, c, vals.marge);
      const all = around(app, c, w0, w1).map((q) => q.id);
      if (!(g.ctx || all).filter((id) => all.includes(id)).length) return 'rien ne joue autour de la plage : le contexte est vide';
    } else if (pd.type === 'son' && !vals[pid]) return `${quoiDe(g) === 'variation' ? 'le clip à varier' : pd.label} : à choisir`;
    else if (vals[pid] === undefined || vals[pid] === null || vals[pid] === '' || (Array.isArray(vals[pid]) && !vals[pid].length)) return `${pd.label} : à remplir`;
  }
  if (T.zone && !(secsR >= T.zone.min && secsR <= T.zone.max)) return `${T.nom} : la plage dure ${secs(secsR)}, de ${T.zone.min} à ${T.zone.max} s (${T.zone.source})`;
  if (g.model === 'ace' && T.params.includes('duration') && secsR > 600) return 'la plage dépasse 600 s (ACE-Step)';
  if (g.model === 'yue' && secsR > 900) return 'la plage dépasse 900 s (YuE2)';
  if (g.model === 'ace' && (E.bpm < 30 || E.bpm > 300)) return `le tempo ${E.bpm} sort des 30-300 d'ACE-Step`;
  if (g.model === 'yue' && vals.abc && lastCheck(c)?.ok === false) return `la partition ne passe pas : ${lastCheck(c).error_fr || lastCheck(c).error}`;
  void s;
  return '';
}
function piedBox(ctx) {
  const { app, s, c, g, P, T, V } = ctx;
  const why = raison(ctx), vals = valeurs(ctx), n = vals.n || 1;
  const relire = !why && g.model === 'yue' && T.params.includes('abc') && cond('mode!=off', vals) && g.relire !== false && !(vals.abc || '').trim();
  const busyAbc = (P.pending || []).some((x) => x.kind === 'abc' && (x.clip || null) === (c.id || null));
  const go = relire
    ? el('button', { class: 'tb go', type: 'button', id: 'gp-go', disabled: busyAbc || !(vals.tags || '').trim() || null,
      title: !(vals.tags || '').trim() ? 'décris d\'abord le style (YuE2 le lit)' : 'YuE2 écrit d\'abord la partition : tu la relis, puis Générer la chante telle quelle',
      onclick: () => ecrirePartition(ctx) }, busyAbc ? 'La partition s\'écrit…' : 'Écrire la partition')
    : el('button', { class: 'tb go', type: 'button', id: 'gp-go', disabled: why || null, title: why || '', onclick: (e) => lancer(app, e.currentTarget) }, 'Générer');
  const sans = relire ? el('button', { class: 'tb ghost sm', type: 'button', title: 'YuE2 écrit sa partition et chante d\'un trait, sans la montrer', onclick: (e) => lancer(app, e.currentTarget) }, 'Sans relire') : null;
  const garde = V?.garder ? ` · on garde ${g.instrument === 'other' ? 'le reste (stem « other »)' : `${trackFr(s, g.instrument)} (stem « ${I().stems[g.instrument]?.stem} »)`}` : '';
  const dest = c.id ? `dans la région de « ${app.track(c.track)?.name} »` : (destination(app, c).t ? `sur « ${destination(app, c).t.name} »` : `sur une piste neuve « ${nomPiste(g)} »`);
  const apres = quoiDe(g) === 'chanson' && !V?.garder ? el('label', { class: 'opt mu-check', title: 'la version choisie, séparée ensuite en voix, batterie, basse, autre (music.stems)' },
    el('input', { type: 'checkbox', checked: g.apres === 'stems' || null, onchange: (e) => { g.apres = e.target.checked ? 'stems' : undefined; commit(app, 'quiet'); } }), ' puis séparer en pistes') : null;
  return el('div', { class: 'gp-foot' },
    el('span', { class: why ? 'gp-why' : 'gp-note' }, why || `${n} version${n > 1 ? 's' : ''} ${dest} · ${app.bar(c.start)} → ${app.bar(c.start + c.len)}${garde}${relire ? ' · la partition d\'abord' : ''}`),
    el('span', { class: 'sp' }), apres, sans, go);
}

// ── lancer ──────────────────────────────────────────────────
// Une plage encore vide devient une région d'une piste générative (la piste
// choisie si elle est générative et libre là, sinon une neuve sous elle).
function materialiser(app, d) {
  const P = app.S.proj, g = d.gen, s = schemaNow();
  let t = pisteLibre(app, d);
  if (!t) {
    const sel = app.track(app.S.sel.track), at = sel ? P.tracks.indexOf(sel) + 1 : undefined;
    t = app.addTrack('audio', { name: nomPiste(g), color: g.model === 'ace' ? 'coral-1' : 'coral-3', sub: `générative · ${model(s, g.model).nom}`, at });
  }
  t.gen = { model: g.model, task: g.task };
  const keep = ['quoi', 'voie', 'model', 'task', 'libre', 'instrument', 'apres', 'inst', 'ctx', 'relire'];
  const gen = { v: JSON.parse(JSON.stringify(g.v || {})), takes: [], take: null };
  for (const k of keep) if (g[k] !== undefined && g[k] !== null) gen[k] = JSON.parse(JSON.stringify(g[k]));
  const c = { id: app.uid('c'), track: t.id, start: d.start, len: d.len, off: 0, gen };
  if (lastCheck(d) !== undefined) setCheck(c, lastCheck(d));
  // les paroles suivent la région ; le brouillon garde le style pour la prochaine fois, et
  // reprend les valeurs du projet (Cal : « par défaut il prend la nôtre »)
  g.v = { ...g.v, abc: '', lyrics: '' };
  g.libre = {};
  delete g.v.src_audio; delete g.v.ref;
  P.clips.push(c);
  app.selectClips([c.id], true);
  app.commit('graph');
  return c;
}
async function lancer(app, go) {
  go.disabled = true;
  try {
    const s = await loadSchema();
    let c = cible(app);
    if (!c.id) { c = materialiser(app, c); O.region = c.id; }
    const P = app.S.proj, g = c.gen, V = voieDe(g), T = task(s, g.model, g.task), M = model(s, g.model);
    const vals = valeurs({ s, c, g, P, V });
    const body = { model: g.model, task: g.task, v: requestV(s, g.model, g.task, vals), projet: { bpm: P.bpm, sig: P.sig, tonic: P.key.tonic, mode: P.key.mode },
      libre: g.libre || {}, quoi: quoiDe(g), voie: V.id, region: { a: c.start, b: c.start + c.len }, sections: sectionsFor(P, c),
      title: (c.name || app.track(c.track)?.name || 'région').slice(0, 60), clip: c.id,
      project: P.id };   // les versions naissent dans le Space de Musique du projet (server/tools/chanson.py, project_space)
    if (V.garder) body.garder = g.instrument || 'drums';
    if (T.sortie === 'contexte') {
      const [w0, w1] = windowOf(P, c, vals.marge);
      const all = around(app, c, w0, w1).map((q) => q.id);
      body.region.w0 = w0; body.region.w1 = w1;
      body.context = await renderContext(app, c, w0, w1, (g.ctx || all).filter((id) => all.includes(id)));
    }
    const j = await api('music/gen/generate', { method: 'POST', body });
    const stem = V.garder ? I().stems[body.garder]?.stem : undefined;
    P.pending.push({ job: j.id, kind: 'takes', clip: c.id, title: j.title, fp: fingerprint(app, c), garder: stem,
      garderFr: stem ? (body.garder === 'other' ? 'le reste' : trackFr(s, body.garder)) : undefined, apres: g.apres });
    commit(app);
    jobs.poll(true);
    toast(`en file : ${j.title} · ${vals.n || 1} version${(vals.n || 1) > 1 ? 's' : ''} (${M.nom})`, 4000);
  } catch (e) { toast(e.message, 7000); go.disabled = false; repeindre(); }
}
