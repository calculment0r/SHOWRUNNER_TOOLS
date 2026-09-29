# Provenance — `musique/odio/`

Les instruments et effets d'ODIO, le prototype de Cal, repris dans le
studio du portail à sa demande (29/09/2026 : « on peut reprendre les
trucs qu'on avait trouvés pour le proto avec des synthés, reverb, etc. »).

- Source : dépôt **privé** `calculment0r/ODIO_01`, commit `6d8a7ed`
  (« HANDOFF : le site est en ligne… »), cloné en lecture seule sur DGX2
  dans `/tmp/odio01`. SHOWRUNNER_TOOLS est public : la reprise est signalée
  à Cal. Rien d'autre n'est repris (ni polices, ni handoff de design, ni
  interface).
- Chemins d'origine : `packages/engine/src/` — `timing.ts`, `types.ts`,
  `effects/{types,base,reverb,chorus,delay,comp,eq3,filter,drive,crush,table,volume}.ts`,
  `instruments/{analog-synth,acid-bass,drums-voices,rhythm-box,plaits-synth,plaits-wasm}.ts`.
- Conversion : `node:module` `stripTypeScriptTypes(source, { mode: 'strip' })`
  (Node 22 de DGX2, sans npm) — syntaxe effaçable seulement, chaque fichier
  vérifié par `node --check` ; les blancs laissés à la place des types
  restent (les numéros de ligne correspondent à l'original). Script :
  `odio_strip.mjs` (scratchpad de la session du 29/09).
- **Plaits** : `instruments/plaits-wasm.js` porte en base64 le module
  WebAssembly compilé depuis les sources d'Émilie Gillet (Mutable
  Instruments, `pichenettes/eurorack` dossier `plaits` et `pichenettes/stmlib`),
  **licence MIT** — voir `packages/engine/wasm/vendor/PROVENANCE.md` du
  dépôt d'origine, qui garde les notices.
- Non repris : `drum-kit.ts` et `soundfont.ts` (ils téléchargent leurs
  échantillons par `smplr` depuis le réseau : pas de téléchargement ici),
  `aimant.ts` et `alchimie.ts` (un filtre et un volume dont le seul réglage
  en plus règle la scène du prototype, pas le son), `output.ts` (la sortie
  d'ODIO est celle du studio), le séquenceur, le transport et le mixeur
  (le studio a les siens).

## Ce qui a été changé dans les fichiers repris

Chaque changement est marqué `SHOWRUNNER :` dans le code.

| fichier | changement | pourquoi |
|---|---|---|
| `instruments/analog-synth.js` | la chute de l'enveloppe (`linearRampToValueAtTime(0, relâchement + release)`) | le gain tenait le maintien jusqu'à l'arrêt des oscillateurs, qui coupaient net : un clic en fin de note |
| `instruments/analog-synth.js` | `noteOff(note, instant)` | relâcher une note jouée au clavier ou en MIDI, dont la durée n'est pas connue à l'attaque (le contrat d'ODIO n'a que `allNotesOff`) |
| `instruments/acid-bass.js` | `noteOff(note, instant)` | idem, pour la voix monophonique |
| `instruments/plaits-synth.js` | messages `relacher` et `ping` du worklet, méthodes `noteOff` et `ping` | relâcher à la main ; l'export hors temps réel attend que les notes postées au worklet soient arrivées (MessagePort garde l'ordre) |
| `effects/reverb.js` | `flush()` | l'export hors temps réel ne peut pas attendre les 90 ms que la réverbe laisse au geste avant de refaire sa réponse |

L'adaptateur qui présente ces pièces comme des modules du studio est dans
`moteur.js` (`odioSource`, `odioEffect`) ; leurs réglages sont lus sur
leurs descripteurs (`getParameters`) dans `modules.js`.

# Provenance — `musique/banc.js` (le banc sous le nodal)

Demandé par Cal le 29/09 : « en bas du nodal, une image simplifiée de la
timeline avec les pistes, et les lanes d'ODIO_01 ; les attracteurs se
tirent de ce panneau vers le canvas ».

- Source : le même dépôt, même commit. `apps/studio/src/banc/logique.ts`
  (les lanes, la géométrie `ecartBoite`, `poids`, `operateurs`, `membres`,
  les deux têtes) et `apps/studio/src/banc/Banc.tsx` (les gestes et le
  dessin : `PPB = 9`, disque 110, anneaux 260 / 420 / 580, loi 0,25 à 4 par
  `exp(dx / 130)`, fil de Bézier à tangentes verticales, teinte
  `0,08 + 0,14 × poids`), qui tiennent les décisions n° 32 à 85 de
  `docs/logique-globale.md`. Réécrit en JavaScript sans React ; rien n'est
  copié tel quel hors ces constantes et ces formules.
- Ce qui change, et pourquoi :

| ODIO_01 | ici | pourquoi |
|---|---|---|
| le banc ne porte que les cinq lanes | au-dessus, l'arrangement en petit (sections, une rangée par piste et ses clips), à la même échelle | la demande de Cal |
| lanes RYTHME, HARMONIE, TIMBRE, ÉNERGIE, TENSION | les mêmes, hauteurs et écarts gardés ; il n'y a pas de lane « groove » ni « mélodie » dans ODIO_01 — le groove y est la facette de RYTHME (swing, densité, accents), la mélodie celle d'HARMONIE (tonalité, tension) | on prend ce qui est écrit |
| courbe ÉNERGIE de démonstration | l'arc d'énergie du projet (mêmes points) | l'arc est déjà l'énergie du morceau et pilote la sortie |
| horizons fixes par lane (104, 76, 62, 118, 88 temps) | courbes : leur dernier point ; lanes de matière : la fin de l'arrangement | les horizons d'ODIO_01 étaient ceux de son morceau de démonstration |
| tête rouge = son transport | tête rouge = le transport de la DAW (Espace) ; « marche » du banc pilote la tête qui gouverne (n° 80) | un seul temps réel dans le studio |
| blocs = une tuile par section de machine ; table `FACETTES` sur leurs contrôles | les tuiles du nodal : une section de machine y est un bloc, avec la table `FACETTES` d'ODIO_01 ; un module d'ici a la sienne (`machines/influence.js`, `FACETTES_MODULES`), **à relire par Cal** | nos modules ne sont pas ses machines ; ses machines, si |
| couleurs en dur (#3f7a9c, #6b5fa8, #b0567f, #3f8a72, #8a6f5a) | cinq jetons nommés dans `musique/nodal.css` : `--nd-ryt`, `--nd-har`, `--nd-tim`, `--nd-nrj`, `--nd-ten` — la teinte d'ODIO_01, la clarté réglée au contraste AA sur les panneaux, en sombre et en clair (29/09 ; avant : les voisines `--cy`, `--coral-3`, `--coral-2`, `--grn2`, `--coral-1`) | règle du thème : aucune couleur en dur hors des blocs de jetons ; le thème clair |
| opérateurs en lecture seule (« brancher leur effet au moteur est le chantier suivant ») | **ils agissent** : tant que la tête qui gouverne traverse le segment, chaque réglage capté joue son opérateur (`neutre + (valeur − neutre) × poids`), au temps de l'horloge audio ; à l'arrêt, tout revient ; un réglage capté deux fois joue l'opérateur de plus grand poids ; une voie d'automation garde la main ; le chiffre bouge sur la tuile (`machines/influence.js`, crochets `attracteurs :` dans `moteur.js`) | la demande de Cal du 29/09 : « relié aux machines et paramètres » |
| le plan redessiné à chaque changement de tête | les têtes glissent (une transformation par image), les courbes se découpent sous la tête rouge par un masque, le plan ne se refait que quand il change ; la couche méta vit dans le monde du nodal | la fluidité mesurée (`docs/etudes/musique_odio01.md`) |

# Provenance — `musique/jouets/` (les jouets du Playground)

Demandé par Cal le 29/09 : « on va intégrer ces nodes rigolos dans le canva.
on doit leur mettre des in et out pour pouvoir les relier, on les met dans
notre DA mais on garde le design à l'intérieur des nodes qui est bon. il faut
garder leur code d'interaction qui est cool. et le graphisme doit rester
identique dedans. »

- Source : le **« ODIO-O1 Playground »** de Cal (son fichier d'origine
  `_bundle_original.html`, déplié sur DGX2 dans
  `~/showrunner-refs/odio-o1-playground/` : `index.html`, `code.jsx`). Le
  design est celui de Cal ; la fiche de conception est
  `UI/3_machine/PLAYGROUND.md` du dépôt ODIO_01 (`/tmp/odio01`, commit `6d8a7ed`).
- **Porté, pas embarqué.** Le Playground n'est pas un composant React qu'on
  monterait : c'est une classe `Component extends DCLogic` rendue par un
  gabarit `<x-dc>` (`sc-for`, `sc-camel-on-*`) et le moteur de l'outil de
  conception qui l'a produit (69 Ko de script, licence non dite), sur React
  18. Embarquer React ne suffirait pas, et React n'y dessine que le cadre
  (en-tête, rangée de molettes) — ce que Cal veut dans notre DA. L'intérieur
  est du Canvas 2D pur : il est repris tel quel en module ES (`scenes.js`),
  sans étape de construction ni dépendance réseau.
- Ce qui est repris **mot pour mot**, jouet par jouet : l'état de départ
  (`initSim`), la part de `phys()`, le dessin `d_<id>`, les branches de
  `cvDown` (geste, glissé, relâché), `newBall`, `fireIV`, `fireMsl`,
  `slash`, les aides `SIDES`, `noteSize`, `noteCol`, `flipPivot`,
  `flipTip`, `bubble`, `ro`, `seg`, `circ`, `poly`, `pegs`, `targetNotes`,
  les tables `PINS`, `SLING`, `NEWT_PC`, `SCALES`, les réglages `BLOCKS`
  (clés, bornes, défauts), la boucle unique (`tick` : dt plafonné à 50 ms,
  DPR plafonné à 2) et le canvas des billes de la fontaine (`fxRef`).
- La police des scènes, **IBM Plex Mono** (IBM, licence SIL OFL 1.1 :
  `jouets/plex/OFL.txt`), graisses 400 et 500, sous-ensembles latin et
  latin-ext : les fichiers et les plages Unicode que le Playground charge.

Ce qui change, marqué `SHOWRUNNER :` dans `scenes.js` et `index.js` :

| Playground | ici | pourquoi |
|---|---|---|
| couleurs écrites dans `themes.dark` et en `rgba(…)` | jetons `--jo-*` de `jouets.css`, lus à l'exécution ; `rgba` fait depuis le jeton ; `noteCol` = douze jetons `--jo-note-N` (les mêmes chaînes `hsl(…)`) ; le pain du GRILLE–PAIN interpolé entre deux jetons | règle du thème : aucune couleur en dur ; le rendu est le même au pixel |
| un seul composant, un `this.sim` pour les quatorze | un objet par jouet posé (`Jeu`), `S[type]` son état ; `PINS`, `SLING`, les plots du PACHINKO copiés par jouet | on peut en poser plusieurs |
| `playing` et `bpm` du Playground | le transport de la DAW (`engine.running`, `P.bpm`) | un seul temps dans le studio |
| AIMANT : `mg.t += dt / période` en lecture | la phase lue sur le transport (1, 2, 4 ou 8 mesures de la mesure du projet) | calé sur la DAW ; le filtre suit la même formule, à l'export aussi |
| LANCE–PIERRE et NAVETTE lisaient tonique et gamme sur NINJA | leurs propres réglages Tonique et Gamme (mêmes défauts) | chaque jouet est un module à part |
| la fontaine : ses billes rebondissent sur les blocs du Playground et mélangent leurs réglages | sur toutes les cartes du nodal ; un jouet : ses réglages du Playground ; un autre module : ses réglages continus sauf les niveaux en dB ; la console (tranches, bus, sortie) jamais ; rien n'est écrit dans le projet, tout revient | les modules d'ODIO ne sont pas des jouets ; un niveau tiré au hasard jusqu'à +6 dB n'est pas un geste de timbre |
| `o.y > 2400` (bille perdue) | 3000 px sous la fontaine | le même écart : la fontaine du Playground est à −600 |
| `d_pong` : un anneau à la couleur de `TN[…]` | retiré | `TN` n'existe pas dans `d_pong` : « TN is not defined » à chaque rebond, ce qui coupait aussi la fin de l'image et le dessin des blocs suivants (vu dans Chromium, 29/09) |
| `cvDown` de NAVETTE : `ev.button` | `e.button` | `ev` n'existe pas à cet endroit : le clic ne tirait jamais |
| `panDown` et `blockDown` donnent l'impulsion de la SECOUSSE | le déplacement de la vue du nodal et de la carte par son en-tête | le même geste |
| la propagation du geste arrêtée (`stopPropagation`) | elle continue jusqu'à la carte, qui se choisit | le nodal ignore déjà les gestes faits dans une carte |
| — | `this.out(note, vélocité)` là où le Playground montre une note (bulle, tranche, anneau) ; `trigger()` : ce que fait une note reçue ; `modOut()` : la valeur émise | les ports, demandés par Cal (voir `docs/etudes/musique.md`, § 7) |

Le cadre de la carte (en-tête, ports, molettes, choix, sélection, menu) est
celui du nodal ; les molettes du Playground (`dial`, `enc`, `slider`) sont
remplacées par les nôtres. Le son des quatre jouets qu'on traverse suit la
décision d'ODIO_01 (`apps/studio/src/rack.ts` : AIMANT, RESSORT, REEL-2,
ALCHIMIE « ne déclenchent rien, ils TRAITENT » ; `effects/aimant.ts` étend le
filtre, `alchimie.ts` le volume) : `jouets/son.js`.

# Provenance — `musique/nodal.js`, `musique/nodal.css`, `musique/machines/` (le canvas d'ODIO_01)

Demandé par Cal le 29/09 : « j'ai pas mon système de drag and drop super
qu'on avait dans ODIO-O1 […] on avait aussi des machines déjà faites… un
générateur de planogramme etc… des fonctions pour mettre en forme les nodes
avec la touche T […] il faut le traduire dans notre canva ». L'inventaire,
fonction par fonction, est `docs/etudes/musique_odio01.md`.

- Source : le même dépôt privé `calculment0r/ODIO_01`, commit `6d8a7ed`,
  `apps/studio/src/`. SHOWRUNNER_TOOLS est public : la reprise est signalée à
  Cal.
- **Repris par conversion** (`node:module` `stripTypeScriptTypes`, mode
  « strip », les blancs gardés : les numéros de ligne correspondent), deux
  lignes d'en-tête `// ODIO — porté de …` en tête de chaque fichier :
  `interaction/{drag,gesture,knob,layout,patch,ports,liaisons,sauts,ensemble,aligner,liens-knob}`,
  `tile/{shape,measure,legible}`, `design/{tuning,machines-config}`,
  `canvas/camera`, `blocks/{machines-data,machines,planche,assemblages,agencements,table-mix,minima,filtre,registry}`,
  `banc/logique`, `plano/gabarit`, `moteur/scale` (depuis
  `packages/engine/src/scale.ts`). Les imports du paquet `@odio/engine` sont
  réécrits : `blocks/machines.js` → `../../odio/instruments/rhythm-box.js`,
  `blocks/registry.js` → `../moteur/index.js` (neuf : il ré-exporte ce que
  le registre lit dans `musique/odio/`), `moteur/scale.js` →
  `../../odio/timing.js`.
- **Réécrits sans React** (la logique gardée, le rendu en DOM) :
  `machines/corps.js` (`components/BlockBody.tsx`, `BlockSurface.tsx`,
  `ParamRow.tsx`, `Promoted.tsx`, `ParamGlyph.tsx`, `Groove.tsx`,
  `MiniSlider.tsx`, `Keys.tsx`), `machines/panneau.js` (`MachinePanel.tsx`,
  `Knob.tsx`), `machines/catalogue.js` (`Catalogue.tsx`, `Palette.tsx`,
  `CableMenu.tsx`, `blocks/catalogue-entrees.ts`), `machines/plano.js`
  (`pages/Plano.tsx`, `plano/registre.ts`, `plano/parametres-moteur.ts`),
  `nodal.js` (`App.tsx` pour le canvas, `Tile.tsx`, `Ports.tsx`,
  `BoundsHandles.tsx`, `TeinteBtn.tsx`, `MachineDesignPanel.tsx`,
  `Seuils.tsx`), `interaction/clavier-ordinateur.js` (`COMPUTER_KEYS`).
- **Écrits ici**, parce qu'ODIO_01 n'a pas de projet serveur :
  `machines/tuiles.js` (une tuile = un module, une section de machine ou un
  bloc sans son — la table des tailles vient du `CATALOGUE` de `rack.ts`, le
  branchement des contrôles de `MACHINE_ENGINES`, la phrase d'usine de
  `rack.ts phraseDeMachine`, les voix de `VOIX_DES_PANNEAUX`),
  `machines/liens.js` (les règles de `liaisons.ts` sur nos câbles),
  `machines/influence.js` (l'effet des attracteurs sur le son).

Ce qui change, marqué `SHOWRUNNER :` dans les fichiers repris :

| ODIO_01 | ici | pourquoi |
|---|---|---|
| `tile/measure.ts` : Microgramma, gravure en capitales sans accents | le nom d'un bloc en `--f-ui` 600 (13, 11 ou 9 px selon l'en-tête : `nomDeCarte`), celui d'une section de machine en Azeret Mono capitales, Venus Rising pour les grandes valeurs ; `engrave` = capitales (l'ancienne gardée sous `engraveMicrogramma`) | les fontes du portail ; les cartes du nodal d'avant (29/09) |
| `tile/legible.ts` : repli en Microgramma | Venus Rising ; le nom mesuré dans la fonte de la tuile | idem |
| `interaction/patch.ts` : `JUMP_COLORS` en hexadécimal | des noms de jetons (`amb`, `coral-2`, `grn2`, …) | aucune couleur en dur |
| `banc/logique.ts` : couleurs des lanes et réserve des anneaux en dur | les jetons nommés `--nd-*` de `nodal.css` (sombre et clair) | idem |
| `TeinteBtn.tsx` : quinze teintes en hexadécimal | quatorze jetons (sans l'orange, qui est l'action) | idem |
| thème clair / sombre, ambre pour ce qu'on règle | **l'habit du portail** (29/09, « on repasse tout dans notre thème ») : une tuile est une carte du nodal d'avant (coins de 12 px, panneau relevé, point d'accent, nom en `--f-ui`, `.lbl` à droite) ; ses molettes sont le cadran du rack (`ui.js` `dial`), ses rails le curseur de l'arrangement, ses faders ceux de la console, ses pas ceux du séquenceur ; l'accent `--k` est celui de la piste ou du module ; sélection, cadre, poignées, menus ceux d'Idéation et de `commun/menu.js` ; les fils ceux de `commun/wire.js` ; filets en `box-shadow` / `outline` ; le thème clair par les jetons | les règles dures du portail ; la demande de Cal |
| `Ports.tsx` : `cablePath`, trait d'un pixel | la courbe de `commun/wire.js` (`wireD`), le trait de 2 dans la teinte de la source ou de la piste ; épaisseur, tirets et étiquettes en pixels d'écran par `--iz` (`vector-effect` ne tient pas sous une transformation CSS, mesuré) | « les fils ne sont plus en screen space » (Cal, 29/09) |
| `Palette.tsx` : une liste à elle | le menu commun (`commun/menu.js`) | une seule vérité des menus |
| les tuiles posées en espace écran, re-rendues par React à chaque image de caméra | un monde transformé (`translate` + `scale`) ; chaque tuile mise en page à l'échelle apparente dans un calque réduit de `1 / échelle` ; remise en page par une file (≈ 8 ms par image, les visibles d'abord) ; ce qui garde une taille d'écran (bornes, menus, poignées) se contre-échelonne par `--iz` | la fluidité mesurée ; la règle sémantique (`uiK`, `retrait`, `apparence`) est la même |
| l'état d'une scène dans React (`blocks`, `links`, `names`, `exposed`, `split`, `ports`, `liensKnob`) | dans le projet : la boîte d'un module (`x, y, w, h`), les sections d'une machine dans son module porteur (`m.mach.sec`, ses contrôles `m.mach.ctl`), les blocs sans son dans `p.nodal.blocs`, le reste dans `p.nodal` (`expose`, `split`, `noms`, `ports`, `voix`, `liens`, `liensKnob`, `gabarits`) | le serveur garde le projet ; `server/tools/music.py` n'accepte dans `p.modules` que ce qui se branche au moteur |
| une machine = son propre rack | une machine à voix d'instrument devient une PISTE de la DAW (sa source porte la machine, sa phrase d'usine est un clip de quatre mesures) ; un effet (TAPE-3, PLATE-24, VARIMU-70) un module libre ; KBD-01, SEQ-01, INTERACTIONS des blocs du nodal | un seul moteur, une seule console |
| les notes d'un clavier : `links` du rack | `p.nodal.liens` (un bloc n'est pas un module) ; elles arrivent au même port losange que les notes des jouets | « les machines et les jouets se relient de la même façon » |
| ⌃Z : l'historique de la scène | l'annulation commune du portail (`commun/undo.js`, un instantané du projet par geste, `musique.js`), lue par la lettre (AZERTY) | un seul ⌃Z, le même partout |
| Suppr sur un instrument : le bloc part | une source ou une tranche de piste : toute sa piste, sans confirmation (`removeTracks`, Ctrl+Z la rend) | une piste sans sa source n'existe pas |
| clic : remplacer ; ⌃ ajoute, ⌥ retire (clic et cadre) | Maj ajoute, Ctrl/⌘ ajoute ou retire, ⌥ retire ; un clic sans glisser sur une tuile d'une sélection plus large ne garde qu'elle | la demande de Cal (29/09) : « les standards » |
| le tracé d'ordre au clic milieu : sur un panneau de machine EN ÉDITION seulement (`MachinePanel.tsx` `tracerOrdre`, l. 830-871 ; `App.tsx` `onMiddleDown`, l. 577-606) | gardé tel quel pour les machines ; porté aussi sur les RÉGLAGES de chaque tuile du nodal, hors édition (`nodal.js` `tracerOrdreTuile`, `corps.js` `promoteExposed`) ; ailleurs le clic milieu déplace la vue | « on définissait à la volée quel paramètre est le plus important à conserver lors du zoom sémantique » (Cal, 29/09) — voir `docs/etudes/musique_odio01.md` § 5 |
| clic droit sur un câble : `CableMenu.tsx` (deux entrées) | le menu commun du portail (`commun/menu.js`), les deux entrées d'ODIO_01 en tête ; chaque zone a le sien | « plus de clic droit du navigateur » (Cal, 29/09) |
| le clavier reste au canvas dès qu'on y touche | T, G, F, Suppr et les touches du clavier désigné seul valent quand le dernier geste a eu lieu dans le canvas ; ailleurs, les lettres restent au clavier MIDI de la DAW | les deux conventions cohabitent |

**Non repris** : le compagnon de PLANO (appel à l'API d'Anthropic avec une
clé), l'écriture sur GitHub, la page Morceaux (nos projets en tiennent lieu),
la table de mix `mix` (TASCAM Model 12), le bouton des sons par machine
(`SonsBtn.tsx`), le bloc TEMPO et le sous-tempo, le MIDI entrant vers les
claviers posés, la butée des sections en édition (`respecteMinima` : le
panneau publie ses minima, le canvas ne les lit pas encore), la tête dans les
pads du groove. Les réglages de conception d'ODIO_01 (`odio.machines` :
agencements enregistrés, cotes retouchées, ordre d'exposition) restent comme
chez lui dans le navigateur, pas dans le projet.
