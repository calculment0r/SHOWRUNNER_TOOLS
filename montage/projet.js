// MONTAGE — le panneau Projet : ce que le montage a pris dans la bibliothèque.
//
// Demande de Cal du 30/09 : un asset glissé du panneau Asset dans la fenêtre
// Projet y ENTRE (à la racine, ou dans le dossier sur lequel on le lâche) ; le
// retirer du Projet ne le retire que du montage — il reste dans la bibliothèque
// générale. Le Projet est donc à lui (server/tools/montage_projet.py, un par
// Workspace) : ses objets (séquences, vidéos, images, sons de la bibliothèque) et
// ses dossiers (un seul niveau, un dossier n'existe que par ce qu'il contient).
// Ranger ici ne touche plus le dossier d'Asset. Premiere a de même un panneau
// Projet à côté de ses Bibliothèques (docs/etudes/panneau_asset.md, [PR1][PR3]).
// Jusqu'au 30/09, le Projet montrait toute la bibliothèque (décision du 29/09) et
// « Suppr » l'envoyait à la corbeille d'Asset : la première lecture reprend ce
// qu'il montrait, chacun dans son dossier d'Asset.
//
// Les gestes :
//   - lâcher dans le panneau (un objet du panneau Asset, d'une autre page, du
//     Projet lui-même, un fichier du disque ; plusieurs d'un coup) : sur le fond,
//     dans le dossier ouvert (la racine dans l'onglet « Projet ») — le panneau
//     s'entoure de vert ; sur un dossier (sa ligne ou son onglet) : dedans — le
//     dossier passe en vert, le cadre du panneau s'éteint ; survolé un moment
//     (comme les dossiers à ressort du Finder : « how long an item has to be over
//     a folder before the folder opens », Apple, Mouse & Trackpad), le dossier
//     s'ouvre dans son onglet ; sur l'icône « nouveau dossier » : la fenêtre qui
//     demande son nom ; sur l'icône « nouvelle séquence » : une séquence à ses
//     réglages (Adobe, « Create a sequence » : « drag a clip from the Project panel
//     to the New Item icon ») ; ctrl+Z défait ;
//   - une sélection au cadre (glisser sur le fond de la liste, maj : ajouter) ;
//   - double-clic sur le nom d'un dossier : le renommer ; sur le dossier : il
//     s'ouvre dans un onglet du panneau (Adobe, « Open and close bins » :
//     « Double-click to open a bin in its own dockable panel ») ;
//   - double-clic sur une séquence : elle s'ouvre dans un onglet au-dessus de la
//     timeline (Adobe, « Navigate sequences in the timeline ») ;
//   - Suppr, « Retirer du projet » : l'objet quitte le Projet, la bibliothèque le
//     garde ; posé sur une timeline, on le dit et on demande (garder les plans, ou
//     les retirer aussi de la séquence ouverte).
// Glisser vers la timeline, la source ou une autre page : le glisser-déposer
// HTML du portail (ITEM_MIME), plusieurs objets sous MULTI_MIME.

import { api, el, toast, href, ITEM_MIME, kindMark } from '../commun/shell.js';
// le panneau peut être dans sa fenêtre (un 2ᵉ écran) : $ y cherche aussi, partout y écoute aussi
import { $, $$, partout } from '../commun/fenetre.js';
import { contextMenu } from '../commun/menu.js';

