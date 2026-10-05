# Le mode « showrunner » — « Commencer un projet » (05/10/2026)

Demande de Cal, mot pour mot (05/10) :

> « on va avancer un peu aussi sur le mode "showrunner". On enlève le "répondre à
> un brief" et on remplace par "commencer un projet" ; on a donc notre Idéation qui
> se met en place, et on a le pop-up avec un mode "ingest" où on peut drag and drop
> tous les éléments que le user a : pdf, image, vidéo, texte ; il faut un maximum de
> possibilités pour le user et de flexibilité sur ce point d'entrée. Il faut qu'il
> puisse absolument donner tout ce dont il dispose sans avoir à faire des exports ou
> adapter des formats : c'est à nous d'organiser tout cela. Ce mode crée
> automatiquement une TEAM, donc on peut rajouter des gens qui existent déjà, et il
> crée un workspace Général, et tout travail dans ce cadre. Le user rentre un brief
> qui peut être aussi un drag and drop d'un fichier texte ou pdf etc., ou il peut
> rédiger dans le champ de texte (on ne fait pas plein de cadres spécifiques : comme
> pour la génération d'image, ou une interface comme Claude : on drag and drop des
> assets dans le champ de saisie de texte et ils se mettent en vignettes au-dessus).
> Il peut nommer ou renommer le workflow, mais par défaut on garde Général. On doit
> faire une énorme analyse de tous les documents et pouvoir les organiser déjà dans
> notre canvas avec l'aide de notre agent… Tous ces assets apparaissent bien sûr dans
> le panneau Asset. »

**Statut** : voir « Fait le 05/10 » en fin de fichier.

| | |
|---|---|
| l'accueil | `accueil.js` : le seul bouton orange du Studio devient « Commencer un projet » → `ideation/?projet=nouveau` |
| la fenêtre | `ideation/projet.js`, `ideation/projet.css` (chargée par le module) ; `ideation/ideation.js` l'ouvre au départ sur `?projet=nouveau` |
| le socle | `commun/shell.js` : `uploadFile(…, {onprogress})` (la progression d'un envoi), `entrerEspace(id)` (passer l'onglet dans un Workspace sans recharger la page) |
| le serveur | `server/tools/equipes.py` : `GET /api/equipes/personnes` (qui l'on peut mettre dans la Team), `create_why` dans `GET /api/equipes` ; `server/core/espaces.py` : `create_team_why` (une seule phrase pour le refus) ; `server/tools/ideation.py` : `media_kinds` dans `/api/ideation/meta` |

## 1. Ce que font les autres

Le réseau de la session refuse `higgsfield.ai` et la plupart des articles (le proxy
répond 403) : ce qui suit sur Higgsfield vient des **extraits** que rend la recherche
web (05/10), entre guillemets, à relire sur les pages quand le réseau le permet. La
page d'aide de Claude, elle, a été lue en entier.

### 1.1 Higgsfield — Supercomputer

- Annoncé le **14/05/2026** comme « Cloud-Native Agent Stack » ; Supercomputer 2.0 le
  25/06/2026, agent marketing « with enterprise trust, safety, and permissioning »
  [H5][H6] (extraits).
- Le parcours : « Type a plain-language brief » ; l'agent « picks the right models and
  presets and shows the credit cost upfront for you to approve » ; « The finished
  generation lands in a project » [H1] (extrait).
- **Ce qu'on lui donne** : « A user can attach a file, image, video, document, or URL to
  provide additional context » [H1] (extrait). Le brief tient en une phrase : « "Make a
  TikTok for my sneakers" is a complete brief » [H3] (extrait).
- **Le projet** : « Projects is a shared workspace in Supercomputer that keeps context
  across your work. Store documents in the project; uploaded images and videos become
  named Elements » [H1][H4] (extraits) ; « you can share a project with others;
  instructions are shared, but each person's chats and memory stay private. You can add
  teammates by username or share an invite link » ; projet privé, public ou ouvert
  [H4] (extrait).
- « Brief once. It remembers the rest » : le brief reste dans le contexte du projet,
  l'agent passe la sortie d'une étape à la suivante « without you downloading or
  re-uploading anything » [H2][H3] (extraits).

Ce qu'on en retient : chez Higgsfield, **le projet est l'unité** (contexte, membres par
pseudo, documents et Elements) et le brief est **une phrase dans un chat**. Notre
pendant existe déjà : la Team (membres par pseudo, liens), son Workspace (ce qu'on y
crée lui appartient), les éléments. Ce qui manquait : une porte d'entrée qui crée tout
d'un geste et y range ce qu'on apporte.

### 1.2 Claude — le champ qui prend les fichiers

Page d'aide « Uploading files to Claude » (mise à jour le 23/07/2026, lue) [C1] :

- trois gestes : le bouton « + » (« Add files or photos »), « drag and drop the files
  directly into the chat window », coller une image du presse-papier ;
- par conversation : 500 Mo par fichier, 20 fichiers, images de 8000 × 8000 px au plus,
  PDF de 1000 pages ; dans un projet : 30 Mo par fichier, sans plafond de nombre ;
- documents : PDF, DOCX, CSV, TXT, HTML, ODT, RTF, EPUB, JSON, XLSX ; images : JPEG,
  PNG, GIF, WebP ; un PDF de 100 pages au plus est lu « both text and visual elements ».

Les pièces jointes s'affichent **dans la zone de saisie, en cartes au-dessus du texte**,
retirables une à une : c'est ce que Cal décrit ; la page d'aide ne le dit pas.

### 1.3 La génération d'image (Midjourney)

La barre « Imagine » de Midjourney a **des cases** (Image Prompt, Style Reference, Omni
Reference) où l'on glisse une image ; on la retire au survol par un « X » [M1]
(extrait). Cal ne veut pas de cases : **un seul champ**, comme Claude ; c'est à nous de
trier.

### 1.4 Le navigateur : dossiers et beaucoup de fichiers

- Un dossier lâché se lit par `DataTransferItem.webkitGetAsEntry()`, **pendant**
  l'événement `drop` (hors de lui, l'objet n'est plus lisible et la méthode rend
  `null`) [W1] (extrait).
