// ODIO — le panneau génératif : YuE2 (paroles et voix, travail `music.yue`)
// et ACE-Step 1.5 (`music.generate`), puis la séparation en pistes
// (`music.stems`). Le parcours tient en un clic : Lancer → le morceau se
// pose sur une piste audio → (case cochée) séparé en voix, batterie, basse,
// autre…, chaque piste sur sa piste audio, alignée sur l'original.
//
// Contrats (docs/etudes/musique.md §5), tenus par d'autres modules :
//   YuE2     POST /api/music/yue/generate {tags, lyrics, duration_s, seed, mode, precision, ref?, title}
//            options : GET /api/music/yue/options   (server/tools/music_yue.py)
//   séparer  POST /api/music/stems/separate {src, model, stems}
//            options : GET /api/music/stems/options (server/tools/music_stems.py)
// Chacun a son moteur d'essai tant que Cal ne branche pas le modèle ; le
// panneau le dit (options.engine). Un contrat absent du portail : le panneau
// le dit et le bouton explique pourquoi il ne part pas.
//
// Paroles : des blocs étiquetés séparés par une ligne vide. Les étiquettes
// que YuE2 publie dans ses options (« [Verse] », « [Chorus] »…) ; « [Verse] »
// aussi pour ACE-Step (sa documentation). Les sections de l'arrangement
// servent de plan. Style : les deux modèles lisent l'anglais (exemples de
// leurs documentations) ; les pastilles sont des suggestions, le champ reste libre.

import { api, jobs, toast, pick, href, dropZone, fmtDur, stateFr } from '../commun/shell.js';
import { SECTION_TAGS, guessTag, aceKey } from './modules.js';
import { el, drawer, put } from './ui.js';

// quand YuE2 ne publie pas ses suggestions (options absentes)
const SUGGEST = {
  genre: ['synthwave', 'electronic', 'pop', 'french pop', 'indie rock', 'hip-hop', 'lo-fi', 'ambient', 'cinematic', 'funk', 'house', 'jazz'],
  instruments: ['analog synth', 'synth bass', 'drum machine', '808', 'electric guitar', 'piano', 'strings', 'pads', 'arpeggiator'],
  mood: ['dark', 'melancholic', 'uplifting', 'energetic', 'dreamy', 'tense', 'warm', 'nostalgic'],
  voice: ['female vocal', 'male vocal', 'warm vocal', 'breathy', 'powerful', 'choir'],
};
const SUG_FR = { genre: 'Genre', instruments: 'Instruments', mood: 'Humeur', voice: 'Voix', langue: 'Langue', voix: 'Voix', tempo: 'Tempo', 'caractère': 'Caractère' };
export const STEM_FR = { vocals: 'Voix', drums: 'Batterie', bass: 'Basse', other: 'Autre', guitar: 'Guitare', piano: 'Piano', instrumental: 'Instrumental' };
const cap = (tag) => tag.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('-');

// les options d'un contrat : { ok, o } ou { ok: false, status, why }. On ne
// les demande que si le travail est déclaré (GET /api/music/engines →
// contracts) : pas de 404 pour rien dans la console.
export async function options(path, job) {
  if (job) {
    let c = null;
    try { c = (await api('music/engines')).contracts; } catch { /* le portail dira pourquoi plus bas */ }
    if (c && !c[job]) return { ok: false, status: 'absent', why: `le travail « ${job} » n'est pas déclaré sur ce portail` };
  }
  try { return { ok: true, o: await api(path) }; } catch (e) { return { ok: false, status: e.status, why: e.message }; }
}
// Le modèle de séparation : celui qu'on a choisi s'il est prêt, sinon celui
// que les options recommandent (le premier prêt de leur liste, rangée par
// qualité mesurée — music_stems.py), sinon le premier prêt.
export function bestStems(o, want = null) {
  const list = Array.isArray(o) ? o : o?.models || [];
  const ok = (x) => x && x.ready !== false;
  const m = [list.find((x) => x.id === want), list.find((x) => x.id === o?.recommended), list.find((x) => x.id === o?.default)]
    .find(ok) || list.find(ok) || null;
  return m ? { id: m.id, name: m.label || m.name || m.id, stems: m.stems || ['vocals', 'drums', 'bass', 'other'], list, engine: o?.engine } : null;
}

