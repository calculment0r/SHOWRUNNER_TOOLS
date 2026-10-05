// MONTAGE — les éléments versionnés (30/09, docs/etudes/apps_studio_elements.md
// § 2.7, parcours A). Accroche minimale du Montage sur le socle des éléments
// (server/tools/elements.py) :
//
//   - un plan qui pose la version d'un élément montre sa pastille : « v1 », ou
//     « v1 → v2 » quand une version plus récente existe (le plan reste épinglé :
//     il pointe un fichier que rien ne réécrit) ;
//   - la pastille (ou le clic droit du plan) : « Mettre à jour vers la v2 »,
//     les versions, la source. Mettre à jour = remplacer l'objet du plan, par
//     l'enregistrement habituel de la séquence : un geste, ctrl+Z le défait ;
//     début, durée et point d'entrée restent, la durée raccourcit si la
//     nouvelle version est plus courte (et le dit) ;
//   - glisser un élément pose sa dernière version ; poser un élément de sa
//     propre descendance est refusé avant de poser (check-use), la chaîne nommée ;
//   - le journal des éléments est relu quand il avance : « sr:elements »
//     (commun/shell.js), porté par le relevé de la file que toute page fait
//     déjà (GET /api/jobs rend `ev_seq`, apps_studio_elements.md § 2.11) —
//     plus de relecture à part toutes les 5 s. Une version publiée ailleurs
//     (ODIO, Asset, un autre onglet) fait paraître la pastille, et le Projet
//     (projet.js), qui montre la dernière version de ses éléments, se relit
//     (`app.changes`) — même sans séquence ouverte ni plan d'élément.

import { api, el, toast, href } from '../commun/shell.js';
import { menu } from '../commun/menu.js';
import * as M from './model.js';

