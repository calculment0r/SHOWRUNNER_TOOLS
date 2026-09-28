#!/usr/bin/env python3
"""
Combien de voix, et laquelle parle quand — en local, sans jeton.

    pyannote demande un jeton Hugging Face sur un dépôt verrouillé. Ici rien de
    tel : ECAPA-TDNN (speechbrain/spkrec-ecapa-voxceleb, public) donne une
    empreinte vocale, et le regroupement sous seuil dit combien de personnes
    parlent. Les bornes de parole viennent de la transcription déjà dans le
    document — inutile de redétecter la voix, on sait où elle est.

    Le découpage en fenêtres compte : une réplique n'est pas forcément d'un seul
    tenant, et une étiquette posée sur toute une réplique fond deux personnes
    dès qu'on se coupe la parole. On embarque par fenêtres de ~1,5 s, on
    regroupe les fenêtres, puis chaque réplique reçoit la voix majoritaire de
    ses fenêtres — et on DIT quand une réplique est partagée.

    python diarize-local.py video.mp4 shots.json turns.json [--seuil 0.55]

Sortie : { turns: [ {start, end, speaker} ], speakers: n, partagees: [...] }
à passer à lips-run.py, qui dira quelle bouche porte quelle voix.
"""
import argparse, json, os, subprocess, sys, tempfile
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("video"); ap.add_argument("shots"); ap.add_argument("out")
ap.add_argument("--seuil", type=float, default=0.55, help="distance cosinus max entre deux fenêtres d'une même voix")
ap.add_argument("--fenetre", type=float, default=1.5)
ap.add_argument("--saut", type=float, default=0.75)
ap.add_argument("--min-fenetre", type=float, default=0.45, help="en deçà, l'empreinte n'est pas fiable")
ap.add_argument("--essai", action="store_true", help="n'écrit rien : montre combien de voix chaque seuil donnerait, et les distances mesurées")
ap.add_argument("--audio", help="prendre le son ici plutôt que dans la vidéo — typiquement la voix seule, séparée par demucs")
args = ap.parse_args()

doc = json.load(open(args.shots, encoding="utf-8"))

# Les répliques, une seule fois : le document les range dans chaque plan couvert.
vu, repliques = set(), []
for s in doc.get("shots", []):
    for l in s.get("lines", []):
        cle = (l["start"], l["end"])
        if cle in vu: continue
        vu.add(cle); repliques.append({"start": l["start"], "end": l["end"], "text": l.get("text", "")})
repliques.sort(key=lambda r: r["start"])
if not repliques:
    print("aucune réplique dans le document", file=sys.stderr); sys.exit(1)

# ------------------------------------------------------------------ l'audio --
tmp = tempfile.mkdtemp()
wav = os.path.join(tmp, "a.wav")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", args.audio or args.video, "-ac", "1", "-ar", "16000", "-vn", wav], check=True)
import soundfile as sf
son, sr = sf.read(wav, dtype="float32")
if son.ndim > 1: son = son.mean(axis=1)

import torch
from speechbrain.inference.speaker import EncoderClassifier
device = "cuda" if torch.cuda.is_available() else "cpu"
enc = EncoderClassifier.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb",
    savedir=os.path.expanduser("~/reelbench/models/ecapa"),
    run_opts={"device": device},
)
print(f"{len(repliques)} répliques, empreintes ECAPA sur {device}", file=sys.stderr)

@torch.no_grad()
def empreinte(a, b):
    i0, i1 = int(a * sr), int(b * sr)
    x = son[max(0, i0):min(len(son), i1)]
    if len(x) < int(args.min_fenetre * sr): return None
    v = enc.encode_batch(torch.from_numpy(x).unsqueeze(0).to(device)).squeeze().cpu().numpy()
    n = np.linalg.norm(v)
    return v / n if n > 0 else None

fenetres = []   # (indice de réplique, début, fin, empreinte)
for k, r in enumerate(repliques):
    t, fin = r["start"], r["end"]
    if fin - t <= args.fenetre:
        v = empreinte(t, fin)
        if v is not None: fenetres.append((k, t, fin, v))
        continue
    while t < fin - args.min_fenetre:
        b = min(fin, t + args.fenetre)
        v = empreinte(t, b)
        if v is not None: fenetres.append((k, t, b, v))
        t += args.saut

if not fenetres:
    print("aucune fenêtre exploitable", file=sys.stderr); sys.exit(1)

