# Musique, l'app — une chanson par prompt (29/09/2026)

Demande de Cal (29/09) : « je ne vois toujours pas mon onglet music du coup qui
est le générateur de song avec nos outils libres dont j'ai parlé et donc la
séparation de stems reste possible mais envoie vers le studio ODIO et il faudra
un autre abonnement.. » ; plus tôt (`apps_studio_elements.md`) : « faire de la
musique (simple avec prompt, fonctions de base de YuE (ou YuE2), avec quand même
la possibilité de pouvoir mettre une réf son pour faire une cover ou s'en
inspirer) ».

**Statut** : codé, essayé en moteurs factices sur une copie de DGX2
(`/tmp/sr_chanson`, port 8861). **Aucun rendu de modèle, aucun téléchargement.**
Le câblage réel est écrit et jugé à vide (graphes contre l'`/object_info` du
ComfyUI de DGX2, rien en file ; import du script des paroles sans GPU).

| | |
|---|---|
| page | `chanson/` (`index.html`, `chanson.js`, `chanson.css`, `prefs.json`, `pilote.mjs`) |
| carte de l'accueil | **Musique** — « une chanson par prompt » (côté Apps) |
| serveur | `server/tools/chanson.py` (routes, travaux, selftest), `server/tools/chanson_paroles.py` (script lancé dans le venv d'ACE-Step) |
| touchés | `server/tools/music_yue.py` (`fake_render`, le rendu d'essai partagé), `server/tools/music_stems.py` (`submit`, la mise en file partagée) |

Le nom du dossier : `musique/` est ODIO (le Studio). `chanson` ne tombe sous
aucune règle d'EasyPrivacy ni d'EasyList qui vise une page ou un appel de même
origine (vérifié sur `/tmp/easyprivacy.txt` et `/tmp/easylist.txt` de DGX2 : les
seules règles touchées sont `*$ping,third-party` et une règle `$popup` bornée à
d'autres domaines).

## 1. Ce que la page fait

- **Le rail** : le style (texte, et des mots à cocher — « pop », « piano »,
  « voix féminine »… qui écrivent le mot anglais que lisent les modèles, leurs
  exemples étant en anglais) ; **Chanté / Instrumental** ; les paroles, et
  **Écris-les pour moi** ; la **durée** (30 s, 1, 2, 3 min) ; la **qualité**
  (**Rapide**, **Soigné**) ; une **référence son** facultative (déposer, Asset,
  disque) à **Reprendre** ou dont **S'en inspirer** ; **Paramètres avancés**
  fermés (le modèle, la précision ou le tempo et la tonalité selon le modèle, la
  langue du chant, une durée exacte, 1 à 4 versions, la graine) ; **Créer**, le
  seul orange, qui dit pourquoi il est désactivé.
- **Tes chansons** : les rendus en file et en cours en tête (place, départ
  estimé, Arrêter, Relancer) ; chaque chanson : lecture, **forme d'onde** (clic :
  écouter à partir de là ; ses couleurs sont celles des jetons, lues sur le
  canvas), **Variante** (la même recette, une autre graine, la chanson en
  parent), **Séparer les pistes**, **Ouvrir dans ODIO** ; ses pistes séparées
  s'écoutent seules, au même instant. Menu ⋯ et clic droit : reprendre les
  réglages, copier la partition (YuE2), Asset, télécharger, corbeille (Ctrl+Z).
- Tout est rangé dans Asset (`tool: chanson`, dossier Musique), avec la recette
  dans `params.chanson`.

## 2. Les mots simples et les modèles derrière

| la page dit | le modèle | pourquoi (source) |
|---|---|---|
| **Rapide** | ACE-Step 1.5 XL base, par ComfyUI (le gabarit officiel, `server/workflows/music_ace15_xl_base.json`) | « l'outil des régions courtes et des itérations », 29 s à froid sur DGX2 (`musique_generatif.md` § 2.4, `orchestration.md:231`) |
| **Soigné** | YuE2 3B bf16, par ComfyUI (nœuds du cœur) | WildSongBench : SongBench 6,73 pour YuE2 contre 6,01 pour ACE-Step 1.5 (`~/YuE/README.md`, « Benchmarks ») |
| **Reprendre** | YuE2 seul (la qualité passe à Soigné, Rapide dit pourquoi) | « YuE2 has no direct audio-upload argument » ; SheetSage2 transcrit la mélodie, YuE2 la rechante en `melody` (`~/YuE/docs/covers.md`, `generation-and-covers.md:121`) |
| **S'en inspirer** | ACE-Step seul : le timbre de la référence par `ReferenceTimbreAudio` (ComfyUI) | `reference_audio` « for style transfer or continuation tasks » (`~/ACE-Step-1.5/docs/en/INFERENCE.md:376`) ; le nœud ComfyUI est **expérimental** (`comfy_extras/nodes_ace.py`), écrit dans `music_gen.build_ace_graph`, **jamais rendu** |
| **Écris-les pour moi** | le modèle de langue d'ACE-Step 1.5 (LM 5 Hz 1,7B, déjà sur disque), `create_sample` | le « Simple Mode / Inspiration Mode » : une description → légende, **paroles**, tempo, tonalité (`INFERENCE.md`, « create_sample ») ; YuE2, lui, n'écrit pas de paroles (entrée `lyrics` seulement) |

Un préréglage = un modèle : le choix du modèle dans les avancés **est** le
préréglage (une seule vérité, serveur : `PRESETS` de `chanson.py`).

## 3. Ce que les modèles savent faire (documentation)

| | YuE2 (`github.com/multimodal-art-projection/YuE`, `92a73cc`) | ACE-Step 1.5 (`github.com/ace-step/ACE-Step-1.5`, `97ac511`) |
|---|---|---|
| style | texte libre : langue, genre, voix, tempo, instruments (`docs/generation.md:7`) | `caption`, 512 signes (`INFERENCE.md`, GenerationParams) |
| paroles | par sections `[Verse]`, `[Chorus]`… ; vides = instrumental | `lyrics` 4096 signes ; `[Instrumental]` sans voix |
| durée | `max_duration` 0,04-900 s, **un maximum** (la chanson peut finir avant) — l'app : 10 à 900 s | `duration` 10-600 s — l'app : 10 à 600 s |
| tempo, tonalité | pas d'entrée : dans la partition (`Q:`, `K:`) et le style | `bpm` 30-300, `keyscale` (le nœud ComfyUI les exige : l'app lit le tempo dans le style, sinon 120 ; C major par défaut, réglables dans les avancés) |
| langues | exemples en anglais et en mandarin (README) ; **le français : non documenté** — l'app écrit la langue en tête du style (« French, … ») | « 50+ languages » (`README.md:45,62`) ; `language` du nœud (`music.LANGS`) |
| référence son | reprise par la partition (SheetSage2) ; pas d'ICL (`generation-and-covers.md:17`) | `reference_audio`, `cover` (`audio_cover_strength` 0,2 pour un transfert de style) par le serveur d'API du dépôt — **pas câblé** ; `ReferenceTimbreAudio` par ComfyUI — câblé, jamais rendu |
| écrire les paroles | non | `create_sample` (Python), ou `sample_query` de `/release_task` (qui rend aussi le son) |
| licence des poids | CC BY-NC 4.0 | non relevée ici |

## 4. Séparer, ouvrir dans ODIO : le Studio

- **Séparer les pistes** : `POST /api/chanson/stems` met en file `music.stems`
  (`music_stems.submit`, `tool: chanson`) avec le modèle que ses options
  recommandent (le premier prêt de BS-RoFormer SW → chaîne RoFormer +
  htdemucs_ft → htdemucs_ft ; `stems.md` § 4). Les pistes, calées à
  l'échantillon sur la chanson, se rangent sous elle (`params.src`), pas dans la
  liste.
- **Ouvrir dans ODIO** : `POST /api/chanson/odio` écrit un projet ODIO
  (version 2, jugé par `music.validate`) : la chanson sur sa piste (muette si
  ses pistes sont là), puis une piste audio par stem — la forme exacte de
  `app.addTrack('audio')` d'ODIO (`musique/musique.js:148-177` : un lecteur
  `player`, sa tranche, la sortie ; couleurs de `STEM_COLOR`), toutes au temps
  0, de la longueur du son au tempo du projet. Le tempo et la tonalité : ceux de
  la partition (`Q:`, `K:`, que YuE2 écrit), sinon de la recette (ACE-Step),
  sinon 120. La page part sur `musique/?p=<id>` (ODIO ouvre le projet demandé :
  `musique.js:1511`). Le même projet revient tant que les pistes n'ont pas
  changé (`<data_dir>/chanson/odio.json`).
