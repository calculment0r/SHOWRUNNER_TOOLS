# ODIO — les synthés : ce qui existe, ce qui manque, la banque de préréglages

06/10/2026, branche `wip2/odio-synthes`. La demande de Cal, mot pour mot :
« Nos générateurs de son ne sont pas encore super. On avait fait une étude
avec différents synthés avec des presets, mais on ne les a pas intégrés il me
semble… si ? »

**En bref.**

- L'étude dont parle Cal **n'est pas dans ce dépôt** (§ 1). Les traces
  disent d'où venaient les synthés et ce qui n'a pas été repris. Elle est
  sans doute dans ODIO_01 ou sur le PC de Cal.
- **Ce qui a été intégré** : les quatre instruments du prototype ODIO_01.
  Ce sont l'Analog, la Basse acide, le Numérique (6 oscillateurs de Plaits)
  et la boîte à rythme 808/909. Le studio avait alors **19 préréglages** :
  10 écrits pour le Synthé et la DR-9, et 9 pour ces instruments, qui sont
  leurs réglages d'usine ou une variante d'un réglage.
- **Ce qui ne l'a pas été** :
  - les « sons par machine » d'ODIO_01 ;
  - les instruments à échantillons (TR-808 échantillonnée, General MIDI) ;
  - le LFO, l'arpégiateur, la matrice de modulation.
- **Fait sur cette branche** (§ 4) :
  - une banque de **130 préréglages** en onze catégories, chacun rendu et
    mesuré ;
  - l'**écoute** dans le navigateur ;
  - un **LFO**, du **bruit**, un **glissé** et une **enveloppe de hauteur**
    sur le Synthé ;
  - un **arpégiateur** sur les instruments mélodiques ;
  - **Macro**, un instrument neuf : **Plaits complet**, ses **24 moteurs**
    (FM à six opérateurs et ses 96 patchs DX7, table d'ondes, cordes, modal,
    accords, parole, percussions…), avec 28 préréglages (§ 4.5).
    - Licence MIT, vérifiée sur ses 111 fichiers.
    - Compilé en WebAssembly : 207 Ko, sans aucune dépendance.
    - Le garder ou non : c'est la décision 1.

## 1. L'étude « des synthés avec des presets » : où elle est

**Cherché** :

- `docs/etudes/` : aucune étude ne porte sur les synthés ou les préréglages ;
- `git log --all` : les 307 commits de toutes les branches, locales et
  `origin/*`, messages et contenus ;
- les fichiers effacés (`git log --all --diff-filter=D`) : aucune étude
  effacée, un seul CSS ;
- le texte de toutes les branches (`git grep`), avec les mots Spectra,
  Polynome, Surge, Dexed, Vital, Odin, Helm, NoiseMaker, soundfont, smplr et
  SonsBtn ;
- `musique/PROVENANCE.md` et les commentaires de `musique/`.

**Trouvé : des traces, pas l'étude.**

