# Transcrire — transcription et traduction ultra rapides (étude du 29/09/2026)

La demande de Cal (29/09, 18 h 20) : « il faut rajouter une app qui fait de la
traduction et du transcript ultra rapide. »

**Statut** : l'app est écrite et marche de bout en bout sur un **moteur
factice** (texte plausible, horodaté, sans GPU). Le câblage réel est écrit
derrière l'interrupteur `transcrire_moteur` (Admin → Câblage), **jamais
lancé** : aucun modèle chargé, aucun téléchargement. Relevés sur les DGX le
29/09 en lecture seule (`pip list`, caches Hugging Face et Whisper,
`ollama list`, `nvidia-smi`, `/etat` du service de diarisation) ; tailles des
fichiers lues par l'API de métadonnées de Hugging Face (rien téléchargé) ;
documentation lue le 29/09/2026. « Non documenté » quand une source manque.

Nom : **Transcrire** — dossier `transcrire/`, module `server/tools/transcrire.py`,
routes `/api/transcrire/…`. Vérifié contre EasyPrivacy et EasyList
(`/tmp/easy*.txt` sur DGX2) : aucune règle ne contient `transcri`.

## La recommandation, en six lignes

1. **Aujourd'hui, sans rien télécharger**, l'interrupteur allumé donne déjà une
   app réelle : **Whisper large-v3-turbo** (poids présents sur DGX2) pour le
   texte horodaté mot à mot, la **diarisation Nemotron** (le service de DGX1
   que Movie Analysis emploie) pour « qui parle », un **LLM d'Ollama déjà
   présent** pour traduire.
2. **Couple « ultra rapide »** (cible) : **Parakeet TDT 0.6B v3** (RTFx 3 333,
   français et 24 autres langues européennes, mots horodatés, CC-BY-4.0) +
   **Qwen3-30B-A3B** par Ollama (présent sur les deux DGX, 3,3 G paramètres
   actifs). À approuver : 2,51 Go et un venv NeMo sur DGX2.
3. **Couple « le plus juste »** (cible) : **Whisper large-v3-turbo** en
   recherche en faisceau (99 langues, présent) + **Nemotron-3-Diarization**
   (présent, DGX1) + **Mistral Small 3.2 24B** par Ollama (présent) qui
   traduit avec le contexte des répliques voisines. Aucun téléchargement.
4. **Pas de traduction « parole → parole » par Whisper** : turbo « is not
   trained for translation tasks » ; Canary-1B-v2 traduit la parole
   (anglais ↔ 24 langues) mais n'est pas installé (6,36 Go) — candidat
   d'un essai, pas du défaut.
5. **Pas de NLLB** : licence CC-BY-NC, « not released for production
   deployment ». MADLAD-400 (Apache-2.0) est possible mais 11,8 Go pour une
   langue par phrase, sans contexte : le LLM déjà présent fait mieux l'affaire
   (à mesurer).
6. **Où** : sur **DGX2**, voie `audio` (le ComfyUI :8188 de DGX2 sert de
   jeton GPU) : les poids Whisper y sont, le portail y est ; DGX1 porte déjà
   le studio de Character Factory, marlin, un Ollama à 30 Go et la
   diarisation. La diarisation reste sur DGX1, appelée par HTTP.

## Ce que Cal doit approuver pour passer au réel