export const MULTI_MIME = 'application/x-sr-items';
const KINDS = [['', 'Tout'], ['sequence', 'Séquences'], ['video', 'Vidéos'], ['image', 'Images'], ['audio', 'Sons']];
const SORTS = [['new', 'Date (récent d’abord)'], ['name', 'Nom'], ['duration', 'Durée'], ['kind', 'Sorte']];
const LS = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } return null; };
const short = (sec) => { sec = Math.max(0, sec || 0); const m = Math.floor(sec / 60), s = sec - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(s < 10 && m === 0 ? 1 : 0)}`; };
const cleanFolder = (s) => ' '.concat(s || '').split(/\s+/).filter(Boolean).join(' ').slice(0, 60);
const SPRING_MS = 700;    // le délai du Finder se règle (Apple ne donne pas sa valeur par défaut) : le nôtre

const SEQ_ICON = '<svg viewBox="0 0 24 24"><path d="M3 6h18v12H3zM3 10h18M3 14h18M8 6v4M14 10v4M11 14v4"/></svg>';

export function mountProject(app) {
  const root = app.root;
  const P = {
    every: [], all: [], kind: LS('montage-bin-kind') || '', q: '', sort: LS('montage-bin-sort') || 'new',
    tabs: LS('montage-bin-tabs') || [''], tab: LS('montage-bin-tab') || '', sel: new Set(), anchor: null,
    renaming: null, focus: false, dragIds: null,
  };
  if (!P.tabs.includes('')) P.tabs.unshift('');
  if (!P.tabs.includes(P.tab)) P.tab = '';
  const list = $('.bin-list', root);
  const tabsBox = $('#bin-tabs', root);
  const saveTabs = () => { LS('montage-bin-tabs', P.tabs); LS('montage-bin-tab', P.tab); };

  // ── les données : le Projet (GET /api/montage/bin) ─────────
  let loadT = 0;
  function filter() {
    const q = P.q.trim().toLowerCase();
    P.all = P.every.filter((it) => (!P.kind || it.kind === P.kind)
      && (!q || `${it.title || ''} ${it.prompt || ''} ${(it.tags || []).join(' ')}`.toLowerCase().includes(q)));
  }
  async function load() {
    try {
      const r = await api('montage/bin');
      P.every = r.items;
      for (const it of r.items) app.items.set(it.id, it);
    } catch (e) { P.every = []; P.all = []; list.replaceChildren(el('p', { class: 'warn' }, e.message)); return; }
    filter();
    paint();
  }
  const soon = () => { clearTimeout(loadT); loadT = setTimeout(load, 120); };
  const byId = (id) => P.every.find((x) => x.id === id);
  const inProject = (id) => !!byId(id);
  const folders = () => {
    const m = new Map();
    for (const it of P.all) if (it.bin) m.set(it.bin, (m.get(it.bin) || 0) + 1);
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
    return sorted(P.all.filter((it) => (it.bin || '') === P.tab));
  }

  // ── les gestes : l'API du Projet, avec l'annulation du montage ─
  const restoreBin = (before) => api('montage/bin/restore', { method: 'POST', body: { before } });
  const where = (f) => (f ? `« ${f} »` : 'la racine');
  // entrer dans le Projet, ou y changer de dossier : un seul geste (POST /api/montage/bin/put)
  async function move(ids, folder, label) {
    folder = cleanFolder(folder);
    if (folder.includes('/')) { toast('un dossier ne se range pas dans un autre : pas de « / » dans son nom'); return; }
    let r;
    try { r = await api('montage/bin/put', { method: 'POST', body: { ids, folder } }); } catch (e) { toast(e.message); await load(); return; }
    const back = r.before;
    const entered = back.filter((b) => b.folder === null).length, moved = back.length - entered;
    if (back.length) {
      app.pushUndo(label || (entered ? `entrer dans le Projet (${where(folder)})` : `ranger dans ${where(folder)}`),
        async () => { await restoreBin(back); await load(); },
        async () => { await api('montage/bin/put', { method: 'POST', body: { ids: back.map((b) => b.id), folder } }); await load(); });
    }
    const n = (k, one, many) => (k > 1 ? `${k} ${many}` : one);
    const said = [entered ? `${n(entered, 'entré', 'objets entrés')} dans le Projet` : '', moved ? `${n(moved, 'rangé', 'objets rangés')}` : ''].filter(Boolean).join(', ');
    const why = r.refused.length ? ` · pas pris : ${r.refused.map((x) => `${(byId(x.id) || app.items.get(x.id) || {}).title || x.id} (${x.why})`).join(' ; ')}` : '';
    if (said) toast(`${said} · ${folder ? `dossier « ${folder} »` : 'à la racine'} · ctrl+Z${why}`, why ? 6000 : 2400);
    else if (why) toast(why.slice(3), 6000);
    else if (r.ids.length) toast(`déjà dans ${where(folder)}`, 1600);
    await load();
    // ce qui vient d'arriver se voit : choisi, et la ligne éclaire
    const here = new Set(shown().map((x) => x.id));
    const got = r.ids.filter((id) => here.has(id));
    if (got.length) {
      P.sel = new Set(got); paint();
      const row = list.querySelector(`.bi[data-id="${got[0]}"]`);
      if (row) { row.scrollIntoView({ block: 'nearest' }); for (const id of got) list.querySelector(`.bi[data-id="${id}"]`)?.classList.add('flash'); setTimeout(() => $$('.bi.flash', root).forEach((x) => x.classList.remove('flash')), 1200); }
    }
  }
  function askFolder(ids) {
    ids = [...new Set(ids)].filter(Boolean);
    if (!ids.length) { toast('choisissez d’abord des objets (un cadre à la souris sur le fond de la liste) : un dossier existe par ce qu’il contient'); return; }
    const inp = el('input', { class: 'fld big-fld', maxlength: 60, placeholder: 'Rushes, Plans larges, Musiques…', spellcheck: 'false', 'aria-label': 'nom du dossier' });
    const minis = ids.slice(0, 8).map((id) => { const it = byId(id) || app.items.get(id) || {}; return el('span', { class: 'mini' }, el('i', { style: it.thumb_url ? { backgroundImage: `url("${href(it.thumb_url)}")` } : null }), el('b', {}, it.title || id)); });
    const ok = async (close) => {
      const name = cleanFolder(inp.value);
      if (!name) { inp.placeholder = 'il lui faut un nom'; inp.focus(); return; }
      if (name.includes('/')) { inp.value = name.replace(/\//g, '·'); return; }
      close();
      await move(ids, name, `nouveau dossier « ${name} »`);
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(closer); } });
    const closer = app.modal('Nouveau dossier', el('div', { class: 'newfolder' },
      el('p', {}, `Comment s’appelle ce dossier du Projet ? Il prend ${ids.length > 1 ? `ces ${ids.length} objets` : 'cet objet'}.`),
      el('div', { class: 'minis' }, ...minis, ids.length > 8 ? el('span', { class: 'lbl' }, `+ ${ids.length - 8}`) : null), inp,
      el('p', { class: 'note' }, 'Un dossier tient des séquences, des vidéos, des images et des sons — pas d’autre dossier (un seul niveau). Il est au Projet du Montage : Asset garde son rangement.')),
    (close) => [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', onclick: close }, 'Annuler'), el('button', { class: 'tb go', onclick: () => ok(close) }, 'Créer le dossier')],
    { cls: 'center' });
    inp.focus();
    setTimeout(() => { if (document.activeElement !== inp) inp.focus(); }, 30);
  }
  async function renameFolder(from, to) {
    to = cleanFolder(to);
    if (!to || to === from) return;
    if (to.includes('/')) { toast('pas de « / » dans le nom d’un dossier'); return; }
    const retab = (a, b) => { P.tabs = P.tabs.map((t) => (t === a ? b : t)); if (P.tab === a) P.tab = b; saveTabs(); };
    try {
      const r = await api('montage/bin/folder', { method: 'POST', body: { from, to } });
      retab(from, to);
      app.pushUndo(`renommer le dossier « ${from} »`,
        async () => { await restoreBin(r.before); retab(to, from); await load(); },
        async () => { await api('montage/bin/folder', { method: 'POST', body: { from, to } }); retab(from, to); await load(); });
      toast(r.merged ? `« ${from} » fondu dans « ${to} », qui existait déjà` : `dossier renommé « ${to} »`, 2200);
    } catch (e) { toast(e.message); }
    await load();
  }
  async function dissolve(name) {
    const ids = P.every.filter((x) => x.bin === name).map((x) => x.id);
    if (!ids.length) return;
    if (!(await app.confirmBox('Défaire le dossier', `« ${name} » tient ${ids.length} objet${ids.length > 1 ? 's' : ''} : ${ids.length > 1 ? 'ils reviennent' : 'il revient'} à la racine du Projet, rien n’est retiré.`, 'Défaire le dossier'))) return;
    closeTab(name);
    await move(ids, '', `défaire le dossier « ${name} »`);
  }
  async function renameItem(it, title) {
    if (it.kind === 'sequence') { await app.renameSequence(it.id, title); await load(); return; }
    try {
      const old = it.title;
      const r = await api('library/' + it.id, { method: 'POST', body: { title } });
      app.items.set(it.id, { ...r, bin: it.bin });
      app.pushUndo('renommer', async () => { await api('library/' + it.id, { method: 'POST', body: { title: old } }); load(); },
        async () => { await api('library/' + it.id, { method: 'POST', body: { title } }); load(); });
    } catch (e) { toast(e.status === 403 ? 'cet objet est à quelqu’un d’autre : seul son auteur (ou Cal) le renomme' : e.message); }
    await load();
  }
  // une question à plusieurs issues : [libellé, valeur, go?] ; rend la valeur, ou null (Annuler, Échap)
  function choose(title, text, choices) {
    return new Promise((resolve) => {
      let done = false;
      const pick = (v, close) => { done = true; close(); resolve(v); };
      app.modal(title, el('div', { class: 'newfolder' }, ...[].concat(text).map((t) => el('p', {}, t))),
        (close) => [el('span', { class: 'sp' }), el('button', { class: 'tb ghost', onclick: close }, 'Annuler'),
          ...choices.map(([lab, v, go]) => el('button', { class: 'tb ' + (go ? 'go' : 'ghost'), onclick: () => pick(v, close) }, lab))],
        { cls: 'center', onclose: () => { if (!done) resolve(null); } });
    });
  }
  // Retirer du Projet : l'objet quitte le montage, la bibliothèque le garde (POST /api/montage/bin/remove).
  // Posé sur une timeline : on le dit, et on demande (Premiere, « Clear » d'un clip employé, prévient aussi).
  async function removeFromProject(ids) {
    ids = [...new Set(ids)].filter(inProject);
    if (!ids.length) return;
    const items = ids.map(byId);
    const one = items.length === 1;
    const who = one ? `« ${items[0].title || items[0].id} »` : `${items.length} objets`;
    const openId = app.openSequenceId();
    const clips = app.clipsUsing(ids);
    const others = P.every.filter((s) => s.kind === 'sequence' && s.id !== openId && !ids.includes(s.id) && (s.parents || []).some((x) => ids.includes(x)));
    const elsewhere = others.length ? `${one ? 'Il est' : 'Ils sont'} aussi ${one ? 'posé' : 'posés'} dans ${others.length > 1 ? 'les séquences' : 'la séquence'} ${others.map((s) => `« ${s.title} »`).join(', ')} : ${others.length > 1 ? 'leurs' : 'ses'} plans y restent.` : '';
    let strip = false;
    const keep = `${one ? 'Il reste' : 'Ils restent'} dans la bibliothèque (Asset, le panneau Asset) : rien n’est supprimé.`;
    if (clips.n) {
      const ans = await choose('Retirer du projet', [
        `${who} ${one ? 'est posé' : 'sont posés'} dans la séquence ouverte : ${clips.n} plan${clips.n > 1 ? 's' : ''}${clips.locked ? `, dont ${clips.locked} sur une piste verrouillée (${clips.locked > 1 ? 'ils restent' : 'il reste'})` : ''}.`,
        keep, elsewhere].filter(Boolean),
      [['Garder les plans', 'keep'], ['Retirer aussi les plans', 'strip', true]]);
      if (!ans) return;
      strip = ans === 'strip';
    } else if (others.length) {
      if (!(await choose('Retirer du projet', [elsewhere, keep], [['Retirer du projet', 'go', true]]))) return;
    }
    let r;
    try { r = await api('montage/bin/remove', { method: 'POST', body: { ids } }); } catch (e) { toast(e.message); return; }
    const cut = strip ? app.stripClips(ids) : null;
    for (const it of items) if (it.kind === 'sequence') app.closeSequence(it.id);
    app.pushUndo(`retirer du projet ${who}`,
      async () => { if (cut) cut.undo(); await restoreBin(r.before); await load(); },
      async () => { await api('montage/bin/remove', { method: 'POST', body: { ids } }); if (cut) cut.redo(); await load(); });
    toast(`${who} ${one ? 'retiré' : 'retirés'} du Projet${cut ? ` avec ${cut.n} plan${cut.n > 1 ? 's' : ''}` : ''} — ${one ? 'il reste' : 'ils restent'} dans Asset · ctrl+Z`, 3600);
    P.sel.clear();
    await load();
  }

  // ── les onglets du panneau : le projet et les dossiers ouverts ──
  function openTab(name) {
    if (!P.tabs.includes(name)) P.tabs.push(name);
    P.tab = name; P.q = ''; $('#bin-q', root).value = '';
    P.sel.clear(); saveTabs(); filter(); paint();
  }
  function closeTab(name) {
    if (!name) return;
    P.tabs = P.tabs.filter((t) => t !== name);
    if (P.tab === name) P.tab = '';
    saveTabs(); paint();
  }
  function paintTabs() {
    const f = new Set(folders().map(([n]) => n));
    tabsBox.replaceChildren(...P.tabs.map((t) => el('div', { class: 'btab' + (t === P.tab ? ' on' : '') + (t && !f.has(t) && !P.q ? ' gone' : ''), role: 'tab', 'data-tab': t, tabindex: '0',
      title: t ? `dossier « ${t} » du Projet — double-clic : renommer · y lâcher des objets : les y ranger` : 'le Projet du Montage — y lâcher des objets : à la racine',
      onclick: (e) => { if (e.target.closest('.x')) return; P.tab = t; P.sel.clear(); saveTabs(); paint(); } },
    el('span', { class: 'nm', ondblclick: (e) => { if (t) { e.stopPropagation(); startRename('folder', t); } } }, t || 'Projet'),
    t ? el('button', { class: 'x', title: 'fermer l’onglet', 'aria-label': 'fermer', onclick: (e) => { e.stopPropagation(); closeTab(t); } }, '×') : null)));
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
    hot = null;                                     // les nœuds se refont : la marque du dépôt se repose au prochain survol
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
      list.replaceChildren(el('p', { class: 'lbl empty-bin' }, P.q ? 'rien ne correspond' : P.tab ? `le dossier « ${P.tab} » est vide (ou a été renommé) : fermez l’onglet, ou lâchez-y des objets`
        : 'le Projet est vide : lâchez-y des objets du panneau Asset (ctrl+espace), des fichiers du disque, ou importez-les (bouton Importer)'));
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
    return el('div', { class: 'bf' + (P.sel.has('folder:' + name) ? ' on' : ''), 'data-folder': name,
      title: `${name} — double-clic : l’ouvrir · y lâcher des objets : les y ranger`,
      onclick: (e) => { if (e.target.closest('input')) return; selectRow('folder:' + name, e); },
      ondblclick: (e) => { if (e.target.closest('input')) return; if (e.target.closest('b')) startRename('folder', name); else openTab(name); } },
    el('i', { class: 'fic' }), renaming ? renameField(name, (v) => renameFolder(name, v)) : el('b', {}, name), el('small', { class: 'num' }, String(n)));
  }

  function itemRow(it, used, cur, open) {
    const renaming = P.renaming && P.renaming.type === 'item' && P.renaming.id === it.id;
    const seq = it.kind === 'sequence';
    const row = el('div', { class: 'bi' + (seq ? ' seq' : '') + (it.id === cur || it.id === open ? ' cur' : '') + (P.sel.has(it.id) ? ' on' : ''), 'data-id': it.id,
      title: `${it.title}\n${meta(it)}${P.q && it.bin ? '\ndossier : ' + it.bin : ''}`,
      // clic : chargé dans la source sans quitter l'onglet Effets ; double-clic : l'onglet Source
      onclick: (e) => { if (e.target.closest('input')) return; selectRow(it.id, e); if (!seq && !e.shiftKey && !e.ctrlKey && !e.metaKey) app.openSource(it, { show: false }); },
      ondblclick: (e) => { if (e.target.closest('input')) return; if (seq) app.openSequence(it.id); else app.openSource(it); } },
    el('span', { class: 'th' + (it.kind === 'audio' ? ' audio' : '') + (seq ? ' seqth' : ''), style: it.thumb_url ? { backgroundImage: `url("${href(it.thumb_url)}")` } : null, html: seq && !it.thumb_url ? SEQ_ICON : null },
      // une séquence porte la marque commune dans le coin (on ne la confond plus avec le clip de même première image)
      seq ? kindMark(it, { compact: true }) : null),
    el('span', { class: 'tx' }, renaming ? renameField(it.title || '', (v) => renameItem(it, v)) : el('b', {}, seq ? el('i', { class: 'sq', html: SEQ_ICON }) : null, it.title || it.id),
      el('small', {}, P.q && it.bin ? `${it.bin} · ${meta(it)}` : meta(it))),
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
      row.addEventListener('dragend', endDrag);
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

  // ── déposer : une seule règle pour tout le panneau ─────────
  // La cible se lit sous la souris : l'icône « nouveau dossier » ou « nouvelle séquence », un
  // onglet, une ligne de dossier — sinon le fond, c'est-à-dire le dossier ouvert (la racine dans
  // l'onglet « Projet »). Une ligne d'objet n'est pas une cible : elle fait partie du fond (avant
  // le 30/09, un objet lâché sur un autre ouvrait « nouveau dossier » — le geste d'Asset, pris ici
  // pour un bogue). Vert = ce qui va recevoir : le dossier visé, sinon le cadre du panneau.
  const dragged = (e) => { const t = [...(e.dataTransfer?.types || [])]; return t.includes(MULTI_MIME) || t.includes(ITEM_MIME) || t.includes('Files'); };
  let hot = null;       // la cible marquée : { key, node }
  let spring = null;    // { key, t } : le dossier survolé qui va s'ouvrir
  function targetOf(e) {
    const n = e.target instanceof Element ? e.target : e.target?.parentElement;
    if (!n || !root.contains(n)) return null;
    const ic = n.closest('#bin-new, #bin-newseq');
    if (ic) return ic.id === 'bin-new' ? { newFolder: true, node: ic, key: 'new', say: 'nouveau dossier' } : { newSeq: true, node: ic, key: 'newseq', say: 'séquence à ses réglages' };
    const tab = n.closest('.btab');
    if (tab) return { folder: tab.dataset.tab, node: tab, key: 'tab:' + tab.dataset.tab, say: tab.dataset.tab ? 'dans ce dossier' : 'à la racine', open: tab.dataset.tab !== P.tab };
    const f = n.closest('.bf');
    if (f) return { folder: f.dataset.folder, node: f, key: 'f:' + f.dataset.folder, say: 'dans ce dossier', open: true };
    return { folder: P.tab, node: null, key: 'bg:' + P.tab };
  }
  // un glisser parti du Projet, lâché là où il est déjà : rien à faire, rien ne s'allume
  const noop = (w) => !!(P.dragIds && w.folder !== undefined && P.dragIds.every((id) => (byId(id) || {}).bin === w.folder));
  function unmark() {
    root.classList.remove('drop-on');
    $$('.drop-on', root).forEach((n) => n.classList.remove('drop-on'));
    $$('.drop-say', root).forEach((n) => n.remove());
    hot = null;
  }
  function mark(w) {
    if (hot && hot.key === w.key && (!w.node || w.node.classList.contains('drop-on'))) return;
    unmark();
    hot = w;
    if (!w.node) { root.classList.add('drop-on'); return; }   // le fond : le cadre du panneau
    w.node.classList.add('drop-on');                         // un dossier, un onglet, une icône : lui seul, le cadre éteint
    if (w.say) w.node.append(el('span', { class: 'drop-say' }, w.say));
  }
  function stopSpring() { if (spring) { clearTimeout(spring.t); spring = null; } }
  function springFor(w) {
    if (!w.open) { stopSpring(); return; }
    if (spring && spring.key === w.key) return;
    stopSpring();
    spring = { key: w.key, t: setTimeout(() => { spring = null; unmark(); if (w.key.startsWith('f:')) openTab(w.folder); else { P.tab = w.folder; P.sel.clear(); saveTabs(); paint(); } }, SPRING_MS) };
  }
  function endDrag() { P.dragIds = null; app.clearDrag(); unmark(); stopSpring(); }
  root.addEventListener('dragover', (e) => {
    if (!dragged(e)) return;
    const w = targetOf(e);
    if (!w) return;
    e.preventDefault(); e.stopPropagation();
    if (noop(w) && !w.open) { unmark(); stopSpring(); e.dataTransfer.dropEffect = 'none'; return; }
    e.dataTransfer.dropEffect = P.dragIds ? 'move' : 'copy';
    mark(w);
    springFor(w);
  });
  root.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !root.contains(e.relatedTarget)) { unmark(); stopSpring(); } });
  // la fin d'un glisser, où qu'elle ait lieu (la ligne de départ a pu être redessinée : son dragend ne vient plus)
  for (const ev of ['dragend', 'drop']) root.ownerDocument.addEventListener(ev, () => { setTimeout(() => { if (ev === 'dragend') endDrag(); else { unmark(); stopSpring(); } }, 0); }, true);
  root.addEventListener('drop', async (e) => {
    if (!dragged(e)) return;
    const w = targetOf(e);
    unmark(); stopSpring();
    if (!w) return;
    e.preventDefault(); e.stopPropagation();
    document.body.classList.remove('dropping'); root.ownerDocument.body.classList.remove('dropping');
    const inside = P.dragIds;
    P.dragIds = null;
    let ids = [];
    try { ids = JSON.parse(e.dataTransfer.getData(MULTI_MIME) || '[]'); } catch { ids = []; }
    if (!Array.isArray(ids)) ids = [];
    if (!ids.length) { try { const d = JSON.parse(e.dataTransfer.getData(ITEM_MIME) || 'null'); if (d && d.id) ids = [d.id]; } catch { /* */ } }
    const files = [...(e.dataTransfer.files || [])];
    // un fichier du disque : dans la bibliothèque (catégorie Upload), puis dans le Projet, là où on l'a lâché
    if (!ids.length && files.length) ids = (await app.uploadMany(files, { bin: false })).map((x) => x.id);
    if (!ids.length) return;
    if (w.newSeq) { const it = byId(ids[0]) || app.items.get(ids[0]) || (await api('library/' + ids[0]).catch(() => null)); return it ? app.newSequenceFrom(it) : null; }
    if (w.newFolder) return askFolder(ids);          // ce qui n'était pas au Projet y entre, dans le dossier neuf
    if (inside && noop(w)) return;
    return move(ids, w.folder);
  });

  // ── les boutons, la recherche ──────────────────────────────
  $('#bin-kinds', root).replaceChildren(...KINDS.map(([k, lab]) => el('button', { class: 'tb' + (k === P.kind ? ' on' : ''), 'data-k': k,
    onclick: () => { P.kind = k; LS('montage-bin-kind', k); filter(); paint(); } }, lab)));
  let qT = 0;
  $('#bin-q', root).addEventListener('input', (e) => { clearTimeout(qT); qT = setTimeout(() => { P.q = e.target.value; filter(); paint(); }, 160); });
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
        '-',
        { label: 'Défaire le dossier', sub: 'le contenu revient à la racine', onclick: () => dissolve(name) }];
    }
    if (ir) {
      const it = byId(ir.dataset.id);
      if (!it) return null;
      if (!P.sel.has(it.id)) { P.sel = new Set([it.id]); P.anchor = it.id; paint(); }
      const ids = selectedIds();
      const many = ids.length > 1;
      const seq = it.kind === 'sequence';
      const fold = [{ label: 'La racine', checked: !it.bin, onclick: () => move(ids, '') }, ...(folders().length ? ['-'] : []),
        ...folders().map(([n]) => ({ label: n, checked: it.bin === n, onclick: () => move(ids, n) })), '-',
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
        it.bin ? { label: 'Sortir du dossier', onclick: () => move(ids, '') } : null,
        { label: 'Nouveau dossier avec la sélection…', key: 'Ctrl+B', onclick: () => askFolder(ids) },
        '-',
        { label: 'Révéler dans Asset', sub: '↗', disabled: many, why: 'un seul objet à la fois', onclick: () => window.open(href('asset/#' + it.id), '_blank', 'noopener') },
        { label: 'Retirer du projet', key: 'Suppr', sub: 'reste dans Asset', danger: true, onclick: () => removeFromProject(ids) },
      ];
    }
    return [
      { head: P.tab ? `Dossier · ${P.tab}` : 'Projet' },
      { label: 'Nouvelle séquence…', onclick: () => app.newSequence(P.tab) },
      { label: 'Nouveau dossier avec la sélection…', key: 'Ctrl+B', disabled: !selectedIds().length, why: 'choisissez d’abord des objets (un cadre sur le fond de la liste)', onclick: () => askFolder(selectedIds()) },
      { label: 'Importer…', key: 'Ctrl+I', onclick: () => $('#bin-file').click() },
      '-',
      { label: 'Tout choisir', key: 'Ctrl+A', onclick: () => { P.sel = new Set(shown().map((x) => x.id)); paint(); } },
      { label: 'Trier par', items: SORTS.map(([k, lab]) => ({ label: lab, checked: P.sort === k, onclick: () => { P.sort = k; LS('montage-bin-sort', k); paint(); } })) },
      { label: 'Afficher', items: KINDS.map(([k, lab]) => ({ label: lab, checked: P.kind === k, onclick: () => { P.kind = k; LS('montage-bin-kind', k); filter(); paint(); } })) },
      { label: 'Ouvrir Asset', sub: '↗', onclick: () => window.open(href('asset/'), '_blank', 'noopener') },
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
      if (ids.length) removeFromProject(ids); else if (fs.length === 1) dissolve(fs[0]);
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
    if (!it) { toast('cet objet n’est pas dans le Projet (il est dans Asset) : glissez-le du panneau Asset pour l’y mettre'); return; }
    P.q = ''; $('#bin-q', root).value = '';
    P.kind = ''; LS('montage-bin-kind', '');
    filter();
    if (it.bin) openTab(it.bin); else { P.tab = ''; saveTabs(); }
    P.sel = new Set([id]);
    paint();
    const row = list.querySelector(`.bi[data-id="${id}"]`);
    if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1200); }
  }

  return { load, soon, paint, reveal, key, askFolder, selectedIds, removeFromProject, move, get focus() { return P.focus; }, state: P };
}
