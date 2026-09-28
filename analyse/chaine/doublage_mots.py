#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Les mots d'un doublage à leur instant : Whisper réécoute chaque réplique générée avec l'horodatage de chaque mot,
et ses temps sont reportés sur NOTRE texte (la traduction voulue), aligné par la plus longue sous-suite commune — un
homophone mal écrit par Whisper (订/定) garde ainsi le bon caractère à l'écran.

  python doublage_mots.py --script doublage-zh.json --dossier zh      → zh/mots.json

Le dossier est la sortie de doublage.py (01.wav, 02.wav… : la version retenue de chaque réplique, dans l'ordre du
script). mots.json : [{a, b, mots: [[texte, début, fin], …]}] en secondes du film. Unités : un idéogramme en chinois
(un mot latin reste entier), un mot ailleurs ; la ponctuation suit l'unité d'avant.
"""
import argparse, json, os, re, unicodedata
import numpy as np, soundfile as sf

CJK = re.compile(r'[㐀-鿿]')


def unites(texte, langue):
    """Le texte découpé en unités d'affichage (chaque unité garde son espace de tête s'il y en a un)."""
    out = []
    if langue == 'zh':
        for m in re.finditer(r'[A-Za-z0-9][A-Za-z0-9\'’.-]*|[㐀-鿿]|\s+|.', texte):
            t = m.group(0)
            if t.isspace():
                if out: out.append(' ')   # un espace à reporter sur l'unité suivante
                continue
            if out and out[-1] == ' ':
                out[-1] = ' ' + t
            elif out and not re.search(r'[\w㐀-鿿]', t):
                out[-1] += t
            else:
                out.append(t)
        return [u for u in out if u.strip()]
    for w in texte.split():
        if out and not re.search(r'\w', w):
            out[-1] += ' ' + w
        else:
            out.append((' ' if out else '') + w)
    return out


def cle_de(simplifie):
    return lambda t: ''.join(c for c in unicodedata.normalize('NFKC', simplifie(t)) if unicodedata.category(c)[0] in 'LN').lower()


def aligne(cibles, entendus, cle, debut, fin):
    """cibles : unités voulues ; entendus : [(texte, a, b)] de Whisper. Rend [(unité, a, b)]."""
    A, B = [cle(x[0]) for x in entendus], [cle(u) for u in cibles]
    n, k = len(A), len(B)
    L = [[0] * (k + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(k - 1, -1, -1):
            L[i][j] = L[i + 1][j + 1] + 1 if A[i] and A[i] == B[j] else max(L[i + 1][j], L[i][j + 1])
    paires, i, j = [], 0, 0
    while i < n and j < k:
        if A[i] and A[i] == B[j]: paires.append((i, j)); i += 1; j += 1
        elif L[i + 1][j] >= L[i][j + 1]: i += 1
        else: j += 1
    paires.append((n, k))
    out, i0, j0 = [], 0, 0
    for i1, j1 in paires:
        if j1 > j0:   # des unités sans correspondance : le temps des mots entendus à leur place, sinon le blanc entre ancres
            a = entendus[i0][1] if i1 > i0 else (entendus[i0 - 1][2] if i0 > 0 else debut)
            b = entendus[i1 - 1][2] if i1 > i0 else (entendus[i1][1] if i1 < n else fin)
            lg = [len(cle(u)) or 1 for u in cibles[j0:j1]]
            t, d = a, max(0.0, b - a)
            for j, l in zip(range(j0, j1), lg):
                dt = d * l / sum(lg)
                out.append((cibles[j], t, max(t + dt, t + 0.02))); t += dt
        if i1 < n:
            out.append((cibles[j1], entendus[i1][1], entendus[i1][2]))
        i0, j0 = i1 + 1, j1 + 1
    return out


def mots_du_doublage(juge, simplifie, lignes, langue, wavs):
    cle = cle_de(simplifie)
    res = []
    for l, w in zip(lignes, wavs):
        x, sr = sf.read(w)
        x = x.mean(axis=1) if x.ndim == 2 else x
        if sr != 16000:
            from scipy.signal import resample_poly
            g = np.gcd(sr, 16000); x = resample_poly(x, 16000 // g, sr // g)
        r = juge.transcribe(x.astype(np.float32), language=langue, fp16=True, temperature=0, word_timestamps=True,
                            condition_on_previous_text=False)
        entendus = []
        for seg in r.get('segments', []):
            for m in seg.get('words', []):
                t = m['word'].strip()
                if langue == 'zh' and len(t) > 1:   # un « mot » de Whisper en chinois : plusieurs caractères, le temps partagé
                    parts = re.findall(r'[A-Za-z0-9][A-Za-z0-9\'’.-]*|.', t)
                    d = (m['end'] - m['start']) / max(1, len(parts))
                    entendus += [(p, m['start'] + q * d, m['start'] + (q + 1) * d) for q, p in enumerate(parts)]
                else:
                    entendus.append((t, m['start'], m['end']))
        duree = len(x) / 16000
        u = unites(l['trad'], langue)
        res.append({'a': l['a'], 'b': l['b'], 'mots': [[t, round(l['a'] + a, 3), round(l['a'] + min(b, duree), 3)] for t, a, b in aligne(u, entendus, cle, 0.0, duree)]})
    return res


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--script', required=True)
    ap.add_argument('--dossier', required=True)
    args = ap.parse_args()
    S = json.load(open(args.script, encoding='utf-8'))
    import whisper
    try:
        import opencc; simplifie = opencc.OpenCC('t2s').convert
    except ImportError:
        simplifie = lambda t: t
    juge = whisper.load_model('large-v3-turbo', device='cuda')
    wavs = [os.path.join(args.dossier, f'{i + 1:02d}.wav') for i in range(len(S['lignes']))]
    res = mots_du_doublage(juge, simplifie, S['lignes'], S.get('langue', 'zh'), wavs)
    json.dump(res, open(os.path.join(args.dossier, 'mots.json'), 'w'), ensure_ascii=False, indent=1)
    for r in res:
        print(f"{r['a']:6.2f}  " + ' '.join(f"{m[0].strip()}@{m[1] - r['a']:.2f}" for m in r['mots']))
