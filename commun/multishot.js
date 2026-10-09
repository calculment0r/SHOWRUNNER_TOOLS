// SHOWRUNNER TOOLS — le panneau MULTISHOT : découper une durée en plans, un prompt par plan, des répliques par personnage.
//
// Cal, 04/10 : « un grand panneau où l'on a tous les outils : les dialogues, la timeline, les prompts, les références ou éléments
// qu'on peut affecter ; une mini timeline, la durée découpée en plans, réglable avec des poignées ; un mode automatique ». On
// reste en langage naturel : le panneau écrit les balises (commun/multishot_texte.js : [Shot n], « (S1) says: <d>[langue] … </d> »).
// Inspiré du nœud « Director » de ComfyUI (Bernini Director : une frise de segments, un prompt par segment ou un prompt global,
// des références par segment). Le guide officiel d'H3 (relu le 09/10) donne la forme du temps de coupe : chaque plan suivant
// commence par « At 00:03.500, » — la durée de chaque plan s'écrit donc toujours (commun/multishot_texte.js, compose).
//
//   openMultishot({ total, desc, mentions: [{ token, label }], lang, onApply(texte) })
//     total : la durée du plan en secondes (le curseur Durée de la page) ; desc : le prompt actuel (relu en plans s'il a des [Shot])
//     mentions : les entrées nommables de la page (@element1 …) : les personnages qu'une réplique peut nommer

import { el } from './shell.js';
import { LANG, MIN_SECS, plan, equal, auto, parse, compose, moveEdge, split, remove } from './multishot_texte.js';

const r1 = (x) => Math.round(x * 10) / 10;
const fmt = (s) => `${String(r1(s)).replace('.', ',')} s`;
let cssOn = false;
const css = () => {
  if (cssOn) return;
  cssOn = true;
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./multishot.css', import.meta.url).href }));
};

