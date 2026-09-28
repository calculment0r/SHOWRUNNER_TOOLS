window.__verif = () => {
  const err = [];
  if (!DIAR) return ['pas de diarisation'];
  const zonesDe = (r, s) => r.cle === vxPisteDe(s) ? vxComplement(0, D, (VX.parts[s] || []).map((p) => [p[0], p[1]])) : (VX.parts[s] || []).filter((p) => p[2] === r.cle).map((p) => [p[0], p[1]]);
  const dess = {};
  for (const r of VX.pistes) if (r.type !== 'brute') for (const s of r.voix) for (const z of zonesDe(r, s)) (dess[s] = dess[s] || []).push([z[0], z[1], r.cle]);
  for (let s = 0; s < DIAR.V; s++) for (const [x, y] of VX.segs[s]) for (let t = x + 0.005; t < y; t += 0.01) {
    const on = (dess[s] || []).filter((z) => z[0] <= t && t < z[1]);
    if (on.length !== 1) { err.push(`V${s + 1} à ${t.toFixed(2)} s : courbe dessinée ${on.length} fois (${on.map((z) => z[2]).join(', ')})`); break; }
  }
  for (const g of VX.lignes) {
    const gs = g.porte !== undefined ? g.porte : g.s;
    if (gs < 0) continue;
    const zs = VX.segs[gs].length && g.s < 0 ? [[g.a, g.b]] : VX.segs[gs];
    for (const [x, y] of zs) { const a = Math.max(x, g.a), b = Math.min(y, g.b);
      for (let t = a + 0.005; t < b; t += 0.01) { if (VX.lignes.some((h) => h !== g && (h.porte !== undefined ? h.porte : h.s) === gs && h.a <= t && t < h.b)) continue; const on = (dess[gs] || []).find((z) => z[0] <= t && t < z[1]);
        if (!on || on[2] !== g.piste) { err.push(`« ${g.texte.slice(0, 28)} » sur ${g.piste} : sa courbe V${gs + 1} à ${t.toFixed(2)} s est sur ${on ? on[2] : 'aucune piste'}`); break; } } }
  }
  return err;
};
window.__lignes = () => VX.lignes.map((g) => `${g.a.toFixed(2)}-${g.b.toFixed(2)} ${g.piste} [${g.source}${g.s >= 0 ? ' V' + (g.s + 1) : ''}] ${g.texte.slice(0, 34)}`);
// centre écran d'une ligne (par texte) et d'une piste
window.__ou = (txt, piste) => { document.querySelector('.vx-corps').scrollIntoView({ block: 'start' }); scrollBy(0, -160); const z = document.getElementById('vx-zone').getBoundingClientRect();
  const b = VX.boites.find((q) => q.g.l.text.includes(txt)); const r = VX.lignesFrise.find((x) => x.cle === piste);
  return { ligne: b && { x: z.left + (b.x0 + b.x1) / 2, y: z.top + (b.y0 + b.y1) / 2, piste: b.piste }, piste: r && { y: z.top + r.y + r.h / 2 } }; };
