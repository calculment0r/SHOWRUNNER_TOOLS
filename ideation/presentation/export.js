// IDÉATION · PRÉSENTATION — exporter la présentation en PDF, et en images, depuis le mode.
//
// Le travail `presentation.pdf` (server/tools/presentation_pdf.py) : Chromium sans affichage, sur la
// machine du portail, imprime LA page de lecture (lecture.html?print, scene.js) — le même rendu que
// ce mode, chaque diapositive à son état final, à la taille de sa scène — et range le PDF dans la
// bibliothèque (un document, dossier « Idéation »), avec en option une image PNG par diapositive.
//
// Dans la barre du mode : « Exporter en PDF », et son menu (▾) : le PDF et les images, les images
// seules, imprimer depuis ce navigateur. Une action impossible dit pourquoi et ce qui la débloque
// (règle 7) : Chromium absent de la machine du portail (GET /api/ideation/presentation/pdf), une
// police dont la licence ne permet pas le PDF (lue sur les scènes du plan : scene.js, fontsOf — les
// images restent possibles), aucune diapositive, un aperçu de modèle ou une passe assistée en cours
// (le PDF est celui de la planche enregistrée), un export déjà en route.
// La progression : le relevé commun de la file (jobs.watch), la ligne de travail du portail (jobRow) ;
// fini : télécharger le PDF, les images (.zip, la route d'Asset), les voir dans Asset.

import { el, toast, href, api, jobs, jobRow } from '../../commun/shell.js';
import { menu } from '../../commun/menu.js';
import { fontsOf } from './scene.js';

const FINIS = ['done', 'error', 'cancelled', 'interrupted'];
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const safeName = (s) => String(s || 'presentation').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'presentation';

