# Préférences, thème clair, annulation — l'étude (29/09)

Cal, le 29/09 : « notre système de control Z n'est pas en place encore si ??
il en faudra sur l'ensemble de nos outils... donc on réfléchit en parallèle à
un panel préférences général et par outils. en général, on a l'éditeur de
thème par exemple car on devra avoir un thème clair aussi... fais l'étude et
réfléchis à l'implantation de tout cela. »

Une source par ligne ; « non trouvé » quand la page ne le dit pas. Les pages
d'Adobe, de Miro et d'Ableton (aide) refusent la lecture directe (403) : ce qui
en vient est l'extrait du moteur de recherche, marqué **[extrait]**.

## 1. Ce que font les autres

### Les préférences

| | où | ce qu'on y règle | thème, taille | rangées où | source |
|---|---|---|---|---|---|
| Premiere Pro | Modifier › Préférences (Windows), Premiere › Réglages (macOS) ; une fenêtre à catégories | General, Appearance, Audio, Auto Save, Graphics, Media, Media Cache, Memory, Playback, Timeline, Trim… | trois thèmes (Darkest, Dark, Light), haut ou bas contraste, luminosité des surbrillances | dans le profil de l'utilisateur, par version ; la synchronisation Creative Cloud est abandonnée (fin 2025) | [aperçu](https://helpx.adobe.com/premiere/desktop/get-started/preferences-and-settings/preferences-overview.html), [apparence](https://helpx.adobe.com/premiere-pro/desktop/get-started/preferences-and-settings/appearance-preferences.html), [dossier](https://helpx.adobe.com/premiere/desktop/troubleshooting/preferences-and-settings-issues/reset-preferences-using-the-preferences-folder.html), [sync](https://helpx.adobe.com/premiere-pro/kb/creative-cloud-files-end-of-life-for-premiere-pro.html) **[extrait]** |
| Ableton Live 12 | Options › Settings, **Ctrl+,** (⌘, sur Mac) ; des onglets | Display & Input, Theme & Colors, Audio, Link, Tempo & MIDI, File & Folder, Library, Plug-Ins, Record/Warp/Launch, Licenses | un thème, clair ou sombre, ou « suivre le système » ; tonalité, haut contraste ; le **zoom** de chaque fenêtre dans Display & Input | un fichier par utilisateur et par version (`Preferences.cfg`) | [manuel 12](https://www.ableton.com/en/live-manual/12/first-steps/), [manuel 11](https://www.ableton.com/en/live-manual/11/first-steps/), [réinitialiser](https://help.ableton.com/hc/en-us/articles/209070609-How-to-reset-Live) **[extrait]** |
| Figma | menu principal › Preferences | thème, accessibilité, magnétisme, pas du déplacement… (liste complète : non trouvée) | clair, sombre ou « celui du système » ; l'échelle de l'interface : menu Affichage de l'application de bureau, le zoom du navigateur sinon | **le thème est propre à l'appareil**, pas au compte | [préférences](https://help.figma.com/hc/en-us/sections/4403936364311-Change-your-preferences), [thèmes](https://help.figma.com/hc/en-us/articles/5576781786647-Change-themes-in-Figma), [échelle](https://help.figma.com/hc/en-us/articles/360049549913-Adjust-the-scale-of-the-Figma-UI) |
| Miro | profil (compte), tableau › Preferences (langue…) | nom, notifications, langue | mode sombre : documenté pour l'application mobile seulement ; le fond d'un tableau change pour tous ses invités | compte | [profil](https://help.miro.com/hc/en-us/articles/4408879513874-Profile-settings), [langue](https://help.miro.com/hc/en-us/articles/4957762934802-Language-settings), [mobile](https://help.miro.com/hc/en-us/articles/360017572834-Mobile-app) **[extrait]** |

Ce qu'on en retient : une fenêtre à onglets, les réglages généraux d'abord,
puis un onglet par domaine (Ableton, Premiere) ; Ctrl+, pour l'ouvrir
(Ableton) ; le thème clair / sombre y vit, avec la taille de l'interface
(Ableton : zoom ; Figma : échelle). Les trois logiciels de bureau rangent sur
la machine ; Cal demande le contraire, **par personne sur le portail** : ses
amis entrent par leur pseudo depuis n'importe quel navigateur (porte du
29/09), leurs réglages doivent les suivre. C'est un choix, pas un oubli des
sources : Figma garde le thème par appareil.

### L'annulation

| | profondeur | ce qui n'y entre pas | durée | clavier | source |
|---|---|---|---|---|---|
| Premiere Pro | **32** états, panneau Historique ; choisir un état grise la suite, un geste neuf l'efface | les panneaux, les fenêtres, **les préférences** : ce ne sont pas des changements du projet | vidé à la fermeture du projet | Ctrl+Z, Ctrl+Maj+Z (non confirmé sur une page d'Adobe) | [corriger](https://helpx.adobe.com/premiere-pro/using/correcting-mistakes.html), [historique](https://helpx.adobe.com/premiere/desktop/edit-projects/correct-mistakes/view-or-make-changes-in-the-history-panel.html) **[extrait]** |
| Ableton Live | Undo History (Affichage, Ctrl+Alt+Z), le plus récent en haut | ouvrir ou créer un Set | pas gardé avec le Set | — | [gérer les fichiers](https://www.ableton.com/en/manual/managing-files-and-sets/) |
| Figma | — | sélection, zoom : non trouvé | l'historique des versions, lui, reste (un point toutes les 30 min) | — | [multijoueur](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/), [widgets](https://developers.figma.com/docs/widgets/undo-redo/), [versions](https://help.figma.com/hc/en-us/articles/360038006754-View-a-file-s-version-history) |
| Miro | **30** actions | **les actions des autres** : on n'annule que les siennes | la session ; rien après un rechargement | Ctrl+Z, Ctrl+Maj+Z | [undo/redo](https://help.miro.com/hc/en-us/articles/360017730793-Undo-Redo) **[extrait]** |

Et les règles communes :

- Apple (HIG) : ⌘Z annule, ⇧⌘Z rétablit ; le libellé nomme le geste
  (« Annuler la frappe ») ; pas de limite inutile ; des réglages successifs
  d'une même propriété peuvent se regrouper.
  [Undo and redo](https://developer.apple.com/design/human-interface-guidelines/undo-and-redo)
- Windows : Ctrl+Y rétablit ce que Ctrl+Z a défait ; Ctrl+Maj+Z n'y figure pas.
  [raccourcis Windows](https://support.microsoft.com/en-us/windows/keyboard-shortcuts-in-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec)
  Google n'est pas d'accord avec lui-même : Drive rétablit par Ctrl+Y
  ([Drive](https://support.google.com/drive/answer/2563044)), Docs par
  Ctrl+Maj+Z et y fait de Ctrl+Y « répéter » ([Docs](https://support.google.com/docs/answer/179738)).
  On prend les deux pour rétablir : aucun outil du portail ne « répète ».
- Le bandeau « Annuler » après un geste : Gmail (envoyer, 5 à 30 s,
  [aide](https://support.google.com/mail/answer/2819488)), Drive (déplacer,
  [aide](https://support.google.com/drive/answer/16671865)) — ce qu'Asset
  faisait déjà.
- Patrons : la **commande** garde de quoi se défaire, le **mémento** garde un
  instantané ; ils se combinent pour l'annulation
  ([Command](https://refactoring.guru/design-patterns/command),
  [Memento](https://refactoring.guru/design-patterns/memento)) ; l'inversion
  d'un événement marche mieux s'il porte une différence que s'il porte un
  état absolu (Fowler, [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)).
- Fusion : **500 ms** par défaut dans Yjs (`captureTimeout`,
  [UndoManager](https://docs.yjs.dev/api/undo-manager), qui peut aussi ne
  suivre que ses propres origines) et dans ProseMirror (`newGroupDelay`,
  [history](https://prosemirror.net/docs/ref/#history), profondeur 100).

## 2. L'annulation d'une application web à plusieurs outils

**Pile de commandes ou instantanés ? Les deux, chacun où il est juste.**

- Ce qui change **sur le serveur** (un objet de la bibliothèque, un réglage
  d'Admin, la file) : une **commande et son contraire**. Un instantané de la
  bibliothèque n'aurait pas de sens (elle est à tous). Le contraire est lu
  sur le serveur *avant* le geste (l'état d'avant), et ne s'applique que si
  l'objet est **encore tel que le geste l'a laissé** (comparer puis écrire) :
  si quelqu'un d'autre, ou un autre onglet, l'a changé depuis, le geste tombe
  et le dit (« a changé ailleurs depuis »). C'est la règle de Miro et de Yjs
  (on n'annule que soi), tenue par construction, sans verrou.
- Ce qui vit **dans la page** (la barre d'Image, le formulaire de Vidéo, les
  réglages d'Upscale, le thème de l'éditeur, et déjà le projet de Montage,
  d'ODIO, la planche d'Idéation) : un **instantané** de l'état entier. Annuler
  repose l'état d'avant, tout entier : juste quel que soit le geste — c'est
  ce que Montage, ODIO et Idéation font déjà, chacun à sa façon.

**Fusion des frappes.** Deux règles. Un réglage qu'on glisse (curseur,
compteur, couleur) : les gestes de même clé à moins de 500 ms se fondent
(Yjs, ProseMirror). Un champ texte : **une saisie = un geste**, du moment où
le champ prend la main à celui où il la rend, quelle qu'en soit la durée
(« écrire le prompt ») ; dedans, c'est le navigateur qui défait la frappe.

**Portée.** Une pile par page, c'est-à-dire par outil et par document
ouvert (Premiere : par projet ; Ableton : par Set). Pas de pile commune aux
outils : Ctrl+Z dans Asset ne défait pas un réglage d'Image fait dans un
autre onglet. La pile vit le temps de la page, comme partout (Premiere,
Ableton, Miro) ; ce qui doit durer est ailleurs (la corbeille d'Asset,
l'historique d'Idéation, l'enregistrement de Montage).

**Ce qui ne s'annule pas** (on ne le range pas, et on le dit dans le code) :

- ce qui est **parti hors de la page** : un rendu lancé (il est dans la file,
  la machine calcule ; il s'arrête par « Arrêter », pas par Ctrl+Z), un
  fichier envoyé (il est rangé ; on le jette depuis Asset), un zip, un import
  de Character Factory ;
- ce qui **détruit ou ne se reprend pas** : vider la corbeille, accepter ou
  refuser une demande d'accès, suspendre quelqu'un (ses travaux en file
  s'en vont), fermer une connexion, décharger une instance, démarrer ou
  arrêter H3 ; une fusion de dossiers (on ne saurait plus lesquels venaient
  d'où) ;
- **la vue** : la sélection, le filtre, le tri affiché, le zoom, le rideau et
  la loupe d'un avant/après, l'onglet ouvert, le mode choisi — ce sont des
  préférences ou des états d'écran (Premiere : les panneaux et les
  préférences n'entrent pas dans l'historique). Exception voulue : un
  instantané emporte le mode où le geste a eu lieu, pour qu'annuler montre
  ce qu'il défait (le mode seul ne fait pas un geste).

**Synchronisation avec le serveur.** Annuler n'est pas revenir en arrière
dans une base : c'est **un geste de plus**, écrit comme les autres (et
journalisé par la porte, `journal.jsonl`). Les appuis rapides s'enchaînent un
à un (une file dans la page) ; un contraire refusé (403, 404, objet changé)
fait tomber ce geste seul, le journal le garde, la page le dit.

**Ctrl+Z dans un champ texte.** Le navigateur a sa propre pile d'édition
(les champs, `contenteditable` ; `execCommand` la préserve,
[MDN](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand) ;
les événements `historyUndo` / `historyRedo`,
[Input Events 2](https://www.w3.org/TR/input-events-2/)). On la laisse
faire : tant qu'un champ texte a la main, Ctrl+Z est à lui ; le changement,
une fois validé (on quitte le champ, Entrée), devient un geste de la page.
Une fenêtre ouverte (`.scrim`) garde aussi Ctrl+Z pour elle, sauf le journal.
Et **`e.key`, jamais `e.code`** : sur un clavier AZERTY la touche Z n'est pas
`KeyZ` (c'est W) — ODIO lit `e.code === 'KeyZ'` (`musique/musique.js`), donc
Ctrl+Z n'y annule pas en AZERTY : la touche qu'il attend est celle marquée W,
et Ctrl+W ferme l'onglet avant que la page ne le voie (§ 6).

## 3. L'inventaire, outil par outil (avant ce chantier)

| outil | l'annulation | clavier | profondeur | forme |
|---|---|---|---|---|
| Asset | « annuler » dans le bandeau : ranger, favori, tags, corbeille, voix, planche d'un élément | non | le dernier geste | fonction de retour à la main, geste par geste |
| Image | rien | — | — | — |
| Vidéo | rien | — | — | — |
| Upscale | rien | — | — | — |
| Object Creator | « annuler » du bandeau : retirer, remplacer une vue | non | le dernier | à la main |
| Admin | rien | — | — | — |
| Montage | pile maison, libellée (« annuler : couper »), boutons ↶ ↷ | Ctrl+Z, Ctrl+Maj+Z, Ctrl+Y | 300 | instantanés du projet (`core(S.p)`), gestes continus (`beginEdit`/`endEdit`, `gesture`) |
| ODIO | `History` (`musique/projet.js`) | Ctrl+Z, Ctrl+Y, ⌘⇧Z — par `e.code` | 150 | instantanés JSON, fusion à 350 ms |
| Idéation | pile + machine temporelle (`atelier/machine.js`) | Ctrl+Z, Ctrl+Maj+Z, Ctrl+Y | 150 | instantanés de la planche |
| Movie Analysis | `VX_HIST` (`analyse/chaine/voix.js`), annuler sans rétablir | bouton | 80 | instantanés des voix |

Les préférences, elles, étaient éparpillées dans `localStorage`, par
navigateur : `sr.asset.prefs` (tri, taille, sorte), `sr-fil-<outil>` (le fil :
disposition, taille, filtre), `movie.bench.mode/loop`, `sr-upscale` (la vue
mêlée au travail en cours), `sr-fil-analyse`, `ide-*`, `mu:last`, et un
**second thème** dans les rapports de Movie Analysis (`xverse-theme`,
`analyse/chaine/report.js`, clair par défaut).

## 4. Ce qui est fait

### L'annulation commune : `commun/undo.js`

Pour les autres agents, l'API en dix lignes :

```js
import { createUndo, libPatch, libTrash, libBoard } from '../commun/undo.js';
const U = createUndo({ name: 'montage', onapply: (e, { dir, items }) => repaint() });  // une pile par page (ou par document)
await U.run({ label: 'couper 3 plans', do: () => …, undo: (r) => … });                 // fait, puis range ; undo reçoit ce que do a rendu
U.record({ label, undo, redo, merge: 'volume' });                                       // un geste déjà fait ; même clé < 500 ms : fondus
await U.group('déplacer 3 plans', async () => { … });                                  // plusieurs gestes, un libellé
const T = U.snapshots({ get: () => état, set: (s) => reposer(s), describe: (a, b) => ({ label, merge }), ignore: ['mode'] });
T.reset(); … T.commit();  T.label('réutiliser les réglages');                           // un état entier : commit() après chaque changement
await libPatch(U, id, { fav: true }, 'aimer « x »');  libTrash(U, it);  libBoard(U, élément, label, fn);  // la bibliothèque, contraire lu sur le serveur
U.buttons() → [↶, ↷, journal] ; U.showLog() ; U.labels() ; U.clear() ; U.activate()    // état et bulles tenus à jour ; Ctrl+Z/Ctrl+Maj+Z/Ctrl+Y posés seuls
```

Le libellé est un verbe (« ranger 3 objets dans « Essais » ») ; les boutons
disent « Annuler : … · Ctrl+Z » ; un titre cité trop long est coupé à 38
signes. Le journal (↺) liste chaque geste de la page ; un clic sur une ligne
y ramène (ce qui suit s'annule, et se rétablit d'un autre clic), comme le
panneau Historique de Premiere ; « tout ce qui s'est passé » garde aussi les
échecs. `onapply` repeint la page après chaque annulation ; les contraires
de la bibliothèque rendent l'objet, que la page reçoit dans `items`
(`{id, gone: true}` pour un objet reparti à la corbeille).

### Ce qui s'annule désormais

| outil | gestes | forme |
|---|---|---|
| **Asset** | ranger (glisser, menu, barre de sélection, champ « dossier » de la fiche), vider un dossier, renommer un dossier (sauf fusion), favori (un, une sélection), tags (un, une sélection), corbeille (un, une sélection) et rétablir depuis la corbeille, renommer un objet, sa description, sa sorte, la planche d'un élément (rôle, libellé, ordre, retrait, ajout), sa voix (poser, remplacer, retirer), créer un élément (il repart à la corbeille) | commandes ; le bandeau « annuler » est Ctrl+Z |
| **Image** | aimer, ranger dans un dossier, jeter — depuis le fil, sa visionneuse, son menu ⋯ ; chaque réglage de la barre (modèle, variante, références et leur ordre, image envoyée d'un élément, image à éditer, format, taille, rendu photo, fond, prise de vue, rééclairage, nombre, graine, outil d'édition, visage, facteur, débruitage, point de vue, zone effacée, le prompt une fois écrit) ; réutiliser, éditer, prendre en référence | pont de la bibliothèque + instantanés de la barre |
| **Vidéo** | aimer, ranger, jeter depuis le fil ; tout le formulaire (images de début et de fin, entrées, les trois champs une fois écrits, format, toile, durée, méthode, pas, graine, LoRA, réglages avancés), réutiliser | pont + instantanés du formulaire |
| **Upscale** | l'entrée (ajouter, retirer, vider), le modèle, la taille, la cible, la couleur, le débruitage, la description | instantanés |
| **Object Creator** | créer un objet, le renommer, sa description, ajouter / retirer / remplacer une vue, changer son image | commandes (planche de l'élément) |
| **Admin** | qui voit quoi, la priorité des admins, l'entrée des admins, les quotas (par défaut, par personne), le rôle admin, l'ordre / la priorité / l'épingle d'un travail en file, la pause de la file et des machines, les interrupteurs de câblage | commandes ; le serveur juge encore (un travail parti ne se replace plus) |
| **Éditeur de thème** | chaque jeton, la base, le nom, un import, « revenir au défaut » | instantanés |

Vérifié au pilote Playwright (DGX2, 64 contrôles) : Ctrl+Z, Ctrl+Maj+Z,
Ctrl+Y dans Asset (renommer, déplacer, jeter, le bandeau), Image et Vidéo
(aimer, dossier, un réglage, le prompt), Admin, Upscale, Object Creator,
l'éditeur ; dans un champ, Ctrl+Z défait la frappe sans toucher la pile.

**Le pont d'Image et de Vidéo** (`watchLibrary`) : le fil (`commun/fil.js`,
qui n'est pas à ce chantier) aime, range et jette lui-même par
`/api/library`. En attendant qu'il appelle `libPatch` / `libTrash`, la page
lit ces écritures au passage (l'état d'avant, l'écriture, son contraire
rangé) — une seule page, ses propres écritures. À retirer quand fil.js
prendra une option `undo` : trois appels, dans `like`, `setFolder` et
`askDelete`.

### Comment les autres s'y branchent (sans que ce chantier ait touché leurs fichiers)

- **Montage** (`montage/montage.js`) : garder `commit(label, fn)`,
  `beginEdit`/`endEdit` et `gesture` ; à la fin de chacun, au lieu de
  `S.undo.push({label, s: before})`, `U.record({ label, undo: () =>
  restore(before), redo: () => restore(after) })` avec `after = core(S.p)` ;
  `restore` sert tel quel. Remplacer `#b-undo`/`#b-redo` par `U.buttons()`
  (ou garder les leurs, peints par `U.onchange`), retirer leur Ctrl+Z du
  clavier (undo.js le pose), `U.clear()` en changeant de projet.
- **ODIO** (`musique/projet.js`, `musique.js`) : `History` devient
  `T = U.snapshots({ get: () => JSON.parse(snapshot(p)), set: apply, describe:
  () => ({ merge: 'geste', mergeMs: 350 }) })`, `hist.mark()` → `T.commit()` ;
  retirer leur Ctrl+Z / Ctrl+Y (le leur lit `e.code === 'KeyZ'` : faux en
  AZERTY). Le « ↶ ↷ » de la barre d'ODIO peut rester, branché sur `U.undo`.
- **Idéation** (`ideation/ideation.js`) : `app.snap()` → `T.commit()` après le
  geste (ou `app.mutate(fn)` → `T.label(label); fn(); T.commit()`),
  `app.undoStep/redoStep` → `U.undo/U.redo` ; la machine temporelle lit les
  instantanés dans `U.done[i].parts[0].before/after` (des chaînes JSON) ;
  `app.quiet(fn)` (un travail qui avance) → `fn(); T.reset()`.
- **Movie Analysis** (`analyse/chaine/voix.js`) : `VX_HIST` →
  `U.snapshots({ get: vxEtat, set: vxRestaure })`, `xvMemorise` → `T.commit()` ;
  ils gagnent « rétablir » et le journal. Le thème des rapports
  (`xverse-theme`) doit suivre `document.documentElement.dataset.theme`.
- **Le fil** (`commun/fil.js`) : une option `undo: U` ; `like` →
  `libPatch(U, it.id, { fav: !it.fav }, …)`, `setFolder` → `libPatch(U, it.id,
  { folder }, …)`, `askDelete` → `libTrash(U, it)` ; puis Image et Vidéo
  retirent `watchLibrary`.

### Les préférences : `commun/prefs.js`, `server/tools/prefs.py`

- **Le panneau** : la roue de l'en-tête commune (ou **Ctrl+,**, comme Ableton),
  un onglet **Général** puis un par outil, dans l'ordre de l'en-tête ; un
  outil sans préférences le dit. Chaque réglage vaut dès le clic (règle 7 :
  rien à « enregistrer »), avec son « défaut ». L'état dit où elles sont
  rangées : « sur le portail pour Cal · tous tes navigateurs », ou « gardées
  dans ce navigateur » si le portail ne répond pas.
- **Rangées par personne** : `GET /api/prefs` (les miennes, avec les schémas),
  `POST /api/prefs {patch}` (fusion ; `null` retire une clé) ; un fichier
  `<data>/prefs/<id>.json` par personne, 32 Ko au plus. **Repli local** : un
  miroir dans `localStorage` (`sr.prefs.v1`) pose le thème avant d'attendre
  le serveur ; un changement fait hors connexion part au relevé suivant ;
  revenir sur l'onglet relit le portail (un autre navigateur a pu changer le
  thème).
- **Chaque outil déclare ses préférences** dans `<son dossier>/prefs.json`
  (le Général : `commun/prefs.json`) : `{tool, title, about, prefs: [{key,
  label, type: choice | toggle | number | text, default, options | min, max,
  step, unit | maxlength, help, link, hidden}]}`. Le panneau se dessine seul ;
  **le serveur refuse** une clé ou une valeur qu'aucun schéma ne déclare
  (400, avec la raison). Dans le code : `prefs.get('asset.sort', 'new')`,
  `prefs.set(…)`, `prefs.on('asset.sort', cb)`.

Retenues :

| onglet | préférences |
|---|---|
| Général | **thème** (sombre · clair · le mien, et l'éditeur) ; **taille de l'interface** (90, 100, 110, 125 %) ; **animations** (selon le système · réduites) ; **langue parlée par défaut** (français · anglais : la réplique H3 `<d>[French] …</d>` de Vidéo ; les prompts d'image restent en anglais, la langue documentée des trois modèles, `docs/etudes/image.md`) ; **le raccourci « annuler » affiché** (selon la machine · Ctrl+Z · ⌘Z) ; **dire ce qui est annulé** (le bandeau) |
| Asset | tri, taille des vignettes, sorte montrée (ce qu'on choisit dans la barre s'y range aussi), l'aide de la sélection |
| Image | modèle d'un brouillon neuf, images par envoi, remonter en tête du fil à l'envoi |
| Vidéo | mode d'un formulaire neuf, la vue du banc, le banc en boucle |
| Upscale | la vue de l'avant/après, la loupe, les vidéos en boucle |
| Object Creator | l'aperçu 3D tourne seul |
| Admin | la section à l'ouverture, le relevé de la page |

La langue « des prompts » n'a pas de sens pour les modèles d'image (tous
documentés en anglais) : on règle donc la langue **qu'on fait parler**, qui
sert Vidéo aujourd'hui, et servira ODIO (paroles, `music.py` : `fr` par
défaut) et Movie Analysis (langue du dépouillement) quand leurs agents la
liront.

**La taille de l'interface** : tout le portail est écrit en px ; seule la
propriété `zoom`, standardisée dans Chrome 128
([notes](https://developer.chrome.com/release-notes/128)) et prise en charge
par Firefox 126 ([notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/126),
[zoom](https://developer.mozilla.org/en-US/docs/Web/CSS/zoom)), agrandit tout
d'un coup. Mais les unités de la fenêtre sont zoomées comme le reste : mesuré
sous Chromium, à 125 %, `100vh` vaut 1250 px pour une fenêtre de 1000. Un
jeton le corrige : `--vh` (`calc(1vh / var(--ui-zoom))`), qu'on écrit
`calc(100 * var(--vh))`. Fait dans mes fichiers (Image, Vidéo, Upscale,
Asset, le panneau, l'éditeur) ; à faire ailleurs (§ 5).

**Animations réduites** : la règle de `base.css` sous `prefers-reduced-motion`
([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)),
posée aussi par la personne (`html[data-motion="reduce"]`) ; le défilement
doux d'Image et la rotation de l'aperçu 3D la suivent (`reducedMotion()` de
`commun/theme.js`).

### Le thème clair et l'éditeur

- **Le jeu clair** est dans `commun/tokens.css`, sous `[data-theme="light"]` :
  les mêmes noms, un papier gris-vert (la teinte du sombre retournée) ; les
  panneaux plus clairs que le fond, les champs un cran plus gris que le
  panneau qui les porte ; les accents qui servent d'encre (acier, orange,
  vert, ambre) assombris jusqu'à AA ; les aplats qui portent leur propre
  encre (corail, cartes vertes, papier de la planche) inchangés ; `--black`
  (le fond d'un moniteur) devient un gris neutre, sinon le texte d'un
  moniteur vide disparaissait. `commun/theme.js`, importé par `shell.js`,
  pose l'attribut avant que la page ne se dessine. La règle 2 de `CLAUDE.md`
  est réécrite en ce sens.
- **L'éditeur** : `commun/theme.html` (l'idée du catalogue `theme.html` de
  Character Factory : il charge les mêmes feuilles que les outils). Chaque
  jeton est **lu dans tokens.css** (ses groupes, ses commentaires, sa valeur
  sombre et claire) ; les couleurs se changent (pastille, opacité, texte), la
  typographie et les mesures se lisent. À droite, **l'aperçu en direct** : les
  vrais composants (`.tb`, `.fld`, `.opt`, `.seg`, le rack, `.meta`, `.pill`,
  `.warn`, `.why`, la jauge, les vignettes de la bibliothèque, le moniteur,
  une fenêtre, les dalles, les cartes vertes, la carte de compte), et le
  **tableau des contrastes** mesuré sur ce que la page affiche. Exporter /
  importer un thème (JSON), revenir au défaut, « Porter ce thème » (le seul
  orange). Ctrl+Z défait chaque changement. Une valeur n'est jamais qu'une
  couleur : le même motif dans la page (`colorOk`) et au serveur (ni `url()`
  ni `var()` : rien ne se charge par un jeton posé en ligne).

## 5. Les contrastes (WCAG 2.2)

1.4.3 : 4,5:1 pour le texte courant, 3:1 pour le grand
([w3.org](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)) ;
1.4.11 : 3:1 pour ce qui fait voir un composant
([w3.org](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast)).
Luminance relative et rapport de WCAG 2.2 ; un jeton translucide est posé
sur le fond qu'il recouvre. Mesuré par un script sur `tokens.css` (les
mêmes calculs que le tableau vivant de l'éditeur).

| encre \ fond | `--bg` | `--panel` | `--panel2` | `--panel3` | `--sel-bg` | `--hdr-bg` |
|---|---|---|---|---|---|---|
| **sombre** | | | | | | |
| `--ink` | 16.08 | 15.28 | 14.49 | 13.48 | 12.39 | 16.08 |
| `--ink2` | 7.94 | 7.54 | 7.16 | 6.65 | 6.12 | 7.94 |
| `--ink3` | 5.31 | 5.05 | 4.79 | 4.45 (AA grand) | 4.10 (AA grand) | 5.31 |
| `--cy` | 12.07 | 11.47 | 10.88 | 10.12 | 9.31 | 12.07 |
| `--or` | 5.77 | 5.49 | 5.20 | 4.84 | 4.45 (AA grand) | 5.77 |
| `--grn2` | 4.65 | 4.42 (AA grand) | 4.19 (AA grand) | 3.90 (AA grand) | 3.59 (AA grand) | 4.65 |
| `--amb` | 8.49 | 8.07 | 7.65 | 7.11 | 6.54 | 8.49 |
| **clair** | | | | | | |
| `--ink` | 14.41 | 16.42 | 14.95 | 13.07 | 13.51 | 15.43 |
| `--ink2` | 7.65 | 8.72 | 7.94 | 6.94 | 7.17 | 8.19 |
| `--ink3` | 5.86 | 6.68 | 6.08 | 5.31 | 5.49 | 6.28 |
| `--cy` | 6.37 | 7.26 | 6.61 | 5.78 | 5.97 | 6.82 |
| `--or` | 5.25 | 5.98 | 5.45 | 4.76 | 4.92 | 5.62 |
| `--grn2` | 5.42 | 6.18 | 5.62 | 4.91 | 5.08 | 5.80 |
| `--amb` | 5.46 | 6.22 | 5.66 | 4.95 | 5.11 | 5.84 |

| aplat | encre | où | sombre | clair |
|---|---|---|---|---|
| `--or` | `--on-or` | « Générer », le bouton orange | 5.68 | 5.99 |
| `--or` | `--on-light` | carte de compte de l'accueil | 5.62 | **2.96 (échec)** |
| `--grn` | `--on-grn` | bouton engagé (.tb.on) | 5.62 | 5.62 |
| `--cy` | `--on-cy` | aplat acier | 12.07 | 7.18 |
| `--coral-3` | `--on-light` | dalle corail 3 | 12.86 | 12.86 |
| `--coral-2` | `--on-light` | dalle corail 2 | 8.49 | 8.49 |
| `--coral-1` | `--on-coral1` | dalle corail 1 | 4.30 (AA grand) | 4.30 (AA grand) |
| `--verd-3` | `--on-grn` | carte verte 3 | 5.62 | 5.62 |
| `--verd-4` | `--on-grn` | carte verte 4 | 7.76 | 7.76 |
| `--verd-5` | `--on-grn` | carte verte 5 (dossier) | 10.42 | 10.42 |
| `--verd-2` | `--on-grn` | étage verrouillé | 5.78 | 5.78 |
| `--grn-bg` | `--ink` | pastille retenue (.opt.on) | 14.17 | 12.30 |
| `--or-bg` | `--or` | avertissement (.warn) | 4.99 | 4.68 |
| `--veil` | `--ink2` | étiquette sur une image | 7.94 | 8.59 |
| `--black` | `--ink3` | texte d'un moniteur vide | 5.71 | 5.06 |

| composant (1.4.11, 3:1) | premier plan | fond | sombre | clair |
|---|---|---|---|---|
| anneau de focus (--or, 2 px) | `--or` | `--bg` | 5.77 | 5.25 |
| barre de progression sur sa piste | `--grn2` | `--panel3` | 3.90 | 4.91 |
| champ au focus (filet acier) | `--line-cy` | `--panel2` | 3.21 | 3.77 |
| filet d'un champ au repos | `--line` | `--panel2` | 1.39 (échec) | 1.37 (échec) |
| filet vert (.opt.on, dépôt) | `--line-gr` | `--panel` | 2.45 (échec) | 3.14 |
| bouton gris sur un panneau | `--panel2` | `--panel` | 1.05 (échec) | 1.10 (échec) |

Lecture :

- **Le clair tient AA partout pour les encres** (7 encres × 6 fonds). Son seul
  échec est un composant : la carte de compte de l'accueil écrit `--on-light`
  sur `--or`, alors que tout autre texte posé sur l'orange prend `--on-or`
  (`base.css`, `.statcard`) : une ligne à changer, dans un fichier qui n'est
  pas à ce chantier.
- **Le sombre, la palette validée de Cal, n'est pas changé.** Il passe sous
  4,5 en quatre endroits, tous en AA pour le grand texte : `--grn2` écrit comme
  texte (« fini », les valeurs vertes) sur les panneaux, `--ink3` sur
  `--panel3` et `--sel-bg`, `--or` sur `--sel-bg`. À Cal de dire s'il veut
  éclaircir `--grn2` et `--ink3` d'un cran.
- Les **filets de champ** et le **bouton gris** ne tiennent 3:1 dans aucun
  thème : un champ se reconnaît à son fond et à son étiquette, pas à son
  filet — c'est le dessin du banc NL, pas une régression.

## 6. Ce qui reste, et où (hors des fichiers de ce chantier)

- `commun/base.css` `.statcard` : `color: var(--on-light)` → `var(--on-or)`
  (2,96:1 en clair).
- `100vh` sous un zoom d'interface : `montage/montage.css`,
  `musique/musique.css`, `ideation/ideation.css` (leur `body` à `100vh`
  défile à 110 et 125 %), `commun/shell.css` (`.studio .rail`, `.picker
  .modal`, `.viewer img`), `commun/base.css` (`.modal`), `commun/menu.css`,
  `commun/fil.css`, `commun/porte.css`, `analyse/analyse.css` :
  `calc(100 * var(--vh))`.
- Movie Analysis : `analyse/diarisation/` (le labo des voix) garde sa propre
  palette sombre (`analyse/chaine/report.css`, `voix.css` : `--surface…`, des
  `rgba` et des `#` en dur) et reste sombre en clair ; la frise des plans du
  studio aussi ; `report.js` a son propre sélecteur de thème (`xverse-theme`).
- ODIO : `musique/jouets/jouets.css` a sa palette `--jo-*` (la « pièce » des
  jouets, sombre) ; son Ctrl+Z lit `e.code === 'KeyZ'` (en AZERTY, la touche
  marquée W : Ctrl+Z n'y annule pas).
- `character/` (les pages du studio relayées) : trois `rgba` en dur dans
  `factory.css`.
- `server/tools/objet.py` : `/api/objet/state` rend 500 quand une voie
  « image » vaut `local` (instance d'essai) — il prend chaque entrée pour
  une adresse ComfyUI.

## 7. Finitions du 29/09

Ce qui, de la liste du § 6 et des chantiers du 29/09, est fait (copie
d'essai `/tmp/sr_fin` sur DGX2, port 8822 ; `tools/check.py` passe ; pilote
Playwright `pilote_fin.mjs`), et ce qui ne l'est pas.

**Le fil** (`commun/fil.js`) prend l'option `undo: U` : aimer, ranger dans
un dossier et mettre à la corbeille passent par `libPatch` / `libTrash`
(le contraire lu sur le serveur avant le geste). Image et Vidéo la lui
donnent ; le pont `watchLibrary` (qui lisait au passage les écritures du fil)
est retiré de `commun/undo.js`, d'Image et de Vidéo. Vérifié au pilote dans
Image, Ctrl+Z en AZERTY (touche `key: 'z'`, `code: 'KeyW'`, par CDP) : aimer
défait puis refait (Ctrl+Maj+Z), ranger dans un dossier défait, la corbeille
défaite (l'image revient dans le fil) ; le journal nomme le geste.

**ODIO** (`musique/`, repris ensuite par l'agent d'ODIO) : `History`
(`projet.js`) remplacé par la pile commune — `U.snapshots` sur l'œuvre
(`workOf`), l'instantané pris 350 ms après la rafale comme avant (une molette
tournée, cinq clics rapprochés : un geste), Ctrl+Z dans la rafale range
d'abord le geste en cours ; libellés lus dans la différence (`describeWork` :
« tempo 112 → 113 », « ajouter 1 piste », « régler « Reverb » ») ; ↶ ↷ et le
journal dans la barre ; le Ctrl+Z maison (`e.code === 'KeyZ'`) retiré. Un
défaut de l'ancien `History` corrigé au passage : une clé absente de
l'instantané (le nodal, né au premier geste) n'était pas retirée en annulant.
Les raccourcis Ctrl+lettre (et les lettres de Live, clavier MIDI éteint) se
lisent par la lettre (`letter(e)`, `musique/ui.js`) ; les rangées du clavier
MIDI restent des positions. Vérifié au pilote en AZERTY : tempo, piste,
jouet, module du nodal, attracteur du banc, bloc du nodal, région
générative — chacun fait, défait, refait ; Ctrl+W (la touche KeyZ) n'annule
rien ; dans un champ, Ctrl+Z reste au navigateur.

**Movie Analysis** (`analyse/`) : dans un film (le Studio), `VX_HIST`
devient la pile commune, branchée par `analyse/film/film.js` (le script de la
page est classique ; ouverte seule, la page garde son repli) : réattribuer une
réplique (menu, glisser), la rendre à l'automatique, forcer une voix, réunir
ou séparer des fiches, tout remettre, « les oublier », renommer (« Appliquer »),
corriger une réplique dans le script (une saisie = un geste) — libellés en
verbes, ↶ ↷ et le journal à la place de `#vx-annuler` et `#cast-annuler`, le
Ctrl+Z maison retiré (sauf page seule) ; les deux films re-rendus
(`analyse/outils/rendre-films.sh`). Sur l'accueil : créer, renommer,
retirer, supprimer (qui ne détruit rien : `supprime: true`), restaurer, le
contraire lu sur le serveur avant le geste. Ne s'annulent pas : « Enregistrer »
et « Publier » (partis pour tous), lancer ou arrêter un dépouillement, les
seuils NeMo. Le labo des voix (`analyse/diarisation/`) passe aux jetons, la
frise et la bande des plans se lisent en clair, la palette des personnages
(`analyse/film/palette.css`) a sa version claire (chaque teinte ≥ 3:1), le
sélecteur `xverse-theme` est retiré (le thème commun seul). Pilote : 62/62,
Ctrl+Z en AZERTY compris. Reste : en sombre (la palette validée, non
touchée), `--pc-5`, `--pc-11`, `--pc-14`, `--pc-15`, `--ry-build`,
`--ry-payoff`, `--ry-close` sont sous 3:1 (jusqu'à 1,88:1) — à Cal de dire.

**Le thème clair** : `.statcard` en `--on-or` (5,99:1 en clair, 5,68 en
sombre) ; `100vh` et les autres `vh` → `calc(n * var(--vh))` dans
`commun/shell.css`, `base.css`, `menu.css`, `fil.css`, `porte.css`,
`montage/montage.css`, et les pages de `character/assets/` (un jeton `--vw`
pour la largeur : `calc(94 * var(--vw))`) ; `character/assets/factory.css` :
ses trois `rgba` → `--or-bg`, `--line-or`, `--veil`, et un jeton neuf
`--grn-bg2` (l'éclair vert d'un champ qui change : `rgba(61,138,96,.42)` en
sombre, `rgba(35,105,63,.26)` en clair). Captures de chaque page en clair et
en sombre : accueil, Asset (grille, fiche d'une séquence, d'un clip MIDI,
corbeille), Image, Vidéo (et son banc), Montage, Upscale, Object Creator
(et une fiche), Admin (et la file), Character Factory (casting, console,
coulisses), l'éditeur de thème.

| paire (29/09) | sombre | clair |
|---|---|---|
| `--on-or` sur `--or` (carte de compte) | 5,68 | 5,99 |
| `--ink` sur `--grn-bg2` / `--panel` (éclair de la fiche) | 8,71 | 11,14 |
| `--or` sur `--or-bg` / `--panel2` (erreur, Character Factory) | 4,39 (AA grand) | 4,85 |
| `--grn2` sur `--veil` / `--panel` (sorte MIDI) | 4,61 | 6,18 |
| `--cy` sur `--veil` / `--panel` (sorte séquence) | 11,97 | 7,26 |
| `--line-gr` sur `--panel` (filet MIDI, 1.4.11) | 2,45 (échec, connu) | 3,14 |
| `--line-cy` sur `--panel` (filet séquence, 1.4.11) | 3,23 | 3,99 |

**Asset et les sortes neuves** : `sequence` (Montage) et `midi` (ODIO) ont leur
libellé (`kindFr`, `.kind.sequence`, `.kind.midi`), leur place dans la barre
des sortes, une vignette dessinée quand elles n'ont pas d'image (la bande
d'un film, une portée de notes) et leur fiche : la séquence s'ouvre dans le
Montage (`montage/#<id>`), montre sa vignette, ses chiffres et ses plans (sa
lignée) ; le clip MIDI montre ses notes (lues au serveur, dessinées aux
jetons), s'écoute (un synthé de la page : triangle pour les notes, souffle
filtré pour la batterie — des hauteurs et un rythme, pas le son d'ODIO) et
se glisse dans l'arrangement d'ODIO (le type commun du portail, qu'ODIO pose
en notes).

**Les copies d'affichage** (`commun/proxies.js`) : Asset (les cases d'un
dossier, la lignée, l'image de la fiche), `refBoard` (64 px) et `jobRow`
(44 px : l'objet de chaque travail lu une fois par `/api/library/batch`)
ne posent plus de vignette à la main.

**Object Creator** : `/api/objet/state` ne demande `/object_info` qu'aux
instances ComfyUI (`http…`) de la voie « image » ; une voie `local` (l'ouvrier
du portail, sans ComfyUI) n'en est pas une — avant : `Comfy("local")`, une
URL sans schéma, `ValueError` de urllib, 500. Contrôle dans son `selftest`.

**Le clic droit** (Cal, 29/09 : « ne plus avoir de clic droit du navigateur
partout dans nos outils ») : `commun/shell.js` garde toute page (sauf les
champs de texte et `[data-native-menu]`) ; une zone sans menu reçoit le menu
de repli (`commun/menu.js`) ; chaque outil de ce chantier a ses menus de
zone (Asset : carte, sélection, dossier, corbeille, fond, fiche ; Image : une
référence de la barre, la barre ; Vidéo : la création, le banc ; Montage : la
séquence ; Upscale : un fichier de l'entrée, une agrandie ; Object Creator :
un objet, une vue, la fiche ; Admin : un travail de la file, les sections ;
Character Factory : une affiche, les étapes d'un personnage). Vérifié au
pilote sur quinze pages (quatre points chacune) : jamais le menu du navigateur ; une zone d'ODIO
(le centre de l'arrangement) l'empêche sans ouvrir de menu — à l'agent d'ODIO.

**Ce qui reste** : les jouets (`musique/jouets/jouets.css`, palette `--jo-*` à
garder à l'intérieur, le cadre à passer aux jetons) et le `100vh` de
`musique/musique.css` — à l'agent d'ODIO, qui a repris `musique/` ; les cartes
de dossier d'Asset gardent en clair leur vert très sombre (`--verd-5`, un aplat
qui porte sa propre encre, inchangé par choix) ; `character/js/*.css` sont des
copies que rien ne charge (les pages lisent `character/assets/`).
