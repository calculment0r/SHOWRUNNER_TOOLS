// ODIO — le MIDI : extraire les notes d'un clip audio (clic droit), ranger
// nos clips de notes dans la bibliothèque (sorte « midi »), poser un clip
// MIDI de la bibliothèque sur une piste d'instrument.
//
// Le fichier MIDI s'écrit et se lit côté serveur seulement
// (server/tools/music_midi.py) : la page n'échange que des notes en temps
// (noires). Canaux : 0 le chant (ou les notes), 1 le thème, 2 les accords,
// 9 la batterie (General MIDI). La batterie d'ODIO et le MIDI se répondent
// par la table de percussion General MIDI (niveau 1, MIDI Manufacturers
// Association) : grosse caisse 35-36, caisse claire 38-40, clap 39,
// charleston fermé 42-44, ouvert 46, toms 41-50, cymbales 49-59, cloche 56.

import { api, jobs, toast, href } from '../commun/shell.js';
import { TRACK_KINDS, drumVoicesOf, keyLabel } from './modules.js';
import { el, modal, put } from './ui.js';
import { loadSchema, cond } from './generatif_modeles.js';

// la voix d'ODIO → sa note General MIDI
export const GM_OF = { bd: 36, sd: 38, cp: 39, ch: 42, oh: 46, lt: 41, mt: 47, ht: 50, rs: 37, cc: 49, rc: 51, cb: 56 };
// une note General MIDI → la voix d'ODIO la plus proche que la piste possède
const GM_TO = [[[35, 36], 'bd'], [[37], 'rs'], [[38, 40], 'sd'], [[39], 'cp'], [[42, 44], 'ch'], [[46], 'oh'], [[41, 43, 45], 'lt'],
  [[47, 48], 'mt'], [[50], 'ht'], [[49, 52, 55, 57], 'cc'], [[51, 53, 59], 'rc'], [[56], 'cb']];
const FALLBACK = { rs: 'sd', mt: 'lt', cc: 'oh', rc: 'ch', cb: 'ch', cp: 'sd', lt: 'sd', ht: 'lt', oh: 'ch' };
function voiceFor(pitch, ids) {
  let v = GM_TO.find(([ns]) => ns.includes(pitch))?.[1];
  if (!v) v = pitch < 41 ? 'bd' : pitch < 46 ? 'sd' : pitch < 60 ? 'ch' : null;        // hors de la table : par registre
  for (let i = 0; v && !ids.includes(v) && i < 4; i++) v = FALLBACK[v];
  return v && ids.includes(v) ? v : null;
}

const QUANT = { '1/16': 1, '1/32': 0.5, libre: 0 };
const qz = (x, q) => (q ? Math.round(x / q) * q : Math.round(x * 1000) / 1000);

// ── notes → motifs et clips d'ODIO ──────────────────────────
// `notes` : [[début, durée, hauteur, vélocité 0..1, canal]] en noires depuis
// `at`. Un motif tient 256 pas au plus : un long clip MIDI devient une suite
// de clips calés bout à bout.
export function placeNotes(app, track, notes, at, { quantize = '1/16', name = 'MIDI' } = {}) {
  const P = app.S.proj, t = app.owner(track);   // une piste, ou une voie de la Session (session.js : ses motifs, sans ses clips)
  const barSteps = P.sig * 4, q = QUANT[quantize] ?? 1;
  const chunk = Math.floor(256 / barSteps) * barSteps;
  const drums = TRACK_KINDS[t.kind].pattern === 'drums';
  const ids = drumVoicesOf(app.mod(t.src)?.type).map((v) => v.id);
  const steps = notes.map(([s, l, p, v]) => ({ s: qz(s * 4, q), l: Math.max(0.25, qz(l * 4, q) || 0.25), p, v }));
  const end = Math.max(barSteps, ...steps.map((n) => n.s + n.l));
  const made = [];
  let lost = 0;
  for (let k = 0; k * chunk < end; k++) {
    const lo = k * chunk, len = Math.min(chunk, Math.ceil((end - lo) / barSteps) * barSteps);
    const pat = app.newPattern(t.id, null, { quiet: true, name: `${name}${k ? ` ${k + 1}` : ''}`.slice(0, 40) });
    pat.steps = len;
    if (drums) {
      pat.lanes = {};
      for (const n of steps) {
        if (n.s < lo || n.s >= lo + len) continue;
        const vid = voiceFor(n.p, ids), i = Math.round(n.s - lo);
        if (!vid || i >= len) { lost++; continue; }
        (pat.lanes[vid] = pat.lanes[vid] || Array(len).fill(0))[i] = Math.max(pat.lanes[vid][i], Math.round(n.v * 100) / 100);
      }
    } else {
      pat.notes = steps.filter((n) => n.s >= lo && n.s < lo + len)
        .map((n) => ({ s: n.s - lo, l: Math.min(n.l, len - (n.s - lo)), p: Math.max(0, Math.min(127, n.p)), v: Math.round(n.v * 100) / 100 }));
    }
    const c = { id: app.uid('c'), track: t.id, start: at + lo / 4, len: len / 4, pat: pat.id };
    P.clips.push(c);
    made.push(c);
  }
  return { made, lost };
}

