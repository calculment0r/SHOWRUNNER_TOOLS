// MONTAGE — le panneau Projet. Décision de Cal du 29/09 au soir : le panneau
// Projet de Premiere, c'est Asset. Les mêmes objets (bibliothèque commune) et
// les mêmes dossiers (le champ `folder` de chaque objet : un seul niveau, un
// dossier n'existe que par ce qu'il contient — server/tools/asset.py) : ce
// qu'on range ici se retrouve dans Asset, et l'inverse. Les séquences sont
// des objets comme les autres (sorte `sequence`, server/tools/montage.py).
//
// Les gestes, comme dans Asset et dans Premiere :
//   - un objet lâché sur un autre : une fenêtre au centre demande le nom d'un
//     dossier neuf qui les prend tous les deux (Asset, glisser-déposer) ;
//   - une sélection au cadre (glisser sur le fond de la liste, maj : ajouter),
//     glissée sur l'icône « nouveau dossier » : la même fenêtre ;
//   - lâché sur un dossier : dedans ; sur l'onglet « Projet » : hors du dossier ;
//   - double-clic sur le nom d'un dossier : le renommer ; sur le dossier : il
//     s'ouvre dans un onglet du panneau (Adobe, « Open and close bins » :
//     « Double-click to open a bin in its own dockable panel ») ;
//   - double-clic sur une séquence : elle s'ouvre dans un onglet au-dessus de
//     la timeline (Adobe, « Navigate sequences in the timeline ») ;
//   - un clip lâché sur l'icône « nouvelle séquence » : une séquence à ses
//     réglages (Adobe, « Create a sequence » : « drag a clip from the Project
//     panel to the New Item icon »).
// Glisser vers la timeline, la source ou une autre page : le glisser-déposer
// HTML du portail (dragItem, ITEM_MIME), plusieurs objets sous MULTI_MIME.

import { api, el, toast, href, ITEM_MIME, kindMark } from '../commun/shell.js';
// le panneau peut être dans sa fenêtre (un 2ᵉ écran) : $ y cherche aussi, partout y écoute aussi
import { $, $$, partout } from '../commun/fenetre.js';
import { contextMenu } from '../commun/menu.js';

