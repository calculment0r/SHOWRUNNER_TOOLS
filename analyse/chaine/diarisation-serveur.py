#!/usr/bin/env python3
"""
Diarisation Nemotron — le service que la page outils/diarisation/ appelle.

    ~/reelbench/nemo-env/bin/python ~/reelbench/skill/diarisation-serveur.py [--port 8448]

Le modèle : nvidia/Nemotron-3-Diarization — un Sortformer en flux (NeMo), huit voix
au plus, 16 kHz mono. Il ne rend pas des « tours de parole » mais, trame par trame,
une probabilité de parole pour chaque voix. Les voix sont numérotées dans l'ordre où
elles arrivent, et deux voix peuvent parler en même temps. Les segments se tirent de
ces probabilités par un seuil : la page le fait elle-même, pour qu'on puisse bouger
le seuil sans relancer le modèle. Le serveur renvoie aussi les segments de NeMo aux
réglages par défaut, pour que la page vérifie qu'elle retombe dessus.

Qui dit QUOI : avec ?transcrire=1, Whisper (large-v3-turbo, celui de la chaîne) passe
sur le même son après la diarisation et rend ses mots horodatés ; la page range chaque
mot sous la voix qui parle à cet instant. Sur un film déjà dépouillé, les répliques de la
chaîne font le même office sans rien transcrire.

  GET    /etat               le modèle, la machine, la file d'attente
  GET    /fichiers           les médias déjà sur la machine, sous --racine
  GET    /media/<chemin>     l'un d'eux, avec les requêtes partielles (saut dans la vidéo)
  POST   /analyse            un fichier en corps brut, ou ?chemin=… ; réglages en paramètres
                             (+ transcrire=1, langue=auto|fr|en…)
  GET    /travail/<id>       où en est l'analyse ; son résultat quand elle a fini
  DELETE /travail/<id>       l'annuler
  GET    /travaux            les analyses gardées sur la machine
  WS     /direct             le flux : micro ou lecture, PCM 16 bits à 16 kHz

Chaque route répond aussi sous /diarisation/… : publiée par Tailscale avec --set-path,
elle trouve son chemin que le préfixe arrive ou non.

Publier dans le tailnet SEULEMENT — c'est un GPU qui calcule pour qui l'appelle :

    tailscale serve --bg --https=10002 --set-path=/diarisation http://127.0.0.1:8448

Ni 443 ni 8443 : sur dgx1, les deux sont en Funnel (le 443 porte les corrections, REPRISE §6),
un chemin posé là serait public. Le 10002 ne peut pas passer en Funnel.

Le flux direct refait EXACTEMENT le découpage de NeMo hors ligne (streaming_feat_loader) :
mêmes morceaux, mêmes contextes gauche et droit, mêmes caches. Les descripteurs mel sont
calculés sur une fenêtre glissante — sans normalisation (normalize: NA), ils ne dépendent
que du voisinage — et la fenêtre déborde de huit trames de chaque côté, pour qu'aucune
trame gardée ne touche un bord. Vérifié : le direct rend les mêmes probabilités que
diarize() sur le même son.
"""
import argparse, asyncio, base64, json, math, os, queue, re, shutil, socket, subprocess, sys, threading, time, traceback, uuid
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import numpy as np

try:
    from aiohttp import web, WSMsgType
except ImportError:
    sys.exit("✗ aiohttp manque dans cet environnement : <env>/bin/pip install aiohttp")

ap = argparse.ArgumentParser(description="Diarisation Nemotron, servie à la page outils/diarisation/")
ap.add_argument("--port", type=int, default=8448)
ap.add_argument("--hote", default="127.0.0.1", help="n'écoute que la machine : Tailscale publie")
ap.add_argument("--modele", default="nvidia/Nemotron-3-Diarization", help="identifiant Hugging Face, ou fichier .nemo")
ap.add_argument("--racine", default=os.path.expanduser("~/reelbench/runs"), help="dossier dont les médias sont proposés à la page")
ap.add_argument("--travail", default=os.path.expanduser("~/reelbench/diarisation"), help="téléversements en cours et résultats gardés")
ap.add_argument("--max-mo", type=int, default=2048, help="taille maximale d'un fichier envoyé")
ap.add_argument("--max-minutes", type=float, default=240, help="durée maximale d'un son analysé")
ap.add_argument("--cle-fichier", default=None, help="fichier contenant une clé ; si posé, chaque appel doit la donner")
ap.add_argument("--cpu", action="store_true", help="forcer le processeur")
ap.add_argument("--sans-compilation", action="store_true",
                help="flex_attention sans torch.compile (repli automatique si la compilation échoue)")
ap.add_argument("--whisper", default="large-v3-turbo",
                help="modèle Whisper pour « transcrire » (nom ou fichier .pt) ; « non » pour s'en passer")
A = ap.parse_args()