| # | geste | taille | où | pourquoi |
|---|---|---|---|---|
| 1 | Allumer `transcrire_moteur` = `local` (Admin → Câblage), redémarrer le portail | — | DGX2 | Whisper turbo (présent), diarisation (présente), traduction Ollama (présente) : **zéro téléchargement** |
| 2 | Un essai de vitesse et de justesse sur nos deux films (ci-dessous, § 6) | — | DGX2 (+ DGX1 pour la diarisation) | aucun chiffre de vitesse n'est publié pour le GB10 ; nos films ont des répliques corrigées à la main, qui font une référence |
| 3 | Parakeet TDT 0.6B v3 : `parakeet-tdt-0.6b-v3.nemo` | **2,51 Go** | DGX2, `~/models/transcrire/` | le mode « Rapide » cible |
| 4 | un venv `~/transcrire-env` sur DGX2 avec `nemo_toolkit[asr]` (NeMo 3.1 tourne déjà sur GB10 : le service de diarisation de DGX1) | ~2 Go de paquets (non mesuré ici) | DGX2 | Parakeet est un modèle NeMo ; DGX2 n'a pas NeMo |
| 5 | (option) Canary-1B-v2 `.nemo` | **6,36 Go** | DGX2 | traduction directe de la parole, à comparer au LLM |
| 6 | Le socle : une sorte `subtitle` dans `server/core/library.py` (§ 5.3) | quelques lignes | dépôt | « ranger les sous-titres dans Asset » ; hors de ce chantier |

## 1. Ce qui est déjà là (relevé du 29/09, lecture seule)

| | DGX2 | DGX1 |
|---|---|---|
| Whisper (openai-whisper 20250625) | `~/comfyui-env` ; poids **`large-v3-turbo.pt` (1,62 Go)** et `medium.pt` dans `~/.cache/whisper` | `~/reelbench/nemo-env` ; poids **`small.pt` seulement** |
| Whisper large-v3-turbo (Transformers) | `models--openai--whisper-large-v3-turbo` | — |
| faster-whisper / CTranslate2 | — | `~/Maestro/venv` : ctranslate2 4.8.1, faster-whisper 1.2.1 ; **`get_cuda_device_count()` = 0** (la roue aarch64 de PyPI est sans CUDA : mesuré) ; `Systran/faster-whisper-large-v3` (2,9 Go) en cache |
| NeMo | — | `~/reelbench/nemo-env` : **NeMo 3.1.0**, torch 2.11 cu130, sur GB10 (service de diarisation) |
| Diarisation | pyannote 4.0.4 et `speaker-diarization-3.1` / `community-1` (jeton HF requis) | **service Nemotron-3-Diarization** :8448, publié au tailnet `https://dgx1.tail6c4306.ts.net:10002/diarisation` ; `/etat` : « prêt », 8 voix, 99,2 M paramètres, jusqu'à 240 min et 2 Go |
| Kyutai STT 1B en/fr | `stt-1b-en_fr` + `-candle` en cache | `-candle` en cache |
| Voxtral Mini 3B | — | `consolidated.safetensors` seulement (format Mistral, pour vLLM ; vLLM absent) |
| Ollama | qwen3:30b-a3b (18 Go), qwen3:8b, qwen3:4b, mistral-small3.2:24b (15 Go), qwen2.5 7/14/32b, hermes-3-70b… | qwen3:30b-a3b, qwen3:8b, mistral-small3.2:24b, gpt-oss:120b, qwen2.5:72b, mistral-nemo… |
| GPU au relevé (`nvidia-smi`) | ComfyUI 52,4 Go | ComfyUI 52,3 Go, marlin 7,4 Go, NeMo 1,1 Go |

**Movie Analysis** emploie Whisper **large-v3-turbo** (`analyse/chaine/whisper-run.py` :
langue détectée, `word_timestamps=True`, fp16, un filtre des hallucinations —
mentions de sous-titrage, remerciements, « … ») et la diarisation Nemotron de
DGX1 (`analyse/chaine/diarisation-serveur.py`). Transcrire reprend le même
modèle et le **même filtre** (recopié dans `transcrire.py`, source citée) :
une seule façon de juger une hallucination dans le portail.

**Piège relevé** : le service de DGX1 annonce « transcription possible,
large-v3-turbo », mais ce fichier n'est pas sur DGX1 : `?transcrire=1`
ferait télécharger 1,62 Go par openai-whisper au premier appel. Le câblage de
Transcrire **n'envoie jamais `transcrire=1`** : il ne demande que la
diarisation, et transcrit sur DGX2.

## 2. La transcription : les candidats

