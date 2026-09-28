#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Doublage d'un film dans une autre langue : chaque réplique traduite est dite par la voix de celui qui la dit,
clonée SUR L'EXTRAIT ORIGINAL DE LA MÊME RÉPLIQUE — c'est ce qui garde l'émotion et l'intonation du moment —, à la
durée de l'original, puis posée à son instant sur le fond sonore du film (musique, bruitages) séparé de la voix.

  ~/omnivoice-env/bin/python doublage.py --video film.mp4 --script doublage-zh.json \
      --voix vocals.flac --fond instrumental.flac -o sortie/

--script : format movie-analysis-doublage — lignes [{a, b, qui, texte, trad}] (qui dit quoi : ce que la timeline du
Studio a arrêté ; texte : la réplique d'origine, sert de transcription à l'extrait de référence).
Une réplique trop courte pour donner une voix (< 1,8 s) prend aussi les autres répliques du même personnage.

Modèle : OmniVoice (k2-fsa), clonage sans apprentissage, durée imposée. Chaque réplique est générée --essais fois ;
Whisper (large-v3-turbo) réécoute chaque version, et on garde celle qui dit le mieux le texte voulu — un clonage
rate parfois une phrase entière ou avale un nom propre, et rien d'autre ne le voit. Lancer d'abord gpu-libre.sh.
Environnement : ~/reelbench/doublage-env (OmniVoice par un .pth vers omnivoice-env, + openai-whisper, opencc).
"""
import argparse, json, os, re, subprocess, time
import numpy as np, soundfile as sf, torch
from omnivoice import OmniVoice, OmniVoiceGenerationConfig

ap = argparse.ArgumentParser()
ap.add_argument('--video', required=True)
ap.add_argument('--script', required=True)
ap.add_argument('--voix', required=True, help='la voix seule, séparée du film (BS-RoFormer)')
ap.add_argument('--fond', required=True, help='le fond sonore sans la voix')
ap.add_argument('-o', '--sortie', required=True)
ap.add_argument('--rythme', type=float, default=None, help='syllabes par seconde à ne pas dépasser (défaut : 4,8 en mandarin, 6 en anglais)')
ap.add_argument('--essais', type=int, default=3, help='versions générées par réplique ; Whisper les réécoute et garde la plus fidèle au texte')
ap.add_argument('--biais', type=float, default=0.0, help='à retrancher de la durée demandée (mesuré à 0 le 25/09 : OmniVoice rend la durée exacte)')
args = ap.parse_args()
os.makedirs(args.sortie, exist_ok=True)
S = json.load(open(args.script, encoding='utf-8'))
if args.rythme is None:
    args.rythme = {'zh': 4.8, 'en': 6.0}.get(S.get('langue'), 5.0)
L = S['lignes']


def mono(x):
    return x.mean(axis=1) if x.ndim == 2 else x


def reechantillonne(x, sr, vers):
    if sr == vers:
        return x.astype(np.float32)
    from scipy.signal import resample_poly
    g = np.gcd(int(sr), int(vers))
    return resample_poly(x, vers // g, sr // g, axis=0).astype(np.float32)


def rms(x):
    x = x[np.abs(x) > 1e-3]
    return float(np.sqrt(np.mean(x ** 2))) if len(x) else 0.0


t0 = time.time()
model = OmniVoice.from_pretrained('k2-fsa/OmniVoice', device_map='cuda:0', dtype=torch.float16)
SR = model.sampling_rate
print(f'modèle chargé en {time.time() - t0:.0f} s, {SR} Hz', flush=True)

v, srv = sf.read(args.voix, always_2d=False)
voix = reechantillonne(mono(v), srv, SR)
extrait = lambda a, b: voix[max(0, int((a - 0.05) * SR)):int((b + 0.05) * SR)]

# la voix de référence de chaque réplique : son propre extrait ; trop court, on y ajoute les autres répliques du même
# personnage (les plus longues d'abord) jusqu'à ~4 s
prompts, refs = [], []
for i, l in enumerate(L):
    morceaux, textes = [extrait(l['a'], l['b'])], [l['texte']]
    if l['b'] - l['a'] < 1.8 and l['qui']:
        autres = sorted((m for j, m in enumerate(L) if j != i and m['qui'] == l['qui']), key=lambda m: m['a'] - m['b'])
        for m in autres:
            if sum(len(x) for x in morceaux) / SR >= 4:
                break
            morceaux += [np.zeros(int(0.15 * SR), np.float32), extrait(m['a'], m['b'])]
            textes.append(m['texte'])
    ref = np.concatenate(morceaux)
    refs.append(round(len(ref) / SR, 2))
    prompts.append(model.create_voice_clone_prompt(ref_audio=(torch.from_numpy(ref), SR), ref_text=' '.join(textes)))
print(f'{len(prompts)} voix de référence ({", ".join(str(r) for r in refs)} s)', flush=True)

# La durée : celle de l'original (les lèvres bougent ce temps-là), mais une traduction plus longue a le droit de déborder
# dans le silence qui suit, jusqu'à la réplique suivante, plutôt que d'être dite trop vite pour être comprise.
def syllabes(t):
    cjk = len(re.findall(r'[㐀-鿿]', t))
    latin = sum(max(1, len(re.findall(r'[aeiouy]+', w.lower()))) for w in re.findall(r'[A-Za-z]+', t))
    return cjk + latin
debuts = sorted(l['a'] for l in L)
fin_film = len(voix) / SR
cible = []
for l in L:
    suivant = next((a for a in debuts if a > l['a'] + 1e-6), fin_film)
    place = max(0.4, suivant - l['a'] - 0.05)
    voulu = max(l['b'] - l['a'], syllabes(l['trad']) / args.rythme)
    cible.append(max(0.4, min(voulu, place) - args.biais))
cfg = OmniVoiceGenerationConfig(postprocess_output=False, pad_duration=0.0, fade_duration=0.0)
LANGUE, N, E = S.get('langue', 'zh'), len(L), max(1, args.essais)
t1 = time.time()
tous = model.generate(text=[l['trad'] for l in L] * E, language=[LANGUE] * N * E, duration=cible * E,
                      voice_clone_prompt=prompts * E, generation_config=cfg)
gen = time.time() - t1

# le juge : Whisper réécoute, on compare en caractères (sans ponctuation ; traditionnel ramené au simplifié)
try:
    import whisper
    juge = whisper.load_model('large-v3-turbo', device='cuda')
except ImportError:
    juge = None
try:
    import opencc
    simplifie = opencc.OpenCC('t2s').convert
except ImportError:
    simplifie = lambda t: t
import unicodedata
# « 5分钟 » écrit par Whisper = « 五分钟 » dit par la voix : en chinois, les chiffres isolés comptent comme leur caractère
_CHIFFRES = '零一二三四五六七八九'
_chiffres = (lambda t: re.sub(r'(?<![0-9A-Za-z])[0-9](?![0-9A-Za-z])', lambda m: _CHIFFRES[int(m.group(0))], t)) if S.get('langue') == 'zh' else (lambda t: t)
net = lambda t: ''.join(c for c in unicodedata.normalize('NFKC', _chiffres(simplifie(t))) if unicodedata.category(c)[0] in 'LN').lower()


def ecart(a, b):
    d = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        p, d[0] = d[0], i
        for j, y in enumerate(b, 1):
            p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (x != y))
    return d[len(b)]


audios, ecoutes = [], []
for i, l in enumerate(L):
    meilleur = None
    for k in range(E):
        a = np.asarray(tous[k * N + i], dtype=np.float32).reshape(-1)
        entendu = juge.transcribe(reechantillonne(a, SR, 16000), language=LANGUE, fp16=True, temperature=0,
                                  condition_on_previous_text=False)['text'].strip() if juge else ''
        e = ecart(net(l['trad']), net(entendu)) if juge else 0
        if meilleur is None or e < meilleur[0]:
            meilleur = (e, a, entendu, k)
    audios.append(meilleur[1])
    ecoutes.append({'entendu': meilleur[2], 'ecart': meilleur[0], 'caracteres': len(net(l['trad'])), 'version': meilleur[3] + 1})

f, srf = sf.read(args.fond, always_2d=True)
mix = f.astype(np.float32).copy()
seule = np.zeros_like(mix)
pistes = {}   # une piste de voix par personnage ('' : personne à l'image)
mesures = []
for i, (l, a) in enumerate(zip(L, audios)):
    sf.write(os.path.join(args.sortie, f'{i + 1:02d}.wav'), a, SR)
    # même niveau que la voix d'origine sur cette réplique
    ro, rd = rms(extrait(l['a'], l['b'])), rms(a)
    gain = float(np.clip(ro / rd, 0.3, 3.0)) if ro and rd else 1.0
    y = reechantillonne(a * gain, SR, srf)
    p = int(l['a'] * srf)
    n = min(len(y), len(mix) - p)
    if n > 0:
        mix[p:p + n] += y[:n, None]
        seule[p:p + n] += y[:n, None]
        pistes.setdefault(l['qui'], np.zeros_like(mix))[p:p + n] += y[:n, None]
    mesures.append({'a': l['a'], 'b': l['b'], 'qui': l['qui'], 'trad': l['trad'], 'original_s': round(l['b'] - l['a'], 2), 'demande_s': round(cible[i], 2), 'syllabes_s': round(syllabes(l['trad']) / max(0.1, len(a) / SR), 1),
                    'obtenu_s': round(len(a) / SR, 2), 'ecart_s': round(len(a) / SR - (l['b'] - l['a']), 2), 'reference_s': refs[i], 'gain': round(gain, 2), **ecoutes[i]})
crete = float(np.abs(mix).max())
k = 0.99 / crete if crete > 0.99 else 1.0
mix *= k
wav = os.path.join(args.sortie, 'doublage.wav')
sf.write(wav, mix, srf)
# les pistes, à la même échelle que le mixage : fond + toutes les voix = doublage.wav
sf.write(os.path.join(args.sortie, 'voix-seule.wav'), seule * k, srf)
sf.write(os.path.join(args.sortie, 'fond.wav'), f.astype(np.float32) * k, srf)
for qui, x in pistes.items():
    sf.write(os.path.join(args.sortie, f'voix-{qui or "personne"}.wav'), x * k, srf)
# les mots de chaque réplique retenue, à leur instant (le sous-titre du Studio les souligne quand on les entend)
if juge:
    from doublage_mots import mots_du_doublage
    wavs = [os.path.join(args.sortie, f'{i + 1:02d}.wav') for i in range(len(L))]
    json.dump(mots_du_doublage(juge, simplifie, L, LANGUE, wavs), open(os.path.join(args.sortie, 'mots.json'), 'w'), ensure_ascii=False, indent=1)
base = os.path.splitext(os.path.basename(args.video))[0]
mp4 = os.path.join(args.sortie, f'{base}-{S.get("langue", "zh")}.mp4')
subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', args.video, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
                '-c:a', 'aac', '-b:a', '192k', '-shortest', mp4], check=True)
duree = sum(m['obtenu_s'] for m in mesures)
tc = sum(e['caracteres'] for e in ecoutes)
taux = round(100 * sum(e['ecart'] for e in ecoutes) / max(1, tc), 1)
json.dump({'modele': 'k2-fsa/OmniVoice', 'juge': 'whisper large-v3-turbo' if juge else None, 'essais': E, 'erreur_caracteres_pct': taux, 'machine': os.uname().nodename, 'generation_s': round(gen, 1), 'audio_s': round(duree, 1),
           'lignes': mesures}, open(os.path.join(args.sortie, 'mesures.json'), 'w'), ensure_ascii=False, indent=1)
for m in mesures:
    print(f"{m['a']:6.2f}  {m['qui'] or '—':4}  original {m['original_s']:5.2f}  obtenu {m['obtenu_s']:5.2f}  ({m['ecart_s']:+.2f})  {m['syllabes_s']:4.1f} syl/s  réf {m['reference_s']:4.1f} s  v{m['version']} écart {m['ecart']}/{m['caracteres']}  {m['trad']}  ← {m['entendu']}")
print(f'généré en {gen:.1f} s ({E} versions) pour {duree:.1f} s de voix ; Whisper : {taux} % d’erreur en caractères ; crête {crete:.2f} → {mp4}', flush=True)
