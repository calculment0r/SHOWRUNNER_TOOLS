// LES FACETTES DES RÉGLAGES — ce qu'un réglage a de rythmique, d'harmonique,
// de timbral (ODIO_01, docs/logique-globale.md n° 54 et 66 : « chaque bloc
// déclare ce qu'il a de chaque thème, facette par facette » ; « c'est la
// déclaration qui décide, pas le type de bloc »). Pur, sans import : le
// moteur, le banc, le nodal, la garde (server/tools/music_attracteurs.py) et
// tout module qui s'ajoute le lisent.
//
// LA RÈGLE (09/10, Cal : « il y a plein de nodes qui ne semblent pas être pris
// en compte par nos paramètres d'attracteurs ») : la facette n'est plus une
// table à part (FACETTES_MODULES du 29/09, qui oubliait tout module neuf) mais
// une propriété DÉCLARÉE de chaque réglage, dans la définition de son module :
//
//   sortes: { <clé du réglage>: '<sorte>' }            // modules.js, jouets/defs.js…
//   sortes: { <clé>: ['<sorte>', '<facette>'] }        // une facette propre, dite en commentaire
//
// La SORTE dit ce qu'est le réglage (une coupure, une enveloppe, un niveau…) :
// c'est un fait, qu'on vérifie sur le module. La table SORTES dit ce que la
// sorte a de chaque thème : un défaut raisonné, À RELIRE PAR CAL (question
// ouverte n° 6 d'ODIO_01, comme la table du 29/09 dont elle garde chaque choix),
// ou « hors attracteurs », avec la raison. Un réglage DISCRET (`opts` : une
// forme d'onde, un type de filtre, une gamme) est hors attracteurs d'office :
// l'opérateur `neutre + (valeur − neutre) × poids` n'a pas de milieu entre
// deux choix, et qu'un attracteur fasse basculer un choix par un seuil n'est
// documenté ni par ODIO_01 ni par nos études — exclu, et dit.
//
// La garde (check.py → music_attracteurs) échoue si un réglage CONTINU d'un
// module n'a pas pris position (ni sorte, ni sorte connue), ou si une sorte est
// déclarée pour une clé que le module n'a pas.

/** Les facettes des trois lanes de matière (banc/logique.ts d'ODIO_01, LANES) : RYTHME, HARMONIE, TIMBRE. */
export const FACETTES = ['swing', 'densité', 'accents', 'tonalité', 'tension', 'matière', 'brillance'];

/**
 * LES SORTES ET LEUR FACETTE PAR DÉFAUT — à relire par Cal, sorte par sorte :
 * changer une ligne change chaque réglage de cette sorte, dans tous les
 * modules. `facette: null` : hors attracteurs, `pourquoi` le dit. Les
 * précédents cités sont la table du 29/09 (FACETTES_MODULES) et celle
 * d'ODIO_01 (FACETTES, sur les contrôles des machines) ; « proposition » :
 * aucun des deux n'en dit rien.
 */
