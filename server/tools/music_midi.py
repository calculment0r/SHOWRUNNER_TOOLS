"""ODIO : le MIDI — extraire les notes d'un clip audio, ranger nos clips de
notes, les relire.

  music.midi       notes (basic-pitch), batterie (ADTOF), piano (ByteDance)
  music.midi.abc   partition (SheetSage2 par ComfyUI : chant, thème, accords)
                   {"src": un son, "off_s", "dur_s": la région du clip dans le
                   son, "bpm", "sig", "tonic", "mode", "engine", "v"}
                   -> un fichier MIDI (format 0, au tempo du projet) dans la
                      bibliothèque du portail, sorte « midi » (core/library.py,
                      ajoutée le 29/09) ; la page le pose en clips de notes
                      sur des pistes d'instrument sous le clip audio

Le fichier MIDI s'écrit et se lit ici seulement (une seule vérité) : la page
reçoit et envoie des notes en temps (noires) ; le serveur écrit le fichier
standard (SMF de la spécification MIDI 1.0 : MThd, MTrk, delta-temps en
quantité de longueur variable). Canaux : 0 le chant (ou les notes), 1 le
thème, 2 les accords, 9 la batterie (la convention General MIDI).

Moteurs (showrunner.local.json, lu au démarrage) :

  factice (défaut)     voie `cpu` : les attaques par l'énergie, la hauteur par
                       les passages à zéro, ramenée à la gamme du projet — pas
                       une transcription, un repère (sur un son d'essai fait de
                       sinus, il retrouve les notes) ; « séparer d'abord »
                       passe le filtre d'essai du stem (music_stems.py).
  "music_midi": true   basic-pitch 0.4.0 (Apache 2.0) par son lanceur
                       ~/audio-studio/.venv/bin/basic-pitch (voie `cpu`, modèle
                       ONNX dans le paquet : aucun téléchargement) ; SheetSage2
                       par ComfyUI (voie `audio`) ; le piano de ByteDance et
                       ADTOF seulement quand leurs poids seront sur disque.

Le réglage de chaque moteur, ses bornes et ses sources : la section `midi`
de musique/generatif_modeles.json (music_gen.schema()).
"""

from __future__ import annotations

import math
import re
import shutil
import struct
import subprocess
import time
from array import array
from pathlib import Path

from core import config, jobs, library
from core.comfy import Cancelled, ComfyError
from core.http import HttpError
from tools import music_gen, music_stems, music_yue

MAX_MID = 1 << 20
MAX_NOTES = 20000
PPQ = 480
TIMEOUT = 1800
HOME = Path.home()
CH_NAMES = {0: "chant", 1: "thème", 2: "accords", 9: "batterie"}


def mode() -> str:
    return "reel" if config.get("music_midi") is True else "factice"


# l'interrupteur, déclaré pour la page Admin → Câblage
config.declare_switch("music_midi", [False, True], label="Musique · extraire le MIDI", default=False,
                      doc="server/tools/music_midi.py, mode() : factice (énergie et passages à zéro) ou basic-pitch (venv d'AUDIOLAB), "
                          "SheetSage2 par ComfyUI ; ADTOF et le piano de ByteDance quand leurs poids seront sur disque")


# ── le fichier MIDI standard ────────────────────────────────
def _vlq(n: int) -> bytes:
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append(0x80 | (n & 0x7F))
        n >>= 7
    return bytes(reversed(out))


def write_smf(notes: list, bpm: float, sig: int = 4, name: str = "", ppq: int = PPQ) -> bytes:
    """Format 0, une piste : nom, tempo (FF 51), mesure (FF 58, en noires),
    puis les notes. `notes` : [(début, durée, hauteur, vélocité 1..127, canal)]
    en noires ; le canal manque : 0."""
    ev = []
    for n in notes:
        s, l, p, v = n[:4]
        ch = n[4] if len(n) > 4 else 0
        t0 = max(0, round(s * ppq))
        t1 = max(t0 + 1, round((s + l) * ppq))
        ev.append((t1, 0, bytes([0x80 | ch, int(p), 0])))          # les fins avant les débuts au même instant
        ev.append((t0, 1, bytes([0x90 | ch, int(p), max(1, min(127, int(v)))])))
    ev.sort(key=lambda e: (e[0], e[1]))
    body = bytearray()
    if name:
        nb = name.encode("utf-8")[:120]
        body += b"\x00\xff\x03" + _vlq(len(nb)) + nb
    body += b"\x00\xff\x51\x03" + round(60_000_000 / bpm).to_bytes(3, "big")
    body += b"\x00\xff\x58\x04" + bytes([sig, 2, 24, 8])             # sig/4 : le dénominateur en puissance de deux
    last = 0
    for t, _, data in ev:
        body += _vlq(t - last) + data
        last = t
    body += b"\x00\xff\x2f\x00"
    return b"MThd" + struct.pack(">IHHH", 6, 0, 1, ppq) + b"MTrk" + struct.pack(">I", len(body)) + bytes(body)


def _read_vlq(data: bytes, i: int) -> tuple[int, int]:
    n = 0
    while True:
        b = data[i]
        i += 1
        n = (n << 7) | (b & 0x7F)
        if not b & 0x80:
            return n, i


