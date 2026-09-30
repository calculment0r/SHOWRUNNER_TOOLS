# Apps et Studio, les éléments liés — étude du 29/09/2026

**Statut** : étude du 29/09 ; **le socle est codé le 30/09** (étapes 1 et 6
en partie, accroches de 3, 4 et 5 : voir « Fait le 30/09 » juste après § 0).
Les six questions du § 5 sont tranchées par Cal le 30/09 (« on avance ») :
ses recommandations s'appliquent (§ 5). Le code du
portail est lu tel qu'il est le 29/09 au soir (les numéros de ligne bougent :
des agents travaillent dans `musique/` et `ideation/`) ; la documentation des
logiciels cités est lue le 29/09/2026. Chaque affirmation technique porte sa
source (`fichier:ligne`, URL) ; **« non documenté »** quand elle manque ;
**« notre choix »** marque ce qui est proposé ici et n'est écrit nulle part.

La demande de Cal (29/09), ses mots :

> « on va séparer les apps de la partie studio. les apps c'est faire et éditer
> des images, faire ou éditer une vidéo. (upscale est une fonction qu'on
> conserve côté app.) on a aussi en app : faire de la musique (simple avec
> prompt, fonctions de base de YuE (ou YuE2), avec quand même la possibilité de
> pouvoir mettre une réf son pour faire une cover ou s'en inspirer). on a aussi
> la création d'asset 3D simple, pas des persos. on peut faire des persos mais
> comme mesh statique simple. et de l'autre côté, on a une solution évoluée
> qu'on appelle « studio » où on aura tous nos outils avec les fonctions qui
> permettent de passer de l'un à l'autre... et d'avoir des éléments beaucoup
> plus élaborés : par exemple si je crée une chanson dans ODIO, elle devient un
> « élément » et si je la mets dans la timeline du montage vidéo, si je la
> modifie dans ODIO, elle se modifiera aussi dans le montage vidéo […] tout ce
> qui est promu « élément » est dispo comme proxy de média partout où on peut en
> avoir besoin et cela est donc non destructif […] s'il est appelé à un endroit
> comme élément, il est alors calculé pour pouvoir être utilisé comme asset
> « écrasé », mais quelqu'un peut continuer à bosser sur la musique et la faire
> évoluer. et dans le banc de montage vidéo, on va avoir un symbole comme quoi
> une nouvelle version est disponible car côté musique on aura validé
> l'élément, donc on peut le mettre à jour, mais on conserve l'historique des
> éléments aussi. »

---

## 0. Le modèle en dix lignes

1. **Une source** est un document vivant d'un outil : projet ODIO, séquence du
   Montage, carte ou cadre d'Idéation, région générative, personnage de
   Character Factory, recette d'une image ou d'un son d'app. Elle se joue **en
   direct** dans son outil, jamais ailleurs.
2. **Un élément** est un objet de la bibliothèque (`kind: element`, la sorte
   qui existe) qui dit trois choses : sa source, la liste de ses versions, la
   dernière.
3. **Une version** est un **objet ordinaire et immuable** de la bibliothèque —
   un son, une vidéo, une image, une planche de références — marqué
   `version: {of, n}`, avec la copie de la source qui l'a donné, qui, quand, la
   note. C'est le rendu « écrasé » de Cal.
4. **Un usage** est n'importe quel endroit qui pose l'identifiant d'une
   version (un plan de séquence, un clip d'ODIO, un nœud d'Idéation) : il est
   **épinglé par construction**, parce qu'il pointe un fichier qui ne change
   jamais. Aucun format de document ne change pour cela.
5. **Publier** = calculer la source et ranger le résultat comme version n+1 ;
   le calcul part dans la file (ffmpeg, la page ODIO, un travail de modèle)
   comme tout rendu ; une version n'existe qu'une fois son fichier écrit.
6. **La source sait qu'elle a changé** : son empreinte n'est plus celle de la
   dernière version → « modifiée depuis la v3 ».
7. **Chaque usage sait qu'une version plus récente existe** : l'objet qu'il
   pointe dit de quel élément il est la version n ; l'élément dit sa dernière →
   pastille « v4 », *Mettre à jour* ou ne rien faire (garder). « Elle se
   modifiera aussi dans le montage » : dès que la chanson est validée (publiée)
   dans ODIO, le Montage le sait, et un clic la met à jour.
8. **Qui prévient qui** : un journal numéroté des éléments ; chaque page le lit
   par le relevé de la file qu'elle fait déjà (toutes les 1,5 à 6 s), ou par un
   flux SSE comme celui d'Idéation.
9. **Un élément peut en contenir d'autres** (une séquence qui pose une
   chanson) ; poser un élément dans sa propre descendance est refusé en nommant
   la chaîne ; **rien d'utilisé ne se supprime en silence**.
10. **Apps et Studio partagent la même bibliothèque** : une création d'app est
   un objet ; en Studio, « Faire un élément » en fait la v1 d'un élément sans
   rien recopier. La porte distingue les deux par un droit `access` posé à côté
   du rôle, jamais par une autre base.

---

## Fait le 30/09 — le socle des éléments versionnés

Livré sur une copie d'essai de DGX2 (`/tmp/sr_elements`, clone de
`origin/main` f3d2a32 + les fichiers du PC ; portail d'essai :8873, données
jetables). Rien n'est poussé ; le portail en ligne n'est pas touché.

### Le modèle, tel qu'il est codé

