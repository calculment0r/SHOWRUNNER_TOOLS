// ODIO — la vue Instruments, en bas de l'arrangement (la « Device View » de
// Live) : toute la chaîne de la piste choisie (source → effets → tranche),
// module par module, de gauche à droite : sa surface quand le métier en
// dessine une (courbe d'égaliseur, de compresseur, de filtre… :
// musique/appareils/), ses molettes sinon, ou dessous pour régler fin. Les effets
// s'ajoutent, se déplacent et se retirent ici ; c'est la même chaîne de
// câbles que dans la vue Nodal (la chaîne est lue dans les câbles : un effet
// que plusieurs pistes traversent y est dans le rack de chacune, « lié », une
// seule instance). L'instrument d'une piste se change ici, ses
// préréglages aussi, et « Enregistrer le réglage » garde celui de la source
// dans le projet (navigateur, Préréglages, Les miens).

import { toast, pick, href, dropZone } from '../commun/shell.js';
import { MODULES, TRACK_KINDS, EFFECT_TYPES, DRUM_VOICES, RHYTHM_VOICES, SOURCES_OF, AUTOMATABLE, spec, val, fmt, presetsFor, moduleName } from './modules.js';
import { peaks } from './moteur.js';
import { el, knob, choice, menu, tok, put, inlineEdit } from './ui.js';
// les appareils (05/10) : une surface graphique à la place des molettes là où
// le métier dessine (égaliseur, compresseur…) — docs/etudes/odio_appareils.md
import { appareil } from './appareils/index.js';

const BUS = '__bus';

