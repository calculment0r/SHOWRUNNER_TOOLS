// SHOWRUNNER TOOLS — le « @ » d'un champ de prompt : nommer une entrée par sa place.
//
// Cal, 01/10 : « il faut absolument pouvoir assigner les réf et éléments avec le @ »
// (les cartes Générer image et Générer vidéo d'Idéation). Une seule mécanique pour
// tout champ : on tape @ (ou @ima…), un menu s'ouvre sous le champ avec les
// entrées que la carte envoie, vignette et titre ; ↑ ↓ choisit, Entrée ou Tab
// pose le jeton, Échap ferme. Le jeton posé est celui que le MODÈLE lit — la règle
// commune des références (commun/refs.js) : une adresse désigne une PLACE.
//
//   arobase(champ, () => ({ toks: [{ tag, titre, vignette, son }] } | { why }))
//
// `why` : le modèle ne nomme pas ses entrées, ou rien n'est branché — le menu le
// dit (une action éteinte dit pourquoi), il ne propose rien d'inventé.
// Le menu est posé sur la page (position fixe), pas dans le champ : il sort d'une
// carte de la planche, quel que soit le zoom.

import { el, href } from './shell.js';

if (typeof document !== 'undefined' && !document.querySelector('link[data-sr-arobase]')) {
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./arobase.css', import.meta.url).href, 'data-sr-arobase': '' }));
}

// « @ » au curseur, pas dans un mot (une adresse e-mail) ni après « < » ; ce qui suit filtre
const AT_RX = /(?<![\p{L}\p{N}_<])@([\p{L}\p{N}_ -]{0,24})$/u;

export function arobase(ta, choix) {
  if (!ta || ta.dataset.srAt) return ta;
  ta.dataset.srAt = '1';
  const menu = el('div', { class: 'sr-at', hidden: true, role: 'listbox' });
  const A = { list: [], sel: 0, q: '' };
  const fermer = () => { menu.hidden = true; menu.remove(); A.list = []; };
  const placer = () => {
    const r = ta.getBoundingClientRect();
    const h = Math.min(260, menu.scrollHeight || 200);
    const bas = r.bottom + 4 + h < innerHeight;
    menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 300))}px`;
    menu.style.top = `${bas ? r.bottom + 4 : Math.max(8, r.top - 4 - h)}px`;
    menu.style.minWidth = `${Math.min(Math.max(220, r.width), 360)}px`;
  };
  const peindre = (why) => {
    menu.replaceChildren(...(why ? [el('p', { class: 'why' }, why)] : []),
      ...A.list.map((t, k) => el('button', { class: 'sr-at-b' + (k === A.sel ? ' on' : ''), type: 'button', role: 'option',
        onmousedown: (e) => { e.preventDefault(); poser(t.tag); } },
      el('span', { class: 'mi', style: t.vignette ? { backgroundImage: `url("${href(t.vignette)}")` } : null }, t.vignette ? '' : (t.son ? '♪' : '')),
      el('b', {}, t.tag), el('span', { class: 'tt' }, t.titre || ''))));
    if (!menu.isConnected) document.body.append(menu);
    menu.hidden = false;
    placer();
  };
  const verifier = () => {
    const m = ta.value.slice(0, ta.selectionStart ?? ta.value.length).match(AT_RX);
    if (!m) { fermer(); return; }
    A.q = m[0];
    const c = choix() || {};
    if (c.why) { A.list = []; peindre(c.why); return; }
    const q = m[1].trim().toLowerCase();
    const sans = (s) => String(s || '').toLowerCase().replace(/[<>@\s]/g, '');
    A.list = (c.toks || []).filter((t) => !q || sans(t.tag).includes(q.replace(/\s/g, '')) || String(t.titre || '').toLowerCase().includes(q));
    A.sel = 0;
    if (!A.list.length && !(c.toks || []).length) { fermer(); return; }
    peindre(A.list.length ? '' : `rien ne répond à « ${m[1]} »`);
  };
  function poser(tag) {
    const at = ta.selectionStart ?? ta.value.length;
    const start = at - (A.q ? A.q.length : 0);
    ta.setRangeText(`${tag} `, Math.max(0, start), at, 'end');
    fermer();
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  ta.addEventListener('input', verifier);
  ta.addEventListener('click', verifier);
  ta.addEventListener('keydown', (e) => {
    if (menu.hidden || !A.list.length) { if (!menu.hidden && e.key === 'Escape') { e.stopPropagation(); fermer(); } return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      A.sel = (A.sel + (e.key === 'ArrowDown' ? 1 : A.list.length - 1)) % A.list.length;
      menu.querySelectorAll('.sr-at-b').forEach((b, k) => b.classList.toggle('on', k === A.sel));
    } else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); poser(A.list[A.sel].tag); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(); }
  });
  ta.addEventListener('blur', () => setTimeout(fermer, 150));
  return ta;
}
