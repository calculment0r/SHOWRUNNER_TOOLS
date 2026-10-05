// SHOWRUNNER TOOLS — la barre du kit de présentation (server/tools/strategie.py l'ajoute à chaque
// page HTML de /strategie/, sans toucher au contenu du kit, qui n'est jamais dans le dépôt).
//
// Cal, 05/10 : « en haut un accès direct aux différents éléments, car la navigation des éléments
// à d'autres est fastidieuse » ; « quand on fait Échap dans la présentation, on revient à notre
// page de positionnement ».
//   - une barre fine en haut : l'accueil du portail, puis chaque page du kit (GET
//     /api/strategie/plan), celle où l'on est allumée ; elle se fait discrète tant que la souris
//     n'approche pas du haut, et disparaît en plein écran (une présentation reste nette) ;
//   - Échap, hors de la page de positionnement (l'index du kit) : on y revient. En plein écran,
//     le navigateur garde Échap pour sortir du plein écran : la sortie du plein écran d'une page du
//     kit y ramène aussi ;
//   - Alt+← / Alt+→ : la page précédente, la suivante du plan.
// Ses styles vivent dans un shadow DOM (ceux du kit ne la touchent pas, elle ne touche pas les
// leurs) ; ses couleurs sont les jetons de commun/tokens.css (règle 1 du thème), relus et portés
// sur la barre seule (:host).

(() => {
  if (window.__srKit) return;
  window.__srKit = true;
  const BASE = '/strategie/';
  const here = decodeURIComponent(location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : '') || 'index.html';
  const cur = here.endsWith('/') ? here + 'index.html' : here;
  const isIndex = cur === 'index.html';
  let docs = [];

  const host = document.createElement('div');
  host.setAttribute('data-sr-kit', '');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  const bar = document.createElement('nav');
  bar.className = 'bar';
  bar.setAttribute('aria-label', 'le kit de présentation');
  root.append(style, bar);

  const CSS = `
    :host { all: initial; position: fixed; top: 0; left: 0; right: 0; z-index: 2147483000; display: flex; justify-content: center;
      pointer-events: none; font-family: var(--f-ui, system-ui, sans-serif); }
    .bar { pointer-events: auto; margin-top: 8px; max-width: calc(100vw - 24px); display: flex; align-items: center; gap: 2px;
      padding: 4px; border-radius: 999px; background: var(--panel); box-shadow: inset 0 0 0 1px var(--line), 0 6px 20px var(--drop);
      overflow-x: auto; scrollbar-width: none; transition: opacity .25s, transform .25s; }
    .bar::-webkit-scrollbar { display: none; }
    :host(.calme) .bar { opacity: .18; transform: translateY(-4px); }
    :host(.calme) .bar:hover, :host(.calme) .bar:focus-within { opacity: 1; transform: none; }
    :host(.plein) { display: none; }
    a { flex: none; display: inline-flex; align-items: center; height: 26px; padding: 0 12px; border-radius: 999px; text-decoration: none;
      font-size: 12px; color: var(--ink2); white-space: nowrap; }
    a:hover { color: var(--ink); background: var(--panel3); }
    a[aria-current="page"] { color: var(--ink); box-shadow: inset 0 0 0 1px var(--line-or, var(--or)); }
    a.home { font-family: var(--f-mono, monospace); font-size: 9.5px; letter-spacing: .16em; text-transform: uppercase; color: var(--ink3); }
    .sep { flex: none; width: 1px; height: 14px; margin: 0 4px; background: var(--line); }
    .k { font-family: var(--f-mono, monospace); font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: var(--or); padding: 0 8px 0 10px; }
  `;
  // les jetons du thème, portés par la barre (:host) — ceux du kit n'en sont pas changés
  fetch('/commun/tokens.css').then((r) => (r.ok ? r.text() : '')).catch(() => '').then((t) => {
    const dark = (t.split(/\n\[data-theme="light"\]\s*\{/)[0] || '').replace(/:root\b/g, ':host');
    style.textContent = dark + CSS;
  });
  style.textContent = CSS;

  const link = (href, text, opts = {}) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    if (opts.cls) a.className = opts.cls;
    if (opts.current) a.setAttribute('aria-current', 'page');
    if (opts.title) a.title = opts.title;
    return a;
  };
  function paint() {
    const kids = [link('/', 'Accueil', { cls: 'home', title: 'l’accueil du portail' }), Object.assign(document.createElement('i'), { className: 'sep' }),
      Object.assign(document.createElement('span'), { className: 'k', textContent: 'kit' })];
    for (const d of docs) kids.push(link(BASE + d.path, d.titre, { current: d.path === cur }));
    bar.replaceChildren(...kids);
    bar.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  fetch('/api/strategie/plan', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { docs: [] })).catch(() => ({ docs: [] }))
    .then((d) => { docs = d.docs || []; paint(); });
  paint();

  const mount = () => { if (!host.isConnected) document.body.append(host); };
  if (document.body) mount(); else addEventListener('DOMContentLoaded', mount);

  // discrète quand la souris est loin du haut ; pleine dès qu'elle s'en approche
  let calmeT = 0;
  const calme = () => { clearTimeout(calmeT); calmeT = setTimeout(() => host.classList.add('calme'), 2500); };
  addEventListener('pointermove', (e) => { if (e.clientY < 70) { host.classList.remove('calme'); calme(); } }, { passive: true });
  calme();

  // la page de positionnement : l'index du kit
  const toIndex = () => { if (!isIndex) location.href = BASE; };
  const typing = (t) => t instanceof Element && (t.isContentEditable || !!t.closest('input, textarea, select, [contenteditable]'));
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented && e.key !== 'Escape') return;
    if (e.key === 'Escape' && !isIndex && !typing(e.target) && !document.fullscreenElement) {
      e.preventDefault(); e.stopImmediatePropagation();
      toIndex();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && docs.length && !typing(e.target)) {
      const i = docs.findIndex((d) => d.path === cur);
      const j = i + (e.key === 'ArrowRight' ? 1 : -1);
      if (i >= 0 && j >= 0 && j < docs.length) { e.preventDefault(); location.href = BASE + docs[j].path; }
    }
  }, true);
  // en plein écran, Échap appartient au navigateur (il sort du plein écran) : sortir du plein écran
  // d'une page du kit ramène au positionnement ; la barre se cache en plein écran
  document.addEventListener('fullscreenchange', () => {
    host.classList.toggle('plein', !!document.fullscreenElement);
    if (!document.fullscreenElement && !isIndex) toIndex();
  });
})();
