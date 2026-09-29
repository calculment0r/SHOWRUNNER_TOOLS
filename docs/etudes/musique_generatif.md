# Étude — le génératif dans ODIO : pistes génératives, partition, MIDI, stems, LoRA « pronostic » (29/09/2026)

Demande de Cal (29/09, ses mots) : « il faut pouvoir générer des instruments
avec notre modèle de génération donc il faut pouvoir ajouter des pistes
"génératives" dans l'arrangeur ou dans le canva : dans l'arrangeur on dessine
une sélection sur la zone et dans le panel du bas on a les infos pour faire de
la génération avec les options données par notre modèle sélectionné […] "audio
de style, pour variation", pouvoir générer seulement une batterie, ou une
guitare avec une tonalité donnée et qui colle à notre tempo […] le gros
avantage de YuE (ou YuE2) c'est que ça génère d'abord une partition et donc
qu'on peut modifier... avant génération !! et donc on pourrait peut-être
injecter nos pistes MIDI dedans non ? on doit aussi avoir une option en clic
droit sur nos clips audio pour extraire le MIDI […] regarde comment la logique
des deux panels nodal et timeline en dessous est reliée par nos attracteurs et
comment YuE (ou YuE2) va nous servir à calculer des petits LoRA pour faire de
la musique en pronostic car c'est le gros concept d'ODIO-O1. »

Règles tenues : **aucun rendu, aucun téléchargement, rien d'installé** ; tout
ce qui suit vient du code installé sur les DGX (lu, pas lancé), des journaux
existants, des documents des projets et du web. Études voisines :
`docs/etudes/yue.md` (YuE2 et son miroir), `docs/etudes/stems.md` (séparation),
`docs/etudes/musique.md` (ODIO). Le prototype ODIO_01 de Cal est lu sur DGX2
dans `/tmp/odio01` (commit `6d8a7ed`, 02/09/2026).

Convention des sources : `fichier:ligne` ; « DGX2 `~/…` » = lu sur DGX2 (même
fichier sur DGX1 quand le miroir le dit, `yue.md` § 2) ; « ODIO_01 `docs/…` » =
`/tmp/odio01/docs/…` ; URL pour le web ; **« notre idée »** marque ce qui n'est
écrit nulle part ; **« non documenté »** ce qu'aucune source ne dit.

---

## 0. Les réponses courtes

