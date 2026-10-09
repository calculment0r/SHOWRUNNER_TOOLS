# Équipes et espaces de travail — étude du 30/09/2026

**Statut** : les étapes 0 à 10 sont codées — le socle (0, 3, 7) et 1, 2, 4, 5, 6, 8 le
30/09, la phase B (9, 10, et la vérification générale) le 05/10 : voir « Fait le 30/09 » et
« Fait le 05/10 » en fin de fichier, et ce qui reste. Le code est lu sur le PC le
30/09 (`server/core/auth.py`, `library.py`, `jobs.py`, `server/tools/core_api.py`,
`droits.py`, `ideation_collab.py`, `music.py`, `ideation.py`) ; les données sur
DGX2 en lecture seule (`ssh dgx2`, `~/showrunner-data`, rien modifié).
**« Notre recommandation »** marque ce qui est proposé ici et n'est écrit nulle
part. Les pages des produits sont lues le **30/09/2026** ; les codes entre
crochets renvoient aux sources en fin de fichier ; **(extrait)** = la page
officielle refuse le robot (403 : help.miro.com, helpx.adobe.com,
help.runwayml.com, freepik), le fait vient du résumé du moteur de recherche
et reste **à revérifier à la main** avant de le montrer à un client.
**« Non documenté »** quand rien n'a été trouvé.

La demande de Cal (30/09), ses mots :

> « on a un gros chantier à faire qu'on aurait dû faire avant je pense... on
> doit organiser mieux l'espace de travail.. pour la partie "STUDIO" on doit
> pouvoir créer des équipes pour compartimenter... et donc une team on a des
> workspaces comme cela on peut avoir plusieurs workspaces .. on doit pouvoir
> comme Miro faire qu'on invite des gens aussi dans des teams avec des
> privilèges moindres mais qui peuvent quand même consulter et modifier des
> trucs mais ils ne peuvent pas faire ce qui consomme du compute.. étudie la
> logique de cela. pour la partie simple de l'abonnement (les apps seulement),
> on peut quand même créer des workspaces et tout ce que l'on crée est créé
> dans le workspace. et d'une façon générale, la bibliothèque Asset doit
> contenir tous les assets confondus car on peut vouloir rapatrier des choses
> de workspace en workspace. […] drag and drop des assets d'un autre workspace
> mais cela crée un nouvel asset dans le workspace de destination pour être sûr
> que si on édite une image dans un workspace, elle ne change pas dans le
> workspace original.. »

Accord avec l'étude parallèle `docs/etudes/panneau_asset.md` (le panneau Asset
à gauche de chaque outil, Ctrl+Espace) : **un asset appartient à UN espace ;
rapatrier = une copie neuve dans l'espace de destination, son origine gardée.**

---

## 0. Le résumé, en une page

**Le modèle** (notre recommandation) :

