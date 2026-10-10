# Movie Analysis — dix propositions d'interaction (10/10/2026)

Cal, 09/10 : « on veut des interactions simples, rapides, et on élimine des clics pour que tout soit fluide
[…] je veux des features géniales, comme quand on travaille avec un zoom sémantique ». Ce fichier est
l'étude pour Movie Analysis (l'accueil des projets, la fenêtre « Nouvelle analyse », le Studio d'un film : son
Studio, son Casting, son plan par plan, le labo des voix). Pas de code : des propositions, chacune avec le geste
d'aujourd'hui compté, le geste proposé, le principe et sa source, le coût.

Movie Analysis est l'outil qui **lit** les films ; les autres outils en **font**. La plupart des propositions
relient les deux : ce qu'une analyse sait (les plans, leurs images clés, leur cadrage, les personnages, les
répliques) devient un point de départ dans Vidéo, Asset et le Montage. Les mots sont ceux du lexique
(`docs/etudes/redaction.md`) : un plan, « plan par plan » (pas « dépouillement »), « qui parle » (pas
« diarisation »), « les outils de la machine » (pas « la chaîne »), un élément.

## 1. Ce qui a été mesuré

Un portail d'essai neuf (`tools/portail_essai.py 9041`), Chromium sans affichage, un pilote qui fait les parcours
et compte chaque geste ; les outils d'analyse ne sont pas installés dans le conteneur (« Lancer » reste grisé et le
dit), les deux films publiés (`analyse/analyses/getaround`, `wall`) servent pour le Studio. Le pilote et ses
captures sont dans le scratchpad de la session : `ib2/p_analyse.mjs`, `ib2/p_analyse-dark.txt` (le relevé),
`ib2/shots/ma-*.png` et `ib2/shots/analyse-*.png` (le Studio, le Casting, le plan par plan, captures du 09/10 :
le code de l'outil n'a pas changé depuis), la capture annotée `ib2/annotees/analyse-nouvelle.png`.

