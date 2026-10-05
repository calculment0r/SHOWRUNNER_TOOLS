// ODIO — le génératif : l'entrée « Générer » et ce que les autres modules en
// partagent.
//
// Depuis le 06/10 (docs/etudes/musique_generatif.md § 8), un seul panneau :
// « Générer » (generatif_panneau.js) — une question en haut (une chanson
// entière, un instrument seul, une variation d'un clip, la suite), les
// valeurs du projet remplies d'office, le résultat en versions dans une région
// d'une piste générative, à la place de la plage. Le tiroir d'avant (un
// morceau entier, YuE2 ou ACE-Step, puis la séparation) en est la réponse
// « Une chanson entière ».
//
// Contrats (tenus par d'autres modules) :
//   les versions   POST /api/music/gen/generate (server/tools/music_gen.py)
//   la partition   POST /api/music/yue/abc, /api/music/yue/abc/check (music_yue.py)
//   séparer        POST /api/music/stems/separate {src, model, stems}
//                  options : GET /api/music/stems/options (music_stems.py)

import { api } from '../commun/shell.js';
import { ouvrirGenerer } from './generatif_panneau.js';

export const STEM_FR = { vocals: 'Voix', drums: 'Batterie', bass: 'Basse', other: 'Autre', guitar: 'Guitare', piano: 'Piano', instrumental: 'Instrumental' };

// les options d'un contrat : { ok, o } ou { ok: false, status, why }. On ne
// les demande que si le travail est déclaré (GET /api/music/engines →
// contracts) : pas de 404 pour rien dans la console.
export async function options(path, job) {
  if (job) {
    let c = null;
    try { c = (await api('music/engines')).contracts; } catch { /* le portail dira pourquoi plus bas */ }
    if (c && !c[job]) return { ok: false, status: 'absent', why: `le travail « ${job} » n'est pas déclaré sur ce portail` };
  }
  try { return { ok: true, o: await api(path) }; } catch (e) { return { ok: false, status: e.status, why: e.message }; }
}
// Le modèle de séparation : celui qu'on a choisi s'il est prêt, sinon celui
// que les options recommandent (le premier prêt de leur liste, rangée par
// qualité mesurée — music_stems.py), sinon le premier prêt.
export function bestStems(o, want = null) {
  const list = Array.isArray(o) ? o : o?.models || [];
  const ok = (x) => x && x.ready !== false;
  const m = [list.find((x) => x.id === want), list.find((x) => x.id === o?.recommended), list.find((x) => x.id === o?.default)]
    .find(ok) || list.find(ok) || null;
  return m ? { id: m.id, name: m.label || m.name || m.id, stems: m.stems || ['vocals', 'drums', 'bass', 'other'], list, engine: o?.engine } : null;
}

// « Générer » (la barre du haut, le menu du projet, le clic droit d'une plage) :
// le panneau, sur la région choisie ou sur la plage (o : { region, quoi, clip })
export function openGenerative(app, o = {}) {
  return ouvrirGenerer(app, o);
}
