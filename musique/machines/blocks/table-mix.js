// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/blocks/table-mix.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * LA TABLE DE MIX — le planogramme, d'après le TASCAM MODEL 12.
 *
 * L'auteur a tranché deux fois : ce n'est pas un bloc, c'est une MACHINE avec
 * un planogramme complet ; et le modèle à prendre est le Model 12. Ce module
 * écrit ce planogramme, en millimètres, comme les treize autres — à ceci près
 * qu'il est CALCULÉ et non extrait d'un fichier de conception : une table n'a
 * pas un nombre de tranches figé, elle en a autant qu'on lui branche de
 * sources.
 *
 * Ce qu'on reprend du Model 12, et pourquoi :
 *
 *   - **la tranche, dans son ordre exact** — TRIM en haut, puis le correcteur
 *     trois bandes (HIGH, MID, LOW), le départ d'effet, le panoramique, les
 *     deux boutons (coupure, écoute seule), et le fader en bas. C'est l'ordre
 *     de la main sur une console : on cadre le niveau qui entre, on corrige,
 *     on envoie à l'effet, on place, on écoute, on dose. Le fader est en bas
 *     parce que c'est l'organe qu'on tient le plus, et le plus grand.
 *   - **une bande de nom sous chaque fader** — le scotch de la console. C'est
 *     elle qui porte l'identité de la source, et c'est tout l'intérêt : à
 *     douze tranches, sans nom, on ne mixe rien.
 *   - **la section d'effet intégrée** — le Model 12 embarque son processeur,
 *     avec un programme et un retour. Les départs des tranches y vont, le
 *     retour revient dans la générale.
 *   - **la tranche générale à droite** — fader principal, casque.
 *
 * Ce qu'on n'en reprend pas : l'enregistreur multipiste, l'interface audio,
 * les transports. ODIO a déjà son transport, et une table n'a pas à en porter
 * un second.
 *
 * Les cotes sont celles du Model 12 réel, ramenées au millimètre : 340 mm de
 * large pour douze tranches, 220 mm de profondeur utile. Une tranche fait
 * 24 mm de large — la largeur d'un fader 60 mm et de son cortège.
 */

                                                                               

/** Largeur d'une tranche, en mm — celle du Model 12. */
export const LARGEUR_TRANCHE = 34
/** Hauteur d'une tranche, en mm. */
export const HAUTEUR_TRANCHE = 210
/** Largeur de la section d'effet et de la générale. */
const LARGEUR_EFFET = 40
const LARGEUR_GENERALE = 36

/**
 * LE NOMBRE MAXIMAL DE TRANCHES.
 *
 * Douze, comme le Model 12 — et ce n'est pas une coquetterie : le compte des
 * sections d'une machine se résout à sa naissance (c'est la règle du canvas),
 * donc les tranches existent toutes au moteur dès la pose. Ce qui varie, c'est
 * combien sont POSÉES sur le canvas : une seule à la création, une de plus à
 * chaque câble lâché sur la table. Le reste attend, sans rien coûter.
 */
export const TRANCHES_MAX = 12

/** L'identifiant d'une tranche, de 1 à `TRANCHES_MAX`. */
export function idTranche(rang        )         {
  return `mix_ch${rang}`
}

/** Le rang d'une tranche depuis son identifiant de section, ou `null`. */
export function rangDeTranche(sectionId        )                {
  const trouve = /^mix_ch(\d+)$/.exec(sectionId)
  return trouve ? Number(trouve[1]) : null
}

export const SECTION_EFFET = "mix_fx"
export const SECTION_GENERALE = "mix_main"

/**
 * Les contrôles d'une tranche, aux cotes du Model 12.
 *
 * Les identifiants portent le rang (`mix_c3_trim`) : deux tranches ont les
 * mêmes organes mais pas les mêmes valeurs, et un identifiant de contrôle est
 * unique dans tout le catalogue — c'est un invariant testé.
 */
function controlesDeTranche(rang        )                   {
  const p = `mix_c${rang}`
  const cx = LARGEUR_TRANCHE / 2
  return [
    // Le gain d'entrée : on cadre AVANT de corriger.
    { kind: "knob", id: `${p}_trim`, label: "trim", x: cx, y: 22, w: 14, h: 14, default: 0.5 },
    // Le correcteur trois bandes, de l'aigu au grave — l'ordre de la console.
    { kind: "knob", id: `${p}_high`, label: "high", x: cx, y: 46, w: 12, h: 12, default: 0.5 },
    { kind: "knob", id: `${p}_mid`, label: "mid", x: cx, y: 66, w: 12, h: 12, default: 0.5 },
    { kind: "knob", id: `${p}_low`, label: "low", x: cx, y: 86, w: 12, h: 12, default: 0.5 },
    // Le départ vers l'effet de la table.
    { kind: "knob", id: `${p}_fx`, label: "fx", x: cx, y: 108, w: 12, h: 12, default: 0 },
    // Le panoramique.
    { kind: "knob", id: `${p}_pan`, label: "pan", x: cx, y: 128, w: 12, h: 12, default: 0.5 },
    // Les deux boutons d'écoute, côte à côte.
    { kind: "button", id: `${p}_mute`, label: "mute", x: 8, y: 140, w: 8, h: 8, default: 0 },
    { kind: "button", id: `${p}_solo`, label: "solo", x: 18, y: 140, w: 8, h: 8, default: 0 },
    // Le fader, l'organe qu'on tient — le plus grand de la tranche.
    { kind: "fader", id: `${p}_fader`, label: "", x: cx - 5, y: 152, w: 10, h: 36, default: 0.78 },
  ]
}

