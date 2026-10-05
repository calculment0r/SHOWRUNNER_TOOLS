# ODIO — les appareils de la chaîne audio : étude et refonte graphique

05/10/2026, branche `odio-appareils`. Ce que Cal demande, mot pour mot : « il
faut faire une grosse étude de nos éléments de chaîne audio dans ODIO… dans la
partie timeline, nos racks sont toujours avec des rotatifs et cela n'est pas
logique pour un égaliseur par exemple… on veut des choses plus visuelles et
mieux designées ».

Le périmètre est la vue Instruments, en bas de l'arrangement. Elle rassemble
toute la chaîne de la piste choisie, comme la « Device View » de Live :
`musique/rack.js`, dessinée par `musique/editeurs.js`. Les surfaces neuves
sont dans `musique/appareils/`. Le nodal, la console et la timeline n'ont pas
bougé : d'autres chantiers les tiennent en même temps.

**En bref.**

- Chaque module qui filtre, compresse, sature ou fait de l'espace a désormais
  une **surface** : la courbe que le moteur applique vraiment, et des points
  qu'on attrape.
- Les molettes restent, en dessous et en petit. Elles servent à lire une
  valeur et à la régler finement.
- L'égaliseur du studio devient **paramétrique à cinq bandes**, sur la découpe
  d'EQ Eight. Ses anciens projets sonnent exactement pareil.
- Toutes les courbes viennent des formules du moteur, et elles ont été
  **vérifiées contre le navigateur** (§ 5) :
  - biquads : l'écart est de l'ordre du cent-millième de dB ;
  - compresseur : l'écart reste sous 0,3 dB.

## 1. Avant

Capture `/tmp/claude-0/odio_dev/avant_sombre.png` (session du 05/10). Avant
cette branche, chaque module de la vue Instruments n'était qu'une rangée de
molettes (`rack.js`, `def.params.map(kn)`), à quelques exceptions près :

- la DR-9 et la boîte à rythme d'ODIO avaient des pads (4 × 2, puis 4 × 3) ;
- le Synthé avait trois petits dessins figés (132 × 38) : sa forme d'onde, un
  ADSR et une allure de filtre, tracés à la main et non calculés ;
- l'Échantillonneur montrait la forme d'onde de son son.

L'Égaliseur était donc six molettes : trois fréquences et trois gains. Cal le
dit : pour un égaliseur, ce n'est pas logique. On règle une courbe, et cette
courbe ne se voyait nulle part.

Le nodal, lui, avait déjà de petites surfaces, portées d'ODIO_01
(`machines/blocks/registry.js` : filtre, EQ-3, comp, satura, crush, chorus,
RTT, réverbe). Le rack ne s'en servait pas.

## 2. L'inventaire de la chaîne

Les modules sont relevés dans `musique/modules.js` (`MODULES`). Les
réglages des modules d'ODIO sont lus sur leurs descripteurs
(`getParameters()`). Les nœuds Web Audio sont relevés dans `musique/moteur.js`
(`FX`, `SRC`, `strip`, `master`) et dans `musique/odio/`. La dernière colonne
dit ce que la vue Instruments montre maintenant.

### Sources (instruments)

