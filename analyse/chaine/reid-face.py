#!/usr/bin/env python3
"""
Ré-identification par le VISAGE — la bonne mesure pour « même personne ».

    DINOv2 sur le buste sépare les cadrages ; la planche l'a montré : quatre
    groupes pour Jonah Hill, deux pour DiCaprio. Un visage, lui, est le même en
    plan large et en gros plan. Donc :

      piste → images échantillonnées → visage détecté DANS la boîte (MTCNN)
            → embedding InceptionResnetV1 (VGGFace2), moyenne par piste
            → regroupement : deux pistes = même personne si distance < seuil
      piste sans visage (dos, flou, trop petit) → embedding DINOv2 du buste,
            regroupée seulement avec les pistes sans visage, et marquée telle

    python reid-face.py shots.json video.mp4 tracks.json [--face-threshold 0.75]
        [--body-threshold 0.35] [--min-frames 24] [--min-presence 2.0] [--portraits portraits/] [-o shots.json]
"""
import argparse, bisect, json, os, sys
import numpy as np
import cv2
import torch
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("shots"); ap.add_argument("video"); ap.add_argument("tracks")
ap.add_argument("--face-threshold", type=float, default=0.75, help="distance L2 max entre visages (VGGFace2 : ~1.0 = même personne, ~1.4 = autre)")
ap.add_argument("--body-threshold", type=float, default=0.35, help="distance cosinus max entre bustes sans visage")
ap.add_argument("--face-merge", type=float, default=1.25, help="second passage : fusionner deux groupes de visages sous cette distance s'ils ne coexistent jamais à l'image")
ap.add_argument("--buste-accord", type=float, default=0.35, help="distance cosinus max entre bustes pour que la silhouette confirme un rapprochement de visages incertain, ou rejoigne un visage connu (2 = ne rien demander au buste)")
ap.add_argument("--min-frames", type=int, default=24)
ap.add_argument("--min-presence", type=float, default=2.0)
ap.add_argument("--samples", type=int, default=8)
ap.add_argument("--figurants", choices=["ecarter", "garder"], default="ecarter",
                help="groupes sans visage (dos, masques, arriere-plan) : les ecarter (defaut, convient a une scene de dialogue face camera) ou leur ouvrir une fiche « silhouette » — indispensable des que des personnages ne montrent jamais leur visage")
ap.add_argument("--portraits", default="portraits")
ap.add_argument("--raccords", choices=["couper", "garder"], default="couper",
                help="couper les pistes aux raccords (defaut) : un identifiant ByteTrack ne vaut que DANS un plan, le recollement entre plans se fait ici par le visage")
ap.add_argument("--out-tracks", help="reecrire le fichier de pistes decoupees (a passer ensuite a segment-run.py)")
ap.add_argument("-o", "--out")
args = ap.parse_args()

doc = json.load(open(args.shots, encoding="utf-8"))
tr = json.load(open(args.tracks))
fps = tr.get("fps", 25.0)

def decouper_aux_plans(brutes, shots):
    """Couper chaque piste aux raccords : une piste ne vaut que dans un plan.

    C'est déjà ce qu'annonce track-run.py — « identifiants stables dans un plan » —
    mais ByteTrack, lui, garde son identifiant par-dessus le raccord et le repose sur
    qui occupe la même place au plan suivant. Une piste devient alors deux personnes,
    et la moyenne de ses visages une identité fantôme qui s'étale sur tout le film.
    On coupe donc au raccord ; recoller d'un plan à l'autre est le travail du visage.
    """
    deb = [s["start"] for s in shots]
    ordre = sorted(range(len(deb)), key=lambda i: deb[i])
    deb = [deb[i] for i in ordre]
    out, origine = {}, {}
    suivant = max(brutes, default=0) + 1
    for tid, pts in sorted(brutes.items()):
        par_plan = {}
        for p in pts:
            i = bisect.bisect_right(deb, p["t"]) - 1
            par_plan.setdefault(max(0, i), []).append(p)
        if len(par_plan) < 2:
            out[tid] = pts; continue
        for k, (_, seg) in enumerate(sorted(par_plan.items())):
            nid = tid if k == 0 else suivant
            if k: suivant += 1
            out[nid] = seg; origine[nid] = tid
    return out, origine

