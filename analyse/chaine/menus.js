/* ══ Les menus du clic droit, zone par zone ══════════════════════════════════════════════════════════════════════
   Cal, 29/09 : « ne plus avoir de clic droit du navigateur partout dans nos outils ; un menu contextuel dédié à où on
   se trouve au survol ». Chaque zone de la page d'un film a le sien — la scène vidéo, la frise des plans, l'action, le
   script, la timeline et ses pistes, la fiche du plan, le casting, la table et la bande du dépouillement — par le menu
   commun du portail (commun/menu.js, posé par analyse/film/film.js dans window.SR_MENU), avec en fin les entrées
   communes (annuler, rétablir, le journal, les préférences, le lien). Ailleurs, le gardien de commun/shell.js ouvre le
   menu de repli, qui prend les entrées de la page (film.js : pageMenu — les vues, la fiche du projet, les exports).
   Les champs de texte (un nom au casting, la réplique qu'on corrige, la recherche) gardent le menu du navigateur :
   copier, coller, l'orthographe. Sans le portail (la page ouverte seule, pas de SR_MENU), rien n'est intercepté.

   Globales du Studio : DATA, video, D, $, tc, castName, shotAt, paint, planPrecedent, planSuivant, OVERLAYS ; de la
   timeline (voix.js) : VX, DIAR, vxMenu, vxFenetre, vxZoome, vxEcrit, rendreTimeline. Script classique : studio.mjs le
   lit et le pose tel quel dans la page, après voix.js et son.js. */
