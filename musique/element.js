// ODIO — « Publier comme élément » (30/09, docs/etudes/apps_studio_elements.md,
// parcours A). Accroche minimale d'ODIO sur le socle des éléments
// (server/tools/elements.py) : le projet ouvert est la SOURCE ; publier
// enregistre le projet, rend le morceau hors temps réel par le même graphe que
// la lecture et l'export (renderMix : WAV 24 bits, 48 kHz, stéréo), le dépose
// dans la bibliothèque, puis le range comme version n+1 de l'élément du projet
// (fait au premier geste) avec la `rev` rendue : si le projet a bougé pendant le
// rendu, le serveur refuse (409) plutôt que de ranger un son qui ne serait pas
// cette version-là. Le Montage, qui pose une version plus ancienne, voit la
// pastille à son relevé suivant.

import { api, uploadFile, toast, href, el } from '../commun/shell.js';

// l'élément du projet (un seul par source) et l'état de la source (« modifiée depuis la v2 »)
export async function elementOf(pid) {
  const r = await api(`elements?source=${encodeURIComponent(pid)}`);
  return (r.items || [])[0] || null;
}

export function stateLine(e) {
  if (!e) return 'pas encore un élément';
  const s = e.source_state || {};
  const v = e.element.head ? `v${e.element.head}` : 'pas encore publié';
  return s.state === 'modifiée' ? `${v} · modifié depuis la v${s.since}` : s.state === 'à jour' ? `${v} · à jour` : v;
}

// ctx : { S, engine, renderMix, wav24, songEnd, whenSaved, modal, fmtDur }
export async function openPublish(ctx) {
  const { S, modal } = ctx;
  const P = S.proj;
  let e = null;
  try { await ctx.whenSaved(); e = await elementOf(P.id); } catch (err) { toast(`éléments : ${err.message}`, 6000); return; }
  const n = (e?.element.count || 0) + 1;
  const note = el('input', { class: 'fld', maxlength: 400, placeholder: 'ce qui change : refrain court, pont réécrit…', 'aria-label': 'note de publication' });
  const out = el('div', { class: 'mu-export' });
  const empty = ctx.songEnd(P) <= 0;
  const go = el('button', { class: 'tb go', type: 'button', disabled: empty || null,
    title: empty ? 'rien à publier : pose un clip dans l’arrangement' : '' }, `Publier la v${n}`);
  const m = modal({
    title: 'Publier comme élément', wide: true,
    body: [
      el('p', {}, e ? `« ${e.title} » · ${stateLine(e)}. La v${n} sera le morceau entier tel qu’il est maintenant, rendu dans la page (WAV 24 bits, 48 kHz) : les séquences qui posent une version plus ancienne la gardent, et voient qu’une nouvelle existe.`
        : `Ce projet devient un élément (musique) et le morceau entier, rendu dans la page, en est la v1. Il se pose ensuite dans le Montage comme un son ; chaque nouvelle publication y fait paraître une pastille « v2 ».`),
      el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'note de publication'), note),
      out,
    ],
    foot: [e ? el('a', { class: 'tb ghost', href: href('asset/#' + e.id), target: '_blank', rel: 'noopener' }, 'L’élément dans Asset ↗') : null,
      el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: () => m.close() }, 'Fermer'), go],
  });
  setTimeout(() => note.focus(), 30);
  go.addEventListener('click', async () => {
    go.disabled = true;
    const say = (t) => out.replaceChildren(el('p', { class: 'lbl' }, t));
    try {
      say('enregistrement du projet…');
      await ctx.whenSaved();
      const rev = P.rev;
      say('rendu du morceau…');
      const buf = await ctx.renderMix(ctx.engine, P, 0, ctx.songEnd(P), { tail: 2 });
      if (P !== S.proj || P.rev !== rev) throw new Error('le projet a changé pendant le rendu : republie');
      say('dépôt dans la bibliothèque…');
      const title = `${P.name} · v${n}`;
      const it = await uploadFile(new File([ctx.wav24(buf)], `${title.replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 60)}.wav`, { type: 'audio/wav' }),
        { tool: 'music', folder: 'Musique', title });
      if (!e) e = await api('elements', { method: 'POST', body: { title: P.name, type: 'music', source: { tool: 'music', doc: P.id } } });
      const r = await api(`elements/${e.id}/versions`, { method: 'POST', body: { item: it.id, rev, note: note.value.trim() } });
      window.__muLastPublish = { el: e.id, n: r.version.n, item: it.id, rev };
      out.replaceChildren(el('div', { class: 'mu-done' },
        el('div', {}, el('b', {}, `v${r.version.n} de « ${r.element.title} »`), el('span', { class: 'lbl' }, ` ${ctx.fmtDur(buf.duration)}${r.version.note ? ` · ${r.version.note}` : ''}`)),
        el('audio', { src: href(it.url), controls: true, preload: 'metadata' }),
        el('div', { class: 'row' },
          el('a', { class: 'tb ghost', href: href(`montage/?add=${encodeURIComponent(it.id)}`) }, 'Envoyer au montage'),
          el('a', { class: 'tb ghost', href: href('asset/#' + e.id), target: '_blank', rel: 'noopener' }, 'L’élément dans Asset ↗'))));
      toast(`publié : v${r.version.n} de « ${r.element.title} »`, 5000);
      go.textContent = `Publier la v${r.version.n + 1}`;
      go.disabled = false;
    } catch (err) { say(''); toast(`publier : ${err.message}`, 7000); go.disabled = false; }
  });
}