def read_smf(data: bytes) -> dict:
    """Un fichier MIDI standard (formats 0 et 1, statut courant, méta et
    sysex sautés) : les notes en noires (tics / division) et en secondes (la
    carte des tempos), le premier tempo, la première mesure. Refuse la
    division SMPTE et un fichier tronqué."""
    if len(data) < 14 or data[:4] != b"MThd":
        raise ValueError("pas un fichier MIDI (en-tête MThd absent)")
    hl, fmt, ntrk, div = struct.unpack(">IHHH", data[4:14])
    if div & 0x8000:
        raise ValueError("division SMPTE : pas prise")
    if fmt not in (0, 1) or not ntrk or div == 0:
        raise ValueError(f"format MIDI {fmt} : seuls 0 et 1 sont pris")
    pos, raw, tempos, sig = 8 + hl, [], [], None
    for _ in range(ntrk):
        if data[pos:pos + 4] != b"MTrk":
            raise ValueError("piste MIDI illisible (MTrk attendu)")
        (ln,) = struct.unpack(">I", data[pos + 4:pos + 8])
        i, end = pos + 8, pos + 8 + ln
        if end > len(data):
            raise ValueError("fichier MIDI tronqué")
        t, status, on = 0, 0, {}
        while i < end:
            d, i = _read_vlq(data, i)
            t += d
            b = data[i]
            if b == 0xFF:
                typ = data[i + 1]
                n, i = _read_vlq(data, i + 2)
                if typ == 0x51 and n == 3:
                    tempos.append((t, int.from_bytes(data[i:i + 3], "big")))
                elif typ == 0x58 and n >= 2 and sig is None:
                    sig = data[i] * 4 // (2 ** data[i + 1]) if 1 <= data[i + 1] <= 2 else data[i]
                i += n
                continue
            if b in (0xF0, 0xF7):
                n, i = _read_vlq(data, i + 1)
                i += n
                continue
            if b & 0x80:
                status, i = b, i + 1
            elif not status:
                raise ValueError("statut MIDI manquant")
            kind, ch = status & 0xF0, status & 0x0F
            nd = 1 if kind in (0xC0, 0xD0) else 2
            args = data[i:i + nd]
            i += nd
            if kind == 0x90 and args[1] > 0:
                on.setdefault((ch, args[0]), []).append((t, args[1]))
            elif kind == 0x80 or (kind == 0x90 and args[1] == 0):
                st = on.get((ch, args[0]))
                if st:
                    t0, v = st.pop(0)
                    raw.append((t0, t - t0, args[0], v, ch))
            if len(raw) > MAX_NOTES:
                raise ValueError(f"plus de {MAX_NOTES} notes")
        pos = end
    tempos.sort()
    if not tempos or tempos[0][0] > 0:
        tempos.insert(0, (0, 500_000))                              # 120 à la noire : le défaut du standard

    def secs(tick):
        s, last, us = 0.0, 0, tempos[0][1]
        for tt, u in tempos[1:]:
            if tt >= tick:
                break
            s += (tt - last) * us / div / 1e6
            last, us = tt, u
        return s + (tick - last) * us / div / 1e6
    raw.sort()
    notes = [{"s": round(t0 / div, 5), "l": round(max(1, dt) / div, 5), "p": p, "v": v, "ch": ch,
              "t": round(secs(t0), 5), "d": round(secs(t0 + max(1, dt)) - secs(t0), 5)} for t0, dt, p, v, ch in raw]
    return {"ppq": div, "format": fmt, "bpm": round(60_000_000 / tempos[0][1], 3), "sig": sig or 4, "notes": notes}


def _summary(notes: list, sig: int) -> dict:
    beats = max((n[0] + n[1] for n in notes), default=0.0)
    chans = sorted({(n[4] if len(n) > 4 else 0) for n in notes})
    return {"notes": len(notes), "beats": round(beats, 4), "bars": math.ceil(beats / sig - 1e-9) if beats else 0,
            "lo": min((n[2] for n in notes), default=None), "hi": max((n[2] for n in notes), default=None),
            "channels": chans, "drums": chans == [9]}


def _midi_item(iid) -> dict:
    it = library.get(iid) if isinstance(iid, str) else None
    if not it or it.get("kind") != "midi":
        raise HttpError(404, f"clip MIDI introuvable : {iid}")
    return it


# ── les routes : relire, ranger ─────────────────────────────
def api_notes(req, iid):
    """Les notes d'un clip MIDI de la bibliothèque, en noires : [début, durée,
    hauteur, vélocité 0..1, canal]."""
    it = _midi_item(iid)
    try:
        parsed = read_smf(library.path_of(it).read_bytes())
    except (ValueError, IndexError) as e:
        raise HttpError(400, f"fichier MIDI illisible : {e}") from e
    return {"id": it["id"], "title": it.get("title"), "params": it.get("params", {}), "file_bpm": parsed["bpm"], "sig": parsed["sig"],
            "notes": [[n["s"], n["l"], n["p"], round(n["v"] / 127, 3), n["ch"]] for n in parsed["notes"]],
            "channels": {str(c): CH_NAMES.get(c, f"canal {c + 1}") for c in sorted({n["ch"] for n in parsed["notes"]})}}