export function createElements(app) {
  // app : { getP, commit, ensureItems, itemOf, rerender, changes(events) }
  const info = new Map();         // objet → son statut (POST /api/elements/status)
  let seq = null, lastIds = '', loading = null;

  const clipItems = () => { const p = app.getP(); return p ? [...new Set(M.mediaIds(p))] : []; };

  async function refresh() {
    const ids = clipItems();
    lastIds = ids.join(',');
    // sans plan : rien à demander, mais le numéro du journal (le Projet suit aussi ses éléments)
    loading = api('elements/status', { method: 'POST', body: { items: ids } });
    try {
      const r = await loading;
      info.clear();
      for (const [k, v] of Object.entries(r.items || {})) info.set(k, v);
      if (seq === null || r.seq > seq) seq = r.seq;
      app.rerender();
    } catch { /* le socle absent (un portail d'avant) : pas de pastille */ }
    loading = null;
  }

  // un plan posé, retiré, changé d'objet : on relit (seulement si la liste des objets a changé)
  function changed() { if (clipItems().join(',') !== lastIds) refresh(); }

  // une lecture à la fois : un numéro qui avance pendant la lecture en relance une, depuis le dernier lu
  let busy = false, again = false;
  async function poll() {
    if (seq === null) return;   // le premier statut n'est pas arrivé : il apporte le numéro du moment
    if (busy) { again = true; return; }
    busy = true;
    try {
      const r = await api(`elements/changes?since=${seq}`);
      if (r.events?.length) {
        seq = r.seq;
        const mine = new Set([...info.values()].map((s) => s.el));
        const pub = r.events.filter((e) => e.ev === 'el.published' && mine.has(e.el));
        await refresh();
        app.changes?.(r.events);
        for (const e of pub) toast(`nouvelle version : v${e.n} de « ${e.title} »${e.note ? ` — ${e.note}` : ''}`, 5000);
      }
    } catch { /* hors ligne : au prochain numéro */ }
    busy = false;
    if (again) { again = false; poll(); }
  }
  document.addEventListener('sr:elements', poll);
  refresh();

  const stat = (c) => (c && c.item ? info.get(c.item) : null);

  // remplacer l'objet du plan par une autre version du même élément : un geste
  async function update(ids, item) {
    const p = app.getP();
    if (!p) return;
    await app.ensureItems([item]);
    const it = app.itemOf(item);
    if (!it) { toast('cette version est introuvable dans la bibliothèque'); return; }
    const s0 = stat(M.byId(p, ids[0]));
    const n = info.get(item)?.n ?? s0?.versions?.find((v) => v.item === item)?.n;
    let shorter = null;
    app.commit(`${ids.length > 1 ? `${ids.length} plans` : `« ${M.byId(p, ids[0])?.title || 'plan'} »`} : v${n ?? '?'}${s0 ? ` de « ${s0.title} »` : ''}`, (q) => {
      const fps = q.settings.fps;
      for (const id of ids) {
        const c = M.byId(q, id);
        if (!c) continue;
        c.item = item;
        if (!M.still(c)) {
          c.src_dur = it.duration || c.src_dur;
          // la nouvelle version est plus courte que ce que le plan montre : il raccourcit
          const room = Math.floor(Math.max(0, (c.src_dur - (c.in || 0))) * fps / M.spd(c) + 1e-6);
          if (room >= 1 && c.dur > room) { shorter = { from: c.dur, to: room }; c.dur = room; }
          c.fade_in = Math.min(c.fade_in || 0, c.dur);
          c.fade_out = Math.min(c.fade_out || 0, c.dur - c.fade_in);
        }
      }
    });
    await refresh();
    toast(`mis à jour : v${n ?? '?'}${shorter ? ` · le plan passe de ${M.short(shorter.from / p.settings.fps)} à ${M.short(shorter.to / p.settings.fps)}` : ''}`, 5000);
  }

  function items(c) {
    const s = stat(c);
    if (!s || !s.el_present) return [];
    const p = app.getP();
    const newer = s.head && s.head !== s.n;
    const same = p.clips.filter((x) => info.get(x.item)?.el === s.el && x.item !== s.head_item).map((x) => x.id);
    return [
      { head: `élément · « ${s.title} » · v${s.n}${s.state === 'withdrawn' ? ' (retirée)' : ''}` },
      newer ? { label: `Mettre à jour vers la v${s.head}`, icon: '◆', sub: s.head_note || '', onclick: () => update([c.id], s.head_item) }
        : { label: 'La dernière version', icon: '◆', disabled: true, why: s.head ? `ce plan pose déjà la v${s.head}` : 'l’élément n’a plus de version prête' },
      newer && same.length > 1 ? { label: `Tout mettre à jour (${same.length} plans)`, onclick: () => update(same, s.head_item) } : null,
      { label: 'Versions', items: (s.versions || []).slice().reverse().map((v) => ({ label: `v${v.n}${v.note ? ` · ${v.note}` : ''}`,
        sub: v.duration ? M.short(v.duration) : '', checked: v.item === c.item, onclick: () => (v.item === c.item ? null : update([c.id], v.item)) })) },
      s.open ? { label: 'Ouvrir la source', sub: '↗', onclick: () => window.open(href(s.open), '_blank', 'noopener') } : null,
      { label: 'L’élément dans Asset', sub: '↗', onclick: () => window.open(href('asset/#' + s.el), '_blank', 'noopener') },
    ];
  }

  // la pastille, posée par timeline.js (clipNode) sur le plan
  function badge(c) {
    const s = stat(c);
    if (!s) return null;
    const newer = s.el_present && s.head && s.head !== s.n;
    const title = !s.el_present ? 'l’élément de cette version est à la corbeille'
      : newer ? `v${s.n} de « ${s.title} » · la v${s.head} existe${s.head_note ? ` : ${s.head_note}` : ''}${s.head_by ? ` (${s.head_by})` : ''} — cliquer pour mettre à jour`
        : `v${s.n} de « ${s.title} » · la dernière`;
    return el('button', {
      class: 'elb' + (newer ? ' new' : '') + (s.state === 'withdrawn' ? ' gone' : ''), type: 'button', title, 'aria-label': title,
      onpointerdown: (e) => e.stopPropagation(), ondblclick: (e) => e.stopPropagation(),
      onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); menu(r.left, r.bottom + 4, items(c)); },
    }, el('i', { 'aria-hidden': 'true' }, '◆'), newer ? `v${s.n} → v${s.head}` : `v${s.n}`);
  }

  // avant de poser : un élément donne sa dernière version ; une boucle est refusée
  async function resolve(it, docId) {
    let target = it;
    if (it.kind === 'element' && Array.isArray(it.element?.versions)) {
      const head = it.element.head_item;
      if (!head) { toast(`« ${it.title} » n’a pas encore de version : publie la v1 depuis sa source`, 6000); return null; }
      await app.ensureItems([head]);
      target = app.itemOf(head);
      if (!target) { toast('sa dernière version est introuvable'); return null; }
    }
    if (target.version?.of || target !== it) {
      try {
        const r = await api('elements/check-use', { method: 'POST', body: { item: target.id, doc: docId } });
        if (!r.ok) { toast(r.why, 9000); return null; }
      } catch { /* le socle absent : l'enregistrement jugera */ }
    }
    return target;
  }

  return { refresh, changed, badge, items, resolve, update, stop: () => document.removeEventListener('sr:elements', poll), info };
}