| où | ce qui est dit |
|---|---|
| `docs/etudes/musique.md` § 1 et § 5 | les instruments d'ODIO repris (commit `6d8a7ed` d'ODIO_01) ; « non repris : les instruments qui téléchargent leurs échantillons (`smplr`) » ; « des maquettes du kit non reprises : Spectra, Polynome, la baie 19", la matrice de modulation, les LFO, l'arpégiateur » ; les 38 pages du « Kit Voix Verdant » ne sont pas dans le dépôt |
| `docs/etudes/musique_odio01.md` n° 27 | « les SONS par machine (`SonsBtn.tsx`) ne sont pas portés » : un bouton de sons par machine dans ODIO_01 |
| `musique/PROVENANCE.md` | `drum-kit.ts` et `soundfont.ts` non repris (échantillons téléchargés par `smplr`) |
| `musique/machines/blocks/machines-data.js` | les 13 planogrammes d'ODIO_01 (MINILOGUE XD, MICROFREAK, TR-8S, POLY-6, ACID-3, FM-6, STRINGS-4…) ; la MicroFreak a une molette « preset » sur son panneau |
| `musique/machines/tuiles.js` | `VOIX_DES_PANNEAUX` : POLY-6, FM-6 et STRINGS-4 tournent sur le synthé soustractif, avec trois jeux de réglages pour ne pas sonner pareil. **Le FM-6 n'est pas de la FM** : son branchement est vide (`MACHINE_ENGINES.f6.map = {}`) |
| `docs/REPRISE.md` § 6 | six études restent sur le PC de Cal (positionnement, modèles, pipeline vidéo, présentations, brief de l'agent, export) ; aucune ne porte sur les synthés |

**Conclusion.** L'étude n'est pas dans SHOWRUNNER_TOOLS. Elle est
vraisemblablement à l'un de ces deux endroits :

- dans le dépôt privé **ODIO_01** : le bouton des sons par machine
  (`SonsBtn.tsx`), et ses `docs/` ;
- sur le **PC de Cal**.

Le dépôt ODIO_01 a été rattaché à la session, mais **sa lecture a été
refusée par les permissions de la session**. Il n'a donc pas été lu. C'est la
première question pour Cal (§ 5).

**La réponse à « on ne les a pas intégrés… si ? »** : en partie.

- **Intégrés** :
  - les instruments du prototype ;
  - les oscillateurs de Plaits ;
  - les 13 planogrammes du nodal, dont les voix reprennent ces instruments.
- **Pas intégrés** :
  - une banque de sons digne de ce nom : 19 préréglages ; pour les
    instruments d'ODIO, 4 réglages d'usine et 5 variantes d'un réglage ;
  - les sons par machine ;
  - les échantillons ;
  - les modulations.

## 2. L'inventaire, avant ce travail

### 2.1 Les instruments

| instrument | moteur | voix | réglages | préréglages avant → après |
|---|---|---|---|---|
| **DR-9** (`drums`) | 8 voix synthétisées (recettes de *Synth Secrets* et d'oramics, `moteur.js`) | une frappe = un petit graphe, sans limite | niveau ; par voix : accord, déclin, niveau | 4 → 10 |
| **Boîte à rythme** (`rythme`) | 11 voix, deux circuits 808 / 909 (`odio/instruments/drums-voices.js`) | sans limite | machine ; par voix : hauteur, chute, contrôle, niveau ; drive, gain | 2 → 10 |
| **Synthé** (`synth`) | 2 oscillateurs (A en 1 à 3 copies désaccordées), passe-bas biquad 12 dB à enveloppe, ADSR | **sans limite ni vol de voix** | 16 réglages | 6 → 39 |
| **Analog** (`analog`) | 2 oscillateurs désaccordés, passe-bas 12 dB ; une seule enveloppe pour le filtre et le volume (son déclin) | 32, la plus ancienne volée | 10 | 2 → 13 |
| **Basse acide** (`acid`) | 1 oscillateur, 3 biquads (18 dB), accent, glissé (une 303) | 1 | 8 | 2 → 11 |
| **Numérique** (`plaits`) | les **6 oscillateurs** de Plaits en WebAssembly (forme, scie, harmo, grain, phase, formants), un filtre et une enveloppe de filtre communs (paraphonique, comme une MicroFreak) | 8 | 13 | 3 → 13 |
| **Échantillonneur** (`sampler`) | un son, rejoué à la hauteur (`playbackRate`) | sans limite | note racine, départ, attaque, chute, volume | 0 → 6 |
| **Piste audio** (`player`) | des clips | — | volume | — |

Les autres sources de notes :

- **Les jouets du nodal** (14) émettent des notes et des valeurs. Quatre
  traitent le son : un écho à bande, une réverbe, un filtre, un volume
  (`docs/etudes/musique.md` § 7). Aucun ne fabrique de son.
- **Les machines du nodal** (13 planogrammes) jouent sur ces mêmes
  instruments :
  - MINILOGUE → Analog ;
  - MICROFREAK → Numérique ;
  - ACID-3 → Basse acide ;
  - TR-8S → boîte à rythme ;
  - POLY-6, FM-6 et STRINGS-4 → Analog, avec un réglage de départ chacun.

### 2.2 Le WebAssembly du Numérique : six oscillateurs, pas les 24 moteurs

Le module d'ODIO (`odio/instruments/plaits-wasm.js`) a été relu :

- 13 669 octets ;
- exports `initialiser`, `rendre(voix, modèle, f0, harmo, timbre, morph, …)`,
  `reinitialiserVoix`, `silence` ;
- compilé par « Ubuntu clang 18.1.3 ».

Rendu sous node pour les modèles 0 à 19 :

- les modèles 0 à 5 sont six sons distincts ;
- **les numéros 6 et au-delà rendent exactement le modèle 0**.

ODIO a donc compilé les oscillateurs de Plaits (`plaits/dsp/oscillator/`),
pas ses moteurs. **Tout ce qui est dans le WASM est déjà exposé.** Les autres
« modèles » demandent une autre compilation (§ 3.2).

### 2.3 Ce qui sonne, ce qui est pauvre (mesuré, pas écouté)

Rien n'a été écouté au casque dans la session : les jugements de goût sont à
Cal. Ce qui se mesure :

- **Statique.** Avant ce travail, aucun instrument n'avait de modulation
  lente : ni LFO, ni vibrato, ni trémolo. Un son tenu ne bougeait pas.
- **Mono.** Toutes les sources sortent en mono ; la largeur ne vient que des
  effets (Chorus, réverbes) et du panoramique.
- **Un seul filtre**, passe-bas, sur le Synthé et l'Analog. L'enveloppe de
  l'Analog sert au filtre *et* au volume.
- **Pas de vélocité vers le filtre**, pas de molette de modulation, pas de
  pitch bend MIDI.
- **Le Synthé n'a pas de vol de voix.** Des nappes à longue chute empilent
  les voix sans limite.
- **Le Numérique écrête en accord.** Avec un accord de quatre notes et son
  gain à 0,5, la phrase crête à +1,8 dBFS en sortie d'instrument (avant le
  fader). Le worklet somme les voix avant le filtre. La banque règle ses
  préréglages en conséquence.
- **Le « TR-909 » d'avant gardait les hauteurs et les chutes de la 808.** Les
  réglages d'une voix sont des valeurs absolues : poser `kit: 1` ne change
  que le circuit. Il est corrigé dans la banque.

**Le coût par voix** : rendu hors temps réel de 4,2 s avec 0, 1, 8, 16 et 32
notes tenues, le meilleur de trois. Le pourcentage est la part d'un cœur du
conteneur de la session ; DGX2 en diffère, mais les rapports tiennent.

| instrument | 0 | 1 | 8 | 16 | 32 voix (ms) | part d'un cœur par voix |
|---|---|---|---|---|---|---|
| Synthé (défaut : 1 scie) | 3 | 14 | 79 | 143 | 388 | 0,29 % |
| Synthé · Nappe (3 scies) | 3 | 18 | 101 | 190 | 362 | 0,27 % |
| Synthé · Cordes (3 scies + LFO) | 5 | 28 | 182 | 358 | 844 | 0,62 % |
| Synthé · Souffle (bruit + LFO) | 7 | 28 | 175 | 312 | 716 | 0,53 % |
| Analog | 3 | 13 | 133 | 157 | 308 | 0,23 % |
| Basse acide (mono) | 3 | 17 | 20 | 36 | 32 | — |
| Numérique (8 voix au plus) | 19 | 112 | 307 | 307 | 359 | 0,86 % (sur 8) |

Le LFO double le coût d'une voix du Synthé. Une modulation branchée sur
`detune` rend l'oscillateur et le biquad « à chaque échantillon » au lieu
d'une fois par bloc (spécification Web Audio, a-rate). C'est pourquoi le
LFO n'existe pas tant que ses profondeurs sont à zéro.

## 3. Ce que proposent les références libres

Le dépôt est public **sans licence**. On n'y met que du code MIT, BSD ou
Apache (ou du domaine public). La GPL imposerait sa licence à ce qu'on
distribue avec : rien de GPL n'est dans `musique/` (`PROVENANCE.md` :
Plaits en MIT, IBM Plex en OFL).

Chaque licence ci-dessous a été lue dans le dépôt de l'auteur
(`raw.githubusercontent.com`, le 06/10/2026).

### 3.1 Le tableau

