// ODIO — porté de calculment0r/ODIO_01 @ 6d8a7ed, apps/studio/src/tile/measure.ts
// Types retirés par node:module stripTypeScriptTypes (mode « strip ») ; voir musique/PROVENANCE.md.
/**
 * Mesure de texte exacte, pour décider si une étiquette tient.
 *
 * La règle du handoff — retirer plutôt que comprimer, aucun texte coupé — ne
 * peut pas s'appliquer sur une estimation. Une constante « largeur moyenne
 * d'un caractère » se trompe dès qu'on change de police ou de casse :
 * Microgramma, capitale large et géométrique, occupe environ 9,6px là où une
 * estimation naïve prévoyait 7,6.
 *
 * On mesure donc pour de vrai, avec un canvas hors écran, et on met en cache :
 * une même étiquette est mesurée une fois par session.
 */

const cache = new Map                ()
let context                                  = null
let fontsHooked = false
let fontsReady = false
const listeners = new Set            ()

/**
 * Attend que la fonte gravée soit réellement disponible.
 *
 * `document.fonts.ready` ne suffit pas : il se résout dès que les chargements
 * **en cours** sont terminés, or une `@font-face` en `font-display: swap` n'est
 * demandée qu'à son premier usage — elle n'est donc pas encore comptée au
 * moment où l'on interroge. Les toutes premières mesures portaient alors sur la
 * police de repli, se retrouvaient en cache, et n'en sortaient jamais : le
 * calcul de corps croyait « ONDE » plus étroit qu'il n'est et le débordait de
 * deux pixels. On demande donc la fonte explicitement.
 */
async function awaitFonts()                {
  if (typeof document === "undefined" || !document.fonts) return
  try {
    // SHOWRUNNER : les fontes du portail (commun/tokens.css) au lieu de Microgramma
    await Promise.all([document.fonts.load('16px "Azeret Mono"'), document.fonts.load('16px "Venus Rising"'), document.fonts.load('600 16px "Chakra Petch"')])
  } catch {
    // Fonte absente : les mesures resteront celles du repli — et seront justes.
  }
  try {
    await document.fonts.ready
  } catch {
    /* rien à attendre */
  }
}

function hookFonts()       {
  if (fontsHooked || typeof document === "undefined") return
  fontsHooked = true
  void awaitFonts().then(() => {
    cache.clear()
    fontsReady = true
    for (const listener of listeners) listener()
  })
}

/**
 * Prévient quand les mesures deviennent fiables, pour re-rendre.
 *
 * Vider le cache ne suffit pas : sans nouveau rendu, l'interface garde les
 * tailles calculées sur la police de repli jusqu'au prochain geste.
 */
export function onFontsReady(listener            )             {
  hookFonts()
  if (fontsReady) {
    listener()
    return () => {}
  }
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getContext()                                  {
  if (context) return context
  if (typeof document === "undefined") return null
  context = document.createElement("canvas").getContext("2d")
  hookFonts()
  return context
}

/**
 * Normalise un interlettrage pour le canvas.
 *
 * `ctx.letterSpacing` est une propriété CSS : un zéro sans unité y est REFUSÉ
 * en silence, et la valeur précédente reste en place. Comme le contexte est
 * partagé entre tous les appels, une mesure sans interlettrage héritait alors du
 * `0.13em` de la mesure précédente et se croyait 13% plus large qu'elle n'est —
 * de quoi replier des rails et retirer des étiquettes qui tenaient très bien.
 */
export function cssSpacing(letterSpacing        )         {
  const trimmed = letterSpacing.trim()
  return trimmed === "" || Number.parseFloat(trimmed) === 0 ? "0px" : trimmed
}

/**
 * Largeur d'un texte en pixels.
 *
 * @param font  raccourci CSS `font`, ex. `9px Microgramma, sans-serif`
 * @param letterSpacing interlettrage CSS, ex. `0.13em`
 */
export function measureText(text        , font        , letterSpacing = "0px")         {
  const spacing = cssSpacing(letterSpacing)
  const key = `${font}|${spacing}|${text}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const ctx = getContext()
  if (!ctx) {
    // Hors navigateur (tests, rendu serveur) : estimation prudente, majorée.
    return text.length * 10
  }

  ctx.font = font
  // `letterSpacing` n'est pas supporté partout ; on complète à la main sinon.
  const supportsSpacing = "letterSpacing" in ctx
  if (supportsSpacing) ctx.letterSpacing = spacing

  let width = ctx.measureText(text).width
  if (!supportsSpacing && spacing.endsWith("em")) {
    const em = Number.parseFloat(spacing)
    const size = Number.parseFloat(font)
    if (Number.isFinite(em) && Number.isFinite(size)) width += em * size * text.length
  }

  cache.set(key, width)
  return width
}

/**
 * Met un texte en forme pour Microgramma.
 *
 * Cette police n'a que des capitales dessinées, et ses capitales accentuées
 * contiennent des glyphes cyrilliques (É→Й, Ô→Ф). Tout ce qu'on y compose doit
 * donc être mis en capitales **et** débarrassé de ses diacritiques : « réso »
 * devient « RESO ». C'est la contrainte de la fonte, pas un choix éditorial.
 */
export function engrave(text        )         {
  // SHOWRUNNER : la fonte des capitales d'ici (Azeret Mono) porte ses accents —
  // on ne garde que la mise en capitales (règle 5 du thème : les capitales
  // sont pour la machine). L'original, pour Microgramma, suit.
  return text.toUpperCase()
}
export function engraveMicrogramma(text        )         {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
}

/** Les familles du portail (commun/tokens.css : --f-mono, --f-disp), écrites pour le canvas. */
export const MONO = '"Azeret Mono", ui-monospace, monospace'
export const DISP = '"Venus Rising", "Chakra Petch", sans-serif'
/** --f-ui : le texte des cartes du nodal (le nom d'un bloc, les valeurs). */
export const UI = '"Chakra Petch", "Saira Semi Condensed", sans-serif'
/**
 * Police du nom de tuile, telle que définie dans nodal.css (SHOWRUNNER : au
 * lieu de Microgramma). C'est aussi celle du plancher de lisibilité
 * (legible.js) : le rhabillage du 29/09 ne la change pas. Une section de
 * machine l'écrit (étiquette de machine : mono, capitales, espacée — règle 5 du
 * thème) ; le nom d'un bloc est écrit comme celui des cartes du nodal d'avant
 * (--f-ui, 600), à trois corps selon la hauteur de l'en-tête (`nomDeCarte`).
 */
export const TILE_NAME_FONT = `9px ${MONO}`
export const TILE_NAME_SPACING = "0.13em"
export const CARD_NAME_SPACING = "0px"
/** Le corps du nom d'une carte pour une hauteur d'en-tête (23 px au plus, tileBody) : 12, 11, 9 px. */
export function nomDeCarte(head        )         {
  const size = head >= 20 ? 12 : head >= 16 ? 11 : 9
  return `600 ${size}px ${UI}`
}
/** L'étiquette à droite de l'en-tête (le réglage exposé) : celle des cartes, `.lbl`. */
export const TILE_SUB_FONT = `7.5px ${MONO}`
export const TILE_SUB_SPACING = "0.14em"
/** Police de la référence gravée. */
export const TILE_REF_FONT = `8px ${MONO}`
