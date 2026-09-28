#!/usr/bin/env python3
"""
Qui parle — la bouche qui bouge EN MESURE avec le son, pas celle qui bouge le plus.

    L'erreur de la version précédente tient en une ligne : `speaker = max(scores)`,
    où le score était l'agitation de la bouche. Un auditeur bouge la bouche. Un
    contre-champ montre celui qui écoute. On élisait donc l'auditeur, et une voix
    off finissait toujours sur quelqu'un.

    Ce qui distingue vraiment un locuteur, c'est la SYNCHRONIE : sa bouche bouge
    quand le son monte, et se tait quand le son s'arrête. C'est le principe de
    SyncNet, mesuré ici directement — corrélation entre le mouvement de la bouche,
    image par image, et l'enveloppe du son sur la même fenêtre.

    Trois régimes, et chacun est dit dans `how` :
      · une bouche à l'image est synchrone   → c'est elle, « vue et entendue »
      · aucune bouche synchrone, mais cette voix a déjà été vue ailleurs dans le
        film (empreinte ECAPA)               → c'est la même personne, hors champ
      · aucune bouche, aucune voix connue    → voix off, attribuée à PERSONNE

    python qui-parle.py video.mp4 shots.json tracks.json [--audio voix.wav] [-o shots.json]
"""
import argparse, json, os, subprocess, sys, tempfile
import numpy as np
import cv2
import torch
from PIL import Image
from facenet_pytorch import MTCNN

ap = argparse.ArgumentParser()
ap.add_argument("video"); ap.add_argument("shots"); ap.add_argument("tracks")
ap.add_argument("--audio", help="son à analyser — par défaut celui de la vidéo, que le modèle attend tel quel")
ap.add_argument("--asd", default=os.path.expanduser("~/reelbench/models/Light-ASD"), help="dépôt Light-ASD (le modèle et ses poids)")
ap.add_argument("--poids", default="weight/finetuning_TalkSet.model")
ap.add_argument("--min-score", type=float, default=0.0, help="score minimal du détecteur pour dire qu'une bouche porte la voix (il sort un log-rapport : 0 = indécis)")
ap.add_argument("--marge", type=float, default=0.30, help="écart minimal avec la deuxième bouche quand plusieurs sont mesurables")
ap.add_argument("--lien-voix", type=float, default=0.70, help="distance cosinus max entre deux empreintes pour dire « même voix »")
ap.add_argument("--min-images", type=int, default=8)
ap.add_argument("-o", "--out")
args = ap.parse_args()

doc = json.load(open(args.shots, encoding="utf-8"))
tr = json.load(open(args.tracks)); fps = tr.get("fps", 25.0)
person_of_track = {int(t): c["id"] for c in doc.get("cast", []) for t in c.get("tracks", [])}
noms = {c["id"]: c["name"] for c in doc.get("cast", [])}
boxes_at = {}
for tid, track in tr["tracks"].items():
    pid = person_of_track.get(int(tid))
    if pid is None: continue
    for d in track: boxes_at.setdefault(int(round(d["t"] * fps)), []).append((pid, d["box"]))

# Les répliques, une seule fois : le document les range dans chaque plan couvert.
vu, repliques = set(), []
for s in doc.get("shots", []):
    for l in s.get("lines", []):
        cle = (l["start"], l["end"])
        if cle in vu: continue
        vu.add(cle); repliques.append(dict(l))
repliques.sort(key=lambda r: r["start"])

# ------------------------------------------------------------ l'enveloppe --
tmp = tempfile.mkdtemp(); wav = os.path.join(tmp, "a.wav")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", args.audio or args.video, "-ac", "1", "-ar", "16000", "-vn", wav], check=True)
import soundfile as sf
son, sr = sf.read(wav, dtype="float32")
if son.ndim > 1: son = son.mean(axis=1)
# une valeur par image : l'énergie du son sur la durée de l'image
pas = sr / fps
env = np.array([float(np.sqrt(np.mean(np.square(son[int(i * pas):int((i + 1) * pas)] + 1e-9)))) for i in range(int(len(son) / pas))])
print(f"{len(repliques)} répliques · enveloppe sur {len(env)} images à {fps:.2f} i/s", file=sys.stderr)

device = "cuda" if torch.cuda.is_available() else "cpu"
mtcnn = MTCNN(keep_all=False, device=device, min_face_size=24)
cap = cv2.VideoCapture(args.video)

