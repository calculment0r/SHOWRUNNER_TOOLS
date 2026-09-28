#!/usr/bin/env python3
"""
Pistes de personnes — YOLO11m + ByteTrack, identifiants stables dans un plan.

    python track-run.py video.mp4 tracks.json [--imgsz 960]

Sortie : { fps, frames, tracks: { id: [ {t, box:[x1,y1,x2,y2], conf}, … ] } }
Le recollement entre plans se fait ensuite dans reid-face.py.
"""
import sys, json, cv2
from ultralytics import YOLO

video, out = sys.argv[1], sys.argv[2]
imgsz = int(sys.argv[sys.argv.index("--imgsz") + 1]) if "--imgsz" in sys.argv else 960
fps = cv2.VideoCapture(video).get(cv2.CAP_PROP_FPS) or 25.0

model = YOLO("yolo11m.pt")
tracks, frames = {}, 0
for r in model.track(video, classes=[0], tracker="bytetrack.yaml", persist=True, stream=True, verbose=False, imgsz=imgsz, device=0):
    frames += 1
    if r.boxes is None or r.boxes.id is None: continue
    t = frames / fps
    for box, tid, conf in zip(r.boxes.xyxy.tolist(), r.boxes.id.int().tolist(), r.boxes.conf.tolist()):
        tracks.setdefault(tid, []).append({"t": round(t, 3), "box": [round(v) for v in box], "conf": round(conf, 2)})

json.dump({"fps": fps, "frames": frames, "tracks": {str(k): v for k, v in tracks.items()}}, open(out, "w"))
print(f"{frames} images, {len(tracks)} pistes → {out}", file=sys.stderr)
