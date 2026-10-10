# Admin et les tableaux de bord — dix propositions d'interaction (10/10/2026)

Cal, 09/10 : « on veut des interactions simples, rapides, et on élimine des clics pour que tout soit fluide ».
Ce fichier est l'étude pour l'Admin de Cal (Vue d'ensemble, Demandes, Personnes, Teams, la file, les machines,
le câblage, le stockage, le journal, les diagnostics) et pour le tableau de bord de chacun (l'Admin limité :
son tableau, ses Teams). Pas de code : des propositions, chacune avec le geste d'aujourd'hui compté, le geste
proposé, le principe et sa source, le coût.

## 1. Ce qui a été mesuré

Le même pilote que pour ODIO (`interactions/odio.md` § 1), le 09/10 (l'Admin n'a pas changé à l'intégration du
10/10 : `git diff c4817ae 23a0fbb -- admin server/tools/tableau.py` est vide). Scratchpad : `sr_c/parcours.mjs`,
`sr_c/shots/parcours.txt`, `sr_c/shots/admin_*.png`.

| parcours (aujourd'hui) | clics | champs | pages | gestes |
|---|---|---|---|---|
| Vue d'ensemble → chercher une personne → ce qu'elle a créé → retour → un Workspace déplié | 3 | 1 | 1 | **5** |
| ouvrir un objet vu dans la Vue d'ensemble (il s'ouvre dans un nouvel onglet) | 1 | | 1 | **2** + revenir à l'onglet |
| Teams : un Workspace de plus (la section, le nom, « + Workspace ») | 2 | 1 | | **3** |
| Teams : une personne de plus (le pseudo, « Ajouter ») | 1 | 1 | | **2** |
| traiter une demande depuis un outil (le nom → Admin → Demandes → Accepter) | 3 | | 1 | **4** |

Ce qui est déjà bien, et qu'on garde : la recherche d'une personne ou d'un titre ; tout ce qu'une personne a
créé, Workspace par Workspace (`server/core/inventaire.py`) ; l'annulation des réglages (« les gestes » en
haut à gauche) ; les demandes qu'on accepte depuis le téléphone (les boutons de Telegram,
`server/core/alertes.py`) ; la file qu'on réordonne en glissant ; les actions désactivées qui disent pourquoi.

Les frictions vues :
- **Les mêmes Teams à deux endroits** : la Vue d'ensemble les montre (qui crée quoi), la section Teams les règle
  (membres, rôles, Workspaces, budget) ; on passe de l'une à l'autre par « Les accès : Teams → », puis on
  cherche la Team en défilant.
- **Chaque Workspace porte neuf commandes** : un choix de rôle, Renommer, Archiver, Détruire, et six pastilles
  de droits (voir, commenter, modifier, calculer, publier, inviter) ; une Team de trois Workspaces affiche ainsi
  27 commandes, plus « Renommer » et « Détruire » de la Team (`admin_teams_membres_sombre.png`). « Détruire » est
  collé à « Renommer ».
- **Des paragraphes dans l'interface** : le budget s'explique en cinq lignes dans chaque Team ; la Vue
  d'ensemble en trois lignes ; la file en trois lignes (`admin_file_sombre.png`).
- **La colonne des sections est haute** : dix grandes cartes (une lettre, un titre en capitales, un
  sous-titre, un compte) ; « Diagnostics » est au bas de l'écran, le kit dessous.
- **Un objet s'ouvre dans un nouvel onglet** : pour regarder trois planches d'un ami, trois onglets à fermer.
- **Ce qu'une personne a créé remplace la vue** : on perd les Teams de vue, « ← retour » pour revenir.
- **« Dernière activité » se répète** à chaque niveau (la Team, le Workspace, la ligne de la personne), avec le
  même titre de planche.

## 2. Les dix propositions

« Géniale » : ça change la façon de travailler. « Rapide » : ça enlève des clics tout de suite.

### 1. Une Team, un seul endroit — rapide

- **Aujourd'hui** : voir une Team dans la Vue d'ensemble, puis « Les accès : Teams → », la retrouver, la régler :
  2 clics et un défilement ; les mêmes Teams et Workspaces sont dessinés deux fois.
