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
// Clic sur un élément = le poser sur la piste choisie (ou une piste neuve).

import { api, href, toast, dragItem, dropZone, fmtDur } from '../commun/shell.js';
import { MODULES, SOURCES_OF, EFFECT_TYPES, PRESETS, DRUM_MODELS, NOTE_MODELS, TRACK_KINDS, keyLabel } from './modules.js';
import { el, put, menu, inlineEdit } from './ui.js';

const MIME = 'application/x-odio';
const SECTIONS = [['inst', 'Instruments'], ['fx', 'Effets'], ['pre', 'Préréglages'], ['son', 'Sons'], ['mot', 'Motifs']];

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

  const BODY = { inst: instruments, fx: effects, pre: presets, son: soundsList, mot: motifs };
  function toggle(k) {
    ui().navOpen = { ...(ui().navOpen || { inst: true, son: true }), [k]: !isOpen(k) };
    if (k === 'son' && isOpen('son')) sounds = null;
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
  document.addEventListener('sr:job', () => { if (isOpen('son')) loadSounds(); });
  return { el: root, render, refresh: () => { sounds = null; if (isOpen('son')) render(); } };
}
