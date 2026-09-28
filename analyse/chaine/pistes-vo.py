#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""La version originale en pistes : la voix séparée du film (BS-RoFormer) coupée par personnage, selon qui dit quoi
(le script de doublage : lignes [{a, b, qui}], ce que la timeline du Studio a arrêté).

  python pistes-vo.py --voix vocals.flac --fond instrumental.flac --script doublage-zh.json -o sortie/

Écrit voix-<P>.wav (une par personnage, « personne » pour la voix sans visage), voix-autres.wav (ce que la voix
séparée contient hors des répliques : souffles, cris, rires) et fond.wav. Somme des voix = la voix séparée, exactement.
Pas de GPU : du découpage.
"""
import argparse, json, os
import numpy as np, soundfile as sf

ap = argparse.ArgumentParser()
ap.add_argument('--voix', required=True)
ap.add_argument('--fond', required=True)
ap.add_argument('--script', required=True)
ap.add_argument('-o', '--sortie', required=True)
ap.add_argument('--marge', type=float, default=0.08, help='la réplique déborde de ses bornes de Whisper (s)')
ap.add_argument('--fondu', type=float, default=0.02, help='fondu aux coupes (s)')
args = ap.parse_args()
os.makedirs(args.sortie, exist_ok=True)

v, sr = sf.read(args.voix, always_2d=True)
f, srf = sf.read(args.fond, always_2d=True)
assert sr == srf, 'voix et fond au même taux'
n = len(v)
L = sorted(json.load(open(args.script, encoding='utf-8'))['lignes'], key=lambda l: l['a'])

# les bornes de chaque réplique, élargies de la marge ; deux répliques qui se touchent se partagent le milieu
bornes = []
for i, l in enumerate(L):
    a, b = l['a'] - args.marge, l['b'] + args.marge
    if i > 0:
        a = max(a, (L[i - 1]['b'] + l['a']) / 2)
    if i + 1 < len(L):
        b = min(b, (l['b'] + L[i + 1]['a']) / 2)
    bornes.append((max(0.0, a), min(n / sr, b)))

masques = {}
rampe = max(1, int(args.fondu * sr))
for l, (a, b) in zip(L, bornes):
    m = masques.setdefault(l['qui'], np.zeros(n, np.float32))
    i0, i1 = int(a * sr), int(b * sr)
    w = np.ones(i1 - i0, np.float32)
    r = min(rampe, len(w) // 2)
    if r:
        w[:r] = np.linspace(0, 1, r); w[-r:] = np.linspace(1, 0, r)
    m[i0:i1] = np.maximum(m[i0:i1], w)
total = np.clip(sum(masques.values()), 0, 1)
for qui, m in masques.items():
    sf.write(os.path.join(args.sortie, f'voix-{qui or "personne"}.wav'), v * m[:, None], sr)
sf.write(os.path.join(args.sortie, 'voix-autres.wav'), v * (1 - total)[:, None], sr)
sf.write(os.path.join(args.sortie, 'fond.wav'), f, sr)
print(f"{len(masques)} personnages ({', '.join(q or 'personne' for q in masques)}) + autres + fond → {args.sortie}")
