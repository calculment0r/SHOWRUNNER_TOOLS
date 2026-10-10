# Une intention → tout le pipeline — dix propositions (10/10/2026)

Cal, 09/10 : « on veut des interactions simples, rapides, et on élimine des clics pour que tout soit fluide
[…] des features géniales ». Ce fichier propose comment **une intention** (« une pub de 30 s pour un thé glacé »)
devient un film, une chanson ou une planche **sans que Cal porte chaque fichier d'un outil à l'autre** : l'agent
fait la suite, entre les outils. Pas de code.

Le cadre ne change pas : ce sont les décisions de Cal du 09/10 (`docs/etudes/agent_autonome.md` § 10, toutes les
recommandations prises). Le consentement **par plan, coût affiché** (A4) ; rien hors du plan ; chaque carte garde
son bouton ; le modèle propose des données, le code fait les gestes ; jamais une suppression, une publication ou
une route d'Admin par l'agent ; tout en local. Les propositions ci-dessous s'y tiennent.

## 1. Ce que coûte aujourd'hui un film de 30 s en huit plans

Compté d'après les parcours mesurés (ce lot : `odio.md`, `ideation.md`, `accueil.md` ; marqués « mesuré ») et
d'après le code des autres outils (Vidéo et le Montage, que le lot B mesure : marqués « estimé »).

