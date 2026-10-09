// SHOWRUNNER TOOLS — le MULTISHOT : découper la durée d'une vidéo en plans, un prompt par plan, des répliques par personnage.
//
// Cal, 04/10 : « un grand panneau où l'on a tous les outils : les dialogues, la timeline, les prompts, les références ou éléments
// qu'on peut affecter ; une mini timeline, la durée découpée en plans, réglable avec des poignées ; un mode automatique ». On
// reste en langage naturel : la frise écrit les balises (commun/multishot_texte.js : [Shot n], « (S1) says: <d>[langue] … </d> »).
// Inspiré du nœud « Director » de ComfyUI (Bernini Director : une frise de segments, un prompt par segment ou un prompt global,
// des références par segment). Le guide officiel d'H3 (relu le 09/10) donne la forme du temps de coupe : chaque plan suivant
// commence par « At 00:03.500, » — la durée de chaque plan s'écrit donc toujours (commun/multishot_texte.js, compose).
//
// Cal, 09/10 : « le multishot ne va pas car on ne peut pas drag and drop les éléments ou références dedans car il est en
// pop-up : on va faire que le mode multishot s'affiche en bas au-dessus du fil comme la barre de création pour les images …
// Je n'arrive pas à modifier les longueurs de plan par leurs handles sur la timeline. » Depuis :
//   - un composant qu'une page monte où elle veut (la barre de la page Vidéo) ; la fenêtre ne sert plus qu'à la carte Vidéo
//     d'Idéation (openMultishot, plus bas) ;
//   - la frise est à l'échelle de la plus longue vidéo d'H3 : la vidéo occupe sa durée, le reste montre la place qu'elle
//     peut prendre ; la poignée de fin change sa durée, aimantée aux durées permises (la grille 17k+5) ; une poignée entre
//     deux plans déplace la coupe à l'image près, le total ne bouge pas ; un plan se glisse pour changer de place ;
//   - pendant un glisser, la frise n'est pas redessinée (seules les positions bougent) : la poignée tenue garde la main —
//     la frise d'avant se redessinait au premier mouvement, la poignée sortait de la page, le glisser mourait ;
//   - on dépose un asset sur un plan (ou dans le plan choisi) : la page le range dans ses entrées et la frise écrit son jeton
//     dans le texte du plan ; rien à « écrire dans le prompt » : chaque geste réécrit le prompt de la page (règle 7).
//
//   const M = createMultishot(box, {
//     total: 124,                  // la durée de la vidéo, en images (24 i/s)
//     grid: [124, 141, …],         // les durées permises (/api/movie/options, frames) ; sans, la durée ne se change pas ici
//     shots, desc,                 // les plans gardés ; sinon le prompt, relu ([Shot n]) ou découpé en phrases
//     lang,                        // la langue des répliques
//     mentions: () => [{ token, label, thumb }],   // les entrées nommables : qui parle, les vignettes de chaque plan
//     onchange({ shots, text, lang }),             // à chaque geste
//     ontotal(frames),             // la poignée de fin a changé la durée
//     drop: { kinds, via, onitems(items, i) → Promise<['@element1', …]> },   // un dépôt sur le plan i
//     bindField(textarea),         // le champ du plan choisi : jetons en couleur, menu « @ » (commun/entrees.js)
//   });
//   M.set({ shots, total, desc }) · M.setTotal(frames) · M.get() · M.text() · M.paint() · M.select(i)
//
//   openMultishot({ total, desc, mentions: [{ token, label }], lang, onApply(texte) })   la même frise, dans une fenêtre
//     total : la durée en secondes (la carte la règle elle-même) ; onApply : « Écrire dans le prompt »

import { el, dropZone } from './shell.js';
import { menu } from './menu.js';
import {
  LANG, FPS, MIN_FRAMES, plan, parse, auto, compose, fitFrames, equalFrames, cutFrames, trimEnd, snapTotal, maxShots,
  moveShot, splitFrames, removeFrames, starts,
} from './multishot_texte.js';

