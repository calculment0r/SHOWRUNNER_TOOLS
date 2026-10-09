"""ODIO — les gestes de base du studio : l'essai, sous node, des modules mêmes de la page.

La grande passe du 09/10 (Cal : « on refait une grosse passe sur ODIO et on
l'améliore vraiment » ; l'audit : `docs/etudes/musique.md`, « Fait le 09/10 —
la grande passe »). Ce qui s'y corrige vit dans la page (`musique/*.js`) :
ce module ne sert qu'à l'essayer, comme `music_tempo.py`, par `tools/check.py`.

Les modules d'ODIO lisent les descripteurs de leurs instruments dans un
`OfflineAudioContext` dès leur chargement (`modules.js`) : sous node, un faux
Web Audio (`_FAUX`, plus bas) rend un objet muet à tout appel, le temps de
charger `moteur.js` et `projet.js`. Rien n'y sonne : on n'y essaie que la
logique (ce qui se planifie, ce que devient le projet) ; le son se mesure dans
Chromium (le pilote `musique/pilote_odio_passe.mjs`).

Sans node, l'essai le dit et ne compte rien.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess

from core import config

DIR = config.REPO / "musique"

# un faux Web Audio : tout appel, toute construction rend un faux ; tout réglage
# s'accepte ; un nombre lu vaut 0 (currentTime, sampleRate, value)
_FAUX = r"""
const faux = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined
    : ['value', 'sampleRate', 'currentTime', 'length', 'numberOfChannels'].includes(k) ? 0 : faux()),
  set: () => true, apply: () => faux(), construct: () => faux(),
});
for (const n of ['OfflineAudioContext', 'AudioContext', 'GainNode', 'OscillatorNode', 'BiquadFilterNode', 'AudioWorkletNode',
  'ConstantSourceNode', 'StereoPannerNode', 'DelayNode', 'ConvolverNode', 'WaveShaperNode', 'DynamicsCompressorNode',
  'AnalyserNode', 'ChannelSplitterNode', 'ChannelMergerNode', 'AudioBufferSourceNode', 'AudioBuffer']) globalThis[n] = faux();
const U = process.env.MUSIQUE_URL;
const M = await import(U + '/moteur.js');
const PJ = await import(U + '/projet.js');
const R = {};
"""

# la Session : un clip de notes lancé sur une voie se planifie (Graph.scheduleSession,
# appelé sur un faux graphe qui note ce qu'on lui demande)
_SESSION_JS = r"""
const p = {
  bpm: 120, sig: 4, modules: [{ id: 'm1', type: 'synth', voie: 'v1', params: {} }],
  voies: [{ id: 'v1', kind: 'synth', src: 'm1' }],
  slots: [{ id: 'cl1', voie: 'v1', scene: 'sc1', len: 4, pat: 'p1' }],
  patterns: [{ id: 'p1', track: 'v1', steps: 16, notes: [{ s: 0, l: 2, p: 60, v: 0.9 }, { s: 8, l: 2, p: 67, v: 0.9 }] }],
};
const vu = [];
const g = { nodes: new Map([['m1', {}]]), notes: (tr, c, pat, src, from, to) => vu.push([tr.id, c.start, c.len, pat.notes.length, from, to]),
  audioClip: () => vu.push(['audio']) };
const jeu = new Map([['v1', { slot: 'cl1', origin: 0, fresh: true, rec: false }]]);
try { M.Graph.prototype.scheduleSession.call(g, p, jeu, 0, 8, 0); R.session = { ok: true, vu, reste: jeu.size }; }
catch (e) { R.session = { ok: false, err: String(e) }; }
"""

# le recouvrement : un clip posé l'emporte sur ce qu'il recouvre de sa piste (projet.js, ecraserRecouverts)
_RECOUVRE_JS = r"""
let n = 0;
const uid = (x) => `${x}n${++n}`;
const projet = () => ({
  bpm: 120, sig: 4,
  tracks: [{ id: 't1', kind: 'synth' }, { id: 't2', kind: 'audio' }],
  patterns: [{ id: 'p1', track: 't1', steps: 64, notes: [] }],   // un motif de 16 noires
  clips: [{ id: 'a', track: 't1', start: 16, len: 16, pat: 'p1' }, { id: 'b', track: 't1', start: 32, len: 16, pat: 'p1' },
          { id: 'c', track: 't1', start: 48, len: 8, pat: 'p1' }, { id: 'd', track: 't2', start: 32, len: 16, item: 'aud-x', off: 0, fi: 0.5 }],
});
const etat = (p) => p.clips.map((c) => [c.id, c.track, c.start, c.len, c.off || 0, c.fi ?? null]).sort((x, y) => (x[1] + x[2]).localeCompare(y[1] + y[2]) || x[2] - y[2]);
const essai = (geste) => { const p = projet(); const vu = PJ.empreinteClips(p); geste(p); const r = PJ.ecraserRecouverts(p, vu, uid); return { e: etat(p), retires: r.retires, n: r.n, encore: PJ.ecraserRecouverts(p, r.vu, uid).n }; };
R.glisse = essai((p) => { p.clips[0].start = 24; });                                   // a 16-32 glissé à 24 : b rogné par le début
R.dedans = essai((p) => { p.clips.push({ id: 'x', track: 't1', start: 36, len: 4, pat: 'p1' }); });   // collé au milieu de b : b coupé autour
R.dessous = essai((p) => { p.clips.push({ id: 'x', track: 't1', start: 46, len: 12, pat: 'p1' }); }); // c tout dessous : retiré
R.muet = essai((p) => { p.clips[1].mute = true; p.clips[0].start = 24; });               // b désactivé : il reste dessous
R.ensemble = essai((p) => { for (const c of p.clips) c.start += 8; });                 // tout glissé ensemble : rien ne se décide
R.audio = essai((p) => { p.clips.push({ id: 'x', track: 't2', start: 28, len: 8, item: 'aud-y' }); }); // le son rogné : 4 noires à 120 = 2 s
R.autre = essai((p) => { p.clips.push({ id: 'x', track: 't2', start: 16, len: 16, item: 'aud-y' }); }); // une autre piste : rien
R.premier = (() => { const p = projet(); p.clips[0].start = 24; return PJ.ecraserRecouverts(p, null, uid).n; })();
"""

# coller des notes : elles l'emportent sur celles de même hauteur qu'elles recouvrent (projet.js, poserNotes)
_NOTES_JS = r"""
const m = { steps: 16, notes: [{ s: 0, l: 4, p: 60 }, { s: 4, l: 4, p: 62 }, { s: 6, l: 6, p: 64 }, { s: 9, l: 2, p: 64 }] };
const posees = PJ.poserNotes(m, [{ s: 8, l: 4, p: 64, v: 0.5 }, { s: 8, l: 2, p: 67 }, { s: 14, l: 4, p: 60 }, { s: 16, l: 2, p: 60 }, { s: -1, l: 1, p: 60 }]);
R.notes = { posees: posees.map((n) => [n.s, n.l, n.p]), motif: m.notes.map((n) => [n.s, n.l, n.p]).sort((a, b) => a[0] - b[0] || a[2] - b[2]),
  memes: posees.every((n) => m.notes.includes(n)) };