- `FileSystemDirectoryReader.readEntries()` : « In Chromium-based browsers,
  readEntries() will only return the first 100 » entrées ; il faut le rappeler jusqu'à
  un tableau vide [W2] (extrait).
- La progression d'un envoi n'existe que par `XMLHttpRequest.upload.onprogress`
  (`fetch` ne la donne pas) : `uploadFile` passe par lui quand on lui demande la
  progression.

## 2. Le parcours

1. **Accueil** : le bouton orange du Studio, « Commencer un projet » (un compte Apps
   garde « Créer une image »). Il ouvre `ideation/?projet=nouveau` dans le même onglet.
2. **Idéation** s'ouvre sans planche (la planche naîtra dans le Workspace neuf : rien
   ne se range ailleurs avant le départ) ; par-dessus, la fenêtre **« Commencer un
   projet »**.
3. **Le champ** (façon Claude) : une zone de texte qui grandit ; on y écrit le brief ;
   on y lâche des fichiers — et **sur toute la fenêtre** (un voile le dit), on colle
   des fichiers ou des images, on prend le trombone (fichiers) ou le dossier, on glisse
   depuis le panneau Asset. Chaque fichier devient une **vignette au-dessus du champ**
   : son aperçu (une image), sa sorte, son nom, sa taille, sa progression d'envoi ;
   un « × » le retire. Un dossier entier entre avec tout son contenu (les sous-dossiers
   aussi ; ses fichiers rangés dans un dossier d'Asset à son nom). Mille fichiers ne
   gèlent pas la page : les vignettes se posent par paquets d'une image d'écran, les
   aperçus ne se décodent qu'à l'approche (`loading=lazy`).
4. **Le brief** : ce qu'on tape, et/ou un document déposé. Un document porte une case
   « c'est le brief » ; **détecté** quand il est le seul document et que le champ est
   vide (« brief · détecté »). Un texte (`.txt`, `.md`, `.fountain`, `.srt`…) se lit
   dans la page ; un PDF, un DOCX : après son rangement, par `GET
   /api/library/<id>/texte` (l'agent DOCUMENTS).
5. **Le nom** du projet (= le nom de la **Team**, 40 signes) et celui du **Workspace**
   (« Général » par défaut, modifiable). Sans nom tapé : la première ligne du brief,
   sinon le nom du document brief, sinon « Projet du 05/10 ».
6. **Avec qui** : des personnes qui **existent déjà** (une liste à cocher, filtrée en
   tapant) ; jamais un pseudo neuf (Cal : « des gens qui existent déjà »).
7. **« Commencer »** (le seul orange de l'écran) :
   1. la Team (`POST /api/equipes`) — elle naît avec son Workspace « Général »
      (`espaces.create_team`) ; un autre nom : `POST /api/espaces/<e> {name}` ;
   2. les personnes : `POST /api/equipes/<t>/membres {pseudo, role: member}` (un échec
      est dit, le reste continue) ;
   3. l'onglet passe dans ce Workspace **sans recharger la page** (les fichiers sont en
      mémoire) : `entrerEspace(e)` (`POST /api/espaces/courant`, l'onglet le prend,
      `?e=` dans l'adresse, l'en-tête, le panneau Asset et la file se relisent) ;
   4. la planche, dans ce Workspace (`POST /api/ideation/boards`), ouverte ;
   5. les fichiers : `uploadFile` dans ce Workspace, **trois à la fois**, la progression
      sur chaque vignette, un refus n'arrête pas les autres (le fichier reste listé, en
      échec, avec la raison du portail) ; ce qui vient d'Asset est **rapatrié** (une
      copie dans le Workspace neuf : `POST /api/espaces/<e>/rapatrier`) ; un brief tapé
      est rangé aussi, en document `brief.md` ;
   6. **la mise en page de départ** : des cadres côte à côte — Brief, Documents,
      Images, Vidéos, Sons, Autres (ceux qui ont quelque chose) ; le brief en note dans
      son cadre ; chaque cadre en grille régulière ; un seul pas d'annulation ; la vue
      montre tout ;
   7. l'analyse de l'agent, la planche enregistrée d'abord (il la lit au portail) :
      `app.agent.open()` puis `app.agent.send(brief, { pieces: les ids, intent: 'ingest' })` — le
      brief en tête des pièces, puis les documents, les images, les vidéos, les sons ; 24 pièces
      et 4 000 signes au plus (les bornes de `server/tools/ideation_agent.py`, au-delà : 400 ; la
      suite du brief est nommée, elle est parmi les pièces). S'il n'est pas là : rien, ni ligne ni
      erreur — la planche reste rangée par la mise en page de départ.
      **Depuis le 06/10** (le premier essai réel de Cal, `agent_showrunner.md` § 7) : toutes les pièces partent
      (400 au plus : la réception les compte toutes), celles qui sont le brief sont nommées (`brief`) ; l'agent
      accuse réception, dit ce qu'il comprend et ce qui ne colle pas, pose ses questions dans son panneau, et ne
      pose RIEN sur la planche avant les réponses. La sorte d'un fichier est celle du portail, qui lit son contenu :
      un `.webm` ou un `.mp4` sans image est un son (il allait dans « Vidéos »).
