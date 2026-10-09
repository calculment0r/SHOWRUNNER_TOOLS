"""ODIO — les attracteurs : la garde des facettes, l'opérateur sur chaque sorte de module (09/10).

Cal, 09/10 : « il y a plein de nodes qui ne semblent pas être pris en compte par
nos paramètres d'attracteurs, si ? Revérifie et avance là-dessus. » Ce que capte
un attracteur, et ce qu'il fait au son, se décide dans la page
(`musique/facettes.js`, `musique/machines/influence.js`, `musique/moteur.js`) ;
ce module n'a rien à servir, seulement son `selftest`, lancé par
`tools/check.py`. Il fait tourner sous node (présent sur les DGX : Node 22 de
DGX2), avec un faux Web Audio (tout ce qu'on lui demande rend un faux : les
modules d'ODIO se construisent, rien ne sonne), les modules mêmes de la page :

1. LA GARDE : chaque réglage continu de chaque module (modules.js, jouets/defs.js,
   et tout module qui s'ajoute) a pris position — une sorte connue, donc une
   facette ou « hors attracteurs » dit ; aucune sorte pour une clé absente.
2. LA TABLE COMPLÈTE : chaque choix du 29/09 (FACETTES_MODULES, gelé plus bas)
   est gardé, sauf les réglages discrets, hors d'office.
3. LES MACHINES : chaque branchement (MACHINE_ENGINES.map) vise un réglage du
   module qui porte le son ; un contrôle capté et branché s'entend.
4. L'OPÉRATEUR PARTOUT : un module de chaque sorte, chacun sous son attracteur
   (poids 0,5), chaque réglage loin de son défaut : chaque réglage capté joue
   neutre + (valeur − neutre) × 0,5, à son pas ; aucun réglage hors attracteurs ;
   une voie d'automation et un câble de valeur gardent la main.
5. LE MOTEUR : un Graph monté sur le faux contexte ; une tranche planifiée
   porte chaque réglage de la carte jusqu'à son module, par son moyen
   (setParameter à l'instant, ou la copie entendue posée à l'instant de la
   tranche) ; l'arpège et les scènes des jouets lisent l'opérateur ; à l'arrêt,
   chaque réglage reprend sa valeur.

Sans node, l'essai le dit et ne compte rien.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

# la table du 29/09 (machines/influence.js, FACETTES_MODULES, « à relire par Cal ») : ses choix restent,
# lus désormais dans les déclarations des modules ; synth.wave et analog.wave sont discrets (hors d'office)
TABLE_2909 = {
    "synth.oct": "tonalité", "synth.oct2": "tonalité", "synth.det": "tension", "synth.cut": "brillance",
    "synth.res": "matière", "synth.fenv": "matière", "synth.wave": "matière",
    "analog.detune": "tension", "analog.cutoff": "brillance", "analog.resonance": "matière", "analog.envAmount": "matière", "analog.wave": "matière",
    "acid.cutoff": "brillance", "acid.resonance": "matière", "acid.envMod": "matière", "acid.accent": "accents",
    "plaits.timbre": "brillance", "plaits.harmo": "matière", "plaits.morph": "matière", "plaits.cutoff": "brillance", "plaits.resonance": "matière",
    "sampler.root": "tonalité", "rythme.drive": "matière",
    "filtre.cutoff": "brillance", "filtre.reso": "matière", "filtre.drive": "matière",
    "satura.drive": "matière", "crush.bits": "matière", "eq3.high": "brillance",
}

ESSAI_JS = r"""
// un faux Web Audio : tout ce qu'on lui demande rend un faux (les modules d'ODIO se construisent, rien ne sonne)
const faux = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' || k === Symbol.iterator ? undefined : faux()),
  apply: () => faux(), construct: () => faux(), set: () => true,
});
for (const n of ['OfflineAudioContext', 'AudioContext', 'GainNode', 'BiquadFilterNode', 'DelayNode', 'ConvolverNode', 'DynamicsCompressorNode',
  'WaveShaperNode', 'StereoPannerNode', 'OscillatorNode', 'AudioBufferSourceNode', 'AudioBuffer', 'AnalyserNode', 'ChannelSplitterNode',
  'ChannelMergerNode', 'AudioWorkletNode', 'ConstantSourceNode']) globalThis[n] = faux();