| référence | ce que c'est | licence (lue) | portable en Web Audio / WASM ? | pour nous |
|---|---|---|---|---|
| **Plaits** (Mutable Instruments, `pichenettes/eurorack`, `plaits/`) | une voix complète, 24 moteurs | **MIT** : les 111 fichiers de `plaits/dsp` portent la notice MIT ; le README : « Code (STM32F projects): MIT » ; `stmlib` MIT. Seul `plaits/test/plaits_test.cc` est GPL-3 (non utilisé) | **oui** : compilé ici (§ 3.2) | **intégré** : Macro (§ 4.5, décision 1) |
| **Rings**, **Elements**, **Braids** (même dépôt) | résonateur modal et cordes ; voix de modélisation physique ; macro-oscillateur d'avant Plaits | **MIT** (`rings/dsp/part.h`, `elements/dsp/part.h`) | oui, même méthode que Plaits | ensuite. Plaits a déjà ses moteurs « corde » et « modal », tirés de Rings |
| Audible Instruments (VCV) | les modules Mutable dans VCV Rack | **GPL-3** pour son `src/` | — | non : prendre le code MIT d'origine |
| **Surge XT** | grand synthé hybride | **GPL-3** | port Web non trivial (C++, JUCE) | non (licence) |
| **Vital**, **Helm** | wavetable, soustractif | **GPL-3** | idem | non (licence) |
| **Odin 2** | soustractif, hybride | **GPL-3** (police en OFL) | idem | non (licence) |
| **Dexed** | émulation DX7 | **GPL-3** | — | non. Mais son cœur FM… |
| **msfa** (Google, *music-synthesizer-for-android*) | le moteur FM de Dexed | **Apache 2.0** (`COPYING`, en-têtes « Copyright 2012 Google Inc. ») | oui (C++ simple) | inutile si Plaits entre : son FM-6 joue les patchs DX7 |
| **TAL-NoiseMaker** (DISTRHO Ports) | soustractif | **GPL-2** (en-tête de `SynthEngine.h`) | — | non (licence) |
| **OB-Xd 2** (discoDSP) | soustractif | README : « License: Freeware » | — | non (pas une licence libre) |
| **dx7-synth-js** (Matt Montag) | DX7 en JavaScript, lit les sysex | **MIT** (`LICENSE.txt`) | à porter en AudioWorklet | inutile si Plaits entre |
| **webaudio-tinysynth** (g200kg) | 128 timbres « GM » sans échantillon, oscillateurs Web Audio | **Apache 2.0** | oui, pur Web Audio | une source de recettes GM ; à évaluer à l'oreille |
| **Tone.js** | synthés Web Audio (FM, AM, Mono…) | **MIT** | oui | des recettes, pas un moteur à embarquer |
| **Web Audio Modules 2** | norme de greffons Web | **MIT** | — | le contrat d'ODIO s'en inspire (`odio/types.js`) ; utile le jour où l'on chargera des greffons tiers |
| **sfizz** | lecteur SFZ (échantillons) | **BSD-2** | C++, gros, à compiler | si on décide les échantillons (décision 4) |
| **Faust** | langage DSP, compile vers WASM | compilateur sous GPL ; `COPYING` est une LGPL avec exception pour les œuvres liées ; les bibliothèques ont leurs licences par fichier | oui | outil possible, chaque bibliothèque à vérifier |
| **VCSL** (Versilian Community Sample Library) | échantillons d'orchestre et de claviers | **CC0** | des fichiers à servir | la banque d'échantillons la plus sûre |
| **Salamander Grand Piano** | piano échantillonné | **CC-BY 3.0** (README) | idem | un piano, en citant l'auteur |
| **FluidR3 GM** et **Musyng Kite / FatBoy** (rendus par `gleitz/midi-js-soundfonts`) | General MIDI | README : FluidR3 « Creative Commons Attribution 3.0 » ; Musyng Kite et FatBoy « CC BY-SA 3.0 » | idem | GM en CC-BY ; le BY-SA impose sa licence à ce qui le contient |
| les sons de **smplr** (ce qu'ODIO téléchargeait) | 808 échantillonnée, soundfonts | non vérifiée : le dépôt n'a pas de `LICENSE` lisible à la racine, et les sons sont servis depuis GitHub Pages | — | pas sans une licence lue, ni depuis un CDN tiers |

### 3.2 Plaits complet : compilé et mesuré ici

**La compilation.** Elle est faite dans la session, avec la même chaîne
qu'ODIO (clang 18.1.3, cible `wasm32`) :

- **sources** : `pichenettes/eurorack` @ `08460a6` (16/08/2023), dossier
  `plaits/`, et `pichenettes/stmlib` @ `d18def8`. Ce sont les 37 fichiers
  `.cc` de `plaits/dsp` et `plaits/resources.cc` ;
- **mode** : sans bibliothèque C (`-ffreestanding -nostdlib`) ;
- **ce qu'on a écrit** :
  - un `<algorithm>` de six fonctions ;
  - un `<cmath>` : les valeurs absolues, les racines et les arrondis sont des
    instructions WebAssembly ; `sin`, `cos`, `tan`, `exp`, `log`, `pow` et
    `atan` sont écrites en double, par réduction et séries ;
  - `memset` et `memcpy` ;
  - un `user_data.h` sans mémoire flash : les données d'usine, comme la
    version `TEST` du module ;
  - une colle de quarante lignes : huit `plaits::Voice`, 16 Ko de mémoire
    chacune, comme `plaits.cc`.
- **le résultat** : **220 Ko** (207 Ko avec les instructions SIMD, qu'on
  garde : le moteur modal coûte deux fois moins), aucune importation, 448 Ko
  de mémoire. Le compiler et l'initialiser prend 3 ms sous node.

**Les 24 moteurs, rendus sous node.** Do3, porte tenue 0,8 s sur 1,5 s,
harmo, timbre et morph à 0,5. Aucun NaN ; la hauteur est juste (le VA passe
262 fois par zéro par seconde : 130,8 Hz). Le coût est donné pour une voix,
en part d'un cœur.

| n° | moteur | crête | coût | n° | moteur | crête | coût |
|---|---|---|---|---|---|---|---|
| 0 | VA filtré | −8,5 | 1,2 % | 12 | additif | −3,3 | 0,6 % |
| 1 | distorsion de phase | −3,6 | 1,1 % | 13 | table d'ondes | −2,5 | 0,4 % |
| 2-4 | FM-6, trois banques de 32 patchs DX7 | −2,9 à −7,6 | 0,3 à 0,8 % | 14 | accords | −2,5 | 0,5 % |
| 5 | terrain d'onde | −3,9 | 0,7 % | 15 | parole | −3,5 | 0,7 % |
| 6 | string machine | −8,8 | 0,6 % | 16 | essaim | 0,0 | 0,6 % |
| 7 | chiptune | −6,0 | 0,4 % | 17 | bruit filtré | −1,2 | 0,5 % |
| 8 | analogique virtuel | −4,3 | 0,6 % | 18 | particules | 0,0 | 3,1 % |
| 9 | waveshaping | −5,8 | 0,9 % | 19 | corde | −17,3 | 2,0 % |
| 10 | FM deux opérateurs | −4,9 | 1,0 % | 20 | modal | 0,0 | **8,7 %** |
| 11 | formants granulaires | −3,9 | 0,7 % | 21-23 | grosse caisse, caisse claire, charley | −3,2 à −4,9 | 0,9 à 3,4 % |

**Les limites, et ce qu'on en fait.**

- **Plaits est écrit pour 48 kHz** (`kSampleRate`, `plaits/dsp/dsp.h`). À
  44,1 kHz, la hauteur se corrige par la note (+1,47 demi-ton). Les
  constantes de temps internes restent alors 8,8 % plus lentes.
- **Les sorties sont en 16 bits.** Le module les rend ainsi
  (`Voice::Frame`) ; il a son limiteur et sa porte basse.
- **Il rend par blocs de 24 échantillons.** Le worklet les met en file, pour
  des quanta de 128.
- **Le moteur modal coûte cher** : 8,7 % d'un cœur par voix sous node, 6 %
  avec le SIMD. Sous Chromium, le moteur du portail, on mesure 1,5 à 3,2 %
  (16 s rendues, une voix ; le VA : 1,3 à 2 %). Huit voix modales restent le
  pire cas de l'instrument ; son préréglage le dit (« coûteux »).

## 4. Ce qui est fait sur cette branche

### 4.1 La banque de préréglages (`musique/prereglages.js`)

**130 préréglages** :

- **39 Synthé**, **13 Analog**, **11 Basse acide**, **13 Numérique**,
  **28 Macro** ;
- **10 kits** pour la boîte à rythme, **10** pour la DR-9 ;
- **6 enveloppes** pour l'échantillonneur.

Ils sont rangés en onze catégories : basses, leads, nappes, claviers, plucks,
cloches, arpèges, percussions, effets, kits, enveloppes. Les 19 d'avant
gardent leur identifiant. Le « TR-909 » porte maintenant les hauteurs et les
chutes de la 909 (`drums-voices.js`). Ce sont des choix de réglage : le goût
est à Cal.

**Mesurés, chacun.** Chaque préréglage joue la phrase de sa catégorie, rendue
hors temps réel par `apercu` (la même source que la lecture), à 112 BPM.
Les volumes ont été réglés pour que la phrase crête autour de −8 dBFS :

| instrument | n | crête (dBFS) | RMS des parties qui sonnent | centroïde spectral |
|---|---|---|---|---|
| Macro (§ 4.5) | 28 | −9,4 à −6,8 | −32,4 à −14,9 | 142 à 8 436 Hz |
| DR-9 | 10 | −10,4 à −4,7 | −27,0 à −19,6 | 1 173 à 3 836 Hz |
| Boîte à rythme | 10 | −9,8 à −6,9 | −19,6 à −15,4 | 2 926 à 6 191 Hz |
| Synthé | 39 | −8,7 à −6,3 | −28,2 à −13,3 | 84 à 9 031 Hz |
| Analog | 13 | −9,3 à −6,5 | −25,4 à −18,0 | 132 à 2 257 Hz |
| Basse acide | 11 | −10,3 à −7,9 | −25,2 à −18,1 | 137 à 1 855 Hz |
| Numérique | 13 | −10,7 à −7,5 | −27,8 à −20,4 | 702 à 4 689 Hz |

Les 124 qui s'écoutent seuls (pas l'échantillonneur) crêtent entre −10,7 et
−4,7 dBFS. **Aucun silence, aucun écrêtage.** Le centroïde suit la catégorie, en
moyenne : basses 769 Hz, claviers 1 356 Hz, nappes 1 704 Hz, leads
2 294 Hz, cloches 2 741 Hz, kits 3 455 Hz.