// Un clip MIDI de la bibliothèque posé : sur la piste d'instrument visée
// (tous ses canaux), sinon sur des pistes neuves, une par canal (le chant, le
// thème, les accords, la batterie).
export async function placeMidi(app, itemId, trackId, at, { quantize = '1/16', below = null, rate = 1, pitch = 0, rev = false, len = null } = {}) {
  const r = await api(`music/midi/${itemId}/notes`);
  const P = app.S.proj;
  let notes = r.notes.map(([s, l, p, v, ch]) => [s / rate, l / rate, ch === 9 ? p : p + Math.round(pitch), v, ch]);
  if (rev && len) notes = notes.map(([s, l, p, v, ch]) => [Math.max(0, len - s - l), l, p, v, ch]);
  if (len) notes = notes.filter(([s]) => s < len);
  if (!notes.length) { toast('ce clip MIDI n\'a pas de note ici'); return []; }
  const t = trackId && app.track(trackId);
  const made = [];
  let lost = 0;
  const title = `MIDI · ${(r.title || 'clip').replace(/ \(essai\)/g, '')}`.slice(0, 60);
  if (t && TRACK_KINDS[t.kind]?.pattern) {
    const g = placeNotes(app, t.id, notes, at, { quantize, name: title });
    made.push(...g.made); lost += g.lost;
  } else {
    let pos = below ? P.tracks.indexOf(app.track(below)) + 1 : P.tracks.filter((x) => x.kind !== 'bus').length;
    const chans = [...new Set(notes.map((n) => n[4]))].sort((x, y) => x - y);
    for (const ch of chans) {
      const drums = ch === 9;
      const nm = `${chans.length > 1 ? `${r.channels?.[ch] || `canal ${ch + 1}`} · ` : ''}${title}`.slice(0, 60);
      const nt = app.addTrack(drums ? 'drums' : 'synth', { type: drums ? 'rythme' : 'synth', name: nm, at: pos++ });
      const g = placeNotes(app, nt.id, notes.filter((n) => n[4] === ch), at, { quantize, name: title });
      made.push(...g.made); lost += g.lost;
    }
  }
  if (lost) toast(`${lost} coup${lost > 1 ? 's' : ''} sans voix sur cette batterie (table General MIDI) : laissé${lost > 1 ? 's' : ''}`, 5000);
  app.selectClips(made.map((c) => c.id), true);
  app.commit('graph');
  return made;
}