def _notes_in(raw) -> list:
    if not isinstance(raw, list) or not raw or len(raw) > MAX_NOTES:
        raise ValueError(f"des notes : de 1 à {MAX_NOTES}")
    out = []
    for n in raw:
        if not isinstance(n, list) or len(n) not in (4, 5) or any(isinstance(x, bool) or not isinstance(x, (int, float)) for x in n):
            raise ValueError("une note est [début, durée, hauteur, vélocité, canal ?]")
        s, l, p, v = n[:4]
        ch = int(n[4]) if len(n) == 5 else 0
        if not (0 <= s <= 1e5 and 0 < l <= 1e5 and 0 <= p <= 127 and 0 <= v <= 1 and 0 <= ch <= 15):
            raise ValueError("note hors bornes (début ≥ 0, durée > 0, hauteur 0..127, vélocité 0..1, canal 0..15)")
        out.append((s, l, int(p), max(1, round(v * 127)), ch))
    return out


def api_save(req):
    """Un clip de notes d'ODIO rangé dans la bibliothèque (sorte midi) : la
    page envoie ses notes, le fichier s'écrit ici."""
    d = req.json()
    try:
        bpm = music_gen._num(d.get("bpm"), 20, 300, "tempo")
        sig = d.get("sig", 4)
        if sig not in (2, 3, 4, 6):
            raise ValueError("mesure : 2, 3, 4 ou 6")
        notes = _notes_in(d.get("notes"))
        name = (d.get("name") if isinstance(d.get("name"), str) else "").strip()[:60] or "Clip"
    except (ValueError, TypeError) as e:
        raise HttpError(400, str(e)) from e
    from tools import chanson   # le clip naît dans le Space de Musique de son projet (étape 7)
    msp = chanson.project_space(d.get("project"))
    tmp = config.data_dir() / "uploads"
    tmp.mkdir(exist_ok=True)
    f = tmp / f"{int(time.time() * 1000)}_{re.sub(r'[^A-Za-z0-9_-]+', '_', name)[:40]}.mid"
    f.write_bytes(write_smf(notes, bpm, sig, name))
    it = library.add_file(f, kind="midi", title=name, origin={"tool": "music", "via": "odio"},
                          params={"method": "odio", "engine": "odio", "bpm": bpm, "sig": sig, **_summary(notes, sig),
                                  "project": str(d.get("project") or "")[:40]},
                          tags=["midi", "motif"], folder="MIDI", move=True, extra={"music_space": msp} if msp else None)
    return library.public(it)


# ── extraire ────────────────────────────────────────────────
def basic_pitch_bin() -> Path:
    return Path(config.get("midi_basic_pitch_bin") or HOME / "audio-studio/.venv/bin/basic-pitch").expanduser()


def piano_ckpt() -> Path:
    return HOME / "piano_transcription_inference_data/note_F1=0.9677_pedal_F1=0.9186.pth"


def readiness() -> dict:
    """Le moteur réel : prêt ou pourquoi, par moteur du schéma."""
    S = music_gen.schema()["midi"]["moteurs"]
    b, ck = basic_pitch_bin(), piano_ckpt()
    ss = next((m for m in music_yue.machines() if m["in_lane"] and m["ref"]), None)
    return {"basic_pitch": {"ready": b.exists(), "why": "" if b.exists() else f"basic-pitch absent ({b})"},
            "sheetsage2": {"ready": bool(ss), "why": "" if ss else "aucune machine de la voie audio n'a SheetSage2AudioToABC et sheetsage2_bf16.safetensors"},
            "adtof": {"ready": False, "why": S["adtof"]["pret"]["pourquoi"]},
            "bytedance": {"ready": ck.exists() and ck.stat().st_size > 1.6e8, "why": "" if ck.exists() else S["bytedance"]["pret"]["pourquoi"]}}


def extract_params(d: dict) -> dict:
    if not isinstance(d, dict):
        raise ValueError("la demande est un objet")
    S = music_gen.schema()["midi"]
    it = library.get(d.get("src")) if isinstance(d.get("src"), str) else None
    if not it or it.get("kind") != "audio":
        raise ValueError("choisis un clip audio (un son de la bibliothèque)")
    eng = d.get("engine") or "basic_pitch"
    E = S["moteurs"].get(eng)
    if not E:
        raise ValueError(f"moteur inconnu : {eng} ({', '.join(S['moteurs'])})")
    v = d.get("v") or {}
    if not isinstance(v, dict):
        raise ValueError("les réglages sont un objet")
    extra = [k for k in v if k not in E["params"]]
    if extra:
        raise ValueError(f"« {extra[0]} » n'est pas un réglage de {E['nom']}")
    vals: dict = {}
    for pid in E["params"]:
        pd = S["params"][pid]
        if not music_gen._cond(pd.get("si"), vals):
            continue
        raw = v.get(pid, pd["defaut"])
        if pd["type"] == "bool":
            if not isinstance(raw, bool):
                raise ValueError(f"{pd['label']} : vrai ou faux")
        elif pd["type"] == "choix":
            if raw not in [c["id"] for c in pd["choix"]]:
                raise ValueError(f"{pd['label']} : {raw!r}")
        else:
            raw = music_gen._num(raw, pd["min"], pd["max"], pd["label"])
        vals[pid] = raw
    off = music_gen._num(d.get("off_s", 0), 0, 1e5, "début dans le son")
    dur = music_gen._num(d.get("dur_s", 0), 0.05, 3600, "durée à lire")
    bpm = music_gen._num(d.get("bpm"), 20, 300, "tempo")
    sig = d.get("sig", 4)
    if sig not in (2, 3, 4, 6):
        raise ValueError("mesure : 2, 3, 4 ou 6")
    tonic = music_gen._num(d.get("tonic", 9), 0, 11, "tonique", integer=True)
    md = d.get("mode", "minor")
    if md not in music_gen.SCALES:
        raise ValueError(f"mode inconnu : {md}")
    if mode() == "reel":
        r = readiness()[eng]
        if not r["ready"]:
            raise ValueError(f"{E['nom']} : {r['why']}")
        if vals.get("separer"):
            raise ValueError("séparer d'abord : à câbler en réel (music.stems puis la transcription, deux voies) — en attendant, "
                             "« Séparer en stems », puis extraire le MIDI du stem")
    title = d.get("title") if isinstance(d.get("title"), str) and d.get("title").strip() else it.get("title") or "MIDI"
    return {"src": it["id"], "engine": eng, "method": E["methode"], "values": vals, "off_s": off, "dur_s": dur, "bpm": bpm,
            "sig": sig, "tonic": tonic, "mode": md, "title": str(title)[:60], "clip": str(d.get("clip") or "")[:24]}


