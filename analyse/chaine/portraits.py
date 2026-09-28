#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Les portraits du casting, refaits : pour chaque personnage (fiches réunies comprises), TOUTES ses apparitions
sont passées en revue, chaque visage noté, et le meilleur cadré comme un portrait — tête et épaules, les yeux au
tiers haut, le visage entier avec de l'air autour.

  ~/reelbench/env/bin/python portraits.py --shots shots.json --tracks tracks.plans.json --video film.mp4 \
      [--corrections corrections.json] -o portraits/ [--cote 384]

Pourquoi (25-27/09, l'utilisateur : « on les reconnaît à peine ») : reid-face.py gardait le visage le plus NET d'une
seule piste, et le cadrait à 2,1 fois le visage. Le plus net, c'est le très gros plan (des lunettes, de la peau) — et
en très gros plan 2,1 fois le visage dépasse l'image : il restait un morceau de front et d'yeux. Une fiche réunie
gardait le portrait de la fiche d'arrivée, même minuscule.

La note d'un visage : sa taille (jusqu'à 170 px de haut, au-delà rien de plus), la place de le cadrer en entier
(le cadre voulu tient-il dans l'image ?), de face (le nez entre les yeux), net, bien exposé, sûr (MTCNN).

Et d'abord : que ce soit SON visage. Une boîte de piste large contient souvent le visage d'un voisin, mieux cadré que
le sien (Wall, 27/09 : P3 et P6 prenaient le visage de DiCaprio, qui est P2). D'abord la géométrie de reid-face.py
(le visage fait au moins 18 % de la largeur de la boîte, dans son tiers haut, à peu près centré) ; puis chaque visage
a son empreinte FaceNet (VGGFace2) et le personnage est son groupe majoritaire (distance < --seuil) ; un visage plus
proche d'un autre personnage que du sien est écarté. Deux fiches au même visage majoritaire, c'est le plus souvent UN
acteur que la chaîne a coupé en deux (Wall : P9 et P4 sont Rob Reiner) : chacune a son portrait, et portraits.json
les signale (« meme_visage_que ») — à réunir au casting. Sans visage sûr, rien n'est écrit : l'ancien portrait reste.
Processeur seulement (MTCNN et FaceNet sur CPU) : quelques minutes pour un film court.
"""
import argparse, json, os
import numpy as np, cv2, torch
from PIL import Image
from facenet_pytorch import MTCNN, InceptionResnetV1

ap = argparse.ArgumentParser()
ap.add_argument('--shots', required=True)
ap.add_argument('--tracks', required=True)
ap.add_argument('--video', required=True)
ap.add_argument('--corrections', default=None)
ap.add_argument('-o', '--sortie', required=True)
ap.add_argument('--cote', type=int, default=384)
ap.add_argument('--par-personne', type=int, default=80, help='instants examinés au plus, par personnage')
ap.add_argument('--seuil', type=float, default=0.9, help='distance FaceNet max au sein du groupe majoritaire (reid-face : 0,75 entre pistes)')
args = ap.parse_args()
os.makedirs(args.sortie, exist_ok=True)
torch.set_num_threads(8)

doc = json.load(open(args.shots, encoding='utf-8'))
T = json.load(open(args.tracks, encoding='utf-8'))
T = T.get('tracks', T)
fus = (json.load(open(args.corrections, encoding='utf-8')).get('fusions', {}) if args.corrections else {})

def racine(p):
    vu = set()
    while p in fus and fus[p] != p and p not in vu: vu.add(p); p = fus[p]
    return p
groupes = {}
for c in doc['cast']:
    groupes.setdefault(racine(c['id']), []).extend(str(t) for t in c.get('tracks', []))

mtcnn = MTCNN(keep_all=True, device='cpu', post_process=False)
aligne = MTCNN(device='cpu', post_process=True)          # le visage aligné, normalisé, pour FaceNet
facenet = InceptionResnetV1(pretrained='vggface2').eval()
cap = cv2.VideoCapture(args.video)
W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

def image_a(t):
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, f = cap.read()
    return f if ok else None

def cadre(fx1, fy1, fx2, fy2, yeux_y):
    """Le carré d'un portrait : le visage (sourcils-menton, la boîte de MTCNN) fait la moitié de la hauteur, les yeux à
    38 %. Rend (x, y, cote, tient). À 42 %, la tête paraissait petite dans la vignette (essai du 27/09)."""
    fh = fy2 - fy1
    cote = fh / 0.50
    tient = min(1.0, H / cote, W / cote)          # < 1 : le cadre voulu dépasse l'image (très gros plan)
    cote = min(cote, H, W)
    x = (fx1 + fx2) / 2 - cote / 2
    y = yeux_y - 0.38 * cote
    x = max(0, min(W - cote, x)); y = max(0, min(H - cote, y))
    return int(x), int(y), int(cote), tient

@torch.no_grad()
def empreinte(zone_pil, boite):
    try:
        f = aligne.extract(zone_pil, np.array([boite]), None)
        if f is None: return None
        if f.dim() == 4: f = f[0]
        return facenet(f.unsqueeze(0))[0].numpy()
    except Exception:
        return None

def candidats_de(instants, pmin, marge, strict=True):
    """Les visages de ces instants dans la boîte de la personne : sûrs à pmin, dans le milieu de sa boîte, son haut.
    strict : la géométrie de reid-face.py (≥ 18 % de la largeur de la boîte, dans son tiers haut, centré)."""
    out = []
    for t, (x1, y1, x2, y2) in instants:
        img = image_a(t)
        if img is None: continue
        bw, bh = x2 - x1, y2 - y1
        zx1, zy1 = max(0, int(x1 - 0.1 * bw)), max(0, int(y1 - 0.1 * bh))
        zx2, zy2 = min(W, int(x2 + 0.1 * bw)), min(H, int(y1 + 0.75 * bh))
        if zx2 - zx1 < 24 or zy2 - zy1 < 24: continue
        zone = Image.fromarray(cv2.cvtColor(img[zy1:zy2, zx1:zx2], cv2.COLOR_BGR2RGB))
        try:
            boites, probas, reperes = mtcnn.detect(zone, landmarks=True)
        except Exception:
            continue
        if boites is None: continue
        for b, p, lm in zip(boites, probas, reperes):
            if p is None or p < pmin: continue
            fx1, fy1, fx2, fy2 = b[0] + zx1, b[1] + zy1, b[2] + zx1, b[3] + zy1
            cx = (fx1 + fx2) / 2
            if not (x1 + marge * bw <= cx <= x2 - marge * bw) or fy1 > y1 + 0.55 * bh: continue
            if strict and ((fx2 - fx1) < 0.18 * bw or fy1 > y1 + 0.33 * bh or not (x1 + 0.2 * bw <= cx <= x2 - 0.2 * bw)): continue
            fh = fy2 - fy1
            if fh < 20: continue
            e = empreinte(zone, b)
            if e is None: continue
            (lx, ly), (rx, ry), (nx, ny) = lm[0], lm[1], lm[2]
            ecart_yeux = max(1.0, abs(rx - lx))
            face = 1 - min(1.0, abs(nx - (lx + rx) / 2) / (0.5 * ecart_yeux))          # 1 : de face
            px1, py1, px2, py2 = [int(v) for v in (max(0, fx1), max(0, fy1), min(W, fx2), min(H, fy2))]
            gris = cv2.cvtColor(img[py1:py2, px1:px2], cv2.COLOR_BGR2GRAY)
            if gris.size == 0: continue
            nette = cv2.Laplacian(cv2.resize(gris, (128, 128)), cv2.CV_64F).var()
            expo = 1 - min(1.0, abs(gris.mean() / 255 - 0.5) / 0.4)
            x, y, cote, tient = cadre(fx1, fy1, fx2, fy2, (ly + ry) / 2 + zy1)
            vignette = img[y:y + cote, x:x + cote].copy()
            out.append({'t': t, 'vignette': vignette, 'cote': cote, 'taille': min(1.0, fh / 170), 'tient': tient, 'e': e,
                        'face': max(0.05, face), 'nette': nette, 'expo': max(0.1, expo), 'p': float(p), 'fh': round(float(fh))})
    return out

# 1. les visages de chaque personnage
tous = {}
for pid, pistes in groupes.items():
    instants = sorted((d['t'], d['box']) for t in pistes for d in T.get(t, []))
    if not instants: tous[pid] = []; continue
    pas = max(1, len(instants) // args.par_personne)
    c = candidats_de(instants[::pas], 0.95, 0.15)
    if len(c) < 5:
        # vu de loin, de trois quarts, en mouvement : trop peu de visages sûrs, on regarde plus, plus largement
        c += candidats_de(instants[pas // 2::max(1, pas // 2)] if pas > 1 else instants, 0.90, 0.05)
    if len(c) < 3:
        c += [dict(x, large=True) for x in candidats_de(instants, 0.80, 0.0, strict=False)]
    tous[pid] = c
    print(f'{pid} : {len(c)} visages', flush=True)

# 2. qui est qui : le groupe majoritaire de chaque personnage, son centre
dist = lambda a, b: float(np.linalg.norm(a - b))
centres, garde = {}, {}
for pid, c in tous.items():
    if not c: continue
    E = np.stack([x['e'] for x in c])
    D = np.linalg.norm(E[:, None] - E[None], axis=2)
    voisins = (D < args.seuil).sum(1)
    m = int(np.argmax(voisins))                          # le visage qui a le plus de semblables
    garde[pid] = [i for i in range(len(c)) if D[m, i] < args.seuil]
    centres[pid] = E[garde[pid]].mean(0)
# deux fiches au même visage majoritaire : sans doute un acteur coupé en deux par la chaîne
jumeaux = {p: [] for p in centres}
for a in centres:
    for b in centres:
        if a != b and dist(centres[a], centres[b]) < args.seuil * 0.8: jumeaux[a].append(b)

# 3. le meilleur portrait parmi SES visages
rapport = {}
for pid, c in tous.items():
    fiches = [x['id'] for x in doc['cast'] if racine(x['id']) == pid]
    if not c:
        rapport[pid] = {'portrait': 'inchangé', 'motif': 'aucun visage exploitable', 'fiches': fiches}; continue
    autres = [centres[q] for q in centres if q != pid and q not in jumeaux[pid]]
    siens = [c[i] for i in garde[pid] if all(dist(c[i]['e'], centres[pid]) + 0.1 < dist(c[i]['e'], o) for o in autres)]
    if not siens:
        rapport[pid] = {'portrait': 'inchangé', 'motif': 'aucun visage sûrement le sien', 'fiches': fiches}; continue
    med = float(np.median([x['nette'] for x in siens])) or 1.0
    for x in siens:
        x['score'] = x['taille'] * x['tient'] ** 2 * x['face'] * min(1.3, x['nette'] / med) ** 0.5 * x['expo'] * x['p']
    if os.environ.get('PORTRAITS_DETAIL') == pid:
        print(pid, [(round(x['t'], 2), round(x['p'], 3), x['fh'], round(x['nette']), round(x['score'], 3)) for x in siens])
    b = max(siens, key=lambda x: x['score'])
    v = cv2.resize(b['vignette'], (args.cote, args.cote), interpolation=cv2.INTER_AREA if b['cote'] > args.cote else cv2.INTER_CUBIC)
    cv2.imwrite(os.path.join(args.sortie, f'{pid}.jpg'), v, [cv2.IMWRITE_JPEG_QUALITY, 90])
    rapport[pid] = {'portrait': 'refait', 't': b['t'], 'visage_px': b['fh'], 'cadre_px': b['cote'], 'de_face': round(b['face'], 2),
                    'score': round(float(b['score']), 3), 'siens': len(siens), 'visages': len(c), 'large': bool(b.get('large')), 'fiches': fiches}
    if jumeaux.get(pid): rapport[pid]['meme_visage_que'] = sorted(jumeaux[pid])
json.dump(rapport, open(os.path.join(args.sortie, 'portraits.json'), 'w'), ensure_ascii=False, indent=1)
for pid, r in rapport.items(): print(pid, r)
