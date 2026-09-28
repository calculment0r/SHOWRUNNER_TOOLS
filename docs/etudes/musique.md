# Étude — l'outil Musique (28/09/2026, nuit)

Demande de Cal : « les outils de music qu'on a dans le zip, qu'on va tous
rassembler ensemble (rack, nodal et timeline) en un seul outil ». Tout ce
qui est créé va dans la bibliothèque Asset.

Consigne de Cal en cours de nuit : **l'UX et l'UI d'abord, pas de test de
génération par modèle** ; « Générer » a son interface, la déclaration du
travail et un mode factice ; le câblage réel se branche plus tard (§ 4).

## 1. Ce qui est fait

`musique/` (page, modules ES, aucune étape de construction) et
`server/tools/music.py`. Un projet, trois vues de la même chose :

| vue | ce qu'on y fait |
|---|---|
| Timeline | pistes (muet, solo, volume, panoramique), clips de motif et clips audio ; déplacer, rallonger (au temps, Alt : double croche, Maj : mesure), couper à la tête de lecture, dupliquer (Ctrl+D), retirer (Suppr), « motif à part » ; règle = aller là ; bande du haut = la boucle ; zoom (Ctrl+molette) |
| Rack | la chaîne d'une piste (source → effets → tranche) avec ses molettes ; + Effet, ↑ ↓, Actif/Bypass, × ; éditeur de motifs : séquenceur à pas (DR-9) ou piano roll (synthé, échantillonneur) ; 16/32/64 pas, Doubler, Effacer, Copier ; « Bus et sortie » pour les effets partagés |
| Nodal | tous les modules et leurs câbles (canvas du rack NL) : molette = zoom, glisser le fond, sortie → entrée = un câble, câble lâché dans le vide = module neuf déjà branché, Couper (liste ou Suppr), zoom sémantique (de loin, les cartes ne gardent que leur nom) |

Modules : **DR-9** (8 voix synthétisées, aucun échantillon), **Synthé**
soustractif (oscillateur ×2 désaccordés → filtre passe-bas à enveloppe →
ADSR), **Échantillonneur** (un son de la bibliothèque, transposé par note),
**Lecteur** (les clips audio d'une piste) ; effets **Délai** (synchronisé
au tempo), **Réverbération** (convolution sur réponse synthétique),
**Compresseur**, **Égaliseur** 3 bandes, **Filtre**, **Distorsion** ;
**Piste** (tranche) et **Sortie**. Jouer : clavier de l'ordinateur
(rangée du milieu, touches physiques), Web MIDI (bouton MIDI), pads et
touches du piano roll.

Exporter : rendu hors temps réel par le **même graphe** que la lecture
(OfflineAudioContext), WAV 24 bits 48 kHz stéréo, déposé dans la
bibliothèque (dossier Musique) ; lecteur audio du résultat, « Envoyer au
montage » (`montage/?add=<id>`, pris en charge par `montage.js`).

Le projet s'enregistre seul (`POST /api/music/projects/<id>`, 600 ms
après la dernière retouche, une version `rev` : un second onglet qui
enregistrerait par-dessus reçoit 409 et recharge). Le serveur refuse un
projet que la page ne saurait pas jouer : câble vers un module absent,
sortie câblée vers quelque chose, entrée sur une source, **boucle dans le
graphe**, clip qui joue le motif d'une autre piste, bornes (`validate`).

## 2. Les choix Web Audio et leurs sources

