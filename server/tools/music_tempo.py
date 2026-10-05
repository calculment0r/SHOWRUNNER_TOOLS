"""ODIO — « Détecter le tempo » d'un clip audio : l'essai du détecteur.

Demande de Cal (05/10) : « ça serait top d'avoir le BPM detector dans audio
sur une piste audio qu'on a importée ». Le calcul se fait **dans la page**
(`musique/tempo.js`, appelé par `musique/bpm.js`), pas ici :

- le son y est déjà décodé : le moteur d'ODIO le décode pour le jouer
  (`moteur.js`, `Engine.buffer`) ; rien à renvoyer au serveur ni à redécoder ;
- l'analyse a besoin de FFT (flux spectral) : la page la fait sur des tableaux
  typés en une fraction de seconde pour une chanson (mesuré : 30 s de son en
  ~0,2-0,3 s, 3 min en ~1,3 s sous node) ; le serveur n'a que la bibliothèque
  standard (pas de FFT : en Python pur, des dizaines de secondes), ffmpeg
  décode mais n'analyse pas ;
- le résultat agit sur le projet (son tempo, la place du clip), qui vit dans la
  page ; ni travail en file, ni voie de calcul, ni GPU.

Ce module ne sert donc qu'à l'essayer, comme les autres outils, par
`tools/check.py` : son `selftest` écrit des clics de synthèse à tempo connu
avec le module `wave` (indépendant du code essayé), puis fait lire chaque
fichier par le module même de la page, sous node (présent sur les DGX : Node
22 de DGX2). Sans node, l'essai le dit et ne compte rien.

Les signaux : un clic grave et fort au premier temps de chaque mesure (4/4),
un clic plus clair aux autres temps, une croche plus faible (−11 dB) entre
deux temps, au milieu (droit) ou aux deux tiers (swing ternaire, la croche
« longue-brève » du jazz), le premier temps à 0,37 s (pas sur 0).
"""

from __future__ import annotations

import json
import math
import random
import shutil
import subprocess
import tempfile
import wave
from array import array
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PAGE = REPO / "musique" / "tempo.js"
SR = 11025          # le taux auquel la page rééchantillonne avant d'analyser (tempo.js, REGLAGES.sr)
DEBUT = 0.37        # s : le premier temps

# les cas : (tempo, swing, croches, durée) ; ce que Cal a demandé, plus l'erreur
# d'octave classique (60 et sa croche à 120) et une batterie dans du bruit
CAS = [(bpm, swing, True, 20.0) for bpm in (90, 120, 128, 174) for swing in (False, True)] + [
    (60, False, True, 24.0), (174, False, False, 20.0)]


def clics(path: Path, bpm: float, swing: bool = False, croches: bool = True, duree: float = 20.0,
          debut: float = DEBUT, bruit: float = 0.0, seed: int = 7) -> None:
    """Un fichier WAV 16 bits mono de clics (bibliothèque standard seule)."""
    rng = random.Random(seed)
    n = int(duree * SR)
    buf = [0.0] * n
    T = 60.0 / bpm

    def clic(t: float, amp: float, f: float, d: float) -> None:
        a = int(round(t * SR))
        for i in range(int(d * SR)):
            if 0 <= a + i < n:
                e = math.exp(-i / (SR * d / 5))
                buf[a + i] += amp * e * (0.6 * math.sin(2 * math.pi * f * i / SR) + 0.4 * rng.uniform(-1, 1))

    k = 0
    while debut + k * T < duree:
        t = debut + k * T
        fort = k % 4 == 0
        clic(t, 0.9 if fort else 0.55, 800 if fort else 1500, 0.06 if fort else 0.03)
        if croches:
            clic(t + T * (2 / 3 if swing else 0.5), 0.15, 3000, 0.015)
        k += 1
    if bruit:
        buf = [x + bruit * rng.uniform(-1, 1) for x in buf]
    pk = max(1e-9, max(abs(x) for x in buf))
    pcm = array("h", (int(x / pk * 0.8 * 32767) for x in buf))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