export const SORTES = {
  // — HARMONIE
  hauteur: { facette: 'tonalité', pourquoi: 'la note jouée : octave, transposition, note racine (29/09 : synth.oct, sampler.root ; ODIO_01 : ml_v1pitch)' },
  desaccord: { facette: 'tension', pourquoi: 'l\'écart entre deux hauteurs : désaccord, vibrato (29/09 : synth.det, analog.detune ; ODIO_01 : ml_v2xmod)' },
  glisse: { facette: 'tension', pourquoi: 'le chemin d\'une note à la suivante (portamento) — proposition' },
  // — TIMBRE
  coupure: { facette: 'brillance', pourquoi: 'ce qui borne le haut du spectre : coupure, ton, amorti (29/09 : synth.cut, filtre.cutoff ; ODIO_01 : ml_cut)' },
  aigu: { facette: 'brillance', pourquoi: 'les aigus d\'un égaliseur, leur gain ou leur fréquence (29/09 : eq3.high)' },
  resonance: { facette: 'matière', pourquoi: 'la résonance d\'un filtre (29/09 : synth.res, filtre.reso ; ODIO_01 : ml_res)' },
  saturation: { facette: 'matière', pourquoi: 'drive, bits, biais, la part du son saturé (29/09 : satura.drive, crush.bits ; ODIO_01 : ml_drive)' },
  forme: { facette: 'matière', pourquoi: 'le contenu de l\'onde : harmoniques, morph, bruit, part d\'un oscillateur (29/09 : plaits.harmo, plaits.morph ; ODIO_01 : ml_mshape)' },
  enveloppe: { facette: 'matière', pourquoi: 'attaque, déclin, tenue, chute, quantité d\'enveloppe (29/09 : synth.fenv ; ODIO_01 : ml_ega, mf_eatt)' },
  accord: { facette: 'matière', pourquoi: 'l\'accord d\'une percussion : sa couleur, pas une note — n° 54, « la boîte à rythme n\'a rien de tonal »' },
  bande: { facette: 'matière', pourquoi: 'un égaliseur hors des aigus : gain, fréquence, largeur d\'une bande — proposition' },
  modulation: { facette: 'matière', pourquoi: 'un LFO, un chorus, un pleurage : vitesse, profondeur — proposition' },
  espace: { facette: 'matière', pourquoi: 'réverbération et écho : durée, taille, retour, pré-délai, part d\'effet — proposition' },
  // — RYTHME
  accent: { facette: 'accents', pourquoi: 'l\'accent d\'une note (29/09 : acid.accent ; ODIO_01 : tr_scat)' },
  dynamique: { facette: 'accents', pourquoi: 'un compresseur règle l\'écart entre les coups et le reste — proposition' },
  cadence: { facette: 'densité', pourquoi: 'combien d\'évènements : débit, nombre de billes, temps d\'écho (ODIO_01 : tr_fill) — proposition' },
  duree: { facette: 'densité', pourquoi: 'la durée d\'une note émise ou arpégée, une attente avant la note — proposition' },
  mouvement: { facette: 'densité', pourquoi: 'la physique d\'un jouet (gravité, rebond, friction) décide quand ses notes partent — proposition' },
  swing: { facette: 'swing', pourquoi: 'le balancement des doubles croches (ODIO_01 : tr_shuf)' },
  // — hors attracteurs
  niveau: { facette: null, pourquoi: 'un niveau : ODIO_01 (logique.ts, FACETTES) — « le volume, le tempo, les leds n\'ont rien à dire à un attracteur » ; l\'énergie est la lane ÉNERGIE' },
  pano: { facette: null, pourquoi: 'la place dans le champ stéréo : aucune lane d\'ODIO_01 n\'en parle' },
  arc: { facette: null, pourquoi: 'un réglage de l\'arc d\'énergie : la lane ÉNERGIE le tient' },
  routage: { facette: null, pourquoi: 'un envoi, une coupure : le câblage a ses propres gestes' },
};

/** La raison de tout réglage discret. */
export const HORS_DISCRET = 'réglage discret : un choix n\'a pas de milieu entre le neutre et la valeur, et le faire basculer par un seuil n\'est pas documenté';

/**
 * Pose sur chaque réglage d'un module ce qu'il déclare : `sorte`, `facette`
 * (un nom, `null` hors attracteurs, `undefined` s'il n'a pas pris position)
 * et `hors` (la raison, quand il n'a pas de facette). Rend des copies : un
 * réglage partagé entre modules (l'arpège) peut prendre position autrement
 * dans chacun.
 */
export function declarer(params, sortes = {}) {
  return params.map((s) => {
    const d = sortes[s.k];
    const [sorte, propre] = Array.isArray(d) ? d : [d, undefined];
    if (s.opts) return { ...s, sorte: sorte || null, facette: null, hors: HORS_DISCRET };
    const S = sorte && SORTES[sorte];
    if (!S) return { ...s, sorte: sorte || null, facette: undefined, hors: sorte ? `sorte inconnue : ${sorte}` : 'n\'a pas pris position' };
    const facette = propre !== undefined ? propre : S.facette;
    return { ...s, sorte, facette, hors: facette ? null : S.pourquoi };
  });
}

/**
 * CE QUE LA GARDE REFUSE, module par module : un réglage continu sans sorte,
 * une sorte inconnue, une facette propre qui n'en est pas une, une sorte
 * déclarée pour une clé absente. Rend [{ type, k, pourquoi }] — vide quand
 * tout a pris position.
 */
export function sansPosition(MODULES) {
  const out = [];
  for (const [type, def] of Object.entries(MODULES)) {
    const cles = new Set(def.params.map((s) => s.k));
    for (const s of def.params) {
      if (s.opts) continue;
      if (s.facette === undefined) out.push({ type, k: s.k, pourquoi: s.hors || 'n\'a pas pris position' });
      else if (s.facette !== null && !FACETTES.includes(s.facette)) out.push({ type, k: s.k, pourquoi: `facette inconnue : ${s.facette}` });
    }
    for (const k of Object.keys(def.sortes || {})) if (!cles.has(k)) out.push({ type, k, pourquoi: 'une sorte pour un réglage que le module n\'a pas' });
  }
  return out;
}