| choix | source |
|---|---|
| planification sur `AudioContext.currentTime`, réveil toutes les 25 ms, 120 ms d'avance | MDN, *Advanced techniques: Creating and sequencing audio* (lookahead 25 ms, scheduleAheadTime 0,1 s), d'après *A Tale of Two Clocks* (Chris Wilson) |
| minuteur dans un Worker | un onglet en arrière-plan ralentit les setTimeout de la page, pas ceux d'un Worker |
| bruit blanc = tampon `Math.random() * 2 - 1` | MDN, même page (`playNoise`) |
| grosse caisse : triangle 120 Hz + sinus 50 Hz → 0,001 Hz en 0,5 s ; caisse claire : bruit passe-haut 100 → 1000 Hz, triangle 100 Hz ; charley : 6 carrés sur 40 Hz × [2, 3, 4.16, 5.43, 6.79, 8.21], passe-bande 10 kHz, passe-haut 7 kHz, 0,05 s | Chris Lowis, *Synthesising Drum Sounds with the Web Audio API* (dev.opera.com, page disparue), valeurs relues dans sa reprise par Sonoport (sonoport.github.io/synthesising-sounds-webaudio.html) |
| clap : bruit passe-bande 1 kHz, 3 dents de scie de 10 ms + décharge de 20 ms, traîne de 100 ms | Baratatronix, *Roland TR-808 Clap Synthesis* |
| tom 165 Hz, déclin 0,31 s ; cloche : triangles 587/845 Hz, passe-bande 2640 Hz Q 3,5 | oramics synth-kit (tom, cowbell) ; 587/845 Hz = Sound On Sound, *Synth Secrets* 2002 |
| charley ouvert 0,3 s, étouffé par le fermé ; tom grave une quinte sous l'aigu ; glissé de 20 % des toms ; Q 1,5 du clap | **choix de réglage**, non sourcés |
| réverbération : bruit stéréo qui perd 60 dB en « durée » (RT60), dans un ConvolverNode | principe de la réverbération de Tone.js (« convolution created with decaying noise ») ; RT60 = définition acoustique |
| distorsion : `makeDistortionCurve` | MDN, WaveShaperNode (exemple) |
| bornes du compresseur | MDN, DynamicsCompressorNode (seuil −100…0, genou 0…40, taux 1…20, attaque/relâche 0…1 s) |
| résonance du filtre de synthé en dB | spécification Web Audio (lowpass : « resonance value in decibels ») |
| boucle de retour du délai | MDN : un cycle n'est permis que s'il passe par un DelayNode |
| WAV : en-tête RIFF 44 octets, PCM 24 bits | soundfile.sapp.org/doc/WaveFormat (CCRMA) |
| clavier par `KeyboardEvent.code` (touche physique) | MDN : la même rangée joue en QWERTY et en AZERTY |
| variables CSS posées par `style.setProperty` | MDN, CSSStyleDeclaration : `Object.assign(el.style, …)` (celui de `shell.js`) ignore `--k`, d'où l'`el()` de `musique/ui.js` |

**Niveaux mesurés** (rendu hors temps réel d'une voix seule, crête en
dBFS). Premiers gains : grosse caisse +0,9, caisse claire −1,6, clap −10,3,
charley fermé +2,4, ouvert +1,4, toms −4,5, cloche −18,3 ; synthé −10. Le
projet de départ exporté crêtait à +5,9 dBFS. Gains réglés
(`VOICE_GAIN`, moteur.js) pour −12 / −14 / −15 / −18 dBFS par voix, synthé
à −12 dB, lecteur audio à −6 dB : le projet de départ exporté crête à
**−5,85 dBFS**.

## 3. Ce qui a été vu (DGX2, Chromium sans affichage, portail d'essai :8794)

`python3 tools/check.py` : 239 passés, 0 en échec (le selftest musique :
projets, versions, refus — boucle, sortie câblée, tempo, module inconnu,
motif d'une autre piste —, graphe ACE-Step rempli, génération d'essai de
bout en bout jusqu'à la bibliothèque, séparation d'essai en 4 pistes filles).

Pilotage de la page (playwright), aucune erreur de console :
- lecture : 4,52 temps en 2,5 s à 110 BPM (attendu 4,58), 8 voix vivantes ;
- export boucle et morceau : WAV 24 bits 48 kHz 19,45 s, rendu en 0,2 à 0,7 s ;
- **un câble coupé dans le nodal change le son** : spectrogrammes du même
  morceau exporté avant (batterie + basse dès la mesure 5) et après la
  coupe Délai → Piste de la basse (la basse disparaît) ; recâblé ensuite à
  la souris (sortie du Délai → entrée de la Piste) ;
- clavier de l'ordinateur (A → 2 oscillateurs), pas du séquenceur, note au
  piano roll, Réverbération insérée dans la chaîne (DR-9 → Réverbération →
  Piste), échantillonneur chargé depuis le sélecteur de la bibliothèque,
  projet neuf par la petite modale, rechargement de la page (tout revient),
  coupe d'un clip (le motif continue : `off` de 8 temps) ;
- Générer (mode essai) → la piste audio se pose à la tête de lecture ;
  Séparer → quatre pistes sous l'original, qui est coupé.

Captures et spectrogrammes : scratchpad de la session (`musique/`).

## 4. Les moteurs de génération trouvés

Sur **DGX2**, ComfyUI :8188 (`~/comfyui-env`) :