| modèle | langues | vitesse documentée | mots horodatés | mémoire | licence | GB10 / aarch64 | chez nous |
|---|---|---|---|---|---|---|---|
| **Parakeet TDT 0.6B v3** [P] | 25 européennes, dont fr, en ; langue détectée seule | **RTFx 3 332,74** (carte) ; sur un Spark, un tiers : 19,7 s en 0,2 s [PS] | oui, mots et segments ; ponctuation et majuscules | « at least 2GB RAM » ; 24 min en attention pleine (A100 80 Go), 3 h en attention locale | CC-BY-4.0 | Blackwell cité ; Spark : paquet Docker d'un tiers [PS] ; non dans la matrice NIM [N] | **absent** (2,51 Go) |
| Canary-1B-v2 [C] | 25 européennes ; **traduit** anglais → 24 et 24 → anglais | RTFx 749 | oui en transcription ; segments seulement en traduction | « 6GB RAM » | CC-BY-4.0 | Blackwell cité | absent (6,36 Go) |
| **Whisper large-v3-turbo** [W][WR] | 99 ; langue détectée | « ~8x » large ; RTFx non publié sur la carte | oui (`word_timestamps`) | « ~6 GB » VRAM | MIT | tourne sur nos GB10 (Movie Analysis) | **présent DGX2** |
| Whisper large-v3 [WR] | 99 ; traduit → anglais | « 1x » | oui | « ~10 GB » | MIT | idem | absent |
| faster-whisper (CTranslate2) [FW] | celles de Whisper | large-v2, 13 min : 63 s fp16, 16 s en lots de 8 (GPU de la page) | oui | 2,9–4,5 Go | MIT | **pas de roue CUDA aarch64** : ctranslate2 voit 0 GPU sur DGX1 (mesuré) ; à compiler [CT] | CPU seulement |
| whisper.cpp | celles de Whisper | non documenté pour GB10 | oui | — | MIT | CUDA à compiler, non essayé | absent |
| Kyutai STT 1B en_fr [K] | **fr, en** seulement | délai 0,5 s (flux) ; débit non publié | oui (décalage du flux) | non documenté | CC-BY-4.0 | runtime `moshi` ou Transformers ≥ 4.53 ; non essayé | en cache (DGX2) |
| Voxtral Mini 3B [V] | 8 dont fr ; transcription, questions | RTFx 109,86 | **non documentés** | ~9,5 Go | Apache-2.0 | vLLM ≥ 0.10 (absent) | poids format Mistral (DGX1) |

Justesse en français, **par la seule source qui la donne** : Parakeet v3,
WER 5,15 % (FLEURS), 4,97 % (MLS), 6,05 % (CoVoST) ; anglais 4,85 % et 6,80 %
[P]. Canary-1B-v2 ne publie que des moyennes (8,40 % sur FLEURS, 25 langues)
[C]. Aucune carte ne se compare à une autre ; Whisper ne publie pas de chiffre
par langue sur sa carte. **Lequel est le plus juste sur nos films : non
documenté** — c'est l'essai du § 6.

## 3. La traduction : les candidats

| voie | directions | contexte | licence | chez nous |
|---|---|---|---|---|
| **LLM local par Ollama** (`/api/chat`, `format` = un schéma JSON, `think`, `keep_alive: 0` pour décharger [O]) | toutes celles du modèle : Qwen3 « 100+ languages » [Q] ; Mistral Small 3.2, 24 langues dont le français [MS] | **oui** : un lot de répliques et leurs voisines, les noms gardés | Apache-2.0 (les deux) | **présents** (deux DGX) |
| Canary-1B-v2 (parole → texte) [C] | anglais ↔ 24 européennes ; pas fr → es direct | la réplique seule | CC-BY-4.0 | absent |
| Whisper `translate` [W][WR] | → anglais seulement ; **turbo non entraîné pour traduire** | la fenêtre de 30 s | MIT | présent, inutilisable ainsi |
| MADLAD-400 3B [MD] | 419 langues, `<2xx>` en tête de phrase | la phrase | Apache-2.0 | absent (11,76 Go) |
| NLLB-200 [NL] | 196 langues ; entrées ≤ 512 jetons | la phrase ; « not intended to be used for document translation » | **CC-BY-NC**, « research model » | absent — **écarté** |

