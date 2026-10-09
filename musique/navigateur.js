// ODIO — le navigateur, à gauche de l'arrangement et de la Session (celui de
// Live est commun aux deux vues) : ce qu'on glisse sur une piste (ou sous les
// pistes, pour une piste neuve), ou dans une case de la Session. En accordéon :
// chaque rubrique s'ouvre et se ferme par son titre, plusieurs à la fois ; le
// panneau entier se replie en un rail (le bouton ‹, ou Ctrl+Alt+B comme le
// navigateur de Live) et la vue prend toute la largeur.
//   Space         le Space de Musique du projet (space.js, 06/10) : le menu des
//                 Spaces de l'app Musique, et ce que range le Space montré —
//                 projets ODIO, chansons, stems, sons, MIDI
//   Projet        la bibliothèque du projet (biblio.js) : ses clips édités
//                 (références de son, copies de notes), les sons qu'il a pris
//                 ou fabriqués, ses dossiers — ce qu'on fait dans ODIO sans
//                 encombrer Asset (Cal, 05/10 au soir)
//   Instruments   les sources (DR-9, boîte à rythme, synthés, basse acide,
//                 numérique, échantillonneur, audio) et les bus d'effets
//   Effets        à glisser sur une piste
//   Préréglages   la banque (prereglages.js) : par instrument (celui de la
//                 piste choisie, par défaut) et par catégorie ; ▶ écoute une
//                 phrase (ecoute.js), au survol si on le veut ; les miens
//                 (« + Le réglage de … », ou « Enregistrer le réglage » dans la
//                 vue Instruments ; double-clic : renommer, clic droit :
//                 catégorie, retirer)
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
import { CATEGORIES, CATEGORIE_FR } from './prereglages.js';   // la banque de préréglages (06/10)
import { ecouter, taire, enEcoute } from './ecoute.js';   // écouter un préréglage (06/10)
import { el, put, menu, inlineEdit, ask } from './ui.js';
import { listMidi, midiSub, placeMidi, saveClipMidi } from './generatif_midi.js';
import { addGenTrack } from './generatif_region.js';
import { QUOI_FR, mesures, fiches, fiche } from './biblio.js';   // la bibliothèque du projet (05/10 au soir)
import { usagesDuSon } from './projet.js';
import { rubriqueSpace, titreSpace } from './space.js';   // la rubrique « Space » (06/10, étape 7 de l'étude des Spaces)

const MIME = 'application/x-odio';
const SECTIONS = [['space', 'Space'], ['proj', 'Projet'], ['inst', 'Instruments'], ['fx', 'Effets'], ['pre', 'Préréglages'], ['son', 'Sons'], ['mot', 'Motifs'], ['midi', 'MIDI']];
// ce qu'un clic pose dans une case de la Session (`poser`) plutôt que sur l'arrangement
const POSABLE = new Set(['son', 'midi', 'pclip', 'motif', 'modele', 'preset', 'inst']);

