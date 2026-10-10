# Transcrire — dix propositions d'interaction (10/10/2026)

Cal, 09/10 : « on veut des interactions simples, rapides, et on élimine des clics pour que tout soit fluide
[…] je veux des features géniales, comme quand on travaille avec un zoom sémantique ». Ce fichier est
l'étude pour Transcrire (un son ou une vidéo → le texte horodaté, les voix, la traduction, les sous-titres, le
carnet). Pas de code : des propositions, chacune avec le geste d'aujourd'hui compté, le geste proposé, le principe
et sa source, le coût.

Les mots sont ceux du lexique (`docs/etudes/redaction.md`) : un média, une réplique, une voix, le carnet, un
rendu, un calcul. Le moteur de transcription est factice dans le portail d'essai (le câblage réel attend l'accord
de Cal, `docs/etudes/transcrire.md`).

## 1. Ce qui a été mesuré

Un portail d'essai neuf (`tools/portail_essai.py 9041`, moteurs factices), Chromium sans affichage, un pilote qui
fait les parcours et compte chaque geste. Le pilote et ses captures sont dans le scratchpad de la session :
`ib2/p_transcrire.mjs`, `ib2/p_transcrire-dark.txt` (le relevé), `ib2/shots/tr-*.png`, la capture annotée
`ib2/annotees/transcrire-ouverte.png`.

| parcours (aujourd'hui) | clics | champs | touches | gestes |
|---|---|---|---|---|
| un entretien, voix séparées, traduit : « Bibliothèque », la vignette, « Complet », « Traduire en », la langue, « Transcrire » | 6 | | | **6** + l'attente |
| le même, les réglages déjà bons : « Bibliothèque », la vignette, « Transcrire » | 3 | | | **3** + l'attente |
| depuis le panneau Asset : Ctrl+Espace, double-clic sur le son, « Transcrire » | 1 + 1 double-clic | | 1 | **3** |
| corriger une réplique : double-clic, la correction, Entrée | 1 double-clic | 1 | 1 | **3** par réplique |
| le carnet : « Tout préparer », ou « Écrire » sur chacune des quatre parties | 1 à 4 | | | **1 à 4** + des attentes |
| un fichier de sous-titres : « Exporter », « Sous-titres SRT » (menu de 7 entrées) | 2 | | | **2** |
| un passage du son, à part (pour le Montage ou un autre outil) | — | | | **impossible ici** |

Ce qui est déjà bien, et qu'on garde : le texte et le carnet côte à côte ; un clic sur une réplique y met la tête,
↑ ↓ passent de l'une à l'autre ; le nom d'une voix se tape une fois et se pose partout ; la frise des voix ; le
clavier du Montage (Espace, J K L) ; l'annulation de chaque correction ; « Envoyer au Montage » pour un compte
Studio.

Les frictions vues :
- **Choisir n'est pas lancer** : un média choisi ou déposé attend encore « Transcrire », alors que les réglages
  (mode, langues) sont presque toujours ceux de la dernière fois (ils sont gardés : `store`, `transcrire.js`).
- **Pour transcrire une vidéo de Vidéo ou du Montage, on change de page** : Transcrire, puis la chercher.
- **Le carnet attend qu'on le demande** : quatre « Écrire » et un « Tout préparer » ; rien n'est écrit tant qu'on
  n'a pas cliqué.
- **Un même mot mal entendu se corrige autant de fois qu'il revient** (3 gestes chaque fois).
- **Le texte ne découpe rien** : on lit le passage qu'on veut, mais pour l'avoir à part il faut aller dans le
  Montage et le chercher à l'oreille.
- **Les réglages de la prochaine transcription restent affichés** à gauche une fois le texte là (capture annotée,
  repère R) : la colonne prend la largeur dont le texte aurait besoin.
- **Les répliques ne se recalent pas à la main** : sur la frise, clic et glisser ne déplacent que la tête
  (`tr-strip`, « clic, glisser : la tête de lecture »).

## 2. Les dix propositions

« Géniale » : ça change la façon de travailler. « Rapide » : ça enlève des clics tout de suite.

### 1. Déposer, c'est transcrire — rapide

- **Aujourd'hui** : « Bibliothèque », la vignette, « Transcrire » (3 clics) ; un fichier déposé attend aussi
  « Transcrire ».
- **Proposé** : un média déposé (fichier, vignette du panneau Asset, double-clic dans le panneau) **part tout de
  suite** avec les réglages de la dernière fois ; la ligne du calcul dit les réglages (« complet · français → anglais »)
  et porte « Arrêter » ; changer un réglage pendant l'attente relance avec le nouveau. 1 glisser.
- **Ce que ça change pour Cal** : on lâche dix sons, on revient lire dix textes.
- **Principe** : la force des défauts — la plupart des gens gardent la valeur proposée [1] ; la règle 7 du thème :
  rien à valider qui pourrait se faire seul.
- **Coût** : petit (`setItem` appelle `launch` ; la file sait arrêter). **Dépend de** : rien ; Cal choisit si le mode
  Complet (plus long) peut partir seul.

### 2. Transcrire sans quitter l'outil — rapide

- **Aujourd'hui** : depuis Vidéo, Asset ou le Montage : changer de page, « Bibliothèque », retrouver le média,
  « Transcrire » (1 page + 3 clics).
- **Proposé** : **« Transcrire »** dans le menu ⋯ d'une vidéo ou d'un son, partout (le fil, Asset, un plan du
  Montage) : le calcul part, la vignette prend une pastille « texte » quand il est fini ; un clic dessus ouvre la
  transcription. 2 clics, sans changer de page.
- **Ce que ça change pour Cal** : la transcription devient une propriété du média, pas un détour.
- **Principe** : agir sur l'objet là où il est [2] ; le menu ⋯ commun (`commun/menu.js`) le porte déjà dans tous
  les outils.
- **Coût** : petit (une entrée de menu qui appelle la route de Transcrire avec les réglages gardés ; le badge dans
  `commun/fil.js`). **Dépend de** : la n° 1 (partir avec les réglages de la dernière fois).

### 3. Le texte comme ciseaux — géniale

- **Aujourd'hui** : un passage d'interview pour le Montage : ouvrir le Montage, poser le média, l'écouter, marquer
  l'entrée et la sortie à l'oreille, couper (≈ 8 gestes) ; depuis Transcrire, impossible.
- **Proposé** : **sélectionner des mots** dans le texte choisit le passage sur l'onde (et l'inverse). Sur la
  sélection, un petit menu : **Écouter en boucle**, **Extraire** (un son ou une vidéo coupés, rangés dans Asset),
  **Envoyer au Montage** (le plan avec son entrée et sa sortie), **Copier avec le temps**. 2 gestes : sélectionner,
  choisir.
