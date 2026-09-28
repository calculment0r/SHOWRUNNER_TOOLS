#!/usr/bin/env python3
"""La teinte moyenne de chaque plan, écrite dans shots.json.

    python3 teintes.py shots.json --frames frames [-o shots.json]

Pourquoi : la bande du dépouillement se colorait par l'ÉCHELLE du plan — une
rampe beige qui ne dit rien du film. Avec la teinte réelle, le nuancier se lit
d'un coup d'œil : les intérieurs chauds, la nuit, la séquence au soleil.

La moyenne se fait en lumière LINÉAIRE, pas sur les octets sRGB. Moyenner du
sRGB assombrit et salit : deux pixels, l'un noir l'autre blanc, y donnent un
gris à 46 % au lieu de 50 %, et l'erreur se voit sur un plan contrasté.
"""
import argparse, json, os
import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("shots")
ap.add_argument("--frames", default="frames")
ap.add_argument("-o", "--out")
args = ap.parse_args()

doc = json.load(open(args.shots, encoding="utf-8"))


def lineaire(x):
    x = x.astype(np.float64) / 255.0
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def srgb(x):
    y = np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    return np.clip(np.round(y * 255), 0, 255).astype(int)


def teinte(chemins):
    """Moyenne linéaire des images clés d'un plan, rendue en #rrggbb."""
    moyennes = []
    for p in chemins:
        if not os.path.exists(p):
            continue
        img = cv2.imread(p)          # BGR
        if img is None or img.size == 0:
            continue
        # On réduit d'abord : la moyenne ne change pas, le calcul est instantané.
        petite = cv2.resize(img, (64, max(1, round(64 * img.shape[0] / img.shape[1]))),
                            interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(petite, cv2.COLOR_BGR2RGB)
        moyennes.append(lineaire(rgb).reshape(-1, 3).mean(axis=0))
    if not moyennes:
        return None
    r, g, b = srgb(np.mean(moyennes, axis=0))
    return f"#{r:02x}{g:02x}{b:02x}"


n = 0
for s in doc["shots"]:
    t = teinte([os.path.join(args.frames, f"{s['id']}{x}.jpg") for x in ("a", "b")])
    if t:
        s["teinte"] = t
        n += 1

sortie = args.out or args.shots
json.dump(doc, open(sortie, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"teintes : {n}/{len(doc['shots'])} plans → {sortie}")
