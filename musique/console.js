// ODIO — la console de mixage : une tranche par piste (inserts, envois vers
// les bus d'effets, panoramique, muet, solo, armer, fader, vu-mètre), celle
// des bus (leurs retours) et celle de la sortie (vu-mètres gauche et droite,
// l'arc). Les envois sont des câbles qui portent un niveau : le nodal montre le
// même graphe, en pointillé.
// Depuis le 05/10, la console est le bas de la vue Session (session.js), comme
// le mixeur de Live sous sa grille de clips (Live 12, « Mixing ») ; refaite le
// soir, elle range en groupes les voies de la Session, les pistes de
// l'arrangement, les retours et la sortie (les envois des pistes n'ont pas
// d'autre console). Ce module fabrique les tranches — d'une piste, d'un bus ou
// d'une voie (`voie`) ; la vue les range.

import { toast } from '../commun/shell.js';
import { MODULES, EFFECT_TYPES, spec, val, moduleName } from './modules.js';
import { el, knob, fader, vu, menu, inlineEdit } from './ui.js';

const SEND = { k: 'send', label: 'Envoi', min: -60, max: 6, def: -60, unit: 'dB', curve: 'lin', step: 0 };

// `onSelect(t)` : une tranche cliquée (la vue montre la colonne choisie)
export function createMixer(app, { onSelect = () => {} } = {}) {
  const { S } = app;
  const meters = [];

  const buses = () => S.proj.tracks.filter((t) => t.kind === 'bus');
  const sendOf = (strip, busSrc) => S.proj.cables.find((c) => c.a === strip && c.b === busSrc);

  function sendKnob(t, b) {
    const c = sendOf(t.strip, b.src);
    const v = c ? (typeof c.send === 'number' ? c.send : 0) : -60;
    return knob(SEND, v, { size: 'xs', accent: b.color, label: `envoi vers ${b.name}`,
      onInput: (nv) => {
        let cab = sendOf(t.strip, b.src);
        if (nv <= -59.9) {
          if (cab) { S.proj.cables = S.proj.cables.filter((x) => x !== cab); app.engine.setProject(S.proj); }
          return;
        }
        if (!cab) {
          const why = app.canConnect(t.strip, b.src);
          if (why) { toast(why); return; }
          cab = { a: t.strip, b: b.src, send: nv };
          S.proj.cables.push(cab);
          app.engine.setProject(S.proj);
        } else { cab.send = Math.round(nv * 10) / 10; app.engine.setSend(cab.a, cab.b, cab.send); }
      },
      onChange: () => app.commit('quiet') });
  }

  // une voie de la Session n'a pas de vue Instruments sous l'arrangement : ses effets se règlent dans le nodal
  function inserts(t, voie = false) {
    const ch = app.chain(t.id).filter((m) => m.id !== t.src && m.id !== t.strip);
    return el('div', { class: 'cs-ins' },
      ch.map((m) => el('button', { class: `cs-in${m.on === false ? ' off' : ''}`, type: 'button', title: `${MODULES[m.type].name} · clic : ${voie ? 'dans le nodal' : 'dans la vue Instruments, sous l\'arrangement'}`,
        style: { '--k': `var(--${MODULES[m.type].color})` }, onclick: () => { S.sel.mod = m.id; if (voie) { app.setView('nodal'); return; } S.sel.track = t.id; app.showDetail('device'); } }, moduleName(m.type))),
      el('button', { class: 'cs-in add', type: 'button', title: 'un effet en insert, avant la tranche', onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        menu(r.left, r.bottom + 4, EFFECT_TYPES.map((k) => ({ label: MODULES[k].name, sub: MODULES[k].odio ? `ODIO · ${MODULES[k].kind}` : MODULES[k].kind, dot: MODULES[k].color,
          onclick: () => app.addEffect(t.id, k) })));
      } }, '+'));
  }

  function strip(t, { bus = false, voie = false } = {}) {
    const st = app.mod(t.strip), src = app.mod(t.src);
    const volS = spec('strip', 'vol');
    const meter = vu();
    meters.push([t.strip, meter, null]);
    const fd = fader(volS, val(st, 'vol'), { accent: t.color, label: `volume ${t.name}`,
      onInput: (v) => { st.params.vol = Math.round(v * 10) / 10; app.commit('param', st); }, onChange: () => app.commit('quiet') });
    const tog = (label, on, title, fn, cls = '') => el('button', { class: `tb sm ${cls}${on ? ' on' : ' ghost'}`, type: 'button', title, onclick: fn }, label);
    const nm = el('b', { title: 'double-clic : renommer', ondblclick: () => inlineEdit(nm, t.name, (n) => { t.name = n.slice(0, 60); app.commit('data'); }, { max: 60 }) }, t.name);
    const choisie = voie ? S.sel.voie === t.id : S.sel.track === t.id;
    return el('div', { class: `cs-strip${bus ? ' bus' : ''}${voie ? ' voie' : ''}${choisie ? ' sel' : ''}${t.mute ? ' muted' : ''}`, style: { '--c': `var(--${t.color})` }, [voie ? 'data-voie' : 'data-track']: t.id,
      onclick: (e) => {
        if (e.target.closest('button, .kn, .fdr, .mu-inline') || choisie) return;
        // choisir sans refaire la vue : un double-clic qui suit renomme encore
        if (voie) S.sel.voie = t.id;
        else { S.sel.track = t.id; S.sel.pat = t.pat || null; S.sel.clip = null; S.sel.clips = []; }
        onSelect(t, voie);
      } },
    el('div', { class: 'cs-top' }, el('i', { class: 'bar' }), nm,
      el('span', { class: 'lbl' }, bus ? 'retour' : moduleName(src?.type))),
    inserts(t, voie),
    bus ? el('div', { class: 'cs-sends empty' }, el('span', { class: 'lbl' }, 'ce que les pistes y envoient'))
      : el('div', { class: 'cs-sends' }, buses().length ? buses().map((b) => el('div', { class: 'cs-send' }, sendKnob(t, b), el('span', { class: 'lbl' }, b.name)))
        : el('span', { class: 'lbl' }, '+ Bus : les envois')),
    el('div', { class: 'cs-pan' }, knob(spec('strip', 'pan'), val(st, 'pan'), { size: 'sm', accent: t.color, label: 'panoramique',
      onInput: (v) => { st.params.pan = v; app.commit('param', st); }, onChange: () => app.commit('quiet') })),
    el('div', { class: 'row cs-btns' },
      tog('M', t.mute, 'muet', () => { t.mute = !t.mute; app.commit('mute'); }),
      bus ? null : tog('S', t.solo, 'solo', () => { t.solo = !t.solo; app.commit('mute'); }),
      bus ? null : tog('●', t.arm, voie ? 'armer pour la prise de Session : ses cases vides deviennent des boutons de prise' : 'armer pour la prise de l\'arrangement (Rec, F9)', () => { t.arm = !t.arm; app.commit('quiet'); app.renderView(); }, 'arm')),
    el('div', { class: 'cs-fv' }, fd, meter),
    bus ? el('button', { class: 'tb ghost sm', type: 'button', title: 'retirer le bus et ses envois', onclick: () => app.removeTrack(t.id) }, 'Retirer') : null);
  }

  function masterStrip() {
    const m = app.master(), s = spec('master', 'vol');
    const meter = vu({ lr: true });
    const db = el('b', { class: 'cs-db' }, '—');
    meters.push([m.id, meter, db]);
    const A = S.proj.arc;
    return el('div', { class: 'cs-strip master' },
      el('div', { class: 'cs-top' }, el('i', { class: 'bar' }), el('b', {}, 'Sortie'), el('span', { class: 'lbl' }, 'master')),
      el('div', { class: 'cs-arc' }, el('span', { class: 'lbl' }, 'arc d\'énergie'),
        el('button', { class: `tb sm${A.on ? ' on' : ' ghost'}`, type: 'button', onclick: () => { A.on = !A.on; app.commit('meta'); } }, A.on ? { lpf: 'Filtre', vol: 'Volume', both: 'Filtre + vol.' }[A.to] : 'Éteint'),
        knob(spec('master', 'arc_lo'), val(m, 'arc_lo'), { size: 'xs', accent: 'or', label: 'coupure basse de l\'arc', onInput: (v) => { m.params.arc_lo = v; app.commit('param', m); }, onChange: () => app.commit('quiet') }),
        knob(spec('master', 'arc_db'), val(m, 'arc_db'), { size: 'xs', accent: 'or', label: 'volume bas de l\'arc', onInput: (v) => { m.params.arc_db = v; app.commit('param', m); }, onChange: () => app.commit('quiet') })),
      db,
      el('div', { class: 'cs-fv' }, fader(s, val(m, 'vol'), { accent: 'grn2', label: 'volume de sortie',
        onInput: (v) => { m.params.vol = Math.round(v * 10) / 10; app.commit('param', m); }, onChange: () => app.commit('quiet') }), meter));
  }

  function busMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    menu(r.left, r.bottom + 4, [
      { head: 'un bus d\'effets (retour)' },
      ...[['reverb', 'Réverbération'], ['reverbe', 'Réverbe ODIO'], ['delay', 'Délai synchronisé'], ['rtt', 'RTT-01'], ['chorus', 'Chorus'], [null, 'Vide']]
        .map(([fx, l]) => ({ label: l, dot: fx ? MODULES[fx].color : null, onclick: () => app.addBus(fx) })),
    ]);
  }

  // les vu-mètres, à chaque image
  function frame() {
    for (const [id, m, db] of meters) {
      if (db) {
        const [l, r] = app.engine.levelLR(id);
        m.set(l, r);
        const pk = m.peak();
        db.textContent = pk > -80 ? `${pk.toFixed(1)}` : '—';
        db.classList.toggle('hot', pk > -1);
      } else m.set(app.engine.level(id));
    }
  }

  // `reset` : la vue se redessine, les vu-mètres d'avant partent avec leurs tranches
  return { strip, masterStrip, busMenu, buses, frame, reset: () => { meters.length = 0; } };
}