export async function openGenerative(app) {
  const { S } = app;
  const P = S.proj;
  const G = P.gen = { engine: 'yue', tags: '', blocks: [], dur: null, seed: null, ref: null, title: '', inst: false, lang: 'fr',
    tempo: true, split: true, at: 'plan', hist: [], ymode: null, yprec: 'bf16', stemModel: null, relire: true, abc: '', abcFp: '', ...(P.gen || {}) };
  const save = () => app.saveUi();
  const eng = el('div', { class: 'seg' });
  const dr = drawer({ title: 'Générer', cls: 'gen', head: [eng] });
  put(dr.body, el('p', { class: 'lbl' }, 'lecture des moteurs…'));
  const [yue, stems, ace] = await Promise.all([options('music/yue/options', 'music.yue'), options('music/stems/options', 'music.stems'), app.engines()]);
  const yo = yue.ok ? yue.o : null;

  const planSecs = () => G.blocks.reduce((s, b) => s + (b.bars || 0) * P.sig * 60 / P.bpm, 0);
  const bounds = () => (G.engine === 'yue'
    ? { min: yo?.params?.duration_s?.min ?? 10, max: yo?.params?.duration_s?.max ?? 300, def: yo?.params?.duration_s?.default ?? 60 }
    : { min: 10, max: 600, def: 30 });
  const lyricsText = () => {
    // YuE2 : paroles vides pour un instrumental (ses options) ; ACE : [Instrumental] côté serveur
    if (G.inst) return '';
    return G.blocks.filter((b) => b.text?.trim() || ['instrumental', 'intro', 'outro'].includes(b.tag))
      .map((b) => `[${G.engine === 'yue' && !yo ? b.tag : cap(b.tag)}]${b.text?.trim() ? `\n${b.text.trim()}` : ''}`).join('\n\n');
  };
  const tagsText = () => {
    const base = G.tags.trim();
    if (G.engine !== 'yue' || !G.tempo) return base;
    // le tempo et la tonalité se disent dans le style (YuE2 n'a pas d'entrée tempo : ses options)
    return [base, `${P.bpm} BPM`, aceKey(P.key)].filter(Boolean).join(', ');
  };

  function fromSections() {
    const old = new Map(G.blocks.filter((b) => b.sec).map((b) => [b.sec, b]));
    const secs = [...P.sections].sort((a, b) => a.a - b.a);
    if (!secs.length) { toast('l\'arrangement n\'a pas de section : double-clic sur la règle des sections'); return; }
    G.blocks = secs.map((s) => ({ sec: s.id, tag: s.tag || guessTag(s.name), name: s.name, bars: (s.b - s.a) / P.sig, text: old.get(s.id)?.text || '' }));
    G.dur = null;
    save(); paint();
  }

  function engineBox() {
    if (G.engine === 'yue') {
      if (!yue.ok) {
        return el('div', { class: 'mu-engine essai' }, el('b', {}, 'YuE2'), el('span', {}, 'absent'),
          el('span', { class: 'lbl' }, `${yue.why} (server/tools/music_yue.py) : « Lancer » ne part pas ; ACE-Step reste possible`));
      }
      const fake = yo.engine === 'factice';
      return el('div', { class: `mu-engine${fake ? ' essai' : ''}` },
        el('b', {}, 'YuE2'), el('span', {}, fake ? 'moteur d\'essai' : yo.ready ? 'prêt' : 'indisponible'),
        fake ? el('span', { class: 'lbl' }, `une mélodie d'essai à la durée, au tempo et à la graine demandés, pas YuE2 — il se branche par ${yo.switch || '"music_yue": true'}`) : null,
        !yo.ready && yo.why ? el('p', { class: 'why' }, yo.why) : null,
        el('span', { class: 'lbl' }, `séparation : ${stems.ok ? `${stemsLabel()}${stems.o.engine === 'factice' ? ' — moteur d\'essai (des filtres)' : ''}` : stems.why}`));
    }
    const g = ace.generate || { ok: false, why: ace.error };
    return el('div', { class: `mu-engine${ace.mode === 'factice' ? ' essai' : ''}` },
      el('b', {}, g.model || 'ACE-Step 1.5'), el('span', {}, g.ok ? `prêt${g.machine ? ` · ${g.machine}` : ''}` : 'indisponible'),
      ace.mode === 'factice' ? el('span', { class: 'lbl' }, 'mode essai : un son synthétisé dans la tonalité et au tempo de la session ; le modèle se branche par "music_engine": "ace-step"') : null,
      g.ok ? null : el('p', { class: 'why' }, `génération indisponible : ${g.why || 'raison inconnue'}`));
  }

  function styleBox() {
    const max = G.engine === 'ace' ? 512 : (yo?.params?.tags?.max ?? 2000);
    const count = el('span', { class: 'lbl' });
    const upd = () => { count.textContent = `${tagsText().length} / ${max}`; };
    const ta = el('textarea', { class: 'fld', rows: 3, maxlength: max, placeholder: yo?.tags?.example || 'genre, instruments, humeur, voix… (anglais conseillé)',
      oninput: (e) => { G.tags = e.target.value; upd(); save(); paintPreview(); } });
    ta.value = G.tags;
    upd();
    const sugg = G.engine === 'yue' && yo?.tags?.suggestions ? yo.tags.suggestions : SUGGEST;
    const has = (w) => G.tags.split(',').map((x) => x.trim().toLowerCase()).includes(w.toLowerCase());
    const chips = Object.entries(sugg).map(([k, words]) => el('div', { class: 'gen-chips' }, el('span', { class: 'lbl' }, SUG_FR[k] || k),
      (words || []).slice(0, 16).map((w) => el('button', { class: `opt${has(w) ? ' on' : ''}`, type: 'button', onclick: (e) => {
        const parts = G.tags.split(',').map((x) => x.trim()).filter(Boolean);
        const i = parts.findIndex((x) => x.toLowerCase() === w.toLowerCase());
        if (i >= 0) parts.splice(i, 1); else parts.push(w);
        G.tags = parts.join(', '); ta.value = G.tags; e.currentTarget.classList.toggle('on', i < 0); save(); paintPreview(); upd();
      } }, w))));
    return el('div', { class: 'gen-sec' },
      el('div', { class: 'row' }, el('b', { class: 'venus' }, 'Style'), el('span', { class: 'sp' }),
        G.engine === 'yue' && yo?.tags?.order ? el('span', { class: 'lbl' }, `dans l'ordre : ${yo.tags.order.join(', ')}`) : null, count),
      ...chips, ta,
      G.engine === 'yue' ? el('label', { class: 'opt mu-check' }, el('input', { type: 'checkbox', checked: G.tempo || null, onchange: (e) => { G.tempo = e.target.checked; save(); paintPreview(); upd(); } }),
        ` ajouter le tempo et la tonalité de la session (${P.bpm} BPM, ${aceKey(P.key)})`)
        : el('p', { class: 'lbl' }, `tempo ${P.bpm} · tonalité ${aceKey(P.key)} (la session ; ACE-Step ne connaît que majeur et mineur) · mesure ${P.sig}`));
  }

  function planBox() {
    const blocks = el('div', { class: 'gen-blocks' });
    G.blocks.forEach((b, i) => {
      const tag = el('select', { class: 'fld mu-mini', 'aria-label': 'étiquette', onchange: (e) => { b.tag = e.target.value; save(); paintPreview(); } },
        SECTION_TAGS.map(([k, l]) => el('option', { value: k, selected: b.tag === k || null }, `${l} · [${cap(k)}]`)));
      const ta = el('textarea', { class: 'fld', rows: ['intro', 'outro', 'instrumental'].includes(b.tag) ? 1 : 3, placeholder: b.tag === 'instrumental' ? '(sans paroles)' : 'les paroles de ce bloc',
        disabled: G.inst || null, oninput: (e) => { b.text = e.target.value; save(); paintPreview(); } });
      ta.value = b.text || '';
      blocks.append(el('div', { class: 'gen-block' },
        el('div', { class: 'row' }, tag, el('b', {}, b.name || ''), el('span', { class: 'lbl' }, b.bars ? `${b.bars} mes. · ${fmtDur(b.bars * P.sig * 60 / P.bpm)}` : ''),
          el('span', { class: 'sp' }),
          el('button', { class: 'tb ghost sm', type: 'button', disabled: i === 0 || null, onclick: () => { [G.blocks[i - 1], G.blocks[i]] = [G.blocks[i], G.blocks[i - 1]]; save(); paint(); } }, '↑'),
          el('button', { class: 'tb ghost sm', type: 'button', disabled: i === G.blocks.length - 1 || null, onclick: () => { [G.blocks[i + 1], G.blocks[i]] = [G.blocks[i], G.blocks[i + 1]]; save(); paint(); } }, '↓'),
          el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { G.blocks.splice(i, 1); save(); paint(); } }, '×')),
        ta));
    });
    return el('div', { class: 'gen-sec' },
      el('div', { class: 'row' }, el('b', { class: 'venus' }, 'Plan et paroles'), el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'un bloc par section de l\'arrangement, dans l\'ordre (les paroles déjà écrites restent)', onclick: fromSections }, 'Reprendre les sections'),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { G.blocks.push({ tag: 'verse', name: '', bars: 0, text: '' }); save(); paint(); } }, '+ Bloc')),
      G.blocks.length ? blocks : el('p', { class: 'lbl' }, `« Reprendre les sections » : ${P.sections.length} section${P.sections.length > 1 ? 's' : ''} de l'arrangement deviennent le plan (couplet, refrain…), à remplir de paroles`),
      G.engine === 'yue' && yo?.params?.lyrics?.doc ? el('p', { class: 'lbl' }, yo.params.lyrics.doc) : null,
      el('label', { class: 'opt mu-check' }, el('input', { type: 'checkbox', checked: G.inst || null, onchange: (e) => { G.inst = e.target.checked; save(); paint(); } }), ' instrumental (sans paroles)'),
      el('pre', { class: 'gen-pre', id: 'gen-pre' }));
  }

  // relire la partition avant de chanter (05/10, Cal : « un mode de validation de ce que le
  // modèle va faire avant de le calculer […] par défaut ») : YuE2 écrit d'abord sa partition
  // (music.yue.abc, YuE2GenerateABC seul) ; on la relit ici, puis Lancer la fait chanter telle
  // quelle (entrée `abc`). Pas pour une reprise : sa partition vient de la référence.
  const relire = () => G.engine === 'yue' && G.relire !== false && !G.ref && (G.ymode || 'full') !== 'off' && !!yo;
  const abcFp = () => JSON.stringify([tagsText(), lyricsText(), G.ymode || 'full', G.yprec || 'bf16']);
  const abcOk = () => !!G.abc && G.abcFp === abcFp();
  let abcJob = null;
  async function ecrire(again = false) {
    const tags = tagsText();
    if (!tags) { toast('décris le style : genre, instruments, humeur, voix'); return; }
    const secs = G.blocks.length ? G.blocks.map((b) => [b.tag || 'verse', Math.max(1, Math.round(b.bars || 4))]) : [['verse', 8]];
    try {
      abcJob = await api('music/yue/abc', { method: 'POST', body: { tags, lyrics: lyricsText(), seed: again ? -1 : (G.seed ?? -1), mode: G.ymode || 'full', precision: G.yprec || 'bf16',
        projet: { bpm: P.bpm, sig: P.sig, tonic: P.key.tonic, mode: P.key.mode }, sections: secs, title: (G.title || '').trim() || P.name } });
      paint(); jobs.poll(true);
      const done = await jobs.wait(abcJob.id);
      if (done.state !== 'done') throw new Error(`partition : ${stateFr(done.state)}${done.message ? ' — ' + done.message : ''}`);
      // jamais coupée ici (une coupe au milieu d'une ligne la ferait refuser) : le serveur
      // l'a déjà mise au dialecte et bornée (music_yue.abc_normalise)
      G.abc = done.result?.abc || ''; G.abcFp = abcFp();
      save();
      const fixes = done.result?.normalise || [];
      toast(`${done.result?.engine === 'factice' ? 'partition d\'essai écrite (moteur factice)' : 'partition écrite'} : relis-la, puis Lancer${fixes.length ? ` · ${fixes.join(' · ')}` : ''}`, fixes.length ? 9000 : 5000);
    } catch (e) { toast(e.message, 7000); }
    abcJob = null;
    if (document.body.contains(dr.root)) paint();
  }
  function partBox() {
    if (G.engine !== 'yue' || !yo) return null;
    const why = G.ref ? 'une reprise : sa partition vient de la référence (SheetSage2)' : (G.ymode || 'full') === 'off' ? 'partition « sans » : YuE2 n\'en écrit pas' : '';
    const head = el('div', { class: 'row' }, el('b', { class: 'venus' }, 'Partition'), el('span', { class: 'sp' }),
      el('label', { class: 'opt mu-check', title: why || 'YuE2 écrit d\'abord sa partition ; tu la relis, puis Lancer la chante telle quelle' },
        el('input', { type: 'checkbox', checked: (G.relire !== false && !why) || null, disabled: why ? true : null, onchange: (e) => { G.relire = e.target.checked; save(); paint(); } }),
        ' relire avant de chanter'));
    if (!relire()) return el('div', { class: 'gen-sec' }, head, el('p', { class: 'lbl' }, why || 'éteint : YuE2 écrit sa partition et chante d\'un trait'));
    if (abcJob) return el('div', { class: 'gen-sec' }, head, el('div', { class: 'gen-res' }, el('span', { class: 'pill work' }, el('i'), el('span', {}, 'YuE2 écrit la partition')), el('span', { class: 'sp' }), el('span', { class: 'lbl', 'data-job': abcJob.id }, 'en file')));
    if (!G.abc) return el('div', { class: 'gen-sec' }, head, el('p', { class: 'lbl' }, 'Lancer fait d\'abord écrire la partition (la mélodie, les accords, le tempo, les sections) : rien n\'est chanté ; tu la relis ici avant le calcul du son.'));
    const ta = el('textarea', { class: 'fld gen-abc', rows: 9, spellcheck: 'false', 'aria-label': 'la partition (ABC)', oninput: (e) => { G.abc = e.target.value; G.abcFp = abcFp(); save(); } });
    ta.value = G.abc;
    const q = G.abc.match(/^Q:\s*(?:\d+\/\d+\s*=\s*)?(\d+)/m), k = G.abc.match(/^K:\s*(\S+)/m), m = G.abc.match(/^M:\s*(\S+)/m);
    const secs = [...G.abc.matchAll(/^%\s*(\S+)/gm)].map((x) => x[1]).filter((t, i, a) => i === 0 || t !== a[i - 1]);
    return el('div', { class: 'gen-sec' }, head,
      el('p', { class: abcOk() ? 'lbl' : 'why' }, abcOk() ? `à relire · ${q ? q[1] + ' BPM' : 'tempo ?'} · ${m ? m[1] : ''} · ${k ? k[1] : ''}${secs.length ? ' · ' + secs.join(' → ') : ''}`
        : 'périmée : le style ou les paroles ont changé — Lancer la réécrit'),
      ta,
      el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'Vocal : le chant et ses accords · Ins : le thème · Q: le tempo · K: la tonalité'), el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'une autre partition', onclick: () => { G.abc = ''; save(); ecrire(true); } }, 'Réécrire'),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { G.abc = ''; save(); paint(); } }, 'Oublier')));
  }

  let refItem = null;
  function settingsBox() {
    const B = bounds();
    const def = Math.round(Math.min(B.max, Math.max(B.min, G.dur || planSecs() || B.def)));
    const dur = el('input', { class: 'fld', type: 'number', min: B.min, max: B.max, step: 1, value: def, oninput: (e) => { G.dur = +e.target.value; save(); } });
    const seed = el('input', { class: 'fld', type: 'number', min: 0, placeholder: 'au hasard', value: G.seed ?? '', oninput: (e) => { G.seed = e.target.value === '' ? null : +e.target.value; save(); } });
    const lab = (t, n, extra) => el('label', { class: 'field' }, el('span', { class: 'lbl' }, t, extra ? el('b', {}, ` · ${extra}`) : null), n);
    const rows = [];
    if (G.engine === 'yue') {
      const refOk = !!yo?.ref_ready;
      const refSlot = el('div', { class: 'gen-ref', title: yo?.reference?.doc || '' });
      const paintRef = () => put(refSlot,
        el('span', { class: 'lbl' }, refItem ? refItem.title : G.ref ? G.ref : 'aucune'),
        el('button', { class: 'tb ghost sm', type: 'button', disabled: !refOk || null, title: refOk ? 'un son de la bibliothèque (ou déposé ici)' : 'le moteur YuE2 ne la prend pas (options : ref_ready)',
          onclick: async () => { const [it] = await pick({ kinds: ['audio'], title: 'Un morceau de référence pour YuE2' }); if (it) { refItem = it; G.ref = it.id; if (G.ymode === 'off' || !G.ymode) G.ymode = 'melody'; save(); paint(); } } }, 'Choisir'),
        G.ref ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { refItem = null; G.ref = null; save(); paint(); } }, '×') : null);
      paintRef();
      if (refOk) dropZone(refSlot, { kinds: ['audio'], multiple: false, via: 'odio', onitems: ([it]) => { refItem = it; G.ref = it.id; if (!G.ymode || G.ymode === 'off') G.ymode = 'melody'; save(); paint(); } });
      const modes = yo?.modes || [];
      const precs = yo?.precisions || [];
      rows.push(el('div', { class: 'mu-form4' },
        lab('Durée (s)', dur, `${B.min} à ${B.max}${G.blocks.length ? ` · plan ${Math.round(planSecs())} s` : ''}`),
        lab('Graine', el('div', { class: 'row' }, seed, el('button', { class: 'tb ghost sm', type: 'button', title: 'une graine au hasard (pour la noter)', onclick: () => { G.seed = Math.floor(Math.random() * 2 ** 31); seed.value = G.seed; save(); } }, 'Dé'))),
        lab('Référence (reprise)', refSlot, refOk ? 'sa partition, rechantée' : 'non prise')));
      if (modes.length || precs.length) {
        rows.push(el('div', { class: 'mu-form4' },
          modes.length ? lab('Partition', el('select', { class: 'fld', onchange: (e) => { G.ymode = e.target.value; save(); } },
            modes.map((m) => el('option', { value: m.id, title: m.doc || '', selected: (G.ymode || (G.ref ? 'melody' : 'full')) === m.id || null }, m.label || m.id)))) : null,
          precs.length ? lab('Précision', el('select', { class: 'fld', onchange: (e) => { G.yprec = e.target.value; save(); } },
            precs.map((m) => el('option', { value: m.id, title: m.doc || '', selected: G.yprec === m.id || null }, `${m.id}${m.size_gb ? ` · ${m.size_gb} Go` : ''}`)))) : null,
          yo?.reference?.doc ? el('p', { class: 'lbl' }, yo.reference.doc) : null));
      }
    } else {
      const lang = el('select', { class: 'fld', onchange: (e) => { G.lang = e.target.value; save(); } },
        (ace.languages || ['fr', 'en']).map((k) => el('option', { value: k, selected: k === G.lang || null }, k)));
      rows.push(el('div', { class: 'mu-form4' },
        lab('Durée (s)', dur, `${B.min} à ${B.max}${G.blocks.length ? ` · plan ${Math.round(planSecs())} s` : ''}`),
        lab('Graine', el('div', { class: 'row' }, seed, el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { G.seed = Math.floor(Math.random() * 2 ** 31); seed.value = G.seed; save(); } }, 'Dé'))),
        lab('Langue', lang)));
    }
    const sm = stems.ok ? (stems.o.models || []) : [];
    const cur = stems.ok ? bestStems(stems.o, G.stemModel) : null;
    return el('div', { class: 'gen-sec' }, ...rows,
      el('div', { class: 'mu-form4' },
        el('label', { class: 'field wide' }, el('span', { class: 'lbl' }, 'Titre'), el('input', { class: 'fld', maxlength: 80, value: G.title, placeholder: P.name, oninput: (e) => { G.title = e.target.value; save(); } })),
        lab('Poser à', el('div', { class: 'seg' }, [['plan', 'Début du plan'], ['tete', 'Tête de lecture']].map(([k, l]) =>
          el('button', { class: `tb${G.at === k ? ' on' : ''}`, type: 'button', onclick: () => { G.at = k; save(); paint(); } }, l))))),
      el('div', { class: 'row gen-split' },
        el('label', { class: 'opt mu-check' }, el('input', { type: 'checkbox', checked: (G.split && stems.ok) || null, disabled: !stems.ok || null, onchange: (e) => { G.split = e.target.checked; save(); } }),
          ' puis séparer en pistes, chacune sur sa piste audio, alignées'),
        sm.length ? el('select', { class: 'fld mu-mini', 'aria-label': 'modèle de séparation', title: 'le modèle de séparation (recommandé : le meilleur prêt, mesures publiées)',
          onchange: (e) => { G.stemModel = e.target.value; save(); paint(); } },
        sm.map((m) => el('option', { value: m.id, disabled: m.ready === false || null, selected: cur?.id === m.id || null },
          `${m.label}${m.id === stems.o.recommended ? ' · recommandé' : ''}${m.ready === false ? ' · pas prêt' : ''}`))) : el('span', { class: 'lbl' }, stems.why || '')),
      cur ? el('p', { class: 'lbl' }, `pistes : ${cur.stems.map((s) => STEM_FR[s] || s).join(', ')}${stems.o.engine === 'factice' ? ' · moteur d\'essai : des filtres, pas une séparation' : ''}`) : null);
  }

  function stemsLabel() {
    const b = stems.ok ? bestStems(stems.o, G.stemModel) : null;
    return b ? `${b.name} (${b.stems.map((s) => (STEM_FR[s] || s).toLowerCase()).join(', ')})` : 'aucun modèle prêt';
  }

  function resultsBox() {
    const pend = (P.pending || []).filter((x) => x.kind === 'generate' || x.kind === 'stems');
    const hist = (G.hist || []).slice(-8).reverse();
    if (!pend.length && !hist.length) return null;
    return el('div', { class: 'gen-sec' }, el('b', { class: 'venus' }, 'Résultats'),
      pend.map((x) => el('div', { class: 'gen-res' }, el('span', { class: 'pill work' }, el('i'), el('span', {}, x.kind === 'stems' ? 'séparation' : 'génération')),
        el('span', {}, x.title || x.job), el('span', { class: 'sp' }), el('span', { class: 'lbl', 'data-job': x.job }, 'en file'))),
      hist.map((h) => el('div', { class: 'gen-res' },
        el('span', { class: 'lbl' }, h.engine === 'yue' ? 'YuE2' : 'ACE'), el('b', {}, h.title),
        el('span', { class: 'sp' }),
        h.items?.[0] ? el('button', { class: 'tb ghost sm', type: 'button', title: 'écouter', onclick: async (e) => {
          const b = e.currentTarget;
          if (b._a) { b._a.pause(); b._a = null; b.textContent = 'Écouter'; return; }
          const it = await app.loadItem(h.items[0]);
          b._a = new Audio(href(it.url)); b._a.play().catch(() => {}); b.textContent = 'Arrêter';
          b._a.onended = () => { b._a = null; b.textContent = 'Écouter'; };
        } }, 'Écouter') : null,
        h.items?.[0] ? el('button', { class: 'tb ghost sm', type: 'button', title: 'une piste audio neuve, à la tête de lecture', onclick: () => app.placeItems(h.items, { at: app.pos() }) }, 'Poser') : null,
        h.items?.[0] && stems.ok ? el('button', { class: 'tb ghost sm', type: 'button', title: stemsLabel(), onclick: () => app.stemsItem(h.items[0]) }, 'Séparer') : null)));
  }

  const preview = () => document.getElementById('gen-pre');
  function paintPreview() {
    const pre = preview();
    if (!pre) return;
    const ly = lyricsText();
    pre.textContent = `style → ${tagsText() || '(vide)'}\n\nparoles →\n${ly || '(aucune : instrumental)'}`;
  }

  function paint() {
    put(eng, ...[['yue', 'YuE2'], ['ace', 'ACE-Step']].map(([k, l]) => el('button', { class: `tb${G.engine === k ? ' on' : ''}`, type: 'button',
      onclick: () => { G.engine = k; save(); paint(); } }, l)));
    const go = el('button', { class: 'tb go', type: 'button', disabled: abcJob ? true : null }, relire() && !abcOk() ? (abcJob ? 'La partition s\'écrit…' : 'Écrire la partition') : 'Lancer');
    const why = G.engine === 'ace' ? (ace.generate?.ok ? '' : `ACE-Step indisponible : ${ace.generate?.why || ace.error || ''}`)
      : !yue.ok ? `YuE2 absent : ${yue.why}` : yo.ready === false ? `YuE2 indisponible : ${yo.why}` : '';
    if (why) { go.disabled = true; go.title = why; }
    go.addEventListener('click', () => launch(go));
    put(dr.body,
      // le génératif par région (generatif_region.js) : une piste seule, calée sur la région, en prises
      el('p', { class: 'gen-hint' }, 'Ici, un morceau entier. Une seule piste (la batterie, une guitare), une région précise, une partition à relire : « + Piste » → Générative, puis tirer sur sa voie ; le panneau du bas la règle.'),
      engineBox(), styleBox(), planBox(), settingsBox(), partBox(), resultsBox(),
      el('div', { class: 'gen-foot' },
        el('span', { class: why ? 'why' : 'lbl' }, why || `le morceau se pose sur une piste audio neuve ${G.at === 'plan' ? `au début du plan (${app.bar(planStart())})` : `à la tête de lecture (${app.bar(app.pos())})`} et entre dans la bibliothèque (Musique)`),
        el('span', { class: 'sp' }), go));
    paintPreview();
  }
  const planStart = () => {
    const first = G.blocks.find((b) => b.sec);
    const s = first && P.sections.find((x) => x.id === first.sec);
    return s ? s.a : 0;
  };

  async function launch(go) {
    if (relire() && !abcOk()) { ecrire(); return; }
    const tags = tagsText();
    if (!tags) { toast('décris le style : genre, instruments, humeur, voix'); return; }
    const B = bounds();
    const dur = Math.round(Math.min(B.max, Math.max(B.min, G.dur || planSecs() || B.def)));
    const at = G.at === 'plan' ? planStart() : app.pos();
    const title = (G.title || '').trim() || P.name;
    go.disabled = true;
    try {
      let j;
      if (G.engine === 'yue') {
        const body = { tags, lyrics: lyricsText(), duration_s: dur, seed: G.seed ?? Math.floor(Math.random() * 2 ** 31), title };
        if (yo.modes?.length) body.mode = G.ymode || (G.ref ? 'melody' : 'full');
        if (yo.precisions?.length) body.precision = G.yprec || 'bf16';
        if (G.ref && yo.ref_ready) body.ref = G.ref;
        if (relire() && abcOk()) body.abc = G.abc;              // la partition relue, chantée telle quelle
        j = await api('music/yue/generate', { method: 'POST', body });
      } else {
        j = await api('music/generate', { method: 'POST', body: {
          title, tags, lyrics: G.inst ? '' : lyricsText(), instrumental: !!G.inst || !lyricsText(), duration: dur, bpm: Math.min(300, Math.max(30, P.bpm)),
          keyscale: aceKey(P.key), timesignature: String(P.sig), language: G.lang || 'fr', seed: G.seed,
        } });
      }
      P.pending.push({ job: j.id, kind: 'generate', engine: G.engine, at, title, split: !!G.split && stems.ok, stemModel: stems.ok ? bestStems(stems.o, G.stemModel)?.id : null });
      app.commit('data');
      toast(`en file : ${j.title}${G.split && stems.ok ? ' · puis la séparation en pistes' : ''}`, 5000);
      jobs.poll(true);
      paint();
    } catch (e) { toast(e.message, 6000); go.disabled = false; }
  }

  // l'état des travaux, à chaque relevé de la file
  const off = jobs.watch((list) => {
    for (const n of dr.root.querySelectorAll('[data-job]')) {
      const j = list.find((x) => x.id === n.dataset.job);
      if (j) n.textContent = `${stateFr(j.state)}${j.progress != null && j.state === 'running' ? ` · ${Math.round(j.progress * 100)} %` : ''}${j.message ? ` · ${j.message}` : ''}`.slice(0, 80);
    }
  });
  const onPlaced = () => { if (document.body.contains(dr.root)) paint(); };
  document.addEventListener('mu:placed', onPlaced);
  const obs = new MutationObserver(() => { if (!document.body.contains(dr.root)) { off(); obs.disconnect(); document.removeEventListener('mu:placed', onPlaced); } });
  obs.observe(document.body, { childList: true });
  paint();
  return dr;
}
