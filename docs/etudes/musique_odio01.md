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

## 6. Les attracteurs sur tous les nodes (fait le 09/10)

Cal, le 09/10 : « La gestion de ce que font les attracteurs ne me semble pas
vraiment implémentée : il y a plein de nodes qui ne semblent pas être pris en
compte par nos paramètres d'attracteurs, si ? Revérifie et avance là-dessus. »
Il avait raison : sur 350 réglages continus, 31 s'entendaient.

### 6.1 L'audit, rejoué dans Chromium

`musique/pilote_attracteurs.mjs` (portail d'essai neuf, `--audit-seul`) pose
un module de chaque sorte (43) et trois machines (MINILOGUE XD, ACID-3,
TR-8S), chacun sous son attracteur : sept anneaux de 400, le centre à 200 du
bord de la boîte, donc poids 0,5 ; segment des temps 4 à 8 ; chaque réglage
continu loin de son défaut. Il joue en temps réel et lit, aux temps 2, 6 et
10, ce que le moteur entend : la valeur que tient l'instrument d'ODIO
(`getParameter`), l'AudioParam d'un module natif (câblé à la sortie : un nœud
que rien ne tire n'est pas rendu), la copie qu'il a reçue, la valeur que lit
la scène d'un jouet, ce que lit le planificateur (arpège, swing). Il ne lit
que le projet, le moteur et `influenceA` : le même pilote juge la copie
d'avant (`git archive 99595ec`, servie sur le même port).

| | avant (99595ec) | après |
|---|---|---|
| réglages continus | 350 | 353 (le swing, § 6.5) |
| captés | 31 | 293 |
| entendus pendant, rendus après | 31 | 293 |
| hors attracteurs, dit | — | 60 (niveaux, pano, arc, routage ; contrôles branchés à un niveau) |

Après la fusion des deux lots voisins du 09/10 (le Résonateur et Physique,
qui déclarent leurs sortes ; le MINILOGUE XD sur le Synthé, la MICROFREAK, le
FM-6 et le STRINGS-4 sur Macro) : 390 réglages continus, 326 captés, entendus
pendant et rendus après — Résonateur 6 (8), Physique 16 (17), Macro 15 (16),
MINILOGUE XD 11 (12) ; le selftest : POLY-6 14, FM-6 3, STRINGS-4 4.
Une fois le lot « odio-moteurs » dans l'intégration (6745d28), le pilote
rejoué dessus donne les mêmes chiffres (390, 326, 326, 0 pas rendu ; 28
contrôles, 0 échec) et la garde nomme désormais ces moteurs et ces machines
(le Résonateur, Physique, les Échantillons ; le POLY-6, le FM-6, le
STRINGS-4) : un retrait de leurs sortes, ou un branchement qui ne vise plus un
réglage de Macro, la fait échouer. `python3 tools/check.py` complet, sur la
branche fusionnée : 4 071 passés, 0 en échec.

Par sorte de module, entendus avant → après (sur n continus) : DR-9 0 → 17
(26), Synthé 6 → 25 (26), Échantillonneur 1 → 4 (5), Lecteur 0 → 0 (1,
son volume) ; boîte à rythme 1 → 35 (47), Analog 4 → 10 (11), Basse acide
4 → 8 (9), Numérique 5 → 12 (13), Macro 0 → 14 (15) ; Délai 0 → 3,
Réverbération 0 → 4, Compresseur 0 → 5 (6), Égaliseur 0 → 11 (12), Filtre
0 → 2, Distorsion 0 → 3 (4) ; Réverbe 0 → 4, Chorus 0 → 3 (4), RTT-01 0 → 4,
Comp 0 → 4 (5), EQ-3 1 → 5, Filtre drive 3 → 3, Satura 1 → 4, Crush 1 → 4,
Table de mix 0 → 4 (8), Volume 0 → 0 (2) ; la console (Piste, Retour, Sortie)
0 → 0 ; les quatorze jouets et l'horloge 0 → 57 (58) ; MINILOGUE XD 4 → 8 (9),
ACID-3 0 → 6 (7), TR-8S 0 → 34 (46). Hors pilote, le selftest
(`music_attracteurs.py`) juge chaque machine qui a un son : MICROFREAK 9,
POLY-6 2, TAPE-3 4, PLATE-24 3, VARIMU-70 3 contrôles captés et entendus.

### 6.2 Ce qui échappait, et pourquoi

1. **Pas de facette** : la table du 29/09 (`FACETTES_MODULES`, à part, dans
   `influence.js`) nommait 29 réglages de 10 sortes de modules ; tout module venu après
   (Macro, les jouets) ou oublié (la DR-9, les six effets d'ici, la console,
   l'enveloppe et le LFO du Synthé…) n'existait pas pour un attracteur.
2. **Réglage discret** : `synth.wave` et `analog.wave` avaient une facette ;
   le banc montrait leur opérateur, `influenceA` les sautait (`s.opts`).
3. **Une machine ne déclarait que ses contrôles**, et seulement ceux de la
   table d'ODIO_01 (19) : l'ACID-3, le POLY-6, le TAPE-3, le PLATE-24, le
   VARIMU-70 et les 44 molettes de voix de la TR-8S, rien. Et de ces 19, neuf
   ne sont branchés à rien (`ml_v1pitch`, `ml_v2xmod`, `ml_mshape`,
   `ml_drive`, `ml_lint`, `mf_crise`, `tr_fill`, `tr_shuf`, `tr_scat`) :
   captés, montrés, jamais entendus.
4. **Pas d'AudioParam, ou lu ailleurs** : l'arpège se lisait dans le projet
   au moment de planifier, une scène de jouet lisait ses réglages elle-même ;
   même captés, ils ne bougeaient pas. Un module natif recevait sa copie au
   moment où la tranche se planifie, un instrument d'ODIO aussi (son filtre,
   l'AudioWorklet de Plaits) : jusqu'à l'avance du tampon (0,3 s par défaut)
   trop tôt.
5. **L'automation garde la main** : voulu, gardé ; un câble de valeur (jouets)
   la garde désormais aussi.
6. **Les jouets** étaient captés à la taille de leurs cellules (230 px), pas
   à celle de leur carte (780 px) : le moteur et le banc ne mesuraient pas la
   même distance.

### 6.3 Juste par construction : la facette, propriété déclarée

`musique/facettes.js` porte la règle. Chaque module déclare, dans sa
définition, la **sorte** de chaque réglage continu (`sortes: { clé: 'sorte' }`
dans `modules.js`, `jouets/defs.js`, et tout module neuf ; les instruments et
effets d'ODIO sur les identifiants de leurs descripteurs) ; `modules.js` pose
sur chaque réglage sa `sorte`, sa `facette` et, hors attracteurs, `hors` (la
raison). La sorte dit ce qu'est le réglage — un fait ; la table `SORTES` dit
ce qu'elle a de chaque thème — un goût, à Cal. Une facette propre se déclare
`['sorte', 'facette']` (le timbre de Plaits et de Macro : brillance, le choix
du 29/09). Un réglage discret est hors d'office : l'opérateur n'a pas de
milieu entre deux choix, et un seuil n'est documenté ni par ODIO_01 ni par
nos études. La table du 29/09 n'est plus écrite, elle est lue
(`FACETTES_MODULES` existe encore, dérivée) ; chacun de ses choix est gardé
(le selftest le vérifie), sauf les deux discrets.

**Une machine** : la table d'ODIO_01 décide d'abord (celle de l'auteur) ;
sinon un contrôle branché (`MACHINE_ENGINES.map`) prend la facette du réglage
qu'il règle sur le module qui porte le son (`positionDeControle`). Une seule
vérité : une machine de PLANO n'a rien à déclarer.

**La garde** (`server/tools/music_attracteurs.py`, sous node avec un faux Web
Audio ; `python3 tools/check.py music_attracteurs`) échoue si un réglage
continu n'a pas de sorte, si une sorte est inconnue, si une sorte est déclarée
pour une clé absente, si un branchement de machine vise un réglage que le
module n'a pas.

**Les sortes et leur facette** (340 réglages de modules, 49 discrets) —
« proposition » : ni la table du 29/09 ni celle d'ODIO_01 n'en disaient rien.

| sorte | facette | réglages | précédent |
|---|---|---|---|
| hauteur | tonalité | 21 (octaves, note racine, octaves d'arpège, cuisson du grille-pain…) | 29/09 : synth.oct, sampler.root |
| desaccord | tension | 3 (désaccord, LFO → hauteur) | 29/09 : synth.det |
| glisse | tension | 2 (portamento) | proposition |
| coupure | brillance | 16 (coupure, ton, amorti) | 29/09 : synth.cut |
| aigu | brillance | 4 (aigus d'un égaliseur) | 29/09 : eq3.high |
| resonance | matière | 8 | 29/09 : synth.res |
| saturation | matière | 10 (drive, bits, biais, mix d'une saturation) | 29/09 : satura.drive |
| forme | matière | 24 (harmoniques, morph, bruit, copies, part d'un oscillateur) | 29/09 : plaits.harmo |
| enveloppe | matière | 46 (attaque, déclin, tenue, chute, quantité) | 29/09 : synth.fenv ; ODIO_01 : ml_ega |
| accord | matière | 19 (l'accord d'une percussion) | n° 54 : « la boîte à rythme n'a rien de tonal » |
| bande | matière | 14 (gain, fréquence, Q hors des aigus) | proposition |
| modulation | matière | 8 (LFO, chorus, pleurage) | proposition |
| espace | matière | 13 (durée, taille, retour, part d'effet) | proposition |
| accent | accents | 1 | 29/09 : acid.accent |
| dynamique | accents | 9 (compresseurs) | proposition |
| cadence | densité | 9 (débit, billes, temps d'écho) | proposition |
| duree | densité | 19 (durée d'arpège, d'une note émise, attentes) | proposition |
| mouvement | densité | 17 (la physique des jouets) | proposition |
| swing | swing | 2 | ODIO_01 : tr_shuf |
| niveau | hors | 39 | ODIO_01 : « le volume, le tempo, les leds n'ont rien à dire à un attracteur » |
| pano, arc, routage | hors | 7 | la place stéréo, l'arc d'énergie, une coupure : leurs propres gestes |

### 6.4 Le moteur : tout réglage capté s'entend, à son temps

`machines/influence.js` (`appliquer`) passe par le moyen de chaque module :
un module d'ODIO ou un jouet qu'on traverse, `setAt(k, v, instant)` ; un
module natif, la **copie entendue** (`Graph.entendu`) posée à l'instant de la
tranche (`Graph.aLInstant` : ses `setP` glissent à cet instant, jamais
avant) — ce qu'il lit à l'attaque d'une note la prend à la tranche près.
Le planificateur (l'arpège, le swing) et les scènes des jouets (`Jeu.V`,
`Graph.valeur`) lisent ce que le moteur entend ; une molette tournée pendant
qu'un attracteur parle ne le lui retire plus (`Graph.update`). Un instrument
d'ODIO reçoit l'instant (`setParameter(id, valeur, temps)`, `odio/types.js`) :
Macro et le Numérique datent leurs réglages jusque dans l'AudioWorklet
(posés au quantum de leur heure), leur filtre et la résonance de la basse
acide aussi. Un réglage à pas (octave, copies, billes) prend l'opérateur
arrondi à son pas.

### 6.5 Le swing

La facette « swing » de RYTHME n'avait rien à capter : aucun moteur n'en
avait. La DR-9 et la boîte à rythme ont un réglage Swing (50 à 75 %) : la
seconde double croche de chaque paire tombe à swing % de la paire — la loi de
la MPC de Roger Linn (« 50 % swing means no swing, 66 % is a perfect triplet
swing », entretien à Attack Magazine, 2013). Lu au moment de planifier les
coups, comme l'arpège (`PLANIFIES` : il ne s'automatise pas). La molette
SHUFFLE de la TR-8S y est branchée, 0 → 50 %, à fond → 75 % (la loi de la
TR-8S n'est pas documentée ici : choix de réglage).

### 6.6 Ce que fait un attracteur, à le voir

- **Le nodal** : l'attracteur frôlé ou choisi (son disque, son segment)
  cerne chaque tuile qu'il capte et dit sur elle son poids et ses réglages
  par facette (« 0.67 · brillance 1 · matière 3 », « 2 sans effet » quand un
  contrôle n'est branché à rien ou qu'on le tient) ; le détail au survol de
  l'étiquette.
- **Une tuile choisie** est reliée par un fil à chaque attracteur qui la
  capte (le poids, le nombre de réglages, « parle ») ; son panneau a une
  section « Attracteurs » : chacun, son poids, s'il parle, et réglage par
  réglage la valeur → l'opérateur, ou « tenu », « non branché » ; aucun :
  ce qu'elle offre (« matière 3, brillance 1 ») et le geste qui en fait
  naître un ; rien à capter : pourquoi.
- **Le banc** : un segment dit combien de réglages et de blocs son attracteur
  capte ; chaque ligne, son poids (« ×0.67 »), grisée quand elle ne s'entend
  pas.

Captures (sombre et clair) : `<sortie>/dark_1_survol.png`,
`dark_2_tuile.png`, `dark_3_lecture.png`, `dark_4_offre.png`, et `light_…`.

### 6.7 Mesuré (hors temps réel, `renderMix`, comme l'export)

Une phrase de synthé, un attracteur TIMBRE posé à 0,9 rayon (poids 0,1 :
le réglage ramené aux neuf dixièmes vers son défaut) sur les temps 8 à 16 ;
le centre de gravité du spectre et le niveau par mesure de quatre temps :

| | mesures 1-2 | 3-4 (il parle) | 5-6 | crête |
|---|---|---|---|---|
| filtre natif, coupure 400 → 2 200 Hz | 339, 340 Hz | 1 160 Hz | 346, 340 Hz | −15,2 dBFS |
| filtre d'ODIO, 300 → 1 110 Hz | 280 Hz | 716 Hz | 281, 280 Hz | −3,4 dBFS |
| Macro, timbre 0,05 → 0,46, coupure 900 → 14 490 Hz | 598, 556 Hz | 2 257 Hz | 617, 554 Hz | −15,1 dBFS |

Ni silence ni écrêtage ; avant que Macro reçoive l'instant, sa deuxième
mesure montait déjà (971 Hz). Le swing (DR-9, charley à chaque double
croche, 75 %, un attracteur qui le ramène à 52,5 %) : 62,5 ms de retard par
double croche impaire, 6,3 ms pendant qu'il parle, 62,5 ms après. Le rendu
de 12 s : 0,3 s (filtres), 0,6 à 1,0 s avec l'AudioWorklet de Macro (une
voix) — la charge de l'AudioWorklet reste celle de Macro, l'attracteur n'y
ajoute qu'un message daté par changement. Rien n'a été écouté par un humain :
le goût est à Cal.

### 6.8 Ce qui reste, et les questions à Cal

- **La table des sortes**, sorte par sorte (§ 6.3) : surtout ce qui n'a pas
  de précédent — l'espace (réverbe, écho) et la modulation en matière, la
  dynamique en accents, la physique des jouets, les durées et les cadences
  en densité, l'accord d'une percussion en matière (n° 54), le glissé en
  tension.
- **Le neutre** (question ouverte n° 5 d'ODIO_01) : au centre, l'opérateur
  vaut le réglage ; au bord, le défaut. Un attracteur ramène donc vers les
  défauts à mesure qu'on s'éloigne — c'est la formule ; est-ce le geste
  voulu ?
- **Les réglages discrets** (49 : formes d'onde, types de filtre, gammes,
  modèles de Plaits) : un seuil ? Non documenté, donc exclus.
- **Les contrôles d'ODIO_01 sans branchement** (huit, `tr_shuf` est branché
  au swing) : le moteur n'a pas leur réglage (hauteur du VCO 1, modulation
  croisée, forme, drive et intensité du minilogue, montée de la coupure de
  la MicroFreak, fill et scatter de la TR-8S).
- La **table de mix** (ses tranches se règlent par `pousserTranche`, elle
  n'est pas au catalogue, § 1 n° 44) : rien n'y est capté. (Le FM-6 et le
  STRINGS-4, qui n'avaient rien de branché, en ont depuis le lot « odio-moteurs ».)
- **Le Résonateur et Physique** (lot « odio-moteurs ») datent eux aussi leurs
  réglages dans leur AudioWorklet (`dates`, le modèle de `plaits/macro.js`).
- **La précision** : ce qu'un module natif ne tient pas par un AudioParam
  (la durée de la réverbération, qui recalcule sa réponse ; le drive de la
  distorsion ; un type de filtre) prend la copie quand la tranche se
  planifie ; un instrument qui lit ses réglages à l'attaque (Analog, la boîte
  à rythme) les prend à la tranche près (25 ms) ; les jouets qu'on traverse
  (REEL-2, RESSORT, ALCHIMIE) aussi.
- **La carte d'un jouet** a sa hauteur mesurée dans la page ; le moteur prend
  celle de sa définition (quelques pixels d'écart).
