// L'accueil du portail : les outils (depuis TOOLS, la seule liste), le
// compte de la bibliothèque, les derniers assets, l'état des machines.
import { TOOLS, api, el, $, href, mountHeader, system, thumb, toolHref, toast, uploadFile, dropAnywhere } from './commun/shell.js';

mountHeader(null);

const MAIN = ['image', 'movie', 'character'];
const ICONS = {
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/></svg>',
  movie: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="M17 10l4-2v8l-4-2"/></svg>',
  character: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>',
};

async function paint() {
  const sys = await system();
  const tones = ['t3', 't2', 't1'];
  $('#slabs').replaceChildren(...MAIN.map((id, i) => {
    const t = TOOLS.find((x) => x.id === id);
    return el('a', { class: `slab ${tones[i]}`, href: toolHref(t, sys), target: t.external ? '_blank' : null },
      el('span', { class: 'ico', html: ICONS[id] }),
      el('span', { class: 'body' }, el('span', { class: 'line' }, el('span', { class: 'ref' }, t.k), el('span', { class: 'nm' }, t.name)),
        el('span', { class: 'sub' }, t.sub)),
      el('span', { class: 'dots' }), el('span', { class: 'go' }, 'Ouvrir'));
  }));
  const rest = TOOLS.filter((t) => !MAIN.includes(t.id));
  $('#n-tools').textContent = `${TOOLS.length} outils`;
  $('#tiles').replaceChildren(...rest.map((t) => el('a', { class: 'tile', href: toolHref(t, sys) },
    el('span', { class: 'k' }, t.k), el('span', { class: 'st' }),
    el('span', { class: 'nm' }, t.name), el('span', { class: 'sub' }, t.sub))));
  paintMachines(sys);
}

function paintMachines(sys) {
  const box = $('#machines');
  if (!sys) { box.replaceChildren(el('p', { class: 'warn' }, 'le portail ne répond pas')); return; }
  const by = {};
  for (const [lane, eps] of Object.entries(sys.lanes)) {
    for (const e of eps) (by[e.machine] ||= []).push({ lane, ...e });
  }
  const LANE = { image: 'ComfyUI · images', h3: 'H3 · vidéo', audio: 'audio' };
  box.replaceChildren(...Object.entries(by).map(([m, list]) => {
    const first = list.find((e) => e.up && e.ram_free_gb != null);
    return el('div', { class: 'machine' },
      el('span', { class: 'lbl' }, m),
      el('span', { class: 'nm' }, m),
      el('span', { class: 'v', html: list.filter((e) => LANE[e.lane]).map((e) =>
        `${LANE[e.lane]} : ${e.up ? '<b>prêt</b>' : e.lane === 'h3' ? 'arrêté' : '<s>ne répond pas</s>'}`).join('<br>') +
        (first ? `<br>mémoire libre : ${first.ram_free_gb} / ${first.ram_total_gb} Go` : '') }));
  }), el('div', { class: 'machine' }, el('span', { class: 'lbl' }, 'studio'), el('span', { class: 'nm' }, 'Character Factory'),
    el('span', { class: 'v', html: sys.cf_studio.up ? '<b>en ligne</b> · DGX1' : '<s>ne répond pas</s>' })));
  $('#n-queue').textContent = sys.queued ? `${sys.queued} en file` : 'file vide';
}

async function counts() {
  try {
    const res = await api('library?limit=12');
    const c = res.counts;
    const n = Object.values(c).reduce((a, b) => a + b, 0);
    $('#n-assets').textContent = String(n).padStart(4, '0');
    $('#n-detail').textContent = `${c.image} images · ${c.element} éléments · ${c.video} vidéos · ${c.audio} sons`;
    if (res.items.length) {
      $('#recent-sect').hidden = false;
      $('#recent').replaceChildren(...res.items.map((it) => thumb(it, { onclick: () => { location.href = href('asset/#' + it.id); } })));
    }
  } catch (e) { $('#n-detail').textContent = e.message; }
}

dropAnywhere(async (files) => {
  for (const f of files) {
    try { await uploadFile(f, { tool: 'upload' }); toast(`${f.name} rangé dans la bibliothèque`); } catch (e) { toast(`${f.name} : ${e.message}`); }
  }
  counts();
});

paint();
counts();