Choix : le LLM déjà présent. Les deux modèles, pourquoi :

- **Rapide : `qwen3:30b-a3b`** — mélange d'experts, 30,5 G paramètres dont
  **3,3 G actifs** [Q] ; la pensée coupée (`think: false`, [O][Q]). Plus
  rapide qu'un modèle dense de même taille : c'est le principe des 3,3 G
  actifs ; **le temps réel sur GB10 : non mesuré**.
- **Précis : `mistral-small3.2:24b`** — dense, 24 langues dont le français
  [MS] ; il reçoit les répliques voisines. Meilleur que Qwen3 en français :
  **non documenté**, à mesurer (§ 6).

Garde-fous du câblage (juste par construction, pas un filtre qui relance) :
chaque lot part avec un **schéma JSON** (`{"t": [{"i": n, "text": "…"}]}`) ;
la réponse doit porter **exactement** les numéros envoyés — sinon le lot
échoue en le disant, rien n'est rangé à moitié. Une réplique retouchée pendant
une traduction n'en reçoit pas la traduction (le texte a changé depuis
l'envoi) : elle reste « à retraduire ».

## 4. Où, et combien de mémoire

- **DGX2, voie `audio`** (l'instance ComfyUI :8188 de DGX2) : un seul travail
  GPU du portail par machine (`core/jobs.py`) ; famille `whisper` (ou
  `parakeet`, `ollama-mt`), mémoire déclarée **6 Go** pour Whisper turbo
  (« ~6 GB » [WR]), **3 Go** pour Parakeet (« at least 2GB » [P], arrondi
  au-dessus) et **20 Go** pour la traduction (le fichier de `qwen3:30b-a3b`
  fait 18 Go, `ollama list`) : le préflight vide ComfyUI s'il faut, attend
  sinon, et le dit.
- Le calcul lui-même : un sous-processus (`server/tools/transcrire_moteur.py`)
  dans l'environnement `transcrire_python` (par défaut
  `~/comfyui-env/bin/python`, qui a openai-whisper) ; il **refuse de
  charger** un modèle dont le fichier n'est pas sur le disque (openai-whisper
  télécharge seul sinon ; NeMo `from_pretrained` aussi) : `load_model(chemin)`,
  `restore_from(chemin)`, jamais un nom.
- La diarisation : `POST /analyse` du service de DGX1 (sans `transcrire=1`),
  puis `GET /travail/<id>` ; les segments `[début, fin, voix]` de NeMo aux
  réglages par défaut. Chaque segment de texte prend la voix qui recouvre le
  plus son intervalle.
- La traduction : `/api/chat` de l'Ollama de `transcrire_ollama` (par défaut
  `llm_url`, DGX2), `keep_alive: 0` au dernier lot (la règle du § 3.3 de
  l'étude d'orchestration : ne pas garder 18 Go chargés pour rien).
- Le factice : voie `cpu`, aucun GPU.

## 5. L'app

### 5.1 Le parcours

Déposer un son ou une vidéo (du disque : il entre dans la bibliothèque, Upload,
`via: transcrire` ; ou une vignette glissée ; ou « Bibliothèque ») → **Langue
parlée** (Détecter), **Traduire en** (Anglais par défaut, ou rien),
**Rapide / Précis** → *Transcrire* (le seul bouton orange). La lecture se fait
à côté, les répliques défilent avec elle ; un clic sur une réplique y saute ;
double-clic (ou Entrée) pour corriger le texte ou la traduction, Ctrl+Z pour
défaire. **Exporter** : SRT, VTT, TXT, de l'original ou de la traduction ;
**Copier le texte**. Changer « Traduire en » sur une transcription finie
propose *Traduire en …* sans retranscrire.