- **Ce que ça change pour Cal** : on trouve un passage en lisant, on l'emporte sans l'avoir cherché à l'oreille.
- **Principe** : Descript, « Edit like a doc » — le texte et le média ne font qu'un, ce qu'on fait à l'un arrive à
  l'autre [3].
- **Coût** : moyen (la sélection de texte vers une plage : les mots ont leur instant en mode Complet ; la découpe
  existe côté serveur pour les exports du Montage, ffmpeg). **Dépend de** : le mode Complet (en Rapide, une
  réplique entière est le plus petit morceau) ; une réplique corrigée perd l'instant exact de ses mots, répartis au
  prorata (`seg_words`, `server/tools/transcrire.py`) : la coupe y est moins précise.

### 4. Le carnet qui s'écrit seul — rapide

- **Aujourd'hui** : « Tout préparer » ou quatre « Écrire » (1 à 4 clics), puis des attentes.
- **Proposé** : le carnet (résumé, points clés, chapitres) **se prépare de lui-même** dès que le texte est fini,
  en file derrière les calculs urgents ; les boutons disparaissent, la boîte à questions reste. Une correction du
  texte marque le carnet « à refaire » (une pastille), refait au prochain passage. 0 clic.
- **Ce que ça change pour Cal** : il ouvre une transcription et le résumé est là.
- **Principe** : la règle 7 du thème (rien à faire qui pourrait se faire seul) ; la force des défauts [1].
- **Coût** : petit (enchaîner l'appel du carnet à la fin du calcul ; une préférence pour l'éteindre).
  **Dépend de** : la charge du modèle de texte sur les DGX (Ollama) ; si la file est pleine, le carnet attend.