TAUX = 16000
EXT_MEDIA = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus"}
REGLAGES = ("chunk_len", "chunk_right_context", "chunk_left_context", "fifo_len", "spkcache_len", "spkcache_update_period")
BORNES = {"chunk_len": (1, 4000), "chunk_right_context": (0, 1000), "chunk_left_context": (0, 1000),
          "fifo_len": (0, 4000), "spkcache_len": (1, 8000), "spkcache_update_period": (1, 8000)}
POST_DEFAUT = {"onset": 0.5, "offset": 0.5, "pad_onset": 0.0, "pad_offset": 0.0, "min_duration_on": 0.0, "min_duration_off": 0.0}
MAX_VALEURS = 4_000_000   # probabilités renvoyées (trames × voix) ; au-delà, regroupées par maximum
MARGE = 8                 # trames de débord de la fenêtre des descripteurs, de chaque côté
GARDES_EN_MEMOIRE = 8     # résultats complets gardés en mémoire ; les autres restent sur disque

os.makedirs(os.path.join(A.travail, "televersements"), exist_ok=True)
CLE = open(os.path.expanduser(A.cle_fichier)).read().strip() if A.cle_fichier else None
if A.cle_fichier and not CLE:
    sys.exit(f"✗ {A.cle_fichier} est vide")


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, file=sys.stderr, flush=True)


def trouve_ffmpeg():
    for c in (os.environ.get("FFMPEG"), shutil.which("ffmpeg")):
        if c and os.path.exists(c):
            return c
    try:  # le binaire que imageio-ffmpeg embarque, faute de mieux
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


FFMPEG = trouve_ffmpeg()


class Annulation(Exception):
    pass


class Etat:
    phase = "démarrage"       # démarrage → import → chargement → préchauffe → prêt | erreur
    erreur = None
    modele = None
    torch = None
    dev = "cpu"
    infos = {}
    defauts = {}
    verrou = threading.Lock()  # un seul calcul sur le GPU à la fois : analyse ou pas du direct
    file = queue.Queue()
    attente = []               # identifiants en file, dans l'ordre
    travaux = OrderedDict()
    en_cours = None
    direct = None
    index = []                 # ce qui est gardé sur disque : {id, nom, date, duree_s, latence_s}


E = Etat()


# ─────────────────────────────────────────────────────────────── le modèle ──

def infos_nemo():
    out = {}
    try:
        import nemo
        out["nemo"] = getattr(nemo, "__version__", "?")
    except Exception:
        return out
    try:  # installé depuis git : le commit est dans direct_url.json
        from importlib.metadata import distribution
        d = json.loads(distribution("nemo_toolkit").read_text("direct_url.json") or "{}")
        c = (d.get("vcs_info") or {}).get("commit_id")
        if c:
            out["nemo_commit"] = c[:10]
    except Exception:
        pass
    return out


def sans_compilation(pourquoi):
    """flex_attention compilé demande Triton ; s'il manque, on repasse en immédiat."""
    from torch.nn.attention.flex_attention import flex_attention
    for nom in ("nemo.collections.asr.modules.transformer_encoder_utils", "nemo.collections.asr.modules.transformer_encoder"):
        try:
            mod = __import__(nom, fromlist=["_"])
        except Exception:
            continue
        for attr in ("_flex_attention_compiled", "flex_attention_compiled"):
            if hasattr(mod, attr):
                setattr(mod, attr, flex_attention)
    E.infos["attention"] = f"flex_attention sans compilation ({pourquoi})"
    log("attention sans compilation :", pourquoi)


def installe_suivi():
    """La progression d'une analyse : NeMo passe chaque morceau par tqdm, on s'y glisse."""
    try:
        import nemo.collections.asr.models.sortformer_diar_models as sdm
    except Exception:
        return
    origine = sdm.tqdm

    def suivi(iterable=None, *a, total=None, **kw):
        job = E.en_cours
        if job is None or iterable is None:
            return origine(iterable, *a, total=total, **kw)

        def gen():
            for i, x in enumerate(iterable):
                if job.get("annule"):
                    raise Annulation()
                job["progression"] = i / total if total else None
                yield x
            job["progression"] = 1.0
        return gen()
    sdm.tqdm = suivi


def lire_defauts(m):
    sm = m.sortformer_modules
    return {k: int(getattr(sm, k)) for k in REGLAGES if hasattr(sm, k)}


def applique(reglages, verifier=False):
    """Pose les réglages de flux sur le modèle partagé. Appelé sous le verrou."""
    m = E.modele
    if not getattr(m, "streaming_mode", False):
        return
    sm = m.sortformer_modules
    for k in REGLAGES:
        if k in reglages:
            setattr(sm, k, int(reglages[k]))
    if verifier:
        (getattr(m, "_check_streaming_parameters", None) or sm._check_streaming_parameters)()


