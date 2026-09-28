/* Ressort les images embarquées d'une page Studio déjà publiée, pour pouvoir
   régénérer la page sans les DGX : frames/, overlays/, portraits/. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [, , page, sortie] = process.argv;
const h = readFileSync(page, 'utf8');

const bloc = (nom) => {
  const i = h.indexOf('const ' + nom + ' = ');
  if (i < 0) return {};
  const d = h.indexOf('{', i);
  let p = 0, j = d;
  for (; j < h.length; j++) { if (h[j] === '{') p++; else if (h[j] === '}') { p--; if (!p) { j++; break; } } }
  return JSON.parse(h.slice(d, j));
};

const ecris = (obj, dossier, nomme) => {
  mkdirSync(dossier, { recursive: true });
  let n = 0, octets = 0;
  for (const [cle, uri] of Object.entries(obj)) {
    const b = Buffer.from(String(uri).split(',')[1] || '', 'base64');
    if (!b.length) continue;
    writeFileSync(join(dossier, nomme(cle)), b);
    n++; octets += b.length;
  }
  return { n, ko: Math.round(octets / 1024) };
};

const r = {
  frames: ecris(bloc('FRAMES'), join(sortie, 'frames'), (k) => k + '.jpg'),
  overlays: ecris(bloc('OVERLAYS'), join(sortie, 'overlays'), (k) => k + '.jpg'),
  portraits: ecris(bloc('PORTRAITS'), join(sortie, 'portraits'), (k) => k + '.jpg'),
};
console.log(Object.entries(r).map(([k, v]) => `${k}: ${v.n} fichiers, ${v.ko} Ko`).join(' | '));