### 5. Corriger un mot partout — rapide

- **Aujourd'hui** : « Nirvana Lab » entendu six fois au lieu de « Nirvalab » : six fois double-clic, correction,
  Entrée (18 gestes).
- **Proposé** : après une correction, une ligne discrète sous la réplique : **« Corriger aussi les 5 autres »**
  (1 clic, annulable d'un coup). 3 + 1 gestes.
- **Ce que ça change pour Cal** : un nom propre se corrige une fois.
- **Principe** : Descript, « Correct » et « Correct All » — corriger cette fois-ci, ou partout dans le projet [4].
- **Coût** : petit (chercher le même mot dans les autres répliques ; l'annulation groupe les changements).
  **Dépend de** : rien.

### 6. Le zoom sémantique du texte — géniale

- **Aujourd'hui** : une heure d'entretien, c'est des centaines de répliques ; on fait défiler, ou l'on lit les
  chapitres du carnet à droite puis on cherche la réplique à gauche.
- **Proposé** : Ctrl+molette sur le texte change **ce qu'on lit**, pas la taille. De loin : les **chapitres** (le
  carnet), chacun avec son temps et sa voix principale. Au milieu : une ligne par réplique, la première phrase. De
  près : le texte entier. Tout près : **les mots** et leurs silences, prêts à couper (n° 3). Un clic à n'importe
  quel palier met la tête là.
- **Ce que ça change pour Cal** : on navigue dans un long entretien comme dans un plan, du sommaire au mot.
- **Principe** : Pad++, la taille apparente décide du détail montré [5] ; le zoom sémantique des tuiles du nodal
  d'ODIO, que Cal aime déjà (`docs/etudes/musique_odio01.md`).
- **Coût** : moyen (quatre façons de dessiner la liste ; les chapitres sont dans le carnet, les mots dans le
  document Complet). **Dépend de** : le carnet (n° 4) pour le palier du haut.

### 7. Les sous-titres sur l'image, recalés à la main — moyen

- **Aujourd'hui** : on corrige le texte dans la liste et on voit l'image ailleurs ; un sous-titre qui arrive trop
  tôt ne se recale pas (sur la frise, glisser ne bouge que la tête).
- **Proposé** : la réplique lue s'affiche **en sous-titre sur la vidéo**, telle qu'elle sera exportée ; double-clic
  dessus pour la corriger sur place. Sur la frise, **les bords d'une réplique se tirent** pour la recaler (l'aimant
  prend les silences et les mots). 1 glisser.
- **Ce que ça change pour Cal** : on voit et on règle les sous-titres comme ils seront vus.
- **Principe** : la manipulation directe [2] ; Premiere : le texte et le temps de chaque sous-titre se modifient,
  les blocs se tirent sur la timeline [6].
- **Coût** : moyen (`commun/lecteur.js` : une couche de texte ; la frise des répliques : des poignées ; le document
  garde déjà le début et la fin de chaque réplique). **Dépend de** : rien.

### 8. Les mots peu sûrs d'abord — rapide

- **Aujourd'hui** : pour relire, on lit tout ; une erreur se trouve en écoutant.
- **Proposé** : les mots dont le moteur doute sont **soulignés en pointillé** ; **Tab** saute au prochain, la tête
  se pose une seconde avant pour l'entendre. Relire = Tab, écouter, corriger ou Tab.
- **Ce que ça change pour Cal** : la relecture va droit aux endroits à risque.
- **Principe** : un état montré par une forme plutôt qu'une phrase (règle 4 de la rédaction) ; la manipulation
  directe [2].
- **Coût** : petit si le moteur rend une confiance par mot. **Dépend de** : **non documenté** pour nos moteurs — le
  document garde le temps de chaque mot, pas sa confiance (`server/tools/transcrire.py`) ; à vérifier au câblage
  réel.