| quoi | fichier / nœud | état |
|---|---|---|
| ACE-Step 1.5 XL base | `diffusion_models/acestep_v1.5_xl_base_bf16.safetensors` (9,97 Go) | présent |
| encodeurs | `text_encoders/qwen_0.6b_ace15.safetensors` (1,2 Go), `qwen_4b_ace15.safetensors` (8,4 Go) | présents |
| VAE | `vae/ace_1.5_vae.safetensors` (337 Mo) | présent |
| nœuds | `TextEncodeAceStepAudio1.5`, `EmptyAceStep1.5LatentAudio` (cœur de ComfyUI) | présents |
| gabarits officiels | `comfyui_workflow_templates_json` 0.1.95 : `audio_ace_step1_5_xl_base.json` (le nôtre), `…_xl_turbo`, `…_xl_sft`, `…_split*`, `audio_yue2_text2music.json` | présents |
| ACE-Step 1.5 XL turbo | `acestep_v1.5_xl_turbo_bf16.safetensors` (9,97 Go, 8 pas, cfg 1) | **absent** |
| YuE2 | `checkpoints/yue2_3b_bf16.safetensors`, `yue2_3b_int8_convrot.safetensors`, nœuds `o-l-l-i_ComfyUI-Olm-YuE2` et du cœur (`YuE2GenerateMusic`) ; workflows de Cal `user/default/workflows/AUDIO/01_YuE2_…` | présents, **non câblés ici** |
| séparation | `AudioSeparateDemucs` (AudioSeparation), `models/audio/Demucs/htdemucs_ft.safetensors` (336 Mo, marqué 💾) ; `AudioSeparation` (audio-separation-nodes-comfyui) veut un modèle torchaudio absent du cache → téléchargement | Demucs htdemucs_ft présent |

Sur **DGX1** (lecture seule) : `acestep.service` (API ACE-Step 1.5 sur
127.0.0.1:8001, charge DiT + LM 4B ≈ 55 Go au démarrage d'après son unité)
**n'est pas actif** (le port 8001 n'écoute pas) ; `audiolab.service`
(:8010) actif. Rien n'a été démarré ni touché.

### Un essai de chaque, avant la consigne de Cal

Faits une fois, avant la consigne « pas de test de génération » ; rien
d'autre n'a été mis en file depuis.
- **ACE-Step 1.5 XL base** par notre graphe (`server/workflows/music_ace15_xl_base.json`),
  style « upbeat synthwave instrumental », `[Instrumental]`, 30 s, 110 BPM,
  la mineur : **30 s de calcul** pour 30 s de son (modèles déjà en cache
  disque), FLAC 48 kHz stéréo, moyenne −14 dB, crête −0,4 dB ; spectrogramme :
  attaques rythmiques régulières, harmoniques jusqu'à 15,5 kHz, **la
  musique s'arrête vers 26 s** (4 s de silence en fin).
- **Demucs htdemucs_ft** sur ce son : **8 s** pour 30 s ; voix −69 dB
  (morceau instrumental : c'est juste), batterie −28,5 dB moyenne / −0,5
  crête (transitoires large bande), basse −17 dB (énergie au plus bas).

### Brancher le vrai moteur (plus tard, quand Cal le dit)

1. Dans `showrunner.local.json` de DGX2 : `"music_engine": "ace-step"`
   (la voie `audio` vaut déjà `["http://127.0.0.1:8188"]` par défaut).
2. Relancer le portail. `music.generate` et `music.stems` passent alors sur
   la voie `audio` : `run_generate_ace` (le graphe du gabarit officiel :
   shift 3, 50 pas, cfg 6, euler/simple, négatif = ConditioningZeroOut,
   encodeur cfg 2 / température 0,85 / top_p 0,9 / codes audio activés ;
   sortie FLAC) et `run_stems_demucs` (shifts 0, overlap 0,25, segment du
   modèle, comme l'exemple « 04_Demucs » du paquet ; le modèle n'est pris que
   s'il est marqué 💾 — jamais un téléchargement).
3. `GET /api/music/engines` dit alors si le modèle et les nœuds sont là, et
   la page désactive « Lancer » en disant pourquoi sinon.

Bornes (refusées à l'entrée, pas corrigées) : `~/ACE-Step-1.5/docs/en/INFERENCE.md`
— style ≤ 512 signes, paroles ≤ 4096 et `[Instrumental]` sans voix, BPM
30–300, durée 10–600 s ; tonalités, mesures (2, 3, 4, 6 = 6/8) et langues :
listes du nœud `TextEncodeAceStepAudio1.5` (`/object_info`).

## 5. Ce qui manque

- Écouter : rien n'a été entendu (pas de carte son) ; le son est prouvé par
  spectrogrammes et niveaux. Le goût (le grain de la DR-9, la basse) est
  à Cal.
- Des maquettes du kit non reprises : synthé spectral « Spectra »,
  « Polynome », baie 19", matrice de modulation, LFO, arpégiateur.
- Pas d'enregistrement du clavier dans un motif (Rec), pas d'automation, pas
  de rognage par le bord gauche d'un clip (Couper puis Retirer), un clip
  audio n'est pas étiré quand le tempo change.
- Web MIDI non essayé (pas de clavier MIDI sur les DGX).
- YuE2 (présent) n'est pas proposé dans Générer.
- ACE-Step : la musique générée s'arrêtait 4 s avant la durée demandée ;
  à revoir à l'écoute quand le moteur sera branché.