| quoi | où | ce qui est rangé |
|---|---|---|
| **élément** | `item.json` d'un `ele-…`, `kind: element` | `element: {type, media, description, refs: [], source: {tool, doc \| slug, open}, versions: [...]}` ; `type` : les planches (`character object place style other`) **ou** `music sound sequence picture` (`library.VERSIONED_TYPES`, à part de `ELEMENT_TYPES` que lit Idéation) ; `media` : `audio image video midi refs`, posé par la v1 |
| **version** (entrée de la pile) | `element.versions[]`, dans l'ordre | `{n, item, at, by, note, fp, rev, src, deps, state}` ; seuls `state` (`ready` / `withdrawn`) et `note` se réécrivent |
| **la dernière** | calculée, **jamais rangée** (`library.head_entry`) | la plus haute prête **et présente** (pas à la corbeille) : elle ne peut pas mentir quand une version part à la corbeille ou en revient ; `library.public` la rend (`element.head`, `head_item`, `count`, `head_kind`, `head_duration`), avec la vignette et les copies d'affichage de la dernière |
| **objet version** | l'objet ordinaire (son, image, vidéo, MIDI, planche) | `version: {of, n}` dans son `item.json` ; à côté de son fichier, `source.json` = la source telle qu'elle a été rendue (le projet ODIO, la timeline ; pour un objet d'app, sa recette `{prompt, params}`) ; `public()` ajoute `of_title`, `of_present`, `head`, `head_item`, `state` : **toute page sait « la v4 existe » sans requête de plus** |
| **usage** | les documents eux-mêmes | `clips[].item` des séquences, `clips[].item` des projets ODIO (pas les prises `gen.takes`), `nodes[].item` des planches d'Idéation ; relus seulement quand leur fichier change (cache par date et taille, `elements._summaries`) ; aucun document ne change de forme |
| **empreinte** | `fp` de chaque version, `sha256:` du JSON canonique | ODIO : tout le projet sauf `id name rev created updated owner shared origin ui pending gen presets markers loop` ; séquence : `settings tracks groups clips range` ; recette : `prompt params`. **Canonique** : 1.0 = 1, champ vide = champ absent (relevé à l'essai : ODIO ouvert puis enregistré sans geste disait « modifié », la page écrivant `1` pour `1.0` et `banc: {segs: [], atts: []}` pour `null`) |
| **journal** | `<data_dir>/elements/journal.jsonl` | une ligne par événement, numéro `seq` croissant : `el.created`, `el.published`, `el.withdrawn`, `el.ready` |
| **uid** | déduit (`library.uid_of`) | `sr:<uuid de l'instance>/<id>` (`package_export.md` § 2.1) ; `<data_dir>/instance.json` tiré une fois (`uuid4`) ; un objet reçu d'ailleurs garderait le sien dans `item.json` ; `public()` le rend sur **chaque** objet |

### Les routes (`server/tools/elements.py`)

| route | ce qu'elle fait |
|---|---|
| `POST /api/elements {title?, type?, source: {tool, doc}, from_item?, note?, folder?}` | faire un élément. `source` seule : sans version (« pas encore publié ») ; `from_item` : l'objet en devient la v1, **rien n'est recopié** (le dossier de l'élément ne contient que `item.json`) ; sans `source` ni `from_item` : la planche d'avant (`core_api.el_create`, inchangée — la route neuve passe devant et lui rend la main). Une source n'a qu'un élément (409) |
| `GET /api/elements?source=&tool=` | les éléments visibles (d'une source), avec `source_state` |
| `GET /api/elements/<id>` | l'élément, la pile (la plus récente devant ; chaque entrée : l'objet, qui, quand, note, présente, à la corbeille, ses usages), `source_state` (`à jour`, `modifiée` + `since`, `perdue`, `sans version`, `non suivie`), les usages, ce qu'il contient |
| `POST /api/elements/<id>/versions {item, rev?, note?}` | publier : l'objet (déjà rendu) devient la v n+1 ; même sorte que les versions d'avant ; pas déjà une version ; `rev` vérifiée contre la source (409 « la source a changé pendant le rendu ») ; `deps` = les versions d'autres éléments que la source pose |
| `POST /api/elements/<id>/versions/<n> {state?, note?}` | retirer (`withdrawn`), remettre (`ready`), annoter |
| `POST /api/elements/status {items}` | pour une page : de quel élément chaque objet est la version, la dernière, sa note, sa durée, les versions prêtes ; et le `seq` du journal |
| `GET /api/elements/uses?doc=` | les usages d'un document, avec `update` (une plus récente existe) |
| `POST /api/elements/check-use {el \| item, doc}` | `{ok}` ou `{ok: false, why, chain}` |
| `GET /api/elements/changes?since=` | le journal après `seq` (les éléments visibles) |

### Juste par construction

- **Une version ne change plus** : `library._frozen` refuse (403, en le
  disant) recette, planche, références, voix d'un objet marqué `version` —
  `library.update`, `library.add_ref`, `asset.set_refs` ; titre, dossier,
  tags, favori restent libres.
- **Rien d'utilisé ne se supprime en silence** : `library.trash` demande à
  ses gardes (`library.TRASH_GUARDS`, une ligne) ; celui des éléments refuse
  (409) une version posée dans un document, **en nommant** où (« séquence
  « Pub 30 s » (A1 · Pluie) »). Toutes les corbeilles passent par là (fiche,
  lot d'Asset, `core_api`). Une version libre part ; la dernière redevient la
  précédente ; rendue, elle redevient la dernière. Un élément à la corbeille :
  ses versions restent des objets (ses usages ne cassent pas) et reparaissent
  seules dans Asset, marquées « v2 » (notre choix, plus simple que « à la
  corbeille avec lui » du § 2.9).
- **La boucle refusée, la chaîne nommée** : `check_use` (la page, avant de
  poser) et `check_doc`, appelé par l'enregistrement d'une séquence
  (`montage.r_save`) et d'un projet ODIO (`music.save_project`) — une ligne
  marquée `# éléments :` dans chacun. Publier refuse aussi une source qui pose
  une version de son propre élément.
- **Publier** = le propriétaire de l'élément ou Cal (`library.check_write`),
  et écrire l'objet qu'on marque. Un élément neuf dont la v1 échoue
  disparaît : rien ne reste à moitié.
- **Personnage de Character Factory** (question 1) : « Mettre à jour depuis
  le studio » sur un élément versionné, ou sur une planche qui en est une
  version, range une **planche neuve comme version suivante**
  (`asset._cf_new_version`) ; une planche qui n'est pas encore un élément garde
  la mise à jour sur place d'avant (« Faire un élément (v1) » l'y fait entrer).

### Ce qui est branché

- **Asset** (`asset/asset.js`, `asset.css`, `server/tools/asset.py`) : la
  racine range les versions sous leur élément (`library.query(versions=False)`) ;
  la carte d'un élément dit sa sorte en français sur la pastille commune
  (`kindMark` : « musique »), sa dernière (« v3 », « /3 » versions), l'état de
  sa source (filet ambre si « modifiée »), la pile en filets derrière la
  vignette ; sa fiche : la dernière (lecteur), **la pile** (vN, note, qui,
  quand, durée, « la dernière », « retirée », « à la corbeille », ses usages,
  Fiche, Retirer / Remettre), la source et son état, les usages, ce qu'il
  contient ; « Publier la vN+1… » (le seul orange) choisit un objet de la
  bonne sorte et une note. Sur un objet ordinaire (image, vidéo, son, MIDI,
  planche) : **« Faire un élément (v1) »** et **« Publier comme version de… »**
  (fiche et clic droit) ; sur une version : le bandeau « v2 de « … » · la v3
  existe ». L'ancien « Faire un élément » d'une image (une planche de
  références, qui copie l'image) s'appelle désormais « Faire une planche de
  références ». Annuler : faire un élément ↔ le mettre à la corbeille ;
  publier ↔ retirer la version.
- **Montage** (`montage/elements.js` neuf ; accroches marquées dans
  `montage.js`, `timeline.js`, `montage.css`) : un plan qui pose une version
  porte sa pastille (« ◆ v1 », filet orange « v1 → v2 » quand une plus récente
  existe) ; clic : « Mettre à jour vers la v2 » (note de la version),
  « Tout mettre à jour », Versions ▸, Ouvrir la source, l'élément dans Asset ;
  aussi au clic droit du plan. Mettre à jour = un `commit` (ctrl+Z le défait),
  enregistré par la route habituelle ; le plan garde début et entrée, sa
  durée suit la nouvelle version si elle est plus courte (le dit). Glisser un
  élément pose sa dernière version ; poser un élément de sa propre descendance
  est refusé avant de poser. Le journal est relu toutes les 5 s
  (`/api/elements/changes`) : une publication ailleurs fait paraître la
  pastille et un bandeau, sans recharger.
- **ODIO** (`musique/element.js` neuf ; accroches marquées dans
  `musique/musique.js`) : « Publier » dans la barre (et « Publier comme
  élément… » au menu) : enregistre, rend le morceau entier hors temps réel
  (`renderMix`, le graphe de la lecture), le dépose, fait l'élément du projet
  au premier geste, range la v n+1 avec la `rev` rendue ; la fenêtre dit
  « v2 · à jour » ou « modifié depuis la v2 ».

### Preuves

- `python3 tools/check.py` sur la copie : **tout passe** (1469 contrôles,
  0 échec), dont les
  contrôles neufs de `elements.selftest` : faire un élément d'un projet ODIO
  sans version, une source = un élément, publier v1 (la source copiée à côté),
  « modifiée depuis la v1 », la vue n'entre pas dans l'empreinte, une rev
  périmée refusée, un usage trouvé dans une séquence, **la v2 publiée et
  l'usage resté sur la v1 qui voit « v2 »**, mettre à jour puis annuler
  (enregistrements de la séquence), **une version utilisée refusée à la
  corbeille** (fiche et lot) en nommant la séquence, une version libre qui
  part et revient, une version figée, pas deux fois une version, la bonne
  sorte, retirer / remettre, faire un élément d'une image (v1 sans copie,
  `ref_paths` lit la dernière, Asset l'empile), l'`uid`, **les boucles**
  (séquence → chanson → projet de la chanson : refusé, chaîne nommée ; une
  séquence dans elle-même : refusé, à la page et à l'enregistrement), le
  journal, **les droits** (porte allumée : Albane fait son élément, Bastien
  ne publie ni ne retire sur le sien, Albane publie sa v2, Cal publie
  partout).
- Pilote Playwright sur :8873 (`/tmp/sr_elements_pilote.mjs`) : **21 sur
  21**. Asset : la carte « v1 · musique », la version empilée, faire un élément
  d'une image, publier la v2 par la fiche (sélecteur, note), la pile v2 · v1,
  la corbeille refusée, les usages ; Montage : la pastille v1, la v2 publiée
  ailleurs → « v1 → v2 » sans recharger, le plan resté sur la v1, mettre à jour
  (le plan passe de 8 s à 6 s), l'enregistrement, ctrl+Z (v1, durée
  d'avant), glisser l'élément pose sa dernière ; ODIO : ouvert sans geste,
  « v2 · à jour » ; Publier rend le morceau dans la page et range la v3, la
  source « à jour ».
- Captures sombre et clair : `01_asset_racine` … `10_odio_publie`
  (`*_sombre.png`, `*_clair.png`, dossier de captures du chantier).

### Ce qui reste (l'étude, § 4)

- **Étape 2, les adaptateurs de rendu** : `element.publish` (séquence →
  `montage.run_export` → MP4 ; cadre d'Idéation → `ideation.run_export` ;
  personnage CF en travail) ; sans eux, **« la première pose calcule »
  (question 2) n'est pas branchée** : poser un élément sans version le dit
  (« publie la v1 depuis sa source »).
- **Étape 3, le signal commun** : `ev_seq` dans `GET /api/jobs`
  (`core_api.jobs_list`, pas à ce chantier) — le Montage relit en attendant
  `/api/elements/changes` toutes les 5 s ; le flux SSE ; un `commun/elements.js`
  (la pastille, pour Idéation et les autres) ; `commun/shell.js` : les noms
  français des sortes neuves dans `ETYPE_FR` (ailleurs qu'Asset, la pastille
  dit « music »), `dropZone` et `pick` qui rendent la dernière version d'un
  élément déposé.
- **Les lecteurs de références** (`image.py`, `movie.py`, `ideation.py`,
  `objet.py`) lisent `element.refs` directement : un élément versionné de
  planches (un personnage CF promu) n'en a pas lui-même — ils doivent passer
  par `library.resolve(it)` (la dernière version) avant qu'un tel élément leur
  soit proposé. `library.ref_paths` le fait déjà ; la fiche publique montre
  les références de la dernière.
- Le chutier du Montage (`projet.js`) ne liste pas encore les éléments ; le
  Montage ne se pose pas encore comme source (une séquence en élément : son
  MP4, étape 2) ; la piste générative (étape 8).
- Idéation (étape 7 : pastille sur les nœuds, Faire un élément sur un
  résultat) ; `move` et `restore-source` (§ 2.10) ; la porte Apps / Studio
  (question 5, étape 9) ; l'app Musique et « S'en inspirer » par ACE-Step
  (question 6, étape 10).
- `docs/ARCHITECTURE.md` § 2 et § 7 : y reporter ces routes et `version`
  (fichier d'un autre chantier ce soir).

---

## 1. L'état de l'art

Documentation officielle lue le 29/09/2026 (les codes entre crochets
renvoient à la liste en fin de section). Six questions pour chacun : **lier**
sans exporter, **calculer** à la demande, **publier** une version,
**prévenir** qu'une nouvelle existe, garder l'**historique**, **épingler**
une version.

### 1.1 Montage, compositing, son

| | lier sans exporter | calculer à la demande | publier / figer | prévenir | historique | épingler |
|---|---|---|---|---|---|---|
| **Premiere ↔ After Effects, Dynamic Link** | « Replace With After Effects Composition » : la compo remplace les clips, sans fichier intermédiaire ; une compo peut être liée plusieurs fois ; exige la même version majeure des deux logiciels [A1][A2][A7] | une retouche dans AE se voit dans Premiere sans rendu, par les caches d'AE [A1][A6][A7] ; les rendus de prévisualisation d'avant ne servent plus [A3] ; lecture plus lente [A2] | non documenté pour la compo (on enregistre le projet AE) [A1] | « Offline » si le projet AE est déplacé ou supprimé ; « Link Media » pour relier [A5] ; aucun signal « nouvelle version » documenté | non documenté (l'enregistrement automatique du projet Premiere : 20 versions [A13]) | non documenté ; on peut seulement mettre hors ligne ou suspendre le clip [A4][A2] |
| **Premiere, Render and Replace** | — (remplace le lien par un fichier) | à la demande, par clip ; impossible sur une séquence imbriquée [A8] | le fichier rendu remplace le clip [A8] | aucune alerte si la compo change ensuite : non documenté | non documenté | **oui de fait** : le rendu joue jusqu'à « Restore Unrendered », qui reprend les changements faits entre-temps [A8][A9] |
| **Premiere → Audition** | la séquence part avec sa vidéo liée ; l'audio est extrait dans un projet à part [A11] | un clip : un WAV neuf rendu à chaque envoi [A12] | enregistrer dans Audition le reporte dans la timeline [A12] | non documenté | chaque envoi remplace le précédent [A12] | non documenté |
| **After Effects, précompositions** | « Pre-compose » : des calques deviennent une compo, source d'un seul calque ; une compo se pose ailleurs comme un métrage, sans limite ; un changement vaut pour toutes les compos qui l'emploient [E1] | une compo imbriquée est rendue avant la compo qui la contient [E1] | « Pre-render » : un film rendu remplace les usages de la compo, qui reste modifiable (ou sert de proxy) [E1] | rien à prévenir en direct ; un métrage modifié ailleurs n'est relu qu'à la réouverture ou par « Reload Footage » ; manquant : en italique [E3] | « Increment and Save » : une copie numérotée du projet [E2] | **oui de fait** par le pré-rendu : les usages lisent le film tant qu'on ne relance pas [E1] |
| **Premiere, séquences imbriquées** | glisser une séquence dans une autre ; « Nest » ; un changement de la source se voit dans toutes ses instances [N1][N2][N3] | traitement plus long [N1] ; pas de Render and Replace [A8] | non documenté | non documenté ; si la source raccourcit, l'instance garde sa durée et montre du noir ou du silence [N1] | non documenté | non documenté |
| **Resolve, clips composés / timelines imbriquées** | un seul clip dans la timeline, une copie dans le Media Pool ; éditer l'original agit sur ses instances, durée inchangée [R ch. 50 p. 1077-1085] | mis en cache par le Render Cache [R ch. 8 p. 205] | non documenté | non documenté (un badge dit seulement « imbriqué ») | non documenté | « Decompose in Place » coupe le lien [R p. 1080, 1083] |
| **Resolve, compositions Fusion référencées** | une compo du Media Pool liée à des clips de n'importe quelle timeline ; toute retouche vaut pour tous ; « Usage » liste les clips liés [R ch. 64 p. 1374-1379] | cache de sortie Fusion, par clip ou automatique [R ch. 8 p. 206-210] | dupliquer la compo « pour itérer » [R p. 1376] | l'entrée se rafraîchit seule quand on édite la piste source ; alerte de version : non documenté [R p. 1379] | non documenté | « Unlink Reference Composition » détache un clip [R p. 1379] |
| **Resolve, VFX Connect** (↔ Fusion Studio) | un clip lié à un projet Fusion externe [R ch. 61 p. 1310-1316] | le rendu se fait dans Fusion, puis le clip se met à jour [R p. 1313] | « Create New Version » : `_v1` → `_v2`, compo et rendu [R p. 1314] | Resolve trouve seul les versions du dossier ; « Refresh » parfois nécessaire [R p. 1314-1316] | chaque version est gardée [R p. 1314] | **« Select Version »** : le clip dit quelle version il lit [R p. 1315] |
| **Resolve, Render Cache / Render in Place** | — | cache Smart / User ; **un clip modifié perd son cache** et se recalcule ; l'export peut lire le cache [R ch. 8 p. 205-212] | « Render in Place » : un média neuf remplace le clip, rangé dans le Media Pool [R ch. 54 p. 1187-1188] | barres rouges (à calculer) et bleues (en cache) sur la règle [R p. 208] | non documenté | « Decompose to Original » rend le clip et ses effets éditables [R p. 1188] |
| **Resolve, versions de grade locales / distantes** | une version distante vaut pour tous les clips d'une même source, dans toutes les timelines [R ch. 142 p. 3411-3417] | cache par version [R ch. 8 p. 210] | ajouter une version de grade [R p. 3411] ; aussi sur les groupes en 21 [R21NF] | badge « linked » [R p. 3416] | plusieurs versions par clip, une appliquée [R p. 3411] | **le choix de version d'un clip lié ne se propage pas** [R p. 3416] ; « Use Local Grades » découple [R p. 3417] |
| **Resolve, sauvegardes de timeline** | — | — | « Create Timeline Backup », ou dupliquer [R ch. 41 p. 866-868] | comparer à une sauvegarde : différences surlignées [R p. 868 ; R21NF p. 76] | sauvegardes automatiques espacées (horaires, quotidiennes), seulement s'il y a eu des changements [R ch. 3-4] | **restaurer n'écrase rien** : la sauvegarde revient comme une timeline de plus [R p. 866-868] |
| **Ableton Live 12, Freeze** | — | la piste gelée joue des fichiers rendus au lieu du calcul en temps réel ; « Unfreeze » pour la modifier [L2] | Flatten (Live 11) remplaçait clips et instruments par leur rendu [L5] ; **en Live 12.2, « Bounce Track in Place » le remplace** [L1] | non documenté | non documenté | non documenté |
| **Ableton, Bounce / Consolidate / Sets** | fusionner des Sets copie, ne lie pas [L4] | Bounce à la demande [L1] ; Consolidate : un échantillon par piste [L3] | « Bounce to New Track » garde la source, muette ; les rendus rangés à part, nommés « (Bounce) » [L1][L6] | non documenté | l'historique d'annulation n'est pas enregistré avec le Set [L4] ; un dossier de sauvegardes des dernières versions [L7] | plusieurs versions d'un Set côte à côte dans le projet [L4] |
| **Nuke, Precomp** | comme un groupe, mais le contenu vit dans un script `.nk` à part, édité et versionné par d'autres ; « Reload » le relit [F1][F4] | rendu sur une plage, puis « read file for output » : le nœud lit le rendu au lieu de calculer l'arbre ; « read input » recalcule [F3][F4] | rendu vers un chemin versionné (`_v01`) [F2] | **en EXR, l'empreinte de l'arbre est écrite dans le fichier** : si le script change, Nuke peut le dire ; sinon, rien [F2] | versions par le nommage, « Save New Version » [F4] | le chemin vise une version précise ; Alt+↑ passe à la suivante [F4] |
| **Nuke, LiveGroup** | plusieurs artistes, un plan, des scripts séparés, sans rendu ; « LiveInput » référence un LiveGroup d'un autre script [F5][F6][F9] | comme Precomp [F9] | **« Publish »** : état publié, verrouillé, écrit sur disque ; « Make Editable » pour y revenir [F7][F9] | cinq états visibles ; avertit si le script local diffère du script enregistré, ou si la version demandée n'existe pas [F6][F7][F8] | les versions publiées sont des scripts, qu'on échange sans écraser [F7] | changer de version au clavier ; des surcharges locales, annulables [F7][F8] |
| **Nuke Studio, comps et versions** | une comp `.nk` posée au-dessus du plan dans la timeline [F10][F11] | un serveur d'images, en arrière-plan [F10] | « Save New Comp Version », puis « Version Up » dans la timeline [F10] | couleur de la comp (non rendue, hors ligne, rendue) ; « Scan For Versions » [F13][F14] | versions rattachées aux clips, instantanés datés et commentés d'une séquence [F12][F13][F16] | **« Version Linking »** : un plan non lié garde sa version quand la source monte ; « Set Active Version » [F13][F15] |

Deux relevés de méthode : `helpx.adobe.com` refuse les robots (403) — les pages
ont été lues depuis DGX2 avec des en-têtes de navigateur ; le manuel de
Resolve 21 est un PDF de 187 Mo (4 445 pages), lu en flux sur DGX2 sans rien
écrire sur le disque.

### 1.2 Bibliothèques, pipelines, revue

| | lier sans exporter | calculer à la demande | publier | prévenir | historique | épingler |
|---|---|---|---|---|---|---|
| **Figma** | un fichier pose des **instances** des composants d'une bibliothèque, pas des copies [FG1] ; « Detach instance » coupe le lien, sans retour [FG5] ; « Swap » remplace par un autre composant [FG6] | non documenté | « Publish » avec une **description** de publication, qui s'affiche à la revue et entre dans l'historique [FG2] | un **badge** sur l'icône des bibliothèques ; « Review library updates » : avant / après, côte à côte ou superposés ; une icône sur l'instance concernée [FG3] | un point toutes les 30 min, des versions nommées ; restaurer ajoute des points, n'efface rien [FG4] ; l'usage d'une bibliothèque se mesure (insertions, détachements) [FG7] | **rien d'automatique** d'un fichier à l'autre : on reste sur l'ancienne tant qu'on ne clique pas « Update » / « Update all » ; ignorer = ne pas accepter, il n'y a pas de bouton « refuser » [FG1][FG3] ; on ne pousse pas un changement chez les autres sans publier [FG8] |
| **OpenUSD** | **references** (un asset dans un autre, par son chemin résolu), **sublayers** (des couches empilées) ; « Flatten » cuit tout en une couche [U1] | **payloads** : des références différées, chargées ou non à l'ouverture (`Load`, `Unload`) [U1][U2] | rien dans le cœur : publier et versionner sont l'affaire du pipeline ; le champ `version` d'AssetInfo n'est qu'indicatif [U1] | les éditions faites par l'API notifient les clients ; un fichier changé sur disque **ne se voit pas** tant qu'on n'appelle pas `UsdStage::Reload()` [U1][U2][U3] | non documenté (renvoyé au contrôle de version) | par le **chemin** et le résolveur (un contexte par scène) [U4] ; variantes = une référence qu'on bascule ; force des opinions LIVERPS : une opinion locale surcharge sans modifier la source [U1] |
| **Unreal Engine** | une scène USD ouverte par son acteur ; références et payloads sur un prim [UE1][UE2] ; entre assets, des références vues dans le « Reference Viewer » [UE3] ; un renommage laisse un « Redirector » [UE4] | payloads chargés à la demande ; références « soft » chargées quand on les demande [UE1][UE7] | « Check In » avec une description obligatoire [UE8][UE9] | une **icône** « une version plus récente existe » dans le Content Browser [UE8][UE9] ; réimport automatique d'une source modifiée (dossiers surveillés) [UE10] | « History », « Diff Against Depot » [UE8] | « Sync » à la main ; rester sur une révision précise : non documenté dans l'éditeur [UE9] |
| **Houdini (HDA)** | la définition vit dans une bibliothèque `.hda` ; chaque nœud est une instance du type [H1] | un nœud ne calcule que quand on lui demande ses données et qu'il est « sale » [H2] | enregistrer la définition [H3] ; une nouvelle version = un **nouveau nom de type** `espace::nom::version` [H4][H5] | le menu pose la plus haute version ; l'Asset Manager colore une définition plus récente ailleurs [H4][H7] ; aucun badge sur une instance d'ancienne version [H8] | les anciennes versions **cohabitent** dans la même scène [H8] ; sauvegardes à chaque modification [H7] | **les nœuds gardent leur version**, rien ne les met à jour seul [H8] ; « Use This Definition » force une définition [H7] ; « Allow Editing of Contents » déverrouille, « Match Current Definition » revient à la définition [H3][H7] |
| **ShotGrid / Flow** | l'entité **PublishedFile** (qui, sorte, chemin) ; le Loader la pose dans le logiciel (référence ou import) [S1][S2] | non documenté | le **Publisher** : collecter, décrire, valider, publier ; monte la version du fichier de travail ; une **Version** = une itération soumise en revue, avec un statut [S1][S4][S5][S6] | le **Breakdown** liste ce que la scène référence et marque ce qui est **périmé** (plus haute version) [S7] ; la version 2 interroge la base [S3][S8] | tout l'historique d'un publish dans le Loader [S4] ; journal d'événements [S9] ; statuts d'approbation [S10] | Breakdown : mettre à jour vers la dernière, **ou vers une version précise** [S3][S8] |
| **Kitsu** | « casting » : un asset lié à des plans, sans le recréer [K1] | non documenté | « Publish revision » : un commentaire + un statut + des fichiers de prévisualisation versionnés [K2][K5] | une demande de revue notifie les personnes assignées ; rien pour « nouvelle version » côté aval [K3][K5] | les révisions restent ; commentaires horodatés [K2][K3] | une playlist ouvre la dernière, puis on choisit la version par plan ; comparer deux versions [K3][K4] |
| **Frame.io** | des « Collections » : une recherche enregistrée qui rassemble sans déplacer [IO1] | non documenté | glisser la nouvelle version **sur** l'ancienne : une **pile de versions** sous une seule vignette [IO2] | notifications de médias et de commentaires ; rien de propre à « nouvelle version » [IO3][IO4] | la pile garde toutes les versions ; les commentaires restent sur leur version [IO2][IO5] ; comparaison côte à côte [IO6] | la plus récente s'ouvre par défaut ; réordonner, dépiler [IO2] ; un partage peut ne montrer que la dernière [IO4] |

Le glossaire d'OpenUSD écrit désormais **LIVERPS** (et non LIVRPS) : un arc
« Relocates » a été ajouté [U1].

### 1.3 Ce qu'on en retient

1. **Deux façons de lier, deux prix.** Le **lien vivant** (Dynamic Link, compo
   imbriquée, séquence imbriquée, clip composé, compo Fusion référencée) montre
   une retouche partout sans rendu [A1][E1][N1][R ch. 50, 64] ; il se paie en
   lecture plus lente [A2][N1], en durée qui ne suit pas (noir ou silence quand
   la source raccourcit [N1][R ch. 50]), en « hors ligne » quand la source bouge
   [A5], et **il ne garde aucune version** (colonnes « historique » et
   « épingler » : non documenté, ou seulement « détacher »). Le **lien figé et versionné** (pré-rendu d'AE, Render and
   Replace, Precomp de Nuke, VFX Connect, LiveGroup publié, versions de Nuke
   Studio) lit un fichier rendu, choisit sa version, peut revenir
   [E1][A8][F3][R ch. 61][F7][F10]. Cal demande les deux : le vivant **dans
   l'outil de la source**, le figé **partout ailleurs**. C'est aussi ce que la
   technique impose ici : Dynamic Link exige que les deux logiciels soient là, à
   la même version [A2][A7] ; le Montage n'a ni les instruments d'ODIO ni les
   modèles. D'où § 2.6.
2. **Le rendu figé est un cache de la source, jamais la vérité** : Freeze joue
   des fichiers jusqu'au dégel [L2], « Restore Unrendered » reprend les
   changements faits entre-temps [A9], Resolve jette le cache d'un clip modifié
   [R ch. 8], le Precomp « read input » recalcule [F3]. D'où : une version est un
   rendu, la source reste éditable, « Rouvrir la source ».
3. **Savoir qu'un rendu est périmé, c'est une empreinte** : Nuke écrit l'empreinte
   de l'arbre dans l'EXR et prévient si le script a changé [F2] ; Resolve peint ce
   qui est à recalculer [R ch. 8] ; ODIO le fait déjà pour ses prises (`musique.md`
   § 8). D'où le champ `fp` (§ 2.4).
4. **Une nouvelle version ne s'impose pas** : Figma attend « Update » fichier par
   fichier [FG1][FG3] ; Houdini laisse chaque nœud sur sa version [H8] ; le
   Breakdown de ShotGrid met à jour vers la dernière **ou vers une version
   choisie** [S3] ; Resolve ne propage pas le choix de version d'un clip lié
   [R ch. 142] ; Nuke Studio garde sa version à un plan non lié [F15] ; VFX Connect
   dit quelle version le clip lit [R ch. 61]. D'où : épinglé par défaut, une
   pastille, un clic (§ 2.7). Nuke Studio a aussi l'inverse (un plan lié suit) :
   c'est la question 3.
5. **Prévenir, là où l'on travaille** : un badge et une revue avant / après chez
   Figma [FG3], une icône dans le navigateur d'Unreal [UE8], des couleurs et une
   recherche de versions chez Nuke [F13][F14], le Breakdown qui marque le périmé
   [S7]. À l'inverse, Frame.io et Kitsu ne préviennent pas l'aval d'une nouvelle
   version [IO3][K3]. D'où la pastille **sur l'usage lui-même**, le résumé sur
   l'onglet de la séquence, et la note de publication montrée avec (Figma la
   montre à la revue [FG2]).
6. **Publier est un geste nommé, avec une note** : la description de Figma [FG2],
   la liste de changements d'Unreal [UE8], la description du Publisher de
   ShotGrid [S4], le commentaire et le statut d'une révision Kitsu [K2], le
   « Publish » d'un LiveGroup [F7], « Create New Version » de VFX Connect
   [R ch. 61]. D'où « Publier la vN » et `note`.
7. **Une version est un objet immuable, nommé, qui cohabite avec les autres** :
   `nom::version` chez Houdini [H4][H8], `_v01` chez Nuke [F2] et VFX Connect
   [R ch. 61], la pile sous une seule vignette chez Frame.io [IO2]. D'où : une
   version = un objet de la bibliothèque, empilé sous son élément (§ 3.5).
8. **Revenir sans écraser** : Resolve restaure une sauvegarde comme une timeline
   de plus [R ch. 41] ; Figma restaure en ajoutant des points [FG4]. D'où « Rouvrir
   la vN dans une copie », et « Revenir » qui range d'abord l'état courant.
9. **Rien ne cascade tout seul entre fichiers** chez Figma (on publie d'abord
   [FG8]) ni chez Houdini [H8] ; chez USD, un fichier changé ne se voit même pas
   sans rechargement [U2]. D'où : on publie de bas en haut, chaque étage par un
   geste (§ 2.8).
10. **Ce qu'on ne reprend pas** : le « hors ligne » quand une source bouge [A5]
    et le métrage manquant [E3] — ici, une version utilisée ne peut pas partir
    (§ 2.9) ; le détachement (Figma, Resolve [FG5][R ch. 50]) — un usage n'étant
    qu'un fichier, il n'y a rien à détacher.

### Sources du § 1

Montage, compositing, son (date « Last updated » d'Adobe entre parenthèses ;
« … » : le même début d'adresse que la ligne au-dessus) :

- [A1] https://helpx.adobe.com/premiere/desktop/use-premiere-with-other-apps/working-with-other-adobe-applications/replace-clips-with-a-dynamically-linked-after-effects-composition.html (18/08/2026)
- [A2] https://helpx.adobe.com/premiere/desktop/use-premiere-with-other-apps/working-with-other-adobe-applications/share-assets-between-after-effects-and-premiere-using-dynamic-link.html (18/08/2026)
- [A3] …/working-with-other-adobe-applications/modify-a-dynamically-linked-composition-in-after-effects.html (18/08/2026)
- [A4] …/working-with-other-adobe-applications/make-a-dynamically-linked-composition-offline.html (18/08/2026)
- [A5] …/working-with-other-adobe-applications/relink-a-dynamically-linked-composition.html (18/08/2026)
- [A6] …/working-with-other-adobe-applications/import-after-effects-compositions.html (18/08/2026)
- [A7] https://helpx.adobe.com/after-effects/desktop/work-with-other-applications/work-with-dynamic-link/dynamic-link-effects.html (27/03/2026)
- [A8] https://helpx.adobe.com/premiere/desktop/render-and-export/render-sequences-for-playback/render-and-replace-media-in-a-sequence.html (07/01/2026)
- [A9] …/render-sequences-for-playback/replace-rendered-clips-with-original-media.html (22/08/2025)
- [A11] https://helpx.adobe.com/premiere/desktop/use-premiere-with-other-apps/working-with-other-adobe-applications/edit-premiere-sequences-in-audition.html (18/08/2026)
- [A12] …/working-with-other-adobe-applications/edit-premiere-audio-clips-in-audition.html (18/08/2026)
- [A13] https://helpx.adobe.com/premiere/desktop/get-started/preferences-and-settings/auto-save-preferences.html (07/01/2026)
- [E1] https://helpx.adobe.com/after-effects/desktop/work-with-compositions/precomposing-and-nesting/precomposing-nesting-pre-rendering.html (21/01/2026)
- [E2] https://helpx.adobe.com/after-effects/desktop/work-with-projects/after-effects-projects/projects.html (27/03/2026)
- [E3] https://helpx.adobe.com/after-effects/desktop/work-with-footage-items/import-and-interpret-footage-items/importing-interpreting-footage-items.html (27/03/2026)
- [N1] https://helpx.adobe.com/premiere/desktop/edit-projects/edit-nested-sequences/about-nested-sequences.html (18/08/2026)
- [N2] …/edit-nested-sequences/nest-a-sequence-in-another-sequence.html (18/08/2026)
- [N3] …/edit-nested-sequences/reveal-a-clip-in-a-nested-source-sequence.html (18/08/2026)
- [R] *DaVinci Resolve 21 Reference Manual*, https://documents.blackmagicdesign.com/UserManuals/DaVinci_Resolve_21_Reference_Manual.pdf — ch. 3, 4, 8, 41, 50, 54, 61, 64, 142 (pages imprimées citées)
- [R21NF] *DaVinci Resolve 21 New Features Guide*, https://documents.blackmagicdesign.com/SupportNotes/DaVinci_Resolve_21_New_Features_Guide.pdf (p. 76)
- [L1] https://www.ableton.com/en/live-manual/12/bounce-to-audio/ (ch. 20)
- [L2] https://www.ableton.com/en/live-manual/12/computer-audio-resources-and-strategies/ (§ 38.1.4)
- [L3] https://www.ableton.com/en/live-manual/12/arrangement-view/ (§ 6.13)
- [L4] https://www.ableton.com/en/live-manual/12/managing-files-and-sets/ (§ 5.4.2, 5.4.3, 5.5, 5.10.3)
- [L5] https://www.ableton.com/en/live-manual/11/computer-audio-resources-and-strategies/ (Freeze et Flatten, Live 11)
- [L6] https://www.ableton.com/en/release-notes/live-12/ (12.2, 12.3)
- [L7] https://help.ableton.com/hc/en-us/articles/360000377870-Backup-Sets (page refusée au robot ; extrait du moteur de recherche)
- [F1] https://learn.foundry.com/nuke/content/comp_environment/organizing_scripts/using_precomp_node.html (Nuke 17.1v2)
- [F2] …/organizing_scripts/creating_precomp_nodes.html
- [F3] …/organizing_scripts/using_precomp_rendering.html
- [F4] https://learn.foundry.com/nuke/content/reference_guide/other_nodes/precomp.html
- [F5] https://learn.foundry.com/nuke/content/comp_environment/organizing_scripts/using_livegroups.html
- [F6] …/organizing_scripts/creating_livegroup_nodes.html
- [F7] …/organizing_scripts/saving_loading_livegroup.html
- [F8] …/organizing_scripts/livegroup_overrides.html
- [F9] https://learn.foundry.com/nuke/content/reference_guide/other_nodes/livegroup.html
- [F10] https://learn.foundry.com/nuke/content/timeline_environment/create_comp/create_comp.html
- [F11] https://learn.foundry.com/nuke/content/timeline_environment/exporting/building_vfx_tracks.html
- [F12] https://learn.foundry.com/nuke/content/timeline_environment/versioning/versions_and_snapshots.html
- [F13] …/versioning/versions_in_bins.html
- [F14] …/versioning/versions_in_sequences.html
- [F15] …/versioning/version_linking.html
- [F16] …/versioning/using_snapshots.html

Bibliothèques, pipelines, revue :

- [FG1] https://help.figma.com/hc/en-us/articles/360041051154-Guide-to-libraries-in-Figma
- [FG2] https://help.figma.com/hc/en-us/articles/360025508373-Publish-a-library
- [FG3] https://help.figma.com/hc/en-us/articles/360039234193-Review-and-accept-library-updates
- [FG4] https://help.figma.com/hc/en-us/articles/360038006754-View-a-file-s-version-history
- [FG5] https://help.figma.com/hc/en-us/articles/360038665754-Detach-an-instance-from-the-component
- [FG6] https://help.figma.com/hc/en-us/articles/360039150413-Swap-components-and-instances
- [FG7] https://help.figma.com/hc/en-us/articles/360039238353-View-and-explore-library-analytics (extrait du moteur de recherche)
- [FG8] https://help.figma.com/hc/en-us/articles/360039150733-Apply-changes-to-instances
- [U1] https://openusd.org/release/glossary.html (« USD Terms and Concepts »)
- [U2] https://openusd.org/release/api/class_usd_stage.html
- [U3] https://openusd.org/release/api/class_ar_resolver.html
- [U4] https://openusd.org/release/api/ar_page_front.html
- [UE1] https://dev.epicgames.com/documentation/en-us/unreal-engine/usd-stage-editor-quick-start-in-unreal-engine (5.8)
- [UE2] https://dev.epicgames.com/documentation/en-us/unreal-engine/working-with-usd-stage-prims-in-unreal-engine
- [UE3] https://dev.epicgames.com/documentation/en-us/unreal-engine/reference-viewer-in-unreal-engine
- [UE4] https://dev.epicgames.com/documentation/en-us/unreal-engine/asset-redirectors-in-unreal-engine
- [UE7] https://dev.epicgames.com/documentation/en-us/unreal-engine/referencing-assets-in-unreal-engine
- [UE8] https://dev.epicgames.com/documentation/en-us/unreal-engine/source-control-in-unreal-engine
- [UE9] https://dev.epicgames.com/documentation/en-us/unreal-engine/using-source-control-in-the-unreal-editor
- [UE10] https://dev.epicgames.com/documentation/unreal-engine/reimporting-assets-automatically-in-unreal-engine (extrait du moteur de recherche)
- [H1] https://www.sidefx.com/docs/houdini/assets/install.html
- [H2] https://www.sidefx.com/docs/hdk/_h_d_k__op_basics__overview__cooking.html
- [H3] https://www.sidefx.com/docs/houdini/assets/edit.html
- [H4] https://www.sidefx.com/docs/houdini/assets/namespaces.html
- [H5] https://www.sidefx.com/docs/houdini/ref/windows/increase_asset_version.html
- [H7] https://www.sidefx.com/docs/houdini/ref/windows/optypemanager.html
- [H8] https://www.sidefx.com/docs/houdini/assets/versioning_systems.html
- [S1] https://help.autodesk.com/cloudhelp/ENU/SG-Producer/files/pr-project-tracking/SG_Producer_pr_project_tracking_pr_entities_html.html
- [S2] https://developers.shotgridsoftware.com/a4c0a4f1/
- [S3] https://developers.shotgridsoftware.com/tk-multi-breakdown2/ (v0.4.6)
- [S4] https://help.autodesk.com/view/SGSUB/ENU/?guid=SG_Supervisor_Artist_sa_integrations_sa_integrations_user_guide_html
- [S5] https://developers.shotgridsoftware.com/tk-multi-publish2/
- [S6] https://developers.shotgridsoftware.com/tk-multi-publish2/customizing.html
- [S7] https://developers.shotgridsoftware.com/3c0c0ab6/ (le Breakdown historique ; la page utilisateur d'Autodesk est introuvable)
- [S8] https://developers.shotgridsoftware.com/tk-multi-breakdown2/api.html
- [S9] https://help.autodesk.com/cloudhelp/ENU/SG-Administrator/files/ar-data-management/SG_Administrator_ar_data_management_ar_event_logs_html.html
- [S10] https://help.autodesk.com/cloudhelp/ENU/SG-Tutorials/files/SG_Tutorials_tu_tracking_statuses_html.html
- [K1] https://kitsu.cg-wire.com/guides/production/breakdown-casting/
- [K2] https://kitsu.cg-wire.com/guides/review-publishing/publish/
- [K3] https://kitsu.cg-wire.com/guides/review-publishing/review/
- [K4] https://kitsu.cg-wire.com/guides/review-publishing/playlist/
- [K5] https://kitsu.cg-wire.com/guides/task-configuration/managing-task-statuses/
- [IO1] https://help.frame.io/en/articles/9101042-collections-overview
- [IO2] https://help.frame.io/en/articles/9101068-versioning-in-frame-io
- [IO3] https://help.frame.io/en/articles/9105374-in-app-notifications
- [IO4] https://help.frame.io/en/articles/9105232-shares-in-frame-io
- [IO5] https://help.frame.io/en/articles/1711085-how-to-copy-and-paste-comments-legacy (10/04/2026)
- [IO6] https://help.frame.io/en/articles/9952618-comparison-viewer

---

## 2. Le modèle proposé

### 2.1 Ce qui existe aujourd'hui, et où ça coince

| ce qui existe | où | ce qui manque pour la logique de Cal |
|---|---|---|
| Six sortes d'objets : `image`, `video`, `audio`, `element`, `midi`, `sequence` | `server/core/library.py:44` | aucune notion de version ni d'usage |
| L'élément = une planche de références nommées, copiées dans son dossier, et une voix | `library.py:366-412` (`create_element`), `ARCHITECTURE.md` § 2 | pas de source vivante, sauf `element.source` pour Character Factory (`core_api.py:266`) |
| Un personnage de CF réimporté : **deux conduites contraires** — `cf_import` refait un élément neuf (« l'ancien reste »), `cf_refresh` remplace les références **sur place** et efface les anciens fichiers | `core_api.py:233-268` ; `asset.py:495-551` (l. 535-538 : `unlink`) | l'une perd le lien, l'autre perd l'historique |
| Un plan de séquence pointe un objet par `item` ; l'export lit son fichier | `montage.py:399-401` (`ITEM`), `media_of` `montage.py:1401-1416` | rien ne dit qu'une autre version existe |
| Un projet ODIO : un fichier `musique/mus-….json` hors de la bibliothèque, enregistré seul (`rev`, 409) ; le son se calcule **dans la page** (Web Audio) ; « Exporter » rend le mixage hors temps réel (OfflineAudioContext) et le dépose comme un son neuf | `music.py:26-29`, `594-653` ; `musique/musique.js:1418-1481` (`renderMix` l. 1453, dépôt l. 1456) | chaque export est un son de plus, sans lien avec le projet ni avec l'export d'avant |
| Une séquence est une source (sa timeline, `rev`) | `montage.py:107-240` | une séquence ne se pose pas dans une autre (`normalize` n'accepte que `video`, `image`, `audio` : `montage.py:392-394` ; `montage.md`, « Pas encore : … imbrication ») |
| Une planche d'Idéation pose des objets par `item` (`media` : image, vidéo, son, élément) | `ideation.py` `_node`, `MEDIA_KINDS` | pas de carte qui génère de la musique (sortes : `gen`, `vgen`, `compose`… `ideation.py` `TYPES`) |
| Object Creator : chaque mesh s'ajoute à l'élément objet (`mesh-001.glb`, `mesh-002.glb`…) | `objet.py:19-22`, `222-237` | déjà une pile, mais sans numéro de version ni usage |
| La corbeille déplace un dossier ; un plan qui pointe un objet jeté fait échouer l'export (« objets absents de la bibliothèque (à la corbeille ?) ») | `library.py:480-491` ; `montage.py:1141-1143` | on peut jeter un son utilisé |

### 2.2 Les mots

| mot | ce que c'est | exemples |
|---|---|---|
| **objet** | ce que la bibliothèque range aujourd'hui | une image, un son, une planche, une séquence |
| **source** | un document vivant, édité dans un outil, joué en direct dans cet outil | `mus-…` (ODIO), `seq-…` (Montage), une carte ou un cadre de `ide-…`, un clip génératif, un personnage (`slug` sur DGX1), la recette d'un objet d'app |
| **élément** | l'objet qui relie une source à ses versions | « Pluie sur Belleville », type `music` |
| **version** | un objet immuable produit en publiant, marqué `version: {of, n}` | `aud-…` (v3 de la chanson), `vid-…` (v2 de la séquence), une planche (v4 du personnage) |
| **usage** | un endroit qui pose une version par son identifiant | le plan k3f2 de la piste A1 de « Pub 30 s » |
| **empreinte** | le condensé de ce qui, dans la source, change le rendu | déjà employé par ODIO pour ses prises « périmées » (`musique.md` § 8) |

Principe (notre choix, justifié au § 1) : **la source est vivante, les usages
sont figés, la version est le pont**. Rien ne lit la source hors de son outil ;
tout le reste lit des fichiers. D'où trois propriétés par construction :

- un usage ne casse jamais (il pointe un fichier que rien ne réécrit) ;
- tout ce qui sait déjà lire un objet (l'export du Montage, les copies
  d'affichage, la forme d'onde, le zip, la lignée, R2) sait lire une version,
  sans une ligne de plus ;
- les formats des documents consommateurs (séquence, projet ODIO, planche) ne
  changent pas : l'usage **se déduit** de l'objet pointé (`version.of`).

### 2.3 Le schéma de données

**L'élément** — un objet `kind: "element"` (la sorte existante), champs neufs
facultatifs sous `element` (notre choix) :

```jsonc
{
  "id": "ele-20260929-184200-ab12",            // library.new_id("element") : inchangé
  "kind": "element",
  "title": "Pluie sur Belleville",
  "origin": {"tool": "music", "user": "cal"},    // le propriétaire (library._owned)
  "folder": "Musique", "tags": [], "fav": false,
  "thumb": "…",                                  // celle de sa dernière version
  "element": {
    "type": "music",          // existants : character object place style other ; neufs : music sound sequence picture
    "media": "audio",         // ce que donne une version : refs | audio | video | image | midi | mesh
    "description": "…",
    "refs": [],               // (planches) inchangé ; vide pour un élément qui n'en a pas
    "source": {               // absent : une planche d'aujourd'hui, sans source
      "tool": "music",        // music | montage | ideation | character-factory | image | movie | song | objet
      "doc": "mus-20260929-171000-9f3e",
      "part": null,           // une partie : {"node": "a1"} (Idéation), {"clip": "k3"} (région), {"frame": "f2"}
      "open": "musique/#mus-20260929-171000-9f3e"
    },
    "versions": [             // dans l'ordre ; une entrée n'est jamais réécrite, sauf `state`
      {"n": 1, "item": "aud-20260929-184510-77c1", "at": "2026-09-29T18:45:10+00:00", "by": "cal",
       "note": "premier jet", "fp": "sha256:…", "rev": 57,
       "src": {"tool": "music", "doc": "mus-…"},   // d'où elle vient (une source peut déménager, § 2.6)
       "params": {"range": "song", "tail": 2},     // comment on l'a calculée
       "deps": [{"el": "ele-…", "n": 2, "item": "aud-…"}],   // les éléments qu'elle contient (§ 2.8)
       "state": "ready"}                           // ready | withdrawn (retirée : § 2.7)
    ],
    "head": 1,                // la dernière version prête et non retirée
    "pending": null           // {"job": "job-…", "n": 2, "by": "cal"} pendant un rendu
  }
}
```

**La version** — un objet ordinaire (`add_file`, `library.py:322-349` : fichier,
vignette, copies d'affichage, durée, `parents`, `origin`), plus :

```jsonc
"version": {"of": "ele-20260929-184200-ab12", "n": 3},
// dans son dossier, à côté de main.wav : source.json — la source telle qu'elle a été rendue
// (le projet ODIO, la timeline, les nœuds du cadre, la fiche du personnage)
```

Une version de planche (un personnage) est un objet `element` sans source,
avec ses références : exactement ce que fait `cf_import` aujourd'hui
(`core_api.py:265`). `library.ref_paths` la lit sans changement
(`library.py:526-539`).

**L'usage** — rien de neuf dans les documents. Il se lit :

| consommateur | où est l'identifiant | source |
|---|---|---|
| séquence | `clips[].item` de `library/seq-…/sequence.json` | `montage.py:399-411` |
| projet ODIO | `clips[].item` (clips audio), `clips[].gen.takes[].item` (les prises : candidates, pas des usages) | `music.py:330-343` |
| planche d'Idéation | `nodes[].item` (`media`, `palette`) | `ideation.py` `_node` |
| plan vidéo, image, rendu d'Upscale | `params` et `parents` d'un travail fini | `jobs.py:535-544` ; c'est de l'**histoire** (la lignée), pas un usage à mettre à jour |

L'index des usages est un **cache dérivé des documents** (notre choix) :
`<data_dir>/elements/uses.json`, refait en relisant les fichiers dont la date a
changé (séquences, projets ODIO, planches — quelques dizaines de fichiers), à
la demande et au démarrage. Aucun outil n'a à le tenir à jour : un document
enregistré par n'importe quel chemin (la page, la co-édition d'Idéation
qui écrit la planche au plus toutes les 0,8 s pendant un geste,
`ideation_collab.py:39-45`, un script) est relu tel
qu'il est.

```jsonc
// <data_dir>/elements/uses.json — rebâti, jamais la vérité
{"ele-…": [{"doc": "seq-…", "tool": "montage", "where": "A1 · k3f2", "item": "aud-…", "n": 1,
            "owner": "cal", "mtime": 1790000000.0}]}
```

**Le journal** — `<data_dir>/elements/journal.jsonl`, une ligne par événement,
un numéro croissant `seq` (§ 2.11).

### 2.4 Les états

| de quoi | état | comment on le sait |
|---|---|---|
| la source | **à jour** / **modifiée depuis la vN** / **perdue** (à la corbeille, introuvable) | empreinte de la source ≠ `fp` de la dernière version ; source absente |
| l'élément | **sans version** / **vN** / **rendu en cours** (`pending`) / **dernier rendu échoué** (journal) | `versions`, `head`, `pending` |
| un usage | **à jour** / **vM disponible** / **version retirée** | l'objet pointé a `version.n` < `head`, ou `state: withdrawn` |

L'empreinte, par sorte de source (notre choix : le condensé SHA-256 du JSON
canonique de ce qui change le rendu) :

| source | ce qui entre dans l'empreinte | ce qui n'y entre pas |
|---|---|---|
| projet ODIO | pistes, modules, câbles, motifs, clips, tempo, mesure, tonalité, sections, arc, automation, banc | `ui` (vue, zoom), `rev`, `updated`, `pending`, `gen` (le brouillon du panneau), `presets` |
| séquence | `settings`, `tracks`, `clips`, `range` | `name`, `markers`, `rev`, `updated` |
| cadre d'Idéation | les objets entièrement dans le cadre et leurs liens (la règle de l'export, `ideation.py` `_inside`, `region_of`) | le reste de la planche |
| carte ou région générative | la recette (modèle, tâche, réglages, style, paroles, graine) et la prise choisie | la position |
| personnage CF | la liste que l'import rapatrie (rôle, libellé, chemin ; `core_api._walk_cf`, `core_api.py:271-293`) | — ; un fichier réécrit sous le même nom ne se verrait pas : le manifeste de CF n'a ni `rev` ni date de modification (`Character_Factory/factory/project.py:111-124`) |
| recette d'un objet d'app | `prompt`, `params` de l'objet choisi | — |

### 2.5 Publier : le calcul à la demande

**Une version n'existe qu'une fois son fichier rangé** (notre choix, juste par
construction) : le rendu part dans la file ; à la fin, le travail range le
fichier par `ctx.add` (`jobs.py:535-544`) et l'élément reçoit la version dans le
même geste. Un rendu arrêté ou échoué ne laisse aucune version à moitié.

| source | ce que donne une version | qui calcule | voie | ce qui existe |
|---|---|---|---|---|
| projet ODIO (le morceau, ou la boucle) | WAV 24 bits 48 kHz stéréo (+ les stems en option) | **la page ODIO qui publie** : `renderMix`, le même graphe que la lecture et l'export, puis le dépôt | le navigateur | `musique/musique.js:1453-1456` ; le serveur vérifie que le projet sur disque a la `rev` rendue (sinon 409 « le projet a changé pendant le rendu ») |
| le même, ODIO fermé | idem | Chromium sans affichage sur DGX2 qui ouvre ODIO et rend | `cpu`, priorité basse | **éprouvé en essai seulement** : l'export du mixage et de 10 stems en 22 s, piloté par Playwright sur DGX2 (`musique.md` § 3) ; à écrire, plus tard (§ 4, étape 12) |
| séquence | MP4 H.264 + AAC | `montage.export` (ffmpeg, par passes de 8 s) | `cpu` | `montage.py:1465-1507` rend déjà `{"item": …}` ; l'élément l'appelle tel quel |
| cadre d'Idéation | PNG | `ideation.export` (PIL) | `cpu` | `ideation.py` `run_export` rend déjà `{"item": …}` |
| carte, région générative, nœud musique | la prise choisie : **rien à recalculer** | déjà rendue par `music.gen.*`, `music.yue`, `music.generate` | `audio` (réel) / `cpu` (factice) | `music_gen.py:579-585` ; `music.py:867-871` ; `music_yue.py:921-925` |
| personnage CF | une planche : visage, pleins pieds, expressions, voix, description | l'import (`_walk_cf` + `create_element`), passé en travail | `cpu` | `core_api.py:233-293` (synchrone aujourd'hui) |
| recette d'app (image, vidéo, chanson) | l'objet choisi : rien à recalculer ; une nouvelle version = « Recréer » puis « Publier comme vN » | l'outil, par ses travaux | `image`, `h3`, `audio` | `/api/image/redo`, `/api/movie/redo` (`ARCHITECTURE.md` § 7) |
| objet 3D | GLB | `objet.mesh` (TRELLIS.2) | `image` | `objet.py:222-237` (la pile `element.meshes`) |

**Qui, où, quand** (notre choix) :

- le travail de publication appartient à celui qui publie (`owner`,
  `jobs.py:300-331`) : ses quotas, sa place dans le tourniquet ;
- un geste « Publier » prend la priorité ordinaire de la personne (haute pour
  Cal quand `admin_first` est vrai, normale sinon : `jobs.py:311-312`) ; ce qui
  se calcule sans qu'on l'attende (le rendu d'ODIO fermé, un rattrapage) part
  en **basse** (`PRIORITIES`, `jobs.py:70`) ;
- la machine : celle que choisit l'ordonnanceur (`jobs._choose`,
  `ARCHITECTURE.md` § 3) ; rien de neuf.
- **la première pose calcule** (la phrase de Cal : « s'il est appelé à un
  endroit comme élément, il est alors calculé ») : poser un élément sans
  version lance la publication de la v1, et l'usage se pose quand elle est
  prête (la page le dit, avec la place dans la file). Poser un élément dont la
  source est modifiée pose sa dernière version et le dit : « la source a changé
  depuis la v3 — publier la v4 ? » (question 2).

**Les copies d'affichage et proxys** d'une version sont celles de tout objet :
WebP 256 à 2048 pour une image ou l'affiche d'une vidéo (`library.py:191-240`),
la forme d'onde d'un son (`/api/montage/wave/<id>`, gardée en cache sous
l'identifiant de l'objet : `montage.py:1615-1636`), les adresses versionnées
gardées un an (`library.py:203-206`). Ces caches sont justes par construction
parce qu'une version ne change jamais : un nouveau rendu est un nouvel
identifiant. (Rendre un son « sur place » sous le même identifiant les
tromperait : la forme d'onde du Montage resterait l'ancienne.)

### 2.6 Lu en direct, lu figé

| où | ce qu'on lit | pourquoi |
|---|---|---|
| dans l'outil de la source | **la source, en direct** : ODIO joue son graphe Web Audio, le Montage sa timeline, Idéation sa planche, CF son studio | c'est là qu'on travaille ; rien à exporter (« je travaille mon son en temps réel sans avoir besoin de l'exporter ») |
| partout ailleurs | **une version, figée** : un fichier | la page qui consomme n'a ni les instruments d'ODIO ni les modèles ; l'export d'une séquence doit être ce que l'aperçu montre |
| la source elle-même quand elle est aussi un usage (une région générative du Montage qui est un élément) | sa version, qui suit d'elle-même la publication **dans ce document-là** | la source et son usage « maison » ne font qu'un |

Ouvrir la source depuis un usage : double-clic ou « Ouvrir la source » →
`element.source.open` (la même adresse que la fiche d'Asset). **Déménager une
source** (« Ouvrir dans ODIO » une chanson née dans Idéation ou dans le
Montage) : l'élément change de `source` ; chaque version garde `src`, d'où elle
vient.

### 2.7 Mettre à jour, garder, revenir

- **Mettre à jour un usage** = remplacer l'identifiant de la version par celui
  de la nouvelle, **dans le document du consommateur, par son enregistrement
  habituel** (la `rev` protège, ctrl+Z défait : `commun/undo.js`). Le serveur ne
  réécrit jamais un document consommateur derrière son dos (notre choix : pas
  de 409 surprise dans un onglet ouvert).
- **Garder** = ne rien faire : l'usage reste sur sa version, la pastille reste,
  discrète. Il n'y a pas d'état « refusé » à stocker (notre choix ; la
  documentation de Figma et de ShotGrid au § 1 va dans ce sens).
- **Tout mettre à jour** dans un document (une séquence entière) : un seul pas
  d'annulation.
- **Longueur qui change** (Montage, notre choix) : début, durée et point
  d'entrée du plan restent ; `src_dur` suit ; si la nouvelle version est plus
  courte que entrée + durée × vitesse, le plan se raccourcit et la pastille le
  dit (« la v4 dure 2:31, le plan passe de 2:48 à 2:31 »). ODIO : le clip garde
  début, longueur, décalage (`start`, `len`, `off`, `music.py:324-344`).
- **Revenir à une version** : dans un usage, choisir une version plus ancienne
  dans la liste. Pour la source : « Rouvrir la v2 » rouvre `source.json` de la
  v2 **dans une copie** (un projet ODIO ou une séquence neuve) ; « Revenir à la
  v2 » remplace la source vivante par cette copie après avoir rangé l'état
  courant comme brouillon (notre choix : rien n'est perdu).
- **Retirer une version** (une v4 ratée) : `state: withdrawn` ; `head` redevient
  la dernière prête ; les usages qui l'ont gardent leur fichier et affichent
  « version retirée » ; elle ne se propose plus.
- **L'historique** : la liste des versions (qui, quand, note, durée, empreinte,
  `source.json`, ce qu'elle contient) et le journal ; empilée sous l'élément
  dans Asset, à la manière d'une pile de versions (§ 1).

### 2.8 Les dépendances en chaîne, les cycles

- **Contenir** : une séquence (élément A) pose la chanson (élément B, v2). La
  v5 de A a `deps: [{el: B, n: 2}]`. Quand B publie sa v3, **rien ne cascade**
  (notre choix) : le plan dans la timeline de A montre la pastille ; si Cal met
  à jour, l'empreinte de A change, A est « modifiée depuis la v5 », et sa v6
  contiendra B v3. On publie de bas en haut, chaque étage par un geste — la
  règle de l'accord explicite (§ 1).
- **Ce que contient un élément** : les usages trouvés dans sa source (ou dans
  sa partie : le cadre, la région), plus les `deps` de ses versions.
- **Cycle interdit** : poser X dans le document D est refusé si un élément
  dont la source est D (ou la partie de D où l'on pose) est dans la fermeture
  de X (X, ce que X contient, et ainsi de suite). La page demande avant de
  poser (`POST /api/elements/check-use`) et le dit en nommant la chaîne
  (« Pub 30 s → Pluie v3 → … → Pub 30 s ») ; le serveur le vérifie aussi à
  l'enregistrement d'un document qui porterait un cycle (400, comme les
  chevauchements de plans, `montage.py:452-461`).
- Une séquence dans elle-même : refusé par la même règle.

### 2.9 Supprimer

| on jette… | ce qui se passe (notre choix) |
|---|---|
| une **version utilisée** | **refusé** (409) : la réponse liste les usages (document, place, propriétaire) ; la page propose de les ouvrir ou de passer ces usages à une autre version |
| une version inutilisée | à la corbeille ; l'élément la garde dans sa liste, marquée « à la corbeille » ; elle en revient |
| un **élément** | à la corbeille avec ses versions inutilisées ; ses versions utilisées **restent** (les usages ne cassent pas) et disent « élément à la corbeille » ; le rendre ramène tout |
| la **source** (projet ODIO, séquence, planche) | l'élément passe « source perdue » : on ne publie plus, les versions et les usages vivent ; rendre la source rend la main |
| vider la corbeille (Admin) | ne touche que ce qui y est ; une version utilisée ne peut pas y être |

Le garde-fou est dans `library.trash` (`library.py:480-491`), qui sert à toutes
les corbeilles (`asset.py:232-236`, `montage.py` `r_delete`, `core_api.py:147-150`) :
une ligne d'accroche, un seul endroit.

### 2.10 Les routes

Module neuf `server/tools/elements.py` (routes, contrôle), socle neuf
`server/core/elements.py` (les versions, l'index, le journal, les empreintes),
adaptateurs neufs `server/tools/elements_sources.py`. Aucune route existante ne
change de forme.

| route | ce qu'elle fait |
|---|---|
| `GET /api/elements?source=<doc>&tool=` | les éléments (d'une source) avec leur état : `head`, `dirty`, `pending`, nombre d'usages |
| `GET /api/elements/<id>` | l'élément, ses versions (objets publics), son état, ses usages visibles, ce qu'il contient |
| `POST /api/elements` `{title, type, source:{tool, doc, part}, from_item?}` | faire un élément ; `from_item` : un objet existant devient la v1 sans être recopié (§ 3.4). **Existant** : `{title, type, refs}` fait toujours une planche (`core_api.py:161-170`) |
| `POST /api/elements/<id>/publish` `{note, params}` | publier : lance le rendu de la source par son adaptateur (travail `element.publish`), rend le travail |
| `POST /api/elements/<id>/versions` `{item, rev?, note}` | ranger comme version un objet déjà rendu (la page ODIO, une prise choisie, une image recréée) : même propriétaire, bonne sorte, pas déjà une version ; `rev` vérifiée contre la source |
| `POST /api/elements/<id>/versions/<n>` `{state: "withdrawn" \| "ready", note}` | retirer, remettre, annoter |
| `POST /api/elements/<id>/move` `{tool, doc, part}` | déménager la source (« Ouvrir dans ODIO ») |
| `POST /api/elements/<id>/restore-source` `{n, mode: "copy" \| "replace"}` | rouvrir la source d'une version |
| `GET /api/elements/uses?doc=<doc>` | pour une page consommatrice : chaque usage de son document, sa version, la dernière, la pastille à montrer |
| `POST /api/elements/check-use` `{el, doc, part}` | peut-on poser ici (cycle) ; `''` ou la raison |
| `GET /api/elements/changes?since=<seq>` | les événements du journal après `seq` (visibles par la personne) |
| `GET /api/elements/stream?since=<seq>` | les mêmes, en flux SSE (§ 2.11) |

`POST /api/elements` reste enregistrée par `core_api.py` (`el_create`) : une
accroche y passe la main à `core/elements.py` quand le corps porte `source` ou
`from_item`. Les chemins fixes (`uses`, `check-use`, `changes`, `stream`)
s'enregistrent avant `<id>`, qui a de toute façon la forme `ele-…`
(`library.py:77-78`, `494`).

Travail neuf : `element.publish` (voie `cpu`) qui appelle l'adaptateur de la
source — lequel appelle la fonction de rendu de l'outil telle qu'elle est
(`montage.run_export(ctx)`, `ideation.run_export(ctx)`, l'import CF) et
attache l'objet rendu. Pour une source dont le rendu est un travail GPU (une
prise à refaire), l'adaptateur soumet le travail de l'outil au nom du même
propriétaire (`jobs.submit(..., owner=…)`, `jobs.py:300-309`).

Droits (notre choix, dans la règle existante `auth.can_write_item`,
`auth.py:318-322`) : publier, retirer, déménager = le propriétaire de
l'élément ou un admin, **et** lire la source ; poser un élément = pouvoir le
lire (`visibility`) ; mettre à jour un usage = pouvoir écrire le document
consommateur (ses règles à lui). Un usage dans le document d'un autre se
compte sans se nommer quand `visibility` vaut `own`.

### 2.11 Les événements : qui prévient qui

```
  ODIO (la page)        Montage (la page)      Asset (la fiche)       une autre personne
      │ Publier               ▲ pastille v4          ▲ pile de versions      ▲
      ▼                       │                      │                      │
  POST /api/elements/<id>/versions ──► core/elements.py ──► journal.jsonl (seq 812)
      ou /publish ──► jobs (element.publish) ──┘      │
                                                      ├─► GET /api/jobs rend `ev_seq` (relevé que chaque page fait déjà)
                                                      │      → la page lit GET /api/elements/changes?since=811
                                                      └─► GET /api/elements/stream (SSE) : l'événement tout de suite
```

- **Le journal est la seule vérité** ; les deux transports le lisent.
- **Le relevé existant** : chaque page relit `GET /api/jobs?limit=60` toutes les
  1,5 s quand un travail tourne, 6 s sinon (`commun/shell.js:241-260`,
  `core_api.py:360-363`). La réponse gagne un champ `ev_seq` ; une page qui voit
  un numéro plus grand lit les événements manqués. Aucune connexion de plus ;
  marche derrière le tunnel rapide, qui n'a pas de SSE (« Quick Tunnels do not
  support Server-Sent Events », `cloudflare.md` l. 120-127).
- **Le flux SSE** (au besoin, pour l'instantané) : écrit comme celui
  d'Idéation — une condition par connexion, un battement toutes les 15 s qui
  relit la session, `retry: 3000`, reprise par `since`
  (`ideation_collab.py:69`, `141-166`, `329-422`). Par Workers VPC, les flux
  sont « à vérifier au premier essai » (`cloudflare.md`, « Ce qui reste »).

| événement | émis par | reçu par (la page filtre) |
|---|---|---|
| `el.created` | faire un élément | Asset, la page de la source |
| `el.rendering` `{el, n, job}` | publier | la source, Asset ; la file le montre comme tout travail |
| `el.failed` `{el, n, why}` | le travail échoue ou est arrêté | la source, Asset |
| `el.published` `{el, n, item, by, note}` | la version est rangée | **tout consommateur** qui a un usage de cet élément (pastille), la source, Asset |
| `el.withdrawn` / `el.ready` `{el, n}` | retirer / remettre | consommateurs, Asset |
| `el.moved` `{el, source}` | déménager | Asset, l'ancienne et la nouvelle source |
| `el.trashed` / `el.restored` | corbeille | consommateurs, Asset |

« Modifiée depuis la vN » n'est pas un événement : l'outil de la source le
calcule lui-même (il a la source en main) et `GET /api/elements?source=` le rend
à la lecture (empreinte relue, gardée tant que le fichier ne change pas).

### 2.12 Les sortes actuelles, et la migration sans perte

**Rien n'est réécrit sur le disque par la migration** (notre choix) : les champs
neufs sont facultatifs, posés au premier geste qui en a besoin.

| sorte | aujourd'hui | demain |
|---|---|---|
| `image`, `video`, `audio`, `midi` | des objets | les mêmes ; certains portent `version: {of, n}` ; un clip MIDI d'ODIO pourra être la version d'un élément `media: midi` (plus tard) |
| `element` (planche) | refs + voix + description ; `source` pour CF | **inchangé** tant qu'on n'en fait rien ; une planche sans `source` reste un objet qu'on édite sur place (Apps). Une planche CF devient la **v1** de l'élément du personnage au premier « Publier » : on crée l'élément, on pose `version: {of, n: 1}` sur la planche ; tout ce qui la pointait déjà (plans vidéo, nœuds d'Idéation) devient un usage de la v1 et voit la v2 |
| `element` (vivant) | — | les champs `source`, `versions`, `head`, `media` ; un outil qui passe un élément vivant à `ref_paths` reçoit sa dernière version (une ligne dans `library.py:526`) |
| `sequence` | une source (timeline) | la même ; « Faire un élément » d'une séquence → versions MP4 ; c'est ainsi qu'une séquence se pose dans une autre (§ 1 : la précomp) |
| projet ODIO `mus-…` | un fichier hors bibliothèque | le même ; source d'éléments `type: music` |
| `cf_refresh` | remplace sur place, efface | en Studio, remplacé par « Publier une version » (question 1) ; pour une planche sans élément, inchangé |
| `element.meshes` (Object Creator) | une pile de GLB dans le dossier de l'élément | lue comme ses versions `media: mesh` (le GLB n'est pas une sorte de la bibliothèque, `objet.py:22` : seule exception au « une version = un objet ») |

À corriger au passage (hors de ce chantier, relevé ici) : `asset.py:200`
(`ID_RX`) ne rend de la corbeille en lot que `ima|vid|aud|ele` — ni `mid-` ni
`seq-` ; et `music.save_project` (`music.py:639-653`) n'a **aucun contrôle de
propriétaire** : quiconque est connecté réécrit n'importe quel projet ODIO (les
séquences, elles, passent par `library._check_write`, `montage.py:203-208`). À
régler avant que les amis n'entrent dans ODIO, et avant qu'un projet ODIO soit
une source qu'on publie.

### 2.13 Trois parcours, pas à pas

#### A. Une chanson d'ODIO posée dans une séquence, modifiée, republiée, mise à jour

1. Cal ouvre ODIO, projet « Pluie » (`mus-…`). Menu ⋯ du projet → **Faire un
   élément** → `POST /api/elements {type: "music", source: {tool: "music", doc:
   "mus-…"}}` → `ele-…`, sans version ; la barre d'ODIO montre ◆ « élément ·
   pas encore publié ».
2. **Publier la v1** (dans la barre, à côté d'Exporter ; un seul orange à
   l'écran) : la page enregistre, rend le morceau hors temps réel (`renderMix`,
   `musique.js:1453`), dépose le WAV, puis `POST /api/elements/ele-…/versions
   {item: "aud-…", rev: 57, note: "premier jet"}`. Le serveur vérifie la `rev`,
   copie le projet dans `source.json`, pose `version: {of, n: 1}` sur le son,
   écrit l'empreinte ; journal `el.published` (seq 811).
3. Dans le Montage, séquence « Pub 30 s » : le panneau Projet (c'est Asset)
   montre ◆ « Pluie · v1 ». Glissé sur A1 → la page lit `GET /api/elements/ele-…`
   et pose un plan audio **sur `aud-…` (v1)** — le format de la séquence ne change
   pas (`montage.py:409-428`).
4. Retour dans ODIO : Cal raccourcit le refrain. L'enregistrement automatique
   (600 ms) change l'empreinte → la barre : « modifié depuis la v1 ».
5. **Publier la v2** (note « refrain court ») → même chemin → `el.published`
   (seq 812).
6. Le Montage, ouvert dans un autre onglet ou chez Margaux : au relevé suivant
   de la file, `ev_seq: 812` → `GET /api/elements/changes?since=811` → le plan
   A1 pointe la v1 de `ele-…`, la dernière est la v2 → **pastille « v2 » sur le
   plan**, et « 1 mise à jour » sur l'onglet de la séquence.
7. Clic sur la pastille : « v2 · refrain court · Cal, 18 h 52 · 2:31 (v1 :
   2:48) » — **Mettre à jour** · Versions ▸ · Ouvrir la source. Mettre à jour :
   `item` passe à la v2, `src_dur` suit, le plan se raccourcit à 2:31 et le dit ;
   enregistré par `POST /api/montage/projects/seq-…` (base `rev`) ; ctrl+Z le
   défait.
8. Export du montage : `montage.export` lit la v2 comme n'importe quel son
   (`media_of`) ; le MP4 garde dans `params.project` la timeline, donc la version
   employée (`montage.py:1501-1504`).
9. Asset, fiche de « Pluie » : la pile v1, v2 (qui, quand, note, durée), les
   usages (« Pub 30 s · A1 · v2 »), « Rouvrir la v1 dans ODIO » (une copie du
   projet tirée de son `source.json`).

#### B. Une musique née dans un nœud d'Idéation, promue élément

Aujourd'hui Idéation n'a pas de carte qui génère du son (§ 2.1). Proposition
(pour l'agent d'Idéation) : une carte **Générer musique**, faite comme `gen` et
`vgen` — des fils typés (le composeur ou une note donnent le style et les
paroles), et les travaux existants `music.yue` / `music.generate`.

1. Planche « Clip Belleville » : une carte Générer musique (YuE2), style et
   paroles branchés depuis un composeur ; deux prises → deux sons posés à
   droite de la carte, reliés (`out`), comme les images (`ideation/gen.js`,
   les liens `out`).
2. Clic droit sur la prise 2 → **Faire un élément** → `POST /api/elements {type:
   "music", source: {tool: "ideation", doc: "ide-…", part: {node: "a1"}},
   from_item: "aud-p2"}` : la prise devient la v1 (on pose `version` sur l'objet,
   rien n'est recopié). L'empreinte de la source = la recette de la carte.
3. Le nœud de la planche qui porte `aud-p2` est déjà un usage de la v1 : il
   montre ◆ v1.
4. Dans le Montage, l'élément glissé se pose sur la v1 (comme A.3).
5. Cal change les paroles sur la carte → « modifiée depuis la v1 » ; il relance
   (prise 3) → sur la prise 3 : **Publier comme v2** → `POST
   /api/elements/ele-…/versions {item: "aud-p3"}` → la pastille paraît dans le
   Montage (A.6).
6. Plus tard, **Ouvrir dans ODIO** (menu de l'élément) → `POST
   /api/elements/ele-…/move {tool: "music"}` : le serveur crée un projet ODIO
   (`POST /api/music/projects`, départ vide) avec une piste générative YuE2 dont
   la région porte la recette, la prise v2 et sa partition (`params.score`,
   rangée par `music.yue`, `yue.md` § 4) ; la source de l'élément devient ce
   projet ; la v1 et la v2 gardent `src: ideation`. La v3 se publiera depuis
   ODIO (A.2).

#### C. Une piste audio générative créée directement dans le Montage

1. Séquence « Pub 30 s », piste A3 : tirer une **région** de 00:12 à 00:42
   (notre choix : sur n'importe quelle piste son, pas une sorte de piste à part —
   le Montage n'a pas de grille de tempo ; ODIO, lui, a fait une piste
   générative, `musique.md` § 8). La région est un plan audio qui porte `gen`
   et pas encore de son (« à générer »), comme dans ODIO (`music.py:331-343`) :
   il faut l'accepter dans `montage.normalize` et l'écarter de l'export tant
   qu'il n'a pas de prise.
2. Le panneau du bas est celui d'ODIO, dessiné par **le même schéma**
   (`musique/generatif_modeles.json`, « la seule vérité », `musique.md` § 8) :
   modèle, tâche ; **durée = 30 s** (la région) ; tempo et tonalité : pas de
   grille dans le Montage → à écrire, ou laissés vides — le LM d'ACE-Step
   complète ce qui manque, les valeurs données l'emportent (`musique_generatif.md`
   § 2.3) ;
   **contexte** = le son de la séquence autour de la région, ± la marge, rendu
   par ffmpeg (un travail neuf `montage.mixdown`, voie `cpu`, le mixage que
   l'export fait déjà, `montage.py` `plan_mux`) → `src_audio`.
3. **Générer** (3 prises) → `POST /api/music/gen/generate` (`music_gen.py:585`,
   `music.gen.ace` voie `audio`, factice en `cpu`) ; la région joue la prise 1 ;
   Cal choisit la 2 : `item` = `aud-p2`.
4. La région n'est encore qu'un plan : un usage ordinaire de la prise, avec sa
   recette.
5. **Faire un élément** (clic droit) → `source: {tool: "montage", doc: "seq-…",
   part: {clip: "k3"}}`, `from_item: "aud-p2"` → v1. La région est à la fois la
   source et son usage « maison » (§ 2.6) : quand Cal publie la v2 (une prise 4),
   c'est la page du Montage qui publie, et elle pose la v2 dans son propre plan
   dans le même geste (le serveur, lui, ne réécrit rien : § 2.7) ; les autres
   séquences qui l'ont posée voient la pastille.
6. **Ouvrir dans ODIO** : comme B.6 — le projet ODIO reçoit la région, le
   contexte rendu et la prise ; la source déménage.

---

## 3. Apps et Studio

### 3.1 La découpe

| | **Apps** | **Studio** |
|---|---|---|
| pour | faire et éditer un média, seul, vite | enchaîner les outils, des éléments liés et versionnés |
| outils | **Image**, **Vidéo**, **Upscale**, **Musique** (simple), **3D** (simple) | **ODIO** complet, **Montage**, **Idéation**, **Character Factory** complet, **Movie Analysis** — et les Apps |
| bibliothèque | Asset : ses objets, dossiers, favoris, téléchargement, corbeille | la même, plus les éléments, leurs versions et leurs usages |
| ce qui circule | des objets (on réutilise une image comme référence, on agrandit une vidéo) | des éléments : une source vivante, des versions, des pastilles |

### 3.2 Chaque app : ce qu'elle garde, ce qu'elle retire

| app | page | garde (de l'outil actuel) | retire (reste en Studio) |
|---|---|---|---|
| **Image** | `image/` | Z-Image, Qwen-Image 2.1, Krea 2 ; édition ; caméra, objectif, pellicule ; le fil (aimer, réutiliser, recréer, télécharger) ; références : images et planches | « Faire un élément » d'une création (la promotion), « Envoyer au Montage » (`image.js:1033`, `1059`) |
| **Vidéo** | `movie/` | texte → vidéo, image → vidéo, références → vidéo (H3) ; le fil | le banc A/B (`CLAUDE.md`, table des outils) ; « Envoyer au Montage » (`movie.js:632`) |
| **Upscale** | `upscale/` | images et vidéos (SeedVR2) | « Envoyer au montage » (`upscale.js:625`, `667`, `681`) |
| **Musique** | neuve (`musique-simple/`, notre proposition) | style (pastilles et texte), paroles par sections, durée, graine, prises ; **référence son** : *Reprendre* (cover) et *S'en inspirer* (§ 3.3) ; le fil | tout ODIO : arrangement, nodal, console, instruments, MIDI, stems, régions |
| **3D** | `objet/` (Object Creator) | une image → un mesh (TRELLIS.2 « image unique », la seule entrée documentée : `objet.py:10-12`) pour un objet ; **un personnage en mesh statique** : le même chemin sur une image de plein pied, sans A-pose, vues, rig ni animation | la chaîne de Character Factory (A-pose, vues, contrôle, mesh multi-vues, rig SOMA) |

Rendre un personnage par TRELLIS.2 depuis une seule image : **qualité non
documentée ici**, à essayer. La chaîne de CF, elle, passe par l'A-pose et des
vues contrôlées à ±5° avant son mesh multi-vues (`Character_Factory/CLAUDE.md`).

### 3.3 Musique simple : ce que YuE2 prend vraiment

| entrée | YuE2 | source |
|---|---|---|
| style (`tags`) : langue, genre, voix, instruments, tempo, caractère | oui, texte libre | `nodes_yue2.py:19,51` ; `generation-and-covers.md:17` (DGX2 `~/YuE`, `92a73cc`) |
| paroles par sections `[Verse]`, `[Chorus]`… ; vides = instrumental | oui | `docs/generation.md:7` ; `yue.md` § 4 |
| plan : `full` (mélodie + accords), `melody`, `off` | oui | `nodes_yue2.py:22` |
| partition ABC écrite ou retouchée | oui (`abc`) | `nodes_yue2.py:53` ; `musique_generatif.md` § 1.4 |
| graine ; durée **maximale** (0,04 à 900 s ; la chanson peut finir avant) | oui | `nodes_yue2.py:54,56` |
| tempo en nombre | **non** : dans la partition (`Q:`) et redit dans le style | `generation-and-covers.md:17` |
| **son de référence** (style, voix, « ICL ») | **non** : « There is no request field for `reference_audio` … or a reference singer » | `generation-and-covers.md:17`, lu sur DGX2 le 29/09 ; `yue.md` § 4 |
| **reprise d'un enregistrement (cover)** | **oui, par la partition** : SheetSage2 transcrit la mélodie de l'enregistrement (ABC, accords retirés), YuE2 la rechante en `melody` dans un autre style ; « YuE2 has no direct audio-upload argument » | `~/YuE/docs/covers.md` § 1-3 ; `generation-and-covers.md:121` ; **déjà câblé** : champ `ref` de `music.yue` (`yue.md` § 4, workflow 02 de Cal) |
| licence | code Apache 2.0 ; **poids CC BY-NC 4.0** | `~/YuE/README.md:212-214` ; `~/YuE/MODEL_LICENSE` |

Donc, pour les deux gestes que Cal demande :

- **Reprendre** (cover) : YuE2, tel qu'il est câblé — le son de référence passe
  par SheetSage2 ; la mélodie reste, le style change ; les paroles s'écrivent
  (ou se reprennent) à part. `covers.md` recommande `melody` pour changer de
  style.
- **S'en inspirer** (garder le style d'un son sans sa mélodie) : **YuE2 ne le
  fait pas.** Trois voies documentées, aucune prête :
  1. **ACE-Step 1.5** : `reference_audio`, prévu pour le transfert de style et
     la continuation (`INFERENCE.md:376`), ou `cover` à `audio_cover_strength` 0,2 pour un
     transfert de style (`INFERENCE.md:381`) — par le serveur d'API du dépôt, pas
     câblé ; par ComfyUI, `ReferenceTimbreAudio` est écrit, jamais rendu
     (`musique_generatif.md` § 2.1, § 6.5) ;
  2. **YuE v1** (branche `YuE-v1`) : l'apprentissage en contexte par un son
     (`--use_audio_prompt`, ou `--use_dual_tracks_prompt` voix + accompagnement,
     `--prompt_start_time`/`--prompt_end_time`), avec **un autre point de
     contrôle** (`m-a-p/YuE-s1-7B-anneal-en-icl`), environ 30 s de son
     conseillées, Apache 2.0 ([README de la branche YuE-v1](https://github.com/multimodal-art-projection/YuE/tree/YuE-v1)) ;
     **non installé** (relevé DGX2 du 29/09 : seuls `YuE2-3B` et `YuE2-Vae` dans
     le cache Hugging Face) ;
  3. l'encodeur communautaire audio → jetons de YuE2 (CC BY-NC, jamais essayé,
     non installé : `musique_generatif.md` § 1.8).

L'app montre les deux boutons ; *S'en inspirer* reste désactivé et dit
pourquoi tant qu'une voie n'est pas câblée (règle 7 du thème, `CLAUDE.md`).

### 3.4 D'une création d'app à un élément du Studio

- Toute création d'app est un **objet avec sa recette** (`prompt`, `params`,
  `origin.tool` : `ARCHITECTURE.md` § 2).
- En Studio, **Faire un élément** sur cet objet → un élément dont la source est
  la recette (`source: {tool: "image", doc: <l'objet>}`) et dont **la v1 est
  l'objet lui-même** (`from_item` : on pose `version` dessus, rien n'est
  recopié). Tout endroit qui le posait déjà devient un usage de la v1.
- Nouvelle version : **Recréer** dans l'app (les routes `redo` existent), puis
  **Publier comme v2** sur le résultat choisi.
- Une chanson de l'app Musique : **Ouvrir dans ODIO** crée un projet avec le son
  sur une piste et, pour YuE2, une région qui porte sa partition (`params.score`)
  — la source déménage (§ 2.6).
- Un objet 3D : sa pile de meshes devient ses versions (§ 2.12).
- Un compte qui repasse du Studio aux Apps : ses éléments restent des objets
  lisibles (leur dernière version) ; rien n'est perdu, les pages Studio se
  ferment.

### 3.5 La bibliothèque commune

Une seule bibliothèque, un seul `item.json` par objet, les mêmes règles de
propriétaire et de visibilité (`auth.py:307-322`) ; la copie publiée sur R2
suivra la même forme (`cloudflare.md` § 4). Ce qui change :

- Asset range les versions **sous leur élément**, en pile (la version la plus
  récente devant, le nombre de versions sur la vignette) ; elles ne paraissent
  pas seules à la racine ni dans les sélecteurs ; `library.query` gagne un
  filtre (les objets `version.of` écartés) que les pages demandent — les autres
  lectures ne changent pas (`library.py:565-594`).
- Un élément se glisse comme un objet (`dragItem`, `ITEM_MIME`) : la page qui le
  reçoit pose sa dernière version. Un seul endroit pour presque tous les
  dépôts : `dropZone` relit l'objet lâché (`commun/shell.js:205-208`) ; s'il est un
  élément vivant et que la zone attend sa sorte (`kinds`), elle rend sa
  dernière version (une accroche ; de même dans `pick`, `shell.js:500`). La
  timeline du Montage lit le dépôt elle-même (`montage/timeline.js:322`) : elle
  reçoit la même règle à l'étape 4.
- En Apps, la fiche d'un élément montre sa dernière version, sans pile ni
  usages ; « Faire un élément » n'y est pas.

### 3.6 La porte : compte Apps, compte Studio

Aujourd'hui : un compte a un **rôle** `admin` ou `ami` (`auth.py:859-866`), les
routes d'admin se jugent dans `_admin_only` (`auth.py:461-464`, `ADMIN_ROUTES`
l. 430), les quotas par personne (`auth.py:94-101`, `823-833`).

Proposition (notre choix) : un **droit à part du rôle**, `access: "apps" |
"studio"` dans `auth.json` (un admin a toujours le Studio). Le rôle dit qui
administre ; `access` dit quels outils on ouvre. Jugé au même endroit que le
reste, sur la DGX (« Le rôle se décide dans le Worker, les droits sur les
objets sur les DGX », `cloudflare.md` § 3.3) :

- `_studio_only(req)` dans `auth.gate`, juste après `_admin_only`
  (`auth.py:515`) : une table fermée des préfixes Studio — `/api/montage/`,
  `/api/music/projects`, `/api/music/gen/`, `/api/music/midi`,
  `/api/music/stems`, `/api/ideation/`, `/api/analyse/`, `/api/elements/`,
  `/character/` — 403 « réservé au Studio » ;
- **`POST /api/jobs` accepte aujourd'hui n'importe quelle sorte de travail**
  (`core_api.py:377-383`) : la même table y juge `kind` (`montage.export`,
  `ideation.export`, `music.gen.*`, `music.midi*`, `music.stems`,
  `analyse.run`, `element.*`), sinon une app pourrait lancer un travail Studio
  par la route générique ;
- `GET /api/auth/me` rend `access` ; les pages Studio servies à un compte Apps
  montrent la porte « réservé au Studio » (comme `commun/porte.js` le fait pour
  la connexion) ;
- Admin : le choix Apps / Studio sur la fiche d'une personne, à côté des
  quotas ; une **demande de Studio** suit le chemin des demandes de pseudo
  (accepter / refuser, `auth.py:719-742`) ;
- porte `access` (Cloudflare) : rien de neuf dans le Worker ; `access` est lu
  dans `auth.json` pour l'e-mail signé (`auth.py:1242-1272`).

### 3.7 L'accueil du portail

`accueil.js` met en tête Image, Vidéo, Character Factory (`accueil.js:7`) et
tire les cartes de la seule liste `TOOLS` (`commun/shell.js:21-32`).
Proposition :

- `TOOLS` gagne `tier: "app" | "studio"` et les deux apps neuves (Musique, 3D —
  Object Creator devient l'app 3D) ; ODIO garde sa carte Studio ;
- l'accueil : Asset en tête (la bibliothèque, commune) ; une rangée **Apps**
  (Image, Vidéo, Upscale, Musique, 3D) ; une rangée **Studio** (ODIO, Montage,
  Idéation, Character Factory, Movie Analysis) ;
- un compte Apps voit la rangée Studio grisée : chaque carte dit pourquoi et
  mène à « demander le Studio » (règle 7) ;
- en Studio, un encart « à mettre à jour » : les éléments dont une version plus
  récente attend dans vos séquences, projets et planches (`GET
  /api/elements/uses` agrégé).

---

## 4. Le plan d'implantation

Chaque étape se livre seule, se vérifie seule (`tools/check.py` et un pilote
Playwright sur un portail d'essai de DGX2, `ARCHITECTURE.md` § 6), et dit ses
fichiers. **Un fichier touché par un autre chantier ne reçoit que des accroches
marquées `# éléments :` / `// éléments :`** (la règle de `REPRISE.md`). En cours
le 29/09 : un agent dans `musique/`, un dans `ideation/`, un sur les finitions
transverses (Asset pour `sequence` et `midi`, `commun/fil.js`, le thème clair,
`ARCHITECTURE.md`).

| # | étape | fichiers | vérifier | en parallèle de |
|---|---|---|---|---|
| **1** | **Le socle des éléments** (serveur seul) : schéma, faire un élément (`from_item`), ranger une version (`/versions`), retirer, l'index des usages dérivé des documents, le journal, `changes?since`, le contrôle de cycle, le garde-fou de la corbeille | **neufs** `server/core/elements.py`, `server/tools/elements.py` ; accroches dans `server/core/library.py` (`trash` → garde-fou ; `ref_paths` → dernière version ; `ELEMENT_TYPES` ; filtre `version.of` de `query`) et dans `server/tools/core_api.py` (`el_create` passe la main quand il y a `source` ou `from_item`) | selftest : un son d'app promu (v1 sans copie), une v2 rangée, un usage trouvé dans une fausse séquence, un faux projet ODIO, une fausse planche ; un cycle refusé ; une version utilisée refusée à la corbeille ; le journal relu après `seq` | tout le monde (aucune page) |
| **2** | **Les sources serveur** : adaptateurs Montage (empreinte, `montage.run_export`), ODIO (empreinte, `rev` vérifiée), Idéation (cadre, `ideation.run_export`), CF (import en travail, planche = version, `source.json`), recette d'app ; le travail `element.publish` | **neuf** `server/tools/elements_sources.py` (importe les outils, ne les modifie pas) | selftest, moteurs factices : une séquence publiée → un MP4 v1 ; un cadre → un PNG ; un personnage du faux studio (`character.py` selftest) → planche v1 puis v2 ; une `rev` périmée → 409 | 1 fini |
| **3** | **Le signal et le module commun** : `ev_seq` dans `GET /api/jobs`, le module des pages (pastille, liste des versions, « Publier », « modifiée depuis »), ses styles (jetons seulement) | accroche d'une ligne dans `server/tools/core_api.py` (`jobs_list`) ; **neufs** `commun/elements.js`, `commun/elements.css` ; accroches marquées dans `commun/shell.js` (`dropZone`, `pick` : un élément déposé donne sa dernière version, § 3.5) | une page d'essai du contrôle voit l'événement moins de 6 s après une publication faite par l'API | 2 |
| **4** | **Montage, premier consommateur** : pastille sur le plan et sur l'onglet, Mettre à jour / Versions ▸ / Ouvrir la source, tout mettre à jour, glisser un élément = sa dernière version, une séquence posée dans une autre (sa version MP4), « Remplacer par une composition ODIO » (un clip son → un projet ODIO + un élément) | `montage/*.js` (aucun agent n'y est) | Playwright : publier une v2 par l'API → pastille → mettre à jour → ctrl+Z → l'export décodé a le son de la v2 | 5, 6 |
| **5** | **ODIO, première source** : Faire un élément, Publier (le rendu de la page), « modifié depuis la vN », la pile des versions, Rouvrir une version | **neuf** `musique/element.js` ; accroches dans `musique/musique.js` (barre, à côté d'Exporter) — **à l'agent d'ODIO**, ou après lui ; `music.py` : le contrôle de propriétaire (§ 2.12) | parcours A de bout en bout | 4 |
| **6** | **Asset** : la fiche d'un élément (pile, usages, source, retirer, déménager), la racine qui range les versions sous leur élément ; `cf_refresh` → « Publier une version » en Studio | `asset/*.js`, `server/tools/asset.py` (`view`) — **après l'agent des finitions** | Playwright : pile, usages, une version utilisée refusée à la corbeille | 4, 5 |
| **7** | **Idéation** : pastille sur les nœuds, Faire un élément sur un résultat, la carte Générer musique | `ideation/*.js`, `server/tools/ideation.py` — **à l'agent d'Idéation** | parcours B | 4-6 |
| **8** | **La piste générative du Montage** : région `gen` sur une piste son, le panneau tiré du schéma d'ODIO, le travail `montage.mixdown` pour le contexte | `montage/*.js`, `server/tools/montage.py` (`normalize`, export sans région vide, `mixdown`) ; lecture seule de `musique/generatif_modeles.json` | parcours C (moteurs factices) | 5-7 |
| **9** | **La porte Apps / Studio** : `access`, `_studio_only`, la table des sortes de travaux, l'accueil en deux rangées, la demande de Studio | `server/core/auth.py`, `server/tools/core_api.py` (`jobs_submit`), `server/tools/admin.py`, `admin/`, `commun/shell.js` (`TOOLS`), `accueil.js`, `index.html` — transverse, **après les finitions** | contrôle de la porte (`compte.py`, `porte_publique.py`) : un compte Apps reçoit 403 sur chaque préfixe Studio et sur `POST /api/jobs {kind: "montage.export"}` | 4-8 |
| **10** | **L'app Musique** : style, paroles, durée, prises, Reprendre (YuE2 `ref`), S'en inspirer (désactivé, dit pourquoi) | **neuf** `musique-simple/` ; aucune route neuve (`/api/music/yue/*`, `/api/music/generate`) | Playwright, moteur factice : une chanson, une reprise | 1-9 |
| **11** | **L'app 3D** : Object Creator allégé, le mode « personnage, mesh statique », la pile de meshes lue comme versions | `objet/`, `server/tools/objet.py` | Playwright, moteur factice | 1-10 |
| 12 | Plus tard : le rendu d'ODIO sans page (Chromium sans affichage, DGX2, `cpu`, priorité basse) ; le flux SSE `GET /api/elements/stream` ; « S'en inspirer » branché | `server/tools/elements_sources.py`, `tools/` | — | — |

Les deux premières étapes ne touchent **aucune page** et **aucun fichier des
chantiers en cours**, hors les accroches marquées de `library.py` et de
`core_api.py` ; la troisième ajoute une ligne à `core_api.py` et deux accroches à `commun/shell.js`
(fichier commun : à poser d'accord avec l'agent des finitions).

---

## 5. Les questions à Cal

**Tranchées le 30/09** : Cal, « on avance », sans répondre point par point ;
ses recommandations s'appliquent — 1 **oui** (un personnage versionné reçoit
une version de plus, rien n'est réécrit sur place : codé, `asset._cf_new_version`) ;
2 **oui aux deux** (à brancher avec les adaptateurs de l'étape 2) ; 3 **à la
main seulement** (codé : la pastille, un clic) ; 4 **le propriétaire et Cal**
(codé : `library.check_write` sur l'élément) ; 5 **Apps par défaut**, le
Studio sur le geste de Cal (étape 9) ; 6 **ACE-Step 1.5** pour « s'en
inspirer », le bouton grisé et disant pourquoi d'ici là (étape 10).

1. **Personnages de Character Factory** : en Studio, « remettre à jour » un
   personnage importé fait une **nouvelle version** (les plans et planches qui
   l'utilisent voient la pastille) au lieu de réécrire la planche sur place
   (`asset.py:495-551`) ? **Recommandé : oui** — c'est ta logique (historique
   gardé, mise à jour choisie).
2. **La première pose calcule** (« s'il est appelé à un endroit comme élément,
   il est alors calculé ») : poser un élément sans version lance la v1 d'office ;
   poser un élément dont la source a changé depuis la vN pose la vN et propose
   « publier la vN+1 ». **Recommandé : oui aux deux** — on ne publie jamais sans
   ton geste, sauf la toute première fois.
3. **Mettre à jour : toujours à la main** (la pastille, un clic), ou une option
   « suivre la dernière version » par usage (Nuke Studio a les deux : un plan
   lié suit, un plan non lié garde sa version [F15]) ? **Recommandé : à la main
   seulement** pour commencer, comme Figma, Houdini et ShotGrid (§ 1.3, point 4) ;
   l'option se rajoute sans rien défaire.
4. **Qui publie une nouvelle version** : le propriétaire de l'élément (et toi),
   ou quiconque peut ouvrir la source ? **Recommandé : le propriétaire et toi** —
   la règle des objets d'aujourd'hui (`auth.py:318-322`).
5. **Un compte neuf** : Apps par défaut, le Studio sur ton geste dans Admin (ou
   sur sa demande) ? **Recommandé : oui.**
6. **« S'en inspirer » d'un son** dans l'app Musique, que YuE2 ne sait pas
   faire : câbler le serveur d'API d'ACE-Step 1.5 — déjà installé sur les deux
   DGX avec ses modèles sft et turbo ; `reference_audio` et `cover` (à 0,2) y
   passent avec tous les modèles (`musique_generatif.md` § 2.1-2.3) —, ou YuE v1
   et son point de contrôle ICL (7B, à télécharger) ? **Recommandé : ACE-Step**,
   dont le câblage sert aussi ODIO (et, avec le modèle base de 4,79 Go, la piste
   seule et « compléter » : § 2.2 de la même étude) ; jusque-là, le bouton reste
   grisé et dit pourquoi.

---

## Sources

- Code du portail, lu le 29/09/2026 sur le PC (`C:\SHOWRUNNER_TOOLS`) :
  `server/core/library.py`, `auth.py`, `jobs.py` ; `server/tools/asset.py`,
  `core_api.py`, `montage.py`, `music.py`, `music_gen.py`, `ideation.py`,
  `ideation_collab.py`, `character.py`, `objet.py` ; `musique/musique.js` ;
  `commun/shell.js` ; `accueil.js` ; `Character_Factory/factory/project.py`.
- Études du portail : `ARCHITECTURE.md`, `REPRISE.md`, `docs/etudes/asset.md`,
  `montage.md`, `musique.md`, `musique_generatif.md`, `yue.md`, `ideation.md`,
  `cloudflare.md`, `orchestration.md`.
- DGX2, lu le 29/09 (rien lancé) : `~/YuE` (`92a73cc`, 10/09/2026) —
  `docs/covers.md`, `skills/yue2-music/references/generation-and-covers.md`
  (l. 10-24, 115-145), `README.md` (l. 1, 210-216), `MODEL_LICENSE` ; cache
  Hugging Face (`models--m-a-p--YuE2-3B`, `models--m-a-p--YuE2-Vae`).
- YuE v1 : https://github.com/multimodal-art-projection/YuE/tree/YuE-v1 (lu le 29/09/2026).
- État de l'art : § 1.