### 9. Le Montage reçoit les sous-titres — moyen

- **Aujourd'hui** : « Envoyer la vidéo au Montage » envoie le média seul ; les sous-titres partent en fichier SRT à
  part (2 clics), que le Montage ne lit pas (il n'a pas de piste de texte).
- **Proposé** : l'envoi pose aussi **une piste de texte** sous le plan, une réplique par bloc, calée ; couper ou
  déplacer le plan emporte son texte ; l'export les incruste ou les écrit à côté (un choix de la fenêtre d'export).
  1 clic.
- **Ce que ça change pour Cal** : une vidéo sous-titrée sort du Montage sans aller-retour.
- **Principe** : les blocs de sous-titres comme des plans sur la timeline [6] ; une seule vérité (le document de
  Transcrire).
- **Coût** : gros (une sorte de piste neuve dans `montage/model.js`, son dessin, son export ffmpeg `subtitles`).
  **Dépend de** : le lot montage-medias (le son lié : la même idée d'objets qui suivent leur plan).

### 10. La colonne des réglages se replie — rapide

- **Aujourd'hui** : une fois le texte là, la colonne de gauche garde le média, les deux modes, les deux langues et
  l'avancé (≈ 350 px), qui ne servent qu'à la prochaine transcription.
- **Proposé** : après le lancement, la colonne se **replie en une ligne** au-dessus du texte (« entretien · complet ·
  français → anglais ») ; un clic la rouvre. Le texte et le carnet prennent la largeur. 0 clic pour lire mieux.
- **Ce que ça change pour Cal** : l'écran est au texte quand on lit.
- **Principe** : la divulgation progressive — montrer d'abord ce qui sert au geste en cours [7] ; la règle 3 de la
  rédaction (une information là où l'on s'en sert).
- **Coût** : petit (`transcrire.css`, une classe ; la ligne de résumé existe sous « Transcrire »). **Dépend de** :
  rien.

## 3. Le top 3

1. **Déposer, c'est transcrire** (n° 1) : 3 clics → 1 glisser, et le geste de plusieurs fichiers à la fois ; petit.
2. **Le texte comme ciseaux** (n° 3) : Transcrire devient l'outil qui trouve et découpe les passages pour le
   Montage ; moyen, sur le mode Complet.
3. **Le carnet qui s'écrit seul** (n° 4) : 0 clic, le résumé là à l'ouverture ; petit, si la file du modèle de texte
   le permet.

Puis, petits chacun : transcrire sans quitter l'outil (2), corriger un mot partout (5), la colonne qui se replie
(10).

## Sources

1. Nielsen, J., « The Power of Defaults », Nielsen Norman Group, 2005 (extrait du moteur de recherche ; la page
   n'est pas lisible depuis le conteneur).
2. Shneiderman, B., « Direct Manipulation: A Step Beyond Programming Languages », *Computer* 16(8), 1983,
   p. 57-69 (DOI 10.1109/MC.1983.1654471).
3. Descript, « Edit like a doc » (effacer le texte efface le média ; couper-coller le déplace) —
   https://help.descript.com/getting-started/edit-like-a-doc (extrait du moteur de recherche, 10/10/2026).
4. Descript, « Correct your transcript » (« Correct » : cette fois-ci ; « Correct All » : partout dans le projet) —
   https://help.descript.com/script-editing/correct-your-transcript (extrait).
5. Bederson, B. B. & Hollan, J. D., « Pad++: A Zooming Graphical Interface for Exploring Alternate Interface
   Physics », UIST '94, p. 17-26 —
   https://www.lri.fr/~mbl/Teach/SituatedComputing/2017/papers/ZUI/pad++-uis94-p17-bederson.pdf
6. Adobe, « Working with captions in Premiere Pro 14.x and earlier » (le texte et le temps de chaque sous-titre se
   modifient) — https://helpx.adobe.com/tr/premiere-pro/using/old-captions-workflow.html (extrait ; la page du
   flux récent n'a pas été trouvée).
7. Nielsen Norman Group, « Progressive Disclosure » — https://www.nngroup.com/videos/progressive-disclosure/
   (extrait).
