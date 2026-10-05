"""Les paroles calées sans saisie : un LRC par ligne, tiré de la voix seule.

Cal, 05/10 (docs/etudes/musique_spaces_playlists.md § 3 point 4, § 5 étape 4) :
le karaoké d'AGOSTA, mais tout seul. Ses LRC ont été calés à la main par
alignement forcé (aeneas + espeak), absent des DGX : ce module le remplace.

La chaîne (POST /api/paroles/<id>/caler) — trois travaux de la file, chacun sur
sa voie, au nom de la même personne et dans le même Workspace ; le suivant part
quand le précédent sort de la file (`jobs.AFTER`, une accroche du socle) :

  1. la voix seule : le stem `vocals` du son (le plus récent, quel que soit
     l'outil qui l'a fait) ; sinon `music.stems` (server/tools/music_stems.py)
     demande la voix seule au modèle prêt le meilleur pour la voix (VOIX, les
     SDR publiés de son catalogue). La séparation est du Studio (ODIO) : sans
     lui, ou si on le demande (`voix: "melange"`), on transcrit le mélange, et
     le résultat le dit ;
  2. les mots entendus : `transcrire.transcribe` en mode complet, sans voix
     séparées — Whisper `word_timestamps`, chaque mot `[mot, début, fin]`
     (server/tools/transcrire_moteur.py, `--words 1`). Le document de
     Transcrire reste, comme les autres : on peut le relire là ;
  3. le calage : le travail `paroles.caler` (voie cpu, rien de lourd) aligne
     les mots entendus sur les paroles connues — celles qu'on donne, sinon
     celles de la recette (`params.chanson.lyrics`), sinon la transcription
     elle-même devient les paroles — et range le LRC sur l'objet audio, dans
     son champ `lrc` (core/library.py, `update`).

L'ALIGNEMENT (`caler`, une fonction pure, sans fichier ni réseau) :

  - la normalisation (`jetons`) : casse, accents et ligatures (NFKD), les
    apostrophes typographiques, les élisions et les traits d'union coupés des
    deux côtés de la même façon (« qu'est-ce » → qu, est, ce : Whisper découpe
    ainsi, transcrire.on_text), la ponctuation retirée, les nombres en toutes
    lettres (français, anglais : « 20 » et « vingt » se rejoignent) ;
  - deux mots se valent s'ils sont égaux, ou proches à l'écrit
    (`difflib.SequenceMatcher.ratio` ≥ PROCHE, au-delà de deux lettres) : un
    pluriel, un verbe conjugué, un mot mal entendu de peu ;
  - l'ordre : un alignement GLOBAL des deux suites (programmation dynamique,
    `apparier`). Le `SequenceMatcher` seul sur les suites de mots prend d'abord
    le plus long bloc commun, où qu'il soit : avec des refrains répétés et des
    mots mal entendus, il apparie le premier refrain écrit au deuxième refrain
    chanté, et tout ce qui est entre les deux tombe (mesuré sur les LRC
    d'AGOSTA, même sans bruit : jusqu'à 6 min d'écart ; tools/paroles_mesure.py
    --blocs). L'alignement global garde l'ordre du tout. Un écart (des mots non
    appariés) coûte à son ouverture (ECART) : des suites de mots appariés
    plutôt que des mots isolés éparpillés ; moins s'il saute une ligne entière
    (LIGNE, REPRISE : une ligne ratée, ou deux lignes qui se ressemblent) ; et
    des mots écrits sautés doivent avoir eu le temps d'être chantés entre les
    mots entendus qui les bordent (TEMPS) ;
  - une ligne qui a des mots reconnus : ses premiers mots appariés (VOTES)
    votent pour son début (leur début entendu, moins les syllabes qui les
    précèdent dans la ligne, au débit mesuré sur les mots appariés) ; la
    médiane des votes ;
  - une ligne sans aucun mot reconnu : interpolée entre ses voisines, dans
    l'intervalle de la fin de la ligne d'avant au début de la suivante — là où
    des mots entendus non appariés, assez nombreux et étalés, disent qu'on a
    chanté (la ligne mal entendue elle-même) ; sinon dans les passages où la
    voix seule chante (ce que silencedetect n'y trouve pas silencieux,
    transcrire.speech_regions) ; sinon au milieu de l'intervalle, au débit
    mesuré. Les lignes d'un groupe s'y suivent au prorata de leurs syllabes.
    Avant la première ligne reconnue, juste avant elle ; après la dernière,
    juste après.

L'essai de vérité : les LRC d'AGOSTA (calés par aeneas) — des « mots entendus »
fabriqués à partir d'eux (`entendre` : le temps de chaque ligne réparti sur ses
mots, du bruit, des mots manqués, ajoutés, mal entendus, des lignes sautées, à
des taux documentés, BRUITS), alignés, l'écart mesuré ligne par ligne. Les
seuils du `selftest` sont sur des données fabriquées ici (pas les fichiers
d'AGOSTA, dépôt privé) ; la mesure sur AGOSTA : tools/paroles_mesure.py. Mesuré
le 05/10 (13 LRC, 608 lignes, 10 graines, avec les passages chantés de la voix
seule) — écart au temps calé par aeneas, médiane / 90e centile / lignes à 0,5 s
ou moins : propre 0,05 / 0,12 s / 100 % ; moyen (le WER de Jam-ALT) 0,10 /
0,28 s / 98 % ; fort 0,16 / 0,44 s / 93 % ; extrême 0,23 / 0,66 s / 83 %. Le
SequenceMatcher seul, au bruit moyen : 0,15 / 65 s / 74 % (des refrains
échangés). Les pires lignes (8 à 28 s) : des lignes qui se répètent à
l'identique (des onomatopées, un même mot répété) ou des groupes de lignes
ratées dans un long intervalle.

Routes :
  GET  /api/paroles/<id>            le LRC, les paroles connues, l'état du calage, ce qu'on peut faire
  POST /api/paroles/<id> {lrc}      écrire le LRC à la main (relu, trié, remis au format)
  POST /api/paroles/<id>/caler {paroles?, langue?, voix?: "auto" | "melange"}
                                    lancer la chaîne (la garde du calcul d'abord)

Travail : `paroles.caler` (voie cpu). Les deux autres maillons sont ceux de
leurs outils, inchangés.
"""

from __future__ import annotations

import difflib
import json
import random
import re
import statistics
import threading
import time
import unicodedata
from pathlib import Path

from core import auth, config, jobs, library
from core.http import HttpError

TOOL = "paroles"
KIND = "paroles.caler"

# ── les réglages de l'alignement (mesurés : tools/paroles_mesure.py) ──
PROCHE = 0.72        # deux mots « proches » : ratio de difflib, au-delà de deux lettres
ECART = 0.6          # l'ouverture d'un écart (des mots d'un côté ou de l'autre, non appariés)
SUITE = 0.02         # chaque mot de plus dans un écart
LIGNE = 0.5          # un écart qui s'ouvre sur un début de ligne : ECART × LIGNE
REPRISE = 0.25       # un appariement qui reprend sur un début de ligne : + ECART × REPRISE
TEMPS = 0.5          # reprendre après un écart : par seconde qui manque pour chanter les syllabes sautées
TOL = 0.4            # … au-delà de cette tolérance (s)
LENT = 0.7           # … au débit mesuré × LENT (un chant plus rapide que la médiane reste possible)
VOTES = 3            # les premiers mots appariés d'une ligne qui votent pour son début
SPS = 0.25           # secondes par syllabe, faute de mieux (le débit se mesure sur les mots appariés)
MAX_LIGNES = 2000
MAX_TEXTE = 300      # signes d'une ligne
MAX_PAROLES = 8000   # signes des paroles données
LRC_MAX = 100000     # le champ `lrc` d'un objet (core/library.py, la même borne)


# ── la normalisation ────────────────────────────────────────
APOS = "'’‘`´ʼ′"
LIGATURES = {"œ": "oe", "æ": "ae", "ß": "ss", "ø": "o", "đ": "d", "ł": "l"}
EN_UN = ("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen "
         "seventeen eighteen nineteen").split()
EN_DIX = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
FR_UN = ["zero", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize",
         "quatorze", "quinze", "seize", "dix sept", "dix huit", "dix neuf"]
FR_DIX = "_ _ vingt trente quarante cinquante soixante".split()


