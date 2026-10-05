'use strict';

/* ============================================================
   Character Factory dans le portail — ce que ses pages partagent
   pour y vivre.

   Le studio (Python, sur DGX1) rend des adresses absolues,
   /files/<slug>/…, faites pour être servies à sa racine. Le portail
   le relaie sous character/ (server/tools/character.py : api, files,
   v1) : une adresse du studio devient relative à la page, qui vit
   dans ce dossier. Les pages marchent ainsi à la racine du portail
   comme sous un sous-chemin (la porte Cloudflare, un jour).
   ============================================================ */

import { mountHeader, system, ongletCache, auRetour } from '../../commun/shell.js';

// « /files/x » rendu par le studio → « files/x », relatif à la page
export const local = (u) => (typeof u === 'string' ? u.replace(/^\/(api|files|v1)\//, '$1/') : u);

// Le résumé d'un personnage porte trois adresses du studio (factory/studio.py : summary).
export function localSummary(s) {
  if (s && typeof s === 'object') {
    for (const k of ['thumb', 'poster', 'voice']) if (s[k]) s[k] = local(s[k]);
  }
  return s;
}

// Le message d'une réponse en erreur : celle du studio ({error: {message}}),
// ou celle du portail ({error: "…"}).
export const errorText = (json) => json?.error?.message || (typeof json?.error === 'string' ? json.error : '');

// L'en-tête du portail, à la place de celui du studio.
export const mount = () => mountHeader('character');

// Onglet caché : les relevés du studio s'arrêtent, et repartent à son retour (commun/shell.js ; chacun passe
// par la porte Cloudflare : docs/etudes/cloudflare.md, « Le compte des requêtes du Worker »).
export { system, ongletCache, auRetour };
