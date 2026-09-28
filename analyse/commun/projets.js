/* MOVIE ANALYSIS — les projets.
 *
 * Deux sortes : les analyses publiées dans le dépôt (leur dépouillement est fait, la page existe), et les projets
 * créés depuis la home. Ceux-ci vivent dans le dépôt partagé du DGX — le service des corrections, joignable sans
 * jeton (REPRISE §6), sous le nom projets.json — et dans la mémoire du navigateur, qui prend le relais quand la
 * machine ne répond pas : un projet créé hors ligne part au dépôt partagé à la visite suivante.
 *
 * Fusion par projet, le plus récent gagne (champ maj). Une suppression est gardée comme telle (supprime: true) :
 * sans elle, la copie d'un autre navigateur ferait revenir le projet.
 */
const PROJETS = (() => {
  // le dépôt partagé, sur Cloudflare (outils/partage) : toujours en ligne, le même depuis tous les ordinateurs
  const DEPOT = 'https://movie-analysis-partage.luxigone.workers.dev/corrections/projets.json';
  const CLE = 'movie-analysis-projets';

  // Les analyses publiées : des projets dont le dépouillement est fait. Chemins depuis la racine du site.
  const DU_DEPOT = [
    { id: 'getaround', nom: 'Évadez-vous avec Getaround', meta: 'publicité · 30 s · 1920×804', vignette: 'analyses/getaround/vignette.jpg',
      analyse: 'analyses/getaround/index.html', film: 'getaround', resume: '12 plans · 8 personnages · 14 répliques', diarisation: true },
    { id: 'wall', nom: 'Le Loup de Wall Street', meta: 'extrait · 2 min 19 · VO · 1280×534', vignette: 'analyses/wall/vignette.jpg',
      analyse: 'analyses/wall/index.html', film: 'wall', resume: '45 plans · 16 personnages · 90 répliques', diarisation: false },
  ];

  const estDepot = (id) => DU_DEPOT.some((p) => p.id === id);
  // les analyses du dépôt retirées de l'accueil (« supprimer » sur leur page : les fichiers restent dans git)
  const masquesDe = (l) => l.filter((p) => p.supprime && estDepot(p.id)).map((p) => p.id);
  const lireLocal = () => { try { return JSON.parse(localStorage.getItem(CLE) || '[]') || []; } catch (e) { return []; } };
  const ecrireLocal = (l) => { try { localStorage.setItem(CLE, JSON.stringify(l)); } catch (e) {} };
  const delai = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };

  async function lireDepot() {
    const r = await fetch(DEPOT, { cache: 'no-store', signal: delai(6000) });
    if (!r.ok) throw new Error('réponse ' + r.status);
    const j = await r.json();
    return Array.isArray(j.projets) ? j.projets : [];
  }
  async function ecrireDepot(liste) {
    const r = await fetch(DEPOT, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, signal: delai(6000),
      body: JSON.stringify({ format: 'movie-analysis-projets', version: 1, projets: liste }) });
    if (!r.ok) throw new Error('réponse ' + r.status);
  }
  function fusion(...listes) {
    const m = new Map();
    for (const l of listes) for (const p of l) { const x = m.get(p.id); if (!x || (p.maj || '') > (x.maj || '')) m.set(p.id, p); }
    return Array.from(m.values()).sort((a, b) => (b.cree || '').localeCompare(a.cree || ''));
  }
  const memes = (a, b) => JSON.stringify(fusion(a)) === JSON.stringify(fusion(b));

  // Tous les projets créés (sans les supprimés), et d'où ils viennent : « partage » ou « local ».
  async function lire() {
    const local = lireLocal();
    try {
      const depot = await lireDepot();
      const tout = fusion(depot, local);
      ecrireLocal(tout);
      if (!memes(tout, depot)) await ecrireDepot(tout);   // ce qui avait été créé hors ligne part maintenant
      return { liste: tout.filter((p) => !p.supprime && !estDepot(p.id)), masques: masquesDe(tout), etat: 'partage' };
    } catch (e) {
      return { liste: local.filter((p) => !p.supprime && !estDepot(p.id)), masques: masquesDe(local), etat: 'local', erreur: e.name === 'AbortError' ? 'pas de réponse' : e instanceof TypeError ? 'injoignable' : e.message };
    }
  }
  // Applique une modification (fn reçoit la liste complète, la modifie sur place), en local puis au dépôt partagé.
  async function modifier(fn) {
    let depot = null;
    try { depot = await lireDepot(); } catch (e) {}
    const tout = fusion(depot || [], lireLocal());
    fn(tout);
    ecrireLocal(tout);
    if (depot) { try { await ecrireDepot(tout); return 'partage'; } catch (e) {} }
    return 'local';
  }

  const maintenant = () => new Date().toISOString();
  function slug(nom, pris) {
    const base = String(nom).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'projet';
    let s = base, n = 2;
    while (pris.has(s)) s = base + '-' + n++;
    return s;
  }
  async function creer(nom) {
    nom = String(nom).trim().replace(/\s+/g, ' ');
    let cree = null;
    const etat = await modifier((tout) => {
      const pris = new Set(tout.map((p) => p.id).concat(DU_DEPOT.map((p) => p.id), ['projets', 'essai']));
      cree = { id: slug(nom, pris), nom, cree: maintenant(), maj: maintenant() };
      tout.push(cree);
    });
    return { projet: cree, etat };
  }
  const renommer = (id, nom) => modifier((tout) => { const p = tout.find((x) => x.id === id); if (p) { p.nom = String(nom).trim().replace(/\s+/g, ' '); p.maj = maintenant(); } });
  const supprimer = (id) => modifier((tout) => {
    const p = tout.find((x) => x.id === id);
    if (p) { p.supprime = true; p.maj = maintenant(); }
    else if (estDepot(id)) tout.push({ id, depot: true, supprime: true, cree: maintenant(), maj: maintenant() });
  });
  const restaurer = (id) => modifier((tout) => { const p = tout.find((x) => x.id === id); if (p) { p.supprime = false; p.maj = maintenant(); } });
  const duDepot = (id) => DU_DEPOT.find((p) => p.id === id) || null;
  const locaux = () => lireLocal().filter((p) => !p.supprime && !estDepot(p.id));
  const masquesLocaux = () => masquesDe(lireLocal());

  return { DU_DEPOT, lire, locaux, masquesLocaux, creer, renommer, supprimer, restaurer, duDepot };
})();
