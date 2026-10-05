// IDÉATION · OBJETS — le modèle 3D (05/10/2026). Cal : « il nous faut un viewer 3D, car on
// pourrait avoir envie que nos éléments et assets 3D soient visibles et interactifs… avec nos
// options de viewer qu'on a déjà faites, avec différents éclairages ».
//
//   { id, type: 'model3d', x, y, w, h, item, mesh, title, light, chan }
//   item   l'élément de la bibliothèque ; mesh son GLB (`element.meshes[].file`, mesh-001.glb)
//   light  studio | jour | interieur | contre | plat ; chan final | albedo | metal | rough | normal | wire
//
// La visionneuse est celle du portail (character/viewer.html, `?embed=1` : le moniteur seul),
// dans un cadre de la même origine. Comme l'objet Web (web.js) : une carte légère d'abord
// (l'image de l'élément) ; « Interagir » ou un double-clic charge la visionneuse et lui donne
// la souris (tourner, zoomer) ; un clic ailleurs la rend à la planche. L'éclairage et le canal
// se règlent depuis la barre de l'objet (selection.js, mode « m3d ») et passent au cadre par
// message, sans le recharger.

import { el, href, toast } from '../../commun/shell.js';
import { icon, cut } from './commun.js';
import { mediasCss } from './web.js';

export const M3D_ICON = 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5';
export const LIGHTS = [['studio', 'Studio'], ['jour', 'Jour'], ['interieur', 'Intérieur'], ['contre', 'Contre-jour'], ['plat', 'Plat']];
export const CHANS = [['final', 'Rendu'], ['albedo', 'Albedo'], ['metal', 'Métal'], ['rough', 'Rugosité'], ['normal', 'Normales'], ['wire', 'Filaire']];
const SIZE = [380, 360];
const live = new Set();
let active = null;

// les modèles 3D d'un élément (les plus récents d'abord)
export const meshesOf = (it) => [...(it?.element?.meshes || [])].filter((m) => m.file && m.url).reverse();