# le lecteur sous node : lit chaque WAV (PCM 16 bits), le passe à analyser() de la
# page, rend une ligne JSON par fichier
LECTEUR = r"""
import { readFileSync } from 'node:fs';
const { analyser } = await import(process.argv[1]);
const out = [];
for (const f of process.argv.slice(2)) {
  const b = readFileSync(f);
  let i = 12, sr = 0, data = null, ch = 1;
  while (i + 8 <= b.length) {
    const id = b.toString('ascii', i, i + 4), len = b.readUInt32LE(i + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(i + 10); sr = b.readUInt32LE(i + 12); }
    if (id === 'data') data = b.subarray(i + 8, i + 8 + len);
    i += 8 + len + (len & 1);
  }
  const n = data.length / 2 / ch, x = new Float32Array(n);
  for (let k = 0; k < n; k++) x[k] = data.readInt16LE(k * 2 * ch) / 32768;
  const r = await analyser(x, sr, { sig: 4 });
  out.push(r.ok ? { f, ok: true, bpm: r.bpm, propose: r.propose, confiance: r.confiance, premier: r.premier,
    tempsFort: r.tempsFort, octave: r.octave, ms: r.ms } : { f, ok: false, pourquoi: r.pourquoi });
}
console.log(JSON.stringify(out));
"""


def lire(paths: list[Path]) -> list[dict]:
    node = shutil.which("node")
    r = subprocess.run([node, "--input-type=module", "-e", LECTEUR, PAGE.as_uri(), *map(str, paths)],
                       capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise RuntimeError(f"node : {r.stderr.strip()[-600:]}")
    return json.loads(r.stdout.strip().splitlines()[-1])


def selftest(call, ok) -> None:
    st, js = call("GET", "/musique/tempo.js")
    ok(st == 200 and b"export async function analyser" in (js if isinstance(js, bytes) else b""),
       f"le détecteur de tempo se sert à la page ({st})")
    st, ui = call("GET", "/musique/bpm.js")
    ok(st == 200, f"le panneau du tempo se sert à la page ({st})")
    if not shutil.which("node"):
        print("  (node absent : le détecteur de tempo n'est pas essayé ici)")
        return
    with tempfile.TemporaryDirectory(prefix="sr_tempo_") as d:
        d = Path(d)
        paths = []
        for bpm, swing, croches, duree in CAS:
            p = d / f"clics_{bpm}{'_swing' if swing else ''}{'' if croches else '_noires'}.wav"
            clics(p, bpm, swing, croches, duree)
            paths.append(p)
        bruit = d / "clics_140_bruit.wav"
        clics(bruit, 140, True, True, 20.0, bruit=0.05)
        court = d / "court.wav"
        clics(court, 120, False, True, 3.0)
        muet = d / "muet.wav"
        with wave.open(str(muet), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(bytes(2 * SR * 6))
        res = {Path(r["f"]).name: r for r in lire([*paths, bruit, court, muet])}
    for (bpm, swing, croches, _), p in zip([*CAS, (140, True, True, 0)], [*paths, bruit]):
        r = res.get(p.name, {})
        nom = f"{bpm} BPM{' swing' if swing else ''}{'' if croches else ' (noires seules)'}{' dans du bruit' if p == bruit else ''}"
        if not r.get("ok"):
            ok(False, f"tempo : {nom} — refusé ({r.get('pourquoi')})")
            continue
        T = 60.0 / bpm
        ok(abs(r["bpm"] - bpm) <= 0.1 and r["propose"] == bpm,
           f"tempo : {nom} → {r['bpm']:.3f} (proposé {r['propose']}), ni double ni moitié")
        ok(abs(r["premier"] - DEBUT) <= 0.01, f"tempo : {nom} — première pulsation à {r['premier'] * 1000:.1f} ms (vraie {DEBUT * 1000:.0f})")
        fort = r.get("tempsFort")
        ok(fort is not None and abs((fort - DEBUT) / (4 * T) - round((fort - DEBUT) / (4 * T))) * 4 * T <= 0.01,
           f"tempo : {nom} — le temps fort tombe sur un premier temps ({fort})")
        ok(r["confiance"] >= 0.9, f"tempo : {nom} — confiance {r['confiance']:.2f}")
    r = res.get("court.wav", {})
    ok(r.get("ok") is False and "court" in r.get("pourquoi", ""), f"tempo : 3 s, trop court, refusé ({r})")
    r = res.get("muet.wav", {})
    ok(r.get("ok") is False and "muet" in r.get("pourquoi", ""), f"tempo : un silence est refusé ({r})")
