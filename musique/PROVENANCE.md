# Provenance — `musique/odio/`

Les instruments et effets d'ODIO, le prototype de Cal, repris dans le
studio du portail à sa demande (29/09/2026 : « on peut reprendre les
trucs qu'on avait trouvés pour le proto avec des synthés, reverb, etc. »).

- Source : dépôt **privé** `calculment0r/ODIO_01`, commit `6d8a7ed`
  (« HANDOFF : le site est en ligne… »), cloné en lecture seule sur DGX2
  dans `/tmp/odio01`. SHOWRUNNER_TOOLS est public : la reprise est signalée
  à Cal. Rien d'autre n'est repris (ni polices, ni handoff de design, ni
  interface).
- Chemins d'origine : `packages/engine/src/` — `timing.ts`, `types.ts`,
  `effects/{types,base,reverb,chorus,delay,comp,eq3,filter,drive,crush,table,volume}.ts`,
  `instruments/{analog-synth,acid-bass,drums-voices,rhythm-box,plaits-synth,plaits-wasm}.ts`.
- Conversion : `node:module` `stripTypeScriptTypes(source, { mode: 'strip' })`
  (Node 22 de DGX2, sans npm) — syntaxe effaçable seulement, chaque fichier
  vérifié par `node --check` ; les blancs laissés à la place des types
  restent (les numéros de ligne correspondent à l'original). Script :
  `odio_strip.mjs` (scratchpad de la session du 29/09).
- **Plaits** : `instruments/plaits-wasm.js` porte en base64 le module
  WebAssembly compilé depuis les sources d'Émilie Gillet (Mutable
  Instruments, `pichenettes/eurorack` dossier `plaits` et `pichenettes/stmlib`),
  **licence MIT** — voir `packages/engine/wasm/vendor/PROVENANCE.md` du
  dépôt d'origine, qui garde les notices.
- Non repris : `drum-kit.ts` et `soundfont.ts` (ils téléchargent leurs
  échantillons par `smplr` depuis le réseau : pas de téléchargement ici),
  `aimant.ts` et `alchimie.ts` (un filtre et un volume dont le seul réglage
  en plus règle la scène du prototype, pas le son), `output.ts` (la sortie
  d'ODIO est celle du studio), le séquenceur, le transport et le mixeur
  (le studio a les siens).

## Ce qui a été changé dans les fichiers repris

Chaque changement est marqué `SHOWRUNNER :` dans le code.

| fichier | changement | pourquoi |
|---|---|---|
| `instruments/analog-synth.js` | la chute de l'enveloppe (`linearRampToValueAtTime(0, relâchement + release)`) | le gain tenait le maintien jusqu'à l'arrêt des oscillateurs, qui coupaient net : un clic en fin de note |
| `instruments/analog-synth.js` | `noteOff(note, instant)` | relâcher une note jouée au clavier ou en MIDI, dont la durée n'est pas connue à l'attaque (le contrat d'ODIO n'a que `allNotesOff`) |
| `instruments/acid-bass.js` | `noteOff(note, instant)` | idem, pour la voix monophonique |
| `instruments/plaits-synth.js` | messages `relacher` et `ping` du worklet, méthodes `noteOff` et `ping` | relâcher à la main ; l'export hors temps réel attend que les notes postées au worklet soient arrivées (MessagePort garde l'ordre) |
| `effects/reverb.js` | `flush()` | l'export hors temps réel ne peut pas attendre les 90 ms que la réverbe laisse au geste avant de refaire sa réponse |

L'adaptateur qui présente ces pièces comme des modules du studio est dans
`moteur.js` (`odioSource`, `odioEffect`) ; leurs réglages sont lus sur
leurs descripteurs (`getParameters`) dans `modules.js`.

# Provenance — `musique/banc.js` (le banc sous le nodal)

Demandé par Cal le 29/09 : « en bas du nodal, une image simplifiée de la
timeline avec les pistes, et les lanes d'ODIO_01 ; les attracteurs se
tirent de ce panneau vers le canvas ».

- Source : le même dépôt, même commit. `apps/studio/src/banc/logique.ts`
  (les lanes, la géométrie `ecartBoite`, `poids`, `operateurs`, `membres`,
  les deux têtes) et `apps/studio/src/banc/Banc.tsx` (les gestes et le
  dessin : `PPB = 9`, disque 110, anneaux 260 / 420 / 580, loi 0,25 à 4 par
  `exp(dx / 130)`, fil de Bézier à tangentes verticales, teinte
  `0,08 + 0,14 × poids`), qui tiennent les décisions n° 32 à 85 de
  `docs/logique-globale.md`. Réécrit en JavaScript sans React ; rien n'est
  copié tel quel hors ces constantes et ces formules.
- Ce qui change, et pourquoi :

| ODIO_01 | ici | pourquoi |
|---|---|---|
| le banc ne porte que les cinq lanes | au-dessus, l'arrangement en petit (sections, une rangée par piste et ses clips), à la même échelle | la demande de Cal |
| lanes RYTHME, HARMONIE, TIMBRE, ÉNERGIE, TENSION | les mêmes, hauteurs et écarts gardés ; il n'y a pas de lane « groove » ni « mélodie » dans ODIO_01 — le groove y est la facette de RYTHME (swing, densité, accents), la mélodie celle d'HARMONIE (tonalité, tension) | on prend ce qui est écrit |
| courbe ÉNERGIE de démonstration | l'arc d'énergie du projet (mêmes points) | l'arc est déjà l'énergie du morceau et pilote la sortie |
| horizons fixes par lane (104, 76, 62, 118, 88 temps) | courbes : leur dernier point ; lanes de matière : la fin de l'arrangement | les horizons d'ODIO_01 étaient ceux de son morceau de démonstration |
| tête rouge = son transport | tête rouge = le transport de la DAW (Espace) ; « marche » du banc pilote la tête qui gouverne (n° 80) | un seul temps réel dans le studio |
| blocs = machines ; table `FACETTES` sur leurs contrôles | blocs = cartes du nodal ; table `FACETTES` sur les réglages de nos modules, **à relire par Cal** | nos modules ne sont pas ses machines |
| couleurs en dur (#3f7a9c, #6b5fa8, #b0567f, #3f8a72, #8a6f5a) | jetons existants : `--cy`, `--coral-3`, `--coral-2`, `--grn2`, `--coral-1` | règle du thème : aucune couleur en dur ; les teintes exactes d'ODIO_01 demanderaient cinq jetons dans `commun/tokens.css` |
| opérateurs en lecture seule | en lecture seule | ODIO_01 non plus ne les branche pas au moteur (« le chantier suivant ») |
