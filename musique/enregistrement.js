// ODIO — la prise : ce qu'on joue au clavier de l'ordinateur ou en MIDI
// (Web MIDI) devient un motif, posé en clip sur la piste armée ; le micro
// (getUserMedia + MediaRecorder, MDN) devient un clip audio.
//
//   ● armé, puis Lecture : la prise commence ; Stop : elle se pose.
//   Boucle active : la prise dure la boucle et les passages s'additionnent
//   (on superpose) ; sinon elle va de la mesure de la première note à la
//   fin de la mesure de la dernière.
//   Une piste armée prend la prise ; sans piste armée, la piste choisie.
//   Les clips qu'une prise recouvre deviennent muets (rien n'est effacé).
//
// Micro : la prise est décalée de la latence de sortie (AudioContext.
// outputLatency + baseLatency, MDN) et d'entrée (MediaTrackSettings.latency,
// quand le navigateur la donne) — une estimation, pas une mesure.

import { toast, uploadFile, href } from '../commun/shell.js';
import { TRACK_KINDS, drumVoicesOf } from './modules.js';
import { wav24 } from './moteur.js';
import { noterOrigine } from './projet.js';   // la bibliothèque du projet : une prise y entre comme « prise »

export function createRecorder(app) {
  const { S, engine } = app;
  let R = null;
  let takes = 0;

  const targets = () => {
    const armed = S.proj.tracks.filter((t) => t.arm && t.kind !== 'bus');
    if (armed.length) return armed;
    const t = app.track(S.sel.track);
    return t && TRACK_KINDS[t.kind]?.pattern ? [t] : [];
  };

  async function begin() {
    if (R) return;
    const p = S.proj;
    const tg = targets();
    if (!tg.length) { toast('rien à enregistrer : arme une piste (●) ou choisis une piste d\'instrument'); return; }
    const pos = engine.position();
    const L = p.loop.on && pos >= p.loop.a && pos < p.loop.b ? { a: p.loop.a, b: p.loop.b } : null;
    R = { start: pos, loop: L, notes: new Map(), open: new Map(), mic: null, n: 0 };
    for (const t of tg) if (t.kind !== 'audio') R.notes.set(t.id, []);
    const micTrack = tg.find((t) => t.kind === 'audio');
    if (micTrack) R.mic = await startMic(micTrack).catch((e) => { toast(`micro : ${e.message}`, 6000); return null; });
    app.paintTransport();
  }

  async function startMic(t) {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('ce navigateur n\'enregistre pas le micro');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const rec = new MediaRecorder(stream);
    const chunks = [];
    const M = { track: t.id, rec, stream, chunks, beat: null, lat: 0 };
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    await new Promise((res) => {
      rec.onstart = () => {
        M.beat = engine.position();
        const set = stream.getAudioTracks()[0]?.getSettings?.() || {};
        M.lat = (engine.ctx.outputLatency || 0) + (engine.ctx.baseLatency || 0) + (set.latency || 0);
        res();
      };
      rec.start();
    });
    return M;
  }

  // une note jouée : `key` identifie la touche (pour la relâcher)
  function noteOn(t, pitch, vel, key) {
    if (!R || !R.notes.has(t.id)) return;
    const b = engine.position();
    const ev = { track: t.id, p: pitch, v: vel, on: b, off: null };
    R.notes.get(t.id).push(ev);
    R.open.set(key, ev);
    R.n++;
  }
  function noteOff(key) {
    const ev = R?.open.get(key);
    if (!ev) return;
    ev.off = engine.position();
    R.open.delete(key);
  }
  async function end() {
    if (!R) return;
    const r = R;
    R = null;
    const p = S.proj;
    const now = engine.position();
    for (const ev of r.open.values()) ev.off = now;
    let made = 0;
    for (const [tid, evs] of r.notes) {
      if (!evs.length) continue;
      const t = app.track(tid);
      if (!t) continue;
      let a, L;
      if (r.loop) { a = r.loop.a; L = r.loop.b - r.loop.a; }
      else {
        const first = Math.min(...evs.map((e) => e.on)), last = Math.max(...evs.map((e) => e.off ?? e.on));
        a = Math.floor(first / p.sig) * p.sig;
        L = Math.max(p.sig, Math.ceil((last + 1e-6) / p.sig) * p.sig - a);
      }
      L = Math.min(64, Math.ceil(L));
      const steps = L * 4;
      const src = app.mod(t.src);
      const pat = { id: app.uid('p'), track: t.id, name: `Prise ${++takes}`, steps };
      if (t.kind === 'drums') {
        const voices = drumVoicesOf(src?.type);
        pat.lanes = {};
        for (const e of evs) {
          const v = voices[((e.p % 12) + 12) % 12];
          if (!v) continue;
          const s = Math.round((e.on - a) * 4);
          if (s < 0 || s >= steps) continue;
          if (!pat.lanes[v.id]) pat.lanes[v.id] = Array(steps).fill(0);
          pat.lanes[v.id][s] = Math.max(pat.lanes[v.id][s], Math.round(e.v * 100) / 100);
        }
      } else {
        pat.notes = [];
        for (const e of evs) {
          const s = Math.round((e.on - a) * 4 * 100) / 100;
          if (s < 0 || s >= steps) continue;
          let dur = (e.off ?? e.on + 0.25) - e.on;
          if (dur < 0 && r.loop) dur += L;                  // tenue par-dessus le retour de boucle
          const l = Math.max(0.25, Math.min(steps - s, Math.round(Math.max(0.0625, dur) * 4 * 100) / 100));
          pat.notes.push({ s, l, p: e.p, v: Math.round(e.v * 100) / 100 });
        }
      }
      p.patterns.push(pat);
      for (const c of p.clips) if (c.track === t.id && c.start < a + L && c.start + c.len > a) c.mute = true;
      const clip = { id: app.uid('c'), track: t.id, start: a, len: L, pat: pat.id, name: 'Nouveau' };
      p.clips.push(clip);
      t.pat = pat.id;
      S.sel.clip = clip.id; S.sel.clips = [clip.id]; S.sel.track = t.id;
      made++;
    }
    if (made) { toast(`prise posée : ${made} clip${made > 1 ? 's' : ''} « Nouveau »${r.loop ? ' (la boucle)' : ''}`); app.commit('data'); }
    if (r.mic) await endMic(r.mic);
    app.paintTransport();
  }

  async function endMic(M) {
    const stopped = new Promise((res) => { M.rec.onstop = res; });
    M.rec.stop();
    await stopped;
    for (const tr of M.stream.getTracks()) tr.stop();
    if (!M.chunks.length) { toast('micro : rien d\'enregistré'); return; }
    try {
      const blob = new Blob(M.chunks, { type: M.rec.mimeType || 'audio/webm' });
      const dec = new OfflineAudioContext(2, 1, 48000);
      const buf = await dec.decodeAudioData(await blob.arrayBuffer());
      const name = `prise-micro-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.wav`;
      toast('micro : dépôt de la prise…', 20000);
      const it = await uploadFile(new File([wav24(buf)], name, { type: 'audio/wav' }), { tool: 'music', folder: 'Musique', title: `Prise micro · ${S.proj.name}` });
      app.items.set(it.id, Promise.resolve({ ...it, href: href(it.url) }));
      const p = S.proj;
      noterOrigine(p, it.id, 'prise');
      const off = Math.min(M.lat, Math.max(0, buf.duration - 0.05));
      const len = Math.max(0.25, (buf.duration - off) * p.bpm / 60);
      p.clips.push({ id: app.uid('c'), track: M.track, start: Math.max(0, M.beat ?? 0), len, item: it.id, off: Math.round(off * 1000) / 1000 });
      toast(`prise micro posée · ${buf.duration.toFixed(1)} s · décalage de latence ${(off * 1000).toFixed(0)} ms`);
      app.commit('graph');
    } catch (e) { toast(`micro : ${e.message}`, 6000); }
  }

  return {
    begin, end, noteOn, noteOff,
    get active() { return !!R; },
    live() {
      if (!R) return null;
      const tid = [...R.notes.keys()][0] || R.mic?.track;
      if (!tid) return null;
      const now = engine.position();
      const a = R.loop ? R.loop.a : Math.floor(R.start / S.proj.sig) * S.proj.sig;
      return { track: tid, a, b: R.loop ? R.loop.b : Math.max(now, a), n: R.n };
    },
  };
}
