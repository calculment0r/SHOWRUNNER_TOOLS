#!/usr/bin/env python3
"""
Segmentation par personnage — SAM 3, plan par plan, depuis le fichier local.

    Pour chaque plan : une session SAM 3 sur l'intervalle du plan, un prompt à
    la première image, propagation sur toutes les images du plan. Les instances
    que SAM 3 renvoie sont rattachées au casting par recouvrement (IoU) avec les
    boîtes de suivi YOLO de la même image — ces boîtes portent déjà l'identité
    (reid-face). Résultat : qui occupe quelle part de l'image, quand.

    Modes de prompt :
      text   « person » à la première image → SAM 3 détecte et suit tout le monde   (défaut)
      box    une boîte par personnage présent, obj_id = index du personnage

    Sorties :
      masks.json             par plan et par personnage : couverture moyenne (%), présence (images)
      masks/<S01>_<P1>.png   masque binaire à l'image médiane du plan, réduit (÷4)
      overlays/<S01>.jpg     image médiane avec les silhouettes colorées par personnage

    python segment-run.py shots.json video.mp4 tracks.json [--mode text|box] [--stride 2] [-o shots.json]
"""
import argparse, json, os, sys, time
import numpy as np
import cv2
import sam3.model_builder as mb

ap = argparse.ArgumentParser()
ap.add_argument("shots"); ap.add_argument("video"); ap.add_argument("tracks")
ap.add_argument("--mode", choices=["text", "box"], default="text")
ap.add_argument("--text", default="person")
ap.add_argument("--stride", type=int, default=1, help="propager toutes les N images (1 = toutes)")
ap.add_argument("--ckpt", default=os.path.expanduser("~/reelbench/models/sam3/sam3.pt"))
ap.add_argument("--bpe", default=os.path.expanduser("~/comfyui-env/lib/python3.12/site-packages/assets/bpe_simple_vocab_16e6.txt.gz"))
ap.add_argument("--min-iou", type=float, default=0.3)
ap.add_argument("--out-dir", default=".")
ap.add_argument("-o", "--out")
args = ap.parse_args()

doc = json.load(open(args.shots, encoding="utf-8"))
tr = json.load(open(args.tracks)); fps = tr.get("fps", 25.0)
cap = cv2.VideoCapture(args.video)
W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

# piste → personnage (posé par reid-face dans cast[].tracks)
person_of_track = {int(t): c["id"] for c in doc.get("cast", []) for t in c.get("tracks", [])}
# image → [(personnage, boîte xyxy)] d'après les pistes YOLO
boxes_at = {}
for tid, track in tr["tracks"].items():
    pid = person_of_track.get(int(tid))
    if not pid: continue
    for d in track:
        boxes_at.setdefault(int(round(d["t"] * fps)), []).append((pid, d["box"]))

def iou(a, b):
    ix1, iy1, ix2, iy2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    ua = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - inter
    return inter / ua if ua > 0 else 0.0

# le paquet va chercher les poids sur Hugging Face quoi qu'il arrive : on lui rend le fichier local
mb.download_ckpt_from_hf = lambda: args.ckpt
from sam3.model_builder import build_sam3_video_predictor
t0 = time.time()
pred = build_sam3_video_predictor(checkpoint_path=args.ckpt, bpe_path=args.bpe)
print(f"SAM 3 chargé en {time.time()-t0:.0f}s", file=sys.stderr)

os.makedirs(os.path.join(args.out_dir, "masks"), exist_ok=True)
os.makedirs(os.path.join(args.out_dir, "overlays"), exist_ok=True)
PALETTE = [(178,49,56), (46,110,158), (78,122,59), (166,122,22), (125,90,118), (47,126,116), (168,85,112), (142,86,168)]
colour = {c["id"]: PALETTE[i % len(PALETTE)] for i, c in enumerate(doc.get("cast", []))}