/** Une tranche complète, posée à son rang. */
export function sectionTranche(rang        , nom         )                 {
  return {
    id: idTranche(rang),
    // Le nom de la section EST la bande de scotch : il porte la source dès
    // qu'un câble en désigne une, et le rang tant qu'il n'y en a pas.
    name: nom ?? `${rang}`,
    x: (rang - 1) * LARGEUR_TRANCHE,
    y: 0,
    w: LARGEUR_TRANCHE,
    h: HAUTEUR_TRANCHE,
    // Le nom sous la tranche, comme le scotch sous le fader d'une console.
    tagBottom: true,
    controls: controlesDeTranche(rang),
  }
}

/** La section d'effet : le processeur intégré, son programme et son retour. */
function sectionEffet(x        )                 {
  const cx = LARGEUR_EFFET / 2
  return {
    id: SECTION_EFFET,
    name: "EFFECT",
    x,
    y: 0,
    w: LARGEUR_EFFET,
    h: HAUTEUR_TRANCHE,
    controls: [
      {
        kind: "switch",
        id: "mix_fx_prog",
        label: "programme",
        x: 8,
        y: 24,
        w: LARGEUR_EFFET - 16,
        h: 10,
        options: ["hall", "room", "plate", "delay"],
        default: 0,
      },
      { kind: "knob", id: "mix_fx_time", label: "time", x: cx, y: 50, w: 14, h: 14, default: 0.45 },
      { kind: "knob", id: "mix_fx_tone", label: "tone", x: cx, y: 76, w: 14, h: 14, default: 0.5 },
      { kind: "knob", id: "mix_fx_ret", label: "retour", x: cx, y: 104, w: 16, h: 16, default: 0.6 },
      { kind: "button", id: "mix_fx_on", label: "on", x: cx - 6, y: 122, w: 12, h: 8, default: 1 },
      { kind: "vu", id: "mix_fx_vu", label: "", x: 8, y: 140, w: LARGEUR_EFFET - 16, h: 50, default: 0.3 },
    ],
  }
}

/** La tranche générale : ce qui sort de la table. */
function sectionGenerale(x        )                 {
  const cx = LARGEUR_GENERALE / 2
  return {
    id: SECTION_GENERALE,
    name: "MAIN",
    x,
    y: 0,
    w: LARGEUR_GENERALE,
    h: HAUTEUR_TRANCHE,
    tagBottom: true,
    controls: [
      { kind: "knob", id: "mix_phones", label: "casque", x: cx, y: 24, w: 14, h: 14, default: 0.6 },
      { kind: "vu", id: "mix_vu", label: "", x: 8, y: 42, w: LARGEUR_GENERALE - 16, h: 44, default: 0.4 },
      { kind: "button", id: "mix_mono", label: "mono", x: cx - 6, y: 94, w: 12, h: 8, default: 0 },
      { kind: "button", id: "mix_dim", label: "dim", x: cx - 6, y: 108, w: 12, h: 8, default: 0 },
      { kind: "fader", id: "mix_main_fader", label: "", x: cx - 6, y: 126, w: 12, h: 62, default: 0.8 },
    ],
  }
}

/**
 * LE PLANOGRAMME DE LA TABLE, pour un nombre de tranches donné.
 *
 * Toutes les tranches jusqu'à `TRANCHES_MAX` existent au moteur — leur compte
 * se résout à la naissance, comme celui des pas d'une rangée. Ce que la table
 * MONTRE, c'est ce que l'App a posé sur le canvas.
 */
export function planTable(tranches = TRANCHES_MAX)             {
  const sections                   = []
  for (let rang = 1; rang <= tranches; rang += 1) sections.push(sectionTranche(rang))
  const apres = tranches * LARGEUR_TRANCHE
  sections.push(sectionEffet(apres))
  sections.push(sectionGenerale(apres + LARGEUR_EFFET))
  return {
    id: "mix",
    name: "TABLE DE MIX",
    ref: "odio-o1 · table 12 tranches · cotes réelles — 340 × 210 mm",
    x: 0,
    y: 0,
    w: apres + LARGEUR_EFFET + LARGEUR_GENERALE,
    h: HAUTEUR_TRANCHE,
    sections,
  }
}

/** La table au complet — c'est elle qui entre au catalogue des machines. */
export const TABLE_MIX             = planTable()