| question | réponse | preuve |
|---|---|---|
| YuE2 génère-t-il d'abord une partition ? | **Oui.** L'étape 1 est un texte **ABC** lisible (deux voix mélodiques `Vocal` et `Ins`, accords entre guillemets, `Q:` tempo, `M:` mesure, `K:` tonalité, sections en commentaires), généré en jetons de texte ordinaires, puis décodé en chaîne | DGX2 `~/ComfyUI/comfy_extras/nodes_yue2.py:30,35-38` (sortie `STRING` « abc », `clip.decode(ids)`) ; `comfy/text_encoders/yue2.py:33-34` (en phase « abc », seuls les jetons de texte `< EOD` sont permis) ; `~/YuE/skills/yue2-music/references/abc-editing.md:7-31` |
| Peut-on la modifier avant la suite ? | **Oui**, c'est l'usage prévu (« white-box ») : l'entrée `abc` du nœud de rendu accepte « an edited score » | `nodes_yue2.py:53` ; `~/YuE/docs/editing.md:3` ; `docs/generation.md:51` |
| Peut-on y injecter nos pistes MIDI ? | **En partie.** Passent : **deux lignes monophoniques** (chant, thème instrumental), **les accords** (15 qualités, basse en barre oblique), le **tempo**, la **mesure**, la **tonalité** (majeur/mineur seulement), les **sections**. Ne passent pas : **batterie, ligne de basse, polyphonie** (nappe, piano), triolets, ornements. La conversion n'est pas fournie pour un MIDI quelconque : il faut l'écrire (§ 1.5) | `~/ComfyUI/comfy/audio_encoders/sheetsage2_abc.py:30-84,427-430,497-502` ; `abc-editing.md:27,80,84-91` ; `models-and-setup.md:282` |
| Une batterie seule, une guitare seule ? | **Pas avec YuE2** (toujours un mélange complet). **Oui avec ACE-Step 1.5 « lego »** (12 pistes nommées, dans le contexte d'un audio, bpm/tonalité/mesure en nombres) — modèle *base* seulement | `~/ACE-Step-1.5/docs/en/INFERENCE.md:526-556` ; `acestep/constants.py:132,150-153` ; `README.md:258-272` |
| Prolonger un morceau ? | YuE2 : **non** (« no … edit interval », pas d'entrée audio). ACE-Step : **oui** par `repaint` en fin de morceau (3 à 90 s par passe) et `complete` | `generation-and-covers.md:17,121` ; `~/ACE-Step-1.5/docs/en/Tutorial.md:787,803` |
| Les 3 modèles à câbler d'abord | **ACE-Step 1.5 base** (piste seule, région repeinte, variation) · **YuE2** + notre pont MIDI → ABC (chanson avec voix, plan éditable) · **SheetSage2** (audio → partition, accords, grille des temps ; déjà sur les deux DGX) | § 2, § 1, § 4 |
| Meilleur split stems libre | **BS-RoFormer SW (6 pistes)** — à télécharger ; en attendant la chaîne **voix BS-RoFormer + htdemucs_ft** (prête sur DGX2) | `docs/etudes/stems.md` § 1, § 4 |
| Audio → MIDI retenu | **basic-pitch** sur un stem (Apache 2.0, 230 ko, déjà installé) pour les notes ; **SheetSage2** pour la « partition » (mélodie + accords + tempo) ; batterie : ADTOF (via drum2midi, à télécharger) | § 4 |
| LoRA « pronostic » | Documenté : LoRA **de timbre** YuE2 (étage NAR, le Trainer installé) et LoRA/LoKr **officiel** d'ACE-Step. Notre idée : un LoRA **texte** sur l'étage « partition » de YuE2, nourri des partitions de Cal, + la continuation de partition → le futur du banc écrit d'abord en notes | § 5 |

---

## 1. YuE2 : ce qu'il prend vraiment, ses étapes, sa partition

### 1.1 Les entrées réelles

| entrée | ce que c'est | source |
|---|---|---|
| `style` (alias `tags`) | texte libre : langue, genre, voix, instruments, tempo, caractère | `nodes_yue2.py:19,51` ; `generation-and-covers.md:17` |
| `lyrics` | paroles par sections `[Verse]`, `[Chorus]`… ; vide = instrumental | `docs/generation.md:7` ; infobulle Olm (`yue.md` § 4) |
| `mode` (`cot`) | `full` (mélodie + accords), `melody` (mélodie seule), `off` (pas de plan) | `nodes_yue2.py:22` ; `yue2.py:22-26` (trois instructions) |
| `abc` | une partition fournie à la place du plan ; vide → `off` d'office | `nodes_yue2.py:53,68-69` |
| `seed`, `max_duration` (0,04–900 s, **un maximum**) | la musique peut finir avant ; réduite si le prompt est long | `nodes_yue2.py:54,56` ; `yue2.py:253-258` |
| échantillonnage (ABC : T 0,7, top-p 0,9, top-k 30, pénalité 1,005 / 100 ; musique : T 1,0, top-p 0,95, top-k 100, pénalité 1,2, `cfg_scale` 1,0 ou 1,01 en `off`) | réglages « advanced » | `nodes_yue2.py:23-28,57-61` |
| **pas** d'audio de référence, **pas** de `bpm`, **pas** de prompt négatif, **pas** d'intervalle d'édition, **pas** de chanteur de référence | « There is no request field for `reference_audio`, `phonemes`, `bpm`, `negative_prompt`, an edit interval or a reference singer. Put tempo and meter in the ABC and describe them consistently in the style. » | `~/YuE/skills/yue2-music/references/generation-and-covers.md:17` |
| audio → partition (reprise) | seulement par SheetSage2, qui transcrit ; « YuE2 has no direct audio-upload argument » | `generation-and-covers.md:121` ; `nodes_audio_encoder.py:53-71` |

La tonalité et le tempo n'ont donc **pas d'entrée numérique** : ils vivent dans
la partition (`K:`, `Q:`) et se redisent dans le style (§ 1.6).

### 1.2 Les étapes (ce que fait le code)

1. **Plan ABC** — le modèle autorégressif (AR) reçoit
   `[instruction du mode] [Tags] style [Lyrics] paroles` puis `ABC_START`, et
   écrit **du texte** jusqu'à `ABC_END` (`yue2.py:79-81`, phase « abc » : jetons
   `< EOD` seulement, `yue2.py:33-34`). Le nœud rend la chaîne décodée
   (`nodes_yue2.py:38`). Mesuré sur DGX1 : 12,7 s à 42 jetons/s pour 60 s de
   chanson (`yue.md` § 1).
2. **Jetons sémantiques** — le même AR reçoit le prompt + **les identifiants
   de la partition** + `ABC_END MUSIC_START` et écrit des codes musicaux (livre
   de 32 768, **25 par seconde**) (`yue2.py:17-21,250,259-265`).
3. **Rendu acoustique** — la branche NAR (flow matching, `KSampler` 32 pas)
   remplit un latent de 64 canaux à 25 i/s, conditionné par le cache KV de l'AR
   sur ces codes (`yue2.py:207-231` ; `comfy/ldm/yue2/model.py:62-87` ;
   `nodes_yue2.py:94-97`).
4. **VAE** 48 kHz stéréo (`docs/generation.md:3`).

Le README résume : « predicts the score and semantic tokens autoregressively,
then generates acoustic latents with flow matching » (`~/YuE/README.md`, « How
it works »). L'API Python expose les mêmes étapes séparément :
`plan()` → `generate_semantic()` → `synthesize()` → `decode()`
(`~/YuE/src/yue2/pipeline.py:255-330`).

### 1.3 La partition : ce qu'elle est, ce qu'elle contient

C'est un **texte ABC dans un dialecte natif borné**. En-tête écrit par le
sérialiseur de SheetSage2 porté dans ComfyUI (`sheetsage2_abc.py:888-897`), le
même que décrit la documentation (`abc-editing.md:11-24`) :

```abc
X:1
T:
M:4/4
L:1/32
Q:1/4=88
V: Vocal clef=treble name="Vocal Melody" snm="Vocal"
V: Ins clef=treble name="Ins Melody" snm="Inst."
K:G
% verse
V: Vocal
"Gmaj7"B8d8"Am7"c8A8|"D7"F16"G"G16|
V: Ins
Z2|
```

| contient | ne contient pas |
|---|---|
| **2 voix monophoniques** : `Vocal` (le chant) et `Ins` (« an instrumental theme or solo ; it is not a piano chord-voicing staff ») — `abc-editing.md:27` | batterie, ligne de basse, nappe, piano, arrangement, nombre d'instruments |
| **accords** chiffrés sur la voix `Vocal`, même pendant ses silences : majeur, `m`, `dim`, `aug`, `7`, `maj7`, `m7`, `dim7`, `m7b5`, `sus4`, `sus2`, `6`, `m6`, `7sus4`, `m(maj7)`, avec basse en barre oblique — `abc-editing.md:84-91` ; `sheetsage2_abc.py:162-180` | accords étendus (`C13`, `A7alt`, `Cmaj9`) : « Do not invent syntax » — `abc-editing.md:91` |
| **tempo** `Q:1/4=n` (entier), **mesure** `M:` (y compris 3/4, 6/8, 7/8), **tonalité** `K:` majeure ou mineure, changements en ligne `[K:…]` — `abc-editing.md:29-31` ; `sheetsage2_abc.py:497-502` (tout autre mode refusé) | modes (dorien, mixolydien…) |
| **sections** en commentaires `% verse`, `% chorus`… ; 23 étiquettes connues de SheetSage2 (dont `intro`, `verse`, `pre-chorus`, `chorus`, `bridge`, `instrumental`, `outro`, `solo`) — `sheetsage2.py:242-246` | paroles alignées (`w:` refusé : l'alignement reste en fichier annexe — `abc-editing.md:122`) |
| grille : groupes de 1 à 4 mesures, un bloc `V: Vocal` puis un bloc `V: Ins` — `sheetsage2_abc.py:861-867` ; durées 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48 unités — `abc-editing.md:47` | triolets, notes d'agrément, reprises, liaisons d'expression, rythmes pointés « > » — refusés par l'outil de contrôle, `abc-editing.md:80` |

### 1.4 La modifier avant l'étape suivante : oui, et comment

- **ComfyUI (la voie du portail)** : le plan sort en `STRING` ; couper le lien
  `YuE2GenerateABC → YuE2GenerateMusic.abc` et fournir un texte édité
  (`nodes_yue2.py:53`). Le portail le fait déjà : champ `abc` de
  `music.yue` (`server/tools/music_yue.py:195-196`), avec deux réserves
  tenues par `yue_params` : pas de `ref` en même temps, et `mode` `full` ou
  `melody` (`music_yue.py:139-147`).
- **Olm-YuE2** (installé, sans modèle) : nœuds `YuE2 ABC Editor` et
  `YuE2 Apply Edited Score` (« Edited ABC is tokenized into a new plan »)
  (DGX2 `~/ComfyUI/custom_nodes/o-l-l-i_ComfyUI-Olm-YuE2/score_nodes.py:26-38`,
  `artifact_nodes.py:14-28`).
- **Contrôle avant rendu** : `abc_tools.py inspect | compare | strip-chords`,
  bibliothèque standard Python, Apache 2.0 (`~/YuE/skills/yue2-music/scripts/abc_tools.py`,
  `abc-editing.md:57-80`) ; `parse_abc(text)` rend hauteurs MIDI, onsets en
  fractions de noire, accords et mesures (`abc-editing.md:78`).
- **Ce que l'édition garantit** : rien sur le son hors de la zone touchée —
  « Editing renders a new complete recording » (`docs/editing.md:51`) ;
  « it does not expose waveform inpainting » (`editing-workflows.md:3`).

### 1.5 Injecter nos pistes MIDI : ce que le code permet

**Le chemin existe dans le code, pas comme fonction publique.** La conversion
« notes datées + temps + tonalité + accords + sections → ABC natif » est
`events_to_abc(events, duration, melody_only)` (`sheetsage2_abc.py:30-79`) :
elle attend des événements `{time, values: {rhythm: {meter, eighth_position},
key, chord, structure, melody: [{pitch, end_time, track}]}}`, `track` 0 =
`Vocal`, 1 = `Ins` (`sheetsage2_abc.py:32-45,84` ; `sheetsage2.py:313`). La
publication officielle de SheetSage2 offre l'équivalent
`generate_abc_from_data(melody_midi, beats, chords, keys, structures)`, mais
« It does **not** infer a beat grid or key from an arbitrary MIDI »
(`models-and-setup.md:254,282`). Donc : **on fournit nous-mêmes la grille, la
tonalité et les accords** — ODIO les a (tempo, mesure, tonalité, sections du
projet).

Correspondance ODIO → ABC (**notre proposition**, bornée par le dialecte) :

| dans ODIO | devient | règle / limite (source) |
|---|---|---|
| `P.bpm` | `Q:1/4=round(bpm)` | entier positif (`abc-editing.md:31`) |
| `P.sig` 2, 3, 4, 6 | `M:2/4`, `3/4`, `4/4`, `6/8` | `abc-editing.md:31` ; `music.py:76` |
| `P.key` (11 modes) | `K:` majeure ou mineure par la tierce, comme `aceKey` | `sheetsage2_abc.py:501-502` ; `musique/modules.js:342-346` |
| `P.sections` (étiquettes `intro`, `verse`, `pre-chorus`, `chorus`, `bridge`, `instrumental`, `outro`) | `% verse`… + les blocs de paroles `[Verse]` | toutes sont des étiquettes SheetSage2 (`sheetsage2.py:242-246` ; `modules.js:359-362`) |
| un motif mélodique (lead, chant) | voix `Vocal` ou `Ins` | **monophonique** : deux notes qui se chevauchent sont refusées (`sheetsage2_abc.py:427-430`) → garder la plus haute (notre choix) |
| un motif d'accords (nappe) | accords `"Am7"` sur `Vocal` | reconnaître l'accord (notes → racine + qualité parmi les 15) : **à écrire** ; aucun outil ne le fait ici (non documenté) |
| pas de 1/16 d'ODIO (16 pas par mesure) | la grille de SheetSage2 : 4 sous-temps par temps | `sheetsage2_abc.py:82` : conversion exacte pour des doubles croches droites ; pas de triolet |
| batterie, basse | **rien** dans l'ABC ; seulement des mots du style (« tight drums, round bass ») | `abc-editing.md:27` ; « Describing an instrument omission does not prove that the generated audio omits it » (`editing-workflows.md:20`) |

Deux façons d'écrire le convertisseur :
1. **Un nœud ComfyUI** (≈ 30 lignes, notre idée) qui construit les événements
   et appelle `events_to_abc` là où il vit. ComfyUI est sous GPL-3.0 : le
   code reste dans ComfyUI, le portail ne l'importe pas.
2. **Notre propre sérialiseur** dans le portail, écrit d'après la
   documentation du dialecte (`abc-editing.md`, Apache 2.0) et **vérifié par
   `abc_tools.py inspect`** avant l'envoi — à la manière du juge de graphe de
   `music_yue.py`.

La **reprise d'un clip d'ODIO** marche déjà par l'autre bout : SheetSage2 →
ABC → YuE2 (`music_yue.py:186-194`), et l'ABC transcrit peut être **retouché
par nos motifs** (remplacer la voix `Ins` par un thème d'ODIO, garder les
accords) avant le rendu.

### 1.6 Tempo et tonalité : jusqu'où YuE2 « colle »

- Tempo et mesure « in the ABC and describe them consistently in the style »
  (`generation-and-covers.md:17`) ; exemple du dépôt : « relaxed 88 BPM » dans
  le style **et** `Q:1/4=88` dans la partition (`editing-workflows.md:20`).
- Garantie : **aucune au sample près** — un tag de section « is not a
  sample-accurate scheduling API » (`editing-workflows.md:69`) ; pour un
  changement de tempo, « listen to verify the actual response »
  (`docs/editing.md:49`).
- Donc, pour caler sur la grille d'ODIO, il faudra **mesurer** les temps du
  rendu (§ 4 : SheetSage2 les produit, `beat_this` aussi) et avouer l'écart
  (loi 2.4 d'ODIO_01 : « Une conversion approximative l'avoue »,
  ODIO_01 `docs/etude-hub.md` § 2.4). Étirement sans changer la hauteur : pas
  encore dans ODIO (`musique.md` § 6, « Re-Pitch seulement »).

### 1.7 Une piste seule avec YuE2 : non

YuE2 rend une chanson entière, voix et accompagnement (`~/YuE/README.md`,
« it writes a melody-and-chord plan, then realizes that plan as a complete
song with vocals and accompaniment »). Paroles vides → instrumental, toujours
mixé. Pour « seulement la batterie » : ACE-Step `lego` (§ 2), ou séparer le
rendu (§ 3) en avouant l'origine du stem (ODIO_01 `etude-hub.md` § 13.1 et
§ 15 n° 9).

### 1.8 Continuer un morceau : non documenté, et ce qu'on pourrait faire

- Documenté : pas d'entrée audio, pas d'intervalle d'édition, pas de reprise
  partielle (« no … general automatic partial-resume method »,
  `generation-and-covers.md:17,141`) ; `plan()` prend une partition **entière**
  (`pipeline.py:255-266`).
- **Notre idée — continuer la partition** : le préfixe de l'étape 1 finit par
  `ABC_START` (`yue2.py:81`) ; y ajouter l'ABC des mesures déjà jouées
  (encodé par le même tokenizer, `yue2.py:83`) et laisser l'AR écrire la
  suite donne un **prolongement symbolique** : les mesures d'après, dans la
  même tonalité, le même tempo, la même forme. C'est une modification de
  préfixe dans un nœud à nous ; rien ne dit que la qualité tient. L'audio,
  lui, se rend alors pour la chanson entière (ou pour la seule suite, en
  acceptant une couture).
- Communauté (septembre 2026) : un **encodeur audio → jetons sémantiques de
  YuE2** (MERT-v2 → codes 32 768 à 25 Hz, 16,1 % puis 19,0 % d'exactitude
  top-1) a été publié par « Mothersuperior », CC BY-NC 4.0
  ([HF](https://huggingface.co/Mothersuperior/yue2-mothersuperior-realaudio-tokenizer-v4),
  [comfyui-wiki](https://comfyui-wiki.com/en/news/2026-09-16-yue2-realaudio-encoder)).
  Avec lui, préfixer l'étape 2 par les codes d'un morceau existant devient
  concevable — **non essayé par personne à notre connaissance** ; pas installé.

---

## 2. ACE-Step 1.5 et les autres modèles ouverts

### 2.1 Deux voies, et ce qui est sur les disques

| | ComfyUI (voie du portail, `music.generate`) | dépôt `~/ACE-Step-1.5` (son serveur d'API) |
|---|---|---|
| présent | ComfyUI v0.37.2 des deux DGX ; poids **XL base** `acestep_v1.5_xl_base_bf16.safetensors` (9,97 Go) **sur DGX2 seulement** (`ls ~/ComfyUI/models/diffusion_models`, 29/09) | les deux DGX, commit `97ac511` (13/04/2026), `.venv` torch 2.10.0+cu130, `import acestep` réussi ; `checkpoints/` : `acestep-v15-sft`, `acestep-v15-turbo` (2B), LM 5 Hz 1,7B et 4B, VAE, Qwen3-Embedding — **pas de modèle base** |
| tâches | **text2music** ; timbre d'un audio de référence (`ReferenceTimbreAudio`, expérimental) ; variation par `KSampler denoise < 1` sur un latent encodé (générique ComfyUI, non essayé) | les **six** : `text2music`, `cover`, `repaint`, `lego`, `extract`, `complete` (`acestep/constants.py:74`) |
| pourquoi pas lego/repaint dans ComfyUI | le cœur ne passe **aucun audio source ni masque** au DiT : `src_latents = x`, `chunk_masks = ones` (`comfy/ldm/ace/ace_step15.py:1131-1135`) ; l'instruction est figée (« Generate audio semantic tokens based on the given conditions », `comfy/text_encoders/ace15.py:244-246`) | l'instruction change par tâche (`constants.py:126-138`) |
| déjà utilisé par Cal | le gabarit officiel du portail (`server/workflows/music_ace15_xl_base.json`) | **AUDIOLAB** (DGX1) appelle `http://127.0.0.1:8001/v1/chat/completions` avec `task_type` `cover`, `lego`, `complete`, `repaint` et un « repaint de stem » (DGX1 `~/audio-studio/backend/app.py:18,209,233,488,514`) |

### 2.2 Les six tâches, noms exacts

| `task_type` | ce qu'elle fait | champs propres | modèles | source |
|---|---|---|---|---|
| `text2music` | un morceau depuis légende (+ paroles, métadonnées) | `caption`, `lyrics`, `bpm`, `keyscale`, `timesignature`, `duration` | tous | `INFERENCE.md:433-462` |
| `cover` | garde la structure d'un audio, change style / timbre | `src_audio`, `audio_cover_strength` (1,0 fidèle … 0,1 libre ; 0,2 pour un transfert de style), `cover_noise_strength` | tous | `INFERENCE.md:465-495` ; `inference.py:152-153` |
| `repaint` | refait **une zone** (début/fin en s) et garde le reste | `repainting_start`, `repainting_end` (−1 = fin), `repaint_mode` conservative/balanced/aggressive, `repaint_strength` 0–1, `chunk_mask_mode`, fondus de couture | tous | `INFERENCE.md:497-524` ; `inference.py:145-151` ; « 3 seconds to 90 seconds » (`Tutorial.md:787`) |
| `lego` | **« Generate a specific instrument track in context of existing audio »** | `src_audio`, `instruction` « Generate the {TRACK_NAME} track based on the audio context: », `caption`, zone `repainting_*`, `global_caption` | **base, xl-base** | `INFERENCE.md:526-556` ; `constants.py:132` ; `inference.py:108` |
| `extract` | isoler une piste d'un mélange (génératif) | `instruction` « Extract the {TRACK_NAME} track from the audio: » | base, xl-base | `INFERENCE.md:558-583` |
| `complete` | compléter une piste partielle avec des instruments | « Complete the input track with {TRACK_CLASSES}: » | base, xl-base | `INFERENCE.md:585-610` ; `constants.py:134` |

Pistes nommées (`lego`, `extract`) : `woodwinds`, `brass`, `fx`, `synth`,
`strings`, `percussion`, `keyboard`, `guitar`, `bass`, `drums`,
`backing_vocals`, `vocals` (`constants.py:150-153`). Réserve : le modèle zoo
dit sft et turbo **sans** lego/extract/complete (`README.md:258-272`) ;
AUDIOLAB a pourtant lancé un `complete` et un `lego` avec `acestep-v15-sft`
(DGX1 `~/ACE-Step-1.5/api.log` ~l. 6671 ; `~/audio-studio/data/7e03bff6/meta.json`,
« saxophone funky », 60 s) : le code accepte, **la qualité n'est pas connue**.

**Ce que rend `lego`** : la piste seule, ou le mélange avec le contexte ?
**Non documenté** — à relever au premier rendu.

### 2.3 Tempo, tonalité, durée, audio de référence

- Numériques : `bpm` 30–300, `key_scale` (« C Major », « Am »),
  `time_signature` 2/3/4/6, `audio_duration` 10–600 s (`docs/en/API.md`,
  « Music Attribute Parameters ») ; le nœud ComfyUI : bpm 10–300, 34 tonalités
  majeures/mineures (`comfy_extras/nodes_ace.py:42-46`).
- **Durée verrouillée sur la source** pour `cover`, `repaint`, `lego`,
  `extract` : « Silently ignore whatever the caller passed »
  (`inference.py:606-610`) → le résultat a la longueur du contexte envoyé :
  **calé par construction** si ODIO envoie la région exacte (à vérifier au
  premier rendu : nombre d'échantillons, 48 kHz).
- Audio de style : `reference_audio` « for style transfer or continuation
  tasks » (`INFERENCE.md:376`) ; ComfyUI : `ReferenceTimbreAudio`
  (`nodes_ace.py:109-131`, qui met `is_covers` à vrai, `comfy/model_base.py:2532-2539`).
- Le LM 5 Hz (« thinking ») complète bpm/tonalité/durée s'ils manquent ;
  « User-provided values always win » (`API.md`, « Metadata Auto-Completion ») ;
  il est sauté pour `cover`, `repaint`, `extract` (`API.md:169`).

### 2.4 Mesuré sur un GB10 (journaux de juin, DGX1, sft 2B)

| travail | temps | source |
|---|---|---|
| `repaint` 10 s, 8 pas | DiT 0,29 s (29,6 pas/s) + VAE ; mémoire allouée max 22,64 Go | DGX1 `~/ACE-Step-1.5/api.log`, 18/06 16:13:52 |
| `complete` 60 s, 8 pas | LM 5 Hz 8,49 s ; DiT 8 pas à ~6,8 pas/s ; latent 1 500 trames (25 Hz) | idem, 19/06 14:56:06 |
| XL base par ComfyUI | 29 s à froid, n = 1 (DGX2) | `docs/etudes/orchestration.md:231` |

ACE-Step est donc **l'outil des régions courtes et des itérations** ; YuE2
(30 s en 20–40 s par ComfyUI, `yue.md` § 1) celui des chansons.

### 2.5 Les autres modèles ouverts utiles

| modèle | ce qu'il prend | utile pour ODIO | licence poids | sur les disques | source |
|---|---|---|---|---|---|
| **Stable Audio 3** Small / Medium (mai 2026 ; Large fermé) | texte (bpm dans le texte), `seconds_total` ; inpainting, continuation ; LoRA annoncé | boucles, textures, effets ; édition de zones | Stability AI Community License (commercial < 1 M$ de CA) | non ; **ComfyUI v0.37.2 le connaît** (`comfy/supported_models.py:618-639`) | [Stability](https://stability.ai/news-updates/meet-stable-audio-3-the-model-family-built-for-artistic-experimentation-with-open-weight-models), [HF](https://huggingface.co/stabilityai/stable-audio-3-medium), [the-decoder](https://the-decoder.com/stability-ai-launches-stable-audio-3-0-with-up-to-six-minute-tracks-and-open-weights/) |
| **MusicGen melody** (1,5B, 3,3B) | texte + **mélodie par chromagramme d'un audio** ; continuation d'un audio ; 30 s, 32 kHz | rendre une mélodie d'ODIO (jouée par nos instruments) en autre timbre | CC BY-NC 4.0 (code MIT) | non | [MUSICGEN.md](https://github.com/facebookresearch/audiocraft/blob/main/docs/MUSICGEN.md) |
| **JASCO** (400M, 1B) | texte + **accords symboliques datés** `[('C', 0.0), ('D', 2.0)]` + **batterie en audio** + mélodie (saillance) ; 10 s | le seul qui prend nos accords **et** notre batterie tels quels | CC BY-NC 4.0 | non | [JASCO.md](https://github.com/facebookresearch/audiocraft/blob/main/docs/JASCO.md), [HF](https://huggingface.co/facebook/jasco-chords-drums-melody-1B) |
| **Magenta RealTime 2** (230M, 2,4B ; juin 2026) | texte, audio de style, **MIDI : vecteur de 128 hauteurs par trame de 40 ms** (off / tenue / attaque) ; ~200 ms de latence | le plus proche de « nos pistes MIDI jouées par un modèle », en direct | **CC BY 4.0** (code Apache 2.0) | non ; temps réel **sur Apple Silicon seulement**, hors ligne sur GPU NVIDIA (JAX) | [HF](https://huggingface.co/google/magenta-realtime-2), [GitHub](https://github.com/magenta/magenta-realtime) |
| **MiniMax Music 3** (août 2026) | légende + paroles + graine + `max_duration` ; pas de tempo, pas d'audio | chansons longues | CC BY-NC 4.0 selon MarkTechPost ; « commercial avec attribution » selon d'autres — **à lire dans le LICENSE** | non ; **ComfyUI v0.37.2 le connaît** (`comfy_extras/nodes_minimax_music.py:14-25`) | [HF](https://huggingface.co/MiniMaxAI/MiniMax-Music3), [MarkTechPost](https://www.marktechpost.com/2026/08/17/minimax-releases-minimax-music3/) |
| LeVo 2, HeartMuLa, DiffRhythm 2, SongBloom, Muse | chansons (poids publics d'après le tableau de YuE2) ; LeVo 2 rend voix et accompagnement **en pistes séparées** | à regarder si la séparation après coup déplaît | non relevé | non | `~/YuE/README.md` (tableau WildSongBench) ; ODIO_01 `etude-hub.md` § 12 |

Sur WildSongBench (192 prompts, 05/09/2026) : YuE2 6,73 de moyenne SongBench,
ACE-Step 1.5 6,01 (`~/YuE/README.md`, « Benchmarks »). La qualité d'une chanson
entière va donc à YuE2 ; ACE-Step gagne sur le **contrôle** (tâches,
métadonnées numériques, vitesse).

---

## 3. Stems : le meilleur séparateur libre, et lequel pour quoi

Reprise de `docs/etudes/stems.md` (classement Multisong de MVSep relevé le
29/09/2026 ; mesures ZFTurbo et audio-separator), rien de plus récent trouvé
qui le déclasse : la boîte à outils MUSDB18-HQ publiée en mai 2026 range
toujours BS-RoFormer en tête
([StemSplitio](https://huggingface.co/collections/StemSplitio/music-source-separation-toolkit-2026)).

| usage | modèle | pourquoi (SDR, dB) | état |
|---|---|---|---|
| **tout rendu génératif → 4 à 6 pistes** | **BS-RoFormer SW (6 pistes)** | basse 14,62, batterie 14,11, autre 8,72, voix 11,30 ; + guitare, piano (non notés) — meilleur modèle **unique** public | à télécharger : 699 412 152 o (`stems.md` § 5) ; licence non précisée |
| en attendant | chaîne **BS-RoFormer viperx (voix) + htdemucs_ft** | voix 11,01, batterie 11,86, basse 12,47, autre 7,13 | prête sur DGX2 (`stems.md` § 4) |
| voix seule / instrumental (karaoké, reprise YuE2) | BS-RoFormer viperx | voix 10,87, instrumental 17,18 | prêt |
| rapide, aperçu | htdemucs_ft | 8 s pour 30 s (DGX2) | prêt |
| **avant l'extraction MIDI de batterie** | séparateur de fûts (MDX23C DrumSep, LarsNet) | drum2midi en dépend pour les vélocités ([drum2midi](https://github.com/miraer/drum2midi)) | à télécharger |

À ne pas confondre : `extract` d'ACE-Step **génère** une piste « isolée » ; ce
n'est pas une séparation, et ODIO_01 interdit de présenter un stem séparé
comme une source authentique (ODIO_01 `etude-hub.md` § 15, n° 9). Chaque stem
porte sa méthode (`params.stem`, `parents`, `music_stems.py`).

---

## 4. Audio → MIDI : le clic droit « Extraire le MIDI »

| outil | ce qu'il sort | qualité publiée | licence | poids | sur les DGX | vitesse sur GB10 |
|---|---|---|---|---|---|---|
| **SheetSage2** | mélodie **chant** et **instrumentale** séparées, **accords**, **tonalité**, **temps et premiers temps**, **structure**, ABC, MIDI | temps F1 89,01 % (GTZAN) ; tonalité 77,73 % (GiantSteps) ; accords 90,08 % (osu2017) ; mélodie chant F1 82,51 % (RWC-Pop) | CC BY-NC 4.0 | 57,2 M (décodeur) + encodeur MERT2 ; fichier 1,39 Go | **oui**, les deux (`sheetsage2_bf16.safetensors`) ; le nœud ComfyUI ne rend que l'ABC, mais `model.transcribe()` rend les événements datés (`comfy/audio_encoders/audio_encoders.py:57-65`) | non documenté ; fenêtres de 300 s recouvertes de 200 s (`sheetsage2.py:351`) |
| **basic-pitch** (Spotify) | notes polyphoniques + pitch bend, tout instrument | « works best on one instrument at a time » | **Apache 2.0** | **230 ko** (ONNX) | **oui**, `~/audio-studio/.venv` (0.4.0, ONNX), les deux DGX ; utilisé par AUDIOLAB (`~/audio-studio/backend/transcribe.py:22-30`) | non mesuré ; modèle minuscule, processeur suffisant (estimation) |
| ByteDance piano transcription | piano (notes, pédale) | non relevé | non relevé | — | **oui**, même venv (0.0.6), GPU (`transcribe.py:12-20`) | non mesuré |
| **MuScriptor** (ISMIR 2026) | multi-instruments (36 sous-groupes, dont batterie et voix), MIDI + MusicXML ; conditionnable par instruments présents | Multi F1 48,2 contre 21,9 pour YourMT3+ sur **son** jeu d'essai | code MIT, **poids CC BY-NC 4.0** | 103M / 307M / 1,4B | non | non documenté | 
| YourMT3+ | multi-instruments + batterie | nettement sous MuScriptor d'après MuScriptor | **GPL-3.0** | — | non | non documenté |
| **ADTOF** / drum2midi | batterie : grosse caisse, caisse claire, charleston, toms, cymbales (+ ouvert/fermé, ride/crash, vélocités avec drum2midi) | F1 0,882 (MDB Drums), 0,837 (ENST) | ADTOF **CC BY-NC-SA 4.0** ; drum2midi MIT | petit | non | « ~1.9x slower than real-time on GPU » avec MDX23C ; LarsNet ~50× plus vite (leur GPU) |
| **beat_this** | temps et premiers temps (pour caler) | — | MIT (code et poids) | petit | non | non documenté |

Sources : [SheetSage2](https://huggingface.co/m-a-p/SheetSage2) ;
[basic-pitch](https://github.com/spotify/basic-pitch) (taille lue sur DGX2,
`basic_pitch/saved_models/icassp_2022/nmp.onnx`, 230 444 o) ;
[MuScriptor](https://github.com/muscriptor/muscriptor),
[arXiv 2607.08168](https://arxiv.org/html/2607.08168v1) ;
[YourMT3](https://github.com/mimbres/YourMT3) ;
[ADTOF](https://github.com/MZehren/ADTOF), [drum2midi](https://github.com/miraer/drum2midi) ;
[beat_this](https://github.com/CPJKU/beat_this).

**Retenu** (selon ce qu'on demande au clic droit) :

1. **« Notes de ce son »** → basic-pitch (installé, Apache 2.0) ; sur un
   mélange, séparer d'abord (§ 3) puis transcrire **chaque stem mélodique** à
   part — ce que sa documentation demande.
2. **« Partition (mélodie + accords) »** → SheetSage2 (installé) : chant et
   thème en deux motifs, accords en motif de nappe, tempo et mesure relevés —
   et le même ABC nourrit YuE2 (§ 1.5).
3. **« Batterie »** → stem batterie puis ADTOF (drum2midi) — **à télécharger,
   licence non commerciale** ; correspondance vers les voix d'ODIO (`bd`,
   `sd`, `ch`, `oh`, `lt/mt/ht`, `cc`, `rc`, `music.py:75`) : notre choix.
4. **À évaluer** : MuScriptor medium (307M) comme outil unique multi-pistes.

Chaque motif extrait garde **méthode, source et confiance** : « `AUDIO →
NOTES` est une estimation » (ODIO_01 `etude-hub.md` § 2.4).

---

## 5. Les LoRA : ce qui est documenté, et le « pronostic »

### 5.1 Documenté

| adaptateur | ce qu'il apprend | données, durée, mémoire | source |
|---|---|---|---|
| **LoRA YuE2, étage NAR** (le Trainer installé, `ComfyUI-YuE2-Trainer` `4578039`, MIT) | **style, instrumentation, timbre vocal** — « a *style/timbre* LoRA, not a full voice clone » ; l'AR « composer » reste gelé | 5 à 30 morceaux ; extraits de 10 s (250 trames) encodés une fois par le VAE ; 3 000 pas à 1e-4, rang 32 (défauts) ; « 5000 Steps with Weight 2.0 works best » ; bf16 obligatoire ; **24 Go conseillés** ; « ~1–3 s/step » sur une 4090 → 1 000 pas en 25–50 min | DGX2 `~/ComfyUI/custom_nodes/ComfyUI-YuE2-Trainer/README.md` ; `nodes.py:70-96,155-222` ; workflows de Cal 06 et 07 (`~/ComfyUI/user/default/workflows/AUDIO/`) |
| idem, réserves | entraîné en régime texte seul : « `cot=off` matches the text-only conditioning regime » ; « Dont use ABC code, it may affect the LoRa » ; retours mitigés (« no audible effect ») | — | README du Trainer ; [comfyui-wiki](https://comfyui-wiki.com/en/news/2026-09-19-yue2-lora-trainer) |
| **LoRA YuE2, étage AR** (communauté, grâce à l'encodeur audio → jetons) | le **plan** : structure, mélodie, direction du genre | rang 64, 3 000 pas, « past ~1,500 steps the model memorises the songs » ; 24 Go suffisent (14–18 Go mesurés) ; demande MERT2, Demucs, alignement MMS des paroles, un pack de 4 732 morceaux de régularisation ; CC BY-NC 4.0 ; **pas installé** | [Mothersuperior](https://huggingface.co/Mothersuperior/yue2-mothersuperior-realaudio-tokenizer-v4) ; exemple AR rang 8 + NAR rang 32, 179 morceaux : [monsterovich](https://huggingface.co/monsterovich/yue2-industrial-rock-lora) |
| **LoRA / LoKr officiel d'ACE-Step 1.5** | style d'un corpus, **annoté** (légende, bpm, tonalité, mesure, langue, paroles — auto-annotation possible par le LM 5 Hz) | 16 Go minimum, ~17 Go typiques ; 10–20 morceaux → ~800 époques (LoRA) ; LoKr : « What used to take an hour now only takes 5 minutes » ; interface Gradio et API `POST /v1/training/start`, `/v1/training/start_lokr` | `~/ACE-Step-1.5/docs/en/LoRA_Training_Tutorial.md:5-8,32,172,268,274` ; `docs/en/API.md` « Training API » ; `README.md:260,270` (« Fine-Tunability : Easy » pour base) |

**Durée sur un DGX : non mesurée.** Estimation (notre calcul, à vérifier) :
un GB10 a 273 Go/s de mémoire (`orchestration.md:194`) contre 1 008 Go/s pour
une 4090 (fiche NVIDIA) ; en comptant 2 à 4 fois plus lent, le LoRA NAR de
YuE2 à 3 000 pas prendrait **de 2 à 8 heures**, un LoKr ACE-Step **de l'ordre
d'une demi-heure à une heure**. Une nuit suffit pour l'un comme l'autre, sur
la DGX qui ne joue pas.

### 5.2 Ce que dit déjà le canon d'ODIO_01

- « **Deux mémoires, et non une LoRA magique** » : mémoire **instantanée**
  (extraire les jetons, déplacer le centre de l'attracteur, reranker les
  branches — « sans entraînement et doit constituer la première version ») ;
  mémoire **apprise** (« une LoRA … entraînée en tâche de fond … versionnée,
  liée à son modèle et activable par facette ») ; « Une LoRA arrivée tard ne
  réécrit pas silencieusement une branche déjà engagée » (ODIO_01
  `etude-hub.md` § 9.2, l. 844-856).
- À ne pas construire : « Une LoRA systématique à chaque sélection »
  (`etude-hub.md:1110`) ; tranche 5 : « LoRA seulement après preuve que le
  modèle, le corpus et le délai la rendent utile » (`etude-hub.md` § 16).
- Le futur : « Les futurs — cues, branches, attracteurs » vivent dans « la
  moitié du banc après la tête de lecture » (ODIO_01 `docs/logique-globale.md`
  § 1) ; devant la cue, une courbe « est une contrainte … Le prompt, c'est le
  dessin » (§ 4) ; un attracteur parle quand la tête **rouge** traverse son
  segment ; la **verte** peut aller écouter le futur (§ 7 bis) ; « L'horizon
  est par lane » (décision 69).
- « Le présent ne dépend jamais d'un modèle lourd » (`etude-hub.md` § 2.6) ;
  « La latence devient une distance musicale » (§ 2.5) ; « Une branche est
  une variante de section planifiée » (§ 0.1) ; étages
  `intent → plan → proxy → stems → final` (§ 3.4, § 10).

### 5.3 Le mécanisme proposé (notre idée)

Le point neuf : **YuE2 a un étage « partition » qui est un modèle de texte.**
Son plan ABC se prédit en jetons de texte (`yue2.py:33-34`), sans codec
audio. Un LoRA sur **cette** tâche ne demande que des paires
« style + paroles → ABC », que nous savons fabriquer : SheetSage2 sur les
morceaux de Cal, et ses projets ODIO convertis en ABC (§ 1.5). C'est le
chaînon « pronostic » : prédire les mesures suivantes dans la langue
harmonique et mélodique de Cal.

| facette du banc | mémoire instantanée (v1, sans entraînement) | mémoire apprise (tâche de fond) |
|---|---|---|
| **HARMONIE, mélodie** | les accords et thèmes des segments captés → la partition de départ | **LoRA texte de l'étage ABC de YuE2** sur les partitions de Cal (notre idée ; aucun outil ne le fait ; un script PEFT standard sur l'AR ; chargement côté CLIP dans ComfyUI comme le LoRA instrumental de la communauté, d'après [comfyui-wiki](https://comfyui-wiki.com/en/news/2026-09-16-yue2-realaudio-encoder)) |
| **TIMBRE** | un clip de référence → `reference_audio` d'ACE-Step, ou `cover` à force 0,2 | LoRA NAR de YuE2 (le Trainer) ou LoKr ACE-Step sur les stems de Cal |
| **RYTHME** | le jeton `RHYTHM` des motifs d'ODIO (`etude-hub.md` § 4.2) → contexte audio rendu pour `lego drums` | LoKr ACE-Step sur ses batteries annotées au bpm (notre idée) |

La boucle, de la tête rouge vers l'horizon :

1. Un **segment** tracé dans le futur du banc (lane HARMONIE, mesures
   17–24) avec son attracteur posé sur la basse et la nappe.
2. ODIO écrit l'ABC des mesures **déjà jouées** (derrière la tête) + tempo,
   mesure, tonalité, sections — exact, sans modèle.
3. **Continuation de partition** (§ 1.8, nœud à nous) avec le LoRA ABC de Cal
   activé à la force de la facette HARMONIE : l'AR écrit les mesures 17–24.
   Coût : à 42 jetons/s (`yue.md` § 1), quelques secondes pour 8 mesures
   (estimation).
4. **Étage « plan »** : la partition prédite redevient des motifs d'ODIO,
   joués **tout de suite par nos instruments** (loi 2.6 : aucun modèle lourd
   dans le présent) — l'« espérance à venir » est déjà audible
   (`etude-hub.md` § 10 ; catalogue « Plan sans audio », statut socle).
5. **Étages « proxy / stems »**, si le temps avant la cue le permet
   (`deadline`, `etude-hub.md` § 11.3) : YuE2 rend la section (avec le LoRA
   NAR), ou ACE-Step `lego` rend piste par piste sur le contexte ; deux
   variantes sur DGX1 et DGX2 (« deux exemplaires indépendants du même
   modèle », `etude-hub.md` § 11.1 — les deux DGX miroirs de Cal).
6. Cal **accepte** une branche → cristallisée (clips, stems, motifs) ; son
   choix rejoint le corpus ; la nuit, la DGX libre réentraîne les LoRA
   (versionnés, liés au modèle, `etude-hub.md` § 9.2).

Réserve à écrire noir sur blanc : le LoRA NAR est entraîné sans partition,
et son auteur déconseille l'ABC avec lui (README du Trainer) ; notre boucle
passe **par** l'ABC. Premier essai à faire : NAR + `full` contre NAR + `off`,
à l'oreille.

---

## 6. Proposition d'intégration dans ODIO

Principes repris du canon, pour que le génératif soit « cohérent avec ce qu'on
a déjà produit de façon traditionnelle » :

- **Aucun onglet IA à part** (`etude-hub.md` § 15, n° 1) : le génératif est une
  **sorte de piste** et un **module du nodal**, comme les autres.
- **Tout produit redevient ordinaire** : clips audio, stems, motifs MIDI
  (`etude-hub.md` § 2.2, § 7.3).
- **Les verrous viennent du projet** (tempo, mesure, tonalité, sections) et
  un **portail de conformité** les vérifie en code, jamais le goût (§ 2.10).
- **Une branche périmée le sait** par l'empreinte de ses entrées, reste
  jouable, ne se régénère que sur geste (§ 2.9).
- Nos jetons ne sont **jamais** les codes internes d'un modèle (§ 3.3) :
  l'ABC de YuE2 et les `audio_codes` d'ACE-Step restent dans leur
  adaptateur ; ce qui circule, ce sont nos motifs et nos jetons.

### 6.1 La piste générative dans l'arrangeur

- **Nouvelle sorte de piste `gen`** (notre proposition), sa source est un
  module `gen` (§ 6.2). Sur sa voie, **tirer sur le vide dessine une région
  générative**, aimantée à la grille — le geste que Cal décrit. (Sur les
  autres pistes, tirer sur le vide garde son rôle actuel : un cadre de
  sélection de clips, `musique/timeline.js:745-778`.)
- Variante : cadre tiré sur **plusieurs pistes** + clic droit « Générer
  ici… » → une région neuve dont le **contexte** est ce qui était choisi.
- **La région** est un clip `gen` : `start`, `len` (temps), un moteur, une
  tâche, ses réglages, son **étage** (`intent` → `plan` → `proxy` → `stems` →
  `final`, `etude-hub.md` § 3.4), ses **prises** (variantes), son empreinte.
  Dessin : l'étage atteint et jamais plus (« Une branche ne se présente
  jamais au-dessus de l'étage qu'elle a atteint », § 2.10).
- **Le panneau du bas** (la vue de détail, onglet Clip, `musique.md` § 6
  n° 7) montre, pour la région choisie :
  1. **Moteur** : ACE-Step 1.5 / YuE2 (ceux dont `…/options` dit `ready`).
  2. **Tâche**, nommée pour le musicien et traduite vers le moteur :
     « Une piste » (ACE `lego`), « Repeindre » (`repaint`), « Compléter »
     (`complete`), « Variation » (`cover`), « Morceau » (`text2music`) ;
     YuE2 : « Chanson », « Reprise d'un clip », « Partition seule » (s'arrête
     à l'étage `plan`).
  3. **Instrument** (tâche « Une piste ») : la liste des 12 pistes d'ACE-Step,
     « seulement la batterie » = `drums`.
  4. **Verrous du projet**, affichés et reprenables : tempo, mesure,
     tonalité (ramenée à majeur/mineur, comme `aceKey`), sections couvertes
     par la région, **durée = longueur de la région** en secondes.
  5. **Contexte** : les pistes rendues hors temps réel (le moteur d'export
     existe déjà) sur la région **plus une marge**, envoyées comme
     `src_audio` ; ACE-Step rend alors exactement cette durée (§ 2.3).
  6. **Audio de style** : un clip glissé dans une case → `reference_audio`
     (timbre) ou « Variation » avec sa force (`audio_cover_strength`) ; pour
     YuE2 → sa partition par SheetSage2.
  7. **Partition** (YuE2) : deux cases « Chant » et « Thème » où l'on dépose
     un clip MIDI d'ODIO, une case « Accords » ; l'ABC résultant s'affiche,
     se retouche, et passe le contrôle `abc_tools inspect` avant le rendu.
  8. **Style, paroles** : le panneau génératif actuel en tient déjà la forme
     (pastilles, blocs par section, `musique/generatif.js:117-167`).
  9. **Puis** : « séparer en pistes » (modèle recommandé), « extraire le
     MIDI » (§ 4).
  10. **Lancer** (le seul orange) ; nombre de prises (1 à 8 pour ACE-Step).
- **Les résultats** : chaque prise s'écoute dans la région ; **Accepter**
  pose un clip audio ordinaire (sur la piste `gen` ou une piste audio neuve),
  ses stems sous lui, ses motifs extraits ; la région garde la provenance.
- **Calage** : ACE-Step (tâches à source) → même durée que le contexte ;
  YuE2 → temps relevés par SheetSage2 ou beat_this, écart affiché (§ 1.6).

### 6.2 Le nœud génératif dans le nodal

- Le module `gen` est la **source** de la piste `gen`, posé dans le nodal
  comme les autres (le nodal montre déjà tous les modules et leurs câbles,
  `musique.md` § 1). Entrées : **contexte audio** (des envois, les câbles en
  pointillé existants), **motifs** (notes, batterie), **style** (un clip) ;
  sortie : l'audio accepté, puis ses stems.
- Ses **réglages sont des réglages ordinaires** (force de variation,
  température, force du LoRA…), donc exposables, automatisables et **captables
  par un attracteur** : il suffit d'ajouter leurs facettes à `FACETTES`
  (`musique/banc.js:78-88`) — p. ex. `gen.coverStrength → matière`,
  `gen.loraHarmonie → tonalité` (notre proposition, à relire par Cal comme
  toute la table).
- Pas de câble `JOB` à l'écran (« `JOB` jamais », `etude-hub.md` § 3.2) : la
  file de calcul reste invisible, on n'en voit que les conséquences.

### 6.3 Ce que les attracteurs lui passent

Ce qui existe dans le projet : segments `{lane, d, l, atr}` et attracteurs
`{x, y, anneaux: [{facette, r}], loi}` (`music.py:386-394` ;
`banc.js:59-65`), et les **opérateurs** = `neutre + (valeur − neutre) ×
poids` par bloc capté (`banc.js:102-117`), qui aujourd'hui « se lisent, ils
n'agissent pas sur le son » (`musique.md` § 6). Proposition (notre idée) :
**quand le segment d'un attracteur recouvre une région générative future,
l'attracteur devient ses contraintes.**

| du banc | vers la région générative |
|---|---|
| le segment `[d, d+l)` | la portée : la région (ou la partie) qu'il gouverne ; sa deadline = son début moins une marge (loi 2.5) |
| blocs captés sur **RYTHME** (motifs de batterie, accent de la basse) | leur jeton `RHYTHM` → rendu en **contexte audio** pour ACE-Step ; pour YuE2, des mots du style |
| blocs captés sur **HARMONIE** (tonalité, tension) | les accords et la tonalité de leurs motifs → accords de l'ABC (YuE2) ; `keyscale` (ACE-Step) ; force du LoRA ABC |
| blocs captés sur **TIMBRE** (brillance, matière) | le clip de style et sa force ; force du LoRA de timbre |
| le **poids** de chaque bloc (distance, loi) | la force de chaque apport (moyenne pondérée) — p. ex. `audio_cover_strength`, `repaint_strength`, force d'un LoRA |
| les courbes **ÉNERGIE / TENSION** devant la tête | les étiquettes de section et des mots du style par section (« build-up », « drop », « sparse ») ; pour YuE2, les sections de la partition |
| attracteur **fantôme** (tête hors du segment) | la région se prépare quand même (réglable avant qu'il parle, décision 58), mais n'est pas « engagée » |
| une prise **rejetée** déposée dans l'attracteur | exemple négatif (`etude-hub.md` § 9.1) : reranking, jamais un prompt négatif (YuE2 n'en a pas) |

### 6.4 Bibliothèque de clips MIDI

- **Clic droit sur un clip audio → « Extraire le MIDI »** (le menu a déjà
  « Séparer en pistes », `timeline.js:631`) : « Notes » / « Partition
  (mélodie + accords) » / « Batterie », case « séparer d'abord ».
- Le résultat : des **motifs d'ODIO** (le format existant : notes
  `{s, l, p, v}` sur la grille, batterie par voix, `music.py:252-281`) posés
  sur des pistes neuves, au même départ que le clip, **et** un objet de
  bibliothèque réutilisable. La bibliothèque ne connaît aujourd'hui que
  `image`, `video`, `audio`, `element` (`server/core/library.py:40`) :
  ajouter `midi` (fichier `.mid` + le motif en JSON + provenance : source,
  méthode, confiance).
- Le navigateur a déjà une section **Motifs** (`musique.md` § 1) : y ajouter
  « Bibliothèque MIDI » (glisser un motif sur une piste, ou dans les cases
  « Chant / Thème / Accords » d'une région YuE2).
- Cohérence : le canon demande que chaque motif sache s'émettre en jeton
  (`etude-hub.md` § 4.2, décision 9) — un motif extrait l'est d'emblée.

### 6.5 Le schéma des paramètres par modèle

Pour l'agent qui construit l'interface : **ce que le moteur prend**, bornes et
défauts **tels que la source les donne**. Les champs `odio` disent d'où ODIO
tire la valeur. `—` = pas de borne publiée.

```json
{
  "region": {
    "track":   {"type": "id", "doc": "piste de sorte gen"},
    "start":   {"type": "temps", "min": 0, "odio": "aimant du projet"},
    "len":     {"type": "temps", "odio": "durée en s = len × 60 / P.bpm, bornée par le moteur"},
    "engine":  {"type": "choix", "values": ["ace15", "yue2"]},
    "context": {"type": "pistes[]", "odio": "rendu hors temps réel de la région + marge → src_audio"},
    "style_audio": {"type": "clip | son", "odio": "glissé dans le panneau"},
    "locks":   {"bpm": "P.bpm", "sig": "P.sig", "key": "aceKey(P.key)", "sections": "P.sections ∩ région"},
    "takes":   {"type": "entier", "min": 1, "max": 8, "default": 1},
    "after":   {"stems": "id de modèle | null", "midi": "notes | partition | batterie | null"},
    "stage":   {"type": "choix", "values": ["intent", "plan", "proxy", "stems", "final"]},
    "fingerprint": {"type": "texte", "doc": "empreinte des entrées : périmée si elle change (etude-hub § 2.9)"}
  }
}
```

**ACE-Step 1.5 — serveur du dépôt** (`POST /release_task`,
`~/ACE-Step-1.5/docs/en/API.md` § 4.2 ; `acestep/inference.py:97-175`) :

| champ | type | bornes / valeurs | défaut | `odio` | source |
|---|---|---|---|---|---|
| `task_type` | choix | `text2music`, `cover`, `repaint`, `lego`, `extract`, `complete` | `text2music` | la tâche du panneau | `constants.py:74` |
| `model` | choix | `acestep-v15-turbo`, `-sft`, `-base`, `-xl-*` ; lego/extract/complete : **base** | modèle du serveur | — | `README.md:258-272` |
| `prompt` (`caption`) | texte | 512 signes | `""` | style | `music.py:32-34` (table de `INFERENCE.md`) |
| `lyrics` | texte | 4 096 signes ; `[Instrumental]` | `""` | paroles par section | idem |
| `instruction` | texte | auto par tâche ; lego « Generate the {TRACK_NAME} track based on the audio context: » | auto | l'instrument choisi | `constants.py:126-138` |
| piste (`lego`, `extract`) | choix | `woodwinds`, `brass`, `fx`, `synth`, `strings`, `percussion`, `keyboard`, `guitar`, `bass`, `drums`, `backing_vocals`, `vocals` | — | « Instrument » | `constants.py:150-153` |
| pistes (`complete`) | liste | les mêmes | — | cases à cocher | `constants.py:134` |
| `global_caption` | texte | — | `""` | style du morceau entier | `inference.py:108` |
| `bpm` | entier | 30–300 | vide (le LM le devine) | `P.bpm` | `API.md` « Music Attribute » |
| `key_scale` | texte | « C Major », « Am »… | `""` | `aceKey(P.key)` | idem |
| `time_signature` | choix | `2`, `3`, `4`, `6` | `""` | `P.sig` | idem |
| `audio_duration` | nombre (s) | 10–600 ; **ignoré** pour cover/repaint/lego/extract | vide | longueur de la région | `API.md` ; `inference.py:606-610` |
| `vocal_language` | choix | 51 codes (`ar` … `zh`, `unknown`) | `en` (API) | langue | `nodes_ace.py:45` ; `API.md` |
| `src_audio` / `src_audio_path` | fichier | chemin absolu sur le serveur ou envoi multipart | — | contexte rendu | `API.md` « Edit/Reference Audio » |
| `reference_audio` / `reference_audio_path` | fichier | idem | — | audio de style | idem |
| `repainting_start`, `repainting_end` | nombre (s) | zone de 3 à 90 s ; −1 = fin | 0, −1 | bornes de la région dans le contexte | `inference.py:145-146` ; `Tutorial.md:787` |
| `repaint_mode` | choix | `conservative`, `balanced`, `aggressive` | `balanced` | — | `inference.py:150` |
| `repaint_strength` | nombre | 0 (agressif) – 1 (prudent) | 0,5 | poids d'attracteur | `inference.py:151` |
| `chunk_mask_mode` | choix | `explicit`, `auto` | `auto` | — | `inference.py:147` |
| `audio_cover_strength` | nombre | 0–1 (0,2 : transfert de style) | 1,0 | force de variation | `inference.py:152` ; `INFERENCE.md:381` |
| `cover_noise_strength` | nombre | 0–1 | 0 | — | `inference.py:153` |
| `inference_steps` | entier | turbo 1–20 (8) ; base 1–200 (32–64) | 8 | — | `API.md` « Generation Control » |
| `guidance_scale` | nombre | base seulement | 7,0 | — | idem |
| `shift` | nombre | 1,0–5,0 | 3,0 (API) | — | `API.md` « Advanced DiT » |
| `infer_method` | choix | `ode`, `sde` | `ode` | — | idem |
| `seed` | entier | −1 = au hasard | −1 | graine | idem |
| `batch_size` | entier | 1–8 | 2 | nombre de prises | idem |
| `thinking` | booléen | LM 5 Hz pour les codes ; sauté pour cover/repaint/extract | `false` (API) — `true` dans `GenerationParams` | avancé | `API.md:169` ; `inference.py` |
| `lm_temperature`, `lm_cfg_scale`, `lm_top_p`, `lm_top_k` | nombres | 0–2 ; — ; 0–1 ; 0 = off | 0,85 ; 2,5 (API) / 2,0 ; 0,9 ; 0 | avancé | `API.md` « 5Hz LM » |
| `audio_format` | choix | `flac`, `mp3`, `opus`, `aac`, `wav`, `wav32` | `mp3` (API) | `flac` | `API.md` |

**ACE-Step 1.5 — voie ComfyUI déjà dans le portail** (`music.generate`,
`TextEncodeAceStepAudio1.5`, `nodes_ace.py:35-52`) : `tags`, `lyrics`, `seed`,
`bpm` 10–300 (120), `duration` 0–2000 (120), `timesignature` 2/3/4/6,
`language` (51 codes, `en`), `keyscale` (34), `generate_audio_codes` (vrai),
`cfg_scale` 2,0, `temperature` 0,85, `top_p` 0,9, `top_k` 0, `min_p` 0 ;
bornes du portail : durée 10–600, bpm 30–300, style 512, paroles 4 096
(`music.py:678-714`). **Text2music seulement.**

**YuE2 — ComfyUI, nœuds du cœur** (`music.yue`, `music_yue.py:96-155`,
`nodes_yue2.py`) :

| champ | type | bornes / valeurs | défaut | `odio` | source |
|---|---|---|---|---|---|
| `tags` (= `style`) | texte | 2 000 signes (garde du portail) | requis | style + « 112 BPM, F minor » | `music_yue.py:62,373` |
| `lyrics` | texte | 12 000 (garde) ; vide = instrumental | `""` | blocs par section | `music_yue.py:375` |
| `mode` | choix | `full`, `melody`, `off` | `full` (`melody` avec `ref`) | — | `nodes_yue2.py:22` ; `music_yue.py:143` |
| `abc` | texte (dialecte natif) | 60 000 (garde) ; exclut `ref` ; demande `full`/`melody` | `""` | **notre pont MIDI → ABC** (§ 1.5) | `nodes_yue2.py:53` ; `music_yue.py:139-147` |
| en-tête ABC tiré du projet | — | `Q:1/4=` entier ; `M:` ; `K:` majeur/mineur ; voix `Vocal`, `Ins` ; `% section` | — | `P.bpm`, `P.sig`, `P.key`, `P.sections` | `abc-editing.md:11-31` |
| `ref` | son de la bibliothèque | → SheetSage2 `mode` melody/full | — | un clip d'ODIO | `music_yue.py:186-194` |
| `duration_s` → `max_duration` | nombre (s) | 10–900 (nœud : 0,04–900) ; **un maximum** | 60 (portail) ; 360 (nœud) | longueur de la région | `nodes_yue2.py:56` ; `music_yue.py:56-59` |
| `seed` | entier | 0 – 2^64−1 ; −1 = au hasard | au hasard | graine | `nodes_yue2.py:21` |
| `precision` | choix | `bf16` (LoRA), `int8` | `bf16` | — | `music_yue.py:51-52` |
| plan ABC (avancé) | — | `max_abc_tokens` 1–20 000 ; `temperature` 0–5 ; `top_p` 0,01–1 ; `top_k` 1–32 768 ; `repetition_penalty` 0,01–10 ; `penalty_window` 1–20 000 | 8 192 ; 0,7 ; 0,9 ; 30 ; 1,005 ; 100 | — | `nodes_yue2.py:23-28` |
| rendu (avancé) | — | `temperature`, `top_p`, `top_k`, `repetition_penalty`, `cfg_scale` 0–100 | 1,0 ; 0,95 ; 100 ; 1,2 ; 1,0 (1,01 en `off`) | — | `nodes_yue2.py:57-61` |
| LoRA NAR | fichier + force | `LoraLoaderModelOnly` ; mot déclencheur **dans le style** | force 1,0 (workflow 07) ; « Weight 2.0 » (README du Trainer) | force = facette TIMBRE | workflow 07 de Cal ; README du Trainer |
| **absents** | — | pas de `bpm`, pas d'audio de style, pas de prompt négatif, pas de zone, pas de piste seule, pas de prolongement | — | le panneau ne les montre pas pour YuE2 | `generation-and-covers.md:17` |

**Séparation** (`music.stems`, déjà en place) : `src`, `model`
(`bs_roformer_sw`, `roformer_htdemucs_ft`, `htdemucs_ft`, `bs_roformer_viperx`,
`htdemucs_6s`), `stems` (sous-liste) — `music_stems.py:61-142`.

**Extraction MIDI** (à créer, notre proposition) : `src` (son), `method`
(`notes` = basic-pitch, `partition` = SheetSage2, `batterie` = ADTOF),
`separate_first` (booléen), `quantize` (1/16 par défaut, la grille d'ODIO),
réglages de basic-pitch (seuils d'attaque et de trame, longueur minimale,
fréquences min/max — ses options, [README](https://github.com/spotify/basic-pitch)).
Sortie : motifs d'ODIO + objet `midi` + `confidence`.

### 6.6 Ce qu'il faudrait côté serveur (rien n'est fait)

- `music.ace` : un travail sur la voie `audio` qui parle au serveur d'API du
  dépôt ACE-Step (comme AUDIOLAB), démarré à la demande (le portail charge et
  décharge les modèles, mémoire `showrunner-fleet-orchestration`) ;
  `…/options` publie le tableau ci-dessus, `…/plan` juge sans rien lancer,
  moteur factice par défaut — la même forme que `music_yue.py`.
- `music.yue` : accepter l'ABC venu d'ODIO (déjà le cas) et le **faire passer
  par `abc_tools inspect`** avant l'envoi.
- `music.midi` : l'extraction (§ 4).
- Le format du projet : pistes `gen`, clips `gen`, `validate` à étendre
  (`music.py:160-394`).

**Téléchargements proposés, pas faits** (taille lue par l'API de Hugging Face,
29/09) : `ACE-Step/acestep-v15-base` **4 791 792 407 o** (MIT) pour
lego/extract/complete en 2B, ou `ACE-Step/acestep-v15-xl-base`
**19 953 389 529 o** (MIT) au format du dépôt (le fichier ComfyUI
`acestep_v1.5_xl_base_bf16` est un réempaquetage : que le dépôt le lise est
**non vérifié**) ; BS-RoFormer SW (§ 3) ; ADTOF / drum2midi ; plus tard
MuScriptor medium, Stable Audio 3 Medium.

---

## 7. À essayer et à trancher quand Cal câblera

1. **ACE-Step `lego`** sur une session d'ODIO : contexte 16 mesures, « drums »,
   bpm et tonalité de la session — la sortie est-elle la piste seule ? son
   nombre d'échantillons égale-t-il le contexte ? sft contre base.
2. **YuE2 avec une partition écrite par ODIO** (thème + accords de la
   session NL—60) : le tempo `Q:` est-il tenu (temps relevés par SheetSage2) ?
3. **SheetSage2 sur un clip d'ODIO** → motifs : justesse, calage.
4. **basic-pitch** sur un stem de basse séparé → motif.
5. **LoRA** : 10–20 morceaux de Cal, un LoRA NAR (3 000 pas) et un LoKr
   ACE-Step, écoute A/B ; le LoRA **ABC** seulement si Cal retient l'idée.
6. À trancher : la région générative est-elle une **piste** à part ou un
   **clip** sur n'importe quelle piste ? Les opérateurs de l'attracteur
   agissent-ils sur la génération (proposition § 6.3) ? Licences non
   commerciales (YuE2, SheetSage2, MuScriptor, ADTOF) : acceptables pour
   l'usage de Cal ?

## Sources

- DGX2 (lu, rien lancé) : ComfyUI v0.37.2 (`830232b8`) —
  `comfy_extras/nodes_yue2.py`, `comfy/text_encoders/yue2.py`,
  `comfy/ldm/yue2/model.py`, `comfy_extras/nodes_audio_encoder.py`,
  `comfy/audio_encoders/audio_encoders.py`, `sheetsage2.py`,
  `sheetsage2_abc.py`, `comfy_extras/nodes_ace.py`,
  `comfy/text_encoders/ace15.py`, `comfy/ldm/ace/ace_step15.py`,
  `comfy/model_base.py`, `comfy/supported_models.py`,
  `comfy_extras/nodes_minimax_music.py` ; `custom_nodes/ComfyUI-YuE2-Trainer`
  (`4578039`), `o-l-l-i_ComfyUI-Olm-YuE2` (`ded9d97`) ; workflows
  `user/default/workflows/AUDIO/06_YuE2_entrainement_LoRA.json`,
  `07_YuE2_generation_avec_LoRA.json`.
- DGX2 `~/YuE` (`92a73cc`) : `README.md`, `docs/generation.md`,
  `docs/editing.md`, `docs/covers.md`, `src/yue2/pipeline.py`,
  `skills/yue2-music/references/abc-editing.md`, `editing-workflows.md`,
  `generation-and-covers.md`, `models-and-setup.md`, `scripts/abc_tools.py`.
- DGX1/DGX2 `~/ACE-Step-1.5` (`97ac511`) : `README.md`,
  `docs/en/INFERENCE.md`, `API.md`, `Tutorial.md`,
  `LoRA_Training_Tutorial.md`, `docs/sidestep/`, `acestep/constants.py`,
  `acestep/inference.py` ; journaux `api.log` (DGX1, 17–19/06/2026).
- DGX1/DGX2 `~/audio-studio` (AUDIOLAB) : `README.md`, `backend/app.py`,
  `backend/transcribe.py`, `data/*/meta.json`.
- ODIO_01 (`/tmp/odio01`, `6d8a7ed`) : `SOUL.md`, `docs/logique-globale.md`,
  `docs/etude-hub.md`, `docs/feuille-de-route.md`, `docs/concept-ui.md`,
  `docs/etat-de-l-art.md`.
- Portail : `server/tools/music.py`, `music_yue.py`, `music_stems.py`,
  `server/workflows/music_ace15_xl_base.json`, `server/core/library.py`,
  `musique/generatif.js`, `banc.js`, `timeline.js`, `modules.js` ;
  `docs/etudes/yue.md`, `stems.md`, `musique.md`, `orchestration.md`.
- Web (consulté le 29/09/2026) : cités en ligne, § 1.8, 2.5, 3, 4, 5.1.