- **Proposé** : la Vue d'ensemble devient le seul endroit : chaque Team montre ce qu'on y crée ET ses membres ;
  on règle sur place (un nom se renomme d'un double-clic, un membre se change par son rôle, « + » ajoute un
  Workspace ou une personne) ; la section Teams disparaît, son adresse (`admin/#teams`) ouvre la Vue sur la Team.
  2 clics → 0.
- **Ce que ça change pour Cal** : il voit et il règle au même endroit ; un ami venu par un lien d'invitation
  trouve sa Team du premier coup.
- **Principe** : une information une seule fois, là où l'on s'en sert (règle 3 de la rédaction,
  `briefs/redaction_regles.md`) ; l'édition sur place [1].
- **Coût** : moyen (`admin/tableau.js` reçoit les gestes de la section Teams d'`admin.js` ; les routes ne
  changent pas). **Dépend de** : rien.

### 2. Les gestes rares derrière « ⋯ » — rapide

- **Aujourd'hui** : 9 commandes par Workspace, toujours visibles ; « Détruire » à côté de « Renommer ».
- **Proposé** : un Workspace montre son nom (double-clic : renommer), son rôle par défaut en une pastille (les
  six droits au survol) et un « ⋯ » (Archiver, Détruire — Détruire en dernier, séparé, avec sa confirmation
  d'aujourd'hui) ; le clic droit ouvre le même menu. 27 commandes visibles → 3 menus.
- **Ce que ça change pour Cal** : la page se lit ; on ne détruit plus rien par un clic à côté.
- **Principe** : la loi de Hick [2] ; la prévention des erreurs (Nielsen, heuristique 5 : écarter l'action
  dangereuse [3]) ; la divulgation progressive [4].
- **Coût** : petit (`admin/admin.js`, le rendu des Workspaces ; `commun/menu.js` existe). **Dépend de** : rien.

### 3. Glisser une personne sur un Workspace — rapide

- **Aujourd'hui** : mettre quelqu'un dans un autre Workspace : la section Teams, la Team, le Workspace, son
  rôle, ou taper le pseudo dans la Team puis régler ses Workspaces (3 à 4 gestes).
- **Proposé** : on glisse le nom d'une personne (depuis « Les personnes » ou une autre Team) sur un Workspace :
  elle y entre avec le rôle par défaut du Workspace, un message « ami_c ajouté à Essai B · annuler » ; glissée
  hors d'un Workspace, elle en sort (annulable aussi). 3 à 4 → 1.
- **Ce que ça change pour Cal** : distribuer les gens dans les projets se fait comme on range des cartes.
- **Principe** : la manipulation directe — l'objet visible, des actions rapides, réversibles, dont l'effet se
  voit tout de suite [1] ; l'annulation de l'Admin existe (`commun/undo.js`).
- **Coût** : petit à moyen (`admin/tableau.js` : `dragItem` et `dropZone` communs ; les routes des Teams).
  **Dépend de** : la proposition 1 (les Teams et les personnes sur la même vue).

### 4. Une personne choisie s'allume partout — géniale

- **Aujourd'hui** : un clic sur une personne remplace la vue par la liste de ce qu'elle a créé ; « ← retour »
  pour revoir les Teams (2 gestes, et le contexte perdu).
