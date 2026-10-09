"""ODIO — les moteurs de son du 09/10 : leur garde (docs/etudes/odio_synthes.md § 7).

Le son se fait dans la page ; ce module n'a rien à servir, seulement son
`selftest`, lancé par `tools/check.py`. Il fait tourner sous node (présent sur
les DGX : Node 22 de DGX2) les pièces que la page emploie, sans navigateur :

1. RINGS ET ELEMENTS (`musique/mutable/*.wasm`, compilés par
   tools/mutable_wasm/construire.sh) : chaque module s'instancie sans
   importation ; une note jouée sonne à sa hauteur (la3 : 220 Hz), sans NaN ni
   écrêtage ; et son coût NE MONTE PAS quand la résonance s'éteint — la garde
   des nombres dénormaux (le plancher de bruit des colles sr_rings.cc et
   sr_elements.cc) : sans lui, une voix passait de 2 % à 30-50 % d'un cœur.
2. LES LOIS DES BANQUES (`musique/banques.js`, celles de sfizz) : le suivi de
   vélocité, les fondus, le tour des régions, le rapport de lecture.

Sans node, l'essai le dit et ne compte rien.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

ESSAI_JS = r"""
import fs from 'fs';
const R = {};
const D = process.env.MUSIQUE + '/mutable/';
const charger = (f) => { const m = new WebAssembly.Module(fs.readFileSync(D + f)); const w = new WebAssembly.Instance(m, {}).exports; w.__wasm_call_ctors(); w.initialiser(); return { w, imports: WebAssembly.Module.imports(m).length }; };
// la hauteur par autocorrélation, entre 60 et 1000 Hz
const hauteur = (x, sr) => { let best = 0, bl = 0; for (let lag = Math.floor(sr / 1000); lag < sr / 60; lag++) { let s = 0; for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag]; if (s > best) { best = s; bl = lag; } } return bl ? sr / bl : 0; };
const mesure = (x) => { let pk = 0, nan = 0; for (const v of x) { if (v !== v) nan++; pk = Math.max(pk, Math.abs(v)); } return { pk, nan }; };
{ // Rings : une voix modale, la3 frappé, 6 s ; le coût de chaque seconde
  const { w, imports } = charger('rings.wasm'), B = w.tailleBloc(), sr = 48000;
  const o = new Float32Array(w.memory.buffer, w.tamponSortie(), B), a = new Float32Array(w.memory.buffer, w.tamponAux(), B);
  // la crête de chaque sortie (ODD, EVEN : deux prises, chacune ±1 sur le module) ; la hauteur sur leur somme
  const x = new Float32Array(sr * 6), cout = [];
  let pk = 0, nan = 0;
  // la référence : une seconde sans note, le meilleur de trois (des états nuls ou normaux : le coût plein, sans dénormaux)
  const ref = [0, 1, 2].map(() => { const t0 = process.hrtime.bigint(); for (let i = 0; i < sr; i += B) w.rendre(0, 0, 57, 0, 0.25, 0.6, 0.85, 0.3, 0, B); return Number(process.hrtime.bigint() - t0) / 1e6; });
  w.initialiser();
  for (let s = 0, b = 0; s < 6; s++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < sr; i += B, b++) {
      w.rendre(0, 0, 57, 0, 0.25, 0.6, 0.85, 0.3, b === 2 ? 1 : 0, B);
      for (let k = 0; k < B; k++) { x[s * sr + i + k] = o[k] + a[k]; if (o[k] !== o[k] || a[k] !== a[k]) nan++; pk = Math.max(pk, Math.abs(o[k]), Math.abs(a[k])); }
    }
    cout.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  R.rings = { imports, pk, nan, hz: hauteur(x.subarray(sr * 0.2, sr * 0.5), sr), cout, ref: Math.min(...ref) };
}
{ // Elements : quatre voix, l'archet tenu 1 s puis 5 s de chute ; une voix seule pour la hauteur (32 kHz)
  const { w, imports } = charger('elements.wasm'), B = w.tailleBloc(), sr = w.frequence();
  const o = new Float32Array(w.memory.buffer, w.tamponSortie(), B), a = new Float32Array(w.memory.buffer, w.tamponAux(), B);
  const patch = new Float32Array(w.memory.buffer, w.tamponPatch(), 19);
  const x = new Float32Array(sr * 6), cout = [];
  const ref = [0, 1, 2].map(() => { const t0 = process.hrtime.bigint(); for (let i = 0; i < sr; i += B) for (let v = 0; v < 4; v++) w.rendre(v, 57 + 4 * v, 0, 0.8, 0, 0, B); return Number(process.hrtime.bigint() - t0) / 1e6; });
  w.initialiser();
  for (let s = 0; s < 6; s++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < sr; i += B) for (let v = 0; v < 4; v++) { w.rendre(v, 57 + 4 * v, s < 1 ? 1 : 0, 0.8, 0, 0, B); if (v === 0) for (let k = 0; k < B; k++) x[s * sr + i + k] = (o[k] + a[k]) / 2; }
    cout.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  R.elements = { imports, sr, patch: Array.from(patch).slice(0, 3), ...mesure(x), hz: hauteur(x.subarray(sr * 0.2, sr * 0.5), sr), cout, ref: Math.min(...ref) };
}
{ // les lois des banques
  const L = await import(process.env.MUSIQUE + '/banques.js');
  R.gain = [L.gainVelocite(1, 1), L.gainVelocite(1, 0.5), L.gainVelocite(0.73, 0.5), L.gainVelocite(0, 0.1)];
  R.fondus = [L.fonduEntree([0, 0], 0.5), L.fonduEntree([64, 127], 64 / 127 - 0.01), L.fonduEntree([0, 127], 1), L.fonduSortie([0, 127], 0), L.fonduSortie([0, 63], 1)];
  const zone = (o) => ({ f: 'z0001.flac', cle: 60, bas: 0, haut: 127, vbas: 0, vhaut: 127, xin: [0, 0], xout: [127, 127], rr: [1, 1], db: 0, ct: 0, dec: 0, boucle: null, env: [0, 0, 0, 1, 0.1], vt: 1, seul: false, ...o });
  const B = { zones: [zone({ rr: [2, 1], f: 'a' }), zone({ rr: [2, 2], f: 'b' }), zone({ vbas: 100, f: 'fort' }), zone({ bas: 70, haut: 80, f: 'aigu' })] };
  const tours = new Map();
  R.tours = [0, 1, 2, 3].map(() => L.zonesDe(B, 60, 0.5, tours).map((x) => x.z.f).join('+'));
  R.fort = L.zonesDe(B, 60, 1, new Map()).map((x) => x.z.f).sort().join('+');
  R.hors = L.zonesDe({ zones: [zone({ bas: 50, haut: 70 })] }, 90, 0.5, new Map()).length;
  R.rapport = [L.rapport(zone({}), 72), L.rapport(zone({ ct: -100 }), 60, 100)];
}
console.log(JSON.stringify(R));
"""


def essayer() -> dict:
    node = shutil.which("node")
    r = subprocess.run([node, "--input-type=module", "-e", ESSAI_JS], capture_output=True, text=True, timeout=180,
                       env={"MUSIQUE": str(REPO / "musique"), "PATH": "/usr/bin:/bin"})
    if r.returncode:
        raise RuntimeError(f"node : {r.returncode} {r.stderr.strip()[-600:]}")
    return json.loads(r.stdout.strip().splitlines()[-1])


def selftest(call, ok) -> None:
    for f in ("rings.wasm", "elements.wasm"):
        st, b = call("GET", f"/musique/mutable/{f}")
        ok(st == 200 and isinstance(b, bytes) and b[:4] == b"\0asm", f"moteurs : {f} se sert à la page ({st})")
    if not shutil.which("node"):
        print("  (node absent : Rings, Elements et les lois des banques ne sont pas essayés ici)")
        return
    R = essayer()
    for nom in ("rings", "elements"):
        m = R[nom]
        # à moins d'un demi-ton (la géométrie par défaut d'Elements, une plaque, n'est pas tout à fait harmonique)
        ok(m["imports"] == 0 and m["nan"] == 0 and 0.05 < m["pk"] < 1 and abs(m["hz"] / 220 - 1) < 0.029,
           f"moteurs, {nom} : sans importation, une note sonne à sa hauteur, sans NaN ni écrêtage "
           f"(crête {m['pk']:.3f}, {m['hz']:.1f} Hz pour la3)")
        # la médiane des secondes où la résonance s'éteint, contre une seconde sans note (le même
        # processus, la même charge) : avec le plancher, 2 à 3 fois ; sans lui, 100 fois (mesuré le 09/10)
        c = sorted(m["cout"][2:])
        med = c[len(c) // 2]
        ok(med < 10 * max(1.0, m["ref"]),
           f"moteurs, {nom} : le coût ne monte pas quand la résonance s'éteint — la garde des dénormaux "
           f"(ms par seconde rendue : {', '.join(f'{x:.0f}' for x in m['cout'])} ; sans note : {m['ref']:.0f})")
    ok(R["elements"]["sr"] == 32000 and R["elements"]["patch"] == [1, 0, 0.5],
       f"moteurs, elements : il compte en 32 kHz ; ses réglages partent de ceux du module ({R['elements']['sr']} {R['elements']['patch']})")
    g = R["gain"]
    ok(abs(g[0] - 1) < 1e-9 and abs(g[1] - 0.25) < 1e-9 and abs(g[2] - (1 - 0.73 * 0.75)) < 1e-9 and abs(g[3] - 1) < 1e-9,
       f"moteurs, banques : le suivi de vélocité de sfizz, g = 1 − t(1 − v²) ({g})")
    f = R["fondus"]
    ok(f[0] == 1 and f[1] == 0 and f[2] == 1 and f[3] == 1 and f[4] == 0, f"moteurs, banques : les fondus de vélocité, leurs bornes ({f})")
    ok(R["tours"] == ["a", "b", "a", "b"] and R["fort"] == "a+fort" and R["hors"] == 0,
       f"moteurs, banques : le tour des régions, la couche forte, une note hors des zones se tait ({R['tours']} {R['fort']} {R['hors']})")
    ok(abs(R["rapport"][0] - 2) < 1e-9 and abs(R["rapport"][1] - 1) < 1e-9, f"moteurs, banques : le rapport de lecture (l'octave, les cents) ({R['rapport']})")
