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
//     coupe le fil. Verrouiller : plus d'écriture, plus de fil, plus de
//     variation. Couper : la case reste, barrée, et sort de la prose.
//   - Varier (§ 9.3) : la case devient une liste, une valeur par ligne (Entrée
//     en ajoute une, un collage de plusieurs lignes en fait plusieurs, Alt+↑↓
//     les range), chacune cochée ou non ; branchée, le texte reçu est découpé
//     par ligne. Une seule case varie à la fois (ports.js, varyWhy) ; la carte
//     Générer branchée en fait un lot (gen.js).
//   - Photographie : les pastilles de l'outil Image (/api/image/models, looks)
//     et une ligne libre ; le composeur envoie leurs identifiants, le serveur
//     écrit leur phrase selon le modèle (sans marque pour Krea 2).
//   - Deux textes qui se rencontrent font un composeur : un texte lâché sur une
//     carte Générer qui a déjà un prompt en fait un, entre les deux (dropRules).
//   - Aucun orange : le composeur ne fabrique rien, l'action reste Générer.

import { el, toast } from '../commun/shell.js';
import { menu } from '../commun/menu.js';
import { ROLES, TEXT_TYPES, NO_VARY, roleOf, slotHint, newSlot, newSlots, nameOf, fromName, valuesOf, picked, varyWhy,
  composerFamily, varies, cleanLooks, canWire } from './ports.js';
import { plab, badList } from './gen.js';

// les styles du composeur, à côté de ce fichier (la page ne les liste pas : ils viennent avec lui)
if (!document.querySelector('link[data-ide-composer]')) {
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./composer.css', import.meta.url).href, 'data-ide-composer': '' }));
}

const ICON = {
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z', open: 'M7 11V8a5 5 0 0 1 9.6-1.9M6 11h12v9H6z',
  off: 'M12 3v7M6.3 6.8a8 8 0 1 0 11.4 0', on: 'M5 12l4 4 10-10',
  vary: 'M4 6h3M10 6h10M4 12h3M10 12h10M4 18h3M10 18h6',
};
const icon = (k) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICON[k]);
  s.append(p);
  return s;
};
const splitLines = (t) => String(t || '').split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);

