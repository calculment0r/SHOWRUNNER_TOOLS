# Reprise — à lire en premier

État au 28/09/2026, fin de soirée. Portail : **http://192.168.10.247:8790/**
(DGX2 ; Tailscale http://100.108.108.65:8790/).

## Ce que Cal a demandé (28/09, soir et nuit)

1. Monter tout le portail dans le thème de Character Factory, accessible un
   jour de l'extérieur ; y rassembler : la musique (rack + nodal + timeline
   de son kit, en un seul outil), le montage vidéo, Character Factory, une
   carte à part pour l'Object Creator, Movie Analysis + Diarisation, le banc
   NL (devenu une fonction de Movie Creator).
2. Movie Creator « simple, comme Higgsfield » : format, prompt, image →
   vidéo (première image), références → vidéo ; puis, précisé : **sur le
   modèle de https://github.com/underworldhistory1-ctrl/minimax-h3-higgsfield,
   avec son thème**.
3. Des **éléments** réutilisables partout (un personnage de Character
   Factory appelé dans une image ou une vidéo H3), une bibliothèque
   persistante « Asset », triable par image, élément, vidéo.
4. Un générateur d'image : Z-Image (« imagez »), Qwen-Image 2.1, Krea 2 ;
   édition, « super édition » ; caméras, focales, pellicules à la
   Higgsfield ; une étude, et les dépôts GitHub qui imitent Higgsfield.
5. Puis, en cours de nuit : **« on se concentre sur l'UX et l'UI, le câblage
   des modèles vidéo se fera après car j'ai déjà bien avancé, et les modèles
   images aussi … ne lance pas de test de vidéo ou image »**. Et : passer
   par ssh plutôt que de lui demander des « allow once ».

## Ce qui est fait (commité, en ligne, `tools/check.py` : 248/248 sur DGX2)

| outil | état |
|---|---|
| Accueil | cartes des 8 outils, compte de la bibliothèque, état des deux DGX |
| Asset | filtres, tris, recherche, favoris, **dossiers par glisser-déposer**, fiche avec recette et lignée, éléments (références ordonnées et nommées, description), import/mise à jour Character Factory, corbeille. 8 personnages de CF déjà importés |
| Image | 3 modèles, 44 pastilles de prise de vue sourcées, références et éléments, édition (consigne, zone peinte, détourer, agrandir, affiner, angle), recette et lignée — **moteur factice** |
| Movie Creator | modes Texte / Images / Références (@mentions, éléments), prompt H3 en 3 champs, caméra MiniMax, LoRA, toiles avec temps estimé, espace de travail, « Comparer » (le banc NL) — **moteur factice, H3 jamais démarré** |
| Object Creator | l'objet comme élément, ses vues, l'état de la chaîne ; 3D en parcours factice |
| Montage | projets, chutier, source/programme, timeline 3+3 pistes, fondus, étalonnage, export MP4 réel (ffmpeg, par passes) |
| Musique | vrai moteur Web Audio : timeline, rack (DR-9, synthé, échantillonneur, effets), nodal ; export WAV ; générer/séparer en factice |
| Movie Analysis | analyses Getaround et Wall, Studio (vidéos sur R2), Diarisation relayée par le portail, « Nouvelle analyse » (chaîne sur DGX2) |
| Cloudflare | étude seulement (`docs/etudes/cloudflare.md`), rien de déployé |

Le contrat entre les outils, leurs routes et leurs interrupteurs de
câblage : `docs/ARCHITECTURE.md` §7. Les études : `docs/etudes/`.

## Ce qui attend Cal

1. **Câbler les modèles** (il a dit qu'il avait déjà avancé) :
   `showrunner.local.json` sur DGX2 → `image_backend: comfyui`,
   `movie_engine: h3`, `music_engine: ace-step`, `objet_trellis: true`.
   Ordre des premiers rendus : `docs/etudes/image.md` §8, `movie.md`.
2. **Qwen ou Krea pour éditer** : non tranché, banc prêt (`image.md` §6).
3. **Téléchargements proposés** (rien de fait) : ControlNet Union 2.1 de
   Z-Image (2,02 Go lite), depth_anything_v2_vitl (1,34 Go), krea2_raw_fp8
   (13,1 Go), RealESRGAN_x4plus (67 Mo), ACE-Step 1.5 XL turbo (9,97 Go).
4. **DGX1 n'est pas un miroir exact** : son ComfyUI sert l'ancien nœud
   d'édition Krea et ne voit pas deux fichiers d'angle (Qwen 2.5 VL, LoRA
   Lightning 2511) présents sur son disque (`image.md` §7). Le portail
   envoie ces travaux sur DGX2.
5. **Cloudflare** : les 6 décisions de `docs/etudes/cloudflare.md`
   (domaine ou non, qui voit quoi, amis, etc.) ; le pont `claude/cf-bridge`
   de Character Factory n'est pas sûr en l'état (127.0.0.1 = « maison »).
6. **Movie Analysis** : ajouter l'adresse du portail aux origines du Worker
   `movie-analysis-partage` pour écrire les corrections ; `~/reelbench/skill`
   est en retard (le portail a sa propre copie à jour).
7. Movie Creator : 24 i/s (le banc écrivait 25), turbo R5 par défaut,
   première image recadrée au centre — à confirmer.

## Travailler ici (règles fermes)

- Chaque commande commence par `ssh dgx1 `, `ssh dgx2 ` ou `scp `. Sur le
  PC : Read, Write, Edit, Glob, Grep seulement.
- Git se fait **sur DGX2** (clé ssh, `~/SHOWRUNNER_TOOLS`) : écrire sur le
  PC, `scp` vers DGX2, puis commit, push, `tools/portail.sh restart`. Le git
  du PC n'est plus à jour.
- Jamais de `pkill -f` par motif sur les DGX : il tue aussi la commande ssh
  (et le 28/09 il a tué les serveurs d'essai des agents). Arrêter par PID.
- Données du portail : `~/showrunner-data` sur DGX2 (bibliothèque, file,
  projets) — hors du dépôt, qui est public.
- Le dépôt de référence H3 Studio est cloné sur DGX2 dans `/tmp/h3hf`
  (lecture seule) ; le kit UI de Cal dans `/tmp/sr_uikit/export/`.
