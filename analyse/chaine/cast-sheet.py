#!/usr/bin/env python3
"""
Planche des portraits, numérotée — l'entrée du VLM pour fusionner et nommer.

    python cast-sheet.py shots.json portraits/ planche.jpg [--cell 256]
"""
import json, sys, os
import cv2, numpy as np

shots, folder, out = sys.argv[1], sys.argv[2], sys.argv[3]
cell = int(sys.argv[sys.argv.index("--cell") + 1]) if "--cell" in sys.argv else 256

doc = json.load(open(shots, encoding="utf-8"))
ids = [c["id"] for c in doc.get("cast", [])]
tiles = []
for pid in ids:
    img = cv2.imread(os.path.join(folder, f"{pid}.jpg"))
    if img is None: img = np.full((cell, cell, 3), 40, np.uint8)
    h, w = img.shape[:2]; s = cell / max(h, w)
    img = cv2.resize(img, (max(1, int(w * s)), max(1, int(h * s))))
    tile = np.full((cell + 34, cell, 3), 245, np.uint8)
    y0 = (cell - img.shape[0]) // 2; x0 = (cell - img.shape[1]) // 2
    tile[y0:y0 + img.shape[0], x0:x0 + img.shape[1]] = img
    cv2.putText(tile, pid, (8, cell + 25), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (30, 30, 30), 2, cv2.LINE_AA)
    tiles.append(tile)

cols = 4
rows = (len(tiles) + cols - 1) // cols
blank = np.full_like(tiles[0], 245)
grid = np.vstack([np.hstack([tiles[r * cols + c] if r * cols + c < len(tiles) else blank for c in range(cols)]) for r in range(rows)])
cv2.imwrite(out, grid, [cv2.IMWRITE_JPEG_QUALITY, 90])
print(f"{len(tiles)} portraits → {out} ({grid.shape[1]}x{grid.shape[0]})", file=sys.stderr)