Paramètres avancés (repliés) : séparer les voix (défaut : oui en Précis, non en
Rapide), caractères par ligne de sous-titre (42, la valeur courante des
chartes de sous-titrage ; 37 ; 32), durée maximale d'un sous-titre (7 s),
horodatage dans le TXT ; et ce qui tourne derrière chaque mode (les noms des
modèles, seulement là).

### 5.2 Les données

Une transcription est un **document de l'outil** (comme un projet ODIO) :
`<data_dir>/transcrire/trn-….json` — le média source (son id dans la
bibliothèque), la langue demandée et détectée, le mode, les voix (renommables),
les répliques `{id, a, b, text, spk, words, tr: {langue: texte}}`, `rev`
(409 si le document a changé ailleurs), `owner` (seul le propriétaire, ou Cal,
écrit : `library.check_write`, la règle des objets). Les sous-titres se
**calculent** du document à l'export : une seule vérité, rien à resynchroniser.

Les sous-titres, par construction :

- une réplique se découpe en cartons d'au plus *n* caractères par ligne,
  2 lignes, *d* secondes, **aux temps des mots** (Whisper, Parakeet) ; une
  traduction (sans temps de mots) ou un texte corrigé se répartit au prorata
  des caractères sur l'intervalle de la réplique ;
- les cartons sont triés, chaque début ≥ la fin du précédent (rogné sinon),
  un carton de durée nulle tombe : des horodatages **croissants** quel que soit
  ce que rend le modèle ;
- SRT : `HH:MM:SS,mmm --> HH:MM:SS,mmm`, numérotés de 1 ; VTT : en-tête
  `WEBVTT`, `HH:MM:SS.mmm`, la voix en `<v Nom>` ; TXT : une réplique par ligne,
  la voix, l'horodatage en option. Le contrôle (`selftest`) relit chaque
  export par un analyseur indépendant.

### 5.3 Ranger les sous-titres dans Asset : ce qu'il manque au socle

La bibliothèque n'a que six sortes (`library.KINDS`) et `add_file` refuse ce
qui n'est ni image, ni vidéo, ni son, ni MIDI. Le bouton « Ranger dans Asset »
est donc **désactivé et dit pourquoi**, jusqu'à cette accroche du socle (hors
de ce chantier — `server/core/library.py`, à l'agent du socle) :

```python
KINDS = (…, "subtitle")                          # id « sub-… »
EXT_KIND[".srt"] = EXT_KIND[".vtt"] = "subtitle"
# sniff : du texte UTF-8 ; un VTT commence par « WEBVTT », un SRT par un chiffre
# add_file : kind in ("image", "video", "audio", "midi", "subtitle") ; pas de vignette
```

Transcrire le détecte (`"subtitle" in library.KINDS`) et range alors l'export
choisi avec sa lignée (`parents` = le média), sans autre changement ; Asset aura
à montrer un sous-titre (le texte, la lecture sous le média parent).

### 5.4 Les routes