def charge_modele():
    try:
        E.phase = "import"
        import torch
        E.torch = torch
        E.dev = "cuda" if (torch.cuda.is_available() and not A.cpu) else "cpu"
        from nemo.collections.asr.models import SortformerEncLabelModel

        E.phase = "chargement"
        t0 = time.perf_counter()
        src = os.path.expanduser(A.modele)
        if os.path.isfile(src):
            m = SortformerEncLabelModel.restore_from(src, map_location=E.dev)
        else:
            m = SortformerEncLabelModel.from_pretrained(A.modele, map_location=E.dev)
        m.eval()
        # Hors apprentissage : ni bruit ajouté aux descripteurs, ni bourrage à 16 trames.
        f = getattr(m.preprocessor, "featurizer", None)
        if f is not None:
            if hasattr(f, "dither"):
                f.dither = 0.0
            if hasattr(f, "pad_to"):
                f.pad_to = 0
        E.modele = m
        cfg = m._cfg
        pas_pre = float(cfg.preprocessor.get("window_stride", 0.01))
        sous = int(getattr(m.encoder, "subsampling_factor", cfg.encoder.get("subsampling_factor", 8)))
        sortie = int(getattr(m, "output_subsampling_factor", sous))
        E.defauts = lire_defauts(m)
        E.infos = {
            "nom": A.modele if not os.path.isfile(src) else os.path.basename(src),
            "voix": int(m.sortformer_modules.n_spk),
            "trame_s": round(sortie * pas_pre, 6),
            "trame_encodeur_s": round(sous * pas_pre, 6),
            "pas_descripteurs_s": pas_pre,
            "en_flux": bool(getattr(m, "streaming_mode", False)),
            "flux_asynchrone": bool(getattr(m, "async_streaming", False)),
            "normalisation": str(cfg.preprocessor.get("normalize", "NA")),
            "reglages_defaut": E.defauts,
            "parametres_m": round(sum(p.numel() for p in m.parameters()) / 1e6, 1),
            "chargement_s": round(time.perf_counter() - t0, 1),
            "attention": "flex_attention compilé" if E.dev == "cuda" else "flex_attention (processeur)",
            **infos_nemo(),
            "torch": torch.__version__,
            "cuda": torch.version.cuda,
            "appareil": torch.cuda.get_device_name(0) if E.dev == "cuda" else "processeur",
        }
        if E.dev == "cuda":
            E.infos["memoire_go"] = round(torch.cuda.get_device_properties(0).total_memory / 2**30, 1)
        installe_suivi()
        if A.sans_compilation and E.dev == "cuda":
            sans_compilation("demandé")

        # Préchauffe : la première passe compile flex_attention (Triton). Si elle casse,
        # on repasse en immédiat et on réessaie — mieux vaut lent que muet.
        E.phase = "préchauffe"
        bruit = (np.random.default_rng(0).standard_normal(TAUX * 3) * 0.01).astype(np.float32)
        with E.verrou:
            try:
                diarise(bruit, E.defauts)
            except Exception as e:
                if E.dev != "cuda" or "sans compilation" in E.infos.get("attention", ""):
                    raise
                traceback.print_exc()
                sans_compilation(f"{type(e).__name__}: {str(e)[:160]}")
                diarise(bruit, E.defauts)
        E.phase = "prêt"
        log(f"prêt : {E.infos['nom']} — {E.infos['voix']} voix, trame {E.infos['trame_s']} s, "
            f"{E.infos['appareil']}, {E.infos['attention']}, NeMo {E.infos.get('nemo')} {E.infos.get('nemo_commit', '')}")
    except Exception as e:
        E.phase = "erreur"
        E.erreur = f"{type(e).__name__}: {e}"
        traceback.print_exc()
        log("✗ le modèle ne se charge pas :", E.erreur)


# ─────────────────────────────────────────────────────── son et calcul ──

def decode(chemin):
    """N'importe quel média → 16 kHz mono float32. ffmpeg fait tout."""
    if not FFMPEG:
        raise RuntimeError("ffmpeg introuvable sur la machine")
    limite = int(A.max_minutes * 60) + 1
    cmd = [FFMPEG, "-nostdin", "-v", "error", "-i", chemin, "-t", str(limite),
           "-vn", "-ac", "1", "-ar", str(TAUX), "-f", "f32le", "-"]
    p = subprocess.run(cmd, capture_output=True)
    if p.returncode != 0:
        raise RuntimeError("ffmpeg : " + p.stderr.decode(errors="replace").strip()[-400:])
    x = np.frombuffer(p.stdout, dtype="<f4").copy()
    if x.size < TAUX // 10:
        raise RuntimeError("aucun son exploitable dans ce fichier")
    if x.size >= limite * TAUX:
        raise RuntimeError(f"plus de {A.max_minutes:g} minutes : trop long pour ce service (--max-minutes)")
    return x


def enveloppe(x, pas=320):
    """La forme d'onde pour la page : la crête toutes les 20 ms, ramenée à 0-255."""
    n = len(x) // pas
    v = np.abs(x[: n * pas]).reshape(n, pas).max(axis=1) if n else np.zeros(0, np.float32)
    crete = float(v.max()) if n else 0.0
    q = np.clip(np.round(v / max(crete, 1e-6) * 255), 0, 255).astype(np.uint8)
    return {"pas_s": pas / TAUX, "n": int(n), "crete": round(crete, 4), "q": base64.b64encode(q.tobytes()).decode()}