const U = (f) => new URL(f, process.env.MUSIQUE_URL).href;
const M = await import(U('modules.js')), F = await import(U('facettes.js')), I = await import(U('machines/influence.js'));
const T = await import(U('machines/tuiles.js')), MB = await import(U('machines/blocks/machines.js')), E = await import(U('moteur.js'));
const R = {};

// 1. la garde : chaque réglage continu a pris position
R.sans = F.sansPosition(M.MODULES);
// 2. la table complète : type → [clé, sorte, facette, discret]
R.table = Object.fromEntries(Object.entries(M.MODULES).map(([t, d]) => [t, d.params.map((s) => [s.k, s.sorte, s.facette ?? null, s.opts ? 1 : 0])]));
R.sortes = Object.fromEntries(Object.entries(F.SORTES).map(([k, s]) => [k, s.facette]));
// 3. les machines : chaque branchement vise un réglage du module qui porte le son ; la position de chaque contrôle
R.machines = {};
for (const m of MB.MACHINES) {
  const eng = MB.MACHINE_ENGINES[m.id], type = T.TYPE_DE_VOIX[eng?.voice] || null;
  const rows = [];
  for (const s of m.sections) for (const d of T.descripteursDe(s.id)) {
    const pos = I.positionDeControle(m.id, type, d), e = eng?.map?.[d.id];
    if (e || pos.facette) rows.push([d.id, d.curve === 'choice' ? 1 : 0, e ? e.param : null, pos.facette, !!pos.branche, pos.source]);
  }
  R.machines[m.id] = { type, rows, mauvais: Object.entries(eng?.map || {}).filter(([, e]) => !M.MODULES[type]?.params.some((s) => s.k === e.param)).map(([c]) => c) };
}

