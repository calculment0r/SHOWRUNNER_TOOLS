# Le mode Présentation, le motion et les modèles (30/09/2026)

> **09/10** : la passe assistée devient un outil de la skill « slides » de `agent_autonome.md` (§ 6, lot 4).

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
  file, voie `cpu`. **Fait le 06/10** (§ 10) : le travail `presentation.video`.
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

## 10. Le 06/10 : les idées reprises d'une note de spécification (branche `wip2/motion-editeur`)

Cal a partagé le 06/10 l'image d'une note de spécification d'un éditeur local de motion design
(« pour notre partie motion, ça peut être pas mal de prendre des idées dedans »). Ce qu'elle tient en
une phrase : **l'image d'un instant ne dépend que du projet et de cet instant**, et la même fonction
dessine l'aperçu et l'export. On la compare ici point par point au mode Présentation ; on en reprend
ce qui manque sans demander de décision, dans notre architecture (modules ES sans construction, serveur
en bibliothèque standard, la planche d'Idéation comme seule vérité) — pas sa pile (Vite, React,
TypeScript, Zustand, zod, Express), ni son dossier de projet à part.

### 10.1 Point par point

| la note | chez nous avant le 06/10 | ce qu'on en fait |
|---|---|---|
| une seule source de vérité, validée par schéma | la planche ; le motion borné par `schema.json`, lu par le moteur, le serveur (`clean_motion`) et le contrôle | **déjà**. Les clés et les courbes libres entrent dans le même schéma (`keys`, `ease_free`) ; la page et le serveur les nettoient de la même façon (le contrôle compare) |
| une fonction pure `renderFrame(projet, t)` en Canvas 2D, pour l'aperçu et l'export | la scène (`scene.js`) et la frise du moteur (`run.seek(t)`), en DOM et Web Animations : le mode, le lecteur, l'impression | **le principe repris, pas le Canvas** : notre texte est du vrai texte (le PDF vectoriel, `text-wrap: balance`, les polices des modèles), le moteur et ses dix modèles sont en DOM. Neuf : `programme.js` met la présentation entière bout à bout et la pose à n'importe quel instant (`seek(t)`) ; le MP4 l'appelle pour chaque image |
| rien que (projet, t) : ni horloge, ni hasard non semé, ni animation CSS, ni état accumulé | aucune animation CSS dans la scène, aucun hasard dans le rendu (le seul `Math.random` nomme les affiches des modèles) ; la parallaxe au pointeur est un état accumulé, mais en direct seulement | **vérifié et corrigé** (§ 10.2) : les vidéos d'une diapositive tournaient seules ; la sortie et les transitions ne se jouaient qu'en temps réel ; le compositeur de Chromium gardait l'histoire des images |
| aperçu à la densité de l'écran, export à la pleine taille, texte net en 4K | vrai par construction : la scène est mise à l'échelle par `transform`, le navigateur redessine le texte à la densité de l'écran (jamais une image agrandie) | **repris pour l'export** : 1080p, ou 2160p par `deviceScaleFactor: 2` (le texte et les formes redessinés à cette taille) |
| des images clés par propriété `[{time, value, easing}]` | des effets déclaratifs (entrée, sortie, boucle, profondeur, étape) | **repris** : `motion.keys = {x, y, scale, rot, op: [{t, v, e, p}]}`, sur une enveloppe neuve `.pm-k` (translate, rotate, scale, opacity : les propriétés de transformation individuelles, y additionné à x), par-dessus les effets ; t compté depuis l'étape de l'objet. Pas repris : animer la typographie, l'alignement, l'espacement, la couleur — le texte suit son modèle (ses six styles) ; à décider |
| courbes : linéaire, ease-in/out/in-out, cubic-bezier libre, ressort {raideur, amortissement, masse} | huit courbes nommées, dont un ressort fixe | **repris** : `in` et `out` (easings.net), la cubic-bezier libre `{bz}`, le ressort réglé `{spring: {k, c, m}}` ; le ressort est rendu en `linear()` et la valeur calculée en JavaScript (`valueAt`) est l'interpolation des mêmes points : ce que le panneau affiche est ce que le navigateur peint |
| des préréglages (glisse, fondu, échelle ; entrée, sortie ; direction, distance, délai, durée, courbe) qui FABRIQUENT des clés ordinaires ; réappliquer remplace, annulable | `modeles.js` donne un motion par part d'objet, décalé par le rythme ; `assist.js` propose un modèle et des entrées pour toute la présentation — des EFFETS, pas des clés | **repris sans doubler** : les préréglages servent l'objet choisi et fabriquent des clés marquées `p: 'in' | 'out'` ; les reposer ne remplace que les leurs ; l'entrée par effet passe à « Aucune ». La passe assistée reste la proposition d'ensemble |
| un décalage en cascade sur une sélection (avant, arrière, hasard semé ; intervalle) | le rythme du modèle (l'ordre de lecture) ; `in.stagger` décale les unités d'un texte | **repris** sur les objets choisis (Maj + clic) : « avant » est l'ordre de lecture (`readOrder`), le hasard est semé (mulberry32 : la même graine, le même ordre) ; le début de chacun (son entrée, ses clés) se décale, rien ne change de forme |
| la timeline : blocs de scène aux bords déplaçables, barres de calque début / fin, losanges déplaçables, la tête, le zoom | la minuterie d'une diapositive : une barre par entrée (le délai, la durée), LA tête de lecture | **repris** : un losange par instant où l'objet a une clé, une ligne par propriété sous l'objet choisi, le glisser (un pas d'annulation) ; le bord gauche d'une barre (le début). **Pas repris** : les blocs de scène (nos diapositives n'ont pas de durée dans une frise commune — question 6) ; le zoom (la minuterie tient la diapositive dans sa largeur ; la molette commune `commun/molette.js` le donnerait) |
| le panneau des propriétés : transformation, opacité, typographie, couleur ; la bascule d'image clé à la tête ; le choix de courbe et son aperçu en direct ; des libellés simples, une infobulle par réglage | l'onglet Objet : entrée, découpe, délai, durée, courbe (une liste), décalage, distance, étape, boucle, profondeur, sortie | **repris** : les cinq propriétés à la tête (la valeur, ‹ ◆ ›), la courbe de la clé choisie, le choix de courbe (`courbe.js` : le dessin redessiné pendant qu'on glisse une poignée ou un réglage du ressort, « Voir ») pour l'entrée, la transition et les clés ; une infobulle en mots simples sur chaque réglage de l'onglet. La typographie et la couleur : celles de la planche (`diapo/libre.js`) |
| la lecture : Espace, pas à pas ← →, le temps et le numéro d'image | Espace, Origine, Fin, la boucle ; ← → changent de diapositive | **repris** en Maj + ← → (image par image, 30 i/s) et « i 42 » à côté du temps ; ← → gardent leur rôle |
| annuler / rétablir, un glisser = un pas | `app.mutate` (la pile de l'Idéation, la co-édition) | **déjà** ; chaque geste neuf est un `app.mutate` |
| enregistrer / ouvrir un dossier `.motion`, un `.zip` | la planche vit dans le portail (co-édition, bibliothèque) | **pas repris** |
| l'export MP4 : Chromium sans affichage sur une page de rendu, `renderFrame` à chaque image, ffmpeg libx264 yuv420p CRF 16 +faststart, après `document.fonts.ready` et le décodage des images, progression, annulation ; ffmpeg absent : le dire | l'étude le prévoyait (§ 7) ; le PDF passait déjà par Chromium sans affichage (§ 9) | **repris par le chemin du PDF** (§ 10.3) |
| hors champ de sa première version : son, vidéos en calque, transitions, effets | des transitions (huit), des vidéos jouées muettes, des effets | rien à reprendre ; le son du MP4 : question 4 |
| la vérification RÉELLE : interpolation, chaque courbe, déterminisme, un essai de bout en bout, un export de 3 s dont trois images sont comparées au rendu | les contrôles du schéma, les pilotes du mode et du PDF | **repris** (§ 10.4) |
| le calque « curseur » (une souris animée, ses clics) | — | **pas fait** (§ 10.5) |

### 10.2 Le déterminisme, mesuré

- **Les vidéos** d'une diapositive jouaient seules (`autoplay`, `loop`) : l'image d'un instant dépendait
  de l'horloge. `run.seek(t)` les pose maintenant à t (en boucle sur leur durée), en pause ; `playFrom(t)`
  les lance de là ; le rendu attend qu'elles y soient (`seeked`). Le lecteur plein écran les laisse tourner.
- **La sortie et les transitions** se créaient au moment de les jouer et s'attendaient : elles n'avaient
  pas d'instant. `run.exitAnims()` et `transition(…, { paused })` créent les mêmes animations en pause et
  rendent de quoi les retirer (le volet, le rideau, la toile, les paires du morph rendus tels qu'avant) ;
  `exit()` et `transit()` les jouent comme avant (le lecteur est inchangé : 37 diapositives de cinq
  exemples lues sans erreur).
- **Le compositeur** : la scène posée au même instant, deux fois de suite, différait de 1 à 2 niveaux sur
  la couture d'un pixel où deux scènes se touchent (une poussée) ; rejointe par un autre chemin, 21 des 36
  transitions des cinq exemples différaient d'un niveau sur quelques pixels — avec, élément par élément,
  les mêmes styles calculés (vérifié sur les 135 éléments d'une scène). Chromium garde la trame d'un
  calque qui porte une animation ou une transformation 3D d'une image à l'autre. Le rendu image par image
  fige donc chaque image : chaque animation écrit sa valeur en style (`commitStyles`) puis se retire le
  temps de la capture, et un `translate3d(x, y, 0)` figé devient un `translate(x, y)` (la même image, sans
  calque à part) ; la suivante les remet. Mesuré : les 36 transitions, rejointes par trois chemins, donnent
  les mêmes pixels. Les drapeaux de Chromium essayés n'y suffisaient pas (`--disable-gpu-rasterization`
  en laissait 7, `--disable-partial-raster`, `--run-all-compositor-stages-before-draw`, le rendu logiciel :
  rien). Coût : 134 ms par image 1080p au lieu de 117 (Chromium du conteneur, SwiftShader).

### 10.3 L'export MP4

- **Le menu** « Exporter » du mode (▾) : « Vidéo · la présentation » (1080p, 30 i/s), « Vidéo · cette
  diapositive », « Vidéo · la présentation en 4K » (2160p). Une entrée impossible dit pourquoi (Chromium
  ou ffmpeg absents de la machine du portail, une police que sa licence refuse, un export en route, un
  aperçu ou une passe ouverts) ; le panneau d'export suit le travail (la ligne de la file, « Arrêter ») et
  donne « Télécharger la vidéo » et « Dans Asset ↗ ».
- **Le travail** `presentation.video` (voie `cpu`, `server/tools/presentation_video.py`) prend le chemin du
  PDF : il lit la planche au nom de la personne, écrit le spec, lance `tools/presentation_export.mjs`
  (`kind: video`), qui ouvre `lecture.html?video` (la page de rendu, sans interface : `programme.js`),
  attend les polices et les images, puis pour chaque image k : `SR_RENDU.seek(k / fps)`, une capture PNG
  (sans perte), donnée à ffmpeg par son entrée standard (`-f image2pipe -c:v png`, puis `libx264`,
  `yuv420p`, CRF 16, la matrice BT.709 et ses marques — une vidéo HD sans marque est lue en BT.709 par les
  navigateurs, swscale aurait converti en BT.601 sans le dire —, `+faststart`). La note demandait des
  images brutes : Playwright rend du PNG, le décoder dans node demanderait une dépendance ; le PNG est sans
  perte, ffmpeg le décode. Arrêter le travail tue node, Chromium et ffmpeg (le groupe de processus).
  La vidéo va dans la bibliothèque : une `video`, dossier « Idéation », Workspace de la planche, lignée =
  les objets montrés. Réglages : `slide` (une diapositive), `fps` (24, 25, 30, 50, 60), `scale` (1, 2),
  `hold` (la pause d'une diapositive sans avance seule, 2 s par défaut).
- **La frise de la vidéo** est celle du lecteur : la transition de chaque diapositive, ses entrées qui
  partent pendant la transition (la même part, `LEAD`, partagée avec le lecteur), ses étapes au clic
  bout à bout, la pause, sa sortie. Ce qui diffère : la première entre dès 0, les étapes se suivent sans
  clic, la parallaxe au pointeur n'existe pas.
- **Les polices** : une vidéo diffusée embarque le dessin des lettres ; Venus Rising et Norelli (`FONTS` :
  « pas de PDF ») refusent donc aussi la vidéo, en disant laquelle et sur quelles diapositives — la règle
  du PDF, gardée telle quelle. **La décision est à Cal** (question 1).
- **Le PDF et l'état final** : un objet porte l'état final de ses clés en style (ce que montrent
  l'impression, prefers-reduced-motion et le bouton Fin) ; les animations le recouvrent pendant la frise.

### 10.4 Preuves (portail d'essai, Chromium 141 du conteneur, ffmpeg 6.1)

- `tools/check.py presentation` : chaque courbe va de 0 à 1 ; la linéaire est la diagonale, l'entrée lente
  au début, la sortie lente à la fin, l'entrée-sortie symétrique ; une cubic-bezier (0, 0, 1, 1) est la
  diagonale, (0,42, 0, 0,58, 1) donne 0,12916 à x = 0,25 (la courbe de WebKit) ; le rebond dépasse ; le
  ressort peu amorti oscille, le très amorti arrive sans dépasser ; le ressort en JavaScript est la courbe
  `linear()` peinte (écart 0) ; l'interpolation (avant la première clé, après la dernière, entre, la courbe
  de la clé qui part) ; les clés de la page et du serveur identiques sur les mêmes entrées ; les animations
  Web qu'on en tire ; poser, basculer, déplacer ; les préréglages (fabriquer, reposer, une sortie en plus) ;
  la cascade (avant, arrière, hasard semé reproductible) ; l'aller-retour d'une planche avec des clés.
- `tools/check.py presentation_video` : le même instant rendu deux fois donne les mêmes pixels ; la forme
  menée par un ressort est, à 1,1 s, là où `courbes.js` la place (à 3 px près) ; pendant une poussée, le
  même instant rejoint par trois chemins donne les mêmes pixels ; un MP4 de 3 s (1080p, 30 i/s, 90 images,
  H.264, yuv420p, BT.709, l'index en tête), sa première, sa médiane et sa dernière image extraites par
  ffmpeg contre le rendu au même instant : écart moyen 1,3 / 255, PSNR 45 dB (seuil : 3 / 255, 32 dB) ;
  arrêté en route : rien n'est rangé, plus de processus ; la présentation entière (72 images à 24 i/s) ;
  la licence (Venus Rising refuse la vidéo).
- `ideation/pilote_motion.mjs` (sombre et clair, aucune erreur de console, un seul bouton orange) : glisser
  le losange de « position x » (0,40 s pendant le geste, 400 ms écrits), Ctrl+Z le remet ; un clic sur un
  losange choisit la clé ; « ressort réglé » change la courbe dessinée, la raideur glissée la redessine
  sans rien écrire, lâchée elle s'écrit ; une poignée de cubic-bezier glissée ; « Poser l'entrée » fabrique
  des clés, Ctrl+Z les retire ; la cascade sur trois objets (200 ms : le corps à 200, la forme à 400),
  Ctrl+Z ; « Vidéo · cette diapositive » : la progression, la vidéo rangée (1920 × 1080, 3 s).
  `ideation/pilote_pdf.mjs` passe toujours (il lit le menu par ses libellés : le menu a grandi).

### 10.5 Ce qui n'est pas fait, et les questions pour Cal

- **Le calque « curseur »** (la note : une souris animée, ses points glissés sur la scène, des clics à des
  instants avec une onde, la trajectoire lissée) : un objet de la scène dont la place suit des images
  clés x, y (les mêmes que ci-dessus), et des clics `[{t}]` dessinés comme une onde qui s'ouvre ; le
  préréglage « aller vers un objet » poserait deux clés. Non fait : le reste d'abord.
- **Le zoom de la minuterie** (la molette commune) et les **blocs de diapositives** d'une frise commune.

Questions :
1. **Polices** : Venus Rising et Norelli refusent le MP4 comme le PDF (une vidéo diffusée embarque le dessin
   des lettres), mais une image PNG passe : garder ce refus, ou traiter la vidéo comme les images ? La
   licence (Typodermic Desktop License) n'a pas été lue ici : non documenté.
2. Un objet qui **sort par images clés** pendant sa diapositive est absent de l'état final, donc du PDF
   (juste par construction : le PDF montre la fin). Le PDF doit-il plutôt montrer « tout visible » ?
3. La **pause** d'une diapositive sans avance seule, dans la vidéo : 2 s. D'accord ?
4. Le **son** : aucune piste dans le MP4 (les vidéos d'une diapositive sont muettes). Une musique de fond
   (un son de la bibliothèque) ?
5. Animer la **typographie et la couleur** par images clés (la note les met dans son panneau) ?
6. Une **frise de toute la présentation** (les diapositives en blocs dont on tire les bords : leur durée) ?