export const MULTI_MIME = 'application/x-sr-items';
const KINDS = [['', 'Tout'], ['sequence', 'Séquences'], ['video', 'Vidéos'], ['image', 'Images'], ['audio', 'Sons']];
const SORTS = [['new', 'Date (récent d’abord)'], ['name', 'Nom'], ['duration', 'Durée'], ['kind', 'Sorte']];
const KIND_FR = { sequence: 'séquence', video: 'vidéo', image: 'image', audio: 'son' };
const LS = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } return null; };
const short = (sec) => { sec = Math.max(0, sec || 0); const m = Math.floor(sec / 60), s = sec - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(s < 10 && m === 0 ? 1 : 0)}`; };
const cleanFolder = (s) => ' '.concat(s || '').split(/\s+/).filter(Boolean).join(' ').slice(0, 60);

const SEQ_ICON = '<svg viewBox="0 0 24 24"><path d="M3 6h18v12H3zM3 10h18M3 14h18M8 6v4M14 10v4M11 14v4"/></svg>';

export function mountProject(app) {
  const root = app.root;
  const P = {
    all: [], kind: LS('montage-bin-kind') || '', q: '', sort: LS('montage-bin-sort') || 'new',
    tabs: LS('montage-bin-tabs') || [''], tab: LS('montage-bin-tab') || '', sel: new Set(), anchor: null,
    renaming: null, focus: false, dragIds: null,
  };
  if (!P.tabs.includes('')) P.tabs.unshift('');
  if (!P.tabs.includes(P.tab)) P.tab = '';
  const list = $('.bin-list', root);
  const tabsBox = $('#bin-tabs', root);
  const saveTabs = () => { LS('montage-bin-tabs', P.tabs); LS('montage-bin-tab', P.tab); };

  // ── les données ────────────────────────────────────────────
  let loadT = 0;
  async function load() {
    try {
      const r = await api(`library?kind=${P.kind || 'sequence,video,image,audio'}&q=${encodeURIComponent(P.q)}&limit=5000`);
      P.all = r.items;
      for (const it of r.items) app.items.set(it.id, it);
    } catch (e) { P.all = []; list.replaceChildren(el('p', { class: 'warn' }, e.message)); return; }
    paint();
  }
  const soon = () => { clearTimeout(loadT); loadT = setTimeout(load, 120); };
  const byId = (id) => P.all.find((x) => x.id === id) || app.items.get(id);
  const folders = () => {
    const m = new Map();
    for (const it of P.all) if (it.folder) m.set(it.folder, (m.get(it.folder) || 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'));
  };
  function sorted(items) {
    const s = P.sort;
    if (s === 'name') return [...items].sort((a, b) => (a.title || '').localeCompare(b.title || '', 'fr'));
    if (s === 'duration') return [...items].sort((a, b) => (b.duration || 0) - (a.duration || 0));
    if (s === 'kind') return [...items].sort((a, b) => a.kind.localeCompare(b.kind) || (a.title || '').localeCompare(b.title || '', 'fr'));
    return items;
  }
  function meta(it) {
    if (it.kind === 'sequence') return ['séquence', it.width && it.height ? `${it.width}×${it.height}` : '', it.fps ? `${it.fps} i/s` : '', short(it.duration)].filter(Boolean).join(' · ');
    const bits = [];
    if (it.duration) bits.push(short(it.duration));
    if (it.width && it.height) bits.push(`${it.width}×${it.height}`);
    if (it.fps) bits.push(`${Math.round(it.fps * 100) / 100} i/s`);
    if (it.kind === 'video') bits.push(it.audio ? 'son' : 'muet');
    if (it.kind === 'image') bits.push('image');
    if (it.kind === 'audio') bits.push('son');
    return bits.join(' · ');
  }
  // ce qui se voit dans l'onglet courant, dans l'ordre de l'écran
  function shown() {
    if (P.q) return sorted(P.all);
    if (P.tab) return sorted(P.all.filter((it) => it.folder === P.tab));
    return sorted(P.all.filter((it) => !it.folder));
  }

  // ── ranger : l'API d'Asset, avec l'annulation du montage ───
  async function move(ids, folder, label) {
    folder = cleanFolder(folder);
    if (folder.includes('/')) { toast('un dossier ne se range pas dans un autre : pas de « / » dans son nom'); return; }
    try {
      const r = await api('asset/move', { method: 'POST', body: { ids, folder } });
      const back = r.moved;
      app.pushUndo(label || (folder ? `ranger dans « ${folder} »` : 'sortir du dossier'),
        async () => { for (const f of new Set(back.map((m) => m.from))) await api('asset/move', { method: 'POST', body: { ids: back.filter((m) => m.from === f).map((m) => m.id), folder: f } }); load(); },
        async () => { await api('asset/move', { method: 'POST', body: { ids, folder } }); load(); });
      toast(folder ? `${ids.length > 1 ? `${ids.length} objets rangés` : 'rangé'} dans « ${folder} » (Asset le voit aussi)` : `${ids.length > 1 ? `${ids.length} objets sortis` : 'sorti'} du dossier`, 2200);
    } catch (e) { toast(e.status === 403 ? 'un de ces objets est à quelqu’un d’autre : seul son auteur (ou Cal) le range' : e.message); }
    await load();
  }
  function askFolder(ids) {
    ids = [...new Set(ids)].filter(Boolean);
    if (!ids.length) { toast('choisissez d’abord des objets (un cadre à la souris sur le fond de la liste) : un dossier d’Asset existe par ce qu’il contient'); return; }
    const inp = el('input', { class: 'fld big-fld', maxlength: 60, placeholder: 'Rushes, Plans larges, Musiques…', spellcheck: 'false', 'aria-label': 'nom du dossier' });
    const minis = ids.slice(0, 8).map((id) => { const it = byId(id) || {}; return el('span', { class: 'mini' }, el('i', { style: it.thumb_url ? { backgroundImage: `url("${href(it.thumb_url)}")` } : null }), el('b', {}, it.title || id)); });
    const ok = async (close) => {
      const name = cleanFolder(inp.value);
      if (!name) { inp.placeholder = 'il lui faut un nom'; inp.focus(); return; }
      if (name.includes('/')) { inp.value = name.replace(/\//g, '·'); return; }
      close();
      await move(ids, name, `nouveau dossier « ${name} »`);
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(closer); } });
    const closer = app.modal('Nouveau dossier', el('div', { class: 'newfolder' },
      el('p', {}, `Comment s’appelle ce dossier ? Il prend ${ids.length > 1 ? `ces ${ids.length} objets` : 'cet objet'} ; il sera aussi dans Asset.`),
      el('div', { class: 'minis' }, ...minis, ids.length > 8 ? el('span', { class: 'lbl' }, `+ ${ids.length - 8}`) : null), inp,
      el('p', { class: 'note' }, 'Un dossier tient des séquences, des vidéos, des images et des sons — pas d’autre dossier (la règle d’Asset).')),
    (close) => [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', onclick: close }, 'Annuler'), el('button', { class: 'tb go', onclick: () => ok(close) }, 'Créer le dossier')],
    { cls: 'center' });
    inp.focus();
    setTimeout(() => { if (document.activeElement !== inp) inp.focus(); }, 30);
  }
  async function renameFolder(from, to) {
    to = cleanFolder(to);
    if (!to || to === from) return;
    if (to.includes('/')) { toast('pas de « / » dans le nom d’un dossier'); return; }
    let members = [];
    try { members = (await api(`library?folder=${encodeURIComponent(from)}&limit=10000`)).items.map((x) => x.id); } catch { /* */ }
    try {
      const r = await api('asset/folders/rename', { method: 'POST', body: { from, to } });
      P.tabs = P.tabs.map((t) => (t === from ? to : t));
      if (P.tab === from) P.tab = to;
      saveTabs();
      app.pushUndo(`renommer le dossier « ${from} »`,
        async () => { if (members.length) await api('asset/move', { method: 'POST', body: { ids: members, folder: from } }); P.tabs = P.tabs.map((t) => (t === to ? from : t)); if (P.tab === to) P.tab = from; saveTabs(); load(); },
        async () => { await api('asset/folders/rename', { method: 'POST', body: { from, to } }); P.tabs = P.tabs.map((t) => (t === from ? to : t)); if (P.tab === from) P.tab = to; saveTabs(); load(); });
      toast(r.merged ? `« ${from} » fondu dans « ${to} », qui existait déjà` : `dossier renommé « ${to} »`, 2200);
    } catch (e) { toast(e.message); }
    await load();
  }
  async function dissolve(name) {
    let ids = [];
    try { ids = (await api(`library?folder=${encodeURIComponent(name)}&limit=10000`)).items.map((x) => x.id); } catch { /* */ }
    if (!ids.length) return;
    if (!(await app.confirmBox('Défaire le dossier', `« ${name} » tient ${ids.length} objet${ids.length > 1 ? 's' : ''} : ${ids.length > 1 ? 'ils reviennent' : 'il revient'} à la racine, rien n’est supprimé. Le dossier disparaît d’Asset aussi (un dossier n’existe que par ce qu’il contient).`, 'Défaire le dossier'))) return;
    closeTab(name);
    await move(ids, '', `défaire le dossier « ${name} »`);
  }
  async function renameItem(it, title) {
    if (it.kind === 'sequence') { await app.renameSequence(it.id, title); await load(); return; }
    try {
      const old = it.title;
      const r = await api('library/' + it.id, { method: 'POST', body: { title } });
      app.items.set(it.id, r);
      app.pushUndo('renommer', async () => { await api('library/' + it.id, { method: 'POST', body: { title: old } }); load(); },
        async () => { await api('library/' + it.id, { method: 'POST', body: { title } }); load(); });
    } catch (e) { toast(e.status === 403 ? 'cet objet est à quelqu’un d’autre : seul son auteur (ou Cal) le renomme' : e.message); }
    await load();
  }
  async function trash(ids) {
    const items = ids.map(byId).filter(Boolean);
    const used = items.filter((it) => app.usedAnywhere(it.id));
    if (!(await app.confirmBox('Mettre à la corbeille', `${items.length > 1 ? `${items.length} objets partent` : `« ${items[0].title} » part`} à la corbeille d’Asset (on l’en sort depuis Asset, ou ctrl+Z).${used.length ? ` ${used.length} ${used.length > 1 ? 'sont employés' : 'est employé'} dans la séquence ouverte : l’export les refusera.` : ''}`, 'Mettre à la corbeille'))) return;
    try {
      await api('asset/trash', { method: 'POST', body: { ids } });
      for (const id of ids) app.closeSequence(id);
      app.pushUndo('mettre à la corbeille', async () => { await api('asset/restore', { method: 'POST', body: { ids } }); load(); },
        async () => { await api('asset/trash', { method: 'POST', body: { ids } }); load(); });
    } catch (e) { toast(e.status === 403 ? 'un de ces objets est à quelqu’un d’autre' : e.message); }
    P.sel.clear();
    await load();
  }

  // ── les onglets du panneau : le projet et les dossiers ouverts ──
  function openTab(name) {
    if (!P.tabs.includes(name)) P.tabs.push(name);
    P.tab = name; P.q = ''; $('#bin-q', root).value = '';
    P.sel.clear(); saveTabs(); paint();
  }
  function closeTab(name) {
    if (!name) return;
    P.tabs = P.tabs.filter((t) => t !== name);
    if (P.tab === name) P.tab = '';
    saveTabs(); paint();
  }
  function paintTabs() {
    const f = new Set(folders().map(([n]) => n));
    tabsBox.replaceChildren(...P.tabs.map((t) => {
      const b = el('div', { class: 'btab' + (t === P.tab ? ' on' : '') + (t && !f.has(t) && !P.q ? ' gone' : ''), role: 'tab', 'data-tab': t, tabindex: '0',
        title: t ? `dossier « ${t} » — double-clic : renommer · y glisser des objets : les y ranger` : 'le projet : la bibliothèque Asset — y glisser des objets : les sortir de leur dossier',
        onclick: (e) => { if (e.target.closest('.x')) return; P.tab = t; P.sel.clear(); saveTabs(); paint(); } },
      el('span', { class: 'nm', ondblclick: (e) => { if (t) { e.stopPropagation(); startRename('folder', t); } } }, t || 'Projet'),
      t ? el('button', { class: 'x', title: 'fermer l’onglet', 'aria-label': 'fermer', onclick: (e) => { e.stopPropagation(); closeTab(t); } }, '×') : null);
      dropOn(b, () => (t ? { into: t } : { out: true }));
      return b;
    }));
    // l'onglet ouvert se voit, même quand le panneau est étroit
    const on = tabsBox.querySelector('.btab.on');
    if (on) {
      const l = on.offsetLeft, r = l + on.offsetWidth;
      if (r > tabsBox.scrollLeft + tabsBox.clientWidth) tabsBox.scrollLeft = r - tabsBox.clientWidth + 4;
      else if (l < tabsBox.scrollLeft) tabsBox.scrollLeft = l;
    }
  }

  // ── le dessin ──────────────────────────────────────────────
  function paint() {
    paintTabs();
    $('#bin-n', root).textContent = P.all.length;
    $$('#bin-kinds .tb', root).forEach((b) => b.classList.toggle('on', b.dataset.k === P.kind));
    const used = app.usedIds();
    const cur = app.sourceId();
    const open = app.openSequenceId();
    const rows = [];
    if (!P.tab && !P.q) for (const [name, n] of folders()) rows.push(folderRow(name, n));
    const items = shown();
    for (const it of items) rows.push(itemRow(it, used, cur, open));
    if (!rows.length) {
      list.replaceChildren(el('p', { class: 'lbl empty-bin' }, P.q ? 'rien ne correspond' : P.tab ? `le dossier « ${P.tab} » est vide (ou a été renommé) : fermez l’onglet, ou glissez-y des objets` : 'la bibliothèque est vide : importez des vidéos, images ou sons (bouton Importer, ou glissez-les sur la page)'));
      return;
    }
    list.replaceChildren(...rows);
    const inp = list.querySelector('input.ren');
    if (inp && document.activeElement !== inp) { inp.focus(); inp.select(); }
  }

  function renameField(value, done) {
    const inp = el('input', { class: 'fld ren', value, maxlength: 80, spellcheck: 'false' });
    let over = false;
    const finish = (keep) => { if (over) return; over = true; P.renaming = null; const v = inp.value.trim(); if (keep && v && v !== value) done(v); else paint(); };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    inp.addEventListener('blur', () => finish(true));
    for (const ev of ['pointerdown', 'click', 'dblclick']) inp.addEventListener(ev, (e) => e.stopPropagation());
    return inp;
  }
  function startRename(type, id) { P.renaming = { type, id }; paint(); }

  function folderRow(name, n) {
    const renaming = P.renaming && P.renaming.type === 'folder' && P.renaming.id === name;
    const row = el('div', { class: 'bf' + (P.sel.has('folder:' + name) ? ' on' : ''), 'data-folder': name,
      title: name,
      onclick: (e) => { if (e.target.closest('input')) return; selectRow('folder:' + name, e); },
      ondblclick: (e) => { if (e.target.closest('input')) return; if (e.target.closest('b')) startRename('folder', name); else openTab(name); } },
    el('i', { class: 'fic' }), renaming ? renameField(name, (v) => renameFolder(name, v)) : el('b', {}, name), el('small', { class: 'num' }, String(n)));
    dropOn(row, () => ({ into: name }));
    return row;
  }

  function itemRow(it, used, cur, open) {
    const renaming = P.renaming && P.renaming.type === 'item' && P.renaming.id === it.id;
    const seq = it.kind === 'sequence';
    const row = el('div', { class: 'bi' + (seq ? ' seq' : '') + (it.id === cur || it.id === open ? ' cur' : '') + (P.sel.has(it.id) ? ' on' : ''), 'data-id': it.id,
      title: `${it.title}\n${meta(it)}${P.q && it.folder ? '\ndossier : ' + it.folder : ''}`,
      // clic : chargé dans la source sans quitter l'onglet Effets ; double-clic : l'onglet Source
      onclick: (e) => { if (e.target.closest('input')) return; selectRow(it.id, e); if (!seq && !e.shiftKey && !e.ctrlKey && !e.metaKey) app.openSource(it, { show: false }); },
      ondblclick: (e) => { if (e.target.closest('input')) return; if (seq) app.openSequence(it.id); else app.openSource(it); } },
    el('span', { class: 'th' + (it.kind === 'audio' ? ' audio' : '') + (seq ? ' seqth' : ''), style: it.thumb_url ? { backgroundImage: `url("${href(it.thumb_url)}")` } : null, html: seq && !it.thumb_url ? SEQ_ICON : null },
      // une séquence porte la marque commune dans le coin (on ne la confond plus avec le clip de même première image)
      seq ? kindMark(it, { compact: true }) : null),
    el('span', { class: 'tx' }, renaming ? renameField(it.title || '', (v) => renameItem(it, v)) : el('b', {}, seq ? el('i', { class: 'sq', html: SEQ_ICON }) : null, it.title || it.id),
      el('small', {}, P.q && it.folder ? `${it.folder} · ${meta(it)}` : meta(it))),
    used.has(it.id) ? el('span', { class: 'used', title: 'employé dans la séquence ouverte' }) : null);
    if (!renaming) {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        const ids = P.sel.has(it.id) ? shown().filter((x) => P.sel.has(x.id)).map((x) => x.id) : [it.id];
        P.dragIds = ids;
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData(ITEM_MIME, JSON.stringify({ id: it.id, kind: it.kind, title: it.title, thumb_url: it.thumb_url }));
        e.dataTransfer.setData(MULTI_MIME, JSON.stringify(ids));
        if (it.url && !seq) e.dataTransfer.setData('text/uri-list', href(it.url));
        app.markDrag(it, ids);
        if (ids.length > 1) {
          const g = el('div', { class: 'drag-count-ghost' }, `${ids.length} objets`);
          root.ownerDocument.body.append(g);   // l'image du glisser, dans la fenêtre du panneau
          e.dataTransfer.setDragImage(g, 10, 10);
          setTimeout(() => g.remove(), 0);
        }
      });
      row.addEventListener('dragend', () => { P.dragIds = null; app.clearDrag(); clearMarks(); });
      // un objet lâché sur un autre (à la racine, comme dans Asset) : un dossier neuf pour les deux
      dropOn(row, () => (!P.tab && !P.q && !(P.dragIds || []).includes(it.id) ? { merge: it.id } : null));
    }
    return row;
  }

  // ── choisir : clic, maj, ctrl, cadre ───────────────────────
  function selectRow(key, e) {
    const keys = [...(!P.tab && !P.q ? folders().map(([n]) => 'folder:' + n) : []), ...shown().map((x) => x.id)];
    if (e.shiftKey && P.anchor && keys.includes(P.anchor)) {
      const a = keys.indexOf(P.anchor), b = keys.indexOf(key);
      if (!(e.ctrlKey || e.metaKey)) P.sel.clear();
      for (const k of keys.slice(Math.min(a, b), Math.max(a, b) + 1)) P.sel.add(k);
    } else if (e.ctrlKey || e.metaKey) {
      P.sel.has(key) ? P.sel.delete(key) : P.sel.add(key);
      P.anchor = key;
    } else { P.sel = new Set([key]); P.anchor = key; }
    paint();
  }
  let mq = null;
  list.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.bi, .bf, input, button')) return;
    e.preventDefault();
    const base = e.shiftKey || e.ctrlKey || e.metaKey ? new Set(P.sel) : new Set();
    const box = el('div', { class: 'bin-mq' });
    list.ownerDocument.body.append(box);    // le cadre se dessine dans la fenêtre du panneau (ses coordonnées)
    mq = { x0: e.clientX, y0: e.clientY, base, box };
    try { list.setPointerCapture(e.pointerId); } catch { /* */ }
    if (!base.size) { P.sel.clear(); paint(); }
  });
  list.addEventListener('pointermove', (e) => {
    if (!mq) return;
    const x = Math.min(mq.x0, e.clientX), y = Math.min(mq.y0, e.clientY), w = Math.abs(e.clientX - mq.x0), h = Math.abs(e.clientY - mq.y0);
    Object.assign(mq.box.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    const lr = list.getBoundingClientRect();
    if (e.clientY > lr.bottom - 16) list.scrollTop += 12; else if (e.clientY < lr.top + 16) list.scrollTop -= 12;
    const sel = new Set(mq.base);
    for (const r of list.querySelectorAll('.bi, .bf')) {
      const b = r.getBoundingClientRect();
      if (b.right >= x && b.left <= x + w && b.bottom >= y && b.top <= y + h) sel.add(r.dataset.id || 'folder:' + r.dataset.folder);
    }
    P.sel = sel;
    for (const r of list.querySelectorAll('.bi, .bf')) r.classList.toggle('on', sel.has(r.dataset.id || 'folder:' + r.dataset.folder));
  });
  const endMq = () => { if (!mq) return; mq.box.remove(); mq = null; paint(); };
  list.addEventListener('pointerup', endMq);
  list.addEventListener('pointercancel', endMq);

  // ── déposer : sur un objet, un dossier, un onglet, l'icône « nouveau dossier » ──
  const dragged = (e) => {
    const t = [...(e.dataTransfer?.types || [])];
    if (t.includes(MULTI_MIME) || t.includes(ITEM_MIME) || t.includes('Files')) return true;
    return false;
  };
  function clearMarks() { $$('.drop-into, .drop-merge', root).forEach((n) => n.classList.remove('drop-into', 'drop-merge')); $$('.drop-say', root).forEach((n) => n.remove()); }
  function dropOn(node, what) {
    node.addEventListener('dragover', (e) => {
      if (!dragged(e)) return;
      const w = what();
      if (!w) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (!node.classList.contains(w.merge ? 'drop-merge' : 'drop-into')) {
        clearMarks();
        node.classList.add(w.merge ? 'drop-merge' : 'drop-into');
        node.append(el('span', { class: 'drop-say' }, w.merge ? 'nouveau dossier' : w.out ? 'sortir du dossier' : w.newSeq ? 'séquence à ses réglages' : w.newFolder ? 'nouveau dossier' : 'ranger ici'));
      }
    });
    node.addEventListener('dragleave', (e) => { if (!node.contains(e.relatedTarget)) { node.classList.remove('drop-into', 'drop-merge'); node.querySelector(':scope > .drop-say')?.remove(); } });
    node.addEventListener('drop', async (e) => {
      if (!dragged(e)) return;
      const w = what();
      if (!w) return;
      e.preventDefault(); e.stopPropagation();
      clearMarks();
      document.body.classList.remove('dropping');
      let ids = [];
      try { ids = JSON.parse(e.dataTransfer.getData(MULTI_MIME) || '[]'); } catch { ids = []; }
      if (!ids.length) { try { const d = JSON.parse(e.dataTransfer.getData(ITEM_MIME) || 'null'); if (d && d.id) ids = [d.id]; } catch { /* */ } }
      const files = [...(e.dataTransfer.files || [])];
      if (!ids.length && files.length) ids = (await app.uploadMany(files)).map((x) => x.id);
      if (!ids.length) return;
      if (w.newSeq) { const it = byId(ids[0]) || (await api('library/' + ids[0])); return app.newSequenceFrom(it); }
      if (w.newFolder) return askFolder(ids);
      if (w.merge) return askFolder([w.merge, ...ids.filter((id) => id !== w.merge)]);
      if (w.into) return move(ids, w.into);
      if (w.out) return move(ids, '');
    });
  }
  dropOn($('#bin-new', root), () => ({ newFolder: true }));
  dropOn($('#bin-newseq', root), () => ({ newSeq: true }));
  // le fond de la liste : dans l'onglet d'un dossier, y ranger ; à la racine, sortir du dossier
  dropOn(list, () => (P.q ? null : P.tab ? { into: P.tab } : (P.dragIds && P.dragIds.some((id) => (byId(id) || {}).folder) ? { out: true } : null)));

  // ── les boutons, la recherche ──────────────────────────────
  $('#bin-kinds', root).replaceChildren(...KINDS.map(([k, lab]) => el('button', { class: 'tb' + (k === P.kind ? ' on' : ''), 'data-k': k,
    onclick: () => { P.kind = k; LS('montage-bin-kind', k); load(); } }, lab)));
  let qT = 0;
  $('#bin-q', root).addEventListener('input', (e) => { P.q = e.target.value; clearTimeout(qT); qT = setTimeout(load, 220); });
  $('#bin-new', root).onclick = () => askFolder(selectedIds());
  $('#bin-newseq', root).onclick = () => {
    const ids = selectedIds().filter((id) => ['video', 'image', 'audio'].includes((byId(id) || {}).kind));
    if (ids.length === 1) return app.newSequenceFrom(byId(ids[0]));
    return app.newSequence(P.tab);
  };
  root.addEventListener('pointerdown', () => { P.focus = true; }, true);
  partout('pointerdown', (e) => { if (!root.contains(e.target)) P.focus = false; }, true);

  const selectedIds = () => shown().filter((x) => P.sel.has(x.id)).map((x) => x.id);
  const selectedFolders = () => [...P.sel].filter((k) => k.startsWith('folder:')).map((k) => k.slice(7));

  // ── le clic droit ──────────────────────────────────────────
  function menuFor(e) {
    const fr = e.target.closest('.bf');
    const ir = e.target.closest('.bi');
    const tb = e.target.closest('.btab');
    const np = app.hasSequence() ? {} : { disabled: true, why: 'ouvrez d’abord une séquence (double-clic sur une séquence, ou « Nouvelle séquence »)' };
    if (tb) {
      const t = tb.dataset.tab;
      return [{ head: t ? `Onglet · ${t}` : 'Projet' },
        t ? { label: 'Renommer le dossier', sub: 'double-clic', onclick: () => startRename('folder', t) } : null,
        t ? { label: 'Fermer l’onglet', onclick: () => closeTab(t) } : null,
        { label: 'Fermer les autres onglets', disabled: P.tabs.length < 2, why: 'un seul onglet', onclick: () => { P.tabs = ['', ...(t ? [t] : [])]; P.tab = t; saveTabs(); paint(); } }];
    }
    if (fr) {
      const name = fr.dataset.folder;
      if (!P.sel.has('folder:' + name)) { P.sel = new Set(['folder:' + name]); paint(); }
      return [{ head: `Dossier · ${name}` },
        { label: 'Ouvrir dans un onglet', sub: 'double-clic', onclick: () => openTab(name) },
        { label: 'Renommer', key: 'F2', onclick: () => startRename('folder', name) },
        { label: 'Nouvelle séquence dans ce dossier…', onclick: () => app.newSequence(name) },
        { label: 'Révéler dans Asset', sub: '↗', onclick: () => window.open(href('asset/#/d/' + encodeURIComponent(name)), '_blank', 'noopener') },
        '-',
        { label: 'Défaire le dossier', sub: 'le contenu revient à la racine', danger: true, onclick: () => dissolve(name) }];
    }
    if (ir) {
      const it = byId(ir.dataset.id);
      if (!it) return null;
      if (!P.sel.has(it.id)) { P.sel = new Set([it.id]); P.anchor = it.id; paint(); }
      const ids = selectedIds();
      const many = ids.length > 1;
      const seq = it.kind === 'sequence';
      const fold = [{ label: 'La racine', checked: !it.folder, onclick: () => move(ids, '') }, ...(folders().length ? ['-'] : []),
        ...folders().map(([n]) => ({ label: n, checked: it.folder === n, onclick: () => move(ids, n) })), '-',
        { label: 'Nouveau dossier…', icon: '+', onclick: () => askFolder(ids) }];
      return [
        { head: many ? `${ids.length} objets` : it.title || it.id },
        seq ? { label: 'Ouvrir dans la timeline', sub: 'double-clic', onclick: () => app.openSequence(it.id) }
          : { label: 'Ouvrir dans le moniteur source', onclick: () => app.openSource(it) },
        !seq ? { label: 'Nouvelle séquence à partir de l’élément', sub: 'ses réglages', onclick: () => app.newSequenceFrom(it) } : null,
        !seq ? { label: 'Insérer à la tête de lecture', key: ',', ...np, onclick: () => app.fromBin(it, 'insert') } : null,
        !seq ? { label: 'Écraser à la tête de lecture', key: '.', ...np, onclick: () => app.fromBin(it, 'overwrite') } : null,
        !seq ? { label: many ? 'Ajouter au bout de la piste cible, dans l’ordre' : 'Ajouter au bout de la piste cible', ...np, onclick: () => app.appendMany(ids) } : null,
        seq ? { label: 'Dupliquer', onclick: () => app.duplicateSequence(it.id) } : null,
        '-',
        { label: 'Renommer', key: 'F2', disabled: many, why: 'un seul objet à la fois', onclick: () => startRename('item', it.id) },
        { label: 'Ranger dans', items: fold },
        it.folder ? { label: 'Sortir du dossier', onclick: () => move(ids, '') } : null,
        { label: 'Nouveau dossier avec la sélection…', key: 'Ctrl+B', onclick: () => askFolder(ids) },
        '-',
        { label: 'Révéler dans Asset', sub: '↗', disabled: many, why: 'un seul objet à la fois', onclick: () => window.open(href('asset/#' + it.id), '_blank', 'noopener') },
        { label: 'Mettre à la corbeille', key: 'Suppr', danger: true, onclick: () => trash(ids) },
      ];
    }
    return [
      { head: P.tab ? `Dossier · ${P.tab}` : 'Projet · Asset' },
      { label: 'Nouvelle séquence…', onclick: () => app.newSequence(P.tab) },
      { label: 'Nouveau dossier avec la sélection…', key: 'Ctrl+B', disabled: !selectedIds().length, why: 'choisissez d’abord des objets (un cadre sur le fond de la liste)', onclick: () => askFolder(selectedIds()) },
      { label: 'Importer…', key: 'Ctrl+I', onclick: () => $('#bin-file').click() },
      '-',
      { label: 'Tout choisir', key: 'Ctrl+A', onclick: () => { P.sel = new Set(shown().map((x) => x.id)); paint(); } },
      { label: 'Trier par', items: SORTS.map(([k, lab]) => ({ label: lab, checked: P.sort === k, onclick: () => { P.sort = k; LS('montage-bin-sort', k); paint(); } })) },
      { label: 'Afficher', items: KINDS.map(([k, lab]) => ({ label: lab, checked: P.kind === k, onclick: () => { P.kind = k; LS('montage-bin-kind', k); load(); } })) },
      { label: 'Ouvrir Asset', sub: '↗', onclick: () => window.open(href(P.tab ? 'asset/#/d/' + encodeURIComponent(P.tab) : 'asset/'), '_blank', 'noopener') },
      // le panneau dans sa fenêtre (commun/fenetre.js), ou de retour dans la page
      ...(app.detachItem ? ['-', app.detachItem()] : []),
    ];
  }
  contextMenu(root, menuFor);

  // ── le clavier, quand le panneau l'a ───────────────────────
  function key(e) {
    if (!P.focus) return false;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    const ids = selectedIds(), fs = selectedFolders();
    if (k === 'F2') {
      e.preventDefault();
      if (fs.length === 1 && !ids.length) startRename('folder', fs[0]);
      else if (ids.length === 1) startRename('item', ids[0]);
      return true;
    }
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      if (ids.length) trash(ids); else if (fs.length === 1) dissolve(fs[0]);
      return true;
    }
    if (k === 'Enter' && ids.length === 1) {
      const it = byId(ids[0]);
      if (it.kind === 'sequence') app.openSequence(it.id); else app.openSource(it);
      return true;
    }
    if (k === 'Enter' && fs.length === 1 && !ids.length) { openTab(fs[0]); return true; }
    if (ctrl && k.toLowerCase() === 'a') { e.preventDefault(); P.sel = new Set(shown().map((x) => x.id)); paint(); return true; }
    return false;
  }

  function reveal(id) {
    const it = byId(id);
    P.q = ''; $('#bin-q', root).value = '';
    if (it && it.folder) openTab(it.folder); else { P.tab = ''; saveTabs(); }
    P.sel = new Set([id]);
    const go = () => { paint(); const row = list.querySelector(`.bi[data-id="${id}"]`); if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1200); } };
    if (!P.all.some((x) => x.id === id) || P.kind) { P.kind = ''; load().then(go); } else go();
  }

  return { load, soon, paint, reveal, key, askFolder, selectedIds, get focus() { return P.focus; }, state: P };
}
