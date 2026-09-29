# Fenêtres — le plein écran, et un panneau sur un 2ᵉ écran (29/09/2026, soir)

Demande de Cal (29/09, 19 h 40) : « il faut un bouton en haut à droite pour
passer plein écran.. il faut prévoir aussi qu'on voudra détacher des panels
dans un deuxième écran... celui du montage vidéo par exemple. et celui du
nodal dans ODIO ».

Ce qui est fait : le plein écran sur toutes les pages (`commun/pleinecran.js`,
la barre de `commun/shell.js`) ; le module commun des fenêtres détachées
(`commun/fenetre.js`, `fenetre.css`, `fenetre.html`) ; Montage détache ses
quatre panneaux du haut (§ 5) ; ODIO détache son nodal (§ 6, branché le soir
même, après le feu vert). Essais sur DGX2 (copie `/tmp/sr_fenetres` =
origin/main 7bcd857 + ces fichiers, portail d'essai sur le port 8871, données
à part), Chromium sans affichage de playwright.

## 1. Le plein écran

**L'API.** Fullscreen API (WHATWG, fullscreen.spec.whatwg.org ; MDN
`Element.requestFullscreen`, `Document.fullscreenElement`,
`Document.fullscreenEnabled`, l'événement `fullscreenchange`). On met
**`<html>`** en plein écran (`document.documentElement.requestFullscreen({
navigationUI: 'hide' })`) : toute la page, donc ses menus (`commun/menu.js`,
posés sur `<body>`), ses boîtes modales, ses bulles restent dans ce qu'on
voit — un élément plus petit en plein écran cacherait ce qui est posé à côté
de lui. Le geste de l'utilisateur est exigé (« transient activation », MDN) :
un clic ou une touche.

- Prise en charge (MDN, compatibilité) : Chrome et Edge 71+, Firefox 64+,
  Safari 16.4+ sans préfixe. **L'iPhone** n'a le plein écran que pour
  `<video>` : `fullscreenEnabled` y est faux, le bouton reste visible, grisé,
  et dit pourquoi (règle 7 du thème). Pas de contexte sûr exigé (MDN) : ça
  marche sur `http://192.168.10.247:8790`.
- **F11** est au navigateur : il met la *fenêtre* en plein écran, sans l'API
  (`fullscreenElement` reste nul, notre bouton ne s'allume pas). Les deux
  cohabitent.
- **Le raccourci : Ctrl+Maj+F.** Absent des raccourcis de Chrome
  (support.google.com/chrome/answer/157179, relu le 29/09 : Ctrl+Maj+ N, T, B,
  O, G, J, M, D, Suppr) et d'Edge (support.microsoft.com, « Keyboard
  shortcuts in Microsoft Edge ») ; pris par aucun outil (relu dans le code) :
  Montage (F = concordance des images, sans Ctrl ; sous Ctrl, `f` n'est pas
  lu), ODIO (Ctrl → la vue ; F = cadrer, KeyF = clavier musical, tous deux
  sans Ctrl), Idéation (F = cadre, ou plein écran de la présentation, sans
  Ctrl), Asset (F = favori, sans Ctrl). Firefox : non vérifié (sa page
  d'aide n'a pas chargé). Lu par `e.key` (juste en AZERTY). Ctrl seulement,
  pas ⌘ : sur Mac, ⌘⇧F appartient à Chrome.
