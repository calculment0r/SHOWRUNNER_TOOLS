// IDÉATION — le composeur de prompt : des cases à rôle (Style, Personnages,
// Action, Décor, Photographie ; Son, Musique et Libre en plus), chacune
// écrite sur place ou reçue par un fil, qui s'assemblent en un paragraphe —
// pour changer une composante et garder les autres (le but de Cal, 29/09 ;
// l'étude : docs/etudes/ideation_weavy.md § 9).
//
//   - L'ordre de la carte est l'ordre de la prose ; il se change à la main
//     (menu de l'étiquette, ou l'inspecteur).
//   - Chaque case donne une phrase (un point s'il en manque un), jointe aux
//     autres par une espace, sans mot de liaison inventé (ports.js, flow).
//   - Son et Musique ne vont qu'à la vidéo, dans leurs champs d'H3.
//   - Un fil par case ; « Détacher » copie le texte reçu dans la case et
//     coupe le fil. Verrouiller : plus d'écriture, plus de fil. Couper : la
//     case reste, barrée, et sort de la prose.
//   - Aucun orange : le composeur ne fabrique rien, l'action reste Générer.

import { el, toast } from '../commun/shell.js';
import { menu } from '../commun/menu.js';
import { ROLES, roleOf, slotHint, newSlot, nameOf, fromName } from './ports.js';
import { plab, badList } from './gen.js';

const ICON = {
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z', open: 'M7 11V8a5 5 0 0 1 9.6-1.9M6 11h12v9H6z',
  off: 'M12 3v7M6.3 6.8a8 8 0 1 0 11.4 0', on: 'M5 12l4 4 10-10',
};
const icon = (k) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICON[k]);
  s.append(p);
  return s;
};

