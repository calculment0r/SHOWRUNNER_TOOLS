# Le mode Présentation, le motion et les modèles (30/09/2026)

Suite de `presentations.md` (étapes 1 à 4, « Fait le 30/09 ») : la demande de
Cal du 30/09 — « des templates hyper beaux […] 5 statiques, 5 en motion […]
un mode "expert" […] on fait la présentation, on cale tout, et on fait une
passe assistée super cool ». Tout est dans `ideation/presentation/` (neuf),
branché par de petits blocs délimités (`── présentation … ── fin présentation ──`).

## 1. Ce qui est fait

| quoi | où |
|---|---|
| **Le mode Présentation** : sa propre vue par-dessus l'Idéation (plan des diapositives, scène, minuterie de motion, inspecteur Modèles / Diapositive / Objet). Chargé seulement quand on y entre (panneau Diapositives → « Mode présentation », clic droit d'une vignette, ⌘K). Échap rend l'Idéation telle quelle : ni caméra, ni sélection, ni document, ni pile d'annulation ne bougent | `mode.js`, `presentation.css` ; entrée : `diapo/index.js` |
| **La scène** : le module de rendu que l'étude appelait (§ 2.3, « une seule vérité ») ; le mode, le lecteur et l'impression s'en servent | `scene.js` |
| **Le moteur de motion**, déclaratif (des données bornées par `schema.json`, jamais du code) | `moteur.js`, `schema.json` |
| **Les transitions** : coupe, fondu, poussée, volet, rideau, zoom, morph (Magic Move), toile (on vole sur la planche) | `transitions.js` |
| **Le lecteur plein écran** : ce que « Présenter » montre quand la planche a un modèle ou du motion (sinon la présentation de l'atelier, inchangée) | `lecteur.js`, branché dans `atelier/presentation.js` |
| **Dix modèles**, chacun avec une vraie présentation d'exemple (7 ou 8 diapositives : titre, section, image plein cadre, citation, chiffres, grille, fin) | `modeles/*.json` |
| **La passe assistée** : règles explicites et déterministes, avant / après, un geste (Ctrl+Z) | `assist.js` |
| **L'impression** : une page par diapositive, état final, PDF du navigateur ou de Chromium | `lecture.html`, `lecture.js` |
| **Le serveur** garde `motion`, `tone`, `pres.template` (branchements dans `ideation._node` et `_pres`) ; le contrôle | `server/tools/presentation.py` |
| **La planche** montre l'habit du modèle appliqué (fond des diapositives, couleur des textes, vignettes du panneau) | `diapo/index.js`, `diapo/vignette.js` |

## 2. Le modèle de données

```
objet      motion { in: {fx, dur, delay, ease, by, stagger, dist}, out: {fx, dur, ease},
                    loop: {fx, dur, amp}, depth (-1…1, la parallaxe), step (0…9, l'étape au clic) }
           tone   ink | muted | accent | accent2 | inverse | surface | bg | veil (le voile d'une image)
cadre      motion { trans, tdur, ease, bg, auto }        (deck.trans garde son équivalent ancien)
planche    pres.template                                  (pres.styles : les six styles du modèle)
```

Un objet sans `motion` prend celui que son modèle donne à sa **part** (surtitre,
titre, corps, légende, chiffre, citation, image, plein cadre, trait), décalé par
le **rythme** du modèle dans l'ordre de lecture. Le rôle d'une diapositive (titre,
section, image, citation, chiffres, grille, contenu, fin) se lit dans son contenu
(`scene.js`, `partOf` / `roleOf` ; le serveur a la même lecture pour son contrôle).

## 3. Le moteur

- **Web Animations API** (`Element.animate`) sur des enveloppes emboîtées
  (`.pm-o > .pm-p > .pm-e > .pm-m > .pm-l > .pm-c`) : la place, la parallaxe,
  l'entrée / sortie, le masque, la boucle — chacune son transform, rien ne se
  marche dessus. Seuls `transform`, `opacity` et `filter` s'animent ; deux
  exceptions dites : le dessin d'un trait (`stroke-dashoffset`, peinture sans
  mise en page) et les mots masqués (encore du transform dans une boîte qui coupe).