- **Le droit Studio** n'existe pas encore dans la porte. L'app lit
  l'information simple proposée par l'étude (`apps_studio_elements.md` § 3.6) :
  `"access": "studio"` sur la personne dans `auth.json` ; un admin l'a toujours ;
  la porte coupée (essais) vaut Cal. Sans le droit : les deux boutons portent
  « STUDIO », disent pourquoi et ouvrent un panneau « Demander le Studio » ; la
  demande est écrite dans le journal du portail (Admin → Journal) et gardée
  (`<data_dir>/chanson/studio_demandes.json`) ; le serveur refuse (403) les deux
  routes.

**Ce qu'il faudrait dans la porte** (hors de ce chantier) : `access` accepté par
`auth.set_user` et montré dans Admin (fiche d'une personne, à côté des quotas) ;
la demande de Studio parmi les demandes d'Admin (accepter / refuser) ;
`_studio_only` dans `auth.gate` (les préfixes Studio, dont
`/api/music/projects`, `/api/music/stems`, et les sortes de travaux Studio de
`POST /api/jobs`) ; `GET /api/auth/me` qui rend `access`. `chanson.py` lit alors
le même champ, rien à changer.

## 5. Routes, travaux, interrupteurs

| route | |
|---|---|
| `GET /api/chanson/options` | préréglages, modèles (moteur, prêt ou pourquoi, durées), gestes de référence, langues, tonalités, paroles, séparation, Studio |
| `GET /api/chanson/list?limit=` | mes chansons, chacune avec ses pistes séparées et son projet ODIO |
| `POST /api/chanson/create` `{prompt, vocal, lyrics, duration, preset, ref, ref_mode, n, seed, adv: {language, bpm, key \| precision}}` | le travail `chanson.ace` ou `chanson.yue` ; une valeur hors bornes, un réglage qui ne compte pas pour le modèle : 400 avec la raison |
| `POST /api/chanson/variant {item}` | la recette de la chanson, une autre graine, une version |
| `POST /api/chanson/paroles {prompt, language}` | le travail `chanson.paroles` → `result.lyrics` |
| `POST /api/chanson/stems {item}` · `POST /api/chanson/odio {item}` | Studio (403 sinon) |
| `POST /api/chanson/studio/demande` | demander le Studio |
| `GET /api/chanson/onde/<id>` | 480 pics (ffmpeg, mono 8 kHz), gardés sous l'identifiant de l'objet |

| travail | factice (défaut, voie `cpu`) | réel (voie `audio`) | interrupteur |
|---|---|---|---|
| `chanson.ace` | `music.test_tone` (arpège + grosse caisse, tempo, tonalité, durée) ; « s'en inspirer » : mêlé à la référence filtrée et bouclée (ffmpeg) | graphe de `music_gen.build_ace_graph` (`n` = batch_size, `ReferenceTimbreAudio` pour s'en inspirer), jugé contre `/object_info` avant l'envoi | `"music_engine": "ace-step"` (existant) |
| `chanson.yue` | `music_yue.fake_render` (une partition d'essai dans le dialecte de YuE2, chantée en sinus) | `music_yue.render_real` (reprise : SheetSage2 → partition → YuE2) | `"music_yue": true` (existant) |
| `chanson.paroles` | des vers d'essai (français, anglais), sections `[Verse]` `[Chorus]` `[Outro]` | `chanson_paroles.py` dans `~/ACE-Step-1.5/.venv` (backend PyTorch, hors ligne, poids sur disque seulement), épinglé au ComfyUI local de la voie audio (jeton GPU), arrêt par PID | `"chanson_paroles": true` (neuf, Admin → Câblage) ; réglages `chanson_acestep_dir`, `chanson_acestep_python`, `chanson_paroles_lm` |
| `music.stems` | filtres ffmpeg | Demucs / RoFormer | `"music_stems": true` (existant) |

## 6. Vérifié le 29/09 (DGX2, copie `/tmp/sr_chanson` = origin/main `b3e32c0` + ces fichiers)

- `python3 tools/check.py` : **1343 passés, 0 en échec** (dont le selftest de
  `chanson.py` : bornes et refus, les quatre gestes jusqu'à la bibliothèque,
  variante, paroles, séparation, projet ODIO jugé par `music.validate`, un ami
  refusé au Studio, un accès studio ou un admin acceptés).
- Graphes réels jugés contre l'`/object_info` du ComfyUI :8188 de DGX2 (rien en
  file) : Rapide, S'en inspirer (`ReferenceTimbreAudio`), Soigné, Reprendre
  (`SheetSage2AudioToABC`) — **aucun problème**.