const fr = (n) => String(n).replace('.', ',');
const sec = (f) => `${fr(Math.round((f / FPS) * 10) / 10)} s`;
const tc = (f) => fr((f / FPS).toFixed(2));
let cssOn = false;
const css = () => {
  if (cssOn || [...document.querySelectorAll('link[rel=stylesheet]')].some((l) => /commun\/multishot\.css$/.test(l.href))) { cssOn = true; return; }
  cssOn = true;
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./multishot.css', import.meta.url).href }));
};
const clone = (shots) => shots.map((p) => ({ ...p, lines: (p.lines || []).map((l) => ({ ...l })) }));
const TOKS = /(?<![\p{L}\p{N}_@])@[\p{L}_]+\d*/gu;

// les plans de départ : ceux qu'on a gardés, sinon le prompt relu ([Shot n]), sinon ses phrases (trois plans au plus)
function startShots({ shots, desc, total }) {
  if (Array.isArray(shots) && shots.length) {
    const s = clone(shots).map((p) => Object.assign(plan(p.secs || 1, p.text || '', p.lines || []), Number.isFinite(p.frames) ? { frames: p.frames } : {}));
    return fitFrames(s, total);
  }
  const src = String(desc || '').trim();
  if (/\[Shot \d+\]/.test(src)) return fitFrames(parse(src, total / FPS), total);
  if (!src) return equalFrames(3, total);
  const s = auto(src, 3, total / FPS);
  if (s.length === 1) s.push(plan(1));
  return fitFrames(s, total);
}