### 4.2 L'écoute et le choix dans le navigateur

La rubrique **Préréglages** du navigateur (`navigateur.js`) :

- **L'instrument.** Par défaut, celui de la piste choisie (« Piste ·
  Synthé ») ; sinon un autre instrument, ou tous.
- **Les catégories**, en pastilles.
- **▶ écoute** une phrase de la catégorie, dans la **tonalité** et au
  **tempo** de la session. Une basse s'entend dans le grave : l'écoute
  compense l'octave du Synthé.
- **Survol** : écouter en passant, au bout de 220 ms. C'est éteint par
  défaut et gardé par visiteur (`localStorage`).
- **Un clic** pose le préréglage sur la piste choisie, ou sur une piste
  neuve si elle n'a pas cet instrument. On peut aussi le glisser.
- **Les miens** : « + Le réglage de « Lead » » le garde dans le projet
  (`P.presets`), avec la catégorie du préréglage d'où il vient.
  Double-clic : le renommer ; clic droit : sa catégorie, le retirer.
- **Dans le rack**, le menu Préréglages range la banque par catégorie, en
  sous-menus.

**L'écoute (`musique/ecoute.js`)** rend la phrase hors temps réel (`apercu`,
`moteur.js`), garde les 48 derniers rendus et la joue droit aux
haut-parleurs, comme le métronome :

- rien n'entre dans le graphe du projet, ni dans l'export, ni dans une
  prise ;
- on peut écouter pendant que le morceau joue ;
- aucun travail par image.

Au survol, l'écoute ne joue que si le son du studio a déjà été ouvert par un
clic : c'est la règle des navigateurs.

L'échantillonneur écoute le son de sa piste. Il garde ce son quand on lui
pose un préréglage.

### 4.3 Le Synthé : LFO, bruit, glissé, enveloppe de hauteur

Les réglages neufs sont placés après ceux d'avant : la tuile du nodal garde
ses rails.

- **Oscillateurs** : le niveau de A et B ensemble. À 0, seul le bruit
  sonne.
- **Bruit** : du bruit blanc, avant le filtre.
- **Glissé** : la hauteur part de la note d'avant
  (`setTargetAtTime`, τ = glissé / 3).
- **Env. hauteur, Retour hauteur** : la hauteur part de ±N demi-tons et
  revient. Cela fait les grosses caisses, les toms et les « zaps ».
- **Le LFO** : une forme, une vitesse, un délai, et trois destinations.
  - **La hauteur** reçoit un vibrato en cents (`OscillatorNode.detune`).
  - **La coupure** est modulée en octaves (`BiquadFilterNode.detune`).
  - **Le volume** reçoit un trémolo.
  - **Un LFO commun** à toutes les voix, libre : il ne repart pas à chaque
    note. C'est un choix de conception.
  - **Le délai** fait monter la profondeur après l'attaque.
- **L'arpège** (§ 4.4).

**À leurs défauts, le Synthé sonne comme avant.** Le LFO n'existe pas tant
que ses profondeurs sont nulles. La basse de la session de départ, rendue
par l'export sur `main` puis sur cette branche, est **identique à
l'échantillon près**. La nappe et le lead diffèrent autant que deux rendus
de `main` entre eux : leur bus de réverbération tire une réponse au
hasard.

### 4.4 L'arpégiateur (`musique/arpege.js`)

**Les réglages**, les mêmes sur le Synthé, l'Analog, la Basse acide, le
Numérique et Macro :

- **le mode** : monte, descend, va-et-vient, ordre joué, hasard, accord ;
- **la division** : 1/4, 1/8, 1/8 t., 1/16, 1/16 t., 1/32 ;
- **l'étendue** : 1 à 4 octaves ;
- **la durée** de la note jouée, en part du pas.

**Une fonction pure.** Elle s'applique au moment de planifier
(`Graph.notes`, et l'écoute) :

- ce qu'on entend est ce qu'on exporte ;
- le motif écrit ne change pas : éteindre l'arpège rend ses accords ;
- le hasard est tiré d'une graine fixe par pas : deux lectures jouent la
  même suite ;
- le résultat est gardé par motif, et refait quand les notes ou les
  réglages changent.

**Mesuré.** La nappe de la session avec l'arpège (monte, 1/16, deux octaves,
attaque courte) passe de quelques attaques à 28 en huit temps, à l'export.

### 4.5 Macro : Plaits complet (`musique/plaits/`)

**Le WASM.** `tools/plaits_wasm/construire.sh` prend Plaits et stmlib aux
commits fixés, refuse un fichier sans notice MIT, compile et écrit
`musique/plaits/plaits.wasm` (207 Ko) en neuf secondes. La notice est
reproduite dans `musique/plaits/LICENSE-plaits.txt` ; la provenance est dans
`musique/PROVENANCE.md`.

**L'instrument** (`musique/plaits/macro.js`) suit le contrat des instruments
d'ODIO, et l'adaptateur du studio le joue comme les autres : lecture,
export, écoute, nodal, jouets, arpège.

- **Huit voix**, chacune une `plaits::Voice` complète, dans un AudioWorklet.
  Le worklet met en file les blocs de 24 échantillons du module et pose une
  note au bon échantillon du quantum.
- **La note tenue est la porte du module** (son TRIG branché) : le front
  déclenche, la porte haute tient les enveloppes des moteurs FM-6.
