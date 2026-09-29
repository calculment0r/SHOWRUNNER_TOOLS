# Showrunner Tools

Le portail de tous les outils de Cal : une porte d'entrée, une
bibliothèque commune (« Asset »), les deux DGX derrière. Décision de Cal
du 28/09/2026 au soir : tout se rassemble ici, dans le thème de
Character Factory.

Reprise : `docs/REPRISE.md` — **à lire en premier**.
Le contrat entre les outils : `docs/ARCHITECTURE.md`.
Les études : `docs/etudes/`.

## Les outils

| carte | dossier | état |
|---|---|---|
| Asset | `asset/` | la bibliothèque : images, éléments, vidéos, sons |
| Image | `image/` | Z-Image, Qwen-Image 2.1, Krea 2 ; édition ; caméra, objectif, pellicule |
| Vidéo | `movie/` | H3 : image → vidéo (première image), références → vidéo ; le banc A/B (ex « Movie Creator », renommé par Cal le 29/09) |
| Character Factory | dépôt `Character_Factory`, studio sur DGX1 | carte vers le studio ; ses personnages deviennent des éléments |
| Object Creator | `objet/` | chaîne séparée des personnages (décision du 28/09) |
| Montage | `montage/` | timeline, découpe, export ffmpeg |
| Musique | `musique/` | rack + nodal + timeline réunis |
| Movie Analysis | `analyse/` | dépouillement, diarisation (rapatrié de `MOVIE_ANALYSE`) |

## Lancer

Le portail tourne sur **DGX2** (Wi-Fi 5 GHz ; celui de DGX1 est lent),
calcule sur les deux DGX. Dépôt dans `~/SHOWRUNNER_TOOLS` sur les deux.

```sh
cd ~/SHOWRUNNER_TOOLS && tools/portail.sh start     # stop | restart | status (PID dans ~/showrunner.pid)
# mise à jour : git fetch && git reset --hard origin/main && tools/portail.sh restart
# jamais « pkill -f showrunner.py » par ssh : le motif tue aussi la commande ssh elle-même
```

Lien : **http://192.168.10.247:8790/** (Tailscale http://100.108.108.65:8790/).
Les données (bibliothèque, file) : `~/showrunner-data/` sur DGX2, hors du
dépôt, qui est **public**.

## Règles de travail (Cal, fermes)

- **Chaque commande commence par `ssh dgx1 `, `ssh dgx2 ` ou `scp `** : ce
  sont les seules que Cal a autorisées une fois pour toutes ; toute autre
  commande (même `ls`, `cd … && git`, `cat`) lui demande « allow once ». Sur
  le PC : Read, Write, Edit, Glob, Grep seulement. Pas de python, node,
  navigateur, Edge en local ; pas d'artifact. Captures d'écran : Chromium
  sans affichage **sur DGX2** (`tools/shot.mjs`). À répéter en tête du brief
  de chaque sous-agent.
- **Git se fait sur DGX2**, qui pousse par sa clé ssh : écrire sur le PC,
  `scp` les fichiers dans `dgx2:~/SHOWRUNNER_TOOLS/`, puis
  `ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && git add … && git commit … && git push && tools/portail.sh restart'`.
  Le git du PC n'est plus à jour : ne pas s'en servir.
- **Chercher avant de faire, rien inventer** : chaque choix technique part
  de la documentation du modèle et d'un essai, avec sa source ; « non
  documenté » plutôt qu'une supposition. Vérifier qu'un choix ne contredit
  pas une décision de Cal (mémoire, `Character_Factory/docs/`).
- **Juste par construction** : une méthode robuste, pas des filtres qui
  vérifient et relancent au cas par cas.
- **Tout en local** sur les DGX : pas d'API de modèle payante.
- Réponses en français, courtes, avec le lien pour tester.

## Le thème — règles dures (les mêmes que Character Factory)

`commun/tokens.css` est la seule source des couleurs, `commun/base.css`
les composants (repris du rack de Character Factory), `commun/shell.css`
le portail.

1. **Aucune couleur en dur.** Une teinte manque : on ajoute un jeton.
2. **Deux thèmes, par les seuls jetons.** Décision de Cal du 29/09/2026 :
   « on a l'éditeur de thème par exemple car on devra avoir un thème clair
   aussi ». Le sombre reste le défaut (`:root` de `commun/tokens.css`) ; le
   clair redonne les mêmes noms sous `[data-theme="light"]`, dans le même
   fichier ; « le mien » (l'éditeur, `commun/theme.html`) ne fait que
   surcharger ces noms, en ligne sur `<html>`. `commun/theme.js` pose le
   thème au chargement (préférence Général, `commun/prefs.js`). Rien d'autre
   ne change : aucune couleur en dur, un composant ne sait jamais quel thème
   est posé ; un jeton neuf se déclare dans les deux blocs, et le clair se
   tient au contraste AA (`docs/etudes/preferences.md`).
3. **Filets, jamais de bordures** : `box-shadow: inset 0 0 0 1px`.
4. **Un seul `.tb.go` orange par écran.** L'orange est l'action.
5. **Les capitales sont pour la machine** (mono, espacé, petit). La prose
   reste en bas de casse.
6. **Norelli ne contient que A-Z, a-z et l'espace** : le logotype et le
   titre de l'accueil seulement. Le reste de l'affichage : Venus Rising.
7. Une action désactivée dit pourquoi et mène à ce qui la débloque ; rien
   à « enregistrer » qui pourrait s'enregistrer seul.

## Le code

- `server/` : Python 3.12, **bibliothèque standard** (+ PIL, présent sur
  les DGX). Un module par outil dans `server/tools/`, qui expose
  `register(app)`. Le socle : `server/core/`.
- Les pages : HTML + modules ES sans étape de construction ; tout ce qui
  est commun passe par `commun/shell.js` (`api`, `jobs`, `pick`,
  `mountHeader`, `thumb`, `refBoard`, `uploadFile`).
- Les graphes éprouvés de Character Factory (Krea 2, Qwen-Image 2.1) sont
  importés depuis `~/Character_Factory/factory/` (réglage `cf_repo`), pas
  recopiés : une seule vérité.

## Vérifier

```sh
ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && python3 tools/check.py'   # le socle et chaque outil, sans GPU
```