// `poser(payload)` : la vue Session — un clic pose dans la case choisie
export function createBrowser(app, { poser = null } = {}) {
  const { S } = app;
  const root = el('aside', { class: 'nv', 'aria-label': 'navigateur' });
  let q = '', sounds = null, loading = false, player = null, playing = null;
  const ui = () => S.proj.ui;
  // les rubriques Space et Projet sont ouvertes tant qu'on ne les a pas refermées
  const isOpen = (k) => { const o = ui().navOpen || { inst: true, son: true }; return k === 'proj' || k === 'space' ? o[k] !== false : o[k] === true; };

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
      out.push(item({ t: 'gen', model }, { name, sub, dot, title: 'une piste neuve : tirer sur sa voie dessine une région, le panneau Générer la règle, ses versions reviennent en bas',
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

  // ── les préréglages (06/10 : la banque, prereglages.js ; l'écoute, ecoute.js) ──
  // En tête : pour quel instrument (celui de la piste choisie, par défaut),
  // les catégories, l'écoute au survol. Chaque préréglage : ▶ l'écoute (une
  // phrase de sa catégorie, dans la tonalité de la session), un clic le pose
  // sur la piste choisie (ou une piste neuve), glisser aussi. Les miens d'abord.
  const PREF = 'odio.prereglages';
  const pref = (() => { try { return JSON.parse(localStorage.getItem(PREF) || '{}') || {}; } catch { return {}; } })();
  const garderPref = () => { try { localStorage.setItem(PREF, JSON.stringify(pref)); } catch { /* stockage fermé : la session seule */ } };
  let survolT = 0;
  const typeDePiste = () => {
    const t = app.track(S.sel.track), m = t && app.mod(t.src);
    return m && MODULES[m.type]?.role === 'source' && m.type !== 'player' && m.type !== 'bus' ? m.type : null;
  };
  // le son qu'un échantillonneur écoute : celui de la piste choisie, si c'en est un
  const sonDEchantillon = () => { const t = app.track(S.sel.track), m = t && app.mod(t.src); return m?.type === 'sampler' ? m.params?.item || null : null; };
  function boutonEcoute(pr) {
    const ech = pr.type === 'sampler', item = ech ? sonDEchantillon() : null;
    const b = el('button', { class: `nv-play${enEcoute() === pr.id ? ' on' : ''}`, type: 'button', 'data-ecoute': pr.id,
      disabled: ech && !item ? true : null,
      title: ech && !item ? 'l\'échantillonneur écoute le son de sa piste : choisir une piste Échantillonneur qui a un son' : 'écouter (une phrase de sa catégorie, dans la tonalité de la session)',
      onclick: (e) => { e.stopPropagation(); if (enEcoute() === pr.id) taire(); else ecouter(app, pr, { geste: true, item }); } }, enEcoute() === pr.id ? '■' : '▶');
    return b;
  }
  // les banques d'échantillons du portail sont lues après l'ouverture (musique.js) : leurs préréglages arrivent
  document.addEventListener('mu:banques', () => { if (root.isConnected && isOpen('pre')) render(); });
  document.addEventListener('mu:ecoute', (e) => {
    if (!root.isConnected) return;
    for (const b of root.querySelectorAll('[data-ecoute]')) { const on = b.dataset.ecoute === e.detail?.id; b.classList.toggle('on', on); b.textContent = on ? '■' : '▶'; }
  });
  function itemPreset(pr, { mine = false, tous = false } = {}) {
    const def = MODULES[pr.type];
    const sub = [tous || mine ? def?.name : null, mine ? CATEGORIE_FR[pr.cat] || 'le mien' : pr.sub].filter(Boolean).join(' · ');
    const opts = { name: pr.name, sub, dot: def?.color, extra: boutonEcoute(pr),
      title: 'clic : sur la piste choisie (une piste neuve si elle n\'a pas cet instrument) · glisser sur une piste · ▶ écouter' };
    if (mine) {
      const P = S.proj;
      const rename = (nm) => inlineEdit(nm, pr.name, (v) => { pr.name = v.slice(0, 40); app.commit('quiet'); render(); }, { max: 40 });
      opts.rename = rename;
      opts.title += ' · double-clic : renommer · clic droit : catégorie, retirer';
      opts.ctx = (nm) => [{ head: pr.name }, { label: 'Renommer', sub: 'double-clic', onclick: () => rename(nm) },
        { label: 'Catégorie', items: CATEGORIES.map(([k, l]) => ({ label: l, checked: pr.cat === k, onclick: () => { pr.cat = k; app.commit('quiet'); render(); } })) },
        '-', { label: 'Retirer', onclick: () => { P.presets = (P.presets || []).filter((x) => x !== pr); app.commit('quiet'); render(); } }];
    }
    const n = item({ t: 'preset', id: pr.id }, opts);
    n.addEventListener('pointerenter', () => {
      if (!pref.survol) return;
      clearTimeout(survolT);
      survolT = setTimeout(() => ecouter(app, pr, { item: pr.type === 'sampler' ? sonDEchantillon() : null }), 220);
    });
    n.addEventListener('pointerleave', () => clearTimeout(survolT));
    return n;
  }
  function presets() {
    const out = [];
    const mine = S.proj.presets || [];
    const dePiste = typeDePiste();
    montre = dePiste + '|' + S.sel.track;
    // l'instrument montré : « piste » suit la piste choisie ; sinon un type, ou tous
    const choix = pref.inst || 'piste';
    const type = choix === 'piste' ? dePiste : choix === 'tous' ? null : choix;
    const types = [...new Set(PRESETS.map((x) => x.type))];
    const instMenu = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      menu(r.left, r.bottom + 4, [{ label: 'Celui de la piste choisie', sub: dePiste ? MODULES[dePiste].name : 'aucune piste d\'instrument', checked: choix === 'piste', onclick: () => { pref.inst = 'piste'; garderPref(); render(); } },
        { label: 'Tous les instruments', checked: choix === 'tous', onclick: () => { pref.inst = 'tous'; garderPref(); render(); } }, '-',
        ...types.map((k) => ({ label: MODULES[k].name, sub: `${PRESETS.filter((x) => x.type === k).length} préréglages`, dot: MODULES[k].color, checked: choix === k,
          onclick: () => { pref.inst = k; garderPref(); render(); } }))]);
    };
    const tete = el('div', { class: 'nv-pre-tete' },
      el('button', { class: 'tb ghost sm nv-wide', type: 'button', title: 'les préréglages de quel instrument', onclick: instMenu },
        `${choix === 'piste' ? 'Piste · ' : ''}${type ? MODULES[type].name : 'Tous les instruments'} ▾`),
      el('button', { class: `tb sm${pref.survol ? ' on' : ' ghost'}`, type: 'button', 'aria-pressed': pref.survol ? 'true' : 'false',
        title: 'écouter un préréglage dès que la souris passe dessus (le son du studio doit avoir été ouvert par un clic)',
        onclick: () => { pref.survol = !pref.survol; garderPref(); render(); } }, 'Survol'));
    out.push(tete);
    const liste = PRESETS.filter((x) => !type || x.type === type);
    const cats = CATEGORIES.filter(([k]) => liste.some((x) => x.cat === k));
    const cat = cats.some(([k]) => k === pref.cat) ? pref.cat : '';
    if (cats.length > 1) {
      out.push(el('div', { class: 'nv-chips' },
        el('button', { class: `tb sm${!cat ? ' on' : ' ghost'}`, type: 'button', onclick: () => { pref.cat = ''; garderPref(); render(); } }, 'Tout'),
        ...cats.map(([k, l]) => el('button', { class: `tb sm${cat === k ? ' on' : ' ghost'}`, type: 'button', onclick: () => { pref.cat = cat === k ? '' : k; garderPref(); render(); } }, l))));
    }
    // les miens : ceux de l'instrument montré
    const miens = mine.filter((x) => (!type || x.type === type) && (!cat || x.cat === cat));
    out.push(group(`Les miens · ${miens.length}`));
    const t = app.track(S.sel.track), src = t && app.mod(t.src);
    if (src && MODULES[src.type]?.role === 'source' && src.type !== 'player') {
      out.push(el('button', { class: 'tb ghost sm nv-wide', type: 'button', title: 'garder le réglage de l\'instrument de la piste choisie dans le projet (double-clic dessus : le renommer)',
        onclick: () => { const r = app.savePreset(t.id); if (r) render(); } }, `+ Le réglage de « ${t.name} »`));
    } else if (!mine.length) out.push(el('p', { class: 'lbl nv-note' }, 'choisir une piste d\'instrument : « + Le réglage » garde le sien'));
    for (const pr of miens) out.push(itemPreset(pr, { mine: true }));
    for (const [k, l] of cats) {
      if (cat && k !== cat) continue;
      const ps = liste.filter((x) => x.cat === k);
      out.push(group(`${l} · ${ps.length}`));
      for (const pr of ps) out.push(itemPreset(pr, { tous: !type }));
    }
    return out;
  }
  // la piste choisie a changé ailleurs (l'arrangement, la Session) : la rubrique
  // suit son instrument quand on revient dans le navigateur (aucune écoute de
  // la sélection à poser dans les vues)
  let montre = null;
  root.addEventListener('pointerenter', () => {
    if (isOpen('pre') && (pref.inst || 'piste') === 'piste' && typeDePiste() + '|' + S.sel.track !== montre) render();
  });

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

  // ── le Space de Musique (space.js) ──
  const espace = () => rubriqueSpace({ item, group, listen, playhead });
  const BODY = { space: espace, proj: projet, inst: instruments, fx: effects, pre: presets, son: soundsList, mot: motifs, midi: midiList };
  function toggle(k) {
    ui().navOpen = { ...(ui().navOpen || { inst: true, son: true }), [k]: !isOpen(k) };   // Space, Projet : false les referme
    if (k === 'son' && isOpen('son')) sounds = null;
    if (k === 'midi' && isOpen('midi')) mids = null;
    app.saveUi();
    render();
  }
  const collapse = (on) => { ui().nav = on ? false : true; app.saveUi(); app.renderView(); };
  function section(k, l) {
    const open = isOpen(k);
    return el('div', { class: `nv-sec${open ? ' open' : ''}`, 'data-sec': k },
      el('button', { class: 'nv-h', type: 'button', 'aria-expanded': open, onclick: () => toggle(k) },
        el('i', { class: 'ch' }, open ? '▾' : '▸'), el('span', {}, l),
        k === 'space' ? el('b', { class: 'nv-spn' }, titreSpace()) : null),
      open ? el('div', { class: 'nv-list' }, BODY[k]()) : null);
  }

  function render() {
    if (ui().nav === false) {
      put(root, el('button', { class: 'nv-rail', type: 'button', title: 'ouvrir le navigateur · Ctrl+Alt+B', onclick: () => collapse(false) },
        el('span', { class: 'ch' }, '›'), el('span', { class: 'vt' }, 'NAVIGATEUR')));
      return;
    }
    const scrollTop = root.querySelector('.nv-acc')?.scrollTop || 0;
    const acc = el('div', { class: 'nv-acc' }, SECTIONS.map(([k, l]) => section(k, l)));
    put(root,
      el('div', { class: 'nv-top' }, el('span', { class: 'lbl' }, 'navigateur'), el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'tout refermer', onclick: () => { ui().navOpen = { space: false, proj: false }; app.saveUi(); render(); } }, '▴'),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'replier le navigateur : l\'arrangement prend toute la largeur · Ctrl+Alt+B', onclick: () => collapse(true) }, '‹')),
      acc);
    acc.scrollTop = scrollTop;
  }
  document.addEventListener('sr:job', () => { if (isOpen('son')) loadSounds(); if (isOpen('midi')) loadMidi(); });
  // le Space montré, ou ce qu'il range, a changé (space.js) : son titre et sa rubrique se refont, seuls
  // (une rubrique voisine qu'on renomme garde son champ)
  document.addEventListener('mu:space', () => {
    const old = root.isConnected && ui().nav !== false && root.querySelector('.nv-sec[data-sec="space"]');
    if (old) old.replaceWith(section('space', SECTIONS[0][1]));
  });
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
