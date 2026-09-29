// ODIO — le navigateur, à gauche de l'arrangement : ce qu'on glisse sur
// une piste (ou sous les pistes, pour une piste neuve). En accordéon : chaque
// rubrique s'ouvre et se ferme par son titre, plusieurs à la fois ; le
// panneau entier se replie en un rail (le bouton ‹, ou Ctrl+Alt+B comme le
// navigateur de Live) et l'arrangement prend toute la largeur.
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
// Clic sur un élément = le poser sur la piste choisie (ou une piste neuve).

import { api, href, toast, dragItem, dropZone, fmtDur, uploadFile } from '../commun/shell.js';
import { MODULES, SOURCES_OF, EFFECT_TYPES, PRESETS, DRUM_MODELS, NOTE_MODELS, TRACK_KINDS, keyLabel } from './modules.js';
import { el, put, menu, inlineEdit } from './ui.js';
import { listMidi, midiSub, placeMidi, saveClipMidi } from './generatif_midi.js';
import { addGenTrack } from './generatif_region.js';

const MIME = 'application/x-odio';
const SECTIONS = [['inst', 'Instruments'], ['fx', 'Effets'], ['pre', 'Préréglages'], ['son', 'Sons'], ['mot', 'Motifs'], ['midi', 'MIDI']];

export function createBrowser(app) {
  const { S } = app;
  const root = el('aside', { class: 'nv', 'aria-label': 'navigateur' });
  let q = '', sounds = null, loading = false, player = null, playing = null;
  const ui = () => S.proj.ui;
  const isOpen = (k) => (ui().navOpen || { inst: true, son: true })[k] === true;

  const item = (payload, { name, sub, dot, title = '', extra = null, onclick, rename = null, ctx = null }) => {
    const nm = el('span', { class: 'nm' }, name);
    const act = (e) => (onclick || (() => app.dropItem(payload, S.sel.track, app.pos())))(e);
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
    return [search, drop, soundBox];
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
    return [msearch, save, drop, midBox];
  }
  document.addEventListener('mu:midi', () => { mids = null; if (isOpen('midi')) loadMidi(); });

  const BODY = { inst: instruments, fx: effects, pre: presets, son: soundsList, mot: motifs, midi: midiList };
  function toggle(k) {
    ui().navOpen = { ...(ui().navOpen || { inst: true, son: true }), [k]: !isOpen(k) };
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
        el('button', { class: 'tb ghost sm', type: 'button', title: 'tout refermer', onclick: () => { ui().navOpen = {}; app.saveUi(); render(); } }, '▴'),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'replier le navigateur : l\'arrangement prend toute la largeur · Ctrl+Alt+B', onclick: () => collapse(true) }, '‹')),
      acc);
    acc.scrollTop = scrollTop;
  }
  document.addEventListener('sr:job', () => { if (isOpen('son')) loadSounds(); if (isOpen('midi')) loadMidi(); });
  return { el: root, render, refresh: () => { sounds = null; if (isOpen('son')) render(); } };
}