- **Le jeu** :
  - « Tenu » branche LEVEL sur la vélocité : la porte basse s'ouvre et
    suit ;
  - « Frappé » le débranche : la porte basse est « pingée », le son
    percussif du module, réglé par Déclin et Couleur.
- **Aux** mêle la seconde sortie du moteur.
- **Le reste** : un passe-bas après les voix, une enveloppe par voix, le
  volume, l'arpège.
- **Dans le rack** :
  - le moteur se choisit dans un menu, par famille (24 boutons ne tiennent
    pas) ;
  - sur les moteurs FM-6, un second menu nomme les **32 patchs DX7** de la
    banque (« E.PIANO 1 », « MARIMBA », « STRINGS 2 »…), lus dans les
    données de Plaits. HARMO les parcourt.
- **28 préréglages** :
  - 13 patchs FM-6 choisis : basses, pianos électriques, clavinet, orgue,
    marimba, koto, vibraphone, cloches tubes, cordes, nappe, cuivres ;
  - les moteurs analogique virtuel, VA filtré, accords, string machine,
    table d'ondes, chiptune, corde, modal ;
  - les trois percussions, la parole, les particules, l'essaim ;
  - un arpège.

**Vérifié** (Chromium du conteneur, deux thèmes, aucune erreur de console) :

- une piste Macro créée depuis le navigateur ;
- le moteur choisi par le menu (FM-6 · banque 2), le bouton suit ;
- une note jouée en direct : −14,8 dBFS sur la tranche ;
- un clip de quatre notes exporté, la piste seule : −14,8 dBFS ;
- le « Piano électrique FM » écouté dans le navigateur, puis posé sur la
  piste ;
- les 24 moteurs rendus hors temps réel à 44,1 kHz : aucun NaN, crêtes de
  −19,9 à −8,9 dBFS avec le gain par défaut.

## 5. Les décisions pour Cal

| # | la question | recommandation |
|---|---|---|
| 1 | **Garder Macro** (Plaits complet, 24 moteurs, MIT, 207 Ko), fait sur cette branche (§ 4.5) ? Il est à côté du Numérique, qui garde ses six oscillateurs pour les projets qui l'ont | **Oui**, après écoute. C'est le plus grand gain pour l'oreille, à licence sûre. Le script de compilation, sa colle et la notice MIT sont versionnés |
| 2 | **Où est l'étude** des synthés à préréglages : ODIO_01 (le bouton des sons par machine) ou le PC ? | La mettre dans `docs/etudes/`, ou autoriser la lecture d'ODIO_01 à la session suivante. Ses choix se reprendront dans la banque |
| 3 | **Les machines du nodal** sur leurs vrais moteurs : FM-6 sur la FM-6 de Macro, STRINGS-4 sur sa string machine, la MicroFreak sur ses moteurs | **Fait le 09/10** (§ 7.1), avec le POLY-6 et le MINILOGUE XD sur le Synthé du studio ; reste l'écoute de Cal |
| 4 | **Des échantillons** (piano, cordes, General MIDI) | **Fait le 09/10** (§ 7.3) : un lecteur de banques (l'instrument Échantillons), VCSL (CC0) et Salamander (CC-BY, l'auteur cité), servis par le portail ; **reste à Cal** : lancer l'import sur DGX2 (`python3 tools/echantillons.py importer tout`) |
| 5 | **La GPL** (Surge, Vital, Dexed, Odin, Helm, TAL) | **Non.** Le dépôt est public sans licence ; ne pas l'y soumettre. Ce qu'ils apportent existe sous MIT ou Apache (Plaits, msfa) |
| 6 | **« Les miens »** suivent le projet aujourd'hui. Les rendre personnels, pour les retrouver dans tous ses projets ? | **Oui** : une préférence par personne (`/api/prefs`, un schéma `musique/prefs.json`). Cela touche les préférences du portail, d'où la question |
| 7 | **L'écoute au survol** | La laisser éteinte par défaut ; le clic sur ▶ suffit |
| 8 | **La matrice de modulation** | **Pas une grille de plus.** Les câbles « valeur » du nodal existent déjà, pour les jouets : un module LFO ou enveloppe qui émet une valeur, branchable sur tout réglage continu. Une seule vérité, qu'on voit |
| 9 | **L'arpège au clavier**, en jeu direct | **Fait le 06/10** (§ 6) : les notes tenues au clavier de l'ordinateur ou en Web MIDI, arpégées sur l'horloge audio, par la loi des clips |
| 10 | **La stéréo** | Étaler les copies de l'oscillateur A (et les voix du Numérique) dans le champ : un réglage « largeur » |

## 6. Ce qui reste, ou n'est pas beau

- **Rien n'a été écouté.** Les préréglages sont mesurés : niveau, spectre, ni
  silence ni écrêtage. Leur goût est à Cal ; la banque se corrige d'une
  ligne par préréglage.
- ~~**L'arpège ne joue que les motifs.**~~ **Le clavier aussi (06/10,
  finitions)** : une note jouée à la main (clavier de l'ordinateur, Web MIDI)
  sur une source dont l'arpège est allumé est *tenue*, et le moteur égrène les
  notes tenues sur l'horloge audio (`moteur.js`, `Engine.noteOn`, `arpTic`),
  par la même loi que les clips : `arpege.js` est découpé en `listeDuPas` et
  `notesDuPas`, qu'`arpeger` reprend (identique sur 3 000 motifs tirés au
  hasard). En lecture, le premier pas tombe sur la grille de la division ; à
  l'arrêt, il part à l'appui (5 ms). Une prise enregistre les touches, que
  l'arpège du clip rejoue. L'aperçu (piano roll, navigateur) reste sans
  arpège. Mesuré dans Chromium (une source espionnée) : Monte, 1/16, deux
  octaves, do et mi tenus une seconde à 112 BPM : do mi do' mi'…, un pas de
  0,1339 s, la note à moitié du pas ; en lecture, va-et-vient en 1/8 : les pas
  aux temps 1,5 ; 2 ; 2,5… Web MIDI passe par le même chemin, **non essayé**
  sans appareil. Les notes des jouets arrivent toujours directement à la
  source, sans arpège.
- **Le LFO du Synthé n'est pas automatisable**, sauf le volume et la
  coupure, comme avant. Sa vitesse est réglée sur un AudioParam, mais elle
  n'est pas dans `AUTOMATABLE`.
- ~~**Le Synthé est très large dans le rack** : huit sections, environ
  2 800 px. Le rack défile.~~ **Fait (06/10, finitions)** : deux rangées
  (le module borné à 1 280 px, ses sections passent à la ligne, et dans une
  section un choix prend sa ligne, les molettes dessous) : **1 280 × 474 px**
  au lieu de 2 856 × 245, les 31 commandes toujours là. Chaque section se
  replie d'un clic sur son nom : un onglet étroit, son nom à la verticale ;
  un point quand un réglage caché s'écarte du défaut, et sa bulle dit
  lesquels (« LFO → hauteur 20 ct »). Le repli vaut pour tous les Synthés du
  projet (`ui.replis.synth`). Bruit, LFO et Arpège repliés : 352 px de haut.
  Macro (1 900 px de large) et les autres instruments n'ont pas encore ce
  traitement.