| module | moteur | réglages | représentation retenue |
|---|---|---|---|
| **DR-9** (`drums`) | huit voix synthétisées (`drumVoice`) | niveau ; par voix : accord, déclin, niveau | **pads** (le Drum Rack) — inchangé |
| **Boîte à rythme** (`rythme`, ODIO) | onze voix 808 / 909 (`rhythm-box.js`) | machine, drive, gain ; par voix : accord, chute, contrôle, niveau | **pads** — inchangé |
| **Synthé** (`synth`) | oscillateurs A (1-3 copies) et B → `BiquadFilterNode` passe-bas (Q en dB) à enveloppe → ADSR (`setTargetAtTime`) | forme A, octave, copies, désaccord ; forme B, octave B, part de B ; coupure, résonance, env. filtre (octaves), déclin filtre ; A, D, S, R ; volume | ses sections, avec **la courbe du filtre** (au repos et au sommet de l'enveloppe), **l'enveloppe qu'on tire** et **les formes d'onde dessinées** |
| **Analog** (ODIO) | deux oscillateurs → passe-bas (Q en dB) → ADSR en droites | onde, detune, coupure, réso, env (Hz), att, déclin, sustain, release, vol | **filtre + course de l'enveloppe**, **ADSR qu'on tire**, ondes dessinées |
| **Basse acide** (ODIO) | scie / carré → **trois passe-bas en série**, la résonance sur le premier (`resonanceParEtage`) → VCA | onde, coupure, réso, env mod, déclin, accent, glide, vol | **la courbe à 18 dB/oct.** au repos et au sommet (`ouverture`) |
| **Numérique** (Plaits, ODIO) | worklet Plaits → biquad (passe-bas, bande, haut) → enveloppe du worklet (exponentielle, τ = 0,35 × durée) | modèle, harmo, timbre, morph ; mode, coupure, réso, env ; A, D, S, R ; vol | **filtre + enveloppe**, mode du filtre dessiné |
| **Échantillonneur** (`sampler`) | `AudioBufferSourceNode` → gain | note racine, départ, attaque, chute, volume | forme d'onde, et **le départ se tire dessus** (le marqueur de Simpler) |
| **Lecteur** (`player`) | les clips audio de la piste | volume | molette (un seul réglage) |

### Effets

| module | moteur | réglages | représentation retenue |
|---|---|---|---|
| **Égaliseur** (`eq`) | avant : plateau grave → cloche (Q 0,9 fixe) → plateau aigu. **Maintenant** : coupe-bas → plateau → cloche → plateau → coupe-haut → gain (§ 6) | fréq. et gain de chaque bande, Q de la cloche, coupes (allumée, fréquence, Q), sortie | **courbe de réponse + cinq points + spectre** |
| **EQ-3** (ODIO) | plateau 220 Hz → cloche → plateau 3,8 kHz | grave, médium, centre, aigu, largeur (Q) | courbe + trois points (les plateaux à coude fixe ne se tirent qu'à la verticale) + spectre |
| **Table de mix** (ODIO) | gain → l'EQ-3 (Q du nœud : 1) → pano → fader → coupure | gain, grave, médium, centre, aigu, pano, niveau, coupure | la courbe de son correcteur ; gain, pano, niveau en molettes ; la coupure devient un **interrupteur** |
| **Compresseur** (`comp`) | `DynamicsCompressorNode` → gain | seuil, taux, attaque, relâche, genou, gain | **historique (entrée, sortie, réduction) + courbe de transfert + mètre de réduction** |
| **Comp** (ODIO) | `DynamicsCompressorNode` (genou fixe 8 dB) → gain | seuil, ratio, attaque, release, gain | la même surface, genou fixe |
| **Filtre** (`filter`) | un biquad : passe-bas, passe-haut ou passe-bande | type, fréquence, résonance | **courbe + point (coupure, résonance)** + spectre ; type choisi sur son dessin |
| **Filtre drive** (ODIO) | `WaveShaper` tanh → biquad (dont « aucun » = passe-tout) | coupure, réso, drive, type | la même ; drive en molette |
| **Distorsion** (`dist`) | `WaveShaper` (la courbe de MDN, ×4) → passe-bas → mélange → sortie | saturation, ton, mix, sortie | **courbe de transfert + un sinus avant / après** ; la part de la courbe que le signal parcourt |
| **Satura** (ODIO) | `WaveShaper` (`saturate`, tanh décalé) → passe-bas → mélange | drive, bias, ton, mix | la même (le point tire le drive et le bias) |
| **Crush** (ODIO) | `WaveShaper` en escalier (`quantize`), sans suréchantillonnage | bits, drive, ton, mix | la même : l'escalier, et le sinus quantifié |
| **Réverbération** (`reverb`) | pré-délai → convolution sur un bruit qui perd 60 dB en `time` → passe-bas | durée, pré-délai, amorti, mix | **la réponse impulsionnelle** (bruit sous l'enveloppe), le pré-délai, la fin à −60 dB, le son sec ; l'amorti en médaillon |
| **Réverbe** (ODIO) | passe-bas → convolution (queue `decay × (0,3 + taille)`, enveloppe (1−t)^2,6) | taille, decay, damp, mix | la même |
| **Délai** (`delay`) | retard synchronisé ; la boucle passe par un passe-bas ; le traité est pris avant le filtre | temps (valeur de note), retour, ton, mix, son sec | **les échos** à leur instant et à leur niveau, assombris passage après passage ; la grille des temps du morceau |
| **RTT-01** (ODIO) | retard → passe-bas → retour (le traité est pris après le filtre) | time (ms), fdb, tone, mix | la même |
| **Chorus** (ODIO) | trois retards (11, 17, 23 ms) balayés par trois oscillateurs | vitesse, profondeur, largeur, mix | **les trois lignes de retard** dans le temps, leur place dans l'image stéréo |
| **Volume** (ODIO) | gain → pano | niveau, pano | molettes (§ 3.8) |

### La tranche, les bus, la sortie

| module | moteur | réglages | représentation retenue |
|---|---|---|---|
| **Piste** (`strip`) | gain → pano → muet → analyseur | volume, panoramique | molettes + mètre + muet / solo — inchangé (la console a ses faders) |
| **Retour** (`bus`) | gain | entrée | molette |
| **Sortie** (`master`) | gain → filtre de l'arc → gain de l'arc → analyseurs G / D | volume, arc (coupure basse, volume bas) | molettes + mètre |

Les **jouets** du Playground (`musique/jouets/` : écho à bande, ressort,
aimant, alchimie, et les générateurs de notes) sont des scènes du nodal, avec
leur propre geste. Ils sont hors de cette étude : posés dans une chaîne, ils
gardent leurs molettes.

## 3. Ce que fait le métier, et ce qu'on en retient

Les manuels d'Ableton, de FabFilter, de Bitwig et d'Apple **n'ont pas pu être
ouverts depuis le conteneur de cette session** : le proxy de sortie les
refuse (« EGRESS_BLOCKED »). Ce qui suit vient de deux sources :

- les extraits renvoyés par la recherche web, cités avec leur adresse ;
- ce que l'on sait de ces logiciels, marqué *à relire* quand rien ne l'a
  confirmé ici.

Les adresses des manuels sont données pour qu'on les relise.

### 3.1 Les égaliseurs

- **EQ Eight** (Live 12, *Audio Effect Reference*,
  <https://www.ableton.com/en/live-manual/12/live-audio-effect-reference/>, la
  section EQ Eight).
  - Huit bandes. Chacune a un point dans l'écran ; on le tire pour régler sa
    fréquence et son gain.
  - Alt (Option sur Mac) + glisser verticalement règle le Q. Source : le forum
    Ableton, « 8 things you didn't know about eq8 »,
    <https://forum.ableton.com/viewtopic.php?p=1707305>.
  - L'analyseur de spectre est intégré, avec sa taille de bloc (8192 par
    défaut, 16384 possible) et sa moyenne ; voir
    <https://musictech.com/tutorials/how-and-why-you-should-use-ableton-lives-spectrum-and-eq-eights-analyser>.
  - Une vue étendue montre une molette par réglage de bande.
  - Une rangée de boutons choisit et allume chaque bande.
- **Pro-Q** de FabFilter (Pro-Q 4, aide en ligne,
  <https://www.fabfilter.com/help/pro-q/using/eqdisplay>).
  - Les points sont posés sur la courbe.
  - Un clic ou un double-clic sur le fond crée une bande.
  - La molette, sur une bande, règle son Q, même pendant qu'on la tire. Le
    sens est un choix discuté sur le forum de FabFilter :
    <https://prod.fabfilter.com/forum/topic/5865/solo-band-q-adjust-with-mouse-wheel>,
    <https://prod.fabfilter.com/forum/topic/1034/pro-q-mousewheel-suggestion>.
  - L'analyseur se règle avant et après l'égaliseur, avec une pente
    d'affichage.
- **Channel EQ** de Logic (<https://support.apple.com/guide/logicpro/lgcef1edc1d7/mac>).
  - Sur l'affichage graphique, on glisse dans une bande pour régler sa
    fréquence et son gain.
  - Glisser ses lignes verticales règle le Q.
  - Un analyseur FFT montre le signal en temps réel.
  - Chaque bande a sa couleur.
- **EQ+** de Bitwig (<https://www.bitwig.com/userguide/latest/eq>,
  <https://downloads.bitwig.com/stable/3.2/Release-Notes-3.2.html>).
  - Jusqu'à huit bandes.
  - Un double-clic ajoute une cloche.
  - Tirer le bord gauche ou droit de la courbe ajoute un plateau ; tirer le
    bord du cadre ajoute une coupe.

**Retenu** (`appareils/egaliseur.js`) :

- **L'écran**
  - une seule surface ;
  - la courbe de toute la chaîne de biquads, calculée et non dessinée à la
    main, avec son aire jusqu'au 0 dB ;
  - la propre courbe de la bande survolée ou choisie, en pointillé, comme dans
    Pro-Q ;
  - le spectre de ce qui sort de l'égaliseur, en fond, avec une pente
    d'affichage de 3 dB par octave autour de 1 kHz : c'est un choix
    d'affichage, la « pente » de Pro-Q ;
  - un point numéroté par bande. La coupe éteinte reste dessinée en creux, et
    la tirer l'allume.
- **Sous l'écran**
  - la rangée des bandes, comme dans EQ Eight : un chiffre, un nom, et une
    pastille pour allumer une coupe ;
  - les molettes de la **bande choisie** : fréquence, gain, Q ;
  - la sortie.

### 3.2 Les compresseurs

- **Compressor** (Live 12, même page que l'EQ Eight).
  - Trois vues : les molettes repliées, la *Transfer Curve* et l'*Activity*.
  - Dans la *Transfer Curve*, le rond vert est un réglage XY du seuil et du
    taux, et un point vert « court sur la courbe ».
  - L'*Activity* trace la réduction de gain (en orange) et la sortie au fil
    du temps.
  - Un mètre GR montre la réduction.
  - Sources : Sound On Sound, <https://www.soundonsound.com/node/4907963> ;
    <https://pcaudiolabs.com/how-to-use-the-ableton-compressor-audio-effect/>.
- **Pro-C 2** (<https://www.fabfilter.com/help/pro-c/using/overview>).
  - Un affichage animé des niveaux montre l'entrée, la sortie et la réduction
    de gain.
  - Le *Knee display*, à côté, trace la transformation entrée → sortie de la
    détection (seuil, taux, genou, plage). Il est « à la même échelle que
    l'affichage des niveaux ».
  - Des mètres d'entrée, de réduction et de sortie.

**Retenu** (`appareils/dynamique.js`). Un écran en trois parties, à la
manière de Pro-C, sur la même échelle en décibels :

- à gauche, **l'historique** : le niveau qui entre, celui qui sort, la
  réduction qui tombe du haut et le seuil en travers ;
- au milieu, **la courbe de transfert** du nœud, avec le point vivant posé
  dessus ;
- au bout, **le mètre de réduction**.

On tire deux poignées :

- **S**, le seuil, sur l'axe des entrées ;
- **T**, le taux, au bout de la courbe.

La troisième poignée d'Ableton, le réglage XY, n'a pas été reprise : le
rattrapage automatique déplacerait la courbe sous la main (§ 5.2). Le
rattrapage que le nœud ajoute de lui-même est écrit sous l'écran.

### 3.3 Les filtres

- **Auto Filter** (Live 12, même page ; le manuel 11 :
  <https://www.ableton.com/en/live-manual/11/live-audio-effect-reference/>).
  - Un écran montre la réponse du filtre.
  - *À relire* : la coupure et la résonance se tirent dans l'écran. Les
    extraits de recherche ne l'ont pas confirmé.
  - Le type se choisit sur des boutons qui dessinent sa forme.
- Le filtre d'un synthé (Analog de Live, Polysynth de Bitwig) montre aussi la
  course de son enveloppe. *À relire*.

**Retenu** (`appareils/filtres.js`) :

- la courbe exacte, et un point à la coupure posé sur la courbe : on tire la
  coupure à l'horizontale et la résonance à la verticale, et la molette règle
  la résonance ;
- pour un passe-bas ou un passe-haut, la résonance se lit en décibels
  (§ 5.1) : le point suit alors exactement la main sur l'échelle ;
- le type se choisit sur de petites icônes de sa réponse, calculées ;
- pour un synthé, la courbe au sommet de l'enveloppe est tracée en pointillé,
  et l'aire balayée est teintée.

### 3.4 La saturation

**Saturator** (Live 12, même page) montre une courbe de mise en forme. Le
niveau du signal est posé sur la courbe : la saturation apparaît là où le
signal atteint ses parties non linéaires. Source :
<https://ask.audio/articles/saturator-ableton-lives-secret-sound-design-weapon>.

**Retenu** (`appareils/saturation.js`) :

- la courbe de transfert, celle que reçoit le `WaveShaperNode`, et la
  diagonale du son intact ;
- **la part de la courbe que parcourt la crête qui entre**, soulignée ;
- un sinus avant (en pointillé) et après (le trait), mélange et sortie
  compris, avec la crête de sortie en dB.

### 3.5 L'espace : réverbération, délai, chorus

- **Reverb** (Live 12).
  - La traîne du réseau de diffusion se règle par son *Decay Time* : le temps
    pour descendre à −60 dB.
  - Les premières réflexions ont leur forme et leur niveau.
  - Source : <https://www.musicradar.com/tuition/tech/how-to-use-basic-reverb-parameters-604098>.
- **Pro-R 2** (<https://www.fabfilter.com/products/pro-r-reverb-plugin>) règle
  la durée de décroissance selon la fréquence (*Decay Rate EQ*) et égalise la
  réverbération après coup.
- **Delay** (Live 12) cale ses temps sur les valeurs de note et a un filtre
  dans sa boucle. *À relire*.

**Retenu** (`appareils/espace.js`). Le moteur d'ODIO n'a pas de décroissance
par fréquence. On dessine donc ce qu'il fabrique, sans rien de plus :

- **Réverbération**
  - la réponse impulsionnelle : du bruit sous l'enveloppe du moteur, au
    niveau traité ;
  - le pré-délai, la fin de la queue et le son sec à 0 ;
  - l'amorti en médaillon.
  - Les poignées : T (la durée), P (le pré-délai), M (le mélange) et A
    (l'amorti).
- **Délai**
  - le coup sec, puis les échos, chacun à son instant et à son niveau
    (mix × retour^n) ;
  - chaque écho perd de la brillance au passage dans le filtre de la boucle :
    on le montre par son opacité ;
  - la grille donne les temps du morceau (mesure.temps).
  - Les poignées : **1** règle le temps à l'horizontale (le délai du studio se
    cale sur la valeur de note la plus proche) et le mélange à la verticale ;
    **2** règle le retour.
- **Chorus** : les trois lignes de retard modulées (11, 17, 23 ms, plus ou
  moins profondeur × 6 ms) et leurs trois places dans l'image stéréo. Le point
  tire la vitesse et la profondeur.

### 3.6 Les synthés

Analog, dans Live, et Polysynth, dans Bitwig, dessinent leurs enveloppes,
qu'on peut tirer (*à relire*). Le Synthé du studio avait déjà ce principe en
petit, mais figé.

**Retenu** (`appareils/instruments.js`) :

- **L'enveloppe d'amplitude**
  - telle que le moteur la pose : attaque droite, puis selon l'instrument une
    approche exponentielle ou des droites ;
  - les poignées : A (l'attaque), D (le déclin à l'horizontale, la tenue à la
    verticale) et R (la chute) ;
  - le temps est en logarithme par segment : 5 ms et 3 s se lisent sur la
    même largeur.
- **Le filtre** : celui du § 3.3, en compact.
- **Les formes d'onde** se choisissent sur leur dessin.

### 3.7 Le Drum Rack

La DR-9 et la boîte à rythme d'ODIO ont déjà des **pads** (4 × 2 et 4 × 3),
comme le Drum Rack. Instrument Reference de Live 12 :
<https://www.ableton.com/en/live-manual/12/instrument-drum-and-effect-racks/>.
Ils restent tels quels.

### 3.8 Ce qui reste en molettes

Quelques réglages restent des molettes, et c'est voulu :

- un **niveau** ou un **panoramique** seul : la tranche, le retour de bus, le
  Volume d'ODIO, le gain et le pano de la table de mix, le Lecteur. *Utility*,
  dans Live, est lui aussi fait de molettes. La console a ses faders ;
- les **temps** de dynamique (attaque, relâche), qu'aucune courbe statique ne
  montre ;
- les **tons** des saturations et des délais ;
- les réglages des **pads**.

Partout ailleurs, la molette est **sous** la surface et liée à elle : elle
sert à lire la valeur et à la régler finement.

## 4. Les règles communes

### Le dessin

- **L'écran.**
  - Un écran encastré : fond `--bg`, coins `--r3`, filet
    `box-shadow: inset 0 0 0 1px var(--line)`.
  - Le module choisi le cerne de `--line-cy`.
  - Le SVG est à la taille de ses pixels : le texte reste net.
- **La courbe.**
  - Un trait de 2 px dans `--k`, l'accent de la piste.
  - Son aire, à 13 %.
  - La courbe propre d'une bande est en pointillé.
- **La grille.**
  - Des filets `--line`.
  - Les repères étiquetés, en `--line-cy` à 32 %.
  - Le zéro en `--line-cy`.
- **Le texte.**
  - Les repères en `--f-mono` 8 px, couleur `--ink3`.
  - La lecture en mono 8,5 px, couleur `--ink2`.
  - Les capitales sont réservées à la machine. La prose (la note du
    compresseur) reste en bas de casse.
- **Les mesures.**
  - Le spectre et les niveaux en `--ink3`, discrets.
  - La réduction de gain en `--coral-2`, la rampe des barres de la console.
  - La part de courbe parcourue par le signal en `--or`, avec opacité.
- **Les poignées.**
  - Un rond `--panel2` cerné de `--k`, avec son chiffre ou sa lettre.
  - Choisie, elle se remplit de `--k`, chiffre en `--bg`.
  - Survolée ou tirée, un halo apparaît.
  - Éteinte, elle passe en creux pointillé `--ink3`.
- **Aucun jeton neuf** : tout se lit dans les jetons existants. Les deux
  thèmes sont donc couverts par construction (captures sombre et claire,
  § 8).

### Les gestes

Ils sont pareils sur toutes les surfaces : `appareils/surface.js`,
`gestes()`.

| geste | effet |
|---|---|
| glisser un point | ses deux réglages (égaliseur : fréquence et gain ; filtre : coupure et résonance ; enveloppe : temps et tenue) |
| **Alt** + glisser | le Q d'une bande d'égaliseur (vertical) ; le genou du compresseur |
| **molette** sur un point | le Q (égaliseur), la résonance (filtre), le genou ou le taux (compresseur). Hors d'un point, la molette fait défiler le panneau, comme avant |
| **Maj** | réglage fin : le mouvement compte pour un cinquième |
| **double-clic** sur un point | ses réglages reviennent à leur défaut |
| flèches (la surface a le focus) | la bande choisie : ← → la fréquence, ↑ ↓ le gain ; Alt : le Q ; Maj : fin |
| survol | le point s'éclaire ; sur l'égaliseur, la lecture et la courbe propre suivent la bande survolée |

Quand deux poignées se chevauchent, c'est la plus proche qui est prise
(`plusProche`).

### La liaison et l'annulation

`liaison()` tient un réglage pour sa surface et pour sa molette : quand l'une
bouge, l'autre suit.

- Pendant le geste : `app.commit('param', m)`. Le moteur suit, rien ne se
  redessine ailleurs.
- Quand on lâche : `app.commit('quiet')`.
- L'historique (`musique.js`, `hist`) prend son instantané 350 ms après la
  rafale. Un geste s'annule donc d'un seul Ctrl+Z.

C'est vérifié en vrai (§ 8) : on tire, on Alt-tire, on molette, on
double-clique, puis on annule, et l'on retrouve l'état d'avant le
double-clic.

## 5. L'exactitude : les courbes contre le navigateur

`appareils/calcul.js` reprend les formules du moteur :

- les coefficients biquad de la spécification Web Audio,
  <https://webaudio.github.io/web-audio-api/#filters-characteristics>. Le
  texte a été relu dans la source de la spécification, `index.bs` du dépôt
  WebAudio/web-audio-api, version du 27/08/2026 ;
- les cas limites de Chromium, `third_party/blink/renderer/platform/audio/biquad.cc` ;
- la courbe de `DynamicsCompressorNode` telle que Chromium la calcule :
  `dynamics_compressor.cc`, fonctions `KneeCurve`, `Saturate`, `KAtSlope`.

L'essai `essai_calcul.mjs` (dans `/tmp/claude-0/odio_dev/`, hors du dépôt) tourne dans Chromium,
le moteur même de la page.

### 5.1 Les biquads

Le banc de mesure :

- 40 réglages tirés par type, à 44,1 et 48 kHz ;
- les réponses comparées à `BiquadFilterNode.getFrequencyResponse` sur 300
  fréquences, en écartant les points sous −80 dB.

Écart maximal mesuré :

| type | 44,1 kHz | 48 kHz |
|---|---|---|
| passe-bas | 0,00001 dB | 0 dB |
| passe-haut | 0,00001 | 0,00001 |
| passe-bande | 0,00001 | 0,00001 |
| coupe-bande (au fond du creux) | 0,0019 | 0,0006 |
| cloche | 0,00001 | 0,00001 |
| plateau grave | 0 | 0 |
| plateau aigu | 0 | 0 |

Ce que cela implique pour ODIO :

- **Le Q d'un passe-bas ou d'un passe-haut est en décibels.** Dans la
  spécification, ces deux types emploient α_QdB = sin ω0 / (2 · 10^(Q/20)).
  La bosse à la coupure vaut donc exactement Q dB.
  - Le Butterworth (Q linéaire 0,71) s'écrit −3 dB. Les coupes de
    l'égaliseur se règlent en Q linéaire, converti par 20·log10(Q) (§ 6).
  - Le filtre de l'arc de la sortie (`moteur.js`, `master`) pose
    `Q: Math.SQRT1_2` en le croyant Butterworth. Il donne en fait une bosse
    de +0,7 dB. C'est un détail, laissé tel quel.

### 5.2 Le compresseur

Le banc de mesure :

- un sinus de 1 kHz à crête connue traverse un `DynamicsCompressorNode`, hors
  temps réel (48 kHz, 1,5 s) ;
- on mesure la crête de sortie sur les 300 dernières millisecondes.

Résultat : 35 mesures (7 réglages × 5 niveaux). L'écart reste **sous 0,31 dB**,
et il est nul sous le seuil. Le reste vient de l'ondulation de la détection
crête à crête (le `sin` de Chromium).

Trois faits mesurés, qui changent la façon de dessiner :

1. **Le genou commence au seuil** et finit à seuil + genou ; il n'est pas
   centré sur le seuil. C'est la règle de la spécification (« From the
   threshold up to the knee end threshold ») et le `KneeCurve` de Chromium.
2. **Le nœud ajoute un gain de rattrapage automatique** :
   (1 / courbe(0 dBFS))^0,6, d'après la spécification (« Computing the makeup
   gain »), confirmée par la mesure.
   - Exemple : seuil −24, taux 4, genou dur. Une entrée à −36 dB sort à −25,2
     dB, soit +10,8 dB sans rien compresser.
   - Ce rattrapage dépend du seuil, du taux et du genou. Une poignée XY
     « posée sur la courbe de sortie » se déroberait donc sous la main.
   - C'est pourquoi la surface trace la courbe de la **détection** (ce que fait
     Pro-C), et écrit le rattrapage à part.
3. **`reduction` de Chromium ne compte pas le rattrapage**. Au repos, il lit
   −0,17 dB. La spécification, elle, compte le rattrapage dans le
   *metering gain*. Le mètre suit Chromium, ce que la page lit vraiment.

La courbe qu'ODIO_01 dessinait dans le nodal (`odio/effects/comp.js`,
`compressorCurve`) a un genou quadratique centré et pas de rattrapage. Avec
les réglages par défaut de Comp, l'écart va jusqu'à une dizaine de dB.
**Le nodal a suivi le 05/10 au soir.** Sa surface COMP (`machines/blocks/registry.js`)
trace maintenant `compresseur` de `appareils/calcul.js`, plus le gain du module : la
courbe de SORTIE que le moteur applique, rattrapage compris : le geste du nodal ne
s'accroche pas à la courbe (`corps.js`, `surface` : l'horizontale pose le seuil, la
verticale dose le taux en relatif), le rattrapage peut donc la déplacer sans rien
dérober à la main. Essai (Chromium, hors temps réel, le `CompEffect` même du moteur,
5 réglages × 9 niveaux d'entrée, dont les défauts de Comp et 20:1 au seuil −40) :

- le dessin contre la formule : 0,001 dB ;
- le dessin contre un signal **constant** (`ConstantSourceNode`, que le détecteur
  voit sans ondulation) : 0,002 dB au plus — la loi statique est exacte ;
- le dessin contre un sinus de 1 kHz (la méthode ci-dessus) : 0,59 dB au plus, à
  20:1 et 30 dB au-dessus du seuil ; la sortie mesurée est toujours un peu plus haute,
  l'ondulation de la détection entre deux crêtes ;
- l'ancienne courbe contre le signal constant : 11 dB aux défauts, 23,8 dB au plus.

### 5.4 L'EQ-3 du nodal (06/10)

La surface EQ-3 du nodal (`machines/blocks/registry.js`, `eqSurface`) traçait la réponse de
son **jumeau** : un `EqEffect` (`odio/effects/eq3.js`) posé sur un `OfflineAudioContext` qu'on
ne rend jamais (`nodal.js`, `jumeau`), lu par `getFrequencyResponse`. Ses réglages partent par
`setTargetAtTime` ; sans rendu, les biquads gardent leurs valeurs d'office. **Mesuré : la
courbe restait plate (0 dB) quels que soient les réglages**, jusqu'à 30,7 dB du son rendu
(grave, médium et aigu à +18).

Elle lit maintenant la loi de la vue Instruments, `appareils/calcul.js` : les trois étages de
l'`EqEffect` (plateau grave à `LOW_CORNER`, cloche à `midHz` et `width`, plateau aigu à
`HIGH_CORNER`), leurs décibels ajoutés, à la fréquence d'échantillonnage du moteur (le
jumeau la prend du moteur, et se refait si elle change).

L'essai (Chromium, hors temps réel) : la courbe que la surface trace vraiment, relevée sur un
faux contexte de dessin, contre un sinus rendu à travers l'`EqEffect` du moteur (valeur
efficace contre le même sinus sans lui) ; 6 réglages (d'office, chaque bande seule, les
bornes ±18 avec la largeur 0,3 et 4), 16 points chacun de 20 Hz à 20 kHz, à 48 et 44,1 kHz :
**0,018 dB d'écart au plus** sur 192 points. La mesure par crête d'échantillons donnait
jusqu'à 1,1 dB à 8 kHz (six échantillons par période) : c'est la mesure qui se trompait, pas
la loi.

### 5.5 Les tables de saturation

Pour la distorsion du studio, la courbe dessinée est la table même que reçoit
le `WaveShaperNode`, lue comme le nœud la lit : interpolation linéaire. On la
fabrique avec la fonction du moteur (`distCurve`, exportée pour l'occasion).
Pour Satura et Crush, on dessine la fonction d'ODIO (`saturate`,
`quantize`). Pour le Filtre drive, la table de son drive (`makeDriveCurve`).

## 6. Ce qui change dans le moteur (`musique/moteur.js`, avec parcimonie)

- **`FX.eq` passe à cinq étages.**
  - Coupe-bas (`hpo`, `hpf`, `hpq`), plateau grave, cloche (son Q devient
    réglable : `mq`, 0,9 par défaut, la valeur fixe d'avant), plateau aigu,
    coupe-haut (`lpo`, `lpf`, `lpq`), puis le gain de sortie `out`.
  - Une coupe éteinte **sort du trajet** : on recâble, sans passe-tout, et
    rien ne tourne la phase.
  - Un projet d'avant n'a aucun de ces réglages. Il prend les défauts (coupes
    éteintes, Q 0,9, sortie 0) et **sonne exactement pareil**.
  - Les six réglages d'avant restent en tête de la liste
    (`modules.js`) : la tuile du nodal garde son ordre de rails.
  - `AUTOMATABLE.eq` gagne `mf`, `hpf` et `lpf` (des AudioParam du moteur).
  - Le serveur (`server/tools/music.py`) ne valide que la sorte d'un module,
    pas ses clés : rien à changer.
- **`FX.comp`** expose `reduction()`, la réduction lue sur le nœud.
- **Les sondes** : `Graph.sonde(id, côté, fft)` et `Engine.sonde`.
  - Une sonde est un `AnalyserNode` piqué en dérivation sur l'entrée ou la
    sortie d'un module.
  - `wire()` débranche toutes les sorties ; les sondes s'y rebranchent, sur
    le nœud du moment (`brancherSondes`). Celle d'un module retiré s'en va.
  - FFT de 8192 pour un spectre : six hertz par case à 48 kHz, ce que le
    grave d'un égaliseur demande. Lissage 0,7.
  - `Graph.reduction` / `Engine.reduction`, pour le mètre.
- **`distCurve`** est exportée.

Dans `musique/odio/` : `eq3.js` exporte ses coudes, `filter.js` sa table de
drive. Ces deux changements sont marqués `SHOWRUNNER :` et notés dans
`PROVENANCE.md`.

## 7. Les fichiers

| fichier | rôle |
|---|---|
| `musique/appareils/calcul.js` | le calcul, sans DOM : biquads, compresseur, tables, réverbération |
| `musique/appareils/surface.js` | l'écran, les gestes, la liaison réglage ↔ surface ↔ molette, les icônes, les choix liés |
| `musique/appareils/egaliseur.js` | Égaliseur, EQ-3, correcteur de la Table de mix |
| `musique/appareils/dynamique.js` | Compresseur, Comp |
| `musique/appareils/filtres.js` | Filtre, Filtre drive, le filtre des synthés |
| `musique/appareils/saturation.js` | Distorsion, Satura, Crush |
| `musique/appareils/espace.js` | Réverbération, Réverbe, Délai, RTT-01, Chorus |
| `musique/appareils/instruments.js` | Synthé, Analog, Numérique, Basse acide (filtre, enveloppe, ondes) |
| `musique/appareils/index.js` | le registre (`appareil(app, m)`) ; pose `appareils.css` |
| `musique/appareils/appareils.css` | le dessin, sur les seuls jetons |
| `musique/rack.js` | appelle `appareil()`, avec repli sur les molettes ; `frame()` les anime ; le départ de l'échantillonneur se tire ; les petits dessins figés du Synthé sont retirés |

## 8. Vérifié en vrai

Le portail a tourné en local : port 8793, données temporaires, porte coupée
(`"auth": false`). Les essais ont été faits dans Chromium 141 sans affichage
(Playwright 1.56, rendu logiciel). Les captures sont dans
`/tmp/claude-0/odio_dev/` :

- `avant_sombre.png` : la vue Instruments avant ;
- `final_{dark,light}_page.png`, `final_*_chaine.png`, `final_*_eq.png`,
  `final_*_comp.png` : une piste neuve, « Essai appareils » (Analog), avec un
  égaliseur et un compresseur dans sa chaîne, le morceau qui joue ;
- `revue/n_*.png`, `revue/o_*.png` : chaque module à ×2, en sombre et en
  clair, transport en marche (spectres, historique du compresseur) ;
- `i*.png` : les synthés.

Les essais (leurs scripts sont dans le même dossier, hors du dépôt) :

- `essai_calcul.mjs` : les courbes contre le navigateur (§ 5) ;
- `essai_gestes.mjs` : les gestes et l'annulation. Le point 3 tiré de 60 px à
  droite et 30 px vers le haut donne mf 1000 → 2565 Hz et mg 0 → +9,8 dB.
  Alt-tirer et la molette règlent le Q. Une coupe éteinte qu'on tire
  s'allume. Le double-clic remet les défauts, et Ctrl+Z revient d'un geste.
  Les molettes suivent. Pour le compresseur, S et T se tirent séparément ;
- aucune erreur de page sur l'arrangement, la console et le nodal.

Sans affichage, la page tourne à une dizaine d'images par seconde. Dans les
captures, l'historique du compresseur est donc en marches d'escalier ; à
60 images par seconde, il est continu (il avance au temps, pas à l'image).

## 9. Ce qui reste

- ~~**Le nodal** dessine encore son propre EQ-3~~ : il lit `appareils/calcul.js`
  depuis le 06/10 (§ 5.4), comme sa courbe de compresseur (§ 5.2). Ses autres
  surfaces devraient lire `appareils/calcul.js` elles aussi.
- **L'égaliseur** pourrait aller plus loin :
  - un type par bande (plateau ↔ cloche) ;
  - des coupes à 24 et 48 dB/oct. (des biquads en cascade, avec les Q de
    Butterworth) ;
  - huit bandes, et un double-clic qui en crée une (Pro-Q, EQ+) ;
  - le spectre d'entrée à côté de celui de sortie ;
  - la couleur par bande de Logic.
- **Le compresseur** : la chaîne latérale (le nœud n'en a pas) ; l'attaque et
  la relâche ne se voient que dans l'historique.
- **La réverbération** : une décroissance par fréquence (Pro-R) demanderait
  un autre moteur ; l'amorti est un passe-bas fixe.
- **Les pads** : glisser un son sur un pad ; voir la vélocité de la dernière
  frappe.
- **Le tactile** : pincer pour le Q sur tablette (`commun/molette.js`).
- **Les manuels** (§ 3) : relire depuis le PC les points marqués *à relire*
  (Auto Filter, Delay, Analog / Polysynth).
- **Cal** doit voir les surfaces à 60 images par seconde dans son navigateur,
  avec un vrai morceau qui joue.
