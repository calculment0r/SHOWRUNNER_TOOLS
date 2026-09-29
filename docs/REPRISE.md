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

## La porte, la page de Cal, la file des calculs (29/09)

Demande de Cal : « une home avec une façon simple de se log : on demande un
nom de login, on met en attente, et moi un dashboard pour gérer cela […]
seul moi y aura accès », et « un gros travail de queue de nos demandes en
calcul ».

- **La porte** (`server/core/auth.py`, `commun/porte.js`) — décision de
  Cal du 29/09 : « on se log juste avec le pseudo », ni code ni mot de
  passe. Sans session, toute page montre la porte : on tape son pseudo ;
  un pseudo déjà accepté entre aussitôt, de n'importe quel navigateur ; un
  pseudo inconnu devient une demande, la page s'ouvre seule quand Cal
  l'accepte. Se déconnecter ne bloque rien : on retape son pseudo. La
  session est un cookie `HttpOnly; SameSite=Lax`. Un pseudo qui imite un
  admin ou un mot réservé (casse, accents, 0/O, 1/l/I : « Cal », « CaI »,
  « nic0007 ») ou un pseudo existant est refusé. **Un pseudo admin n'entre
  que depuis le réseau de Cal** (127.0.0.1, 192.168.10.0/24, le câble
  169.254.0.0/16, Tailscale 100.64.0.0/10) : réglage `admin_lan_only`,
  vrai par défaut, dans la page admin → Personnes → Réglages. Sans session,
  le socle refuse `/api/…`, `/character/…` et les fichiers de `/library/`
  (401) ; toute écriture venue d'une autre page est refusée (`Origin`,
  `Sec-Fetch-Site`, JSON déguisé en `text/plain` : audit du 28/09, H3).
  Chaque écriture est journalisée (qui, quoi, le code rendu : audit B5).
- **La page d'admin** : `admin/` (lien « Admin » dans l'en-tête, pour les
  admins seuls) — demandes, personnes (quotas, suspendre, connexions,
  **donner ou retirer le rôle admin** — jamais au dernier admin), la file
  (glisser, priorités, épingler, pause par machine, vidange), les machines
  (ComfyUI, mémoire, modèles chargés et « décharger », H3, le studio
  Character Factory, le relais), le câblage (`showrunner.local.json`), le
  stockage (corbeille), le journal.
- **La file** (`server/core/jobs.py`, `server/core/machines.py`) : un
  ordonnanceur. Ordre : épinglés, priorité, tourniquet entre personnes ;
  quotas (simultanés, en file, par jour, total) ; un seul travail GPU du
  portail par machine, rien sous le rendu d'un autre (le studio, une autre
  session : lu sur `/queue` de ComfyUI, `client_id`), la famille déjà
  chargée d'abord, `/free` entre deux familles, la mémoire de chaque
  famille lue dans `Character_Factory/factory/memory.py` (FAMILY_GB). Le
  tiroir « File » montre la place de chacun (« 2 devant toi · départ ≈
  4 min »). Détail : `docs/ARCHITECTURE.md` §3 et §9.

### Entrer, pour Cal

Ouvrir http://192.168.10.247:8790/ (ou par Tailscale), taper **`nico007`**,
Entrer. C'est tout — de chez lui, du câble ou de Tailscale ; ailleurs, le
pseudo admin est refusé, et la porte le dit.

- Le compte `nico007` est créé au démarrage du portail s'il n'existe pas,
  admin, sous l'id `cal` : ses objets et ses travaux d'avant restent à lui.
  Plus de code d'amorçage : `~/showrunner-data/admin-code.txt` est effacé
  au démarrage.
- Secours en ligne de commande (sans code, portail en marche ou non ; il
  relit `auth.json` quand il change) :
  `ssh dgx2 'cd ~/SHOWRUNNER_TOOLS && python3 server/showrunner.py --admin nico007'`
  — crée ou remet ce pseudo admin (un autre pseudo marche aussi).
- Couper la porte (essais seulement) : `"auth": false` dans
  `showrunner.local.json`, puis redémarrer — tout se passe alors comme si
  Cal était connecté.
- **Derrière un tunnel Cloudflare**, toutes les requêtes arriveront de
  127.0.0.1 : la règle « admin depuis le réseau de Cal » laisserait passer
  tout le monde. Avant d'ouvrir un tunnel, le portail devra lire l'identité
  signée par la porte (`x-porte-*`, étude `docs/etudes/cloudflare.md`
  § 3.3) et ne plus juger sur l'adresse ; en attendant, ne pas ouvrir de
  tunnel vers le portail.

### Ce qui attend Cal (la porte et la file)

1. **Qui voit quoi** : « tout le monde voit tout » par défaut (page admin →
   Personnes → Réglages) ; l'audit (C2) et l'étude Cloudflare recommandent
   « chacun le sien et le partagé » (des photos de visages réels). Dans les
   deux cas, seul le propriétaire (ou Cal) modifie ou met à la corbeille.
   En « chacun le sien », il manquera un bouton « Partager » dans Asset
   (`POST /api/library/<id> {"shared": true}` existe déjà).
2. **Les quotas par défaut** : 1 simultané, 3 en file, pas de limite par
   jour, 50 en file au total (les chiffres de l'audit H4) ; les admins
   passent devant (audit H4) — réglable.
3. **Un compte = un pseudo**, sans mot de passe (décision de Cal) :
   quiconque connaît le pseudo d'un ami entre sous son nom ; seuls les
   admins sont tenus au réseau de Cal. Sur internet, la porte Cloudflare
   (Access, e-mail) viendra devant (`docs/etudes/cloudflare.md`) ; la
   liaison identité Cloudflare ↔ compte du portail reste à écrire.

### Pour les autres outils

- Un travail déclare sa famille de modèles : `jobs.register(kind, run,
  lane=…, family="krea2" | fonction(params), gpu=…, mem_gb=…)`. Sans
  déclaration, la file devine (`DEFAULT_FAMILY` dans `core/jobs.py`) ou
  traite le travail comme un modèle inconnu (« ? » : l'instance est vidée
  avant, 30 Go exigés). Image le déclare ; Upscale, YuE, Musique, Objet,
  Movie sont dans la table par défaut — à déclarer chez eux.
- Un interrupteur de câblage se déclare pour la page admin :
  `config.declare_switch("music_yue", [False, True], label=…, doc=…)`
  (`music_yue` et `upscale_backend` ne le sont pas encore).
- Rien d'autre à changer : le propriétaire des travaux et des objets est
  posé par le socle.

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