# ------------------------------------------------------- combien de voix ? --
# Seuil plutôt que nombre imposé : on ne sait pas d'avance combien de personnes
# parlent, et c'est justement la question.
from sklearn.cluster import AgglomerativeClustering
X = np.stack([f[3] for f in fenetres])

if args.essai:
    # Le seuil ne se devine pas : il dépend du mixage. On regarde les distances
    # mesurées et ce que chaque seuil donnerait, et on choisit en connaissance.
    D = 1.0 - (X @ X.T)
    hd = np.array([D[i, j] for i in range(len(X)) for j in range(i + 1, len(X))])
    intra = [D[i, j] for i in range(len(X)) for j in range(i + 1, len(X)) if fenetres[i][0] == fenetres[j][0]]
    print(f"{len(X)} fenêtres · distances : min {hd.min():.2f}  médiane {np.median(hd):.2f}  max {hd.max():.2f}", file=sys.stderr)
    if intra:
        print(f"   dans une même réplique (donc a priori la même voix) : médiane {np.median(intra):.2f}  max {max(intra):.2f}", file=sys.stderr)
    for s in [x / 100 for x in range(40, 125, 5)]:
        n = len(set(AgglomerativeClustering(n_clusters=None, distance_threshold=s, metric="cosine", linkage="average").fit_predict(X)))
        print(f"   seuil {s:.2f} → {n} voix", file=sys.stderr)
    # Le plus proche voisin de chaque fenêtre : c'est là qu'on voit, texte en main,
    # si la mesure rapproche vraiment deux fois la même personne.
    print("plus proche voisin de chaque réplique :", file=sys.stderr)
    for i in range(len(X)):
        d = D[i].copy(); d[i] = 9
        j = int(np.argmin(d))
        print(f"   {fenetres[i][1]:6.2f}s « {repliques[fenetres[i][0]]['text'][:42]:<42} »  →  {d[j]:.2f}  « {repliques[fenetres[j][0]]['text'][:42]} »", file=sys.stderr)
    sys.exit(0)

if len(X) == 1:
    lab = np.array([0])
else:
    lab = AgglomerativeClustering(n_clusters=None, distance_threshold=args.seuil,
                                  metric="cosine", linkage="average").fit_predict(X)

# Étiquettes stables : SPEAKER_00 est la voix la plus présente.
duree = {}
for (k, a, b, _), c in zip(fenetres, lab):
    duree[c] = duree.get(c, 0.0) + (b - a)
ordre = {c: i for i, (c, _) in enumerate(sorted(duree.items(), key=lambda kv: -kv[1]))}
nom = {c: f"SPEAKER_{ordre[c]:02d}" for c in duree}

# ------------------------------------------- une voix par réplique, et le doute --
partagees = []
turns = []
for k, r in enumerate(repliques):
    mien = [(nom[c], b - a) for (kk, a, b, _), c in zip(fenetres, lab) if kk == k]
    if not mien:
        continue
    poids = {}
    for v, d in mien: poids[v] = poids.get(v, 0.0) + d
    gagnant = max(poids, key=poids.get)
    part = poids[gagnant] / sum(poids.values())
    turns.append({"start": r["start"], "end": r["end"], "speaker": gagnant})
    if part < 0.8 and len(poids) > 1:
        partagees.append({"start": r["start"], "end": r["end"], "voix": poids, "retenue": gagnant,
                          "texte": r["text"][:60]})

json.dump({"turns": turns, "speakers": len(nom), "partagees": partagees}, open(args.out, "w"), indent=1)
print(f"{len(nom)} voix distinctes sur {len(fenetres)} fenêtres → {args.out}", file=sys.stderr)
for v in sorted(set(t["speaker"] for t in turns)):
    d = sum(t["end"] - t["start"] for t in turns if t["speaker"] == v)
    n = sum(1 for t in turns if t["speaker"] == v)
    print(f"   {v} : {n} réplique(s), {d:.1f} s", file=sys.stderr)
if partagees:
    print(f"{len(partagees)} réplique(s) partagée(s) entre deux voix — la transcription y colle deux personnes :", file=sys.stderr)
    for p in partagees:
        print(f"   {p['start']:.2f}→{p['end']:.2f}  " + ", ".join(f"{v} {d:.1f}s" for v, d in sorted(p["voix"].items(), key=lambda kv: -kv[1])) + f"  « {p['texte']} »", file=sys.stderr)