// 4. l'opérateur, sur chaque sorte de module : un module de chaque type, chacun sous son attracteur
// (sept anneaux de 400, le centre à 200 du bord : poids 0,5), chaque réglage continu loin de son défaut
const loin = (s) => (Math.abs(s.max - s.def) >= Math.abs(s.def - s.min) ? s.max : s.min);
const p = { bpm: 120, sig: 4, tracks: [], voies: [], cables: [], clips: [], patterns: [], auto: [], arcs: [], modules: [], banc: { segs: [], atts: [] } };
const types = Object.keys(M.MODULES);
types.forEach((type, i) => {
  const d = M.MODULES[type];
  const params = {};
  for (const s of d.params) if (!s.opts) params[s.k] = loin(s);
  p.modules.push({ id: `m_${type}`, type, track: null, x: (i % 8) * 3000, y: Math.floor(i / 8) * 3000, w: 200, h: 200, on: true, params });
});
// chaque machine qui a un son (instrument ou effet), sur le module qui porte ce son (TYPE_DE_VOIX)
const machines = MB.MACHINES.map((m) => [m.id, T.TYPE_DE_VOIX[MB.MACHINE_ENGINES[m.id]?.voice]]).filter(([, type]) => type);
machines.forEach(([id, type], i) => {
  const def = MB.MACHINES.find((x) => x.id === id), at = { x: 0, y: 40000 + i * 3000 };
  const ctl = {};
  for (const s of def.sections) for (const d of T.descripteursDe(s.id)) if (d.curve !== 'choice') ctl[d.id] = d.default > 50 ? 0 : 100;
  // les sections écartées : chacune sous son seul attracteur
  const sec = Object.fromEntries(def.sections.map((s, j) => [s.id, { x: at.x + j * 3000, y: at.y, w: 200, h: 200 }]));
  p.modules.push({ id: `mach_${id}`, type, track: null, x: at.x, y: at.y, on: true, params: {}, mach: { id, sec, ctl } });
});
const toutes = T.tuilesDe(p, M.MODULES);
for (const t of toutes) {
  const a = { id: `a_${t.id}`, segment: `g_${t.id}`, nom: 'ESSAI', couleur: 'nd-tim', x: t.x + t.w + 200, y: t.y + t.h / 2, r: 110, loi: 1,
    anneaux: F.FACETTES.map((f) => ({ facette: f, couleur: 'nd-tim', r: 400, ang: 0 })) };
  p.banc.atts.push(a); p.banc.segs.push({ id: a.segment, lane: 'tim', d: 0, l: 16, atr: a.id });
}
// une voie d'automation et un câble de valeur gardent la main
p.auto.push({ id: 'au1', mod: 'm_filter', k: 'freq', on: true, pts: [[0, 0.2], [16, 0.8]] });
p.cables.push({ a: 'm_pong', b: 'm_reel', t: 'mod', k: 'speed' });
const borne = (s, v) => { const x = Math.min(s.max, Math.max(s.min, v)); return s.step ? Math.round(x / s.step) * s.step : x; };
const carte = I.influenceA(p, 1);
const manque = [], faux_ = [], tenus = [];
for (const m of p.modules) {
  if (m.mach) continue;
  for (const s of M.MODULES[m.type].params) {
    if (!s.facette) { if (carte.get(m.id)?.has(s.k)) faux_.push(`${m.type}.${s.k} (hors, entendu)`); continue; }
    const got = carte.get(m.id)?.get(s.k);
    const tenu = (m.id === 'm_filter' && s.k === 'freq') || (m.id === 'm_reel' && s.k === 'speed');
    if (tenu) { if (got) tenus.push(`${m.type}.${s.k}`); continue; }
    if (!got) { manque.push(`${m.type}.${s.k}`); continue; }
    const want = borne(s, s.def + (m.params[s.k] - s.def) * 0.5);
    if (Math.abs(got.v - want) > 1e-6 * Math.max(1, Math.abs(want)) || Math.abs(got.w - 0.5) > 1e-9) faux_.push(`${m.type}.${s.k} : ${got.v} ≠ ${want}`);
  }
}
R.operateur = { manque, faux: faux_, tenus, modules: carte.size };
// les machines : chaque contrôle branché et capté s'entend sur le réglage de son module
R.operateurMachines = {};
for (const [id, type] of machines) {
  const eng = MB.MACHINE_ENGINES[id], def = MB.MACHINES.find((x) => x.id === id), mod = p.modules.find((x) => x.id === `mach_${id}`);
  const ks = carte.get(mod.id) || new Map(), pas = [], ok = [];
  for (const s of def.sections) for (const d of T.descripteursDe(s.id)) {
    const pos = I.positionDeControle(id, type, d);
    if (!pos.facette || !pos.branche) continue;
    const e = eng.map[d.id], spec = M.spec(type, e.param), x = ks.get(e.param);
    const want = borne(spec, e.from(T.normeDe(d, d.default + (mod.mach.ctl[d.id] - d.default) * 0.5)));
    if (!x || Math.abs(x.v - want) > 1e-6 * Math.max(1, Math.abs(want))) pas.push(`${d.id}→${e.param}`); else ok.push(d.id);
  }
  R.operateurMachines[id] = { ok: ok.length, pas };
}