- **Proposé** : survoler une personne **allume** dans la Vue d'ensemble tout ce qu'elle a créé (ses Workspaces se
  colorent, ses objets ressortent, le reste s'estompe) ; un clic garde l'éclairage (on peut en ajouter une
  seconde, en autre couleur) ; Échap l'éteint. 2 gestes → 0 (survol) ou 1 (clic).
- **Ce que ça change pour Cal** : « où ce garçon a-t-il fait sa transcription ? » se voit d'un regard, dans son
  contexte, sans quitter la vue.
- **Principe** : le « brushing » — désigner des données dans une vue les éclaire dans toutes les autres
  (Becker et Cleveland [5]) ; le focus et le contexte gardés ensemble.
- **Coût** : moyen (`admin/tableau.js` : les objets de chaque personne, que `GET /api/tableau/personne/<uid>`
  rend déjà ; un état d'éclairage). **Dépend de** : rien.

### 5. Regarder un objet sans ouvrir d'onglet — rapide

- **Aujourd'hui** : un objet de la Vue d'ensemble s'ouvre dans un nouvel onglet (placé dans son Workspace) ;
  regarder trois planches, c'est trois onglets à fermer.
- **Proposé** : **Espace** sur un objet (ou son survol prolongé) montre son aperçu en grand, par-dessus la page
  (une image, la miniature d'une planche, le début d'un son, les premières lignes d'une transcription) ; Espace
  referme ; les flèches passent au suivant ; un clic l'ouvre dans le volet de la coquille (« Fermer » ramène,
  « Ouvrir ici » en fait l'outil) ; Ctrl+clic garde le nouvel onglet. 2 gestes et un onglet → 1 touche.
- **Ce que ça change pour Cal** : il passe en revue le travail d'une Team comme on feuillette un dossier.
- **Principe** : Coup d'œil (Quick Look) du Mac — on choisit un fichier, Espace en montre l'aperçu, Espace le
  referme [6] ; le volet existe déjà (`commun/coquille.js`, « LE VOLET »).
- **Coût** : petit à moyen (`admin/tableau.js` ; les vignettes existent : `commun/shell.js`, `thumb`).
  **Dépend de** : les aperçus par sorte (le lot transverse A, « l'aperçu au survol »).

### 6. Les demandes se traitent d'où l'on est — rapide

- **Aujourd'hui** : le point ambre sur le nom dit qu'une demande attend ; le nom → Admin → Demandes → Accepter :
  4 gestes et une page (le téléphone, lui, a déjà ses deux boutons dans Telegram).
- **Proposé** : le menu du nom montre la demande elle-même (« nico_b veut le Studio » · Accepter · Refuser), sur
  toutes les pages ; le même chemin que les boutons de Telegram, qui passent déjà par le serveur. 4 → 2 (le nom,
  Accepter).
- **Ce que ça change pour Cal** : il répond à un ami sans quitter ODIO.
- **Principe** : l'action là où arrive la nouvelle (comme les boutons d'une notification, ce que fait déjà
  `server/core/alertes.py` pour le téléphone) ; une seule vérité côté serveur.
- **Coût** : petit (`commun/shell.js`, `lignesDuNom` ; les routes d'`admin.py`). **Dépend de** : rien.

### 7. Les sections en une colonne courte — rapide

- **Aujourd'hui** : dix grandes cartes à gauche (lettre, titre en capitales, sous-titre, compte) ; il faut
  défiler pour Diagnostics et le kit.
- **Proposé** : une liste serrée, une ligne par section : son nom et une pastille de couleur de jeton quand
  quelque chose attend (une demande : ambre ; une machine absente : rouge ; la file pleine : acier) ; le
  sous-titre au survol. Les dix tiennent sans défiler, l'état de tout le portail se lit dans la colonne.
- **Ce que ça change pour Cal** : un coup d'œil dit où regarder.
- **Principe** : les états par des formes plutôt que par des phrases (règle 4 de la rédaction) ; la
  reconnaissance plutôt que le rappel (Nielsen, heuristique 6 [3]).
- **Coût** : petit (`admin/admin.css`, `admin/admin.js`). **Dépend de** : rien.

### 8. Le budget en une barre — rapide

- **Aujourd'hui** : dans chaque Team, cinq lignes de texte expliquent le budget, puis deux champs (plafond GPU,
  crédits API) et une liste de « parts » par personne et par Workspace, chacune avec son champ.
- **Proposé** : une barre (utilisé / plafond du mois, réservé en clair), le plafond se règle en tirant le bout de
  la barre ou d'un double-clic sur le chiffre ; les parts se montrent comme des segments de la même barre, et se
  règlent pareil ; l'explication va dans l'étude et dans une aide d'une ligne au survol. 5 lignes à lire → 0 ;
  un champ à taper → un geste.
- **Ce que ça change pour Cal** : on voit tout de suite qui consomme, et on règle sans calculer.
- **Principe** : pas de paragraphes dans l'interface (règle 2 de la rédaction) ; la manipulation directe d'une
  quantité visible [1].
- **Coût** : petit à moyen (`admin/admin.js`, le budget ; `GET /api/budget` donne déjà les secondes mesurées et
  réservées). **Dépend de** : rien.

### 9. Le tableau vu de haut — géniale

- **Aujourd'hui** : des listes — les personnes, puis les Teams, puis leurs Workspaces, puis les objets dépliés,
  page après page.
- **Proposé** : la Vue d'ensemble en zoom sémantique, la même vue que « le portail vu de haut » de l'accueil
  (`accueil.md`, n° 5), avec toutes les Teams pour Cal : de loin, les Teams en régions (leur taille dit ce qu'on y
  a créé, leur éclat la dernière activité) ; plus près, leurs Workspaces et leurs membres ; plus près encore, les
  vignettes des objets. Avec la proposition 4, une personne s'y allume.
- **Ce que ça change pour Cal** : il voit d'un regard où l'on travaille, et où rien ne bouge depuis un mois.
- **Principe** : le zoom sémantique (Pad++ [7]) ; une seule vue, deux usages (Cal voit tout, chacun voit ses
  Teams : le serveur décide déjà, `GET /api/tableau`).
- **Coût** : gros (une seule page à écrire pour l'accueil et l'Admin). **Dépend de** : l'inventaire
  (`core/inventaire.py`), qui existe.

### 10. La file à un clic de partout — rapide

- **Aujourd'hui** : la file de l'Admin (l'ordre, les priorités, les pauses) est une section de l'Admin ; le
  tiroir de l'en-tête montre les travaux, mais pour remonter un travail ou mettre une machine en pause il faut
  aller dans l'Admin (le nom → Admin → La file : 3 gestes et une page).
- **Proposé** : pour Cal, le tiroir de la file reçoit les gestes de l'Admin sur place : glisser pour réordonner,
  épingler, pause par machine ; la section de l'Admin garde l'historique. 3 gestes et une page → 1.
- **Ce que ça change pour Cal** : quand un rendu urgent attend derrière un long, il le passe devant sans quitter
  son outil.
- **Principe** : l'action là où l'on voit l'état ; une seule file, deux vues (les mêmes routes,
  `/api/admin/…`, que le serveur juge).
- **Coût** : petit à moyen (`commun/shell.js`, le tiroir ; les gestes d'`admin.js` sortis en module commun).
  **Dépend de** : rien.

## 3. Le top 3

1. **Une Team, un seul endroit** (n° 1) avec **les gestes rares derrière « ⋯ »** (n° 2) : la page la plus chargée
  du portail devient lisible, et l'on règle là où l'on voit.
2. **Une personne choisie s'allume partout** (n° 4) : la question de Cal (« où a-t-il créé cet asset ? ») a sa
  réponse d'un survol, sans perdre la vue.
3. **Regarder un objet sans ouvrir d'onglet** (n° 5) : passer en revue le travail des autres devient rapide.

Puis : les demandes depuis le menu du nom (6) et le budget en une barre (8), une demi-journée chacune.

## Sources

1. Shneiderman, B., « Direct Manipulation: A Step Beyond Programming Languages », *Computer* 16(8), 1983,
   p. 57-69 (DOI 10.1109/MC.1983.1654471).
2. Interaction Design Foundation, « Hick's Law » —
   https://ixdf.org/literature/article/hick-s-law-making-the-choice-easier-for-users (extrait).
3. Nielsen, J., « 10 Usability Heuristics for User Interface Design », Nielsen Norman Group (5 : prévenir les
   erreurs ; 6 : reconnaître plutôt que se rappeler) — https://www.nngroup.com/articles/ten-usability-heuristics/
4. Nielsen Norman Group, « Progressive Disclosure » — https://www.nngroup.com/videos/progressive-disclosure/ (extrait).
5. Becker, R. A. & Cleveland, W. S., « Brushing Scatterplots », *Technometrics* 29(2), 1987, p. 127-142
   (extrait du moteur de recherche, 10/10/2026).
6. Apple, Aide Mac, « Voir et modifier des fichiers avec Coup d'œil » (Espace ouvre, Espace referme) —
   https://support.apple.com/guide/mac-help/mh14119/mac (extrait).
7. Bederson, B. B. & Hollan, J. D., « Pad++: A Zooming Graphical Interface for Exploring Alternate Interface
   Physics », UIST '94, p. 17-26 — https://www.lri.fr/~mbl/Teach/SituatedComputing/2017/papers/ZUI/pad++-uis94-p17-bederson.pdf