def _en(n: int) -> str:
    if n < 20:
        return EN_UN[n]
    if n < 100:
        return EN_DIX[n // 10] + ("" if n % 10 == 0 else " " + EN_UN[n % 10])
    if n < 1000:
        return EN_UN[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + _en(n % 100))
    if n < 1000000:
        return _en(n // 1000) + " thousand" + ("" if n % 1000 == 0 else " " + _en(n % 1000))
    return str(n)


def _fr(n: int) -> str:
    if n < 20:
        return FR_UN[n]
    if n < 70:
        d, u = divmod(n, 10)
        return FR_DIX[d] + ("" if u == 0 else " et un" if u == 1 else " " + FR_UN[u])
    if n < 80:
        return "soixante" + (" et onze" if n == 71 else " " + FR_UN[n - 60])
    if n < 100:
        return "quatre vingt" + ("s" if n == 80 else " " + FR_UN[n - 80])
    if n < 1000:
        c, r = divmod(n, 100)
        return ("cent" if c == 1 else FR_UN[c] + " cent" + ("s" if r == 0 else "")) + ("" if r == 0 else " " + _fr(r))
    if n < 1000000:
        m, r = divmod(n, 1000)
        return ("mille" if m == 1 else _fr(m) + " mille") + ("" if r == 0 else " " + _fr(r))
    return str(n)


def nombre(n: int, langue: str) -> str:
    """Un entier en toutes lettres (français, anglais) ; une autre langue : les chiffres."""
    return _fr(n) if langue == "fr" else _en(n) if langue == "en" else str(n)


def plat(texte: str) -> str:
    """Bas de casse, sans accents ni ligatures, les apostrophes ramenées à « ' »."""
    s = str(texte or "").casefold()
    for a in APOS:
        s = s.replace(a, "'")
    for k, v in LIGATURES.items():
        s = s.replace(k, v)
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def jetons(texte: str, langue: str = "fr") -> list[str]:
    """Les mots d'un texte, comparables : élisions et traits d'union coupés,
    ponctuation retirée, nombres en lettres (« L'été 85 » → l, ete, quatre,
    vingt, cinq)."""
    out: list[str] = []
    for m in re.findall(r"[a-z]+|[0-9]+", plat(texte)):
        if m.isdigit() and len(m) <= 6:
            out += re.findall(r"[a-z]+", plat(nombre(int(m), langue)))
        else:
            out.append(m)
    return out


def syllabes(jeton: str) -> int:
    """Une estimation : les groupes de voyelles (au moins une)."""
    return max(1, len(re.findall(r"[aeiouy]+", jeton)))


# ── les lignes des paroles ──────────────────────────────────
TAG_LRC = re.compile(r"\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]")
SECTION = re.compile(r"^\s*[\[(][^\])]{0,40}[\])]\s*$")   # [verse], [Refrain 2], (instrumental)


def lignes_de(paroles: str) -> list[str]:
    """Les lignes chantées d'un texte : sans les lignes vides ni les
    étiquettes de section des modèles ([verse], [chorus] : la grammaire
    d'ACE-Step et de YuE2) ; un LRC donné en paroles perd ses temps."""
    out = []
    for row in str(paroles or "").replace("\r", "").split("\n"):
        row = TAG_LRC.sub("", row).strip()
        if not row or SECTION.match(row) or META_LRC.match(row):
            continue
        if not jetons(row):
            continue
        out.append(row[:MAX_TEXTE])
    return out[:MAX_LIGNES]


# ── l'alignement des mots ───────────────────────────────────
def _poids(a_keys: set, b_keys: set) -> dict:
    """{mot écrit: {mot entendu: poids}} : 1 s'ils sont égaux, le ratio de
    difflib s'ils sont proches (au-delà de deux lettres), rien sinon."""
    W: dict = {}
    for a in a_keys:
        row = {}
        sm = difflib.SequenceMatcher(None, autojunk=False)
        sm.set_seq2(a)
        for b in b_keys:
            if a == b:
                row[b] = 1.0
                continue
            la, lb = len(a), len(b)
            if min(la, lb) <= 2 or 2 * min(la, lb) / (la + lb) < PROCHE:
                continue
            sm.set_seq1(b)
            if sm.real_quick_ratio() < PROCHE or sm.quick_ratio() < PROCHE:
                continue
            r = sm.ratio()
            if r >= PROCHE:
                row[b] = r
        if row:
            W[a] = row
    return W


def apparier(A: list[str], B: list[str], debuts: list[bool] | None = None,
             temps: tuple | None = None) -> list[tuple[int, int, float]]:
    """L'alignement global de deux suites de mots : [(i, j, poids)] dans l'ordre.
    Deux états (un appariement, un écart) : un écart coûte ECART à son ouverture
    et SUITE par mot ; un appariement rapporte son poids. Un appariement isolé
    au milieu d'un écart doit valoir plus qu'une ouverture.

    `debuts[i]` : le mot écrit i commence une ligne — un écart qui s'ouvre sur un
    début de ligne coûte moins (LIGNE), un appariement qui reprend sur un début
    de ligne rapporte un peu plus (REPRISE) : sauter une ligne entière est ce
    qu'un transcripteur fait (une ligne ratée), et deux lignes qui se
    ressemblent (« On a toute la vie… », « On a toute la nuit… ») ne
    s'échangent pas.

    `temps` = (syllabes de chaque mot écrit, [(début, fin)] de chaque mot entendu,
    secondes par syllabe) : des mots écrits sautés ont été chantés, ils prennent
    du temps. Reprendre après un écart coûte TEMPS par seconde qui manque entre
    le dernier mot entendu apparié et celui-ci pour chanter les syllabes sautées
    (au débit donné, moins une tolérance, TOL) — l'origine de l'écart est
    gardée avec lui (le chemin le meilleur qui l'a ouvert)."""
    n, m = len(A), len(B)
    if not n or not m:
        return []
    debuts = debuts or [False] * n
    W = _poids(set(A), set(B))
    NEG = float("-inf")
    o = ECART + SUITE
    if temps:
        syl, hw, sps = temps
        cs = [0.0]
        for x in syl:
            cs.append(cs[-1] + x)
        rate = sps * LENT
        HA = [x[0] for x in hw] + [float("inf")]   # le début du prochain mot entendu ; après le dernier : rien ne presse
        HB0 = [0.0] + [x[1] for x in hw]           # la fin du dernier mot entendu apparié (0 : le départ)

        def pen(i0, j0, i, j):
            # l'écart ouvert après l'appariement (i0, j0), arrivé en (i, j) : le temps qui manque pour chanter
            x = (cs[i] - cs[i0]) * rate - (HA[j] - HB0[j0]) - TOL
            return TEMPS * x if x > 0 else 0.0
    else:
        def pen(i0, j0, i, j):
            return 0.0
    Mp = [NEG] * (m + 1)                        # dernier geste : un appariement
    Gp = [NEG] * (m + 1)                        # dernier geste : un écart, son score brut…
    Ep = [NEG] * (m + 1)                        # … et le même, moins ce qu'il coûterait en temps de reprendre ici
    Oi = [0] * (m + 1)                          # l'origine de l'écart : le dernier appariement (i, j), 0 = le départ
    Oj = [0] * (m + 1)
    Mp[0] = 0.0
    for j in range(1, m + 1):
        Gp[j] = -(ECART + SUITE * j)
        Ep[j] = Gp[j] - pen(0, 0, 0, j)
    bm = [bytearray(m + 1) for _ in range(n + 1)]   # M vient de : 0 M, 1 G
    bg = [bytearray(m + 1) for _ in range(n + 1)]   # G vient de : 0 M↑, 1 G↑, 2 M←, 3 G←
    for j in range(1, m + 1):
        bg[0][j] = 2 if j == 1 else 3
    for i in range(1, n + 1):
        wa = W.get(A[i - 1]) or {}
        d = debuts[i - 1]
        ou = (ECART * LIGNE if d else ECART) + SUITE     # ouvrir un écart vers le bas : sauter ce mot écrit
        rep = ECART * REPRISE if d else 0.0             # reprendre après un écart sur ce mot écrit
        Mc = [NEG] * (m + 1)
        Gc = [NEG] * (m + 1)
        Ec = [NEG] * (m + 1)
        Ic = [0] * (m + 1)
        Jc = [0] * (m + 1)
        r1, r2 = Mp[0] - ou, Gp[0] - SUITE
        if r1 >= r2:
            Gc[0], bg[i][0], Ic[0], Jc[0] = r1, 0, i - 1, 0
        else:
            Gc[0], bg[i][0], Ic[0], Jc[0] = r2, 1, Oi[0], Oj[0]
        Ec[0] = Gc[0] - pen(Ic[0], Jc[0], i, 0)
        rm, rg = bm[i], bg[i]
        for j in range(1, m + 1):
            w = wa.get(B[j - 1])
            if w:
                x, y = Mp[j - 1], Ep[j - 1] + rep
                if x >= y:
                    Mc[j] = x + w
                else:
                    Mc[j] = y + w
                    rm[j] = 1
            # l'écart : depuis le haut (un mot écrit sauté), ou la gauche (un mot entendu en trop) ;
            # le meilleur se juge sur ce qu'il coûterait de reprendre ici (le temps)
            raw, oi, oj, t = Mp[j] - ou, i - 1, j, 0
            best = raw - pen(oi, oj, i, j) if raw > NEG else NEG
            v = Gp[j] - SUITE
            if v > NEG:
                e = v - pen(Oi[j], Oj[j], i, j)
                if e > best:
                    best, raw, oi, oj, t = e, v, Oi[j], Oj[j], 1
            v = Mc[j - 1] - o
            if v > NEG:
                e = v - pen(i, j - 1, i, j)
                if e > best:
                    best, raw, oi, oj, t = e, v, i, j - 1, 2
            v = Gc[j - 1] - SUITE
            if v > NEG:
                e = v - pen(Ic[j - 1], Jc[j - 1], i, j)
                if e > best:
                    best, raw, oi, oj, t = e, v, Ic[j - 1], Jc[j - 1], 3
            Gc[j], Ec[j], Ic[j], Jc[j] = raw, best, oi, oj
            rg[j] = t
        Mp, Gp, Ep, Oi, Oj = Mc, Gc, Ec, Ic, Jc
    out = []
    i, j = n, m
    st = 0 if Mp[m] >= Gp[m] else 1
    while i > 0 or j > 0:
        if st == 0:
            out.append((i - 1, j - 1, (W.get(A[i - 1]) or {}).get(B[j - 1], 0.0)))
            st = bm[i][j]
            i, j = i - 1, j - 1
        else:
            t = bg[i][j]
            if t in (0, 1):
                i -= 1
            else:
                j -= 1
            st = 0 if t in (0, 2) else 1
    out.reverse()
    return out


def apparier_blocs(A: list[str], B: list[str], debuts=None, temps=None) -> list[tuple[int, int, float]]:
    """Le `SequenceMatcher` seul sur les deux suites de mots (les blocs communs
    exacts) : gardé pour la mesure (tools/paroles_mesure.py), qui montre pourquoi
    `apparier` le remplace pour l'ordre."""
    sm = difflib.SequenceMatcher(None, A, B, autojunk=False)
    return [(a + k, b + k, 1.0) for a, b, n in sm.get_matching_blocks() for k in range(n)]


def mots_entendus(segments: list[dict]) -> list[tuple[str, float, float]]:
    """Les mots d'une transcription (segments de Transcrire, ou de son moteur),
    à plat, dans l'ordre : [(mot, début, fin)]."""
    out = []
    for s in segments or []:
        for w in s.get("words") or []:
            try:
                t, a, b = str(w[0]).strip(), float(w[1]), float(w[2])
            except (TypeError, ValueError, IndexError):
                continue
            if t:
                out.append((t, a, max(a, b)))
    return out


def caler(lignes: list[str], mots: list[tuple[str, float, float]], langue: str = "fr",
          duree: float | None = None, voix: list[tuple[float, float]] | None = None,
          appariement=None) -> list[dict]:
    """Le début de chaque ligne : [{t, texte, comment: "mots" | "estimee", vus,
    sur}] dans l'ordre des lignes. `mots` : les mots entendus (mot, début, fin) ;
    `voix` : les passages où la voix seule chante [(début, fin)], s'il y en a
    (le stem `vocals` : ce qui n'y est pas silence)."""
    L = []      # par ligne : ses jetons et leurs syllabes
    A, A_ligne, A_pos = [], [], []
    for k, texte in enumerate(lignes):
        js = jetons(texte, langue)
        L.append({"texte": texte, "j": js, "syl": [syllabes(x) for x in js]})
        for p, x in enumerate(js):
            A.append(x)
            A_ligne.append(k)
            A_pos.append(p)
    H = []      # les mots entendus, en jetons : (jeton, début, fin, index du mot)
    for q, (w, a, b) in enumerate(sorted(mots, key=lambda x: x[1])):
        js = jetons(w, langue)
        if not js:
            continue
        # un mot entendu fait de plusieurs jetons (« qu'est-ce », « 20 ») : son temps réparti
        tot = sum(syllabes(x) for x in js)
        t = a
        for x in js:
            d = (b - a) * syllabes(x) / tot
            H.append((x, t, t + d, q))
            t += d
    debuts = [p == 0 for p in A_pos]
    # le débit des mots entendus eux-mêmes (s par syllabe) : de quoi juger qu'un écart a eu le temps d'être chanté
    d0 = [(h[2] - h[1]) / syllabes(h[0]) for h in H if h[2] > h[1]]
    sps0 = min(0.6, max(0.08, statistics.median(d0))) if d0 else SPS
    syl_a = [syllabes(x) for x in A]
    pairs = (appariement or apparier)(A, [h[0] for h in H], debuts, (syl_a, [(h[1], h[2]) for h in H], sps0)) \
        if A and H else []
    par_ligne: dict[int, list] = {}
    for i, j, w in pairs:
        par_ligne.setdefault(A_ligne[i], []).append((A_pos[i], j, w))

    # le débit (secondes par syllabe) : entre deux mots appariés qui se suivent dans une ligne
    rates = []
    for k, ms in par_ligne.items():
        syl = L[k]["syl"]
        for (p1, j1, _), (p2, j2, _) in zip(ms, ms[1:]):
            s = sum(syl[p1:p2])
            dt = H[j2][1] - H[j1][1]
            if s and dt > 0:
                rates.append(dt / s)
    if len(rates) < 5:   # trop peu : le débit des mots entendus eux-mêmes
        rates += [(h[2] - h[1]) / syllabes(h[0]) for h in H if h[2] > h[1]]
    sps = min(1.0, max(0.08, statistics.median(rates))) if rates else SPS

    n = len(L)
    debut: list[float | None] = [None] * n
    fin: list[float | None] = [None] * n
    premier: list[int | None] = [None] * n     # le premier et le dernier mot entendu apparié de la ligne
    dernier: list[int | None] = [None] * n
    for k, ms in par_ligne.items():
        syl = L[k]["syl"]
        votes = [H[j][1] - sum(syl[:p]) * sps for p, j, _ in ms[:VOTES]]
        debut[k] = statistics.median(votes)
        p_last, j_last, _ = ms[-1]
        fin[k] = H[j_last][2] + sum(syl[p_last + 1:]) * sps
        premier[k], dernier[k] = ms[0][1], ms[-1][1]

    # les lignes sans mot reconnu : par groupes, entre deux lignes reconnues
    total_syl = [max(1, sum(x["syl"])) for x in L]
    k = 0
    while k < n:
        if debut[k] is not None:
            k += 1
            continue
        g0 = k
        while k < n and debut[k] is None:
            k += 1
        g1 = k          # le groupe : [g0, g1)
        prev, nxt = g0 - 1, g1 if g1 < n else None
        sy = [total_syl[x] for x in range(g0, g1)]
        S = sum(sy)
        besoin = S * sps
        # l'intervalle : de la fin estimée de la ligne d'avant au début de la suivante
        lo = fin[prev] if prev >= 0 else 0.0
        hi = debut[nxt] if nxt is not None else (duree or max([h[2] for h in H] + [lo + besoin]))
        hi = max(hi, lo)
        # 1. des mots entendus non appariés dans l'intervalle, assez nombreux et assez étalés
        #    pour être la ligne ratée elle-même (un mot ou deux collés à une voisine en sont
        #    plutôt un morceau mal entendu)
        j_from = dernier[prev] + 1 if prev >= 0 else 0
        j_to = premier[nxt] if nxt is not None else len(H)
        libres = [h for h in H[j_from:j_to] if lo - 0.05 <= h[1] < hi - 0.05]
        nmots = sum(len(L[x]["j"]) for x in range(g0, g1))
        places: list[tuple[float, float]] = []
        if len(libres) >= max(2, 0.3 * nmots) and libres[-1][2] - libres[0][1] >= 0.4 * besoin:
            places = [(libres[0][1], libres[-1][2])]
        # 2. la voix seule : ses passages chantés dans l'intervalle (le stem, ffmpeg silencedetect)
        elif voix:
            # un passage commencé avant `lo` est d'abord la fin de la ligne d'avant : il ne compte
            # que s'il dure encore de quoi chanter la moitié du groupe
            vs = []
            for x, y in voix:
                x2, y2 = max(x, lo + 0.05), min(y, hi - 0.05)
                if y2 - x2 >= (0.5 * besoin if x < lo + 0.05 else 0.2):
                    vs.append((x2, y2))
            if sum(y - x for x, y in vs) >= 0.3 * besoin:
                # un passage qui suffit à lui seul : le plus long (un souffle, une fuite de la
                # séparation sont brefs) ; sinon le groupe s'étend sur tous
                grand = max(vs, key=lambda v: v[1] - v[0])
                places = [grand] if grand[1] - grand[0] >= 0.6 * besoin else vs
        # 3. rien d'autre : avant la première ligne, juste avant elle ; après la dernière, juste
        #    après ; entre deux, réparties si l'intervalle est à leur mesure, sinon au milieu
        if not places:
            if prev < 0 and nxt is not None:
                places = [(max(0.0, hi - besoin), hi)]
            elif nxt is None:
                if duree:   # le son finit avant : on remonte d'autant, sans passer avant la ligne d'avant
                    lo = min(lo, max(debut[prev] + 0.5 if prev >= 0 else 0.0, duree - besoin))
                places = [(lo, min(lo + besoin, duree) if duree else lo + besoin)]
            elif hi - lo > 1.5 * besoin:
                c = (lo + hi) / 2
                places = [(c - besoin / 2, c + besoin / 2)]
            else:
                places = [(lo, hi)]
        tot = sum(y - x for x, y in places) or 1e-9
        acc = 0
        for x, s_ in zip(range(g0, g1), sy):
            u = tot * acc / S            # la place de la ligne dans le temps chanté, mis bout à bout
            for pa, pb in places:
                if u <= pb - pa + 1e-9:
                    debut[x] = pa + u
                    break
                u -= pb - pa
            else:
                debut[x] = places[-1][1]
            acc += s_
    # dans l'ordre, sans deux lignes au même instant
    out, last = [], -1.0
    for x in range(n):
        t = max(0.0, float(debut[x]))
        if duree:
            t = min(t, max(0.0, duree - 0.01))
        t = max(t, last + 0.01) if last >= 0 else t
        last = t
        vus = len(par_ligne.get(x, []))
        out.append({"t": round(t, 2), "texte": L[x]["texte"], "comment": "mots" if vus else "estimee",
                    "vus": vus, "sur": len(L[x]["j"])})
    return out


def depuis_transcription(segments: list[dict], max_mots: int = 10, pause: float = 0.8) -> list[dict]:
    """Sans paroles connues : la transcription elle-même devient les paroles.
    Une ligne par segment, coupé à une pause (≥ `pause` s) ou après une
    ponctuation forte quand la ligne a déjà quatre mots, et jamais plus de
    `max_mots` mots (coupé alors à la plus longue pause)."""
    out = []
    for s in segments or []:
        ws = [(str(w[0]).strip(), float(w[1]), float(w[2])) for w in s.get("words") or [] if str(w[0]).strip()]
        if not ws:
            txt = str(s.get("text") or "").strip()
            if txt:
                out.append({"t": round(float(s.get("a") or 0), 2), "texte": txt[:MAX_TEXTE], "comment": "mots", "vus": 1, "sur": 1})
            continue
        cur = [ws[0]]
        groups = []
        for w in ws[1:]:
            gap = w[1] - cur[-1][2]
            if gap >= pause or (len(cur) >= 4 and re.search(r"[.!?;:]$", cur[-1][0])):
                groups.append(cur)
                cur = [w]
            else:
                cur.append(w)
        groups.append(cur)
        for g in groups:
            while len(g) > max_mots:
                cut = max(range(1, len(g)), key=lambda x: (g[x][1] - g[x - 1][2], -abs(x - len(g) / 2)))
                cut = cut if 2 <= cut <= len(g) - 2 else max_mots
                groups_part, g = g[:cut], g[cut:]
                out.append({"t": round(groups_part[0][1], 2), "texte": " ".join(x[0] for x in groups_part)[:MAX_TEXTE],
                            "comment": "mots", "vus": len(groups_part), "sur": len(groups_part)})
            out.append({"t": round(g[0][1], 2), "texte": " ".join(x[0] for x in g)[:MAX_TEXTE], "comment": "mots",
                        "vus": len(g), "sur": len(g)})
    out.sort(key=lambda x: x["t"])
    return out[:MAX_LIGNES]


# ── le format LRC ───────────────────────────────────────────
META_LRC = re.compile(r"^\s*\[(ti|ar|al|au|by|re|ve|length|la|lang|offset):([^\]]*)\]\s*$", re.I)


def temps_lrc(t: float) -> str:
    cs = max(0, int(round(float(t) * 100)))
    m, cs = divmod(cs, 6000)
    return f"{m:02d}:{cs // 100:02d}.{cs % 100:02d}"


def lire_lrc(txt: str) -> dict:
    """{tags: {ti, ar…}, lignes: [[t, texte]]} ; le décalage `[offset:±ms]` est
    appliqué aux temps (et retiré) ; les lignes sans temps sont ignorées."""
    tags, rows, offset = {}, [], 0.0
    for raw in str(txt or "").lstrip("﻿").replace("\r", "").split("\n"):
        m = META_LRC.match(raw)
        if m:
            k, v = m.group(1).lower(), m.group(2).strip()
            if k == "offset":
                try:
                    offset = float(v) / 1000.0
                except ValueError:
                    raise ValueError(f"[offset:{v}] : des millisecondes") from None
            elif v:
                tags[k] = v[:200]
            continue
        ts = [int(a) * 60 + float(b.replace(":", ".")) for a, b in TAG_LRC.findall(raw)]
        if not ts:
            continue
        texte = TAG_LRC.sub("", raw).strip()
        rows += [[t, texte] for t in ts]
    # LRC : un décalage positif fait paraître les paroles plus tôt (temps − décalage)
    return {"tags": tags, "lignes": [[max(0.0, t - offset), x] for t, x in rows]}


def ecrire_lrc(lignes: list, tags: dict | None = None) -> str:
    head = [f"[{k}:{v}]" for k, v in (tags or {}).items() if v]
    body = [f"[{temps_lrc(t)}]{x}" for t, x in sorted(lignes, key=lambda r: r[0])]
    return "\n".join(head + body) + ("\n" if head or body else "")


def normaliser_lrc(txt, duree: float | None = None) -> str:
    """Un LRC venu d'une page : relu, borné, trié, remis au format (ValueError → 400)."""
    if not isinstance(txt, str):
        raise ValueError("lrc : un texte")
    if len(txt) > LRC_MAX:
        raise ValueError(f"lrc : {LRC_MAX} signes au plus")
    d = lire_lrc(txt)
    if len(d["lignes"]) > MAX_LIGNES:
        raise ValueError(f"lrc : {MAX_LIGNES} lignes au plus")
    for t, x in d["lignes"]:
        if len(x) > MAX_TEXTE:
            raise ValueError(f"lrc : une ligne tient en {MAX_TEXTE} signes")
        if duree and t > duree + 5:
            raise ValueError(f"lrc : [{temps_lrc(t)}] est après la fin du son ({temps_lrc(duree)})")
    if txt.strip() and not d["lignes"]:
        raise ValueError("lrc : aucune ligne datée ([mm:ss.cc] texte)")
    return ecrire_lrc(d["lignes"], d["tags"])


# ── l'essai de vérité : des mots entendus fabriqués à partir d'un LRC ──
# Les taux : Whisper sur des chansons, Jam-ALT (Cífka et al., « Lyrics Transcription for
# Humans: A Readability-Aware Benchmark », ISMIR 2024, arXiv:2408.06370) : WER de 27,9 %
# (v2, langue donnée) à 35,7 % (v2, toutes langues) ; la voix séparée par Demucs le dégrade
# le plus souvent (même article). Les temps : l'alignement DTW de Whisper au pas de 20 ms
# (whisper/timing.py) ; sur le chant, son erreur n'est pas documentée — l'état de l'art
# des aligneurs dédiés est d'environ 0,2 s d'erreur absolue moyenne sur JamendoLyrics
# (Stoller et al., ICASSP 2019) : le bruit des temps va de 0,08 à 0,5 s.
# sup : mot manqué ; sub : mal entendu ; ins : mot ajouté ; ligne : ligne entière sautée ;
# sigma : bruit des temps (s, gaussien) ; loin : part des mots décalés de 0,5 à 1,5 s.
BRUITS = {
    "propre": {"sup": 0.03, "sub": 0.05, "ins": 0.02, "ligne": 0.00, "sigma": 0.08, "loin": 0.00},
    "moyen": {"sup": 0.08, "sub": 0.15, "ins": 0.05, "ligne": 0.02, "sigma": 0.20, "loin": 0.03},
    "fort": {"sup": 0.12, "sub": 0.22, "ins": 0.08, "ligne": 0.05, "sigma": 0.35, "loin": 0.05},
    "extreme": {"sup": 0.20, "sub": 0.30, "ins": 0.12, "ligne": 0.10, "sigma": 0.50, "loin": 0.08},
}
REMPLISSAGE = ("oh", "yeah", "ah", "uh", "na", "ooh", "hey", "la")


def _mal_entendu(w: str, rnd: random.Random, vocab: list[str]) -> str:
    """Un mot mal entendu : la moitié du temps de peu (une lettre changée, perdue
    ou doublée), sinon un autre mot (de la chanson ou un remplissage)."""
    if rnd.random() < 0.5 and len(w) >= 3:
        k = rnd.randrange(len(w))
        how = rnd.choice(("rempl", "perd", "double"))
        if how == "rempl":
            c = rnd.choice("aeioumnrstlp")
            return w[:k] + c + w[k + 1:]
        if how == "perd":
            return w[:k] + w[k + 1:]
        return w[:k] + w[k] + w[k:]
    return rnd.choice(vocab or list(REMPLISSAGE))


def entendre(lignes_t: list[tuple[float, str]], duree: float, niveau: str = "moyen", graine: int = 0,
             langue: str = "en", sps: float = 0.28) -> list[tuple[str, float, float]]:
    """Des « mots entendus » plausibles pour des lignes datées (le début de
    chacune) : chaque ligne chantée de son début, à `sps` s par syllabe, sans
    déborder sur la suivante ; ses mots au prorata de leurs syllabes ; puis le
    bruit du niveau (BRUITS) ; les temps restent dans l'ordre, comme ceux de
    Whisper (son alignement est monotone)."""
    B = BRUITS[niveau]
    rnd = random.Random(graine)
    vocab = sorted({w.strip(".,;:!?\"'()") for _, x in lignes_t for w in x.split() if len(w) > 1})
    out = []
    rows = sorted(lignes_t)
    for k, (t, texte) in enumerate(rows):
        mots = texte.split()
        if not mots or rnd.random() < B["ligne"]:
            continue
        syl = [sum(syllabes(j) for j in jetons(w, langue)) or 1 for w in mots]
        nxt = rows[k + 1][0] if k + 1 < len(rows) else duree
        d = min(sum(syl) * sps, max(0.3, nxt - t - 0.12))
        a = t
        for w, s in zip(mots, syl):
            b = a + d * s / sum(syl)
            if rnd.random() >= B["sup"]:
                ww = _mal_entendu(w, rnd, vocab) if rnd.random() < B["sub"] else w
                # la forme : la casse, la ponctuation, un nombre écrit autrement
                if ww.isdigit() and rnd.random() < 0.5:
                    ww = nombre(int(ww), langue)
                if rnd.random() < 0.2:
                    ww = ww.capitalize() if rnd.random() < 0.5 else ww.lower()
                if rnd.random() < 0.1:   # les accents perdus, l'autre apostrophe
                    ww = plat(ww).replace("'", "’")
                out.append([ww, a, b])
            if rnd.random() < B["ins"]:
                out.append([rnd.choice(REMPLISSAGE), b, b + 0.2])
            a = b
    for w in out:   # le bruit des temps, et quelques mots loin de leur place
        dt = rnd.gauss(0, B["sigma"])
        if rnd.random() < B["loin"]:
            dt += rnd.choice((-1, 1)) * rnd.uniform(0.5, 1.5)
        span = w[2] - w[1]
        w[1] = min(max(0.0, w[1] + dt), duree)
        w[2] = min(w[1] + span, duree)
    ts = sorted(w[1] for w in out)
    return [(w[0], t, max(t, min(duree, t + (w[2] - w[1])))) for w, t in zip(out, ts)]


def voix_simulee(lignes_t: list[tuple[float, str]], duree: float, graine: int = 0, langue: str = "en",
                 sps: float = 0.28) -> list[tuple[float, float]]:
    """Les passages chantés que verrait silencedetect sur la voix seule : chaque
    ligne de son début à sa fin chantée (comme `entendre`, lignes sautées
    comprises : la voix était là), réunis sous 0,35 s de silence (le seuil de
    transcrire.speech_regions), les bords à ± 0,1 s, et un faux passage (un
    souffle, une fuite de la séparation) toutes les 40 s environ."""
    rnd = random.Random(graine + 7)
    rows = sorted(lignes_t)
    spans = []
    for k, (t, texte) in enumerate(rows):
        syl = sum(syllabes(j) for j in jetons(texte, langue)) or 1
        nxt = rows[k + 1][0] if k + 1 < len(rows) else duree
        spans.append([t + rnd.uniform(-0.1, 0.1), t + min(syl * sps, max(0.3, nxt - t - 0.12)) + rnd.uniform(-0.1, 0.1)])
    for _ in range(int(duree // 40)):
        a = rnd.uniform(0, max(0.0, duree - 1))
        spans.append([a, a + rnd.uniform(0.5, 1.0)])
    spans.sort()
    out = []
    for a, b in spans:
        if out and a - out[-1][1] < 0.35:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([max(0.0, a), min(duree, b)])
    return [(a, b) for a, b in out if b - a >= 0.5]


def ecarts(calees: list[dict], vrai: list[tuple[float, str]]) -> list[float]:
    """L'écart (s) de chaque ligne calée à la vraie, ligne à ligne (même ordre)."""
    return [abs(c["t"] - t) for c, (t, _) in zip(calees, sorted(vrai))]


def resume_ecarts(e: list[float]) -> dict:
    if not e:
        return {"n": 0}
    s = sorted(e)
    return {"n": len(s), "mediane": round(statistics.median(s), 3), "p90": round(s[min(len(s) - 1, int(0.9 * len(s)))], 3),
            "pire": round(s[-1], 3), "sous_05": round(sum(1 for x in s if x <= 0.5) / len(s), 3)}


# ── la chaîne : la voix seule, les mots entendus, le calage ──
# Un document par son : <data_dir>/paroles/<id du son>.json — l'étape, le travail
# qu'on attend, la voix seule, la transcription, les paroles données, le résultat.
_lock = threading.RLock()
ACTIVE = ("voix", "mots", "calage")
ETAPES = {"voix": "la voix seule", "mots": "les mots entendus", "calage": "le calage", "fini": "calées",
          "echec": "échec", "arrete": "arrêté"}
SUITES = ("music.stems", "transcrire.transcribe", KIND)


def _dir() -> Path:
    p = config.data_dir() / "paroles"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _path(iid: str) -> Path:
    if not library.ID_RE.fullmatch(iid or ""):
        raise HttpError(404, f"introuvable : {iid}")
    return _dir() / f"{iid}.json"


def _load(iid: str) -> dict | None:
    try:
        return json.loads(_path(iid).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write(ch: dict) -> None:
    ch["updated"] = library.now()
    f = _path(ch["item"])
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(ch, ensure_ascii=False), encoding="utf-8")
    tmp.replace(f)


class _Comme:
    """Le temps d'une suite lancée hors d'une requête (l'accroche jobs.AFTER) :
    la personne et le Workspace du travail qui vient de finir, comme la file
    les pose le temps d'un `run` ; ceux d'avant sont remis ensuite."""

    def __init__(self, j: dict) -> None:
        self.j = j

    def __enter__(self):
        self.avant = (auth.current(), auth.current_space())
        auth.set_current(auth.user(self.j.get("owner")) if self.j.get("owner") else None)
        auth.set_current_space(self.j.get("space"))

    def __exit__(self, *exc):
        auth.set_current(self.avant[0])
        auth.set_current_space(self.avant[1])
        return False


def voix_modeles() -> list[str]:
    """Les modèles de séparation qui sortent la voix, du meilleur au moins bon
    pour elle (le SDR « vocals » publié sur Multisong, music_stems.MODELS)."""
    from tools import music_stems as MS

    def sdr(m):
        return max((x["sdr"].get("vocals", 0.0) for x in m["measures"] if x["set"] == MS.MULTISONG), default=0.0)
    return sorted((k for k, m in MS.MODELS.items() if "vocals" in m["stems"]), key=lambda k: -sdr(MS.MODELS[k]))


def voix_de(it: dict) -> dict | None:
    """La voix seule d'un son : lui-même s'il en est une, sinon son stem
    `vocals` le plus récent (quel que soit l'outil qui l'a fait)."""
    if (it.get("params") or {}).get("stem") == "vocals":
        return it
    for x in library.query(kinds=["audio"], limit=5000)["items"]:   # du plus récent au plus ancien
        pr = x.get("params") or {}
        if pr.get("src") == it["id"] and pr.get("stem") == "vocals":
            return x
    return None


def mots_de(iid: str) -> dict | None:
    """La transcription la plus récente de ce son qui a ses mots datés (mode
    complet), finie, et que la personne peut lire."""
    from tools import transcrire as T
    best = None
    for f in T._dir().glob("trn-*.json"):
        if f.name.endswith(".voix.json"):
            continue
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if d.get("item") != iid or d.get("state") != "done" or not library.readable(d):
            continue
        if not any(s.get("words") for s in d.get("segments") or []):
            continue
        if best is None or (d.get("created") or "") > (best.get("created") or ""):
            best = d
    return best


def _voix_pourquoi() -> tuple[str | None, str]:
    """Le modèle qui fera la voix seule, ou pourquoi on s'en passe : la
    séparation est du Studio (ODIO) ; un modèle doit être prêt."""
    from tools import music_stems as MS
    try:
        auth.need_studio_kind("music.stems", auth.current(), auth.current_space())
    except HttpError:
        return None, "la séparation fait partie du Studio"
    ready = {m["id"]: m for m in MS.options()["models"]}
    for mid in voix_modeles():
        if ready.get(mid, {}).get("ready"):
            return mid, ""
    return None, "aucun modèle de séparation n'est prêt"


def _langue_tr(langue: str) -> str:
    from tools import transcrire as T
    return langue if langue in T.LANGS else "auto"


def _etape(ch: dict) -> dict:
    """La suite de la chaîne, d'après ce qui est déjà là : lance le travail qui
    manque (la voix seule, les mots, le calage) et le note dans la chaîne."""
    from tools import music_stems as MS
    from tools import transcrire as T
    it = library.get(ch["item"])
    if not it:
        raise RuntimeError("le son a quitté la bibliothèque")
    title = (it.get("title") or it["id"])[:60]
    # 1. la voix seule
    if not ch.get("cible"):
        v = voix_de(it) if ch.get("voix") != "melange" else None
        if v:
            ch.update(cible=v["id"], stem=v["id"])
        elif ch.get("voix") == "melange":
            ch.update(cible=it["id"], note="le mélange est transcrit (demandé)")
        else:
            mid, why = _voix_pourquoi()
            if not mid:
                ch.update(cible=it["id"], note=f"sans la voix seule ({why}) : le mélange est transcrit")
            else:
                j = MS.submit(MS.stems_params({"src": it["id"], "model": mid, "stems": ["vocals"]}), tool=TOOL)
                ch.update(state="voix", job=j["id"], message="")
                ch["jobs"]["voix"] = j["id"]
                return ch
    # 2. les mots entendus
    if not ch.get("trn"):
        d = mots_de(ch["cible"])
        if d:
            ch["trn"] = d["id"]
        else:
            try:
                c = T.check({"item": ch["cible"], "mode": "complet", "speakers": False, "lang": _langue_tr(ch.get("langue") or "")})
            except ValueError as e:
                raise RuntimeError(f"Transcrire : {e}") from e
            d, j = T.lancer(c)
            ch.update(state="mots", job=j["id"], trn=d["id"], message="")
            ch["jobs"]["mots"] = j["id"]
            return ch
    # 3. le calage
    j = jobs.submit(KIND, {"item": it["id"], "trn": ch["trn"], "cible": ch["cible"], "paroles": ch.get("paroles") or "",
                           "langue": ch.get("langue") or ""},
                    title=f"Paroles · {title}", tool=TOOL, thumb=library.public(it).get("thumb_url"))
    ch.update(state="calage", job=j["id"], message="")
    ch["jobs"]["calage"] = j["id"]
    return ch


def _son_du_travail(j: dict) -> list[str]:
    """Les sons dont la chaîne peut attendre ce travail (le son, ou celui dont il transcrit la voix)."""
    p = j.get("params") or {}
    if j.get("kind") == "music.stems":
        return [p.get("src") or p.get("item") or ""]
    if j.get("kind") == KIND:
        return [p.get("item") or ""]
    it = library.get(p.get("item") or "")
    return [x for x in (p.get("item"), ((it or {}).get("params") or {}).get("src")) if x]


def _suite(j: dict) -> None:
    """L'accroche (jobs.AFTER) : un maillon de la chaîne est sorti de la file ;
    la suite part au nom du travail, ou la chaîne dit l'échec, l'arrêt, la fin."""
    if j.get("kind") not in SUITES:
        return
    for iid in _son_du_travail(j):
        if not library.ID_RE.fullmatch(iid or ""):
            continue
        with _lock:
            ch = _load(iid)
            if not ch or ch.get("job") != j["id"] or ch.get("state") not in ACTIVE:
                continue
            if j["state"] != "done":
                ch.update(state="arrete" if j["state"] == "cancelled" else "echec",
                          message=f"{ETAPES.get(ch['state'], '')} : {j.get('message') or j['state']}")
                _write(ch)
                return
            try:
                with _Comme(j):
                    if j["kind"] == KIND:
                        ch.update(state="fini", message=(j.get("result") or {}).get("note", ""))
                    else:
                        if j["kind"] == "music.stems":
                            v = ((j.get("result") or {}).get("stems") or {}).get("vocals")
                            if not v:
                                raise RuntimeError("la séparation n'a pas rendu de voix")
                            ch.update(cible=v, stem=v)
                        ch = _etape(ch)
            except (RuntimeError, ValueError, KeyError, PermissionError, HttpError) as e:
                ch.update(state="echec", message=str(getattr(e, "message", "") or e)[:400])
            _write(ch)
            return


def _vivant(iid: str) -> dict | None:
    """La chaîne, rattrapée si un maillon est sorti de la file sans passer par
    l'accroche (retiré avant de partir, interrompu par un redémarrage)."""
    ch = _load(iid)
    if ch and ch.get("state") in ACTIVE:
        j = jobs.get(ch.get("job") or "")
        if not j:
            with _lock:
                ch = _load(iid)
                if ch and ch.get("state") in ACTIVE:
                    ch.update(state="echec", message=f"{ETAPES[ch['state']]} : le travail a quitté la file")
                    _write(ch)
        elif j["state"] not in ("queued", "running"):
            _suite(j)
        ch = _load(iid)
    return ch


def public_chaine(ch: dict | None) -> dict | None:
    if not ch:
        return None
    j = jobs.get(ch.get("job") or "") if ch.get("state") in ACTIVE else None
    r = ch.get("resultat") or {}
    return {"state": ch.get("state"), "etape": ETAPES.get(ch.get("state") or "", ""), "message": ch.get("message") or "",
            "note": ch.get("note") or "", "job": ch.get("job"), "jobs": ch.get("jobs") or {},
            "progress": j.get("progress") if j else None, "live": (j.get("message") or "") if j else "",
            "stem": ch.get("stem"), "trn": ch.get("trn"), "source": ch.get("source"), "langue": ch.get("langue") or "",
            "created": ch.get("created"), "updated": ch.get("updated"),
            "resultat": {k: r.get(k) for k in ("lignes_n", "reconnues", "estimees", "mots", "voix", "secondes")} if r else None}


# ── le travail : le calage ──────────────────────────────────
def run_caler(ctx) -> dict:
    from tools import transcrire as T
    p = ctx.params
    t0 = time.time()
    it = library.get(p.get("item") or "")
    if not it:
        raise RuntimeError("le son a quitté la bibliothèque")
    d = T._load(p.get("trn") or "")
    if not d or d.get("state") != "done":
        raise RuntimeError("la transcription n'est pas là (ou pas finie)")
    ctx.progress(0.1, "les mots entendus")
    segs = d.get("segments") or []
    mots = [w for s in segs for w in T.seg_words(s, "src")]
    langue = p.get("langue") if p.get("langue") in ("fr", "en") else (d.get("detected") or "fr")
    duree = float(it.get("duration") or 0) or None
    voix = None
    cible = library.get(p.get("cible") or "")
    if cible and (cible.get("params") or {}).get("stem") == "vocals":
        ctx.progress(0.3, "les passages chantés de la voix seule")
        voix = T.speech_regions(library.path_of(cible), float(cible.get("duration") or duree or 0))
    ctx.check()
    lignes = lignes_de(p.get("paroles") or "")
    ctx.progress(0.5, f"aligne {len(mots)} mots sur {len(lignes)} lignes" if lignes else "les lignes de la transcription")
    cal = caler(lignes, mots, langue, duree, voix) if lignes else depuis_transcription(segs)
    if not cal:
        raise RuntimeError("rien à caler : ni paroles connues ni mots entendus")
    lrc = ecrire_lrc([[c["t"], c["texte"]] for c in cal])
    library.update(it["id"], {"lrc": lrc})
    ok = sum(1 for c in cal if c["comment"] == "mots")
    res = {"lrc": lrc, "lignes": [{k: c[k] for k in ("t", "comment", "vus", "sur")} for c in cal], "lignes_n": len(cal),
           "reconnues": ok, "estimees": len(cal) - ok, "mots": len(mots), "voix": voix is not None,
           "secondes": round(time.time() - t0, 2)}
    with _lock:
        ch = _load(it["id"])
        if ch and ch.get("job") == ctx.job["id"]:
            ch["resultat"] = res
            _write(ch)
    src = "paroles connues" if lignes else "la transcription"
    n = lambda k, un: f"{k} {un}{'s' if k > 1 else ''}"   # noqa: E731
    return {"note": f"{n(len(cal), 'ligne')} ({src}) · {n(ok, 'reconnue')} · {n(len(cal) - ok, 'estimée')}", "item": it["id"]}


# ── les routes ──────────────────────────────────────────────
def _son(iid: str) -> dict:
    it = library.get(iid) if library.ID_RE.fullmatch(iid or "") else None
    if not it or not library.readable(it):
        raise HttpError(404, f"introuvable : {iid}")
    if it.get("kind") != "audio":
        raise HttpError(400, "des paroles calées ne vont qu'à un son")
    return it


def _connues(it: dict, ch: dict | None) -> tuple[str, str]:
    """Les paroles connues et d'où elles viennent : données au dernier calage,
    sinon la recette de la chanson (Musique)."""
    if ch and ch.get("paroles"):
        return ch["paroles"], ch.get("source") or "texte"
    rec = (it.get("params") or {}).get("chanson") or {}
    if isinstance(rec, dict) and isinstance(rec.get("lyrics"), str) and rec["lyrics"].strip():
        return rec["lyrics"], "recette"
    return "", ""


def etat(it: dict) -> dict:
    from tools import transcrire as T
    ch = _vivant(it["id"])
    paroles, source = _connues(it, ch)
    lrc = it.get("lrc") or ""
    try:
        lignes = lire_lrc(lrc)["lignes"]
    except ValueError:
        lignes = []
    r = (ch or {}).get("resultat") or {}
    estimees = [k for k, x in enumerate(r.get("lignes") or []) if x.get("comment") == "estimee"] if r.get("lrc") == lrc else []
    me = auth.current()
    ecrire = auth.can_write_item(it, me)
    why = "" if ecrire else "ce son n'est pas à toi : tu ne peux pas en écrire les paroles"
    if not why:
        try:
            jobs._guard(KIND, {}, me, me, jobs._space_for(me))
        except HttpError as e:
            why = e.message
    if not why:
        aid, w = T.pick_asr("complet", "auto")
        why = "" if aid else f"Transcrire : {w}"
    pub = library.public(it)
    rec = (it.get("params") or {}).get("chanson") or {}
    return {"item": {k: pub.get(k) for k in ("id", "kind", "title", "url", "duration", "thumb_url")},
            "lrc": lrc, "lignes": lignes, "estimees": estimees, "paroles": paroles, "source": source,
            "langue": (ch or {}).get("langue") or (rec.get("language") if isinstance(rec, dict) else "") or "",
            "calage": public_chaine(ch),
            "peut": {"ecrire": ecrire, "caler": not why and not (ch and ch.get("state") in ACTIVE), "why": why}}


def api_get(req, iid):
    return etat(_son(iid))


def api_set(req, iid):
    it = _son(iid)
    library.check_write(it)
    ch = _vivant(iid)
    if ch and ch.get("state") in ACTIVE:
        raise HttpError(409, f"un calage est en cours ({ETAPES[ch['state']]}) : attends-le, ou arrête-le dans la File")
    try:
        lrc = normaliser_lrc((req.json() or {}).get("lrc"), it.get("duration"))
        library.update(iid, {"lrc": lrc})
    except ValueError as e:
        raise HttpError(400, str(e)) from e
    return etat(library.get(iid))


def api_caler(req, iid):
    """Lancer la chaîne. La garde du calcul d'abord (comme Transcrire) : un
    guest n'apprend rien du son, et rien n'est écrit."""
    me = auth.current()
    jobs._guard(KIND, {}, me, me, jobs._space_for(me))
    it = _son(iid)
    library.check_write(it)
    b = req.json() or {}
    if not isinstance(b, dict):
        raise HttpError(400, "un objet JSON est attendu")
    paroles = b.get("paroles") or ""
    langue = b.get("langue") or ""
    voix = b.get("voix") or "auto"
    if not isinstance(paroles, str) or len(paroles) > MAX_PAROLES:
        raise HttpError(400, f"paroles : un texte de {MAX_PAROLES} signes au plus")
    if not isinstance(langue, str) or not (langue == "" or re.fullmatch(r"[a-z]{2}", langue)):
        raise HttpError(400, "langue : un code de deux lettres (fr, en…)")
    if voix not in ("auto", "melange"):
        raise HttpError(400, "voix : « auto » (la voix seule si on peut) ou « melange »")
    rec = (it.get("params") or {}).get("chanson") or {}
    if paroles.strip() and not lignes_de(paroles):
        raise HttpError(400, "paroles : aucune ligne chantée (rien que des étiquettes ou des lignes vides)")
    source = "texte" if paroles.strip() else ""
    if not paroles.strip() and isinstance(rec, dict) and isinstance(rec.get("lyrics"), str) and rec["lyrics"].strip():
        paroles, source = rec["lyrics"], "recette"
    if not langue and isinstance(rec, dict):
        langue = rec.get("language") or ""
    with _lock:
        old = _vivant(iid)
        if old and old.get("state") in ACTIVE:
            raise HttpError(409, f"le calage est déjà en cours ({ETAPES[old['state']]})")
        ch = {"item": iid, "state": None, "job": None, "jobs": {}, "paroles": paroles.strip(), "source": source or "transcription",
              "langue": langue, "voix": voix, "note": "", "message": "", "created": library.now()}
        library.stamp(ch, source=it)   # son auteur ; son Workspace : celui du son
        try:
            ch = _etape(ch)
        except RuntimeError as e:
            raise HttpError(400, str(e)) from e
        _write(ch)
    return etat(library.get(iid))


def register(app) -> None:
    jobs.register(KIND, run_caler, lane="cpu", title="Caler les paroles", cost="cpu")
    if _suite not in jobs.AFTER:
        jobs.AFTER.append(_suite)
    app.route("GET", "/api/paroles/{iid}", api_get)
    app.route("POST", "/api/paroles/{iid}", api_set)
    app.route("POST", "/api/paroles/{iid}/caler", api_caler)


# ── le contrôle sans GPU (tools/check.py) ───────────────────
# Une chanson fabriquée ici (pas les fichiers d'AGOSTA, dépôt privé) : des élisions,
# des nombres, des accents, un refrain trois fois, un pont instrumental de 12 s.
ESSAI_REFRAIN = ["J'ai vingt ans ce soir et l'été s'en va", "C'est la mer qui chante au bout de nos voix",
                 "Qu'on s'en aille à 3 sur la route du port", "Et qu'il pleuve encore, et qu'il pleuve encore"]
ESSAI_COUPLETS = [["Le vieux phare s'allume au-dessus des toits", "On a laissé nos noms sur le sable froid",
                   "Les bateaux rentrent tard quand le vent se lève", "Et ta main dans la mienne a le goût d'un rêve"],
                  ["Au café de la gare on refait le monde", "Les cigarettes brûlent, la nuit est profonde",
                   "Tu m'as dit qu'à 20 ans on n'a peur de rien", "Mais je tremble un peu quand je tiens ta main"]]


def chanson_essai() -> tuple[list[tuple[float, str]], float]:
    """Les lignes datées de la chanson d'essai, et sa durée."""
    rows, t = [], 8.0
    blocs = [ESSAI_COUPLETS[0], ESSAI_REFRAIN, ESSAI_COUPLETS[1], ESSAI_REFRAIN, None, ESSAI_REFRAIN]
    for k, b in enumerate(blocs):
        if b is None:
            t += 12.0
            continue
        for x in b:
            rows.append((round(t, 2), x))
            t += 3.1 + 0.37 * (len(x) % 5)
        t += 2.5
    return rows, round(t + 4, 2)


def _wav_essai(path: Path, rows: list[tuple[float, str]], duree: float, sr: int = 16000) -> None:
    """Un son d'essai : une note tenue sous chaque ligne chantée, du silence
    entre (les passages que voit silencedetect, comme une voix seule)."""
    import math
    import wave
    from array import array
    pcm = array("h", bytes(2 * int(sr * duree)))
    for k, (t, x) in enumerate(rows):
        nxt = rows[k + 1][0] if k + 1 < len(rows) else duree
        a, b = int(t * sr), int(min(t + 2.4, nxt - 0.6) * sr)
        f = 220 + 40 * (k % 6)
        for i in range(a, min(b, len(pcm))):
            pcm[i] = int(9000 * math.sin(2 * math.pi * f * i / sr))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def selftest(call, ok) -> None:
    import shutil
    import tempfile

    # 1. la normalisation
    ok(jetons("L’été 85, c'est déjà là !", "fr") == ["l", "ete", "quatre", "vingt", "cinq", "c", "est", "deja", "la"],
       f"paroles : élisions, accents, nombres ({jetons('L’été 85, c est déjà là !', 'fr')})")
    ok(jetons("Twenty-three o'clock", "en") == jetons("23 o’clock", "en") == ["twenty", "three", "o", "clock"],
       "paroles : un nombre en chiffres ou en lettres, les deux apostrophes")
    ok(jetons("Qu'est-ce", "fr") == jetons("qu 'est -ce", "fr") == ["qu", "est", "ce"], "paroles : « qu'est-ce » découpé comme Whisper")
    ok([nombre(n, "fr") for n in (21, 71, 80, 91, 200, 1999)] ==
       ["vingt et un", "soixante et onze", "quatre vingts", "quatre vingt onze", "deux cents", "mille neuf cent quatre vingt dix neuf"]
       and nombre(1023, "en") == "one thousand twenty three", "paroles : les nombres en lettres (fr, en)")
    ok(lignes_de("[verse]\nPremière ligne\n\n(Refrain)\n[00:12.00]Deuxième ligne\n[ti:titre]\n...") == ["Première ligne", "Deuxième ligne"],
       "paroles : les lignes chantées, sans étiquettes de section ni temps")

    # 2. le format LRC
    d = lire_lrc("﻿[ti:Essai]\n[offset:+500]\n[00:10.50][01:00.00]Refrain\n[00:05.25]Début\nsans temps\n")
    ok(d["tags"] == {"ti": "Essai"} and sorted(d["lignes"]) == [[4.75, "Début"], [10.0, "Refrain"], [59.5, "Refrain"]],
       f"paroles : un LRC relu (deux temps sur une ligne, le décalage appliqué) ({d})")
    out = normaliser_lrc("[01:00.00]b\n[00:02.5]a\n", 70)
    ok(out == "[00:02.50]a\n[01:00.00]b\n" and normaliser_lrc(out) == out, f"paroles : remis au format, trié, stable ({out!r})")
    for bad, why in (("[00:01.00]" + "x" * 400, "une ligne trop longue"), ("bonjour", "aucune ligne datée"),
                     ("[09:00.00]trop tard", "après la fin du son"), (42, "pas un texte")):
        try:
            normaliser_lrc(bad, 60)
            ok(False, f"paroles : LRC refusé : {why}")
        except ValueError:
            ok(True, f"paroles : LRC refusé : {why}")

    # 3. l'alignement, sur la chanson d'essai : les seuils (s), mesurés sur les LRC d'AGOSTA et ici
    rows, duree = chanson_essai()
    lignes = [x for _, x in rows]
    exact = []   # chaque mot à 0,28 s par syllabe, du début de sa ligne
    for t, x in rows:
        for w in x.split():
            d = 0.28 * sum(syllabes(j) for j in jetons(w, "fr"))
            exact.append((w, t, t + d))
            t += d
    e = ecarts(caler(lignes, exact, "fr", duree), rows)
    ok(max(e) < 0.02, f"paroles : des mots entendus exacts calent chaque ligne à son début (pire {max(e):.3f} s)")
    SEUILS = {"propre": (0.12, 0.30), "moyen": (0.20, 0.50), "fort": (0.30, 0.85)}
    blocs_p90 = None
    for niv, (med, p90) in SEUILS.items():
        es, eb = [], []
        for g in range(4):
            mots = entendre(rows, duree, niv, graine=g, langue="fr")
            v = voix_simulee(rows, duree, graine=g, langue="fr")
            es += ecarts(caler(lignes, mots, "fr", duree, v), rows)
            if niv == "moyen":
                eb += ecarts(caler(lignes, mots, "fr", duree, v, appariement=apparier_blocs), rows)
        r = resume_ecarts(es)
        ok(r["mediane"] <= med and r["p90"] <= p90,
           f"paroles : bruit {niv} — médiane {r['mediane']} s (≤ {med}), p90 {r['p90']} s (≤ {p90}), pire {r['pire']} s")
        if eb:
            blocs_p90 = resume_ecarts(eb)["p90"]
            ok(blocs_p90 > 2 * r["p90"], f"paroles : le SequenceMatcher seul fait pire sur les refrains (p90 {blocs_p90} s contre {r['p90']} s)")
    # une ligne dont aucun mot n'est entendu : entre ses voisines, « estimée »
    k = 9
    trou = [m for m in exact if not (rows[k][0] - 0.01 <= m[1] < rows[k + 1][0] - 0.01)]
    cal = caler(lignes, trou, "fr", duree)
    ok(cal[k]["comment"] == "estimee" and cal[k - 1]["t"] < cal[k]["t"] < cal[k + 1]["t"] and abs(cal[k]["t"] - rows[k][0]) < 1.5,
       f"paroles : une ligne sans mot entendu, interpolée entre ses voisines ({cal[k]['t']} pour {rows[k][0]})")
    # sans paroles : la transcription devient les lignes
    segs = [{"a": 1.0, "b": 9.0, "text": "un deux trois. quatre cinq six sept huit neuf",
             "words": [["un", 1.0, 1.3], ["deux", 1.3, 1.6], ["trois.", 1.6, 2.0], ["quatre", 2.1, 2.4], ["cinq", 2.4, 2.7],
                       ["six", 3.8, 4.0], ["sept", 4.0, 4.3], ["huit", 4.3, 4.6], ["neuf", 4.6, 5.0]]}]
    ok([(c["t"], c["texte"]) for c in depuis_transcription(segs)] == [(1.0, "un deux trois. quatre cinq"), (3.8, "six sept huit neuf")],
       f"paroles : sans paroles connues, une ligne par pause ({depuis_transcription(segs)})")

    # 4. le champ `lrc` d'un son (core/library.py) et les routes
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        ok(True, "paroles : ffmpeg absent, la chaîne n'est pas essayée")
        return
    tmp = Path(tempfile.mkdtemp(prefix="sr_paroles_"))
    _wav_essai(tmp / "chanson.wav", rows, duree)
    st, song = call("PUT", "/api/library/upload?name=chanson.wav&title=Chanson%20d%27essai", raw=(tmp / "chanson.wav").read_bytes())
    sid = song.get("id", "") if isinstance(song, dict) else ""
    ok(st == 200 and song.get("kind") == "audio", f"paroles : un son d'essai ({st})")
    st, img = call("PUT", "/api/library/upload?name=p.png&title=Image", raw=__import__("base64").b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="))
    iid = img.get("id", "") if isinstance(img, dict) else ""
    st, r = call("POST", f"/api/library/{sid}", {"lrc": 12})
    ok(st == 400, f"paroles : lrc n'est qu'un texte ({st})")
    st, r = call("POST", f"/api/library/{iid}", {"lrc": "[00:01.00]a\n", "title": "Changée ?"})
    st2, back = call("GET", f"/api/library/{iid}")
    ok(st == 400 and back.get("title") == "Image" and "lrc" not in back, f"paroles : pas de lrc sur une image, rien n'a changé ({st})")
    st, r = call("POST", f"/api/library/{sid}", {"lrc": "[00:01.00]a\n"})
    ok(st == 200 and r.get("lrc") == "[00:01.00]a\n", f"paroles : le champ lrc d'un son ({st})")
    st, r = call("POST", f"/api/library/{sid}", {"lrc": ""})
    ok(st == 200 and "lrc" not in r, "paroles : un lrc vide retire le champ")
    st, _ = call("GET", "/api/paroles/aud-00000000-000000-0000")
    st2, _ = call("GET", f"/api/paroles/{iid}")
    ok(st == 404 and st2 == 400, f"paroles : un son absent (404), une image (400) ({st} {st2})")
    st, g = call("GET", f"/api/paroles/{sid}")
    ok(st == 200 and g.get("lrc") == "" and g.get("calage") is None and g["peut"]["ecrire"] and g["peut"]["caler"],
       f"paroles : l'état d'un son sans paroles ({st} {g.get('peut') if isinstance(g, dict) else g})")
    st, g = call("POST", f"/api/paroles/{sid}", {"lrc": "[00:20.0]deux\n[00:10]un\n"})
    ok(st == 200 and g.get("lrc") == "[00:10.00]un\n[00:20.00]deux\n" and g.get("lignes") == [[10.0, "un"], [20.0, "deux"]],
       f"paroles : écrire le LRC à la main (trié, remis au format) ({st} {g.get('lrc') if isinstance(g, dict) else g})")
    st, g = call("POST", f"/api/paroles/{sid}", {"lrc": f"[{temps_lrc(duree + 30)}]trop tard"})
    ok(st == 400 and "après la fin" in g.get("error", ""), f"paroles : un temps après la fin du son est refusé ({st})")
    for bad in ({"paroles": 5}, {"langue": "français"}, {"voix": "stem"}, {"paroles": "[verse]\n\n"}):
        st, g = call("POST", f"/api/paroles/{sid}/caler", bad)
        ok(st == 400, f"paroles : demande refusée : {bad} ({st})")

    def attendre(fin=("fini", "echec", "arrete"), n=400):
        g = {}
        for _ in range(n):
            st, g = call("GET", f"/api/paroles/{sid}")
            if (g.get("calage") or {}).get("state") in fin:
                return g
            time.sleep(0.15)
        return g

    # 5. la chaîne entière, moteurs factices : la voix seule, les mots (Transcrire), le calage — sans paroles
    st, g = call("POST", f"/api/paroles/{sid}/caler", {})
    ok(st == 200 and (g.get("calage") or {}).get("state") == "voix" and not g["peut"]["caler"],
       f"paroles : la chaîne part par la voix seule ({st} {(g.get('calage') or {}) if isinstance(g, dict) else g})")
    st, again = call("POST", f"/api/paroles/{sid}/caler", {})
    ok(st == 409, f"paroles : un seul calage à la fois ({st})")
    g = attendre()
    ch = g.get("calage") or {}
    ok(ch.get("state") == "fini" and set(ch.get("jobs", {})) == {"voix", "mots", "calage"} and ch.get("stem") and ch.get("trn"),
       f"paroles : voix seule → mots → calage, trois travaux ({ch.get('state')} {ch.get('message')} {ch.get('jobs')})")
    st, stem = call("GET", f"/api/library/{ch.get('stem')}")
    ok(st == 200 and (stem.get("params") or {}).get("stem") == "vocals" and stem.get("parents") == [sid]
       and stem.get("origin", {}).get("tool") == TOOL, f"paroles : la voix seule, fille du son ({st})")
    from tools import transcrire as T
    doc = T._load(ch.get("trn") or "") or {}
    ok(doc.get("item") == ch.get("stem") and doc.get("mode") == "complet" and not doc.get("speakers_on")
       and any(s.get("words") for s in doc.get("segments") or []), "paroles : les mots de la voix seule, par Transcrire (complet, sans voix séparées)")
    attendu = [[c["t"], c["texte"]] for c in depuis_transcription(doc.get("segments") or [])]
    diff = [(a, b) for a, b in zip(g.get("lignes") or [], attendu) if abs(a[0] - b[0]) > 0.011 or a[1] != b[1]]
    ok(len(g.get("lignes") or []) == len(attendu) and attendu and not diff and g.get("source") == "",
       f"paroles : sans paroles connues, le LRC est la transcription ({len(g.get('lignes') or [])} lignes, {diff[:2]}, {g.get('source')!r})")
    # puis les paroles données : la voix et les mots sont déjà là, le calage part seul
    texte = "\n".join(plat(s["text"]).upper().replace(".", " !") for s in doc.get("segments") or [])
    st, g = call("POST", f"/api/paroles/{sid}/caler", {"paroles": "[verse]\n" + texte, "langue": "fr"})
    ok(st == 200 and (g.get("calage") or {}).get("state") == "calage", f"paroles : déjà la voix et les mots : le calage seul ({st})")
    g = attendre()
    segs = [s for s in doc.get("segments") or [] if s.get("words")]
    e = [abs(a - float(s["words"][0][1])) for (a, _), s in zip(g.get("lignes") or [], segs)]
    ok((g.get("calage") or {}).get("state") == "fini" and len(e) == len(segs) and e and max(e) < 0.3 and not g.get("estimees")
       and g.get("source") == "texte", f"paroles : les paroles données calées sur les mots entendus (pire {max(e or [9]):.2f} s)")
    # retiré de la file avant de partir : la chaîne le lit dans la file ; écrire à la main attend
    jobs.set_mode(None, "paused")
    try:
        st, g = call("POST", f"/api/paroles/{sid}/caler", {"paroles": texte})
        jid = (g.get("calage") or {}).get("job")
        st2, r = call("POST", f"/api/paroles/{sid}", {"lrc": "[00:01.00]x"})
        ok(st == 200 and st2 == 409, f"paroles : écrire à la main pendant un calage : 409 ({st} {st2})")
        jobs.cancel(jid)
        st, g = call("GET", f"/api/paroles/{sid}")
        ok((g.get("calage") or {}).get("state") == "arrete" and g["peut"]["caler"],
           f"paroles : un maillon retiré de la file arrête la chaîne ({(g.get('calage') or {}).get('state')})")
    finally:
        jobs.set_mode(None, "active")
    # le mélange, à la demande : une autre transcription, sans voix seule
    st, g = call("POST", f"/api/paroles/{sid}/caler", {"voix": "melange", "paroles": "\n".join(lignes)})
    ok(st == 200 and (g.get("calage") or {}).get("state") == "mots" and "mélange" in (g.get("calage") or {}).get("note", ""),
       f"paroles : le mélange transcrit à la demande ({st} {(g.get('calage') or {}) if isinstance(g, dict) else g})")
    g = attendre()
    ok((g.get("calage") or {}).get("state") == "fini" and len(g.get("lignes") or []) == len(lignes),
       f"paroles : le mélange calé, une ligne par ligne des paroles ({(g.get('calage') or {}).get('message')})")
    ok(_suite in jobs.AFTER and jobs.cost_declared(KIND) and jobs.HANDLERS[KIND][1] == "cpu",
       "paroles : l'accroche de la chaîne est posée ; le calage déclare son coût, sur la voie cpu")
    shutil.rmtree(tmp, ignore_errors=True)
