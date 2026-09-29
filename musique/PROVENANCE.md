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