1. **Compte** = une personne (le pseudo d'aujourd'hui, `auth.json`). Elle a un
   rôle **portail** : `admin` (Cal, super-admin de l'instance) ou `membre`.
2. **Équipe** (Team) = qui paie et qui décide : un nom, des membres avec un
   rôle d'équipe, un **budget de calcul**, l'interrupteur des API payantes,
   l'offre (`apps` | `studio`). Le droit `access` d'aujourd'hui passe de la
   personne à l'équipe.
3. **Espace** (Workspace) = un dossier de travail d'une équipe : tout ce qu'on
   y crée **lui appartient** (objets, éléments, projets ODIO, séquences,
   planches, transcriptions, analyses, travaux de la file).
4. Chaque compte a une **équipe personnelle** (« Chez moi ») avec un espace par
   défaut : l'offre Apps seule y crée ses espaces, sans inviter personne.
5. **Rôles d'équipe** : propriétaire, admin, membre, **invité**. **Rôles
   d'espace** : admin d'espace, éditeur, commentateur, lecteur. Un invité
   n'entre que dans les espaces où on l'a mis.
6. **L'invité consulte et modifie, mais ne consomme pas de calcul** : garanti
   **dans `jobs.submit`**, le seul chemin de tout travail de la file (plus les
   trois calculs hors file : le relais Character Factory, la diarisation
   directe, l'allumage d'H3), quelle que soit la page.
7. Chaque sorte de travail déclare son **coût** : `gpu` (modèle local),
   `api` (payant), `cpu` (ffmpeg, export), `none`. Le rôle dit ce qu'on peut
   lancer ; le budget de l'équipe (et de la personne) dit combien.
8. **La bibliothèque Asset montre tout ce à quoi on a accès, tous espaces
   confondus**, filtrable par espace ; mais **un outil ne lit que les objets de
   son espace** : poser un objet d'ailleurs le **rapatrie** d'abord (copie
   neuve, nouvel id, nouvel `uid`, `origin.from = {space, item, uid}`).
9. Rapatrier un **élément versionné** copie **une version figée** (la dernière
   par défaut) comme v1 d'un élément neuf de l'espace d'arrivée ; sa source
   reste dans l'espace d'origine (« avec sa source » : la source est copiée
   aussi, en option Studio).
10. **Migration** : une équipe « Nirvalab » (propriétaire Cal), un espace
    « Général » ; tout ce qui existe y entre ; les amis y sont membres
    (`access: studio` → équipe Studio). Rien ne change pour eux le jour 1.

**La matrice, en une ligne** : lecteur = voir ; commentateur = + commenter ;
**invité-éditeur = + modifier, créer, rapatrier, exporter un fichier — jamais
de GPU ni d'API** ; membre = + calcul local et publier une version ; admin
d'espace = + inviter dans l'espace, API payante si le budget le permet ;
admin / propriétaire d'équipe = + gérer l'équipe, les budgets, les espaces.

### Les décisions à prendre (détail et recommandations au § 6)

1. Les mots affichés : « Équipe » et « Espace » (et non Team / Workspace) ?
2. Une équipe personnelle pour chaque compte, sans membres, pour l'offre Apps ?
3. Les quatre rôles d'équipe et les quatre rôles d'espace de la matrice (§ 2.4) ?
4. L'invité modifie par défaut (invité-éditeur), ou lit par défaut ?
5. Le calcul `cpu` (export MP4 du Montage, export d'une planche) : permis à l'invité ?
6. Le budget : de l'équipe, en « minutes GPU » locales et en crédits API, à zéro par défaut pour l'API ?
7. Rapatrier un élément : la version figée par défaut, « avec sa source » en option ?
8. Les fichiers d'une copie : lien dur sur `main.*` (pas de place en plus), copie pleine pour le reste ?
9. Qui peut modifier dans un espace partagé : tout éditeur (et non plus « seul l'auteur ») ; mettre à la corbeille : l'auteur ou l'admin d'espace ?
10. L'adresse : l'espace dans un en-tête par onglet (`X-SR-Espace`) et `?e=` dans l'URL, plutôt qu'un chemin `/w/<espace>/…` ?
11. L'invitation : un lien par équipe (ou par espace) avec rôle et durée, qui crée le pseudo, comme celui d'Idéation ?
12. La migration : « Nirvalab » / « Général », tous les amis membres, la visibilité `all` d'aujourd'hui gardée comme « tout le monde est dans Général » ?
13. L'ordre des étapes (§ 5.2) et le parallélisme proposé ?

---

## 1. L'état de l'art

Pages lues le 30/09/2026. Aucune n'affiche de date de mise à jour, sauf
celles marquées. Les faits Miro, Adobe, Runway et Freepik sont presque tous
**(extrait)** : leurs aides refusent le robot.

### 1.1 Miro

- **Hiérarchie** : Organisation → Teams → **Spaces** → boards, Docs ; chaque
  Space a ses propres contrôles d'accès [MI3][MI4] (extrait).
- **Rôles d'administration** : Company Admin (utilisateurs, Team Admins,
  sécurité), Team Admin (membre du team, le gère), Security Admin [MI1] (extrait).
- **Member / Guest / Visitor** : le membre crée ses boards ; le **Guest** fait
  partie du plan mais d'aucun team, n'accède qu'aux boards qu'on lui partage
  et **ne crée pas de board** dans le team ; le Visitor ouvre un board public
  par lien, sans inscription [MI1][MI2][MI5] (extrait).
- **Facturation** : guests **gratuits et illimités** (Business : « Unlimited
  guests » ; Free : « No guest role ») [MI7] (lu), [MI5][MI6] (extrait).
- **Rôles de board et de Space** : Owner (un seul), Co-owner, Editor,
  Commenter, Viewer ; le propriétaire d'un Space est éditeur de tout son
  contenu ; **quand un rôle de Space et un rôle de board se cumulent, le plus
  élevé s'applique** [MI8][MI9][MI3] (extrait).
- **Inviter** : lien d'invitation de team (Free, Starter, Education) ; si seuls
  les admins ajoutent des membres, l'invitation d'un membre arrive comme guest
  ou commenter, en attente d'un admin [MI10] ; en Enterprise, réglage « admins »
  ou « tous les membres » [MI11] (extrait).
- **Crédits IA** (page tarifs, lue [MI7]) : Free « 10 credits per month »,
  Starter « 25 AI credits/member/month », Business « 50 AI credits/member/month »,
  Enterprise « Starts from 2500 credits per month » (l'aide Enterprise dit
  100 par licence, limite souple : **contradiction** [MI13], extrait). Calculés
  par siège, **mis en commun** pour l'équipe, sans report ; lots en plus
  [MI12][MI14] (extrait).
- **Les Guests et Visitors ne lancent aucune action IA et ne consomment aucun
  crédit** [MI12] (extrait) — c'est la règle que Cal demande pour nos invités.
- **Couper l'IA** : Admin Console → Miro AI → « No one can use », « Everyone
  can use », « Specific teams can use » (Company Admins, Enterprise) [MI16] ;
  fonction par fonction avec Enterprise Guard [MI17] (extrait).

### 1.2 Figma

- **Hiérarchie** : Organisation → Team → **Folder** (les « projects » sont
  renommés « folders » depuis le **03/08/2026**) → File ; les droits
  descendent du parent [FG1] (date d'effet affichée), [FG2].
- **Rôles de team** : Owner (un seul, transférable), Admin, Can edit (crée des
  dossiers, n'invite qu'en lecture), Can view [FG2].
- **Sièges** (depuis le 11/03/2025 [FG5], extrait) : **Full** (tout), **Dev**
  (Dev Mode, FigJam, Slides ; lire et commenter Design), **Collab** (FigJam,
  Slides ; lire et commenter Design), **View** gratuit (« view, comment,
  inspect, or export ») ; Full 16 / 55 / 90 $, Dev 12 / 25 / 35 $, Collab
  3 / 5 / 5 $ (Pro / Organization / Enterprise) [FG6].
- **Invités** (Organization, Enterprise) : e-mail hors des domaines de
  l'organisation ; invités à un team, un dossier ou un fichier précis ; ils
  arrivent en siège View ; ne voient ni les autres teams ni les bibliothèques
  communes ; l'admin peut les restreindre ou exiger une approbation [FG8][FG9].
- **Crédits IA** (« as of August 25, 2026 » [FG3]) : siège Full 500 à 4 250
  par mois selon le plan ; Dev, Collab, View **500 par mois** ; View et Starter
  en plus « a daily limit of 150 credits » ; **individuels**, sans report ;
  épuisés : plus d'action IA, on demande à l'admin. Ordre : « Seat credits,
  Shared subscription credits…, Pay-as-you-go credits » ; l'admin fixe **par
  personne** accès complet, limite mensuelle ou « no access at all » aux
  crédits payants [FG4]. L'agent Figma et Weave deviennent payants le
  06/10/2026 [FG10].
- **Couper l'IA** : les team admins (Starter, Pro : une fois activée, elle le
  reste), les organization admins (Organization ; par workspace en
  Enterprise) ; activée par défaut [FG11].

### 1.3 Notion

- **Hiérarchie** : Workspace → **Teamspaces** → pages [NO2][NO3].
- **Rôles de workspace** : Workspace owner, Membership admin (Enterprise),
  Member ; aussi « Restricted members » (payants) et « Temporary members »
  [NO2].
- **Invités** : invités **page par page**, ils **ne rejoignent pas les
  teamspaces**, ne voient pas les réglages, n'ajoutent personne ; « Guests are
  free of charge » ; Free : 10 invités, payants : illimités [NO1][NO2][NO3].
- **Teamspaces** : ouvert, fermé (visible, sur invitation), privé (Business,
  Enterprise) ; owner et member [NO3].
- **IA** : Business et Enterprise ont une allocation renouvelée ; atteinte,
  l'IA se met en pause ou l'admin active les **Notion credits**, « shared
  across the workspace » ; modèles premium coupés par défaut ; plafond par
  défaut, puis **par personne ou par groupe** [NO5][NO7][NO8]. Invités et
  membres restreints ne créent ni n'interrogent les Custom Agents [NO9] ;
  l'accès des invités au reste de l'IA : **non documenté** sur les pages lues.

### 1.4 Frame.io (V4)

- **Hiérarchie** : Account → **Workspace** → Project → dossiers ; un droit de
  Workspace vaut pour « all existing and future Projects » [IO3] (mis à jour le
  16/06/2026) ; un droit posé plus bas **ne réduit pas** celui hérité d'en
  haut [IO1] (mis à jour le 16/06/2026) ; un projet restreint exige une
  invitation directe [IO2b].
- **Rôles d'account** : Account Owner (« see all and do all »), Content Admin
  (tout le contenu, pas la facturation), Member, **Guest** (limité à un
  projet), **Reviewer** (seulement par lien de partage) [IO1][IO2b].
- **Niveaux** (Workspace et Project) : Full Access, Edit & Share, Edit
  (« Cannot share or download »), Comment Only, View Only [IO1][IO2b].
- **Partages** : public ou sécurisé (Enterprise), interrupteurs
  commentaires, **téléchargements**, versions ; phrase secrète, expiration ;
  le relecteur n'a pas besoin de compte [IO6] ; relecteurs illimités et
  gratuits sur tous les plans ; Pro 15 $ (5 membres), Team 25 $ (15) [IO4].

### 1.5 Adobe (Admin Console, Firefly)

- **Rôles** : System admin (le seul qui attribue les rôles d'admin), Product
  admin, Product profile admin, User group admin, Deployment, Support, Storage
  [AD1][AD2][AD3] (extrait).
- **Crédits par utilisateur** (lu [AD4]) : Firefly Standard 2 000 par mois,
  Pro 4 000, Pro Plus 10 000, Premium 50 000 ; les plans « for teams » **par
  licence**. Les fonctions standard (Generative Fill) sont illimitées ; les
  **premium** (vidéo, voix, modèles partenaires Google, OpenAI, Runway,
  Kling…) sont décomptées [AD4][AD8] (extrait) ; barème par modèle : non
  documenté.
- **Épuisé** : les images standard « may be slower », la vidéo passe en file
  sans délai garanti, ou on achète un complément [AD6] (extrait), [AD7] (lu).
- **Entreprise, « Shared Credits »** (ex-Generative Credit Pool) : l'utilisateur
  épuise d'abord ses crédits individuels, puis un pot d'organisation **s'il y
  est assigné** (profil de produit) ; **pas de plafond par utilisateur** dans
  l'Admin Console, la limite est au contrat [AD9] (extrait), [AD10] (lu,
  13/03/2026).
- **Couper l'IA** : par profil de produit, interrupteur « Adobe Firefly »
  [AD12] (extrait, page éducation : l'étendue hors éducation n'est pas
  confirmée).

### 1.6 Runway, Krea, Higgsfield, Freepik, Leonardo

- **Runway** Team : 69 $ le siège (55 $ en annuel), 2 à 9 personnes,
  « 6,900 credits per seat per month, **pooled across the workspace** »,
  report d'un mois [RW1] (lu) ; rôles Admin, Editor (génère), Billing Admin
  (**ne génère pas**), **Viewer** (voit seulement) [RW2][RW3] (extrait) ;
  Enterprise : « You cannot allocate credits to individual users » ; répartir
  entre workspaces seulement [RW4][RW5] (extrait).
- **Krea** Teams : Owner, Admin, Member ; un plan individuel par membre, puis
  « falls back to the team's shared compute pool » [KR1] (lu) ; plafond par
  membre : Business selon un extrait [KR2], Enterprise selon la page lue [KR3]
  — **contradiction**, à trancher.
- **Higgsfield** : Team, les crédits de chaque siège « pools into the shared
  workspace balance » ; Scale : l'admin peut « pause an individual member's
  credit usage » ; Enterprise : rôles, groupes, **plafonds par groupe et par
  utilisateur** [HF1] (publiée le 02/08/2026, modifiée le 14/09/2026).
- **Freepik / Magnific Business** : crédits par utilisateur mis en commun ;
  l'admin fixe « a maximum credit cap per user » [FP1][FP2] (extrait).
- **Leonardo** Teams : pot de jetons partagé ; plafond par membre non
  documenté [LE1][LE2] (extrait).

### 1.7 Slack, Linear

- **Slack** : Single-Channel Guest (un canal, gratuit, jusqu'à 5 par membre
  payé), Multi-Channel Guest (« billed as regular members ») ; seuls owners et
  admins invitent ; les invités ont les résumés IA mais ne génèrent ni
  workflows ni notes de réunion [SL1].
- **Linear** : Workspace → Teams ; rôles Owner, Admin, Team Owner, Member,
  **Guest** (Business, Enterprise) qui ne voit que les teams où on l'a mis et
  y agit comme un membre, facturé comme un membre ; seuls les team owners
  l'ajoutent [LI1][LI2].

### 1.8 Le tableau comparatif

| | niveaux | invité : où | invité : paie ? | invité : IA / calcul | crédits : de qui | plafond par personne | couper l'IA |
|---|---|---|---|---|---|---|---|
| Miro | Organisation / Team / **Space** / board | les boards partagés | gratuit | **aucune action IA** | par siège, mis en commun | non documenté | Company Admin, par team |
| Figma | Organisation / Team / Folder / File | team, dossier ou fichier précis | siège View gratuit (ou autre siège) | 500 crédits / mois, 150 / jour en View | **individuels** + pot partagé + paiement à l'usage | **oui** (admin) | admins, par workspace (Ent.) |
| Notion | Workspace / **Teamspace** / page | page par page, pas les teamspaces | gratuit | Custom Agents : non ; reste : non documenté | allocation + crédits **du workspace** | **oui** (personne, groupe) | owner |
| Frame.io | Account / **Workspace** / Project | Guest : 1 projet ; Reviewer : par lien | Reviewer gratuit | — | — | — | — |
| Adobe | Organisation / profils de produits | — | — | — | **par licence** ; pot d'organisation en Entreprise | **non** (contrat) | par profil |
| Runway | Workspace (Organization Space en Ent.) | Viewer : voit | — | Viewer, Billing Admin : ne génèrent pas | **pot du workspace** | **non** | non documenté |
| Krea | Team | — | — | — | individuel, puis pot d'équipe | contradiction | non documenté |
| Higgsfield | Workspace | — | — | — | **pot du workspace** | pause (Scale), plafonds (Ent.) | non documenté |
| Linear | Workspace / Team | les teams où on l'a mis | comme un membre | non documenté | — | — | — |

### 1.9 Prix déjà relevés dans nos études (rappel)

| produit | fait | source (dans nos études) |
|---|---|---|
| Miro | Entreprise sur devis, **30 membres minimum**, hébergement UE possible ; Starter 8 $, Business 20 $ (annuel) | `positionnement.md` § 2.3, [M20] (lu le 29/09/2026) |
| Miro | des **invités gratuits** servent d'ancrage au siège Agence gratuit | `positionnement.md` § 4.6, [M20] |
| Figma | Professional : siège complet 16 $, **siège collab 3 $** ; Organization 55 $ / 5 $ ; Enterprise 90 $ / 5 $ ; **lecteurs illimités gratuits** | `positionnement.md` § 2.3, [M21] |
| Figma | bibliothèques : un fichier pose des **instances**, une mise à jour publiée attend « Update » fichier par fichier ; on ne pousse rien chez les autres sans publier | `apps_studio_elements.md` § 1.2, [FG1][FG3][FG8] |
| Frame.io | **piles de versions** sous une seule vignette ; un partage peut ne montrer que la dernière | `apps_studio_elements.md` § 1.2, [IO2][IO4] |
| Frame.io | Pro 15 $, Team 25 $ le membre (secondaire) | `positionnement.md` § 2.3, [M26] |
| Notion | Plus 10 $, Business 20 $ (annuel) (secondaire) | `positionnement.md` § 2.3, [M25] |
| Runway | Standard 15 $, Pro 35 $, Max 95 $ ; Gen-4.5 : 12 crédits par seconde | `positionnement.md` § 2.3, [M17] |
| Krea | Basic 9 $, Pro 35 $, Max 70 $, Business 200 $ (secondaire) | `positionnement.md` § 2.3, [M16] |
| Higgsfield | Team ≈ 69-79 $ le siège (secondaire) ; **entraîne sur le contenu** hors contrat Entreprise | `positionnement.md` § 2.3, [M1][M2][M3] |
| Adobe Firefly | Standard 9,99 $, Pro 19,99 $, Pro Plus 49,99 $, Premium 199,99 $ (secondaire) | `positionnement.md` § 2.3, [M19] |

(Les codes de ce tableau-là renvoient aux sources des études citées, pas à
celles de ce fichier.)

### 1.10 Ce qu'on en retient

1. **Deux ou trois niveaux, toujours un conteneur de travail** : Space (Miro),
   Teamspace (Notion), Workspace (Frame.io, Runway, Higgsfield), Team (Linear).
   Cal cite Miro : **équipe → espaces** (§ 2) ; l'« Organisation » au-dessus
   n'est utile qu'en Entreprise (plus tard : une instance par client suffit,
   `positionnement.md` § 4.7).
2. **L'invité est borné à ce qu'on lui a ouvert** : boards partagés (Miro),
   pages (Notion), teams choisis (Linear), un projet (Frame.io Guest). Chez
   nous : **les espaces où on l'a mis**, jamais toute l'équipe.
3. **L'invité est gratuit quand il ne produit pas** (Miro, Notion, Figma View,
   relecteurs Frame.io) et payant quand il agit comme un membre (Slack
   multi-canaux, Linear). D'où le siège Agence gratuit de `positionnement.md`
   § 4.6 : **gratuit parce qu'il ne calcule pas**.
4. **Le calcul est séparé de l'édition** : les Guests de Miro n'ont **aucune
   action IA** [MI12], le Billing Admin et le Viewer de Runway ne génèrent pas
   [RW2], Figma donne au siège View une petite part (150 par jour) [FG3]. La
   demande de Cal (« modifier, mais pas consommer de compute ») a donc son
   précédent direct chez Miro.
5. **Trois façons de compter les crédits** : par siège non partagé (Adobe
   Teams), par siège versé dans un **pot d'équipe** (Miro, Runway, Higgsfield,
   Freepik), individuel puis pot en secours (Figma, Krea, Adobe Shared
   Credits). Le **plafond par personne** existe chez Figma, Notion, Freepik,
   Higgsfield ; pas chez Runway ni Adobe. Pour nous (§ 2.6) : **un budget
   d'équipe, des parts facultatives par personne et par espace**.
6. **Couper l'IA est un geste d'admin**, souvent par équipe ou par workspace
   (Miro « Specific teams can use » [MI16], Figma par workspace [FG11]) ; chez
   nous : l'API payante **coupée par défaut**, ouverte par l'admin d'équipe.
7. **Le rôle de l'espace et le rôle du document se cumulent** : Miro prend **le
   plus élevé** [MI9] ; Frame.io : un droit plus bas **ne réduit pas** l'hérité
   [IO1]. Chez nous : la planche peut **ouvrir plus** (un lien de partage),
   jamais **moins** que ce que l'espace donne — sauf le calcul, qui suit
   toujours le rôle d'équipe (un invité ne calcule nulle part).
8. **Pas de lien vivant entre espaces** (Cal : « éditer dans B ne change pas
   A ») : comme les bibliothèques de Figma, rien ne se propage sans geste ;
   chez nous, on va plus loin : une copie (§ 3).

---

## 2. Le modèle pour Showrunner

### 2.1 Ce qui existe aujourd'hui (lu le 30/09)