// 5. le moteur : chaque réglage de la carte arrive au module, par son moyen, à l'instant de la tranche
const ctx = faux();
const g = new E.Graph(ctx, { buffers: new Map(), live() {}, ecoute: () => undefined });
let synced = null;
try { g.sync(p); synced = true; } catch (e) { synced = String(e && e.stack || e).slice(0, 400); }
R.sync = synced;
if (synced === true) {
  const recu = new Map(), instants = [];
  for (const [id, n] of g.nodes) {
    const upd = n.update.bind(n);
    n.update = (mm, bpm) => { for (const [k, v] of Object.entries(mm.params || {})) recu.set(`${id}:${k}`, { v, par: 'copie' }); return upd(mm, bpm); };
    if (n.setAt) { const sa = n.setAt.bind(n); n.setAt = (k, v, t) => { recu.set(`${id}:${k}`, { v, par: 'setAt', t }); return sa(k, v, t); }; }
  }
  const al = g.aLInstant.bind(g);
  g.aLInstant = (t, f) => { instants.push(t); return al(t, f); };
  recu.clear();
  g.automate(p, 1, 1.25, (b) => 10 + b);
  const pasRecu = [], moyens = {};
  for (const [mod, ks] of g._influence) for (const [k, o] of ks) {
    const r = recu.get(`${mod}:${k}`);
    const type = p.modules.find((x) => x.id === mod).type;
    if (!r || Math.abs(r.v - o.v) > 1e-9) pasRecu.push(`${type}.${k}`);
    else moyens[r.par] = (moyens[r.par] || 0) + 1;
  }
  R.moteur = { pasRecu, moyens, instants: [...new Set(instants)], entendus: [...g._influence.values()].reduce((s, m) => s + m.size, 0) };
  // l'arpège lit le module entendu ; une scène de jouet aussi (Graph.valeur)
  const syn = p.modules.find((x) => x.type === 'synth');
  R.arpege = { entendu: g.entendu(syn).params.arp_gate, carte: g._influence.get(syn.id)?.get('arp_gate')?.v, projet: syn.params.arp_gate };
  R.jouet = { valeur: g.valeur('m_pong', 'grav'), carte: g._influence.get('m_pong')?.get('grav')?.v };
  // le swing d'une batterie : un pas impair tombe à swing % de sa paire ; capté, le planificateur lit l'opérateur
  const coups = (sw) => { const t = []; g.notes({ kind: 'drums' }, { start: 0, len: 4 }, { steps: 16, lanes: { bd: Array(16).fill(1) } }, { hit: (v, at) => t.push(at) }, 0, 4, (b) => b, 0.5, null, sw); return t; };
  const dr = p.modules.find((x) => x.type === 'drums');
  R.swing = { droit: coups(50).slice(0, 3), ternaire: coups(66).slice(0, 3), entendu: E.swingDe(g.entendu(dr)), projet: E.swingDe(dr), carte: g._influence.get(dr.id)?.get('swing')?.v };
  // à l'arrêt, tout revient
  recu.clear();
  g.settle(p, 1);
  const pasRendu = [];
  for (const m of p.modules) {
    if (m.mach) continue;
    for (const s of M.MODULES[m.type].params) {
      if (!s.facette || !carte.get(m.id)?.has(s.k)) continue;
      const r = recu.get(`${m.id}:${s.k}`);
      if (!r || Math.abs(r.v - m.params[s.k]) > 1e-9) pasRendu.push(`${m.type}.${s.k}`);
    }
  }
  R.rendu = { pasRendu, influence: g._influence.size };
}
console.log(JSON.stringify(R));
"""


def essayer() -> dict:
    node = shutil.which("node")
    env = {**os.environ, "MUSIQUE_URL": (REPO / "musique").as_uri() + "/"}
    r = subprocess.run([node, "--input-type=module", "-e", ESSAI_JS], capture_output=True, text=True, timeout=120, env=env)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise RuntimeError(f"node : {r.returncode} {r.stderr.strip()[-600:]}") from None


def selftest(call, ok) -> None:
    st, js = call("GET", "/musique/facettes.js")
    ok(st == 200 and b"export function declarer" in (js if isinstance(js, bytes) else b""), f"attracteurs : la règle des facettes se sert à la page ({st})")
    if not shutil.which("node"):
        print("  (node absent : la garde des facettes n'est pas essayée ici)")
        return
    R = essayer()
    # 1. la garde
    ok(not R["sans"], "attracteurs, la garde : chaque réglage continu de chaque module a pris position (musique/facettes.js) — "
                      + "; ".join(f"{x['type']}.{x['k']} : {x['pourquoi']}" for x in R["sans"][:12]))
    # 2. la table
    T = R["table"]
    lus = {f"{t}.{k}": (f, d) for t, rows in T.items() for k, _s, f, d in rows}
    perdus = [k for k, f in TABLE_2909.items() if k in lus and not lus[k][1] and lus[k][0] != f]
    discrets = [k for k in TABLE_2909 if k in lus and lus[k][1]]
    ok(not perdus and sorted(discrets) == ["analog.wave", "synth.wave"],
       f"attracteurs, la table : chaque choix du 29/09 est gardé, seuls les deux réglages discrets sortent ({perdus} {discrets})")
    n = sum(len(r) for r in T.values())
    captes = sum(1 for r in T.values() for _k, _s, f, d in r if f)
    hors = [f"{t}.{k}" for t, r in T.items() for k, s, f, d in r if not f and not d]
    ok(captes >= 240 and all(R["sortes"].get(s) is None for t, r in T.items() for k, s, f, d in r if not f and not d),
       f"attracteurs, la table : {captes} réglages captés sur {n} ; chaque réglage continu hors attracteurs l'est par sa sorte ({len(hors)})")
    ok(all(any(f for _k, _s, f, _d in T[t]) for t in ("drums", "synth", "sampler", "delay", "reverb", "comp", "eq", "filter", "dist", "rythme",
                                                       "analog", "acid", "plaits", "macro", "reverbe", "chorus", "rtt", "comp3", "eq3", "filtre",
                                                       "satura", "crush", "table", "fount", "reel", "pong", "sprg", "mag", "horloge")),
       "attracteurs, la table : chaque instrument, chaque effet, chaque jouet a de quoi être capté (la console et le lecteur n'ont que des niveaux)")
    # 3. les machines
    mach = R["machines"]
    ok(all(not m["mauvais"] for m in mach.values()),
       f"attracteurs, les machines : chaque branchement vise un réglage du module qui porte le son ({ {k: m['mauvais'] for k, m in mach.items() if m['mauvais']} })")
    a3 = {row[0]: row for row in mach["a3"]["rows"]}
    ok(a3["a3_cut"][3] == "brillance" and a3["a3_cut"][4] and a3["a3_acc"][3] == "accents" and a3["a3_wv"][3] is None,
       f"attracteurs, les machines : l'ACID-3 prend les facettes de la basse acide qu'elle règle, son sélecteur d'onde est hors ({a3.get('a3_cut')} {a3.get('a3_acc')} {a3.get('a3_wv')})")
    ml = {row[0]: row for row in mach["ml"]["rows"]}
    ok(ml["ml_v2pitch"][3] == "tonalité" and ml["ml_v2pitch"][5] == "ODIO_01" and ml["ml_v1pitch"][3] == "tonalité" and not ml["ml_v1pitch"][4],
       "attracteurs, les machines : la table d'ODIO_01 décide d'abord ; un contrôle qu'elle nomme sans branchement est capté, pas entendu")
    om = R["operateurMachines"]
    ok(len(om) >= 10 and all(not v["pas"] for v in om.values()) and all(om[k]["ok"] for k in ("ml", "mf", "a3", "tr", "t3", "pl", "vm")),
       f"attracteurs, les machines : chaque contrôle capté et branché joue son opérateur sur le réglage de son module ({om})")
    # 4. l'opérateur
    op = R["operateur"]
    ok(not op["manque"] and not op["faux"], f"attracteurs, l'opérateur : chaque réglage capté de chaque sorte de module joue neutre + (valeur − neutre) × poids, "
                                            f"à son pas, et rien d'autre ({op['manque'][:8]} {op['faux'][:8]})")
    ok(not op["tenus"], f"attracteurs, l'opérateur : une voie d'automation et un câble de valeur gardent la main ({op['tenus']})")
    # 5. le moteur
    ok(R["sync"] is True, f"attracteurs, le moteur : un graphe de chaque sorte de module se monte ({R['sync']})")
    if R["sync"] is not True:
        return
    mo = R["moteur"]
    ok(not mo["pasRecu"] and mo["entendus"] > 250 and mo["moyens"].get("setAt") and mo["moyens"].get("copie"),
       f"attracteurs, le moteur : chaque réglage de la carte arrive à son module, par setParameter ou par la copie entendue ({mo})")
    ok(mo["instants"] == [11], f"attracteurs, le moteur : la copie d'un module natif est posée à l'instant de la tranche ({mo['instants']})")
    ar, jo = R["arpege"], R["jouet"]
    ok(ar["entendu"] == ar["carte"] and ar["entendu"] != ar["projet"], f"attracteurs, le moteur : l'arpège lit la durée entendue ({ar})")
    ok(jo["valeur"] == jo["carte"] and jo["valeur"] is not None, f"attracteurs, le moteur : une scène de jouet lit la valeur entendue ({jo})")
    sw = R["swing"]
    ok(sw["droit"] == [0, 0.25, 0.5] and abs(sw["ternaire"][1] - 0.33) < 1e-9 and sw["ternaire"][2] == 0.5,
       f"attracteurs, le swing : un pas impair tombe à swing % de sa paire, 50 droit, 66 ternaire ({sw['droit']} {sw['ternaire']})")
    ok(sw["entendu"] == sw["carte"] and sw["entendu"] != sw["projet"], f"attracteurs, le swing : capté (facette swing), le planificateur lit l'opérateur ({sw})")
    ok(not R["rendu"]["pasRendu"] and R["rendu"]["influence"] == 0, f"attracteurs, le moteur : à l'arrêt, chaque réglage reprend sa valeur ({R['rendu']})")