# ------------------------------------------------------- le detecteur de locuteur --
# Light-ASD, entraine sur AVA-ActiveSpeaker puis TalkSet : il regarde le visage ET
# entend le son, et dit si CE visage parle. Une correlation faite a la main entre
# l'agitation de la bouche et l'enveloppe du son ne suffisait pas — mesuree sur cette
# pub, elle donnait ±0.00 partout. Ce modele-la est fait pour ca.
sys.path.insert(0, args.asd)
from ASD import ASD                      # noqa: E402
import python_speech_features             # noqa: E402
asd = ASD()
asd.loadParameters(os.path.join(args.asd, args.poids))
asd.eval()
print(f"Light-ASD chargé ({args.poids}) sur {device}", file=sys.stderr)

CS = 0.40   # le cadrage que le modele attend : le visage, plus 40 % de marge
def visage(img, box):
    """Boîte du VISAGE en coordonnées pleine image, cherchée dans la boîte du corps."""
    x1, y1, x2, y2 = [max(0, int(v)) for v in box]
    crop = img[y1:y1 + int((y2 - y1) * 0.6), x1:x2]
    if crop.size == 0 or crop.shape[0] < 24: return None
    try:
        fb, prob = mtcnn.detect(Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)))
    except Exception:
        return None
    if fb is None or prob is None or prob[0] is None or prob[0] < 0.80: return None
    fx1, fy1, fx2, fy2 = fb[0]
    return (x1 + fx1, y1 + fy1, x1 + fx2, y1 + fy2)

def vignette(img, fb):
    """Le cadrage de Light-ASD : 224x224 autour du visage, puis le centre 112x112 en gris."""
    fx1, fy1, fx2, fy2 = fb
    bs = max(fy2 - fy1, fx2 - fx1) / 2
    bsi = int(bs * (1 + 2 * CS))
    if bsi < 2: return None
    pad = np.pad(img, ((bsi, bsi), (bsi, bsi), (0, 0)), "constant", constant_values=(110, 110))
    my, mx = (fy1 + fy2) / 2 + bsi, (fx1 + fx2) / 2 + bsi
    f = pad[int(my - bs):int(my + bs * (1 + 2 * CS)), int(mx - bs * (1 + CS)):int(mx + bs * (1 + CS))]
    if f.size == 0: return None
    g = cv2.cvtColor(cv2.resize(f, (224, 224)), cv2.COLOR_BGR2GRAY)
    return g[56:168, 56:168]