export function createComposer(app) {
  const { S } = app;
  const slotOf = (c, sid) => (c.slots || []).find((s) => s.id === sid);

  // changer une case : un pas d'annulation ; `soft` : pendant la saisie (un seul pas pour toute la saisie)
  const set = (c, sid, fn) => app.mutate(() => { const s = slotOf(c, sid); if (s) fn(s); });
  function roleMenu(c, s, x, y) {
    const i = c.slots.indexOf(s);
    menu(x, y, [{ head: 'rôle de la case' },
      ...ROLES.map((r) => ({ label: r.name, checked: roleOf(s).id === r.id, sub: r.video ? 'vidéo' : '', title: r.hint,
        onclick: () => set(c, s.id, (x2) => { x2.role = r.id; x2.name = r.name; }) })),
      '-',
      { label: 'Monter', disabled: i <= 0, why: 'déjà en tête', onclick: () => app.mutate(() => { c.slots.splice(i - 1, 0, ...c.slots.splice(i, 1)); }) },
      { label: 'Descendre', disabled: i >= c.slots.length - 1, why: 'déjà la dernière', onclick: () => app.mutate(() => { c.slots.splice(i + 1, 0, ...c.slots.splice(i, 1)); }) },
      { label: 'Renommer…', onclick: () => rename(c, s) },
      { label: 'Retirer la case', danger: true, onclick: () => removeSlot(c, s) }]);
  }
  function addMenu(c, x, y) {
    menu(x, y, [{ head: 'une case de plus' }, ...ROLES.map((r) => ({ label: r.name, sub: r.video ? 'vidéo seulement' : '', title: r.hint,
      onclick: () => app.mutate(() => { c.slots.push(newSlot(r.id, c.slots)); }) }))]);
  }
  function removeSlot(c, s) {
    app.mutate((B) => {
      c.slots = c.slots.filter((x) => x !== s);
      B.links = B.links.filter((l) => !(l.kind === 'wire' && l.b === c.id && l.pb === 's:' + s.id));
    });
  }
  function rename(c, s) {
    const lab = app.canvas.dom.get(c.id)?.el.querySelector(`[data-anchor="in:s:${CSS.escape(s.id)}"]`);
    if (!lab) return;
    const inp = el('input', { class: 'cs-in', value: s.name, maxlength: 40 });
    lab.replaceWith(inp);
    inp.focus({ preventScroll: true }); inp.select();
    const done = (keep) => {
      const v = inp.value.trim();
      if (keep && v && v !== s.name) set(c, s.id, (x) => { x.name = v; });
      else { const d = app.canvas.dom.get(c.id); if (d) d.key = ''; app.render(); }
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = s.name; inp.blur(); } });
    inp.addEventListener('blur', () => done(true), { once: true });
  }

  // une case sur la carte : son étiquette (le port la vise), son verrou, sa coupure, son texte
  function slotRow(c, p) {
    const s = p.slot;
    const r = roleOf(s);
    const lab = plab('in', 's:' + s.id, s.name, r.video ? 'vidéo' : '');
    lab.classList.add('cs-lab');
    lab.title = `${r.name} — ${r.hint}\nclic : le rôle, l’ordre, renommer`;
    lab.addEventListener('click', (e) => { e.stopPropagation(); const b = lab.getBoundingClientRect(); roleMenu(c, s, b.left, b.bottom + 4); });
    lab.addEventListener('dblclick', (e) => { e.stopPropagation(); rename(c, s); });
    const tog = (k, on, title, fn) => el('button', { class: 'cs-t' + (on ? ' on' : ''), type: 'button', title, onclick: (e) => { e.stopPropagation(); fn(); } }, icon(k));
    let body;
    if (p.from) {
      const t = p.text.trim();
      body = el('div', { class: 'gin' },
        el('div', { class: 'gin-h' }, el('span', { class: 'from', title: fromName(p.from) }, fromName(p.from)),
          s.lock ? null : el('button', { class: 'gcut', type: 'button', title: 'copier le texte reçu dans la case et couper le fil', onclick: () => app.detach(p.link.id) }, 'détacher')),
        el('div', { class: 'gin-t' + (t ? '' : ' ph') }, t || 'vide pour l’instant'));
    } else {
      const ta = el('textarea', { class: 'fld ctext', rows: 1, spellcheck: 'false', placeholder: slotHint(s), readonly: s.lock ? true : null });
      ta.value = s.text || '';
      let changed = () => {};
      const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 4 * 18 + 12)}px`; };
      ta.addEventListener('focus', () => { changed = app.editing(); });
      ta.addEventListener('input', () => {
        changed(); s.text = ta.value; grow(); paintOut(c.id);
        app.canvas.renderSoon();          // ce qui lit ce composeur suit, en direct
      });
      // la case prend la hauteur de son texte une fois posée : les ports suivent (canvas.reflow)
      requestAnimationFrame(() => { grow(); app.canvas.reflow(); });
      body = ta;
    }
    return el('div', { class: `cslot${s.off ? ' off' : ''}${s.lock ? ' lock' : ''}${p.from ? ' wired' : ''}`, 'data-row': 's:' + s.id },
      el('div', { class: 'cs-h' }, lab, el('span', { class: 'sp' }),
        tog(s.lock ? 'lock' : 'open', s.lock, s.lock ? 'verrouillée : ni écrite ni rebranchée — clic pour la rouvrir' : 'verrouiller la case', () => set(c, s.id, (x) => { x.lock = !x.lock; })),
        tog(s.off ? 'off' : 'on', !s.off, s.off ? 'coupée : hors de la prose — clic pour la remettre' : 'couper la case (elle reste, hors de la prose)', () => set(c, s.id, (x) => { x.off = !x.off; }))),
      body);
  }

  function outText(id) {
    const F = app.flowNow();
    const x = F.extras(id);
    return { text: F.text(id), son: x.son, musique: x.musique };
  }
  function paintOut(id) {
    const box = app.canvas.dom.get(id)?.el.querySelector('.cout');
    if (!box) return;
    const o = outText(id);
    box.querySelector('.cprev').textContent = o.text || '—';
    box.querySelector('.cprev').classList.toggle('ph', !o.text);
    box.querySelector('.cn').textContent = `${o.text.length} signes`;
    const x = box.querySelector('.cx');
    x.textContent = [o.son ? `son : ${o.son}` : '', o.musique ? `musique : ${o.musique}` : ''].filter(Boolean).join(' · ');
    x.hidden = !x.textContent;
    const sum = app.canvas.dom.get(id)?.el.querySelector('.gsum');
    if (sum) sum.textContent = o.text || '—';
  }

  function card(c) {
    const F = app.flow();
    const parts = F.parts(c);
    const o = { text: F.text(c.id), ...F.extras(c.id) };
    const add = el('button', { class: 'gcut', type: 'button', title: 'une case de plus : Son, Musique, Libre…',
      onclick: (e) => { e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); addMenu(c, b.left, b.bottom + 4); } }, '+ case');
    return [
      el('div', { class: 'ghead', 'data-anchor': 'out:text' }, el('span', { class: 'lbl k' }, 'composeur'),
        el('span', { class: 'lbl' }, `${parts.length} case${parts.length > 1 ? 's' : ''}`), el('span', { class: 'sp' }), add),
      el('div', { class: 'gsum' }, o.text || '—'),
      el('div', { class: 'gform' },
        parts.length ? el('div', { class: 'cslots' }, ...parts.map((p) => slotRow(c, p))) : el('span', { class: 'ghint' }, 'aucune case : « + case »'),
        el('div', { class: 'cout' }, el('div', { class: 'cs-h' }, el('span', { class: 'lbl' }, 'prose'), el('span', { class: 'sp' }), el('span', { class: 'lbl cn' }, `${o.text.length} signes`)),
          el('div', { class: 'cprev' + (o.text ? '' : ' ph') }, o.text || '—'),
          el('div', { class: 'cx lbl', hidden: !(o.son || o.musique) ? true : null }, [o.son ? `son : ${o.son}` : '', o.musique ? `musique : ${o.musique}` : ''].filter(Boolean).join(' · '))),
        badList(app, c.id)),
    ];
  }
  const cardKey = (c) => '|' + app.flow().sig(c.id);

  // ── l'inspecteur ──────────────────────────────────────────
  function panels(c, K) {
    const { card: cardP, b, row, hint } = K;
    const F = app.flowNow();
    const parts = F.parts(c);
    const o = outText(c.id);
    const lines = parts.map((p, i) => {
      const s = p.slot;
      const role = el('select', { class: 'fld sm', title: 'le rôle : sa place dans la prose, et Son, Musique à part pour la vidéo' },
        ...ROLES.map((r) => el('option', { value: r.id, selected: roleOf(s).id === r.id ? true : null }, r.name)));
      role.addEventListener('change', () => set(c, s.id, (x) => { const r = ROLES.find((y) => y.id === role.value); x.role = r.id; x.name = r.name; }));
      let body;
      if (p.from) body = el('p', { class: 'hint' }, `${fromName(p.from)} : ${p.text.trim() || 'vide'}`);
      else {
        body = el('textarea', { class: 'fld', rows: 2, placeholder: slotHint(s), readonly: s.lock ? true : null });
        body.value = s.text || '';
        let ch = () => {};
        body.addEventListener('focus', () => { ch = app.editing(); });
        body.addEventListener('input', () => {
          ch(); s.text = body.value;
          const d = app.canvas.dom.get(c.id);
          if (d) d.key = '';
          app.canvas.renderSoon();
        });
      }
      const tog = (k, on, title, fn) => el('button', { class: 'cs-t' + (on ? ' on' : ''), type: 'button', title, onclick: fn }, icon(k));
      return el('div', { class: 'cline' + (s.off ? ' off' : '') + (s.lock ? ' lock' : '') },
        el('div', { class: 'cl-h' }, el('b', { class: 'rn' }, String(i + 1)), role,
          tog(s.lock ? 'lock' : 'open', s.lock, s.lock ? 'verrouillée : ni écrite ni rebranchée — la rouvrir' : 'verrouiller : plus d’écriture, plus de fil', () => set(c, s.id, (x) => { x.lock = !x.lock; })),
          tog(s.off ? 'off' : 'on', !s.off, s.off ? 'coupée : hors de la prose — la remettre' : 'couper : hors de la prose, gardée', () => set(c, s.id, (x) => { x.off = !x.off; })),
          b('↑', () => app.mutate(() => { c.slots.splice(i - 1, 0, ...c.slots.splice(i, 1)); }), { title: 'monter : plus tôt dans la prose', disabled: i === 0 }),
          b('×', () => removeSlot(c, s), { title: 'retirer la case' })),
        body,
        p.from && !s.lock ? row(b('Détacher', () => app.detach(p.link.id), { title: 'copier le texte reçu dans la case et couper le fil' })) : null);
    });
    const outs = S.board.links.filter((l) => l.kind === 'wire' && l.a === c.id).map((l) => nameOf(app.node(l.b)));
    return [
      cardP('Composeur', `${parts.length} case${parts.length > 1 ? 's' : ''}`,
        el('div', { class: 'stack' }, ...lines),
        row(...ROLES.filter((r) => ['son', 'musique', 'libre'].includes(r.id)).map((r) => b(`+ ${r.name}`, () => app.mutate(() => { c.slots.push(newSlot(r.id, c.slots)); }), { title: r.hint })),
          el('span', { class: 'sp' }), b('+ une case…', (e) => { const r = e.currentTarget.getBoundingClientRect(); addMenu(c, r.left, r.bottom + 4); })),
        hint('L’ordre des cases est l’ordre de la prose : le style et le plan, les personnages, leur action, le décor, la lumière et la prise de vue (les guides de Krea 2, Qwen 2.1, Z-Image, H3). Son et Musique ne vont qu’à la vidéo.')),
      cardP('Prose', `${o.text.length} signes`,
        el('pre', { class: 'sent' }, o.text || '—'),
        o.son || o.musique ? el('p', { class: 'hint' }, [o.son ? `Son (vidéo) : ${o.son}` : '', o.musique ? `Musique (vidéo) : ${o.musique}` : ''].filter(Boolean).join(' · ')) : null,
        row(b('Copier', () => navigator.clipboard?.writeText(o.text).then(() => toast('prose copiée'), () => toast(o.text)), { disabled: !o.text })),
        hint(outs.length ? `Elle part vers : ${outs.join(', ')}.` : 'Tirez sa sortie (à droite de la carte) vers le prompt d’une carte Générer image ou vidéo.'),
        hint('Une variante : choisissez le composeur et sa carte, ctrl+D — les fils qui y entrent suivent — puis changez une case.')),
    ];
  }

  return { card, cardKey, panels, paintOut };
}