| quoi | où | ce que ça dit |
|---|---|---|
| comptes | `auth.json` (`auth.py:206-240`) : `users{id, pseudo, role, state, access, quotas}` | 7 comptes sur DGX2 : `cal` (admin), `nico`, `su007`, `eric007`, `mehdi007`, `pilou007`, `steph007` (amis, tous `access: studio`) ; `settings` vide (défauts) |
| rôles portail | `auth.ROLES = ("admin", "ami", "invite")` (`auth.py:137`) | `invite` = entré par un lien d'Idéation, n'atteint que ce que les outils déclarent (`guest_realm`, `auth.py:666-711`) |
| le droit Studio | `auth.ACCESS = ("apps", "studio")`, `STUDIO_TOOLS`, `_studio_only`, `need_studio_kind` (`auth.py:383-497`) | posé **sur la personne** ; `need_studio_kind` n'est appelé **que** par la route commune `POST /api/jobs` (`core_api.py:405`), pas par `jobs.submit` |
| qui voit | `settings.visibility` : `all` (défaut, en service) ou `own` ; `can_read_item` (`auth.py:357-362`) | aujourd'hui **tout le monde voit tout** |
| qui modifie | `can_write_item` : le propriétaire ou un admin (`auth.py:365-369`) ; `library.check_write` (`library.py:244-254`) est le juge de **toute** écriture, objets et documents d'outils (projets ODIO `music.py:663`, analyses…) | un objet sans propriétaire est à Cal |
| propriétaire | `origin.user` posé par `library._owned` d'après la personne de la requête ou du travail (`library.py:235-241`) ; `owner` pour les documents d'outil (`music.py:641-642`, `transcrire.py:942`, `chanson.py:674`, `montage.py:961`) | sur DGX2 : 44 objets, 31 à `cal`, **13 sans propriétaire** (d'avant la porte : à Cal) |
| la file | `jobs.submit` (`jobs.py:325-356`) : **le seul chemin** de tout travail, route commune comme routes d'outils (`image.py:1577`, `movie.py:1758`, `music.py:885`, `ideation.py:1473`, `upscale.py:827`…) ; `retry` repasse par `submit` (`jobs.py:394-400`) | chaque travail porte `owner` ; quotas par personne (`running`, `queued`, `per_day`) et total (`jobs.py:307-322`) |
| GPU ou non | `_resolve` : `gpu` vrai quand la voie a des instances ComfyUI et une famille (`jobs.py:177-199`) ; voies `image`, `h3`, `audio` (GPU), `cpu` (ffmpeg), `analyse` | `montage.export`, `ideation.export`, `library.views` sont sur la voie `cpu` |
| calcul hors file | le relais Character Factory `/character/{api,files,v1}/` (`character.py:58-132`) : le studio de DGX1 calcule avec sa propre file ; la diarisation directe (`/api/analyse/diar/analyse`, déjà réservée à Cal : `droits.py:228-229`) ; `h3/start` de Vidéo | ces trois-là ne passent pas par `jobs.submit` |
| rôles de planche | `ideation_collab.py:347-424` : `owner`, `editor`, `viewer`, `none` ; `open` (éditeur par défaut pour tout membre du portail) ; liens d'invitation `{role, hours}` hachés | une seule planche a un fichier d'accès sur DGX2 (`owner: cal`, `open: editor`, aucun lien) |
| documents d'outil | ODIO `musique/mus-….json` (2), Idéation `ideation/ide-….json` (2, **sans owner** : l'owner est dans `ideation_collab/<id>.access.json`), séquences = objets `seq-…` de la bibliothèque (2), Montage `montage/` (ondes, migrés), LUT `luts/` (685 fichiers), `transcrire/`, `analyses/`, `chanson/`, `prefs/<personne>.json` | chaque outil liste ses documents par `library.readable(p)` (ODIO `music.py:619-629`) ou par son rôle (Idéation `ideation.py:730-743`) |
| identité mondiale | `instance.json` (`uuid ea13fd73-…`, créé le 30/09), `uid = sr:<uuid>/<id>` (`library.py:164-190`) | un objet reçu d'ailleurs garde son `uid` |

**Ce qui coince** : aucune notion de groupe ; la visibilité est tout ou rien ;
le droit Studio est sur la personne (une personne ne peut pas être Studio
dans une équipe et invitée ailleurs) ; « seul l'auteur modifie » empêche le
travail à plusieurs que Cal demande ; l'interdiction de calculer n'existe pas
(l'invité d'Idéation n'a simplement pas accès aux routes : il ne pourrait pas
non plus modifier ailleurs qu'Idéation).

### 2.2 Les mots

| mot affiché | ce que c'est | dans le code (notre recommandation) |
|---|---|---|
| **compte** | une personne, son pseudo | `auth.json` → `users` (inchangé) |
| **équipe** | qui paie, qui décide, qui calcule avec quel budget | `teams.json` → `tea-…` |
| **espace** | un lieu de travail d'une équipe ; possède ce qu'on y crée | `spaces` d'une équipe → `esp-…` |
| **membre** | une personne dans une équipe, avec un rôle d'équipe | `teams[t].members[uid] = {role, since, by}` |
| **invité** | un membre au rôle `invite` : n'entre que dans les espaces où on l'a mis | idem, `role: "invite"` |
| **rôle d'espace** | ce qu'on fait dans un espace | `spaces[e].members[uid] = {role}` ou le rôle par défaut de l'espace |
| **budget** | ce qu'une équipe (et chaque personne) peut calculer par mois | `teams[t].budget` |
| **rapatrier** | copier un asset d'un espace dans un autre | `POST /api/espaces/<e>/rapatrier` |

### 2.3 Qui possède quoi

Règle unique (notre recommandation) : **tout document porte `space`**, à côté
de son propriétaire, et **un seul** : objets de la bibliothèque (`item.json`),
projets ODIO, planches d'Idéation, transcriptions, analyses, chansons de
l'app Musique, LUT, travaux de la file. Le propriétaire (`origin.user`,
`owner`) reste l'**auteur** ; l'espace dit **à qui c'est** (qui le voit, qui le
modifie, qui paie son calcul).

