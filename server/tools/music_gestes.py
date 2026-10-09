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