| étape | ce qu'on fait | gestes |
|---|---|---|
| le projet | « Commencer un projet » : le brief, Commencer, 3 réponses, Répondre | 10 (mesuré) |
| le storyboard | la demande à l'agent, le découpage corrigé puis validé, « Lancer les 8 images » | ≈ 5 (lot 1 de l'agent) |
| les 8 vidéos | ouvrir Vidéo ; pour chaque plan : poser l'image (panneau Asset), l'invite, Générer | ≈ 3 + 8 × 6 = 51 (estimé) |
| le montage | ouvrir le Montage, une séquence, poser les 8 clips dans l'ordre | ≈ 20 (estimé) |
| la musique | ODIO : Générer (le panneau), Exporter, « Envoyer au montage » | ≈ 11 (mesuré pour l'export) |
| **total** | | **≈ 97 gestes**, six changements d'outil |

L'essentiel des gestes n'est pas créatif : c'est **porter** une image d'un outil à l'autre, et **recommencer
le même geste huit fois**. C'est ce que les propositions enlèvent.

## 2. Les dix propositions

« Géniale » : ça change la façon de travailler. « Rapide » : ça enlève des clics tout de suite.

### 1. Le plan de production, en une carte — géniale

- **Aujourd'hui** : l'agent s'arrête au storyboard ; la suite (vidéos, montage, musique) se fait outil par outil,
  ≈ 80 gestes.
- **Proposé** : à une intention de production, l'agent rend **un plan** en une carte : les étapes dans l'ordre
  (storyboard → 8 images → 8 vidéos → la musique → le premier montage → l'export), chacune avec son outil, le
  modèle que le registre choisit, son coût en temps de GPU, ce dont elle dépend. On corrige une ligne (« pas de
  musique », « 6 plans »), puis **un seul accord** — « tout » avec le coût total, ou « jusqu'aux images ». Le
  code exécute les étapes l'une après l'autre ; chaque rendu reste un travail ordinaire de la file. ≈ 80 → 2
  (corriger, accepter).
- **Ce que ça change pour Cal** : il décide du film ; la fabrication suit, et il voit ce qu'elle coûte avant.
- **Principe** : Higgsfield Supercomputer choisit les modèles et montre le coût avant l'accord [1] ; LTX Studio
  fait revoir le découpage avant tout rendu [2] ; la décision A4 de Cal.
- **Coût** : gros (une skill « production » qui enchaîne les skills existantes et à venir : storyboard,
  image, vidéo, premier montage, musique — n° 3, 8, 9, 11 du catalogue d'`agent_autonome.md` § 6).
  **Dépend de** : le registre des capacités (`agent/intentions.json`), les lots 2 et 3 de l'agent.

### 2. Chaque étape finie propose la suivante — rapide

- **Aujourd'hui** : quand les huit images sont prêtes, rien ne se passe ; Cal ouvre Vidéo et recommence.
- **Proposé** : à la fin d'une étape, une ligne de l'agent, dans l'outil où l'on est : « 8 images prêtes ·
  **Faire les 8 vidéos** (≈ 40 min de GPU) » — un clic, c'est l'accord de cette étape. Si Cal a quitté la page,
  la même phrase arrive sur son téléphone, avec le bouton (le bot Telegram des alertes sait déjà porter des
  boutons, `server/core/alertes.py`). 51 gestes → 1.
- **Ce que ça change pour Cal** : la production avance pendant qu'il fait autre chose, sans qu'il surveille.
- **Principe** : l'action proposée là où arrive la nouvelle ; Descript Underlord enchaîne premier montage,
  habillage et plans de coupe en conversation [3] — avec, chez nous, l'accord à chaque étape (A4).
- **Coût** : moyen (la fin d'un travail, `sr:job`, réveille la politique de l'agent ; les alertes de Cal ont
  déjà leurs boutons). **Dépend de** : la mémoire par Workspace (lot 3, A3), pour savoir à quel plan on en est.

### 3. La chaîne visible, d'un outil à l'autre — géniale

- **Aujourd'hui** : la parenté d'une image est un fil dans la planche ; celle d'une vidéo, d'un clip de montage,
  d'un mixage ne se voit nulle part : on ne sait plus de quelle image vient le plan 4.
- **Proposé** : une vue « chaîne » du Workspace — le brief, la planche, les images, les vidéos, la séquence,
  l'export, chacun en vignette avec son état par une pastille (attend, calcule, fait, à refaire) ; un clic ouvre
  l'objet dans son outil. La même chaîne, en petit, au survol de n'importe quel objet (« vient de l'image 3 de
  la planche Pub thé · sert dans la séquence, à 00:12 »).
- **Ce que ça change pour Cal** : il voit où en est le film, et d'où vient chaque morceau.
- **Principe** : le graphe de nœuds visible des outils de création (ComfyUI, Figma Weave : `ideation_weavy.md`)
  porté au niveau du projet ; les états par des formes (règle 4 de la rédaction).
- **Coût** : gros (une page ; chaque outil dit d'où vient ce qu'il crée — la lignée `out` d'Idéation, les
  versions des éléments, l'inventaire `core/inventaire.py` qui énumère déjà tout par Workspace). **Dépend de** :
  une « origine » écrite par chaque outil sur ce qu'il range (un champ de plus au contrat, `ARCHITECTURE.md`).

### 4. Refaire un plan, la suite suit — géniale

- **Aujourd'hui** : changer l'image du plan 3, c'est la refaire dans Idéation, puis refaire sa vidéo dans Vidéo,
  puis remplacer le clip dans le Montage à la bonne place et à la bonne durée : ≈ 15 gestes, trois outils.
- **Proposé** : quand une image de la chaîne change, ce qui en dépend passe « à refaire » (une pastille) ;
  l'agent propose : « Refaire la vidéo du plan 3 et la remettre dans la séquence, même place, même durée
  (≈ 5 min de GPU) » — un clic. La version d'avant reste (les versions d'un élément, l'annulation du Montage).
  15 → 1.
- **Ce que ça change pour Cal** : on corrige un plan comme on corrige une cellule ; le film se remet à jour.
- **Principe** : le recalcul automatique du tableur (VisiCalc, 1979 : changer une valeur recalcule ce qui en
  dépend [4]) ; LTX Studio refait une case seule [2].
- **Coût** : moyen à gros (la chaîne de la proposition 3, plus « remplacer un clip en gardant sa place » au
  Montage). **Dépend de** : la proposition 3.

### 5. L'outil s'ouvre prérempli, jamais vide — rapide

- **Aujourd'hui** : quand l'agent ne peut pas faire (ou ne doit pas lancer seul), il le dit ; Cal ouvre l'outil
  et refait la demande dans le formulaire (≈ 7 gestes).
- **Proposé** : l'agent ouvre l'outil **rempli** — Vidéo avec l'image en première image, l'invite mise en forme,
  la durée ; Image avec ses références ; ODIO sur la plage à générer — et s'arrête devant le bouton orange : Cal
  relit et lance. 7 → 1.
- **Ce que ça change pour Cal** : l'agent prépare, Cal décide ; le dernier geste reste le sien.
- **Principe** : « ouvrir l'outil prérempli » (`agent_autonome.md` § 5.10) ; les adresses d'entrée existent pour
  Vidéo (`?mode=`, `?start=`, `?ref=`) ; le contrat `agent.appliquer(gestes)` du lot 3.
- **Coût** : petit à moyen (une adresse d'entrée par outil, la même que pour « glisser un asset sur un outil »,
  `accueil.md` n° 3). **Dépend de** : le lot 3 de l'agent.

### 6. « Vers le montage » depuis chaque rendu — rapide

- **Aujourd'hui** : ODIO a « Envoyer au montage » après l'export (1 clic + une page, `odio.md`) ; une vidéo
  rendue doit être retrouvée dans le panneau Asset du Montage et posée à la main.
- **Proposé** : tout rendu (une vidéo, un son, une image) a **« Vers le montage »** : il se pose à la fin de la
  séquence en cours du Workspace (un son sur la piste de musique), sans quitter l'outil ; un message « posé dans
  Pub thé à 00:24 · ouvrir · annuler ». 3 à 4 gestes et une page → 1.
- **Ce que ça change pour Cal** : le montage se remplit pendant qu'on fabrique.
- **Principe** : passer le résultat à l'étape suivante sans télécharger ni redéposer (Higgsfield : « without you
  downloading or re-uploading anything » [1]) ; l'action là où l'on regarde le résultat.
- **Coût** : petit à moyen (une route du Montage « ajouter à la séquence », dont l'agent a aussi besoin pour le
  premier montage ; le bouton dans le fil des rendus de chaque outil). **Dépend de** : la séquence « en cours »
  d'un Workspace (à définir au Montage, lot B).

### 7. La musique à la longueur du montage — géniale

- **Aujourd'hui** : la musique se fait dans ODIO à son propre tempo et à sa propre longueur ; on la coupe au
  montage, ou l'on recommence.
- **Proposé** : depuis une séquence, « Une musique pour ce montage » ouvre ODIO sur un projet **déjà calé** :
  la longueur de la séquence, ses coupes en marqueurs, des sections posées sur les grands changements de plan,
  un tempo choisi pour que les temps forts tombent sur les coupes ; le panneau Générer part sur ces bornes ;
  l'export revient sur la piste de musique de la séquence. ≈ 11 gestes et des essais → 3.
- **Ce que ça change pour Cal** : la musique épouse le film dès le premier jet.
- **Principe** : une seule vérité du temps entre les outils (le lot transverse B : têtes de lecture, plages) ;
  ODIO a déjà les sections, les marqueurs et l'arc d'énergie (`odio_arcs.md`) ; Suno Studio génère sur une plage
  choisie (`musique_generatif.md` § 8.5).
- **Coût** : moyen à gros (lire les coupes d'une séquence ; le choix du tempo est un calcul simple, à écrire et à
  tester). **Dépend de** : les routes du Montage ; ACE-Step branché en réel (`musique_generatif.md` § 8.7).

### 8. La distribution du projet, dans chaque invite — rapide

- **Aujourd'hui** : un personnage (Character Factory) ou un objet (Object Creator) devient un élément ; on le
  cite par « @ » dans chaque invite, outil par outil, et on le rattache à chaque carte.
- **Proposé** : le Workspace a sa **distribution** : les éléments qu'on y marque (« dans le projet ») passent en
  tête de la complétion « @ » de tous les outils, et l'agent les rattache seul quand une ligne du découpage les
  nomme exactement (« @Léa marche sous la pluie »). 1 à 2 gestes par invite → 0.
- **Ce que ça change pour Cal** : le casting se fait une fois ; tous les plans le connaissent.
- **Principe** : LTX Studio extrait personnages, objets et lieux en « Elements » réutilisés par @ [2] ;
  Higgsfield range les images d'un projet en « named Elements » [1] ; notre grammaire unique des mentions
  (intégration du 09/10).
- **Coût** : petit à moyen (une liste par Workspace ; la complétion « @ » existe). **Dépend de** : rien.

### 9. Le brouillon de tout le film d'abord — géniale

- **Aujourd'hui** : chaque étape se fait d'emblée en qualité : un plan H3 prend de 7 à 15 min ; on voit le film
  entier après des heures.
- **Proposé** : le plan de production (n° 1) a deux passes. **Brouillon** : toutes les étapes en version rapide
  (les images en petit, les vidéos courtes et en basse résolution, la musique avec les instruments d'ODIO sans
  modèle) : le film entier, monté, en quelques minutes. Puis **« Passer en qualité »**, plan par plan ou tout,
  avec le coût : les versions finales remplacent les brouillons à leur place (la proposition 4).
- **Ce que ça change pour Cal** : il juge le rythme et l'histoire sur un film entier avant de dépenser des heures
  de GPU ; il ne refait en qualité que ce qui tient.
- **Principe** : l'animatique (le storyboard monté et sonorisé avant le tournage) ; les rendus d'aperçu des
  outils de production ; l'échelle des résolutions de Vidéo existe déjà (intégration du 09/10).
- **Coût** : moyen (un réglage « brouillon » par étape, dans le registre ; le remplacement à sa place de la
  proposition 4). **Dépend de** : les propositions 1 et 4 ; le temps réel d'un brouillon à mesurer sur les DGX.

### 10. Dire l'intention depuis n'importe où — rapide

- **Aujourd'hui** : l'agent n'est que dans Idéation (le lot 3 l'installe dans chaque outil).
- **Proposé** : la palette **Ctrl+K** de tout le portail (`accueil.md` n° 1) prend aussi une phrase : ce qui ne
  correspond à aucune commande part à l'agent, avec ce qui est ouvert et choisi (`agent.contexte()`) ; la
  réponse s'ouvre dans le panneau de l'agent. Une seule entrée pour aller, faire et demander. 2 à 3 gestes (ouvrir
  le panneau, écrire, envoyer) → 1 touche et la phrase.
- **Ce que ça change pour Cal** : il n'a pas à savoir quel outil fait quoi ; il dit ce qu'il veut, là où il est.
- **Principe** : la palette de commandes qui mène aussi aux outils d'IA — Figma ouvre ses outils d'IA depuis son
  menu d'actions Ctrl+K [5] ; le routeur à intentions fermées de l'agent (lot 1).
- **Coût** : petit (après la palette commune et le lot 3). **Dépend de** : `accueil.md` n° 1, le lot 3 de l'agent.

## 3. Le top 3

1. **Le plan de production, en une carte** (n° 1), avec **chaque étape qui propose la suivante** (n° 2) :
   ≈ 97 gestes → une poignée d'accords, sous la règle de Cal (le coût affiché, un accord par plan).
2. **Le brouillon de tout le film d'abord** (n° 9) : voir le film entier en minutes, ne payer la qualité que
   pour ce qui tient.
3. **Refaire un plan, la suite suit** (n° 4), sur **la chaîne visible** (n° 3) : corriger devient aussi léger
   qu'au tableur.

Les rapides, à faire dès que le lot 3 de l'agent est là : l'outil prérempli (5), « Vers le montage » (6), la
distribution (8), l'intention par Ctrl+K (10).

## Sources

1. Higgsfield Supercomputer (« picks the right models and presets and shows the credit cost upfront for you to
   approve » ; « without you downloading or re-uploading anything » ; « named Elements ») —
   `docs/etudes/mode_showrunner.md` § 1.1, sources H1-H6 (extraits).
2. LTX Studio (la revue du découpage avant tout rendu ; une case se refait seule ; les « Elements » cités par @) —
   `docs/etudes/agent_autonome.md` § 2.7, source [15] (extraits).
3. Descript Underlord (un co-monteur en conversation qui enchaîne les étapes) — `agent_autonome.md` § 2.7,
   source [17] (extraits).
4. Computer History Museum, « This Day in History, July 16 » (VisiCalc : « automated the recalculation of
   spreadsheets ») — https://www.computerhistory.org/tdih/july/16/ (extrait du moteur de recherche, 10/10/2026).
5. Figma, « Use the actions menu in Figma Design » (les outils d'IA, les actions, les assets depuis Ctrl+K) —
   https://help.figma.com/hc/en-us/articles/23570416033943-Use-quick-actions (extrait).