@torch.no_grad()
def parle(vignettes, a, b):
    """Score moyen du détecteur : > 0 = ce visage parle pendant cette réplique."""
    mfcc = python_speech_features.mfcc(
        (son[max(0, int(a * sr)):min(len(son), int(b * sr))] * 32768).astype(np.int16), sr, numcep=13, winlen=0.025, winstep=0.010)
    # Le frontal audio divise par 4 : il faut EXACTEMENT 4 trames de MFCC par image,
    # sinon les deux branches ne se rejoignent pas (vu : 79 contre 76).
    nv = min(len(vignettes), mfcc.shape[0] // 4)
    na = nv * 4
    if nv < 8: return None
    A = torch.FloatTensor(mfcc[:na, :]).unsqueeze(0).to(device)
    V = torch.FloatTensor(np.stack(vignettes[:nv]).astype(np.float32)).unsqueeze(0).to(device)
    out = asd.model.forward_audio_visual_backend(asd.model.forward_audio_frontend(A), asd.model.forward_visual_frontend(V))
    return float(np.mean(np.array(asd.lossAV.forward(out, labels=None), dtype=np.float64)))

# --------------------------------------------- une bouche porte-t-elle la voix ? --
for r in repliques:
    f0, f1 = int(round(r["start"] * fps)), int(round(r["end"] * fps))
    suites, dernier = {}, {}
    for f in range(f0, f1 + 1):
        gens = boxes_at.get(f, [])
        cap.set(cv2.CAP_PROP_POS_FRAMES, f); ok, img = cap.read()
        if not ok: continue
        for pid, box in gens:
            fb = visage(img, box)
            v = vignette(img, fb) if fb is not None else None
            # un trou d'une image ou deux (detection ratee) : on prolonge la derniere,
            # sinon la suite se decale du son et le detecteur ne peut plus rien dire
            if v is None: v = dernier.get(pid)
            if v is None: continue
            dernier[pid] = v
            suites.setdefault(pid, []).append(v)
    scores = {}
    for pid, vs in suites.items():
        if len(vs) < args.min_images: continue
        sc = parle(vs, r["start"], r["end"])
        if sc is not None: scores[pid] = round(sc, 2)
    r["_scores"] = scores
    ordre = sorted(scores.items(), key=lambda kv: -kv[1])
    r["_vu"] = None
    if ordre and ordre[0][1] > args.min_score:
        second = ordre[1][1] if len(ordre) > 1 else -99.0
        if ordre[0][1] - second >= args.marge: r["_vu"] = ordre[0][0]
    detail = ", ".join(f"{p} {v:+.2f}" for p, v in ordre) or "aucun visage mesurable"
    print(f"   {r['start']:6.2f}→{r['end']:6.2f}  {detail}" + (f"   → {r['_vu']}" if r["_vu"] else "   → personne à l'image ne la porte"), file=sys.stderr)

# ------------------------------------- la voix, pour ce que la bouche n'a pas dit --
# Une réplique hors champ appartient quand même à quelqu'un, si cette voix a été
# VUE ailleurs dans le film. On ne devine pas : on rapproche deux empreintes.
from speechbrain.inference.speaker import EncoderClassifier
enc = EncoderClassifier.from_hparams(source="speechbrain/spkrec-ecapa-voxceleb",
                                     savedir=os.path.expanduser("~/reelbench/models/ecapa"),
                                     run_opts={"device": device})

@torch.no_grad()
def empreinte(a, b):
    x = son[max(0, int(a * sr)):min(len(son), int(b * sr))]
    if len(x) < int(0.5 * sr): return None
    v = enc.encode_batch(torch.from_numpy(x).unsqueeze(0).to(device)).squeeze().cpu().numpy()
    n = np.linalg.norm(v)
    return v / n if n > 0 else None

for r in repliques: r["_emp"] = empreinte(r["start"], r["end"])
ancres = [r for r in repliques if r["_vu"] and r["_emp"] is not None]
print(f"{len(ancres)} réplique(s) ancrée(s) par une bouche synchrone, sur {len(repliques)}", file=sys.stderr)

for r in repliques:
    if r["_vu"]:
        r["speaker"] = r["_vu"]
        r["how"] = f"vue et entendue (synchronie {r['_scores'][r['_vu']]:+.2f})"
        continue
    r["speaker"] = None
    r["how"] = "voix off (aucune bouche à l'image ne la porte)"
    if r["_emp"] is None or not ancres: continue
    proches = sorted(((1.0 - float(r["_emp"] @ a["_emp"]), a) for a in ancres), key=lambda kv: kv[0])
    d, a = proches[0]
    # il faut aussi que la deuxième personne la plus proche soit NETTEMENT plus loin,
    # sinon l'empreinte ne tranche rien et on préfère ne rien dire
    autre = next((dd for dd, aa in proches if aa["_vu"] != a["_vu"]), 9.0)
    if d <= args.lien_voix and autre - d >= 0.05:
        r["speaker"] = a["_vu"]
        r["how"] = f"hors champ — même voix qu'à {a['start']:.1f} s (distance {d:.2f})"
    else:
        r["how"] = f"voix off (aucune bouche ; voix la plus proche à {d:.2f}, pas assez sûre)"

# ------------------------------------------------------------- dans le document --
par_cle = {(r["start"], r["end"]): r for r in repliques}
for s in doc.get("shots", []):
    for l in s.get("lines", []):
        r = par_cle.get((l["start"], l["end"]))
        if not r: continue
        l["speaker"] = r["speaker"]; l["how"] = r["how"]
    if s.get("lines"):
        s["audio"] = " / ".join(f"{noms.get(l['speaker'], '?') if l['speaker'] else '?'} : {l['text']}" for l in s["lines"])

doc["voices"] = {}
doc.setdefault("provenance", {})["speakers"] = "synchronie bouche/son (SyncNet-like) ; hors champ recolle par empreinte ECAPA ; sinon voix off, non attribuee"
json.dump(doc, open(args.out or args.shots, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

vus = sum(1 for r in repliques if r["how"].startswith("vue"))
hors = sum(1 for r in repliques if r["how"].startswith("hors champ"))
off = len(repliques) - vus - hors
print(f"\n{vus} vue(s) et entendue(s), {hors} hors champ recollee(s) par la voix, {off} voix off non attribuee(s)", file=sys.stderr)
for r in repliques:
    qui = noms.get(r["speaker"], r["speaker"]) if r["speaker"] else "—"
    print(f"   {r['start']:6.2f}  {qui:<38} {r['how']}", file=sys.stderr)
