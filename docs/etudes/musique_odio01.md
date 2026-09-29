# ODIO_01 → le nodal d'ODIO : l'inventaire, ce qui est porté, ce qui manque

29/09/2026. Demande de Cal : « j'ai pas mon système de drag and drop super
qu'on avait dans ODIO-O1 non ? je vois l'attracteur mais il est pas relié aux
machines et paramètres en fait.. on avait aussi des machines déjà faites… un
générateur de planogramme etc… des fonctions pour mettre en forme les nodes
avec la touche "T" etc etc. le zoom sémantique est censé afficher plutôt les
éléments pour faire du son et pas les titres… regarde ce qu'on a fait sur le
dépôt.. il faut le traduire dans notre canva… la timeline de l'arrangeur est
super fluide mais celle du canva non… regarde comment la logique des deux
panels nodal et timeline en dessous est reliée par nos attracteurs. »

Source : dépôt privé `calculment0r/ODIO_01`, commit `6d8a7ed`, cloné sur
DGX2 dans `/tmp/odio01`. Les chemins ci-dessous sont relatifs à
`apps/studio/src/` sauf mention. La provenance fichier par fichier est dans
`musique/PROVENANCE.md`.

## 1. L'inventaire

« Avant » : le nodal du 29/09 au matin (`git HEAD` b648cc9 : cartes de
236 px, glisser le fond = se déplacer, un menu de modules, un banc dont les
attracteurs ne faisaient que lire). « Maintenant » : `musique/nodal.js`,
`musique/banc.js`, `musique/machines/`.

### Le canvas et ses gestes