def _decode(it: dict, off: float, dur: float, sr: int, dest: Path | None = None, pre: str = ""):
    args = ["ffmpeg", "-v", "error", "-ss", f"{off:.4f}", "-t", f"{dur:.4f}", "-i", str(library.path_of(it)), "-ac", "1",
            "-ar", str(sr), *(["-af", pre] if pre else [])]
    if dest:
        r = subprocess.run([*args, "-y", "-c:a", "pcm_s16le", str(dest)], capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            raise RuntimeError(f"ffmpeg : {r.stderr.strip()[:300]}")
        return dest
    r = subprocess.run([*args, "-f", "s16le", "-"], capture_output=True, timeout=600)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg : {r.stderr.decode(errors='replace').strip()[:300]}")
    x = array("h")
    x.frombytes(r.stdout[: len(r.stdout) // 2 * 2])
    return x


def fake_transcribe(x, sr: int, bpm: float, tonic: int, md: str) -> list:
    """Le moteur d'essai : une double-croche du projet par pas ; une attaque
    quand l'énergie (RMS) passe le seuil, double, ou que la hauteur change ; la
    hauteur par le nombre de passages à zéro du pas, ramenée à la note de la
    gamme la plus proche entre do2 et do7. [(début, durée, hauteur, vélocité)]
    en noires."""
    step = sr * 60.0 / bpm / 4
    n = int(len(x) // step)
    rms, zc = [], []
    for k in range(n):
        seg = x[int(k * step):int((k + 1) * step)]
        if not seg:
            rms.append(0.0)
            zc.append(0)
            continue
        rms.append(math.sqrt(sum(v * v for v in seg) / len(seg)))
        zc.append(sum(1 for i in range(1, len(seg)) if (seg[i - 1] < 0) != (seg[i] < 0)))
    top = max(rms, default=0.0)
    if top <= 0:
        return []
    thr, sc = top * 0.12, music_gen.SCALES[md]

    def snap(m):
        best = None
        for c in range(36, 97):
            if (c - tonic) % 12 in sc and (best is None or abs(c - m) < abs(best - m)):
                best = c
        return best
    notes, cur = [], None
    for k in range(n):
        seglen = int((k + 1) * step) - int(k * step)
        f = zc[k] * sr / (2 * max(1, seglen))
        pitch = snap(69 + 12 * math.log2(f / 440)) if f > 20 else None
        loud = rms[k] > thr
        onset = loud and pitch is not None and (cur is None or rms[k] > 1.8 * rms[k - 1] or abs(pitch - cur[2]) > 1)
        if cur and (not loud or onset):
            notes.append(cur)
            cur = None
        if onset:
            cur = [k / 4, 0.25, pitch, max(1, min(127, int(40 + 80 * rms[k] / top)))]
        elif cur:
            cur[1] += 0.25
    if cur:
        notes.append(cur)
    return [tuple(nt) for nt in notes]


def chord_notes(name: str, t: float, l: float) -> list:
    """Un symbole d'accord du dialecte (« F#m7/C# ») en notes tenues, canal 2 :
    la racine et ses intervalles (schéma, partition.intervalles), la basse en
    barre oblique une octave sous."""
    iv = music_gen.schema()["modeles"]["yue"]["partition"]["intervalles"]
    base = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    m = re.fullmatch(r"([A-G])(bb|##|b|#)?(.*?)(?:/([A-G])(bb|##|b|#)?)?", name)
    if not m or m.group(3) not in iv:
        return []
    acc = {"": 0, None: 0, "#": 1, "##": 2, "b": -1, "bb": -2}
    root = (base[m.group(1)] + acc[m.group(2)]) % 12
    out = [(t, l, 48 + root + x, 80, 2) for x in iv[m.group(3)]]
    if m.group(4):
        out.append((t, l, 36 + (base[m.group(4)] + acc[m.group(5)]) % 12, 80, 2))
    return out


def abc_to_notes(abc: str, bpm: float) -> list:
    """Une partition du dialecte natif (lue par abc_tools) en notes du projet :
    Vocal au canal 0, Ins au 1, les accords au 2 ; les instants de la
    partition (en noires à son tempo Q) ramenés aux temps du projet par les
    secondes (temps = noires × bpm / Q)."""
    abc, _ = music_yue.abc_normalise(abc, couper=True)       # une fin coupée perd son groupe incomplet
    chk = music_yue.abc_check(abc)
    if not chk.get("ok"):
        raise RuntimeError(f"partition illisible : {chk.get('error_fr') or chk.get('error') or chk.get('why')}")
    rep = chk["report"]
    k = bpm / rep["bpm"]

    def q(s):
        a, _, b = str(s).partition("/")
        return float(a) / float(b or 1)
    out = []
    for ch, name in ((0, "Vocal"), (1, "Ins")):
        for nt in rep["voices"][name]["notes"]:
            out.append((q(nt["onset_quarters"]) * k, q(nt["duration_quarters"]) * k, nt["midi_pitch"], 96, ch))
    chords = rep["voices"]["Vocal"]["chords"]
    end = q(rep["duration_quarters"])
    for i, (t, name) in enumerate(chords):
        t0 = q(t)
        t1 = q(chords[i + 1][0]) if i + 1 < len(chords) else end
        out += chord_notes(name, t0 * k, max(0.25, (t1 - t0) * k))
    return out


def _save_result(ctx, p: dict, notes: list, engine: str, extra: dict | None = None) -> dict:
    if not notes:
        raise RuntimeError("aucune note trouvée dans ce son (silence ?)")
    essai = engine == "factice"
    from tools import chanson   # le Space du projet (api_extract), rejugé en rangeant
    msp = chanson.birth_space({}, (ctx.params or {}).get("music_space") or "")
    f = ctx.workdir / "extrait.mid"
    f.write_bytes(write_smf(notes, p["bpm"], p["sig"], p["title"]))
    it = ctx.add(f, kind="midi", title=f"{p['title']} · {p['method']}" + (" (essai)" if essai else ""), parents=[p["src"]],
                 params={"method": p["method"], "engine": engine, "src": p["src"], "off_s": p["off_s"], "dur_s": p["dur_s"],
                         "bpm": p["bpm"], "sig": p["sig"], "values": p["values"], "clip": p["clip"], **_summary(notes, p["sig"]),
                         "confidence": "estimation" if not essai else "essai : pas une transcription", **(extra or {})},
                 origin={"model": "factice" if essai else engine}, tags=["midi", "extrait", p["method"]], folder="MIDI",
                 extra={"music_space": msp} if msp else None)
    s = _summary(notes, p["sig"])
    return {"note": f"{s['notes']} notes sur {s['bars']} mesure{'s' if s['bars'] > 1 else ''} ({engine})", "midi": it["id"],
            "notes": s["notes"], "channels": s["channels"]}


def _pre(p: dict) -> str:
    """Séparer d'abord, en essai : le filtre d'essai du stem (music_stems.TEST_FILTERS)."""
    return music_stems.TEST_FILTERS.get(p["values"].get("stem"), "") if p["values"].get("separer") else ""


def run_test(ctx):
    p = extract_params(ctx.params)
    ctx.progress(0.1, "lit le son (moteur d'essai)")
    x = _decode(library.get(p["src"]), p["off_s"], p["dur_s"], 11025, pre=_pre(p))
    ctx.check()
    ctx.progress(0.5, "attaques et hauteurs (moteur d'essai, pas une transcription)")
    notes = fake_transcribe(x, 11025, p["bpm"], p["tonic"], p["mode"])
    if p["method"] == "batterie":
        # l'essai range les attaques sur les fûts : grave → grosse caisse, médium → caisse claire, aigu → charleston
        notes = [(s, 0.25, 36 if n < 55 else 38 if n < 72 else 42, v, 9) for s, _, n, v in notes]
    elif p["method"] == "partition":
        # l'essai de la partition : la mélodie au chant, un accord par mesure tiré de la gamme
        chords = music_gen._chords(p["tonic"], p["mode"])
        bars = math.ceil(max((s + l for s, l, *_ in notes), default=p["sig"]) / p["sig"])
        notes = [(*n, 0) for n in notes] + [(b * p["sig"], p["sig"], c + 12, 70, 2) for b in range(bars) for c in chords[b % 4]]
    return _save_result(ctx, p, notes, "factice")


def _run(ctx, cmd: list, cwd: Path) -> None:
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=str(cwd))
    t0, out = time.time(), ""
    try:
        while True:
            try:
                out, _ = proc.communicate(timeout=1.0)
                break
            except subprocess.TimeoutExpired:
                if ctx.cancelled():
                    raise Cancelled("arrêté")
                if time.time() - t0 > TIMEOUT:
                    raise RuntimeError(f"transcription trop longue (> {TIMEOUT} s)")
    finally:
        if proc.poll() is None:                       # arrêt par son PID, jamais par motif
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
    if proc.returncode != 0:
        raise RuntimeError(f"la transcription a échoué : {(out or '').strip()[-500:]}")


def basic_pitch_command(wav: Path, out_dir: Path, p: dict) -> list[str]:
    v = p["values"]
    cmd = [str(basic_pitch_bin()), str(out_dir), str(wav), "--save-midi", "--model-serialization", "onnx",
           "--onset-threshold", str(v["onset_threshold"]), "--frame-threshold", str(v["frame_threshold"]),
           "--minimum-note-length", str(v["minimum_note_length"]), "--midi-tempo", str(p["bpm"])]
    if v["minimum_frequency"] > 0:
        cmd += ["--minimum-frequency", str(v["minimum_frequency"])]
    if v["maximum_frequency"] > 0:
        cmd += ["--maximum-frequency", str(v["maximum_frequency"])]
    if not v["melodia"]:
        cmd.append("--no-melodia")
    return cmd


def run_real(ctx):
    p = extract_params(ctx.params)
    ctx.progress(0.05, "découpe le son")
    wav = _decode(library.get(p["src"]), p["off_s"], p["dur_s"], 22050, ctx.workdir / "clip.wav")
    out_dir = ctx.workdir / "midi"
    out_dir.mkdir(exist_ok=True)
    if p["engine"] == "basic_pitch":
        ctx.progress(0.2, "basic-pitch")
        _run(ctx, basic_pitch_command(wav, out_dir, p), out_dir)
        mid = out_dir / "clip_basic_pitch.mid"
    elif p["engine"] == "bytedance":
        ctx.progress(0.2, "transcription piano (ByteDance)")
        mid = out_dir / "clip_piano.mid"
        code = ("import sys, librosa\nfrom piano_transcription_inference import PianoTranscription, sample_rate\n"
                "y, _ = librosa.load(sys.argv[1], sr=sample_rate, mono=True)\n"
                "PianoTranscription(device='cuda', checkpoint_path=sys.argv[3]).transcribe(y, sys.argv[2])\n")
        _run(ctx, [str(basic_pitch_bin().parent / "python"), "-c", code, str(wav), str(mid), str(piano_ckpt())], out_dir)
    else:
        raise RuntimeError(f"{p['engine']} : pas câblé (voir le schéma)")
    if not mid.exists():
        raise RuntimeError(f"le moteur n'a pas écrit de MIDI ({', '.join(f.name for f in out_dir.iterdir())[:200]})")
    parsed = read_smf(mid.read_bytes())
    # les instants du moteur (en secondes, par sa carte des tempos) ramenés aux
    # temps du projet : le clip tombe sur la grille d'ODIO quel que soit le
    # tempo écrit dans le fichier
    k = p["bpm"] / 60.0
    notes = [(n["t"] * k, n["d"] * k, n["p"], n["v"], 9 if p["method"] == "batterie" else 0) for n in parsed["notes"]]
    return _save_result(ctx, p, notes, p["engine"])


def build_sheetsage_graph(audio_name: str, ss_mode: str) -> dict:
    """LoadAudio → AudioEncoderLoader (SheetSage2) → SheetSage2AudioToABC →
    PreviewAny « OUT ABC » : la partition du son, rien de chanté (la moitié
    du graphe de reprise de music_yue.py)."""
    return {"10": {"class_type": "LoadAudio", "_meta": {"title": "clip"}, "inputs": {"audio": audio_name}},
            "11": {"class_type": "AudioEncoderLoader", "_meta": {"title": "SheetSage2"}, "inputs": {"audio_encoder_name": music_yue.SHEETSAGE}},
            "12": {"class_type": "SheetSage2AudioToABC", "_meta": {"title": "son → partition"},
                   "inputs": {"audio_encoder": ["11", 0], "audio": ["10", 0], "mode": ss_mode}},
            "9": {"class_type": "PreviewAny", "_meta": {"title": "OUT ABC"}, "inputs": {"source": ["12", 0]}}}


def run_abc_test(ctx):
    return run_test(ctx)


def run_abc_real(ctx):
    p = extract_params(ctx.params)
    wav = _decode(library.get(p["src"]), p["off_s"], p["dur_s"], 44100, ctx.workdir / "clip.wav")
    name = ctx.comfy.upload(wav)
    g = build_sheetsage_graph(name, p["values"].get("ss_mode", "full"))
    problems = music_yue.check_graph(g, music_yue.fetch_info(ctx.comfy, [n["class_type"] for n in g.values()]))
    if problems:
        raise ComfyError("graphe SheetSage2 refusé avant l'envoi : " + " ; ".join(problems[:6]))
    pid = ctx.comfy.queue(g)
    entry = ctx.comfy.wait(pid, cancelled=ctx.cancelled, report=ctx.comfy_report("SheetSage2"), timeout=TIMEOUT)
    abc = music_yue._score_of(entry, g)
    return _save_result(ctx, p, abc_to_notes(abc, p["bpm"]), "sheetsage2", {"score": abc})


def api_extract(req):
    d = req.json()
    try:
        p = extract_params(d)
    except (ValueError, TypeError) as e:
        raise HttpError(400, str(e)) from e
    # SheetSage2 par ComfyUI ; le piano de ByteDance sur le GPU de la machine du
    # portail (un sous-processus : épinglé au ComfyUI local de la voie audio, qui
    # sert de jeton GPU) ; basic-pitch sur le processeur (ONNX)
    kind = {"sheetsage2": "music.midi.abc", "bytedance": "music.midi.gpu"}.get(p["engine"], "music.midi")
    pin = music_stems._local_audio_endpoint() if kind == "music.midi.gpu" and mode() == "reel" else None
    # le clip extrait naît dans le Space de Musique du projet (`project` : son id ; chanson.py, étape 7)
    from tools import chanson
    d = {k: v for k, v in d.items() if k != "music_space"}
    msp = chanson.project_space(d.get("project"))
    if msp:
        d["music_space"] = msp
    j = jobs.submit(kind, d, title=f"Extraire le MIDI · {p['title']}"[:90], tool="music", pin=pin)
    return jobs.public(j)


def api_options(req):
    S = music_gen.schema()["midi"]
    fake = mode() == "factice"
    r = readiness()
    return {"engine": mode(), "switch": S["interrupteur"],
            "engines": {k: {"name": E["nom"], "method": E["methode"], "ready": True if fake else r[k]["ready"],
                            "why": "" if fake else r[k]["why"], "real": r[k]} for k, E in S["moteurs"].items()},
            "note": "moteur d'essai : attaques par l'énergie, hauteur par les passages à zéro — pas une transcription" if fake else ""}


def register(app) -> None:
    real = mode() == "reel"
    jobs.register("music.midi", run_real if real else run_test, lane="cpu", title="Extraire le MIDI" + ("" if real else " (essai)"),
                  cost=lambda p: "gpu" if real and p.get("engine") == "bytedance" else "cpu")   # basic-pitch : ONNX sur le processeur
    jobs.register("music.midi.abc", run_abc_real if real else run_abc_test, lane="audio" if real else "cpu",
                  title="Extraire la partition" + ("" if real else " (essai)"), family="sheetsage2" if real else None, gpu=real, cost="gpu" if real else "cpu")
    jobs.register("music.midi.gpu", run_real if real else run_test, lane="audio" if real else "cpu",
                  title="Extraire le MIDI (piano)" + ("" if real else " (essai)"), family="piano-bytedance" if real else None,
                  gpu=real, cost="gpu" if real else "cpu")
    app.route("POST", "/api/music/midi", api_save)
    app.route("GET", "/api/music/midi/options", api_options)
    app.route("POST", "/api/music/midi/extract", api_extract)
    app.route("GET", "/api/music/midi/{iid}/notes", api_notes)


# ── le contrôle sans GPU (tools/check.py) ───────────────────
def selftest(call, ok) -> None:
    import tempfile
    import wave
    notes = [(0, 1, 60, 100), (1, 0.5, 64, 90), (1.5, 0.5, 67, 80), (2, 2, 72, 110, 1)]
    smf = write_smf(notes, 112, 4, "essai")
    back = read_smf(smf)
    ok(abs(back["bpm"] - 112) < 0.01 and back["sig"] == 4, f"tempo et mesure relus ({back['bpm']} {back['sig']})")
    ok([(n["s"], n["l"], n["p"], n["v"], n["ch"]) for n in back["notes"]] == [(0, 1, 60, 100, 0), (1, 0.5, 64, 90, 0), (1.5, 0.5, 67, 80, 0), (2, 2, 72, 110, 1)],
       f"écrire puis relire un MIDI rend les mêmes notes ({back['notes'][:2]})")
    ok(abs(back["notes"][3]["t"] - 2 * 60 / 112) < 1e-3, "les secondes par la carte des tempos")
    for bad in (b"RIFF0000", smf[:30], b"MThd\x00\x00\x00\x06\x00\x00\x00\x01\x80\x19"):
        try:
            read_smf(bad)
            ok(False, "un fichier MIDI illisible est refusé")
        except (ValueError, IndexError):
            ok(True, "un fichier MIDI illisible est refusé")
    ok([n[2] for n in chord_notes("F#m7/C#", 0, 4)] == [54, 57, 61, 64, 37] and chord_notes("Cmaj9", 0, 1) == [],
       "un symbole d'accord du dialecte en notes ; une qualité hors dialecte ne donne rien")
    st, r = call("POST", "/api/music/midi", {"name": "Basse", "bpm": 112, "sig": 4, "notes": [[0, 1, 41, 0.9], [1, 1, 44, 0.7]]})
    ok(st == 200 and r.get("kind") == "midi" and r["params"]["notes"] == 2 and r["params"]["bars"] == 1 and r["folder"] == "MIDI",
       f"un clip de notes rangé dans la bibliothèque, sorte midi ({st} {str(r)[:200]})")
    iid = r.get("id", "")
    st, g = call("GET", f"/api/music/midi/{iid}/notes")
    ok(st == 200 and [x[:3] for x in g["notes"]] == [[0, 1, 41], [1, 1, 44]], f"relu en notes ({st})")
    st, lst = call("GET", "/api/library?kind=midi")
    ok(st == 200 and any(x["id"] == iid for x in lst["items"]), "la bibliothèque le liste (kind=midi)")
    st, up = call("PUT", "/api/library/upload?name=import.mid", raw=smf)
    ok(st == 200 and up.get("kind") == "midi", f"un fichier .mid déposé entre dans la bibliothèque ({st})")
    st, g = call("GET", f"/api/music/midi/{up.get('id')}/notes")
    ok(st == 200 and len(g["notes"]) == 4 and g["channels"] == {"0": "chant", "1": "thème"}, f"ses notes et ses canaux ({st})")
    st, _ = call("GET", "/api/music/midi/aud-x/notes")
    ok(st == 404, "un son n'est pas un clip MIDI")
    st, o = call("GET", "/api/music/midi/options")
    ok(st == 200 and o["engine"] == "factice" and set(o["engines"]) == {"basic_pitch", "sheetsage2", "adtof", "bytedance"}
       and o["engines"]["adtof"]["real"]["ready"] is False, f"les méthodes : notes, partition, batterie, piano ({st})")
    cmd = basic_pitch_command(Path("/t/c.wav"), Path("/t/o"), {"bpm": 112, "values": {"onset_threshold": 0.5, "frame_threshold": 0.3,
                              "minimum_note_length": 127.7, "minimum_frequency": 0, "maximum_frequency": 0, "melodia": False}})
    ok("--no-melodia" in cmd and cmd[cmd.index("--midi-tempo") + 1] == "112" and "--minimum-frequency" not in cmd,
       "la commande basic-pitch : tempo du projet, sans melodia, sans borne de fréquence")
    gs = build_sheetsage_graph("c.wav", "full")
    ok(music_yue.check_graph(gs, music_yue.FAKE_INFO) == [], f"le graphe SheetSage2 seul ({music_yue.check_graph(gs, music_yue.FAKE_INFO)})")
    if music_yue.abc_tools():
        ex = ('X:1\nT:\nM:4/4\nL:1/16\nQ:1/4=60\n' + "\n".join(music_yue.ABC_VOICES) + '\nK:C\n% verse\nV: Vocal\n"Am"A4c4e8|\nV: Ins\nZ|')
        nn = abc_to_notes(ex, 120)
        ok([(n[0], n[2], n[4]) for n in nn if n[4] == 0] == [(0, 69, 0), (2, 72, 0), (4, 76, 0)] and sum(1 for n in nn if n[4] == 2) == 3,
           f"une partition en notes : au tempo du projet (60 → 120, les temps doublent), l'accord au canal 2 ({nn})")
    if not shutil.which("ffmpeg"):
        ok(True, "ffmpeg absent : extraction d'essai sautée")
        return
    # un son d'essai fait de sinus : do mi sol do, une noire chacun, à 120
    tmp = Path(tempfile.mkdtemp(prefix="sr_midi_"))
    sr, pcm = 22050, array("h")
    for p in (60, 64, 67, 72):
        f = 440 * 2 ** ((p - 69) / 12)
        pcm.extend(int(12000 * math.sin(2 * math.pi * f * i / sr) * min(1, (sr // 2 - i) / 200)) for i in range(sr // 2))
    with wave.open(str(tmp / "s.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    st, src = call("PUT", "/api/library/upload?name=gamme.wav&title=Gamme", raw=(tmp / "s.wav").read_bytes())

    def extract(body):
        st, j = call("POST", "/api/music/midi/extract", body)
        if st != 200:
            return st, {}, {}
        for _ in range(200):
            _, jj = call("GET", f"/api/jobs/{j.get('id')}")
            if jj.get("state") in ("done", "error"):
                break
            time.sleep(0.2)
        res = jj.get("result") or {}
        _, g = call("GET", f"/api/music/midi/{res.get('midi', 'x')}/notes")
        return st, jj, g
    base = {"src": src.get("id"), "off_s": 0, "dur_s": 2, "bpm": 120, "sig": 4, "tonic": 0, "mode": "major"}
    st, jj, g = extract({**base, "engine": "basic_pitch", "v": {"melodia": True}})
    got = [n[2] for n in g.get("notes", [])]
    ok(jj.get("state") == "done" and got == [60, 64, 67, 72] and [n[0] for n in g["notes"]] == [0, 1, 2, 3]
       and jj["items"][0]["parents"] == [src.get("id")] and jj["items"][0]["kind"] == "midi",
       f"l'essai retrouve do mi sol do d'un son de sinus, une noire chacun ({jj.get('state')} {jj.get('message')} {got})")
    st, jj, g = extract({**base, "engine": "sheetsage2", "v": {"ss_mode": "full"}})
    ok(jj.get("state") == "done" and jj.get("kind") == "music.midi.abc" and {"0", "2"} <= set(g.get("channels", {})),
       f"la partition d'essai : le chant et les accords en deux canaux ({jj.get('state')} {g.get('channels')})")
    st, jj, g = extract({**base, "engine": "adtof", "v": {}})
    ok(jj.get("state") == "done" and g.get("channels") == {"9": "batterie"}, f"la batterie d'essai au canal 10 ({jj.get('state')})")
    st, jj, g = extract({**base, "engine": "basic_pitch", "v": {"separer": True, "stem": "other"}})
    ok(jj.get("state") == "done" and [n[2] for n in g.get("notes", [])] == [60, 64, 67, 72],
       f"séparer d'abord (essai : le filtre du stem « autre », 160 Hz à 4 kHz, garde les notes) ({jj.get('state')} {jj.get('message')})")
    for bad, why in (({"engine": "basic_pitch", "v": {"onset_threshold": 3}}, "un seuil hors de 0..1"),
                     ({"engine": "bytedance", "v": {"melodia": True}}, "un réglage de basic-pitch pour le piano"),
                     ({"engine": "tubaphone", "v": {}}, "une méthode inconnue")):
        st, _ = call("POST", "/api/music/midi/extract", {**base, **bad})
        ok(st == 400, f"refusé : {why}")
    shutil.rmtree(tmp, ignore_errors=True)