export function createDevices(app) {
  const { S } = app;
  const root = el('div', { class: 'rk' });
  let padSel = 'bd';
  const meters = [];
  const appareils = [];   // les surfaces dessinées : leur frame (spectre, mètres) à chaque image

  // ── un module ──
  const onoff = (m) => el('button', { class: `tb sm${m.on !== false ? ' on' : ' ghost'}`, type: 'button', title: 'actif ou court-circuité',
    onclick: () => { m.on = m.on === false; app.commit('graph'); } }, m.on !== false ? 'Actif' : 'Bypass');

  function kn(m, k, accent, size = 'md') {
    const s = spec(m.type, k);
    if (s.opts && size !== 'xs') return choice(s, val(m, k), { onChange: (v) => { m.params[k] = v; app.commit('param', m); app.commit('data'); } });
    return knob(s, val(m, k), { accent, size, onInput: (v) => { m.params[k] = v; app.commit('param', m); },
      // le départ du son de l'échantillonneur suit une fois la molette lâchée
      onChange: () => { app.commit('quiet'); if (m.type === 'sampler') render(); } });
  }

  function devHead(m, t) {
    const def = MODULES[m.type], fx = def.role === 'effect';
    const ch = t ? app.chain(t.id) : [];
    const i = ch.findIndex((x) => x.id === m.id);
    const src = def.role === 'source' && t;
    const pres = src ? [...(S.proj.presets || []).filter((p) => p.type === m.type).map((p) => ({ ...p, mine: true })), ...presetsFor(m.type)] : [];
    return el('div', { class: 'dev-head' },
      el('i', { class: 'dot' }),
      el('b', { class: 'venus' }, def.name), el('span', { class: 'lbl' }, def.odio ? `ODIO · ${def.kind}` : def.kind),
      el('span', { class: 'sp' }),
      src && (SOURCES_OF[t.kind] || []).length > 1 ? el('button', { class: 'tb ghost sm', type: 'button', title: 'changer l\'instrument de la piste (ses motifs restent)', onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        menu(r.left, r.bottom + 4, SOURCES_OF[t.kind].map((type) => ({ label: MODULES[type].name, sub: MODULES[type].kind, dot: MODULES[type].color,
          disabled: type === m.type, onclick: () => app.setSource(t.id, type) })));
      } }, 'Instrument') : null,
      pres.length ? el('button', { class: 'tb ghost sm', type: 'button', title: 'des réglages nommés', onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        menu(r.left, r.bottom + 4, pres.map((p) => ({ label: p.name, sub: p.mine ? 'le mien' : p.sub, onclick: () => app.applyPreset(t.id, p.id) })));
      } }, 'Préréglages') : null,
      src ? el('button', { class: 'tb ghost sm', type: 'button', title: 'garder ce réglage dans le projet : il s\'ajoute au navigateur (Préréglages, Les miens), où un double-clic le renomme',
        onclick: () => app.savePreset(t.id) }, 'Enregistrer le réglage') : null,
      fx && t && i > 0 ? el('button', { class: 'tb ghost sm', type: 'button', title: 'plus tôt dans la chaîne', disabled: i <= 1 || null, onclick: () => app.moveInChain(t.id, m.id, -1) }, '←') : null,
      fx && t && i > 0 ? el('button', { class: 'tb ghost sm', type: 'button', title: 'plus tard dans la chaîne', disabled: i >= ch.length - 2 || null, onclick: () => app.moveInChain(t.id, m.id, 1) }, '→') : null,
      def.role === 'source' || fx ? onoff(m) : null,
      fx ? el('button', { class: 'tb ghost sm', type: 'button', title: 'retirer l\'effet (ses câbles se referment)', onclick: () => app.removeModule(m.id) }, '×') : null);
  }

  // un effet que plusieurs pistes traversent (posé dans le nodal) : le même
  // module dans chaque rack, ses réglages sont les mêmes partout — il le dit
  function lien(m, t) {
    const ps = app.linked(m.id);
    if (ps.length < 2) return null;
    const autres = ps.filter((x) => x !== t?.id).map(app.track).filter(Boolean);
    return el('div', { class: 'dev-lien', title: 'un seul effet, posé dans le nodal : le régler ici le règle pour chaque piste qui le traverse, et le son de chacune reste dans sa piste' },
      el('span', { class: 'lbl' }, 'lié'), ...autres.map((x) => el('span', { class: 'dev-lien-p', style: { '--c': `var(--${x.color})` } }, el('i'), x.name)));
  }

  function device(m, t) {
    const def = MODULES[m.type];
    const accent = t?.color || def.color;
    const shared = app.linked(m.id).length > 1;
    const box = el('div', { class: `dev ${m.type}${m.on === false ? ' off' : ''}${def.odio ? ' odio' : ''}${S.sel.mod === m.id ? ' sel' : ''}${shared ? ' lie' : ''}`, style: { '--k': `var(--${accent})` }, 'data-mod': m.id,
      onpointerdown: () => { S.sel.mod = m.id; } });
    box.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); S.sel.mod = m.id; const it = menuDe(m.id, t); if (it) menu(e.clientX, e.clientY, it); });
    if (m.type === 'drums') box.append(devHead(m, t), drumBody(m, t, accent));
    else if (m.type === 'rythme') box.append(devHead(m, t), rhythmBody(m, t, accent));
    else if (m.type === 'sampler') box.append(devHead(m, t), samplerBody(m, t, accent));
    else if (m.type === 'player') {
      const n = S.proj.clips.filter((c) => c.track === t.id).length;
      box.append(devHead(m, t), el('div', { class: 'dev-body' },
        el('p', { class: 'lbl' }, `lit les ${n} clip${n > 1 ? 's' : ''} audio de la piste`), kn(m, 'vol', accent),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.addAudio(t.id) }, '+ Son')));
    } else if (def.role === 'strip' || def.role === 'master') {
      const mt = el('div', { class: 'mtr' }, el('i'));
      meters.push([m.id, mt]);
      box.append(devHead(m, t), el('div', { class: 'dev-body' },
        ...def.params.map((p) => kn(m, p.k, accent)), mt,
        t ? el('div', { class: 'row' },
          el('button', { class: `tb sm${t.mute ? ' on' : ' ghost'}`, type: 'button', onclick: () => { t.mute = !t.mute; app.commit('mute'); } }, 'Muet'),
          t.kind === 'bus' ? null : el('button', { class: `tb sm${t.solo ? ' on' : ' ghost'}`, type: 'button', onclick: () => { t.solo = !t.solo; app.commit('mute'); } }, 'Solo')) : null));
    } else {
      const ap = appareil(app, m, { accent });
      if (ap) { appareils.push(ap); box.classList.add('graphique'); box.append(devHead(m, t), ap.el); }
      else box.append(devHead(m, t), el('div', { class: 'dev-body' }, ...def.params.map((p) => kn(m, p.k, accent))));
    }
    const l = lien(m, t);
    if (l) box.firstChild.after(l);
    return box;
  }

  // le clic droit sur un module du rack
  function menuDe(id, t) {
    const m = app.mod(id);
    if (!m) return null;
    const def = MODULES[m.type], fx = def.role === 'effect';
    const ch = t ? app.chain(t.id) : [], i = ch.findIndex((x) => x.id === m.id);
    const ps = app.linked(m.id);
    return [
      { head: `${moduleName(m.type)}${t ? ` · ${t.name}` : ''}` },
      def.role === 'source' || fx ? { label: m.on !== false ? 'Court-circuiter (bypass)' : 'Activer', onclick: () => { m.on = m.on === false; app.commit('graph'); } } : null,
      fx && t && i > 0 ? { label: 'Plus tôt dans la chaîne', disabled: i <= 1, why: 'juste après la source', onclick: () => app.moveInChain(t.id, m.id, -1) } : null,
      fx && t && i > 0 ? { label: 'Plus tard dans la chaîne', disabled: i >= ch.length - 2, why: 'juste avant la tranche', onclick: () => app.moveInChain(t.id, m.id, 1) } : null,
      { label: 'Voir dans le nodal', onclick: () => { app.setView('nodal'); app.nodal?.montrer?.(m.id); } },
      (AUTOMATABLE[m.type] || []).length ? { label: 'Automation', items: AUTOMATABLE[m.type].map((k) => ({ label: spec(m.type, k).label, disabled: S.proj.auto.some((L) => L.mod === m.id && L.k === k), why: 'cette voie existe déjà', onclick: () => app.addAuto(m.id, k) })) } : null,
      ps.length > 1 && t ? '-' : null,
      ps.length > 1 && t ? { label: 'Sortir de cette chaîne seulement', sub: `reste dans ${ps.filter((x) => x !== t.id).map((x) => app.track(x)?.name).join(', ')}`, onclick: () => app.removeFromTrack(m.id, t.id) } : null,
      fx ? '-' : null,
      fx ? { label: ps.length > 1 ? `Retirer l'effet de toutes les chaînes (${ps.length})` : 'Retirer l\'effet', key: 'Suppr', danger: true, onclick: () => app.removeModule(m.id) } : null,
    ];
  }
  const fxItems = (trackId) => EFFECT_TYPES.map((k) => ({ label: MODULES[k].name, sub: MODULES[k].odio ? `ODIO · ${MODULES[k].kind}` : MODULES[k].kind, dot: MODULES[k].color,
    onclick: () => { const m = app.addEffect(trackId, k); if (!trackId) toast(`${MODULES[k].name} ajouté hors piste : câble-le dans la vue Nodal`); return m; } }));

  // la DR-9 : huit pads (clic = écouter et régler cette voix)
  function drumBody(m, t, accent) {
    const v = DRUM_VOICES.find((x) => x.id === padSel) || DRUM_VOICES[0];
    const pads = el('div', { class: 'pads' }, DRUM_VOICES.map((x, i) => el('button', {
      class: `pad${x.id === v.id ? ' on' : ''}`, type: 'button', title: `${x.name} — clic : écouter`,
      onpointerdown: () => { padSel = x.id; app.engine.hit(m.id, x.id, 1); render(); },
    }, el('span', { class: 'no' }, String(i + 1).padStart(2, '0')), el('span', { class: 'nm' }, x.name))));
    return el('div', { class: 'dev-body dr9' },
      el('div', { class: 'padsel' }, el('span', { class: 'lbl' }, 'pad choisi'),
        el('b', { class: 'venus' }, String(DRUM_VOICES.indexOf(v) + 1).padStart(2, '0')), el('span', {}, v.name)),
      pads,
      el('div', { class: 'kns' }, kn(m, `${v.id}_tune`, accent), kn(m, `${v.id}_dec`, accent), kn(m, `${v.id}_lvl`, accent),
        el('i', { class: 'vsep' }), kn(m, 'lvl', 'cy')));
  }

  // la boîte à rythme d'ODIO : onze pads, quatre réglages par voix (accord,
  // chute, le troisième bouton propre à la voix, niveau), la machine
  function rhythmBody(m, t, accent) {
    const v = RHYTHM_VOICES.find((x) => x.id === padSel) || RHYTHM_VOICES[0];
    const pads = el('div', { class: 'pads r11' }, RHYTHM_VOICES.map((x, i) => el('button', {
      class: `pad${x.id === v.id ? ' on' : ''}`, type: 'button', title: `${x.name} — clic : écouter`,
      onpointerdown: () => { padSel = x.id; app.engine.hit(m.id, x.id, 1); render(); },
    }, el('span', { class: 'no' }, `${String(i + 1).padStart(2, '0')} · ${x.short}`), el('span', { class: 'nm' }, x.name))));
    return el('div', { class: 'dev-body dr9' },
      el('div', { class: 'padsel' }, el('span', { class: 'lbl' }, 'pad choisi'),
        el('b', { class: 'venus' }, v.short), el('span', {}, v.name)),
      pads,
      el('div', { class: 'kns' }, ['tune', 'decay', 'ctrl', 'niv'].map((k) => kn(m, `${v.id}.${k}`, accent)),
        el('i', { class: 'vsep' }), kn(m, 'kit', 'cy'), kn(m, 'drive', 'cy'), kn(m, 'gain', 'cy')));
  }

  function samplerBody(m, t, accent) {
    const id = m.params.item;
    const cv = el('canvas', { class: 'wave' });
    const title = el('span', { class: 'sn' }, id ? '…' : 'aucun son');
    const setItem = async (it) => {
      app.items.set(it.id, Promise.resolve({ ...it, href: href(it.url) }));
      m.params.item = it.id;
      await app.engine.buffer(it.id).catch((e) => toast(e.message));
      app.commit('graph');
    };
    if (id) {
      app.loadItem(id).then((it) => { title.textContent = it.title; }).catch(() => { title.textContent = 'son introuvable'; });
      app.engine.buffer(id).then((buf) => {
        drawWave(cv, buf, val(m, 'start'));
        // le départ se tire sur la forme d'onde (le marqueur de Simpler) ; double-clic : au début
        cv.title = 'glisser : le départ du son · double-clic : au début';
        const poser = (e, fin) => {
          const r = cv.getBoundingClientRect();
          m.params.start = Math.max(0, Math.min(0.99, (e.clientX - r.left) / Math.max(1, r.width)));
          app.commit('param', m);
          drawWave(cv, buf, m.params.start);
          if (fin) { app.commit('quiet'); render(); }
        };
        cv.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault(); cv.setPointerCapture(e.pointerId); poser(e);
          const mv = (ev) => poser(ev), up = (ev) => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); poser(ev, true); };
          cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
        });
        cv.addEventListener('dblclick', () => { m.params.start = 0; app.commit('param', m); app.commit('quiet'); render(); });
      }).catch(() => {});
    }
    const zone = el('div', { class: 'snd' }, el('span', { class: 'lbl' }, 'son'), title,
      el('button', { class: 'tb ghost sm', type: 'button', onclick: async () => {
        const [it] = await pick({ kinds: ['audio'], title: 'Un son pour l\'échantillonneur' });
        if (it) setItem(it);
      } }, id ? 'Changer' : 'Choisir un son'),
      id ? el('button', { class: 'tb ghost sm', type: 'button', title: 'jouer la note racine', onclick: () => app.engine.preview(m.id, val(m, 'root')) }, 'Écouter') : null,
      el('span', { class: 'lbl' }, 'ou déposer un son ici'));
    dropZone(zone, { kinds: ['audio'], multiple: false, via: 'odio', onitems: ([it]) => setItem(it) });
    return el('div', { class: 'dev-body sampler' }, zone, cv,
      el('div', { class: 'kns' }, MODULES.sampler.params.map((p) => kn(m, p.k, p.k === 'root' ? accent : 'cy'))));
  }

  // la forme d'onde d'un son (l'échantillonneur), sur <canvas>
  function drawWave(cv, buf, start) {
    const w = cv.clientWidth || 300, h = cv.clientHeight || 46, dpr = devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const pk = peaks(buf, 1200);
    g.fillStyle = tok('cy');
    for (let x = 0; x < w; x++) {
      const v = pk[Math.floor(x / w * pk.length)], hh = Math.max(1, v * (h - 2));
      g.fillRect(x, (h - hh) / 2, 1, hh);
    }
    g.fillStyle = tok('or');
    g.fillRect(Math.round(start * w), 0, 2, h);
  }

  // ── l'ensemble : la piste choisie ──
  function render() {
    const P = S.proj;
    meters.length = 0;
    appareils.length = 0;
    const scrollL = root.querySelector('.rk-chain')?.scrollLeft || 0;
    const trackSel = el('select', { class: 'fld mu-mini', 'aria-label': 'piste', title: 'la piste dont on voit la chaîne',
      onchange: (e) => app.select({ track: e.target.value, mod: null }) },
    P.tracks.map((t) => el('option', { value: t.id, selected: S.sel.track === t.id || null }, t.name)),
    el('option', { value: BUS, selected: S.sel.track === BUS || null }, 'Sortie et modules libres'));
    if (S.sel.track === BUS) {
      const mods = P.modules.filter((m) => !m.track);
      put(root,
        el('div', { class: 'rk-head' }, trackSel, el('b', { class: 'venus' }, 'Sortie et modules libres'),
          el('span', { class: 'lbl' }, 'les effets sans piste et la sortie ; leurs câbles se tirent dans la vue Nodal'),
          el('span', { class: 'sp' }),
          el('button', { class: 'tb ghost sm', type: 'button', onclick: (e) => fxMenu(e, null) }, '+ Effet')),
        el('div', { class: 'rk-chain' }, mods.map((m) => device(m, null))));
      return;
    }
    const t = app.track(S.sel.track) || P.tracks[0];
    if (!t) { put(root, el('div', { class: 'dk-empty' }, el('b', { class: 'venus' }, 'Instruments'), el('span', {}, 'aucune piste : « + Piste » en haut de l\'arrangement'))); return; }
    const ch = app.chain(t.id);
    const loose = P.modules.filter((m) => m.track === t.id && !ch.includes(m));
    const nm = el('b', { class: 'venus', title: 'double-clic : renommer la piste' }, t.name);
    nm.addEventListener('dblclick', () => inlineEdit(nm, t.name, (v) => { t.name = v.slice(0, 60); app.commit('data'); }, { max: 60 }));
    put(root,
      el('div', { class: 'rk-head', style: { '--c': `var(--${t.color})` } },
        el('span', { class: 'k' }, TRACK_KINDS[t.kind].label), nm, trackSel,
        el('span', { class: 'lbl' }, `${ch.length} module${ch.length > 1 ? 's' : ''} en chaîne`),
        el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: (e) => fxMenu(e, t.id) }, '+ Effet'),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => app.setView('nodal') }, 'Voir les câbles')),
      el('div', { class: 'rk-chain' }, ch.map((m, i) => [i ? el('i', { class: 'rk-arrow', 'aria-hidden': 'true' }, '→') : null, device(m, t)])),
      loose.length ? el('div', { class: 'rk-loose' }, el('span', { class: 'why' }, 'hors chaîne : ces modules de la piste ne sont pas sur le trajet source → tranche ; câble-les dans la vue Nodal'),
        el('div', { class: 'rk-chain' }, loose.map((m) => device(m, t)))) : null);
    const chain = root.querySelector('.rk-chain');
    if (chain) chain.scrollLeft = scrollL;
    const sel = S.sel.mod && root.querySelector(`.dev[data-mod="${S.sel.mod}"]`);
    if (sel && !scrollL) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function fxMenu(e, trackId) {
    const r = e.currentTarget.getBoundingClientRect();
    menu(r.left, r.bottom + 4, fxItems(trackId));
  }

  function frame() {
    for (const ap of appareils) ap.frame?.();
    for (const [id, mt] of meters) {
      const db = app.engine.level(id);
      mt.firstChild.style.transform = `scaleX(${Math.max(0, Math.min(1, (db + 60) / 60)).toFixed(3)})`;   // par transform : musique.css, .mtr
      mt.classList.toggle('hot', db > -1);
    }
  }

  function key(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel.mod && !(S.sel.clips || []).length) {
      const m = app.mod(S.sel.mod);
      if (m && MODULES[m.type].role === 'effect') { e.preventDefault(); app.removeModule(m.id); return true; }
    }
    return false;
  }

  return { el: root, render, frame, key, menuDe, fxItems };
}

export { fmt, moduleName };