- `chanson_paroles.py` en `check` dans le venv d'ACE-Step, GPU masqué
  (`CUDA_VISIBLE_DEVICES=`) : `create_sample` et `LLMHandler.initialize`
  importés, leurs paramètres ceux qu'on passe, le LM 1,7B sur disque.
- Pilote Playwright (`chanson/pilote.mjs`, Chromium sans affichage sur DGX2) :
  **35/35** — un seul orange, avancés fermés, aucun nom de modèle hors des
  avancés, mots cochés (un mot entier), Écris-les pour moi, Créer, écouter (la
  lecture avance, clic au milieu de la forme d'onde = 0:15), variante, reprendre
  une chanson choisie dans Asset (la qualité passe à Soigné), séparer (4 pistes,
  qui s'écoutent seules), ouvrir dans ODIO (5 pistes audio, chaque stem, la page
  d'ODIO ouvre le projet), Studio fermé (options interceptées : le bouton le dit
  et mène à la demande), thèmes sombre et clair, 1440 px et mobile sans
  défilement horizontal.

## 7. Ce qui attend Cal

1. **Brancher** (Admin → Câblage, puis `tools/portail.sh restart`) :
   `music_engine: ace-step` (Rapide, S'en inspirer), `music_yue: true` (Soigné,
   Reprendre), `chanson_paroles: true` (Écris-les pour moi), `music_stems: true`
   (Séparer). **Aucun téléchargement n'est nécessaire à l'app** : ACE-Step XL
   base (9,97 Go) est dans le ComfyUI de DGX2, YuE2 et SheetSage2 sur les deux
   DGX, le LM 1,7B d'ACE-Step dans `~/ACE-Step-1.5/checkpoints`.
2. **Premiers rendus** (quand Cal le dit) : une chanson Rapide de 60 s, une
   Soignée, une reprise ; **S'en inspirer** est le plus incertain (nœud
   expérimental, jamais rendu) — à écouter d'abord ; si le timbre ne passe pas,
   la voie documentée est `reference_audio` / `cover` 0,2 du serveur d'API
   d'ACE-Step (question 6 de `apps_studio_elements.md`).