- **La DR-9 n'a toujours que trois réglages par voix.**
  - La boîte à rythme est plus riche.
  - Une DR-9 sur les percussions de Plaits serait une suite naturelle de la
    décision 1.
- **Les préréglages de l'échantillonneur ne règlent que l'enveloppe.** Sans
  son posé sur sa piste, ils ne s'écoutent pas, et le bouton le dit.
- **Le Numérique écrête en accord à fort gain** (§ 2.3). La banque en tient
  compte, son réglage par défaut non.
- **Macro** :
  - il compte en 48 kHz : à 44,1 kHz, la hauteur est corrigée, mais ses
    enveloppes internes sont 8,8 % plus lentes ;
  - sa sortie est en 16 bits, comme le module ;
  - il demande le SIMD de WebAssembly : Chrome 91, Firefox 89, Safari 16.4 ;
  - ~~le nodal ne lui donne pas encore de facettes pour les attracteurs~~ :
    fait le 09/10 par le lot des attracteurs (la `sorte` de chaque réglage,
    `musique/facettes.js`) ; ses deux réglages neufs du 09/10 la déclarent.
- **La DR-9 et la boîte à rythme** pourraient aussi jouer les percussions de
  Plaits (grosse caisse, caisse claire, charley de Macro).

## 7. Fait le 09/10 : les meilleurs moteurs

Branche `wip3/odio-moteurs`. La demande de Cal, mot pour mot : « je pense
qu'on n'a pas encore intégré dans ODIO des moteurs de son qui sont les
meilleurs ; on avait pourtant relancé une mise à jour mais je crois que tu
ne l'as pas faite ». Il avait raison : les décisions 3 et 4 étaient restées
des recommandations.

**En bref.**

- **Les machines du nodal jouent leurs vrais moteurs** (§ 7.1) : FM-6 la FM à
  six opérateurs de Plaits et ses patchs DX7, STRINGS-4 sa string machine, la
  MicroFreak les moteurs de Plaits (sept des siens en viennent), POLY-6 et
  MINILOGUE XD le Synthé du studio (17 commandes branchées chacun au lieu de 3
  et 10). Un projet d'avant migre à l'ouverture.
- **Rings et Elements**, de la même autrice et sous la même licence MIT que
  Plaits, compilés en WebAssembly de la même façon (§ 7.2) : deux instruments
  neufs, le **Résonateur** (Rings : modal, cordes sympathiques, corde, voix FM,
  corde et réverbe, et son synthé de cordes caché) et **Physique** (Elements :
  archet, souffle, frappe, et un résonateur modal ou à cordes). 21 préréglages.
- **Les échantillons** (§ 7.3) : un lecteur de banques dans le moteur (zones de
  notes et de vélocités, fondus, tours, boucles, enveloppe), aux lois de
  sfizz ; VCSL et Salamander, importés par un script que Cal lance sur DGX2,
  servis par le portail. Essayé ici sur six zones de trois banques.
- **Rien n'a été écouté** : tout est mesuré (niveaux, spectres, ni silence ni
  écrêtage, coût dans Chromium). Le goût est à Cal.

### 7.1 Les machines : moteur d'avant → moteur juste

L'inventaire des treize planogrammes (`machines/blocks/machines.js`,
`MACHINE_ENGINES` ; `machines/tuiles.js`, `TYPE_DE_VOIX`) :

| machine | avant | maintenant | commandes branchées | pourquoi |
|---|---|---|---|---|
| **FM-6** | l'Analog (un soustractif !), rien de branché | **Macro, FM-6 · banque 2** | 0 → 3 | la machine d'une FM à six opérateurs |
| **STRINGS-4** | l'Analog, le volume seul | **Macro, string machine** (accord d'octave) | 1 → 6 | « String machine emulation with stereo filter and chorus » |
| **MICROFREAK** | le Numérique (les six oscillateurs de Plaits) | **Macro** (ses moteurs) | 12 → 12 | ses types d'oscillateur sont, pour sept d'entre eux, les moteurs mêmes de Plaits |
| **POLY-6** | l'Analog, coupure, résonance, volume | **le Synthé** du studio | 3 → 17 | un DCO à sous-oscillateur et bruit, un LFO à délai, une ADSR, un chorus : le Synthé a tout cela, l'Analog non |
| **MINILOGUE XD** | l'Analog (2 oscillateurs, UNE enveloppe) | **le Synthé** | 10 → 17 | deux VCO réglables chacun, deux enveloppes (amplitude et filtre), un LFO |
| ACID-3 | la Basse acide | inchangé | 8 | déjà juste (une 303) |
| TR-8S | la Boîte à rythme | inchangé | 46 | déjà juste (onze voix, deux circuits) |
| TAPE-3, PLATE-24, VARIMU-70 | RTT-01, Réverbe, Comp | inchangés | 4, 3, 4 | des effets, déjà sur les leurs |
| KBD-01, SEQ-01, INTERACTIONS | sans son | — | — | émetteurs de notes, démonstration |

**Ce qui se branche, et d'où vient la règle.**

- **FM-6** : la documentation de Plaits 1.2 (`firmware.md` du dépôt de
  documentation, `pichenettes/mutable-instruments-documentation` @ `14d04a7`) :
  « 2-voice, 6-operator FM synth with 32 presets (HARMO: preset selection,
  TIMBRE: modulator(s) level, MORPH: envelope and modulation
  stretching/time-travel) ». D'où : le bouton **algo** (32 crans) choisit le
  patch (un patch DX7 porte son algorithme) ; **retour** règle TIMBRE (à sa
  place de départ, 0,3, les modulateurs du patch : 0,5) ; **r2** règle MORPH à
  rebours (`fm/voice.h` : MORPH sous 0,5 accélère les enveloppes). Les rapports,
  niveaux et désaccords par opérateur ne se branchent pas : Plaits les lit
  dans le patch.
- **STRINGS-4** : même source, « String machine (HARMO: chord, TIMBRE:
  chorus/filter amount, MORPH: waveform) ». Le registre de 4' règle MORPH sur
  la moitié des onze registrations du moteur (`string_machine_engine.cc` : de
  la scie seule aux mélanges de scies et de carrés) ; la profondeur de
  l'ensemble règle TIMBRE de 0,5 à 1 (le chorus et le filtre ouvert) ;
  l'attaque, la chute, la tenue, le volume vont à l'enveloppe de Macro.