- **Sortir** : Échap, comme le navigateur le fait de lui-même (on ne peut pas
  l'en empêcher sans `keyboardLock`, MDN — et on ne le veut pas), le bouton,
  ou Ctrl+Maj+F.
- Le bouton : tout à droite de la barre, après « File » (`#sr-full`,
  `tb ghost sm`), quatre coins dessinés au trait (`currentColor`), rentrés
  quand on y est ; allumé en acier (`--cy`, pas l'orange de l'action).
  `aria-pressed`, infobulle qui donne le raccourci.

**Essais** (`fen_pilote.mjs`, A) : bouton dernier de la barre après
`#sr-queue` ; clic → `fullscreenElement === <html>`, icône « sortir » ; en
plein écran, le menu du clic droit et la boîte des raccourcis s'ouvrent et
se voient (`elementFromPoint` tombe dans le menu, dans la boîte) ;
Ctrl+Maj+F sort, puis rentre ; le bouton est dans la barre d'Asset, ODIO,
Idéation, Image ; aucune erreur.

## 2. Détacher un panneau : les chemins possibles

### 2.1 Deux pages synchronisées (window.open + BroadcastChannel)

`window.open('montage/?panneau=programme')` ouvre une page complète en mode
« panneau seul », qui charge son propre état et le suit par messages
(`BroadcastChannel`, MDN : Chrome 54, Firefox 38, Safari 15.4 ; même origine).

- pour : chaque fenêtre vit sa vie (rechargement, fermeture) ; marche entre
  onglets et même sans `window.opener` ;
- contre : **deux copies de tout** — deux états à tenir d'accord (chaque
  geste devient un message, la sélection, la pile d'annulation…), deux
  lecteurs vidéo qui décodent chacun, deux horloges à caler, et pour ODIO
  **deux moteurs audio** (ce que Cal ne veut pas : un seul moteur) ou un
  moteur piloté à distance par messages. Chaque panneau devrait être réécrit
  en « vue d'un état + commandes ». C'est le chantier d'une application
  entière, par outil.

### 2.2 Une page, et le nœud du panneau déplacé dans une fenêtre (choisi)

`window.open(commun/fenetre.html)` ouvre une page vide **du même portail**
(même origine : la page principale a la main sur son `document`, et la
fenêtre sur `window.opener`). La page y **déplace le nœud DOM du panneau**
(`Node.append` : le nœud est « adopté » par l'autre document, DOM
Standard, « adopt »). Le code reste celui de la page : ses écouteurs, son
état, sa pile d'annulation, son `AudioContext` suivent le nœud. C'est le
modèle même de Document Picture-in-Picture (§ 2.3), où Chrome n'offre que
ça (« move elements into the PiP window », MDN).

- pour : **rien à synchroniser** — c'est le même objet. Juste par
  construction : la timeline et le programme détaché ne peuvent pas diverger.
  Un seul moteur son, une seule horloge, une seule pile Ctrl+Z. N'importe
  quel panneau se détache de la même façon, sans réécrire l'outil.
- contre (et ce que `commun/fenetre.js` fait pour chacun) : le code écrit
  pour *une* fenêtre suppose `document` et `window` —
  - `document.querySelector('#prg-fill')` ne trouve plus un nœud parti :
    `fenetre.js` exporte `$` / `$$` qui cherchent aussi dans les fenêtres ;
  - `addEventListener('pointermove', …)` sur `window` ne voit pas les gestes
    faits dans l'autre fenêtre. La plupart des gestes des outils sont écrits
    ainsi (ODIO : `machines/interaction/drag.js`, `banc.js`, les jouets…) :
    plutôt que de les réécrire un à un, la fenêtre **renvoie à la page** les
    `pointermove` (bouton tenu), `pointerup` et `pointercancel` (recréés sur
    `document.body` de la page, aux coordonnées de la fenêtre — celles des
    nœuds qu'on y mesure). Le survol sans bouton ne traverse pas. Pour
    `pointerdown` (qui ne se renvoie pas : il décide des menus, du focus) :
    `partout(type, fn)`, la page et chaque fenêtre, présente ou future ;
  - `document.elementFromPoint(x, y)` à la fin d'un geste cherche dans la
    page : `elementAuPoint(x, y)` cherche dans la fenêtre du geste
    (`fenetreDuGeste()`) ;
  - une bulle, un cadre de sélection posés sur `document.body` s'affichent
    dans la mauvaise fenêtre : `nœud.ownerDocument.body` (ou
    `fenetreDuGeste().document.body`) ;
  - **une fenêtre qui meurt emporte les écouteurs des nœuds restés dedans** :
    Chromium, en détruisant un document, retire tous les écouteurs de ses
    nœuds. Sonde `fen_ecouteurs.mjs` (trois fois) : un bouton fermé avec sa
    fenêtre ne reçoit plus aucun clic une fois revenu dans la page (0) ; sorti
    de la fenêtre dans son `pagehide`, il les garde (1). Le panneau sort donc
    dans `pagehide` ; et une fenêtre dont le document s'en va ne peut plus le
    reprendre (essai du 29/09 : son minuteur la représentait entre `pagehide`
    et sa destruction, et le programme revenait sans écouteurs une fois sur
    trois — corrigé : le document partant est refusé, le minuteur s'arrête) ;
  - `requestAnimationFrame` est celui de la page : caché, le navigateur le
    suspend (HTML, « update the rendering » ne dessine pas un document
    caché). L'horloge d'un lecteur détaché bat donc au rAF de **la fenêtre qui
    le montre** (`player.js`, `schedule`).
  - un `ResizeObserver` **de la page** sur un nœud posé dans la fenêtre est
    prévenu une fois, ou pas du tout, et jamais des changements suivants
    (mesuré, F1 : 0 ou 1 appel pour 4 tailles ; celui de la fenêtre : 4) —
    Chrome rassemble les observations au rendu du document de
    l'observateur. D'où `suivreTaille(nœud, cb)` : un `ResizeObserver` de la
    fenêtre où est le nœud, refait à chaque départ et retour ;
- vérifié dans Chromium (`fen_pilote.mjs`, F) : un `IntersectionObserver` de
  la page voit un nœud posé dans la fenêtre (les vignettes du panneau Effets
  s'y dessinent) ; un `<audio>` posé dans la fenêtre sonne par
  l'`AudioContext` de la page (crête 0,125 lue par un `AnalyserNode`) ; les
  nœuds déplacés restent du « royaume » de la page (`instanceof Element` de
  la page : vrai ; celui de la fenêtre : faux).

### 2.3 Document Picture-in-Picture

`documentPictureInPicture.requestWindow()` (MDN ; Chrome et Edge 116+, ni
Firefox ni Safari) : une fenêtre **toujours au-dessus**, **une seule par
onglet**, **qu'on ne peut ni placer** (sa position n'est pas réglable) **ni
naviguer**, qui **se ferme avec la page** ; **contexte sûr exigé** (https ou
localhost). Utile plus tard pour un petit moniteur qui flotte au-dessus d'une
autre application ; pas pour un 2ᵉ écran (pas de placement, une seule
fenêtre, disparue au rechargement). Sur `http://192.168.10.247` : absente.
Le modèle (déplacer le nœud) est le même que § 2.2 : `fenetre.js` pourra
l'offrir comme autre contenant sans rien changer aux outils.

### 2.4 Window Management API (placer sur le 2ᵉ écran)

`window.getScreenDetails()` (MDN « Window Management API », W3C
w3c.github.io/window-management ; Chrome et Edge 100+, ni Firefox ni
Safari) : la liste des écrans (`availLeft`, `availTop`, `availWidth`…),
`screen.isExtended`, l'événement `screenschange`. Permission
**`window-management`** (l'ancien nom `window-placement` n'est plus reconnu :
developer.chrome.com, « Window Management API »). **Contexte sûr exigé**
(`[SecureContext]` dans la spécification) — donc **absent sur
`http://192.168.10.247:8790` et sur Tailscale en http**. Sans la permission,
`window.open(…, 'left=…,top=…')` est ramené sur l'écran de la page
(spécification : « clamped to the current screen, matching pre-existing
behavior of some user agents »). Avec elle, un seul geste peut mettre un
élément en plein écran sur un écran (`requestFullscreen({ screen })`) et
ouvrir une fenêtre sur un autre.

Ce que fait `fenetre.js` : il ouvre dans le geste (sinon le bloqueur de
fenêtres refuse), à la place retenue ; la première fois, **si** l'API est là
(contexte sûr, Chrome) et la permission accordée ou demandable avec un écran
étendu, il déplace ensuite la fenêtre sur l'autre écran, en grand
(`moveTo`, `resizeTo` : permis sur une fenêtre ouverte par `window.open`).
Sur le http du réseau local : la fenêtre s'ouvre sur l'écran de la page, on
la glisse une fois sur le 2ᵉ ; tant qu'elle reste ouverte, elle y reste
(même la page rechargée, § 4). **Pour le placement automatique**, trois
chemins, à décider par Cal : servir le portail en https (la porte Cloudflare
de `docs/etudes/cloudflare.md`, ou un certificat Tailscale) ; ou, dans le
Chrome de Cal seulement, `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
avec `http://192.168.10.247:8790` (un réglage de Chrome qui fait de cette
adresse un contexte sûr — à ne pas faire sans que Cal le décide).

## 3. L'architecture recommandée, pour tout le portail

**Une page, un état, un moteur ; un panneau détaché est un nœud déplacé dans
une fenêtre du même portail** (§ 2.2). Le module commun :

```js
import { fenetres, $, $$, winOf, partout } from '../commun/fenetre.js';
const F = fenetres('montage', { onchange: relayout });  // onchange : un panneau est parti ou revenu
F.panneau('prg', { node: $('#prg'), title: 'Programme' });  // un panneau à place fixe (un repère la garde)
F.panneau('nodal', { node, title: 'Nodal', dans: viewBox, corps: { 'data-view': 'nodal' } });  // une vue sans place fixe
F.bouton('prg')     // l'icône « détacher » d'un en-tête · F.entree('prg') : l'entrée de menu (détacher / rattacher)
F.pastilles()       // la barre : « ↗ Programme » (clic : montrer sa fenêtre ; clic droit : rattacher), « rouvrir … »
F.detacher(id) · F.rattacher(id) · F.detache(id) · F.fenetre(id) · F.etat()
$(sel) · $$(sel)          // comme shell.js, mais aussi dans les fenêtres détachées
winOf(nœud)               // la fenêtre du nœud : ses écouteurs de gestes, son requestAnimationFrame
partout(type, fn, opt)    // un écouteur sur la page et sur chaque fenêtre, présente ou future
suivreTaille(nœud, cb)    // un ResizeObserver qui suit le nœud d'une fenêtre à l'autre
fenetreDuGeste()          // la fenêtre du dernier geste · elementAuPoint(x, y) : elementFromPoint là
```

La fenêtre (`commun/fenetre.html`) ne contient rien : un script de dix
lignes se présente à `window.opener.SR_FENETRES.claim(window, 'outil:id')`
toutes les 400 ms tant que personne ne l'a prise, et se ferme au bout de
20 s sans preneur. La page, à la prise :

1. recopie ses feuilles de style (et suit celles qui arrivent :
   `MutationObserver` sur `<head>`), les attributs de `<html>` (thème,
   « le mien », taille de l'interface) et de `<body>` (classe, `data-*`, plus
   `corps`) — un changement de thème suit en direct ;
2. refait les ancêtres du panneau (mêmes balises, mêmes classes, marqués
   `.sr-fen-a`) : les règles « `.mtg .mon …` » s'appliquent là-bas ; le
   panneau y prend toute la place (`fenetre.css`) ;
3. pose une barre : l'outil et le panneau (mono, capitales), le plein écran
   **de cette fenêtre** (le programme en plein écran sur le 2ᵉ écran),
   « Rattacher » ;
4. y branche le clavier, les gestes (bouton tenu), le clic droit, les menus,
   la fermeture (§ 4).

## 4. Ce qu'il advient de…

| cas | ce qui se passe |
|---|---|
| **la fenêtre fermée** (croix, Ctrl+W, « Rattacher ») | `pagehide` : le panneau sort de la fenêtre avant qu'elle meure (sinon Chromium lui retire ses écouteurs, § 2.2) et revient à sa place (le repère laissé dans la page) ; la rangée se refait (Montage : `relayout`). Le document qui s'en va ne peut plus reprendre le panneau. Filet : un relevé tous les quarts de seconde voit une fenêtre fermée et rattache ce qui y serait resté |
| **la fenêtre rechargée** (F5 dedans) | le panneau revient dans la page le temps du rechargement, puis la fenêtre neuve se présente et le reprend |
| **la page rechargée** | la fenêtre reste ouverte (une fenêtre ne se ferme pas avec la page qui l'a ouverte) ; la page mourante y laisse « la page principale se recharge… » ; la page neuve reçoit sa présentation (`window.opener` désigne toujours le même onglet) et y remet le panneau. Aucun geste demandé |
| **la page fermée, ou partie vers un autre outil** | personne ne prend la fenêtre : elle se ferme au bout de 20 s |
| **rouvrir après un redémarrage du navigateur** | la place (écran, taille) est retenue par visiteur (`localStorage` `sr-fenetres-<outil>`, dans un try/catch) ; rouvrir demande **un clic** : un navigateur n'ouvre pas de fenêtre sans geste (HTML, « transient activation ») — la pastille « rouvrir Programme » le propose, × l'oublie |
| **Ctrl+Z** | une seule pile, celle de la page (`commun/undo.js`) : le clavier de la fenêtre y est renvoyé |
| **le son** | un seul `AudioContext`, celui de la page ; un `<video>` / `<audio>` déplacé reste relié à son `MediaElementSource` (mesuré, § 2.2). Pour ODIO : le moteur n'existe qu'une fois, par construction |
| **la lecture vidéo synchronisée** | c'est la même horloge (`Program`) : l'écart vidéo ↔ horloge relevé dans la fenêtre (10 relevés par passe) est de 20 à 67 ms au plus selon les passes (Chromium sans affichage, rendu logiciel), et le recalage est celui de la page (`sync()` : ±8 % au-delà d'une demi-image, un saut au-delà de 0,3 s) — l'écart dans la page, sur la même machine, n'a pas été relevé à part. Un média déplacé en lecture n'est pas mis en pause (HTML : la pause n'a lieu que s'il n'est plus dans aucun document au moment stable) ; `sync()` le relance de toute façon |
| **la lecture automatique** | mesuré sans la règle d'essai (`--autoplay-policy`) : un clic sur « Lecture » dans la page suffit, la vidéo déplacée dans la fenêtre joue |
| **les raccourcis clavier** | dans la fenêtre, chaque touche (keydown, keyup) est recréée sur `document.body` de la page (`KeyboardEvent`, non « fiable » : `isTrusted` faux) ; un `preventDefault` de la page s'applique à la touche d'origine. Un champ de texte de la fenêtre garde ses touches. Espace sur un bouton : c'est la lecture, pas un clic. **Ctrl+Maj+F** reste à la fenêtre : son propre plein écran |
| **le clic droit, les menus** | le menu du navigateur n'apparaît pas non plus dans la fenêtre ; le menu commun s'ouvre **dans la fenêtre du geste** : `menu.js` le pose sur la page, `fenetre.js` le déplace avant qu'il soit peint (`MutationObserver`, une micro-tâche) ; un clic hors du menu, Échap, les flèches marchent. C'est un pont : l'accroche propre est dans `menu.js` (§ 7) |
| **les boîtes modales, les bulles (toast)** | elles s'ouvrent dans la page (Exporter…, renommer, nouveau dossier) — c'est là qu'on monte |
| **les gestes à la souris** | un geste qui écoute `window` de la page (glisser une tuile, tirer une arête, une molette) marche dans la fenêtre : ses pointermove (bouton tenu), pointerup, pointercancel y sont renvoyés (§ 2.2). Essai ODIO : une tuile glissée de 120 px dans la fenêtre se déplace, Ctrl+Z la remet |
| **glisser-déposer** | d'une fenêtre à l'autre, le glisser HTML du navigateur marche (même onglet de Chrome) ; l'objet glissé est connu de la page (`S.dragging`, `S.fxDrag`) |
| **la page cachée** (réduite) | le programme détaché doit continuer : son horloge bat au rAF de sa fenêtre (`player.js`, `schedule`), les minuteries de la page, elles, sont ralenties par Chrome quand elle est cachée — non mesuré ici (Chromium sans affichage ne réduit pas une fenêtre) ; la timeline de la page n'est plus peinte — on ne la voit pas |
| **la fenêtre cachée** | l'image s'arrête là-bas (le rAF de la fenêtre est suspendu) ; le son continue. Pas de cas d'usage : la fenêtre est sur l'autre écran |

## 5. Montage — ce qui est fait

- Quatre panneaux se détachent : **Projet**, **Source · Effets**,
  **Programme**, **Inspecteur**. Une icône dans chaque en-tête (l'inspecteur a
  reçu un en-tête d'une ligne, `#inspw` > `#insp-head` + `#insp`), une entrée
  dans le clic droit du panneau (programme, source, effets, fond du Projet),
  une section « fenêtres · 2ᵉ écran » dans le menu de repli de la page. La
  timeline ne se détache pas (ses gestes et ceux des pistes écoutent
  `window` : à reprendre avec `winOf` le jour où on le veut).
- La rangée du haut se refait sans le panneau parti (`relayout`,
  `commun/split.js`) ; ses tailles sont retenues à part pour chaque
  combinaison (`montage-cols-sans-prg`…) ; plus aucun panneau souple : ceux
  qui restent se partagent la place ; tous partis : la timeline prend tout.
- Les pastilles de la barre disent ce qui est dans une fenêtre.
- `player.js` : l'horloge du programme et le tic de la source battent au rAF
  de la fenêtre qui les montre (`schedule`, `moved`).
- Gestes rendus sûrs pour une autre fenêtre : réordonner les effets de
  l'inspecteur (`winOf`), le cadre de sélection et l'image de glisser du
  Projet (`ownerDocument.body`), le « clavier au Projet » (`partout`), la
  fin d'un glisser d'effet (`partout('dragend')`).

**Essais** (`/tmp/sr_fen_scripts/fen_pilote.mjs`, voir § 8) : détacher le
programme → une 2ᵉ page `commun/fenetre.html` le montre (796 × 448 dans une
fenêtre de 1280 × 800) ; espace dans la page → le temps avance
(0,78 → 3,75 s), la barre de lecture de la fenêtre avance, l'état y dit
« lecture », la vidéo y joue, les cinq captures de la fenêtre diffèrent ;
écart vidéo ↔ horloge de 20 à 67 ms selon les passes ; espace, → →, Ctrl+Z tapés dans la fenêtre
agissent sur la page ; clic droit dans la fenêtre → le menu du programme
s'ouvre dans la fenêtre, Échap le ferme ; fermer → rattaché à sa place, trois
poignées, **ses écouteurs gardés** (sa barre de lecture répond), la lecture
marche. Inspecteur détaché : il suit la sélection de la page ; « Rattacher »
le remet. Projet détaché : double-clic sur un clip → la source de la page.
Effets détaché : 22 effets, vignettes dessinées. Revenus, le Projet et la
Source répondent. Deux pastilles : la barre du Montage tient sur une ligne à
1600 px. Page rechargée : la fenêtre garde le programme et la lecture y
joue ; fenêtre rechargée : elle le reprend ; page rechargée puis fenêtre
fermée : il revient. Sans la règle d'essai `--autoplay-policy` : un clic sur
« Lecture » dans la page suffit, la vidéo de la fenêtre joue.

## 6. ODIO — le nodal dans sa fenêtre (fait, 29/09 au soir)

Branché après le feu vert (origin/main 7bcd857). Le nodal est une **vue**
qui partage sa boîte (`viewBox`) avec l'arrangement et la console : c'est un
panneau « libre » (`F.panneau('nodal', { node, dans: viewBox, corps:
{ 'data-view': 'nodal' } })`) ; détaché, la page montre l'arrangement ;
rattaché, le nodal revient comme vue. **Le moteur (`engine`, un seul
`AudioContext`) ne bouge pas** : la fenêtre ne fait que montrer des nœuds de
la page ; elle ne joue rien.

Ce qui change (par fichier, avec la raison) :

| fichier | quoi |
|---|---|
| `musique/musique.js` | `fenetres('music')` ; `app.nodalDetache()`, `app.fenetres`, `app.detacherNodal()` ; `render()` : nodal dehors → la page prend l'arrangement, le nodal se redessine là-bas, un autre projet ouvert redéclare la vue neuve (elle prend la place de l'ancienne dans la fenêtre) ; `setView('nodal')` et Tab : montrer sa fenêtre ; `frame()` et `engine.onstop` : le nodal dehors suit le moteur ; le clavier : `$` de fenetre.js pour « un menu ouvert », et les touches à Ctrl ou ⌥ vont au nodal quand on tape dans sa fenêtre (`fenetreDuGeste()`) ; le clic droit : `partout('contextmenu')`, la vue qui répond est celle qui contient la cible ; l'onglet « Nodal ↗ », la pastille « ↗ Nodal » dans la barre, « Détacher le nodal » dans le menu d'ODIO |
| `musique/nodal.js` | `vueNodal()` (la vue de la page, ou dehors) à la place de `S.view === 'nodal'` (clavier, repeindre, `onMachineConfig`, taille, `montrer`) ; `partout('pointerdown')` pour savoir si le nodal a le clavier ; `suivreTaille(cv)` au lieu d'un `ResizeObserver` de la page ; la fin d'un lien de molettes par `elementAuPoint` ; le catalogue et PLANO ouverts dans le document du nodal ; le bouton « détacher » dans sa barre d'outils, l'entrée dans le menu du fond |
| `musique/banc.js` | `vueNodal()` ; le fil et la pose d'un attracteur dans le document du nodal ; `$` pour « un menu ouvert » |
| `musique/machines/catalogue.js`, `plano.js` | `doc` : leur fenêtre (voile, glisser, Échap) dans le document du nodal |
| `musique/machines/panneau.js` | la bulle d'un réglage dans la fenêtre du geste |
| `musique/machines/corps.js`, `jouets/index.js` | `elementAuPoint` (les pads, le câble d'un jouet) |
| `musique/machines/interaction/drag.js` | le curseur du geste sur la fenêtre du geste ; ses écouteurs sur `window` reçoivent les gestes de la fenêtre par le renvoi de `fenetre.js` (§ 2.2) — rien d'autre à changer, ni dans la vingtaine de gestes qui l'emploient (`nodal.js`, `corps.js`, `panneau.js`), ni dans ceux de `banc.js` et des jouets qui écoutent `window` eux-mêmes |

Les `requestAnimationFrame` du nodal restent ceux de la page (visible sur
l'autre écran : ils battent) ; la page **réduite**, le nodal détaché ne se
repeindrait plus — non mesuré, à reprendre comme `player.js` (`schedule`,
`moved`) si Cal travaille la page réduite.

**Essais** (`/tmp/sr_fen_scripts/odio_pilote.mjs`, deux passes, 17/17) : le
bouton « détacher » est dans la barre d'outils du nodal ; détaché, la page
montre l'arrangement, l'onglet dit « Nodal ↗ », la pastille « ↗ Nodal » ; la
fenêtre montre le nodal (1058 × 484 px de canvas, le banc dessous, ses 15
tuiles), `data-view="nodal"` ; **un seul moteur** : AudioContext créés — page
1, fenêtre 0 (comptés dans chaque document) ; la lecture lancée dans la page
fait battre le nodal détaché (96 appels de `frame` en 1,5 s) ; un clic sur une
tuile dans la fenêtre la choisit ; **glissée de 120 px dans la fenêtre, elle se
déplace** (40,40 → 444,162, à 31 %) ; Ctrl+Z tapé dans la fenêtre la remet ;
clic droit sur le fond : le menu du nodal s'ouvre dans la fenêtre, avec
« Rattacher » ; double-clic : le catalogue s'ouvre dans la fenêtre, Échap le
ferme ; la fenêtre rétrécie : le canvas suit (1058 → 972) ; un autre projet
ouvert : la fenêtre montre son nodal ; fermée : le nodal revient dans la page,
en vue, et répond (« + » zoome). Les pilotes d'ODIO d'avant, relancés sur la
copie : `sr_odio6_gestes` 6/6, `sr_odio6_atr` sans erreur ni chevauchement.
Pas essayé ici : le clavier musical tapé dans la fenêtre (les touches y sont
renvoyées, keyup compris, comme le prouvent espace et Ctrl+Z).

## 7. Limites connues, et les accroches communes proposées

- **Le menu commun** passe par un pont (§ 4). L'accroche propre, trois
  lignes dans `commun/menu.js` (que ce chantier ne touche pas) : `menu(x, y,
  items, { doc })` pose sur `doc.body`, écoute `doc.defaultView`, borne sur
  son `innerWidth` ; `contextMenu` et `kebab` passent
  `e.target.ownerDocument` ; `openSub` le document du menu parent. Le pont
  de `fenetre.js` deviendra alors inutile.
- **`commun/split.js`** n'a pas de « panneau caché » : Montage refait sa
  rangée (`relayout`). Un `hide(i)` / `show(i)` dans split.js serait plus
  simple pour les autres outils.
- **Toasts et boîtes** s'ouvrent dans la page (Montage : Exporter…,
  renommer ; ODIO : `ui.js`, `modal`).
- **Les gestes renvoyés** arrivent à la page avec les coordonnées de la
  fenêtre : juste pour du code qui mesure ses nœuds (ils sont là-bas), faux
  pour un `document.elementFromPoint` de la page — d'où `elementAuPoint`.
  Un geste qui écoute `mousemove` (pas `pointermove`) ne serait pas renvoyé :
  aucun dans Montage ni ODIO (relu).
- **Placement automatique sur le 2ᵉ écran** : seulement en contexte sûr
  (§ 2.4) ; en http sur le réseau local, on glisse la fenêtre une fois.
- **Le filtre de température sans WebGL2** (`player.js`, `tempFilter`, un
  `url(#…)` vers un SVG de la page) ne s'applique pas à un plan dans la
  fenêtre (une URL de filtre se lit dans le document de l'élément). Chrome a
  WebGL2 : ce chemin de secours ne sert pas.
- **Le bloqueur de fenêtres** : si Chrome bloque (fenêtres pop-up refusées
  pour le portail), une bulle le dit et dit quoi faire.
- Essais faits dans Chromium sans affichage : **un seul écran virtuel**. Le
  placement sur le 2ᵉ écran réel, le passage d'un écran à l'autre, le
  plein écran de la fenêtre sur le 2ᵉ écran restent à voir sur le PC de Cal.

## 8. Fichiers, preuves

| fichier | |
|---|---|
| `commun/pleinecran.js` (neuf) | le bouton, `basculer`, Ctrl+Maj+F |
| `commun/fenetre.js`, `fenetre.css`, `fenetre.html` (neufs) | les fenêtres détachées |
| `commun/shell.js` | la barre : `boutonPleinEcran` après « File », le raccourci |
| `commun/shell.css` | `.hdr .sr-full` |
| `montage/index.html`, `montage.css`, `montage.js`, `player.js`, `projet.js`, `effets.js` | § 5 |
| `musique/musique.js`, `nodal.js`, `banc.js`, `jouets/index.js`, `machines/catalogue.js`, `plano.js`, `panneau.js`, `corps.js`, `interaction/drag.js` | § 6 |

Preuves (DGX2, copie `/tmp/sr_fenetres` = origin/main 7bcd857 + ces
fichiers, portail d'essai 8871, données `/tmp/sr_fen_data`) :
`python3 tools/check.py` passe (1423, 0 échec) ; les pilotes du Montage
passent (`m4_gestes` 44/44, `m4_projet_essai` 18/18, `p0_vue` 7/7,
`p3_calque` 13/13, `p4_groupes` 14/14, `p5_copier` 18/18, `p6_fondus` 12/12,
`p7_hauteurs` 4/4, `molette_montage` 21/21) ; ceux d'ODIO d'avant
(`sr_odio6_gestes` 6/6, `sr_odio6_atr` sans erreur) ; les pilotes neufs,
deux passes chacun sur des données neuves : `fen_pilote.mjs` 53/53 (plein
écran, Montage, sondes, panneau libre, lecture automatique par défaut),
`odio_pilote.mjs` 17/17 ; la sonde `fen_ecouteurs.mjs` (écouteurs d'une
fenêtre fermée). Captures : `/tmp/sr_fen_shots/` (A plein écran, B programme
détaché et en lecture, B11 le menu dans la fenêtre, C inspecteur / Projet /
Effets détachés, O nodal d'ODIO détaché, son menu, son catalogue).
