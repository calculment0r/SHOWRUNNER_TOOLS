#!/usr/bin/env python3
"""
Voix → personnage par les lèvres.

    La diarisation dit QUAND chaque voix parle ; le visage dit QUI est à
    l'image. Entre les deux, le champ/contre-champ ment : pendant qu'une voix
    parle, c'est souvent l'auditeur qu'on voit. Ce qui ne ment pas, c'est la
    bouche : pendant un tour de parole, on mesure, pour chaque visage à
    l'image, l'énergie de mouvement de la région de la bouche d'une image à la
    suivante. Le visage qui bouge la bouche, c'est lui qui parle.

    Par tour : énergie par personnage → locuteur du tour.
    Par voix : vote pondéré par la durée → SPEAKER_xx = Pn, avec un score.

    python lips-run.py video.mp4 shots.json tracks.json turns.json voices.json [--stride 2]
"""
import sys, json, argparse
import numpy as np, cv2, torch
from PIL import Image
from facenet_pytorch import MTCNN

ap = argparse.ArgumentParser()
ap.add_argument("video"); ap.add_argument("shots"); ap.add_argument("tracks"); ap.add_argument("turns"); ap.add_argument("out")
ap.add_argument("--stride", type=int, default=2, help="une image sur N pendant les tours de parole")
ap.add_argument("--min-frames", type=int, default=4, help="images de bouche nécessaires pour juger un visage sur un tour")
args = ap.parse_args()

doc = json.load(open(args.shots, encoding="utf-8"))
tr = json.load(open(args.tracks)); fps = tr.get("fps", 25.0)
turns = json.load(open(args.turns))["turns"]
person_of_track = {int(t): c["id"] for c in doc.get("cast", []) for t in c.get("tracks", [])}
# Tout le casting est candidat : le détecteur de visage, plus bas, écarte de lui-même
# les nuques et les flous (pas de visage → pas de bouche → pas de mesure).
boxes_at = {}
for tid, track in tr["tracks"].items():
    pid = person_of_track.get(int(tid))
    if pid is None: continue
    for d in track: boxes_at.setdefault(int(round(d["t"] * fps)), []).append((pid, d["box"]))

mtcnn = MTCNN(keep_all=False, device="cuda" if torch.cuda.is_available() else "cpu", min_face_size=24)
cap = cv2.VideoCapture(args.video)

def mouth_patch(img, box):
    """La bouche : moitié basse du visage détecté dans la boîte du corps, en gris 48x24."""
    x1, y1, x2, y2 = [max(0, v) for v in box]
    crop = img[y1:y1 + int((y2 - y1) * 0.6), x1:x2]
    if crop.size == 0 or crop.shape[0] < 24: return None
    try:
        fb, prob = mtcnn.detect(Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)))
    except Exception:
        return None   # MTCNN plante sur les vignettes sans candidat : pas de visage
    if fb is None or prob is None or prob[0] is None or prob[0] < 0.85: return None
    fx1, fy1, fx2, fy2 = [int(v) for v in fb[0]]
    fh = fy2 - fy1
    m = crop[fy1 + int(fh * 0.55):fy2, fx1:fx2]                      # moitié basse : lèvres et menton
    if m.size == 0 or m.shape[0] < 6 or m.shape[1] < 6: return None
    g = cv2.cvtColor(m, cv2.COLOR_BGR2GRAY)
    g = cv2.resize(g, (48, 24)).astype(np.float32)
    return (g - g.mean()) / (g.std() + 1e-6)                          # insensible à l'éclairage

energy_by_turn = []
for k, t in enumerate(turns):
    f0, f1 = int(round(t["start"] * fps)), int(round(t["end"] * fps))
    prev, acc, n = {}, {}, {}
    for f in range(f0, f1 + 1, max(1, args.stride)):
        people = boxes_at.get(f, [])
        if not people: prev = {}; continue
        cap.set(cv2.CAP_PROP_POS_FRAMES, f); ok, img = cap.read()
        if not ok: continue
        for pid, box in people:
            p = mouth_patch(img, box)
            if p is None: continue
            if pid in prev and prev[pid].shape == p.shape:
                acc[pid] = acc.get(pid, 0.0) + float(np.mean(np.abs(p - prev[pid])))
                n[pid] = n.get(pid, 0) + 1
            prev[pid] = p
    scores = {pid: acc[pid] / n[pid] for pid in acc if n[pid] >= args.min_frames}
    speaker = max(scores, key=scores.get) if scores else None
    # une seule personne mesurable : c'est elle, mais faiblement (rien à comparer)
    margin = (sorted(scores.values(), reverse=True)[0] - (sorted(scores.values(), reverse=True)[1] if len(scores) > 1 else 0)) if scores else 0
    energy_by_turn.append({"start": t["start"], "end": t["end"], "voice": t["speaker"], "scores": {p: round(v, 3) for p, v in scores.items()}, "speaker": speaker, "margin": round(margin, 3)})
    print(f"   {t['start']:6.2f} → {t['end']:6.2f}  {t['speaker']}  " + (", ".join(f"{p} {v:.2f}" for p, v in sorted(scores.items(), key=lambda kv: -kv[1])) or "aucun visage") + (f"   → {speaker}" if speaker else ""), file=sys.stderr)

# vote par voix, pondéré par la durée du tour et la marge entre les deux bouches
vote = {}
for e in energy_by_turn:
    if not e["speaker"]: continue
    w = (e["end"] - e["start"]) * (1.0 + e["margin"])
    vote.setdefault(e["voice"], {}); vote[e["voice"]][e["speaker"]] = vote[e["voice"]].get(e["speaker"], 0) + w
# Pas de règle « une personne par voix » : la diarisation fond parfois deux
# personnes dans une étiquette, ou coupe une personne en deux. On donne à chaque
# voix la personne que les lèvres désignent le plus, avec sa confiance — et le
# rattachement tour par tour, plus fin, reste disponible dans `turns`.
voices = {}
for voice, m in sorted(vote.items(), key=lambda kv: -sum(kv[1].values())):
    ranked = sorted(m.items(), key=lambda kv: -kv[1])
    total = sum(v for _, v in ranked)
    pid, w = ranked[0]
    voices[voice] = {"person": pid, "confidence": round(w / total, 2), "seconds": round(w, 1),
                     "mixed": round(w / total, 2) < 0.7}   # mixed = cette étiquette mélange sans doute deux personnes
json.dump({"voices": voices, "turns": energy_by_turn}, open(args.out, "w"), indent=1)
names = {c["id"]: c["name"] for c in doc.get("cast", [])}
print("voix → personnage, par les lèvres :", file=sys.stderr)
for v, x in voices.items(): print(f"   {v} = {x['person']} {names.get(x['person'], '')}  (confiance {x['confidence']}, {x['seconds']} s)", file=sys.stderr)
