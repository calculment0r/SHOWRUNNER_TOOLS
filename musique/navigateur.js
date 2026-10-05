// ODIO — le navigateur, à gauche de l'arrangement et de la Session (celui de
// Live est commun aux deux vues) : ce qu'on glisse sur une piste (ou sous les
// pistes, pour une piste neuve), ou dans une case de la Session. En accordéon :
// chaque rubrique s'ouvre et se ferme par son titre, plusieurs à la fois ; le
// panneau entier se replie en un rail (le bouton ‹, ou Ctrl+Alt+B comme le
// navigateur de Live) et la vue prend toute la largeur.
//   Projet        la bibliothèque du projet (biblio.js) : ses clips édités
//                 (références de son, copies de notes), les sons qu'il a pris
//                 ou fabriqués, ses dossiers — ce qu'on fait dans ODIO sans
//                 encombrer Asset (Cal, 05/10 au soir)
//   Instruments   les sources (DR-9, boîte à rythme, synthés, basse acide,
//                 numérique, échantillonneur, audio) et les bus d'effets
//   Effets        à glisser sur une piste
//   Préréglages   des réglages nommés, par instrument, et les miens
//                 (« Enregistrer le réglage » dans la vue Instruments ;
//                 double-clic : renommer, clic droit : retirer)
//   Sons          la bibliothèque du portail (écouter, glisser) ; on y dépose
//                 aussi des fichiers du disque (catégorie Upload)
//   Motifs        les motifs du projet, et des modèles (rythmes, motifs tirés
//                 de la gamme de la session)
//   MIDI          la bibliothèque MIDI (sorte « midi » de la bibliothèque du
//                 portail) : les notes extraites d'un son, nos clips rangés,
//                 les fichiers .mid déposés ; glisser sur une piste
//                 d'instrument : ses notes (29/09)
// Clic sur un élément = le poser sur la piste choisie (ou une piste neuve) ;
// dans la Session, dans la case choisie (`poser`, session.js).
// Sons et MIDI sont aussi dans le panneau Asset commun (Ctrl+Espace, panneau.js) :
// un bouton les y mène tant qu'il est fermé.

import { api, href, toast, dragItem, dropZone, fmtDur, uploadFile, dock, dockKeyLabel } from '../commun/shell.js';
import { MODULES, SOURCES_OF, EFFECT_TYPES, PRESETS, DRUM_MODELS, NOTE_MODELS, TRACK_KINDS, keyLabel } from './modules.js';
import { el, put, menu, inlineEdit, ask } from './ui.js';
import { listMidi, midiSub, placeMidi, saveClipMidi } from './generatif_midi.js';
import { addGenTrack } from './generatif_region.js';
import { QUOI_FR, mesures, fiches, fiche } from './biblio.js';   // la bibliothèque du projet (05/10 au soir)
import { usagesDuSon } from './projet.js';

const MIME = 'application/x-odio';
const SECTIONS = [['proj', 'Projet'], ['inst', 'Instruments'], ['fx', 'Effets'], ['pre', 'Préréglages'], ['son', 'Sons'], ['mot', 'Motifs'], ['midi', 'MIDI']];
// ce qu'un clic pose dans une case de la Session (`poser`) plutôt que sur l'arrangement
const POSABLE = new Set(['son', 'midi', 'pclip', 'motif', 'modele', 'preset', 'inst']);