export function extendModele3d(app, api0) {
  const { S } = app;
  mediasCss();
  const nodeEl = (id) => app.canvas?.dom.get(id)?.el;
  const itemOf = (n) => S.items.get(n.item);
  const meshOf = (n) => { const it = itemOf(n); return meshesOf(it).find((m) => m.file === n.mesh) || meshesOf(it)[0] || null; };
  const viewerSrc = (n) => {
    const m = meshOf(n);
    if (!m) return '';
    const q = new URLSearchParams({ embed: '1', src: new URL(href(m.url), location.href).href, light: n.light || 'studio', chan: n.chan || 'final' });
    return href(`character/viewer.html?${q}`);
  };
  const whyNot = (n) => { const it = itemOf(n); return !it || it.missing ? 'l’élément n’est plus dans la bibliothèque' : !meshOf(n) ? 'cet élément n’a pas (ou plus) de modèle 3D' : ''; };

  function frameFor(n) {
    return el('iframe', { class: 'wb-if m3-if', src: viewerSrc(n), title: `modèle 3D · ${n.title || ''}`, allow: 'fullscreen' });
  }
  function load(id) {
    const n = app.node(id);
    if (!n) return;
    const why = whyNot(n);
    if (why) { toast(why, 6000); return; }
    live.add(id);
    const e = nodeEl(id);
    const body = e?.querySelector('.wb-body');
    if (body && !body.querySelector('iframe')) body.append(frameFor(n));
    e?.classList.add('live');
    activate(id);
  }
  function activate(id) {
    if (!live.has(id)) { load(id); return; }
    if (active && active !== id) deactivate();
    active = id;
    const e = nodeEl(id);
    e?.classList.add('on');
    e?.querySelector('iframe')?.focus({ preventScroll: true });
  }
  function deactivate() {
    if (!active) return;
    nodeEl(active)?.classList.remove('on');
    active = null;
  }
  function unload(id) {
    if (active === id) deactivate();
    live.delete(id);
    const e = nodeEl(id);
    e?.querySelector('iframe')?.remove();
    e?.classList.remove('live', 'on');
  }
  addEventListener('pointerdown', (e) => {
    if (!active) return;
    if (e.target.closest?.('.wb-bar') && e.target.closest('[data-id]')?.dataset.id === active) return;
    deactivate();
  }, true);
  // l'éclairage, le canal, recadrer : au cadre chargé, par message (même origine : character/viewer.html)
  const tell = (id, msg) => { const f = nodeEl(id)?.querySelector('iframe'); try { f?.contentWindow?.postMessage({ sr3d: msg }, location.origin); } catch { /* */ } };
  function set(id, patch) {
    const n = app.node(id);
    if (!n) return;
    app.mutate(() => Object.assign(n, patch));
    tell(id, patch);
  }

  function build(n) {
    const it = itemOf(n);
    const pic = it && !it.missing ? it.thumb_url || it.element?.refs?.[0]?.thumb_url : '';
    const on = live.has(n.id);
    const why = whyNot(n);
    const bar = el('div', { class: 'wb-bar' },
      el('span', { class: 'wb-k' }, '3D'),
      el('span', { class: 'wb-h', title: n.title || '' }, n.title || it?.title || 'modèle 3D'), el('span', { class: 'sp' }),
      el('button', { class: 'wb-b wb-act', type: 'button', title: 'la visionneuse reçoit la souris : tourner, zoomer — un clic hors d’elle la rend à la planche' }, 'Interagir'),
      el('button', { class: 'wb-b wb-back', type: 'button', title: 'fermer la visionneuse : revenir à l’image' }, 'Image'));
    const card = el('div', { class: 'wb-card m3-card' + (pic ? '' : ' noimg') },
      el('div', { class: 'wb-img' }, pic ? el('img', { src: href(pic), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }) : icon(M3D_ICON, 'wb-glyph'),
        why ? null : el('button', { class: 'wb-play', type: 'button', 'aria-label': 'ouvrir la visionneuse 3D', title: 'la visionneuse 3D, ici (double-clic aussi)' }, icon(M3D_ICON))),
      why ? el('div', { class: 'wb-meta' }, el('p', { class: 'wb-why' }, why)) : null);
    const body = el('div', { class: 'wb-body' }, card, on && !why ? frameFor(n) : null);
    const root = el('div', { class: 'wb m3' }, bar, body);
    root.addEventListener('click', (e) => {
      const b = e.target.closest?.('button');
      if (!b) return;
      if (b.matches('.wb-play, .wb-act')) { e.stopPropagation(); load(n.id); }
      else if (b.matches('.wb-back')) { e.stopPropagation(); unload(n.id); }
    });
    root.addEventListener('dblclick', (e) => {
      const c = app.node(n.id);
      if (!c || (c.group && S.focus !== c.group)) return;
      e.stopPropagation();
      load(c.id);
    });
    const cls = ['web', 'wb-video', 'm3d'];   // l'habit de l'objet Web (medias.css : .nd.web, le cadre actif)
    if (on && !why) cls.push('live');
    if (on && active === n.id) cls.push('on');
    return { cls, body: [root] };
  }
  // l'image de l'élément et ses modèles : un changement refait la carte
  const key = (n) => { const it = itemOf(n); return `|${it ? (it.missing ? 'x' : `${it.updated || ''}${meshesOf(it).length}`) : '?'}`; };

  // poser le modèle 3D d'un élément (le panneau de l'élément, le menu d'une carte élément)
  function place(it, wx, wy, mesh = null) {
    if (!S.board) { toast('ouvrez ou créez d’abord une planche'); return null; }
    const ms = meshesOf(it);
    if (!ms.length) { toast('cet élément n’a pas de modèle 3D (Object Creator en fabrique un)', 6000); return null; }
    S.items.set(it.id, it);
    const [w, h] = SIZE;
    const [x, y] = app.freeSpot(wx - w / 2, wy - h / 2, w, h, { around: true });
    return app.addAt('model3d', x, y, { preset: { item: it.id, mesh: mesh || ms[0].file, title: it.title || '', w, h }, select: true });
  }

  // la barre de l'objet choisi (selection.js, mode « m3d »)
  function barItems(n, K) {
    const { btn, sub, sep } = K;
    const L = LIGHTS.find(([k]) => k === (n.light || 'studio'));
    const C = CHANS.find(([k]) => k === (n.chan || 'final'));
    const it = itemOf(n);
    const ms = meshesOf(it);
    return [
      btn(live.has(n.id) ? 'Interagir' : 'Ouvrir', () => load(n.id), { why: whyNot(n), title: 'la visionneuse : tourner (glisser), zoomer (molette)' }),
      sep(),
      sub(el('span', {}, `Éclairage · ${L[1]}`), () => [{ head: 'éclairage' }, ...LIGHTS.map(([k, v]) => ({ label: v, checked: (n.light || 'studio') === k, onclick: () => set(n.id, { light: k }) }))],
        { title: 'les cinq éclairages de la visionneuse' }),
      sub(el('span', {}, `Canal · ${C[1]}`), () => [{ head: 'canal' }, ...CHANS.map(([k, v]) => ({ label: v, checked: (n.chan || 'final') === k, onclick: () => set(n.id, { chan: k }) }))],
        { title: 'le rendu, ou un canal PBR, ou le filaire' }),
      btn('Recadrer', () => tell(n.id, { fit: true }), { why: live.has(n.id) ? '' : 'ouvrez d’abord la visionneuse', title: 'tout le modèle dans le cadre' }),
      ms.length > 1 ? sub(el('span', {}, 'Version'), () => [{ head: 'les modèles de l’élément' }, ...ms.map((m, i) => ({ label: m.file, sub: i === 0 ? 'le plus récent' : '', checked: (n.mesh || ms[0].file) === m.file,
        onclick: () => { unload(n.id); app.mutate(() => { n.mesh = m.file; }); } }))]) : null,
      el('a', { class: 'sbt', href: viewerSrc(n).replace('embed=1&', ''), target: '_blank', rel: 'noopener', title: 'la visionneuse complète (A/B, squelette, clips), dans un onglet' }, '↗'),
    ].filter(Boolean);
  }
  const barKey = (n) => JSON.stringify([n.light, n.chan, n.mesh, live.has(n.id)]);

  function menu(n) {
    return [
      { label: live.has(n.id) ? 'Interagir' : 'Ouvrir la visionneuse', sub: 'double-clic', disabled: !!whyNot(n), why: whyNot(n), onclick: () => load(n.id) },
      live.has(n.id) ? { label: 'Revenir à l’image', onclick: () => unload(n.id) } : null,
      { label: 'Éclairage', items: LIGHTS.map(([k, v]) => ({ label: v, checked: (n.light || 'studio') === k, onclick: () => set(n.id, { light: k }) })) },
      { label: 'Canal', items: CHANS.map(([k, v]) => ({ label: v, checked: (n.chan || 'final') === k, onclick: () => set(n.id, { chan: k }) })) },
    ].filter(Boolean);
  }
  function panels(n, K) {
    const { card, row, hint, b } = K;
    const it = itemOf(n);
    const m = meshOf(n);
    return [card('Modèle 3D', m ? m.file : null,
      el('p', { class: 'hint' }, it?.title || n.title || ''),
      m && m.faces ? hint(`${m.faces.toLocaleString('fr-FR')} faces${m.extent ? ` · ${m.extent.map((v) => v.toFixed(2)).join(' × ')} m` : ''}`) : null,
      el('div', { class: 'seg m3-seg' }, ...LIGHTS.map(([k, v]) => el('button', { class: 'tb' + ((n.light || 'studio') === k ? ' on' : ''), type: 'button', onclick: () => set(n.id, { light: k }) }, v))),
      el('div', { class: 'seg m3-seg' }, ...CHANS.map(([k, v]) => el('button', { class: 'tb' + ((n.chan || 'final') === k ? ' on' : ''), type: 'button', onclick: () => set(n.id, { chan: k }) }, v))),
      row(b('Ouvrir', () => load(n.id), { disabled: !!whyNot(n), title: whyNot(n) || 'double-clic aussi' }),
        el('a', { class: 'tb ghost sm', href: viewerSrc(n).replace('embed=1&', ''), target: '_blank', rel: 'noopener' }, 'Visionneuse ↗'),
        el('a', { class: 'tb ghost sm', href: href(`asset/#${n.item}`), target: '_blank', rel: 'noopener' }, 'Dans Asset')),
      hint('Double-clic ou « Interagir » : la visionneuse prend la souris (glisser : tourner ; molette : zoomer) ; un clic ailleurs la rend à la planche.'))];
  }

  const L0 = app.label, K0 = app.kindLabel;
  app.label = (n) => (n?.type === 'model3d' ? cut(n.title || itemOf(n)?.title || 'modèle 3D', 42) : L0(n));
  app.kindLabel = (n) => (n?.type === 'model3d' ? 'modèle 3D' : K0(n));

  api0.TYPES.add('model3d');
  api0.defs.model3d = () => ({ w: SIZE[0], h: SIZE[1], item: '', mesh: '', title: '', light: 'studio', chan: 'final' });
  const wrap = (k, fn) => { const f0 = api0[k]; api0[k] = (n, ...a) => (n?.type === 'model3d' ? fn(n, ...a) : f0(n, ...a)); };
  wrap('build', build);
  wrap('key', key);
  wrap('menu', menu);
  wrap('panels', panels);
  wrap('mini', (n, tok) => tok('cy'));
  const I0 = api0.items;
  api0.items = (board) => [...I0(board), ...(board?.nodes || []).filter((n) => n.type === 'model3d' && n.item).map((n) => n.item)];
  app.modele3d = { place, load, unload, barItems, barKey, meshesOf, state: () => ({ live: [...live], active }) };
  return api0;
}