# Une seule session sur toute la vidéo (les images sont chargées une fois) ; on
# borne la propagation à l'intervalle de chaque plan.
sid = pred.start_session(args.video)["session_id"]
report = {}
for s in doc["shots"]:
    f_start, f_end = int(round(s["start"] * fps)), max(int(round(s["start"] * fps)) + 1, int(round(s["end"] * fps)) - 1)
    n_frames = f_end - f_start + 1
    pred.reset_session(sid)
    prompt_frame = f_start + min(2, n_frames - 1)          # deux images après la coupe : hors fondu
    present = {pid for f in range(f_start, f_end + 1) for pid, _ in boxes_at.get(f, [])}
    try:
        if args.mode == "text":
            pred.add_prompt(session_id=sid, frame_idx=prompt_frame, text=args.text)
        else:
            k = 0
            for pid, box in boxes_at.get(prompt_frame, []):
                x1, y1, x2, y2 = box; k += 1
                pred.add_prompt(session_id=sid, frame_idx=prompt_frame, bounding_boxes=[[x1/W, y1/H, (x2-x1)/W, (y2-y1)/H]], bounding_box_labels=[1], obj_id=k)
            if k == 0: report[s["id"]] = {}; continue
    except Exception as e:
        print(f"   {s['id']} : prompt impossible ({e})", file=sys.stderr); report[s["id"]] = {}; continue

    obj_to_person = {}          # instance SAM 3 → personnage, décidé au premier recouvrement net
    cover = {}                  # personnage → [couverture par image]
    mid = (f_start + f_end) // 2
    mid_masks = {}
    for step in pred.propagate_in_video(session_id=sid, propagation_direction="forward", start_frame_idx=prompt_frame, max_frame_num_to_track=n_frames):
        f = step["frame_index"]
        if f > f_end: break
        if args.stride > 1 and (f - f_start) % args.stride: continue
        o = step["outputs"]
        objets = [(oid, [box[0]*W, box[1]*H, (box[0]+box[2])*W, (box[1]+box[3])*H], mask)
                  for oid, box, mask in zip(o["out_obj_ids"].tolist(), o["out_boxes_xywh"].tolist(), o["out_binary_masks"])]
        # Appariement UN POUR UN sur cette image, la meilleure paire d'abord.
        # Avant : chaque instance prenait la piste qui la recouvrait le mieux, fige des
        # la premiere image ou elle apparait. En plan rapproche, la silhouette d'un garde
        # du fond tient ENTIEREMENT dans la grande boite du personnage de premier plan et
        # la lui volait — vu sur S11, ou P1 et P3 etaient poses sur les deux gardes.
        # Un plancher de taille finit le tri : une silhouette qui couvre moins du tiers
        # de la boite n'est pas la personne que cette boite designe.
        libres = [(oid, bx) for oid, bx, _ in objets if oid not in obj_to_person]
        deja = set(obj_to_person.values())
        pistes = [(pid, b) for pid, b in boxes_at.get(f, []) if pid not in deja]
        paires = sorted(((iou(bx, b), oid, pid) for oid, bx in libres for pid, b in pistes), reverse=True)
        pris_o, pris_p = set(), set()
        aire = lambda z: max(1.0, (z[2] - z[0]) * (z[3] - z[1]))
        boites = dict(boxes_at.get(f, []))
        for v, oid, pid in paires:
            if v < args.min_iou or oid in pris_o or pid in pris_p: continue
            bx = next(b for o2, b in libres if o2 == oid)
            if aire(bx) < 0.30 * aire(boites[pid]): continue
            obj_to_person[oid] = pid; pris_o.add(oid); pris_p.add(pid)
        for oid, bx, mask in objets:
            pid = obj_to_person.get(oid)
            if not pid: continue
            cover.setdefault(pid, []).append(float(mask.mean()))
            if f == mid: mid_masks[pid] = mask
    report[s["id"]] = {pid: {"coverage": round(100 * float(np.mean(v)), 1), "frames": len(v), "share": round(len(v) / max(1, n_frames // max(1, args.stride)), 2)} for pid, v in cover.items()}
    s["masks"] = report[s["id"]]

    # masques et calque à l'image médiane
    if mid_masks:
        cap.set(cv2.CAP_PROP_POS_FRAMES, mid); ok, img = cap.read()
        if ok:
            over = img.copy()
            for pid, m in mid_masks.items():
                small = cv2.resize(m.astype(np.uint8) * 255, (W // 4, H // 4), interpolation=cv2.INTER_NEAREST)
                cv2.imwrite(os.path.join(args.out_dir, "masks", f"{s['id']}_{pid}.png"), small)
                c = colour.get(pid, (200, 200, 200))
                over[m] = (0.55 * over[m] + 0.45 * np.array(c[::-1])).astype(np.uint8)
                cnts, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                cv2.drawContours(over, cnts, -1, c[::-1], 2)
                ys, xs = np.where(m)
                if len(xs): cv2.putText(over, pid, (int(xs.min()), max(20, int(ys.min()) - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.7, c[::-1], 2, cv2.LINE_AA)
            cv2.imwrite(os.path.join(args.out_dir, "overlays", f"{s['id']}.jpg"), cv2.resize(over, (W // 2, H // 2)), [cv2.IMWRITE_JPEG_QUALITY, 85])
    print(f"   {s['id']} {s['seconds']:5.2f}s  " + ", ".join(f"{pid} {v['coverage']}%" for pid, v in report[s["id"]].items()) + ("" if report[s["id"]] else "  (aucune instance rattachée)"), file=sys.stderr)

pred.close_session(sid)

# ------------------------------------------------ les sujets, confrontés aux pixels --
# reid-face pose « subjects » à partir des seules boîtes YOLO : une piste qui a glissé
# sur un décor y colle un personnage sur un plan où il n'est pas — un plan de voiture
# crédité d'une actrice, vu sur la pub Getaround. SAM 3 vient de regarder les mêmes
# plans ; là où il ne trouve AUCUNE silhouette, la présence n'est pas étayée.
# On ne l'efface pas en douce : elle passe dans « subjectsNonCorrobores » et la
# correction est comptée, comme les catégories à preuve.
corrections = 0
for s in doc["shots"]:
    subs = s.get("subjects") or []
    if not subs: continue
    vus = {pid for pid, v in (s.get("masks") or {}).items() if v and v.get("coverage", 0) > 0}
    if vus: continue                       # SAM a vu quelqu'un : on lui fait confiance
    s["subjectsNonCorrobores"] = subs      # SAM n'a rien vu du tout sur ce plan
    s["subjects"] = []
    corrections += 1
    print(f"   {s['id']} : {', '.join(subs)} retiré(s) — aucune silhouette trouvée sur ce plan", file=sys.stderr)
if corrections:
    print(f"{corrections} plan(s) dont les sujets ne sont pas étayés par les pixels", file=sys.stderr)

json.dump(report, open(os.path.join(args.out_dir, "masks.json"), "w"), indent=1)
doc.setdefault("provenance", {})["masks"] = f"sam3 ({args.mode}) → IoU avec pistes yolo → casting ; sujets non étayés retirés"
json.dump(doc, open(args.out or args.shots, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"terminé en {time.time()-t0:.0f}s — masks.json, masks/, overlays/", file=sys.stderr)