export function createMultishot(box, o = {}) {
  css();
  const grid = Array.isArray(o.grid) && o.grid.length > 1 ? [...o.grid].sort((a, b) => a - b) : null;
  const S = { total: Math.round(o.total || 124), shots: [], sel: 0, lang: o.lang || 'fr', dropAt: -1 };
  S.shots = startShots({ shots: o.shots, desc: o.desc, total: S.total });
  const mentions = () => (typeof o.mentions === 'function' ? o.mentions() : o.mentions) || [];
  const maxF = () => (grid ? grid[grid.length - 1] : S.total);
  const pct = (f) => `${(f / maxF()) * 100}%`;
  const text = () => compose(S.shots, { lang: S.lang });
  const changed = () => o.onchange?.({ shots: clone(S.shots), text: text(), lang: S.lang });

  // ── les nœuds qui restent : la tête, la frise, le plan choisi ──
  const head = el('div', { class: 'ms-head' });
  const tl = el('div', { class: 'ms-tl', role: 'group' });
  const ruler = el('div', { class: 'ms-ruler', 'aria-hidden': 'true' });
  const tip = el('div', { class: 'ms-tip', hidden: true });
  const tlw = el('div', { class: 'ms-tlw' }, tl, ruler, tip);
  const edHead = el('div', { class: 'ms-ed-h' });
  const ta = el('textarea', { class: 'fld ms-ta', rows: 2, spellcheck: 'false', 'aria-label': 'ce qu’on voit dans ce plan',
    placeholder: 'ce qu’on voit dans ce plan : le cadre, le mouvement, l’action — tapez @ pour une entrée, ou déposez-la ici' });
  const linesBox = el('div', { class: 'ms-lines' });
  const ed = el('div', { class: 'ms-ed' }, edHead, ta, linesBox);
  box.classList.add('ms');
  box.replaceChildren(head, tlw, ed);
  ta.addEventListener('input', () => {
    const p = S.shots[S.sel];
    if (!p || p.text === ta.value) return;
    p.text = ta.value;
    paintSegText();
    changed();
  });
  o.bindField?.(ta);

  // ── la tête : le compte, les gestes de la frise, la langue ──
  function paintHead() {
    const n = S.shots.length;
    const canSplit = n < maxShots(S.total) && S.shots[S.sel]?.frames >= 2 * MIN_FRAMES;
    head.replaceChildren(
      el('span', { class: 'ms-t' }, 'Multishot'),
      el('span', { class: 'lbl ms-n' }, `${n} plan${n > 1 ? 's' : ''} · ${sec(S.total)}`),
      el('button', { class: 'tb ghost sm', type: 'button', disabled: canSplit ? null : true,
        title: canSplit ? 'couper le plan choisi en deux' : `un plan garde au moins ${sec(MIN_FRAMES)} : celui-ci est trop court pour deux`,
        onclick: () => { splitFrames(S.shots, S.sel); changed(); paint(); } }, '+ Plan'),
      el('button', { class: 'tb ghost sm', type: 'button', title: 'la même durée pour chaque plan',
        onclick: () => { fitFrames(S.shots.map((p) => Object.assign(p, { frames: 1 })), S.total); changed(); paint(); } }, 'Durées égales'),
      el('button', { class: 'tb ghost sm', type: 'button', 'aria-haspopup': 'menu', title: 'le mode automatique : le texte des plans, phrase par phrase, en n plans de même durée',
        onclick: (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const all = S.shots.map((p) => p.text).filter(Boolean).join(' ');
          menu(r.left, r.bottom + 4, [{ head: 'découper le texte en' }, ...[2, 3, 4, 5, 6].filter((k) => k <= maxShots(S.total)).map((k) => ({
            label: `${k} plans`, onclick: () => {
              const lines = S.shots.map((p) => p.lines || []);
              const s = fitFrames(auto(all, k, S.total / FPS), S.total);
              lines.forEach((l, i) => { if (l.length) (s[Math.min(i, s.length - 1)].lines ||= []).push(...l); });   // les répliques restent dans leur plan
              S.shots = s; S.sel = 0; changed(); paint();
            } }))]);
        } }, 'Auto…'),
      el('span', { class: 'sp' }),
      el('select', { class: 'fld ms-lang', 'aria-label': 'la langue des répliques', title: 'la langue des répliques',
        onchange: (e) => { S.lang = e.target.value; changed(); } },
      ...Object.entries(LANG).map(([k, v]) => el('option', { value: k, selected: S.lang === k ? true : null }, v))));
  }

  // ── la frise ──
  const N = { segs: [], cuts: [], end: null, rest: null };
  const who = (p) => {   // les entrées que cite le plan (texte et répliques) : leurs vignettes sur le segment
    const toks = new Set([...(p.text || '').matchAll(TOKS)].map((m) => m[0].toLowerCase()));
    for (const l of p.lines || []) if (l.who && l.who.startsWith('@')) toks.add(l.who.toLowerCase());
    return mentions().filter((m) => toks.has(m.token.toLowerCase()));
  };
  function segBody(p, i) {
    const w = who(p);
    return [el('span', { class: 'ms-sl' }, el('b', {}, `Plan ${i + 1}`), el('small', {}, sec(p.frames))),
      el('span', { class: 'ms-sx' }, ...w.slice(0, 4).map((m) => el('i', { class: 'ms-face', title: `${m.token}${m.label ? ' · ' + m.label : ''}`,
        style: m.thumb ? { backgroundImage: `url(${m.thumb})` } : null })), el('span', { class: 'ms-ex' }, (p.text || '').replace(/\s+/g, ' ').trim() || '—'))];
  }
  function paintTl() {
    tl.setAttribute('aria-label', `la vidéo, ${sec(S.total)}, découpée en ${S.shots.length} plans`);
    tl.title = 'chaque plan suivant commence par son temps de coupe, « At 00:03.500, » (le guide officiel d’H3, § 4.2)';
    N.segs = S.shots.map((p, i) => {
      const s = el('button', { class: `ms-seg c${i % 4}${i === S.sel ? ' sel' : ''}`, type: 'button', 'data-i': i,
        title: `plan ${i + 1} · ${sec(p.frames)} — clic : l’éditer · glisser : le déplacer · Alt + ← → : le déplacer` }, ...segBody(p, i));
      s.addEventListener('pointerdown', (e) => dragSeg(e, i));
      s.addEventListener('click', () => { if (s._dragged) { s._dragged = false; return; } select(i); });
      s.addEventListener('dblclick', () => { select(i); ta.focus(); });
      s.addEventListener('keydown', (e) => {
        const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
        if (!d) return;
        e.preventDefault();
        if (e.altKey) { const to = Math.max(0, Math.min(S.shots.length - 1, i + d)); moveShot(S.shots, i, to); S.sel = to; changed(); paint(); }
        else select(Math.max(0, Math.min(S.shots.length - 1, i + d)));
        tl.querySelector(`.ms-seg[data-i="${S.sel}"]`)?.focus();
      });
      return s;
    });
    N.cuts = S.shots.slice(0, -1).map((_, i) => {
      const h = el('div', { class: 'ms-h', role: 'slider', tabindex: 0, 'aria-label': `coupe entre le plan ${i + 1} et le plan ${i + 2}`,
        title: 'glisser : déplacer la coupe, à l’image près · ← → : une image (Maj : une seconde)' });
      h.addEventListener('pointerdown', (e) => dragCut(e, i));
      h.addEventListener('keydown', (e) => {
        const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
        if (!d) return;
        e.preventDefault();
        cutFrames(S.shots, i, d * (e.shiftKey ? FPS : 1));
        changed(); layout();
      });
      return h;
    });
    N.rest = el('div', { class: 'ms-rest', title: grid ? 'la place que la vidéo peut prendre : tirez la fin du dernier plan' : '' },
      ...(grid || []).map((g) => el('i', { class: 'ms-g', 'data-f': g })));
    N.end = grid ? el('div', { class: 'ms-end', role: 'slider', tabindex: 0, 'aria-label': 'la fin de la vidéo : sa durée',
      'aria-valuemin': grid[0], 'aria-valuemax': maxF(),
      title: 'glisser : la durée de la vidéo, aux pas d’H3 (17 images, 0,7 s) · ← → : le pas d’avant, d’après' }) : null;
    if (N.end) {
      N.end.addEventListener('pointerdown', dragEnd);
      N.end.addEventListener('keydown', (e) => {
        const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
        if (!d) return;
        e.preventDefault();
        const ok = grid.filter((g) => g >= S.shots.length * MIN_FRAMES);
        const k = Math.max(0, Math.min(ok.length - 1, ok.indexOf(snapTotal(S.total, ok)) + d));
        setTotal(ok[k], true);
      });
    }
    tl.replaceChildren(N.rest, ...N.segs, ...N.cuts, ...(N.end ? [N.end] : []));
    ruler.replaceChildren(...Array.from({ length: Math.floor(maxF() / FPS) + 1 }, (_, s) => el('i', { style: { left: pct(s * FPS) } }, el('span', {}, String(s)))));
    layout();
  }
  // les positions seules : ce que fait un glisser, sans rien remplacer
  function layout() {
    const at = starts(S.shots);
    S.shots.forEach((p, i) => {
      const s = N.segs[i];
      if (!s) return;
      s.style.left = pct(at[i]);
      s.style.width = pct(p.frames);
      const sm = s.querySelector('.ms-sl small');
      if (sm) sm.textContent = sec(p.frames);
    });
    N.cuts.forEach((h, i) => {
      const f = at[i + 1];
      h.style.left = pct(f);
      h.setAttribute('aria-valuenow', String(f));
      h.setAttribute('aria-valuetext', `${tc(f)} s`);
    });
    if (N.rest) { N.rest.style.left = pct(S.total); N.rest.style.width = `calc(100% - ${pct(S.total)})`; }
    for (const g of N.rest?.children || []) { const f = Number(g.dataset.f); g.hidden = f <= S.total; g.style.left = `${((f - S.total) / Math.max(1, maxF() - S.total)) * 100}%`; }
    if (N.end) { N.end.style.left = pct(S.total); N.end.setAttribute('aria-valuenow', String(S.total)); N.end.setAttribute('aria-valuetext', sec(S.total)); }
    head.querySelector('.ms-n')?.replaceChildren(`${S.shots.length} plan${S.shots.length > 1 ? 's' : ''} · ${sec(S.total)}`);
    const lab = edHead.querySelector('.ms-ed-t');
    if (lab && S.shots[S.sel]) lab.textContent = `Plan ${S.sel + 1} · ${sec(S.shots[S.sel].frames)} · ${S.shots[S.sel].frames} im.`;
  }
  function paintSegText() {
    S.shots.forEach((p, i) => { const s = N.segs[i]; if (s) s.replaceChildren(...segBody(p, i)); });
    layout();
  }
  function showTip(ev, msg) {
    const r = tlw.getBoundingClientRect();
    tip.hidden = false;
    tip.textContent = msg;
    tip.style.left = `${Math.max(0, Math.min(r.width, ev.clientX - r.left))}px`;
  }
  const hideTip = () => { tip.hidden = true; };
  // un glisser : chaque mouvement repart des plans d'avant le geste
  function track(e, node, move, end) {
    e.preventDefault();
    e.stopPropagation();
    node.setPointerCapture?.(e.pointerId);
    box.classList.add('dragging');
    const mv = (ev) => move(ev);
    const up = (ev) => {
      node.removeEventListener('pointermove', mv);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      box.classList.remove('dragging');
      hideTip();
      end(ev);
    };
    node.addEventListener('pointermove', mv);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
  }
  function dragCut(e, i) {
    if (e.button !== 0) return;
    const x0 = e.clientX, w = tl.getBoundingClientRect().width, orig = S.shots.map((p) => p.frames);
    let d = 0;
    track(e, e.currentTarget, (ev) => {
      d = Math.round(((ev.clientX - x0) / w) * maxF());
      S.shots.forEach((p, k) => { p.frames = orig[k]; });
      cutFrames(S.shots, i, d);
      layout();
      const at = starts(S.shots)[i + 1];
      showTip(ev, `coupe à ${tc(at)} s · plan ${i + 1} ${sec(S.shots[i].frames)} · plan ${i + 2} ${sec(S.shots[i + 1].frames)}`);
    }, () => { if (S.shots.some((p, k) => p.frames !== orig[k])) changed(); paint(); });
  }
  function dragEnd(e) {
    if (e.button !== 0) return;
    const x0 = e.clientX, w = tl.getBoundingClientRect().width, t0 = S.total, orig = S.shots.map((p) => p.frames);
    const ok = grid.filter((g) => g >= S.shots.length * MIN_FRAMES);
    track(e, e.currentTarget, (ev) => {
      const t = snapTotal(t0 + ((ev.clientX - x0) / w) * maxF(), ok);
      if (t !== S.total) {
        S.shots.forEach((p, k) => { p.frames = orig[k]; });
        S.total = t;
        trimEnd(S.shots, t);
        layout();
      }
      showTip(ev, `durée ${sec(S.total)} · ${S.total} images${S.total === ok[0] ? ' · la plus courte' : S.total === ok[ok.length - 1] ? ' · la plus longue' : ''}`);
    }, () => {
      if (S.total !== t0) { o.ontotal?.(S.total); changed(); }
      paint();
    });
  }
  function dragSeg(e, i) {
    if (e.button !== 0 || S.shots.length < 2) return;
    const seg = e.currentTarget, x0 = e.clientX;
    let moving = false, to = i;
    seg.setPointerCapture?.(e.pointerId);
    const mv = (ev) => {
      if (!moving && Math.abs(ev.clientX - x0) < 5) return;
      moving = true;
      box.classList.add('dragging');
      seg.classList.add('dragging');
      seg.style.transform = `translateX(${ev.clientX - x0}px)`;
      const r = tl.getBoundingClientRect();
      const f = ((ev.clientX - r.left) / r.width) * maxF();
      const at = starts(S.shots);
      to = Math.max(0, Math.min(S.shots.length - 1, at.findLastIndex((a) => a <= f)));
      N.segs.forEach((s, k) => { s.classList.toggle('drop-before', k === to && to < i); s.classList.toggle('drop-after', k === to && to > i); });
      showTip(ev, to === i ? `plan ${i + 1} : à sa place` : `plan ${i + 1} → place ${to + 1}`);
    };
    const up = () => {
      seg.removeEventListener('pointermove', mv);
      seg.removeEventListener('pointerup', up);
      seg.removeEventListener('pointercancel', up);
      box.classList.remove('dragging');
      hideTip();
      if (!moving) return;   // un clic : le click qui suit choisit le plan
      seg._dragged = true;   // le click qui suit le lâcher ne choisit rien
      if (to !== i) { moveShot(S.shots, i, to); S.sel = to; changed(); }
      setTimeout(paint, 0);
    };
    seg.addEventListener('pointermove', mv);
    seg.addEventListener('pointerup', up);
    seg.addEventListener('pointercancel', up);
  }

  // ── le plan choisi, édité sur place ──
  function paintEd() {
    const p = S.shots[S.sel];
    if (!p) return;
    const n = S.shots.length;
    edHead.replaceChildren(
      el('span', { class: 'lbl ms-ed-t' }, `Plan ${S.sel + 1} · ${sec(p.frames)} · ${p.frames} im.`),
      el('span', { class: 'sp' }),
      el('button', { class: 'tb ghost sm', type: 'button', disabled: S.sel > 0 ? null : true, title: S.sel > 0 ? 'avancer ce plan d’une place' : 'déjà le premier',
        'aria-label': 'avancer ce plan', onclick: () => { moveShot(S.shots, S.sel, S.sel - 1); S.sel--; changed(); paint(); } }, '‹'),
      el('button', { class: 'tb ghost sm', type: 'button', disabled: S.sel < n - 1 ? null : true, title: S.sel < n - 1 ? 'reculer ce plan d’une place' : 'déjà le dernier',
        'aria-label': 'reculer ce plan', onclick: () => { moveShot(S.shots, S.sel, S.sel + 1); S.sel++; changed(); paint(); } }, '›'),
      el('button', { class: 'tb ghost sm', type: 'button', disabled: n > 1 ? null : true,
        title: n > 1 ? 'sa durée passe au plan voisin' : 'il faut au moins un plan',
        onclick: () => { removeFrames(S.shots, S.sel); S.sel = Math.min(S.sel, S.shots.length - 1); changed(); paint(); } }, 'Retirer'));
    if (document.activeElement !== ta && ta.value !== (p.text || '')) {
      ta.value = p.text || '';
      ta.dispatchEvent(new Event('input'));   // le calque des jetons suit (bindField) ; le texte, lui, n'a pas changé
    }
    const ms = mentions();
    const lineRow = (l, k) => {
      const free = l.who && !ms.some((m) => m.token === l.who);
      const pickWho = el('select', { class: 'fld ms-who', 'aria-label': 'qui parle', onchange: (e) => {
        l.who = e.target.value === '__libre' ? ' ' : e.target.value; changed(); paintEd(); paintSegText(); } },
      el('option', { value: '' }, 'personne de nommé (S1)'),
      ...ms.map((m) => el('option', { value: m.token, selected: l.who === m.token ? true : null }, `${m.token}${m.label ? ' · ' + m.label : ''}`)),
      el('option', { value: '__libre', selected: free ? true : null }, 'un autre : je l’écris…'));
      return el('div', { class: 'ms-line' },
        el('div', { class: 'ms-who-w' }, pickWho, free ? el('input', { class: 'fld ms-free', value: l.who.trim(), placeholder: 'ex. the old man', 'aria-label': 'qui parle',
          oninput: (e) => { l.who = e.target.value || ' '; changed(); } }) : null),
        el('input', { class: 'fld ms-say', value: l.text, placeholder: 'la réplique, dans la langue parlée', 'aria-label': 'la réplique',
          oninput: (e) => { l.text = e.target.value; changed(); } }),
        el('button', { class: 'tb ghost sm', type: 'button', 'aria-label': 'retirer cette réplique', title: 'retirer cette réplique',
          onclick: () => { p.lines.splice(k, 1); changed(); paintEd(); } }, '×'));
    };
    linesBox.replaceChildren(...(p.lines || []).map(lineRow),
      el('button', { class: 'tb ghost sm ms-add', type: 'button', title: 'une réplique de ce plan : qui parle, ce qui est dit',
        onclick: () => { (p.lines ||= []).push({ who: ms.find((m) => /element/.test(m.token))?.token || '', text: '' }); changed(); paintEd(); linesBox.querySelector('.ms-line:last-of-type .ms-say')?.focus(); } }, '+ Réplique'));
  }

  function select(i) {
    S.sel = Math.max(0, Math.min(S.shots.length - 1, i));
    N.segs.forEach((s, k) => s.classList.toggle('sel', k === S.sel));
    paintHead();
    paintEd();
    layout();
  }
  function paint() {
    S.sel = Math.max(0, Math.min(S.shots.length - 1, S.sel));
    paintHead();
    paintTl();
    paintEd();
  }

  // ── déposer : sur un plan de la frise, ou dans le plan choisi ──
  if (o.drop) {
    const take = async (items, i) => {
      const toks = (await o.drop.onitems(items, i)) || [];
      const p = S.shots[i];
      if (!p || !toks.length) return;
      const add = toks.filter((t) => !new RegExp(`${t}(?!\\d)`, 'i').test(p.text || ''));
      if (add.length) {
        if (i === S.sel && document.activeElement === ta) {
          const a = ta.selectionStart ?? ta.value.length;
          const pre = ta.value.slice(0, a), post = ta.value.slice(a);
          p.text = `${pre}${pre && !/\s$/.test(pre) ? ' ' : ''}${add.join(' ')}${post && !/^\s/.test(post) ? ' ' : ''}${post}`;
        } else p.text = `${(p.text || '').trim()} ${add.join(' ')}`.trim();
      }
      S.sel = i;
      changed();
      paint();
      ta.value = p.text;
      ta.dispatchEvent(new Event('input'));
    };
    tl.addEventListener('dragover', (e) => {
      const r = tl.getBoundingClientRect();
      const f = ((e.clientX - r.left) / r.width) * maxF();
      const at = starts(S.shots);
      S.dropAt = Math.max(0, Math.min(S.shots.length - 1, at.findLastIndex((a) => a <= f)));
      N.segs.forEach((s, k) => s.classList.toggle('drop-on', k === S.dropAt));
    });
    const clear = () => N.segs.forEach((s) => s.classList.remove('drop-on'));
    tl.addEventListener('dragleave', (e) => { if (!tl.contains(e.relatedTarget)) clear(); });
    addEventListener('drop', clear, true);
    addEventListener('dragend', clear, true);
    dropZone(tl, { kinds: o.drop.kinds, multiple: true, via: o.drop.via, label: 'un plan du multishot', onitems: (items) => take(items, S.dropAt < 0 ? S.sel : S.dropAt) });
    dropZone(ed, { kinds: o.drop.kinds, multiple: true, via: o.drop.via, label: 'le plan choisi', onitems: (items) => take(items, S.sel) });
  }

  function setTotal(frames, fromHere = false) {
    const t = Math.max(S.shots.length * MIN_FRAMES, Math.round(frames));
    if (t === S.total) return;
    S.total = t;
    trimEnd(S.shots, t);
    if (fromHere) o.ontotal?.(t);
    changed();   // les durées des plans ont bougé : la page garde les plans (et le texte, s'il les écrit)
    paint();
  }
  paint();
  return {
    set({ shots, total, desc } = {}) {
      if (total) S.total = Math.round(total);
      S.shots = startShots({ shots, desc, total: S.total });
      S.sel = Math.min(S.sel, S.shots.length - 1);
      paint();
    },
    setTotal: (f) => setTotal(f),
    setLang(l) { S.lang = l; paintHead(); },
    get: () => ({ shots: clone(S.shots), total: S.total, lang: S.lang, text: text() }),
    text,
    paint,
    select,
    refresh: () => { paintSegText(); paintEd(); },   // les entrées ont changé : vignettes, « qui parle »
  };
}