def quantifie(p, trame):
    """Probabilités (trames × voix) → octets 0-255 ; regroupées par maximum si trop longues."""
    T, S = p.shape
    k = max(1, math.ceil(T * S / MAX_VALEURS))
    if k > 1:
        n = math.ceil(T / k) * k
        p = np.pad(p, ((0, n - T), (0, 0))).reshape(n // k, k, S).max(axis=1)
    q = np.clip(np.round(p * 255), 0, 255).astype(np.uint8)
    return {"pas_s": trame * k, "n": int(q.shape[0]), "voix": int(S), "regroupement": int(k),
            "q": base64.b64encode(q.tobytes()).decode()}


def diarise(x, reglages):
    """diarize() de NeMo, tel quel. Appelé sous le verrou."""
    m, torch = E.modele, E.torch
    applique(reglages, verifier=True)
    t0 = time.perf_counter()
    lignes, probas = m.diarize(audio=[x], sample_rate=TAUX, batch_size=1, include_tensor_outputs=True,
                               num_workers=0, verbose=False)
    if E.dev == "cuda":
        torch.cuda.synchronize()
    dt = time.perf_counter() - t0
    p = probas[0]
    p = (p[0] if p.dim() == 3 else p).float().cpu().numpy()
    segments = []
    for ligne in lignes[0]:
        a, b, spk = ligne.split()
        segments.append([float(a), float(b), int(spk.rsplit("_", 1)[-1])])
    return p, segments, dt


W = {"modele": None}
# Whisper hallucine sur le silence et la musique — même filtre que whisper-run.py.
HALLU = re.compile(r"sous-?titr|subtitl|radio-canada|amara\.org|merci d.avoir regard|thanks for watching|abonnez|like et|^\W*$", re.I)


def whisper_possible():
    if A.whisper == "non":
        return False
    try:
        import whisper  # noqa: F401
        return True
    except Exception:
        return False


def transcrit(x, langue):
    """Whisper sur le son déjà décodé : segments et mots horodatés. Appelé sous le verrou."""
    import whisper
    if W["modele"] is None:
        W["modele"] = whisper.load_model(A.whisper, device=E.dev)
    t0 = time.perf_counter()
    r = W["modele"].transcribe(x, language=None if langue in (None, "", "auto") else langue,
                               word_timestamps=True, fp16=E.dev == "cuda", verbose=None)
    segs = []
    for s in r.get("segments", []):
        txt = s["text"].strip()
        if HALLU.search(txt) or not any(c.isalpha() for c in txt):
            continue
        segs.append({"a": round(s["start"], 3), "b": round(s["end"], 3), "texte": txt,
                     "mots": [[w["word"].strip(), round(w["start"], 3), round(w["end"], 3)] for w in s.get("words", [])]})
    return {"langue": r.get("language"), "modele": os.path.basename(A.whisper),
            "calcul_s": round(time.perf_counter() - t0, 2), "segments": segs}


def latence(reglages):
    if not E.infos.get("en_flux"):
        return None
    return round((reglages["chunk_len"] + reglages["chunk_right_context"]) * E.infos["trame_encodeur_s"], 3)


def execute(job):
    job["etat"] = "décodage"
    t0 = time.perf_counter()
    x = decode(job["fichier"])
    t_dec = time.perf_counter() - t0
    if job.get("temporaire"):
        try:
            os.unlink(job["fichier"])
        except OSError:
            pass
    if job.get("annule"):
        raise Annulation()
    job["etat"] = "diarisation"
    job["progression"] = 0.0
    with E.verrou:
        p, segments, t_dia = diarise(x, job["reglages"])
    duree = len(x) / TAUX
    trame = E.infos["trame_s"]
    res = {
        "id": job["id"], "nom": job["nom"], "source": job["source"], "chemin": job.get("chemin"),
        "date": time.strftime("%Y-%m-%dT%H:%M:%S"), "machine": socket.gethostname(),
        "duree_s": round(duree, 3), "voix": int(p.shape[1]), "trame_s": trame, "trames": int(p.shape[0]),
        "reglages": job["reglages"], "latence_s": latence(job["reglages"]),
        "post_nemo": POST_DEFAUT, "segments_nemo": segments,
        "probas": quantifie(p, trame), "enveloppe": enveloppe(x),
        "calcul": {"decodage_s": round(t_dec, 2), "diarisation_s": round(t_dia, 3),
                   "rtfx": round(duree / max(t_dia, 1e-6), 1), "appareil": E.infos.get("appareil"),
                   "attention": E.infos.get("attention")},
        "modele": {k: E.infos.get(k) for k in ("nom", "nemo", "nemo_commit", "torch", "cuda")},
    }
    if job.get("transcrire"):
        if job.get("annule"):
            raise Annulation()
        job["etat"] = "transcription"
        job["progression"] = None
        try:
            with E.verrou:
                res["transcription"] = transcrit(x, job.get("langue"))
        except Exception as e:  # la diarisation est faite : on la rend quand même, en disant pourquoi il manque le texte
            traceback.print_exc()
            res["transcription"] = {"erreur": f"{type(e).__name__}: {e}"}
    job["resultat"] = res
    job["etat"] = "fini"
    job["progression"] = 1.0
    garde_sur_disque(res)
    tr = res.get("transcription") or {}
    log(f"fini {job['id']} « {job['nom']} » : {duree:.1f} s de son, {t_dia:.2f} s de calcul "
        f"(×{res['calcul']['rtfx']:g}), {len(segments)} segments NeMo"
        + (f", {len(tr.get('segments', []))} segments Whisper ({tr.get('langue')})" if tr.get("segments") is not None else "")
        + (f", transcription en échec : {tr['erreur']}" if tr.get("erreur") else ""))


def travailleur():
    while True:
        jid = E.file.get()
        job = E.travaux.get(jid)
        if jid in E.attente:
            E.attente.remove(jid)
        if not job or job["etat"] != "attente":
            continue
        while E.phase not in ("prêt", "erreur"):
            time.sleep(0.5)
        E.en_cours = job
        try:
            if E.phase == "erreur":
                raise RuntimeError(f"le modèle ne s'est pas chargé — {E.erreur}")
            execute(job)
        except Annulation:
            job["etat"] = "annulé"
            log(f"annulé {jid}")
        except Exception as e:
            job["etat"] = "erreur"
            job["erreur"] = f"{type(e).__name__}: {e}"
            traceback.print_exc()
        finally:
            E.en_cours = None
            if job.get("temporaire") and os.path.exists(job["fichier"]):
                try:
                    os.unlink(job["fichier"])
                except OSError:
                    pass
            # les résultats lourds ne restent pas tous en mémoire : le disque les garde
            finis = [k for k, j in E.travaux.items() if j.get("resultat")]
            for k in finis[:-GARDES_EN_MEMOIRE]:
                E.travaux[k].pop("resultat", None)


# ─────────────────────────────────────────────────────── ce qui est gardé ──

def fichier_resultat(jid):
    return os.path.join(A.travail, f"{jid}.json")


def garde_sur_disque(res):
    with open(fichier_resultat(res["id"]), "w") as f:
        json.dump(res, f)
    meta = {k: res.get(k) for k in ("id", "nom", "date", "duree_s", "latence_s", "machine")}
    with open(os.path.join(A.travail, f"{res['id']}.meta.json"), "w") as f:
        json.dump(meta, f)
    E.index.insert(0, meta)


def relit_index():
    metas = []
    for nom in os.listdir(A.travail):
        if nom.endswith(".meta.json"):
            try:
                metas.append(json.load(open(os.path.join(A.travail, nom))))
            except Exception:
                pass
    E.index = sorted(metas, key=lambda m: m.get("date") or "", reverse=True)


# ─────────────────────────────────────────────────────────── le direct ──

class Direct:
    """Une session en flux. Le son arrive en PCM 16 bits ; chaque morceau prêt — contexte
    droit compris — passe par forward_streaming_step, comme hors ligne."""

    def __init__(self, reglages):
        m = E.modele
        cfg = m._cfg.preprocessor
        self.r = reglages
        self.sous = int(m.encoder.subsampling_factor)
        self.hop = int(round(float(cfg.get("window_stride", 0.01)) * TAUX))
        self.nfft = int(cfg.get("n_fft", 512))
        self.fsortie = max(1, int(round(E.infos["trame_s"] / E.infos["pas_descripteurs_s"])))
        self.voix = E.infos["voix"]
        self.buf = np.zeros(0, np.float32)
        self.base = 0          # indice global du premier échantillon gardé
        self.n = 0             # échantillons reçus
        self.k = 0             # morceaux traités
        self.sorties = 0       # trames de probabilité rendues
        self.etat = None
        self.calcul_ms = []
        self.debut = time.time()

    def ajoute(self, pcm):
        if len(pcm) % 2:
            pcm = pcm[:-1]
        x = np.frombuffer(pcm, "<i2").astype(np.float32) / 32768.0
        self.buf = np.concatenate([self.buf, x])
        self.n += len(x)

    def _trames(self, n):
        """Combien de trames de descripteurs NeMo tire de n échantillons — sa règle, pas la nôtre."""
        f = getattr(E.modele.preprocessor, "featurizer", None)
        if f is not None and hasattr(f, "get_seq_len"):
            return int(f.get_seq_len(E.torch.tensor([n]))[0])
        return n // self.hop

    def _descripteurs(self, s0, s1):
        torch = E.torch
        sig = torch.from_numpy(np.ascontiguousarray(self.buf[s0 - self.base:s1 - self.base])).to(E.dev).unsqueeze(0)
        ln = torch.tensor([sig.shape[1]], device=E.dev)
        f, fl = E.modele.preprocessor(input_signal=sig, length=ln)
        return f[:, :, : int(fl.max())]

    def traite(self, fin=False):
        """Tous les morceaux prêts ; renvoie les messages pour la page."""
        torch, m = E.torch, E.modele
        C, LC, RC = self.r["chunk_len"], self.r["chunk_left_context"], self.r["chunk_right_context"]
        S, hop = self.sous, self.hop
        msgs = []
        with E.verrou, torch.inference_mode():
            applique(self.r)
            if self.etat is None:
                self.etat = m.sortformer_modules.init_streaming_state(
                    batch_size=1, async_streaming=getattr(m, "async_streaming", False), device=E.dev)
            while True:
                stt = self.k * C * S
                if fin:
                    F = self._trames(self.n)
                    if stt >= F:
                        break
                    end = min(stt + C * S, F)
                    ro = min(RC * S, F - end)
                    s1 = self.n
                else:
                    end, ro = stt + C * S, RC * S
                    # une trame est sûre quand toute sa fenêtre d'analyse est arrivée
                    if (end + ro) * hop + self.nfft // 2 + hop > self.n:
                        break
                    s1 = (end + ro) * hop + self.nfft // 2 + hop
                lo = min(LC * S, stt)
                a, b = stt - lo, end + ro
                s0 = max(0, (a - MARGE) * hop)
                t0 = time.perf_counter()
                f = self._descripteurs(s0, s1)
                j0 = a - s0 // hop
                morceau = f[:, :, j0:j0 + (b - a)].transpose(1, 2)
                vide = torch.zeros((1, 0, self.voix), device=E.dev)
                self.etat, preds = m.forward_streaming_step(
                    processed_signal=morceau,
                    processed_signal_length=torch.tensor([b - a], device=E.dev),
                    streaming_state=self.etat, total_preds=vide, left_offset=lo, right_offset=ro)
                p = preds[0].float().cpu().numpy()
                if fin:  # comme hors ligne : pas plus de trames que le son n'en porte
                    reste = math.ceil(self._trames(self.n) / self.fsortie) - self.sorties
                    p = p[:max(0, reste)]
                dt = (time.perf_counter() - t0) * 1000
                self.calcul_ms.append(dt)
                q = np.clip(np.round(p * 255), 0, 255).astype(np.uint8)
                msgs.append({"type": "probas", "debut": self.sorties, "n": int(q.shape[0]),
                             "q": base64.b64encode(q.tobytes()).decode(), "calcul_ms": round(dt, 2),
                             "son_s": round(min(self.n, b * hop) / TAUX, 3)})
                self.sorties += int(q.shape[0])
                self.k += 1
                # on oublie le son dont plus aucun morceau n'aura besoin
                prochain = max(0, ((self.k * C - LC) * S - MARGE) * hop)
                coupe = prochain - self.base
                if coupe > 0:
                    self.buf = self.buf[coupe:]
                    self.base += coupe
        return msgs

    def bilan(self):
        c = self.calcul_ms or [0.0]
        return {"morceaux": self.k, "trames": self.sorties, "son_s": round(self.n / TAUX, 2),
                "calcul_moyen_ms": round(float(np.mean(c)), 2), "calcul_max_ms": round(float(np.max(c)), 2)}


# ─────────────────────────────────────────────────────────────── HTTP ──

POOL = ThreadPoolExecutor(max_workers=1)


def entier(v, k):
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise ValueError(f"{k} doit être un entier")
    lo, hi = BORNES[k]
    if not lo <= n <= hi:
        raise ValueError(f"{k} doit être entre {lo} et {hi}")
    return n


def lit_reglages(src):
    r = dict(E.defauts)
    for k in REGLAGES:
        if src.get(k) not in (None, ""):
            r[k] = entier(src.get(k), k)
    return r


def dans_racine(rel):
    """Un chemin relatif à --racine, et qui y reste."""
    racine = os.path.realpath(A.racine)
    p = os.path.realpath(os.path.join(racine, rel.lstrip("/")))
    if not (p == racine or p.startswith(racine + os.sep)):
        return None
    return p


def autorise(request):
    return not CLE or request.headers.get("X-Cle") == CLE or request.query.get("cle") == CLE


@web.middleware
async def entetes(request, handler):
    if request.method == "OPTIONS":
        resp = web.Response(status=204)
    elif not autorise(request):
        resp = web.json_response({"erreur": "clé absente ou fausse", "cle": True}, status=401)
    else:
        try:
            resp = await handler(request)
        except web.HTTPException as e:
            resp = web.json_response({"erreur": e.reason}, status=e.status)
        except Exception as e:
            traceback.print_exc()
            resp = web.json_response({"erreur": f"{type(e).__name__}: {e}"}, status=500)
    if isinstance(resp, web.WebSocketResponse) or resp.prepared:
        return resp
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "content-type, x-cle"
    # la page vient d'internet, la machine est dans le tailnet : Chrome demande ce feu vert
    resp.headers["Access-Control-Allow-Private-Network"] = "true"
    resp.headers["Access-Control-Max-Age"] = "600"
    resp.headers.setdefault("Cache-Control", "no-store")
    return resp


def resume(job):
    out = {k: job.get(k) for k in ("id", "nom", "etat", "progression", "erreur", "source")}
    if job["etat"] == "attente" and job["id"] in E.attente:
        out["position"] = E.attente.index(job["id"]) + 1
    return out


async def etat(request):
    en_cours = resume(E.en_cours) if E.en_cours else None
    return web.json_response({
        "service": "diarisation", "version": 1, "machine": socket.gethostname(),
        "phase": E.phase, "pret": E.phase == "prêt", "erreur": E.erreur,
        "modele": E.infos, "ffmpeg": bool(FFMPEG),
        "file": {"en_cours": en_cours, "attente": len(E.attente)},
        "direct": E.direct is not None,
        "limites": {"max_mo": A.max_mo, "max_minutes": A.max_minutes},
        "racine": os.path.isdir(A.racine), "cle": bool(CLE),
        "transcription": {"possible": WHISPER_POSSIBLE, "modele": os.path.basename(A.whisper), "chargee": W["modele"] is not None},
    })


async def fichiers(request):
    racine = os.path.realpath(A.racine)
    out = []
    if os.path.isdir(racine):
        for dossier, sous, noms in os.walk(racine):
            prof = os.path.relpath(dossier, racine).count(os.sep)
            if prof >= 3:
                sous[:] = []
            sous[:] = [d for d in sous if not d.startswith(".") and d not in ("frames", "overlays", "portraits", "sheet", "seed")]
            for n in noms:
                if os.path.splitext(n)[1].lower() in EXT_MEDIA and not n.startswith("."):
                    p = os.path.join(dossier, n)
                    st = os.stat(p)
                    out.append({"chemin": os.path.relpath(p, racine), "mo": round(st.st_size / 2**20, 1),
                                "date": time.strftime("%Y-%m-%d %H:%M", time.localtime(st.st_mtime)), "_t": st.st_mtime})
    out.sort(key=lambda f: f["_t"], reverse=True)
    for f in out:
        f.pop("_t")
    return web.json_response({"racine": A.racine, "fichiers": out[:300]})


async def media(request):
    p = dans_racine(request.match_info["chemin"])
    if not p or not os.path.isfile(p) or os.path.splitext(p)[1].lower() not in EXT_MEDIA:
        return web.json_response({"erreur": "média introuvable"}, status=404)
    return web.FileResponse(p, headers={"Cache-Control": "no-cache"})


def nouveau_job(nom, reglages, source):
    jid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    job = {"id": jid, "nom": nom[:200], "etat": "attente", "progression": None, "reglages": reglages,
           "source": source, "erreur": None}
    E.travaux[jid] = job
    return job


async def analyse(request):
    if E.phase == "erreur":
        return web.json_response({"erreur": f"le modèle ne s'est pas chargé — {E.erreur}"}, status=503)
    q = request.query
    try:
        reglages = lit_reglages(q)
    except ValueError as e:
        return web.json_response({"erreur": str(e)}, status=400)
    transcrire = q.get("transcrire", "") in ("1", "oui", "true")
    langue = (q.get("langue") or "auto").lower()
    if not re.fullmatch(r"auto|[a-z]{2,3}", langue):
        return web.json_response({"erreur": "langue : auto, ou un code comme fr, en"}, status=400)
    if transcrire and not WHISPER_POSSIBLE:
        return web.json_response({"erreur": "Whisper n'est pas disponible sur cette machine (--whisper non, ou paquet absent)"}, status=400)
    if q.get("chemin"):
        p = dans_racine(q["chemin"])
        if not p or not os.path.isfile(p):
            return web.json_response({"erreur": "fichier introuvable sous la racine"}, status=404)
        job = nouveau_job(q.get("nom") or os.path.basename(p), reglages, "machine")
        job.update(fichier=p, chemin=q["chemin"], temporaire=False)
    else:
        nom = q.get("nom") or "sans nom"
        ext = os.path.splitext(nom)[1].lower()
        job = nouveau_job(nom, reglages, "téléversement")
        dest = os.path.join(A.travail, "televersements", job["id"] + (ext if ext in EXT_MEDIA else ".bin"))
        limite, taille = A.max_mo * 2**20, 0
        try:
            with open(dest, "wb") as f:
                async for bloc in request.content.iter_chunked(1 << 20):
                    taille += len(bloc)
                    if taille > limite:
                        raise ValueError(f"plus de {A.max_mo} Mo (--max-mo)")
                    f.write(bloc)
            if taille == 0:
                raise ValueError("fichier vide")
        except Exception as e:
            E.travaux.pop(job["id"], None)
            if os.path.exists(dest):
                os.unlink(dest)
            return web.json_response({"erreur": str(e)}, status=413 if "Mo" in str(e) else 400)
        job.update(fichier=dest, temporaire=True, mo=round(taille / 2**20, 1))
    job.update(transcrire=transcrire, langue=langue)
    E.attente.append(job["id"])
    E.file.put(job["id"])
    log(f"reçu {job['id']} « {job['nom']} » — {reglages}")
    return web.json_response(resume(job), status=202)


async def travail(request):
    jid = request.match_info["id"]
    job = E.travaux.get(jid)
    if request.method == "DELETE":
        if not job:
            return web.json_response({"erreur": "inconnu"}, status=404)
        job["annule"] = True
        if job["etat"] == "attente":
            job["etat"] = "annulé"
            if jid in E.attente:
                E.attente.remove(jid)
        return web.json_response(resume(job))
    if job and job.get("resultat") is not None:
        return web.json_response({**resume(job), "resultat": job["resultat"]})
    if job and job["etat"] != "fini":
        return web.json_response(resume(job))
    f = fichier_resultat(jid) if all(c.isalnum() or c == "-" for c in jid) else None
    if f and os.path.exists(f):
        with open(f) as fh:
            res = json.load(fh)
        return web.json_response({"id": jid, "nom": res.get("nom"), "etat": "fini", "progression": 1.0, "resultat": res})
    return web.json_response({"erreur": "analyse inconnue"}, status=404)


async def travaux(request):
    return web.json_response({"travaux": E.index[:50]})


async def direct(request):
    ws = web.WebSocketResponse(heartbeat=20, max_msg_size=8 << 20)
    await ws.prepare(request)
    if not autorise(request):
        await ws.send_json({"type": "erreur", "message": "clé absente ou fausse"})
        await ws.close()
        return ws
    if E.phase != "prêt":
        await ws.send_json({"type": "erreur", "message": f"modèle pas prêt ({E.phase})"})
        await ws.close()
        return ws
    if not E.infos.get("en_flux"):
        await ws.send_json({"type": "erreur", "message": "ce modèle n'a pas de mode flux"})
        await ws.close()
        return ws
    if E.direct is not None:
        await ws.send_json({"type": "erreur", "message": "un direct tourne déjà sur cette machine"})
        await ws.close()
        return ws
    boucle = asyncio.get_running_loop()
    sess = None
    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                d = json.loads(msg.data)
                if d.get("type") == "debut" and sess is None:
                    if int(d.get("taux", TAUX)) != TAUX:
                        await ws.send_json({"type": "erreur", "message": f"le son doit arriver à {TAUX} Hz"})
                        break
                    try:
                        reglages = lit_reglages(d.get("reglages") or {})
                        def verifie():
                            with E.verrou:
                                applique(reglages, verifier=True)
                        await boucle.run_in_executor(POOL, verifie)
                    except Exception as e:
                        await ws.send_json({"type": "erreur", "message": str(e)})
                        break
                    sess = Direct(reglages)
                    E.direct = sess
                    await ws.send_json({"type": "pret", "voix": sess.voix, "trame_s": E.infos["trame_s"],
                                        "latence_s": latence(reglages), "reglages": reglages,
                                        "appareil": E.infos.get("appareil")})
                    log(f"direct : début — {reglages}")
                elif d.get("type") == "fin" and sess is not None:
                    for m in await boucle.run_in_executor(POOL, sess.traite, True):
                        await ws.send_json(m)
                    await ws.send_json({"type": "fin", **sess.bilan()})
                    log(f"direct : fin — {sess.bilan()}")
                    break
            elif msg.type == WSMsgType.BINARY and sess is not None:
                sess.ajoute(msg.data)
                for m in await boucle.run_in_executor(POOL, sess.traite, False):
                    await ws.send_json(m)
            elif msg.type == WSMsgType.ERROR:
                break
    except Exception as e:
        traceback.print_exc()
        if not ws.closed:
            await ws.send_json({"type": "erreur", "message": f"{type(e).__name__}: {e}"})
    finally:
        if E.direct is sess:
            E.direct = None
    if not ws.closed:
        await ws.close()
    return ws


def application():
    app = web.Application(middlewares=[entetes], client_max_size=4 * 2**20)
    for prefixe in ("", "/diarisation"):
        app.router.add_get(prefixe + "/etat", etat)
        app.router.add_get(prefixe + "/fichiers", fichiers)
        app.router.add_get(prefixe + "/media/{chemin:.+}", media)
        app.router.add_post(prefixe + "/analyse", analyse)
        app.router.add_get(prefixe + "/travail/{id}", travail)
        app.router.add_delete(prefixe + "/travail/{id}", travail)
        app.router.add_get(prefixe + "/travaux", travaux)
        app.router.add_get(prefixe + "/direct", direct)
    return app


if __name__ == "__main__":
    WHISPER_POSSIBLE = whisper_possible()
    relit_index()
    threading.Thread(target=charge_modele, daemon=True).start()
    threading.Thread(target=travailleur, daemon=True).start()
    log(f"diarisation : http://{A.hote}:{A.port}/etat — modèle {A.modele}, racine {A.racine}"
        + (" — clé exigée" if CLE else ""))
    web.run_app(application(), host=A.hote, port=A.port, print=None, access_log=None)