| route | |
|---|---|
| `GET /api/transcrire/options` | moteur, modes (libellés simples, ce qui tourne derrière, ce qui manque), langues, réglages des sous-titres |
| `GET /api/transcrire/docs` · `GET …/docs/<id>` | mes transcriptions ; une transcription |
| `POST /api/transcrire/run {item, lang, to, mode, speakers, cpl, max_s}` | crée le document et lance `transcrire.transcribe` (+ la traduction à la suite) |
| `POST …/docs/<id>/translate {to, all}` | `transcrire.translate` : les répliques sans traduction ou retouchées depuis |
| `POST …/docs/<id> {rev, segments: [{id, text?, tr?}], speakers?, title?}` | corriger (409 si `rev` a changé) |
| `GET …/docs/<id>/export?format=srt\|vtt\|txt&which=src\|<langue>&stamps=1` | le fichier, en téléchargement |
| `POST …/docs/<id>/asset {format, which}` | ranger dans Asset (409 tant que le socle n'a pas `subtitle`) |
| `POST …/docs/<id>/delete` | à la corbeille de l'outil (`transcrire/corbeille/`) |

La diarisation, une réserve : la carte de Nemotron-3-Diarization cite
l'anglais, le mandarin, des langues indiennes et « multilingual sources »,
**pas le français nommément** [D] ; Movie Analysis l'emploie sur Getaround
(français). Sa justesse sur nos films : non mesurée ici.

## 5.5 Vérifié (29/09, copie `/tmp/sr_transcrire` sur DGX2, portail d'essai :8857, moteur factice)

- `python3 tools/check.py` : 1 281 passés, 0 en échec. Le `selftest` de
  `transcrire.py` : les formats (SRT, VTT, TXT relus par un analyseur à part :
  numéros, horodatages, **croissants**, 2 lignes de 42 caractères, 7 s, au-delà
  d'une heure, voix échappée en VTT), le découpage aux temps des mots et au
  prorata, les passages parlés du factice calés sur le son (un silence de 2 s
  reste vide), un `.txt` refusé au dépôt (415), une image et une vidéo sans son
  refusées (400), les réglages hors bornes, transcrire → traduire à la suite,
  corriger (409 sur une vieille révision), la traduction d'une réplique
  corrigée qui passe « à retraduire » puis est retraduite seule, l'export,
  Asset qui attend le socle (409 qui le dit), la corbeille, le sous-processus
  réel qui se charge à vide.
- Le câblage réel, **lu sans rien lancer** (`transcrire_moteur` forcé à
  `local` dans un processus d'essai) : Whisper turbo prêt (python et poids
  présents) ; Parakeet « python absent … à approuver » ; diarisation « prêt »
  (DGX1, 8 voix) ; Ollama : `qwen3:30b-a3b` et `mistral-small3.2:24b`
  présents. `transcrire_moteur.py --check` passe dans `~/comfyui-env` ;
  `whisper.load_model` prend bien un chemin de fichier (branche
  `os.path.isfile`, sans `_download`).
- Pilote Playwright (Chromium de DGX2), 29 étapes : déposer un `.txt` (refusé)
  puis une vidéo → précis, détecter → anglais → 8 répliques, 3 voix, la frise →
  clic sur la 3ᵉ réplique (la vidéo va à 6,7 s pour une réplique à 6,5 s),
  surlignée, sous-titre sur l'image → double-clic, corriger, Entrée (200),
  « Retraduire 1 réplique » → Ctrl+Z, Ctrl+Maj+Z → Exporter SRT (8 cartons
  valides, la correction dedans) → Copier le texte → vue Traduction → clair →
  téléphone (390 px, rien ne déborde) → la carte de l'accueil ; aucune erreur
  de console.

## 5.6 Le texte et le carnet sur un seul écran ; la consigne du carnet (05/10)

Trois remarques de Cal, le 05/10 :

- **Le carnet ne se voyait pas** (« les gens ne voient pas le "carnet" ») : les
  onglets Texte / Carnet sont remplacés par un écran en deux colonnes, la
  transcription à gauche, le carnet à droite (résumé, questions, points clés,
  chapitres). Une poignée les sépare (`commun/split.js` : glisser, flèches,
  double-clic pour revenir moitié-moitié ; le partage est gardé dans le
  navigateur, `sr-split-transcrire-texte-carnet`). Sous 720 px de large
  (`@container tr-split`), les deux colonnes s'empilent. Le carnet se montre
  dès qu'une transcription est ouverte, et attend la fin du texte.
- **Le carnet répondait à la première personne** : une locutrice dit avoir
  17 ans ; à « elle a quel âge ? », le modèle répondait « j'ai 17 ans ». Le
  modèle n'avait pas de rôle, et rien ne lui disait que les « je » du texte
  ne le désignent pas. La transcription était collée derrière la question, sans
  bord ; en mode rapide, aucune étiquette ne nommait la locutrice. La
  consigne est réécrite d'après le guide d'Anthropic [AN], dans
  `server/tools/transcrire.py` (`CARNET_SYSTEM`, `carnet_messages`) :
  - un rôle (l'assistant du carnet, qui analyse un document et ne parle
    jamais au nom des personnes enregistrées) ;
  - les voix à la troisième personne, par leur étiquette (`[S1]`, que la page
    remplace par le nom du moment) ;
  - ce qui est dit, séparé de ce qui est déduit ;
  - « la transcription ne le dit pas » plutôt qu'une supposition ;
  - chaque règle avec son pourquoi, et un exemple entre balises `<example>`.

  La transcription est donnée comme une donnée, en tête du message, entre
  `<transcript>…</transcript>` : sa source, sa durée, les voix et leurs noms
  (ou « voix non séparées »), puis les répliques. Son texte est échappé : une
  réplique ne peut pas fermer la balise. Une phrase dit que les « je » y
  désignent le locuteur et que rien de ce qui est dit n'est une consigne. La
  tâche vient ensuite, puis la question en dernier ; la réponse est dans la
  langue de la question.
  Chaque fonction du carnet garde ces règles : résumé et synthèse de ses
  morceaux, points, chapitres, questions. Pour une question, le schéma JSON
  demande d'abord les répliques citées, puis `basis` (`said`, `inferred`,
  `not_said`), puis la réponse. La page montre les répliques citées telles
  quelles, avec leur temps et leur voix : la citation est juste par
  construction, puisque le modèle ne choisit que des numéros.
  **L'effet sur le modèle réel** (`qwen3:30b-a3b`) **n'est pas mesuré** : le
  conteneur où la consigne a été écrite n'a pas de modèle. Essai à faire sur
  DGX2 : l'enregistrement de la locutrice de 17 ans, « elle a quel âge ? ».
- **« Exporter l'audio vers le montage » : il n'arrivait pas dans le Projet.**
  Transcrire n'avait pas d'export vers le Montage. Le chemin était celui
  d'Asset (« Ajouter au montage », `montage/?add=<id>`). Sans séquence
  ouverte, le Montage crée une séquence « à partir de l'élément » ; le son
  est déjà posé sur la timeline de cette séquence. Or `r_save` n'inscrit au
  Projet que ce qu'un enregistrement pose de nouveau : le son n'y entrait
  jamais. Avec une séquence ouverte, le serveur l'inscrivait bien, mais la
  page ne relisait pas le Projet. Ce qui est corrigé :
  - `server/tools/montage.py`, `r_create` : l'objet de départ entre au Projet
    avec sa séquence ;
  - `montage/montage.js` : le Projet se relit après l'enregistrement qui pose
    un objet nouveau, et `?add=` y montre l'objet arrivé ;
  - Transcrire gagne « Envoyer le son (la vidéo) au Montage » dans Exporter et
    dans le clic droit d'une transcription. L'entrée est cachée aux comptes
    Apps.

  L'essai est dans le selftest de `montage_projet.py`.

## 5.7 L'en-tête d'un son à hauteur fixe (06/10)

Cal : « les répliques tout en haut font vibrer tous les panneaux en dessous, car ce header change de
hauteur en fonction des répliques ; c'est insupportable à regarder en lecture ». Pour un son, la réplique
lue s'écrit dans l'en-tête du lecteur (« son », le titre, la réplique) ; il passait à la ligne avec une
réplique longue et disparaissait entre deux : de 44 à 88 px, et tout ce qui est dessous sautait de 42 px.
L'en-tête a maintenant une hauteur fixe de 65 px (`transcrire.css`) : deux lignes pour l'original, une pour
la traduction, trois pour l'un sans l'autre ; plus long, le texte se coupe d'une ellipse
(`-webkit-line-clamp`) — il est en entier dans la liste, éclairé. Pour une vidéo, la réplique est posée sur
l'image : rien n'y bougeait.

Essai (portail d'essai, Chromium sans affichage) : une lecture entière d'un son de 19,5 s dont les
répliques sont courtes, très longues (300 caractères) ou absentes, `getBoundingClientRect` de la barre et de
la frise du lecteur, des répliques, du texte, du carnet, des voix, relevé toutes les 120 ms : avant, 42 px
d'écart ; après, **0 px** sur 170 relevés, en sombre et en clair, dans les trois vues (original,
traduction, les deux), à 1600, 1000 et 760 px de large ; une vidéo : 0 px aussi.

## 6. Les essais à lancer (quand Cal le dit)

1. **Vitesse** : Whisper turbo sur DGX2, sur la piste son de `getaround.mp4`
   et de `wall.mp4` (`~/reelbench/runs/`) — secondes de calcul, pic GPU
   (`nvidia-smi --query-compute-apps`), RTFx mesuré. Le même avec Parakeet v3
   une fois approuvé.
2. **Justesse** : les répliques corrigées de Getaround et Wall
   (`analyse/analyses/<film>/mots.json`, corrections du portail) servent de
   référence ; WER de chaque moteur, en français et en anglais.
3. **Traduction** : 50 répliques de chaque film, `qwen3:30b-a3b` contre
   `mistral-small3.2:24b` (et Canary-1B-v2 s'il est approuvé) : temps par lot,
   et une lecture de Cal (aucune métrique automatique n'est installée ici).
4. **Mémoire** : ce que la traduction laisse chargé après `keep_alive: 0`
   (`/api/ps` vide attendu).

## Sources

- [P] https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 (carte ; tailles : API `?blobs=true`)
- [PS] https://forums.developer.nvidia.com/t/multilingual-speech-to-text-stt-asr-with-nvidia-parakeet-tdt-0-6b-v3-for-the-dgx-spark/365554 (martinB78, 03/04/2026 : « 19.7s audio in 0.2s » ; tiers, pas NVIDIA)
- [N] https://docs.nvidia.com/nim/speech/latest/reference/support-matrix/asr.html (DGX Spark : Parakeet 0.6b/1.1b CTC anglais, 1.1b RNNT multilingue ; ni Canary ni Parakeet TDT v3)
- [C] https://huggingface.co/nvidia/canary-1b-v2
- [W] https://huggingface.co/openai/whisper-large-v3-turbo (809 M, 4 couches de décodeur au lieu de 32, 99 langues, MIT)
- [WR] https://github.com/openai/whisper (tableau des tailles : turbo ~6 GB, ~8x ; « The turbo model is not trained for translation tasks »)
- [FW] https://github.com/SYSTRAN/faster-whisper
- [CT] https://opennmt.net/CTranslate2/installation.html (« The Linux and Windows Python wheels support GPU execution » — rien sur aarch64 ; mesure sur DGX1 : 0 GPU)
- [K] https://huggingface.co/kyutai/stt-1b-en_fr
- [V] https://huggingface.co/mistralai/Voxtral-Mini-3B-2507
- [D] https://huggingface.co/nvidia/Nemotron-3-Diarization (8 voix, OpenMDW-1.1, DER 12,73 % DIHARD III)
- [O] https://docs.ollama.com/api/chat (`think`, `format` : JSON ou schéma, `keep_alive` : « 0 to unload immediately »)
- [Q] https://huggingface.co/Qwen/Qwen3-30B-A3B (Apache-2.0, 30,5 B / 3,3 B actifs, 100+ langues, `enable_thinking=False`)
- [MS] https://huggingface.co/mistralai/Mistral-Small-3.2-24B-Instruct-2506 (Apache-2.0, 24 langues dont le français)
- [MD] https://huggingface.co/google/madlad400-3b-mt (Apache-2.0, 419 langues)
- [NL] https://huggingface.co/facebook/nllb-200-distilled-600M (CC-BY-NC, « research model », 512 jetons)
- [AN] https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices (lu le 05/10/2026 : « Give Claude a role », « Add context to improve performance », « Structure prompts with XML tags », « Long context prompting » — documents en tête, la question à la fin, « Ground responses in quotes »)
- `analyse/chaine/whisper-run.py`, `analyse/chaine/diarisation-serveur.py`, `server/tools/analyse.py` (`diar_url`), `docs/etudes/orchestration.md` § 2.2, § 3.3
