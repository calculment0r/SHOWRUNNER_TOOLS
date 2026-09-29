// ODIO — le navigateur, à gauche de l'arrangement : ce qu'on glisse sur
// une piste (ou sous les pistes, pour une piste neuve).
//   Instruments   les sources (DR-9, boîte à rythme, synthés, basse acide,
//                 numérique, échantillonneur, audio) et les effets
//   Préréglages   des réglages nommés, par instrument
//   Sons          la bibliothèque du portail (écouter, glisser) ; on y dépose
//                 aussi des fichiers du disque (catégorie Upload)
//   Motifs        les motifs du projet, et des modèles (rythmes, motifs tirés
//                 de la gamme de la session)
// Clic sur un élément = le poser sur la piste choisie (ou une piste neuve).

import { api, href, toast, dragItem, dropZone, fmtDur } from '../commun/shell.js';
import { MODULES, SOURCES_OF, EFFECT_TYPES, PRESETS, DRUM_MODELS, NOTE_MODELS, TRACK_KINDS, keyLabel } from './modules.js';
import { el, put } from './ui.js';

const MIME = 'application/x-odio';
const TABS = [['inst', 'Instruments'], ['pre', 'Préréglages'], ['son', 'Sons'], ['mot', 'Motifs']];

export function createBrowser(app) {
  const { S } = app;
  const root = el('aside', { class: 'nv', 'aria-label': 'navigateur' });
  const list = el('div', { class: 'nv-list' });
  let tab = 'inst', q = '', sounds = null, loading = false, player = null, playing = null;

  const item = (payload, { name, sub, dot, title = '', extra = null, onclick }) => {
    const n = el('div', { class: 'nv-it', draggable: 'true', title: title || 'glisser sur une piste · clic : sur la piste choisie', tabindex: 0,
      onclick: onclick || (() => app.dropItem(payload, S.sel.track, app.pos())),
      onkeydown: (e) => { if (e.key === 'Enter') n.click(); } },
    dot ? el('i', { class: 'dot', style: { background: `var(--${dot})` } }) : null,
    el('span', { class: 'nm' }, name), sub ? el('small', {}, sub) : null, extra);
    n.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData(MIME, JSON.stringify(payload)); });
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
    out.push(group('Effets · sur une piste'));
    for (const type of EFFECT_TYPES) {
      const def = MODULES[type];
      out.push(item({ t: 'fx', type }, { name: def.name, sub: def.odio ? `ODIO · ${def.kind}` : def.kind, dot: def.color,
        title: 'glisser sur une piste : l\'effet s\'insère avant sa tranche · clic : sur la piste choisie' }));
    }
    return out;
  }

  function presets() {
    const out = [];
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
    if (tab === 'son') paint();
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
  function soundsList() {
    const search = el('input', { class: 'fld', placeholder: 'chercher un son', value: q,
      oninput: (e) => { q = e.target.value; clearTimeout(search._t); search._t = setTimeout(loadSounds, 250); } });
    const out = [search];
    const drop = el('div', { class: 'nv-drop' }, 'déposer ici des fichiers audio : ils entrent dans la bibliothèque (Upload)');
    dropZone(drop, { kinds: ['audio'], via: 'odio', onitems: () => loadSounds() });
    out.push(drop);
    if (!sounds) { if (!loading) loadSounds(); out.push(el('p', { class: 'lbl' }, 'chargement')); return out; }
    if (!sounds.length) out.push(el('p', { class: 'lbl' }, 'aucun son · générer, exporter, déposer un fichier'));
    for (const it of sounds) {
      const btn = el('button', { class: 'nv-play', type: 'button', title: 'écouter', onclick: (e) => { e.stopPropagation(); listen(it, btn); } }, '▶');
      const n = item({ t: 'son', item: it }, { name: it.title, sub: [fmtDur(it.duration), it.origin?.tool === 'upload' ? 'upload' : it.origin?.model || it.origin?.tool].filter(Boolean).join(' · '),
        dot: 'grn2', extra: btn, title: 'glisser sur une piste audio (ou sous les pistes) · sur un échantillonneur : son son · clic : à la tête de lecture' });
      dragItem(n, it);          // le type commun du portail (ITEM_MIME), en plus du nôtre
      out.push(n);
    }
    return out;
  }

  function motifs() {
    const P = S.proj, out = [];
    for (const t of P.tracks.filter((x) => TRACK_KINDS[x.kind]?.pattern)) {
      const ps = P.patterns.filter((p) => p.track === t.id);
      if (!ps.length) continue;
      out.push(group(t.name));
      for (const p of ps) {
        const n = P.clips.filter((c) => c.pat === p.id).length;
        out.push(item({ t: 'motif', pat: p.id }, { name: p.name, sub: `${p.steps / (P.sig * 4)} mes. · ${n} clip${n > 1 ? 's' : ''}`, dot: t.color,
          title: 'glisser sur sa piste : un clip · sur une autre piste de même sorte : une copie · clic : à la tête de lecture' }));
      }
    }
    out.push(group('Modèles · rythmes'));
    for (const m of DRUM_MODELS) out.push(item({ t: 'modele', kind: 'drums', id: m.id }, { name: m.name, sub: '1 mesure', dot: 'or' }));
    out.push(group(`Modèles · gamme ${keyLabel(P.key)}`));
    for (const m of NOTE_MODELS) out.push(item({ t: 'modele', kind: 'notes', id: m.id }, { name: m.name, sub: 'tiré de la gamme', dot: 'cy' }));
    return out;
  }

  function paint() {
    put(list, ...(tab === 'inst' ? instruments() : tab === 'pre' ? presets() : tab === 'son' ? soundsList() : motifs()));
  }
  function render() {
    put(root,
      el('div', { class: 'nv-tabs', role: 'tablist' }, TABS.map(([k, l]) => el('button', { class: `nv-tab${tab === k ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': tab === k,
        onclick: () => { tab = k; if (k === 'son') sounds = null; render(); } }, l))),
      list);
    paint();
  }
  document.addEventListener('sr:job', () => { if (tab === 'son') loadSounds(); });
  return { el: root, render, refresh: () => { sounds = null; if (tab === 'son') paint(); } };
}