- **MICROFREAK** : son type d'oscillateur parcourt ses douze modes, dans
  l'ordre de son panneau. Arturia a repris sept modèles de Plaits (V. Analog,
  Waveshaper, Two Op FM, Formant, Chords, Speech, Modal : Sound On Sound et
  CDM, 2019 ; le site d'Arturia est bloqué dans le conteneur, non lu) : ils
  jouent les moteurs mêmes. Ses cinq modes à elle (Basic Waves, Superwave,
  Wavetable, Harmonic, Karplus Strong) prennent leur plus proche voisin dans
  Plaits (VA filtré, essaim, table d'ondes, additif, corde) — ce n'est pas
  leur code, c'est dit (`TYPES_MICROFREAK`). Pour elle, Macro a reçu le mode
  du filtre (LP, BP, HP) et une enveloppe de filtre paraphonique (celle du
  Numérique) : à leurs défauts, Macro sonne comme avant.
- **POLY-6, MINILOGUE XD** : leurs commandes vont aux réglages du Synthé de
  même sens (`machines.js`, les commentaires disent chaque branchement et ce
  qui ne se branche pas : la largeur d'impulsion, le coupe-bas, la cible du
  LFO du minilogue, son moteur multiple…). Le chorus du POLY-6 devient les
  copies désaccordées de l'oscillateur (« ensemble ») : un choix, dit.

**La voix propre d'un panneau** (`VOIX_DES_PANNEAUX`) ne règle plus que ce
que le panneau ne porte pas (le moteur de Plaits, la banque, l'accord, une
forme), posée AVANT le branchement : chaque molette dit ce qu'on entend
(avant, elle écrasait la coupure que la molette annonçait).

**Les projets d'avant** : à l'ouverture (`projet.js`, `migrerMachines`), une
machine dont le module n'est pas celui de sa voix en change, repart de la voix
de son panneau et de ses commandes ; l'arpège est gardé. Le pilote l'essaie
(un FM-6 sur l'Analog devient Macro, banque 2, le patch de son bouton).

Placées dans le nodal, leurs phrases de départ crêtent à : FM-6 -7,7,
STRINGS-4 -10,3, POLY-6 -9,5, MINILOGUE -9,3, MicroFreak -25,9 dBFS (ses
réglages de départ : le mode additif, la coupure à 1,2 kHz ; sa molette de
volume le dit). Les gabarits de PLANO proposent les nouvelles voix.

### 7.2 Rings et Elements en WebAssembly

**Les sources** : `pichenettes/eurorack` au commit de Plaits (`08460a6`),
dossiers `rings/` et `elements/` ; `stmlib` @ `d18def8`. **Licence MIT** :
les 28 fichiers de Rings (`dsp/` et `resources.*`) et les 23 d'Elements
portent la notice, vérifiée par le script, qui refuse un fichier sans elle ;
le README du dépôt : « Code (STM32F projects): MIT license ». Leurs tests
(`rings_test.cc`, `elements_test.cc`) sont en GPL-3 : pas pris. Le README
demande aussi de ne pas garder le nom des modules pour un dérivé : nos
instruments s'appellent Résonateur et Physique.

**La compilation** (`tools/mutable_wasm/construire.sh`) reprend la chaîne de
Plaits (clang 18, sans bibliothèque C, ses `shim/` et son `sr_math.cc`) ;
deux en-têtes vides de plus, et `std::rotate` au `<algorithm>` (Plaits se
recompile à l'octet près). `rings.wasm` 65 Ko, `elements.wasm` 405 Ko (les
échantillons de ses excitateurs), aucune importation. Rien n'est changé dans
les sources.

**Les nombres dénormaux.** Rendu sous node puis en natif : une voix de Rings
coûtait 2 % d'un cœur, puis 30 à 50 % quelques secondes après la note ; avec
le mode « flush to zero » du processeur (en natif), 1,9 %. Les filtres des
modes descendent sous le plus petit flottant normal ; un x86 calcule ces
nombres cent fois plus lentement, le Cortex-M4 du module non, et WebAssembly
ne sait pas les mettre à zéro. Le remède, sans toucher aux sources : les
entrées audio des modules (IN de Rings, BLOW et STRIKE d'Elements) reçoivent
un bruit à −300 dBFS (le plancher d'un vrai convertisseur est 150 dB plus
haut). Un Part polyphonique de Rings ne donne à ses voix muettes que du
silence (`part.cc`) : on tient quatre Part à la polyphonie 1 (60 modes
chacun au lieu de 28 ou 12), à tour de rôle comme le module. Mesuré : stable
sur 30 s.

**Les instruments** (`musique/mutable/`) suivent le contrat d'ODIO :

- une **file rééchantillonnée** (`worklet.js`) : le module compte à SA
  fréquence (Rings 48 kHz, Elements 32 kHz), un sinus cardinal fenêtré la
  ramène à celle du contexte (la hauteur et les temps du module, à toute
  fréquence ; à fréquence égale, une copie). Mesuré dans Chromium : la3 à
  220,2 Hz à 48 kHz, 220,5 Hz à 44,1 kHz, niveaux identiques ;
- **sortie stéréo** : les sorties ODD/EVEN de Rings (LARGEUR les resserre),
  les deux d'Elements (son ESPACE) ;
- **Rings** n'a pas de porte : chaque note frappe l'excitateur, la résonance
  s'éteint selon AMORTI ; la vélocité règle le niveau de la voix frappée ;
- **Elements** : la note tenue est sa porte (l'archet et le souffle durent),
  la vélocité son entrée STRENGTH ; quatre modules, une note chacun ;
- les potentiomètres lissés comme les modules les lisent (1 % par bloc) ;
  un réglage daté (un attracteur, une automation) tombe à son heure ;
- une voix qui ne s'entend plus (−100 dBFS une demi-seconde) cesse d'être
  calculée.

**Le coût**, dans Chromium (rendu de 10 s, le meilleur de deux, la part d'un
cœur du conteneur ; mesuré sous forte charge — moyenne de charge 15 sur 4
cœurs, d'autres agents tournaient : les écarts entre lignes comptent plus que
les valeurs) :

| instrument | 0 voix | 1 voix | 4 voix | par voix |
|---|---|---|---|---|
| Résonateur, modal | 0,62 % | 1,72 % | 6,19 % | 1,4 % |
| Résonateur, corde | 0,35 % | 0,84 % | 2,29 % | 0,5 % |
| Résonateur, cordes sympathiques | 0,34 % | 2,06 % | 6,86 % | 1,6 % |
| Physique, frappe (modal) | 0,68 % | 2,26 % | 6,08 % | 1,4 % |
| Physique, archet (modal) | 0,90 % | 1,75 % | 6,18 % | 1,3 % |
| Macro, modal (pour comparer) | 0,16 % | 1,17 % | 2,77 % | 0,7 % |
| Macro, FM-6 | 0,12 % | 0,97 % | 3,14 % | 0,8 % |

**Les préréglages** (`prereglages.js`) : 12 du Résonateur, 9 de Physique,
chacun rendu par l'écoute et réglé pour que sa phrase crête à −8 dBFS
(mesuré : −8,3 à −7,9). Le `trim` de l'adaptateur en vient : +8 dB pour le
Résonateur (ses résonances sortent bas), −6 dB pour Physique.

| préréglage | crête | RMS des parties qui sonnent | centroïde | écart G/D |
|---|---|---|---|---|
| Résonateur · Cloche modale | −7,9 | −24,6 | 9 228 Hz | −1,8 dB |
| Résonateur · Lame de bois | −8,0 | −24,6 | 986 Hz | −1,8 dB |
| Résonateur · Corde pincée | −7,9 | −32,1 | 2 938 Hz | −4,6 dB |
| Résonateur · Basse pincée | −8,0 | −33,5 | 357 Hz | −3,9 dB |
| Résonateur · Cordes cachées | −8,0 | −24,4 | 6 558 Hz | −2,1 dB |
| Physique · Archet | −8,0 | −25,7 | 405 Hz | +1,7 dB |
| Physique · Souffle | −8,1 | −21,0 | 4 702 Hz | −8,3 dB |
| Physique · Bol frappé | −8,0 | −21,4 | 8 271 Hz | −5,2 dB |
| Physique · Tambour | −7,9 | −23,9 | 3 383 Hz | −30,5 dB |

Aucun silence, aucun NaN. La voix cachée d'Elements reste un choix de son
résonateur, sans préréglage : −31,7 dBFS à gain 0,5, trop faible.

### 7.3 Les échantillons

**Le lecteur** (`musique/banques.js`, `moteur.js` SRC.banque) : l'instrument
« Échantillons » (sorte `banque`, sur les pistes Échantillonneur). Une banque
est la cartographie SFZ de son auteur, aplatie en zones ; une note fait sonner
les zones qui la couvrent, chacune à sa hauteur, depuis son départ, en boucle
si elle en a, avec son enveloppe. Les lois, lues dans **sfizz** (le lecteur SFZ
libre de référence, BSD-2, `sfztools/sfizz` @ `f5c6e29` ; formules reprises,
pas de code) : le tour (`seq_length`/`seq_position`), le niveau selon la
vélocité g = 1 − t(1 − v²) (`RegionStateful.cpp`), les fondus de vélocité en
racine carrée (`ModifierHelpers.h`). Ses réglages déplacent ce que la banque
dit : transposition, accord fin, attaque et chute multipliées, dynamique (le
suivi de vélocité), volume, l'arpège.

**Le portail** (`server/tools/music_banques.py`) sert ce qui est dans
`<data_dir>/echantillons/` : la liste, le manifeste (validé), le son d'une
zone. C'est commun au portail, comme les polices. Rien dans le dépôt, rien
depuis un tiers.

**L'import** (`tools/echantillons.py`, à lancer par Cal sur DGX2) :

- **VCSL** (Versilian Studios, CC0 1.0) : sa branche `sfz` @ `dfcf4a4`, où
  l'éditeur publie la cartographie SFZ de chaque instrument ; 19 banques
  (pianos droit et à queue, clavecin, piano FM, deux orgues, vibraphone,
  marimba, xylophone, glockenspiel, cloches tubes, harpe, kalimba, dan tranh,
  saxophone ténor, flûte à bec, harmonica, verres, timbales) ;
- **Salamander Grand Piano V3** (Alexander Holm, CC-BY 3.0 ; sa cartographie
  SFZ par kinwie, `sfzinstruments/SalamanderGrandPiano` @ `3382bf9`) : trois
  couches de vélocité sur seize (la 6e, la 11e, la 16e : chacune prend les
  vélocités des couches retirées sous elle), la chute d'une seconde et le
  suivi de vélocité de 73 % que son SFZ et son README donnent. Le crédit est
  dans la banque, et le rack le montre.
- un clone partiel : seuls les fichiers d'une banque se téléchargent ; chaque
  son en FLAC 16 bits à 48 kHz, sa queue coupée à 3 à 8 s (selon la banque)
  avec un fondu.

**Ce que ça pèse** : `python3 tools/echantillons.py taille` le lit dans l'API
de GitHub (bloquée ici, non essayée). Mesuré sur l'essai : un son de VCSL
pèse 2 à 4 Mo en WAV (le piano droit : 71 sons, ≈ 280 Mo à télécharger ;
son README annonce 20 à 75 Mo par instrument pour la plupart), un son de
Salamander 1,5 à 1,8 Mo en FLAC 24 bits (90 sons gardés : ≈ 150 Mo). Après
conversion, ≈ 0,25 Mo par son sur le disque (8 s). **Dans l'onglet**, un son
de 8 s décodé en flottants stéréo tient 3 Mo : le piano droit ≈ 220 Mo,
Salamander ≈ 280 Mo (le manifeste le dit, `decode`, et le rack aussi). C'est
la limite de la méthode : une banque se charge entière dès qu'une piste la
prend.

**Essayé ici** : six zones de trois banques (piano droit, vibraphone,
Salamander), importées par le script (24 s). La hauteur de chaque son, mesurée
(YIN), est la clé que sa cartographie donne (do4 : 261,7 Hz). Dans Chromium,
trois vélocités d'une même note : −26, −13, −4,6 dBFS ; le préréglage d'un
clavier crête de −9 à −12 dBFS. Une note hors des zones ne sonne pas (la règle
de SFZ).

**Le rack** choisit la banque dans un menu par catégorie (celles que le
portail a importées), dit sa source, sa licence ou son crédit, et ce qu'elle
tient en mémoire ; sans banque installée, le bouton est éteint et dit comment
en installer. Chaque banque installée devient un préréglage du navigateur, qui
s'écoute.

### 7.4 Vérifié

- `musique/pilote_moteurs.mjs` (portail d'essai neuf, deux thèmes) : 26
  contrôles, tout passe — trois pistes neuves exportées (Résonateur −3,9,
  Physique −8,4, Échantillons −12 dBFS, aucun NaN), leurs vues, les cinq
  machines sur leurs moteurs, la migration, le navigateur et son écoute.
- `check.py music music_jouets music_banques` : 102 contrôles ;
  `music_banques` en ajoute 14 (le SFZ, la liste, le manifeste, un son, les
  chemins refusés, un manifeste abîmé écarté).
- `music_moteurs` (11 contrôles, sous node, sans navigateur) : les deux
  modules se servent, s'instancient sans importation, jouent la3 à sa hauteur
  sans NaN ni écrêtage ; **la garde des dénormaux** — le coût des secondes où
  la résonance s'éteint, contre une seconde sans note : 2 à 3 fois avec le
  plancher de bruit, 100 fois sans lui (essayé sur une compilation sans
  plancher : la garde échoue, comme il faut) ; les lois des banques (le suivi
  de vélocité, les fondus, le tour, une note hors des zones, le rapport).
- `check.py` complet : voir le compte rendu de la branche (3 885 contrôles à
  0 échec avant `music_moteurs`).

### 7.5 Ce qui reste

- **L'écoute de Cal** : les machines, les 21 préréglages, les banques.
- **L'import sur DGX2** (`python3 tools/echantillons.py taille`, puis
  `importer tout` ; `--essai 6` pour voir d'abord).
- **La mémoire des banques** : une banque se charge entière ; charger
  seulement les zones que le projet joue (ses notes, son arpège) est la
  suite, si Cal trouve l'onglet lourd.
- Les **releases** des pianos (le bruit des marteaux au relâchement), les
  **commandes** SFZ (pédale, keyswitch) : écartées à l'import, et dites.
- Macro rééchantillonne-t-il comme Rings et Elements ? Il corrige encore la
  note hors de 48 kHz (ses temps glissent de 8,8 % à 44,1 kHz) : la file de
  `mutable/worklet.js` le ferait juste.
- Rings et Elements comme **effets** (un son du projet dans leur entrée IN,
  ce qu'ils font sur le module) : pas fait.