export function createComposer(app) {
  const { S } = app;
  const slotOf = (c, sid) => (c.slots || []).find((s) => s.id === sid);
  const peek = new Map();      // composeur → la valeur montrée dans sa prose (une commodité de la vue, pas enregistrée)

  // changer une case : un pas d'annulation ; `soft` : pendant la saisie (un seul pas pour toute la saisie)
  const set = (c, sid, fn) => app.mutate(() => { const s = slotOf(c, sid); if (s) fn(s); });
  const partOf = (c, s) => app.flowNow().parts(c).find((p) => p.slot.id === s.id) || null;
  // la carte (ou l'inspecteur) refaite, puis le champ d'une valeur repris (après un geste qui
  // change la liste) ; `blurHere` quitte le champ d'abord — une carte où l'on écrit n'est pas
  // refaite sous les doigts — et dit où il était
  const refocus = (c, sel, where, atEnd = true) => requestAnimationFrame(() => {
    const root = where === 'insp' ? document.getElementById('insp') : app.canvas.dom.get(c.id)?.el;
    const t = root?.querySelector(sel);
    if (!t) return;
    t.focus({ preventScroll: true });
    const k = atEnd ? t.value.length : 0;
    try { t.setSelectionRange(k, k); } catch { /* */ }
  });
  const blurHere = () => {
    const a = document.activeElement;
    const where = a?.closest?.('#insp') ? 'insp' : 'card';
    if (a && a !== document.body) a.blur();
    return where;
  };

  function roleMenu(c, s, x, y) {
    const i = c.slots.indexOf(s);
    menu(x, y, [{ head: 'rôle de la case' },
      ...ROLES.map((r) => ({ label: r.name, checked: roleOf(s).id === r.id, sub: r.video ? 'vidéo' : '', title: r.hint,
        onclick: () => set(c, s.id, (x2) => { x2.role = r.id; x2.name = r.name; if (NO_VARY.has(r.id) && x2.vary) stopVary(c, x2); }) })),
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

  // ── varier ────────────────────────────────────────────────
  // arrêter : écrite, la case garde sa première valeur cochée (ctrl+Z : la liste) ; branchée, le fil reste
  function stopVary(c, s) {
    const p = partOf(c, s);
    if (!p?.from) {
      const vals = valuesOf(s);
      s.text = picked(vals)[0] || vals[0]?.t || '';
      delete s.values;
    }
    delete s.skip;
    s.vary = false;
  }
  function toggleVary(c, s) {
    if (s.vary) {
      app.mutate(() => stopVary(c, s));
      toast('la case ne varie plus : une seule valeur gardée (ctrl+Z : la liste)');
      return;
    }
    const w = varyWhy(S.board, c, s);
    if (w) { toast(w, 5000); return; }
    const wired = !!partOf(c, s)?.from;
    app.mutate(() => {
      s.vary = true;
      // écrite : ses lignes deviennent ses valeurs ; branchée : les lignes du texte reçu
      if (!wired) { s.values = valuesOf({ text: s.text }); if (!s.values.length) s.values = [{ t: '', on: true }]; }
    });
    if (!wired) refocus(c, `[data-v="${CSS.escape(s.id)}:${Math.max(0, (s.values || []).length - 1)}"]`, 'card');
    toast(wired ? 'la case varie : une valeur par ligne du texte reçu — décochez celles qui ne partent pas'
      : 'la case varie : une valeur par ligne (Entrée en ajoute une) — la carte Générer branchée fait une colonne par valeur');
  }
  // les valeurs d'une case écrite qui varie : toujours une liste, au besoin tirée de son texte
  const vals = (s) => { if (!Array.isArray(s.values)) s.values = valuesOf(s); return s.values; };
  // `before` : ce qui change la valeur courante (Entrée qui la coupe, un collage), dans le même pas
  function insertValues(c, s, at, texts, focusAt = at, before = null) {
    const where = blurHere();
    app.mutate(() => { if (before) before(); vals(s).splice(at, 0, ...texts.map((t) => ({ t, on: true }))); });
    refocus(c, `[data-v="${CSS.escape(s.id)}:${focusAt}"]`, where, false);
  }
  function removeValue(c, s, i) {
    const where = blurHere();
    app.mutate(() => { vals(s).splice(i, 1); if (!s.values.length) s.values.push({ t: '', on: true }); });
    refocus(c, `[data-v="${CSS.escape(s.id)}:${Math.max(0, i - 1)}"]`, where);
  }
  function moveValue(c, s, i, d) {
    const j = i + d;
    if (j < 0 || j >= vals(s).length) return;
    const where = blurHere();
    app.mutate(() => { const V = vals(s); [V[i], V[j]] = [V[j], V[i]]; });
    refocus(c, `[data-v="${CSS.escape(s.id)}:${j}"]`, where);
  }
  // détacher une case branchée qui varie : ses lignes deviennent ses valeurs écrites
  function detachSlot(c, s, p) {
    if (!p.values) { app.detach(p.link.id); return; }
    app.mutate((B) => {
      s.values = p.values.map((v) => ({ t: v.t, on: v.on }));
      s.text = '';
      delete s.skip;
      B.links = B.links.filter((l) => l.id !== p.link.id);
    });
    toast('détaché : les lignes reçues sont les valeurs de la case, le fil coupé');
  }

  // l'éditeur des valeurs d'une case écrite (la carte, et l'inspecteur : `insp`, avec ↑)
  function valueEditor(c, s, insp = false) {
    const V = vals(s);
    const box = el('div', { class: 'cvals' });
    V.forEach((v, i) => {
      const cb = el('input', { type: 'checkbox', class: 'cv-on', checked: v.on ? true : null, disabled: s.lock ? true : null,
        title: v.on ? 'cochée : elle part' : 'décochée : elle reste là, ne part pas' });
      cb.addEventListener('change', () => set(c, s.id, (x) => { vals(x)[i].on = cb.checked; }));
      const ta = el('textarea', { class: 'fld cv-t', rows: 1, spellcheck: 'false', 'data-v': `${s.id}:${i}`, readonly: s.lock ? true : null,
        placeholder: i ? 'une autre valeur' : slotHint(s), title: 'Entrée : une valeur de plus · Alt+↑↓ : la ranger · effacer : la retirer' });
      ta.value = v.t;
      let changed = () => {};
      const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 3 * 18 + 10)}px`; };
      ta.addEventListener('focus', () => { changed = app.editing(); });
      ta.addEventListener('input', () => {
        changed(); v.t = ta.value.replace(/\s*\n\s*/g, ' '); grow();
        if (insp) { const d = app.canvas.dom.get(c.id); if (d) d.key = ''; } else paintOut(c.id);
        app.canvas.renderSoon();
      });
      ta.addEventListener('keydown', (e) => {
        if (s.lock) return;
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          // Entrée au milieu d'une valeur la coupe en deux
          const a = ta.selectionStart ?? ta.value.length;
          const head = ta.value.slice(0, a).trim(), tail = ta.value.slice(a).trim();
          insertValues(c, s, i + 1, [tail], i + 1, () => { v.t = head; });
        } else if (e.key === 'Backspace' && !ta.value && V.length > 1) { e.preventDefault(); removeValue(c, s, i); }
        else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveValue(c, s, i, e.key === 'ArrowUp' ? -1 : 1); }
      });
      // un collage de plusieurs lignes : plusieurs valeurs
      ta.addEventListener('paste', (e) => {
        const txt = e.clipboardData?.getData('text/plain') || '';
        const L = splitLines(txt);
        if (s.lock || L.length < 2) return;
        e.preventDefault();
        const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
        const joined = (ta.value.slice(0, a) + L[0] + ta.value.slice(b)).replace(/\s+/g, ' ').trim();
        insertValues(c, s, i + 1, L.slice(1), i + L.length - 1, () => { v.t = joined; });
      });
      requestAnimationFrame(() => { grow(); if (!insp) app.canvas.reflow(); });
      box.append(el('div', { class: 'cval' + (v.on ? '' : ' no') }, cb, ta,
        insp && i > 0 ? el('button', { class: 'cv-x', type: 'button', title: 'monter · Alt+↑', disabled: s.lock ? true : null, onclick: () => moveValue(c, s, i, -1) }, '↑') : null,
        el('button', { class: 'cv-x', type: 'button', title: 'retirer cette valeur', disabled: s.lock || V.length < 2 ? true : null, onclick: () => removeValue(c, s, i) }, '×')));
    });
    if (!s.lock) box.append(el('button', { class: 'gcut cv-add', type: 'button', title: 'une valeur de plus (Entrée dans la dernière)', onclick: (e) => { e.stopPropagation(); insertValues(c, s, V.length, ['']); } }, '+ valeur'));
    return box;
  }
  // les lignes d'une case branchée qui varie : cochées ou non, le texte vient de la source
  function wiredValues(c, s, p) {
    const box = el('div', { class: 'cvals wired' }, ...p.values.map((v) => {
      const cb = el('input', { type: 'checkbox', class: 'cv-on', checked: v.on ? true : null, title: v.on ? 'cochée : elle part' : 'décochée : elle ne part pas' });
      cb.addEventListener('change', () => set(c, s.id, (x) => {
        const skip = new Set(x.skip || []);
        if (cb.checked) skip.delete(v.t); else skip.add(v.t);
        x.skip = [...skip];
      }));
      return el('label', { class: 'cval' + (v.on ? '' : ' no') }, cb, el('span', { class: 'cv-r' }, v.t));
    }));
    if (p.values.length < 2) box.append(el('span', { class: 'ghint' }, 'le texte reçu n’a qu’une ligne : une valeur par ligne dans la source'));
    return box;
  }

  // ── la prise de vue (case Photographie) ───────────────────
  const said = (x) => `« ${x.krea || x.prose} » (Krea 2, sans marque)\n« ${x.prose} » (Qwen 2.1, Z-Image)`;
  const setLook = (c, s, g, id) => set(c, s.id, (x) => { const L = cleanLooks(x.looks); if (id) L[g] = id; else delete L[g]; x.looks = L; });
  function groupItems(c, s, g) {
    const cur = cleanLooks(s.looks)[g.id];
    return [{ head: g.about || g.label }, { label: 'aucune', checked: !cur, onclick: () => setLook(c, s, g.id, '') },
      ...g.items.map((x) => ({ label: x.name, sub: (x.sub || '').toLowerCase(), checked: cur === x.id, title: said(x), onclick: () => setLook(c, s, g.id, x.id) }))];
  }
  function looksMenu(c, s, x, y) {
    const cfg = S.cfg;
    if (!cfg) { toast(S.cfgError ? `l’outil Image ne répond pas : ${S.cfgError}` : 'lecture des pastilles…'); return; }
    const L = cleanLooks(s.looks);
    menu(x, y, [{ head: 'prise de vue · les pastilles de l’outil Image' },
      ...cfg.looks.map((g) => {
        const it = g.items.find((i) => i.id === L[g.id]);
        return { label: `${g.label}${it ? ' · ' + it.name : ''}`, items: groupItems(c, s, g) };
      }),
      '-', { label: 'Tout retirer', disabled: !Object.keys(L).length, why: 'aucune pastille', onclick: () => set(c, s.id, (x2) => { x2.looks = {}; }) }]);
  }
  function looksRow(c, s) {
    const cfg = S.cfg;
    const L = cleanLooks(s.looks);
    if (!cfg) return el('div', { class: 'cph' }, el('span', { class: 'ghint' }, S.cfgError ? 'pastilles : l’outil Image ne répond pas' : 'lecture des pastilles…'));
    const chips = cfg.looks.filter((g) => L[g.id]).map((g) => {
      const it = g.items.find((x) => x.id === L[g.id]);
      return el('button', { class: 'cpp', type: 'button', disabled: s.lock ? true : null, title: it ? `${g.label} · ${it.sub || ''}\n${said(it)}` : `${g.label} : ${L[g.id]} (retirée de l’outil Image)`,
        onclick: (e) => { e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); menu(b.left, b.bottom + 4, groupItems(c, s, g)); } },
      el('small', {}, g.label), it ? it.name : L[g.id]);
    });
    return el('div', { class: 'cph' }, ...chips,
      s.lock ? null : el('button', { class: 'gcut', type: 'button', title: 'caméra, objectif, ouverture, pellicule, lumière : les pastilles de l’outil Image ; le serveur écrit leur phrase selon le modèle',
        onclick: (e) => { e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); looksMenu(c, s, b.left, b.bottom + 4); } }, chips.length ? '+' : '+ prise de vue'));
  }

  // un bouton de la ligne d'une case : `why` l'éteint (il le dit au clic, sans rien faire)
  const tog = (k, on, title, fn, why = '') => el('button', { class: 'cs-t' + (on ? ' on' : '') + (why ? ' dis' : ''), type: 'button', title: why ? `${title} — ${why}` : title,
    'aria-disabled': why ? 'true' : null, 'data-k': k, onclick: (e) => { e.stopPropagation(); if (why) toast(why, 5000); else fn(); } }, icon(k));

  // une case sur la carte : son étiquette (le port la vise), ses boutons, son texte ou ses valeurs
  function slotRow(c, p) {
    const s = p.slot;
    const r = roleOf(s);
    const on = p.values ? picked(p.values) : null;
    const lab = plab('in', 's:' + s.id, s.name, [r.video ? 'vidéo' : '', on ? `× ${on.length}` : ''].filter(Boolean).join(' · '));
    lab.classList.add('cs-lab');
    lab.title = `${r.name} — ${r.hint}\nclic : le rôle, l’ordre, renommer`;
    lab.addEventListener('click', (e) => { e.stopPropagation(); const b = lab.getBoundingClientRect(); roleMenu(c, s, b.left, b.bottom + 4); });
    lab.addEventListener('dblclick', (e) => { e.stopPropagation(); rename(c, s); });
    let body;
    if (p.from) {
      const t = p.text.trim();
      body = el('div', { class: 'gin' },
        el('div', { class: 'gin-h' }, el('span', { class: 'from', title: fromName(p.from) }, fromName(p.from)),
          s.lock ? null : el('button', { class: 'gcut', type: 'button', title: p.values ? 'les lignes reçues deviennent les valeurs de la case, le fil coupé' : 'copier le texte reçu dans la case et couper le fil',
            onclick: () => detachSlot(c, s, p) }, 'détacher')),
        p.values ? wiredValues(c, s, p) : el('div', { class: 'gin-t' + (t ? '' : ' ph') }, t || 'vide pour l’instant'));
    } else if (p.values) {
      body = valueEditor(c, s);
    } else {
      const ta = el('textarea', { class: 'fld ctext', rows: 1, spellcheck: 'false', placeholder: slotHint(s), readonly: s.lock ? true : null, 'data-reg': 't:' + s.id });
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
    const vw = s.vary ? '' : varyWhy(S.board, c, s);
    return el('div', { class: `cslot${s.off ? ' off' : ''}${s.lock ? ' lock' : ''}${p.from ? ' wired' : ''}${p.values ? ' vary' : ''}`, 'data-row': 's:' + s.id },
      el('div', { class: 'cs-h' }, lab, el('span', { class: 'sp' }),
        NO_VARY.has(r.id) ? null : tog('vary', !!p.values, p.values ? `varie : ${on.length} valeur${on.length > 1 ? 's' : ''} cochée${on.length > 1 ? 's' : ''}, un rendu par valeur — clic : n’en garder qu’une`
          : 'varier : une valeur par ligne, un rendu par valeur, le reste fixe', () => toggleVary(c, s), vw),
        tog(s.lock ? 'lock' : 'open', s.lock, s.lock ? 'verrouillée : ni écrite, ni rebranchée, ni variée — clic pour la rouvrir' : 'verrouiller la case',
          () => set(c, s.id, (x) => { x.lock = !x.lock; if (x.lock && x.vary) stopVary(c, x); })),
        tog(s.off ? 'off' : 'on', !s.off, s.off ? 'coupée : hors de la prose — clic pour la remettre' : 'couper la case (elle reste, hors de la prose)', () => set(c, s.id, (x) => { x.off = !x.off; }))),
      body,
      r.id === 'photo' ? looksRow(c, s) : null);
  }

  // la prose montrée : celle de la valeur choisie (‹ ›) si une case varie
  function outText(id) {
    const F = app.flowNow();
    const L = F.lot(id);
    const ok = L && !L.conflict && L.on.length;
    const k = ok ? Math.min(peek.get(id) || 0, L.on.length - 1) : 0;
    const x = F.extras(id);
    return { text: ok ? F.textAt(id, k) : F.text(id), son: x.son, musique: x.musique, looks: cleanLooks(x.looks), lot: L, k };
  }
  // les pastilles ne sont pas dans la prose : le serveur écrit leur phrase selon le modèle, à la fin
  const looksNote = (o) => {
    const names = (S.cfg?.looks || []).filter((g) => o.looks[g.id]).map((g) => g.items.find((i) => i.id === o.looks[g.id])?.name || o.looks[g.id]);
    return names.length ? `+ ${names.join(' · ')} : écrites selon le modèle, à la fin (sans marque pour Krea 2)` : '';
  };
  const lotHead = (id, o) => {
    const L = o.lot;
    if (!L) return null;
    if (L.conflict) return el('span', { class: 'lbl warn', title: 'une seule case varie à la fois : arrêtez l’une d’elles' }, `deux cases varient : ${L.conflict.map((x) => x.name).join(', ')}`);
    if (!L.on.length) return el('span', { class: 'lbl warn' }, `${L.name} : aucune valeur cochée`);
    const nav = (d) => el('button', { class: 'cnav', type: 'button', disabled: (d < 0 ? o.k <= 0 : o.k >= L.on.length - 1) ? true : null,
      title: d < 0 ? 'la valeur d’avant' : 'la valeur suivante', onclick: (e) => { e.stopPropagation(); peek.set(id, o.k + d); paintOut(id); } }, d < 0 ? '‹' : '›');
    return el('span', { class: 'clot' }, nav(-1), el('span', { class: 'lbl', title: L.on[o.k] }, `${L.name} ${o.k + 1}/${L.on.length}`), nav(1));
  };
  function paintOut(id) {
    const box = app.canvas.dom.get(id)?.el.querySelector('.cout');
    if (!box) return;
    const o = outText(id);
    box.querySelector('.cprev').textContent = o.text || '—';
    box.querySelector('.cprev').classList.toggle('ph', !o.text);
    box.querySelector('.cn').textContent = `${o.text.length} signes`;
    box.querySelector('.clh').replaceChildren(...[lotHead(id, o)].filter(Boolean));
    const x = box.querySelector('.cx');
    x.textContent = [o.son ? `son : ${o.son}` : '', o.musique ? `musique : ${o.musique}` : ''].filter(Boolean).join(' · ');
    x.hidden = !x.textContent;
    const lk = box.querySelector('.clk');
    lk.textContent = looksNote(o);
    lk.hidden = !lk.textContent;
    const sum = app.canvas.dom.get(id)?.el.querySelector('.gsum');
    if (sum) sum.textContent = o.text || '—';
  }

  function card(c) {
    const F = app.flow();
    const parts = F.parts(c);
    const o = outText(c.id);
    const add = el('button', { class: 'gcut', type: 'button', title: 'une case de plus : Son, Musique, Libre…',
      onclick: (e) => { e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); addMenu(c, b.left, b.bottom + 4); } }, '+ case');
    return [
      el('div', { class: 'ghead', 'data-anchor': 'out:text' }, el('span', { class: 'lbl k' }, 'composeur'),
        el('span', { class: 'lbl' }, `${parts.length} case${parts.length > 1 ? 's' : ''}`), el('span', { class: 'sp' }), add),
      el('div', { class: 'gsum' }, o.text || '—'),
      el('div', { class: 'gform' },
        parts.length ? el('div', { class: 'cslots' }, ...parts.map((p) => slotRow(c, p))) : el('span', { class: 'ghint' }, 'aucune case : « + case »'),
        el('div', { class: 'cout' }, el('div', { class: 'cs-h' }, el('span', { class: 'lbl' }, 'prose'), el('span', { class: 'clh' }, lotHead(c.id, o)),
          el('span', { class: 'sp' }), el('span', { class: 'lbl cn' }, `${o.text.length} signes`)),
        el('div', { class: 'cprev' + (o.text ? '' : ' ph') }, o.text || '—'),
        el('div', { class: 'clk', hidden: looksNote(o) ? null : true }, looksNote(o)),
        el('div', { class: 'cx lbl', hidden: !(o.son || o.musique) ? true : null }, [o.son ? `son : ${o.son}` : '', o.musique ? `musique : ${o.musique}` : ''].filter(Boolean).join(' · '))),
        badList(app, c.id)),
    ];
  }
  // ce qui refait la carte : ce qu'elle reçoit, la lecture des pastilles, ce qui varie dans sa famille
  const cardKey = (c) => '|' + app.flow().sig(c.id) + (S.cfg ? '|c' : '') + '|' + composerFamily(S.board, c.id)
    .flatMap((n) => (n.slots || []).filter(varies).map((s) => n.id + ':' + s.id)).join(',');

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
      role.addEventListener('change', () => set(c, s.id, (x) => { const r = ROLES.find((y) => y.id === role.value); x.role = r.id; x.name = r.name; if (NO_VARY.has(r.id) && x.vary) stopVary(c, x); }));
      let body;
      if (p.from && p.values) body = wiredValues(c, s, p);
      else if (p.from) body = el('p', { class: 'hint' }, `${fromName(p.from)} : ${p.text.trim() || 'vide'}`);
      else if (p.values) body = valueEditor(c, s, true);
      else {
        body = el('textarea', { class: 'fld', rows: 2, placeholder: slotHint(s), readonly: s.lock ? true : null, 'data-reg': 't:' + s.id });
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
      const vw = s.vary ? '' : varyWhy(S.board, c, s);
      const looks = roleOf(s).id === 'photo' && S.cfg ? el('div', { class: 'stack sm' }, ...S.cfg.looks.map((g) => {
        const L = cleanLooks(s.looks);
        const sel = el('select', { class: 'fld sm', title: g.about || '', disabled: s.lock ? true : null }, el('option', { value: '' }, '—'),
          ...g.items.map((x) => el('option', { value: x.id, selected: L[g.id] === x.id ? true : null, title: said(x) }, `${x.name}${x.sub ? ' · ' + x.sub.toLowerCase() : ''}`)));
        sel.addEventListener('change', () => setLook(c, s, g.id, sel.value));
        return el('label', { class: 'look' }, el('span', { class: 'lbl' }, g.label), sel);
      })) : null;
      return el('div', { class: 'cline' + (s.off ? ' off' : '') + (s.lock ? ' lock' : '') + (p.values ? ' vary' : '') },
        el('div', { class: 'cl-h' }, el('b', { class: 'rn' }, String(i + 1)), role,
          NO_VARY.has(roleOf(s).id) ? null : tog('vary', !!p.values, p.values ? 'varie — n’en garder qu’une' : 'varier : une valeur par ligne', () => toggleVary(c, s), vw),
          tog(s.lock ? 'lock' : 'open', s.lock, s.lock ? 'verrouillée : ni écrite, ni rebranchée, ni variée — la rouvrir' : 'verrouiller : plus d’écriture, plus de fil, plus de variation',
            () => set(c, s.id, (x) => { x.lock = !x.lock; if (x.lock && x.vary) stopVary(c, x); })),
          tog(s.off ? 'off' : 'on', !s.off, s.off ? 'coupée : hors de la prose — la remettre' : 'couper : hors de la prose, gardée', () => set(c, s.id, (x) => { x.off = !x.off; })),
          b('↑', () => app.mutate(() => { c.slots.splice(i - 1, 0, ...c.slots.splice(i, 1)); }), { title: 'monter : plus tôt dans la prose', disabled: i === 0 }),
          b('×', () => removeSlot(c, s), { title: 'retirer la case' })),
        body, looks,
        p.from && !s.lock ? row(b('Détacher', () => detachSlot(c, s, p), { title: p.values ? 'les lignes reçues deviennent les valeurs écrites, le fil coupé' : 'copier le texte reçu dans la case et couper le fil' })) : null);
    });
    const outs = S.board.links.filter((l) => l.kind === 'wire' && l.a === c.id).map((l) => nameOf(app.node(l.b)));
    const L = o.lot;
    return [
      cardP('Composeur', `${parts.length} case${parts.length > 1 ? 's' : ''}`,
        el('div', { class: 'stack' }, ...lines),
        row(...ROLES.filter((r) => ['son', 'musique', 'libre'].includes(r.id)).map((r) => b(`+ ${r.name}`, () => app.mutate(() => { c.slots.push(newSlot(r.id, c.slots)); }), { title: r.hint })),
          el('span', { class: 'sp' }), b('+ une case…', (e) => { const r = e.currentTarget.getBoundingClientRect(); addMenu(c, r.left, r.bottom + 4); })),
        hint('L’ordre des cases est l’ordre de la prose : le style et le plan, les personnages, leur action, le décor, la lumière et la prise de vue (les guides de Krea 2, Qwen 2.1, Z-Image, H3). Son et Musique ne vont qu’à la vidéo.'),
        hint('Varier une case : une valeur par ligne, un rendu par valeur cochée, le reste fixe et la même graine — une case à la fois.')),
      cardP('Prose', L && !L.conflict && L.on.length ? `${L.name} ${o.k + 1}/${L.on.length} · ${o.text.length} signes` : `${o.text.length} signes`,
        el('pre', { class: 'sent' }, o.text || '—'),
        looksNote(o) ? hint(looksNote(o)) : null,
        L?.conflict ? el('p', { class: 'why' }, `Deux cases varient (${L.conflict.map((x) => x.name).join(', ')}) : une carte n’en prend qu’une.`) : null,
        L && !L.conflict && L.on.length > 1 ? row(b('‹', () => { peek.set(c.id, Math.max(0, o.k - 1)); paintOut(c.id); app.insp.render(); }, { disabled: o.k <= 0, title: 'la valeur d’avant' }),
          b('›', () => { peek.set(c.id, Math.min(L.on.length - 1, o.k + 1)); paintOut(c.id); app.insp.render(); }, { disabled: o.k >= L.on.length - 1, title: 'la valeur suivante' }),
          el('span', { class: 'hint' }, `« ${L.on[o.k]} »`)) : null,
        o.son || o.musique ? el('p', { class: 'hint' }, [o.son ? `Son (vidéo) : ${o.son}` : '', o.musique ? `Musique (vidéo) : ${o.musique}` : ''].filter(Boolean).join(' · ')) : null,
        row(b('Copier', () => navigator.clipboard?.writeText(o.text).then(() => toast('prose copiée'), () => toast(o.text)), { disabled: !o.text })),
        hint(outs.length ? `Elle part vers : ${outs.join(', ')}.` : 'Tirez sa sortie (à droite de la carte) vers le prompt d’une carte Générer image ou vidéo.'),
        hint('Une variante : choisissez le composeur et sa carte, ctrl+D — les fils qui y entrent suivent — puis changez une case.')),
    ];
  }

  // ── deux textes qui se rencontrent font un composeur (étude § 9.5) ──────
  // Un texte lâché sur une carte Générer : il devient son prompt ; si elle en a déjà un
  // (écrit ou branché), un composeur se pose entre les deux, les deux textes dans deux cases
  // Libres (le prompt de la carte d'abord). Le texte glissé revient à sa place : les notes
  // restent des sources. Cette règle passe avant celles des groupes (placée juste après
  // « texte sur composeur ») : lâché sur une carte, un texte parle à la carte.
  const isText = (n) => n && TEXT_TYPES.includes(n.type);
  const promptWire = (t) => S.board.links.find((l) => l.kind === 'wire' && l.b === t.id && l.pb === 'prompt') || null;
  const genRule = {
    name: 'texte sur carte Générer',
    test: (mv, t) => {
      if (mv.length !== 1 || !isText(mv[0]) || !(t?.type === 'gen' || t?.type === 'vgen')) return '';
      const cur = promptWire(t);
      if (cur?.a === mv[0].id) return '';          // c'est déjà son prompt
      return cur || (t.prompt || '').trim() ? 'lâcher : un composeur entre les deux — le prompt de la carte, puis ce texte' : 'lâcher : ce texte devient le prompt de la carte';
    },
    run: (mv, t, orig) => {
      for (const [n, x, y] of orig) { n.x = x; n.y = y; }
      const d = mv[0];
      const B = S.board;
      const cur = promptWire(t);
      const written = !cur && (t.prompt || '').trim();
      if (!cur && !written) {
        const why = canWire(B, d.id, 'text', t.id, 'prompt', app.caps(), S.items);
        if (why) { app.commit(); toast(why, 6000); return; }
        B.links.push({ id: app.uid('l'), a: d.id, b: t.id, kind: 'wire', pa: 'text', pb: 'prompt', label: '' });
        app.commit();
        toast('branché : ce texte est le prompt de la carte');
        return;
      }
      const slots = newSlots(['libre', 'libre']);
      if (written) slots[0].text = t.prompt;
      const h = 150 + slots.length * 80;   // estimée pour lui trouver une place ; la page la mesure ensuite
      const [x, y] = app.freeSpot(t.x - 340 - 90, t.y, 340, h, { around: true });
      const c = { id: app.uid('n'), type: 'compose', x, y, w: 340, h, slots };
      B.nodes.push(c);
      if (cur) {
        B.links = B.links.filter((l) => l !== cur);
        B.links.push({ id: app.uid('l'), a: cur.a, b: c.id, kind: 'wire', pa: cur.pa, pb: 's:' + slots[0].id, label: '' });
      }
      B.links.push({ id: app.uid('l'), a: d.id, b: c.id, kind: 'wire', pa: 'text', pb: 's:' + slots[1].id, label: '' });
      B.links.push({ id: app.uid('l'), a: c.id, b: t.id, kind: 'wire', pa: 'text', pb: 'prompt', label: '' });
      if (written) t.prompt = '';
      S.sel = new Set([c.id]); S.link = null;
      app.commit();
      toast('un composeur entre les deux : le prompt de la carte, puis ce texte — un clic sur une étiquette donne son rôle');
    },
  };
  if (Array.isArray(app.dropRules) && !app.dropRules.some((r) => r.name === genRule.name)) {
    const i = app.dropRules.findIndex((r) => r.name === 'texte sur composeur');
    app.dropRules.splice(i >= 0 ? i + 1 : app.dropRules.length, 0, genRule);
  }

  return { card, cardKey, panels, paintOut };
}