| document | aujourd'hui | demain |
|---|---|---|
| objet, élément, version, séquence | `origin.user` | + `space` (posé par `library._owned`, comme `user` : **aucun outil n'a rien à changer**) |
| projet ODIO, transcription, chanson | `owner` | + `space` (posé à la création par la même fonction) |
| planche d'Idéation | `ideation_collab/<id>.access.json` (`owner`, `members`, `open`) | + `space` dans la planche ; `open` devient « le rôle d'espace » ; les rôles propres à la planche restent (on peut resserrer une planche, pas l'ouvrir au-delà de l'espace, sauf lien de partage explicite) |
| LUT | un fichier par LUT, `author` | + `space` |
| travail | `owner` | + `space` (d'où l'objet produit hérite son `space` par `ctx.add`) |
| préférences | `prefs/<personne>.json` | **inchangées** : à la personne, pas à l'espace ; + `dernier espace` rangé sur le compte |

**D'où vient l'espace d'un document neuf** (juste par construction) :

1. un travail : l'espace du **document source** s'il y en a un (la séquence
   exportée, le projet ODIO, la planche) ; sinon l'espace de la requête ;
2. un objet rangé par un travail (`ctx.add`) : l'espace **du travail**, jamais
   celui de la page ;
3. une création par une page (dépôt, projet neuf, planche neuve) : l'espace de
   la requête, dit par l'en-tête `X-SR-Espace` que pose `api()` de
   `commun/shell.js` (la fonction par où passent toutes les requêtes des pages,
   `shell.js:149-161`) ; sans en-tête : le dernier espace de la personne, et le
   journal le note.

Le pendant de `auth.current()` : `auth.current_space()` (fil d'exécution),
posé par la porte (`gate`) d'après l'en-tête, et par la file le temps du `run`
d'un travail, **exactement** comme la personne l'est aujourd'hui
(`library.get` le dit : « la personne de la requête, ou le propriétaire du
travail en cours », `library.py:718-728`).

### 2.4 Les rôles et la matrice

**Rôles d'équipe** (notre recommandation) :

| rôle | pour qui | ce qu'il ajoute |
|---|---|---|
| **propriétaire** | celui qui a créé l'équipe (ou Cal) ; un seul | supprimer l'équipe, changer d'offre, céder la propriété |
| **admin d'équipe** | ceux qui gèrent | membres, invités, espaces, budgets, interrupteur API |
| **membre** | l'équipe interne | entre dans tous les espaces « ouverts » de l'équipe avec leur rôle par défaut ; calcule sur le budget |
| **invité** | un client, un prestataire, une agence | n'entre **que** dans les espaces où on l'a mis ; **aucun calcul GPU ni API**, jamais (le rôle d'espace ne peut pas lui en donner) |

**Rôles d'espace** :

| rôle | ce qu'il fait |
|---|---|
| **admin d'espace** | tout dans l'espace, inviter dans l'espace, régler son rôle par défaut, sa part de budget |
| **éditeur** | voir, commenter, modifier, créer ; calculer si son rôle d'équipe le permet |
| **commentateur** | voir, commenter |
| **lecteur** | voir |

Le droit effectif = **le plus petit** des deux quand il s'agit de calcul (un
invité éditeur ne calcule pas) ; le rôle d'espace pour tout le reste.

**La matrice rôle × action** (✔ oui ; — non ; B : si le budget le permet) :

| action | lecteur | commentateur | invité (éditeur) | membre (éditeur) | admin d'espace | admin d'équipe / propriétaire | Cal (admin portail) |
|---|---|---|---|---|---|---|---|
| voir (objets, documents, file de l'espace) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| commenter (fil d'Idéation, notes) | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| modifier (planche, séquence, projet ODIO, titre, dossier, tags) | — | — | ✔ | ✔ | ✔ | ✔ | ✔ |
| créer (planche, séquence, projet, dépôt de fichier) | — | — | ✔ | ✔ | ✔ | ✔ | ✔ |
| rapatrier un asset **dans** cet espace | — | — | ✔ (depuis un espace qu'il voit) | ✔ | ✔ | ✔ | ✔ |
| mettre à la corbeille | — | — | le sien | le sien | ✔ | ✔ | ✔ |
| lancer un calcul `cpu` (export MP4, export de planche) | — | — | décision 5 (recommandé : ✔, borné par ses quotas) | ✔ | ✔ | ✔ | ✔ |
| **lancer un rendu GPU local** | — | — | **—** | B | B | B | ✔ |
| **lancer un rendu API payant** | — | — | **—** | B (si l'API est ouverte à l'équipe) | B | B | ✔ |
| publier une version d'élément | — | — | — (la publication **calcule** : § 2.5) | ✔ | ✔ | ✔ | ✔ |
| exporter un fichier (zip d'Asset, télécharger) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| exporter un paquet (`package_export.md`) | — | — | — | ✔ | ✔ | ✔ | ✔ |
| inviter dans l'espace | — | — | — | — | ✔ | ✔ | ✔ |
| inviter dans l'équipe, gérer membres, espaces, budgets, API | — | — | — | — | — | ✔ | ✔ |
| régler la file, les machines, le câblage | — | — | — | — | — | — | ✔ |

Deux points à noter :

- **Publier une version** calcule (rendu du morceau, export MP4 d'une séquence :
  `apps_studio_elements.md`, « Publier = calculer la source ») : l'invité ne
  publie donc pas. S'il a modifié un projet, un membre publie.
- **Exporter un fichier déjà fait** (zip) ne calcule rien : permis à tous ceux
  qui voient. Le paquet, lui, est une remise de travail (décision de Cal dans
  `package_export.md`) : réservé aux membres.

### 2.5 « Ne consomme pas de calcul » : par construction

**Le principe** : le refus ne dépend d'aucune page. Il se tient à **l'endroit
par où tout calcul passe**.

1. **Chaque sorte de travail déclare son coût** à `jobs.register` :
   `cost="gpu" | "api" | "cpu" | "none"`, ou une fonction(params) (Image : un
   modèle local → `gpu`, un modèle fermé → `api`). Par défaut, déduit de ce que
   la file sait déjà : `gpu` si `_resolve` dit GPU (`jobs.py:190-193`), `cpu`
   sinon. **Une sorte sans coût déclaré sur une voie GPU vaut `gpu`** : l'oubli
   est refusé, jamais permis.
2. **`jobs.submit` juge** (et non plus la route commune seulement,
   `core_api.py:405`) : la personne, l'espace du travail, le coût.
   `auth.may_compute(u, space, cost)` → oui, ou 403 qui dit pourquoi et mène
   à qui débloque (« invité : les rendus sont réservés aux membres de
   l'équipe Nirvalab — demande à Cal ou à un admin », règle 7 du thème). Comme
   **toutes** les routes d'outils et `retry` passent par `jobs.submit`
   (§ 2.1), aucune page ne peut contourner. `need_studio_kind` y descend
   aussi (aujourd'hui, une route d'outil Studio est gardée par
   `_studio_only` sur ses préfixes d'écriture ; demain, les deux au même
   endroit).
3. **Les trois calculs hors file** reçoivent la même garde, déclarée une fois :
   `auth.COMPUTE_ROUTES` (le relais `/character/…` en écriture, `h3/start`, la
   diarisation directe) jugés dans `gate`, comme `ADMIN_ROUTES`
   (`auth.py:607`, `638-641`).
4. **Le travail lancé par un travail** (la chaîne d'une planche, un rendu qui
   en appelle un autre) garde l'espace et la personne de celui qui l'a lancé :
   `submit(owner=…)` existe déjà (`jobs.py:333-334`).
5. **La preuve** (dans `tools/check.py`, un selftest à la manière de
   `droits.py`) : pour **chaque** sorte enregistrée (`jobs.HANDLERS`), un
   invité reçoit 403 si son coût est `gpu` ou `api`, par la route commune
   **et** par la route de l'outil ; le contrôle **échoue** si une sorte n'a pas
   de coût connu. Un outil neuf qui oublie de déclarer son coût casse le
   contrôle.

### 2.6 Le budget de calcul

| | local (GPU des DGX) | API payante |
|---|---|---|
| ce qu'on compte | les **secondes de GPU** mesurées par la file (`_t0` → fin, `jobs.py:232-242`, déjà mesurées pour les estimations) | le **prix** du fournisseur (et notre marge : `positionnement.md` question 8), en crédits (1 crédit = 0,01 €, `positionnement.md` § 4.6) |
| défaut | un plafond mensuel par équipe (notre proposition : illimité pour Nirvalab ; pour une équipe cliente, celui de son offre) + les quotas de file d'aujourd'hui par personne (`running`, `queued`, `per_day`), inchangés | **zéro** : l'API est **coupée** tant que l'admin d'équipe ne l'ouvre pas et ne pose pas un plafond (`modeles.md` décision 1, « budget mensuel » ; `positionnement.md` § 4.6 « un espace a un plafond ») |
| par personne | une part facultative du plafond d'équipe (« Léa : 2 h de GPU par mois ») | idem, en crédits |
| par espace | une part facultative (un espace client plafonné) | idem ; + la liste des modèles permis |
| avant de lancer | l'estimation (« ≈ 4 min ») existe | **le prix** se voit avant de lancer (`positionnement.md` § 4.6) ; sans budget, la pastille est grisée et dit pourquoi (`modeles.md` § 6.3) |
| juste par construction | la **réservation** : `jobs.submit` réserve l'estimation sur le budget ; la fin du travail la remplace par la mesure ; un travail annulé la rend | idem, avec le prix affiché ; un rendu refusé par le fournisseur rend la réservation |

`positionnement.md` parle d'« espace client » pour le plafond ; dans ce modèle,
**c'est l'équipe qui paie** (notre recommandation) : le plafond est à l'équipe,
l'espace n'en a qu'une part s'il le faut.

### 2.7 L'offre Apps seule

Cal : « pour la partie simple de l'abonnement (les apps seulement), on peut
quand même créer des workspaces et tout ce que l'on crée est créé dans le
workspace ».

Notre recommandation : **chaque compte a une équipe personnelle** (« Chez
moi »), créée avec le compte, dont il est le seul membre et le propriétaire.
L'offre Apps = cette équipe, ses espaces (autant qu'il veut), les Apps et
Asset ; **elle n'invite personne** (inviter = Studio). Le code reste le même
pour tous : pas de cas « sans équipe ». Une personne Studio a sa propre
équipe personnelle **et** les équipes où on l'a mise.

### 2.8 Ce que deviennent les rôles d'aujourd'hui

| aujourd'hui | demain |
|---|---|
| `admin` (Cal) | **admin du portail** (super-admin de l'instance) : la file, les machines, le câblage, toutes les équipes ; propriétaire de « Nirvalab » |
| `ami` | **membre du portail** ; membre (ou admin) des équipes où on l'a mis |
| `invite` (lien d'Idéation) | **invité d'équipe** dans l'équipe de la planche, lecteur ou éditeur de l'espace de la planche selon le lien ; la planche garde ses rôles propres |
| `access: apps | studio` sur la personne | **l'offre de l'équipe** (`teams[t].plan`) ; `auth.access_of(u)` devient `access_of(u, space)` = l'offre de l'équipe de l'espace (un admin : studio) |
| `visibility: all | own` | disparaît : on voit ce qui est dans ses espaces |
| `quotas` par personne | inchangés (la file) ; le budget s'y ajoute |
| `shared` d'un objet | disparaît au profit du rapatriement (ou d'un lien de partage explicite, § 4.1) |

---

## 3. Les espaces et la bibliothèque

### 3.1 Asset montre tout, les outils lisent leur espace

- **Asset** (et le panneau Asset de chaque outil, `panneau_asset.md`) :
  `GET /api/library?space=…` ; sans `space`, **tout ce que la personne voit,
  tous espaces confondus**, chaque carte marquée de son espace (pastille en
  capitales mono, règle 5 du thème), un filtre par espace, l'espace courant
  en tête.
- **Un outil** lit par `library.get` (`library.py:718-728`), qui juge déjà la
  visibilité « à cet endroit seulement ». Il jugera aussi l'espace : dans une
  requête ou un travail d'un espace, `get` **ne rend que les objets de cet
  espace**. Une séquence de B ne peut donc pas poser une image de A, ni un
  rendu de B lire une référence de A, **par construction** : il faut la
  rapatrier. Les listes d'Asset tous espaces confondus passent par une
  fonction explicite (`library.query(spaces=…)`) qui ne sert qu'à montrer.
- **Les documents** : l'enregistrement d'une séquence (`montage.r_save`), d'un
  projet ODIO (`music.save_project`, `music.py:666-668`) et d'une planche
  appelle déjà `elements.check_doc` (« une ligne marquée `# éléments :` ») ;
  la même ligne vérifie que **chaque identifiant posé est de l'espace du
  document**, par la table `ID_FIELDS` de `package_export.md` § 2.3 (une seule
  vérité, lue par l'export, l'import et ce contrôle). Un identifiant d'ailleurs :
  409 qui dit lequel.

### 3.2 Rapatrier un asset

`POST /api/espaces/<B>/rapatrier {items: [...], avec_source?: false}` — ce que
fait le glisser-déposer d'un asset d'un autre espace (Cal), dans Asset, le
panneau, ou directement sur une timeline.

1. **Droits** : lire l'objet dans A (être dans A), créer dans B (éditeur de B).
2. **Un objet neuf dans B** : nouvel id (`library.new_id`), **nouvel `uid`**
   (déduit de l'id), `space: B`, `origin.user` = qui rapatrie,
   `origin.from = {space: A, item: <id>, uid: <uid d'origine>, at}`.
   Le titre, la recette (`prompt`, `params`), les tags, les dimensions suivent ;
   les `parents` (la lignée) gardent leurs ids d'origine, marqués
   « dans A » (on ne rapatrie pas toute la lignée).
3. **Jamais un lien vivant** : éditer la copie dans B ne touche pas A, et
   inversement (Cal).
4. **Les fichiers** (décision 8) : ext4 sur DGX2 (`df -T`, relevé le 30/09) ne
   connaît pas la copie à l'écriture (reflink) ; le portail fait déjà des
   **liens durs** pour les films de Movie Analysis (`analyse.py:855-862`,
   copie si le lien échoue). Notre recommandation : **lien dur pour `main.*`**
   (le fichier principal, jamais réécrit en place : aucun chemin d'écriture
   trouvé par `path_of(…).write/unlink`, relevé du 30/09 — **à prouver** par un
   contrôle qui passe chaque écriture de la bibliothèque et vérifie l'inode),
   **copie pleine** pour la vignette, les copies d'affichage et les références
   d'un élément (petites, et réécrites : `make_thumb`, `add_ref`). La
   corbeille et le vidage d'un côté laissent l'autre intact (un lien dur vit
   tant qu'un nom le porte).
5. **Pourquoi un nouvel `uid`** : `package_export.md` § 2.6 rapproche deux
   objets **par `uid`** (« même `uid` = le même objet, on ne le recopie pas ») ;
   une copie rapatriée est un **autre** objet (elle peut diverger) : elle doit
   avoir son propre `uid`, et dire d'où elle vient par `origin.from.uid`.
6. **Annuler** : Ctrl+Z met la copie à la corbeille (la pile de la page,
   `commun/undo.js`).

### 3.3 Rapatrier un élément versionné

Un élément de A a une source dans A (un projet ODIO, une séquence) et une pile
de versions (`apps_studio_elements.md`, « Fait le 30/09 »). Trois façons :

| | ce qui arrive dans B | pour | contre |
|---|---|---|---|
| **a. la version figée** (recommandée par défaut) | un **élément neuf** dans B, dont la v1 est une copie de la version choisie (la dernière par défaut) ; `origin.from = {space: A, el, n, uid}` ; **sans source** (« source dans l'espace Nirvalab / Général ») | simple, sûr, rien ne bouge dans A ; le montage de B pose une version comme d'habitude | B ne peut pas refaire la chanson |
| **b. avec sa source** (option Studio) | + une **copie du document source** dans B (le projet ODIO), et l'élément de B devient vivant sur cette copie | B peut continuer le travail de son côté (un « fork ») | deux sources qui divergent ; plus lourd |
| **c. avec l'historique** | toutes les versions copiées comme v1…vn de B | on garde la trace | la numérotation se confond ; peu d'intérêt si `origin.from` dit déjà d'où ça vient |

Notre recommandation : **a** par défaut, **b** en option (« Rapatrier avec sa
source »), **pas c**. Plus tard, une option **« suivre l'origine »** : B voit
« A a publié la v4 » et peut **rapatrier la v4** comme sa v2 — ce que font les
bibliothèques de Figma (on accepte une mise à jour, § 1.9), sans lien vivant.

### 3.4 Les usages, la corbeille, le journal des éléments

- **Usages** : ils ne traversent plus les espaces (§ 3.1) ; l'index des
  usages (`elements._summaries`) se lit par espace. Une version de A posée
  dans une séquence de A reste protégée de la corbeille (le garde existe).
- **La corbeille** : une par espace (`trash/` garde le dossier ; son
  `item.json` dit l'espace) ; « vider » : admin d'espace ou Cal.
- **Le journal des éléments** (`elements/journal.jsonl`) : chaque ligne porte
  `space` ; une page ne reçoit que ceux de ses espaces.

### 3.5 Les documents dans un espace

Planches d'Idéation, projets ODIO, séquences, transcriptions, analyses,
chansons : **dans un espace**, listés par l'espace courant (la liste d'ODIO
filtre déjà par `library.readable`, `music.py:619-629` : il suffit que
`readable` juge l'espace). **Déplacer** un document d'un espace à l'autre :
réservé au propriétaire du document et à l'admin des deux espaces, et il
emmène ce qu'il pose (la fermeture de `ID_FIELDS`) — c'est un rapatriement du
document et de ses objets, puis la mise à la corbeille de l'original
(notre recommandation : pas de « déplacer » au premier jour ; « dupliquer
dans… » suffit).

### 3.6 Le paquet d'export

Le paquet (`package_export.md`) part **d'un espace** : ses points de départ et
sa fermeture (§ 2.3 de cette étude-là) ne sortent jamais de l'espace (ils ne
le peuvent plus, § 3.1). Le manifeste porte l'équipe et l'espace ; l'import se
fait **dans** un espace (`origin.via = "paquet"`), sous le propriétaire qui
importe. Exporter un paquet : membre et au-dessus (§ 2.4).

---

## 4. Le reste du portail

### 4.1 Inviter

- **Un lien d'invitation par équipe**, et par espace (notre recommandation) :
  `{rôle d'équipe, espaces et rôle d'espace, durée}`, un jeton haché comme ceux
  d'Idéation (`ideation_collab.py:632-656`) et un pseudo : celui qui l'ouvre
  tape son pseudo, **un pseudo neuf est accepté par le lien** (comme
  aujourd'hui pour l'invité d'Idéation, `auth.accept(…, role=GUEST)`), un
  pseudo existant rejoint l'équipe. Aucune page tierce, aucun e-mail (Cal a
  retiré Cloudflare Access le 29/09 : `REPRISE.md`).
- **Qui invite** : l'admin d'équipe (dans l'équipe), l'admin d'espace (dans son
  espace, comme invité ou lecteur seulement ; pas un membre, qui compte dans les
  sièges).
- **Le lien d'une planche** reste (Idéation) : il fait un invité de l'équipe,
  restreint à l'espace de la planche et à cette planche.
- **La porte publique** ne change pas : le Worker signe l'identité, le portail
  juge (`auth._door_gate`) ; l'invitation d'équipe passe par `/api/auth/…`, déjà
  ouvert sans session (`auth.py:831-832`).

### 4.2 L'Admin de Cal et l'admin d'une équipe

| | Admin de Cal (`admin/`, `/api/admin/…`) | Réglages d'équipe (neuf, `equipe/` ou un panneau d'en-tête) |
|---|---|---|
| personnes | tous les comptes, suspendre, le rôle portail | les membres de l'équipe, leurs rôles, les liens d'invitation |
| équipes | toutes : créer, l'offre, le propriétaire | la sienne : nom, espaces, budgets, API |
| file et machines | ✔ | — (voit sa consommation) |
| journal | tout | celui de son équipe |

### 4.3 L'en-tête

Un **sélecteur en haut à gauche**, à côté du logotype (`mountHeader`,
`shell.js:297-309`) : « ÉQUIPE / ESPACE » en capitales mono, un menu qui liste
ses équipes et leurs espaces, « + Nouvel espace », « Réglages de l'équipe ».
Changer d'espace recharge la liste de l'outil ; un document ouvert dit
toujours son espace (il ne change pas d'espace parce que l'en-tête change).

### 4.4 Les adresses

Les pages publiques sont servies **par le Worker, depuis ses assets**, sans
passer par DGX2 (`wrangler.jsonc` : seuls `/api/*`, `/library/*` et quelques
préfixes vont au portail). Un chemin `/w/<espace>/image/` n'existerait pas dans
les assets : il faudrait le réécrire dans le Worker et dans le serveur de la
maison. Notre recommandation (décision 10) : **l'espace dans l'onglet**
(`sessionStorage`) et dans l'URL en paramètre (`?e=esp-…`, lisible, qu'on peut
envoyer), l'en-tête `X-SR-Espace` posé par `api()` à chaque requête ; les flux
SSE (qui ne portent pas d'en-tête) prennent `?e=`. Deux onglets peuvent ainsi
être dans deux espaces (ce qu'un cookie ne permettrait pas). Les liens de
documents gardent leur forme (`musique/#mus-…`) : le document dit son espace.

### 4.5 Co-édition et présences

La co-édition d'Idéation (`ideation_collab.py`) est par planche ; elle reste
ainsi, avec le rôle d'espace comme plancher. Les présences « qui est dans cet
espace » : plus tard, sur le même flux SSE (non nécessaire au premier jour).

### 4.6 Les journaux

`journal.jsonl` (`auth.journal`, `auth.py:1748-1758`) : chaque ligne porte
`team` et `space` quand il y en a ; l'admin d'équipe lit les siennes. La
consommation (secondes GPU, crédits) : un journal à part par équipe
(`teams/<t>/conso.jsonl`), la vérité du budget.

---

## 5. La migration et le plan de travail

### 5.1 Migrer sans rien casser

Un script idempotent (`tools/migrer_espaces.py`, lancé par Cal, sauvegarde
d'abord `auth.json` et un index des `item.json` comme le 29/09 pour `access`) :

1. créer `teams.json` : l'équipe **« Nirvalab »** (`plan: studio`, propriétaire
   `cal`, budget local illimité, API coupée) et son espace **« Général »** ;
2. chaque ami actif (`nico`, `su007`, `eric007`, `mehdi007`, `pilou007`,
   `steph007`, tous `access: studio`) → **membre** de Nirvalab, éditeur de
   Général ; un compte `access: apps` (aucun aujourd'hui) → équipe
   personnelle `plan: apps` ;
3. chaque compte → son équipe personnelle « Chez moi » + un espace ;
4. **chaque objet, document et LUT → `space: Général`** (44 objets, 2 projets
   ODIO, 2 planches, 2 séquences, les LUT, transcriptions, analyses) ; les 13
   objets sans propriétaire restent à Cal ;
5. la planche partagée (`ide-20260929-192857-f0b0`, `open: editor`) garde ses
   rôles ; ses invités éventuels (aucun sur DGX2) → invités de Nirvalab ;
6. `visibility: all` d'aujourd'hui = « tout le monde est dans Général » : **le
   jour 1, chacun voit et fait ce qu'il faisait** ; la seule différence visible
   est l'en-tête. Changement voulu : un ami peut désormais modifier la planche
   ou la séquence d'un autre dans Général (décision 9).

Un objet lu sans `space` (ancien, ou d'une copie d'essai) vaut l'espace par
défaut de l'instance (`Général`) : le code n'a jamais de « sans espace ».

### 5.2 Les étapes livrables

| étape | quoi | fichiers | preuve | dépend de |
|---|---|---|---|---|
| **0** | le socle : `teams.json`, `core/espaces.py` (équipes, espaces, rôles, `role_in`, `may`) ; `auth.current_space()` posé par `gate` (en-tête, `?e=`) et par la file | `server/core/espaces.py` (neuf), `server/core/auth.py`, `server/core/http.py` | selftest : rôles, matrice § 2.4 en table | — |
| **1** | la garde du calcul : `cost` à `jobs.register`, le jugement dans `jobs.submit`, `COMPUTE_ROUTES` ; `need_studio_kind` y descend | `server/core/jobs.py`, `server/core/auth.py`, `server/tools/core_api.py`, chaque `server/tools/*.py` qui enregistre (une ligne `cost=`) | **le contrôle de chaque sorte** (§ 2.5, point 5) | 0 |
| **2** | la propriété : `space` posé par `library._owned`, `ctx.add`, les créations d'outils ; `can_read_item` / `can_write_item` par rôle d'espace ; `library.get` borné à l'espace courant ; `query(spaces=)` | `server/core/library.py`, `server/core/auth.py`, `server/core/jobs.py`, `music.py`, `transcrire.py`, `chanson.py`, `montage.py`, `analyse.py` (création seulement) | `droits.py` étendu : A dans Général, B invité, C d'une autre équipe | 0 |
| **3** | la migration (§ 5.1) | `tools/migrer_espaces.py` (neuf) | sur une copie des données de DGX2 : avant / après, chaque compte voit les mêmes listes | 2 |
| **4** | l'en-tête et `api()` : le sélecteur, `X-SR-Espace`, `?e=` | `commun/shell.js`, `commun/shell.css` | pilote Playwright sur DGX2 (`tools/shot.mjs`), sombre et clair | 0 |
| **5** | Asset tous espaces, filtre, pastille ; **rapatrier** (route, glisser-déposer) | `server/tools/asset.py`, `server/core/library.py`, `asset/asset.js`, `asset/asset.css` ; le panneau (`panneau_asset.md`) s'y branche | selftest : copie neuve, `uid` neuf, `origin.from`, lien dur de `main.*`, éditer B ne touche pas A | 2, 4 |
| **6** | les documents : `check_doc` juge l'espace par `ID_FIELDS` ; listes par espace | `server/tools/elements.py`, `montage.py`, `music.py`, `ideation.py`, `ideation_collab.py` | une séquence de B qui pose un objet de A : 409 | 2, 5 |
| **7** | l'invitation d'équipe et d'espace, les réglages d'équipe | `server/tools/compte.py`, `server/tools/equipes.py` (neuf), une page ou un panneau `equipe/`, `admin/` | selftest par la porte « code » (`porte_publique.py`) | 0, 2 |
| **8** | le budget : réservation, mesure, `conso.jsonl`, affichage | `server/core/jobs.py`, `server/core/espaces.py`, `accueil.js` (section « Machines et crédits ») | un travail annulé rend sa réservation ; plafond atteint : 429 qui le dit | 1 |
| **9** | les éléments entre espaces : rapatrier une version (a), avec sa source (b) | `server/tools/elements.py`, `asset/asset.js` | selftest : v3 de A → v1 de B, A intact | 5, 6 |
| **10** | reporter dans `docs/ARCHITECTURE.md` § 2, 3, 9 et `CLAUDE.md` | docs | — | tout |

**En parallèle** (un agent possède ses fichiers, `REPRISE.md`) :

- après l'étape 0 : **1** (file : `jobs.py`, les lignes `cost=` des outils),
  **2** (bibliothèque : `library.py`, créations d'outils) et **4** (pages :
  `shell.js`) peuvent partir ensemble ; seul `auth.py` est partagé entre 0, 1
  et 2 → l'étape 0 le livre entier (les fonctions `may_compute`,
  `can_read_item`, `can_write_item` y sont écrites une fois), 1 et 2 ne
  font que les appeler ;
- **7** (invitations) part avec 1 et 2 ;
- **5** et **6** attendent 2 ; **8** attend 1 ; **3** (migration) se joue sur
  une copie des données dès que 2 est prête, et en vrai **avant** de pousser 4
  (sinon l'en-tête montre un espace vide).

---

## 6. Les décisions pour Cal

1. **Les mots.** « Équipe » et « Espace » à l'écran (le français partout),
   `team` / `space` dans le code. *Recommandé.*
2. **L'équipe personnelle.** Chaque compte a « Chez moi » : l'offre Apps y
   crée ses espaces ; pas de cas « sans équipe » dans le code. *Recommandé.*
3. **Les rôles.** Équipe : propriétaire, admin, membre, invité ; espace :
   admin, éditeur, commentateur, lecteur ; la matrice du § 2.4. *Recommandé.*
4. **L'invité modifie par défaut** (invité-éditeur), comme Cal le décrit
   (« consulter et modifier ») ; l'admin peut le mettre lecteur. *Recommandé.*
5. **Le calcul `cpu`** (export MP4, export d'une planche) permis à l'invité,
   borné par ses quotas de file : il ne touche pas au GPU. *Recommandé* —
   sinon, l'invité monte une séquence sans pouvoir la voir en MP4.
6. **Le budget** à l'équipe : secondes de GPU (plafond mensuel, illimité pour
   Nirvalab) et crédits API **à zéro, API coupée par défaut** ; parts
   facultatives par personne et par espace ; le prix vu avant de lancer.
   *Recommandé.*
7. **Rapatrier un élément** : la version figée par défaut (a), « avec sa
   source » en option Studio (b), pas l'historique (c) ; « suivre l'origine »
   plus tard. *Recommandé.*
8. **Les fichiers d'une copie** : lien dur pour `main.*` après le contrôle qui
   prouve qu'aucun code ne le réécrit en place, copie pleine pour le reste.
   *Recommandé* (sinon : copie pleine partout, simple, plus de disque).
9. **Modifier à plusieurs** : dans un espace partagé, tout éditeur modifie (fin
   de « seul l'auteur ») ; la corbeille reste à l'auteur et à l'admin
   d'espace ; une version publiée reste figée pour tous. *Recommandé.*
10. **L'adresse** : l'espace par onglet (`X-SR-Espace`, `?e=`), pas de chemin
    `/w/<espace>/…` (les pages sont servies par le Worker). *Recommandé.*
11. **Inviter** : un lien par équipe et par espace, avec rôle et durée, qui
    crée le pseudo, sans e-mail ni page tierce. *Recommandé* — à montrer à Cal
    avant de déployer (tout ce qui touche l'entrée, `REPRISE.md`).
12. **La migration** : « Nirvalab » / « Général », tous les amis membres
    éditeurs, rien de visible ne change le jour 1 sauf l'en-tête. *Recommandé.*
13. **L'ordre** : 0 → (1, 2, 4, 7 en parallèle) → 3 sur copie → 5, 6, 8 → 9 →
    10. La garde du calcul (1) d'abord : c'est la promesse faite aux invités.
    *Recommandé.*

**Reste à faire sur cette étude** : revérifier à la main les faits marqués
**(extrait)** (Miro, Adobe, Runway, Freepik refusent le robot) ; trancher les
deux contradictions relevées (crédits Enterprise de Miro [MI7] / [MI13] ;
plafond par membre de Krea [KR2] / [KR3]).

---

## Fait le 30/09 — le socle (étapes 0, 3, 7), rien de fermé encore

Décisions de Cal du 30/09, qui priment sur ce qui précède : à l'écran **« Team »**
et **« Workspace »** ; **le rôle d'un guest se règle dans l'administration d'un
utilisateur : « viewer » (voit seulement) ou « acteur » (peut modifier)** — viewer
ou acteur, il ne consomme **jamais** de calcul (le `cpu` compris : la décision 5
recommandait l'inverse, Cal l'écarte) ; les favoris sont partagés par Team et par
Workspace (étape 2) ; le reste : les recommandations de l'étude.

**Le modèle codé** — `server/core/espaces.py` (neuf), stocké dans
`<data_dir>/teams.json` (relu s'il change ; illisible : jamais écrasé, 503) :
Teams (`tea-…` : `plan`, `api` coupée par défaut, `owner`, membres `owner | admin |
member | guest`, un guest a `guest: viewer | acteur`), Workspaces (`esp-…` :
`default_role` des membres, `admin | editor | commenter | viewer | none`, une
surcharge par membre, la liste des guests), liens d'invitation (empreinte seule),
le dernier Workspace de chacun. Chaque compte a « Chez moi » / « Perso »
(`tea-perso-<id>`, créée à sa première requête), sauf l'invité de planche et un
compte entré comme guest (`perso: false`). L'offre de « Chez moi » est le droit
`access` du compte (une seule vérité) ; celle d'une autre Team, son `plan`.
La matrice du § 2.4 est une table (`MATRIX`, profils × actions) ; le selftest la
compare à une seconde écriture recopiée de ce document.

**L'API interne** (pour les étapes suivantes) : `espaces.can(u, e, action)`,
`judge` (oui, pourquoi pas), `can_view / can_comment / can_edit / can_create /
can_compute(u, e, coût) / can_publish / can_invite / can_manage(u, team)`,
`can_read_doc / can_write_doc / can_trash_doc` et `space_of(doc)` (un document sans
`space` vaut Général, sinon le Perso de son propriétaire) ; dans `auth` :
`current_space() / set_current_space()` (la file les posera le temps du `run`),
`can_compute(u, e, coût)`, `compute_why` (la phrase du 403), `can_view`,
`can_edit`, `can_publish`, `can_invite`, `space_of`, `access_of(u, e)`.
`espaces.garde_prete("calcul")` (étape 1, quand `jobs.submit` juge) et
`garde_prete("bibliotheque")` (étape 2) : **tant que les deux ne sont pas
déclarées, faire un guest répond 409** (un guest pourrait sinon calculer ou tout
voir) ; `"equipes_guests_essai": true` le permet sur une copie d'essai seulement.

**La porte** (`core/auth.py`) : `gate` pose `req.workspace` (et `current_space()`)
sur chaque requête : `X-SR-Espace`, sinon `?e=`, vérifié ; un Workspace qu'on ne
voit pas → **403** sur une route protégée (sauf `/api/auth/…`), sans rien : le
dernier Workspace de la personne, sinon Général, sinon le premier d'une Team où
elle est, sinon son Perso. `/api/auth/me` rend `teams` (ses Teams, leurs
Workspaces, ses droits `can` / `why` dans chacun), `workspace` (le courant) et
`workspace_refused`. Le journal `http` porte `space`. Le droit Studio : la porte
prend le meilleur du compte et de la Team du Workspace (rien ne se ferme d'ici
l'étape 2 ; alors `access_of(u, req.workspace)` seul). `library.py` et `jobs.py`
ne sont pas touchés : `can_read_item` / `can_write_item` jugent comme avant.

**Les routes** (`server/tools/equipes.py`, neuf) : `GET/POST /api/equipes`,
`GET/POST /api/equipes/<t>`, `…/espaces`, `…/membres`, `…/membres/<id>`,
`…/membres/<id>/retirer`, `…/invitations`, `…/invitations/<id>/retirer`,
`POST /api/espaces/courant`, `POST /api/espaces/<e>`, `…/membres/<id>`,
`GET/POST /api/auth/equipe/<jeton>`. Un pseudo neuf mis dans une Team est créé
déjà accepté, en Apps (la Team a le Studio). Un lien : `admin/?rejoindre=<jeton>`,
la porte d'abord, puis la Team (sur l'adresse publique sans code d'invitation, un
pseudo neuf est refusé par la porte : l'ajouter par son pseudo).

**Admin** (`admin/`) : la section **C · Teams** (Cal : toutes ; les « Chez moi »
des autres en bref) — Workspaces (créer, renommer, archiver, rôle par défaut),
membres (rôle, par Workspace, retirer), guests (viewer / acteur, leurs
Workspaces), mettre quelqu'un par pseudo, liens ; chaque Workspace montre ses
droits (voir, commenter, modifier, calculer, publier, inviter) et ce qui manque dit
pourquoi. Dans **Personnes**, la ligne « teams » de chaque carte règle viewer /
acteur (décision 2). Un admin de Team qui n'est pas Cal n'a que cette section
(`admin/#teams`) ; tout compte y voit ses Teams et ses droits.

**La migration** : `espaces.migrate(root, dry)` et `tools/migrer_espaces.py
--donnees <copie> [--a-blanc]` (ou `--vraies-donnees`, **portail arrêté**) ;
sauvegarde `sauvegarde-espaces-<date>/` (teams.json d'avant, les fichiers changés,
le rapport). Essayée sur une copie de `~/showrunner-data` (30/09) : Nirvalab et
Général créés, les 6 amis membres (éditeurs de Général), 7 « Chez moi », 45 objets
(13 sans propriétaire, restés à Cal) + 1 à la corbeille + 2 projets ODIO + 3
planches + 342 LUT + 2 travaux → `space: esp-general` (395 fichiers) ; 1018
fichiers avant, aucun perdu, 624 identiques, 394 changés **seulement** par
`space` ; auth.json intact ; seconde passe : rien à faire.

**Preuves** : `tools/check.py` 1705 passés (1593 avant, 112 neufs), dont la
matrice, guest viewer / acteur, aucun calcul, l'autre Team invisible (403 par
l'en-tête et `?e=`), les liens, la migration sur une copie jetable (deux passes,
rien de perdu). Pilote Playwright sur DGX2 (port 8893) : Cal crée un Workspace, met
un guest viewer, le passe acteur depuis Personnes, crée un lien ; ce que voit le
guest (captures sombre et clair).

**Pour l'étape 4** (`commun/shell.js`) : `api()` pose `X-SR-Espace: <esp>` (le
Workspace de l'onglet, `sessionStorage`, pris de `?e=` à l'ouverture) ; les flux
SSE ajoutent `?e=` ; un 403 dont `/api/auth/me` rend `workspace_refused` → oublier
ce Workspace. **Le Worker** (`porte/worker.js`, `EN_TETES_TRANSMIS`) ne transmet
qu'une liste d'en-têtes : y ajouter `x-sr-espace`, sinon l'adresse publique perd
l'en-tête (`?e=`, dans le chemin signé, passe). Le sélecteur lit
`/api/auth/me` → `teams`, `workspace` ; changer : `POST /api/espaces/courant`
puis recharger la liste de l'outil ; « Réglages de la Team » → `admin/#teams` (le
bouton Admin de l'en-tête n'est montré qu'aux admins du portail).

**Reste** : les étapes 1, 2, 4, 5, 6, 8, 9, 10 ; céder la propriété d'une Team ;
les outils qui réécrivent leurs documents doivent garder `space` comme `owner`
(ODIO `save_project` ne garde que `owner, shared, origin`) — étape 2.

---

## Fait le 05/10 — la phase B (branche `wip2/espaces-phaseb`)

**Ce qui était déjà fait le 30/09 sans être écrit ici** (git : 6c88ed0, 3a623f2, 7f917b8,
b815159, 4110b4e, 96068c6, 24a0987, 62fd4ce) : l'étape 1 (chaque sorte déclare son `cost`,
`jobs.submit` juge, `COMPUTE_ROUTES`), 2 (`space` posé par le socle et les outils, gardé à
chaque réécriture, jugé par rôle ; un outil n'atteint que son Workspace), 4 (le sélecteur
« TEAM / WORKSPACE », à droite collé au nom ; `X-SR-Espace`, `?e=`), 5 (Asset tous
Workspaces ; rapatrier un objet), 6 (`check_doc` par `ID_FIELDS`), 8 (le budget).

**Le 05/10** :
1. **La garde du calcul, la matrice entière** : `check.py garde` essaie chaque sorte pour
   chaque profil — lecteur, commentateur, une autre Team : 403 qui dit pourquoi ; éditeur,
   admin du Workspace : en file, dans ce Workspace, à son coût (une sorte `api` : l'API de
   la Team est coupée).
2. **`space` posé par chaque outil, vérifié en général** : `check.py isolement` — l'inventaire
   (`STORES` : chaque entrée de `<data_dir>`, ce qu'elle est, d'où vient son Workspace ; une
   entrée neuve non déclarée échoue ; chaque document d'un magasin « champ » porte un
   Workspace connu) ; puis un membre d'une autre Team rejoue chaque lecture des selftests
   (les GET 2xx relevés) : aucune réponse ne nomme ce qui n'est pas à lui, une adresse qui
   le nomme répond comme pour ce qui n'existe pas. Trouvé et corrigé : la file montrait la
   recette, le résultat et l'auteur d'un travail d'un autre Workspace ; Movie Analysis
   listait les analyses de tous les Workspaces ; le Montage nommait une séquence dans un 404.
3. **Le passage d'un Workspace à l'autre sans perdre ce qui est ouvert** : `espaceDocument(
   espace, id, {outil})` (`commun/shell.js`) — un document ouvert reste dans le sien, toute
   requête qui le nomme y part (une page rechargée le rouvre où il est), `outil` : tout ce
   que l'outil demande y part. Idéation (changer de Workspace fermait la planche ouverte ;
   son flux de co-édition répondait 403 dès que l'onglet n'était pas dans le dernier
   Workspace de la personne) et Transcrire suivent sans recharger ; ODIO et le Montage
   déclarent l'identifiant de leur document.
4. **Le rapatriement** (étape 9 et § 3.5) : un élément versionné arrive en élément neuf
   dont la v1 est sa version figée (la dernière prête par défaut ; décision 7, a) ; « avec
   sa source » (le Studio, b) : la source est copiée aussi et l'élément vit dessus ; une
   séquence, une playlist arrivent avec ce qu'elles posent (la fermeture d'`ID_FIELDS`
   copiée d'abord, puis le document, écrit par son outil, qui rejuge tout). Depuis Asset (la
   fiche choisit la version, la case « avec sa source ») et le panneau Asset.
5. **Étape 10** : `docs/ARCHITECTURE.md` § 10 (et § 3, § 9 remis à jour).

**Reste** :
- (c), l'historique entier : non, par décision ; « suivre l'origine » (B voit que A a publié
  la v4 et la rapatrie comme sa v2) : plus tard ;
- les pages ne grisent pas encore leurs gestes de calcul pour qui ne calcule pas (le serveur
  refuse en disant pourquoi, la page le montre en toast) : `/api/auth/me` donne `can.compute`
  et `why` par Workspace, de quoi le faire outil par outil ;
- le brouillon d'Image garde ses références après un changement de Workspace ; le rendu les
  refuse (elles sont d'ailleurs) : les rapatrier, ou les vider ;
- un lien vers un document d'un autre Workspace, ouvert dans un onglet neuf : 403 tant que
  l'onglet ne l'a pas ouvert une fois (la page pourrait demander d'abord le Workspace du
  document) ;
- les pastilles « Autres workspaces » du panneau Asset ne montrent que le nom du Workspace
  (la Team au survol) : deux « Général » se confondent ;
- déplacer un document (au lieu de le dupliquer) : non, par décision (§ 3.5) ; une planche
  rapatriée avec sa source n'emporte pas les LoRA de ses moodboards (entraînés dans A).

---

## Fait le 09/10 — Teams v2 : My Team, détruire, le grand ménage (branche `wip3/teams-v2`)

Décisions de Cal du 09/10, qui priment sur ce qui précède : « tous les gens qui se loguent
n'ont que leur espace vierge » ; un compte qui a le Studio crée sa Team et y invite, plusieurs
Workspaces par Team, « les gens dans la même team voient tous les workspaces de la team » ; on
détruit les Teams et les Workspaces ; « on va cleaner tout ce que voient les comptes et faire un
fresh start, tu laisses quand même ce que les gens ont fait dans leur espace » ; « on ne
travaille pas en dehors d'une team, donc par défaut on a une team qui s'appelle My Team ».

**D1 · My Team.** La Team personnelle naît « My Team », son Workspace « Général »
(`espaces.PERSONAL_NAME`, `PERSONAL_SPACE`) ; une d'avant garde son Workspace « Perso ». Son
propriétaire la renomme (Cal aussi ; un admin qu'il y a mis, non) ; `renamed` retient qu'un nom
est choisi. Les « Chez moi » d'avant deviennent « My Team » **par le ménage** (D7,
`rename_personal`), pas au chargement : l'aperçu les nomme (d), le geste est journalisé, Cal le
décide ; un renommage au chargement aurait changé des noms au premier redémarrage de DGX2 sans
trace. Idempotent (une seconde passe ne trouve rien) ; jamais un nom choisi — avant le 09/10 une
Team personnelle ne se renommait pas, donc un « Chez moi » sans `renamed` est le nom de naissance
(un « Chez moi » remis par choix porte `renamed` : épargné). À l'écran (grep de « Chez moi » et
de « Perso » dans les pages) : l'en-tête, Admin (Teams, Personnes : « sans my team »), Asset
(l'arbre et « Autres workspaces » prennent `team_name`), la pastille GPU de l'accueil, Idéation
« Commencer un projet » (les Teams des personnes, `people_for`). Le nom d'une Team pour la
personne : `label` (`label_of`) — la My Team d'un autre dit à qui elle est (« My Team · Noé »).

**Un compte neuf n'a que sa My Team.** `auth._join_instance_team` (un ami accepté, ajouté
d'avance, fait ami ou à qui Cal ouvre le Studio devenait membre de Nirvalab, éditeur de Général :
la règle 2 de la migration, tenue depuis le 30/09) est retiré — sinon chaque ami neuf aurait
refait ce que le ménage défait. Cal met quelqu'un dans Nirvalab comme dans toute Team. Les
selftests qui partaient de là (`droits`, `compte`, `documents`, `elements`, `image_atelier`,
`ideation_collab`, `porte_publique`, `equipes`) le mettent maintenant à la main.

**D2 · My Team invite si son propriétaire a le Studio.** `_may_invite`, `judge`
(`invite_space`) et `_team_public` (`invite`, `invite_why`) : une Team personnelle Apps n'invite
personne, Cal compris (le Studio est au compte) ; à son propriétaire la phrase mène à
« Demander le Studio » (le bouton est sur la carte, `POST /api/auth/studio`) ; une Team
personnelle Studio invite comme une autre (membres, guests, liens). Un compte Studio crée
d'autres Teams (`create_team_why`, vérifié), un compte Apps non. My Team ne se détruit, ne
s'archive ni ne se quitte (son propriétaire : 409). `people_for` compte ses membres.

**D3 · Un membre voit tous les Workspaces de sa Team.** Un Workspace neuf : éditeur par
défaut ; `none` (« sur invitation ») n'est plus accepté — ni rôle par défaut, ni rôle d'un
membre (400 qui dit pourquoi : « pour n'y mettre que certains, fais-en des guests ») ; un `none`
d'avant vaut lecteur (`_profile`, et `default_role` le dit). Un guest reste aux Workspaces où on
le met. Le menu de l'en-tête : les Teams partagées, sa My Team, puis celles des autres (avec le
rôle qu'on y a).

**D4 · Détruire.** `POST /api/espaces/<e>/detruire {nom}` — qui gère sa Team (propriétaire,
admin) ou Cal ; jamais Général (`default` ou `esp-general`), jamais le dernier Workspace ouvert
d'une Team (la phrase dit quoi faire). `POST /api/equipes/<t>/detruire {nom}` — son propriétaire
ou Cal ; jamais une My Team, jamais Nirvalab (ni la Team qui porte le Workspace par défaut).
Le nom tapé confirme (aux espaces près) ; la page (`confirmBox` d'admin.js, `typed`) garde le
bouton grisé tant qu'il ne l'est pas. Journalisé (`workspace détruit`, `team détruite`).
Le modèle, juste par construction : rien n'est réécrit. La fiche du Workspace passe de `spaces`
à `destroyed_spaces` ; tout ce qui porte son identifiant n'a plus de profil (`_profile`), et
`espaces.gone` ferme aussi les juges d'`auth` à Cal et au socle (`can_read_item`,
`can_write_item`, `can_trash_item`), `library.check_create` (rien n'y naît, pas même un travail),
le lien d'une planche (`ideation_collab.role_of`). Puis : les objets de la bibliothèque à la
corbeille (`library.bury`), les travaux en file ou en cours arrêtés, qui l'avait pour dernier
retombe sur sa My Team (un onglet resté dessus reçoit `workspace_refused`), les liens
d'invitation l'oublient (un lien de guest sans Workspace est retiré), sa part de budget s'efface,
les onglets ouverts sur ses planches sont congédiés (`QUAND_DETRUIT`). Une Team : chacun de ses
Workspaces ainsi, ses membres sortis, ses liens retirés, son budget effacé ; sa fiche reste dans
`destroyed_teams`.

L'inventaire, magasin par magasin (`STORES` de `tools/check.py` ; ce que compte
`espaces.content_of`, `CONTENT_DOCS` — un magasin « champ » neuf qui n'y est pas fait échouer
`check.py isolement`) :

| magasin | ce qu'il devient |
|---|---|
| `library` (objets, éléments, séquences, playlists, documents…) | à la corbeille (`trash/`), chacun garde son `space` : Admin → Stockage les compte, la corbeille d'Asset ne les montre à personne ; « Vider la corbeille » les efface pour de bon |
| `trash` (déjà jetés) | restent, à personne |
| `musique`, `ideation`, `transcrire`, `luts`, `image_atelier`, `paroles`, `analyse` (projets.json) | restent en place, à personne (leur `space` ne mène nulle part) ; reviennent avec le Workspace |
| `montage` (`projet/<Workspace>.json`), `chanson` (`spaces.json`), `asset_folders.json` | une table par Workspace, inchangée : revient avec lui |
| `analyses`, `ecoute`, `lora`, `ideation_collab`, `ideation_agent` | suivent leur parent |
| **ne passent pas à la corbeille** : `elements` (le journal des éléments : ses lignes gardent leur Workspace), `jobs.json` (les travaux finis : masqués, `job_out`), `conso.jsonl` et `journal.jsonl` (l'histoire) | des journaux : ils ne se rendent pas, ne se montrent plus à personne |

Rendre (Cal, Admin → Stockage, « Workspaces détruits » ; `GET /api/admin/detruits`,
`POST /api/admin/detruits/<e>/rendre {vers?}`) : le MÊME identifiant revient, dans la My Team de
son auteur principal (le plus d'objets et de documents ; à égalité, qui l'a créé) s'il existe
encore, sinon dans celle de Cal — ou de qui Cal choisit parmi ses auteurs. Ses objets sortent de
la corbeille (ceux qu'elle tient encore : un vidage est dit, « perdus »), ses documents le
retrouvent tels quels ; ses rôles par membre ne reviennent pas (ils étaient d'une autre Team).
Un seul geste rend tout le Workspace : ses documents d'outil se tiennent entre eux (une séquence
et ses plans, une planche et ses images) ; les rendre un à un dans des My Team différentes
casserait ces liens.

**D7 · Le grand ménage** (« fresh start » ; Admin → Teams, une carte en tête, pour Cal — un
admin du portail, comme toute la page Admin). `GET /api/admin/menage` : (a) les comptes créés
par une Team (`via: "equipe"` : ajoutés par pseudo ou entrés par un lien), leur date, qui les a
faits, leurs Teams, ce qu'ils ont chez eux ; (b) les Teams partagées : propriétaire, membres,
Workspaces, objets, octets, documents, si elles se détruisent (sinon pourquoi) ; (c) les
appartenances à retirer (toute personne autre que le propriétaire, sauf un admin du portail :
« épargnés ») ; (d) les Teams personnelles encore « Chez moi ». Coché d'avance : les comptes (a),
les Teams dont tous les membres hors propriétaire sont parmi eux (une Team où le propriétaire est
seul : seulement s'il est lui-même un compte d'atelier), les deux cases. `POST {comptes, teams,
retirer_membres, renommer, confirme: "MENAGE"}` : tout est jugé avant le premier geste (un compte
qui n'est pas d'atelier, Cal, un admin, une Team qui ne se détruit pas : 400, rien n'est fait),
puis les Teams détruites (D4), les comptes supprimés (`admin.supprimer_compte`, le chemin d'Admin
→ Personnes), les membres retirés, les noms ; le rapport (et ce qui a échoué en route), au
journal. Le bouton d'application est l'orange de l'écran, il dit ce qu'il va faire, la fenêtre
le redit et attend MENAGE tapé. Le contenu de la My Team de chacun reste ; celle d'un compte
supprimé est archivée (`forget_user`, inchangé), son contenu reste sur le disque. La page dit
aussi qu'un guest gardé et retiré de tout n'entre plus nulle part (il n'a pas de My Team).

**Preuves** : `tools/check.py` complet (voir le compte rendu de la branche) ; selftests neufs
dans `server/tools/equipes.py` (`_my_team`, `_detruire`, `_menage`, et D3 dans `_http`) ; le
pilote `admin/pilote_teams.mjs` (portail d'essai à la porte allumée, `SR_PORTE=1` de
`tools/portail_essai.py`) : la carte du ménage cochée d'avance, sombre et clair ; détruire
« Rushes » (le bouton grisé tant que le nom n'est pas tapé), Stockage, « Rendre » ; le menu de
l'en-tête d'un compte Apps membre de la My Team d'un autre, sa carte et « Demander le Studio »,
sombre et clair ; la My Team d'un compte Studio qui invite ; le ménage appliqué par la page.

**Reste, pas vérifié** :
- pas de « Détruire » dans le menu de l'en-tête : la confirmation par le nom tapé vit dans
  Admin, à un clic (« Réglages de la Team ») ;
- les vraies données de DGX2 ne sont pas vues d'ici : l'aperçu du ménage les montrera à Cal
  avant tout geste ;
- un compte membre de la My Team d'un autre atterrit dans celle-ci quand il n'a pas de
  « dernier » (`default_for` préfère une Team qui n'est pas la sienne, comme avant pour les
  Teams partagées) ;
- la My Team d'un compte supprimé est archivée : ceux qu'il y avait mis (D2) n'y font plus que
  lire ;
- une Team détruite garde ses lignes dans `conso.jsonl` (l'histoire du budget) ;
- les invités qui attendent la validation de Cal (section suivante) ne sont pas des comptes du
  ménage : ils restent dans Admin → Demandes (la carte le dit), où Cal les valide ou les refuse.

---

## Fait le 09/10 — Cal valide les invités, et il en est alerté (Telegram)

Cal, 09/10 : « si le user invite quelqu'un je voudrais recevoir une alerte pour pouvoir valider
l'invité… on peut faire un truc par l'app Signal ? ou Telegram ? ». Ce qui change le § 4.1 : un
pseudo neuf n'est plus « accepté par le lien » quand le lien (ou le geste) n'est pas de Cal.

### La validation (D5)

- **Qui attend.** Un pseudo NEUF créé par quelqu'un d'autre que Cal (un admin du portail compte
  comme Cal) — par son pseudo (`espaces.add_member` → `auth.create_invited(…, invited=…)`), ou en
  ouvrant le lien d'une Team fait par un non-Cal (`espaces.redeem` → `auth.mark_invited`) — naît
  `state: "pending"` avec `invited: {by, team, role, guest?, spaces?, at}` (et `lien` pour un lien).
- **Sa place ne compte pas, par construction.** Elle est écrite dans `teams.json` comme les autres,
  mais tout `core/espaces.py` ne voit qu'un compte actif (`_profile` le faisait déjà ; `team_role` et
  `teams_of` aussi désormais) : ni profil, ni droit, ni Team dans `/api/auth/me`, ni calcul ; la
  porte du socle le garde dehors comme toute demande (401 sur `/api/…`). Aucun filtre à ajouter outil
  par outil : la matrice ne lui donne rien tant qu'il attend.
- **Ce qu'il voit.** Sa porte (`commun/porte.js`) : « invitation · en attente de Cal », « X t'a
  invité ; ton compte attend la validation de Cal » (`auth.invited_public`, dans `/api/auth/me` et
  dans la réponse de `/api/auth/enter`). « Taper un autre pseudo » ne ferme que ce navigateur : son
  compte n'est pas à lui de défaire (`cancel_request`), c'est à Cal.
- **Ce que voit qui l'invite.** Le toast « « x » attend la validation de Cal » (un à un, `addForm`,
  et la liste collée, `addMany` : « attend Cal » par ligne), la pastille « attend Cal » sur sa ligne
  de membre, et la note du formulaire et du lien qui le disent d'avance.
- **Un compte qui existe et qui est actif** entre directement (Cal l'a déjà accepté une fois) ; Cal
  en est seulement informé. Ce que Cal crée (Admin, `add_member` par Cal, son lien) reste accepté
  d'emblée.
- **Admin → Demandes** montre l'invité à côté des demandes de la porte : « invité par X dans la
  Team Y (rôle) » (`espaces.invitations_of`). **Accepter** (`auth.accept_request`) active le compte,
  donc ses places — sans le Studio du compte (la Team l'a) et sans My Team s'il n'est que guest
  partout, comme l'aurait fait le lien de Cal. **Refuser** (`auth.refuse`) retire d'abord ses places
  (`espaces.drop_memberships` : un pseudo recréé plus tard n'en hérite jamais), puis le compte.
- **Bornes, décidées ici** : un invité qui attend, remis dans une Team (la même ou une autre) : 409,
  « déjà invité, attend la validation de Cal » ; 50 invités d'un même admin en attente au plus
  (`auth.INVITES_MAX`, 429 au-delà : qu'il fasse valider d'abord).

### Pourquoi Telegram plutôt que Signal (D6)

| | Telegram | Signal |
|---|---|---|
| API de bot | officielle, documentée : « Bot API » [TG1] | aucune publiée par Signal ; signal-cli est un client tiers, « primarily intended to be used on servers to notify admins of important events » [SG1] |
| depuis le portail | HTTPS + JSON : `POST https://api.telegram.org/bot<jeton>/<méthode>` [TG2] — `urllib` de la bibliothèque standard suffit | un démon à part (JSON-RPC ou D-Bus) [SG1] |
| ce qu'il faut installer | rien | Java (« at least Java Runtime Environment (JRE) 25 ») et `libsignal-client`, natif, « bundled for x86_64 Linux », Windows et macOS [SG1] — nos DGX sont en aarch64 (GB10) : à fournir soi-même |
| l'identité | un bot créé par @BotFather, un jeton | un numéro de téléphone à lui (s'inscrire « will unregister any existing client » : pas celui de Cal) [SG1] |
| l'entretien | l'API officielle, tenue par Telegram | « signal-cli releases older than three months may not work correctly » [SG1] |
| des boutons dans le message | `inline_keyboard`, `callback_query`, `answerCallbackQuery` [TG1] | non trouvé dans signal-cli |
| recevoir les clics | `getUpdates` en long polling, sans adresse publique ni webhook [TG1] | le démon |

Ce qu'on a lu de l'API [TG1] et qui fonde le code (`server/core/alertes.py`) :
- `getUpdates` : « Timeout in seconds for long polling » ; « An update is considered confirmed as soon
  as getUpdates is called with an offset higher than its update_id » (l'offset tenu sur le disque) ;
  « This method will not work if an outgoing webhook is set up » ; deux lecteurs du même bot : 409
  (« Error 409 means that you are running your bot several times on long polling » [TG2]).
- un bouton : `callback_data`, « 1-64 bytes » — la nôtre fait 12 octets, `v:` ou `r:` et un
  identifiant aléatoire tenu par le serveur, jamais le pseudo ;
- « Telegram clients will display a progress bar until you call answerCallbackQuery. It is,
  therefore, necessary to react by calling answerCallbackQuery » ; son texte : « 0-200 characters » ;
- `sendMessage` : « Text of the message to be sent, 1-4096 characters » (au plus 40 personnes par
  message) ; `editMessageText` remplace le texte et prend `reply_markup` (« An object for an inline
  keyboard »).
- **Non documenté, à vérifier au premier essai réel** : qu'un `editMessageText` sans `reply_markup`
  ôte les boutons (le faux Telegram le fait ; c'est l'usage connu) ; que le lien
  `t.me/<bot>?start=<code>` (« links like t.me/your_bot?start=XXXX that open your bot with a
  parameter » [TG1]) arrive au bot comme « /start <code> » (la page des fonctions des bots,
  core.telegram.org/bots/features, est fermée au conteneur) — taper « /start <code> » à la main
  marche dans les deux cas ; la marche à suivre de @BotFather (`/newbot`, un nom, un identifiant qui
  finit par « bot ») est celle de la même page.

### Les alertes (`server/core/alertes.py`, la carte `server/tools/alertes.py`)

- **Le réglage** : `~/.config/showrunner/telegram.json` (`{"token", "chat_id", "chat_nom", "actif"}`,
  réglage `alertes.fichier`), exigé en 600 — lisible par d'autres, il est refusé et la carte dit
  `chmod 600`, comme la clé de la porte. L'adresse : `https://api.telegram.org`, sinon `alertes.url`,
  sinon `SR_TELEGRAM_URL` (les essais). Le jeton ne sort jamais : la carte dit « posé » ou non, une
  erreur qui le citerait est nettoyée, le contrôle vérifie qu'il n'est dans aucune réponse ni aucun
  fichier des données.
- **Rien ne part d'une requête** : un événement se range dans une file (bornée à 200) ; un fil
  « alertes-envoi » l'envoie (10 s par appel) ; un échec est journalisé « alerte non envoyée : … » et
  noté « dernier envoi » sur la carte. Des invités d'un même admin dans une même Team, arrivés
  ensemble (une liste collée), partent en un message (« Valider (3) »).
- **Les événements** : invité en attente (Valider · Refuser), demande à la porte (Valider ·
  Refuser), demande de Studio (Ouvrir le Studio · Écarter), compte existant mis dans une Team par un
  non-Cal (pour info, sans bouton). Sans emoji.
- **Les boutons** : un fil « alertes-ecoute », `getUpdates` en long polling (50 s), l'offset dans
  `<data_dir>/alertes.json` ; seul le chat réglé est écouté (un autre : ignoré, journalisé) ; la
  donnée d'un bouton nomme une décision aléatoire qui désigne des demandes précises (le compte et sa
  date de création, une demande de Studio et sa date) et s'éteint avec elles : tranchée ailleurs
  (Admin, l'autre message, la personne qui annule), ses messages disent le verdict et perdent leurs
  boutons ; un clic appelle la même fonction qu'Admin (`accept_request`, `refuse`, `set_user`),
  répond (`answerCallbackQuery` : « validé par Cal », « refusé par Cal », « déjà traité ») et
  remplace le message. Un seul fil de chaque, même module rechargé (retrouvés par leur nom) ;
  « Couper » l'arrête (plus rien ne part, pas même une mise à jour) ; un portail tué : rien ne se
  perd de ce qui compte (les décisions et l'offset sont sur le disque ; une mise à jour relue après
  coup trouve sa décision déjà prise : « déjà traité »).
- **« Trouver mon chat »** : un code de six signes, un quart d'heure, à envoyer au bot
  (`/start <code>`, ou le lien t.me) ; le chat qui l'envoie, en privé, devient celui de Cal. Décidé
  ici : pas « le premier chat qui écrit au bot » — le nom d'un bot se trouve, n'importe qui peut lui
  écrire ; le code ne se lit que dans l'Admin de Cal.
- **La carte « Alertes »** (Admin → Demandes, Cal seul) : l'état (posé, le bot, le chat, l'écoute,
  le dernier envoi), la marche à suivre, le champ du jeton (écrit en 600) ou la commande à taper sur
  DGX2 (`ssh -t dgx2 'cd ~/SHOWRUNNER_TOOLS && python3 server/showrunner.py --telegram'`, le jeton
  sans écho), « Trouver mon chat », « Envoyer un essai », « Couper » / « Rallumer » (annulable).
- **Essayer** : `tools/faux_telegram.py` (les méthodes appelées, `getUpdates`, Cal qui écrit, Cal
  qui clique, Telegram lent ou en panne), pris par le selftest de `server/tools/alertes.py` et par
  `tools/portail_essai.py` (`SR_TELEGRAM_URL`, `SR_PORTE=1` pour la porte allumée) ; le pilote
  `admin/pilote_invites.mjs` (sombre et clair). Le contrôle (`tools/check.py`) ne lit jamais le
  réglage de Cal.

### Brancher son bot (Cal, une fois)

1. Telegram, sur le téléphone : ouvrir **@BotFather**, envoyer `/newbot`, un nom (« Showrunner »),
   puis un identifiant qui finit par `bot`. Il répond par un jeton `123456789:AA…`.
2. À la maison, **Admin → Demandes**, carte **Alertes** : coller le jeton, « Poser le jeton » (ou la
   commande ci-dessus sur DGX2). La carte dit le nom du bot et « chat à trouver ».
3. **« Trouver mon chat »** : envoyer à son bot le `/start <code>` affiché (ou toucher « Ouvrir le bot
   dans Telegram »). Le bot répond « C'est noté » ; la carte passe à « branchées ».
4. **« Envoyer un essai »** : « SHOWRUNNER · essai » arrive. Le bot ne doit servir qu'à ce portail
   (un second lecteur : 409, la carte le dit).

### Reste

- Un invité retiré de sa Team par celui qui l'a invité reste dans les Demandes (« puis retiré de la
  Team : refuse-le plutôt ») et son alerte garde ses boutons : `remove_member` n'est pas de ce lot.
- Les parts du budget d'une Team listent aussi ses invités en attente (sans effet : ils ne calculent
  pas).
- Les deux points « non documenté » ci-dessus, au premier essai avec le vrai Telegram.

---

## Sources (lues le 30/09/2026)

- [MI1] https://help.miro.com/hc/en-us/articles/360017571194-Roles-in-Miro (extrait)
- [MI2] https://help.miro.com/hc/en-us/articles/7045408248594-Visitors-guests-and-members (extrait)
- [MI3] https://help.miro.com/hc/en-us/articles/21040490154898-Spaces (extrait)
- [MI4] https://help.miro.com/hc/en-us/articles/4408879000978-Profile-and-teams (extrait)
- [MI5] https://help.miro.com/hc/en-us/articles/360021415119-Collaboration-with-Guests (extrait)
- [MI6] https://help.miro.com/hc/en-us/articles/360014270500-Understanding-Miro-plans-and-pricing (extrait)
- [MI7] https://miro.com/pricing/ (lu)
- [MI8] https://help.miro.com/hc/en-us/articles/360017572194-Board-access-rights (extrait)
- [MI9] https://help.miro.com/hc/en-us/articles/360021580759-Co-owners-of-boards-and-Spaces (extrait)
- [MI10] https://help.miro.com/hc/en-us/articles/13205512707858-Team-invitation-settings (extrait)
- [MI11] https://help.miro.com/hc/en-us/articles/4412315533842-Invitation-settings-on-Enterprise-Plan (extrait)
- [MI12] https://help.miro.com/hc/en-us/articles/19756209116178-Miro-AI-credits (extrait)
- [MI13] https://help.miro.com/hc/en-us/articles/19973211245586-Miro-AI-Credits-for-Enterprise-Plans (extrait)
- [MI14] https://help.miro.com/hc/en-us/articles/28898524631058-Miro-AI-credits-add-on (extrait)
- [MI16] https://help.miro.com/hc/en-us/articles/32486862599442-Miro-AI-admin-controls (extrait)
- [MI17] https://help.miro.com/hc/en-us/articles/27016283682578-Miro-AI-granular-admin-controls (extrait)
- [FG1] https://help.figma.com/hc/en-us/articles/41753150926103-Updates-to-Figma-s-file-management (date d'effet 03/08/2026)
- [FG2] https://help.figma.com/hc/en-us/articles/360039970673-Team-permissions
- [FG3] https://help.figma.com/hc/en-us/articles/33459875669015-How-AI-credits-work (« as of August 25, 2026 »)
- [FG4] https://help.figma.com/hc/en-us/articles/35865276858647-Manage-AI-credits
- [FG5] https://www.figma.com/blog/billing-experience-update-2025/ (extrait)
- [FG6] https://www.figma.com/pricing/
- [FG8] https://help.figma.com/hc/en-us/articles/4420557314967-Members-versus-guests
- [FG9] https://help.figma.com/hc/en-us/articles/4410795216791-Invite-guests-to-organization-resources
- [FG10] https://help.figma.com/hc/en-us/articles/42614902212887-AI-credit-updates-FAQ
- [FG11] https://help.figma.com/hc/en-us/articles/17725942479127-Manage-AI-settings-and-content-training-for-your-team-or-organization
- [NO1] https://www.notion.com/pricing
- [NO2] https://www.notion.com/help/whos-who-in-a-workspace
- [NO3] https://www.notion.com/help/intro-to-teamspaces
- [NO5] https://www.notion.com/help/notion-ai-faqs
- [NO7] https://www.notion.com/help/buy-and-track-notion-credits-for-custom-agents
- [NO8] https://www.notion.com/help/manage-ai-models-and-member-credit-spend
- [NO9] https://www.notion.com/help/custom-agents-sharing-and-permissions
- [IO1] https://help.frame.io/en/articles/9875389-user-roles-and-permissions (mis à jour le 16/06/2026)
- [IO2b] https://next.developer.frame.io/platform/docs/guides/managing-user-permissions
- [IO3] https://help.frame.io/en/articles/9105219-adding-and-removing-users-to-a-workspace (mis à jour le 16/06/2026)
- [IO4] https://frame.io/pricing
- [IO6] https://help.frame.io/en/articles/9105232-shares-in-frame-io
- [AD1] https://helpx.adobe.com/business/enterprise/manage-users/admin-roles.html (extrait)
- [AD2] https://helpx.adobe.com/business/enterprise/users/manage-admins/manage-administrative-roles.html (extrait)
- [AD3] https://helpx.adobe.com/in/business/enterprise/global-admin-console/manage-your-organization/manage-administrators.html (extrait)
- [AD4] https://www.adobe.com/products/firefly/plans.html (lu)
- [AD6] https://helpx.adobe.com/creative-cloud/apps/generative-ai/generative-credits-faq.html (extrait)
- [AD7] https://www.adobe.com/ai/overview/generative-credits.html (lu)
- [AD8] https://helpx.adobe.com/creative-cloud/apps/generative-ai/non-adobe-models-in-adobe-products.html (extrait)
- [AD9] https://helpx.adobe.com/business/enterprise/products-entitlements/manage-entitlements/generative-credit-pool.html (extrait)
- [AD10] https://community.adobe.com/announcements-623/what-s-new-shared-credits-formerly-generative-credit-pool-and-request-access-for-firefly-powered-features-1553589 (13/03/2026)
- [AD12] https://helpx.adobe.com/enterprise/kb/adobe-firefly-for-k12.html (extrait, page éducation)
- [RW1] https://runway.com/team-plan (lu)
- [RW2] https://help.runwayml.com/hc/en-us/articles/10312703076371-Workspace-members-roles (extrait)
- [RW3] https://help.runwayml.com/hc/en-us/articles/43198398846611-Managing-Workspace-Members (extrait)
- [RW4] https://help.runwayml.com/hc/en-us/articles/32117491177619-Enterprise-Credits (extrait)
- [RW5] https://help.runwayml.com/hc/en-us/articles/40261817303699-Organization-spaces-for-Enterprise (extrait)
- [KR1] https://www.krea.ai/docs/user-guide/features/teams (lu)
- [KR2] https://www.krea.ai/pricing (extrait)
- [KR3] https://www.krea.ai/enterprise (lu)
- [HF1] https://higgsfield.ai/creator-hub/help-center/business/team-and-business-higgsfield (publiée le 02/08/2026, modifiée le 14/09/2026)
- [FP1] https://www.freepik.com/ai/docs/business-plan (extrait)
- [FP2] https://www.magnific.com/ai/docs/using-the-business-plan (extrait)
- [LE1] https://leonardo.ai/team-plans (extrait)
- [LE2] https://intercom.help/leonardo-ai/en/articles/9044700-tokens-frequently-asked-questions (extrait)
- [SL1] https://slack.com/help/articles/202518103-Understand-guest-roles-in-Slack
- [LI1] https://linear.app/docs/members-roles
- [LI2] https://linear.app/docs/teams

Ajoutées le 09/10/2026 (D6, les alertes) — core.telegram.org est fermé au conteneur ; l'API y est
relue par deux paquets qui en recopient les descriptions et l'appellent :
- [TG1] la Bot API, https://core.telegram.org/bots/api — relue dans `@grammyjs/types` 5.0.0 (registre
  npm) : `methods.d.ts` (getUpdates, sendMessage, answerCallbackQuery, editMessageText), `markup.d.ts`
  (InlineKeyboardButton, CallbackQuery)
- [TG2] `grammy` 1.46.0 (registre npm) : `out/core/client.js` (l'adresse `${root}/bot${token}/${method}`,
  `apiRoot` par défaut `https://api.telegram.org`), `out/core/error.js` (le 409)
- [SG1] signal-cli, https://github.com/AsamK/signal-cli — son README (lu le 09/10 sur
  raw.githubusercontent.com) ; aucune page de Signal ne documente d'API de bot (non trouvée)
