#!/usr/bin/env python3
"""
Éprouver la diarisation Nemotron sur la machine, avec le VRAI modèle.

    ~/reelbench/nemo-env/bin/python ~/reelbench/skill/diarisation-essai.py [film.mp4] [--secondes 90]

Pour chaque latence : diarize() de NeMo dans ce processus, puis le même son envoyé au
service en direct (WebSocket, paquets de taille quelconque, comme un micro) — et les deux
doivent rendre les mêmes probabilités. C'est ce qui garantit que l'onglet Direct de la page
montre ce que le modèle rend vraiment, et pas une approximation.

Sur le processeur, avec un modèle de test à poids aléatoires, l'écart mesuré a été nul, trame
pour trame, pour 0,32 s, 1,04 s et 30,4 s. Sur le GPU, un écart de ±1 (sur 255) peut venir des
noyaux ; au-delà, quelque chose ne va pas.

Sans film en argument, prend le plus récent sous ~/reelbench/runs. Le service doit tourner
(diarisation-serveur.py) ; son modèle doit être celui de --modele.
"""
import argparse, asyncio, base64, json, os, subprocess, sys, time
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("film", nargs="?")
ap.add_argument("--service", default="http://127.0.0.1:8448")
ap.add_argument("--modele", default="nvidia/Nemotron-3-Diarization")
ap.add_argument("--secondes", type=float, default=90)
ap.add_argument("--latences", default="0.32,1.04,30.4")
A = ap.parse_args()

PRESETS = {"0.32": dict(chunk_len=3, chunk_right_context=1, fifo_len=188, spkcache_update_period=144),
           "1.04": dict(chunk_len=6, chunk_right_context=7, fifo_len=188, spkcache_update_period=144),
           "10": dict(chunk_len=124, chunk_right_context=1, fifo_len=124, spkcache_update_period=124),
           "30.4": dict(chunk_len=340, chunk_right_context=40, fifo_len=40, spkcache_update_period=300)}

film = A.film
if not film:
    racine = os.path.expanduser("~/reelbench/runs")
    cands = [os.path.join(d, n) for d, _, ns in os.walk(racine) for n in ns if n.lower().endswith((".mp4", ".mov", ".mkv", ".wav"))]
    if not cands:
        sys.exit(f"✗ aucun film sous {racine} : donner un fichier en argument")
    film = max(cands, key=os.path.getmtime)
raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", film, "-t", str(A.secondes), "-vn", "-ac", "1", "-ar", "16000",
                      "-f", "s16le", "-"], capture_output=True, check=True).stdout
pcm = np.frombuffer(raw, "<i2")
x = pcm.astype(np.float32) / 32768.0   # le même son que le direct : quantifié 16 bits
print(f"film : {film} — {len(pcm) / 16000:.1f} s")

import torch
import aiohttp
from nemo.collections.asr.models import SortformerEncLabelModel as M
dev = "cuda" if torch.cuda.is_available() else "cpu"
m = M.restore_from(A.modele, map_location=dev) if os.path.isfile(A.modele) else M.from_pretrained(A.modele, map_location=dev)
m.eval()
defauts = {k: getattr(m.sortformer_modules, k) for k in ("chunk_len", "chunk_right_context", "chunk_left_context", "fifo_len", "spkcache_len", "spkcache_update_period")}


async def direct(reglages):
    got, calc = {}, []
    rng = np.random.default_rng(1)
    url = A.service.rstrip("/").replace("http", "ws", 1) + "/direct"
    async with aiohttp.ClientSession() as s:
        async with s.ws_connect(url, max_msg_size=64 << 20) as ws:
            await ws.send_json({"type": "debut", "taux": 16000, "reglages": reglages})
            m0 = await ws.receive_json()
            if m0.get("type") != "pret":
                raise RuntimeError(f"le service refuse : {m0}")

            async def lire():
                async for msg in ws:
                    d = json.loads(msg.data)
                    if d["type"] == "probas":
                        q = np.frombuffer(base64.b64decode(d["q"]), np.uint8).reshape(d["n"], -1)
                        for k in range(d["n"]):
                            got[d["debut"] + k] = q[k]
                        calc.append(d["calcul_ms"])
                    elif d["type"] in ("fin", "erreur"):
                        return d
            lecteur = asyncio.create_task(lire())
            i = 0
            while i < len(pcm):
                n = int(rng.integers(300, 6000))
                await ws.send_bytes(pcm[i:i + n].tobytes())
                i += n
            await ws.send_json({"type": "fin"})
            fin = await lecteur
    return np.array([got[k] for k in sorted(got)]), calc, fin


print(f"{'latence':>8} {'trames':>7} {'hors ligne':>11} {'direct/morceau':>15} {'écart max':>10} {'trames ≠':>9} {'voix':>5}")
for lat in A.latences.split(","):
    r = dict(defauts, **PRESETS[lat])
    for k, v in r.items():
        setattr(m.sortformer_modules, k, v)
    t = time.time()
    _, probas = m.diarize(audio=[x], sample_rate=16000, batch_size=1, include_tensor_outputs=True, num_workers=0, verbose=False)
    if dev == "cuda":
        torch.cuda.synchronize()
    dt = time.time() - t
    p = probas[0][0].float().cpu().numpy()
    ref = np.clip(np.round(p * 255), 0, 255).astype(np.uint8)
    live, calc, fin = asyncio.run(direct(r))
    n = min(len(live), len(ref))
    d = np.abs(live[:n].astype(int) - ref[:n].astype(int))
    voix = int(((p > 0.5).sum(0) > 50).sum())
    print(f"{lat + ' s':>8} {len(ref):>7} {'×%.0f' % (len(x) / 16000 / dt):>11} {'%.1f ms' % np.mean(calc):>15} "
          f"{d.max() if n else '—':>10} {int((d > 1).any(1).sum()) if n else '—':>9} {voix:>5}"
          + ("" if len(live) == len(ref) else f"   ⚠ {len(live)} trames en direct contre {len(ref)}"))
print("écart max ≤ 1 : le direct rend ce que rend le fichier. Au-delà : à regarder avant de croire la page.")