- **Entrées** : fondu, monte, descend, glisse, échelle, zoom (dans sa boîte pour
  une image), flou, bascule 3D, masques ↑ ↓ ← → (la fenêtre glisse, le contenu
  glisse à rebours : il paraît immobile), révélation par mot / ligne / lettre,
  dessin, **compteur mécanique** (des colonnes 0-9 glissées en transform, pas un
  texte réécrit par image), machine à écrire. **Sorties**, **boucles** (dérive
  « Ken Burns », flotte, pulse, tourne, balance), **parallaxe** (dérive lente en
  `composite: 'add'` + pointeur), **étapes** au clic.
- **Courbes nommées** : cubic-bezier d'easings.net (easeOutQuint, easeOutExpo,
  easeInOutCubic, easeInOutExpo, easeOutBack), la « standard » de Material 3
  (`cubic-bezier(0.2, 0, 0, 1)`), et un **ressort** calculé une fois (oscillateur
  amorti échantillonné) rendu en fonction CSS `linear()` (MDN : Chrome 113,
  Firefox 112, Safari 17.2).
- **La frise** : toutes les animations d'une diapositive créées d'un coup, en
  pause ; `seek(t)`, `playFrom(t)` (par `startTime`), `finish()` (l'état final).
  C'est ce qui rend la minuterie du mode exacte — et un export vidéo image par
  image possible (§ 7).
- **Morph** : les objets de même identité (même `mid` — « Dupliquer la
  diapositive » —, même image de la bibliothèque, même texte au même style)
  rejoués de leur place d'avant à celle d'après (FLIP, en px de scène : exact par
  construction) ; le reste se fond. Pas de View Transitions ici : nos deux scènes
  vivent côte à côte, la frise reste à nous.
- **Toile** : les diapositives posées à leur place sur la planche (et leurs
  voisines), la caméra part de l'une, prend de la hauteur, se pose sur l'autre —
  le vol de l'atelier, échantillonné en 36 images clés (aucun calcul par image).
- **prefers-reduced-motion** : aucune entrée, boucle ni parallaxe ; l'état final
  d'emblée (le même que l'impression) ; transitions en fondu de 220 ms au plus.

## 4. Les dix modèles