| parcours (aujourd'hui) | clics | champs | gestes |
|---|---|---|---|
| un projet neuf puis son analyse : le nom, « Créer le projet », la fiche s'ouvre, « Lancer sur DGX2 », « Choisir une vidéo », la vidéo, « Lancer » | 5 | 1 | **6** + une attente |
| une analyse directe : « Nouvelle analyse… », « Choisir une vidéo », la vidéo, « Lancer » | 4 | | **4** |
| ouvrir un film analysé et le lire : la carte, puis « Charger le fichier depuis ce poste » et le fichier, à chaque visite | 2 | | **3** + le disque |
| réunir deux fiches du Casting (la même personne) : la liste « fiche à part », la bonne fiche, « Appliquer », « Enregistrer » | 4 | | **4** |
| refaire un plan du film dans Vidéo : télécharger son image clé, la déposer en image de début, écrire son action, sa caméra, régler la durée | — | — | **≈ 8, et deux outils** |

Ce qui est déjà bien, et qu'on garde : l'accueil a la grammaire du fil des autres outils ; le titre se remplit
d'après la vidéo ; « Lancer » grisé dit pourquoi et mène à ce qui manque ; le Studio garde ensemble la vidéo, le
scénario qui défile, la timeline des voix (une piste par personnage, une réplique se glisse sur une autre piste pour
la donner à quelqu'un d'autre) ; la bande de rythme du plan par plan (largeur = durée, couleur = teinte du plan,
un clic mène au plan) ; les filtres par sorte de plan.

Les frictions vues :
- **Deux chemins pour la même chose** : « Nouveau projet » (un nom, puis la fiche, puis « Lancer sur DGX2 ») et
  « Nouvelle analyse… » finissent dans la même fenêtre.
- **Un champ technique** : le dossier de travail (`/root/reelbench/runs/…`), dérivé du titre, reste affiché et
  modifiable.
- **Le film ne se lit pas toujours** : « La vidéo ne se lit ni sur R2 ni à côté de cette page » ; il faut la
  recharger depuis le disque, à chaque visite (`analyse/chaine/studio.mjs`).
- **Le Casting se corrige par une liste, puis deux boutons** (« Appliquer », « Enregistrer », et « Publier sur
  GitHub » quand il paraît) : réunir deux fiches est un choix dans une liste déroulante, pas un geste sur les
  visages ; et ce qui pourrait s'enregistrer seul demande un clic (règle 7 du thème).
- **Ce que l'analyse sait ne sert qu'à lire** : un personnage reconnu, un plan et son cadrage, une réplique ne
  passent dans aucun autre outil.
- **Les touches ne veulent pas dire la même chose qu'ailleurs** : dans le Studio, J et L (et ← →) passent au plan
  d'avant ou d'après (`studio.mjs`) ; dans le Montage, Transcrire et le lecteur commun, J et L reculent et
  avancent, ← → font une image (voir `transverse-b.md`).

## 2. Les dix propositions

« Géniale » : ça change la façon de travailler. « Rapide » : ça enlève des clics tout de suite.

### 1. Refaire ce plan — géniale

- **Aujourd'hui** : pour reprendre un plan d'un film de référence (même cadre, même mouvement, nos personnages) :
  télécharger l'image clé, ouvrir Vidéo, la déposer en image de début, recopier l'action, traduire l'échelle et le
  mouvement en mots, régler la durée (≈ 8 gestes, deux outils).
- **Proposé** : sur une ligne du plan par plan (ou au clic droit d'un plan dans le Studio) : **« Refaire dans
  Vidéo »** (1 clic). Vidéo s'ouvre en mode Images, l'image clé en début, le prompt écrit d'après la fiche du plan
  (l'action, l'échelle — « plan rapproché » —, le mouvement de caméra), la durée la plus proche sur la grille d'H3.
  Variante : en mode Références, les personnages remplacés par nos éléments (n° 2).
- **Ce que ça change pour Cal** : un film qu'on aime devient un storyboard qu'on peut rejouer plan par plan.
- **Principe** : « une intention → tout le pipeline » ; la manipulation directe — l'objet (le plan) porte son
  action [1].
- **Coût** : moyen (une route qui range l'image clé dans Asset, puis `movie/?mode=i2v` avec un brouillon pré-rempli :
  le format du brouillon existe, `movie.v2`). **Dépend de** : la fiche du plan (échelle, caméra, mouvement : déjà
  dans le plan par plan) ; les droits de l'image d'un film tiers restent ceux de Cal à juger.

### 2. Un personnage du film devient un élément — géniale

- **Aujourd'hui** : le Casting montre les visages regroupés et nommés ; pour s'en servir ailleurs, il faudrait
  enregistrer les portraits à la main, puis créer l'élément dans Asset (≈ 6 gestes par personnage).
- **Proposé** : sur une fiche du Casting : **« Créer l'élément »** (1 clic) — ses portraits deviennent les
  références de l'élément (le visage, le buste), sa description celle de la fiche ; l'élément est aussitôt dans le
  panneau Asset et se glisse dans Vidéo comme les autres.
- **Ce que ça change pour Cal** : le casting d'une référence devient un casting de travail.
- **Principe** : les éléments réutilisables d'un outil de storyboard, tirés du texte et des images [2] ; une seule
  vérité, les éléments d'Asset (`/api/elements`).
- **Coût** : petit à moyen (les portraits sont des fichiers du run, `portraits.py` ; la route des éléments existe).
  **Dépend de** : la qualité des portraits (certains sont flous : « Silhouette floue avec un chapeau »).

### 3. Déposer un film, c'est l'analyser — rapide

- **Aujourd'hui** : 4 à 6 gestes, et deux chemins (« Nouveau projet », « Nouvelle analyse… »).
- **Proposé** : **une seule porte** : une vidéo déposée n'importe où sur l'accueil (fichier, vignette du panneau
  Asset) crée le projet, nommé d'après la vidéo, et met l'analyse en file ; si les outils de la machine manquent, la
  carte le dit et l'analyse part seule quand ils sont là. « Nouveau projet » et « Nouvelle analyse » se fondent en un
  bouton qui ouvre le sélecteur. 1 glisser.
- **Ce que ça change pour Cal** : analyser un film tient en un geste.
- **Principe** : la force des défauts [3] ; la règle 7 du thème (rien à valider qui pourrait se faire seul).
- **Coût** : petit (l'accueil a déjà un dépôt sur la fenêtre : `dropZone($('#nv-bib'))` ; l'étendre à la page et
  lancer). **Dépend de** : la n° 4.

### 4. Le dossier de travail disparaît — rapide

- **Aujourd'hui** : un champ « le dossier de travail » sous le titre, rempli d'après lui.
- **Proposé** : il ne s'affiche plus ; il se déduit du titre, et le serveur le rend unique de lui-même. Le chemin
  se lit au survol de la carte, pour qui en a besoin. 1 champ de moins à lire.
- **Ce que ça change pour Cal** : la fenêtre ne parle plus que du film.
- **Principe** : la divulgation progressive — ce qui sert rarement va au survol [4] ; la règle 1 de la rédaction
  (pas de nom interne à l'écran).
- **Coût** : petit (`analyse/accueil.js`, `#nv-nom-champ` caché ; la vérification du nom reste, côté serveur).
  **Dépend de** : rien.

### 5. Réunir deux fiches en glissant un visage sur l'autre — rapide

- **Aujourd'hui** : la liste « fiche à part », la bonne fiche, « Appliquer », « Enregistrer » (4 clics).
- **Proposé** : **glisser une fiche sur une autre** les réunit (le nom de celle qu'on vise reste) ; Ctrl+Z les
  sépare. Tout s'enregistre seul ; « Publier sur GitHub » reste, seul geste volontaire. 1 glisser.
- **Ce que ça change pour Cal** : on corrige le casting en regardant les visages.
- **Principe** : la manipulation directe [1] ; dans Asset, lâcher un objet sur un autre propose déjà de les
  ranger ensemble (`asset.js`, repris par le Projet du Montage).
- **Coût** : petit (`analyse/chaine/casting-parts.mjs` : la liste fait déjà la fusion ; le glisser l'appelle).
  **Dépend de** : l'enregistrement dans le dépôt partagé, qui refuse l'écriture depuis l'adresse du portail (la
  page le dit) : là, la correction reste locale comme aujourd'hui.

### 6. Le film en zoom sémantique — géniale

- **Aujourd'hui** : trois vues pour le même film, en onglets : le Studio (la vidéo, le scénario, la timeline), le
  Casting, le plan par plan (les chiffres, la bande de rythme, une carte par plan) ; on passe de l'une à l'autre
  pour suivre un plan.
- **Proposé** : **la bande de rythme devient la carte du film**, et la molette change ce qu'elle montre. De loin :
  le film entier, un trait par plan, coloré au choix par la teinte, l'échelle ou le personnage. Au milieu : une
  vignette par plan, son cadrage, qui parle. De près : les images du plan, ses répliques, sa fiche. Un clic à
  n'importe quel palier lit le film à cet endroit.
- **Ce que ça change pour Cal** : on voit la structure d'un film d'un coup d'œil, puis on plonge dans un plan sans
  changer de vue.
- **Principe** : Pad++, la taille apparente décide du détail montré [5] ; la vue d'ensemble d'Ableton au-dessus de
  l'arrangement, où l'on glisse pour se déplacer et zoomer [6].
- **Coût** : gros (`analyse/chaine/studio.mjs`, la page générée : trois paliers de dessin sur des données qui
  existent toutes). **Dépend de** : rien de neuf côté analyse.

### 7. Chercher un plan par ce qu'on voit — rapide

- **Aujourd'hui** : le champ « Chercher dans l'action et les dialogues », les puces de sorte (dialogue, sujet,
  carton), la liste des rôles, les puces de défauts : 3 à 5 gestes pour « les plans rapprochés de la négociatrice ».
- **Proposé** : **un seul champ** qui comprend ce qu'on tape : « rapproché négociatrice » filtre par l'échelle et
  par le personnage, « voix off » par la sorte, « nuit » dans l'action ; chaque mot reconnu devient une puce qu'on
  retire. La bande de rythme montre en clair les plans trouvés. 1 champ.
- **Ce que ça change pour Cal** : on retrouve un plan comme on le décrirait.
- **Principe** : Premiere, le panneau de recherche « Media Intelligence » — des plans trouvés par une description
  de ce qu'on voit, tout calculé sur la machine [7]. Chez nous, sans modèle : les champs de la fiche suffisent.
- **Coût** : petit (les champs existent : échelle, rôle, sorte, action ; une lecture des mots tapés).
  **Dépend de** : rien.

### 8. Le film est un asset, il se lit toujours — rapide

- **Aujourd'hui** : « Charger le fichier depuis ce poste » à chaque visite quand la vidéo n'est ni sur R2 ni à côté
  de la page (1 clic, le disque, le fichier).
- **Proposé** : la vidéo d'une analyse lancée du portail **est un asset du Workspace** (elle y est déjà quand elle
  vient de la bibliothèque) ; le Studio la lit par son adresse dans Asset. Pour les films publiés à part, un
  « Ranger dans Asset » une fois pour toutes. 0 geste à chaque visite.
- **Ce que ça change pour Cal** : un film analysé s'ouvre et se lit, comme une vidéo du fil.
- **Principe** : une seule vérité (la bibliothèque commune) ; la règle 7 du thème.
- **Coût** : petit à moyen (`studio.mjs` prend déjà une adresse de vidéo, `--video-url` : lui donner celle de
  l'asset). **Dépend de** : la place sur DGX2 pour les films longs.

### 9. Envoyer le film au Montage, coupé en plans — moyen

- **Aujourd'hui** : pour remonter une bande-annonce de référence, on pose la vidéo dans le Montage et on la recoupe à
  la main, plan par plan (≈ 3 gestes par coupe ; Getaround a 12 plans en 30 s).
- **Proposé** : **« Envoyer au Montage, plan par plan »** (1 clic) : une séquence où la vidéo est déjà coupée aux
  limites des plans de l'analyse, chaque plan nommé (S01, S02… et son action), les répliques en marques.
- **Ce que ça change pour Cal** : on étudie le rythme d'un film en le démontant, ou on garde sa structure en
  remplaçant ses plans par les nôtres.
- **Principe** : « Scene Edit Detection » de Premiere, qui coupe une séquence aux changements de plan [8] ; ici les
  coupes sont déjà calculées (et corrigées) par l'analyse.
- **Coût** : moyen (`montage/?add=` pose un média ; il faut un envoi « avec ses coupes », que `montage.py` sait
  écrire : une séquence est un JSON de plans). **Dépend de** : la n° 8 (le film dans Asset).

### 10. Comparer deux films par leur rythme — moyen

- **Aujourd'hui** : chaque film a sa bande de rythme et ses chiffres (plan moyen, coupes par minute), sur sa page ;
  pour comparer deux bandes-annonces, on ouvre deux pages et on retient les chiffres.
- **Proposé** : sur l'accueil, choisir deux films ou plus (Ctrl+clic) et **« Comparer »** : leurs bandes de rythme
  empilées, à la même échelle de temps, leurs chiffres alignés dessous. Survoler un plan d'une bande montre son
  image. 3 gestes.
- **Ce que ça change pour Cal** : la structure de plusieurs références se lit d'un coup d'œil, avant de monter la
  sienne.
- **Principe** : le petit multiple — la même figure répétée à la même échelle se compare d'un regard [9].
- **Coût** : petit à moyen (les bandes sont calculées par film ; l'accueil connaît les projets). **Dépend de** : la
  sélection multiple de l'accueil (à ajouter, comme pour le fil des autres outils).

## 3. Le top 3

1. **Refaire ce plan** (n° 1) : Movie Analysis devient le point de départ d'un film, pas seulement sa lecture ;
   moyen.
2. **Un personnage du film devient un élément** (n° 2) : le casting d'une référence passe dans Vidéo d'un clic ;
   petit à moyen.
3. **Déposer un film, c'est l'analyser** (n° 3), avec **le dossier de travail qui disparaît** (n° 4) : 6 gestes et
   deux chemins → 1 glisser ; petit.

Puis : réunir deux fiches en glissant (5), chercher un plan par ce qu'on voit (7), le film qui se lit toujours (8).

## Sources

1. Shneiderman, B., « Direct Manipulation: A Step Beyond Programming Languages », *Computer* 16(8), 1983,
   p. 57-69 (DOI 10.1109/MC.1983.1654471).
2. LTX Studio, « LTX Storyboard Generator Update: From Script to Storyboard, Faster » (personnages, objets et lieux
   tirés en éléments réutilisables d'un plan à l'autre) — https://ltx.studio/blog/ltx-storyboard-generator-update
   (extrait du moteur de recherche, 10/10/2026).
3. Nielsen, J., « The Power of Defaults », Nielsen Norman Group, 2005 (extrait du moteur de recherche ; la page
   n'est pas lisible depuis le conteneur).
4. Nielsen Norman Group, « Progressive Disclosure » — https://www.nngroup.com/videos/progressive-disclosure/
   (extrait).
5. Bederson, B. B. & Hollan, J. D., « Pad++: A Zooming Graphical Interface for Exploring Alternate Interface
   Physics », UIST '94, p. 17-26 —
   https://www.lri.fr/~mbl/Teach/SituatedComputing/2017/papers/ZUI/pad++-uis94-p17-bederson.pdf
6. Ableton, manuel de Live 12, « Arrangement View » (la vue d'ensemble : glisser à l'horizontale pour se déplacer, à
   la verticale pour zoomer, double-clic pour tout voir) — https://www.ableton.com/en/live-manual/12/arrangement-view
   (extrait ; le site est bloqué depuis le conteneur).
7. Adobe, « Media intelligence and Search panel FAQs » (des descriptions en langage courant pour les images ;
   l'analyse et la recherche se font sur l'ordinateur) —
   https://helpx.adobe.com/vn_vi/premiere-pro/using/media-intelligence-and-search-panel-faq.html (extrait).
8. Adobe, « Detect edit points using Scene Edit Detection » —
   https://helpx.adobe.com/premiere-pro/using/scene-edit-detection.html (extrait).
9. Tufte, E. R., *Envisioning Information*, Graphics Press, 1990, chap. « Small Multiples » (lecture : ouvrage, non
   relu depuis le conteneur).