3. **À approuver, facultatif** : ACE-Step 1.5 **base** (4,79 Go, déjà listé dans
   `REPRISE.md`) ne sert pas à l'app (il sert à ODIO : une piste seule,
   compléter) ; BS-RoFormer SW (699 Mo, `stems.md` § 5) rendrait les pistes
   meilleures.
4. **Accroches communes** (à poser par qui tient ces fichiers) :
   `commun/shell.js`, `TOOLS` :
   `{ id: 'chanson', k: 'SR—11', name: 'Musique', path: 'chanson/', sub: 'une chanson par prompt · reprise', tier: 'app' }`
   (d'ici là, la page pose son nom elle-même dans l'en-tête) ; la carte de
   l'accueil **Musique** vers `chanson/` ; une ligne dans
   `docs/ARCHITECTURE.md` § 7 (table des outils).
5. **Non documenté, à écouter** : YuE2 en français ; des paroles d'ACE-Step
   (`[Verse 1]`, numérotées) chantées par YuE2 (sa documentation montre
   `[Verse]`).

## 8. Relire la partition avant de chanter (05/10/2026)

Demande de Cal (05/10) : « dans la partie musique on devait pas avoir un mode de
validation de ce que le modèle va faire avant de le calculer ? notre modèle
"qualité" le fait. on met ce modèle par défaut aussi. »