brutes = {int(k): v for k, v in tr["tracks"].items()}
origine = {}
if args.raccords == "couper" and doc.get("shots"):
    avant = len(brutes)
    brutes, origine = decouper_aux_plans(brutes, doc["shots"])
    print(f"{avant} pistes → {len(brutes)} après découpe aux raccords", file=sys.stderr)
tracks = {k: v for k, v in brutes.items() if len(v) >= args.min_frames}
print(f"{len(tr['tracks'])} pistes, {len(tracks)} retenues (≥ {args.min_frames} images)", file=sys.stderr)
if args.out_tracks:
    json.dump({**tr, "tracks": {str(k): v for k, v in brutes.items()}}, open(args.out_tracks, "w"))

device = "cuda" if torch.cuda.is_available() else "cpu"
from facenet_pytorch import MTCNN, InceptionResnetV1
mtcnn = MTCNN(keep_all=False, device=device, min_face_size=24, post_process=True)
facenet = InceptionResnetV1(pretrained="vggface2").eval().to(device)
from transformers import AutoImageProcessor, AutoModel
dproc = AutoImageProcessor.from_pretrained("facebook/dinov2-base")
dino = AutoModel.from_pretrained("facebook/dinov2-base").to(device).eval()

cap = cv2.VideoCapture(args.video)
def frame_at(t):
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(t * fps)))
    ok, img = cap.read()
    return img if ok else None