// ctx : { app, frames() (les diapositives montrées), outline (le plan : ses scènes en petit),
//         busy(short) → la raison d'attendre (un aperçu, une passe) ou '', printView(), host (où poser le panneau) }
export function exporter(ctx) {
  const { app } = ctx;
  let st = null;          // la machine du portail : { ok, why, refused_fonts }
  let job = null;         // le dernier export lancé d'ici
  let unwatch = null;
  let pending = false;

  const mainB = el('button', { class: 'tb ghost sm pm-expb', type: 'button', onclick: () => start({ pdf: true, png: false }) }, 'Exporter en PDF');
  const moreB = el('button', { class: 'tb ghost sm pm-expm', type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'les autres exports',
    title: 'le PDF et les images, les images seules, imprimer depuis ce navigateur', onclick: () => openMenu() }, '▾');
  const wrap = el('span', { class: 'pm-exp' }, mainB, moreB);
  const panel = el('section', { class: 'pm-expp', hidden: true, 'aria-label': 'l’export de la présentation', 'aria-live': 'polite' });
  ctx.host.append(panel);

  // ── ce qui empêche ──────────────────────────────────────
  // les polices du plan dont la licence refuse le PDF : { family, why, slides: [1, 3] }
  function refusedFonts() {
    const bad = new Map((st?.refused_fonts || []).map((f) => [f.family, f]));
    if (!bad.size) return [];
    const out = new Map();
    ctx.outline.querySelectorAll('.pm-row .pm-scene').forEach((sc, k) => {
      for (const fam of fontsOf(sc)) if (bad.has(fam)) {
        if (!out.has(fam)) out.set(fam, { ...bad.get(fam), slides: [] });
        out.get(fam).slides.push(k + 1);
      }
    });
    return [...out.values()];
  }
  // la raison d'une action impossible, '' sinon ; `short` : la ligne écrite sous une entrée du menu
  function why({ pdf }, short = false) {
    if (!st) return 'on demande à la machine du portail si elle sait imprimer…';
    if (!st.ok) return short ? 'Chromium absent de la machine du portail — Admin → Diagnostics'
      : `Chromium n’est pas disponible sur la machine du portail : ${st.why} — Admin → Diagnostics → « Présentation · PDF » le cherche`;
    if (!ctx.frames().length) return short ? 'aucune diapositive (+ Diapositive)' : 'aucune diapositive à exporter : le panneau Diapositives en fait (+ Diapositive)';
    const b = ctx.busy(short);
    if (b) return b;
    if (pending || (job && !FINIS.includes(job.state))) return short ? 'un export est déjà en route' : 'un export de cette présentation est déjà en route (son avancée sous la barre)';
    if (pdf) {
      const bad = refusedFonts();
      if (bad.length) {
        const f = bad[0];
        const where = `${f.slides.length > 1 ? 'diapositives' : 'diapositive'} ${f.slides.join(', ')}`;
        return short ? `${f.family} (${where}) : sa licence ne permet pas le PDF — un modèle aux polices OFL le permet`
          : `PDF impossible : ${f.family} (${where}) — ${f.why}. `
            + 'Un modèle (onglet Modèles : polices OFL) ou une police OFL dans ce style le permet ; les images PNG seules restent possibles (▾).';
      }
    }
    return '';
  }

  function paint() {
    const w = why({ pdf: true });
    mainB.setAttribute('aria-disabled', w ? 'true' : 'false');
    mainB.title = w || 'une page par diapositive, dans son état final, à la taille de la scène : texte et formes vectoriels — rangé dans Asset (dossier Idéation)';
    moreB.setAttribute('aria-disabled', 'false');
  }

  function openMenu() {
    const r = moreB.getBoundingClientRect();
    const wp = why({ pdf: true }, true), wi = why({ pdf: false }, true);
    menu(r.left, r.bottom + 4, [
      { head: 'exporter' },
      { label: 'PDF', sub: 'vectoriel', disabled: !!wp, why: wp, onclick: () => start({ pdf: true, png: false }) },
      { label: 'PDF et une image par diapositive', sub: 'png', disabled: !!wp, why: wp, onclick: () => start({ pdf: true, png: true }) },
      { label: 'Une image par diapositive', sub: 'png', disabled: !!wi, why: wi, onclick: () => start({ pdf: false, png: true }) },
      '-',
      { label: 'Imprimer depuis ce navigateur', sub: 'un onglet', onclick: () => ctx.printView() },
    ], { focusFirst: true });
  }

  // ── lancer, suivre ──────────────────────────────────────
  async function start(opts) {
    const w = why(opts);
    if (w) { toast(w, 7000); return; }
    const b = app.S.board;
    if (!b) return;
    pending = true;
    paint();
    try {
      // le PDF est celui de la planche enregistrée : ce qui attend de partir part d'abord
      try { await app.flushSave?.(); } catch { /* le refus se dit dans la barre de la planche */ }
      job = await api(`ideation/boards/${b.id}/pdf`, { method: 'POST', body: opts });
    } catch (e) {
      toast(`export : ${e.message}`, 7000);
      return;
    } finally {
      pending = false;
      paint();
    }
    show();
    unwatch?.();
    unwatch = jobs.watch((list) => {
      const j = list.find((x) => x.id === job?.id);
      if (!j) return;
      const was = job.state;
      job = { ...job, ...j };
      if (FINIS.includes(j.state) && !FINIS.includes(was)) finish();
      else paintPanel();
    });
  }
  async function finish() {
    unwatch?.(); unwatch = null;
    try { job = await jobs.get(job.id); } catch { /* la fiche relue plus tard */ }
    paint();
    paintPanel();
    if (job.state === 'done') toast(`export prêt : ${job.result?.note || job.title}`, 5000);
  }
  function show() { panel.hidden = false; paintPanel(); }
  function hide() { panel.hidden = true; }

  function paintPanel() {
    if (!job || panel.hidden) return;
    panel.dataset.job = job.id;
    const items = job.items || [];
    const pdf = items.find((it) => it.kind === 'document');
    const imgs = items.filter((it) => it.kind === 'image');
    const acts = [];
    if (job.state === 'done') {
      if (pdf) acts.push(el('a', { class: 'tb ghost sm', href: href(pdf.url), download: `${safeName(pdf.title)}.pdf`, title: 'le PDF sur cet ordinateur' }, 'Télécharger le PDF'));
      if (imgs.length) acts.push(el('button', { class: 'tb ghost sm', type: 'button', title: 'les images dans un .zip', onclick: () => zip(imgs) }, `Images · ${imgs.length} (.zip)`));
      const first = pdf || imgs[0];
      if (first) acts.push(el('a', { class: 'tb ghost sm', href: href(`asset/#${first.id}`), target: '_blank', rel: 'noopener', title: 'la fiche dans Asset (dossier Idéation)' }, 'Dans Asset ↗'));
    }
    const warn = job.state === 'done' ? (job.result?.warnings || []) : [];
    panel.replaceChildren(
      el('div', { class: 'pm-exph' }, el('span', { class: 'lbl' }, 'export'), el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', type: 'button', title: 'fermer (l’export continue dans la file)', 'aria-label': 'fermer', onclick: () => hide() }, '×')),
      jobRow(job),
      job.state === 'done' && job.result?.note ? el('p', { class: 'pm-expn' }, job.result.note.split(' — ')[0]) : null,
      ...warn.map((x) => el('p', { class: 'pm-expw' }, x)),
      acts.length ? el('div', { class: 'pm-expa' }, ...acts) : null);
  }
  async function zip(list) {
    try {
      const z = await api('asset/zip', { method: 'POST', body: { ids: list.map((it) => it.id) } });
      const a = el('a', { href: href(z.url), download: z.name });
      document.body.append(a); a.click(); a.remove();
    } catch (e) { toast(`zip : ${e.message}`, 6000); }
  }

  async function refresh() {
    try { st = await api('ideation/presentation/pdf'); } catch (e) { st = { ok: false, why: e.message, refused_fonts: [] }; }
    paint();
  }

  return { el: wrap, paint, refresh, close: () => { unwatch?.(); unwatch = null; hide(); }, get job() { return job; }, get state() { return st; }, why };
}