export function openMultishot({ total = 10, desc = '', mentions = [], lang = 'fr', onApply = () => {} } = {}) {
  css();
  const S = { mode: 'plans', shots: parse(desc, total), sel: 0, n: 3, lang, free: desc };
  if (S.shots.length === 1 && !S.shots[0].text && !S.shots[0].lines.length) S.shots = equal(3, total);
  if (S.shots.length === 1) S.free = S.shots[0].text;

  const box = el('div', { class: 'ms-body' });
  const scrim = el('div', { class: 'scrim ms-scrim', onclick: (e) => { if (e.target === scrim) close(); } },
    el('div', { class: 'modal ms-modal', role: 'dialog', 'aria-label': 'Multishot' }, box));
  const close = () => { scrim.remove(); document.removeEventListener('keydown', key, true); };
  const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', key, true);

  const text = () => (S.mode === 'auto' ? auto(S.free, S.n, total) : S.shots);
  const out = () => compose(text(), { lang: S.lang });

  // ── la frise ──
  function timeline() {
    const tl = el('div', { class: 'ms-tl', role: 'group', 'aria-label': `la durée de ${fmt(total)}, découpée en plans` });
    let at = 0;
    const shots = text();
    shots.forEach((p, i) => {
      const left = (at / total) * 100, w = (p.secs / total) * 100;
      const cls = `ms-seg c${i % 4}${S.mode === 'plans' && i === S.sel ? ' sel' : ''}`;
      tl.append(el('button', { class: cls, type: 'button', style: { left: `${left}%`, width: `${w}%` },
        title: S.mode === 'plans' ? 'choisir ce plan' : '', onclick: () => { if (S.mode === 'plans') { S.sel = i; paint(); } } },
      el('b', {}, `Plan ${i + 1}`), el('small', {}, fmt(p.secs))));
      at += p.secs;
      if (S.mode === 'plans' && i < shots.length - 1) {
        const h = el('div', { class: 'ms-h', role: 'slider', tabindex: 0, 'aria-label': `limite entre le plan ${i + 1} et le plan ${i + 2}`,
          'aria-valuemin': 0, 'aria-valuemax': r1(total), 'aria-valuenow': r1(at), style: { left: `${(at / total) * 100}%` },
          title: 'glisser : déplacer la limite · flèches : ± 0,1 s (Maj : ± 1 s)' });
        h.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          h.setPointerCapture(e.pointerId);
          const x0 = e.clientX, a0 = S.shots[i].secs, b0 = S.shots[i + 1].secs, w = tl.getBoundingClientRect().width;
          const mv = (ev) => {
            const d = ((ev.clientX - x0) / w) * total;
            const x = Math.max(MIN_SECS - a0, Math.min(b0 - MIN_SECS, d));
            S.shots[i].secs = r1(a0 + x);
            S.shots[i + 1].secs = r1(b0 - x);
            paintTl();
          };
          const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); paint(); };
          h.addEventListener('pointermove', mv);
          h.addEventListener('pointerup', up);
        });
        h.addEventListener('keydown', (e) => {
          const d = { ArrowLeft: -0.1, ArrowRight: 0.1 }[e.key];
          if (!d) return;
          e.preventDefault();
          moveEdge(S.shots, i, d * (e.shiftKey ? 10 : 1));
          paint();
          box.querySelectorAll('.ms-h')[i]?.focus();
        });
        tl.append(h);
      }
    });
    const ruler = el('div', { class: 'ms-ruler', 'aria-hidden': 'true' });
    for (let s = 0; s <= Math.floor(total); s++) ruler.append(el('i', { style: { left: `${(s / total) * 100}%` } }, el('span', {}, String(s))));
    return el('div', { class: 'ms-tlw' }, tl, ruler);
  }
  function paintTl() {   // pendant un glissé : seulement la frise et l'aperçu
    const old = box.querySelector('.ms-tlw');
    if (old) old.replaceWith(timeline());
    const pre = box.querySelector('.ms-pre');
    if (pre) pre.textContent = out();
  }

  // ── le plan choisi : son texte, ses répliques ──
  function editor() {
    const p = S.shots[S.sel];
    if (!p) return el('div');
    const who = (l, k) => {
      const sel = el('select', { class: 'fld ms-who', 'aria-label': 'qui parle', onchange: (e) => {
        l.who = e.target.value === '__libre' ? ' ' : e.target.value; paint(); } },
      el('option', { value: '' }, 'personne de nommé (S1)'),
      ...mentions.map((m) => el('option', { value: m.token, selected: l.who === m.token ? true : null }, `${m.token}${m.label ? ' · ' + m.label : ''}`)),
      el('option', { value: '__libre', selected: l.who && !mentions.some((m) => m.token === l.who) ? true : null }, 'un autre : je l’écris…'));
      const free = l.who && !mentions.some((m) => m.token === l.who)
        ? el('input', { class: 'fld ms-free', value: l.who.trim(), placeholder: 'ex. the old man', 'aria-label': 'qui parle',
          oninput: (e) => { l.who = e.target.value || ' '; const pre = box.querySelector('.ms-pre'); if (pre) pre.textContent = out(); } }) : null;
      return el('div', { class: 'ms-who-w' }, sel, free);
    };
    return el('div', { class: 'ms-ed' },
      el('div', { class: 'row' }, el('span', { class: 'lbl' }, `Plan ${S.sel + 1} · ${fmt(p.secs)}`), el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { split(S.shots, S.sel); paint(); } }, 'Couper en deux'),
        el('button', { class: 'tb ghost sm', type: 'button', disabled: S.shots.length < 2 ? true : null,
          title: S.shots.length < 2 ? 'il faut au moins un plan' : 'la durée du plan passe au voisin',
          onclick: () => { remove(S.shots, S.sel); S.sel = Math.min(S.sel, S.shots.length - 1); paint(); } }, 'Supprimer ce plan')),
      el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'Ce qu’on voit dans ce plan (cadre, mouvement, action)'),
        el('textarea', { class: 'fld', rows: 3, spellcheck: 'false',
          placeholder: 'Ex. Wide shot of the carrefour at dusk, the camera cranes down slowly. @element1 sits on the terrace.',
          oninput: (e) => { p.text = e.target.value; const pre = box.querySelector('.ms-pre'); if (pre) pre.textContent = out(); } }, p.text)),
      el('div', { class: 'ms-lines' }, el('span', { class: 'lbl' }, 'Répliques de ce plan'),
        ...p.lines.map((l, k) => el('div', { class: 'ms-line' }, who(l, k),
          el('input', { class: 'fld ms-say', value: l.text, placeholder: 'ce qui est dit, dans la langue parlée', 'aria-label': 'la réplique',
            oninput: (e) => { l.text = e.target.value; const pre = box.querySelector('.ms-pre'); if (pre) pre.textContent = out(); } }),
          el('button', { class: 'tb ghost sm', type: 'button', 'aria-label': 'retirer cette réplique',
            onclick: () => { p.lines.splice(k, 1); paint(); } }, '×'))),
        el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { p.lines.push({ who: mentions[0]?.token || '', text: '' }); paint(); } }, '+ Réplique')));
  }

  function paint() {
    const shots = text();
    box.replaceChildren(
      el('div', { class: 'ms-head' }, el('span', { class: 'ms-t' }, 'Multishot'),
        el('div', { class: 'seg', role: 'group', 'aria-label': 'mode' },
          ...[['auto', 'Auto'], ['plans', 'Plan par plan']].map(([v, lab]) => el('button', { class: 'tb' + (S.mode === v ? ' on' : ''), type: 'button',
            'aria-pressed': S.mode === v ? 'true' : 'false', onclick: () => { S.mode = v; paint(); } }, lab))),
        el('span', { class: 'sp' }),
        el('span', { class: 'lbl', title: 'se règle avec le curseur Durée de la page' }, `durée totale ${fmt(total)}`)),
      timeline(),
      S.mode === 'auto'
        ? el('div', { class: 'ms-auto' },
          el('label', { class: 'field' }, el('span', { class: 'lbl' }, 'Décris la scène : chaque phrase devient un plan, dans l’ordre'),
            el('textarea', { class: 'fld', rows: 5, spellcheck: 'false',
              placeholder: 'Wide shot of the carrefour at dusk. @element1 sits on the terrace and says: "Vive Nirvalab !" Close on the cup.',
              oninput: (e) => { S.free = e.target.value; paintTl(); } }, S.free)),
          el('div', { class: 'row' }, el('span', { class: 'lbl' }, 'nombre de plans'),
            ...[2, 3, 4, 5, 6].map((n) => el('button', { class: 'tb sm' + (S.n === n ? ' on' : ''), type: 'button', onclick: () => { S.n = n; paint(); } }, String(n))),
            el('span', { class: 'hint' }, 'durées égales ; pour les régler à la main, passe en « Plan par plan »')))
        : el('div', { class: 'ms-plans' },
          el('div', { class: 'row' },
            el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { S.shots = equal(S.shots.length, total).map((q, i) => Object.assign(q, { text: S.shots[i].text, lines: S.shots[i].lines })); paint(); } }, 'Durées égales'),
            el('button', { class: 'tb ghost sm', type: 'button', onclick: () => { split(S.shots, S.sel); paint(); } }, '+ Plan'),
            el('span', { class: 'hint' }, 'glisse les poignées entre les plans pour régler leur durée')),
          editor()),
      el('div', { class: 'ms-prev' }, el('span', { class: 'lbl' }, 'Ce que H3 recevra'),
        el('pre', { class: 'ms-pre' }, out() || '(vide)')),
      el('div', { class: 'ms-foot' },
        el('span', { class: 'hint', title: 'le guide officiel d’H3, § 4.2' }, 'chaque plan suivant commence par son temps de coupe : « At 00:03.500, »'),
        el('label', { class: 'ms-lang' }, el('span', { class: 'lbl' }, 'langue parlée'),
          el('select', { class: 'fld', onchange: (e) => { S.lang = e.target.value; paint(); } },
            ...Object.entries(LANG).map(([k, v]) => el('option', { value: k, selected: S.lang === k ? true : null }, v)))),
        el('span', { class: 'sp' }),
        el('button', { class: 'tb ghost', type: 'button', onclick: close }, 'Annuler'),
        el('button', { class: 'tb go', type: 'button', disabled: shots.every((p) => !p.text?.trim() && !(p.lines || []).length) ? true : null,
          title: 'écrit ces plans dans le prompt de la page', onclick: () => { onApply(out()); close(); } }, 'Écrire dans le prompt')));
  }
  paint();
  document.body.append(scrim);
  return { close };
}

export { plan };