// la même frise dans une fenêtre : la carte Vidéo d'Idéation (ideation/video.js), qui règle sa durée elle-même
export function openMultishot({ total = 10, desc = '', mentions = [], lang = 'fr', onApply = () => {} } = {}) {
  css();
  const body = el('div', { class: 'ms-body' });
  let cur = null;
  const go = el('button', { class: 'tb go', type: 'button', title: 'écrit ces plans dans le prompt de la carte',
    onclick: () => { onApply((cur || M.get()).text); close(); } }, 'Écrire dans le prompt');
  const scrim = el('div', { class: 'scrim ms-scrim', onclick: (e) => { if (e.target === scrim) close(); } },
    el('div', { class: 'modal ms-modal', role: 'dialog', 'aria-label': 'Multishot' }, body,
      el('div', { class: 'ms-foot' }, el('span', { class: 'sp' }), el('button', { class: 'tb ghost', type: 'button', onclick: () => close() }, 'Annuler'), go)));
  const close = () => { scrim.remove(); document.removeEventListener('keydown', key, true); };
  const key = (e) => { if (e.key === 'Escape' && !document.querySelector('.sr-menu')) { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', key, true);
  document.body.append(scrim);
  const M = createMultishot(body, { total: Math.round(total * FPS), desc, mentions: () => mentions, lang,
    onchange: (st) => { cur = st; go.disabled = st.shots.every((p) => !p.text?.trim() && !(p.lines || []).length); } });
  go.disabled = M.get().shots.every((p) => !p.text?.trim() && !(p.lines || []).length);
  return { close };
}

export { plan };
