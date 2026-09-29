// ODIO — la vue Instruments, en bas de l'arrangement (la « Device View » de
// Live) : toute la chaîne de la piste choisie (source → effets → tranche),
// module par module avec ses molettes, de gauche à droite. Les effets
// s'ajoutent, se déplacent et se retirent ici ; c'est la même chaîne de
// câbles que dans la vue Nodal. L'instrument d'une piste se change ici, ses
// préréglages aussi, et « Enregistrer le réglage » garde celui de la source
// dans le projet (navigateur, Préréglages, Les miens).

import { toast, pick, href, dropZone } from '../commun/shell.js';
import { MODULES, TRACK_KINDS, EFFECT_TYPES, DRUM_VOICES, RHYTHM_VOICES, SOURCES_OF, spec, val, fmt, presetsFor, moduleName } from './modules.js';
import { peaks } from './moteur.js';
import { el, knob, choice, menu, tok, put, inlineEdit } from './ui.js';

const BUS = '__bus';

export function createDevices(app) {
  const { S } = app;
  const root = el('div', { class: 'rk' });
  let padSel = 'bd';
  const meters = [];

  // ── un module ──
  const onoff = (m) => el('button', { class: `tb sm${m.on !== false ? ' on' : ' ghost'}`, type: 'button', title: 'actif ou court-circuité',
    onclick: () => { m.on = m.on === false; app.commit('graph'); } }, m.on !== false ? 'Actif' : 'Bypass');

  function kn(m, k, accent, size = 'md') {
    const s = spec(m.type, k);
    if (s.opts && size !== 'xs') return choice(s, val(m, k), { onChange: (v) => { m.params[k] = v; app.commit('param', m); app.commit('data'); } });
    return knob(s, val(m, k), { accent, size, onInput: (v) => { m.params[k] = v; app.commit('param', m); },
      // les dessins (enveloppe, filtre, départ du son) suivent une fois la molette lâchée
      onChange: () => { app.commit('quiet'); if (m.type === 'synth' || m.type === 'sampler') render(); } });
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

  function device(m, t) {
    const def = MODULES[m.type];
    const accent = t?.color || def.color;
    const box = el('div', { class: `dev ${m.type}${m.on === false ? ' off' : ''}${def.odio ? ' odio' : ''}${S.sel.mod === m.id ? ' sel' : ''}`, style: { '--k': `var(--${accent})` }, 'data-mod': m.id,
      onpointerdown: () => { S.sel.mod = m.id; } });
    if (m.type === 'drums') box.append(devHead(m, t), drumBody(m, t, accent));
    else if (m.type === 'rythme') box.append(devHead(m, t), rhythmBody(m, t, accent));
    else if (m.type === 'synth') box.append(devHead(m, t), synthBody(m, accent));
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
      box.append(devHead(m, t), el('div', { class: 'dev-body' }, ...def.params.map((p) => kn(m, p.k, accent))));
    }
    return box;
  }

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

  function synthBody(m, accent) {
    const def = MODULES.synth;
    return el('div', { class: 'dev-body synth' }, def.sections.map(([name, keys]) => el('div', { class: 'sec' },
      el('span', { class: 'lbl' }, name),
      name === 'Oscillateur A' ? waveSvg(val(m, 'wave')) : name === 'Enveloppe' ? adsrSvg(m) : name === 'Filtre' ? filterSvg(m) : null,
      el('div', { class: 'kns' }, keys.map((k) => kn(m, k, k === keys[0] ? accent : 'cy'))))));
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
      app.engine.buffer(id).then((buf) => drawWave(cv, buf, val(m, 'start'))).catch(() => {});
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

  // ── petits dessins (SVG, couleurs par classes) ──
  const svg = (w, h, d) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', `0 0 ${w} ${h}`); s.setAttribute('preserveAspectRatio', 'none'); s.setAttribute('class', 'viz');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    s.append(p);
    return s;
  };
  function waveSvg(w) {
    const pts = [];
    for (let x = 0; x <= 120; x += 2) {
      const ph = (x / 120) * 4 * Math.PI;
      const y = w === 0 ? Math.sin(ph) : w === 1 ? (2 / Math.PI) * Math.asin(Math.sin(ph)) : w === 2 ? 2 * ((ph / (2 * Math.PI)) % 1) - 1 : Math.sign(Math.sin(ph));
      pts.push(`${x} ${(19 - y * 14).toFixed(1)}`);
    }
    return svg(120, 38, `M${pts.join(' L')}`);
  }
  function adsrSvg(m) {
    const a = Math.log(val(m, 'a') / 0.001) / Math.log(3000), d = Math.log(val(m, 'd') / 0.01) / Math.log(300);
    const s = val(m, 's'), r = Math.log(val(m, 'r') / 0.005) / Math.log(800);
    const x1 = 4 + a * 30, x2 = x1 + 6 + d * 30, x3 = 116 - 6 - r * 30, ys = 34 - s * 28;
    return svg(120, 38, `M4 34 L${x1.toFixed(1)} 6 L${x2.toFixed(1)} ${ys.toFixed(1)} L${x3.toFixed(1)} ${ys.toFixed(1)} L116 34`);
  }
  function filterSvg(m) {
    const c = 4 + Math.log(val(m, 'cut') / 40) / Math.log(400) * 100, q = val(m, 'res') / 24;
    return svg(120, 38, `M4 14 L${(c - 16).toFixed(1)} 14 Q${(c - 3).toFixed(1)} ${(14 - q * 12).toFixed(1)} ${c.toFixed(1)} ${(12 + q * 4).toFixed(1)} T116 34`);
  }
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
    menu(r.left, r.bottom + 4, EFFECT_TYPES.map((k) => ({ label: MODULES[k].name, sub: MODULES[k].odio ? `ODIO · ${MODULES[k].kind}` : MODULES[k].kind, dot: MODULES[k].color,
      onclick: () => { const m = app.addEffect(trackId, k); if (!trackId) toast(`${MODULES[k].name} ajouté hors piste : câble-le dans la vue Nodal`); return m; } })));
  }

  function frame() {
    for (const [id, mt] of meters) {
      const db = app.engine.level(id);
      mt.firstChild.style.width = `${Math.max(0, Math.min(100, (db + 60) / 60 * 100)).toFixed(1)}%`;
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

  return { el: root, render, frame, key };
}

export { fmt, moduleName };