Palettes = données du modèle (variables `--t-*` sur la scène, jamais des jetons du
thème) ; polices OFL de la bibliothèque (`FONTS` du serveur : web + PDF permis) —
ni Venus Rising ni Norelli. Images des exemples : identifiants de la bibliothèque
de Cal (rien n'est copié dans le dépôt) ; absentes, un aplat du modèle garde la place.

| modèle | sorte | direction | l'exemple |
|---|---|---|---|
| Générique | motion | cinéma, générique de film : cadre large qui entre, grain de pellicule qui tremble, capitales Unbounded très espacées qui sortent du flou lettre à lettre, images en Ken Burns, rideau | SEED, un film de Nirvalab |
| Lumière | motion | keynote produit : noir d'écran, halos qui flottent en parallaxe, titres qui montent mot à mot sur un ressort, chiffres qui roulent, une image qui grandit d'une diapositive à l'autre (morph) | Showrunner 2, le lancement |
| Métronome | motion | typographie cinétique suisse : mots qui sortent de leur masque, filets qui se tracent, volets, un carré rouge qui tourne, un trait dessiné sous la citation | Le rythme, manifeste |
| Signal | motion | terminal du futur : phosphore vert, chasse fixe tapée à la machine, balayage d'écran, cercles qui se tracent | Le pont entre deux machines |
| Toile | motion | on vole dans la toile de l'Idéation : les diapositives à leur place sur la planche, couches à plusieurs profondeurs, halos | Carte des idées, le monde de Seed |
| Revue | statique | éditorial magazine : papier chaud, Fraunces à taille optique, filet, folio, grand numéro vermillon | La lumière comme personnage |
| Grille | statique | suisse typographique : Inter Tight grasse et serrée, rouge signal, douze colonnes visibles, numéros au trait | Un portail, huit outils |
| Brut | statique | brutaliste mono : gris béton, Space Grotesk capitale + Azeret Mono, orange de chantier, un filet autour de tout | Rapport de banc #07 |
| Atelier | statique | maison de couture : noir et champagne, Instrument Serif, capitales très espacées | Maren Ostrova, dossier personnage |
| Affiche | statique | affiche pop : bleu électrique, rose, jaune, Syne extra-large, bandeau qui défile | Nirvalab Club, soirée de projection |

## 5. La passe assistée

Des règles, pas un modèle de langue ; la même planche donne toujours la même
proposition, et le rapport dit chaque règle appliquée, diapositive par diapositive :

1. **lire** : la part de chaque objet, le rôle de chaque diapositive ;
2. **hiérarchie** : titre d'une diapositive de titre, section, image ou fin →
   Display (H1 au-delà de trois lignes) ; surtitre → Étiquette ; chiffre → Display ;
   citation → H1 / H2 selon sa longueur ; le reste → Corps, Légende ;
3. **grille** (12 colonnes, marges 96, gouttière 24, ligne de base 8 : `DECK_GRID`) :
   le texte s'empile dans une colonne avec des écarts fixes, calé en bas, au centre
   ou en haut selon le rôle ; une image seule sur une diapositive de titre ou
   d'image passe plein cadre, derrière ; plusieurs images → colonnes égales ;
4. **contraste** : texte sur image → voile + encre claire ; ailleurs, l'encre au
   meilleur rapport WCAG sur le fond (calculé sur la palette ; le rapport l'écrit) ;
5. **rythme** : entrées du modèle dans l'ordre de lecture ; une diapositive qui
   reprend un objet de la précédente passe en morph.

Le modèle proposé, quand on n'en essaie ni n'en a appliqué : des chiffres →
Lumière ; beaucoup de pleins cadres → Générique ; des textes longs → Revue ;
beaucoup d'images → Toile ; sinon Métronome. Le résultat est une copie : le mode la
montre en avant / après (une ligne qu'on glisse sur la scène) ; « Appliquer la
passe » l'écrit en un `app.mutate` (Ctrl+Z, co-édition). L'annulation est celle de
l'Idéation (sa pile d'instantanés), pas `commun/undo.js` : un seul Ctrl+Z par page.

**LLM local** : Ollama sert `qwen3-vl` sur DGX1 et DGX2 (relevé du 30/09, `api/tags`).
Il pourrait un jour juger l'image rendue d'une diapositive (une scène → PNG →
critique) ; rien n'est appelé ni téléchargé ici.

## 6. Preuves (30/09, DGX2, Chromium sans affichage)

- `tools/check.py` : 0 échec ; le contrôle neuf (`server/tools/presentation.py`,
  selftest) : chaque modèle valide selon le schéma (palette, styles gardés tels
  quels par `_pres`, licences web + PDF, décor, motion, chaque objet d'exemple passe
  `_node` et tient dans sa scène), les sept sortes de diapositives dans chaque
  exemple, chaque effet / courbe / transition / décor du schéma présent dans le
  code, aucune couleur en dur dans l'interface, l'aller-retour d'une planche
  (motion borné, effet inconnu refusé, modèle inconnu tombé).
- Pilotes Playwright (portail d'essai 8914) : entrer / sortir sans rien changer,
  passe assistée (avant / après, appliquer, Ctrl+Z, Ctrl+Maj+Z), minuterie (glisser
  une barre = un délai, Ctrl+Z ; la tête de lecture), les dix modèles essayés sans
  rien écrire, prefers-reduced-motion, PDF (7 pages), en sombre et en clair ; les
  dix exemples posés et lus en plein écran, **aucune image > 50 ms** (60 i/s,
  pire image 16,8 ms ; 33 ms une fois sur Générique et Toile), avec le GPU (Vulkan)
  comme en rendu logiciel (SwiftShader) ; une vidéo par modèle motion.

## 7. Limites, et la suite

- **Polices** : les six OFL se chargent comme avant (Google Fonts, l'hôte que la
  page appelle déjà, `diapo/polices.js`) ; les servir depuis `commun/fonts/`
  demande de télécharger leurs fichiers et `OFL.txt` depuis
  `github.com/google/fonts/tree/main/ofl/<unbounded|syne|fraunces|instrumentserif|intertight|spacegrotesk>`
  (non fait : aucun téléchargement sans l'accord de Cal).
- **Export PNG** d'une diapositive dans l'habit du modèle : `lecture.html?print`
  rendu par Chromium sans affichage (une capture par page, ou `page.pdf()`), à
  mettre en travail de la file (`ideation.pdf`, étude § 4) ; l'export PNG actuel
  (PIL) ignore le modèle. **Fait le 06/10** (§ 9) : le travail `presentation.pdf`.
- **Export vidéo** : la frise est exacte (`run.seek(t)`) : Chromium sans affichage,
  une capture par 1/30 s en posant l'instant (transitions comprises, en jouant
  leurs animations à l'arrêt), puis `ffmpeg -framerate 30 -i %05d.png -c:v libx264
  -pix_fmt yuv420p -movflags +faststart` (ffmpeg est sur DGX2). Un travail de la
  file, voie `cpu`.
- La planche montre le fond et les couleurs du modèle, pas son décor (bandes,
  halos, filets) : seulement la scène.
- Les vidéos d'une diapositive jouent muettes, en boucle (`play`, `poster_t` :
  étape 5 de l'étude).
- La co-édition transporte `motion` / `tone` / `pres.template` (le serveur les
  valide par `_node` / `_pres`) ; non essayé à deux dans le mode.

## 8. Le 06/10 : la minuterie dans la convention du portail

Demandes de Cal du 06/10, sur la minuterie « MOTION » du mode :

- **LA tête de lecture** : celle de toutes les timelines (`commun/tete.js` : le trait orange de 2 px et
  son onglet, le geste de la règle par capture du pointeur) remplace le trait de 1 px du mode. La règle
  prend le dessin de LA règle (`.sr-mk` de `tete.css`) mais reste en secondes : le motion se règle à la
  milliseconde (l'onglet Objet écrit des ms), un timecode à l'image n'y dirait rien. Une étiquette tous
  les 64 px au moins (de 0,1 s à 10 s).
- **Plus aucun texte sélectionné** en glissant : le geste de la règle annule le `pointerdown` (comme le
  Montage), et la minuterie, la barre de lecture sont en `user-select: none`.
- **Les boutons du lecteur**, centrés sous la scène : la barre de `commun/lecteur.css` (`.sr-lect-barre`,
  Lecture / Pause `.sr-lect-lire`, le temps `.sr-lect-tc`, l'état, la boucle du lecteur) ; Origine et
  Fin (l'état final) de part et d'autre de Lecture. Clavier : Espace, Origine, Fin.
- **Le clic sur la scène ne rejoue plus rien** (il relançait l'entrée de l'objet cliqué, ce qui empêchait
  d'en changer le texte) : il choisit l'objet ; sur un texte (titre, note, post-it, forme), il y pose le
  curseur et le texte s'écrit sur place, dans l'habit du modèle. L'objet se montre dans son état final le
  temps d'écrire, la tête ne bouge pas, la lecture s'arrête ; Échap, Ctrl+Entrée ou un clic ailleurs le
  posent en un geste (`app.mutate` : Ctrl+Z, co-édition) ; pendant qu'on écrit, Ctrl+Z annule la frappe.
  La scène se refait ensuite au même instant ; la planche qui change entre-temps attend.
- **Un panneau qu'on redimensionne** : la scène et la minuterie l'une sur l'autre, la poignée de
  `commun/split.js` entre les deux (glisser, flèches, double-clic : 220 px) ; la hauteur est gardée dans
  ce navigateur (`sr-split-ideation-motion`), comme les panneaux du Montage et de Transcrire.

Essais (portail d'essai, Chromium sans affichage, sombre et clair, aucune erreur console) : la tête est
`.sr-ph` ; glisser la règle → les pistes → les noms : `getSelection()` vide (l'ancien code sélectionnait
« 0s1s2s DÉCOR décor · glow SCALE… ») ; les boutons à 0 px du centre de la scène, avant comme après la
poignée ; un clic sur le titre : éditable, curseur dedans, la tête à 1,31 s avant comme après (l'ancien
code repartait à 0,31 s) ; Échap écrit « Showrunner 2 bis », Ctrl+Z le retire ; un compteur (128) se
remet en texte, passer d'un texte à l'autre pose le premier ; la poignée : +140 px, retenue au retour.

## 9. Le 06/10 : l'export PDF et PNG (branche `wip2/slides-pdf`)

« Exporter en PDF » dans la barre du mode (`export.js`), et son menu : le PDF et une image par
diapositive, les images seules, imprimer depuis ce navigateur. Le travail `presentation.pdf` (voie
`cpu`, `server/tools/presentation_pdf.py`) lance `tools/presentation_export.mjs` sur la machine du
portail : Chromium sans affichage ouvre `lecture.html?print` — la même scène que le mode (`scene.js`),
chaque diapositive à son état final (aucune entrée jouée), polices attendues (`document.fonts.ready`),
images décodées — puis `page.pdf` (une page nommée par taille de scène : 16:9 et 9:16 dans le même PDF,
1920 × 1080 px = 1440 × 810 pt ; textes et formes vectoriels) et, en option, une capture PNG par page
aux mêmes règles d'impression. Le PDF va dans la bibliothèque : un `document` (dossier « Idéation »,
Workspace de la planche, lignée = ses objets) ; les images : des `image`.

- **Les données** ne passent pas par l'API : le travail lit la planche, les réglages et les fiches au nom
  de la personne (comme `ideation.export`) et les donne au script, qui les sert à la page par
  `page.route` ; seuls les fichiers de ces objets se servent. Ni session ni jeton (la question du
  « jeton de lecture » d'`agent_design.md` § 4.4 ne se pose pas ici). Les pages statiques viennent du
  portail, sur la boucle locale. Le thème : celui de la personne (ses préférences), une scène sans
  modèle prenant les jetons du thème — le PDF montre ce que son mode lui montre.
- **Où sont les outils** (réglages, avec défaut ; absents : le bouton le dit, Admin → Diagnostics →
  « Présentation · PDF » les cherche) : `presentation_node` (`node` du PATH), `presentation_playwright`
  (le dossier d'où node résout Playwright : `~/Character_Sheet`, celui de `tools/shot.mjs`, puis les
  modules globaux du node), `presentation_chromium` (le Chromium de Playwright par défaut). Sur DGX2 :
  non essayé (aucun accès depuis la session cloud) — le diagnostic le dira.
- **Les polices** : un PDF embarque les siennes ; une police dont la licence ne le permet pas
  (`FONTS`, `pdf : false` : Venus Rising, Norelli) le refuse, en disant laquelle et sur quelles
  diapositives ; les images PNG restent possibles. Un texte sans style prend `--f-disp` (Venus Rising) :
  sans modèle ni police OFL, pas de PDF. Question pour Cal (la licence web + PDF de Venus Rising).
- **Ce qui ne s'imprime pas** : une vidéo montre son affiche, un objet Web l'image de son aperçu (sinon
  son titre et son site), un son son onde ; chacun avec un pied discret, en capitales mono (« vidéo »,
  « web · site », « son »). Dans le mode, l'objet Web et le son prennent la même image (le mode
  montrait « web » et un aplat « image ») : le mode et le PDF restent une seule vérité.
- **Sans poppler** sur la machine du portail (non documenté sur DGX2), le serveur ne lit pas le PDF : le
  texte de chaque diapositive (lu dans la page) et la première diapositive en couverture sont déposés
  (`documents.deposer`, via « chromium »).
- **Corrigé en passant** : le mode et le lecteur cherchaient les polices des textes sans style dans
  `meta.deck.fonts` (vide) : la police propre d'un texte (`diapo/libre.js`) ne s'y montrait pas.

Essais (portail d'essai, Chromium 141 du conteneur) : `check.py presentation_pdf` (22 contrôles : trois
pages de 1440 × 810 pt, le texte par `pdftotext`, l'image à sa place sur sa capture, la licence, 9:16,
les pieds, le chemin sans poppler) ; `ideation/pilote_pdf.mjs` (35 contrôles, sombre et clair : le
bouton, son menu, la progression, le document rangé et téléchargé, les refus avec leur raison).
