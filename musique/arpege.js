// ODIO — l'arpégiateur des instruments mélodiques (Synthé, Analog, Basse
// acide, Numérique). Un module pur : il ne touche ni au projet ni au son.
//
// Un motif de notes devient la suite de ses accords égrenés : à chaque pas de
// l'arpège (sa « division »), les notes TENUES à cet instant forment une
// liste, étendue sur 1 à 4 octaves ; on y prend la suivante selon le mode.
// L'arpège s'applique au moment de planifier (moteur.js, Graph.notes, et
// l'aperçu du navigateur) : ce qu'on entend est ce qu'on exporte, et le motif
// écrit ne change pas — éteindre l'arpège rend ses accords.
//
// La grammaire est celle des arpégiateurs courants : un mode (montant,
// descendant, aller-retour, ordre joué, hasard, accord), une division, une
// étendue en octaves, la durée de la note jouée en part du pas (le « gate »).
// Les règles précises sont les nôtres, écrites ici (pas une recette sourcée) :
//   - l'ordre « joué » range les notes par leur attaque (puis par hauteur) ;
//     les autres modes, par hauteur ;
//   - « va-et-vient » ne répète pas les deux bouts (do mi sol mi do mi sol…) ;
//   - « hasard » est tiré d'une graine fixe par pas : deux lectures, et
//     l'export, jouent la même suite (le motif bouclé la rejoue à l'identique) ;
//   - « accord » rejoue toutes les notes tenues à chaque pas (un hachage) ;
//   - quand plus rien n'est tenu, l'arpège reprend au début de sa liste ;
//   - la vélocité, l'accent (`ac`) viennent de la note tenue ; la liaison
//     (`sl`) ne passe pas : une note d'arpège est toujours redéclenchée.
// Les unités : un pas de motif est une double croche (4 par noire), comme
// partout dans ODIO (modules.js, motifs).

export const ARP_MODES = ['Non', 'Monte', 'Descend', 'Va-et-vient', 'Joué', 'Hasard', 'Accord'];
// la division : sa durée en doubles croches (t. = triolet)
export const ARP_DIVS = [['1/4', 4], ['1/8', 2], ['1/8 t.', 4 / 3], ['1/16', 1], ['1/16 t.', 2 / 3], ['1/32', 0.5]];
const MONTE = 1, DESCEND = 2, VAVIENT = 3, JOUE = 4, HASARD = 5, ACCORD = 6;

// un entier tiré d'un pas, toujours le même (mélange d'entiers de Wang)
function graine(k) {
  let x = (k + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * Les réglages d'arpège d'un module, ou null s'il est éteint.
 * `val(k)` lit un réglage (sa valeur, sinon son défaut).
 */
export function reglagesArpege(val) {
  const mode = Math.round(val('arp') || 0);
  if (!mode) return null;
  return {
    mode,
    pas: (ARP_DIVS[Math.round(val('arp_div'))] || ARP_DIVS[3])[1],
    oct: Math.max(1, Math.min(4, Math.round(val('arp_oct') || 1))),
    gate: Math.max(0.05, Math.min(1, val('arp_gate') ?? 0.5)),
  };
}

/**
 * Les notes d'un motif ({ s, l, p, v, ac?, sl? }, en doubles croches sur
 * `steps` pas) devenues un arpège. Rend un tableau neuf ; `notes` n'est pas touché.
 */
export function arpeger(notes, steps, r) {
  if (!r || !notes?.length) return notes || [];
  const out = [];
  const n = Math.floor(steps / r.pas + 1e-9);
  let i = 0;
  for (let k = 0; k < n; k++) {
    const s = k * r.pas;
    const tenues = notes.filter((x) => x.s <= s + 1e-9 && x.s + x.l > s + 1e-9);
    if (!tenues.length) { i = 0; continue; }
    const rangees = r.mode === JOUE ? [...tenues].sort((a, b) => a.s - b.s || a.p - b.p) : [...tenues].sort((a, b) => a.p - b.p);
    // une hauteur n'y est qu'une fois (deux notes identiques tenues ensemble)
    const vues = new Set(), base = [];
    for (const x of rangees) if (!vues.has(x.p)) { vues.add(x.p); base.push(x); }
    const liste = [];
    for (let o = 0; o < r.oct; o++) for (const x of base) liste.push({ p: x.p + 12 * o, v: x.v ?? 0.8, ac: x.ac });
    const l = r.pas * r.gate;
    if (r.mode === ACCORD) {
      for (const x of liste) out.push({ s, l, p: x.p, v: x.v, ...(x.ac ? { ac: true } : {}) });
      i++;
      continue;
    }
    const N = liste.length;
    let j;
    if (r.mode === DESCEND) j = N - 1 - (i % N);
    else if (r.mode === VAVIENT) { const L = Math.max(1, 2 * N - 2); const q = i % L; j = q < N ? q : L - q; }
    else if (r.mode === HASARD) j = graine(k) % N;
    else j = i % N;   // monte, joué
    const x = liste[j];
    out.push({ s, l, p: x.p, v: x.v, ...(x.ac ? { ac: true } : {}) });
    i++;
  }
  return out;
}

// Le motif joué d'un module : le sien, ou son arpège. Mis de côté par motif
// (un motif d'un clip est relu à chaque tranche planifiée, 40 fois par
// seconde) ; l'empreinte suit les notes et les réglages, une retouche refait.
const DEJA = new WeakMap();
export function motifJoue(pat, val) {
  const r = reglagesArpege(val);
  if (!r || !pat?.notes?.length) return pat;
  let e = `${r.mode}|${r.pas}|${r.oct}|${r.gate}|${pat.steps}|${pat.notes.length}`;
  let h = 0;
  for (const x of pat.notes) h = (h * 31 + x.s * 131 + x.l * 17 + x.p * 7 + Math.round((x.v ?? 0.8) * 100) + (x.ac ? 1 : 0)) % 1000000007;
  e += `|${h}`;
  const d = DEJA.get(pat);
  if (d && d.e === e) return d.motif;
  const motif = { ...pat, notes: arpeger(pat.notes, pat.steps, r) };
  DEJA.set(pat, { e, motif });
  return motif;
}
