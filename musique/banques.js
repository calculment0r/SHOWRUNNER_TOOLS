// ODIO — les banques d'échantillons : quelles zones une note fait sonner, et à
// quel niveau (09/10 ; docs/etudes/odio_synthes.md § 7). Pur, sans DOM ni Web
// Audio : le moteur (moteur.js, SRC.banque) et l'écoute s'en servent.
//
// Une banque est importée par tools/echantillons.py et servie par le portail
// (server/tools/music_banques.py, qui en décrit le manifeste) : ses zones sont
// des régions SFZ aplaties — la cartographie de l'auteur de la banque. Les lois
// sont celles de sfizz (sfztools/sfizz, licence BSD-2), le lecteur SFZ libre
// de référence :
//   - une région joue si la note est dans lokey..hikey et la vélocité dans
//     lovel..hivel (Region.cpp) ;
//   - son tour (seq_length, seq_position) : chaque région compte les notes qui
//     l'ont visée, et ne joue qu'à son tour (Synth.cpp, sequenceSwitched) ;
//   - le niveau selon la vélocité (RegionStateful.cpp, velocityCurve) :
//     g = 1 − t·(1 − v²), v la vélocité sur 0..1, t le suivi (amp_veltrack) ;
//   - les fondus de vélocité xfin / xfout, courbe « power » par défaut
//     (ModifierHelpers.h : √ de la position dans la plage, l'écart d'un cran
//     de vélocité retiré de sa longueur).

const CRAN = 1 / 127;

/** Le fondu d'entrée (xfin_lovel..xfin_hivel) à la vélocité v (0..1). */
export function fonduEntree([lo, hi], v) {
  const a = lo / 127, b = hi / 127;
  if (v < a) return 0;
  const n = b - a - CRAN;
  if (n <= 0) return 1;
  return v < b ? Math.sqrt((v - a) / n) : 1;
}
/** Le fondu de sortie (xfout_lovel..xfout_hivel) à la vélocité v (0..1). */
export function fonduSortie([lo, hi], v) {
  const a = lo / 127, b = hi / 127;
  const n = b - a - CRAN;
  if (n <= 0) return 1;
  if (v > a) {
    const pos = (v - a) / n;
    return pos > 1 ? 0 : Math.sqrt(1 - pos);
  }
  return 1;
}
/** Le niveau d'une région selon la vélocité (0..1) et son suivi t (amp_veltrack, −1..1). */
export function gainVelocite(t, v) {
  const g = Math.abs(t) * (1 - v * v);
  return t < 0 ? g : 1 - g;
}

/**
 * Les zones qu'une note fait sonner : [{ z, gain }]. `note` la note MIDI
 * (après transposition), `vel` 0..1, `tours` une Map gardée par l'instrument
 * (le compteur de chaque zone), `suivi` ce qui multiplie le suivi de vélocité
 * de la banque (le réglage « Dynamique »).
 */
export function zonesDe(banque, note, vel, tours, suivi = 1) {
  const v127 = Math.max(1, Math.min(127, Math.round(vel * 127)));
  const v = v127 / 127;
  const out = [];
  banque.zones.forEach((z, i) => {
    if (note < z.bas || note > z.haut || v127 < z.vbas || v127 > z.vhaut) return;
    const [long, place] = z.rr;
    if (long > 1) {
      const n = tours.get(i) || 0;
      tours.set(i, n + 1);
      if (n % long !== place - 1) return;
    }
    const gain = gainVelocite(z.vt * suivi, v) * fonduEntree(z.xin, v) * fonduSortie(z.xout, v) * Math.pow(10, z.db / 20);
    if (gain > 0) out.push({ z, gain });
  });
  return out;
}

/** Le rapport de lecture d'une zone pour une note : (note − clé) demi-tons + ses cents. */
export const rapport = (z, note, cents = 0) => Math.pow(2, ((note - z.cle) * 100 + z.ct + cents) / 1200);

/** La clé d'un son de banque dans les tampons du moteur. */
export const cleSon = (bid, f) => `bq:${bid}/${f}`;

// Les banques installées sur le portail (GET /api/music/banques), lues une fois
// par page ; `frais` relit (une banque importée pendant que la page est ouverte).
let liste = null;
export function listeBanques(api, { frais = false } = {}) {
  if (frais || !liste) liste = api('music/banques').then((r) => r.banques || []).catch((e) => { liste = null; throw e; });
  return liste;
}