// `poser(payload)` : la vue Session — un clic pose dans la case choisie
export function createBrowser(app, { poser = null } = {}) {
  const { S } = app;
  const root = el('aside', { class: 'nv', 'aria-label': 'navigateur' });
  let q = '', sounds = null, loading = false, player = null, playing = null;
  const ui = () => S.proj.ui;
  // la rubrique Projet est ouverte tant qu'on ne l'a pas refermée
  const isOpen = (k) => { const o = ui().navOpen || { inst: true, son: true }; return k === 'proj' ? o.proj !== false : o[k] === true; };

  const item = (payload, { name, sub, dot, title = '', extra = null, onclick, rename = null, ctx = null }) => {
    const nm = el('span', { class: 'nm' }, name);
    const act = (e) => (poser && POSABLE.has(payload.t) ? poser(payload) : (onclick || (() => app.dropItem(payload, S.sel.track, app.pos())))(e));
    // un élément qu'on renomme : le clic attend de savoir s'il n'est pas le
    // premier d'un double-clic (poser le réglage redessinerait la liste
    // sous le second clic)
    const n = el('div', { class: 'nv-it', draggable: 'true', title: title || 'glisser sur une piste · clic : sur la piste choisie', tabindex: 0,
      onclick: (e) => {
        if (nm.classList.contains('editing')) return;
        if (!rename) { act(e); return; }
        clearTimeout(n._t);
        if (e.detail > 1) return;
        n._t = setTimeout(() => act(e), 280);
      },
      onkeydown: (e) => { if (e.key === 'Enter') act(e); } },
    dot ? el('i', { class: 'dot', style: { background: `var(--${dot})` } }) : null,
    nm, sub ? el('small', {}, sub) : null, extra);
    n.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData(MIME, JSON.stringify(payload)); });
    if (rename) n.addEventListener('dblclick', (e) => { e.stopPropagation(); clearTimeout(n._t); rename(nm); });
    if (ctx) n.addEventListener('contextmenu', (e) => { e.preventDefault(); menu(e.clientX, e.clientY, ctx(nm)); });
    return n;
  };
  const group = (label) => el('div', { class: 'nv-g' }, label);
  // les sons et le MIDI sont aussi dans le panneau Asset commun (commun/dock.js) : toute la bibliothèque,
  // ses filtres, ses Récents, ses Favoris ; ce bouton l'ouvre (il est monté pour qui l'a : l'invité non)
  const versPanneau = () => (dock.closed() ? el('button', { class: 'tb ghost sm nv-wide', type: 'button',
    title: 'la bibliothèque du portail, à gauche : chercher, filtrer, glisser sur une piste', onclick: () => dock.open({ focus: true }) },
  `Le panneau Asset${dockKeyLabel() ? ` · ${dockKeyLabel()}` : ''}`) : null);

  function instruments() {
    const out = [];
    const kinds = [['drums', 'Batterie'], ['synth', 'Synthés'], ['sampler', 'Échantillonneur'], ['audio', 'Audio']];
    for (const [k, label] of kinds) {
      out.push(group(label));
      for (const type of SOURCES_OF[k]) {
        const def = MODULES[type];
        out.push(item({ t: 'inst', kind: k, type }, { name: k === 'audio' ? 'Piste audio' : def.name, sub: k === 'audio' ? 'clips, import, micro' : def.kind, dot: def.color,
          title: 'glisser sous les pistes : une piste neuve · sur une piste de la même sorte : remplace son instrument' }));
      }
    }
    out.push(group('Bus d\'effets'));
    for (const [fx, name] of [['reverb', 'Bus réverbération'], ['reverbe', 'Bus réverbe ODIO'], ['delay', 'Bus délai'], ['rtt', 'Bus RTT-01']]) {
      out.push(item({ t: 'bus', fx }, { name, sub: 'retour dans la console', dot: MODULES[fx].color, onclick: () => app.addBus(fx) }));
    }
    // les pistes génératives : on y dessine une région, le modèle la remplit
    out.push(group('Génératif'));
    for (const [model, name, sub, dot] of [['ace', 'Piste générative · ACE-Step', 'une piste, morceau, repeindre', 'coral-1'], ['yue', 'Piste générative · YuE2', 'chanson, partition', 'coral-3']]) {
      out.push(item({ t: 'gen', model }, { name, sub, dot, title: 'une piste neuve : tirer sur sa voie dessine une région, le panneau du bas la fait générer',
        onclick: () => addGenTrack(app, model) }));
    }
    return out;
  }

  function effects() {
    return EFFECT_TYPES.map((type) => {
      const def = MODULES[type];
      return item({ t: 'fx', type }, { name: def.name, sub: def.odio ? `ODIO · ${def.kind}` : def.kind, dot: def.color,
        title: 'glisser sur une piste : l\'effet s\'insère avant sa tranche · clic : sur la piste choisie' });
    });
  }

  function presets() {
    const out = [];
    const mine = S.proj.presets || [];
    out.push(group(`Les miens · ${mine.length}`));
    if (!mine.length) out.push(el('p', { class: 'lbl nv-note' }, 'vue Instruments, en bas : « Enregistrer le réglage »'));
    for (const p of mine) {
      const rename = (nm) => inlineEdit(nm, p.name, (v) => { p.name = v.slice(0, 40); app.commit('quiet'); render(); }, { max: 40 });
      out.push(item({ t: 'preset', id: p.id }, { name: p.name, sub: MODULES[p.type]?.name || p.type, dot: MODULES[p.type]?.color,
        title: 'glisser sur une piste de cet instrument : ses réglages · double-clic : renommer · clic droit : retirer', rename,
        ctx: (nm) => [{ label: 'Renommer', sub: 'double-clic', onclick: () => rename(nm) },
          { label: 'Retirer', onclick: () => { S.proj.presets = mine.filter((x) => x !== p); app.commit('quiet'); render(); } }] }));
    }
    const byType = new Map();
    for (const p of PRESETS) { if (!byType.has(p.type)) byType.set(p.type, []); byType.get(p.type).push(p); }
    for (const [type, ps] of byType) {
      out.push(group(MODULES[type].name));
      for (const p of ps) out.push(item({ t: 'preset', id: p.id }, { name: p.name, sub: p.sub, dot: MODULES[type].color,
        title: 'glisser sur une piste de cet instrument : ses réglages · ailleurs : une piste neuve' }));
    }
    return out;
  }

  async function loadSounds() {
    loading = true;
    try { sounds = (await api(`library?kind=audio&q=${encodeURIComponent(q)}&limit=200&sort=new`)).items; } catch (e) { sounds = []; toast(e.message); }
    loading = false;
    if (isOpen('son') && soundBox) paintSounds();
  }
  function listen(it, btn) {
    if (player && playing === it.id) { player.pause(); player = null; playing = null; btn.textContent = '▶'; return; }
    if (player) player.pause();
    player = new Audio(href(it.url)); playing = it.id;
    player.play().catch(() => {});
    root.querySelectorAll('.nv-play').forEach((b) => { b.textContent = '▶'; });
    btn.textContent = '■';
    player.onended = () => { btn.textContent = '▶'; playing = null; };
  }
  // la recherche garde son champ (et le focus) : seule la liste se refait
  let search = null, soundBox = null;
  function paintSounds() {
    if (!sounds) { put(soundBox, el('p', { class: 'lbl' }, 'chargement')); return; }
    const out = [];
    if (!sounds.length) out.push(el('p', { class: 'lbl' }, 'aucun son · générer, exporter, déposer un fichier'));
    for (const it of sounds) {
      const btn = el('button', { class: 'nv-play', type: 'button', title: 'écouter', onclick: (e) => { e.stopPropagation(); listen(it, btn); } }, '▶');
      const n = item({ t: 'son', item: it }, { name: it.title, sub: [fmtDur(it.duration), it.origin?.tool === 'upload' ? 'upload' : it.origin?.model || it.origin?.tool].filter(Boolean).join(' · '),
        dot: 'grn2', extra: btn, title: 'glisser sur une piste audio (ou sous les pistes) · sur un échantillonneur : son son · clic : à la tête de lecture' });
      dragItem(n, it);          // le type commun du portail (ITEM_MIME), en plus du nôtre
      out.push(n);
    }
    put(soundBox, ...out);
  }
  function soundsList() {
    search = search || el('input', { class: 'fld', placeholder: 'chercher un son', value: q,
      oninput: (e) => { q = e.target.value; clearTimeout(search._t); search._t = setTimeout(loadSounds, 250); } });
    soundBox = el('div', { class: 'nv-sounds' });
    const drop = el('div', { class: 'nv-drop' }, 'déposer ici des fichiers audio : ils entrent dans la bibliothèque (Upload)');
    dropZone(drop, { kinds: ['audio'], via: 'odio', onitems: () => loadSounds() });
    if (!sounds && !loading) loadSounds();
    paintSounds();
    return [versPanneau(), search, drop, soundBox];
  }

  function motifs() {
    const P = S.proj, out = [];
    for (const t of P.tracks.filter((x) => TRACK_KINDS[x.kind]?.pattern)) {
      const ps = P.patterns.filter((p) => p.track === t.id);
      if (!ps.length) continue;
      out.push(group(t.name));
      for (const p of ps) {
        const n = P.clips.filter((c) => c.pat === p.id).length;
        const rename = (nm) => inlineEdit(nm, p.name, (v) => { p.name = v.slice(0, 40); app.commit('data'); }, { max: 40 });
        out.push(item({ t: 'motif', pat: p.id }, { name: p.name, sub: `${p.steps / (P.sig * 4)} mes. · ${n} clip${n > 1 ? 's' : ''}`, dot: t.color, rename,
          title: 'glisser sur sa piste : un clip · sur une autre piste de même sorte : une copie · clic : à la tête de lecture · double-clic : renommer' }));
      }
    }
    out.push(group('Modèles · rythmes'));
    for (const m of DRUM_MODELS) out.push(item({ t: 'modele', kind: 'drums', id: m.id }, { name: m.name, sub: '1 mesure', dot: 'or' }));
    out.push(group(`Modèles · gamme ${keyLabel(P.key)}`));
    for (const m of NOTE_MODELS) out.push(item({ t: 'modele', kind: 'notes', id: m.id }, { name: m.name, sub: 'tiré de la gamme', dot: 'cy' }));
    return out;
  }

  // ── la bibliothèque MIDI ──
  let mids = null, mloading = false, mq = '', msearch = null, midBox = null;
  async function loadMidi() {
    mloading = true;
    try { mids = await listMidi(mq); } catch (e) { mids = []; toast(e.message); }
    mloading = false;
    if (isOpen('midi') && midBox?.isConnected) paintMidi();
  }
  const playhead = () => Math.floor(app.pos() / S.proj.sig) * S.proj.sig;
  function paintMidi() {
    if (!mids) { put(midBox, el('p', { class: 'lbl' }, 'chargement')); return; }
    const out = [];
    if (!mids.length) out.push(el('p', { class: 'lbl nv-note' }, 'aucun clip MIDI · clic droit sur un clip audio : Extraire le MIDI · sur un clip de notes : le ranger · ou déposer un .mid'));
    for (const it of mids) {
      const rename = (nm) => inlineEdit(nm, it.title, async (v) => { await api(`library/${it.id}`, { method: 'POST', body: { title: v.slice(0, 80) } }); loadMidi(); }, { max: 60 });
      const n = item({ t: 'midi', id: it.id }, { name: it.title, sub: midiSub(it), dot: it.params?.drums ? 'or' : 'cy', rename,
        title: 'glisser sur une piste d\'instrument : ses notes · ailleurs : une piste neuve par canal · clic : sur la piste choisie, à la tête de lecture · double-clic : renommer',
        onclick: () => placeMidi(app, it.id, S.sel.track, playhead()),
        ctx: (nm) => [{ head: it.title }, { label: 'Renommer', sub: 'double-clic', onclick: () => rename(nm) },
          { label: 'Sur des pistes neuves', sub: 'une par canal', onclick: () => placeMidi(app, it.id, null, playhead()) },
          { label: 'Télécharger le fichier .mid', onclick: () => { const a = el('a', { href: href(it.url), download: `${it.title}.mid` }); document.body.append(a); a.click(); a.remove(); } },
          { label: 'Mettre à la corbeille', sub: 'bibliothèque', onclick: async () => { await api(`library/${it.id}/delete`, { method: 'POST' }); loadMidi(); } }] });
      dragItem(n, it);          // le type commun du portail (ITEM_MIME), en plus du nôtre
      out.push(n);
    }
    put(midBox, ...out);
  }
  function midiList() {
    msearch = msearch || el('input', { class: 'fld', placeholder: 'chercher un clip MIDI', value: mq,
      oninput: (e) => { mq = e.target.value; clearTimeout(msearch._t); msearch._t = setTimeout(loadMidi, 250); } });
    midBox = el('div', { class: 'nv-sounds' });
    const save = el('button', { class: 'tb ghost sm nv-wide', type: 'button', title: 'ranger dans la bibliothèque le clip de notes choisi dans l\'arrangement (ce qu\'il joue vraiment : répétitions, décalage, coupe)',
      onclick: async () => { const c = app.clip(S.sel.clip); if (!c?.pat) { toast('choisis d\'abord un clip de notes dans l\'arrangement'); return; } if (await saveClipMidi(app, c)) loadMidi(); } }, '+ Le clip choisi');
    const drop = el('div', { class: 'nv-drop' }, 'déposer ici des fichiers .mid : ils entrent dans la bibliothèque (Upload)');
    drop.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); drop.classList.add('drop-on'); } });
    drop.addEventListener('dragleave', () => drop.classList.remove('drop-on'));
    drop.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation(); drop.classList.remove('drop-on');
      const fs = [...(e.dataTransfer.files || [])];
      if (fs.some((f) => !/\.midi?$/i.test(f.name))) toast('ici, des fichiers MIDI (.mid) : les sons vont dans « Sons »');
      for (const f of fs.filter((x) => /\.midi?$/i.test(x.name))) { try { await uploadFile(f, { tool: 'upload', via: 'odio' }); } catch (err) { toast(`${f.name} : ${err.message}`); } }
      loadMidi();
    });
    if (!mids && !mloading) loadMidi();
    paintMidi();
    return [versPanneau(), msearch, save, drop, midBox];
  }
  document.addEventListener('mu:midi', () => { mids = null; if (isOpen('midi')) loadMidi(); });

  // ── la bibliothèque du projet (biblio.js) ──
  // Les clips édités du projet, puis ses sons ; chaque dossier ensuite, avec les
  // siens. Les fiches des sons (titre, durée, adresse) se lisent par lots.
  const P = () => S.proj;
  function projet() {
    const p = P(), b = p.biblio || { dossiers: [], clips: [], sons: [] };
    const manque = b.sons.map((x) => x.item).filter((id) => fiche(id) === undefined);
    if (manque.length) fiches(manque).then((neuves) => { if (neuves && isOpen('proj') && root.isConnected) render(); });
    const commit = (lab) => { app.label(lab); app.commit('data'); };
    const dansDossier = (x, quoi) => [
      ...b.dossiers.map((d) => ({ label: d.name, checked: x.dossier === d.id, onclick: () => { x.dossier = d.id; commit(`ranger ${quoi} dans « ${d.name} »`); } })),
      { label: 'Aucun', checked: !x.dossier, onclick: () => { delete x.dossier; commit(`sortir ${quoi} de son dossier`); } },
      '-', { label: 'Un dossier neuf…', onclick: async () => { const d = await neufDossier(); if (d) { x.dossier = d.id; commit(`ranger ${quoi} dans « ${d.name} »`); } } },
    ];
    const clipIt = (c) => {
      const rename = (nm) => inlineEdit(nm, c.name || '', (v) => { c.name = v.slice(0, 60); commit('renommer un clip du projet'); }, { max: 60 });
      const de = c.from && (app.clip(c.from) ? app.track(app.clip(c.from).track)?.name : null);
      return item({ t: 'pclip', id: c.id }, {
        name: c.name || (c.kind === 'audio' ? 'Son' : 'Notes'), sub: [c.kind === 'audio' ? 'son' : c.drums ? 'pas' : 'notes', mesures(p, c.len), de].filter(Boolean).join(' · '),
        dot: c.color || (c.kind === 'audio' ? 'grn2' : c.drums ? 'or' : 'cy'), rename,
        title: `un clip du projet (${c.kind === 'audio' ? 'une référence : le son d\'Asset, son départ, sa longueur' : 'une copie de notes'}) · glisser sur une piste ou dans une case de la Session · clic : ${poser ? 'dans la case choisie' : 'sur la piste choisie, à la tête de lecture'} · double-clic : renommer`,
        ctx: (nm) => [{ head: c.name || 'clip du projet' },
          { label: 'Renommer', sub: 'double-clic', onclick: () => rename(nm) },
          { label: 'Dans un dossier', items: dansDossier(c, 'un clip') },
          '-',
          { label: 'Retirer du projet', sub: 'les clips posés restent', onclick: () => { b.clips = b.clips.filter((x) => x !== c); p.biblio = b; commit(`retirer « ${c.name || 'un clip'} » du projet`); } }],
      });
    };
    const sonIt = (x) => {
      const it = fiche(x.item), u = usagesDuSon(p, x.item), libre = !u.arr && !u.sess && !u.refs && !u.ech;
      const ou = [u.arr ? `${u.arr} arr.` : '', u.sess ? `${u.sess} sess.` : '', u.refs ? `${u.refs} clip${u.refs > 1 ? 's' : ''}` : '', u.ech ? 'échant.' : ''].filter(Boolean).join(' · ');
      const sub = [QUOI_FR[x.quoi] || x.quoi, it?.duration ? fmtDur(it.duration) : '', ou || 'plus posé'].filter(Boolean).join(' · ');
      if (it === null) return el('div', { class: 'nv-it off', title: 'ce son n\'est plus dans la bibliothèque (corbeille, ou un autre Workspace)' }, el('i', { class: 'dot' }), el('span', { class: 'nm' }, x.item), el('small', {}, `introuvable · ${sub}`));
      const btn = it ? el('button', { class: 'nv-play', type: 'button', title: 'écouter', onclick: (e) => { e.stopPropagation(); listen(it, btn); } }, '▶') : null;
      const n = item(it ? { t: 'son', item: it } : { t: 'none' }, { name: it?.title || '…', sub, dot: 'grn2', extra: btn,
        title: `un son du projet (${QUOI_FR[x.quoi] || x.quoi}) · glisser sur une piste audio ou dans une case de la Session`,
        ctx: () => [{ head: it?.title || x.item },
          { label: 'Révéler dans Asset', sub: 'sa fiche, un autre onglet', onclick: () => open(href(`asset/#${x.item}`), '_blank') },
          { label: 'Dans un dossier', items: dansDossier(x, 'un son') },
          '-',
          { label: 'Retirer du projet', disabled: !libre, why: `encore posé : ${ou}`, onclick: () => { b.sons = b.sons.filter((y) => y !== x); commit('retirer un son du projet'); } }] });
      if (it) dragItem(n, it);
      return n;
    };
    const out = [];
    const racine = (x) => !x.dossier || !b.dossiers.some((d) => d.id === x.dossier);
    const rc = b.clips.filter(racine), rs = b.sons.filter(racine);
    out.push(el('button', { class: 'tb ghost sm nv-wide', type: 'button', title: 'un dossier du projet (un niveau) pour ranger clips et sons',
      onclick: () => neufDossier().then((d) => d && commit(`un dossier « ${d.name} »`)) }, '+ Dossier'));
    if (!b.clips.length && !b.sons.length) out.push(el('p', { class: 'lbl nv-note' }, 'les sons posés, importés, pris, rendus · les clips envoyés à la Session (clic droit sur un clip)'));
    if (rc.length) { out.push(group(`Clips · ${rc.length}`)); out.push(...rc.map(clipIt)); }
    if (rs.length) { out.push(group(`Sons · ${rs.length}`)); out.push(...rs.map(sonIt)); }
    for (const d of b.dossiers) {
      const dc = b.clips.filter((x) => x.dossier === d.id), ds = b.sons.filter((x) => x.dossier === d.id);
      const g = group(`${d.name} · ${dc.length + ds.length}`);
      g.classList.add('nv-dos');
      g.title = 'un dossier du projet · double-clic : renommer · clic droit : retirer';
      g.addEventListener('dblclick', () => inlineEdit(g, d.name, (v) => { d.name = v.slice(0, 40); commit('renommer le dossier'); }, { max: 40 }));
      g.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); menu(e.clientX, e.clientY, [{ head: `dossier · ${d.name}` },
        { label: 'Renommer', sub: 'double-clic', onclick: () => inlineEdit(g, d.name, (v) => { d.name = v.slice(0, 40); commit('renommer le dossier'); }, { max: 40 }) },
        { label: 'Retirer le dossier', sub: 'son contenu revient en tête', onclick: () => { for (const x of [...b.clips, ...b.sons]) if (x.dossier === d.id) delete x.dossier; b.dossiers = b.dossiers.filter((y) => y !== d); commit(`retirer le dossier « ${d.name} »`); } }]); });
      out.push(g, ...dc.map(clipIt), ...ds.map(sonIt));
      if (!dc.length && !ds.length) out.push(el('p', { class: 'lbl nv-note' }, 'vide · clic droit sur un clip ou un son : Dans un dossier'));
    }
    return out;
  }
  async function neufDossier() {
    const b = P().biblio;
    if (!b || b.dossiers.length >= 64) { toast('64 dossiers au plus'); return null; }
    const n = await ask('Un dossier du projet', 'Nom du dossier', `Dossier ${b.dossiers.length + 1}`, 'Créer');
    if (!n) return null;
    const d = { id: app.uid('d'), name: n.slice(0, 40) };
    b.dossiers.push(d);
    return d;
  }

  const BODY = { proj: projet, inst: instruments, fx: effects, pre: presets, son: soundsList, mot: motifs, midi: midiList };
  function toggle(k) {
    ui().navOpen = { ...(ui().navOpen || { inst: true, son: true }), [k]: !isOpen(k) };   // Projet : false le referme
    if (k === 'son' && isOpen('son')) sounds = null;
    if (k === 'midi' && isOpen('midi')) mids = null;
    app.saveUi();
    render();
  }
  const collapse = (on) => { ui().nav = on ? false : true; app.saveUi(); app.renderView(); };

  function render() {
    if (ui().nav === false) {
      put(root, el('button', { class: 'nv-rail', type: 'button', title: 'ouvrir le navigateur · Ctrl+Alt+B', onclick: () => collapse(false) },
        el('span', { class: 'ch' }, '›'), el('span', { class: 'vt' }, 'NAVIGATEUR')));
      return;
    }
    const scrollTop = root.querySelector('.nv-acc')?.scrollTop || 0;
    const acc = el('div', { class: 'nv-acc' }, SECTIONS.map(([k, l]) => {
      const open = isOpen(k);
      return el('div', { class: `nv-sec${open ? ' open' : ''}`, 'data-sec': k },
        el('button', { class: 'nv-h', type: 'button', 'aria-expanded': open, onclick: () => toggle(k) },
          el('i', { class: 'ch' }, open ? '▾' : '▸'), el('span', {}, l)),
        open ? el('div', { class: 'nv-list' }, BODY[k]()) : null);
    }));
    put(root,
      el('div', { class: 'nv-top' }, el('span', { class: 'lbl' }, 'navigateur'), el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'tout refermer', onclick: () => { ui().navOpen = { proj: false }; app.saveUi(); render(); } }, '▴'),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'replier le navigateur : l\'arrangement prend toute la largeur · Ctrl+Alt+B', onclick: () => collapse(true) }, '‹')),
      acc);
    acc.scrollTop = scrollTop;
  }
  document.addEventListener('sr:job', () => { if (isOpen('son')) loadSounds(); if (isOpen('midi')) loadMidi(); });
  // un autre Workspace (l'en-tête, musique.js : surEspace) : les sons et le MIDI se relisent
  document.addEventListener('mu:espace', () => {
    if (!root.isConnected) return;
    sounds = null; mids = null;
    if (isOpen('son')) loadSounds();
    if (isOpen('midi')) loadMidi();
  });
  // le panneau Asset s'ouvre ou se ferme : le bouton qui l'ouvre paraît ou s'en va (pas à chaque largeur)
  let panneauOuvert = null;
  document.addEventListener('sr:dock', (e) => {
    const o = !!e.detail?.open;
    if (o === panneauOuvert) return;
    panneauOuvert = o;
    if (root.isConnected && ui().nav !== false && (isOpen('son') || isOpen('midi'))) render();
  });
  return { el: root, render, refresh: () => { sounds = null; if (isOpen('son')) render(); } };
}