8. Tout est dans **Asset** (le panneau se relit dans le Workspace neuf).

## 3. Les droits (lus dans `core/espaces.py` et `server/tools/equipes.py`)

- **Créer une Team** : Cal (admin du portail), ou un compte qui a le **Studio sur son
  compte** (`access: studio`), sauf un compte entré comme guest (`perso: false`) et un
  invité de planche (`create_team`). Un compte Apps qui a le Studio **par une Team**
  (il ouvre Idéation dans le Workspace de cette Team) **ne crée pas de Team**. La phrase
  du refus vient d'un seul endroit, `espaces.create_team_why(u)`, que `GET
  /api/equipes` rend (`can_create`, `create_why`) : la fenêtre le dit **avant qu'on ne
  remplisse**, avec « Demander le Studio » (`POST /api/auth/studio`, que Cal voit dans
  Admin) ou la date de la demande qui attend.
- **Voir les personnes** : il n'y avait pas d'annuaire hors d'Admin (`/api/admin/state`,
  Cal seul). `GET /api/equipes/personnes` rend : à Cal, **tous les comptes actifs** ; à
  un autre, **les membres des Teams où il est** (propriétaire, admin ou membre — pas
  guest) : il ne voit personne qu'il ne voyait déjà dans ses Teams. Jamais un invité de
  planche, jamais soi-même.
- **Mettre quelqu'un dans la Team** : le propriétaire (celui qui crée) le peut
  (`add_member`, rôle `member`) ; la Team a l'offre de son créateur (Studio).
- **Écrire dans le Workspace neuf** : le propriétaire de la Team y est admin (la
  matrice) ; ses fichiers, sa planche, les copies rapatriées y sont à lui.

## 4. Les décisions

1. **Rien n'est envoyé avant « Commencer »** : le Workspace n'existe pas encore, et un
   envoi dans le Workspace d'avant laisserait des doubles. Les fichiers attendent en
   mémoire de la page (ce sont des `File` : le navigateur ne les lit qu'à l'envoi).
2. **Un seul champ** (Cal) ; les sortes se trient à l'arrivée : la sorte vient du
   portail (`item.kind`) après le rangement ; avant, de l'extension et du type MIME
   (pour la vignette seulement).
3. **Trois envois à la fois**, le reste en file : assez pour remplir le lien, pas assez
   pour affamer le portail (un envoi de 2 Go ne bloque pas les petits).
4. **Les cadres** : un seul `app.mutate` (un pas d'annulation pour toute la mise en
   page) ; les nœuds sont ceux de la planche (`frame`, `note`, `media`) ; au-delà de la
   limite des planches (`MAX_NODES` = 3000) le reste est rangé dans Asset, pas posé,
   et la fenêtre le dit.
5. **Les documents sur la planche** : un objet `media` de sorte `document` si le portail
   le connaît (`media_kinds` de `/api/ideation/meta`, qui suit `MEDIA_KINDS` du serveur)
   ; sinon une note qui le nomme (il est dans Asset).
6. **Les personnes ajoutées sont membres** (pas guests) : un guest demande les gardes
   du calcul et de la bibliothèque (409 tant qu'elles manquent) et se règle dans Admin.
7. **La fenêtre se ferme seule** quand tout est passé ; un échec la garde ouverte sur
   la liste, raison par raison, avec « Voir la planche ».

## 5. Les contrats avec les deux autres agents

- **DOCUMENTS** (serveur fusionné) : `uploadFile(file)` accepte tout fichier ; une sorte
  `document` (`doc: {format, label, pages, words, has_text, title}`), une vignette, `GET
  /api/library/<id>/texte` (`{text, why…}`) : le texte d'un brief PDF ou DOCX en vient. Un 415
  ne dit plus que « son contenu ne correspond pas à son nom » (un `.mp4` qui n'en est pas un).
  Sur la planche : un `media` de sorte `document` dès que `media_kinds` le contient (la page
  d'Idéation des documents) ; d'ici là, une note qui le nomme (« — document PDF : dans Asset »).
  Rien à changer ici ce jour-là.
- **AGENT** : `app.agent = { open(), send(texte, { pieces, intent }), busy() }`, posé par
  `ideation/agent.js` ; `intent: 'ingest'` lance l'analyse d'entrée. La fenêtre passe aussi
  `items` (le même tableau : le nom de `agent_showrunner.md` § 5) et l'attend trois secondes
  au plus (les modules se chargent après la planche).

## Fait le 05/10

- La fenêtre, le départ, les cadres (commit 4595b96) ; puis, de bout en bout : `ideation/pilote_projet.mjs`
  (un portail d'essai ; sept parcours, sombre et clair, étroit) et le départ joué par l'API dans le
  selftest d'`equipes.py` (`_depart` : un ami Studio, la Team, le Workspace renommé, une personne,
  la planche, un nom accentué, des documents, un objet rapatrié, le texte du brief, ce que voient un
  membre et un inconnu).
- Corrigé en chemin : un objet d'un autre Workspace pris par un CLIC dans le panneau Asset était
  copié dans le Workspace D'AVANT (le panneau rapatrie avant de poser), puis recopié au départ — un
  double. Le panneau a l'option `rapatrie: false` (`commun/dock.js`) : la fenêtre reçoit l'original,
  la copie se fait au départ, dans le Workspace neuf. Fermée, la fenêtre efface ce qu'elle avait mis
  dans la configuration du panneau (`configure` fusionne). Les documents sont dans le filtre du
  panneau pendant la fenêtre. La raison d'un refus est en bas de casse (de la prose), et lisible.
- **« repérage_rue.mp4 » qui manquait** : un artefact de l'essai, pas notre code. Chromium lancé sous
  la locale POSIX du conteneur (`LC_CTYPE=POSIX`) laisse tomber, sans erreur, les chemins non ASCII
  qu'on lui donne par `setInputFiles` ou par le sélecteur de fichiers (un `<input type=file>` nu fait
  de même) ; des tampons (`{name, buffer}`) passent, et tout passe sous `LC_ALL=C.UTF-8`. Le pilote
  lance donc Chromium en UTF-8. Un vrai navigateur rend le nom tel quel ; la fenêtre le met en NFC
  (un nom décomposé, celui d'un disque HFS+, s'écrit alors comme le même nom tapé).
- Reste : l'essai avec la vraie page de l'agent (`ideation/agent.js`) et la page des documents, une
  fois fusionnées (relancer le pilote : il s'y adapte) ; l'essai porte allumée par la page (la phrase
  du refus est jouée par le selftest et, dans la page, par une réponse interceptée).

## Sources (05/10/2026)

- [H1] https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-supercomputer (extrait)
- [H2] https://higgsfield.ai/blog/higgsfield-supercomputer-guide (extrait)
- [H3] https://higgsfield.ai/supercomputer-intro (extrait)
- [H4] https://higgsfield.ai/creator-hub/changelog (extrait : Projects, partage, Assets et Elements)
- [H5] https://explainx.ai/blog/higgsfield-ai-supercomputer-hermes-agent-2026 (extrait : 14/05/2026)
- [H6] https://thenextweb.com/news/higgsfield-supercomputer-enterprise-marketing-nvidia (extrait : 2.0, 25/06/2026)
- [C1] https://support.claude.com/en/articles/8241126-uploading-files-to-claude (lu, mis à jour le 23/07/2026)
- [M1] https://docs.midjourney.com/hc/en-us/articles/32040250122381-Image-Prompts (extrait)
- [W1] https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/webkitGetAsEntry (extrait)
- [W2] https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryReader/readEntries (extrait)
