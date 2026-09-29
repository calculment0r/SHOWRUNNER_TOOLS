# Character Factory — provenance du front

## La décision (29/09/2026)

Cal : « la character factory doit être intégrée dans l'interface
générale ». Le studio s'ouvre donc **dans le portail**, sous
`character/` : même en-tête, même navigation, même thème, une adresse du
portail (http://192.168.10.247:8790/character/).

- **Le front de Character Factory vit désormais ici**, dans
  `character/`. C'est la seule copie à modifier.
- **Le studio Python reste dans le dépôt Character_Factory**
  (`factory/studio.py`, `./usine studio`), sur DGX1 :8765. Le portail le
  relaie (`server/tools/character.py`) par le câble direct (réglage
  `cf_api`, 169.254.110.6:8765).
- Les pages du dépôt Character_Factory (`studio.html`, `coulisses.html`,
  `viewer.html`, `console.html`, `js/`, `assets/`, `data/methodology.md`,
  `data/sheet_template.txt`) **ne sont plus la bonne copie** : elles
  restent servies par le studio sur :8765, mais tout changement du front
  se fait ici. Une correction faite là-bas est à reporter ici.

## L'origine

Dépôt `Character_Factory`, branche `claude/epic-wright-y2kbrc`, commit
`14f0c651dcc48d283cf2bd3ed3b6887c1498ebeb` (28/09/2026 20:50, « Note the
Qwen 2.1 orbit LoRA as the lead for object views ») — le même commit que
le studio qui tourne sur DGX1, copié depuis DGX1 le 29/09.

| ici | là-bas | |
|---|---|---|
| `index.html` | `studio.html` | le casting, la fiche `#/p/<slug>`, les étapes `#/p/<slug>/<étape>`, la Scène |
| `coulisses.html` | `coulisses.html` | les coulisses `#/<slug>`, la file du studio `#/file` |
| `viewer.html` | `viewer.html` | le viewer 3D `?src=files/<slug>/…`, `?embed=1` dans la fiche |
| `console.html` | `console.html` | la console Identité `?slug=<slug>` (« Affiner avec l'IA ») |
| `js/studio.js`, `coulisses.js`, `parler.js`, `llm.js`, `config.js`, `schema.js`, `app.js`, `ui.js`, `promptbuilder.js` | `js/…` | |
| `assets/factory.css`, `studio.css`, `coulisses.css`, `viewer.css` | `assets/…` | |
| `data/methodology.md`, `data/sheet_template.txt` | `data/…` | lus par la console seule : ce sont des données du front |
| `js/cf.js`, `assets/character.css` | — | nouveaux : la vie dans le portail |

Pas repris : `assets/tokens.css` et `assets/rack.css` (le portail a les
mêmes, voir plus bas), `assets/fonts/` (celles de `commun/fonts/`),
`theme.html`, `index.html` (la page d'état de GitHub Pages), `legacy/`,
`docs/`.

## Ce qui a changé

1. **L'en-tête est celle du portail** (`mountHeader('character')`, par
   `js/cf.js`). Ce que l'en-tête du studio portait passe dans une
   sous-barre (`.cf-bar`, `assets/character.css`) : l'état du studio de
   DGX1, « File du studio » (coulisses `#/file`), « Coulisses » ; dans le
   viewer, « Fiche », « Coulisses » et « Ouvrir un .glb » ; dans la
   console, Méthode, Reset, Moteur. La « File » de l'en-tête reste celle
   du portail : ce sont deux files différentes (les rendus du portail sur
   DGX2 et DGX1 ; ceux du studio sur DGX1), d'où « File du studio ».
2. **Jetons et composants du portail** : `commun/tokens.css` (un
   sur-ensemble, mêmes valeurs) et `commun/base.css` (le rack de CF, ses
   teintes en dur passées en jetons) remplacent `assets/tokens.css` et
   `assets/rack.css` ; `commun/shell.css` pour l'en-tête et le tiroir.
   Les feuilles propres au studio restent ici.
3. **Quatre classes renommées**, parce que `commun/shell.css` porte le
   même nom pour autre chose : `.studio` → `.cf-studio` (le gabarit
   d'outil du portail est une grille à trois colonnes), `.job`, `.jobs`,
   `.jobs-empty` → `.cz-job`, `.cz-jobs`, `.cz-jobs-empty` (la rangée du
   tiroir de file), `.refs .thumb` → `.refs .ref-thumb` (la vignette de
   bibliothèque coupait le bouton ×), `.why` → `.reason` (l'étiquette du
   portail est en capitales). `viewer.css` : `.seg.grid` reprend son
   `gap` de 3 px (la `.grid` du portail en pose 10).
4. **Toutes les adresses sont relatives à `character/`** : `api/…`,
   `files/…`, et la base du modèle de texte (`config.js`,
   `implicitBase`) est `…/character`, d'où `…/character/v1/…`. Le portail
   a son propre `/api/`. Les adresses que le studio rend lui-même
   (`/files/<slug>/…` dans le résumé d'un personnage, une réplique de la
   Scène) sont ramenées sous `character/` à leur arrivée (`js/cf.js` :
   `local`, `localSummary`) ; le viewer accepte encore un ancien
   `?src=/files/…`.
5. **Les liens entre pages** : `studio.html` devient `./` (cette
   `index.html`).
6. **Les erreurs** se lisent dans les deux formes (studio :
   `{error: {message}}`, portail : `{error: "…"}`, `cf.js` :
   `errorText`) ; un studio injoignable dit « Le studio ne répond pas. »
   au lieu de « Introuvable. ».
7. **Hauteurs** : la sous-barre prend 42 px ; la Scène
   (`100vh - 212px`, au lieu de 170) et le moniteur du viewer
   (`100vh - 304px`, au lieu de 262) en tiennent compte.
8. Coulisses : la machine du studio s'affiche dans la sous-barre (elle
   s'écrivait sous le logo, qui est maintenant celui du portail). Console
   : « sur DGX2 » corrigé en « sur DGX1 » (le studio tourne sur DGX1).

## Le relais (`server/tools/character.py`)

    /character/api/*    → <cf_api>/api/*
    /character/files/*  → <cf_api>/files/*
    /character/v1/*     → <cf_api>/v1/*

Toutes méthodes ; corps de requête et de réponse par morceaux, sans
mémoire tampon (une réponse sans taille part en `chunked`, au fil de
l'eau : SSE compris) ; `Range` et `Content-Range` suivent ; un chemin
qui sortirait de son préfixe (`..`, antislash) est refusé avant de
partir ; DGX1 muet : 502, « le studio Character Factory ne répond pas ».
Le socle (`server/core/http.py`) a gagné pour cela `app.prefix()` et
`StreamResponse`. Contrôle : `python3 tools/check.py` (le `selftest` du
relais tourne contre un faux studio local).