// ── nos clips de notes → la bibliothèque ────────────────────
// Ce qu'un clip de motif joue vraiment (répétitions, décalage, coupe), en
// noires depuis le début du clip : la même lecture que consolidatePatterns.
export function clipNotes(app, c) {
  const pat = app.pat(c.pat), t = app.track(c.track);
  if (!pat) return [];
  const plen = pat.steps / 4, origin = c.start - (c.off || 0), ce = c.start + c.len, out = [];
  for (let k = Math.floor((c.start - origin) / plen); origin + k * plen < ce; k++) {
    const base = origin + k * plen;
    if (t.kind === 'drums') {
      for (const [v, arr] of Object.entries(pat.lanes || {})) arr.forEach((vel, s) => {
        const b = base + s / 4;
        if (vel && b >= c.start && b < ce) out.push([b - c.start, 0.25, GM_OF[v] ?? 38, vel, 9]);
      });
    } else {
      for (const n of pat.notes || []) {
        const b = base + n.s / 4;
        if (b >= c.start && b < ce) out.push([b - c.start, Math.min(n.l / 4, ce - b), n.p, n.v ?? 0.8, 0]);
      }
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}
export async function saveClipMidi(app, c) {
  const P = app.S.proj, t = app.track(c.track), notes = clipNotes(app, c);
  if (!notes.length) { toast('ce clip ne joue aucune note'); return null; }
  const name = (c.name || `${t.name} · ${app.pat(c.pat)?.name || 'motif'}`).slice(0, 60);
  const it = await api('music/midi', { method: 'POST', body: { name, bpm: P.bpm, sig: P.sig, notes, project: P.id } });
  toast(`« ${it.title} » rangé dans la bibliothèque (MIDI) : ${notes.length} notes · navigateur, MIDI`, 5000);
  document.dispatchEvent(new CustomEvent('mu:midi'));
  return it;
}

// ── extraire le MIDI d'un clip audio ────────────────────────
export async function openExtract(app, clipId) {
  const c = app.clip(clipId), P = app.S.proj;
  if (!c?.item) { toast('extraire le MIDI : un clip audio qui a un son'); return; }
  const [s, o] = await Promise.all([loadSchema(), api('music/midi/options').catch((e) => ({ error: e.message }))]);
  if (o.error) { toast(`extraction indisponible : ${o.error}`, 6000); return; }
  const S = s.midi;
  const rate = Math.pow(2, (c.pitch || 0) / 12), spb = 60 / P.bpm;
  const dur = c.loop ? Math.min(c.len * spb * rate, c.llen || Infinity) : c.len * spb * rate;
  // à l'envers, `off` se compte dans le son retourné (musique.js, reverseSel) :
  // le serveur lit le fichier à l'endroit, la région y est [D − off − durée, D − off]
  const D = app.engine.buffers.get(c.item)?.duration || 0;
  const offSrc = c.rev && D ? Math.max(0, D - (c.off || 0) - dur) : (c.off || 0);
  const st = { engine: Object.keys(S.moteurs).find((k) => o.engines[k]?.ready) || 'basic_pitch', v: {} };
  const body = el('div', { class: 'gx' });
  const go = el('button', { class: 'tb go', type: 'button' }, 'Extraire');
  const why = el('span', { class: 'lbl' });
  const paint = () => {
    const E = S.moteurs[st.engine];
    const vals = {};
    for (const pid of E.params) vals[pid] = st.v[pid] ?? S.params[pid].defaut;
    const field = (pid) => {
      const pd = S.params[pid], v = vals[pid];
      const lab = (n) => el('label', { class: 'field', title: pd.source }, el('span', { class: 'lbl' }, pd.label), n);
      if (pd.type === 'bool') return el('label', { class: 'opt mu-check', title: pd.source }, el('input', { type: 'checkbox', checked: v || null, onchange: (e) => { st.v[pid] = e.target.checked; paint(); } }), ` ${pd.label}`);
      if (pd.type === 'choix') return lab(el('div', { class: 'seg' }, pd.choix.map((ch) => el('button', { class: `tb${v === ch.id ? ' on' : ''}`, type: 'button', onclick: () => { st.v[pid] = ch.id; paint(); } }, ch.label))));
      return lab(el('input', { class: 'fld', type: 'number', min: pd.min, max: pd.max, step: pd.step || 'any', value: v, onchange: (e) => { st.v[pid] = +e.target.value; } }));
    };
    const shown = E.params.filter((pid) => cond(S.params[pid].si, vals));
    const ready = o.engines[st.engine]?.ready;
    put(body,
      el('p', { class: 'gx-src' }, el('b', {}, `${app.bar(c.start)} → ${app.bar(c.start + c.len)}`),
        el('span', { class: 'lbl' }, ` · ${dur.toFixed(2)} s du son, depuis ${offSrc.toFixed(3)} s · tempo ${P.bpm} · ${keyLabel(P.key)}${c.pitch ? ` · transposé ${c.pitch > 0 ? '+' : ''}${c.pitch} : le MIDI suit` : ''}${c.rev ? ' · à l\'envers : le MIDI aussi' : ''}`)),
      el('div', { class: 'gx-eng' }, Object.entries(S.moteurs).map(([k, M]) => {
        const e = o.engines[k] || {};
        return el('button', { class: `gx-m${st.engine === k ? ' on' : ''}${e.ready ? '' : ' off'}`, type: 'button', disabled: e.ready ? null : true, title: e.ready ? M.doc : e.why,
          onclick: () => { st.engine = k; st.v = {}; paint(); } },
        el('b', {}, M.nom), el('span', {}, M.doc), e.ready ? el('small', {}, `${M.licence}${o.engine === 'factice' ? ' · moteur d\'essai' : ''}`) : el('small', { class: 'why' }, e.why),
        // en essai tout part ; ce qui manquerait en réel est dit quand même
        e.ready && o.engine === 'factice' && e.real && !e.real.ready ? el('small', { class: 'why' }, `en réel : ${e.real.why}`) : null);
      })),
      el('div', { class: 'gx-p' }, shown.filter((pid) => !S.params[pid].avance).map(field)),
      shown.some((pid) => S.params[pid].avance) ? el('details', { class: 'gr-adv' }, el('summary', {}, 'réglages du moteur'), el('div', { class: 'gx-p' }, shown.filter((pid) => S.params[pid].avance).map(field))) : null,
      o.note ? el('p', { class: 'gx-note' }, o.note) : null,
      el('p', { class: 'gx-foot' }, 'le clip MIDI entre dans la bibliothèque (sorte « midi ») avec sa méthode et sa source, et se pose en clips de notes sur une piste neuve sous ce clip'));
    go.disabled = !ready || null;
    go.title = ready ? '' : o.engines[st.engine]?.why || '';
    why.textContent = ready ? '' : o.engines[st.engine]?.why || '';
  };
  paint();
  const m = modal({ title: 'Extraire le MIDI', wide: true, body, foot: [why, el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Annuler'), go] });
  go.addEventListener('click', async () => {
    const E = S.moteurs[st.engine], v = {};
    const vals = {};
    for (const pid of E.params) vals[pid] = st.v[pid] ?? S.params[pid].defaut;
    for (const pid of E.params) if (cond(S.params[pid].si, vals)) v[pid] = vals[pid];
    go.disabled = true;
    try {
      const it = await app.loadItem(c.item);
      const j = await api('music/midi/extract', { method: 'POST', body: { src: c.item, off_s: offSrc, dur_s: dur, bpm: P.bpm, sig: P.sig,
        tonic: P.key.tonic, mode: P.key.mode, engine: st.engine, v, title: (c.name || it.title || 'clip').replace(/ \(essai\)/g, '').slice(0, 60), clip: c.id,
        project: P.id } });   // le clip extrait naît dans le Space de Musique du projet (server/tools/chanson.py)
      P.pending.push({ job: j.id, kind: 'midi', clip: c.id, title: j.title, quantize: v.quantize || '1/16' });
      app.commit('data');
      jobs.poll(true);
      toast(`en file : ${j.title}`, 4000);
      m.close();
    } catch (e) { toast(e.message, 6000); go.disabled = false; }
  });
}

// le travail fini : le clip MIDI se pose sous le clip audio, au même départ
export async function midiDone(app, pd, full) {
  const c = app.clip(pd.clip), id = full.result?.midi;
  if (!id) return;
  document.dispatchEvent(new CustomEvent('mu:midi'));
  if (!c) { toast('le clip audio a disparu : le MIDI est dans la bibliothèque (navigateur, MIDI)', 6000); return; }
  const rate = Math.pow(2, (c.pitch || 0) / 12);
  const made = await placeMidi(app, id, null, c.start, { quantize: pd.quantize, below: c.track, rate, pitch: c.pitch || 0, rev: !!c.rev, len: c.len });
  toast(`${full.result.notes} notes posées sous « ${app.track(c.track)?.name} » (${made.length} clip${made.length > 1 ? 's' : ''}) et rangées dans la bibliothèque · ${full.message || ''}`, 6000);
}

// ── le navigateur : la bibliothèque MIDI ────────────────────
export async function listMidi(q = '') {
  return (await api(`library?kind=midi&q=${encodeURIComponent(q)}&limit=200&sort=new`)).items || [];
}
export const midiSub = (it) => {
  const p = it.params || {};
  const how = { notes: 'notes', partition: 'partition', batterie: 'batterie', odio: 'motif' }[p.method] || (it.origin?.tool === 'upload' ? 'import' : '');
  return [p.bars ? `${p.bars} mes.` : '', p.notes ? `${p.notes} notes` : '', how, p.engine === 'factice' ? 'essai' : ''].filter(Boolean).join(' · ');
};
export const midiHref = (it) => href(it.url);