def samples(track):
    picks = sorted(track, key=lambda d: -d["conf"])[: args.samples * 3]
    picks = sorted(picks, key=lambda d: d["t"])
    step = max(1, len(picks) // args.samples)
    return picks[::step][: args.samples]

@torch.no_grad()
def face_vec(rgb_crop):
    """Un visage aligné → (vecteur 512, boîte du visage dans ce crop), ou (None, None)."""
    # MTCNN plante (torch.cat sur liste vide) sur certaines vignettes sans le moindre
    # candidat — bandes noires, vignettes minuscules. Pas de visage, donc None.
    try:
        img = Image.fromarray(rgb_crop)
        boxes, probs = mtcnn.detect(img)
        # une nuque ou un flou passent parfois pour un visage à 0.8 : on exige 0.95
        if boxes is None or probs is None or probs[0] is None or probs[0] < 0.95: return None, None
        # Le visage doit être CELUI de ce corps : assez grand pour la boîte (≥ 18 % de sa
        # largeur), dans son tiers haut, à peu près centré. Sinon c'est le visage d'un
        # voisin qui traîne dans la boîte — et il ferait coexister quelqu'un avec lui-même.
        Hc, Wc = rgb_crop.shape[:2]
        fx1, fy1, fx2, fy2 = boxes[0]
        fw = fx2 - fx1; cx = (fx1 + fx2) / 2
        if fw < 0.18 * Wc or fy1 > 0.5 * Hc or cx < 0.2 * Wc or cx > 0.8 * Wc: return None, None
        face = mtcnn.extract(img, boxes[:1], None)
        if face is not None and face.dim() == 4: face = face[0]
    except Exception:
        return None, None
    if face is None: return None, None
    # On rend la BOITE du visage, pas une vignette : la vignette se coupe plus
    # haut, dans l'image entiere. Coupee ici, elle etait bornee par la boite de
    # la piste — en tres gros plan celle-ci est deja rognee, et le portrait
    # sortait sans front ni menton.
    return facenet(face.unsqueeze(0).to(device))[0].cpu().numpy(), tuple(float(v) for v in boxes[0])

COTE_PORTRAIT = 256   # toutes les vignettes au meme format, quel que soit le film

def portrait_carre(frame_rgb, cx, cy, cote, plancher=28):
    """Une vignette CARREE centree sur (cx, cy), prise dans l'image entiere.

    Carree parce que la page l'affiche carree : une bande 2.86:1 recadree au
    centre ne montre plus que le milieu du visage. Prise dans l'image entiere
    parce que la boite de la piste ne laisse pas de marge en gros plan — c'est
    la que le portrait perdait son front et son menton.

    Ramenee ensuite a une taille unique : un visage de 40 px reste un mauvais
    portrait, mais c'est un portrait — cadre comme les autres, a la meme
    echelle. Mieux vaut flou que rogne.
    """
    H, W = frame_rgb.shape[:2]
    cote = int(min(cote, H, W))
    if cote < plancher: return None
    x = int(round(cx - cote / 2)); y = int(round(cy - cote / 2))
    x = max(0, min(W - cote, x)); y = max(0, min(H - cote, y))
    v = frame_rgb[y:y + cote, x:x + cote]
    if v.shape[0] != cote or v.shape[1] != cote: return None
    interp = cv2.INTER_AREA if cote > COTE_PORTRAIT else cv2.INTER_CUBIC
    return cv2.resize(v, (COTE_PORTRAIT, COTE_PORTRAIT), interpolation=interp)

def nettete(c):
    return cv2.Laplacian(cv2.cvtColor(c, cv2.COLOR_RGB2GRAY), cv2.CV_64F).var()

@torch.no_grad()
def body_vec(rgb_crops):
    inputs = dproc(images=rgb_crops, return_tensors="pt").to(device)
    f = torch.nn.functional.normalize(dino(**inputs).last_hidden_state[:, 0], dim=-1)
    # normalisée APRÈS la moyenne aussi : sans ça « 1 - a·b » n'est pas une distance
    # cosinus, et le seuil qui la juge ne veut rien dire.
    return torch.nn.functional.normalize(f.mean(0), dim=-1).cpu().numpy()

def _sous_ensemble_coherent(vecs, seuil):
    """Indices du plus gros groupe de visages mutuellement compatibles d'une piste.

    Une piste saine ne montre qu'une personne : toutes ses distances internes sont
    sous le seuil, et on renvoie tout. Une piste qui a glissé sur un voisin contient
    deux paquets éloignés ; on garde le plus gros, et à égalité le premier dans le
    temps (l'identité d'origine de la piste, pas celle qu'elle a attrapée en route).
    """
    n = len(vecs)
    if n < 2: return list(range(n))
    d = [[float(np.linalg.norm(vecs[i] - vecs[j])) for j in range(n)] for i in range(n)]
    if max(d[i][j] for i in range(n) for j in range(i + 1, n)) <= seuil:
        return list(range(n))
    # Le plus gros ensemble dont TOUTES les distances internes tiennent sous le seuil.
    # n est petit (--samples, 8 par défaut) : on part de chaque graine et on agrège.
    meilleur = []
    for depart in range(n):
        groupe = [depart]
        for j in range(n):
            if j != depart and all(d[j][k] <= seuil for k in groupe): groupe.append(j)
        if len(groupe) > len(meilleur): meilleur = sorted(groupe)
    return meilleur or [0]

def _fenetre_coherente(gardes_t, rejets_t):
    """Bornes temporelles où la piste est restée elle-même, à mi-chemin du rejet voisin.

    Sans ça, une piste qui a glissé garde sa durée entière : le personnage hérite des
    secondes de son voisin et se pose sur des plans où il n'est pas. On ne lui laisse
    que l'intervalle vérifié ; le reste n'est attribué à personne, ce qui est la
    vérité disponible.
    """
    lo, hi = float("-inf"), float("inf")
    if not gardes_t: return lo, hi
    avant = [t for t in rejets_t if t < min(gardes_t)]
    apres = [t for t in rejets_t if t > max(gardes_t)]
    if avant: lo = (max(avant) + min(gardes_t)) / 2
    if apres: hi = (min(apres) + max(gardes_t)) / 2
    return lo, hi

ids, faces, bodies, bustes, best, facetimes, derive, rognes = [], {}, {}, {}, {}, {}, [], {}
for tid, track in tracks.items():
    fvecs, fcrops, ftimes, crops = [], [], [], []
    for d in samples(track):
        img = frame_at(d["t"])
        if img is None: continue
        x1, y1, x2, y2 = [max(0, v) for v in d["box"]]
        y2h = y1 + int((y2 - y1) * 0.6)                       # le buste
        crop = img[y1:y2h, x1:x2]
        if crop.size == 0 or crop.shape[0] < 24 or crop.shape[1] < 16: continue
        rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        crops.append(rgb)
        v, fbox = face_vec(rgb)
        if v is not None:
            # Le visage occupe environ la moitie du cadre : de l'air au-dessus
            # du front et sous le menton, c'est ce qui fait un portrait.
            fx1, fy1, fx2, fy2 = fbox
            vignette = portrait_carre(
                cv2.cvtColor(img, cv2.COLOR_BGR2RGB),
                x1 + (fx1 + fx2) / 2, y1 + (fy1 + fy2) / 2,
                max(fx2 - fx1, fy2 - fy1) * 2.1)
            # Le vecteur compte TOUJOURS pour l'identite, meme quand le film n'a
            # pas assez de pixels pour en tirer un portrait : sinon un petit
            # visage cesserait d'identifier son personnage, et la distribution
            # se remettrait a bouger d'un passage a l'autre.
            fvecs.append(v); fcrops.append(vignette); ftimes.append(d["t"])
    if not crops: continue
    ids.append(tid)
    bustes[tid] = body_vec(crops)   # la silhouette de TOUTE piste : elle arbitre plus bas
    if fvecs:
        # Une piste ByteTrack peut GLISSER d'une personne à une autre — un identifiant
        # qui se recolle sur le voisin quand les corps se croisent. La moyenne des
        # visages devient alors un mélange de deux personnes : une identité fantôme,
        # qui s'étale sur tout le film et se pose sur des plans où elle n'est pas.
        # On garde donc le plus gros sous-ensemble cohérent de la piste, et on le dit.
        gardes = _sous_ensemble_coherent(fvecs, args.face_threshold)
        faces[tid] = np.mean([fvecs[i] for i in gardes], axis=0)
        facetimes[tid] = [ftimes[i] for i in gardes]   # quand cette piste montre SON visage
        # Le portrait se choisit parmi les visages GARDÉS. Sinon la plus grande vignette
        # de la piste — le gros plan du voisin sur lequel elle a glissé — devient le
        # portrait d'un personnage qu'elle ne montre pas.
        vus = [c for i in gardes if (c := fcrops[i]) is not None and c.size]
        if vus:
            # Parmi les visages gardes, le plus NET. Choisi sur la seule taille, un
            # grand visage flou battait un petit visage net, et le modele qui nomme
            # repondait « visage non reconnaissable ».
            # Les vignettes sortent maintenant toutes au meme format : la taille ne
            # departage donc plus rien, et elle n'en a plus besoin — un visage de
            # 40 px agrandi a 256 est lisse, sa variance de laplacien est basse, et
            # il perd d'office contre un visage qui avait vraiment des pixels.
            best[tid] = max(vus, key=nettete)
        if len(gardes) < len(fvecs):
            derive.append({"piste": tid, "vus": len(fvecs), "gardes": len(gardes), "par": "visage"})
            rognes[tid] = _fenetre_coherente(facetimes[tid], [ftimes[i] for i in range(len(ftimes)) if i not in gardes])
    else:
        # Pas de contrôle de cohérence ici : entre deux images d'un même buste, DINOv2
        # s'écarte autant qu'entre deux personnes (pose, flou, échelle), et le seuil qui
        # sépare deux pistes taille en pleine silhouette. La dérive des bustes se règle
        # en amont, au raccord.
        bodies[tid] = bustes[tid]
        # Sans visage exploitable, on ne fabrique PAS un portrait avec un corps.
        # On prend la tete de la boite — son carre du haut — et seulement si elle
        # est assez grande ; sinon aucune vignette. La plus grande vignette de
        # corps donnait une main tenant un telephone comme portrait de role.
        tetes = []
        for c in crops:
            hc, wc = c.shape[:2]
            cote = min(wc, int(hc * 0.55))
            if cote < 28: continue
            g = max(0, (wc - cote) // 2)
            t = c[0:cote, g:g + cote]
            if t.shape[0] != cote or t.shape[1] != cote: continue
            interp = cv2.INTER_AREA if cote > COTE_PORTRAIT else cv2.INTER_CUBIC
            tetes.append(cv2.resize(t, (COTE_PORTRAIT, COTE_PORTRAIT), interpolation=interp))
        if tetes: best[tid] = max(tetes, key=nettete)

# Une piste rognée ne prête plus au personnage les secondes de son voisin.
for tid, (lo, hi) in rognes.items():
    reste = [d for d in tracks[tid] if lo <= d["t"] <= hi]
    if reste: tracks[tid] = reste
print(f"{len(faces)} pistes avec visage, {len(bodies)} sans (buste seul)", file=sys.stderr)
if derive:
    print(f"{len(derive)} piste(s) incohérente(s) avec elles-mêmes, ramenées à leur plus gros groupe :", file=sys.stderr)
    for d in derive:
        t0, t1 = tracks[d["piste"]][0]["t"], tracks[d["piste"]][-1]["t"]
        print(f"   piste {d['piste']} : {d['gardes']}/{d['vus']} {d['par']}s gardés, ramenée à {t0:.1f}→{t1:.1f} s ({len(tracks[d['piste']])} img)", file=sys.stderr)

# ------------------------------------------------ regroupement sous contrainte --
# Liaison moyenne, avec une règle que la métrique n'a pas : deux pistes à l'image
# EN MÊME TEMPS à des endroits différents ne peuvent pas être la même personne.
# Cette contrainte (« cannot-link ») empêche la fusion de deux hommes à lunettes qui
# se ressemblent, et laisse fusionner Jonah Hill en plan large avec Jonah Hill en
# gros plan — ils ne coexistent jamais. Elle s'applique dès le premier regroupement,
# ce qui permet un seuil plus large sans risque.
def span_of(tid): return (tracks[tid][0]["t"], tracks[tid][-1]["t"])
def _iou(a, b):
    ix1, iy1, ix2, iy2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    ua = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - inter
    return inter / ua if ua > 0 else 0.0
_boxes_by_t = {tid: {round(d["t"], 2): d["box"] for d in tr_} for tid, tr_ in tracks.items()}
def _box_near(tid, t):
    bt = _boxes_by_t[tid]
    for dt in (0, 0.04, -0.04, 0.08, -0.08):
        b = bt.get(round(t + dt, 2))
        if b is not None: return b
    return None
def face_conflicts(a, b):
    """Instants où a montre un VISAGE pendant que b est à l'image ailleurs (IoU < 0.2)
    et montre lui aussi un visage à ce moment-là (à 0.5 s près). Une piste qui a dérivé
    sur une nuque ne compte pas ; deux vrais visages côte à côte, si."""
    n = 0
    fb = facetimes.get(b, [])
    for t in facetimes.get(a, []):
        if not any(abs(t - u) <= 0.5 for u in fb): continue
        ba, bb = _box_near(a, t), _box_near(b, t)
        if ba is not None and bb is not None and _iou(ba, bb) < 0.2: n += 1
    return n
_conflict_cache = {}
def conflict(a, b):
    k = (a, b) if a < b else (b, a)
    if k not in _conflict_cache: _conflict_cache[k] = (face_conflicts(a, b) + face_conflicts(b, a)) >= 2
    return _conflict_cache[k]

def coexistent(a, b):
    """Deux pistes à l'image EN MÊME TEMPS et ailleurs l'une que l'autre : deux personnes.

    Depuis la découpe aux raccords, se chevaucher dans le temps c'est être dans le même
    plan — donc côte à côte pour de bon. Contrairement à `conflict`, aucun visage n'est
    exigé : c'est la seule barrière dont dispose une silhouette.

    On a essayé d'excuser ici les boîtes contenues l'une dans l'autre : le détecteur
    compte souvent deux fois la même personne — son corps, puis sa main qui tend un
    téléphone en avant. Mesuré sur cette pub, ça ne tient pas : les mains du convoyeur
    dans sa propre boîte donnent contenance 0,69 et rapport d'aires 0,25 ; le braqueur
    au chapeau debout DERRIÈRE son complice donne 0,62 et 0,29. La géométrie ne sépare
    pas « mon bras » de « quelqu'un derrière moi », et la règle coûtait un personnage
    réel pour récupérer une main. Ce rattachement-là se fait à l'œil, dans le
    trombinoscope, et se garde dans corrections.json."""
    ba, bb = _boxes_by_t.get(a, {}), _boxes_by_t.get(b, {})
    return sum(1 for t in set(ba) & set(bb) if _iou(ba[t], bb[t]) < 0.2) >= 2

def buste_ecart(ga, gb):
    """Distance cosinus moyenne entre les silhouettes de deux groupes."""
    ds = [1.0 - float(bustes[a] @ bustes[b]) for a in ga for b in gb if a in bustes and b in bustes]
    return float(np.mean(ds)) if ds else 0.0

def veto_buste(ga, gb, d):
    """Dans la bande où le visage ne tranche pas, le buste a voix au chapitre.

    VGGFace2 dit « le même » sous ~1.0 et « un autre » au-delà de ~1.4 ; entre les deux
    il ne dit rien, et aucun seuil global ne s'en sort : sur cette pub la convoyeuse se
    recolle à 0.95 d'un plan à l'autre pendant que deux hommes chauves à moustache qui
    ne se croisent jamais se collent à 1.0. Au-delà de la certitude du visage on demande
    donc confirmation à la silhouette — une chemise à fleurs et un gilet tactique ne
    sont pas le même homme. En deçà, le visage décide seul, comme avant."""
    return d > args.face_threshold and buste_ecart(ga, gb) > args.buste_accord

def cluster(keys, dist, thr, constrained=False, veto=None):
    groups = [[k] for k in keys]
    def gd(a, b): return float(np.mean([dist(i, j) for i in a for j in b]))
    def blocked(a, b, d):
        if constrained and any(conflict(i, j) for i in a for j in b): return True
        return bool(veto and veto(a, b, d))
    while True:
        bestp = None
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                d = gd(groups[i], groups[j])
                if d < thr and (bestp is None or d < bestp[0]) and not blocked(groups[i], groups[j], d): bestp = (d, i, j)
        if bestp is None: return groups
        _, i, j = bestp
        groups[i] += groups[j]; del groups[j]

face_groups = cluster(list(faces), lambda a, b: float(np.linalg.norm(faces[a] - faces[b])), max(args.face_threshold, args.face_merge), constrained=True, veto=veto_buste)
body_groups = cluster(list(bodies), lambda a, b: 1.0 - float(bodies[a] @ bodies[b]), args.body_threshold, constrained=True)

# ------------------------------------------------ la silhouette rejoint son visage --
# Un plan de dos de quelqu'un qu'on identifie ailleurs n'est pas un personnage de plus.
# Le visage ne peut pas le rattacher — il n'y en a pas — mais le buste, si. Sans ce
# recollement, --figurants garder ouvre une fiche par plan de dos et la distribution
# se met à compter double.
rattaches = []
for bg in list(body_groups):
    cand = [(buste_ecart(bg, fg), k) for k, fg in enumerate(face_groups)
            if not any(coexistent(a, b) for a in bg for b in fg)]
    if not cand: continue
    e, k = min(cand)
    if e <= args.buste_accord:
        face_groups[k] += bg
        body_groups.remove(bg)
        rattaches.append((bg, k, e))
if rattaches:
    print(f"{len(rattaches)} silhouette(s) rattachée(s) à un visage connu :", file=sys.stderr)
    for bg, k, e in rattaches: print(f"   pistes {bg} → groupe visage {k} (buste à {e:.2f})", file=sys.stderr)

# ce qu'on a obtenu : les groupes proches et pourquoi ils ne sont pas fusionnés
def gdist(ga, gb):   # les silhouettes rattachées n'ont pas de vecteur de visage
    ds = [np.linalg.norm(faces[a] - faces[b]) for a in ga if a in faces for b in gb if b in faces]
    return float(np.mean(ds)) if ds else float("inf")
pairs_dbg = sorted(((gdist(face_groups[i], face_groups[j]), i, j) for i in range(len(face_groups)) for j in range(i + 1, len(face_groups))))
for d, i, j in pairs_dbg[:6]:
    why = "coexistent côte à côte" if any(conflict(a, b) for a in face_groups[i] for b in face_groups[j]) else "distance trop grande"
    print(f"   groupes {i}~{j} : distance {d:.2f} — séparés ({why}) ({len(face_groups[i])}+{len(face_groups[j])} pistes)", file=sys.stderr)

def presence(g): return sum(len(tracks[t]) for t in g) / fps
people = [("visage", g) for g in face_groups] + [("buste", g) for g in body_groups]
people.sort(key=lambda kg: presence(kg[1]), reverse=True)

os.makedirs(args.portraits, exist_ok=True)
person_of_track, cast, ecartes = {}, [], []
n = 0
has_faces = any(k == "visage" for k, _ in people)
for kind, g in people:
    # Ce qui est écarté est DIT, pas effacé : sans cette trace, une distribution
    # amputée est indiscernable d'une distribution complète. Le compte part dans
    # le document et s'affiche sur la page.
    def ecarte(motif):
        ecartes.append({"par": kind, "pistes": g, "secondes": round(presence(g), 1), "motif": motif,
                        "de": round(min(tracks[t][0]["t"] for t in g), 1),
                        "a": round(max(tracks[t][-1]["t"] for t in g), 1)})
    if presence(g) < args.min_presence:
        ecarte(f"moins de {args.min_presence} s à l'image"); continue
    # Un personnage, c'est un visage — vrai pour une scène de dialogue face caméra,
    # FAUX dès qu'un rôle ne montre jamais son visage : masqué, de dos, en arrière-plan.
    # Ceux-là n'ont pas de vecteur de visage et tombaient tous ici, sans laisser de trace.
    # --figurants garder leur ouvre une fiche « silhouette ».
    if kind == "buste" and has_faces and args.figurants == "ecarter":
        ecarte("aucun visage exploitable (de dos, masqué, flou ou trop loin)"); continue
    n += 1; pid = f"P{n}"
    for t in g: person_of_track[t] = pid
    with_img = [t for t in g if best.get(t) is not None]
    lead = max(with_img, key=lambda t: best[t].shape[0] * best[t].shape[1]) if with_img else g[0]
    portrait = os.path.join(args.portraits, f"{pid}.jpg")
    if best.get(lead) is not None: cv2.imwrite(portrait, cv2.cvtColor(best[lead], cv2.COLOR_RGB2BGR))
    else: portrait = None
    span = (min(tracks[t][0]["t"] for t in g), max(tracks[t][-1]["t"] for t in g))
    cast.append({"id": pid, "name": pid, "note": f"{presence(g):.1f} s à l'image, {len(g)} piste(s), {span[0]:.1f}→{span[1]:.1f} s, identifié par le {kind}",
                 "tracks": g, "by": kind, "portrait": portrait})

MIN_SHARE = 0.25
for s in doc["shots"]:
    seen = {}
    for t, track in tracks.items():
        pid = person_of_track.get(t)
        if not pid: continue
        inside = sum(1 for d in track if s["start"] <= d["t"] < s["end"])
        if inside: seen[pid] = seen.get(pid, 0) + inside
    total = max(1.0, s["seconds"] * fps)
    s["subjects"] = [pid for pid, k in sorted(seen.items(), key=lambda kv: -kv[1]) if k / total >= MIN_SHARE]

doc["cast"] = cast
# Les figurants écartés : combien, combien de temps, et pourquoi. Le trombinoscope
# les affiche pour qu'une distribution incomplète se voie au lieu de se deviner.
doc["extras"] = ecartes
# Distances de visage entre personnages retenus : la bande ambiguë (≈ 0.95–1.35)
# sera tranchée deux par deux par le VLM (cast-pair.mjs), pas par un seuil global.
pv = {}
for c in cast:
    vs = [faces[t] for t in c["tracks"] if t in faces]
    if vs:
        m = np.mean(vs, axis=0); pv[c["id"]] = m / (np.linalg.norm(m) + 1e-9)
doc["faceDist"] = {f"{a}|{b}": round(float(np.linalg.norm(pv[a] - pv[b])), 3) for i, a in enumerate(pv) for b in list(pv)[i + 1:]}
doc.setdefault("provenance", {})["cast"] = (
    "yolo11m+bytetrack → mtcnn+facenet(vggface2) [visage] / dinov2 [buste] → regroupement"
    + (" ; figurants sans visage gardés" if args.figurants == "garder" else " ; figurants sans visage écartés"))
json.dump(doc, open(args.out or args.shots, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"{len(cast)} personnage(s), {len(ecartes)} figurant(s) écarté(s) :", file=sys.stderr)
for e in ecartes: print(f"   écarté — {e['secondes']} s, pistes {e['pistes']}, {e['de']}→{e['a']} s : {e['motif']}", file=sys.stderr)
for c in cast: print(f"   {c['id']:<4}{c['note']}  pistes {c['tracks']}", file=sys.stderr)
print(f"sujets posés sur {sum(1 for s in doc['shots'] if s['subjects'])}/{len(doc['shots'])} plans", file=sys.stderr)