| # | ODIO_01 | fichier | avant | maintenant | écart |
|---|---|---|---|---|---|
| 1 | clic milieu glissé : se déplacer, partout (sauf une borne, une molette liable, une machine en édition) | `App.tsx` `startPan` (l. 526), `onMiddleDown` (l. 577-606) | glisser le fond (gauche) | porté ; 29/09 : une exception de plus, déclarée au même endroit — les réglages d'une tuile, où il trace (§ 5) | — |
| 2 | molette : zoom ancré au curseur, `0,9988^deltaY`, bornes 0,05 – 2,8 | `canvas/camera.ts` `zoomAt` | ×1,12 par cran, 0,3 – 2 | porté | — |
| 3 | plancher de lisibilité : la plus petite échelle où chaque tuile dit son nom, son réglage exposé et sa valeur ; on recule encore ×3 sous le plancher | `App.tsx` `zoomFloor`, `tile/legible.ts`, `camera.ts` `plancherCamera` | — | porté | — |
| 4 | sous le plancher, la tuile garde sa mise en page et rapetisse (`uiK`, `retrait`) | `App.tsx` | — | porté (calque réduit de `1 / uiK`) | — |
| 5 | glisser le fond : rectangle de sélection, ⌃ ajoute, ⌥ retire, effleurer un groupe le prend | `App.tsx` `startMarquee` | — | porté ; 29/09 : Maj ajoute, Ctrl/⌘ inverse ce qu'il touche, ⌥ retire | l'usage demandé par Cal remplace « ⌃ ajoute » |
| 6 | clic : choisir ; le second clic sur un bloc d'un ensemble ENTRE dans l'assemblage | `App.tsx` `selectBlock` | clic = choisir | porté ; 29/09 : Maj+clic ajoute, Ctrl/⌘+clic ajoute ou retire, ⌥ retire ; un clic sans glisser sur une tuile d'une sélection plus large ne garde qu'elle | — |
| 7 | en-tête glissé : déplacer la sélection, le groupe, la machine soudée entière (hors édition) | `App.tsx` `startMove`, `Tile.tsx` | glisser la carte seule | porté | — |
| 8 | ⌥ glissé : dupliquer, les câbles internes suivent, les sorties sont gardées | `App.tsx` `duplicate`, `interaction/patch.ts` `duplicateLinks` | « Dupliquer » d'un effet | porté ; une source duplique sa PISTE | — |
| 9 | double-clic sur l'en-tête : taille d'origine ; sur le nom : renommer (gravé, 18 signes) | `Tile.tsx`, `App.tsx` `resetSize`, `renameBlock` | — | porté | — |
| 10 | arêtes et coins : redimensionner, les voisins collés suivent (⌥ découple) ; dans un groupe : séparateurs ; pourtour d'un groupe : tout l'ensemble à l'échelle ; une machine hors édition ne s'étire que par son pourtour | `App.tsx` `startResize`, `interaction/layout.ts` `resizeCoupled`, `moveDivider`, `interaction/ensemble.ts` `scaleEnsemble` | largeur fixe | porté | la butée des sections en édition (`respecteMinima`) n'est pas lue |
| 11 | aimantation à 7 px (écran) sur les arêtes des autres tuiles, guides ; ⌥ libère | `interaction/layout.ts` `snapBox`, `snapValue` | — | porté | — |
| 12 | séparateurs d'un groupe, croisements (les deux lignes d'un geste) | `App.tsx`, `layout.ts` `listDividers`, `dividerAt` | — | porté | — |
| 13 | pourtour saisissable d'un ensemble choisi, coins à taille écran | `components/BoundsHandles.tsx`, `App.tsx` `startBoundsResize` | — | porté | — |
| 14 | G : grouper / dégrouper (⌥G dégroupe) ; une machine s'OUVRE (le lien de circuit reste) et se referme | `App.tsx` `toggleGroup`, `groupBlocks`, `ungroupBlocks` | — | porté | — |
| 15 | T : une machine dans la sélection → la REMONTER dans son agencement ; un bloc seul → sa taille d'origine ; sinon `tidyGroup` (redresser, resserrer, combler, jamais réordonner) | `App.tsx` `tidySelection`, `layout.ts` `tidyGroup`, `reassembleMachine` | — | porté | — |
| 16 | T en édition : optimiser (tout le bloc) ou ranger (les éléments pris) | `components/MachinePanel.tsx`, `interaction/aligner.ts` `optimiserControles`, `rangerControles` | — | porté | — |
| 17 | F : cadrer la sélection, ou toute la scène, jamais au-delà de 100 % ; cadrage à la naissance | `App.tsx` `focusOn` | « Ajuster » | porté | — |
| 18 | Suppr : un lien de molettes, sinon un câble, sinon la sélection — le câblage se RECOUD | `App.tsx` onKey, `patch.ts` `removeNodes` | le câble choisi, un effet | porté ; une source ou une tranche retire sa piste (sans confirmation depuis le 29/09 : Ctrl+Z la rend) ; le recousu suit chaque chaîne de piste (`projet.js` `recoudre`) | — |
| 19 | ⌃Z : l'historique de la scène | `App.tsx` `undo` | l'historique du projet | l'annulation commune du portail (`commun/undo.js`), un instantané du projet par geste ; Ctrl+Z, Ctrl+Maj+Z, Ctrl+Y lus par la LETTRE (juste en AZERTY) ; ↶ ↷ et le journal | un seul ⌃Z, voulu |
| 20 | double-clic sur le fond : le CATALOGUE (fenêtre, rubriques, vignette = plan réel d'une machine, détail entre / sort / taille, double-clic pose au centre, glisser pose où l'on lâche) | `components/Catalogue.tsx`, `blocks/catalogue-entrees.ts` | un menu de modules | porté (`machines/catalogue.js`) : entrées, instruments, 13 machines, Playground, effets, flux, sortie | la table de mix n'y est pas |
| 21 | un câble part d'une borne de sortie et se lâche SUR le bloc visé ; à défaut, la borne la plus proche dans 74 px ; cadre vert si la liaison se fera, rouge sinon (verdict de `liaisons.ts`) | `App.tsx` `startCable`, `porteurDe`, `verdictLiaison`, `interaction/liaisons.ts` | sortie → entrée, au pixel | porté | — |
| 22 | lâché dans le vide : la liste rapide, le bloc naît branché | `components/Palette.tsx` | un menu, branché | porté | — |
| 23 | un câble : clic le désigne, double-clic y insère un bloc, clic droit : saut ou « insérer un bloc de flux » | `App.tsx`, `components/CableMenu.tsx`, `patch.ts` `insertInto` | clic + « Couper » | porté ; 29/09 : par le menu commun (`commun/menu.js`), les deux entrées d'ODIO_01 en tête, puis « insérer un effet », « couper » ; le menu dit la chaîne que le fil sert | — |
| 24 | sauts : un carré par saut sous la borne ; saut d'office quand deux blocs se touchent ; survol : le fil ; clic : le garder affiché | `components/Ports.tsx`, `interaction/sauts.ts`, `patch.ts` `toggleJump` | — | porté | — |
| 25 | une borne glisse le long du pourtour au clic milieu, double-clic la remet ; une machine a ses bornes sur l'arête haute (entrée à 0,2, sortie à 0,8) | `App.tsx` `startPortDrag`, `defaultPortU`, `interaction/ports.ts` | bornes fixes | porté | — |
| 26 | liens entre molettes : clic milieu d'une molette à l'autre, propagation en position, sens + / −, visibles au survol seulement, nœud de 22 px, double-clic retourne, clic droit défait, Suppr | `App.tsx` `tirerLien`, `propagerLien`, `interaction/liens-knob.ts` | — | porté (molettes des machines, comme chez lui) | — |
| 27 | menu d'un ensemble : témoin (éteindre tout), ranger, remonter, conception, teinte ; machine ouverte : sa commande de remontage reste | `App.tsx`, `components/TeinteBtn.tsx` | — | porté ; teintes = 14 jetons | les SONS par machine (`SonsBtn.tsx`) ne sont pas portés |
| 28 | le nom d'une machine au-dessus d'elle, à droite, taille constante | `App.tsx` `machine-titre` | — | porté | — |
| 29 | poste de conception : la machine en édition, bord / écart en mm, enregistrer l'agencement, revenir au planogramme ; clic milieu : tracer l'ordre d'importance | `components/MachineDesignPanel.tsx`, `MachinePanel.tsx` `tracerOrdre` (l. 830-871) | — | porté ; 29/09 : le même tracé sur les réglages de chaque tuile, hors édition (§ 5) | — |
| 30 | curseur de la sémantique dans la barre ; panneau des seuils (présence relative, gel sous ×, planchers par genre de contrôle) | `components/Seuils.tsx`, `blocks/planche.ts` | — | porté | — |
| 31 | les touches de l'ordinateur jouent QUAND un clavier est désigné seul (Z S X D C V G B H N J M ,) | `App.tsx` onKey, `interaction/clavier-ordinateur.ts` | — | porté (clavier, KBD-01, SEQ-01) | — |
| 32 | le MIDI entrant joue les claviers posés | `App.tsx` `requestMIDIAccess` | le MIDI de la DAW joue la piste choisie | — | pas porté |
| 33 | témoin d'un bloc : vert quand il joue, rouge éteint, gris au repos ; clic = allumer / éteindre | `components/Tile.tsx` `ledSize` | point de couleur | porté | — |
| 34 | nom et exposé qui DÉFILENT quand ils ne tiennent pas | `Tile.tsx`, `app.css` `tile-scroll` | ellipse | porté | — |

