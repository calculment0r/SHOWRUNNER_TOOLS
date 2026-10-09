// SHOWRUNNER TOOLS — les mentions « @ » : UNE grammaire pour la personne, dans tous les outils.
//
// Cal, 09/10 : « il faut que le user puisse le faire tout le temps de la même façon ». On écrit toujours @image1,
// @element2, @video1, @audio1 : une sorte et une place, chaque sorte comptée à part dans l'ordre des entrées (Cal,
// 29/09 : on nomme une PLACE, pas un visuel). Ce que chaque modèle lit (<Subject 1> pour H3, <image1> pour Qwen,
// « the subject » pour Krea 2…) se compile au serveur (server/core/mentions.py : le même motif) ; la page ne pose
// que la grammaire de la personne. Pas de DOM ici.
//
//   TOKEN_RX            le motif (global) ; pas après une lettre, un chiffre, « _ » ni « @ » (une adresse mél)
//   keyOf(cat, n)       'element2'
//   scan(texte)         [{ raw, cat, n, key, start, end }]
//   places(sortes)      ['image', 'element', 'image'] → ['image1', 'element1', 'image2'] (un carrousel mélangé)

export const TOKEN_RX = /(?<![\p{L}\p{N}_@])@([\p{L}_]+)(\d*)/gu;
export const keyOf = (cat, n) => `${String(cat).toLowerCase()}${n}`;
export const tokenOf = (cat, n) => `@${keyOf(cat, n)}`;

export function scan(text) {
  return [...String(text || '').matchAll(TOKEN_RX)].map((m) => ({ raw: m[0], cat: m[1].toLowerCase(), n: Number(m[2] || 0),
    key: keyOf(m[1], m[2]), start: m.index, end: m.index + m[0].length }));
}

export function places(kinds) {
  const seen = {};
  return kinds.map((k) => { seen[k] = (seen[k] || 0) + 1; return keyOf(k, seen[k]); });
}