"""


def _node(js: str, ok, quoi: str) -> dict | None:
    node = shutil.which("node")
    env = {**os.environ, "MUSIQUE_URL": DIR.as_uri()}
    r = subprocess.run([node, "--input-type=module", "-e", _FAUX + js + "\nconsole.log(JSON.stringify(R));"],
                       capture_output=True, text=True, timeout=60, env=env)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        ok(False, f"gestes d'ODIO : {quoi} — node ne répond pas ({r.returncode} {r.stderr[-600:]})")
        return None


def selftest(call, ok) -> None:
    if not shutil.which("node"):
        print("  (node absent : les gestes d'ODIO ne sont pas essayés ici)")
        return
    R = _node(_SESSION_JS, ok, "la Session")
    if R is not None:
        s = R["session"]
        ok(s.get("ok") and s["vu"] == [["v1", 0, 4, 2, 0, 4], ["v1", 4, 4, 2, 4, 8]] and s["reste"] == 1,
           f"gestes d'ODIO : un clip de notes lancé en Session se planifie, tour après tour (09/10 : il jetait, la Session restait muette) ({s})")
    R = _node(_RECOUVRE_JS, ok, "le recouvrement")
    if R is not None:
        ok(R["glisse"]["e"][:3] == [["a", "t1", 24, 16, 0, None], ["b", "t1", 40, 8, 8, None], ["c", "t1", 48, 8, 0, None]] and not R["glisse"]["retires"]
           and R["glisse"]["encore"] == 0,
           f"recouvrement : un clip glissé sur le suivant le rogne par le début, même clip, son motif calé (off 8) ({R['glisse']})")
        d = R["dedans"]["e"]
        ok([x[:5] for x in d[:4]] == [["a", "t1", 16, 16, 0], ["b", "t1", 32, 4, 0], ["x", "t1", 36, 4, 0], [d[3][0], "t1", 40, 8, 8]] and d[3][0] not in "abcx",
           f"recouvrement : collé au milieu d'un clip, il le coupe autour de lui — la tête reste, la queue devient un clip à part ({d})")
        ok(R["dessous"]["retires"] == ["c"] and [x[:4] for x in R["dessous"]["e"] if x[1] == "t1"] == [["a", "t1", 16, 16], ["b", "t1", 32, 14], ["x", "t1", 46, 12]],
           f"recouvrement : un clip tout dessous est retiré, celui qui commence avant est raccourci ({R['dessous']})")
        ok(R["muet"]["n"] == 0 and ["b", "t1", 32, 16, 0, None] in R["muet"]["e"],
           f"recouvrement : un clip désactivé reste dessous (la prise n'efface rien) ({R['muet']})")
        ok(R["ensemble"]["n"] == 0, f"recouvrement : des clips déplacés ensemble ne se coupent pas entre eux ({R['ensemble']})")
        ok(["d", "t2", 36, 12, 2, 0] in R["audio"]["e"] and R["audio"]["n"] == 1,
           f"recouvrement : un son rogné par le début avance dans le son (4 noires à 120 BPM : 2 s), sans fondu d'entrée ({R['audio']})")
        ok(R["autre"]["n"] == 0 and R["premier"] == 0, f"recouvrement : rien sur une autre piste, rien sans l'empreinte du geste d'avant ({R['autre']} {R['premier']})")
    R = _node(_NOTES_JS, ok, "coller des notes")
    if R is not None:
        n = R["notes"]
        ok(n["posees"] == [[8, 4, 64], [8, 2, 67], [14, 2, 60]] and n["memes"],
           f"notes collées : celles qui tiennent sont posées (rognées à la fin du motif), le reste dehors ; ce sont les objets du motif ({n})")
        ok(n["motif"] == [[0, 4, 60], [4, 4, 62], [6, 2, 64], [8, 4, 64], [8, 2, 67], [14, 2, 60]],
           f"notes collées : la note de même hauteur commencée avant est raccourcie, celle qui commence dessous s'en va, les autres hauteurs restent ({n['motif']})")