### Les tuiles et le zoom sémantique

| # | ODIO_01 | fichier | avant | maintenant | écart |
|---|---|---|---|---|---|
| 35 | un bloc déclare, pour trois formes (bande, colonne, pavé), des emplacements ordonnés ; on s'arrête au premier qui ne rentre plus | `tile/shape.ts` `resolveSlots`, `components/BlockBody.tsx` | cartes fixes | porté (`machines/corps.js`) | — |
| 36 | quand rien ne rentre : le réglage exposé en grand (nom + valeur, pictogramme pour une forme d'onde) ou la SURFACE du bloc | `components/Promoted.tsx`, `ParamGlyph.tsx`, `BlockSurface.tsx` | de loin, le nom en grand (`lod0`) | porté : de loin, ce qui fait le son | — |
| 37 | surfaces : la courbe du filtre, de la saturation, du comp, du délai, de la réverbe, de l'EQ, du crush, du chorus, qu'on tire à la souris | `blocks/registry.ts` (`*Surface`) | — | porté, sur un jumeau hors temps réel de nos effets ODIO | — |
| 38 | la frontière dessin / réglages qu'on déplace | `BlockBody.tsx` `split` | — | porté | — |
| 39 | la boîte à rythme : tranches (tune, decay, ctrl, niveau) et pads de pas | `components/Groove.tsx` | — | porté sur le motif de la piste | la tête ne s'allume pas dans les pads |
| 40 | une section de machine : son planogramme, et quand la place manque on RETIRE par la fin de l'ordre d'importance, les survivants grandissent (planche → macros → seul) ; un nom qui ne tient plus tombe entier | `blocks/machines.ts` `planPanel`, `blocks/planche.ts`, `docs/regle-du-responsif-machine.md`, `docs/brief-zoom-semantique.md` | — | porté (`machines/panneau.js`) : mesuré à 100 % 27 molettes, 36 pads/pas, 30 noms ; à 56 % 10 molettes, 34 pads, 1 nom ; sous le plancher, 6 molettes | — |
| 41 | les gabarits : molette, sélecteur, fader, bouton / pas, pad, diode, afficheur, molette de clavier, touche, ruban, pad orbital, matrice, courbe, vumètre | `MachinePanel.tsx`, `Knob.tsx` | — | portés | — |
| 42 | les conteneurs élastiques (rangée de pas, clavier, grille de tranches) | `blocks/assemblages.ts` | — | portés | — |

### Les machines et PLANO

| # | ODIO_01 | fichier | avant | maintenant | écart |
|---|---|---|---|---|---|
| 43 | treize planogrammes cotés (MINILOGUE XD, MICROFREAK, TR-8S, SEQ-01, KBD-01, POLY-6, ACID-3, FM-6, STRINGS-4, TAPE-3, PLATE-24, VARIMU-70, INTERACTIONS) | `blocks/machines-data.ts` | — | portés | — |
| 44 | la table de mix (TASCAM Model 12, une tranche par câble) | `blocks/table-mix.ts`, `App.tsx` `ouvrirTranche` | — | le fichier est porté, la machine n'est pas au catalogue | à faire : une tranche par câble demande sa place dans notre console |
| 45 | une machine posée = un groupe SOUDÉ de sections jointives, dans son agencement (le séquenceur du minilogue en bas) ; l'agencement enregistré passe devant | `App.tsx` `spawnMachine`, `blocks/machines.ts` `placesDeMachine`, `blocks/agencements.ts` | — | porté | — |
| 46 | le branchement des contrôles au moteur (`MACHINE_ENGINES.map`) : tourner la coupure du minilogue règle la coupure de la voix | `blocks/machines.ts`, `rack.ts` `pushMachineParam` | — | porté : un instrument devient une PISTE de la DAW, sa source porte la machine | — |
| 47 | « une machine posée doit s'entendre » : sa phrase d'usine | `rack.ts` `phraseDeMachine` | — | portée : un clip de quatre mesures | — |
| 48 | POLY-6, FM-6, STRINGS-4 : une voix propre sur le synthé du minilogue | `rack.ts` `VOIX_DES_PANNEAUX` | — | porté | — |
| 49 | PLANO : un gabarit en sections, rangées et contrôles cotés en mm, la géométrie suit ; relire une machine du studio ; le branchement de chaque contrôle (paramètre, min, max, loi) ; l'aperçu rendu par le vrai panneau à quatre reculs (×1, ×0,6, ×0,4, ×0,25) ; « poser dans l'atelier » | `pages/Plano.tsx`, `plano/gabarit.ts`, `plano/registre.ts`, `scripts/composer-planogramme.mjs` | — | porté (`machines/plano.js`) ; les gabarits vivent dans le projet ; « poser dans le nodal » | le compagnon (API d'Anthropic) et l'écriture sur GitHub ne sont pas portés |

### Le banc et les attracteurs (`docs/logique-globale.md`, n° 32 à 85)

| # | ODIO_01 | fichier | avant | maintenant | écart |
|---|---|---|---|---|---|
| 50 | lanes RYTHME, HARMONIE, TIMBRE (matière) ÉNERGIE, TENSION (courbes) ; un segment dort tant qu'il n'a pas d'attracteur | `banc/logique.ts`, `banc/Banc.tsx` | porté | gardé | — |
| 51 | un attracteur naît d'un segment tiré au clic milieu jusque sur le canvas ; lâché dans le banc ou Échap, il n'a jamais existé | `Banc.tsx` | porté | gardé | — |
| 52 | anneaux par facette ; un anneau capte les BLOCS qui déclarent sa facette ; poids `(1 − d / r)^loi` ; opérateur `neutre + (valeur − neutre) × poids` | `logique.ts` `poids`, `operateurs`, `FACETTES` | les cartes de nos modules | les TUILES : une section de machine est un bloc (la table d'ODIO_01 sur ses contrôles), un module d'ici a la sienne | la table de nos modules est à relire par Cal (question ouverte n° 6) |
| 53 | il PARLE quand la tête qui gouverne traverse son segment ; ODIO_01 s'arrêtait à la lecture (« brancher leur effet au moteur est le chantier suivant ») | `logique.ts` `actif`, `HANDOFF.md` | lecture seule | **il agit** : chaque réglage capté joue son opérateur, au temps de l'horloge audio ; à l'arrêt tout revient ; les chiffres bougent sur la tuile captée (liseré vert) et dans le segment | — |
| 54 | deux têtes (rouge temps réel, verte écoute), « c » bascule celle qui gouverne | `logique.ts`, `Banc.tsx` | porté | gardé ; l'écoute qui gouverne décide aussi de ce que le moteur entend | — |
| 55 | le fil de Bézier segment ↔ attracteur au survol | `Banc.tsx` | porté | gardé | — |
| 56 | Suppr retire l'attracteur choisi, son segment redort | `Banc.tsx` | porté | gardé | — |
| 57 | le lien nodal ↔ arrangement | `docs/logique-globale.md` | l'arrangement en petit au-dessus des lanes | gardé ; pour le génératif : `attracteursActifs(projet, temps)` (exporté par `banc.js`) rend, à un instant, les attracteurs qui parlent et leurs opérateurs | — |

### Les jouets

Les quatorze jouets du Playground (`components/scenes.tsx`, `scenes2.tsx`,
`Scene.tsx`) sont le chantier d'un autre agent (`musique/jouets/`) ; le nodal
garde leurs points d'accroche (`// jouets :`), et une machine se relie à un
jouet par le même port losange « notes » qu'un instrument.

## 2. La fluidité, mesurée

Même script (`nodal_perf.mjs`, sur DGX2), même scène (« Première session »,
15 modules, 18 câbles, 3 attracteurs), Chromium sans affichage (SwiftShader),
processeur freiné ×4. « avant » : `musique/` de `git HEAD` servi par une
copie à part ; « après » : ce travail.

| geste | avant | après |
|---|---|---|
| déplacer la vue (clic milieu) | 59,1 i/s, pire image 33 ms | 59,1 i/s, pire image 33 ms (60 i/s et 17 ms sur deux passes sur trois) |
| zoom molette | 57,8 i/s, pire image 100 ms | 55,3 i/s, pire image 33 ms |
| glisser une tuile | 59,1 i/s, pire 33 ms | 60 i/s, pire 17 ms |
| zoom du banc | 59,4 i/s | 60 i/s |
| déplacer le banc | 60 i/s | 60 i/s |
| glisser un segment | 59,5 i/s, 36,5 ms par évènement | 59,4 i/s, 32,5 ms par évènement |
| glisser un attracteur | 52,2 i/s, 22 ms par évènement, pire 167 ms | 54,3 i/s, 38 ms par évènement, pire 183 ms — plus cher par évènement : les opérateurs du segment et les tuiles captées suivent maintenant le geste |
| **lecture : la tête du banc** | 59,5 i/s mais **8,2 positions par seconde** (le plan entier refait tous les 0,2 temps) | 60 i/s, **56 positions par seconde**, aucune tâche longue |
| l'arrangement, pour comparer : sa tête | 58,9 / s | 58,8 / s |

(Écarts d'une passe à l'autre : ±1 i/s ; le zoom de l'arrangement, lui, varie de 41 à 47 i/s.)

Ce qui coûtait : la tête du banc reconstruisait tout le plan (courbes,
segments, pistes) à chaque déplacement ; la couche méta se refaisait à chaque
mouvement de la vue. Ce qui est fait, comme l'arrangement : les têtes
glissent par une transformation, les courbes se découpent sous la tête par un
masque, le plan ne se refait que quand il change ; le monde du nodal est un
calque promu que la vue déplace sans rien repeindre, rastérisé net une fois le
zoom arrêté ; les tuiles se remettent en page par une file bornée à ~8 ms par
image, les visibles d'abord.

Sur une scène chargée des deux machines (+ 25 sections) : déplacer la vue
59 i/s, lecture 56,6 i/s (tête 53 / s), mais le zoom tombe à ~40 i/s sous
freinage ×4 — le coût est la rastérisation logicielle de sections denses ;
chaque remise en page de tuile coûte ≤ 5 ms (mesuré : 231 remises en page,
138 ms au total).

## 3. Ce qui diffère encore, ce qui n'est pas beau

**29/09 au soir — l'habit.** Cal : « les nodes avaient le bon design et tu as
mis ceux de l'ancien projet qui était du prototype […] on garde juste le code
et la logique et on repasse tout dans notre thème ». Tout le rendu de ce
portage est rhabillé dans le thème du portail, la logique intacte : les tuiles
sont les cartes du nodal d'avant (4a20f41), les molettes celles du rack, les
fils ceux de `commun/wire.js` en pixels d'écran, la sélection et les menus
ceux d'Idéation et de `commun/menu.js`. Le détail, les mesures et les
captures côte à côte : `docs/etudes/musique_theme.md`. Ce qui suit décrit
l'état d'avant l'habit quand il parle d'apparence.

- Le panneau de droite (réglages, liaisons, sortie) est celui du portail :
  ODIO_01 n'en a pas.
- Les cartes des jouets gardent leur dessin (celui du Playground) : ce ne
  sont pas des tuiles d'ODIO_01 (pas de redimensionnement, pas de sémantique) ;
  leur cadre est depuis le 29/09 celui de toutes les tuiles.
- De loin, un module d'ici sans surface (le délai « TEMPS 1/8 », la
  batterie « NIVEAU ») montre son réglage exposé en très grand : c'est la
  règle d'ODIO_01, mais sur nos modules qui n'ont pas d'exposé choisi, le
  premier réglage prend toute la tuile.
- À petite échelle, les poignées d'arête (6 px de mise en page) mangent le
  haut de l'en-tête : tirer une section par le haut de son en-tête l'étire au
  lieu de la déplacer — comme dans ODIO_01.
- Le menu d'une machine posée tout en haut passe sous la barre d'outils.
- Les teintes par défaut des machines d'ODIO_01 (TR-8S bleue, MICROFREAK
  violette…) ne sont pas posées : aucune machine n'a de teinte à la pose.
- Le SEQ-01 ne séquence pas (pas plus que chez ODIO_01) : ses touches
  jouent.
- Les réglages de conception (agencements enregistrés, cotes retouchées,
  ordre d'importance) restent dans le navigateur, comme chez ODIO_01.
- Non portés : la table de mix, les sons par machine, le bloc TEMPO, le MIDI
  vers les claviers posés, la butée des sections en édition, la tête dans le
  groove, le compagnon et GitHub de PLANO.

## 4. Les essais (DGX2)

Copie d'essai `/tmp/sr_odio_nodal` (port 8806, données à part),
`python3 tools/check.py` : 933 passés, 0 en échec. Scripts Playwright
(`/tmp/nodal_essai*.mjs`, `/tmp/nodal_perf.mjs`), images dans
`/tmp/sr_odio_nodal_shots/` :

- poser le MINILOGUE XD, la TR-8S, un clavier ; cadrer à 100 %
  (`g1_minilogue_cadre.png`) ; dézoomer (`g2_semantique_z*.png`) ;
- G ouvre la machine, une section tirée ailleurs, T la remet à sa place
  (`g3_machine_ouverte.png`) ;
- un câble du clavier lâché sur le minilogue : cadre vert, lien de notes
  (`g4_cable_cadre_vert.png`) ; une touche de l'ordinateur le joue ;
- un attracteur TIMBRE à 210 unités du filtre (poids 0,5 sur l'anneau
  « brillance ») : pendant la lecture la coupure de la voix passe de
  1763 Hz à 4335 Hz (opérateur 78,5 % pour un réglage à 95 %), revient à
  1763 Hz à l'arrêt, ne bouge pas quand l'attracteur est éloigné
  (`g5_attracteur_agit.png`) ;
- ⌥ glissé duplique un délai (câblé vers la même tranche) ; un câble lâché
  dans le vide ouvre la liste rapide, le FILTRE DRIVE choisi naît branché
  (`g8_palette_vide.png`) ; un jouet PING-PONG joue l'ACID-3 par le port
  losange (`g9_jouet_machine.png`) ; G groupe, T range, Suppr recoud ;
- le poste de conception : T optimise la section désignée ; PLANO : un
  gabarit neuf posé dans le nodal ;
- côte à côte avec le site d'ODIO_01 : `cote_a_cote_ouvert.png`,
  `cote_a_cote_dezoom.png`.

## 5. Le dessin au bouton du milieu (29/09, troisième tour)

Cal, le 29/09 : « on doit avoir dans ces nodes des paramètres exposés avec la
fonction clic milieu souris qu'on avait sur le ODIO de référence dans l'autre
repo : on dessinait avec l'appui de ce bouton milieu et on définissait « à la
volée » quel paramètre est le plus important à conserver lors du zoom
sémantique : regarde comment cela était codé dans l'autre projet. »

### Comment ODIO_01 le faisait (`apps/studio/src/`, commit 6d8a7ed)

- **Le geste** : `components/MachinePanel.tsx`, `tracerOrdre` (l. 830-871).
  Le bouton du milieu enfoncé sur le panneau d'une section de machine, en
  CAPTURE (`onPointerDownCapture`, l. 891-899 : « le tracé doit pouvoir
  partir d'un knob », les gabarits arrêtant la propagation pour leur propre
  geste). Chaque point de la courbe est testé contre les boîtes des contrôles
  rendus (`boites`) ; un contrôle traversé pour la première fois prend le
  rang suivant (`vus.push`) ; la courbe se dessine (`setCourbe`), les rangs
  s'affichent (`setOrdreEnCours`). Au relâché : `savePriorite(section.id,
  vus)` (l. 867), et les rangs restent 2,6 s (l. 870 : « un ordre qu'on vient
  de tracer et qui disparaît aussitôt ne s'est pas vu »). Un tracé qui ne
  traverse rien efface l'ordre et rend la main au constructeur (l. 836-837).
- **Ce que l'ordre commande** : `blocks/machines.ts`, `rankedControls`
  (l. 683-714) — « L'ORDRE TRACÉ À LA MAIN PRIME SUR TOUT » : les contrôles
  tracés d'abord, dans l'ordre de la traversée, puis les autres par
  importance (la cote √(l × h)) ; l'exposé passe devant. Quand la place
  manque, la section retire par la FIN de cet ordre
  (`docs/regle-du-responsif-machine.md`, § 3 l. 127-131 et § 7 l. 178-181) :
  le premier tracé est ce qui reste au plus loin.
- **Où c'est rangé** : `design/machines-config.ts`, `priorites[sectionId]`
  (l. 187-190, `getPriorite` / `savePriorite` l. 388-404), dans le navigateur.
- **La cohabitation avec le déplacement de la vue** : un seul aiguillage,
  `App.tsx` `onMiddleDown` (l. 577-606), écouteur natif en capture sur la
  vue. Le bouton du milieu déplace la vue partout SAUF là où un geste le
  revendique et le déclare : une borne `.port` (la faire glisser), une
  `.machine` quand son poste de conception est ouvert (le tracé), et hors
  édition une molette `[data-bout]` (tirer un lien de molettes). La règle est
  écrite dans `docs/logique-globale.md`, n° 61 (l. 253) : « un geste
  appartient à un bouton, et le déclare ». Le tracé avait été réservé à
  l'édition à la demande de Cal : `docs/demandes.md` F51 (l. 165, « le clic
  milieu ne trace qu'en mode édition — panoramique libre pour jouer »), après
  F43 (l. 157, le tracé) et F35 (l. 132, les rangs seulement au clic milieu) ;
  `docs/organisation-machines.md` l. 380-397.
- Les blocs simples (pas les machines) n'avaient PAS de tracé : un seul
  exposé, choisi en cliquant le nom d'un paramètre (`App.tsx`
  `toggleExposed`, l. 1003-1008 ; `ParamRow.tsx` l. 5), qui passe en tête des
  rails (`BlockBody.tsx` `promoteExposed`, l. 79) et reste seul, en grand,
  quand rien d'autre ne tient (`Promoted.tsx`).

### Ce qui est repris ici

- **Les machines** : inchangé — le tracé de leur panneau en édition
  (`machines/panneau.js` `tracerOrdre`) et l'aiguillage d'ODIO_01.
- **Les tuiles du nodal** (les nœuds : sources, effets, tranches, clavier) :
  le même geste, hors édition, « à la volée » (`nodal.js`
  `tracerOrdreTuile`). Il est déclaré au même aiguillage que chez ODIO_01,
  comme une quatrième exception : bouton du milieu enfoncé sur les RÉGLAGES
  d'une tuile (`.tile__body`) → tracé ; sur son en-tête, ses arêtes, le fond,
  un câble → la vue part. Mêmes règles : l'ordre de la première traversée,
  les rangs pendant le tracé et 2,6 s après, un tracé vide efface. La courbe
  touche ce qui porte `data-param` (`machines/corps.js` : rails, faders, le
  réglage en grand). Un seul écart : entre deux événements, la courbe est
  suivie tous les 4 px, pour qu'un geste rapide ne saute pas un rail.
- **L'effet** : l'ordre est rangé dans le projet (`p.nodal.ordre[tuile]`,
  donc partagé et annulable par Ctrl+Z) ; le premier tracé devient l'exposé
  (`p.nodal.expose`), le réglage qui reste seul en grand ; `corps.js`
  `promoteExposed` met les rails tracés en tête, dans l'ordre de la
  traversée, les autres gardent le leur ; `resolveSlots` s'arrêtant au
  premier qui ne rentre plus, c'est l'ordre du retrait au zoom sémantique —
  la règle de `rankedControls`. Le clic sur un nom de réglage (l'exposé
  d'ODIO_01) reste ; le menu de la tuile (« Exposer », « Effacer l'ordre
  tracé ») aussi.
- **Pourquoi hors édition** : F51 craignait qu'un panneau de machine, grand,
  confisque le déplacement. Les machines gardent cette règle ; sur une tuile
  seule la zone des réglages trace, et la vue part de partout ailleurs.

Mesuré (DGX2, `/tmp/sr_odio3_essai.mjs`, captures `e04_trace_en_cours`,
`e05_trace_rangs`, `e06_trace_dezoom` dans `/tmp/sr_odio3_shots`) sur le
délai de la basse : à 100 %, cinq rails (Temps, Retour, Ton, Mix, Son sec) ;
avant tout tracé, à 55 % et 35 % il ne reste que « Temps ». Tracé Mix → Ton →
Retour : ordre [mix, tone, fb], exposé « mix », trois rangs affichés, la vue
n'a pas bougé ; ensuite, à 55 %, 35 % et 15 %, il reste « Mix » (en grand à
15 %). Ctrl+Z en AZERTY (`key: 'z'`, `code: 'KeyW'`) efface l'ordre,
Ctrl+Maj+Z le rend. Le bouton du milieu glissé sur le fond déplace la vue de
(120, 60) pour un geste de (120, 60), sur l'en-tête d'une tuile de (−80, −30)
pour (−80, −30), sans toucher au zoom.