**Ce que c'est, d'après le code et les études.** Le modèle « qualité » est
**Soigné** (YuE2, sous « Qualité » dans le rail ; bf16, la précision « qualité »).
YuE2 écrit d'abord une **partition ABC** lisible (`YuE2GenerateABC` : voix Vocal et
Ins, accords, `Q:` tempo, `M:` mesure, `K:` tonalité, sections `% verse`), puis
la chante ; son entrée `abc` prend « an edited score » (`nodes_yue2.py:53`) —
c'est le « white-box » de `~/YuE/docs/editing.md`, et ce que Cal disait le 29/09 :
« ça génère d'abord une partition et donc qu'on peut modifier... avant
génération !! » (`musique_generatif.md` § 1.2-1.4). ODIO l'avait déjà en
option (la case Partition d'une région YuE2, « Écrire la partition ») ; l'app
Musique ne l'avait pas : Soigné chantait d'un trait, et Rapide était le défaut.

**Ce qui change.**

| où | avant | maintenant |
|---|---|---|
| app Musique | Rapide par défaut ; Créer rend tout de suite | **Soigné par défaut** ; « Relire la partition avant de chanter » **coché** : l'orange dit « Écrire la partition » (travail `chanson.plan`), la carte de la partition s'affiche en tête des chansons (tempo, mesure, tonalité, mesures, durée ; une bande par section ; les accords et le premier vers de chaque section ; le texte ABC modifiable, relu par `POST /api/chanson/plan/lire`), puis l'orange dit « Chanter cette partition » : la recette porte `abc`, YuE2 la chante telle quelle (pas de `YuE2GenerateABC` dans le graphe) ; changer le style ou les paroles la périme (Réécrire, ou La garder). Une forme gardée dans le navigateur avant ce jour revient une fois à Soigné et à « relire » (`FORM_V`). |
| app Musique, Reprendre | SheetSage2 → YuE2 d'un trait | la mélodie de la référence (SheetSage2, « melody ») s'affiche d'abord, se relit, puis se chante ; la référence reste en parent |
| ODIO, tiroir « Générer » (YuE2, déjà le défaut) | Lancer chantait d'un trait | « relire avant de chanter » coché : Lancer fait d'abord écrire la partition (`music.yue.abc`), elle se relit dans le tiroir, Lancer la chante (`abc`) |
| ODIO, région YuE2 (chanson) | Générer, la partition facultative | sans partition, l'orange est « Écrire la partition » ; « Sans relire » à côté ; la partition écrite, l'orange redevient « Générer » |

**Là où ce n'est pas possible, et pourquoi.** Rapide et S'en inspirer (ACE-Step 1.5) :
pas de plan lisible — ACE-Step compose et rend d'un même geste ; son modèle de
langue 5 Hz prépare des codes audio internes (`generate_audio_codes` du nœud
ComfyUI), qui « restent dans leur adaptateur » (`musique_generatif.md` § 2.1,
§ 6). La case est grisée et le dit. La reprise d'ODIO (tâche « reprise d'un
clip ») n'a pas d'entrée `abc` dans le schéma : elle garde sa transcription.

**Réserves.** Le plan réel (`run_plan_real`, `music_yue.run_abc_real`) lit la
partition sur la sortie texte de `PreviewAny` : **à vérifier au premier rendu**
(`yue.md` § 4). Le temps : un passage de plus par ComfyUI (12,7 s de plan pour
60 s de chanson, mesuré par le dépôt autonome sur DGX1), le rendu, lui, saute
l'étape du plan. Les « paroles de YuE ignorées » (REPRISE, premier geste n° 2)
ne sont pas résolues : la carte de la partition aidera à le voir (les sections
du plan suivent-elles les paroles ?). Un LoRA YuE2 (NAR) un jour : son auteur
déconseille l'ABC avec lui (README du Trainer, `musique_generatif.md` § 5.1).
Essayé en moteurs factices : selftest de `chanson.py`, pilote `chanson/pilote.mjs`.
