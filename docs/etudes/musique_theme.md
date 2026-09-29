# ODIO — le nodal rhabillé dans le thème du portail (29/09/2026, soir)

Cal, le 29/09 (très fâché) : « pourquoi sur ODIO on n'a pas notre thème !!! les
nodes avaient le bon design et tu as mis ceux de l'ancien projet qui était du
prototype. » Puis : « garde les fonctions dedans comme on a mais les cards
doivent être avec le nouveau design.. les sliders rotatifs etc doivent être avec
le nouveau design.. on garde juste le code et la logique et on repasse tout dans
notre thème qui est plus abouti. » Et, juste après : « les fils ne sont plus en
screen space aussi.. on doit mettre le design de notre canva dans notre thème qui
est beaucoup mieux réfléchi. »

**État : fini sur le PC et dans la copie d'essai `/tmp/sr_odio_theme` (DGX2,
port 8838). Rien n'est commité, poussé ni redémarré.** La section « Déployer »,
en bas, dit comment le mettre en ligne.

## 1. La référence et ce qui n'allait pas

- **Nos cartes** : le nodal de 4a20f41 (`git show 4a20f41:musique/nodal.js`,
  `musique.css` `.nd-card`, `.kn`, `.nd-wires`). Une carte : panneau relevé
  (`--panel2`), coins de 12 px, filet, point d'accent `--k` (la couleur de la
  piste, sinon du module), nom en `--f-ui` 600, étiquette `.lbl` à droite (la
  piste), molettes à arc de 270° (`ui.js knob`), ports ronds de 13 px (la sortie
  cerclée de l'accent), fils de 2 dans la teinte de la source. `musique/` est
  identique octet pour octet entre 4a20f41 et f9b95e1 : les captures « avant »
  viennent de f9b95e1, qui a en plus le thème clair.
- **En ligne (0d28a9e)** : l'habit des tuiles d'ODIO_01 — tuiles carrées à filet
  d'un pixel, nom en mono 9 px, rails d'un pixel, molettes en cercle d'un pixel
  et aiguille, pas et pads en acier, bornes carrées, fils gris d'un pixel. Et
  **les fils suivaient le zoom** : `vector-effect: non-scaling-stroke` ne tient
  pas sous une transformation CSS dans Chromium (mesuré, § 4).

## 2. Ce qui est fait

Chaque élément visuel du nodal et du banc repasse dans le thème, en réutilisant
les composants du portail et du rack plutôt qu'en les copiant. Aucune classe
que visent les pilotes n'est renommée.

| élément | en ligne (ODIO_01) | maintenant (la source) |
|---|---|---|
| tuile | carré, `--panel`, filet 1 px | la carte d'avant : `--panel2`, filet, coins de 12 px à l'échelle apparente, posés là où la tuile est libre des deux côtés — les sections soudées d'une machine font une seule coque ; choisie : `--panel3` cernée de `--k` (`.nd-card.sel`) |
| accent | l'acier partout | `--k` par tuile (`nodal.js accentDe`) : la piste, sinon le module (`accentOf` de 4a20f41) ; il colore le point, les molettes, les rails, la sortie, les fils |
| en-tête d'un bloc | mono 9 px capitales | le point, le nom en `--f-ui` 600 (12, 11 ou 9 px selon l'en-tête : `measure.js nomDeCarte`), à droite le réglage exposé ou la piste en `.lbl` ; nœud de départ d'une piste : le trait de 2 px en tête des cartes du rack (`.dev`) |
| en-tête d'une section de machine | mono 9 px | le même, en étiquette de machine sur un filet (les `.sec` du rack) |
| témoin | carré vert / corail / gris | le point des cartes : l'accent au repos, vert quand le transport joue, creux éteint (zone de clic ramenée de 6 à 4 px : le milieu d'une tuile étroite reste à la saisie — mesuré, § 3) |
| rails | trait 1 px, curseur 3 × 9 | le curseur de l'arrangement (`.ar-vol`) : piste de 3 px arrondie, trait d'accent, pouce 8 × 12 ; nom en `.kn .l` (mono 8 px capitales), valeur en `.kn .v` (`--f-ui` 600) |
| faders | trait 1 px | le fader de la console (`.fdr`) : rail arrondi, trait d'accent, chapeau plein ombré |
| molettes des machines | cercle 1 px et aiguille | le cadran du rack : `ui.js` exporte `dial()` (piste, arc, aiguille), utilisé par `knob()` et par `machines/panneau.js` — une seule vérité ; `musique.css` partage `.kn .tr/.ar/.pt` avec `.knob__dial` |
| sélecteurs, boutons, pas, pads, diodes, afficheurs, molettes de clavier, touches, ruban, pad orbital, matrice, courbe, vumètre | acier, carrés | `.seg` en miniature (position dans l'accent), pas du séquenceur (`.sq-c` : allumé orange), pads du rack (allumés dans l'accent), le point des cartes, écrans encastrés (`--bg`, coins, filet), touches blanches / noires (deux jetons nommés, § 5), aiguilles et traits dans l'accent |
| étiquettes des contrôles | mono bas de casse | `.kn .l` : mono capitales espacées (Azeret est à chasse fixe : les mesures d'ODIO_01 tiennent) ; exposé : l'accent souligné |
| surface (le dessin d'un effet) | acier, sans coins | écran encastré à coins et filet, la courbe dans l'accent de la carte ; les jetons relus à chaque dessin (le thème peut changer) |
| réglage en grand (zoom sémantique) | valeur en `--f-disp` encre | la valeur en `--f-disp` dans l'accent (`.nd-db`), le nom en `.lbl` |
| groove, clavier, vu | pads acier, vu vert/corail | pas du séquenceur, faders de console, `.mtr` (vert, orange au-delà de −1 dB) |
| bornes | carrés 9 px | les ports d'avant et d'Idéation : ronds de 13 px, anneau de 2, la sortie dans l'accent et pleine quand un fil part ; les notes en losange (celui des jouets) ; à taille d'écran constante |
| fils | gris 1 px, ODIO `cablePath` | `commun/wire.js` (`wireD`, `wireAt`, classes `.sr-wire .vis/.hit`, `.sr-wire-temp`, `.bad`, `.send`) : trait de 2 dans la teinte de la piste ou de la source à 75 %, choisi orange à 3, envois tiretés 6 5, notes en pointillé rond ; **épaisseur, tirets et étiquettes en pixels d'écran** (§ 4) ; le cadre de parentage aux coins des cartes, vert ou orange d'alerte |
| fils et ports des jouets | à l'échelle du monde | en pixels d'écran aussi (`jouets.css`) |
| cadre de sélection, rectangle, poignées, aimantation | acier | ceux d'Idéation : `.selbox` (orange, poignées 9 px à coins), `.marquee` (fond orange léger), guides en `--line-or` à un pixel d'écran |
| groupes | contour ambre, barre de boutons 17 px | le pointillé acier d'un groupe d'Idéation (`.gp.sel`) aux coins des cartes ; sa barre : `.sbar` / `.sbt` d'Idéation ; le nuancier en panneau flottant |
| séparateurs, croisements | ambre | un trait `--line-cy` au survol, pastilles à coins |
| tracé d'ordre et rangs | ambre | le lasso d'Idéation (orange) et ses pastilles (`.selbox .sinfo`) |
| poste de conception, seuils | carrés mono | panneaux flottants du portail (`--panel2`, `--r4`, ombre), titres `--f-disp`, rubriques orange mono, `.tb ghost sm` |
| catalogue | fenêtre carrée | une fenêtre du portail (`.modal`, voile `.scrim`), rubriques `.nv-g`, entrées `.nv-it` (nom en `--f-ui`, référence en `.lbl`), vignettes teintées au survol |
| liste rapide (câble lâché dans le vide) | une liste à elle | **le menu commun** (`commun/menu.js`) : têtes de rubrique, point de teinte, genre à droite — la liste du nodal d'avant |
| PLANO | trois colonnes carrées | une fenêtre du portail, `.tb ghost sm` et `.fld` posés par `plano.js`, sections en cartes, aperçu dans une coque de tuile |
| banc | inchangé (déjà au thème) | les lanes aux teintes d'ODIO_01 en jetons nommés (§ 5) ; disque d'un attracteur en panneau, choisi cerclé d'orange ; poignées à coins |
| panneau latéral d'un jouet | une phrase en capitales 12 px | `.lbl` à sa taille (règle 5 : la prose ne se met pas en capitales grasses) |

Trouvé en chemin : `commun/shell.css` a aussi une classe `.machine` (la carte
d'état d'une machine du portail) ; elle donnait à chaque panneau de section un
fond, des coins et une marge. Neutralisée dans le nodal et PLANO
(`nodal.css`, `.ndx-monde .machine`).

## 3. La logique n'a pas bougé

- Le corps d'une tuile a exactement la place d'ODIO_01 (`tileBody` : même
  en-tête, mêmes filets) et le plancher de lisibilité se mesure comme avant
  (`legible.js` inchangé, `TILE_NAME_FONT` rendu à 9 px mono). Un premier essai
  d'en-tête de 30 px, plus fidèle aux cartes d'avant (35 px), retirait la rangée
  de pas de la boîte à rythme à sa taille d'origine (`nodal_essai.mjs` : 107 →
  91 contrôles) : abandonné. Avec 23 px : 107, comme en ligne.
- Même DOM, mêmes classes, mêmes gestes ; ce qui change en JavaScript : l'accent
  et les coins d'une tuile, l'écriture du nom, la courbe des fils (`wireD`), le
  cadran des molettes (`dial`), le chapeau des faders, la liste rapide (menu
  commun), les classes du portail sur les boutons de PLANO, les teintes des
  lanes. Le nom d'une carte s'écrit en bas de casse (« Délai » et non « DÉLAI »),
  comme en 4a20f41 : c'est la seule différence que voient les pilotes.
- Les pilotes, repassés contre la copie d'essai (8838) **et** contre un portail
  au commit en ligne (8839), comparés clé par clé (`/tmp/sr_th_compare.py`,
  identifiants tirés au hasard normalisés) :

| pilote | résultat |
|---|---|
| `/tmp/sr_odio3_essai.mjs` (l'essai principal) | toutes les mesures identiques (souris, tracé au bouton du milieu, délai partagé et son son, couleurs, pistes, 21 clics droits, Ctrl+Z AZERTY) ; seul écart : le titre du menu d'un effet, « Délai » (voulu) ; journal vide. Une passe intermédiaire a trouvé une vraie régression, corrigée : sur une tuile étroite, la zone de clic du témoin couvrait le milieu de l'en-tête et l'en-tête ne se glissait plus (360 → 360 au lieu de 360 → 588) |
| `/tmp/nodal_essai.mjs` | identique (25 tuiles, 107 contrôles) |
| `/tmp/nodal_essai2.mjs` | identique (zoom sémantique : 27 molettes, 36 pads, 30 noms à 100 % ; 10, 34, 1 à 56 % ; plancher 0,425…) ; `rev` de l'enregistrement 9 au lieu de 8 (une sauvegarde de plus, l'anti-rebond de 600 ms) |
| `/tmp/nodal_essai4.mjs` | **adapté** : la liste rapide est lue sur `.sr-menu .mi` (le menu commun) aussi bien que sur `.palette .palette__item` ; ce qu'il vérifie est inchangé ; ensuite identique (le FILTRE DRIVE naît branché, grouper, ranger, recoudre) ; l'original : `/tmp/nodal_essai4.mjs.orig` |
| `/tmp/nodal_essai5.mjs` | identique (poste de conception, T en édition, PLANO, dézoom : 29 molettes, 26 noms, 15 titres) |
| `/tmp/sr_odio3_gen_drive.mjs` | identique aux graines et identifiants près (moteurs d'essai) |
| `/tmp/sr_odio3_jouets_gestes.mjs` | les quatorze jouets émettent, calage sur la double croche : écart 0, retour à l'ouverture et retrait identiques ; les comptes de notes varient d'une passe à l'autre, sur les deux portails (physique des scènes) |
| `/tmp/sr_odio3_smoke.mjs` | la page, les trois vues, aucune erreur |

- `python3 tools/check.py` dans `/tmp/sr_odio_theme` : **1048 passés, 0 en échec**.
- Aucune erreur de page dans les captures (6 passes) ni dans les pilotes.

## 4. Les fils en espace écran — mesurés

`/tmp/sr_th_fils.mjs` : la session de départ, le fil de la batterie vers sa
tranche, à 25 %, 100 % et 300 % ; on isole le fil (tuiles, bornes et trame
cachées), on prend une coupe de la capture au milieu du fil, l'épaisseur est la
somme des contrastes normalisée par le plus franc des trois zooms et corrigée de
la pente.

| | 25 % | 100 % | 300 % |
|---|---|---|---|
| épaisseur à l'écran — 4a20f41 | 0,5 px | 2 px | 6 px |
| — en ligne | 0,82 px | 1,73 px | 4,27 px (trait de 1,5 : `vector-effect` sans effet sous la transformation) |
| — **après** | **1,86 px** | **1,97 px** | **1,97 px** |
| borne — 4a20f41 · en ligne · après | 3,3 · 9 · **13** px | 13 · 9 · **13** px | 39 · 9 · **13** px |
| étiquette d'un envoi (hauteur) — 4a20f41 · après | 3 · **10** px | 10 · **10** px | 31 · **10** px |
| tirets d'un envoi (monde → écran) — après | 24 20 → 6 5 | 6 5 | 2 1,67 → 6 5 |

Le moyen : `stroke-width`, `stroke-dasharray`, `font-size` en
`calc(… * var(--iz))` (`--iz` = 1 / zoom, posé par `nodal.js`), comme les
bornes et les poignées. Les fils d'Idéation passent par le même
`commun/wire.css` (`vector-effect`) : ils ont très probablement le même défaut —
hors de ce chantier (`commun/`, `ideation/`), signalé.

## 5. Les jetons, et aucune couleur en dur

- Les teintes propres à ODIO_01 sont des jetons nommés dans `musique/nodal.css`,
  sombre et clair : les cinq lanes du banc `--nd-ryt`, `--nd-har`, `--nd-tim`,
  `--nd-nrj`, `--nd-ten` (la teinte d'ODIO_01, #3f7a9c, #6b5fa8, #b0567f,
  #3f8a72, #8a6f5a, la clarté réglée pour 4,5:1 sur les quatre fonds de chaque
  thème : `sr_th_teintes.py`) ; les touches `--nd-key-w`, `--nd-key-b` (des
  renvois à des jetons communs : la blanche plus claire que la noire dans les
  deux thèmes). `banc.js` et `machines/banc/logique.js` les nomment. Aucun jeton
  ajouté à `commun/tokens.css`.
- Les couleurs de piste restent les sept jetons du portail : le serveur les
  valide (`server/tools/music.py`, `COLORS`).
- Le relevé (DGX2, `git diff` de la copie) : les seuls `#…` ajoutés sont ces dix
  définitions de jetons (et deux commentaires qui citent ODIO_01) ; aucun
  `rgb(` ni `hsl(` ajouté. Les 29 de `jouets.css` sont les jetons `--jo-*`
  d'avant, inchangés.

## 6. Les preuves : captures côte à côte

Sur DGX2, `~/showrunner-refs/odio-theme-2909/` (hors du dépôt public) :

- `cote/<thème>_<scène>.png` : 58 images, trois colonnes — **4a20f41 (nos
  cartes) | 0d28a9e en ligne (le prototype) | après**, en sombre (`dark_`) et
  en clair (`light_`) ; « n'existait pas à ce commit » pour ce que 4a20f41
  n'avait pas (machines, jouets, PLANO, seuils…) ;
- les captures entières, par version : `avant/`, `proto/`, `theme/` ; les
  mesures des fils : `*/fils.json` ;
- les scripts : `sr_th_shots.mjs` (la même scène sur les trois portails),
  `sr_th_fils.mjs`, `sr_th_cote.py`, `sr_th_run.sh` (les trois portails d'essai :
  8837 avant, 8839 en ligne, 8838 après), `sr_th_pilotes.sh`, `sr_th_compare.py`.

Les scènes : `cartes_fit`, `cartes_z100`, `_z60`, `_z40`, `_z25`, `_z15` (la
session, zoom sémantique) ; `machines_fit`, `machines_z150`, `_z100`, `_z60`,
`_z35`, `_z20`, `_z12` (MINILOGUE XD, TR-8S, clavier, Ping-pong) ;
`tr8s_z100` ; `jouet_clavier_z100` ; `cable_choisi`, `cable_tire`, `palette` ;
`cadre_en_cours`, `cadre_selection` ; `groupe` ; `conception` ; `trace_en_cours`,
`trace_rangs` ; `catalogue` ; `seuils` ; `plano` ; `banc_attracteur`,
`banc_attracteur_z35`. À montrer à Cal d'abord : `dark_cartes_z100`,
`dark_machines_z100`, `dark_cartes_z25`, `dark_catalogue`, `light_machines_z150`.

## 7. Les fichiers

`musique/nodal.css` (réécrit), `musique/nodal.js`, `musique/ui.js` (`dial`),
`musique/musique.css` (le cadran partagé), `musique/index.html` (`nodal.css`
posé avant le premier dessin : ses jetons sont lus par les dessins sur canvas),
`musique/machines/corps.js`, `panneau.js`, `catalogue.js`, `plano.js`,
`machines/tile/measure.js`, `machines/banc/logique.js`, `musique/banc.js`,
`musique/jouets/jouets.css`, `musique/PROVENANCE.md` ; et
`docs/etudes/musique.md` (§ 6, § 7), `docs/etudes/musique_odio01.md` (§ 3),
ce fichier. Aucun fichier neuf dans le portail (rien à revérifier contre
EasyPrivacy).

## 8. Ce qui diffère encore de nos cartes

- Le corps d'un bloc est celui d'ODIO_01 (rails, faders, dessin, réglage en
  grand), habillé en curseurs du portail : ce n'est pas la rangée de molettes
  des cartes d'avant (« garde les fonctions dedans »). Le cadran rotatif est sur
  les machines, les jouets et le panneau de droite.
- L'en-tête d'une carte fait 23 px (celui d'ODIO_01) au lieu de 35 : un en-tête
  plus haut retire des réglages au zoom sémantique (§ 3).
- Une tranche de piste, à sa taille d'origine, ne montre que son vumètre (comme
  en ligne) ; la carte d'avant montrait volume, panoramique et vumètre. Il
  faudrait agrandir sa taille d'origine (`machines/tuiles.js`) : une décision de
  mise en page, laissée à Cal.
- Les bornes font 13 px à l'écran à tous les zooms (demande de Cal) : à 25 % elles
  pèsent lourd sur les petites tuiles (les cartes d'avant y avaient 3 px).
- Le menu d'une machine posée tout en haut peut passer sous la barre d'outils
  (comme avant).
- `ui.js tok()` garde en cache les jetons lus pour les canvas du banc : un
  changement de thème sans recharger laisse ses courbes dans l'ancien (d'avant ;
  les surfaces des tuiles, elles, relisent à chaque dessin).
- L'intérieur des jouets garde sa palette sombre du Playground dans les deux
  thèmes (voulu : `jouets.css`).

## 9. Déployer (session suivante)

1. `/tmp/sr_deploy` (clone), `git reset --hard origin/main`, y copier depuis le
   PC **les fichiers du § 7** (et eux seuls).
2. `python3 tools/check.py` ; les pilotes du § 3 contre un portail lancé depuis
   ce clone (`/tmp/sr_th_pilotes.sh <nom> <port>`, `/tmp/sr_th_compare.py` pour
   comparer à `/tmp/sr_th_pilotes/proto/`).
3. Commit (« ODIO : le nodal rhabillé dans le thème du portail, les fils en
   espace écran »), push, puis `cd ~/SHOWRUNNER_TOOLS && git fetch && git reset
   --hard origin/main && tools/portail.sh restart`, et DGX1 suit.
4. Arrêter les trois portails d'essai par leur PID (`/tmp/sr_th_*.pid`).

## 10. Aimantation, étiquette de piste, netteté (29/09, 17 h 15)

Trois demandes de Cal sur le nodal. Copie d'essai `/tmp/sr_odio5` (DGX2,
port 8841 = origin/main 7553a54 + ces changements ; `musique/` identique à
810c1b2), la même sans eux sur 8842 (`/tmp/sr_odio5_avant`), pour comparer.
Pilotes et mesures : `/tmp/sr_odio5_pilotes/`, `/tmp/sr_odio5_mesures/`.

### 10.1 « Enlever le magnétisme et l'alignement sur la grille »

Ce qui aimante dans le nodal, relevé dans le code :

| quoi | où | l'aimant éteint |
|---|---|---|
| déplacer une tuile : son bord sur le bord des voisines (jointure et alignement, 7 px d'écran), guides orange | `layout.js snapBox`, `nodal.js startMove` | coupé |
| tirer une arête : sur les arêtes des voisines | `snapValue`, `startResize` | coupé |
| tirer un séparateur de groupe : sur les autres lignes | `snapValue`, `startDividerDrag` | coupé |
| les voisines collées suivent l'arête tirée (le séparateur) | `resizeCoupled(…, coupled)` | **gardé** : ce n'est pas un aimant, c'est ce qui évite trous et recouvrements ; ⌥ le défait, comme avant |
| une machine soudée se déplace entière | `isWeldedGroup` (le groupe, pas la proximité) | **gardé**, n'en dépend pas |
| un câble lâché près d'une entrée la prend (74 px) | `CABLE_SNAP` | gardé : c'est viser, pas ranger |

Il n'y a **pas de grille** : la trame du fond (26 px) est un décor, rien ne s'y
pose (aucun arrondi à `CELL` dans `ecrireBoite`). « L'alignement sur la
grille » que voyait Cal, ce sont les guides des arêtes voisines. D'où **un
seul interrupteur**, « aimant » : le code ne distingue pas deux aimants.

- Barre du nodal : `Aimant` (`.tb.sm.on`, vert, `aria-pressed=true`) ou
  `Libre` (`.tb.ghost`) — les mots d'Idéation (« Aimant » / « Libre »),
  l'habit du bouton « gamme » du piano roll ; le titre dit l'état et le geste.
- Clic droit du fond : « Aimanter aux voisins », case cochée, `Ctrl+4`.
- **Ctrl+4** : le raccourci de l'aimant de l'arrangement d'ODIO
  (`timeline.js`, par `e.code` : juste en AZERTY) ; Montage prend `S`, qui
  est ici le solo de Live ; Idéation n'en a pas.
- **⌥ en glissant** : libre le temps du geste, inchangé (Idéation, arrangement,
  Montage font de même).
- Mémorisé dans l'état d'interface du projet, `ui.aimantNodal` (absent =
  allumé), par `app.saveUi` comme `ui.snap` de l'arrangement. Hors de
  l'annulation, comme lui (`projet.js` ne met pas `ui` dans les instantanés).
- Soudure des machines : intacte (voir le tableau). Seule nuance : en poste de
  conception, une section glissée aimant éteint ne se recolle plus d'elle-même
  à ses sœurs ; « Remonter la machine » (T) la remet.

### 10.2 « Déplacer les nodes de piste par la grosse étiquette »

**Retenue : `.piste-titre`**, l'étiquette au nom de la piste (Venus Rising
capitales, pastille de couleur, à taille d'écran constante) posée à gauche du
nœud de départ d'une piste — ou de toute la machine-instrument (captures
`pilote/etiquette_*.png` : « BATTERIE », « BASSE »). C'est la seule
« grosse » étiquette d'un nœud de piste ; l'en-tête de la tuile, lui, se
glissait déjà. Avant : un clic la choisissait, rien ne la déplaçait.

Maintenant son `pointerdown` fait ce que fait l'en-tête : le choix (clic :
elle ; Maj : ajouter ; Ctrl : ajouter ou retirer ; un clic sans glisser sur
une piste prise dans une sélection plus large ne garde qu'elle) puis
`startMove` sur le nœud — la même fonction, donc la sélection, le groupe, la
machine soudée entière, ⌥ duplique, le même aimant, un seul commit donc un
seul Ctrl+Z. Gardés : la pastille (palette), le double-clic sur le nom
(renommer), le clic droit (le menu de la piste), le bouton du milieu (la vue
se déplace). Curseur : `grab`.

Trouvé en route : `startMove` repeignait tout le dessus au relâcher d'un
clic sans geste ; l'étiquette, remplacée sous le pointeur, perdait son
`click` et son `dblclick` (le renommage ne s'ouvrait plus). Ce repeint ne
servait à rien (rien n'avait bougé, le choix repeint déjà) : retiré.

### 10.3 Le texte flou au zoom — mesuré

Le diagnostic à vérifier avait deux moitiés :

1. **« `nettete()` ne produit jamais d'image sans will-change »** : juste. La
   classe `ndx-net` était posée dans un minuteur et retirée au rappel
   requestAnimationFrame suivant — qui passe avant le calcul du style et le
   dessin de cette même image (HTML, « update the rendering »). Mesure : la
   neutraliser (`SANSNET=1`, will-change jamais levé) ne change **aucun**
   chiffre.
2. **« will-change fige l'échelle de rastérisation »** : c'est la règle
   documentée par Chrome (developer.chrome.com/blog/re-rastering-composite,
   Chrome 53, 2016 : le contenu est re-rastérisé quand l'échelle change,
   *sauf* s'il porte `will-change: transform`). Mais **je ne l'ai pas
   reproduite** avec le Chromium 153 de DGX2 : ni en coquille sans
   affichage (SwiftShader), ni en Chromium complet (SwiftShader, puis la
   carte NVIDIA GB10 par EGL), ni à une densité d'écran de 1,5, ni sur une
   scène de 43 tuiles (6400 × 3200 px de monde) ; ni au repos, ni 63 ms
   après le dernier cran de molette. Le texte des molettes y est net avant
   comme après.

La netteté d'une coupe (`sr_odio5_nettete.mjs`) : la moyenne des 1 % plus
fortes marches entre pixels voisins sur le contraste de la coupe (≈ 1 net,
≈ 1/z si une image de 100 % était étirée) ; molettes « Champ » / « Boucle »
du jouet AIMANT, vue posée puis 1,5 s ; 280 % = `MAX_K`, 300 % ne s'atteint pas.

| Chromium 153 | 100 % | 200 % | 280 % |
|---|---|---|---|
| coquille, SwiftShader — avant | 0,99 / 1,07 | 0,97 / 1,08 | 0,92 / 0,99 |
| — après | 1,06 / 1,11 | 0,97 / 1,08 | 0,92 / 0,99 |
| complet, GPU NVIDIA, 43 tuiles — avant | 0,96 / 1,02 | 0,94 / 1,07 | 0,89 / 0,98 |
| — après | 1,03 / 1,10 | 0,94 / 1,07 | 0,89 / 0,98 |
| complet, GPU, densité 1,5 — avant = après | 0,97 / 1,04 | 0,89 / 0,95 | 0,83 / 0,78 |

(Les coupes, par zoom : `nettete_avant/`, `nettete_apres/`, dans les
captures ; à 1,5 le chiffre baisse par la géométrie des glyphes, l'image
reste nette.)

Ce qui était **vraiment** sous-résolu : **le canvas des jouets**
(`jouets/index.js`), plafonné à ×2 — à 280 %, 1036 px de bitmap pour 1450 px
d'écran (étiré de 40 %), 1036 pour 2175 pixels physiques à densité 1,5.

Ce qui est fait :

- `.ndx-monde` n'est plus promu au repos ; `.ndx-geste` (will-change:
  transform) est posé au premier événement d'un geste de la vue (molette,
  bouton du milieu, −, +, 100 %) et **retiré pour de bon** à l'arrêt (160 ms,
  `repos()` dans `nodal.js`). Au repos, le monde se peint avec la page à
  l'échelle affichée : net dans tout navigateur, quelle que soit sa règle pour
  will-change. `nettete()` et `.ndx-net` sont retirés.
- Les canvas des jouets suivent `zNet` (l'échelle à laquelle le monde est
  net : figée pendant le geste, celle de la vue au repos) : ils se
  réallouent une fois, à l'arrêt ; plus de plafond ×2, un budget de 4 Mpx par
  canvas (l'AIMANT à 280 % sur un écran à 150 % y tient). À 280 % : 1489 px de
  bitmap pour 1450 d'écran ; la marche de la coupe de scène 24,4 → 26,2.

Fluidité (150 images, un événement par image, depuis le repos — donc avec la
promotion du premier geste) :

| | zoom : i/s (p95) | déplacement : i/s (p95) |
|---|---|---|
| GPU, 43 tuiles — avant (2 passes) | 50,8 · 52,6 (33 ms) | 60 · 60 (17 ms) |
| — après | 52,3 · 53,9 (33 ms) | 60 · 59,6 (17 ms) |
| GPU, densité 1,5 — avant (1) · après (2) | 52,3 · 48,9 et 52,9 (33 ms) | 60 · 60 et 60 |
| coquille SwiftShader, 16 tuiles — avant (2) | 20,9 · 20,7 | 32,5 · 32,5 |
| — après (2) | 22,2 · 21,4 | 31,3 · 31,0 |

Pas de dégradation hors du bruit d'une passe à l'autre.

**Reste à savoir** : le flou de la capture de Cal ne se reproduit pas ici.
Il faut son navigateur (Chrome, Edge, Firefox ? version), l'échelle
d'affichage de Windows, et si le texte redevient net une seconde après
l'arrêt du zoom. Le remède ne dépend plus de la réponse ; si le flou reste
avec cette version, la cause est ailleurs et la mesure est à refaire chez lui.

### 10.4 Les preuves

- `python3 tools/check.py` sur la copie : **1108 passés, 0 en échec**.
- `/tmp/sr_odio5_pilotes/sr_odio5_pilote.mjs` (neuf) : **25 vérifications,
  0 en échec** — l'aimant allumé colle (380 et non 384) et trace ses guides ;
  éteint par la barre, une tuile lâchée à 4 px y reste, sans guide ; « Libre »
  après rechargement (`ui.aimantNodal=false` relu du serveur) ; le clic droit
  le rallume (il colle de nouveau) puis l'éteint (elle reste) ; Ctrl+4 dans
  les deux sens ; ⌥ libère le temps d'un geste ; l'étiquette : clic, Maj,
  Ctrl, glisser (+137, +61 px exacts), Ctrl+Z en un pas, double-clic
  (renommer), clic droit (menu de la piste), une MINILOGUE XD emportée entière
  (11 sections, même écart), bouton du milieu = la vue. Journal vide.
- Les pilotes du rhabillage (`/tmp/sr_th_pilotes.sh`, `odio5_avant` 8842 contre
  `odio5` 8841, `/tmp/sr_th_compare.py`) : `nodal`, `nodal4` (aux identifiants
  près), `nodal5` (idem) identiques ; `nodal2` : `rev` 8 contre 9 (varie
  d'une passe à l'autre du même code : 8, 9, 8 dans les passes du § 3) ;
  `gen`, `jouets` : graines et physique, comme au § 3 ; `smoke` ouvre le
  dernier projet de chaque dossier de données. **Un écart voulu** dans
  `sr_odio3_essai` : son « Ctrl + cadre sur m3 » part à 20 px à gauche de m3,
  c'est-à-dire **sur l'étiquette BASSE** ; avant, ce Ctrl+clic sur l'étiquette
  remplaçait la sélection par m3 (`["m3"]`), maintenant Ctrl retire m3 comme
  sur son en-tête (`["m1"]`, ce que le pilote attendait : « il en sort »),
  et le geste déplace m3 comme le ferait son en-tête.
- Netteté et fluidité : `sr_odio5_nettete.mjs` (§ 10.3).
- Captures (DGX2 `/tmp/sr_odio5_mesures/`, copiées sur le PC) :
  `pilote/barre_libre`, `clic_droit_libre`, `clic_droit_aimant`,
  `aimant_allume_pendant` (guides), `aimant_barre_pendant` (aucun),
  `etiquette_avant` / `_pendant` / `_apres` / `_renommer`, `machine_apres` ;
  `nettete_avant/`, `nettete_apres/` (`direct_z100|200|280_champ|boucle|scene|vue`).

Fichiers : `musique/nodal.js`, `musique/nodal.css`, `musique/jouets/index.js`,
`musique/guide.js` (les deux lignes du nodal), ce paragraphe.