(function () {
  const TEXTES = ['', 'text', 'search', 'url', 'email', 'number'];
  const champ = (n) => !!n && n.nodeType === 1 && (n.isContentEditable || n.tagName === 'TEXTAREA'
    || (n.tagName === 'INPUT' && TEXTES.indexOf((n.getAttribute('type') || '').toLowerCase()) >= 0));
  // une zone : build(e) rend ses entrées, ou null (le repli du portail) ; les entrées communes suivent
  function zone(node, build) {
    if (!node) return;
    node.addEventListener('contextmenu', (e) => {
      const M = window.SR_MENU;
      if (!M || !M.menu || e.defaultPrevented || champ(e.target)) return;
      const items = build(e);
      if (!items || !items.length) return;
      e.preventDefault(); e.stopPropagation();
      const kb = e.button !== 2 && e.clientX === 0 && e.clientY === 0, r = e.target.getBoundingClientRect();
      M.menu(kb ? r.left + 8 : e.clientX, kb ? r.bottom - 4 : e.clientY, items.concat(['-'], M.commonItems ? M.commonItems(e) : []), { focusFirst: kb });
    });
  }
  const copie = (t, dit) => { const M = window.SR_MENU; if (M && M.copy) M.copy(t, dit); else if (navigator.clipboard) navigator.clipboard.writeText(t); };
  const vue = (v) => { const b = document.querySelector('#tabs [data-tab="' + v + '"]'); if (b) b.click(); };
  const aller = (t) => { video.currentTime = Math.max(0, Math.min(D, t)); paint(video.currentTime, true); };
  const plan = (id) => DATA.shots.find((s) => s.id === id) || null;
  const lienDu = (id) => { const u = new URL(location.href); u.hash = id; return u.href; };
  // un plan dans le dépouillement : la vue, puis la bande (son clic ouvre le plan dans la table et y descend)
  const auDepouillement = (id) => { vue('depouillement'); setTimeout(() => { const b = document.querySelector('#dp-bande button[data-shot="' + id + '"]'); if (b) b.click(); }, 60); };
  const auStudio = (s) => { aller(s.start + 0.02); vue('studio'); };
  // les gestes sur un plan, partout où un plan se montre
  const surLePlan = (s, ici) => [
    { head: s.id + ' · ' + tc(s.start) + ' → ' + tc(s.end) },
    ici !== 'studio' ? { label: 'Voir dans le Studio', icon: '▶', onclick: () => auStudio(s) } : { label: 'Aller au plan ' + s.id, icon: '▶', onclick: () => aller(s.start + 0.02) },
    ici !== 'depouillement' ? { label: 'Ce plan dans le dépouillement', icon: '▤', onclick: () => auDepouillement(s.id) } : null,
    { label: 'Copier le lien du plan', icon: '↗', onclick: () => copie(lienDu(s.id), 'lien du plan copié') },
    s.frame ? { label: 'Copier l’action du plan', icon: '⧉', onclick: () => copie(s.frame, 'action copiée') } : null,
  ].filter(Boolean);
  const sesPlans = (id) => ({ label: 'Ses plans dans le dépouillement', icon: '▤', onclick: () => {
    vue('depouillement');
    const sel = document.getElementById('dp-role');
    if (sel) { sel.value = id; if (sel.onchange) sel.onchange(); }
  } });
  const premiereReplique = (id) => {
    const l = VX.lignes.find((g) => g.perso === id);
    return { label: 'Sa première réplique', icon: '▶', disabled: !l, why: 'aucune réplique n’est à ce personnage', onclick: () => { aller(l.a + 0.01); vue('studio'); } };
  };

  /* la scène vidéo, son bandeau de lecture, le sous-titre */
  zone(document.getElementById('visionneuse'), () => {
    const s = shotAt(video.currentTime || 0), calque = document.getElementById('b-calque');
    const items = [{ head: (s ? s.id + ' · ' : '') + tc(video.currentTime || 0) },
      { label: video.paused ? 'Lecture' : 'Pause', icon: video.paused ? '▶' : '❚❚', key: 'Espace', onclick: () => (video.paused ? video.play().catch(() => {}) : video.pause()) },
      { label: 'Plan précédent', icon: '←', key: '←', onclick: () => planPrecedent() },
      { label: 'Plan suivant', icon: '→', key: '→', onclick: () => planSuivant() },
      '-',
      { label: 'Silhouettes · SAM 3', checked: document.getElementById('visionneuse').dataset.calque === '1', disabled: !!(calque && calque.disabled),
        why: 'pas de silhouette rattachée à ce plan', onclick: () => { if (calque) calque.click(); } },
      { label: 'Son coupé', checked: video.muted, onclick: () => { const b = document.getElementById('b-son'); if (b) b.click(); } },
      { label: document.fullscreenElement ? 'Quitter le plein écran' : 'Plein écran', icon: '⤢', onclick: () => { const b = document.getElementById('b-plein'); if (b) b.click(); } },
    ];
    if (s) items.push('-', ...surLePlan(s, 'studio').slice(2));
    return items;
  });

  /* la frise des plans, au-dessus de l'image */
  zone(document.getElementById('frise'), (e) => {
    const b = e.target.closest('button[data-shot]'), s = b && plan(b.dataset.shot);
    return s ? surLePlan(s, 'studio') : null;
  });

  /* l'action du plan, sous la vidéo */
  zone(document.getElementById('actionnow'), () => {
    const s = shotAt(video.currentTime || 0);
    return s ? surLePlan(s, 'studio') : null;
  });

  /* le script : une réplique (qui la dit, la corriger), l'en-tête d'un plan, le reste */
  zone(document.getElementById('script'), (e) => {
    const ligne = e.target.closest('.sc-line');
    if (ligne) {
      const cle = ligne.dataset.start + '-' + ligne.dataset.end;
      // la réplique a un groupe par personnage qui la dit : le plus long porte le menu
      const g = VX.lignes.filter((x) => x.cle === cle).sort((x, y) => (y.i1 - y.i0) - (x.i1 - x.i0))[0];
      if (g) {
        aller(g.a + 0.01);
        vxMenu(g, e.clientX || ligne.getBoundingClientRect().left + 8, e.clientY || ligne.getBoundingClientRect().bottom - 4);
        e.preventDefault(); e.stopPropagation();
        return null;
      }
    }
    const sh = e.target.closest('.sc-shot'), s = sh && plan(sh.dataset.shot);
    const suivre = document.getElementById('follow');
    const items = s ? surLePlan(s, 'studio') : [];
    if (suivre) items.push('-', { label: 'Le script suit la lecture', checked: suivre.checked, onclick: () => { suivre.checked = !suivre.checked; } });
    return items;
  });

  /* la timeline : un instant, le zoom, les voix brutes ; le nom d'une piste (couper sa voix, ses répliques) */
  zone(document.getElementById('vx-zone'), (e) => {
    const z = document.getElementById('vx-zone'), r = z.getBoundingClientRect(), f = vxFenetre();
    const t = f[0] + (e.clientX - r.left) / r.width * (f[1] - f[0]);
    const items = [{ head: 'timeline · ' + tc(t) },
      { label: 'Aller à ' + tc(t), icon: '▶', onclick: () => aller(t) },
      '-',
      { label: 'Zoomer', icon: '+', sub: 'alt + molette', onclick: () => vxZoome(VX.zoom * 2, e.clientX - r.left) },
      { label: 'Dézoomer', icon: '−', disabled: VX.zoom <= 1, why: 'le film entier est déjà visible', onclick: () => vxZoome(VX.zoom / 2, e.clientX - r.left) },
      { label: 'Tout le film', icon: '↔', disabled: VX.zoom <= 1, why: 'le film entier est déjà visible', onclick: () => vxZoome(1) }];
    if (DIAR) items.push({ label: 'Les 8 voix brutes', checked: !!VX.brutes, onclick: () => { VX.brutes = !VX.brutes; vxEcrit('brutes', VX.brutes); rendreTimeline(); } });
    items.push('-', { label: 'Paramètres avancés', icon: '⚙', onclick: () => { const d = document.querySelector('.vx-avance'); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); } } },
      { label: 'Tout remettre comme le dépôt', icon: '↺', onclick: () => window.xvRemetTout() });
    return items;
  });
  zone(document.getElementById('vx-noms'), (e) => {
    const d = e.target.closest('#vx-noms > div');
    if (!d) return null;
    const r = VX.lignesFrise[[...d.parentNode.children].indexOf(d)];
    if (!r || !r.type || r.type === 'regle' || r.type === 'onde') return null;
    const items = [{ head: r.type === 'perso' ? r.id + ' · ' + r.nom : r.nom }];
    if (r.lignes && r.lignes.length) items.push({ label: 'Sa première réplique', icon: '▶', onclick: () => aller(r.lignes[0].a + 0.01) });
    if (d.classList.contains('audible')) {
      items.push({ label: d.classList.contains('muet') ? 'Rendre sa voix' : 'Couper sa voix', icon: '♪', onclick: () => d.click() },
        { label: 'N’entendre que lui', icon: '♪', sub: 'alt + clic', onclick: () => d.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true })) });
    }
    if (r.type === 'perso') items.push('-', sesPlans(r.id), { label: 'Le renommer au casting', icon: '✎', onclick: () => renommer(r.id) });
    return items;
  });

  /* la fiche du plan, sous la timeline ; un personnage dedans */
  zone(document.getElementById('shot'), (e) => {
    const s = shotAt(video.currentTime || 0);
    if (!s) return null;
    const items = surLePlan(s, 'studio').slice(0, 1).concat([
      { label: 'Plan précédent', icon: '←', onclick: () => planPrecedent() },
      { label: 'Plan suivant', icon: '→', onclick: () => planSuivant() }], surLePlan(s, 'studio').slice(2));
    const p = e.target.closest('.person');
    if (p) {
      const nom = (p.querySelector('span') || p).firstChild, c = DATA.cast.find((x) => nom && x.name === String(nom.textContent).trim());
      if (c) items.push('-', { head: c.id + ' · ' + c.name }, premiereReplique(c.id), sesPlans(c.id), { label: 'Le renommer au casting', icon: '✎', onclick: () => renommer(c.id) });
    }
    return items;
  });

  /* le casting : une fiche (renommer, réunir, séparer, ses plans) */
  function renommer(id) {
    vue('casting');
    setTimeout(() => { const i = document.querySelector('#cast-grid input.nom[data-id="' + id + '"]'); if (i) { i.focus(); i.select(); i.scrollIntoView({ block: 'nearest' }); } }, 40);
  }
  zone(document.getElementById('casting'), (e) => {
    const fi = e.target.closest('#cast-grid .fiche'), sel = fi && fi.querySelector('select.fus');
    if (!sel) return null;
    const id = sel.dataset.id, c = DATA.cast.find((x) => x.id === id);
    if (!c) return null;
    const autres = DATA.cast.filter((x) => x.id !== id);
    const items = [{ head: id + ' · ' + c.name },
      { label: 'Renommer', icon: '✎', onclick: () => renommer(id) },
      { label: 'Même personne que…', icon: '⊕', disabled: !autres.length || !window.xvFusionne, why: 'aucune autre fiche',
        items: autres.map((x) => ({ label: x.id + ' · ' + x.name, onclick: () => window.xvFusionne(id, x.id) })) }];
    fi.querySelectorAll('button.separer').forEach((b) => items.push({ label: 'Séparer ' + b.dataset.id, icon: '⊖', onclick: () => b.click() }));
    items.push('-', premiereReplique(id), sesPlans(id));
    return items;
  });

  /* le dépouillement : une rangée de la table, un plan de la bande */
  zone(document.getElementById('dp-table'), (e) => {
    const b = e.target.closest('.bloc[data-shot]'), s = b && plan(b.dataset.shot);
    if (!s) return null;
    const ouvert = b.getAttribute('aria-expanded') === 'true';
    return surLePlan(s, 'depouillement').slice(0, 1)
      .concat([{ label: ouvert ? 'Replier la fiche' : 'Ouvrir la fiche', icon: ouvert ? '▴' : '▾', onclick: () => { const l = b.querySelector('.lg'); if (l) l.click(); } }],
        surLePlan(s, 'depouillement').slice(1));
  });
  zone(document.getElementById('dp-bande'), (e) => {
    const b = e.target.closest('button[data-shot]'), s = b && plan(b.dataset.shot);
    if (!s) return null;
    return surLePlan(s, 'depouillement').slice(0, 1)
      .concat([{ label: 'Le plan dans la table', icon: '▤', onclick: () => b.click() }], surLePlan(s, 'depouillement').slice(1));
  });
})();
